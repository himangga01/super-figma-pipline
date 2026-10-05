import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  ALL_DATA_CLASSES,
  type ActorContext,
  type WorkspacePolicy,
  type WorkspaceRoot,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createOperationEvidenceEndpoint } from '../../src/control/operation-evidence-endpoint.js';
import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { NativeEvidenceArtifactPort } from '../../src/execution/native-evidence-artifact-port.js';
import { createOperationEvidenceProjector } from '../../src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { cleanupRetainedEvidence, runRetentionSweep } from '../../src/execution/retention-sweep.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';
import { createApprovalBroker } from '../../src/policy/approval-broker.js';
import { RecipeEvidenceHolds } from '../../src/portal/recipes/evidence-hold.js';
import { PortalStore } from '../../src/portal/store.js';
import { createSnapshotOperations } from '../../src/snapshot/operations.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import { fixturePermissions } from '../portal/fixtures.js';

/*
 * LC-1 regression tests (remediation plan section 3.1), flipped by task T09 from the T06a
 * characterization in this file. The file name is kept so that the T06a evidence still resolves.
 *
 * Before T09, the leader's startup retention sweep drained durable cleanup intents through a
 * closure in index.ts (removeRetainedArtifacts) that threw NATIVE_ARTIFACT_IDENTITY_MISMATCH for
 * every native evidence kind other than `export` and `no-artifact`. snapshot.capture and
 * grounding.refresh record `snapshot` and `grounding-graph` evidence, the drain had no per-intent
 * isolation, and leader initialization awaited the sweep, so every start failed 30 days after the
 * first capture.
 *
 * After T09 the production cleanup is cleanupRetainedEvidence (execution/retention-sweep.ts). It
 * only detaches `snapshot` and `grounding-graph` evidence; deleting those workspace files stays a
 * user decision. The drain isolates every intent, and the leader schedules the sweep after its
 * initialization. The tests import that function instead of mirroring a closure, and a source test
 * pins index.ts to it. The process-level acceptance test is test/e2e/retention-startup.test.ts.
 *
 * Seam: the receipts come from the real snapshot services, using the canonical execution-plane
 * harness of snapshot/service-operations.test.ts, and drain through the real receipt store.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp))
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
});
const workspaceId = '11111111-1111-4111-8111-111111111111';
const actor: ActorContext = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
};
const target = {
  sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
  pluginGeneration: 'plugin-generation',
  fileIdentity: { kind: 'figma-file-key' as const, value: 'fixture-file' },
  fileExecutionKey: 'figma:fixture-file' as const,
  editorType: 'figma' as const,
  capabilities: [],
};

/** The `setup` harness of snapshot/service-operations.test.ts, returning its state root. */
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-lc1-workspace-'));
  roots.push(root);
  const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-lc1-state-'));
  roots.push(stateRoot);
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '1' } }));
  await writeFile(join(root, 'Button.tsx'), 'export const Button = () => <button>OK</button>;\n');
  const pathFor = (id: string, path: string) => {
    if (id !== workspaceId) throw new Error('WORKSPACE_NOT_CONFIGURED');
    const result = resolve(root, path),
      suffix = relative(root, result);
    if (suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('PATH_OUTSIDE_WORKSPACE');
    return result;
  };
  const policy: WorkspacePolicy = {
    resolveRoot: async id => pathFor(id, '.'),
    resolveRead: async (id, path) => {
      const result = pathFor(id, path);
      await stat(result).catch(error => {
        if (error.code === 'ENOENT')
          throw Object.assign(new Error('workspace path missing'), {
            code: 'WORKSPACE_PATH_NOT_FOUND',
          });
        throw error;
      });
      return result;
    },
    resolveWrite: async (id, path) => {
      const result = pathFor(id, path);
      const exists = await stat(result)
        .then(() => true)
        .catch(error => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
      return { path: result, overwrites: exists };
    },
    assertWithinRoot: async (id, path) => {
      pathFor(id, path);
    },
  };
  const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 17));
  const journal = new OperationJournal({ stateRoot, actorId: actor.actorId });
  const egress = new EgressManifestStore({ stateRoot, actorId: actor.actorId });
  const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId: actor.actorId });
  await Promise.all([journal.recover(), egress.recover(Date.now()), receipts.recover()]);
  const operations = createSnapshotOperations({
    workspacePolicy: policy,
    productVersion: '0.1.0',
    fileName: () => 'Fixture',
    getOperation: id => journal.get(id),
    plugin: {
      execute: async (_scope, name, _args, signal) => {
        signal.throwIfAborted();
        expect(name).toBe('get_design_context');
        return {
          nodes: [
            {
              id: '1:1',
              name: 'Button',
              type: 'INSTANCE',
              width: 100,
              height: 32,
              mainComponent: { id: '2:1', name: 'Button', key: 'button-key' },
            },
          ],
        };
      },
    },
  });
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    runtimes: {},
    operations,
    durability: {
      egress,
      receipts,
      artifacts: {
        createNew: async () => {
          throw new Error('unexpected result capture');
        },
      },
      projector: createOperationEvidenceProjector(),
      nativeArtifacts: new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      }),
    },
  });
  const plane = new LeaderGenerationExecutionPlane('generation', {
    closeAdmission: () => {},
    installGenerationFence: () => {},
    abortPending: async () => {},
    abortQueued: async () => {},
    markDispatchedOutcomeUnknown: async () => {},
    finalizeAndFlushEgress: async () => {},
    drainTransport: async () => true,
    forceCloseTransport: () => {},
    destroy: () => {},
    releasePort: () => {},
  });
  const broker = createApprovalBroker({
    deliverPluginPrompt: async () => {
      throw new Error('wrong approval channel');
    },
    deliverControlPrompt: async prompt => {
      await broker.settleControl(
        actor,
        {
          version: 1,
          type: 'approval.decision',
          approvalId: prompt.approvalId,
          operationId: prompt.operationId,
          promptHash: prompt.promptHash,
          decision: 'approved',
        },
        'generation',
      );
    },
  });
  plane.bindInvocationService(new ToolInvocationService(executor));
  plane.bindAdmissionAuthority({
    operations,
    workspacePolicy: policy,
    resolveWorkspaceContext: async id => ({
      workspaceId: id,
      workspaceRoot: id === null ? null : pathFor(id, '.'),
    }),
    targetResolver: {
      resolve: selector =>
        selector.kind === 'none'
          ? {
              sessionId: null,
              pluginGeneration: null,
              fileIdentity: null,
              fileExecutionKey: null,
              editorType: null,
              capabilities: null,
            }
          : target,
    },
    approval: broker,
    authorizeEgress: async () => ({
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ALL_DATA_CLASSES,
    }),
    issueOperationId: id => issuer.issue(id),
    verifyOperationId: (id, operationId) => {
      issuer.verify(id, operationId);
    },
  });
  // The harness workspace as the workspace store lists an available registration.
  const registration: Readonly<WorkspaceRoot> = Object.freeze({
    workspaceId,
    path: root,
    realPath: root,
    rootIdentityKey: '1:1:1',
    addedAt: '2026-08-31T00:00:00.000Z',
    availability: 'available',
  });
  return {
    root,
    stateRoot,
    plane,
    receipts,
    journal,
    egress,
    policy,
    issuer,
    broker,
    registration,
  };
};
type Harness = Awaited<ReturnType<typeof setup>>;

