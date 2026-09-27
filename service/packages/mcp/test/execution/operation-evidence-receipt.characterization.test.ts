import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  ALL_DATA_CLASSES,
  type ActorContext,
  type OperationEvidenceReceiptV1,
  type WorkspacePolicy,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { NativeEvidenceArtifactPort } from '../../src/execution/native-evidence-artifact-port.js';
import { createOperationEvidenceProjector } from '../../src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { createApprovalBroker } from '../../src/policy/approval-broker.js';
import { createSnapshotOperations } from '../../src/snapshot/operations.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';

/*
 * T06a characterization of finding LC-1 (remediation plan section 3.1). The fix is task T09.
 *
 * LC-1: the leader's startup retention sweep (mcp/src/index.ts:958) drains durable cleanup
 * intents for expired operation evidence (index.ts:909-915). Its callback, removeRetainedArtifacts
 * (index.ts:847-883), handles only `export` and `no-artifact` native evidence and throws
 * NATIVE_ARTIFACT_IDENTITY_MISMATCH for anything else, while snapshot.capture and
 * grounding.refresh record `snapshot` and `grounding-graph` native evidence
 * (mcp/src/snapshot/snapshot-operation-evidence.ts:61,87). The drain
 * (mcp/src/execution/operation-evidence-receipt-store.ts:531-545) has no per-intent isolation, so
 * the first such intent aborts the drain, later intents are never drained, and every restart
 * fails the same way: leader initialization wedges 30 days after the first capture.
 *
 * Seam: removeRetainedArtifacts is a closure inside leader initialization and cannot be imported.
 * The drain is driven through the real OperationEvidenceReceiptStore with a verbatim mirror of
 * the callback's branches for receipts without a result artifact, and a separate test pins the
 * mirrored branches to the index.ts source. The receipts come from the real snapshot services,
 * using the canonical execution-plane harness of snapshot/service-operations.test.ts.
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
  return { root, stateRoot, plane, receipts, issuer, broker };
};

/**
 * Mirror of removeRetainedArtifacts (mcp/src/index.ts:847-883) for receipts without a result
 * artifact. The `export` branch is not mirrored because these receipts never take it.
 */
const indexRetentionCleanupMirror = async (
  receipt: Readonly<OperationEvidenceReceiptV1>,
): Promise<void> => {
  if (receipt.workspaceId === null) {
    if (receipt.resultArtifact !== null || receipt.nativeEvidence.kind !== 'no-artifact')
      throw Object.assign(new Error('retained evidence lacks a workspace binding'), {
        code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
      });
    return;
  }
  if (receipt.resultArtifact !== null || receipt.nativeEvidence.kind === 'export')
    throw new Error('T06a mirror does not cover result-artifact or export cleanup');
  if (receipt.nativeEvidence.kind !== 'no-artifact')
    throw Object.assign(new Error('native evidence cleanup requires manual verification'), {
      code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
    });
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

describe('LC-1 characterization (flip in T09)', () => {
  it('LC-1 characterization: expired snapshot and grounding-graph evidence makes the retention drain throw NATIVE_ARTIFACT_IDENTITY_MISMATCH and strands later intents (flip in T09)', async () => {
    // LC-1, fixed by T09. Produce real receipts through the snapshot services.
    const state = await setup();
    let captureId: string, refreshId: string;
    try {
      captureId = state.issuer.issue(actor.actorId);
      const captured = (await state.plane.invokeService(actor, {
        version: 1,
        requestId: `sfp_req1_${'A'.repeat(22)}`,
        serviceOperationName: 'snapshot.capture',
        rawArgs: { nodeIds: ['1:1'] },
        workspaceId,
        targetSelector: { kind: 'session', sessionId: target.sessionId },
        operationId: captureId,
      })) as {
        snapshot: { workspaceId: string; snapshotId: string; fileIdentityHash: string };
        graph: { checksum: string };
      };
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
            snapshotId: captured.snapshot.snapshotId,
            fileIdentityHash: captured.snapshot.fileIdentityHash,
          },
          expectedGraphChecksum: captured.graph.checksum,
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

    // Current behavior: the first snapshot intent throws and aborts the whole drain.
    const attempted: string[] = [];
    await expect(
      state.receipts.drainPendingArtifactCleanup(async receipt => {
        attempted.push(receipt.operationId);
        await indexRetentionCleanupMirror(receipt);
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' });
    expect(attempted).toHaveLength(1);
    expect([captureId, refreshId]).toContain(attempted[0]);

    // Durable and permanent: a restarted store (the next leader start) fails the same way.
    const restarted = new OperationEvidenceReceiptStore({
      stateRoot: state.stateRoot,
      actorId: actor.actorId,
    });
    await restarted.recover();
    await expect(
      restarted.drainPendingArtifactCleanup(indexRetentionCleanupMirror),
    ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' });

    // Control: nothing was drained, including the harmless intent that sorts after the failure,
    // and a callback that does not throw drains all three in operation-id order.
    const drained: string[] = [];
    await restarted.drainPendingArtifactCleanup(async receipt => {
      drained.push(receipt.operationId);
    });
    expect(drained).toEqual(expiredIds.toSorted((left, right) => left.localeCompare(right)));
    expect(drained.at(-1)).toBe(harmlessId);
  }, 60_000);

  it('LC-1 characterization: the index.ts retention callback throws NATIVE_ARTIFACT_IDENTITY_MISMATCH for every native evidence kind except export and no-artifact (flip in T09)', async () => {
    // LC-1, fixed by T09 (snapshot and grounding-graph cleanup only detaches the evidence). This
    // pins the mirrored branches above to the production callback, which cannot be imported.
    const source = await readFile(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    const start = source.indexOf('const removeRetainedArtifacts = async (');
    const end = source.indexOf('const operationEvidenceEndpoint =', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const callback = source.slice(start, end);
    expect(callback).toMatch(/if \(receipt\.nativeEvidence\.kind === 'export'\) \{/u);
    expect(callback).toMatch(
      /\} else if \(receipt\.nativeEvidence\.kind !== 'no-artifact'\) \{\s*throw Object\.assign\(new Error\('native evidence cleanup requires manual verification'\), \{\s*code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',/u,
    );
    expect(callback).not.toMatch(/'snapshot'|'grounding-graph'/u);
    // The startup sweep drains every pending intent through that callback.
    expect(source).toMatch(
      /evidenceReceipts\.drainPendingArtifactCleanup\(async receipt => \{[\s\S]{0,400}?await removeRetainedArtifacts\(receipt\);/u,
    );
  });
});
