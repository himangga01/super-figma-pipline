import { contentHash } from '@sfp/ir';
import {
  PORTAL_RECIPE_IDS,
  PORTAL_CORE_RECIPE_IDS,
  PORTAL_RECIPE_LIMITS,
  PORTAL_RECIPE_TOOL_EFFECTS,
  PORTAL_RECIPE_OUTPUT_SCHEMAS,
  PortalRecipeDefinitionSchema,
  PortalRecipeInputsSchema,
  PortalRecipeStepSchema,
  PortalRecipeInputContextSchema,
  PortalRecipeResultSchema,
  PortalRecipeBlueprintBindingSchema,
  PortalRecipeCandidateDeclarationsSchema,
  PortalRecipeVerifiedConsumptionSchema,
  type PortalRecipeDefinition,
  type PortalRecipeOutputSchemaId,
  type PortalRecipeResult,
} from '@sfp/shared';

import { CORE_RECIPE_CONTRACT_HASH } from './core-derivation.js';
import { PORTAL_RECIPE_FEATURE_INVENTORY } from './feature-inventory.js';

type RecipeId = PortalRecipeDefinition['recipeId'];
type Step = PortalRecipeDefinition['steps'][number];
type Tool = Extract<Step, { kind: 'tool' }>['tool'];
type Ref = Step['refs'][number];
const derive = (recipeId: RecipeId): Step => ({
  id: 'derive',
  kind: 'derive',
  algorithm: recipeId,
  refs: [],
});
const tool = (id: string, name: Tool, refs: Ref[] = []): Step => ({
  id,
  kind: 'tool',
  tool: name,
  refs,
});
const readback = (name: Extract<Step, { kind: 'readback' }>['tool'], refs: Ref[] = []): Step => ({
  id: 'readback',
  kind: 'readback',
  tool: name,
  refs,
});
const nodeRef = (stepId: string): Ref => ({ stepId, field: 'nodeId', type: 'node-id' });
const fieldRef = (stepId: string, field: Ref['field'], type: Ref['type']): Ref => ({
  stepId,
  field,
  type,
});

const specifications: Record<
  RecipeId,
  {
    output: PortalRecipeOutputSchemaId;
    effects: PortalRecipeDefinition['effects'];
    triggers: PortalRecipeDefinition['triggers'];
    steps?: Step[];
    prerequisites?: string[];
  }