const capture = async (state: Harness, requestId: string) => {
  const operationId = state.issuer.issue(actor.actorId);
  const captured = (await state.plane.invokeService(actor, {
    version: 1,
    requestId,
    serviceOperationName: 'snapshot.capture',
    rawArgs: { nodeIds: ['1:1'] },
    workspaceId,
    targetSelector: { kind: 'session', sessionId: target.sessionId },
    operationId,
  })) as {
    snapshot: {
      relativePath: string;
      workspaceId: string;
      snapshotId: string;
      fileIdentityHash: string;
    };
    graph: { relativePath: string; checksum: string };
  };
  return { operationId, captured };
};

/** Filesystem cleanup ports that must not be reached: snapshot evidence is only detached. */
const unreachable = {
  artifacts: {
    removeLinked: async () => {
      throw new Error('snapshot cleanup must not remove a result artifact');
    },
  },
  nativeArtifacts: {
    removeLinkedManifest: async () => {
      throw new Error('snapshot cleanup must not remove a native manifest');
    },
  },
};

/** The no-artifact receipt fixture of operation-evidence-receipt.test.ts. */
const noArtifactReceipt = (operationId: string, completedAt: string) => ({
  schemaVersion: 1 as const,
  state: 'prepared' as const,
  actorId: actor.actorId,
  operationId,
  operationKind: 'tool' as const,
  operationName: 'get_selection' as const,
  argsHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
  workspaceId: null,
  fileExecutionKeyHash: null,
  targetBindingHash: null,
  captureIntentHash:
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
  captureResult: false as const,
  finalizerHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  daemonGenerationHash:
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  completedAt,
  terminalStatus: 'succeeded' as const,
  resultHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
  resultBytes: 2,
  resultArtifact: null,
  nativeEvidence: { kind: 'no-artifact' as const, reasonCode: 'not-native-evidence' as const },
});
const DAY_MS = 86_400_000;
const codeUnitOrder = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

