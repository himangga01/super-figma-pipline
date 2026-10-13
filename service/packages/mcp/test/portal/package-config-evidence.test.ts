import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storedChecksum } from '@sfp/ir';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import {
  inventoryNativeArtifact,
  type NativeArtifactAuthority,
} from '../../src/portal/native-artifacts.js';
import { collectPortalSourceInventory } from '../../src/portal/source-inventory.js';

const roots: string[] = [];
const managedSharedIdentity = `import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='@sfp/shared') return nextResolve(pathToFileURL(resolve('packages/shared/src/index.ts')).href,context);
  return nextResolve(specifier,context);
}});`;

it('initializes CLI source commands in a fresh process without eager package artifact schemas', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './scripts/register-source.mjs',
      '--input-type',
      'module',
      '--eval',
      managedSharedIdentity +
        'await import("./packages/cli/src/commands.ts"); process.stdout.write("CLI_MODULE_INITIALIZED");',
    ],
    {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 262_144,
      windowsHide: true,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toBe('CLI_MODULE_INITIALIZED');
});

it('keeps pure module resolution independent of native artifact runtime initialization', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './scripts/register-source.mjs',
      '--input-type',
      'module',
      '--eval',
      managedSharedIdentity +
        `registerHooks({resolve(specifier,context,nextResolve){
      const result=nextResolve(specifier,context);
      if(result.url.endsWith('/portal/native-artifacts.ts')) throw Error('ARTIFACT_RUNTIME_EAGER_LOAD');
      return result;
    }});
    const {resolvePortalModules}=await import('./packages/mcp/src/portal/module-resolution.ts');
    const result=resolvePortalModules(new Map([['main.ts','export {};']]),['main.ts']);
    if(!result.complete) throw Error('PURE_MODULE_RESOLUTION_FAILED');
    process.stdout.write('PURE_MODULE_RESOLUTION_INITIALIZED');`,
    ],
    {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 262_144,
      windowsHide: true,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toBe('PURE_MODULE_RESOLUTION_INITIALIZED');
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const fixture = async (config = '{/* JSONC */"compilerOptions":{"strict":true,},}') => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-package-config-'));
  roots.push(root);
  const files = {
    'package.json': '{"devDependencies":{"@fixture/config":"1.2.3"}}',
    'package-lock.json':
      '{"lockfileVersion":3,"packages":{"node_modules/@fixture/config":{"version":"1.2.3","integrity":"sha512-Zml4dHVyZQ=="}}}',
    'tsconfig.json':
      '{"extends":["@fixture/config/typescript"],"compilerOptions":{"paths":{"dep":["./value.ts"]}}}',
    'main.ts': 'import "dep";',
    'value.ts': 'export {};',
  };
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  const tree = join(root, 'node_modules');
  const pkg = join(tree, '@fixture/config');
  await mkdir(pkg, { recursive: true });
  await writeFile(
    join(pkg, 'package.json'),
    '{"name":"@fixture/config","version":"1.2.3","exports":{"./typescript":{"types":"./typescript.json","default":"./wrong.json"}},"scripts":{"prepare":"node never-execute.js"}}',
  );
  await writeFile(join(pkg, 'typescript.json'), config);
  await writeFile(join(pkg, 'wrong.json'), '{"compilerOptions":{"moduleSuffixes":[".wrong"]}}');
  const reader = new RepoReader({ rootDir: root });
  const inventory = await collectPortalSourceInventory(reader);
  const authority: NativeArtifactAuthority = {
    version: 1,
    configurationHash: storedChecksum('configuration'),
    commandHash: storedChecksum('command'),
    artifacts: [
      {
        declaration: { root: tree, kind: 'node-package-tree' },
        inventory: await inventoryNativeArtifact(tree),
      },
    ],
    executables: [],
  };
  const sources = new Map(Object.entries(files).filter(([path]) => path !== 'package-lock.json'));
  return { root, pkg, tree, reader, inventory, authority, sources };
};

