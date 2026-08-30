import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  JOURNAL_LIMITS,
  parseOperationResolutionRecord,
  type OperationResolutionRecord,
  type PrefixedSha256,
} from '@sfp/shared';

export interface OperationResolutionIntentStoreOptions {
  stateRoot: string;
  actorId: OperationResolutionRecord['actorId'];
  maximumBytes?: number;
  now?: () => number;
}

interface DurableResolutionIntentRowV1 {
  schemaVersion: 1;
  record: OperationResolutionRecord;
  previousRecordHash: PrefixedSha256 | null;
  recordHash: PrefixedSha256;
}

const zero = Buffer.from([0]);
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
  if (encoded === undefined) throw new Error('resolution value is not JSON serializable');
  return encoded;
};
const hash = (domain: string, value: string): PrefixedSha256 =>
  `sha256:${createHash('sha256').update(domain, 'utf8').update(zero).update(value).digest('hex')}`;
const actorFilenameHash = (actorId: string): string =>
  hash('sfp-journal-actor-filename-v1', actorId).slice('sha256:'.length);
const fingerprintHash = (record: OperationResolutionRecord): PrefixedSha256 =>
  hash(
    'sfp-operation-fingerprint-v1',
    JSON.stringify({
      actorId: record.actorId,
      operationId: record.operationId,
      operationKind: record.operationKind,
      operationName: record.operationName,
      argsHash: record.argsHash,
      workspaceId: record.workspaceId,
      fileExecutionKeyHash: record.fileExecutionKeyHash,
      targetBindingHash: record.targetBindingHash,
      captureIntentHash: record.captureIntentHash,
    }),
  );
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class ResolutionReserveFullError extends Error {
  readonly code = 'RESOLUTION_RESERVE_FULL';
  readonly manualExportCommand = 'sfp operations unresolved --json';

  constructor() {
    super('manual resolution reserve is full');
    this.name = 'ResolutionReserveFullError';
  }
}

export class ResolutionIntentError extends Error {
  constructor(
    readonly code:
      | 'RESOLUTION_INTENT_INVALID'
      | 'RESOLUTION_INTENT_CORRUPT'
      | 'OPERATION_ID_CONFLICT',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ResolutionIntentError';
  }
}

