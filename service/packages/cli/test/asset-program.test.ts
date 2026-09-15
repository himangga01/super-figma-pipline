import { runInNewContext } from 'node:vm';

import type { Page } from 'playwright';
import { expect, it, vi } from 'vitest';

import {
  createAssetReadProgram,
  AssetReadResultSchema,
  createImageChunkReadProgram,
} from '../src/asset-program.js';
import { parseFigmaTarget } from '../src/figma-url.js';
import { readScripterAsset } from '../src/scripter-bridge.js';

it('exports the exact requested node and retains raw image bytes without navigation or writes', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const exportAsync = vi.fn<() => Promise<Uint8Array>>().mockResolvedValue(bytes);
  const getNodeByIdAsync = vi
    .fn<(id: string) => Promise<unknown>>()
    .mockResolvedValue({ exportAsync });
  const getBytesAsync = vi.fn<() => Promise<Uint8Array>>().mockResolvedValue(bytes);
  const host = {
    getNodeByIdAsync,
    getImageByHash: () => ({ getBytesAsync }),
    base64Encode: (value: Uint8Array) => Buffer.from(value).toString('base64'),
  };
  const svg = AssetReadResultSchema.parse(
    JSON.parse(
      await runInNewContext(createAssetReadProgram({ kind: 'svg', nodeId: 'I1:2;3:4' }), {
        figma: host,
      }),
    ),
  );
  expect(getNodeByIdAsync).toHaveBeenCalledExactlyOnceWith('I1:2;3:4');
  expect(exportAsync).toHaveBeenCalledWith({ format: 'SVG' });
  expect(Buffer.from(svg.base64, 'base64')).toEqual(Buffer.from(bytes));
  await runInNewContext(createAssetReadProgram({ kind: 'image', imageHash: 'a'.repeat(40) }), {
    figma: host,
  });
  expect(getBytesAsync).toHaveBeenCalledTimes(1);
  expect(() =>
    createAssetReadProgram({ kind: 'svg', nodeId: '1:2', code: 'figma.closePlugin()' }),
  ).toThrow(/Unrecognized/u);
});

it.each([
  ['hash', 'ASSET_IDENTITY_MISMATCH'],
  ['offset', 'ASSET_IDENTITY_MISMATCH'],
  ['length', 'ASSET_ENCODING_INVALID'],
  ['total', 'ASSET_CAPTURE_CHANGED'],
])('rejects mismatched image chunks: %s', async (change, error) => {
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  let call = 0;
  const page = {
    url: () => target.url,
    frames: () => [
      {
        url: () => 'https://scripter.rsms.me/',
        evaluate: async () => {
          const result = {
            imageHash: 'a'.repeat(40),
            offset: call * 1_048_576,
            totalBytes: 2_097_152,
            base64: Buffer.alloc(1_048_576).toString('base64'),
          };
          if (change === 'hash') result.imageHash = 'b'.repeat(40);
          if (change === 'offset') result.offset++;
          if (change === 'length') result.base64 = 'AA==';
          if (change === 'total' && call > 0) result.totalBytes++;
          call++;
          return JSON.stringify(result);
        },
      },
    ],
  } as unknown as Page;
  await expect(
    readScripterAsset(page, target, { kind: 'image', imageHash: 'a'.repeat(40) }),
  ).rejects.toThrow(error);
});

it('bounds chunk offsets and rejects images above the capture budget', async () => {
  expect(() => createImageChunkReadProgram({ imageHash: 'a'.repeat(40), offset: -1 })).toThrow(
    /Too small/u,
  );
  expect(() =>
    createImageChunkReadProgram({ imageHash: 'a'.repeat(40), offset: 16_777_216 }),
  ).toThrow(/Too big/u);
  await expect(
    runInNewContext(createImageChunkReadProgram({ imageHash: 'a'.repeat(40), offset: 0 }), {
      figma: { getImageByHash: () => ({ getBytesAsync: async () => ({ length: 16_777_217 }) }) },
    }),
  ).rejects.toThrow('ASSET_TOO_LARGE');
});

it('stops a chunked image before issuing another read after cancellation', async () => {
  const controller = new AbortController();
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  let reads = 0;
  const page = {
    url: () => target.url,
    frames: () => [
      {
        url: () => 'https://scripter.rsms.me/',
        evaluate: async (_: unknown, args: unknown) => {
          if (typeof args === 'string') return ''; // Read-scoped cancellation message.
          const offset = reads++ * 1_048_576;
          controller.abort(new Error('OWNER_CANCELLED'));
          return JSON.stringify({
            imageHash: 'a'.repeat(40),
            offset,
            totalBytes: 1_048_577,
            base64: Buffer.alloc(offset === 0 ? 1_048_576 : 1).toString('base64'),
          });
        },
      },
    ],
  } as unknown as Page;
  await expect(
    readScripterAsset(
      page,
      target,
      { kind: 'image', imageHash: 'a'.repeat(40) },
      { signal: controller.signal },
    ),
  ).rejects.toThrow('OWNER_CANCELLED');
  expect(reads).toBe(1);
});

it('bounds a hung browser evaluation with the host deadline and cancels its read ID', async () => {
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  const cancellations: string[] = [];
  const page = {
    url: () => target.url,
    frames: () => [
      {
        url: () => 'https://scripter.rsms.me/',
        evaluate: async (_: unknown, args: unknown) => {
          if (typeof args === 'string') {
            cancellations.push(args);
            return '';
          }
          return new Promise<string>(() => {});
        },
      },
    ],
  } as unknown as Page;
  await expect(
    readScripterAsset(
      page,
      target,
      { kind: 'svg', nodeId: '1:1' },
      { deadlineAt: Date.now() + 50 },
    ),
  ).rejects.toThrow('SNAPSHOT_READ_BUDGET');
  expect(cancellations).toHaveLength(1);
  expect(cancellations[0]).toMatch(/^sfp-read-/u);
});

it('reassembles a large immutable image through bounded responses without losing bytes', async () => {
  const bytes = Buffer.alloc(6_293_651);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const sizes: number[] = [];
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  const page = {
    url: () => target.url,
    frames: () => [
      {
        url: () => 'https://scripter.rsms.me/',
        evaluate: async (_: unknown, args: { program: string }) => {
          const result = await runInNewContext(args.program, {
            figma: {
              getImageByHash: () => ({ getBytesAsync: async () => bytes }),
              base64Encode: (value: Uint8Array) => Buffer.from(value).toString('base64'),
            },
          });
          sizes.push(Buffer.byteLength(result));
          return result;
        },
      },
    ],
  } as unknown as Page;
  const actual = await readScripterAsset(page, target, {
    kind: 'image',
    imageHash: 'a'.repeat(40),
  });
  expect(actual.equals(bytes)).toBe(true);
  expect(sizes.length).toBeGreaterThan(1);
  expect(Math.max(...sizes)).toBeLessThan(1_500_000);
});
