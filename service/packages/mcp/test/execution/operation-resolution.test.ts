import type { ActorContext, OperationRecord } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import {
  assertOperationCancellationAuthority,
  createOperationResolutionRecord,
  OperationListRequestSchema,
} from '../../src/control/operation-endpoints.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'C'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;
const hash = (char: string) => `sha256:${char.repeat(64)}` as const;

describe('operation resolution endpoint', () => {
  it('rejects an unknown operation status filter before journal lookup', () => {
    expect(OperationListRequestSchema.safeParse({ status: 'not-a-status' }).success).toBe(false);
  });

  it('rejects same-owner cancellation from a different origin auth session', () => {
    expect(() => assertOperationCancellationAuthority(unknownRecord(), principal)).toThrowError(
      expect.objectContaining({ code: 'CANCEL_AUTH_SESSION_MISMATCH' }),
    );
  });

  it('copies the unknown fingerprint and records the distinct resolver auth session', () => {
    const unknown = unknownRecord();
    const record = createOperationResolutionRecord(
      unknown,
      principal,
      {
        decision: 'abandoned',
        reasonHash: hash('e'),
        evidenceHash: hash('f'),
        confirmedResultHash: null,
        confirmationHash: hash('0'),
      },
      1_724_803_200_000,
    );
    expect(record).toMatchObject({
      originAuthSessionId: unknown.originAuthSessionId,
      resolverAuthSessionId: principal.authSessionId,
      operationFingerprintHash: unknown.operationFingerprintHash,
      finalEgressManifestHash: unknown.finalEgressManifestHash,
    });
  });
});

const unknownRecord = (): OperationRecord =>
  ({
    actorId: principal.actorId,
    originAuthSessionId: `auth1_${'B'.repeat(43)}`,
    origin: { kind: 'entry', entryPath: 'mcp-direct', authSessionId: `auth1_${'B'.repeat(43)}` },
    operationId: 'operation-1',
    issuedAt: 1,
    operationKind: 'tool',
    operationName: 'create_text',
    argsHash: hash('a'),
    captureIntentHash: hash('b'),
    operationFingerprintHash: hash('c'),
    resultHash: null,
    resultBytes: null,
    workspaceId: null,
    fileExecutionKey: null,
    fileExecutionKeyHash: null,
    targetBindingHash: null,
    pluginGeneration: null,
    policyId: 'policy',
    effectSummary: [],
    approvalId: null,
    preExecutionConsentManifestHash: null,
    finalEgressManifestHash: hash('d'),
    operationEvidenceReceiptHash: null,
    sequence: 3,
    previousStatus: 'dispatched',
    status: 'outcome-unknown',
    createdAt: '2026-08-31T00:00:00.000Z',
    settledAt: '2026-08-31T00:00:00.000Z',
    errorCode: 'TRANSPORT_LOST',
  }) satisfies OperationRecord;
