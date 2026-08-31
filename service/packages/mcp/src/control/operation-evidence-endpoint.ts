import { createHash } from 'node:crypto';

import {
  OperationEvidenceReceiptV1Schema,
  OperationEvidenceViewV1Schema,
  type ActorContext,
  type EgressFinalizerProjectionV1,
  type OperationEvidenceReceiptStorePort,
  type OperationEvidenceReceiptProjectionV1,
  type OperationEvidenceViewV1,
  type OperationKind,
  type OperationName,
  type OperationStatus,
  type PrefixedSha256,
} from '@sfp/shared';

import { hashOperationFingerprint } from '../execution/operation-journal.js';

interface EvidenceOperation {
  actorId: ActorContext['actorId'];
  operationId: string;
  operationKind: OperationKind;
  operationName: OperationName;
  operationFingerprintHash: PrefixedSha256;
  argsHash?: PrefixedSha256;
  workspaceId?: string | null;
  fileExecutionKeyHash?: PrefixedSha256 | null;
  targetBindingHash?: PrefixedSha256 | null;
  captureIntentHash?: PrefixedSha256;
  leaderGeneration?: string | null;
  resultHash: PrefixedSha256 | null;
  resultBytes?: number | null;
  operationEvidenceReceiptHash: PrefixedSha256 | null;
  finalEgressManifestHash: PrefixedSha256 | null;
  preExecutionConsentManifestHash?: PrefixedSha256 | null;
  status?: OperationStatus;
  decision?: 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
}
const evidenceError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const daemonGenerationHash = (generation: string): PrefixedSha256 =>
  `sha256:${createHash('sha256')
    .update('sfp-daemon-generation-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(generation, 'utf8')
    .digest('hex')}`;

