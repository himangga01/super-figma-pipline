import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ServiceGraphProfileSchema } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';
const roots: string[] = [];
it('keeps binary files with semantic extensions out of text evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-binary-'));
  roots.push(root);
  await writeFile(join(root, 'control.js'), Buffer.from('/*\x01*/'));
  await writeFile(join(root, 'zero.json'), Buffer.from([0]));
  await writeFile(join(root, 'package.json'), Buffer.from([0, 255]));
  await writeFile(join(root, 'index.ts'), Buffer.from([255]));
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.sourceInventory).toMatchObject({ complete: true });
  expect(graph.sourceInventory?.files).toHaveLength(4);
  expect(graph.files).toEqual([]);
  expect(graph.services.flatMap(service => service.evidence)).toEqual([]);
  expect(graph).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(graph.issues).toEqual([
    'SOURCE_ENCODING:control.js',
    'SOURCE_ENCODING:index.ts',
    'SOURCE_ENCODING:package.json',
    'SOURCE_ENCODING:zero.json',
  ]);
});
it('binds every nonexcluded source byte independently of semantic parse coverage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-inventory-'));
  roots.push(root);
  const members = {
    '.gitignore': 'src/generated/\nbuild/\n',
    '.editorconfig': 'root = true',
    '.config/loader.js': 'export const loader = 1;',
    '.well-known/service': 'public discovery',
    'build/index.js': 'export const built = 1;',
    'dist/index.js': 'export const dist = 1;',
    'vendor/custom.js': 'export const custom = 1;',
    'test/fixture.txt': 'fixture',
    'src/main.ts': 'import "./generated/client.js";',
    'src/generated/client.ts': 'export const client = 1;',
    'module.mts': 'export const esm = 1;',
    'module.cts': 'export const cjs = 1;',
    'schema.graphql': 'type Query { name: String }',
    'start.sh': 'echo run',
    'README.txt': 'documentation input',
  };
  for (const [path, content] of Object.entries(members)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await writeFile(join(root, 'asset.bin'), Buffer.from([0, 255, 128, 10]));
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.sourceInventory?.complete).toBe(true);
  expect(graph.sourceInventory?.files.map(file => file.path)).toEqual(
    [...Object.keys(members), 'asset.bin'].toSorted(),
  );
  expect(graph.sourceInventory?.files.find(file => file.path === 'asset.bin')).toMatchObject({
    bytes: 4,
    classification: 'binary',
    hash: 'sha256:6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1',
  });
  expect(graph.files.some(file => file.path === 'asset.bin')).toBe(false);
  expect(graph.files.some(file => file.path === 'module.mts')).toBe(true);
  for (const path of [
    'src/generated/client.ts',
    '.editorconfig',
    'build/index.js',
    '.gitignore',
    'asset.bin',
  ]) {
    const before = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
    await writeFile(join(root, path), `changed ${path}`);
    const after = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
    expect(after.sourceHash).not.toBe(before.sourceHash);
  }
  const stable = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect((await analyzeServiceGraph(new RepoReader({ rootDir: root }))).sourceHash).toBe(
    stable.sourceHash,
  );
  await writeFile(join(root, 'added.txt'), 'added');
  expect((await analyzeServiceGraph(new RepoReader({ rootDir: root }))).sourceHash).not.toBe(
    stable.sourceHash,
  );
  await rm(join(root, 'added.txt'));
  expect((await analyzeServiceGraph(new RepoReader({ rootDir: root }))).sourceHash).toBe(
    stable.sourceHash,
  );
  const { sourceInventory: _inventory, ...legacy } = graph;
  expect(ServiceGraphProfileSchema.parse(legacy).sourceInventory).toBeUndefined();
});

