import { expect, it } from 'vitest';

import {
  CatalogRecipeSchema,
  catalogSnapshotHash,
  compilePaletteCatalogRecipe,
  reconcileCatalogRecipe,
  resolveCatalogRecipeArgs,
} from '../src/catalog-recipe.js';
import { deriveRecipePalette } from '../src/recipe-design-system.js';

const hash = `sha256:${'a'.repeat(64)}`;
const authority = {
  actorId: 'owner',
  authSessionId: 'auth',
  workspaceId: '123e4567-e89b-12d3-a456-426614174000',
  sessionId: 'plugin',
  leaderGeneration: 'leader',
  pluginGenerationHash: hash,
  fileIdentityHash: hash,
  targetBindingHash: hash,
  credentialHash: 'b'.repeat(64),
};
const empty = { collections: [], variables: [] };
const base = {
  version: 1,
  kind: 'variable-catalog',
  intentId: 'test',
  authority,
  sourceHash: catalogSnapshotHash(empty),
};

it('catalog plan rejects wrong or forward fields, long IDs and typed values before effects', () => {
  for (const args of [
    {
      name: 'zero',
      resolvedType: 'FLOAT',
      collectionId: { stepId: 'later', field: 'collectionId' },
      initialValues: [{ modeId: 'M', value: 0 }],
    },
    {
      name: 'zero',
      resolvedType: 'FLOAT',
      collectionId: 'C',
      initialValues: [{ modeId: 'M', value: '0' }],
    },
    {
      name: 'zero',
      resolvedType: 'FLOAT',
      collectionId: 'C',
      initialValues: [
        { modeId: 'M', value: 0 },
        { modeId: 'M', value: 1 },
      ],
    },
  ])
    expect(
      CatalogRecipeSchema.safeParse({
        ...base,
        steps: [{ id: 'value', tool: 'create_variable', args }],
      }).success,
    ).toBe(false);
  expect(
    CatalogRecipeSchema.safeParse({
      ...base,
      steps: [
        {
          id: 'x'.repeat(257),
          tool: 'create_variable_collection',
          args: { name: 'Tokens', defaultModeName: 'Light' },
        },
      ],
    }).success,
  ).toBe(false);
});

it('catalog snapshot rejects incomplete local membership instead of blessing a partial inventory', () => {
  expect(() =>
    catalogSnapshotHash({
      collections: [
        {
          id: 'C',
          key: 'key',
          name: 'Tokens',
          defaultModeId: 'M',
          modes: [{ modeId: 'M', name: 'Light' }],
          variableIds: ['V'],
        },
      ],
      variables: [],
    }),
  ).toThrow('RECIPE_CATALOG_INCOMPLETE');
});

it('new collection reconciliation preserves existing entries and requires the declared actual mode name', () => {
  const plan = CatalogRecipeSchema.parse({
    ...base,
    steps: [
      {
        id: 'collection',
        tool: 'create_variable_collection',
        args: { name: 'Tokens', defaultModeName: 'Light' },
      },
    ],
  });
  const step = plan.steps[0]!;
  const created = {
    id: 'C',
    key: 'generated-key',
    name: 'Tokens',
    defaultModeId: 'M',
    modes: [{ modeId: 'M', name: 'Light' }],
    variableIds: [],
  };
  const result = { ok: true, collectionId: 'C', defaultModeId: 'M', name: 'Tokens' };
  expect(
    reconcileCatalogRecipe(
      empty,
      { collections: [created], variables: [] },
      step,
      step.args,
      result,
    ).collections,
  ).toEqual([created]);
  expect(() =>
    reconcileCatalogRecipe(
      empty,
      { collections: [{ ...created, modes: [{ modeId: 'M', name: 'Mode 1' }] }], variables: [] },
      step,
      step.args,
      result,
    ),
  ).toThrow('RECIPE_CATALOG_CHANGED');
  expect(() =>
    reconcileCatalogRecipe(
      empty,
      { collections: [created, { ...created, id: 'unrelated' }], variables: [] },
      step,
      step.args,
      result,
    ),
  ).toThrow('RECIPE_CATALOG_CHANGED');
});

it('palette compilation initializes all observed modes with native backward aliases and no silent paired fallback', () => {
  const palette = deriveRecipePalette({
    primary: '#336699',
    dark: true,
    modeStrategy: 'single-collection',
  });
  const plan = compilePaletteCatalogRecipe({
    intentId: 'palette',
    authority,
    sourceHash: base.sourceHash,
    namespace: 'Test',
    palette,
  });
  const collection = plan.steps.find(row => row.id === 'semantic-0')!;
  expect(collection.args).toMatchObject({ defaultModeName: 'Light' });
  expect(plan.steps.filter(row => row.tool === 'add_variable_mode')).toHaveLength(1);
  const alias = plan.steps.find(row => row.id === 'semantic-0-alias-0')!;
  const results = new Map<string, unknown>();
  for (const step of plan.steps) {
    if (step.tool === 'create_variable_collection')
      results.set(step.id, { collectionId: step.id, defaultModeId: step.id + ':mode' });
    if (step.tool === 'add_variable_mode') results.set(step.id, { modeId: 'real-dark-mode' });
    if (step.tool === 'create_variable') results.set(step.id, { variableId: 'actual-' + step.id });
  }
  const args = resolveCatalogRecipeArgs(alias, results);
  expect(args.initialValues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        modeId: 'semantic-0:mode',
        value: { type: 'VARIABLE_ALIAS', id: expect.stringMatching(/^actual-primitive-/u) },
      }),
      expect.objectContaining({
        modeId: 'real-dark-mode',
        value: { type: 'VARIABLE_ALIAS', id: expect.stringMatching(/^actual-primitive-/u) },
      }),
    ]),
  );
  const paired = compilePaletteCatalogRecipe({
    intentId: 'paired',
    authority,
    sourceHash: base.sourceHash,
    namespace: 'Test',
    palette: deriveRecipePalette({
      primary: '#336699',
      dark: true,
      modeStrategy: 'paired-collections',
    }),
  });
  expect(paired.steps.some(row => row.tool === 'add_variable_mode')).toBe(false);
});
