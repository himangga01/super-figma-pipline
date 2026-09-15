import { createHash, randomBytes } from 'node:crypto';
import { constants, fstatSync, lstatSync, unlinkSync } from 'node:fs';
import { lstat, open, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import {
  OPERATION_EVIDENCE_LIMITS,
  PortableRelativeArtifactPathSchema,
  type AbortSignalLike,
  type NativeArtifactManifestMemberV1,
  type NativeArtifactManifestV1,
  type NativeEvidenceArtifactPortContract,
  type NativeEvidenceV1,
  type PrefixedSha256,
  type WorkspacePolicy,
} from '@sfp/shared';

import {
  readFileWithinLimit,
  type AtomicFileStore,
  type RetainedDirectoryAuthority,
  withRetainedDirectoryChain,
  withRetainedDirectoryDescendantChain,
  withRetainedDirectoryAuthority,
} from '../fs/atomic-file.js';
import {
  DEFAULT_EVIDENCE_RETENTION_LIMITS,
  assertProspectiveEvidenceRetention,
  type EvidenceRetentionAuthority,
  scanEvidenceRetentionAuthority,
  withEvidenceRetentionMutex,
} from '../fs/evidence-retention-authority.js';
import { materializeSnapshotEvidence } from '../snapshot/snapshot-operation-evidence.js';
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
const throwIfNativeAborted = (signal: AbortSignalLike | undefined, bytesRead = 0): void => {
  if (signal?.aborted !== true) return;
  throw Object.assign(new Error('native evidence materialization was aborted'), {
    name: 'AbortError',
    code: 'ABORT_ERR',
    bytesRead,
  });
};
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;
const workspacePolicyPath = (portablePath: string): string =>
  process.platform === 'win32' ? portablePath.replaceAll('/', sep) : portablePath;

export type NativeOrphanDiscoveryState = Readonly<{
  status: 'ready' | 'manual-cleanup';
  errorCode?: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' | 'NATIVE_RETAINED_CAPACITY_EXCEEDED';
  scannedEntries: number;
  retainedRows: number;
  retainedBytes: number;
}>;

const exactKeys = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());

export const validateNativeArtifactManifestBytes = (
  bytes: Buffer,
  expected?: {
    operationId: string;
    artifactCount: number;
    totalArtifactBytes: number;
  },
): NativeArtifactManifestV1 => {
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw nativeError('NATIVE_ARTIFACT_MANIFEST_INVALID', 'native manifest JSON is invalid');
  }
  if (
    typeof untrusted !== 'object' ||
    untrusted === null ||
    Array.isArray(untrusted) ||
    !exactKeys(untrusted, [
      'schemaVersion',
      'operationId',
      'artifacts',
      'artifactCount',
      'totalArtifactBytes',
      'contentHash',
    ])
  ) {
    throw nativeError('NATIVE_ARTIFACT_MANIFEST_INVALID', 'native manifest shape is invalid');
  }
  const manifest = untrusted as NativeArtifactManifestV1;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.operationId !== 'string' ||
    manifest.operationId.length < 1 ||
    manifest.operationId.length > 384 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 1 ||
    manifest.artifacts.length > OPERATION_EVIDENCE_LIMITS.maxNativeArtifacts ||
    manifest.artifactCount !== manifest.artifacts.length ||
    !Number.isSafeInteger(manifest.totalArtifactBytes) ||
    manifest.totalArtifactBytes < 0 ||
    typeof manifest.contentHash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(manifest.contentHash)
  ) {
    throw nativeError('NATIVE_ARTIFACT_MANIFEST_INVALID', 'native manifest fields are invalid');
  }
  let total = 0;
  let previous: string | null = null;
  const seen = new Set<string>();
  for (const member of manifest.artifacts) {
    if (
      typeof member !== 'object' ||
      member === null ||
      Array.isArray(member) ||
      !exactKeys(member, ['artifactRelativePath', 'artifactDigest64', 'artifactBytes']) ||
      !PortableRelativeArtifactPathSchema.safeParse(member.artifactRelativePath).success ||
      !/^[0-9a-f]{64}$/u.test(member.artifactDigest64) ||
      !Number.isSafeInteger(member.artifactBytes) ||
      member.artifactBytes < 0 ||
      seen.has(member.artifactRelativePath) ||
      (previous !== null &&
        Buffer.compare(Buffer.from(previous), Buffer.from(member.artifactRelativePath)) >= 0)
    ) {
      throw nativeError('NATIVE_ARTIFACT_MANIFEST_INVALID', 'native manifest member is invalid');
    }
    seen.add(member.artifactRelativePath);
    previous = member.artifactRelativePath;
    total += member.artifactBytes;
    if (!Number.isSafeInteger(total)) {
      throw nativeError('NATIVE_ARTIFACT_MANIFEST_INVALID', 'native manifest byte sum is unsafe');
    }
  }
  const { contentHash, ...withoutHash } = manifest;
  if (
    total !== manifest.totalArtifactBytes ||
    contentHash !== `sha256:${digest(Buffer.from(canonicalJson(withoutHash)))}` ||
    !bytes.equals(Buffer.from(`${canonicalJson(manifest)}\n`, 'utf8')) ||
    (expected !== undefined &&
      (manifest.operationId !== expected.operationId ||
        manifest.artifactCount !== expected.artifactCount ||
        manifest.totalArtifactBytes !== expected.totalArtifactBytes))
  ) {
    throw nativeError(
      'NATIVE_ARTIFACT_MANIFEST_INVALID',
      'native manifest content authority is invalid',
    );
  }
  return manifest;
};

