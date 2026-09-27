import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { canonicalJson, storedChecksum } from '@sfp/ir';
import { CONVENTION_CATEGORIES, type DesignObservation } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import {
  deriveCoreRecipeBundle,
  type CoreRecipeBundle,
} from '../../src/portal/recipes/core-derivation.js';
import {
  coreHash,
  prepareCoreRecipeSource,
  readCoreRecipeSource,
} from '../../src/portal/recipes/core-source.js';
import { analyzeConventions } from '../../src/profile/conventions.js';

/*
 * Regression tests for finding SA-1 (remediation plan section 3.1), fixed by task T26. T06a first
 * recorded the defect here as a characterization; these tests now assert the fixed behavior.
 *
 * SA-1 was: convention analysis kept at most 32 evidence rows per category, every import statement
 * was one `imports` row, and reaching that cap marked the whole analysis `truncated`
 * (mcp/src/profile/conventions.ts). Core recipe preparation treats a truncated or unread convention
 * analysis as CORE_SOURCE_PATTERN_INCOMPLETE (mcp/src/portal/recipes/core-source.ts), so a small
 * React source with 33 imports was blocked although nothing was unread.
 *
 * T26: evidence is a bounded, deterministic sample plus an exact `count` per category. A full
 * sample is not incompleteness. `truncated` is set only when an effective input is unread, and each
 * unread input is named in `unreadFiles`.
 *
 * Fixture helpers (`raw`, `observed`, `asset`) are those of core-recipes.test.ts.
 */
const dirs: string[] = [];
afterEach(async () => {
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
});
const hash = `sha256:${'a'.repeat(64)}` as const;
const root = { id: '1:2', type: 'FRAME', name: 'Home', reactions: [], children: [] };
const styles = { paints: [], texts: [], effects: [], grids: [] };
const raw = () => ({
  source: 'figma-plugin-api-via-scripter',
  requestedNodeId: '0:1',
  nodes: [root],
  tokens: [],
  collections: [],
  styles,
});
function observed(input: unknown): DesignObservation {
  const base = normalizeDesignObservation(input);
  return normalizeDesignObservation(input, {
    evidenceVersion: 1,
    contentHash: base.contentHash,
    capabilities: base.capabilities.map(capability => ({
      name: capability.name,
      status:
        capability.reason === 'SOURCE_PARTIAL'
          ? 'partial'
          : capability.retainedCount
            ? 'complete'
            : 'empty',
      count: capability.retainedCount,
    })),
    coherence: {
      status: 'observed',
      atomic: false,
      method: 'content-reobservation',
      before: base.contentHash,
      after: base.contentHash,
      contentHash: base.contentHash,
      outcome: 'matched',
    },
    sourceBinding: {
      status: 'observed',
      fileIdentityHash: hash,
      scopeId: '0:1',
      sessionId: 'session',
      generation: 'attempt',
      method: 'file-key',
    },
  });
}
const asset = (nodeId = '1:2', bytes = Buffer.from('same export bytes')) => ({
  record: {
    query: { kind: 'png' as const, nodeId },
    status: 'captured' as const,
    path: `assets/${nodeId.replace(':', '-')}.png`,
    sha256: storedChecksum(bytes),
    bytes: bytes.length,
  },
  bytes,
});
const writeTree = async (files: Record<string, string>) => {
  const path = await mkdtemp(join(tmpdir(), 'sfp-sa1-regression-'));
  dirs.push(path);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(path, name)), { recursive: true });
    await writeFile(join(path, name), content);
  }
  return new RepoReader({ rootDir: path });
};
/** A small React source: one button and `importingFiles` cards that each import it once. */
const reactFiles = (importingFiles: number) => {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'sa1-fixture', dependencies: { react: '19.2.8' } }),
    'src/Button.tsx': 'export function Button() { return <button>Save</button>; }\n',
    'src/tokens.css': ':root { --primary: #ff0000; }\n',
  };
  for (let index = 1; index <= importingFiles; index += 1) {
    const name = `Card${String(index).padStart(2, '0')}`;
    files[`src/components/${name}.tsx`] =
      `import { Button } from '../Button';\nexport function ${name}() { return <Button />; }\n`;
  }
  return files;
};
const reactSource = (importingFiles: number) => writeTree(reactFiles(importingFiles));
/**
 * A 200-source-file React application: an entry, providers, a store, a theme, 20 route files, 150
 * cards and 25 tests. It uses routing, state, data-access, theme, testing and accessibility
 * conventions often enough that several categories exceed the 32-row sample.
 */
