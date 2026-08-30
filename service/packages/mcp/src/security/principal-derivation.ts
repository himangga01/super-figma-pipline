import { createHash, createHmac, randomBytes as systemRandomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { ActorContext } from '@sfp/shared';
import type { StatePermissions } from '@sfp/shared';

export interface PersistentKeyOptions {
  stateRoot: string;
  permissions: StatePermissions;
  randomBytes?: (size: number) => Uint8Array;
}

export const OWNER_PRINCIPAL_KEY_RELATIVE_PATH = 'auth/owner-principal-key.v1' as const;

export class PersistentKeyError extends Error {
  constructor(
    readonly code:
      | 'KEY_STATE_ROOT_MISMATCH'
      | 'SECURE_KEY_CORRUPT'
      | 'SECURE_KEY_PUBLICATION_FAILED',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PersistentKeyError';
  }
}

const samePath = (left: string, right: string): boolean =>
  process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const syncDirectory = async (path: string): Promise<void> => {
  const handle = await open(path, 'r');
  try {
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    });
  } finally {
    await handle.close();
  }
};

const readSecureKey = async (path: string, permissions: StatePermissions): Promise<Uint8Array> => {
  await permissions.verifySecure(path);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size !== 32n) {
    throw new PersistentKeyError(
      'SECURE_KEY_CORRUPT',
      'persistent key is not a 32-byte regular file',
    );
  }
  const bytes = await readFile(path);
  const after = await lstat(path, { bigint: true });
  if (
    bytes.byteLength !== 32 ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.size !== 32n
  ) {
    throw new PersistentKeyError('SECURE_KEY_CORRUPT', 'persistent key changed while reading');
  }
  await permissions.verifySecure(path);
  return Uint8Array.from(bytes);
};

export const loadOrCreatePersistentKey = async (
  options: PersistentKeyOptions,
  relativePath: `auth/${string}`,
): Promise<Uint8Array> => {
  if (!samePath(options.stateRoot, options.permissions.stateRoot)) {
    throw new PersistentKeyError(
      'KEY_STATE_ROOT_MISMATCH',
      'persistent key stateRoot does not match its permission authority',
    );
  }
  const randomBytes = options.randomBytes ?? (size => systemRandomBytes(size));
  const authDirectory = join(options.stateRoot, 'auth');
  const finalPath = join(options.stateRoot, ...relativePath.split('/'));
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  await options.permissions.verifySecure(options.stateRoot);
  await options.permissions.ensureSecure(authDirectory);
  await options.permissions.verifySecure(authDirectory);
  let finalExists = true;
  try {
    await lstat(finalPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
    finalExists = false;
  }
  if (finalExists) return await readSecureKey(finalPath, options.permissions);

  const candidate = Uint8Array.from(randomBytes(32));
  if (candidate.byteLength !== 32) {
    throw new PersistentKeyError('SECURE_KEY_CORRUPT', 'persistent key entropy source failed');
  }
  const token = Buffer.from(randomBytes(16));
  if (token.byteLength !== 16) {
    throw new PersistentKeyError('SECURE_KEY_CORRUPT', 'persistent key entropy source failed');
  }
  const temporary = join(
    dirname(finalPath),
    `.${relativePath.split('/').at(-1)}.${process.pid}.${token.toString('hex')}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(candidate);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await options.permissions.ensureSecure(temporary);
    await options.permissions.verifySecure(temporary);
    try {
      await link(temporary, finalPath);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw new PersistentKeyError(
          'SECURE_KEY_PUBLICATION_FAILED',
          'persistent key publication failed',
          { cause: error },
        );
      }
      return await readSecureKey(finalPath, options.permissions);
    }
    await options.permissions.ensureSecure(finalPath);
    await options.permissions.verifySecure(finalPath);
    await syncDirectory(authDirectory);
    return candidate;
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
};

export const loadOrCreateOwnerPrincipalKey = (options: PersistentKeyOptions): Promise<Uint8Array> =>
  loadOrCreatePersistentKey(options, OWNER_PRINCIPAL_KEY_RELATIVE_PATH);

const zero = Buffer.from([0]);

const ownerHmac = (ownerKey: Uint8Array, ...segments: readonly string[]): string => {
  if (ownerKey.byteLength !== 32) throw new Error('owner principal key must contain 32 bytes');
  const hmac = createHmac('sha256', ownerKey);
  segments.forEach((segment, index) => {
    if (index > 0) hmac.update(zero);
    hmac.update(segment, 'utf8');
  });
  return hmac.digest('base64url');
};

export const deriveOwnerActor = (
  ownerKey: Uint8Array,
  entryPath: ActorContext['entryPath'],
): ActorContext['actorId'] => {
  if (!['mcp-direct', 'mcp-follower', 'control', 'internal-system'].includes(entryPath)) {
    throw new Error('invalid principal entry path');
  }
  return `actor1_${ownerHmac(ownerKey, 'sfp-actor-v2', 'os-owner')}`;
};

export const deriveMcpAuthSession = (
  ownerKey: Uint8Array,
  mcpSession: string,
  role: 'leader' | 'follower',
): ActorContext['authSessionId'] => {
  if (role !== 'leader' && role !== 'follower') throw new Error('invalid MCP election role');
  return `auth1_${ownerHmac(ownerKey, 'sfp-auth-v1', 'mcp', mcpSession)}`;
};

export const deriveControlAuthSession = (
  ownerKey: Uint8Array,
  controlCredential: string,
  leaderGeneration = 'unknown',
): ActorContext['authSessionId'] => {
  const fingerprint = createHash('sha256')
    .update('sfp-control-credential-v1', 'utf8')
    .update(zero)
    .update(controlCredential, 'utf8')
    .digest('hex');
  return `auth1_${ownerHmac(
    ownerKey,
    'sfp-auth-v1',
    'control',
    leaderGeneration,
    `sha256:${fingerprint}`,
  )}`;
};
