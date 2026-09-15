import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { promisify } from 'node:util';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it, vi } from 'vitest';

import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import {
  NATIVE_MODULE_FENCE_SOURCE,
  NATIVE_MODULE_FENCE_PROTOCOL,
} from '../../src/portal/native-module-fence-source.js';
import {
  NativePortalRunner,
  NativeProfileSchema,
  nativeExecutableHash,
} from '../../src/portal/native-runner.js';

vi.setConfig({ testTimeout: 60000 });
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const canonical = await realpath(root),
      part = relative(await realpath(tmpdir()), canonical);
    if (
      isAbsolute(part) ||
      part === '..' ||
      part.startsWith(`..${sep}`) ||
      !part.startsWith('sfp-task33-module-fence-')
    )
      throw Error('Fixture cleanup containment failed');
    await rm(canonical, { recursive: true, force: true });
  }
});
it.each(['eval', 'project-script', 'relative-external-entry', 'aliased-require', 'package-escape'])(
  'blocks changed unbound transitive code through %s',
  async mode => {
    const parent = await mkdtemp(join(tmpdir(), 'sfp-task33-module-fence-'));
    roots.push(parent);
    const root = join(parent, 'project');
    const external = join(parent, 'external');
    await mkdir(root);
    await mkdir(external);
    const dep = join(parent, 'dependency.cjs');
    await writeFile(dep, 'module.exports="before"');
    const body = `console.log(require(${JSON.stringify(dep)}))`;
    let source = 'console.log("project")';
    let args = ['-e', body];
    const externalArtifacts: { root: string; kind: 'node-package-tree' }[] = [];
    if (mode === 'project-script') {
      source = body;
      args = ['check.cjs'];
    }
    if (mode === 'relative-external-entry' || mode === 'aliased-require') {
      const entry = join(external, 'harness.cjs');
      await writeFile(
        entry,
        mode === 'aliased-require'
          ? `const load=require; console.log(load(${JSON.stringify(dep)}))`
          : body,
      );
      args = [mode === 'relative-external-entry' ? relative(root, entry) : entry];
      externalArtifacts.push({ root: external, kind: 'node-package-tree' });
    }
    if (mode === 'package-escape') {
      const entry = join(external, 'harness.cjs');
      const packageRoot = join(external, 'node_modules', 'review-pkg');
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'review-pkg', main: 'index.cjs' }),
      );
      await writeFile(
        join(packageRoot, 'index.cjs'),
        `module.exports = require(${JSON.stringify(dep)})`,
      );
      await writeFile(entry, 'console.log(require("review-pkg"))');
      args = [entry];
      externalArtifacts.push({ root: external, kind: 'node-package-tree' });
    }
    await writeFile(join(root, 'check.cjs'), source);
    const profile = NativeProfileSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'review-unbound',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: storedChecksum(source),
      closure: [{ path: 'check.cjs', hash: storedChecksum(source) }],
      environment: {},
      externalArtifacts,
      commands: [
        {
          id: 'check',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args,
          timeoutMs: 10000,
        },
      ],
    });
    profile.artifactAuthority = await prepareNativeArtifactAuthority(profile);
    await writeFile(dep, 'module.exports="CHANGED_UNBOUND_DEPENDENCY_EXECUTED"');
    const runner = new NativePortalRunner();
    try {
      await expect(
        runner.execute(
          'review-unbound',
          profile,
          root,
          profile.sourceHash,
          new AbortController().signal,
          Date.now() + 60000,
        ),
      ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_MODULE_UNBOUND' });
    } finally {
      await runner.close();
    }
  },
);

