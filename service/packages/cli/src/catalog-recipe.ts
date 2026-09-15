import {
  GetVariableDefsResultSchema,
  VariableInitialValuesSchema,
  toHex,
  type GetVariableDefsResult,
} from '@sfp/shared';
import { z } from 'zod';

import { addVariableModeTool } from '../../mcp/src/tools/add-variable-mode.js';
import { createVariableCollectionTool } from '../../mcp/src/tools/create-variable-collection.js';
import { createVariableTool } from '../../mcp/src/tools/create-variable.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import { RESULT_SCHEMAS } from '../../shared/src/result-schemas.js';
import type { ControlRecipeClient } from './control-recipe-client.js';
import { RecipeCheckpointStore, type RecipeStepIntent } from './recipe-checkpoint.js';
import type { deriveRecipePalette } from './recipe-design-system.js';
import { RecipeAuthoritySchema, recipeCanonical, recipeError, recipeHash } from './recipe-plan.js';

const id = z.string().min(1).max(256);
const identity = z.string().min(1).max(512);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reference = z.strictObject({
  stepId: id,
  field: z.enum(['collectionId', 'defaultModeId', 'modeId', 'variableId']),
});
const target = z.union([identity, reference]);
const scalar = VariableInitialValuesSchema.element.shape.value;
const value = z.union([scalar, z.strictObject({ alias: reference })]);
const stepSchema = z.discriminatedUnion('tool', [
  z.strictObject({
    id,
    tool: z.literal('create_variable_collection'),
    args: z.strictObject({
      name: z.string().min(1).max(256),
      defaultModeName: z.string().min(1).max(256),
    }),
  }),
  z.strictObject({
    id,
    tool: z.literal('add_variable_mode'),
    args: z.strictObject({ name: z.string().min(1).max(256), collectionId: target }),
  }),
  z.strictObject({
    id,
    tool: z.literal('create_variable'),
    args: z.strictObject({
      name: z.string().min(1).max(256),
      resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']),
      collectionId: target,
      initialValues: z
        .array(z.strictObject({ modeId: target, value }))
        .min(1)
        .max(128),
    }),
  }),
]);
type CatalogStep = z.infer<typeof stepSchema>;
const referenceFields = {
  create_variable_collection: ['collectionId', 'defaultModeId'],
  add_variable_mode: ['modeId'],
  create_variable: ['variableId'],
};
const references = (
  step: CatalogStep,
): Array<{ ref: z.infer<typeof reference>; field: 'collectionId' | 'modeId' | 'variableId' }> => {
  if (step.tool === 'create_variable_collection') return [];
  const out: ReturnType<typeof references> = [];
  if (typeof step.args.collectionId !== 'string')
    out.push({ ref: step.args.collectionId, field: 'collectionId' });
  if (step.tool === 'create_variable')
    for (const row of step.args.initialValues) {
      if (typeof row.modeId !== 'string') out.push({ ref: row.modeId, field: 'modeId' });
      if (typeof row.value === 'object' && 'alias' in row.value)
        out.push({ ref: row.value.alias, field: 'variableId' });
    }
  return out;
};
const resolveId = (
  input: z.infer<typeof target>,
  results: ReadonlyMap<string, unknown>,
): string => {
  if (typeof input === 'string') return input;
  const output = results.get(input.stepId);
  if (!output || typeof output !== 'object' || !Object.hasOwn(output, input.field))
    throw recipeError('RECIPE_CATALOG_REFERENCE_MISSING');
  return identity.parse(Reflect.get(output, input.field));
};
const tools = {
  create_variable_collection: createVariableCollectionTool,
  add_variable_mode: addVariableModeTool,
  create_variable: createVariableTool,
};
export function resolveCatalogRecipeArgs(
  step: CatalogStep,
  results: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  if (step.tool === 'create_variable_collection')
    return tools[step.tool].inputSchema.strict().parse(step.args);
  const args = {
    ...step.args,
    collectionId: resolveId(step.args.collectionId, results),
    ...(step.tool === 'create_variable'
      ? {
          initialValues: step.args.initialValues.map(row => ({
            modeId: resolveId(row.modeId, results),
            value:
              typeof row.value === 'object' && 'alias' in row.value
                ? { type: 'VARIABLE_ALIAS', id: resolveId(row.value.alias, results) }
                : row.value,
          })),
        }
      : {}),
  };
  return tools[step.tool].inputSchema.strict().parse(args);
}
/** Closed catalog plan. A source hash is an expectation, never operation authority. */
export const CatalogRecipeSchema = z
  .unknown()
  .superRefine((input, ctx) => {
    if (!isBoundedDesignJson(input, 262144, 20000))
      ctx.addIssue({ code: 'custom', message: 'RECIPE_CATALOG_INPUT_LIMIT' });
  })
  .pipe(
    z
      .strictObject({
        version: z.literal(1),
        kind: z.literal('variable-catalog'),
        intentId: id,
        authority: RecipeAuthoritySchema,
        sourceHash: hash,
        steps: z.array(stepSchema).min(1).max(126),
      })
      .superRefine((plan, ctx) => {
        const prior = new Map<string, CatalogStep>();
        for (const step of plan.steps) {
          if (prior.has(step.id) || step.id.startsWith('sfp_internal:'))
            ctx.addIssue({ code: 'custom', message: 'Invalid or duplicate catalog step ID' });
          for (const binding of references(step)) {
            const producer = prior.get(binding.ref.stepId);
            if (
              !producer ||
              !referenceFields[producer.tool].includes(binding.ref.field) ||
              !(
                binding.field === 'modeId' ? ['modeId', 'defaultModeId'] : [binding.field]
              ).includes(binding.ref.field)
            )
              ctx.addIssue({ code: 'custom', message: 'Invalid catalog backward field reference' });
          }
          if (step.tool === 'create_variable') {
            const modes = step.args.initialValues.map(row => recipeCanonical(row.modeId));
            if (new Set(modes).size !== modes.length)
              ctx.addIssue({ code: 'custom', message: 'Duplicate catalog mode' });
            for (const row of step.args.initialValues) {
              if (typeof row.value === 'object' && ('alias' in row.value || 'type' in row.value))
                continue;
              const type =
                typeof row.value === 'object'
                  ? 'COLOR'
                  : typeof row.value === 'number'
                    ? 'FLOAT'
                    : typeof row.value === 'boolean'
                      ? 'BOOLEAN'
                      : 'STRING';
              if (type !== step.args.resolvedType)
                ctx.addIssue({
                  code: 'custom',
                  message: 'Catalog initial value resolvedType mismatch',
                });
            }
          }
          prior.set(step.id, step);
        }
      }),
  );
