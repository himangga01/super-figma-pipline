import { expect, it } from 'vitest';

import {
  matchesConsumptionValue,
  sourceBindingValue,
  sourceSolidPaint,
} from '../../src/portal/recipes/consumption-values.js';

it('compares actual source mode values and alpha rather than token names', () => {
  const light = sourceBindingValue('/fills/0/color', { r: 1, g: 0, b: 0, a: 0.5 }, 'RECTANGLE')!;
  const dark = sourceBindingValue('/fills/0/color', { r: 0, g: 0, b: 1, a: 0.5 }, 'RECTANGLE')!;
  expect(matchesConsumptionValue(light, 'rgba(255, 0, 0, 0.5)')).toBe(true);
  expect(matchesConsumptionValue(light, 'rgb(100% 0% 0% / 50%)')).toBe(true);
  expect(matchesConsumptionValue(dark, 'rgba(255, 0, 0, 0.5)')).toBe(false);
  expect(matchesConsumptionValue(light, 'rgb(255, 0, 0)')).toBe(false);
});
it('retains paint opacity and refuses to collapse multiple visible paints', () => {
  const paint = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.5 }, opacity: 0.4 };
  expect(sourceSolidPaint([paint])).toEqual({ kind: 'color', value: [1, 0, 0, 0.2] });
  expect(sourceSolidPaint([paint, { ...paint, visible: false }])).toEqual(
    sourceSolidPaint([paint]),
  );
  expect(sourceSolidPaint([paint, paint])).toBeNull();
  expect(sourceSolidPaint([{ type: 'IMAGE', imageHash: 'a' }])).toBeNull();
  expect(sourceSolidPaint([{ ...paint, opacity: 2 }])).toBeNull();
});
it('preserves units, exact text and actual first font family', () => {
  expect(matchesConsumptionValue(sourceBindingValue('/paddingLeft', 12, 'FRAME')!, '12px')).toBe(
    true,
  );
  expect(matchesConsumptionValue(sourceBindingValue('/paddingLeft', 12, 'FRAME')!, '12%')).toBe(
    false,
  );
  expect(matchesConsumptionValue(sourceBindingValue('/opacity', 0.4, 'FRAME')!, '0.4')).toBe(true);
  expect(
    matchesConsumptionValue(sourceBindingValue('/characters', 'Hello', 'TEXT')!, 'Other Hello'),
  ).toBe(false);
  expect(
    matchesConsumptionValue(
      sourceBindingValue('/fontFamily', 'Poppins', 'TEXT')!,
      '"Poppins", sans-serif',
    ),
  ).toBe(true);
  expect(
    matchesConsumptionValue(
      sourceBindingValue('/fontFamily', 'Poppins', 'TEXT')!,
      'Arial, Poppins',
    ),
  ).toBe(false);
  expect(sourceBindingValue('/unknown', 12, 'FRAME')).toBeNull();
});

it('rejects malformed paint rows and unsupported compositing instead of filtering them away', () => {
  const solid = { type: 'SOLID', color: { r: 1, g: 0, b: 0 } };
  for (const invalid of [
    null,
    'invalid',
    {},
    { type: 'SOLID', visible: 'false', color: { r: 1, g: 0, b: 0 } },
    { type: 'SOLID', visible: false, color: { r: 2, g: 0, b: 0 } },
  ])
    expect(sourceSolidPaint([solid, invalid])).toBeNull();
  expect(sourceSolidPaint([{ ...solid, blendMode: 'MULTIPLY' }])).toBeNull();
  expect(sourceSolidPaint([{ ...solid, blendMode: 'NORMAL' }])).toEqual({
    kind: 'color',
    value: [1, 0, 0, 1],
  });
});
it('keeps numeric opacity tolerance at one thousandth', () => {
  const opacity = sourceBindingValue('/opacity', 0.4, 'FRAME')!;
  expect(matchesConsumptionValue(opacity, '0.4')).toBe(true);
  expect(matchesConsumptionValue(opacity, '0.4011')).toBe(false);
  expect(matchesConsumptionValue(opacity, '0.41')).toBe(false);
});
