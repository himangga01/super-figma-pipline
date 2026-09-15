import { z } from 'zod';

import type { InvocationCancelV1 } from './control.js';
import type { DataClass, EgressMode } from './egress.js';
import {
  ActorContextSchema,
  ToolNameSchema,
  type ActorContext,
  type FileExecutionKey,
  type PrefixedSha256,
  type ResolvedInvocationScope,
  type RuntimeExecutionScope,
  type ToolInvocationOptionsV1,
  type ToolName,
} from './invocation.js';
import type { ProgressReporter } from './progress.js';
import {
  ServiceOperationNameSchema,
  SystemOperationNameSchema,
  type AbortSignalLike,
  type OperationKind,
  type ServiceOperationName,
  type SystemOperationName,
} from './service-operations.js';

/** Maximum canonical bytes published in a captured operation result artifact. */
export const OPERATION_CAPTURE_MAX_BYTES = 8_388_608;

/** A side effect resolved from already-parsed tool arguments. */
export type Effect =
  | { type: 'figma-read' }
  | { type: 'figma-write'; destructive: boolean; broad: boolean }
  | { type: 'figma-ui' }
  | { type: 'figma-library-import' }
  | { type: 'filesystem-read'; pathArgs: readonly string[] }
  | { type: 'filesystem-write'; pathArgs: readonly string[]; destructive: boolean }
  | { type: 'portal-state-write' }
  | { type: 'portal-state-read' }
  | { type: 'native-process-run'; profileArg: string }
  | { type: 'owned-process-stop' }
  | { type: 'external-browser-read'; urlArg: string; attachOnly: true }
  | { type: 'network'; urlArg: string };

export interface ServerEvidenceWriteEffectV1 {
  type: 'server-evidence-write';
  evidenceKind: 'result-capture' | 'native-manifest' | 'snapshot' | 'grounding-graph';
  workspaceId: string;
  resolvedRelativePath: string;
  writeMode: 'create-new' | 'cas-replace';
  destructive: boolean;
  expectedContentHash: PrefixedSha256 | null;
}
export type InvocationEffectV1 = Effect | ServerEvidenceWriteEffectV1;

/** Task 4's canonical workspace resolution, carried into pure effect classification. */
export interface ResolvedWorkspacePath {
  path: string;
  overwrites: boolean;
}

export interface WorkspaceInvocationContext {
  workspaceId: string | null;
  workspaceRoot: string | null;
}

/**
 * The policy-visible part of an invocation. Auth, approval execution, file identity, and dispatch
 * are deliberately absent here; later execution tasks may compose those authorities around this one
 * without making policy classification perform side effects.
 */
export interface PolicyInvocationContext {
  portalCaptureSource?: 'chrome' | 'desktop';
  workspace: WorkspaceInvocationContext;
  /** Present after Task 4 resolves path arguments; absent means no overwrite has been observed. */
  resolvedPaths?: Readonly<Record<string, ResolvedWorkspacePath>>;
}

export type ApprovalRequirement = 'none' | 'client' | 'explicit-user';
export type IdempotencyRequirement = 'safe-retry' | 'operation-id' | 'never-auto-retry';
export type ConcurrencyRequirement = 'parallel-read' | 'file-write' | 'exclusive-heavy';

export interface OperationPolicy<I = Readonly<Record<string, unknown>>> {
  toolName: string;
  /** Worst-case union used for static MCP annotations. */
  possibleEffects: readonly Effect[];
  /** Worst retry behavior across all valid parsed argument branches. */
  possibleIdempotency: IdempotencyRequirement;
  effectsFor(args: Readonly<I>, context: PolicyInvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): IdempotencyRequirement;
  approvalFor(effects: readonly Effect[], context: PolicyInvocationContext): ApprovalRequirement;
  concurrency: ConcurrencyRequirement;
}

export type OperationPolicyRegistry = Readonly<Record<string, OperationPolicy>>;

export type OperationName = ToolName | ServiceOperationName | SystemOperationName;

export type OperationStatus =
  | 'pending-approval'
  | 'queued'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'pre-egress-rejected'
  | 'rejected'
  | 'outcome-unknown'
  | 'resolved-applied'
  | 'resolved-not-applied'
  | 'abandoned';

export type OperationOriginV1 =
  | {
      kind: 'entry';
      entryPath: 'mcp-direct' | 'mcp-follower' | 'control';
      authSessionId: ActorContext['authSessionId'];
    }
  | {
      kind: 'internal-system';
      entryPath: 'internal-system';
      authSessionId: ActorContext['authSessionId'];
      systemName: 'identity.bootstrap';
      pairedSessionHash: PrefixedSha256;
      targetSessionIdHash: PrefixedSha256;
      fileIdentityHash: PrefixedSha256;
      fileExecutionKeyHash: PrefixedSha256;
      pluginGeneration: string;
      leaderGeneration: string;
      targetBindingHash: PrefixedSha256;
    };

