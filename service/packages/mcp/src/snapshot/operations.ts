import { createHash } from 'node:crypto';

import {
  assertLocator,
  canonicalJson,
  contentHash,
  GroundingRefreshArgsSchema,
  GroundingRefreshResultSchema,
  SnapshotCaptureArgsSchema,
  SnapshotCaptureResultSchema,
  SnapshotLocatorSchema,
  snapshotRelativePath,
  type SnapshotLocator,
} from '@sfp/ir';
import {
  canonicalFileIdentityHash,
  EgressPolicyError,
  type DataClass,
  type OperationPolicy,
  type ResultEgressPolicy,
  type RuntimeExecutionScope,
  type ServerEvidenceWriteEffectV1,
  type WorkspacePolicy,
  type OperationRecord,
  type OperationTombstone,
} from '@sfp/shared';
import type { z } from 'zod';

import type {
  ExecutableOperation,
  ExecutableOperations,
} from '../execution/executable-operation.js';
import { RepoReader } from '../fs/repo-walk.js';
import type { PinnedPluginRuntimePort } from '../tools/runtime-registry.js';
import { buildGroundingGraph } from './build-grounding-graph.js';
import { captureSnapshot } from './capture-snapshot.js';
import { refreshGroundingGraph } from './refresh-grounding-graph.js';
import { WorkspaceGraphStorage } from './workspace-graph-storage.js';
import { WorkspaceSnapshotStorage } from './workspace-snapshot-storage.js';

export const serviceResultPolicy = (
  schema: z.ZodType,
  classes: readonly DataClass[],
): ResultEgressPolicy => {
  const classify = <T>(value: T) => {
    const bytes = Buffer.byteLength(canonicalJson(value));
    return { value, classes, bytes, tokens: Math.max(1, Math.ceil(bytes / 4)) };
  };
  return Object.freeze({
    possibleInputClasses: () => classes,
    possibleResultClasses: classes,
    classifyInput: classify,
    classifyResult: classify,
    redactResult: (value: unknown, allowed: readonly DataClass[]) => {
      if (classes.some(item => !allowed.includes(item)))
        throw new EgressPolicyError(
          'EGRESS_CLASS_NOT_ALLOWED',
          'service result class is not allowed',
        );
      return schema.parse(value);
    },
  });
};
const capturePolicy: OperationPolicy = Object.freeze({
  toolName: 'snapshot.capture',
  possibleEffects: [
    { type: 'figma-read' },
    { type: 'filesystem-read', pathArgs: [] },
    { type: 'filesystem-write', pathArgs: [], destructive: false },
  ] as const,
  possibleIdempotency: 'operation-id',
  effectsFor: () => capturePolicy.possibleEffects,
  idempotencyFor: () => 'operation-id',
  approvalFor: () => 'client',
  concurrency: 'exclusive-heavy',
});
const refreshPolicy: OperationPolicy = Object.freeze({
  toolName: 'grounding.refresh',
  possibleEffects: [
    { type: 'filesystem-read', pathArgs: [] },
    { type: 'filesystem-write', pathArgs: [], destructive: true },
  ] as const,
  possibleIdempotency: 'operation-id',
  effectsFor: () => refreshPolicy.possibleEffects,
  idempotencyFor: () => 'operation-id',
  approvalFor: () => 'explicit-user',
  concurrency: 'exclusive-heavy',
});
export const SNAPSHOT_OPERATION_DEFINITIONS = Object.freeze({
  'snapshot.capture': {
    name: 'snapshot.capture' as const,
    inputSchema: SnapshotCaptureArgsSchema,
    resultSchema: SnapshotCaptureResultSchema,
    policy: capturePolicy,
    egress: serviceResultPolicy(SnapshotCaptureResultSchema, [
      'project-code',
      'design-text',
      'design-image',
    ]),
    targetRequirementFor: () => 'required' as const,
  },
  'grounding.refresh': {
    name: 'grounding.refresh' as const,
    inputSchema: GroundingRefreshArgsSchema,
    resultSchema: GroundingRefreshResultSchema,
    policy: refreshPolicy,
    egress: serviceResultPolicy(GroundingRefreshResultSchema, ['project-code', 'design-text']),
    targetRequirementFor: () => 'forbidden' as const,
  },
});

