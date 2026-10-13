import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // spawn-hygiene-exempt: module-fence fixture that models untrusted workload code; the fenced
  // parent is started with windowsHide, so its Node children inherit that hidden console.
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
  // spawn-hygiene-exempt: module-fence fixture that models untrusted workload code; the fenced
  // parent is started with windowsHide, so its Node children inherit that hidden console.
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
    // spawn-hygiene-exempt: module-fence fixture that models untrusted workload code; the fenced
    // parent is started with windowsHide, so its Node children inherit that hidden console.
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
    // spawn-hygiene-exempt: module-fence fixture that models untrusted workload code; the fenced
    // parent is started with windowsHide, so its Node children inherit that hidden console.
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
  // spawn-hygiene-exempt: module-fence fixture that models untrusted workload code; the fenced
  // parent is started with windowsHide, so its Node children inherit that hidden console.
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
    // spawn-hygiene-exempt: module-fence fixture; the fence must refuse this call before any
    // child process starts.
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
    // spawn-hygiene-exempt: module-fence fixture; the fence must refuse this call before any
    // child process starts.
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
    // spawn-hygiene-exempt: module-fence fixture; the options-less promisified exec is the
    // case under test, the fence adds windowsHide itself and the child transport is mocked.
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
  // spawn-hygiene-exempt: module-fence fixture; the fence must refuse this call before any
  // child process starts.
  const value = await probeFixture(
    `require('node:util').promisify(require('node:child_process').exec)('net use /delete').catch(error=>console.log(error.code));`,
  );
  expect(value.result.stdout).toContain('PORTAL_NATIVE_MODULE_CHILD_EXEC_UNSUPPORTED');
  await expect(readFile(value.transport)).rejects.toMatchObject({ code: 'ENOENT' });
});
// Upstream @tailwindcss/node 4.2.2 (MIT) cache resolver, retained as a real loader fixture.
const tailwindCacheLoader =
  'import{isBuiltin as i}from"module";var o=async(a,e,u)=>{let r=await u(a,e);if(r.url===import.meta.url||i(r.url)||!e.parentURL)return r;let t=new URL(e.parentURL).searchParams.get("id");if(t===null)return r;let l=new URL(r.url);return l.searchParams.set("id",t),{...r,url:`${l}`}};export{o as resolve};\n';

async function epicFenceFixture() {
  const { epicCompilerFixture } = await import('./epic-compiler-fixture.js');
  const { RepoReader } = await import('../../src/fs/repo-walk.js');
  const { collectPortalSourceInventory } = await import('../../src/portal/source-inventory.js');
  const {
    captureReactRouterCompilerSource,
    compilerSourceBytes,
    prepareReactRouterCompilerProfile,
  } = await import('../../src/portal/react-router-compiler-evidence.js');
  const root = await mkdtemp(join(tmpdir(), 'sfp-task33-module-fence-epic-'));
  roots.push(root);
  const input = join(root, 'input'),
    work = join(root, 'work');
  await mkdir(input);
  await mkdir(work);
  const manifest = JSON.parse(epicCompilerFixture['package.json']);
  const packages: Record<string, unknown> = { '': manifest };
  for (const name of [
    '@react-router/dev',
    '@react-router/express',
    'react-router',
    'vite',
    '@tailwindcss/vite',
    'express',
    '@epic-web/config',
    '@sentry/react-router',
    'react-router-devtools',
    'vite-env-only',
    'vite-plugin-icons-spritesheet',
    'react-router-auto-routes',
    '@tailwindcss/node',
  ]) {
    const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? '4.2.2';
    const version = /^\D*(\d+\.\d+\.\d+)/u.exec(spec)?.[1] ?? '7.0.0';
    packages['node_modules/' + name] = { version, integrity: 'sha512-YWJjZA==' };
    await mkdir(join(input, 'node_modules', name), { recursive: true });
    await writeFile(
      join(input, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }
  for (const [path, text] of Object.entries({
    ...epicCompilerFixture,
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages }),
    'server/app.ts': 'export const app=true;',
    'app/components/ui/icons/sprite.svg': '<svg/>',
    'app/components/ui/icons/types.ts': 'export type IconName="owned";',
    'node_modules/@tailwindcss/node/dist/esm-cache.loader.mjs': tailwindCacheLoader,
  })) {
    await mkdir(dirname(join(input, path)), { recursive: true });
    await writeFile(join(input, path), text);
  }
  for (const path of ['chunks/config.js', 'module-runner.js']) {
    const bytes = await readFile(
      fileURLToPath(
        new URL('./fixtures/vite7-resolver/dist/node/' + path + '.txt', import.meta.url),
      ),
    );
    await mkdir(dirname(join(input, 'node_modules/vite/dist/node', path)), { recursive: true });
    await writeFile(join(input, 'node_modules/vite/dist/node', path), bytes);
  }
  const reader = new RepoReader({ rootDir: input }),
    source = await captureReactRouterCompilerSource(
      reader,
      storedChecksum('epic-fence-source'),
      await collectPortalSourceInventory(reader),
    );
  const profile = await prepareReactRouterCompilerProfile(
    source,
    NativeProfileSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'epic-fence',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: source.inputHash,
      closure: [{ path: 'placeholder.mjs', hash: storedChecksum('placeholder') }],
      environment: {},
      commands: [
        {
          id: 'placeholder',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['-e', ''],
          timeoutMs: 5000,
        },
      ],
    }),
    input,
  );
  for (const [path, bytes] of compilerSourceBytes(source)) {
    await mkdir(dirname(join(work, 'compiler-input', path)), { recursive: true });
    await writeFile(join(work, 'compiler-input', path), bytes);
  }
  return { root, input, work, profile };
}

