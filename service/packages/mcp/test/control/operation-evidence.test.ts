import { describe, expect, it, vi } from 'vitest';

import { createOperationEvidenceEndpoint } from '../../src/control/operation-evidence-endpoint.js';

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const principal = Object.freeze({
  actorId,
  authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const,
  entryPath: 'control' as const,
});

describe('authenticated operation evidence view', () => {
  it('returns one server-verified public projection and strips private chain fields', async () => {
    const readVerifiedFinalizer = vi.fn<
      () => Promise<{
        finalStatus: 'output';
        manifestHash: `sha256:${string}`;
        preExecutionManifestHash: `sha256:${string}`;
        resultHash: `sha256:${string}`;
        reasonCode: null;
      }>
    >(async () => ({
      finalStatus: 'output',
      manifestHash: hash('f'),
      preExecutionManifestHash: hash('1'),
      resultHash: hash('2'),
      reasonCode: null,
    }));
    const endpoint = createOperationEvidenceEndpoint({
      operations: {
        get: () => ({
          actorId,
          operationId: 'operation-1',
          operationKind: 'tool',
          operationName: 'get_selection',
          operationFingerprintHash: hash('3'),
          status: 'succeeded',
          resultHash: hash('2'),
          preExecutionConsentManifestHash: hash('1'),
          operationEvidenceReceiptHash: hash('c'),
          finalEgressManifestHash: hash('f'),
        }),
      },
      receipts: {
        get: async () => ({
          schemaVersion: 1,
          state: 'prepared',
          actorId,
          operationId: 'operation-1',
          operationKind: 'tool',
          operationName: 'get_selection',
          argsHash: hash('a'),
          workspaceId: null,
          fileExecutionKeyHash: null,
          targetBindingHash: null,
          captureIntentHash: hash('b'),
          captureResult: false,
          finalizerHash: hash('f'),
          daemonGenerationHash: hash('d'),
          completedAt: '2026-08-31T00:00:00.000Z',
          previousReceiptHash: hash('e'),
          contentHash: hash('c'),
          receiptHash: hash('4'),
          terminalStatus: 'succeeded',
          resultHash: hash('2'),
          resultBytes: 2,
          resultArtifact: null,
          nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
        }),
      },
      egress: { readVerifiedFinalizer },
    });

    const view = await endpoint(principal, 'operation-1');
    expect(view).toMatchObject({
      schemaVersion: 1,
      serverVerified: true,
      statusProjection: { operationId: 'operation-1', status: 'succeeded' },
      receipt: { contentHash: hash('c'), finalizerHash: hash('f') },
      finalizerProjection: { manifestHash: hash('f') },
    });
    expect(view.receipt).not.toHaveProperty('actorId');
    expect(view.receipt).not.toHaveProperty('previousReceiptHash');
    expect(view.receipt).not.toHaveProperty('receiptHash');
    expect(view.receipt).not.toHaveProperty('state');
    expect(readVerifiedFinalizer).toHaveBeenCalledWith(actorId, 'operation-1', hash('f'));
  });

  it('fails closed when reciprocal receipt and finalizer hashes do not match', async () => {
    const endpoint = createOperationEvidenceEndpoint({
      operations: {
        get: () => ({
          actorId,
          operationId: 'operation-1',
          operationKind: 'tool',
          operationName: 'get_selection',
          operationFingerprintHash: hash('3'),
          status: 'succeeded',
          resultHash: hash('2'),
          preExecutionConsentManifestHash: hash('1'),
          operationEvidenceReceiptHash: hash('c'),
          finalEgressManifestHash: hash('f'),
        }),
      },
      receipts: {
        get: async () => ({ contentHash: hash('c'), finalizerHash: hash('5') }) as never,
      },
      egress: {
        readVerifiedFinalizer: async () =>
          ({ manifestHash: hash('f'), finalStatus: 'output' }) as never,
      },
    });

    await expect(endpoint(principal, 'operation-1')).rejects.toMatchObject({
      code: 'OPERATION_EVIDENCE_INVALID',
    });
  });

  it('rejects a serverVerified view when one receipt identity field differs from journal', async () => {
    const endpoint = createOperationEvidenceEndpoint({
      operations: {
        get: () => ({
          actorId,
          operationId: 'operation-identity',
          operationKind: 'tool',
          operationName: 'get_selection',
          argsHash: hash('a'),
          workspaceId: null,
          fileExecutionKeyHash: null,
          targetBindingHash: null,
          captureIntentHash: hash('b'),
          operationFingerprintHash: hash('3'),
          leaderGeneration: 'generation-1',
          status: 'succeeded',
          resultHash: hash('2'),
          preExecutionConsentManifestHash: hash('1'),
          operationEvidenceReceiptHash: hash('c'),
          finalEgressManifestHash: hash('f'),
        }),
      },
      receipts: {
        get: async () => ({
          schemaVersion: 1,
          state: 'prepared',
          actorId,
          operationId: 'operation-identity',
          operationKind: 'tool',
          operationName: 'get_selection',
          argsHash: hash('4'),
          workspaceId: null,
          fileExecutionKeyHash: null,
          targetBindingHash: null,
          captureIntentHash: hash('b'),
          captureResult: false,
          finalizerHash: hash('f'),
          daemonGenerationHash: hash('d'),
          completedAt: '2026-08-31T00:00:00.000Z',
          previousReceiptHash: null,
          contentHash: hash('c'),
          receiptHash: hash('5'),
          terminalStatus: 'succeeded',
          resultHash: hash('2'),
          resultBytes: 2,
          resultArtifact: null,
          nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
        }),
      },
      egress: {
        readVerifiedFinalizer: async () => ({
          finalStatus: 'output',
          manifestHash: hash('f'),
          preExecutionManifestHash: hash('1'),
          resultHash: hash('2'),
          reasonCode: null,
        }),
      },
    });

    await expect(endpoint(principal, 'operation-identity')).rejects.toMatchObject({
      code: 'OPERATION_EVIDENCE_INVALID',
    });
  });
});
