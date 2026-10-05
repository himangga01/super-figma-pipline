import { expect, it } from 'vitest';

import {
  decodeNativePath,
  equalNativeGeometry,
  readNativeGeometry,
} from '../src/figma-native-geometry.js';

it('preserves decoded float32 coordinates and omits truly empty path blobs', () => {
  const bytes = Buffer.alloc(9);
  bytes[0] = 1;
  bytes.writeFloatLE(20.78125, 1);
  bytes.writeFloatLE(3.515625, 5);
  expect(decodeNativePath(bytes)).toBe('M20.78125 3.515625');
  expect(readNativeGeometry([{ commandsBlob: 0 }], [{ bytes: new Uint8Array() }])).toEqual([]);
});

it('decodes bounded binary path commands and rejects malformed operations', () => {
  const bytes = Buffer.alloc(19);
  bytes[0] = 1;
  bytes.writeFloatLE(2, 1);
  bytes.writeFloatLE(3, 5);
  bytes[9] = 2;
  bytes.writeFloatLE(4, 10);
  bytes.writeFloatLE(5, 14);
  bytes[18] = 0;
  expect(decodeNativePath(bytes)).toBe('M2 3 L4 5 Z');
  expect(() => decodeNativePath(new Uint8Array([99]))).toThrow(
    'FIGMA_NATIVE_PATH_OPCODE_UNSUPPORTED',
  );
  expect(() => decodeNativePath(new Uint8Array([4, 0]))).toThrow('FIGMA_NATIVE_PATH_TRUNCATED');
});
it('compares equivalent closed contours without suppressing changed geometry or unknown commands', () => {
  const path = (data: string) => [{ windingRule: 'NONZERO', data }];
  expect(
    equalNativeGeometry(
      path('M0 1 L1 1 L1 -1 L0 -1 L0 1 Z'),
      path('M0 0 L0 1 L1 1 L1 0 L1 -1 L0 -1 L0 0 Z'),
    ),
  ).toBe(true);
  expect(
    equalNativeGeometry(
      path('M1 0 C1 1 0 1 0 0 L1 0 Z'),
      path('M0.5 0 L1 0 C1 1 0 1 0 0 L0.5 0 Z'),
    ),
  ).toBe(true);
  expect(equalNativeGeometry(path('M0 0 L1 0 L1 1 Z'), path('M0 0 L2 0 L1 1 Z'))).toBe(false);
  expect(equalNativeGeometry(path('M0 0 X1 0 Z'), path('M0 0 X1 0 Z'))).toBe(false);
});

it('compares known API path serialization without changing decoded coordinates or hiding larger changes', () => {
  const path = (value: string) => [
    { windingRule: 'NONZERO', data: `M0 0 L${value} 0 L${value} 1 Z` },
  ];
  expect(equalNativeGeometry(path('1240.0145263671875'), path('1240.01'))).toBe(true);
  expect(equalNativeGeometry(path('20.78125'), path('20.7812'))).toBe(true);
  expect(equalNativeGeometry(path('1240.016'), path('1240.01'))).toBe(false);
  expect(equalNativeGeometry(path('1000004'), path('1000000.001'))).toBe(false);
});
