import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { PRODUCT_MAGIC } from '@sfp/shared';

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
  issueFollowerChallenge(): Promise<FollowerChallenge>;
  openFollowerRequest(input: OpenFollowerRequest): Promise<Buffer>;
}

export interface FollowerChallenge {
  product: typeof PRODUCT_MAGIC;
  generation: string;
  nonce: string;
  expiresAt: number;
  proof: string;
}

export interface SealedFollowerRequest {
  headers: Record<string, string>;
  body: Buffer;
}

export interface OpenFollowerRequest {
  method: 'POST';
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  ciphertext: Buffer;
}

export class FollowerAuthError extends Error {
  readonly code = 'FOLLOWER_AUTH_INVALID' as const;
  readonly status = 401;

  constructor() {
    super('FOLLOWER_AUTH_INVALID');
    this.name = 'FollowerAuthError';
  }
}

export interface FollowerAuthOptions {
  stateRoot?: string;
  permissions?: AuthStatePermissions;
  memory?: LeaderGenerationCredentials;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

const CREDENTIAL_FILE = 'leader-auth.json';
export const FOLLOWER_CHALLENGE_TTL_MS = 5_000;
export const FOLLOWER_CHALLENGE_CAP = 1_024;
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

const tokenBytes = (token: string): Buffer => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new FollowerAuthError();
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.byteLength !== 32) throw new FollowerAuthError();
  return bytes;
};

const challengeProof = (
  token: string,
  challenge: Pick<FollowerChallenge, 'generation' | 'nonce' | 'expiresAt'>,
): string =>
  createHmac('sha256', tokenBytes(token))
    .update('sfp-follower-challenge')
    .update('\0')
    .update(challenge.generation)
    .update('\0')
    .update(challenge.nonce)
    .update('\0')
    .update(String(challenge.expiresAt))
    .digest('base64url');

const followerRequestKey = (token: string, generation: string, nonce: string): Buffer =>
  createHmac('sha256', tokenBytes(token))
    .update('sfp-follower-request-key')
    .update('\0')
    .update(generation)
    .update('\0')
    .update(nonce)
    .digest();

const requestAad = (
  method: string,
  path: string,
  generation: string,
  nonce: string,
  bodyHash: string,
): Buffer => Buffer.from(JSON.stringify([method, path, generation, nonce, bodyHash]), 'utf8');

export const verifyFollowerChallenge = (
  token: string,
  challenge: FollowerChallenge,
  now = Date.now(),
): boolean => {
  if (
    challenge.product !== PRODUCT_MAGIC ||
    !/^[A-Za-z0-9_-]{22}$/.test(challenge.generation) ||
    !/^[A-Za-z0-9_-]{22}$/.test(challenge.nonce) ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    now >= challenge.expiresAt ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge.proof)
  ) {
    return false;
  }
  try {
    return secureStringEqual(challenge.proof, challengeProof(token, challenge));
  } catch {
    return false;
  }
};

export const sealFollowerRequest = (
  token: string,
  challenge: FollowerChallenge,
  method: 'POST',
  path: string,
  plaintext: Buffer,
  randomBytes: (size: number) => Buffer = systemRandomBytes,
  now = Date.now(),
): SealedFollowerRequest => {
  if (!verifyFollowerChallenge(token, challenge, now)) throw new FollowerAuthError();
  const iv = randomBytes(12);
  if (iv.byteLength !== 12) throw new FollowerAuthError();
  const bodyHash = createHash('sha256').update(plaintext).digest('hex');
  const cipher = createCipheriv(
    'aes-256-gcm',
    followerRequestKey(token, challenge.generation, challenge.nonce),
    iv,
  );
  cipher.setAAD(requestAad(method, path, challenge.generation, challenge.nonce, bodyHash));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    headers: {
      'content-type': 'application/sfp-encrypted',
      'x-sfp-leader-generation': challenge.generation,
      'x-sfp-follower-nonce': challenge.nonce,
      'x-sfp-follower-proof': challenge.proof,
      'x-sfp-follower-iv': iv.toString('base64url'),
      'x-sfp-follower-tag': tag.toString('base64url'),
      'x-sfp-body-sha256': bodyHash,
    },
    body,
  };
};

