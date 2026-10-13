import { fork, type ForkOptions } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import { expect, it } from 'vitest';

import { NATIVE_MODULE_FENCE_PROTOCOL } from '../../src/portal/native-module-fence-source.js';
import { createNativeModuleFence } from '../../src/portal/native-module-fence.js';
import type { NativeCommand, NativeProfile } from '../../src/portal/native-runner.js';

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-module-evidence-'));
  const part = relative(tmpdir(), root);
  if (isAbsolute(part) || part.startsWith(`..${sep}`) || !part.startsWith('sfp-module-evidence-'))
    throw Error('INVALID_FIXTURE_ROOT');
  const privateHome = join(root, 'private');
  await mkdir(privateHome);
  // This collector boundary needs no executable/process. The real fence materializes its
  // preload and policy, with empty approved artifact/producer inventories for an eval command.
  const fence = await createNativeModuleFence(
    { closure: [], artifactAuthority: { artifacts: [] } } as unknown as NativeProfile,
    { id: 'boundary', args: [] } as unknown as NativeCommand,
    root,
    [],
    privateHome,
    new AbortController().signal,
  );
  const header = JSON.stringify({
    kind: 'start',
    protocol: NATIVE_MODULE_FENCE_PROTOCOL,
    policyHash: fence.environment.SFP_NATIVE_MODULE_POLICY_HASH,
    pid: process.pid,
    threadId: 0,
  });
  const path = join(privateHome, 'module-boundary', `trace-${process.pid}-0.jsonl`);
  return { root, fence, header, path };
};

it.each([
  'empty',
  'unterminated-header',
  'truncated-second-record',
  'invalid-complete-json',
  'blank-record',
  'null-record',
  'array-record',
  'invalid-utf8',
  'leading-bom',
] as const)(
  'rejects incomplete or malformed native module evidence without accepting records: %s',
  async kind => {
    const f = await fixture();
    try {
      const suffixes = {
        empty: '',
        'unterminated-header': f.header,
        'truncated-second-record': f.header + '\n{"kind":"module"',
        'invalid-complete-json': f.header + '\n{\n',
        'blank-record': f.header + '\n\n',
        'null-record': f.header + '\nnull\n',
        'array-record': f.header + '\n[]\n',
        'invalid-utf8': Buffer.concat([
          Buffer.from(f.header + '\n{"path":"'),
          Buffer.from([0xff]),
          Buffer.from('"}\n'),
        ]),
        'leading-bom': '\uFEFF' + f.header + '\n',
      };
      await writeFile(f.path, suffixes[kind]);
      // Optional evidence on a failed command must not discard a present invalid trace either.
      await expect(f.fence.collectEvidence(false)).rejects.toMatchObject({
        code: 'PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED',
      });
      await expect(f.fence.collectEvidence()).rejects.toMatchObject({
        code: 'PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED',
      });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

it('collects complete native module trace framing and rejects subsequent tampering', async () => {
  const f = await fixture();
  try {
    await writeFile(f.path, f.header + '\n');
    const evidence = await f.fence.collectEvidence();
    expect(evidence).toMatchObject({
      protocol: NATIVE_MODULE_FENCE_PROTOCOL,
      processes: 1,
      loadedModules: 0,
    });
    await writeFile(
      f.path,
      f.header + '\n{"kind":"violation","code":"PORTAL_NATIVE_MODULE_UNBOUND"}\n',
    );
    await expect(f.fence.collectEvidence()).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_MODULE_UNBOUND',
    });
    await writeFile(
      f.path,
      f.header.replace(f.fence.environment.SFP_NATIVE_MODULE_POLICY_HASH!, 'sha256:forged') + '\n',
    );
    await expect(f.fence.collectEvidence()).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_MODULE_EVIDENCE_REQUIRED',
    });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('rejects a partial trace after its actual owned producer has closed without replaying or skipping the record', async () => {
  const f = await fixture();
  const producer = join(f.root, 'producer.cjs');
  await writeFile(
    producer,
    'require(\'node:fs\').writeFileSync(process.argv[2],process.argv[3]+\'\\n{"kind":"module"\');process.send({partial:true});setInterval(()=>{},1000);',
  );
  const options: ForkOptions & { windowsHide: boolean } = {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  };
  const child = fork(producer, [f.path, f.header], options);
  try {
    await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
    const closed = once(child, 'close');
    child.kill();
    await closed;
    await expect(f.fence.collectEvidence(false)).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED',
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    await rm(f.root, { recursive: true, force: true });
  }
});
