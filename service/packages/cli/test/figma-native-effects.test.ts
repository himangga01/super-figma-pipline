import { expect, it } from 'vitest';

import { normalizeNativeEffects } from '../src/figma-native-effects.js';

const leftovers = {
  offset: { x: 0, y: 4 },
  blendMode: 'NORMAL',
  spread: 0,
  showShadowBehindNode: false,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  authoredColor: { space: 'DEFAULT', c0: 0, c1: 0, c2: 0, c3: 0.25 },
};

it('maps native blurs to Plugin API blur effects without retained shadow fields', () => {
  expect(
    normalizeNativeEffects([
      { type: 'FOREGROUND_BLUR', radius: 6, visible: true, ...leftovers },
      { type: 'BACKGROUND_BLUR', radius: 32, visible: false, ...leftovers },
    ]),
  ).toEqual([
    { type: 'LAYER_BLUR', visible: true, radius: 6, boundVariables: {}, blurType: 'NORMAL' },
    {
      type: 'BACKGROUND_BLUR',
      visible: false,
      radius: 32,
      boundVariables: {},
      blurType: 'NORMAL',
    },
  ]);
});

it('maps native drop and inner shadows with their exact recorded values', () => {
  const color = { r: 0, g: 0, b: 0, a: 0.1599999964237213 };
  expect(
    normalizeNativeEffects([
      {
        type: 'DROP_SHADOW',
        offset: { x: 0, y: 4 },
        radius: 14,
        visible: true,
        blendMode: 'NORMAL',
        spread: 1,
        showShadowBehindNode: true,
        color,
        authoredColor: { space: 'DEFAULT', c0: 0, c1: 0, c2: 0, c3: 0.16 },
      },
      {
        type: 'INNER_SHADOW',
        offset: { x: 1, y: -2 },
        radius: 3,
        visible: true,
        blendMode: 'MULTIPLY',
        spread: -4,
        showShadowBehindNode: false,
        color,
      },
    ]),
  ).toEqual([
    {
      type: 'DROP_SHADOW',
      visible: true,
      radius: 14,
      boundVariables: {},
      color,
      offset: { x: 0, y: 4 },
      spread: 1,
      blendMode: 'NORMAL',
      showShadowBehindNode: true,
    },
    {
      type: 'INNER_SHADOW',
      visible: true,
      radius: 3,
      boundVariables: {},
      color,
      offset: { x: 1, y: -2 },
      spread: -4,
      blendMode: 'MULTIPLY',
    },
  ]);
  expect(normalizeNativeEffects(undefined)).toEqual([]);
  expect(normalizeNativeEffects([])).toEqual([]);
});

it.each([
  {
    reason: 'a variable-bound radius',
    effects: [{ type: 'FOREGROUND_BLUR', radius: 6, visible: true, radiusVar: {} }],
  },
  { reason: 'a procedural glass effect', effects: [{ type: 'GLASS', radius: 6, visible: true }] },
  {
    reason: 'a progressive blur',
    effects: [{ type: 'FOREGROUND_BLUR', radius: 6, visible: true, blurOpType: 'PROGRESSIVE' }],
  },
  { reason: 'a missing visibility', effects: [{ type: 'FOREGROUND_BLUR', radius: 6 }] },
  {
    reason: 'a non-finite radius',
    effects: [{ type: 'FOREGROUND_BLUR', radius: Number.NaN, visible: true }],
  },
  {
    reason: 'an incomplete shadow color',
    effects: [{ ...leftovers, type: 'DROP_SHADOW', radius: 2, visible: true, color: { r: 0 } }],
  },
  { reason: 'a non-array effect list', effects: { type: 'DROP_SHADOW' } },
])('leaves $reason unknown instead of approximating it', ({ effects }) => {
  expect(normalizeNativeEffects(effects)).toBeNull();
});
