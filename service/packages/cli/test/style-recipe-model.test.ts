import { expect, it, vi } from 'vitest';

import { deriveRecipeTypeScale } from '../src/recipe-design-system.js';
import { recipeHash } from '../src/recipe-plan.js';
import {
  availableStyleFonts,
  compileTypeScaleStyleRecipe,
  reconcileTextStyleCreation,
  requireStyleCreation,
  styleSnapshot,
  StyleRecipeSchema,
} from '../src/style-recipe-model.js';

const empty = { paints: [], texts: [], effects: [], grids: [] };
const fonts = {
  scope: 'available',
  fonts: ['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({
    fontName: { family: 'Inter', style },
    count: 0,
  })),
};
const args = {
  name: 'Body',
  description: '',
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'PIXELS', value: 24 },
  letterSpacing: { unit: 'PERCENT', value: 0 },
  textWrapStyle: 'AUTO',
};
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

it('requires real available-font scope and an exact face before a style effect', () => {
  expect(() => availableStyleFonts({ fonts: fonts.fonts })).toThrow(
    'RECIPE_FONT_AVAILABILITY_REQUIRED',
  );
  expect(() => availableStyleFonts({ ...fonts, fonts: [fonts.fonts[0], fonts.fonts[0]] })).toThrow(
    'RECIPE_FONT_AMBIGUOUS',
  );
  expect(() => requireStyleCreation(empty, { ...fonts, fonts: [] }, args)).toThrow(
    'RECIPE_FONT_FACE_UNAVAILABLE',
  );
  expect(requireStyleCreation(empty, fonts, args)).toEqual(args);
});
it('never invents defaults or accepts unresolved style binding references', () => {
  expect(() => requireStyleCreation(empty, fonts, { name: 'Body' })).toThrow(
    /fontName|description/u,
  );
  expect(() =>
    styleSnapshot({
      ...empty,
      texts: [{ ...args, id: 'T', key: 'key', boundVariables: { fontSize: 'missing' } }],
    }),
  ).toThrow('RECIPE_STYLE_BINDING_UNRESOLVED');
});
it('reconciles actual exported create/get handlers, including font preflight and unchanged other catalogs', async () => {
  const create = await vi.importActual<{
    createCreateTextStyleHandler: (context: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/create-text-style.js');
  const read = await vi.importActual<{
    createGetStylesHandler: (context: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/get-styles.js');
  const calls: string[] = [],
    texts: Array<Record<string, unknown>> = [];
  const paints = [
    { id: 'paint', key: 'paint-key', name: 'Existing', description: 'Keep', paints: [] },
  ];
  const context = {
    loadFontAsync: async (font: { family: string; style: string }) => {
      calls.push(`${font.family}/${font.style}`);
    },
    createTextStyle: () => {
      calls.push('create');
      const style = {
        id: 'generated',
        key: 'generated-key',
        name: 'Text style',
        description: 'Host default',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        textWrapStyle: 'AUTO',
        boundVariables: {},
        remove: () => {},
      };
      texts.push(style);
      return style;
    },
    getLocalTextStylesAsync: async () => texts,
    getLocalPaintStylesAsync: async () => paints,
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
  const get = read.createGetStylesHandler(context),
    before = await get({});
  const result = await create.createCreateTextStyleHandler(context)(args);
  const after = await get({});
  expect(calls.slice(0, 2)).toEqual(['Inter/Regular', 'create']);
  expect(reconcileTextStyleCreation(before, after, fonts, args, result).texts[0]).toMatchObject({
    ...args,
    id: 'generated',
  });
  paints[0]!.description = 'Concurrent change';
  expect(() =>
    reconcileTextStyleCreation(before, { ...(after as object), paints }, fonts, args, result),
  ).toThrow('RECIPE_STYLE_CHANGED');
});
it('a returned style ID cannot capture an existing style or unchecked host typography', () => {
  const result = { ok: true, styleId: 'T', name: 'Body' },
    created = { ...args, id: 'T', key: 'key' };
  expect(() =>
    reconcileTextStyleCreation(
      empty,
      { ...empty, texts: [{ ...created, fontSize: 20 }] },
      fonts,
      args,
      result,
    ),
  ).toThrow('RECIPE_STYLE_CHANGED');
  expect(() =>
    reconcileTextStyleCreation(
      {
        ...empty,
        paints: [{ id: 'T', key: 'other-key', name: 'Paint', description: '', paints: [] }],
      },
      { ...empty, texts: [created] },
      fonts,
      args,
      result,
    ),
  ).toThrow('RECIPE_STYLE_GENERATED_ID');
});
it('type scale compilation binds exact reuse and emits fully specified missing style writes', () => {
  const scale = deriveRecipeTypeScale({ request: { family: 'Inter', base: 16 }, fonts });
  const existing = {
    ...scale.rows[0]!.args,
    description: 'Preserve designer note',
    id: 'existing',
    key: 'key',
  };
  const plan = compileTypeScaleStyleRecipe({
    intentId: 'scale',
    authority,
    fonts,
    styles: { ...empty, texts: [existing] },
    scale,
  });
  expect(plan.reused).toEqual([
    { styleId: 'existing', styleHash: recipeHash(existing), name: existing.name },
  ]);
  expect(plan.steps).toHaveLength(scale.rows.length - 1);
  expect(
    plan.steps.every(step => step.args.description === '' && step.args.fontName.family === 'Inter'),
  ).toBe(true);
  expect(() =>
    compileTypeScaleStyleRecipe({
      intentId: 'bad',
      authority,
      fonts,
      styles: { ...empty, texts: [{ ...existing, fontSize: 999 }] },
      scale,
    }),
  ).toThrow('RECIPE_TEXT_STYLE_NAME_CONFLICT');
});
it('style plan rejects duplicate names and reserved or too-long operation identifiers', () => {
  const base = {
    version: 1,
    kind: 'text-style-catalog',
    intentId: 'styles',
    authority,
    sourceHash: hash,
    fontHash: hash,
    reused: [],
  };
  expect(
    StyleRecipeSchema.safeParse({ ...base, steps: [{ id: 'sfp_internal:reserved', args }] })
      .success,
  ).toBe(false);
  expect(
    StyleRecipeSchema.safeParse({ ...base, steps: [{ id: 'a'.repeat(257), args }] }).success,
  ).toBe(false);
  expect(
    StyleRecipeSchema.safeParse({
      ...base,
      steps: [
        { id: 'one', args },
        { id: 'two', args },
      ],
    }).success,
  ).toBe(false);
});