export const serializeNativeArtifactManifestV1 = (
  input: Omit<NativeArtifactManifestV1, 'contentHash'>,
): Readonly<{ manifest: NativeArtifactManifestV1; bytes: Buffer }> => {
  const contentHash: PrefixedSha256 = `sha256:${digest(Buffer.from(canonicalJson(input)))}`;
  const manifest: NativeArtifactManifestV1 = Object.freeze({ ...input, contentHash });
  return Object.freeze({
    manifest,
    bytes: Buffer.from(`${canonicalJson(manifest)}\n`, 'utf8'),
  });
};

export class NativeEvidenceArtifactPort implements NativeEvidenceArtifactPortContract {
  async materializeServiceArtifact(
    input: Parameters<
      NonNullable<NativeEvidenceArtifactPortContract['materializeServiceArtifact']>
    >[0],
  ) {
    if (nativeEvidenceContextHash(input.context) !== input.projection.contextHash)
      throw nativeError('NATIVE_EVIDENCE_CONTEXT_MISMATCH', 'service evidence context changed');
    return materializeSnapshotEvidence(this.dependencies.workspacePolicy, input);
  }
  constructor(
    private readonly dependencies: {
      workspacePolicy: WorkspacePolicy;
      atomicFiles: AtomicFileStore;
      maxTotalArtifactBytes?: number;
      readArtifact?: (path: string) => Promise<Uint8Array>;
      beforeCleanupCommit?: (path: string) => Promise<void>;
      afterMembersReread?: () => Promise<void>;
      beforeMemberOpen?: (path: string) => Promise<void>;
      afterMemberOpen?: (path: string) => Promise<void>;
      beforeManifestBodyRead?: (path: string) => Promise<void>;
      afterNativeQuarantineFsync?: () => Promise<void>;
      beforeManifestReread?: (path: string) => Promise<void>;
      afterMemberChunk?: (bytesRead: number) => Promise<void>;
      retainedLimits?: { maxRows: number; maxBytes: number; maxScanEntries: number };
      beforeEvidenceMutexAcquire?: () => Promise<void>;
      afterEvidenceMutexAcquire?: () => Promise<void>;
    },
  ) {}

  private retainedLimits(): { maxRows: number; maxBytes: number; maxScanEntries: number } {
    return this.dependencies.retainedLimits ?? DEFAULT_EVIDENCE_RETENTION_LIMITS;
  }

  private async registeredRoot(
    workspaceId: string,
    resolvedPath: string,
    portableRelativePath: string,
  ): Promise<string> {
    const configured = await this.dependencies.workspacePolicy.resolveRoot?.(workspaceId);
    if (configured !== undefined) return configured;
    let root = resolvedPath;
    for (let index = 0; index < portableRelativePath.split('/').length; index += 1) {
      root = dirname(root);
    }
    return root;
  }

