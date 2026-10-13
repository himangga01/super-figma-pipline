import { randomUUID } from 'node:crypto';

import {
  PORTAL_INPUT_SCHEMAS,
  PortalStateSchema,
  OperationRecordSchema,
  OperationTombstoneSchema,
} from '@sfp/shared';
import { z } from 'zod';

import {
  ActionSchema,
  actionNames,
  defaultWorkflow,
  nodeTypes,
  parse,
  PortalError,
  publicError,
  safeValue,
  validateWorkflow,
  WorkspaceRegistrationSchema,
  WorkspaceSchema,
  BrowserConnectionSchema,
  browserConnectionMessages,
  activityFigmaScope,
  type ActionName,
  type Run,
  type StoredRun,
  type Workspace,
} from './contract.js';
import { PortalFigmaSettings, type FigmaSettingsControl } from './figma-settings.js';
import { ServiceJobs, type ServiceJobRuntime } from './service-jobs.js';
import { PortalStore } from './store.js';

export interface ControlCall {
  name: string;
  kind: 'tool';
  args: unknown;
  workspaceId: string;
  targetSelector: { kind: 'portal-source' | 'none' };
  approve: false;
  timeoutMs: number;
  signal: AbortSignal;
  emit(value: unknown): void;
}
export interface ControlPort extends FigmaSettingsControl {
  close?(): Promise<void>;
  serviceJobs?: ServiceJobRuntime;
  inspectOriginalOperation?(operationId: string): Promise<unknown>;
  health(): Promise<boolean>;
  status?(): Promise<unknown>;
  registerWorkspace?(folder: string): Promise<Workspace>;
  workspaces(): Promise<Workspace[]>;
  invoke(call: ControlCall): Promise<unknown>;
  decide(approvalId: string, decision: 'approved' | 'rejected'): Promise<void>;
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const supportedState = (run: StoredRun) =>
  typeof run.result?.state === 'string' ? run.result.state : '';
const terminal = new Set(['completed', 'cancelled']);
const failedOperationStatuses = new Set([
  'failed',
  'pre-egress-rejected',
  'rejected',
  'resolved-not-applied',
]);
const planId = z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u);

