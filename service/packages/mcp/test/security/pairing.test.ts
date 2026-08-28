import { chmod, lstat, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AuthenticatedHello,
  createRequest,
  decodeEnvelope,
  encodeEnvelope,
  ErrorCode,
  newId,
  SystemMethod,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Relay } from '../../src/relay/relay.js';
import {
  createPairingManager,
  PAIR_HELLO_RECOVERY_TTL_MS,
  PAIR_STATE_REVISION_RETAIN_COUNT,
  type PairingManager,
  pairingLockPath,
  redactAuthSecrets,
} from '../../src/security/pairing-manager.js';

const roots: string[] = [];
const servers: { http: Server; relay: Relay }[] = [];

const secureTestRoot = async (): Promise<{
  stateRoot: string;
  permissions: {
    stateRoot: string;
    ensureSecure(path: string): Promise<void>;
    verifySecure(path: string): Promise<void>;
  };
}> => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-pairing-'));
  roots.push(stateRoot);
  await chmod(stateRoot, 0o700);
  return {
    stateRoot,
    permissions: {
      stateRoot,
      ensureSecure: async path => chmod(path, path === stateRoot ? 0o700 : 0o600),
      verifySecure: async () => {},
    },
  };
};

const hello = (
  credential: AuthenticatedHello['credential'],
  pluginGeneration = 'plugin-generation-a',
): AuthenticatedHello => ({
  credential,
  nonce: Buffer.alloc(16, 7).toString('base64url'),
  protocolVersion: '0.1.0',
  productVersion: '0.1.0',
  pluginVersion: '0.1.0',
  pluginGeneration,
  editorType: 'figma',
  mode: 'default',
  fileIdentity: { kind: 'figma-file-key', value: 'file-key-1' },
  fileName: 'Security Fixture',
  capabilities: ['read'],
});

const openManager = async (
  overrides: Partial<Parameters<typeof createPairingManager>[0]> = {},
): Promise<PairingManager> => {
  const { stateRoot, permissions } = await secureTestRoot();
  return createPairingManager({ stateRoot, permissions, ...overrides });
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async ({ http, relay }) => {
      await relay.stop();
      await new Promise<void>(resolve => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    }),
  );
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const startRelay = async (
  authenticator: PairingManager,
  log?: (message: string) => void,
  helloTimeoutMs?: number,
): Promise<{ port: number; relay: Relay }> => {
  const http = createServer();
  const relay = new Relay({
    server: http,
    serverVersion: '0.1.0',
    authenticator,
    ...(log === undefined ? {} : { log }),
    ...(helloTimeoutMs === undefined ? {} : { helloTimeoutMs }),
  });
  servers.push({ http, relay });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  return { port: (http.address() as AddressInfo).port, relay };
};

const connect = async (port: number): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
};

const nextEnvelope = (ws: WebSocket) =>
  new Promise<ReturnType<typeof decodeEnvelope>>((resolve, reject) => {
    ws.once('message', data => resolve(decodeEnvelope(data as Uint8Array)));
    ws.once('error', reject);
  });

