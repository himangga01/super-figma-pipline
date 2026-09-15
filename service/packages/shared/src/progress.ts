import { z } from 'zod';

import { ToolNameSchema } from './invocation.js';
import { ServiceOperationNameSchema } from './service-operations.js';

const RequestIdSchema = z.string().regex(/^sfp_req1_[A-Za-z0-9_-]{21}[AQgw]$/u);
const OperationIdSchema = z.string().min(1).max(384);

export const PROGRESS_TRANSPORT_LIMITS = Object.freeze({
  maxPhaseCharacters: 64,
  maxMessageUtf8Bytes: 1_024,
  maxProgressFrameBytesIncludingPrefix: 16_384,
  maxPreAcceptedBytes: 65_536,
  maxSubscriberFrames: 64,
  maxSubscriberBytes: 262_144,
  maxProgressFramesPerSecond: 20,
} as const);

export const INVOCATION_ADMISSION_LIMITS = Object.freeze({
  maxActiveOperationsPerOwner: 256,
  maxActiveOperationsPerAuthSession: 64,
  maxSubscribersPerOperation: 8,
  maxSubscribersPerOwner: 256,
  maxRawArgsBytesPerOperation: 8_388_608,
  maxRawArgsBytesPerOwner: 67_108_864,
  requestIdCharacters: 31,
  maxToolNameCharacters: 128,
  workspaceIdCharacters: 36,
  sessionSelectorCharacters: 22,
  targetSelectorMaxBytes: 115,
} as const);

const utf8Length = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

const invocationSizeError = () =>
  Object.assign(new Error('invocation arguments exceed their byte limit'), {
    code: 'INVOCATION_TOO_LARGE',
    beforeAllocation: true,
  });

export const measureCanonicalJsonUtf8Bytes = (value: unknown, maxBytes: number): number => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw invocationSizeError();
  let bytes = 0;
  const add = (count: number): void => {
    bytes += count;
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw invocationSizeError();
  };
  const stringBytes = (text: string): void => {
    add(2);
    for (const character of text) {
      const codePoint = character.codePointAt(0) as number;
      if (character === '"' || character === '\\' || '\b\f\n\r\t'.includes(character)) add(2);
      else if (codePoint < 0x20) add(6);
      else add(codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4);
    }
  };
  const visit = (child: unknown, ancestors: Set<object>): void => {
    if (typeof child === 'string') {
      stringBytes(child);
      return;
    }
    if (child === null) {
      add(4);
      return;
    }
    if (typeof child === 'boolean') {
      add(child ? 4 : 5);
      return;
    }
    if (typeof child === 'number') {
      const encoded = JSON.stringify(child);
      if (encoded === undefined) throw invocationSizeError();
      add(encoded.length);
      return;
    }
    if (typeof child !== 'object') throw invocationSizeError();
    if (ancestors.has(child)) throw invocationSizeError();
    ancestors.add(child);
    if (Array.isArray(child)) {
      add(1);
      child.forEach((member, index) => {
        if (index > 0) add(1);
        visit(member, ancestors);
      });
      add(1);
    } else {
      add(1);
      const entries = Object.entries(child)
        .filter(([, member]) => member !== undefined)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      entries.forEach(([key, member], index) => {
        if (index > 0) add(1);
        stringBytes(key);
        add(1);
        visit(member, ancestors);
      });
      add(1);
    }
    ancestors.delete(child);
  };
  visit(value, new Set());
  return bytes;
};

