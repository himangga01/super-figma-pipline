import { expect, it } from 'vitest';

import { resolvePortalModules } from '../../src/portal/module-resolution.js';

const graph = (files: Record<string, string>, opaque: string[] = []) =>
  resolvePortalModules(new Map(Object.entries(files)), [...Object.keys(files), ...opaque]);

it('resolves imports, CommonJS, literal dynamic imports and re-exports to source files', () => {
  const result = graph({
    'src/main.mts': `import { value } from './value.js';
      export * from './folder'; export { thing } from './legacy.cjs';
      const data = require('./data.json'); const lazy = import('./lazy.mjs');`,
    'src/value.ts': 'export const value = 1;',
    'src/folder/index.tsx': 'export const View = () => null;',
    'src/legacy.cts': 'export const thing = 2;',
    'src/data.json': '{"name":"data"}',
    'src/lazy.mts': 'export default 1;',
  });
  expect(result.complete).toBe(true);
  expect(result.references.map(ref => [ref.kind, ref.targets])).toEqual([
    ['import', ['src/value.ts']],
    ['re-export', ['src/folder/index.tsx']],
    ['re-export', ['src/legacy.cts']],
    ['require', ['src/data.json']],
    ['dynamic-import', ['src/lazy.mts']],
  ]);
});

