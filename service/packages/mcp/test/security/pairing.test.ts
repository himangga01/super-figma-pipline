import { chmod, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthenticatedHello } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPairingManager,
  type PairingManager,
  redactAuthSecrets,
} from '../../src/security/pairing-manager.js';

const roots: string[] = [];

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
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('pairing challenge and exchange', () => {
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
  it('consumes a ticket in the first authenticated hello and rotates every resume token', async () => {
    const manager = await openManager();
    const challenge = await manager.createChallenge('owner-local');
    const { wsTicket } = await manager.exchange(challenge.challengeId, challenge.code);

    const first = await manager.authenticateHello(hello({ kind: 'ticket', value: wsTicket }));
    expect(first.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(first.rotatedResumeToken, 'base64url')).toHaveLength(32);

    await expect(
      manager.authenticateHello(hello({ kind: 'ticket', value: wsTicket })),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_USED' });

    const resumed = await manager.authenticateHello(
      hello({ kind: 'resume', value: first.rotatedResumeToken }),
    );
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.rotatedResumeToken).not.toBe(first.rotatedResumeToken);

    await expect(
      manager.authenticateHello(hello({ kind: 'resume', value: first.rotatedResumeToken })),
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
