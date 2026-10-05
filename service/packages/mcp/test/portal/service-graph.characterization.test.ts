import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';

/*
 * Regression tests for finding SA-2 (remediation plan section 3.1), fixed by task T26. T06a first
 * recorded the defect here as a characterization; these tests now assert the fixed behavior.
 *
 * SA-2 was: analyzeServiceGraph read lockfiles and data files as source text with a 256 KiB
 * per-file limit and an 8 MiB total (mcp/src/portal/service-graph.ts), and kept one evidence row
 * per import, at most 512 per service. Exceeding either limit was a hard incompleteness
 * (`incomplete: true`, `lexicalReviewable: false`) that no owner review can clear.
 *
 * T26: lockfiles, and data files that do not fit the text limits, are hash-only members. The
 * source inventory still binds their bytes, but they are not decoded as text evidence. Evidence is
 * aggregated per service, module key and kind with a `count`. The limits stay explicit and hard for
 * what the analysis must read (an oversized source file) and for genuinely distinct evidence rows.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const repository = async (files: Record<string, string | Buffer>) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-sa2-regression-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
};
const analyze = (root: string) => analyzeServiceGraph(new RepoReader({ rootDir: root }));
const reactApp = {
  'package.json': JSON.stringify({ name: 'sa2-fixture', dependencies: { react: '19.2.8' } }),
  'src/App.tsx': 'export function App() { return <main>Portal</main>; }\n',
};
/** A syntactically valid JSON lockfile of exactly `bytes` bytes. */
const lockfile = (bytes: number) => {
  const shell = JSON.stringify({ lockfileVersion: 3, padding: '' });
  return JSON.stringify({ lockfileVersion: 3, padding: 'x'.repeat(bytes - shell.length) });
};
/** A YAML or yarn-style text lockfile of exactly `bytes` bytes. */
const textLockfile = (bytes: number) => `lockfileVersion: '9.0'\n# ${'x'.repeat(bytes - 26)}\n`;
/** A TypeScript module of exactly `bytes` bytes. */
const sourceFile = (bytes: number) => {
  const shell = "export const padding = '';\n";
  return `export const padding = '${'x'.repeat(bytes - shell.length)}';\n`;
};
/** `imports` relative imports of distinct modules from one entry file. */
const importTree = (imports: number) => {
  const files: Record<string, string> = {};
  const lines: string[] = [];
  for (let index = 0; index < imports; index += 1) {
    const name = `m${String(index).padStart(3, '0')}`;
    files[`src/modules/${name}.ts`] = `export const ${name} = ${index};\n`;
    lines.push(`import { ${name} } from './modules/${name}';`);
  }
  files['src/index.ts'] = `${lines.join('\n')}\nexport const count = ${imports};\n`;
  return files;
};

it('SA-2 regression: lockfiles of any size are byte-bound, hash-only inventory members', async () => {
  const locks = {
    'package-lock.json': lockfile(900_000),
    'pnpm-lock.yaml': textLockfile(300_000),
    'yarn.lock': textLockfile(300_000),
    'bun.lockb': Buffer.alloc(300_000, 0xff),
  };
  expect(Buffer.byteLength(locks['package-lock.json'])).toBe(900_000);
  expect(Buffer.byteLength(locks['pnpm-lock.yaml'])).toBe(300_000);
  const root = await repository({ ...reactApp, ...locks });
  const graph = await analyze(root);
  expect(graph).toMatchObject({ incomplete: false, issues: [] });
  for (const [path, content] of Object.entries(locks)) {
    const bytes = Buffer.from(content);
    // Byte-bound by the source inventory ...
    expect(graph.sourceInventory?.files.find(file => file.path === path)).toMatchObject({
      bytes: bytes.length,
      hash: storedChecksum(bytes),
    });
    // ... but never decoded as text evidence.
    expect(graph.files.map(file => file.path)).not.toContain(path);
  }
  // A lockfile change still changes the source identity.
  await writeFile(join(root, 'package-lock.json'), lockfile(900_001));
  const changed = await analyze(root);
  expect(changed.sourceInventory?.hash).not.toBe(graph.sourceInventory?.hash);
  expect(changed.sourceHash).not.toBe(graph.sourceHash);

  // Control: an oversized source file that the analysis must read stays an explicit, hard limit
  // naming the path; a source file of exactly 256 KiB is complete.
  expect(Buffer.byteLength(sourceFile(262_145))).toBe(262_145);
  const over = await analyze(await repository({ ...reactApp, 'src/big.ts': sourceFile(262_145) }));
  expect(over).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(over.issues).toEqual(['SOURCE_LIMIT:src/big.ts']);
  const limit = await analyze(await repository({ ...reactApp, 'src/big.ts': sourceFile(262_144) }));
  expect(limit).toMatchObject({ incomplete: false, issues: [] });
});

