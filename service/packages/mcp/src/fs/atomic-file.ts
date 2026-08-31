import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, truncate, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface AtomicFilePublication {
  path: string;
  bytes: number;
}

interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
  nlink: number;
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const canonicalPathMutexes = new Map<string, { tail: Promise<void>; users: number }>();

export interface CanonicalPathMutexOptions {
  timeoutMs?: number;
  afterOwnerSyncBeforePublish?: (temporaryPath: string, lockPath: string) => Promise<void>;
  afterPublishBeforeTempUnlink?: (temporaryPath: string, lockPath: string) => Promise<void>;
}

interface PathLockOwner {
  schemaVersion: 1;
  pid: number;
  createdAt: number;
  token: string;
}

const validPathLockOwner = (value: unknown): value is PathLockOwner =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify(['createdAt', 'pid', 'schemaVersion', 'token']) &&
  (value as PathLockOwner).schemaVersion === 1 &&
  Number.isSafeInteger((value as PathLockOwner).pid) &&
  (value as PathLockOwner).pid > 0 &&
  Number.isSafeInteger((value as PathLockOwner).createdAt) &&
  /^[0-9a-f]{32}$/u.test((value as PathLockOwner).token);

const acquireInterprocessPathLock = async (
  canonicalPath: string,
  options: CanonicalPathMutexOptions = {},
): Promise<() => Promise<void>> => {
  const lockPath = `${canonicalPath}.sfp-lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw Object.assign(new Error('path lock timeout is invalid'), { code: 'PATH_LOCK_INVALID' });
  }
  const deadline = Date.now() + timeoutMs;
  /* eslint-disable no-await-in-loop -- lock acquisition retries one verified filesystem authority */
  for (;;) {
    const token = randomBytes(16).toString('hex');
    const temporaryPath = join(dirname(lockPath), `.${basename(lockPath)}.${token}.sfp-tmp`);
    let ownerHandle: Awaited<ReturnType<typeof open>> | undefined;
    let published = false;
    try {
      ownerHandle = await open(temporaryPath, 'wx', 0o600);
      const owner: PathLockOwner = {
        schemaVersion: 1,
        pid: process.pid,
        createdAt: Date.now(),
        token,
      };
      const ownerBytes = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8');
      await ownerHandle.writeFile(ownerBytes);
      await ownerHandle.sync();
      await options.afterOwnerSyncBeforePublish?.(temporaryPath, lockPath);
      try {
        await link(temporaryPath, lockPath);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw cause;
        throw Object.assign(new Error('path lock publication failed', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      published = true;
      await fsyncDirectory(dirname(lockPath));
      await options.afterPublishBeforeTempUnlink?.(temporaryPath, lockPath);
      const [identity, publishedIdentity] = await Promise.all([
        ownerHandle.stat(),
        lstat(lockPath),
      ]);
      if (!identity.isFile() || identity.nlink !== 1) {
        if (
          !identity.isFile() ||
          identity.nlink !== 2 ||
          !publishedIdentity.isFile() ||
          publishedIdentity.isSymbolicLink() ||
          publishedIdentity.nlink !== 2 ||
          !sameIdentity(identity, publishedIdentity)
        ) {
          throw Object.assign(new Error('path lock identity is invalid'), {
            code: 'PATH_LOCK_INVALID',
          });
        }
      }
      await unlink(temporaryPath);
      await fsyncDirectory(dirname(lockPath));
      const [retainedIdentity, current] = await Promise.all([ownerHandle.stat(), lstat(lockPath)]);
      if (
        !retainedIdentity.isFile() ||
        retainedIdentity.nlink !== 1 ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        !sameIdentity(retainedIdentity, current) ||
        retainedIdentity.size !== ownerBytes.byteLength
      ) {
        throw Object.assign(new Error('path lock identity is invalid'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const retainedHandle = ownerHandle;
      ownerHandle = undefined;
      return async () => {
        try {
          const pathnameAtRelease = await lstat(lockPath);
          if (
            !pathnameAtRelease.isFile() ||
            pathnameAtRelease.isSymbolicLink() ||
            pathnameAtRelease.nlink !== 1 ||
            !sameIdentity(retainedIdentity, pathnameAtRelease)
          ) {
            throw Object.assign(new Error('path lock changed before release'), {
              code: 'PATH_LOCK_INVALID',
            });
          }
          await unlink(lockPath);
          await fsyncDirectory(dirname(lockPath));
        } finally {
          await retainedHandle.close();
        }
      };
    } catch (error) {
      await ownerHandle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      });
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if (published) {
          await unlink(lockPath).catch(cause => {
            if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
          });
          await fsyncDirectory(dirname(lockPath));
        }
        throw error;
      }
      let existingHandle: Awaited<ReturnType<typeof open>>;
      try {
        existingHandle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw Object.assign(new Error('existing path lock cannot be opened', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const metadata = await existingHandle.stat();
      const pathname = await lstat(lockPath);
      if (
        !metadata.isFile() ||
        metadata.nlink < 1 ||
        metadata.nlink > 2 ||
        metadata.size < 1 ||
        metadata.size > 4_096 ||
        !pathname.isFile() ||
        pathname.isSymbolicLink() ||
        !sameIdentity(metadata, pathname)
      ) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock is not regular'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const ownerBytes = Buffer.alloc(metadata.size);
      try {
        const observed = await existingHandle.read(ownerBytes, 0, ownerBytes.byteLength, 0);
        if (observed.bytesRead !== ownerBytes.byteLength) {
          throw new Error('short lock owner read', { cause: error });
        }
      } catch (cause) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock owner is invalid', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      let owner: unknown;
      try {
        owner = JSON.parse(ownerBytes.toString('utf8')) as unknown;
      } catch {
        owner = null;
      }
      if (!validPathLockOwner(owner)) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock owner is invalid'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (cause) {
        alive = (cause as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      if (!alive && Date.now() - owner.createdAt >= 1_000) {
        const rechecked = await lstat(lockPath);
        const descriptorRecheck = await existingHandle.stat();
        if (
          !sameIdentity(metadata, rechecked) ||
          !sameIdentity(metadata, descriptorRecheck) ||
          rechecked.nlink !== metadata.nlink
        ) {
          await existingHandle.close();
          throw Object.assign(new Error('stale path lock changed during recovery'), {
            code: 'PATH_LOCK_INVALID',
          });
        }
        let linkedTemporary: string | null = null;
        if (metadata.nlink === 2) {
          const candidate = join(
            dirname(lockPath),
            `.${basename(lockPath)}.${owner.token}.sfp-tmp`,
          );
          const candidateMetadata = await lstat(candidate).catch((cause: NodeJS.ErrnoException) => {
            if (cause.code === 'ENOENT') return null;
            throw cause;
          });
          if (candidateMetadata === null || !sameIdentity(metadata, candidateMetadata)) {
            await existingHandle.close();
            throw Object.assign(new Error('stale path lock link group is invalid'), {
              code: 'PATH_LOCK_INVALID',
            });
          }
          linkedTemporary = candidate;
        }
        await unlink(lockPath);
        if (linkedTemporary !== null) await unlink(linkedTemporary);
        await fsyncDirectory(dirname(lockPath));
        await existingHandle.close();
        continue;
      }
      await existingHandle.close();
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('timed out waiting for path authority lock'), {
          code: 'PATH_LOCK_TIMEOUT',
        });
      }
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  /* eslint-enable no-await-in-loop */
};

export const withCanonicalPathMutex = async <T>(
  canonicalPath: string,
  operation: () => Promise<T>,
  options: CanonicalPathMutexOptions = {},
): Promise<T> => {
  let mutex = canonicalPathMutexes.get(canonicalPath);
  if (mutex === undefined) {
    mutex = { tail: Promise.resolve(), users: 0 };
    canonicalPathMutexes.set(canonicalPath, mutex);
  }
  mutex.users += 1;
  const previous = mutex.tail;
  let release!: () => void;
  mutex.tail = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  let releaseInterprocess: () => Promise<void>;
  try {
    releaseInterprocess = await acquireInterprocessPathLock(canonicalPath, options);
  } catch (error) {
    release();
    mutex.users -= 1;
    if (mutex.users === 0 && canonicalPathMutexes.get(canonicalPath) === mutex) {
      canonicalPathMutexes.delete(canonicalPath);
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    try {
      await releaseInterprocess();
    } finally {
      release();
      mutex.users -= 1;
      if (mutex.users === 0 && canonicalPathMutexes.get(canonicalPath) === mutex) {
        canonicalPathMutexes.delete(canonicalPath);
      }
    }
  }
};
const defaultBoundedReader = (path: string): Promise<Uint8Array> => readFile(path);

export const readFileWithinLimit = async (
  path: string,
  maxBytes: number,
  reader: (path: string) => Promise<Uint8Array> = defaultBoundedReader,
  options: { beforeRead?: () => Promise<void> } = {},
): Promise<Buffer> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw Object.assign(new Error('bounded file limit is invalid'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw Object.assign(new Error('bounded file is not a regular file'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: true,
    });
  }
  if (metadata.size > maxBytes) {
    throw Object.assign(new Error('bounded file exceeds its declared limit'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
  }
  let bytes: Buffer;
  if (reader === defaultBoundedReader) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await options.beforeRead?.();
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || !sameIdentity(metadata, opened)) {
        throw Object.assign(new Error('bounded file identity changed before read'), {
          code: 'FILE_IDENTITY_INVALID',
          beforeRead: true,
        });
      }
      if (opened.size > maxBytes) {
        throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
          code: 'FILE_SIZE_LIMIT_EXCEEDED',
          beforeRead: true,
        });
      }
      const chunks: Buffer[] = [];
      let total = 0;
      /* eslint-disable no-await-in-loop -- descriptor reads are sequential and stop at the cap */
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(65_536, maxBytes - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) {
          throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
            code: 'FILE_SIZE_LIMIT_EXCEEDED',
            beforeRead: false,
          });
        }
        chunks.push(chunk.subarray(0, bytesRead));
        const during = await handle.stat();
        if (during.size > maxBytes) {
          throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
            code: 'FILE_SIZE_LIMIT_EXCEEDED',
            beforeRead: false,
          });
        }
      }
      /* eslint-enable no-await-in-loop */
      bytes = Buffer.concat(chunks, total);
    } finally {
      await handle.close();
    }
  } else {
    await options.beforeRead?.();
    const immediatelyBefore = await lstat(path);
    if (immediatelyBefore.size > maxBytes || !sameIdentity(metadata, immediatelyBefore)) {
      throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        beforeRead: true,
      });
    }
    bytes = Buffer.from(await reader(path));
  }
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    !sameIdentity(metadata, after)
  ) {
    throw Object.assign(new Error('bounded file identity changed during read'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: false,
    });
  }
  if (bytes.byteLength > maxBytes) {
    throw Object.assign(new Error('bounded file exceeds its declared limit'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: false,
    });
  }
  return bytes;
};

const atomicError = (code: string, message: string, cause?: unknown) =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const fsyncDirectory = async (path: string): Promise<void> => {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      // Node/Windows cannot fsync a directory handle (EPERM). This is the repository's existing
      // durability adaptation in OperationJournal; the exclusive hard-link remains the commit point.
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    });
  } catch (cause) {
    throw atomicError(
      'ATOMIC_DIRECTORY_FSYNC_FAILED',
      'atomic publication directory fsync failed',
      cause,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

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
  if (encoded === undefined) throw atomicError('IMMUTABLE_GENERATION_INVALID', 'value is not JSON');
  return encoded;
};
const digest64 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const prefixedHash = (domain: string, value: unknown): `sha256:${string}` =>
  `sha256:${createHash('sha256')
    .update(domain, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());
const immutableStem = (basePath: string): string =>
  basePath.endsWith('.jsonl') ? basePath.slice(0, -'.jsonl'.length) : basePath;

export type ImmutableGenerationStep =
  | 'temporary-log-fsync'
  | 'temporary-checkpoint-fsync'
  | 'temporary-anchor-fsync'
  | 'generation-log-link'
  | 'generation-checkpoint-link'
  | 'generation-anchor-link'
  | 'directory-fsync-before-pointer'
  | 'before-pointer-replace'
  | 'pointer-replace'
  | 'directory-fsync-after-pointer'
  | 'temporary-cleanup';

export interface ImmutableGenerationPointerV1 {
  schemaVersion: 1;
  compactionId: string;
  logDigest64: string;
  checkpointHash: `sha256:${string}`;
  anchorHash: `sha256:${string}`;
}

export interface ImmutableGenerationSelection {
  pointer: Readonly<ImmutableGenerationPointerV1>;
  logBytes: Uint8Array;
  previousRecordHash: `sha256:${string}` | null;
  firstRetainedRecordHash: `sha256:${string}` | null;
  baseTailBytes: number;
  baseTailDigest64: string;
}

const writeFsync = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const generationNames = (basePath: string, compactionId: string) => {
  const stem = immutableStem(basePath);
  return {
    log: `${stem}.compact-${compactionId}.jsonl`,
    checkpoint: `${stem}.compact-${compactionId}.checkpoint.json`,
    anchor: `${stem}.compact-${compactionId}.anchor.json`,
    current: `${stem}.current`,
  };
};

export const publishImmutableGeneration = async (input: {
  basePath: string;
  store: string;
  actorHash: string;
  logBytes: Uint8Array;
  rows: number;
  sequence: number;
  previousRecordHash: `sha256:${string}` | null;
  firstRetainedRecordHash: `sha256:${string}` | null;
  baseTailBytes?: Uint8Array;
  now: number;
  hook?: (step: ImmutableGenerationStep) => Promise<void>;
}): Promise<Readonly<ImmutableGenerationPointerV1>> => {
  const directory = dirname(input.basePath);
  const compactionId = randomBytes(16).toString('hex');
  const names = generationNames(input.basePath, compactionId);
  const token = randomBytes(16).toString('hex');
  const temporary = {
    log: join(directory, `.${basename(names.log)}.${token}.tmp`),
    checkpoint: join(directory, `.${basename(names.checkpoint)}.${token}.tmp`),
    anchor: join(directory, `.${basename(names.anchor)}.${token}.tmp`),
    current: join(directory, `.${basename(names.current)}.${token}.tmp`),
  };
  const createdAt = new Date(input.now).toISOString();
  const checkpointBase = {
    schemaVersion: 1 as const,
    store: input.store,
    actorHash: input.actorHash,
    compactionId,
    sequence: input.sequence,
    rows: input.rows,
    bytes: input.logBytes.byteLength,
    previousRecordHash: input.previousRecordHash,
    firstRetainedRecordHash: input.firstRetainedRecordHash,
    baseTailBytes: input.baseTailBytes?.byteLength ?? 0,
    baseTailDigest64: digest64(input.baseTailBytes ?? Buffer.alloc(0)),
    createdAt,
  };
  const checkpointHash = prefixedHash(`sfp-${input.store}-checkpoint-v1`, checkpointBase);
  const checkpoint = { ...checkpointBase, checkpointHash, contentHash: checkpointHash };
  const anchorBase = {
    schemaVersion: 1 as const,
    store: input.store,
    actorHash: input.actorHash,
    compactionId,
    checkpointHash,
    previousRecordHash: input.previousRecordHash,
    createdAt,
  };
  const anchorHash = prefixedHash(`sfp-${input.store}-anchor-v1`, anchorBase);
  const anchor = { ...anchorBase, anchorHash, contentHash: anchorHash };
  const pointer: ImmutableGenerationPointerV1 = {
    schemaVersion: 1,
    compactionId,
    logDigest64: digest64(input.logBytes),
    checkpointHash,
    anchorHash,
  };
  const hook = input.hook ?? (async () => undefined);
  try {
    await writeFsync(temporary.log, input.logBytes);
    await hook('temporary-log-fsync');
    await writeFsync(temporary.checkpoint, Buffer.from(`${canonicalJson(checkpoint)}\n`));
    await hook('temporary-checkpoint-fsync');
    await writeFsync(temporary.anchor, Buffer.from(`${canonicalJson(anchor)}\n`));
    await hook('temporary-anchor-fsync');
    await link(temporary.log, names.log);
    await hook('generation-log-link');
    await link(temporary.checkpoint, names.checkpoint);
    await hook('generation-checkpoint-link');
    await link(temporary.anchor, names.anchor);
    await hook('generation-anchor-link');
    await fsyncDirectory(directory);
    await hook('directory-fsync-before-pointer');
    await writeFsync(temporary.current, Buffer.from(`${canonicalJson(pointer)}\n`));
    await hook('before-pointer-replace');
    let backup: string | undefined;
    try {
      const currentMetadata = await lstat(names.current);
      if (
        !currentMetadata.isFile() ||
        currentMetadata.isSymbolicLink() ||
        currentMetadata.nlink !== 1
      ) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'current pointer identity is invalid');
      }
      backup = `${names.current}.backup-${token}`;
      await link(names.current, backup);
      await unlink(names.current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    try {
      await link(temporary.current, names.current);
      await unlink(temporary.current);
    } catch (cause) {
      if (backup !== undefined) {
        await link(backup, names.current).catch(() => undefined);
      }
      throw cause;
    }
    await hook('pointer-replace');
    await fsyncDirectory(directory);
    await hook('directory-fsync-after-pointer');
    if (backup !== undefined) await unlink(backup);
    await truncate(input.basePath, 0);
    const base = await open(input.basePath, 'a');
    await base.sync();
    await base.close();
    return Object.freeze(pointer);
  } finally {
    await Promise.all(
      Object.values(temporary).map(path =>
        unlink(path).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }),
      ),
    );
    await hook('temporary-cleanup');
  }
};

