import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { stableContractJson } from '../../shared/src/capability-manifest.js';
import { canonicalJson, contentHash, encodeCanonicalJson } from '../src/canonical-json.js';

it('keeps streamed UTF-8 and hashes identical across chunk boundaries and Unicode values', () => {
  const values = [
    null,
    true,
    1.25,
    {
      z: undefined,
      b: [null, '디자인', '🪑'.repeat(10_000)],
      a: { label: '\\"\n\u0000', negative: -0 },
    },
    Array.from({ length: 300 }, (_, i) => ({
      index: i,
      name: `node-${i}`,
      mixed: [false, null, i / 3],
    })),
  ];
  for (const value of values) {
    const expected = stableContractJson(value);
    expect(canonicalJson(value)).toBe(expected);
    expect(Buffer.from(encodeCanonicalJson(value))).toEqual(Buffer.from(`${expected}\n`));
    expect(contentHash('fixture', value)).toBe(
      `sha256:${createHash('sha256').update('fixture\0').update(expected).digest('hex')}`,
    );
  }
});
it('rejects sparse arrays and non-JSON values consistently', () => {
  for (const value of [Array(2), { value: Infinity }, { value: () => {} }]) {
    expect(() => canonicalJson(value)).toThrow('CANONICAL_JSON_INVALID');
    expect(() => encodeCanonicalJson(value)).toThrow('CANONICAL_JSON_INVALID');
    expect(() => contentHash('fixture', value)).toThrow('CANONICAL_JSON_INVALID');
  }
});
