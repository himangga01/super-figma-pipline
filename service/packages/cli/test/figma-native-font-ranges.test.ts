import { expect, it } from 'vitest';

import { readNativeFontRanges } from '../src/figma-native-font-ranges.js';
import { compareFigmaCaptureNodes } from '../src/figma-native-nodes.js';

it('resolves mixed native character styles and accepts equivalent differently split font runs', () => {
  const base = { family: 'Example', style: 'Light' },
    bold = { family: 'Example', style: 'Bold' };
  const node = {
    textData: {
      characters: 'abcd',
      characterStyleIDs: [0, 0, 3, 3],
      styleOverrideTable: [{ styleID: 3, fontName: bold }],
    },
  };
  const ranges = readNativeFontRanges(node, base);
  expect(ranges).toEqual([
    { start: 0, end: 2, fontName: base },
    { start: 2, end: 4, fontName: bold },
  ]);
  const actual = [{ id: '1:1', fontName: base, resolvedFontRanges: ranges }];
  const reference = [
    {
      id: '1:1',
      fontName: 'mixed',
      textSegments: [
        { start: 0, end: 1, fontName: base },
        { start: 1, end: 2, fontName: base },
        { start: 2, end: 4, fontName: bold },
      ],
    },
  ];
  expect(compareFigmaCaptureNodes(actual, reference).fontRangeEvidence).toEqual([
    { nodeId: '1:1', matches: true },
  ]);
  reference[0]!.textSegments[1]!.start = 0;
  expect(compareFigmaCaptureNodes(actual, reference).fontRangeEvidence[0]?.matches).toBe(false);
});

it('does not invent missing character-style tables or partial range coverage', () => {
  const font = { family: 'Example', style: 'Regular' };
  expect(
    readNativeFontRanges({ textData: { characters: 'ab', characterStyleIDs: [0, 3] } }, font),
  ).toBeNull();
  expect(
    readNativeFontRanges({ textData: { characters: 'ab', characterStyleIDs: [0] } }, font),
  ).toBeNull();
  expect(
    readNativeFontRanges(
      {
        textData: {
          characters: 'a',
          characterStyleIDs: [3],
          styleOverrideTable: [{ styleID: 3 }, { styleID: 3 }],
        },
      },
      font,
    ),
  ).toBeNull();
});
