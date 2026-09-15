import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { type PortalRecipeInputContext } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import {
  PortalCoreDeclarationBatchSchema,
  PortalCoreDeclarationsSchema,
  PortalCoreEvidenceViewSchema,
} from '../../../shared/src/portal-core-lifecycle.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import { CORE_RECIPE_CONTRACT_HASH } from '../../src/portal/recipes/core-derivation.js';
import {
  PortalCoreLifecycle,
  coreDeclarationsHash,
  unavailableCoreBinding,
} from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { portalFixture } from './fixtures.js';

const hash = contentHash('test', 'input');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(limits?: ConstructorParameters<typeof CorePreparations>[0]['limits']) {
  const fs = await portalFixture();
  cleanup.push(fs.cleanup);
  const service = new CorePreparations({ ...fs, ...(limits ? { limits } : {}) });
  const scope = { ownerId: 'actor', workspaceId: fs.workspaceId };
  const raw = {
    source: 'figma-plugin-api-via-scripter',
    requestedNodeId: '0:1',
    nodes: [{ id: '1:2', type: 'FRAME', name: 'Home', reactions: [], children: [] }],
    tokens: [],
    collections: [],
    styles: { paints: [], texts: [], effects: [], grids: [] },
  };
  const base = normalizeDesignObservation(raw);
  const observation = normalizeDesignObservation(raw, {
    evidenceVersion: 1,
    contentHash: base.contentHash,
    capabilities: base.capabilities.map(value => ({
      name: value.name,
      status:
        value.reason === 'SOURCE_PARTIAL' ? 'partial' : value.retainedCount ? 'complete' : 'empty',
      count: value.retainedCount,
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
  const bytes = Buffer.from('retained export');
  const input = {
    observation,
    strategy: 'blank-frontend' as const,
    assets: [
      {
        bytes,
        record: {
          query: { kind: 'png' as const, nodeId: '1:2' },
          status: 'captured' as const,
          path: 'assets/root.png',
          sha256: storedChecksum(bytes),
          bytes: bytes.length,
        },
      },
    ],
  };
  const context: PortalRecipeInputContext = {
    recipeAuthorityVersion: 1,
    ...scope,
    intentId: 'intent',
    strategy: 'blank-frontend',
    authorityHash: hash,
    captureHash: hash,
    assetManifestHash: hash,
    scopeHash: hash,
    sourceHashes: [],
    capabilityVersions: [{ id: 'core-derivation', version: 1, hash: CORE_RECIPE_CONTRACT_HASH }],
    selections: (
      [
        'ground-design',
        'map-design',
        'derive-tokens',
        'audit-styles',
        'resolve-assets',
        'derive-interactions',
        'plan-design-implementation',
      ] as const
    ).map(recipeId => ({
      recipeId,
      definitionHash: contentHash('definition-test', recipeId),
      required: true,
      applicability: 'applicable',
      evidence: [{ kind: 'capture', captureHash: hash, itemId: '0:1' }],
    })),
  };
  return { ...fs, service, scope, context, input };
}

it('prepares real seven-core bindings and reads exact page work items after restart', async () => {
  const f = await fixture(),
    lifecycle = new PortalCoreLifecycle(f.service);
  const binding = await lifecycle.prepare(f.scope, f.context, f.input, hash);
  expect(binding).toMatchObject({
    status: 'ready',
    recipeAuthorityVersion: 1,
    requiredResults: expect.any(Array),
  });
  expect(binding.requiredResults).toHaveLength(7);
  expect(binding.workItemCount).toBeGreaterThan(0);
  const restarted = new PortalCoreLifecycle(new CorePreparations(f));
  await restarted.verify(f.scope, binding);
  const view = await restarted.view(f.scope, binding);
  expect(view.workItems.length).toBe(binding.workItemCount);
  const first = view.workItems[0]!;
  const page = await restarted.view(f.scope, binding, {
    resultId: first.resultId,
    pageIndex: first.pageIndex,
  });
  expect(page.pageHash).toBe(first.pageHash);
  expect(page.page?.rows).toHaveLength(first.rows);
  await expect(
    restarted.view(f.scope, binding, { resultId: 'sha256:' + 'b'.repeat(64) }),
  ).rejects.toThrow('RESULT_NOT_FOUND');
  await expect(restarted.view({ ...f.scope, ownerId: 'other' }, binding)).rejects.toThrow(
    'OWNER_MISMATCH',
  );
});

it('binds every work page declaration and invalidates changed file references', async () => {
  const f = await fixture(),
    lifecycle = new PortalCoreLifecycle(f.service);
  const binding = await lifecycle.prepare(f.scope, f.context, f.input, hash);
  const view = await lifecycle.view(f.scope, binding);
  const files = [{ path: 'src/App.tsx', hash }];
  const declarations = view.workItems.map(item => ({
    resultId: item.resultId,
    resultHash: item.resultHash,
    outputItemId: item.id,
    kind: item.kind,
    files,
    assertionIds: [],
  }));
  await expect(
    lifecycle.mergeDeclarations(f.scope, binding, files, [], declarations.slice(1), true),
  ).rejects.toThrow('DECLARATIONS_INCOMPLETE');
  const stored = await lifecycle.mergeDeclarations(f.scope, binding, files, [], declarations, true);
  expect(coreDeclarationsHash(stored)).toBe(coreDeclarationsHash(stored.toReversed()));
  const changed = [{ path: 'src/App.tsx', hash: contentHash('changed', 'source') }];
  expect(await lifecycle.mergeDeclarations(f.scope, binding, changed, stored, [], false)).toEqual(
    [],
  );
  await expect(
    lifecycle.mergeDeclarations(f.scope, binding, changed, stored, [], true),
  ).rejects.toThrow('DECLARATIONS_INCOMPLETE');
  await expect(
    lifecycle.mergeDeclarations(
      f.scope,
      binding,
      files,
      [],
      [{ ...declarations[0]!, resultHash: 'sha256:' + 'b'.repeat(64) }],
      false,
    ),
  ).rejects.toThrow('DECLARATION_NOT_BOUND');
});

it('keeps draft capture unavailability inspectable without a preparation or lease authority', async () => {
  const f = await fixture(),
    lifecycle = new PortalCoreLifecycle(f.service);
  const binding = unavailableCoreBinding(hash, 'PORTAL_CAPTURE_CURRENT_REQUIRED');
  expect(await lifecycle.view(f.scope, binding)).toMatchObject({
    binding: { status: 'blocked', preparationId: null, requiredResults: [] },
    workItems: [],
  });
  await expect(lifecycle.verify(f.scope, binding)).rejects.toThrow('PREPARATION_REQUIRED');
});

it('retains dependencies and revalidates tampered pages before renewal-style reads', async () => {
  const f = await fixture(),
    lifecycle = new PortalCoreLifecycle(f.service);
  const binding = await lifecycle.prepare(f.scope, f.context, f.input, hash);
  await lifecycle.retain(f.scope, binding, 'plan');
  await expect(f.service.cancel(f.scope, binding.preparationId!)).rejects.toThrow('IN_USE');
  const view = await lifecycle.view(f.scope, binding),
    first = view.workItems[0]!;
  const pageId = contentHash('sfp-core-page-record-v1', {
    contextHash: binding.contextHash,
    pageHash: first.pageHash,
  });
  const path = join(f.stateRoot, 'portal/core-pages', pageId.slice(7) + '.json');
  const original = await readFile(path, 'utf8');
  await writeFile(
    path,
    original.replace(/"mac":"[a-f0-9]{64}"/u, '"mac":"' + '0'.repeat(64) + '"'),
  );
  await expect(lifecycle.verify(f.scope, binding)).rejects.toThrow('PORTAL_RECORD_TAMPERED');
  await writeFile(path, original);
  await lifecycle.release(f.scope, binding, 'plan');
  await f.service.cancel(f.scope, binding.preparationId!);
  await expect(lifecycle.verify(f.scope, binding)).rejects.toThrow('BINDING_CHANGED');
});

it('bounds declaration input before getters and oversized batches are parsed', () => {
  let calls = 0;
  const forged = {
    get resultId() {
      calls++;
      return 'value';
    },
  };
  expect(PortalCoreDeclarationBatchSchema.safeParse([forged]).success).toBe(false);
  expect(calls).toBe(0);
  expect(
    PortalCoreDeclarationBatchSchema.safeParse(Array.from({ length: 65 }, () => ({}))).success,
  ).toBe(false);
});

it('supports all4096 core page declarations while bounding aggregate bytes and transport typing', () => {
  const declarations = Array.from({ length: 4096 }, (_, index) => ({
    resultId: hash,
    resultHash: hash,
    outputItemId: contentHash('page', index),
    kind: 'scope',
    files: [{ path: 'src/app.ts', hash }],
    assertionIds: [],
  }));
  expect(PortalCoreDeclarationsSchema.safeParse(declarations).success).toBe(true);
  expect(
    PortalCoreDeclarationsSchema.safeParse([
      ...declarations,
      { ...declarations[0], outputItemId: contentHash('extra', 0) },
    ]).success,
  ).toBe(false);
  const oversized = declarations.map(row =>
    Object.assign({}, row, {
      files: Array.from({ length: 3 }, (_, index) => ({
        path: 'src/' + String(index) + 'a'.repeat(990) + '.ts',
        hash,
      })),
    }),
  );
  expect(PortalCoreDeclarationsSchema.safeParse(oversized).success).toBe(false);
  expect(() => PortalCoreEvidenceViewSchema.toJSONSchema()).not.toThrow();
  const binding = unavailableCoreBinding(hash, 'PORTAL_CAPTURE_CURRENT_REQUIRED');
  expect(
    PortalCoreEvidenceViewSchema.safeParse({
      binding,
      results: [],
      workItems: [],
      nextWorkOffset: null,
      selectedResultId: hash,
      pageHash: hash,
      page: {
        pageVersion: 1,
        recipeId: 'ground-design',
        index: 0,
        rows: [{ kind: 'invented', id: 'invalid' }],
      },
    }).success,
  ).toBe(false);
});