> = {
  'ground-design': {
    output: 'sfp.recipe.grounding.v1',
    effects: ['derive'],
    triggers: ['portal-plan'],
  },
  'map-design': {
    output: 'sfp.recipe.mapping.v1',
    effects: ['derive'],
    triggers: ['portal-plan', 'source-patterns'],
  },
  'plan-design-implementation': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['derive'],
    triggers: ['portal-plan', 'source-patterns'],
  },
  'audit-styles': {
    output: 'sfp.recipe.style-audit.v1',
    effects: ['derive'],
    triggers: ['portal-plan'],
  },
  'derive-tokens': {
    output: 'sfp.recipe.tokens.v1',
    effects: ['derive'],
    triggers: ['portal-plan'],
  },
  'resolve-assets': {
    output: 'sfp.recipe.assets.v1',
    effects: ['derive'],
    triggers: ['portal-plan'],
  },
  'derive-interactions': {
    output: 'sfp.recipe.interactions.v1',
    effects: ['derive'],
    triggers: ['source-interactions'],
  },
  'diagnose-connection': {
    output: 'sfp.recipe.diagnostics.v1',
    effects: ['read'],
    triggers: ['connection-failure', 'explicit-read'],
    steps: [tool('diagnose', 'doctor')],
  },
  'resolve-target': {
    output: 'sfp.recipe.targets.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'resolve-variable': {
    output: 'sfp.recipe.tokens.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
    prerequisites: ['library-import-requires-separate-authoring-definition'],
  },
  'describe-tree': {
    output: 'sfp.recipe.grounding.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'describe-variants': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'convert-paint': {
    output: 'sfp.recipe.paint.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'replace-text': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('write', 'set_text_range'), readback('get_design_context')],
  },
  'rename-nodes': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('rename', 'batch_rename_nodes'), readback('get_design_context')],
  },
  'transfer-instance-overrides': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['read', 'design-write', 'library-import'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('inspect', 'get_design_context'),
      tool('swap', 'swap_component'),
      tool('text', 'set_text_range'),
      tool('fills', 'set_fills'),
      tool('strokes', 'set_strokes'),
      readback('get_design_context'),
    ],
    prerequisites: ['exact-compatible-override-plan'],
  },
  'plan-annotations': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'convert-annotations': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['derive', 'read', 'design-write'],
    triggers: ['explicit-authoring'],
    steps: [derive('plan-annotations'), readback('get_annotations')],
    prerequisites: ['canonical-annotation-writer-missing'],
  },
  'assemble-frame': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('create', 'create_frame'),
      tool('parent', 'reparent_nodes', [nodeRef('create')]),
      tool('layout', 'set_auto_layout', [nodeRef('create')]),
      tool('size', 'resize_nodes', [nodeRef('create')]),
      tool('sizing', 'set_layout_props', [nodeRef('create')]),
      tool('paint', 'set_fills', [nodeRef('create')]),
      readback('get_node', [nodeRef('create')]),
    ],
  },
  'clone-adjacent': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('clone', 'clone_node'),
      tool('position', 'set_position', [nodeRef('clone')]),
      tool('name', 'rename_node', [nodeRef('clone')]),
      readback('get_node', [nodeRef('clone')]),
    ],
  },
  'instantiate-component': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'library-import', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('instance', 'create_instance'), readback('get_node', [nodeRef('instance')])],
    prerequisites: ['explicit-local-component-or-library-key'],
  },
  'bind-variable': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read', 'library-import'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('import', 'import_library_variable'),
      tool('bind', 'bind_variable_to_paint', [fieldRef('import', 'id', 'variable-id')]),
      readback('get_node'),
    ],
    prerequisites: ['explicit-local-binding-or-library-import-branch'],
  },
  'set-variant': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('variant', 'set_instance_properties'), readback('get_component_api')],
  },
  'author-tokens': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('collection', 'create_variable_collection'),
      tool('variable', 'create_variable', [
        fieldRef('collection', 'collectionId', 'collection-id'),
      ]),
      tool('value', 'set_variable_value', [
        fieldRef('variable', 'variableId', 'variable-id'),
        fieldRef('collection', 'defaultModeId', 'mode-id'),
      ]),
      readback('get_variable_defs'),
    ],
  },
  'derive-palette': {
    output: 'sfp.recipe.tokens.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'author-palette': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('collection', 'create_variable_collection'),
      tool('primitive', 'create_variable', [
        fieldRef('collection', 'collectionId', 'collection-id'),
      ]),
      tool('value', 'set_variable_value', [
        fieldRef('primitive', 'variableId', 'variable-id'),
        fieldRef('collection', 'defaultModeId', 'mode-id'),
      ]),
      readback('get_variable_defs'),
    ],
    prerequisites: ['bounded-palette-expansion-and-explicit-mode-plan'],
  },
  'derive-type-scale': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'author-type-scale': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('style', 'create_text_style'), readback('get_styles')],
    prerequisites: ['bounded-typed-scale-expansion-and-font-check'],
  },
  'derive-variants': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['derive'],
    triggers: ['explicit-read'],
  },
  'author-variants': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [
      tool('clone', 'clone_node'),
      tool('place', 'set_position', [nodeRef('clone')]),
      tool('size', 'resize_nodes', [nodeRef('clone')]),
      tool('name', 'rename_node', [nodeRef('clone')]),
      readback('get_design_context', [nodeRef('clone')]),
    ],
    prerequisites: ['bounded-typed-variant-expansion'],
  },
  'remove-nodes': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('remove', 'delete_nodes'), readback('get_design_context')],
  },
  'export-handoff': {
    output: 'sfp.recipe.assets.v1',
    effects: ['read', 'artifact-write'],
    triggers: ['explicit-export'],
    steps: [tool('export', 'export_frames_to_pdf')],
  },
  'diff-design': {
    output: 'sfp.recipe.strategy.v1',
    effects: ['read', 'artifact-write'],
    triggers: ['explicit-read'],
    steps: [tool('diff', 'design_diff')],
  },
  'author-motion': {
    output: 'sfp.recipe.authoring.v1',
    effects: ['design-write', 'read'],
    triggers: ['explicit-authoring'],
    steps: [tool('motion', 'apply_manual_keyframe_track'), readback('get_design_context')],
    prerequisites: ['experimental-host-motion-api-and-temporal-readback'],
  },
};

