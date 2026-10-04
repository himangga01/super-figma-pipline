import { nativeNodeId, selectFigmaNativeNodes } from './figma-native-document.js';
import { readNativeGeometry, equalNativeGeometry } from './figma-native-geometry.js';
import { normalizeNativePaints } from './figma-native-paints.js';
import { readNativeTextLayout } from './figma-native-text-layout.js';

type Row = Record<string, unknown>;
type Matrix = [[number, number, number], [number, number, number]];
interface InstanceContext {
  path: string[];
  overrides: Map<string, Row>;
  derived: Map<string, Row>;
  scale: number;
}

const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(object) : []);
const pathOf = (value: unknown): string[] =>
  rows(object(value).guidPath && object(object(value).guidPath).guids)
    .map(nativeNodeId)
    .filter((id): id is string => id !== null);
const properties = [
  'visible',
  'locked',
  'opacity',
  'blendMode',
  'strokeWeight',
  'strokeAlign',
  'strokeJoin',
  'strokeCap',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'fontSize',
  'paragraphSpacing',
  'paragraphIndent',
  'textAlignHorizontal',
  'textAlignVertical',
  'textAutoResize',
  'rotation',
  'layoutGrow',
  'layoutAlign',
] as const;
const matrix = (value: unknown): Matrix => {
  const m = object(value);
  return [
    [Number(m.m00 ?? 1), Number(m.m01 ?? 0), Number(m.m02 ?? 0)],
    [Number(m.m10 ?? 0), Number(m.m11 ?? 1), Number(m.m12 ?? 0)],
  ];
};
const multiply = (a: Matrix, b: Matrix): Matrix => [
  [
    a[0][0] * b[0][0] + a[0][1] * b[1][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1],
    a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
  ],
  [
    a[1][0] * b[0][0] + a[1][1] * b[1][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1],
    a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
  ],
];

const overlays = (input: Row, path: string[], contexts: InstanceContext[]) => {
  const result: Row = Object.assign(Object.create(null), input);
  // Outer instance overrides take precedence over defaults of nested component instances.
  for (const context of contexts.toReversed()) {
    const key = path.slice(context.path.length).join(';');
    Object.assign(result, context.overrides.get(key), context.derived.get(key));
  }
  return result;
};

