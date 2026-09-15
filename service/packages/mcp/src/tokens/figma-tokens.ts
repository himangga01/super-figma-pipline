import {
  type GetStylesResult,
  type GetVariableDefsResult,
  type SerializedMotionEasing,
  type SerializedVariable,
  type SerializedVariableValue,
  toHex,
} from '@sfp/shared';

// Catalog values retain source/collection/mode IDs. Same-collection aliases can resolve in a
// catalog projection; cross-collection aliases require actual node selections and are resolved
// separately by DesignObservation.bindings. Never use a catalog default as a node's active mode.

/** A resolved concrete value: hex string for color, primitive otherwise; null if unresolved. */
type FigmaTokenValue = string | number | boolean | null;

export interface FigmaToken {
  sourceId?: string;
  collectionId?: string;
  defaultModeId?: string;
  modeValues?: Record<string, FigmaTokenValue>;
  resolution?: 'catalog' | 'unresolved';

  /** Figma variable name, group separators kept, e.g. "Primary/500". */
  name: string;
  /** Resolved value at the collection's default mode. */
  value: FigmaTokenValue;
  /** Figma resolvedType: COLOR | FLOAT | STRING | BOOLEAN | EASING | TIMING. */
  type: string;
  /**
   * Display name of the variable's collection, e.g. "font" / "color" / "size". Lets the join
   * disambiguate overloaded names — a "size/*" in a typography collection is a font size, while the
   * same name in a dimension collection is a width/height. Absent if the collection has no name.
   */
  collection?: string;
  /**
   * Per-theme values keyed by mode name (e.g. { Light: "#FFFFFF", Dark: "#0A0A0A" }), present only
   * when the variable's collection has more than one mode AND at least two modes resolve to
   * different values — i.e. the token is genuinely theme-dependent. `value` is only the default
   * mode; a consumer must not emit it as the token's sole literal when `modes` is set.
   */
  modes?: Record<string, FigmaTokenValue>;
  /**
   * Set to 'style' when this token was derived from a shared paint style rather than a variable —
   * the design-token mechanism of pre-variables Figma files. Absent for variables.
   */
  source?: 'style';
}

const isAlias = (val: SerializedVariableValue): val is { type: 'VARIABLE_ALIAS'; id: string } =>
  typeof val === 'object' && val !== null && (val as { type?: string }).type === 'VARIABLE_ALIAS';

const isRgba = (
  val: SerializedVariableValue,
): val is { r: number; g: number; b: number; a: number } =>
  typeof val === 'object' && val !== null && 'r' in val && 'g' in val && 'b' in val;

/**
 * An EASING variable's curve flattened to a scalar, since a token value is one. A custom bezier
 * becomes the CSS `cubic-bezier(...)` literal — lossless and what a code-side easing token actually
 * looks like — and a custom spring keeps its bounce rather than dropping it. Every other curve is a
 * named Figma preset, so the name is the whole value.
 *
 * Preset names stay as Figma spells them instead of being mapped onto CSS keywords: only a few have
 * a real CSS counterpart (BOUNCY, GENTLE, HOLD and the BACK curves have none), and inventing one
 * would assert an equivalence Figma never stated. The name join still matches on the variable
 * name.
 */
const formatEasing = (val: SerializedMotionEasing): string => {
  const bezier = val.easingFunctionCubicBezier;
  if (bezier !== undefined) {
    return `cubic-bezier(${bezier.x1}, ${bezier.y1}, ${bezier.x2}, ${bezier.y2})`;
  }
  if (val.easingFunctionSpring !== undefined) return `spring(${val.easingFunctionSpring.bounce})`;
  return val.type;
};

const uniqueIndex = <T extends { id: string }>(items: T[]) => {
  const index = new Map<string, T | undefined>();
  for (const item of items) index.set(item.id, index.has(item.id) ? undefined : item);
  return index;
};

