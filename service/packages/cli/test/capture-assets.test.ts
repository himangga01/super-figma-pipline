import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import type { Page } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({
  read: vi.fn<typeof import('../src/scripter-bridge.js').readScripterAsset>(),
}));
vi.mock('../src/scripter-bridge.js', () => ({ readScripterAsset: spies.read }));
import { captureBrowserAssets } from '../src/capture-assets.js';
import { parseFigmaTarget } from '../src/figma-url.js';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw new Error('TEST_CLEANUP_PATH');
    await rm(folder, { recursive: true, force: true });
  }
  vi.resetAllMocks();
});
async function makeFolder() {
  const path = await mkdtemp(join(tmpdir(), 'sfp-assets-'));
  folders.push(path);
  return path;
}
const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
const page = {} as Page;
const image = (hash: string) => ({ type: 'IMAGE', imageHash: hash });
it('fetches mixed text fill/stroke originals once but exports identical-byte roots separately', async () => {
  const root = await makeFolder();
  spies.read.mockResolvedValue(Buffer.from('same bytes'));
  const nodes = [
    {
      id: '1:1',
      name: 'First',
      type: 'TEXT',
      fills: [image('a')],
      strokes: [image('b')],
      textSegments: [{ fills: [image('c')], strokes: [image('d')] }],
    },
    {
      id: '1:2',
      name: 'Second',
      type: 'TEXT',
      segments: [{ fills: [image('c')], strokes: [image('e')] }],
    },
  ];
  const result = await captureBrowserAssets(page, target, nodes, root);
  expect(result).toHaveLength(7);
  expect(result.every(asset => asset.status === 'captured')).toBe(true);
  expect(spies.read.mock.calls.map(call => call[2])).toEqual([
    { kind: 'png', nodeId: '1:1' },
    { kind: 'png', nodeId: '1:2' },
    ...['a', 'b', 'c', 'd', 'e'].map(imageHash => ({ kind: 'image', imageHash })),
  ]);
  expect(
    new Set(result.filter(asset => asset.query.kind === 'png').map(asset => asset.path)).size,
  ).toBe(2);
});
it('completes an aggregate larger than 101 MB through bounded 64 MB batches', async () => {
  const root = await makeFolder();
  const bytes = Buffer.alloc(16_000_000, 7);
  spies.read.mockImplementation(async (_: unknown, __: unknown, query: unknown) =>
    (query as { kind: string }).kind === 'image' ? bytes : Buffer.from('root'),
  );
  const nodes = [
    {
      id: '1:1',
      name: 'Root',
      type: 'FRAME',
      fills: Array.from({ length: 7 }, (_, i) => image(String(i))),
    },
  ];
  let result = await captureBrowserAssets(page, target, nodes, root, { maxAssets: 256 });
  expect(result.some(asset => asset.status === 'pending')).toBe(true);
  for (let batch = 0; batch < 3 && result.some(asset => asset.status === 'pending'); batch++)
    result = await captureBrowserAssets(page, target, nodes, root, {
      maxAssets: 256,
      previous: result,
    });
  expect(result.every(asset => asset.status === 'captured')).toBe(true);
  expect(result.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0)).toBe(112_000_004);
  expect((await readFile(join(root, result.at(-1)!.path!))).equals(bytes)).toBe(true);
}, 30000);
it('reserves verified later prior assets before allocating earlier new assets', async () => {
  const root = await makeFolder();
  spies.read.mockResolvedValue(Buffer.alloc(10));
  const nodes = [{ id: '1:1', name: 'Root', type: 'FRAME', fills: [image('a')] }];
  const first = await captureBrowserAssets(page, target, nodes, root);
  spies.read.mockClear();
  spies.read.mockResolvedValue(Buffer.alloc(11));
  await expect(
    captureBrowserAssets(page, target, nodes, root, {
      previous: [{ query: first[0]!.query, status: 'pending' }, first[1]!],
      maxTotalBytes: 20,
    }),
  ).rejects.toThrow('ASSET_CAPTURE_TOTAL_LIMIT');
  expect(spies.read).toHaveBeenCalledOnce();
});
