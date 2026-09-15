import { expect, it } from 'vitest';

import { createInspection, InspectionV1Schema } from '../src/inspection-v1.js';

it('binds common connector scope and artifact bytes and rejects a changed handoff', () => {
  const record = createInspection({
    source: 'chrome-scripter',
    target: {
      fileKey: 'FixtureFile1234',
      requestedUrl: 'https://www.figma.com/design/FixtureFile1234',
      nodeId: '0:1',
      pageId: '0:1',
    },
    capturedAt: '2026-09-06T00:00:00.000Z',
    fidelity: {
      values: 'partial',
      assets: 'partial',
      code: 'unavailable',
      issues: ['DEPTH_LIMIT'],
    },
    artifacts: { design: { path: 'design.json', sha256: `sha256:${'a'.repeat(64)}`, bytes: 1024 } },
  });
  expect(InspectionV1Schema.safeParse(record).success).toBe(true);
  expect(
    InspectionV1Schema.safeParse({
      ...record,
      fidelity: { ...record.fidelity, values: 'captured' },
    }).success,
  ).toBe(false);
});
