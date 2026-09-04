import { createHash, randomBytes } from 'node:crypto';

import {
  NO_CAPTURE_OPTIONS,
  canonicalFileIdentityHash,
  validateToolInvocationOptions,
  type OperationAlreadySettled,
  type OperationRecord,
  type OperationTombstone,
  type PrefixedSha256,
  type ResolvedInvocationScope,
  type RuntimeExecutionScope,
  type ToolApprovalHandle,
  type ToolInvocationOptionsV1,
  type ToolName,
  type EgressManifestPort,
  type EgressReservation,
  type InvocationFrameV1,
  type NativeEvidenceV1,
  type OperationEvidenceArtifactPort,
  type OperationEvidenceReceiptStorePort,
  type OutputEgressManifest,
  OPERATION_EVIDENCE_LIMITS,
  type InvocationCancelV1,
  type NativeEvidenceArtifactPortContract,
  type OperationEvidenceProjector,
  type PreExecutionConsentManifest,
  type ProgressReporter,
} from '@sfp/shared';

import {
  createNoOutputEgressManifest,
  createOutcomeUnknownEgressManifest,
  createOutputEgressManifest,
  createPreExecutionConsentManifest,
} from '../policy/egress-policy.js';
import { evaluateOperationPolicy } from '../policy/policy-engine.js';
import { resultEgressPolicyFor } from '../policy/result-egress-policy.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';
import { executeToolRuntime, type RuntimeRegistry } from '../tools/runtime-registry.js';
import type { EgressOperationState } from './egress-manifest-store.js';
import type { FileExecutionQueue } from './file-queue.js';
import type {
  PreRuntimeCrashReservation,
  PreRuntimeReservationClassification,
  PreRuntimeReservationClassifier,
} from './operation-evidence-receipt-store.js';
import type { OperationIdIssuer } from './operation-id.js';
import {
  hashOperationFingerprint,
  type LeaderDemotionCapability,
  type NewOperationRecord,
  type OperationJournal,
} from './operation-journal.js';

export interface OperationJournalPort {
  appendInitial(
    record: NewOperationRecord,
    status: OperationRecord['status'],
    options?: { leaderGeneration?: string; errorCode?: string },
  ): Promise<OperationRecord>;
  transition(
    operationId: string,
    status: OperationRecord['status'],
    patch?: Partial<
      Pick<
        OperationRecord,
        | 'resultHash'
        | 'resultBytes'
        | 'errorCode'
        | 'preExecutionConsentManifestHash'
        | 'finalEgressManifestHash'
        | 'operationEvidenceReceiptHash'
      >
    >,
    options?: { expectedLeaderGeneration?: string; allowFenced?: boolean },
  ): Promise<OperationRecord>;
  get(operationId: string): OperationRecord | OperationTombstone | undefined;
  transitionDemotion?(
    capability: LeaderDemotionCapability,
    operationId: string,
    status: 'pre-egress-rejected' | 'succeeded' | 'failed' | 'outcome-unknown',
    patch?: Parameters<OperationJournalPort['transition']>[2],
  ): Promise<OperationRecord>;
}

export interface OperationExecutorOptions {
  issuer: OperationIdIssuer;
  journal: OperationJournalPort | OperationJournal;
  queue: FileExecutionQueue;
  runtimes: RuntimeRegistry;
  now?: () => number;
  replayAudit?: (record: Readonly<Record<string, unknown>>) => void;
  durability?: OperationDurabilityPorts;
}

export interface OperationDurabilityPorts {
  egress: EgressManifestPort;
  receipts: OperationEvidenceReceiptStorePort;
  artifacts: OperationEvidenceArtifactPort & {
    preflight?(
      workspaceId: string,
      intent: import('@sfp/shared').VerifiedCaptureIntentV1,
    ): Promise<string | null>;
  };
  projector: OperationEvidenceProjector;
  nativeArtifacts: NativeEvidenceArtifactPortContract;
  afterEvidenceReservationFsync?: () => Promise<void>;
}

interface PreparedInvocation {
  scope: ResolvedInvocationScope;
  toolName: ToolName;
  parsedArgs: Readonly<Record<string, unknown>>;
  operationId: string;
  issuedAt: number;
  options: Readonly<ToolInvocationOptionsV1>;
  argsHash: PrefixedSha256;
  fileExecutionKeyHash: PrefixedSha256 | null;
  targetBindingHash: PrefixedSha256 | null;
  captureIntentHash: PrefixedSha256;
  operationFingerprintHash: PrefixedSha256;
}

type PreparedRuntimeInvocation = PreparedInvocation & { scope: RuntimeExecutionScope };

interface ApprovalBinding {
  prepared: PreparedInvocation;
}

interface InflightOperation {
  fingerprintHash: PrefixedSha256;
  promise: Promise<unknown>;
}

interface CompletedCacheEntry {
  operationId: string;
  canonicalRedactedResultBytes: Uint8Array;
  resultSchemaHash: PrefixedSha256;
  consentFingerprintHash: PrefixedSha256;
  expiresAt: number;
  touchedAt: number;
}

interface PreparedDurability {
  preManifest: Readonly<PreExecutionConsentManifest>;
  egressReservation: EgressReservation;
  evidenceReservationId: string;
}

interface ReservationFailureSettlement {
  preManifestHash: PrefixedSha256;
  finalEgressManifestHash: PrefixedSha256 | null;
  status: 'rejected' | 'outcome-unknown';
}

interface CancellationState {
  operationId: string;
  principal: Readonly<import('@sfp/shared').ActorContext>;
  requestId: string;
  leaderGeneration: string;
  controller: AbortController;
  durability: PreparedDurability | null;
  dispatched: boolean;
  actionNonce: string;
  demoting: boolean;
  prepared: PreparedInvocation;
  demotionSettlement: Promise<void> | null;
  terminalClaimed: boolean;
  terminalSettlement: Promise<void>;
  settleTerminal(): void;
}

const zero = Buffer.from([0]);
const cacheMaximumEntries = 128;
const cacheMaximumBytes = 8_388_608;
const cacheTtlMilliseconds = 60_000;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Uint8Array) return canonicalJson([...value]);
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('value is not canonical JSON');
  return encoded;
};

const hash = (domain: string | null, value: string | Uint8Array): PrefixedSha256 => {
  const digest = createHash('sha256');
  if (domain !== null) digest.update(domain, 'utf8').update(zero);
  digest.update(value);
  return `sha256:${digest.digest('hex')}`;
};

const terminalStatus = (
  status: OperationRecord['status'],
): status is OperationAlreadySettled['status'] =>
  !['pending-approval', 'queued', 'dispatched'].includes(status);

const settledError = (
  record: OperationRecord | OperationTombstone,
): Error & OperationAlreadySettled => {
  if (!terminalStatus(record.status)) {
    throw Object.assign(new Error('operation is still in progress'), {
      code: 'OPERATION_IN_PROGRESS',
      status: record.status,
      operationId: record.operationId,
    });
  }
  return Object.assign(new Error('operation is already settled'), {
    code: 'OPERATION_ALREADY_SETTLED' as const,
    status: record.status,
    actorId: record.actorId,
    operationId: record.operationId,
    resultHash: record.resultHash,
    resultBytes: 'resultBytes' in record ? record.resultBytes : null,
    settledAt:
      'settledAt' in record && typeof record.settledAt === 'string'
        ? record.settledAt
        : 'createdAt' in record
          ? record.createdAt
          : new Date(record.issuedAt).toISOString(),
  });
};

export class OperationIdConflictError extends Error {
  readonly code = 'OPERATION_ID_CONFLICT';

  constructor() {
    super('operation ID is already bound to a different invocation fingerprint');
    this.name = 'OperationIdConflictError';
  }
}

interface DurableOperationFinalizerDependencies {
  artifacts: Pick<OperationEvidenceArtifactPort, 'createNew'>;
  receipts: Pick<OperationEvidenceReceiptStorePort, 'prepareAndFsync'>;
  egress: Pick<EgressManifestPort, 'finalize'>;
  journal: Pick<OperationJournalPort, 'transition' | 'transitionDemotion'>;
  emitTerminal(frame: InvocationFrameV1): Promise<void>;
}

export class DurableOperationFinalizer {
  private readonly terminalClaims = new Set<string>();

  constructor(private readonly dependencies: DurableOperationFinalizerDependencies) {}

