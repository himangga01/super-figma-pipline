import {
  createHash,
  createHmac,
  randomUUID,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  ADMIN_AUDIT_LIMITS,
  DEFAULT_EGRESS_CONFIG_V1,
  EXTERNAL_MODEL_DATA_CLASSES,
  type AdminAuditAppendV1,
  type AdminAuditPublicRecordV1,
  type AdminAuditQueryResultV1,
  type AdminAuditRecordV1,
  type EgressConfigLoadResult,
  type PrefixedSha256,
} from '@sfp/shared';

export interface AdminAuditStoreOptions {
  stateRoot: string;
  cursorKey?: Uint8Array;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  maximumRows?: number;
  maximumBytes?: number;
  compactAtRows?: number;
  compactAtBytes?: number;
  retentionMs?: number;
  publicationHook?:
    | ((event: {
        kind: 'genesis' | 'append' | 'compaction';
        step:
          | 'temp-log-fsync'
          | 'temp-checkpoint-fsync'
          | 'temp-anchor-fsync'
          | 'link-log'
          | 'link-checkpoint'
          | 'link-anchor'
          | 'directory-fsync-before-pointer'
          | 'pointer-replace'
          | 'directory-fsync-after-pointer'
          | 'temp-cleanup';
      }) => Promise<void>)
    | undefined;
}

interface Reservation {
  handle: string;
  actorId: `actor1_${string}`;
  transactionId: `sfp_atx1_${string}`;
  remainingRows: number;
  remainingBytes: number;
  released: boolean;
  common: string | null;
  lastStage: AdminAuditRecordV1['stage'] | null;
}
interface ActorState {
  actorId: `actor1_${string}`;
  actorHash: string;
  basePath: string;
  path: string;
  checkpointPath: string;
  anchorPath: string;
  currentPath: string;
  rows: AdminAuditRecordV1[];
  rowBytes: number[];
  bytes: number;
  previousRecordHash: PrefixedSha256 | null;
  checkpointContentHash: PrefixedSha256;
  anchorContentHash: PrefixedSha256;
  compactionId: string;
  sequence: number;
  durableRows: number;
  durableBytes: number;
  durablePreviousRecordHash: PrefixedSha256 | null;
  lastCompactedSequence: number;
  compactedRowsBaseline: number;
  compactedBytesBaseline: number;
  loaded: boolean;
}

export class AdminAuditError extends Error {
  constructor(
    readonly code:
      | 'ADMIN_AUDIT_CAPACITY_EXCEEDED'
      | 'ADMIN_AUDIT_CORRUPT'
      | 'ADMIN_AUDIT_CURSOR_INVALID'
      | 'ADMIN_AUDIT_RESERVATION_INVALID'
      | 'ADMIN_AUDIT_ROW_INVALID',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AdminAuditError';
  }
}

const zero = Uint8Array.of(0);
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
  if (encoded === undefined) throw new Error('audit value is not JSON serializable');
  return encoded;
};
const hash = (...parts: readonly (string | Uint8Array)[]): PrefixedSha256 => {
  const digest = createHash('sha256');
  for (const part of parts) digest.update(part);
  return `sha256:${digest.digest('hex')}`;
};
const digest64 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
const generationPaths = (basePath: string, compactionId: string) => ({
  log: `${basePath}.compact-${compactionId}.jsonl`,
  checkpoint: `${basePath}.compact-${compactionId}.checkpoint.json`,
  anchor: `${basePath}.compact-${compactionId}.anchor.json`,
});
const actorFilenameHash = (actorId: string): string =>
  hash('sfp-journal-actor-filename-v1', zero, actorId).slice('sha256:'.length);
const nullableHashBytes = (value: PrefixedSha256 | null): Uint8Array =>
  value === null ? Uint8Array.of(0) : Uint8Array.from([1, ...Buffer.from(value, 'ascii')]);
const contentHashFor = (
  record: Omit<AdminAuditRecordV1, 'contentHash' | 'recordHash' | 'previousRecordHash'>,
): PrefixedSha256 => hash('sfp-admin-audit-content-v1', zero, canonicalJson(record));
const recordHashFor = (
  contentHash: PrefixedSha256,
  previousRecordHash: PrefixedSha256 | null,
): PrefixedSha256 =>
  hash('sfp-admin-audit-record-v1', zero, contentHash, nullableHashBytes(previousRecordHash));
const isHash = (value: unknown): value is PrefixedSha256 =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
const isActorId = (value: unknown): value is `actor1_${string}` =>
  typeof value === 'string' && /^actor1_[A-Za-z0-9_-]{43}$/u.test(value);
const isAuthId = (value: unknown): value is `auth1_${string}` =>
  typeof value === 'string' && /^auth1_[A-Za-z0-9_-]{43}$/u.test(value);
const isTransactionId = (value: unknown): value is `sfp_atx1_${string}` =>
  typeof value === 'string' && /^sfp_atx1_[A-Za-z0-9_-]{22}$/u.test(value);
const exactIso = (value: unknown): value is string =>
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());

