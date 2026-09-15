import type { Page } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';

import { captureBrowserAssets } from '../../../cli/src/capture-assets.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { readScripterAsset, type BrowserNode } from '../../../cli/src/scripter-bridge.js';
import { portalFixture } from './fixtures.js';

vi.mock('../../../cli/src/scripter-bridge.js', () => ({
  readScripterAsset: vi.fn<typeof readScripterAsset>(async () => Buffer.from('asset')),
}));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it('continues beyond 256 assets without exporting the completed prefix again', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const nodes = Array.from({ length: 260 }, (_, index) => ({
    id: `1:${index}`,
    type: 'FRAME',
    name: `Frame ${index}`,
  })) as BrowserNode[];
  const target = parseFigmaTarget(
    'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
  );
  const first = await captureBrowserAssets({} as Page, target, nodes, value.workspaceRoot, {
    maxAssets: 256,
  });
  expect(first.filter(asset => asset.status === 'captured')).toHaveLength(256);
  const second = await captureBrowserAssets({} as Page, target, nodes, value.workspaceRoot, {
    maxAssets: 256,
    previous: first,
  });
  expect(second.every(asset => asset.status === 'captured')).toBe(true);
  expect(readScripterAsset).toHaveBeenCalledTimes(260);
  // Simulate a crash after publication but before the second progress checkpoint.
  const recovered = await captureBrowserAssets({} as Page, target, nodes, value.workspaceRoot, {
    maxAssets: 256,
    previous: first,
  });
  expect(recovered.every(asset => asset.status === 'captured')).toBe(true);
  expect(readScripterAsset).toHaveBeenCalledTimes(264);
}, 60_000);

it('reuses an exact visible vector export for a hidden state and rejects a different paint', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const base = {
    type: 'VECTOR',
    name: 'Icon',
    width: 16,
    height: 16,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    strokes: [],
    effects: [],
    fillGeometry: [{ windingRule: 'NONZERO', data: 'M0 0 L16 0 L16 16 Z' }],
    strokeGeometry: [],
    opacity: 1,
  };
  const nodes: BrowserNode[] = [
    {
      id: '1:1',
      name: 'Screen',
      type: 'FRAME',
      children: [
        { ...base, id: '1:2' },
        {
          id: '1:3',
          name: 'Hidden hover',
          type: 'GROUP',
          visible: false,
          children: [
            { ...base, id: '1:4' },
            { ...base, id: '1:5', fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] },
          ],
        },
      ],
    },
  ];
  vi.mocked(readScripterAsset).mockImplementation(async (_page, _target, input: any) => {
    if (input.nodeId === '1:4' || input.nodeId === '1:5') throw new Error('Invisible export');
    return Buffer.from('exact-original-export');
  });
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  const assets = await captureBrowserAssets({} as Page, target, nodes, value.workspaceRoot, {
    renderingComplete: true,
  });
  expect(
    assets.find(asset => asset.query.kind === 'svg' && asset.query.nodeId === '1:4'),
  ).toMatchObject({
    status: 'captured',
    exportedFrom: { nodeId: '1:2', geometryHash: expect.stringMatching(/^sha256:/u) },
  });
  expect(
    assets.find(asset => asset.query.kind === 'svg' && asset.query.nodeId === '1:5')?.status,
  ).toBe('unavailable');
  expect(
    vi
      .mocked(readScripterAsset)
      .mock.calls.some(
        call => JSON.stringify(call[2]) === JSON.stringify({ kind: 'svg', nodeId: '1:4' }),
      ),
  ).toBe(false);
  const incomplete = await captureBrowserAssets({} as Page, target, nodes, value.workspaceRoot);
  expect(
    incomplete.find(asset => asset.query.kind === 'svg' && asset.query.nodeId === '1:4')?.status,
  ).toBe('unavailable');
}, 60_000);
