import { join } from 'node:path';

import {
  ALL_DATA_CLASSES,
  Base64Url128Schema,
  FileIdentitySchema,
  canonicalFileIdentityHash,
  type FileIdentity,
  NO_CAPTURE_OPTIONS,
  parseActorContext,
  parseInvocationRequest,
  parseInvocationTargetSelector,
  InvocationCancelV1Schema,
  validateToolInvocationOptions,
  type ActorContext,
  type ConsentContext,
  type InvocationEffectV1,
  type InvocationRequestV1,
  type InvocationCancelV1,
  type InvocationFrameV1,
  type InvocationTargetSelector,
  type OperationInvocationService,
  type PluginTarget,
  type ResolvedInvocationScope,
  type RuntimeExecutionScope,
  type TargetRequirement,
  type ToolInvocationOptionsV1,
  type ToolName,
  type OperationName,
  ServiceOperationRequestV1Schema,
  ServiceOperationNameSchema,
  type PolicyInvocationContext,
  type WorkspaceInvocationContext,
  type WorkspacePolicy,
  INVOCATION_ADMISSION_LIMITS,
  BoundedInvocationFrameChannel,
  measureCanonicalJsonUtf8Bytes,
  OperationProgressBroadcaster,
  OperationProgressRegistry,
  safeInvocationError,
  type ProgressReporter,
} from '@sfp/shared';

import { designDiffRelativePath } from '../diff/baseline-identity.js';
import { operationPolicyFor } from '../policy/operation-policy.js';
import { evaluateOperationPolicy, type EvaluatedOperationPolicy } from '../policy/policy-engine.js';
import { resultEgressPolicyFor } from '../policy/result-egress-policy.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';
import type { ToolSpec } from '../tools/spec.js';
import type { ExecutableOperations } from './executable-operation.js';
import type { LeaderDemotionCapability, OperationJournal } from './operation-journal.js';

export const followerPingTimeoutForPlatform = (platform: NodeJS.Platform): number =>
  platform === 'win32' ? 5_000 : 2_000;

export interface DemotionTicket {
  leaderGeneration: string;
  startedAt: number;
  deadlineAt: number;
  transportDrainDeadlineAt: number;
}

export interface ExecutionPlaneLifecyclePorts {
  closeAdmission(): Promise<void> | void;
  installGenerationFence(): Promise<void> | void;
  abortPending(): Promise<void>;
  abortQueued(): Promise<void>;
  markDispatchedOutcomeUnknown(): Promise<void>;
  finalizeAndFlushEgress(): Promise<void>;
  drainTransport(deadlineAt: number): Promise<boolean>;
  forceCloseTransport(): Promise<void> | void;
  destroy(): Promise<void> | void;
  releasePort(signal: AbortSignal): Promise<void> | void;
}

export const createDurableExecutionPlaneLifecyclePorts = (input: {
  leaderGeneration: string;
  journal:
    | Pick<OperationJournal, 'fenceLeaderGeneration' | 'settleLeaderGeneration' | 'flush'>
    | (() =>
        | Pick<OperationJournal, 'fenceLeaderGeneration' | 'settleLeaderGeneration' | 'flush'>
        | undefined);
  abortGeneration?(capability: LeaderDemotionCapability): Promise<void>;
  flushDurability(): Promise<unknown>;
  drainTransport(deadlineAt: number): Promise<boolean>;
  forceCloseTransport(): Promise<unknown> | unknown;
  destroy(): Promise<unknown> | unknown;
  releasePort(signal: AbortSignal): Promise<unknown> | unknown;
}): ExecutionPlaneLifecyclePorts => {
  let demotionCapability: LeaderDemotionCapability | null = null;
  const journal = () => (typeof input.journal === 'function' ? input.journal() : input.journal);
  const settle = async (
    from: 'pending-approval' | 'queued' | 'dispatched',
    to: 'pre-egress-rejected' | 'failed' | 'outcome-unknown',
  ): Promise<void> => {
    const authority = journal();
    if (authority === undefined) return;
    if (demotionCapability === null) {
      throw Object.assign(new Error('demotion fence capability is unavailable'), {
        code: 'LEADER_GENERATION_MISMATCH',
      });
    }
    await authority.settleLeaderGeneration(
      demotionCapability,
      input.leaderGeneration,
      from,
      to,
      'LEADER_GENERATION_CLOSED',
    );
  };
  return Object.freeze({
    closeAdmission: () => undefined,
    installGenerationFence: async () => {
      const authority = journal();
      if (authority !== undefined) {
        demotionCapability = await authority.fenceLeaderGeneration(input.leaderGeneration);
      }
    },
    abortPending: async () => {
      if (demotionCapability !== null) await input.abortGeneration?.(demotionCapability);
      await settle('pending-approval', 'pre-egress-rejected');
    },
    abortQueued: () => settle('queued', 'failed'),
    markDispatchedOutcomeUnknown: () => settle('dispatched', 'outcome-unknown'),
    finalizeAndFlushEgress: async () => {
      await journal()?.flush();
      await input.flushDurability();
    },
    drainTransport: input.drainTransport,
    forceCloseTransport: async () => {
      await input.forceCloseTransport();
    },
    destroy: async () => {
      await input.destroy();
    },
    releasePort: async (signal: AbortSignal) => {
      await input.releasePort(signal);
    },
  });
};

export interface ApprovalDecisionPort {
  cancel?(operationId: string): void;
  request(
    scope: ResolvedInvocationScope,
    operationName: ToolName,
    effects: readonly InvocationEffectV1[],
    operationId: string,
  ): Promise<Readonly<{
    approvalId: string;
    waitForDecision(): Promise<
      Readonly<{
        decision: 'approved' | 'rejected' | 'expired';
        actorId?: ActorContext['actorId'];
        operationId?: string;
        decidedAt?: string;
      }>
    >;
  }> | null>;
}