const stageValid = (record: AdminAuditAppendV1): boolean => {
  if (
    record.schemaVersion !== 1 ||
    record.kind !== 'egress' ||
    !isActorId(record.actorId) ||
    !isAuthId(record.authSessionId) ||
    !isTransactionId(record.auditTransactionId) ||
    !['egress.configure', 'egress.reset'].includes(record.action) ||
    !isHash(record.actionNonceClaimHash) ||
    !isHash(record.requestHash) ||
    !isHash(record.expectedConfigHash) ||
    !exactIso(record.createdAt) ||
    !(record.expiresAt === null || exactIso(record.expiresAt)) ||
    new Set(record.allowedClasses).size !== record.allowedClasses.length ||
    JSON.stringify(record.allowedClasses) !==
      JSON.stringify(
        EXTERNAL_MODEL_DATA_CLASSES.filter(value => record.allowedClasses.includes(value)),
      ) ||
    record.allowedClasses.some(
      value => !['public', 'project-code', 'design-text', 'design-image'].includes(value),
    ) ||
    (record.action === 'egress.configure'
      ? record.allowedClasses.length === 0 || record.expiresAt === null
      : record.allowedClasses.length !== 0 || record.expiresAt !== null)
  ) {
    return false;
  }
  if (record.stage === 'pending') {
    return record.desiredConfigHash === null && record.configHash === null;
  }
  if (record.stage === 'cas-intent') {
    return isHash(record.desiredConfigHash) && record.configHash === null;
  }
  if (record.stage === 'committed' || record.stage === 'recovered') {
    return isHash(record.desiredConfigHash) && record.configHash === record.desiredConfigHash;
  }
  return (
    record.stage === 'aborted' &&
    (record.desiredConfigHash === null || isHash(record.desiredConfigHash)) &&
    record.configHash === record.expectedConfigHash &&
    typeof record.abortReason === 'string' &&
    record.abortReason.length >= 1 &&
    Buffer.byteLength(record.abortReason, 'utf8') <= 256
  );
};

const commonProjection = (record: AdminAuditAppendV1): string =>
  canonicalJson({
    schemaVersion: record.schemaVersion,
    auditTransactionId: record.auditTransactionId,
    kind: record.kind,
    actorId: record.actorId,
    authSessionId: record.authSessionId,
    action: record.action,
    actionNonceClaimHash: record.actionNonceClaimHash,
    requestHash: record.requestHash,
    expectedConfigHash: record.expectedConfigHash,
    allowedClasses: record.allowedClasses,
    expiresAt: record.expiresAt,
  });
const stageAllowed = (
  previous: AdminAuditRecordV1['stage'] | null,
  next: AdminAuditRecordV1['stage'],
): boolean =>
  previous === null
    ? next === 'pending'
    : previous === 'pending'
      ? next === 'cas-intent' || next === 'aborted'
      : previous === 'cas-intent'
        ? next === 'committed' || next === 'recovered' || next === 'aborted'
        : false;

const syncDirectory = async (path: string): Promise<void> => {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const writeAndFsyncFile = async (path: string, contents: string): Promise<void> => {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== 'win32') await chmod(path, 0o600);
};

const projectPublic = (record: AdminAuditRecordV1): AdminAuditPublicRecordV1 => {
  const common = {
    schemaVersion: record.schemaVersion,
    auditId: record.auditId,
    auditTransactionId: record.auditTransactionId,
    kind: record.kind,
    stage: record.stage,
    action: record.action,
    actionNonceClaimHash: record.actionNonceClaimHash,
    requestHash: record.requestHash,
    expectedConfigHash: record.expectedConfigHash,
    desiredConfigHash: record.desiredConfigHash,
    configHash: record.configHash,
    allowedClasses: Object.freeze([...record.allowedClasses]),
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    recordHash: record.recordHash,
  };
  return Object.freeze(
    record.stage === 'aborted' ? { ...common, abortReason: record.abortReason } : common,
  ) as AdminAuditPublicRecordV1;
};

export interface AdminAuditStore {
  reserveTransaction(
    actorId: `actor1_${string}`,
    auditTransactionId: `sfp_atx1_${string}`,
  ): Promise<{
    handle: string;
    auditTransactionId: `sfp_atx1_${string}`;
    rows: 4;
    bytes: 131_072;
  }>;
  appendAndFsync(handle: string, record: AdminAuditAppendV1): Promise<Readonly<AdminAuditRecordV1>>;
  queryEgress(
    actorId: `actor1_${string}`,
    input: { since: string | null; cursor: string | null; limit: number },
  ): Promise<Readonly<AdminAuditQueryResultV1>>;
  recover(config: Readonly<EgressConfigLoadResult>): Promise<void>;
  releaseTransaction(handle: string): Promise<void>;
  readonly maxQueryRows: 1000;
  readonly maxQueryBytes: 1_048_576;
}

