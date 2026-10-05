type Row = Record<string, unknown>;

const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

const NATIVE_STYLE_ID_FIELDS = [
  'fillStyleId',
  'strokeStyleId',
  'effectStyleId',
  'gridStyleId',
  'textStyleId',
] as const;
const GRID_CONTAINER_FIELDS = [
  'gridRowCount',
  'gridColumnCount',
  'gridRowGap',
  'gridColumnGap',
  'gridRowSizes',
  'gridColumnSizes',
] as const;
const GRID_CHILD_FIELDS = [
  'gridRowAnchorIndex',
  'gridColumnAnchorIndex',
  'gridRowSpan',
  'gridColumnSpan',
  'gridChildHorizontalAlign',
  'gridChildVerticalAlign',
] as const;
export const NATIVE_METADATA_FIELDS = [
  ...NATIVE_STYLE_ID_FIELDS,
  ...GRID_CONTAINER_FIELDS,
  ...GRID_CHILD_FIELDS,
  'boundVariables',
  'explicitVariableModes',
  'resolvedVariableModes',
  'annotations',
  'exportSettings',
  'arcData',
] as const;

const CONTAINERS = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
const GRID_CONTAINER_DEFAULTS: Row = {
  gridRowCount: 0,
  gridColumnCount: 0,
  gridRowGap: 0,
  gridColumnGap: 0,
  gridRowSizes: [],
  gridColumnSizes: [],
};
const GRID_CHILD_DEFAULTS: Row = {
  gridRowAnchorIndex: -1,
  gridColumnAnchorIndex: -1,
  gridRowSpan: 1,
  gridColumnSpan: 1,
  gridChildHorizontalAlign: 'AUTO',
  gridChildVerticalAlign: 'AUTO',
};
// Native grid auto-layout encodings have not been observed against a reference capture.
const NATIVE_GRID_CONTAINER_KEYS = [
  'gridRows',
  'gridColumns',
  'gridRowGap',
  'gridColumnGap',
  'gridColumnsSizing',
  'gridRowsSizing',
  'gridAutoTracks',
  'gridReflowEnabled',
];
const NATIVE_GRID_CHILD_KEYS = [
  'gridRowAnchor',
  'gridColumnAnchor',
  'gridRowSpan',
  'gridColumnSpan',
  'gridChildVerticalAlign',
  'gridChildHorizontalAlign',
];
const STYLE_SOURCES = {
  fillStyleId: ['styleIdForFill', 'inheritFillStyleID'],
  strokeStyleId: ['styleIdForStrokeFill', 'inheritFillStyleIDForStroke', 'inheritStrokeStyleID'],
  effectStyleId: ['styleIdForEffect', 'inheritEffectStyleID'],
  gridStyleId: ['styleIdForGrid', 'inheritGridStyleID'],
  textStyleId: ['styleIdForText', 'inheritTextStyleID'],
} as const;
// Instance descendants' overrides and derived geometry belong to other nodes or are not bindings.
const FOREIGN_KEYS = new Set([
  'guid',
  'parentIndex',
  'symbolData',
  'derivedSymbolData',
  'derivedTextData',
  'vectorData',
  'fillGeometry',
  'strokeGeometry',
]);
const VARIABLE_KEY = /Var$|^variable|ConsumptionMap$|^inheritedVariableIds$/u;
const FULL_CIRCLE = Math.fround(2 * Math.PI);

/** True when a native row or its nested values carry variable bindings or consumption data. */
const hasVariableData = (value: unknown, ownOnly: boolean, depth = 0): boolean => {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => hasVariableData(item, ownOnly, depth + 1));
  return Object.entries(value).some(
    ([key, item]) =>
      !(ownOnly && depth === 0 && FOREIGN_KEYS.has(key)) &&
      (VARIABLE_KEY.test(key) || hasVariableData(item, ownOnly, depth + 1)),
  );
};

/** Any variable collection or consumption in the document can change resolved modes. */
export const nativeDocumentHasVariables = (rows: Row[]): boolean =>
  rows.some(
    row => row.type === 'VARIABLE_SET' || row.type === 'VARIABLE' || hasVariableData(row, false),
  );

/** An imported style reference names its library key and version; local styles carry no key. */
const styleId = (reference: unknown): string | null => {
  if (reference === undefined) return '';
  const row = object(reference),
    asset = object(row.assetRef);
  if (
    Object.keys(row).length === 1 &&
    typeof asset.key === 'string' &&
    /^[0-9a-f]{40}$/u.test(asset.key) &&
    typeof asset.version === 'string' &&
    /^\d+:\d+$/u.test(asset.version)
  )
    return `S:${asset.key},${asset.version}`;
  return null;
};

