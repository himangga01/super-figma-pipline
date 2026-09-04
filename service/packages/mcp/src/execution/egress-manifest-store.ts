import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  EGRESS_MANIFEST_LIMITS,
  type EgressFinalManifest,
  type EgressFinalizerProjectionV1,
  type EgressManifestPort,
  type EgressManifestRecordV1,
  type EgressReservation,
  type PreExecutionConsentManifest,
  type PrefixedSha256,
} from '@sfp/shared';

import {
  publishImmutableGeneration,
  readFileWithinLimit,
  readImmutableGeneration,
  withCanonicalPathMutex,
  type ImmutableGenerationStep,
} from '../fs/atomic-file.js';
import { canonicalEgressJson, verifyEgressManifestHash } from '../policy/egress-policy.js';

const zero = Buffer.from([0]);
const hash = (domain: string | null, value: string): PrefixedSha256 => {
  const digest = createHash('sha256');
  if (domain !== null) digest.update(domain, 'utf8').update(zero);
  return `sha256:${digest.update(value, 'utf8').digest('hex')}`;
};
const actorHash = (actorId: string): string =>
  hash('sfp-journal-actor-filename-v1', actorId).slice('sha256:'.length);
const storeError = (code: string, message: string, cause?: unknown) =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

interface EgressLimits {
  maxRowBytes: number;
  compactAtRows: number;
  compactAtBytes: number;
  maxRowsPerActor: number;
  maxBytesPerActor: number;
  retentionDays: number;
}
interface StoreOptions {
  stateRoot: string;
  actorId: `actor1_${string}`;
  leaderGeneration?: string;
  now?: () => number;
  limits?: EgressLimits;
  compactionHook?: (step: ImmutableGenerationStep) => Promise<void>;
}

const recordHash = (record: Omit<EgressManifestRecordV1, 'recordHash'>): PrefixedSha256 =>
  hash(null, canonicalEgressJson(record));
const sameCanonical = (left: unknown, right: unknown): boolean =>
  canonicalEgressJson(left) === canonicalEgressJson(right);

export type EgressOperationState =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'pre-only';
      reservation: EgressReservation;
      preExecutionManifestHash: PrefixedSha256;
    }>
  | Readonly<{
      kind: 'final';
      reservation: EgressReservation;
      preExecutionManifestHash: PrefixedSha256;
      finalizer: EgressFinalizerProjectionV1;
    }>;

export class EgressManifestStore implements EgressManifestPort {
  readonly logPath: string;
  private readonly now: () => number;
  private readonly limits: EgressLimits;
  private readonly records: EgressManifestRecordV1[] = [];
  private readonly preByOperation = new Map<string, EgressManifestRecordV1>();
  private readonly finalByOperation = new Map<string, EgressManifestRecordV1>();
  private readonly pendingFinalReservations = new Set<string>();
  private bytes = 0;
  private activeRows = 0;
  private activeBytes = 0;
  private recovered = false;

  constructor(private readonly options: StoreOptions) {
    this.now = options.now ?? Date.now;
    this.limits = options.limits ?? EGRESS_MANIFEST_LIMITS;
    this.logPath = join(
      options.stateRoot,
      'journal',
      `${actorHash(options.actorId)}.egress-manifests.v1.jsonl`,
    );
  }

  async recover(_now: number): Promise<void> {
    return this.exclusive(() => this.recoverUnlocked(_now), false);
  }

