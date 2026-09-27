import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import {
  createToolInvocationOptions,
  type ActorContext,
  type OperationEvidenceReceiptAppendV1,
  type OperationEvidenceReceiptV1,
  type WorkspaceRoot,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeEvidenceArtifactPort } from '../../src/execution/native-evidence-artifact-port.js';
import { nativeEvidenceContextHash } from '../../src/execution/operation-evidence-projector.js';
import {
  OperationEvidenceReceiptStore,
  type CleanupDrainReport,
} from '../../src/execution/operation-evidence-receipt-store.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import {
  withOperationRetentionScope,
  type OperationRetentionScope,
} from '../../src/execution/retention-scope.js';
import {
  cleanupRetainedEvidence,
  runRetentionSweep,
  scheduleRetentionSweeps,
  type RetentionSweepDependencies,
} from '../../src/execution/retention-sweep.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';
import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import {
  RecipeEvidenceHolds,
  recipeResultSchemaHash,
} from '../../src/portal/recipes/evidence-hold.js';
import { fixturePermissions, portalFixture } from '../portal/fixtures.js';

/*
 * T09 (LC-1): retention sweep isolation. The sweep runs after leader initialization, in batches
 * that each take the recipe-hold retention lock on their own, and every cleanup intent is isolated:
 *
 *   unregistered workspace              -> done
 *   registered, available, file missing -> done
 *   workspace unavailable (T08)         -> deferred
 *   repeated failure                    -> terminal, versioned quarantine row
 *
 * `snapshot` and `grounding-graph` evidence is only detached. The LC-1 regression tests with real
 * snapshot receipts are in operation-evidence-receipt.characterization.test.ts, and the full leader
 * start is test/e2e/retention-startup.test.ts.
 */
const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const done of cleanups.splice(0)) await done();
  for (const root of roots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp))
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
});
const actor: ActorContext = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
};
const DAY_MS = 86_400_000;
const completedAt = 1_724_803_200_000;
const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

const baseReceipt = (
  operationId: string,
  workspaceId: string | null,
): OperationEvidenceReceiptAppendV1 => ({
  schemaVersion: 1,
  state: 'prepared',
  actorId: actor.actorId,
  operationId,
  operationKind: 'tool',
  operationName: 'get_selection',
  argsHash: `sha256:${'a'.repeat(64)}`,
  workspaceId,
  fileExecutionKeyHash: null,
  targetBindingHash: null,
  captureIntentHash: `sha256:${'b'.repeat(64)}`,
  captureResult: false,
  finalizerHash: `sha256:${'c'.repeat(64)}`,
  daemonGenerationHash: `sha256:${'d'.repeat(64)}`,
  completedAt: new Date(completedAt).toISOString(),
  terminalStatus: 'succeeded',
  resultHash: `sha256:${'e'.repeat(64)}`,
  resultBytes: 2,
  resultArtifact: null,
  nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
});
/** A receipt whose captured result artifact lives at the fixed operation path. */
const resultReceipt = (
  operationId: string,
  workspaceId: string,
  artifactDigest64 = 'f'.repeat(64),
): OperationEvidenceReceiptAppendV1 => ({
  ...baseReceipt(operationId, workspaceId),
  captureResult: true,
  resultArtifact: {
    artifactRelativePath: createToolInvocationOptions(true, operationId, workspaceId).captureIntent
      .relativePath as string,
    artifactDigest64,
    resultSchemaHash: `sha256:${'9'.repeat(64)}`,
  },
});
const snapshotEvidence = (workspaceId: string) =>
  ({
    kind: 'snapshot',
    workspaceId,
    fileIdentityHash: `sha256:${'2'.repeat(64)}`,
    snapshotId: `sfp_snap1_${'A'.repeat(22)}`,
    refRelativePath: `.sfp/snapshots/v1/${'2'.repeat(64)}/sfp_snap1_${'A'.repeat(22)}.json`,
    checksum: `sha256:${'3'.repeat(64)}`,
    fidelity: 'complete-leaf',
    artifactRelativePath: `.sfp/snapshots/v1/${'2'.repeat(64)}/sfp_snap1_${'A'.repeat(22)}.json`,
    artifactDigest64: '3'.repeat(64),
  }) as const;
