import { createHash } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import * as compilerEvidence from '../../src/portal/react-router-compiler-evidence.js';
import { analyzePortalServiceConnections } from '../../src/portal/service-connections.js';

const graph = (files: Record<string, string>, opaque: string[] = []) =>
  resolvePortalModules(new Map(Object.entries(files)), [...Object.keys(files), ...opaque]);

it('resolves a top-level immutable literal import binding without executing source', () => {
  const result = graph({
    'server.js': 'const BUILD_PATH = "./server-app.js"; export const app = import(BUILD_PATH);',
    'server-app.js': 'export const app = {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    kind: 'dynamic-import',
    specifier: './server-app.js',
    status: 'resolved',
    targets: ['server-app.js'],
  });
});

it('retains a known constant production target as missing instead of inventing build evidence', () => {
  const result = graph({
    'server.js': 'const BUILD_PATH = "./build/server/index.js"; await import(BUILD_PATH);',
  });
  expect(result.complete).toBe(false);
  expect(result.references[0]).toMatchObject({
    specifier: './build/server/index.js',
    status: 'unresolved',
    reason: 'module-target-missing',
    targets: [],
  });
});

it.each([
  'let PATH = "./dep.js"; import(PATH);',
  'var PATH = "./dep.js"; import(PATH);',
  'const PATH = "./dep.js"; PATH = "./other.js"; import(PATH);',
  'const PATH = "./dep.js"; function select(PATH) { return import(PATH); }',
  'const PATH = "./dep.js"; { const PATH = "./other.js"; import(PATH); }',
  'import(PATH); const PATH = "./dep.js";',
  'const PATH = "./" + "dep.js"; import(PATH);',
  'const PATH = `./dep.js`; import(PATH);',
  'const OTHER = "./dep.js"; const PATH = OTHER; import(PATH);',
  'const {PATH} = {PATH:"./dep.js"}; import(PATH);',
])('keeps uncertain or shadowed import binding blocked %#', source => {
  const result = graph({ 'server.js': source, 'dep.js': 'export {};', 'other.js': 'export {};' });
  expect(result.complete).toBe(false);
  expect(result.references.some(reference => reference.reason === 'nonliteral-module')).toBe(true);
});

it('resolves native require literal bindings while keeping custom/shadowed require blocked', () => {
  const files = {
    'server.cjs': 'const PATH = "./dep.cjs"; module.exports = require(PATH);',
    'dep.cjs': 'module.exports = {};',
  };
  expect(graph(files).references[0]).toMatchObject({ specifier: './dep.cjs', status: 'resolved' });
  const shadowed = graph({
    ...files,
    'server.cjs': 'const PATH = "./dep.cjs"; function run(require) { return require(PATH); }',
  });
  expect(shadowed.complete).toBe(false);
  expect(shadowed.references[0]?.reason).toBe('require-binding-needs-review');
});

it('merges array extends left to right with per-parent origins and child overrides', () => {
  const result = graph({
    'tsconfig.json':
      '{"extends":["./a/base.json","./b/base.json"],"compilerOptions":{"rootDirs":[]}}',
    'a/base.json': '{"compilerOptions":{"paths":{"dep":["./a.ts"]},"rootDirs":[".","generated"]}}',
    'b/base.json': '{"compilerOptions":{"paths":{"dep":["./b.ts"]}}}',
    'b/b.ts': 'export {};',
    'a/a.ts': 'export {};',
    'main.ts': 'import "dep";',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    targets: ['b/b.ts'],
    configuration: ['a/base.json', 'b/base.json', 'tsconfig.json'],
  });
});

it('uses the final inherited baseUrl with the last parent paths declaration', () => {
  const result = graph({
    'tsconfig.json': '{"extends":["./a/base.json","./b/base.json"]}',
    'a/base.json': '{"compilerOptions":{"baseUrl":"."}}',
    'b/base.json': '{"compilerOptions":{"paths":{"dep":["./value.ts"]}}}',
    'a/value.ts': 'export {};',
    'b/value.ts': 'export {};',
    'main.ts': 'import "dep";',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]?.targets).toEqual(['a/value.ts']);
});

it('keeps malformed, excessive and cyclic array extends blocking', () => {
  for (const extendsValue of [
    [null],
    Array.from({ length: 33 }, () => './base.json'),
    ['./base.json'],
  ]) {
    const result = graph({
      'tsconfig.json': JSON.stringify({ extends: extendsValue }),
      'base.json': '{"extends":["./tsconfig.json"]}',
      'main.ts': 'export {};',
    });
    expect(result.complete).toBe(false);
  }
});

it('resolves .tsx to verified .ts through selected TypeScript configuration and rootDirs', () => {
  const result = graph({
    'tsconfig.json': '{"compilerOptions":{"rootDirs":["app","generated"]}}',
    'app/routes/main.tsx': 'import type {Route} from "./+types/main.tsx";',
    'generated/routes/+types/main.ts': 'export type Route = {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    targets: ['generated/routes/+types/main.ts'],
    configuration: ['tsconfig.json'],
  });
});

it('resolves .tsx aliases to verified .ts while preserving exact target precedence', () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"paths":{"value":["./value.tsx"]}}}',
    'main.ts': 'import "value";',
    'value.ts': 'export {};',
  };
  expect(graph(files).references[0]).toMatchObject({
    status: 'resolved',
    targets: ['value.ts'],
    configuration: ['tsconfig.json'],
  });
  expect(graph({ ...files, 'value.tsx': 'export {};' }).references[0]?.targets).toEqual([
    'value.tsx',
  ]);
});