const supportedFixture = async (source: string, extra: Record<string, string> = {}) => {
  const parent = await mkdtemp(join(tmpdir(), 'sfp-task33-module-fence-'));
  roots.push(parent);
  const root = join(parent, 'project');
  await mkdir(root);
  const sources = { 'check.cjs': source, ...extra };
  for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, path), bytes);
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'module-proof',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: storedChecksum(source),
    closure: Object.entries(sources).map(([path, bytes]) => ({
      path,
      hash: storedChecksum(bytes),
    })),
    environment: {},
    commands: [
      {
        id: 'check',
        executable: process.execPath,
        executableHash: await nativeExecutableHash(process.execPath),
        args: ['check.cjs'],
        timeoutMs: 20000,
      },
    ],
  });
  return {
    parent,
    root,
    profile,
    run: async () => {
      profile.artifactAuthority = await prepareNativeArtifactAuthority(profile);
      const runner = new NativePortalRunner();
      try {
        return await runner.execute(
          'module-proof',
          profile,
          root,
          profile.sourceHash,
          new AbortController().signal,
          Date.now() + 60000,
        );
      } finally {
        await runner.close();
      }
    },
  };
};
it('retains producer-bound module bytes consumed and deleted during the same command', async () => {
  const source =
    'const fs=require("node:fs");const path=require("node:path");(async()=>{fs.mkdirSync("generated");fs.writeFileSync("generated/temporary.cjs","module.exports=42");if(require("./generated/temporary.cjs")!==42)process.exit(1);fs.unlinkSync("generated/temporary.cjs")})();';
  const value = await supportedFixture(source);
  value.profile.commands[0]!.produces = [{ path: 'generated', kind: 'generated-output' }];
  const result = await value.run(),
    evidence = result.commands[0]!.moduleEvidence!;
  expect(evidence.generatedModules).toHaveLength(1);
  const generated = evidence.generatedModules[0]!;
  expect(generated.producerPath).toBe('generated');
  expect(generated.hash).toBe(storedChecksum('module.exports=42'));
  expect(await readFile(generated.retained, 'utf8')).toBe('module.exports=42');
  await expect(readFile(join(value.root, 'generated/temporary.cjs'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(result.outputReceipts[0]!.inventory.files).toBe(0);
});
it('propagates consumed module authority into ordinary Node children and workers', async () => {
  const source =
    'const {spawnSync}=require("node:child_process");const {Worker}=require("node:worker_threads");const path=require("node:path");const child=spawnSync(process.execPath,["child.cjs"],{encoding:"utf8"});if(child.status!==0)throw Error(child.stderr);const worker=new Worker(path.resolve("worker.cjs"));worker.on("message",value=>{if(value!==42)throw Error("worker value")});worker.on("error",error=>{throw error});';
  const value = await supportedFixture(source, {
    'dependency.cjs': 'module.exports=42',
    'child.cjs': 'if(require("./dependency.cjs")!==42)process.exit(1)',
    'worker.cjs':
      'require("node:worker_threads").parentPort.postMessage(require("./dependency.cjs"))',
  });
  const result = await value.run();
  expect(result.commands[0]!.status).toBe('passed');
  expect(result.commands[0]!.moduleEvidence!.processes).toBe(3);
  expect(result.commands[0]!.moduleEvidence!.loadedModules).toBeGreaterThanOrEqual(5);
});
it('rejects an unbound module in a child even when its parent ignores the child failure', async () => {
  const value = await supportedFixture(
    'require("node:child_process").spawnSync(process.execPath,["child.cjs"]);',
    { 'child.cjs': 'require("../outside.cjs")' },
  );
  await writeFile(join(value.parent, 'outside.cjs'), 'console.log("unbound child executed")');
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_NATIVE_MODULE_UNBOUND' });
});
it('rejects custom runtime hook registration even when the program catches the error', async () => {
  const value = await supportedFixture(
    'try {require("node:module").registerHooks({resolve(){throw Error("custom loader")}})}catch{}',
  );
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED',
  });
});

it.each(['spawn', 'fork', 'worker'] as const)(
  'preserves module evidence when %s replaces environment or execArgv defaults',
  async mode => {
    const source =
      mode === 'spawn'
        ? 'const child=require("node:child_process").spawnSync(process.execPath,["child.cjs"],{env:{},encoding:"utf8"});if(child.status!==0)throw Error(child.stderr);'
        : mode === 'fork'
          ? 'const child=require("node:child_process").fork("child.cjs",[],{env:{},execArgv:[],silent:true});child.on("exit",code=>{if(code!==0)process.exit(1)});'
          : 'const worker=new (require("node:worker_threads").Worker)(require("node:path").resolve("child.cjs"),{env:{},execArgv:[]});worker.on("error",error=>{throw error});';
    const value = await supportedFixture(source, {
      'child.cjs': 'if(require("./dependency.cjs")!==42)process.exit(1)',
      'dependency.cjs': 'module.exports=42',
    });
    const result = await value.run();
    expect(result.commands[0]!.status).toBe('passed');
    expect(result.commands[0]!.moduleEvidence!.processes).toBe(2);
  },
);
it.each(['spawn', 'fork', 'worker'] as const)(
  'blocks unbound child code when %s replaces environment or execArgv defaults',
  async mode => {
    const source =
      mode === 'spawn'
        ? 'require("node:child_process").spawnSync(process.execPath,["child.cjs"],{env:{}});'
        : mode === 'fork'
          ? 'require("node:child_process").fork("child.cjs",[],{env:{},execArgv:[],silent:true});'
          : 'const worker=new (require("node:worker_threads").Worker)(require("node:path").resolve("child.cjs"),{env:{},execArgv:[]});worker.on("error",()=>{});';
    const value = await supportedFixture(source, { 'child.cjs': 'require("../outside.cjs")' });
    await writeFile(
      join(value.parent, 'outside.cjs'),
      'console.log("unbound code must not execute")',
    );
    await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_NATIVE_MODULE_UNBOUND' });
  },
);
it('rejects a child custom preload before its code can execute', async () => {
  const value = await supportedFixture(
    'try{require("node:child_process").spawnSync(process.execPath,["--import","data:text/javascript,console.log(123)","check.cjs"],{env:{}})}catch{}',
  );
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED',
  });
});

