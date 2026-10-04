import { expect, it } from 'vitest';

import { readNativeTextLayout } from '../src/figma-native-text-layout.js';

const layout = () => ({
  layoutSize: { x: 100, y: 40 },
  baselines: [
    { position: { x: 0, y: 15.4 }, width: 45, lineHeight: 20, firstCharacter: 0, endCharacter: 3 },
    { position: { x: 10, y: 35.4 }, width: 30, lineHeight: 20, firstCharacter: 3, endCharacter: 5 },
  ],
  glyphs: [{ fontSize: 16 }, { fontSize: 16 }],
});
it('preserves recorded baseline coordinates and original Unicode offsets without rescaling', () => {
  expect(readNativeTextLayout(layout(), 'A\u2028BCD')).toMatchObject({
    coordinateSpace: 'native-derived-text',
    characters: 'A\u2028BCD',
    glyphFontSizes: [16],
    baselines: [
      { position: { x: 0, y: 15.4 }, firstCharacter: 0, endCharacter: 3 },
      { position: { x: 10, y: 35.4 }, firstCharacter: 3, endCharacter: 5 },
    ],
  });
});
it('rejects overlapping, out-of-range, nonfinite and unbounded layout data', () => {
  const overlap = layout();
  overlap.baselines[1]!.firstCharacter = 2;
  const outside = layout();
  outside.baselines[1]!.endCharacter = 6;
  const invalid = layout();
  invalid.baselines[0]!.position.y = NaN;
  expect(readNativeTextLayout(overlap, 'ABCDE')).toBeNull();
  expect(readNativeTextLayout(outside, 'ABCDE')).toBeNull();
  expect(readNativeTextLayout(invalid, 'ABCDE')).toBeNull();
  expect(
    readNativeTextLayout(
      { ...layout(), glyphs: Array.from({ length: 65537 }, () => ({ fontSize: 16 })) },
      'ABCDE',
    ),
  ).toBeNull();
  expect(readNativeTextLayout(undefined, 'ABCDE')).toBeNull();
  expect(readNativeTextLayout({ ...layout(), layoutSize: { x: -1, y: 40 } }, 'ABCDE')).toBeNull();
});

it('retains explicit glyph positions without inventing positions for unavailable or repeated indices', () => {
  const value = {
    ...layout(),
    glyphs: [
      { fontSize: 16, firstCharacter: 3, position: { x: 10, y: 35.4 } },
      { fontSize: 16, firstCharacter: 0, position: { x: 0, y: 15.4 } },
    ],
  };
  expect(readNativeTextLayout(value, 'ABCDE')?.glyphPositions).toEqual([
    { index: 0, x: 0, y: 15.4 },
    { index: 3, x: 10, y: 35.4 },
  ]);
  expect(
    readNativeTextLayout({ ...value, glyphs: [value.glyphs[0], value.glyphs[0]] }, 'ABCDE')
      ?.glyphPositions,
  ).toBeUndefined();
  expect(readNativeTextLayout(layout(), 'ABCDE')?.glyphPositions).toBeUndefined();
});
