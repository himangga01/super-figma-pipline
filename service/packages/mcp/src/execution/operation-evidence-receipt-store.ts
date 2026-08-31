import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  OPERATION_EVIDENCE_LIMITS,
  OperationEvidenceReceiptV1Schema,
  type OperationEvidenceReceiptAppendV1,
  type OperationEvidenceReceiptStorePort,
  type OperationEvidenceReceiptV1,
  type OperationStatus,
  type PrefixedSha256,
  type PreRuntimeOperationAuthorityV1,
} from '@sfp/shared';

import {
  publishImmutableGeneration,
  readFileWithinLimit,
  readImmutableGeneration,
  withCanonicalPathMutex,
  type ImmutableGenerationStep,
} from '../fs/atomic-file.js';

const zero = Buffer.from([0]);
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('evidence receipt is not canonical JSON');
  return encoded;
};
const actorFilenameHash = (actorId: string): string =>
  createHash('sha256')
    .update('sfp-journal-actor-filename-v1', 'utf8')
    .update(zero)
    .update(actorId, 'utf8')
    .digest('hex');
const contentHash = (value: unknown): PrefixedSha256 =>
  `sha256:${createHash('sha256')
    .update('sfp-operation-evidence-content-v1', 'utf8')
    .update(zero)
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
const chainHash = (content: PrefixedSha256, previous: PrefixedSha256 | null): PrefixedSha256 => {
  const digest = createHash('sha256')
    .update('sfp-operation-evidence-record-v1', 'utf8')
    .update(zero)
    .update(content, 'ascii');
  if (previous === null) digest.update(Buffer.from([0]));
  else digest.update(Buffer.from([1])).update(previous, 'ascii');
  return `sha256:${digest.digest('hex')}`;
};
const receiptError = (code: string, message: string, cause?: unknown) =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
const cleanupHash = (value: unknown): PrefixedSha256 =>
  `sha256:${createHash('sha256')
    .update('sfp-operation-evidence-cleanup-intent-v1', 'utf8')
    .update(zero)
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
const exactKeys = (value: object, expected: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...expected].toSorted());

interface CleanupIntentRowV1 {
  schemaVersion: 1;
  kind: 'add' | 'done';
  operationId: string;
  receipt: OperationEvidenceReceiptV1 | null;
  previousRecordHash: PrefixedSha256 | null;
  recordHash: PrefixedSha256;
}

interface EvidenceLimits {
  maxRowBytes: number;
  maxNativeArtifacts: number;
  maxNativeArtifactPathBytes: number;
  maxNativeArtifactManifestBytes: number;
  compactAtRows: number;
  compactAtBytes: number;
  maxRowsPerActor: number;
  maxBytesPerActor: number;
  reservationBytesPerOperation: number;
  retentionDays: number;
}
export interface PreRuntimeReservationRecoveryIntent {
  kind: 'pre-runtime-no-output';
  operationFingerprintHash: PrefixedSha256;
  preExecutionManifestHash: PrefixedSha256;
  finalEgressManifestHash: PrefixedSha256;
}
export interface PreRuntimeCrashReservation {
  actorId: `actor1_${string}`;
  operationId: string;
  projectedBytes: number;
  workspaceId: string | null | undefined;
  operationAuthority: Readonly<PreRuntimeOperationAuthorityV1> | undefined;
  recoveryIntent: Readonly<PreRuntimeReservationRecoveryIntent> | undefined;
}
type Reservation = PreRuntimeCrashReservation;
type Presence = Readonly<{ kind: 'absent' | 'present' }>;
type ArtifactPresence = Readonly<{ kind: 'absent' | 'present' | 'unknown' }>;
export interface PreRuntimeReservationClassification {
  journal:
    | Readonly<{ kind: 'absent' }>
    | Readonly<{
        kind: 'present';
        recordKind: 'active' | 'tombstone';
        status: OperationStatus;
        operationFingerprintHash: PrefixedSha256;
        preExecutionManifestHash: PrefixedSha256 | null;
        finalEgressManifestHash: PrefixedSha256 | null;
        operationEvidenceReceiptHash: PrefixedSha256 | null;
      }>;
  egress:
    | Readonly<{ kind: 'absent' }>
    | Readonly<{ kind: 'pre-only'; preExecutionManifestHash: PrefixedSha256 }>
    | Readonly<{
        kind: 'final';
        preExecutionManifestHash: PrefixedSha256;
        finalEgressManifestHash: PrefixedSha256;
        finalStatus: 'output' | 'no-output' | 'outcome-unknown';
        reasonCode: string | null;
      }>;
  receipt: Presence;
  finalizer: Presence;
  resultArtifact: ArtifactPresence;
  nativeArtifact: ArtifactPresence;
  settlement:
    | Readonly<{
        intent: Readonly<PreRuntimeReservationRecoveryIntent>;
        settle(): Promise<void>;
      }>
    | undefined;
}
export type PreRuntimeReservationClassifier = (
  reservation: Readonly<PreRuntimeCrashReservation>,
) => Promise<Readonly<PreRuntimeReservationClassification>>;
interface StoreOptions {
  stateRoot: string;
  actorId: `actor1_${string}`;
  limits?: EvidenceLimits;
  now?: () => number;
  compactionHook?: (step: ImmutableGenerationStep) => Promise<void>;
}

