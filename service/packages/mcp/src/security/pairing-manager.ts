import {
  createHmac,
  randomBytes as systemRandomBytes,
  randomInt as systemRandomInt,
  timingSafeEqual,
} from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  AuthenticatedHelloSchema,
  type AuthenticatedHello,
  type AuthenticatedHelloResult,
  type PairChallengeIssued,
  type PairErrorCode,
  type PairExchangeResult,
} from '@sfp/shared';

import type { AuthStatePermissions } from './follower-auth.js';

export const PAIR_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PAIR_TICKET_TTL_MS = 30 * 1000;
export const PAIR_RESUME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PAIR_HELLO_PREPARE_TTL_MS = 30 * 1000;
export const PAIR_ATTEMPTS = 5;

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export interface PairingManagerOptions {
  stateRoot: string;
  permissions: AuthStatePermissions;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  randomInt?: (maxExclusive: number) => number;
  challengeRateLimit?: RateLimit;
  exchangeRateLimit?: RateLimit;
  log?: (message: string) => void;
  lockTimeoutMs?: number;
  staleLockMs?: number;
  /** Test seam that pauses after the cross-process lock is exclusively owned. */
  afterLockAcquired?: () => Promise<void>;
}

export class PairingError extends Error {
  readonly attemptsRemaining: number | undefined;

  constructor(
    readonly code: PairErrorCode,
    readonly status: number,
    options: { attemptsRemaining?: number; cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PairingError';
    this.attemptsRemaining = options.attemptsRemaining;
  }
}

export interface PairingManager {
  createChallenge(actor: string): Promise<PairChallengeIssued>;
  exchange(challengeId: string, code: string): Promise<PairExchangeResult>;
  prepareHello(input: unknown): Promise<PreparedHello>;
  commitHello(preparationId: string): Promise<void>;
  authenticateHello(input: unknown): Promise<AuthenticatedHelloResult>;
  drain(): Promise<void>;
}

export interface PreparedHello {
  preparationId: string;
  result: AuthenticatedHelloResult;
}

interface StoredChallenge {
  challengeId: string;
  codeHash: string;
  expiresAt: number;
  attemptsRemaining: number;
  used: boolean;
}

interface StoredTicket {
  hash: string;
  expiresAt: number;
  used: boolean;
}

interface StoredResume {
  hash: string;
  sessionId: string;
  pluginGeneration: string;
  expiresAt: number;
  used: boolean;
}

interface StoredHelloTransaction {
  preparationId: string;
  credentialKind: 'ticket' | 'resume';
  credentialHash: string;
  nonceHash: string;
  sessionId: string;
  pluginGeneration: string;
  resumeExpiresAt: number;
  prepareExpiresAt: number;
  committed: boolean;
}

interface PairingState {
  version: 1;
  challenges: StoredChallenge[];
  tickets: StoredTicket[];
  resumes: StoredResume[];
  helloTransactions: StoredHelloTransaction[];
  challengeAttempts: number[];
  exchangeAttempts: number[];
}

const KEY_FILE = 'pairing-hmac.key';
const STATE_FILE = 'pairing-state.json';
const LOCK_FILE = '.pairing-state.lock';

export const pairingLockPath = (stateRoot: string): string => join(resolve(stateRoot), LOCK_FILE);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

const emptyState = (): PairingState => ({
  version: 1,
  challenges: [],
  tickets: [],
  resumes: [],
  helloTransactions: [],
  challengeAttempts: [],
  exchangeAttempts: [],
});

const secureHashEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'base64url');
  const b = Buffer.from(right, 'base64url');
  const size = Math.max(a.byteLength, b.byteLength, 1);
  const paddedA = Buffer.alloc(size);
  const paddedB = Buffer.alloc(size);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.byteLength === b.byteLength;
};

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32[(value << (5 - bits)) & 31];
  return result;
};

const validRateLimit = (input: RateLimit): RateLimit => {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit <= 0 ||
    !Number.isSafeInteger(input.windowMs) ||
    input.windowMs <= 0
  ) {
    throw new TypeError('pairing rate limits must be positive safe integers');
  }
  return { ...input };
};

const strictNumberArray = (input: unknown): input is number[] =>
  Array.isArray(input) && input.every(value => Number.isSafeInteger(value) && value >= 0);