const probeFixture = async (body: string, mockError = false) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-task33-module-fence-'));
  roots.push(root);
  const entry = join(root, 'entry.cjs'),
    mock = join(root, 'mock-child.cjs'),
    preload = join(root, 'preload.cjs'),
    net = join(root, 'net.exe'),
    net1 = join(root, 'net1.exe'),
    transport = join(root, 'transport.json');
  await writeFile(
    entry,
    body
      .replaceAll('PROBE_EXECUTABLE', JSON.stringify(net))
      .replaceAll('PROBE_HELPER', JSON.stringify(net1)),
  );
  await writeFile(
    mock,
    `const cp=require('node:child_process');const fs=require('node:fs');const {EventEmitter}=require('node:events');const mock=(...args)=>{const callback=args.findLast(value=>typeof value==='function');fs.writeFileSync(${JSON.stringify(transport)},JSON.stringify(args.filter(value=>typeof value!=='function')));if(callback)queueMicrotask(()=>callback(${mockError ? "Object.assign(Error('fixture failure'),{code:'EFAKE'})" : 'null'},'mapping output','fixture stderr'));return new EventEmitter()};for(const name of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])cp[name]=mock;`,
  );
  await writeFile(preload, NATIVE_MODULE_FENCE_SOURCE);
  await writeFile(net, 'fixture net');
  await writeFile(net1, 'fixture net helper');
  const file = async (path: string) => {
    const stat = await lstat(path, { bigint: true });
    return {
      path,
      identity: `${stat.dev}:${stat.ino}`,
      hash: storedChecksum(await readFile(path)),
      bytes: Number(stat.size),
      links: String(stat.nlink),
    };
  };
  const probeFiles = await Promise.all([net, net1].map(file)),
    rootStat = await lstat(root, { bigint: true });
  const policy = {
    protocol: NATIVE_MODULE_FENCE_PROTOCOL,
    traceRoot: root,
    preload,
    files: [...(await Promise.all([entry, mock, preload].map(file))), ...probeFiles],
    directories: [{ path: root, identity: `${rootStat.dev}:${rootStat.ino}` }],
    producers: [],
    hostProbes: [
      {
        id: 'windows-drive-mapping-v1',
        request: 'net use',
        executable: net,
        args: ['use'],
        timeoutMs: 5000,
        maxBufferPerStream: 524288,
        files: probeFiles,
      },
    ],
  };
  const bytes = JSON.stringify(policy),
    policyPath = join(root, 'policy.json');
  await writeFile(policyPath, bytes);
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
        SFP_NATIVE_MODULE_POLICY_HASH: storedChecksum(bytes),
      },
    },
  );
  return { root, transport, net, result };
};
it.each([
  'net use /delete',
  'net use \\example.invalid\\share fixture-password /user:fixture-user',
  'net use && echo unsafe',
])(
  'refuses unsupported host probe text without invoking any child transport: %s',
  async request => {
    const value = await probeFixture(
      `try{require('node:child_process').exec(${JSON.stringify(request)})}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_EXEC_UNSUPPORTED');
    await expect(readFile(value.transport)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it.each(['PROBE_EXECUTABLE', 'PROBE_HELPER'])(
  'does not grant generic child execution through host-probe role: %s',
  async executable => {
    const value = await probeFixture(
      `try{require('node:child_process').execFile(${executable},['use','/delete'])}catch(error){console.log(error.code)}`,
    );
    expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    await expect(readFile(value.transport)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it.each([false, true])(
  'translates only the fixed query without a shell and preserves callback outcome (error=%s)',
  async mockError => {
    const value = await probeFixture(
      `require('node:child_process').exec('net use',{windowsHide:true},(error,stdout,stderr)=>console.log(JSON.stringify({code:error?.code??null,stdout,stderr})))`,
      mockError,
    );
    const call = JSON.parse(await readFile(value.transport, 'utf8'));
    expect(call[0]).toBe(value.net);
    expect(call[1]).toEqual(['use']);
    expect(call[2]).toMatchObject({
      shell: false,
      timeout: 5000,
      maxBuffer: 524288,
      windowsHide: true,
    });
    expect(JSON.parse(value.result.stdout.trim())).toEqual({
      code: mockError ? 'EFAKE' : null,
      stdout: 'mapping output',
      stderr: 'fixture stderr',
    });
  },
);

it.each(['__filename', '"[eval]-wrapper"'])(
  'rejects altered manual compilation against %s',
  async filename => {
    const value = await supportedFixture(
      `const Module=require('node:module');try{new Module()._compile('globalThis.unboundCompiled=true',${filename})}catch{}if(globalThis.unboundCompiled)throw Error('unbound compilation executed')`,
    );
    await expect(value.run()).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_MODULE_SOURCE_CHANGED',
    });
  },
);

it.each([false, true])(
  'preserves promisified exec streams, child and rejection metadata (error=%s)',
  async mockError => {
    const value = await probeFixture(
      `const {promisify}=require('node:util');const promise=promisify(require('node:child_process').exec)('net use');const hasChild=typeof promise.child?.on==='function';promise.then(result=>console.log(JSON.stringify({hasChild,stdout:result.stdout,stderr:result.stderr})),error=>console.log(JSON.stringify({hasChild,code:error.code,stdout:error.stdout,stderr:error.stderr})));`,
      mockError,
    );
    expect(JSON.parse(value.result.stdout.trim())).toEqual({
      hasChild: true,
      ...(mockError ? { code: 'EFAKE' } : {}),
      stdout: 'mapping output',
      stderr: 'fixture stderr',
    });
    const call = JSON.parse(await readFile(value.transport, 'utf8'));
    expect(call[0]).toBe(value.net);
    expect(call[1]).toEqual(['use']);
    expect(call[2]).toMatchObject({ shell: false, timeout: 5000, maxBuffer: 524288 });
  },
);
it('rejects unsupported promisified exec requests without invoking child transport', async () => {
  const value = await probeFixture(
    `require('node:util').promisify(require('node:child_process').exec)('net use /delete').catch(error=>console.log(error.code));`,
  );
  expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_EXEC_UNSUPPORTED');
  await expect(readFile(value.transport)).rejects.toMatchObject({ code: 'ENOENT' });
});