export const createAdminAuditStore = (options: AdminAuditStoreOptions): AdminAuditStore => {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? (size => systemRandomBytes(size));
  const cursorKey = Uint8Array.from(options.cursorKey ?? randomBytes(32));
  if (cursorKey.byteLength !== 32) throw new Error('admin audit cursor key must be 32 bytes');
  const maximumRows = options.maximumRows ?? ADMIN_AUDIT_LIMITS.maxRowsPerActor;
  const maximumBytes = options.maximumBytes ?? ADMIN_AUDIT_LIMITS.maxBytesPerActor;
  const compactAtRows = options.compactAtRows ?? ADMIN_AUDIT_LIMITS.compactAtRows;
  const compactAtBytes = options.compactAtBytes ?? ADMIN_AUDIT_LIMITS.compactAtBytes;
  const retentionMs = options.retentionMs ?? ADMIN_AUDIT_LIMITS.retentionDays * 86_400_000;
  const states = new Map<string, ActorState>();
  const reservations = new Map<string, Reservation>();
  let mutation = Promise.resolve();

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation);
    mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const cleanupUnselectedPublicationArtifacts = async (
    state: ActorState,
    selectedCompactionId: string,
  ): Promise<void> => {
    const directory = dirname(state.basePath);
    const baseName = basename(state.basePath);
    const generationPrefix = `${baseName}.compact-`;
    const publicationPrefix = `${baseName}.publish-`;
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    const generationName = new RegExp(
      `^(?:${uuid})\\.(?:jsonl|checkpoint\\.json|anchor\\.json)$`,
      'u',
    );
    const publicationName = new RegExp(
      `^[1-9][0-9]*-(?:${uuid})\\.(?:jsonl|checkpoint\\.json|anchor\\.json|current)\\.tmp$`,
      'u',
    );
    const selected = new Set(Object.values(generationPaths(state.basePath, selectedCompactionId)));
    const failCleanup = (cause?: unknown): never => {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'admin audit publication artifacts require manual cleanup',
        cause === undefined ? {} : { cause },
      );
    };
    const names = await readdir(directory);
    const candidates: string[] = [];
    for (const name of names) {
      const generationScoped = name.startsWith(generationPrefix);
      const publicationScoped = name.startsWith(publicationPrefix);
      if (!generationScoped && !publicationScoped) continue;
      if (
        (generationScoped && !generationName.test(name.slice(generationPrefix.length))) ||
        (publicationScoped && !publicationName.test(name.slice(publicationPrefix.length)))
      ) {
        failCleanup();
      }
      const path = join(directory, name);
      if (!selected.has(path)) candidates.push(path);
    }
    const candidateSet = new Set(candidates);

    const { directoryIdentity, identities } = await (async () => ({
      directoryIdentity: await lstat(directory, { bigint: true }),
      identities: await Promise.all(
        [...selected, ...candidates].map(async path => ({
          path,
          stat: await lstat(path, { bigint: true }),
        })),
      ),
    }))().catch(error => failCleanup(error));
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) failCleanup();
    for (const identity of identities) {
      if (!identity.stat.isFile() || identity.stat.isSymbolicLink()) failCleanup();
    }
    const linkCounts = new Map<string, number>();
    for (const identity of identities) {
      const key = `${identity.stat.dev}:${identity.stat.ino}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }
    for (const identity of identities.filter(value => candidateSet.has(value.path))) {
      const key = `${identity.stat.dev}:${identity.stat.ino}`;
      if (BigInt(linkCounts.get(key) ?? 0) !== identity.stat.nlink) failCleanup();
    }
    try {
      const directoryRecheck = await lstat(directory, { bigint: true });
      if (
        directoryRecheck.dev !== directoryIdentity.dev ||
        directoryRecheck.ino !== directoryIdentity.ino ||
        !directoryRecheck.isDirectory() ||
        directoryRecheck.isSymbolicLink()
      ) {
        failCleanup();
      }
      await Promise.all(
        identities
          .filter(value => candidateSet.has(value.path))
          .map(async identity => {
            const recheck = await lstat(identity.path, { bigint: true });
            if (
              recheck.dev !== identity.stat.dev ||
              recheck.ino !== identity.stat.ino ||
              recheck.mode !== identity.stat.mode ||
              recheck.nlink !== identity.stat.nlink ||
              !recheck.isFile() ||
              recheck.isSymbolicLink()
            ) {
              failCleanup();
            }
          }),
      );
      await Promise.all(candidates.map(path => unlink(path)));
    } catch (error) {
      if (error instanceof AdminAuditError) throw error;
      failCleanup(error);
    }
    await syncDirectory(directory);
  };

  const publishGeneration = async (
    state: ActorState,
    kind: 'genesis' | 'append' | 'compaction',
    logSource: { mode: 'append'; suffix: string } | { mode: 'replace'; contents: string },
  ): Promise<void> => {
    const compactionId = randomUUID();
    const generation = generationPaths(state.basePath, compactionId);
    const temporaryStem = `${state.basePath}.publish-${process.pid}-${randomUUID()}`;
    const temporary = {
      log: `${temporaryStem}.jsonl.tmp`,
      checkpoint: `${temporaryStem}.checkpoint.json.tmp`,
      anchor: `${temporaryStem}.anchor.json.tmp`,
      current: `${temporaryStem}.current.tmp`,
    };
    const hook = async (
      step: Parameters<NonNullable<AdminAuditStoreOptions['publicationHook']>>[0]['step'],
    ) => options.publicationHook?.({ kind, step });
    let pointerCommitted = false;
    try {
      if (logSource.mode === 'append') {
        await copyFile(state.path, temporary.log, fsConstants.COPYFILE_FICLONE);
        const logHandle = await open(temporary.log, 'a');
        try {
          await logHandle.write(logSource.suffix, undefined, 'utf8');
          await logHandle.sync();
        } finally {
          await logHandle.close();
        }
      } else {
        await writeAndFsyncFile(temporary.log, logSource.contents);
      }
      if (process.platform !== 'win32') await chmod(temporary.log, 0o600);
      await hook('temp-log-fsync');
      const rawLog = await readFile(temporary.log, 'utf8');

      const createdAt = new Date(now()).toISOString();
      const checkpointBase = {
        schemaVersion: 1,
        store: 'admin-audit',
        actorHash: state.actorHash,
        compactionId,
        sequence: state.sequence,
        rows: state.rows.length,
        bytes: state.bytes,
        previousRecordHash: state.previousRecordHash,
        firstRetainedRecordHash: state.rows[0]?.recordHash ?? null,
        createdAt,
      };
      const checkpointContentHash = hash(
        'sfp-admin-audit-checkpoint-v1',
        zero,
        canonicalJson(checkpointBase),
      );
      const checkpoint = {
        ...checkpointBase,
        checkpointHash: checkpointContentHash,
        contentHash: checkpointContentHash,
      };
      const anchorBase = {
        schemaVersion: 1,
        store: 'admin-audit',
        actorHash: state.actorHash,
        compactionId,
        checkpointHash: checkpointContentHash,
        previousRecordHash: state.previousRecordHash,
        createdAt,
      };
      const anchorContentHash = hash('sfp-admin-audit-anchor-v1', zero, canonicalJson(anchorBase));
      const anchor = {
        ...anchorBase,
        anchorHash: anchorContentHash,
        contentHash: anchorContentHash,
      };
      const current = {
        schemaVersion: 1,
        compactionId,
        logDigest64: digest64(rawLog),
        checkpointHash: checkpointContentHash,
        anchorHash: anchorContentHash,
      };
      await writeAndFsyncFile(temporary.checkpoint, `${canonicalJson(checkpoint)}\n`);
      await hook('temp-checkpoint-fsync');
      await writeAndFsyncFile(temporary.anchor, `${canonicalJson(anchor)}\n`);
      await hook('temp-anchor-fsync');
      await writeAndFsyncFile(temporary.current, `${canonicalJson(current)}\n`);

      await link(temporary.log, generation.log);
      await hook('link-log');
      await link(temporary.checkpoint, generation.checkpoint);
      await hook('link-checkpoint');
      await link(temporary.anchor, generation.anchor);
      await hook('link-anchor');
      await syncDirectory(dirname(state.basePath));
      await hook('directory-fsync-before-pointer');
      await rename(temporary.current, state.currentPath);
      pointerCommitted = true;
      state.path = generation.log;
      state.checkpointPath = generation.checkpoint;
      state.anchorPath = generation.anchor;
      state.compactionId = compactionId;
      state.checkpointContentHash = checkpointContentHash;
      state.anchorContentHash = anchorContentHash;
      state.durableRows = state.rows.length;
      state.durableBytes = state.bytes;
      state.durablePreviousRecordHash = state.previousRecordHash;
      await hook('pointer-replace');
      await syncDirectory(dirname(state.basePath));
      await hook('directory-fsync-after-pointer');
    } finally {
      await Promise.all(
        Object.values(temporary).map(path =>
          unlink(path).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }),
        ),
      );
    }
    await hook('temp-cleanup');
    if (pointerCommitted) {
      await cleanupUnselectedPublicationArtifacts(state, state.compactionId);
    }
  };

  const genesis = async (state: ActorState): Promise<void> => {
    await mkdir(dirname(state.basePath), { recursive: true, mode: 0o700 });
    await publishGeneration(state, 'genesis', { mode: 'replace', contents: '' });
  };

  const loadCheckpointAndAnchor = async (state: ActorState, rawLog: string): Promise<void> => {
    let checkpoint: Record<string, unknown>;
    let anchor: Record<string, unknown>;
    let current: Record<string, unknown>;
    try {
      checkpoint = JSON.parse(await readFile(state.checkpointPath, 'utf8')) as Record<
        string,
        unknown
      >;
      anchor = JSON.parse(await readFile(state.anchorPath, 'utf8')) as Record<string, unknown>;
      current = JSON.parse(await readFile(state.currentPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'admin audit checkpoint or anchor is unreadable',
        { cause: error },
      );
    }
    if (
      !hasExactKeys(checkpoint, [
        'schemaVersion',
        'store',
        'actorHash',
        'compactionId',
        'sequence',
        'rows',
        'bytes',
        'previousRecordHash',
        'firstRetainedRecordHash',
        'checkpointHash',
        'createdAt',
        'contentHash',
      ]) ||
      !hasExactKeys(anchor, [
        'schemaVersion',
        'store',
        'actorHash',
        'compactionId',
        'checkpointHash',
        'previousRecordHash',
        'anchorHash',
        'createdAt',
        'contentHash',
      ]) ||
      !hasExactKeys(current, [
        'schemaVersion',
        'compactionId',
        'logDigest64',
        'checkpointHash',
        'anchorHash',
      ])
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'admin audit checkpoint or anchor schema is invalid',
      );
    }
    const { checkpointHash, contentHash: checkpointContentHash, ...checkpointBase } = checkpoint;
    const calculatedCheckpoint = hash(
      'sfp-admin-audit-checkpoint-v1',
      zero,
      canonicalJson(checkpointBase),
    );
    const { anchorHash, contentHash: anchorContentHash, ...anchorBase } = anchor;
    const calculatedAnchor = hash('sfp-admin-audit-anchor-v1', zero, canonicalJson(anchorBase));
    if (
      checkpoint.schemaVersion !== 1 ||
      checkpoint.store !== 'admin-audit' ||
      checkpoint.actorHash !== state.actorHash ||
      !Number.isSafeInteger(checkpoint.sequence) ||
      !Number.isSafeInteger(checkpoint.rows) ||
      !Number.isSafeInteger(checkpoint.bytes) ||
      checkpointHash !== checkpointContentHash ||
      checkpointHash !== calculatedCheckpoint ||
      anchor.schemaVersion !== 1 ||
      anchor.store !== 'admin-audit' ||
      anchor.actorHash !== state.actorHash ||
      anchor.checkpointHash !== checkpointHash ||
      anchor.previousRecordHash !== checkpoint.previousRecordHash ||
      anchorHash !== anchorContentHash ||
      anchorHash !== calculatedAnchor ||
      !isHash(checkpointHash) ||
      !isHash(anchorHash) ||
      current.schemaVersion !== 1 ||
      current.compactionId !== checkpoint.compactionId ||
      current.compactionId !== anchor.compactionId ||
      current.logDigest64 !== digest64(rawLog) ||
      current.checkpointHash !== checkpointHash ||
      current.anchorHash !== anchorHash
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'admin audit checkpoint or anchor hash is invalid',
      );
    }
    state.checkpointContentHash = checkpointHash;
    state.anchorContentHash = anchorHash;
    state.compactionId = checkpoint.compactionId as string;
    state.sequence = checkpoint.sequence as number;
    state.durableRows = checkpoint.rows as number;
    state.durableBytes = checkpoint.bytes as number;
    state.durablePreviousRecordHash = checkpoint.previousRecordHash as PrefixedSha256 | null;
  };
  const restoreDurableReservations = (state: ActorState): void => {
    const transactionIndexes = new Map<string, number[]>();
    for (let index = 0; index < state.rows.length; index += 1) {
      const row = state.rows[index]!;
      const indexes = transactionIndexes.get(row.auditTransactionId) ?? [];
      indexes.push(index);
      transactionIndexes.set(row.auditTransactionId, indexes);
    }
    let active = 0;
    let reservedRows = 0;
    let reservedBytes = 0;
    for (const [transactionId, indexes] of transactionIndexes) {
      const last = state.rows[indexes.at(-1)!]!;
      if (last.stage !== 'pending' && last.stage !== 'cas-intent') continue;
      const usedRows = indexes.length;
      const usedBytes = indexes.reduce((sum, index) => sum + state.rowBytes[index]!, 0);
      if (usedRows >= 4 || usedBytes >= 131_072) {
        throw new AdminAuditError(
          'ADMIN_AUDIT_CORRUPT',
          'active admin transaction exhausted its durable reservation',
        );
      }
      const remainingRows = 4 - usedRows;
      const remainingBytes = 131_072 - usedBytes;
      const handle = `sfp_ar1_recovered_${digest64(`${state.actorId}\0${transactionId}`).slice(0, 32)}`;
      reservations.set(handle, {
        handle,
        actorId: state.actorId,
        transactionId: transactionId as `sfp_atx1_${string}`,
        remainingRows,
        remainingBytes,
        released: false,
        common: commonProjection(last as AdminAuditAppendV1),
        lastStage: last.stage,
      });
      active += 1;
      reservedRows += remainingRows;
      reservedBytes += remainingBytes;
    }
    if (
      active > ADMIN_AUDIT_LIMITS.maxActiveTransactionsPerActor ||
      state.rows.length + reservedRows > maximumRows ||
      state.bytes + reservedBytes > maximumBytes
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'durable admin reservations exceed configured capacity',
      );
    }
  };
  const stateFor = async (actorId: `actor1_${string}`): Promise<ActorState> => {
    if (!isActorId(actorId)) {
      throw new AdminAuditError('ADMIN_AUDIT_ROW_INVALID', 'admin audit actor id is invalid');
    }
    let state = states.get(actorId);
    if (state === undefined) {
      const actorHash = actorFilenameHash(actorId);
      const base = join(options.stateRoot, 'journal', `${actorHash}.admin-audit.v1`);
      const initialGeneration = generationPaths(base, 'uninitialized');
      state = {
        actorId,
        actorHash,
        basePath: base,
        path: initialGeneration.log,
        checkpointPath: initialGeneration.checkpoint,
        anchorPath: initialGeneration.anchor,
        currentPath: `${base}.current`,
        rows: [],
        rowBytes: [],
        bytes: 0,
        previousRecordHash: null,
        checkpointContentHash: hash('sfp-admin-audit-checkpoint-v1', zero, 'uninitialized'),
        anchorContentHash: hash('sfp-admin-audit-anchor-v1', zero, 'uninitialized'),
        compactionId: 'genesis',
        sequence: 0,
        durableRows: 0,
        durableBytes: 0,
        durablePreviousRecordHash: null,
        lastCompactedSequence: 0,
        compactedRowsBaseline: 0,
        compactedBytesBaseline: 0,
        loaded: false,
      };
      states.set(actorId, state);
    }
    if (state.loaded) return state;
    await mkdir(dirname(state.basePath), { recursive: true, mode: 0o700 });
    let current: unknown;
    try {
      current = JSON.parse(await readFile(state.currentPath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AdminAuditError(
          'ADMIN_AUDIT_CORRUPT',
          'admin audit current pointer is unreadable',
          {
            cause: error,
          },
        );
      }
      await genesis(state);
      state.loaded = true;
      return state;
    }
    if (
      !hasExactKeys(current, [
        'schemaVersion',
        'compactionId',
        'logDigest64',
        'checkpointHash',
        'anchorHash',
      ]) ||
      current.schemaVersion !== 1 ||
      typeof current.compactionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        current.compactionId,
      )
    ) {
      throw new AdminAuditError('ADMIN_AUDIT_CORRUPT', 'admin audit current pointer is invalid');
    }
    const selectedGeneration = generationPaths(state.basePath, current.compactionId);
    state.path = selectedGeneration.log;
    state.checkpointPath = selectedGeneration.checkpoint;
    state.anchorPath = selectedGeneration.anchor;
    let raw: string;
    try {
      raw = await readFile(state.path, 'utf8');
    } catch (error) {
      throw new AdminAuditError('ADMIN_AUDIT_CORRUPT', 'admin audit selected log is unreadable', {
        cause: error,
      });
    }
    await loadCheckpointAndAnchor(state, raw);
    let previous: PrefixedSha256 | null = null;
    for (const line of raw.split('\n').filter(Boolean)) {
      let record: AdminAuditRecordV1;
      try {
        record = JSON.parse(line) as AdminAuditRecordV1;
      } catch (error) {
        throw new AdminAuditError('ADMIN_AUDIT_CORRUPT', 'admin audit row is invalid JSON', {
          cause: error,
        });
      }
      const { contentHash, recordHash, previousRecordHash, ...contentInput } = record;
      const { auditId: _auditId, ...append } = contentInput;
      if (
        !stageValid(append as AdminAuditAppendV1) ||
        record.actorId !== actorId ||
        previousRecordHash !== previous ||
        contentHashFor(contentInput) !== contentHash ||
        recordHashFor(contentHash, previous) !== recordHash
      ) {
        throw new AdminAuditError('ADMIN_AUDIT_CORRUPT', 'admin audit hash chain is invalid');
      }
      const bytes = Buffer.byteLength(line, 'utf8') + 1;
      state.rows.push(record);
      state.rowBytes.push(bytes);
      state.bytes += bytes;
      previous = recordHash;
    }
    state.previousRecordHash = previous;
    if (
      state.rows.length !== state.durableRows ||
      state.bytes !== state.durableBytes ||
      state.previousRecordHash !== state.durablePreviousRecordHash
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CORRUPT',
        'admin audit log suffix does not match its durable checkpoint',
      );
    }
    state.lastCompactedSequence = state.compactionId === 'genesis' ? 0 : state.sequence;
    state.compactedRowsBaseline = state.compactionId === 'genesis' ? 0 : state.rows.length;
    state.compactedBytesBaseline = state.compactionId === 'genesis' ? 0 : state.bytes;
    restoreDurableReservations(state);
    await cleanupUnselectedPublicationArtifacts(state, state.compactionId);
    state.loaded = true;
    return state;
  };

  const compactUnlocked = async (state: ActorState): Promise<void> => {
    const terminalByTransaction = new Map<string, AdminAuditRecordV1>();
    for (const row of state.rows) terminalByTransaction.set(row.auditTransactionId, row);
    const expiredTransactions = new Set(
      [...terminalByTransaction.entries()]
        .filter(([, row]) => {
          if (row.stage === 'pending' || row.stage === 'cas-intent') return false;
          return now() - Date.parse(row.createdAt) >= retentionMs;
        })
        .map(([transactionId]) => transactionId),
    );
    const retained = state.rows.filter(row => !expiredTransactions.has(row.auditTransactionId));
    let previous: PrefixedSha256 | null = null;
    const rechained = retained.map(row => {
      const { previousRecordHash: _previous, recordHash: _recordHash, ...withoutChain } = row;
      const recordHash = recordHashFor(row.contentHash, previous);
      const next = Object.assign({}, withoutChain, {
        previousRecordHash: previous,
        recordHash,
      }) as AdminAuditRecordV1;
      previous = recordHash;
      return next;
    });
    const serializedRows = rechained.map(row => `${canonicalJson(row)}\n`);
    const rawLog = serializedRows.join('');
    const snapshot = {
      rows: [...state.rows],
      rowBytes: [...state.rowBytes],
      bytes: state.bytes,
      previousRecordHash: state.previousRecordHash,
      sequence: state.sequence,
      lastCompactedSequence: state.lastCompactedSequence,
      compactedRowsBaseline: state.compactedRowsBaseline,
      compactedBytesBaseline: state.compactedBytesBaseline,
    };
    state.rows = rechained;
    state.rowBytes = serializedRows.map(row => Buffer.byteLength(row, 'utf8'));
    state.bytes = state.rowBytes.reduce((sum, bytes) => sum + bytes, 0);
    state.previousRecordHash = previous;
    state.sequence += 1;
    state.lastCompactedSequence = state.sequence;
    state.compactedRowsBaseline = state.rows.length;
    state.compactedBytesBaseline = state.bytes;
    const previousGeneration = state.compactionId;
    try {
      await publishGeneration(state, 'compaction', { mode: 'replace', contents: rawLog });
    } catch (error) {
      if (state.compactionId === previousGeneration) Object.assign(state, snapshot);
      throw error;
    }
  };

  const compactIfRequired = async (state: ActorState): Promise<void> => {
    const hasExpiredTerminal = state.rows.some(row => {
      if (row.stage === 'pending' || row.stage === 'cas-intent') return false;
      return now() - Date.parse(row.createdAt) >= retentionMs;
    });
    const rowsSinceCompaction = state.rows.length - state.compactedRowsBaseline;
    const bytesSinceCompaction = state.bytes - state.compactedBytesBaseline;
    if (
      hasExpiredTerminal ||
      rowsSinceCompaction >= compactAtRows ||
      bytesSinceCompaction >= compactAtBytes
    ) {
      await compactUnlocked(state);
    }
  };

  const reserveUnlocked = async (
    actorId: `actor1_${string}`,
    transactionId: `sfp_atx1_${string}`,
  ) => {
    if (!isTransactionId(transactionId)) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_RESERVATION_INVALID',
        'audit transaction id is invalid',
      );
    }
    const state = await stateFor(actorId);
    await compactIfRequired(state);
    const activeForActor = [...reservations.values()].filter(
      value => value.actorId === actorId && !value.released,
    );
    const reservedRows = activeForActor.reduce((sum, value) => sum + value.remainingRows, 0);
    const reservedBytes = activeForActor.reduce((sum, value) => sum + value.remainingBytes, 0);
    if (
      activeForActor.length >= ADMIN_AUDIT_LIMITS.maxActiveTransactionsPerActor ||
      state.rows.length + reservedRows + 4 > maximumRows ||
      state.bytes + reservedBytes + 131_072 > maximumBytes
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CAPACITY_EXCEEDED',
        'admin audit reservation capacity is exhausted',
      );
    }
    const entropy = Uint8Array.from(randomBytes(32));
    if (entropy.byteLength !== 32) throw new Error('admin audit entropy source failed');
    const handle = `sfp_ar1_${Buffer.from(entropy).toString('base64url')}`;
    reservations.set(handle, {
      handle,
      actorId,
      transactionId,
      remainingRows: 4,
      remainingBytes: 131_072,
      released: false,
      common: null,
      lastStage: null,
    });
    return { handle, auditTransactionId: transactionId, rows: 4 as const, bytes: 131_072 as const };
  };

  const appendUnlocked = async (
    handle: string,
    append: AdminAuditAppendV1,
  ): Promise<Readonly<AdminAuditRecordV1>> => {
    const reservation = reservations.get(handle);
    if (
      reservation === undefined ||
      reservation.released ||
      reservation.transactionId !== append.auditTransactionId ||
      reservation.actorId !== append.actorId ||
      reservation.remainingRows < 1 ||
      !stageValid(append) ||
      !stageAllowed(reservation.lastStage, append.stage)
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_RESERVATION_INVALID',
        'admin audit append is not authorized by its live reservation',
      );
    }
    const common = commonProjection(append);
    if (reservation.common !== null && reservation.common !== common) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_ROW_INVALID',
        'admin audit transaction fields changed between stages',
      );
    }
    const state = await stateFor(append.actorId);
    const entropy = Uint8Array.from(randomBytes(16));
    if (entropy.byteLength !== 16) throw new Error('admin audit entropy source failed');
    const auditId = `sfp_audit1_${Buffer.from(entropy).toString('base64url')}` as const;
    const contentInput = { auditId, ...append } as Omit<
      AdminAuditRecordV1,
      'previousRecordHash' | 'contentHash' | 'recordHash'
    >;
    const contentHash = contentHashFor(contentInput);
    const recordHash = recordHashFor(contentHash, state.previousRecordHash);
    const record = Object.freeze({
      ...contentInput,
      previousRecordHash: state.previousRecordHash,
      contentHash,
      recordHash,
    }) as Readonly<AdminAuditRecordV1>;
    const serialized = `${canonicalJson(record)}\n`;
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (
      bytes > ADMIN_AUDIT_LIMITS.maxRowBytes ||
      bytes > reservation.remainingBytes ||
      state.rows.length + 1 > maximumRows ||
      state.bytes + bytes > maximumBytes
    ) {
      throw new AdminAuditError(
        'ADMIN_AUDIT_CAPACITY_EXCEEDED',
        'admin audit row exceeds its reservation or store capacity',
      );
    }
    const snapshot = {
      rows: [...state.rows],
      rowBytes: [...state.rowBytes],
      bytes: state.bytes,
      previousRecordHash: state.previousRecordHash,
      sequence: state.sequence,
      reservation: { ...reservation },
    };
    state.rows.push(record as AdminAuditRecordV1);
    state.rowBytes.push(bytes);
    state.bytes += bytes;
    state.previousRecordHash = recordHash;
    state.sequence += 1;
    reservation.remainingRows -= 1;
    reservation.remainingBytes -= bytes;
    reservation.common = common;
    reservation.lastStage = append.stage;
    const previousGeneration = state.compactionId;
    try {
      await publishGeneration(state, 'append', { mode: 'append', suffix: serialized });
    } catch (error) {
      if (state.compactionId === previousGeneration) {
        state.rows = snapshot.rows;
        state.rowBytes = snapshot.rowBytes;
        state.bytes = snapshot.bytes;
        state.previousRecordHash = snapshot.previousRecordHash;
        state.sequence = snapshot.sequence;
        Object.assign(reservation, snapshot.reservation);
      }
      throw error;
    }
    return record;
  };

  const cursorMac = (payload: string): string =>
    createHmac('sha256', cursorKey)
      .update('sfp-admin-audit-cursor-v1')
      .update(zero)
      .update(payload)
      .digest('base64url');
  const createCursor = (
    actorId: string,
    since: string | null,
    next: number,
    compactionId: string,
  ): `sfp_ac1_${string}` => {
    const payload = Buffer.from(
      canonicalJson({
        actorId,
        kind: 'egress',
        since,
        next,
        compactionId,
        expiresAt: now() + 120_000,
      }),
      'utf8',
    ).toString('base64url');
    return `sfp_ac1_${payload}.${cursorMac(payload)}`;
  };
  const parseCursor = (
    actorId: string,
    since: string | null,
    compactionId: string,
    cursor: string,
  ): number => {
    const match = /^sfp_ac1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(cursor);
    if (match === null || cursor.length > 512) {
      throw new AdminAuditError('ADMIN_AUDIT_CURSOR_INVALID', 'admin audit cursor is invalid');
    }
    const expected = Buffer.from(cursorMac(match[1]!), 'base64url');
    const observed = Buffer.from(match[2]!, 'base64url');
    if (expected.byteLength !== observed.byteLength || !timingSafeEqual(expected, observed)) {
      throw new AdminAuditError('ADMIN_AUDIT_CURSOR_INVALID', 'admin audit cursor is invalid');
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw new AdminAuditError('ADMIN_AUDIT_CURSOR_INVALID', 'admin audit cursor is invalid');
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (value as { actorId?: unknown }).actorId !== actorId ||
      (value as { kind?: unknown }).kind !== 'egress' ||
      (value as { since?: unknown }).since !== since ||
      (value as { compactionId?: unknown }).compactionId !== compactionId ||
      !Number.isSafeInteger((value as { next?: unknown }).next) ||
      typeof (value as { expiresAt?: unknown }).expiresAt !== 'number' ||
      now() >= (value as { expiresAt: number }).expiresAt
    ) {
      throw new AdminAuditError('ADMIN_AUDIT_CURSOR_INVALID', 'admin audit cursor is invalid');
    }
    return (value as { next: number }).next;
  };

  const store: AdminAuditStore = {
    maxQueryRows: 1000 as const,
    maxQueryBytes: 1_048_576 as const,
    reserveTransaction: (actorId, transactionId) =>
      exclusive(() => reserveUnlocked(actorId, transactionId)),
    appendAndFsync: (handle, record) => exclusive(() => appendUnlocked(handle, record)),
    queryEgress: (actorId, input) =>
      exclusive(async () => {
        if (
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 1000 ||
          !(input.since === null || exactIso(input.since))
        ) {
          throw new AdminAuditError('ADMIN_AUDIT_CURSOR_INVALID', 'admin audit query is invalid');
        }
        const state = await stateFor(actorId);
        const start =
          input.cursor === null
            ? 0
            : parseCursor(actorId, input.since, state.compactionId, input.cursor);
        const matching = state.rows.filter(
          record => input.since === null || record.createdAt >= input.since,
        );
        const rows: AdminAuditPublicRecordV1[] = [];
        let bytes = 0;
        let index = start;
        while (index < matching.length && rows.length < input.limit) {
          const row = projectPublic(matching[index]!);
          const rowBytes = Buffer.byteLength(canonicalJson(row), 'utf8');
          if (bytes + rowBytes > 1_048_576) break;
          rows.push(row);
          bytes += rowBytes;
          index += 1;
        }
        return Object.freeze({
          schemaVersion: 1,
          chainVerified: true,
          checkpointContentHash: state.checkpointContentHash,
          anchorContentHash: state.anchorContentHash,
          rows: Object.freeze(rows),
          nextCursor:
            index < matching.length
              ? createCursor(actorId, input.since, index, state.compactionId)
              : null,
        });
      }),
    releaseTransaction: handle =>
      exclusive(async () => {
        const reservation = reservations.get(handle);
        if (reservation === undefined || reservation.released) {
          throw new AdminAuditError(
            'ADMIN_AUDIT_RESERVATION_INVALID',
            'admin audit reservation is invalid',
          );
        }
        reservation.released = true;
      }),
    recover: config =>
      exclusive(async () => {
        /* eslint-disable no-await-in-loop -- recovery must preserve actor and transaction journal order */
        for (const state of states.values()) {
          await stateFor(state.actorId);
          const transactions = new Map<string, AdminAuditRecordV1[]>();
          for (const row of state.rows) {
            const list = transactions.get(row.auditTransactionId) ?? [];
            list.push(row);
            transactions.set(row.auditTransactionId, list);
          }
          for (const [transactionId, transactionRows] of transactions) {
            const last = transactionRows.at(-1)!;
            if (!['pending', 'cas-intent'].includes(last.stage)) continue;
            const liveReservation = [...reservations.values()].find(
              reservation =>
                !reservation.released &&
                reservation.actorId === state.actorId &&
                reservation.transactionId === transactionId,
            );
            if (liveReservation === undefined) {
              throw new AdminAuditError(
                'ADMIN_AUDIT_CORRUPT',
                'active admin transaction has no durable recovery reservation',
              );
            }
            const common = {
              schemaVersion: 1 as const,
              auditTransactionId: last.auditTransactionId,
              kind: 'egress' as const,
              actorId: last.actorId,
              authSessionId: last.authSessionId,
              action: last.action,
              actionNonceClaimHash: last.actionNonceClaimHash,
              requestHash: last.requestHash,
              expectedConfigHash: last.expectedConfigHash,
              allowedClasses: last.allowedClasses,
              expiresAt: last.expiresAt,
              createdAt: new Date(now()).toISOString(),
            };
            liveReservation.common = commonProjection(last as AdminAuditAppendV1);
            liveReservation.lastStage = last.stage;
            const currentHash = config.config.configHash;
            const currentIsExpected =
              (config.storageState === 'valid' && currentHash === last.expectedConfigHash) ||
              (config.storageState === 'missing' &&
                last.expectedConfigHash === DEFAULT_EGRESS_CONFIG_V1.configHash &&
                currentHash === DEFAULT_EGRESS_CONFIG_V1.configHash);
            const currentIsDesired =
              config.storageState === 'valid' &&
              last.stage === 'cas-intent' &&
              currentHash === last.desiredConfigHash;
            if (currentIsDesired) {
              await appendUnlocked(liveReservation.handle, {
                ...common,
                stage: 'recovered',
                desiredConfigHash: last.desiredConfigHash,
                configHash: last.desiredConfigHash,
              });
            } else if (currentIsExpected) {
              await appendUnlocked(liveReservation.handle, {
                ...common,
                stage: 'aborted',
                desiredConfigHash: last.desiredConfigHash,
                configHash: last.expectedConfigHash,
                abortReason: 'recovery-current-expected',
              });
            } else {
              throw new AdminAuditError(
                'ADMIN_AUDIT_CORRUPT',
                'admin audit recovery observed an unrelated egress config',
              );
            }
            liveReservation.released = true;
          }
        }
        /* eslint-enable no-await-in-loop */
      }),
  };
  return Object.freeze(store);
};
