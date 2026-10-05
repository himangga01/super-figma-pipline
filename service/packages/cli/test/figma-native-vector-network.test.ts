import { expect, it } from 'vitest';

import { readNativeVectorGeometry } from '../src/figma-native-vector-network.js';

const fixture = () => {
  const buffer = Buffer.alloc(112);
  let offset = 0;
  const uint = (value: number) => {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  };
  const float = (value: number) => {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  };
  [2, 2, 1].forEach(uint);
  uint(0);
  float(0);
  float(0);
  uint(0);
  float(10);
  float(0);
  uint(0);
  uint(0);
  float(0);
  float(5);
  uint(1);
  float(0);
  float(5);
  uint(0);
  uint(1);
  float(0);
  float(0);
  uint(0);
  float(0);
  float(0);
  [1, 1, 2, 0, 1].forEach(uint);
  return buffer;
};
const input = { vectorNetworkBlob: 0, normalizedSize: { x: 10, y: 5 } };

it('derives scaled closed paths from native vertices, tangents and region loops', () => {
  expect(readNativeVectorGeometry(input, [{ bytes: fixture() }], { x: 20, y: 10 })).toEqual([
    { windingRule: 'NONZERO', data: 'M0 0 C0 10 20 10 20 0 L0 0 Z' },
  ]);
});

it('rejects invalid indices and truncation, and leaves styled networks explicitly unsupported', () => {
  const invalid = fixture();
  invalid.writeUInt32LE(99, 40);
  expect(() => readNativeVectorGeometry(input, [{ bytes: invalid }], { x: 20, y: 10 })).toThrow(
    'FIGMA_NATIVE_VECTOR_NETWORK_INVALID',
  );
  expect(() =>
    readNativeVectorGeometry(input, [{ bytes: fixture().subarray(0, 70) }], { x: 20, y: 10 }),
  ).toThrow('FIGMA_NATIVE_VECTOR_NETWORK_LIMIT');
  const styled = fixture();
  styled.writeUInt32LE(1, 12);
  expect(readNativeVectorGeometry(input, [{ bytes: styled }], { x: 20, y: 10 })).toBeNull();
});
