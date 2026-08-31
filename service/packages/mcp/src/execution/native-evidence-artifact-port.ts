import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  OPERATION_EVIDENCE_LIMITS,
  PortableRelativeArtifactPathSchema,
  type NativeArtifactManifestMemberV1,
  type NativeEvidenceArtifactPortContract,
  type NativeEvidenceV1,
  type PrefixedSha256,
  type WorkspacePolicy,
} from '@sfp/shared';

import { readFileWithinLimit, type AtomicFileStore } from '../fs/atomic-file.js';
import { nativeEvidenceContextHash } from './operation-evidence-projector.js';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('native artifact manifest is not canonical JSON');
  return encoded;
};
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const nativeError = (code: string, message: string) => Object.assign(new Error(message), { code });
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;

export class NativeEvidenceArtifactPort implements NativeEvidenceArtifactPortContract {
  constructor(
    private readonly dependencies: {
      workspacePolicy: WorkspacePolicy;
      atomicFiles: AtomicFileStore;
      maxTotalArtifactBytes?: number;
      readArtifact?: (path: string) => Promise<Uint8Array>;
      beforeCleanupCommit?: (path: string) => Promise<void>;
    },
  ) {}

  async createNativeManifest(
    input: Parameters<NativeEvidenceArtifactPortContract['createNativeManifest']>[0],
  ): Promise<Readonly<Extract<NativeEvidenceV1, { kind: 'export' }>>> {
    if (
      input.context.contextHash !== nativeEvidenceContextHash(input.context) ||
      input.projection.contextHash !== input.context.contextHash
    ) {
      throw nativeError(
        'NATIVE_EVIDENCE_CONTEXT_INVALID',
        'native context does not match projection',
      );
    }
    const unique = new Map<
      string,
      { resolved: string; metadata: Awaited<ReturnType<typeof lstat>> }
    >();
    let declaredTotalBytes = 0;
    /* eslint-disable no-await-in-loop -- every pathname is policy-resolved and statted before bodies */
    for (const candidate of input.projection.candidates) {
      const relativePath = candidate.candidateRelativePath;
      if (relativePath === null) continue;
      if (!PortableRelativeArtifactPathSchema.safeParse(relativePath).success) {
        throw nativeError('NATIVE_ARTIFACT_PATH_INVALID', 'native artifact path is invalid');
      }
      if (unique.has(relativePath)) continue;
      if (unique.size >= OPERATION_EVIDENCE_LIMITS.maxNativeArtifacts) {
        throw nativeError('NATIVE_ARTIFACT_LIMIT_EXCEEDED', 'native artifact member cap exceeded');
      }
      const resolved = await this.dependencies.workspacePolicy.resolveRead(
        input.context.workspaceId,
        relativePath,
      );
      const metadata = await lstat(resolved);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact is not a regular file');
      }
      declaredTotalBytes += metadata.size;
      if (
        !Number.isSafeInteger(declaredTotalBytes) ||
        declaredTotalBytes >
          (this.dependencies.maxTotalArtifactBytes ?? OPERATION_EVIDENCE_LIMITS.maxBytesPerActor)
      ) {
        throw Object.assign(
          nativeError('NATIVE_ARTIFACT_TOTAL_TOO_LARGE', 'native artifact byte cap exceeded'),
          { beforeRead: true },
        );
      }
      unique.set(relativePath, { resolved, metadata });
    }
    if (unique.size === 0) {
      throw nativeError('NATIVE_ARTIFACT_EMPTY', 'export projection has no materialized artifacts');
    }
    const artifacts: NativeArtifactManifestMemberV1[] = [];
    const maxTotal =
      this.dependencies.maxTotalArtifactBytes ?? OPERATION_EVIDENCE_LIMITS.maxBytesPerActor;
    for (const [relativePath, candidate] of unique) {
      const remaining = maxTotal - artifacts.reduce((sum, row) => sum + row.artifactBytes, 0);
      const bytes =
        this.dependencies.readArtifact === undefined
          ? await readFileWithinLimit(candidate.resolved, remaining)
          : Buffer.from(await this.dependencies.readArtifact(candidate.resolved));
      const after = await lstat(candidate.resolved);
      if (after.size > remaining || bytes.byteLength > remaining) {
        throw Object.assign(
          nativeError('NATIVE_ARTIFACT_TOTAL_TOO_LARGE', 'native artifact grew beyond its cap'),
          { beforeRead: true },
        );
      }
      if (
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.nlink !== 1 ||
        !sameFile(candidate.metadata, after) ||
        bytes.byteLength !== candidate.metadata.size
      ) {
        throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact changed during read');
      }
      artifacts.push({
        artifactRelativePath: relativePath,
        artifactDigest64: digest(bytes),
        artifactBytes: bytes.byteLength,
      });
    }
    /* eslint-enable no-await-in-loop */
    artifacts.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.artifactRelativePath),
        Buffer.from(right.artifactRelativePath),
      ),
    );
    const totalArtifactBytes = artifacts.reduce((sum, member) => sum + member.artifactBytes, 0);
    if (!Number.isSafeInteger(totalArtifactBytes)) {
      throw nativeError('NATIVE_ARTIFACT_LIMIT_EXCEEDED', 'native artifact byte sum is unsafe');
    }
    const withoutHash = {
      schemaVersion: 1 as const,
      operationId: input.context.operationId,
      artifacts,
      artifactCount: artifacts.length,
      totalArtifactBytes,
    };
    const contentHash: PrefixedSha256 = `sha256:${digest(Buffer.from(canonicalJson(withoutHash)))}`;
    const manifest = { ...withoutHash, contentHash };
    const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, 'utf8');
    if (manifestBytes.byteLength > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes) {
      throw nativeError('NATIVE_ARTIFACT_MANIFEST_TOO_LARGE', 'native manifest exceeds its cap');
    }
    const relativeManifestPath = `.sfp/operation-evidence/${input.context.contextHash.slice('sha256:'.length)}/native-manifest.v1.json`;
    const resolvedManifest = await this.dependencies.workspacePolicy.resolveWrite(
      input.context.workspaceId,
      relativeManifestPath,
    );
    if (resolvedManifest.overwrites) {
      throw nativeError('NATIVE_ARTIFACT_MANIFEST_EXISTS', 'native manifest target already exists');
    }
    await mkdir(dirname(resolvedManifest.path), { recursive: true });
    const revalidated = await this.dependencies.workspacePolicy.resolveWrite(
      input.context.workspaceId,
      relativeManifestPath,
    );
    if (revalidated.overwrites || revalidated.path !== resolvedManifest.path) {
      throw nativeError('NATIVE_ARTIFACT_PATH_CHANGED', 'native manifest path changed');
    }
    await this.dependencies.atomicFiles.createNew(resolvedManifest.path, manifestBytes);
    const reread = await readFileWithinLimit(
      resolvedManifest.path,
      OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
    );
    return Object.freeze({
      kind: 'export' as const,
      manifestRelativePath: relativeManifestPath,
      manifestDigest64: digest(reread),
      artifactCount: artifacts.length,
      totalArtifactBytes,
    });
  }

  async removeLinkedManifest(input: {
    context: import('@sfp/shared').VerifiedNativeEvidenceContextV1;
    evidence: Readonly<Extract<NativeEvidenceV1, { kind: 'export' }>>;
  }): Promise<void> {
    if (input.context.contextHash !== nativeEvidenceContextHash(input.context)) {
      throw nativeError('NATIVE_EVIDENCE_CONTEXT_INVALID', 'native cleanup context is invalid');
    }
    const expected = `.sfp/operation-evidence/${input.context.contextHash.slice('sha256:'.length)}/native-manifest.v1.json`;
    if (input.evidence.manifestRelativePath !== expected) {
      throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest path is not fixed');
    }
    const path = await this.dependencies.workspacePolicy.resolveRead(
      input.context.workspaceId,
      expected,
    );
    await this.dependencies.workspacePolicy.assertWithinRoot(input.context.workspaceId, expected);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest is not regular');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || !sameFile(metadata, opened)) {
        throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest changed');
      }
      const chunks: Buffer[] = [];
      let total = 0;
      /* eslint-disable no-await-in-loop -- one descriptor is read sequentially to its hard cap */
      for (;;) {
        const chunk = Buffer.allocUnsafe(
          Math.min(65_536, OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes - total + 1),
        );
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes) {
          throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest exceeds cap');
        }
        chunks.push(chunk.subarray(0, bytesRead));
      }
      /* eslint-enable no-await-in-loop */
      bytes = Buffer.concat(chunks, total);
      if (digest(bytes) !== input.evidence.manifestDigest64) {
        throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest digest changed');
      }
      await this.dependencies.beforeCleanupCommit?.(path);
      const beforeRename = await lstat(path);
      if (
        !beforeRename.isFile() ||
        beforeRename.isSymbolicLink() ||
        beforeRename.nlink !== 1 ||
        !sameFile(opened, beforeRename)
      ) {
        throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest changed');
      }
      const quarantine = join(
        dirname(path),
        `.${basename(path)}.${randomBytes(16).toString('hex')}.cleanup`,
      );
      await rename(path, quarantine);
      const moved = await lstat(quarantine);
      if (!moved.isFile() || moved.isSymbolicLink() || !sameFile(opened, moved)) {
        await link(quarantine, path).catch(() => undefined);
        throw nativeError(
          'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
          'native pathname replacement won cleanup',
        );
      }
      await unlink(quarantine);
    } finally {
      await handle.close();
    }
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync().catch((error: NodeJS.ErrnoException) => {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      });
    } finally {
      await directory.close();
    }
  }

  async discoverAndCleanupOrphans(input: {
    workspaceId: string;
    hasLinkedEvidence(operationId: string): Promise<boolean>;
  }): Promise<void> {
    const root = await this.dependencies.workspacePolicy
      .resolveRead(input.workspaceId, '.sfp/operation-evidence')
      .catch(() => null);
    if (root === null) return;
    /* eslint-disable no-await-in-loop -- each native manifest is self-verified before cleanup */
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[0-9a-f]{64}$/u.test(directory.name)) continue;
      const path = join(root, directory.name, 'native-manifest.v1.json');
      let bytes: Buffer;
      try {
        bytes = await readFileWithinLimit(
          path,
          OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const manifest = JSON.parse(bytes.toString('utf8')) as {
        schemaVersion: 1;
        operationId: string;
        artifacts: NativeArtifactManifestMemberV1[];
        artifactCount: number;
        totalArtifactBytes: number;
        contentHash: PrefixedSha256;
      };
      const { contentHash, ...withoutHash } = manifest;
      const contextBase = { operationId: manifest.operationId, workspaceId: input.workspaceId };
      if (
        manifest.schemaVersion !== 1 ||
        contentHash !== `sha256:${digest(Buffer.from(canonicalJson(withoutHash)))}` ||
        nativeEvidenceContextHash(contextBase).slice('sha256:'.length) !== directory.name
      ) {
        throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'orphan manifest is invalid');
      }
      if (await input.hasLinkedEvidence(manifest.operationId)) continue;
      await this.removeLinkedManifest({
        context: Object.freeze({
          ...contextBase,
          contextHash: nativeEvidenceContextHash(contextBase),
        }) as import('@sfp/shared').VerifiedNativeEvidenceContextV1,
        evidence: {
          kind: 'export',
          manifestRelativePath: `.sfp/operation-evidence/${directory.name}/native-manifest.v1.json`,
          manifestDigest64: digest(bytes),
          artifactCount: manifest.artifactCount,
          totalArtifactBytes: manifest.totalArtifactBytes,
        },
      });
    }
    /* eslint-enable no-await-in-loop */
  }

  async hasOperationSideEffect(workspaceId: string, operationId: string): Promise<boolean> {
    const contextBase = { operationId, workspaceId };
    const relativePath = `.sfp/operation-evidence/${nativeEvidenceContextHash(contextBase).slice('sha256:'.length)}/native-manifest.v1.json`;
    const resolved = await this.dependencies.workspacePolicy.resolveWrite(
      workspaceId,
      relativePath,
    );
    return resolved.overwrites;
  }
}