export const snapshotLocatorForOperation = (
  scope: Pick<RuntimeExecutionScope, 'workspace' | 'target'>,
  operationId: string,
): SnapshotLocator => {
  if (
    scope.workspace.workspaceId === null ||
    scope.target.fileIdentity === null ||
    scope.target.fileIdentity.kind === 'unstable-readonly'
  )
    throw Object.assign(new Error('snapshot requires a stable file and workspace'), {
      code: 'SNAPSHOT_STABLE_TARGET_REQUIRED',
    });
  const id = createHash('sha256')
    .update('sfp-snapshot-id-v1\0')
    .update(operationId)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  return SnapshotLocatorSchema.parse({
    workspaceId: scope.workspace.workspaceId,
    fileIdentityHash: canonicalFileIdentityHash(scope.target.fileIdentity),
    snapshotId: `sfp_snap1_${id}`,
  });
};
const evidenceWrite = (
  locator: SnapshotLocator,
  graph: boolean,
  expectedChecksum: string | null = null,
): ServerEvidenceWriteEffectV1 => ({
  type: 'server-evidence-write',
  evidenceKind: graph ? 'grounding-graph' : 'snapshot',
  workspaceId: locator.workspaceId,
  resolvedRelativePath: snapshotRelativePath(locator, graph),
  writeMode: expectedChecksum === null ? 'create-new' : 'cas-replace',
  destructive: expectedChecksum !== null,
  expectedContentHash: expectedChecksum as `sha256:${string}` | null,
});
const assertWrites = (scope: RuntimeExecutionScope, expected: ServerEvidenceWriteEffectV1[]) => {
  if (canonicalJson(scope.evidenceWrites ?? []) !== canonicalJson(expected))
    throw new Error('SNAPSHOT_WRITE_AUTHORITY_MISMATCH');
};