export type CatalogRecipe = z.infer<typeof CatalogRecipeSchema>;
const catalogRef = (stepId: string, field: z.infer<typeof reference>['field']) => ({
  stepId,
  field,
});

/** Palette compilation resolves only exact original create/mode receipts; no imports or fallback. */
export function compilePaletteCatalogRecipe(input: {
  intentId: string;
  authority: CatalogRecipe['authority'];
  sourceHash: string;
  namespace: string;
  palette: ReturnType<typeof deriveRecipePalette>;
}): CatalogRecipe {
  z.string().min(1).max(128).parse(input.namespace);
  const steps: CatalogStep[] = [
    {
      id: 'primitives',
      tool: 'create_variable_collection',
      args: { name: `${input.namespace}/Primitives`, defaultModeName: 'Base' },
    },
  ];
  const primitives = new Map<string, string>();
  for (const [index, primitive] of input.palette.primitives.entries()) {
    const stepId = `primitive-${index}`;
    if (primitives.has(primitive.name)) throw recipeError('RECIPE_CATALOG_NAME_CONFLICT');
    primitives.set(primitive.name, stepId);
    steps.push({
      id: stepId,
      tool: 'create_variable',
      args: {
        name: primitive.name,
        collectionId: catalogRef('primitives', 'collectionId'),
        resolvedType: 'COLOR',
        initialValues: [
          { modeId: catalogRef('primitives', 'defaultModeId'), value: primitive.value },
        ],
      },
    });
  }
  const roles = input.palette.modeRoles;
  const groups =
    input.palette.modeStrategy === 'paired-collections' ? roles.map(role => [role]) : [roles];
  for (const [index, group] of groups.entries()) {
    const collection = `semantic-${index}`;
    const first = group[0];
    if (!first) throw recipeError('RECIPE_CATALOG_MODE_COVERAGE');
    steps.push({
      id: collection,
      tool: 'create_variable_collection',
      args: {
        name: `${input.namespace}/Semantic Colors${groups.length > 1 ? '/' + first : ''}`,
        defaultModeName: first,
      },
    });
    const modes = new Map<string, z.infer<typeof reference>>([
      [first, catalogRef(collection, 'defaultModeId')],
    ]);
    for (const role of group.slice(1)) {
      const modeStep = `${collection}-${role}`;
      steps.push({
        id: modeStep,
        tool: 'add_variable_mode',
        args: { collectionId: catalogRef(collection, 'collectionId'), name: role },
      });
      modes.set(role, catalogRef(modeStep, 'modeId'));
    }
    for (const [aliasIndex, alias] of input.palette.aliases.entries()) {
      const initialValues = group.map(role => {
        const valueRef = alias.values[role as 'Light' | 'Dark'];
        const producer = valueRef && primitives.get(valueRef.name);
        if (!producer) throw recipeError('RECIPE_CATALOG_REFERENCE_MISSING');
        return { modeId: modes.get(role)!, value: { alias: catalogRef(producer, 'variableId') } };
      });
      steps.push({
        id: `${collection}-alias-${aliasIndex}`,
        tool: 'create_variable',
        args: {
          name: alias.name,
          collectionId: catalogRef(collection, 'collectionId'),
          resolvedType: 'COLOR',
          initialValues,
        },
      });
    }
  }
  return CatalogRecipeSchema.parse({
    version: 1,
    kind: 'variable-catalog',
    intentId: input.intentId,
    authority: input.authority,
    sourceHash: input.sourceHash,
    steps,
  });
}