export interface OperationFingerprintV1 {
  actorId: ActorContext['actorId'];
  operationId: string;
  operationKind: OperationKind;
  operationName: OperationName;
  argsHash: PrefixedSha256;
  workspaceId: string | null;
  fileExecutionKeyHash: PrefixedSha256 | null;
  targetBindingHash: PrefixedSha256 | null;
  captureIntentHash: PrefixedSha256;
}

export interface OperationRecord extends OperationFingerprintV1 {
  originAuthSessionId: ActorContext['authSessionId'];
  origin: OperationOriginV1;
  issuedAt: number;
  operationFingerprintHash: PrefixedSha256;
  resultHash: PrefixedSha256 | null;
  resultBytes: number | null;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  fileExecutionKeyHash: PrefixedSha256 | null;
  targetBindingHash: PrefixedSha256 | null;
  pluginGeneration: string | null;
  /** Generation CAS binding for leader-owned entry work; absent only on pre-7C rows. */
  leaderGeneration?: string | null;
  policyId: string;
  effectSummary: readonly string[];
  approvalId: string | null;
  preExecutionConsentManifestHash: PrefixedSha256 | null;
  finalEgressManifestHash: PrefixedSha256 | null;
  operationEvidenceReceiptHash: PrefixedSha256 | null;
  sequence: number;
  previousStatus: OperationStatus | null;
  status: OperationStatus;
  createdAt: string;
  settledAt: string | null;
  errorCode: string | null;
}

export interface OperationAlreadySettled {
  code: 'OPERATION_ALREADY_SETTLED';
  status: Exclude<OperationStatus, 'pending-approval' | 'queued' | 'dispatched'>;
  actorId: ActorContext['actorId'];
  operationId: string;
  resultHash: PrefixedSha256 | null;
  resultBytes: number | null;
  settledAt: string;
}

export interface OperationResolutionRecord extends OperationFingerprintV1 {
  originAuthSessionId: ActorContext['authSessionId'];
  origin: OperationOriginV1;
  resolverAuthSessionId: ActorContext['authSessionId'];
  issuedAt: number;
  fileExecutionKey: FileExecutionKey | null;
  decision: 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
  resultHash: PrefixedSha256 | null;
  operationFingerprintHash: PrefixedSha256;
  operationEvidenceReceiptHash: PrefixedSha256 | null;
  finalEgressManifestHash: PrefixedSha256 | null;
  reasonHash: PrefixedSha256;
  evidenceHash: PrefixedSha256;
  confirmedResultHash: PrefixedSha256 | null;
  confirmationHash: PrefixedSha256;
  decidedAt: string;
}

export interface OperationTombstone extends OperationFingerprintV1 {
  originAuthSessionId: ActorContext['authSessionId'];
  origin: OperationOriginV1;
  issuedAt: number;
  expiresAt: number;
  operationFingerprintHash: PrefixedSha256;
  fileExecutionKey: FileExecutionKey | null;
  resultHash: PrefixedSha256 | null;
  operationEvidenceReceiptHash: PrefixedSha256 | null;
  finalEgressManifestHash: PrefixedSha256 | null;
  leaderGeneration?: string | null;
  errorCode?: string | null;
  settledAt?: string;
  status: Exclude<OperationStatus, 'pending-approval' | 'queued' | 'dispatched'>;
}

export interface JournalLimits {
  maxRowsPerActor: 10_000;
  maxBytesPerActor: 33_554_432;
  normalOperationBytesPerActor: 32_505_856;
  resolutionReserveBytesPerActor: 1_048_576;
  compactAtRows: 8_000;
  compactAtBytes: 25_165_824;
  maxTombstonesPerActor: 1_000_000;
  maxTombstoneBytesPerActor: 268_435_456;
  idempotencyHorizonDays: 30;
}

export const JOURNAL_LIMITS: Readonly<JournalLimits> = Object.freeze({
  maxRowsPerActor: 10_000,
  maxBytesPerActor: 33_554_432,
  normalOperationBytesPerActor: 32_505_856,
  resolutionReserveBytesPerActor: 1_048_576,
  compactAtRows: 8_000,
  compactAtBytes: 25_165_824,
  maxTombstonesPerActor: 1_000_000,
  maxTombstoneBytesPerActor: 268_435_456,
  idempotencyHorizonDays: 30,
});

const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const FileExecutionKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^(?:figma:|plugin-uuid:|unstable:).+$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const OperationStatusSchema = z.enum([
  'pending-approval',
  'queued',
  'dispatched',
  'succeeded',
  'failed',
  'pre-egress-rejected',
  'rejected',
  'outcome-unknown',
  'resolved-applied',
  'resolved-not-applied',
  'abandoned',
]);

const EntryOperationOriginV1Schema = z
  .object({
    kind: z.literal('entry'),
    entryPath: z.enum(['mcp-direct', 'mcp-follower', 'control']),
    authSessionId: ActorContextSchema.shape.authSessionId,
  })
  .strict();