export class OperationEvidenceReceiptStore implements OperationEvidenceReceiptStorePort {
  readonly logPath: string;
  readonly cleanupIntentPath: string;
  readonly reservationLogPath: string;
  private readonly limits: EvidenceLimits;
  private readonly now: () => number;
  private readonly reservations = new Map<string, Reservation>();
  private readonly receipts = new Map<string, OperationEvidenceReceiptV1>();
  private rows: OperationEvidenceReceiptV1[] = [];
  private bytes = 0;
  private activeRows = 0;
  private activeBytes = 0;
  private recovered = false;
  private readonly pendingArtifactCleanup = new Map<string, OperationEvidenceReceiptV1>();
  private previousCleanupHash: PrefixedSha256 | null = null;
  private cleanupBytes = 0;
  private reservationLogBytes = 0;

  constructor(private readonly options: StoreOptions) {
    this.limits = options.limits ?? OPERATION_EVIDENCE_LIMITS;
    this.now = options.now ?? Date.now;
    this.logPath = join(
      options.stateRoot,
      'journal',
      `${actorFilenameHash(options.actorId)}.operation-evidence.v1.jsonl`,
    );
    this.cleanupIntentPath = `${this.logPath}.cleanup-intents`;
    this.reservationLogPath = `${this.logPath}.reservations`;
  }

  async recover(): Promise<void> {
    return this.exclusive(async () => {
      await this.recoverUnlocked();
    }, false);
  }

  async recoverPreRuntimeReservations(classify: PreRuntimeReservationClassifier): Promise<void> {
    return this.exclusive(async () => {
      await this.recoverUnlocked();
      await this.recoverPreRuntimeReservationsUnlocked(classify);
    }, false);
  }

  private async recoverUnlocked(): Promise<void> {
    await mkdir(join(this.options.stateRoot, 'journal'), { recursive: true });
    let activeBytes = await this.readOrCreateBase();
    let discardPublishedTail = false;
    if (activeBytes.byteLength > this.limits.maxBytesPerActor) {
      throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt log exceeds its hard cap');
    }
    if (activeBytes.byteLength > 0 && activeBytes.at(-1) !== 0x0a) {
      const lastNewline = activeBytes.lastIndexOf(0x0a);
      activeBytes = activeBytes.subarray(0, lastNewline < 0 ? 0 : lastNewline + 1);
      await this.rewriteBase(activeBytes);
    }
    let selected: Awaited<ReturnType<typeof readImmutableGeneration>>;
    try {
      selected = await readImmutableGeneration({
        basePath: this.logPath,
        store: 'operation-evidence',
        actorHash: actorFilenameHash(this.options.actorId),
        maxLogBytes: this.limits.maxBytesPerActor,
      });
    } catch (cause) {
      throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt generation is invalid', cause);
    }
    if (selected !== null && activeBytes.byteLength >= selected.baseTailBytes) {
      const publishedTail = activeBytes.subarray(0, selected.baseTailBytes);
      const publishedTailDigest = createHash('sha256').update(publishedTail).digest('hex');
      if (publishedTailDigest === selected.baseTailDigest64) {
        activeBytes = activeBytes.subarray(selected.baseTailBytes);
        discardPublishedTail = selected.baseTailBytes > 0;
      }
    }
    if (
      selected !== null &&
      selected.logBytes.byteLength + activeBytes.byteLength > this.limits.maxBytesPerActor
    ) {
      throw receiptError(
        'EVIDENCE_RECEIPT_CORRUPT',
        'receipt generation and active tail exceed their hard cap',
      );
    }
    if (discardPublishedTail) await this.rewriteBase(activeBytes);
    const bytes =
      selected === null
        ? activeBytes
        : Buffer.concat([Buffer.from(selected.logBytes), activeBytes]);
    this.loadRows(bytes);
    await this.loadCleanupIntentsUnlocked();
    await this.loadReservationsUnlocked();
    this.bytes = bytes.byteLength;
    this.activeRows = activeBytes.toString('utf8').split('\n').filter(Boolean).length;
    this.activeBytes = activeBytes.byteLength;
    if (
      this.rows.length > this.limits.maxRowsPerActor ||
      this.bytes > this.limits.maxBytesPerActor
    ) {
      throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt log exceeds its hard cap');
    }
    this.recovered = true;
  }