const collector = async () => {
  const module = await import('../../src/portal/package-config-evidence.js').catch(() => null);
  expect(module).not.toBeNull();
  return module!.capturePackageConfigEvidence;
};

it('admits source-bound JSONC config bytes and preserves excluded dependency source', async () => {
  const f = await fixture();
  const capture = await collector();
  const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
  expect(evidence.issues).toEqual([]);
  const compiler = ts.getParsedCommandLineOfConfigFile(
    join(f.root, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    },
  );
  expect(compiler?.errors).toEqual([]);
  expect(compiler?.options.strict).toBe(true);
  expect(evidence.packages[0]).toMatchObject({
    name: '@fixture/config',
    version: '1.2.3',
    ownerManifest: 'package.json',
  });
  const result = resolvePortalModules(
    f.sources,
    f.inventory.files.map(file => file.path),
    { packageConfigEvidence: evidence },
  );
  expect(result.complete).toBe(true);
  expect(result.references[0]?.targets).toEqual(['value.ts']);
  expect(result.references[0]?.configuration).toContain(
    'node_modules/@fixture/config/typescript.json',
  );
  expect(f.inventory.files.some(file => file.path.startsWith('node_modules/'))).toBe(false);
  expect(
    resolvePortalModules(
      f.sources,
      f.inventory.files.map(file => file.path),
    ).complete,
  ).toBe(false);
});

it('rejects changed artifact bytes, changed source bindings and fabricated receipts', async () => {
  const f = await fixture();
  const capture = await collector();
  const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
  const changed = new Map(f.sources).set('main.ts', 'import "other";');
  expect(
    resolvePortalModules(
      changed,
      f.inventory.files.map(file => file.path),
      { packageConfigEvidence: evidence },
    ).complete,
  ).toBe(false);
  expect(
    resolvePortalModules(
      f.sources,
      f.inventory.files.map(file => file.path),
      { packageConfigEvidence: { ...evidence } },
    ).complete,
  ).toBe(false);
  await writeFile(join(f.pkg, 'typescript.json'), '{}');
  const stale = await capture(f.reader, f.sources, f.inventory, f.authority);
  expect(stale.issues.length).toBeGreaterThan(0);
});

it('rejects config mutation after the admitted artifact inventory has been checked', async () => {
  const f = await fixture();
  const capture = await collector();
  let changed = false;
  const reader = new RepoReader({
    rootDir: f.root,
    afterFileOpen: async path => {
      if (path.endsWith('package-lock.json') && !changed) {
        changed = true;
        await writeFile(join(f.pkg, 'typescript.json'), '{"compilerOptions":{"strict":false}}');
      }
    },
  });
  const evidence = await capture(reader, f.sources, f.inventory, f.authority);
  expect(changed).toBe(true);
  expect(evidence.issues.length).toBeGreaterThan(0);
});

it('keeps malformed JSONC and local package config cycles blocking', async () => {
  const capture = await collector();
  for (const input of [
    '{/* unterminated',
    '{"extends":"./typescript.json"}',
    '{"compilerOptions":"invalid"}',
    '{"compilerOptions":{"baseUrl":"${configDir}"}}',
  ]) {
    const f = await fixture(input);
    const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
    expect(evidence.issues.length).toBeGreaterThan(0);
    expect(
      resolvePortalModules(
        f.sources,
        f.inventory.files.map(file => file.path),
        { packageConfigEvidence: evidence },
      ).complete,
    ).toBe(false);
  }
});

