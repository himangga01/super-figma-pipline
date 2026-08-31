import { describe, expect, it } from 'vitest';

import {
  createOperationEvidenceProjector,
  verifyNativeEvidenceContext,
} from '../../src/execution/operation-evidence-projector.js';

const context = Object.freeze({
  operationId: 'operation-1',
  workspaceId: '123e4567-e89b-42d3-a456-426614174000',
});

describe('pure native evidence projection', () => {
  it('projects every baseline native exporter and no other tool', () => {
    const projector = createOperationEvidenceProjector();
    const screenshots = projector.project(
      context,
      'tool',
      'save_screenshots',
      {},
      {
        saved: [
          { nodeId: '1:2', format: 'PNG', path: 'assets/a.png' },
          { nodeId: '1:3', format: 'PNG', path: null },
        ],
      },
    );
    const pdf = projector.project(
      context,
      'tool',
      'export_pdf',
      {},
      {
        nodeId: '1:2',
        path: 'exports/a.pdf',
      },
    );
    const video = projector.project(
      context,
      'tool',
      'export_video',
      {},
      {
        nodeId: '1:2',
        format: 'MP4',
        path: 'exports/a.mp4',
      },
    );
    const fills = projector.project(
      context,
      'tool',
      'save_image_fills',
      {},
      {
        nodes: [{ nodeId: '1:2', images: [{ index: 0, imageHash: 'h', path: 'assets/fill.png' }] }],
      },
    );
    const ordinary = projector.project(context, 'tool', 'get_selection', {}, { nodes: [] });

    for (const projection of [screenshots, pdf, video, fills]) {
      expect(projection).toMatchObject({
        kind: 'export-candidates',
        contextHash: expect.stringMatching(/^sha256:/u),
      });
      expect(verifyNativeEvidenceContext(context, projection)).toMatchObject(context);
    }
    expect(ordinary).toMatchObject({ kind: 'no-artifact', reasonCode: 'not-native-evidence' });
    expect(JSON.stringify([screenshots, pdf, video, fills])).not.toMatch(/digest|artifactBytes/iu);
  });

  it('rejects a projection replayed under a different operation context', () => {
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'exports/a.pdf' },
    );
    expect(() =>
      verifyNativeEvidenceContext({ ...context, operationId: 'operation-2' }, projection),
    ).toThrowError(expect.objectContaining({ code: 'NATIVE_EVIDENCE_CONTEXT_INVALID' }));
  });
});
