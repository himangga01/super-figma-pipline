import { createHash } from 'node:crypto';

import { z } from 'zod';

import { cloneNodeTool } from '../../mcp/src/tools/clone-node.js';
import { createFrameTool } from '../../mcp/src/tools/create-frame.js';
import { getNodeTool } from '../../mcp/src/tools/get-node.js';
import { renameNodeTool } from '../../mcp/src/tools/rename-node.js';
import { setPositionTool } from '../../mcp/src/tools/set-position.js';
import type { RawToolSpec } from '../../mcp/src/tools/spec.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import { RESULT_SCHEMAS } from '../../shared/src/result-schemas.js';

export const recipeError = (code: string): Error => Object.assign(new Error(code), { code });
export const recipeCanonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(recipeCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${recipeCanonical(child)}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw recipeError('RECIPE_NON_JSON');
  return encoded;
};
export const recipeHash = (value: unknown, domain?: string): `sha256:${string}` => {
  const digest = createHash('sha256');
  if (domain !== undefined) digest.update(domain).update('\0');
  return `sha256:${digest.update(recipeCanonical(value)).digest('hex')}`;
};
export const RECIPE_TOOLS: Readonly<
  Record<'create_frame' | 'clone_node' | 'rename_node' | 'set_position' | 'get_node', RawToolSpec>
