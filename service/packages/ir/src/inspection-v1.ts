import { z } from 'zod';

import { contentHash } from './canonical-json.js';
import { RepoRelativePathSchema, Sha256WireSchema } from './snapshot-v1.js';

const ArtifactReference = z
  .object({
    path: RepoRelativePathSchema,
    sha256: Sha256WireSchema,
    bytes: z.number().int().nonnegative(),
  })
  .strict();
/** Common connector handoff. Raw values remain in hash-bound artifacts; no lossy field conversion. */
export const InspectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('sfp-inspection'),
    source: z.enum(['desktop-plugin', 'chrome-scripter', 'chrome-ui']),
    target: z
      .object({
        fileKey: z.string().min(10).max(128),
        requestedUrl: z.url(),
        nodeId: z.string().nullable(),
        pageId: z.string().nullable(),
      })
      .strict(),
    capturedAt: z.iso.datetime(),
    atomic: z.literal(false),
    fidelity: z
      .object({
        values: z.enum(['captured', 'partial', 'unavailable']),
        assets: z.enum(['captured', 'partial', 'unavailable']),
        code: z.enum(['captured', 'unavailable']),
        issues: z.array(z.string()).max(256),
      })
      .strict(),
    artifacts: z.record(z.string().max(128), ArtifactReference),
    contentHash: Sha256WireSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const {
      schemaVersion: _version,
      kind: _kind,
      atomic: _atomic,
      contentHash: digest,
      ...input
    } = value;
    if (contentHash('sfp-inspection-v1', input) !== digest)
      ctx.addIssue({
        code: 'custom',
        path: ['contentHash'],
        message: 'inspection content hash mismatch',
      });
  });
export type InspectionV1 = z.infer<typeof InspectionV1Schema>;
export const createInspection = (
  input: Omit<InspectionV1, 'schemaVersion' | 'kind' | 'contentHash' | 'atomic'>,
): InspectionV1 =>
  InspectionV1Schema.parse({
    ...input,
    schemaVersion: 1,
    kind: 'sfp-inspection',
    atomic: false,
    contentHash: contentHash('sfp-inspection-v1', input),
  });
