import { createHash } from 'node:crypto';

import { OPERATION_EVIDENCE_LIMITS, PortableRelativeArtifactPathSchema, type NativeEvidenceV1 } from '@sfp/shared';
import { PDFDocument } from 'pdf-lib';

import { validateNativeArtifactManifestBytes } from '../../execution/native-evidence-artifact-port.js';
import { nativeEvidenceContextHash } from '../../execution/operation-evidence-projector.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Pure byte proof. The caller must first authenticate and verify the original operation receipt. */
export function verifyRecipeNativeArtifact(input: {
  operationId: string;
  workspaceId: string;
  evidence: Extract<NativeEvidenceV1, { kind: 'export' }>;
  manifestBytes: Uint8Array;
  artifactRelativePath: string;
  artifactBytes: Uint8Array;
}) {
  const contextHash = nativeEvidenceContextHash({ operationId: input.operationId, workspaceId: input.workspaceId });
  if(input.manifestBytes.byteLength > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes || input.evidence.manifestRelativePath !== `.sfp/operation-evidence/${contextHash.slice(7)}/native-manifest.v1.json` || digest(input.manifestBytes) !== input.evidence.manifestDigest64) throw new Error('RECIPE_NATIVE_MANIFEST_MISMATCH');
  const manifest = validateNativeArtifactManifestBytes(Buffer.from(input.manifestBytes), { operationId: input.operationId, artifactCount: input.evidence.artifactCount, totalArtifactBytes: input.evidence.totalArtifactBytes });
  const path = PortableRelativeArtifactPathSchema.parse(input.artifactRelativePath);
  if(manifest.artifactCount !== 1) throw new Error('RECIPE_NATIVE_MEMBER_COUNT');
  const member = manifest.artifacts.find(row => row.artifactRelativePath === path);
  if(!member || input.artifactBytes.byteLength > 67108864 || member.artifactBytes !== input.artifactBytes.byteLength || member.artifactDigest64 !== digest(input.artifactBytes)) throw new Error('RECIPE_NATIVE_BYTES_MISMATCH');
  return { operationId: input.operationId, artifactRelativePath: member.artifactRelativePath, contentHash: `sha256:${member.artifactDigest64}`, bytes: member.artifactBytes };
}

/** Parses actual output bytes; a successful command or matching filename is insufficient. */
export async function verifyRecipePdfBytes(bytes: Uint8Array, expected: { pageCount: number; bytesWritten: number }) {
  if(bytes.byteLength < 8 || bytes.byteLength > 67108864 || bytes.byteLength !== expected.bytesWritten || !Number.isInteger(expected.pageCount) || expected.pageCount < 1 || expected.pageCount > 256) throw new Error('RECIPE_PDF_BYTES_INVALID');
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true }); }
  catch (cause) { throw new Error('RECIPE_PDF_PARSE_FAILED', { cause }); }
  if(pdf.getPageCount() !== expected.pageCount) throw new Error('RECIPE_PDF_PAGE_COUNT_CHANGED');
  const pages = pdf.getPages().map(page => ({ width: page.getWidth(), height: page.getHeight() }));
  if(pages.some(page => !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0)) throw new Error('RECIPE_PDF_PAGE_BOUNDS_INVALID');
  return { contentHash: `sha256:${digest(bytes)}`, bytes: bytes.byteLength, pageCount: pages.length, pages };
}