it('does not infer .tsx compiler substitution without a selected config or through Node package targets', () => {
  const configless = graph({ 'main.ts': 'import "./value.tsx";', 'value.ts': 'export {};' });
  expect(configless.references[0]?.status).toBe('unresolved');
  const privateImport = graph({
    'tsconfig.json': '{}',
    'package.json': '{"imports":{"#value":"./value.tsx"}}',
    'main.ts': 'import "#value";',
    'value.ts': 'export {};',
  });
  expect(privateImport.references[0]?.status).toBe('unresolved');
});

it('retains unreadable/case-mismatched exact .tsx inputs instead of substituting another file', () => {
  const files = {
    'tsconfig.json': '{}',
    'main.ts': 'import "./value.tsx";',
    'value.ts': 'export {};',
  };
  expect(graph(files, ['value.tsx']).references[0]?.reason).toBe('source-text-unavailable');
  expect(graph({ ...files, 'value.TSX': 'export {};' }).references[0]?.reason).toBe(
    'case-mismatched-target',
  );
});

it('does not skip an unreadable exact .tsx alias choice for a later readable alternative', () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"paths":{"value":["./value.tsx","./other.ts"]}}}',
    'main.ts': 'import "value";',
    'other.ts': 'export {};',
  };
  expect(graph(files, ['value.tsx']).references[0]?.reason).toBe('source-text-unavailable');
  expect(graph({ ...files, 'value.TSX': 'export {};' }).references[0]?.reason).toBe(
    'case-mismatched-target',
  );
});

it('preserves unavailable baseUrl .tsx compiler targets instead of choosing a same-name package', () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"baseUrl":"."}}',
    'package.json': '{"dependencies":{"value.tsx":"1"}}',
    'main.ts': 'import "value.tsx";',
  };
  expect(graph(files, ['value.ts']).references[0]).toMatchObject({
    status: 'unresolved',
    reason: 'source-text-unavailable',
    targets: ['value.ts'],
    configuration: ['tsconfig.json'],
  });
  expect(graph({ ...files, 'value.TS': 'export {};' }).references[0]).toMatchObject({
    status: 'unresolved',
    reason: 'case-mismatched-target',
    configuration: ['tsconfig.json'],
  });
  expect(graph({ ...files, 'value.ts': 'export {};' }).references[0]).toMatchObject({
    status: 'resolved',
    targets: ['value.ts'],
    configuration: ['tsconfig.json'],
  });
});

it('keeps .tsx substitution unresolved in an ambiguous or unassigned project context', () => {
  const files = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./a.json"},{"path":"./b.json"}]}',
    'a.json': '{"include":["main.ts"]}',
    'b.json': '{"include":["main.ts"]}',
    'main.ts': 'import "./value.tsx";',
    'value.ts': 'export {};',
  };
  expect(graph(files).references[0]?.reason).toBe('config-project-ambiguous');
  expect(
    graph({ ...files, 'a.json': '{"files":[]}', 'b.json': '{"files":[]}' }).references[0]?.reason,
  ).toBe('config-project-source-unassigned');
});

it.each([
  'export default {plugins:[]};',
  'import {defineConfig as config} from "vite"; export default config({plugins:[]});',
  'import {defineConfig} from "vite"; export default defineConfig(({mode})=>{const value=mode; return {plugins:[]};});',
])('resolves plain CSS ?url using bound Vite configuration %s', config => {
  const result = graph({
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': config,
    'src/main.ts': 'import "./style.css?url";',
    'src/style.css': 'body {color:red}',
  });
  const reference = result.references.find(ref => ref.from === 'src/main.ts');
  expect(reference).toMatchObject({
    status: 'resolved',
    targets: ['src/style.css'],
    configuration: ['package.json', 'vite.config.ts'],
  });
  expect(result.complete).toBe(true);
});

