import { randomBytes as systemRandomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface LeaderGenerationCredentials {
  generation: string;
  followerToken: string;
  controlToken: string;
  createdAt: number;
}

export interface AuthStatePermissions {
  readonly stateRoot: string;
  ensureSecure(path: string): Promise<void>;
  verifySecure(path: string): Promise<void>;
}

export interface AuthorizationValue {
  generation: string;
  value: string;
}

export interface FollowerAuth {
  readonly permissions: AuthStatePermissions | undefined;
  rotate(): Promise<LeaderGenerationCredentials>;
  authorization(kind: 'follower' | 'control'): Promise<AuthorizationValue | undefined>;
  authorizeFollower(header: string | undefined, generation: string | undefined): Promise<boolean>;
  authorizeControl(header: string | undefined, generation: string | undefined): Promise<boolean>;
}

export interface FollowerAuthOptions {
  stateRoot?: string;
  permissions?: AuthStatePermissions;
  memory?: LeaderGenerationCredentials;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

const CREDENTIAL_FILE = 'leader-auth.json';
const writes = new Map<string, Promise<void>>();
const noop = (): void => {};

const withWriteLock = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = writes.get(key) ?? Promise.resolve();
  let release = noop;
  const current = new Promise<void>(resolvePromise => {
    release = resolvePromise;
  });
  const queued = previous.then(() => current);
  writes.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writes.get(key) === queued) writes.delete(key);
  }
};

const strictCredentials = (input: unknown): LeaderGenerationCredentials | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).toSorted().join(',') !==
      'controlToken,createdAt,followerToken,generation' ||
    typeof record.generation !== 'string' ||
    typeof record.followerToken !== 'string' ||
    typeof record.controlToken !== 'string' ||
    typeof record.createdAt !== 'number' ||
    !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0 ||
    !/^[A-Za-z0-9_-]{22}$/.test(record.generation) ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.followerToken) ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.controlToken) ||
    Buffer.from(record.generation, 'base64url').byteLength !== 16 ||
    Buffer.from(record.followerToken, 'base64url').byteLength !== 32 ||
    Buffer.from(record.controlToken, 'base64url').byteLength !== 32
  ) {
    return undefined;
  }
  return {
    generation: record.generation,
    followerToken: record.followerToken,
    controlToken: record.controlToken,
    createdAt: record.createdAt,
  };
};

const secureStringEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  const size = Math.max(a.byteLength, b.byteLength, 1);
  const paddedA = Buffer.alloc(size);
  const paddedB = Buffer.alloc(size);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.byteLength === b.byteLength;
};

const bearerToken = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1];
};

export const createFollowerAuth = async (options: FollowerAuthOptions): Promise<FollowerAuth> => {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? systemRandomBytes;
  let memory = options.memory === undefined ? undefined : { ...options.memory };

  let stateRoot: string | undefined;
  let credentialPath: string | undefined;
  if (memory === undefined) {
    if (options.stateRoot === undefined || options.permissions === undefined) {
      throw new TypeError('stateRoot and permissions are required outside the in-memory test seam');
    }
    stateRoot = resolve(options.stateRoot);
    if (resolve(options.permissions.stateRoot) !== stateRoot) {
      throw new Error('follower auth stateRoot does not match its permission authority');
    }
    credentialPath = join(stateRoot, CREDENTIAL_FILE);
    await options.permissions.verifySecure(stateRoot);
  }

  const readCurrent = async (): Promise<LeaderGenerationCredentials | undefined> => {
    if (memory !== undefined) return { ...memory };
    if (credentialPath === undefined || options.permissions === undefined) return undefined;
    try {
      await lstat(credentialPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    await options.permissions.verifySecure(stateRoot as string);
    await options.permissions.verifySecure(credentialPath);
    const parsed: unknown = JSON.parse(await readFile(credentialPath, 'utf8'));
    const credentials = strictCredentials(parsed);
    if (credentials === undefined) throw new Error('invalid leader credential state');
    return credentials;
  };

  const rotate = async (): Promise<LeaderGenerationCredentials> => {
    const credentials: LeaderGenerationCredentials = {
      generation: randomBytes(16).toString('base64url'),
      followerToken: randomBytes(32).toString('base64url'),
      controlToken: randomBytes(32).toString('base64url'),
      createdAt: now(),
    };
    if (memory !== undefined) {
      memory = { ...credentials };
      return { ...credentials };
    }
    if (
      credentialPath === undefined ||
      stateRoot === undefined ||
      options.permissions === undefined
    ) {
      throw new Error('persistent follower auth is not initialized');
    }
    return withWriteLock(credentialPath, async () => {
      await options.permissions?.verifySecure(stateRoot as string);
      const temporary = join(
        dirname(credentialPath as string),
        `.${CREDENTIAL_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
      );
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(credentials), 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await options.permissions?.ensureSecure(temporary);
        await options.permissions?.verifySecure(temporary);
        await rename(temporary, credentialPath as string);
        await options.permissions?.ensureSecure(credentialPath as string);
        await options.permissions?.verifySecure(credentialPath as string);
        if (process.platform !== 'win32') {
          const directory = await open(stateRoot as string, 'r');
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
      } catch (error) {
        await handle?.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { ...credentials };
    });
  };

  const authorization = async (
    kind: 'follower' | 'control',
  ): Promise<AuthorizationValue | undefined> => {
    const current = await readCurrent();
    if (current === undefined) return undefined;
    return {
      generation: current.generation,
      value: `Bearer ${kind === 'follower' ? current.followerToken : current.controlToken}`,
    };
  };

  const authorize = async (
    kind: 'follower' | 'control',
    header: string | undefined,
    generation: string | undefined,
  ): Promise<boolean> => {
    const supplied = bearerToken(header);
    const current = await readCurrent();
    if (supplied === undefined || generation === undefined || current === undefined) return false;
    const expected = kind === 'follower' ? current.followerToken : current.controlToken;
    return (
      secureStringEqual(generation, current.generation) && secureStringEqual(supplied, expected)
    );
  };

  return Object.freeze({
    permissions: options.permissions,
    rotate,
    authorization,
    authorizeFollower: (header: string | undefined, generation: string | undefined) =>
      authorize('follower', header, generation),
    authorizeControl: (header: string | undefined, generation: string | undefined) =>
      authorize('control', header, generation),
  });
};
