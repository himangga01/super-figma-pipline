import {
  createHmac,
  randomBytes as systemRandomBytes,
  randomInt as systemRandomInt,
  timingSafeEqual,
} from 'node:crypto';
import { link, lstat, open, readFile, readdir, rm } from 'node:fs/promises';
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
export const PAIR_HELLO_RECOVERY_TTL_MS = 5 * 1000;
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
  mutationRetryTimeoutMs?: number;
  /** Test seam after a full mutation is durable but before its revision is atomically published. */
  beforeStatePublish?: () => Promise<void>;
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
  helloHash: string;
  sessionId: string;
  pluginGeneration: string;
  credentialExpiresAt: number;
  resumeExpiresAt: number;
  prepareExpiresAt: number;
  recoverUntil: number;
  committed: boolean;
}

interface PairingState {
  version: 1;
  revision: number;
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
const STATE_REVISION = /^pairing-state\.v(\d{16})\.json$/;

class PairingStateConflict extends Error {}

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
  revision: 0,
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
    (value.revision !== undefined &&
      (!Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0)) ||
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
  const helloTransactions = (value.helloTransactions ?? []).flatMap(item => {
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
    const transaction = item as Partial<StoredHelloTransaction>;
    if (
      transaction.helloHash === undefined ||
      transaction.credentialExpiresAt === undefined ||
      transaction.recoverUntil === undefined
    ) {
      return [];
    }
    if (
      typeof transaction.helloHash !== 'string' ||
      !Number.isSafeInteger(transaction.credentialExpiresAt) ||
      !Number.isSafeInteger(transaction.recoverUntil)
    ) {
      throw new Error('invalid stored hello recovery binding');
    }
    return [
      {
        preparationId: transaction.preparationId,
        credentialKind: transaction.credentialKind,
        credentialHash: transaction.credentialHash,
        nonceHash: transaction.nonceHash,
        helloHash: transaction.helloHash,
        sessionId: transaction.sessionId,
        pluginGeneration: transaction.pluginGeneration,
        credentialExpiresAt: transaction.credentialExpiresAt,
        resumeExpiresAt: transaction.resumeExpiresAt,
        prepareExpiresAt: transaction.prepareExpiresAt,
        recoverUntil: transaction.recoverUntil,
        committed: transaction.committed,
      } as StoredHelloTransaction,
    ];
  });
  return {
    version: 1,
    revision: value.revision ?? 0,
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
  const mutationRetryTimeoutMs = options.mutationRetryTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(mutationRetryTimeoutMs) || mutationRetryTimeoutMs <= 0) {
    throw new TypeError('pairing mutation retry timeout must be a positive safe integer');
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

  const withMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    activeMutations += 1;
    const startedAt = Date.now();
    try {
      /* eslint-disable no-await-in-loop -- CAS conflicts must re-run the complete transaction */
      while (true) {
        try {
          return await operation();
        } catch (error) {
          if (!(error instanceof PairingStateConflict)) throw error;
          if (Date.now() - startedAt >= mutationRetryTimeoutMs) {
            throw new PairingError('PAIR_INTERNAL', 500, { cause: error });
          }
          await new Promise<void>(resolvePromise => setTimeout(resolvePromise, 1));
        }
      }
      /* eslint-enable no-await-in-loop */
    } finally {
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

  const revisionPath = (revision: number): string =>
    join(stateRoot, `pairing-state.v${String(revision).padStart(16, '0')}.json`);

  const loadState = async (): Promise<PairingState> => {
    const revisions = (await readdir(stateRoot))
      .map(name => STATE_REVISION.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => Number(match[1]))
      .filter(Number.isSafeInteger)
      .toSorted((left, right) => right - left);
    const latest = revisions[0];
    if (latest !== undefined) {
      const path = revisionPath(latest);
      await options.permissions.verifySecure(path);
      const state = parseState(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (state.revision !== latest) throw new Error('pairing revision filename mismatch');
      return state;
    }
    if (!(await pathExists(statePath))) return emptyState();
    await options.permissions.verifySecure(statePath);
    const legacy = parseState(JSON.parse(await readFile(statePath, 'utf8')) as unknown);
    legacy.revision = 0;
    return legacy;
  };

  const saveState = async (state: PairingState): Promise<void> => {
    const nextRevision = state.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('pairing revision exhausted');
    const target = revisionPath(nextRevision);
    const temporary = join(
      dirname(statePath),
      `.${STATE_FILE}.${nextRevision}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let published = false;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ ...state, revision: nextRevision }), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await options.permissions.ensureSecure(temporary);
      await options.permissions.verifySecure(temporary);
      await options.beforeStatePublish?.();
      try {
        await link(temporary, target);
        published = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new PairingStateConflict('pairing revision already published');
        }
        throw error;
      }
      await options.permissions.verifySecure(target);
      state.revision = nextRevision;
      await syncStateDirectory();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (!published || error instanceof PairingStateConflict) {
        await rm(temporary, { force: true }).catch(() => {});
      }
      throw error;
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
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
      const helloHash = digest(
        'hello-binding',
        JSON.stringify([
          credentialKind,
          credentialHash,
          nonceHash,
          hello.protocolVersion,
          hello.productVersion,
          hello.pluginVersion,
          hello.pluginGeneration,
          hello.editorType,
          hello.mode,
          hello.fileIdentity,
          hello.fileName,
          hello.capabilities,
        ]),
      );
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
        if (!secureHashEqual(exact.helloHash, helloHash)) {
          throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
        }
        if (at >= exact.recoverUntil || at >= exact.credentialExpiresAt) {
          state.helloTransactions = state.helloTransactions.filter(
            transaction => transaction !== exact,
          );
          await saveState(state);
          if (at >= exact.credentialExpiresAt) {
            throw new PairingError(
              exact.credentialKind === 'ticket' ? 'PAIR_TICKET_EXPIRED' : 'PAIR_RESUME_EXPIRED',
              401,
            );
          }
          throw new PairingError(
            exact.credentialKind === 'ticket' ? 'PAIR_TICKET_USED' : 'PAIR_RESUME_USED',
            401,
          );
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
        if (at >= ticket.expiresAt) throw new PairingError('PAIR_TICKET_EXPIRED', 401);
        if (ticket.used) throw new PairingError('PAIR_TICKET_USED', 401);
        credentialExpiresAt = ticket.expiresAt;
        sessionId = derive('hello-session', credentialHash, nonceHash)
          .subarray(0, 16)
          .toString('base64url');
      } else {
        const resume = state.resumes.find(item => secureHashEqual(item.hash, credentialHash));
        if (resume === undefined) throw new PairingError('PAIR_RESUME_INVALID', 401);
        if (at >= resume.expiresAt) throw new PairingError('PAIR_RESUME_EXPIRED', 401);
        if (resume.used) throw new PairingError('PAIR_RESUME_USED', 401);
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
        helloHash,
        sessionId,
        pluginGeneration: hello.pluginGeneration,
        credentialExpiresAt,
        resumeExpiresAt: at + PAIR_RESUME_TTL_MS,
        prepareExpiresAt: Math.min(at + PAIR_HELLO_PREPARE_TTL_MS, credentialExpiresAt),
        recoverUntil: Math.min(at + PAIR_HELLO_RECOVERY_TTL_MS, credentialExpiresAt),
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
      const at = now();
      if (at >= transaction.recoverUntil || at >= transaction.credentialExpiresAt) {
        state.helloTransactions = state.helloTransactions.filter(item => item !== transaction);
        await saveState(state);
        throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
      }
      if (at >= transaction.prepareExpiresAt) {
        throw new PairingError('PAIR_CREDENTIAL_REQUIRED', 401);
      }

      if (transaction.credentialKind === 'ticket') {
        const ticket = state.tickets.find(item =>
          secureHashEqual(item.hash, transaction.credentialHash),
        );
        if (ticket === undefined) throw new PairingError('PAIR_TICKET_INVALID', 401);
        if (at >= ticket.expiresAt) throw new PairingError('PAIR_TICKET_EXPIRED', 401);
        if (transaction.committed) return;
        if (ticket.used) throw new PairingError('PAIR_TICKET_USED', 401);
        ticket.used = true;
      } else {
        const resume = state.resumes.find(item =>
          secureHashEqual(item.hash, transaction.credentialHash),
        );
        if (resume === undefined) throw new PairingError('PAIR_RESUME_INVALID', 401);
        if (at >= resume.expiresAt) throw new PairingError('PAIR_RESUME_EXPIRED', 401);
        if (transaction.committed) return;
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