const graphEvidence = {
  kind: 'grounding-graph',
  locator: '{"workspaceId":"x"}',
  artifactRelativePath: `.sfp/grounding-graphs/v1/${'2'.repeat(64)}/sfp_snap1_${'A'.repeat(22)}.json`,
  artifactDigest64: '4'.repeat(64),
  checksum: `sha256:${'4'.repeat(64)}`,
  fidelity: 'partial',
} as const;

/** Writes receipts through the real store and returns them as the drain will see them. */
const prepared = async (
  store: OperationEvidenceReceiptStore,
  inputs: readonly OperationEvidenceReceiptAppendV1[],
): Promise<Readonly<OperationEvidenceReceiptV1>[]> => {
  const receipts: Readonly<OperationEvidenceReceiptV1>[] = [];
  for (const input of inputs) {
    const reservation = await store.reserveBeforeRuntime(actor.actorId, input.operationId, 1, {
      workspaceId: input.workspaceId,
    });
    receipts.push(await store.prepareAndFsync(reservation.reservationId, input));
  }
  return receipts;
};
/** The sweep's compaction 31 days later: every listed receipt becomes a cleanup intent. */
const expire = async (store: OperationEvidenceReceiptStore, operationIds: readonly string[]) =>
  store.compact({
    now: completedAt + 31 * DAY_MS,
    linkedAt: operationId => (operationIds.includes(operationId) ? completedAt : null),
  });
