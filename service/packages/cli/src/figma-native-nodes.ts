import { nativeNodeId, selectFigmaNativeNodes } from './figma-native-document.js';
import { normalizeNativeEffects } from './figma-native-effects.js';
import { readNativeFontRanges } from './figma-native-font-ranges.js';
import { readNativeGeometry, equalNativeGeometry } from './figma-native-geometry.js';
import {
  nativeContainerProperties,
  nativeLayoutSizing,
  normalizeNativeLayout,
  NATIVE_CONTAINER_FIELDS,
  NATIVE_LAYOUT_FIELDS,
  NATIVE_SIZING_FIELDS,
} from './figma-native-layout.js';
import {
  NATIVE_METADATA_FIELDS,
  nativeDocumentHasVariables,
  nativeMetadataProperties,
} from './figma-native-metadata.js';
import { normalizeNativePaints } from './figma-native-paints.js';
import { mergeNativeReactions, readNativeReactions } from './figma-native-reactions.js';
import { readNativeTextLayout } from './figma-native-text-layout.js';
import {
  NATIVE_TEXT_PROPERTY_FIELDS,
  readNativeTextProperties,
} from './figma-native-text-properties.js';
import { readNativeVectorGeometry } from './figma-native-vector-network.js';

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
const contiguousFontRanges = (ranges: Row[]) =>
  ranges[0]?.start === 0 &&
  ranges.every(
    (range, index) =>
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      Number(range.end) > Number(range.start) &&
      (index === 0 || range.start === ranges[index - 1]!.end),
  );
// Plugin API node types with individual stroke sides.
const STROKE_SIDE_TYPES = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'RECTANGLE']);
const STROKE_WIDTH_FIELDS = new Set([
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
]);
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
    Math.fround(a[0][0] * b[0][0] + a[0][1] * b[1][0]),
    Math.fround(a[0][0] * b[0][1] + a[0][1] * b[1][1]),
    Math.fround(a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]),
  ],
  [
    Math.fround(a[1][0] * b[0][0] + a[1][1] * b[1][0]),
    Math.fround(a[1][0] * b[0][1] + a[1][1] * b[1][1]),
    Math.fround(a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]),
  ],
];

const assignNode = (target: Row, update: Row | undefined) => {
  if (!update) return target;
  const reactions = Object.hasOwn(update, 'prototypeInteractions')
    ? mergeNativeReactions(target.prototypeInteractions, update.prototypeInteractions)
    : target.prototypeInteractions;
  Object.assign(target, update);
  if (reactions !== undefined) target.prototypeInteractions = reactions;
  return target;
};
const overlays = (input: Row, path: string[], contexts: InstanceContext[]) => {
  const result: Row = Object.assign(Object.create(null), input);
  // Outer instance overrides take precedence over defaults of nested component instances.
  for (const context of contexts.toReversed()) {
    const key = path.slice(context.path.length).join(';');
    assignNode(assignNode(result, context.overrides.get(key)), context.derived.get(key));
  }
  return result;
};