const pointerSupportNames = async (
  basePath: string,
): Promise<{
  current: string;
  backups: string[];
  temporaries: string[];
}> => {
  const current = `${immutableStem(basePath)}.current`;
  const directory = dirname(basePath);
  const currentName = basename(current);
  const names = await readdir(directory);
  return {
    current,
    backups: names
      .filter(
        name => name.startsWith(`${currentName}.backup-`) && /\.backup-[0-9a-f]{32}$/u.test(name),
      )
      .map(name => join(directory, name)),
    temporaries: names
      .filter(name => name.startsWith(`.${currentName}.`) && name.endsWith('.tmp'))
      .map(name => join(directory, name)),
  };
};

const recoverPointerPublication = async (basePath: string): Promise<string[]> => {
  const support = await pointerSupportNames(basePath);
  let currentMetadata: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    currentMetadata = await lstat(support.current);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
  if (currentMetadata === null) {
    if (support.backups.length === 0) return [];
    if (support.backups.length !== 1) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer recovery is ambiguous');
    }
    const backupMetadata = await lstat(support.backups[0] as string);
    if (!backupMetadata.isFile() || backupMetadata.isSymbolicLink() || backupMetadata.nlink !== 1) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer backup identity is invalid');
    }
    await link(support.backups[0] as string, support.current);
    await unlink(support.backups[0] as string);
    currentMetadata = await lstat(support.current);
  }
  /* eslint-disable no-await-in-loop -- pointer support identity must be rechecked after each unlink */
  for (const supportPath of [...support.backups, ...support.temporaries]) {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(supportPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw cause;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer support file is invalid');
    }
    if (sameIdentity(metadata, currentMetadata)) {
      await unlink(supportPath);
      currentMetadata = await lstat(support.current);
    }
  }
  /* eslint-enable no-await-in-loop */
  if (
    !currentMetadata.isFile() ||
    currentMetadata.isSymbolicLink() ||
    currentMetadata.nlink !== 1
  ) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'current pointer identity is invalid');
  }
  return support.backups;
};