/** Full local catalog with referential completeness. Array inventory order is not semantic. */
export function catalogSnapshot(input: unknown): GetVariableDefsResult {
  if (!isBoundedDesignJson(input, 8388608, 200000)) throw recipeError('RECIPE_CATALOG_LIMIT');
  const snapshot = GetVariableDefsResultSchema.parse(input);
  const collections = new Map(snapshot.collections.map(row => [row.id, row]));
  const variables = new Map(snapshot.variables.map(row => [row.id, row]));
  if (
    collections.size !== snapshot.collections.length ||
    variables.size !== snapshot.variables.length
  )
    throw recipeError('RECIPE_CATALOG_INCOMPLETE');
  for (const collection of collections.values()) {
    const modes = new Set(collection.modes.map(mode => mode.modeId));
    if (
      !modes.has(collection.defaultModeId) ||
      modes.size !== collection.modes.length ||
      new Set(collection.variableIds).size !== collection.variableIds.length ||
      collection.variableIds.some(
        variable => variables.get(variable)?.collectionId !== collection.id,
      )
    )
      throw recipeError('RECIPE_CATALOG_INCOMPLETE');
  }
  for (const variable of variables.values()) {
    const collection = collections.get(variable.collectionId);
    if (
      !collection ||
      !collection.variableIds.includes(variable.id) ||
      Object.keys(variable.valuesByMode).some(
        mode => !collection.modes.some(row => row.modeId === mode),
      )
    )
      throw recipeError('RECIPE_CATALOG_INCOMPLETE');
  }
  return {
    collections: snapshot.collections.toSorted((a, b) => a.id.localeCompare(b.id)),
    variables: snapshot.variables.toSorted((a, b) => a.id.localeCompare(b.id)),
  };
}
export const catalogSnapshotHash = (input: unknown) => recipeHash(catalogSnapshot(input));
function requireCatalogPreflight(
  before: GetVariableDefsResult,
  step: CatalogStep,
  args: Record<string, unknown>,
): void {
  if (step.tool === 'create_variable_collection') {
    if (before.collections.some(row => row.name === args.name))
      throw recipeError('RECIPE_CATALOG_NAME_CONFLICT');
    return;
  }
  const collection = before.collections.find(row => row.id === args.collectionId);
  if (!collection) throw recipeError('RECIPE_CATALOG_TARGET_MISSING');
  if (step.tool === 'add_variable_mode') {
    if (collection.variableIds.length || collection.modes.some(row => row.name === args.name))
      throw recipeError('RECIPE_CATALOG_MODE_TRANSITION_UNSUPPORTED');
    return;
  }
  if (before.variables.some(row => row.collectionId === collection.id && row.name === args.name))
    throw recipeError('RECIPE_CATALOG_NAME_CONFLICT');
  const rows = VariableInitialValuesSchema.parse(args.initialValues);
  if (
    recipeCanonical(rows.map(row => row.modeId).toSorted()) !==
    recipeCanonical(collection.modes.map(row => row.modeId).toSorted())
  )
    throw recipeError('RECIPE_CATALOG_MODE_COVERAGE');
  for (const row of rows) {
    const current = row.value;
    const type =
      typeof current === 'object'
        ? 'type' in current
          ? before.variables.find(item => item.id === current.id)?.resolvedType
          : 'COLOR'
        : typeof current === 'number'
          ? 'FLOAT'
          : typeof current === 'boolean'
            ? 'BOOLEAN'
            : 'STRING';
    if (type !== args.resolvedType) throw recipeError('RECIPE_CATALOG_VALUE_TYPE');
  }
}
/** Generated IDs/keys are the only unpredictable fields; declared values never come from poststate. */
export function reconcileCatalogRecipe(
  beforeInput: unknown,
  afterInput: unknown,
  step: CatalogStep,
  args: Record<string, unknown>,
  result: unknown,
): GetVariableDefsResult {
  const before = catalogSnapshot(beforeInput),
    after = catalogSnapshot(afterInput),
    expected = structuredClone(before);
  requireCatalogPreflight(before, step, args);
  const output = RESULT_SCHEMAS[step.tool]!.parse(result) as Record<string, unknown>;
  if (output.name !== args.name) throw recipeError('RECIPE_CATALOG_RECEIPT_MISMATCH');
  if (step.tool === 'create_variable_collection') {
    const generated = after.collections.find(row => row.id === output.collectionId);
    if (
      !generated ||
      before.collections.some(row => row.id === generated.id || row.key === generated.key) ||
      !generated.key
    )
      throw recipeError('RECIPE_CATALOG_GENERATED_ID');
    expected.collections.push({
      id: generated.id,
      key: generated.key,
      name: String(args.name),
      defaultModeId: identity.parse(output.defaultModeId),
      modes: [{ modeId: identity.parse(output.defaultModeId), name: String(args.defaultModeName) }],
      variableIds: [],
    });
  } else if (step.tool === 'add_variable_mode') {
    const collection = expected.collections.find(row => row.id === args.collectionId)!;
    const modeId = identity.parse(output.modeId);
    if (collection.modes.some(row => row.modeId === modeId))
      throw recipeError('RECIPE_CATALOG_GENERATED_ID');
    collection.modes.push({ modeId, name: String(args.name) });
  } else {
    const generated = after.variables.find(row => row.id === output.variableId);
    if (
      !generated ||
      before.variables.some(row => row.id === generated.id || row.key === generated.key) ||
      !generated.key
    )
      throw recipeError('RECIPE_CATALOG_GENERATED_ID');
    const rows = VariableInitialValuesSchema.parse(args.initialValues);
    const valuesByMode = Object.fromEntries(
      rows.map(row => [
        row.modeId,
        typeof row.value === 'object' && 'r' in row.value
          ? { ...row.value, hex: toHex(row.value, row.value.a) }
          : row.value,
      ]),
    );
    expected.variables.push({
      id: generated.id,
      key: generated.key,
      name: String(args.name),
      resolvedType: String(args.resolvedType),
      collectionId: String(args.collectionId),
      valuesByMode,
    });
    expected.collections.find(row => row.id === args.collectionId)!.variableIds.push(generated.id);
  }
  if (catalogSnapshotHash(expected) !== recipeHash(after))
    throw recipeError('RECIPE_CATALOG_CHANGED');
  return after;
}

