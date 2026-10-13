import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { storedChecksum } from '@sfp/ir';
// Resolve the actual test runner dependency without adding Vite to the service's runtime imports.
const testRequire = createRequire(import.meta.url);
const viteEntry =
  process.env['SFP_TEST_PINNED_VITE_ENTRY'] ??
  createRequire(testRequire.resolve('vitest')).resolve('vite');
const {
  createBuilder,
  mergeConfig,
  version: installedViteVersion,
} = await import(pathToFileURL(viteEntry).href);
import { afterEach, expect, it, vi } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import {
  NativeCommandSchema,
  NativePortalRunner,
  nativeExecutableHash,
  type NativeProfile,
} from '../../src/portal/native-runner.js';
import {
  readReactRouterCssAsset,
  captureReactRouterCompilerSource,
  captureReactRouterCompilerEvidence,
  readReactRouterPnpmLock,
  assertReactRouterCompilerConfiguration,
  REACT_ROUTER_COMPILER_BOOTSTRAP,
  compilerRunDiagnostics,
  compilerCommandDiagnostics,
  readReactRouterGeneratedTypeModules,
} from '../../src/portal/react-router-compiler-evidence.js';
import * as compilerEvidence from '../../src/portal/react-router-compiler-evidence.js';
import { collectPortalSourceInventory } from '../../src/portal/source-inventory.js';
const roots: string[] = [];
const runners: NativePortalRunner[] = [];
const generatedTypeRoots = new Map<
  string,
  { base: string; canonical: string; prefix: string; dev: bigint; ino: bigint }
>();

async function generatedTypeRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const base = await realpath(tmpdir()),
    canonical = await realpath(root);
  const info = await lstat(root, { bigint: true });
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    canonical.toLowerCase() !== resolvePath(root).toLowerCase() ||
    dirname(canonical).toLowerCase() !== base.toLowerCase() ||
    !basename(canonical).startsWith(prefix)
  )
    throw Error('Owned generated-type fixture root required');
  generatedTypeRoots.set(root, { base, canonical, prefix, dev: info.dev, ino: info.ino });
  roots.push(root);
  return root;
}

// Pure admission spy only. These bounded output-reader tests cannot issue native authority.
function c3GeneratedRouteFixture(modules: Map<string, string>) {
  const files = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.vite.json"}]}',
    'tsconfig.vite.json':
      '{"extends":"./tsconfig.json","include":["app/**/*"],"compilerOptions":{"rootDirs":[".","./.react-router/types"]}}',
    'app/root.tsx': "import type {Route} from './+types/root';",
    'app/routes/home.tsx': "import type {Route} from './+types/home';",
  };
  const spy = vi.spyOn(compilerEvidence, 'admittedReactRouterCompilerEvidence').mockReturnValue({
    hash: 'sha256:' + 'a'.repeat(64),
    configuration: ['react-router.config.ts'],
    modules,
  });
  try {
    return resolvePortalModules(new Map(Object.entries(files)), Object.keys(files), {
      reactRouterCompilerEvidence: {} as compilerEvidence.ReactRouterCompilerEvidence,
      sourceId: 'sha256:' + 'b'.repeat(64),
      sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
    });
  } finally {
    spy.mockRestore();
  }
}

it('retains bounded non-Epic generated root and home types in the compiler namespace', async () => {
  const root = await generatedTypeRoot('sfp-c3-generated-types-');
  await mkdir(join(root, 'types/app/routes/+types'), { recursive: true });
  await mkdir(join(root, 'types/app/+types'), { recursive: true });
  await writeFile(join(root, 'types/app/+types/root.ts'), 'export type Route = { root: true };');
  await writeFile(
    join(root, 'types/app/routes/+types/home.ts'),
    'export type Route = { home: true };',
  );
  await writeFile(join(root, 'types/config.json'), '{}');
  const modules = await readReactRouterGeneratedTypeModules(root, new AbortController().signal);
  expect([...modules.keys()].toSorted()).toEqual([
    '.react-router/types/app/+types/root.ts',
    '.react-router/types/app/routes/+types/home.ts',
    'app/+types/root.ts',
    'app/routes/+types/home.ts',
  ]);
  expect(modules.get('.react-router/types/app/+types/root.ts')).toBe(
    'export type Route = { root: true };',
  );
  const graph = c3GeneratedRouteFixture(modules);
  expect(graph.complete).toBe(true);
  expect(graph.references).toHaveLength(2);
  expect(
    graph.references.every(row => row.reason === 'observed-compiler-generated-route-type'),
  ).toBe(true);
});

