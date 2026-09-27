import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { storedChecksum } from '@sfp/ir';
import type { DesignObservation } from '@sfp/shared';
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
 * T06a characterization of finding SA-1 (remediation plan section 3.1). The fix is task T26.
 *
 * SA-1: convention analysis keeps at most 32 evidence rows per category and every import
 * statement is one `imports` row, so the 33rd import marks the whole analysis `truncated`
 * (mcp/src/profile/conventions.ts:81-91 and 155-165). Core recipe preparation treats any
 * truncated or unread convention analysis as CORE_SOURCE_PATTERN_INCOMPLETE
 * (mcp/src/portal/recipes/core-source.ts:309-322); that error is caught into the prepared
 * source's `mappingIssue`, and derivation (core-derivation.ts:950-959) turns it into blocking
 * issue rows. A 34-file React source with 33 imports is therefore blocked although nothing is
 * unread. T26 ("record convention evidence as a sample with counts; block only on unread
 * effective inputs") flips these tests.
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
/** A small React source: one button and `importingFiles` cards that each import it once. */
const reactSource = async (importingFiles: number) => {
  const path = await mkdtemp(join(tmpdir(), 'sfp-sa1-characterization-'));
  dirs.push(path);
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
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(path, name)), { recursive: true });
    await writeFile(join(path, name), content);
  }
  return new RepoReader({ rootDir: path });
};
const issueRows = (bundle: CoreRecipeBundle, recipeId: string, code: string) =>
  bundle.pages
    .filter(item => item.page.recipeId === recipeId)
    .flatMap(item => item.page.rows)
    .filter(row => row.kind === 'issue' && row.issue.code === code);

it('SA-1 characterization: the 33rd import statement makes convention analysis truncated with nothing unread (flip in T26)', async () => {
  // SA-1, fixed by T26. Seam: analyzeConventions (conventions.ts:81-91) over a real tree.
  const conventions = await analyzeConventions(await reactSource(33));
  expect(conventions.inspectedFiles).toBe(34);
  expect(conventions.unreadFiles).toEqual([]);
  expect(conventions.categories.imports.evidence).toHaveLength(32);
  expect(conventions.truncated).toBe(true);
  // The evidence cap in one category also turns every unobserved category into `incomplete`.
  expect(conventions.categories.routing.status).toBe('incomplete');

  // Control: 32 import statements fit the cap and the analysis is complete.
  const control = await analyzeConventions(await reactSource(32));
  expect(control.categories.imports.evidence).toHaveLength(32);
  expect(control).toMatchObject({ truncated: false, unreadFiles: [] });
  expect(control.categories.routing.status).toBe('not-observed');
});

it('SA-1 characterization: a source with 33 import statements gets CORE_SOURCE_PATTERN_INCOMPLETE from core recipe preparation (flip in T26)', async () => {
  // SA-1, fixed by T26. Seam: prepareCoreRecipeSource (core-source.ts:309-322) and the derived
  // core recipe bundle. The thrown CORE_SOURCE_PATTERN_INCOMPLETE is caught into `mappingIssue`
  // (core-source.ts:393-401), so the observable outcome is the prepared capsule and issue rows.
  const observation = observed(raw());
  const prepare = async (importingFiles: number) => {
    const source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader: await reactSource(importingFiles),
      observation,
    });
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

  const truncated = await prepare(33);
  expect(truncated.prepared.inventory.complete).toBe(true);
  expect(truncated.prepared.mappingIssue).toBe('CORE_SOURCE_PATTERN_INCOMPLETE');
  expect(truncated.prepared.mappingResults).toBeNull();
  expect(
    issueRows(truncated.bundle, 'plan-design-implementation', 'CORE_SOURCE_PATTERN_INCOMPLETE'),
  ).not.toHaveLength(0);
  expect(
    issueRows(truncated.bundle, 'map-design', 'CORE_SOURCE_PATTERN_INCOMPLETE'),
  ).not.toHaveLength(0);
  expect(
    truncated.bundle.results.find(result => result.recipeId === 'plan-design-implementation')
      ?.output.status,
  ).toBe('blocked');

  // Control: with 32 import statements the same source is mapped without a pattern issue.
  const control = await prepare(32);
  expect(control.prepared.mappingIssue).toBeNull();
  expect(control.prepared.mappingResults).not.toBeNull();
  expect(
    issueRows(control.bundle, 'plan-design-implementation', 'CORE_SOURCE_PATTERN_INCOMPLETE'),
  ).toHaveLength(0);
  expect(issueRows(control.bundle, 'map-design', 'CORE_SOURCE_PATTERN_INCOMPLETE')).toHaveLength(0);
}, 120_000);