export interface EgressManifestPort {
  recover(now: number): Promise<void>;
  flush(): Promise<void>;
}

export interface TargetResolverPort {
  resolve(
    selector: InvocationTargetSelector,
    requirement: TargetRequirement,
  ): Readonly<PluginTarget>;
}

export interface ExecutionPlaneAdmissionAuthority {
  operations?: ExecutableOperations;
  resolveToolAuthority?(input: {
    name: string;
    args: Readonly<Record<string, unknown>>;
    principal: Readonly<ActorContext>;
    workspaceId: string | null;
    operationId: string;
    targetSelector: InvocationTargetSelector;
  }): Promise<
    | {
        workspace: WorkspaceInvocationContext;
        portalAuthority: NonNullable<ResolvedInvocationScope['portalAuthority']>;
        resolvedPaths: NonNullable<ResolvedInvocationScope['resolvedPaths']>;
        approvalLabel: string;
        target?: Readonly<PluginTarget>;
      }
    | undefined
  >;
  resolveWorkspaceContext(workspaceId: string | null): Promise<WorkspaceInvocationContext>;
  workspacePolicy: WorkspacePolicy;
  targetResolver: TargetResolverPort;
  approval: ApprovalDecisionPort;
  authorizeEgress(input: {
    principal: Readonly<ActorContext>;
    request: Readonly<Omit<InvocationRequestV1, 'toolName'> & { toolName: OperationName }>;
    scope: Readonly<ResolvedInvocationScope>;
    policy: Readonly<EvaluatedOperationPolicy>;
    parsedArgs: Readonly<Record<string, unknown>>;
    inputClasses: readonly (typeof ALL_DATA_CLASSES)[number][];
    possibleResultClasses: readonly (typeof ALL_DATA_CLASSES)[number][];
  }): Promise<ConsentContext>;
  issueOperationId(actorId: ActorContext['actorId']): string;
  verifyOperationId(actorId: ActorContext['actorId'], operationId: string): void;
}

export interface InvocationAdmissionHandle {
  readonly ownerId: string;
  readonly authSessionId: string;
  readonly requestId: string;
  release(): void;
}

export interface LazyLeaderRuntimeBoundary<T> {
  get(): Promise<T>;
  peek(): T | undefined;
}

export class GenerationRetentionCoordinator {
  private flight: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly runSweep: () => Promise<void>) {}

  sweep(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        Object.assign(new Error('leader generation retention is closed'), {
          code: 'LEADER_GENERATION_CLOSED',
        }),
      );
    }
    if (this.flight !== null) return this.flight;
    const settled = Promise.resolve()
      .then(this.runSweep)
      .finally(() => {
        if (this.flight === settled) this.flight = null;
      });
    this.flight = settled;
    return settled;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flight;
  }
}

export class GenerationRuntimeLifecycleRegistry<T extends { close(): Promise<void> }> {
  private readonly states = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<T>;
      closing: boolean;
      closed: boolean;
    }
  >();

  constructor(private readonly options: { closeTimeoutMs?: number } = {}) {
    const timeout = options.closeTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
      throw Object.assign(new Error('generation runtime close timeout is invalid'), {
        code: 'LEADER_GENERATION_CLOSE_TIMEOUT_INVALID',
      });
    }
  }

  initialize(generation: string, initialize: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = this.states.get(generation);
    if (existing !== undefined) return existing.promise;
    const controller = new AbortController();
    const state = {
      controller,
      promise: Promise.resolve(undefined as never) as Promise<T>,
      closing: false,
      closed: false,
    };
    let initialized: Promise<T>;
    try {
      initialized = Promise.resolve(initialize(controller.signal));
    } catch (error) {
      initialized = Promise.reject(error);
    }
    state.promise = initialized
      .then(async runtime => {
        if (state.closing || controller.signal.aborted) {
          if (!state.closed) {
            state.closed = true;
            await runtime.close();
          }
          throw Object.assign(new Error('leader generation closed during initialization'), {
            code: 'LEADER_GENERATION_CLOSED',
          });
        }
        return runtime;
      })
      .catch(error => {
        if (!state.closing && this.states.get(generation) === state) this.states.delete(generation);
        throw error;
      });
    this.states.set(generation, state);
    void state.promise
      .finally(() => {
        if (state.closing && this.states.get(generation) === state) this.states.delete(generation);
      })
      .catch(() => undefined);
    return state.promise;
  }

  get(generation: string): Promise<T> | undefined {
    return this.states.get(generation)?.promise;
  }

  async close(generation: string): Promise<void> {
    const state = this.states.get(generation);
    if (state === undefined) return;
    state.closing = true;
    state.controller.abort(
      Object.assign(new Error('leader generation is closing'), {
        code: 'LEADER_GENERATION_CLOSED',
      }),
    );
    const settle = async (): Promise<void> => {
      const runtime = await state.promise;
      if (!state.closed) {
        state.closed = true;
        await runtime.close();
      }
    };
    const normalized = settle().catch(error => {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'LEADER_GENERATION_CLOSED'
      ) {
        throw error;
      }
    });
    const timeoutMs = this.options.closeTimeoutMs ?? 5_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      normalized.then(() => 'closed' as const),
      new Promise<'timeout'>(resolve => {
        timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    if (outcome === 'timeout') {
      throw Object.assign(new Error('leader generation close timed out'), {
        code: 'LEADER_GENERATION_CLOSE_TIMEOUT',
      });
    }
    if (this.states.get(generation) === state) this.states.delete(generation);
  }
}

export const createLazyLeaderRuntimeBoundary = <T>(
  initialize: () => Promise<T>,
): LazyLeaderRuntimeBoundary<T> => {
  let flight: Promise<T> | null = null;
  let resolved: T | undefined;
  return Object.freeze({
    get: (): Promise<T> => {
      if (flight === null) {
        try {
          flight = initialize().then(value => {
            resolved = value;
            return value;
          });
        } catch (error) {
          flight = Promise.reject(error);
        }
      }
      return flight;
    },
    peek: (): T | undefined => resolved,
  });
};

