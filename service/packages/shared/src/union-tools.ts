import { z } from 'zod';

export const ExportTokensArgsSchema = z
  .object({
    format: z.enum(['json', 'css']),
    mode: z.string().min(1).optional(),
    outPath: z.string().min(1).optional(),
  })
  .strict();
export const ExportTokensResultSchema = z
  .object({
    format: z.enum(['json', 'css']),
    content: z.string().optional(),
    path: z.string().optional(),
    tokenCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  })
  .strict();
export const ExportFramesToPdfArgsSchema = z
  .object({
    nodeIds: z
      .array(z.string().min(1))
      .min(1)
      .max(256)
      .refine(ids => new Set(ids).size === ids.length, 'duplicate node IDs'),
    outPath: z.string().min(1),
  })
  .strict();
export const ExportFramesToPdfResultSchema = z
  .object({
    path: z.string(),
    nodeIds: z.array(z.string()),
    pageCount: z.number().int().positive(),
    bytesWritten: z.number().int().positive(),
    warnings: z.array(z.string()),
  })
  .strict();
export const DoctorArgsSchema = z.object({ roundTrip: z.boolean().optional() }).strict();
export const DoctorResultSchema = z
  .object({
    overall: z.enum(['healthy', 'degraded', 'unavailable']),
    checks: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            status: z.enum(['pass', 'warn', 'fail']),
            code: z.string().min(1).max(128),
            message: z.string().max(1024),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export const ImportLibraryVariableArgsSchema = z
  .object({ key: z.string().trim().min(1).max(512) })
  .strict();
export const ImportLibraryVariableResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    key: z.string(),
    name: z.string(),
    resolvedType: z.string(),
    collectionId: z.string(),
  })
  .strict();
export type DoctorResult = z.infer<typeof DoctorResultSchema>;