  private async readMember(
    candidate: {
      resolved: string;
      metadata: Awaited<ReturnType<typeof lstat>>;
      registeredRoot: string;
    },
    remaining: number,
    signal?: AbortSignalLike,
  ): Promise<Readonly<{ artifactBytes: number; artifactDigest64: string }>> {
    throwIfNativeAborted(signal);
    try {
      const parent = dirname(candidate.resolved);
      return await withRetainedDirectoryChain(
        candidate.registeredRoot,
        parent,
        async authority => {
          const memberPath = authority.child(basename(candidate.resolved));
          throwIfNativeAborted(signal);
          await this.dependencies.beforeMemberOpen?.(candidate.resolved);
          if (this.dependencies.readArtifact !== undefined) {
            await this.dependencies.afterMemberOpen?.(candidate.resolved);
            throwIfNativeAborted(signal);
            const before = await lstat(memberPath);
            if (!sameFile(candidate.metadata, before)) {
              throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact changed before read');
            }
            const injected = Buffer.from(await this.dependencies.readArtifact(memberPath));
            if (injected.byteLength > remaining) {
              throw Object.assign(
                nativeError('NATIVE_ARTIFACT_TOTAL_TOO_LARGE', 'native artifact exceeds its cap'),
                { beforeRead: true },
              );
            }
            throwIfNativeAborted(signal, injected.byteLength);
            return Object.freeze({
              artifactBytes: injected.byteLength,
              artifactDigest64: digest(injected),
            });
          }
          const handle = await open(memberPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            await this.dependencies.afterMemberOpen?.(candidate.resolved);
            const opened = await handle.stat();
            if (
              !opened.isFile() ||
              opened.nlink !== 1 ||
              !sameFile(candidate.metadata, opened) ||
              opened.size > remaining
            ) {
              throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact changed before read');
            }
            const memberDigest = createHash('sha256');
            let total = 0;
            /* eslint-disable no-await-in-loop -- descriptor reads are sequential and hard bounded */
            for (;;) {
              throwIfNativeAborted(signal, total);
              const chunk = Buffer.allocUnsafe(Math.min(65_536, remaining - total + 1));
              const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
              if (bytesRead === 0) break;
              total += bytesRead;
              if (total > remaining) {
                throw Object.assign(
                  nativeError(
                    'NATIVE_ARTIFACT_TOTAL_TOO_LARGE',
                    'native artifact grew beyond its cap',
                  ),
                  { beforeRead: false },
                );
              }
              memberDigest.update(chunk.subarray(0, bytesRead));
              await this.dependencies.afterMemberChunk?.(total);
              throwIfNativeAborted(signal, total);
              const during = await handle.stat();
              if (!sameFile(opened, during) || during.size > remaining) {
                throw Object.assign(
                  nativeError(
                    'NATIVE_ARTIFACT_TOTAL_TOO_LARGE',
                    'native artifact grew beyond its cap',
                  ),
                  { beforeRead: false },
                );
              }
            }
            /* eslint-enable no-await-in-loop */
            const [heldAfterRead, pathnameAfterRead] = await Promise.all([
              handle.stat(),
              lstat(memberPath).catch(() => null),
            ]);
            if (
              pathnameAfterRead === null ||
              !heldAfterRead.isFile() ||
              !pathnameAfterRead.isFile() ||
              pathnameAfterRead.isSymbolicLink() ||
              heldAfterRead.nlink !== 1 ||
              pathnameAfterRead.nlink !== 1 ||
              !sameFile(opened, heldAfterRead) ||
              !sameFile(opened, pathnameAfterRead) ||
              heldAfterRead.size !== total
            ) {
              throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact changed during read');
            }
            await authority.verify();
            throwIfNativeAborted(signal, total);
            return Object.freeze({
              artifactBytes: total,
              artifactDigest64: memberDigest.digest('hex'),
            });
          } finally {
            await handle.close();
          }
        },
        { errorCode: 'NATIVE_ARTIFACT_INVALID' },
      );
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;
      if (
        code === 'ABORT_ERR' ||
        code === 'NATIVE_ARTIFACT_TOTAL_TOO_LARGE' ||
        code === 'NATIVE_ARTIFACT_INVALID'
      ) {
        throw cause;
      }
      throw nativeError('NATIVE_ARTIFACT_INVALID', 'native artifact parent authority changed');
    }
  }

