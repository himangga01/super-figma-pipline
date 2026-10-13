import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import * as evidence from '../../src/portal/react-router-compiler-evidence.js';

const cleanup: Array<{
  root: string;
  parent: string;
  dev: bigint;
  ino: bigint;
  parentDev: bigint;
  parentIno: bigint;
}> = [];
const pathKey = (value: string) =>
  process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const entry of cleanup.splice(0)) {
    const root = await lstat(entry.root, { bigint: true }),
      parent = await lstat(entry.parent, { bigint: true });
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      root.dev !== entry.dev ||
      root.ino !== entry.ino ||
      parent.dev !== entry.parentDev ||
      parent.ino !== entry.parentIno ||
      pathKey(await realpath(entry.root)) !== pathKey(entry.root) ||
      pathKey(dirname(entry.root)) !== pathKey(entry.parent) ||
      !basename(entry.root).startsWith('sfp-generated-route-alias-')
    )
      throw Error('TEST_CLEANUP_TARGET_CHANGED');
    await rm(entry.root, { recursive: true, force: true });
  }
});
async function actualReaderMap(nested = false) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, 'sfp-generated-route-alias-'));
  const stat = await lstat(root, { bigint: true }),
    parentStat = await lstat(parent, { bigint: true });
  cleanup.push({
    root,
    parent,
    dev: stat.dev,
    ino: stat.ino,
    parentDev: parentStat.dev,
    parentIno: parentStat.ino,
  });
  // Register cleanup before either operation can fail.
  await mkdir(join(root, 'types/app/+types'), { recursive: true });
  await writeFile(join(root, 'types/app/+types/root.ts'), 'export type Route = unknown;\n');
  if (nested) {
    await mkdir(join(root, 'types/app/+types/child'), { recursive: true });
    await writeFile(join(root, 'types/app/+types/child/root.ts'), 'export type Route = unknown;\n');
  }
  const modules = await evidence.readReactRouterGeneratedTypeModules(
    root,
    new AbortController().signal,
  );
  expect([...modules.keys()].toSorted()).toEqual([
    ...(nested ? ['.react-router/types/app/+types/child/root.ts'] : []),
    '.react-router/types/app/+types/root.ts',
    ...(nested ? ['app/+types/child/root.ts'] : []),
    'app/+types/root.ts',
  ]);
  modules.set('virtual:react-router/server-build', 'export const routes = {};');
  return modules;
}
function resolveImport(statement: string, modules: Map<string, string>, rootDirs = true) {
  const files = new Map([
    ['app/root.tsx', statement],
    [
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: rootDirs ? { rootDirs: ['.', './.react-router/types'] } : {},
      }),
    ],
    ['react-router.config.ts', 'export default {};'],
  ]);
  // Synthetic admission spy only; the actual reader supplies both producer aliases.
  vi.spyOn(evidence, 'admittedReactRouterCompilerEvidence').mockReturnValue({
    hash: 'sha256:' + 'a'.repeat(64),
    configuration: ['react-router.config.ts'],
    modules,
  });
  return resolvePortalModules(files, [...files.keys()], {
    reactRouterCompilerEvidence: {} as evidence.ReactRouterCompilerEvidence,
    sourceId: 'sha256:' + 'b'.repeat(64),
    sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
  });
}
it('denies runtime producer-shaped bare and prefixed generated route aliases while preserving admitted runtime virtual modules', async () => {
  const modules = await actualReaderMap(true);
  for (const statement of [
    "import { Route } from './+types/root.ts';",
    "import { type Route, runtime } from './+types/root.ts';",
    "void import('./+types/root.ts');",
    "import { Route } from '../.react-router/types/app/+types/root.ts';",
    "import { Route } from './+types/child/root.ts';",
  ])
    expect(resolveImport(statement, modules).complete).toBe(false);
  expect(
    resolveImport("import { routes } from 'virtual:react-router/server-build';", modules)
      .references[0],
  ).toMatchObject({ status: 'external', reason: 'observed-compiler-generated-module' });
});
it('requires rootDirs for type-only producer aliases and accepts the exact guarded generated member', async () => {
  const modules = await actualReaderMap();
  expect(
    resolveImport("import type { Route } from './+types/root.ts';", modules, false).complete,
  ).toBe(false);
  const result = resolveImport("import type { Route } from './+types/root.ts';", modules);
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    status: 'external',
    targets: [],
    reason: 'observed-compiler-generated-route-type',
  });
  expect(result.references[0]!.configuration).not.toContain(
    '.react-router/types/app/+types/root.ts',
  );
});
