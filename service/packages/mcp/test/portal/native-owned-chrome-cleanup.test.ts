import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import {
  NATIVE_MODULE_FENCE_PROTOCOL,
  NATIVE_MODULE_FENCE_SOURCE,
} from '../../src/portal/native-module-fence-source.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const part = relative(tmpdir(), root);
    if (
      isAbsolute(part) ||
      part.startsWith(`..${sep}`) ||
      !part.startsWith('sfp-owned-chrome-cleanup-')
    )
      throw new Error('cleanup containment failed');
    await rm(root, { recursive: true, force: true });
  }
});

// Mock only the OS child transport. The real preload admits/rejects and transforms each call.
// No fake browser or taskkill executable is ever run by these policy boundary tests.
const fixture = async (body: string, capability = true) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-owned-chrome-cleanup-'));
  roots.push(root);
  const chrome = join(root, 'chrome.exe');
  const taskkill = join(root, 'taskkill.exe');
  const entry = join(root, 'entry.cjs');
  const mock = join(root, 'transport.cjs');
  const preload = join(root, 'preload.cjs');
  const transport = join(root, 'calls.jsonl');
  await writeFile(chrome, 'owned Chrome fixture');
  await writeFile(taskkill, 'taskkill fixture');
  await writeFile(
    entry,
    body
      .replaceAll('CHROME', JSON.stringify(chrome))
      .replaceAll('TASKKILL', JSON.stringify(taskkill)),
  );
  await writeFile(
    mock,
    `const cp=require('node:child_process'),fs=require('node:fs');const record=(kind,args)=>fs.appendFileSync(${JSON.stringify(transport)},JSON.stringify({kind,args})+'\\n');cp.spawn=function(...args){record('spawn',args);const child=new cp.ChildProcess();child.pid=4242;child.exitCode=null;child.signalCode=null;return child};cp.spawnSync=function(...args){record('spawnSync',args);return {status:0,signal:null,stdout:Buffer.from(''),stderr:Buffer.from('')}};cp.execFile=function(...args){record('execFile',args);return new cp.ChildProcess()};`,
  );
  await writeFile(preload, NATIVE_MODULE_FENCE_SOURCE);
  const observe = async (path: string) => {
    const stat = await lstat(path, { bigint: true });
    return {
      path,
      identity: `${stat.dev}:${stat.ino}`,
      hash: storedChecksum(await readFile(path)),
      bytes: Number(stat.size),
      links: String(stat.nlink),
    };
  };
  const stat = await lstat(root, { bigint: true });
  const policy = {
    protocol: NATIVE_MODULE_FENCE_PROTOCOL,
    traceRoot: root,
    preload,
    files: await Promise.all([chrome, taskkill, entry, mock, preload].map(observe)),
    directories: [{ path: root, identity: `${stat.dev}:${stat.ino}` }],
    producers: [],
    ownedChromeCleanup: capability
      ? {
          protocol: 'windows-owned-chrome-cleanup-v1',
          executable: taskkill,
          chromeExecutable: chrome,
          timeoutMs: 5000,
          maxBuffer: 65536,
        }
      : null,
  };
  const policyBytes = JSON.stringify(policy);
  const policyPath = join(root, 'policy.json');
  await writeFile(policyPath, policyBytes);
  const result = await promisify(execFile)(
    process.execPath,
    ['--require', mock, '--require', preload, entry],
    {
      windowsHide: true,
      timeout: 10000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        SFP_NATIVE_MODULE_POLICY: policyPath,
        SFP_NATIVE_MODULE_POLICY_HASH: storedChecksum(policyBytes),
      },
    },
  );
  const calls = (
    await readFile(transport, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    })
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const traceName = (await readdir(root)).find(name => name.startsWith('trace-'))!;
  const traces = (await readFile(join(root, traceName), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  return { result, calls, traces, chrome, taskkill };
};

it.runIf(process.platform === 'win32')(
  'translates only an owned alive Chrome cleanup into bounded absolute taskkill without a shell',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');const child=cp.spawn(CHROME,[],{windowsHide:true});try{const result=cp.spawnSync('taskkill /pid '+child.pid+' /T /F',{shell:true,windowsHide:true});console.log(JSON.stringify({status:result.status}))}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout.trim()).toBe('{"status":0}');
    expect(value.calls).toEqual([
      { kind: 'spawn', args: [value.chrome, [], { windowsHide: true }] },
      {
        kind: 'spawnSync',
        args: [
          value.taskkill,
          ['/pid', '4242', '/T', '/F'],
          { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 65536 },
        ],
      },
    ]);
    expect(value.traces.filter(row => row.kind === 'owned-chrome-cleanup')).toMatchObject([
      { pid: 4242, executable: value.taskkill, chromeExecutable: value.chrome },
    ]);
  },
);

