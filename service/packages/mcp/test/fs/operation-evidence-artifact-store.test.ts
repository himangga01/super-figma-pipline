import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createToolInvocationOptions, type WorkspacePolicy } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('operation evidence result artifact store', () => {
  it('writes canonical redacted bytes create-new and verifies the returned digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-'));
    roots.push(root);
    const target = join(root, 'result.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const resolveWrite = vi.fn<WorkspacePolicy['resolveWrite']>(async () => ({
      path: target,
      overwrites: false,
    }));
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite,
        resolveRead: async () => target,
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const options = createToolInvocationOptions(true, 'operation-1', workspaceId);

    await expect(
      store.createNew({
        workspaceId,
        operationId: 'operation-1',
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${digest}`,
      }),
    ).resolves.toEqual({
      artifactRelativePath: options.captureIntent.relativePath,
      artifactDigest64: digest,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
    });
    expect(await readFile(target)).toEqual(bytes);
    expect(resolveWrite).toHaveBeenCalledWith(workspaceId, options.captureIntent.relativePath);
  });

  it('fails before writing when preflight reports an existing capture path', async () => {
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, 'operation-2', workspaceId);
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite: async () => ({ path: 'unused', overwrites: true }),
        resolveRead: async () => 'unused',
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
    });

    await expect(store.preflight(workspaceId, options.captureIntent)).rejects.toMatchObject({
      code: 'EVIDENCE_ARTIFACT_EXISTS',
    });
  });

  it('synchronously removes an expired linked artifact only after fixed-path and digest verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-retention-'));
    roots.push(root);
    const target = join(root, 'result.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveWrite: async () => ({ path: target, overwrites: false }),
      resolveRead: async (_workspace, relative) =>
        relative.endsWith('/cleanup-intent.v1.json')
          ? join(dirname(target), 'cleanup-intent.v1.json')
          : target,
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const options = createToolInvocationOptions(true, 'operation-retained', workspaceId);
    const artifact = await store.createNew({
      workspaceId,
      operationId: 'operation-retained',
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${digest}`,
    });

    await store.removeLinked({ workspaceId, operationId: 'operation-retained', artifact });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails orphan cleanup closed when bytes changed and preserves the path for manual repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-orphan-'));
    roots.push(root);
    const target = join(root, 'result.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveWrite: async () => ({ path: target, overwrites: false }),
      resolveRead: async (_workspace, relative) =>
        relative.endsWith('/cleanup-intent.v1.json')
          ? join(dirname(target), 'cleanup-intent.v1.json')
          : target,
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const options = createToolInvocationOptions(true, 'operation-orphan', workspaceId);
    const artifact = await store.createNew({
      workspaceId,
      operationId: 'operation-orphan',
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${digest}`,
    });
    await writeFile(target, 'changed');

    await expect(
      store.cleanupOrphan({
        workspaceId,
        operationId: 'operation-orphan',
        artifact,
        hasLinkedEvidence: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    await expect(readFile(target, 'utf8')).resolves.toBe('changed');
  });

  it('refuses linked cleanup when a foreign hardlink alias exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-alias-'));
    roots.push(root);
    const target = join(root, 'result.v1.json');
    const alias = join(root, 'foreign-alias.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite: async () => ({ path: target, overwrites: false }),
        resolveRead: async (_workspace: string, relative: string) =>
          relative.endsWith('/cleanup-intent.v1.json')
            ? join(dirname(target), 'cleanup-intent.v1.json')
            : target,
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const options = createToolInvocationOptions(true, 'operation-alias', workspaceId);
    const artifact = await store.createNew({
      workspaceId,
      operationId: 'operation-alias',
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${digest}`,
    });
    await link(target, alias);

    await expect(
      store.removeLinked({ workspaceId, operationId: 'operation-alias', artifact }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    await expect(readFile(target)).resolves.toEqual(bytes);
    await expect(readFile(alias)).resolves.toEqual(bytes);
  });

  it('preserves a pathname replacement that races verified cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-replacement-race-'));
    roots.push(root);
    const target = join(root, 'result.v1.json');
    const displaced = join(root, 'verified-original.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const foreign = Buffer.from('foreign replacement', 'utf8');
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite: async () => ({ path: target, overwrites: false }),
        resolveRead: async (_workspace: string, relative: string) =>
          relative.endsWith('/cleanup-intent.v1.json')
            ? join(dirname(target), 'cleanup-intent.v1.json')
            : target,
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeCleanupCommit: async (path: string) => {
        await rename(path, displaced);
        await writeFile(path, foreign);
      },
    } as never);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const options = createToolInvocationOptions(true, 'operation-replacement', workspaceId);
    const artifact = await store.createNew({
      workspaceId,
      operationId: 'operation-replacement',
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${digest}`,
    });

    await expect(
      store.removeLinked({ workspaceId, operationId: 'operation-replacement', artifact }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    await expect(readFile(target)).resolves.toEqual(foreign);
    await expect(readFile(displaced)).resolves.toEqual(bytes);
  });

  it.each(['foreign-bytes', 'hardlink', 'path-replacement', 'parent-replacement'] as const)(
    'verifies and quarantines the linked cleanup marker for %s before unlinking it',
    async fault => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-linked-marker-identity-'));
      roots.push(root);
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const operationId = `operation-linked-marker-${fault}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(root, options.captureIntent.relativePath as string);
      const marker = join(dirname(target), 'cleanup-intent.v1.json');
      const displacedMarker = join(dirname(target), 'verified-marker.json');
      const displacedParent = join(root, `verified-parent-${fault}`);
      const alias = join(dirname(target), 'foreign-hardlink.json');
      const foreign = Buffer.from(`foreign-${fault}\n`, 'utf8');
      let parentReplaced = false;
      const policy: WorkspacePolicy = {
        resolveWrite: async (_workspace, relative) => ({
          path: join(root, relative),
          overwrites: false,
        }),
        resolveRead: async (_workspace, relative) => join(root, relative),
        assertWithinRoot: async () => undefined,
      };
      const store = new OperationEvidenceArtifactStore({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
        beforeMarkerCleanupCommit: async (path: string) => {
          if (fault === 'path-replacement') {
            await rename(path, displacedMarker);
            await writeFile(path, foreign);
          }
          if (fault === 'parent-replacement') {
            await rename(dirname(path), displacedParent);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, foreign);
            parentReplaced = true;
          }
        },
      } as never);
      const bytes = Buffer.from('{"ok":true}', 'utf8');
      const artifact = await store.createNew({
        workspaceId,
        operationId,
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
      const verifiedMarker = await readFile(marker);
      if (fault === 'foreign-bytes') await writeFile(marker, foreign);
      if (fault === 'hardlink') await link(marker, alias);

      await expect(
        store.removeLinked({ workspaceId, operationId, artifact }),
      ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
      const readMaybe = (path: string): Promise<Buffer | null> =>
        readFile(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      expect({
        marker: await readMaybe(marker),
        alias: await readMaybe(alias),
        displacedMarker: await readMaybe(displacedMarker),
        displacedParentMarker: await readMaybe(join(displacedParent, 'cleanup-intent.v1.json')),
      }).toEqual({
        marker:
          fault === 'foreign-bytes' ||
          fault === 'path-replacement' ||
          (fault === 'parent-replacement' && parentReplaced)
            ? foreign
            : verifiedMarker,
        alias: fault === 'hardlink' ? verifiedMarker : null,
        displacedMarker: fault === 'path-replacement' ? verifiedMarker : null,
        displacedParentMarker:
          fault === 'parent-replacement' && parentReplaced ? verifiedMarker : null,
      });
    },
  );

  it('discovers and removes a crash orphan only after proving no receipt or finalizer link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-discovery-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-discovered-orphan';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const policy: WorkspacePolicy = {
      resolveWrite: async (_workspace, relative) => ({
        path: join(root, relative),
        overwrites: false,
      }),
      resolveRead: async (_workspace, relative) => join(root, relative),
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${digest}`,
    });

    await (
      store as unknown as {
        discoverAndCleanupOrphans(input: {
          workspaceId: string;
          hasLinkedEvidence(operationId: string): Promise<boolean>;
        }): Promise<void>;
      }
    ).discoverAndCleanupOrphans({
      workspaceId,
      hasLinkedEvidence: async () => false,
    });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('safely drains a verified marker-only crash orphan when the artifact was never published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-marker-only-orphan-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-marker-only';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const marker = join(dirname(target), 'cleanup-intent.v1.json');
    const policy: WorkspacePolicy = {
      resolveWrite: async (_workspace: string, relative: string) => ({
        path: join(root, relative),
        overwrites: false,
      }),
      resolveRead: async (_workspace: string, relative: string) => join(root, relative),
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}');
    const resultHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash,
    });
    await unlink(target);

    const restarted = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    await restarted.discoverAndCleanupOrphans({
      workspaceId,
      hasLinkedEvidence: async () => false,
    });
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a replacement marker that wins during the asynchronous absence proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-marker-only-replacement-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-marker-replacement';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const marker = join(dirname(target), 'cleanup-intent.v1.json');
    const displaced = join(dirname(target), 'verified-marker.json');
    const replacement = Buffer.from('{"replacement":true}\n', 'utf8');
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite: async (_workspace: string, relative: string) => ({
          path: join(root, relative),
          overwrites: false,
        }),
        resolveRead: async (_workspace: string, relative: string) => join(root, relative),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeMarkerCleanupCommit: async (path: string) => {
        await rename(path, displaced);
        await writeFile(path, replacement);
      },
    } as never);
    const bytes = Buffer.from('{"ok":true}');
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    await unlink(target);

    await expect(
      store.discoverAndCleanupOrphans({
        workspaceId,
        hasLinkedEvidence: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    await expect(readFile(marker)).resolves.toEqual(replacement);
    await expect(stat(displaced)).resolves.toBeDefined();
  });

  it.each(['hardlink', 'symlink'] as const)(
    'fails closed and preserves a marker-only orphan reached through a %s',
    async linkKind => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-marker-link-'));
      roots.push(root);
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const operationId = `operation-marker-${linkKind}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(root, options.captureIntent.relativePath as string);
      const marker = join(dirname(target), 'cleanup-intent.v1.json');
      const alias = join(dirname(target), `marker-${linkKind}-alias.json`);
      const policy: WorkspacePolicy = {
        resolveWrite: async (_workspace, relative) => ({
          path: join(root, relative),
          overwrites: false,
        }),
        resolveRead: async (_workspace, relative) => join(root, relative),
        assertWithinRoot: async () => undefined,
      };
      const store = new OperationEvidenceArtifactStore({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      const bytes = Buffer.from('{"ok":true}');
      await store.createNew({
        workspaceId,
        operationId,
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
      await unlink(target);
      if (linkKind === 'hardlink') await link(marker, alias);
      else {
        await rename(marker, alias);
        try {
          await symlink(alias, marker, 'file');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }
      }

      const restarted = new OperationEvidenceArtifactStore({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      await expect(
        restarted.discoverAndCleanupOrphans({
          workspaceId,
          hasLinkedEvidence: async () => false,
        }),
      ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
      await expect(readFile(alias)).resolves.toBeDefined();
      await expect(lstat(marker)).resolves.toBeDefined();
    },
  );

  it('does not traverse a marker-only operation directory replaced by a junction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-marker-junction-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-marker-junction';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const operationDirectory = dirname(target);
    const displaced = join(root, 'junction-target');
    const policy: WorkspacePolicy = {
      resolveWrite: async (_workspace, relative) => ({
        path: join(root, relative),
        overwrites: false,
      }),
      resolveRead: async (_workspace, relative) => join(root, relative),
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}');
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    await unlink(target);
    await rename(operationDirectory, displaced);
    try {
      await symlink(displaced, operationDirectory, 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const restarted = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    await expect(
      restarted.discoverAndCleanupOrphans({
        workspaceId,
        hasLinkedEvidence: async () => false,
      }),
    ).resolves.toBeUndefined();
    await expect(readFile(join(displaced, 'cleanup-intent.v1.json'))).resolves.toBeDefined();
    expect((await lstat(operationDirectory)).isSymbolicLink()).toBe(true);
  });
});