  async succeed(input: {
    actorId: `actor1_${string}`;
    operationId: string;
    operationKind: 'tool' | 'service' | 'system';
    operationName: ToolName | import('@sfp/shared').ServiceOperationName | 'identity.bootstrap';
    argsHash: PrefixedSha256;
    workspaceId: string | null;
    fileExecutionKeyHash: PrefixedSha256 | null;
    targetBindingHash: PrefixedSha256 | null;
    captureIntentHash: PrefixedSha256;
    captureIntent: import('@sfp/shared').VerifiedCaptureIntentV1;
    canonicalRedactedBytes: Uint8Array;
    resultSchemaHash: PrefixedSha256;
    resultHash: PrefixedSha256;
    nativeEvidence: NativeEvidenceV1;
    daemonGenerationHash: PrefixedSha256;
    leaderGeneration?: string;
    evidenceReservationId: string;
    egressReservation: EgressReservation;
    outputManifest: OutputEgressManifest;
    completedAt: string;
    requestId: `sfp_req1_${string}`;
    result: unknown;
  }): Promise<void> {
    if (this.terminalClaims.has(input.operationId)) {
      throw Object.assign(new Error('operation terminal was already claimed'), {
        code: 'TERMINAL_ALREADY_SETTLED',
      });
    }
    this.terminalClaims.add(input.operationId);
    const artifact = input.captureIntent.captureResult
      ? await this.dependencies.artifacts.createNew({
          workspaceId: input.workspaceId as string,
          operationId: input.operationId,
          intent: input.captureIntent,
          canonicalRedactedBytes: input.canonicalRedactedBytes,
          resultSchemaHash: input.resultSchemaHash,
          resultHash: input.resultHash,
        })
      : null;
    const receipt = await this.dependencies.receipts.prepareAndFsync(input.evidenceReservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId: input.actorId,
      operationId: input.operationId,
      operationKind: input.operationKind,
      operationName: input.operationName,
      argsHash: input.argsHash,
      workspaceId: input.workspaceId,
      fileExecutionKeyHash: input.fileExecutionKeyHash,
      targetBindingHash: input.targetBindingHash,
      captureIntentHash: input.captureIntentHash,
      captureResult: input.captureIntent.captureResult,
      finalizerHash: input.outputManifest.manifestHash,
      daemonGenerationHash: input.daemonGenerationHash,
      completedAt: input.completedAt,
      terminalStatus: 'succeeded',
      resultHash: input.resultHash,
      resultBytes: input.canonicalRedactedBytes.byteLength,
      resultArtifact: artifact,
      nativeEvidence: input.nativeEvidence,
    } as never);
    const finalized = await this.dependencies.egress.finalize(
      input.egressReservation,
      input.outputManifest,
    );
    if (finalized.finalManifestHash !== receipt.finalizerHash) {
      throw Object.assign(new Error('receipt and egress finalizer do not match'), {
        code: 'EVIDENCE_FINALIZER_MISMATCH',
      });
    }
    await this.terminalTransition(
      input.operationId,
      'succeeded',
      {
        resultHash: input.resultHash,
        resultBytes: input.canonicalRedactedBytes.byteLength,
        preExecutionConsentManifestHash: input.egressReservation.preManifestHash,
        operationEvidenceReceiptHash: receipt.contentHash,
        finalEgressManifestHash: finalized.finalManifestHash,
      },
      input.leaderGeneration,
    );
    await this.dependencies.emitTerminal({
      version: 1,
      type: 'result',
      requestId: input.requestId,
      operationId: input.operationId,
      result: input.result,
    });
  }

  async recoverDispatched(input: {
    operationId: string;
    record?: Readonly<OperationRecord>;
    preparedReceipt: Readonly<import('@sfp/shared').OperationEvidenceReceiptV1> | null;
    verifiedFinalizer: Readonly<import('@sfp/shared').EgressFinalizerProjectionV1> | null;
    capability?: LeaderDemotionCapability;
  }): Promise<'succeeded' | 'failed' | 'outcome-unknown'> {
    const receipt = input.preparedReceipt;
    const record = input.record;
    const identityMismatch =
      receipt !== null &&
      record !== undefined &&
      (receipt.actorId !== record.actorId ||
        receipt.operationId !== record.operationId ||
        receipt.operationKind !== record.operationKind ||
        receipt.operationName !== record.operationName ||
        receipt.argsHash !== record.argsHash ||
        receipt.workspaceId !== record.workspaceId ||
        receipt.fileExecutionKeyHash !== record.fileExecutionKeyHash ||
        receipt.targetBindingHash !== record.targetBindingHash ||
        receipt.captureIntentHash !== record.captureIntentHash ||
        record.operationFingerprintHash !== hashOperationFingerprint(record) ||
        (record.preExecutionConsentManifestHash !== null &&
          input.verifiedFinalizer?.preExecutionManifestHash !==
            record.preExecutionConsentManifestHash) ||
        (record.leaderGeneration !== null &&
          record.leaderGeneration !== undefined &&
          receipt.daemonGenerationHash !==
            hash('sfp-daemon-generation-v1', record.leaderGeneration)));
    if (
      receipt === null ||
      input.verifiedFinalizer === null ||
      identityMismatch ||
      receipt.finalizerHash !== input.verifiedFinalizer.manifestHash ||
      (receipt.terminalStatus === 'succeeded'
        ? input.verifiedFinalizer.finalStatus !== 'output' ||
          receipt.resultHash !== input.verifiedFinalizer.resultHash
        : input.verifiedFinalizer.finalStatus !== 'no-output' ||
          input.verifiedFinalizer.resultHash !== null)
    ) {
      await this.terminalTransition(
        input.operationId,
        'outcome-unknown',
        {
          errorCode: 'EVIDENCE_FINALIZER_MISSING',
          resultHash: null,
          resultBytes: null,
          operationEvidenceReceiptHash: null,
          finalEgressManifestHash: null,
        },
        input.record?.leaderGeneration ?? undefined,
        input.capability,
      );
      return 'outcome-unknown';
    }
    await this.terminalTransition(
      input.operationId,
      receipt.terminalStatus,
      {
        resultHash: receipt.resultHash,
        resultBytes: receipt.resultBytes,
        operationEvidenceReceiptHash: receipt.contentHash,
        finalEgressManifestHash: input.verifiedFinalizer.manifestHash,
      },
      input.record?.leaderGeneration ?? undefined,
      input.capability,
    );
    return receipt.terminalStatus;
  }

  async fail(input: {
    actorId: `actor1_${string}`;
    operationId: string;
    operationKind: 'tool' | 'service' | 'system';
    operationName: ToolName | import('@sfp/shared').ServiceOperationName | 'identity.bootstrap';
    argsHash: PrefixedSha256;
    workspaceId: string | null;
    fileExecutionKeyHash: PrefixedSha256 | null;
    targetBindingHash: PrefixedSha256 | null;
    captureIntentHash: PrefixedSha256;
    daemonGenerationHash: PrefixedSha256;
    leaderGeneration?: string;
    evidenceReservationId: string;
    egressReservation: EgressReservation;
    noOutputManifest: import('@sfp/shared').NoOutputEgressManifest;
    completedAt: string;
    errorCode: string;
  }): Promise<void> {
    if (this.terminalClaims.has(input.operationId)) {
      throw Object.assign(new Error('operation terminal was already claimed'), {
        code: 'TERMINAL_ALREADY_SETTLED',
      });
    }
    this.terminalClaims.add(input.operationId);
    const receipt = await this.dependencies.receipts.prepareAndFsync(input.evidenceReservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId: input.actorId,
      operationId: input.operationId,
      operationKind: input.operationKind,
      operationName: input.operationName,
      argsHash: input.argsHash,
      workspaceId: input.workspaceId,
      fileExecutionKeyHash: input.fileExecutionKeyHash,
      targetBindingHash: input.targetBindingHash,
      captureIntentHash: input.captureIntentHash,
      captureResult: false,
      finalizerHash: input.noOutputManifest.manifestHash,
      daemonGenerationHash: input.daemonGenerationHash,
      completedAt: input.completedAt,
      terminalStatus: 'failed',
      resultHash: null,
      resultBytes: 0,
      resultArtifact: null,
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'operation-failed' },
    } as never);
    const finalized = await this.dependencies.egress.finalize(
      input.egressReservation,
      input.noOutputManifest,
    );
    if (finalized.finalManifestHash !== receipt.finalizerHash) {
      throw Object.assign(new Error('failed receipt and finalizer do not match'), {
        code: 'EVIDENCE_FINALIZER_MISMATCH',
      });
    }
    await this.terminalTransition(
      input.operationId,
      'failed',
      {
        resultHash: null,
        resultBytes: 0,
        errorCode: input.errorCode,
        preExecutionConsentManifestHash: input.egressReservation.preManifestHash,
        operationEvidenceReceiptHash: receipt.contentHash,
        finalEgressManifestHash: finalized.finalManifestHash,
      },
      input.leaderGeneration,
    );
  }

  private terminalTransition(
    operationId: string,
    status: OperationRecord['status'],
    patch: Parameters<OperationJournalPort['transition']>[2],
    leaderGeneration?: string,
    capability?: LeaderDemotionCapability,
  ): Promise<OperationRecord> {
    if (capability !== undefined && this.dependencies.journal.transitionDemotion !== undefined) {
      if (status !== 'succeeded' && status !== 'failed' && status !== 'outcome-unknown') {
        throw Object.assign(new Error('recovery terminal status is invalid'), {
          code: 'JOURNAL_TRANSITION_INVALID',
        });
      }
      return this.dependencies.journal.transitionDemotion(capability, operationId, status, patch);
    }
    const journalSupportsGenerationCas =
      typeof (this.dependencies.journal as { fenceLeaderGeneration?: unknown })
        .fenceLeaderGeneration === 'function';
    return leaderGeneration === undefined || !journalSupportsGenerationCas
      ? this.dependencies.journal.transition(operationId, status, patch)
      : this.dependencies.journal.transition(operationId, status, patch, {
          expectedLeaderGeneration: leaderGeneration,
        });
  }
}