const readRegularNoFollow = async (
  path: string,
  expectedLinks = 1,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<Buffer> => {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== expectedLinks) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path identity is invalid');
  }
  if (before.size > maxBytes) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path exceeds its hard cap');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== expectedLinks || !sameIdentity(before, opened)) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path changed before read');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    /* eslint-disable no-await-in-loop -- descriptor reads are sequential and stop at the cap */
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path exceeds its hard cap');
      }
      chunks.push(chunk.subarray(0, bytesRead));
      const during = await handle.stat();
      if (during.size > maxBytes) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path grew during read');
      }
    }
    /* eslint-enable no-await-in-loop */
    const bytes = Buffer.concat(chunks, total);
    const after = await lstat(path);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.nlink !== expectedLinks ||
      !sameIdentity(opened, after)
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path changed during read');
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

const recognizedTemporaryLinks = async (selectedPath: string): Promise<string[]> => {
  const directory = dirname(selectedPath);
  const selectedName = basename(selectedPath);
  return (await readdir(directory))
    .filter(name => {
      const match = new RegExp(
        `^\\.${selectedName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.[0-9a-f]{32}\\.tmp$`,
        'u',
      );
      return match.test(name);
    })
    .map(name => join(directory, name));
};

const readSelectedGenerationMember = async (
  path: string,
  maxBytes: number | undefined,
): Promise<{ bytes: Buffer; temporaryLinks: string[] }> => {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink()) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation member is invalid');
  }
  const temporaryLinks = await recognizedTemporaryLinks(path);
  /* eslint-disable no-await-in-loop -- selected hardlinks require ordered identity validation */
  for (const temporary of temporaryLinks) {
    const metadata = await lstat(temporary);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !sameIdentity(selected, metadata)) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'generation temporary link is foreign');
    }
  }
  /* eslint-enable no-await-in-loop */
  const expectedLinks = temporaryLinks.length + 1;
  if (selected.nlink !== expectedLinks) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation has a foreign link');
  }
  return {
    bytes: await readRegularNoFollow(path, expectedLinks, maxBytes),
    temporaryLinks,
  };
};