const parseState = (input: unknown): PairingState => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('invalid pairing state');
  }
  const value = input as Partial<PairingState>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.challenges) ||
    !Array.isArray(value.tickets) ||
    !Array.isArray(value.resumes) ||
    (value.helloTransactions !== undefined && !Array.isArray(value.helloTransactions)) ||
    !strictNumberArray(value.challengeAttempts) ||
    !strictNumberArray(value.exchangeAttempts)
  ) {
    throw new Error('invalid pairing state');
  }
  const challenges = value.challenges.map(item => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as StoredChallenge).challengeId !== 'string' ||
      typeof (item as StoredChallenge).codeHash !== 'string' ||
      !Number.isSafeInteger((item as StoredChallenge).expiresAt) ||
      !Number.isSafeInteger((item as StoredChallenge).attemptsRemaining) ||
      typeof (item as StoredChallenge).used !== 'boolean'
    ) {
      throw new Error('invalid stored challenge');
    }
    return { ...(item as StoredChallenge) };
  });
  const tickets = value.tickets.map(item => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as StoredTicket).hash !== 'string' ||
      !Number.isSafeInteger((item as StoredTicket).expiresAt) ||
      typeof (item as StoredTicket).used !== 'boolean'
    ) {
      throw new Error('invalid stored ticket');
    }
    return { ...(item as StoredTicket) };
  });
  const resumes = value.resumes.map(item => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as StoredResume).hash !== 'string' ||
      typeof (item as StoredResume).sessionId !== 'string' ||
      typeof (item as StoredResume).pluginGeneration !== 'string' ||
      !Number.isSafeInteger((item as StoredResume).expiresAt) ||
      typeof (item as StoredResume).used !== 'boolean'
    ) {
      throw new Error('invalid stored resume');
    }
    return { ...(item as StoredResume) };
  });
  const helloTransactions = (value.helloTransactions ?? []).map(item => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as StoredHelloTransaction).preparationId !== 'string' ||
      !['ticket', 'resume'].includes((item as StoredHelloTransaction).credentialKind) ||
      typeof (item as StoredHelloTransaction).credentialHash !== 'string' ||
      typeof (item as StoredHelloTransaction).nonceHash !== 'string' ||
      typeof (item as StoredHelloTransaction).sessionId !== 'string' ||
      typeof (item as StoredHelloTransaction).pluginGeneration !== 'string' ||
      !Number.isSafeInteger((item as StoredHelloTransaction).resumeExpiresAt) ||
      !Number.isSafeInteger((item as StoredHelloTransaction).prepareExpiresAt) ||
      typeof (item as StoredHelloTransaction).committed !== 'boolean'
    ) {
      throw new Error('invalid stored hello transaction');
    }
    const transaction = item as StoredHelloTransaction;
    return {
      preparationId: transaction.preparationId,
      credentialKind: transaction.credentialKind,
      credentialHash: transaction.credentialHash,
      nonceHash: transaction.nonceHash,
      sessionId: transaction.sessionId,
      pluginGeneration: transaction.pluginGeneration,
      resumeExpiresAt: transaction.resumeExpiresAt,
      prepareExpiresAt: transaction.prepareExpiresAt,
      committed: transaction.committed,
    };
  });
  return {
    version: 1,
    challenges,
    tickets,
    resumes,
    helloTransactions,
    challengeAttempts: [...value.challengeAttempts],
    exchangeAttempts: [...value.exchangeAttempts],
  };
};

const SECRET_KEY = /(?:^code$|hash$|token|ticket|authorization|credential|secret)/i;

export const redactAuthSecrets = (input: unknown): unknown => {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[REDACTED]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? '[REDACTED]' : visit(child);
    }
    return output;
  };
  return visit(input);
};