/** Catalog defaults are presentation only, never observed node mode selections. */
export const resolveFigmaTokens = (defs: GetVariableDefsResult): FigmaToken[] => {
  const variableIndex = uniqueIndex(defs.variables),
    collectionIndex = uniqueIndex(defs.collections);
  const resolve = (
    variable: SerializedVariable,
    modeId: string,
    seen: Set<string>,
  ): FigmaTokenValue => {
    if (seen.has(variable.id) || seen.size >= 128) return null;
    seen.add(variable.id);
    if (!variableIndex.get(variable.id)) return null;
    const raw = variable.valuesByMode[modeId];
    if (raw === undefined) return null;
    if (isAlias(raw)) {
      const target = variableIndex.get(raw.id);
      // Cross-collection aliases need independently observed node selections, not mode names.
      return target?.collectionId === variable.collectionId &&
        target.resolvedType === variable.resolvedType
        ? resolve(target, modeId, seen)
        : null;
    }
    if (isRgba(raw))
      return variable.resolvedType === 'COLOR' &&
        [raw.r, raw.g, raw.b, raw.a].every(
          channel => Number.isFinite(channel) && channel >= 0 && channel <= 1,
        )
        ? toHex(raw, raw.a)
        : null;
    if (typeof raw === 'object' && raw !== null)
      return variable.resolvedType === 'EASING' ? formatEasing(raw) : null;
    if (typeof raw === 'string') return variable.resolvedType === 'STRING' ? raw : null;
    if (typeof raw === 'boolean') return variable.resolvedType === 'BOOLEAN' ? raw : null;
    return ['FLOAT', 'TIMING'].includes(variable.resolvedType) ? raw : null;
  };
  return defs.variables.map(variable => {
    const collection = collectionIndex.get(variable.collectionId);
    const modeValues = Object.fromEntries(
      (collection?.modes ?? []).map(mode => [
        mode.modeId,
        resolve(variable, mode.modeId, new Set()),
      ]),
    );
    const value = collection ? (modeValues[collection.defaultModeId] ?? null) : null;
    const modes: Record<string, FigmaTokenValue> = {};
    for (const mode of collection?.modes ?? []) {
      const key =
        collection!.modes.filter(other => other.name === mode.name).length > 1
          ? `${mode.name} (${mode.modeId})`
          : mode.name;
      modes[key] = modeValues[mode.modeId] ?? null;
    }
    return {
      sourceId: variable.id,
      collectionId: variable.collectionId,
      name: variable.name,
      type: variable.resolvedType,
      value,
      modeValues,
      resolution: value === null ? ('unresolved' as const) : ('catalog' as const),
      ...(collection
        ? { collection: collection.name, defaultModeId: collection.defaultModeId }
        : {}),
      ...(Object.values(modes).some(modeValue => modeValue !== Object.values(modes)[0])
        ? { modes }
        : {}),
    };
  });
};

/**
 * Pseudo-tokens from shared paint styles — the design-token mechanism of pre-variables Figma files
 * (a document can carry a full palette as paint styles and zero variables, leaving the variable
 * join empty-handed). Only a style that is exactly one visible SOLID paint converts: that is the
 * shape that IS a color token by another name. Multi-paint, gradient, and image styles are looks,
 * not tokens, and are skipped. Pure.
 */
export const resolvePaintStyleTokens = (paints: GetStylesResult['paints']): FigmaToken[] => {
  const out: FigmaToken[] = [];
  for (const style of paints) {
    const visible = style.paints.filter(p => p.visible !== false);
    const only = visible.length === 1 ? visible[0] : undefined;
    if (only === undefined || only.type !== 'SOLID' || !('color' in only)) continue;
    out.push({
      sourceId: style.id,
      resolution: 'catalog',
      name: style.name,
      value: toHex(only.color, only.opacity),
      type: 'COLOR',
      source: 'style',
    });
  }
  return out;
};
