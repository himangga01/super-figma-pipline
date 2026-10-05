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

/** Narrow export-noise policy; independent of frontend visual comparison thresholds. */
export const PortalPngReexportComparisonSchema = z
  .object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(16384),
    changedPixels: z.number().int().min(0),
    maxRgbDelta: z.number().int().min(0).max(1),
    alphaChanged: z.literal(false),
    originalPixelsHash: hash,
    freshPixelsHash: hash,
  })
  .strict()
  .refine(
    value =>
      value.width * value.height <= 20_000_000 &&
      value.changedPixels <= Math.floor((value.width * value.height) / 10_000) &&
      (value.changedPixels === 0) === (value.originalPixelsHash === value.freshPixelsHash) &&
      (value.changedPixels === 0) === (value.maxRgbDelta === 0),
    'PORTAL_PNG_REEXPORT_LIMIT',
  );

export const PortalCaptureReexportProofSchema = z
  .object({
    version: z.literal(1),
    policy: z.literal('same-facts-png-quantization-v1'),
    freshDescriptor: PortalCaptureDescriptorSchema,
    assets: z
      .array(
        z
          .object({
            query: z.union([
              z.object({ kind: z.literal('png'), nodeId: id }).strict(),
              z.object({ kind: z.literal('svg'), nodeId: id }).strict(),
              z
                .object({
                  kind: z.literal('image'),
                  imageHash: z.string().regex(/^[a-f0-9]{40}$/u),
                })
                .strict(),
            ]),
            originalHash: hash,
            originalBytes: z.number().int().min(1).max(16_777_216),
            freshHash: hash,
            freshBytes: z.number().int().min(1).max(16_777_216),
            exportedFrom: z.object({ nodeId: id, geometryHash: hash }).strict().nullable(),
            png: PortalPngReexportComparisonSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4096),
  })
  .strict()
  .refine(value => {
    const queries = value.assets.map(asset => JSON.stringify(asset.query));
    return (
      new Set(queries).size === queries.length &&
      value.assets.some(asset => asset.originalHash !== asset.freshHash) &&
      value.assets.every(asset =>
        asset.originalHash === asset.freshHash
          ? asset.originalBytes === asset.freshBytes && asset.png === undefined
          : asset.query.kind === 'png' && asset.png !== undefined,
      )
    );
  }, 'PORTAL_CAPTURE_REEXPORT_PROOF_INVALID');
export type PortalCaptureReexportProof = z.infer<typeof PortalCaptureReexportProofSchema>;
