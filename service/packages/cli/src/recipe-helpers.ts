import { canonicalFileIdentityHash, type DesignJson, type DesignObservation } from '@sfp/shared';
import { z } from 'zod';

import {
  coreHash,
  freezeCore,
  verifyCoreObservation,
} from '../../mcp/src/portal/recipes/core-source.js';
import { paintItemSchema } from '../../mcp/src/tools/paint-schema.js';
import { importLibraryVariableTool } from '../../mcp/src/tools/safe-union.js';
import { parseFigmaTarget } from './figma-url.js';

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
const text = z.string().min(1).max(4096);
const NodeId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^I?\d+:\d+(?:;I?\d+:\d+)*$/u);
const targetRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: NodeId }).strict(),
  z.object({ kind: z.literal('url'), url: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal('page'), nodeId: NodeId }).strict(),
  z
    .object({
      kind: z.literal('selection'),
      pick: z.union([z.literal('all'), z.literal('first'), z.number().int().min(0).max(99999)]),
    })
    .strict(),
]);
const viewKey: unique symbol = Symbol('closed-design-view');
export interface RecipeDesignView {
  readonly [viewKey]: true;
  readonly sourceHash: `sha256:${string}`;
  readonly scopeId: string;
}
type Node = DesignObservation['nodes'][number];
const views = new WeakMap<object, { observation: DesignObservation; nodes: Map<string, Node> }>();
/** A read-only derivation view, never owner permission or a substitute for live write admission. */
export function createRecipeDesignView(input: DesignObservation): RecipeDesignView {
  const observation = verifyCoreObservation(input);
  if (
    observation.authority !== 'collector-observed' ||
    observation.coherence.status !== 'observed' ||
    observation.coherence.outcome !== 'matched' ||
    observation.sourceBinding.status !== 'observed'
  )
    fail('RECIPE_DESIGN_UNVERIFIED');
  const tree = observation.capabilities.find(capability => capability.name === 'tree');
  if (!tree || !['complete', 'empty'].includes(tree.status)) fail('RECIPE_TREE_INCOMPLETE');
  const view = Object.freeze({
    [viewKey]: true as const,
    sourceHash: coreHash(observation),
    scopeId: observation.sourceBinding.scopeId,
  });
  views.set(view, {
    observation: freezeCore(observation),
    nodes: new Map(observation.nodes.map(node => [node.id, node])),
  });
  return view;
}
const state = (view: RecipeDesignView) => views.get(view) ?? fail('RECIPE_DESIGN_VIEW_INVALID');
const node = (view: RecipeDesignView, nodeId: string) =>
  state(view).nodes.get(NodeId.parse(nodeId)) ?? fail('RECIPE_TARGET_NOT_OBSERVED');
