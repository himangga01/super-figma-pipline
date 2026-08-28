import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Node } from '../../src/election/node.js';
import {
  createFollowerAuth,
  openFollowerResponse,
  sealFollowerRequest,
  verifyFollowerChallenge,
} from '../../src/security/follower-auth.js';

const roots: string[] = [];

const fixture = async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-generation-auth-'));
  roots.push(stateRoot);
  await chmod(stateRoot, 0o700);
  const secured: string[] = [];
  const verified: string[] = [];
  const auth = await createFollowerAuth({
    stateRoot,
    permissions: {
      stateRoot,
      ensureSecure: async path => {
        secured.push(path);
        await chmod(path, path === stateRoot ? 0o700 : 0o600);
      },
      verifySecure: async path => {
        verified.push(path);
      },
    },
  });
  return { stateRoot, auth, secured, verified };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('leader-generation credentials', () => {
  it('binds encrypted follower requests to one challenge, method, path, body, and generation', async () => {
    let now = 1_000;
    const generation = {
      generation: Buffer.alloc(16, 91).toString('base64url'),
      followerToken: Buffer.alloc(32, 92).toString('base64url'),
      controlToken: Buffer.alloc(32, 93).toString('base64url'),
      createdAt: now,
    };
    const auth = await createFollowerAuth({ memory: generation, now: () => now });
    const challenge = await auth.issueFollowerChallenge();
    expect(verifyFollowerChallenge(generation.followerToken, challenge, now)).toBe(true);
    const plaintext = Buffer.from('sensitive rpc args');
    const sealed = sealFollowerRequest(
      generation.followerToken,
      challenge,
      'POST',
      '/rpc',
      plaintext,
      'unit-request',
      size => Buffer.alloc(size, 94),
      now,
    );
    expect(sealed.headers.authorization).toBeUndefined();
    expect(sealed.headers['x-sfp-body-sha256']).toBeUndefined();
    expect(sealed.headers['x-sfp-request-digest']).not.toBe(
      createHash('sha256').update(plaintext).digest('base64url'),
    );
    expect(sealed.body.equals(plaintext)).toBe(false);
    await expect(
      auth.openFollowerRequest({
        method: 'POST',
        path: '/rpc',
        headers: sealed.headers,
        ciphertext: sealed.body,
      }),
    ).resolves.toMatchObject({ plaintext });
    await expect(
      auth.openFollowerRequest({
        method: 'POST',
        path: '/rpc',
        headers: sealed.headers,
        ciphertext: sealed.body,
      }),
    ).rejects.toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });

    const wrongPathChallenge = await auth.issueFollowerChallenge();
    const wrongPath = sealFollowerRequest(
      generation.followerToken,
      wrongPathChallenge,
      'POST',
      '/rpc',
      plaintext,
      'wrong-path-request',
      size => Buffer.alloc(size, 95),
      now,
    );
    await expect(
      auth.openFollowerRequest({
        method: 'POST',
        path: '/abdicate',
        headers: wrongPath.headers,
        ciphertext: wrongPath.body,
      }),
    ).rejects.toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });

    const tamperChallenge = await auth.issueFollowerChallenge();
    const tampered = sealFollowerRequest(
      generation.followerToken,
      tamperChallenge,
      'POST',
      '/rpc',
      plaintext,
      'tampered-request',
      size => Buffer.alloc(size, 96),
      now,
    );
    tampered.body[0] = (tampered.body[0] ?? 0) ^ 1;
    await expect(
      auth.openFollowerRequest({
        method: 'POST',
        path: '/rpc',
        headers: tampered.headers,
        ciphertext: tampered.body,
      }),
    ).rejects.toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });

    const wrongGenerationChallenge = await auth.issueFollowerChallenge();
    const wrongGeneration = sealFollowerRequest(
      generation.followerToken,
      wrongGenerationChallenge,
      'POST',
      '/rpc',
      plaintext,
      'wrong-generation-request',
      size => Buffer.alloc(size, 97),
      now,
    );
    wrongGeneration.headers['x-sfp-leader-generation'] = Buffer.alloc(16, 98).toString('base64url');
    await expect(
      auth.openFollowerRequest({
        method: 'POST',
        path: '/rpc',
        headers: wrongGeneration.headers,
        ciphertext: wrongGeneration.body,
      }),
    ).rejects.toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });

    const expired = await auth.issueFollowerChallenge();
    now = expired.expiresAt;
    expect(verifyFollowerChallenge(generation.followerToken, expired, now)).toBe(false);
  });

  it('authenticates follower responses with a distinct key and exact status/path/nonce/generation/requestId', async () => {
    const generation = {
      generation: Buffer.alloc(16, 101).toString('base64url'),
      followerToken: Buffer.alloc(32, 102).toString('base64url'),
      controlToken: Buffer.alloc(32, 103).toString('base64url'),
      createdAt: 1,
    };
    const auth = await createFollowerAuth({ memory: generation });
    const challenge = await auth.issueFollowerChallenge();
    const requestId = 'response-bound-request';
    const request = sealFollowerRequest(
      generation.followerToken,
      challenge,
      'POST',
      '/rpc',
      Buffer.from('request bytes'),
      requestId,
      size => Buffer.alloc(size, 104),
    );
    const opened = await auth.openFollowerRequest({
      method: 'POST',
      path: '/rpc',
      headers: request.headers,
      ciphertext: request.body,
    });
    const response = auth.sealFollowerResponse(
      opened.context,
      200,
      requestId,
      Buffer.from('response bytes'),
      size => Buffer.alloc(size, 105),
    );
    expect(response.headers.authorization).toBeUndefined();
    expect(response.headers['x-sfp-body-sha256']).toBeUndefined();
    expect(response.body.equals(Buffer.from('response bytes'))).toBe(false);
    const open = (overrides: Partial<Parameters<typeof openFollowerResponse>[1]> = {}) =>
      openFollowerResponse(generation.followerToken, {
        method: 'POST',
        path: '/rpc',
        generation: challenge.generation,
        nonce: challenge.nonce,
        requestDigest: request.headers['x-sfp-request-digest']!,
        status: 200,
        requestId,
        headers: response.headers,
        ciphertext: response.body,
        ...overrides,
      });
    expect(open()).toEqual(Buffer.from('response bytes'));
    for (const overrides of [
      { status: 201 },
      { path: '/abdicate' },
      { nonce: Buffer.alloc(16, 106).toString('base64url') },
      { generation: Buffer.alloc(16, 107).toString('base64url') },
      { requestId: 'different-request' },
    ]) {
      expect(() => open(overrides)).toThrowError(
        expect.objectContaining({ code: 'FOLLOWER_AUTH_INVALID' }),
      );
    }
    response.body[0] = (response.body[0] ?? 0) ^ 1;
    expect(() => open()).toThrowError(expect.objectContaining({ code: 'FOLLOWER_AUTH_INVALID' }));
  });

  it('reports no current credential before first rotation without verifying a missing file', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-generation-first-run-'));
    roots.push(stateRoot);
    await chmod(stateRoot, 0o700);
    const auth = await createFollowerAuth({
      stateRoot,
      permissions: {
        stateRoot,
        ensureSecure: async path => chmod(path, path === stateRoot ? 0o700 : 0o600),
        verifySecure: async path => {
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
      },
    });
    await expect(auth.authorization('follower')).resolves.toBeUndefined();
  });

  it('rotates credentials each time a node acquires leadership', async () => {
    const generations = [
      {
        generation: Buffer.alloc(16, 11).toString('base64url'),
        followerToken: Buffer.alloc(32, 12).toString('base64url'),
        controlToken: Buffer.alloc(32, 13).toString('base64url'),
        createdAt: 1,
      },
      {
        generation: Buffer.alloc(16, 21).toString('base64url'),
        followerToken: Buffer.alloc(32, 22).toString('base64url'),
        controlToken: Buffer.alloc(32, 23).toString('base64url'),
        createdAt: 2,
      },
    ];
    let rotations = 0;
    const node = new Node({
      serverVersion: '0.1.0',
      port: 0,
      generationAuth: {
        rotate: async () => {
          const value = generations[rotations++]!;
          return { generation: value.generation, createdAt: value.createdAt };
        },
      },
      relayAuthenticator: {
        authenticateHello: async (_input, context) => ({
          sessionId: context.requestedSessionId,
          rotatedResumeToken: Buffer.alloc(32, 31).toString('base64url'),
          resumeExpiresAt: Date.now() + 1_000,
        }),
      },
    });
    try {
      const first = await node.becomeLeader();
      expect(first.generation).toEqual({
        generation: generations[0]?.generation,
        createdAt: generations[0]?.createdAt,
      });
      expect(JSON.stringify(first)).not.toMatch(/followerToken|controlToken/);
      node.becomeFollower();
      const second = await node.becomeLeader();
      expect(second.generation).toEqual({
        generation: generations[1]?.generation,
        createdAt: generations[1]?.createdAt,
      });
      expect(rotations).toBe(2);
    } finally {
      await node.stop();
    }
  });

  it('generates distinct 256-bit follower and control credentials', async () => {
    const { auth } = await fixture();
    const generation = await auth.rotate();

    expect(Buffer.from(generation.followerToken, 'base64url')).toHaveLength(32);
    expect(Buffer.from(generation.controlToken, 'base64url')).toHaveLength(32);
    expect(Buffer.from(generation.generation, 'base64url')).toHaveLength(16);
    expect(generation.followerToken).not.toBe(generation.controlToken);
    await expect(
      auth.authorizeFollower(`Bearer ${generation.followerToken}`, generation.generation),
    ).resolves.toBe(true);
    await expect(
      auth.authorizeControl(`Bearer ${generation.controlToken}`, generation.generation),
    ).resolves.toBe(true);
    await expect(
      auth.authorizeFollower(`Bearer ${generation.controlToken}`, generation.generation),
    ).resolves.toBe(false);
    await expect(
      auth.authorizeControl(`Bearer ${generation.followerToken}`, generation.generation),
    ).resolves.toBe(false);
  });

  it('rotates on handoff and rejects every credential from the old generation', async () => {
    const { auth } = await fixture();
    const old = await auth.rotate();
    const current = await auth.rotate();

    await expect(
      auth.authorizeFollower(`Bearer ${old.followerToken}`, old.generation),
    ).resolves.toBe(false);
    await expect(auth.authorizeControl(`Bearer ${old.controlToken}`, old.generation)).resolves.toBe(
      false,
    );
    await expect(
      auth.authorizeFollower(`Bearer ${current.followerToken}`, current.generation),
    ).resolves.toBe(true);
    await expect(
      auth.authorizeControl(`Bearer ${current.controlToken}`, current.generation),
    ).resolves.toBe(true);
  });

  it('lets another local process read only the current credential from secured state', async () => {
    const { stateRoot, auth, secured, verified } = await fixture();
    const old = await auth.rotate();
    const current = await auth.rotate();
    if (auth.permissions === undefined) throw new Error('persistent fixture lost its permissions');
    const reader = await createFollowerAuth({ stateRoot, permissions: auth.permissions });

    await expect(reader.authorization('follower')).resolves.toEqual({
      generation: current.generation,
      value: `Bearer ${current.followerToken}`,
    });
    await expect(reader.authorization('control')).resolves.toEqual({
      generation: current.generation,
      value: `Bearer ${current.controlToken}`,
    });
    expect(await reader.authorization('follower')).not.toMatchObject({
      value: `Bearer ${old.followerToken}`,
    });
    expect(secured.some(path => path !== stateRoot)).toBe(true);
    expect(verified).toContain(stateRoot);

    const files = await Promise.all(
      (await readdir(stateRoot)).map(async name => ({
        name,
        data: await readFile(join(stateRoot, name), 'utf8'),
      })),
    );
    const credentialFile = files.find(file => file.data.includes(current.generation));
    if (credentialFile === undefined) throw new Error('credential file was not persisted');
    const mode = (await stat(join(stateRoot, credentialFile.name))).mode & 0o777;
    expect(process.platform === 'win32' || mode === 0o600).toBe(true);
  });

  it('rejects malformed bearer syntax and a valid token paired with the wrong generation', async () => {
    const { auth } = await fixture();
    const current = await auth.rotate();
    await expect(auth.authorizeFollower(current.followerToken, current.generation)).resolves.toBe(
      false,
    );
    await expect(
      auth.authorizeFollower(`bearer ${current.followerToken}`, current.generation),
    ).resolves.toBe(false);
    await expect(
      auth.authorizeFollower(`Bearer ${current.followerToken}`, 'wrong-generation'),
    ).resolves.toBe(false);
    await expect(auth.authorizeFollower(undefined, current.generation)).resolves.toBe(false);
  });

  it('rejects credential-state tokens with non-base64url bytes even if decoding ignores them', async () => {
    const { stateRoot, auth } = await fixture();
    const current = await auth.rotate();
    const credentialPath = join(stateRoot, 'leader-auth.json');
    const stored = JSON.parse(await readFile(credentialPath, 'utf8')) as Record<string, unknown>;
    stored.followerToken = `${current.followerToken}!`;
    await writeFile(credentialPath, JSON.stringify(stored), { mode: 0o600 });
    await expect(auth.authorization('follower')).rejects.toThrow('invalid leader credential state');
  });
});