const removeUnselectedGenerations = async (
  basePath: string,
  selected: ReadonlySet<string>,
): Promise<void> => {
  const directory = dirname(basePath);
  const prefix = `${basename(immutableStem(basePath))}.compact-`;
  let removed = false;
  /* eslint-disable no-await-in-loop -- validate each pathname immediately before its unlink */
  for (const name of await readdir(directory)) {
    if (!name.startsWith(prefix) || selected.has(name)) continue;
    if (!/\.compact-[0-9a-f]{32}\.(?:jsonl|checkpoint\.json|anchor\.json)$/u.test(name)) continue;
    const path = join(directory, name);
    const metadata = await lstat(path);
    const temporaryLinks = await recognizedTemporaryLinks(path);
    for (const temporary of temporaryLinks) {
      const temporaryMetadata = await lstat(temporary);
      if (
        !temporaryMetadata.isFile() ||
        temporaryMetadata.isSymbolicLink() ||
        !sameIdentity(metadata, temporaryMetadata)
      ) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected temporary is foreign');
      }
    }
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== temporaryLinks.length + 1
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected generation is not regular');
    }
    const immediatelyBeforeUnlink = await lstat(path);
    if (
      !immediatelyBeforeUnlink.isFile() ||
      immediatelyBeforeUnlink.isSymbolicLink() ||
      immediatelyBeforeUnlink.nlink !== temporaryLinks.length + 1 ||
      !sameIdentity(metadata, immediatelyBeforeUnlink)
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected generation changed');
    }
    await Promise.all(temporaryLinks.map(temporary => unlink(temporary)));
    await unlink(path);
    removed = true;
  }
  /* eslint-enable no-await-in-loop */
  if (removed) await fsyncDirectory(directory);
};

