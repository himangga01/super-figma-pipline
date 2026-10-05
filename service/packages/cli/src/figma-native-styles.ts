import { nativeNodeId } from './figma-native-document.js';
import { normalizeNativePaints } from './figma-native-paints.js';

type Row = Record<string, unknown>;
type StyleKind = 'paints' | 'texts' | 'effects' | 'grids';
type NativeStyle = { nativeId: string; name: string; key?: string; values: Row };
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const kinds: Record<string, StyleKind> = {
  FILL: 'paints',
  TEXT: 'texts',
  EFFECT: 'effects',
  GRID: 'grids',
};
const length = (value: unknown) => {
  const row = object(value);
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return undefined;
  if (row.units === 'RAW') return { unit: 'PERCENT', value: row.value * 100 };
  if (row.units === 'PIXELS' || row.units === 'PERCENT')
    return { unit: row.units, value: row.value };
  return undefined;
};
const copyFields = (input: Row, fields: string[]) =>
  Object.fromEntries(
    fields.filter(field => Object.hasOwn(input, field)).map(field => [field, input[field]]),
  );

/** Preserve native identities and observed values; do not invent Plugin API style keys or defaults. */
export function normalizeFigmaNativeStyles(message: Row) {
  if (!Array.isArray(message.nodeChanges)) throw new Error('FIGMA_NATIVE_NODES_MISSING');
  const catalogs: Record<StyleKind, NativeStyle[]> = {
    paints: [],
    texts: [],
    effects: [],
    grids: [],
  };
  const unsupported: Array<{ nativeId: string | null; styleType: unknown }> = [];
  const seen = new Set<string>();
  let deleted = 0;
  for (const input of message.nodeChanges) {
    const row = object(input);
    if (!row.styleType || row.styleType === 'NONE') continue;
    if (row.isSoftDeleted === true) {
      deleted++;
      continue;
    }
    const nativeId = nativeNodeId(row.guid);
    if (!nativeId || seen.has(nativeId) || typeof row.name !== 'string')
      throw new Error('FIGMA_NATIVE_STYLE_INVALID');
    seen.add(nativeId);
    const kind = typeof row.styleType === 'string' ? kinds[row.styleType] : undefined;
    if (!kind) {
      unsupported.push({ nativeId, styleType: row.styleType });
      continue;
    }
    const values = copyFields(row, ['description']);
    if (kind === 'paints' && Array.isArray(row.fillPaints))
      values.paints = normalizeNativePaints(row.fillPaints);
    if (kind === 'texts') {
      Object.assign(
        values,
        copyFields(row, [
          'fontSize',
          'paragraphSpacing',
          'paragraphIndent',
          'textCase',
          'textDecoration',
          'textWrapStyle',
        ]),
      );
      const font = object(row.fontName);
      if (typeof font.family === 'string' && typeof font.style === 'string')
        values.fontName = { family: font.family, style: font.style };
      for (const field of ['lineHeight', 'letterSpacing']) {
        const measured = length(row[field]);
        if (measured !== undefined)
          values[field] =
            field === 'lineHeight' &&
            measured.unit === 'PERCENT' &&
            object(row[field]).units === 'PERCENT' &&
            measured.value === 100
              ? { unit: 'AUTO' }
              : measured;
      }
    }
    if (kind === 'effects' && Array.isArray(row.effects))
      values.effects = row.effects.map(effect =>
        copyFields(object(effect), [
          'type',
          'visible',
          'radius',
          'color',
          'offset',
          'spread',
          'blendMode',
          'showShadowBehindNode',
        ]),
      );
    if (kind === 'grids' && Array.isArray(row.layoutGrids))
      values.grids = structuredClone(row.layoutGrids);
    catalogs[kind].push({
      nativeId,
      name: row.name,
      ...(typeof row.key === 'string' ? { key: row.key } : {}),
      values,
    });
  }
  return {
    source: 'figma-web-native-document' as const,
    catalogs,
    deleted,
    unsupported,
    complete: false as const,
    limitations: [
      'Native GUIDs are retained separately from Plugin API IDs and library keys.',
      'Absent fields, variable bindings and unsupported style semantics are not inferred.',
    ],
  };
}

const equal = (actual: unknown, expected: unknown): boolean => {
  if (typeof actual === 'number' && typeof expected === 'number')
    return (
      Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.0001
    );
  if (Array.isArray(actual) && Array.isArray(expected))
    return (
      actual.length === expected.length &&
      actual.every((value, index) => equal(value, expected[index]))
    );
  if (
    actual !== null &&
    expected !== null &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    const left = object(actual),
      right = object(expected);
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  }
  return actual === expected;
};