const cleanupRows = async (store: OperationEvidenceReceiptStore) =>
  (await readFile(store.cleanupIntentPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);

const available = (workspaceId: string): Readonly<WorkspaceRoot> =>
  Object.freeze({
    workspaceId,
    path: `/workspaces/${workspaceId}`,
    realPath: `/workspaces/${workspaceId}`,
    rootIdentityKey: '1:1:1',
    addedAt: '2026-08-31T00:00:00.000Z',
    availability: 'available',
  });
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_C = '33333333-3333-4333-8333-333333333333';

/** Sweep dependencies whose phases only record that they ran, under a live retention scope. */
const recordingSweep = (
  calls: string[],
  lines: string[],
  overrides: Partial<RetentionSweepDependencies> = {},
): RetentionSweepDependencies => ({
  now: () => completedAt,
  log: line => lines.push(line),
  withRetentionBatch: work => withOperationRetentionScope(new Set(), work),
  compactEvidence: async () => {
    calls.push('compact');
  },
  drainCleanupIntents: async () => {
    calls.push('drain');
    return { results: [], next: null };
  },
  listWorkspaces: async () => [available(WORKSPACE_A)],
  scanWorkspace: async workspace => {
    calls.push(`scan ${workspace.workspaceId}`);
  },
  purgeExpiredTombstones: async () => {
    calls.push('purge');
  },
  ...overrides,
});
const coded = (code: string, cause?: unknown) =>
  Object.assign(new Error(code, cause === undefined ? undefined : { cause }), { code });

describe('retention cleanup outcomes (T09)', () => {
  it('gives done for an unregistered workspace, deferred for an unavailable one, and a terminal versioned quarantine row for repeated failure, after which the cleanup log still truncates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-t09-outcomes-'));
    roots.push(root);
    const stateRoot = join(root, 'state');
    await mkdir(stateRoot);
    await mkdir(join(root, 'available'));
    await mkdir(join(root, 'unavailable'));
    const workspaceStore = createWorkspaceConfigStore(
      stateRoot,
      idleGuard,
      fixturePermissions(stateRoot),
    );
    const availableRow = await workspaceStore.add(actor.actorId, join(root, 'available'));
    const unavailableRow = await workspaceStore.add(actor.actorId, join(root, 'unavailable'));
    // T08 semantics: a deleted registered root is listed as unavailable, not dropped.
    await rm(join(root, 'unavailable'), { recursive: true, force: true });
    const unregisteredId = '99999999-9999-4999-8999-999999999999';
    const ids = {
      failing: 'op-a-available-failing',
      unavailable: 'op-b-unavailable',
      unregistered: 'op-c-unregistered',
    };
    let store = new OperationEvidenceReceiptStore({ stateRoot, actorId: actor.actorId });
    await store.recover();
    await prepared(store, [
      resultReceipt(ids.failing, availableRow.workspaceId),
      resultReceipt(ids.unavailable, unavailableRow.workspaceId),
      resultReceipt(ids.unregistered, unregisteredId),
    ]);
    await expire(store, Object.values(ids));

    const removals: string[] = [];
    const drain = async (): Promise<CleanupDrainReport> => {
      const workspaces = await workspaceStore.list();
      return store.drainPendingArtifactCleanup(receipt =>
        cleanupRetainedEvidence(receipt, {
          isHeld: () => false,
          workspaces,
          artifacts: {
            removeLinked: async input => {
              removals.push(input.operationId);
              // The artifact was tampered with: its digest no longer matches the receipt.
              throw coded('EVIDENCE_ARTIFACT_IDENTITY_MISMATCH');
            },
          },
          nativeArtifacts: {
            removeLinkedManifest: async () => {
              throw new Error('no native manifest is linked');
            },
          },
        }),
      );
    };
    const restart = async () => {
      store = new OperationEvidenceReceiptStore({ stateRoot, actorId: actor.actorId });
      await store.recover();
    };

    expect((await drain()).results).toEqual([
      {
        operationId: ids.failing,
        workspaceId: availableRow.workspaceId,
        outcome: 'failed',
        errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        attempts: 1,
      },
      {
        operationId: ids.unavailable,
        workspaceId: unavailableRow.workspaceId,
        outcome: 'deferred',
        reasonCode: 'WORKSPACE_ROOT_MISSING',
      },
      { operationId: ids.unregistered, workspaceId: unregisteredId, outcome: 'done' },
    ]);
    // Failure counts are durable: each leader start adds one attempt, not a fresh count.
    await restart();
    expect((await drain()).results.map(row => [row.operationId, row.outcome])).toEqual([
      [ids.failing, 'failed'],
      [ids.unavailable, 'deferred'],
    ]);
    await restart();
    expect((await drain()).results).toEqual([
      {
        operationId: ids.failing,
        workspaceId: availableRow.workspaceId,
        outcome: 'quarantined',
        errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        attempts: 3,
      },
      {
        operationId: ids.unavailable,
        workspaceId: unavailableRow.workspaceId,
        outcome: 'deferred',
        reasonCode: 'WORKSPACE_ROOT_MISSING',
      },
    ]);
    expect(removals).toEqual([ids.failing, ids.failing, ids.failing]);
    // The quarantine row is a versioned, terminal row in the hash-chained cleanup log.
    const rows = await cleanupRows(store);
    expect(rows.filter(row => row.operationId === ids.failing).map(row => row.kind)).toEqual([
      'add',
      'failed',
      'failed',
      'quarantine',
    ]);
    expect(rows.at(-1)).toMatchObject({
      schemaVersion: 2,
      kind: 'quarantine',
      operationId: ids.failing,
      receipt: null,
      attempts: 3,
      errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
    });
    // Terminal: a quarantined intent is never retried, including after a restart.
    await restart();
    expect((await drain()).results.map(row => row.operationId)).toEqual([ids.unavailable]);
    expect(removals).toHaveLength(3);
    // Only the deferred intent keeps the log alive; the quarantined one does not.
    expect((await stat(store.cleanupIntentPath)).size).toBeGreaterThan(0);

    // The owner removes the unavailable registration (T08): its intent is now unregistered, it
    // ends done, nothing is pending any more, and the log is truncated despite the quarantine row.
    await workspaceStore.remove(actor.actorId, unavailableRow.workspaceId);
    expect((await drain()).results).toEqual([
      { operationId: ids.unavailable, workspaceId: unavailableRow.workspaceId, outcome: 'done' },
    ]);
    expect((await stat(store.cleanupIntentPath)).size).toBe(0);
    await restart();
    expect((await drain()).results).toEqual([]);
    // The quarantined evidence stays for the orphan scan and the owner; the drain never retried it.
    expect(removals).toHaveLength(3);
  });

  it('gives done for a registered, available workspace whose .sfp folder, and so the target file, is missing', async () => {
    const fixture = await portalFixture();
    cleanups.push(fixture.cleanup);
    const artifacts = new OperationEvidenceArtifactStore({
      workspacePolicy: fixture.policy,
      atomicFiles: new AtomicFileStore(),
    });
    const nativeArtifacts = new NativeEvidenceArtifactPort({
      workspacePolicy: fixture.policy,
      atomicFiles: new AtomicFileStore(),
    });
    const operationId = 'op-result-target-missing';
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const artifact = await artifacts.createNew({
      workspaceId: fixture.workspaceId,
      operationId,
      intent: createToolInvocationOptions(true, operationId, fixture.workspaceId).captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'9'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    const store = new OperationEvidenceReceiptStore({
      stateRoot: fixture.stateRoot,
      actorId: actor.actorId,
    });
    await store.recover();
    const [withResult, withExport] = await prepared(store, [
      {
        ...resultReceipt(operationId, fixture.workspaceId, artifact.artifactDigest64),
        resultArtifact: artifact,
      },
      {
        ...baseReceipt('op-export-target-missing', fixture.workspaceId),
        nativeEvidence: {
          kind: 'export',
          manifestRelativePath: `.sfp/operation-evidence/${nativeEvidenceContextHash({
            operationId: 'op-export-target-missing',
            workspaceId: fixture.workspaceId,
          }).slice('sha256:'.length)}/native-manifest.v1.json`,
          manifestDigest64: '5'.repeat(64),
          artifactCount: 1,
          totalArtifactBytes: 1,
        },
      },
    ]);
    await expect(
      stat(join(fixture.workspaceRoot, artifact.artifactRelativePath)),
    ).resolves.toBeDefined();
    await rm(join(fixture.workspaceRoot, '.sfp'), { recursive: true, force: true });

    const workspaces = await fixture.workspaces.list();
    expect(workspaces).toMatchObject([{ availability: 'available' }]);
    for (const receipt of [withResult!, withExport!]) {
      await expect(
        cleanupRetainedEvidence(receipt, {
          isHeld: () => false,
          workspaces,
          artifacts,
          nativeArtifacts,
        }),
      ).resolves.toEqual({ outcome: 'done' });
    }
    // removeLinked itself now treats the verifiably absent operation directory as removed.
    await expect(
      artifacts.removeLinked({ workspaceId: fixture.workspaceId, operationId, artifact }),
    ).resolves.toBeUndefined();
  }, 60_000);

  it('only detaches snapshot and grounding-graph evidence, keeps export and no-artifact semantics, defers held intents and classifies removal races', async () => {
    const calls: string[] = [];
    const artifacts = {
      removeLinked: vi.fn<(input: { operationId: string }) => Promise<void>>(async input => {
        calls.push(`result ${input.operationId}`);
      }),
    };
    const nativeArtifacts = {
      removeLinkedManifest: vi.fn<
        (input: { context: { operationId: string; contextHash: string } }) => Promise<void>
      >(async input => {
        calls.push(`manifest ${input.context.operationId} ${input.context.contextHash}`);
      }),
    };
    const unavailable: Readonly<WorkspaceRoot> = {
      ...available(WORKSPACE_B),
      availability: 'unavailable',
      unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED',
    };
    const legacy: Readonly<WorkspaceRoot> = {
      workspaceId: WORKSPACE_C,
      path: '/legacy',
      realPath: '/legacy',
      addedAt: '2026-08-31T00:00:00.000Z',
      availability: 'legacy-unbound',
    };
    const context = {
      isHeld: (operationId: string) => operationId === 'held',
      workspaces: [available(WORKSPACE_A), unavailable, legacy],
      artifacts,
      nativeArtifacts,
    };
    // Hand-built receipts: this test covers the decision table, not the store's schema.
    const receipt = (value: object) =>
      ({ ...baseReceipt('op', WORKSPACE_A), ...value }) as unknown as OperationEvidenceReceiptV1;

    // Snapshot and grounding-graph evidence is detached without any filesystem effect, even when
    // its workspace is unavailable or no longer registered.
    for (const workspaceId of [WORKSPACE_A, WORKSPACE_B, '99999999-9999-4999-8999-999999999999'])
      for (const nativeEvidence of [snapshotEvidence(workspaceId), graphEvidence])
        await expect(
          cleanupRetainedEvidence(receipt({ workspaceId, nativeEvidence }), context),
        ).resolves.toEqual({ outcome: 'done' });
    expect(calls).toEqual([]);

    // Held evidence is deferred and never touched.
    await expect(
      cleanupRetainedEvidence(
        receipt({ ...resultReceipt('held', WORKSPACE_A), operationId: 'held' }),
        context,
      ),
    ).resolves.toEqual({ outcome: 'deferred', reasonCode: 'RECIPE_HOLD_RETENTION_CONFLICT' });
    // No workspace binding: no-artifact is done, anything else is still an identity mismatch.
    await expect(cleanupRetainedEvidence(receipt({ workspaceId: null }), context)).resolves.toEqual(
      {
        outcome: 'done',
      },
    );
    await expect(
      cleanupRetainedEvidence(
        receipt({ workspaceId: null, nativeEvidence: graphEvidence }),
        context,
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    // Export and result artifacts are still removed through their stores, with the fixed context.
    const exportEvidence = {
      kind: 'export',
      manifestRelativePath: '.sfp/operation-evidence/x/native-manifest.v1.json',
      manifestDigest64: '5'.repeat(64),
      artifactCount: 1,
      totalArtifactBytes: 1,
    } as const;
    await expect(
      cleanupRetainedEvidence(
        receipt({ ...resultReceipt('op-both', WORKSPACE_A), nativeEvidence: exportEvidence }),
        context,
      ),
    ).resolves.toEqual({ outcome: 'done' });
    expect(calls).toEqual([
      'result op-both',
      `manifest op-both ${nativeEvidenceContextHash({ operationId: 'op-both', workspaceId: WORKSPACE_A })}`,
    ]);
    expect(nativeArtifacts.removeLinkedManifest.mock.calls[0]?.[0]).toMatchObject({
      evidence: exportEvidence,
    });
    // Unavailable and legacy-unbound workspaces defer filesystem cleanup with the T08 cause.
    await expect(
      cleanupRetainedEvidence(receipt(resultReceipt('op-b', WORKSPACE_B)), context),
    ).resolves.toEqual({ outcome: 'deferred', reasonCode: 'WORKSPACE_ROOT_IDENTITY_CHANGED' });
    await expect(
      cleanupRetainedEvidence(
        receipt({ ...baseReceipt('op-c', WORKSPACE_C), nativeEvidence: exportEvidence }),
        context,
      ),
    ).resolves.toEqual({ outcome: 'deferred', reasonCode: 'WORKSPACE_ROOT_UNBOUND' });
    expect(calls).toHaveLength(2);

    // Races after the registry snapshot are classified by the policy error.
    const racing = (error: Error) => ({
      ...context,
      artifacts: {
        removeLinked: async () => {
          throw error;
        },
      },
    });
    const result = receipt(resultReceipt('op-race', WORKSPACE_A));
    await expect(
      cleanupRetainedEvidence(
        result,
        racing(coded('WORKSPACE_ROOT_UNAVAILABLE', coded('WORKSPACE_ROOT_MISSING'))),
      ),
    ).resolves.toEqual({ outcome: 'deferred', reasonCode: 'WORKSPACE_ROOT_MISSING' });
    await expect(
      cleanupRetainedEvidence(result, racing(coded('WORKSPACE_NOT_CONFIGURED'))),
    ).resolves.toEqual({ outcome: 'done' });
    // A missing operation directory is already `done` inside the stores. A path that vanishes
    // later in a removal is a race with a concurrent deleter: it fails and the next sweep retries.
    await expect(
      cleanupRetainedEvidence(result, racing(coded('WORKSPACE_PATH_NOT_FOUND'))),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_NOT_FOUND' });
    await expect(
      cleanupRetainedEvidence(result, racing(coded('EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED'))),
    ).rejects.toMatchObject({ code: 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED' });
  });
});

describe('retention sweep batches (T09)', () => {
  it('keeps scanning the other workspaces when one workspace orphan scan throws', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const summary = await runRetentionSweep(
      recordingSweep(calls, lines, {
        listWorkspaces: async () => [
          available(WORKSPACE_A),
          { ...available(WORKSPACE_B), availability: 'unavailable' },
          available(WORKSPACE_C),
        ],
        scanWorkspace: async workspace => {
          calls.push(`scan ${workspace.workspaceId}`);
          if (workspace.workspaceId === WORKSPACE_A)
            // For example, the workspace disappeared between listing and its orphan scan.
            throw coded('WORKSPACE_ROOT_UNAVAILABLE');
        },
      }),
    );
    expect(calls).toEqual([
      'compact',
      'drain',
      `scan ${WORKSPACE_A}`,
      `scan ${WORKSPACE_C}`,
      'purge',
    ]);
    expect(summary.workspaces).toEqual({
      scanned: [WORKSPACE_C],
      skipped: [WORKSPACE_B],
      failed: [WORKSPACE_A],
    });
    expect(summary.failedPhases).toEqual([]);
    expect(lines).toContain(
      `[retention] workspace ${WORKSPACE_A} evidence scan failed (WORKSPACE_ROOT_UNAVAILABLE); the other workspaces are still scanned`,
    );
    expect(lines.some(line => line.includes(`workspace ${WORKSPACE_B} is unavailable`))).toBe(true);
  });

  it('takes the recipe-hold lock per batch, so a real hold operation proceeds between batches and the next batch honors it', async () => {
    const fixture = await portalFixture();
    cleanups.push(fixture.cleanup);
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 7));
    const holds = new RecipeEvidenceHolds({
      stateRoot: fixture.stateRoot,
      store: fixture.store,
      permissions: fixture.permissions,
      issuer,
      operations: { get: () => undefined },
      workspacePolicy: fixture.policy,
      readEvidence: async () => {
        throw new Error('unexpected evidence read');
      },
      hasRetainedEvidence: async () => false,
    });
    const operationId = issuer.issue(actor.actorId);
    const binding = {
      version: 1,
      planHash: `sha256:${'a'.repeat(64)}`,
      stepId: 'create',
      operationId,
      actorId: actor.actorId,
      authSessionId: actor.authSessionId,
      workspaceId: fixture.workspaceId,
      operationKind: 'tool',
      operationName: 'create_frame',
      targetBindingHash: null,
      argsHash: `sha256:${'b'.repeat(64)}`,
      resultSchemaHash: recipeResultSchemaHash('create_frame'),
      maxResultBytes: 1_024,
    } as const;
    const holdScope = {
      actor,
      workspace: {
        workspaceId: fixture.workspaceId,
        workspaceRoot: await realpath(fixture.workspaceRoot),
      },
    };
    const events: string[] = [];
    let batches = 0;
    const held = (scope: OperationRetentionScope) => `held=${scope.isHeld(operationId)}`;
    const summary = await runRetentionSweep({
      now: () => Date.now(),
      log: () => undefined,
      withRetentionBatch: async work => {
        batches += 1;
        if (batches === 4) {
          // Between the orphan scans of workspaces A and B: if the sweep still held the lock, this
          // hold operation could not acquire it and the sweep would never finish.
          const result = await holds.ensureHeld(holdScope, binding);
          events.push(`hold ${result.state}`);
        }
        return holds.withRetentionSweep(work);
      },
      compactEvidence: async (_now, scope) => {
        events.push(`compact ${held(scope)}`);
      },
      drainCleanupIntents: async scope => {
        events.push(`drain ${held(scope)}`);
        return { results: [], next: null };
      },
      listWorkspaces: async () => [available(WORKSPACE_A), available(WORKSPACE_B)],
      scanWorkspace: async (workspace, scope) => {
        events.push(`scan ${workspace.workspaceId} ${held(scope)}`);
      },
      purgeExpiredTombstones: async (_now, scope) => {
        events.push(`purge ${held(scope)}`);
      },
    });
    expect(batches).toBe(5);
    expect(events).toEqual([
      'compact held=false',
      'drain held=false',
      `scan ${WORKSPACE_A} held=false`,
      'hold held',
      `scan ${WORKSPACE_B} held=true`,
      'purge held=true',
    ]);
    expect(summary).toMatchObject({ aborted: false, failedPhases: [] });
  }, 60_000);

  it('drains cleanup intents in bounded batches that each take the lock, following the cursor', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const pending = Array.from(
      { length: 70 },
      (_, index) => `op-${String(index).padStart(3, '0')}`,
    );
    const batches: Array<{ after: string | null; limit: number }> = [];
    let acquisitions = 0;
    const summary = await runRetentionSweep(
      recordingSweep(calls, lines, {
        withRetentionBatch: work => {
          acquisitions += 1;
          return withOperationRetentionScope(new Set(), work);
        },
        drainCleanupIntents: async (_scope, batch) => {
          batches.push(batch);
          const start = batch.after === null ? 0 : pending.indexOf(batch.after) + 1;
          const visited = pending.slice(start, start + batch.limit);
          return {
            results: visited.map(operationId => ({
              operationId,
              workspaceId: null,
              outcome: 'done' as const,
            })),
            next: start + visited.length < pending.length ? (visited.at(-1) ?? null) : null,
          };
        },
      }),
    );
    expect(batches).toEqual([
      { after: null, limit: 32 },
      { after: 'op-031', limit: 32 },
      { after: 'op-063', limit: 32 },
    ]);
    // compaction, three drain batches, one workspace scan and the tombstone purge
    expect(acquisitions).toBe(6);
    expect(summary.cleanup).toEqual({ done: 70, deferred: 0, failed: 0, quarantined: 0 });
  });

  it('isolates phase failures, logs them, and purges tombstones only after a successful compaction', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const summary = await runRetentionSweep(
      recordingSweep(calls, lines, {
        compactEvidence: async () => {
          calls.push('compact');
          throw coded('EVIDENCE_CAPACITY_EXCEEDED');
        },
        drainCleanupIntents: async () => {
          calls.push('drain');
          throw coded('EVIDENCE_RECEIPT_CORRUPT');
        },
      }),
    );
    // The receipts whose tombstones would be purged are still uncompacted, so the purge waits.
    expect(calls).toEqual(['compact', 'drain', `scan ${WORKSPACE_A}`]);
    expect(summary.failedPhases).toEqual(['compaction', 'cleanup-intents', 'tombstone-purge']);
    expect(lines).toEqual([
      '[retention] evidence compaction failed (EVIDENCE_CAPACITY_EXCEEDED); the sweep continues',
      '[retention] cleanup intent drain failed (EVIDENCE_RECEIPT_CORRUPT); the sweep continues',
      '[retention] tombstone purge skipped because evidence compaction failed',
      '[retention] sweep finished: cleanup done=0 deferred=0 failed=0 quarantined=0; workspaces scanned=1 skipped=0 failed=0; failed phases compaction, cleanup-intents, tombstone-purge',
    ]);

    const recovered: string[] = [];
    await runRetentionSweep(
      recordingSweep(recovered, [], {
        purgeExpiredTombstones: async () => {
          recovered.push('purge');
          throw coded('JOURNAL_CAPACITY_EXCEEDED');
        },
      }),
    );
    expect(recovered).toEqual(['compact', 'drain', `scan ${WORKSPACE_A}`, 'purge']);
  });

  it('logs deferred, failed and quarantined intents per sweep and summarizes them', async () => {
    const lines: string[] = [];
    const summary = await runRetentionSweep(
      recordingSweep([], lines, {
        drainCleanupIntents: async () => ({
          results: [
            { operationId: 'op-1', workspaceId: WORKSPACE_A, outcome: 'done' },
            {
              operationId: 'op-2',
              workspaceId: WORKSPACE_B,
              outcome: 'deferred',
              reasonCode: 'WORKSPACE_ROOT_MISSING',
            },
            {
              operationId: 'op-3',
              workspaceId: WORKSPACE_B,
              outcome: 'deferred',
              reasonCode: 'WORKSPACE_ROOT_MISSING',
            },
            {
              operationId: 'op-4',
              workspaceId: WORKSPACE_A,
              outcome: 'failed',
              errorCode: 'EPERM',
              attempts: 1,
            },
            {
              operationId: 'op-5',
              workspaceId: WORKSPACE_A,
              outcome: 'quarantined',
              errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
              attempts: 3,
            },
          ],
          next: null,
        }),
      }),
    );
    expect(summary.cleanup).toEqual({ done: 1, deferred: 2, failed: 1, quarantined: 1 });
    expect(lines).toEqual([
      '[retention] cleanup intent op-4 for workspace 11111111-1111-4111-8111-111111111111 failed (EPERM; attempt 1 of 3); it is retried by the next sweep',
      '[retention] cleanup intent op-5 for workspace 11111111-1111-4111-8111-111111111111 is quarantined after 3 failed attempts (EVIDENCE_ARTIFACT_IDENTITY_MISMATCH); its evidence is left in place for manual cleanup',
      '[retention] 2 cleanup intents for workspace 22222222-2222-4222-8222-222222222222 are deferred (WORKSPACE_ROOT_MISSING) until it is available again, rebound or removed',
      '[retention] sweep finished: cleanup done=1 deferred=2 failed=1 quarantined=1; workspaces scanned=1 skipped=0 failed=0',
    ]);
  });

  it('stops between batches once the leader runtime closes', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const summary = await runRetentionSweep(
      recordingSweep(calls, [], {
        signal: controller.signal,
        drainCleanupIntents: async () => {
          calls.push('drain');
          controller.abort();
          return { results: [], next: null };
        },
      }),
    );
    expect(calls).toEqual(['compact', 'drain']);
    expect(summary.aborted).toBe(true);
  });

  it('schedules the startup sweep after initialization returns, logs its failure and stops cleanly', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let sweeps = 0;
    const failures = [
      coded('EVIDENCE_RECEIPT_CORRUPT'),
      coded('LEADER_GENERATION_CLOSED'),
      new TypeError('unexpected'),
    ];
    const schedule = scheduleRetentionSweeps(
      {
        sweep: async () => {
          sweeps += 1;
          throw failures[sweeps - 1];
        },
      },
      line => lines.push(line),
      1_000,
    );
    // Scheduling never waits for a sweep: initialization returns first.
    expect(sweeps).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sweeps).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweeps).toBe(3);
    // A closed generation is expected during demotion and is not reported as a failure.
    expect(lines).toEqual([
      '[retention] startup sweep failed (EVIDENCE_RECEIPT_CORRUPT)',
      '[retention] scheduled sweep failed (TypeError)',
    ]);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweeps).toBe(3);
  });
});
