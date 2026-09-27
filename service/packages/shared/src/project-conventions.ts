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
/** Evidence rows kept per category. A full sample is not incompleteness; `count` stays exact. */
export const CONVENTION_EVIDENCE_SAMPLE_SIZE = 32;
export const ProjectConventionsSchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: z.record(
      z.enum(CONVENTION_CATEGORIES),
      z
        .object({
          status: z.enum(['observed', 'not-observed', 'incomplete']),
          /** Deterministic sample: the first distinct rows in walk and syntax-tree order. */
          evidence: z.array(ConventionEvidenceSchema).max(CONVENTION_EVIDENCE_SAMPLE_SIZE),
          /** Exact number of distinct rows observed, sampled or not. Absent before T26. */
          count: z.number().int().nonnegative().optional(),
        })
        .strict()
        .refine(
          category => category.count === undefined || category.count >= category.evidence.length,
          'The exact count cannot be smaller than its sample',
        ),
    ),
    inspectedFiles: z.number().int().nonnegative(),
    /** Some effective input was not read or not fully parsed; `unreadFiles` names each one. */
    truncated: z.boolean(),
    unreadFiles: z.array(z.object({ filePath: z.string(), reason: z.string() }).strict()).max(512),
  })
  .strict();
export type ProjectConventions = z.infer<typeof ProjectConventionsSchema>;
export type ConventionEvidence = z.infer<typeof ConventionEvidenceSchema>;