> = Object.freeze({
  create_frame: createFrameTool,
  clone_node: cloneNodeTool,
  rename_node: renameNodeTool,
  set_position: setPositionTool,
  get_node: getNodeTool,
});
const id = z.string().min(1).max(256);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const RecipeReferenceSchema = z.object({ stepId: id, field: z.literal('nodeId') }).strict();
const nodeId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^I?\d+:\d+(;I?\d+:\d+)*$/u);
const nodeTarget = z.union([nodeId, RecipeReferenceSchema]);
const assertions = z
  .object({
    name: z.string().max(4096).optional(),
    type: id.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    parentId: nodeTarget.nullable().optional(),
    subtreeHash: hash.optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'A read requires concrete invariants');
const stepBase = {
  id,
  bindings: z
    .array(
      z
        .object({ argument: z.enum(['nodeId', 'parentId']), result: RecipeReferenceSchema })
        .strict(),
    )
    .max(2)
    .default([]),
};
export const ExecutableRecipeStepSchema = z.discriminatedUnion('tool', [
  z
    .object({
      ...stepBase,
      tool: z.literal('set_position'),
      args: setPositionTool.inputSchema.partial({ nodeId: true }).strict(),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      tool: z.literal('create_frame'),
      postimageHash: hash,
      args: createFrameTool.inputSchema.strict(),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      tool: z.literal('clone_node'),
      postimageHash: hash,
      args: cloneNodeTool.inputSchema.partial().strict(),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      tool: z.literal('rename_node'),
      args: renameNodeTool.inputSchema.partial({ nodeId: true }).strict(),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      tool: z.literal('get_node'),
      args: getNodeTool.inputSchema.partial().strict(),
      expect: assertions,
    })
    .strict(),
]);
export const RecipeAuthoritySchema = z
  .object({
    actorId: id,
    authSessionId: id,
    workspaceId: z.string().uuid(),
    sessionId: id,
    leaderGeneration: id,
    pluginGenerationHash: hash,
    fileIdentityHash: hash,
    targetBindingHash: hash,
    credentialHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
/** Deliberately separate from the upstream catalog's planned, argument-free skeletons. */
export const ExecutableRecipeSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!isBoundedDesignJson(value, 262144, 20000))
      ctx.addIssue({ code: 'custom', message: 'RECIPE_INPUT_LIMIT' });
  })
  .pipe(
    z
      .object({
        version: z.literal(1),
        execution: z.literal('concrete-owner-client'),
        intentId: id,
        authority: RecipeAuthoritySchema,
        steps: z.array(ExecutableRecipeStepSchema).min(3).max(128),
      })
      .strict()
      .superRefine((plan, ctx) => {
        const prior = new Map<string, z.infer<typeof ExecutableRecipeStepSchema>>();
        for (const step of plan.steps) {
          if (step.id.startsWith('sfp_internal:'))
            ctx.addIssue({ code: 'custom', message: 'Reserved step ID' });
          if (prior.has(step.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate step' });
          const used = new Set<string>();
          for (const binding of step.bindings) {
            const producer = prior.get(binding.result.stepId);
            if (
              !producer ||
              producer.tool === 'get_node' ||
              used.has(binding.argument) ||
              Object.hasOwn(step.args, binding.argument) ||
              (binding.argument === 'parentId'
                ? step.tool !== 'create_frame'
                : step.tool === 'create_frame')
            )
              ctx.addIssue({ code: 'custom', message: 'Invalid closed backward reference' });
            used.add(binding.argument);
          }
          const dummy = {
            ...step.args,
            ...Object.fromEntries(step.bindings.map(b => [b.argument, '1:1'])),
          };
          for (const field of ['nodeId', 'parentId']) {
            if (
              Object.hasOwn(dummy, field) &&
              !nodeId.safeParse((dummy as Record<string, unknown>)[field]).success
            )
              ctx.addIssue({ code: 'custom', message: 'Concrete node IDs are required' });
          }
          if (!RECIPE_TOOLS[step.tool].inputSchema.safeParse(dummy).success)
            ctx.addIssue({ code: 'custom', message: 'Incomplete canonical arguments' });
          if (step.tool === 'create_frame' && !Object.hasOwn(dummy, 'parentId'))
            ctx.addIssue({ code: 'custom', message: 'Creation requires an explicit parent' });
          if (
            step.tool === 'get_node' &&
            typeof step.expect.parentId === 'object' &&
            step.expect.parentId !== null &&
            (!prior.has(step.expect.parentId.stepId) ||
              prior.get(step.expect.parentId.stepId)?.tool === 'get_node')
          )
            ctx.addIssue({ code: 'custom', message: 'Invalid assertion reference' });
          prior.set(step.id, step);
        }
        if (
          plan.steps[0]?.tool !== 'get_node' ||
          plan.steps[0].expect.subtreeHash === undefined ||
          plan.steps.at(-1)?.tool !== 'get_node' ||
          !plan.steps.some(step => step.tool !== 'get_node')
        )
          ctx.addIssue({
            code: 'custom',
            message: 'A source preimage, write and final readback are required',
          });
        // Readback follows the actual target through nodeId-returning mutations, never a guessed ID.
        const targetIdentity = (stepId: string, visited = new Set<string>()): string | null => {
          if (visited.has(stepId)) return null;
          visited.add(stepId);
          const step = prior.get(stepId);
          if (!step) return null;
          if (step.tool === 'create_frame' || step.tool === 'clone_node')
            return JSON.stringify(['created', step.id]);
          const literal = (step.args as { nodeId?: string }).nodeId;
          if (literal !== undefined) return JSON.stringify(['literal', literal]);
          const ref = step.bindings.find(binding => binding.argument === 'nodeId');
          return ref ? targetIdentity(ref.result.stepId, visited) : null;
        };
        const lastWrite = plan.steps.findLastIndex(step => step.tool !== 'get_node');
        for (const write of plan.steps.filter(step => step.tool !== 'get_node')) {
          const target = targetIdentity(write.id);
          if (
            target === null ||
            !plan.steps
              .slice(lastWrite + 1)
              .some(read => read.tool === 'get_node' && targetIdentity(read.id) === target)
          )
            ctx.addIssue({ code: 'custom', message: 'Each written target needs final readback' });
        }
      }),
  );
export type ExecutableRecipe = z.infer<typeof ExecutableRecipeSchema>;
export type RecipeStep = ExecutableRecipe['steps'][number];
export const resolveRecipeReference = (
  reference: z.infer<typeof RecipeReferenceSchema>,
  outputs: ReadonlyMap<string, unknown>,
): string => {
  const result = outputs.get(reference.stepId);
  if (result === null || typeof result !== 'object' || !Object.hasOwn(result, 'nodeId'))
    throw recipeError('RECIPE_RESULT_REFERENCE_UNAVAILABLE');
  return nodeId.parse((result as { nodeId: unknown }).nodeId);
};
export const resolveRecipeArgs = (step: RecipeStep, outputs: ReadonlyMap<string, unknown>) =>
  RECIPE_TOOLS[step.tool].inputSchema.parse({
    ...step.args,
    ...Object.fromEntries(
      step.bindings.map(binding => [
        binding.argument,
        resolveRecipeReference(binding.result, outputs),
      ]),
    ),
  });
export const recipeResultSchemaHash = (tool: RecipeStep['tool']) =>
  recipeHash(RESULT_SCHEMAS[tool]!.toJSONSchema(), 'sfp-result-schema-v1');
export const assertRecipeReadback = (
  step: RecipeStep,
  args: unknown,
  result: unknown,
  outputs: ReadonlyMap<string, unknown>,
): void => {
  if (step.tool !== 'get_node') return;
  const node = (result as { node: Record<string, unknown> | null }).node;
  if (!node || node.id !== (args as { nodeId: string }).nodeId)
    throw recipeError('RECIPE_READBACK_NODE_MISMATCH');
  for (const [field, value] of Object.entries(step.expect)) {
    const actual = field === 'subtreeHash' ? recipeHash(node) : node[field];
    const expected =
      field === 'parentId' && value !== null && typeof value === 'object'
        ? resolveRecipeReference(value as z.infer<typeof RecipeReferenceSchema>, outputs)
        : value;
    if (actual !== expected) throw recipeError('RECIPE_READBACK_FAILED');
  }
};

/**
 * Full guarded source state; only structural identity fields are normalized for a planned new
 * subtree.
 */
export type RecipeSourceNode = Record<string, unknown> & {
  id: string;
  parentId: string | null;
  children?: RecipeSourceNode[];
};
export function recipeSourceNodes(root: RecipeSourceNode): Map<string, RecipeSourceNode> {
  const rows = new Map<string, RecipeSourceNode>();
  const stack: Array<{ node: RecipeSourceNode; parent?: string }> = [{ node: root }];
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    if (
      !node ||
      !nodeId.safeParse(node.id).success ||
      rows.has(node.id) ||
      (parent !== undefined && node.parentId !== parent) ||
      (node.children !== undefined && !Array.isArray(node.children))
    )
      throw recipeError('RECIPE_SOURCE_TREE_INVALID');
    rows.set(node.id, node);
    if (rows.size > 100000) throw recipeError('RECIPE_SOURCE_TREE_LIMIT');
    for (const child of node.children ?? []) stack.push({ node: child, parent: node.id });
  }
  return rows;
}
export function recipeProducedSubtreeHash(root: RecipeSourceNode): string {
  recipeSourceNodes(root);
  const copy = structuredClone(root),
    stack = [copy];
  while (stack.length) {
    const item = stack.pop()!;
    delete (item as Record<string, unknown>).id;
    delete (item as Record<string, unknown>).parentId;
    stack.push(...(item.children ?? []));
  }
  return recipeHash(copy, 'sfp-recipe-produced-subtree-v1');
}
export function requireRecipeSourceNode(
  root: RecipeSourceNode,
  targetId: string,
): RecipeSourceNode {
  const found = recipeSourceNodes(root).get(targetId);
  if (!found) throw recipeError('RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE');
  return found;
}
export function assertRecipeMutationCoverage(
  root: RecipeSourceNode,
  step: RecipeStep,
  args: Record<string, unknown>,
): void {
  if (step.tool === 'get_node') return;
  const target = requireRecipeSourceNode(
    root,
    String(step.tool === 'create_frame' ? args.parentId : args.nodeId),
  );
  const parent =
    step.tool === 'create_frame'
      ? target
      : step.tool === 'clone_node' && target.parentId !== null
        ? requireRecipeSourceNode(root, target.parentId)
        : undefined;
  if (parent && (parent.layout !== undefined || !['FRAME', 'PAGE'].includes(String(parent.type))))
    throw recipeError('RECIPE_PARENT_TRANSITION_UNSUPPORTED');
  if (step.tool === 'create_frame' && !Array.isArray(target.children))
    throw recipeError('RECIPE_SOURCE_CHILDREN_UNOBSERVED');
  if (step.tool === 'set_position') {
    if (target.parentId === null) throw recipeError('RECIPE_POSITION_PARENT_UNOBSERVED');
    const positionParent = requireRecipeSourceNode(root, target.parentId);
    if (
      positionParent.layout !== undefined ||
      !['FRAME', 'PAGE'].includes(String(positionParent.type)) ||
      typeof target.x !== 'number' ||
      typeof target.y !== 'number'
    )
      throw recipeError('RECIPE_POSITION_TRANSITION_UNSUPPORTED');
  }
  if (step.tool === 'clone_node') {
    if (target.parentId === null) throw recipeError('RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE');
    if (!Array.isArray(requireRecipeSourceNode(root, target.parentId).children))
      throw recipeError('RECIPE_SOURCE_CHILDREN_UNOBSERVED');
  }
}
/** Deterministic existing-tree edits plus a predeclared complete new-subtree postimage. */
export function reconcileRecipeMutation(
  before: RecipeSourceNode,
  observed: RecipeSourceNode,
  step: RecipeStep,
  args: Record<string, unknown>,
  result: unknown,
): RecipeSourceNode {
  assertRecipeMutationCoverage(before, step, args);
  const expected = structuredClone(before),
    oldNodes = recipeSourceNodes(before),
    newNodes = recipeSourceNodes(observed);
  const receipt = result as { nodeId: string; name?: string; type?: string };
  if (step.tool === 'set_position') {
    if (receipt.nodeId !== args.nodeId) throw recipeError('RECIPE_MUTATION_RESULT_MISMATCH');
    const target = requireRecipeSourceNode(expected, String(args.nodeId));
    for (const field of ['x', 'y']) if (Object.hasOwn(args, field)) target[field] = args[field];
  } else if (step.tool === 'rename_node') {
    if (receipt.nodeId !== args.nodeId) throw recipeError('RECIPE_MUTATION_RESULT_MISMATCH');
    requireRecipeSourceNode(expected, String(args.nodeId)).name = args.name;
  } else if (step.tool === 'create_frame' || step.tool === 'clone_node') {
    const produced = newNodes.get(receipt.nodeId);
    if (
      !produced ||
      oldNodes.has(receipt.nodeId) ||
      produced.name !== receipt.name ||
      produced.type !== receipt.type ||
      recipeProducedSubtreeHash(produced) !== step.postimageHash ||
      [...recipeSourceNodes(produced).keys()].some(producedId => oldNodes.has(producedId))
    )
      throw recipeError('RECIPE_PRODUCED_POSTIMAGE_MISMATCH');
    const parentId =
      step.tool === 'create_frame'
        ? String(args.parentId)
        : requireRecipeSourceNode(before, String(args.nodeId)).parentId!;
    if (produced.parentId !== parentId) throw recipeError('RECIPE_PRODUCED_POSTIMAGE_MISMATCH');
    const parent = requireRecipeSourceNode(expected, parentId);
    if (!Array.isArray(parent.children)) throw recipeError('RECIPE_SOURCE_CHILDREN_UNOBSERVED');
    if (step.tool === 'create_frame') {
      if (produced.type !== 'FRAME' || (produced.children?.length ?? 0) !== 0)
        throw recipeError('RECIPE_PRODUCED_POSTIMAGE_MISMATCH');
      for (const field of ['name', 'x', 'y', 'width', 'height']) {
        if (Object.hasOwn(args, field) && produced[field] !== args[field])
          throw recipeError('RECIPE_PRODUCED_POSTIMAGE_MISMATCH');
      }
      parent.children.push(structuredClone(produced));
    } else {
      const position = parent.children.findIndex(child => child.id === args.nodeId);
      if (position < 0) throw recipeError('RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE');
      // The canonical handler explicitly appends, including when the source is not last.
      parent.children.push(structuredClone(produced));
    }
  } else throw recipeError('RECIPE_MUTATION_UNSUPPORTED');
  if (recipeHash(expected) !== recipeHash(observed)) throw recipeError('RECIPE_SOURCE_CHANGED');
  return expected;
}
