import type { PortalAcceptance } from '@sfp/shared';

import {
  PortalCaptureReexportProofSchema,
  type PortalCaptureDescriptor,
} from '../../shared/src/portal-capture-source.js';
import { contentHash } from './canonical-json.js';

/** The single v2 design-version formula, shared by capture descriptors and freshness proofs. */
export const portalDesignVersionFingerprint = (parts: {
  contentFingerprint?: string | undefined;
  contractFingerprint?: string | undefined;
  sourceFingerprint?: string | undefined;
  assetFingerprint?: string | undefined;
}) =>
  contentHash('sfp-portal-design-version-v2', {
    content: parts.contentFingerprint,
    contracts: parts.contractFingerprint,
    source: parts.sourceFingerprint,
    assets: parts.assetFingerprint,
  });

/** The single v2 asset-row formula, shared by capture descriptors and freshness proofs. */
export const portalCaptureAssetFingerprint = (
  rows: ReadonlyArray<{
    query: unknown;
    status: string;
    sha256?: string | null | undefined;
    bytes?: number | null | undefined;
    exportedFrom?: unknown;
  }>,
) =>
  contentHash(
    'sfp-portal-capture-assets-v2',
    rows.map(row => ({
      query: row.query,
      status: row.status,
      sha256: row.sha256 ?? null,
      bytes: row.bytes ?? null,
      exportedFrom: row.exportedFrom ?? null,
    })),
  );

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
    portalCaptureAssetFingerprint(
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
    portalDesignVersionFingerprint(original) === original.designFingerprint &&
    portalDesignVersionFingerprint(fresh) === fresh.designFingerprint
  );
}
