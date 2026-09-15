/* eslint-disable no-await-in-loop -- Bound ordered reads preserve query identity and explicit partial continuation. */
import type { FigmaCaptureReadQuery } from './figma-capture-query.js';
// Only these read APIs are reachable by the closed collector. Extra node fields remain unknown until cloned.
export interface CaptureNode {
  id: string;
  name: string;
  type: string;
  parent: CaptureNode | null;
  children?: readonly CaptureNode[];
  selection?: readonly CaptureNode[];
  getMainComponentAsync?: () => Promise<CaptureNode | null>;
  getStyledTextSegments?: (fields: readonly string[]) => unknown;
  [key: string]: unknown;
}
export interface CaptureApiOwner {
  [key: string]: unknown;
}
export interface FigmaCaptureApi extends CaptureApiOwner {
  root: CaptureNode;
  currentPage: CaptureNode & {
    selection: readonly CaptureNode[];
    children: readonly CaptureNode[];
  };
  variables?: CaptureApiOwner;
  getNodeByIdAsync?: (id: string) => Promise<CaptureNode | null>;
  getNodeById: (id: string) => CaptureNode | null;
}
interface CapturedNode extends Record<string, unknown> {
  id: string;
  name: string;
  type: string;
  children?: CapturedNode[];
  childIds?: string[];
}
/** Closed implementation is compiled for Desktop and serialized for Scripter; it accepts no code. */
export async function readFigmaCapture(
  q: FigmaCaptureReadQuery,
  figma: FigmaCaptureApi,
  source:
    | 'figma-plugin-api-via-scripter'
    | 'figma-plugin-api-pinned' = 'figma-plugin-api-via-scripter',
): Promise<string> {
  const warnings: unknown[] = [];
  let count = 0,
    truncated = false,
    valueTruncated = false,
    warningCount = 0;
  const warn = (code: string, details: Record<string, unknown> = {}, valueLoss = true) => {
    warningCount++;
    if (warnings.length < 256) warnings.push({ code, ...details });
    if (valueLoss) {
      truncated = true;
      valueTruncated = true;
    }
  };
  const clone = (v: unknown, depth: number, path: string): unknown => {
    if (typeof v === 'symbol') return 'mixed';
    if (typeof v === 'string') {
      if (v.length > 20000) warn('STRING_LIMIT', { path, omitted: v.length - 20000 });
      return v.slice(0, 20000);
    }
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v !== 'object') return undefined;
    if (depth <= 0) {
      warn('VALUE_DEPTH_LIMIT', { path });
      return undefined;
    }
    if (Array.isArray(v)) {
      if (v.length > 256) warn('ARRAY_LIMIT', { path, omitted: v.length - 256 });
      return v.slice(0, 256).map((x, i) => clone(x, depth - 1, path + '/' + i));
    }
    const keys = Object.keys(v),
      out: Record<string, unknown> = Object.create(null);
    if (keys.length > 128) warn('PROPERTY_LIMIT', { path, omitted: keys.length - 128 });
    for (const k of keys.slice(0, 128)) {
      try {
        const x = clone((v as Record<string, unknown>)[k], depth - 1, path + '/' + k);
        if (x !== undefined) out[k] = x;
      } catch {
        warn('PROPERTY_UNAVAILABLE', { path: path + '/' + k });
      }
    }
    return out;
  };
  const nodeFields = [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'visible',
    'locked',
    'opacity',
    'blendMode',
    'fills',
    'strokes',
    'strokeWeight',
    'strokeAlign',
    'strokeTopWeight',
    'strokeRightWeight',
    'strokeBottomWeight',
    'strokeLeftWeight',
    'strokeCap',
    'strokeJoin',
    'strokeMiterLimit',
    'dashPattern',
    'effects',
    'cornerRadius',
    'cornerSmoothing',
    'topLeftRadius',
    'topRightRadius',
    'bottomLeftRadius',
    'bottomRightRadius',
    'constraints',
    'relativeTransform',
    'absoluteTransform',
    'absoluteBoundingBox',
    'absoluteRenderBounds',
    'layoutMode',
    'layoutWrap',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'layoutSizingHorizontal',
    'layoutSizingVertical',
    'layoutGrow',
    'layoutAlign',
    'layoutPositioning',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'itemSpacing',
    'counterAxisSpacing',
    'counterAxisAlignContent',
    'itemReverseZIndex',
    'strokesIncludedInLayout',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'targetAspectRatio',
    'clipsContent',
    'layoutGrids',
    'gridRowCount',
    'gridColumnCount',
    'gridRowGap',
    'gridColumnGap',
    'gridRowSizes',
    'gridColumnSizes',
    'gridRowAnchorIndex',
    'gridColumnAnchorIndex',
    'gridRowSpan',
    'gridColumnSpan',
    'gridChildHorizontalAlign',
    'gridChildVerticalAlign',
    'isMask',
    'maskType',
    'numberOfFixedChildren',
    'overflowDirection',
    'characters',
    'fontName',
    'fontSize',
    'fontWeight',
    'textAlignHorizontal',
    'textAlignVertical',
    'lineHeight',
    'letterSpacing',
    'textAutoResize',
    'textCase',
    'textDecoration',
    'textTruncation',
    'maxLines',
    'paragraphSpacing',
    'paragraphIndent',
    'hyperlink',
    'fillStyleId',
    'strokeStyleId',
    'effectStyleId',
    'gridStyleId',
    'textStyleId',
    'boundVariables',
    'explicitVariableModes',
    'resolvedVariableModes',
    'reactions',
    'annotations',
    'componentProperties',
    'variantProperties',
    'componentPropertyDefinitions',
    'description',
    'vectorPaths',
    'vectorNetwork',
    'fillGeometry',
    'strokeGeometry',
    'booleanOperation',
    'arcData',
    'exportSettings',
  ];
  const visit = async (node: CaptureNode, depth: number): Promise<CapturedNode | null> => {
    if (count >= q.maxNodes) {
      truncated = true;
      return null;
    }
    count++;
    const out: CapturedNode = {
      id: node.id,
      name: String(clone(node.name, 1, node.id + '/name')),
      type: node.type,
    };
    const observed = (out.collectorCapabilities = {
      bindings: 'unsupported',
      interactions: 'unsupported',
      componentApis: 'not-applicable',
    });
    if (node.type === 'TEXT') out.geometrySource = 'characters-and-fonts';
    for (const key of nodeFields) {
      // Text glyph outlines duplicate editable text and can dwarf the entire design payload.
      // Keep characters, font metadata and styled segments; actual vectors retain geometry.
      if (node.type === 'TEXT' && ['fillGeometry', 'strokeGeometry'].includes(key)) continue;
      try {
        if (key in node) {
          const value = clone(node[key], 12, node.id + '/' + key);
          if (value !== undefined) out[key] = value;
        }
      } catch {
        warn('PROPERTY_UNAVAILABLE', { nodeId: node.id, field: key });
      }
    }
    observed.bindings = 'boundVariables' in out ? 'observed' : 'unsupported';
    observed.interactions = Array.isArray(out.reactions) ? 'observed' : 'unsupported';
    if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type))
      observed.componentApis = 'unsupported';
    if (['COMPONENT', 'COMPONENT_SET'].includes(node.type) && out.componentPropertyDefinitions)
      observed.componentApis = 'observed';
    if (node.type === 'INSTANCE' && typeof node.getMainComponentAsync === 'function') {
      try {
        const main = await node.getMainComponentAsync();
        out.mainComponent =
          main === null
            ? null
            : {
                id: main.id,
                name: main.name,
                key: main.key,
                remote: main.remote,
                ...(main.parent && main.parent.type === 'COMPONENT_SET'
                  ? { componentSetId: main.parent.id, componentSetName: main.parent.name }
                  : {}),
              };
        const owner =
          main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
        if (owner && 'componentPropertyDefinitions' in owner) {
          out.componentApi = {
            ownerId: owner.id,
            definitions: clone(owner.componentPropertyDefinitions, 12, node.id + '/componentApi'),
          };
          observed.componentApis = 'observed';
        }
      } catch {
        warn('MAIN_COMPONENT_UNAVAILABLE', { nodeId: node.id });
      }
    }
    if (node.type === 'TEXT' && typeof node.getStyledTextSegments === 'function') {
      try {
        out.textSegments = clone(
          node.getStyledTextSegments([
            'fontName',
            'fontSize',
            'fontWeight',
            'fills',
            'lineHeight',
            'letterSpacing',
            'textDecoration',
            'textCase',
            'hyperlink',
            'textStyleId',
            'fillStyleId',
            'boundVariables',
          ]),
          12,
          node.id + '/textSegments',
        );
      } catch {
        warn('TEXT_SEGMENTS_UNAVAILABLE', { nodeId: node.id });
      }
    }
    if ('children' in node) {
      if (node.children.length > 100000) throw new Error('BROWSER_CHILD_LIMIT');
      out.childIds = node.children.map(child => child.id);
      if (new Set(out.childIds).size !== out.childIds.length)
        throw new Error('BROWSER_DUPLICATE_NODE');
    }
    if ('children' in node && node.children.length) {
      out.children = [];
      if (depth < q.depth) {
        for (const child of node.children) {
          const value = await visit(child, depth + 1);
          if (value === null) break;
          out.children.push(value);
        }
      }
      if (out.children.length < node.children.length) {
        out.omittedChildren = node.children.length - out.children.length;
        out.omissionReason = depth >= q.depth ? 'depth' : 'node-budget';
        truncated = true;
      }
    }
    return out;
  };
  const getNode = async (id: string) =>
    typeof figma.getNodeByIdAsync === 'function'
      ? await figma.getNodeByIdAsync(id)
      : figma.getNodeById(id);
  const requested = q.nodeId === null ? null : await getNode(q.nodeId);
  if (q.nodeId !== null && !requested) throw new Error('FIGMA_NODE_NOT_FOUND');
  let scopePage = requested;
  while (scopePage && !['PAGE', 'DOCUMENT'].includes(scopePage.type)) scopePage = scopePage.parent;
  scopePage = scopePage || figma.currentPage;
  let roots = requested
    ? [requested]
    : figma.currentPage.selection.length
      ? figma.currentPage.selection
      : figma.currentPage.children;
  if (
    q.mode === 'roots' &&
    requested &&
    (q.childrenOnly || ['PAGE', 'DOCUMENT'].includes(requested.type))
  )
    roots = requested.children || [];
  const rootIds = roots.map(n => n.id);
  if (rootIds.length > 100000) throw new Error('BROWSER_ROOT_LIMIT');
  if (new Set(rootIds).size !== rootIds.length) throw new Error('BROWSER_DUPLICATE_NODE');
  let signature = 2166136261;
  for (const id of rootIds)
    for (const c of id + ';') signature = Math.imul(signature ^ c.charCodeAt(0), 16777619);
  const nodes: CapturedNode[] = [];
  let nextRootOffset: number | null = null;
  if (q.mode === 'roots') {
    for (const root of roots.slice(q.offset, q.offset + 256))
      nodes.push({
        id: root.id,
        name: String(clone(root.name, 1, root.id + '/name')),
        type: root.type,
      });
    if (q.offset + nodes.length < roots.length) {
      nextRootOffset = q.offset + nodes.length;
      truncated = true;
    }
  } else if (q.mode === 'tree') {
    for (const root of roots) {
      const value = await visit(root, 0);
      if (value === null) break;
      nodes.push(value);
    }
  }
  const catalogs: Record<
    string,
    { state: string; count: number | null; nextOffset: number | null; valueTruncated: boolean }
  > = Object.create(null);
  const catalog = async (
    name: string,
    owner: () => CaptureApiOwner | undefined,
    method: string,
    offset: number,
    fields: string[],
    rename: Record<string, string> = {},
  ) => {
    const rows: Record<string, unknown>[] = [];
    catalogs[name] = { state: 'unsupported', count: null, nextOffset: null, valueTruncated: false };
    if (!q.includeTokens) return rows;
    try {
      const apiOwner = owner();
      if (!apiOwner || typeof apiOwner[method] !== 'function') return rows;
      const values = await apiOwner[method]();
      if (!Array.isArray(values)) throw new Error('CATALOG_INVALID');
      if (values.length > 100000) {
        catalogs[name] = {
          state: 'partial',
          count: values.length,
          nextOffset: null,
          valueTruncated: true,
        };
        warn('CATALOG_LIMIT', { family: name });
        return rows;
      }
      const ids = values.map(v => v.id);
      if (
        ids.some(id => typeof id !== 'string' || !id || id.length > 512) ||
        new Set(ids).size !== ids.length
      )
        throw new Error('CATALOG_ID_INVALID');
      const before = warningCount;
      for (const v of values.slice(offset, offset + 256)) {
        const out: Record<string, unknown> = Object.create(null);
        for (const field of fields) {
          const value = clone(v[field], 12, name + '/' + v.id + '/' + field);
          if (value !== undefined) out[rename[field] || field] = value;
        }
        rows.push(out);
      }
      const nextOffset = offset + rows.length < values.length ? offset + rows.length : null;
      catalogs[name] = {
        state:
          warningCount > before || nextOffset !== null
            ? 'partial'
            : values.length === 0
              ? 'empty'
              : 'complete',
        count: values.length,
        nextOffset,
        valueTruncated: warningCount > before,
      };
      if (nextOffset !== null) truncated = true;
    } catch {
      catalogs[name] = { state: 'failed', count: null, nextOffset: null, valueTruncated: true };
      warn('CATALOG_UNAVAILABLE', { family: name }, false);
    }
    return rows;
  };
  const common = ['id', 'name', 'key', 'description', 'remote'];
  const tokens = await catalog(
    'variables',
    () => figma.variables,
    'getLocalVariablesAsync',
    q.tokenOffset,
    [
      ...common,
      'resolvedType',
      'variableCollectionId',
      'valuesByMode',
      'codeSyntax',
      'scopes',
      'hiddenFromPublishing',
    ],
  );
  const collections = await catalog(
    'collections',
    () => figma.variables,
    'getLocalVariableCollectionsAsync',
    q.collectionOffset,
    [...common, 'modes', 'defaultModeId', 'variableIds', 'hiddenFromPublishing'],
  );
  const styles = {
    paints: await catalog('paintStyles', () => figma, 'getLocalPaintStylesAsync', q.paintOffset, [
      ...common,
      'paints',
      'boundVariables',
    ]),
    texts: await catalog('textStyles', () => figma, 'getLocalTextStylesAsync', q.textOffset, [
      ...common,
      'fontName',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'textWrapStyle',
      'paragraphIndent',
      'paragraphSpacing',
      'textCase',
      'textDecoration',
      'boundVariables',
    ]),
    effects: await catalog(
      'effectStyles',
      () => figma,
      'getLocalEffectStylesAsync',
      q.effectOffset,
      [...common, 'effects', 'boundVariables'],
    ),
    grids: await catalog(
      'gridStyles',
      () => figma,
      'getLocalGridStylesAsync',
      q.gridOffset,
      [...common, 'layoutGrids', 'boundVariables'],
      { layoutGrids: 'grids' },
    ),
  };
  const nextTokenOffset = catalogs.variables!.nextOffset,
    nextCollectionOffset = catalogs.collections!.nextOffset;
  const references: {
    variables: Record<string, unknown>[];
    collections: Record<string, unknown>[];
    styles: Record<string, unknown>[];
    unresolved: unknown[];
  } = { variables: [], collections: [], styles: [], unresolved: [] };
  if (q.mode === 'references') {
    for (const [family, ids, owner, method, fields] of [
      [
        'variables',
        q.variableIds,
        figma.variables,
        'getVariableByIdAsync',
        [...common, 'resolvedType', 'variableCollectionId', 'valuesByMode', 'codeSyntax', 'scopes'],
      ],
      [
        'collections',
        q.collectionIds,
        figma.variables,
        'getVariableCollectionByIdAsync',
        [...common, 'modes', 'defaultModeId', 'variableIds'],
      ],
      [
        'styles',
        q.styleIds,
        figma,
        'getStyleByIdAsync',
        [
          ...common,
          'type',
          'paints',
          'fontName',
          'fontSize',
          'lineHeight',
          'letterSpacing',
          'textWrapStyle',
          'paragraphIndent',
          'paragraphSpacing',
          'textCase',
          'textDecoration',
          'effects',
          'layoutGrids',
          'boundVariables',
        ],
      ],
    ] as const) {
      for (const id of ids) {
        try {
          if (!owner || typeof owner[method] !== 'function') {
            references.unresolved.push({ family, id, status: 'unsupported' });
            continue;
          }
          const value = await owner[method](id);
          if (!value || value.id !== id) {
            references.unresolved.push({ family, id, status: 'unavailable' });
            continue;
          }
          const row: Record<string, unknown> = Object.create(null);
          for (const field of fields) {
            const v = clone(value[field], 12, family + '/' + id + '/' + field);
            if (v !== undefined) row[field] = v;
          }
          references[family].push(row);
        } catch {
          references.unresolved.push({ family, id, status: 'failed' });
        }
      }
    }
  }
  const result = {
    schemaVersion: 1,
    source,
    fileName: figma.root.name,
    pageId: scopePage.id,
    pageName: scopePage.name,
    scopeType: requested ? requested.type : 'PAGE',
    scopeNodeId: requested ? requested.id : figma.currentPage.id,
    nodes,
    tokens,
    collections,
    styles,
    catalogs,
    references,
    rootIds,
    nodeCount: count,
    truncated,
    valueTruncated,
    warnings,
    warningCount,
    rootCount: roots.length,
    rootSignature: String(signature),
    nextRootOffset,
    nextTokenOffset,
    nextCollectionOffset,
    coverage: {
      version: 1,
      fields: nodeFields,
      images: 'references',
      textGeometry: 'characters-and-fonts',
      variables: catalogs.variables!.count !== null,
    },
  };
  const json = JSON.stringify(result);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < json.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  if (bytes > 8000000) throw new Error('BROWSER_DESIGN_RESULT_TOO_LARGE');
  return json;
}