const InternalOperationOriginV1Schema = z
  .object({
    kind: z.literal('internal-system'),
    entryPath: z.literal('internal-system'),
    authSessionId: ActorContextSchema.shape.authSessionId,
    systemName: SystemOperationNameSchema,
    pairedSessionHash: PrefixedSha256Schema,
    targetSessionIdHash: PrefixedSha256Schema,
    fileIdentityHash: PrefixedSha256Schema,
    fileExecutionKeyHash: PrefixedSha256Schema,
    pluginGeneration: z.string().min(1).max(256),
    leaderGeneration: z.string().min(1).max(256),
    targetBindingHash: PrefixedSha256Schema,
  })
  .strict();
export const OperationOriginV1Schema = z.discriminatedUnion('kind', [
  EntryOperationOriginV1Schema,
  InternalOperationOriginV1Schema,
]);

const OperationKindSchema = z.enum(['tool', 'service', 'system']);
const OperationNameSchema = z.union([
  ToolNameSchema,
  ServiceOperationNameSchema,
  SystemOperationNameSchema,
]);
const OperationRecordObjectSchema = z
  .object({
    actorId: ActorContextSchema.shape.actorId,
    originAuthSessionId: ActorContextSchema.shape.authSessionId,
    origin: OperationOriginV1Schema,
    operationId: z.string().min(1).max(384),
    issuedAt: z.number().int().nonnegative().safe(),
    operationKind: OperationKindSchema,
    operationName: OperationNameSchema,
    argsHash: PrefixedSha256Schema,
    captureIntentHash: PrefixedSha256Schema,
    operationFingerprintHash: PrefixedSha256Schema,
    resultHash: PrefixedSha256Schema.nullable(),
    resultBytes: z.number().int().nonnegative().safe().nullable(),
    workspaceId: WorkspaceIdSchema.nullable(),
    fileExecutionKey: FileExecutionKeySchema.nullable(),
    fileExecutionKeyHash: PrefixedSha256Schema.nullable(),
    targetBindingHash: PrefixedSha256Schema.nullable(),
    pluginGeneration: z.string().min(1).max(256).nullable(),
    leaderGeneration: z.string().min(1).max(256).nullable().optional(),
    policyId: z.string().min(1).max(256),
    effectSummary: z.array(z.string().min(1).max(128)).max(64).readonly(),
    approvalId: z.string().min(1).max(256).nullable(),
    preExecutionConsentManifestHash: PrefixedSha256Schema.nullable(),
    finalEgressManifestHash: PrefixedSha256Schema.nullable(),
    operationEvidenceReceiptHash: PrefixedSha256Schema.nullable(),
    sequence: z.number().int().positive().safe(),
    previousStatus: OperationStatusSchema.nullable(),
    status: OperationStatusSchema,
    createdAt: IsoTimestampSchema,
    settledAt: IsoTimestampSchema.nullable(),
    errorCode: z.string().min(1).max(256).nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const kindMatches =
      (record.operationKind === 'tool' && ToolNameSchema.safeParse(record.operationName).success) ||
      (record.operationKind === 'service' &&
        ServiceOperationNameSchema.safeParse(record.operationName).success) ||
      (record.operationKind === 'system' &&
        SystemOperationNameSchema.safeParse(record.operationName).success);
    if (!kindMatches) {
      context.addIssue({ code: 'custom', message: 'operation kind and name do not match' });
    }
    if (record.originAuthSessionId !== record.origin.authSessionId) {
      context.addIssue({ code: 'custom', message: 'origin auth session does not match' });
    }
    if (
      (record.sequence === 1 && record.previousStatus !== null) ||
      (record.sequence > 1 && record.previousStatus === null)
    ) {
      context.addIssue({ code: 'custom', message: 'operation sequence provenance is invalid' });
    }
    const terminal = !['pending-approval', 'queued', 'dispatched'].includes(record.status);
    if (terminal !== (record.settledAt !== null)) {
      context.addIssue({ code: 'custom', message: 'settlement timestamp does not match status' });
    }
    if (
      record.status === 'succeeded' &&
      (record.resultHash === null || record.resultBytes === null || record.errorCode !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'succeeded result metadata is invalid' });
    }
    if (
      record.origin.kind === 'internal-system' &&
      (record.operationKind !== 'system' ||
        record.operationName !== record.origin.systemName ||
        record.pluginGeneration !== record.origin.pluginGeneration ||
        record.fileExecutionKey !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'internal operation provenance is invalid' });
    }
    if (record.origin.kind === 'entry' && record.operationKind === 'system') {
      context.addIssue({ code: 'custom', message: 'entry origin cannot claim a system operation' });
    }
    if (record.origin.kind === 'entry' && record.pluginGeneration !== null) {
      context.addIssue({
        code: 'custom',
        message: 'entry operation cannot persist plugin generation',
      });
    }
  });

export const OperationRecordSchema = OperationRecordObjectSchema;
export const parseOperationRecord = (value: unknown): OperationRecord =>
  OperationRecordSchema.parse(value) as OperationRecord;

