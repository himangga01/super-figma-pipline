import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  ALL_DATA_CLASSES,
  canonicalFileIdentityHash,
  DocumentBindingRequestSchema,
  DocumentBindingResultSchema,
  IdentityBootstrapArgsSchema,
  IdentityBootstrapResultSchema,
  IdentityReadResultSchema,
  type ActorContext,
  type OperationPolicy,
  type RuntimeExecutionScope,
} from '@sfp/shared';

import type { ApprovalBroker } from '../policy/approval-broker.js';
import type { DocumentBindingStore } from '../security/document-binding-store.js';
import type { PairingManager } from '../security/pairing-manager.js';
import { serviceResultPolicy } from '../snapshot/operations.js';
import type { PinnedPluginRuntimePort } from '../tools/runtime-registry.js';
import type { ExecutableOperation } from './executable-operation.js';
import type { OperationExecutor } from './operation-executor.js';
import type { OperationIdIssuer } from './operation-id.js';
import type { TargetResolver } from './target-resolver.js';

const policy: OperationPolicy = Object.freeze({
  toolName: 'identity.bootstrap',
  possibleEffects: [{ type: 'figma-write', destructive: false, broad: false }] as const,
  possibleIdempotency: 'operation-id',
  effectsFor: (args: Readonly<Record<string, unknown>>) =>
    args.readOnly === true ? ([{ type: 'figma-read' }] as const) : policy.possibleEffects,
  idempotencyFor: () => 'operation-id',
  approvalFor: () => 'explicit-user',
  concurrency: 'exclusive-heavy',
});
export const createIdentityOperation = (plugin: PinnedPluginRuntimePort): ExecutableOperation => ({
  name: 'identity.bootstrap',
  operationKind: 'system',
  inputSchema: IdentityBootstrapArgsSchema,
  resultSchema: IdentityBootstrapResultSchema,
  policy,
  egress: serviceResultPolicy(IdentityBootstrapResultSchema, ['secret']),
  targetRequirementFor: () => 'required',
  execute: async (scope, args, signal, reporter, action) => {
    if (scope.actor.entryPath !== 'internal-system' || action === undefined)
      throw new Error('IDENTITY_INTERNAL_AUTHORITY_REQUIRED');
    if (args.readOnly === true) {
      const facts = IdentityReadResultSchema.parse(
        await plugin.execute(scope, '$identity.read', {}, signal, reporter, action),
      );
      if (
        facts.rawHash !== args.expectedRawHash ||
        facts.pluginGeneration !== args.pluginGeneration
      )
        throw new Error('IDENTITY_PRECONDITION_FAILED');
      return IdentityBootstrapResultSchema.parse({
        fileIdentity: scope.target.fileIdentity,
        mutated: false,
      });
    }
    return IdentityBootstrapResultSchema.parse(
      await plugin.execute(scope, '$identity.bootstrap', args, signal, reporter, action),
    );
  },
});