  async reserveBeforeRuntime(
    actorId: `actor1_${string}`,
    operationId: string,
    projectedBytes: number,
    context: Readonly<{
      workspaceId: string | null;
      operationAuthority?: Readonly<PreRuntimeOperationAuthorityV1>;
    }> = { workspaceId: null },
  ): Promise<{ reservationId: string; reservedBytes: 65_536 }> {
    return this.exclusive(() =>
      this.reserveBeforeRuntimeUnlocked(actorId, operationId, projectedBytes, context),
    );
  }

  private async reserveBeforeRuntimeUnlocked(
    actorId: `actor1_${string}`,
    operationId: string,
    projectedBytes: number,
    context: Readonly<{
      workspaceId: string | null;
      operationAuthority?: Readonly<PreRuntimeOperationAuthorityV1>;
    }>,
  ): Promise<{ reservationId: string; reservedBytes: 65_536 }> {
    this.assertReady(actorId);
    if (
      !Number.isSafeInteger(projectedBytes) ||
      projectedBytes < 0 ||
      projectedBytes > this.limits.reservationBytesPerOperation
    ) {
      throw receiptError('EVIDENCE_RECEIPT_ROW_TOO_LARGE', 'projected receipt exceeds reservation');
    }
    if (
      context.operationAuthority !== undefined &&
      (context.operationAuthority.actorId !== actorId ||
        context.operationAuthority.operationId !== operationId ||
        context.operationAuthority.workspaceId !== context.workspaceId)
    ) {
      throw receiptError(
        'EVIDENCE_RESERVATION_INVALID',
        'pre-runtime operation authority does not match reservation',
      );
    }
    if (
      this.receipts.has(operationId) ||
      this.pendingArtifactCleanup.has(operationId) ||
      [...this.reservations.values()].some(row => row.operationId === operationId)
    ) {
      throw receiptError('EVIDENCE_RESERVATION_CONFLICT', 'operation already owns evidence state');
    }
    if (
      this.rows.length + this.reservations.size + 1 > this.limits.maxRowsPerActor ||
      this.bytes + (this.reservations.size + 1) * this.limits.reservationBytesPerOperation >
        this.limits.maxBytesPerActor
    ) {
      throw receiptError('EVIDENCE_CAPACITY_EXCEEDED', 'evidence receipt capacity is full');
    }
    const reservationId = `sfp_er1_${randomBytes(16).toString('base64url')}`;
    const reservation: Reservation = {
      actorId,
      operationId,
      projectedBytes,
      workspaceId: context.workspaceId,
      operationAuthority: context.operationAuthority,
      recoveryIntent: undefined,
    };
    await this.appendReservationEventUnlocked({ kind: 'reserve', reservationId, reservation });
    this.reservations.set(reservationId, reservation);
    return { reservationId, reservedBytes: 65_536 };
  }

  async prepareAndFsync(
    reservationId: string,
    receipt: OperationEvidenceReceiptAppendV1,
  ): Promise<Readonly<OperationEvidenceReceiptV1>> {
    return this.exclusive(() => this.prepareAndFsyncUnlocked(reservationId, receipt));
  }

