import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';
import { collectPortalSourceInventory } from '../../src/portal/source-inventory.js';
import {
  escapePortalSourcePath,
  isPortableSourcePath,
} from '../../src/portal/source-path-policy.js';

const roots: string[] = [];
const repository = async (members: Record<string, string | Buffer>) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-byte-inventory-'));
  roots.push(root);
  for (const [path, content] of Object.entries(members)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('binds required local CSS imports inside generated directories without indexing unrelated output', async () => {
  const root = await repository({
    'src/app.css': '@import "../dist/tokens.css"; :root {--own: red;}',
    'dist/tokens.css': ':root {--imported: blue;}',
    'dist/unused.css': ':root {--unused: green;}',
  });
  const first = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(first.complete).toBe(true);
  expect(first.files.map(file => file.path)).toEqual(['dist/tokens.css', 'src/app.css']);
  const graph = await analyzeServiceGraph(new RepoReader({ rootDir: root }));
  expect(graph.incomplete).toBe(false);
  expect(graph.files.some(file => file.path === 'dist/tokens.css')).toBe(true);
  await writeFile(join(root, 'dist/tokens.css'), ':root {--imported: purple;}');
  const changed = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(changed.hash).not.toBe(first.hash);
});
it('keeps unsupported and credential CSS dependencies explicitly incomplete', async () => {
  for (const css of ['@import var(--stylesheet);', '@import "../secrets/tokens.css";']) {
    const root = await repository({
      'src/app.css': css,
      'secrets/tokens.css': ':root {--secret: private;}',
    });
    const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
    expect(result.complete).toBe(false);
    expect(result.files.map(file => file.path)).not.toContain('secrets/tokens.css');
  }
});

it('does not raise an explicit caller byte budget during isolated inventory reads', async () => {
  const root = await repository({ 'a.bin': 'aaa', 'b.bin': 'bbb' });
  const total = await collectPortalSourceInventory(
    new RepoReader({ rootDir: root, maxTotalBytes: 5 }),
  );
  expect(total).toMatchObject({ complete: false, totalBytes: 3, limits: { maxTotalBytes: 5 } });
  expect(total.issues).toContainEqual({ code: 'REPO_TOTAL_BYTES_EXCEEDED', path: 'b.bin' });
  const file = await collectPortalSourceInventory(
    new RepoReader({ rootDir: root, maxFileBytes: 2 }),
  );
  expect(file).toMatchObject({ complete: false, limits: { maxFileBytes: 2 } });
  expect(file.issues).toContainEqual({ code: 'FILE_SIZE_LIMIT_EXCEEDED', path: 'a.bin' });
});

it('classifies UTF-8 control bytes as binary while retaining exact byte identity', async () => {
  const root = await repository({
    'control.txt': Buffer.from([1, 2, 3]),
    'text.txt': 'line\n\ttext\r\n',
  });
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(result.files).toEqual([
    expect.objectContaining({ path: 'control.txt', classification: 'binary', bytes: 3 }),
    expect.objectContaining({ path: 'text.txt', classification: 'text', bytes: 12 }),
  ]);
});

it.each([
  [{ maxFiles: 1 }, 'SOURCE_INVENTORY_DISCOVERY_LIMIT'],
  [{ maxScanEntries: 1 }, 'SOURCE_INVENTORY_DISCOVERY_LIMIT'],
  [{ maxFileBytes: 2 }, 'FILE_SIZE_LIMIT_EXCEEDED'],
  [{ maxTotalBytes: 5 }, 'REPO_TOTAL_BYTES_EXCEEDED'],
])('never treats an exhausted inventory limit %j as complete', async (limits, code) => {
  const root = await repository({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }), limits);
  expect(result.complete).toBe(false);
  expect(result.issues.some(issue => issue.code === code)).toBe(true);
});