const classifyArtifactSideEffect = async (
  workspaceId: string | null | undefined,
  operationId: string,
  probe: (workspaceId: string, operationId: string) => Promise<boolean>,
): Promise<Readonly<{ kind: 'absent' | 'present' | 'unknown' }>> =>
  workspaceId === undefined
    ? Object.freeze({ kind: 'unknown' })
    : workspaceId === null
      ? Object.freeze({ kind: 'absent' })
      : Object.freeze({ kind: (await probe(workspaceId, operationId)) ? 'present' : 'absent' });

const createPreRuntimeCrashSettlement = (
  input: {
    egress: Pick<EgressManifestPort, 'finalize'>;
    journal: Pick<OperationJournal, 'get' | 'appendInitial' | 'transition'>;
  },
  reservation: Readonly<PreRuntimeCrashReservation>,
  egressState: EgressOperationState,
  afterPreRuntimeFinalizerFsync?: () => Promise<void>,
): PreRuntimeReservationClassification['settlement'] => {
  const authority = reservation.operationAuthority;
  if (authority === undefined || egressState.kind === 'absent') return undefined;
  if (
    egressState.kind === 'final' &&
    (egressState.finalizer.finalStatus !== 'no-output' ||
      (egressState.finalizer.reasonCode !== 'admission-rejected' &&
        egressState.finalizer.reasonCode !== 'cancelled') ||
      egressState.finalizer.resultHash !== null)
  ) {
    return undefined;
  }
  const reasonCode =
    egressState.kind === 'final' && egressState.finalizer.reasonCode === 'cancelled'
      ? 'cancelled'
      : 'admission-rejected';
  const noOutput = createNoOutputEgressManifest({
    preExecutionManifestHash: egressState.preExecutionManifestHash,
    reasonCode,
  });
  if (
    egressState.kind === 'final' &&
    egressState.finalizer.manifestHash !== noOutput.manifestHash
  ) {
    return undefined;
  }
  const intent = Object.freeze({
    kind: 'pre-runtime-no-output' as const,
    operationFingerprintHash: authority.operationFingerprintHash,
    preExecutionManifestHash: egressState.preExecutionManifestHash,
    finalEgressManifestHash: noOutput.manifestHash,
  });
  return Object.freeze({
    intent,
    settle: async () => {
      const finalized = await input.egress.finalize(egressState.reservation, noOutput);
      await afterPreRuntimeFinalizerFsync?.();
      if (finalized.finalManifestHash !== intent.finalEgressManifestHash) {
        throw Object.assign(
          new Error('pre-runtime finalizer hash does not match recovery intent'),
          {
            code: 'PRE_RUNTIME_RECOVERY_CONFLICT',
          },
        );
      }
      let current = input.journal.get(reservation.operationId);
      if (current === undefined) {
        await input.journal.appendInitial(
          {
            ...authority,
            leaderGeneration: null,
            resultHash: null,
            resultBytes: null,
            preExecutionConsentManifestHash: intent.preExecutionManifestHash,
            finalEgressManifestHash: null,
            operationEvidenceReceiptHash: null,
          },
          'queued',
        );
        current = input.journal.get(reservation.operationId);
      }
      if (
        current === undefined ||
        current.actorId !== authority.actorId ||
        current.operationId !== authority.operationId ||
        current.operationFingerprintHash !== authority.operationFingerprintHash
      ) {
        throw Object.assign(new Error('journal state conflicts with pre-runtime recovery intent'), {
          code: 'OPERATION_ID_CONFLICT',
        });
      }
      if (
        current.status === 'rejected' &&
        current.finalEgressManifestHash === intent.finalEgressManifestHash &&
        current.operationEvidenceReceiptHash === null
      ) {
        return;
      }
      if (
        !('sequence' in current) ||
        current.status !== 'queued' ||
        current.preExecutionConsentManifestHash !== intent.preExecutionManifestHash ||
        current.finalEgressManifestHash !== null ||
        current.operationEvidenceReceiptHash !== null
      ) {
        throw Object.assign(new Error('journal state contradicts pre-runtime recovery intent'), {
          code: 'PRE_RUNTIME_RECOVERY_CONFLICT',
        });
      }
      await input.journal.transition(reservation.operationId, 'rejected', {
        errorCode:
          reasonCode === 'cancelled'
            ? 'OPERATION_CANCELLED'
            : 'OPERATION_PRE_RUNTIME_CRASH_RECOVERED',
        resultHash: null,
        resultBytes: null,
        preExecutionConsentManifestHash: intent.preExecutionManifestHash,
        finalEgressManifestHash: intent.finalEgressManifestHash,
        operationEvidenceReceiptHash: null,
      });
    },
  });
};

export const recoverDurableOperationState = async (input: {
  actorId: `actor1_${string}`;
  now: number;
  egress: Pick<EgressManifestPort, 'recover' | 'readVerifiedFinalizer' | 'finalize'> & {
    classifyOperationState?(
      actorId: `actor1_${string}`,
      operationId: string,
    ): Promise<EgressOperationState>;
    hasFinalizer?(actorId: `actor1_${string}`, operationId: string): Promise<boolean>;
  };
  receipts: Pick<OperationEvidenceReceiptStorePort, 'recover' | 'get'> & {
    listPreRuntimeReservationOperationIds?(): readonly string[];
    recoverPreRuntimeReservations?(classify: PreRuntimeReservationClassifier): Promise<void>;
  };
  journal: Pick<
    OperationJournal,
    | 'recover'
    | 'listDispatched'
    | 'recoverLeaderDemotionCapability'
    | 'get'
    | 'appendInitial'
    | 'transition'
    | 'recoverPreservedQueued'
  >;
  finalizer: Pick<DurableOperationFinalizer, 'recoverDispatched'>;
  deferTombstonePurge?: boolean;
  preRuntimeReservationRecovery?: {
    hasResultArtifactSideEffect(workspaceId: string, operationId: string): Promise<boolean>;
    hasNativeArtifactSideEffect(workspaceId: string, operationId: string): Promise<boolean>;
    afterPreRuntimeFinalizerFsync?: () => Promise<void>;
  };
  onPhase?: (phase: 'egress' | 'receipts' | 'journal' | 'reconcile' | 'pre-runtime') => void;
}): Promise<void> => {
  input.onPhase?.('egress');
  await input.egress.recover(input.now);
  input.onPhase?.('receipts');
  await input.receipts.recover();
  let preRuntime:
    | Readonly<{
        operationIds: ReadonlySet<string>;
        classifyEgress: NonNullable<typeof input.egress.classifyOperationState>;
        hasFinalizer: NonNullable<typeof input.egress.hasFinalizer>;
        recoverReservations: NonNullable<typeof input.receipts.recoverPreRuntimeReservations>;
        recovery: NonNullable<typeof input.preRuntimeReservationRecovery>;
      }>
    | undefined;
  if (input.preRuntimeReservationRecovery !== undefined) {
    const listOperationIds = input.receipts.listPreRuntimeReservationOperationIds;
    const classifyEgress = input.egress.classifyOperationState;
    const hasFinalizer = input.egress.hasFinalizer;
    const recoverReservations = input.receipts.recoverPreRuntimeReservations;
    if (
      listOperationIds === undefined ||
      classifyEgress === undefined ||
      hasFinalizer === undefined ||
      recoverReservations === undefined
    ) {
      throw Object.assign(new Error('pre-runtime reservation recovery authority is unavailable'), {
        code: 'PRE_RUNTIME_RECOVERY_UNAVAILABLE',
      });
    }
    preRuntime = Object.freeze({
      operationIds: new Set(listOperationIds.call(input.receipts)),
      classifyEgress,
      hasFinalizer,
      recoverReservations,
      recovery: input.preRuntimeReservationRecovery,
    });
  }
  input.onPhase?.('journal');
  await input.journal.recover({
    deferDispatched: true,
    deferTombstonePurge: input.deferTombstonePurge === true,
    ...(preRuntime === undefined ? {} : { preserveQueuedOperationIds: preRuntime.operationIds }),
  });
  if (preRuntime !== undefined) {
    input.onPhase?.('pre-runtime');
    await preRuntime.recoverReservations.call(input.receipts, async reservation => {
      const journalRecord = input.journal.get(reservation.operationId);
      const egressState = await preRuntime.classifyEgress.call(
        input.egress,
        input.actorId,
        reservation.operationId,
      );
      const finalizerPresent = await preRuntime.hasFinalizer.call(
        input.egress,
        input.actorId,
        reservation.operationId,
      );
      const resultArtifact = await classifyArtifactSideEffect(
        reservation.workspaceId,
        reservation.operationId,
        preRuntime.recovery.hasResultArtifactSideEffect,
      );
      const nativeArtifact = await classifyArtifactSideEffect(
        reservation.workspaceId,
        reservation.operationId,
        preRuntime.recovery.hasNativeArtifactSideEffect,
      );
      const journal: PreRuntimeReservationClassification['journal'] =
        journalRecord === undefined
          ? Object.freeze({ kind: 'absent' })
          : Object.freeze({
              kind: 'present',
              recordKind: 'sequence' in journalRecord ? 'active' : 'tombstone',
              status: journalRecord.status,
              operationFingerprintHash: journalRecord.operationFingerprintHash,
              preExecutionManifestHash:
                'preExecutionConsentManifestHash' in journalRecord
                  ? journalRecord.preExecutionConsentManifestHash
                  : null,
              finalEgressManifestHash: journalRecord.finalEgressManifestHash,
              operationEvidenceReceiptHash: journalRecord.operationEvidenceReceiptHash,
            });
      const egress: PreRuntimeReservationClassification['egress'] =
        egressState.kind === 'absent'
          ? Object.freeze({ kind: 'absent' })
          : egressState.kind === 'pre-only'
            ? Object.freeze({
                kind: 'pre-only',
                preExecutionManifestHash: egressState.preExecutionManifestHash,
              })
            : Object.freeze({
                kind: 'final',
                preExecutionManifestHash: egressState.preExecutionManifestHash,
                finalEgressManifestHash: egressState.finalizer.manifestHash,
                finalStatus: egressState.finalizer.finalStatus,
                reasonCode: egressState.finalizer.reasonCode,
              });
      const settlement = createPreRuntimeCrashSettlement(
        input,
        reservation,
        egressState,
        preRuntime.recovery.afterPreRuntimeFinalizerFsync,
      );
      return Object.freeze({
        journal,
        egress,
        receipt: Object.freeze({ kind: 'absent' }),
        finalizer: Object.freeze({ kind: finalizerPresent ? 'present' : 'absent' }),
        resultArtifact,
        nativeArtifact,
        settlement,
      });
    });
    await input.journal.recoverPreservedQueued(preRuntime.operationIds);
  }
  input.onPhase?.('reconcile');
  /* eslint-disable no-await-in-loop -- recovery terminal transitions extend one ordered journal */
  for (const record of input.journal.listDispatched()) {
    const capability =
      record.leaderGeneration == null
        ? null
        : await input.journal.recoverLeaderDemotionCapability(record.leaderGeneration);
    const receipt = await input.receipts.get(input.actorId, record.operationId);
    let finalizer: Readonly<import('@sfp/shared').EgressFinalizerProjectionV1> | null = null;
    if (receipt !== null) {
      try {
        finalizer = await input.egress.readVerifiedFinalizer(
          input.actorId,
          record.operationId,
          receipt.finalizerHash,
        );
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'EGRESS_FINALIZER_MISSING'
        ) {
          throw error;
        }
      }
    }
    await input.finalizer.recoverDispatched({
      operationId: record.operationId,
      record,
      preparedReceipt: receipt,
      verifiedFinalizer: finalizer,
      ...(capability === null ? {} : { capability }),
    });
  }
  /* eslint-enable no-await-in-loop */
};