const exportSetting = (input: unknown, type: string): Row | null => {
  const setting = object(input);
  const format = { PNG: 'PNG', JPEG: 'JPG', PDF: 'PDF' }[String(setting.imageType)];
  if (
    !format ||
    typeof setting.suffix !== 'string' ||
    typeof setting.contentsOnly !== 'boolean' ||
    typeof setting.colorProfile !== 'string' ||
    typeof setting.useAbsoluteBounds !== 'boolean'
  )
    return null;
  const output: Row = {
    format,
    suffix: setting.suffix,
    contentsOnly: setting.contentsOnly,
    colorProfile: setting.colorProfile,
  };
  // Observed: the Plugin API reports useAbsoluteBounds for text nodes only; other forms stay unknown.
  if (type === 'TEXT') output.useAbsoluteBounds = setting.useAbsoluteBounds;
  else if (setting.useAbsoluteBounds) return null;
  if (format !== 'PDF') {
    const constraint = object(setting.constraint);
    if (constraint.type !== 'CONTENT_SCALE' || typeof constraint.value !== 'number') return null;
    output.constraint = { type: 'SCALE', value: constraint.value };
  }
  return output;
};

/**
 * Style identifiers, grid auto-layout, variable, annotation, export and arc fields. Native records
 * omit defaults; any unobserved native form leaves its field unknown rather than guessed.
 */
export function nativeMetadataProperties(
  node: Row,
  type: string,
  context: {
    parentIsGrid: boolean;
    variables: boolean;
    /** The node's own export settings when they differ from the merged row; null is unknown. */
    exportSettings?: unknown;
  },
): { values: Row; unknown: string[] } {
  const values: Row = {};
  const unknown: string[] = [];
  const accept = (field: string, value: unknown) => {
    if (value === null) unknown.push(field);
    else values[field] = value;
  };
  const textRuns = type === 'TEXT' ? object(node.textData).styleOverrideTable : undefined;
  const runOverrides = (field: string) =>
    Array.isArray(textRuns) && textRuns.some(run => Object.hasOwn(object(run), field));
  const fields: Array<keyof typeof STYLE_SOURCES> = [
    ...(type === 'GROUP' ? [] : (['fillStyleId', 'strokeStyleId'] as const)),
    'effectStyleId',
    ...(CONTAINERS.has(type) ? (['gridStyleId'] as const) : []),
    ...(type === 'TEXT' ? (['textStyleId'] as const) : []),
  ];
  for (const field of fields) {
    const [source, ...inherited] = STYLE_SOURCES[field];
    const blocked =
      inherited.some(key => node[key] !== undefined) ||
      runOverrides(source) ||
      (field === 'textStyleId' && node.isOverrideOverTextStyle === true);
    accept(field, blocked ? null : styleId(node[source]));
  }

  if (CONTAINERS.has(type)) {
    const grid =
      node.stackMode === 'GRID' || NATIVE_GRID_CONTAINER_KEYS.some(key => node[key] !== undefined);
    for (const field of GRID_CONTAINER_FIELDS)
      accept(field, grid ? null : structuredClone(GRID_CONTAINER_DEFAULTS[field]));
  }
  const placed =
    context.parentIsGrid || NATIVE_GRID_CHILD_KEYS.some(key => node[key] !== undefined);
  for (const field of GRID_CHILD_FIELDS) accept(field, placed ? null : GRID_CHILD_DEFAULTS[field]);

  accept('boundVariables', hasVariableData(node, true) ? null : {});
  accept('explicitVariableModes', node.variableModeBySetMap === undefined ? {} : null);
  accept('resolvedVariableModes', context.variables ? null : {});
  if (type !== 'GROUP') {
    const annotations = node.annotations;
    accept(
      'annotations',
      annotations === undefined || (Array.isArray(annotations) && annotations.length === 0)
        ? []
        : null,
    );
  }
  const exportSource = 'exportSettings' in context ? context.exportSettings : node.exportSettings;
  if (exportSource === undefined) accept('exportSettings', []);
  else {
    const settings = Array.isArray(exportSource)
      ? exportSource.map(setting => exportSetting(setting, type))
      : [null];
    accept('exportSettings', settings.includes(null) ? null : settings);
  }
  if (type === 'ELLIPSE') {
    const arc = object(node.arcData);
    const numbers = ['startingAngle', 'endingAngle', 'innerRadius'].map(field => arc[field]);
    accept(
      'arcData',
      node.arcData === undefined
        ? { startingAngle: 0, endingAngle: FULL_CIRCLE, innerRadius: 0 }
        : numbers.every(value => typeof value === 'number' && Number.isFinite(value))
          ? { startingAngle: numbers[0], endingAngle: numbers[1], innerRadius: numbers[2] }
          : null,
    );
  }
  return { values, unknown };
}
