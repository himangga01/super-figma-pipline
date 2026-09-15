import { contentHash } from '@sfp/ir';
import {
  PORTAL_RECIPE_IDS,
  PORTAL_RECIPE_TOOL_EFFECTS,
  PortalRecipeDefinitionSchema,
  type Effect,
  type PortalRecipeDefinition,
} from '@sfp/shared';
import { expect, it } from 'vitest';

import { OPERATION_POLICIES } from '../../src/policy/operation-policy.js';
import { CORE_RECIPE_CONTRACT_HASH } from '../../src/portal/recipes/core-derivation.js';
import {
  PORTAL_RECIPE_CATALOG,
  PORTAL_RECIPE_DEFINITIONS,
  portalRecipeDefinitionHash,
  portalRecipeInputContextHash,
  portalRecipeResultHash,
  portalRecipeBlueprintBindingHash,
  portalRecipeDeclarationsHash,
  portalRecipeConsumptionContentHash,
  validatePortalRecipeDefinitions,
  validatePortalRecipeResultBinding,
} from '../../src/portal/recipes/definitions.js';
import {
  PORTAL_RECIPE_FEATURE_INVENTORY,
  validatePortalRecipeFeatureInventory,
} from '../../src/portal/recipes/feature-inventory.js';

const hash = `sha256:${'a'.repeat(64)}`;
const source = { kind: 'capture', captureHash: hash, itemId: '1:2' };
const lookup = (id: (typeof PORTAL_RECIPE_IDS)[number]) =>
  PORTAL_RECIPE_DEFINITIONS.find(row => row.recipeId === id)!;

it('inventories all original non-tool surfaces and maps every non-rejected feature in both directions', () => {
  const counts = [
    ['rust.skill.', 13],
    ['rust.prompt.', 12],
    ['figwright.skill.', 2],
    ['figwright.reference.', 10],
    ['figmosha.helper.', 20],
    ['figmosha.cli.', 12],
  ] as const;
  for (const [prefix, count] of counts)
    expect(
      PORTAL_RECIPE_FEATURE_INVENTORY.filter(row => row.featureId.startsWith(prefix)),
    ).toHaveLength(count);
  expect(PORTAL_RECIPE_FEATURE_INVENTORY).toHaveLength(69);
  expect(PORTAL_RECIPE_CATALOG).toHaveLength(PORTAL_RECIPE_IDS.length);
  for (const feature of PORTAL_RECIPE_FEATURE_INVENTORY) {
    expect(feature.implementation).toBe(
      feature.semanticDisposition === 'rejected' ? 'not-applicable' : 'planned',
    );
    for (const recipeId of feature.recipeIds)
      expect(lookup(recipeId).featureIds).toContain(feature.featureId);
    expect(feature.path).not.toMatch(/(^|\/)\.\.(\/|$)/);
  }
  const rejected = PORTAL_RECIPE_FEATURE_INVENTORY.filter(
    row => row.semanticDisposition === 'rejected',
  );
  expect(rejected.map(row => row.featureId)).toEqual(['figmosha.cli.exec']);
  expect(rejected[0]!.recipeIds).toEqual([]);
  for (const definition of PORTAL_RECIPE_DEFINITIONS)
    expect(Object.isFrozen(definition.steps)).toBe(true);
  for (const definition of PORTAL_RECIPE_DEFINITIONS.filter(
    row => row.outputSchemaId === 'sfp.recipe.core-manifest.v1',
  )) {
    expect(definition.execution).toBe('implemented');
    expect(definition.implementationHash).toBe(CORE_RECIPE_CONTRACT_HASH);
  }
  for (const definition of PORTAL_RECIPE_DEFINITIONS.filter(
    row => row.outputSchemaId !== 'sfp.recipe.core-manifest.v1',
  )) {
    expect(definition.execution).toBe('planned');
    expect(definition.prerequisites).toContain('recipe-executor-and-verifier-not-integrated');
  }
});