it.each(['./style.module.css?url', './style.css?raw', './style.css?url&raw', './style.css?url=1'])(
  'keeps unsupported CSS loader request %s unresolved',
  specifier => {
    const result = graph({
      'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
      'vite.config.ts': 'export default {};',
      'main.ts': `import '${specifier}';`,
      'style.css': 'body{}',
      'style.module.css': '.example{}',
    });
    expect(result.references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
  },
);

it.each([
  'export default foreign;',
  'import {defineConfig} from "vite"; defineConfig=foreign; export default defineConfig({});',
  'import {defineConfig} from "vite"; export default defineConfig(async()=>({}));',
  'import {defineConfig} from "vite"; export default defineConfig(()=>{if(flag)return {};return {};});',
  'export default {resolve:{alias:{"./style.css":"./other.css"}}};',
  'export default {root:"elsewhere"};',
  'export default {...foreign};',
  'export default {__proto__:{root:"elsewhere"}};',
  'export default {get plugins(){return []}};',
])('does not assume Vite CSS ?url semantics for unsupported config %s', config => {
  const result = graph({
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': config,
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{}',
    'other.css': 'body{}',
  });
  expect(result.references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
});

it.each([
  'import type {defineConfig} from "vite"; export default defineConfig({});',
  'import {type defineConfig} from "vite"; export default defineConfig({});',
])('does not bind a type-only Vite helper %s to a runtime CSS loader', config => {
  const result = graph({
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': config,
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{}',
  });
  expect(result.references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
});

it('keeps CSS ?url unresolved for a compiler override of Vite or an unassigned source', () => {
  const files = {
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': 'export default {};',
    'tsconfig.json': '{"compilerOptions":{"paths":{"vite":["./foreign.ts"]}}}',
    'foreign.ts': 'export {};',
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{}',
  };
  expect(graph(files).references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
  expect(
    graph({
      ...files,
      'tsconfig.json': '{"files":[],"references":[{"path":"./app.json"}]}',
      'app.json': '{"files":[]}',
    }).references.find(ref => ref.from === 'main.ts')?.reason,
  ).toBe('config-project-source-unassigned');
});

it.each([
  'export default {plugins:[{name:"redirect",enforce:"pre",resolveId(id){if(id==="./style.css?url")return "/fixture/other.css?url";}}]};',
  'export default {plugins:[{name:"alias",config(){return {resolve:{alias:{"./style.css":"./other.css"}}}}}]};',
  'export default {plugins:[foreign()]};',
  'export default {plugins:foreign};',
])('does not assume core CSS source resolution for unverified Vite plugins %s', config => {
  const result = graph({
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': config,
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{color:red}',
    'other.css': 'body{color:blue}',
  });
  expect(result.complete).toBe(false);
  expect(result.references.find(ref => ref.from === 'main.ts')).toMatchObject({
    status: 'unresolved',
    targets: [],
    configuration: ['package.json', 'vite.config.ts'],
  });
});

it('requires owning Vite declaration, config inventory and readable CSS source for ?url', () => {
  const files = {
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': 'export default {};',
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{}',
  };
  expect(
    graph({ ...files, 'package.json': '{}' }).references.find(ref => ref.from === 'main.ts')
      ?.status,
  ).toBe('unresolved');
  expect(
    graph({ ...files, 'vite.config.ts': '' }).references.find(ref => ref.from === 'main.ts')
      ?.status,
  ).toBe('unresolved');
  const { ['style.css']: _, ...opaque } = files;
  expect(graph(opaque, ['style.css']).references.find(ref => ref.from === 'main.ts')?.status).toBe(
    'unresolved',
  );
  expect(
    graph({
      ...files,
      'nested/package.json': '{}',
      'nested/main.ts': 'import "../style.css?url";',
    }).references.find(ref => ref.from === 'nested/main.ts')?.status,
  ).toBe('unresolved');
});

it('does not use an unbound manifest or declared external stylesheet as captured CSS ?url source', () => {
  const files = {
    'package.json': '{"devDependencies":{"vite":"^7.3.1"},"dependencies":{"theme":"1"}}',
    'vite.config.ts': 'export default {};',
    'main.ts': 'import "./style.css?url";',
    'style.css': 'body{}',
  };
  const unbound = resolvePortalModules(
    new Map(Object.entries(files)),
    Object.keys(files).filter(path => path !== 'package.json'),
  );
  expect(unbound.references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
  expect(
    graph({ ...files, 'main.ts': 'import "theme/style.css?url";' }).references.find(
      ref => ref.from === 'main.ts',
    )?.status,
  ).toBe('unresolved');
});

it.each(['npm:other-loader@7.3.1', 'workspace:*', '*', '^6.0.0'])(
  'keeps unsupported Vite selector %s explicit for CSS ?url',
  vite => {
    const result = graph({
      'package.json': JSON.stringify({ devDependencies: { vite } }),
      'vite.config.ts': 'export default {};',
      'main.ts': 'import "./style.css?url";',
      'style.css': 'body{}',
    });
    expect(result.references.find(ref => ref.from === 'main.ts')?.status).toBe('unresolved');
  },
);

it('retains selected source configuration, CSS dependencies and unsupported inherited config issues', () => {
  const files = {
    'package.json': '{"devDependencies":{"vite":"^7.3.1"}}',
    'vite.config.ts': 'export default {};',
    'tsconfig.json':
      '{"extends":"unknown-config","compilerOptions":{"paths":{"style.css":["./style.css"]}}}',
    'main.ts': 'import "style.css?url";',
    'style.css': '@import "./missing.css";',
  };
  const result = graph(files);
  expect(result.references.find(ref => ref.from === 'main.ts')).toMatchObject({
    status: 'resolved',
    targets: ['style.css'],
    configuration: ['package.json', 'tsconfig.json', 'vite.config.ts'],
  });
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('CONFIG_EXTENDS_UNSUPPORTED:tsconfig.json');
  expect(result.references.find(ref => ref.from === 'style.css')?.status).toBe('unresolved');
});

it('resolves private package imports from the owning manifest and binds conditional source branches', () => {
  const result = graph({
    'package.json': JSON.stringify({
      imports: { '#app/*': './app/*', '#config': { node: './node.ts', default: './fallback.ts' } },
    }),
    'app/routes/home.ts': "import '#app/utils/db.ts'; import '#config';",
    'app/utils/db.ts': 'export {};',
    'node.ts': 'export {};',
    'fallback.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(
    result.references.map(ref => ({
      status: ref.status,
      targets: ref.targets,
      configuration: ref.configuration,
    })),
  ).toEqual([
    { status: 'resolved', targets: ['app/utils/db.ts'], configuration: ['package.json'] },
    { status: 'resolved', targets: ['fallback.ts', 'node.ts'], configuration: ['package.json'] },
  ]);
});

it('honors exact private import blocks and specific patterns without inheriting across package boundaries', () => {
  const result = graph({
    'package.json': JSON.stringify({
      imports: { '#app/*': './app/*', '#app/private/*': './special/*', '#app/blocked.ts': null },
    }),
    'main.ts': "import '#app/private/value.ts'; import '#app/blocked.ts';",
    'special/value.ts': 'export {};',
    'app/private/value.ts': 'export {};',
    'app/blocked.ts': 'export {};',
    'nested/package.json': '{}',
    'nested/main.ts': "import '#app/private/value.ts';",
  });
  expect(result.references[0]?.targets).toEqual(['special/value.ts']);
  expect(result.references.slice(1).map(ref => ref.status)).toEqual(['unresolved', 'unresolved']);
  expect(result.references[2]?.configuration).toEqual(['nested/package.json']);
});

it.each([
  '../outside.ts',
  './sub/../inside.ts',
  './node_modules/pkg/index.ts',
  './%2e%2e/outside.ts',
  'external-package',
])('leaves unsafe or unsupported private import target %s unresolved', target => {
  const result = graph({
    'package.json': JSON.stringify({ imports: { '#value': target } }),
    'main.ts': "import '#value';",
    'inside.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references[0]).toMatchObject({
    status: 'unresolved',
    targets: [],
    configuration: ['package.json'],
  });
});

it('retains ambiguity when a TypeScript path overrides a private package import', () => {
  const result = graph({
    'package.json': JSON.stringify({ imports: { '#value': './one.ts' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '#value': ['./two.ts'] } } }),
    'main.ts': "import '#value';",
    'one.ts': 'export {};',
    'two.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references[0]?.reason).toBe('package-import-tsconfig-ambiguity');
});

it.each([
  ['react', 'vite-plugin-svgr', 'svgr'],
  ['component', 'vite-svg-loader', 'svgLoader'],
] as const)('resolves SVG ?%s only with its configured Vite loader', (query, module, binding) => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { [module]: '1', vite: '1' } }),
    'vite.config.ts': `import {defineConfig} from 'vite'; import ${binding} from '${module}'; export default defineConfig({plugins: [${binding}()]});`,
    'src/main.ts': `import Icon from './icon.svg?${query}';`,
    'src/icon.svg': '<svg/>',
  };
  const valid = graph(files);
  const reference = valid.references.find(ref => ref.from === 'src/main.ts')!;
  expect(reference.status).toBe('resolved');
  expect(reference.targets).toEqual(['src/icon.svg']);
  expect(reference.configuration).toEqual(['package.json', 'vite.config.ts']);
  for (const config of [
    '',
    `import ${binding} from '${module}'; ${binding}(); export default {plugins: []};`,
    `import ${binding} from '${module}'; ${binding} = foreign; export default {plugins: [${binding}()]};`,
  ]) {
    expect(
      graph({ ...files, 'vite.config.ts': config }).references.find(
        ref => ref.from === 'src/main.ts',
      )!.status,
    ).toBe('unresolved');
  }
  expect(
    graph({ ...files, 'src/main.ts': "import Icon from './icon.svg?unknown';" }).references.find(
      ref => ref.from === 'src/main.ts',
    )!.status,
  ).toBe('unresolved');
});

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
  expect(result.references.slice(-2).every(ref => ref.specifier === 'x')).toBe(true);
  expect(
    result.references.slice(-2).every(ref => ref.reason === 'undeclared-external-module'),
  ).toBe(true);
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

it('uses referenced project aliases for included sources and binds solution configuration', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}',
    'tsconfig.app.json':
      '{"compilerOptions":{"paths":{"dep":["./src/local.ts"]}},"include":["src"]}',
    'package.json': '{"dependencies":{"dep":"1"}}',
    'src/main.ts': 'import "dep";',
    'src/local.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    status: 'resolved',
    targets: ['src/local.ts'],
    configuration: ['tsconfig.app.json', 'tsconfig.json'],
  });
});

