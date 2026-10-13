import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

import { expect, it } from 'vitest';

import { compareCaptureFacts, verifyCaptureAssets } from '../src/capture-fact-comparison.js';

const capture = (source = 'figma-web-page-api') => ({
  schemaVersion: 1,
  source,
  requestedUrl: 'https://www.figma.com/design/FixtureFile1234?node-id=0-1',
  requestedNodeId: '0:1',
  pageId: '0:1',
  scopeNodeId: '0:1',
  scopeType: 'PAGE',
  fileName: 'Fixture',
  pageName: 'Page',
  nodeCount: 1,
  sectionCount: 1,
  truncated: false,
  pendingScopes: [],
  pendingRootIds: [],
  warnings: [],
  nodes: [
    {
      id: '1:1',
      type: 'VECTOR',
      name: 'Shape',
      absoluteRenderBounds: { x: 1, y: 2, width: 3, height: 4 },
      vectorNetwork: { vertices: [{ x: 1, y: 2 }] },
    },
  ],
  tokens: [],
  collections: [],
  styles: { paints: [], texts: [], effects: [], grids: [] },
  catalogs: {},
  coverage: { fields: ['absoluteRenderBounds', 'vectorNetwork'] },
  observation: {
    readComplete: true,
    reobserved: true,
    atomic: false,
    method: 'ordered-query-reobservation',
    referencedClosure: { status: 'complete', issues: [] },
  },
  capture: { startedAt: 'different transport metadata' },
});

it('compares every observed node field while excluding named transport metadata', () => {
  const a = capture(),
    b = capture('figma-plugin-api-via-scripter');
  b.capture.startedAt = 'later';
  const r = compareCaptureFacts(a, b);
  expect(r).toMatchObject({
    observedFactsEqual: true,
    fullCaptureAccepted: false,
    differenceCount: 0,
    actualNodes: 1,
    referenceNodes: 1,
  });
  expect(r.comparedPositions).toBeGreaterThan(20);
  expect(r.actualSnapshotHash).not.toBe(r.referenceSnapshotHash);
  expect(r.actualFactsHash).toBe(r.referenceFactsHash);
});
it('detects render-bounds and vector-network changes excluded by the native conversion comparison', () => {
  const a = capture(),
    b = capture();
  b.nodes[0]!.absoluteRenderBounds.x = 5;
  b.nodes[0]!.vectorNetwork.vertices[0]!.x = 9;
  expect(compareCaptureFacts(a, b)).toMatchObject({
    observedFactsEqual: false,
    differenceCount: 2,
  });
});

it('does not silently discard newly observed root facts', () => {
  expect(
    compareCaptureFacts(
      { ...capture(), newDesignFact: { value: 1 } },
      { ...capture(), newDesignFact: { value: 2 } },
    ),
  ).toMatchObject({ observedFactsEqual: false, differenceCount: 1 });
});
it('preserves missing fields, topology and partial-read evidence', () => {
  const a = capture(),
    b = capture();
  delete (a.nodes[0] as Record<string, unknown>).absoluteRenderBounds;
  expect(compareCaptureFacts(a, b).differenceCount).toBe(1);
  a.truncated = true;
  const same = compareCaptureFacts(a, a);
  expect(same.observedFactsEqual).toBe(true);
  expect(same.inputsReportComplete).toBe(false);
});
it('refuses scope mismatch and duplicate node identities', () => {
  const a = capture(),
    b = capture();
  b.pageId = '0:2';
  expect(() => compareCaptureFacts(a, b)).toThrow('CAPTURE_COMPARISON_SCOPE_MISMATCH');
  a.nodes.push(a.nodes[0]!);
  a.nodeCount = 2;
  expect(() => compareCaptureFacts(a, capture())).toThrow('CAPTURE_NODE_ID_INVALID');
});
it('refuses a URL node that contradicts the recorded requested scope', () => {
  const a = capture();
  a.requestedUrl = 'https://www.figma.com/design/FixtureFile1234?node-id=99-99';
  expect(() => compareCaptureFacts(a, capture())).toThrow('CAPTURE_COMPARISON_SCOPE_MISMATCH');
});
it('refuses internally inconsistent scope declarations even when both inputs agree', () => {
  const a = capture();
  a.scopeNodeId = '99:99';
  expect(() => compareCaptureFacts(a, a)).toThrow('CAPTURE_COMPARISON_SCOPE_MISMATCH');
  a.scopeNodeId = '0:1';
  a.pageId = '99:99';
  expect(() => compareCaptureFacts(a, a)).toThrow('CAPTURE_COMPARISON_SCOPE_MISMATCH');
});
it('compares the current pinned Desktop reader source with independently acquired facts', () => {
  expect(compareCaptureFacts(capture('figma-plugin-api-pinned'), capture())).toMatchObject({
    observedFactsEqual: true,
    fullCaptureAccepted: false,
  });
});
it('verifies asset bytes and canonical query identity rather than object property order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-fact-assets-'));
  const fromTemp = relative(tmpdir(), root);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw Error('INVALID_FIXTURE_ROOT');
  try {
    const bytes = Buffer.from('owned-image-bytes');
    await writeFile(join(root, 'image.bin'), bytes);
    const row = {
      query: { kind: 'image', imageHash: 'a'.repeat(40) },
      status: 'captured',
      path: 'image.bin',
      bytes: bytes.length,
      sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    };
    const a = await verifyCaptureAssets([row], root);
    const b = await verifyCaptureAssets(
      [{ ...row, query: { imageHash: 'a'.repeat(40), kind: 'image' } }],
      root,
    );
    expect(compareCaptureFacts(capture(), capture(), a, b)).toMatchObject({
      verifiedAssetBytesEqual: true,
      assetCount: 1,
    });
    await writeFile(join(root, 'image.bin'), 'tampered');
    await expect(verifyCaptureAssets([row], root)).rejects.toThrow('CAPTURE_ASSET_BYTES_CHANGED');
    await expect(verifyCaptureAssets([{ ...row, path: '../outside' }], root)).rejects.toMatchObject(
      { code: 'PATH_OUTSIDE_WORKSPACE' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