it('consolidates the genuinely provisioned Epic second command into one complete fresh fence boundary', async () => {
  const value = await epicFenceFixture(),
    runner = new NativePortalRunner();
  const artifacts = await import('../../src/portal/native-artifacts.js');
  const fences = await import('../../src/portal/native-module-fence.js');
  const original = fences.createNativeModuleFence;
  const verifyOriginal = vi.spyOn(artifacts, 'verifyNativeArtifactAuthority');
  let observed = false,
    beforeCalls = 0,
    afterCalls = 0;
  vi.spyOn(fences, 'createNativeModuleFence').mockImplementation(async (...args) => {
    if (args[1].id === 'react-router-compiler') {
      observed = true;
      beforeCalls = verifyOriginal.mock.calls.length;
      await original(...args);
      afterCalls = verifyOriginal.mock.calls.length;
      throw Object.assign(Error('OWNED_STOP_BEFORE_SECOND_COMMAND'), {
        code: 'OWNED_STOP_BEFORE_SECOND_COMMAND',
      });
    }
    return original(...args);
  });
  try {
    await expect(
      runner.execute(
        'epic-fence-run',
        value.profile,
        value.work,
        value.profile.sourceHash,
        new AbortController().signal,
        Date.now() + 60000,
      ),
    ).rejects.toMatchObject({ code: 'OWNED_STOP_BEFORE_SECOND_COMMAND' });
    expect(observed).toBe(true);
    expect([beforeCalls, afterCalls]).toEqual([2, 3]);
  } finally {
    vi.restoreAllMocks();
    await runner.close();
  }
}, 60000);
it.each([
  'original-tamper',
  'copy-tamper',
  'missing-issuer',
  'missing-provisioner',
  'profile-clone',
  'wrong-phase',
  'wrong-root',
  'foreign-run',
  'foreign-receipt',
])(
  'keeps complete fresh compiler admission for %s %#',
  async mode => {
    const value = await epicFenceFixture(),
      runner = new NativePortalRunner();
    const fences = await import('../../src/portal/native-module-fence.js');
    const { hasCompletedReactRouterCompilerProvisioner } =
      await import('../../src/portal/native-runner.js');
    const original = fences.createNativeModuleFence;
    let checked = false,
      preReady = false,
      alteredReady: boolean | null = null,
      innerFailure: string | null = null;
    vi.spyOn(fences, 'createNativeModuleFence').mockImplementation(async (...args) => {
      if (args[1].id !== 'react-router-compiler') return original(...args);
      checked = true;
      preReady = hasCompletedReactRouterCompilerProvisioner(
        'epic-fence-run',
        value.profile,
        value.work,
        args[3],
        args[1].id,
      );
      if (mode === 'original-tamper' || mode === 'copy-tamper') {
        await writeFile(
          join(
            mode === 'original-tamper'
              ? value.input
              : join(value.work, 'compiler-workspace/source'),
            'node_modules/react-router/package.json',
          ),
          '{}',
        );
        innerFailure = await original(...args).then(
          () => null,
          error => error.code,
        );
      } else {
        const profile =
          mode === 'missing-issuer'
            ? {}
            : mode === 'profile-clone'
              ? JSON.parse(JSON.stringify(value.profile))
              : value.profile;
        const receipts =
          mode === 'missing-provisioner'
            ? []
            : mode === 'foreign-receipt'
              ? args[3].map(v => ({ ...v }))
              : args[3];
        alteredReady = hasCompletedReactRouterCompilerProvisioner(
          mode === 'foreign-run' ? 'other-run' : 'epic-fence-run',
          profile as any,
          mode === 'wrong-root' ? join(value.root, 'other') : value.work,
          receipts,
          mode === 'wrong-phase' ? 'compiler-dependencies' : 'react-router-compiler',
        );
        if (['missing-provisioner', 'foreign-receipt', 'foreign-run'].includes(mode))
          innerFailure = await original(
            args[0],
            args[1],
            args[2],
            receipts,
            args[4],
            args[5],
            args[6],
            mode === 'foreign-run' ? 'other-run' : args[7],
          ).then(
            () => null,
            error => error.code,
          );
      }
      throw Object.assign(Error('OWNED_STOP_BEFORE_SECOND_COMMAND'), {
        code: 'OWNED_STOP_BEFORE_SECOND_COMMAND',
      });
    });
    try {
      await expect(
        runner.execute(
          'epic-fence-run',
          value.profile,
          value.work,
          value.profile.sourceHash,
          new AbortController().signal,
          Date.now() + 60000,
        ),
      ).rejects.toMatchObject({ code: 'OWNED_STOP_BEFORE_SECOND_COMMAND' });
      expect(checked).toBe(true);
      expect(preReady).toBe(true);
      expect(alteredReady).toBe(['original-tamper', 'copy-tamper'].includes(mode) ? null : false);
      expect(innerFailure).toBe(
        mode === 'original-tamper'
          ? 'PORTAL_ARTIFACT_CHANGED'
          : mode === 'copy-tamper'
            ? 'PORTAL_PROVISIONED_OUTPUT_CHANGED'
            : ['missing-provisioner', 'foreign-receipt', 'foreign-run'].includes(mode)
              ? 'PORTAL_COMPILER_PROVISIONER_REQUIRED'
              : null,
      );
    } finally {
      vi.restoreAllMocks();
      await runner.close();
    }
  },
  60000,
);
it('holds an aborted consolidated fresh verification until its issued verification promise settles', async () => {
  const value = await epicFenceFixture(),
    runner = new NativePortalRunner(),
    controller = new AbortController();
  const artifacts = await import('../../src/portal/native-artifacts.js'),
    fences = await import('../../src/portal/native-module-fence.js');
  const originalFence = fences.createNativeModuleFence,
    originalVerify = artifacts.verifyNativeArtifactAuthority;
  let release!: () => void,
    entered = false,
    settled = false;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.spyOn(fences, 'createNativeModuleFence').mockImplementation(async (...args) => {
    if (args[1].id !== 'react-router-compiler') return originalFence(...args);
    vi.spyOn(artifacts, 'verifyNativeArtifactAuthority').mockImplementation(
      async (...parameters) => {
        entered = true;
        await gate;
        return originalVerify(...parameters);
      },
    );
    return originalFence(...args);
  });
  const task = runner.execute(
    'epic-fence-run',
    value.profile,
    value.work,
    value.profile.sourceHash,
    controller.signal,
    Date.now() + 60000,
  );
  const outcome = task
    .catch(error => error)
    .finally(() => {
      settled = true;
    });
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 10000 });
    controller.abort(
      Object.assign(Error('PORTAL_BUDGET_EXHAUSTED'), { code: 'PORTAL_BUDGET_EXHAUSTED' }),
    );
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await outcome).toMatchObject({ code: 'PORTAL_BUDGET_EXHAUSTED' });
    await expect(
      readFile(join(value.work, 'compiler-workspace/source/compiler-observations/observed.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    release();
    await outcome;
    vi.restoreAllMocks();
    await runner.close();
  }
}, 60000);
async function cacheLoaderFixture(mode: string) {
  const vite7 = mode.startsWith('vite-7-');
  if (vite7) mode = mode.replace('vite-7-', 'vite-');
  const root = await mkdtemp(join(tmpdir(), 'sfp-task33-module-fence-'));
  roots.push(root);
  const loader = 'deps/node_modules/@tailwindcss/node/dist/esm-cache.loader.mjs';
  const nativeRequire = createRequire(import.meta.url);
  const viteRoot = vite7
    ? fileURLToPath(new URL('./fixtures/vite7-resolver/', import.meta.url))
    : dirname(
        createRequire(nativeRequire.resolve('vitest/package.json')).resolve('vite/package.json'),
      );
  const viteMode = mode.startsWith('vite-');
  const resolverText = await readFile(
    join(viteRoot, 'dist/node/module-runner.js' + (vite7 ? '.txt' : '')),
    'utf8',
  );
  let resolverBody =
    /function customizationHookResolve\(specifier, context, nextResolve\) \{[\s\S]*?\n\}/.exec(
      resolverText,
    )![0];
  if (mode === 'vite-changed-callback')
    resolverBody = resolverBody.replace(
      'specifier = parsedSpecifier',
      'specifier = String(parsedSpecifier)',
    );
  const copyVite = viteMode
    ? [vite7 ? 'chunks/config.js' : 'chunks/node.js', 'module-runner.js']
        .map(
          p =>
            'fs.mkdirSync(path.dirname(' +
            JSON.stringify('deps/node_modules/vite/dist/node/' + p) +
            '),{recursive:true});fs.copyFileSync(' +
            JSON.stringify(join(viteRoot, 'dist/node', p + (vite7 ? '.txt' : ''))) +
            ',' +
            JSON.stringify('deps/node_modules/vite/dist/node/' + p) +
            ');',
        )
        .join('')
    : '';
  const provision =
    'const fs=require("node:fs"),path=require("node:path");fs.mkdirSync(path.dirname(' +
    JSON.stringify(loader) +
    '),{recursive:true});fs.writeFileSync(' +
    JSON.stringify(loader) +
    ',' +
    JSON.stringify(tailwindCacheLoader + (mode === 'changed-body' ? '//changed' : '')) +
    ');' +
    copyVite;
  const registration =
    mode === 'wrong-file'
      ? 'new URL("./foreign.mjs",import.meta.url)'
      : mode === 'custom'
        ? '"data:text/javascript,export async function resolve(s,c,n){return n(s,c)}"'
        : mode === 'query'
          ? 'new URL("./' + loader + '?private-canary",import.meta.url)'
          : 'new URL("./' + loader + '",import.meta.url)';
  const extra =
    mode === 'register-hooks'
      ? 'registerHooks({resolve(s,c,n){return n(s,c)}});'
      : mode === 'repeat'
        ? 'register(' + registration + ');'
        : mode === 'changed-child'
          ? '(await import("node:fs")).writeFileSync("dep.mjs",' +
            JSON.stringify('console.log("UNREVIEWED_CHILD");') +
            ');'
          : '';
  let source =
    'import{register,registerHooks}from"node:module";register(' +
    registration +
    (mode === 'options' ? ',{data:{unexpected:true}}' : '') +
    ');' +
    extra +
    'await import("./consumer.mjs?id=owned-fixture");';
  if (viteMode) {
    const callback =
      mode === 'vite-load-hook'
        ? '{resolve:customizationHookResolve,load(){throw Error("UNTRUSTED_LOAD")}}'
        : mode === 'vite-accessor'
          ? '{get resolve(){throw Error("UNTRUSTED_ACCESSOR")}}'
          : '{resolve:customizationHookResolve}';
    const target = mode === 'vite-data-scheme' ? 'data:text/javascript,export{}' : './dep.mjs';
    source =
      'import{registerHooks}from"node:module";const customizationHookNamespace={ [Symbol.toPrimitive](){throw Error("UNTRUSTED_CALLBACK_CLOSURE_EXECUTED")}};' +
      resolverBody +
      ';registerHooks(' +
      callback +
      ');const resolved=import.meta.resolve("vite-module-runner:import-meta-resolve/v1/"+JSON.stringify([' +
      JSON.stringify(target) +
      ',import.meta.url]));if(!resolved.endsWith("/dep.mjs"))throw Error("Incorrect resolver result");console.log("VITE_RESOLVE_ACK");';
  }
  const files = {
    'provision.cjs': provision,
    'check.mjs': source,
    'consumer.mjs': 'import"./dep.mjs";',
    'dep.mjs':
      'if(!import.meta.url.endsWith("?id=owned-fixture"))throw Error("Cache id did not propagate");console.log("CACHE_ID_PROPAGATED");',
    'foreign.mjs': 'export async function resolve(s,c,n){return n(s,c)}',
  };
  for (const [p, text] of Object.entries(files)) await writeFile(join(root, p), text);
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'cache-loader-fixture',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: storedChecksum(JSON.stringify(files)),
    closure: Object.entries(files).map(([path, text]) => ({ path, hash: storedChecksum(text) })),
    environment: {},
    ...(viteMode ? { externalArtifacts: [{ root: viteRoot, kind: 'node-package-tree' }] } : {}),
    commands: [
      {
        id: 'provision',
        executable: process.execPath,
        executableHash: await nativeExecutableHash(process.execPath),
        args: ['provision.cjs'],
        timeoutMs: 15000,
        produces: [{ path: 'deps', kind: 'provisioned-dependencies' }],
      },
      {
        id: 'cache',
        executable: process.execPath,
        executableHash: await nativeExecutableHash(process.execPath),
        args: ['check.mjs'],
        timeoutMs: 15000,
        ...(mode === 'missing-capability' ? {} : { moduleLoader: 'tailwindcss-node-esm-cache-v1' }),
        ...(viteMode && mode !== 'vite-missing-capability'
          ? { moduleResolver: 'vite-import-meta-resolve-v1' }
          : {}),
      },
    ],
  });
  profile.artifactAuthority = await prepareNativeArtifactAuthority(profile);
  const runner = new NativePortalRunner();
  try {
    return await runner.execute(
      'cache-loader-fixture',
      profile,
      root,
      profile.sourceHash,
      new AbortController().signal,
      Date.now() + 60000,
    );
  } finally {
    await runner.close();
  }
}
it('admits only the exact reviewed Tailwind cache resolver and preserves child import byte checks', async () => {
  expect(Buffer.byteLength(tailwindCacheLoader)).toBe(302);
  expect(storedChecksum(tailwindCacheLoader)).toBe(
    'sha256:e929c736300ab9a4c49cfcebba3569972dfc6c772167912e2b385bea6c390df2',
  );
  const result = await cacheLoaderFixture('valid');
  expect(result.commands.map(c => c.status)).toEqual(['passed', 'passed']);
  expect(result.commands[1]!.output).toContain('CACHE_ID_PROPAGATED');
  expect(result.commands[1]!.moduleEvidence!.loadedModules).toBeGreaterThanOrEqual(3);
});
it.each(['missing-capability', 'changed-body', 'wrong-file', 'query', 'options', 'custom'])(
  'rejects caller loader widening despite an admitted dependency receipt: %s',
  async mode => {
    await expect(cacheLoaderFixture(mode)).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED',
    });
  },
);