it('uses 16 MiB source-file limits and a separate logical inventory byte budget', async () => {
  const root = await repository({ 'asset.bin': Buffer.alloc(9 * 1024 * 1024, 255) });
  const reader = new RepoReader({ rootDir: root });
  const result = await collectPortalSourceInventory(reader);
  expect(result).toMatchObject({ complete: true, totalBytes: 9 * 1024 * 1024 });
  expect(result.limits).toEqual({
    maxFiles: 5000,
    maxFileBytes: 16_777_216,
    maxTotalBytes: 134_217_728,
    maxScanEntries: 20000,
  });
  await expect(reader.readBytes('asset.bin')).rejects.toMatchObject({
    code: 'FILE_SIZE_LIMIT_EXCEEDED',
  });
});

it('enforces actual native default file and aggregate boundaries on raw asset bytes', async () => {
  const root = await repository({});
  const block = Buffer.alloc(16_777_216, 255);
  for (let index = 0; index < 9; index += 1) await writeFile(join(root, `${index}.bin`), block);
  const total = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(total).toMatchObject({ complete: false, totalBytes: 134_217_728 });
  expect(total.files).toHaveLength(8);
  expect(total.issues).toEqual([{ code: 'REPO_TOTAL_BYTES_EXCEEDED', path: '8.bin' }]);
  const oversized = await repository({ 'large.bin': Buffer.alloc(16_777_217, 255) });
  const file = await collectPortalSourceInventory(new RepoReader({ rootDir: oversized }));
  expect(file).toMatchObject({ complete: false, totalBytes: 0, files: [] });
  expect(file.issues).toEqual([{ code: 'FILE_SIZE_LIMIT_EXCEEDED', path: 'large.bin' }]);
});

it('refuses semantic extension filters and subroots in authority traversal', async () => {
  const root = await repository({ 'source.ts': 'text', 'asset.bin': 'asset' });
  await expect(
    new RepoReader({ rootDir: root }).walk({ mode: 'portal-source-authority', extensions: ['ts'] }),
  ).rejects.toMatchObject({ code: 'REPO_AUTHORITY_FILTER_INVALID' });
  await expect(
    new RepoReader({ rootDir: root }).walk({
      mode: 'portal-source-authority',
      startDirectories: [],
    }),
  ).rejects.toMatchObject({ code: 'REPO_AUTHORITY_FILTER_INVALID' });
});

it.skipIf(process.platform === 'win32')(
  'reports case collisions on case-sensitive filesystems',
  async () => {
    const root = await repository({ 'A.txt': 'upper', 'a.txt': 'lower' });
    const inventory = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
    expect(inventory.complete).toBe(false);
    expect(inventory.issues).toEqual([{ code: 'REPO_SOURCE_PATH_COLLISION', path: 'a.txt' }]);
  },
);

it('rejects raised or invalid requested limits before discovery', async () => {
  const root = await repository({ 'a.txt': 'a' });
  for (const limits of [
    { maxFiles: 5001 },
    { maxFileBytes: 16_777_217 },
    { maxTotalBytes: 134_217_729 },
    { maxScanEntries: 20001 },
    { maxFiles: 0 },
  ]) {
    await expect(
      collectPortalSourceInventory(new RepoReader({ rootDir: root }), limits),
    ).rejects.toThrow(/(?:Too big|Too small)/u);
  }
});

it('never opens or recursively scans explicitly excluded source entries', async () => {
  const root = await repository({
    '.git/info/exclude': 'secret Git data',
    'node_modules/pkg/nested/file': 'dependency data',
    '.env': 'credential value',
    '.sfp/runtime': 'service data',
    'safe.txt': 'safe',
  });
  const opened: string[] = [];
  const directories: string[] = [];
  const result = await collectPortalSourceInventory(
    new RepoReader({
      rootDir: root,
      beforeFileOpen: async path => {
        opened.push(path);
      },
      beforeDirectoryOpen: async path => {
        directories.push(path);
      },
    }),
    { maxScanEntries: 5 },
  );
  expect(result.complete).toBe(true);
  expect(result.scannedEntries).toBe(5);
  expect(opened).toEqual([join(root, 'safe.txt')]);
  expect(directories).toEqual(['']);
  const before = result.hash;
  await writeFile(join(root, '.env'), 'changed secret value');
  expect(
    (await collectPortalSourceInventory(new RepoReader({ rootDir: root }), { maxScanEntries: 5 }))
      .hash,
  ).toBe(before);
  await rm(join(root, '.env'));
  expect(
    (await collectPortalSourceInventory(new RepoReader({ rootDir: root }), { maxScanEntries: 5 }))
      .hash,
  ).not.toBe(before);
});

