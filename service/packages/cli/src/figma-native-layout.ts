type Row = Record<string, unknown>;
export const NATIVE_LAYOUT_FIELDS = [
  'isMask',
  'maskType',
  'layoutPositioning',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'constraints',
  'layoutMode',
  'layoutWrap',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'paddingLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'itemReverseZIndex',
  'counterAxisAlignContent',
] as const;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const enumValue = (value: unknown, allowed: readonly string[], fallback: string) =>
  value === undefined ? fallback : allowed.includes(String(value)) ? value : undefined;
const numeric = (value: unknown, fallback: number | null) =>
  value === undefined
    ? fallback
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
const boolean = (value: unknown, fallback: boolean) =>
  value === undefined ? fallback : typeof value === 'boolean' ? value : undefined;
const sizing = (value: unknown, fallback: string) =>
  value === undefined
    ? fallback
    : value === 'FIXED'
      ? 'FIXED'
      : value === 'RESIZE_TO_FIT' || value === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'
        ? 'AUTO'
        : undefined;

export const NATIVE_SIZING_FIELDS = ['layoutSizingHorizontal', 'layoutSizingVertical'] as const;
const CONTAINERS = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
const autoLayout = (node: Row | null) =>
  node !== null && node.layoutMode !== undefined && node.layoutMode !== 'NONE';

/**
 * Derives Plugin API layout sizing from already decoded layout fields. Hidden and absolutely
 * positioned children do not take part in their parent's auto layout. Unknown layouts stay
 * unknown.
 */
export function nativeLayoutSizing(
  node: Row,
  parent: Row | null,
  horizontal: boolean,
): 'FIXED' | 'HUG' | 'FILL' | undefined {
  if (
    (CONTAINERS.has(String(node.type)) && node.layoutMode === undefined) ||
    (parent !== null && CONTAINERS.has(String(parent.type)) && parent.layoutMode === undefined) ||
    (node.type === 'TEXT' && node.textAutoResize === undefined)
  )
    return undefined;
  const flows =
    autoLayout(parent) && node.layoutPositioning !== 'ABSOLUTE' && node.visible !== false;
  if (flows) {
    const primary = (parent!.layoutMode === 'HORIZONTAL') === horizontal;
    if (primary ? node.layoutGrow === 1 : node.layoutAlign === 'STRETCH') return 'FILL';
    if (
      node.type === 'TEXT' &&
      (node.textAutoResize === 'WIDTH_AND_HEIGHT' ||
        (!horizontal && node.textAutoResize === 'HEIGHT'))
    )
      return 'HUG';
  }
  if (autoLayout(node)) {
    const primary = (node.layoutMode === 'HORIZONTAL') === horizontal;
    if ((primary ? node.primaryAxisSizingMode : node.counterAxisSizingMode) === 'AUTO')
      return 'HUG';
  }
  return 'FIXED';
}

export const NATIVE_CONTAINER_FIELDS = [
  'cornerSmoothing',
  'strokesIncludedInLayout',
  'numberOfFixedChildren',
  'overflowDirection',
  'layoutGrids',
  'targetAspectRatio',
] as const;
const CORNER_TYPES = new Set([
  ...CONTAINERS,
  'RECTANGLE',
  'VECTOR',
  'ELLIPSE',
  'STAR',
  'POLYGON',
  'BOOLEAN_OPERATION',
]);
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Converts one recorded native layout grid; unobserved or variable-bound forms return null. */
const layoutGrid = (value: unknown): Row | null => {
  const grid = object(value),
    color = object(grid.color);
  if (
    Object.keys(grid).some(key => key.endsWith('Var')) ||
    typeof grid.visible !== 'boolean' ||
    !['r', 'g', 'b', 'a'].every(channel => finiteNumber(color[channel]))
  )
    return null;
  const rgba = { r: color.r, g: color.g, b: color.b, a: color.a };
  if (grid.pattern === 'GRID')
    return finiteNumber(grid.sectionSize)
      ? {
          pattern: 'GRID',
          visible: grid.visible,
          color: rgba,
          sectionSize: grid.sectionSize,
          boundVariables: {},
        }
      : null;
  const alignment = String(grid.type);
  if (
    grid.pattern !== 'STRIPES' ||
    !['X', 'Y'].includes(String(grid.axis)) ||
    !['STRETCH', 'MIN', 'MAX', 'CENTER'].includes(alignment) ||
    !Number.isSafeInteger(grid.numSections) ||
    (grid.numSections as number) < 1 ||
    !finiteNumber(grid.gutterSize) ||
    (alignment !== 'CENTER' && !finiteNumber(grid.offset)) ||
    (alignment !== 'STRETCH' && !finiteNumber(grid.sectionSize))
  )
    return null;
  // The Plugin API omits section size for stretched grids and offset for centered grids.
  return {
    pattern: grid.axis === 'X' ? 'COLUMNS' : 'ROWS',
    visible: grid.visible,
    color: rgba,
    gutterSize: grid.gutterSize,
    alignment,
    count: grid.numSections,
    ...(alignment === 'CENTER' ? {} : { offset: grid.offset }),
    ...(alignment === 'STRETCH' ? {} : { sectionSize: grid.sectionSize }),
    boundVariables: {},
  };
};

