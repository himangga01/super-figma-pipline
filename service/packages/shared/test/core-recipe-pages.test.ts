import { expect, it } from 'vitest';

import {
  PortalCoreRecipePageSchema,
  PortalCoreRecipeManifestSchema,
  PortalCoreMaterialSchema,
} from '../src/portal-recipes.js';

const hash = `sha256:${'a'.repeat(64)}`;
it('bounds source material before recursive JSON parsing and refuses arbitrary page payloads', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expect(PortalCoreMaterialSchema.safeParse({ hash, value: cyclic }).success).toBe(false);
  let calls = 0;
  const getter = Object.defineProperty({}, 'rows', {
    enumerable: true,
    get() {
      calls++;
      return [];
    },
  });
  expect(PortalCoreRecipePageSchema.safeParse(getter).success).toBe(false);
  expect(calls).toBe(0);
  expect(
    PortalCoreRecipePageSchema.safeParse({
      pageVersion: 1,
      recipeId: 'ground-design',
      index: 0,
      rows: [{ kind: 'scope', payload: 'not typed evidence' }],
    }).success,
  ).toBe(false);
});
it('retains long actual node identifiers within bounded typed pages and rejects false empty manifests', () => {
  const nodeId = 'I1:2;' + 'I3:4;'.repeat(70) + '5:6';
  expect(
    PortalCoreRecipePageSchema.safeParse({
      pageVersion: 1,
      recipeId: 'ground-design',
      index: 0,
      rows: [
        {
          kind: 'scope',
          id: hash,
          nodeId,
          root: true,
          nodeType: 'FRAME',
          propertiesHash: hash,
          componentApi: null,
          overrides: null,
        },
      ],
    }).success,
  ).toBe(true);
  const manifest = {
    schemaId: 'sfp.recipe.core-manifest.v1',
    contractHash: hash,
    recipeId: 'ground-design',
    derivationVersion: 1,
    inputHash: hash,
    observationHash: hash,
    status: 'ready',
    applicability: 'proved-empty',
    pages: [{ index: 0, hash, rows: 1, bytes: 100 }],
    rowCount: 1,
    obligationCount: 1,
    issueCount: 0,
    blockingIssueCount: 0,
    capabilityEvidence: [],
  };
  expect(PortalCoreRecipeManifestSchema.safeParse(manifest).success).toBe(false);
  expect(
    PortalCoreRecipeManifestSchema.safeParse({
      ...manifest,
      applicability: 'applicable',
      capabilityEvidence: [
        { name: 'tree', status: 'partial', count: null, retainedCount: 1, hash },
      ],
    }).success,
  ).toBe(false);
});
it('requires source context membership, closed layers and explicit unresolved diagnostics', () => {
  const context = {
    version: 1,
    mode: 'qualified',
    sourceId: hash,
    sourceIndex: 0,
    members: [{ sourceId: hash, rootIdentityHash: hash, inventoryHash: hash, graphHash: hash }],
    requestHash: hash,
    selectionHash: hash,
    reviewsHash: hash,
    contextHash: hash,
    selectedRoots: ['web'],
    closureRoots: ['web'],
    effectivePathsHash: hash,
    effectiveLayers: ['frontend'],
    complete: true,
    issues: [],
  };
  const page = (value: unknown) => ({
    pageVersion: 1,
    recipeId: 'map-design',
    index: 0,
    rows: [{ kind: 'source-context', id: hash, context: value }],
  });
  expect(PortalCoreRecipePageSchema.safeParse(page(context)).success).toBe(true);
  for (const changed of [
    { sourceIndex: 1 },
    { closureRoots: [] },
    { complete: false },
    { effectiveLayers: ['imaginary-layer'] },
    { selectedRoots: ['../escape'], closureRoots: ['../escape'] },
  ])
    expect(PortalCoreRecipePageSchema.safeParse(page({ ...context, ...changed })).success).toBe(
      false,
    );
});
