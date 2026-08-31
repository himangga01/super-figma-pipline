import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  PortableRelativeArtifactPathSchema,
  type OperationEvidenceArtifactPort,
  type PrefixedSha256,
  type ResultArtifactV1,
  type VerifiedCaptureIntentV1,
  type WorkspacePolicy,
} from '@sfp/shared';

import { readFileWithinLimit, type AtomicFileStore } from './atomic-file.js';

const evidenceError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const captureRelativePath = (operationId: string): string =>
  `.sfp/operation-evidence/${createHash('sha256')
    .update('sfp-operation-evidence-path-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(operationId, 'utf8')
    .digest('hex')}/result.v1.json`;
const cleanupIntentRelativePath = (operationId: string): string =>
  captureRelativePath(operationId).replace('/result.v1.json', '/cleanup-intent.v1.json');
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;

export class OperationEvidenceArtifactStore implements OperationEvidenceArtifactPort {
  constructor(
    private readonly dependencies: {
      workspacePolicy: WorkspacePolicy;
      atomicFiles: AtomicFileStore;
      beforeCleanupCommit?: (path: string) => Promise<void>;
      beforeMarkerCleanupCommit?: (path: string) => Promise<void>;
    },
  ) {}

  async preflight(workspaceId: string, intent: VerifiedCaptureIntentV1): Promise<string | null> {
    if (!intent.captureResult) return null;
    if (!PortableRelativeArtifactPathSchema.safeParse(intent.relativePath).success) {
      throw evidenceError('EVIDENCE_ARTIFACT_PATH_INVALID', 'capture path is not portable');
    }
    const resolved = await this.dependencies.workspacePolicy.resolveWrite(
      workspaceId,
      intent.relativePath,
    );
    if (resolved.overwrites) {
      throw evidenceError('EVIDENCE_ARTIFACT_EXISTS', 'capture target already exists');
    }
    return resolved.path;
  }

