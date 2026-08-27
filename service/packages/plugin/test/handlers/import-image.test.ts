import type { CreateResult } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createImportImageHandler } from '../../src/handlers/import-image.js';

interface FakeRect {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  fills: unknown;
  resize: (w: number, h: number) => void;
}

const makeFigma = (): {
  figma: typeof figma;
  rect: FakeRect;
  page: { appendChild: ReturnType<typeof vi.fn> };
} => {
  const rect: FakeRect = {
    id: 'R:1',
    name: 'Rectangle',
    type: 'RECTANGLE',
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    fills: [],
    resize(w, h) {
      this.width = w;
      this.height = h;
    },
  };
  const page = { appendChild: vi.fn<(n: unknown) => void>() };
  const figmaCtx = {
    base64Decode: (s: string) => new Uint8Array([s.length]),
    createImage: () => ({
      hash: 'HASH123',
      getSizeAsync: async () => ({ width: 200, height: 100 }),
    }),
    createImageAsync: async () => ({
      hash: 'URLHASH',
      getSizeAsync: async () => ({ width: 50, height: 50 }),
    }),
    createRectangle: () => rect,
    currentPage: page,
  } as unknown as typeof figma;
  return { figma: figmaCtx, rect, page };
};

describe('import_image handler', () => {
  it('decodes base64 data, sizes the rect to the image, and applies an IMAGE fill', async () => {
    const { figma: f, rect, page } = makeFigma();
    const result = (await createImportImageHandler(f)({
      data: 'abc',
      name: 'Hero',
    })) as CreateResult;

    expect(rect.width).toBe(200);
    expect(rect.height).toBe(100);
    expect(rect.fills).toEqual([{ type: 'IMAGE', scaleMode: 'FILL', imageHash: 'HASH123' }]);
    expect(page.appendChild).toHaveBeenCalledWith(rect);
    expect(result).toEqual({ ok: true, nodeId: 'R:1', name: 'Hero', type: 'RECTANGLE' });
  });

  it('fetches from url and honors width/height/scaleMode overrides', async () => {
    const { figma: f, rect } = makeFigma();
    await createImportImageHandler(f)({
      url: 'https://x/y.png',
      width: 64,
      height: 64,
      scaleMode: 'FIT',
    });
    expect(rect.width).toBe(64);
    expect(rect.height).toBe(64);
    expect(rect.fills).toEqual([{ type: 'IMAGE', scaleMode: 'FIT', imageHash: 'URLHASH' }]);
  });

  it('requires exactly one nonempty trimmed data or URL source', async () => {
    const { figma: f } = makeFigma();
    for (const invalid of [
      { name: 'x' },
      { data: '' },
      { data: '   ' },
      { url: '\t' },
      { data: 'abc', url: 'https://x/y.png' },
    ]) {
      await expect(createImportImageHandler(f)(invalid)).rejects.toThrow(/exactly one.*data.*url/i);
    }
  });

  it('trims the selected source before invoking the matching Figma API', async () => {
    const base64Decode = vi.fn<(value: string) => Uint8Array>(() => new Uint8Array([1]));
    const createImageAsync = vi.fn<(value: string) => Promise<unknown>>(async () => ({
      hash: 'URLHASH',
      getSizeAsync: async () => ({ width: 50, height: 50 }),
    }));
    const { figma: base } = makeFigma();
    const f = { ...base, base64Decode, createImageAsync } as unknown as typeof figma;

    await createImportImageHandler(f)({ data: '  abc  ' });
    expect(base64Decode).toHaveBeenCalledWith('abc');

    await createImportImageHandler(f)({ url: '  https://x/y.png  ' });
    expect(createImageAsync).toHaveBeenCalledWith('https://x/y.png');
  });
});