it.runIf(process.platform === 'win32').each([
  ['unowned PID', `cp.spawnSync('taskkill /pid 4243 /T /F',{shell:true,windowsHide:true})`],
  [
    'arbitrary command tail',
    `cp.spawnSync('taskkill /pid 4242 /T /F & whoami',{shell:true,windowsHide:true})`,
  ],
  ['missing subtree flag', `cp.spawnSync('taskkill /pid 4242 /F',{shell:true,windowsHide:true})`],
  [
    'caller environment',
    `cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:true,env:{}})`,
  ],
  [
    'different shell',
    `cp.spawnSync('taskkill /pid 4242 /T /F',{shell:'cmd.exe',windowsHide:true})`,
  ],
  ['visible window', `cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:false})`],
  ['absolute bypass', `cp.spawnSync(TASKKILL,['/pid','4242','/T','/F'],{windowsHide:true})`],
  ['execFile bypass', `cp.execFile(TASKKILL,['/pid','4242','/T','/F'],{windowsHide:true})`],
  [
    'revoked child',
    `child.emit('exit',0);cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:true})`,
  ],
  [
    'changed child PID',
    `child.pid=4243;cp.spawnSync('taskkill /pid 4243 /T /F',{shell:true,windowsHide:true})`,
  ],
  [
    'settled child',
    `child.exitCode=0;cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:true})`,
  ],
  [
    'signalled child',
    `child.signalCode='SIGKILL';cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:true})`,
  ],
  [
    'changed binary',
    `require('node:fs').writeFileSync(TASKKILL,'edited');cp.spawnSync('taskkill /pid 4242 /T /F',{shell:true,windowsHide:true})`,
  ],
] as const)('rejects %s cleanup without invoking its OS transport', async (_label, request) => {
  const value = await fixture(
    `const cp=require('node:child_process');const child=cp.spawn(CHROME,[],{windowsHide:true});try{${request}}catch(error){console.log(error.code)}`,
  );
  expect(value.result.stdout).toMatch(/PORTAL_NATIVE_MODULE_/);
  expect(value.calls.map(row => row.kind)).toEqual(['spawn']);
  expect(value.traces.some(row => row.kind === 'violation')).toBe(true);
});

it.runIf(process.platform === 'win32')(
  'rejects the cleanup request when its owner capability is absent',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');const child=cp.spawn(CHROME,[],{windowsHide:true});try{cp.spawnSync('taskkill /pid '+child.pid+' /T /F',{shell:true,windowsHide:true})}catch(error){console.log(error.code)}`,
      false,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_RELATIVE_EXECUTABLE');
    expect(value.calls.map(row => row.kind)).toEqual(['spawn']);
  },
);

it.runIf(process.platform === 'win32')(
  'revokes an owned PID before cleanup dispatch so it cannot be replayed or reused',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');const child=cp.spawn(CHROME,[],{windowsHide:true});cp.spawnSync('taskkill /pid '+child.pid+' /T /F',{shell:true,windowsHide:true});try{cp.spawnSync('taskkill /pid '+child.pid+' /T /F',{shell:true,windowsHide:true})}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_CHROME_NOT_OWNED');
    expect(value.calls.map(row => row.kind)).toEqual(['spawn', 'spawnSync']);
  },
);

it.runIf(process.platform === 'win32')(
  'does not adopt an unrelated Node child PID as Chrome ownership',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');const child=cp.spawn(process.execPath,[],{windowsHide:true});try{cp.spawnSync('taskkill /pid '+child.pid+' /T /F',{shell:true,windowsHide:true})}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_CHROME_NOT_OWNED');
    expect(value.calls.map(row => row.kind)).toEqual(['spawn']);
  },
);

it.runIf(process.platform === 'win32')(
  'rejects generic hash-bound taskkill execution without a cleanup capability',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');try{cp.spawnSync(TASKKILL,['/pid','4242','/T','/F'],{windowsHide:true})}catch(error){console.log(error.code)}`,
      false,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    expect(value.calls).toEqual([]);
  },
);

it.runIf(process.platform === 'win32')(
  'rejects a trailing newline instead of interpreting it as a literal cleanup request',
  async () => {
    const value = await fixture(
      `const cp=require('node:child_process');const child=cp.spawn(CHROME,[],{windowsHide:true});try{cp.spawnSync('taskkill /pid 4242 /T /F\\n',{shell:true,windowsHide:true})}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    expect(value.calls.map(row => row.kind)).toEqual(['spawn']);
  },
);