export const readImmutableGeneration = async (input: {
  basePath: string;
  store: string;
  actorHash: string;
  maxLogBytes?: number;
}): Promise<Readonly<ImmutableGenerationSelection> | null> => {
  const current = `${immutableStem(input.basePath)}.current`;
  const staleBackups = await recoverPointerPublication(input.basePath);
  let pointerBytes: Buffer;
  try {
    pointerBytes = await readRegularNoFollow(current, 1, 65_536);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await removeUnselectedGenerations(input.basePath, new Set());
    return null;
  }
  let pointer: ImmutableGenerationPointerV1;
  try {
    const value = JSON.parse(pointerBytes.toString('utf8')) as ImmutableGenerationPointerV1;
    if (
      !exactKeys(value, [
        'schemaVersion',
        'compactionId',
        'logDigest64',
        'checkpointHash',
        'anchorHash',
      ]) ||
      value.schemaVersion !== 1 ||
      !/^[0-9a-f]{32}$/u.test(value.compactionId) ||
      !/^[0-9a-f]{64}$/u.test(value.logDigest64) ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.checkpointHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.anchorHash)
    ) {
      throw new Error('invalid pointer');
    }
    pointer = value;
  } catch (cause) {
    throw atomicError(
      'IMMUTABLE_GENERATION_INVALID',
      'current generation pointer is invalid',
      cause,
    );
  }
  const names = generationNames(input.basePath, pointer.compactionId);
  const selectedNames = new Set([
    basename(names.log),
    basename(names.checkpoint),
    basename(names.anchor),
  ]);
  let logBytes: Buffer;
  let checkpoint: Record<string, unknown>;
  let anchor: Record<string, unknown>;
  let selectedTemporaryLinks: string[];
  try {
    const [log, checkpointMember, anchorMember] = await Promise.all([
      readSelectedGenerationMember(names.log, input.maxLogBytes),
      readSelectedGenerationMember(names.checkpoint, 65_536),
      readSelectedGenerationMember(names.anchor, 65_536),
    ]);
    logBytes = log.bytes;
    checkpoint = JSON.parse(checkpointMember.bytes.toString('utf8')) as Record<string, unknown>;
    anchor = JSON.parse(anchorMember.bytes.toString('utf8')) as Record<string, unknown>;
    selectedTemporaryLinks = [
      ...log.temporaryLinks,
      ...checkpointMember.temporaryLinks,
      ...anchorMember.temporaryLinks,
    ];
  } catch (cause) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation is incomplete', cause);
  }
  const checkpointBase = { ...checkpoint };
  delete checkpointBase.checkpointHash;
  delete checkpointBase.contentHash;
  const anchorBase = { ...anchor };
  delete anchorBase.anchorHash;
  delete anchorBase.contentHash;
  if (
    digest64(logBytes) !== pointer.logDigest64 ||
    !exactKeys(checkpoint, [
      'schemaVersion',
      'store',
      'actorHash',
      'compactionId',
      'sequence',
      'rows',
      'bytes',
      'previousRecordHash',
      'firstRetainedRecordHash',
      'baseTailBytes',
      'baseTailDigest64',
      'checkpointHash',
      'createdAt',
      'contentHash',
    ]) ||
    !exactKeys(anchor, [
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
    checkpoint.store !== input.store ||
    anchor.store !== input.store ||
    checkpoint.actorHash !== input.actorHash ||
    anchor.actorHash !== input.actorHash ||
    checkpoint.compactionId !== pointer.compactionId ||
    anchor.compactionId !== pointer.compactionId ||
    checkpoint.bytes !== logBytes.byteLength ||
    !Number.isSafeInteger(checkpoint.baseTailBytes) ||
    (checkpoint.baseTailBytes as number) < 0 ||
    typeof checkpoint.baseTailDigest64 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(checkpoint.baseTailDigest64 as string) ||
    checkpoint.checkpointHash !== pointer.checkpointHash ||
    checkpoint.contentHash !== pointer.checkpointHash ||
    anchor.checkpointHash !== pointer.checkpointHash ||
    anchor.anchorHash !== pointer.anchorHash ||
    anchor.contentHash !== pointer.anchorHash ||
    prefixedHash(`sfp-${input.store}-checkpoint-v1`, checkpointBase) !== pointer.checkpointHash ||
    prefixedHash(`sfp-${input.store}-anchor-v1`, anchorBase) !== pointer.anchorHash
  ) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation verification failed');
  }
  await Promise.all(selectedTemporaryLinks.map(path => unlink(path)));
  if (selectedTemporaryLinks.length > 0) await fsyncDirectory(dirname(input.basePath));
  await Promise.all(
    staleBackups.map(backup =>
      unlink(backup).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }),
    ),
  );
  await removeUnselectedGenerations(input.basePath, selectedNames);
  return Object.freeze({
    pointer: Object.freeze(pointer),
    logBytes,
    previousRecordHash: checkpoint.previousRecordHash as `sha256:${string}` | null,
    firstRetainedRecordHash: checkpoint.firstRetainedRecordHash as `sha256:${string}` | null,
    baseTailBytes: checkpoint.baseTailBytes as number,
    baseTailDigest64: checkpoint.baseTailDigest64 as string,
  });
};