export const createPairingManager = async (
  options: PairingManagerOptions,
): Promise<PairingManager> => {
  const stateRoot = resolve(options.stateRoot);
  if (resolve(options.permissions.stateRoot) !== stateRoot) {
    throw new Error('pairing stateRoot does not match its permission authority');
  }
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? systemRandomBytes;
  const randomInt = options.randomInt ?? systemRandomInt;
  const challengeRateLimit = validRateLimit(
    options.challengeRateLimit ?? { limit: 10, windowMs: 60_000 },
  );
  const exchangeRateLimit = validRateLimit(
    options.exchangeRateLimit ?? { limit: 30, windowMs: 60_000 },
  );
  const log = options.log ?? ((): void => {});
  const keyPath = join(stateRoot, KEY_FILE);
  const statePath = join(stateRoot, STATE_FILE);
  const lockPath = pairingLockPath(stateRoot);
  const lockTimeoutMs = options.lockTimeoutMs ?? 15_000;
  const staleLockMs = options.staleLockMs ?? 120_000;
  if (
    !Number.isSafeInteger(lockTimeoutMs) ||
    lockTimeoutMs <= 0 ||
    !Number.isSafeInteger(staleLockMs) ||
    staleLockMs <= lockTimeoutMs
  ) {
    throw new TypeError(
      'pairing lock windows must be positive and staleLockMs must exceed timeout',
    );
  }

  let activeMutations = 0;
  const drainWaiters = new Set<() => void>();

  await options.permissions.verifySecure(stateRoot);

  const syncStateDirectory = async (): Promise<void> => {
    if (process.platform === 'win32') return;
    const directory = await open(stateRoot, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  };

  const acquireMutationLock = async (): Promise<() => Promise<void>> => {
    const startedAt = Date.now();
    const nonce = randomBytes(16).toString('base64url');
    /* eslint-disable no-await-in-loop -- exclusive-file lock acquisition is intentionally serial */
    while (true) {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let created = false;
      try {
        handle = await open(lockPath, 'wx', 0o600);
        created = true;
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, createdAt: Date.now() }));
        await handle.sync();
        await handle.close();
        handle = undefined;
        await options.afterLockAcquired?.();
        return async (): Promise<void> => {
          if (!(await pathExists(lockPath))) return;
          let owner: { nonce?: unknown } | undefined;
          try {
            owner = JSON.parse(await readFile(lockPath, 'utf8')) as { nonce?: unknown };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          if (owner.nonce === nonce) {
            await rm(lockPath, { force: true });
            await syncStateDirectory();
          }
        };
      } catch (error) {
        await handle?.close().catch(() => {});
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          if (created) await rm(lockPath, { force: true }).catch(() => {});
          throw error;
        }
        const metadata = await lstat(lockPath).catch(() => undefined);
        if (metadata !== undefined && Date.now() - metadata.mtimeMs >= staleLockMs) {
          const stalePath = `${lockPath}.${randomBytes(8).toString('hex')}.stale`;
          try {
            await rename(lockPath, stalePath);
            await rm(stalePath, { force: true });
            continue;
          } catch {
            // Another contender or the owner changed the lock; retry the observed state.
          }
        }
        if (Date.now() - startedAt >= lockTimeoutMs) {
          throw new PairingError('PAIR_INTERNAL', 500, { cause: error });
        }
        await new Promise<void>(resolvePromise => setTimeout(resolvePromise, 5));
      }
    }
    /* eslint-enable no-await-in-loop */
  };

  const withMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    activeMutations += 1;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireMutationLock();
      return await operation();
    } finally {
      await release?.();
      activeMutations -= 1;
      if (activeMutations === 0) {
        for (const waiter of drainWaiters) waiter();
        drainWaiters.clear();
      }
    }
  };

  const drain = async (): Promise<void> => {
    if (activeMutations === 0) return;
    await new Promise<void>(resolvePromise => drainWaiters.add(resolvePromise));
  };

  const loadKey = async (): Promise<Buffer> => {
    if (await pathExists(keyPath)) {
      await options.permissions.verifySecure(keyPath);
      const stored = await readFile(keyPath);
      if (stored.byteLength !== 32) throw new Error('invalid pairing HMAC key');
      return stored;
    }
    const candidate = randomBytes(32);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(keyPath, 'wx', 0o600);
      await handle.writeFile(candidate);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await options.permissions.ensureSecure(keyPath);
      await options.permissions.verifySecure(keyPath);
      await syncStateDirectory();
      return candidate;
    } catch (error) {
      await handle?.close().catch(() => {});
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await options.permissions.verifySecure(keyPath);
      const stored = await readFile(keyPath);
      if (stored.byteLength !== 32) {
        throw new Error('invalid pairing HMAC key', { cause: error });
      }
      return stored;
    }
  };

  const key = await loadKey();
  const digest = (domain: string, secret: string): string =>
    createHmac('sha256', key).update(domain).update('\0').update(secret).digest('base64url');
  const derive = (domain: string, ...parts: string[]): Buffer => {
    const hmac = createHmac('sha256', key).update(domain);
    for (const part of parts) hmac.update('\0').update(part);
    return hmac.digest();
  };

  const loadState = async (): Promise<PairingState> => {
    if (!(await pathExists(statePath))) return emptyState();
    await options.permissions.verifySecure(statePath);
    return parseState(JSON.parse(await readFile(statePath, 'utf8')) as unknown);
  };

  const saveState = async (state: PairingState): Promise<void> => {
    const temporary = join(
      dirname(statePath),
      `.${STATE_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await options.permissions.ensureSecure(temporary);
      await options.permissions.verifySecure(temporary);
      await rename(temporary, statePath);
      await options.permissions.ensureSecure(statePath);
      await options.permissions.verifySecure(statePath);
      await syncStateDirectory();
    } catch (error) {
      await handle?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  };

  const recordAttempt = (attempts: number[], limit: RateLimit, at: number): number[] => {
    const live = attempts.filter(timestamp => timestamp > at - limit.windowMs);
    if (live.length >= limit.limit) throw new PairingError('PAIR_RATE_LIMITED', 429);
    live.push(at);
    return live;
  };

  const createChallenge = async (actor: string): Promise<PairChallengeIssued> => {
    if (typeof actor !== 'string' || actor.trim() === '') {
      throw new PairingError('PAIR_BODY_INVALID', 400);
    }
    return withMutation(async () => {
      const state = await loadState();
      const at = now();
      state.challengeAttempts = recordAttempt(state.challengeAttempts, challengeRateLimit, at);
      let challengeId = '';
      do {
        challengeId = base32(randomBytes(7)).slice(0, 10);
      } while (state.challenges.some(item => item.challengeId === challengeId));
      const code = randomInt(100_000_000).toString().padStart(8, '0');
      const issued: PairChallengeIssued = {
        challengeId,
        code,
        expiresAt: at + PAIR_CHALLENGE_TTL_MS,
        attemptsRemaining: PAIR_ATTEMPTS,
      };
      state.challenges.push({
        challengeId,
        codeHash: digest('pair-code', code),
        expiresAt: issued.expiresAt,
        attemptsRemaining: issued.attemptsRemaining,
        used: false,
      });
      await saveState(state);
      log(`[pairing] challenge ${challengeId} issued`);
      return issued;
    });
  };

  const exchange = async (challengeId: string, code: string): Promise<PairExchangeResult> =>
    withMutation(async () => {
      const state = await loadState();
      const at = now();
      state.exchangeAttempts = recordAttempt(state.exchangeAttempts, exchangeRateLimit, at);
      const challenge = state.challenges.find(item => item.challengeId === challengeId);
      if (challenge === undefined || !/^[A-Z2-7]{10}$/.test(challengeId) || !/^\d{8}$/.test(code)) {
        await saveState(state);
        throw new PairingError('PAIR_CODE_WRONG', 401);
      }
      if (challenge.used || challenge.attemptsRemaining === 0) {
        await saveState(state);
        throw new PairingError('PAIR_CODE_USED', 409);
      }
      if (at >= challenge.expiresAt) {
        await saveState(state);
        throw new PairingError('PAIR_CODE_EXPIRED', 401);
      }
      if (!secureHashEqual(challenge.codeHash, digest('pair-code', code))) {
        challenge.attemptsRemaining -= 1;
        if (challenge.attemptsRemaining === 0) challenge.used = true;
        await saveState(state);
        throw new PairingError('PAIR_CODE_WRONG', 401, {
          attemptsRemaining: challenge.attemptsRemaining,
        });
      }

      challenge.used = true;
      const wsTicket = randomBytes(16).toString('base64url');
      const result: PairExchangeResult = {
        wsTicket,
        expiresAt: at + PAIR_TICKET_TTL_MS,
      };
      state.tickets.push({
        hash: digest('ws-ticket', wsTicket),
        expiresAt: result.expiresAt,
        used: false,
      });
      await saveState(state);
      log(`[pairing] challenge ${challengeId} exchanged`);
      return result;
    });

  const prepareHello = async (input: unknown): Promise<PreparedHello> => {
    const parsed = AuthenticatedHelloSchema.safeParse(input);
    if (!parsed.success) throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
    const hello: AuthenticatedHello = parsed.data;
    return withMutation(async () => {
      const state = await loadState();
      const at = now();
      state.helloTransactions = state.helloTransactions.filter(
        transaction => transaction.committed || transaction.prepareExpiresAt > at,
      );
      const credentialKind = hello.credential.kind;
      const credentialHash =
        credentialKind === 'ticket'
          ? digest('ws-ticket', hello.credential.value)
          : digest('resume-token', hello.credential.value);
      const nonceHash = digest('hello-nonce', hello.nonce);
      const exact = state.helloTransactions.find(
        transaction =>
          transaction.credentialKind === credentialKind &&
          secureHashEqual(transaction.credentialHash, credentialHash) &&
          secureHashEqual(transaction.nonceHash, nonceHash),
      );
      const resultFor = (transaction: StoredHelloTransaction): PreparedHello => ({
        preparationId: transaction.preparationId,
        result: {
          sessionId: transaction.sessionId,
          rotatedResumeToken: derive(
            'hello-resume-successor',
            transaction.credentialHash,
            transaction.nonceHash,
          ).toString('base64url'),
          resumeExpiresAt: transaction.resumeExpiresAt,
        },
      });
      if (exact !== undefined) {
        if (exact.pluginGeneration !== hello.pluginGeneration) {
          throw new PairingError('PAIR_GENERATION_MISMATCH', 401);
        }
        return resultFor(exact);
      }
      const conflicting = state.helloTransactions.find(
        transaction =>
          !transaction.committed &&
          transaction.credentialKind === credentialKind &&
          secureHashEqual(transaction.credentialHash, credentialHash),
      );
      if (conflicting !== undefined) throw new PairingError('PAIR_HELLO_PENDING', 409);

      let sessionId: string;
      let credentialExpiresAt: number;

      if (credentialKind === 'ticket') {
        const ticket = state.tickets.find(item => secureHashEqual(item.hash, credentialHash));
        if (ticket === undefined) throw new PairingError('PAIR_TICKET_INVALID', 401);
        if (ticket.used) throw new PairingError('PAIR_TICKET_USED', 401);
        if (at >= ticket.expiresAt) throw new PairingError('PAIR_TICKET_EXPIRED', 401);
        credentialExpiresAt = ticket.expiresAt;
        sessionId = derive('hello-session', credentialHash, nonceHash)
          .subarray(0, 16)
          .toString('base64url');
      } else {
        const resume = state.resumes.find(item => secureHashEqual(item.hash, credentialHash));
        if (resume === undefined) throw new PairingError('PAIR_RESUME_INVALID', 401);
        if (resume.used) throw new PairingError('PAIR_RESUME_USED', 401);
        if (at >= resume.expiresAt) throw new PairingError('PAIR_RESUME_EXPIRED', 401);
        if (resume.pluginGeneration !== hello.pluginGeneration) {
          throw new PairingError('PAIR_GENERATION_MISMATCH', 401);
        }
        credentialExpiresAt = resume.expiresAt;
        sessionId = resume.sessionId;
      }

      const transaction: StoredHelloTransaction = {
        preparationId: derive('hello-preparation', credentialHash, nonceHash).toString('base64url'),
        credentialKind,
        credentialHash,
        nonceHash,
        sessionId,
        pluginGeneration: hello.pluginGeneration,
        resumeExpiresAt: at + PAIR_RESUME_TTL_MS,
        prepareExpiresAt: Math.min(at + PAIR_HELLO_PREPARE_TTL_MS, credentialExpiresAt),
        committed: false,
      };
      state.helloTransactions.push(transaction);
      await saveState(state);
      return resultFor(transaction);
    });
  };

  const commitHello = async (preparationId: string): Promise<void> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(preparationId)) {
      throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
    }
    await withMutation(async () => {
      const state = await loadState();
      const transaction = state.helloTransactions.find(
        item => item.preparationId === preparationId,
      );
      if (transaction === undefined) throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
      if (transaction.committed) return;
      if (now() >= transaction.prepareExpiresAt) {
        throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
      }

      if (transaction.credentialKind === 'ticket') {
        const ticket = state.tickets.find(item =>
          secureHashEqual(item.hash, transaction.credentialHash),
        );
        if (ticket === undefined) throw new PairingError('PAIR_TICKET_INVALID', 401);
        if (ticket.used) throw new PairingError('PAIR_TICKET_USED', 401);
        ticket.used = true;
      } else {
        const resume = state.resumes.find(item =>
          secureHashEqual(item.hash, transaction.credentialHash),
        );
        if (resume === undefined) throw new PairingError('PAIR_RESUME_INVALID', 401);
        if (resume.used) throw new PairingError('PAIR_RESUME_USED', 401);
        resume.used = true;
      }

      const rotatedResumeToken = derive(
        'hello-resume-successor',
        transaction.credentialHash,
        transaction.nonceHash,
      ).toString('base64url');
      state.resumes.push({
        hash: digest('resume-token', rotatedResumeToken),
        sessionId: transaction.sessionId,
        pluginGeneration: transaction.pluginGeneration,
        expiresAt: transaction.resumeExpiresAt,
        used: false,
      });
      transaction.committed = true;
      await saveState(state);
      log(`[pairing] session ${transaction.sessionId} authenticated`);
    });
  };

  const authenticateHello = async (input: unknown): Promise<AuthenticatedHelloResult> => {
    const prepared = await prepareHello(input);
    await commitHello(prepared.preparationId);
    return prepared.result;
  };

  return Object.freeze({
    createChallenge,
    exchange,
    prepareHello,
    commitHello,
    authenticateHello,
    drain,
  });
};
