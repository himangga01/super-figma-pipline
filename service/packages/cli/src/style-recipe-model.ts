import {
  GetFontsResultSchema,
  GetStylesResultSchema,
  StyleResultSchema,
  type GetStylesResult,
  type SerializedTextStyle,
} from '@sfp/shared';
import { z } from 'zod';

import { createTextStyleTool } from '../../mcp/src/tools/create-text-style.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import type { deriveRecipeTypeScale } from './recipe-design-system.js';
import { RecipeAuthoritySchema, recipeError, recipeHash } from './recipe-plan.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const ConcreteTextStyleSchema = z.strictObject({
  name: z.string().min(1).max(512),
  description: z.string().max(16384),
  fontName: z.strictObject({
    family: z.string().min(1).max(256),
    style: z.string().min(1).max(256),
  }),
  fontSize: z.number().finite().positive().max(100000),
  lineHeight: z.union([
    z.strictObject({ unit: z.literal('AUTO') }),
    z.strictObject({
      unit: z.enum(['PIXELS', 'PERCENT']),
      value: z.number().finite().nonnegative(),
    }),
  ]),
  letterSpacing: z.strictObject({
    unit: z.enum(['PIXELS', 'PERCENT']),
    value: z.number().finite(),
  }),
  textWrapStyle: z.enum(['AUTO', 'BALANCE', 'PRETTY']),
});
type ConcreteStyle = z.infer<typeof ConcreteTextStyleSchema>;
const step = z.strictObject({ id: z.string().min(1).max(256), args: ConcreteTextStyleSchema });
const reused = z.strictObject({
  styleId: z.string().min(1).max(512),
  styleHash: hash,
  name: z.string().min(1).max(512),
});
export const StyleRecipeSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!isBoundedDesignJson(value, 262144, 20000))
      ctx.addIssue({ code: 'custom', message: 'RECIPE_STYLE_INPUT_LIMIT' });
  })
  .pipe(
    z
      .strictObject({
        version: z.literal(1),
        kind: z.literal('text-style-catalog'),
        intentId: z.string().min(1).max(256),
        authority: RecipeAuthoritySchema,
        sourceHash: hash,
        fontHash: hash,
        steps: z.array(step).max(126),
        reused: z.array(reused).max(128),
      })
      .superRefine((plan, ctx) => {
        const ids = plan.steps.map(item => item.id),
          names = [
            ...plan.steps.map(item => item.args.name),
            ...plan.reused.map(item => item.name),
          ];
        if (
          new Set(ids).size !== ids.length ||
          ids.some(id => id.startsWith('sfp_internal:')) ||
          new Set(names).size !== names.length
        )
          ctx.addIssue({ code: 'custom', message: 'Duplicate or reserved text-style identity' });
      }),
  );
export type StyleRecipe = z.infer<typeof StyleRecipeSchema>;
const sorted = <T extends { id: string }>(items: T[]) => items.toSorted((a, b) => a.id.localeCompare(b.id));

