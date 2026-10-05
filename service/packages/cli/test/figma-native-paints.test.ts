import { expect, it } from 'vitest';

import { normalizeNativePaints } from '../src/figma-native-paints.js';

it('maps native stretch image transforms to crop without inventing a separate rotation', () => {
  const result = normalizeNativePaints([
    {
      type: 'IMAGE',
      imageScaleMode: 'STRETCH',
      image: { hash: new Uint8Array(20) },
      transform: { m00: 0.5, m11: 0.75, m02: 0.1 },
    },
  ]);
  expect(result[0]).toMatchObject({
    scaleMode: 'CROP',
    imageTransform: [
      [0.5, 0, 0.1],
      [0, 0.75, 0],
    ],
  });
  expect(result[0]).not.toHaveProperty('rotation');
});

it('preserves solid alpha and gradient transforms and selects the actual animated image reference', () => {
  const paints = normalizeNativePaints([
    { type: 'SOLID', opacity: 0.5, color: { r: 1, g: 0, b: 0, a: 0.5 } },
    {
      type: 'GRADIENT_LINEAR',
      stops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 0 } }],
      transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
    },
    {
      type: 'IMAGE',
      image: { hash: new Uint8Array(20).fill(1) },
      animatedImage: { hash: new Uint8Array(20).fill(2) },
      imageScaleMode: 'FILL',
      scale: 0.5,
    },
  ]);
  expect(paints[0]).toMatchObject({ opacity: 0.25, color: { r: 1, g: 0, b: 0 } });
  expect(paints[1]).toMatchObject({
    gradientTransform: [
      [0, 1, 0],
      [-1, 0, 1],
    ],
    gradientStops: [{ color: { r: 0, g: 0, b: 0, a: 0 }, position: 0 }],
  });
  expect(paints[2]).toMatchObject({
    imageHash: '02'.repeat(20),
    scaleMode: 'FILL',
    scalingFactor: 0.5,
  });
});
