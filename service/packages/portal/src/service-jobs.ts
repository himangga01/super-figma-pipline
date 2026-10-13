import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ApprovalPromptV1Schema,
  InvocationTargetSelectorSchema,
  OperationRecordSchema,
  OperationTombstoneSchema,
} from '@sfp/shared';
import { z } from 'zod';

import {
  localCaptureFeatures,
  type LocalCapturePhase,
} from '../../cli/src/local-capture-execution.js';
import { Diagnostics, diagnosticContext, withDiagnostics } from '../../mcp/src/diagnostics.js';
import { parse, PortalError, publicError } from './contract.js';
import { PortalStore } from './store.js';

const functionName = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u);
export const ServiceJobInputSchema = z
  .object({
    type: z.enum(['tool', 'feature']),
    name: functionName,
    args: z.record(z.string(), z.unknown()),
    workspaceId: z.string().uuid().nullable(),
    targetSelector: InvocationTargetSelectorSchema,
  })
  .strict();
export const ServiceJobActionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'cancel', 'inspect', 'prepare-recovery', 'abandon-local']),
    approvalId: z.string().min(1).max(128).optional(),
    challengeId: z.string().uuid().optional(),
    fingerprint: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    workspaceBinding: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    confirm: z.string().max(512).optional(),
    reasonHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    evidenceHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    priorProducerRetired: z.boolean().optional(),
  })
  .strict();
export type ServiceJobInput = z.infer<typeof ServiceJobInputSchema>;
export interface ServiceDescriptor {
  name: string;
  description: string;
  group: string;
  kind: 'local' | 'read' | 'write';
  inputSchema: unknown;
  prerequisites: string[];
  confirmationRequired: boolean;
  executionProof?: 'single-operation' | 'composite' | 'local';
}
export interface RetainedOperation {
  operationId: string;
  name: string;
  kind: 'tool' | 'service';
  workspaceId: string | null;
}
export interface ServiceJobRuntime {
  localCaptureQuiescence?(): 'quiescent' | 'busy' | 'unconfirmed';
  recoveryWorkspaceBinding?(workspaceId: string): Promise<string | null>;
  preEffectFailure?(error: unknown, executionId: string): boolean;
  guard?(input: ServiceJobInput, capability: { readOnly: boolean; recovery: boolean }): void;
  catalog(): Promise<{ tools: ServiceDescriptor[]; features: ServiceDescriptor[] }>;
  prepare(input: ServiceJobInput): Promise<{
    descriptor: ServiceDescriptor;
    args: Record<string, unknown>;
    readOnly?: boolean;
    recovery?: boolean;
  }>;
  execute(
    input: ServiceJobInput,
    context: {
      signal: AbortSignal;
      deadlineAt: number;
      executionId?: string;
      progress?(phase: LocalCapturePhase): void;
      emit(value: unknown): void;
      beforeInvoke(input: RetainedOperation): Promise<void>;
    },
  ): Promise<unknown>;
  decide(approvalId: string, decision: 'approved' | 'rejected'): Promise<void>;
  inspect(operationId: string): Promise<unknown>;
}
const operationSchema = z
  .object({
    operationId: z.string().min(1).max(384),
    name: functionName,
    kind: z.enum(['tool', 'service']),
    workspaceId: z.string().uuid().nullable(),
  })
  .strict();
const rowSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['tool', 'feature']),
    name: functionName,
    kind: z.enum(['local', 'read', 'write']),
    readOnly: z.boolean(),
    executionProof: z.enum(['single-operation', 'composite', 'local']),
    argsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    workspaceId: z.string().uuid().nullable(),
    targetSelector: InvocationTargetSelectorSchema,
    status: z.enum([
      'queued',
      'running',
      'awaiting-confirmation',
      'awaiting-approval',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deadlineAt: z.number().int().positive(),
    operations: z.array(operationSchema).max(256),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
      .nullable(),
    outputHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    outputBytes: z.number().int().nonnegative().nullable(),
    preEffectFailure: z.literal(true).optional(),
    progress: z
      .array(
        z
          .object({
            phase: z.enum(['connecting', 'source-selected', 'capture-started', 'exporting']),
            at: z.string().datetime(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    fenceDisposition: z
      .object({
        decision: z.literal('owner-abandoned'),
        actor: z.literal('local-owner'),
        at: z.string().datetime(),
        fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        workspaceBinding: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        reasonHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        quiescence: z.enum(['observed', 'operator-asserted-prior-runtime']),
        activityId: z.string().uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();
type Row = z.infer<typeof rowSchema>;
type Approval = {
  source: 'portal' | 'service';
  approvalId: string;
  operationId?: string;
  operationName: string;
  expiresAt: number;
  target: { label: string };
  effectSummary: string[];
};
type Active = {
  controller: AbortController;
  input: ServiceJobInput;
  approvals: Approval[];
  decision: boolean;
  readOnly: boolean;
  recovery: boolean;
  release(): void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Set(['queued', 'running', 'awaiting-confirmation', 'awaiting-approval']);
const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function fail(code: string, status = 409): never {
  throw new PortalError(code, code, status);
}

/** Retains operation identity, never credentials, arguments, code bodies, leases or raw results. */
export class ServiceJobs {
  private queue: Promise<unknown> = Promise.resolve();
  private active = new Map<string, Active>();
  private preparing = 0;
  private inflight = new Set<Promise<void>>();
  private outputs = new Map<string, { value: unknown; bytes: number }>();
  private producers = new Map<string, 'pending' | 'settled'>();
  private progress = new Map<string, NonNullable<Row['progress']>>();
  private challenges = new Map<
    string,
    {
      id: string;
      fingerprint: string;
      workspaceBinding: string;
      expiresAt: number;
      legacy: boolean;
    }
  >();
  private durabilityFailure = false;
  private readonly diagnostics: Diagnostics;
  private constructor(
    private readonly store: PortalStore,
    private readonly runtime: ServiceJobRuntime,
    private rows: Row[],
    private readonly reserve?: (id: string, controller: AbortController) => () => void,
  ) {
    this.diagnostics = diagnosticContext()?.logger ?? new Diagnostics(store.directory, 'portal');
  }
  static async open(
    store: PortalStore,
    runtime: ServiceJobRuntime,
    reserve?: (id: string, controller: AbortController) => () => void,
  ): Promise<ServiceJobs> {
    let rows: Row[] = [];
    try {
      const bytes = await readFile(join(store.directory, 'service-jobs.json'));
      if (bytes.length > 2 * 1024 * 1024) fail('SERVICE_JOB_STORE_LIMIT');
      rows = parse(
        z.object({ version: z.literal(1), jobs: z.array(rowSchema).max(200) }).strict(),
        JSON.parse(bytes.toString()),
      ).jobs;
      if (new Set(rows.map(row => row.id)).size !== rows.length) fail('SERVICE_JOB_STORE_INVALID');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const manager = new ServiceJobs(store, runtime, rows, reserve);
    if (rows.some(row => pending.has(row.status)))
      await manager.write(next => {
        for (const row of next)
          if (pending.has(row.status)) {
            row.status = row.status === 'awaiting-confirmation' ? 'cancelled' : 'unknown';
            row.errorCode = 'PORTAL_SERVER_RESTARTED';
            row.updatedAt = new Date().toISOString();
          }
      });
    return manager;
  }
  /* eslint-disable promise/no-callback-in-promise -- serialize durable state before dispatch/publication */
  private write<T>(change: (rows: Row[]) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const rows = structuredClone(this.rows);
      const result = await change(rows);
      const bytes = JSON.stringify({ version: 1, jobs: rows });
      if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) fail('SERVICE_JOB_STORE_LIMIT');
      const path = join(this.store.directory, `service-jobs-${randomUUID()}.tmp`);
      try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        await rename(path, join(this.store.directory, 'service-jobs.json'));
      } catch (error) {
        this.diagnostics.record('job.persistence-error', {}, error, 'error');
        await rm(path, { force: true }).catch(() => undefined);
        this.durabilityFailure = true;
        throw error;
      }
      this.rows = rows;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  /* eslint-enable promise/no-callback-in-promise */
  private row(id: string): Row {
    return this.rows.find(row => row.id === id) ?? fail('SERVICE_JOB_NOT_FOUND', 404);
  }
  get(id: string) {
    const row = this.row(id),
      active = this.active.get(id),
      output = this.outputs.get(id);
    const enabled = (action: string) =>
      action === 'inspect'
        ? row.status === 'unknown' &&
          row.executionProof === 'single-operation' &&
          row.operations.length === 1
        : action === 'prepare-recovery'
          ? this.recoveryEligible(row) && this.recoveryQuiescent(id)
          : action === 'cancel'
            ? !!active
            : !!active &&
              !active.decision &&
              active.approvals.length > 0 &&
              ['awaiting-confirmation', 'awaiting-approval'].includes(row.status);
    return {
      ...structuredClone(row),
      progress: structuredClone(this.progress.get(id) ?? row.progress ?? []),
      recovery: {
        available: this.recoveryEligible(row) && this.recoveryQuiescent(id),
        legacyAssertionRequired: !this.producers.has(id),
        reason: this.recoveryEligible(row)
          ? this.recoveryQuiescent(id)
            ? 'Explicit owner acknowledgment required; outcome remains unknown.'
            : 'Execution or source cleanup is unconfirmed.'
          : 'Only zero-operation local capture unknowns with a workspace support this disposition.',
        challenge: structuredClone(this.challenges.get(id) ?? null),
      },
      operationId: row.operations.at(-1)?.operationId ?? null,
      approvals: structuredClone(active?.approvals ?? []),
      requestPreview: active ? structuredClone(active.input) : null,
      result: output?.value ?? null,
      outputUnavailable: !output && row.outputHash ? 'RESULT_NOT_RETAINED_AFTER_RESTART' : null,
      error: row.errorCode
        ? {
            code: row.errorCode,
            message: publicError(Object.assign(Error(row.errorCode), { code: row.errorCode }))
              .message,
          }
        : null,
      audit: { available: !this.durabilityFailure && this.store.activityHealth().available },
      actions: ['approve', 'reject', 'cancel', 'inspect', 'prepare-recovery'].map(action => ({
        action,
        enabled: enabled(action),
        reason: enabled(action) ? '' : 'This action is unavailable for the current job state.',
      })),
    };
  }
  list() {
    return this.rows.toReversed().map(row => this.get(row.id));
  }
  catalog() {
    return this.runtime.catalog();
  }
  private admit(input: ServiceJobInput, capability: { readOnly: boolean; recovery: boolean }) {
    if (!capability.readOnly && !capability.recovery && this.hasUnknownMutation(input.workspaceId))
      fail('SERVICE_JOB_OUTCOME_UNKNOWN');
    this.runtime.guard?.(input, capability);
  }
  hasUnknownMutation(workspaceId: string | null) {
    return this.rows.some(
      row =>
        row.status === 'unknown' &&
        !row.readOnly &&
        !this.dispositionMatches(row) &&
        (row.workspaceId === null || workspaceId === null || row.workspaceId === workspaceId),
    );
  }
  async idle() {
    await Promise.all(this.inflight);
    await this.queue;
    await this.diagnostics.flush();
  }
  private launch(id: string) {
    const row = this.row(id);
    const task = withDiagnostics(
      this.diagnostics,
      { jobId: id, functionName: row.name, workspaceId: row.workspaceId },
      () => this.run(id),
    );
    this.inflight.add(task);
    void task.finally(() => {
      this.inflight.delete(task);
    });
  }
  async create(raw: unknown) {
    const input = parse(ServiceJobInputSchema, raw),
      id = randomUUID(),
      controller = new AbortController();
    if (this.durabilityFailure) fail('SERVICE_JOB_WRITE_FAILED', 503);
    if (this.active.size + this.preparing >= 4) fail('SERVICE_JOB_BUSY');
    if (this.rows.length + this.preparing >= 200) fail('SERVICE_JOB_CAPACITY');
    const release = this.reserve?.(id, controller) ?? (() => {});
    this.preparing++;
    let retained = false;
    try {
      const prepared = await this.runtime.prepare(input);
      input.args = prepared.args;
      const readOnly = prepared.readOnly ?? prepared.descriptor.kind === 'read';
      const recovery = prepared.recovery === true;
      this.admit(input, { readOnly, recovery });
      const now = Date.now(),
        deadlineAt = now + 900000;
      const row: Row = {
        id,
        type: input.type,
        name: input.name,
        kind: prepared.descriptor.kind,
        readOnly,
        executionProof: prepared.descriptor.executionProof ?? 'single-operation',
        argsHash: hash(JSON.stringify(input.args)),
        workspaceId: input.workspaceId,
        targetSelector: input.targetSelector,
        status: prepared.descriptor.confirmationRequired ? 'awaiting-confirmation' : 'queued',
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        deadlineAt,
        operations: [],
        errorCode: null,
        outputHash: null,
        outputBytes: null,
      };
      await this.write(rows => {
        rows.push(row);
      });
      const timer = setTimeout(
        () => {
          controller.abort(Error('SERVICE_JOB_DEADLINE'));
          if (this.row(id).status === 'awaiting-confirmation')
            void this.cancelPending(id).catch(() => undefined);
        },
        Math.max(1, deadlineAt - Date.now()),
      );
      timer.unref();
      const approvals: Approval[] = prepared.descriptor.confirmationRequired
        ? [
            {
              source: 'portal',
              approvalId: randomUUID(),
              operationName: input.name,
              expiresAt: deadlineAt,
              target: { label: input.workspaceId ?? 'Local service owner' },
              effectSummary: [
                `Execute ${input.name} with the reviewed arguments (${row.argsHash}).`,
              ],
            },
          ]
        : [];
      this.active.set(id, {
        controller,
        input,
        approvals,
        decision: false,
        readOnly,
        recovery,
        release,
        timer,
      });
      retained = true;
      this.diagnostics.record('job.created', {
        jobId: id,
        functionName: row.name,
        outcome: row.status,
        argsHash: row.argsHash,
        workspaceId: row.workspaceId,
      });
      if (!prepared.descriptor.confirmationRequired) this.launch(id);
      return this.get(id);
    } finally {
      this.preparing--;
      if (!retained) release();
    }
  }
  private release(id: string) {
    const active = this.active.get(id);
    if (active) {
      clearTimeout(active.timer);
      active.release();
      this.active.delete(id);
    }
  }
  private async update(id: string, change: (row: Row) => void) {
    await this.write(rows => {
      const row = rows.find(value => value.id === id)!;
      change(row);
      if (this.progress.has(id)) row.progress = structuredClone(this.progress.get(id)!);
      row.updatedAt = new Date().toISOString();
    });
    const row = this.row(id);
    this.diagnostics.record('job.state', {
      jobId: id,
      functionName: row.name,
      outcome: row.status,
      errorCode: row.errorCode,
      operationCount: row.operations.length,
      outputHash: row.outputHash,
      outputBytes: row.outputBytes,
    });
  }
  private async cancelPending(id: string) {
    try {
      await this.update(id, row => {
        row.status = 'cancelled';
        row.errorCode = 'SERVICE_JOB_CANCELLED';
      });
    } finally {
      this.release(id);
    }
  }
  private async run(id: string) {
    const started = performance.now();
    const active = this.active.get(id)!;
    let events = Promise.resolve();
    let abortListener: (() => void) | undefined;
    let executing = false;
    try {
      this.admit(active.input, active);
      await this.update(id, row => {
        row.status = 'running';
      });
      active.controller.signal.throwIfAborted();
      this.admit(active.input, active);
      executing = true;
      const operation = this.runtime.execute(active.input, {
        signal: active.controller.signal,
        deadlineAt: this.row(id).deadlineAt,
        executionId: id,
        progress: phase => {
          if (
            !['connecting', 'source-selected', 'capture-started', 'exporting'].includes(phase) ||
            active.controller.signal.aborted ||
            !pending.has(this.row(id).status)
          )
            return;
          const history = this.progress.get(id) ?? [];
          if (history.at(-1)?.phase === phase || history.length >= 8) return;
          history.push({ phase, at: new Date().toISOString() });
          this.progress.set(id, history);
          this.diagnostics.record('job.state', { jobId: id, phase });
        },
        beforeInvoke: async input => {
          active.controller.signal.throwIfAborted();
          this.admit(active.input, active);
          const retained = parse(operationSchema, input);
          if (retained.workspaceId !== active.input.workspaceId) fail('SERVICE_JOB_SCOPE_MISMATCH');
          await this.update(id, row => {
            if (row.operations.length >= 256) fail('SERVICE_JOB_OPERATION_LIMIT');
            if (!row.operations.some(value => value.operationId === retained.operationId))
              row.operations.push(retained);
          });
          this.diagnostics.record('job.operation-retained', {
            jobId: id,
            operationId: retained.operationId,
            functionName: retained.name,
          });
          active.controller.signal.throwIfAborted();
          this.admit(active.input, active);
        },
        emit: value => {
          events = events
            .then(async () => {
              const event = object(value);
              if (event.status !== 'approval-required') return;
              const parsed = ApprovalPromptV1Schema.safeParse(event.prompt);
              if (!parsed.success) return;
              const prompt = parsed.data;
              if (
                !this.row(id).operations.some(
                  op =>
                    op.operationId === prompt.operationId &&
                    op.name === prompt.operationName &&
                    op.kind === prompt.operationKind,
                ) ||
                active.controller.signal.aborted ||
                !pending.has(this.row(id).status)
              )
                return;
              active.approvals.push({
                source: 'service',
                approvalId: prompt.approvalId,
                operationId: prompt.operationId,
                operationName: prompt.operationName,
                expiresAt: prompt.expiresAt,
                target: { label: prompt.target.label },
                effectSummary: [...prompt.effectSummary],
              });
              await this.update(id, row => {
                row.status = 'awaiting-approval';
              });
              return;
            })
            .catch(() => {
              active.controller.abort(Error('SERVICE_JOB_WRITE_FAILED'));
            });
        },
      });
      this.producers.set(id, 'pending');
      // Observe the real producer even when the caller wins the cancellation race.
      void operation.then(
        () => {
          this.producers.set(id, 'settled');
          return undefined;
        },
        () => {
          this.producers.set(id, 'settled');
          return undefined;
        },
      );
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(active.controller.signal.reason);
        active.controller.signal.addEventListener('abort', abortListener, { once: true });
        if (active.controller.signal.aborted) abortListener();
      });
      const result = await Promise.race([operation, aborted]);
      await events;
      active.controller.signal.throwIfAborted();
      const bytes = JSON.stringify(result ?? null),
        outputBytes = Buffer.byteLength(bytes);
      if (outputBytes > 8 * 1024 * 1024) fail('SERVICE_JOB_RESULT_LIMIT');
      while (
        [...this.outputs.values()].reduce((sum, value) => sum + value.bytes, 0) + outputBytes >
        32 * 1024 * 1024
      ) {
        const key = this.outputs.keys().next().value;
        if (!key) break;
        this.outputs.delete(key);
      }
      this.outputs.set(id, { value: result ?? null, bytes: outputBytes });
      await this.update(id, row => {
        row.status = ['outcome-unknown', 'conflict'].includes(String(object(result).state))
          ? 'unknown'
          : 'succeeded';
        row.outputHash = hash(bytes);
        row.outputBytes = outputBytes;
      });
    } catch (error) {
      this.diagnostics.record(
        'job.execution-error',
        { jobId: id, durationMs: performance.now() - started },
        error,
        'error',
      );
      const row = this.row(id);
      const preEffect =
        row.operations.length === 0 &&
        this.producers.get(id) === 'settled' &&
        this.runtime.preEffectFailure?.(error, id) === true;
      const status =
        !row.readOnly &&
        executing &&
        !preEffect &&
        (row.operations.length > 0 || row.executionProof !== 'single-operation')
          ? 'unknown'
          : active.controller.signal.aborted
            ? 'cancelled'
            : 'failed';
      try {
        await this.update(id, value => {
          value.status = status;
          if (preEffect) value.preEffectFailure = true;
          value.errorCode = publicError(error).code;
        });
      } catch (persistError) {
        this.diagnostics.record('job.settlement-error', { jobId: id }, persistError, 'error');
        this.durabilityFailure = true;
        row.status = 'unknown';
        row.errorCode = 'SERVICE_JOB_WRITE_FAILED';
      }
    } finally {
      if (abortListener) active.controller.signal.removeEventListener('abort', abortListener);
      this.release(id);
      const row = this.row(id);
      this.diagnostics.record('job.finished', {
        jobId: id,
        outcome: row.status,
        durationMs: performance.now() - started,
        errorCode: row.errorCode,
      });
      await this.store.observeActivity({
        type: 'service.job-state',
        source: 'service',
        ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
        metadata: {
          jobId: id,
          functionType: row.type,
          functionName: row.name,
          jobStatus: row.status,
          ...(row.errorCode ? { errorCode: row.errorCode } : {}),
        },
      });
    }
  }
  async action(id: string, raw: unknown) {
    const input = parse(ServiceJobActionSchema, raw),
      row = this.row(id),
      active = this.active.get(id);
    if (input.action === 'prepare-recovery' || input.action === 'abandon-local') {
      if (!this.recoveryEligible(row) || !this.recoveryQuiescent(id))
        fail('LOCAL_CAPTURE_RECOVERY_UNAVAILABLE');
      if (!this.runtime.recoveryWorkspaceBinding) fail('LOCAL_CAPTURE_RECOVERY_UNAVAILABLE');
      const binding = await this.runtime.recoveryWorkspaceBinding(row.workspaceId!);
      if (!binding || !/^sha256:[a-f0-9]{64}$/u.test(binding))
        fail('LOCAL_CAPTURE_WORKSPACE_UNAVAILABLE');
      const fingerprint = this.fingerprint(row);
      if (input.action === 'prepare-recovery') {
        this.challenges.set(id, {
          id: randomUUID(),
          fingerprint,
          workspaceBinding: binding,
          expiresAt: Date.now() + 60_000,
          legacy: !this.producers.has(id),
        });
        return this.get(id);
      }
      const challenge = this.challenges.get(id);
      if (
        !challenge ||
        challenge.id !== input.challengeId ||
        challenge.expiresAt <= Date.now() ||
        challenge.fingerprint !== fingerprint ||
        input.fingerprint !== fingerprint ||
        challenge.workspaceBinding !== binding ||
        input.workspaceBinding !== binding ||
        input.confirm !== `${id}/${fingerprint}` ||
        !input.reasonHash ||
        !input.evidenceHash ||
        (challenge.legacy && input.priorProducerRetired !== true)
      )
        fail('LOCAL_CAPTURE_RECOVERY_CONFIRMATION_INVALID');
      // Consume before asynchronous audit/write. An uncertain response requires readback.
      this.challenges.delete(id);
      const audit = await this.store.recordActivity({
        type: 'service.job.action',
        source: 'server',
        actor: 'local-owner',
        status: 'started',
        workspaceId: row.workspaceId!,
        sessionId: this.store.activitySessionId,
        requestId: randomUUID(),
        metadata: { jobId: id, jobAction: 'abandon-local' },
      });
      if ((await this.runtime.recoveryWorkspaceBinding(row.workspaceId!)) !== binding)
        fail('LOCAL_CAPTURE_WORKSPACE_UNAVAILABLE');
      await this.write(async rows => {
        const current = rows.find(value => value.id === id)!;
        const currentBinding = await this.runtime.recoveryWorkspaceBinding!(row.workspaceId!);
        if (
          !this.recoveryEligible(current) ||
          !this.recoveryQuiescent(id) ||
          this.fingerprint(current) !== fingerprint ||
          currentBinding !== binding ||
          challenge.expiresAt <= Date.now()
        )
          fail('LOCAL_CAPTURE_RECOVERY_UNAVAILABLE');
        current.fenceDisposition = {
          decision: 'owner-abandoned',
          actor: 'local-owner',
          at: new Date().toISOString(),
          fingerprint,
          workspaceBinding: binding,
          reasonHash: input.reasonHash!,
          evidenceHash: input.evidenceHash!,
          activityId: audit.id,
          quiescence: challenge.legacy ? 'operator-asserted-prior-runtime' : 'observed',
        };
      });
      // The disposition itself contains the durable audit. Never undo it or redispatch on audit errors.
      await this.store
        .settleActivity(audit.id, 'succeeded', {
          metadata: { jobId: id, jobAction: 'abandon-local', jobStatus: 'unknown' },
        })
        .catch(() => undefined);
      return this.get(id);
    }
    if (input.action === 'inspect') {
      if (row.status !== 'unknown') fail('SERVICE_JOB_ACTION_UNAVAILABLE');
      if (row.executionProof !== 'single-operation' || row.operations.length !== 1)
        return this.get(id);
      const original = row.operations[0]!;
      const parsed = z
        .union([OperationRecordSchema, OperationTombstoneSchema])
        .safeParse(await this.runtime.inspect(original.operationId));
      if (parsed.success) {
        const proof = parsed.data;
        if (
          proof.operationId === original.operationId &&
          proof.operationName === original.name &&
          proof.operationKind === original.kind &&
          proof.workspaceId === original.workspaceId &&
          typeof proof.settledAt === 'string' &&
          [
            'succeeded',
            'resolved-applied',
            'failed',
            'pre-egress-rejected',
            'rejected',
            'resolved-not-applied',
          ].includes(proof.status)
        )
          await this.update(id, value => {
            value.status = ['succeeded', 'resolved-applied'].includes(proof.status)
              ? 'succeeded'
              : 'failed';
            value.errorCode = null;
          });
      }
      return this.get(id);
    }
    if (!active) fail('SERVICE_JOB_ACTION_UNAVAILABLE');
    if (input.action === 'cancel') {
      active.controller.abort(Error('SERVICE_JOB_CANCELLED'));
      if (row.status === 'awaiting-confirmation') await this.cancelPending(id);
      return this.get(id);
    }
    const approval = active.approvals.find(value => value.approvalId === input.approvalId);
    if (
      !approval ||
      approval.expiresAt <= Date.now() ||
      active.decision ||
      !['awaiting-confirmation', 'awaiting-approval'].includes(row.status)
    )
      fail('SERVICE_JOB_APPROVAL_INVALID');
    active.decision = true;
    try {
      if (approval.source === 'portal') {
        if (input.action === 'approve') this.admit(active.input, active);
        active.approvals = [];
        if (input.action === 'reject') {
          await this.cancelPending(id);
          return this.get(id);
        }
        await this.update(id, value => {
          value.status = 'queued';
        });
        this.launch(id);
      } else {
        await this.runtime.decide(
          approval.approvalId,
          input.action === 'approve' ? 'approved' : 'rejected',
        );
        if (
          this.active.get(id) === active &&
          this.row(id).status === 'awaiting-approval' &&
          !active.controller.signal.aborted &&
          active.approvals.includes(approval)
        ) {
          active.approvals = active.approvals.filter(value => value !== approval);
          await this.update(id, value => {
            if (value.status === 'awaiting-approval')
              value.status = active.approvals.length ? 'awaiting-approval' : 'running';
          });
        }
      }
    } finally {
      active.decision = false;
    }
    return this.get(id);
  }

  private recoveryEligible(row: Row) {
    return (
      !row.fenceDisposition &&
      row.type === 'feature' &&
      row.status === 'unknown' &&
      !row.readOnly &&
      row.executionProof === 'composite' &&
      row.operations.length === 0 &&
      row.workspaceId !== null &&
      localCaptureFeatures.some(name => name === row.name)
    );
  }
  private recoveryQuiescent(id: string) {
    return (
      !this.active.has(id) &&
      this.producers.get(id) !== 'pending' &&
      this.runtime.localCaptureQuiescence?.() === 'quiescent' &&
      !this.durabilityFailure
    );
  }
  private fingerprint(row: Row) {
    const { fenceDisposition: _disposition, ...original } = row;
    return hash(JSON.stringify(original));
  }
  private dispositionMatches(row: Row) {
    return (
      row.type === 'feature' &&
      row.status === 'unknown' &&
      !row.readOnly &&
      row.executionProof === 'composite' &&
      row.operations.length === 0 &&
      row.workspaceId !== null &&
      localCaptureFeatures.some(name => name === row.name) &&
      row.fenceDisposition?.fingerprint === this.fingerprint(row)
    );
  }
}