const nativeAdmissionError = (code: string, message: string) =>
  Object.assign(new Error(message), { code, admitted: false });

export class InvocationAdmissionController {
  private readonly activeOwners = new Map<string, number>();
  private readonly activeSessions = new Map<string, number>();
  private readonly rawArgsOwners = new Map<string, number>();
  private readonly activeRequestIds = new Set<string>();
  private readonly operationSubscribers = new Map<string, number>();
  private readonly ownerSubscribers = new Map<string, number>();

  admit(input: {
    ownerId: string;
    authSessionId: string;
    requestId: string;
    rawArgsBytes: number;
  }): InvocationAdmissionHandle {
    if (!Number.isSafeInteger(input.rawArgsBytes) || input.rawArgsBytes < 0) {
      throw nativeAdmissionError('INVOCATION_TOO_LARGE', 'raw argument byte count is invalid');
    }
    if (input.rawArgsBytes > INVOCATION_ADMISSION_LIMITS.maxRawArgsBytesPerOperation) {
      throw nativeAdmissionError('INVOCATION_TOO_LARGE', 'raw arguments exceed the operation cap');
    }
    const requestKey = `${input.ownerId}\0${input.requestId}`;
    if (this.activeRequestIds.has(requestKey)) {
      throw nativeAdmissionError('REQUEST_ID_CONFLICT', 'request ID is already active');
    }
    const sessionKey = `${input.ownerId}\0${input.authSessionId}`;
    const ownerActive = this.activeOwners.get(input.ownerId) ?? 0;
    const sessionActive = this.activeSessions.get(sessionKey) ?? 0;
    const ownerBytes = this.rawArgsOwners.get(input.ownerId) ?? 0;
    if (
      ownerActive >= INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner ||
      sessionActive >= INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerAuthSession
    ) {
      throw nativeAdmissionError('SERVER_BUSY', 'active operation capacity is full');
    }
    if (ownerBytes + input.rawArgsBytes > INVOCATION_ADMISSION_LIMITS.maxRawArgsBytesPerOwner) {
      throw nativeAdmissionError('SERVER_BUSY', 'retained raw argument capacity is full');
    }
    this.activeRequestIds.add(requestKey);
    this.activeOwners.set(input.ownerId, ownerActive + 1);
    this.activeSessions.set(sessionKey, sessionActive + 1);
    this.rawArgsOwners.set(input.ownerId, ownerBytes + input.rawArgsBytes);
    let released = false;
    return Object.freeze({
      ownerId: input.ownerId,
      authSessionId: input.authSessionId,
      requestId: input.requestId,
      release: () => {
        if (released) return;
        released = true;
        this.activeRequestIds.delete(requestKey);
        this.decrement(this.activeOwners, input.ownerId);
        this.decrement(this.activeSessions, sessionKey);
        this.rawArgsOwners.set(
          input.ownerId,
          Math.max(0, (this.rawArgsOwners.get(input.ownerId) ?? 0) - input.rawArgsBytes),
        );
      },
    });
  }

  subscribe(input: { ownerId: string; operationId: string }): { release(): void } {
    const operationKey = `${input.ownerId}\0${input.operationId}`;
    const operationCount = this.operationSubscribers.get(operationKey) ?? 0;
    const ownerCount = this.ownerSubscribers.get(input.ownerId) ?? 0;
    if (
      operationCount >= INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOperation ||
      ownerCount >= INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOwner
    ) {
      throw nativeAdmissionError('SERVER_BUSY', 'subscriber capacity is full');
    }
    this.operationSubscribers.set(operationKey, operationCount + 1);
    this.ownerSubscribers.set(input.ownerId, ownerCount + 1);
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        this.decrement(this.operationSubscribers, operationKey);
        this.decrement(this.ownerSubscribers, input.ownerId);
      },
    });
  }

  retainedRawArgsBytes(ownerId: string): number {
    return this.rawArgsOwners.get(ownerId) ?? 0;
  }

  private decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 1) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const freezeWorkspace = (
  requestedWorkspaceId: string | null,
  workspace: WorkspaceInvocationContext,
): Readonly<WorkspaceInvocationContext> => {
  if (
    workspace.workspaceId !== requestedWorkspaceId ||
    (requestedWorkspaceId === null
      ? workspace.workspaceRoot !== null
      : typeof workspace.workspaceRoot !== 'string' || workspace.workspaceRoot.length === 0)
  ) {
    throw Object.assign(new Error('workspace authority returned a mismatched binding'), {
      code: 'INVOCATION_WORKSPACE_INVALID',
    });
  }
  return Object.freeze({ ...workspace });
};

