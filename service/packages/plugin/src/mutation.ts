import { createSandboxCancellation } from './cancellation.js';
import type { SandboxExecutionContext, SandboxToolHandler } from './dispatcher.js';

export interface PluginHandlerOutcome<T = unknown> {
  readonly value: T;
  readonly mutated: boolean;
}
type Contract = 'state' | 'create' | 'ui';
const contracts: Record<string, Contract> = Object.create(null) as Record<string, Contract>;
for (const name of [
  'set_fills',
  'set_text',
  'set_text_properties',
  'set_text_range',
  'set_opacity',
  'set_visible',
  'rename_node',
  'set_annotations',
  'delete_nodes',
  'set_corner_radius',
  'set_strokes',
  'move_nodes',
  'resize_nodes',
  'set_auto_layout',
  'set_layout_props',
  'set_layout_grids',
  'set_position',
  'set_blend_mode',
  'set_mask',
  'set_arc',
  'set_constraints',
  'rotate_nodes',
  'lock_nodes',
  'unlock_nodes',
  'set_effects',
  'update_paint_style',
  'update_text_style',
  'update_effect_style',
  'apply_style_to_node',
  'delete_style',
  'add_variable_mode',
  'set_variable_value',
  'bind_variable_to_node',
  'bind_variable_to_paint',
  'rename_variable',
  'set_variable_code_syntax',
  'delete_variable',
  'delete_variable_collection',
  'ungroup_nodes',
  'reparent_nodes',
  'reorder_nodes',
  'find_replace_text',
  'batch_rename_nodes',
  'delete_page',
  'rename_page',
  'set_reactions',
  'remove_reactions',
  'add_component_property',
  'edit_component_property',
  'delete_component_property',
  'bind_component_property',
  'set_instance_properties',
  'swap_component',
  'detach_instance',
  'apply_animation_style',
  'remove_animation_style',
  'apply_manual_keyframe_track',
  'remove_manual_keyframe_track',
  'set_timeline_duration',
  'batch',
  'import_library_variable',
])
  contracts[name] = 'state';
for (const name of [
  'create_frame',
  'create_text',
  'create_rectangle',
  'clone_node',
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'create_variable_collection',
  'create_variable',
  'group_nodes',
  'add_page',
  'import_image',
  'import_svg',
  'create_ellipse',
  'create_component',
  'create_section',
  'create_instance',
  'combine_as_variants',
])
  contracts[name] = 'create';
contracts.navigate_to_page = 'ui';
export const MUTATION_CONTRACTS = Object.freeze(contracts);
const SYSTEM_MUTATION_CONTRACTS: Readonly<Record<string, Contract>> = Object.freeze({
  'identity.bootstrap': 'state',
});

// Observe document values, never methods, caches, selection or viewport state. This covers the
// values written by the closed handler registry, including mixed text runs and Motion state.
const FIELDS = [
  'id',
  'name',
  'type',
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
  'dashPattern',
  'effects',
  'cornerRadius',
  'cornerSmoothing',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'constraints',
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
  'textWrapStyle',
  'hyperlink',
  'fillStyleId',
  'strokeStyleId',
  'effectStyleId',
  'textStyleId',
  'gridStyleId',
  'boundVariables',
  'explicitVariableModes',
  'reactions',
  'componentProperties',
  'componentPropertyReferences',
  'variantProperties',
  'componentPropertyDefinitions',
  'description',
  'annotations',
  'arcData',
  'paints',
  'modes',
  'defaultModeId',
  'variableIds',
  'valuesByMode',
  'codeSyntax',
  'scopes',
  'animationStyles',
  'animations',
  'manualKeyframeTracks',
  'timelines',
] as const;
const outcomes = new WeakMap<object, { outcome: PluginHandlerOutcome; settle(): void }>();
const failures = new WeakMap<object, { mutated: boolean | 'unknown'; settle(): void }>();
export const isMutatingFailure = (input: unknown): boolean =>
  input !== null &&
  typeof input === 'object' &&
  failures.has(input) &&
  failures.get(input)?.mutated !== false;

