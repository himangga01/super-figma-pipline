import type { DesignJson } from '@sfp/shared';

/** Canonical expected values are derived from retained design material, never candidate CSS. */
export type { ConsumptionValue } from '../../../../shared/src/portal-consumption.js';
import type { ConsumptionValue } from '../../../../shared/src/portal-consumption.js';
const object = (value: unknown): value is Record<string, DesignJson> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export function sourceColor(value: unknown, opacity = 1): ConsumptionValue | null {
  if (
    !object(value) ||
    !numeric(value.r) ||
    !numeric(value.g) ||
    !numeric(value.b) ||
    [value.r, value.g, value.b].some(channel => channel < 0 || channel > 1) ||
    !numeric(opacity) ||
    opacity < 0 ||
    opacity > 1
  )
    return null;
  const alpha = value.a ?? 1;
  if (!numeric(alpha) || alpha < 0 || alpha > 1) return null;
  return { kind: 'color', value: [value.r, value.g, value.b, alpha * opacity] };
}
export function sourceSolidPaint(value: unknown): ConsumptionValue | null {
  if (!Array.isArray(value)) return null;
  const types = new Set([
    'SOLID',
    'IMAGE',
    'GRADIENT_LINEAR',
    'GRADIENT_RADIAL',
    'GRADIENT_ANGULAR',
    'GRADIENT_DIAMOND',
  ]);
  if (
    value.some(
      paint =>
        !object(paint) ||
        typeof paint.type !== 'string' ||
        !types.has(paint.type) ||
        (paint.visible !== undefined && typeof paint.visible !== 'boolean') ||
        (paint.opacity !== undefined &&
          (!numeric(paint.opacity) || paint.opacity < 0 || paint.opacity > 1)) ||
        (paint.blendMode !== undefined && paint.blendMode !== 'NORMAL') ||
        (paint.type === 'SOLID' && sourceColor(paint.color) === null),
    )
  )
    return null;
  const visible = value.filter(paint => object(paint) && paint.visible !== false);
  if (visible.length !== 1 || !object(visible[0]) || visible[0].type !== 'SOLID') return null;
  const opacity = visible[0].opacity ?? 1;
  return numeric(opacity) ? sourceColor(visible[0].color, opacity) : null;
}
/** Maps only properties with a concrete browser equivalent. Other material needs a typed verifier. */
export function sourceBindingProperty(property: string, nodeType: string): string | null {
  const clean = property.replace(/^\//u, '');
  if (/^fills\/\d+\/color$/u.test(clean)) return nodeType === 'TEXT' ? 'color' : 'background-color';
  if (/^strokes\/\d+\/color$/u.test(clean)) return 'border-top-color';
  const names: Record<string, string> = {
    width: 'width',
    height: 'height',
    minWidth: 'min-width',
    maxWidth: 'max-width',
    minHeight: 'min-height',
    maxHeight: 'max-height',
    opacity: 'opacity',
    cornerRadius: 'border-top-left-radius',
    topLeftRadius: 'border-top-left-radius',
    topRightRadius: 'border-top-right-radius',
    bottomLeftRadius: 'border-bottom-left-radius',
    bottomRightRadius: 'border-bottom-right-radius',
    fontSize: 'font-size',
    fontWeight: 'font-weight',
    fontFamily: 'font-family',
    itemSpacing: 'gap',
    paddingTop: 'padding-top',
    paddingRight: 'padding-right',
    paddingBottom: 'padding-bottom',
    paddingLeft: 'padding-left',
    characters: 'textContent',
    visible: 'visible',
  };
  return names[clean] ?? null;
}
export function sourceBindingValue(
  property: string,
  value: unknown,
  nodeType: string,
): ConsumptionValue | null {
  const target = sourceBindingProperty(property, nodeType);
  if (!target) return null;
  if (target.endsWith('color')) return sourceColor(value);
  if (target === 'textContent' && typeof value === 'string') return { kind: 'text', value };
  if (target === 'font-family' && typeof value === 'string') return { kind: 'font', value };
  if (numeric(value))
    return { kind: 'number', value, unit: ['opacity', 'font-weight'].includes(target) ? '' : 'px' };
  return null;
}
const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const numericCss = new RegExp(`^(${numberPattern})(px|%)?$`, 'u');
const colorCss = new RegExp(
  `^rgba?\\(\\s*(${numberPattern})(%?)\\s*(?:,|\\s)\\s*(${numberPattern})(%?)\\s*(?:,|\\s)\\s*(${numberPattern})(%?)(?:\\s*[,/]\\s*(${numberPattern})(%?))?\\s*\\)$`,
  'u',
);
function cssColor(input: string): number[] | null {
  const match = colorCss.exec(input.trim());
  if (!match) return null;
  const channels = [1, 3, 5].map(
    index => Number(match[index]) / (match[index + 1] === '%' ? 100 : 255),
  );
  const alpha = match[7] === undefined ? 1 : Number(match[7]) / (match[8] === '%' ? 100 : 1);
  const result = [...channels, alpha];
  return result.every(value => Number.isFinite(value) && value >= 0 && value <= 1) ? result : null;
}
/** Formatting normalization only; a wrong mode, opacity or unit remains a mismatch. */
export function matchesConsumptionValue(expected: ConsumptionValue, actual: string): boolean {
  if (expected.kind === 'text') return actual === expected.value;
  if (expected.kind === 'font') {
    const first = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/u.exec(actual);
    return !!first && (first[1] ?? first[2] ?? first[3])?.trim() === expected.value;
  }
  if (expected.kind === 'number') {
    const match = numericCss.exec(actual.trim());
    return (
      !!match &&
      (match[2] ?? '') === expected.unit &&
      Math.abs(Number(match[1]) - expected.value) <= (expected.unit === '' ? 0.001 : 0.02)
    );
  }
  const observed = cssColor(actual);
  return (
    !!observed &&
    observed.every(
      (value, index) =>
        Math.abs(value - expected.value[index]!) <= (index === 3 ? 0.001 : 0.5 / 255),
    )
  );
}