/** Real owner-bound retained execution. Reads are point-in-time guards, not atomic/ABA protection. */
export async function runOwnerCatalogRecipe(
  input: unknown,
  client: ControlRecipeClient,
  checkpoints: RecipeCheckpointStore,
  options: { approve: boolean; signal?: AbortSignal },
) {
  const plan = CatalogRecipeSchema.parse(input),
    planHash = recipeHash(plan),
    outputs = new Map<string, unknown>();
  const verified = new Map<
    string,
    { step: CatalogStep; intent: RecipeStepIntent; receiptHash: string }
  >();
  const completedSteps: string[] = [];
  await checkpoints.initialize(plan);
  const makeIntent = async (
    stepId: string,
    operationName: RecipeStepIntent['operationName'],
    args: Record<string, unknown>,
  ): Promise<RecipeStepIntent> => ({
    version: 1,
    planHash,
    stepId,
    operationName,
    operationId: await client.control.issueOperationId(),
    args,
    argsHash: recipeHash(args, 'sfp-parsed-args-v1'),
    resultSchemaHash: recipeHash(
      RESULT_SCHEMAS[operationName]!.toJSONSchema(),
      'sfp-result-schema-v1',
    ),
  });
  const check = (
    intent: RecipeStepIntent,
    stepId: string,
    tool: RecipeStepIntent['operationName'],
    args: Record<string, unknown>,
  ) => {
    if (
      intent.planHash !== planHash ||
      intent.stepId !== stepId ||
      intent.operationName !== tool ||
      intent.argsHash !== recipeHash(args, 'sfp-parsed-args-v1') ||
      recipeHash(intent.args, 'sfp-parsed-args-v1') !== intent.argsHash ||
      intent.resultSchemaHash !==
        recipeHash(RESULT_SCHEMAS[tool]!.toJSONSchema(), 'sfp-result-schema-v1')
    )
      throw recipeError('RECIPE_STEP_INTENT_CHANGED');
  };
  const dispatchOrRecover = async (intent: RecipeStepIntent, dispatch: boolean) => {
    await client.reserve(plan, intent);
    if (options.signal?.aborted || (await checkpoints.cancelled(plan)))
      throw recipeError('RECIPE_CANCELLED');
    if (dispatch)
      try {
        await client.invoke(plan, { tool: intent.operationName }, intent, options);
      } catch {
        /* Recover only the service-issued original ID. */
      }
    return client.recover(plan, { tool: intent.operationName }, intent);
  };
  const observe = async (historicalIndex?: number) => {
    let intent: RecipeStepIntent, dispatch: boolean;
    if (historicalIndex === undefined) {
      intent = await checkpoints.freshObservation(plan, stepId =>
        makeIntent(stepId, 'get_variable_defs', {}),
      );
      dispatch = true;
    } else {
      const previous = await checkpoints.postIntent(plan, historicalIndex);
      if (previous) {
        intent = previous;
        dispatch = false;
      } else {
        const candidate = await makeIntent(
          `sfp_internal:catalog:${historicalIndex}`,
          'get_variable_defs',
          {},
        );
        dispatch = await checkpoints.claimPost(plan, historicalIndex, candidate);
        intent = dispatch ? candidate : (await checkpoints.postIntent(plan, historicalIndex))!;
      }
      check(intent, `sfp_internal:catalog:${historicalIndex}`, 'get_variable_defs', {});
    }
    const actual = await dispatchOrRecover(intent, dispatch);
    return {
      snapshot: catalogSnapshot(actual.result),
      operationId: intent.operationId,
      receiptHash: actual.receiptHash,
    };
  };
  try {
    let source = (await observe(0)).snapshot;
    if (recipeHash(source) !== plan.sourceHash) throw recipeError('RECIPE_CATALOG_SOURCE_CHANGED');
    // Existing literal targets and alias dependencies are checked before the first effect.
    // Newly produced identities must use original-receipt references.
    for (const step of plan.steps) {
      if (step.tool === 'create_variable_collection') continue;
      if (
        typeof step.args.collectionId === 'string' &&
        !source.collections.some(row => row.id === step.args.collectionId)
      )
        throw recipeError('RECIPE_CATALOG_TARGET_MISSING');
      if (step.tool === 'create_variable')
        for (const row of step.args.initialValues) {
          if (typeof row.modeId === 'string') {
            const collection =
              typeof step.args.collectionId === 'string'
                ? source.collections.find(item => item.id === step.args.collectionId)
                : undefined;
            if (!collection?.modes.some(mode => mode.modeId === row.modeId))
              throw recipeError('RECIPE_CATALOG_MODE_COVERAGE');
          }
          const initialValue = row.value;
          if (
            typeof initialValue === 'object' &&
            'type' in initialValue &&
            !source.variables.some(
              item => item.id === initialValue.id && item.resolvedType === step.args.resolvedType,
            )
          )
            throw recipeError('RECIPE_CATALOG_VALUE_TYPE');
        }
    }
    /* eslint-disable no-await-in-loop -- currentness, dependencies and durable claims are ordered */
    for (const [index, step] of plan.steps.entries()) {
      if (options.signal?.aborted) await checkpoints.cancel(plan);
      if (await checkpoints.cancelled(plan))
        return { status: 'cancelled' as const, planHash, completedSteps };
      await client.assertCurrent(plan);
      for (const { ref } of references(step)) {
        const dependency = verified.get(ref.stepId);
        if (!dependency) throw recipeError('RECIPE_DEPENDENCY_MISSING');
        const actual = await client.recover(plan, dependency.step, dependency.intent);
        if (actual.receiptHash !== dependency.receiptHash)
          throw recipeError('RECIPE_DEPENDENCY_CHANGED');
        outputs.set(ref.stepId, actual.result);
      }
      const args = resolveCatalogRecipeArgs(step, outputs);
      requireCatalogPreflight(source, step, args);
      let intent = await checkpoints.intent(plan, index),
        dispatch = false;
      if (!intent) {
        const current = await observe();
        if (recipeHash(current.snapshot) !== recipeHash(source))
          throw recipeError('RECIPE_CATALOG_SOURCE_CHANGED');
        const candidate = await makeIntent(step.id, step.tool, args);
        dispatch = await checkpoints.claim(plan, index, candidate);
        intent = dispatch ? candidate : await checkpoints.intent(plan, index);
      }
      if (!intent) throw recipeError('RECIPE_STEP_INTENT_CHANGED');
      check(intent, step.id, step.tool, args);
      const actual = await dispatchOrRecover(intent, dispatch);
      const post = await observe(index + 1);
      source = reconcileCatalogRecipe(source, post.snapshot, step, args, actual.result);
      await checkpoints.settled(plan, index, intent, actual.receiptHash);
      verified.set(step.id, { step, intent, receiptHash: actual.receiptHash });
      outputs.set(step.id, actual.result);
      completedSteps.push(step.id);
    }
    const final = await observe();
    if (recipeHash(final.snapshot) !== recipeHash(source))
      throw recipeError('RECIPE_CATALOG_SOURCE_CHANGED');
    return {
      status: 'succeeded' as const,
      planHash,
      completedSteps,
      currentReadback: {
        operationId: final.operationId,
        receiptHash: final.receiptHash,
        sourceHash: recipeHash(final.snapshot),
      },
    };
    /* eslint-enable no-await-in-loop */
  } finally {
    if (options.signal?.aborted) await checkpoints.cancel(plan);
  }
}