const reactApplication = () => {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'sa1-react-application',
      dependencies: {
        react: '19.2.8',
        'react-dom': '19.2.8',
        'react-router-dom': '7.9.0',
        '@tanstack/react-query': '5.90.0',
        zustand: '5.0.8',
      },
      devDependencies: { vitest: '4.1.11', '@testing-library/react': '16.3.0' },
    }),
    'src/main.tsx':
      "import { createRoot } from 'react-dom/client';\nimport { App } from './App';\n" +
      'createRoot(document.body).render(<App />);\n',
    'src/App.tsx':
      "import { BrowserRouter } from 'react-router-dom';\n" +
      "import { QueryClient, QueryClientProvider } from '@tanstack/react-query';\n" +
      "import { Home } from './routes/Route01';\n" +
      'const client = new QueryClient();\n' +
      'export function App() {\n' +
      '  return <QueryClientProvider client={client}><BrowserRouter><main aria-label="Portal"><Home /></main></BrowserRouter></QueryClientProvider>;\n' +
      '}\n',
    'src/theme/tokens.ts': "export const tokens = { primary: '#ff0000', radius: 4 };\n",
    'src/store/useCounter.ts':
      "import { create } from 'zustand';\n" +
      'export const useCounter = create(() => ({ count: 0 }));\n',
    'src/Button.tsx':
      "import { tokens } from './theme/tokens';\n" +
      'export function Button(props: { onClick?: () => void; label?: string }) {\n' +
      '  return <button aria-label={props.label ?? "Action"} style={{ color: tokens.primary }} onClick={props.onClick}>Go</button>;\n' +
      '}\n',
  };
  for (let index = 1; index <= 20; index += 1) {
    const name = `Route${String(index).padStart(2, '0')}`;
    files[`src/routes/${name}.tsx`] =
      "import { useState } from 'react';\n" +
      "import { useNavigate } from 'react-router-dom';\n" +
      `import { Card${String(index).padStart(3, '0')} } from '../components/Card${String(index).padStart(3, '0')}';\n` +
      `export function ${index === 1 ? 'Home' : name}() {\n` +
      '  const navigate = useNavigate();\n' +
      '  const [page, setPage] = useState(0);\n' +
      `  return <section role="region" aria-label="${name}"><Card${String(index).padStart(3, '0')} />\n` +
      '    <button aria-label="Next" onClick={() => { setPage(page + 1); navigate("/"); }}>Next</button></section>;\n' +
      '}\n';
  }
  for (let index = 1; index <= 150; index += 1) {
    const name = `Card${String(index).padStart(3, '0')}`;
    files[`src/components/${name}.tsx`] =
      "import { useState } from 'react';\n" +
      "import { Button } from '../Button';\n" +
      "import { useCounter } from '../store/useCounter';\n" +
      `export function ${name}() {\n` +
      '  const [open, setOpen] = useState(false);\n' +
      '  const count = useCounter(state => state.count);\n' +
      `  return <article aria-label="${name}" aria-expanded={open}><Button label="${name}" onClick={() => setOpen(!open)} />{count}</article>;\n` +
      '}\n';
  }
  for (let index = 1; index <= 25; index += 1) {
    const name = `Card${String(index).padStart(3, '0')}`;
    files[`src/components/__tests__/${name}.test.tsx`] =
      "import { describe, expect, it } from 'vitest';\n" +
      "import { render } from '@testing-library/react';\n" +
      `import { ${name} } from '../${name}';\n` +
      `describe('${name}', () => { it('renders', () => { expect(render(<${name} />)).toBeTruthy(); }); });\n`;
  }
  return files;
};
const issueRows = (bundle: CoreRecipeBundle, recipeId: string, code: string) =>
  bundle.pages
    .filter(item => item.page.recipeId === recipeId)
    .flatMap(item => item.page.rows)
    .filter(row => row.kind === 'issue' && row.issue.code === code);
const observation = observed(raw());
const prepare = async (reader: RepoReader) => {
  const source = await prepareCoreRecipeSource({ sourceId: hash, reader, observation });
  return {
    prepared: readCoreRecipeSource(source, coreHash(observation)),
    bundle: deriveCoreRecipeBundle({
      observation,
      strategy: 'reference-portal',
      assets: [asset()],
      sources: [source],
    }),
  };
};

