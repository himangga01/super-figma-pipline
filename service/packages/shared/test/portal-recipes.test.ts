import { expect, it } from 'vitest';

import {
  PortalRecipeDefinitionSchema,
  PortalRecipeInputContextSchema,
  PortalRecipeResultSchema,
  PortalRecipeCandidateDeclarationSchema,
  PortalRecipeBlueprintBindingSchema,
  PortalRecipeVerifiedConsumptionSchema,
  PortalRecipeInputsSchema,
  readPortalRecipeAuthority,
  assertCurrentPortalRecipeAuthority,
} from '../src/portal-recipes.js';

const hash = `sha256:${'a'.repeat(64)}`;
const binding = { recipeId: 'ground-design', definitionHash: hash };
const evidence = { kind: 'capture', captureHash: hash, itemId: '1:2' };
const context = {
  recipeAuthorityVersion: 1,
  ownerId: 'owner',
  workspaceId: 'workspace',
  intentId: 'intent',
  strategy: 'blank-frontend',
  authorityHash: hash,
  captureHash: hash,
  assetManifestHash: hash,
  scopeHash: hash,
  sourceHashes: [],
  capabilityVersions: [{ id: 'capture', version: 2, hash }],
  selections: [{ ...binding, required: true, applicability: 'applicable', evidence: [evidence] }],
};
const result = {
  recipeAuthorityVersion: 1,
  resultId: 'result-1',
  ownerId: 'owner',
  workspaceId: 'workspace',
  contextHash: hash,
  ...binding,
  inputHash: hash,
  status: 'succeeded',
  outputHash: hash,
  output: {
    schemaId: 'sfp.recipe.grounding.v1',
    roots: [{ nodeId: '1:2', decision: 'included', reason: 'Selected root', evidence: [evidence] }],
    capabilities: [{ name: 'tree', status: 'complete', evidenceHash: hash }],
  },
  evidence: [evidence],
};
const definition = {
  recipeId: 'assemble-frame',
  version: 1,
  featureIds: ['figmosha.helper.frame'],
  execution: 'planned',
  behaviorVersion: 'assemble-frame.v1',
  inputSchemaId: 'sfp.recipe.inputs.v1',
  outputSchemaId: 'sfp.recipe.authoring.v1',
  verifierVersion: 'frame-readback.v1',
  triggers: ['explicit-authoring'],
  strategies: ['blank-frontend', 'reference-portal', 'legacy-portal'],
  effects: ['design-write'],
  prerequisites: ['canonical-owner-admission'],
  steps: [
    { id: 'create', kind: 'tool', tool: 'create_frame', refs: [] },
    {
      id: 'size',
      kind: 'tool',
      tool: 'resize_nodes',
      refs: [{ stepId: 'create', field: 'nodeId', type: 'node-id' }],
    },
  ],
};

it('keeps context, required result binding, declarations and receipts at separate stages', () => {
  expect(PortalRecipeInputContextSchema.parse(context)).toEqual(context);
  expect(
    PortalRecipeInputContextSchema.safeParse({ ...context, resultHashes: [hash] }).success,
  ).toBe(false);
  expect(
    PortalRecipeInputContextSchema.safeParse({ ...context, candidateHash: hash }).success,
  ).toBe(false);
  expect(PortalRecipeResultSchema.safeParse({ ...result, candidateHash: hash }).success).toBe(
    false,
  );
  expect(PortalRecipeResultSchema.parse(result)).toEqual(result);
  const declaration = {
    resultId: 'result-1',
    resultHash: hash,
    outputItemId: '1:2',
    kind: 'scope',
    files: [{ path: 'src/app.ts', hash }],
    assertionIds: ['home'],
  };
  expect(PortalRecipeCandidateDeclarationSchema.parse(declaration)).toEqual(declaration);
  expect(
    PortalRecipeCandidateDeclarationSchema.safeParse({ ...declaration, candidateHash: hash })
      .success,
  ).toBe(false);
  const blueprint = {
    recipeAuthorityVersion: 1,
    contextHash: hash,
    requirementsHash: hash,
    requiredResults: [{ ...binding, resultId: 'result-1', resultHash: hash }],
  };
  expect(PortalRecipeBlueprintBindingSchema.parse(blueprint)).toEqual(blueprint);
  expect(
    PortalRecipeBlueprintBindingSchema.safeParse({
      ...blueprint,
      requiredResults: [...blueprint.requiredResults, ...blueprint.requiredResults],
    }).success,
  ).toBe(false);
});

