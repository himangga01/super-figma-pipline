import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  JOURNAL_LIMITS,
  parseOperationRecord,
  parseOperationTombstone,
  type OperationRecord,
  type OperationResolutionRecord,
  type OperationStatus,
  type OperationTombstone,
  type PrefixedSha256,
} from '@sfp/shared';

import { readFileWithinLimit } from '../fs/atomic-file.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';

export type NewOperationRecord = Omit<
  OperationRecord,
  'sequence' | 'previousStatus' | 'status' | 'createdAt' | 'settledAt' | 'errorCode'
>;

export interface LeaderDemotionCapability {
  readonly __leaderDemotionCapability: unique symbol;
}

export interface OperationJournalOptions {
  stateRoot: string;
  actorId: OperationRecord['actorId'];
  now?: () => number;
  capacity?: { maxRows: number; maxBytes: number; compactAtRows: number; compactAtBytes: number };
  tombstoneCapacity?: { maxRows: number; maxBytes: number };
  afterQueuedFsync?: () => Promise<void>;
  afterTombstoneFsync?: () => Promise<void>;
  afterResolutionTombstoneFsync?: () => Promise<void>;
  syncDirectory?: (path: string) => Promise<void>;
}

export interface ResolutionIntentMergePort {
  get(operationId: string): OperationResolutionRecord | undefined;
  releaseMerged(operationId: string, operationFingerprintHash: PrefixedSha256): Promise<void>;
}

interface DurableOperationRowV1<TRecord = OperationRecord> {
  schemaVersion: 1;
  record: TRecord;
  previousRecordHash: PrefixedSha256 | null;
  recordHash: PrefixedSha256;
}

interface DurableCompactedBaseRowV1 extends DurableOperationRowV1 {
  rowType: 'compacted-base';
  baseFingerprintHash: PrefixedSha256;
  baseStatus: OperationStatus;
  baseSequence: number;
}

type ParsedActiveRow =
  | (DurableOperationRowV1 & { rowType: 'transition' })
  | DurableCompactedBaseRowV1;

interface OperationOrderEntry {
  operationId: string;
  sequence: number;
}

const zero = Buffer.from([0]);
const TERMINAL_RESERVATION_BYTES = 32_768;
const terminalStatuses = new Set<OperationStatus>([
  'succeeded',
  'failed',
  'pre-egress-rejected',
  'rejected',
  'outcome-unknown',
  'resolved-applied',
  'resolved-not-applied',
  'abandoned',
]);
const compactedTerminalStatuses = new Set<OperationStatus>([
  'succeeded',
  'failed',
  'pre-egress-rejected',
  'rejected',
  'resolved-applied',
  'resolved-not-applied',
  'abandoned',
]);
const transitionRowKeys = new Set(['schemaVersion', 'record', 'previousRecordHash', 'recordHash']);
const compactedBaseRowKeys = new Set([
  ...transitionRowKeys,
  'rowType',
  'baseFingerprintHash',
  'baseStatus',
  'baseSequence',
]);

const hasExactKeys = (value: object, expected: ReadonlySet<string>): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every(key => expected.has(key));
};

const decodeCanonicalBase64Url = (value: string, expectedBytes: number): Buffer | null => {
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === expectedBytes && decoded.toString('base64url') === value
      ? decoded
      : null;
  } catch {
    return null;
  }
};

const allowedTransitions: Readonly<Record<OperationStatus, ReadonlySet<OperationStatus>>> =
  Object.freeze({
    'pending-approval': new Set<OperationStatus>(['queued', 'pre-egress-rejected', 'rejected']),
    queued: new Set<OperationStatus>(['dispatched', 'failed', 'rejected', 'outcome-unknown']),
    dispatched: new Set<OperationStatus>(['succeeded', 'failed', 'outcome-unknown']),
    succeeded: new Set<OperationStatus>(),
    failed: new Set<OperationStatus>(),
    'pre-egress-rejected': new Set<OperationStatus>(),
    rejected: new Set<OperationStatus>(),
    'outcome-unknown': new Set<OperationStatus>([
      'resolved-applied',
      'resolved-not-applied',
      'abandoned',
    ]),
    'resolved-applied': new Set<OperationStatus>(),
    'resolved-not-applied': new Set<OperationStatus>(),
    abandoned: new Set<OperationStatus>(),
  });

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('journal value is not JSON serializable');
  return encoded;
};