it('rejects duplicate catalog identities and forged missing implementation claims', () => {
  expect(() =>
    validatePortalRecipeDefinitions([lookup('ground-design'), lookup('ground-design')]),
  ).toThrow('PORTAL_RECIPE_DUPLICATE_DEFINITION');
  expect(() =>
    validatePortalRecipeFeatureInventory([
      PORTAL_RECIPE_FEATURE_INVENTORY[0],
      PORTAL_RECIPE_FEATURE_INVENTORY[0],
    ]),
  ).toThrow('PORTAL_RECIPE_DUPLICATE_FEATURE');
  expect(
    PortalRecipeDefinitionSchema.safeParse({
      ...lookup('assemble-frame'),
      execution: 'implemented',
    }).success,
  ).toBe(false);
  expect(() =>
    validatePortalRecipeDefinitions([
      { ...lookup('ground-design'), featureIds: ['rust.skill.invented'] },
    ]),
  ).toThrow('PORTAL_RECIPE_UNKNOWN_FEATURE');
  expect(() =>
    validatePortalRecipeDefinitions([
      { ...lookup('ground-design'), featureIds: ['rust.skill.bulk-rename'] },
    ]),
  ).toThrow('PORTAL_RECIPE_FEATURE_MAPPING_MISMATCH');
});

it('binds definition behavior, verifier, schema and ordered steps into immutable identities', () => {
  const definition = lookup('assemble-frame'),
    before = portalRecipeDefinitionHash(definition);
  expect(portalRecipeDefinitionHash(JSON.parse(JSON.stringify(definition)))).toBe(before);
  expect(portalRecipeDefinitionHash({ ...definition, behaviorVersion: 'changed.v2' })).not.toBe(
    before,
  );
  expect(portalRecipeDefinitionHash({ ...definition, verifierVersion: 'changed.v2' })).not.toBe(
    before,
  );
  expect(
    portalRecipeDefinitionHash({ ...definition, outputSchemaId: 'sfp.recipe.strategy.v1' }),
  ).not.toBe(before);
  expect(
    portalRecipeDefinitionHash({ ...definition, steps: definition.steps.slice(0, -1) }),
  ).not.toBe(before);
  for (const row of PORTAL_RECIPE_CATALOG)
    expect(row.definitionHash).toBe(portalRecipeDefinitionHash(row.definition));
});

it('canonicalizes required result and definition selection order without feeding results into context', () => {
  const a = {
    recipeId: 'ground-design',
    definitionHash: portalRecipeDefinitionHash(lookup('ground-design')),
    required: true,
    applicability: 'applicable',
    evidence: [source],
  };
  const b = {
    ...a,
    recipeId: 'audit-styles',
    definitionHash: portalRecipeDefinitionHash(lookup('audit-styles')),
  };
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
    selections: [a, b],
  };
  const contextHash = portalRecipeInputContextHash(context);
  expect(portalRecipeInputContextHash({ ...context, selections: [b, a] })).toBe(contextHash);
  const first = {
    recipeId: a.recipeId,
    definitionHash: a.definitionHash,
    resultId: 'r1',
    resultHash: hash,
  };
  const second = {
    recipeId: b.recipeId,
    definitionHash: b.definitionHash,
    resultId: 'r2',
    resultHash: hash,
  };
  const blueprint = {
    recipeAuthorityVersion: 1,
    contextHash,
    requirementsHash: hash,
    requiredResults: [first, second],
  };
  expect(portalRecipeBlueprintBindingHash(blueprint)).toBe(
    portalRecipeBlueprintBindingHash({ ...blueprint, requiredResults: [second, first] }),
  );
  expect(() => portalRecipeInputContextHash({ ...context, requiredResults: [first] })).toThrow(
    /Unrecognized key/u,
  );
});

