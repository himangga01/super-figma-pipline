import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  readSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { lstat, mkdir, open, opendir, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, normalize, sep } from 'node:path';

import {
  PortableRelativeArtifactPathSchema,
  type OperationEvidenceArtifactPort,
  type PrefixedSha256,
  type ResultArtifactV1,
  type VerifiedCaptureIntentV1,
  type WorkspacePolicy,
} from '@sfp/shared';

import {
  readFileWithinLimit,
  withCanonicalPathMutex,
  type AtomicFileStore,
} from './atomic-file.js';

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
export const RETAINED_MARKER_AUTHORITY_LIMITS = Object.freeze({
  maxRows: 1_024,
  maxBytes: 67_108_864,
  maxScanEntries: 4_096,
});
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;

type OpenFileHandle = Awaited<ReturnType<typeof open>>;
type FileIdentity = Awaited<ReturnType<OpenFileHandle['stat']>>;
interface VerifiedDirectoryAuthority {
  path: string;
  handle: OpenFileHandle;
  identity: FileIdentity;
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
    },
  ) {}

  private async openVerifiedDirectoryChain(
    path: string,
    portableRelativePath: string,
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
    try {
      /* eslint-disable no-await-in-loop -- each retained parent authority is opened in path order */
      for (const directoryPath of paths) {
        const before = await lstat(directoryPath).catch(() => null);
        if (before === null || !before.isDirectory() || before.isSymbolicLink()) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'cleanup authority parent is not a direct directory',
          );
        }
        let handle: OpenFileHandle;
        try {
          handle = await open(directoryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'cleanup authority parent cannot be opened without following links',
          );
        }
        try {
          const identity = await handle.stat();
          const pathnameIdentity = await lstat(directoryPath).catch(() => null);
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
          directories.push({ path: directoryPath, handle, identity });
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      /* eslint-enable no-await-in-loop */
      return {
        directories,
        parent: directories.at(-1) as VerifiedDirectoryAuthority,
      };
    } catch (error) {
      await this.closeVerifiedDirectoryChain({ directories });
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
    if (process.platform === 'linux') {
      return join('/proc/self/fd', String(directory.handle.fd), name);
    }
    if (process.platform === 'darwin') {
      return join('/dev/fd', String(directory.handle.fd), name);
    }
    if (process.platform === 'win32') return join(directory.path, name);
    throw evidenceError(
      'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
      'cleanup authority cannot perform relative pathname mutation on this platform',
    );
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
  }): void {
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
      return;
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
  }

  private async hasRecognizedRetainedMarkerQuarantine(input: {
    directoryPath: string;
    directoryName: string;
    workspaceId: string;
    expected?: {
      operationId: string;
      artifact: Readonly<ResultArtifactV1>;
    };
  }): Promise<{ bytes: number } | null> {
    const candidates = (await readdir(input.directoryPath, { withFileTypes: true })).filter(
      entry =>
        entry.name.startsWith('.cleanup-intent.v1.json.') && entry.name.endsWith('.retained'),
    );
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
      return { bytes: bytes.byteLength };
    } finally {
      await handle.close();
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

  private async enforceRetainedMarkerCapacity(input: {
    evidenceRoot: string;
    workspaceId: string;
    nextBytes: number;
  }): Promise<void> {
    const limits = this.retainedMarkerLimits();
    let scanned = 0;
    let rows = 0;
    let bytes = 0;
    const stream = await opendir(input.evidenceRoot);
    /* eslint-disable no-await-in-loop -- retained authorities are streamed and verified serially */
    for await (const entry of stream) {
      scanned += 1;
      if (scanned > limits.maxScanEntries) {
        throw evidenceError(
          'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
          'retained cleanup marker scan bound is exhausted',
        );
      }
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/u.test(entry.name)) continue;
      const retained = await this.hasRecognizedRetainedMarkerQuarantine({
        directoryPath: join(input.evidenceRoot, entry.name),
        directoryName: entry.name,
        workspaceId: input.workspaceId,
      });
      if (retained === null) continue;
      rows += 1;
      bytes += retained.bytes;
      if (rows > limits.maxRows || bytes > limits.maxBytes) {
        throw evidenceError(
          'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
          'retained cleanup marker authority is over capacity',
        );
      }
    }
    /* eslint-enable no-await-in-loop */
    if (rows >= limits.maxRows || bytes > limits.maxBytes - input.nextBytes) {
      throw evidenceError(
        'EVIDENCE_RETAINED_MARKER_CAPACITY_EXCEEDED',
        'retained cleanup marker capacity is full; manual cleanup is required',
      );
    }
  }

  private async closeVerifiedDirectoryChain(chain: {
    directories: VerifiedDirectoryAuthority[];
  }): Promise<void> {
    await Promise.all(chain.directories.toReversed().map(directory => directory.handle.close()));
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
      await unlink(quarantine);
      await this.syncDirectoryAuthority(input.directoryChain.parent);
      await this.dependencies.afterArtifactUnlinkFsync?.();
    } finally {
      await input.verified.handle.close();
    }
  }

  private async retainedArtifactQuarantine(input: {
    directoryPath: string;
    artifact: Readonly<ResultArtifactV1>;
  }): Promise<string | null> {
    const candidates = (await readdir(input.directoryPath, { withFileTypes: true })).filter(
      entry =>
        entry.name.startsWith('.result.v1.json.') && entry.name.endsWith('.cleanup-artifact'),
    );
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
    return join(input.directoryPath, candidates[0].name);
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
    return withCanonicalPathMutex(join(evidenceRoot, '.retained-marker-authority'), async () => {
      const fixedArtifactPath = join(operationDirectory, 'result.v1.json');
      const fixedMarkerPath = join(operationDirectory, 'cleanup-intent.v1.json');
      const retained = await this.hasRecognizedRetainedMarkerQuarantine({
        directoryPath: operationDirectory,
        directoryName: basename(operationDirectory),
        workspaceId: input.workspaceId,
        expected: { operationId: input.operationId, artifact: input.artifact },
      });
      const artifactQuarantine = await this.retainedArtifactQuarantine({
        directoryPath: operationDirectory,
        artifact: input.artifact,
      });
      const [fixedMarker, fixedArtifact] = await Promise.all([
        this.lstatMaybe(fixedMarkerPath),
        this.lstatMaybe(fixedArtifactPath),
      ]);
      if (retained !== null) {
        if (fixedMarker !== null || (fixedArtifact !== null && artifactQuarantine !== null)) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'retained cleanup marker contradicts fixed cleanup state',
          );
        }
        if (fixedArtifact === null && artifactQuarantine === null) return;
        const markerRelativePath = cleanupIntentRelativePath(input.operationId);
        const directoryChain = await this.openVerifiedDirectoryChain(
          fixedMarkerPath,
          markerRelativePath,
        );
        try {
          const source = artifactQuarantine ?? fixedArtifactPath;
          const verified = await this.openVerifiedArtifactFile(source, input.artifact);
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
        return;
      }
      if (artifactQuarantine !== null || fixedMarker === null || fixedArtifact === null) {
        throw evidenceError(
          'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          'fresh artifact cleanup state is incomplete or contradictory',
        );
      }
      const marker = await this.openVerifiedCleanupMarker(input);
      try {
        const verified = await this.openVerifiedArtifactFile(fixedArtifactPath, input.artifact);
        try {
          await this.enforceRetainedMarkerCapacity({
            evidenceRoot,
            workspaceId: input.workspaceId,
            nextBytes: marker.expectedBytes.byteLength,
          });
          await this.commitVerifiedCleanupMarker(marker);
          await this.dependencies.afterRetainedMarkerFsync?.();
        } catch (error) {
          await verified.handle.close();
          throw error;
        }
        await this.cleanupVerifiedArtifact({
          fixedPath: fixedArtifactPath,
          verified,
          artifact: input.artifact,
          directoryChain: marker.directoryChain,
          alreadyQuarantined: false,
        });
      } finally {
        try {
          await marker.handle.close();
        } finally {
          await this.closeVerifiedDirectoryChain(marker.directoryChain);
        }
      }
    });
  }

  private async openVerifiedCleanupMarker(input: {
    workspaceId: string;
    operationId: string;
    artifact: Readonly<ResultArtifactV1>;
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
    const directoryChain = await this.openVerifiedDirectoryChain(path, relativePath);
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
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
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
      return { path, handle, identity, expectedBytes: expected, directoryChain };
    } catch (error) {
      await handle.close();
      await this.closeVerifiedDirectoryChain(directoryChain);
      throw error;
    }
  }

  private async commitVerifiedCleanupMarker(marker: VerifiedCleanupMarker): Promise<void> {
    try {
      await this.dependencies.beforeMarkerCleanupCommit?.(marker.path);
      this.dependencies.beforeMarkerQuarantineCommit?.(marker.path);
    } catch {
      throw evidenceError(
        'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
        'cleanup marker parent or pathname replacement was refused',
      );
    }
    this.commitMarkerAuthoritySync({
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
  }): Promise<void> {
    const root = await this.dependencies.workspacePolicy
      .resolveRead(input.workspaceId, workspacePolicyPath('.sfp/operation-evidence'))
      .catch(() => null);
    if (root === null) return;
    /* eslint-disable no-await-in-loop -- each fixed orphan directory is verified before cleanup */
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[0-9a-f]{64}$/u.test(directory.name)) continue;
      const markerPath = join(root, directory.name, 'cleanup-intent.v1.json');
      const markerRelativePath = `.sfp/operation-evidence/${directory.name}/cleanup-intent.v1.json`;
      const directoryChain = await this.openVerifiedDirectoryChain(markerPath, markerRelativePath);
      let retained: { bytes: number } | null = null;
      try {
        retained = await this.hasRecognizedRetainedMarkerQuarantine({
          directoryPath: dirname(markerPath),
          directoryName: directory.name,
          workspaceId: input.workspaceId,
        });
      } catch (error) {
        await this.closeVerifiedDirectoryChain(directoryChain);
        throw error;
      }
      if (retained !== null) {
        const fixedMarker = await lstat(markerPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        await this.closeVerifiedDirectoryChain(directoryChain);
        if (fixedMarker !== null) {
          throw evidenceError(
            'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
            'retained cleanup marker coexists with a fixed marker',
          );
        }
        continue;
      }
      let markerHandle: Awaited<ReturnType<typeof open>>;
      try {
        markerHandle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
        const pathnameIdentity = await lstat(markerPath);
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
        marker = JSON.parse(markerBytes.toString('utf8')) as typeof marker;
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
        dirname(marker.artifact.artifactRelativePath).split('/').at(-1) !== directory.name
      ) {
        await closeMarkerAuthority();
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
        let removed = false;
        try {
          if (await input.hasLinkedEvidence(marker.operationId)) continue;
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
            path: markerPath,
            handle: markerHandle,
            identity: markerIdentity,
            expectedBytes: markerBytes,
            directoryChain,
            pathnameChangedMessage: 'orphan marker pathname changed before cleanup commit',
            replacementMessage: 'replacement marker won the cleanup commit',
          });
          removed = true;
        } finally {
          await closeMarkerAuthority();
        }
        if (!removed) continue;
        continue;
      }
      await closeMarkerAuthority();
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
