import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkspacePolicy } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeEvidenceArtifactPort } from '../../src/execution/native-evidence-artifact-port.js';
import {
  createOperationEvidenceProjector,
  verifyNativeEvidenceContext,
} from '../../src/execution/operation-evidence-projector.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('native evidence export manifest port', () => {
  it('rereads, hashes, de-duplicates, UTF-8-sorts, and durably writes the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-'));
    roots.push(root);
    const assetDir = join(root, 'assets');
    const manifestPath = join(root, 'native-manifest.v1.json');
    await mkdir(assetDir);
    await writeFile(join(assetDir, 'z.png'), Buffer.from('z'));
    await writeFile(join(assetDir, 'a.png'), Buffer.from('aa'));
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) => join(root, relative),
      resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-1', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'save_screenshots',
      {},
      {
        saved: [
          { nodeId: '1:2', format: 'PNG', path: 'assets/z.png' },
          { nodeId: '1:3', format: 'PNG', path: 'assets/a.png' },
          { nodeId: '1:4', format: 'PNG', path: 'assets/z.png' },
        ],
      },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const evidence = await port.createNativeManifest({
      context: verifyNativeEvidenceContext(context, projection),
      projection,
    });

    expect(evidence).toMatchObject({ kind: 'export', artifactCount: 2, totalArtifactBytes: 3 });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      artifacts: { artifactRelativePath: string }[];
    };
    expect(manifest.artifacts.map(member => member.artifactRelativePath)).toEqual([
      'assets/a.png',
      'assets/z.png',
    ]);
  });

  it.each(['../escape', '/absolute', 'a\\b', 'C:drive', 'a/./b'])(
    'rejects non-portable candidate %s before reading',
    async candidateRelativePath => {
      const read = async () => {
        throw new Error('must not read');
      };
      const policy: WorkspacePolicy = {
        resolveRead: read,
        resolveWrite: async () => ({ path: 'unused', overwrites: false }),
        assertWithinRoot: async () => undefined,
      };
      const context = Object.freeze({
        operationId: 'operation-1',
        workspaceId: '123e4567-e89b-42d3-a456-426614174000',
      });
      const projection = createOperationEvidenceProjector().project(
        context,
        'tool',
        'export_pdf',
        {},
        { nodeId: '1:2', path: candidateRelativePath },
      );
      if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
      const port = new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      await expect(
        port.createNativeManifest({
          context: verifyNativeEvidenceContext(context, projection),
          projection,
        }),
      ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_PATH_INVALID' });
    },
  );

  it('removes an expired linked native manifest only after digest and context verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-retention-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) =>
        relative.includes('native-manifest') ? manifestPath : join(root, relative),
      resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-retained', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(context, projection);
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const evidence = await port.createNativeManifest({ context: verified, projection });
    await port.removeLinkedManifest({ context: verified, evidence });

    await expect(stat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects declared native total bytes before reading any artifact body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-total-cap-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'aa');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    let bodyReads = 0;
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) => join(root, relative),
      resolveWrite: async () => ({ path: join(root, 'manifest.json'), overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-cap', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      maxTotalArtifactBytes: 1,
      readArtifact: async path => {
        bodyReads += 1;
        return readFile(path);
      },
    });

    await expect(
      port.createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_TOTAL_TOO_LARGE', beforeRead: true });
    expect(bodyReads).toBe(0);
  });

  it('preserves a native-manifest pathname replacement that races cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-replacement-race-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const displaced = join(root, 'verified-native-manifest.json');
    const foreign = Buffer.from('foreign native replacement');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) =>
        relative.includes('native-manifest') ? manifestPath : join(root, relative),
      resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-native-replacement', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(context, projection);
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      beforeCleanupCommit: async (path: string) => {
        await rename(path, displaced);
        await writeFile(path, foreign);
      },
    } as never);
    const evidence = await port.createNativeManifest({ context: verified, projection });

    await expect(port.removeLinkedManifest({ context: verified, evidence })).rejects.toMatchObject({
      code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
    });
    await expect(readFile(manifestPath)).resolves.toEqual(foreign);
    await expect(readFile(displaced)).resolves.not.toEqual(foreign);
  });

  it('rejects same-inode artifact growth from descriptor size before allocating the body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-growth-cap-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    const artifactPath = join(root, 'assets/a.png');
    await writeFile(artifactPath, 'a');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const context = Object.freeze({ operationId: 'operation-growth', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => artifactPath,
        resolveWrite: async () => ({ path: join(root, 'manifest.json'), overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      maxTotalArtifactBytes: 1,
      readArtifact: async path => {
        await writeFile(path, 'aa');
        return readFile(path);
      },
    });

    await expect(
      port.createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      }),
    ).rejects.toMatchObject({
      code: 'NATIVE_ARTIFACT_TOTAL_TOO_LARGE',
      beforeRead: true,
    });
  });
});