it.each([
  ['register-hooks', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['repeat', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['changed-child', 'PORTAL_NATIVE_MODULE_CHANGED'],
])('retains guarded module authority after known cache registration: %s', async (mode, code) => {
  await expect(cacheLoaderFixture(mode!)).rejects.toMatchObject({ code });
});

it('uses only the service-owned Vite resolver and never invokes the matching caller closure', async () => {
  const result = await cacheLoaderFixture('vite-valid');
  expect(result.commands.map(c => c.status)).toEqual(['passed', 'passed']);
  expect(result.commands[1]!.output).toContain('VITE_RESOLVE_ACK');
  expect(result.commands[1]!.output).not.toContain('UNTRUSTED_CALLBACK');
});
it.each([
  ['vite-missing-capability', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['vite-changed-callback', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['vite-load-hook', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['vite-accessor', 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED'],
  ['vite-data-scheme', 'PORTAL_NATIVE_MODULE_RESOLVER_UNSUPPORTED'],
])('refuses resolver widening or unadmitted namespace data: %s', async (mode, code) => {
  await expect(cacheLoaderFixture(mode!)).rejects.toMatchObject({ code });
});

it('acknowledges exact Vite7 file/body authority without executing matching callback closure', async () => {
  const result = await cacheLoaderFixture('vite-7-valid');
  expect(result.commands.map(c => c.status)).toEqual(['passed', 'passed']);
  expect(result.commands[1]!.output).toContain('VITE_RESOLVE_ACK');
  expect(result.commands[1]!.output).not.toContain('UNTRUSTED_CALLBACK');
});
it.each(['changed-callback', 'load-hook', 'accessor', 'data-scheme'])(
  'rejects Vite7 resolver widening %# %s',
  async kind => {
    await expect(cacheLoaderFixture('vite-7-' + kind)).rejects.toMatchObject({
      code:
        kind === 'data-scheme'
          ? 'PORTAL_NATIVE_MODULE_RESOLVER_UNSUPPORTED'
          : 'PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED',
    });
  },
);