const stable = (value: unknown): string => {
  let entries = 0;
  const copy = (input: unknown, depth: number): unknown => {
    if (++entries > 200_000 || depth > 40) throw new Error('MUTATION_OBSERVATION_LIMIT');
    if (typeof input === 'symbol') return { mixed: true };
    if (input === null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map(item => copy(item, depth + 1));
    return Object.fromEntries(
      Object.keys(input)
        .toSorted()
        .map(key => [key, copy((input as Record<string, unknown>)[key], depth + 1)]),
    );
  };
  const result = JSON.stringify(copy(value, 0));
  if (result.length > 8_000_000) throw new Error('MUTATION_OBSERVATION_LIMIT');
  return result;
};

interface Targets {
  nodes: Set<string>;
  styles: Set<string>;
  variables: Set<string>;
  collections: Set<string>;
  deep: boolean;
}
const targetsFor = (figmaCtx: typeof figma, name: string, input: unknown): Targets => {
  const targets: Targets = {
    nodes: new Set(),
    styles: new Set(),
    variables: new Set(),
    collections: new Set(),
    deep: ['find_replace_text', 'batch_rename_nodes', 'batch'].includes(name),
  };
  const scan = (value: unknown, depth: number): void => {
    if (depth > 12) throw new Error('MUTATION_ARGUMENT_LIMIT');
    if (Array.isArray(value)) {
      for (const item of value) scan(item, depth + 1);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const bag = [
        'nodeId',
        'nodeIds',
        'parentId',
        'newParentId',
        'fromNodeId',
        'componentId',
        'instanceId',
      ].includes(key)
        ? targets.nodes
        : key === 'styleId'
          ? targets.styles
          : key === 'variableId'
            ? targets.variables
            : key === 'collectionId'
              ? targets.collections
              : null;
      if (bag !== null)
        for (const id of Array.isArray(item) ? item : [item]) {
          if (typeof id === 'string') bag.add(id);
        }
      if (
        ['ops', 'params', 'renames', 'updates', 'nodes'].includes(key) &&
        typeof item === 'object' &&
        item !== null
      )
        scan(item, depth + 1);
    }
  };
  scan(input, 0);
  if (figmaCtx.currentPage?.id !== undefined) targets.nodes.add(figmaCtx.currentPage.id);
  return targets;
};

const capture = async (figmaCtx: typeof figma, targets: Targets): Promise<string> => {
  const observed: unknown[] = [];
  const visited = new Set<string>();
  const observe = async (entity: unknown, deep: boolean): Promise<void> => {
    if (entity === null || typeof entity !== 'object') {
      observed.push(null);
      return;
    }
    const node = entity as Record<string, unknown>;
    if (typeof node.id === 'string') {
      if (visited.has(node.id)) return;
      visited.add(node.id);
    }
    if (visited.size > 5_000) throw new Error('MUTATION_OBSERVATION_LIMIT');
    const snapshot: Record<string, unknown> = {};
    for (const key of FIELDS)
      if (key in node) {
        try {
          snapshot[key] = node[key];
        } catch {
          snapshot[key] = { unavailable: true };
        }
      }
    if ('parent' in node) snapshot.parentId = (node.parent as { id?: string } | null)?.id ?? null;
    if (Array.isArray(node.children))
      snapshot.children = node.children.map(child => (child as { id: string }).id);
    if (node.type === 'INSTANCE' && typeof node.getMainComponentAsync === 'function') {
      const component = await (entity as InstanceNode).getMainComponentAsync();
      snapshot.mainComponentId = component?.id ?? null;
    }
    if (node.type === 'TEXT' && typeof node.getStyledTextSegments === 'function') {
      snapshot.textSegments = (entity as TextNode).getStyledTextSegments([
        'fontName',
        'fontSize',
        'fills',
        'lineHeight',
        'letterSpacing',
        'textCase',
        'textDecoration',
      ]);
    }
    observed.push(snapshot);
    if (deep && Array.isArray(node.children))
      for (const child of node.children) {
        // eslint-disable-next-line no-await-in-loop -- limit and retain this exact document scope
        await observe(child, true);
      }
  };
  /* eslint-disable no-await-in-loop -- each observation remains within the operation's exact subject IDs */
  for (const id of [...targets.nodes].toSorted())
    await observe(await figmaCtx.getNodeByIdAsync(id), targets.deep);
  for (const id of [...targets.styles].toSorted())
    await observe(await figmaCtx.getStyleByIdAsync(id), false);
  for (const id of [...targets.variables].toSorted())
    await observe(await figmaCtx.variables.getVariableByIdAsync(id), false);
  for (const id of [...targets.collections].toSorted())
    await observe(await figmaCtx.variables.getVariableCollectionByIdAsync(id), false);
  /* eslint-enable no-await-in-loop */
  return stable(observed);
};

/** The one dispatcher consumes this private outcome; JSON-shaped read results cannot request Undo. */
export const settleHandlerOutcome = (input: unknown): unknown => {
  if (input === null || typeof input !== 'object') return input;
  const entry = outcomes.get(input);
  if (entry === undefined) return input;
  entry.settle();
  return entry.outcome.value;
};
export const settleHandlerFailure = (input: unknown): boolean | 'unknown' | null => {
  if (input === null || typeof input !== 'object') return null;
  const entry = failures.get(input);
  if (entry === undefined) return null;
  entry.settle();
  return entry.mutated;
};

/**
 * Closed per-tool contracts yield an explicit outcome; the idempotency cache retains its Undo
 * claim.
 */
export const withMutationOutcome = (
  figmaCtx: typeof figma,
  name: string,
  handler: SandboxToolHandler,
): SandboxToolHandler => {
  const contract = MUTATION_CONTRACTS[name] ?? SYSTEM_MUTATION_CONTRACTS[name];
  if (contract === undefined) throw new Error(`MUTATION_CONTRACT_MISSING: ${name}`);
  return async (params: unknown, context?: Readonly<SandboxExecutionContext>) => {
    context?.signal.throwIfAborted();
    const targets = targetsFor(figmaCtx, name, params);
    const before = contract === 'ui' ? '' : await capture(figmaCtx, targets);
    let marked = false;
    const execution: Readonly<SandboxExecutionContext> = {
      ...(context?.requestId === undefined ? {} : { requestId: context.requestId }),
      signal: context?.signal ?? createSandboxCancellation().signal,
      report: progress => context?.report(progress),
      markMutated: () => {
        marked = true;
        context?.markMutated?.();
      },
    };
    let committed = false;
    let commitError: Error | undefined;
    const claim = (mutated: boolean | 'unknown') => () => {
      if (commitError !== undefined) throw commitError;
      if (mutated === false || committed) return;
      committed = true;
      try {
        figmaCtx.commitUndo();
      } catch (cause) {
        commitError = Object.assign(
          new Error('UNDO_FAILED: cannot establish the undo boundary', { cause }),
          { code: 'UNDO_FAILED' },
        );
        failures.set(commitError, { mutated, settle: () => {} });
        throw commitError;
      }
    };
    try {
      context?.signal.throwIfAborted();
      const value = await handler(params, execution);
      const mutated =
        marked ||
        contract === 'create' ||
        (contract !== 'ui' && before !== (await capture(figmaCtx, targets)));
      const outcome: PluginHandlerOutcome = Object.freeze({ value, mutated });
      outcomes.set(outcome, { outcome, settle: claim(mutated) });
      return outcome;
    } catch (cause) {
      let mutated: boolean | 'unknown';
      try {
        const changed = contract !== 'ui' && before !== (await capture(figmaCtx, targets));
        const restored =
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          cause.code === 'BATCH_ROLLED_BACK';
        mutated = changed || (!restored && marked);
      } catch {
        mutated = 'unknown';
      }
      const error = cause instanceof Error ? cause : new Error(String(cause));
      failures.set(error, { mutated, settle: claim(mutated) });
      throw error;
    }
  };
};