it('separates solution references from inheritance and chooses each project by its source membership', () => {
  const result = graph({
    'tsconfig.json': JSON.stringify({
      files: [],
      references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }],
    }),
    'tsconfig.node.json': JSON.stringify({
      extends: './tsconfig.json',
      include: ['server.ts'],
      compilerOptions: { paths: { dep: ['./node.ts'] } },
    }),
    'tsconfig.app.json': JSON.stringify({
      extends: './tsconfig.json',
      include: ['app/**/*'],
      compilerOptions: { paths: { dep: ['./app/local.ts'] } },
    }),
    'server.ts': "import 'dep';",
    'node.ts': 'export {};',
    'app/main.ts': "import 'dep';",
    'app/local.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references.map(ref => ref.targets)).toEqual([['app/local.ts'], ['node.ts']]);
  expect(result.references[0]?.configuration).toEqual(['tsconfig.app.json', 'tsconfig.json']);
  expect(result.references[1]?.configuration).toEqual(['tsconfig.json', 'tsconfig.node.json']);
});

it('supports directory references, nested projects, inherited selectors and explicit file membership', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./apps"}]}',
    'apps/tsconfig.json': '{"files":[],"references":[{"path":"./web/tsconfig.app.json"}]}',
    'apps/web/base.json':
      '{"files":["main.ts"],"compilerOptions":{"paths":{"local":["value.ts"]}}}',
    'apps/web/tsconfig.app.json': '{"extends":"./base.json"}',
    'apps/web/main.ts': "import 'local';",
    'apps/web/value.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]?.targets).toEqual(['apps/web/value.ts']);
  expect(result.references[0]?.configuration).toEqual([
    'apps/tsconfig.json',
    'apps/web/base.json',
    'apps/web/tsconfig.app.json',
  ]);
});

