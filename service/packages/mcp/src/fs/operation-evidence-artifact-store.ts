import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  type Dirent,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  readSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { lstat, open, opendir, rename } from 'node:fs/promises';
import { basename, dirname, join, normalize, sep } from 'node:path';

import {
  PortableRelativeArtifactPathSchema,
  type NativeEvidenceProjectionV1,
  type OperationEvidenceProjector,
  type OperationEvidenceArtifactPort,
  type PrefixedSha256,
  type ResultArtifactV1,
  type VerifiedCaptureIntentV1,
  type WorkspacePolicy,
} from '@sfp/shared';

import {
  acquireWindowsDirectoryLease,
  readFileWithinLimit,
  type AtomicFileStore,
  type RetainedDirectoryAuthority,
  withRetainedDirectoryDescendantChain,
} from './atomic-file.js';
import {
  DEFAULT_EVIDENCE_RETENTION_LIMITS,
  assertProspectiveEvidenceRetention,
  type EvidenceRetentionAuthority,
  scanEvidenceRetentionAuthority,
  withEvidenceRetentionMutex,
} from './evidence-retention-authority.js';

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
const workspacePolicyPath = (portablePath: string): string =>
  process.platform === 'win32' ? portablePath.replaceAll('/', sep) : portablePath;
const RETAINED_MARKER_QUARANTINE =
  /^\.cleanup-intent\.v1\.json\.([0-9a-f]{64})\.([0-9a-f]{32})\.retained$/u;
const ARTIFACT_CLEANUP_QUARANTINE = /^\.result\.v1\.json\.([0-9a-f]{64})\.cleanup-artifact$/u;
export const RETAINED_MARKER_AUTHORITY_LIMITS = DEFAULT_EVIDENCE_RETENTION_LIMITS;
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;

export const normalizeNativeEvidenceProjection = (
  projection: Readonly<NativeEvidenceProjectionV1>,
): Readonly<NativeEvidenceProjectionV1> =>
  projection.kind === 'export-candidates' &&
  projection.candidates.every(candidate => candidate.candidateRelativePath === null)
    ? Object.freeze({
        contextHash: projection.contextHash,
        kind: 'no-artifact' as const,
        reasonCode: 'native-output-path-null' as const,
      })
    : projection;

export const withTask8ProjectionInvariants = (
  projector: OperationEvidenceProjector,
): OperationEvidenceProjector =>
  Object.freeze({
    project: (...args: Parameters<OperationEvidenceProjector['project']>) =>
      normalizeNativeEvidenceProjection(projector.project(...args)),
  });

type OpenFileHandle = Awaited<ReturnType<typeof open>>;
type FileIdentity = Awaited<ReturnType<OpenFileHandle['stat']>>;
interface VerifiedDirectoryAuthority {
  path: string;
  authorityPath: string;
  handle: OpenFileHandle;
  identity: FileIdentity;
  windowsLease?: Awaited<ReturnType<typeof acquireWindowsDirectoryLease>>;
}
interface VerifiedDirectoryChain {
  directories: VerifiedDirectoryAuthority[];
  parent: VerifiedDirectoryAuthority;
}
interface VerifiedCleanupMarker {
  path: string;
  handle: OpenFileHandle;
  identity: FileIdentity;
  expectedBytes: Buffer;
  directoryChain: VerifiedDirectoryChain;
}
interface VerifiedArtifactFile {
  handle: OpenFileHandle;
  identity: FileIdentity;
}
type MarkerQuarantinePolicy = 'unlink-protected' | 'retain-durable';
interface RetainedMarkerLimits {
  maxRows: number;
  maxBytes: number;
  maxScanEntries: number;
}
interface RetainedMarkerAuthorityMetrics {
  scannedEntries: number;
  retainedRows: number;
  retainedBytes: number;
}
export type OrphanDiscoveryState = Readonly<
  | ({
      status: 'ready';
    } & RetainedMarkerAuthorityMetrics)
  | ({
      status: 'manual-cleanup';
      errorCode:
        | 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH'
        | 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED';
    } & RetainedMarkerAuthorityMetrics)
>;

export class OperationEvidenceArtifactStore implements OperationEvidenceArtifactPort {
  constructor(
    private readonly dependencies: {
      workspacePolicy: WorkspacePolicy;
      atomicFiles: AtomicFileStore;
      beforeCleanupCommit?: (path: string) => Promise<void>;
      beforeMarkerCleanupCommit?: (path: string) => Promise<void>;
      beforeMarkerQuarantineCommit?: (path: string) => void;
      afterMarkerQuarantineCommit?: (path: string, quarantinePath: string) => void;
      markerQuarantinePolicy?: MarkerQuarantinePolicy;
      retainedMarkerLimits?: RetainedMarkerLimits;
      afterRetainedMarkerFsync?: () => Promise<void>;
      afterArtifactQuarantineFsync?: () => Promise<void>;
      afterArtifactUnlinkFsync?: () => Promise<void>;
      beforeEvidenceMutexAcquire?: () => Promise<void>;
      afterEvidenceMutexAcquire?: () => Promise<void>;
      afterDirectoryLeaseAcquire?: (path: string) => Promise<void>;
      afterCleanupDirectoryChainOpen?: (path: string) => Promise<void>;
    },
  ) {}