it('rejects missing admission, owner lock mutation, identity mismatch and ambiguous roots', async () => {
  const capture = await collector();
  const f = await fixture();
  expect(
    (await capture(f.reader, f.sources, f.inventory, { ...f.authority, artifacts: [] })).issues
      .length,
  ).toBeGreaterThan(0);
  expect(
    (
      await capture(f.reader, f.sources, f.inventory, {
        ...f.authority,
        artifacts: [...f.authority.artifacts, ...f.authority.artifacts],
      })
    ).issues.length,
  ).toBeGreaterThan(0);
  await writeFile(join(f.root, 'package-lock.json'), '{"changed":true}');
  expect(
    (await capture(f.reader, f.sources, f.inventory, f.authority)).issues.length,
  ).toBeGreaterThan(0);
  const wrong = await fixture();
  await writeFile(
    join(wrong.pkg, 'package.json'),
    '{"name":"other","version":"1.2.3","exports":{"./typescript":"./typescript.json"}}',
  );
  wrong.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(wrong.tree);
  expect(
    (await capture(wrong.reader, wrong.sources, wrong.inventory, wrong.authority)).issues.length,
  ).toBeGreaterThan(0);
});

it('does not follow package links outside the admitted tree', async () => {
  const capture = await collector();
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'sfp-package-outside-'));
  roots.push(outside);
  await writeFile(join(outside, 'package.json'), '{"name":"@fixture/config","version":"1.2.3"}');
  await rm(f.pkg, { recursive: true });
  await symlink(outside, f.pkg, process.platform === 'win32' ? 'junction' : 'dir');
  expect(
    (await capture(f.reader, f.sources, f.inventory, f.authority)).issues.length,
  ).toBeGreaterThan(0);
});

it('admits an in-tree package link and rejects missing, escaped or non-JSON export targets', async () => {
  const capture = await collector();
  const f = await fixture();
  const stored = join(f.tree, '.pnpm/config/node_modules/@fixture/config');
  await mkdir(join(stored, '..'), { recursive: true });
  await rename(f.pkg, stored);
  await symlink(stored, f.pkg, process.platform === 'win32' ? 'junction' : 'dir');
  f.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(f.tree);
  expect((await capture(f.reader, f.sources, f.inventory, f.authority)).issues).toEqual([]);
  for (const target of ['./missing.json', '../escape.json', './index.js']) {
    const bad = await fixture();
    await writeFile(
      join(bad.pkg, 'package.json'),
      JSON.stringify({
        name: '@fixture/config',
        version: '1.2.3',
        exports: { './typescript': target },
      }),
    );
    bad.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(bad.tree);
    expect(
      (await capture(bad.reader, bad.sources, bad.inventory, bad.authority)).issues.length,
    ).toBeGreaterThan(0);
  }
});

it('rejects mixed export shapes and package version disagreement with the owner lock', async () => {
  const capture = await collector();
  for (const exports of [
    { './typescript': './typescript.json', default: './wrong.json' },
    { './typescript': ['../escape.json', './typescript.json'] },
  ]) {
    const f = await fixture();
    await writeFile(
      join(f.pkg, 'package.json'),
      JSON.stringify({ name: '@fixture/config', version: '1.2.3', exports }),
    );
    f.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(f.tree);
    expect(
      (await capture(f.reader, f.sources, f.inventory, f.authority)).issues.length,
    ).toBeGreaterThan(0);
  }
  const f = await fixture();
  f.sources.set('package.json', '{"devDependencies":{"@fixture/config":"^1.2.3"}}');
  await writeFile(join(f.root, 'package.json'), f.sources.get('package.json')!);
  f.inventory = await collectPortalSourceInventory(new RepoReader({ rootDir: f.root }));
  await writeFile(
    join(f.pkg, 'package.json'),
    '{"name":"@fixture/config","version":"1.2.4","exports":{"./typescript":"./typescript.json"}}',
  );
  f.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(f.tree);
  expect((await capture(f.reader, f.sources, f.inventory, f.authority)).issues).toContain(
    'PACKAGE_CONFIG_LOCK:tsconfig.json',
  );
});