const observedCapability = (view: RecipeDesignView, name: string) => {
  const capability = state(view).observation.capabilities.find(value => value.name === name);
  if (!capability || !['complete', 'empty'].includes(capability.status))
    fail('RECIPE_CATALOG_INCOMPLETE');
};
export function resolveRecipeTarget(view: RecipeDesignView, input: z.input<typeof targetRequest>) {
  const request = targetRequest.parse(input),
    data = state(view);
  let ids: string[];
  if (request.kind === 'selection') {
    const raw = data.observation.raw.selection;
    const parsed = z
      .object({ nodes: z.array(z.object({ id: NodeId }).passthrough()).max(100000) })
      .safeParse(raw);
    if (!parsed.success) fail('RECIPE_SELECTION_NOT_OBSERVED');
    const selected = parsed.data.nodes.map(item => item.id);
    if (new Set(selected).size !== selected.length) fail('RECIPE_SELECTION_INVALID');
    if (!selected.length) fail('RECIPE_SELECTION_EMPTY');
    if (request.pick === 'all') ids = selected;
    else {
      const index = request.pick === 'first' ? 0 : request.pick;
      const selectedId = selected[index];
      if (!selectedId) fail('RECIPE_SELECTION_INDEX_MISSING');
      ids = [selectedId];
    }
  } else if (request.kind === 'url') {
    const target = parseFigmaTarget(request.url);
    if (
      data.observation.sourceBinding.status !== 'observed' ||
      canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }) !==
        data.observation.sourceBinding.fileIdentityHash
    )
      fail('RECIPE_TARGET_FILE_MISMATCH');
    if (!target.nodeId) fail('RECIPE_URL_NODE_REQUIRED');
    ids = [target.nodeId];
  } else ids = [request.nodeId];
  const resolved = ids.map(id => node(view, id));
  if (request.kind === 'page' && resolved[0]!.properties.type !== 'PAGE')
    fail('RECIPE_TARGET_NOT_PAGE');
  return freezeCore({
    sourceHash: view.sourceHash,
    scopeId: view.scopeId,
    targets: resolved.map(item => ({
      nodeId: item.id,
      name: item.properties.name ?? '',
      type: item.properties.type ?? '',
    })),
  });
}
export function findRecipeDescendants(
  view: RecipeDesignView,
  rootId: string,
  name: string,
  options: { first?: boolean; maxNodes?: number } = {},
) {
  text.parse(name);
  const limit = z
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(options.maxNodes ?? 100000),
    root = node(view, rootId),
    matches: string[] = [];
  const pending = root.childIds.toReversed(),
    seen = new Set<string>();
  let visited = 0;
  while (pending.length && visited < limit) {
    const id = pending.pop()!;
    if (seen.has(id)) fail('RECIPE_TREE_INVALID');
    seen.add(id);
    const child = node(view, id);
    visited++;
    if (child.properties.name === name) matches.push(child.id);
    for (const next of child.childIds.toReversed()) pending.push(next);
  }
  return freezeCore({
    sourceHash: view.sourceHash,
    rootId,
    exactName: name,
    visited,
    complete: pending.length === 0,
    matches: options.first ? matches.slice(0, 1) : matches,
  });
}
export function dumpRecipeTree(
  view: RecipeDesignView,
  rootId: string,
  options: {
    maxDepth?: number;
    maxNodes?: number;
    maxBytes?: number;
    showSize?: boolean;
    showText?: boolean;
    showLayout?: boolean;
  } = {},
) {
  const depth = z
      .number()
      .int()
      .min(0)
      .max(128)
      .parse(options.maxDepth ?? 32),
    limit = z
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(options.maxNodes ?? 1000),
    budget = z
      .number()
      .int()
      .min(128)
      .max(1048576)
      .parse(options.maxBytes ?? 65536);
  const pending = [{ id: node(view, rootId).id, depth: 0 }],
    lines: string[] = [];
  let visited = 0,
    bytes = 0,
    truncated = false;
  while (pending.length && visited < limit) {
    const next = pending.pop()!,
      item = node(view, next.id),
      p = item.properties;
    visited++;
    let line =
      '  '.repeat(next.depth) +
      JSON.stringify(p.name ?? '') +
      ' [' +
      String(p.type ?? '') +
      '] ' +
      item.id;
    if (options.showSize !== false && typeof p.width === 'number' && typeof p.height === 'number')
      line += ' ' + Math.round(p.width) + 'x' + Math.round(p.height);
    if (options.showLayout === true && p.layout !== undefined)
      line += ' ' + JSON.stringify(p.layout);
    if (options.showText !== false && p.type === 'TEXT' && typeof p.characters === 'string')
      line += ' ' + JSON.stringify(p.characters);
    const size = Buffer.byteLength(line) + (lines.length ? 1 : 0);
    if (bytes + size > budget) {
      truncated = true;
      break;
    }
    bytes += size;
    lines.push(line);
    if (next.depth === depth) {
      if (item.childIds.length) truncated = true;
      continue;
    }
    for (const id of item.childIds.toReversed()) pending.push({ id, depth: next.depth + 1 });
  }
  return freezeCore({
    sourceHash: view.sourceHash,
    rootId,
    text: lines.join('\n'),
    visited,
    bytes,
    truncated: truncated || pending.length > 0,
  });
}
const variableRequest = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      id: text,
      modeByCollection: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('library'), key: text }).strict(),
]);
export function resolveRecipeVariable(
  view: RecipeDesignView,
  input: z.input<typeof variableRequest>,
) {
  const request = variableRequest.parse(input);
  observedCapability(view, 'variables');
  observedCapability(view, 'collections');
  if (request.kind === 'library')
    return freezeCore({
      sourceHash: view.sourceHash,
      status: 'import-required' as const,
      effect: 'library-import' as const,
      operation: {
        tool: 'import_library_variable' as const,
        args: importLibraryVariableTool.inputSchema.parse({ key: request.key }),
      },
    });
  const catalog = state(view).observation.catalogs,
    variables = new Map(catalog.variables.map(variable => [variable.id, variable])),
    first = variables.get(request.id);
  if (!first) fail('RECIPE_LOCAL_VARIABLE_NOT_FOUND');
  if (request.modeByCollection === undefined)
    return freezeCore({
      sourceHash: view.sourceHash,
      status: 'identity' as const,
      variable: first,
    });
  let current = first;
  const chain: string[] = [];
  let value: DesignJson | undefined;
  while (chain.length < 128) {
    if (chain.includes(current.id)) fail('RECIPE_VARIABLE_ALIAS_CYCLE');
    chain.push(current.id);
    const mode = request.modeByCollection[current.collectionId];
    if (!mode) fail('RECIPE_VARIABLE_MODE_REQUIRED');
    const collection = catalog.collections.find(item => item.id === current.collectionId);
    if (
      !collection ||
      !Array.isArray(collection.raw.modes) ||
      !collection.raw.modes.some(
        item => item && typeof item === 'object' && !Array.isArray(item) && item.modeId === mode,
      ) ||
      !Object.hasOwn(current.valuesByMode, mode)
    )
      fail('RECIPE_VARIABLE_MODE_MISSING');
    value = current.valuesByMode[mode];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.type === 'VARIABLE_ALIAS'
    ) {
      if (typeof value.id !== 'string') fail('RECIPE_VARIABLE_ALIAS_INVALID');
      const target = variables.get(value.id);
      if (!target || target.raw.resolvedType !== first.raw.resolvedType)
        fail('RECIPE_VARIABLE_ALIAS_INVALID');
      current = target;
      continue;
    }
    const valid =
      first.raw.resolvedType === 'BOOLEAN'
        ? typeof value === 'boolean'
        : first.raw.resolvedType === 'FLOAT'
          ? typeof value === 'number' && Number.isFinite(value)
          : first.raw.resolvedType === 'STRING'
            ? typeof value === 'string'
            : first.raw.resolvedType === 'COLOR'
              ? z
                  .object({
                    r: z.number().min(0).max(1),
                    g: z.number().min(0).max(1),
                    b: z.number().min(0).max(1),
                    a: z.number().min(0).max(1).optional(),
                  })
                  .safeParse(value).success
              : false;
    if (!valid) fail('RECIPE_VARIABLE_VALUE_UNSUPPORTED');
    return freezeCore({
      sourceHash: view.sourceHash,
      status: 'resolved' as const,
      variableId: first.id,
      collectionId: first.collectionId,
      aliasChain: chain,
      value,
    });
  }
  return fail('RECIPE_VARIABLE_ALIAS_LIMIT');
}
export function recipeHexColor(input: string) {
  const hex = z.string().max(64).parse(input).trim().replace(/^#/u, '');
  if (!/^(?:[a-f0-9]{3}|[a-f0-9]{6})$/iu.test(hex)) fail('RECIPE_HEX_INVALID');
  const expanded = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex,
    n = Number.parseInt(expanded, 16);
  return Object.freeze({
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  });
}
export function recipeSolidPaint(input: string, opacity?: number) {
  const paint = paintItemSchema.parse({
    type: 'SOLID',
    color: recipeHexColor(input),
    ...(opacity === undefined ? {} : { opacity: z.number().min(0).max(1).parse(opacity) }),
  });
  return freezeCore([paint]);
}
const padding = z.union([
  z.number().min(0),
  z.tuple([z.number().min(0), z.number().min(0)]),
  z
    .object({
      top: z.number().min(0).optional(),
      right: z.number().min(0).optional(),
      bottom: z.number().min(0).optional(),
      left: z.number().min(0).optional(),
    })
    .strict(),
]);
export function recipePadding(input: z.input<typeof padding> | undefined) {
  if (input === undefined) return undefined;
  const value = padding.parse(input);
  if (typeof value === 'number')
    return Object.freeze({ top: value, right: value, bottom: value, left: value });
  if (Array.isArray(value))
    return Object.freeze({ top: value[0], right: value[1], bottom: value[0], left: value[1] });
  return Object.freeze({
    top: value.top ?? 0,
    right: value.right ?? 0,
    bottom: value.bottom ?? 0,
    left: value.left ?? 0,
  });
}
export function recipeVariants(view: RecipeDesignView, instanceId: string) {
  observedCapability(view, 'componentApis');
  const instance = node(view, instanceId);
  if (instance.properties.type !== 'INSTANCE') fail('RECIPE_TARGET_NOT_INSTANCE');
  const main = instance.properties.mainComponent;
  if (!main || typeof main !== 'object' || Array.isArray(main) || typeof main.id !== 'string')
    fail('RECIPE_COMPONENT_NOT_OBSERVED');
  const definition = node(view, main.id),
    parent = definition.parentId === null ? undefined : state(view).nodes.get(definition.parentId);
  if (parent?.properties.type !== 'COMPONENT_SET')
    return freezeCore({
      sourceHash: view.sourceHash,
      current: definition.properties.name,
      groups: null,
      all: null,
    });
  const groups = z
    .record(z.string(), z.object({ values: z.array(z.string()).max(1000) }).strict())
    .safeParse(parent.properties.variantGroupProperties);
  if (!groups.success) fail('RECIPE_VARIANT_GROUPS_NOT_OBSERVED');
  const children = parent.childIds.map(id => node(view, id));
  if (children.some(item => item.properties.type !== 'COMPONENT'))
    fail('RECIPE_COMPONENT_SET_INVALID');
  return freezeCore({
    sourceHash: view.sourceHash,
    current: definition.properties.name,
    groups: groups.data,
    all: children.map(item => ({
      nodeId: item.id,
      name: item.properties.name,
      properties: item.properties.variantProperties ?? null,
    })),
  });
}
