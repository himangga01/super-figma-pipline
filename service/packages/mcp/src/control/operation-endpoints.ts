import { createHash } from 'node:crypto';

import {
  hashActionRequest,
  InvocationCancelV1Schema,
  OperationStatusSchema,
  parseOperationResolutionRecord,
  type ActionNonceStore,
  type ActorContext,
  type OperationRecord,
  type OperationResolutionRecord,
  type OperationStatus,
  type OperationTombstone,
  type PrefixedSha256,
} from '@sfp/shared';
import { z } from 'zod';

import type { OperationIdIssuer } from '../execution/operation-id.js';
import type { OperationJournal } from '../execution/operation-journal.js';
import type { OperationResolutionIntentStore } from '../execution/operation-resolution-intent.js';

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const OperationListRequestSchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    status: OperationStatusSchema.optional(),
  })
  .strict();
const ResolutionInputSchema = z
  .object({
    decision: z.enum(['resolved-applied', 'resolved-not-applied', 'abandoned']),
    reasonHash: HashSchema,
    evidenceHash: HashSchema,
    confirmedResultHash: HashSchema.nullable().default(null),
    confirmationHash: HashSchema.optional(),
    confirm: z.string().min(1).max(768),
    actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
  })
  .strict();

const confirmationHash = (confirm: string): PrefixedSha256 =>
  `sha256:${createHash('sha256')
    .update('sfp-operation-resolution-confirmation-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(confirm, 'utf8')
    .digest('hex')}`;

export const assertOperationCancellationAuthority = (
  operation: Readonly<OperationRecord | OperationTombstone>,
  principal: Readonly<ActorContext>,
): void => {
  if (operation.actorId !== principal.actorId) {
    throw Object.assign(new Error('operation was not found'), { code: 'OPERATION_NOT_FOUND' });
  }
  if (operation.originAuthSessionId !== principal.authSessionId) {
    throw Object.assign(new Error('cancel is bound to the origin auth session'), {
      code: 'CANCEL_AUTH_SESSION_MISMATCH',
    });
  }
};

export const createOperationResolutionRecord = (
  unknown: Readonly<OperationRecord>,
  resolver: Readonly<ActorContext>,
  input: {
    decision: OperationResolutionRecord['decision'];
    reasonHash: PrefixedSha256;
    evidenceHash: PrefixedSha256;
    confirmedResultHash: PrefixedSha256 | null;
    confirmationHash: PrefixedSha256;
  },
  decidedAt: number,
): OperationResolutionRecord =>
  parseOperationResolutionRecord({
    actorId: unknown.actorId,
    originAuthSessionId: unknown.originAuthSessionId,
    origin: unknown.origin,
    resolverAuthSessionId: resolver.authSessionId,
    operationId: unknown.operationId,
    issuedAt: unknown.issuedAt,
    operationKind: unknown.operationKind,
    operationName: unknown.operationName,
    argsHash: unknown.argsHash,
    captureIntentHash: unknown.captureIntentHash,
    operationFingerprintHash: unknown.operationFingerprintHash,
    workspaceId: unknown.workspaceId,
    fileExecutionKey: unknown.fileExecutionKey,
    fileExecutionKeyHash: unknown.fileExecutionKeyHash,
    targetBindingHash: unknown.targetBindingHash,
    decision: input.decision,
    resultHash: unknown.resultHash,
    operationEvidenceReceiptHash: unknown.operationEvidenceReceiptHash,
    finalEgressManifestHash: unknown.finalEgressManifestHash,
    reasonHash: input.reasonHash,
    evidenceHash: input.evidenceHash,
    confirmedResultHash: input.confirmedResultHash,
    confirmationHash: input.confirmationHash,
    decidedAt: new Date(decidedAt).toISOString(),
  });

export const createOperationEndpoints = (dependencies: {
  issuer: OperationIdIssuer;
  journal: OperationJournal;
  resolutionIntents: OperationResolutionIntentStore;
  nonceStore: ActionNonceStore;
  now?: () => number;
  cancel?(principal: Readonly<ActorContext>, input: unknown): Promise<void>;
}) => {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    issue: async (principal: Readonly<ActorContext>) => ({
      operationId: dependencies.issuer.issue(principal.actorId, now()),
    }),
    list: async (
      principal: Readonly<ActorContext>,
      input: {
        cursor?: string | undefined;
        limit?: number | undefined;
        status?: OperationStatus | undefined;
      },
    ) => {
      void principal;
      return dependencies.journal.list({
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.status === undefined ? {} : { status: input.status }),
      });
    },
    status: async (
      principal: Readonly<ActorContext>,
      operationId: string,
    ): Promise<OperationRecord | OperationTombstone> => {
      const record = dependencies.journal.get(operationId);
      if (record === undefined || record.actorId !== principal.actorId) {
        throw Object.assign(new Error('operation was not found'), { code: 'OPERATION_NOT_FOUND' });
      }
      return record;
    },
    resolve: async (
      principal: Readonly<ActorContext>,
      operationId: string,
      input: unknown,
    ): Promise<OperationRecord | OperationTombstone> => {
      const request = ResolutionInputSchema.parse(input);
      const current = dependencies.journal.get(operationId);
      if (
        current === undefined ||
        !('sequence' in current) ||
        current.actorId !== principal.actorId ||
        current.status !== 'outcome-unknown'
      ) {
        throw Object.assign(new Error('unknown operation was not found'), {
          code: 'OPERATION_NOT_FOUND',
        });
      }
      const expectedConfirm = `${operationId}/${request.confirmedResultHash ?? 'unknown'}`;
      if (request.confirm !== expectedConfirm) {
        throw Object.assign(new Error('operation resolution confirmation does not match'), {
          code: 'OPERATION_RESOLUTION_CONFIRMATION_INVALID',
        });
      }
      const calculatedConfirmationHash = confirmationHash(request.confirm);
      if (
        request.confirmationHash !== undefined &&
        request.confirmationHash !== calculatedConfirmationHash
      ) {
        throw Object.assign(new Error('operation resolution confirmation hash does not match'), {
          code: 'OPERATION_RESOLUTION_CONFIRMATION_INVALID',
        });
      }
      const semantic = {
        operationId,
        decision: request.decision,
        reasonHash: request.reasonHash as PrefixedSha256,
        evidenceHash: request.evidenceHash as PrefixedSha256,
        confirmedResultHash: request.confirmedResultHash as PrefixedSha256 | null,
        confirmationHash: calculatedConfirmationHash,
      };
      const requestHash = hashActionRequest('operation.resolve', semantic);
      const resolution = createOperationResolutionRecord(current, principal, semantic, now());
      await dependencies.nonceStore.consumeCas(
        principal,
        request.actionNonce,
        'operation.resolve',
        requestHash,
      );
      await dependencies.resolutionIntents.appendAndFsync(resolution);
      return dependencies.journal.mergeResolutionIntent(
        dependencies.resolutionIntents,
        operationId,
      );
    },
    cancel: async (principal: Readonly<ActorContext>, input: unknown): Promise<void> => {
      const request = InvocationCancelV1Schema.parse(input);
      const operation = dependencies.journal.get(request.operationId);
      if (operation === undefined) {
        throw Object.assign(new Error('operation was not found'), { code: 'OPERATION_NOT_FOUND' });
      }
      assertOperationCancellationAuthority(operation, principal);
      if (dependencies.cancel === undefined) {
        throw Object.assign(new Error('runtime cancellation is not integrated until Task7C'), {
          code: 'CANCEL_UNAVAILABLE',
        });
      }
      await dependencies.cancel(principal, request);
    },
  });
};
