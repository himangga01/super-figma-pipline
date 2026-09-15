import { z } from 'zod';

export const IMAGE_CHUNK_BYTES = 1_048_576;
export const MAX_CAPTURED_IMAGE_BYTES = 16_777_216;
export const ImageChunkQuerySchema = z
  .object({
    imageHash: z.string().regex(/^[a-f0-9]{40}$/iu),
    offset: z
      .number()
      .int()
      .min(0)
      .max(MAX_CAPTURED_IMAGE_BYTES - 1),
  })
  .strict();

export const ImageChunkResultSchema = ImageChunkQuerySchema.extend({
  totalBytes: z.number().int().positive().max(MAX_CAPTURED_IMAGE_BYTES),
  base64: z.string().min(1).max(1_398_104),
});

export const AssetQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), imageHash: z.string().regex(/^[a-f0-9]{40}$/iu) }).strict(),
  z
    .object({
      kind: z.enum(['png', 'svg']),
      nodeId: z
        .string()
        .max(512)
        .regex(/^I?\d+:\d+(?:;I?\d+:\d+)*$/u),
    })
    .strict(),
]);
export const AssetReadResultSchema = z
  .object({
    query: AssetQuerySchema,
    base64: z.string().max(6_666_668),
    byteLength: z.number().int().positive().max(5_000_000),
  })
  .strict();

export const FigmaCaptureAssetQuerySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('image-chunk'),
      imageHash: z.string().regex(/^[a-f0-9]{40}$/iu),
      offset: z.number().int().min(0).max(16_777_215),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['png', 'svg']),
      nodeId: z
        .string()
        .max(512)
        .regex(/^I?\d+:\d+(?:;I?\d+:\d+)*$/u),
    })
    .strict(),
]);
export const FigmaCaptureAssetResultSchema = z
  .object({ asset: z.union([ImageChunkResultSchema, AssetReadResultSchema]) })
  .strict();
export const FigmaCaptureAssetArgsSchema = z
  .object({ query: FigmaCaptureAssetQuerySchema })
  .strict();
export interface FigmaCaptureAssetApi {
  getImageByHash(hash: string): { getBytesAsync(): Promise<Uint8Array> } | null;
  getNodeByIdAsync(id: string): Promise<unknown>;
  base64Encode(bytes: Uint8Array): string;
}
/** Closed read/export function compiled directly in the Desktop plugin. */
export async function readFigmaCaptureAsset(
  q: z.infer<typeof FigmaCaptureAssetQuerySchema>,
  figma: FigmaCaptureAssetApi,
): Promise<string> {
  if (q.kind === 'image-chunk') {
    const image = figma.getImageByHash(q.imageHash);
    if (!image) throw Error('ASSET_NOT_FOUND');
    const bytes = await image.getBytesAsync();
    if (!bytes.length || bytes.length > 16_777_216) throw Error('ASSET_TOO_LARGE');
    if (q.offset >= bytes.length) throw Error('ASSET_CHUNK_OFFSET_INVALID');
    return JSON.stringify({
      imageHash: q.imageHash,
      offset: q.offset,
      totalBytes: bytes.length,
      base64: figma.base64Encode(bytes.slice(q.offset, q.offset + 1_048_576)),
    });
  }
  const node = await figma.getNodeByIdAsync(q.nodeId);
  if (
    !node ||
    typeof node !== 'object' ||
    !('exportAsync' in node) ||
    typeof node.exportAsync !== 'function'
  )
    throw Error('ASSET_NOT_EXPORTABLE');
  const bytes: Uint8Array = await node.exportAsync(
    q.kind === 'svg'
      ? { format: 'SVG' }
      : { format: 'PNG', constraint: { type: 'SCALE', value: 1 } },
  );
  if (!bytes.length || bytes.length > 5_000_000) throw Error('ASSET_TOO_LARGE');
  return JSON.stringify({ query: q, base64: figma.base64Encode(bytes), byteLength: bytes.length });
}
