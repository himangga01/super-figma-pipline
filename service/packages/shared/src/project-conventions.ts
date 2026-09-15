import { z } from 'zod';

export const CONVENTION_CATEGORIES = [
  'routing',
  'state',
  'dataAccess',
  'imports',
  'theme',
  'accessibility',
  'testing',
] as const;
export const ConventionEvidenceSchema = z
  .object({
    filePath: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    signal: z.string().min(1).max(256),
    kind: z.enum(['import', 'call', 'attribute', 'path']),
    sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
export const ProjectConventionsSchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: z.record(
      z.enum(CONVENTION_CATEGORIES),
      z
        .object({
          status: z.enum(['observed', 'not-observed', 'incomplete']),
          evidence: z.array(ConventionEvidenceSchema).max(32),
        })
        .strict(),
    ),
    inspectedFiles: z.number().int().nonnegative(),
    truncated: z.boolean(),
    unreadFiles: z.array(z.object({ filePath: z.string(), reason: z.string() }).strict()).max(512),
  })
  .strict();
export type ProjectConventions = z.infer<typeof ProjectConventionsSchema>;
export type ConventionEvidence = z.infer<typeof ConventionEvidenceSchema>;
