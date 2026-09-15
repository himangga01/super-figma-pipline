import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { windowsDirectoryLeaseInvocation } from '../../src/fs/atomic-file.js';
import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import {
  NativePortalRunner,
  NativeProfileSchema,
  nativeExecutableHash,
} from '../../src/portal/native-runner.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
it('refuses altered PowerShell lease scripts, flags and executables before child launch', async () => {
  for (const variant of ['script', 'flags', 'executable']) {
    const f = await portalFixture();
    cleanups.push(f.cleanup);
    const runner = new NativePortalRunner();
    cleanups.unshift(() => runner.close());
    const invocation = windowsDirectoryLeaseInvocation();
    const args = [...invocation.args];
    if (variant === 'script')
      args[4] = Buffer.from("Write-Output 'must not execute'", 'utf16le').toString('base64');
    if (variant === 'flags') args[0] = '-NoExit';
    const executable =
      variant === 'executable'
        ? join(process.env.SystemRoot!, 'System32', 'cmd.exe')
        : invocation.executable;
    const source = `require('node:child_process').spawn(${JSON.stringify(executable)},${JSON.stringify(args)},{stdio:['pipe','pipe','pipe'],windowsHide:true});`;
    await writeFile(join(f.workspaceRoot, 'check.cjs'), source);
    const profile = NativeProfileSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'lease-negative',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: storedChecksum(source),
      closure: [{ path: 'check.cjs', hash: storedChecksum(source) }],
      environment: {},
      commands: [
        {
          id: 'check',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['check.cjs'],
          timeoutMs: 5000,
        },
        {
          id: 'preview',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['-e', 'void 0'],
          timeoutMs: 5000,
          preview: {
            protocol: 'sfp-owned-preview-v1',
            spec: {
              root: '.',
              baseUrl: 'http://127.0.0.1:1234',
              screens: [
                {
                  id: 'one',
                  path: '/',
                  oraclePath: 'one.png',
                  oracleHash: storedChecksum('one'),
                  viewport: { width: 100, height: 100 },
                },
              ],
            },
          },
        },
      ],
    });
    profile.artifactAuthority = await prepareNativeArtifactAuthority(profile);
    await expect(
      runner.execute(
        'run',
        profile,
        f.workspaceRoot,
        profile.sourceHash,
        new AbortController().signal,
        Date.now() + 30000,
      ),
    ).rejects.toMatchObject({
      code:
        variant === 'executable'
          ? 'PORTAL_NATIVE_MODULE_CHILD_UNBOUND'
          : 'PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED',
    });
  }
}, 60000);
