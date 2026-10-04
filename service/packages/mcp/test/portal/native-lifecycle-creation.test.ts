/* eslint-disable vitest/no-conditional-expect -- each real interruption boundary requires its own durable filesystem outcome */
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { contentHash } from '@sfp/ir';
import { build } from 'tsdown';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { NativeDirectoryCreationBoundary } from '../../src/portal/native-directory-creation.js';
import {
  NativeAttemptSchema,
  NativeEnvironmentLifecycle,
} from '../../src/portal/native-lifecycle.js';
import {
  expandNativeEnvironment,
  prepareNativeEnvironment,
} from '../../src/portal/native-resources.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
let worker: string;
beforeAll(async () => {
  if (process.platform !== 'win32') return;
  const folder = resolve('packages/mcp/.cache/lifecycle-creation-worker');
  await mkdir(folder, { recursive: true });
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    `
    import {readFile} from 'node:fs/promises';
    import {NativeEnvironmentLifecycle} from ${JSON.stringify(resolve('packages/mcp/src/portal/native-lifecycle.ts'))};
    import {PortalStore} from ${JSON.stringify(resolve('packages/mcp/src/portal/store.ts'))};
    import {fixturePermissions} from ${JSON.stringify(resolve('packages/mcp/test/portal/fixtures.ts'))};
    const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const permissions = fixturePermissions(value.stateRoot);
    const store = new PortalStore(value.stateRoot, Buffer.from(value.key, 'hex'), permissions);
    const manager = new NativeEnvironmentLifecycle(store, value.stateRoot, permissions,
      'interrupted-child', {[value.boundary]: async intent => {
        if (intent.path === value.wantedPath) process.exit(83);
      }});
    await manager.acquire(value.execution, value.grant, new AbortController().signal);
    if (value.kind === 'child') await manager.ownedChild(value.execution.attemptId, 'home');
    throw Error('creation boundary was not reached');
  `,
  );
  await build({
    config: false,
    entry: [entry],
    outDir: folder,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    clean: false,
    fixedExtension: true,
    deps: { alwaysBundle: ['@sfp/ir', '@sfp/shared'] },
    logLevel: 'silent',
  });
  worker = join(folder, 'entry.mjs');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const fixture = async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const grant = await prepareNativeEnvironment(
    {
      ownerId: 'actor',
      planId: 'plan',
      native: { id: 'creation', sourceHash: contentHash('source', 'test'), environment: {} },
    },
    f.stateRoot,
  );
  const execution = (id: string) =>
    expandNativeEnvironment(grant, {
      operationId: id,
      runId: id,
      target: 'candidate',
      profileHash: contentHash('profile', 'test'),
      repositoryHash: contentHash('repo', 'test'),
      repositoryKey: 'portal:repo:test',
    });
  const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
  return { ...f, grant, execution, manager };
};
it.runIf(process.platform === 'win32')(
  'preserves a foreign creation collision without blocking unrelated environment admission',
  async () => {
    const f = await fixture(),
      one = f.execution('foreign');
    await mkdir(one.directory);
    await writeFile(join(one.directory, 'foreign.txt'), 'user bytes');
    await expect(
      f.manager.acquire(one, f.grant, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'PORTAL_DIRECTORY_CREATION_CONFLICT',
    });
    expect(await readFile(join(one.directory, 'foreign.txt'), 'utf8')).toBe('user bytes');
    const next = await f.manager.acquire(
      f.execution('unrelated'),
      f.grant,
      new AbortController().signal,
    );
    expect(next.state).toBe('ready');
    await f.manager.finish(next.execution.attemptId);
  },
  30000,
);
const boundaries: NativeDirectoryCreationBoundary[] = [
  'afterIntentPersist',
  'afterMkdir',
  'afterIdentityPersist',
  'afterPublish',
  'afterPublishedPersist',
];
it.runIf(process.platform === 'win32')(
  'does not reconcile a live process whose creation is paused',
  async () => {
    const f = await fixture(),
      execution = f.execution('live-creation');
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolveReached => {
      entered = resolveReached;
    });
    const wait = new Promise<void>(resolveWait => {
      release = resolveWait;
    });
    const manager = new NativeEnvironmentLifecycle(
      f.store,
      f.stateRoot,
      f.permissions,
      'live-creator',
      {
        afterIntentPersist: async () => {
          entered();
          await wait;
        },
      },
    );
    const acquiring = manager.acquire(execution, f.grant, new AbortController().signal);
    await reached;
    try {
      const record = await f.manager.inspect(execution.attemptId, 'actor');
      await expect(
        f.manager.reconcile(
          execution.attemptId,
          'actor',
          contentHash('sfp-native-lifecycle-receipt-v1', record),
        ),
      ).rejects.toMatchObject({
        code: 'PORTAL_ENVIRONMENT_EXECUTION_ACTIVE',
      });
      expect((await f.manager.inspect(execution.attemptId, 'actor')).state).toBe('creating');
    } finally {
      release();
    }
    expect((await acquiring).state).toBe('ready');
    await manager.finish(execution.attemptId);
  },
);
it.runIf(process.platform === 'win32')(
  'verifies a retained version-1 attempt with no new directory-creation fields',
  async () => {
    const f = await fixture(),
      execution = f.execution('historical');
    await f.manager.acquire(execution, f.grant, new AbortController().signal);
    await f.store.update(
      'environment-attempts',
      execution.attemptId,
      NativeAttemptSchema,
      value => {
        delete value.directoryCreations;
        delete value.provisioningStarted;
        return value;
      },
    );
    const receipt = await f.manager.finish(execution.attemptId);
    expect(receipt.directoryCreations).toBeUndefined();
    await new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions).verifyReceipt(
      execution.attemptId,
      'actor',
      contentHash('sfp-native-lifecycle-receipt-v1', receipt),
    );
  },
);
it
  .runIf(process.platform === 'win32')
  .each(['root', 'child'].flatMap(kind => boundaries.map(boundary => ({ kind, boundary }))))(
  'reconciles real child interruption: $kind / $boundary',
  async ({ kind, boundary }) => {
    const f = await fixture(),
      execution = f.execution(`crash-${kind}-${boundary}`);
    const config = join(f.workspaceRoot, 'worker.json');
    const wantedPath = kind === 'root' ? execution.directory : join(execution.directory, 'home');
    await writeFile(
      config,
      JSON.stringify({
        stateRoot: f.stateRoot,
        key: f.key.toString('hex'),
        grant: f.grant,
        execution,
        kind,
        boundary,
        wantedPath,
      }),
    );
    const child = spawn(process.execPath, [worker, config], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '';
    child.stdout.on('data', chunk => {
      diagnostic += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      diagnostic += chunk.toString();
    });
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('creation child timed out'));
      }, 15000);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', code => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
    expect({ exit, diagnostic }).toMatchObject({ exit: 83 });
    const record = await f.manager.inspect(execution.attemptId, 'actor');
    const intent = record.directoryCreations!.find(row => row.path === wantedPath)!;
    expect(intent).toBeDefined();
    if (boundary === 'afterIntentPersist') {
      await expect(lstat(intent.stagingPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(intent.path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const recovery = f.manager.reconcile(
      execution.attemptId,
      'actor',
      contentHash('sfp-native-lifecycle-receipt-v1', record),
    );
    if (boundary === 'afterMkdir') {
      await expect(recovery).rejects.toMatchObject({
        code: 'PORTAL_DIRECTORY_CREATION_QUARANTINED',
        recoveryPath: intent.stagingPath,
      });
      expect((await lstat(intent.stagingPath)).isDirectory()).toBe(true);
      await expect(lstat(intent.path)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const receipt = await recovery;
      expect(receipt.state).toBe('released');
      expect(receipt.directoryCreations!.find(row => row.path === wantedPath)?.phase).toBe(
        'published',
      );
      await f.manager.verifyReceipt(
        execution.attemptId,
        'actor',
        contentHash('sfp-native-lifecycle-receipt-v1', receipt),
      );
    }
    const next = await f.manager.acquire(
      f.execution(`next-${kind}-${boundary}`),
      f.grant,
      new AbortController().signal,
    );
    expect(next.state).toBe('ready');
    await f.manager.finish(next.execution.attemptId);
  },
  30000,
);
it.runIf(process.platform === 'win32')(
  'does not poison unrelated admission when creation identity persistence is interrupted',
  async () => {
    const f = await fixture(),
      one = f.execution('identity-gap'),
      update = f.store.update.bind(f.store);
    const interruption = vi
      .spyOn(f.store, 'update')
      .mockImplementation((kind, id, schema, change) =>
        update(kind, id, schema, async value => {
          const next = await change(value);
          if (
            kind === 'environment-attempts' &&
            id === one.attemptId &&
            (next as { directoryIdentity?: string }).directoryIdentity
          )
            throw Error('identity-persistence-interrupted');
          return next;
        }),
      );
    await expect(f.manager.acquire(one, f.grant, new AbortController().signal)).rejects.toThrow(
      'identity-persistence-interrupted',
    );
    interruption.mockRestore();
    const next = await f.manager.acquire(
      f.execution('after-interruption'),
      f.grant,
      new AbortController().signal,
    );
    expect(next.state).toBe('ready');
    await f.manager.finish(next.execution.attemptId);
  },
  30000,
);
