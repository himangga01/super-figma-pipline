/* eslint-disable no-await-in-loop -- exact asset order is part of the signed capture fingerprint */
import { contentHash, storedChecksum } from '@sfp/ir';

import {
  PortalCaptureReexportProofSchema,
  PortalPngReexportComparisonSchema,
  type PortalCaptureDescriptor,
  type PortalCaptureReexportProof,
} from '../../../shared/src/portal-capture-source.js';
import { RepoReader } from '../fs/repo-walk.js';
import type { PortalCapturedDesign } from './design-capture.js';
import { comparePortalPngReexport } from './preview.js';
import { portalError } from './store.js';

// Bounded proof capacity limits mean "not provable": freshness fails while evidence is retained.
const PROOF_READ_LIMITS = new Set(['REPO_TOTAL_BYTES_EXCEEDED', 'FILE_SIZE_LIMIT_EXCEEDED']);
const proofReadLimit = (error: unknown): boolean =>
  PROOF_READ_LIMITS.has(String((error as { code?: unknown } | null)?.code));

/**
 * Callers verify both whole captures' files around this proof: native work verifies the refreshed
 * capture just before it, and `assertCapture` verifies the original before and after it. The proof
 * re-reads and re-checks only the differing PNG bytes it compares.
 */
export async function provePortalPngReexport(
  original: PortalCapturedDesign,
  fresh: PortalCapturedDesign,
  freshDescriptor: PortalCaptureDescriptor,
  signal: AbortSignal,
): Promise<PortalCaptureReexportProof | null> {
  signal.throwIfAborted();
  if (
    original.captureVersion !== 2 ||
    fresh.captureVersion !== 2 ||
    original.contentFingerprint !== fresh.contentFingerprint ||
    original.contractFingerprint !== fresh.contractFingerprint ||
    original.sourceFingerprint !== fresh.sourceFingerprint ||
    original.assets.length !== fresh.assets.length
  )
    return null;
  const reader = (capture: PortalCapturedDesign) =>
    new RepoReader({
      rootDir: capture.assetRoot,
      maxFileBytes: 16_777_216,
      maxTotalBytes: 33_554_432,
      signal,
    });
  const left = reader(original),
    right = reader(fresh);
  const assets: PortalCaptureReexportProof['assets'] = [];
  for (let index = 0; index < original.assets.length; index++) {
    signal.throwIfAborted();
    const a = original.assets[index]!,
      b = fresh.assets[index]!;
    if (
      a.status !== 'captured' ||
      b.status !== 'captured' ||
      contentHash('sfp-capture-query-v1', a.query) !==
        contentHash('sfp-capture-query-v1', b.query) ||
      contentHash('sfp-capture-export-origin-v1', a.exportedFrom ?? null) !==
        contentHash('sfp-capture-export-origin-v1', b.exportedFrom ?? null)
    )
      return null;
    const asset: PortalCaptureReexportProof['assets'][number] = {
      query: a.query,
      originalHash: a.sha256!,
      originalBytes: a.bytes!,
      freshHash: b.sha256!,
      freshBytes: b.bytes!,
      exportedFrom: a.exportedFrom ?? null,
    };
    if (a.sha256 !== b.sha256) {
      if (a.query.kind !== 'png') return null;
      let before: Buffer, after: Buffer;
      try {
        before = await left.readBytes(a.path!);
        after = await right.readBytes(b.path!);
      } catch (error) {
        signal.throwIfAborted();
        if (proofReadLimit(error)) return null;
        throw error;
      }
      if (
        storedChecksum(before) !== a.sha256 ||
        before.length !== a.bytes ||
        storedChecksum(after) !== b.sha256 ||
        after.length !== b.bytes
      )
        throw portalError('PORTAL_CAPTURE_ASSET_CHANGED');
      let compared: ReturnType<typeof comparePortalPngReexport>;
      try {
        compared = comparePortalPngReexport(before, after);
      } catch {
        // Verified bytes the bounded decoder cannot compare are not a same-facts proof.
        return null;
      }
      const comparison = PortalPngReexportComparisonSchema.safeParse(compared);
      if (!comparison.success) return null;
      asset.png = comparison.data;
    }
    assets.push(asset);
  }
  const proof = PortalCaptureReexportProofSchema.safeParse({
    version: 1,
    policy: 'same-facts-png-quantization-v1',
    freshDescriptor,
    assets,
  });
  return proof.success ? proof.data : null;
}
