import { ControlRecipeClient } from './control-recipe-client.js';
import { RecipeCheckpointStore, type RecipeStepIntent } from './recipe-checkpoint.js';
import {
  ExecutableRecipeSchema,
  assertRecipeReadback,
  assertRecipeMutationCoverage,
  recipeError,
  recipeHash,
  recipeResultSchemaHash,
  resolveRecipeArgs,
  recipeSourceNodes,
  reconcileRecipeMutation,
  requireRecipeSourceNode,
  type ExecutableRecipe,
  type RecipeStep,
  type RecipeSourceNode,
} from './recipe-plan.js';

/** Historical receipts rebuild expected state; only newly admitted reads prove present state. */
export async function runOwnerRecipe(
  input: unknown,
  client: ControlRecipeClient,
  checkpoints: RecipeCheckpointStore,
  options: { approve: boolean; signal?: AbortSignal },
): Promise<{
  status: 'succeeded' | 'cancelled';
  planHash: string;
  completedSteps: string[];
  currentReadback?: { operationId: string; receiptHash: string; sourceHash: string };
}> {
  const plan: ExecutableRecipe = ExecutableRecipeSchema.parse(input),
    planHash = recipeHash(plan);
  await checkpoints.initialize(plan);
  const completedSteps: string[] = [],
    outputs = new Map<string, unknown>();
  const verified = new Map<string, { intent: RecipeStepIntent; receiptHash: string }>();
  let source: RecipeSourceNode | undefined;
  const makeIntent = async (
    stepId: string,
    tool: RecipeStep['tool'],
    args: Record<string, unknown>,
  ): Promise<RecipeStepIntent> => ({
    version: 1,
    planHash,
    stepId,
    operationName: tool,
    operationId: await client.control.issueOperationId(),
    argsHash: recipeHash(args, 'sfp-parsed-args-v1'),
    args,
    resultSchemaHash: recipeResultSchemaHash(tool),
  });
  const checkIntent = (
    intent: RecipeStepIntent,
    step: RecipeStep,
    args: Record<string, unknown>,
  ) => {
    if (
      intent.planHash !== planHash ||
      intent.stepId !== step.id ||
      intent.operationName !== step.tool ||
      intent.argsHash !== recipeHash(args, 'sfp-parsed-args-v1') ||
      recipeHash(intent.args, 'sfp-parsed-args-v1') !== intent.argsHash ||
      intent.resultSchemaHash !== recipeResultSchemaHash(step.tool)
    )
      throw recipeError('RECIPE_STEP_INTENT_CHANGED');
  };
  const observation = async (
    postIndex?: number,
  ): Promise<{ node: RecipeSourceNode; intent: RecipeStepIntent; receiptHash: string }> => {
    if (!source) throw recipeError('RECIPE_SOURCE_UNAVAILABLE');
    const args = { nodeId: source.id };
    let intent: RecipeStepIntent, dispatch: boolean;
    if (postIndex === undefined) {
      intent = await checkpoints.freshObservation(plan, id => makeIntent(id, 'get_node', args));
      dispatch = true;
    } else {
      const previous = await checkpoints.postIntent(plan, postIndex);
      if (previous) {
        intent = previous;
        dispatch = false;
      } else {
        const candidate = await makeIntent(`sfp_internal:post:${postIndex}`, 'get_node', args);
        dispatch = await checkpoints.claimPost(plan, postIndex, candidate);
        intent = dispatch ? candidate : (await checkpoints.postIntent(plan, postIndex))!;
      }
    }
    const step: RecipeStep = {
      id: postIndex === undefined ? intent.stepId : `sfp_internal:post:${postIndex}`,
      tool: 'get_node',
      args,
      bindings: [],
      expect: { type: String(source.type) },
    };
    checkIntent(intent, step, args);
    await client.reserve(plan, intent);
    if (options.signal?.aborted || (await checkpoints.cancelled(plan)))
      throw recipeError('RECIPE_CANCELLED');
    if (dispatch) {
      try {
        await client.invoke(plan, step, intent, options);
      } catch {
        /* Inspect this exact read ID. */
      }
    }
    const actual = await client.recover(plan, step, intent),
      node = (actual.result as { node: RecipeSourceNode | null }).node;
    if (!node || node.id !== source.id) throw recipeError('RECIPE_SOURCE_CHANGED');
    recipeSourceNodes(node);
    return { node, intent, receiptHash: actual.receiptHash };
  };
  try {
    /* eslint-disable no-await-in-loop -- dependency, currentness and durable publication order are required */
    for (const [index, step] of plan.steps.entries()) {
      if (options.signal?.aborted) await checkpoints.cancel(plan);
      if (await checkpoints.cancelled(plan))
        return { status: 'cancelled', planHash, completedSteps };
      await client.assertCurrent(plan);
      const dependencies = new Set(step.bindings.map(binding => binding.result.stepId));
      if (step.tool !== 'get_node') dependencies.add(plan.steps[0]!.id);
      if (
        step.tool === 'get_node' &&
        step.expect.parentId !== null &&
        typeof step.expect.parentId === 'object'
      )
        dependencies.add(step.expect.parentId.stepId);
      for (const id of dependencies) {
        const previous = verified.get(id),
          producer = plan.steps.find(row => row.id === id);
        if (!previous || !producer) throw recipeError('RECIPE_DEPENDENCY_MISSING');
        const actual = await client.recover(plan, producer, previous.intent);
        if (actual.receiptHash !== previous.receiptHash)
          throw recipeError('RECIPE_DEPENDENCY_CHANGED');
        outputs.set(id, actual.result);
      }
      const args = resolveRecipeArgs(step, outputs) as Record<string, unknown>;
      if (source) {
        if (step.tool === 'get_node') requireRecipeSourceNode(source, String(args.nodeId));
        else assertRecipeMutationCoverage(source, step, args);
      }
      let intent = await checkpoints.intent(plan, index),
        dispatch = false;
      if (intent === null) {
        if (step.tool !== 'get_node') {
          const current = await observation();
          if (recipeHash(current.node) !== recipeHash(source))
            throw recipeError('RECIPE_SOURCE_CHANGED');
        }
        const candidate = await makeIntent(step.id, step.tool, args);
        dispatch = await checkpoints.claim(plan, index, candidate);
        intent = dispatch ? candidate : await checkpoints.intent(plan, index);
      }
      if (!intent) throw recipeError('RECIPE_STEP_INTENT_CHANGED');
      checkIntent(intent, step, args);
      await client.reserve(plan, intent);
      if (options.signal?.aborted || (await checkpoints.cancelled(plan))) {
        await checkpoints.cancel(plan);
        return { status: 'cancelled', planHash, completedSteps };
      }
      if (dispatch) {
        try {
          await client.invoke(plan, step, intent, options);
        } catch {
          /* Never replace an original write ID. */
        }
      }
      if (options.signal?.aborted) await checkpoints.cancel(plan);
      const actual = await client.recover(plan, step, intent);
      assertRecipeReadback(step, args, actual.result, outputs);
      if (index === 0) {
        source = (actual.result as { node: RecipeSourceNode }).node;
        recipeSourceNodes(source);
        // Every existing literal effect input must be covered before the recipe's first effect.
        // Future generated nodes must be expressed as backward receipt references, never guessed IDs.
        for (const planned of plan.steps) {
          if (planned.tool === 'get_node') continue;
          const field = planned.tool === 'create_frame' ? 'parentId' : 'nodeId';
          if (Object.hasOwn(planned.args, field))
            assertRecipeMutationCoverage(source, planned, planned.args);
        }
      } else if (step.tool !== 'get_node') {
        // The original post-read can rebuild modeled history; it is never the currentness gate.
        // If it is absent after a committed write, a new read must prove the exact planned transition.
        const post = await observation(index);
        source = reconcileRecipeMutation(source!, post.node, step, args, actual.result);
      }
      await checkpoints.settled(plan, index, intent, actual.receiptHash);
      verified.set(step.id, { intent, receiptHash: actual.receiptHash });
      outputs.set(step.id, actual.result);
      completedSteps.push(step.id);
    }
    if (options.signal?.aborted || (await checkpoints.cancelled(plan)))
      return { status: 'cancelled', planHash, completedSteps };
    const final = await observation();
    if (recipeHash(final.node) !== recipeHash(source)) throw recipeError('RECIPE_SOURCE_CHANGED');
    const lastWrite = plan.steps.findLastIndex(step => step.tool !== 'get_node');
    for (const step of plan.steps.slice(lastWrite + 1)) {
      const args = resolveRecipeArgs(step, outputs) as { nodeId: string };
      assertRecipeReadback(
        step,
        args,
        { node: requireRecipeSourceNode(final.node, args.nodeId) },
        outputs,
      );
    }
    return {
      status: 'succeeded',
      planHash,
      completedSteps,
      currentReadback: {
        operationId: final.intent.operationId,
        receiptHash: final.receiptHash,
        sourceHash: recipeHash(final.node),
      },
    };
    /* eslint-enable no-await-in-loop */
  } finally {
    if (options.signal?.aborted) await checkpoints.cancel(plan);
  }
}
