import { createHash } from 'node:crypto';

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
} from '@sfp/shared';

import { evaluateOperationPolicy } from '../policy/policy-engine.js';
import { resultEgressPolicyFor } from '../policy/result-egress-policy.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';
import { executeToolRuntime, type RuntimeRegistry } from '../tools/runtime-registry.js';
import type { FileExecutionQueue } from './file-queue.js';
import type { OperationIdIssuer } from './operation-id.js';
import {
  hashOperationFingerprint,
  type NewOperationRecord,
  type OperationJournal,
} from './operation-journal.js';

export interface OperationJournalPort {
  appendInitial(
    record: NewOperationRecord,
    status: OperationRecord['status'],
  ): Promise<OperationRecord>;
  transition(
    operationId: string,
    status: OperationRecord['status'],
    patch?: Partial<Pick<OperationRecord, 'resultHash' | 'resultBytes' | 'errorCode'>>,
  ): Promise<OperationRecord>;
  get(operationId: string): OperationRecord | OperationTombstone | undefined;
}

export interface OperationExecutorOptions {
  issuer: OperationIdIssuer;
  journal: OperationJournalPort | OperationJournal;
  queue: FileExecutionQueue;
  runtimes: RuntimeRegistry;
  now?: () => number;
  replayAudit?: (record: Readonly<Record<string, unknown>>) => void;
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
      'settledAt' in record
        ? (record.settledAt ?? record.createdAt)
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

export class OperationExecutor {
  private readonly inflight = new Map<string, InflightOperation>();
  private readonly completed = new Map<string, CompletedCacheEntry>();
  private readonly approvals = new WeakMap<object, ApprovalBinding>();
  private completedBytes = 0;
  private readonly now: () => number;

  constructor(private readonly options: OperationExecutorOptions) {
    this.now = options.now ?? Date.now;
  }

  invokeTool(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    rawArgs: unknown,
    suppliedOperationId?: string,
    invocationOptions: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
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

    const promise = this.executeNew(prepared, key);
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
      );
    }
    const handle = Object.freeze({}) as ToolApprovalHandle;
    this.approvals.set(handle, { prepared });
    return handle;
  }

  async resumeApprovedTool(
    handle: ToolApprovalHandle,
    scope: RuntimeExecutionScope,
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
    const promise = this.executeApproved(prepared, key);
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
    return await this.options.journal.transition(prepared.operationId, 'pre-egress-rejected', {
      errorCode,
    });
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
  ): Promise<unknown> {
    const policyDecision = evaluateOperationPolicy(
      prepared.toolName,
      prepared.parsedArgs,
      prepared.scope,
    );
    await this.options.journal.appendInitial(
      this.initialRecord(prepared, policyDecision, null),
      'queued',
    );
    return this.runQueued(prepared, policyDecision, cacheKey);
  }

  private async executeApproved(
    prepared: PreparedRuntimeInvocation,
    cacheKey: string,
  ): Promise<unknown> {
    const policyDecision = evaluateOperationPolicy(
      prepared.toolName,
      prepared.parsedArgs,
      prepared.scope,
    );
    await this.options.journal.transition(prepared.operationId, 'queued');
    return this.runQueued(prepared, policyDecision, cacheKey);
  }

  private runQueued(
    prepared: PreparedRuntimeInvocation,
    policyDecision: ReturnType<typeof evaluateOperationPolicy>,
    cacheKey: string,
  ): Promise<unknown> {
    return this.options.queue.run(
      prepared.scope.target.fileExecutionKey,
      policyDecision.concurrency,
      async () => {
        await this.options.journal.transition(prepared.operationId, 'dispatched');
        let runtimeCompleted = false;
        try {
          const validated = await executeToolRuntime(
            prepared.toolName,
            prepared.scope,
            prepared.parsedArgs,
            new AbortController().signal,
            this.options.runtimes,
          );
          runtimeCompleted = true;
          const egress = resultEgressPolicyFor(prepared.toolName);
          const redacted = egress.redactResult(
            validated as Readonly<Record<string, unknown>>,
            prepared.scope.consent.allowedClasses,
          );
          const canonicalRedactedResultBytes = Buffer.from(canonicalJson(redacted), 'utf8');
          const resultHash = hash(null, canonicalRedactedResultBytes);
          await this.options.journal.transition(prepared.operationId, 'succeeded', {
            resultHash,
            resultBytes: canonicalRedactedResultBytes.byteLength,
          });
          this.cacheCompleted(
            cacheKey,
            prepared,
            canonicalRedactedResultBytes,
            this.resultSchemaHash(prepared.toolName),
          );
          return JSON.parse(canonicalRedactedResultBytes.toString('utf8'));
        } catch (error) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'RUNTIME_FAILED';
          const current = this.options.journal.get(prepared.operationId);
          if (current?.status === 'dispatched') {
            await this.options.journal.transition(
              prepared.operationId,
              runtimeCompleted ? 'outcome-unknown' : 'failed',
              {
                errorCode: runtimeCompleted ? 'OPERATION_TERMINAL_DURABILITY_FAILED' : code,
              },
            );
          }
          throw error;
        }
      },
    );
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
