import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { type PortalRecipeInputContext } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import { CORE_RECIPE_CONTRACT_HASH } from '../../src/portal/recipes/core-derivation.js';
import {
  CorePreparations,
  CorePreparationSchema,
} from '../../src/portal/recipes/core-preparation.js';
import { portalFixture } from './fixtures.js';

const hash = contentHash('test', 'input');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

it('executes all seven core derivations and reads signed pages after restart', async () => {
  const f = await fixture();
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  expect(ready.status).toBe('ready');
  expect(ready.results).toHaveLength(7);
  const restarted = new CorePreparations(f);
  const read = await restarted.readResults(f.scope, ready.preparationId);
  expect(read.results).toHaveLength(7);
  expect(
    read.results.flatMap(row => row.pages.flatMap(page => page.page.rows)).length,
  ).toBeGreaterThan(0);
  expect(await restarted.prepare(f.scope, f.context, f.input)).toEqual(ready);
});

it('rejects wrong owners, missing mandatory recipes, stale contract and source substitutions', async () => {
  const f = await fixture();
  await expect(
    f.service.prepare({ ...f.scope, ownerId: 'other' }, f.context, f.input),
  ).rejects.toThrow('OWNER_MISMATCH');
  await expect(
    f.service.prepare(
      f.scope,
      { ...f.context, selections: f.context.selections.slice(1) },
      f.input,
    ),
  ).rejects.toThrow('REQUIRED_RECIPE_MISSING');
  await expect(
    f.service.prepare(
      f.scope,
      { ...f.context, capabilityVersions: [{ id: 'core-derivation', version: 1, hash }] },
      f.input,
    ),
  ).rejects.toThrow('CONTEXT_MISMATCH');
  await expect(
    f.service.prepare(
      f.scope,
      { ...f.context, sourceHashes: [{ sourceId: hash, inventoryHash: hash, graphHash: hash }] },
      f.input,
    ),
  ).rejects.toThrow('SOURCE_MISMATCH');
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  await expect(
    f.service.readResults({ ...f.scope, workspaceId: 'other' }, ready.preparationId),
  ).rejects.toThrow('OWNER_MISMATCH');
});

it('reserves before publishing and never frees retained capacity on cancellation', async () => {
  const f = await fixture({ recordsPerOwner: 1 });
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  await f.service.cancel(f.scope, ready.preparationId);
  await expect(
    f.service.prepare(f.scope, { ...f.context, intentId: 'second' }, f.input),
  ).rejects.toThrow('CAPACITY_EXCEEDED');
  expect((await f.service.prepare(f.scope, f.context, f.input)).status).toBe('cancelled');
  const small = await fixture({ bytesPerOwner: 1 });
  const spy = vi.spyOn(small.store, 'create');
  await expect(small.service.prepare(small.scope, small.context, small.input)).rejects.toThrow(
    'CAPACITY_EXCEEDED',
  );
  expect(spy).not.toHaveBeenCalled();
});

it('serializes separate manager instances and adopts identical orphan result publication', async () => {
  const f = await fixture();
  const create = f.store.create.bind(f.store);
  let interrupted = false;
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const result = await create(...args);
    if (args[0] === 'core-results' && !interrupted) {
      interrupted = true;
      throw Error('simulated crash');
    }
    return result;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input)).rejects.toThrow('simulated crash');
  vi.restoreAllMocks();
  const restarted = new CorePreparations(f);
  const [a, b] = await Promise.all([
    f.service.prepare(f.scope, f.context, f.input),
    restarted.prepare(f.scope, f.context, f.input),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe('ready');
  expect((await restarted.readResults(f.scope, a.preparationId)).results).toHaveLength(7);
});

it('detects altered page bytes even after an earlier ready checkpoint', async () => {
  const f = await fixture();
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  const read = await f.service.readResults(f.scope, ready.preparationId);
  const pageHash = read.results.flatMap(row => row.pages)[0]!.hash;
  const pageId = contentHash('sfp-core-page-record-v1', {
    contextHash: ready.contextHash,
    pageHash,
  });
  const path = join(f.stateRoot, 'portal/core-pages', `${pageId.slice(7)}.json`);
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.replace(/"mac":"[a-f0-9]{64}"/u, `"mac":"${'0'.repeat(64)}"`));
  await expect(f.service.readResults(f.scope, ready.preparationId)).rejects.toThrow(
    'PORTAL_RECORD_TAMPERED',
  );
  await expect(f.service.prepare(f.scope, f.context, f.input)).rejects.toThrow(
    'PORTAL_RECORD_TAMPERED',
  );
});

it('retains blocked material and prohibits dependency adoption until every result is ready', async () => {
  const f = await fixture();
  const blocked = await f.service.prepare(f.scope, f.context, { ...f.input, assets: [] });
  expect(blocked.status).toBe('blocked');
  const read = await f.service.readResults(f.scope, blocked.preparationId);
  expect(read.results.some(row => row.result.status === 'blocked')).toBe(true);
  await expect(
    f.service.setDependency(f.scope, blocked.preparationId, 'plan', true),
  ).rejects.toThrow('NOT_READY');
  const ready = await f.service.prepare(f.scope, { ...f.context, intentId: 'fixed' }, f.input);
  await f.service.setDependency(f.scope, ready.preparationId, 'plan', true);
  await expect(f.service.cancel(f.scope, ready.preparationId)).rejects.toThrow('IN_USE');
  await f.service.setDependency(f.scope, ready.preparationId, 'plan', false);
  expect((await f.service.cancel(f.scope, ready.preparationId)).status).toBe('cancelled');
});

