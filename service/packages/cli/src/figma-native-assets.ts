import { createHash } from 'node:crypto';

/** Compare originals without substituting exported screen PNGs for an implemented interface. */
export function compareNativeImageAssets(files: Map<string, Buffer>, reference: unknown) {
  if (!Array.isArray(reference)) throw new Error('FIGMA_COMPARISON_ASSETS_INVALID');
  const images: Array<{
    imageHash: string;
    status: 'match' | 'different' | 'missing';
    nativeHash?: string;
    referenceHash: string;
  }> = [];
  const pendingKinds: Record<string, number> = Object.create(null);
  for (const row of reference) {
    if (
      !row ||
      typeof row !== 'object' ||
      !row.query ||
      !['image', 'svg', 'png'].includes(row.query.kind) ||
      !['captured', 'pending', 'unavailable'].includes(row.status)
    )
      throw new Error('FIGMA_COMPARISON_ASSETS_INVALID');
    if (row.status !== 'captured' || row.query.kind !== 'image') {
      pendingKinds[row.query.kind] = (pendingKinds[row.query.kind] ?? 0) + 1;
      continue;
    }
    if (!/^[a-f0-9]{40}$/u.test(row.query.imageHash) || !/^sha256:[a-f0-9]{64}$/u.test(row.sha256))
      throw new Error('FIGMA_COMPARISON_ASSETS_INVALID');
    const bytes = files.get(`images/${row.query.imageHash}`);
    const digest = bytes ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : undefined;
    images.push({
      imageHash: row.query.imageHash,
      status: !digest ? 'missing' : digest === row.sha256 ? 'match' : 'different',
      ...(digest ? { nativeHash: digest } : {}),
      referenceHash: row.sha256,
    });
  }
  return {
    fullAssetAcceptance: false,
    images,
    pendingKinds,
    limitation:
      'SVG and scoped root PNG oracles require their own independent export/geometry verification.',
  };
}