it('records Git, dependency, runtime and credential exclusions without opening their content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-exclusions-'));
  roots.push(root);
  for (const path of [
    '.git/info/exclude',
    'node_modules/pkg/index.js',
    '.sfp/runtime',
    '.env',
    '.ssh/id_ed25519',
    'nested/secret.json',
    'safe.txt',
  ]) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), path === 'safe.txt' ? 'public' : 'sensitive value');
  }
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.sourceInventory?.files.map(file => file.path)).toEqual(['safe.txt']);
  expect(graph.sourceInventory?.exclusions).toEqual([
    { path: '.env', kind: 'file', reason: 'credentials' },
    { path: '.git', kind: 'directory', reason: 'git-metadata' },
    { path: '.sfp', kind: 'directory', reason: 'service-runtime' },
    { path: '.ssh', kind: 'directory', reason: 'credentials' },
    { path: 'nested/secret.json', kind: 'file', reason: 'credentials' },
    { path: 'node_modules', kind: 'directory', reason: 'provisioned-dependencies' },
  ]);
  expect(JSON.stringify(graph.sourceInventory)).not.toContain('sensitive value');
});
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
it('never treats truncated source coverage as a reviewable lexical warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-graph-'));
  roots.push(root);
  await writeFile(join(root, 'main.py'), 'print("example")');
  const reader = new RepoReader({ rootDir: root });
  expect(await analyzeServiceGraph(reader)).toMatchObject({
    incomplete: true,
    lexicalReviewable: true,
  });
  expect(
    await analyzeServiceGraph(new RepoReader({ rootDir: root, maxFileBytes: 1 })),
  ).toMatchObject({
    incomplete: true,
    lexicalReviewable: false,
  });
});
it('finds frontend, real server routes, data/auth dependencies and migrations across a monorepo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-graph-'));
  roots.push(root);
  await mkdir(join(root, 'apps/api/migrations'), { recursive: true });
  await mkdir(join(root, 'apps/web'), { recursive: true });
  await writeFile(
    join(root, 'apps/api/package.json'),
    JSON.stringify({
      dependencies: { express: '5.1.0', pg: '8.0.0', jose: '6.0.0' },
      scripts: { start: 'node index.js' },
    }),
  );
  await writeFile(
    join(root, 'apps/web/package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0' } }),
  );
  await writeFile(
    join(root, 'apps/api/index.js'),
    "import express from 'express';\nconst app=express();\napp.post('/orders', requireRole('customer'), saveOrder);\n// app.get('/not-real', fake)\n",
  );
  await writeFile(join(root, 'apps/api/migrations/001.sql'), 'CREATE TABLE orders (id INTEGER);');
  await writeFile(join(root, 'apps/api/.env'), 'DATABASE_PASSWORD=do-not-copy');
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  const api = graph.services.find(service => service.rootPath === 'apps/api')!;
  expect(api.layers).toEqual(
    expect.arrayContaining(['backend', 'api', 'database', 'authentication', 'authorization']),
  );
  expect(api.evidence.some(item => item.detail === 'POST /orders')).toBe(true);
  expect(api.evidence.some(item => item.detail.includes('not-real'))).toBe(false);
  expect(graph.services.find(service => service.rootPath === 'apps/web')?.layers).toContain(
    'frontend',
  );
  expect(
    graph.services.find(service => service.rootPath === 'apps/web')?.codePatterns,
  ).toMatchObject({ framework: 'react', rootDir: 'apps/web' });
  expect(JSON.stringify(graph)).not.toContain('do-not-copy');
  expect(graph.files.some(file => file.path.endsWith('.env'))).toBe(false);
});