it('keeps overlapping and excluded solution project sources unresolved instead of using external declarations', () => {
  const files = {
    'package.json': '{"dependencies":{"dep":"1"}}',
    'tsconfig.json': '{"files":[],"references":[{"path":"./one.json"},{"path":"./two.json"}]}',
    'one.json':
      '{"include":["src/**/*"],"exclude":["src/excluded/**/*"],"compilerOptions":{"paths":{"dep":["one.ts"]}}}',
    'two.json':
      '{"include":["src/**/*"],"exclude":["src/excluded/**/*"],"compilerOptions":{"paths":{"dep":["two.ts"]}}}',
    'src/main.ts': "import 'dep';",
    'src/excluded/main.ts': "import 'dep';",
    'one.ts': 'export {};',
    'two.ts': 'export {};',
  };
  const result = graph(files);
  expect(result.complete).toBe(false);
  expect(result.references.map(ref => ref.reason)).toEqual([
    'config-project-source-unassigned',
    'config-project-ambiguous',
  ]);
});

it('retains the solution own source configuration and treats a parent-child overlap as ambiguous', () => {
  const files = {
    'tsconfig.json':
      '{"include":["main.ts"],"references":[{"path":"./child.json"}],"compilerOptions":{"paths":{"dep":["value.ts"]}}}',
    'child.json': '{"include":["app/**/*"]}',
    'main.ts': "import 'dep';",
    'value.ts': 'export {};',
  };
  expect(graph(files)).toMatchObject({
    complete: true,
    references: [{ targets: ['value.ts'], configuration: ['tsconfig.json'] }],
  });
  const overlap = graph({ ...files, 'child.json': '{"include":["main.ts"]}' });
  expect(overlap.references[0]?.reason).toBe('config-project-ambiguous');
});

it('requires explicit hidden-directory globs and inherited JavaScript permission for referenced source membership', () => {
  const files = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./child.json"}]}',
    'child.json': '{"include":["app/**/*"],"compilerOptions":{"paths":{"dep":["value.ts"]}}}',
    'app/.server/main.ts': "import 'dep';",
    'app/main.js': "import 'dep';",
    'value.ts': 'export {};',
  };
  expect(
    graph(files).references.every(ref => ref.reason === 'config-project-source-unassigned'),
  ).toBe(true);
  expect(
    graph({
      ...files,
      'child.json':
        '{"include":["app/**/*","app/**/.server/**/*"],"compilerOptions":{"checkJs":true,"paths":{"dep":["value.ts"]}}}',
    }).complete,
  ).toBe(true);
});

it('does not override inherited allowJs false with checkJs true when choosing a referenced project', () => {
  const result = graph({
    'tsconfig.json':
      '{"files":[],"references":[{"path":"./child.json"}],"compilerOptions":{"allowJs":false,"checkJs":true}}',
    'child.json': '{"extends":"./tsconfig.json","include":["src/**/*"]}',
    'package.json': '{"dependencies":{"dep":"1"}}',
    'src/main.js': "import 'dep';",
  });
  expect(result.references[0]?.reason).toBe('config-project-source-unassigned');
});

it('accepts an empty rootDirs override without retaining an inherited overlay', () => {
  const result = graph({
    'base.json': '{"compilerOptions":{"rootDirs":["app","generated"]}}',
    'tsconfig.json': '{"extends":"./base.json","compilerOptions":{"rootDirs":[]}}',
    'app/main.ts': "import './value';",
    'app/value.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(result.issues).toEqual([]);
});

it('rejects wildcard parent traversal in referenced project source selectors', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./child.json"}]}',
    'child.json': '{"include":["app/*/../other/**/*"]}',
    'app/other/main.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('CONFIG_SOURCE_SELECTION_UNSUPPORTED:child.json');
});

it('bounds project source membership comparisons across a wide solution', () => {
  const files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      files: [],
      references: Array.from({ length: 32 }, (_, index) => ({ path: `./project-${index}.json` })),
    }),
  };
  for (let index = 0; index < 32; index++)
    files[`project-${index}.json`] = JSON.stringify({
      include: Array.from({ length: 128 }, (_, part) => `absent-${part}/**/*`),
    });
  for (let index = 0; index < 30; index++) files[`src/source-${index}.ts`] = "import 'dep';";
  const result = graph(files);
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('CONFIG_SELECTION_LIMIT');
  expect(result.references.some(ref => ref.reason === 'config-project-selection-limit')).toBe(true);
});

it('keeps imported source ownership across referenced project contexts instead of switching to another project', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./a.json"},{"path":"./b.json"}]}',
    'a.json': '{"files":["app/main.ts"],"compilerOptions":{"paths":{"dep":["./app/a.ts"]}}}',
    'b.json': '{"files":["app/helper.ts"],"compilerOptions":{"paths":{"dep":["./app/b.ts"]}}}',
    'app/main.ts': 'import "./helper";',
    'app/helper.ts': 'import "dep";',
    'app/a.ts': 'export {};',
    'app/b.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references.find(ref => ref.from === 'app/helper.ts')).toMatchObject({
    status: 'unresolved',
    reason: 'config-project-context-ambiguous',
    configuration: ['a.json', 'b.json', 'tsconfig.json'],
  });
  expect(result.issues).toContain('CONFIG_PROJECT_CONTEXT_AMBIGUOUS:app/helper.ts');
});