export interface SessionDocumentBinding {
  pluginGeneration: string;
  fileIdentityHash: string;
  fileKeyHash: string;
  fileName: string;
}
export const createIdentityBootstrapCoordinator = (dependencies: {
  ownerKey: Uint8Array;
  actorId: ActorContext['actorId'];
  generation: string;
  plugin: PinnedPluginRuntimePort;
  targets: TargetResolver;
  executor: OperationExecutor;
  approvals: ApprovalBroker;
  issuer: OperationIdIssuer;
  pairing: PairingManager;
  bindings: DocumentBindingStore;
  sessionBindings: Map<string, SessionDocumentBinding>;
}) => {
  const active = new Set<string>();
  return async (sessionId: string, input: unknown, signal: AbortSignal) => {
    const request = DocumentBindingRequestSchema.parse(input);
    if (active.has(sessionId))
      throw Object.assign(new Error('identity setup is already running'), {
        code: 'IDENTITY_BOOTSTRAP_BUSY',
      });
    active.add(sessionId);
    try {
      const target = dependencies.targets.resolve({ kind: 'session', sessionId }, 'required');
      const authSessionId =
        `auth1_${createHmac('sha256', dependencies.ownerKey).update('sfp-identity-auth-v1\0').update(dependencies.generation).update('\0').update(sessionId).digest('base64url')}` as const;
      const scope: RuntimeExecutionScope = Object.freeze({
        requestId: `sfp_req1_${randomBytes(16).toString('base64url')}`,
        leaderGeneration: dependencies.generation,
        actor: Object.freeze({
          actorId: dependencies.actorId,
          authSessionId,
          entryPath: 'internal-system',
        }),
        workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
        target,
        approvalLabel: `https://www.figma.com/design/${request.fileKey}`,
        consent: Object.freeze({
          mode: 'local-trusted',
          consentId: null,
          allowedClasses: ALL_DATA_CLASSES,
        }),
      });
      const operationId = dependencies.issuer.issue(scope.actor.actorId);
      const facts = IdentityReadResultSchema.parse(
        await dependencies.plugin.execute(scope, '$identity.read', {}, signal, undefined, {
          operationId,
          actionNonce: randomBytes(16).toString('base64url'),
        }),
      );
      if (
        facts.fileName !== request.expectedFileName ||
        facts.pluginGeneration !== target.pluginGeneration
      )
        throw new Error('IDENTITY_TARGET_CHANGED');
      if (facts.fileKey !== null)
        throw new Error(
          facts.fileKey === request.fileKey
            ? 'NATIVE_FILE_IDENTITY_AVAILABLE'
            : 'DESKTOP_FILE_MISMATCH',
        );
      const fileKeyHash = canonicalFileIdentityHash({
        kind: 'figma-file-key',
        value: request.fileKey,
      });
      const existing =
        facts.documentUuid === null
          ? null
          : await dependencies.bindings.get({
              kind: 'document-plugin-uuid',
              value: facts.documentUuid,
            });
      const uuid =
        existing !== null &&
        (existing.fileKeyHash !== fileKeyHash || existing.fileName !== facts.fileName)
          ? randomUUID()
          : (facts.documentUuid ?? randomUUID());
      const publishNonce = randomBytes(16).toString('base64url');
      const args = IdentityBootstrapArgsSchema.parse({
        readOnly: request.readOnly,
        expectedRawHash: facts.rawHash,
        pluginGeneration: facts.pluginGeneration,
        documentUuid: uuid,
        publishNonce,
      });
      const pending = await dependencies.approvals.request(
        scope,
        'identity.bootstrap',
        policy.effectsFor(args, scope),
        operationId,
      );
      if (pending === null) throw new Error('APPROVAL_CHANNEL_UNAVAILABLE');
      const handle = await dependencies.executor.beginToolApproval(
        scope,
        'identity.bootstrap',
        args,
        operationId,
        pending.approvalId,
      );
      const cancel = () => {
        dependencies.approvals.cancel?.(operationId);
        void dependencies.executor
          .cancel(scope.actor, { version: 1, requestId: scope.requestId, operationId })
          .catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        const decision = await pending.waitForDecision();
        signal.throwIfAborted();
        if (decision.decision !== 'approved') {
          await dependencies.executor.rejectToolApproval(
            handle,
            decision.decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED',
          );
          throw new Error('APPROVAL_REJECTED');
        }
        const result = IdentityBootstrapResultSchema.parse(
          await dependencies.executor.resumeApprovedTool(handle, scope),
        );
        if (request.readOnly) {
          if (dependencies.sessionBindings.size >= 256)
            dependencies.sessionBindings.delete(dependencies.sessionBindings.keys().next().value!);
          dependencies.sessionBindings.set(sessionId, {
            pluginGeneration: facts.pluginGeneration,
            fileIdentityHash: canonicalFileIdentityHash(result.fileIdentity),
            fileKeyHash,
            fileName: facts.fileName,
          });
          return DocumentBindingResultSchema.parse({
            operationId,
            fileIdentity: result.fileIdentity,
            fileKeyHash,
            readOnly: true,
            publishNonce: null,
            ticket: null,
          });
        }
        if (
          result.fileIdentity.kind !== 'document-plugin-uuid' ||
          result.fileIdentity.value !== uuid
        )
          throw new Error('IDENTITY_RESULT_MISMATCH');
        signal.throwIfAborted();
        await dependencies.bindings.save({
          fileIdentity: result.fileIdentity,
          fileKeyHash,
          fileName: facts.fileName,
          operationId,
        });
        const challenge = await dependencies.pairing.createChallenge(scope.actor.actorId);
        const ticket = await dependencies.pairing.exchange(challenge.challengeId, challenge.code);
        return DocumentBindingResultSchema.parse({
          operationId,
          fileIdentity: result.fileIdentity,
          fileKeyHash,
          readOnly: false,
          publishNonce,
          ticket,
        });
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    } finally {
      active.delete(sessionId);
    }
  };
};
