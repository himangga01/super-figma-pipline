import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { canonicalJson, GroundingGraphV1Schema } from '@sfp/ir';
import {
  ALL_DATA_CLASSES,
  type ActorContext,
  type WorkspacePolicy,
  type ProgressReporter,
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

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
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

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-snapshot-service-'));
  roots.push(root);
  const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-snapshot-state-'));
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
      const { stat } = await import('node:fs/promises');
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
      const { stat } = await import('node:fs/promises');
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
  let reads = 0;
  const operations = createSnapshotOperations({
    workspacePolicy: policy,
    productVersion: '0.1.0',
    fileName: () => 'Fixture',
    getOperation: id => journal.get(id),
    plugin: {
      execute: async (_scope, name, _args, signal, reporter?: ProgressReporter) => {
        signal.throwIfAborted();
        reads++;
        expect(name).toBe('get_design_context');
        reporter?.report({ phase: 'reading', completed: 1, total: 1, message: 'read' });
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
  const prompts: unknown[] = [];
  const broker = createApprovalBroker({
    deliverPluginPrompt: async () => {
      throw new Error('wrong approval channel');
    },
    deliverControlPrompt: async prompt => {
      prompts.push(prompt);
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
  return { root, plane, journal, receipts, prompts, issuer, broker, readCount: () => reads };
};

describe('snapshot services through the canonical execution plane', () => {
  it('captures, checks native evidence, and refreshes stale code without reading Figma again', async () => {
    const state = await setup();
    try {
      const operationId = state.issuer.issue(actor.actorId);
      const result = (await state.plane.invokeService(actor, {
        version: 1,
        requestId: `sfp_req1_${'A'.repeat(22)}`,
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
      expect(state.journal.get(operationId)).toMatchObject({
        operationKind: 'service',
        operationName: 'snapshot.capture',
        status: 'succeeded',
      });
      expect(await state.receipts.get(actor.actorId, operationId)).toMatchObject({
        nativeEvidence: { kind: 'snapshot', fidelity: 'complete-leaf' },
      });
      expect(state.prompts[0]).toMatchObject({
        operationKind: 'service',
        effectSummary: expect.arrayContaining([
          'server-evidence-write:snapshot:create-new',
          'server-evidence-write:grounding-graph:create-new',
        ]),
      });
      const graph = GroundingGraphV1Schema.parse(
        JSON.parse(await readFile(join(state.root, result.graph.relativePath), 'utf8')),
      );
      expect(
        graph.edges.some(edge => edge.kind === 'implements' && edge.state === 'candidate'),
      ).toBe(true);
      const beforeReads = state.readCount();
      await writeFile(
        join(state.root, 'Button.tsx'),
        'export const Button = () => <button>Changed</button>;\n',
      );
      const refreshId = state.issuer.issue(actor.actorId);
      const updated = (await state.plane.invokeService(actor, {
        version: 1,
        requestId: `sfp_req1_${'C'.repeat(21)}A`,
        serviceOperationName: 'grounding.refresh',
        rawArgs: {
          locator: {
            workspaceId,
            snapshotId: result.snapshot.snapshotId,
            fileIdentityHash: result.snapshot.fileIdentityHash,
          },
          expectedGraphChecksum: result.graph.checksum,
        },
        workspaceId,
        targetSelector: { kind: 'none' },
        operationId: refreshId,
      })) as { staleEdges: number; fidelity: string };
      expect(updated.staleEdges).toBeGreaterThan(0);
      expect(updated.fidelity).toBe('partial');
      expect(state.readCount()).toBe(beforeReads);
      expect(state.journal.get(refreshId)).toMatchObject({
        status: 'succeeded',
        operationName: 'grounding.refresh',
      });
      expect(canonicalJson(state.prompts)).toContain('cas-replace');
    } finally {
      state.broker.dispose();
    }
  }, 30_000);
});
