import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import {
  NativePortalRunner,
  NativeProfileSchema,
  nativeExecutableHash,
  issuedNativeRunBinding,
  type NativeProfile,
} from '../../src/portal/native-runner.js';

const roots: string[] = [];
const runners: NativePortalRunner[] = [];
let executableHash: `sha256:${string}`;
beforeAll(async () => {
  executableHash = await nativeExecutableHash(process.execPath);
});

it('binds actual native producer results and rejects copied, changed or mismatched preparation proof', async () => {
  const value = await fixture('console.log("owned producer finished");');
  const result = await value.run();
  const binding = issuedNativeRunBinding(result, value.profile, value.root, 'test-run');
  expect(binding).toMatchObject({ runId: 'test-run', sourceHash: value.profile.sourceHash });
  expect(issuedNativeRunBinding({ ...result }, value.profile, value.root, 'test-run')).toBeNull();
  expect(issuedNativeRunBinding(result, value.profile, value.root, 'other-run')).toBeNull();
  expect(
    issuedNativeRunBinding(result, value.profile, join(value.root, 'other'), 'test-run'),
  ).toBeNull();
  result.commands[0]!.output = 'fabricated compiler output';
  expect(issuedNativeRunBinding(result, value.profile, value.root, 'test-run')).toBeNull();
});
it.each(['deadline', 'final-guard'])(
  'retains failed child diagnostics without final native authority after later %s failure %#',
  async mode => {
    const value = await fixture('console.error("private-child-canary");process.exitCode=9;');
    value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
    const deadlineAt = Date.now() + 60000,
      controller = new AbortController(),
      progress: unknown[] = [];
    const remove = value.runner.observeCommandDiagnostics(
      {
        runId: 'test-run',
        profileHash: contentHash('sfp-native-profile-v1', value.profile),
        deadlineAt,
      },
      async item => {
        progress.push(item);
        expect(Object.isFrozen(item)).toBe(true);
        if (item.phase === 'module-evidence-collected') {
          if (mode === 'deadline')
            controller.abort(
              Object.assign(Error('PORTAL_BUDGET_EXHAUSTED'), { code: 'PORTAL_BUDGET_EXHAUSTED' }),
            );
          else await writeFile(join(value.root, 'check.mjs'), 'export const changed=true;');
        }
      },
    );
    try {
      await expect(
        value.runner.execute(
          'test-run',
          value.profile,
          value.root,
          value.profile.sourceHash,
          controller.signal,
          deadlineAt,
        ),
      ).rejects.toMatchObject({
        code: mode === 'deadline' ? 'ABORT_ERR' : 'PORTAL_PROFILE_CLOSURE_CHANGED',
      });
      expect(progress).toHaveLength(2);
      expect(progress[0]).toMatchObject({
        phase: 'command-returned',
        status: 'failed',
        exitCode: 9,
        nativeCompletion: false,
        moduleEvidenceHash: null,
      });
      expect(progress[1]).toMatchObject({
        phase: 'module-evidence-collected',
        status: 'failed',
        exitCode: 9,
        nativeCompletion: false,
        moduleEvidenceHash: expect.stringMatching(/^sha256:/u),
      });
      expect(JSON.stringify(progress)).not.toContain('private-child-canary');
      expect(
        issuedNativeRunBinding(progress[0] as any, value.profile, value.root, 'test-run'),
      ).toBeNull();
    } finally {
      remove();
    }
  },
  60000,
);
it.each(['foreign-run', 'foreign-profile', 'foreign-deadline', 'throwing'])(
  'binds closed command observer and preserves actual producer result for %s %#',
  async mode => {
    const value = await fixture('console.log("owned actual command");');
    value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
    const deadlineAt = Date.now() + 60000,
      observe = vi.fn<() => Promise<void>>(async () => {
        if (mode === 'throwing') throw Error('private-observer-canary');
      });
    const remove = value.runner.observeCommandDiagnostics(
      {
        runId: mode === 'foreign-run' ? 'foreign-run' : 'test-run',
        profileHash:
          mode === 'foreign-profile'
            ? storedChecksum('foreign')
            : contentHash('sfp-native-profile-v1', value.profile),
        deadlineAt: mode === 'foreign-deadline' ? deadlineAt + 1 : deadlineAt,
      },
      observe,
    );
    try {
      const result = await value.runner.execute(
        'test-run',
        value.profile,
        value.root,
        value.profile.sourceHash,
        new AbortController().signal,
        deadlineAt,
      );
      expect(result.commands[0]!.status).toBe('passed');
      expect(issuedNativeRunBinding(result, value.profile, value.root, 'test-run')).not.toBeNull();
      expect(observe).toHaveBeenCalledTimes(mode === 'throwing' ? 2 : 0);
    } finally {
      remove();
    }
  },
  60000,
);
it.each(['live-after-timeout', 'retired-after-timeout', 'aborted', 'retired-before-start'])(
  'bounds held diagnostic wait and keeps late %s work non-authoritative %#',
  async mode => {
    const value = await fixture('console.log("no child is dispatched by this diagnostic seam");');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const controller = new AbortController(),
      deadlineAt = Date.now() + 60000,
      rows: unknown[] = [];
    let release!: () => void,
      entered = false,
      physicallySettled = false;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const observe = vi.fn<(item: any, scope: { isCurrent: () => boolean }) => Promise<void>>(
      async (item, scope) => {
        entered = true;
        await gate;
        physicallySettled = true;
        if (scope.isCurrent()) rows.push(item);
      },
    );
    const remove = value.runner.observeCommandDiagnostics(
      {
        runId: 'diagnostic-only',
        profileHash: contentHash('sfp-native-profile-v1', value.profile),
        deadlineAt,
      },
      observe,
    );
    const result = {
      commandId: 'react-router-compiler',
      status: 'failed',
      exitCode: 1,
      durationMs: 10,
      cleanup: 'finished',
      output: 'private-sink-canary',
      commandHash: storedChecksum('command'),
    };
    const task = (value.runner as any).reportCommand(
      'diagnostic-only',
      value.profile,
      result,
      deadlineAt,
      controller.signal,
      'command-returned',
    );
    try {
      if (mode === 'retired-before-start') {
        remove();
        controller.abort();
      }
      await Promise.resolve();
      await Promise.resolve();
      if (mode === 'aborted') controller.abort();
      else await vi.advanceTimersByTimeAsync(2000);
      await task;
      expect(physicallySettled).toBe(false);
      expect(entered).toBe(mode !== 'retired-before-start');
      if (mode === 'retired-after-timeout') remove();
      release();
      await Promise.resolve();
      await Promise.resolve();
      expect(rows).toHaveLength(mode === 'live-after-timeout' ? 1 : 0);
      expect(
        rows.map(row => ({
          nativeCompletion: (row as any).nativeCompletion,
          status: (row as any).status,
        })),
      ).toEqual(
        mode === 'live-after-timeout' ? [{ nativeCompletion: false, status: 'failed' }] : [],
      );
      expect(
        issuedNativeRunBinding(
          (rows[0] ?? {}) as any,
          value.profile,
          value.root,
          'diagnostic-only',
        ),
      ).toBeNull();
      expect(JSON.stringify(rows)).not.toContain('private-sink-canary');
    } finally {
      release();
      remove();
      vi.useRealTimers();
    }
  },
  60000,
);
it('retains ordinary profile checks and final authority even with compiler-like command names', async () => {
  const value = await fixture('console.log("ordinary native profile");');
  value.profile.commands[0]!.id = 'compiler-dependencies';
  value.profile.commands.push({ ...value.profile.commands[0]!, id: 'react-router-compiler' });
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  const artifacts = await import('../../src/portal/native-artifacts.js'),
    fences = await import('../../src/portal/native-module-fence.js');
  const verify = vi.spyOn(artifacts, 'verifyNativeArtifactAuthority'),
    original = fences.createNativeModuleFence;
  let second = false,
    callsAtSecond = 0;
  vi.spyOn(fences, 'createNativeModuleFence').mockImplementation(async (...args) => {
    if (args[1].id === 'react-router-compiler') {
      second = true;
      callsAtSecond = verify.mock.calls.length;
    }
    return original(...args);
  });
  try {
    const result = await value.runner.execute(
      'ordinary-run',
      value.profile,
      value.root,
      value.profile.sourceHash,
      new AbortController().signal,
      Date.now() + 60000,
    );
    expect(second).toBe(true);
    expect(callsAtSecond).toBe(3);
    expect(verify).toHaveBeenCalledTimes(4);
    expect(result.commands.map(v => v.status)).toEqual(['passed', 'passed']);
    expect(
      issuedNativeRunBinding(result, value.profile, value.root, 'ordinary-run'),
    ).not.toBeNull();
  } finally {
    vi.restoreAllMocks();
  }
}, 60000);
it('admits explicit nested generated descendants in one self-contained provisioned workspace', async () => {
  const value = await fixture(
    'import{mkdirSync,writeFileSync}from"node:fs";mkdirSync("workspace/app",{recursive:true});writeFileSync("workspace/app/source.js","export const input = true;");',
  );
  const compile =
    'import{mkdirSync,writeFileSync}from"node:fs";mkdirSync("workspace/app/build",{recursive:true});writeFileSync("workspace/app/build/index.js","export const output = true;");';
  await writeFile(join(value.root, 'compile.mjs'), compile);
  value.profile.closure.push({ path: 'compile.mjs', hash: storedChecksum(compile) });
  value.profile.commands[0]!.produces = [{ path: 'workspace', kind: 'provisioned-dependencies' }];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'compile',
    args: ['compile.mjs'],
    produces: [{ path: 'workspace/app/build', kind: 'generated-output' }],
  });
  const result = await value.run();
  expect(result.commands.map(c => c.status)).toEqual(['passed', 'passed']);
  expect(result.outputReceipts[0]).toMatchObject({
    path: 'workspace',
    generatedChildren: ['app/build'],
  });
  expect(await readFile(join(value.root, 'workspace/app/source.js'), 'utf8')).toBe(
    'export const input = true;',
  );
}, 60_000);