/** Expand native component references without borrowing data from the Plugin API capture. */
export function normalizeFigmaNativeNodes(message: Row, nodeId: string | null) {
  const all = rows(message.nodeChanges),
    byId = new Map<string, Row>(),
    children = new Map<string, Row[]>();
  for (const node of all) {
    const id = nativeNodeId(node.guid);
    if (!id) continue;
    byId.set(id, node);
    const parent = nativeNodeId(object(node.parentIndex).guid);
    if (parent) {
      const list = children.get(parent) ?? [];
      list.push(node);
      children.set(parent, list);
    }
  }
  for (const list of children.values())
    list.sort((a, b) => {
      const x = String(object(a.parentIndex).position ?? ''),
        y = String(object(b.parentIndex).position ?? '');
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const root = selectFigmaNativeNodes(message, nodeId)[0]!;
  let count = 0;
  const warnings: Array<{ code: string; nodeId: string; detail?: string }> = [];
  const visit = (
    input: Row,
    prefix: string[],
    contexts: InstanceContext[],
    parent: Matrix,
    depth: number,
    groupOffset: Matrix | null = null,
  ): Row => {
    if (++count > 100_000 || depth > 128) throw new Error('FIGMA_NATIVE_EXPANSION_LIMIT');
    const guid = nativeNodeId(input.guid)!;
    const path = [...prefix, guid],
      id = prefix.length ? `I${path.join(';')}` : guid;
    let node = overlays(input, path, contexts);
    let childRecords = children.get(guid) ?? [],
      childPrefix = prefix,
      childContexts = contexts;
    if (node.type === 'INSTANCE') {
      const placementAlign = node.stackChildAlignSelf;
      const symbol = object(node.symbolData);
      const componentId = nativeNodeId(node.overriddenSymbolID) ?? nativeNodeId(symbol.symbolID);
      const component = componentId ? byId.get(componentId) : undefined;
      if (!component) warnings.push({ code: 'NATIVE_COMPONENT_UNAVAILABLE', nodeId: id });
      else {
        const overrides = new Map(
          rows(symbol.symbolOverrides).map(row => [pathOf(row).join(';'), row]),
        );
        const derived = new Map(
          rows(node.derivedSymbolData).map(row => [pathOf(row).join(';'), row]),
        );
        node = overlays(
          {
            ...component,
            ...node,
            ...overrides.get(componentId!),
            ...derived.get(componentId!),
            type: 'INSTANCE',
            guid: input.guid,
          },
          path,
          contexts,
        );
        node.stackChildAlignSelf = placementAlign;
        childRecords = children.get(componentId!) ?? [];
        childPrefix = path;
        const scale = typeof symbol.uniformScaleFactor === 'number' ? symbol.uniformScaleFactor : 1;
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('FIGMA_NATIVE_SCALE_INVALID');
        childContexts = [...contexts, { path, overrides, derived, scale }];
      }
    }
    const textStyleId = nativeNodeId(object(node.styleIdForText).guid);
    const textStyle = textStyleId ? byId.get(textStyleId) : undefined;
    if (node.type === 'TEXT' && textStyle && node.isOverrideOverTextStyle !== true) {
      node = { ...node };
      for (const field of [
        'fontName',
        'fontSize',
        'lineHeight',
        'letterSpacing',
        'textCase',
        'textDecoration',
      ])
        if (textStyle[field] !== undefined) node[field] = textStyle[field];
      node.paragraphSpacing = textStyle.paragraphSpacing ?? 0;
      node.paragraphIndent = textStyle.paragraphIndent ?? 0;
    }
    const scale = contexts.reduce((value, context) => value * context.scale, 1);
    if (scale !== 1) {
      node = { ...node };
      for (const field of ['fontSize', 'paragraphSpacing', 'paragraphIndent'])
        if (typeof node[field] === 'number') node[field] = node[field] * scale;
    }
    const relative = matrix(node.transform),
      absolute = multiply(parent, relative),
      reportedRelative = groupOffset ? multiply(groupOffset, relative) : relative,
      size = object(node.size);
    const result: Row = {
      id,
      name: node.name,
      type:
        node.type === 'ROUNDED_RECTANGLE'
          ? 'RECTANGLE'
          : node.type === 'SYMBOL'
            ? 'COMPONENT'
            : node.type === 'FRAME' && node.resizeToFit === true
              ? 'GROUP'
              : node.type,
      x: reportedRelative[0][2],
      y: reportedRelative[1][2],
      relativeTransform: reportedRelative,
      absoluteTransform: absolute,
      locked: node.locked ?? false,
      blendMode: node.blendMode ?? 'PASS_THROUGH',
      strokeCap: node.strokeCap ?? 'NONE',
      rotation: (-Math.atan2(relative[1][0], relative[0][0]) * 180) / Math.PI,
      layoutGrow: node.stackChildPrimaryGrow ?? 0,
      layoutAlign: node.stackChildAlignSelf ?? 'INHERIT',
    };
    for (const [field, binding, output] of [
      ['fillPaints', 'styleIdForFill', 'fills'],
      ['strokePaints', 'styleIdForStrokeFill', 'strokes'],
    ] as const) {
      const styleId = nativeNodeId(object(node[binding]).guid);
      const stylePaints = styleId ? byId.get(styleId)?.fillPaints : undefined;
      const originals = rows(node[field]);
      const paints = Array.isArray(stylePaints) ? stylePaints : originals;
      result[output] = normalizeNativePaints(paints);
    }
    if (typeof size.x === 'number' && typeof size.y === 'number') {
      result.width = size.x;
      result.height = size.y;
      const corners = [
        [0, 0],
        [size.x, 0],
        [0, size.y],
        [size.x, size.y],
      ].map(([x, y]) => [
        absolute[0][0] * x! + absolute[0][1] * y! + absolute[0][2],
        absolute[1][0] * x! + absolute[1][1] * y! + absolute[1][2],
      ]);
      const xs = corners.map(p => p[0]!),
        ys = corners.map(p => p[1]!);
      result.absoluteBoundingBox = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }
    for (const field of properties) if (node[field] !== undefined) result[field] = node[field];
    if (node.type !== 'TEXT') {
      result.fillGeometry = readNativeGeometry(node.fillGeometry, message.blobs);
      result.strokeGeometry = readNativeGeometry(node.strokeGeometry, message.blobs);
      if (
        (result.fillGeometry as unknown[]).length === 0 &&
        ['FRAME', 'INSTANCE', 'COMPONENT', 'RECTANGLE'].includes(String(result.type)) &&
        typeof result.width === 'number' &&
        typeof result.height === 'number' &&
        Number(node.cornerRadius ?? 0) === 0 &&
        ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].every(
          corner => Number(node[`rectangle${corner}CornerRadius`] ?? 0) === 0,
        )
      ) {
        const width = Number(result.width.toPrecision(6)),
          height = Number(result.height.toPrecision(6));
        result.fillGeometry = [
          {
            windingRule: 'NONZERO',
            data: `M0 0 L${width} 0 L${width} ${height} L0 ${height} L0 0 Z`,
          },
        ];
      }
    }
    if (result.type === 'VECTOR') result.cornerRadius = node.cornerRadius ?? 0;
    if (
      ['FRAME', 'INSTANCE', 'COMPONENT', 'RECTANGLE', 'COMPONENT_SET'].includes(String(result.type))
    ) {
      result.cornerRadius = node.cornerRadius ?? 0;
      for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']) {
        const key = corner[0]!.toLowerCase() + corner.slice(1) + 'Radius';
        result[key] = node.rectangleCornerRadiiIndependent
          ? (node[`rectangle${corner}CornerRadius`] ?? 0)
          : result.cornerRadius;
      }
    }
    if (node.type === 'TEXT') {
      result.paragraphSpacing = node.paragraphSpacing ?? 0;
      result.paragraphIndent = node.paragraphIndent ?? 0;
      result.textAlignHorizontal = node.textAlignHorizontal ?? 'LEFT';
      result.textAutoResize = node.textAutoResize ?? 'NONE';
    }
    if (node.frameMaskDisabled !== undefined) result.clipsContent = !node.frameMaskDisabled;
    if (node.textData !== undefined) result.characters = object(node.textData).characters;
    if (node.type === 'TEXT') {
      const layout = readNativeTextLayout(node.derivedTextData ?? node.textData, result.characters);
      if (layout) result.nativeTextLayout = layout;
    }
    if (node.fontName !== undefined) {
      const font = object(node.fontName);
      result.fontName = { family: font.family, style: font.style };
      const text = object(node.textData);
      const styleIds = Array.isArray(text.characterStyleIDs) ? text.characterStyleIDs : null;
      if (
        typeof text.characters === 'string' &&
        (text.characterStyleIDs === undefined ||
          (styleIds !== null &&
            (styleIds.length === 0 || styleIds.length === text.characters.length) &&
            styleIds.every(styleId => styleId === 0))) &&
        (text.styleOverrideTable === undefined ||
          (Array.isArray(text.styleOverrideTable) && text.styleOverrideTable.length === 0))
      )
        result.resolvedFontRanges = [
          { start: 0, end: text.characters.length, fontName: result.fontName },
        ];
    }
    for (const field of ['lineHeight', 'letterSpacing'] as const) {
      const value = object(node[field]);
      if (value.units && typeof value.value === 'number')
        result[field] =
          value.units === 'RAW'
            ? { unit: 'PERCENT', value: value.value * 100 }
            : { unit: value.units === 'PIXELS' ? 'PIXELS' : value.units, value: value.value };
    }
    if (childRecords.length) {
      result.children = childRecords.map(child =>
        visit(
          child,
          childPrefix,
          childContexts,
          absolute,
          depth + 1,
          result.type === 'GROUP' ? reportedRelative : null,
        ),
      );
      result.childIds = (result.children as Row[]).map(child => child.id);
    }
    return result;
  };
  const sceneRoots =
    root.type === 'CANVAS' || root.type === 'DOCUMENT'
      ? (children.get(nativeNodeId(root.guid)!) ?? [])
      : [root];
  const nodes = sceneRoots.map(node =>
    visit(
      node,
      [],
      [],
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      0,
    ),
  );
  return {
    source: 'figma-web-native-document',
    nodeCount: count,
    nodes,
    warnings,
    complete: false,
    limitations: [
      'Native property conversion is under comparison; unconverted paints, text ranges, catalogs, prototype semantics and oracle exports remain required.',
    ],
  };
}