export class OperationExecutor {
  private readonly inflight = new Map<string, InflightOperation>();
  private readonly completed = new Map<string, CompletedCacheEntry>();
  private readonly approvals = new WeakMap<object, ApprovalBinding>();
  private readonly activeControllers = new Map<string, CancellationState>();
  private readonly durableFinalizer: DurableOperationFinalizer | null;
  private completedBytes = 0;
  private readonly now: () => number;

  constructor(private readonly options: OperationExecutorOptions) {
    this.now = options.now ?? Date.now;
    this.durableFinalizer =
      options.durability === undefined
        ? null
        : new DurableOperationFinalizer({
            artifacts: options.durability.artifacts,
            receipts: options.durability.receipts,
            egress: options.durability.egress,
            journal: options.journal,
            emitTerminal: async () => undefined,
          });
  }

  async cancel(
    principal: Readonly<import('@sfp/shared').ActorContext>,
    request: Readonly<InvocationCancelV1>,
  ): Promise<void> {
    const active = this.activeControllers.get(request.operationId);
    if (active === undefined) {
      const existing = this.options.journal.get(request.operationId);
      if (existing === undefined || existing.actorId !== principal.actorId) {
        throw Object.assign(new Error('operation was not found'), { code: 'OPERATION_NOT_FOUND' });
      }
      if (existing.originAuthSessionId !== principal.authSessionId) {
        throw Object.assign(new Error('cancel is bound to the origin auth session'), {
          code: 'CANCEL_AUTH_SESSION_MISMATCH',
        });
      }
      return;
    }
    if (
      active.principal.actorId !== principal.actorId ||
      active.principal.authSessionId !== principal.authSessionId ||
      active.requestId !== request.requestId
    ) {
      throw Object.assign(new Error('cancel is bound to the origin request session'), {
        code: 'CANCEL_AUTH_SESSION_MISMATCH',
      });
    }
    if (active.terminalClaimed) {
      await active.terminalSettlement;
      return;
    }
    if (!active.controller.signal.aborted) {
      active.controller.abort(
        Object.assign(new Error('operation cancelled'), { code: 'OPERATION_CANCELLED' }),
      );
    }
    const current = this.options.journal.get(request.operationId);
    if (current === undefined || !('originAuthSessionId' in current)) return;
    if (current.status === 'pending-approval' || current.status === 'queued') {
      await this.settlePreDispatchCancellation(active, current.status);
      this.activeControllers.delete(request.operationId);
    }
  }

  async demoteGeneration(
    leaderGeneration: string,
    capability?: LeaderDemotionCapability,
  ): Promise<void> {
    const operationIds = new Set<string>();
    /* eslint-disable no-await-in-loop -- demotion settlements extend one ordered durable chain */
    for (const state of this.activeControllers.values()) {
      if (state.leaderGeneration !== leaderGeneration) continue;
      if (state.terminalClaimed) {
        await state.terminalSettlement;
        continue;
      }
      state.demoting = true;
      operationIds.add(state.operationId);
      let settle!: () => void;
      let rejectSettlement!: (error: unknown) => void;
      state.demotionSettlement = new Promise<void>((resolve, reject) => {
        settle = resolve;
        rejectSettlement = reject;
      });
      if (!state.controller.signal.aborted) {
        state.controller.abort(
          Object.assign(new Error('leader generation is closing'), {
            code: 'LEADER_GENERATION_CLOSED',
          }),
        );
      }
      try {
        const current = this.options.journal.get(state.operationId);
        if (current?.status === 'pending-approval' || current?.status === 'queued') {
          await this.settlePreDispatchCancellation(
            state,
            current.status,
            'LEADER_GENERATION_CLOSED',
            capability,
          );
          this.activeControllers.delete(state.operationId);
        } else if (current?.status === 'dispatched') {
          if (state.durability === null) {
            await this.demotionTransition(capability, state.prepared, 'outcome-unknown', {
              errorCode: 'LEADER_GENERATION_CLOSED',
            });
          } else {
            await this.reconcileFencedDispatched(state, current, capability);
          }
        }
        settle();
      } catch (error) {
        rejectSettlement(error);
        throw error;
      }
    }
    /* eslint-enable no-await-in-loop */
    await Promise.allSettled(
      [...this.inflight.entries()]
        .filter(([key]) => [...operationIds].some(operationId => key.endsWith(`\0${operationId}`)))
        .map(([, operation]) => operation.promise),
    );
  }