it('keeps recursive wildcard exclusions out of referenced project ownership', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./child.json"}]}',
    'child.json': '{"include":["src/**/*"],"exclude":["src/**"]}',
    'package.json': '{"dependencies":{"dep":"1"}}',
    'src/main.ts': 'import "dep";',
  });
  expect(result.complete).toBe(false);
  expect(result.references[0]?.reason).toBe('config-project-source-unassigned');
});

it('inherits implicit output-directory exclusion unless exclude explicitly overrides it', () => {
  const files = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./child.json"}]}',
    'base.json': '{"compilerOptions":{"outDir":"src"}}',
    'child.json': '{"extends":"./base.json","include":["**/*"]}',
    'package.json': '{"dependencies":{"dep":"1"}}',
    'src/main.ts': 'import "dep";',
  };
  expect(graph(files).references[0]?.reason).toBe('config-project-source-unassigned');
  expect(
    graph({ ...files, 'child.json': '{"extends":"./base.json","include":["**/*"],"exclude":[]}' })
      .references[0]?.status,
  ).toBe('external');
});

it('keeps absent and unreadable explicit project files incomplete while empty solution files stay valid', () => {
  const files = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./child.json"}]}',
    'child.json': '{"files":["generated/missing.ts","src/main.ts"]}',
    'src/main.ts': 'export {};',
  };
  const missing = graph(files);
  expect(missing.complete).toBe(false);
  expect(missing.issues).toContain('CONFIG_SOURCE_FILE_MISSING:child.json:generated/missing.ts');
  const unreadable = graph(files, ['generated/missing.ts']);
  expect(unreadable.complete).toBe(false);
  expect(unreadable.issues).toContain(
    'CONFIG_SOURCE_FILE_UNAVAILABLE:child.json:generated/missing.ts',
  );
});

it('rejects a transitive switch to a nested standalone config outside the solution references', () => {
  const result = graph({
    'tsconfig.json': '{"files":[],"references":[{"path":"./a.json"}]}',
    'a.json': '{"files":["app/main.ts"],"compilerOptions":{"paths":{"dep":["./app/a.ts"]}}}',
    'app/main.ts': 'import "./helper/helper";',
    'app/helper/tsconfig.json': '{"compilerOptions":{"paths":{"dep":["./b.ts"]}}}',
    'app/helper/helper.ts': 'import "dep";',
    'app/a.ts': 'export {};',
    'app/helper/b.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references.find(ref => ref.from === 'app/helper/helper.ts')).toMatchObject({
    status: 'unresolved',
    reason: 'config-project-context-ambiguous',
    targets: [],
    configuration: ['a.json', 'app/helper/tsconfig.json', 'tsconfig.json'],
  });
});

it('rejects a transitive switch to default resolution outside the solution directory', () => {
  const result = graph({
    'package.json': '{"dependencies":{"dep":"1"}}',
    'app/tsconfig.json': '{"files":[],"references":[{"path":"./a.json"}]}',
    'app/a.json': '{"files":["main.ts"],"compilerOptions":{"paths":{"dep":["./a.ts"]}}}',
    'app/main.ts': 'import "../shared/helper";',
    'shared/helper.ts': 'import "dep";',
    'app/a.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.references.find(ref => ref.from === 'shared/helper.ts')).toMatchObject({
    status: 'unresolved',
    reason: 'config-project-context-ambiguous',
    targets: [],
    configuration: ['app/a.json', 'app/tsconfig.json'],
  });
});

it('validates effective project files after overriding an inherited template list', () => {
  const result = graph({
    'base.json': '{"files":["generated/missing.ts"]}',
    'tsconfig.json': '{"extends":"./base.json","files":["src/main.ts"]}',
    'src/main.ts': 'export {};',
  });
  expect(result.complete).toBe(true);
  expect(result.issues).toEqual([]);
});

it.each(['../outside.json', 'C:/outside.json', './%2e%2e/outside.json', './missing.json'])(
  'does not accept unsafe or absent project reference %s',
  path => {
    const result = graph({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path }] }),
      'main.ts': 'export {};',
    });
    expect(result.complete).toBe(false);
    expect(
      result.issues.some(issue => /CONFIG_(?:REFERENCE_UNSUPPORTED|MISSING):/u.test(issue)),
    ).toBe(true);
  },
);

it('detects reference cycles and limits without treating child inheritance as a cycle', () => {
  const result = graph({
    'tsconfig.json': '{"references":[{"path":"./child.json"}]}',
    'child.json': '{"references":[{"path":"./tsconfig.json"}]}',
    'main.ts': 'export {};',
  });
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('CONFIG_REFERENCE_CYCLE:tsconfig.json');
  const wide = graph({
    'tsconfig.json': JSON.stringify({
      references: Array.from({ length: 33 }, () => ({ path: './child.json' })),
    }),
    'child.json': '{}',
  });
  expect(wide.issues).toContain('CONFIG_REFERENCE_LIMIT:tsconfig.json');
});

it('resolves relative generated types through config-relative inherited rootDirs only when verified bytes exist', () => {
  const result = graph({
    'config/base.json': '{"compilerOptions":{"rootDirs":["../app","../generated"]}}',
    'tsconfig.json': '{"extends":"./config/base.json"}',
    'app/routes/home.ts': "import type {Route} from './+types/home';",
    'generated/routes/+types/home.ts': 'export type Route = {};',
  });
  expect(result.complete).toBe(true);
  expect(result.references[0]).toMatchObject({
    status: 'resolved',
    targets: ['generated/routes/+types/home.ts'],
    configuration: ['config/base.json', 'tsconfig.json'],
  });
});