const schemaHashes = {
  input: contentHash('sfp-recipe-schema-v1', PortalRecipeInputsSchema.toJSONSchema()),
  step: contentHash('sfp-recipe-schema-v1', PortalRecipeStepSchema.toJSONSchema()),
};
/** Includes versioned behavior, verifier, structural schemas and enforced resource limits. */
export function portalRecipeDefinitionHash(input: unknown): `sha256:${string}` {
  const definition = PortalRecipeDefinitionSchema.parse(input);
  return contentHash('sfp-portal-recipe-definition-v1', {
    definition,
    inputSchemaHash: schemaHashes.input,
    stepSchemaHash: schemaHashes.step,
    possibleStepEffects: PORTAL_RECIPE_TOOL_EFFECTS,
    outputSchemaHash: contentHash(
      'sfp-recipe-schema-v1',
      PORTAL_RECIPE_OUTPUT_SCHEMAS[definition.outputSchemaId].toJSONSchema(),
    ),
    contractBehaviorVersion: 'portal-recipes.v1',
    limits: PORTAL_RECIPE_LIMITS,
  });
}
export function validatePortalRecipeDefinitions(
  input: readonly unknown[],
): PortalRecipeDefinition[] {
  if (input.length > PORTAL_RECIPE_LIMITS.definitions)
    throw new Error('PORTAL_RECIPE_DEFINITION_LIMIT');
  const definitions = input.map(value => PortalRecipeDefinitionSchema.parse(value));
  for (const definition of definitions)
    if (
      definition.execution === 'implemented' &&
      definition.implementationHash !== CORE_RECIPE_CONTRACT_HASH
    )
      throw new Error('PORTAL_RECIPE_IMPLEMENTATION_MISMATCH');
  if (new Set(definitions.map(value => value.recipeId)).size !== definitions.length)
    throw new Error('PORTAL_RECIPE_DUPLICATE_DEFINITION');
  const featureIds = new Set(PORTAL_RECIPE_FEATURE_INVENTORY.map(value => value.featureId));
  for (const definition of definitions)
    if (definition.featureIds.some(featureId => !featureIds.has(featureId)))
      throw new Error('PORTAL_RECIPE_UNKNOWN_FEATURE');
    else {
      const expected = PORTAL_RECIPE_FEATURE_INVENTORY.filter(feature =>
        feature.recipeIds.includes(definition.recipeId),
      ).map(feature => feature.featureId);
      if (
        expected.length !== definition.featureIds.length ||
        expected.some(featureId => !definition.featureIds.includes(featureId))
      )
        throw new Error('PORTAL_RECIPE_FEATURE_MAPPING_MISMATCH');
    }
  return definitions;
}
function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const definitions = validatePortalRecipeDefinitions(
  PORTAL_RECIPE_IDS.map(recipeId => {
    const spec = specifications[recipeId];
    const builtin = PORTAL_CORE_RECIPE_IDS.some(id => id === recipeId);
    const definition = {
      recipeId,
      version: 1,
      featureIds: PORTAL_RECIPE_FEATURE_INVENTORY.filter(feature =>
        feature.recipeIds.includes(recipeId),
      ).map(feature => feature.featureId),
      execution: builtin ? 'implemented' : 'planned',
      behaviorVersion: builtin ? `${recipeId}.core.v2` : `${recipeId}.v1`,
      verifierVersion: builtin ? `${recipeId}.core-pages.v1` : `${recipeId}.verifier.v1`,
      inputSchemaId: 'sfp.recipe.inputs.v1',
      outputSchemaId: builtin ? 'sfp.recipe.core-manifest.v1' : spec.output,
      strategies: ['blank-frontend', 'reference-portal', 'legacy-portal'],
      triggers: spec.triggers,
      effects: spec.effects,
      prerequisites: [
        ...(builtin
          ? [
              'admitted-capture-and-qualified-sources',
              'signed-core-preparation',
              'candidate-consumption-verifier-required',
            ]
          : ['recipe-executor-and-verifier-not-integrated']),
        ...(spec.prerequisites ?? []),
        ...(spec.effects.includes('design-write')
          ? ['canonical-owner-admission', 'typed-authoring-input-adapter']
          : []),
      ],
      steps: spec.steps ?? [derive(recipeId)],
    };
    if (builtin) Object.assign(definition, { implementationHash: CORE_RECIPE_CONTRACT_HASH });
    return definition;
  }),
);
export const PORTAL_RECIPE_DEFINITIONS = deepFreeze(definitions);
export const PORTAL_RECIPE_CATALOG = deepFreeze(
  definitions.map(definition => ({
    definition,
    definitionHash: portalRecipeDefinitionHash(definition),
  })),
);