it('records cancellation after partial publication and never turns it into successful resume', async () => {
  const f = await fixture();
  const abort = new AbortController();
  const create = f.store.create.bind(f.store);
  let preparationId = '';
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const result = await create(...args);
    if (args[0] === 'core-preparations')
      preparationId = CorePreparationSchema.parse(result).preparationId;
    if (args[0] === 'core-pages') abort.abort();
    return result;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input, abort.signal)).rejects.toThrow(
    /abort/iu,
  );
  expect((await f.service.inspect(f.scope, preparationId)).status).toBe('cancelled');
  expect((await f.service.prepare(f.scope, f.context, f.input)).status).toBe('cancelled');
});

it('never rebinds an admitted context to different core inputs', async () => {
  const f = await fixture();
  await f.service.prepare(f.scope, f.context, f.input);
  await expect(f.service.prepare(f.scope, f.context, { ...f.input, assets: [] })).rejects.toThrow(
    'CONTEXT_CHANGED',
  );
});

it.each(['core-inputs', 'core-preparations', 'core-pages'])(
  'recovers interruption after %s publication without adding reservations',
  async stage => {
    const f = await fixture({ recordsPerOwner: 1 });
    const create = f.store.create.bind(f.store);
    let interrupted = false;
    vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
      const result = await create(...args);
      if (args[0] === stage && !interrupted) {
        interrupted = true;
        throw Error('interrupted');
      }
      return result;
    });
    await expect(f.service.prepare(f.scope, f.context, f.input)).rejects.toThrow('interrupted');
    vi.restoreAllMocks();
    const ready = await new CorePreparations(f).prepare(f.scope, f.context, f.input);
    expect(ready.status).toBe('ready');
    expect((await f.service.readResults(f.scope, ready.preparationId)).results).toHaveLength(7);
  },
);

it('binds an intent at capacity reservation before any input or preparation publication', async () => {
  const f = await fixture({ recordsPerOwner: 1 });
  const create = f.store.create.bind(f.store);
  let interrupted = false;
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const value = await create(...args);
    if (args[0] === 'core-capacity' && !interrupted) {
      interrupted = true;
      throw Error('reservation crash');
    }
    return value;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input)).rejects.toThrow('reservation crash');
  vi.restoreAllMocks();
  await expect(
    new CorePreparations(f).prepare(
      f.scope,
      { ...f.context, authorityHash: contentHash('other', 'authority') },
      f.input,
    ),
  ).rejects.toThrow('CORE_PREPARATION_INTENT_CHANGED');
  expect((await f.service.prepare(f.scope, f.context, f.input)).status).toBe('ready');
});

it('recovers legacy reservation bindings only from matching signed preparation and input records', async () => {
  const f = await fixture({ recordsPerOwner: 1 });
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  const schema = z.object({
    version: z.literal(1),
    revision: z.number(),
    rows: z.array(
      z.object({ preparationId: z.string(), ownerId: z.string(), bytes: z.number() }).strip(),
    ),
  });
  await f.store.update('core-capacity', 'index', schema, value => value);
  expect((await new CorePreparations(f).prepare(f.scope, f.context, f.input)).preparationId).toBe(
    ready.preparationId,
  );
  const capacity = JSON.parse(
    await readFile(join(f.stateRoot, 'portal/core-capacity/index.json'), 'utf8'),
  );
  expect(capacity.payload.rows).toHaveLength(1);
  expect(capacity.payload.rows[0].intentHash).toMatch(/^sha256:/u);
  await expect(
    f.service.prepare(
      f.scope,
      { ...f.context, authorityHash: contentHash('changed', 'authority') },
      f.input,
    ),
  ).rejects.toThrow('CORE_PREPARATION_INTENT_CHANGED');
});

it('retains an unreconstructable legacy capacity prefix and requires explicit recovery', async () => {
  const f = await fixture();
  const create = f.store.create.bind(f.store);
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const value = await create(...args);
    if (args[0] === 'core-capacity') throw Error('reservation crash');
    return value;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input)).rejects.toThrow('reservation crash');
  vi.restoreAllMocks();
  const schema = z.object({
    version: z.literal(1),
    revision: z.number(),
    rows: z.array(
      z.object({ preparationId: z.string(), ownerId: z.string(), bytes: z.number() }).strip(),
    ),
  });
  await f.store.update('core-capacity', 'index', schema, value => value);
  const before = await readFile(join(f.stateRoot, 'portal/core-capacity/index.json'), 'utf8');
  await expect(new CorePreparations(f).prepare(f.scope, f.context, f.input)).rejects.toThrow(
    'CORE_CAPACITY_LEGACY_RECOVERY_REQUIRED',
  );
  expect(await readFile(join(f.stateRoot, 'portal/core-capacity/index.json'), 'utf8')).toBe(before);
});
