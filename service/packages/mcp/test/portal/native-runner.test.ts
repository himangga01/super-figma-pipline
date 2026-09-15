import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storedChecksum } from '@sfp/ir';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import {
  NativePortalRunner,
  NativeProfileSchema,
  nativeExecutableHash,
  type NativeProfile,
} from '../../src/portal/native-runner.js';

const roots: string[] = [];
const runners: NativePortalRunner[] = [];
let executableHash: `sha256:${string}`;
beforeAll(async () => {
  executableHash = await nativeExecutableHash(process.execPath);
});
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