export const createFollowerAuth = async (options: FollowerAuthOptions): Promise<FollowerAuth> => {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? systemRandomBytes;
  let memory = options.memory === undefined ? undefined : { ...options.memory };
  const followerChallenges = new Map<string, { generation: string; expiresAt: number }>();

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
    followerChallenges.clear();
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

  const issueFollowerChallenge = async (): Promise<FollowerChallenge> => {
    const current = await readCurrent();
    if (current === undefined) throw new FollowerAuthError();
    const at = now();
    for (const [nonce, challenge] of followerChallenges) {
      if (at >= challenge.expiresAt) followerChallenges.delete(nonce);
    }
    if (followerChallenges.size >= FOLLOWER_CHALLENGE_CAP) throw new FollowerAuthError();
    let nonce = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomBytes(16).toString('base64url');
      if (!followerChallenges.has(candidate)) {
        nonce = candidate;
        break;
      }
    }
    if (nonce === '') throw new FollowerAuthError();
    const challenge: FollowerChallenge = {
      product: PRODUCT_MAGIC,
      generation: current.generation,
      nonce,
      expiresAt: at + FOLLOWER_CHALLENGE_TTL_MS,
      proof: '',
    };
    challenge.proof = challengeProof(current.followerToken, challenge);
    followerChallenges.set(nonce, {
      generation: current.generation,
      expiresAt: challenge.expiresAt,
    });
    return challenge;
  };

  const openFollowerRequest = async (input: OpenFollowerRequest): Promise<Buffer> => {
    const generation = input.headers['x-sfp-leader-generation'];
    const nonce = input.headers['x-sfp-follower-nonce'];
    const proof = input.headers['x-sfp-follower-proof'];
    const ivValue = input.headers['x-sfp-follower-iv'];
    const tagValue = input.headers['x-sfp-follower-tag'];
    const bodyHash = input.headers['x-sfp-body-sha256'];
    if (
      generation === undefined ||
      nonce === undefined ||
      proof === undefined ||
      ivValue === undefined ||
      tagValue === undefined ||
      bodyHash === undefined ||
      !/^[A-Za-z0-9_-]{22}$/.test(nonce) ||
      !/^[A-Za-z0-9_-]{16}$/.test(ivValue) ||
      !/^[A-Za-z0-9_-]{22}$/.test(tagValue) ||
      !/^[a-f0-9]{64}$/.test(bodyHash)
    ) {
      throw new FollowerAuthError();
    }
    const issued = followerChallenges.get(nonce);
    if (issued === undefined) throw new FollowerAuthError();
    followerChallenges.delete(nonce);
    const current = await readCurrent();
    if (
      current === undefined ||
      now() >= issued.expiresAt ||
      !secureStringEqual(generation, issued.generation) ||
      !secureStringEqual(generation, current.generation) ||
      !secureStringEqual(
        proof,
        challengeProof(current.followerToken, {
          generation,
          nonce,
          expiresAt: issued.expiresAt,
        }),
      )
    ) {
      throw new FollowerAuthError();
    }
    try {
      const iv = Buffer.from(ivValue, 'base64url');
      const tag = Buffer.from(tagValue, 'base64url');
      if (iv.byteLength !== 12 || tag.byteLength !== 16) throw new FollowerAuthError();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        followerRequestKey(current.followerToken, generation, nonce),
        iv,
      );
      decipher.setAAD(requestAad(input.method, input.path, generation, nonce, bodyHash));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
      const observedHash = createHash('sha256').update(plaintext).digest('hex');
      if (!secureStringEqual(observedHash, bodyHash)) throw new FollowerAuthError();
      return plaintext;
    } catch {
      throw new FollowerAuthError();
    }
  };

  return Object.freeze({
    permissions: options.permissions,
    rotate,
    authorization,
    authorizeFollower: (header: string | undefined, generation: string | undefined) =>
      authorize('follower', header, generation),
    authorizeControl: (header: string | undefined, generation: string | undefined) =>
      authorize('control', header, generation),
    issueFollowerChallenge,
    openFollowerRequest,
  });
};
