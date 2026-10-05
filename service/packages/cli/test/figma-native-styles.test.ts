import { expect, it } from 'vitest';

import {
  compareFigmaStyleCatalogs,
  normalizeFigmaNativeStyles,
} from '../src/figma-native-styles.js';

const style = (id: number, styleType: string, name: string, values = {}) => ({
  guid: { sessionID: 1, localID: id },
  styleType,
  name,
  ...values,
});

it('exposes independent native style values without inventing API identity or absent defaults', () => {
  const result = normalizeFigmaNativeStyles({
    nodeChanges: [
      style(1, 'FILL', 'Primary', {
        fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.5 }, opacity: 0.8 }],
      }),
      style(2, 'TEXT', 'Body', {
        fontName: { family: 'Example', style: 'Regular', postscript: 'Example-Regular' },
        fontSize: 16,
        lineHeight: { units: 'RAW', value: 1.5 },
        letterSpacing: { units: 'PERCENT', value: -0.05 },
      }),
      style(3, 'EFFECT', 'Shadow', {
        effects: [
          {
            type: 'DROP_SHADOW',
            radius: 6,
            color: { r: 0, g: 0, b: 0, a: 0.55 },
            authoredColor: { space: 'DEFAULT' },
          },
        ],
      }),
      style(4, 'FILL', 'Deleted', { isSoftDeleted: true }),
    ],
  });
  expect(result.complete).toBe(false);
  expect(result.deleted).toBe(1);
  expect(result.catalogs.paints[0]).toMatchObject({
    nativeId: '1:1',
    name: 'Primary',
    values: { paints: [{ opacity: 0.4 }] },
  });
  expect(result.catalogs.paints[0]).not.toHaveProperty('id');
  expect(result.catalogs.texts[0]?.values).toEqual({
    fontName: { family: 'Example', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'PERCENT', value: 150 },
    letterSpacing: { unit: 'PERCENT', value: -0.05 },
  });
  expect(result.catalogs.effects[0]?.values.effects).toEqual([
    { type: 'DROP_SHADOW', radius: 6, color: { r: 0, g: 0, b: 0, a: 0.55 } },
  ]);
});

it('rejects duplicate native identities and records unsupported style kinds', () => {
  expect(() =>
    normalizeFigmaNativeStyles({ nodeChanges: [style(1, 'TEXT', 'A'), style(1, 'TEXT', 'B')] }),
  ).toThrow('FIGMA_NATIVE_STYLE_INVALID');
  expect(
    normalizeFigmaNativeStyles({ nodeChanges: [style(1, 'FUTURE', 'Unknown')] }).unsupported,
  ).toEqual([{ nativeId: '1:1', styleType: 'FUTURE' }]);
});

it('keeps mixed-font differences, missing coverage and ambiguous names visible', () => {
  const native = normalizeFigmaNativeStyles({
    nodeChanges: [
      style(1, 'TEXT', 'Body', { fontName: { family: 'Example', style: 'Regular' }, fontSize: 16 }),
      style(2, 'FILL', 'Duplicate'),
      style(3, 'FILL', 'Duplicate'),
      style(4, 'EFFECT', 'Extra'),
    ],
  });
  const result = compareFigmaStyleCatalogs(native, {
    texts: [{ id: 'S:opaque', name: 'Body', fontName: 'mixed', fontSize: 16, paragraphIndent: 0 }],
    paints: [{ id: 'S:other', name: 'Duplicate' }, { name: 'Missing' }],
    effects: [],
    grids: [],
  });
  expect(result.fullCaptureAccepted).toBe(false);
  expect(result.pairs).toEqual([
    { kind: 'texts', name: 'Body', nativeId: '1:1', referenceId: 'S:opaque' },
  ]);
  expect(result.ambiguous).toEqual([
    { kind: 'paints', name: 'Duplicate', nativeCount: 2, referenceCount: 1 },
  ]);
  expect(result.missing).toEqual([{ kind: 'paints', name: 'Missing' }]);
  expect(result.extra).toEqual([{ kind: 'effects', name: 'Extra' }]);
  expect(result.differences).toHaveLength(1);
  expect(result.differences[0]?.field).toBe('fontName');
  expect(result.unobserved).toEqual([{ kind: 'texts', name: 'Body', fields: ['paragraphIndent'] }]);
});

it('resolves duplicate names with recorded native keys and preserves unmatched native IDs', () => {
  const native = normalizeFigmaNativeStyles({
    nodeChanges: [style(1, 'FILL', 'Primary', { key: 'remote-key' }), style(2, 'FILL', 'Primary')],
  });
  const result = compareFigmaStyleCatalogs(native, {
    paints: [
      { id: 'S:remote', key: 'remote-key', name: 'Primary' },
      { id: 'S:local', key: 'local-key', name: 'Primary' },
    ],
    texts: [],
    effects: [],
    grids: [],
  });
  expect(result.ambiguous).toEqual([]);
  expect(result.keyMatches).toEqual([
    { kind: 'paints', nativeId: '1:1', referenceId: 'S:remote', key: 'remote-key' },
  ]);
  expect(result.pairs).toEqual([
    { kind: 'paints', name: 'Primary', nativeId: '1:1', referenceId: 'S:remote' },
    { kind: 'paints', name: 'Primary', nativeId: '1:2', referenceId: 'S:local' },
  ]);
  expect(native.catalogs.paints[1]).not.toHaveProperty('key');
});
