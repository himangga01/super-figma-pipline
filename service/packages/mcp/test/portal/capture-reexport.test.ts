import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import pngModule from '@pdf-lib/upng';
import { contentHash, storedChecksum } from '@sfp/ir';
import { expect, it } from 'vitest';

import { portalCaptureFreshnessMatches } from '../../../ir/src/capture-freshness.js';
import { PortalPngReexportComparisonSchema } from '../../../shared/src/portal-capture-source.js';
import { provePortalPngReexport } from '../../src/portal/capture-freshness.js';
import { comparePortalPngReexport } from '../../src/portal/preview.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const png =
  'encode' in pngModule
    ? pngModule
    : (pngModule as unknown as { default: typeof pngModule }).default;
const image = (changes: Array<[number, number]> = [], width = 100) => {
  const pixels = new Uint8Array(width * 100 * 4).fill(127);
  for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
  for (const [index, value] of changes) pixels[index] = value;
  return new Uint8Array(png.encode([pixels.buffer], width, 100, 0));
};

it('accepts one RGB quantization step in at most one ten-thousandth of pixels', () => {
  const result = comparePortalPngReexport(image(), image([[0, 128]]));
  expect(result).toMatchObject({ changedPixels: 1, maxRgbDelta: 1, alphaChanged: false });
  expect(PortalPngReexportComparisonSchema.safeParse(result).success).toBe(true);
});

it.each([
  { changes: [[0, 129]] as Array<[number, number]>, reason: 'larger color changes' },
  {
    changes: [
      [0, 128],
      [4, 128],
    ] as Array<[number, number]>,
    reason: 'wider raster changes',
  },
  { changes: [[3, 254]] as Array<[number, number]>, reason: 'alpha changes' },
])(
  'rejects $reason even when geometry and source metadata are otherwise unchanged',
  ({ changes }) => {
    expect(
      PortalPngReexportComparisonSchema.safeParse(comparePortalPngReexport(image(), image(changes)))
        .success,
    ).toBe(false);
  },
);

it('accepts changed PNG ancillary bytes only with the same decoded pixels', () => {
  const original = Buffer.from(image());
  const text = Buffer.from('Software\0Second export');
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write('tEXt', 4);
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const alternate = Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]);
  expect(original.equals(alternate)).toBe(false);
  const result = comparePortalPngReexport(original, alternate);
  expect(result).toMatchObject({ changedPixels: 0, maxRgbDelta: 0, alphaChanged: false });
  expect(PortalPngReexportComparisonSchema.safeParse(result).success).toBe(true);
});

it('rejects mismatched dimensions and oversized decode requests', () => {
  expect(comparePortalPngReexport(image(), image([], 101))).toBeNull();
  const oversized = Buffer.from(image());
  oversized.writeUInt32BE(8193, 16);
  expect(() => comparePortalPngReexport(image(), oversized)).toThrow('PORTAL_PREVIEW_PIXEL_LIMIT');
});

it('verifies real capture files and rejects changed source facts, bytes and cancellation', async () => {
  const f = await portalFixture();
  try {
    const capture = async (name: string, bytes: Uint8Array, width = 100) => {
      const root = join(f.root, name);
      await mkdir(root);
      await writeFile(join(root, 'root.png'), bytes);
      return currentCaptureFixture(f, {
        nodes: [{ id: '1:1', type: 'FRAME', width, height: 100 }],
        assetRoot: root,
        assets: [
          {
            query: { kind: 'png', nodeId: '1:1' },
            status: 'captured',
            path: 'root.png',
            sha256: storedChecksum(bytes),
            bytes: bytes.length,
          },
        ],
      });
    };
    const original = await capture('original', image());
    const fresh = await capture('fresh', image([[0, 128]]));
    const signal = new AbortController().signal;
    const proof = await provePortalPngReexport(
      original.captured,
      fresh.captured,
      fresh.descriptor,
      signal,
    );
    expect(proof?.assets[0]?.png).toMatchObject({ changedPixels: 1, maxRgbDelta: 1 });
    expect(
      portalCaptureFreshnessMatches(original.descriptor, {
        version: 2,
        originalDescriptorHash: contentHash(
          'sfp-portal-capture-descriptor-v2',
          original.descriptor,
        ),
        freshDesignFingerprint: fresh.descriptor.designFingerprint,
        reexport: proof!,
      }),
    ).toBe(true);
    const changed = await capture('changed-source', image([[0, 128]]), 101);
    expect(
      await provePortalPngReexport(original.captured, changed.captured, changed.descriptor, signal),
    ).toBeNull();
    await expect(
      provePortalPngReexport(
        original.captured,
        fresh.captured,
        fresh.descriptor,
        AbortSignal.abort(new Error('Fixture cancellation')),
      ),
    ).rejects.toThrow('Fixture cancellation');
    await writeFile(join(fresh.captured.assetRoot, 'root.png'), image([[0, 150]]));
    await expect(
      provePortalPngReexport(original.captured, fresh.captured, fresh.descriptor, signal),
    ).rejects.toThrow('PORTAL_CAPTURE_ASSET_CHANGED');
  } finally {
    await f.cleanup();
  }
}, 30000);