  private async prepareAndFsyncUnlocked(
    reservationId: string,
    receipt: OperationEvidenceReceiptAppendV1,
  ): Promise<Readonly<OperationEvidenceReceiptV1>> {
    const reservation = this.reservations.get(reservationId);
    if (
      reservation === undefined ||
      receipt.actorId !== reservation.actorId ||
      receipt.operationId !== reservation.operationId
    ) {
      throw receiptError('EVIDENCE_RESERVATION_INVALID', 'receipt does not match reservation');
    }
    const previousReceiptHash = this.rows.at(-1)?.receiptHash ?? null;
    const receiptContentHash = contentHash(receipt);
    const completed = {
      ...receipt,
      previousReceiptHash,
      contentHash: receiptContentHash,
      receiptHash: chainHash(receiptContentHash, previousReceiptHash),
    };
    let parsed: OperationEvidenceReceiptV1;
    try {
      parsed = OperationEvidenceReceiptV1Schema.parse(completed) as OperationEvidenceReceiptV1;
    } catch (cause) {
      throw receiptError('EVIDENCE_RECEIPT_INVALID', 'receipt schema is invalid', cause);
    }
    const serialized = `${canonicalJson(parsed)}\n`;
    const rowBytes = Buffer.byteLength(serialized, 'utf8');
    if (rowBytes > this.limits.maxRowBytes) {
      throw receiptError('EVIDENCE_RECEIPT_ROW_TOO_LARGE', 'receipt row exceeds its cap');
    }
    const handle = await open(this.logPath, 'a');
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.releaseReservationUnlocked(reservationId);
    this.rows.push(Object.freeze(parsed));
    this.receipts.set(parsed.operationId, Object.freeze(parsed));
    this.bytes += rowBytes;
    this.activeRows += 1;
    this.activeBytes += rowBytes;
    if (
      this.activeRows >= this.limits.compactAtRows ||
      this.activeBytes >= this.limits.compactAtBytes
    ) {
      await this.compactUnlocked({ now: this.now(), linkedAt: () => null });
    }
    return Object.freeze(parsed);
  }

  async get(
    actorId: `actor1_${string}`,
    operationId: string,
  ): Promise<Readonly<OperationEvidenceReceiptV1> | null> {
    return this.exclusive(async () => {
      this.assertReady(actorId);
      return this.receipts.get(operationId) ?? null;
    });
  }

  async compact(
    input: {
      now: number;
      linkedAt(operationId: string): number | null;
      removeArtifacts?(receipt: Readonly<OperationEvidenceReceiptV1>): Promise<void>;
    } = { now: this.now(), linkedAt: () => null },
  ): Promise<void> {
    const expired = await this.exclusive(() => this.compactUnlocked(input));
    /* eslint-disable no-await-in-loop -- deletion follows durable receipt removal publication */
    for (const receipt of expired) {
      if (input.removeArtifacts === undefined) continue;
      await input.removeArtifacts(receipt);
      await this.completeCleanupIntent(receipt.operationId);
    }
    /* eslint-enable no-await-in-loop */
  }