const freezeVerifiedTarget = (target: Readonly<PluginTarget>): Readonly<PluginTarget> => {
  if (target.sessionId === null) {
    if (
      target.pluginGeneration !== null ||
      target.fileIdentity !== null ||
      target.fileExecutionKey !== null
    ) {
      throw Object.assign(new Error('empty plugin target is internally inconsistent'), {
        code: 'INVOCATION_TARGET_INVALID',
      });
    }
    return Object.freeze({
      sessionId: null,
      pluginGeneration: null,
      fileIdentity: null,
      fileExecutionKey: null,
      editorType: null,
      capabilities: null,
    });
  }
  if (
    !Base64Url128Schema.safeParse(target.sessionId).success ||
    typeof target.pluginGeneration !== 'string' ||
    target.pluginGeneration.length === 0
  ) {
    throw Object.assign(new Error('resolved plugin target is invalid'), {
      code: 'INVOCATION_TARGET_INVALID',
    });
  }
  const identity = FileIdentitySchema.safeParse(target.fileIdentity);
  if (
    !identity.success ||
    !['figma', 'figjam', 'dev'].includes(target.editorType ?? '') ||
    !Array.isArray(target.capabilities) ||
    target.capabilities.length > 1_024 ||
    target.capabilities.some(
      capability =>
        typeof capability !== 'string' || capability.length < 1 || capability.length > 256,
    )
  ) {
    throw Object.assign(new Error('resolved plugin file identity is invalid'), {
      code: 'INVOCATION_TARGET_INVALID',
      cause: identity.error,
    });
  }
  const fileIdentity = Object.freeze(identity.data);
  const expectedKey =
    fileIdentity.kind === 'figma-file-key'
      ? `figma:${fileIdentity.value}`
      : fileIdentity.kind === 'document-plugin-uuid'
        ? `plugin-uuid:${fileIdentity.value}`
        : fileIdentity.sessionId === target.sessionId &&
            fileIdentity.pluginGeneration === target.pluginGeneration
          ? `unstable:${target.sessionId}:${target.pluginGeneration}`
          : null;
  if (expectedKey === null || target.fileExecutionKey !== expectedKey) {
    throw Object.assign(new Error('resolved plugin execution key is inconsistent'), {
      code: 'INVOCATION_TARGET_INVALID',
    });
  }
  return Object.freeze({
    sessionId: target.sessionId,
    pluginGeneration: target.pluginGeneration,
    fileIdentity,
    fileExecutionKey: expectedKey,
    editorType: target.editorType as 'figma' | 'figjam' | 'dev',
    capabilities: Object.freeze([...(target.capabilities as readonly string[])]),
  });
};

const freezeConsent = (value: ConsentContext): Readonly<ConsentContext> => {
  const allowedClasses = ALL_DATA_CLASSES.filter(dataClass =>
    value.allowedClasses.includes(dataClass),
  );
  if (
    !['local-trusted', 'external-model'].includes(value.mode) ||
    allowedClasses.length !== value.allowedClasses.length ||
    new Set(value.allowedClasses).size !== value.allowedClasses.length ||
    (value.mode === 'local-trusted'
      ? value.consentId !== null || allowedClasses.length !== ALL_DATA_CLASSES.length
      : typeof value.consentId !== 'string' ||
        value.consentId.length === 0 ||
        allowedClasses.includes('secret'))
  ) {
    throw Object.assign(new Error('egress authority returned an invalid consent'), {
      code: 'INVOCATION_CONSENT_INVALID',
    });
  }
  return Object.freeze({
    mode: value.mode,
    consentId: value.consentId,
    allowedClasses: Object.freeze(allowedClasses),
  });
};

export class LeaderGenerationExecutionPlane {
  private preparation: Promise<DemotionTicket> | null = null;
  private preparedTicket: DemotionTicket | null = null;
  private durabilitySatisfied = false;
  private finalized = false;
  private finalization: Promise<'port-released' | 'port-retained-durability-failure'> | null = null;
  private accepting = true;
  private invocationService: OperationInvocationService | null = null;
  private admissionAuthority: ExecutionPlaneAdmissionAuthority | null = null;
  private readonly invocationAdmission = new InvocationAdmissionController();
  private readonly progressRegistry = new OperationProgressRegistry();
  private readonly activeBroadcasters = new Map<OperationProgressBroadcaster, number>();
  private readonly streamDrainWaiters = new Set<() => void>();

  constructor(
    readonly leaderGeneration: string,
    private readonly ports: ExecutionPlaneLifecyclePorts,
    private readonly now: () => number = Date.now,
  ) {}

  get admissionOpen(): boolean {
    return this.accepting;
  }

  bindInvocationService(service: OperationInvocationService): void {
    if (this.invocationService !== null) {
      throw Object.assign(new Error('execution plane invocation service is already bound'), {
        code: 'EXECUTION_PLANE_ALREADY_BOUND',
      });
    }
    if (!this.accepting) {
      throw Object.assign(new Error('leader generation is closed'), {
        code: 'LEADER_GENERATION_CLOSED',
      });
    }
    this.invocationService = service;
  }

  bindAdmissionAuthority(authority: ExecutionPlaneAdmissionAuthority): void {
    if (this.admissionAuthority !== null) {
      throw Object.assign(new Error('execution plane admission authority is already bound'), {
        code: 'EXECUTION_PLANE_ALREADY_BOUND',
      });
    }
    if (!this.accepting) {
      throw Object.assign(new Error('leader generation is closed'), {
        code: 'LEADER_GENERATION_CLOSED',
      });
    }
    this.admissionAuthority = authority;
  }

  invokeTool(
    principal: Readonly<ActorContext>,
    request: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    return this.invokeOperation(principal, request, options, reporter, false);
  }
  invokeService(
    principal: Readonly<ActorContext>,
    request: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    return this.invokeOperation(principal, request, options, reporter, true);
  }