it('reads only the differing PNG and accepts mixed rows with an export origin', async () => {
  const f = await portalFixture();
  try {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const exportedFrom = { nodeId: '1:1', geometryHash: contentHash('fixture-geometry-v1', 1) };
    const capture = async (name: string, bytes: Uint8Array) => {
      const root = join(f.root, name);
      await mkdir(root);
      await writeFile(join(root, 'root.png'), bytes);
      await writeFile(join(root, 'icon.svg'), svg);
      return currentCaptureFixture(f, {
        nodes: [
          {
            id: '1:1',
            type: 'FRAME',
            width: 100,
            height: 100,
            children: [{ id: '1:2', type: 'VECTOR', width: 10, height: 10 }],
          },
        ],
        assetRoot: root,
        assets: [
          {
            query: { kind: 'png', nodeId: '1:1' },
            status: 'captured',
            path: 'root.png',
            sha256: storedChecksum(bytes),
            bytes: bytes.length,
            exportedFrom,
          },
          {
            query: { kind: 'svg', nodeId: '1:2' },
            status: 'captured',
            path: 'icon.svg',
            sha256: storedChecksum(svg),
            bytes: svg.length,
          },
        ],
      });
    };
    const original = await capture('original', image());
    const fresh = await capture('fresh', image([[0, 128]]));
    // Callers verify both whole captures around the proof; the proof reads only differing PNGs.
    await rm(join(original.captured.assetRoot, 'icon.svg'));
    await rm(join(fresh.captured.assetRoot, 'icon.svg'));
    const proof = await provePortalPngReexport(
      original.captured,
      fresh.captured,
      fresh.descriptor,
      new AbortController().signal,
    );
    expect(proof?.assets.map(asset => asset.query.kind)).toEqual(['png', 'svg']);
    expect(proof?.assets[0]?.exportedFrom).toEqual(exportedFrom);
    expect(
      portalCaptureFreshnessMatches(original.descriptor, {
        version: 2,
        originalDescriptorHash: contentHash(
          'sfp-portal-capture-descriptor-v2',
          original.descriptor,
        ),
        freshDesignFingerprint: fresh.descriptor.designFingerprint,
        reexport: proof!,
      }),
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30000);

it.each([
  {
    reason: 'exceeds the bounded decoder',
    bytes: () => {
      const oversized = Buffer.from(image());
      oversized.writeUInt32BE(8193, 16);
      return new Uint8Array(oversized);
    },
  },
  { reason: 'is not a decodable PNG', bytes: () => new TextEncoder().encode('not a PNG export') },
])(
  'returns no proof instead of aborting acceptance when a verified fresh PNG $reason',
  async ({ bytes }) => {
    const f = await portalFixture();
    try {
      const capture = async (name: string, data: Uint8Array) => {
        const root = join(f.root, name);
        await mkdir(root);
        await writeFile(join(root, 'root.png'), data);
        return currentCaptureFixture(f, {
          nodes: [{ id: '1:1', type: 'FRAME', width: 100, height: 100 }],
          assetRoot: root,
          assets: [
            {
              query: { kind: 'png', nodeId: '1:1' },
              status: 'captured',
              path: 'root.png',
              sha256: storedChecksum(data),
              bytes: data.length,
            },
          ],
        });
      };
      const original = await capture('original', image());
      const fresh = await capture('fresh', bytes());
      await expect(
        provePortalPngReexport(
          original.captured,
          fresh.captured,
          fresh.descriptor,
          new AbortController().signal,
        ),
      ).resolves.toBeNull();
    } finally {
      await f.cleanup();
    }
  },
  30000,
);