const compilerSensitiveFixture = async (selection: Record<string, unknown>) => {
  const f = await fixture('{"compilerOptions":{"paths":{"dep":["../../../ordinary.ts"]}}}');
  await writeFile(
    join(f.pkg, 'special.json'),
    '{"compilerOptions":{"paths":{"dep":["../../../special.ts"]}}}',
  );
  await writeFile(
    join(f.pkg, 'package.json'),
    JSON.stringify({ name: '@fixture/config', version: '1.2.3', ...selection }),
  );
  for (const [path, text] of Object.entries({
    'tsconfig.json': '{"extends":"@fixture/config/typescript"}',
    'ordinary.ts': 'export {};',
    'special.ts': 'export {};',
  })) {
    f.sources.set(path, text);
    await writeFile(join(f.root, path), text);
  }
  f.inventory = await collectPortalSourceInventory(new RepoReader({ rootDir: f.root }));
  f.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(f.tree);
  const compiler = ts.getParsedCommandLineOfConfigFile(
    join(f.root, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  expect(compiler?.errors).toEqual([]);
  const target = ts.resolveModuleName('dep', join(f.root, 'main.ts'), compiler!.options, ts.sys)
    .resolvedModule?.resolvedFileName;
  expect(target?.replaceAll('\\', '/')).toBe(join(f.root, 'special.ts').replaceAll('\\', '/'));
  return f;
};

it('keeps versioned types export conditions unknown instead of selecting a different config', async () => {
  const f = await compilerSensitiveFixture({
    exports: { './typescript': { 'types@>=5.0': './special.json', default: './typescript.json' } },
  });
  const capture = await collector();
  const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
  expect(evidence.issues).toContain('PACKAGE_CONFIG_COMPILER_SELECTION_UNSUPPORTED:tsconfig.json');
  const result = resolvePortalModules(
    f.sources,
    f.inventory.files.map(file => file.path),
    { packageConfigEvidence: evidence },
  );
  expect(result.complete).toBe(false);
  expect(result.references[0]?.targets).not.toContain('ordinary.ts');
});

it('keeps typesVersions maps unknown instead of selecting the unmapped config', async () => {
  const f = await compilerSensitiveFixture({
    typesVersions: { '*': { typescript: ['special.json'] } },
  });
  const capture = await collector();
  const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
  expect(evidence.issues).toContain('PACKAGE_CONFIG_COMPILER_SELECTION_UNSUPPORTED:tsconfig.json');
  const result = resolvePortalModules(
    f.sources,
    f.inventory.files.map(file => file.path),
    { packageConfigEvidence: evidence },
  );
  expect(result.complete).toBe(false);
  expect(result.references[0]?.targets).not.toContain('ordinary.ts');
});

it('preserves package-relative path origins and child overrides without admitting runtime source', async () => {
  const capture = await collector();
  const f = await fixture(
    '{"extends":["./base.json"],"compilerOptions":{"paths":{"fromPackage":["./runtime.ts"]},"outDir":"./output"}}',
  );
  await writeFile(join(f.pkg, 'base.json'), '{"compilerOptions":{"checkJs":true}}');
  await writeFile(join(f.pkg, 'runtime.ts'), 'export {};');
  f.authority.artifacts[0]!.inventory = await inventoryNativeArtifact(f.tree);
  f.sources.set('tsconfig.json', '{"extends":["@fixture/config/typescript"]}');
  f.sources.set('main.ts', 'import "fromPackage";');
  await writeFile(join(f.root, 'tsconfig.json'), f.sources.get('tsconfig.json')!);
  await writeFile(join(f.root, 'main.ts'), f.sources.get('main.ts')!);
  f.inventory = await collectPortalSourceInventory(new RepoReader({ rootDir: f.root }));
  const evidence = await capture(f.reader, f.sources, f.inventory, f.authority);
  expect(evidence.issues).toEqual([]);
  const result = resolvePortalModules(
    f.sources,
    f.inventory.files.map(file => file.path),
    { packageConfigEvidence: evidence },
  );
  expect(result.complete).toBe(false);
  expect(result.references[0]?.status).toBe('unresolved');
  expect(result.references[0]?.targets).not.toContain('value.ts');
});