  private async invokeOperation(
    untrustedPrincipal: Readonly<ActorContext>,
    untrustedRequest: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    reporter?: ProgressReporter,
    service = false,
  ): Promise<unknown> {
    if (!this.accepting) {
      return Promise.reject(
        Object.assign(new Error('leader generation is closed'), {
          code: 'LEADER_GENERATION_CLOSED',
        }),
      );
    }
    const principal = parseActorContext(untrustedPrincipal);
    if (
      principal.entryPath === 'internal-system' ||
      (service && principal.entryPath !== 'control')
    ) {
      throw Object.assign(new Error('public tool admission cannot use an internal principal'), {
        code: 'INVOCATION_PRINCIPAL_INVALID',
      });
    }
    const rawArgsCandidate =
      typeof untrustedRequest === 'object' &&
      untrustedRequest !== null &&
      !Array.isArray(untrustedRequest) &&
      'rawArgs' in untrustedRequest
        ? untrustedRequest.rawArgs
        : {};
    const retainedArgsBytes = measureCanonicalJsonUtf8Bytes(
      rawArgsCandidate ?? {},
      INVOCATION_ADMISSION_LIMITS.maxRawArgsBytesPerOperation,
    );
    const request = service
      ? (() => {
          const input = ServiceOperationRequestV1Schema.parse(untrustedRequest);
          return { ...input, toolName: input.serviceOperationName };
        })()
      : parseInvocationRequest(untrustedRequest);
    const admission = this.invocationAdmission.admit({
      ownerId: principal.actorId,
      authSessionId: principal.authSessionId,
      requestId: request.requestId as `sfp_req1_${string}`,
      rawArgsBytes: retainedArgsBytes,
    });
    try {
      if (this.invocationService === null || this.admissionAuthority === null) {
        throw Object.assign(new Error('execution plane authorities are not bound'), {
          code: 'EXECUTION_PLANE_UNBOUND',
        });
      }
      const extension = service
        ? this.admissionAuthority.operations?.[request.toolName]
        : undefined;
      if (service && extension?.operationKind !== 'service')
        throw Object.assign(new Error('service operation missing'), {
          code: 'SERVICE_OPERATION_NOT_FOUND',
        });
      const spec =
        extension ?? ALL_TOOL_SPECS.find(candidate => candidate.name === request.toolName);
      if (spec === undefined) {
        throw Object.assign(new Error('unknown tool'), { code: 'TOOL_NOT_FOUND' });
      }
      const rawArgs = request.rawArgs ?? {};
      if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
        const declaredKeys = new Set(Object.keys(spec.inputSchema.shape));
        if (Object.keys(rawArgs).some(key => !declaredKeys.has(key))) {
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
      const parsedArgs = deepFreeze(parsed.data) as Readonly<Record<string, unknown>>;
      const requestedWorkspaceId = request.workspaceId ?? null;
      const operationId =
        request.operationId ?? this.admissionAuthority.issueOperationId(principal.actorId);
      this.admissionAuthority.verifyOperationId(principal.actorId, operationId);
      const toolAuthority =
        extension === undefined
          ? await this.admissionAuthority.resolveToolAuthority?.({
              name: spec.name,
              args: parsedArgs,
              principal,
              workspaceId: requestedWorkspaceId,
              operationId,
              targetSelector: parseInvocationTargetSelector(request.targetSelector),
            })
          : undefined;
      const workspace = freezeWorkspace(
        toolAuthority === undefined ? requestedWorkspaceId : toolAuthority.workspace.workspaceId,
        toolAuthority?.workspace ??
          (await this.admissionAuthority.resolveWorkspaceContext(requestedWorkspaceId)),
      );
      const targetResolver = this.admissionAuthority.targetResolver;
      const resolveTarget = () =>
        freezeVerifiedTarget(
          toolAuthority?.target ??
            targetResolver.resolve(
              parseInvocationTargetSelector(request.targetSelector),
              spec.targetRequirementFor(parsedArgs),
            ),
        );
      // Persistent diff paths must bind the same target used for execution, before approval.
      const earlyTarget = spec.name === 'design_diff' || service ? resolveTarget() : undefined;
      const resolved =
        extension?.resolveScope === undefined
          ? undefined
          : await extension.resolveScope({
              workspace,
              target: earlyTarget!,
              operationId,
              args: parsedArgs,
              workspacePolicy: this.admissionAuthority.workspacePolicy,
            });
      const policyContext =
        toolAuthority !== undefined
          ? {
              workspace,
              resolvedPaths: toolAuthority.resolvedPaths,
              ...(toolAuthority.portalAuthority.captureSource
                ? { portalCaptureSource: toolAuthority.portalAuthority.captureSource.kind }
                : {}),
            }
          : extension !== undefined
            ? {
                workspace,
                ...(resolved === undefined ? {} : { resolvedPaths: resolved.resolvedPaths }),
              }
            : await resolvePolicyInvocationContext(
                spec as ToolSpec<unknown, unknown>,
                parsedArgs,
                workspace,
                this.admissionAuthority.workspacePolicy,
                earlyTarget?.fileIdentity ?? undefined,
              );
      const policy = evaluateOperationPolicy(
        request.toolName,
        parsedArgs,
        policyContext,
        extension?.policy,
      );
      const target = earlyTarget ?? resolveTarget();
      const resolvedScope = deepFreeze({
        requestId: request.requestId,
        leaderGeneration: this.leaderGeneration,
        actor: principal,
        ...(toolAuthority === undefined
          ? {}
          : {
              portalAuthority: toolAuthority.portalAuthority,
              approvalLabel: toolAuthority.approvalLabel,
            }),
        workspace: policyContext.workspace,
        ...(policyContext.resolvedPaths === undefined
          ? {}
          : { resolvedPaths: policyContext.resolvedPaths }),
        target,
        ...(resolved === undefined ? {} : { evidenceWrites: resolved.evidenceWrites }),
      }) as Readonly<ResolvedInvocationScope>;
      const verifiedOptions = validateToolInvocationOptions(
        options,
        operationId,
        workspace.workspaceId,
      );
      let approvalHandle: Awaited<
        ReturnType<OperationInvocationService['beginToolApproval']>
      > | null = null;
      if (policy.approval !== 'none') {
        let pending: Awaited<ReturnType<ApprovalDecisionPort['request']>>;
        try {
          pending = await this.admissionAuthority.approval.request(
            resolvedScope,
            request.toolName,
            [...policy.effects, ...(resolvedScope.evidenceWrites ?? [])],
            operationId,
          );
          if (pending === null) {
            throw Object.assign(new Error('approval channel is unavailable'), {
              code: 'APPROVAL_CHANNEL_UNAVAILABLE',
            });
          }
        } catch (error) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : 'APPROVAL_CHANNEL_UNAVAILABLE';
          await this.invocationService.rejectToolBeforeEgress(
            resolvedScope,
            request.toolName,
            parsedArgs,
            operationId,
            code,
            verifiedOptions,
          );
          throw error;
        }
        approvalHandle = await this.invocationService.beginToolApproval(
          resolvedScope,
          request.toolName,
          parsedArgs,
          operationId,
          pending.approvalId,
          verifiedOptions,
        );
        let decision: Awaited<ReturnType<typeof pending.waitForDecision>>;
        try {
          decision = await pending.waitForDecision();
        } catch (error) {
          await this.invocationService.rejectToolApproval(
            approvalHandle,
            'APPROVAL_CHANNEL_UNAVAILABLE',
          );
          throw error;
        }
        if (decision.decision !== 'approved') {
          const code = decision.decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED';
          await this.invocationService.rejectToolApproval(approvalHandle, code);
          throw Object.assign(new Error('operation approval was not granted'), {
            code,
          });
        }
      }
      const resultPolicy = extension?.egress ?? resultEgressPolicyFor(request.toolName);
      let consent: Readonly<ConsentContext>;
      try {
        consent = freezeConsent(
          await this.admissionAuthority.authorizeEgress({
            principal,
            request,
            scope: resolvedScope,
            policy,
            parsedArgs,
            inputClasses: resultPolicy.possibleInputClasses(parsedArgs),
            possibleResultClasses: resultPolicy.possibleResultClasses,
          }),
        );
      } catch (error) {
        if (approvalHandle !== null) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : 'EGRESS_AUTHORIZATION_FAILED';
          await this.invocationService.rejectToolApproval(approvalHandle, code);
        } else {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : 'EGRESS_AUTHORIZATION_FAILED';
          await this.invocationService.rejectToolBeforeEgress(
            resolvedScope,
            request.toolName,
            parsedArgs,
            operationId,
            code,
            verifiedOptions,
          );
        }
        throw error;
      }
      const runtimeScope = deepFreeze({ ...resolvedScope, consent }) as RuntimeExecutionScope;
      return await (approvalHandle === null
        ? service
          ? this.invocationService.invokeService(
              runtimeScope,
              ServiceOperationNameSchema.parse(request.toolName),
              parsedArgs,
              operationId,
              verifiedOptions,
              reporter,
            )
          : this.invocationService.invokeTool(
              runtimeScope,
              request.toolName as ToolName,
              parsedArgs,
              operationId,
              verifiedOptions,
              reporter,
            )
        : this.invocationService.resumeApprovedTool(approvalHandle, runtimeScope, reporter));
    } catch (error) {
      if (principal.entryPath === 'control') {
        const safe = safeInvocationError(error);
        throw Object.assign(new Error(safe.message), safe);
      }
      throw error;
    } finally {
      admission.release();
    }
  }

  invokeToolFrames(
    principal: Readonly<ActorContext>,
    request: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    signal?: AbortSignal,
  ): AsyncIterable<InvocationFrameV1> {
    return this.invokeFrames(principal, request, options, signal, false);
  }
  invokeServiceFrames(
    principal: Readonly<ActorContext>,
    request: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    signal?: AbortSignal,
  ): AsyncIterable<InvocationFrameV1> {
    return this.invokeFrames(principal, request, options, signal, true);
  }

  private async *invokeFrames(
    untrustedPrincipal: Readonly<ActorContext>,
    untrustedRequest: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
    subscriberSignal?: AbortSignal,
    service = false,
  ): AsyncIterable<InvocationFrameV1> {
    const principal = parseActorContext(untrustedPrincipal);
    const parsed = service
      ? ServiceOperationRequestV1Schema.parse(untrustedRequest)
      : parseInvocationRequest(untrustedRequest);
    const operationName = 'toolName' in parsed ? parsed.toolName : parsed.serviceOperationName;
    if (this.admissionAuthority === null || this.invocationService === null) {
      throw Object.assign(new Error('execution plane authorities are not bound'), {
        code: 'EXECUTION_PLANE_UNBOUND',
      });
    }
    const operationId =
      parsed.operationId ?? this.admissionAuthority.issueOperationId(principal.actorId);
    const request = Object.freeze({ ...parsed, operationId });
    const progressHandle = this.progressRegistry.acquire({
      ownerId: principal.actorId,
      requestId: request.requestId as `sfp_req1_${string}`,
      operationId,
    });
    const broadcaster = progressHandle.broadcaster;
    const ownsProducer = progressHandle.isProducer;
    let settled = false;
    let earlyError: unknown;
    const result = this.invokeOperation(principal, request, options, broadcaster.reporter, service);
    void result.then(
      () => {
        settled = true;
        if (ownsProducer) progressHandle.producerSettled();
        return undefined;
      },
      error => {
        settled = true;
        earlyError = error;
        if (ownsProducer) progressHandle.producerSettled();
        return undefined;
      },
    );
    const waitForDurableAdmission = async (): Promise<void> => {
      if (this.invocationService?.status(principal.actorId, operationId) !== undefined || settled) {
        return;
      }
      await new Promise<void>(resolve => setImmediate(resolve));
      await waitForDurableAdmission();
    };
    try {
      await waitForDurableAdmission();
      if (this.invocationService.status(principal.actorId, operationId) === undefined) {
        if (earlyError !== undefined) throw earlyError;
        await result;
        throw Object.assign(new Error('operation completed without a durable admission row'), {
          code: 'OPERATION_ADMISSION_DURABILITY_FAILED',
        });
      }
    } catch (error) {
      progressHandle.release();
      if (ownsProducer) progressHandle.terminalSettled();
      throw error;
    }
    const channel = new BoundedInvocationFrameChannel();
    const subscription = broadcaster.subscribe(
      `entry:${principal.entryPath}:${request.requestId}`,
      frame => channel.write(frame),
      request.requestId as `sfp_req1_${string}`,
    );
    const disconnect = (): void => {
      channel.fail(
        subscriberSignal?.reason ??
          Object.assign(new Error('subscriber disconnected'), { code: 'DISCONNECTED' }),
      );
    };
    if (subscriberSignal?.aborted === true) disconnect();
    else subscriberSignal?.addEventListener('abort', disconnect, { once: true });
    this.activeBroadcasters.set(broadcaster, (this.activeBroadcasters.get(broadcaster) ?? 0) + 1);
    if (ownsProducer) {
      void broadcaster
        .emit({
          version: 1,
          type: 'accepted',
          requestId: request.requestId,
          operationId,
          operationKind: service ? 'service' : 'tool',
          operationName,
        })
        .catch(error => channel.fail(error));
    }
    const verifiedTerminal = (): boolean => {
      const record = this.invocationService?.status(principal.actorId, operationId);
      return (
        record !== undefined &&
        !['pending-approval', 'queued', 'dispatched'].includes(record.status)
      );
    };
    if (ownsProducer) {
      void result
        .then(
          value => {
            if (!verifiedTerminal()) {
              const safe = safeInvocationError(
                Object.assign(new Error('terminal journal state is not durable'), {
                  code: 'OPERATION_TERMINAL_DURABILITY_FAILED',
                }),
              );
              channel.fail(Object.assign(new Error(safe.message), safe));
              return undefined;
            }
            return broadcaster.terminal({
              version: 1,
              type: 'result',
              requestId: request.requestId,
              operationId,
              result: value,
            });
          },
          error => {
            if (!verifiedTerminal()) {
              const safe = safeInvocationError(error);
              channel.fail(Object.assign(new Error(safe.message), safe));
              return undefined;
            }
            return broadcaster.terminal({
              version: 1,
              type: 'error',
              requestId: request.requestId,
              operationId,
              error: safeInvocationError(error),
            });
          },
        )
        .catch(() => undefined)
        .finally(() => progressHandle.terminalSettled());
    }
    try {
      /* eslint-disable no-await-in-loop -- one subscriber consumes its ordered bounded stream */
      for (;;) {
        const frame = await channel.next();
        yield frame;
        if (frame.type === 'result' || frame.type === 'error') return;
      }
      /* eslint-enable no-await-in-loop */
    } finally {
      subscriberSignal?.removeEventListener('abort', disconnect);
      channel.fail(Object.assign(new Error('subscriber disconnected'), { code: 'DISCONNECTED' }));
      subscription.release();
      progressHandle.release();
      const references = (this.activeBroadcasters.get(broadcaster) ?? 1) - 1;
      if (references === 0) this.activeBroadcasters.delete(broadcaster);
      else this.activeBroadcasters.set(broadcaster, references);
      if (this.activeBroadcasters.size === 0) {
        for (const waiter of this.streamDrainWaiters) waiter();
        this.streamDrainWaiters.clear();
      }
    }
  }

  async cancel(
    untrustedPrincipal: Readonly<ActorContext>,
    untrustedRequest: unknown,
  ): Promise<void> {
    const principal = parseActorContext(untrustedPrincipal);
    const request = InvocationCancelV1Schema.parse(untrustedRequest) as InvocationCancelV1;
    if (this.invocationService === null) {
      throw Object.assign(new Error('execution plane invocation service is not bound'), {
        code: 'EXECUTION_PLANE_UNBOUND',
      });
    }
    if (this.invocationService.cancel === undefined) {
      throw Object.assign(new Error('runtime cancellation is unavailable'), {
        code: 'CANCEL_UNAVAILABLE',
      });
    }
    await this.invocationService.cancel(principal, request);
    this.admissionAuthority?.approval.cancel?.(request.operationId);
  }

  async drainInvocationStreams(deadlineAt: number): Promise<boolean> {
    if (this.activeBroadcasters.size === 0) return true;
    const remaining = Math.max(0, deadlineAt - this.now());
    return new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (drained: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.streamDrainWaiters.delete(onDrained);
        resolve(drained);
      };
      const onDrained = (): void => finish(true);
      const timer = setTimeout(() => finish(false), remaining);
      this.streamDrainWaiters.add(onDrained);
      if (this.activeBroadcasters.size === 0) finish(true);
    });
  }

  async forceCloseInvocationStreams(): Promise<void> {
    await Promise.all(
      [...this.activeBroadcasters.keys()].map(broadcaster =>
        broadcaster.forceClose('LEADER_GENERATION_CLOSED'),
      ),
    );
  }

  prepareDemotion(_reason: 'abdicated' | 'lease-lost' | 'shutdown'): Promise<DemotionTicket> {
    if (this.preparation !== null) return this.preparation;
    const startedAt = this.now();
    const ticket: DemotionTicket = Object.freeze({
      leaderGeneration: this.leaderGeneration,
      startedAt,
      deadlineAt: startedAt + 5_000,
      transportDrainDeadlineAt: startedAt + 1_000,
    });
    this.preparedTicket = ticket;
    this.accepting = false;
    this.preparation = (async () => {
      try {
        await this.beforeDeadline(() => this.ports.closeAdmission(), ticket.deadlineAt);
        await this.beforeDeadline(() => this.ports.installGenerationFence(), ticket.deadlineAt);
        await this.beforeDeadline(() => this.ports.abortPending(), ticket.deadlineAt);
        await this.beforeDeadline(() => this.ports.abortQueued(), ticket.deadlineAt);
        await this.beforeDeadline(
          () => this.ports.markDispatchedOutcomeUnknown(),
          ticket.deadlineAt,
        );
        await this.beforeDeadline(() => this.ports.finalizeAndFlushEgress(), ticket.deadlineAt);
        const drained = await this.beforeDeadline(
          () => this.ports.drainTransport(ticket.transportDrainDeadlineAt),
          Math.min(ticket.transportDrainDeadlineAt, ticket.deadlineAt),
          false,
        );
        if (!drained) {
          await this.beforeDeadline(() => this.ports.forceCloseTransport(), ticket.deadlineAt);
        }
        await this.beforeDeadline(() => this.ports.destroy(), ticket.deadlineAt);
        this.durabilitySatisfied = true;
      } catch {
        this.durabilitySatisfied = false;
      }
      return ticket;
    })();
    return this.preparation;
  }

  finalizeDemotion(
    ticket: DemotionTicket,
  ): Promise<'port-released' | 'port-retained-durability-failure'> {
    if (
      this.preparation === null ||
      this.preparedTicket !== ticket ||
      ticket.leaderGeneration !== this.leaderGeneration ||
      this.finalized
    ) {
      return Promise.reject(
        Object.assign(new Error('demotion ticket is stale, foreign, or already used'), {
          code: 'DEMOTION_TICKET_INVALID',
        }),
      );
    }
    if (this.finalization !== null) return this.finalization;
    this.finalization = (async () => {
      await this.preparation;
      if (!this.durabilitySatisfied) {
        this.finalized = true;
        return 'port-retained-durability-failure' as const;
      }
      const releaseController = new AbortController();
      try {
        await this.beforeDeadline(
          () => this.ports.releasePort(releaseController.signal),
          ticket.deadlineAt,
        );
        return 'port-released' as const;
      } catch {
        releaseController.abort();
        return 'port-retained-durability-failure' as const;
      } finally {
        this.finalized = true;
      }
    })();
    return this.finalization;
  }

  private async beforeDeadline<T>(
    operation: () => Promise<T> | T,
    deadlineAt: number,
    timeoutValue?: T,
  ): Promise<T> {
    const remaining = deadlineAt - this.now();
    const hasTimeoutValue = timeoutValue !== undefined;
    if (remaining <= 0) {
      if (hasTimeoutValue) return timeoutValue as T;
      throw Object.assign(new Error('demotion deadline exceeded'), {
        code: 'DEMOTION_DEADLINE_EXCEEDED',
      });
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        if (hasTimeoutValue) resolve(timeoutValue as T);
        else {
          reject(
            Object.assign(new Error('demotion deadline exceeded'), {
              code: 'DEMOTION_DEADLINE_EXCEEDED',
            }),
          );
        }
      }, remaining);
      timer.unref?.();
    });
    try {
      return await Promise.race([Promise.resolve(operation()), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export const resolvePolicyInvocationContext = async (
  spec: ToolSpec<unknown, unknown>,
  parsedArgs: Readonly<Record<string, unknown>>,
  workspace: PolicyInvocationContext['workspace'],
  workspacePolicy: WorkspacePolicy,
  fileIdentity?: Readonly<FileIdentity>,
): Promise<Readonly<PolicyInvocationContext>> => {
  const pathModes = new Map<string, 'read' | 'write' | 'write-directory'>();
  for (const effect of operationPolicyFor(spec.name).possibleEffects) {
    if (effect.type !== 'filesystem-read' && effect.type !== 'filesystem-write') continue;
    for (const pathArg of effect.pathArgs) {
      if (effect.type === 'filesystem-write' || !pathModes.has(pathArg)) {
        pathModes.set(
          pathArg,
          effect.type === 'filesystem-write'
            ? pathArg === 'outDir'
              ? 'write-directory'
              : 'write'
            : 'read',
        );
      }
    }
  }
  const resolvedPaths: Record<
    string,
    Readonly<{ path: string; overwrites: boolean }>
  > = Object.create(null) as Record<string, Readonly<{ path: string; overwrites: boolean }>>;
  /* eslint-disable no-await-in-loop -- preserve path order and fail before later metadata probes */
  for (const [pathArg, mode] of pathModes) {
    const input = parsedArgs[pathArg];
    if (pathArg === 'snapshotPath') continue;
    if (typeof input !== 'string') continue;
    if (workspace.workspaceId === null) continue;
    if (mode === 'write-directory') {
      if (workspacePolicy.resolveWriteDirectory === undefined) {
        throw Object.assign(new Error('workspace directory resolver is unavailable'), {
          code: 'WORKSPACE_DIRECTORY_RESOLUTION_UNAVAILABLE',
        });
      }
      const resolved = await workspacePolicy.resolveWriteDirectory(workspace.workspaceId, input);
      resolvedPaths[pathArg] = Object.freeze({ path: resolved.path, overwrites: false });
    } else if (mode === 'write') {
      const resolved = await workspacePolicy.resolveWrite(workspace.workspaceId, input);
      resolvedPaths[pathArg] = Object.freeze({ ...resolved });
    } else {
      const path = await workspacePolicy.resolveRead(workspace.workspaceId, input);
      resolvedPaths[pathArg] = Object.freeze({ path, overwrites: false });
    }
  }
  /* eslint-enable no-await-in-loop */
  if (spec.name === 'design_diff' && workspace.workspaceId !== null) {
    const requested = parsedArgs.nodeId;
    if (fileIdentity === undefined || fileIdentity.kind === 'unstable-readonly') {
      throw Object.assign(new Error('persistent design diff requires a stable file identity'), {
        code: 'DESIGN_DIFF_FILE_IDENTITY_REQUIRED',
      });
    }
    const snapshotRoot = resolvedPaths.rootDir?.path ?? workspace.workspaceRoot;
    if (snapshotRoot === null) {
      throw Object.assign(new Error('design diff snapshot root is unavailable'), {
        code: 'SNAPSHOT_AUTHORITY_MISMATCH',
      });
    }
    const snapshotPath = join(
      snapshotRoot,
      designDiffRelativePath(
        canonicalFileIdentityHash(fileIdentity),
        typeof requested === 'string' ? requested : undefined,
      ),
    );
    const resolved = await workspacePolicy.resolveWrite(workspace.workspaceId, snapshotPath);
    resolvedPaths.snapshotPath = Object.freeze({ ...resolved });
  }
  const frozenWorkspace = Object.freeze({ ...workspace });
  return Object.keys(resolvedPaths).length === 0
    ? Object.freeze({ workspace: frozenWorkspace })
    : Object.freeze({ workspace: frozenWorkspace, resolvedPaths: Object.freeze(resolvedPaths) });
};