const TerminalOperationStatusSchema = z.enum([
  'succeeded',
  'failed',
  'pre-egress-rejected',
  'rejected',
  'outcome-unknown',
  'resolved-applied',
  'resolved-not-applied',
  'abandoned',
]);
const OperationTombstoneObjectSchema = z
  .object({
    actorId: ActorContextSchema.shape.actorId,
    originAuthSessionId: ActorContextSchema.shape.authSessionId,
    origin: OperationOriginV1Schema,
    operationId: z.string().min(1).max(384),
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().nonnegative().safe(),
    operationKind: OperationKindSchema,
    operationName: OperationNameSchema,
    argsHash: PrefixedSha256Schema,
    captureIntentHash: PrefixedSha256Schema,
    operationFingerprintHash: PrefixedSha256Schema,
    workspaceId: WorkspaceIdSchema.nullable(),
    fileExecutionKey: FileExecutionKeySchema.nullable(),
    fileExecutionKeyHash: PrefixedSha256Schema.nullable(),
    targetBindingHash: PrefixedSha256Schema.nullable(),
    resultHash: PrefixedSha256Schema.nullable(),
    operationEvidenceReceiptHash: PrefixedSha256Schema.nullable(),
    finalEgressManifestHash: PrefixedSha256Schema.nullable(),
    leaderGeneration: z.string().min(1).max(256).nullable().optional(),
    errorCode: z.string().min(1).max(256).nullable().optional(),
    settledAt: IsoTimestampSchema.optional(),
    status: TerminalOperationStatusSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const kindMatches =
      (record.operationKind === 'tool' && ToolNameSchema.safeParse(record.operationName).success) ||
      (record.operationKind === 'service' &&
        ServiceOperationNameSchema.safeParse(record.operationName).success) ||
      (record.operationKind === 'system' &&
        SystemOperationNameSchema.safeParse(record.operationName).success);
    if (!kindMatches) {
      context.addIssue({ code: 'custom', message: 'tombstone kind and name do not match' });
    }
    if (record.originAuthSessionId !== record.origin.authSessionId) {
      context.addIssue({ code: 'custom', message: 'tombstone origin auth session does not match' });
    }
    if (record.expiresAt !== record.issuedAt + 2_592_000_000) {
      context.addIssue({ code: 'custom', message: 'tombstone horizon is invalid' });
    }
  });
export const OperationTombstoneSchema = OperationTombstoneObjectSchema;
export const parseOperationTombstone = (value: unknown): OperationTombstone =>
  OperationTombstoneSchema.parse(value) as OperationTombstone;

const OperationResolutionRecordObjectSchema = z
  .object({
    actorId: ActorContextSchema.shape.actorId,
    originAuthSessionId: ActorContextSchema.shape.authSessionId,
    origin: OperationOriginV1Schema,
    resolverAuthSessionId: ActorContextSchema.shape.authSessionId,
    operationId: z.string().min(1).max(384),
    issuedAt: z.number().int().nonnegative().safe(),
    operationKind: OperationKindSchema,
    operationName: OperationNameSchema,
    argsHash: PrefixedSha256Schema,
    captureIntentHash: PrefixedSha256Schema,
    operationFingerprintHash: PrefixedSha256Schema,
    workspaceId: WorkspaceIdSchema.nullable(),
    fileExecutionKey: FileExecutionKeySchema.nullable(),
    fileExecutionKeyHash: PrefixedSha256Schema.nullable(),
    targetBindingHash: PrefixedSha256Schema.nullable(),
    decision: z.enum(['resolved-applied', 'resolved-not-applied', 'abandoned']),
    resultHash: PrefixedSha256Schema.nullable(),
    operationEvidenceReceiptHash: PrefixedSha256Schema.nullable(),
    finalEgressManifestHash: PrefixedSha256Schema.nullable(),
    reasonHash: PrefixedSha256Schema,
    evidenceHash: PrefixedSha256Schema,
    confirmedResultHash: PrefixedSha256Schema.nullable(),
    confirmationHash: PrefixedSha256Schema,
    decidedAt: IsoTimestampSchema,
  })
  .strict();
export const OperationResolutionRecordSchema = OperationResolutionRecordObjectSchema;
export const parseOperationResolutionRecord = (value: unknown): OperationResolutionRecord =>
  OperationResolutionRecordSchema.parse(value) as OperationResolutionRecord;

export interface ToolApprovalHandle {
  readonly __toolApprovalHandle: unique symbol;
}

