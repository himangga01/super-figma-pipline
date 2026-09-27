import { mkdir, writeFile } from 'node:fs/promises';
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
it.runIf(process.platform === 'win32')(
  'admits the exact v2 lease spawn inside the fence and leases a Korean directory',
  async () => {
    const f = await portalFixture();
    cleanups.push(f.cleanup);
    const runner = new NativePortalRunner();
    cleanups.unshift(() => runner.close());
    const leased = join(f.root, '강지혜', 'AppData', 'Local');
    await mkdir(leased, { recursive: true });
    const invocation = windowsDirectoryLeaseInvocation();
    const source = [
      "const {spawn}=require('node:child_process');",
      "const {createHash,randomUUID}=require('node:crypto');",
      `const child=spawn(${JSON.stringify(invocation.executable)},${JSON.stringify(invocation.args)},{stdio:['pipe','pipe','pipe'],windowsHide:true});`,
      `const bytes=Buffer.from(${JSON.stringify(leased)},'utf16le');`,
      "const id=randomUUID().replaceAll('-','');",
      'const fail=message=>{console.error(message);process.exit(2)};',
      "setTimeout(()=>fail('lease client timed out'),50000).unref();",
      "let buffer='',state=0;",
      "const send=value=>child.stdin.write(JSON.stringify(value)+'\\n');",
      'const accept=line=>{',
      "  if(state===0){if(line!=='READY windows-directory-lease-v2')fail('ready '+line);state=1;send({action:'acquire',id,pathUtf16B64:bytes.toString('base64')});return}",
      '  const response=JSON.parse(line);',
      "  if(state===1){if(response.ok!==true||response.pathSha256!==createHash('sha256').update(bytes).digest('hex'))fail('acquire '+line);state=2;send({action:'release',id});return}",
      "  if(state===2){if(response.ok!==true)fail('release '+line);state=3;child.stdin.end()}",
      '};',
      "child.stdout.setEncoding('utf8');",
      "child.stdout.on('data',chunk=>{buffer+=chunk;for(let index=buffer.indexOf('\\n');index>=0;index=buffer.indexOf('\\n')){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);accept(line)}});",
      "child.on('exit',code=>{if(state!==3||code!==0)fail('broker exit '+code+' in state '+state);console.log('lease ok')});",
    ].join('\n');
    await writeFile(join(f.workspaceRoot, 'check.cjs'), source);
    const profile = NativeProfileSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'lease-positive',
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
          timeoutMs: 60000,
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
    expect(profile.artifactAuthority.directoryLease?.protocol).toBe('windows-directory-lease-v2');
    // The unprepared preview step stops the run only after the fenced lease command has passed;
    // a failed lease command would instead resolve with a failed command result.
    const outcome = await runner
      .execute(
        'run',
        profile,
        f.workspaceRoot,
        profile.sourceHash,
        new AbortController().signal,
        Date.now() + 120000,
      )
      .then(
        result => ({
          commands: result.commands.map(command => [
            command.commandId,
            command.status,
            command.output,
          ]),
        }),
        (error: { code?: string }) => ({ code: error.code }),
      );
    expect(outcome).toEqual({ code: 'PORTAL_PREVIEW_PREPARATION_REQUIRED' });
  },
  180000,
);
