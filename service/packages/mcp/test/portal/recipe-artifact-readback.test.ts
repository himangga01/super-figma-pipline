import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import type { RawDigest64 } from '@sfp/shared';
import { expect, it } from 'vitest';

import { serializeNativeArtifactManifestV1 } from '../../src/execution/native-evidence-artifact-port.js';
import { nativeEvidenceContextHash } from '../../src/execution/operation-evidence-projector.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { verifyRecipeNativeArtifact, verifyRecipePdfBytes } from '../../src/portal/recipes/artifact-readback.js';
import { handleExportFramesToPdf } from '../../src/tools/safe-union.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') as RawDigest64;
it('validates actual canonical PDF exporter file bytes and keeps supplied frame order', async () => {
  const pages = await Promise.all([100, 200].map(async width => { const doc = await PDFDocument.create(); doc.addPage([width, 50]); return doc.save(); }));
  const root = await mkdtemp(join(tmpdir(), 'sfp-recipe-pdf-')), outPath = join(root, 'frames.pdf');
  const result = await handleExportFramesToPdf(async (tool, args) => {
    expect(tool).toBe('export_pdf');
    const nodeId = (args as { nodeId: string }).nodeId;
    return { nodeId, bytes: pages[nodeId === '1:2' ? 0 : 1] };
  }, { nodeIds: ['1:2', '1:3'], outPath }, new AtomicFileStore());
  const bytes = await readFile(outPath);
  const verified = await verifyRecipePdfBytes(bytes, result);
  expect(verified.pages.map(page => page.width)).toEqual([100, 200]);
  await expect(verifyRecipePdfBytes(bytes, { ...result, pageCount: 1 })).rejects.toThrow('RECIPE_PDF_PAGE_COUNT_CHANGED');
  await expect(verifyRecipePdfBytes(Buffer.from('not a PDF document'), { pageCount: 1, bytesWritten: 18 })).rejects.toThrow(/RECIPE_PDF_/u);
});
it('binds native manifest and actual member bytes to the original operation and workspace', () => {
  const bytes = Buffer.from('actual bytes'), context = { operationId: 'original-operation', workspaceId: 'workspace' };
  const manifest = serializeNativeArtifactManifestV1({ schemaVersion: 1, operationId: context.operationId, artifactCount: 1, totalArtifactBytes: bytes.length, artifacts: [{ artifactRelativePath: 'exports/tokens.json', artifactDigest64: digest(bytes), artifactBytes: bytes.length }] });
  const evidence = { kind: 'export' as const, manifestRelativePath: `.sfp/operation-evidence/${nativeEvidenceContextHash(context).slice(7)}/native-manifest.v1.json`, manifestDigest64: digest(manifest.bytes), artifactCount: 1, totalArtifactBytes: bytes.length };
  const input = { ...context, evidence, manifestBytes: manifest.bytes, artifactRelativePath: 'exports/tokens.json', artifactBytes: bytes };
  expect(verifyRecipeNativeArtifact(input)).toMatchObject({ operationId: 'original-operation', bytes: bytes.length });
  expect(() => verifyRecipeNativeArtifact({ ...input, workspaceId: 'other' })).toThrow('RECIPE_NATIVE_MANIFEST_MISMATCH');
  expect(() => verifyRecipeNativeArtifact({ ...input, operationId: 'other' })).toThrow('RECIPE_NATIVE_MANIFEST_MISMATCH');
  expect(() => verifyRecipeNativeArtifact({ ...input, artifactRelativePath: 'exports/wrong.json' })).toThrow('RECIPE_NATIVE_BYTES_MISMATCH');
  expect(() => verifyRecipeNativeArtifact({ ...input, artifactBytes: Buffer.from('edited bytes') })).toThrow('RECIPE_NATIVE_BYTES_MISMATCH');
});