  private async compactUnlocked(input: {
    now: number;
    linkedAt(operationId: string): number | null;
  }): Promise<OperationEvidenceReceiptV1[]> {
    this.assertReady(this.options.actorId);
    const retentionMs = this.limits.retentionDays * 86_400_000;
    const expired: OperationEvidenceReceiptV1[] = [];
    const retained: OperationEvidenceReceiptV1[] = [];
    for (const receipt of this.rows) {
      const linkedAt = input.linkedAt(receipt.operationId);
      if (linkedAt !== null && input.now - linkedAt >= retentionMs) expired.push(receipt);
      else retained.push(receipt);
    }
    let projectedCleanupHash = this.previousCleanupHash;
    let projectedCleanupBytes = this.cleanupBytes;
    for (const receipt of expired) {
      if (
        this.pendingArtifactCleanup.get(receipt.operationId)?.contentHash === receipt.contentHash
      ) {
        continue;
      }
      const withoutHash = {
        schemaVersion: 1 as const,
        kind: 'add' as const,
        operationId: receipt.operationId,
        receipt,
        previousRecordHash: projectedCleanupHash,
      };
      const row = { ...withoutHash, recordHash: cleanupHash(withoutHash) };
      projectedCleanupBytes += Buffer.byteLength(`${canonicalJson(row)}\n`, 'utf8');
      projectedCleanupHash = row.recordHash;
    }
    for (const receipt of expired) {
      const withoutHash = {
        schemaVersion: 1 as const,
        kind: 'done' as const,
        operationId: receipt.operationId,
        receipt: null,
        previousRecordHash: projectedCleanupHash,
      };
      const row = { ...withoutHash, recordHash: cleanupHash(withoutHash) };
      projectedCleanupBytes += Buffer.byteLength(`${canonicalJson(row)}\n`, 'utf8');
      projectedCleanupHash = row.recordHash;
    }
    if (projectedCleanupBytes > this.limits.maxBytesPerActor) {
      throw receiptError('EVIDENCE_CAPACITY_EXCEEDED', 'cleanup intent capacity is full');
    }
    /* eslint-disable no-await-in-loop -- intents must fsync before receipt removal publication */
    for (const receipt of expired) await this.appendCleanupIntentUnlocked('add', receipt);
    /* eslint-enable no-await-in-loop */
    let previousReceiptHash: PrefixedSha256 | null = null;
    const rechained = retained.map(receipt => {
      const { previousReceiptHash: _previous, receiptHash: _chain, ...withoutChain } = receipt;
      const next = Object.freeze({
        ...withoutChain,
        previousReceiptHash,
        receiptHash: chainHash(receipt.contentHash, previousReceiptHash),
      }) as OperationEvidenceReceiptV1;
      previousReceiptHash = next.receiptHash;
      return next;
    });
    const logBytes = Buffer.from(rechained.map(row => `${canonicalJson(row)}\n`).join(''), 'utf8');
    const baseTailBytes = await readFileWithinLimit(this.logPath, this.limits.maxBytesPerActor);
    await publishImmutableGeneration({
      basePath: this.logPath,
      store: 'operation-evidence',
      actorHash: actorFilenameHash(this.options.actorId),
      logBytes,
      rows: rechained.length,
      sequence: rechained.length,
      previousRecordHash: rechained.at(-1)?.receiptHash ?? null,
      firstRetainedRecordHash: rechained.at(0)?.receiptHash ?? null,
      baseTailBytes,
      now: input.now,
      ...(this.options.compactionHook === undefined ? {} : { hook: this.options.compactionHook }),
    });
    this.rows = rechained;
    this.receipts.clear();
    for (const receipt of rechained) this.receipts.set(receipt.operationId, receipt);
    this.bytes = logBytes.byteLength;
    this.activeRows = 0;
    this.activeBytes = 0;
    return expired;
  }

  async drainPendingArtifactCleanup(
    removeArtifacts: (receipt: Readonly<OperationEvidenceReceiptV1>) => Promise<void>,
  ): Promise<void> {
    const pending = await this.exclusive(async () =>
      [...this.pendingArtifactCleanup.values()]
        .filter(receipt => !this.receipts.has(receipt.operationId))
        .toSorted((left, right) => left.operationId.localeCompare(right.operationId)),
    );
    /* eslint-disable no-await-in-loop -- each durable done row follows successful artifact cleanup */
    for (const receipt of pending) {
      await removeArtifacts(receipt);
      await this.completeCleanupIntent(receipt.operationId);
    }
    /* eslint-enable no-await-in-loop */
  }

