import { z } from 'zod';
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().min(1).max(1024);
export const PortalCaptureSourceSchema = z.enum(['chrome', 'desktop']);
const common = {
  version: z.literal(1),
  url: z.url().max(2048),
  fileKeyHash: hash,
  requestedNodeId: z.string().max(512).nullable(),
};
export const PortalCaptureGrantSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('chrome'),
      phase: z.literal('requested-source'),
      binding: z.literal('selected-page-after-approved-connection'),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('desktop'),
      phase: z.literal('pinned-target'),
      sessionId: id,
      pluginGeneration: id,
      fileIdentityHash: hash,
      fileExecutionKey: id,
      bindingMethod: z.enum(['file-key', 'owner-confirmed-document']),
      bindingHash: hash,
    })
    .strict(),
]);
export type PortalCaptureGrant = z.infer<typeof PortalCaptureGrantSchema>;
/**
 * Immutable original observation identity; attempt evidence is deliberately distinct from freshness
 * equality.
 */
export const PortalCaptureDescriptorSchema = z
  .object({
    version: z.literal(2),
    admission: PortalCaptureGrantSchema,
    rawHash: hash,
    assetManifestHash: hash,
    contentFingerprint: hash,
    sourceFingerprint: hash,
    contractFingerprint: hash,
    assetFingerprint: hash,
    evidenceHash: hash,
    designFingerprint: hash,
    source: z
      .object({
        kind: PortalCaptureSourceSchema,
        url: z.url().max(2048),
        fileKeyHash: hash,
        requestedNodeId: z.string().max(512).nullable(),
        scopeId: id,
        bindingMethod: z.enum(['file-key', 'owner-confirmed-document']),
      })
      .strict(),
  })
  .strict();
export type PortalCaptureDescriptor = z.infer<typeof PortalCaptureDescriptorSchema>;