it('uses the longest rootDirs prefix and retains direct source precedence', () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"rootDirs":[".","app","generated"]}}',
    'app/routes/home.ts': "import './value';",
    'generated/routes/value.ts': 'export {};',
    'generated/app/routes/value.ts': 'export {};',
  };
  expect(graph(files).references[0]?.targets).toEqual(['generated/routes/value.ts']);
  expect(graph({ ...files, 'app/routes/value.ts': 'export {};' }).references[0]?.targets).toEqual([
    'app/routes/value.ts',
  ]);
});

it('keeps missing, unreadable and case-mismatched rootDirs inputs unresolved', () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"rootDirs":["app","generated"]}}',
    'app/main.ts': "import './value';",
  };
  expect(graph(files).references[0]?.status).toBe('unresolved');
  expect(graph(files, ['generated/value.ts']).references[0]).toMatchObject({
    status: 'unresolved',
    reason: 'source-text-unavailable',
    targets: ['generated/value.ts'],
  });
  expect(graph({ ...files, 'generated/Value.ts': 'export {};' }).references[0]?.reason).toBe(
    'case-mismatched-target',
  );
});

it.each([['../outside'], ['./%2e%2e/outside'], ['C:/outside'], [1], Array(33).fill('app')])(
  'rejects unsupported rootDirs %j',
  rootDirs => {
    const result = graph({
      'tsconfig.json': JSON.stringify({ compilerOptions: { rootDirs } }),
      'app/main.ts': "import './missing';",
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toContain('CONFIG_ROOT_DIRS_UNSUPPORTED:tsconfig.json');
  },
);

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

// This pure admission spy cannot issue a native result or compiler capsule.
const protectedRouteFixture = (
  from: string,
  statement: string,
  mutate?: (value: {
    files: Record<string, string>;
    modules: Map<string, string>;
    admission: boolean;
  }) => void,
) => {
  const value = {
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { rootDirs: ['.', './.react-router/types'] },
      }),
      [from]: statement,
    },
    modules: new Map([
      ['.react-router/types/app/routes/resources/+types/images.ts', 'export type Route = unknown;'],
      [
        '.react-router/types/app/routes/settings/profile/+types/_layout.ts',
        'export type Route = unknown;',
      ],
    ]),
    admission: true,
  };
  mutate?.(value);
  const spy = vi.spyOn(compilerEvidence, 'admittedReactRouterCompilerEvidence').mockReturnValue(
    value.admission
      ? {
          hash: 'sha256:' + 'a'.repeat(64),
          configuration: ['react-router.config.ts'],
          modules: value.modules,
        }
      : null,
  );
  try {
    return resolvePortalModules(new Map(Object.entries(value.files)), Object.keys(value.files), {
      reactRouterCompilerEvidence: {} as compilerEvidence.ReactRouterCompilerEvidence,
      sourceId: 'sha256:' + 'b'.repeat(64),
      sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
    });
  } finally {
    spy.mockRestore();
  }
};
it.each([
  [
    'app/routes/resources/images.tsx',
    "import { type Route } from './+types/images'",
    '.react-router/types/app/routes/resources/+types/images.ts',
  ],
  [
    'app/routes/settings/profile/_layout.tsx',
    "import { type Route } from './+types/_layout.tsx'",
    '.react-router/types/app/routes/settings/profile/+types/_layout.ts',
  ],
])(
  'resolves protected React Router route types from actual generated members %#',
  (from, statement, member) => {
    const result = protectedRouteFixture(from!, statement!);
    expect(result.complete).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      status: 'external',
      targets: [],
      reason: 'observed-compiler-generated-route-type',
    });
    expect(result.references[0]!.configuration).toContain('react-router.config.ts');
    expect(result.references[0]!.configuration).not.toContain(member);
  },
);
it('denies protected React Router route types for runtime, foreign, missing and ambiguous facts', () => {
  const from = 'app/routes/resources/images.tsx';
  for (const statement of [
    "import { Route } from './+types/images'",
    "import { type Route, runtime } from './+types/images'",
    "void import('./+types/images')",
    "import { type Route } from './+types/foreign'",
  ]) {
    expect(protectedRouteFixture(from, statement).complete).toBe(false);
  }
  const statement = "import { type Route } from './+types/images'";
  for (const mutate of [
    (v: Parameters<NonNullable<Parameters<typeof protectedRouteFixture>[2]>>[0]) => {
      v.admission = false;
    },
    (v: Parameters<NonNullable<Parameters<typeof protectedRouteFixture>[2]>>[0]) => {
      v.modules.delete('.react-router/types/app/routes/resources/+types/images.ts');
    },
    (v: Parameters<NonNullable<Parameters<typeof protectedRouteFixture>[2]>>[0]) => {
      v.modules.set(
        '.react-router/types/app/routes/resources/+types/Images.ts',
        'export type Route = unknown;',
      );
    },
    (v: Parameters<NonNullable<Parameters<typeof protectedRouteFixture>[2]>>[0]) => {
      v.files['tsconfig.json'] = '{}';
    },
  ])
    expect(protectedRouteFixture(from, statement, mutate).complete).toBe(false);
  expect(
    protectedRouteFixture(
      'app/routes/settings/profile/_layout.tsx',
      "import { Route } from './+types/_layout.tsx'",
    ).complete,
  ).toBe(false);
});