const SAFE_INVOCATION_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  PORTAL_NATIVE_PROFILE_REQUIRED:
    'Register an owner-reviewed native validation profile for this exact candidate before validation. Docker is not used.',
  PORTAL_VALIDATION_REQUIRED:
    'All required portal acceptance checks must pass before source application.',
  PORTAL_CANDIDATE_CHANGED:
    'The portal candidate changed after admission; review the new candidate before retrying validation or application.',
  PORTAL_PROFILE_CLOSURE_CHANGED:
    'The reviewed native script or configuration changed; register a profile for the current source.',
  PORTAL_EXECUTABLE_CHANGED: 'The approved native executable changed.',
  PORTAL_NATIVE_CLEANUP_UNKNOWN:
    'Native process cleanup could not be verified; reconcile the owned run.',
  PORTAL_PLAN_NOT_FOUND: 'Portal plan was not found for this owner.',
  PORTAL_RUN_NOT_FOUND: 'Portal run was not found for this owner.',
  PORTAL_LEASE_INVALID: 'The coding lease expired or belongs to a different authenticated session.',
  PORTAL_LEASE_BUSY: 'Another authenticated session holds the active coding lease.',
  PORTAL_SOURCE_CHANGED: 'The source repository changed after planning.',
  PORTAL_ROOT_CHANGED: 'A repository directory was replaced after planning.',
  PORTAL_BASE_CHANGED:
    'A target file differs from the approved preimage; preserve the current file and reconcile.',
  PORTAL_RECONCILIATION_REQUIRED:
    'The run has uncertain or conflicting source effects that require reconciliation.',
  PORTAL_SOURCE_ANALYSIS_INCOMPLETE:
    'Service analysis is incomplete; resolve the reported source coverage gaps.',
  PORTAL_BUDGET_EXHAUSTED: 'The portal run exhausted its original execution budget.',
  PORTAL_REPAIR_BUDGET_EXHAUSTED: 'The portal run exhausted its coding repair budget.',
  PORTAL_STATE_NOT_VALIDATABLE: 'The current run state does not permit validation.',
  PORTAL_STATE_NOT_CLAIMABLE: 'The current run state does not permit a coding lease.',
  PLUGIN_RESULT_INVALID: 'plugin returned an invalid result',
  SERVER_RESULT_INVALID: 'server returned an invalid result',
  INVOCATION_ARGS_INVALID: 'invocation arguments are invalid',
  INVOCATION_TOO_LARGE: 'invocation exceeds its size limit',
  OPERATION_CANCELLED: 'operation was cancelled',
  OPERATION_OUTCOME_UNKNOWN: 'operation outcome is unknown',
  OPERATION_TERMINAL_DURABILITY_FAILED: 'operation terminal durability failed',
  OPERATION_ALREADY_SETTLED: 'operation is already settled',
  APPROVAL_REJECTED: 'operation approval was rejected',
  APPROVAL_EXPIRED: 'operation approval expired',
  APPROVAL_CHANNEL_UNAVAILABLE: 'operation approval channel is unavailable',
  EGRESS_CONFIG_REQUIRED: 'egress is not explicitly configured',
  EGRESS_CONSENT_REQUIRED: 'egress consent does not allow this operation',
  LEADER_GENERATION_CLOSED: 'leader generation is closed',
  INTERNAL_ERROR: 'operation failed internally',
  EVIDENCE_CAPTURE_TOO_LARGE:
    'Captured result exceeds the service byte limit; inspect the operation outcome.',
  CORE_ASSET_BYTE_LIMIT: 'Core asset byte limit.',
  CORE_AUDIT_WORK_LIMIT: 'Core audit work limit.',
  CORE_BUNDLE_LIMIT: 'Core bundle limit.',
  CORE_C4_SOURCE_CASE_MISMATCH: 'Core c4 source case mismatch.',
  CORE_CAPABILITY_SET_MISMATCH: 'Core capability set mismatch.',
  CORE_CAPACITY_BINDING_MISMATCH: 'Core capacity binding mismatch.',
  CORE_CAPACITY_INTENT_CONFLICT: 'Core capacity intent conflict.',
  CORE_CAPACITY_LEGACY_RECOVERY_REQUIRED: 'Core capacity legacy recovery required.',
  CORE_CAPACITY_LIMIT_INVALID: 'Core capacity limit invalid.',
  CORE_CONTRACT_MISMATCH: 'Core contract mismatch.',
  CORE_DUPLICATE_ASSET_QUERY: 'Core duplicate asset query.',
  CORE_DUPLICATE_MAPPING_MEMBER: 'Core duplicate mapping member.',
  CORE_DUPLICATE_ROW: 'Core duplicate row.',
  CORE_DUPLICATE_SOURCE: 'Core duplicate source.',
  CORE_INPUT_LIMIT: 'Core input limit.',
  CORE_ITEM_BYTE_LIMIT: 'Core item byte limit.',
  CORE_MANIFEST_COUNTS_MISMATCH: 'Core manifest counts mismatch.',
  CORE_MAPPING_CANONICAL_HASH_MISMATCH: 'Core mapping canonical hash mismatch.',
  CORE_MAPPING_DISCOVERY_LIMIT: 'Core mapping discovery limit.',
  CORE_MAPPING_MEMBER_SET_MISMATCH: 'Core mapping member set mismatch.',
  CORE_MAPPING_PATH_OUTSIDE_SELECTION: 'Core mapping path outside selection.',
  CORE_MAPPING_PROFILE_CONFLICT: 'Core mapping profile conflict.',
  CORE_MATERIAL_HASH_MISMATCH: 'Core material hash mismatch.',
  CORE_OBSERVATION_CHANGED: 'Core observation changed.',
  CORE_ORPHAN_BINDING_MISMATCH: 'Core orphan binding mismatch.',
  CORE_PAGE_BINDING_MISMATCH: 'Core page binding mismatch.',
  CORE_PAGE_BYTE_LIMIT: 'Core page byte limit.',
  CORE_PAGE_SET_MISMATCH: 'Core page set mismatch.',
  CORE_PREPARATION_CANCELLED: 'Core preparation cancelled.',
  CORE_PREPARATION_CAPACITY_EXCEEDED: 'Core preparation capacity exceeded.',
  CORE_PREPARATION_CONTEXT_CHANGED: 'Core preparation context changed.',
  CORE_PREPARATION_CONTEXT_MISMATCH: 'Core preparation context mismatch.',
  CORE_PREPARATION_INTENT_CHANGED: 'Core preparation intent changed.',
  CORE_PREPARATION_INTENT_NOT_FOUND: 'Core preparation intent not found.',
  CORE_PREPARATION_IN_USE: 'Core preparation in use.',
  CORE_PREPARATION_NOT_FOUND: 'Core preparation not found.',
  CORE_PREPARATION_NOT_READY: 'Core preparation not ready.',
  CORE_PREPARATION_OWNER_MISMATCH: 'Core preparation owner mismatch.',
  CORE_PREPARATION_REVISION_CHANGED: 'Core preparation revision changed.',
  CORE_PREPARATION_SOURCE_MISMATCH: 'Core preparation source mismatch.',
  CORE_REQUIRED_RECIPE_MISSING: 'Core required recipe missing.',
  CORE_REQUIRED_RESULT_MISSING: 'Core required result missing.',
  CORE_RESULT_BINDING_MISMATCH: 'Core result binding mismatch.',
  CORE_RESULT_MISSING: 'Core result missing.',
  CORE_SOURCE_CAPSULE_INVALID: 'Core source capsule invalid.',
  CORE_SOURCE_CHANGED: 'Core source changed.',
  CORE_SOURCE_CONTEXT_HASH_MISMATCH: 'Core source context hash mismatch.',
  CORE_SOURCE_CONTEXT_LIMIT: 'Core source context limit.',
  CORE_SOURCE_CONTEXT_MISSING: 'Core source context missing.',
  CORE_SOURCE_CONTEXT_SET_MISMATCH: 'Core source context set mismatch.',
  CORE_SOURCE_ID_INVALID: 'Core source id invalid.',
  CORE_SOURCE_INVENTORY_INCOMPLETE: 'Core source inventory incomplete.',
  CORE_SOURCE_PATTERN_INCOMPLETE: 'Core source pattern incomplete.',
  CORE_SOURCE_SET_INVALID: 'Core source set invalid.',
  CORE_STRATEGY_INVALID: 'Core strategy invalid.',
  CORE_TOKEN_MATRIX_LIMIT: 'Core token matrix limit.',
  PORTAL_CORE_ADMISSION_REQUIRED: 'Portal core admission required.',
  PORTAL_CORE_ASSET_CHANGED: 'Portal core asset changed.',
  PORTAL_CORE_ASSET_REQUIRED: 'Portal core asset required.',
  PORTAL_CORE_BINDING_CHANGED: 'Portal core binding changed.',
  PORTAL_CORE_DECLARATIONS_INCOMPLETE: 'Portal core declarations incomplete.',
  PORTAL_CORE_DECLARATION_FILE_CHANGED: 'Portal core declaration file changed.',
  PORTAL_CORE_DECLARATION_NOT_BOUND: 'Portal core declaration not bound.',
  PORTAL_CORE_DEFINITION_CHANGED: 'Portal core definition changed.',
  PORTAL_CORE_DEFINITION_UNAVAILABLE: 'Portal core definition unavailable.',
  PORTAL_CORE_INTENT_CANCELLED: 'Portal core intent cancelled.',
  PORTAL_CORE_PAGE_NOT_FOUND: 'Portal core page not found.',
  PORTAL_CORE_PREPARATION_NOT_READY: 'Portal core preparation not ready.',
  PORTAL_CORE_PREPARATION_REQUIRED: 'Portal core preparation required.',
  PORTAL_CORE_READ_LIMIT: 'Portal core read limit.',
  PORTAL_CORE_REPLAN_REQUIRED: 'Portal core replan required.',
  PORTAL_CORE_RESULT_NOT_FOUND: 'Portal core result not found.',
  PORTAL_CORE_RESULT_SET_CHANGED: 'Portal core result set changed.',
  PORTAL_CORE_RESUME_CAPTURE_CHANGED: 'Portal core resume capture changed.',
  PORTAL_CORE_RESUME_REQUEST_CHANGED: 'Portal core resume request changed.',
  PORTAL_CORE_RUNTIME_REQUIRED: 'Portal core runtime required.',
  PORTAL_CORE_SOURCE_CHANGED: 'Portal core source changed.',
  PORTAL_CORE_SOURCE_REQUIRED: 'Portal core source required.',
  RECIPE_HOLD_SCOPE_MISMATCH: 'Recipe evidence belongs to another actor, session or workspace.',
  RECIPE_HOLD_WORKSPACE_MISMATCH: 'The recipe evidence workspace differs from its admitted root.',
  RECIPE_HOLD_WORKSPACE_REQUIRED: 'Recipe evidence requires a registered workspace.',
  RECIPE_HOLD_BINDING_CHANGED: 'This recipe step is already bound to different operation inputs.',
  RECIPE_HOLD_OPERATION_ALREADY_BOUND:
    'This operation is already retained for another recipe step.',
  RECIPE_HOLD_OPERATION_MISMATCH:
    'The actual operation does not match the retained recipe binding.',
  RECIPE_HOLD_OPERATION_NOT_SUCCEEDED:
    'The retained operation has no successful result to consume.',
  RECIPE_HOLD_OPERATION_UNSETTLED: 'Unsettled or unknown operation evidence cannot be released.',
  RECIPE_HOLD_RESULT_SCHEMA_MISSING: 'The operation has no supported result schema.',
  RECIPE_HOLD_SCHEMA_CHANGED:
    'The operation result schema changed; fresh recipe authority is required.',
  RECIPE_HOLD_EVIDENCE_INVALID:
    'The operation evidence does not satisfy the retained recipe binding.',
  RECIPE_HOLD_EVIDENCE_UNAVAILABLE: 'Required operation evidence is missing or cannot be verified.',
  RECIPE_HOLD_RESULT_CHANGED: 'The retained result bytes changed.',
  RECIPE_HOLD_RESULT_INVALID: 'The retained result does not match its declared schema.',
  RECIPE_HOLD_RESULT_NOT_CANONICAL: 'The retained result is not the canonical published output.',
  RECIPE_HOLD_SETTLED_EVIDENCE_CHANGED: 'Previously verified operation evidence changed.',
  RECIPE_HOLD_INDEX_DUPLICATE: 'The recipe hold index contains duplicate identities.',
  RECIPE_HOLD_INDEX_INVALID: 'The recipe hold index is inconsistent.',
  RECIPE_HOLD_REVISION_CHANGED: 'The recipe hold revision changed during publication.',
  RECIPE_HOLD_CAPACITY_EXCEEDED:
    'Recipe evidence retention capacity is exhausted; active evidence was preserved.',
  RECIPE_HOLD_NOT_FOUND: 'No matching recipe evidence hold exists.',
  RECIPE_HOLD_RELEASED: 'Released recipe evidence cannot be reopened implicitly.',
  RECIPE_HOLD_HAS_DEPENDENTS: 'An active server dependency still requires this recipe evidence.',
  RECIPE_HOLD_DEPENDENCY_INVALID: 'The server evidence dependency is invalid.',
  RECIPE_HOLD_DEPENDENCY_LIMIT: 'The recipe evidence dependency limit was reached.',
  RECIPE_HOLD_ORPHAN_EVIDENCE:
    'Existing evidence has no matching operation identity; recovery is required.',
  RECIPE_HOLD_LIMIT_INVALID: 'The configured recipe retention limit is invalid.',
  RECIPE_HOLD_RETENTION_CONFLICT:
    'Held evidence has an unresolved pending cleanup intent; evidence was preserved.',
  RECIPE_HOLD_RETENTION_SCOPE_INVALID:
    'Managed evidence cleanup requires the current locked retention snapshot.',
  RECIPE_HOLD_HISTORY_CAPACITY_EXCEEDED:
    'Recipe hold history reached its physical retention limit; existing evidence was preserved.',
});