it('rejects nested generated outputs below a foreign junction before any compiler command', async () => {
  const foreign = await mkdtemp(join(tmpdir(), 'sfp-foreign-output-'));
  roots.push(foreign);
  const value = await fixture(
    'import{mkdirSync,symlinkSync}from"node:fs";mkdirSync("workspace");symlinkSync(process.argv[2],"workspace/app","junction");',
  );
  value.profile.commands[0]!.args.push(foreign);
  value.profile.commands[0]!.produces = [{ path: 'workspace', kind: 'provisioned-dependencies' }];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'compile',
    args: ['-e', 'require("fs").writeFileSync("unexpected","yes")'],
    produces: [{ path: 'workspace/app/build', kind: 'generated-output' }],
  });
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_ARTIFACT_LINK_OUTSIDE_ROOT' });
  await expect(readFile(join(foreign, 'build'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(value.root, 'unexpected'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 60000);
it('rejects excessively deep nested output and leaves its provisioner unexecuted', async () => {
  const value = await fixture('throw Error("must not execute");');
  value.profile.commands[0]!.produces = [{ path: 'workspace', kind: 'provisioned-dependencies' }];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'compile',
    produces: [{ path: 'workspace/a/b/c/d/build', kind: 'generated-output' }],
  });
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_OUTPUT_OVERLAPS_INPUT' });
  await expect(readFile(join(value.root, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['workspace/app/../build', 'workspace/app//build', 'workspace/app/./build'])(
  'rejects malformed nested output exclusion %#',
  path => {
    expect(() =>
      NativeProfileSchema.parse({
        schemaVersion: 1,
        id: 'bad-output',
        executionMode: 'native-working-copy',
        environmentKind: 'disposable-test',
        sourceHash: storedChecksum('source'),
        closure: [{ path: 'check.mjs', hash: storedChecksum('source') }],
        environment: {},
        commands: [
          {
            id: 'check',
            executable: process.execPath,
            executableHash,
            args: ['check.mjs'],
            timeoutMs: 1000,
            produces: [{ path, kind: 'generated-output' }],
          },
        ],
      }),
    ).toThrow(/path/u);
  },
);
afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.close()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async (source: string) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-native-runner-'));
  roots.push(root);
  await writeFile(join(root, 'check.mjs'), source);
  const sourceHash = storedChecksum(source);
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'native-test',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash,
    closure: [{ path: 'check.mjs', hash: sourceHash }],
    environment: { PORTAL_TEST_SECRET: 'private-test-value' },
    commands: [
      {
        id: 'check',
        executable: process.execPath,
        executableHash,
        args: ['check.mjs'],
        timeoutMs: 5000,
      },
    ],
  });
  const runner = new NativePortalRunner();
  runners.push(runner);
  return {
    root,
    profile,
    runner,
    run: async (signal = new AbortController().signal) => {
      profile.artifactAuthority = await prepareNativeArtifactAuthority(profile);
      return runner.execute('test-run', profile, root, sourceHash, signal, Date.now() + 30_000);
    },
  };
};

it('binds the reviewed command separately from the actual guarded launch argv', async () => {
  const value = await fixture('console.log("guarded command executed");');
  const result = await value.run();
  const command = value.profile.commands[0]!;
  expect(result.commands[0]!.status).toBe('passed');
  expect(result.commands[0]!.commandHash).toBe(contentHash('sfp-native-command-v1', command));
  expect(result.commands[0]!.launchCommandHash).toBe(
    contentHash('sfp-native-command-v1', {
      ...command,
      args: [
        '--require',
        join(result.commands[0]!.moduleEvidence!.directory, 'preload.cjs'),
        ...command.args,
      ],
    }),
  );
  expect(result.commands[0]!.launchCommandHash).not.toBe(result.commands[0]!.commandHash);
});

it('executes a native profile with filtered environment and explicit isolation limits', async () => {
  const value = await fixture(
    'console.log(process.env.PORTAL_TEST_SECRET); console.log("inherited=" + (process.env.PORTAL_PARENT_SECRET || "absent"));',
  );
  process.env.PORTAL_PARENT_SECRET = 'never-inherit-this';
  try {
    const result = await value.run();
    expect(result.executionMode).toBe('native-working-copy');
    expect(result.isolation).toBe('local-owner-account-no-os-sandbox');
    expect(result.commands[0]?.status).toBe('passed');
    expect(result.commands[0]?.output).toContain('inherited=absent');
    expect(result.commands[0]?.output).not.toContain('private-test-value');
  } finally {
    delete process.env.PORTAL_PARENT_SECRET;
  }
});
it.runIf(process.platform === 'win32')(
  'provides existing Windows known folders beneath the owned private USERPROFILE',
  async () => {
    const value = await fixture(`
      import {statSync} from 'node:fs';
      import {join} from 'node:path';
      const local = join(process.env.USERPROFILE, 'AppData', 'Local');
      const roaming = join(process.env.USERPROFILE, 'AppData', 'Roaming');
      if (!statSync(local).isDirectory() || !statSync(roaming).isDirectory())
        throw Error('Windows known folders are missing');
      if (process.env.LOCALAPPDATA !== local || process.env.APPDATA !== roaming)
        throw Error('Windows known folders do not match the private home');
      console.log('owned Windows known folders ready');
    `);
    const result = await value.run();
    expect(result.commands[0]?.status).toBe('passed');
    expect(result.commands[0]?.output).toContain('owned Windows known folders ready');
  },
);
it('refuses a changed script before it can execute', async () => {
  const value = await fixture('console.log("reviewed");');
  await writeFile(join(value.root, 'check.mjs'), 'throw Error("unreviewed script ran");');
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_PROFILE_CLOSURE_CHANGED' });
});
it('invalidates success if a command changes its reviewed script closure', async () => {
  const value = await fixture(
    'import {writeFileSync} from "node:fs"; writeFileSync("check.mjs", "console.log(123)");',
  );
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_PROFILE_CLOSURE_CHANGED' });
});
it('refuses a changed executable and does not continue after a failed check', async () => {
  const value = await fixture('process.exit(7);');
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'must-not-run',
    args: ['-e', 'require("fs").writeFileSync("unexpected", "yes")'],
  });
  const result = await value.run();
  expect(result.commands).toHaveLength(1);
  expect(result.commands[0]?.status).toBe('failed');
  await expect(readFile(join(value.root, 'unexpected'))).rejects.toMatchObject({ code: 'ENOENT' });
  const changed = await fixture('process.exit(7);');
  changed.profile.commands[0]!.executableHash = `sha256:${'0'.repeat(64)}`;
  await expect(changed.run()).rejects.toMatchObject({ code: 'PORTAL_EXECUTABLE_CHANGED' });
});
it('terminates the owned native process on timeout', async () => {
  const value = await fixture('setInterval(() => {}, 1000);');
  value.profile.commands[0]!.timeoutMs = 100;
  const result = await value.run();
  expect(result.commands[0]?.status).toBe('timed-out');
  expect(result.commands[0]?.cleanup).toBe('tree-termination-requested');
});
it('supports owner cancellation while a native step is active', async () => {
  const value = await fixture(
    'import {writeFileSync} from "node:fs"; writeFileSync("started", "ready"); setInterval(() => {}, 1000);',
  );
  value.profile.commands[0]!.produces = [{ path: 'started', kind: 'generated-output' }];
  const running = value.run();
  await vi.waitFor(
    async () => {
      expect(await readFile(join(value.root, 'started'), 'utf8')).toBe('ready');
    },
    { timeout: 4500, interval: 25 },
  );
  await value.runner.cancel('test-run');
  expect((await running).commands[0]?.status).toBe('cancelled');
});
it('finishes when a root exits while a descendant holds inherited output pipes', async () => {
  // spawn-hygiene-exempt: workload fixture that models user code whose descendant keeps inherited
  // output pipes open; the runner starts the root with windowsHide.
  const value = await fixture(
    'import {spawn} from "node:child_process"; const child=spawn(process.execPath,["-e", "setInterval(()=>{},1000)"],{stdio:"inherit"}); child.unref(); console.log("root finished");',
  );
  const result = await value.run();
  expect(result.commands[0]?.status).toBe('passed');
  expect(result.commands[0]?.output).toContain('root finished');
  expect(result.commands[0]?.durationMs).toBeLessThan(5000);
});
it('preserves empty, quoted, Unicode and trailing-backslash arguments through the native broker', async () => {
  const value = await fixture('console.log(JSON.stringify(process.argv.slice(2)));');
  const args = ['', 'a"b', 'space value', 'ends\\', '한국어', '<&>'];
  value.profile.commands[0]!.args.push(...args);
  const result = await value.run();
  expect(result.commands[0]?.status).toBe('passed');
  expect(JSON.parse(result.commands[0]!.output.trim())).toEqual(args);
});
it('bounds noisy output and refuses Docker, implicit shells and loader injection', async () => {
  const value = await fixture('setInterval(() => console.log("x".repeat(2048)), 1);');
  value.profile.commands[0]!.maxOutputBytes = 1024;
  const result = await value.run();
  expect(result.commands[0]?.status).toBe('output-limit');
  expect(Buffer.byteLength(result.commands[0]!.output)).toBeLessThanOrEqual(1024);
  for (const executable of ['docker.exe', 'podman.exe', 'wsl.exe', 'cmd.exe', 'powershell.exe']) {
    const profile: NativeProfile = {
      ...value.profile,
      commands: [{ ...value.profile.commands[0]!, executable: join(value.root, executable) }],
    };
    expect(NativeProfileSchema.safeParse(profile).success).toBe(false);
  }
  expect(
    NativeProfileSchema.safeParse({
      ...value.profile,
      environment: { NODE_OPTIONS: '--require ./unreviewed.js' },
    }).success,
  ).toBe(false);
});
it('refuses legacy and future native authority before launching a command', async () => {
  const value = await fixture('throw new Error("must not execute");');
  delete value.profile.sourceAuthorityVersion;
  expect(NativeProfileSchema.parse(value.profile).sourceAuthorityVersion).toBeUndefined();
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
  });
  value.profile.sourceAuthorityVersion = 3;
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED',
  });
});
it('rejects unexpected included source membership before the first native command', async () => {
  const value = await fixture('console.log("must not launch");');
  await writeFile(join(value.root, 'unexpected.graphql'), 'type Query { extra: Boolean }');
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED',
  });
});

it.each(['sprite.svg', 'types.ts', 'foreign.svg'])(
  'denies caller-declared deep icon output without genuine compiler capability %# %s',
  async leaf => {
    const value = await fixture(
      'import{writeFileSync}from"node:fs";writeFileSync("provisioner-started","UNREVIEWED");',
    );
    value.profile.commands[0]!.produces = [
      { path: 'compiler-workspace', kind: 'provisioned-dependencies' },
    ];
    value.profile.commands.push({
      ...value.profile.commands[0]!,
      id: 'claimed-compiler',
      produces: [
        {
          path: 'compiler-workspace/source/app/components/ui/icons/' + leaf,
          kind: 'generated-output',
        },
      ],
    });
    await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_OUTPUT_OVERLAPS_INPUT' });
    await expect(readFile(join(value.root, 'provisioner-started'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);
