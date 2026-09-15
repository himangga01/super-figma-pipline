import { z } from 'zod';

const visit = {
  nodeId: z.string().min(1).max(512),
  planPath: z.array(z.string().min(1).max(512)).min(1).max(10),
  order: z.number().int().nonnegative(),
  depth: z.number().int().min(0).max(9),
};
export const SectionVisitSchema = z
  .object({ ...visit, status: z.enum(['expanded-plan', 'complete-leaf']) })
  .strict();
export const SectionIssueSchema = z
  .object({
    ...visit,
    status: z.enum(['failed', 'omitted-cycle', 'omitted-depth', 'omitted-section-cap']),
    code: z.string().min(1).max(128),
  })
  .strict();
export const SnapshotFidelitySchema = z
  .object({
    detail: z.literal('full'),
    truncated: z.boolean(),
    omitted: z.array(z.string().max(512)).max(16_384),
    unsupported: z.array(z.string().max(512)).max(16_384),
    visitedCount: z.number().int().min(0).max(256),
    expandedSections: z.array(SectionVisitSchema).max(256),
    completeLeafSections: z.array(SectionVisitSchema).max(256),
    issues: z.array(SectionIssueSchema).max(16_384),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.truncated &&
      (value.issues.length > 0 || value.omitted.length > 0 || value.unsupported.length > 0)
    )
      ctx.addIssue({ code: 'custom', message: 'incomplete fidelity cannot claim completeness' });
    if (value.expandedSections.length + value.completeLeafSections.length > value.visitedCount)
      ctx.addIssue({ code: 'custom', message: 'visits exceed the recorded capture count' });
  });
export type SectionVisit = z.infer<typeof SectionVisitSchema>;
export type SectionIssue = z.infer<typeof SectionIssueSchema>;
export type SnapshotFidelity = z.infer<typeof SnapshotFidelitySchema>;
