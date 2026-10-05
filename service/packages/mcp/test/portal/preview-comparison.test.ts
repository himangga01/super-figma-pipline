import pngModule from '@pdf-lib/upng';
import { expect, it } from 'vitest';

import { comparePortalPng } from '../../src/portal/preview.js';
const png =
  'encode' in pngModule
    ? pngModule
    : (pngModule as unknown as { default: typeof pngModule }).default;
const rectangle = (edge: number, shift = 0, fill = 0) => {
  const pixels = new Uint8Array(100 * 100 * 4).fill(255);
  for (let y = 20; y < 80; y++)
    for (let x = 25 + shift; x < 75 + shift; x++) {
      const at = (y * 100 + x) * 4;
      pixels[at] =
        pixels[at + 1] =
        pixels[at + 2] =
          x === 25 + shift || x === 74 + shift ? edge : fill;
    }
  return new Uint8Array(png.encode([pixels.buffer], 100, 100, 0));
};
it('keeps strict RGBA as the default and preserves its count in the fixed perceptual mode', () => {
  const source = rectangle(110),
    actual = rectangle(155);
  const strict = comparePortalPng(source, actual);
  const perceptual = comparePortalPng(source, actual, 12, 'pixelmatch-7.2-v1');
  expect(strict.comparisonMode).toBe('rgba-v1');
  expect(strict.ratio).toBeGreaterThan(0.01);
  expect(perceptual.strictRatio).toBe(strict.ratio);
  expect(perceptual.ratio).toBeLessThan(strict.ratio);
  expect(comparePortalPng(source, source, 12, 'pixelmatch-7.2-v1').ratio).toBe(0);
});
it('still rejects displaced, missing and recolored areas and mismatched dimensions', () => {
  const source = rectangle(110);
  expect(
    comparePortalPng(source, rectangle(110, 8), 12, 'pixelmatch-7.2-v1').ratio,
  ).toBeGreaterThan(0.03);
  expect(
    comparePortalPng(source, rectangle(255, 0, 255), 12, 'pixelmatch-7.2-v1').ratio,
  ).toBeGreaterThan(0.03);
  expect(
    comparePortalPng(source, rectangle(110, 0, 150), 12, 'pixelmatch-7.2-v1').ratio,
  ).toBeGreaterThan(0.03);
  const smaller = new Uint8Array(png.encode([new Uint8Array(50 * 50 * 4).buffer], 50, 50, 0));
  expect(comparePortalPng(source, smaller, 12, 'pixelmatch-7.2-v1')).toMatchObject({
    sameDimensions: false,
    ratio: 1,
    strictRatio: 1,
  });
});