describe('LC-1 regression (T09)', () => {
  it('LC-1 regression (T09): expired snapshot and grounding-graph evidence drains through the production cleanup without throwing, detaches the evidence and drains the later harmless intent too', async () => {
    // Produce real receipts through the snapshot services.
    const state = await setup();
    let captureId: string, refreshId: string;
    let snapshotPath: string, graphPath: string;
    try {
      const first = await capture(state, `sfp_req1_${'A'.repeat(22)}`);
      captureId = first.operationId;
      snapshotPath = join(state.root, first.captured.snapshot.relativePath);
      graphPath = join(state.root, first.captured.graph.relativePath);
      await writeFile(
        join(state.root, 'Button.tsx'),
        'export const Button = () => <button>Changed</button>;\n',
      );
      refreshId = state.issuer.issue(actor.actorId);
      await state.plane.invokeService(actor, {
        version: 1,
        requestId: `sfp_req1_${'C'.repeat(21)}A`,
        serviceOperationName: 'grounding.refresh',
        rawArgs: {
          locator: {
            workspaceId,
            snapshotId: first.captured.snapshot.snapshotId,
            fileIdentityHash: first.captured.snapshot.fileIdentityHash,
          },
          expectedGraphChecksum: first.captured.graph.checksum,
        },
        workspaceId,
        targetSelector: { kind: 'none' },
        operationId: refreshId,
      });
    } finally {
      state.broker.dispose();
    }
    // snapshot-operation-evidence.ts:61 and :87 produce these native evidence kinds.
    const capturedReceipt = (await state.receipts.get(actor.actorId, captureId))!;
    const refreshedReceipt = (await state.receipts.get(actor.actorId, refreshId))!;
    expect(capturedReceipt).toMatchObject({
      workspaceId,
      resultArtifact: null,
      nativeEvidence: { kind: 'snapshot' },
    });
    expect(refreshedReceipt).toMatchObject({
      workspaceId,
      resultArtifact: null,
      nativeEvidence: { kind: 'grounding-graph' },
    });
    // A harmless receipt whose operation id sorts after both snapshot receipts in the drain.
    const harmlessId = 'zz-harmless-no-artifact';
    const reservation = await state.receipts.reserveBeforeRuntime(actor.actorId, harmlessId, 1);
    await state.receipts.prepareAndFsync(
      reservation.reservationId,
      noArtifactReceipt(harmlessId, capturedReceipt.completedAt),
    );
    const expiredIds = [captureId, refreshId, harmlessId];

    // The sweep's compaction 31 days later turns all three receipts into cleanup intents.
    const linkedAt = Date.parse(capturedReceipt.completedAt);
    await state.receipts.compact({
      now: linkedAt + 31 * DAY_MS,
      linkedAt: operationId => (expiredIds.includes(operationId) ? linkedAt : null),
    });
    for (const operationId of expiredIds)
      await expect(state.receipts.get(actor.actorId, operationId)).resolves.toBeNull();
    expect((await stat(state.receipts.cleanupIntentPath)).size).toBeGreaterThan(0);

    // Fixed behavior: the production cleanup drains every intent, in operation-id order.
    const report = await state.receipts.drainPendingArtifactCleanup(receipt =>
      cleanupRetainedEvidence(receipt, {
        isHeld: () => false,
        workspaces: [state.registration],
        ...unreachable,
      }),
    );
    expect(report.results).toEqual(
      expiredIds.toSorted(codeUnitOrder).map(operationId => ({
        operationId,
        workspaceId: operationId === harmlessId ? null : workspaceId,
        outcome: 'done',
      })),
    );
    expect(report.next).toBeNull();
    expect(report.results.at(-1)?.operationId).toBe(harmlessId);
    // Every intent is done, so the cleanup log is truncated.
    expect((await stat(state.receipts.cleanupIntentPath)).size).toBe(0);
    // Detaching keeps the snapshot and grounding-graph files: deleting them is the user's decision.
    await expect(stat(snapshotPath)).resolves.toBeDefined();
    await expect(stat(graphPath)).resolves.toBeDefined();

    // Durable: a restarted store (the next leader start) has nothing left to drain.
    const restarted = new OperationEvidenceReceiptStore({
      stateRoot: state.stateRoot,
      actorId: actor.actorId,
    });
    await restarted.recover();
    const drained: string[] = [];
    await restarted.drainPendingArtifactCleanup(async receipt => {
      drained.push(receipt.operationId);
    });
    expect(drained).toEqual([]);
  }, 60_000);

  it('LC-1 regression (T09): the retention sweep drains a 31-day-old snapshot receipt whose .sfp folder was deleted, and tool calls keep working', async () => {
    // Seam: the full leader start is test/e2e/retention-startup.test.ts. Here the extracted sweep,
    // runRetentionSweep, runs over the real journal, receipt, egress and recipe-hold stores with the
    // production cleanup, the way index.ts wires it.
    const state = await setup();
    try {
      const { operationId } = await capture(state, `sfp_req1_${'A'.repeat(22)}`);
      expect(await state.receipts.get(actor.actorId, operationId)).toMatchObject({
        nativeEvidence: { kind: 'snapshot' },
      });
      await rm(join(state.root, '.sfp'), { recursive: true, force: true });

      const permissions = fixturePermissions(state.stateRoot);
      const holds = new RecipeEvidenceHolds({
        stateRoot: state.stateRoot,
        store: new PortalStore(state.stateRoot, randomBytes(32), permissions),
        permissions,
        issuer: state.issuer,
        operations: state.journal,
        workspacePolicy: state.policy,
        readEvidence: createOperationEvidenceEndpoint({
          operations: state.journal,
          receipts: state.receipts,
          egress: state.egress,
        }),
        hasRetainedEvidence: async (id, candidate) =>
          (await state.receipts.get(id, candidate)) !== null ||
          (await state.egress.hasFinalizer(id, candidate)),
      });
      const artifacts = new OperationEvidenceArtifactStore({
        workspacePolicy: state.policy,
        atomicFiles: new AtomicFileStore(),
      });
      const nativeArtifacts = new NativeEvidenceArtifactPort({
        workspacePolicy: state.policy,
        atomicFiles: new AtomicFileStore(),
      });
      const lines: string[] = [];
      const summary = await runRetentionSweep({
        now: () => Date.now() + 31 * DAY_MS,
        log: line => lines.push(line),
        withRetentionBatch: work => holds.withRetentionSweep(work),
        compactEvidence: async (now, { isHeld }) => {
          const linkedAt = (id: string): number | null =>
            isHeld(id) ? null : state.journal.settledAt(id);
          await state.receipts.compact({ now, linkedAt });
          await state.egress.compact({ now, linkedAt });
        },
        drainCleanupIntents: ({ isHeld }, batch) =>
          state.receipts.drainPendingArtifactCleanup(
            receipt =>
              cleanupRetainedEvidence(receipt, {
                isHeld,
                workspaces: [state.registration],
                artifacts,
                nativeArtifacts,
              }),
            batch,
          ),
        listWorkspaces: async () => [state.registration],
        scanWorkspace: async (workspace, { isHeld }) => {
          const hasLinkedEvidence = async (id: string) =>
            isHeld(id) || (await state.receipts.get(actor.actorId, id)) !== null;
          expect(
            await artifacts.discoverAndCleanupOrphans({
              workspaceId: workspace.workspaceId,
              hasLinkedEvidence,
            }),
          ).toMatchObject({ status: 'ready' });
          expect(
            await nativeArtifacts.discoverAndCleanupOrphans({
              workspaceId: workspace.workspaceId,
              hasLinkedEvidence,
            }),
          ).toMatchObject({ status: 'ready' });
        },
        purgeExpiredTombstones: async (now, scope) => {
          await state.journal.purgeExpiredTombstones(now, scope);
        },
      });

      // The intent ends done, and nothing failed or was left pending.
      expect(summary).toMatchObject({
        aborted: false,
        failedPhases: [],
        cleanup: { done: 1, deferred: 0, failed: 0, quarantined: 0 },
        workspaces: { scanned: [workspaceId], skipped: [], failed: [] },
      });
      await expect(state.receipts.get(actor.actorId, operationId)).resolves.toBeNull();
      expect((await stat(state.receipts.cleanupIntentPath)).size).toBe(0);
      expect(lines.filter(line => !line.startsWith('[retention] sweep finished'))).toEqual([]);

      // Tool calls keep working after the sweep: the same plane captures a new snapshot.
      const again = await capture(state, `sfp_req1_${'D'.repeat(21)}A`);
      expect(await state.receipts.get(actor.actorId, again.operationId)).toMatchObject({
        nativeEvidence: { kind: 'snapshot' },
      });
    } finally {
      state.broker.dispose();
    }
  }, 60_000);

  it('LC-1 regression (T09): index.ts drains through the production cleanup and schedules the sweep after leader initialization instead of awaiting it', async () => {
    // Pins the wiring that the behavioral tests above cannot reach: index.ts is the process entry.
    const source = await readFile(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    // No local copy of the cleanup callback and no blanket manual-verification throw remain.
    expect(source).not.toContain('removeRetainedArtifacts');
    expect(source).not.toContain('native evidence cleanup requires manual verification');
    // The sweep drains every pending intent through the imported production cleanup.
    expect(source).toMatch(
      /evidenceReceipts\.drainPendingArtifactCleanup\(\s*receipt =>\s*cleanupRetainedEvidence\(receipt, \{/u,
    );
    // Initialization never awaits a sweep; the sweeps are scheduled once the runtime is built.
    const start = source.indexOf('const initializeLeaderRuntime = async (');
    const end = source.indexOf('resolvedRuntimes.set(generation, runtime);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const initialization = source.slice(start, end);
    expect(initialization).not.toMatch(/await retention\.sweep\(/u);
    expect(initialization).toMatch(/runRetentionSweep\(\{/u);
    const scheduled = initialization.indexOf('scheduleRetentionSweeps(retention, log)');
    expect(scheduled).toBeGreaterThan(initialization.indexOf('typedControlRouter.freeze()'));
    expect(scheduled).toBeGreaterThan(
      initialization.lastIndexOf('if (node.getLeader() !== resources) {'),
    );
  });
});
