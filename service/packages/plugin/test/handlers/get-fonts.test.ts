import type { GetFontsResult } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { createGetFontsHandler } from '../../src/handlers/get-fonts.js';

const text = (id: string, fontName: unknown, children?: SceneNode[]): SceneNode =>
  ({ id, name: id, type: 'TEXT', fontName, children }) as unknown as SceneNode;

const frame = (id: string, children: SceneNode[]): SceneNode =>
  ({ id, name: id, type: 'FRAME', children }) as unknown as SceneNode;

const fakeFigma = (pageChildren: SceneNode[]): typeof figma =>
  ({ currentPage: { children: pageChildren } }) as unknown as typeof figma;

describe('get_fonts handler', () => {
  it('counts fonts across the page and sorts by frequency desc', async () => {
    const page = [
      frame('F', [
        text('1', { family: 'Inter', style: 'Regular' }),
        text('2', { family: 'Inter', style: 'Regular' }),
        text('3', { family: 'Inter', style: 'Bold' }),
      ]),
      text('4', { family: 'Roboto', style: 'Regular' }),
    ];
    const result = (await createGetFontsHandler(fakeFigma(page))(undefined)) as GetFontsResult;
    expect(result.fonts).toEqual([
      { fontName: { family: 'Inter', style: 'Regular' }, count: 2 },
      { fontName: { family: 'Inter', style: 'Bold' }, count: 1 },
      { fontName: { family: 'Roboto', style: 'Regular' }, count: 1 },
    ]);
  });

  it('expands mixed-font text via styled segments', async () => {
    const mixed = {
      id: 'm',
      name: 'm',
      type: 'TEXT',
      fontName: Symbol('figma.mixed'),
      getStyledTextSegments: () => [
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Inter', style: 'Bold' } },
      ],
    } as unknown as SceneNode;
    const result = (await createGetFontsHandler(fakeFigma([mixed]))(undefined)) as GetFontsResult;
    expect(result.fonts.map(f => f.fontName.style).toSorted()).toEqual(['Bold', 'Regular']);
    expect(result.fonts.every(f => f.count === 1)).toBe(true);
  });

  it('returns empty when the page has no text', async () => {
    const result = (await createGetFontsHandler(fakeFigma([frame('F', [])]))(
      undefined,
    )) as GetFontsResult;
    expect(result.fonts).toEqual([]);
  });
});
it('lists actual available faces only when requested and never labels them page usage', async () => {
  let called = 0;
  const ctx = {
    currentPage: {
      get children() {
        throw new Error('PAGE_USAGE_MUST_NOT_BE_READ');
      },
    },
    listAvailableFontsAsync: async () => {
      called++;
      return [
        { fontName: { family: 'Zeta', style: 'Regular' } },
        { fontName: { family: 'Inter', style: 'Bold' } },
        { fontName: { family: 'Inter', style: 'Bold' } },
      ];
    },
  } as unknown as typeof figma;
  const result = await createGetFontsHandler(ctx)({ available: true });
  expect(called).toBe(1);
  expect(result).toEqual({
    scope: 'available',
    fonts: [
      { fontName: { family: 'Inter', style: 'Bold' }, count: 0 },
      { fontName: { family: 'Zeta', style: 'Regular' }, count: 0 },
    ],
  });
});
it('does not turn an unavailable or oversized font API into empty availability', async () => {
  await expect(createGetFontsHandler(fakeFigma([]))({ available: true })).rejects.toThrow(
    'font availability API unavailable',
  );
  const ctx = {
    listAvailableFontsAsync: async () =>
      Array.from({ length: 10001 }, () => ({ fontName: { family: 'Inter', style: 'Regular' } })),
  } as unknown as typeof figma;
  await expect(createGetFontsHandler(ctx)({ available: true })).rejects.toThrow(
    'available-font result limit',
  );
});
it('keeps legacy default output and explicitly observed empty availability distinct', async () => {
  expect(await createGetFontsHandler(fakeFigma([]))({})).toEqual({ fonts: [] });
  const ctx = { listAvailableFontsAsync: async () => [] } as unknown as typeof figma;
  expect(await createGetFontsHandler(ctx)({ available: true })).toEqual({
    scope: 'available',
    fonts: [],
  });
});
