import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StatePermissions } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import {
  loadOrCreateOperationIdIssuer,
  operationIdIssuerFromKey,
} from '../../src/execution/operation-id.js';
import { hashOperationFingerprint } from '../../src/execution/operation-journal.js';

const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const actor = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const now = 1_724_803_200_000;
const fixed =
  'sfp_op1_eyJ2IjoxLCJpc3N1ZWRBdCI6MTcyNDgwMzIwMDAwMCwia2V5SWQiOiJvcGsxX1l3M05LV2JFTTJhUkVsUkl1N0piVHciLCJub25jZSI6IkFBQUFBQUFBQUFBQUFBQUFBQUFBQUEiLCJhY3Rvckhhc2giOiJzaGEyNTY6MGJlNjkzYzk1ZjFhZWU0Zjk5N2Y3MzMzYTJmZjE4NTBjNDY5ZDVkZGNjNzJjYjA1YjFjNTNlNjg5YzAwZWQxMyJ9.BKjw7JOyw0vNV_ZLZuyQWBjyvhOL_cJLRwXpIiFs__k';

describe('server-issued operation IDs', () => {
  it('matches the exact canonical operation-id vector', () => {
    const issuer = operationIdIssuerFromKey(key);
    expect(issuer.issue(actor, now, { nonce: 'AAAAAAAAAAAAAAAAAAAAAA' })).toBe(fixed);
    expect(Buffer.byteLength(fixed, 'ascii')).toBe(304);
    expect(issuer.verify(actor, fixed, now)).toEqual({
      v: 1,
      issuedAt: now,
      keyId: 'opk1_Yw3NKWbEM2aRElRIu7JbTw',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      actorHash: 'sha256:0be693c95f1aee4f997f7333a2ff1850c469d5ddcc72cb05b1c53e689c00ed13',
    });
  });

  it('rejects forged, wrong-actor, expired, and future-skew-above IDs before lookup', () => {
    const issuer = operationIdIssuerFromKey(key);
    expect(() => issuer.verify(actor, `${fixed.slice(0, -1)}A`, now)).toThrowError(
      expect.objectContaining({ code: 'OPERATION_ID_INVALID' }),
    );
    expect(() =>
      issuer.verify('actor1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', fixed, now),
    ).toThrowError(expect.objectContaining({ code: 'OPERATION_ID_INVALID' }));

    const old = issuer.issue(actor, now, { nonce: 'AQAAAAAAAAAAAAAAAAAAAA' });
    expect(() => issuer.verify(actor, old, now + 2_592_000_000)).toThrowError(
      expect.objectContaining({ code: 'OPERATION_ID_EXPIRED' }),
    );
    const exactFuture = issuer.issue(actor, now + 300_000, {
      nonce: 'AgAAAAAAAAAAAAAAAAAAAA',
    });
    expect(issuer.verify(actor, exactFuture, now).issuedAt).toBe(now + 300_000);
    const aboveFuture = issuer.issue(actor, now + 300_001, {
      nonce: 'AwAAAAAAAAAAAAAAAAAAAA',
    });
    expect(() => issuer.verify(actor, aboveFuture, now)).toThrowError(
      expect.objectContaining({ code: 'OPERATION_ID_INVALID' }),
    );
  });

  it('matches the exact replay fingerprint vector including capture and target binding', () => {
    expect(
      hashOperationFingerprint({
        actorId: actor,
        operationId: fixed,
        operationKind: 'tool',
        operationName: 'get_screenshot',
        argsHash: `sha256:${'a'.repeat(64)}`,
        workspaceId: '123e4567-e89b-42d3-a456-426614174000',
        fileExecutionKeyHash: `sha256:${'b'.repeat(64)}`,
        targetBindingHash: `sha256:${'c'.repeat(64)}`,
        captureIntentHash: `sha256:${'d'.repeat(64)}`,
      }),
    ).toBe('sha256:8d7aea5bd6ebb7998477e38af2f9a896fcc2f1225cb2d11892685104196fed65');
  });

  it('persists the operation-ID key at its exact owner-secure path across restart', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-operation-key-'));
    const permissions: StatePermissions = {
      stateRoot,
      ensureSecure: async () => {},
      verifySecure: async () => {},
    };
    try {
      const first = await loadOrCreateOperationIdIssuer({
        stateRoot,
        permissions,
        randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index),
      });
      const restarted = await loadOrCreateOperationIdIssuer({
        stateRoot,
        permissions,
        randomBytes: size => Uint8Array.from({ length: size }, () => 255),
      });
      const options = { nonce: 'AAAAAAAAAAAAAAAAAAAAAA' } as const;
      expect(first.issue(actor, now, options)).toBe(restarted.issue(actor, now, options));
      expect(await readFile(join(stateRoot, 'auth', 'operation-id-key.v1'))).toHaveLength(32);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