export class OperationResolutionIntentStore {
  readonly path: string;
  private readonly maximumBytes: number;
  private readonly records = new Map<string, OperationResolutionRecord>();
  private previousRecordHash: PrefixedSha256 | null = null;
  private bytes = 0;
  private readonly now: () => number;
  private recovered = false;
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly options: OperationResolutionIntentStoreOptions) {
    this.maximumBytes = options.maximumBytes ?? JOURNAL_LIMITS.resolutionReserveBytesPerActor;
    this.path = join(
      options.stateRoot,
      'journal',
      `${actorFilenameHash(options.actorId)}.resolution-intents.v1.jsonl`,
    );
    this.now = options.now ?? Date.now;
  }

  get(operationId: string): OperationResolutionRecord | undefined {
    return this.records.get(operationId);
  }

  list(options: { limit?: number } = {}): readonly OperationResolutionRecord[] {
    const limit = options.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_INVALID',
        'resolution list limit is invalid',
      );
    }
    return [...this.records.values()]
      .toSorted((left, right) =>
        left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
      )
      .slice(0, limit);
  }

  async releaseMerged(
    operationId: string,
    operationFingerprintHash: PrefixedSha256,
  ): Promise<void> {
    return this.exclusive(async () => {
      if (!this.recovered) await this.recoverUnlocked();
      const record = this.records.get(operationId);
      if (record === undefined || record.operationFingerprintHash !== operationFingerprintHash) {
        throw new ResolutionIntentError(
          'OPERATION_ID_CONFLICT',
          'resolution release does not match the merged tombstone',
        );
      }
      this.records.delete(operationId);
      await this.rewriteRecordsUnlocked();
    });
  }

  async purgeExpired(now = this.now()): Promise<number> {
    return this.exclusive(async () => {
      if (!this.recovered) await this.recoverUnlocked();
      let removed = 0;
      for (const [operationId, record] of this.records) {
        if (now < record.issuedAt + 2_592_000_000) continue;
        this.records.delete(operationId);
        removed += 1;
      }
      if (removed > 0) await this.rewriteRecordsUnlocked();
      return removed;
    });
  }

  async recover(): Promise<void> {
    await this.exclusive(() => this.recoverUnlocked());
  }

  async appendAndFsync(record: OperationResolutionRecord): Promise<void> {
    return this.exclusive(async () => {
      if (!this.recovered) await this.recoverUnlocked();
      await this.purgeExpiredUnlocked();
      const validated = this.validate(record, false);
      if (this.records.has(validated.operationId)) {
        throw new ResolutionIntentError(
          'OPERATION_ID_CONFLICT',
          'operation already has a resolution intent',
        );
      }
      const rowWithoutHash = {
        schemaVersion: 1 as const,
        record: validated,
        previousRecordHash: this.previousRecordHash,
      };
      const recordHash = hash(
        'sfp-operation-resolution-intent-row-v1',
        canonicalJson(rowWithoutHash),
      );
      const serialized = `${canonicalJson({ ...rowWithoutHash, recordHash })}\n`;
      const rowBytes = Buffer.byteLength(serialized, 'utf8');
      if (this.bytes + rowBytes > this.maximumBytes) throw new ResolutionReserveFullError();
      await mkdir(dirname(this.path), { recursive: true });
      const handle = await open(this.path, 'a');
      try {
        await handle.write(serialized, undefined, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncDirectory();
      this.records.set(validated.operationId, validated);
      this.previousRecordHash = recordHash;
      this.bytes += rowBytes;
    });
  }

  private async recoverUnlocked(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const contents = await readFile(this.path).catch((error: unknown) => {
      if (isMissing(error)) return Buffer.alloc(0);
      throw error;
    });
    if (contents.byteLength > this.maximumBytes) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_CORRUPT',
        'resolution reserve exceeds its hard byte cap',
      );
    }
    this.records.clear();
    this.previousRecordHash = null;
    this.bytes = 0;
    let validBytes = 0;
    const completeLength = contents.lastIndexOf(0x0a) + 1;
    const lines = contents.subarray(0, completeLength).toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const row = this.parseRow(line, this.previousRecordHash);
      if (this.records.has(row.record.operationId)) {
        throw new ResolutionIntentError(
          'RESOLUTION_INTENT_CORRUPT',
          'resolution reserve contains a duplicate operation',
        );
      }
      this.records.set(row.record.operationId, row.record);
      this.previousRecordHash = row.recordHash;
      const rowBytes = Buffer.byteLength(line, 'utf8') + 1;
      this.bytes += rowBytes;
      validBytes += rowBytes;
    }
    if (completeLength !== contents.byteLength) {
      const tail = contents.subarray(completeLength);
      try {
        JSON.parse(tail.toString('utf8'));
        throw new ResolutionIntentError(
          'RESOLUTION_INTENT_CORRUPT',
          'resolution reserve has a complete row without LF',
        );
      } catch (error) {
        if (error instanceof ResolutionIntentError) throw error;
        await this.rewrite(contents.subarray(0, validBytes));
      }
    } else if (contents.byteLength === 0) {
      const handle = await open(this.path, 'a');
      await handle.sync();
      await handle.close();
      await this.syncDirectory();
    }
    this.recovered = true;
    await this.purgeExpiredUnlocked();
  }

  private async purgeExpiredUnlocked(now = this.now()): Promise<number> {
    let removed = 0;
    for (const [operationId, record] of this.records) {
      if (now < record.issuedAt + 2_592_000_000) continue;
      this.records.delete(operationId);
      removed += 1;
    }
    if (removed > 0) await this.rewriteRecordsUnlocked();
    return removed;
  }

  private async rewriteRecordsUnlocked(): Promise<void> {
    let previous: PrefixedSha256 | null = null;
    const lines: string[] = [];
    for (const record of this.records.values()) {
      const rowWithoutHash = {
        schemaVersion: 1 as const,
        record,
        previousRecordHash: previous,
      };
      const recordHash = hash(
        'sfp-operation-resolution-intent-row-v1',
        canonicalJson(rowWithoutHash),
      );
      lines.push(canonicalJson({ ...rowWithoutHash, recordHash }));
      previous = recordHash;
    }
    const serialized = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    await this.rewrite(Buffer.from(serialized, 'utf8'));
    this.previousRecordHash = previous;
    this.bytes = Buffer.byteLength(serialized, 'utf8');
  }

  private parseRow(
    line: string,
    expectedPrevious: PrefixedSha256 | null,
  ): DurableResolutionIntentRowV1 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_CORRUPT',
        'resolution reserve row is invalid JSON',
        { cause: error },
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      JSON.stringify(Object.keys(parsed).toSorted()) !==
        JSON.stringify(['previousRecordHash', 'record', 'recordHash', 'schemaVersion'])
    ) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_CORRUPT',
        'resolution reserve row does not match its closed schema',
      );
    }
    const row = parsed as DurableResolutionIntentRowV1;
    if (
      row.schemaVersion !== 1 ||
      row.previousRecordHash !== expectedPrevious ||
      !/^sha256:[0-9a-f]{64}$/.test(String(row.recordHash))
    ) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_CORRUPT',
        'resolution reserve row linkage is invalid',
      );
    }
    const calculated = hash(
      'sfp-operation-resolution-intent-row-v1',
      canonicalJson({
        schemaVersion: row.schemaVersion,
        record: row.record,
        previousRecordHash: row.previousRecordHash,
      }),
    );
    if (calculated !== row.recordHash) {
      throw new ResolutionIntentError(
        'RESOLUTION_INTENT_CORRUPT',
        'resolution reserve row hash is invalid',
      );
    }
    return { ...row, record: this.validate(row.record, true) };
  }

  private validate(record: unknown, loading: boolean): OperationResolutionRecord {
    try {
      const parsed = parseOperationResolutionRecord(record);
      if (
        parsed.actorId !== this.options.actorId ||
        parsed.originAuthSessionId !== parsed.origin.authSessionId ||
        fingerprintHash(parsed) !== parsed.operationFingerprintHash
      ) {
        throw new Error('resolution provenance mismatch');
      }
      return Object.freeze({ ...parsed, origin: Object.freeze({ ...parsed.origin }) });
    } catch (error) {
      throw new ResolutionIntentError(
        loading ? 'RESOLUTION_INTENT_CORRUPT' : 'RESOLUTION_INTENT_INVALID',
        'resolution intent does not match its closed schema',
        { cause: error },
      );
    }
  }

  private async rewrite(contents: Uint8Array): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, contents);
    const handle = await open(temporary, 'r+');
    await handle.sync();
    await handle.close();
    await rename(temporary, this.path);
    await this.syncDirectory();
  }

  private async syncDirectory(): Promise<void> {
    const directory = await open(dirname(this.path), 'r');
    try {
      await directory.sync().catch((error: NodeJS.ErrnoException) => {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      });
    } finally {
      await directory.close();
    }
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
