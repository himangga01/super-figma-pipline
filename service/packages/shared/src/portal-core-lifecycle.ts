import { z } from 'zod';

import { isBoundedDesignJson } from './design-observation.js';
import { PORTAL_CORE_RECIPE_IDS, PORTAL_CORE_RECIPE_LIMITS } from './portal-core-limits.js';
import {
  PortalCoreRecipePageSchema,
  PortalRecipeCandidateDeclarationSchema,
} from './portal-recipes.js';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const kind = z.enum(['scope', 'mapping', 'token', 'style', 'asset', 'interaction', 'strategy']);
const required = z
  .object({
    recipeId: z.enum(PORTAL_CORE_RECIPE_IDS),
    definitionHash: hash,
    resultId: hash,
    resultHash: hash,
  })
  .strict();
export const PortalCorePlanBindingSchema = z
  .object({
    recipeAuthorityVersion: z.literal(1),
    status: z.enum(['ready', 'blocked']),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
      .nullable(),
    contractHash: hash,
    requirementsHash: hash,
    preparationId: hash.nullable(),
    contextHash: hash.nullable(),
    inputHash: hash.nullable(),
    requiredResults: z.array(required).max(7),
    workItemsHash: hash.nullable(),
    workItemCount: z.number().int().min(0).max(PORTAL_CORE_RECIPE_LIMITS.pages),
    bindingHash: hash,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.requiredResults.map(row => row.recipeId)).size !==
        value.requiredResults.length ||
      new Set(value.requiredResults.map(row => row.resultId)).size !==
        value.requiredResults.length ||
      (value.preparationId === null &&
        (value.contextHash !== null ||
          value.inputHash !== null ||
          value.workItemsHash !== null ||
          value.workItemCount !== 0 ||
          value.requiredResults.length !== 0)) ||
      (value.preparationId !== null &&
        (value.contextHash === null || value.inputHash === null || value.workItemsHash === null)) ||
      (value.status === 'ready' &&
        (value.preparationId === null ||
          value.requiredResults.length !== 7 ||
          value.code !== null)) ||
      (value.status === 'blocked' && value.code === null)
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_CORE_BINDING_INVALID' });
  });
export type PortalCorePlanBinding = z.infer<typeof PortalCorePlanBindingSchema>;

export const PortalCoreWorkItemSchema = z
  .object({
    id: hash,
    recipeId: z.enum(PORTAL_CORE_RECIPE_IDS),
    resultId: hash,
    resultHash: hash,
    pageHash: hash,
    pageIndex: z
      .number()
      .int()
      .min(0)
      .max(PORTAL_CORE_RECIPE_LIMITS.pages - 1),
    rows: z.number().int().min(1).max(PORTAL_CORE_RECIPE_LIMITS.pageRows),
    kind,
  })
  .strict();
export type PortalCoreWorkItem = z.infer<typeof PortalCoreWorkItemSchema>;

export const PORTAL_CORE_DECLARATION_LIMITS = Object.freeze({
  total: PORTAL_CORE_RECIPE_LIMITS.pages,
  bytes: 8_388_608,
  values: 200_000,
  batch: 64,
  batchBytes: 1_048_576,
});
const declarations = (count: number, bytes: number) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (!isBoundedDesignJson(value, bytes, PORTAL_CORE_DECLARATION_LIMITS.values))
        ctx.addIssue({ code: 'custom', message: 'PORTAL_CORE_DECLARATION_LIMIT' });
    })
    .pipe(
      z
        .array(z.lazy(() => PortalRecipeCandidateDeclarationSchema))
        .max(count)
        .refine(
          rows =>
            new Set(rows.map(row => JSON.stringify([row.resultId, row.outputItemId]))).size ===
            rows.length,
          'PORTAL_CORE_DECLARATION_DUPLICATE',
        ),
    );
export const PortalCoreDeclarationsSchema = declarations(
  PORTAL_CORE_DECLARATION_LIMITS.total,
  PORTAL_CORE_DECLARATION_LIMITS.bytes,
);
export const PortalCoreDeclarationBatchSchema = declarations(
  PORTAL_CORE_DECLARATION_LIMITS.batch,
  PORTAL_CORE_DECLARATION_LIMITS.batchBytes,
);
export type PortalCoreDeclarations = z.infer<typeof PortalCoreDeclarationsSchema>;
export function canonicalCoreDeclarations(input: unknown): PortalCoreDeclarations {
  return PortalCoreDeclarationsSchema.parse(input)
    .map(row =>
      Object.assign({}, row, {
        files: row.files.toSorted((a, b) => compare(a.path, b.path)),
        assertionIds: row.assertionIds.toSorted(),
      }),
    )
    .toSorted((a, b) =>
      compare(
        JSON.stringify([a.resultId, a.outputItemId]),
        JSON.stringify([b.resultId, b.outputItemId]),
      ),
    );
}

// Public transport uses JSON's representable structural codec, then the exact core row validator.
// This preserves runtime page typing without an unrepresentable custom-codec schema in tool hashes.
const wirePage = z
  .unknown()
  .refine(
    value => isBoundedDesignJson(value, PORTAL_CORE_RECIPE_LIMITS.pageBytes, 100_000),
    'CORE_PAGE_INPUT_LIMIT',
  )
  .pipe(
    z
      .object({
        pageVersion: z.literal(1),
        recipeId: z.enum(PORTAL_CORE_RECIPE_IDS),
        index: z
          .number()
          .int()
          .min(0)
          .max(PORTAL_CORE_RECIPE_LIMITS.pages - 1),
        rows: z.array(z.json()).min(1).max(PORTAL_CORE_RECIPE_LIMITS.pageRows),
      })
      .strict()
      .refine(value => PortalCoreRecipePageSchema.safeParse(value).success, 'CORE_PAGE_INVALID'),
  );

export const PortalCoreEvidenceViewSchema = z
  .object({
    binding: PortalCorePlanBindingSchema,
    results: z
      .array(
        z
          .object({
            recipeId: z.enum(PORTAL_CORE_RECIPE_IDS),
            resultId: hash,
            resultHash: hash,
            status: z.enum(['succeeded', 'blocked', 'failed', 'cancelled', 'outcome-unknown']),
            pages: z.number().int().min(0).max(PORTAL_CORE_RECIPE_LIMITS.pages),
            issues: z.number().int().min(0),
            obligations: z.number().int().min(0),
          })
          .strict(),
      )
      .max(7),
    workItems: z.array(PortalCoreWorkItemSchema).max(50),
    declarationStatus: z
      .array(z.object({ workItemId: hash, declared: z.boolean() }).strict())
      .max(50)
      .optional(),
    nextWorkOffset: z.number().int().min(0).max(PORTAL_CORE_RECIPE_LIMITS.pages).nullable(),
    selectedResultId: hash.nullable(),
    pageHash: hash.nullable(),
    page: wirePage.nullable(),
  })
  .strict();
