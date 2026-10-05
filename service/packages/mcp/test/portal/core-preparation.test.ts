import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, lstat, unlink } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import {
  hashActionRequest,
  PORTAL_CORE_RECIPE_LIMITS,
  type ActorContext,
  type PortalRecipeInputContext,
} from '@sfp/shared';
import { build } from 'tsdown';
import { afterEach, expect, it, vi } from 'vitest';
import { beforeAll } from 'vitest';
import { z } from 'zod';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { AuthenticatedControlRouter } from '../../src/control/router.js';
import { registerPortalArchiveRoutes } from '../../src/portal/control.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import { NativeEnvironmentLifecycle } from '../../src/portal/native-lifecycle.js';
import { CORE_RECIPE_CONTRACT_HASH } from '../../src/portal/recipes/core-derivation.js';
import {
  CorePreparations,
  CorePreparationSchema,
  CorePreparationArchiveSchema,
  CorePublicationSchema,
} from '../../src/portal/recipes/core-preparation.js';
import { portalFixture } from './fixtures.js';

const hash = contentHash('test', 'input');
const cleanup: Array<() => Promise<void>> = [];
let archiveWorker: string;
let publicationWorker: string;
beforeAll(async () => {
  const folder = resolve('packages/mcp/.cache/core-archive-worker');
  await mkdir(folder, { recursive: true });
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    `
    import {readFile} from 'node:fs/promises';
    import {CorePreparations} from ${JSON.stringify(resolve('packages/mcp/src/portal/recipes/core-preparation.ts'))};
    import {PortalStore} from ${JSON.stringify(resolve('packages/mcp/src/portal/store.ts'))};
    import {fixturePermissions} from ${JSON.stringify(resolve('packages/mcp/test/portal/fixtures.ts'))};
    const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const permissions = fixturePermissions(value.stateRoot), store = new PortalStore(value.stateRoot, Buffer.from(value.key, 'hex'), permissions);
    const manager = new CorePreparations({stateRoot:value.stateRoot, store, permissions, archivePolicy:{
      withArchiveEligibility:async (_record,work)=>work(), afterRecordReduction:async()=>process.exit(85),
    }});
    await manager.archive(value.scope, value.preparationId, value.archiveHash);
    throw Error('core archive boundary not reached');
  `,
  );
  const publicationEntry = join(folder, 'publication.ts');
  await writeFile(
    publicationEntry,
    `
    import {readFile} from 'node:fs/promises';
    import {CorePreparations} from ${JSON.stringify(resolve('packages/mcp/src/portal/recipes/core-preparation.ts'))};
    import {PortalStore} from ${JSON.stringify(resolve('packages/mcp/src/portal/store.ts'))};
    import {AtomicFileStore} from ${JSON.stringify(resolve('packages/mcp/src/fs/atomic-file.ts'))};
    import {fixturePermissions} from ${JSON.stringify(resolve('packages/mcp/test/portal/fixtures.ts'))};
    const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const permissions = fixturePermissions(value.stateRoot), store = new PortalStore(value.stateRoot, Buffer.from(value.key, 'hex'), permissions);
    const original = AtomicFileStore.prototype.createNew;
    AtomicFileStore.prototype.createNew = function(target, bytes) {
      if (target.replaceAll('\\\\', '/').includes('/portal/core-pages/'))
        return original.call(new AtomicFileStore({afterFileFsync:async()=>process.exit(86)}), target, bytes);
      return original.call(this, target, bytes);
    };
    value.input.assets = value.input.assets.map(asset=>({...asset,bytes:Buffer.from(asset.bytes.data)}));
    await new CorePreparations({stateRoot:value.stateRoot,store,permissions}).prepare(value.scope,value.context,value.input);
    throw Error('publication temp fsync boundary not reached');
  `,
  );
  await build({
    config: false,
    entry: [entry, publicationEntry],
    outDir: folder,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    clean: false,
    fixedExtension: true,
    deps: {
      alwaysBundle: ['@sfp/ir', '@sfp/shared'],
      neverBundle: ['playwright', 'playwright-core', 'oxc-parser'],
    },
    logLevel: 'silent',
  });
  archiveWorker = join(folder, 'entry.mjs');
  publicationWorker = join(folder, 'publication.mjs');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(limits?: ConstructorParameters<typeof CorePreparations>[0]['limits']) {
  const fs = await portalFixture();
  cleanup.push(fs.cleanup);
  const archivePolicy = {
    withArchiveEligibility: async <T>(_record: unknown, work: () => Promise<T>) => work(),
  };
  const service = new CorePreparations({ ...fs, archivePolicy, ...(limits ? { limits } : {}) });
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
  return { ...fs, archivePolicy, service, scope, context, input };
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

it('sizes publication and archive metadata row bounds for the supported page limit plus seven results', () => {
  // Schema-bound evidence only; this does not claim execution of a maximum-size source corpus.
  const entries = Array.from({ length: PORTAL_CORE_RECIPE_LIMITS.pages + 7 }, (_, i) => ({
    kind: i < PORTAL_CORE_RECIPE_LIMITS.pages ? 'core-pages' : 'core-results',
    id: contentHash('bound-row', i),
    recordHash: hash,
    bytes: 1,
  }));
  expect(CorePublicationSchema.shape.entries.safeParse(entries).success).toBe(true);
  expect(
    CorePublicationSchema.shape.entries.safeParse([
      ...entries,
      { ...entries[0], id: contentHash('overflow', null) },
    ]).success,
  ).toBe(false);
  const archiveEntries = [
    ...entries,
    { kind: 'core-inputs', id: hash, recordHash: hash, bytes: 1 },
    { kind: 'core-publications', id: hash, recordHash: hash, bytes: 1 },
  ].map(entry => Object.assign({}, entry, { state: 'pending' }));
  expect(CorePreparationArchiveSchema.shape.entries.safeParse(archiveEntries).success).toBe(true);
  expect(
    CorePreparationArchiveSchema.shape.entries.safeParse([...archiveEntries, archiveEntries[0]])
      .success,
  ).toBe(false);
});

it('archives only owner-approved unpinned preparations, retains signed receipt identities and fences the original intent', async () => {
  const f = await fixture();
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  await f.service.setDependency(f.scope, ready.preparationId, 'plan:retained', true);
  await expect(f.service.reviewArchive(f.scope, ready.preparationId)).rejects.toThrow(
    'CORE_PREPARATION_IN_USE',
  );
  await f.service.setDependency(f.scope, ready.preparationId, 'plan:retained', false);
  await expect(
    f.service.reviewArchive({ ...f.scope, ownerId: 'other' }, ready.preparationId),
  ).rejects.toThrow('CORE_PREPARATION_OWNER_MISMATCH');
  const review = await f.service.reviewArchive(f.scope, ready.preparationId);
  const original = await f.service.inspect(f.scope, ready.preparationId);
  await expect(
    f.service.archive(f.scope, ready.preparationId, contentHash('wrong', null)),
  ).rejects.toThrow('CORE_ARCHIVE_CHANGED');
  await f.service.archive(f.scope, ready.preparationId, review.archiveHash);
  const restarted = new CorePreparations(f);
  expect(
    await restarted.verifyArchive(f.scope, ready.preparationId, review.archiveHash),
  ).toMatchObject({ completed: true, record: original });
  await expect(restarted.prepare(f.scope, f.context, f.input)).rejects.toThrow(
    'CORE_PREPARATION_ARCHIVED',
  );
  await expect(restarted.readResults(f.scope, ready.preparationId)).rejects.toThrow(
    'CORE_PREPARATION_ARCHIVED',
  );
  expect(
    await restarted.prepare(f.scope, { ...f.context, intentId: 'new-intent' }, f.input),
  ).toMatchObject({ status: 'ready' });
});

it('keeps interrupted core reductions charged and resumes only matching signed archive markers', async () => {
  const f = await fixture({ recordsPerOwner: 1 });
  const ready = await f.service.prepare(f.scope, f.context, f.input);
  const review = await f.service.reviewArchive(f.scope, ready.preparationId);
  let interrupted = false;
  const manager = new CorePreparations({
    ...f,
    limits: { recordsPerOwner: 1 },
    archivePolicy: {
      ...f.archivePolicy,
      afterRecordReduction: async () => {
        if (!interrupted) {
          interrupted = true;
          throw Error('interrupted reduction');
        }
      },
    },
  });
  await expect(manager.archive(f.scope, ready.preparationId, review.archiveHash)).rejects.toThrow(
    'interrupted reduction',
  );
  await expect(
    f.service.prepare(f.scope, { ...f.context, intentId: 'next' }, f.input),
  ).rejects.toThrow('CORE_PREPARATION_CAPACITY_EXCEEDED');
  await expect(
    f.service.verifyArchive(f.scope, ready.preparationId, review.archiveHash),
  ).rejects.toThrow('CORE_ARCHIVE_INCOMPLETE');
  await expect(f.service.readResults(f.scope, ready.preparationId)).rejects.toThrow(
    'CORE_PREPARATION_ARCHIVED',
  );
  const restarted = new CorePreparations({ ...f, limits: { recordsPerOwner: 1 } });
  await restarted.archive(f.scope, ready.preparationId, review.archiveHash);
  expect(
    (await restarted.verifyArchive(f.scope, ready.preparationId, review.archiveHash)).record,
  ).toEqual(ready);
  await expect(
    restarted.prepare(f.scope, { ...f.context, intentId: 'next' }, f.input),
  ).resolves.toMatchObject({ status: 'ready' });
});

it('resumes a real child exit after physical core reduction before the signed progress pointer', async () => {
  const f = await fixture(),
    ready = await f.service.prepare(f.scope, f.context, f.input);
  const review = await f.service.reviewArchive(f.scope, ready.preparationId),
    input = join(f.workspaceRoot, 'core-archive-child.json');
  await writeFile(
    input,
    JSON.stringify({
      stateRoot: f.stateRoot,
      key: f.key.toString('hex'),
      scope: f.scope,
      preparationId: ready.preparationId,
      archiveHash: review.archiveHash,
    }),
  );
  const child = spawn(process.execPath, [archiveWorker, input], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostic = '';
  child.stdout.on('data', value => {
    diagnostic += value.toString();
  });
  child.stderr.on('data', value => {
    diagnostic += value.toString();
  });
  const code = await new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('core archive child timed out'));
    }, 15_000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', exit => {
      clearTimeout(timer);
      done(exit);
    });
  });
  expect({ code, diagnostic }).toMatchObject({ code: 85 });
  expect(
    (
      await f.store.get(
        'core-capacity',
        'index',
        z
          .object({ rows: z.array(z.object({ preparationId: z.string() }).passthrough()) })
          .passthrough(),
      )
    )?.rows,
  ).toContainEqual(expect.objectContaining({ preparationId: ready.preparationId }));
  await expect(
    f.service.verifyArchive(f.scope, ready.preparationId, review.archiveHash),
  ).rejects.toThrow('CORE_ARCHIVE_INCOMPLETE');
  const restarted = new CorePreparations(f);
  await restarted.archive(f.scope, ready.preparationId, review.archiveHash);
  expect(
    (await restarted.verifyArchive(f.scope, ready.preparationId, review.archiveHash)).record,
  ).toEqual(ready);
}, 30_000);

