import type { PortalAcceptance } from '@sfp/shared';

import {
  PortalCaptureReexportProofSchema,
  type PortalCaptureDescriptor,
} from '../../shared/src/portal-capture-source.js';
import { contentHash } from './canonical-json.js';

const designHash = (descriptor: PortalCaptureDescriptor) =>
  contentHash('sfp-portal-design-version-v2', {
    content: descriptor.contentFingerprint,
    contracts: descriptor.contractFingerprint,
    source: descriptor.sourceFingerprint,
    assets: descriptor.assetFingerprint,
  });

/** Keep exact capture identities; only a bound, narrow re-export proof can bridge different bytes. */
export function portalCaptureFreshnessMatches(
  original: PortalCaptureDescriptor | undefined,
  receipt: PortalAcceptance['capture'],
): boolean {
  if (
    !original ||
    !receipt ||
    receipt.originalDescriptorHash !== contentHash('sfp-portal-capture-descriptor-v2', original)
  )
    return false;
  if (receipt.freshDesignFingerprint === original.designFingerprint) return true;
  const parsed = PortalCaptureReexportProofSchema.safeParse(receipt.reexport);
  if (!parsed.success) return false;
  const proof = parsed.data,
    fresh = proof.freshDescriptor;
  if (
    fresh.designFingerprint !== receipt.freshDesignFingerprint ||
    fresh.contentFingerprint !== original.contentFingerprint ||
    fresh.contractFingerprint !== original.contractFingerprint ||
    fresh.sourceFingerprint !== original.sourceFingerprint ||
    contentHash('sfp-capture-source-equality-v1', fresh.source) !==
      contentHash('sfp-capture-source-equality-v1', original.source)
  )
    return false;
  const assetHash = (which: 'original' | 'fresh') =>
    contentHash(
      'sfp-portal-capture-assets-v2',
      proof.assets.map(asset => ({
        query: asset.query,
        status: 'captured',
        sha256: which === 'original' ? asset.originalHash : asset.freshHash,
        bytes: which === 'original' ? asset.originalBytes : asset.freshBytes,
        exportedFrom: asset.exportedFrom,
      })),
    );
  return (
    assetHash('original') === original.assetFingerprint &&
    assetHash('fresh') === fresh.assetFingerprint &&
    designHash(original) === original.designFingerprint &&
    designHash(fresh) === fresh.designFingerprint
  );
}
