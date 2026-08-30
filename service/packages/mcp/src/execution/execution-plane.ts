import {
  ALL_DATA_CLASSES,
  Base64Url128Schema,
  FileIdentitySchema,
  NO_CAPTURE_OPTIONS,
  parseActorContext,
  parseInvocationRequest,
  parseInvocationTargetSelector,
  validateToolInvocationOptions,
  type ActorContext,
  type ConsentContext,
  type Effect,
  type InvocationRequestV1,
  type InvocationTargetSelector,
  type OperationInvocationService,
  type PluginTarget,
  type ResolvedInvocationScope,
  type RuntimeExecutionScope,
  type TargetRequirement,
  type ToolInvocationOptionsV1,
  type ToolName,
  type PolicyInvocationContext,
  type WorkspaceInvocationContext,
  type WorkspacePolicy,
} from '@sfp/shared';

import { operationPolicyFor } from '../policy/operation-policy.js';
import { evaluateOperationPolicy, type EvaluatedOperationPolicy } from '../policy/policy-engine.js';
import { resultEgressPolicyFor } from '../policy/result-egress-policy.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';
import type { ToolSpec } from '../tools/spec.js';

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

export interface ApprovalDecisionPort {
  request(
    scope: ResolvedInvocationScope,
    operationName: ToolName,
    effects: readonly Effect[],
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
  resolveWorkspaceContext(workspaceId: string | null): Promise<WorkspaceInvocationContext>;
  workspacePolicy: WorkspacePolicy;
  targetResolver: TargetResolverPort;
  approval: ApprovalDecisionPort;
  authorizeEgress(input: {
    principal: Readonly<ActorContext>;
    request: Readonly<InvocationRequestV1>;
    scope: Readonly<ResolvedInvocationScope>;
    policy: Readonly<EvaluatedOperationPolicy>;
    parsedArgs: Readonly<Record<string, unknown>>;
    inputClasses: readonly (typeof ALL_DATA_CLASSES)[number][];
    possibleResultClasses: readonly (typeof ALL_DATA_CLASSES)[number][];
  }): Promise<ConsentContext>;
  issueOperationId(actorId: ActorContext['actorId']): string;
  verifyOperationId(actorId: ActorContext['actorId'], operationId: string): void;
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
  if (!identity.success) {
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

  async invokeTool(
    untrustedPrincipal: Readonly<ActorContext>,
    untrustedRequest: unknown,
    options: Readonly<ToolInvocationOptionsV1> = NO_CAPTURE_OPTIONS,
  ): Promise<unknown> {
    if (!this.accepting) {
      return Promise.reject(
        Object.assign(new Error('leader generation is closed'), {
          code: 'LEADER_GENERATION_CLOSED',
        }),
      );
    }
    const principal = parseActorContext(untrustedPrincipal);
    if (principal.entryPath === 'internal-system') {
      throw Object.assign(new Error('public tool admission cannot use an internal principal'), {
        code: 'INVOCATION_PRINCIPAL_INVALID',
      });
    }
    const request = parseInvocationRequest(untrustedRequest);
    if (this.invocationService === null || this.admissionAuthority === null) {
      throw Object.assign(new Error('execution plane authorities are not bound'), {
        code: 'EXECUTION_PLANE_UNBOUND',
      });
    }
    const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === request.toolName);
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
    const workspace = freezeWorkspace(
      requestedWorkspaceId,
      await this.admissionAuthority.resolveWorkspaceContext(requestedWorkspaceId),
    );
    const policyContext = await resolvePolicyInvocationContext(
      spec,
      parsedArgs,
      workspace,
      this.admissionAuthority.workspacePolicy,
    );
    const policy = evaluateOperationPolicy(request.toolName, parsedArgs, policyContext);
    const target = freezeVerifiedTarget(
      this.admissionAuthority.targetResolver.resolve(
        parseInvocationTargetSelector(request.targetSelector),
        spec.targetRequirementFor(parsedArgs),
      ),
    );
    const resolvedScope = deepFreeze({
      requestId: request.requestId,
      leaderGeneration: this.leaderGeneration,
      actor: principal,
      workspace: policyContext.workspace,
      ...(policyContext.resolvedPaths === undefined
        ? {}
        : { resolvedPaths: policyContext.resolvedPaths }),
      target,
    }) as Readonly<ResolvedInvocationScope>;
    const operationId =
      request.operationId ?? this.admissionAuthority.issueOperationId(principal.actorId);
    this.admissionAuthority.verifyOperationId(principal.actorId, operationId);
    const verifiedOptions = validateToolInvocationOptions(
      options,
      operationId,
      workspace.workspaceId,
    );
    let approvalHandle: Awaited<
      ReturnType<OperationInvocationService['beginToolApproval']>
    > | null = null;
    if (policy.approval !== 'none') {
      const pending = await this.admissionAuthority.approval.request(
        resolvedScope,
        request.toolName,
        policy.effects,
        operationId,
      );
      if (pending === null) {
        throw Object.assign(new Error('approval channel is unavailable'), {
          code: 'APPROVAL_CHANNEL_UNAVAILABLE',
        });
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
    const resultPolicy = resultEgressPolicyFor(request.toolName);
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
      }
      throw error;
    }
    const runtimeScope = deepFreeze({ ...resolvedScope, consent }) as RuntimeExecutionScope;
    return approvalHandle === null
      ? this.invocationService.invokeTool(
          runtimeScope,
          request.toolName,
          parsedArgs,
          operationId,
          verifiedOptions,
        )
      : this.invocationService.resumeApprovedTool(approvalHandle, runtimeScope);
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
): Promise<Readonly<PolicyInvocationContext>> => {
  const pathModes = new Map<string, 'read' | 'write'>();
  for (const effect of operationPolicyFor(spec.name).possibleEffects) {
    if (effect.type !== 'filesystem-read' && effect.type !== 'filesystem-write') continue;
    for (const pathArg of effect.pathArgs) {
      if (effect.type === 'filesystem-write' || !pathModes.has(pathArg)) {
        pathModes.set(pathArg, effect.type === 'filesystem-write' ? 'write' : 'read');
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
    if (typeof input !== 'string') continue;
    if (workspace.workspaceId === null) continue;
    if (mode === 'write') {
      const resolved = await workspacePolicy.resolveWrite(workspace.workspaceId, input);
      resolvedPaths[pathArg] = Object.freeze({ ...resolved });
    } else {
      const path = await workspacePolicy.resolveRead(workspace.workspaceId, input);
      resolvedPaths[pathArg] = Object.freeze({ path, overwrites: false });
    }
  }
  /* eslint-enable no-await-in-loop */
  const frozenWorkspace = Object.freeze({ ...workspace });
  return Object.keys(resolvedPaths).length === 0
    ? Object.freeze({ workspace: frozenWorkspace })
    : Object.freeze({ workspace: frozenWorkspace, resolvedPaths: Object.freeze(resolvedPaths) });
};
