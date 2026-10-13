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

const linearNetwork = (vertices: number[][], segments: number[][], loop?: number[]) => {
  const buffer = Buffer.alloc(
    12 + vertices.length * 12 + segments.length * 28 + (loop ? 12 + loop.length * 4 : 0),
  );
  let offset = 0;
  const uint = (value: number) => {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  };
  const float = (value: number) => {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  };
  [vertices.length, segments.length, loop ? 1 : 0].forEach(uint);
  for (const [x, y] of vertices) {
    uint(0);
    float(x!);
    float(y!);
  }
  for (const [start, end] of segments) {
    uint(0);
    uint(start!);
    float(0);
    float(0);
    uint(end!);
    float(0);
    float(0);
  }
  if (loop) [1, 1, loop.length, ...loop].forEach(uint);
  return [{ bytes: buffer }];
};

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

it('preserves open vector paths instead of adding a closing edge used only for fills', () => {
  const original = fixture();
  const open = Buffer.concat([original.subarray(0, 64), original.subarray(92, 108)]);
  open.writeUInt32LE(1, 4);
  open.writeUInt32LE(1, 72);
  expect(readNativeVectorGeometry(input, [{ bytes: open }], { x: 20, y: 10 }, 'paths')).toEqual([
    { windingRule: 'NONZERO', data: 'M0 0 C0 10 20 10 20 0' },
  ]);
});

it('retains the double-precision scaling used by exported vector paths', () => {
  const bytes = fixture();
  bytes.writeFloatLE(18, 28);
  expect(
    readNativeVectorGeometry(
      { vectorNetworkBlob: 0, normalizedSize: { x: 20, y: 5 } },
      [{ bytes }],
      { x: 23.33333396911621, y: 10 },
      'paths',
    ),
  ).toEqual([
    {
      windingRule: 'NONZERO',
      data: 'M0 0 C0 10 21.000000572204588 10 21.000000572204588 0 L0 0 Z',
    },
  ]);
});

it('closes coincident native endpoints even when their vertex identities differ', () => {
  expect(
    readNativeVectorGeometry(
      input,
      linearNetwork(
        [
          [0, 0],
          [10, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [1, 2],
        ],
        [0, 1],
      ),
      { x: 10, y: 5 },
      'paths',
    ),
  ).toEqual([{ windingRule: 'NONZERO', data: 'M0 0 L10 0 L0 0 Z' }]);
});

it('retains unfilled branching paths and joins connected unfilled segments', () => {
  const arrows = linearNetwork(
    [
      [0, 6],
      [18, 6],
      [6, 0],
      [6, 12],
    ],
    [
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  );
  const arrowInput = { vectorNetworkBlob: 0, normalizedSize: { x: 18, y: 12 } };
  expect(readNativeVectorGeometry(arrowInput, arrows, { x: 18, y: 12 })).toEqual([]);
  expect(readNativeVectorGeometry(arrowInput, arrows, { x: 18, y: 12 }, 'paths')).toEqual([
    { windingRule: 'NONE', data: 'M0 6 L18 6 M0 6 L6 0 M0 6 L6 12' },
  ]);
  expect(
    readNativeVectorGeometry(
      input,
      linearNetwork(
        [
          [0, 0],
          [1, 0],
          [2, 1],
        ],
        [
          [0, 1],
          [1, 2],
        ],
      ),
      { x: 10, y: 5 },
      'paths',
    ),
  ).toEqual([{ windingRule: 'NONE', data: 'M0 0 L1 0 L2 1' }]);
});
