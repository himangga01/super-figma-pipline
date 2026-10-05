import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { compareNativeImageAssets } from '../src/figma-native-assets.js';

it('compares actual image bytes while retaining missing originals and unverified oracle kinds', () => {
  const bytes = Buffer.from('captured original');
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const imageHash = 'a'.repeat(40),
    missingHash = 'b'.repeat(40);
  const result = compareNativeImageAssets(new Map([[`images/${imageHash}`, bytes]]), [
    { query: { kind: 'image', imageHash }, status: 'captured', sha256 },
    { query: { kind: 'image', imageHash: missingHash }, status: 'captured', sha256 },
    { query: { kind: 'png', nodeId: '1:2' }, status: 'captured', sha256 },
  ]);
  expect(result.images.map(row => row.status)).toEqual(['match', 'missing']);
  expect(result.pendingKinds).toEqual({ png: 1 });
  expect(result.fullAssetAcceptance).toBe(false);
  expect(
    compareNativeImageAssets(new Map([[`images/${imageHash}`, Buffer.from('changed')]]), [
      { query: { kind: 'image', imageHash }, status: 'captured', sha256 },
    ]).images[0]?.status,
  ).toBe('different');
  expect(() =>
    compareNativeImageAssets(new Map(), [{ query: { kind: '__proto__' }, status: 'captured' }]),
  ).toThrow('FIGMA_COMPARISON_ASSETS_INVALID');
});