/** Name/type pairing is diagnostic only; ambiguous names never become verified identity matches. */
export function compareFigmaStyleCatalogs(
  native: ReturnType<typeof normalizeFigmaNativeStyles>,
  reference: Row,
) {
  const pairs: Array<{ kind: StyleKind; name: string; nativeId: string; referenceId: unknown }> =
    [];
  const keyMatches: Array<{
    kind: StyleKind;
    nativeId: string;
    referenceId: unknown;
    key: string;
  }> = [];
  const ambiguous: Array<{
    kind: StyleKind;
    name: string;
    nativeCount: number;
    referenceCount: number;
    key?: string;
  }> = [];
  const missing: Array<{ kind: StyleKind; name: string }> = [];
  const extra: Array<{ kind: StyleKind; name: string }> = [];
  const differences: Array<{
    kind: StyleKind;
    name: string;
    field: string;
    actual?: unknown;
    expected?: unknown;
  }> = [];
  const unobserved: Array<{ kind: StyleKind; name: string; fields: string[] }> = [];
  let comparedPositions = 0;
  for (const kind of Object.values(kinds)) {
    if (!Array.isArray(reference[kind])) throw new Error('FIGMA_STYLE_REFERENCE_INVALID');
    const expected = reference[kind].map(object);
    if (expected.some(row => typeof row.name !== 'string'))
      throw new Error('FIGMA_STYLE_REFERENCE_INVALID');
    const actual = native.catalogs[kind];
    const pairedActual = new Set<NativeStyle>(),
      pairedExpected = new Set<Row>();
    const comparePair = (observed: NativeStyle, wanted: Row) => {
      const name = observed.name;
      pairedActual.add(observed);
      pairedExpected.add(wanted);
      pairs.push({ kind, name, nativeId: observed.nativeId, referenceId: wanted.id });
      if (observed.name !== wanted.name)
        differences.push({
          kind,
          name,
          field: 'name',
          actual: observed.name,
          expected: wanted.name,
        });
      if (observed.key && typeof wanted.key === 'string' && observed.key !== wanted.key)
        differences.push({ kind, name, field: 'key', actual: observed.key, expected: wanted.key });
      const fields = Object.keys(wanted).filter(
        field => !['id', 'key', 'name', 'fontNameObservation'].includes(field),
      );
      const absent = fields.filter(field => !Object.hasOwn(observed.values, field));
      if (absent.length) unobserved.push({ kind, name, fields: absent });
      for (const field of fields.filter(key => Object.hasOwn(observed.values, key))) {
        comparedPositions++;
        if (!equal(observed.values[field], wanted[field]))
          differences.push({
            kind,
            name,
            field,
            actual: observed.values[field],
            expected: wanted[field],
          });
      }
    };
    for (const key of new Set(actual.flatMap(row => (row.key ? [row.key] : [])))) {
      const left = actual.filter(row => row.key === key),
        right = expected.filter(row => row.key === key);
      if (!right.length) continue;
      if (left.length !== 1 || right.length !== 1) {
        ambiguous.push({
          kind,
          name: left[0]!.name,
          key,
          nativeCount: left.length,
          referenceCount: right.length,
        });
        left.forEach(row => pairedActual.add(row));
        right.forEach(row => pairedExpected.add(row));
        continue;
      }
      comparePair(left[0]!, right[0]!);
      keyMatches.push({ kind, nativeId: left[0]!.nativeId, referenceId: right[0]!.id, key });
    }
    for (const name of new Set([
      ...actual.filter(row => !pairedActual.has(row)).map(row => row.name),
      ...expected.filter(row => !pairedExpected.has(row)).map(row => String(row.name)),
    ])) {
      const left = actual.filter(row => !pairedActual.has(row) && row.name === name),
        right = expected.filter(row => !pairedExpected.has(row) && row.name === name);
      if (left.length > 1 || right.length > 1) {
        ambiguous.push({ kind, name, nativeCount: left.length, referenceCount: right.length });
        continue;
      }
      if (left.length === 0) {
        missing.push({ kind, name });
        continue;
      }
      if (right.length === 0) {
        extra.push({ kind, name });
        continue;
      }
      comparePair(left[0]!, right[0]!);
    }
  }
  return {
    fullCaptureAccepted: false,
    pairing: 'native-key-then-unique-kind-and-name',
    pairs,
    keyMatches,
    ambiguous,
    missing,
    extra,
    comparedPositions,
    differences,
    unobserved,
  };
}