export const createSnapshotOperations = (dependencies: {
  workspacePolicy: WorkspacePolicy;
  plugin: PinnedPluginRuntimePort;
  productVersion: string;
  fileName(sessionId: string): string;
  getOperation(id: string): OperationRecord | OperationTombstone | undefined;
}): ExecutableOperations => {
  const snapshots = new WorkspaceSnapshotStorage(dependencies.workspacePolicy);
  const reader = (scope: RuntimeExecutionScope, signal: AbortSignal) => {
    if (scope.workspace.workspaceId === null || scope.workspace.workspaceRoot === null)
      throw new Error('WORKSPACE_REQUIRED');
    return new RepoReader({
      rootDir: scope.workspace.workspaceRoot,
      workspaceId: scope.workspace.workspaceId,
      workspacePolicy: dependencies.workspacePolicy,
      signal,
    });
  };
  const capture: ExecutableOperation = {
    ...SNAPSHOT_OPERATION_DEFINITIONS['snapshot.capture'],
    operationKind: 'service',
    resolveScope: async input => {
      const locator = snapshotLocatorForOperation(input, input.operationId);
      const evidenceWrites = [evidenceWrite(locator, false), evidenceWrite(locator, true)];
      const paths = await Promise.all(
        evidenceWrites.map(row =>
          input.workspacePolicy.resolveWrite(locator.workspaceId, row.resolvedRelativePath),
        ),
      );
      return { resolvedPaths: { snapshot: paths[0]!, graph: paths[1]! }, evidenceWrites };
    },
    execute: async (scope, rawArgs, signal, reporter, action) => {
      if (action === undefined) throw new Error('OPERATION_EXECUTOR_REQUIRED');
      const args = SnapshotCaptureArgsSchema.parse(rawArgs),
        locator = snapshotLocatorForOperation(scope, action.operationId);
      assertWrites(scope, [evidenceWrite(locator, false), evidenceWrite(locator, true)]);
      const snapshot = await captureSnapshot({
        scope,
        snapshotId: locator.snapshotId,
        nodeIds: args.nodeIds,
        fileName: dependencies.fileName(scope.target.sessionId!),
        productVersion: dependencies.productVersion,
        signal,
        ...(reporter === undefined ? {} : { reporter }),
        read: (nodeId, readSignal) =>
          dependencies.plugin.execute(
            scope,
            'get_design_context',
            { nodeId, detail: 'full', dedupeComponents: false, budget: true },
            readSignal,
            reporter,
            action,
          ),
      });
      signal.throwIfAborted();
      const key = { ...locator, fileIdentity: snapshot.connector.fileIdentity };
      const snapshotReference = await snapshots.save(key, snapshot);
      try {
        signal.throwIfAborted();
        const graph = await buildGroundingGraph(snapshot, reader(scope, signal));
        signal.throwIfAborted();
        const graphs = new WorkspaceGraphStorage(dependencies.workspacePolicy, async () => {
          throw new Error('GRAPH_REPLACE_NOT_AUTHORIZED');
        });
        const graphReference = await graphs.create(key, graph);
        return SnapshotCaptureResultSchema.parse({
          snapshot: snapshotReference,
          graph: graphReference,
          graphIssue: null,
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'committed' in error &&
          error.committed === true
        )
          throw error;
        if (signal.aborted)
          throw Object.assign(new Error('snapshot published before cancellation'), {
            code: 'SNAPSHOT_CANCELLED_AFTER_WRITE',
            committed: true,
          });
        return SnapshotCaptureResultSchema.parse({
          snapshot: snapshotReference,
          graph: null,
          graphIssue: {
            code: 'GRAPH_BUILD_FAILED',
            messageHash: contentHash(
              'sfp-graph-issue-v1',
              error instanceof Error ? error.message : 'unknown',
            ),
          },
        });
      }
    },
  };
  const refresh: ExecutableOperation = {
    ...SNAPSHOT_OPERATION_DEFINITIONS['grounding.refresh'],
    operationKind: 'service',
    resolveScope: async input => {
      const args = GroundingRefreshArgsSchema.parse(input.args);
      if (input.workspace.workspaceId !== args.locator.workspaceId)
        throw new Error('SNAPSHOT_LOCATOR_MISMATCH');
      const snapshot = await input.workspacePolicy.resolveRead(
        args.locator.workspaceId,
        snapshotRelativePath(args.locator),
      );
      const graph = await input.workspacePolicy.resolveWrite(
        args.locator.workspaceId,
        snapshotRelativePath(args.locator, true),
      );
      if (!graph.overwrites) throw new Error('GRAPH_NOT_FOUND');
      return {
        resolvedPaths: { snapshot: { path: snapshot, overwrites: true }, graph },
        evidenceWrites: [evidenceWrite(args.locator, true, args.expectedGraphChecksum)],
      };
    },
    execute: async (scope, rawArgs, signal, _reporter, action) => {
      if (action === undefined) throw new Error('OPERATION_EXECUTOR_REQUIRED');
      const args = GroundingRefreshArgsSchema.parse(rawArgs);
      if (
        scope.workspace.workspaceId !== args.locator.workspaceId ||
        scope.target.sessionId !== null
      )
        throw new Error('SNAPSHOT_LOCATOR_MISMATCH');
      assertWrites(scope, [evidenceWrite(args.locator, true, args.expectedGraphChecksum)]);
      const record = dependencies.getOperation(action.operationId);
      if (
        record === undefined ||
        !('approvalId' in record) ||
        record.approvalId === null ||
        record.status !== 'dispatched' ||
        record.actorId !== scope.actor.actorId
      )
        throw new Error('GRAPH_REPLACE_NOT_AUTHORIZED');
      const approvalId = record.approvalId;
      const graphs = new WorkspaceGraphStorage(
        dependencies.workspacePolicy,
        async (actor, approval, locator) => {
          assertLocator(args.locator, locator);
          signal.throwIfAborted();
          if (actor !== scope.actor.actorId || approval !== approvalId)
            throw new Error('GRAPH_REPLACE_NOT_AUTHORIZED');
        },
      );
      const snapshot = await snapshots.loadByLocator(args.locator),
        current = await graphs.loadByLocator(args.locator);
      if (
        snapshot === null ||
        current === null ||
        current.ref.checksum !== args.expectedGraphChecksum ||
        current.graph.snapshotContentHash !== snapshot.snapshot.contentHash
      )
        throw new Error('GRAPH_CHECKSUM_CONFLICT');
      const result = await refreshGroundingGraph(current.graph, reader(scope, signal), signal);
      signal.throwIfAborted();
      const ref = await graphs.replaceByLocator(
        args.locator,
        result.graph,
        args.expectedGraphChecksum as `sha256:${string}`,
        scope.actor.actorId,
        approvalId,
      );
      return GroundingRefreshResultSchema.parse({
        graph: ref,
        checkedCodeRefs: result.checkedCodeRefs,
        verifiedEdges: result.verifiedEdges,
        staleEdges: result.staleEdges,
        fidelity:
          snapshot.snapshot.fidelity.truncated || result.staleEdges > 0
            ? 'partial'
            : 'complete-leaf',
      });
    },
  };
  return Object.freeze({
    'snapshot.capture': Object.freeze(capture),
    'grounding.refresh': Object.freeze(refresh),
  });
};