it('requires exact successful result binding and actual output bytes, not receipt-name mentions', () => {
  const definition = lookup('describe-tree');
  const output = {
    schemaId: 'sfp.recipe.grounding.v1',
    roots: [
      { nodeId: '1:2', decision: 'included', reason: 'Required source root', evidence: [source] },
    ],
    capabilities: [{ name: 'tree', status: 'complete', evidenceHash: hash }],
  };
  const result = {
    recipeAuthorityVersion: 1,
    resultId: 'result',
    ownerId: 'owner',
    workspaceId: 'workspace',
    contextHash: hash,
    recipeId: 'describe-tree',
    definitionHash: portalRecipeDefinitionHash(definition),
    inputHash: hash,
    status: 'succeeded',
    output,
    outputHash: contentHash('sfp-portal-recipe-output-v1', output),
    evidence: [source],
  };
  const expected = {
    ownerId: 'owner',
    workspaceId: 'workspace',
    contextHash: hash,
    inputHash: hash,
  };
  expect(validatePortalRecipeResultBinding(result, definition, expected)).toEqual(result);
  expect(() =>
    validatePortalRecipeResultBinding(result, definition, { ...expected, ownerId: 'other' }),
  ).toThrow('PORTAL_RECIPE_RESULT_BINDING_MISMATCH');
  expect(() =>
    validatePortalRecipeResultBinding({ ...result, outputHash: hash }, definition, expected),
  ).toThrow('PORTAL_RECIPE_OUTPUT_MISMATCH');
  expect(() => portalRecipeResultHash({ ...result, outputHash: hash })).toThrow(
    'PORTAL_RECIPE_OUTPUT_MISMATCH',
  );
  const changed = {
    ...result,
    output: { ...output, roots: [{ ...output.roots[0], reason: 'Changed source observation' }] },
  };
  expect(() => validatePortalRecipeResultBinding(changed, definition, expected)).toThrow(
    'PORTAL_RECIPE_OUTPUT_MISMATCH',
  );
  const { output: _output, outputHash: _outputHash, ...identity } = result;
  const failed = { ...identity, status: 'failed', code: 'CAPTURE_FAILED' };
  expect(() => validatePortalRecipeResultBinding(failed, definition, expected)).toThrow(
    'PORTAL_RECIPE_RESULT_NOT_SUCCEEDED',
  );
});

it('binds exact candidate declarations independently from a future candidate hash', () => {
  const declaration = {
    resultId: 'r',
    resultHash: hash,
    outputItemId: 'token-1',
    kind: 'token',
    files: [
      { path: 'src/tokens.css', hash },
      { path: 'src/app.ts', hash },
    ],
    assertionIds: ['home', 'dark'],
  };
  const before = portalRecipeDeclarationsHash([declaration]);
  expect(
    portalRecipeDeclarationsHash([
      {
        ...declaration,
        files: declaration.files.toReversed(),
        assertionIds: declaration.assertionIds.toReversed(),
      },
    ]),
  ).toBe(before);
  expect(
    portalRecipeDeclarationsHash([
      { ...declaration, files: [{ path: 'src/tokens.css', hash: `sha256:${'b'.repeat(64)}` }] },
    ]),
  ).not.toBe(before);
  expect(() => portalRecipeDeclarationsHash([{ ...declaration, candidateHash: hash }])).toThrow(
    /Unrecognized key/u,
  );
});

it('retains precise pending prerequisites instead of claiming convenience helpers are implemented aliases', () => {
  expect(lookup('convert-annotations').prerequisites).toContain(
    'canonical-annotation-writer-missing',
  );
  expect(lookup('author-motion').prerequisites).toContain(
    'experimental-host-motion-api-and-temporal-readback',
  );
  expect(
    PORTAL_RECIPE_FEATURE_INVENTORY.find(row => row.featureId === 'figmosha.helper.findByName')!
      .intent,
  ).toContain('case-sensitive');
  expect(
    PORTAL_RECIPE_FEATURE_INVENTORY.find(row => row.featureId === 'figmosha.helper.importComp')!
      .intent,
  ).toContain('adaptation');
});

const recipeEffect = (effect: Effect): PortalRecipeDefinition['effects'][number] => {
  switch (effect.type) {
    case 'figma-read':
    case 'filesystem-read':
      return 'read';
    case 'filesystem-write':
      return 'artifact-write';
    case 'figma-write':
      return 'design-write';
    case 'figma-library-import':
      return 'library-import';
    default:
      throw new Error(`Unmapped canonical recipe effect: ${effect.type}`);
  }
};

it('covers every actual possible canonical effect for all supported recipe step tools', () => {
  for (const [name, effects] of Object.entries(PORTAL_RECIPE_TOOL_EFFECTS)) {
    const policy = OPERATION_POLICIES[name];
    expect(policy).toBeDefined();
    const expected = [...new Set(policy!.possibleEffects.map(recipeEffect))];
    expect({ name, effects: effects.toSorted() }).toEqual({ name, effects: expected.toSorted() });
    const definition = {
      ...lookup('describe-tree'),
      effects,
      steps: [{ id: 'step', kind: 'tool', tool: name, refs: [] }],
    };
    expect({ name, valid: PortalRecipeDefinitionSchema.safeParse(definition).success }).toEqual({
      name,
      valid: true,
    });
    for (const needed of expected) {
      const omitted = [...effects.filter(effect => effect !== needed), 'derive'];
      expect(
        PortalRecipeDefinitionSchema.safeParse({ ...definition, effects: omitted }).success,
        `${name} omits ${needed}`,
      ).toBe(false);
    }
  }
  for (const definition of PORTAL_RECIPE_DEFINITIONS)
    for (const step of definition.steps) {
      if (step.kind === 'derive') continue;
      for (const effect of OPERATION_POLICIES[step.tool]!.possibleEffects)
        expect(definition.effects, `${definition.recipeId}:${step.tool}`).toContain(
          recipeEffect(effect),
        );
    }
});