/** Expand native component references without borrowing data from the Plugin API capture. */
export function normalizeFigmaNativeNodes(message: Row, nodeId: string | null) {
  const all = rows(message.nodeChanges),
    byId = new Map<string, Row>(),
    stylesByKey = new Map<string, Row[]>(),
    children = new Map<string, Row[]>();
  for (const node of all) {
    const id = nativeNodeId(node.guid);
    if (!id) continue;
    byId.set(id, node);
    if (node.styleType && typeof node.key === 'string' && node.isSoftDeleted !== true) {
      const key = `${String(node.styleType)}\0${node.key}`;
      const matches = stylesByKey.get(key) ?? [];
      matches.push(node);
      stylesByKey.set(key, matches);
    }
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
  const variables = nativeDocumentHasVariables(all);
  // Grid auto-layout placement of a child depends on whether its parent is a grid container.
  const gridParents: boolean[] = [];
  let count = 0;
  const expandedIds = new Set<string>();
  const warnings: Array<{ code: string; nodeId: string; detail?: string }> = [];
  const resolveStyle = (value: unknown, kind: string, ownerId: string): Row | undefined => {
    const reference = object(value),
      asset = object(reference.assetRef);
    const guid = nativeNodeId(reference.guid);
    let style: Row | undefined;
    if (guid) style = byId.get(guid);
    else if (typeof asset.key === 'string') {
      const matches = (stylesByKey.get(`${kind}\0${asset.key}`) ?? []).filter(
        row => asset.version === undefined || row.version === asset.version,
      );
      if (matches.length === 1) style = matches[0];
    } else return undefined;
    if (style?.styleType === kind) return style;
    warnings.push({ code: 'NATIVE_STYLE_UNAVAILABLE', nodeId: ownerId, detail: kind });
    return undefined;
  };
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
    const instanceKey = prefix.length ? (nativeNodeId(input.overrideKey) ?? guid) : guid;
    const path = [...prefix, instanceKey],
      id = prefix.length ? `I${path.join(';')}` : guid;
    if (expandedIds.has(id)) throw new Error('FIGMA_NATIVE_NODE_ID_DUPLICATE');
    expandedIds.add(id);
    let node = overlays(input, path, contexts);
    let childRecords = children.get(guid) ?? [],
      childPrefix = prefix,
      childContexts = contexts;
    if (node.type === 'INSTANCE') {
      const placementAlign = node.stackChildAlignSelf;
      const placementHorizontal = node.horizontalConstraint;
      const placementVertical = node.verticalConstraint;
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
          [
            component,
            node,
            overrides.get(componentId!),
            derived.get(componentId!),
            { type: 'INSTANCE', guid: input.guid },
          ].reduce<Row>(assignNode, {}),
          path,
          contexts,
        );
        node.stackChildAlignSelf = placementAlign;
        node.horizontalConstraint = placementHorizontal;
        node.verticalConstraint = placementVertical;
        childRecords = children.get(componentId!) ?? [];
        childPrefix = path;
        const scale = typeof symbol.uniformScaleFactor === 'number' ? symbol.uniformScaleFactor : 1;
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('FIGMA_NATIVE_SCALE_INVALID');
        childContexts = [...contexts, { path, overrides, derived, scale }];
      }
    }
    const textStyle =
      node.type === 'TEXT' && node.isOverrideOverTextStyle !== true
        ? resolveStyle(node.styleIdForText, 'TEXT', id)
        : undefined;
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
    const reactions = Object.keys(node).some(key => key.startsWith('transition'))
      ? null
      : readNativeReactions(node.prototypeInteractions);
    if (reactions === null) warnings.push({ code: 'NATIVE_REACTIONS_UNSUPPORTED', nodeId: id });
    else result.reactions = reactions;
    const nativeLayout = normalizeNativeLayout(
      node,
      ['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(String(result.type)),
    );
    Object.assign(result, nativeLayout.values);
    if (nativeLayout.unknown.length)
      warnings.push({
        code: 'NATIVE_LAYOUT_UNSUPPORTED',
        nodeId: id,
        detail: nativeLayout.unknown.join(','),
      });
    const container = nativeContainerProperties(node, String(result.type));
    Object.assign(result, container.values);
    if (container.unknown.length)
      warnings.push({
        code: 'NATIVE_CONTAINER_UNSUPPORTED',
        nodeId: id,
        detail: container.unknown.join(','),
      });
    // Export settings belong to the node itself: an instance never reports its main component's
    // settings, and instance sublayers report none unless an instance override sets them.
    const exportOverridden = contexts.some(
      context =>
        object(context.overrides.get(path.slice(context.path.length).join(';'))).exportSettings !==
        undefined,
    );
    const ownExportSettings = prefix.length
      ? exportOverridden
        ? null
        : undefined
      : node.type === 'INSTANCE'
        ? input.exportSettings
        : node.exportSettings;
    const metadata = nativeMetadataProperties(node, String(result.type), {
      parentIsGrid: gridParents.at(-1) ?? false,
      variables,
      exportSettings: ownExportSettings,
    });
    Object.assign(result, metadata.values);
    if (metadata.unknown.length) {
      // Declared unknowns are reported as unobserved comparison positions, never as matches.
      result.nativeUnknownFields = metadata.unknown;
      warnings.push({
        code: 'NATIVE_METADATA_UNSUPPORTED',
        nodeId: id,
        detail: metadata.unknown.join(','),
      });
    }
    for (const [field, binding, output] of [
      ['fillPaints', 'styleIdForFill', 'fills'],
      ['strokePaints', 'styleIdForStrokeFill', 'strokes'],
    ] as const) {
      const stylePaints = resolveStyle(node[binding], 'FILL', id)?.fillPaints;
      const originals = rows(node[field]);
      const paints = Array.isArray(stylePaints) ? stylePaints : originals;
      result[output] = normalizeNativePaints(paints);
    }
    // A resolvable effect style supersedes the node's cached effect copy, as for paint styles.
    const styleEffects = resolveStyle(node.styleIdForEffect, 'EFFECT', id)?.effects;
    const effects = normalizeNativeEffects(
      Array.isArray(styleEffects) ? styleEffects : node.effects,
    );
    if (effects === null) warnings.push({ code: 'NATIVE_EFFECTS_UNSUPPORTED', nodeId: id });
    else result.effects = effects;
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
        x: Math.fround(Math.min(...xs)),
        y: Math.fround(Math.min(...ys)),
        width: Math.fround(Math.max(...xs) - Math.min(...xs)),
        height: Math.fround(Math.max(...ys) - Math.min(...ys)),
      };
    }
    for (const field of properties) if (node[field] !== undefined) result[field] = node[field];
    if (node.type !== 'TEXT') {
      result.fillGeometry = readNativeGeometry(node.fillGeometry, message.blobs);
      result.strokeGeometry = readNativeGeometry(node.strokeGeometry, message.blobs);
      if ((result.fillGeometry as unknown[]).length === 0 && node.type === 'VECTOR') {
        const geometry = readNativeVectorGeometry(node.vectorData, message.blobs, node.size);
        if (geometry) result.fillGeometry = geometry;
      }
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
        const width = result.width,
          height = result.height;
        result.fillGeometry = [
          {
            windingRule: 'NONZERO',
            data: `M0 0 L${width} 0 L${width} ${height} L0 ${height} L0 0 Z`,
          },
        ];
      }
    }
    if (['VECTOR', 'ELLIPSE'].includes(String(result.type)))
      result.cornerRadius = node.cornerRadius ?? 0;
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
      if (node.rectangleCornerRadiiIndependent) {
        const radii = [
          'topLeftRadius',
          'topRightRadius',
          'bottomLeftRadius',
          'bottomRightRadius',
        ].map(key => result[key]);
        result.cornerRadius = new Set(radii).size === 1 ? radii[0] : 'mixed';
      }
    }
    if (node.borderStrokeWeightsIndependent) {
      const weights = ['Top', 'Right', 'Bottom', 'Left'].map(side => {
        const value = node[`border${side}Weight`] ?? 0;
        result[`stroke${side}Weight`] = value;
        return value;
      });
      result.strokeWeight = new Set(weights).size === 1 ? weights[0] : 'mixed';
    } else if (
      STROKE_SIDE_TYPES.has(String(result.type)) &&
      typeof node.strokeWeight === 'number'
    ) {
      for (const side of ['Top', 'Right', 'Bottom', 'Left'])
        result[`stroke${side}Weight`] = node.strokeWeight;
    }
    if (result.type !== 'GROUP') {
      // Figma omits default miter limits and solid dash patterns from native records.
      const miter = node.miterLimit ?? 4,
        dashes = node.dashPattern ?? [];
      if (typeof miter === 'number' && Number.isFinite(miter)) result.strokeMiterLimit = miter;
      else
        warnings.push({
          code: 'NATIVE_STROKE_UNSUPPORTED',
          nodeId: id,
          detail: 'strokeMiterLimit',
        });
      if (
        Array.isArray(dashes) &&
        dashes.every(value => typeof value === 'number' && Number.isFinite(value))
      )
        result.dashPattern = dashes;
      else warnings.push({ code: 'NATIVE_STROKE_UNSUPPORTED', nodeId: id, detail: 'dashPattern' });
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
      const fontRanges = readNativeFontRanges(node, result.fontName);
      if (fontRanges) result.resolvedFontRanges = fontRanges;
    }
    if (node.type === 'TEXT') {
      const text = readNativeTextProperties(
        node,
        Array.isArray(result.resolvedFontRanges)
          ? (result.resolvedFontRanges as Array<{ nativeFontWeight?: number }>)
          : null,
      );
      Object.assign(result, text.values);
      if (text.unknown.length)
        warnings.push({
          code: 'NATIVE_TEXT_PROPERTY_UNSUPPORTED',
          nodeId: id,
          detail: text.unknown.join(','),
        });
    }
    for (const field of ['lineHeight', 'letterSpacing'] as const) {
      const value = object(node[field]);
      if (value.units && typeof value.value === 'number')
        result[field] =
          field === 'lineHeight' && value.units === 'PERCENT' && value.value === 100
            ? { unit: 'AUTO' }
            : value.units === 'RAW'
              ? { unit: 'PERCENT', value: value.value * 100 }
              : { unit: value.units === 'PIXELS' ? 'PIXELS' : value.units, value: value.value };
    }
    if (childRecords.length) {
      gridParents.push(node.stackMode === 'GRID');
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
      gridParents.pop();
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
  // Sizing depends on the parent's decoded layout, so it is derived after the tree is complete.
  const assignSizing = (node: Row, parent: Row | null): void => {
    for (const [field, horizontal] of [
      ['layoutSizingHorizontal', true],
      ['layoutSizingVertical', false],
    ] as const) {
      const sizing = nativeLayoutSizing(node, parent, horizontal);
      if (sizing !== undefined) node[field] = sizing;
    }
    for (const child of rows(node.children)) assignSizing(child, node);
  };
  for (const node of nodes) assignSizing(node, null);
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
    'strokeMiterLimit',
    'dashPattern',
    'strokeTopWeight',
    'strokeRightWeight',
    'strokeBottomWeight',
    'strokeLeftWeight',
    'effects',
    'fillGeometry',
    'strokeGeometry',
    'reactions',
    ...NATIVE_LAYOUT_FIELDS,
    ...NATIVE_SIZING_FIELDS,
    ...NATIVE_TEXT_PROPERTY_FIELDS,
    ...NATIVE_CONTAINER_FIELDS,
    ...NATIVE_METADATA_FIELDS,
  ];
  const unobservedFields: Record<string, number> = {};
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
  const sameFont = (native: Row, reference: Row) => {
    if (equal(reference.fontName, native.fontName)) return true;
    const expectedFont = object(reference.fontName),
      axes = object(expectedFont.variationSettings);
    const { variationSettings: _axes, ...namedFont } = expectedFont;
    return (
      typeof native.nativeFontWeight === 'number' &&
      Object.keys(axes).length === 1 &&
      axes.wght === native.nativeFontWeight &&
      equal(namedFont, native.fontName)
    );
  };
  const sameFontRanges = (native: Row[], reference: Row[]) => {
    if (
      !contiguousFontRanges(native) ||
      !contiguousFontRanges(reference) ||
      native.at(-1)!.end !== reference.at(-1)!.end
    )
      return false;
    let n = 0,
      r = 0;
    while (n < native.length && r < reference.length) {
      const nativeRange = native[n]!,
        referenceRange = reference[r]!;
      if (!sameFont(nativeRange, referenceRange)) return false;
      const end = Math.min(Number(nativeRange.end), Number(referenceRange.end));
      if (nativeRange.end === end) n++;
      if (referenceRange.end === end) r++;
    }
    return n === native.length && r === reference.length;
  };
  for (const [id, reference] of e) {
    const observed = a.get(id);
    if (!observed) continue;
    const nativeRanges = rows(observed.resolvedFontRanges),
      pluginRanges = rows(reference.textSegments);
    if (nativeRanges.length > 0 && pluginRanges.length > 0) {
      fontRangeEvidence.push({
        nodeId: id,
        matches: sameFontRanges(nativeRanges, pluginRanges),
      });
    }
    const declaredUnknown = new Set(
      Array.isArray(observed.nativeUnknownFields) ? observed.nativeUnknownFields : [],
    );
    for (const field of fields) {
      if (!(field in reference)) continue;
      if (declaredUnknown.has(field)) {
        unobservedFields[field] = (unobservedFields[field] ?? 0) + 1;
        continue;
      }
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
          reason: 'Resolved font ranges match; node-level font representation differs.',
        },
      ];
    const observed = a.get(difference.nodeId)!,
      reference = e.get(difference.nodeId)!;
    if (
      STROKE_WIDTH_FIELDS.has(difference.field) &&
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
    unobservedPositions: Object.values(unobservedFields).reduce((sum, value) => sum + value, 0),
    unobservedFields,
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
