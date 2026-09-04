import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createToolInvocationOptions, type WorkspacePolicy } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeEvidenceArtifactPort } from '../../src/execution/native-evidence-artifact-port.js';
import {
  createOperationEvidenceProjector,
  verifyNativeEvidenceContext,
} from '../../src/execution/operation-evidence-projector.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('native evidence export manifest port', () => {
  it('creates no lock, directory, or manifest outside the workspace on first-use child replacement', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'sfp-native-first-mutex-authority-'));
    roots.push(sandbox);
    const workspaceRoot = join(sandbox, 'workspace');
    const evidenceRoot = join(workspaceRoot, '.sfp', 'operation-evidence');
    const displaced = join(sandbox, 'owned-evidence-root');
    const outside = join(sandbox, 'outside');
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(workspaceRoot, 'assets/a.png'), 'owned');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const context = Object.freeze({ operationId: 'operation-first-native-mutex', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    let replacementAttempted = false;
    let outsideWhileLocked: readonly string[] = [];
    const policy: WorkspacePolicy = {
      resolveRoot: async () => workspaceRoot,
      resolveRead: async (_workspace, relative) => join(workspaceRoot, relative),
      resolveWrite: async (_workspace, relative) => ({
        path: join(workspaceRoot, relative),
        overwrites: false,
      }),
      assertWithinRoot: async () => undefined,
    };
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      beforeEvidenceMutexAcquire: async () => {
        replacementAttempted = true;
        const script = String.raw`
          const fs = require('node:fs');
          try {
            fs.renameSync(process.argv[1], process.argv[2]);
            fs.symlinkSync(process.argv[3], process.argv[1], process.platform === 'win32' ? 'junction' : 'dir');
          } catch { process.exitCode = 2; }
        `;
        const child = spawn(process.execPath, ['-e', script, evidenceRoot, displaced, outside], {
          stdio: 'ignore',
          windowsHide: true,
        });
        await new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
      },
      afterEvidenceMutexAcquire: async () => {
        outsideWhileLocked = await readdir(outside);
      },
    } as never);

    await port
      .createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      })
      .catch(() => undefined);

    expect(replacementAttempted).toBe(true);
    expect(outsideWhileLocked).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
  });

  it.each(['cleanup', 'discovery'] as const)(
    'creates nothing outside the retained evidence root during native %s replacement',
    async action => {
      const sandbox = await mkdtemp(join(tmpdir(), `sfp-native-${action}-mutex-authority-`));
      roots.push(sandbox);
      const workspaceRoot = join(sandbox, 'workspace');
      const evidenceRoot = join(workspaceRoot, '.sfp', 'operation-evidence');
      const outside = join(sandbox, 'outside');
      const displaced = join(sandbox, `owned-evidence-root-${action}`);
      await mkdir(join(workspaceRoot, 'assets'), { recursive: true });
      await mkdir(outside);
      await writeFile(join(workspaceRoot, 'assets/a.png'), 'owned');
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const context = Object.freeze({
        operationId: `operation-native-${action}-mutex`,
        workspaceId,
      });
      const projection = createOperationEvidenceProjector().project(
        context,
        'tool',
        'export_pdf',
        {},
        { nodeId: '1:2', path: 'assets/a.png' },
      );
      if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
      const policy: WorkspacePolicy = {
        resolveRoot: async () => workspaceRoot,
        resolveRead: async (_workspace, relative) => join(workspaceRoot, relative),
        resolveWrite: async (_workspace, relative) => ({
          path: join(workspaceRoot, relative),
          overwrites: await stat(join(workspaceRoot, relative)).then(
            () => true,
            () => false,
          ),
        }),
        assertWithinRoot: async () => undefined,
      };
      const verified = verifyNativeEvidenceContext(context, projection);
      const writer = new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      const evidence = await writer.createNativeManifest({ context: verified, projection });
      let replacementAttempted = false;
      let outsideWhileLocked: readonly string[] = [];
      const port = new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
        beforeEvidenceMutexAcquire: async () => {
          replacementAttempted = true;
          const script = String.raw`
            const fs = require('node:fs');
            try {
              fs.renameSync(process.argv[1], process.argv[2]);
              fs.symlinkSync(process.argv[3], process.argv[1], process.platform === 'win32' ? 'junction' : 'dir');
            } catch { process.exitCode = 2; }
          `;
          const child = spawn(process.execPath, ['-e', script, evidenceRoot, displaced, outside], {
            stdio: 'ignore',
            windowsHide: true,
          });
          await new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
        },
        afterEvidenceMutexAcquire: async () => {
          outsideWhileLocked = await readdir(outside);
        },
      } as never);

      if (action === 'cleanup') {
        await port.removeLinkedManifest({ context: verified, evidence }).catch(() => undefined);
      } else {
        await port
          .discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => true })
          .catch(() => undefined);
      }

      expect(replacementAttempted).toBe(true);
      expect(outsideWhileLocked).toEqual([]);
      expect(await readdir(outside)).toEqual([]);
    },
  );

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

  it.each([
    '../escape',
    '/absolute',
    'a\\b',
    'C:drive',
    'a/./b',
    'assets/\u0001.png',
    'assets/\ud800.png',
  ])('rejects non-portable candidate %s before reading', async candidateRelativePath => {
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
  });

  it('removes an expired linked native manifest only after digest and context verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-retention-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) =>
        relative.includes('operation-evidence') ? root : join(root, relative),
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
        relative.includes('operation-evidence') ? root : join(root, relative),
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

  it('aborts between native descriptor chunks without publishing a manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-mid-read-abort-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    const artifactPath = join(root, 'assets/a.bin');
    await writeFile(artifactPath, Buffer.alloc(1_048_576, 7));
    const manifestPath = join(root, 'native-manifest.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const context = Object.freeze({ operationId: 'operation-native-mid-read-abort', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.bin' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const controller = new AbortController();
    let chunks = 0;
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => artifactPath,
        resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      afterMemberChunk: async () => {
        chunks += 1;
        controller.abort(
          Object.assign(new Error('cancel native reread'), { code: 'OPERATION_CANCELLED' }),
        );
      },
    } as never);

    await expect(
      port.createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
        signal: controller.signal,
      } as never),
    ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(chunks).toBe(1);
    await expect(stat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds a native member reread to the opened descriptor through a swap-open-restore ABA', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-member-aba-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    const artifactPath = join(root, 'assets/a.png');
    const displaced = join(root, 'assets/a-owned.png');
    const foreignPath = join(root, 'assets/a-foreign.png');
    await writeFile(artifactPath, 'owned');
    await writeFile(foreignPath, 'alien');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const context = Object.freeze({ operationId: 'operation-member-aba', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    let restored = false;
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => artifactPath,
        resolveWrite: async () => ({ path: join(root, 'manifest.json'), overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeMemberOpen: async () => {
        await rename(artifactPath, displaced);
        await rename(foreignPath, artifactPath);
      },
      afterMemberOpen: async () => {
        await rename(artifactPath, foreignPath);
        await rename(displaced, artifactPath);
        restored = true;
      },
    } as never);

    await expect(
      port.createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' });
    expect(restored).toBe(true);
    await expect(readFile(artifactPath, 'utf8')).resolves.toBe('owned');
    await expect(readFile(foreignPath, 'utf8')).resolves.toBe('alien');
  });

  it('binds native manifest publication reread to its expected descriptor identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-manifest-reread-aba-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const displaced = join(root, 'native-manifest-owned.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const context = Object.freeze({ operationId: 'operation-manifest-reread-aba', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    let swapped = false;
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async (_workspace: string, relative: string) => join(root, relative),
        resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeManifestReread: async (path: string) => {
        const owned = await readFile(path);
        await rename(path, displaced);
        await writeFile(path, owned);
        swapped = true;
      },
    } as never);

    await expect(
      port.createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' });
    expect(swapped).toBe(true);
    await expect(Promise.all([readFile(manifestPath), readFile(displaced)])).resolves.toEqual([
      await readFile(displaced),
      await readFile(displaced),
    ]);
  });

  it('deletes a verified native manifest generation and cleans it idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-retained-cleanup-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) =>
        relative.includes('operation-evidence') ? root : join(root, relative),
      resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-native-retained', workspaceId });
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
    await port.removeLinkedManifest({ context: verified, evidence });

    await expect(stat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const retained = (await readdir(root)).filter(
      name => name.includes('native-manifest.v1.json') && name.endsWith('.retained'),
    );
    expect(retained).toEqual([]);
  });

  it('recovers a crash between native quarantine fsync and retained deletion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-delete-restart-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const manifestPath = join(root, 'native-manifest.v1.json');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) =>
        relative.includes('operation-evidence') ? root : join(root, relative),
      resolveWrite: async () => ({ path: manifestPath, overwrites: false }),
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-native-delete-restart', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(context, projection);
    const crashing = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      afterNativeQuarantineFsync: async () => {
        throw Object.assign(new Error('crash after native quarantine fsync'), {
          code: 'TEST_NATIVE_QUARANTINE_CRASH',
        });
      },
    } as never);
    const evidence = await crashing.createNativeManifest({ context: verified, projection });

    await expect(
      crashing.removeLinkedManifest({ context: verified, evidence }),
    ).rejects.toMatchObject({ code: 'TEST_NATIVE_QUARANTINE_CRASH' });
    expect((await readdir(root)).filter(name => name.endsWith('.retained'))).toHaveLength(1);

    const restarted = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    await restarted.removeLinkedManifest({ context: verified, evidence });
    await restarted.removeLinkedManifest({ context: verified, evidence });
    expect((await readdir(root)).filter(name => name.endsWith('.retained'))).toEqual([]);
  });

  it('recovers retained native cleanup after restart through the real workspace policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-real-policy-restart-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/a.png'), 'a');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const canonicalRoot = await realpath(root);
    const policy = createWorkspacePolicy(
      {
        list: async () => [
          {
            workspaceId,
            path: canonicalRoot,
            realPath: canonicalRoot,
            addedAt: '2026-09-05T00:00:00.000Z',
          },
        ],
      },
      { boundaryInspector: { assertSafe: async () => undefined } },
    );
    const context = Object.freeze({ operationId: 'operation-native-real-restart', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(context, projection);
    const crashing = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      afterNativeQuarantineFsync: async () => {
        throw Object.assign(new Error('crash after native quarantine fsync'), {
          code: 'TEST_NATIVE_REAL_RESTART_CRASH',
        });
      },
    });
    const evidence = await crashing.createNativeManifest({ context: verified, projection });
    await expect(
      crashing.removeLinkedManifest({ context: verified, evidence }),
    ).rejects.toMatchObject({ code: 'TEST_NATIVE_REAL_RESTART_CRASH' });

    const restarted = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    await restarted.removeLinkedManifest({ context: verified, evidence });
    await restarted.removeLinkedManifest({ context: verified, evidence });
    const operationDirectory = join(root, evidence.manifestRelativePath, '..');
    expect((await readdir(operationDirectory)).filter(name => name.endsWith('.retained'))).toEqual(
      [],
    );
  });

  it('streams root discovery to one bounded typed manual-cleanup state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-discovery-cap-'));
    roots.push(root);
    for (let index = 0; index < 12; index += 1) {
      await mkdir(join(root, index.toString(16).padStart(64, '0')));
    }
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => root,
        resolveWrite: async () => ({ path: join(root, 'unused'), overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      retainedLimits: { maxRows: 4, maxBytes: 4_096, maxScanEntries: 4 },
    } as never);

    await expect(
      port.discoverAndCleanupOrphans({
        workspaceId: 'workspace',
        hasLinkedEvidence: async () => false,
      }),
    ).resolves.toMatchObject({
      status: 'manual-cleanup',
      errorCode: 'NATIVE_RETAINED_CAPACITY_EXCEEDED',
      scannedEntries: 4,
      retainedRows: 0,
      retainedBytes: 0,
    });
  });

  it('processes exactly maxScanEntries and reports manual only on the next entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-discovery-exact-cap-'));
    roots.push(root);
    // Three ordinary entries plus the held mutex lock are the exact four-entry budget.
    for (let index = 0; index < 3; index += 1) {
      await writeFile(join(root, `ordinary-${index}`), 'x');
    }
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => root,
        resolveWrite: async () => ({ path: join(root, 'unused'), overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      retainedLimits: { maxRows: 4, maxBytes: 4_096, maxScanEntries: 4 },
    } as never);

    await expect(
      port.discoverAndCleanupOrphans({
        workspaceId: 'workspace',
        hasLinkedEvidence: async () => false,
      }),
    ).resolves.toEqual({
      status: 'ready',
      scannedEntries: 4,
      retainedRows: 0,
      retainedBytes: 0,
    });
  });

  it('shares one exact 4096-entry root-and-child inventory across both orphan stores', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sfp-shared-exact-scan-cap-'));
    roots.push(workspaceRoot);
    const evidenceRoot = join(workspaceRoot, '.sfp', 'operation-evidence');
    const operationDirectory = join(evidenceRoot, 'a'.repeat(64));
    await mkdir(operationDirectory, { recursive: true });
    const createPrefixEntries = async (start: number, count: number): Promise<void> => {
      for (let offset = 0; offset < count; offset += 128) {
        await Promise.all(
          Array.from({ length: Math.min(128, count - offset) }, (_, index) =>
            writeFile(
              join(
                operationDirectory,
                `.retained-marker-authority-${String(start + offset + index).padStart(4, '0')}`,
              ),
              'x',
            ),
          ),
        );
      }
    };
    // Mutex lock + one operation directory + 4,094 operation children = exactly 4,096 dirents.
    await createPrefixEntries(0, 4_094);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRoot: async () => workspaceRoot,
      resolveRead: async (_workspace, relative) => {
        const path = join(workspaceRoot, relative);
        await stat(path);
        return path;
      },
      resolveWrite: async (_workspace, relative) => ({
        path: join(workspaceRoot, relative),
        overwrites: false,
      }),
      assertWithinRoot: async () => undefined,
    };
    const limits = { maxRows: 8, maxBytes: 1_000_000, maxScanEntries: 4_096 };
    const results = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedMarkerLimits: limits,
    } as never);
    const native = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedLimits: limits,
    } as never);

    await expect(
      results.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toEqual({
      status: 'ready',
      scannedEntries: 4_096,
      retainedRows: 0,
      retainedBytes: 0,
    });
    await expect(
      native.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toEqual({
      status: 'ready',
      scannedEntries: 4_096,
      retainedRows: 0,
      retainedBytes: 0,
    });

    await createPrefixEntries(4_094, 1);
    await expect(
      results.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toMatchObject({
      status: 'manual-cleanup',
      errorCode: 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
      scannedEntries: 4_096,
    });
    await expect(
      native.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toMatchObject({
      status: 'manual-cleanup',
      errorCode: 'NATIVE_RETAINED_CAPACITY_EXCEEDED',
      scannedEntries: 4_096,
    });
    expect(await readdir(operationDirectory)).toHaveLength(4_095);
  }, 30_000);

  it('turns native orphan-root policy and reparse failures into typed bounded manual state', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sfp-native-discovery-reparse-outside-'));
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-discovery-reparse-root-'));
    roots.push(outside, root);
    const linkPath = join(root, 'evidence-link');
    await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    for (const failure of [
      Object.assign(new Error('policy denied'), { code: 'PATH_OUTSIDE_WORKSPACE' }),
      null,
    ]) {
      const port = new NativeEvidenceArtifactPort({
        workspacePolicy: {
          resolveRead: async () => {
            if (failure !== null) throw failure;
            return linkPath;
          },
          resolveWrite: async () => ({ path: join(root, 'unused'), overwrites: false }),
          assertWithinRoot: async () => undefined,
        },
        atomicFiles: new AtomicFileStore(),
      });

      await expect(
        port.discoverAndCleanupOrphans({
          workspaceId: 'workspace',
          hasLinkedEvidence: async () => false,
        }),
      ).resolves.toMatchObject({
        status: 'manual-cleanup',
        errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
        scannedEntries: 0,
      });
    }
  });

  it.each(['null\n', '[]\n', '{}\n', '{not-json\n'])(
    'turns malformed or wrong-shape native orphan JSON into typed manual state: %s',
    async manifestBytes => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-native-malformed-orphan-'));
      roots.push(root);
      const operationDirectory = join(root, 'a'.repeat(64));
      await mkdir(operationDirectory);
      const manifestPath = join(operationDirectory, 'native-manifest.v1.json');
      await writeFile(manifestPath, manifestBytes);
      const port = new NativeEvidenceArtifactPort({
        workspacePolicy: {
          resolveRead: async () => root,
          resolveWrite: async () => ({ path: manifestPath, overwrites: true }),
          assertWithinRoot: async () => undefined,
        },
        atomicFiles: new AtomicFileStore(),
      });

      await expect(
        port.discoverAndCleanupOrphans({
          workspaceId: 'workspace',
          hasLinkedEvidence: async () => false,
        }),
      ).resolves.toMatchObject({
        status: 'manual-cleanup',
        errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
      });
      await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBytes);
    },
  );

  it('charges retained native manifest rows and bytes to the shared discovery state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-retained-metrics-'));
    roots.push(root);
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets/a.png'), 'a');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) => join(root, relative),
      resolveWrite: async (_workspace, relative) => {
        const path = join(root, relative);
        return {
          path,
          overwrites: await stat(path).then(
            () => true,
            () => false,
          ),
        };
      },
      assertWithinRoot: async () => undefined,
    };
    const context = Object.freeze({ operationId: 'operation-native-metrics', workspaceId });
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
      afterNativeQuarantineFsync: async () => {
        throw Object.assign(new Error('retain native generation for discovery'), {
          code: 'TEST_NATIVE_DISCOVERY_RETAINED',
        });
      },
    } as never);
    const evidence = await port.createNativeManifest({ context: verified, projection });
    const fixed = join(root, evidence.manifestRelativePath);
    await expect(port.removeLinkedManifest({ context: verified, evidence })).rejects.toMatchObject({
      code: 'TEST_NATIVE_DISCOVERY_RETAINED',
    });
    const retainedName = (await readdir(join(fixed, '..'))).find(name =>
      name.endsWith('.retained'),
    )!;
    const retainedBytes = (await stat(join(fixed, '..', retainedName))).size;

    await expect(
      port.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toMatchObject({
      status: 'ready',
      retainedRows: 1,
      retainedBytes,
    });
    await expect(stat(join(fixed, '..', retainedName))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shares one prospective workspace row cap between retained result and native evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-unified-evidence-cap-'));
    roots.push(root);
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets/a.png'), 'a');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRead: async (_workspace, relative) => join(root, relative),
      resolveWrite: async (_workspace, relative) => {
        const path = join(root, relative);
        return {
          path,
          overwrites: await stat(path).then(
            () => true,
            () => false,
          ),
        };
      },
      assertWithinRoot: async () => undefined,
    };
    const limits = { maxRows: 1, maxBytes: 1_000_000, maxScanEntries: 100 };
    const resultOperationId = 'operation-unified-result';
    const resultOptions = createToolInvocationOptions(true, resultOperationId, workspaceId);
    const resultBytes = Buffer.from('{"result":true}');
    const results = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedMarkerLimits: limits,
      afterRetainedMarkerFsync: async () => {
        throw Object.assign(new Error('hold one result retention row'), {
          code: 'TEST_RESULT_RETAINED',
        });
      },
    } as never);
    const artifact = await results.createNew({
      workspaceId,
      operationId: resultOperationId,
      intent: resultOptions.captureIntent,
      canonicalRedactedBytes: resultBytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(resultBytes).digest('hex')}`,
    });
    await expect(
      results.removeLinked({ workspaceId, operationId: resultOperationId, artifact }),
    ).rejects.toMatchObject({ code: 'TEST_RESULT_RETAINED' });

    const context = Object.freeze({ operationId: 'operation-unified-native', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(context, projection);
    let quarantineReached = false;
    const native = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedLimits: limits,
      afterNativeQuarantineFsync: async () => {
        quarantineReached = true;
      },
    } as never);
    const evidence = await native.createNativeManifest({ context: verified, projection });

    await expect(
      native.removeLinkedManifest({ context: verified, evidence }),
    ).rejects.toMatchObject({ code: 'NATIVE_RETAINED_CAPACITY_EXCEEDED' });
    expect(quarantineReached).toBe(false);
    await expect(readFile(join(root, evidence.manifestRelativePath))).resolves.toBeDefined();
  });

  it('applies the shared native row cap before result orphan discovery publishes another row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-to-result-discovery-cap-'));
    roots.push(root);
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets/a.png'), 'a');
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const policy: WorkspacePolicy = {
      resolveRoot: async () => root,
      resolveRead: async (_workspace, relative) => {
        const path = join(root, relative);
        await stat(path);
        return path;
      },
      resolveWrite: async (_workspace, relative) => {
        const path = join(root, relative);
        return {
          path,
          overwrites: await stat(path).then(
            () => true,
            () => false,
          ),
        };
      },
      assertWithinRoot: async () => undefined,
    };
    const limits = { maxRows: 1, maxBytes: 1_000_000, maxScanEntries: 100 };
    const nativeContext = Object.freeze({
      operationId: 'operation-native-retained-first',
      workspaceId,
    });
    const nativeProjection = createOperationEvidenceProjector().project(
      nativeContext,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:2', path: 'assets/a.png' },
    );
    if (nativeProjection.kind !== 'export-candidates') throw new Error('fixture projection failed');
    const verified = verifyNativeEvidenceContext(nativeContext, nativeProjection);
    const native = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedLimits: limits,
      afterNativeQuarantineFsync: async () => {
        throw Object.assign(new Error('retain native row'), { code: 'TEST_RETAIN_NATIVE_ROW' });
      },
    } as never);
    const nativeEvidence = await native.createNativeManifest({
      context: verified,
      projection: nativeProjection,
    });
    await expect(
      native.removeLinkedManifest({ context: verified, evidence: nativeEvidence }),
    ).rejects.toMatchObject({ code: 'TEST_RETAIN_NATIVE_ROW' });

    const resultOperationId = 'operation-result-orphan-second';
    const resultOptions = createToolInvocationOptions(true, resultOperationId, workspaceId);
    const resultBytes = Buffer.from('{"result":true}');
    let resultRetentionPublished = false;
    const results = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedMarkerLimits: limits,
      afterRetainedMarkerFsync: async () => {
        resultRetentionPublished = true;
      },
    });
    await results.createNew({
      workspaceId,
      operationId: resultOperationId,
      intent: resultOptions.captureIntent,
      canonicalRedactedBytes: resultBytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(resultBytes).digest('hex')}`,
    });

    await expect(
      results.discoverAndCleanupOrphans({ workspaceId, hasLinkedEvidence: async () => false }),
    ).resolves.toMatchObject({
      status: 'manual-cleanup',
      errorCode: 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
      retainedRows: 1,
    });
    expect(resultRetentionPublished).toBe(false);
    const retained = (
      await readdir(join(root, '.sfp', 'operation-evidence'), { recursive: true })
    ).filter(path => path.endsWith('.retained'));
    expect(retained).toHaveLength(1);
  });
});