describe('pairing challenge and exchange', () => {
  it('restarts immediately without stealing or deleting a crash-left legacy lock owner', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const legacyLock = pairingLockPath(stateRoot);
    const sentinel = JSON.stringify({
      pid: 999_999,
      nonce: 'successor-owner',
      createdAt: Date.now(),
    });
    await writeFile(legacyLock, sentinel, { mode: 0o600 });
    const manager = await createPairingManager({ stateRoot, permissions });

    await expect(manager.createChallenge('owner-local')).resolves.toMatchObject({
      attemptsRemaining: 5,
    });
    expect(await readFile(legacyLock, 'utf8')).toBe(sentinel);
  });

  it('uses revision CAS so independent stores consume a one-use exchange exactly once', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const setup = await createPairingManager({ stateRoot, permissions });
    const challenge = await setup.createChallenge('owner-local');

    let entered!: () => void;
    let release!: () => void;
    const lockEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const firstManager = await createPairingManager({
      stateRoot,
      permissions,
      beforeStatePublish: async () => {
        entered();
        await barrier;
      },
    });
    const secondManager = await createPairingManager({ stateRoot, permissions });

    const first = firstManager.exchange(challenge.challengeId, challenge.code);
    await lockEntered;
    const second = secondManager.exchange(challenge.challengeId, challenge.code);
    await expect(second).resolves.toMatchObject({ wsTicket: expect.any(String) });
    let drained = false;
    const drain = firstManager.drain().then(() => {
      drained = true;
      return undefined;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(drained).toBe(false);

    release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'PAIR_CODE_USED' } });
    await drain;
    expect(drained).toBe(true);
  });

  it('does not lose a different credential update across conflicting revision publications', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const setup = await createPairingManager({ stateRoot, permissions });
    const challengeA = await setup.createChallenge('owner-a');
    const challengeB = await setup.createChallenge('owner-b');

    let entered!: () => void;
    let release!: () => void;
    const lockEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const firstManager = await createPairingManager({
      stateRoot,
      permissions,
      beforeStatePublish: async () => {
        entered();
        await barrier;
      },
    });
    const secondManager = await createPairingManager({ stateRoot, permissions });
    const first = firstManager.exchange(challengeA.challengeId, challengeA.code);
    await lockEntered;
    const second = secondManager.exchange(challengeB.challengeId, challengeB.code);
    release();

    const [ticketA, ticketB] = await Promise.all([first, second]);
    await expect(
      setup.authenticateHello(hello({ kind: 'ticket', value: ticketA.wsTicket }, 'generation-a')),
    ).resolves.toMatchObject({ sessionId: expect.any(String) });
    await expect(
      setup.authenticateHello(hello({ kind: 'ticket', value: ticketB.wsTicket }, 'generation-b')),
    ).resolves.toMatchObject({ sessionId: expect.any(String) });
  });

  it('bounds monotonic revision GC across thousands of failed mutations and restart', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const manager = await createPairingManager({
      stateRoot,
      permissions,
      exchangeRateLimit: { limit: 2_000, windowMs: 60_000 },
    });

    const failures: string[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      try {
        await manager.exchange('AAAAAAAAAA', '00000000');
        throw new Error('unknown challenge unexpectedly exchanged');
      } catch (error) {
        failures.push((error as { code?: string }).code ?? 'UNKNOWN');
      }
    }
    expect(new Set(failures)).toEqual(new Set(['PAIR_CODE_WRONG']));
    expect(failures).toHaveLength(1_024);

    const revisions = (await readdir(stateRoot))
      .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
      .toSorted();
    expect(revisions).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
    expect(revisions.at(-1)).toBe('pairing-state.v0000000000001024.json');

    const restarted = await createPairingManager({ stateRoot, permissions });
    await expect(restarted.createChallenge('after-restart')).resolves.toMatchObject({
      attemptsRemaining: 5,
    });
    const afterRestart = (await readdir(stateRoot)).filter(name =>
      /^pairing-state\.v\d{16}\.json$/.test(name),
    );
    expect(afterRestart).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
  }, 30_000);

  it('recovers a valid latest revision after a crash left predecessor GC incomplete', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    for (let revision = 1; revision <= 12; revision += 1) {
      const path = join(stateRoot, `pairing-state.v${String(revision).padStart(16, '0')}.json`);
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          revision,
          challenges: [],
          tickets: [],
          resumes: [],
          helloTransactions: [],
          challengeAttempts: [],
          exchangeAttempts: [],
        }),
        { mode: 0o600 },
      );
      await permissions.ensureSecure(path);
    }

    const restarted = await createPairingManager({ stateRoot, permissions });
    const challenge = await restarted.createChallenge('crash-restart');
    const revisions = (await readdir(stateRoot))
      .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
      .toSorted();
    expect(revisions).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
    expect(revisions.at(-1)).toBe('pairing-state.v0000000000000013.json');
    expect(await readFile(join(stateRoot, revisions.at(-1)!), 'utf8')).toContain(
      challenge.challengeId,
    );
  });

  it.each(['EPERM', 'EBUSY'] as const)(
    'fails closed before publication when obsolete revision deletion returns %s',
    async code => {
      const { stateRoot, permissions } = await secureTestRoot();
      const setup = await createPairingManager({
        stateRoot,
        permissions,
        challengeRateLimit: { limit: 20, windowMs: 60_000 },
      });
      for (let index = 0; index < PAIR_STATE_REVISION_RETAIN_COUNT; index += 1) {
        await setup.createChallenge(`setup-${index}`);
      }
      const beforeNames = (await readdir(stateRoot))
        .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
        .toSorted();
      const beforeLatest = await readFile(join(stateRoot, beforeNames.at(-1)!));
      const blocked = await createPairingManager({
        stateRoot,
        permissions,
        challengeRateLimit: { limit: 20, windowMs: 60_000 },
        removeRevision: async () => {
          throw Object.assign(new Error('simulated Windows sharing denial'), { code });
        },
      });

      await expect(blocked.createChallenge('must-not-publish')).rejects.toMatchObject({
        code: 'PAIR_INTERNAL',
        status: 500,
      });
      const afterNames = (await readdir(stateRoot))
        .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
        .toSorted();
      expect(afterNames).toEqual(beforeNames);
      expect(await readFile(join(stateRoot, afterNames.at(-1)!))).toEqual(beforeLatest);
    },
  );

  it('keeps the revision directory bounded across repeated crashes immediately after publication', async () => {
    const { stateRoot, permissions } = await secureTestRoot();

    for (let index = 0; index < 64; index += 1) {
      const crashing = await createPairingManager({
        stateRoot,
        permissions,
        exchangeRateLimit: { limit: 100, windowMs: 60_000 },
        afterStatePublish: async () => {
          throw new Error('simulated crash after publication');
        },
      });
      await expect(crashing.exchange('AAAAAAAAAA', '00000000')).rejects.toThrow(
        'simulated crash after publication',
      );
      const revisions = (await readdir(stateRoot)).filter(name =>
        /^pairing-state\.v\d{16}\.json$/.test(name),
      );
      expect(revisions.length).toBeLessThanOrEqual(PAIR_STATE_REVISION_RETAIN_COUNT);
    }

    const restarted = await createPairingManager({ stateRoot, permissions });
    await expect(restarted.createChallenge('post-crash-restart')).resolves.toMatchObject({
      attemptsRemaining: 5,
    });
    expect(
      (await readdir(stateRoot)).filter(name => /^pairing-state\.v\d{16}\.json$/.test(name)),
    ).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
  });

  it('recovers an over-cap revision directory with one incremental deletion at a time', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    for (let revision = 1; revision <= 128; revision += 1) {
      const path = join(stateRoot, `pairing-state.v${String(revision).padStart(16, '0')}.json`);
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          revision,
          challenges: [],
          tickets: [],
          resumes: [],
          helloTransactions: [],
          challengeAttempts: [],
          exchangeAttempts: [],
        }),
        { mode: 0o600 },
      );
      await permissions.ensureSecure(path);
    }
    let activeDeletes = 0;
    let maxConcurrentDeletes = 0;
    let deleteCalls = 0;
    const manager = await createPairingManager({
      stateRoot,
      permissions,
      removeRevision: async path => {
        activeDeletes += 1;
        maxConcurrentDeletes = Math.max(maxConcurrentDeletes, activeDeletes);
        deleteCalls += 1;
        await new Promise<void>(resolve => setImmediate(resolve));
        try {
          await rm(path);
        } finally {
          activeDeletes -= 1;
        }
      },
    });

    const challenge = await manager.createChallenge('bounded-recovery');
    expect(deleteCalls).toBe(121);
    expect(maxConcurrentDeletes).toBe(1);
    const revisions = (await readdir(stateRoot))
      .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
      .toSorted();
    expect(revisions).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
    expect(revisions.at(-1)).toBe('pairing-state.v0000000000000129.json');
    expect(await readFile(join(stateRoot, revisions.at(-1)!), 'utf8')).toContain(
      challenge.challengeId,
    );
  });

  it('reloads a newer revision before deleting from a stale snapshot', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const setup = await createPairingManager({
      stateRoot,
      permissions,
      challengeRateLimit: { limit: 20, windowMs: 60_000 },
    });
    for (let index = 0; index < PAIR_STATE_REVISION_RETAIN_COUNT; index += 1) {
      await setup.createChallenge(`setup-${index}`);
    }
    let firstScanEntered!: () => void;
    let releaseFirstScan!: () => void;
    const scanEntered = new Promise<void>(resolve => {
      firstScanEntered = resolve;
    });
    const scanBarrier = new Promise<void>(resolve => {
      releaseFirstScan = resolve;
    });
    let cleanupCalls = 0;
    let firstAttempt = true;
    let staleAttemptDeletes = 0;
    const staleManager = await createPairingManager({
      stateRoot,
      permissions,
      challengeRateLimit: { limit: 20, windowMs: 60_000 },
      beforeRevisionCleanup: async () => {
        cleanupCalls += 1;
        if (cleanupCalls === 1) {
          firstScanEntered();
          await scanBarrier;
          return;
        }
        firstAttempt = false;
      },
      removeRevision: async path => {
        if (firstAttempt) staleAttemptDeletes += 1;
        await rm(path);
      },
    });
    const staleMutation = staleManager.createChallenge('stale-snapshot');
    await Promise.race([
      scanEntered,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('revision cleanup barrier was not entered')), 500),
      ),
    ]);

    const winner = await setup.createChallenge('newer-winner');
    releaseFirstScan();
    const retried = await staleMutation;

    expect(staleAttemptDeletes).toBe(0);
    const revisions = (await readdir(stateRoot))
      .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
      .toSorted();
    expect(revisions).toHaveLength(PAIR_STATE_REVISION_RETAIN_COUNT);
    const latest = await readFile(join(stateRoot, revisions.at(-1)!), 'utf8');
    expect(latest).toContain(winner.challengeId);
    expect(latest).toContain(retried.challengeId);
  });

  it('creates first-run secret files without asking the permission authority to verify absence', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-pairing-first-run-'));
    roots.push(stateRoot);
    await chmod(stateRoot, 0o700);
    const permissions = {
      stateRoot,
      ensureSecure: async (path: string) => chmod(path, path === stateRoot ? 0o700 : 0o600),
      verifySecure: async (path: string) => {
        try {
          await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw Object.assign(new Error('state path is unavailable'), {
              code: 'STATE_PATH_UNSAFE',
              cause: error,
            });
          }
          throw error;
        }
      },
    };

    const manager = await createPairingManager({ stateRoot, permissions });
    await expect(manager.createChallenge('owner-local')).resolves.toMatchObject({
      attemptsRemaining: 5,
    });
  });

  it('publishes a complete owner-secured pairing key from a same-directory temporary', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const keyPath = join(stateRoot, 'pairing-hmac.key');
    let observedTemporary: string | undefined;
    const secured = new Set<string>();
    const ensureSecure = permissions.ensureSecure;
    permissions.ensureSecure = async path => {
      await ensureSecure(path);
      secured.add(path);
    };
    const manager = await createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x5a),
      beforeKeyPublish: async temporary => {
        observedTemporary = temporary;
        expect(
          join(
            stateRoot,
            (await readdir(stateRoot)).find(name => temporary.endsWith(name))!,
          ),
        ).toBe(temporary);
        expect(await readFile(temporary)).toEqual(Buffer.alloc(32, 0x5a));
        expect(secured).toContain(temporary);
        const allowedModes = process.platform === 'win32' ? [0o600, 0o666] : [0o600];
        expect(allowedModes).toContain((await lstat(temporary)).mode & 0o777);
        await expect(readFile(keyPath)).rejects.toMatchObject({ code: 'ENOENT' });
      },
    });

    expect(observedTemporary).toBeDefined();
    expect(await readFile(keyPath)).toEqual(Buffer.alloc(32, 0x5a));
    const allowedModes = process.platform === 'win32' ? [0o600, 0o666] : [0o600];
    expect(allowedModes).toContain((await lstat(keyPath)).mode & 0o777);
    await expect(manager.createChallenge('owner-local')).resolves.toMatchObject({
      attemptsRemaining: 5,
    });
  });

  it('concurrent no-replace key publishers converge on exactly one complete key', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    let arrivals = 0;
    let bothArrived!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => {
      bothArrived = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const rendezvous = async (): Promise<void> => {
      arrivals += 1;
      if (arrivals === 2) bothArrived();
      await barrier;
    };

    const firstPromise = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x11),
      beforeKeyPublish: rendezvous,
    });
    const secondPromise = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x22),
      beforeKeyPublish: rendezvous,
    });
    await ready;
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    const stored = await readFile(join(stateRoot, 'pairing-hmac.key'));
    expect([Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22)]).toContainEqual(stored);
    expect(
      (await readdir(stateRoot)).filter(name => /^\.pairing-hmac\.key\..+\.tmp$/.test(name)),
    ).toEqual([]);
    const challenge = await first.createChallenge('owner-local');
    await expect(second.exchange(challenge.challengeId, challenge.code)).resolves.toMatchObject({
      wsTicket: expect.any(String),
    });
  });

  it('does not delete a live foreign key temporary paused before security verification', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    let pausedTemporary = '';
    let entered!: () => void;
    let release!: () => void;
    const securityBarrierEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const securityBarrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const pausedPublisher = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x41),
      beforeKeySecurityVerification: async temporary => {
        pausedTemporary = temporary;
        entered();
        await securityBarrier;
      },
    });
    await Promise.race([
      securityBarrierEntered,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('key security barrier was not entered')), 500),
      ),
    ]);

    const winner = await createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x42),
    });
    expect(await readFile(pausedTemporary)).toHaveLength(32);
    release();
    const converged = await pausedPublisher;

    const challenge = await winner.createChallenge('winner');
    await expect(converged.exchange(challenge.challengeId, challenge.code)).resolves.toMatchObject({
      wsTicket: expect.any(String),
    });
    expect(
      (await readdir(stateRoot)).filter(name => /^\.pairing-hmac\.key\..+\.tmp$/.test(name)),
    ).toEqual([]);
  });

  it('converges on the complete final key when its own temporary disappears', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const ensureSecure = permissions.ensureSecure;
    permissions.ensureSecure = async path => {
      try {
        await ensureSecure(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw Object.assign(new Error('state path is unavailable'), {
            code: 'STATE_PATH_UNSAFE',
          });
        }
        throw error;
      }
    };
    let temporary = '';
    let entered!: () => void;
    let release!: () => void;
    const securityBarrierEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const securityBarrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const delayed = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x51),
      beforeKeySecurityVerification: async path => {
        temporary = path;
        entered();
        await securityBarrier;
      },
    });
    await Promise.race([
      securityBarrierEntered,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('key security barrier was not entered')), 500),
      ),
    ]);
    const winner = await createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x52),
    });
    await rm(temporary);
    release();
    const converged = await delayed;

    const challenge = await converged.createChallenge('converged');
    await expect(winner.exchange(challenge.challengeId, challenge.code)).resolves.toMatchObject({
      wsTicket: expect.any(String),
    });
  });

  it('waits boundedly for a winner after stale cleanup removes its delayed owner temporary', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    let delayedTemporary = '';
    let delayedEntered!: () => void;
    let releaseDelayed!: () => void;
    const delayedBarrierEntered = new Promise<void>(resolve => {
      delayedEntered = resolve;
    });
    const delayedBarrier = new Promise<void>(resolve => {
      releaseDelayed = resolve;
    });
    const delayed = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x61),
      beforeKeySecurityVerification: async temporary => {
        delayedTemporary = temporary;
        delayedEntered();
        await delayedBarrier;
      },
    });
    await delayedBarrierEntered;
    const staleAt = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(delayedTemporary, staleAt, staleAt);

    let winnerEntered!: () => void;
    let releaseWinner!: () => void;
    const winnerBarrierEntered = new Promise<void>(resolve => {
      winnerEntered = resolve;
    });
    const winnerBarrier = new Promise<void>(resolve => {
      releaseWinner = resolve;
    });
    const winner = createPairingManager({
      stateRoot,
      permissions,
      randomBytes: size => Buffer.alloc(size, 0x62),
      beforeKeyPublish: async () => {
        winnerEntered();
        await winnerBarrier;
      },
    });
    await winnerBarrierEntered;
    await expect(readFile(delayedTemporary)).rejects.toMatchObject({ code: 'ENOENT' });

    const delayedOutcome = delayed.then(
      manager => ({ kind: 'ok' as const, manager }),
      error => ({ kind: 'error' as const, error }),
    );
    releaseDelayed();
    const early = await Promise.race([
      delayedOutcome,
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 250)),
    ]);
    expect(early).toBe('pending');
    releaseWinner();
    const [winnerManager, outcome] = await Promise.all([winner, delayedOutcome]);
    expect(outcome).toMatchObject({ kind: 'ok' });
    if (outcome.kind !== 'ok') throw outcome.error;
    const challenge = await winnerManager.createChallenge('bounded-winner');
    await expect(
      outcome.manager.exchange(challenge.challengeId, challenge.code),
    ).resolves.toMatchObject({ wsTicket: expect.any(String) });
  });

  it('fails closed on an incomplete published key and recovers only after it is removed', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const keyPath = join(stateRoot, 'pairing-hmac.key');
    await writeFile(keyPath, Buffer.from([0x7f]), { mode: 0o600 });

    await expect(createPairingManager({ stateRoot, permissions })).rejects.toThrow(
      'invalid pairing HMAC key',
    );
    expect(await readFile(keyPath)).toEqual(Buffer.from([0x7f]));

    await rm(keyPath);
    await expect(createPairingManager({ stateRoot, permissions })).resolves.toBeDefined();
    expect(await readFile(keyPath)).toHaveLength(32);
  });

  it('removes an owner-token key temporary only after its generous stale boundary', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const crashed = join(stateRoot, `.pairing-hmac.key.999999.0.${'33'.repeat(8)}.tmp`);
    await writeFile(crashed, Buffer.alloc(9, 0x33), { mode: 0o600 });
    const staleAt = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(crashed, staleAt, staleAt);

    await expect(createPairingManager({ stateRoot, permissions })).resolves.toBeDefined();
    await expect(readFile(crashed)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(stateRoot, 'pairing-hmac.key'))).toHaveLength(32);
  });

  it('fails closed before key publication when the bounded temporary scan cap is exceeded', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    for (let index = 0; index < 256; index += 1) {
      const temporary = join(
        stateRoot,
        `.pairing-hmac.key.${800000 + index}.0.${index.toString(16).padStart(32, '0')}.tmp`,
      );
      await writeFile(temporary, Buffer.alloc(1), { mode: 0o600 });
    }

    await expect(createPairingManager({ stateRoot, permissions })).rejects.toMatchObject({
      code: 'PAIR_INTERNAL',
      status: 500,
    });
    await expect(readFile(join(stateRoot, 'pairing-hmac.key'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('exchanges an eight-digit code once for a 128-bit ticket', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');

    expect(challenge.challengeId).toMatch(/^[A-Z2-7]{10}$/);
    expect(challenge.code).toMatch(/^\d{8}$/);
    expect(challenge.attemptsRemaining).toBe(5);

    const first = await manager.exchange(challenge.challengeId, challenge.code);
    expect(Buffer.from(first.wsTicket, 'base64url')).toHaveLength(16);
    await expect(manager.exchange(challenge.challengeId, challenge.code)).rejects.toMatchObject({
      code: 'PAIR_CODE_USED',
      status: 409,
    });
  });

  it('stores only keyed hashes of codes and one-use tickets', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const manager = await createPairingManager({ stateRoot, permissions });
    const challenge = await manager.createChallenge('owner-local');
    const ticket = await manager.exchange(challenge.challengeId, challenge.code);

    const contents = await Promise.all(
      (await readdir(stateRoot)).map(name =>
        readFile(join(stateRoot, name)).catch(() => Buffer.alloc(0)),
      ),
    );
    const stored = Buffer.concat(contents).toString('utf8');
    expect(stored).not.toContain(challenge.code);
    expect(stored).not.toContain(ticket.wsTicket);
    expect(stored).toContain(challenge.challengeId);
  });

  it('expires challenges and permits exactly five wrong attempts', async () => {
    let now = 1_000_000;
    const manager = await openManager({ now: () => now });
    const challenge = await manager.createChallenge('owner-local');
    const wrongCode = challenge.code === '00000000' ? '00000001' : '00000000';

    for (let attempt = 4; attempt >= 0; attempt -= 1) {
      await expect(manager.exchange(challenge.challengeId, wrongCode)).rejects.toMatchObject({
        code: 'PAIR_CODE_WRONG',
        status: 401,
        attemptsRemaining: attempt,
      });
    }
    await expect(manager.exchange(challenge.challengeId, challenge.code)).rejects.toMatchObject({
      code: 'PAIR_CODE_USED',
      status: 409,
    });

    const expiring = await manager.createChallenge('second-actor');
    now = expiring.expiresAt;
    await expect(manager.exchange(expiring.challengeId, expiring.code)).rejects.toMatchObject({
      code: 'PAIR_CODE_EXPIRED',
      status: 401,
    });
  });

  it('rate-limits challenge creation and exchange per state root', async () => {
    const manager = await openManager({
      challengeRateLimit: { limit: 2, windowMs: 60_000 },
      exchangeRateLimit: { limit: 2, windowMs: 60_000 },
    });

    await manager.createChallenge('actor-a');
    await manager.createChallenge('actor-b');
    await expect(manager.createChallenge('actor-c')).rejects.toMatchObject({
      code: 'PAIR_RATE_LIMITED',
      status: 429,
    });

    const other = await openManager({ exchangeRateLimit: { limit: 2, windowMs: 60_000 } });
    const challenge = await other.createChallenge('owner-local');
    const firstWrong = challenge.code === '00000000' ? '00000001' : '00000000';
    const secondWrong = challenge.code === '00000002' ? '00000003' : '00000002';
    await expect(other.exchange(challenge.challengeId, firstWrong)).rejects.toMatchObject({
      code: 'PAIR_CODE_WRONG',
    });
    await expect(other.exchange(challenge.challengeId, secondWrong)).rejects.toMatchObject({
      code: 'PAIR_CODE_WRONG',
    });
    await expect(other.exchange(challenge.challengeId, challenge.code)).rejects.toMatchObject({
      code: 'PAIR_RATE_LIMITED',
      status: 429,
    });
  });
});

