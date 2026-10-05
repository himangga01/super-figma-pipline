type Row = Record<string, unknown>;

const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

const ENUMS = {
  textCase: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'],
  textDecoration: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'],
  textTruncation: ['DISABLED', 'ENDING'],
  textWrapStyle: ['AUTO', 'BALANCE', 'PRETTY'],
} as const;
const FIELDS = [
  'textCase',
  'textDecoration',
  'textTruncation',
  'maxLines',
  'textWrapStyle',
  'hyperlink',
  'fontWeight',
] as const;

/** Per-character style rows, or null when the recorded character tables are malformed. */
const characterRows = (node: Row): Row[] | null => {
  const text = object(node.textData);
  if (typeof text.characters !== 'string' || text.characters.length > 65536) return null;
  const ids = text.characterStyleIDs === undefined ? [] : text.characterStyleIDs;
  if (
    !Array.isArray(ids) ||
    (ids.length !== 0 && ids.length !== text.characters.length) ||
    (text.styleOverrideTable !== undefined && !Array.isArray(text.styleOverrideTable))
  )
    return null;
  const table = new Map<number, Row>();
  for (const value of (text.styleOverrideTable ?? []) as unknown[]) {
    const row = object(value);
    if (!Number.isSafeInteger(row.styleID) || table.has(row.styleID as number)) return null;
    table.set(row.styleID as number, row);
  }
  const rows: Row[] = [];
  for (let index = 0; index < text.characters.length; index++) {
    const id = ids[index] ?? 0;
    if (!Number.isSafeInteger(id) || (id !== 0 && !table.has(id))) return null;
    rows.push(id === 0 ? {} : table.get(id)!);
  }
  return rows;
};

/**
 * Reads node-level Plugin API text properties from recorded native values and Figma's omitted
 * defaults. Character runs make a property `mixed`; unobserved or malformed forms stay unknown.
 */
export function readNativeTextProperties(
  node: Row,
  fontRanges: ReadonlyArray<{ nativeFontWeight?: number }> | null,
): { values: Row; unknown: string[] } {
  const values: Row = {};
  const unknownFields = new Set<string>();
  const rows = characterRows(node);
  const uniform = (field: 'textCase' | 'textDecoration', fallback: string) => {
    const base = node[field] ?? fallback;
    if (rows === null || !(ENUMS[field] as readonly unknown[]).includes(base)) {
      unknownFields.add(field);
      return;
    }
    const seen = new Set(rows.map(row => row[field] ?? base));
    if ([...seen].some(value => !(ENUMS[field] as readonly unknown[]).includes(value)))
      unknownFields.add(field);
    else values[field] = seen.size > 1 ? 'mixed' : (seen.values().next().value ?? base);
  };
  uniform('textCase', 'ORIGINAL');
  uniform('textDecoration', 'NONE');
  const truncation = node.textTruncation ?? 'DISABLED';
  if ((ENUMS.textTruncation as readonly unknown[]).includes(truncation))
    values.textTruncation = truncation;
  else unknownFields.add('textTruncation');
  const maxLines = node.maxLines ?? null;
  if (maxLines === null || (Number.isSafeInteger(maxLines) && (maxLines as number) > 0))
    values.maxLines = maxLines;
  else unknownFields.add('maxLines');
  const wrap = node.textWrapStyle ?? 'AUTO';
  if ((ENUMS.textWrapStyle as readonly unknown[]).includes(wrap)) values.textWrapStyle = wrap;
  else unknownFields.add('textWrapStyle');
  // No native hyperlink encoding has been observed against a reference yet.
  if (
    rows === null ||
    node.hyperlink !== undefined ||
    rows.some(row => row.hyperlink !== undefined)
  )
    unknownFields.add('hyperlink');
  else values.hyperlink = null;
  const weights = new Set(fontRanges?.map(range => range.nativeFontWeight));
  if (rows === null || !fontRanges?.length || weights.has(undefined))
    unknownFields.add('fontWeight');
  else values.fontWeight = weights.size > 1 ? 'mixed' : weights.values().next().value;
  return { values, unknown: FIELDS.filter(field => unknownFields.has(field)) };
}

export const NATIVE_TEXT_PROPERTY_FIELDS = FIELDS;
