import { isBoundedDesignJson } from '@sfp/shared';
import { z } from 'zod';

import { OPERATION_POLICIES } from '../../mcp/src/policy/operation-policy.js';
import { coreHash, freezeCore } from '../../mcp/src/portal/recipes/core-source.js';
import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';
import { deriveRecipePalette, deriveRecipeTypeScale } from './recipe-design-system.js';
import { recipePadding, recipeSolidPaint } from './recipe-helpers.js';
import {
  ExecutableRecipeSchema,
  recipeHash,
  recipeProducedSubtreeHash,
  requireRecipeSourceNode,
  type ExecutableRecipe,
  type RecipeSourceNode,
} from './recipe-plan.js';

const bounded = (value: unknown, maxBytes: number, maxValues: number): boolean =>
  isBoundedDesignJson(value, maxBytes, maxValues);
const canonical = new Map(ALL_TOOL_SPECS.map(spec => [spec.name, spec]));
const closedTools = [
  'get_node',
  'get_variable_defs',
  'get_styles',
  'get_fonts',
  'get_node_motion',
  'clone_node',
  'create_frame',
  'rename_node',
  'set_position',
  'resize_nodes',
  'set_auto_layout',
  'set_layout_props',
  'set_fills',
  'set_strokes',
  'set_corner_radius',
  'set_text',
  'set_text_range',
  'set_text_properties',
  'set_instance_properties',
  'create_instance',
  'swap_component',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'import_library_variable',
  'bind_variable_to_paint',
  'bind_variable_to_node',
  'create_text_style',
  'create_paint_style',
  'apply_manual_keyframe_track',
  'apply_animation_style',
  'export_pdf',
  'export_frames_to_pdf',
  'export_tokens',
  'combine_as_variants',
] as const;
type Tool = (typeof closedTools)[number];
const outputs: Partial<Record<Tool, readonly string[]>> = {
  create_frame: ['nodeId'],
  clone_node: ['nodeId'],
  create_instance: ['nodeId'],
  create_variable_collection: ['collectionId', 'defaultModeId'],
  add_variable_mode: ['modeId'],
  create_variable: ['variableId'],
  import_library_variable: ['id', 'collectionId'],
  create_text_style: ['styleId'],
  create_paint_style: ['styleId'],
  combine_as_variants: ['nodeId'],
};
export interface CompositionBinding {
  argument:
    | 'nodeId'
    | 'nodeIds'
    | 'parentId'
    | 'instanceId'
    | 'collectionId'
    | 'variableId'
    | 'modeId'
    | 'aliasValue';
  stepId: string;
  field: 'nodeId' | 'variableId' | 'id' | 'collectionId' | 'defaultModeId' | 'modeId';
}
export interface CompositionStep {
  id: string;
  tool: Tool;
  args: Record<string, unknown>;
  bindings: CompositionBinding[];
}
export interface PlannedComposition {
  version: 1;
  execution: 'planned';
  family: string;
  sourceHash: string;
  steps: CompositionStep[];
  prerequisites: string[];
  possibleEffects: unknown[];
  hash: string;
}
const BindingSchema = z
  .object({
    argument: z.enum([
      'nodeId',
      'nodeIds',
      'parentId',
      'instanceId',
      'collectionId',
      'variableId',
      'modeId',
      'aliasValue',
    ]),
    stepId: z.string().min(1).max(256),
    field: z.enum(['nodeId', 'variableId', 'id', 'collectionId', 'defaultModeId', 'modeId']),
  })
  .strict();
const CompositionStepSchema = z
  .object({
    id: z.string().min(1).max(256),
    tool: z.enum(closedTools),
    args: z.record(z.string(), z.unknown()),
    bindings: z.array(BindingSchema).max(16),
  })
  .strict();