  invokeTool(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    rawArgs: unknown,
    suppliedOperationId?: string,
    invocationOptions: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    let prepared: PreparedRuntimeInvocation;
    try {
      prepared = this.prepare(scope, toolName, rawArgs, suppliedOperationId, invocationOptions);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = `${scope.actor.actorId}\0${prepared.operationId}`;
    const active = this.inflight.get(key);
    if (active !== undefined) {
      return active.fingerprintHash === prepared.operationFingerprintHash
        ? active.promise
        : Promise.reject(new OperationIdConflictError());
    }
    const existing = this.options.journal.get(prepared.operationId);
    if (existing !== undefined) return this.replayOrReject(prepared, existing, key);

    this.ensureCancellationState(prepared);
    const promise = this.executeNew(prepared, key, reporter);
    this.inflight.set(key, { fingerprintHash: prepared.operationFingerprintHash, promise });
    void promise
      .finally(() => {
        const current = this.inflight.get(key);
        if (current?.promise === promise) this.inflight.delete(key);
      })
      .catch(() => {});
    return promise;
  }

  async beginToolApproval(
    scope: ResolvedInvocationScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId: string,
    approvalId: string,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
  ): Promise<ToolApprovalHandle> {
    if (typeof approvalId !== 'string' || approvalId.length === 0 || approvalId.length > 256) {
      throw Object.assign(new Error('approval ID is invalid'), { code: 'APPROVAL_ID_INVALID' });
    }
    const prepared = this.prepare(scope, toolName, rawArgs, operationId, options);
    this.ensureCancellationState(prepared);
    const existing = this.options.journal.get(prepared.operationId);
    if (existing !== undefined) {
      if (
        existing.actorId !== prepared.scope.actor.actorId ||
        existing.operationFingerprintHash !== prepared.operationFingerprintHash ||
        existing.status !== 'pending-approval' ||
        existing.approvalId !== approvalId
      ) {
        throw new OperationIdConflictError();
      }
    } else {
      const policy = evaluateOperationPolicy(toolName, prepared.parsedArgs, prepared.scope);
      await this.options.journal.appendInitial(
        this.initialRecord(prepared, policy, approvalId),
        'pending-approval',
        { leaderGeneration: prepared.scope.leaderGeneration },
      );
    }
    const handle = Object.freeze({}) as ToolApprovalHandle;
    this.approvals.set(handle, { prepared });
    return handle;
  }

  async rejectToolBeforeEgress(
    scope: ResolvedInvocationScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId: string,
    errorCode: string,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
  ): Promise<OperationRecord> {
    if (errorCode.length === 0 || errorCode.length > 256) {
      throw Object.assign(new Error('pre-egress terminal code is invalid'), {
        code: 'PRE_EGRESS_TERMINAL_INVALID',
      });
    }
    const prepared = this.prepare(scope, toolName, rawArgs, operationId, options);
    const existing = this.options.journal.get(operationId);
    if (existing !== undefined) {
      if (
        existing.actorId !== prepared.scope.actor.actorId ||
        existing.operationFingerprintHash !== prepared.operationFingerprintHash
      ) {
        throw new OperationIdConflictError();
      }
      if (terminalStatus(existing.status)) throw settledError(existing);
      throw Object.assign(new Error('operation is still in progress'), {
        code: 'OPERATION_IN_PROGRESS',
        status: existing.status,
        operationId,
      });
    }
    const policy = evaluateOperationPolicy(toolName, prepared.parsedArgs, prepared.scope);
    return this.options.journal.appendInitial(
      this.initialRecord(prepared, policy, null),
      'pre-egress-rejected',
      { leaderGeneration: prepared.scope.leaderGeneration, errorCode },
    );
  }

  async resumeApprovedTool(
    handle: ToolApprovalHandle,
    scope: RuntimeExecutionScope,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    const binding = this.consumeApproval(handle);
    const prepared = this.prepare(
      scope,
      binding.prepared.toolName,
      binding.prepared.parsedArgs,
      binding.prepared.operationId,
      binding.prepared.options,
    );
    if (prepared.operationFingerprintHash !== binding.prepared.operationFingerprintHash) {
      throw new OperationIdConflictError();
    }
    const current = this.options.journal.get(prepared.operationId);
    if (
      current?.status !== 'pending-approval' ||
      current.operationFingerprintHash !== prepared.operationFingerprintHash
    ) {
      throw new OperationIdConflictError();
    }
    const key = `${scope.actor.actorId}\0${prepared.operationId}`;
    const promise = this.executeApproved(prepared, key, reporter);
    this.inflight.set(key, { fingerprintHash: prepared.operationFingerprintHash, promise });
    void promise
      .finally(() => {
        const active = this.inflight.get(key);
        if (active?.promise === promise) this.inflight.delete(key);
      })
      .catch(() => {});
    return await promise;
  }

  async rejectToolApproval(
    handle: ToolApprovalHandle,
    errorCode: string,
  ): Promise<OperationRecord> {
    if (errorCode.length === 0 || errorCode.length > 256) {
      throw Object.assign(new Error('approval terminal code is invalid'), {
        code: 'APPROVAL_TERMINAL_INVALID',
      });
    }
    const { prepared } = this.consumeApproval(handle);
    const current = this.options.journal.get(prepared.operationId);
    if (
      current?.status !== 'pending-approval' ||
      current.operationFingerprintHash !== prepared.operationFingerprintHash
    ) {
      throw new OperationIdConflictError();
    }
    const settled = await this.transition(prepared, 'pre-egress-rejected', { errorCode });
    this.activeControllers.delete(prepared.operationId);
    return settled;
  }

  status(
    actorId: OperationRecord['actorId'],
    operationId: string,
  ): OperationRecord | OperationTombstone | undefined {
    const record = this.options.journal.get(operationId);
    return record?.actorId === actorId ? record : undefined;
  }

  private prepare<TScope extends ResolvedInvocationScope>(
    scope: TScope,
    toolName: ToolName,
    rawArgs: unknown,
    suppliedOperationId: string | undefined,
    options: Readonly<ToolInvocationOptionsV1>,
  ): PreparedInvocation & { scope: TScope } {
    const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === toolName);
    if (spec === undefined)
      throw Object.assign(new Error('unknown tool'), { code: 'TOOL_NOT_FOUND' });
    if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
      const declared = new Set(Object.keys(spec.inputSchema.shape));
      if (Object.keys(rawArgs).some(key => !declared.has(key))) {
        throw Object.assign(new Error('tool arguments contain unknown keys'), {
          code: 'INVOCATION_ARGS_INVALID',
        });
      }
    }
    const parsed = spec.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw Object.assign(new Error('tool arguments are invalid'), {
        code: 'INVOCATION_ARGS_INVALID',
        cause: parsed.error,
      });
    }
    const operationId =
      suppliedOperationId ?? this.options.issuer.issue(scope.actor.actorId, this.now());
    const claims = this.options.issuer.verify(scope.actor.actorId, operationId, this.now());
    const verifiedOptions = validateToolInvocationOptions(
      options,
      operationId,
      scope.workspace.workspaceId,
    );
    const parsedArgs = Object.freeze(parsed.data as Readonly<Record<string, unknown>>);
    const argsHash = hash('sfp-parsed-args-v1', canonicalJson(parsedArgs));
    const fileExecutionKeyHash =
      scope.target.fileExecutionKey === null
        ? null
        : hash('sfp-file-execution-key-v1', scope.target.fileExecutionKey);
    const targetBindingHash = this.targetBindingHash(scope, fileExecutionKeyHash);
    const captureIntentHash = hash(
      'sfp-capture-intent-v1',
      canonicalJson({
        captureResult: verifiedOptions.captureIntent.captureResult,
        relativePath: verifiedOptions.captureIntent.relativePath,
      }),
    );
    const fingerprint = {
      actorId: scope.actor.actorId,
      operationId,
      operationKind: 'tool' as const,
      operationName: toolName,
      argsHash,
      workspaceId: scope.workspace.workspaceId,
      fileExecutionKeyHash,
      targetBindingHash,
      captureIntentHash,
    };
    return {
      scope,
      toolName,
      parsedArgs,
      operationId,
      issuedAt: claims.issuedAt,
      options: verifiedOptions,
      argsHash,
      fileExecutionKeyHash,
      targetBindingHash,
      captureIntentHash,
      operationFingerprintHash: hashOperationFingerprint(fingerprint),
    };
  }

  private targetBindingHash(
    scope: ResolvedInvocationScope,
    fileExecutionKeyHash: PrefixedSha256 | null,
  ): PrefixedSha256 | null {
    if (
      scope.target.sessionId === null ||
      scope.target.fileIdentity === null ||
      scope.target.pluginGeneration === null ||
      fileExecutionKeyHash === null
    ) {
      return null;
    }
    return hash(
      'sfp-entry-target-binding-v1',
      canonicalJson({
        targetSessionIdHash: hash('sfp-target-session-v1', scope.target.sessionId),
        fileIdentityHash: canonicalFileIdentityHash(scope.target.fileIdentity),
        fileExecutionKeyHash,
        pluginGeneration: scope.target.pluginGeneration,
        leaderGeneration: scope.leaderGeneration,
      }),
    );
  }

  private consumeApproval(handle: ToolApprovalHandle): ApprovalBinding {
    const binding = this.approvals.get(handle);
    if (binding === undefined) {
      throw Object.assign(new Error('approval resume capability is invalid'), {
        code: 'APPROVAL_RESUME_INVALID',
      });
    }
    this.approvals.delete(handle);
    return binding;
  }

  private initialRecord(
    prepared: PreparedInvocation,
    policyDecision: ReturnType<typeof evaluateOperationPolicy>,
    approvalId: string | null,
  ): NewOperationRecord {
    const originEntryPath = prepared.scope.actor.entryPath;
    if (originEntryPath === 'internal-system') {
      throw Object.assign(new Error('tool invocation cannot use an internal-system origin'), {
        code: 'INVOCATION_ORIGIN_INVALID',
      });
    }
    return {
      actorId: prepared.scope.actor.actorId,
      originAuthSessionId: prepared.scope.actor.authSessionId,
      origin: {
        kind: 'entry',
        entryPath: originEntryPath,
        authSessionId: prepared.scope.actor.authSessionId,
      },
      operationId: prepared.operationId,
      issuedAt: prepared.issuedAt,
      operationKind: 'tool',
      operationName: prepared.toolName,
      argsHash: prepared.argsHash,
      captureIntentHash: prepared.captureIntentHash,
      operationFingerprintHash: prepared.operationFingerprintHash,
      resultHash: null,
      resultBytes: null,
      workspaceId: prepared.scope.workspace.workspaceId,
      fileExecutionKey: prepared.scope.target.fileExecutionKey,
      fileExecutionKeyHash: prepared.fileExecutionKeyHash,
      targetBindingHash: prepared.targetBindingHash,
      pluginGeneration: null,
      leaderGeneration: prepared.scope.leaderGeneration,
      policyId:
        policyDecision.policy.toolName === prepared.toolName
          ? `tool:${prepared.toolName}:v1`
          : 'invalid',
      effectSummary: policyDecision.effects.map(effect => effect.type),
      approvalId,
      preExecutionConsentManifestHash: null,
      finalEgressManifestHash: null,
      operationEvidenceReceiptHash: null,
    };
  }

  private async executeNew(
    prepared: PreparedRuntimeInvocation,
    cacheKey: string,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    const policyDecision = evaluateOperationPolicy(
      prepared.toolName,
      prepared.parsedArgs,
      prepared.scope,
    );
    let durability: PreparedDurability | null;
    try {
      durability = await this.prepareDurability(prepared, policyDecision);
    } catch (error) {
      const settlement = this.reservationFailureSettlement(error);
      if (settlement === null) {
        this.activeControllers.delete(prepared.operationId);
        throw error;
      }
      await this.options.journal.appendInitial(
        {
          ...this.initialRecord(prepared, policyDecision, null),
          preExecutionConsentManifestHash: settlement.preManifestHash,
        },
        'queued',
        { leaderGeneration: prepared.scope.leaderGeneration },
      );
      await this.transition(prepared, settlement.status, {
        errorCode:
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'OPERATION_RESERVATION_FAILED',
        operationEvidenceReceiptHash: null,
        finalEgressManifestHash: settlement.finalEgressManifestHash,
      });
      this.activeControllers.delete(prepared.operationId);
      throw error;
    }
    await this.options.durability?.afterEvidenceReservationFsync?.();
    const cancellation = this.ensureCancellationState(prepared);
    cancellation.durability = durability;
    try {
      await this.options.journal.appendInitial(
        {
          ...this.initialRecord(prepared, policyDecision, null),
          preExecutionConsentManifestHash: durability?.preManifest.manifestHash ?? null,
        },
        'queued',
        { leaderGeneration: prepared.scope.leaderGeneration },
      );
    } catch (error) {
      await this.releasePreparedBeforeDispatch(durability);
      this.activeControllers.delete(prepared.operationId);
      throw error;
    }
    if (cancellation.controller.signal.aborted) {
      await this.settlePreDispatchCancellation(cancellation, 'queued');
      this.activeControllers.delete(prepared.operationId);
      throw cancellation.controller.signal.reason;
    }
    return this.runQueued(prepared, policyDecision, cacheKey, durability, reporter);
  }

  private async executeApproved(
    prepared: PreparedRuntimeInvocation,
    cacheKey: string,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    const policyDecision = evaluateOperationPolicy(
      prepared.toolName,
      prepared.parsedArgs,
      prepared.scope,
    );
    let durability: PreparedDurability | null;
    try {
      durability = await this.prepareDurability(prepared, policyDecision);
    } catch (error) {
      const settlement = this.reservationFailureSettlement(error);
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'OPERATION_RESERVATION_FAILED';
      if (settlement === null) {
        await this.transition(prepared, 'pre-egress-rejected', { errorCode });
      } else {
        await this.options.journal.transition(prepared.operationId, 'queued', {
          preExecutionConsentManifestHash: settlement.preManifestHash,
        });
        await this.transition(prepared, settlement.status, {
          errorCode,
          operationEvidenceReceiptHash: null,
          finalEgressManifestHash: settlement.finalEgressManifestHash,
        });
      }
      this.activeControllers.delete(prepared.operationId);
      throw error;
    }
    await this.options.durability?.afterEvidenceReservationFsync?.();
    const cancellation = this.ensureCancellationState(prepared);
    cancellation.durability = durability;
    if (cancellation.controller.signal.aborted) {
      const current = this.options.journal.get(prepared.operationId);
      if (current?.status === 'pending-approval') {
        await this.settlePreDispatchCancellation(cancellation, 'pending-approval');
      }
      this.activeControllers.delete(prepared.operationId);
      throw cancellation.controller.signal.reason;
    }
    try {
      await this.options.journal.transition(
        prepared.operationId,
        'queued',
        durability === null
          ? {}
          : { preExecutionConsentManifestHash: durability.preManifest.manifestHash },
      );
    } catch (error) {
      await this.releasePreparedBeforeDispatch(durability);
      this.activeControllers.delete(prepared.operationId);
      throw error;
    }
    return this.runQueued(prepared, policyDecision, cacheKey, durability, reporter);
  }

  private runQueued(
    prepared: PreparedRuntimeInvocation,
    policyDecision: ReturnType<typeof evaluateOperationPolicy>,
    cacheKey: string,
    durability: PreparedDurability | null,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    return this.options.queue.run(
      prepared.scope.target.fileExecutionKey,
      policyDecision.concurrency,
      async () => {
        const cancellation = this.ensureCancellationState(prepared);
        if (cancellation.controller.signal.aborted) {
          const current = this.options.journal.get(prepared.operationId);
          if (current?.status === 'queued') {
            await this.settlePreDispatchCancellation(cancellation, 'queued');
          }
          throw cancellation.controller.signal.reason;
        }
        await this.options.journal.transition(
          prepared.operationId,
          'dispatched',
          durability === null
            ? {}
            : { preExecutionConsentManifestHash: durability.preManifest.manifestHash },
        );
        cancellation.dispatched = true;
        const controller = cancellation.controller;
        let runtimeCompleted = false;
        try {
          const validated = await executeToolRuntime(
            prepared.toolName,
            prepared.scope,
            prepared.parsedArgs,
            controller.signal,
            this.options.runtimes,
            reporter,
            {
              operationId: prepared.operationId,
              actionNonce: cancellation.actionNonce,
            },
          );
          runtimeCompleted = true;
          if (controller.signal.aborted) {
            if (cancellation.demoting && cancellation.demotionSettlement !== null) {
              await cancellation.demotionSettlement;
              throw Object.assign(new Error('demoted plugin outcome is unknown'), {
                code: 'OPERATION_OUTCOME_UNKNOWN',
              });
            }
            const current = this.options.journal.get(prepared.operationId);
            if (current?.status === 'dispatched') {
              const errorCode = cancellation.demoting
                ? 'LEADER_GENERATION_CLOSED'
                : 'OPERATION_CANCELLED_AFTER_DISPATCH';
              if (durability !== null) {
                await this.finalizeUnknown(prepared, durability, errorCode);
              } else {
                await this.transition(prepared, 'outcome-unknown', { errorCode });
              }
            }
            throw Object.assign(new Error('cancelled plugin outcome is unknown'), {
              code: 'OPERATION_OUTCOME_UNKNOWN',
            });
          }
          const egress = resultEgressPolicyFor(prepared.toolName);
          const redacted = egress.redactResult(
            validated as Readonly<Record<string, unknown>>,
            prepared.scope.consent.allowedClasses,
          );
          const canonicalRedactedResultBytes = Buffer.from(canonicalJson(redacted), 'utf8');
          const resultHash = hash(null, canonicalRedactedResultBytes);
          if (durability === null || this.durableFinalizer === null) {
            controller.signal.throwIfAborted();
            cancellation.terminalClaimed = true;
            await this.transition(prepared, 'succeeded', {
              resultHash,
              resultBytes: canonicalRedactedResultBytes.byteLength,
            });
          } else {
            const classifiedResult = egress.classifyResult(
              redacted as Readonly<Record<string, unknown>>,
            );
            const outputManifest = createOutputEgressManifest({
              preExecutionManifestHash: durability.preManifest.manifestHash,
              resultClasses: classifiedResult.classes,
              outputBytes: canonicalRedactedResultBytes.byteLength,
              outputTokens: classifiedResult.tokens,
              redactedFieldCount: 0,
              resultHash,
              resultBytes: canonicalRedactedResultBytes.byteLength,
              payloadHash: resultHash,
            });
            const nativeEvidence = await this.materializeNativeEvidence(
              prepared,
              redacted,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            cancellation.terminalClaimed = true;
            await this.durableFinalizer.succeed({
              actorId: prepared.scope.actor.actorId,
              operationId: prepared.operationId,
              operationKind: 'tool',
              operationName: prepared.toolName,
              argsHash: prepared.argsHash,
              workspaceId: prepared.scope.workspace.workspaceId,
              fileExecutionKeyHash: prepared.fileExecutionKeyHash,
              targetBindingHash: prepared.targetBindingHash,
              captureIntentHash: prepared.captureIntentHash,
              captureIntent: prepared.options.captureIntent,
              canonicalRedactedBytes: canonicalRedactedResultBytes,
              resultSchemaHash: this.resultSchemaHash(prepared.toolName),
              resultHash,
              nativeEvidence,
              daemonGenerationHash: hash(
                'sfp-daemon-generation-v1',
                prepared.scope.leaderGeneration,
              ),
              leaderGeneration: prepared.scope.leaderGeneration,
              evidenceReservationId: durability.evidenceReservationId,
              egressReservation: durability.egressReservation,
              outputManifest,
              completedAt: new Date(this.now()).toISOString(),
              requestId: prepared.scope.requestId,
              result: redacted,
            });
          }
          this.cacheCompleted(
            cacheKey,
            prepared,
            canonicalRedactedResultBytes,
            this.resultSchemaHash(prepared.toolName),
          );
          return JSON.parse(canonicalRedactedResultBytes.toString('utf8'));
        } catch (error) {
          if (cancellation.demoting && cancellation.demotionSettlement !== null) {
            await cancellation.demotionSettlement;
            throw Object.assign(new Error('demoted plugin outcome is unknown'), {
              code: 'OPERATION_OUTCOME_UNKNOWN',
              cause: error,
            });
          }
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'RUNTIME_FAILED';
          const postCommit =
            typeof error === 'object' &&
            error !== null &&
            'committed' in error &&
            error.committed === true;
          const current = this.options.journal.get(prepared.operationId);
          if (current?.status === 'dispatched') {
            if (controller.signal.aborted) {
              const errorCode = cancellation.demoting
                ? 'LEADER_GENERATION_CLOSED'
                : 'OPERATION_CANCELLED_AFTER_DISPATCH';
              if (durability !== null) {
                await this.finalizeUnknown(prepared, durability, errorCode);
              } else {
                await this.transition(prepared, 'outcome-unknown', { errorCode });
              }
              throw Object.assign(new Error('cancelled plugin outcome is unknown'), {
                code: 'OPERATION_OUTCOME_UNKNOWN',
                cause: error,
              });
            }
            if (
              !runtimeCompleted &&
              !postCommit &&
              durability !== null &&
              this.durableFinalizer !== null
            ) {
              const noOutputManifest = createNoOutputEgressManifest({
                preExecutionManifestHash: durability.preManifest.manifestHash,
                reasonCode: controller.signal.aborted ? 'cancelled' : 'runtime-failed',
              });
              await this.durableFinalizer.fail({
                actorId: prepared.scope.actor.actorId,
                operationId: prepared.operationId,
                operationKind: 'tool',
                operationName: prepared.toolName,
                argsHash: prepared.argsHash,
                workspaceId: prepared.scope.workspace.workspaceId,
                fileExecutionKeyHash: prepared.fileExecutionKeyHash,
                targetBindingHash: prepared.targetBindingHash,
                captureIntentHash: prepared.captureIntentHash,
                daemonGenerationHash: hash(
                  'sfp-daemon-generation-v1',
                  prepared.scope.leaderGeneration,
                ),
                leaderGeneration: prepared.scope.leaderGeneration,
                evidenceReservationId: durability.evidenceReservationId,
                egressReservation: durability.egressReservation,
                noOutputManifest,
                completedAt: new Date(this.now()).toISOString(),
                errorCode: code,
              });
            } else if ((runtimeCompleted || postCommit) && durability !== null) {
              await this.finalizeUnknown(prepared, durability, postCommit ? code : undefined);
            } else {
              await this.transition(
                prepared,
                runtimeCompleted || postCommit ? 'outcome-unknown' : 'failed',
                {
                  errorCode: postCommit
                    ? code
                    : runtimeCompleted
                      ? 'OPERATION_TERMINAL_DURABILITY_FAILED'
                      : code,
                },
              );
            }
          }
          throw error;
        } finally {
          cancellation.settleTerminal();
          this.activeControllers.delete(prepared.operationId);
        }
      },
    );
  }

  private async prepareDurability(
    prepared: PreparedRuntimeInvocation,
    policyDecision: ReturnType<typeof evaluateOperationPolicy>,
  ): Promise<PreparedDurability | null> {
    const durability = this.options.durability;
    if (durability === undefined) return null;
    if (
      prepared.options.captureIntent.captureResult &&
      prepared.scope.workspace.workspaceId !== null
    ) {
      await durability.artifacts.preflight?.(
        prepared.scope.workspace.workspaceId,
        prepared.options.captureIntent,
      );
    }
    const egress = resultEgressPolicyFor(prepared.toolName);
    const classifiedInput = egress.classifyInput(prepared.parsedArgs);
    const preManifest = createPreExecutionConsentManifest({
      consentId: prepared.scope.consent.consentId,
      mode: prepared.scope.consent.mode,
      inputClasses: classifiedInput.classes,
      possibleResultClasses: egress.possibleResultClasses,
      allowedClasses: prepared.scope.consent.allowedClasses,
      inputBytes: classifiedInput.bytes,
      inputTokens: classifiedInput.tokens,
    });
    const egressReservation = await durability.egress.reservePre(
      prepared.scope.actor.actorId,
      prepared.scope.requestId,
      prepared.operationId,
      preManifest,
    );
    let evidence: Awaited<ReturnType<OperationEvidenceReceiptStorePort['reserveBeforeRuntime']>>;
    try {
      const reservationContext = Object.freeze({
        workspaceId: prepared.scope.workspace.workspaceId,
        operationAuthority: Object.freeze({
          ...this.initialRecord(prepared, policyDecision, null),
          preExecutionConsentManifestHash: preManifest.manifestHash,
        }),
      });
      evidence = await durability.receipts.reserveBeforeRuntime(
        prepared.scope.actor.actorId,
        prepared.operationId,
        OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
        reservationContext,
      );
    } catch (reservationError) {
      const noOutput = createNoOutputEgressManifest({
        preExecutionManifestHash: preManifest.manifestHash,
        reasonCode: 'admission-rejected',
      });
      try {
        const finalized = await durability.egress.finalize(egressReservation, noOutput);
        throw Object.assign(
          reservationError instanceof Error
            ? reservationError
            : new Error('evidence reservation failed'),
          {
            reservationFailureSettlement: {
              preManifestHash: preManifest.manifestHash,
              finalEgressManifestHash: finalized.finalManifestHash,
              status: 'rejected',
            } satisfies ReservationFailureSettlement,
          },
        );
      } catch (finalizationError) {
        if (
          typeof finalizationError === 'object' &&
          finalizationError !== null &&
          'reservationFailureSettlement' in finalizationError
        ) {
          throw finalizationError;
        }
        throw Object.assign(new Error('reservation finalizer durability failed'), {
          code: 'OPERATION_RESERVATION_DURABILITY_FAILED',
          cause: finalizationError,
          reservationFailureSettlement: {
            preManifestHash: preManifest.manifestHash,
            finalEgressManifestHash: null,
            status: 'outcome-unknown',
          } satisfies ReservationFailureSettlement,
        });
      }
    }
    return Object.freeze({
      preManifest,
      egressReservation,
      evidenceReservationId: evidence.reservationId,
    });
  }

  private reservationFailureSettlement(error: unknown): ReservationFailureSettlement | null {
    if (typeof error !== 'object' || error === null || !('reservationFailureSettlement' in error)) {
      return null;
    }
    const value = error.reservationFailureSettlement as ReservationFailureSettlement;
    return value.status === 'rejected' || value.status === 'outcome-unknown' ? value : null;
  }

  private async releasePreparedBeforeDispatch(
    durability: PreparedDurability | null,
  ): Promise<void> {
    if (durability === null || this.options.durability === undefined) return;
    const noOutput = createNoOutputEgressManifest({
      preExecutionManifestHash: durability.preManifest.manifestHash,
      reasonCode: 'admission-rejected',
    });
    await this.options.durability.egress.finalize(durability.egressReservation, noOutput);
    await this.options.durability.receipts.releaseWithoutReceipt(durability.evidenceReservationId);
  }

  private async materializeNativeEvidence(
    prepared: PreparedRuntimeInvocation,
    redacted: unknown,
    signal: AbortSignal,
  ): Promise<NativeEvidenceV1> {
    signal.throwIfAborted();
    const durability = this.options.durability;
    const workspaceId = prepared.scope.workspace.workspaceId;
    if (durability === undefined || workspaceId === null) {
      return { kind: 'no-artifact', reasonCode: 'not-native-evidence' };
    }
    const context = Object.freeze({ operationId: prepared.operationId, workspaceId });
    const projection = durability.projector.project(
      context,
      'tool',
      prepared.toolName,
      prepared.parsedArgs,
      redacted,
    );
    signal.throwIfAborted();
    if (projection.kind === 'no-artifact') return projection;
    if (projection.kind !== 'export-candidates') {
      return { kind: 'no-artifact', reasonCode: 'not-native-evidence' };
    }
    if (projection.candidates.every(candidate => candidate.candidateRelativePath === null)) {
      return { kind: 'no-artifact', reasonCode: 'native-output-path-null' };
    }
    const { verifyNativeEvidenceContext } = await import('./operation-evidence-projector.js');
    return durability.nativeArtifacts.createNativeManifest({
      context: verifyNativeEvidenceContext(context, projection),
      projection,
      signal,
    });
  }

  private ensureCancellationState(prepared: PreparedInvocation): CancellationState {
    const existing = this.activeControllers.get(prepared.operationId);
    if (existing !== undefined) return existing;
    let settleTerminal!: () => void;
    const terminalSettlement = new Promise<void>(resolve => {
      settleTerminal = resolve;
    });
    const state: CancellationState = {
      operationId: prepared.operationId,
      principal: prepared.scope.actor,
      requestId: prepared.scope.requestId,
      leaderGeneration: prepared.scope.leaderGeneration,
      controller: new AbortController(),
      durability: null,
      dispatched: false,
      actionNonce: randomBytes(16).toString('base64url'),
      demoting: false,
      prepared,
      demotionSettlement: null,
      terminalClaimed: false,
      terminalSettlement,
      settleTerminal,
    };
    this.activeControllers.set(prepared.operationId, state);
    return state;
  }

  private async settlePreDispatchCancellation(
    state: CancellationState,
    currentStatus: 'pending-approval' | 'queued',
    errorCode = 'OPERATION_CANCELLED',
    capability?: LeaderDemotionCapability,
  ): Promise<void> {
    let finalEgressManifestHash: PrefixedSha256 | null = null;
    if (state.durability !== null && this.options.durability !== undefined) {
      const noOutput = createNoOutputEgressManifest({
        preExecutionManifestHash: state.durability.preManifest.manifestHash,
        reasonCode: 'cancelled',
      });
      const finalized = await this.options.durability.egress.finalize(
        state.durability.egressReservation,
        noOutput,
      );
      finalEgressManifestHash = finalized.finalManifestHash;
    }
    const status =
      currentStatus === 'pending-approval'
        ? 'pre-egress-rejected'
        : capability === undefined
          ? 'rejected'
          : 'failed';
    await this.demotionTransition(capability, state.prepared, status, {
      errorCode,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash,
    });
    if (state.durability !== null && this.options.durability !== undefined) {
      await this.options.durability.receipts.releaseWithoutReceipt(
        state.durability.evidenceReservationId,
      );
    }
  }

  private demotionTransition(
    capability: LeaderDemotionCapability | undefined,
    prepared: PreparedInvocation,
    status: 'pre-egress-rejected' | 'rejected' | 'failed' | 'outcome-unknown',
    patch: Parameters<OperationJournalPort['transition']>[2],
  ): Promise<OperationRecord> {
    if (
      capability !== undefined &&
      this.options.journal.transitionDemotion !== undefined &&
      status !== 'rejected'
    ) {
      return this.options.journal.transitionDemotion(
        capability,
        prepared.operationId,
        status,
        patch,
      );
    }
    return this.transition(prepared, status, patch);
  }

  private transition(
    prepared: PreparedInvocation,
    status: OperationRecord['status'],
    patch: Parameters<OperationJournalPort['transition']>[2] = {},
  ): Promise<OperationRecord> {
    return this.options.journal.transition(prepared.operationId, status, patch, {
      expectedLeaderGeneration: prepared.scope.leaderGeneration,
    });
  }

  private async finalizeUnknown(
    prepared: PreparedInvocation,
    durability: PreparedDurability,
    errorCode = 'OPERATION_TERMINAL_DURABILITY_FAILED',
    capability?: LeaderDemotionCapability,
  ): Promise<void> {
    const ports = this.options.durability;
    if (ports === undefined) return;
    const manifest = createOutcomeUnknownEgressManifest({
      preExecutionManifestHash: durability.preManifest.manifestHash,
      reasonCode: 'post-runtime-durability-failed',
      observedOutputBytes: null,
    });
    const finalized = await ports.egress.finalize(durability.egressReservation, manifest);
    await this.demotionTransition(capability, prepared, 'outcome-unknown', {
      errorCode,
      preExecutionConsentManifestHash: durability.preManifest.manifestHash,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: finalized.finalManifestHash,
    });
    await ports.receipts.abortAfterDurableUnknown(durability.evidenceReservationId);
  }

  private async reconcileFencedDispatched(
    state: CancellationState,
    record: Readonly<OperationRecord>,
    capability: LeaderDemotionCapability | undefined,
  ): Promise<void> {
    const ports = this.options.durability;
    if (ports === undefined || this.durableFinalizer === null) return;
    const receipt = await ports.receipts.get(record.actorId, record.operationId);
    if (receipt === null && state.durability !== null) {
      await this.finalizeUnknown(
        state.prepared,
        state.durability,
        'EVIDENCE_FINALIZER_MISSING',
        capability,
      );
      return;
    }
    let finalizer: Readonly<import('@sfp/shared').EgressFinalizerProjectionV1> | null = null;
    if (receipt !== null) {
      try {
        finalizer = await ports.egress.readVerifiedFinalizer(
          record.actorId,
          record.operationId,
          receipt.finalizerHash,
        );
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'EGRESS_FINALIZER_MISSING'
        ) {
          throw error;
        }
      }
    }
    const recoveredStatus = await this.durableFinalizer.recoverDispatched({
      operationId: record.operationId,
      record,
      preparedReceipt: receipt,
      verifiedFinalizer: finalizer,
      ...(capability === undefined ? {} : { capability }),
    });
    if (recoveredStatus === 'outcome-unknown' && state.durability !== null) {
      await ports.receipts.abortAfterDurableUnknown(state.durability.evidenceReservationId);
    }
  }

  private replayOrReject(
    prepared: PreparedRuntimeInvocation,
    existing: OperationRecord | OperationTombstone,
    cacheKey: string,
  ): Promise<unknown> {
    if (
      existing.actorId !== prepared.scope.actor.actorId ||
      existing.operationId !== prepared.operationId ||
      existing.operationFingerprintHash !== prepared.operationFingerprintHash
    ) {
      return Promise.reject(new OperationIdConflictError());
    }
    if (!terminalStatus(existing.status)) {
      return Promise.reject(
        Object.assign(new Error('operation is still in progress'), {
          code: 'OPERATION_IN_PROGRESS',
          status: existing.status,
          operationId: existing.operationId,
        }),
      );
    }
    const cache = this.completed.get(cacheKey);
    if (existing.status === 'succeeded' && cache !== undefined) {
      const currentFingerprintHash = this.consentFingerprintHash(prepared);
      let parsedResult: unknown;
      let canonicalRoundTrip = false;
      try {
        const schema = ALL_TOOL_SPECS.find(
          candidate => candidate.name === prepared.toolName,
        )!.resultSchema;
        const parsed = schema.safeParse(
          JSON.parse(Buffer.from(cache.canonicalRedactedResultBytes).toString('utf8')),
        );
        if (parsed.success) {
          parsedResult = parsed.data;
          canonicalRoundTrip = Buffer.from(canonicalJson(parsed.data), 'utf8').equals(
            Buffer.from(cache.canonicalRedactedResultBytes),
          );
        }
      } catch {
        parsedResult = undefined;
      }
      const resultHash = hash(null, cache.canonicalRedactedResultBytes);
      const valid =
        cache.operationId === prepared.operationId &&
        cache.expiresAt > this.now() &&
        cache.consentFingerprintHash === currentFingerprintHash &&
        cache.resultSchemaHash === this.resultSchemaHash(prepared.toolName) &&
        existing.resultHash === resultHash &&
        (!('resultBytes' in existing) ||
          existing.resultBytes === cache.canonicalRedactedResultBytes.byteLength) &&
        parsedResult !== undefined &&
        canonicalRoundTrip;
      if (valid) {
        cache.touchedAt = this.now();
        return Promise.resolve(parsedResult);
      }
      this.options.replayAudit?.(
        Object.freeze({
          operationId: prepared.operationId,
          oldFingerprintHash: cache.consentFingerprintHash,
          newFingerprintHash: currentFingerprintHash,
        }),
      );
    }
    return Promise.reject(settledError(existing));
  }

  private consentFingerprintHash(prepared: PreparedRuntimeInvocation): PrefixedSha256 {
    return hash(
      'sfp-consent-fingerprint-v1',
      canonicalJson({
        operationKind: 'tool',
        operationName: prepared.toolName,
        mode: prepared.scope.consent.mode,
        consentId: prepared.scope.consent.consentId,
        allowedClasses: [...prepared.scope.consent.allowedClasses].toSorted(),
        policyVersion: 'egress-policy-v1',
      }),
    );
  }

  private resultSchemaHash(toolName: ToolName): PrefixedSha256 {
    const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === toolName)!;
    return hash('sfp-result-schema-v1', canonicalJson(spec.resultSchema.toJSONSchema()));
  }

  private cacheCompleted(
    key: string,
    prepared: PreparedRuntimeInvocation,
    bytes: Uint8Array,
    resultSchemaHash: PrefixedSha256,
  ): void {
    const existing = this.completed.get(key);
    if (existing !== undefined)
      this.completedBytes -= existing.canonicalRedactedResultBytes.byteLength;
    const now = this.now();
    const entry: CompletedCacheEntry = {
      operationId: prepared.operationId,
      canonicalRedactedResultBytes: Uint8Array.from(bytes),
      resultSchemaHash,
      consentFingerprintHash: this.consentFingerprintHash(prepared),
      expiresAt: now + cacheTtlMilliseconds,
      touchedAt: now,
    };
    this.completed.set(key, entry);
    this.completedBytes += bytes.byteLength;
    while (this.completed.size > cacheMaximumEntries || this.completedBytes > cacheMaximumBytes) {
      const oldest = [...this.completed.entries()].toSorted(
        ([, left], [, right]) => left.touchedAt - right.touchedAt,
      )[0];
      if (oldest === undefined) break;
      this.completed.delete(oldest[0]);
      this.completedBytes -= oldest[1].canonicalRedactedResultBytes.byteLength;
    }
  }
}