  async createNativeManifest(
    input: Parameters<NativeEvidenceArtifactPortContract['createNativeManifest']>[0],
  ): Promise<Readonly<Extract<NativeEvidenceV1, { kind: 'export' }>>> {
    throwIfNativeAborted(input.signal);
    if (
      input.context.contextHash !== nativeEvidenceContextHash(input.context) ||
      input.projection.contextHash !== input.context.contextHash
    ) {
      throw nativeError('EVIDENCE_CONTEXT_MISMATCH', 'native context does not match projection');
    }
    const unique = new Map<
      string,
      {
        resolved: string;
        metadata: Awaited<ReturnType<typeof lstat>>;
        registeredRoot: string;
      }
    >();
    let declaredTotalBytes = 0;
    /* eslint-disable no-await-in-loop -- every pathname is policy-resolved and statted before bodies */
    for (const candidate of input.projection.candidates) {
      throwIfNativeAborted(input.signal);
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
        workspacePolicyPath(relativePath),
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
      unique.set(relativePath, {
        resolved,
        metadata,
        registeredRoot: await this.registeredRoot(
          input.context.workspaceId,
          resolved,
          relativePath,
        ),
      });
    }
    if (unique.size === 0) {
      throw nativeError('NATIVE_ARTIFACT_EMPTY', 'export projection has no materialized artifacts');
    }
    const artifacts: NativeArtifactManifestMemberV1[] = [];
    const maxTotal =
      this.dependencies.maxTotalArtifactBytes ?? OPERATION_EVIDENCE_LIMITS.maxBytesPerActor;
    let materializedBytes = 0;
    for (const [relativePath, candidate] of unique) {
      const remaining = maxTotal - materializedBytes;
      const materialized = await this.readMember(candidate, remaining, input.signal);
      materializedBytes += materialized.artifactBytes;
      artifacts.push({
        artifactRelativePath: relativePath,
        artifactDigest64: materialized.artifactDigest64,
        artifactBytes: materialized.artifactBytes,
      });
    }
    /* eslint-enable no-await-in-loop */
    await this.dependencies.afterMembersReread?.();
    throwIfNativeAborted(
      input.signal,
      artifacts.reduce((sum, row) => sum + row.artifactBytes, 0),
    );
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
    const { bytes: manifestBytes } = serializeNativeArtifactManifestV1(withoutHash);
    if (manifestBytes.byteLength > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes) {
      throw nativeError(
        'NATIVE_ARTIFACT_MANIFEST_SIZE_LIMIT_EXCEEDED',
        'native manifest exceeds its cap',
      );
    }
    const relativeManifestPath = `.sfp/operation-evidence/${input.context.contextHash.slice('sha256:'.length)}/native-manifest.v1.json`;
    const admittedManifest = await this.dependencies.workspacePolicy.resolveWrite(
      input.context.workspaceId,
      workspacePolicyPath(relativeManifestPath),
    );
    if (admittedManifest.overwrites) {
      throw nativeError('NATIVE_ARTIFACT_MANIFEST_EXISTS', 'native manifest target already exists');
    }
    const admittedParent = dirname(admittedManifest.path);
    const evidenceRoot = /^[0-9a-f]{64}$/u.test(basename(admittedParent))
      ? dirname(admittedParent)
      : admittedParent;
    const registeredRoot = await this.registeredRoot(
      input.context.workspaceId,
      admittedManifest.path,
      relativeManifestPath,
    );
    return withEvidenceRetentionMutex(
      registeredRoot,
      evidenceRoot,
      async evidenceRootAuthority => {
        await this.dependencies.afterEvidenceMutexAcquire?.();
        throwIfNativeAborted(input.signal, totalArtifactBytes);
        return withRetainedDirectoryDescendantChain(
          evidenceRoot,
          evidenceRootAuthority,
          admittedParent,
          async authority => {
            const manifestPath = authority.child(basename(admittedManifest.path));
            await this.dependencies.atomicFiles.createNew(manifestPath, manifestBytes);
            throwIfNativeAborted(input.signal, totalArtifactBytes);
            const publishedIdentity = await lstat(manifestPath);
            let reread: Buffer;
            try {
              await this.dependencies.beforeManifestReread?.(admittedManifest.path);
              throwIfNativeAborted(input.signal, totalArtifactBytes);
              const finalManifest = await this.dependencies.workspacePolicy.resolveWrite(
                input.context.workspaceId,
                workspacePolicyPath(relativeManifestPath),
              );
              if (finalManifest.path !== admittedManifest.path) {
                throw nativeError('NATIVE_ARTIFACT_PATH_CHANGED', 'native manifest path changed');
              }
              reread = await readFileWithinLimit(
                manifestPath,
                OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
                undefined,
                { expectedIdentity: publishedIdentity },
              );
            } catch (cause) {
              if ((cause as { code?: unknown }).code === 'NATIVE_ARTIFACT_PATH_CHANGED')
                throw cause;
              throw nativeError(
                'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                `native manifest publication reread lost authority: ${String((cause as Error).message)}`,
              );
            }
            validateNativeArtifactManifestBytes(reread, {
              operationId: input.context.operationId,
              artifactCount: artifacts.length,
              totalArtifactBytes,
            });
            throwIfNativeAborted(input.signal, totalArtifactBytes);
            return Object.freeze({
              kind: 'export' as const,
              manifestRelativePath: relativeManifestPath,
              manifestDigest64: digest(reread),
              artifactCount: artifacts.length,
              totalArtifactBytes,
            });
          },
          { createMissing: true, errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' },
        );
      },
      {
        createMissing: true,
        errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
        beforeMutexAcquire: () =>
          this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
      },
    );
  }

  async removeLinkedManifest(
    input: {
      context: import('@sfp/shared').VerifiedNativeEvidenceContextV1;
      evidence: Readonly<Extract<NativeEvidenceV1, { kind: 'export' }>>;
    },
    retainedContext?: {
      evidenceRootAuthority: RetainedDirectoryAuthority;
      retentionAuthority: Readonly<EvidenceRetentionAuthority>;
    },
  ): Promise<void> {
    if (input.context.contextHash !== nativeEvidenceContextHash(input.context)) {
      throw nativeError('NATIVE_EVIDENCE_CONTEXT_INVALID', 'native cleanup context is invalid');
    }
    const expected = `.sfp/operation-evidence/${input.context.contextHash.slice('sha256:'.length)}/native-manifest.v1.json`;
    if (input.evidence.manifestRelativePath !== expected) {
      throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest path is not fixed');
    }
    const operationRelativePath = expected.split('/').slice(0, -1).join('/');
    let parent: string;
    try {
      parent = await this.dependencies.workspacePolicy.resolveRead(
        input.context.workspaceId,
        workspacePolicyPath(operationRelativePath),
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === 'WORKSPACE_PATH_NOT_FOUND') return;
      throw error;
    }
    await this.dependencies.workspacePolicy.assertWithinRoot(
      input.context.workspaceId,
      workspacePolicyPath(operationRelativePath),
    );
    const path = join(parent, 'native-manifest.v1.json');
    const evidenceRoot = await this.dependencies.workspacePolicy.resolveRead(
      input.context.workspaceId,
      workspacePolicyPath('.sfp/operation-evidence'),
    );
    const cleanup = (context: {
      evidenceRootAuthority: RetainedDirectoryAuthority;
      retentionAuthority: Readonly<EvidenceRetentionAuthority>;
    }) =>
      withRetainedDirectoryDescendantChain(
        evidenceRoot,
        context.evidenceRootAuthority,
        parent,
        async authority => {
          const fixedPath = authority.child(basename(path));
          const syncParent = async (): Promise<void> => {
            const directory = await open(authority.path, 'r');
            try {
              await directory.sync().catch((error: NodeJS.ErrnoException) => {
                if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
              });
            } finally {
              await directory.close();
            }
          };
          const retainedPrefix = `.${basename(path)}.${input.evidence.manifestDigest64}.`;
          const retainedCandidate = async (): Promise<string | null> => {
            let match: string | null = null;
            const inventory =
              resolve(parent) === resolve(evidenceRoot)
                ? context.retentionAuthority.rootEntries
                : (context.retentionAuthority.operationDirectoryEntries.get(basename(parent)) ??
                  []);
            for (const entry of inventory) {
              if (
                !entry.name.startsWith(retainedPrefix) ||
                !/^\..+\.[0-9a-f]{64}\.[0-9a-f]{32}\.retained$/u.test(entry.name)
              ) {
                continue;
              }
              if (match !== null || !entry.isFile()) {
                throw nativeError(
                  'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                  'native cleanup has multiple retained generations',
                );
              }
              match = entry.name;
            }
            return match === null ? null : authority.child(match);
          };
          const metadata = await lstat(fixedPath).catch((cause: NodeJS.ErrnoException) => {
            if (cause.code === 'ENOENT') return null;
            throw cause;
          });
          if (metadata === null) {
            const retained = await retainedCandidate();
            if (retained === null) return;
            const retainedBytes = await readFileWithinLimit(
              retained,
              OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
            );
            if (digest(retainedBytes) !== input.evidence.manifestDigest64) {
              throw nativeError(
                'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                'retained native manifest digest changed',
              );
            }
            validateNativeArtifactManifestBytes(retainedBytes, {
              operationId: input.context.operationId,
              artifactCount: input.evidence.artifactCount,
              totalArtifactBytes: input.evidence.totalArtifactBytes,
            });
            const retainedMetadata = await lstat(retained);
            const retainedHandle = await open(retained, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              const held = await retainedHandle.stat();
              if (!sameFile(retainedMetadata, held)) {
                throw nativeError(
                  'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                  'retained native manifest identity changed',
                );
              }
              await authority.verify();
              const pathname = lstatSync(retained);
              const descriptor = fstatSync(retainedHandle.fd);
              if (!sameFile(held, pathname) || !sameFile(held, descriptor)) {
                throw nativeError(
                  'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                  'retained native manifest changed before deletion',
                );
              }
              unlinkSync(retained);
              await syncParent();
            } finally {
              await retainedHandle.close();
            }
            return;
          }
          try {
            await assertProspectiveEvidenceRetention({
              evidenceRoot,
              operationDirectoryName: basename(parent),
              nextBytes: metadata.size,
              limits: this.retainedLimits(),
              rootAuthority: context.evidenceRootAuthority,
              authority: context.retentionAuthority,
            });
          } catch (error) {
            throw nativeError(
              (error as { code?: unknown }).code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
                ? 'NATIVE_RETAINED_CAPACITY_EXCEEDED'
                : 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
              'unified evidence retention authority rejected native cleanup',
            );
          }
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
            throw nativeError(
              'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
              'native manifest is not regular',
            );
          }
          if (metadata.size > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes) {
            throw Object.assign(
              nativeError(
                'NATIVE_ARTIFACT_MANIFEST_SIZE_LIMIT_EXCEEDED',
                'native manifest exceeds its cap',
              ),
              { beforeRead: true, bytesRead: 0 },
            );
          }
          await this.dependencies.beforeManifestBodyRead?.(path);
          const handle = await open(fixedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
                Math.min(
                  65_536,
                  OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes - total + 1,
                ),
              );
              const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
              if (bytesRead === 0) break;
              total += bytesRead;
              if (total > OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes) {
                throw nativeError(
                  'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                  'native manifest exceeds cap',
                );
              }
              chunks.push(chunk.subarray(0, bytesRead));
            }
            /* eslint-enable no-await-in-loop */
            bytes = Buffer.concat(chunks, total);
            if (digest(bytes) !== input.evidence.manifestDigest64) {
              throw nativeError(
                'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                'native manifest digest changed',
              );
            }
            validateNativeArtifactManifestBytes(bytes, {
              operationId: input.context.operationId,
              artifactCount: input.evidence.artifactCount,
              totalArtifactBytes: input.evidence.totalArtifactBytes,
            });
            await this.dependencies.beforeCleanupCommit?.(path);
            const beforeRename = await lstat(fixedPath);
            if (
              !beforeRename.isFile() ||
              beforeRename.isSymbolicLink() ||
              beforeRename.nlink !== 1 ||
              !sameFile(opened, beforeRename)
            ) {
              throw nativeError('NATIVE_ARTIFACT_IDENTITY_MISMATCH', 'native manifest changed');
            }
            const quarantine = join(
              authority.path,
              `${retainedPrefix}${randomBytes(16).toString('hex')}.retained`,
            );
            await rename(fixedPath, quarantine);
            const moved = await lstat(quarantine);
            if (!moved.isFile() || moved.isSymbolicLink() || !sameFile(opened, moved)) {
              throw nativeError(
                'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                'native pathname replacement won cleanup',
              );
            }
            await syncParent();
            await this.dependencies.afterNativeQuarantineFsync?.();
            await authority.verify();
            const pathname = lstatSync(quarantine);
            const descriptor = fstatSync(handle.fd);
            if (!sameFile(opened, pathname) || !sameFile(opened, descriptor)) {
              throw nativeError(
                'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
                'native quarantine changed before deletion',
              );
            }
            unlinkSync(quarantine);
            await syncParent();
          } finally {
            await handle.close();
          }
        },
        { errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' },
      );
    if (retainedContext !== undefined) return cleanup(retainedContext);
    const registeredRoot =
      (await this.dependencies.workspacePolicy.resolveRoot?.(input.context.workspaceId)) ??
      evidenceRoot;
    return withEvidenceRetentionMutex(
      registeredRoot,
      evidenceRoot,
      async evidenceRootAuthority => {
        await this.dependencies.afterEvidenceMutexAcquire?.();
        let retentionAuthority: Readonly<EvidenceRetentionAuthority>;
        try {
          retentionAuthority = await scanEvidenceRetentionAuthority(
            evidenceRoot,
            this.retainedLimits(),
            { rootAuthority: evidenceRootAuthority },
          );
        } catch (error) {
          throw nativeError(
            (error as { code?: unknown }).code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
              ? 'NATIVE_RETAINED_CAPACITY_EXCEEDED'
              : 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
            'unified evidence retention authority rejected native cleanup',
          );
        }
        return cleanup({ evidenceRootAuthority, retentionAuthority });
      },
      {
        errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
        beforeMutexAcquire: () =>
          this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
      },
    );
  }

  async discoverAndCleanupOrphans(input: {
    workspaceId: string;
    hasLinkedEvidence(operationId: string): Promise<boolean>;
  }): Promise<NativeOrphanDiscoveryState> {
    const limits = this.retainedLimits();
    const state = {
      scannedEntries: 0,
      retainedRows: 0,
      retainedBytes: 0,
    };
    const manual = (
      errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' | 'NATIVE_RETAINED_CAPACITY_EXCEEDED',
    ): NativeOrphanDiscoveryState =>
      Object.freeze({ status: 'manual-cleanup' as const, errorCode, ...state });
    let root: string;
    try {
      root = await this.dependencies.workspacePolicy.resolveRead(
        input.workspaceId,
        workspacePolicyPath('.sfp/operation-evidence'),
      );
      await this.dependencies.workspacePolicy.assertWithinRoot(
        input.workspaceId,
        workspacePolicyPath('.sfp/operation-evidence'),
      );
    } catch (cause) {
      if (
        ['ENOENT', 'WORKSPACE_PATH_NOT_FOUND'].includes(String((cause as { code?: unknown }).code))
      ) {
        return Object.freeze({ status: 'ready' as const, ...state });
      }
      return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
    }
    try {
      const registeredRoot =
        (await this.dependencies.workspacePolicy.resolveRoot?.(input.workspaceId)) ?? root;
      return await withEvidenceRetentionMutex(
        registeredRoot,
        root,
        async rootAuthority => {
          await this.dependencies.afterEvidenceMutexAcquire?.();
          let operationNames: readonly string[] = [];
          let retentionAuthority: Readonly<EvidenceRetentionAuthority>;
          try {
            const authority = await scanEvidenceRetentionAuthority(root, limits, {
              rootAuthority,
              metrics: state,
            });
            retentionAuthority = authority;
            state.scannedEntries = authority.scannedEntries;
            state.retainedRows = authority.retainedRows;
            state.retainedBytes = authority.retainedBytes;
            if (authority.operationDirectories.size === 0) {
              return Object.freeze({ status: 'ready' as const, ...state });
            }
            operationNames = [...authority.operationDirectories].toSorted();
          } catch (error) {
            const observed = error as Partial<typeof state> & { code?: unknown };
            if (Number.isSafeInteger(observed.scannedEntries)) {
              state.scannedEntries = observed.scannedEntries as number;
            }
            if (Number.isSafeInteger(observed.retainedRows)) {
              state.retainedRows = observed.retainedRows as number;
            }
            if (Number.isSafeInteger(observed.retainedBytes)) {
              state.retainedBytes = observed.retainedBytes as number;
            }
            return manual(
              observed.code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
                ? 'NATIVE_RETAINED_CAPACITY_EXCEEDED'
                : 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
            );
          }
          /* eslint-disable no-await-in-loop -- each native manifest is self-verified before cleanup */
          for (const directoryName of operationNames) {
            const operationDirectory = rootAuthority.child(directoryName);
            const operationIdentity = await lstat(operationDirectory).catch(() => null);
            if (
              operationIdentity === null ||
              !operationIdentity.isDirectory() ||
              operationIdentity.isSymbolicLink()
            ) {
              return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
            }
            const outcome = await withRetainedDirectoryAuthority(
              operationDirectory,
              operationIdentity,
              async operationAuthority => {
                const children =
                  retentionAuthority.operationDirectoryEntries.get(directoryName) ?? [];
                let fixedPath: string | null = null;
                let fixedBytes: Buffer | null = null;
                let retainedFound = false;
                let retainedManifestForCleanup: NativeArtifactManifestV1 | null = null;
                let retainedDigest64: string | null = null;
                for (const child of children) {
                  const childPath = operationAuthority.child(child.name);
                  if (child.name === 'native-manifest.v1.json') {
                    if (!child.isFile()) return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                    fixedPath = childPath;
                    try {
                      fixedBytes = await readFileWithinLimit(
                        childPath,
                        OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
                      );
                    } catch {
                      return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                    }
                    continue;
                  }
                  const retained =
                    /^\.native-manifest\.v1\.json\.([0-9a-f]{64})\.[0-9a-f]{32}\.retained$/u.exec(
                      child.name,
                    );
                  if (retained === null) continue;
                  if (retainedFound || !child.isFile()) {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  let retainedBytes: Buffer;
                  try {
                    retainedBytes = await readFileWithinLimit(
                      childPath,
                      OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes,
                    );
                  } catch {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  let retainedManifest: NativeArtifactManifestV1;
                  try {
                    retainedManifest = validateNativeArtifactManifestBytes(retainedBytes);
                  } catch {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  const retainedContext = {
                    operationId: retainedManifest.operationId,
                    workspaceId: input.workspaceId,
                  };
                  if (
                    digest(retainedBytes) !== retained[1] ||
                    nativeEvidenceContextHash(retainedContext).slice('sha256:'.length) !==
                      directoryName
                  ) {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  retainedFound = true;
                  retainedManifestForCleanup = retainedManifest;
                  retainedDigest64 = digest(retainedBytes);
                }
                if (retainedFound) {
                  if (fixedPath !== null) return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  if (retainedManifestForCleanup === null || retainedDigest64 === null) {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  if (await input.hasLinkedEvidence(retainedManifestForCleanup.operationId))
                    return null;
                  const retainedContextBase = {
                    operationId: retainedManifestForCleanup.operationId,
                    workspaceId: input.workspaceId,
                  };
                  try {
                    await this.removeLinkedManifest(
                      {
                        context: Object.freeze({
                          ...retainedContextBase,
                          contextHash: nativeEvidenceContextHash(retainedContextBase),
                        }) as import('@sfp/shared').VerifiedNativeEvidenceContextV1,
                        evidence: {
                          kind: 'export',
                          manifestRelativePath: `.sfp/operation-evidence/${directoryName}/native-manifest.v1.json`,
                          manifestDigest64: retainedDigest64,
                          artifactCount: retainedManifestForCleanup.artifactCount,
                          totalArtifactBytes: retainedManifestForCleanup.totalArtifactBytes,
                        },
                      },
                      { evidenceRootAuthority: rootAuthority, retentionAuthority },
                    );
                  } catch {
                    return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                  }
                  return null;
                }
                if (fixedPath === null || fixedBytes === null) return null;
                const bytes = fixedBytes;
                let manifest: NativeArtifactManifestV1;
                try {
                  manifest = validateNativeArtifactManifestBytes(bytes);
                } catch {
                  return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                }
                const contextBase = {
                  operationId: manifest.operationId,
                  workspaceId: input.workspaceId,
                };
                if (
                  nativeEvidenceContextHash(contextBase).slice('sha256:'.length) !== directoryName
                ) {
                  return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                }
                if (await input.hasLinkedEvidence(manifest.operationId)) return null;
                if (
                  state.retainedRows >= limits.maxRows ||
                  state.retainedBytes > limits.maxBytes - bytes.byteLength
                ) {
                  return manual('NATIVE_RETAINED_CAPACITY_EXCEEDED');
                }
                try {
                  await this.removeLinkedManifest(
                    {
                      context: Object.freeze({
                        ...contextBase,
                        contextHash: nativeEvidenceContextHash(contextBase),
                      }) as import('@sfp/shared').VerifiedNativeEvidenceContextV1,
                      evidence: {
                        kind: 'export',
                        manifestRelativePath: `.sfp/operation-evidence/${directoryName}/native-manifest.v1.json`,
                        manifestDigest64: digest(bytes),
                        artifactCount: manifest.artifactCount,
                        totalArtifactBytes: manifest.totalArtifactBytes,
                      },
                    },
                    { evidenceRootAuthority: rootAuthority, retentionAuthority },
                  );
                } catch {
                  return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
                }
                return null;
              },
              { errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH' },
            );
            if (outcome !== null) return outcome;
          }
          /* eslint-enable no-await-in-loop */
          await rootAuthority.verify();
          return Object.freeze({ status: 'ready' as const, ...state });
        },
        {
          errorCode: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
          beforeMutexAcquire: () =>
            this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
        },
      );
    } catch {
      return manual('NATIVE_ARTIFACT_IDENTITY_MISMATCH');
    }
  }

  async hasOperationSideEffect(workspaceId: string, operationId: string): Promise<boolean> {
    const contextBase = { operationId, workspaceId };
    const relativePath = `.sfp/operation-evidence/${nativeEvidenceContextHash(contextBase).slice('sha256:'.length)}/native-manifest.v1.json`;
    const resolved = await this.dependencies.workspacePolicy.resolveWrite(
      workspaceId,
      workspacePolicyPath(relativePath),
    );
    return resolved.overwrites;
  }
}