const prefixedHash = (...parts: readonly (string | Uint8Array)[]): PrefixedSha256 => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest('hex')}`;
};

const actorFilenameHash = (actorId: string): string =>
  prefixedHash('sfp-journal-actor-filename-v1', zero, actorId).slice('sha256:'.length);

const immutableRecord = (record: OperationRecord): OperationRecord =>
  Object.freeze({ ...record, effectSummary: Object.freeze([...record.effectSummary]) });

const knownToolNames = new Set(ALL_TOOL_SPECS.map(spec => spec.name));

export const hashOperationFingerprint = (record: {
  actorId: OperationRecord['actorId'];
  operationId: string;
  operationKind: OperationRecord['operationKind'];
  operationName: OperationRecord['operationName'];
  argsHash: PrefixedSha256;
  workspaceId: string | null;
  fileExecutionKeyHash: PrefixedSha256 | null;
  targetBindingHash: PrefixedSha256 | null;
  captureIntentHash: PrefixedSha256;
}): PrefixedSha256 => {
  const projection = {
    actorId: record.actorId,
    operationId: record.operationId,
    operationKind: record.operationKind,
    operationName: record.operationName,
    argsHash: record.argsHash,
    workspaceId: record.workspaceId,
    fileExecutionKeyHash: record.fileExecutionKeyHash,
    targetBindingHash: record.targetBindingHash,
    captureIntentHash: record.captureIntentHash,
  };
  return prefixedHash('sfp-operation-fingerprint-v1', zero, JSON.stringify(projection));
};

export class OperationJournalError extends Error {
  constructor(
    readonly code:
      | 'JOURNAL_CAPACITY_EXCEEDED'
      | 'JOURNAL_CORRUPT'
      | 'JOURNAL_TRANSITION_INVALID'
      | 'OPERATION_NOT_FOUND'
      | 'OPERATION_ID_CONFLICT'
      | 'LEADER_GENERATION_FENCED'
      | 'LEADER_GENERATION_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'OperationJournalError';
  }
}

export class OperationJournal {
  private readonly records = new Map<string, OperationRecord>();
  private readonly tombstones = new Map<string, OperationTombstone>();
  private readonly now: () => number;
  private readonly capacity: {
    maxRows: number;
    maxBytes: number;
    compactAtRows: number;
    compactAtBytes: number;
  };
  private readonly path: string;
  private readonly tombstonePath: string;
  private readonly generationFencePath: string;
  private readonly tombstoneCapacity: { maxRows: number; maxBytes: number };
  private rows = 0;
  private bytes = 0;
  private previousRecordHash: PrefixedSha256 | null = null;
  private tombstoneRows = 0;
  private tombstoneBytes = 0;
  private previousTombstoneHash: PrefixedSha256 | null = null;
  private readonly activeReservations = new Set<string>();
  private readonly tombstoneReservations = new Set<string>();
  private operationOrder: OperationOrderEntry[] = [];
  private nextOperationOrderSequence = 0;
  private readonly indexedOperationIds = new Set<string>();
  private cursorGeneration = randomBytes(16).toString('base64url');
  private cursorKey = randomBytes(32);
  private journalDirectoryInitialized = false;
  private mutation: Promise<void> = Promise.resolve();
  private readonly fencedLeaderGenerations = new Set<string>();
  private readonly demotionCapabilities = new WeakMap<object, string>();

  constructor(private readonly options: OperationJournalOptions) {
    this.now = options.now ?? Date.now;
    this.capacity = options.capacity ?? {
      maxRows: JOURNAL_LIMITS.maxRowsPerActor,
      maxBytes: JOURNAL_LIMITS.normalOperationBytesPerActor,
      compactAtRows: JOURNAL_LIMITS.compactAtRows,
      compactAtBytes: JOURNAL_LIMITS.compactAtBytes,
    };
    this.tombstoneCapacity = options.tombstoneCapacity ?? {
      maxRows: JOURNAL_LIMITS.maxTombstonesPerActor,
      maxBytes: JOURNAL_LIMITS.maxTombstoneBytesPerActor,
    };
    const actorHash = actorFilenameHash(options.actorId);
    this.path = join(options.stateRoot, 'journal', `${actorHash}.operations.v1.jsonl`);
    this.tombstonePath = join(
      options.stateRoot,
      'journal',
      `${actorHash}.operation-tombstones.v1.jsonl`,
    );
    this.generationFencePath = join(
      options.stateRoot,
      'journal',
      `${actorHash}.leader-generation-fences.v1.jsonl`,
    );
  }

  get logPath(): string {
    return this.path;
  }

  get tombstoneLogPath(): string {
    return this.tombstonePath;
  }

  async recover(
    options: {
      deferDispatched?: boolean;
      deferTombstonePurge?: boolean;
      preserveQueuedOperationIds?: ReadonlySet<string>;
    } = {},
  ): Promise<void> {
    await this.exclusive(async () => {
      await this.ensureJournalDirectoryUnlocked();
      await this.refreshGenerationFencesUnlocked();
      this.operationOrder = [];
      this.nextOperationOrderSequence = 0;
      this.indexedOperationIds.clear();
      this.rotateCursorGeneration();
      await this.recoverTombstonesUnlocked(options.deferTombstonePurge === true);
      const bytes = await readFile(this.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return Buffer.alloc(0);
        throw error;
      });
      this.records.clear();
      this.rows = 0;
      this.bytes = 0;
      this.previousRecordHash = null;
      let validBytes = 0;
      const completeLength = bytes.lastIndexOf(0x0a) + 1;
      const complete = bytes.subarray(0, completeLength).toString('utf8');
      const lines = complete.split('\n').filter(Boolean);
      for (const line of lines) {
        const rowBytes = Buffer.byteLength(line, 'utf8') + 1;
        const row = this.parseAndVerifyRow(line, this.previousRecordHash);
        const previousOperation = this.records.get(row.record.operationId);
        if (
          (row.rowType === 'compacted-base' && previousOperation !== undefined) ||
          (row.rowType === 'transition' &&
            ((previousOperation === undefined &&
              (row.record.sequence !== 1 || row.record.previousStatus !== null)) ||
              (previousOperation !== undefined &&
                (row.record.sequence !== previousOperation.sequence + 1 ||
                  row.record.previousStatus !== previousOperation.status ||
                  !allowedTransitions[previousOperation.status].has(row.record.status)))))
        ) {
          throw new OperationJournalError(
            'JOURNAL_CORRUPT',
            'operation row sequence or status progression is invalid',
          );
        }
        const tombstone = this.tombstones.get(row.record.operationId);
        if (
          tombstone !== undefined &&
          terminalStatuses.has(row.record.status) &&
          (tombstone.operationFingerprintHash !== row.record.operationFingerprintHash ||
            tombstone.status !== row.record.status ||
            tombstone.resultHash !== row.record.resultHash)
        ) {
          throw new OperationJournalError(
            'JOURNAL_CORRUPT',
            'active operation conflicts with its durable tombstone',
          );
        }
        this.records.set(row.record.operationId, immutableRecord(row.record));
        this.registerOperationId(row.record.operationId);
        this.previousRecordHash = row.recordHash;
        this.rows += 1;
        this.bytes += rowBytes;
        validBytes += rowBytes;
      }
      if (completeLength !== bytes.byteLength) {
        const tail = bytes.subarray(completeLength);
        try {
          JSON.parse(tail.toString('utf8'));
          throw new OperationJournalError(
            'JOURNAL_CORRUPT',
            'operation journal has a complete row without an LF terminator',
          );
        } catch (error) {
          if (error instanceof OperationJournalError) throw error;
          await this.rewriteBytes(bytes.subarray(0, validBytes));
        }
      } else if (bytes.byteLength === 0) {
        const handle = await open(this.path, 'a');
        await handle.sync();
        await handle.close();
      }

      for (const [operationId, tombstone] of this.tombstones) {
        const active = this.records.get(operationId);
        if (
          active !== undefined &&
          (!terminalStatuses.has(active.status) ||
            active.operationFingerprintHash !== tombstone.operationFingerprintHash ||
            active.status !== tombstone.status ||
            active.resultHash !== tombstone.resultHash)
        ) {
          throw new OperationJournalError(
            'JOURNAL_CORRUPT',
            'active operation does not match its durable tombstone overlap',
          );
        }
      }

      this.activeReservations.clear();
      this.tombstoneReservations.clear();
      for (const record of this.records.values()) {
        if (terminalStatuses.has(record.status)) continue;
        this.activeReservations.add(record.operationId);
        this.tombstoneReservations.add(record.operationId);
      }
      this.assertReservationCapacity(true);

      const generationBound = [...this.records.values()]
        .filter(record => ['pending-approval', 'queued', 'dispatched'].includes(record.status))
        .toSorted((left, right) =>
          left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
        );
      /* eslint-disable no-await-in-loop -- recovery rows extend one ordered durable hash chain */
      for (const record of generationBound) {
        if (record.status === 'dispatched' && options.deferDispatched === true) continue;
        if (
          record.status === 'queued' &&
          options.preserveQueuedOperationIds?.has(record.operationId) === true
        ) {
          continue;
        }
        const recovery =
          record.status === 'pending-approval'
            ? {
                status: 'rejected' as const,
                errorCode: 'PROCESS_RESTARTED_PENDING_APPROVAL',
              }
            : record.status === 'queued'
              ? {
                  status: 'failed' as const,
                  errorCode: 'PROCESS_RESTARTED_BEFORE_DISPATCH',
                }
              : {
                  status: 'outcome-unknown' as const,
                  errorCode: 'PROCESS_RESTARTED_AFTER_DISPATCH',
                };
        await this.appendRecordUnlocked(
          this.nextRecord(record, recovery.status, { errorCode: recovery.errorCode }),
        );
      }
      /* eslint-enable no-await-in-loop */
      await this.compactKnownTerminalsUnlocked();
      this.activeReservations.clear();
      this.tombstoneReservations.clear();
      for (const record of this.records.values()) {
        if (terminalStatuses.has(record.status)) continue;
        this.activeReservations.add(record.operationId);
        this.tombstoneReservations.add(record.operationId);
      }
      this.assertReservationCapacity(true);
    });
  }

  async recoverPreservedQueued(operationIds: ReadonlySet<string>): Promise<void> {
    await this.exclusive(async () => {
      const preserved = [...this.records.values()]
        .filter(record => record.status === 'queued' && operationIds.has(record.operationId))
        .toSorted((left, right) => left.operationId.localeCompare(right.operationId));
      /* eslint-disable no-await-in-loop -- recovery rows extend one ordered durable hash chain */
      for (const record of preserved) {
        await this.appendRecordUnlocked(
          this.nextRecord(record, 'failed', {
            errorCode: 'PROCESS_RESTARTED_BEFORE_DISPATCH',
          }),
        );
      }
      /* eslint-enable no-await-in-loop */
      await this.compactKnownTerminalsUnlocked();
      this.activeReservations.clear();
      this.tombstoneReservations.clear();
      for (const record of this.records.values()) {
        if (terminalStatuses.has(record.status)) continue;
        this.activeReservations.add(record.operationId);
        this.tombstoneReservations.add(record.operationId);
      }
      this.assertReservationCapacity(true);
    });
  }

  async appendInitial(
    record: NewOperationRecord,
    status: OperationStatus,
    options: { leaderGeneration?: string; errorCode?: string } = {},
  ): Promise<OperationRecord> {
    return this.exclusive(async () => {
      await this.purgeExpiredTombstonesUnlocked();
      if (
        status !== 'pending-approval' &&
        status !== 'queued' &&
        status !== 'pre-egress-rejected'
      ) {
        throw new OperationJournalError(
          'JOURNAL_TRANSITION_INVALID',
          'initial operation status is invalid',
        );
      }
      if (this.records.has(record.operationId) || this.tombstones.has(record.operationId)) {
        throw new OperationJournalError('OPERATION_ID_CONFLICT', 'operation ID already exists');
      }
      if (this.tombstones.size + this.records.size >= this.tombstoneCapacity.maxRows) {
        throw new OperationJournalError(
          'JOURNAL_CAPACITY_EXCEEDED',
          'operation tombstone capacity is exhausted',
        );
      }
      if (record.actorId !== this.options.actorId) {
        throw new OperationJournalError('OPERATION_ID_CONFLICT', 'journal actor does not match');
      }
      if (hashOperationFingerprint(record) !== record.operationFingerprintHash) {
        throw new OperationJournalError(
          'OPERATION_ID_CONFLICT',
          'operation fingerprint does not match its components',
        );
      }
      const leaderGeneration = options.leaderGeneration ?? record.leaderGeneration ?? null;
      if (leaderGeneration !== null) {
        await this.refreshGenerationFencesUnlocked();
        if (this.fencedLeaderGenerations.has(leaderGeneration)) {
          throw new OperationJournalError(
            'LEADER_GENERATION_FENCED',
            'leader generation can no longer admit operation state',
          );
        }
      }
      const createdAt = new Date(this.now()).toISOString();
      const next: OperationRecord = immutableRecord({
        ...record,
        leaderGeneration,
        sequence: 1,
        previousStatus: null,
        status,
        createdAt,
        settledAt: terminalStatuses.has(status) ? createdAt : null,
        errorCode: options.errorCode ?? null,
      });
      const validated = this.validateRecord(next);
      this.activeReservations.add(record.operationId);
      this.tombstoneReservations.add(record.operationId);
      try {
        this.assertReservationCapacity(false);
      } catch (error) {
        this.activeReservations.delete(record.operationId);
        this.tombstoneReservations.delete(record.operationId);
        throw error;
      }
      try {
        await this.appendRecordUnlocked(validated);
        if (validated.status === 'queued') await this.options.afterQueuedFsync?.();
        if (validated.status === 'pre-egress-rejected') {
          await this.publishTombstoneUnlocked(validated);
          this.activeReservations.delete(record.operationId);
          this.tombstoneReservations.delete(record.operationId);
        }
      } catch (error) {
        this.activeReservations.delete(record.operationId);
        this.tombstoneReservations.delete(record.operationId);
        throw error;
      }
      return validated;
    });
  }

  async transition(
    operationId: string,
    status: OperationStatus,
    patch: Partial<
      Pick<
        OperationRecord,
        | 'resultHash'
        | 'resultBytes'
        | 'errorCode'
        | 'preExecutionConsentManifestHash'
        | 'finalEgressManifestHash'
        | 'operationEvidenceReceiptHash'
      >
    > = {},
    options: { expectedLeaderGeneration?: string; allowFenced?: boolean } = {},
  ): Promise<OperationRecord> {
    return this.exclusive(async () => {
      const current = this.records.get(operationId);
      if (current === undefined) {
        throw new OperationJournalError('OPERATION_NOT_FOUND', 'operation was not found');
      }
      if (!allowedTransitions[current.status].has(status)) {
        throw new OperationJournalError(
          'JOURNAL_TRANSITION_INVALID',
          `operation cannot transition from ${current.status} to ${status}`,
        );
      }
      if (current.leaderGeneration !== null && current.leaderGeneration !== undefined) {
        await this.refreshGenerationFencesUnlocked();
        if (
          options.expectedLeaderGeneration !== undefined &&
          options.expectedLeaderGeneration !== current.leaderGeneration
        ) {
          throw new OperationJournalError(
            'LEADER_GENERATION_MISMATCH',
            'operation transition does not match its leader generation',
          );
        }
        if (
          options.allowFenced !== true &&
          this.fencedLeaderGenerations.has(current.leaderGeneration)
        ) {
          throw new OperationJournalError(
            'LEADER_GENERATION_FENCED',
            'leader generation can no longer publish operation state',
          );
        }
      }
      const next = this.nextRecord(current, status, patch);
      const validated = this.validateRecord(next);
      await this.appendRecordUnlocked(validated);
      if (compactedTerminalStatuses.has(validated.status)) {
        await this.publishTombstoneUnlocked(validated);
        this.activeReservations.delete(operationId);
        this.tombstoneReservations.delete(operationId);
      }
      return validated;
    });
  }

  async fenceLeaderGeneration(leaderGeneration: string): Promise<LeaderDemotionCapability> {
    if (leaderGeneration.length < 1 || leaderGeneration.length > 256) {
      throw new OperationJournalError('LEADER_GENERATION_MISMATCH', 'leader generation is invalid');
    }
    return this.exclusive(async () => {
      await this.ensureJournalDirectoryUnlocked();
      await this.refreshGenerationFencesUnlocked();
      if (!this.fencedLeaderGenerations.has(leaderGeneration)) {
        const serialized = `${canonicalJson({
          schemaVersion: 1,
          leaderGeneration,
          fencedAt: new Date(this.now()).toISOString(),
        })}\n`;
        const handle = await open(this.generationFencePath, 'a', 0o600);
        try {
          await handle.writeFile(serialized, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.syncDirectory(dirname(this.generationFencePath));
        this.fencedLeaderGenerations.add(leaderGeneration);
      }
      const capability = Object.freeze({}) as LeaderDemotionCapability;
      this.demotionCapabilities.set(capability, leaderGeneration);
      return capability;
    });
  }

  async transitionDemotion(
    capability: LeaderDemotionCapability,
    operationId: string,
    status: 'pre-egress-rejected' | 'succeeded' | 'failed' | 'outcome-unknown',
    patch: Partial<
      Pick<
        OperationRecord,
        | 'resultHash'
        | 'resultBytes'
        | 'errorCode'
        | 'preExecutionConsentManifestHash'
        | 'finalEgressManifestHash'
        | 'operationEvidenceReceiptHash'
      >
    > = {},
  ): Promise<OperationRecord> {
    return this.exclusive(async () => {
      const generation = this.demotionCapabilities.get(capability as object);
      const current = this.records.get(operationId);
      const allowed =
        current?.status === 'pending-approval'
          ? status === 'pre-egress-rejected'
          : current?.status === 'queued'
            ? status === 'failed'
            : current?.status === 'dispatched'
              ? status === 'succeeded' || status === 'failed' || status === 'outcome-unknown'
              : false;
      if (
        generation === undefined ||
        !this.fencedLeaderGenerations.has(generation) ||
        current?.leaderGeneration !== generation ||
        !allowed
      ) {
        throw new OperationJournalError(
          'LEADER_GENERATION_MISMATCH',
          'demotion capability cannot authorize this transition',
        );
      }
      const next = this.validateRecord(this.nextRecord(current, status, patch));
      await this.appendRecordUnlocked(next);
      if (compactedTerminalStatuses.has(next.status)) {
        await this.publishTombstoneUnlocked(next);
        this.activeReservations.delete(operationId);
        this.tombstoneReservations.delete(operationId);
      }
      return next;
    });
  }

  async recoverLeaderDemotionCapability(
    leaderGeneration: string,
  ): Promise<LeaderDemotionCapability | null> {
    return this.exclusive(async () => {
      await this.refreshGenerationFencesUnlocked();
      if (!this.fencedLeaderGenerations.has(leaderGeneration)) return null;
      const hasRecoverableRow = [...this.records.values()].some(
        record =>
          record.leaderGeneration === leaderGeneration &&
          ['pending-approval', 'queued', 'dispatched'].includes(record.status),
      );
      if (!hasRecoverableRow) return null;
      const capability = Object.freeze({}) as LeaderDemotionCapability;
      this.demotionCapabilities.set(capability, leaderGeneration);
      return capability;
    });
  }

  async settleLeaderGeneration(
    capability: LeaderDemotionCapability,
    leaderGeneration: string,
    fromStatus: 'pending-approval' | 'queued' | 'dispatched',
    status: 'pre-egress-rejected' | 'failed' | 'outcome-unknown',
    errorCode = 'LEADER_GENERATION_CLOSED',
  ): Promise<void> {
    return this.exclusive(async () => {
      if (this.demotionCapabilities.get(capability as object) !== leaderGeneration) {
        throw new OperationJournalError(
          'LEADER_GENERATION_MISMATCH',
          'demotion settlement capability is invalid',
        );
      }
      const matching = [...this.records.values()]
        .filter(
          record => record.leaderGeneration === leaderGeneration && record.status === fromStatus,
        )
        .toSorted((left, right) => left.operationId.localeCompare(right.operationId));
      /* eslint-disable no-await-in-loop -- generation settlement extends one durable hash chain */
      for (const current of matching) {
        const next = this.validateRecord(
          this.nextRecord(current, status, {
            errorCode,
            resultHash: null,
            resultBytes: status === 'outcome-unknown' ? null : current.resultBytes,
            operationEvidenceReceiptHash: null,
          }),
        );
        await this.appendRecordUnlocked(next);
        if (compactedTerminalStatuses.has(next.status)) {
          await this.publishTombstoneUnlocked(next);
          this.activeReservations.delete(next.operationId);
          this.tombstoneReservations.delete(next.operationId);
        }
      }
      /* eslint-enable no-await-in-loop */
    });
  }

  async flush(): Promise<void> {
    return this.exclusive(async () => {
      await this.ensureJournalDirectoryUnlocked();
      const handle = await open(this.path, 'a', 0o600);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  async applyResolution(
    resolution: OperationResolutionRecord,
  ): Promise<OperationRecord | OperationTombstone> {
    return this.exclusive(async () => {
      const existingTombstone = this.tombstones.get(resolution.operationId);
      if (existingTombstone !== undefined) {
        if (!this.resolutionMatchesTombstone(resolution, existingTombstone)) {
          throw new OperationJournalError(
            'OPERATION_ID_CONFLICT',
            'resolution conflicts with the existing tombstone',
          );
        }
        return existingTombstone;
      }
      const current = this.records.get(resolution.operationId);
      if (
        current === undefined ||
        current.status !== 'outcome-unknown' ||
        current.actorId !== resolution.actorId ||
        current.originAuthSessionId !== resolution.originAuthSessionId ||
        canonicalJson(current.origin) !== canonicalJson(resolution.origin) ||
        current.issuedAt !== resolution.issuedAt ||
        current.operationKind !== resolution.operationKind ||
        current.operationName !== resolution.operationName ||
        current.argsHash !== resolution.argsHash ||
        current.captureIntentHash !== resolution.captureIntentHash ||
        current.operationFingerprintHash !== resolution.operationFingerprintHash ||
        current.workspaceId !== resolution.workspaceId ||
        current.fileExecutionKey !== resolution.fileExecutionKey ||
        current.fileExecutionKeyHash !== resolution.fileExecutionKeyHash ||
        current.targetBindingHash !== resolution.targetBindingHash ||
        current.operationEvidenceReceiptHash !== resolution.operationEvidenceReceiptHash ||
        current.finalEgressManifestHash !== resolution.finalEgressManifestHash
      ) {
        throw new OperationJournalError(
          'OPERATION_ID_CONFLICT',
          'resolution does not match the unknown operation',
        );
      }
      const next = this.validateRecord({
        ...this.nextRecord(current, resolution.decision, {
          resultHash: resolution.resultHash,
          errorCode: null,
        }),
        operationEvidenceReceiptHash: resolution.operationEvidenceReceiptHash,
        finalEgressManifestHash: resolution.finalEgressManifestHash,
      });
      await this.appendRecordUnlocked(next);
      await this.publishTombstoneUnlocked(next);
      this.activeReservations.delete(resolution.operationId);
      this.tombstoneReservations.delete(resolution.operationId);
      return next;
    });
  }

  async mergeResolutionIntent(
    store: ResolutionIntentMergePort,
    operationId: string,
  ): Promise<OperationRecord | OperationTombstone> {
    const resolution = store.get(operationId);
    if (resolution === undefined) {
      const existing = this.tombstones.get(operationId);
      if (
        existing !== undefined &&
        ['resolved-applied', 'resolved-not-applied', 'abandoned'].includes(existing.status)
      ) {
        return existing;
      }
      throw new OperationJournalError('OPERATION_NOT_FOUND', 'resolution intent was not found');
    }
    await this.applyResolution(resolution);
    await this.options.afterResolutionTombstoneFsync?.();
    try {
      await store.releaseMerged(operationId, resolution.operationFingerprintHash);
    } catch (error) {
      if (store.get(operationId) !== undefined) throw error;
    }
    return this.get(operationId)!;
  }

  get(operationId: string): OperationRecord | OperationTombstone | undefined {
    return this.records.get(operationId) ?? this.tombstones.get(operationId);
  }

  settledAt(operationId: string): number | null {
    const row = this.records.get(operationId) ?? this.tombstones.get(operationId);
    if (row === undefined || !terminalStatuses.has(row.status)) return null;
    const settledAt = 'settledAt' in row ? row.settledAt : undefined;
    if (typeof settledAt === 'string') {
      const parsed = Date.parse(settledAt);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  listDispatched(): readonly OperationRecord[] {
    return [...this.records.values()]
      .filter(record => record.status === 'dispatched')
      .toSorted((left, right) =>
        left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
      );
  }

  list(options: { cursor?: string; limit?: number; status?: OperationStatus } = {}): {
    rows: readonly (OperationRecord | OperationTombstone)[];
    nextCursor: string | null;
  } {
    const limit = options.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new OperationJournalError(
        'JOURNAL_TRANSITION_INVALID',
        'operation list limit is invalid',
      );
    }
    let afterSequence = 0;
    if (options.cursor !== undefined) {
      afterSequence = this.parseOperationCursor(options.cursor);
    }
    let offset = this.firstOperationAfter(afterSequence);
    const rows: (OperationRecord | OperationTombstone)[] = [];
    const scanEnd = Math.min(this.operationOrder.length, offset + limit * 4);
    let lastScannedSequence = afterSequence;
    while (offset < scanEnd && rows.length < limit) {
      const entry = this.operationOrder[offset++]!;
      lastScannedSequence = entry.sequence;
      const operationId = entry.operationId;
      const record = this.records.get(operationId) ?? this.tombstones.get(operationId);
      if (
        record === undefined ||
        (options.status !== undefined && record.status !== options.status)
      ) {
        continue;
      }
      rows.push(record);
    }
    return {
      rows: Object.freeze(rows),
      nextCursor:
        offset < this.operationOrder.length
          ? this.createOperationCursor(lastScannedSequence)
          : null,
    };
  }

  async purgeExpiredTombstones(now = this.now()): Promise<number> {
    return this.exclusive(async () => this.purgeExpiredTombstonesUnlocked(now));
  }

  async hasUnsettled(workspaceId: string): Promise<boolean> {
    return [...this.records.values()].some(
      record =>
        record.workspaceId === workspaceId &&
        (!terminalStatuses.has(record.status) || record.status === 'outcome-unknown'),
    );
  }

  private assertReservationCapacity(loading: boolean): void {
    const activeReservedBytes = this.activeReservations.size * TERMINAL_RESERVATION_BYTES;
    const tombstoneReservedBytes = this.tombstoneReservations.size * TERMINAL_RESERVATION_BYTES;
    const over =
      this.bytes + activeReservedBytes > this.capacity.maxBytes ||
      this.tombstoneRows + this.tombstoneReservations.size > this.tombstoneCapacity.maxRows ||
      this.tombstoneBytes + tombstoneReservedBytes > this.tombstoneCapacity.maxBytes;
    if (over) {
      throw new OperationJournalError(
        loading ? 'JOURNAL_CORRUPT' : 'JOURNAL_CAPACITY_EXCEEDED',
        'operation settlement reservation capacity is exhausted',
      );
    }
  }

  private registerOperationId(operationId: string): void {
    if (this.indexedOperationIds.has(operationId)) return;
    this.indexedOperationIds.add(operationId);
    this.nextOperationOrderSequence += 1;
    this.operationOrder.push({ operationId, sequence: this.nextOperationOrderSequence });
  }

  private rotateCursorGeneration(): void {
    this.cursorGeneration = randomBytes(16).toString('base64url');
    this.cursorKey = randomBytes(32);
  }

  private operationCursorMac(generation: string, sequence: string): Buffer {
    return createHmac('sha256', this.cursorKey)
      .update('sfp-operation-list-cursor-v1')
      .update(zero)
      .update(this.options.actorId)
      .update(zero)
      .update(generation)
      .update(zero)
      .update(sequence)
      .digest();
  }

  private createOperationCursor(sequence: number): string {
    const encodedSequence = sequence.toString(36);
    const mac = this.operationCursorMac(this.cursorGeneration, encodedSequence).toString(
      'base64url',
    );
    return `sfp_oc1_${this.cursorGeneration}.${encodedSequence}.${mac}`;
  }

  private parseOperationCursor(cursor: string): number {
    const match = /^sfp_oc1_([A-Za-z0-9_-]{22})\.([0-9a-z]{1,11})\.([A-Za-z0-9_-]{43})$/.exec(
      cursor,
    );
    if (match === null) {
      throw new OperationJournalError(
        'JOURNAL_TRANSITION_INVALID',
        'operation list cursor is invalid',
      );
    }
    const generation = match[1]!;
    const encodedSequence = match[2]!;
    const encodedMac = match[3]!;
    const sequence = Number.parseInt(encodedSequence, 36);
    const generationBytes = decodeCanonicalBase64Url(generation, 16);
    const receivedMac = decodeCanonicalBase64Url(encodedMac, 32);
    if (
      generation !== this.cursorGeneration ||
      generationBytes === null ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      sequence > this.nextOperationOrderSequence ||
      encodedSequence !== sequence.toString(36) ||
      receivedMac === null
    ) {
      throw new OperationJournalError(
        'JOURNAL_TRANSITION_INVALID',
        'operation list cursor is invalid',
      );
    }
    const expectedMac = this.operationCursorMac(generation, encodedSequence);
    if (!timingSafeEqual(receivedMac, expectedMac)) {
      throw new OperationJournalError(
        'JOURNAL_TRANSITION_INVALID',
        'operation list cursor is invalid',
      );
    }
    return sequence;
  }

  private firstOperationAfter(sequence: number): number {
    let low = 0;
    let high = this.operationOrder.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.operationOrder[middle]!.sequence <= sequence) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private nextRecord(
    current: OperationRecord,
    status: OperationStatus,
    patch: Partial<
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
  ): OperationRecord {
    const timestamp = new Date(this.now()).toISOString();
    return immutableRecord({
      ...current,
      ...patch,
      sequence: current.sequence + 1,
      previousStatus: current.status,
      status,
      createdAt: timestamp,
      settledAt: terminalStatuses.has(status) ? timestamp : null,
    });
  }

  private async appendRecordUnlocked(record: OperationRecord): Promise<void> {
    if (this.rows >= this.capacity.compactAtRows || this.bytes >= this.capacity.compactAtBytes) {
      await this.compactUnlocked();
    }
    const serialize = (): { recordHash: PrefixedSha256; rowBytes: number; serialized: string } => {
      const rowWithoutHash = {
        schemaVersion: 1 as const,
        record,
        previousRecordHash: this.previousRecordHash,
      };
      const recordHash = prefixedHash(
        'sfp-operation-journal-record-v1',
        zero,
        canonicalJson(rowWithoutHash),
      );
      const serialized = `${canonicalJson({ ...rowWithoutHash, recordHash })}\n`;
      return { recordHash, rowBytes: Buffer.byteLength(serialized, 'utf8'), serialized };
    };
    let { recordHash, rowBytes, serialized } = serialize();
    const reservedBytes =
      Math.max(
        0,
        this.activeReservations.size - (compactedTerminalStatuses.has(record.status) ? 1 : 0),
      ) * TERMINAL_RESERVATION_BYTES;
    if (
      this.rows + 1 > this.capacity.maxRows ||
      this.bytes + rowBytes + reservedBytes > this.capacity.maxBytes
    ) {
      await this.compactUnlocked();
      ({ recordHash, rowBytes, serialized } = serialize());
    }
    if (
      this.rows + 1 > this.capacity.maxRows ||
      this.bytes + rowBytes + reservedBytes > this.capacity.maxBytes
    ) {
      throw new OperationJournalError(
        'JOURNAL_CAPACITY_EXCEEDED',
        'operation journal capacity is exhausted',
      );
    }
    await this.ensureJournalDirectoryUnlocked();
    const handle = await open(this.path, 'a');
    try {
      await handle.write(serialized, undefined, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory(dirname(this.path));
    this.records.set(record.operationId, record);
    this.registerOperationId(record.operationId);
    this.previousRecordHash = recordHash;
    this.rows += 1;
    this.bytes += rowBytes;
  }

  private parseAndVerifyRow(
    line: string,
    expectedPrevious: PrefixedSha256 | null,
  ): ParsedActiveRow {
    let unknown: unknown;
    try {
      unknown = JSON.parse(line);
    } catch (error) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        `operation journal row is invalid JSON: ${String(error)}`,
      );
    }
    if (typeof unknown !== 'object' || unknown === null || Array.isArray(unknown)) {
      throw new OperationJournalError('JOURNAL_CORRUPT', 'operation journal row is not an object');
    }
    if ((unknown as { rowType?: unknown }).rowType === 'compacted-base') {
      if (!hasExactKeys(unknown, compactedBaseRowKeys)) {
        throw new OperationJournalError(
          'JOURNAL_CORRUPT',
          'operation compacted base row has unknown or missing keys',
        );
      }
      const row = unknown as DurableCompactedBaseRowV1;
      const calculated = prefixedHash(
        'sfp-operation-journal-compacted-base-v1',
        zero,
        canonicalJson({
          schemaVersion: row.schemaVersion,
          rowType: row.rowType,
          record: row.record,
          baseFingerprintHash: row.baseFingerprintHash,
          baseStatus: row.baseStatus,
          baseSequence: row.baseSequence,
          previousRecordHash: row.previousRecordHash,
        }),
      );
      const record = this.validateRecord(row.record, true);
      if (
        row.schemaVersion !== 1 ||
        row.previousRecordHash !== expectedPrevious ||
        row.recordHash !== calculated ||
        row.baseFingerprintHash !== record.operationFingerprintHash ||
        row.baseStatus !== record.status ||
        row.baseSequence !== record.sequence
      ) {
        throw new OperationJournalError(
          'JOURNAL_CORRUPT',
          'operation compacted base row is invalid',
        );
      }
      return { ...row, record };
    }
    if (!hasExactKeys(unknown, transitionRowKeys)) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        'operation transition row has unknown or missing keys',
      );
    }
    const row = unknown as DurableOperationRowV1;
    if (
      row.schemaVersion !== 1 ||
      row.previousRecordHash !== expectedPrevious ||
      typeof row.recordHash !== 'string' ||
      typeof row.record !== 'object' ||
      row.record === null ||
      row.record.actorId !== this.options.actorId
    ) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        'operation journal row linkage is invalid',
      );
    }
    const calculated = prefixedHash(
      'sfp-operation-journal-record-v1',
      zero,
      canonicalJson({
        schemaVersion: row.schemaVersion,
        record: row.record,
        previousRecordHash: row.previousRecordHash,
      }),
    );
    if (calculated !== row.recordHash) {
      throw new OperationJournalError('JOURNAL_CORRUPT', 'operation journal row hash is invalid');
    }
    return { ...row, rowType: 'transition', record: this.validateRecord(row.record, true) };
  }

  private parseAndVerifyTombstoneRow(
    line: string,
    expectedPrevious: PrefixedSha256 | null,
  ): DurableOperationRowV1<OperationTombstone> {
    let unknown: unknown;
    try {
      unknown = JSON.parse(line);
    } catch (error) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        `operation tombstone row is invalid JSON: ${String(error)}`,
      );
    }
    if (typeof unknown !== 'object' || unknown === null || Array.isArray(unknown)) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        'operation tombstone row is not an object',
      );
    }
    const row = unknown as DurableOperationRowV1<OperationTombstone>;
    const calculated = prefixedHash(
      'sfp-operation-tombstone-record-v1',
      zero,
      canonicalJson({
        schemaVersion: row.schemaVersion,
        record: row.record,
        previousRecordHash: row.previousRecordHash,
      }),
    );
    if (
      row.schemaVersion !== 1 ||
      row.previousRecordHash !== expectedPrevious ||
      row.recordHash !== calculated
    ) {
      throw new OperationJournalError('JOURNAL_CORRUPT', 'operation tombstone linkage is invalid');
    }
    let record: OperationTombstone;
    try {
      record = parseOperationTombstone(row.record);
      if (
        record.actorId !== this.options.actorId ||
        hashOperationFingerprint(record) !== record.operationFingerprintHash
      ) {
        throw new Error('tombstone provenance mismatch');
      }
    } catch (error) {
      throw new OperationJournalError(
        'JOURNAL_CORRUPT',
        `operation tombstone does not match its closed schema: ${String(error)}`,
      );
    }
    return {
      ...row,
      record: Object.freeze({ ...record, origin: Object.freeze({ ...record.origin }) }),
    };
  }

  private validateRecord(record: unknown, loading = false): OperationRecord {
    try {
      const parsed = parseOperationRecord(record);
      if (parsed.actorId !== this.options.actorId) throw new Error('operation actor mismatch');
      if (parsed.operationKind === 'tool' && !knownToolNames.has(parsed.operationName)) {
        throw new Error('operation tool name is not registered');
      }
      if (hashOperationFingerprint(parsed) !== parsed.operationFingerprintHash) {
        throw new Error('operation fingerprint mismatch');
      }
      return immutableRecord(parsed);
    } catch (error) {
      throw new OperationJournalError(
        loading ? 'JOURNAL_CORRUPT' : 'OPERATION_ID_CONFLICT',
        `operation record does not match its closed schema: ${String(error)}`,
      );
    }
  }

  private async compactUnlocked(): Promise<void> {
    if (this.records.size >= this.capacity.maxRows) return;
    const records = [...this.records.values()].toSorted((left, right) =>
      left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
    );
    let previous: PrefixedSha256 | null = null;
    const lines: string[] = [];
    for (const record of records) {
      const rowWithoutHash = {
        schemaVersion: 1 as const,
        rowType: 'compacted-base' as const,
        record,
        baseFingerprintHash: record.operationFingerprintHash,
        baseStatus: record.status,
        baseSequence: record.sequence,
        previousRecordHash: previous,
      };
      const recordHash = prefixedHash(
        'sfp-operation-journal-compacted-base-v1',
        zero,
        canonicalJson(rowWithoutHash),
      );
      lines.push(canonicalJson({ ...rowWithoutHash, recordHash }));
      previous = recordHash;
    }
    const serialized = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    await this.rewritePathBytes(this.path, Buffer.from(serialized, 'utf8'));
    this.rows = records.length;
    this.bytes = Buffer.byteLength(serialized, 'utf8');
    this.previousRecordHash = previous;
  }

  private async rewriteBytes(contents: Uint8Array): Promise<void> {
    await this.rewritePathBytes(this.path, contents);
  }

  private async rewritePathBytes(path: string, contents: Uint8Array): Promise<void> {
    await this.ensureJournalDirectoryUnlocked();
    const temporary = `${path}.tmp`;
    await writeFile(temporary, contents);
    const handle = await open(temporary, 'r+');
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
    await this.syncDirectory(dirname(path));
  }

  private async syncDirectory(path: string): Promise<void> {
    if (this.options.syncDirectory !== undefined) {
      await this.options.syncDirectory(path);
      return;
    }
    const directory = await open(path, 'r');
    await directory.sync().catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    });
    await directory.close();
  }

  private async ensureJournalDirectoryUnlocked(): Promise<void> {
    if (this.journalDirectoryInitialized) return;
    const journalDirectory = dirname(this.path);
    const existed = await lstat(journalDirectory).then(
      metadata => metadata.isDirectory(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    await mkdir(journalDirectory, { recursive: true });
    if (!existed) await this.syncDirectory(this.options.stateRoot);
    this.journalDirectoryInitialized = true;
  }

  private async refreshGenerationFencesUnlocked(): Promise<void> {
    const bytes = await readFileWithinLimit(this.generationFencePath, 1_048_576).catch(
      (error: NodeJS.ErrnoException & { beforeRead?: boolean }) => {
        if (error.code === 'ENOENT') return Buffer.alloc(0);
        throw Object.assign(
          new OperationJournalError('JOURNAL_CORRUPT', 'generation fence log is invalid'),
          { beforeRead: error.beforeRead === true },
        );
      },
    );
    const next = new Set<string>();
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new OperationJournalError('JOURNAL_CORRUPT', 'generation fence row is malformed');
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        !hasExactKeys(value, new Set(['schemaVersion', 'leaderGeneration', 'fencedAt']))
      ) {
        throw new OperationJournalError('JOURNAL_CORRUPT', 'generation fence row is invalid');
      }
      const row = value as { schemaVersion: unknown; leaderGeneration: unknown; fencedAt: unknown };
      if (
        row.schemaVersion !== 1 ||
        typeof row.leaderGeneration !== 'string' ||
        row.leaderGeneration.length < 1 ||
        row.leaderGeneration.length > 256 ||
        typeof row.fencedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.fencedAt))
      ) {
        throw new OperationJournalError('JOURNAL_CORRUPT', 'generation fence row is invalid');
      }
      next.add(row.leaderGeneration);
    }
    this.fencedLeaderGenerations.clear();
    for (const generation of next) this.fencedLeaderGenerations.add(generation);
  }

  private async recoverTombstonesUnlocked(deferPurge = false): Promise<void> {
    const bytes = await readFile(this.tombstonePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return Buffer.alloc(0);
      throw error;
    });
    this.tombstones.clear();
    this.tombstoneRows = 0;
    this.tombstoneBytes = 0;
    this.previousTombstoneHash = null;
    let validBytes = 0;
    const completeLength = bytes.lastIndexOf(0x0a) + 1;
    const lines = bytes.subarray(0, completeLength).toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const rowBytes = Buffer.byteLength(line, 'utf8') + 1;
      const row = this.parseAndVerifyTombstoneRow(line, this.previousTombstoneHash);
      if (this.tombstones.has(row.record.operationId)) {
        throw new OperationJournalError('JOURNAL_CORRUPT', 'duplicate operation tombstone');
      }
      this.tombstones.set(row.record.operationId, row.record);
      this.registerOperationId(row.record.operationId);
      this.previousTombstoneHash = row.recordHash;
      this.tombstoneRows += 1;
      this.tombstoneBytes += rowBytes;
      validBytes += rowBytes;
    }
    if (completeLength !== bytes.byteLength) {
      const tail = bytes.subarray(completeLength);
      try {
        JSON.parse(tail.toString('utf8'));
        throw new OperationJournalError(
          'JOURNAL_CORRUPT',
          'operation tombstone journal has a complete row without LF',
        );
      } catch (error) {
        if (error instanceof OperationJournalError) throw error;
        await this.rewritePathBytes(this.tombstonePath, bytes.subarray(0, validBytes));
      }
    } else if (bytes.byteLength === 0) {
      const handle = await open(this.tombstonePath, 'a');
      await handle.sync();
      await handle.close();
      await this.syncDirectory(dirname(this.tombstonePath));
    }
    if (
      this.tombstoneRows > this.tombstoneCapacity.maxRows ||
      this.tombstoneBytes > this.tombstoneCapacity.maxBytes
    ) {
      throw new OperationJournalError('JOURNAL_CORRUPT', 'operation tombstone cap is exceeded');
    }
    if (
      !deferPurge &&
      [...this.tombstones.values()].some(tombstone => this.now() >= tombstone.expiresAt)
    ) {
      await this.purgeExpiredTombstonesUnlocked();
    }
  }

  private async publishTombstoneUnlocked(record: OperationRecord): Promise<void> {
    const tombstone = this.toTombstone(record);
    const existing = this.tombstones.get(tombstone.operationId);
    if (existing !== undefined) {
      if (
        existing.operationFingerprintHash !== tombstone.operationFingerprintHash ||
        existing.status !== tombstone.status ||
        existing.resultHash !== tombstone.resultHash
      ) {
        throw new OperationJournalError('JOURNAL_CORRUPT', 'operation tombstone conflicts');
      }
      this.records.delete(tombstone.operationId);
      await this.compactUnlocked();
      return;
    }
    const rowWithoutHash = {
      schemaVersion: 1 as const,
      record: tombstone,
      previousRecordHash: this.previousTombstoneHash,
    };
    const recordHash = prefixedHash(
      'sfp-operation-tombstone-record-v1',
      zero,
      canonicalJson(rowWithoutHash),
    );
    const serialized = `${canonicalJson({ ...rowWithoutHash, recordHash })}\n`;
    const rowBytes = Buffer.byteLength(serialized, 'utf8');
    const otherReservedRows = Math.max(0, this.tombstoneReservations.size - 1);
    const otherReservedBytes = otherReservedRows * TERMINAL_RESERVATION_BYTES;
    if (
      rowBytes > TERMINAL_RESERVATION_BYTES ||
      this.tombstoneRows + 1 + otherReservedRows > this.tombstoneCapacity.maxRows ||
      this.tombstoneBytes + rowBytes + otherReservedBytes > this.tombstoneCapacity.maxBytes
    ) {
      throw new OperationJournalError(
        'JOURNAL_CAPACITY_EXCEEDED',
        'operation tombstone capacity is exhausted',
      );
    }
    const handle = await open(this.tombstonePath, 'a');
    try {
      await handle.write(serialized, undefined, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory(dirname(this.tombstonePath));
    this.tombstones.set(tombstone.operationId, tombstone);
    this.previousTombstoneHash = recordHash;
    this.tombstoneRows += 1;
    this.tombstoneBytes += rowBytes;
    await this.options.afterTombstoneFsync?.();
    this.records.delete(tombstone.operationId);
    await this.compactUnlocked();
  }

  private toTombstone(record: OperationRecord): OperationTombstone {
    if (!terminalStatuses.has(record.status)) {
      throw new OperationJournalError(
        'JOURNAL_TRANSITION_INVALID',
        'nonterminal operation cannot become a tombstone',
      );
    }
    return parseOperationTombstone({
      actorId: record.actorId,
      originAuthSessionId: record.originAuthSessionId,
      origin: record.origin,
      operationId: record.operationId,
      issuedAt: record.issuedAt,
      expiresAt: record.issuedAt + 2_592_000_000,
      operationKind: record.operationKind,
      operationName: record.operationName,
      argsHash: record.argsHash,
      captureIntentHash: record.captureIntentHash,
      operationFingerprintHash: record.operationFingerprintHash,
      workspaceId: record.workspaceId,
      fileExecutionKey: record.fileExecutionKey,
      fileExecutionKeyHash: record.fileExecutionKeyHash,
      targetBindingHash: record.targetBindingHash,
      resultHash: record.resultHash,
      operationEvidenceReceiptHash: record.operationEvidenceReceiptHash,
      finalEgressManifestHash: record.finalEgressManifestHash,
      leaderGeneration: record.leaderGeneration ?? null,
      errorCode: record.errorCode,
      settledAt: record.settledAt as string,
      status: record.status,
    });
  }

  private resolutionMatchesTombstone(
    resolution: OperationResolutionRecord,
    tombstone: OperationTombstone,
  ): boolean {
    return (
      tombstone.actorId === resolution.actorId &&
      tombstone.originAuthSessionId === resolution.originAuthSessionId &&
      canonicalJson(tombstone.origin) === canonicalJson(resolution.origin) &&
      tombstone.operationId === resolution.operationId &&
      tombstone.issuedAt === resolution.issuedAt &&
      tombstone.operationKind === resolution.operationKind &&
      tombstone.operationName === resolution.operationName &&
      tombstone.argsHash === resolution.argsHash &&
      tombstone.captureIntentHash === resolution.captureIntentHash &&
      tombstone.operationFingerprintHash === resolution.operationFingerprintHash &&
      tombstone.workspaceId === resolution.workspaceId &&
      tombstone.fileExecutionKey === resolution.fileExecutionKey &&
      tombstone.fileExecutionKeyHash === resolution.fileExecutionKeyHash &&
      tombstone.targetBindingHash === resolution.targetBindingHash &&
      tombstone.resultHash === resolution.resultHash &&
      tombstone.operationEvidenceReceiptHash === resolution.operationEvidenceReceiptHash &&
      tombstone.finalEgressManifestHash === resolution.finalEgressManifestHash &&
      tombstone.status === resolution.decision
    );
  }

  private async compactKnownTerminalsUnlocked(): Promise<void> {
    const terminals = [...this.records.values()]
      .filter(record => compactedTerminalStatuses.has(record.status))
      .toSorted((left, right) =>
        left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
      );
    for (const record of terminals) {
      // eslint-disable-next-line no-await-in-loop -- one ordered tombstone hash chain
      await this.publishTombstoneUnlocked(record);
    }
  }

  private async purgeExpiredTombstonesUnlocked(now = this.now()): Promise<number> {
    let removed = 0;
    for (const [operationId, tombstone] of this.tombstones) {
      if (now < tombstone.expiresAt) continue;
      this.tombstones.delete(operationId);
      removed += 1;
    }
    if (removed > 0) await this.rewriteTombstonesUnlocked();
    if (removed > 0) {
      this.operationOrder = this.operationOrder.filter(
        entry => this.records.has(entry.operationId) || this.tombstones.has(entry.operationId),
      );
      this.indexedOperationIds.clear();
      for (const entry of this.operationOrder) this.indexedOperationIds.add(entry.operationId);
    }
    return removed;
  }

  private async rewriteTombstonesUnlocked(): Promise<void> {
    let previous: PrefixedSha256 | null = null;
    const lines: string[] = [];
    for (const tombstone of this.tombstones.values()) {
      const rowWithoutHash = {
        schemaVersion: 1 as const,
        record: tombstone,
        previousRecordHash: previous,
      };
      const recordHash = prefixedHash(
        'sfp-operation-tombstone-record-v1',
        zero,
        canonicalJson(rowWithoutHash),
      );
      lines.push(canonicalJson({ ...rowWithoutHash, recordHash }));
      previous = recordHash;
    }
    const serialized = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    await this.rewritePathBytes(this.tombstonePath, Buffer.from(serialized, 'utf8'));
    this.previousTombstoneHash = previous;
    this.tombstoneRows = lines.length;
    this.tombstoneBytes = Buffer.byteLength(serialized, 'utf8');
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class JournalWorkspaceUsageGuard {
  constructor(private readonly journal: OperationJournal) {}

  hasUnsettled(workspaceId: string): Promise<boolean> {
    return this.journal.hasUnsettled(workspaceId);
  }
}
