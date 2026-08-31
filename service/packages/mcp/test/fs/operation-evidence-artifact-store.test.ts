import { createHash } from 'node:crypto';
import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

import {
  createToolInvocationOptions,
  type ResultArtifactV1,
  type WorkspacePolicy,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';
import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const realWorkspaceAuthority = async (root: string) => {
  const stateRoot = join(root, 'workspace-state');
  const workspaceRoot = join(root, 'workspace');
  await mkdir(stateRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const permissions: BoundStatePermissions = {
    stateRoot: resolve(stateRoot),
    ensureSecure: async () => undefined,
    verifySecure: async () => undefined,
    inspectSecure: async path => {
      const metadata = await stat(path, { bigint: true });
      return {
        canonicalPath: await realpath(path),
        key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
        directory: metadata.isDirectory(),
        file: metadata.isFile(),
      };
    },
  };
  const workspaceStore = createWorkspaceConfigStore(
    stateRoot,
    { hasUnsettled: async () => false },
    permissions,
  );
  const workspaceId = (await workspaceStore.add('actor', workspaceRoot)).workspaceId;
  return { workspaceRoot, workspaceId, policy: createWorkspacePolicy(workspaceStore) };
};

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
    expect(resolveWrite).toHaveBeenCalledWith(
      workspaceId,
      (options.captureIntent.relativePath as string).replaceAll('/', sep),
    );
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
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, 'operation-retained', workspaceId);
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

  it('retains one recognized verified marker quarantine under the default platform policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-posix-retained-marker-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-posix-retained-marker';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const marker = join(dirname(target), 'cleanup-intent.v1.json');
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
    const artifact = await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    const verifiedMarker = await readFile(marker);

    await store.removeLinked({ workspaceId, operationId, artifact });
    await expect(
      store.removeLinked({ workspaceId, operationId, artifact }),
    ).resolves.toBeUndefined();

    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    const retainedNames = (await readdir(dirname(marker))).filter(name =>
      /^\.cleanup-intent\.v1\.json\.[0-9a-f]{64}\.[0-9a-f]{32}\.retained$/u.test(name),
    );
    expect(retainedNames).toHaveLength(1);
    await expect(readFile(join(dirname(marker), retainedNames[0] as string))).resolves.toEqual(
      verifiedMarker,
    );

    let absenceProofs = 0;
    await store.discoverAndCleanupOrphans({
      workspaceId,
      hasLinkedEvidence: async () => {
        absenceProofs += 1;
        return false;
      },
    });
    expect(absenceProofs).toBe(0);
    await expect(readFile(join(dirname(marker), retainedNames[0] as string))).resolves.toEqual(
      verifiedMarker,
    );
  });

  it('recovers a receipt cleanup crash after removeLinked and durably completes the intent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-receipt-cleanup-restart-'));
    roots.push(root);
    const stateRoot = join(root, 'receipt-state');
    await mkdir(stateRoot, { recursive: true });
    const { workspaceRoot, workspaceId, policy } = await realWorkspaceAuthority(root);
    const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
    const operationId = 'operation-receipt-cleanup-restart';
    const completedAt = 1_724_803_200_000;
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(workspaceRoot, options.captureIntent.relativePath as string);
    const artifacts = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const resultHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
    const artifact = await artifacts.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash,
    });
    const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await receipts.recover();
    const reservation = await receipts.reserveBeforeRuntime(actorId, operationId, 1);
    await receipts.prepareAndFsync(reservation.reservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId,
      operationId,
      operationKind: 'tool',
      operationName: 'get_selection',
      argsHash: `sha256:${'b'.repeat(64)}`,
      workspaceId,
      fileExecutionKeyHash: null,
      targetBindingHash: null,
      captureIntentHash: `sha256:${'c'.repeat(64)}`,
      captureResult: true,
      finalizerHash: `sha256:${'d'.repeat(64)}`,
      daemonGenerationHash: `sha256:${'e'.repeat(64)}`,
      completedAt: new Date(completedAt).toISOString(),
      terminalStatus: 'succeeded',
      resultHash,
      resultBytes: bytes.byteLength,
      resultArtifact: artifact,
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
    });
    await receipts.compact({
      now: completedAt + 2_592_000_000,
      linkedAt: observed => (observed === operationId ? completedAt : null),
    });

    await expect(
      receipts.drainPendingArtifactCleanup(async receipt => {
        await artifacts.removeLinked({
          workspaceId,
          operationId: receipt.operationId,
          artifact: receipt.resultArtifact as typeof artifact,
        });
        throw Object.assign(new Error('injected cleanup crash'), { code: 'TEST_CLEANUP_CRASH' });
      }),
    ).rejects.toMatchObject({ code: 'TEST_CLEANUP_CRASH' });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await restarted.recover();
    let resumed = 0;
    await restarted.drainPendingArtifactCleanup(async receipt => {
      resumed += 1;
      await artifacts.removeLinked({
        workspaceId,
        operationId: receipt.operationId,
        artifact: receipt.resultArtifact as typeof artifact,
      });
    });
    expect(resumed).toBe(1);
    expect((await stat(restarted.cleanupIntentPath)).size).toBe(0);
    await restarted.drainPendingArtifactCleanup(async () => {
      resumed += 1;
    });
    expect(resumed).toBe(1);
    await expect(
      restarted.reserveBeforeRuntime(actorId, 'operation-after-cleanup', 1),
    ).resolves.toMatchObject({
      reservationId: expect.stringMatching(/^sfp_er1_/u),
      reservedBytes: 65_536,
    });
  });

  it.each(['marker-retained', 'artifact-quarantined', 'artifact-unlinked'] as const)(
    'recovers process death after %s fsync from deterministic cleanup state',
    async crashPoint => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-cleanup-state-crash-'));
      roots.push(root);
      const { workspaceRoot, workspaceId, policy } = await realWorkspaceAuthority(root);
      const operationId = `operation-artifact-crash-${crashPoint}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(workspaceRoot, options.captureIntent.relativePath as string);
      let crashArmed = true;
      const crashing = new OperationEvidenceArtifactStore({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
        afterRetainedMarkerFsync:
          crashPoint === 'marker-retained'
            ? async () => {
                if (crashArmed) {
                  crashArmed = false;
                  throw Object.assign(new Error('crash after retained marker fsync'), {
                    code: 'TEST_RETAINED_MARKER_CRASH',
                  });
                }
              }
            : undefined,
        afterArtifactQuarantineFsync:
          crashPoint === 'artifact-quarantined'
            ? async () => {
                if (crashArmed) {
                  crashArmed = false;
                  throw Object.assign(new Error('crash after artifact quarantine fsync'), {
                    code: 'TEST_ARTIFACT_QUARANTINE_CRASH',
                  });
                }
              }
            : undefined,
        afterArtifactUnlinkFsync:
          crashPoint === 'artifact-unlinked'
            ? async () => {
                if (crashArmed) {
                  crashArmed = false;
                  throw Object.assign(new Error('crash after artifact unlink fsync'), {
                    code: 'TEST_ARTIFACT_UNLINK_CRASH',
                  });
                }
              }
            : undefined,
      } as never);
      const bytes = Buffer.from('{"ok":true}', 'utf8');
      const artifact = await crashing.createNew({
        workspaceId,
        operationId,
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
      const artifactQuarantine = join(
        dirname(target),
        `.result.v1.json.${artifact.artifactDigest64}.cleanup-artifact`,
      );

      await expect(
        crashing.removeLinked({ workspaceId, operationId, artifact }),
      ).rejects.toMatchObject({
        code:
          crashPoint === 'marker-retained'
            ? 'TEST_RETAINED_MARKER_CRASH'
            : crashPoint === 'artifact-quarantined'
              ? 'TEST_ARTIFACT_QUARANTINE_CRASH'
              : 'TEST_ARTIFACT_UNLINK_CRASH',
      });
      const retainedNames = (await readdir(dirname(target))).filter(name =>
        name.endsWith('.retained'),
      );
      expect(retainedNames).toHaveLength(1);
      const readMaybe = (path: string): Promise<Buffer | null> =>
        readFile(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      expect({
        fixedArtifact: await readMaybe(target),
        artifactQuarantine: await readMaybe(artifactQuarantine),
      }).toEqual({
        fixedArtifact: crashPoint === 'marker-retained' ? bytes : null,
        artifactQuarantine: crashPoint === 'artifact-quarantined' ? bytes : null,
      });

      const restarted = new OperationEvidenceArtifactStore({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      await restarted.removeLinked({ workspaceId, operationId, artifact });
      await expect(stat(artifactQuarantine)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(join(dirname(target), retainedNames[0] as string)),
      ).resolves.toBeDefined();
    },
  );

  it('enforces the global retained-marker row cap before publishing another residue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-retained-marker-row-cap-'));
    roots.push(root);
    const { workspaceRoot, workspaceId, policy } = await realWorkspaceAuthority(root);
    const writer = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const fixtures = await Promise.all(
      ['a', 'b', 'c'].map(async suffix => {
        const operationId = `operation-retained-row-${suffix}`;
        const options = createToolInvocationOptions(true, operationId, workspaceId);
        const artifact = await writer.createNew({
          workspaceId,
          operationId,
          intent: options.captureIntent,
          canonicalRedactedBytes: bytes,
          resultSchemaHash: `sha256:${'a'.repeat(64)}`,
          resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        });
        return {
          operationId,
          artifact,
          target: join(workspaceRoot, options.captureIntent.relativePath as string),
        };
      }),
    );
    const capped = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedMarkerLimits: { maxRows: 2, maxBytes: 1_000_000, maxScanEntries: 64 },
    } as never);

    await capped.removeLinked({
      workspaceId,
      operationId: fixtures[0]?.operationId as string,
      artifact: fixtures[0]?.artifact as Readonly<ResultArtifactV1>,
    });
    await capped.removeLinked({
      workspaceId,
      operationId: fixtures[1]?.operationId as string,
      artifact: fixtures[1]?.artifact as Readonly<ResultArtifactV1>,
    });
    await expect(
      capped.removeLinked({
        workspaceId,
        operationId: fixtures[2]?.operationId as string,
        artifact: fixtures[2]?.artifact as Readonly<ResultArtifactV1>,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED' });
    await expect(
      Promise.all([
        readFile(fixtures[2]?.target as string),
        readFile(join(dirname(fixtures[2]?.target as string), 'cleanup-intent.v1.json')),
      ]),
    ).resolves.toBeDefined();
  });

  it('enforces the global retained-marker byte cap at cap plus one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-retained-marker-byte-cap-'));
    roots.push(root);
    const { workspaceRoot, workspaceId, policy } = await realWorkspaceAuthority(root);
    const writer = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const fixtures = [] as Array<{
      operationId: string;
      artifact: Awaited<ReturnType<OperationEvidenceArtifactStore['createNew']>>;
      target: string;
      markerBytes: number;
    }>;
    for (const suffix of ['a', 'b']) {
      const operationId = `operation-retained-bytes-${suffix}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(workspaceRoot, options.captureIntent.relativePath as string);
      const artifact = await writer.createNew({
        workspaceId,
        operationId,
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
      fixtures.push({
        operationId,
        artifact,
        target,
        markerBytes: (await stat(join(dirname(target), 'cleanup-intent.v1.json'))).size,
      });
    }
    const capped = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      retainedMarkerLimits: {
        maxRows: 10,
        maxBytes: fixtures[0]?.markerBytes as number,
        maxScanEntries: 64,
      },
    } as never);

    await capped.removeLinked({
      workspaceId,
      operationId: fixtures[0]?.operationId as string,
      artifact: fixtures[0]?.artifact as Readonly<ResultArtifactV1>,
    });
    await expect(
      capped.removeLinked({
        workspaceId,
        operationId: fixtures[1]?.operationId as string,
        artifact: fixtures[1]?.artifact as Readonly<ResultArtifactV1>,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED' });
    await expect(readFile(fixtures[1]?.target as string)).resolves.toEqual(bytes);
  });

  it.each(['fixed-plus-retained', 'fixed-plus-malformed-retained'] as const)(
    'fails closed for contradictory %s marker namespace state',
    async fault => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-marker-retained-contradiction-'));
      roots.push(root);
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const operationId = `operation-retained-contradiction-${fault}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(root, options.captureIntent.relativePath as string);
      const marker = join(dirname(target), 'cleanup-intent.v1.json');
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
      });
      const bytes = Buffer.from('{"ok":true}', 'utf8');
      const artifact = await store.createNew({
        workspaceId,
        operationId,
        intent: options.captureIntent,
        canonicalRedactedBytes: bytes,
        resultSchemaHash: `sha256:${'a'.repeat(64)}`,
        resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
      const markerBytes = await readFile(marker);
      const retainedName =
        fault === 'fixed-plus-retained'
          ? `.cleanup-intent.v1.json.${createHash('sha256').update(markerBytes).digest('hex')}.${'a'.repeat(32)}.retained`
          : '.cleanup-intent.v1.json.foreign.retained';
      const retainedPath = join(dirname(marker), retainedName);
      await writeFile(retainedPath, fault === 'fixed-plus-retained' ? markerBytes : 'foreign');

      await expect(
        store.removeLinked({ workspaceId, operationId, artifact }),
      ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
      await expect(
        Promise.all([readFile(target), readFile(marker), readFile(retainedPath)]),
      ).resolves.toEqual([
        bytes,
        markerBytes,
        fault === 'fixed-plus-retained' ? markerBytes : Buffer.from('foreign'),
      ]);
    },
  );

  it('unlinks the verified marker quarantine under held-handle Windows policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-windows-marker-unlink-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-windows-marker-unlink';
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
      markerQuarantinePolicy: 'unlink-protected',
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

    await store.removeLinked({ workspaceId, operationId, artifact });

    expect(await readdir(dirname(target))).toEqual([]);
  });

  it('fails closed when discovery finds more than one recognized retained marker quarantine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-marker-retained-cap-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-retained-marker-cap';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const marker = join(dirname(target), 'cleanup-intent.v1.json');
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
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    const verifiedMarker = await readFile(marker);
    const markerDigest = createHash('sha256').update(verifiedMarker).digest('hex');
    await unlink(target);
    await unlink(marker);
    const retainedNames = ['a'.repeat(32), 'b'.repeat(32)].map(
      nonce => `.cleanup-intent.v1.json.${markerDigest}.${nonce}.retained`,
    );
    await Promise.all(
      retainedNames.map(name => writeFile(join(dirname(marker), name), verifiedMarker)),
    );

    await expect(
      store.discoverAndCleanupOrphans({
        workspaceId,
        hasLinkedEvidence: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
    await expect(
      Promise.all(retainedNames.map(name => readFile(join(dirname(marker), name)))),
    ).resolves.toEqual([verifiedMarker, verifiedMarker]);
  });

  it('fails orphan cleanup closed when bytes changed and preserves the path for manual repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-orphan-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, 'operation-orphan', workspaceId);
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
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, 'operation-alias', workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const alias = join(dirname(target), 'foreign-alias.json');
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
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
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
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, 'operation-replacement', workspaceId);
    const target = join(root, options.captureIntent.relativePath as string);
    const displaced = join(dirname(target), 'verified-original.json');
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const foreign = Buffer.from('foreign replacement', 'utf8');
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
      beforeCleanupCommit: async (path: string) => {
        await rename(path, displaced);
        await writeFile(path, foreign);
      },
    } as never);
    const digest = createHash('sha256').update(bytes).digest('hex');
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

  it('preserves a linked marker when its same-inode parent moves outside the workspace behind a junction', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'sfp-linked-marker-parent-reparse-'));
    roots.push(sandbox);
    const workspaceRoot = join(sandbox, 'workspace');
    const linkProbeTarget = join(sandbox, 'junction-probe-target');
    const linkProbe = join(sandbox, 'junction-probe');
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(linkProbeTarget);
    try {
      await symlink(linkProbeTarget, linkProbe, process.platform === 'win32' ? 'junction' : 'dir');
      await unlink(linkProbe);
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return;
      }
      throw error;
    }
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-linked-marker-same-parent-reparse';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(workspaceRoot, options.captureIntent.relativePath as string);
    const operationDirectory = dirname(target);
    const outsideParent = join(sandbox, 'moved-operation-parent');
    let relocated = false;
    let linked = false;
    const policy: WorkspacePolicy = {
      resolveWrite: async (_workspace, relative) => ({
        path: join(workspaceRoot, relative),
        overwrites: false,
      }),
      resolveRead: async (_workspace, relative) => join(workspaceRoot, relative),
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
      beforeMarkerCleanupCommit: async () => {
        await rename(operationDirectory, outsideParent);
        relocated = true;
        await symlink(
          outsideParent,
          operationDirectory,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        linked = true;
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
    const markerName = 'cleanup-intent.v1.json';
    const verifiedMarker = await readFile(join(operationDirectory, markerName));

    await expect(store.removeLinked({ workspaceId, operationId, artifact })).rejects.toMatchObject({
      code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
    });
    await expect(
      readFile(join(relocated ? outsideParent : operationDirectory, markerName)),
    ).resolves.toEqual(verifiedMarker);
    const operationDirectoryIsLink = await lstat(operationDirectory).then(
      metadata => metadata.isSymbolicLink(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    expect(operationDirectoryIsLink).toBe(linked);
  });

  it('rechecks the same-inode parent synchronously at the latest marker precommit point', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'sfp-marker-latest-parent-reparse-'));
    roots.push(sandbox);
    const workspaceRoot = join(sandbox, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-marker-latest-parent-reparse';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(workspaceRoot, options.captureIntent.relativePath as string);
    const operationDirectory = dirname(target);
    const outsideParent = join(sandbox, 'moved-latest-marker-parent');
    const markerName = 'cleanup-intent.v1.json';
    let relocated = false;
    let linked = false;
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: {
        resolveWrite: async (_workspace: string, relative: string) => ({
          path: join(workspaceRoot, relative),
          overwrites: false,
        }),
        resolveRead: async (_workspace: string, relative: string) => join(workspaceRoot, relative),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeMarkerQuarantineCommit: () => {
        renameSync(operationDirectory, outsideParent);
        relocated = true;
        symlinkSync(
          outsideParent,
          operationDirectory,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        linked = true;
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
    const verifiedMarker = await readFile(join(operationDirectory, markerName));

    await expect(store.removeLinked({ workspaceId, operationId, artifact })).rejects.toMatchObject({
      code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
    });
    await expect(
      readFile(join(relocated ? outsideParent : operationDirectory, markerName)),
    ).resolves.toEqual(verifiedMarker);
    const operationDirectoryIsLink = await lstat(operationDirectory).then(
      metadata => metadata.isSymbolicLink(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    expect(operationDirectoryIsLink).toBe(linked);
  });

  it.each(['restore', 'replacement-winner'] as const)(
    'fails closed after post-quarantine parent relocation for %s',
    async fault => {
      const sandbox = await mkdtemp(join(tmpdir(), 'sfp-marker-post-quarantine-reparse-'));
      roots.push(sandbox);
      const workspaceRoot = join(sandbox, 'workspace');
      await mkdir(workspaceRoot, { recursive: true });
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const operationId = `operation-marker-post-quarantine-${fault}`;
      const options = createToolInvocationOptions(true, operationId, workspaceId);
      const target = join(workspaceRoot, options.captureIntent.relativePath as string);
      const operationDirectory = dirname(target);
      const outsideParent = join(sandbox, `moved-post-quarantine-${fault}`);
      const markerName = 'cleanup-intent.v1.json';
      const foreign = Buffer.from(`foreign-${fault}\n`, 'utf8');
      const foreignSource = join(sandbox, `foreign-marker-${fault}`);
      writeFileSync(foreignSource, foreign);
      let relocated = false;
      let linked = false;
      let replacementInstalled = false;
      let quarantineName: string | null = null;
      const store = new OperationEvidenceArtifactStore({
        workspacePolicy: {
          resolveWrite: async (_workspace: string, relative: string) => ({
            path: join(workspaceRoot, relative),
            overwrites: false,
          }),
          resolveRead: async (_workspace: string, relative: string) =>
            join(workspaceRoot, relative),
          assertWithinRoot: async () => undefined,
        },
        atomicFiles: new AtomicFileStore(),
        afterMarkerQuarantineCommit: (_path: string, quarantinePath: string) => {
          quarantineName = basename(quarantinePath);
          try {
            renameSync(operationDirectory, outsideParent);
            relocated = true;
            symlinkSync(
              outsideParent,
              operationDirectory,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            linked = true;
          } catch (error) {
            if (fault === 'replacement-winner') {
              renameSync(
                foreignSource,
                join(relocated ? outsideParent : operationDirectory, markerName),
              );
              replacementInstalled = true;
            }
            throw error;
          }
          if (fault === 'replacement-winner') {
            renameSync(foreignSource, join(outsideParent, markerName));
            replacementInstalled = true;
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
      const verifiedMarker = await readFile(join(operationDirectory, markerName));

      let cleanupError: unknown;
      try {
        await store.removeLinked({ workspaceId, operationId, artifact });
      } catch (error) {
        cleanupError = error;
      }
      expect(cleanupError).toMatchObject({ code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' });
      const authorityParent = relocated ? outsideParent : operationDirectory;
      const cleanupNames = (await readdir(authorityParent)).filter(
        name => name.endsWith('.cleanup') || name.endsWith('.retained'),
      );
      const quarantineBytes =
        cleanupNames[0] === undefined
          ? null
          : await readFile(join(authorityParent, cleanupNames[0]));
      expect({
        marker: await readFile(join(authorityParent, markerName)),
        replacementInstalled,
        cleanupNames,
        quarantineBytes,
      }).toEqual({
        marker: fault === 'restore' ? verifiedMarker : foreign,
        replacementInstalled: fault === 'replacement-winner',
        cleanupNames: fault === 'restore' ? [] : [quarantineName],
        quarantineBytes: fault === 'restore' ? null : verifiedMarker,
      });
      const operationDirectoryIsLink = await lstat(operationDirectory).then(
        metadata => metadata.isSymbolicLink(),
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      expect(operationDirectoryIsLink).toBe(linked);
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

  it('holds the marker parent identity across the asynchronous absence proof', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'sfp-marker-absence-parent-reparse-'));
    roots.push(sandbox);
    const workspaceRoot = join(sandbox, 'workspace');
    const linkProbeTarget = join(sandbox, 'junction-probe-target');
    const linkProbe = join(sandbox, 'junction-probe');
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(linkProbeTarget);
    try {
      await symlink(linkProbeTarget, linkProbe, process.platform === 'win32' ? 'junction' : 'dir');
      await unlink(linkProbe);
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return;
      }
      throw error;
    }
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const operationId = 'operation-marker-absence-parent-reparse';
    const options = createToolInvocationOptions(true, operationId, workspaceId);
    const target = join(workspaceRoot, options.captureIntent.relativePath as string);
    const operationDirectory = dirname(target);
    const outsideParent = join(sandbox, 'moved-marker-parent');
    const markerName = 'cleanup-intent.v1.json';
    const policy: WorkspacePolicy = {
      resolveWrite: async (_workspace, relative) => ({
        path: join(workspaceRoot, relative),
        overwrites: false,
      }),
      resolveRead: async (_workspace, relative) => join(workspaceRoot, relative),
      assertWithinRoot: async () => undefined,
    };
    const store = new OperationEvidenceArtifactStore({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    await store.createNew({
      workspaceId,
      operationId,
      intent: options.captureIntent,
      canonicalRedactedBytes: bytes,
      resultSchemaHash: `sha256:${'a'.repeat(64)}`,
      resultHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    await unlink(target);
    const verifiedMarker = await readFile(join(operationDirectory, markerName));
    let relocated = false;
    let linked = false;

    await expect(
      store.discoverAndCleanupOrphans({
        workspaceId,
        hasLinkedEvidence: async () => {
          await rename(operationDirectory, outsideParent);
          relocated = true;
          await symlink(
            outsideParent,
            operationDirectory,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          linked = true;
          return false;
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      readFile(join(relocated ? outsideParent : operationDirectory, markerName)),
    ).resolves.toEqual(verifiedMarker);
    const operationDirectoryIsLink = await lstat(operationDirectory).then(
      metadata => metadata.isSymbolicLink(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    expect(operationDirectoryIsLink).toBe(linked);
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