it('routes actual core archival through a review-bound owner nonce without permitting another owner or replay', async () => {
  const f = await fixture(),
    actor: ActorContext = {
      actorId: `actor1_${'A'.repeat(43)}`,
      authSessionId: `auth1_${'B'.repeat(43)}`,
      entryPath: 'control',
    };
  const scope = { ...f.scope, ownerId: actor.actorId };
  const ready = await f.service.prepare(scope, { ...f.context, ...scope }, f.input);
  const router = new AuthenticatedControlRouter(),
    nonces = createActionNonceStore({ leaderGeneration: 'core-archive-control' });
  registerPortalArchiveRoutes(
    router,
    new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions),
    f.service,
    nonces,
  );
  router.freeze();
  const call = (path: string, input: unknown, principal = actor) =>
    router.dispatch(
      { method: 'POST', path: `/control/portal/core/archive${path}`, input },
      principal,
      new AbortController().signal,
    );
  const review = (await call('/review', {
    workspaceId: scope.workspaceId,
    preparationId: ready.preparationId,
  })) as { archiveHash: string };
  const exact = {
    workspaceId: scope.workspaceId,
    preparationId: ready.preparationId,
    archiveHash: review.archiveHash,
  };
  const nonce = await nonces.issue(
    actor,
    'portal.core.archive',
    hashActionRequest('portal.core.archive', exact),
  );
  await expect(
    call('', {
      ...exact,
      archiveHash: contentHash('altered-review', null),
      actionNonce: nonce.value,
    }),
  ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
  await expect(
    call(
      '',
      { ...exact, actionNonce: nonce.value },
      { ...actor, actorId: `actor1_${'C'.repeat(43)}` },
    ),
  ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
  expect(await call('', { ...exact, actionNonce: nonce.value })).toMatchObject({ completed: true });
  await expect(call('', { ...exact, actionNonce: nonce.value })).rejects.toMatchObject({
    code: 'ACTION_NONCE_INVALID',
  });
  expect(
    (await f.service.verifyArchive(scope, ready.preparationId, review.archiveHash)).record,
  ).toEqual(ready);
});

it('uses the current signed revision after the server guard settles terminal dependencies, invalidating old review approval', async () => {
  const f = await fixture(),
    ready = await f.service.prepare(f.scope, f.context, f.input);
  const oldReview = await f.service.reviewArchive(f.scope, ready.preparationId);
  await f.service.setDependency(f.scope, ready.preparationId, 'run:terminal', true);
  await f.service.setDependency(f.scope, ready.preparationId, 'plan:terminal', true);
  const manager = new CorePreparations({
    ...f,
    archivePolicy: {
      withArchiveEligibility: async <T>(_record: unknown, work: () => Promise<T>) => {
        // Production resolves these exact references from signed terminal plans/runs under its queue.
        await f.service.setDependency(f.scope, ready.preparationId, 'run:terminal', false);
        await f.service.setDependency(f.scope, ready.preparationId, 'plan:terminal', false);
        return work();
      },
    },
  });
  const currentReview = await manager.reviewArchive(f.scope, ready.preparationId);
  expect(currentReview.archiveHash).not.toBe(oldReview.archiveHash);
  await expect(
    manager.archive(f.scope, ready.preparationId, oldReview.archiveHash),
  ).rejects.toThrow('CORE_ARCHIVE_CHANGED');
  await manager.archive(f.scope, ready.preparationId, currentReview.archiveHash);
  expect(
    (await manager.verifyArchive(f.scope, ready.preparationId, currentReview.archiveHash)).record
      .dependencies,
  ).toEqual([]);
});

it('rejects exhausted archive accounting before replacing any current core input or page', async () => {
  const f = await fixture(),
    ready = await f.service.prepare(f.scope, f.context, f.input);
  const review = await f.service.reviewArchive(f.scope, ready.preparationId);
  await f.store.create(
    'core-archive-capacity',
    'index',
    {
      version: 1,
      rows: [{ preparationId: contentHash('orphan-archive-reservation', null), bytes: 67_108_864 }],
    },
    z.object({
      version: z.literal(1),
      rows: z.array(z.object({ preparationId: z.string(), bytes: z.number().int() })),
    }),
  );
  await expect(f.service.archive(f.scope, ready.preparationId, review.archiveHash)).rejects.toThrow(
    'CORE_ARCHIVE_CAPACITY',
  );
  expect((await f.service.readResults(f.scope, ready.preparationId)).results).toHaveLength(7);
});

it('charges all physical signed archive metadata and replaces every large evidence record with a bounded marker', async () => {
  const f = await fixture(),
    ready = await f.service.prepare(f.scope, f.context, f.input);
  const review = await f.service.reviewArchive(f.scope, ready.preparationId);
  await f.service.archive(f.scope, ready.preparationId, review.archiveHash);
  const audit = await f.service.verifyArchive(f.scope, ready.preparationId, review.archiveHash);
  for (const entry of audit.entries) {
    const path = join(f.stateRoot, 'portal', entry.kind, `${entry.id.slice(7)}.json`);
    const value = JSON.parse(await readFile(path, 'utf8')) as {
      payload: { protocol: string; bytes: number };
    };
    expect(value.payload).toMatchObject({
      protocol: 'sfp-core-record-archive-v1',
      bytes: entry.bytes,
    });
    expect((await lstat(path)).size).toBeLessThan(1024);
  }
  const walk = async (path: string): Promise<number> => {
    const stat = await lstat(path);
    if (!stat.isDirectory()) {
      if (
        path.includes('core-inputs') ||
        path.includes('core-results') ||
        path.includes('core-pages')
      ) {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as {
          payload?: Record<string, unknown>;
        };
        // eslint-disable-next-line vitest/no-conditional-expect -- evidence folders exclude the immutable preparation audit
        expect(
          parsed.payload?.page ?? parsed.payload?.result ?? parsed.payload?.context,
        ).toBeUndefined();
      }
      return stat.size;
    }
    let total = 0;
    for (const name of await readdir(path)) total += await walk(join(path, name));
    return total;
  };
  const physicalBytes = await walk(join(f.stateRoot, 'portal'));
  const capacity = await f.store.get(
    'core-archive-capacity',
    'index',
    z.object({ rows: z.array(z.object({ bytes: z.number() }).passthrough()) }).passthrough(),
  );
  expect(physicalBytes).toBeLessThanOrEqual(capacity!.rows[0]!.bytes);
});

it('reclaims actual preparation capacity beyond 32 distinct owner intents and 128 globally', async () => {
  const f = await fixture();
  let first!: Awaited<ReturnType<typeof f.service.prepare>>;
  for (let i = 0; i < 32; i++) {
    const value = await f.service.prepare(
      f.scope,
      { ...f.context, intentId: `owner-${i}` },
      f.input,
    );
    if (!i) first = value;
  }
  await expect(
    f.service.prepare(f.scope, { ...f.context, intentId: 'owner-33' }, f.input),
  ).rejects.toThrow('CORE_PREPARATION_CAPACITY_EXCEEDED');
  const review = await f.service.reviewArchive(f.scope, first.preparationId);
  await f.service.archive(f.scope, first.preparationId, review.archiveHash);
  await f.service.prepare(f.scope, { ...f.context, intentId: 'owner-33' }, f.input);
  process.stdout.write('completed owner preparations: 33\n');
  for (let owner = 1; owner <= 3; owner++) {
    const scope = { ...f.scope, ownerId: `owner-${owner}` };
    for (let i = 0; i < 32; i++)
      await f.service.prepare(
        scope,
        { ...f.context, ...scope, intentId: `global-${owner}-${i}` },
        f.input,
      );
    process.stdout.write(`completed global preparations: ${33 + owner * 32}\n`);
  }
  const other = { ...f.scope, ownerId: 'owner-4' };
  await expect(
    f.service.prepare(other, { ...f.context, ...other, intentId: 'global-130' }, f.input),
  ).rejects.toThrow('CORE_PREPARATION_CAPACITY_EXCEEDED');
  const current = await f.service.inspectIntent(f.scope, 'owner-33');
  const nextReview = await f.service.reviewArchive(f.scope, current.preparationId);
  await f.service.archive(f.scope, current.preparationId, nextReview.archiveHash);
  await f.service.prepare(other, { ...f.context, ...other, intentId: 'global-130' }, f.input);
  expect(
    (await f.service.verifyArchive(f.scope, first.preparationId, review.archiveHash)).record,
  ).toEqual(first);
  expect(
    (
      await f.store.get(
        'core-capacity',
        'index',
        z.object({ rows: z.array(z.unknown()) }).passthrough(),
      )
    )?.rows,
  ).toHaveLength(128);
}, 300_000);

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

it('archives a new preparation cancelled before its first output using its persisted empty publication authority', async () => {
  const f = await fixture({ recordsPerOwner: 1 }),
    controller = new AbortController(),
    create = f.store.create.bind(f.store);
  let preparationId = '';
  const publishedKinds: string[] = [];
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const value = await create(...args);
    publishedKinds.push(args[0]);
    if (args[0] === 'core-preparations') {
      preparationId = CorePreparationSchema.parse(value).preparationId;
      controller.abort(Error('cancel before first output'));
    }
    return value;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input, controller.signal)).rejects.toThrow(
    'cancel before first output',
  );
  vi.restoreAllMocks();
  const original = await f.service.inspect(f.scope, preparationId);
  expect(original).toMatchObject({ status: 'cancelled', results: [], dependencies: [] });
  expect(publishedKinds).not.toContain('core-pages');
  expect(publishedKinds).not.toContain('core-results');
  const restarted = new CorePreparations({ ...f, archivePolicy: f.archivePolicy });
  const review = await restarted.reviewArchive(f.scope, preparationId);
  expect(review.entries).toBe(2);
  expect(
    await f.store.get('core-publications', preparationId.slice(7), CorePublicationSchema),
  ).toMatchObject({
    unaccountedLegacyPrefix: false,
    entries: [],
  });
  await restarted.archive(f.scope, preparationId, review.archiveHash);
  expect(
    (await restarted.verifyArchive(f.scope, preparationId, review.archiveHash)).record,
  ).toEqual(original);
  await expect(restarted.prepare(f.scope, f.context, f.input)).rejects.toThrow(
    'CORE_PREPARATION_ARCHIVED',
  );
  await expect(
    restarted.prepare(f.scope, { ...f.context, intentId: 'after-zero-output-archive' }, f.input),
  ).resolves.toMatchObject({ status: 'ready' });
});