export class AtomicFileStore {
  constructor(private readonly options: { afterLink?: (path: string) => Promise<void> } = {}) {}

  async createNew(target: string, bytes: Uint8Array): Promise<Readonly<AtomicFilePublication>> {
    const directory = dirname(target);
    const temporary = join(
      directory,
      `.${basename(target)}.${randomBytes(16).toString('hex')}.sfp-tmp`,
    );
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporary, target);
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          throw atomicError('ATOMIC_FILE_EXISTS', 'atomic create-new target already exists', cause);
        }
        throw atomicError('ATOMIC_LINK_FAILED', 'exclusive hard-link publication failed', cause);
      }
      await this.options.afterLink?.(target);
      await fsyncDirectory(directory);
      const [temporaryMetadata, metadata] = await Promise.all([lstat(temporary), lstat(target)]);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        !temporaryMetadata.isFile() ||
        temporaryMetadata.isSymbolicLink() ||
        !sameIdentity(temporaryMetadata, metadata)
      ) {
        throw atomicError('ATOMIC_TARGET_INVALID', 'published target is not a regular file');
      }
      if (metadata.nlink !== 2 || temporaryMetadata.nlink !== 2) {
        throw atomicError('ATOMIC_TARGET_ALIAS', 'published target has a foreign hardlink alias');
      }
      const observed = await readFile(target);
      if (!observed.equals(Buffer.from(bytes))) {
        throw atomicError('ATOMIC_TARGET_MISMATCH', 'published target bytes do not match');
      }
      const rechecked = await lstat(target);
      if (!sameIdentity(metadata, rechecked) || rechecked.nlink !== 2) {
        throw atomicError(
          'ATOMIC_TARGET_ALIAS',
          'published target identity changed during verification',
        );
      }
      return Object.freeze({ path: target, bytes: observed.byteLength });
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
}