  private async openVerifiedDirectoryChain(
    path: string,
    portableRelativePath: string,
    retainedRoot?: { logicalPath: string; authority: RetainedDirectoryAuthority },
  ): Promise<VerifiedDirectoryChain> {
    const segments = portableRelativePath.split('/');
    if (segments.length < 2 || segments.some(segment => segment.length === 0)) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup authority path is invalid',
      );
    }
    let root = path;
    for (let index = 0; index < segments.length; index += 1) root = dirname(root);
    const paths = [root];
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      paths.push(current);
    }
    if (normalize(join(current, segments.at(-1) as string)) !== normalize(path)) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup authority path does not match the registered workspace root',
      );
    }
    const directories: VerifiedDirectoryAuthority[] = [];
    let previousAuthorityPath: string | undefined;
    let pathsToOpen = paths;
    if (retainedRoot !== undefined) {
      const retainedIndex = paths.findIndex(
        candidate => normalize(candidate) === normalize(retainedRoot.logicalPath),
      );
      if (retainedIndex < 0) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup root is outside the directory chain',
        );
      }
      await retainedRoot.authority.verify();
      previousAuthorityPath = retainedRoot.authority.path;
      pathsToOpen = paths.slice(retainedIndex + 1);
    }
    try {
      /* eslint-disable no-await-in-loop -- each retained parent authority is opened in path order */
      for (const directoryPath of pathsToOpen) {
        const authorityInputPath =
          previousAuthorityPath === undefined
            ? directoryPath
            : join(previousAuthorityPath, basename(directoryPath));
        const before = await lstat(authorityInputPath).catch(() => null);
        if (before === null || !before.isDirectory() || before.isSymbolicLink()) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'cleanup authority parent is not a direct directory',
          );
        }
        let handle: OpenFileHandle;
        let windowsLease: Awaited<ReturnType<typeof acquireWindowsDirectoryLease>> | undefined;
        try {
          handle = await open(authorityInputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'cleanup authority parent cannot be opened without following links',
          );
        }
        try {
          const identity = await handle.stat();
          const pathnameIdentity = await lstat(authorityInputPath).catch(() => null);
          if (
            !identity.isDirectory() ||
            pathnameIdentity === null ||
            !pathnameIdentity.isDirectory() ||
            pathnameIdentity.isSymbolicLink() ||
            !sameFile(before, identity) ||
            !sameFile(identity, pathnameIdentity)
          ) {
            throw evidenceError(
              'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
              'cleanup authority parent identity changed while opening',
            );
          }
          if (process.platform === 'win32') {
            windowsLease = await acquireWindowsDirectoryLease(authorityInputPath);
            await this.dependencies.afterDirectoryLeaseAcquire?.(directoryPath);
            const [heldBig, pathnameBig] = await Promise.all([
              handle.stat({ bigint: true }),
              lstat(authorityInputPath, { bigint: true }),
            ]);
            if (
              heldBig.dev !== windowsLease.identity.dev ||
              heldBig.ino !== windowsLease.identity.ino ||
              pathnameBig.dev !== windowsLease.identity.dev ||
              pathnameBig.ino !== windowsLease.identity.ino
            ) {
              throw evidenceError(
                'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                'cleanup authority Windows lease retained a different directory',
              );
            }
          }
          const authorityPath =
            process.platform === 'linux'
              ? join('/proc/self/fd', String(handle.fd))
              : process.platform === 'darwin'
                ? join('/dev/fd', String(handle.fd))
                : authorityInputPath;
          directories.push({
            path: directoryPath,
            authorityPath,
            handle,
            identity,
            ...(windowsLease === undefined ? {} : { windowsLease }),
          });
          previousAuthorityPath = authorityPath;
        } catch (error) {
          const cleanupFailures: unknown[] = [];
          try {
            await windowsLease?.release();
          } catch (cleanupError) {
            cleanupFailures.push(cleanupError);
          }
          try {
            await handle.close();
          } catch (cleanupError) {
            cleanupFailures.push(cleanupError);
          }
          if (cleanupFailures.length > 0) {
            throw new AggregateError(
              [error, ...cleanupFailures],
              'cleanup directory authority validation and release failed',
              { cause: error },
            );
          }
          throw error;
        }
      }
      /* eslint-enable no-await-in-loop */
      if (directories.length === 0) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'cleanup directory chain has no retained operation parent',
        );
      }
      return {
        directories,
        parent: directories.at(-1) as VerifiedDirectoryAuthority,
      };
    } catch (error) {
      try {
        await this.closeVerifiedDirectoryChain({ directories });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'cleanup directory authority acquisition and release failed',
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }

  private async verifyDirectoryChain(chain: VerifiedDirectoryChain): Promise<void> {
    /* eslint-disable no-await-in-loop -- the retained root-to-parent identity chain is ordered */
    for (const directory of chain.directories) {
      const held = await directory.handle.stat().catch(() => null);
      const pathname = await lstat(directory.path).catch(() => null);
      if (
        held === null ||
        pathname === null ||
        !held.isDirectory() ||
        !pathname.isDirectory() ||
        pathname.isSymbolicLink() ||
        !sameFile(directory.identity, held) ||
        !sameFile(directory.identity, pathname)
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'cleanup authority root or parent identity changed before commit',
        );
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  private verifyDirectoryChainSync(chain: VerifiedDirectoryChain): void {
    for (const directory of chain.directories) {
      let held: ReturnType<typeof fstatSync> | null = null;
      let pathname: ReturnType<typeof lstatSync> | null = null;
      try {
        held = fstatSync(directory.handle.fd);
        pathname = lstatSync(directory.path);
      } catch {
        // The uniform identity failure below is the only externally visible result.
      }
      if (
        held === null ||
        pathname === null ||
        !held.isDirectory() ||
        !pathname.isDirectory() ||
        pathname.isSymbolicLink() ||
        !sameFile(directory.identity, held) ||
        !sameFile(directory.identity, pathname)
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'cleanup authority root or parent identity changed before commit',
        );
      }
    }
  }

  private authorityChild(directory: VerifiedDirectoryAuthority, name: string): string {
    if (!['linux', 'darwin', 'win32'].includes(process.platform)) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup authority cannot perform relative pathname mutation on this platform',
      );
    }
    return join(directory.authorityPath, name);
  }

  private async syncDirectoryAuthority(directory: VerifiedDirectoryAuthority): Promise<void> {
    await directory.handle.sync().catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    });
  }

  private syncDirectoryAuthoritySync(directory: VerifiedDirectoryAuthority): void {
    try {
      fsyncSync(directory.handle.fd);
    } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') {
        throw error;
      }
    }
  }

  private markerQuarantinePolicy(): MarkerQuarantinePolicy {
    return this.dependencies.markerQuarantinePolicy ?? 'retain-durable';
  }

  private markerAtAuthorityMatchesSync(input: {
    path: string;
    handle: OpenFileHandle;
    identity: FileIdentity;
    expectedBytes: Buffer;
    expectedLinks: number;
  }): boolean {
    let pathname: ReturnType<typeof lstatSync> | null = null;
    let held: ReturnType<typeof fstatSync> | null = null;
    try {
      pathname = lstatSync(input.path);
      held = fstatSync(input.handle.fd);
    } catch {
      return false;
    }
    if (
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      pathname.nlink !== input.expectedLinks ||
      !held.isFile() ||
      held.nlink !== input.expectedLinks ||
      held.size !== input.expectedBytes.byteLength ||
      !sameFile(input.identity, pathname) ||
      !sameFile(input.identity, held)
    ) {
      return false;
    }
    const observed = Buffer.alloc(input.expectedBytes.byteLength);
    let offset = 0;
    try {
      while (offset < observed.byteLength) {
        const count = readSync(
          input.handle.fd,
          observed,
          offset,
          observed.byteLength - offset,
          offset,
        );
        if (count === 0) return false;
        offset += count;
      }
      const extra = Buffer.alloc(1);
      if (readSync(input.handle.fd, extra, 0, 1, observed.byteLength) !== 0) return false;
    } catch {
      return false;
    }
    return observed.equals(input.expectedBytes);
  }

  private restoreVerifiedQuarantineSync(input: {
    quarantine: string;
    markerAuthorityPath: string;
    handle: OpenFileHandle;
    identity: FileIdentity;
    expectedBytes: Buffer;
    directoryChain: VerifiedDirectoryChain;
  }): boolean {
    if (
      !this.markerAtAuthorityMatchesSync({
        path: input.quarantine,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        expectedLinks: 1,
      })
    ) {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      return false;
    }
    try {
      linkSync(input.quarantine, input.markerAuthorityPath);
    } catch {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      return false;
    }
    if (
      !this.markerAtAuthorityMatchesSync({
        path: input.markerAuthorityPath,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        expectedLinks: 2,
      })
    ) {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      return false;
    }
    try {
      unlinkSync(input.quarantine);
    } catch {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      return false;
    }
    const restored = this.markerAtAuthorityMatchesSync({
      path: input.markerAuthorityPath,
      handle: input.handle,
      identity: input.identity,
      expectedBytes: input.expectedBytes,
      expectedLinks: 1,
    });
    this.syncDirectoryAuthoritySync(input.directoryChain.parent);
    return restored;
  }

  private commitMarkerAuthoritySync(input: {
    path: string;
    handle: OpenFileHandle;
    identity: FileIdentity;
    expectedBytes: Buffer;
    directoryChain: VerifiedDirectoryChain;
    pathnameChangedMessage: string;
    replacementMessage: string;
  }): string | null {
    this.verifyDirectoryChainSync(input.directoryChain);
    const markerAuthorityPath = this.authorityChild(
      input.directoryChain.parent,
      basename(input.path),
    );
    let immediatelyBeforeRename: ReturnType<typeof lstatSync> | null = null;
    try {
      immediatelyBeforeRename = lstatSync(markerAuthorityPath);
    } catch {
      // The uniform identity failure below is the only externally visible result.
    }
    if (
      immediatelyBeforeRename === null ||
      !immediatelyBeforeRename.isFile() ||
      immediatelyBeforeRename.isSymbolicLink() ||
      immediatelyBeforeRename.nlink !== 1 ||
      !sameFile(input.identity, immediatelyBeforeRename)
    ) {
      throw evidenceError('EVIDENCE_ARTIFACT_IDENTITY_MISMATCH', input.pathnameChangedMessage);
    }
    const quarantine = this.authorityChild(
      input.directoryChain.parent,
      this.markerQuarantinePolicy() === 'retain-durable'
        ? `.${basename(input.path)}.${digest(input.expectedBytes)}.${randomBytes(16).toString('hex')}.retained`
        : `.${basename(input.path)}.${randomBytes(16).toString('hex')}.cleanup`,
    );
    renameSync(markerAuthorityPath, quarantine);
    if (
      !this.markerAtAuthorityMatchesSync({
        path: quarantine,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        expectedLinks: 1,
      })
    ) {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      throw evidenceError('EVIDENCE_ARTIFACT_IDENTITY_MISMATCH', input.replacementMessage);
    }
    let relationshipProven = true;
    try {
      this.dependencies.afterMarkerQuarantineCommit?.(input.path, quarantine);
      this.verifyDirectoryChainSync(input.directoryChain);
    } catch {
      relationshipProven = false;
    }
    if (!relationshipProven) {
      const restored = this.restoreVerifiedQuarantineSync({
        quarantine,
        markerAuthorityPath,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        directoryChain: input.directoryChain,
      });
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        restored
          ? 'cleanup authority changed after quarantine; marker was restored'
          : 'cleanup authority changed after quarantine; verified quarantine retained for manual cleanup',
      );
    }
    if (
      !this.markerAtAuthorityMatchesSync({
        path: quarantine,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        expectedLinks: 1,
      })
    ) {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'quarantined cleanup marker changed; manual cleanup is required',
      );
    }
    if (this.markerQuarantinePolicy() === 'retain-durable') {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      return quarantine;
    }
    try {
      unlinkSync(quarantine);
    } catch {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'verified cleanup marker quarantine could not be removed; manual cleanup is required',
      );
    }
    this.syncDirectoryAuthoritySync(input.directoryChain.parent);
    return null;
  }

  private deleteRetainedMarkerSync(input: {
    path: string;
    handle: OpenFileHandle;
    identity: FileIdentity;
    expectedBytes: Buffer;
    directoryChain: VerifiedDirectoryChain;
  }): void {
    this.verifyDirectoryChainSync(input.directoryChain);
    if (
      !this.markerAtAuthorityMatchesSync({
        path: input.path,
        handle: input.handle,
        identity: input.identity,
        expectedBytes: input.expectedBytes,
        expectedLinks: 1,
      })
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker changed before deletion',
      );
    }
    try {
      unlinkSync(input.path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker could not be deleted',
      );
    } finally {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
    }
  }

  private emptyRetainedMarkerAuthorityMetrics(): RetainedMarkerAuthorityMetrics {
    return { scannedEntries: 0, retainedRows: 0, retainedBytes: 0 };
  }

  private async *boundedDirectoryEntries(
    path: string,
    metrics: RetainedMarkerAuthorityMetrics,
  ): AsyncGenerator<Dirent> {
    const limits = this.retainedMarkerLimits();
    const stream = await opendir(path, { bufferSize: 1 });
    for await (const entry of stream) {
      if (metrics.scannedEntries >= limits.maxScanEntries) {
        throw evidenceError(
          'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
          'retained cleanup marker scan bound is exhausted',
        );
      }
      metrics.scannedEntries += 1;
      yield entry;
    }
  }

  private async *retainedDirectoryEntries(
    path: string,
    metrics: RetainedMarkerAuthorityMetrics,
    inventory?: readonly Dirent[],
  ): AsyncGenerator<Dirent> {
    if (inventory !== undefined) {
      for (const entry of inventory) yield entry;
      return;
    }
    yield* this.boundedDirectoryEntries(path, metrics);
  }

  private async hasRecognizedRetainedMarkerQuarantine(input: {
    directoryPath: string;
    directoryName: string;
    workspaceId: string;
    metrics?: RetainedMarkerAuthorityMetrics;
    inventory?: readonly Dirent[];
    expected?: {
      operationId: string;
      artifact: Readonly<ResultArtifactV1>;
    };
  }): Promise<{
    bytes: number;
    artifact: ResultArtifactV1;
    operationId: string;
    path: string;
    expectedBytes: Buffer;
  } | null> {
    const metrics = input.metrics ?? this.emptyRetainedMarkerAuthorityMetrics();
    const candidates: Dirent[] = [];
    for await (const entry of this.retainedDirectoryEntries(
      input.directoryPath,
      metrics,
      input.inventory,
    )) {
      if (entry.name.startsWith('.cleanup-intent.v1.json.') && entry.name.endsWith('.retained')) {
        candidates.push(entry);
        if (candidates.length > 1) break;
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length !== 1 || !candidates[0]?.isFile()) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker quarantine exceeds its namespace cap',
      );
    }
    const candidate = candidates[0];
    const match = RETAINED_MARKER_QUARANTINE.exec(candidate.name);
    if (match === null) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker quarantine name is invalid',
      );
    }
    const path = join(input.directoryPath, candidate.name);
    let before: Awaited<ReturnType<typeof lstat>>;
    try {
      before = await lstat(path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker quarantine is unavailable',
      );
    }
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > 65_536
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker quarantine is not one bounded unaliased file',
      );
    }
    let handle: OpenFileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker quarantine cannot be opened without following links',
      );
    }
    try {
      const identity = await handle.stat();
      const bytes = Buffer.alloc(identity.size);
      const observed = await handle.read(bytes, 0, bytes.byteLength, 0);
      const pathnameIdentity = await lstat(path).catch(() => null);
      if (
        !identity.isFile() ||
        identity.nlink !== 1 ||
        identity.size !== before.size ||
        observed.bytesRead !== bytes.byteLength ||
        pathnameIdentity === null ||
        !pathnameIdentity.isFile() ||
        pathnameIdentity.isSymbolicLink() ||
        pathnameIdentity.nlink !== 1 ||
        !sameFile(before, identity) ||
        !sameFile(identity, pathnameIdentity) ||
        digest(bytes) !== match[1]
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker quarantine identity or digest is invalid',
        );
      }
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker quarantine bytes are invalid',
        );
      }
      if (typeof untrusted !== 'object' || untrusted === null || Array.isArray(untrusted)) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker quarantine bytes are invalid',
        );
      }
      const marker = untrusted as {
        schemaVersion: 1;
        workspaceId: string;
        operationId: string;
        artifact: ResultArtifactV1;
        contentHash: string;
      };
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
        dirname(marker.artifact.artifactRelativePath).split('/').at(-1) !== input.directoryName ||
        (input.expected !== undefined &&
          (marker.operationId !== input.expected.operationId ||
            marker.artifact.artifactRelativePath !== input.expected.artifact.artifactRelativePath ||
            marker.artifact.artifactDigest64 !== input.expected.artifact.artifactDigest64 ||
            marker.artifact.resultSchemaHash !== input.expected.artifact.resultSchemaHash))
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker quarantine authority is invalid',
        );
      }
      return {
        bytes: bytes.byteLength,
        artifact: marker.artifact,
        operationId: marker.operationId,
        path,
        expectedBytes: bytes,
      };
    } finally {
      await handle.close();
    }
  }

  private async deleteRecognizedRetainedMarker(input: {
    retained: {
      path: string;
      expectedBytes: Buffer;
    };
    fixedMarkerPath: string;
    markerRelativePath: string;
    evidenceRoot?: string;
    evidenceRootAuthority?: RetainedDirectoryAuthority;
  }): Promise<void> {
    const directoryChain = await this.openVerifiedDirectoryChain(
      input.fixedMarkerPath,
      input.markerRelativePath,
      input.evidenceRoot === undefined || input.evidenceRootAuthority === undefined
        ? undefined
        : { logicalPath: input.evidenceRoot, authority: input.evidenceRootAuthority },
    );
    const before = await lstat(input.retained.path).catch(() => null);
    if (
      before === null ||
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size !== input.retained.expectedBytes.byteLength
    ) {
      await this.closeVerifiedDirectoryChain(directoryChain);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'retained cleanup marker is unavailable for deletion',
      );
    }
    const handle = await open(input.retained.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const identity = await handle.stat();
      if (!sameFile(before, identity)) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker identity changed before deletion',
        );
      }
      this.deleteRetainedMarkerSync({
        path: this.authorityChild(directoryChain.parent, basename(input.retained.path)),
        handle,
        identity,
        expectedBytes: input.retained.expectedBytes,
        directoryChain,
      });
    } finally {
      await handle.close();
      await this.closeVerifiedDirectoryChain(directoryChain);
    }
  }

  private retainedMarkerLimits(): RetainedMarkerLimits {
    const limits = this.dependencies.retainedMarkerLimits ?? RETAINED_MARKER_AUTHORITY_LIMITS;
    if (
      !Number.isSafeInteger(limits.maxRows) ||
      limits.maxRows < 1 ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxBytes < 1 ||
      !Number.isSafeInteger(limits.maxScanEntries) ||
      limits.maxScanEntries < limits.maxRows
    ) {
      throw evidenceError(
        'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
        'retained cleanup marker limits are invalid',
      );
    }
    return limits;
  }

  private async scanRetainedMarkerAuthority(input: {
    evidenceRoot: string;
    workspaceId: string;
    metrics?: RetainedMarkerAuthorityMetrics;
  }): Promise<RetainedMarkerAuthorityMetrics> {
    const limits = this.retainedMarkerLimits();
    const metrics = input.metrics ?? this.emptyRetainedMarkerAuthorityMetrics();
    /* eslint-disable no-await-in-loop -- retained authorities are streamed and verified serially */
    for await (const entry of this.boundedDirectoryEntries(input.evidenceRoot, metrics)) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/u.test(entry.name)) continue;
      const retained = await this.hasRecognizedRetainedMarkerQuarantine({
        directoryPath: join(input.evidenceRoot, entry.name),
        directoryName: entry.name,
        workspaceId: input.workspaceId,
        metrics,
      });
      if (retained === null) continue;
      metrics.retainedRows += 1;
      metrics.retainedBytes += retained.bytes;
      const retainedArtifact = await this.retainedArtifactQuarantine({
        directoryPath: join(input.evidenceRoot, entry.name),
        artifact: retained.artifact,
        metrics,
      });
      if (retainedArtifact !== null) {
        metrics.retainedBytes += retainedArtifact.bytes;
      }
      if (metrics.retainedRows >= limits.maxRows || metrics.retainedBytes >= limits.maxBytes) {
        throw evidenceError(
          'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
          'retained cleanup marker capacity is full; manual cleanup is required',
        );
      }
    }
    /* eslint-enable no-await-in-loop */
    return metrics;
  }

  private async enforceRetainedMarkerCapacity(input: {
    evidenceRoot: string;
    workspaceId: string;
    operationDirectoryName: string;
    nextBytes: number;
    nextRows?: number;
    metrics?: RetainedMarkerAuthorityMetrics;
    authority?: Readonly<EvidenceRetentionAuthority>;
  }): Promise<void> {
    if (input.metrics === undefined) {
      try {
        await assertProspectiveEvidenceRetention({
          evidenceRoot: input.evidenceRoot,
          operationDirectoryName: input.operationDirectoryName,
          nextBytes: input.nextBytes,
          limits: this.retainedMarkerLimits(),
          ...(input.authority === undefined ? {} : { authority: input.authority }),
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        throw evidenceError(
          code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
            ? 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED'
            : 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'unified evidence retention authority rejected cleanup',
        );
      }
      return;
    }
    const metrics = input.metrics ?? (await this.scanRetainedMarkerAuthority(input));
    this.assertProspectiveRetainedMarkerCapacity(metrics, input.nextBytes, input.nextRows ?? 1);
  }

  private assertProspectiveRetainedMarkerCapacity(
    metrics: RetainedMarkerAuthorityMetrics,
    nextBytes: number,
    nextRows = 1,
  ): void {
    const limits = this.retainedMarkerLimits();
    if (
      metrics.retainedRows > limits.maxRows - nextRows ||
      metrics.retainedBytes > limits.maxBytes - nextBytes
    ) {
      throw evidenceError(
        'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
        'retained cleanup marker capacity is full; manual cleanup is required',
      );
    }
  }

  private async closeVerifiedDirectoryChain(chain: {
    directories: VerifiedDirectoryAuthority[];
  }): Promise<void> {
    const failures: unknown[] = [];
    /* eslint-disable no-await-in-loop -- leases and handles release leaf-to-root in strict order */
    for (const directory of chain.directories.toReversed()) {
      try {
        await directory.windowsLease?.release();
      } catch (error) {
        failures.push(error);
      }
      try {
        await directory.handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    /* eslint-enable no-await-in-loop */
    if (failures.length > 0) {
      throw new AggregateError(failures, 'cleanup directory authority release failed');
    }
  }

  async preflight(workspaceId: string, intent: VerifiedCaptureIntentV1): Promise<string | null> {
    if (!intent.captureResult) return null;
    if (!PortableRelativeArtifactPathSchema.safeParse(intent.relativePath).success) {
      throw evidenceError('EVIDENCE_ARTIFACT_PATH_INVALID', 'capture path is not portable');
    }
    const resolved = await this.dependencies.workspacePolicy.resolveWrite(
      workspaceId,
      workspacePolicyPath(intent.relativePath),
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
    const artifact = Object.freeze({
      artifactRelativePath: input.intent.relativePath,
      artifactDigest64: observedDigest,
      resultSchemaHash: input.resultSchemaHash,
    });
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
    let root = await this.dependencies.workspacePolicy.resolveRoot?.(input.workspaceId);
    if (root === undefined) {
      root = target;
      for (let index = 0; index < input.intent.relativePath.split('/').length; index += 1) {
        root = dirname(root);
      }
    }
    const operationDirectory = dirname(target);
    const evidenceRoot = dirname(operationDirectory);
    return withEvidenceRetentionMutex(
      root,
      evidenceRoot,
      async evidenceAuthority => {
        await this.dependencies.afterEvidenceMutexAcquire?.();
        return withRetainedDirectoryDescendantChain(
          evidenceRoot,
          evidenceAuthority,
          operationDirectory,
          async authority => {
            const revalidated = await this.preflight(input.workspaceId, input.intent);
            if (revalidated !== target) {
              throw evidenceError(
                'EVIDENCE_ARTIFACT_PATH_CHANGED',
                'capture path changed during retained admission',
              );
            }
            const cleanupIntentPath = authority.child('cleanup-intent.v1.json');
            const artifactPath = authority.child('result.v1.json');
            await this.dependencies.atomicFiles.createNew(
              cleanupIntentPath,
              Buffer.from(`${JSON.stringify(cleanupIntent)}\n`, 'utf8'),
            );
            try {
              await this.dependencies.atomicFiles.createNew(
                artifactPath,
                input.canonicalRedactedBytes,
              );
            } catch (cause) {
              if ((cause as { code?: unknown }).code === 'TARGET_ALREADY_EXISTS') {
                throw evidenceError(
                  'CAPTURE_CREATE_RACE',
                  'capture target was created after preflight; runtime outcome is unknown',
                );
              }
              throw cause;
            }
            const observed = await readFileWithinLimit(
              artifactPath,
              input.canonicalRedactedBytes.byteLength,
            );
            if (digest(observed) !== observedDigest) {
              throw evidenceError(
                'EVIDENCE_ARTIFACT_MISMATCH',
                'capture reread digest does not match',
              );
            }
            await authority.verify();
            return artifact;
          },
          { createMissing: true, errorCode: 'EVIDENCE_ARTIFACT_PATH_CHANGED' },
        );
      },
      {
        createMissing: true,
        errorCode: 'EVIDENCE_ARTIFACT_PATH_CHANGED',
        beforeMutexAcquire: () =>
          this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
      },
    );
  }

  private async lstatMaybe(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    return lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  }

  private async openVerifiedArtifactFile(
    path: string,
    artifact: Readonly<ResultArtifactV1>,
  ): Promise<VerifiedArtifactFile> {
    const before = await lstat(path).catch(() => null);
    if (before === null || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact is not one unaliased regular file',
      );
    }
    let handle: OpenFileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact cannot be opened without following links',
      );
    }
    try {
      const identity = await handle.stat();
      if (!identity.isFile() || identity.nlink !== 1 || !sameFile(before, identity)) {
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
      const bytes = Buffer.concat(chunks, total);
      const afterRead = await lstat(path).catch(() => null);
      if (
        afterRead === null ||
        !afterRead.isFile() ||
        afterRead.isSymbolicLink() ||
        afterRead.nlink !== 1 ||
        !sameFile(identity, afterRead) ||
        digest(bytes) !== artifact.artifactDigest64
      ) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'artifact bytes or identity changed during retention cleanup',
        );
      }
      return { handle, identity };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private artifactQuarantinePath(
    parent: VerifiedDirectoryAuthority,
    artifact: Readonly<ResultArtifactV1>,
  ): string {
    return this.authorityChild(
      parent,
      `.result.v1.json.${artifact.artifactDigest64}.cleanup-artifact`,
    );
  }

  private artifactAtAuthorityMatchesSync(input: {
    path: string;
    verified: VerifiedArtifactFile;
    artifact: Readonly<ResultArtifactV1>;
  }): boolean {
    let pathname: ReturnType<typeof lstatSync> | null = null;
    let held: ReturnType<typeof fstatSync> | null = null;
    try {
      pathname = lstatSync(input.path);
      held = fstatSync(input.verified.handle.fd);
    } catch {
      return false;
    }
    if (
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      pathname.nlink !== 1 ||
      !held.isFile() ||
      held.nlink !== 1 ||
      held.size < 1 ||
      held.size > 8_388_608 ||
      !sameFile(input.verified.identity, pathname) ||
      !sameFile(input.verified.identity, held)
    ) {
      return false;
    }
    const observed = Buffer.alloc(held.size);
    let offset = 0;
    try {
      while (offset < observed.byteLength) {
        const count = readSync(
          input.verified.handle.fd,
          observed,
          offset,
          observed.byteLength - offset,
          offset,
        );
        if (count === 0) return false;
        offset += count;
      }
      const extra = Buffer.alloc(1);
      if (readSync(input.verified.handle.fd, extra, 0, 1, observed.byteLength) !== 0) return false;
    } catch {
      return false;
    }
    return digest(observed) === input.artifact.artifactDigest64;
  }

  private commitArtifactQuarantineRetentionSync(input: {
    quarantine: string;
    verified: VerifiedArtifactFile;
    artifact: Readonly<ResultArtifactV1>;
    directoryChain: VerifiedDirectoryChain;
  }): void {
    this.verifyDirectoryChainSync(input.directoryChain);
    if (
      !this.artifactAtAuthorityMatchesSync({
        path: input.quarantine,
        verified: input.verified,
        artifact: input.artifact,
      })
    ) {
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact quarantine identity changed before retained cleanup commit',
      );
    }
    this.syncDirectoryAuthoritySync(input.directoryChain.parent);
  }

  private async cleanupVerifiedArtifact(input: {
    fixedPath: string;
    verified: VerifiedArtifactFile;
    artifact: Readonly<ResultArtifactV1>;
    directoryChain: VerifiedDirectoryChain;
    alreadyQuarantined: boolean;
  }): Promise<void> {
    const fixedAuthorityPath = this.authorityChild(
      input.directoryChain.parent,
      basename(input.fixedPath),
    );
    const quarantine = this.artifactQuarantinePath(input.directoryChain.parent, input.artifact);
    try {
      if (!input.alreadyQuarantined) {
        await this.dependencies.beforeCleanupCommit?.(input.fixedPath);
        await this.verifyDirectoryChain(input.directoryChain);
        const immediatelyBeforeRename = await lstat(fixedAuthorityPath).catch(() => null);
        if (
          immediatelyBeforeRename === null ||
          !immediatelyBeforeRename.isFile() ||
          immediatelyBeforeRename.isSymbolicLink() ||
          immediatelyBeforeRename.nlink !== 1 ||
          !sameFile(input.verified.identity, immediatelyBeforeRename) ||
          (await this.lstatMaybe(quarantine)) !== null
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact state changed before cleanup quarantine',
          );
        }
        await rename(fixedAuthorityPath, quarantine);
        const moved = await lstat(quarantine).catch(() => null);
        if (
          moved === null ||
          !moved.isFile() ||
          moved.isSymbolicLink() ||
          moved.nlink !== 1 ||
          !sameFile(input.verified.identity, moved)
        ) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'artifact quarantine identity is invalid',
          );
        }
        await this.syncDirectoryAuthority(input.directoryChain.parent);
        await this.dependencies.afterArtifactQuarantineFsync?.();
      }
      this.commitArtifactQuarantineRetentionSync({
        quarantine,
        verified: input.verified,
        artifact: input.artifact,
        directoryChain: input.directoryChain,
      });
      try {
        unlinkSync(quarantine);
      } catch {
        this.syncDirectoryAuthoritySync(input.directoryChain.parent);
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'verified artifact quarantine could not be deleted',
        );
      }
      this.syncDirectoryAuthoritySync(input.directoryChain.parent);
      await this.dependencies.afterArtifactUnlinkFsync?.();
    } finally {
      await input.verified.handle.close();
    }
  }

  private async retainedArtifactQuarantine(input: {
    directoryPath: string;
    artifact: Readonly<ResultArtifactV1>;
    metrics?: RetainedMarkerAuthorityMetrics;
    inventory?: readonly Dirent[];
  }): Promise<{ path: string; bytes: number } | null> {
    const metrics = input.metrics ?? this.emptyRetainedMarkerAuthorityMetrics();
    const candidates: Dirent[] = [];
    for await (const entry of this.retainedDirectoryEntries(
      input.directoryPath,
      metrics,
      input.inventory,
    )) {
      if (entry.name.startsWith('.result.v1.json.') && entry.name.endsWith('.cleanup-artifact')) {
        candidates.push(entry);
        if (candidates.length > 1) break;
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length !== 1 || !candidates[0]?.isFile()) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact cleanup quarantine namespace is contradictory',
      );
    }
    const match = ARTIFACT_CLEANUP_QUARANTINE.exec(candidates[0].name);
    if (match === null || match[1] !== input.artifact.artifactDigest64) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact cleanup quarantine name or digest is invalid',
      );
    }
    const path = join(input.directoryPath, candidates[0].name);
    const metadata = await lstat(path).catch(() => null);
    if (
      metadata === null ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > 8_388_608
    ) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact cleanup quarantine is not one bounded regular file',
      );
    }
    const bytes = await readFileWithinLimit(path, 8_388_608, undefined, {
      expectedIdentity: metadata,
    });
    if (digest(bytes) !== input.artifact.artifactDigest64) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'artifact cleanup quarantine digest is invalid',
      );
    }
    return { path, bytes: bytes.byteLength };
  }

  private async removeLinkedUnderAuthority(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
    operationDirectory: string;
    evidenceRoot: string;
    evidenceRootAuthority?: RetainedDirectoryAuthority;
    operationAuthority?: RetainedDirectoryAuthority;
    retentionAuthority?: Readonly<EvidenceRetentionAuthority>;
    operationInventory?: readonly Dirent[];
    metrics?: RetainedMarkerAuthorityMetrics;
  }): Promise<void> {
    if (input.evidenceRootAuthority !== undefined && input.operationAuthority === undefined) {
      return withRetainedDirectoryDescendantChain(
        input.evidenceRoot,
        input.evidenceRootAuthority,
        input.operationDirectory,
        operationAuthority => this.removeLinkedUnderAuthority({ ...input, operationAuthority }),
        { errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' },
      );
    }
    const operationAuthorityPath =
      input.operationAuthority?.path ??
      input.evidenceRootAuthority?.child(basename(input.operationDirectory)) ??
      input.operationDirectory;
    const fixedMarkerLogicalPath = join(input.operationDirectory, 'cleanup-intent.v1.json');
    const fixedArtifactPath = join(operationAuthorityPath, 'result.v1.json');
    const fixedMarkerPath = join(operationAuthorityPath, 'cleanup-intent.v1.json');
    const retained = await this.hasRecognizedRetainedMarkerQuarantine({
      directoryPath: operationAuthorityPath,
      directoryName: basename(input.operationDirectory),
      workspaceId: input.workspaceId,
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
      ...(input.operationInventory === undefined ? {} : { inventory: input.operationInventory }),
      expected: { operationId: input.operationId, artifact: input.artifact },
    });
    const artifactQuarantine = await this.retainedArtifactQuarantine({
      directoryPath: operationAuthorityPath,
      artifact: input.artifact,
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
      ...(input.operationInventory === undefined ? {} : { inventory: input.operationInventory }),
    });
    const [fixedMarker, fixedArtifact] = await Promise.all([
      this.lstatMaybe(fixedMarkerPath),
      this.lstatMaybe(fixedArtifactPath),
    ]);
    const markerRelativePath = cleanupIntentRelativePath(input.operationId);
    if (retained !== null) {
      if (fixedMarker !== null || (fixedArtifact !== null && artifactQuarantine !== null)) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'retained cleanup marker contradicts fixed cleanup state',
        );
      }
      if (fixedArtifact !== null || artifactQuarantine !== null) {
        const directoryChain = await this.openVerifiedDirectoryChain(
          fixedMarkerLogicalPath,
          markerRelativePath,
          input.evidenceRootAuthority === undefined
            ? undefined
            : { logicalPath: input.evidenceRoot, authority: input.evidenceRootAuthority },
        );
        try {
          const source = artifactQuarantine?.path ?? fixedArtifactPath;
          const verified = await this.openVerifiedArtifactFile(source, input.artifact);
          const artifactBytes = Number(verified.identity.size);
          if (artifactQuarantine === null) {
            await this.enforceRetainedMarkerCapacity({
              evidenceRoot: input.evidenceRoot,
              workspaceId: input.workspaceId,
              operationDirectoryName: basename(input.operationDirectory),
              nextBytes: artifactBytes,
              nextRows: 0,
              ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
              ...(input.retentionAuthority === undefined
                ? {}
                : { authority: input.retentionAuthority }),
            });
          }
          await this.cleanupVerifiedArtifact({
            fixedPath: fixedArtifactPath,
            verified,
            artifact: input.artifact,
            directoryChain,
            alreadyQuarantined: artifactQuarantine !== null,
          });
        } finally {
          await this.closeVerifiedDirectoryChain(directoryChain);
        }
      }
      await this.deleteRecognizedRetainedMarker({
        retained,
        fixedMarkerPath: fixedMarkerLogicalPath,
        markerRelativePath,
        evidenceRoot: input.evidenceRoot,
        ...(input.evidenceRootAuthority === undefined
          ? {}
          : { evidenceRootAuthority: input.evidenceRootAuthority }),
      });
      return;
    }
    if (artifactQuarantine === null && fixedMarker === null && fixedArtifact === null) return;
    if (artifactQuarantine !== null || fixedMarker === null || fixedArtifact === null) {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'fresh artifact cleanup state is incomplete or contradictory',
      );
    }
    const marker = await this.openVerifiedCleanupMarker(input);
    try {
      const verified = await this.openVerifiedArtifactFile(fixedArtifactPath, input.artifact);
      const artifactBytes = Number(verified.identity.size);
      try {
        await this.enforceRetainedMarkerCapacity({
          evidenceRoot: input.evidenceRoot,
          workspaceId: input.workspaceId,
          operationDirectoryName: basename(input.operationDirectory),
          nextBytes: marker.expectedBytes.byteLength + artifactBytes,
          nextRows: 1,
          ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
          ...(input.retentionAuthority === undefined
            ? {}
            : { authority: input.retentionAuthority }),
        });
        const retainedMarkerPath = await this.commitVerifiedCleanupMarker(marker);
        await this.dependencies.afterRetainedMarkerFsync?.();
        await this.cleanupVerifiedArtifact({
          fixedPath: fixedArtifactPath,
          verified,
          artifact: input.artifact,
          directoryChain: marker.directoryChain,
          alreadyQuarantined: false,
        });
        if (retainedMarkerPath !== null) {
          this.deleteRetainedMarkerSync({
            path: retainedMarkerPath,
            handle: marker.handle,
            identity: marker.identity,
            expectedBytes: marker.expectedBytes,
            directoryChain: marker.directoryChain,
          });
        }
      } catch (error) {
        await verified.handle.close().catch(() => undefined);
        throw error;
      }
    } finally {
      try {
        await marker.handle.close();
      } finally {
        await this.closeVerifiedDirectoryChain(marker.directoryChain);
      }
    }
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
    const operationRelativePath = input.artifact.artifactRelativePath
      .split('/')
      .slice(0, -1)
      .join('/');
    const operationDirectory = await this.dependencies.workspacePolicy.resolveRead(
      input.workspaceId,
      workspacePolicyPath(operationRelativePath),
    );
    await this.dependencies.workspacePolicy.assertWithinRoot(
      input.workspaceId,
      workspacePolicyPath(operationRelativePath),
    );
    const evidenceRoot = dirname(operationDirectory);
    const registeredRoot =
      (await this.dependencies.workspacePolicy.resolveRoot?.(input.workspaceId)) ?? evidenceRoot;
    return withEvidenceRetentionMutex(
      registeredRoot,
      evidenceRoot,
      async evidenceRootAuthority => {
        await this.dependencies.afterEvidenceMutexAcquire?.();
        const metrics = this.emptyRetainedMarkerAuthorityMetrics();
        let retentionAuthority: Readonly<EvidenceRetentionAuthority>;
        try {
          retentionAuthority = await scanEvidenceRetentionAuthority(
            evidenceRoot,
            this.retainedMarkerLimits(),
            { rootAuthority: evidenceRootAuthority, metrics },
          );
        } catch (error) {
          throw evidenceError(
            (error as { code?: unknown }).code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
              ? 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED'
              : 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'unified evidence retention authority rejected cleanup',
          );
        }
        return this.removeLinkedUnderAuthority({
          ...input,
          operationDirectory,
          evidenceRoot,
          evidenceRootAuthority,
          retentionAuthority,
          metrics,
          ...(retentionAuthority.operationDirectoryEntries.get(basename(operationDirectory)) ===
          undefined
            ? {}
            : {
                operationInventory: retentionAuthority.operationDirectoryEntries.get(
                  basename(operationDirectory),
                ) as readonly Dirent[],
              }),
        });
      },
      {
        errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        beforeMutexAcquire: () =>
          this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
      },
    );
  }

  private async openVerifiedCleanupMarker(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
    evidenceRoot?: string;
    evidenceRootAuthority?: RetainedDirectoryAuthority;
  }): Promise<VerifiedCleanupMarker> {
    const relativePath = cleanupIntentRelativePath(input.operationId);
    const path = await this.dependencies.workspacePolicy.resolveRead(
      input.workspaceId,
      workspacePolicyPath(relativePath),
    );
    await this.dependencies.workspacePolicy.assertWithinRoot(
      input.workspaceId,
      workspacePolicyPath(relativePath),
    );
    const directoryChain = await this.openVerifiedDirectoryChain(
      path,
      relativePath,
      input.evidenceRoot === undefined || input.evidenceRootAuthority === undefined
        ? undefined
        : { logicalPath: input.evidenceRoot, authority: input.evidenceRootAuthority },
    );
    let markerAuthorityPath: string;
    try {
      await this.dependencies.afterCleanupDirectoryChainOpen?.(path);
      markerAuthorityPath = this.authorityChild(directoryChain.parent, basename(path));
    } catch (error) {
      try {
        await this.closeVerifiedDirectoryChain(directoryChain);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'cleanup marker authority hook and directory release failed',
          { cause: cleanupError },
        );
      }
      throw error;
    }
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
      before = await lstat(markerAuthorityPath);
    } catch {
      await this.closeVerifiedDirectoryChain(directoryChain);
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
      await this.closeVerifiedDirectoryChain(directoryChain);
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker is not the expected unaliased regular file',
      );
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(markerAuthorityPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      await this.closeVerifiedDirectoryChain(directoryChain);
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
      const pathnameIdentity = await lstat(markerAuthorityPath).catch(() => null);
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
      return { path, handle, identity, expectedBytes: expected, directoryChain };
    } catch (error) {
      await handle.close();
      await this.closeVerifiedDirectoryChain(directoryChain);
      throw error;
    }
  }

  private async commitVerifiedCleanupMarker(marker: VerifiedCleanupMarker): Promise<string | null> {
    try {
      await this.dependencies.beforeMarkerCleanupCommit?.(marker.path);
      this.dependencies.beforeMarkerQuarantineCommit?.(marker.path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker parent or pathname replacement was refused',
      );
    }
    return this.commitMarkerAuthoritySync({
      path: marker.path,
      handle: marker.handle,
      identity: marker.identity,
      expectedBytes: marker.expectedBytes,
      directoryChain: marker.directoryChain,
      pathnameChangedMessage: 'cleanup marker pathname changed before cleanup commit',
      replacementMessage: 'replacement cleanup marker won the cleanup commit',
    });
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
        workspacePolicyPath(relativePath),
      );
      if (resolved.overwrites) return true;
    }
    /* eslint-enable no-await-in-loop */
    return false;
  }

  async discoverAndCleanupOrphans(input: {
    workspaceId: string;
    hasLinkedEvidence(operationId: string): Promise<boolean>;
  }): Promise<OrphanDiscoveryState> {
    const metrics = this.emptyRetainedMarkerAuthorityMetrics();
    let root: string | null;
    try {
      root = await this.dependencies.workspacePolicy.resolveRead(
        input.workspaceId,
        workspacePolicyPath('.sfp/operation-evidence'),
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === 'WORKSPACE_PATH_NOT_FOUND') root = null;
      else {
        return Object.freeze({
          status: 'manual-cleanup',
          errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          ...metrics,
        });
      }
    }
    if (root === null) return Object.freeze({ status: 'ready', ...metrics });
    const registeredRoot =
      (await this.dependencies.workspacePolicy.resolveRoot?.(input.workspaceId)) ?? root;
    return withEvidenceRetentionMutex(
      registeredRoot,
      root,
      async evidenceRootAuthority => {
        await this.dependencies.afterEvidenceMutexAcquire?.();
        const processingMetrics = metrics;
        let retentionAuthority: Readonly<EvidenceRetentionAuthority>;
        try {
          try {
            const authority = await scanEvidenceRetentionAuthority(
              root,
              this.retainedMarkerLimits(),
              {
                rootAuthority: evidenceRootAuthority,
                metrics,
              },
            );
            retentionAuthority = authority;
            metrics.scannedEntries = authority.scannedEntries;
            metrics.retainedRows = authority.retainedRows;
            metrics.retainedBytes = authority.retainedBytes;
          } catch (error) {
            const observed = error as Partial<RetainedMarkerAuthorityMetrics> & { code?: unknown };
            if (Number.isSafeInteger(observed.scannedEntries)) {
              metrics.scannedEntries = observed.scannedEntries as number;
            }
            if (Number.isSafeInteger(observed.retainedRows)) {
              metrics.retainedRows = observed.retainedRows as number;
            }
            if (Number.isSafeInteger(observed.retainedBytes)) {
              metrics.retainedBytes = observed.retainedBytes as number;
            }
            const code = observed.code;
            throw evidenceError(
              code === 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED'
                ? 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED'
                : 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
              'unified evidence retention scan rejected orphan cleanup',
            );
          }
          /* eslint-disable no-await-in-loop -- each fixed orphan directory is verified before cleanup */
          for (const directoryName of [...retentionAuthority.operationDirectories].toSorted()) {
            const operationDirectory = join(root, directoryName);
            const markerPath = join(operationDirectory, 'cleanup-intent.v1.json');
            const markerRelativePath = `.sfp/operation-evidence/${directoryName}/cleanup-intent.v1.json`;
            const directoryChain = await this.openVerifiedDirectoryChain(
              markerPath,
              markerRelativePath,
              { logicalPath: root, authority: evidenceRootAuthority },
            );
            const operationAuthorityPath = directoryChain.parent.authorityPath;
            const markerAuthorityPath = join(operationAuthorityPath, 'cleanup-intent.v1.json');
            const operationInventory =
              retentionAuthority.operationDirectoryEntries.get(directoryName) ?? [];
            let retained: Awaited<
              ReturnType<OperationEvidenceArtifactStore['hasRecognizedRetainedMarkerQuarantine']>
            > = null;
            try {
              retained = await this.hasRecognizedRetainedMarkerQuarantine({
                directoryPath: operationAuthorityPath,
                directoryName,
                workspaceId: input.workspaceId,
                metrics: processingMetrics,
                inventory: operationInventory,
              });
            } catch (error) {
              await this.closeVerifiedDirectoryChain(directoryChain);
              throw error;
            }
            if (retained !== null) {
              const fixedMarker = await lstat(markerAuthorityPath).catch(
                (error: NodeJS.ErrnoException) => {
                  if (error.code === 'ENOENT') return null;
                  throw error;
                },
              );
              await this.closeVerifiedDirectoryChain(directoryChain);
              if (fixedMarker !== null) {
                throw evidenceError(
                  'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                  'retained cleanup marker coexists with a fixed marker',
                );
              }
              if (await input.hasLinkedEvidence(retained.operationId)) continue;
              await this.removeLinkedUnderAuthority({
                workspaceId: input.workspaceId,
                operationId: retained.operationId,
                artifact: retained.artifact,
                operationDirectory,
                evidenceRoot: root,
                evidenceRootAuthority,
                retentionAuthority,
                operationInventory,
                metrics,
              });
              continue;
            }
            let markerHandle: Awaited<ReturnType<typeof open>>;
            try {
              markerHandle = await open(
                markerAuthorityPath,
                constants.O_RDONLY | constants.O_NOFOLLOW,
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                await this.closeVerifiedDirectoryChain(directoryChain);
                continue;
              }
              await this.closeVerifiedDirectoryChain(directoryChain);
              throw evidenceError(
                'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                'orphan marker cannot be opened without following links',
              );
            }
            let markerAuthorityClosed = false;
            const closeMarkerAuthority = async (): Promise<void> => {
              if (markerAuthorityClosed) return;
              markerAuthorityClosed = true;
              try {
                await markerHandle.close();
              } finally {
                await this.closeVerifiedDirectoryChain(directoryChain);
              }
            };
            let marker: {
              schemaVersion: 1;
              workspaceId: string;
              operationId: string;
              artifact: ResultArtifactV1;
              contentHash: string;
            };
            let markerIdentity: Awaited<ReturnType<typeof markerHandle.stat>>;
            let markerBytes: Buffer;
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
              markerBytes = Buffer.alloc(markerIdentity.size);
              const observed = await markerHandle.read(markerBytes, 0, markerBytes.byteLength, 0);
              const pathnameIdentity = await lstat(markerAuthorityPath);
              if (
                observed.bytesRead !== markerBytes.byteLength ||
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
              try {
                const parsed = JSON.parse(markerBytes.toString('utf8')) as unknown;
                if (
                  typeof parsed !== 'object' ||
                  parsed === null ||
                  Array.isArray(parsed) ||
                  typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== 'number' ||
                  typeof (parsed as { workspaceId?: unknown }).workspaceId !== 'string' ||
                  typeof (parsed as { operationId?: unknown }).operationId !== 'string' ||
                  typeof (parsed as { contentHash?: unknown }).contentHash !== 'string' ||
                  typeof (parsed as { artifact?: unknown }).artifact !== 'object' ||
                  (parsed as { artifact?: unknown }).artifact === null ||
                  Array.isArray((parsed as { artifact?: unknown }).artifact) ||
                  typeof (parsed as { artifact: { artifactRelativePath?: unknown } }).artifact
                    .artifactRelativePath !== 'string' ||
                  typeof (parsed as { artifact: { artifactDigest64?: unknown } }).artifact
                    .artifactDigest64 !== 'string' ||
                  typeof (parsed as { artifact: { resultSchemaHash?: unknown } }).artifact
                    .resultSchemaHash !== 'string'
                ) {
                  throw new Error('wrong marker shape');
                }
                marker = parsed as typeof marker;
              } catch {
                throw evidenceError(
                  'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                  'orphan marker JSON is malformed',
                );
              }
            } catch (error) {
              await closeMarkerAuthority();
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
              dirname(marker.artifact.artifactRelativePath).split('/').at(-1) !== directoryName
            ) {
              await closeMarkerAuthority();
              throw evidenceError(
                'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                'orphan marker is invalid',
              );
            }
            const artifactPath = join(operationAuthorityPath, 'result.v1.json');
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
              await closeMarkerAuthority();
              throw error;
            }
            if (
              artifactIdentity !== null &&
              (!artifactIdentity.isFile() ||
                artifactIdentity.isSymbolicLink() ||
                artifactIdentity.nlink !== 1)
            ) {
              await closeMarkerAuthority();
              throw evidenceError(
                'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                'orphan artifact pathname is not one unaliased regular file',
              );
            }
            if (artifactIdentity === null) {
              try {
                if (await input.hasLinkedEvidence(marker.operationId)) continue;
                if (this.markerQuarantinePolicy() === 'retain-durable') {
                  this.assertProspectiveRetainedMarkerCapacity(metrics, markerBytes.byteLength);
                }
                try {
                  await this.dependencies.beforeMarkerCleanupCommit?.(markerPath);
                  this.dependencies.beforeMarkerQuarantineCommit?.(markerPath);
                } catch {
                  throw evidenceError(
                    'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
                    'cleanup marker parent or pathname replacement was refused',
                  );
                }
                this.commitMarkerAuthoritySync({
                  path: markerAuthorityPath,
                  handle: markerHandle,
                  identity: markerIdentity,
                  expectedBytes: markerBytes,
                  directoryChain,
                  pathnameChangedMessage: 'orphan marker pathname changed before cleanup commit',
                  replacementMessage: 'replacement marker won the cleanup commit',
                });
                if (this.markerQuarantinePolicy() === 'retain-durable') {
                  metrics.retainedRows += 1;
                  metrics.retainedBytes += markerBytes.byteLength;
                }
              } finally {
                await closeMarkerAuthority();
              }
              continue;
            }
            await closeMarkerAuthority();
            if (await input.hasLinkedEvidence(marker.operationId)) continue;
            await this.removeLinkedUnderAuthority({
              workspaceId: input.workspaceId,
              operationId: marker.operationId,
              artifact: marker.artifact,
              operationDirectory,
              evidenceRoot: root,
              evidenceRootAuthority,
              retentionAuthority,
              operationInventory,
              metrics,
            });
          }
          /* eslint-enable no-await-in-loop */
          return Object.freeze({
            status: 'ready',
            scannedEntries: metrics.scannedEntries,
            retainedRows: metrics.retainedRows,
            retainedBytes: metrics.retainedBytes,
          });
        } catch (error) {
          const errorCode = (error as { code?: unknown }).code;
          if (
            errorCode !== 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH' &&
            errorCode !== 'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED'
          ) {
            throw error;
          }
          return Object.freeze({
            status: 'manual-cleanup',
            errorCode,
            scannedEntries: metrics.scannedEntries,
            retainedRows: metrics.retainedRows,
            retainedBytes: metrics.retainedBytes,
          });
        }
      },
      {
        errorCode: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        beforeMutexAcquire: () =>
          this.dependencies.beforeEvidenceMutexAcquire?.() ?? Promise.resolve(),
      },
    );
  }
}
