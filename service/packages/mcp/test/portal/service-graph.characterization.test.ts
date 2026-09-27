import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';

/*
 * T06a characterization of finding SA-2 (remediation plan section 3.1). The fix is task T26.
 *
 * SA-2: analyzeServiceGraph reads lockfiles and data files as source text with a 256 KiB
 * per-file limit and an 8 MiB total (mcp/src/portal/service-graph.ts:97-112), and keeps at most
 * 512 evidence rows per service (244-249). Exceeding either limit is a hard incompleteness:
 * `incomplete: true` with `lexicalReviewable: false`, which no owner review can clear. T26's
 * acceptance ("a 900 KB lockfile plus 800 imports raises no limit issue") flips these tests.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const repository = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-sa2-characterization-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return new RepoReader({ rootDir: root });
};
const reactApp = {
  'package.json': JSON.stringify({ name: 'sa2-fixture', dependencies: { react: '19.2.8' } }),
  'src/App.tsx': 'export function App() { return <main>Portal</main>; }\n',
};
/** A syntactically valid JSON lockfile of exactly `bytes` bytes. */
const lockfile = (bytes: number) => {
  const shell = JSON.stringify({ lockfileVersion: 3, padding: '' });
  return JSON.stringify({ lockfileVersion: 3, padding: 'x'.repeat(bytes - shell.length) });
};

it('SA-2 characterization: a lockfile one byte over 256 KiB makes the service graph hard-incomplete with SOURCE_LIMIT:<path> (flip in T26)', async () => {
  // SA-2, fixed by T26 (lockfiles become hashes only). Seam: analyzeServiceGraph on a real tree.
  const over = lockfile(262_145);
  expect(Buffer.byteLength(over)).toBe(262_145);
  const graph = await analyzeServiceGraph(
    await repository({ ...reactApp, 'package-lock.json': over }),
  );
  expect(graph).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(graph.issues).toEqual(['SOURCE_LIMIT:package-lock.json']);
  expect(graph.files.map(file => file.path)).not.toContain('package-lock.json');

  // Control: the same tree with a lockfile of exactly 256 KiB is complete.
  const limit = lockfile(262_144);
  expect(Buffer.byteLength(limit)).toBe(262_144);
  const control = await analyzeServiceGraph(
    await repository({ ...reactApp, 'package-lock.json': limit }),
  );
  expect(control).toMatchObject({ incomplete: false, issues: [] });
});

it('SA-2 characterization: the 513th evidence row of one service makes the graph hard-incomplete with EVIDENCE_LIMIT (flip in T26)', async () => {
  // SA-2, fixed by T26 (evidence aggregated per service, specifier and kind). Seam:
  // analyzeServiceGraph on a real tree. The root service gets one `manifest` row, one `dependency`
  // row for react, and one `resolved-module` row per import statement in src/index.ts.
  const tree = (imports: number) => {
    const files: Record<string, string> = { ...reactApp };
    const lines: string[] = [];
    for (let index = 0; index < imports; index += 1) {
      const name = `m${String(index).padStart(3, '0')}`;
      files[`src/modules/${name}.ts`] = `export const ${name} = ${index};\n`;
      lines.push(`import { ${name} } from './modules/${name}';`);
    }
    files['src/index.ts'] = `${lines.join('\n')}\nexport const count = ${imports};\n`;
    return files;
  };

  // 2 + 511 = 513 evidence rows: the last one is dropped.
  const graph = await analyzeServiceGraph(await repository(tree(511)));
  expect(graph.services).toHaveLength(1);
  expect(graph.services[0]!.evidence).toHaveLength(512);
  expect(graph).toMatchObject({ incomplete: true, lexicalReviewable: false });
  expect(graph.issues).toEqual(['EVIDENCE_LIMIT']);

  // Control: 2 + 510 = 512 evidence rows fit, and the graph is complete.
  const control = await analyzeServiceGraph(await repository(tree(510)));
  expect(control.services[0]!.evidence).toHaveLength(512);
  expect(control).toMatchObject({ incomplete: false, issues: [] });
}, 120_000);