export function compareFigmaCaptureNodes(actual: Row[], expected: Row[]) {
  const flatten = (nodes: Row[]) => {
    const result = new Map<string, Row>();
    const walk = (node: Row, parentId: string | null) => {
      if (typeof node.id !== 'string' || result.has(node.id))
        throw new Error('CAPTURE_NODE_ID_INVALID');
      result.set(node.id, { ...node, parentId });
      rows(node.children).forEach(child => walk(child, node.id as string));
    };
    nodes.forEach(node => walk(node, null));
    return result;
  };
  const a = flatten(actual),
    e = flatten(expected);
  const missingNodes = [...e.keys()].filter(id => !a.has(id)),
    extraNodes = [...a.keys()].filter(id => !e.has(id));
  const fields = [
    'name',
    'type',
    'parentId',
    'childIds',
    'x',
    'y',
    'width',
    'height',
    'relativeTransform',
    'absoluteTransform',
    'absoluteBoundingBox',
    ...properties,
    'clipsContent',
    'characters',
    'fontName',
    'lineHeight',
    'letterSpacing',
    'fills',
    'strokes',
    'fillGeometry',
    'strokeGeometry',
  ];
  const differences: Array<{
    nodeId: string;
    field: string;
    actual?: unknown;
    expected?: unknown;
  }> = [];
  const equal = (left: unknown, right: unknown): boolean => {
    if (typeof left === 'number' && typeof right === 'number')
      return Math.abs(left - right) <= 0.0001;
    if (Array.isArray(left) && Array.isArray(right))
      return left.length === right.length && left.every((v, i) => equal(v, right[i]));
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const l = object(left),
        r = object(right),
        keys = Object.keys(l);
      return (
        keys.length === Object.keys(r).length &&
        keys.every(k => Object.hasOwn(r, k) && equal(l[k], r[k]))
      );
    }
    return left === right;
  };
  let compared = 0;
  const fontRangeEvidence: Array<{ nodeId: string; matches: boolean }> = [];
  for (const [id, reference] of e) {
    const observed = a.get(id);
    if (!observed) continue;
    const nativeRanges = rows(observed.resolvedFontRanges),
      pluginRanges = rows(reference.textSegments);
    if (nativeRanges.length === 1 && pluginRanges.length > 0) {
      const native = nativeRanges[0]!;
      fontRangeEvidence.push({
        nodeId: id,
        matches:
          pluginRanges[0]!.start === native.start &&
          pluginRanges[pluginRanges.length - 1]!.end === native.end &&
          pluginRanges.every(
            (range, index) =>
              Number.isInteger(range.start) &&
              Number.isInteger(range.end) &&
              range.start === (index === 0 ? native.start : pluginRanges[index - 1]!.end) &&
              Number(range.end) >= Number(range.start) &&
              equal(range.fontName, native.fontName),
          ),
      });
    }
    for (const field of fields) {
      if (!(field in reference)) continue;
      compared++;
      const matched =
        field === 'fillGeometry' || field === 'strokeGeometry'
          ? equalNativeGeometry(observed[field], reference[field])
          : equal(observed[field], reference[field]);
      if (!matched)
        differences.push({
          nodeId: id,
          field,
          actual: observed[field],
          expected: reference[field],
        });
    }
  }
  const matchingFonts = new Set(
    fontRangeEvidence.filter(row => row.matches).map(row => row.nodeId),
  );
  const representationDifferences = differences.flatMap(difference => {
    if (difference.field === 'fontName' && matchingFonts.has(difference.nodeId))
      return [
        {
          nodeId: difference.nodeId,
          field: difference.field,
          reason: 'Uniform resolved font ranges match; node-level font representation differs.',
        },
      ];
    const observed = a.get(difference.nodeId)!,
      reference = e.get(difference.nodeId)!;
    if (
      difference.field === 'strokeWeight' &&
      Array.isArray(observed.strokes) &&
      observed.strokes.length === 0 &&
      Array.isArray(reference.strokes) &&
      reference.strokes.length === 0
    )
      return [
        {
          nodeId: difference.nodeId,
          field: difference.field,
          reason:
            'Both recorded nodes have no stroke paints; the retained width differs but has no current painted stroke.',
        },
      ];
    return [];
  });
  return {
    fullCaptureAccepted: false,
    comparedFields: fields,
    comparedPositions: compared,
    expectedNodes: e.size,
    actualNodes: a.size,
    missingNodes,
    extraNodes,
    differenceCount: differences.length,
    differences,
    fontRangeEvidence,
    representationDifferences,
    unexplainedDifferenceCount: differences.length - representationDifferences.length,
    limitation:
      'Only the declared fields were compared; this is not complete capture or frontend acceptance.',
  };
}
