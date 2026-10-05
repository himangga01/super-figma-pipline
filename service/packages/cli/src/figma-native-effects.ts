type Row = Record<string, unknown>;

const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const BLURS = new Map([
  ['FOREGROUND_BLUR', 'LAYER_BLUR'],
  ['BACKGROUND_BLUR', 'BACKGROUND_BLUR'],
]);
const SHADOWS = new Set(['DROP_SHADOW', 'INNER_SHADOW']);
// Progressive blur geometry has no observed native encoding here; it stays unknown.
const PROGRESSIVE_FIELDS = ['blurOpType', 'startOffset', 'endOffset', 'startRadius'];

/**
 * Converts native effects to the Plugin API representation. Variable bindings, progressive blurs,
 * procedural effects and malformed records return null rather than approximated values.
 */
export function normalizeNativeEffects(value: unknown): Row[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) return null;
  const effects: Row[] = [];
  for (const raw of value) {
    const effect = object(raw);
    const type = String(effect.type);
    if (
      Object.keys(effect).some(key => key.endsWith('Var')) ||
      PROGRESSIVE_FIELDS.some(key => effect[key] !== undefined) ||
      typeof effect.visible !== 'boolean' ||
      !finite(effect.radius)
    )
      return null;
    const blur = BLURS.get(type);
    if (blur) {
      effects.push({
        type: blur,
        visible: effect.visible,
        radius: effect.radius,
        boundVariables: {},
        blurType: 'NORMAL',
      });
      continue;
    }
    if (!SHADOWS.has(type)) return null;
    const color = object(effect.color),
      offset = object(effect.offset);
    if (
      !['r', 'g', 'b', 'a'].every(channel => finite(color[channel])) ||
      !finite(offset.x) ||
      !finite(offset.y) ||
      !finite(effect.spread) ||
      typeof effect.blendMode !== 'string' ||
      (type === 'DROP_SHADOW' && typeof effect.showShadowBehindNode !== 'boolean')
    )
      return null;
    effects.push({
      type,
      visible: effect.visible,
      radius: effect.radius,
      boundVariables: {},
      color: { r: color.r, g: color.g, b: color.b, a: color.a },
      offset: { x: offset.x, y: offset.y },
      spread: effect.spread,
      blendMode: effect.blendMode,
      ...(type === 'DROP_SHADOW' ? { showShadowBehindNode: effect.showShadowBehindNode } : {}),
    });
  }
  return effects;
}
