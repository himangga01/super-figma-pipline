import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_EGRESS_CONFIG_V1,
  hashActionRequest,
  type ActorContext,
  type EgressConfigV1,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createAdminAuditStore } from '../../src/control/admin-audit-store.js';
import {
  createEgressAdminAuditTransactions,
  createEgressControl,
} from '../../src/control/egress-endpoints.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('egress control', () => {
  it('serializes same-expected concurrent transactions before incompatible cas-intent', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-egress-concurrent-'));
    roots.push(stateRoot);
    const auditStore = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    let transactionCounter = 0;
    const audit = createEgressAdminAuditTransactions({
      store: auditStore,
      randomBytes: size => {
        const bytes = Buffer.alloc(size);
        bytes.writeUInt32BE(transactionCounter++, size - 4);
        return bytes;
      },
    });
    const expectedHash = `sha256:${'c'.repeat(64)}` as const;
    const desiredHashes = [
      `sha256:${'d'.repeat(64)}` as const,
      `sha256:${'e'.repeat(64)}` as const,
    ];
    let currentHash = expectedHash as `sha256:${string}`;
    const invoke = (desiredConfigHash: `sha256:${string}`) =>
      audit.transact(
        {
          principal,
          action: 'egress.configure',
          requestHash: `sha256:${'a'.repeat(64)}`,
          actionNonceClaimHash: `sha256:${'b'.repeat(64)}`,
          expectedConfigHash: expectedHash,
          desiredConfigHash,
          allowedClasses: ['public'],
          expiresAt: '2026-08-31T01:00:00.000Z',
        },
        {
          validateExpected: async () => {
            if (currentHash !== expectedHash) {
              throw Object.assign(new Error('stale expected config'), {
                code: 'EGRESS_CONFIG_CAS_MISMATCH',
              });
            }
          },
          consumeNonce: async () => {},
          commitConfig: async () => {
            if (currentHash !== expectedHash) {
              throw Object.assign(new Error('stale expected config'), {
                code: 'EGRESS_CONFIG_CAS_MISMATCH',
              });
            }
            currentHash = desiredConfigHash;
            return { ...DEFAULT_EGRESS_CONFIG_V1, configHash: desiredConfigHash };
          },
        },
      );

    const outcomes = await Promise.allSettled(desiredHashes.map(invoke));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const auditRows = (
      await auditStore.queryEgress(principal.actorId, { since: null, cursor: null, limit: 1000 })
    ).rows;
    const stagesByTransaction = new Map<string, typeof auditRows>();
    for (const row of auditRows) {
      stagesByTransaction.set(row.auditTransactionId, [
        ...(stagesByTransaction.get(row.auditTransactionId) ?? []),
        row,
      ]);
    }
    const stageSequences = [...stagesByTransaction.values()].map(rows =>
      rows.map(row => row.stage),
    );
    expect(stageSequences).toContainEqual(['pending', 'cas-intent', 'committed']);
    expect(stageSequences).toContainEqual(['pending', 'aborted']);
    const committedRows = [...stagesByTransaction.values()].find(
      rows => rows.at(-1)?.stage === 'committed',
    )!;
    const abortedRows = [...stagesByTransaction.values()].find(
      rows => rows.at(-1)?.stage === 'aborted',
    )!;
    expect(
      committedRows.map(row => [
        row.stage,
        row.expectedConfigHash,
        row.desiredConfigHash,
        row.configHash,
      ]),
    ).toEqual([
      ['pending', expectedHash, null, null],
      ['cas-intent', expectedHash, desiredHashes[0], null],
      ['committed', expectedHash, desiredHashes[0], desiredHashes[0]],
    ]);
    expect(
      abortedRows.map(row => [
        row.stage,
        row.expectedConfigHash,
        row.desiredConfigHash,
        row.configHash,
      ]),
    ).toEqual([
      ['pending', expectedHash, null, null],
      ['aborted', expectedHash, null, expectedHash],
    ]);
    expect(JSON.stringify(auditRows)).not.toContain('sfp_consent1_');

    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const restartedRows = (
      await restarted.queryEgress(principal.actorId, { since: null, cursor: null, limit: 1000 })
    ).rows;
    expect(restartedRows.map(row => [row.stage, row.desiredConfigHash, row.configHash])).toEqual(
      auditRows.map(row => [row.stage, row.desiredConfigHash, row.configHash]),
    );
  });

  it('holds one actor/config lock before generating hidden desired consent', async () => {
    let current: Readonly<EgressConfigV1> = DEFAULT_EGRESS_CONFIG_V1;
    let entropyCalls = 0;
    let consumeCalls = 0;
    let releaseFirst!: () => void;
    let firstConsumeReached!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      firstConsumeReached = resolve;
    });
    const firstRelease = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const endpoint = createEgressControl({
      store: {
        load: async () => ({ config: current, expired: false, storageState: 'valid' as const }),
        save: async (next, expected) => {
          if (current.configHash !== expected) throw new Error('stale config');
          current = next;
        },
        reset: async () => DEFAULT_EGRESS_CONFIG_V1,
      },
      nonceStore: {
        issue: async () => {
          throw new Error('not used');
        },
        consumeCas: async () => {
          consumeCalls += 1;
          if (consumeCalls === 1) {
            firstConsumeReached();
            await firstRelease;
          }
        },
      },
      audit: {
        transact: async (_input, operations) => {
          await operations.validateExpected();
          await operations.consumeNonce();
          return operations.commitConfig();
        },
      },
      now: () => 1_724_803_200_000,
      randomBytes: size => Buffer.alloc(size, ++entropyCalls),
    });
    const request = (nonce: string) => ({
      schemaVersion: 1,
      mode: 'external-model',
      allowedClasses: ['public'],
      expiresInSeconds: 7200,
      actionNonce: nonce,
    });

    const first = endpoint.configure(principal, request(`sfp_an1_${'A'.repeat(43)}`));
    await firstBlocked;
    const second = endpoint.configure(principal, request(`sfp_an1_${'B'.repeat(43)}`));
    await new Promise(resolve => setImmediate(resolve));
    expect(entropyCalls).toBe(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(entropyCalls).toBe(2);
  });

  it('configures with server-generated consent and returns only redacted status', async () => {
    const initial: EgressConfigV1 = {
      schemaVersion: 1,
      mode: 'unknown-fail-closed',
      allowedClasses: [],
      consentId: null,
      configuredAt: null,
      expiresAt: null,
      configHash: `sha256:${'0'.repeat(64)}`,
    };
    let current: EgressConfigV1 = initial;
    const endpoint = createEgressControl({
      store: {
        load: async () => ({ config: current, expired: false, storageState: 'valid' as const }),
        save: async (next, expected) => {
          expect(expected).toBe(current.configHash);
          current = next;
        },
        reset: async () => initial,
      },
      nonceStore: {
        issue: async () => {
          throw new Error('not used');
        },
        consumeCas: async () => {},
      },
      audit: {
        transact: async (_input, operations) => {
          await operations.validateExpected();
          await operations.consumeNonce();
          return operations.commitConfig();
        },
      },
      now: () => 1_724_803_200_000,
      randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index),
    });
    const requestHash = hashActionRequest('egress.configure', {
      mode: 'external-model',
      allowedClasses: ['public'],
      expiresInSeconds: 7200,
    });
    const result = await endpoint.configure(principal, {
      schemaVersion: 1,
      mode: 'external-model',
      allowedClasses: ['public'],
      expiresInSeconds: 7200,
      actionNonce: `sfp_an1_${'A'.repeat(43)}`,
    });
    expect(result).toMatchObject({
      mode: 'external-model',
      allowedClasses: ['public'],
      expired: false,
    });
    expect(result).not.toHaveProperty('consentId');
    expect(current).toHaveProperty(
      'consentId',
      expect.stringMatching(/^sfp_consent1_[A-Za-z0-9_-]{22}$/),
    );
    expect(requestHash).toMatch(/^sha256:/);
  });
});