it('rejects arbitrary output shapes and failed results disguised as successful evidence', () => {
  expect(
    PortalRecipeResultSchema.safeParse({
      ...result,
      output: { schemaId: 'sfp.recipe.grounding.v1', payload: { arbitrary: true } },
    }).success,
  ).toBe(false);
  expect(PortalRecipeResultSchema.safeParse({ ...result, status: 'failed' }).success).toBe(false);
  const { output: _output, outputHash: _outputHash, ...identity } = result;
  expect(
    PortalRecipeResultSchema.safeParse({
      ...identity,
      status: 'failed',
      code: 'CAPTURE_PARTIAL',
      evidence: [evidence],
    }).success,
  ).toBe(true);
  expect(
    PortalRecipeResultSchema.safeParse({ ...result, output: { ...result.output, roots: [] } })
      .success,
  ).toBe(false);
});

it('accepts only backward result fields with actual tool output types', () => {
  expect(PortalRecipeDefinitionSchema.safeParse(definition).success).toBe(true);
  const steps = JSON.parse(JSON.stringify(definition.steps)) as typeof definition.steps;
  steps[1]!.refs = [{ stepId: 'create', field: 'variableId', type: 'variable-id' }];
  expect(PortalRecipeDefinitionSchema.safeParse({ ...definition, steps }).success).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({ ...definition, steps: definition.steps.toReversed() })
      .success,
  ).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...definition,
      steps: [...definition.steps, definition.steps[0]],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...definition,
      steps: [{ id: 'arbitrary', kind: 'tool', tool: 'exec', refs: [] }],
    }).success,
  ).toBe(false);
  expect(PortalRecipeDefinitionSchema.safeParse({ ...definition, effects: ['read'] }).success).toBe(
    false,
  );
});

