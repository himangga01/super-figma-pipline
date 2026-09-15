import {
  ActorContextSchema,
  ResultArtifactV1Schema,
  ToolNameSchema,
  OPERATION_CAPTURE_MAX_BYTES,
} from '@sfp/shared';
import { z } from 'zod';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const RecipeEvidenceBindingSchema = z
  .object({
    version: z.literal(1),
    planHash: hash,
    // Opaque recipe identifiers are canonical-hash inputs, never filesystem paths.
    // Match the executable recipe contract without rewriting existing Unicode identifiers.
    stepId: z.string().min(1).max(256),
    operationId: z.string().min(1).max(384),
    actorId: ActorContextSchema.shape.actorId,
    authSessionId: ActorContextSchema.shape.authSessionId,
    workspaceId: z.string().uuid(),
    operationKind: z.literal('tool'),
    operationName: ToolNameSchema,
    targetBindingHash: hash.nullable(),
    argsHash: hash,
    resultSchemaHash: hash,
    maxResultBytes: z.number().int().min(1).max(OPERATION_CAPTURE_MAX_BYTES),
  })
  .strict();
export type RecipeEvidenceBinding = z.infer<typeof RecipeEvidenceBindingSchema>;
export const RecipeEvidenceArgsSchema = z.object({ binding: RecipeEvidenceBindingSchema }).strict();
export const RecipeEvidenceVerifiedSchema = z
  .object({
    receiptHash: hash,
    finalizerHash: hash,
    resultHash: hash,
    resultBytes: z.number().int().min(0).max(OPERATION_CAPTURE_MAX_BYTES),
    resultArtifact: ResultArtifactV1Schema,
  })
  .strict();
export const RecipeEvidenceResultSchema = z
  .object({
    version: z.literal(1),
    holdId: hash,
    binding: RecipeEvidenceBindingSchema,
    state: z.enum(['held', 'released']),
    verified: RecipeEvidenceVerifiedSchema.nullable(),
  })
  .strict();
export type RecipeEvidenceResult = z.infer<typeof RecipeEvidenceResultSchema>;
export const RECIPE_EVIDENCE_OPERATION_NAMES = [
  'recipe.evidence.hold',
  'recipe.evidence.verify',
  'recipe.evidence.release',
] as const;