export interface OperationInvocationService {
  rejectToolBeforeEgress(
    scope: ResolvedInvocationScope,
    toolName: OperationName,
    rawArgs: unknown,
    operationId: string,
    errorCode: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<OperationRecord>;
  beginToolApproval(
    scope: ResolvedInvocationScope,
    toolName: OperationName,
    rawArgs: unknown,
    operationId: string,
    approvalId: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<ToolApprovalHandle>;
  resumeApprovedTool(
    handle: ToolApprovalHandle,
    scope: RuntimeExecutionScope,
    reporter?: ProgressReporter,
  ): Promise<unknown>;
  rejectToolApproval(handle: ToolApprovalHandle, errorCode: string): Promise<OperationRecord>;
  invokeTool(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId?: string,
    options?: Readonly<ToolInvocationOptionsV1>,
    reporter?: ProgressReporter,
  ): Promise<unknown>;
  invokeService(
    scope: RuntimeExecutionScope,
    operationName: ServiceOperationName,
    rawArgs: unknown,
    operationId?: string,
    options?: Readonly<ToolInvocationOptionsV1>,
    reporter?: ProgressReporter,
  ): Promise<unknown>;
  cancel?(principal: Readonly<ActorContext>, request: Readonly<InvocationCancelV1>): Promise<void>;
  status(
    actorId: ActorContext['actorId'],
    operationId: string,
  ): OperationRecord | OperationTombstone | undefined;
}

export interface PreExecutionConsentManifest {
  consentId: string | null;
  mode: EgressMode;
  inputClasses: readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  allowedClasses: readonly DataClass[];
  inputBytes: number;
  inputTokens: number;
  manifestHash: PrefixedSha256;
}

export interface OutputEgressManifest {
  preExecutionManifestHash: PrefixedSha256;
  finalStatus: 'output';
  resultClasses: readonly DataClass[];
  outputBytes: number;
  outputTokens: number;
  redactedFieldCount: number;
  resultHash: PrefixedSha256;
  resultBytes: number;
  payloadHash: PrefixedSha256;
  manifestHash: PrefixedSha256;
}

export interface NoOutputEgressManifest {
  preExecutionManifestHash: PrefixedSha256;
  finalStatus: 'no-output';
  reasonCode: 'admission-rejected' | 'runtime-failed' | 'cancelled' | 'deadline' | 'no-result';
  outputBytes: 0;
  outputTokens: 0;
  manifestHash: PrefixedSha256;
}

export interface OutcomeUnknownEgressManifest {
  preExecutionManifestHash: PrefixedSha256;
  finalStatus: 'outcome-unknown';
  reasonCode: 'post-runtime-durability-failed' | 'transport-lost' | 'demotion' | 'unknown';
  observedOutputBytes: number | null;
  manifestHash: PrefixedSha256;
}

export type EgressFinalManifest =
  | OutputEgressManifest
  | NoOutputEgressManifest
  | OutcomeUnknownEgressManifest;

export const EGRESS_MANIFEST_LIMITS = Object.freeze({
  maxRowBytes: 65_536,
  compactAtRows: 160_000,
  compactAtBytes: 201_326_592,
  maxRowsPerActor: 200_000,
  maxBytesPerActor: 268_435_456,
  retentionDays: 30,
} as const);

export interface EgressManifestRecordV1 {
  schemaVersion: 1;
  requestId: `sfp_req1_${string}`;
  operationId: string;
  sequence: number;
  kind: 'pre-execution' | 'output' | 'no-output' | 'outcome-unknown';
  createdAt: string;
  previousRecordHash: PrefixedSha256 | null;
  manifestHash: PrefixedSha256;
  recordHash: PrefixedSha256;
  manifest: PreExecutionConsentManifest | EgressFinalManifest;
}

export interface EgressReservation {
  actorId: ActorContext['actorId'];
  requestId: `sfp_req1_${string}`;
  operationId: string;
  leaderGeneration: string;
  preManifestHash: PrefixedSha256;
  reservedOutputBytes: 65_536;
}

export interface EgressFinalizerProjectionV1 {
  finalStatus: 'output' | 'no-output' | 'outcome-unknown';
  manifestHash: PrefixedSha256;
  preExecutionManifestHash: PrefixedSha256;
  resultHash: PrefixedSha256 | null;
  reasonCode:
    | NoOutputEgressManifest['reasonCode']
    | OutcomeUnknownEgressManifest['reasonCode']
    | null;
}

export interface EgressManifestPort {
  reservePre(
    actorId: ActorContext['actorId'],
    requestId: `sfp_req1_${string}`,
    operationId: string,
    manifest: PreExecutionConsentManifest,
  ): Promise<EgressReservation>;
  finalize(
    reservation: EgressReservation,
    manifest: EgressFinalManifest,
  ): Promise<{ finalManifestHash: PrefixedSha256; finalized: true }>;
  readVerifiedFinalizer(
    actorId: ActorContext['actorId'],
    operationId: string,
    expectedHash: PrefixedSha256 | null,
  ): Promise<Readonly<EgressFinalizerProjectionV1> | null>;
  recover(now: number): Promise<void>;
  flush(): Promise<void>;
}

export type RawDigest64 = string;
export interface ResultArtifactV1 {
  artifactRelativePath: string;
  artifactDigest64: RawDigest64;
  resultSchemaHash: PrefixedSha256;
}
export type NoArtifactReasonCode =
  | 'not-native-evidence'
  | 'native-output-path-null'
  | 'operation-failed';
export interface NativeArtifactManifestMemberV1 {
  artifactRelativePath: string;
  artifactDigest64: RawDigest64;
  artifactBytes: number;
}
export interface NativeArtifactManifestV1 {
  schemaVersion: 1;
  operationId: string;
  artifacts: readonly NativeArtifactManifestMemberV1[];
  artifactCount: number;
  totalArtifactBytes: number;
  contentHash: PrefixedSha256;
}
export interface NativeEvidenceSourceRefV1 {
  resultPointer: string;
  sourceNodeId: string | null;
}
export type NativeEvidenceContextHash = PrefixedSha256 & {
  readonly __nativeEvidenceContextHash: unique symbol;
};
export interface NativeEvidenceProjectionContextV1 {
  operationId: string;
  workspaceId: string;
}
export type NativeEvidenceProjectionV1 = { contextHash: NativeEvidenceContextHash } & (
  | { kind: 'no-artifact'; reasonCode: 'not-native-evidence' | 'native-output-path-null' }
  | {
      kind: 'export-candidates';
      candidates: readonly {
        candidateRelativePath: string | null;
        sourceRef: NativeEvidenceSourceRefV1;
      }[];
    }
  | {
      kind: 'snapshot-candidate';
      artifactRelativePath: string;
      sourceRef: NativeEvidenceSourceRefV1;
      metadata: {
        workspaceId: string;
        fileIdentityHash: PrefixedSha256;
        snapshotId: `sfp_snap1_${string}`;
        refRelativePath: string;
        checksum: PrefixedSha256;
        fidelity: 'complete-leaf' | 'partial';
        graph?: { relativePath: string; checksum: PrefixedSha256 };
      };
    }
  | {
      kind: 'grounding-graph-candidate';
      artifactRelativePath: string;
      sourceRef: NativeEvidenceSourceRefV1;
      metadata: {
        locator: string;
        checksum: PrefixedSha256;
        fidelity: 'complete-leaf' | 'partial';
      };
    }
);
export type NativeEvidenceV1 =
  | { kind: 'no-artifact'; reasonCode: NoArtifactReasonCode }
  | {
      kind: 'snapshot';
      workspaceId: string;
      fileIdentityHash: PrefixedSha256;
      snapshotId: `sfp_snap1_${string}`;
      refRelativePath: string;
      checksum: PrefixedSha256;
      fidelity: 'complete-leaf' | 'partial';
      artifactRelativePath: string;
      artifactDigest64: RawDigest64;
    }
  | {
      kind: 'grounding-graph';
      locator: string;
      artifactRelativePath: string;
      artifactDigest64: RawDigest64;
      checksum: PrefixedSha256;
      fidelity: 'complete-leaf' | 'partial';
    }
  | {
      kind: 'export';
      manifestRelativePath: string;
      manifestDigest64: RawDigest64;
      artifactCount: number;
      totalArtifactBytes: number;
    };

export interface OperationEvidenceProjector {
  project(
    context: Readonly<NativeEvidenceProjectionContextV1>,
    operationKind: OperationKind,
    operationName: OperationName,
    parsedArgs: unknown,
    strictRedactedResult: unknown,
  ): Readonly<NativeEvidenceProjectionV1>;
}
export type VerifiedNativeEvidenceContextV1 = Readonly<NativeEvidenceProjectionContextV1> & {
  readonly contextHash: NativeEvidenceContextHash;
  readonly __verifiedNativeEvidenceContext: unique symbol;
};
export interface NativeEvidenceArtifactPortContract {
  materializeServiceArtifact?(input: {
    context: VerifiedNativeEvidenceContextV1;
    projection: Readonly<
      Extract<
        NativeEvidenceProjectionV1,
        { kind: 'snapshot-candidate' | 'grounding-graph-candidate' }
      >
    >;
    signal?: AbortSignalLike;
  }): Promise<Readonly<Extract<NativeEvidenceV1, { kind: 'snapshot' | 'grounding-graph' }>>>;
  createNativeManifest(input: {
    context: VerifiedNativeEvidenceContextV1;
    projection: Readonly<Extract<NativeEvidenceProjectionV1, { kind: 'export-candidates' }>>;
    signal?: AbortSignalLike;
  }): Promise<Readonly<Extract<NativeEvidenceV1, { kind: 'export' }>>>;
}
export interface OperationEvidenceArtifactPort {
  createNew(input: {
    workspaceId: string;
    operationId: string;
    intent: import('./invocation.js').VerifiedCaptureIntentV1;
    canonicalRedactedBytes: Uint8Array;
    resultSchemaHash: PrefixedSha256;
    resultHash: PrefixedSha256;
  }): Promise<Readonly<ResultArtifactV1>>;
}

export interface OperationEvidenceReceiptCommonV1 {
  schemaVersion: 1;
  state: 'prepared';
  actorId: ActorContext['actorId'];
  operationId: string;
  operationKind: OperationKind;
  operationName: OperationName;
  argsHash: PrefixedSha256;
  workspaceId: string | null;
  fileExecutionKeyHash: PrefixedSha256 | null;
  targetBindingHash: PrefixedSha256 | null;
  captureIntentHash: PrefixedSha256;
  captureResult: boolean;
  finalizerHash: PrefixedSha256;
  daemonGenerationHash: PrefixedSha256;
  completedAt: string;
  previousReceiptHash: PrefixedSha256 | null;
  contentHash: PrefixedSha256;
  receiptHash: PrefixedSha256;
}
export type OperationEvidenceReceiptV1 = OperationEvidenceReceiptCommonV1 &
  (
    | {
        terminalStatus: 'succeeded';
        captureResult: true;
        resultHash: PrefixedSha256;
        resultBytes: number;
        resultArtifact: ResultArtifactV1;
        nativeEvidence: NativeEvidenceV1;
      }
    | {
        terminalStatus: 'succeeded';
        captureResult: false;
        resultHash: PrefixedSha256;
        resultBytes: number;
        resultArtifact: null;
        nativeEvidence: NativeEvidenceV1;
      }
    | {
        terminalStatus: 'failed';
        resultHash: null;
        resultBytes: 0;
        resultArtifact: null;
        nativeEvidence: { kind: 'no-artifact'; reasonCode: 'operation-failed' };
      }
  );
export type OperationEvidenceReceiptAppendV1 = Omit<
  OperationEvidenceReceiptV1,
  'previousReceiptHash' | 'contentHash' | 'receiptHash'
>;

export const OPERATION_EVIDENCE_LIMITS = Object.freeze({
  maxRowBytes: 65_536,
  maxNativeArtifacts: 256,
  maxNativeArtifactPathBytes: 1_024,
  maxNativeArtifactManifestBytes: 299_836,
  compactAtRows: 100_000,
  compactAtBytes: 134_217_728,
  maxRowsPerActor: 131_072,
  maxBytesPerActor: 201_326_592,
  reservationBytesPerOperation: 65_536,
  retentionDays: 30,
} as const);

export type PreRuntimeOperationAuthorityV1 = Omit<
  OperationRecord,
  'sequence' | 'previousStatus' | 'status' | 'createdAt' | 'settledAt' | 'errorCode'
>;

export interface OperationEvidenceReceiptStorePort {
  reserveBeforeRuntime(
    actorId: ActorContext['actorId'],
    operationId: string,
    projectedBytes: number,
    context?: Readonly<{
      workspaceId: string | null;
      operationAuthority?: Readonly<PreRuntimeOperationAuthorityV1>;
    }>,
  ): Promise<{ reservationId: string; reservedBytes: 65_536 }>;
  prepareAndFsync(
    reservationId: string,
    receipt: OperationEvidenceReceiptAppendV1,
  ): Promise<Readonly<OperationEvidenceReceiptV1>>;
  get(
    actorId: ActorContext['actorId'],
    operationId: string,
  ): Promise<Readonly<OperationEvidenceReceiptV1> | null>;
  recover(): Promise<void>;
  releaseWithoutReceipt(reservationId: string): Promise<void>;
  abortAfterDurableUnknown(reservationId: string): Promise<void>;
}

export interface OperationEvidenceStatusProjectionV1 {
  operationId: string;
  status: OperationStatus;
  operationKind: OperationKind;
  operationName: OperationName;
  operationFingerprintHash: PrefixedSha256;
  resultHash: PrefixedSha256 | null;
  preExecutionConsentManifestHash: PrefixedSha256 | null;
  operationEvidenceReceiptHash: PrefixedSha256 | null;
  finalEgressManifestHash: PrefixedSha256 | null;
}
export type OperationEvidenceReceiptProjectionV1 = Omit<
  OperationEvidenceReceiptV1,
  'state' | 'actorId' | 'previousReceiptHash' | 'receiptHash'
>;
export interface OperationEvidenceViewV1 {
  schemaVersion: 1;
  serverVerified: true;
  statusProjection: OperationEvidenceStatusProjectionV1;
  receipt: Readonly<OperationEvidenceReceiptProjectionV1> | null;
  finalizerProjection: Readonly<EgressFinalizerProjectionV1> | null;
}

export const RawDigest64Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const portableUtf8Bytes = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};
const hasLoneUtf16Surrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
};
export const PortableRelativeArtifactPathSchema = z.string().superRefine((value, context) => {
  const bytes = portableUtf8Bytes(value);
  const segments = value.split('/');
  if (
    bytes < 1 ||
    bytes > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactPathBytes ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    /^[A-Za-z]:/u.test(value) ||
    /["\\]/u.test(value) ||
    hasLoneUtf16Surrogate(value) ||
    [...value].some(character => (character.codePointAt(0) as number) <= 0x1f) ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    context.addIssue({ code: 'custom', message: 'artifact path is not portable and relative' });
  }
});
export const ResultArtifactV1Schema = z
  .object({
    artifactRelativePath: PortableRelativeArtifactPathSchema,
    artifactDigest64: RawDigest64Schema,
    resultSchemaHash: PrefixedSha256Schema,
  })
  .strict();
const NativeEvidenceV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('no-artifact'),
      reasonCode: z.enum(['not-native-evidence', 'native-output-path-null', 'operation-failed']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('export'),
      manifestRelativePath: PortableRelativeArtifactPathSchema,
      manifestDigest64: RawDigest64Schema,
      artifactCount: z.number().int().min(1).max(256),
      totalArtifactBytes: z.number().int().nonnegative().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('snapshot'),
      workspaceId: WorkspaceIdSchema,
      fileIdentityHash: PrefixedSha256Schema,
      snapshotId: z.string().regex(/^sfp_snap1_[A-Za-z0-9_-]{22}$/u),
      refRelativePath: PortableRelativeArtifactPathSchema,
      checksum: PrefixedSha256Schema,
      fidelity: z.enum(['complete-leaf', 'partial']),
      artifactRelativePath: PortableRelativeArtifactPathSchema,
      artifactDigest64: RawDigest64Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('grounding-graph'),
      locator: z.string().min(1).max(4_096),
      artifactRelativePath: PortableRelativeArtifactPathSchema,
      artifactDigest64: RawDigest64Schema,
      checksum: PrefixedSha256Schema,
      fidelity: z.enum(['complete-leaf', 'partial']),
    })
    .strict(),
]);
const OperationEvidenceReceiptBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: z.literal('prepared'),
    actorId: ActorContextSchema.shape.actorId,
    operationId: z.string().min(1).max(384),
    operationKind: OperationKindSchema,
    operationName: OperationNameSchema,
    argsHash: PrefixedSha256Schema,
    workspaceId: WorkspaceIdSchema.nullable(),
    fileExecutionKeyHash: PrefixedSha256Schema.nullable(),
    targetBindingHash: PrefixedSha256Schema.nullable(),
    captureIntentHash: PrefixedSha256Schema,
    captureResult: z.boolean(),
    finalizerHash: PrefixedSha256Schema,
    daemonGenerationHash: PrefixedSha256Schema,
    completedAt: IsoTimestampSchema,
    previousReceiptHash: PrefixedSha256Schema.nullable(),
    contentHash: PrefixedSha256Schema,
    receiptHash: PrefixedSha256Schema,
    terminalStatus: z.enum(['succeeded', 'failed']),
    resultHash: PrefixedSha256Schema.nullable(),
    resultBytes: z.number().int().nonnegative().safe(),
    resultArtifact: ResultArtifactV1Schema.nullable(),
    nativeEvidence: NativeEvidenceV1Schema,
  })
  .strict();
