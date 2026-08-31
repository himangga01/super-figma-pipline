import { hashActionRequest, type ActorContext } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';

const actor = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

describe('action nonce store', () => {
  it('allows exactly one concurrent consumer of a 120-second action-bound nonce', async () => {
    let now = 1_724_803_200_000;
    const store = createActionNonceStore({
      leaderGeneration: 'generation-1',
      now: () => now,
      randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index),
    });
    const requestHash = hashActionRequest('workspace.remove', {
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
    });
    const claims = await store.issue(actor, 'workspace.remove', requestHash);
    expect(claims.value).toMatch(/^sfp_an1_[A-Za-z0-9_-]{43}$/);
    expect(claims.expiresAt - claims.issuedAt).toBe(120_000);
    now = claims.expiresAt - 1;
    const attempts = await Promise.allSettled([
      store.consumeCas(actor, claims.value, 'workspace.remove', requestHash),
      store.consumeCas(actor, claims.value, 'workspace.remove', requestHash),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('expires at the exact TTL boundary before any protected effect', async () => {
    let now = 10;
    const store = createActionNonceStore({ leaderGeneration: 'generation-1', now: () => now });
    const requestHash = hashActionRequest('egress.reset', {});
    const claims = await store.issue(actor, 'egress.reset', requestHash);
    now = claims.expiresAt;
    await expect(
      store.consumeCas(actor, claims.value, 'egress.reset', requestHash),
    ).rejects.toMatchObject({
      code: 'ACTION_NONCE_INVALID',
    });
  });

  it('binds the audit claim hash to the issuing control auth session', async () => {
    const rawNonce = Uint8Array.from({ length: 32 }, (_, index) => index);
    const store = createActionNonceStore({
      leaderGeneration: 'generation-1',
      now: () => 10,
      randomBytes: () => rawNonce,
    });
    const requestHash = hashActionRequest('egress.reset', {});
    const claims = await store.issue(actor, 'egress.reset', requestHash);
    const nonceIdHash = `sha256:${createHash('sha256')
      .update('sfp-action-nonce-id-v1')
      .update(Buffer.from([0]))
      .update(rawNonce)
      .digest('hex')}`;
    const expected = `sha256:${createHash('sha256')
      .update('sfp-action-nonce-claim-v1')
      .update(Buffer.from([0]))
      .update(
        JSON.stringify({
          nonceIdHash,
          actorId: actor.actorId,
          authSessionId: actor.authSessionId,
          leaderGeneration: 'generation-1',
          action: 'egress.reset',
          requestHash,
          expiresAt: 120_010,
        }),
      )
      .digest('hex')}`;

    expect(store.claimHash(claims.value)).toBe(expected);
  });

  it('rejects consumption by a rotated same-owner control auth session', async () => {
    const store = createActionNonceStore({ leaderGeneration: 'generation-1' });
    const requestHash = hashActionRequest('egress.reset', {});
    const claims = await store.issue(actor, 'egress.reset', requestHash);
    const rotated = Object.freeze({
      ...actor,
      authSessionId: `auth1_${'C'.repeat(43)}` as const,
    });

    await expect(
      store.consumeCas(rotated, claims.value, 'egress.reset', requestHash),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
    expect(store.get(claims.value)).toMatchObject({ state: 'issued' });
  });

  it('meters retained auth, nonce, and workspace registration bytes before admission', async () => {
    const store = createActionNonceStore({
      leaderGeneration: 'generation-1',
      maxBytesPerActor: 500,
      randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index),
    });
    const registration = {
      requestedPath: `C:\\${'a'.repeat(320)}`,
      realPath: `C:\\${'b'.repeat(320)}`,
      identityKey: '1:2:3',
    } as const;
    const requestHash = hashActionRequest('workspace.add', { realPath: registration.realPath });

    await expect(store.issueWorkspaceAdd(actor, requestHash, registration)).rejects.toMatchObject({
      code: 'ACTION_NONCE_CAPACITY_EXCEEDED',
    });
  });

  it('rechecks retained-byte growth before changing issued to consumed', async () => {
    const rawNonce = Uint8Array.from({ length: 32 }, (_, index) => index);
    const requestHash = hashActionRequest('egress.reset', {});
    const value = `sfp_an1_${Buffer.from(rawNonce).toString('base64url')}`;
    const issuedAt = 10;
    const claims = {
      value,
      actorId: actor.actorId,
      leaderGeneration: 'generation-1',
      action: 'egress.reset',
      requestHash,
      issuedAt,
      expiresAt: 120_010,
      state: 'issued',
    } as const;
    const exactIssuedBytes = Buffer.byteLength(
      `${JSON.stringify({
        claims,
        authSessionId: actor.authSessionId,
        rawNonce: Buffer.from(rawNonce).toString('base64url'),
        registration: null,
      })}\n`,
      'utf8',
    );
    const store = createActionNonceStore({
      leaderGeneration: 'generation-1',
      now: () => issuedAt,
      maxBytesPerActor: exactIssuedBytes,
      randomBytes: () => rawNonce,
    });
    const issued = await store.issue(actor, 'egress.reset', requestHash);

    await expect(
      store.consumeCas(actor, issued.value, 'egress.reset', requestHash),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_CAPACITY_EXCEEDED' });
    expect(store.get(issued.value)).toMatchObject({ state: 'issued' });
  });

  it('holds exactly 1024 live rows and rejects the next issue without eviction', async () => {
    let counter = 0;
    const store = createActionNonceStore({
      leaderGeneration: 'generation-1',
      maxBytesPerActor: 10_000_000,
      randomBytes: size => {
        const bytes = Buffer.alloc(size);
        bytes.writeUInt32BE(counter++, size - 4);
        return bytes;
      },
    });
    const requestHash = hashActionRequest('egress.reset', {});
    const first = await store.issue(actor, 'egress.reset', requestHash);
    for (let index = 1; index < 1024; index += 1) {
      await store.issue(actor, 'egress.reset', requestHash);
    }

    await expect(store.issue(actor, 'egress.reset', requestHash)).rejects.toMatchObject({
      code: 'ACTION_NONCE_CAPACITY_EXCEEDED',
    });
    expect(store.get(first.value)).toMatchObject({ state: 'issued' });
  });
});
import { createHash } from 'node:crypto';
