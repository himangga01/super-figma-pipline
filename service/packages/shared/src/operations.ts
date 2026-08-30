import { z } from 'zod';

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
import {
  ServiceOperationNameSchema,
  SystemOperationNameSchema,
  type OperationKind,
  type ServiceOperationName,
  type SystemOperationName,
} from './service-operations.js';

/** A side effect resolved from already-parsed tool arguments. */
export type Effect =
  | { type: 'figma-read' }
  | { type: 'figma-write'; destructive: boolean; broad: boolean }
  | { type: 'figma-ui' }
  | { type: 'figma-library-import' }
  | { type: 'filesystem-read'; pathArgs: readonly string[] }
  | { type: 'filesystem-write'; pathArgs: readonly string[]; destructive: boolean }
  | { type: 'network'; urlArg: string };

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
  beginToolApproval(
    scope: ResolvedInvocationScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId: string,
    approvalId: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<ToolApprovalHandle>;
  resumeApprovedTool(handle: ToolApprovalHandle, scope: RuntimeExecutionScope): Promise<unknown>;
  rejectToolApproval(handle: ToolApprovalHandle, errorCode: string): Promise<OperationRecord>;
  invokeTool(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId?: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<unknown>;
  invokeService(
    scope: RuntimeExecutionScope,
    operationName: ServiceOperationName,
    rawArgs: unknown,
    operationId?: string,
  ): Promise<unknown>;
  status(
    actorId: ActorContext['actorId'],
    operationId: string,
  ): OperationRecord | OperationTombstone | undefined;
}