  async releaseWithoutReceipt(reservationId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.releaseReservationUnlocked(reservationId);
    });
  }

  async abortAfterDurableUnknown(reservationId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.releaseReservationUnlocked(reservationId);
    });
  }

  async flush(): Promise<void> {
    return this.exclusive(async () => {
      this.assertReady(this.options.actorId);
      const handle = await open(this.logPath, 'a', 0o600);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  private async loadReservationsUnlocked(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await readFileWithinLimit(this.reservationLogPath, this.limits.maxBytesPerActor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const handle = await open(this.reservationLogPath, 'wx', 0o600);
      await handle.sync();
      await handle.close();
      bytes = Buffer.alloc(0);
    }
    this.reservations.clear();
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as {
        schemaVersion: 1;
        kind: 'reserve' | 'recover-pre-runtime' | 'release';
        reservationId: string;
        reservation?: Reservation;
        recoveryIntent?: PreRuntimeReservationRecoveryIntent;
      };
      if (event.schemaVersion !== 1 || !/^sfp_er1_[A-Za-z0-9_-]{22}$/u.test(event.reservationId)) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'reservation log row is invalid');
      }
      if (event.kind === 'reserve' && event.reservation !== undefined) {
        this.reservations.set(event.reservationId, event.reservation);
      } else if (event.kind === 'recover-pre-runtime' && event.recoveryIntent !== undefined) {
        const reservation = this.reservations.get(event.reservationId);
        if (reservation === undefined) {
          throw receiptError(
            'EVIDENCE_RECEIPT_CORRUPT',
            'pre-runtime recovery intent has no reservation',
          );
        }
        if (
          reservation.recoveryIntent !== undefined &&
          canonicalJson(reservation.recoveryIntent) !== canonicalJson(event.recoveryIntent)
        ) {
          throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'pre-runtime recovery intent conflicts');
        }
        this.reservations.set(
          event.reservationId,
          Object.freeze({ ...reservation, recoveryIntent: event.recoveryIntent }),
        );
      } else if (event.kind === 'release') {
        this.reservations.delete(event.reservationId);
      } else {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'reservation log event is invalid');
      }
    }
    for (const [reservationId, reservation] of this.reservations) {
      if (this.receipts.has(reservation.operationId)) this.reservations.delete(reservationId);
    }
    this.reservationLogBytes = bytes.byteLength;
    if (this.reservations.size === 0 && bytes.byteLength > 0) {
      const handle = await open(this.reservationLogPath, 'w', 0o600);
      await handle.sync();
      await handle.close();
      this.reservationLogBytes = 0;
    }
  }

  private async recoverPreRuntimeReservationsUnlocked(
    classify: PreRuntimeReservationClassifier,
  ): Promise<void> {
    const candidates = [...this.reservations.entries()].toSorted(([, left], [, right]) =>
      left.operationId.localeCompare(right.operationId),
    );
    /* eslint-disable no-await-in-loop -- each classification precedes one durable settlement */
    for (const [reservationId, reservation] of candidates) {
      const classification = await classify(Object.freeze({ ...reservation }));
      if (
        !['absent', 'present'].includes(classification.journal.kind) ||
        !['absent', 'pre-only', 'final'].includes(classification.egress.kind) ||
        !['absent', 'present'].includes(classification.receipt.kind) ||
        !['absent', 'present'].includes(classification.finalizer.kind) ||
        !['absent', 'present', 'unknown'].includes(classification.resultArtifact.kind) ||
        !['absent', 'present', 'unknown'].includes(classification.nativeArtifact.kind)
      ) {
        throw receiptError(
          'EVIDENCE_RECEIPT_CORRUPT',
          'pre-runtime reservation classification is invalid',
        );
      }
      const authority = reservation.operationAuthority;
      const settlement = classification.settlement;
      const noEvidenceOrSideEffect =
        classification.receipt.kind === 'absent' &&
        classification.resultArtifact.kind === 'absent' &&
        classification.nativeArtifact.kind === 'absent';
      if (authority === undefined || settlement === undefined || !noEvidenceOrSideEffect) {
        continue;
      }
      let intent = reservation.recoveryIntent;
      if (intent === undefined) {
        const exactlyPreRuntime =
          classification.journal.kind === 'absent' &&
          classification.egress.kind === 'pre-only' &&
          classification.finalizer.kind === 'absent' &&
          settlement.intent.kind === 'pre-runtime-no-output' &&
          settlement.intent.operationFingerprintHash === authority.operationFingerprintHash &&
          settlement.intent.preExecutionManifestHash ===
            classification.egress.preExecutionManifestHash &&
          authority.preExecutionConsentManifestHash ===
            classification.egress.preExecutionManifestHash;
        if (!exactlyPreRuntime) continue;
        intent = Object.freeze({ ...settlement.intent });
        await this.appendReservationEventUnlocked({
          kind: 'recover-pre-runtime',
          reservationId,
          recoveryIntent: intent,
        });
        this.reservations.set(
          reservationId,
          Object.freeze({ ...reservation, recoveryIntent: intent }),
        );
      } else {
        const sameIntent =
          canonicalJson(intent) === canonicalJson(settlement.intent) &&
          intent.operationFingerprintHash === authority.operationFingerprintHash &&
          intent.preExecutionManifestHash === authority.preExecutionConsentManifestHash;
        const matchingEgress =
          (classification.egress.kind === 'pre-only' &&
            classification.finalizer.kind === 'absent' &&
            classification.egress.preExecutionManifestHash === intent.preExecutionManifestHash) ||
          (classification.egress.kind === 'final' &&
            classification.finalizer.kind === 'present' &&
            classification.egress.preExecutionManifestHash === intent.preExecutionManifestHash &&
            classification.egress.finalEgressManifestHash === intent.finalEgressManifestHash &&
            classification.egress.finalStatus === 'no-output' &&
            classification.egress.reasonCode === 'admission-rejected');
        const matchingJournal =
          classification.journal.kind === 'absent' ||
          (classification.journal.operationFingerprintHash === intent.operationFingerprintHash &&
            classification.journal.operationEvidenceReceiptHash === null &&
            ((classification.journal.status === 'queued' &&
              classification.journal.recordKind === 'active' &&
              classification.journal.preExecutionManifestHash === intent.preExecutionManifestHash &&
              classification.journal.finalEgressManifestHash === null) ||
              (classification.journal.status === 'rejected' &&
                (classification.journal.preExecutionManifestHash ===
                  intent.preExecutionManifestHash ||
                  (classification.journal.recordKind === 'tombstone' &&
                    classification.journal.preExecutionManifestHash === null)) &&
                classification.journal.finalEgressManifestHash ===
                  intent.finalEgressManifestHash)));
        if (!sameIntent || !matchingEgress || !matchingJournal) continue;
      }
      await settlement.settle();
      await this.releaseReservationUnlocked(reservationId);
    }
    /* eslint-enable no-await-in-loop */
  }

  private async appendReservationEventUnlocked(input: {
    kind: 'reserve' | 'recover-pre-runtime' | 'release';
    reservationId: string;
    reservation?: Reservation;
    recoveryIntent?: PreRuntimeReservationRecoveryIntent;
  }): Promise<void> {
    const serialized = `${canonicalJson({ schemaVersion: 1, ...input })}\n`;
    const rowBytes = Buffer.byteLength(serialized, 'utf8');
    if (this.reservationLogBytes + rowBytes > this.limits.maxBytesPerActor) {
      throw receiptError('EVIDENCE_CAPACITY_EXCEEDED', 'reservation authority capacity is full');
    }
    const handle = await open(this.reservationLogPath, 'a', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.reservationLogBytes += rowBytes;
  }

  private async releaseReservationUnlocked(reservationId: string): Promise<void> {
    if (!this.reservations.has(reservationId)) return;
    await this.appendReservationEventUnlocked({ kind: 'release', reservationId });
    this.reservations.delete(reservationId);
    if (this.reservations.size === 0) {
      const handle = await open(this.reservationLogPath, 'w', 0o600);
      await handle.sync();
      await handle.close();
      this.reservationLogBytes = 0;
    }
  }

  private async readOrCreateBase(): Promise<Buffer> {
    try {
      return await readFileWithinLimit(this.logPath, this.limits.maxBytesPerActor);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt log cannot be read', cause);
      }
      const handle = await open(this.logPath, 'wx', 0o600);
      await handle.sync();
      await handle.close();
      return Buffer.alloc(0);
    }
  }

  private async loadCleanupIntentsUnlocked(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await readFileWithinLimit(this.cleanupIntentPath, this.limits.maxBytesPerActor);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent log cannot be read', cause);
      }
      const handle = await open(this.cleanupIntentPath, 'wx', 0o600);
      await handle.sync();
      await handle.close();
      bytes = Buffer.alloc(0);
    }
    if (bytes.byteLength > 0 && bytes.at(-1) !== 0x0a) {
      throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent log is truncated');
    }
    this.pendingArtifactCleanup.clear();
    this.previousCleanupHash = null;
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(line) as unknown;
      } catch (cause) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent row is malformed', cause);
      }
      if (typeof untrusted !== 'object' || untrusted === null || Array.isArray(untrusted)) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent row is invalid');
      }
      const row = untrusted as CleanupIntentRowV1;
      const { recordHash, ...withoutHash } = row;
      if (
        !exactKeys(row, [
          'schemaVersion',
          'kind',
          'operationId',
          'receipt',
          'previousRecordHash',
          'recordHash',
        ]) ||
        row.schemaVersion !== 1 ||
        !['add', 'done'].includes(row.kind) ||
        row.operationId.length < 1 ||
        row.operationId.length > 384 ||
        row.previousRecordHash !== this.previousCleanupHash ||
        recordHash !== cleanupHash(withoutHash)
      ) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent chain is invalid');
      }
      if (row.kind === 'add') {
        const parsed = OperationEvidenceReceiptV1Schema.safeParse(row.receipt);
        if (!parsed.success || parsed.data.operationId !== row.operationId) {
          throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent receipt is invalid');
        }
        const existing = this.pendingArtifactCleanup.get(row.operationId);
        if (existing !== undefined && existing.contentHash !== parsed.data.contentHash) {
          throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup intent conflicts');
        }
        this.pendingArtifactCleanup.set(
          row.operationId,
          Object.freeze(parsed.data) as OperationEvidenceReceiptV1,
        );
      } else {
        if (row.receipt !== null || !this.pendingArtifactCleanup.delete(row.operationId)) {
          throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'cleanup completion is invalid');
        }
      }
      this.previousCleanupHash = recordHash;
    }
    this.cleanupBytes = bytes.byteLength;
  }

  private async appendCleanupIntentUnlocked(
    kind: 'add' | 'done',
    receipt: Readonly<OperationEvidenceReceiptV1>,
  ): Promise<void> {
    if (
      kind === 'add' &&
      this.pendingArtifactCleanup.get(receipt.operationId)?.contentHash === receipt.contentHash
    ) {
      return;
    }
    const withoutHash = {
      schemaVersion: 1 as const,
      kind,
      operationId: receipt.operationId,
      receipt: kind === 'add' ? receipt : null,
      previousRecordHash: this.previousCleanupHash,
    };
    const row = { ...withoutHash, recordHash: cleanupHash(withoutHash) };
    const serialized = `${canonicalJson(row)}\n`;
    const rowBytes = Buffer.byteLength(serialized, 'utf8');
    if (this.cleanupBytes + rowBytes > this.limits.maxBytesPerActor) {
      throw receiptError('EVIDENCE_CAPACITY_EXCEEDED', 'cleanup intent capacity is full');
    }
    const handle = await open(this.cleanupIntentPath, 'a', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.previousCleanupHash = row.recordHash;
    this.cleanupBytes += rowBytes;
    if (kind === 'add') this.pendingArtifactCleanup.set(receipt.operationId, receipt);
    else this.pendingArtifactCleanup.delete(receipt.operationId);
  }

  private async completeCleanupIntent(operationId: string): Promise<void> {
    return this.exclusive(async () => {
      const receipt = this.pendingArtifactCleanup.get(operationId);
      if (receipt === undefined) return;
      if (this.receipts.has(operationId)) {
        throw receiptError(
          'EVIDENCE_RECEIPT_CORRUPT',
          'selected receipt still links pending artifact cleanup',
        );
      }
      await this.appendCleanupIntentUnlocked('done', receipt);
      if (this.pendingArtifactCleanup.size === 0) {
        const handle = await open(this.cleanupIntentPath, 'w', 0o600);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.previousCleanupHash = null;
        this.cleanupBytes = 0;
      }
    });
  }

  private async rewriteBase(bytes: Uint8Array): Promise<void> {
    const handle = await open(this.logPath, 'w', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private loadRows(bytes: Buffer): void {
    this.rows = [];
    this.receipts.clear();
    let previous: PrefixedSha256 | null = null;
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      let parsed: OperationEvidenceReceiptV1;
      try {
        parsed = OperationEvidenceReceiptV1Schema.parse(
          JSON.parse(line),
        ) as OperationEvidenceReceiptV1;
      } catch (cause) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt row schema is invalid', cause);
      }
      const {
        contentHash: observedContent,
        receiptHash: observedChain,
        previousReceiptHash,
        ...base
      } = parsed;
      if (
        previousReceiptHash !== previous ||
        observedContent !== contentHash(base) ||
        observedChain !== chainHash(observedContent, previous) ||
        this.receipts.has(parsed.operationId)
      ) {
        throw receiptError('EVIDENCE_RECEIPT_CORRUPT', 'receipt hash chain is invalid');
      }
      this.rows.push(Object.freeze(parsed));
      this.receipts.set(parsed.operationId, Object.freeze(parsed));
      previous = parsed.receiptHash;
    }
  }

  private assertReady(actorId: string): void {
    if (!this.recovered) {
      throw receiptError('EVIDENCE_RECEIPT_NOT_RECOVERED', 'receipt store is not recovered');
    }
    if (actorId !== this.options.actorId) {
      throw receiptError('EVIDENCE_ACTOR_MISMATCH', 'receipt actor does not match store');
    }
  }

  private async exclusive<T>(operation: () => Promise<T>, refresh = true): Promise<T> {
    return withCanonicalPathMutex(resolve(this.logPath), async () => {
      if (refresh && this.recovered) await this.recoverUnlocked();
      return operation();
    });
  }
}