it('consumes resolved source modules and configuration as cross-service dependency evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-resolved-'));
  roots.push(root);
  const files = {
    '.gitignore': 'packages/data/generated/\n',
    'tsconfig.json':
      '{"compilerOptions":{"baseUrl":".","paths":{"@data/*":["packages/data/generated/*"]}}}',
    'apps/web/package.json': '{"dependencies":{"react":"19"}}',
    'apps/web/main.mts': 'import "@data/client"; export * from "../shared/index.js";',
    'apps/shared/package.json': '{"name":"@fixture/shared"}',
    'apps/shared/index.ts': 'export const value = 1;',
    'packages/data/package.json': '{"name":"@fixture/data"}',
    'packages/data/generated/client.ts': 'export const getData = () => 1;',
  };
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  }
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.incomplete).toBe(false);
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        from: 'apps/web/main.mts',
        to: 'packages/data/generated/client.ts',
        kind: 'imports',
      }),
      expect.objectContaining({
        from: 'tsconfig.json',
        to: 'apps/web/main.mts',
        kind: 'configures',
      }),
      expect.objectContaining({ from: 'apps/web', to: 'packages/data', kind: 'depends-on' }),
      expect.objectContaining({ from: 'apps/web', to: 'apps/shared', kind: 'depends-on' }),
    ]),
  );
  expect(graph.files.some(file => file.path === 'packages/data/generated/client.ts')).toBe(true);
});

it('never promotes a dynamic module or declared external package into resolved local completeness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-dynamic-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), '{"dependencies":{"express":"5"}}');
  await writeFile(
    join(root, 'main.cts'),
    'const express = require("express"); const name = "./runtime"; require(name);',
  );
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(graph.issues.some(issue => issue.startsWith('MODULE_UNRESOLVED:'))).toBe(true);
  expect(graph.services[0]?.layers).toContain('backend');
  expect(graph.edges.find(edge => edge.to === 'express')?.evidence.kind).toBe(
    'declared-external-module',
  );
  expect(graph.edges.some(edge => edge.kind === 'depends-on' && edge.to === 'express')).toBe(false);
});

it('connects explicit local dependency targets without linking a same-name workspace fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-selector-'));
  roots.push(root);
  const files = {
    'package.json': '{"workspaces":["packages/*"],"dependencies":{"pkg":"file:./outside"}}',
    'main.ts': 'import "pkg";',
    'packages/local/package.json': '{"name":"pkg","main":"index.js"}',
    'packages/local/index.js': 'export {};',
    'outside/package.json': '{"name":"file-target","main":"index.js"}',
    'outside/index.js': 'export {};',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.incomplete).toBe(false);
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ from: '.', to: 'outside', kind: 'depends-on' }),
    ]),
  );
  expect(graph.edges.some(edge => edge.kind === 'depends-on' && edge.to === 'packages/local')).toBe(
    false,
  );
});

it.each([512, 513])(
  'retains graph diagnostic loss state with %s lexical source files',
  async count => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-graph-issues-'));
    roots.push(root);
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        writeFile(join(root, `source${index}.py`), 'value = 1'),
      ),
    );
    const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
    expect(graph.sourceInventory?.complete).toBe(true);
    expect(graph.issues).toHaveLength(512);
    expect(graph.issuesTruncated).toBe(count > 512);
    expect(graph.incomplete).toBe(true);
  },
);
it('assigns one-character service roots and deeper children before the whole-root fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-short-root-'));
  roots.push(root);
  const files = {
    'package.json': '{"workspaces":["a","a/n","b"]}',
    'a/package.json': '{"name":"a","dependencies":{"react":"19.2.8"}}',
    'a/Button.tsx':
      "import {value} from '../b/value';export function Button(){return <button>{value}</button>}",
    'a/n/package.json': '{"name":"nested","dependencies":{"express":"5.0.0"}}',
    'a/n/main.ts': "import express from 'express';const app=express();app.get('/nested',()=>{});",
    'b/package.json': '{"name":"b"}',
    'b/value.ts': 'export const value="related";',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.incomplete).toBe(false);
  expect(graph.services.find(service => service.rootPath === 'a')!.layers).toContain('frontend');
  expect(graph.services.find(service => service.rootPath === 'a')!.layers).not.toContain('backend');
  expect(graph.services.find(service => service.rootPath === 'a/n')!.layers).toContain('backend');
  expect(graph.services.find(service => service.rootPath === '.')!.layers).not.toContain(
    'frontend',
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({ from: 'a', to: 'b', kind: 'depends-on' }),
  );
});