export const OperationEvidenceReceiptV1Schema = OperationEvidenceReceiptBaseSchema.superRefine(
  (receipt, context) => {
    const succeeded = receipt.terminalStatus === 'succeeded';
    if (
      (succeeded && (receipt.resultHash === null || receipt.resultBytes < 0)) ||
      (!succeeded &&
        (receipt.captureResult ||
          receipt.resultHash !== null ||
          receipt.resultBytes !== 0 ||
          receipt.resultArtifact !== null ||
          receipt.nativeEvidence.kind !== 'no-artifact' ||
          receipt.nativeEvidence.reasonCode !== 'operation-failed')) ||
      receipt.captureResult !== (receipt.resultArtifact !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'evidence receipt status fields do not match' });
    }
  },
);

const OperationEvidenceReceiptProjectionSchema = OperationEvidenceReceiptBaseSchema.omit({
  state: true,
  actorId: true,
  previousReceiptHash: true,
  receiptHash: true,
});
const EgressFinalizerProjectionV1Schema = z
  .object({
    finalStatus: z.enum(['output', 'no-output', 'outcome-unknown']),
    manifestHash: PrefixedSha256Schema,
    preExecutionManifestHash: PrefixedSha256Schema,
    resultHash: PrefixedSha256Schema.nullable(),
    reasonCode: z
      .enum([
        'admission-rejected',
        'runtime-failed',
        'cancelled',
        'deadline',
        'no-result',
        'post-runtime-durability-failed',
        'transport-lost',
        'demotion',
        'unknown',
      ])
      .nullable(),
  })
  .strict();
export const OperationEvidenceViewV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    serverVerified: z.literal(true),
    statusProjection: z
      .object({
        operationId: z.string().min(1).max(384),
        status: OperationStatusSchema,
        operationKind: OperationKindSchema,
        operationName: OperationNameSchema,
        operationFingerprintHash: PrefixedSha256Schema,
        resultHash: PrefixedSha256Schema.nullable(),
        preExecutionConsentManifestHash: PrefixedSha256Schema.nullable(),
        operationEvidenceReceiptHash: PrefixedSha256Schema.nullable(),
        finalEgressManifestHash: PrefixedSha256Schema.nullable(),
      })
      .strict(),
    receipt: OperationEvidenceReceiptProjectionSchema.nullable(),
    finalizerProjection: EgressFinalizerProjectionV1Schema.nullable(),
  })
  .strict();