it('SA-2 regression: a 900 KB lockfile plus 800 imports aggregates evidence without a limit issue', async () => {
  const graph = await analyze(
    await repository({ ...reactApp, 'package-lock.json': lockfile(900_000), ...importTree(800) }),
  );
  expect(graph).toMatchObject({ incomplete: false, issues: [] });
  expect(graph.services).toHaveLength(1);
  const rows = graph.services[0]!.evidence;
  // One row per (service, module key, kind): the manifest, react, and the 800 local imports.
  expect(rows).toHaveLength(3);
  expect(rows).toContainEqual(
    expect.objectContaining({
      kind: 'resolved-module',
      detail: 'local:.',
      path: 'src/index.ts',
      startLine: 1,
      count: 800,
    }),
  );
  expect(rows.reduce((sum, row) => sum + (row.count ?? 1), 0)).toBe(802);
  // Every import is still an exact edge with its own line.
  const edges = graph.edges.filter(edge => edge.kind === 'imports' && edge.from === 'src/index.ts');
  expect(edges).toHaveLength(800);
  expect(edges.find(edge => edge.to === 'src/modules/m799.ts')?.evidence.startLine).toBe(800);

  // Control: 512 distinct evidence rows still fit and 513 still hit the explicit hard limit. The
  // root service gets one `manifest` row and one row per distinct declared package.
  const packages = (count: number) => {
    const names = Array.from({ length: count }, (_, index) => `pkg-${index}`);
    return {
      'package.json': JSON.stringify({
        name: 'sa2-packages',
        dependencies: Object.fromEntries(names.map(name => [name, '1.0.0'])),
      }),
      'src/index.ts': `${names.map(name => `import '${name}';`).join('\n')}\n`,
    };
  };
  const control = await analyze(await repository(packages(511)));
  expect(control.services[0]!.evidence).toHaveLength(512);
  expect(control).toMatchObject({ incomplete: false, issues: [] });
  const limited = await analyze(await repository(packages(512)));
  expect(limited.services[0]!.evidence).toHaveLength(512);
  expect(limited).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(limited.issues).toEqual(['EVIDENCE_LIMIT']);
}, 120_000);

it('SA-2 regression: large data files are hash-only while required sources keep the text budget', async () => {
  const data: Record<string, string> = {};
  // 40 data files of 250,000 bytes: each fits the per-file limit, together they exceed 8 MiB.
  for (let index = 0; index < 40; index += 1)
    data[`data/${String(index).padStart(2, '0')}.json`] = lockfile(250_000);
  const graph = await analyze(
    await repository({
      ...reactApp,
      ...data,
      'data/huge.json': lockfile(600_000),
      'src/load.ts': "import rows from '../data/huge.json';\nexport const count = rows;\n",
    }),
  );
  expect(graph).toMatchObject({ incomplete: false, issues: [] });
  expect(graph.connections?.complete).toBe(true);
  const analyzed = new Set(graph.files.map(file => file.path));
  // Sources sort after the data but are read first.
  expect(analyzed.has('src/load.ts')).toBe(true);
  expect(analyzed.has('src/App.tsx')).toBe(true);
  expect(analyzed.has('data/huge.json')).toBe(false);
  expect([...analyzed].filter(path => path.startsWith('data/')).length).toBeLessThan(40);
  expect(graph.files.reduce((sum, file) => sum + file.bytes, 0)).toBeLessThanOrEqual(8_388_608);
  // Every data file is still byte-bound, and the import of a hash-only data file resolves.
  expect(graph.sourceInventory?.files.filter(file => file.path.startsWith('data/'))).toHaveLength(
    41,
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({ from: 'src/load.ts', to: 'data/huge.json', kind: 'imports' }),
  );
}, 120_000);