  private async recoverUnlocked(_now: number): Promise<void> {
    await mkdir(join(this.options.stateRoot, 'journal'), { recursive: true });
    let activeBytes = await this.readOrCreateBase();
    let discardPublishedTail = false;
    if (activeBytes.byteLength > this.limits.maxBytesPerActor) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress log exceeds its hard cap');
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
        store: 'egress-manifests',
        actorHash: actorHash(this.options.actorId),
        maxLogBytes: this.limits.maxBytesPerActor,
      });
    } catch (cause) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress immutable generation is invalid', cause);
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
      throw storeError(
        'EGRESS_MANIFEST_CORRUPT',
        'egress generation and active tail exceed their hard cap',
      );
    }
    if (discardPublishedTail) await this.rewriteBase(activeBytes);
    const bytes =
      selected === null
        ? activeBytes
        : Buffer.concat([Buffer.from(selected.logBytes), activeBytes]);
    this.loadRecords(bytes);
    this.bytes = bytes.byteLength;
    this.activeRows = activeBytes.toString('utf8').split('\n').filter(Boolean).length;
    this.activeBytes = activeBytes.byteLength;
    if (
      this.records.length > this.limits.maxRowsPerActor ||
      this.bytes > this.limits.maxBytesPerActor
    ) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress log exceeds its hard cap');
    }
    this.recovered = true;
  }

  async reservePre(
    actorId: `actor1_${string}`,
    requestId: `sfp_req1_${string}`,
    operationId: string,
    manifest: PreExecutionConsentManifest,
  ): Promise<EgressReservation> {
    return this.exclusive(() => this.reservePreUnlocked(actorId, requestId, operationId, manifest));
  }

  private async reservePreUnlocked(
    actorId: `actor1_${string}`,
    requestId: `sfp_req1_${string}`,
    operationId: string,
    manifest: PreExecutionConsentManifest,
  ): Promise<EgressReservation> {
    this.assertReady(actorId);
    if (!verifyEgressManifestHash(manifest)) {
      throw storeError('EGRESS_MANIFEST_INVALID', 'pre-execution manifest hash is invalid');
    }
    const existing = this.preByOperation.get(operationId);
    if (existing !== undefined) {
      if (existing.requestId !== requestId || !sameCanonical(existing.manifest, manifest)) {
        throw storeError('EGRESS_MANIFEST_CONFLICT', 'operation has a different pre-manifest');
      }
      return this.reservation(requestId, operationId, manifest.manifestHash);
    }
    const projected = this.createRecord(requestId, operationId, 'pre-execution', manifest);
    const serializedBytes = Buffer.byteLength(`${canonicalEgressJson(projected)}\n`, 'utf8');
    if (
      this.records.length + this.pendingFinalReservations.size + 2 > this.limits.maxRowsPerActor ||
      this.bytes +
        this.pendingFinalReservations.size * this.limits.maxRowBytes +
        serializedBytes +
        this.limits.maxRowBytes >
        this.limits.maxBytesPerActor
    ) {
      throw storeError('EGRESS_MANIFEST_CAPACITY_EXCEEDED', 'egress manifest capacity is full');
    }
    await this.appendAndFsync(projected);
    this.preByOperation.set(operationId, projected);
    this.pendingFinalReservations.add(operationId);
    return this.reservation(requestId, operationId, manifest.manifestHash);
  }

  async finalize(
    reservation: EgressReservation,
    manifest: EgressFinalManifest,
  ): Promise<{ finalManifestHash: PrefixedSha256; finalized: true }> {
    return this.exclusive(() => this.finalizeUnlocked(reservation, manifest));
  }

  private async finalizeUnlocked(
    reservation: EgressReservation,
    manifest: EgressFinalManifest,
  ): Promise<{ finalManifestHash: PrefixedSha256; finalized: true }> {
    this.assertReady(reservation.actorId);
    const existing = this.finalByOperation.get(reservation.operationId);
    if (existing !== undefined) {
      if (!sameCanonical(existing.manifest, manifest)) {
        throw storeError('EGRESS_FINALIZER_CONFLICT', 'operation already has another finalizer');
      }
      return { finalManifestHash: existing.manifestHash, finalized: true };
    }
    const pre = this.preByOperation.get(reservation.operationId);
    if (
      pre === undefined ||
      pre.requestId !== reservation.requestId ||
      pre.manifestHash !== reservation.preManifestHash ||
      manifest.preExecutionManifestHash !== reservation.preManifestHash ||
      !this.pendingFinalReservations.has(reservation.operationId)
    ) {
      throw storeError('EGRESS_RESERVATION_INVALID', 'egress reservation does not match preflight');
    }
    if (!verifyEgressManifestHash(manifest)) {
      throw storeError('EGRESS_MANIFEST_INVALID', 'egress finalizer hash is invalid');
    }
    const kind =
      manifest.finalStatus === 'output'
        ? 'output'
        : manifest.finalStatus === 'no-output'
          ? 'no-output'
          : 'outcome-unknown';
    const record = this.createRecord(
      reservation.requestId,
      reservation.operationId,
      kind,
      manifest,
    );
    await this.appendAndFsync(record);
    this.finalByOperation.set(reservation.operationId, record);
    this.pendingFinalReservations.delete(reservation.operationId);
    return { finalManifestHash: manifest.manifestHash, finalized: true };
  }

  async readVerifiedFinalizer(
    actorId: `actor1_${string}`,
    operationId: string,
    expectedHash: PrefixedSha256 | null,
  ): Promise<Readonly<EgressFinalizerProjectionV1> | null> {
    return this.exclusive(() =>
      this.readVerifiedFinalizerUnlocked(actorId, operationId, expectedHash),
    );
  }

  async hasFinalizer(actorId: `actor1_${string}`, operationId: string): Promise<boolean> {
    return this.exclusive(async () => {
      this.assertReady(actorId);
      return this.finalByOperation.has(operationId);
    });
  }

  async classifyOperationState(
    actorId: `actor1_${string}`,
    operationId: string,
  ): Promise<EgressOperationState> {
    return this.exclusive(async () => {
      this.assertReady(actorId);
      const pre = this.preByOperation.get(operationId);
      const final = this.finalByOperation.get(operationId);
      if (pre === undefined) {
        if (final !== undefined) {
          throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress finalizer has no pre-manifest');
        }
        return Object.freeze({ kind: 'absent' });
      }
      const reservation = this.reservation(pre.requestId, operationId, pre.manifestHash);
      if (final === undefined) {
        return Object.freeze({
          kind: 'pre-only',
          reservation,
          preExecutionManifestHash: pre.manifestHash,
        });
      }
      const manifest = final.manifest as EgressFinalManifest;
      if (!verifyEgressManifestHash(manifest)) {
        throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress finalizer hash is invalid');
      }
      return Object.freeze({
        kind: 'final',
        reservation,
        preExecutionManifestHash: pre.manifestHash,
        finalizer: Object.freeze({
          finalStatus: manifest.finalStatus,
          manifestHash: manifest.manifestHash,
          preExecutionManifestHash: manifest.preExecutionManifestHash,
          resultHash: manifest.finalStatus === 'output' ? manifest.resultHash : null,
          reasonCode: manifest.finalStatus === 'output' ? null : manifest.reasonCode,
        }),
      });
    });
  }

  private async readVerifiedFinalizerUnlocked(
    actorId: `actor1_${string}`,
    operationId: string,
    expectedHash: PrefixedSha256 | null,
  ): Promise<Readonly<EgressFinalizerProjectionV1> | null> {
    this.assertReady(actorId);
    if (expectedHash === null) return null;
    const row = this.finalByOperation.get(operationId);
    if (row === undefined || row.manifestHash !== expectedHash) {
      throw storeError('EGRESS_FINALIZER_MISSING', 'matching egress finalizer was not found');
    }
    const manifest = row.manifest as EgressFinalManifest;
    if (!verifyEgressManifestHash(manifest)) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress finalizer hash is invalid');
    }
    return Object.freeze({
      finalStatus: manifest.finalStatus,
      manifestHash: manifest.manifestHash,
      preExecutionManifestHash: manifest.preExecutionManifestHash,
      resultHash: manifest.finalStatus === 'output' ? manifest.resultHash : null,
      reasonCode: manifest.finalStatus === 'output' ? null : manifest.reasonCode,
    });
  }

  async compact(
    input: { now: number; linkedAt(operationId: string): number | null } = {
      now: this.now(),
      linkedAt: () => null,
    },
  ): Promise<void> {
    return this.exclusive(() => this.compactUnlocked(input));
  }

  private async compactUnlocked(input: {
    now: number;
    linkedAt(operationId: string): number | null;
  }): Promise<void> {
    this.assertReady(this.options.actorId);
    const retentionMs = this.limits.retentionDays * 86_400_000;
    const expired = new Set<string>();
    for (const operationId of this.finalByOperation.keys()) {
      const linkedAt = input.linkedAt(operationId);
      if (linkedAt !== null && input.now - linkedAt >= retentionMs) expired.add(operationId);
    }
    const retained = this.rechain(this.records.filter(record => !expired.has(record.operationId)));
    const logBytes = Buffer.from(
      retained.map(record => `${canonicalEgressJson(record)}\n`).join(''),
      'utf8',
    );
    const baseTailBytes = await readFileWithinLimit(this.logPath, this.limits.maxBytesPerActor);
    try {
      await publishImmutableGeneration({
        basePath: this.logPath,
        store: 'egress-manifests',
        actorHash: actorHash(this.options.actorId),
        logBytes,
        rows: retained.length,
        sequence: retained.at(-1)?.sequence ?? 0,
        previousRecordHash: retained.at(-1)?.recordHash ?? null,
        firstRetainedRecordHash: retained.at(0)?.recordHash ?? null,
        baseTailBytes,
        now: input.now,
        ...(this.options.compactionHook === undefined ? {} : { hook: this.options.compactionHook }),
      });
    } catch (error) {
      if (
        (error as { code?: unknown; committed?: unknown }).code ===
          'IMMUTABLE_GENERATION_COMMIT_OUTCOME_UNKNOWN' &&
        (error as { committed?: unknown }).committed === true
      ) {
        this.recovered = false;
        try {
          await this.recoverUnlocked(input.now);
        } catch (recoveryError) {
          throw Object.assign(
            new AggregateError(
              [error, recoveryError],
              'committed egress compaction recovery failed',
            ),
            { code: 'IMMUTABLE_GENERATION_RECOVERY_FAILED', committed: true },
          );
        }
      }
      throw error;
    }
    this.records.length = 0;
    this.records.push(...retained);
    this.rebuildIndexes();
    this.bytes = logBytes.byteLength;
    this.activeRows = 0;
    this.activeBytes = 0;
  }

  async flush(): Promise<void> {
    return this.exclusive(() => this.flushUnlocked());
  }

  private async flushUnlocked(): Promise<void> {
    const handle = await open(this.logPath, 'a');
    await handle.sync();
    await handle.close();
  }

  private async readOrCreateBase(): Promise<Buffer> {
    try {
      return await readFileWithinLimit(this.logPath, this.limits.maxBytesPerActor);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress log cannot be read', cause);
      }
      const handle = await open(this.logPath, 'wx', 0o600);
      await handle.sync();
      await handle.close();
      return Buffer.alloc(0);
    }
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

  private loadRecords(bytes: Buffer): void {
    this.records.length = 0;
    let previousRecordHash: PrefixedSha256 | null = null;
    for (const [index, line] of bytes.toString('utf8').split('\n').filter(Boolean).entries()) {
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(line) as unknown;
      } catch (cause) {
        throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress log contains malformed JSON', cause);
      }
      const record = this.verifyRecord(untrusted, index + 1, previousRecordHash);
      this.records.push(record);
      previousRecordHash = record.recordHash;
    }
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.preByOperation.clear();
    this.finalByOperation.clear();
    this.pendingFinalReservations.clear();
    for (const record of this.records) {
      if (record.kind === 'pre-execution') {
        if (this.preByOperation.has(record.operationId)) {
          throw storeError('EGRESS_MANIFEST_CORRUPT', 'duplicate egress pre-manifest');
        }
        this.preByOperation.set(record.operationId, record);
      } else {
        if (
          !this.preByOperation.has(record.operationId) ||
          this.finalByOperation.has(record.operationId)
        ) {
          throw storeError('EGRESS_MANIFEST_CORRUPT', 'orphan or duplicate egress finalizer');
        }
        this.finalByOperation.set(record.operationId, record);
      }
    }
    for (const operationId of this.preByOperation.keys()) {
      if (!this.finalByOperation.has(operationId)) this.pendingFinalReservations.add(operationId);
    }
  }

  private rechain(records: readonly EgressManifestRecordV1[]): EgressManifestRecordV1[] {
    let previousRecordHash: PrefixedSha256 | null = null;
    return records.map((record, index) => {
      const withoutHash = {
        schemaVersion: 1 as const,
        requestId: record.requestId,
        operationId: record.operationId,
        sequence: index + 1,
        kind: record.kind,
        createdAt: record.createdAt,
        previousRecordHash,
        manifestHash: record.manifestHash,
        manifest: record.manifest,
      };
      const next = Object.freeze({ ...withoutHash, recordHash: recordHash(withoutHash) });
      previousRecordHash = next.recordHash;
      return next;
    });
  }

  private reservation(
    requestId: `sfp_req1_${string}`,
    operationId: string,
    preManifestHash: PrefixedSha256,
  ): EgressReservation {
    return Object.freeze({
      actorId: this.options.actorId,
      requestId,
      operationId,
      leaderGeneration: this.options.leaderGeneration ?? 'unknown',
      preManifestHash,
      reservedOutputBytes: EGRESS_MANIFEST_LIMITS.maxRowBytes,
    });
  }

  private createRecord(
    requestId: `sfp_req1_${string}`,
    operationId: string,
    kind: EgressManifestRecordV1['kind'],
    manifest: PreExecutionConsentManifest | EgressFinalManifest,
  ): EgressManifestRecordV1 {
    const withoutHash = {
      schemaVersion: 1 as const,
      requestId,
      operationId,
      sequence: this.records.length + 1,
      kind,
      createdAt: new Date(this.now()).toISOString(),
      previousRecordHash: this.records.at(-1)?.recordHash ?? null,
      manifestHash: manifest.manifestHash,
      manifest,
    };
    return Object.freeze({ ...withoutHash, recordHash: recordHash(withoutHash) });
  }

  private async appendAndFsync(record: EgressManifestRecordV1): Promise<void> {
    const serialized = `${canonicalEgressJson(record)}\n`;
    const rowBytes = Buffer.byteLength(serialized, 'utf8');
    if (rowBytes > this.limits.maxRowBytes) {
      throw storeError('EGRESS_MANIFEST_ROW_TOO_LARGE', 'egress row exceeds its cap');
    }
    const handle = await open(this.logPath, 'a');
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.records.push(record);
    this.bytes += rowBytes;
    this.activeRows += 1;
    this.activeBytes += rowBytes;
    if (
      this.activeRows >= this.limits.compactAtRows ||
      this.activeBytes >= this.limits.compactAtBytes
    ) {
      await this.compactUnlocked({ now: this.now(), linkedAt: () => null });
    }
  }

  private verifyRecord(
    value: unknown,
    sequence: number,
    previousRecordHash: PrefixedSha256 | null,
  ): EgressManifestRecordV1 {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress record is not an object');
    }
    const record = value as EgressManifestRecordV1;
    const expectedKeys = [
      'schemaVersion',
      'requestId',
      'operationId',
      'sequence',
      'kind',
      'createdAt',
      'previousRecordHash',
      'manifestHash',
      'recordHash',
      'manifest',
    ].toSorted();
    const { recordHash: observedHash, ...withoutHash } = record;
    if (
      JSON.stringify(Object.keys(record).toSorted()) !== JSON.stringify(expectedKeys) ||
      record.schemaVersion !== 1 ||
      record.sequence !== sequence ||
      record.previousRecordHash !== previousRecordHash ||
      record.manifestHash !== record.manifest?.manifestHash ||
      !verifyEgressManifestHash(record.manifest) ||
      observedHash !== recordHash(withoutHash) ||
      (record.kind === 'pre-execution') !== !('finalStatus' in record.manifest) ||
      (record.kind !== 'pre-execution' &&
        record.kind !== (record.manifest as EgressFinalManifest).finalStatus)
    ) {
      throw storeError('EGRESS_MANIFEST_CORRUPT', 'egress record hash or linkage is invalid');
    }
    return Object.freeze(record);
  }

  private assertReady(actorId: string): void {
    if (!this.recovered) {
      throw storeError('EGRESS_MANIFEST_NOT_RECOVERED', 'egress store is not recovered');
    }
    if (actorId !== this.options.actorId) {
      throw storeError('EGRESS_ACTOR_MISMATCH', 'egress actor does not match store');
    }
  }

  private async exclusive<T>(operation: () => Promise<T>, refresh = true): Promise<T> {
    return withCanonicalPathMutex(resolve(this.logPath), async () => {
      if (refresh && this.recovered) await this.recoverUnlocked(this.now());
      return operation();
    });
  }
}