it.each(['core-pages', 'core-results'] as const)(
  'archives the actual interrupted %s publication prefix before freeing capacity',
  async stage => {
    const f = await fixture({ recordsPerOwner: 1 }),
      controller = new AbortController();
    const create = f.store.create.bind(f.store);
    const published: Array<{ kind: string; id: string }> = [];
    vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
      const value = await create(...args);
      if (args[0] === 'core-pages' || args[0] === 'core-results')
        published.push({ kind: args[0], id: args[1] });
      if (args[0] === stage) controller.abort(Error('publication interrupted'));
      return value;
    });
    await expect(f.service.prepare(f.scope, f.context, f.input, controller.signal)).rejects.toThrow(
      'publication interrupted',
    );
    vi.restoreAllMocks();
    const { preparationId } = await f.service
      .inspectIntent(f.scope, f.context.intentId)
      .catch(async () => {
        const capacity = await f.store.get(
          'core-capacity',
          'index',
          z
            .object({ rows: z.array(z.object({ preparationId: z.string() }).passthrough()) })
            .passthrough(),
        );
        return { preparationId: capacity!.rows[0]!.preparationId };
      });
    const original = await f.service.inspect(f.scope, preparationId);
    expect(original).toMatchObject({ status: 'cancelled', results: [] });
    expect(published.length).toBeGreaterThan(0);
    const review = await f.service.reviewArchive(f.scope, preparationId);
    await f.service.archive(f.scope, preparationId, review.archiveHash);
    for (const row of published) {
      const stored = JSON.parse(
        await readFile(join(f.stateRoot, 'portal', row.kind, `${row.id}.json`), 'utf8'),
      ) as { payload: { protocol?: string } };
      expect(stored.payload.protocol).toBe('sfp-core-record-archive-v1');
    }
    expect(
      (await f.service.verifyArchive(f.scope, preparationId, review.archiveHash)).record,
    ).toEqual(original);
    await expect(
      f.service.prepare(f.scope, { ...f.context, intentId: 'after-reclaim' }, f.input),
    ).resolves.toMatchObject({ status: 'ready' });
  },
);