it('resolves inherited JSONC path aliases with config-relative origins and workspace exports', () => {
  const result = graph({
    'tsconfig.base.json': `{// configuration comment
      "compilerOptions": {"baseUrl":".","paths":{"@shared/*":["packages/shared/src/*"],},},
    }`,
    'apps/web/tsconfig.json': '{"extends":"../../tsconfig.base.json"}',
    'apps/web/package.json': '{"dependencies":{"@acme/data":"workspace:*"}}',
    'apps/web/index.ts': `import '@shared/types'; import '@acme/data/client';`,
    'packages/shared/src/types.ts': 'export type Value = string;',
    'packages/data/package.json': JSON.stringify({
      name: '@acme/data',
      exports: { './client': { import: './src/client.ts', require: './src/client.cts' } },
    }),
    'packages/data/src/client.ts': 'export const client = 1;',
    'packages/data/src/client.cts': 'module.exports = {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]?.targets).toEqual(['packages/shared/src/types.ts']);
  expect(result.references[1]?.targets).toEqual([
    'packages/data/src/client.cts',
    'packages/data/src/client.ts',
  ]);
  expect(result.references[0]?.configuration).toEqual([
    'apps/web/tsconfig.json',
    'tsconfig.base.json',
  ]);
  expect(result.references[1]?.configuration).toContain('packages/data/package.json');
});

it('distinguishes builtins and declared external dependencies from unresolved inputs', () => {
  const result = graph({
    'package.json': '{"dependencies":{"react":"19","@scope/pkg":"1"}}',
    'main.ts': `import 'node:fs'; import 'react'; import '@scope/pkg/sub';
      import './missing'; import 'undeclared'; const name = 'x'; import(name); require(name);`,
  });
  expect(result.references.map(ref => ref.status)).toEqual([
    'builtin',
    'external',
    'external',
    'unresolved',
    'unresolved',
    'unresolved',
    'unresolved',
  ]);
  expect(result.complete).toBe(false);
  expect(result.references.slice(-2).every(ref => ref.reason === 'nonliteral-module')).toBe(true);
});

it('keeps ignored/generated inventory members resolvable and flags unparsed code targets', () => {
  const result = graph(
    {
      'main.ts': `import './build/client.js'; import './asset.bin';`,
    },
    ['build/client.js', 'asset.bin'],
  );
  expect(result.references[0]).toMatchObject({
    status: 'unresolved',
    targets: ['build/client.js'],
    reason: 'source-text-unavailable',
  });
  expect(result.references[1]).toMatchObject({ status: 'resolved', targets: ['asset.bin'] });
  expect(result.complete).toBe(false);
});

it('does not silently resolve escaped, case-aliased, blocked export or duplicate package paths', () => {
  const result = graph({
    'package.json': '{"workspaces":["a","b","c"]}',
    'main.ts': `import '../outside'; import './ALIAS'; import 'pkg/private'; import 'dup';`,
    'alias.ts': 'export {};',
    'a/package.json': '{"name":"pkg","exports":{".":"./index.ts"}}',
    'a/index.ts': 'export {};',
    'a/private.ts': 'export {};',
    'b/package.json': '{"name":"dup","main":"index.ts"}',
    'b/index.ts': 'export {};',
    'c/package.json': '{"name":"dup","main":"index.ts"}',
    'c/index.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references.every(ref => ref.status === 'unresolved')).toBe(true);
  expect(result.references.map(ref => ref.reason)).toEqual([
    'path-outside-source',
    'case-mismatched-target',
    'package-export-not-supported',
    'ambiguous-workspace-package',
  ]);
});

it('marks invalid syntax, unsupported config inheritance and truncated analysis incomplete', () => {
  expect(graph({ 'broken.ts': 'export const = 1;' }).complete).toBe(false);
  const inherited = graph({
    'tsconfig.json': '{"extends":"@vendor/tsconfig"}',
    'main.ts': `import '@app/main';`,
  });
  expect(inherited.complete).toBe(false);
  expect(inherited.issues).toContain('CONFIG_EXTENDS_UNSUPPORTED:tsconfig.json');
  const cyclic = graph({
    'tsconfig.json': '{"extends":"./base.json"}',
    'base.json': '{"extends":"./tsconfig.json"}',
    'main.ts': 'export {};',
  });
  expect(cyclic.complete).toBe(false);
  expect(cyclic.issues.some(issue => issue.startsWith('CONFIG_CYCLE:'))).toBe(true);
  const limited = resolvePortalModules(new Map([['a.ts', "import 'a'; import 'b';"]]), ['a.ts'], {
    maxReferences: 1,
  });
  expect(limited.complete).toBe(false);
  expect(limited.issues).toContain('MODULE_REFERENCE_LIMIT');
});

it('never executes source or configuration and remains deterministic', () => {
  const files = {
    'package.json': '{"name":"fixture"}',
    'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"x":["./x.ts"]}}}',
    'main.ts': `throw new Error('must not run'); import 'x';`,
    'x.ts': 'export const x = 1;',
  };
  expect(graph(files)).toEqual(graph(Object.fromEntries(Object.entries(files).toReversed())));
});

it('resolves Vue and Svelte scripts and TypeScript import-equals without executing templates', () => {
  const result = graph({
    'App.vue':
      '<template><span>import("./fake")</span></template><script setup lang="ts">import "./value";</script>',
    'Other.svelte': '<script>import "./value";</script><p>View</p>',
    'legacy.cts': 'import value = require("./value");',
    'value.ts': 'export const value = 1;',
  });
  expect(result.complete).toBe(true);
  expect(result.references).toHaveLength(3);
  expect(result.references.every(ref => ref.targets[0] === 'value.ts')).toBe(true);
  expect(graph({ 'external.vue': '<script src="./outside.js"></script>' }).complete).toBe(false);
});

it('keeps conditional wildcard exports conservative and blocks uncertain require bindings', () => {
  const result = graph({
    'package.json': '{"workspaces":["pkg"]}',
    'main.ts': 'import "pkg/features/one";',
    'pkg/package.json':
      '{"name":"pkg","exports":{"./features/*":{"browser":"./browser/*.ts","default":"./node/*.ts"}}}',
    'pkg/browser/one.ts': 'export {};',
    'pkg/node/one.ts': 'export {};',
    'shadowed.ts': 'function custom(require) { require("./different"); }',
  });
  expect(result.references[0]?.targets).toEqual(['pkg/browser/one.ts', 'pkg/node/one.ts']);
  expect(result.references[1]?.reason).toBe('require-binding-needs-review');
  expect(result.complete).toBe(false);
});

it('fences member and custom module loaders and resolves import-type source dependencies', () => {
  for (const source of [
    'module.require("./missing.cjs");',
    'import { createRequire as make } from "node:module"; const load = make(import.meta.url); load("./missing.cjs");',
    'export type Item = import("./missing").Item;',
  ])
    expect(graph({ 'main.ts': source }).complete).toBe(false);
  expect(
    graph({
      'main.ts': 'export type Item = import("./value").Item;',
      'value.ts': 'export type Item = string;',
    }).references[0]?.targets,
  ).toEqual(['value.ts']);
});

it('does not use uninstalled fixture manifests to shadow external dependencies', () => {
  const files = {
    'main.ts': 'import "uninstalled";',
    'fixtures/package.json': '{"name":"uninstalled","main":"index.js"}',
    'fixtures/index.js': 'export {};',
  };
  expect(graph(files)).toMatchObject({
    complete: false,
    references: [{ status: 'unresolved', targets: [] }],
  });
  expect(graph({ ...files, 'package.json': '{"dependencies":{"uninstalled":"1"}}' })).toMatchObject(
    { complete: true, references: [{ status: 'external', targets: [] }] },
  );
});

it('honors explicit external aliases and file targets ahead of matching workspace names', () => {
  const fixture = {
    'main.ts': 'import "pkg";',
    'packages/local/package.json': '{"name":"pkg","main":"index.js"}',
    'packages/local/index.js': 'export {};',
    'outside/package.json': '{"name":"file-target","main":"index.js"}',
    'outside/index.js': 'export {};',
  };
  const alias = graph({
    ...fixture,
    'package.json': '{"workspaces":["packages/*"],"dependencies":{"pkg":"npm:remote-package@1"}}',
  });
  expect(alias.references[0]).toMatchObject({ status: 'external', targets: [] });
  const local = graph({
    ...fixture,
    'package.json': '{"workspaces":["packages/*"],"dependencies":{"pkg":"file:./outside"}}',
  });
  expect(local.references[0]).toMatchObject({ status: 'resolved', targets: ['outside/index.js'] });
});

it('does not guess workspace version ranges or self-references without exports', () => {
  const uncertain = graph({
    'package.json': '{"workspaces":["packages/*"],"dependencies":{"pkg":"^2.0.0"}}',
    'main.ts': 'import "pkg";',
    'packages/local/package.json': '{"name":"pkg","version":"1.0.0","main":"index.js"}',
    'packages/local/index.js': 'export {};',
  });
  expect(uncertain).toMatchObject({
    complete: false,
    references: [{ reason: 'workspace-version-selection-requires-review' }],
  });
  expect(
    graph({ 'package.json': '{"name":"pkg","main":"main.ts"}', 'main.ts': 'import "pkg";' })
      .complete,
  ).toBe(false);
});

it('prioritizes an exported self-reference over a same-name external dependency selector', () => {
  const result = graph({
    'package.json':
      '{"name":"pkg","exports":"./self.cjs","dependencies":{"pkg":"npm:remote-package@1"}}',
    'main.cjs': 'require("pkg");',
    'self.cjs': 'module.exports = 1;',
  });
  expect(result).toMatchObject({
    complete: true,
    references: [{ status: 'resolved', targets: ['self.cjs'] }],
  });
});

it('reports unsupported project references instead of silently ignoring their application aliases', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}',
    'tsconfig.app.json':
      '{"compilerOptions":{"paths":{"dep":["./src/local.ts"]}},"include":["src"]}',
    'package.json': '{"dependencies":{"dep":"1"}}',
    'src/main.ts': 'import "dep";',
    'src/local.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('CONFIG_PROJECT_REFERENCES_REQUIRE_REVIEW:tsconfig.json');
});

it('bounds wide AST arrays without throwing before the traversal limit', () => {
  const source = 'export const data = [' + '0,'.repeat(130000) + '];';
  expect(Buffer.byteLength(source)).toBeLessThan(262144);
  const result = graph({ 'wide.ts': source });
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('MODULE_AST_LIMIT:wide.ts');
});

it('fences destructured, default, rest, reassigned and caught require bindings', () => {
  for (const source of [
    'const { require } = customLoader; require("./local");',
    'function load({ require }) { require("./local"); }',
    'function load(require = customLoader) { require("./local"); }',
    'function load(...require) { require("./local"); }',
    'require = customLoader; require("./local");',
    'try {} catch (require) { require("./local"); }',
  ])
    expect(graph({ 'main.cjs': source, 'local.js': 'module.exports=1;' })).toMatchObject({
      complete: false,
      references: [{ status: 'unresolved', reason: 'require-binding-needs-review' }],
    });
});

it('rejects mixed export conditions and subpath keys at every selected level', () => {
  for (const exports of [
    { '.': './index.ts', browser: './browser.ts' },
    { '.': { browser: './browser.ts', './invalid': './index.ts' } },
  ]) {
    const result = graph({
      'package.json': '{"workspaces":["pkg"]}',
      'main.ts': 'import "pkg";',
      'pkg/package.json': JSON.stringify({ name: 'pkg', exports }),
      'pkg/index.ts': 'export {};',
      'pkg/browser.ts': 'export {};',
    });
    expect(result).toMatchObject({
      complete: false,
      references: [{ status: 'unresolved', reason: 'package-export-not-supported' }],
    });
  }
});