export const createOperationEvidenceEndpoint =
  (dependencies: {
    operations: { get(operationId: string): EvidenceOperation | undefined };
    receipts: Pick<OperationEvidenceReceiptStorePort, 'get'>;
    egress: {
      readVerifiedFinalizer(
        actorId: ActorContext['actorId'],
        operationId: string,
        expectedHash: `sha256:${string}` | null,
      ): Promise<Readonly<EgressFinalizerProjectionV1> | null>;
    };
  }) =>
  async (
    principal: Readonly<ActorContext>,
    operationId: string,
  ): Promise<Readonly<OperationEvidenceViewV1>> => {
    const operation = dependencies.operations.get(operationId);
    if (operation === undefined || operation.actorId !== principal.actorId) {
      throw evidenceError('OPERATION_NOT_FOUND', 'operation evidence was not found');
    }
    if (['pending-approval', 'queued', 'dispatched'].includes(operation.status ?? '')) {
      throw evidenceError('OPERATION_EVIDENCE_UNSETTLED', 'operation is not terminal');
    }
    const status = operation.decision ?? operation.status;
    if (status === undefined) {
      throw evidenceError('OPERATION_EVIDENCE_INVALID', 'operation status is missing');
    }
    const finalizer = await dependencies.egress.readVerifiedFinalizer(
      principal.actorId,
      operationId,
      operation.finalEgressManifestHash,
    );
    const storedReceipt = await dependencies.receipts.get(principal.actorId, operationId);
    const expectsReceipt = status === 'succeeded' || status === 'failed';
    const expectsNoLinks = status === 'pre-egress-rejected';
    if (
      (expectsReceipt && (storedReceipt === null || finalizer === null)) ||
      (expectsNoLinks &&
        (storedReceipt !== null ||
          finalizer !== null ||
          operation.operationEvidenceReceiptHash !== null ||
          operation.finalEgressManifestHash !== null ||
          (operation.preExecutionConsentManifestHash ?? null) !== null)) ||
      (!expectsReceipt && storedReceipt !== null)
    ) {
      throw evidenceError('OPERATION_EVIDENCE_INVALID', 'operation evidence matrix is invalid');
    }
    let receiptProjection: OperationEvidenceViewV1['receipt'] = null;
    if (storedReceipt !== null) {
      const parsed = OperationEvidenceReceiptV1Schema.safeParse(storedReceipt);
      if (!parsed.success) {
        throw evidenceError('OPERATION_EVIDENCE_INVALID', 'stored receipt schema is invalid');
      }
      const receipt = parsed.data;
      const completeFingerprint =
        operation.argsHash !== undefined && operation.captureIntentHash !== undefined;
      if (
        receipt.actorId !== operation.actorId ||
        receipt.operationId !== operation.operationId ||
        receipt.operationKind !== operation.operationKind ||
        receipt.operationName !== operation.operationName ||
        (operation.argsHash !== undefined && receipt.argsHash !== operation.argsHash) ||
        (operation.workspaceId !== undefined && receipt.workspaceId !== operation.workspaceId) ||
        (operation.fileExecutionKeyHash !== undefined &&
          receipt.fileExecutionKeyHash !== operation.fileExecutionKeyHash) ||
        (operation.targetBindingHash !== undefined &&
          receipt.targetBindingHash !== operation.targetBindingHash) ||
        (operation.captureIntentHash !== undefined &&
          receipt.captureIntentHash !== operation.captureIntentHash) ||
        (operation.resultBytes !== undefined && receipt.resultBytes !== operation.resultBytes) ||
        (operation.leaderGeneration !== undefined &&
          operation.leaderGeneration !== null &&
          receipt.daemonGenerationHash !== daemonGenerationHash(operation.leaderGeneration)) ||
        (completeFingerprint &&
          hashOperationFingerprint({
            actorId: operation.actorId,
            operationId: operation.operationId,
            operationKind: operation.operationKind,
            operationName: operation.operationName,
            argsHash: operation.argsHash as PrefixedSha256,
            workspaceId: operation.workspaceId ?? null,
            fileExecutionKeyHash: operation.fileExecutionKeyHash ?? null,
            targetBindingHash: operation.targetBindingHash ?? null,
            captureIntentHash: operation.captureIntentHash as PrefixedSha256,
          }) !== operation.operationFingerprintHash) ||
        receipt.contentHash !== operation.operationEvidenceReceiptHash ||
        receipt.finalizerHash !== operation.finalEgressManifestHash ||
        receipt.finalizerHash !== finalizer?.manifestHash ||
        receipt.terminalStatus !== status ||
        receipt.resultHash !== operation.resultHash ||
        finalizer.resultHash !== operation.resultHash ||
        (operation.preExecutionConsentManifestHash ?? finalizer.preExecutionManifestHash) !==
          finalizer.preExecutionManifestHash
      ) {
        throw evidenceError(
          'OPERATION_EVIDENCE_INVALID',
          'receipt and finalizer links do not match',
        );
      }
      const {
        state: _state,
        actorId: _actorId,
        previousReceiptHash: _previousReceiptHash,
        receiptHash: _receiptHash,
        ...publicReceipt
      } = receipt;
      receiptProjection = Object.freeze(publicReceipt) as OperationEvidenceReceiptProjectionV1;
    } else if (!expectsNoLinks && finalizer === null) {
      throw evidenceError('OPERATION_EVIDENCE_INVALID', 'terminal operation lacks its finalizer');
    }
    if (
      finalizer !== null &&
      (status === 'outcome-unknown' ||
      status === 'resolved-applied' ||
      status === 'resolved-not-applied' ||
      status === 'abandoned'
        ? finalizer.finalStatus !== 'outcome-unknown'
        : status === 'rejected'
          ? finalizer.finalStatus !== 'no-output'
          : false)
    ) {
      throw evidenceError(
        'OPERATION_EVIDENCE_INVALID',
        'finalizer status does not match operation',
      );
    }
    const view = {
      schemaVersion: 1 as const,
      serverVerified: true as const,
      statusProjection: {
        operationId: operation.operationId,
        status,
        operationKind: operation.operationKind,
        operationName: operation.operationName,
        operationFingerprintHash: operation.operationFingerprintHash,
        resultHash: operation.resultHash,
        preExecutionConsentManifestHash:
          operation.preExecutionConsentManifestHash ?? finalizer?.preExecutionManifestHash ?? null,
        operationEvidenceReceiptHash: operation.operationEvidenceReceiptHash,
        finalEgressManifestHash: operation.finalEgressManifestHash,
      },
      receipt: receiptProjection,
      finalizerProjection: finalizer,
    };
    const parsedView = OperationEvidenceViewV1Schema.safeParse(view);
    if (!parsedView.success) {
      throw evidenceError('OPERATION_EVIDENCE_INVALID', 'public evidence projection is invalid');
    }
    return Object.freeze(parsedView.data) as Readonly<OperationEvidenceViewV1>;
  };