describe('ticket and resume authentication', () => {
  it('prepares and commits a nonce-idempotent successor recoverable across manager restart', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const manager = await createPairingManager({ stateRoot, permissions });
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const input = hello({ kind: 'ticket', value: wsTicket });

    const prepared = await manager.prepareHello(input);
    const restarted = await createPairingManager({ stateRoot, permissions });
    await expect(restarted.prepareHello(input)).resolves.toEqual(prepared);

    await restarted.commitHello(prepared.preparationId);
    await expect(manager.prepareHello(input)).resolves.toEqual(prepared);
    await expect(
      manager.prepareHello({ ...input, nonce: Buffer.alloc(16, 19).toString('base64url') }),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_USED' });
  });

  it('binds exact hello recovery to all security fields and a short expiry window', async () => {
    let now = 20_000;
    const startedAt = now;
    const { stateRoot, permissions } = await secureTestRoot();
    const manager = await createPairingManager({ stateRoot, permissions, now: () => now });
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const input = hello({ kind: 'ticket', value: wsTicket });
    const prepared = await manager.prepareHello(input);
    await manager.commitHello(prepared.preparationId);

    const restarted = await createPairingManager({ stateRoot, permissions, now: () => now });
    await expect(restarted.prepareHello(input)).resolves.toEqual(prepared);
    await expect(
      restarted.prepareHello({
        ...input,
        fileName: 'changed-after-commit',
        capabilities: [...input.capabilities, 'extra-capability'],
      }),
    ).rejects.toMatchObject({ code: 'PAIR_CREDENTIAL_REQUIRED' });

    now = startedAt + PAIR_HELLO_RECOVERY_TTL_MS - 1;
    await expect(restarted.prepareHello(input)).resolves.toEqual(prepared);
    now = startedAt + PAIR_HELLO_RECOVERY_TTL_MS;
    await expect(restarted.prepareHello(input)).rejects.toMatchObject({
      code: 'PAIR_TICKET_USED',
    });
    await expect(restarted.commitHello(prepared.preparationId)).rejects.toMatchObject({
      code: 'PAIR_CREDENTIAL_REQUIRED',
    });

    const { port, relay } = await startRelay(restarted);
    const replaySocket = await connect(port);
    replaySocket.send(
      encodeEnvelope(
        createRequest({
          id: 'expired-recovery',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: input,
        }),
      ),
    );
    const replay = await nextEnvelope(replaySocket);
    expect(replay.kind).toBe('err');
    expect(relay.sessions.list()).toHaveLength(0);
    replaySocket.close();
  });

  it('recovers the exact prepared successor after an async socket flap without leaking a session', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const input = hello({ kind: 'ticket', value: wsTicket });
    let prepared!: () => void;
    let release!: () => void;
    const preparedEntered = new Promise<void>(resolve => {
      prepared = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    let firstPrepared: Awaited<ReturnType<PairingManager['prepareHello']>> | undefined;
    const authenticator: PairingManager = {
      ...manager,
      authenticateHello: async () => {
        throw new Error('relay must use prepare/commit authentication');
      },
      prepareHello: async value => {
        const result = await manager.prepareHello(value);
        firstPrepared ??= result;
        prepared();
        await barrier;
        return result;
      },
    };
    const { port, relay } = await startRelay(authenticator);
    const requestedSessionId = newId();
    const request = createRequest({
      id: 'recoverable-hello',
      sessionId: requestedSessionId,
      method: SystemMethod.Hello,
      params: input,
    });

    const firstSocket = await connect(port);
    const firstResponse = nextEnvelope(firstSocket).then(() => 'response' as const);
    firstSocket.send(encodeEnvelope(request));
    const firstEvent = await Promise.race([
      preparedEntered.then(() => 'prepared' as const),
      firstResponse,
    ]);
    expect(firstEvent).toBe('prepared');
    firstSocket.close();
    await new Promise<void>(resolve => firstSocket.once('close', () => resolve()));
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(relay.sessions.list()).toHaveLength(0);

    const retrySocket = await connect(port);
    retrySocket.send(encodeEnvelope(request));
    const retry = await nextEnvelope(retrySocket);
    expect(retry).toMatchObject({
      kind: 'res',
      result: firstPrepared?.result,
    });
    expect(relay.sessions.list()).toHaveLength(1);
    await expect(
      manager.prepareHello({ ...input, nonce: Buffer.alloc(16, 29).toString('base64url') }),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_USED' });
    retrySocket.close();
  });

  it.each([
    ['an extra raw frame', 'extra-frame', undefined, 1008],
    ['the client socket closing', 'socket-close', undefined, 1006],
    ['the hello timeout', 'timeout', 10, 1008],
  ] as const)(
    'does not publish a credential commit after %s makes the connection terminal',
    async (_case, terminalCause, helloTimeoutMs, expectedCloseCode) => {
      const { stateRoot, permissions } = await secureTestRoot();
      const setup = await createPairingManager({ stateRoot, permissions });
      const challenge = await setup.createChallenge('owner-local');
      const { wsTicket } = await setup.exchange(challenge.challengeId, challenge.code);
      const input = hello({ kind: 'ticket', value: wsTicket });
      let commitEntered!: () => void;
      let releaseCommit!: () => void;
      const commitPublishEntered = new Promise<void>(resolve => {
        commitEntered = resolve;
      });
      const commitPublishBarrier = new Promise<void>(resolve => {
        releaseCommit = resolve;
      });
      let publishCalls = 0;
      const manager = await createPairingManager({
        stateRoot,
        permissions,
        beforeStatePublish: async () => {
          publishCalls += 1;
          if (publishCalls === 2) {
            commitEntered();
            await commitPublishBarrier;
          }
        },
      });
      const { port, relay } = await startRelay(manager, undefined, helloTimeoutMs);
      const socket = await connect(port);
      const request = createRequest({
        id: `terminal-during-commit-${terminalCause}`,
        sessionId: newId(),
        method: SystemMethod.Hello,
        params: input,
      });
      socket.send(encodeEnvelope(request));
      await commitPublishEntered;
      const revisionsBeforeAbort = (await readdir(stateRoot))
        .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
        .toSorted();
      const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)));

      if (terminalCause === 'extra-frame') socket.send(Buffer.from([0]));
      if (terminalCause === 'socket-close') socket.terminate();
      const closeCode = await close;
      expect(closeCode).toBe(expectedCloseCode);
      releaseCommit();
      await manager.drain();

      const revisionsAfterAbort = (await readdir(stateRoot))
        .filter(name => /^pairing-state\.v\d{16}\.json$/.test(name))
        .toSorted();
      expect(revisionsAfterAbort).toEqual(revisionsBeforeAbort);
      const persisted = JSON.parse(
        await readFile(join(stateRoot, revisionsAfterAbort.at(-1)!), 'utf8'),
      ) as {
        tickets: Array<{ used: boolean }>;
        resumes: unknown[];
        helloTransactions: Array<{ committed: boolean }>;
      };
      expect(persisted.tickets).toMatchObject([{ used: false }]);
      expect(persisted.resumes).toEqual([]);
      expect(persisted.helloTransactions).toMatchObject([{ committed: false }]);
      expect(relay.sessions.list()).toHaveLength(0);
      expect(relay.pendingCount()).toBe(0);
      expect(relay.lastRequestAt()).toBe(0);
      await expect(manager.authenticateHello(input)).resolves.toMatchObject({
        sessionId: expect.any(String),
        rotatedResumeToken: expect.any(String),
      });
    },
    7_000,
  );

  it('removes the provisional session and heartbeat when the authenticated response cannot send', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const input = hello({ kind: 'ticket', value: wsTicket });
    let entered!: () => void;
    let release!: () => void;
    const responseHookEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const http = createServer();
    const relay = new Relay({
      server: http,
      serverVersion: '0.1.0',
      authenticator: manager,
      beforeHelloResponse: async () => {
        entered();
        await barrier;
      },
    });
    servers.push({ http, relay });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const port = (http.address() as AddressInfo).port;
    const socket = await connect(port);
    const response = nextEnvelope(socket).then(() => 'response' as const);
    socket.send(
      encodeEnvelope(
        createRequest({
          id: 'send-failure',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: input,
        }),
      ),
    );
    expect(await Promise.race([responseHookEntered.then(() => 'hook' as const), response])).toBe(
      'hook',
    );
    expect(relay.sessions.list()).toHaveLength(1);
    socket.terminate();
    await new Promise<void>(resolve => socket.once('close', () => resolve()));
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(relay.sessions.list()).toHaveLength(0);
    await expect(manager.prepareHello(input)).resolves.toMatchObject({
      result: { rotatedResumeToken: expect.any(String) },
    });
  });

  it('does not let an older failed retry remove the newer replacement Session object', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const input = hello({ kind: 'ticket', value: wsTicket });
    let firstHook!: () => void;
    let releaseFirst!: () => void;
    const firstHookEntered = new Promise<void>(resolve => {
      firstHook = resolve;
    });
    const firstBarrier = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let hookCalls = 0;
    const http = createServer();
    const relay = new Relay({
      server: http,
      serverVersion: '0.1.0',
      authenticator: manager,
      beforeHelloResponse: async () => {
        hookCalls += 1;
        if (hookCalls === 1) {
          firstHook();
          await firstBarrier;
        }
      },
    });
    servers.push({ http, relay });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const port = (http.address() as AddressInfo).port;
    const request = createRequest({
      id: 'overlapping-retry',
      sessionId: newId(),
      method: SystemMethod.Hello,
      params: input,
    });

    const olderSocket = await connect(port);
    olderSocket.send(encodeEnvelope(request));
    await firstHookEntered;
    expect(relay.sessions.list()).toHaveLength(1);

    const newerSocket = await connect(port);
    newerSocket.send(encodeEnvelope(request));
    const newerResponse = await nextEnvelope(newerSocket);
    expect(newerResponse.kind).toBe('res');
    const currentBeforeRelease = relay.sessions.list()[0];
    expect(currentBeforeRelease?.socket).not.toBeNull();

    releaseFirst();
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    const currentAfterRelease = relay.sessions.list()[0];
    expect(currentAfterRelease).toBe(currentBeforeRelease);
    expect(relay.sessions.connected()).toHaveLength(1);
    newerSocket.close();
  });

  it('rejects protocol mismatch before consuming the one-use ticket or logging reflected input', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const logs: string[] = [];
    const { port } = await startRelay(manager, message => logs.push(message));
    const injectedVersion = 'wrong\nBearer reflected-secret';

    const rejectedSocket = await connect(port);
    rejectedSocket.send(
      encodeEnvelope(
        createRequest({
          id: 'bad-hello',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: {
            ...hello({ kind: 'ticket', value: wsTicket }),
            protocolVersion: injectedVersion,
          },
        }),
      ),
    );
    const rejected = await nextEnvelope(rejectedSocket);
    expect(rejected).toMatchObject({ kind: 'err', error: { code: ErrorCode.ProtocolMismatch } });
    if (rejected.kind !== 'err') throw new Error('expected protocol mismatch error');
    expect(rejected.error.message).not.toContain(injectedVersion);
    expect(logs.join('\n')).not.toContain('reflected-secret');
    await new Promise<void>(resolve => rejectedSocket.once('close', () => resolve()));

    const validSocket = await connect(port);
    validSocket.send(
      encodeEnvelope(
        createRequest({
          id: 'valid-hello',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: hello({ kind: 'ticket', value: wsTicket }),
        }),
      ),
    );
    const accepted = await nextEnvelope(validSocket);
    expect(accepted.kind).toBe('res');
    validSocket.close();
  });

  it('consumes a ticket in the first authenticated hello and rotates every resume token', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);

    const first = await manager.authenticateHello(hello({ kind: 'ticket', value: wsTicket }));
    expect(first.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(first.rotatedResumeToken, 'base64url')).toHaveLength(32);

    await expect(
      manager.authenticateHello({
        ...hello({ kind: 'ticket', value: wsTicket }),
        nonce: Buffer.alloc(16, 41).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_USED' });

    const resumed = await manager.authenticateHello(
      hello({ kind: 'resume', value: first.rotatedResumeToken }),
    );
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.rotatedResumeToken).not.toBe(first.rotatedResumeToken);

    await expect(
      manager.authenticateHello({
        ...hello({ kind: 'resume', value: first.rotatedResumeToken }),
        nonce: Buffer.alloc(16, 42).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'PAIR_RESUME_USED' });
    await expect(
      manager.authenticateHello(
        hello({ kind: 'resume', value: resumed.rotatedResumeToken }, 'plugin-generation-b'),
      ),
    ).rejects.toMatchObject({ code: 'PAIR_GENERATION_MISMATCH' });
  });

  it('expires tickets and resume credentials without disclosing them in errors or logs', async () => {
    let now = 5_000;
    const logs: string[] = [];
    const manager = await openManager({ now: () => now, log: message => logs.push(message) });
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket, expiresAt } = await manager.exchange(challenge.challengeId, challenge.code);
    now = expiresAt;

    await expect(
      manager.authenticateHello(hello({ kind: 'ticket', value: wsTicket })),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_EXPIRED' });
    expect(logs.join('\n')).not.toContain(challenge.code);
    expect(logs.join('\n')).not.toContain(wsTicket);
  });

  it('persists resume rotation, replay rejection, and exact expiry across manager restart', async () => {
    let now = 10_000;
    const { stateRoot, permissions } = await secureTestRoot();
    const manager = await createPairingManager({ stateRoot, permissions, now: () => now });
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);
    const first = await manager.authenticateHello(hello({ kind: 'ticket', value: wsTicket }));

    const restarted = await createPairingManager({ stateRoot, permissions, now: () => now });
    const resumed = await restarted.authenticateHello(
      hello({ kind: 'resume', value: first.rotatedResumeToken }),
    );
    const replayProcess = await createPairingManager({ stateRoot, permissions, now: () => now });
    await expect(
      replayProcess.authenticateHello({
        ...hello({ kind: 'resume', value: first.rotatedResumeToken }),
        nonce: Buffer.alloc(16, 71).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'PAIR_RESUME_USED' });

    now = resumed.resumeExpiresAt;
    const expiryProcess = await createPairingManager({ stateRoot, permissions, now: () => now });
    await expect(
      expiryProcess.authenticateHello(hello({ kind: 'resume', value: resumed.rotatedResumeToken })),
    ).rejects.toMatchObject({ code: 'PAIR_RESUME_EXPIRED' });
  });

  it('allows exactly one concurrent resume with different nonces across independent stores', async () => {
    const { stateRoot, permissions } = await secureTestRoot();
    const setup = await createPairingManager({ stateRoot, permissions });
    const challenge = await setup.createChallenge('owner-local');
    const { wsTicket } = await setup.exchange(challenge.challengeId, challenge.code);
    const first = await setup.authenticateHello(hello({ kind: 'ticket', value: wsTicket }));

    let entered!: () => void;
    let release!: () => void;
    const lockEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const firstStore = await createPairingManager({
      stateRoot,
      permissions,
      beforeStatePublish: async () => {
        entered();
        await barrier;
      },
    });
    const secondStore = await createPairingManager({ stateRoot, permissions });
    const firstResume = firstStore.authenticateHello(
      hello({ kind: 'resume', value: first.rotatedResumeToken }),
    );
    await lockEntered;
    const secondResume = secondStore.authenticateHello({
      ...hello({ kind: 'resume', value: first.rotatedResumeToken }),
      nonce: Buffer.alloc(16, 72).toString('base64url'),
    });
    release();
    const outcomes = await Promise.allSettled([firstResume, secondResume]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('redacts nested authentication secrets but retains the public challenge id', () => {
    expect(
      redactAuthSecrets({
        challengeId: 'ABCDEFGHIJ',
        code: '12345678',
        wsTicket: 'ticket-secret',
        authorization: 'Bearer follower-secret',
        nested: { rotatedResumeToken: 'resume-secret', credential: { value: 'credential-secret' } },
      }),
    ).toEqual({
      challengeId: 'ABCDEFGHIJ',
      code: '[REDACTED]',
      wsTicket: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { rotatedResumeToken: '[REDACTED]', credential: '[REDACTED]' },
    });
  });
});