/**
 * Reports container, corner and aspect fields from recorded values and Figma's omitted defaults,
 * only for the Plugin API node types that expose them. Unobserved native forms stay unknown.
 */
export function nativeContainerProperties(
  node: Row,
  type: string,
): { values: Row; unknown: string[] } {
  const values: Row = {};
  const unknown: string[] = [];
  const accept = (field: string, value: unknown, valid: boolean) => {
    if (valid) values[field] = value;
    else unknown.push(field);
  };
  if (CORNER_TYPES.has(type)) {
    const smoothing = node.cornerSmoothing ?? 0;
    accept(
      'cornerSmoothing',
      smoothing,
      finiteNumber(smoothing) && smoothing >= 0 && smoothing <= 1,
    );
  }
  if (CONTAINERS.has(type)) {
    const included = node.bordersTakeSpace ?? false;
    accept('strokesIncludedInLayout', included, typeof included === 'boolean');
    // The native fixed-children divider encoding has not been observed against a reference.
    accept('numberOfFixedChildren', 0, node.fixedChildrenDivider === undefined);
    const overflow = node.scrollDirection ?? 'NONE';
    accept(
      'overflowDirection',
      overflow,
      ['NONE', 'HORIZONTAL', 'VERTICAL', 'BOTH'].includes(String(overflow)),
    );
    const recorded = node.layoutGrids ?? [];
    const grids =
      Array.isArray(recorded) && recorded.length <= 64 ? recorded.map(layoutGrid) : [null];
    accept('layoutGrids', grids, !grids.includes(null));
  }
  // A recorded aspect lock has not been observed against a reference; only its absence is known.
  if (type !== 'LINE') accept('targetAspectRatio', null, node.targetAspectRatio === undefined);
  return { values, unknown };
}

/** Interpret recorded native layout values; unsupported enum forms remain absent. */
export function normalizeNativeLayout(node: Row, container: boolean) {
  const values: Row = {};
  const unknown: string[] = [];
  const set = (key: string, value: unknown) => {
    if (value === undefined) unknown.push(key);
    else values[key] = value;
  };
  set('isMask', boolean(node.mask, false));
  set(
    'maskType',
    node.maskType === 'OUTLINE' || (node.maskType === undefined && node.maskIsOutline === true)
      ? 'VECTOR'
      : enumValue(node.maskType, ['ALPHA', 'LUMINANCE'], 'ALPHA'),
  );
  set('layoutPositioning', enumValue(node.stackPositioning, ['AUTO', 'ABSOLUTE'], 'AUTO'));
  for (const bound of ['min', 'max']) {
    const raw = node[`${bound}Size`];
    if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
      unknown.push(`${bound}Width`, `${bound}Height`);
      continue;
    }
    const size = object(raw);
    set(`${bound}Width`, numeric(size.x, null));
    set(`${bound}Height`, numeric(size.y, null));
  }
  const constraints = ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'];
  const horizontal = enumValue(node.horizontalConstraint, constraints, 'MIN');
  const vertical = enumValue(node.verticalConstraint, constraints, 'MIN');
  set(
    'constraints',
    horizontal === undefined || vertical === undefined ? undefined : { horizontal, vertical },
  );
  if (!container) return { values, unknown };
  const legacy = [
    'stackPadding',
    'stackCounterAlign',
    'stackJustify',
    'stackAlign',
    'stackWidth',
    'stackHeight',
  ];
  if (legacy.some(key => Object.hasOwn(node, key))) {
    unknown.push('legacy-stack-layout');
    return { values, unknown };
  }
  set('layoutMode', enumValue(node.stackMode, ['NONE', 'HORIZONTAL', 'VERTICAL'], 'NONE'));
  set('layoutWrap', enumValue(node.stackWrap, ['NO_WRAP', 'WRAP'], 'NO_WRAP'));
  set(
    'primaryAxisAlignItems',
    node.stackPrimaryAlignItems === 'SPACE_EVENLY'
      ? 'SPACE_BETWEEN'
      : enumValue(node.stackPrimaryAlignItems, ['MIN', 'MAX', 'CENTER'], 'MIN'),
  );
  set(
    'counterAxisAlignItems',
    enumValue(node.stackCounterAlignItems, ['MIN', 'MAX', 'CENTER', 'BASELINE'], 'MIN'),
  );
  set('primaryAxisSizingMode', sizing(node.stackPrimarySizing, 'AUTO'));
  set('counterAxisSizingMode', sizing(node.stackCounterSizing, 'FIXED'));
  for (const [key, source] of [
    ['paddingLeft', 'stackHorizontalPadding'],
    ['paddingTop', 'stackVerticalPadding'],
    ['paddingRight', 'stackPaddingRight'],
    ['paddingBottom', 'stackPaddingBottom'],
    ['itemSpacing', 'stackSpacing'],
    ['counterAxisSpacing', 'stackCounterSpacing'],
  ] as const)
    set(key, numeric(node[source], 0));
  set('itemReverseZIndex', boolean(node.stackReverseZIndex, false));
  set(
    'counterAxisAlignContent',
    enumValue(node.stackCounterAlignContent, ['AUTO', 'SPACE_BETWEEN'], 'AUTO'),
  );
  return { values, unknown };
}