export const safeInvocationError = (
  error: unknown,
): Readonly<{ code: string; message: string; retryable: boolean }> => {
  const observed =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const code = Object.hasOwn(SAFE_INVOCATION_ERRORS, observed) ? observed : 'INTERNAL_ERROR';
  return Object.freeze({
    code,
    message: SAFE_INVOCATION_ERRORS[code] as string,
    retryable: false,
  });
};

export const ProgressEventSchema = z
  .object({
    operationId: OperationIdSchema,
    phase: z.string().min(1).max(PROGRESS_TRANSPORT_LIMITS.maxPhaseCharacters),
    completed: z.number().finite().nonnegative(),
    total: z.number().finite().nonnegative().nullable(),
    message: z
      .string()
      .refine(
        value => utf8Length(value) <= PROGRESS_TRANSPORT_LIMITS.maxMessageUtf8Bytes,
        'progress message exceeds its UTF-8 byte limit',
      ),
    emittedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(value => value.total === null || value.completed <= value.total, {
    message: 'progress completed exceeds total',
  });
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

const AcceptedFrameSchema = z
  .object({
    version: z.literal(1),
    type: z.literal('accepted'),
    requestId: RequestIdSchema,
    operationId: OperationIdSchema,
    operationKind: z.enum(['tool', 'service']),
    operationName: z.union([ToolNameSchema, ServiceOperationNameSchema]),
  })
  .strict()
  .refine(
    value =>
      (value.operationKind === 'tool' && ToolNameSchema.safeParse(value.operationName).success) ||
      (value.operationKind === 'service' &&
        ServiceOperationNameSchema.safeParse(value.operationName).success),
    { message: 'accepted frame kind and operation name do not match' },
  );
const ProgressFrameSchema = z
  .object({
    version: z.literal(1),
    type: z.literal('progress'),
    requestId: RequestIdSchema,
    operationId: OperationIdSchema,
    progress: ProgressEventSchema,
  })
  .strict()
  .refine(value => value.operationId === value.progress.operationId, {
    message: 'progress operation ID does not match its frame',
  });
const ResultFrameSchema = z
  .object({
    version: z.literal(1),
    type: z.literal('result'),
    requestId: RequestIdSchema,
    operationId: OperationIdSchema,
    result: z.unknown(),
  })
  .strict();
const ErrorFrameSchema = z
  .object({
    version: z.literal(1),
    type: z.literal('error'),
    requestId: RequestIdSchema,
    operationId: OperationIdSchema,
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().max(4_096),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const InvocationFrameV1Schema = z.discriminatedUnion('type', [
  AcceptedFrameSchema,
  ProgressFrameSchema,
  ResultFrameSchema,
  ErrorFrameSchema,
]);
export type InvocationFrameV1 = z.infer<typeof InvocationFrameV1Schema>;

export interface ProgressReporter {
  report(event: Omit<ProgressEvent, 'operationId' | 'emittedAt'>): void;
  throwIfCancelled(): void;
}

export interface InvocationFrameSink {
  emit(frame: InvocationFrameV1, signal: { readonly aborted: boolean }): Promise<void>;
  close(reason: 'terminal' | 'disconnect' | 'deadline' | 'demotion'): Promise<void>;
}

const frameBytes = (frame: InvocationFrameV1): number => utf8Length(JSON.stringify(frame));
const terminal = (frame: InvocationFrameV1): boolean =>
  frame.type === 'result' || frame.type === 'error';

export class BoundedInvocationFrameSink {
  private tail = Promise.resolve();
  private terminalQueued = false;
  private rateWindowStartedAt = Number.NEGATIVE_INFINITY;
  private rateWindowFrames = 0;
  private bufferedFrameCount = 0;
  private bufferedByteCount = 0;
  private coalescedProgressCount = 0;

  constructor(
    private readonly write: (frame: InvocationFrameV1) => Promise<void>,
    private readonly options: { now?: () => number } = {},
  ) {}

  get bufferedFrames(): number {
    return this.bufferedFrameCount;
  }

  get bufferedBytes(): number {
    return this.bufferedByteCount;
  }

  get coalescedProgress(): number {
    return this.coalescedProgressCount;
  }

  emit(untrustedFrame: InvocationFrameV1): Promise<void> {
    const parsed = InvocationFrameV1Schema.safeParse(untrustedFrame);
    if (!parsed.success) {
      return Promise.reject(
        Object.assign(new Error('invocation progress frame is invalid'), {
          code: 'PROGRESS_INVALID',
          cause: parsed.error,
        }),
      );
    }
    const frame = parsed.data;
    if (this.terminalQueued) {
      if (frame.type === 'progress') this.coalescedProgressCount += 1;
      return Promise.resolve();
    }
    if (terminal(frame)) {
      this.terminalQueued = true;
      const write = this.tail.catch(() => undefined).then(() => this.write(frame));
      this.tail = write.catch(() => undefined);
      return write;
    }
    if (frame.type === 'progress' && this.rateLimited()) {
      this.coalescedProgressCount += 1;
      return Promise.resolve();
    }
    const bytes = frameBytes(frame);
    if (
      this.bufferedFrameCount >= PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames ||
      this.bufferedByteCount + bytes > PROGRESS_TRANSPORT_LIMITS.maxSubscriberBytes
    ) {
      if (frame.type === 'progress') {
        this.coalescedProgressCount += 1;
        return Promise.resolve();
      }
      const delayed = this.tail.catch(() => undefined).then(() => this.emit(frame));
      return delayed;
    }
    this.bufferedFrameCount += 1;
    this.bufferedByteCount += bytes;
    const write = this.tail
      .catch(() => undefined)
      .then(() => this.write(frame))
      .finally(() => {
        this.bufferedFrameCount -= 1;
        this.bufferedByteCount -= bytes;
      });
    this.tail = write.catch(() => undefined);
    return write;
  }

  async flush(): Promise<void> {
    await this.tail;
  }

  private rateLimited(): boolean {
    const now = this.options.now?.() ?? Date.now();
    if (now - this.rateWindowStartedAt >= 1_000) {
      this.rateWindowStartedAt = now;
      this.rateWindowFrames = 0;
    }
    if (this.rateWindowFrames >= PROGRESS_TRANSPORT_LIMITS.maxProgressFramesPerSecond) return true;
    this.rateWindowFrames += 1;
    return false;
  }
}

export class BoundedInvocationFrameChannel {
  private readonly queue: {
    frame: InvocationFrameV1;
    bytes: number;
    acknowledge(): void;
    reject(error: unknown): void;
  }[] = [];
  private terminalSlot: {
    frame: InvocationFrameV1;
    acknowledge(): void;
    reject(error: unknown): void;
  } | null = null;
  private waiter: (() => void) | null = null;
  private failure: unknown;
  private closed = false;
  private byteCount = 0;

  get bufferedFrames(): number {
    return this.queue.length;
  }

  get bufferedBytes(): number {
    return this.byteCount;
  }

  write(frame: InvocationFrameV1): Promise<void> {
    if (this.closed) return Promise.reject(this.failure);
    const parsed = InvocationFrameV1Schema.parse(frame);
    if (terminal(parsed)) {
      if (this.terminalSlot !== null) {
        return Promise.reject(
          Object.assign(new Error('terminal channel slot is occupied'), {
            code: 'TERMINAL_ALREADY_SETTLED',
          }),
        );
      }
      return new Promise<void>((resolve, reject) => {
        this.terminalSlot = { frame: parsed, acknowledge: resolve, reject };
        this.wake();
      });
    }
    const bytes = frameBytes(parsed);
    if (
      this.queue.length >= PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames ||
      this.byteCount + bytes > PROGRESS_TRANSPORT_LIMITS.maxSubscriberBytes
    ) {
      if (parsed.type === 'progress') return Promise.resolve();
      return Promise.reject(
        Object.assign(new Error('invocation channel is full'), { code: 'SERVER_BUSY' }),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ frame: parsed, bytes, acknowledge: resolve, reject });
      this.byteCount += bytes;
      this.wake();
    });
  }

  async next(): Promise<InvocationFrameV1> {
    /* eslint-disable no-await-in-loop -- one consumer waits for the next bounded channel item */
    for (;;) {
      const entry = this.queue.shift();
      if (entry !== undefined) {
        this.byteCount -= entry.bytes;
        entry.acknowledge();
        return entry.frame;
      }
      if (this.failure !== undefined) throw this.failure;
      if (this.terminalSlot !== null) {
        const terminalEntry = this.terminalSlot;
        this.terminalSlot = null;
        terminalEntry.acknowledge();
        return terminalEntry.frame;
      }
      await new Promise<void>(resolve => {
        this.waiter = resolve;
      });
    }
    /* eslint-enable no-await-in-loop */
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    for (const entry of this.queue.splice(0)) entry.reject(error);
    this.byteCount = 0;
    this.terminalSlot?.reject(error);
    this.terminalSlot = null;
    this.wake();
  }

  private wake(): void {
    this.waiter?.();
    this.waiter = null;
  }
}

export class OperationProgressBroadcaster {
  private readonly sinks = new Map<string, BoundedInvocationFrameSink>();
  private terminalSettled = false;
  private opened = false;
  private acceptedFrame: InvocationFrameV1 | null = null;
  private terminalFrame: InvocationFrameV1 | null = null;
  private readonly pendingBeforeAccepted: { frame: InvocationFrameV1; bytes: number }[] = [];
  private pendingBeforeAcceptedBytes = 0;
  readonly reporter: ProgressReporter;

  constructor(
    private readonly options: {
      requestId: `sfp_req1_${string}`;
      operationId: string;
      now?: () => number;
      signal?: { readonly aborted: boolean; throwIfAborted(): void };
    },
  ) {
    this.reporter = Object.freeze({
      report: (event: Parameters<ProgressReporter['report']>[0]) => {
        this.options.signal?.throwIfAborted();
        const progress = ProgressEventSchema.parse({
          ...event,
          operationId: this.options.operationId,
          emittedAt: this.options.now?.() ?? Date.now(),
        });
        const frame: InvocationFrameV1 = {
          version: 1,
          type: 'progress',
          requestId: this.options.requestId,
          operationId: this.options.operationId,
          progress,
        };
        if (!this.opened) {
          this.queueBeforeAccepted(frame);
        } else {
          for (const sink of this.sinks.values()) {
            void sink.emit(frame).catch(() => undefined);
          }
        }
      },
      throwIfCancelled: () => this.options.signal?.throwIfAborted(),
    });
  }

  subscribe(
    subscriberId: string,
    write: (frame: InvocationFrameV1) => Promise<void>,
    requestId: `sfp_req1_${string}` = this.options.requestId,
  ): Readonly<{ release(): void }> {
    if (this.sinks.size >= INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOperation) {
      throw Object.assign(new Error('operation subscriber capacity is full'), {
        code: 'SERVER_BUSY',
      });
    }
    if (this.sinks.has(subscriberId)) {
      throw Object.assign(new Error('progress subscriber already exists'), {
        code: 'PROGRESS_SUBSCRIBER_CONFLICT',
      });
    }
    const sink = new BoundedInvocationFrameSink(
      frame => write({ ...frame, requestId } as InvocationFrameV1),
      this.options.now === undefined ? {} : { now: this.options.now },
    );
    this.sinks.set(subscriberId, sink);
    if (this.acceptedFrame !== null) void sink.emit(this.acceptedFrame).catch(() => undefined);
    if (this.terminalFrame !== null) void sink.emit(this.terminalFrame).catch(() => undefined);
    return Object.freeze({ release: () => this.sinks.delete(subscriberId) });
  }

  get bufferedFrames(): number {
    return Math.max(
      this.pendingBeforeAccepted.length,
      0,
      ...[...this.sinks.values()].map(sink => sink.bufferedFrames),
    );
  }

  get preAcceptedBufferedBytes(): number {
    return this.pendingBeforeAcceptedBytes;
  }

  emit(frame: InvocationFrameV1): Promise<void> {
    if (frame.type === 'result' || frame.type === 'error') return this.terminal(frame);
    if (
      frame.requestId !== this.options.requestId ||
      frame.operationId !== this.options.operationId
    ) {
      return Promise.reject(
        Object.assign(new Error('progress frame belongs to another operation'), {
          code: 'PROGRESS_INVALID',
        }),
      );
    }
    if (frame.type === 'accepted' && !this.opened) {
      this.opened = true;
      this.acceptedFrame = frame;
      const delivery = this.broadcast(frame);
      this.flushBeforeAccepted();
      return delivery;
    }
    if (frame.type === 'accepted' && this.acceptedFrame !== null) return Promise.resolve();
    if (!this.opened && frame.type === 'progress') {
      this.queueBeforeAccepted(frame);
      return Promise.resolve();
    }
    return this.broadcast(frame);
  }

  terminal(frame: InvocationFrameV1): Promise<void> {
    if (frame.type !== 'result' && frame.type !== 'error') {
      return Promise.reject(
        Object.assign(new Error('terminal frame is required'), { code: 'PROGRESS_INVALID' }),
      );
    }
    if (this.terminalSettled) {
      return Promise.reject(
        Object.assign(new Error('operation terminal was already settled'), {
          code: 'TERMINAL_ALREADY_SETTLED',
        }),
      );
    }
    if (
      frame.requestId !== this.options.requestId ||
      frame.operationId !== this.options.operationId
    ) {
      return Promise.reject(
        Object.assign(new Error('terminal frame belongs to another operation'), {
          code: 'PROGRESS_INVALID',
        }),
      );
    }
    this.terminalSettled = true;
    this.terminalFrame = frame;
    this.opened = true;
    this.flushBeforeAccepted();
    return this.broadcast(frame);
  }

  forceClose(code = 'LEADER_GENERATION_CLOSED'): Promise<void> {
    if (this.terminalSettled) return this.flush();
    return this.terminal({
      version: 1,
      type: 'error',
      requestId: this.options.requestId,
      operationId: this.options.operationId,
      error: safeInvocationError(Object.assign(new Error('stream closed'), { code })),
    });
  }

  async flush(): Promise<void> {
    await Promise.all([...this.sinks.values()].map(sink => sink.flush()));
  }

  private async broadcast(frame: InvocationFrameV1): Promise<void> {
    await Promise.all([...this.sinks.values()].map(sink => sink.emit(frame)));
  }

  private queueBeforeAccepted(frame: InvocationFrameV1): void {
    const bytes = frameBytes(frame);
    if (
      this.pendingBeforeAccepted.length < PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames &&
      this.pendingBeforeAcceptedBytes + bytes <= PROGRESS_TRANSPORT_LIMITS.maxPreAcceptedBytes
    ) {
      this.pendingBeforeAccepted.push({ frame, bytes });
      this.pendingBeforeAcceptedBytes += bytes;
      return;
    }
    const last = this.pendingBeforeAccepted.at(-1);
    if (
      last?.frame.type === 'progress' &&
      frame.type === 'progress' &&
      last.frame.progress.phase === frame.progress.phase &&
      this.pendingBeforeAcceptedBytes - last.bytes + bytes <=
        PROGRESS_TRANSPORT_LIMITS.maxPreAcceptedBytes
    ) {
      this.pendingBeforeAccepted[this.pendingBeforeAccepted.length - 1] = { frame, bytes };
      this.pendingBeforeAcceptedBytes += bytes - last.bytes;
    }
  }

  private flushBeforeAccepted(): void {
    const pending = this.pendingBeforeAccepted.splice(0);
    this.pendingBeforeAcceptedBytes = 0;
    for (const entry of pending) {
      for (const sink of this.sinks.values()) void sink.emit(entry.frame).catch(() => undefined);
    }
  }
}

export class OperationProgressRegistry {
  private readonly operations = new Map<
    string,
    {
      ownerId: string;
      broadcaster: OperationProgressBroadcaster;
      subscriberReferences: number;
      producerActive: boolean;
      terminalActive: boolean;
    }
  >();
  private readonly ownerReferences = new Map<string, number>();
  private readonly ownerOperations = new Map<string, number>();

  get size(): number {
    return this.operations.size;
  }

  acquire(input: {
    ownerId: string;
    requestId: `sfp_req1_${string}`;
    operationId: string;
  }): Readonly<{
    broadcaster: OperationProgressBroadcaster;
    isProducer: boolean;
    release(): void;
    producerSettled(): void;
    terminalSettled(): void;
  }> {
    const key = `${input.ownerId}\0${input.operationId}`;
    const ownerReferences = this.ownerReferences.get(input.ownerId) ?? 0;
    if (ownerReferences >= INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOwner) {
      throw Object.assign(new Error('owner progress subscriber capacity is full'), {
        code: 'SERVER_BUSY',
      });
    }
    let state = this.operations.get(key);
    const isProducer = state === undefined;
    if (
      state !== undefined &&
      state.subscriberReferences >= INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOperation
    ) {
      throw Object.assign(new Error('operation progress subscriber capacity is full'), {
        code: 'SERVER_BUSY',
      });
    }
    if (state === undefined) {
      const ownerOperations = this.ownerOperations.get(input.ownerId) ?? 0;
      if (ownerOperations >= INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner) {
        throw Object.assign(new Error('owner progress operation capacity is full'), {
          code: 'SERVER_BUSY',
        });
      }
      state = {
        ownerId: input.ownerId,
        broadcaster: new OperationProgressBroadcaster({
          requestId: input.requestId,
          operationId: input.operationId,
        }),
        subscriberReferences: 0,
        producerActive: true,
        terminalActive: true,
      };
      this.operations.set(key, state);
      this.ownerOperations.set(input.ownerId, ownerOperations + 1);
    }
    state.subscriberReferences += 1;
    this.ownerReferences.set(input.ownerId, ownerReferences + 1);
    let released = false;
    return Object.freeze({
      broadcaster: state.broadcaster,
      isProducer,
      release: () => {
        if (released) return;
        released = true;
        state!.subscriberReferences -= 1;
        const ownerRemaining = (this.ownerReferences.get(input.ownerId) ?? 1) - 1;
        if (ownerRemaining === 0) this.ownerReferences.delete(input.ownerId);
        else this.ownerReferences.set(input.ownerId, ownerRemaining);
        this.removeIfUnowned(key, state!);
      },
      producerSettled: () => {
        if (!isProducer || !state!.producerActive) return;
        state!.producerActive = false;
        this.removeIfUnowned(key, state!);
      },
      terminalSettled: () => {
        if (!isProducer || !state!.terminalActive) return;
        state!.terminalActive = false;
        this.removeIfUnowned(key, state!);
      },
    });
  }

  private removeIfUnowned(
    key: string,
    state: {
      ownerId: string;
      subscriberReferences: number;
      producerActive: boolean;
      terminalActive: boolean;
    },
  ): void {
    if (
      state.subscriberReferences !== 0 ||
      state.producerActive ||
      state.terminalActive ||
      this.operations.get(key) !== state
    ) {
      return;
    }
    this.operations.delete(key);
    const remaining = (this.ownerOperations.get(state.ownerId) ?? 1) - 1;
    if (remaining === 0) this.ownerOperations.delete(state.ownerId);
    else this.ownerOperations.set(state.ownerId, remaining);
  }
}