it('SA-1 regression: 33 import statements give a full 32-row sample and an exact count, not truncation', async () => {
  const conventions = await analyzeConventions(await reactSource(33));
  expect(conventions.inspectedFiles).toBe(34);
  expect(conventions.unreadFiles).toEqual([]);
  expect(conventions.truncated).toBe(false);
  expect(conventions.categories.imports.evidence).toHaveLength(32);
  expect(conventions.categories.imports.count).toBe(33);
  expect(conventions.categories.imports.status).toBe('observed');
  // A full sample in one category no longer turns unobserved categories into `incomplete`.
  expect(conventions.categories.routing).toEqual({
    status: 'not-observed',
    evidence: [],
    count: 0,
  });

  // Control at the sample size: 32 import statements are all sampled and counted.
  const control = await analyzeConventions(await reactSource(32));
  expect(control.categories.imports.evidence).toHaveLength(32);
  expect(control.categories.imports.count).toBe(32);
  expect(control).toMatchObject({ truncated: false, unreadFiles: [] });
});

it('SA-1 regression: core recipe preparation maps a source with 33 import statements, and an unread input still blocks', async () => {
  const sampled = await prepare(await reactSource(33));
  expect(sampled.prepared.inventory.complete).toBe(true);
  expect(sampled.prepared.mappingIssue).toBeNull();
  expect(sampled.prepared.mappingResults).not.toBeNull();
  for (const recipe of ['plan-design-implementation', 'map-design'])
    expect(issueRows(sampled.bundle, recipe, 'CORE_SOURCE_PATTERN_INCOMPLETE')).toHaveLength(0);

  // Control: an effective input that cannot be parsed is unread, is named, and still blocks.
  const files = reactFiles(33);
  files['src/components/Broken.tsx'] = 'export function Broken( { return <div>; }\n';
  const reader = await writeTree(files);
  const conventions = await analyzeConventions(reader);
  expect(conventions.truncated).toBe(true);
  expect(conventions.unreadFiles).toContainEqual({
    filePath: 'src/components/Broken.tsx',
    reason: 'PARSE_FAILED',
  });
  const unread = await prepare(await writeTree(files));
  expect(unread.prepared.mappingIssue).toBe('CORE_SOURCE_PATTERN_INCOMPLETE');
  expect(issueRows(unread.bundle, 'map-design', 'CORE_SOURCE_PATTERN_INCOMPLETE')).not.toHaveLength(
    0,
  );
}, 120_000);

it('SA-1 regression: a 200-file React application is sampled with exact counts and is not truncated', async () => {
  const files = reactApplication();
  expect(Object.keys(files).filter(path => path.startsWith('src/'))).toHaveLength(200);
  const conventions = await analyzeConventions(await writeTree(files));
  expect(conventions).toMatchObject({ inspectedFiles: 200, truncated: false, unreadFiles: [] });
  for (const category of CONVENTION_CATEGORIES) {
    const { status, evidence, count = 0 } = conventions.categories[category];
    expect({
      category,
      status,
      sampled: evidence.length <= 32 && count >= evidence.length,
    }).toEqual({ category, status: 'observed', sampled: true });
  }
  // Exact counts, far beyond the sample. Cards, routes and tests import three modules each.
  expect(conventions.categories.imports.count).toBe(
    150 * 3 + 20 * 3 + 25 * 3 + /* main */ 2 + /* App */ 3 + /* store */ 1 + /* Button */ 1,
  );
  // One useState call in every card and route, plus the zustand import of the store.
  expect(conventions.categories.state.count).toBe(150 + 20 + 1);
  // react-router-dom in App and every route, plus 20 route files.
  expect(conventions.categories.routing.count).toBe(1 + 20 + 20);
  // Two library imports and the test-file path signal per test.
  expect(conventions.categories.testing.count).toBe(25 * 2 + 25);
  // App and Button once, three attributes per route, two per card.
  expect(conventions.categories.accessibility.count).toBe(1 + 1 + 20 * 3 + 150 * 2);
  expect(conventions.categories.dataAccess.count).toBe(1);
  expect(conventions.categories.theme.count).toBe(1);
  expect(
    (['imports', 'state', 'routing', 'testing', 'accessibility'] as const).map(
      category => conventions.categories[category].evidence.length,
    ),
  ).toEqual([32, 32, 32, 32, 32]);

  // The sample and counts are deterministic for an unchanged tree.
  const again = await analyzeConventions(await writeTree(files));
  expect(canonicalJson(again.categories)).toBe(canonicalJson(conventions.categories));
}, 120_000);
