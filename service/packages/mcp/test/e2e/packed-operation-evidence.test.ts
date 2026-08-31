import {
  decodeFollowerInnerMessage,
  encodeFollowerInnerMessage,
  OperationEvidenceViewV1Schema,
} from '@sfp/shared';
import { describe, expect, it } from 'vitest';

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

describe('packed operation evidence parity', () => {
  it('preserves the same strict public view through control JSON and follower MessagePack', () => {
    const view = OperationEvidenceViewV1Schema.parse({
      schemaVersion: 1,
      serverVerified: true,
      statusProjection: {
        operationId: 'operation-1',
        status: 'succeeded',
        operationKind: 'tool',
        operationName: 'get_selection',
        operationFingerprintHash: hash('1'),
        resultHash: hash('2'),
        preExecutionConsentManifestHash: hash('3'),
        operationEvidenceReceiptHash: hash('4'),
        finalEgressManifestHash: hash('5'),
      },
      receipt: {
        schemaVersion: 1,
        operationId: 'operation-1',
        operationKind: 'tool',
        operationName: 'get_selection',
        argsHash: hash('6'),
        workspaceId: null,
        fileExecutionKeyHash: null,
        targetBindingHash: null,
        captureIntentHash: hash('7'),
        captureResult: false,
        finalizerHash: hash('5'),
        daemonGenerationHash: hash('8'),
        completedAt: '2026-08-31T00:00:00.000Z',
        contentHash: hash('4'),
        terminalStatus: 'succeeded',
        resultHash: hash('2'),
        resultBytes: 2,
        resultArtifact: null,
        nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
      },
      finalizerProjection: {
        finalStatus: 'output',
        manifestHash: hash('5'),
        preExecutionManifestHash: hash('3'),
        resultHash: hash('2'),
        reasonCode: null,
      },
    });
    const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
    const frame = decodeFollowerInnerMessage(
      encodeFollowerInnerMessage({
        version: 1,
        type: 'result',
        requestId,
        operationId: 'operation-1',
        result: view,
      }),
    );
    if (frame.type !== 'result') throw new Error('result frame expected');

    expect(OperationEvidenceViewV1Schema.parse(frame.result)).toEqual(view);
    expect(OperationEvidenceViewV1Schema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(view.receipt).not.toHaveProperty('actorId');
    expect(view.receipt).not.toHaveProperty('previousReceiptHash');
    expect(view.receipt).not.toHaveProperty('receiptHash');
    expect(view.receipt).not.toHaveProperty('state');
  });
});