const ref = (
  argument: CompositionBinding['argument'],
  stepId: string,
  field: CompositionBinding['field'] = 'nodeId',
): CompositionBinding => ({ argument, stepId, field });
const step = (
  id: string,
  tool: Tool,
  args: Record<string, unknown>,
  bindings: CompositionBinding[] = [],
): CompositionStep => ({ id, tool, args, bindings });
const boundArgument = (binding: CompositionBinding, value: string) =>
  binding.argument === 'aliasValue'
    ? { value: { type: 'VARIABLE_ALIAS', id: value } }
    : { [binding.argument]: binding.argument === 'nodeIds' ? [value] : value };
/**
 * Closed field references only; actual canonical schemas validate concrete arguments again at
 * execution.
 */
export function resolveCompositionStep(
  operation: CompositionStep,
  results: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  if (!bounded(operation, 1048576, 30000)) throw new Error('COMPOSITION_INPUT_LIMIT');
  operation = CompositionStepSchema.parse(operation);
  const args = { ...operation.args };
  for (const binding of operation.bindings) {
    const result = results.get(binding.stepId);
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof (result as Record<string, unknown>)[binding.field] !== 'string'
    )
      throw new Error('COMPOSITION_RESULT_UNAVAILABLE');
    Object.assign(args, boundArgument(binding, (result as Record<string, string>)[binding.field]!));
  }
  const tool = canonical.get(operation.tool);
  if (!tool) throw new Error('COMPOSITION_TOOL_UNAVAILABLE');
  return tool.inputSchema.strict().parse(args) as Record<string, unknown>;
}
export function validateComposition(input: {
  family: string;
  sourceHash: string;
  steps: CompositionStep[];
  prerequisites?: string[];
}): PlannedComposition {
  if (!bounded(input, 1048576, 30000) || input.steps.length < 1 || input.steps.length > 128)
    throw new Error('COMPOSITION_INPUT_LIMIT');
  z.string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .parse(input.sourceHash);
  z.string().min(1).max(256).parse(input.family);
  input = { ...input, steps: input.steps.map(operation => CompositionStepSchema.parse(operation)) };
  const previous = new Map<string, CompositionStep>();
  for (const operation of input.steps) {
    if (
      !closedTools.includes(operation.tool) ||
      !operation.id ||
      operation.id.length > 256 ||
      previous.has(operation.id) ||
      operation.bindings.length > 16
    )
      throw new Error('COMPOSITION_STEP_INVALID');
    const assigned = new Set<string>();
    for (const binding of operation.bindings) {
      const producer = previous.get(binding.stepId),
        argument = binding.argument === 'aliasValue' ? 'value' : binding.argument;
      if (
        !producer ||
        !outputs[producer.tool]?.includes(binding.field) ||
        assigned.has(argument) ||
        Object.hasOwn(operation.args, argument)
      )
        throw new Error('COMPOSITION_REFERENCE_INVALID');
      const compatible =
        binding.argument === 'nodeId' ||
        binding.argument === 'nodeIds' ||
        binding.argument === 'parentId' ||
        binding.argument === 'instanceId'
          ? binding.field === 'nodeId'
          : binding.argument === 'variableId' || binding.argument === 'aliasValue'
            ? ['variableId', 'id'].includes(binding.field)
            : binding.argument === 'collectionId'
              ? binding.field === 'collectionId'
              : ['modeId', 'defaultModeId'].includes(binding.field);
      if (!compatible) throw new Error('COMPOSITION_REFERENCE_TYPE_INVALID');
      assigned.add(argument);
    }
    const placeholders = new Map(
      operation.bindings.map(binding => [
        binding.stepId,
        Object.fromEntries(
          operation.bindings
            .filter(other => other.stepId === binding.stepId)
            .map(other => [other.field, '1:1']),
        ),
      ]),
    );
    resolveCompositionStep(operation, placeholders);
    previous.set(operation.id, operation);
  }
  const possibleEffects = [
    ...new Map(
      input.steps
        .flatMap(operation => OPERATION_POLICIES[operation.tool]!.possibleEffects)
        .map(effect => [coreHash(effect), effect]),
    ).values(),
  ];
  const body = {
    version: 1 as const,
    execution: 'planned' as const,
    family: input.family,
    sourceHash: input.sourceHash,
    steps: input.steps,
    prerequisites: input.prerequisites ?? [],
    possibleEffects,
  };
  return freezeCore({ ...body, hash: coreHash(body) });
}
/** This subset is genuinely executable through the existing retained scene runner. */
export function composeCloneAdjacent(input: {
  authority: ExecutableRecipe['authority'];
  intentId: string;
  source: RecipeSourceNode;
  nodeId: string;
  direction?: 'left' | 'right' | 'up' | 'down';
  gap?: number;
  name?: string;
}): ExecutableRecipe {
  if (!bounded(input, 8388608, 200000)) throw new Error('COMPOSITION_INPUT_LIMIT');
  const source = requireRecipeSourceNode(input.source, input.nodeId),
    geometry = z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        parentId: z.string(),
      })
      .parse(source),
    gap = z
      .number()
      .min(0)
      .parse(input.gap ?? 100),
    direction = z.enum(['left', 'right', 'up', 'down']).parse(input.direction ?? 'right');
  const x =
      geometry.x +
      (direction === 'right'
        ? geometry.width + gap
        : direction === 'left'
          ? -geometry.width - gap
          : 0),
    y =
      geometry.y +
      (direction === 'down'
        ? geometry.height + gap
        : direction === 'up'
          ? -geometry.height - gap
          : 0);
  return ExecutableRecipeSchema.parse({
    version: 1,
    execution: 'concrete-owner-client',
    intentId: input.intentId,
    authority: input.authority,
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: input.source.id },
        expect: { subtreeHash: recipeHash(input.source) },
      },
      {
        id: 'clone',
        tool: 'clone_node',
        args: { nodeId: input.nodeId },
        postimageHash: recipeProducedSubtreeHash(source),
      },
      {
        id: 'position',
        tool: 'set_position',
        args: { x, y },
        bindings: [{ argument: 'nodeId', result: { stepId: 'clone', field: 'nodeId' } }],
      },
      ...(input.name === undefined
        ? []
        : [
            {
              id: 'name',
              tool: 'rename_node',
              args: { name: input.name },
              bindings: [{ argument: 'nodeId', result: { stepId: 'position', field: 'nodeId' } }],
            },
          ]),
      {
        id: 'after',
        tool: 'get_node',
        args: {},
        bindings: [
          {
            argument: 'nodeId',
            result: { stepId: input.name === undefined ? 'position' : 'name', field: 'nodeId' },
          },
        ],
        expect: { name: input.name ?? source.name, x, y, parentId: geometry.parentId },
      },
    ],
  });
}
export function composeRenameNodes(input: {
  authority: ExecutableRecipe['authority'];
  intentId: string;
  source: RecipeSourceNode;
  names: Array<{ nodeId: string; name: string }>;
}): ExecutableRecipe {
  if (
    !bounded(input, 8388608, 200000) ||
    input.names.length < 1 ||
    input.names.length > 32 ||
    new Set(input.names.map(row => row.nodeId)).size !== input.names.length
  )
    throw new Error('COMPOSITION_INPUT_LIMIT');
  for (const row of input.names) {
    const source = requireRecipeSourceNode(input.source, row.nodeId);
    if (['COMPONENT', 'COMPONENT_SET', 'PAGE', 'DOCUMENT'].includes(String(source.type)))
      throw new Error('COMPOSITION_MASTER_RENAME_REQUIRES_SEPARATE_PLAN');
  }
  return ExecutableRecipeSchema.parse({
    version: 1,
    execution: 'concrete-owner-client',
    intentId: input.intentId,
    authority: input.authority,
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: input.source.id },
        expect: { subtreeHash: recipeHash(input.source) },
      },
      ...input.names.map((row, index) => ({
        id: `rename-${index}`,
        tool: 'rename_node',
        args: { nodeId: row.nodeId, name: row.name },
      })),
      ...input.names.map((row, index) => ({
        id: `after-${index}`,
        tool: 'get_node',
        args: { nodeId: row.nodeId },
        expect: { name: row.name },
      })),
    ],
  });
}
export function composeFrame(input: {
  sourceHash: string;
  parentId: string;
  name: string;
  layout?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  width?: number;
  height?: number;
  initialSize?: { width: number; height: number };
  hug?: boolean;
  spacing?: number;
  padding?: Parameters<typeof recipePadding>[0];
  fill?: string | false;
  radius?: number;
}) {
  const operations: CompositionStep[] = [
      step('create', 'create_frame', { parentId: input.parentId, name: input.name }),
    ],
    layout = input.layout ?? 'NONE';
  if (layout !== 'NONE')
    operations.push(
      step('layout', 'set_auto_layout', { layoutMode: layout }, [ref('nodeId', 'create')]),
    );
  if (input.width !== undefined || input.height !== undefined) {
    const width = input.width ?? input.initialSize?.width,
      height = input.height ?? input.initialSize?.height;
    if (width === undefined || height === undefined)
      throw new Error('COMPOSITION_INITIAL_SIZE_REQUIRED_FOR_UNSPECIFIED_AXIS');
    operations.push(step('size', 'resize_nodes', { width, height }, [ref('nodeIds', 'create')]));
  }
  if (layout !== 'NONE') {
    operations.push(
      step(
        'sizing',
        'set_layout_props',
        {
          layoutSizingHorizontal:
            input.width === undefined && input.hug !== false ? 'HUG' : 'FIXED',
          layoutSizingVertical: input.height === undefined && input.hug !== false ? 'HUG' : 'FIXED',
        },
        [ref('nodeId', 'create')],
      ),
    );
    const padding = recipePadding(input.padding);
    if (padding !== undefined || input.spacing !== undefined)
      operations.push(
        step(
          'spacing',
          'set_auto_layout',
          {
            layoutMode: layout,
            ...(input.spacing === undefined ? {} : { itemSpacing: input.spacing }),
            ...(padding === undefined
              ? {}
              : {
                  paddingTop: padding.top,
                  paddingRight: padding.right,
                  paddingBottom: padding.bottom,
                  paddingLeft: padding.left,
                }),
          },
          [ref('nodeId', 'create')],
        ),
      );
  }
  if (input.fill !== undefined)
    operations.push(
      step(
        'fill',
        'set_fills',
        { fills: input.fill === false ? [] : recipeSolidPaint(input.fill) },
        [ref('nodeId', 'create')],
      ),
    );
  if (input.radius !== undefined)
    operations.push(
      step('radius', 'set_corner_radius', { radius: input.radius }, [ref('nodeId', 'create')]),
    );
  operations.push(step('readback', 'get_node', {}, [ref('nodeId', 'create')]));
  return validateComposition({
    family: 'assemble-frame',
    sourceHash: input.sourceHash,
    steps: operations,
    prerequisites: ['PREDECLARED_CREATION_AND_LAYOUT_TRANSITIONS'],
  });
}
export function composePalette(input: {
  sourceHash: string;
  namespace: string;
  palette: ReturnType<typeof deriveRecipePalette>;
}) {
  z.string().min(1).max(128).parse(input.namespace);
  const palette = input.palette;
  const operations: CompositionStep[] = [
    step('before', 'get_variable_defs', {}),
    step('primitives', 'create_variable_collection', { name: input.namespace + '/Primitives' }),
  ];
  const primitiveIds = new Map<string, string>();
  for (const [index, primitive] of palette.primitives.entries()) {
    const id = `primitive-${index}`;
    primitiveIds.set(primitive.name, id);
    operations.push(
      step(id, 'create_variable', { name: primitive.name, resolvedType: 'COLOR' }, [
        ref('collectionId', 'primitives', 'collectionId'),
      ]),
    );
    operations.push(
      step(`${id}-value`, 'set_variable_value', { value: primitive.value }, [
        ref('variableId', id, 'variableId'),
        ref('modeId', 'primitives', 'defaultModeId'),
      ]),
    );
  }
  const roles = palette.modeRoles;
  if (palette.modeStrategy === 'single-collection') {
    operations.push(
      step('semantic', 'create_variable_collection', {
        name: input.namespace + '/Semantic Colors',
      }),
    );
    if (roles.includes('Dark'))
      operations.push(
        step('dark', 'add_variable_mode', { name: 'Dark' }, [
          ref('collectionId', 'semantic', 'collectionId'),
        ]),
      );
    for (const [index, alias] of palette.aliases.entries()) {
      const id = `alias-${index}`;
      operations.push(
        step(id, 'create_variable', { name: alias.name, resolvedType: 'COLOR' }, [
          ref('collectionId', 'semantic', 'collectionId'),
        ]),
      );
      for (const role of roles) {
        const value = alias.values[role as 'Light' | 'Dark'];
        if (!value) throw new Error('COMPOSITION_ALIAS_MISSING');
        const primitive = primitiveIds.get(value.name);
        if (!primitive) throw new Error('COMPOSITION_ALIAS_MISSING');
        operations.push(
          step(`${id}-${role}`, 'set_variable_value', {}, [
            ref('variableId', id, 'variableId'),
            ref(
              'modeId',
              role === 'Dark' ? 'dark' : 'semantic',
              role === 'Dark' ? 'modeId' : 'defaultModeId',
            ),
            ref('aliasValue', primitive, 'variableId'),
          ]),
        );
      }
    }
  } else
    for (const role of roles) {
      const collection = `semantic-${role}`;
      operations.push(
        step(collection, 'create_variable_collection', {
          name: input.namespace + '/Semantic Colors/' + role,
        }),
      );
      for (const [index, alias] of palette.aliases.entries()) {
        const id = `alias-${role}-${index}`,
          value = alias.values[role as 'Light' | 'Dark'];
        if (!value) throw new Error('COMPOSITION_ALIAS_MISSING');
        const primitive = primitiveIds.get(value.name);
        if (!primitive) throw new Error('COMPOSITION_ALIAS_MISSING');
        operations.push(
          step(id, 'create_variable', { name: alias.name, resolvedType: 'COLOR' }, [
            ref('collectionId', collection, 'collectionId'),
          ]),
        );
        operations.push(
          step(`${id}-value`, 'set_variable_value', {}, [
            ref('variableId', id, 'variableId'),
            ref('modeId', collection, 'defaultModeId'),
            ref('aliasValue', primitive, 'variableId'),
          ]),
        );
      }
    }
  operations.push(step('readback', 'get_variable_defs', {}));
  return validateComposition({
    family: 'author-palette',
    sourceHash: input.sourceHash,
    steps: operations,
    prerequisites: ['EXACT_CATALOG_NAMESPACE_AND_TRANSITION_GUARDS', ...palette.prerequisites],
  });
}
export function composeTypeScale(input: {
  sourceHash: string;
  scale: ReturnType<typeof deriveRecipeTypeScale>;
}) {
  if (input.scale.status !== 'ready-to-plan') throw new Error('COMPOSITION_TYPE_SCALE_BLOCKED');
  const operations: CompositionStep[] = [
    step('fonts', 'get_fonts', { available: true }),
    step('before', 'get_styles', {}),
  ];
  for (const [index, row] of input.scale.rows.entries())
    if (row.status === 'create')
      operations.push(step(`style-${index}`, 'create_text_style', row.args));
  operations.push(step('readback', 'get_styles', {}));
  return validateComposition({
    family: 'author-type-scale',
    sourceHash: input.sourceHash,
    steps: operations,
    prerequisites: ['EXACT_STYLE_CATALOG_GUARDS', 'CANONICAL_FONT_LOAD_PREFLIGHT'],
  });
}
