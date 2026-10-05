import { expect, it } from 'vitest';

import { readNativeTextProperties } from '../src/figma-native-text-properties.js';

const text = (characters: string, extra: Record<string, unknown> = {}) => ({
  characters,
  ...extra,
});
const ranges = (...weights: Array<number | undefined>) =>
  weights.map((weight, index) => {
    const range: { start: number; end: number; fontName: object; nativeFontWeight?: number } = {
      start: index,
      end: index + 1,
      fontName: { family: 'Fixture', style: 'Regular' },
    };
    if (weight !== undefined) range.nativeFontWeight = weight;
    return range;
  });

it('uses Figma omitted defaults and a single recorded font weight', () => {
  expect(readNativeTextProperties({ textData: text('ab') }, ranges(500, 500))).toEqual({
    values: {
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
      textTruncation: 'DISABLED',
      maxLines: null,
      textWrapStyle: 'AUTO',
      hyperlink: null,
      fontWeight: 500,
    },
    unknown: [],
  });
});

it('reports explicit node values and mixed character runs', () => {
  const node = {
    textCase: 'UPPER',
    textDecoration: 'NONE',
    textTruncation: 'ENDING',
    maxLines: 2,
    textWrapStyle: 'BALANCE',
    textData: text('abc', {
      characterStyleIDs: [0, 1, 1],
      styleOverrideTable: [{ styleID: 1, textDecoration: 'STRIKETHROUGH' }],
    }),
  };
  expect(readNativeTextProperties(node, ranges(400, 700, 700)).values).toEqual({
    textCase: 'UPPER',
    textDecoration: 'mixed',
    textTruncation: 'ENDING',
    maxLines: 2,
    textWrapStyle: 'BALANCE',
    hyperlink: null,
    fontWeight: 'mixed',
  });
  const uniform = {
    textData: text('ab', {
      characterStyleIDs: [1, 1],
      styleOverrideTable: [{ styleID: 1, textDecoration: 'STRIKETHROUGH' }],
    }),
  };
  expect(readNativeTextProperties(uniform, ranges(400, 400)).values.textDecoration).toBe(
    'STRIKETHROUGH',
  );
});

it('leaves unobserved or malformed forms unknown instead of guessing', () => {
  const result = readNativeTextProperties(
    {
      textTruncation: 'SOMETIMES',
      maxLines: -1,
      textData: text('ab', {
        characterStyleIDs: [0, 1],
        styleOverrideTable: [{ styleID: 1, hyperlink: { url: 'https://example.test/' } }],
      }),
    },
    ranges(400, undefined),
  );
  expect(result.unknown).toEqual(['textTruncation', 'maxLines', 'hyperlink', 'fontWeight']);
  for (const field of result.unknown) expect(result.values).not.toHaveProperty(field);
  expect(
    readNativeTextProperties({ textData: text('a', { characterStyleIDs: [3] }) }, null),
  ).toEqual({
    values: { textTruncation: 'DISABLED', maxLines: null, textWrapStyle: 'AUTO' },
    unknown: ['textCase', 'textDecoration', 'hyperlink', 'fontWeight'],
  });
});