it.each(['cancelled', 'ready'] as const)(
  'keeps an actual child-crash publication temp charged for %s canonical outputs and preserves unrelated record temps',
  async status => {
    const f = await fixture({ recordsPerOwner: 1 }),
      input = join(f.workspaceRoot, 'core-publication-child.json');
    await writeFile(
      input,
      JSON.stringify({
        stateRoot: f.stateRoot,
        key: f.key.toString('hex'),
        scope: f.scope,
        context: f.context,
        input: f.input,
      }),
    );
    const child = spawn(process.execPath, [publicationWorker, input], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '';
    child.stdout.on('data', value => {
      diagnostic += value.toString();
    });
    child.stderr.on('data', value => {
      diagnostic += value.toString();
    });
    const code = await new Promise<number | null>((done, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('core publication child timed out'));
      }, 15_000);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', exit => {
        clearTimeout(timer);
        done(exit);
      });
    });
    expect({ code, diagnostic }).toMatchObject({ code: 86 });
    const directory = join(f.stateRoot, 'portal/core-pages'),
      files = await readdir(directory);
    expect(files).toHaveLength(1);
    const temporaryPath = join(directory, files[0]!);
    expect(files[0]).toMatch(/^\.[a-f0-9]{64}\.json\.[a-f0-9]{32}\.sfp-tmp$/u);
    const originalBytes = await readFile(temporaryPath),
      preparationFile = (await readdir(join(f.stateRoot, 'portal/core-preparations'))).find(name =>
        /^[a-f0-9]{64}\.json$/u.test(name),
      )!,
      original = await f.store.get(
        'core-preparations',
        preparationFile.slice(0, -5),
        CorePreparationSchema,
      ),
      ready =
        status === 'ready'
          ? await f.service.prepare(f.scope, f.context, f.input)
          : await f.service.cancel(f.scope, original!.preparationId);
    expect(ready.status).toBe(status);
    await expect(f.service.reviewArchive(f.scope, ready.preparationId)).rejects.toThrow(
      'CORE_ARCHIVE_PUBLICATION_TEMP_RECOVERY_REQUIRED',
    );
    await expect(
      f.service.prepare(f.scope, { ...f.context, intentId: 'blocked-by-crash-temp' }, f.input),
    ).rejects.toThrow('CORE_PREPARATION_CAPACITY_EXCEEDED');
    expect(await readFile(temporaryPath)).toEqual(originalBytes);

    // Exact fixture-owned intervention, not production adoption/deletion authority.
    await unlink(temporaryPath);
    const unrelatedPath = join(directory, `.${'f'.repeat(64)}.json.${'a'.repeat(32)}.sfp-tmp`);
    await writeFile(unrelatedPath, 'unrelated owner bytes');
    const review = await f.service.reviewArchive(f.scope, ready.preparationId);
    // Recheck even after review: a matching unknown temp invalidates the approved archive before effects.
    await writeFile(temporaryPath, originalBytes);
    await expect(
      f.service.archive(f.scope, ready.preparationId, review.archiveHash),
    ).rejects.toThrow('CORE_ARCHIVE_PUBLICATION_TEMP_RECOVERY_REQUIRED');
    expect(await readFile(temporaryPath)).toEqual(originalBytes);
    expect(await readFile(unrelatedPath, 'utf8')).toBe('unrelated owner bytes');
    await unlink(temporaryPath);
    await f.service.archive(f.scope, ready.preparationId, review.archiveHash);
    expect(
      (await f.service.verifyArchive(f.scope, ready.preparationId, review.archiveHash)).record,
    ).toEqual(ready);
    expect(await readFile(unrelatedPath, 'utf8')).toBe('unrelated owner bytes');
    await expect(
      f.service.prepare(f.scope, { ...f.context, intentId: 'after-owned-temp-removal' }, f.input),
    ).resolves.toMatchObject({ status: 'ready' });
  },
  30_000,
);