/** Full style inventory; unresolved inline binding IDs cannot be claimed complete. */
export function styleSnapshot(input: unknown): GetStylesResult {
  if (!isBoundedDesignJson(input, 8388608, 200000)) throw recipeError('RECIPE_STYLE_LIMIT');
  const snapshot = GetStylesResultSchema.parse(input);
  const all = [...snapshot.paints, ...snapshot.texts, ...snapshot.effects, ...snapshot.grids];
  if (new Set(all.map(item => item.id)).size !== all.length)
    throw recipeError('RECIPE_STYLE_IDENTITY_AMBIGUOUS');
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'boundVariables' && child && typeof child === 'object') {
        for (const variableId of Object.values(child))
          if (typeof variableId !== 'string' || !snapshot.variables?.[variableId])
            throw recipeError('RECIPE_STYLE_BINDING_UNRESOLVED');
      } else visit(child);
    }
  };
  visit(all);
  return {
    ...snapshot,
    paints: sorted(snapshot.paints),
    texts: sorted(snapshot.texts),
    effects: sorted(snapshot.effects),
    grids: sorted(snapshot.grids),
  };
}
export const styleSnapshotHash = (input: unknown) => recipeHash(styleSnapshot(input));
export function availableStyleFonts(input: unknown) {
  if (!isBoundedDesignJson(input, 8388608, 200000)) throw recipeError('RECIPE_FONT_LIMIT');
  const result = GetFontsResultSchema.parse(input);
  if (result.scope !== 'available' || result.fonts.length > 10000)
    throw recipeError('RECIPE_FONT_AVAILABILITY_REQUIRED');
  const faces = result.fonts.map(font => recipeHash(font.fontName));
  if (new Set(faces).size !== faces.length) throw recipeError('RECIPE_FONT_AMBIGUOUS');
  return {
    ...result,
    fonts: result.fonts.toSorted((a, b) =>
      recipeHash(a.fontName).localeCompare(recipeHash(b.fontName)),
    ),
  };
}
export function requireStyleCreation(
  snapshotInput: unknown,
  fontsInput: unknown,
  argsInput: unknown,
): ConcreteStyle {
  const snapshot = styleSnapshot(snapshotInput),
    fonts = availableStyleFonts(fontsInput),
    args = ConcreteTextStyleSchema.parse(argsInput);
  createTextStyleTool.inputSchema.strict().parse(args);
  if (snapshot.texts.some(item => item.name === args.name))
    throw recipeError('RECIPE_TEXT_STYLE_NAME_CONFLICT');
  if (
    !fonts.fonts.some(
      item =>
        item.fontName.family === args.fontName.family &&
        item.fontName.style === args.fontName.style,
    )
  )
    throw recipeError('RECIPE_FONT_FACE_UNAVAILABLE');
  return args;
}
/** Only a retained actual StyleResult may select the newly generated ID/key in poststate. */
export function reconcileTextStyleCreation(
  beforeInput: unknown,
  afterInput: unknown,
  fonts: unknown,
  argsInput: unknown,
  resultInput: unknown,
): GetStylesResult {
  const before = styleSnapshot(beforeInput),
    after = styleSnapshot(afterInput),
    args = requireStyleCreation(before, fonts, argsInput),
    result = StyleResultSchema.parse(resultInput);
  const created = after.texts.find(item => item.id === result.styleId);
  if (
    !created ||
    result.name !== args.name ||
    !created.key ||
    [...before.paints, ...before.texts, ...before.effects, ...before.grids].some(
      item => item.id === result.styleId || item.key === created.key,
    )
  )
    throw recipeError('RECIPE_STYLE_GENERATED_ID');
  const expected: GetStylesResult = {
    ...before,
    texts: [...before.texts, { ...args, id: result.styleId, key: created.key }],
  };
  if (styleSnapshotHash(expected) !== recipeHash(after)) throw recipeError('RECIPE_STYLE_CHANGED');
  return after;
}
const typography = (style: ConcreteStyle | SerializedTextStyle) => ({
  fontName: style.fontName,
  fontSize: style.fontSize,
  lineHeight: style.lineHeight,
  letterSpacing: style.letterSpacing,
  textWrapStyle: style.textWrapStyle,
  boundVariables: 'boundVariables' in style ? (style.boundVariables ?? {}) : {},
});
export function compileTypeScaleStyleRecipe(input: {
  intentId: string;
  authority: StyleRecipe['authority'];
  styles: unknown;
  fonts: unknown;
  scale: ReturnType<typeof deriveRecipeTypeScale>;
}): StyleRecipe {
  const styles = styleSnapshot(input.styles),
    fonts = availableStyleFonts(input.fonts);
  if (input.scale.status !== 'ready-to-plan') throw recipeError('RECIPE_TYPE_SCALE_BLOCKED');
  const steps: StyleRecipe['steps'] = [],
    reusedStyles: StyleRecipe['reused'] = [];
  for (const [index, row] of input.scale.rows.entries()) {
    const args = ConcreteTextStyleSchema.parse({ ...row.args, description: '' });
    const found = styles.texts.filter(item => item.name === args.name);
    if (
      found.length > 1 ||
      (found.length === 1 && recipeHash(typography(found[0]!)) !== recipeHash(typography(args)))
    )
      throw recipeError('RECIPE_TEXT_STYLE_NAME_CONFLICT');
    if (found.length === 1)
      reusedStyles.push({
        styleId: found[0]!.id,
        styleHash: recipeHash(found[0]),
        name: args.name,
      });
    else {
      requireStyleCreation(styles, fonts, args);
      steps.push({ id: `style-${index}`, args });
    }
  }
  return StyleRecipeSchema.parse({
    version: 1,
    kind: 'text-style-catalog',
    intentId: input.intentId,
    authority: input.authority,
    sourceHash: recipeHash(styles),
    fontHash: recipeHash(fonts),
    steps,
    reused: reusedStyles,
  });
}