const by =
  <T>(key: (value: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
export function portalRecipeInputContextHash(input: unknown): `sha256:${string}` {
  const context = PortalRecipeInputContextSchema.parse(input);
  return contentHash('sfp-portal-recipe-context-v1', {
    ...context,
    sourceHashes: context.sourceHashes.toSorted(by(value => value.sourceId)),
    capabilityVersions: context.capabilityVersions.toSorted(by(value => value.id)),
    selections: context.selections.toSorted(by(value => value.recipeId)),
  });
}
/**
 * Checks structural bindings only. The consumer must load signed owner-state and authoritative
 * bytes.
 */
export function validatePortalRecipeResultBinding(
  input: unknown,
  definitionInput: unknown,
  expected: {
    ownerId: string;
    workspaceId: string;
    contextHash: string;
    inputHash: string;
  },
): PortalRecipeResult {
  const result = PortalRecipeResultSchema.parse(input),
    definition = PortalRecipeDefinitionSchema.parse(definitionInput);
  if (
    result.recipeId !== definition.recipeId ||
    result.definitionHash !== portalRecipeDefinitionHash(definition) ||
    result.ownerId !== expected.ownerId ||
    result.workspaceId !== expected.workspaceId ||
    result.contextHash !== expected.contextHash ||
    result.inputHash !== expected.inputHash
  )
    throw new Error('PORTAL_RECIPE_RESULT_BINDING_MISMATCH');
  if (result.status !== 'succeeded') throw new Error('PORTAL_RECIPE_RESULT_NOT_SUCCEEDED');
  if (
    result.output.schemaId !== definition.outputSchemaId ||
    result.outputHash !== contentHash('sfp-portal-recipe-output-v1', result.output)
  )
    throw new Error('PORTAL_RECIPE_OUTPUT_MISMATCH');
  return result;
}
export function portalRecipeResultHash(input: unknown): `sha256:${string}` {
  const result = PortalRecipeResultSchema.parse(input);
  if (
    result.status === 'succeeded' &&
    result.outputHash !== contentHash('sfp-portal-recipe-output-v1', result.output)
  )
    throw new Error('PORTAL_RECIPE_OUTPUT_MISMATCH');
  return contentHash('sfp-portal-recipe-result-v1', result);
}
export function portalRecipeBlueprintBindingHash(input: unknown): `sha256:${string}` {
  const blueprint = PortalRecipeBlueprintBindingSchema.parse(input);
  return contentHash('sfp-portal-recipe-blueprint-binding-v1', {
    ...blueprint,
    requiredResults: blueprint.requiredResults.toSorted(by(value => value.recipeId)),
  });
}
export function portalRecipeDeclarationsHash(input: unknown): `sha256:${string}` {
  const declarations = PortalRecipeCandidateDeclarationsSchema.parse(input);
  return contentHash(
    'sfp-portal-recipe-declarations-v1',
    declarations
      .map(value =>
        Object.assign({}, value, {
          files: value.files.toSorted(by(file => file.path)),
          assertionIds: value.assertionIds.toSorted(),
        }),
      )
      .toSorted(by(value => JSON.stringify([value.resultId, value.outputItemId, value.kind]))),
  );
}
export function portalRecipeConsumptionContentHash(input: unknown): `sha256:${string}` {
  const receipt = PortalRecipeVerifiedConsumptionSchema.parse(input);
  return contentHash('sfp-portal-recipe-consumption-v1', {
    ...receipt,
    resultHashes: receipt.resultHashes.toSorted(),
  });
}