it('keeps a partial publication without its originating authority charged and preserves its page bytes', async () => {
  const f = await fixture({ recordsPerOwner: 1 }),
    controller = new AbortController(),
    create = f.store.create.bind(f.store);
  let pagePath = '';
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    const value = await create(...args);
    if (args[0] === 'core-pages') {
      pagePath = join(f.stateRoot, 'portal/core-pages', `${args[1]}.json`);
      controller.abort(Error('cancelled prefix'));
    }
    return value;
  });
  await expect(f.service.prepare(f.scope, f.context, f.input, controller.signal)).rejects.toThrow(
    'cancelled prefix',
  );
  vi.restoreAllMocks();
  const capacity = await f.store.get(
    'core-capacity',
    'index',
    z
      .object({ rows: z.array(z.object({ preparationId: z.string() }).passthrough()) })
      .passthrough(),
  );
  const preparationId = capacity!.rows[0]!.preparationId,
    originalBytes = await readFile(pagePath);
  // Simulate an old interrupted record which predates publication authority; absence is not adoption proof.
  await unlink(join(f.stateRoot, 'portal/core-publications', `${preparationId.slice(7)}.json`));
  await expect(f.service.reviewArchive(f.scope, preparationId)).rejects.toThrow(
    'CORE_ARCHIVE_PUBLICATION_RECOVERY_REQUIRED',
  );
  await expect(
    f.service.prepare(f.scope, { ...f.context, intentId: 'cannot-free-prefix' }, f.input),
  ).rejects.toThrow('CORE_PREPARATION_CAPACITY_EXCEEDED');
  expect(await readFile(pagePath)).toEqual(originalBytes);
});

it('never rebinds an admitted context to different core inputs', async () => {
  const f = await fixture();
  await f.service.prepare(f.scope, f.context, f.input);
  await expect(f.service.prepare(f.scope, f.context, { ...f.input, assets: [] })).rejects.toThrow(
    'CONTEXT_CHANGED',
  );
});

it.each(['core-inputs', 'core-publications', 'core-preparations', 'core-pages'])(
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