it('refuses narrow read/export/local-library claims without a constrained canonical branch', () => {
  for (const [id, effects] of [
    ['diff-design', ['read']],
    ['export-handoff', ['artifact-write']],
    ['transfer-instance-overrides', ['read', 'design-write']],
    ['instantiate-component', ['read', 'design-write']],
  ] as const)
    expect({
      id,
      valid: PortalRecipeDefinitionSchema.safeParse({ ...lookup(id), effects }).success,
    }).toEqual({ id, valid: false });
});

it('consumption identity cannot be transplanted to a different candidate, target or evidence', () => {
  const otherHash = `sha256:${'b'.repeat(64)}`;
  const receipt = {
    recipeAuthorityVersion: 1,
    ownerId: 'owner',
    workspaceId: 'workspace',
    contextHash: hash,
    blueprintHash: hash,
    candidateHash: hash,
    target: 'candidate',
    verifierVersion: 'scope.v1',
    resultHashes: [hash, otherHash],
    declarationsHash: hash,
    findings: [
      {
        kind: 'runtime',
        assertionId: 'home',
        observationId: 'home-default',
        rootNodeId: '1:2',
        route: '/',
        stateId: 'default',
        viewport: { width: 1440, height: 900 },
        expectedHash: hash,
        actualHash: hash,
        evidenceHash: hash,
      },
    ],
  };
  const identity = portalRecipeConsumptionContentHash(receipt);
  expect(
    portalRecipeConsumptionContentHash({
      ...receipt,
      resultHashes: receipt.resultHashes.toReversed(),
    }),
  ).toBe(identity);
  for (const change of [
    { candidateHash: otherHash },
    { target: 'applied' },
    { ownerId: 'another-owner' },
    { workspaceId: 'another-workspace' },
    { blueprintHash: otherHash },
    { declarationsHash: otherHash },
    { verifierVersion: 'scope.v2' },
    { resultHashes: [hash] },
    { findings: [{ ...receipt.findings[0], evidenceHash: otherHash }] },
    { findings: [{ ...receipt.findings[0], rootNodeId: '3:4' }] },
    { findings: [{ ...receipt.findings[0], stateId: 'hidden-unrelated' }] },
  ])
    expect(portalRecipeConsumptionContentHash({ ...receipt, ...change })).not.toBe(identity);
  expect(() =>
    portalRecipeConsumptionContentHash({ ...receipt, findings: [{ reviewed: true }] }),
  ).toThrow(/Invalid discriminator value/u);
});

it('executes only the seven fixed core definitions with the current manifest and implementation identity', () => {
  const implemented = PORTAL_RECIPE_DEFINITIONS.filter(row => row.execution === 'implemented');
  expect(implemented.map(row => row.recipeId).toSorted()).toEqual(
    [
      'ground-design',
      'map-design',
      'derive-tokens',
      'audit-styles',
      'resolve-assets',
      'derive-interactions',
      'plan-design-implementation',
    ].toSorted(),
  );
  for (const row of implemented) {
    expect(row.outputSchemaId).toBe('sfp.recipe.core-manifest.v1');
    expect(row.implementationHash).toBe(CORE_RECIPE_CONTRACT_HASH);
    expect(row.prerequisites).not.toContain('recipe-executor-and-verifier-not-integrated');
    expect(row.effects).toEqual(['derive']);
    expect(row.steps).toEqual([
      { id: 'derive', kind: 'derive', algorithm: row.recipeId, refs: [] },
    ]);
  }
  expect(() =>
    validatePortalRecipeDefinitions([{ ...lookup('ground-design'), implementationHash: hash }]),
  ).toThrow('PORTAL_RECIPE_IMPLEMENTATION_MISMATCH');
});