export class PortalBridge {
  private active = new Map<string, AbortController>();
  private observedOperations = new Map<
    string,
    { id: string | null; status: string | null; mutation: boolean; name: string }
  >();
  private starting = new Set<string>();
  private lastConnectionObservation: string | null = null;
  private settingsPromise: Promise<PortalFigmaSettings> | undefined;
  private jobsPromise: Promise<ServiceJobs> | undefined;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly store: PortalStore,
    private readonly control: ControlPort,
  ) {}
  close(): Promise<void> {
    return (this.closing ??= this.control.close?.() ?? Promise.resolve());
  }
  settings(): Promise<PortalFigmaSettings> {
    return (this.settingsPromise ??= PortalFigmaSettings.open(
      this.store.directory,
      this.control,
      () => this.assertFigmaAuthMutationAllowed(),
    ));
  }
  /** Authorization is global owner state; its mutators overlap every retained unknown fence. */
  async assertFigmaAuthMutationAllowed(): Promise<void> {
    if (
      this.store
        .listRuns()
        .some(run => run.status === 'unknown' || run.unresolvedOperation !== undefined)
    )
      throw new PortalError(
        'RUN_OUTCOME_UNKNOWN',
        'Inspect the retained guided operation before changing authorization.',
        409,
      );
    if (this.control.serviceJobs && (await this.jobs()).hasUnknownMutation(null))
      throw new PortalError(
        'SERVICE_JOB_OUTCOME_UNKNOWN',
        'Review retained unknown service jobs before changing authorization.',
        409,
      );
  }
  jobs(): Promise<ServiceJobs> {
    if (!this.control.serviceJobs)
      throw new PortalError(
        'SERVICE_FUNCTIONS_UNAVAILABLE',
        'The service function catalog is unavailable.',
        503,
      );
    return (this.jobsPromise ??= ServiceJobs.open(
      this.store,
      {
        ...this.control.serviceJobs,
        guard: (input, capability) => {
          this.control.serviceJobs!.guard?.(input, capability);
          if (
            !capability.readOnly &&
            !capability.recovery &&
            this.store
              .listRuns()
              .some(
                run =>
                  (run.status === 'unknown' || run.unresolvedOperation !== undefined) &&
                  (input.workspaceId === null || run.workspaceId === input.workspaceId),
              )
          )
            throw new PortalError(
              'RUN_OUTCOME_UNKNOWN',
              'Inspect the retained guided operation before starting an overlapping mutation.',
              409,
            );
        },
      },
      (id, controller) => {
        if (this.active.size + this.starting.size >= 4)
          throw new PortalError(
            'SERVICE_JOB_BUSY',
            'Four operations are already in progress.',
            409,
          );
        const key = `service-job:${id}`;
        this.active.set(key, controller);
        return () => {
          this.active.delete(key);
        };
      },
    ));
  }
  async bootstrap() {
    const available = await this.control.health().catch(() => false);
    let workspaces: Workspace[] = [];
    let browserConnection: z.infer<typeof BrowserConnectionSchema> = 'unknown';
    let statusAvailable = false;
    let message = available
      ? '서비스가 응답합니다. Chrome 연결과 파일 수집 결과는 별도로 확인해 주세요.'
      : '서비스에 연결할 수 없습니다. 로컬 서비스를 시작한 뒤 새로고침해 주세요.';
    if (available) {
      const [workspaceResult, statusResult] = await Promise.allSettled([
        this.workspaces(),
        this.control.status?.() ?? Promise.resolve(null),
      ]);
      if (workspaceResult.status === 'fulfilled') workspaces = workspaceResult.value;
      else
        message =
          '서비스는 응답하지만 작업 폴더 목록을 읽지 못했습니다. 서비스 접근 상태를 확인한 뒤 새로고침해 주세요.';
      if (statusResult.status === 'fulfilled') {
        const status = z
          .object({ browserConnection: BrowserConnectionSchema.optional() })
          .strip()
          .safeParse(statusResult.value);
        if (status.success) {
          statusAvailable = true;
          browserConnection = status.data.browserConnection ?? 'unknown';
        }
      }
    }
    const connectionObservation = JSON.stringify([available, statusAvailable, browserConnection]);
    if (this.lastConnectionObservation !== connectionObservation) {
      this.lastConnectionObservation = connectionObservation;
      await this.store.observeActivity({
        type: 'service.connection',
        metadata: { browserConnection, statusAvailable },
      });
    }
    return {
      service: {
        available,
        message,
        readiness: {
          statusAvailable,
          browserConnection,
          browserMessage: browserConnectionMessages[browserConnection],
          workspaceRegistrationAvailable: available && this.control.registerWorkspace !== undefined,
        },
      },
      workspaces,
      capabilities: {
        sources: ['chrome-page-api', 'chrome-scripter', 'official-mcp'],
        nodeTypes,
        actions: actionNames,
      },
      template: defaultWorkflow(),
      activityLog: {
        audit: this.store.activityHealth(),
        retention: this.store.listActivities({ limit: 1 }).retention,
      },
    };
  }
  async workspaces(): Promise<Workspace[]> {
    return parse(z.array(WorkspaceSchema).max(1000), await this.control.workspaces());
  }
  async registerWorkspace(raw: unknown): Promise<Workspace> {
    const { folder } = parse(WorkspaceRegistrationSchema, raw);
    if (!this.control.registerWorkspace)
      throw new PortalError(
        'WORKSPACE_REGISTRATION_UNAVAILABLE',
        'Workspace registration is unavailable.',
        503,
      );
    const workspace = parse(WorkspaceSchema, await this.control.registerWorkspace(folder));
    if (workspace.availability && workspace.availability !== 'available')
      throw new PortalError(
        'WORKSPACE_ROOT_UNAVAILABLE',
        'Workspace registration is unavailable.',
        409,
      );
    return workspace;
  }
  listRuns(): Run[] {
    return this.store.listRuns().map(run => this.present(run));
  }
  getRun(id: string): Run {
    return this.present(this.store.getRun(id));
  }
  events(id: string, after: number) {
    const run = this.store.getRun(id),
      events = run.events.filter(e => e.sequence > after);
    return { events, nextCursor: events.at(-1)?.sequence ?? after };
  }
  private present(run: StoredRun): Run {
    const {
      workflow: _workflow,
      events: _events,
      nextSequence: _nextSequence,
      unresolvedOperation: _unresolvedOperation,
      ...publicRun
    } = run;
    const state = supportedState(run),
      busy = this.active.has(run.id),
      unknown = run.status === 'unknown' || run.unresolvedOperation !== undefined;
    const enabled = (action: ActionName): boolean => {
      if (action === 'approve' || action === 'reject')
        return busy && run.approvals.some(p => Number(p.expiresAt) > Date.now());
      if (action === 'cancel')
        return busy || (!!run.serviceRunId && !unknown && !terminal.has(run.status));
      if (action === 'refresh' && !busy && this.noCorePlanInspectionAvailable(run)) return true;
      if (busy || !run.serviceRunId) return false;
      if (action === 'refresh') return true;
      if (action === 'resume') return !terminal.has(run.status);
      if (unknown || terminal.has(run.status)) return false;
      if (action === 'next')
        return [
          'needs-input',
          'waiting-agent',
          'generating',
          'candidate-ready',
          'blocked',
          'failed',
        ].includes(state);
      if (action === 'submit') return ['waiting-agent', 'generating'].includes(state);
      if (action === 'validate')
        return [
          'candidate-ready',
          'ready-to-apply',
          'applied-awaiting-validation',
          'blocked',
          'failed',
        ].includes(state);
      return action === 'apply' && state === 'ready-to-apply';
    };
    publicRun.actions = actionNames.map(action => ({
      action,
      enabled: enabled(action),
      reason: enabled(action)
        ? ''
        : busy
          ? 'Another operation is active. Resolve its approval or cancel it.'
          : !run.serviceRunId
            ? 'A service run has not been established. Inspect the recorded operation in the service CLI.'
            : unknown
              ? 'The previous outcome is unknown. Inspect status or reconcile explicitly.'
              : 'This action is unavailable in the recorded service state.',
    }));
    return publicRun;
  }
  async start(workflowId: string, revision: number): Promise<Run> {
    const workflow = this.store.getWorkflow(workflowId);
    if (this.control.serviceJobs && (await this.jobs()).hasUnknownMutation(workflow.workspaceId))
      throw new PortalError(
        'SERVICE_JOB_OUTCOME_UNKNOWN',
        'Inspect the retained service job before starting an overlapping workflow.',
        409,
      );
    if (
      this.store
        .listRuns()
        .some(
          r =>
            r.workflowId === workflowId &&
            (r.status === 'unknown' || r.unresolvedOperation !== undefined),
        )
    )
      throw new PortalError(
        'RUN_OUTCOME_UNKNOWN',
        'Inspect and resolve the previous operation before starting this workflow again.',
        409,
      );
    if (workflow.revision !== revision)
      throw new PortalError(
        'REVISION_CONFLICT',
        'The saved workflow changed. Reload it before execution.',
        409,
      );
    // Metadata is intentionally outside the input schema.
    const {
      id: _id,
      revision: _revision,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...input
    } = workflow;
    const graph = validateWorkflow(input);
    if (!graph.valid)
      throw new PortalError(
        'WORKFLOW_INVALID',
        'The workflow is not executable.',
        400,
        graph.issues,
      );
    if (
      this.starting.has(workflowId) ||
      this.store.listRuns().some(r => r.workflowId === workflowId && this.active.has(r.id))
    )
      throw new PortalError('RUN_BUSY', 'This workflow already has an active operation.', 409);
    if (this.active.size + this.starting.size >= 4)
      throw new PortalError('RUN_LIMIT', 'Four operations are already active.', 409);
    this.starting.add(workflowId);
    try {
      const workspaces = await this.control.workspaces();
      const target = workspaces.find(w => w.workspaceId === workflow.workspaceId);
      if (!target || (target.availability && target.availability !== 'available'))
        throw new PortalError(
          'WORKSPACE_UNAVAILABLE',
          'Select an available registered workspace.',
          409,
        );
      for (const reference of workflow.plan.references)
        if (
          !workspaces.some(
            w =>
              w.workspaceId === reference.workspaceId &&
              (!w.availability || w.availability === 'available'),
          )
        )
          throw new PortalError(
            'WORKSPACE_UNAVAILABLE',
            'A reference workspace is unavailable.',
            409,
          );
      const at = new Date().toISOString(),
        id = randomUUID();
      const run: StoredRun = {
        id,
        workflowId,
        workflowRevision: revision,
        workflowName: workflow.name,
        workspaceId: workflow.workspaceId!,
        status: 'queued',
        createdAt: at,
        updatedAt: at,
        planId: null,
        serviceRunId: null,
        operationId: null,
        nodes: workflow.graph.nodes.map(n => ({
          nodeId: n.id,
          type: n.type,
          status: 'pending',
          message: '',
        })),
        graph: structuredClone(workflow.graph),
        result: null,
        context: null,
        error: null,
        approvals: [],
        actions: [],
        outputs: [],
        workflow,
        events: [],
        nextSequence: 1,
      };
      await this.store.createRun(run);
      // Transfer this reserved slot synchronously into launch's active-operation slot.
      this.starting.delete(workflowId);
      await this.launch(id, async signal => {
        const plan = await this.invoke(id, 'portal_plan', workflow.plan, signal);
        const found = parse(planId, plan.planId);
        await this.store.updateRun(id, r => {
          r.planId = found;
          r.context = plan;
        });
        await this.invoke(id, 'portal_start', { planId: found }, signal);
      });
      return this.getRun(id);
    } finally {
      this.starting.delete(workflowId);
    }
  }
  async action(id: string, raw: unknown): Promise<Run> {
    const request = parse(ActionSchema, raw),
      run = this.store.getRun(id);
    const availability = this.present(run).actions.find(a => a.action === request.action)!;
    if (!availability.enabled)
      throw new PortalError('ACTION_UNAVAILABLE', availability.reason, 409);
    if (request.action === 'approve' || request.action === 'reject') {
      const decisionOwner = this.active.get(id);
      const args = parse(
        z.object({ approvalId: z.string().min(1).max(256) }).strict(),
        request.args,
      );
      const prompt = run.approvals.find(
        p =>
          p.approvalId === args.approvalId &&
          p.operationId === run.operationId &&
          Number(p.expiresAt) > Date.now(),
      );
      if (!prompt)
        throw new PortalError(
          'APPROVAL_NOT_FOUND',
          'This approval does not belong to the active run.',
          404,
        );
      await this.control.decide(
        args.approvalId,
        request.action === 'approve' ? 'approved' : 'rejected',
      );
      await this.store.updateRun(id, r => {
        // The decision RPC can finish after its operation settled or another operation began.
        // Only the still-pending prompt may transition its own active operation.
        if (
          this.active.get(id) === decisionOwner &&
          r.status === 'awaiting-approval' &&
          r.unresolvedOperation === undefined &&
          r.operationId === prompt.operationId &&
          r.approvals.some(
            p => p.approvalId === args.approvalId && p.operationId === prompt.operationId,
          )
        ) {
          r.approvals = r.approvals.filter(
            p => p.approvalId !== args.approvalId || p.operationId !== prompt.operationId,
          );
          r.status = 'active';
        }
      });
      await this.store.event(
        id,
        request.action,
        'An explicit service approval decision was submitted.',
      );
      return this.getRun(id);
    }
    if (request.action === 'cancel' && this.active.has(id)) {
      parse(z.object({}).strict(), request.args);
      this.active.get(id)!.abort();
      await this.store.event(
        id,
        'cancel-requested',
        'Cancellation was requested for this operation. Its outcome must still be observed.',
      );
      return this.getRun(id);
    }
    if (request.action === 'refresh' && this.noCorePlanInspectionAvailable(run)) {
      parse(z.object({}).strict(), request.args);
      await this.launch(id, signal => this.inspectNoCorePlan(run, signal), true, true);
      return this.getRun(id);
    }
    const name =
      request.action === 'refresh'
        ? 'portal_status'
        : (`portal_${request.action}` as keyof typeof PORTAL_INPUT_SCHEMAS);
    if (!(name in PORTAL_INPUT_SCHEMAS))
      throw new PortalError('ACTION_UNAVAILABLE', 'Unsupported action.', 400);
    if ('runId' in request.args)
      throw new PortalError(
        'INVALID_REQUEST',
        'The run is selected by the route, not by request arguments.',
      );
    const args = parse<unknown>(PORTAL_INPUT_SCHEMAS[name], {
      ...(name === 'portal_validate'
        ? {
            profileId:
              run.workflow.graph.nodes.find(n => n.type === 'validation')?.config.profileId ??
              'node-frontend',
          }
        : {}),
      ...request.args,
      runId: run.serviceRunId,
    });
    if (
      this.control.serviceJobs &&
      !['portal_status', 'portal_cancel'].includes(name) &&
      !(name === 'portal_resume' && object(args).reconcile === 'inspect') &&
      (await this.jobs()).hasUnknownMutation(run.workspaceId)
    )
      throw new PortalError(
        'SERVICE_JOB_OUTCOME_UNKNOWN',
        'Inspect the retained service job before starting an overlapping mutation.',
        409,
      );
    if (
      (run.status === 'unknown' || run.unresolvedOperation !== undefined) &&
      name === 'portal_resume' &&
      object(args).reconcile !== 'inspect'
    )
      throw new PortalError(
        'RECONCILIATION_REQUIRED',
        'Inspect the unknown outcome before attempting continuation.',
        409,
      );
    await this.launch(
      id,
      async signal => {
        const originalResolved =
          name === 'portal_status' &&
          (run.status === 'unknown' || run.unresolvedOperation !== undefined)
            ? await this.originalOperationResolved(run)
            : false;
        return this.invoke(id, name, args, signal, originalResolved);
      },
      run.status === 'unknown' || run.unresolvedOperation !== undefined,
    );
    return this.getRun(id);
  }
  private async launch(
    id: string,
    execute: (signal: AbortSignal) => Promise<unknown>,
    preserveUnknown = false,
    preserveRunSnapshot = false,
  ): Promise<void> {
    if (this.active.has(id))
      throw new PortalError('RUN_BUSY', 'This run already has an active operation.', 409);
    if (this.active.size + this.starting.size >= 4)
      throw new PortalError('RUN_LIMIT', 'Four operations are already active.', 409);
    const prior = this.store.getRun(id);
    const unresolvedOperationId = prior.unresolvedOperation
      ? prior.unresolvedOperation.id
      : preserveUnknown
        ? prior.operationId
        : null;
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      if (!preserveRunSnapshot)
        await this.store.updateRun(id, r => {
          if (preserveUnknown && !r.unresolvedOperation)
            r.unresolvedOperation = { id: unresolvedOperationId, name: null };
          r.status = 'active';
          r.error = null;
        });
    } catch (error) {
      this.active.delete(id);
      throw error;
    }
    void (async () => {
      try {
        await execute(controller.signal);
      } catch (error) {
        if (preserveRunSnapshot) return;
        const safe = publicError(error);
        const observed = this.observedOperations.get(id);
        const errorRecord = object(error);
        const terminalFailure =
          observed?.id !== null &&
          observed?.id !== undefined &&
          (failedOperationStatuses.has(observed.status ?? '') ||
            (errorRecord.operationId === observed.id &&
              typeof errorRecord.operationStatus === 'string' &&
              failedOperationStatuses.has(errorRecord.operationStatus)));
        await this.store.updateRun(id, r => {
          // Error codes describe transport/monitoring failures, not mutation disposition.
          // Once a mutation has an issued operation, only correlated terminal evidence can
          // resolve uncertainty; an unrecognized error must never re-enable stale apply state.
          const uncertain =
            preserveUnknown ||
            (observed?.mutation === true && observed.id !== null && !terminalFailure);
          r.status = uncertain ? 'unknown' : 'failed';
          if (uncertain && !r.unresolvedOperation && observed?.id)
            r.unresolvedOperation = { id: observed.id, name: observed.name };
          if (unresolvedOperationId !== null) r.operationId = unresolvedOperationId;
          else if (r.unresolvedOperation) r.operationId = r.unresolvedOperation.id;
          r.error = { code: safe.code, message: safe.message };
          r.approvals = [];
          for (const n of r.nodes)
            if (n.status === 'active' || n.status === 'waiting')
              n.status = uncertain ? 'unknown' : 'failed';
        });
        await this.store.event(id, 'error', safe.message, { code: safe.code });
        const failedRun = this.store.getRun(id);
        await this.store.observeActivity({
          type: 'service.run-state',
          source: 'server',
          workflowId: failedRun.workflowId,
          runId: id,
          workspaceId: failedRun.workspaceId,
          metadata: {
            toState: failedRun.status,
            runStatus: failedRun.status,
            errorCode: safe.code,
          },
        });
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        this.active.delete(id);
        this.observedOperations.delete(id);
      });
  }
  private async invoke(
    id: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
    originalResolved = false,
  ): Promise<Record<string, unknown>> {
    const run = this.store.getRun(id);
    const observed = {
      id: null as string | null,
      status: null as string | null,
      mutation: name !== 'portal_status',
      name,
    };
    this.observedOperations.set(id, observed);
    const stage =
      name === 'portal_plan'
        ? 'source'
        : name === 'portal_start' || name === 'portal_next' || name === 'portal_submit'
          ? 'generation'
          : name === 'portal_validate'
            ? 'validation'
            : 'output';
    await this.store.updateRun(id, r => {
      r.operationId = null;
      r.approvals = [];
      r.status = 'active';
      const node = r.nodes.find(n => n.type === stage);
      if (node && name !== 'portal_status') {
        node.status = 'active';
        node.message = name;
      }
    });
    await this.store.event(id, 'operation', `Requested ${name}.`);
    let emitted = Promise.resolve();
    let result: unknown;
    try {
      result = await this.control.invoke({
        name,
        kind: 'tool',
        args,
        workspaceId: run.workspaceId,
        targetSelector: {
          kind: name === 'portal_plan' || name === 'portal_validate' ? 'portal-source' : 'none',
        },
        approve: false,
        timeoutMs: 900000,
        signal,
        emit: value => {
          const item = object(safeValue(value));
          emitted = emitted.then(async () => {
            if (
              item.status === 'accepted-locally' &&
              typeof item.operationId === 'string' &&
              observed.id === null
            )
              observed.id = item.operationId;
            if (item.operationId === observed.id && typeof item.status === 'string')
              observed.status = item.status;
            await this.store.updateRun(id, r => {
              if (typeof item.operationId === 'string' && item.operationId === observed.id)
                r.operationId = item.operationId;
              if (item.status === 'approval-required') {
                const prompt = object(item.prompt);
                if (prompt.operationId === r.operationId) {
                  r.approvals.push(prompt);
                  r.status = 'awaiting-approval';
                }
              }
            });
            await this.store.event(
              id,
              typeof item.status === 'string' ? item.status : 'progress',
              `Service operation: ${String(item.status ?? 'progress')}.`,
              item,
            );
            if (
              item.status === 'approval-required' &&
              this.store.getRun(id).status === 'awaiting-approval'
            )
              await this.store.observeActivity({
                type: 'service.run-state',
                workflowId: run.workflowId,
                runId: id,
                workspaceId: run.workspaceId,
                metadata: { toState: 'awaiting-approval', runStatus: 'awaiting-approval' },
              });
            return undefined;
          });
        },
      });
    } finally {
      await emitted;
    }
    if (Buffer.byteLength(JSON.stringify(result) ?? '') > 8 * 1024 * 1024)
      throw new PortalError(
        'RESULT_LIMIT',
        'The service result exceeds the portal display limit. Inspect it through the service CLI.',
        502,
      );
    const value = object(safeValue(result));
    if (name === 'portal_plan') parse(planId, value.planId);
    else {
      parse(planId, value.runId);
      parse(PortalStateSchema, value.state);
      if (value.runId !== run.planId || (value.planId !== undefined && value.planId !== run.planId))
        throw new PortalError(
          'SERVICE_RUN_MISMATCH',
          'The service returned a result for a different run. No completion was recorded.',
          502,
        );
    }
    await this.store.updateRun(id, r => {
      r.approvals = [];
      r.error = null;
      if (name === 'portal_plan') {
        r.context = value;
        for (const n of r.nodes)
          if (n.type === 'source' || n.type === 'requirements') {
            n.status =
              n.type === 'requirements' && object(value.workflowCoverage).complete !== true
                ? 'waiting'
                : 'completed';
            n.message = 'Service plan recorded.';
          }
        this.applySourceEvidence(r);
      } else {
        r.serviceRunId = String(value.runId);
        r.result = value;
        if (name === 'portal_next') r.context = value;
        r.outputs = Array.isArray(value.files) ? value.files.map(object) : [];
        this.applyState(r, String(value.state));
        if (originalResolved && !['outcome-unknown', 'conflict'].includes(String(value.state)))
          delete r.unresolvedOperation;
        if (r.status === 'unknown' && !r.unresolvedOperation && observed.mutation && observed.id)
          r.unresolvedOperation = { id: observed.id, name };
        if (r.unresolvedOperation) {
          r.status = 'unknown';
          r.operationId = r.unresolvedOperation.id;
          r.error = {
            code: 'OPERATION_OUTCOME_UNRESOLVED',
            message:
              'The run snapshot does not resolve the original operation. Inspect its service journal disposition before continuing.',
          };
          // Retain the last known node evidence instead of rendering a newer snapshot as acceptance.
          r.nodes = run.nodes.map(node => ({
            ...node,
            status: node.status === 'active' || node.status === 'waiting' ? 'unknown' : node.status,
          }));
        } else if (run.status === 'unknown' && !originalResolved) {
          r.status = 'unknown';
          r.nodes = run.nodes;
        }
      }
    });
    const recorded = this.store.getRun(id);
    if (name === 'portal_plan') {
      const design = object(value.design);
      const failureCode = object(design.captureFailure).code;
      await this.store.observeActivity({
        type: 'service.capture',
        workflowId: run.workflowId,
        runId: id,
        workspaceId: run.workspaceId,
        metadata: {
          ...activityFigmaScope(design.url),
          captureComplete: design.complete === true,
          liveVerified: design.liveVerified === true,
          issueCount: Array.isArray(value.issues) ? value.issues.length : 0,
          ...(typeof failureCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(failureCode)
            ? { errorCode: failureCode }
            : {}),
        },
      });
    } else if (
      supportedState(run) !== String(value.state) ||
      (Array.isArray(run.result?.files) ? run.result.files.length : 0) !==
        (Array.isArray(value.files) ? value.files.length : 0) ||
      (Array.isArray(run.result?.issues) ? run.result.issues.length : 0) !==
        (Array.isArray(value.issues) ? value.issues.length : 0)
    ) {
      await this.store.observeActivity({
        type: 'service.run-state',
        workflowId: run.workflowId,
        runId: id,
        workspaceId: run.workspaceId,
        metadata: {
          ...(supportedState(run)
            ? { fromState: parse(PortalStateSchema, supportedState(run)) }
            : {}),
          toState: parse(PortalStateSchema, value.state),
          runStatus: recorded.status,
          serviceRunId: parse(planId, value.runId),
          fileCount: Array.isArray(value.files) ? value.files.length : 0,
          issueCount: Array.isArray(value.issues) ? value.issues.length : 0,
        },
      });
    }
    await this.store.event(id, 'result', `Recorded ${name} result.`, {
      state: value.state ?? 'planned',
      planId: value.planId,
      runId: value.runId,
    });
    return value;
  }
  private noCorePlanInspectionAvailable(run: StoredRun): boolean {
    return (
      !run.serviceRunId &&
      run.status === 'unknown' &&
      run.unresolvedOperation?.name === 'portal_plan' &&
      !!run.unresolvedOperation.id &&
      run.operationId === run.unresolvedOperation.id &&
      !!this.control.inspectOriginalOperation
    );
  }
  private async inspectNoCorePlan(prior: StoredRun, signal: AbortSignal): Promise<void> {
    const retained = prior.unresolvedOperation!;
    const parsed = z
      .union([OperationRecordSchema, OperationTombstoneSchema])
      .safeParse(await this.control.inspectOriginalOperation!(retained.id!));
    const record = parsed.success ? parsed.data : null;
    await this.store.updateRun(prior.id, run => {
      if (
        signal.aborted ||
        this.closing ||
        this.active.get(prior.id)?.signal !== signal ||
        run.status !== 'unknown' ||
        run.serviceRunId ||
        run.operationId !== retained.id ||
        run.unresolvedOperation?.id !== retained.id ||
        run.unresolvedOperation.name !== 'portal_plan' ||
        run.workspaceId !== prior.workspaceId
      )
        throw new PortalError(
          'OPERATION_OUTCOME_UNRESOLVED',
          'The retained operation changed.',
          409,
        );
      // Authenticated canonical compaction retains terminal pre-egress proof. Generic
      // terminal outcomes, incomplete/foreign proof and expired tombstones stay fenced.
      const noDispatch =
        record !== null &&
        record.operationId === retained.id &&
        record.workspaceId === prior.workspaceId &&
        record.operationKind === 'tool' &&
        record.operationName === 'portal_plan' &&
        record.status === 'pre-egress-rejected' &&
        typeof record.settledAt === 'string' &&
        record.resultHash === null &&
        record.operationEvidenceReceiptHash === null &&
        (!('expiresAt' in record) || record.expiresAt > Date.now());
      run.status = noDispatch ? 'failed' : 'unknown';
      run.error = noDispatch
        ? {
            code: 'PORTAL_PLAN_PRE_DISPATCH_REJECTED',
            message:
              'The authenticated original operation settled before source dispatch. A new run may be started.',
          }
        : prior.error;
      if (noDispatch) {
        run.events.push({
          sequence: run.nextSequence++,
          at: new Date().toISOString(),
          type: 'original-operation-pre-dispatch-rejected',
          message:
            'The original unknown outcome is retained in history; authenticated settlement proves no source dispatch.',
          data: {
            operationId: retained.id,
            previousRunStatus: prior.status,
            status: record!.status,
          },
        });
        run.events = run.events.slice(-500);
        delete run.unresolvedOperation;
        run.approvals = [];
        for (const node of run.nodes)
          if (node.status === 'unknown' || node.status === 'active' || node.status === 'waiting')
            node.status = 'failed';
      }
    });
  }
  private async originalOperationResolved(run: StoredRun): Promise<boolean> {
    const retained =
      run.unresolvedOperation ?? (run.operationId ? { id: run.operationId, name: null } : null);
    if (!retained?.id || !this.control.inspectOriginalOperation) return false;
    let raw: unknown;
    try {
      raw = await this.control.inspectOriginalOperation(retained.id);
    } catch {
      return false;
    }
    const parsed = z.union([OperationRecordSchema, OperationTombstoneSchema]).safeParse(raw);
    if (!parsed.success) return false;
    const record = parsed.data;
    const resolved =
      record.operationId === retained.id &&
      record.workspaceId === run.workspaceId &&
      record.operationKind === 'tool' &&
      (retained.name === null || record.operationName === retained.name) &&
      typeof record.settledAt === 'string' &&
      [
        'succeeded',
        'failed',
        'pre-egress-rejected',
        'rejected',
        'resolved-applied',
        'resolved-not-applied',
      ].includes(record.status);
    if (resolved)
      await this.store.event(
        run.id,
        'original-operation-resolved',
        'The authenticated service journal records the original operation disposition.',
        { operationId: retained.id, status: record.status },
      );
    return resolved;
  }
  private applyState(run: StoredRun, state: string): void {
    const statuses: Record<string, Run['status']> = {
      'needs-input': 'awaiting-input',
      'waiting-agent': 'awaiting-agent',
      generating: 'awaiting-agent',
      'candidate-ready': 'awaiting-input',
      'ready-to-apply': 'awaiting-input',
      'applied-awaiting-validation': 'awaiting-input',
      completed: 'completed',
      blocked: 'awaiting-input',
      failed: 'failed',
      cancelled: 'cancelled',
      conflict: 'unknown',
      'outcome-unknown': 'unknown',
      planned: 'awaiting-input',
    };
    run.status = statuses[state] ?? 'active';
    const achieved =
      state === 'completed'
        ? 4
        : ['applied-awaiting-validation', 'validating-applied'].includes(state)
          ? 3
          : ['ready-to-apply', 'applying'].includes(state)
            ? 3
            : ['candidate-ready', 'validating-candidate'].includes(state)
              ? 2
              : 1;
    for (const node of run.nodes) {
      const index = nodeTypes.indexOf(node.type);
      node.status = index <= achieved ? 'completed' : 'pending';
      node.message = state;
      if (index === achieved + 1 && state !== 'cancelled')
        node.status =
          run.status === 'unknown'
            ? 'unknown'
            : run.status === 'failed'
              ? 'failed'
              : run.status.startsWith('awaiting')
                ? 'waiting'
                : 'active';
    }
    if (state === 'needs-input') {
      const requirements = run.nodes.find(n => n.type === 'requirements');
      if (requirements) requirements.status = 'waiting';
      const generation = run.nodes.find(n => n.type === 'generation');
      if (generation) generation.status = 'pending';
    }
    if (state === 'applied-awaiting-validation' || state === 'validating-applied') {
      const validation = run.nodes.find(n => n.type === 'validation');
      if (validation) validation.status = state === 'validating-applied' ? 'active' : 'waiting';
      const output = run.nodes.find(n => n.type === 'output');
      if (output) {
        output.status = 'waiting';
        output.message = 'Applied output still requires final validation.';
      }
    }
    this.applySourceEvidence(run);
  }
  private applySourceEvidence(run: StoredRun): void {
    const context = run.context ?? {};
    const blueprint = 'blueprint' in context ? object(context.blueprint) : context;
    const design = object(blueprint.design);
    const issues = [
      ...(Array.isArray(blueprint.issues) ? blueprint.issues : []),
      ...(Array.isArray(run.result?.issues) ? run.result.issues : []),
    ];
    const designMissing = issues.some(
      issue =>
        typeof issue === 'string' &&
        (issue === 'DESIGN_CAPTURE_REQUIRED' ||
          issue.startsWith('WORKFLOW_ANALYSIS:DESIGN_MISSING')),
    );
    const complete = design.complete === true && !designMissing;
    const needsLive = run.workflow.plan.design.freshness === 'require-live';
    const current =
      !needsLive ||
      (design.liveVerified === true && !issues.includes('LIVE_DESIGN_VERIFICATION_REQUIRED'));
    const source = run.nodes.find(node => node.type === 'source');
    if (complete && current) {
      if (source) {
        source.status = 'completed';
        source.message = needsLive
          ? 'Complete live design capture recorded.'
          : 'Complete design capture recorded under the selected freshness policy.';
      }
      return;
    }
    const failureCode = object(design.captureFailure).code;
    if (source) {
      source.status =
        typeof failureCode === 'string' || run.status === 'failed' ? 'failed' : 'waiting';
      source.message =
        typeof failureCode === 'string'
          ? failureCode
          : complete
            ? 'LIVE_DESIGN_VERIFICATION_REQUIRED'
            : 'DESIGN_CAPTURE_REQUIRED';
    }
    const requirements = run.nodes.find(node => node.type === 'requirements');
    if (requirements) {
      requirements.status = 'waiting';
      requirements.message =
        'Waiting for complete design evidence under the selected freshness policy.';
    }
  }
}