function generatedConfigurationConnections(missingSourceConfig = false) {
  const files: Record<string, string> = {
    'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.vite.json"}]}',
    'tsconfig.vite.json':
      '{"extends":"./tsconfig.json","include":["app/**/*"],"compilerOptions":{"rootDirs":[".","./.react-router/types"]}}',
    'react-router.config.ts': 'export default {ssr:true};',
    'vite.config.ts': 'export default {};',
    'package.json': '{}',
    'app/root.tsx': "import type {Route} from './+types/root';",
    'app/routes/home.tsx': "import type {Route} from './+types/home';",
  };
  const sourceId = 'sha256:' + 'b'.repeat(64);
  const configuration = ['react-router.config.ts', 'vite.config.ts', 'package.json'];
  if (missingSourceConfig) configuration.push('missing.config.ts');
  // Pure admission spy only; it cannot issue a native result or compiler authority.
  const spy = vi.spyOn(compilerEvidence, 'admittedReactRouterCompilerEvidence').mockReturnValue({
    hash: 'sha256:' + 'a'.repeat(64),
    configuration,
    modules: new Map([
      ['.react-router/types/app/+types/root.ts', 'export type Route = unknown;'],
      ['.react-router/types/app/routes/+types/home.ts', 'export type Route = unknown;'],
    ]),
  });
  try {
    const modules = resolvePortalModules(new Map(Object.entries(files)), Object.keys(files), {
      reactRouterCompilerEvidence: {} as compilerEvidence.ReactRouterCompilerEvidence,
      sourceId,
      sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
    });
    const connections = analyzePortalServiceConnections({
      sources: Object.entries(files).map(([path, text]) => ({
        sourceId,
        serviceId: 'portal',
        path,
        text,
        hash: 'sha256:' + createHash('sha256').update(text).digest('hex'),
        role: path.startsWith('app/') ? ('runtime' as const) : ('configuration' as const),
      })),
      modules: [{ sourceId, ...modules }],
    });
    return { modules, connections };
  } finally {
    spy.mockRestore();
  }
}

it('keeps admitted generated root and home targets out of source configuration provenance', () => {
  const { modules, connections } = generatedConfigurationConnections();
  expect(modules.complete).toBe(true);
  expect(modules.references).toHaveLength(2);
  expect(
    modules.references.every(
      ref =>
        ref.status === 'external' &&
        ref.targets.length === 0 &&
        ref.reason === 'observed-compiler-generated-route-type',
    ),
  ).toBe(true);
  expect(
    modules.references.every(
      ref => !ref.configuration.some(path => path.startsWith('.react-router/types/')),
    ),
  ).toBe(true);
  expect(connections.complete).toBe(true);
  expect(connections.configuration.map(row => row.module).toSorted()).toEqual([
    'package.json',
    'react-router.config.ts',
    'tsconfig.json',
    'tsconfig.vite.json',
    'vite.config.ts',
  ]);
});

it('keeps missing real compiler source configuration incomplete after generated type classification', () => {
  const { modules, connections } = generatedConfigurationConnections(true);
  expect(modules.complete).toBe(true);
  expect(connections.complete).toBe(false);
  expect(
    connections.issues.filter(row => row.code === 'CONFIGURATION_SOURCE_MISSING'),
  ).toHaveLength(2);
});

it('resolves explicit ts inline route types for actual Epic root and marketing routes', () => {
  for (const [from, name, member] of [
    ['app/root.tsx', 'root', '.react-router/types/app/+types/root.ts'],
    [
      'app/routes/_marketing/index.tsx',
      'index',
      '.react-router/types/app/routes/_marketing/+types/index.ts',
    ],
  ]) {
    // Pure admission spy only; exact generated members are fixture data, not issued authority.
    const result = protectedRouteFixture(
      from!,
      "import { type Route } from './+types/" + name + ".ts';",
      value => {
        value.modules.set(member!, 'export type Route = unknown;');
      },
    );
    expect(result.complete).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      status: 'external',
      targets: [],
      reason: 'observed-compiler-generated-route-type',
    });
    expect(result.references[0]!.configuration).not.toContain(member);
  }
});

it('denies explicit ts generated route imports without exact type-only admission', () => {
  const from = 'app/routes/resources/images.tsx';
  for (const statement of [
    "import { Route } from './+types/images.ts';",
    "import { type Route, runtime } from './+types/images.ts';",
    "void import('./+types/images.ts');",
    "import { type Route } from './+types/foreign.ts';",
  ])
    expect(protectedRouteFixture(from, statement).complete).toBe(false);
  const statement = "import { type Route } from './+types/images.ts';";
  const mutations: NonNullable<Parameters<typeof protectedRouteFixture>[2]>[] = [
    value => {
      value.admission = false;
    },
    value => {
      value.modules.delete('.react-router/types/app/routes/resources/+types/images.ts');
    },
    value => {
      value.modules.set(
        '.react-router/types/app/routes/resources/+types/Images.ts',
        'export type Route = unknown;',
      );
    },
    value => {
      value.files['tsconfig.json'] = '{}';
    },
  ];
  for (const mutate of mutations)
    expect(protectedRouteFixture(from, statement, mutate).complete).toBe(false);
});
