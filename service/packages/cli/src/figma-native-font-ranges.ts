type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

/** Resolve only recorded character styles; missing tables or unsupported references remain unknown. */
export function readNativeFontRanges(node: Row, baseName: unknown) {
  const text = object(node.textData),
    base = object(baseName);
  if (
    typeof text.characters !== 'string' ||
    text.characters.length > 65536 ||
    typeof base.family !== 'string' ||
    typeof base.style !== 'string'
  )
    return null;
  const ids = text.characterStyleIDs === undefined ? [] : text.characterStyleIDs;
  if (
    !Array.isArray(ids) ||
    (ids.length !== 0 && ids.length !== text.characters.length) ||
    !ids.every(id => Number.isSafeInteger(id) && id >= 0)
  )
    return null;
  const table = new Map<number, Row>();
  if (text.styleOverrideTable !== undefined && !Array.isArray(text.styleOverrideTable)) return null;
  if (Array.isArray(text.styleOverrideTable) && text.styleOverrideTable.length > 65536) return null;
  for (const value of (text.styleOverrideTable ?? []) as unknown[]) {
    const row = object(value),
      id = row.styleID;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || table.has(id)) return null;
    table.set(id, row);
  }
  const metadata = object(node.derivedTextData).fontMetaData;
  if (Array.isArray(metadata) && metadata.length > 4096) return null;
  const weightsByFont = new Map<string, Set<number>>();
  for (const value of Array.isArray(metadata) ? metadata : []) {
    const row = object(value),
      font = object(row.key),
      weight = row.fontWeight;
    if (
      typeof font.family !== 'string' ||
      typeof font.style !== 'string' ||
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      weight > 1000
    )
      continue;
    const key = JSON.stringify([font.family, font.style]),
      weights = weightsByFont.get(key) ?? new Set<number>();
    weights.add(weight);
    weightsByFont.set(key, weights);
  }
  const resolved = new Map<
    number,
    { fontName: { family: string; style: string }; nativeFontWeight?: number }
  >();
  const ranges: Array<{
    start: number;
    end: number;
    fontName: { family: string; style: string };
    nativeFontWeight?: number;
  }> = [];
  for (let index = 0; index < text.characters.length; index++) {
    const id = ids[index] ?? 0,
      override = table.get(id);
    if (id !== 0 && !override) return null;
    let descriptor = resolved.get(id);
    if (!descriptor) {
      if (override?.styleIdForText !== undefined && override.fontName === undefined) return null;
      const font = override?.fontName === undefined ? base : object(override.fontName);
      if (typeof font.family !== 'string' || typeof font.style !== 'string') return null;
      const fontName = { family: font.family, style: font.style };
      const weights = weightsByFont.get(JSON.stringify([font.family, font.style]));
      const weight = weights?.size === 1 ? [...weights][0] : undefined;
      descriptor = { fontName, ...(weight === undefined ? {} : { nativeFontWeight: weight }) };
      resolved.set(id, descriptor);
    }
    const { fontName, nativeFontWeight } = descriptor;
    const previous = ranges.at(-1);
    if (
      previous?.fontName.family === fontName.family &&
      previous.fontName.style === fontName.style &&
      previous.nativeFontWeight === nativeFontWeight
    )
      previous.end = index + 1;
    else
      ranges.push({
        start: index,
        end: index + 1,
        fontName,
        ...(nativeFontWeight === undefined ? {} : { nativeFontWeight }),
      });
  }
  return ranges;
}