it('requires verified receipts to contain concrete typed evidence and the candidate binding', () => {
  const receipt = {
    recipeAuthorityVersion: 1,
    ownerId: 'owner',
    workspaceId: 'workspace',
    contextHash: hash,
    blueprintHash: hash,
    candidateHash: hash,
    target: 'candidate',
    verifierVersion: 'scope.v1',
    resultHashes: [hash],
    declarationsHash: hash,
    findings: [
      {
        kind: 'review',
        decision: 'accepted',
        reviewerId: 'reviewer',
        rationale: 'Verified exact source and rendered requirement',
        sourceHashes: [hash],
        evidenceHash: hash,
      },
    ],
  };
  expect(PortalRecipeVerifiedConsumptionSchema.safeParse(receipt).success).toBe(true);
  expect(
    PortalRecipeVerifiedConsumptionSchema.safeParse({
      ...receipt,
      findings: [{ kind: 'review', reviewed: true }],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeVerifiedConsumptionSchema.safeParse({ ...receipt, candidateHash: undefined })
      .success,
  ).toBe(false);
  expect(
    PortalRecipeVerifiedConsumptionSchema.safeParse({ ...receipt, resultHashes: [hash, hash] })
      .success,
  ).toBe(false);
});

it('preserves explicit legacy inspection without fabricating recipe authority', () => {
  expect(readPortalRecipeAuthority({ sourceAuthorityVersion: 2 })).toBe('legacy');
  expect(readPortalRecipeAuthority({ recipeAuthorityVersion: 0 })).toBe('legacy');
  expect(() => assertCurrentPortalRecipeAuthority({})).toThrow('PORTAL_RECIPE_AUTHORITY_REQUIRED');
  expect(() => readPortalRecipeAuthority({ recipeAuthorityVersion: 2 })).toThrow(
    'PORTAL_RECIPE_AUTHORITY_UNSUPPORTED',
  );
  expect(() => readPortalRecipeAuthority({ recipeAuthorityVersion: '1' })).toThrow(
    'PORTAL_RECIPE_AUTHORITY_INVALID',
  );
  expect(() => assertCurrentPortalRecipeAuthority({ recipeAuthorityVersion: 1 })).not.toThrow();
});

it('rejects duplicate selections, unsafe paths and excessive unbounded payloads', () => {
  expect(
    PortalRecipeInputContextSchema.safeParse({
      ...context,
      selections: [...context.selections, ...context.selections],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeCandidateDeclarationSchema.safeParse({
      resultId: 'r',
      resultHash: hash,
      outputItemId: 'x',
      kind: 'asset',
      files: [{ path: '../secret', hash }],
      assertionIds: [],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...definition,
      featureIds: ['figmosha.helper.frame', 'figmosha.helper.frame'],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeResultSchema.safeParse({
      ...result,
      evidence: Array.from({ length: 1025 }, () => evidence),
    }).success,
  ).toBe(false);
});

it('rejects accessor/cyclic records before parsing and enforces aggregate JSON limits', () => {
  let reads = 0;
  const withGetter = Object.defineProperty({}, 'recipeAuthorityVersion', {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  expect(PortalRecipeInputContextSchema.safeParse(withGetter).success).toBe(false);
  expect(reads).toBe(0);
  const cyclic: Record<string, unknown> = { ...context };
  cyclic['cycle'] = cyclic;
  expect(PortalRecipeInputContextSchema.safeParse(cyclic).success).toBe(false);
  expect(
    PortalRecipeResultSchema.safeParse({ ...result, oversized: 'x'.repeat(16 * 1024 * 1024) })
      .success,
  ).toBe(false);
});

it('distinguishes local variable lookup and admitted library import without an executable payload', () => {
  const inputs = {
    scopeIds: ['1:2'],
    evidence: [evidence],
    options: [{ kind: 'variable', variable: { kind: 'local', id: 'VariableID:1:2' } }],
  };
  expect(PortalRecipeInputsSchema.safeParse(inputs).success).toBe(true);
  expect(
    PortalRecipeInputsSchema.safeParse({
      ...inputs,
      options: [
        { kind: 'variable', variable: { kind: 'library', key: 'published-key', import: true } },
      ],
    }).success,
  ).toBe(true);
  expect(
    PortalRecipeInputsSchema.safeParse({
      ...inputs,
      options: [
        { kind: 'variable', variable: { kind: 'local', id: 'VariableID:1:2', import: true } },
      ],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeInputsSchema.safeParse({
      ...inputs,
      options: [{ kind: 'script', code: 'figma.currentPage.remove()' }],
    }).success,
  ).toBe(false);
});

it('uses actual collection and import output field names instead of invented variableId aliases', () => {
  const imported = {
    ...definition,
    recipeId: 'bind-variable',
    effects: ['design-write', 'library-import'],
    steps: [
      { id: 'import', kind: 'tool', tool: 'import_library_variable', refs: [] },
      {
        id: 'bind',
        kind: 'tool',
        tool: 'bind_variable_to_node',
        refs: [{ stepId: 'import', field: 'id', type: 'variable-id' }],
      },
    ],
  };
  expect(PortalRecipeDefinitionSchema.safeParse(imported).success).toBe(true);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...imported,
      steps: [
        imported.steps[0],
        {
          ...imported.steps[1],
          refs: [{ stepId: 'import', field: 'variableId', type: 'variable-id' }],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...imported,
      steps: [
        imported.steps[0],
        { ...imported.steps[1], refs: [{ stepId: 'import', field: 'id', type: 'node-id' }] },
      ],
    }).success,
  ).toBe(false);
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...imported,
      steps: [
        imported.steps[0],
        { ...imported.steps[1], refs: [{ stepId: 'import', field: '$.id', type: 'variable-id' }] },
      ],
    }).success,
  ).toBe(false);
});