  async createNew(input: {
    workspaceId: string;
    operationId: string;
    intent: VerifiedCaptureIntentV1;
    canonicalRedactedBytes: Uint8Array;
    resultSchemaHash: PrefixedSha256;
    resultHash: PrefixedSha256;
  }): Promise<Readonly<ResultArtifactV1>> {
    if (!input.intent.captureResult) {
      throw evidenceError('EVIDENCE_CAPTURE_DISABLED', 'capture artifact was not requested');
    }
    const observedDigest = digest(input.canonicalRedactedBytes);
    if (input.resultHash !== `sha256:${observedDigest}`) {
      throw evidenceError(
        'EVIDENCE_RESULT_HASH_MISMATCH',
        'capture bytes do not match result hash',
      );
    }
    const target = await this.preflight(input.workspaceId, input.intent);
    if (target === null) throw evidenceError('EVIDENCE_CAPTURE_DISABLED', 'capture is disabled');
    await mkdir(dirname(target), { recursive: true });
    const revalidated = await this.preflight(input.workspaceId, input.intent);
    if (revalidated !== target) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_PATH_CHANGED',
        'capture path changed during admission',
      );
    }
    const artifact = Object.freeze({
      artifactRelativePath: input.intent.relativePath,
      artifactDigest64: observedDigest,
      resultSchemaHash: input.resultSchemaHash,
    });
    const cleanupIntentPath = join(dirname(target), 'cleanup-intent.v1.json');
    const cleanupBase = {
      schemaVersion: 1 as const,
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      artifact,
    };
    const cleanupIntent = {
      ...cleanupBase,
      contentHash: digest(Buffer.from(JSON.stringify(cleanupBase), 'utf8')),
    };
    await this.dependencies.atomicFiles.createNew(
      cleanupIntentPath,
      Buffer.from(`${JSON.stringify(cleanupIntent)}\n`, 'utf8'),
    );
    await this.dependencies.atomicFiles.createNew(target, input.canonicalRedactedBytes);
    const observed = await readFileWithinLimit(target, input.canonicalRedactedBytes.byteLength);
    if (digest(observed) !== observedDigest) {
      throw evidenceError('EVIDENCE_ARTIFACT_MISMATCH', 'capture reread digest does not match');
    }
    return artifact;
  }

  async removeLinked(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
  }): Promise<void> {
    if (
      input.artifact.artifactRelativePath !== captureRelativePath(input.operationId) ||
      !PortableRelativeArtifactPathSchema.safeParse(input.artifact.artifactRelativePath).success
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact path does not match its fixed operation directory',
      );
    }
    const path = await this.dependencies.workspacePolicy.resolveRead(
      input.workspaceId,
      input.artifact.artifactRelativePath,
    );
    await this.dependencies.workspacePolicy.assertWithinRoot(
      input.workspaceId,
      input.artifact.artifactRelativePath,
    );
    const marker = await this.openVerifiedCleanupMarker(input);
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'artifact is not one unaliased regular file',
        );
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact identity changed before retention cleanup',
          );
        }
        const chunks: Buffer[] = [];
        let total = 0;
        /* eslint-disable no-await-in-loop -- one descriptor is read sequentially to its hard cap */
        for (;;) {
          const chunk = Buffer.allocUnsafe(Math.min(65_536, 8_388_609 - total));
          const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > 8_388_608) {
            throw evidenceError('EVIDENCE_ARTIFACT_IDENTITY_MISMATCH', 'artifact exceeds its cap');
          }
          chunks.push(chunk.subarray(0, bytesRead));
        }
        /* eslint-enable no-await-in-loop */
        bytes = Buffer.concat(chunks, total);
        const afterRead = await lstat(path);
        if (
          !afterRead.isFile() ||
          afterRead.isSymbolicLink() ||
          afterRead.nlink !== 1 ||
          !sameFile(opened, afterRead)
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact identity changed during retention cleanup',
          );
        }
        if (digest(bytes) !== input.artifact.artifactDigest64) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact digest changed before retention cleanup',
          );
        }
        await this.dependencies.beforeCleanupCommit?.(path);
        const immediatelyBeforeRename = await lstat(path);
        if (
          !immediatelyBeforeRename.isFile() ||
          immediatelyBeforeRename.isSymbolicLink() ||
          immediatelyBeforeRename.nlink !== 1 ||
          !sameFile(opened, immediatelyBeforeRename)
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact identity changed before cleanup commit',
          );
        }
        const quarantine = join(
          dirname(path),
          `.${basename(path)}.${randomBytes(16).toString('hex')}.cleanup`,
        );
        await rename(path, quarantine);
        const moved = await lstat(quarantine);
        if (!moved.isFile() || moved.isSymbolicLink() || !sameFile(opened, moved)) {
          await link(quarantine, path).catch(() => undefined);
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'pathname replacement won the cleanup commit',
          );
        }
        await unlink(quarantine);
      } finally {
        await handle.close();
      }
      await this.syncDirectory(dirname(path));
      await this.commitVerifiedCleanupMarker(marker);
    } finally {
      await marker.handle.close();
    }
  }

  private async openVerifiedCleanupMarker(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
  }): Promise<{
    path: string;
    handle: Awaited<ReturnType<typeof open>>;
    identity: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>;
  }> {
    const relativePath = cleanupIntentRelativePath(input.operationId);
    const path = await this.dependencies.workspacePolicy.resolveRead(
      input.workspaceId,
      relativePath,
    );
    await this.dependencies.workspacePolicy.assertWithinRoot(input.workspaceId, relativePath);
    const cleanupBase = {
      schemaVersion: 1 as const,
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      artifact: input.artifact,
    };
    const expected = Buffer.from(
      `${JSON.stringify({
        ...cleanupBase,
        contentHash: digest(Buffer.from(JSON.stringify(cleanupBase), 'utf8')),
      })}\n`,
      'utf8',
    );
    let before: Awaited<ReturnType<typeof lstat>>;
    try {
      before = await lstat(path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker pathname is unavailable',
      );
    }
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size !== expected.byteLength
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker is not the expected unaliased regular file',
      );
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker cannot be opened without following links',
      );
    }
    try {
      const identity = await handle.stat();
      if (
        !identity.isFile() ||
        identity.nlink !== 1 ||
        identity.size !== expected.byteLength ||
        !sameFile(before, identity)
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'cleanup marker identity changed before verification',
        );
      }
      const observed = Buffer.alloc(expected.byteLength);
      const read = await handle.read(observed, 0, observed.byteLength, 0);
      const pathnameIdentity = await lstat(path).catch(() => null);
      if (
        read.bytesRead !== observed.byteLength ||
        !observed.equals(expected) ||
        pathnameIdentity === null ||
        !pathnameIdentity.isFile() ||
        pathnameIdentity.isSymbolicLink() ||
        pathnameIdentity.nlink !== 1 ||
        !sameFile(identity, pathnameIdentity)
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'cleanup marker bytes or identity do not match',
        );
      }
      return { path, handle, identity };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async commitVerifiedCleanupMarker(marker: {
    path: string;
    handle: Awaited<ReturnType<typeof open>>;
    identity: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>;
  }): Promise<void> {
    try {
      await this.dependencies.beforeMarkerCleanupCommit?.(marker.path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker parent or pathname replacement was refused',
      );
    }
    const immediatelyBeforeRename = await lstat(marker.path).catch(() => null);
    if (
      immediatelyBeforeRename === null ||
      !immediatelyBeforeRename.isFile() ||
      immediatelyBeforeRename.isSymbolicLink() ||
      immediatelyBeforeRename.nlink !== 1 ||
      !sameFile(marker.identity, immediatelyBeforeRename)
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker pathname changed before cleanup commit',
      );
    }
    const quarantine = join(
      dirname(marker.path),
      `.${basename(marker.path)}.${randomBytes(16).toString('hex')}.cleanup`,
    );
    await rename(marker.path, quarantine);
    const moved = await lstat(quarantine).catch(() => null);
    if (
      moved === null ||
      !moved.isFile() ||
      moved.isSymbolicLink() ||
      moved.nlink !== 1 ||
      !sameFile(marker.identity, moved)
    ) {
      await link(quarantine, marker.path)
        .then(() => unlink(quarantine))
        .catch(() => undefined);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'replacement cleanup marker won the cleanup commit',
      );
    }
    await unlink(quarantine);
    await this.syncDirectory(dirname(marker.path));
  }

  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(path, 'r');
    try {
      await directory.sync().catch((error: NodeJS.ErrnoException) => {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      });
    } finally {
      await directory.close();
    }
  }

  async cleanupOrphan(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
    hasLinkedEvidence(): Promise<boolean>;
  }): Promise<void> {
    if (await input.hasLinkedEvidence()) {
      throw evidenceError('EVIDENCE_ARTIFACT_LINKED', 'linked evidence cannot be orphan-cleaned');
    }
    await this.removeLinked(input);
  }

  async hasOperationSideEffect(workspaceId: string, operationId: string): Promise<boolean> {
    const paths = [captureRelativePath(operationId), cleanupIntentRelativePath(operationId)];
    /* eslint-disable no-await-in-loop -- both fixed paths are policy-resolved independently */
    for (const relativePath of paths) {
      const resolved = await this.dependencies.workspacePolicy.resolveWrite(
        workspaceId,
        relativePath,
      );
      if (resolved.overwrites) return true;
    }
    /* eslint-enable no-await-in-loop */
    return false;
  }

  async discoverAndCleanupOrphans(input: {
    workspaceId: string;
    hasLinkedEvidence(operationId: string): Promise<boolean>;
  }): Promise<void> {
    const root = await this.dependencies.workspacePolicy
      .resolveRead(input.workspaceId, '.sfp/operation-evidence')
      .catch(() => null);
    if (root === null) return;
    /* eslint-disable no-await-in-loop -- each fixed orphan directory is verified before cleanup */
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[0-9a-f]{64}$/u.test(directory.name)) continue;
      const markerPath = join(root, directory.name, 'cleanup-intent.v1.json');
      let markerHandle: Awaited<ReturnType<typeof open>>;
      try {
        markerHandle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'orphan marker cannot be opened without following links',
        );
      }
      let marker: {
        schemaVersion: 1;
        workspaceId: string;
        operationId: string;
        artifact: ResultArtifactV1;
        contentHash: string;
      };
      let markerIdentity: Awaited<ReturnType<typeof markerHandle.stat>>;
      try {
        markerIdentity = await markerHandle.stat();
        if (
          !markerIdentity.isFile() ||
          markerIdentity.nlink !== 1 ||
          markerIdentity.size < 1 ||
          markerIdentity.size > 65_536
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'orphan marker is not one bounded unaliased regular file',
          );
        }
        const bytes = Buffer.alloc(markerIdentity.size);
        const observed = await markerHandle.read(bytes, 0, bytes.byteLength, 0);
        const pathnameIdentity = await lstat(markerPath);
        if (
          observed.bytesRead !== bytes.byteLength ||
          !pathnameIdentity.isFile() ||
          pathnameIdentity.isSymbolicLink() ||
          pathnameIdentity.nlink !== 1 ||
          !sameFile(markerIdentity, pathnameIdentity)
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'orphan marker changed during verification',
          );
        }
        marker = JSON.parse(bytes.toString('utf8')) as typeof marker;
      } catch (error) {
        await markerHandle.close();
        throw error;
      }
      const base = {
        schemaVersion: marker.schemaVersion,
        workspaceId: marker.workspaceId,
        operationId: marker.operationId,
        artifact: marker.artifact,
      };
      if (
        marker.schemaVersion !== 1 ||
        marker.workspaceId !== input.workspaceId ||
        marker.contentHash !== digest(Buffer.from(JSON.stringify(base), 'utf8')) ||
        captureRelativePath(marker.operationId) !== marker.artifact.artifactRelativePath ||
        dirname(marker.artifact.artifactRelativePath).split('/').at(-1) !== directory.name
      ) {
        await markerHandle.close();
        throw evidenceError('EVIDENCE_ARTIFACT_IDENTITY_MISMATCH', 'orphan marker is invalid');
      }
      const artifactPath = join(root, directory.name, 'result.v1.json');
      let artifactIdentity: Awaited<ReturnType<typeof lstat>> | null;
      try {
        artifactIdentity = await lstat(artifactPath).then(
          metadata => metadata,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          },
        );
      } catch (error) {
        await markerHandle.close();
        throw error;
      }
      if (
        artifactIdentity !== null &&
        (!artifactIdentity.isFile() ||
          artifactIdentity.isSymbolicLink() ||
          artifactIdentity.nlink !== 1)
      ) {
        await markerHandle.close();
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'orphan artifact pathname is not one unaliased regular file',
        );
      }
      if (artifactIdentity === null) {
        let removed = false;
        try {
          if (await input.hasLinkedEvidence(marker.operationId)) continue;
          await this.dependencies.beforeMarkerCleanupCommit?.(markerPath);
          const immediatelyBeforeRename = await lstat(markerPath).catch(() => null);
          if (
            immediatelyBeforeRename === null ||
            !immediatelyBeforeRename.isFile() ||
            immediatelyBeforeRename.isSymbolicLink() ||
            immediatelyBeforeRename.nlink !== 1 ||
            !sameFile(markerIdentity, immediatelyBeforeRename)
          ) {
            throw evidenceError(
              'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
              'orphan marker pathname changed before cleanup commit',
            );
          }
          const quarantine = join(
            dirname(markerPath),
            `.${basename(markerPath)}.${randomBytes(16).toString('hex')}.cleanup`,
          );
          await rename(markerPath, quarantine);
          const moved = await lstat(quarantine);
          if (
            !moved.isFile() ||
            moved.isSymbolicLink() ||
            moved.nlink !== 1 ||
            !sameFile(markerIdentity, moved)
          ) {
            await link(quarantine, markerPath)
              .then(() => unlink(quarantine))
              .catch(() => undefined);
            throw evidenceError(
              'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
              'replacement marker won the cleanup commit',
            );
          }
          await unlink(quarantine);
          removed = true;
        } finally {
          await markerHandle.close();
        }
        if (!removed) continue;
        const markerDirectory = await open(dirname(markerPath), 'r');
        try {
          await markerDirectory.sync().catch((error: NodeJS.ErrnoException) => {
            if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
          });
        } finally {
          await markerDirectory.close();
        }
        continue;
      }
      await markerHandle.close();
      await this.cleanupOrphan({
        workspaceId: input.workspaceId,
        operationId: marker.operationId,
        artifact: marker.artifact,
        hasLinkedEvidence: () => input.hasLinkedEvidence(marker.operationId),
      });
    }
    /* eslint-enable no-await-in-loop */
  }
}