it('makes required junctions explicit incompleteness and preserves semantic walk behavior', async () => {
  const root = await repository({ 'owned/file.txt': 'safe' });
  await symlink(
    join(root, 'owned'),
    join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(result.complete).toBe(false);
  expect(result.issues).toContainEqual({ code: 'REPO_SOURCE_ENTRY_UNSUPPORTED', path: 'linked' });
  expect((await new RepoReader({ rootDir: root }).walk()).files).toEqual(['owned/file.txt']);
  expect(await analyzeServiceGraph(new RepoReader({ rootDir: root }))).toMatchObject({
    incomplete: true,
    lexicalReviewable: false,
  });
});

it('retains observed exclusion decisions and scan accounting when a required entry is unsupported', async () => {
  const root = await repository({ '.env': 'never read', 'owned/file.txt': 'safe' });
  await symlink(
    join(root, 'owned'),
    join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(result).toMatchObject({ complete: false, scannedEntries: 3 });
  expect(result.exclusions).toEqual([{ path: '.env', kind: 'file', reason: 'credentials' }]);
});

it('retains discovery evidence when a required child directory becomes unreadable', async () => {
  const root = await repository({ '.env': 'never read', 'nested/file.txt': 'safe' });
  const result = await collectPortalSourceInventory(
    new RepoReader({
      rootDir: root,
      beforeDirectoryOpen: async path => {
        if (path === 'nested') throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
      },
    }),
  );
  expect(result).toMatchObject({ complete: false, scannedEntries: 2 });
  expect(result.exclusions).toEqual([{ path: '.env', kind: 'file', reason: 'credentials' }]);
  expect(result.issues).toEqual([{ code: 'EACCES', path: 'nested' }]);
});

it('reports unreadable or replaced required files and keeps before-open guards active', async () => {
  const root = await repository({ 'a.txt': 'safe' });
  const result = await collectPortalSourceInventory(
    new RepoReader({
      rootDir: root,
      beforeFileOpen: async path => {
        await rm(path);
      },
    }),
  );
  expect(result.complete).toBe(false);
  expect(result.files).toEqual([]);
  expect(result.issues[0]?.path).toBe('a.txt');
});

it('reports hardlinked required files as incomplete instead of accepting aliased bytes', async () => {
  const root = await repository({ 'a.txt': 'safe' });
  await link(join(root, 'a.txt'), join(root, 'alias.txt'));
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(result).toMatchObject({ complete: false, files: [], totalBytes: 0 });
  expect(result.issues).toEqual([{ code: 'PATH_OUTSIDE_WORKSPACE', path: 'a.txt' }]);
});

it('retains root identity after budget isolation and propagates cancellation', async () => {
  const root = await repository({ 'a.txt': 'safe' });
  const parent = new RepoReader({ rootDir: root });
  const child = await parent.withByteBudget({
    maxFileBytes: 16_777_216,
    maxTotalBytes: 134_217_728,
  });
  const moved = `${root}-moved`;
  roots.push(moved);
  await rename(root, moved);
  await mkdir(root);
  await writeFile(join(root, 'a.txt'), 'replacement');
  await expect(child.readBytes('a.txt')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
  const controller = new AbortController();
  await expect(
    collectPortalSourceInventory(
      new RepoReader({
        rootDir: root,
        signal: controller.signal,
        afterFileOpen: async () => {
          controller.abort();
        },
      }),
    ),
  ).rejects.toMatchObject({ code: 'ABORT_ERR' });
});

it('rejects unsafe real source paths and portable normalization collisions', async () => {
  const root = await repository({ 'café.txt': 'composed', 'café.txt': 'decomposed' });
  const result = await collectPortalSourceInventory(new RepoReader({ rootDir: root }));
  expect(result.complete).toBe(false);
  expect(result.issues[0]?.code).toBe('REPO_SOURCE_PATH_UNSAFE');
});

it('records generated-output directories as hashed exclusions and names an NFD path while the scan continues (SVC-8)', async () => {
  const root = await repository({
    'package.json': '{"name":"generated-output"}',
    'src/index.ts': 'export const index = 1;',
    'src/zeta.ts': 'export const zeta = 1;',
    'src/build/tool.ts': 'export const tool = 1;',
    'z-last/file.ts': 'export const last = 1;',
    'coverage/lcov.info': 'TN:',
    '.next/cache/entry': 'cache',
    'services/api/target/debug/app': 'binary',
    'services/api/__pycache__/main.cpython-313.pyc': 'bytecode',
    'services/api/main.py': 'print("api")',
  });
  // A 6,000-file generated `dist/` is more than the 5,000-file inventory cap.
  await mkdir(join(root, 'dist'));
  for (let start = 0; start < 6000; start += 500)
    await Promise.all(
      Array.from({ length: 500 }, (_, offset) =>
        writeFile(join(root, 'dist', `chunk-${String(start + offset).padStart(4, '0')}.js`), 'x'),
      ),
    );
  const directories: string[] = [];
  const opened: string[] = [];
  const reader = () =>
    new RepoReader({
      rootDir: root,
      beforeDirectoryOpen: async path => {
        directories.push(path);
      },
      beforeFileOpen: async path => {
        opened.push(path);
      },
    });
  const complete = await collectPortalSourceInventory(reader());
  expect(complete).toMatchObject({ complete: true, issues: [] });
  expect(complete.files.map(file => file.path)).toEqual([
    'package.json',
    'services/api/main.py',
    'src/index.ts',
    'src/zeta.ts',
    'z-last/file.ts',
  ]);
  expect(complete.exclusions).toEqual([
    { path: '.next', kind: 'directory', reason: 'generated-output' },
    { path: 'coverage', kind: 'directory', reason: 'generated-output' },
    { path: 'dist', kind: 'directory', reason: 'generated-output' },
    { path: 'services/api/__pycache__', kind: 'directory', reason: 'generated-output' },
    { path: 'services/api/target', kind: 'directory', reason: 'generated-output' },
    { path: 'src/build', kind: 'directory', reason: 'generated-output' },
  ]);
  // Excluded directories are never opened or counted entry by entry.
  expect(complete.scannedEntries).toBeLessThan(20);
  for (const excluded of ['dist', 'coverage', '.next', 'src/build', 'services/api/target'])
    expect(directories).not.toContain(excluded);
  expect(opened.map(path => path.slice(root.length + 1).replaceAll('\\', '/')).toSorted()).toEqual(
    complete.files.map(file => file.path),
  );
  // The exclusion decision is part of the inventory identity; generated bytes are not.
  await writeFile(join(root, 'dist', 'chunk-0000.js'), 'rebuilt');
  expect((await collectPortalSourceInventory(reader())).hash).toBe(complete.hash);
  await rm(join(root, 'coverage'), { recursive: true });
  const withoutCoverage = await collectPortalSourceInventory(reader());
  expect(withoutCoverage.hash).not.toBe(complete.hash);

  // An NFD file name is named with an escaped, portable rendering; the scan does not stop there.
  await writeFile(join(root, 'src', 'café.ts'), 'export const cafe = 1;');
  const named = await collectPortalSourceInventory(reader());
  expect(named.complete).toBe(false);
  expect(named.issues).toEqual([{ code: 'REPO_SOURCE_PATH_UNSAFE', path: 'src/cafe%CC%81.ts' }]);
  expect(named.files.map(file => file.path)).toEqual(withoutCoverage.files.map(file => file.path));
  expect(named.exclusions).toEqual(withoutCoverage.exclusions);
}, 120_000);

it('excludes only credential formats and names and never opens them (K24)', async () => {
  const credentials = [
    '.env',
    '.env.local',
    '.env.production',
    'apps/api/.env.development.local',
    '.npmrc',
    '.netrc',
    'id_rsa',
    'id_ed25519.pub',
    'certs/server.pem',
    'certs/server.key',
    'certs/client.pfx',
    'certs/client.p12',
    'config/credentials.json',
    'config/credentials.yml',
    'config/credentials.xml',
    'config/secrets.yaml',
    'config/secret.json',
    'credentials',
    'secrets/db_password.txt',
    '.aws/credentials',
    '.ssh/config',
  ];
  const ordinary = [
    '.env.example',
    '.env.sample',
    '.env.template',
    'apps/api/.env.local.example',
    'src/credentials.ts',
    'src/secret.ts',
    'src/secrets.ts',
    'src/credentials/CredentialsForm.tsx',
    'config/credentials.example.json',
    'docs/secrets.md',
  ];
  const root = await repository(
    Object.fromEntries([
      ...credentials.map(path => [path, `credential value for ${path}`]),
      ...ordinary.map(path => [path, `public ${path}`]),
    ]),
  );
  const opened: string[] = [];
  const directories: string[] = [];
  const inventory = await collectPortalSourceInventory(
    new RepoReader({
      rootDir: root,
      beforeFileOpen: async path => {
        opened.push(path);
      },
      beforeDirectoryOpen: async path => {
        directories.push(path);
      },
    }),
  );
  expect(inventory.complete).toBe(true);
  expect(inventory.files.map(file => file.path)).toEqual(ordinary.toSorted());
  expect(inventory.exclusions).toEqual(
    [
      ...credentials
        .filter(path => !/^(?:\.aws|\.ssh|secrets)\//u.test(path))
        .map(path => ({ path, kind: 'file', reason: 'credentials' })),
      { path: '.aws', kind: 'directory', reason: 'credentials' },
      { path: '.ssh', kind: 'directory', reason: 'credentials' },
      { path: 'secrets', kind: 'directory', reason: 'credentials' },
    ].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
  expect(opened.map(path => path.slice(root.length + 1).replaceAll('\\', '/')).toSorted()).toEqual(
    ordinary.toSorted(),
  );
  for (const directory of ['.aws', '.ssh', 'secrets']) expect(directories).not.toContain(directory);
  expect(JSON.stringify(inventory)).not.toContain('credential value');
});

it('renders unsafe paths with an injective escape that is itself a portable path', () => {
  const cases: Array<[string, string]> = [
    ['src/café.ts', 'src/cafe%CC%81.ts'],
    ['src/100%.ts', 'src/100%25.ts'],
    ['src/a:b.ts', 'src/a%3Ab.ts'],
    ['src/what?.ts', 'src/what%3F.ts'],
    ['src/trailing.', 'src/trailing%2E'],
    ['src/trailing ', 'src/trailing%20'],
    ['src/con.ts', 'src/%63on.ts'],
    ['src/LPT1', 'src/%4CPT1'],
    ['src/line\nbreak.ts', 'src/line%0Abreak.ts'],
    ['src/back\\slash.ts', 'src/back%5Cslash.ts'],
    ['src/lone\ud800.ts', 'src/lone%ED%A0%80.ts'],
    ['한/file.ts', '%E1%84%92%E1%85%A1%E1%86%AB/file.ts'],
    ['한글/파일.ts', '한글/파일.ts'],
  ];
  for (const [path, escaped] of cases) {
    expect(escapePortalSourcePath(path)).toBe(escaped);
    expect(isPortableSourcePath(escapePortalSourcePath(path))).toBe(true);
  }
  expect(new Set(cases.map(([path]) => escapePortalSourcePath(path))).size).toBe(cases.length);
  // An already portable path is named verbatim, and `%` alone forces escaping of its segment.
  expect(escapePortalSourcePath('src/app.ts')).toBe('src/app.ts');
  expect(escapePortalSourcePath('src/%41.ts')).not.toBe(escapePortalSourcePath('src/A.ts'));
});