it('denies absent or foreign-linked generated type output without issuing compiler authority', async () => {
  const root = await generatedTypeRoot('sfp-c3-generated-type-denial-');
  const foreign = await generatedTypeRoot('sfp-c3-foreign-types-');
  await expect(
    readReactRouterGeneratedTypeModules(join(root, 'missing'), new AbortController().signal),
  ).rejects.toThrow('repo root is unavailable');
  await mkdir(join(root, 'types'), { recursive: true });
  await mkdir(join(foreign, '+types'));
  await writeFile(join(foreign, '+types/root.ts'), 'export type Route = { foreign: true };');
  await symlink(
    foreign,
    join(root, 'types/app'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const linked = await readReactRouterGeneratedTypeModules(root, new AbortController().signal);
  expect(linked.size).toBe(0);
  expect(c3GeneratedRouteFixture(linked).complete).toBe(false);
});

async function observedBootstrap(
  legacy: boolean,
  environmentApi: boolean,
  version = '7.16.0',
  failure?: unknown,
  mergeOptions?: {
    clientManifest?: unknown;
    modifyResolved?: (config: any, context: any) => void;
    cssCode?: string;
    repeatCssCode?: string;
  },
) {
  const calls: string[] = [];
  let stored: unknown;
  let diagnostic = '';
  let resolvedSsr = false;
  let finish!: (value: {
    passed: boolean;
    stored: unknown;
    calls: string[];
    diagnostic: string;
    resolvedSsr: boolean;
  }) => void;
  const completed = new Promise<{
    passed: boolean;
    stored: unknown;
    calls: string[];
    diagnostic: string;
    resolvedSsr: boolean;
  }>(resolve => {
    finish = resolve;
  });
  const context = {
    buildManifest: {
      routes: {
        root: {
          id: 'root',
          file: 'root.tsx',
          parentId: undefined,
          path: '',
          index: undefined,
          caseSensitive: undefined,
        },
      },
    },
    rootDirectory: '/owned',
    reactRouterConfig: {
      ssr: true,
      buildDirectory: '/owned/build',
      future: { v8_viteEnvironmentApi: environmentApi },
    },
  };
  if (mergeOptions && 'clientManifest' in mergeOptions)
    context.buildManifest = mergeOptions.clientManifest as any;
  const ssrBuild = {
    ssr: true,
    manifest: true,
    ssrEmitAssets: true,
    copyPublicDir: false,
    outDir: '/owned/build/server',
    rollupOptions: {
      input: './server/app.ts',
      output: { entryFileNames: 'index.js', format: 'esm' },
    },
  };
  const ssrResolve = {
    conditions: ['module-sync', 'node'],
    externalConditions: ['module-sync', 'node'],
  };
  const config = (audit: any) => ({
    command: 'build',
    mode: 'production',
    root: '/owned',
    configFile: '/owned/vite.config.ts',
    plugins: [{ name: 'react-router' }, audit],
    build: { ssr: false },
    __reactRouterPluginContext: context,
  });
  const ssr = (audit: any) => {
    audit.configResolved(config(audit));
    audit.transform.call(
      { environment: { name: 'ssr' } },
      'export const routes = {};',
      'virtual:react-router/server-build',
    );
    audit.transform.call(
      { environment: { name: 'ssr' } },
      mergeOptions?.cssCode ?? 'export default "/assets/style.css";',
      '/owned/app/styles/tailwind.css?url',
    );
    if (mergeOptions?.repeatCssCode !== undefined)
      audit.transform.call(
        { environment: { name: 'ssr' } },
        mergeOptions.repeatCssCode,
        '/owned/app/styles/tailwind.css?url',
      );
  };
  const vite = {
    createBuilder: async ({ plugins: [audit] }: any, useLegacyBuilder = false) => ({
      config: config(audit),
      environments: useLegacyBuilder
        ? { client: { name: 'client', config: { root: '/owned', build: { ssr: false } } } }
        : {
            client: { name: 'client', config: { root: '/owned', build: { ssr: false } } },
            ssr: { name: 'ssr' },
          },
      buildApp: async () => {
        calls.push('client');
        audit.configResolved(config(audit));
        if (environmentApi) ssr(audit);
        else if (!useLegacyBuilder) {
          audit.transform.call(
            { environment: { name: 'ssr' } },
            'export default "/assets/style.css";',
            '/owned/app/styles/tailwind.css?url',
          );
        }
      },
    }),
    resolveConfig: async (input: any, command: string) => {
      expect(command).toBe('build');
      expect(input['__reactRouterPluginContext']).toBe(context);
      expect(input.build.ssr).toBe(true);
      resolvedSsr = true;
      const actualContext = mergeConfig(
        { __reactRouterPluginContext: context },
        { __reactRouterPluginContext: { ...context, environmentBuildContext: null } },
      );
      expect(actualContext['__reactRouterPluginContext'].buildManifest).not.toBe(
        context.buildManifest,
      );
      const result = {
        ...config(input.plugins[0]),
        ...actualContext,
        build: ssrBuild,
        ssr: { resolve: ssrResolve },
      };
      mergeOptions?.modifyResolved?.(result, context);
      return result;
    },
    build: async (input: any) => {
      expect(input.build.ssr).toBe(true);
      calls.push('ssr');
      expect(resolvedSsr).toBe(true);
      expect(input['__reactRouterPluginContext']).toBe(context);
      expect(input['__reactRouterEnvironmentBuildContext'].name).toBe('ssr');
      const options = input['__reactRouterEnvironmentBuildContext'].resolveOptions({
        viteUserConfig: input,
      });
      expect(options.build).toBe(ssrBuild);
      expect(options.resolve).toBe(ssrResolve);
      if (failure) throw failure;
      ssr(input.plugins[0]);
    },
  };
  const fs = {
    readFile: async () => JSON.stringify({ version, bin: { 'react-router': 'bin.js' } }),
    mkdir: async () => {},
    writeFile: async (_path: string, data: string) => {
      stored = JSON.parse(data);
    },
  };
  const requireFixture = Object.assign(
    (id: string) =>
      id === 'node:crypto'
        ? { createHash }
        : id === 'node:fs/promises'
          ? fs
          : id === 'node:path'
            ? {
                join: (...values: string[]) => values.join('/'),
                dirname: () => '/package',
                resolve: (value: string) => value,
                relative: (_root: string, value: string) => value.replace('/owned/', ''),
                sep: '/',
              }
            : { execFileSync: () => {} },
    { resolve: () => '/package/package.json' },
  );
  const run = new Function(
    'require',
    'fixtureVite',
    'process',
    'console',
    REACT_ROUTER_COMPILER_BOOTSTRAP.replace("await import('vite')", 'fixtureVite'),
  );
  run(
    requireFixture,
    vite,
    {
      cwd: () => '/owned',
      execPath: '/node',
      env: {},
      argv: ['node', ...(legacy ? ['epic-legacy-ssr-v1'] : [])],
    },
    {
      log: () => finish({ passed: true, stored, calls, diagnostic, resolvedSsr }),
      error: (value: string) => {
        diagnostic = value;
        finish({ passed: false, stored, calls, diagnostic, resolvedSsr });
      },
    },
  );
  return completed;
}

async function cssFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sfp-css-observation-'));
  roots.push(root);
  const sourceRoot = join(root, 'source'),
    clientRoot = join(root, 'build/client'),
    sourceFile = join(sourceRoot, 'app/styles/tailwind.css');
  await mkdir(dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, '@import "tailwindcss";');
  await mkdir(join(clientRoot, 'assets'), { recursive: true });
  await mkdir(join(clientRoot, '.vite'));
  const path = 'assets/tailwind-a.css',
    bytes = 'body{color:red}';
  await writeFile(join(clientRoot, path), bytes);
  const identity = sourceFile.replaceAll('\\', '/'),
    request = identity + '?transform-only';
  const token = '__VITE_CSS_URL__' + Buffer.from(request).toString('hex') + '__';
  const code =
    'import ' + JSON.stringify(request) + ';export default ' + JSON.stringify(token) + ';';
  const manifest = { [identity]: { src: identity, file: path } };
  await writeFile(join(clientRoot, '.vite/manifest.json'), JSON.stringify(manifest));
  return {
    root,
    sourceRoot,
    clientRoot,
    identity,
    request,
    token,
    code,
    manifest,
    path,
    bytes,
    signal: new AbortController().signal,
  };
}
it('decodes the actual pinned Vite two-statement CSS shape through its emitted client manifest', async () => {
  const f = await cssFixture();
  const result = await readReactRouterCssAsset({ ...f, reviewedEpic: true });
  expect(result).toEqual({
    path: f.path,
    hash: storedChecksum(f.bytes),
    bytes: Buffer.byteLength(f.bytes),
  });
  expect(f.code).toContain('?transform-only');
});
it('denies foreign CSS tokens imports manifest paths links and empty output', async () => {
  const f = await cssFixture(),
    base = { ...f, reviewedEpic: true };
  for (const change of [
    { reviewedEpic: false },
    { code: f.code.replace('?transform-only', '?inline') },
    { code: f.code.replace(f.token, '__VITE_CSS_URL__00__') },
    {
      code:
        'import x from ' +
        JSON.stringify(f.request) +
        ';export default ' +
        JSON.stringify(f.token) +
        ';',
    },
    { code: f.code + ';export const invented=true;' },
  ])
    await expect(readReactRouterCssAsset({ ...base, ...change })).rejects.toThrow(
      'PORTAL_COMPILER_OBSERVATION_REQUIRED',
    );
  for (const manifest of [
    {
      [f.identity]: { src: f.identity, file: f.path },
      [f.identity.replaceAll('/', String.fromCharCode(92))]: { src: f.identity, file: f.path },
    },
    { [f.identity]: { src: 'foreign', file: f.path } },
    { [f.identity]: { src: f.identity, file: '../outside.css' } },
    { [f.identity]: { src: f.identity, file: 'assets/not-present.css' } },
  ]) {
    await writeFile(join(f.clientRoot, '.vite/manifest.json'), JSON.stringify(manifest));
    await expect(readReactRouterCssAsset(base)).rejects.toThrow(/PORTAL_COMPILER|ENOENT|abort/iu);
  }
  await writeFile(join(f.clientRoot, '.vite/manifest.json'), JSON.stringify(f.manifest));
  await writeFile(join(f.clientRoot, f.path), '');
  await expect(readReactRouterCssAsset(base)).rejects.toThrow('PORTAL_COMPILER_OUTPUT_REQUIRED');
  const controller = new AbortController();
  controller.abort();
  await expect(readReactRouterCssAsset({ ...base, signal: controller.signal })).rejects.toThrow(
    /PORTAL_COMPILER|ENOENT|abort/iu,
  );
  const outside = join(f.root, 'outside-assets'),
    assets = join(f.clientRoot, 'assets');
  expect(assets.startsWith(f.root)).toBe(true);
  await mkdir(outside);
  await writeFile(join(outside, 'tailwind-a.css'), f.bytes);
  await rm(assets, { recursive: true });
  await symlink(outside, assets, 'junction');
  await expect(readReactRouterCssAsset(base)).rejects.toThrow(
    'PORTAL_COMPILER_OBSERVATION_REQUIRED',
  );
});
it('keeps literal CSS exports and the complete generated native command cap', async () => {
  const f = await cssFixture();
  await expect(
    readReactRouterCssAsset({
      ...f,
      reviewedEpic: false,
      code: 'export default "/' + f.path + '";',
    }),
  ).resolves.toMatchObject({ path: f.path, hash: storedChecksum(f.bytes) });
  expect(REACT_ROUTER_COMPILER_BOOTSTRAP.length).toBeLessThanOrEqual(8000);
  expect(
    NativeCommandSchema.safeParse({
      id: 'react-router-compiler',
      executable: process.execPath,
      executableHash: 'sha256:' + 'a'.repeat(64),
      args: ['-e', REACT_ROUTER_COMPILER_BOOTSTRAP],
      timeoutMs: 180000,
    }).success,
  ).toBe(true);
});
it('admits the complete generated compiler bootstrap under the unchanged native argument cap', () => {
  expect(REACT_ROUTER_COMPILER_BOOTSTRAP.length).toBeLessThanOrEqual(8000);
  expect(Buffer.byteLength(REACT_ROUTER_COMPILER_BOOTSTRAP)).toBeLessThanOrEqual(8000);
  const command = NativeCommandSchema.safeParse({
    id: 'react-router-compiler',
    executable: process.execPath,
    executableHash: 'sha256:' + 'a'.repeat(64),
    args: ['-e', REACT_ROUTER_COMPILER_BOOTSTRAP, 'epic-legacy-ssr-v1'],
    timeoutMs: 180000,
  });
  expect(command.success).toBe(true);
});
it('uses real installed Vite legacy client-only builder while preserving buildApp hooks and default environments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-rr-builder-'));
  roots.push(root);
  for (const legacy of [false, true]) {
    let hooks = 0;
    const calls: string[] = [];
    const builder = await createBuilder(
      {
        root,
        configFile: false,
        ssr: {},
        logLevel: 'silent',
        builder: {
          buildApp: async () => {
            hooks++;
          },
        },
      },
      legacy,
    );
    const environments = Object.values(builder.environments) as any[];
    expect(environments.map(e => e.name).toSorted()).toEqual(
      legacy ? ['client'] : ['client', 'ssr'],
    );
    expect(builder.environments.client.name).toBe('client');
    expect(builder.environments.client.config.build.ssr).toBe(false);
    builder.build = async (environment: any) => {
      calls.push(environment.name);
      environment.isBuilt = true;
      return [];
    };
    await builder.buildApp();
    expect(hooks).toBe(1);
    expect(calls.toSorted()).toEqual(legacy ? ['client'] : ['client', 'ssr']);
  }
  expect(await observedBootstrap(true, false)).toMatchObject({
    passed: true,
    calls: ['client', 'ssr'],
  });
  expect(await observedBootstrap(false, true)).toMatchObject({ passed: true, calls: ['client'] });
});
it('retains CSS duplicate and size rejection with only closed metrics and code hashes', async () => {
  const code = 'export default "/assets/style.css";';
  for (const [options, prior, over, repeat, same] of [
    [{ repeatCssCode: code }, 1, false, true, true],
    [{ repeatCssCode: 'private-css-canary' }, 1, false, true, false],
    [{ cssCode: 'x'.repeat(65537) }, 0, true, false, false],
  ] as const) {
    const result = await observedBootstrap(true, false, '7.16.0', undefined, options);
    expect(result.passed).toBe(false);
    const projected = compilerCommandDiagnostics({
      commandId: 'react-router-compiler',
      status: 'failed',
      exitCode: 1,
      durationMs: 1,
      cleanup: 'finished',
      output: result.diagnostic,
    } as any);
    expect(projected).toMatchObject({
      reportedCause: 'PORTAL_COMPILER_CSS_OBSERVATION_INVALID',
      reportedCssPriorObservations: prior,
      reportedCssOverLimit: over,
      reportedCssRepeated: repeat,
      reportedCssSameCode: same,
    });
    expect(projected.reportedCssCodeBytes).toBe(
      over ? 65537 : Buffer.byteLength(options.repeatCssCode!),
    );
    expect(projected.reportedCssCodeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(projected)).not.toContain('private-css-canary');
  }
});
it('accepts actual installed Vite context cloning while keeping the original injection and SSR options', async () => {
  expect(installedViteVersion).toMatch(/^\d+\./u);
  expect(await observedBootstrap(true, false)).toMatchObject({
    passed: true,
    resolvedSsr: true,
    calls: ['client', 'ssr'],
  });
});
it('rejects changed or unsupported manifest facts and retains real SSR output guards', async () => {
  const changed = await observedBootstrap(true, false, '7.16.0', undefined, {
    modifyResolved: config => {
      config['__reactRouterPluginContext'].buildManifest.routes.root.file = 'changed.tsx';
    },
  });
  expect(changed.passed).toBe(false);
  expect(changed.calls).toEqual(['client']);
  expect(changed.diagnostic).toContain('contextGuard=manifest-data');
  const mutated = await observedBootstrap(true, false, '7.16.0', undefined, {
    modifyResolved: (_config, context) => {
      context.buildManifest.routes.root.file = 'changed.tsx';
    },
  });
  expect(mutated.passed).toBe(false);
  let getterCalls = 0;
  const getter = {
    routes: {
      root: {
        id: 'root',
        get file() {
          getterCalls++;
          return 'private-canary';
        },
      },
    },
  };
  const unknown = { routes: { root: { id: 'root', file: 'root.tsx', extra: 'private-canary' } } };
  const array = { routes: { root: { id: 'root', file: 'root.tsx', path: ['private-canary'] } } };
  for (const clientManifest of [
    getter,
    unknown,
    array,
    { routes: Object.create({ root: { id: 'root', file: 'root.tsx' } }) },
  ]) {
    const result = await observedBootstrap(true, false, '7.16.0', undefined, { clientManifest });
    expect(result.passed).toBe(false);
    expect(result.resolvedSsr).toBe(false);
    expect(result.diagnostic).not.toContain('private-canary');
  }
  expect(getterCalls).toBe(0);
  const makeRoutes = (count: number, long: boolean) => ({
    routes: Object.fromEntries(
      Array.from({ length: count }, (_, index) => {
        const id = index === 0 ? 'root' : 'r' + index;
        return [
          id,
          {
            id,
            file: long ? 'x'.repeat(4096) : 'root.tsx',
            path: long ? 'y'.repeat(4096) : '',
            parentId: long ? 'z'.repeat(4096) : 'root',
            index: false,
            caseSensitive: false,
          },
        ];
      }),
    ),
  });
  const symbolManifest = {
    routes: { root: { id: 'root', file: 'root.tsx' } },
    [Symbol('private-canary')]: 'private-canary',
  };
  for (const clientManifest of [
    symbolManifest,
    makeRoutes(1500, false),
    makeRoutes(200, true),
    { routes: { root: { id: 'root', file: 'x'.repeat(4097) } } },
  ]) {
    const result = await observedBootstrap(true, false, '7.16.0', undefined, { clientManifest });
    expect(result).toMatchObject({ passed: false, resolvedSsr: false });
  }
  for (const modifyResolved of [
    (config: any) => {
      config.build.ssr = false;
    },
    (config: any) => {
      config.build.outDir = '/foreign/server';
    },
  ]) {
    expect(
      await observedBootstrap(true, false, '7.16.0', undefined, { modifyResolved }),
    ).toMatchObject({ passed: false, calls: ['client'] });
  }
});
it('retains closed plugin hook and module diagnostics while hashing unknown error identities', async () => {
  const canary = 'private-token-canary';
  let reads = 0;
  const error = {
    code: 'PLUGIN_ERROR',
    plugin: 'react-router',
    hook: 'transform',
    id: '\0virtual:react-router/server-build',
    get message() {
      reads++;
      return canary;
    },
  };
  const result = await observedBootstrap(true, false, '7.16.0', error);
  expect(result.passed).toBe(false);
  expect(reads).toBe(1);
  const projection = compilerCommandDiagnostics({
    commandId: 'react-router-compiler',
    status: 'failed',
    exitCode: 1,
    durationMs: 1,
    cleanup: 'finished',
    output: result.diagnostic,
  } as any);
  expect(projection).toMatchObject({
    reportedCode: 'PLUGIN_ERROR',
    reportedPlugin: 'react-router',
    reportedHook: 'transform',
    reportedModule: 'virtual:react-router/server-build',
  });
  expect(JSON.stringify(projection)).not.toContain(canary);
  const unknown = await observedBootstrap(true, false, '7.16.0', {
    code: 'PLUGIN_ERROR',
    plugin: canary,
    hook: canary,
    id: '/private/' + canary,
    message: canary,
  });
  const safe = compilerCommandDiagnostics({
    commandId: 'react-router-compiler',
    status: 'failed',
    exitCode: 1,
    durationMs: 1,
    cleanup: 'finished',
    output: unknown.diagnostic,
  } as any);
  expect(safe).toMatchObject({
    reportedPlugin: 'unclassified',
    reportedHook: 'unclassified',
    reportedModule: 'unclassified',
  });
  expect(safe).toHaveProperty('reportedModuleHash');
  expect(JSON.stringify(safe)).not.toContain(canary);
});
it('observes a genuine second SSR build for the pinned Epic legacy compiler branch', async () => {
  const result = await observedBootstrap(true, false);
  expect(result.passed).toBe(true);
  expect(result.calls).toEqual(['client', 'ssr']);
  expect(result.stored).toMatchObject({
    environment: 'ssr',
    virtualCode: 'export const routes = {};',
    cssUrlModules: [{ path: 'app/styles/tailwind.css?url' }],
  });
});
it('keeps Environment API compilation combined and rejects unsupported legacy selection', async () => {
  expect(await observedBootstrap(false, true)).toMatchObject({ passed: true, calls: ['client'] });
  expect(await observedBootstrap(false, false)).toMatchObject({ passed: false });
  expect(await observedBootstrap(true, false, '7.17.0')).toMatchObject({ passed: false });
});
it('preserves failed command provenance with bounded projections and no raw output or labels', () => {
  const secret = 'private-test-token-canary';
  const command = {
    commandId: secret,
    status: secret,
    exitCode: 9,
    durationMs: 42,
    cleanup: secret,
    output: secret + ' https://private.example/path',
    commandHash: 'sha256:' + 'a'.repeat(64),
  };
  const projection = compilerRunDiagnostics({
    commands: [
      { ...command, commandId: 'react-router-compiler', status: 'failed', cleanup: 'finished' },
      ...Array.from({ length: 7 }, () => command),
    ],
    outputReceipts: [],
  } as any);
  expect(projection.commandCount).toBe(8);
  expect(projection.commands).toHaveLength(4);
  expect(projection.commands[0]).toMatchObject({
    id: 'react-router-compiler',
    status: 'failed',
    exitCode: 9,
    durationMs: 42,
    cleanup: 'finished',
    outputHash: storedChecksum(command.output),
  });
  expect(projection.commands[1]).toMatchObject({
    id: 'unclassified',
    status: 'unclassified',
    cleanup: 'unconfirmed',
  });
  expect(JSON.stringify(projection)).not.toContain(secret);
  expect(JSON.stringify(projection)).not.toContain('private.example');
});
it('projects only closed bootstrap failure markers and hashes unknown child errors', () => {
  const command = {
    commandId: 'react-router-compiler',
    status: 'failed',
    exitCode: 1,
    durationMs: 12,
    cleanup: 'finished',
    output:
      'PORTAL_COMPILER_OBSERVATION_FAILED phase=ssr-build cause=SECRET_CANARY errorCode=UNRESOLVED_IMPORT messageHash=' +
      'a'.repeat(64) +
      '\n',
  } as any;
  const projected = compilerCommandDiagnostics(command);
  expect(projected).toMatchObject({
    reportedPhase: 'ssr-build',
    reportedCause: 'unclassified',
    reportedCode: 'UNRESOLVED_IMPORT',
    reportedMessageHash: 'a'.repeat(64),
    reportedMarkerOnly: true,
  });
  expect(JSON.stringify(projected)).not.toContain('SECRET_CANARY');
  expect(
    compilerCommandDiagnostics({
      ...command,
      output: command.output.replace('phase=ssr-build', 'phase=SECRET_CANARY'),
    }),
  ).not.toHaveProperty('reportedPhase');
});
afterEach(async () => {
  await Promise.all(runners.splice(0).map(r => r.close()));
  await Promise.all(
    roots.splice(0).map(async r => {
      const owned = generatedTypeRoots.get(r);
      if (owned) {
        const canonical = await realpath(r),
          base = await realpath(tmpdir()),
          info = await lstat(r, { bigint: true });
        const within = relative(owned.base, canonical);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          info.dev !== owned.dev ||
          info.ino !== owned.ino ||
          canonical.toLowerCase() !== owned.canonical.toLowerCase() ||
          base.toLowerCase() !== owned.base.toLowerCase() ||
          dirname(canonical).toLowerCase() !== owned.base.toLowerCase() ||
          !within ||
          within.startsWith('..') ||
          isAbsolute(within) ||
          !basename(canonical).startsWith(owned.prefix)
        )
          throw Error('Refusing cleanup of changed generated-type fixture root');
      }
      await rm(r, { recursive: true, force: true });
      generatedTypeRoots.delete(r);
    }),
  );
});
it('accepts literal reviewed framework configs and rejects executable custom, aliased or spread config', () => {
  expect(() =>
    assertReactRouterCompilerConfiguration(
      'react-router.config.ts',
      'import type {Config} from "@react-router/dev/config"; export default {ssr:true} satisfies Config;',
    ),
  ).not.toThrow();
  expect(() =>
    assertReactRouterCompilerConfiguration(
      'vite.config.ts',
      'import {reactRouter as rr} from "@react-router/dev/vite"; import tailwind from "@tailwindcss/vite"; import {defineConfig as define} from "vite"; export default define({plugins:[tailwind(),rr()],resolve:{tsconfigPaths:true},environments:{ssr:{build:{rollupOptions:{input:"./server/app.ts"}}}}});',
    ),
  ).not.toThrow();
  for (const source of [
    'import {defineConfig} from "vite"; import arbitrary from "./plugin";export default defineConfig({plugins:[arbitrary()]});',
    'import {defineConfig} from "vite";export default defineConfig({...process.env});',
    'import {defineConfig} from "vite";const cfg={};export default defineConfig(cfg);',
    'import {defineConfig} from "vite";export default defineConfig({get plugins(){return []}});',
    'import {defineConfig} from "vite";export default defineConfig({__proto__:{}});',
    'import {defineConfig} from "vite";export default defineConfig({root:"../foreign"});',
    'import {defineConfig} from "vite";export default defineConfig({build:{outDir:"../foreign"}});',
    'import {defineConfig} from "vite";export default defineConfig({environments:{ssr:{build:{rollupOptions:{input:"../foreign.ts"}}}}});',
    'import {defineConfig} from "vite";export default defineConfig({resolve:{tsconfigPaths:true,alias:{fake:"../foreign"}}});',
  ])
    expect(() => assertReactRouterCompilerConfiguration('vite.config.ts', source)).toThrow(
      'PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED',
    );
  expect(() =>
    assertReactRouterCompilerConfiguration(
      'react-router.config.ts',
      'export default {ssr:true,buildDirectory:"../foreign"};',
    ),
  ).toThrow('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  expect(() =>
    assertReactRouterCompilerConfiguration('react-router.config.ts', 'export default {ssr:false};'),
  ).toThrow('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
});

it('rejects an actual native caller-written fake build as React Router compiler authority', async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'sfp-compiler-source-'));
  roots.push(sourceRoot);
  const files = {
    'package.json': '{"type":"module","devDependencies":{"@react-router/dev":"8.4.0"}}',
    'react-router.config.ts': 'export default {ssr:true};',
    'vite.config.ts': 'export default {};',
    'server/app.ts': 'export const app = {};',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
    await writeFile(join(sourceRoot, path), text);
  }
  const reader = new RepoReader({ rootDir: sourceRoot }),
    inventory = await collectPortalSourceInventory(reader);
  const source = await captureReactRouterCompilerSource(
    reader,
    'sha256:' + 'a'.repeat(64),
    inventory,
  );
  const work = await mkdtemp(join(tmpdir(), 'sfp-fake-compiler-work-'));
  roots.push(work);
  const fake =
    'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("compiler-workspace/source/build/server",{recursive:true});mkdirSync("compiler-workspace/source/.react-router",{recursive:true});writeFileSync("compiler-workspace/source/build/server/index.js","export const invented = true;");writeFileSync("compiler-workspace/source/.react-router/fake.d.ts","export {};");';
  await writeFile(join(work, 'fake.mjs'), fake);
  const profile: NativeProfile = {
    schemaVersion: 1 as const,
    sourceAuthorityVersion: 2,
    id: 'fake-compiler',
    executionMode: 'native-working-copy' as const,
    environmentKind: 'disposable-test' as const,
    sourceHash: source.inputHash,
    closure: [{ path: 'fake.mjs', hash: storedChecksum(fake) }],
    environment: {},
    commands: [
      {
        id: 'fake',
        executable: process.execPath,
        executableHash: await nativeExecutableHash(process.execPath),
        args: ['fake.mjs'],
        cwd: '.',
        timeoutMs: 30000,
        maxOutputBytes: 65536,
        allowLifecycleScripts: false,
        produces: [
          { path: 'compiler-workspace/source/build', kind: 'generated-output' as const },
          { path: 'compiler-workspace/source/.react-router', kind: 'generated-output' as const },
        ],
      },
    ],
  };
  const runner = new NativePortalRunner();
  runners.push(runner);
  profile['artifactAuthority'] = await prepareNativeArtifactAuthority(profile);
  const signal = new AbortController().signal,
    result = await runner.execute(
      'fake-run',
      profile,
      work,
      source.inputHash,
      signal,
      Date.now() + 60000,
    );
  expect(result.commands[0]?.status).toBe('passed');
  await expect(
    captureReactRouterCompilerEvidence({
      source,
      ownerId: 'owner',
      generation: 'generation',
      workspaceId: 'fixture-workspace',
      originPlanId: 'fixture-plan',
      originContextHash: 'sha256:' + 'a'.repeat(64),
      root: work,
      runId: 'fake-run',
      profile,
      result,
      signal,
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_COMPILER_PROFILE_REQUIRED' });
});

function closedPnpmFixture() {
  const packages = [
    '@react-router/dev',
    '@react-router/express',
    'react-router',
    'vite',
    '@tailwindcss/vite',
    'express',
  ];
  const text =
    "lockfileVersion: '9.0'\nimporters:\n  node-custom-server:\n    devDependencies:\n" +
    packages.map(p => `      '${p}':\n        specifier: '*'\n        version: 8.4.0\n`).join('') +
    'packages:\n' +
    packages
      .map(p => `  '${p}@8.4.0':\n    resolution: {integrity: sha512-Zml4dHVyZQ==}\n`)
      .join('');
  return text;
}
it('reads closed pnpm v9 importer/version/integrity facts and rejects a different importer', () => {
  const text = closedPnpmFixture();
  const records = readReactRouterPnpmLock(text, 'node-custom-server');
  expect(records.get('@react-router/dev')).toMatchObject({ specifier: '*', version: '8.4.0' });
  expect(records.get('vite')?.integrity).toMatch(/^sha512-/u);
  expect(() => readReactRouterPnpmLock(text, 'missing-importer')).toThrow(
    'PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED',
  );
  expect(() =>
    readReactRouterPnpmLock(
      text.replace("lockfileVersion: '9.0'", "lockfileVersion: '10.0'"),
      'node-custom-server',
    ),
  ).toThrow('PORTAL_COMPILER_LOCK_UNSUPPORTED');
});

it.each(["lockfileVersion: '10.0'\n", 'importers: {}\n', 'unreviewedCompilerSection: {}\n'])(
  'rejects contradictory or unsupported top-level lock facts %#',
  suffix => {
    expect(() =>
      readReactRouterPnpmLock(closedPnpmFixture() + suffix, 'node-custom-server'),
    ).toThrow(/PORTAL_COMPILER_LOCK_(?:AMBIGUOUS|UNSUPPORTED)/u);
  },
);

it('does not grant fixed icon-output capability to a caller fabricated or serialized profile', async () => {
  const { reactRouterCompilerAllowsIconOutput } =
    await import('../../src/portal/react-router-compiler-evidence.js');
  const profile = { sourceHash: 'sha256:' + 'a'.repeat(64) } as NativeProfile;
  for (const leaf of ['sprite.svg', 'types.ts'])
    expect(
      reactRouterCompilerAllowsIconOutput(
        profile,
        'compiler-workspace/source/app/components/ui/icons/' + leaf,
        'compiler-workspace',
      ),
    ).toBe(false);
});
