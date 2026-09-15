import type { Stats } from 'node:fs';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { PortalSourceInventory, WorkspacePolicy } from '@sfp/shared';
import ignore, { type Ignore } from 'ignore';

import { IGNORED_DIRS } from '../ignored-dirs.js';
import { isPortableSourcePath, portalSourceExclusion } from '../portal/source-path-policy.js';
import { readFileWithinLimit, withRetainedDirectoryAuthority } from './atomic-file.js';

const DEFAULT_CAP = 5_000;
const DEFAULT_MAX_FILE_BYTES = 8_388_608;
const DEFAULT_MAX_SCAN_ENTRIES = 20_000;
const DEFAULT_MAX_PARSE_RESULTS = 20_000;

const repoError = (code: string, message: string, cause?: unknown): Error & { code: string } =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const sameIdentity = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean => left.dev === right.dev && left.ino === right.ino;

const inside = (root: string, candidate: string): boolean => {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
  );
};

const portableToNative = (path: string): string => path.replaceAll('/', sep);

export interface WalkOptions {
  /** Complete source discovery under fixed service policy; rejects semantic filters/subroots. */
  mode?: 'semantic' | 'portal-source-authority';
  /** Only yield files with these extensions (leading dot optional). Omitted means every file. */
  extensions?: readonly string[];
  /** Terminal cap on returned paths. Default 5000. */
  cap?: number;
  /** Bound across materialized root and child directory entries. */
  maxScanEntries?: number;
  /** Optional repo-relative roots; used for explicitly approved generated-output probes. */
  startDirectories?: readonly string[];
}

export interface RepoWalkResult {
  files: readonly string[];
  scanned: number;
  skipped: number;
  truncated: boolean;
  exclusions?: PortalSourceInventory['exclusions'];
  issues?: PortalSourceInventory['issues'];
}

export interface RepoFileMetadata {
  size: number;
  mtimeMs: number;
}

export interface RepoReaderOptions {
  rootDir: string;
  workspaceId?: string;
  workspacePolicy?: WorkspacePolicy;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxParseResults?: number;
  signal?: AbortSignal;
  beforeFileOpen?: (path: string) => Promise<void>;
  afterFileOpen?: (path: string) => Promise<void>;
  beforeDirectoryOpen?: (relativePath: string) => Promise<void>;
  afterDirectoryOpen?: (relativePath: string) => Promise<void>;
}

/**
 * Root-bound project reader. Every read revalidates the root, every path is portable and relative,
 * and no symbolic-link, junction, reparse, mount, hardlink, or outside-root alias is followed.
 */
export class RepoReader {
  readonly rootDir: string;
  private readonly workspaceId: string | undefined;
  private readonly workspacePolicy: WorkspacePolicy | undefined;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly configuredMaxFileBytes: number | undefined;
  private readonly configuredMaxTotalBytes: number | undefined;
  private readonly maxParseResults: number;
  private readonly signal: AbortSignal | undefined;
  private readonly beforeFileOpen: ((path: string) => Promise<void>) | undefined;
  private readonly afterFileOpen: ((path: string) => Promise<void>) | undefined;
  private readonly beforeDirectoryOpen: ((relativePath: string) => Promise<void>) | undefined;
  private readonly afterDirectoryOpen: ((relativePath: string) => Promise<void>) | undefined;
  private rootIdentity: { dev: number | bigint; ino: number | bigint } | null = null;
  private totalBytes = 0;
  private parseResults = 0;
  private readTail: Promise<void> = Promise.resolve();

  constructor(options: RepoReaderOptions) {
    this.rootDir = resolve(options.rootDir);
    this.workspaceId = options.workspaceId;
    this.workspacePolicy = options.workspacePolicy;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? 67_108_864;
    this.configuredMaxFileBytes = options.maxFileBytes;
    this.configuredMaxTotalBytes = options.maxTotalBytes;
    this.maxParseResults = options.maxParseResults ?? DEFAULT_MAX_PARSE_RESULTS;
    this.signal = options.signal;
    this.beforeFileOpen = options.beforeFileOpen;
    this.afterFileOpen = options.afterFileOpen;
    this.beforeDirectoryOpen = options.beforeDirectoryOpen;
    this.afterDirectoryOpen = options.afterDirectoryOpen;
    if (
      !Number.isSafeInteger(this.maxFileBytes) ||
      this.maxFileBytes < 1 ||
      !Number.isSafeInteger(this.maxTotalBytes) ||
      this.maxTotalBytes < 1 ||
      !Number.isSafeInteger(this.maxParseResults) ||
      this.maxParseResults < 1
    ) {
      throw repoError('REPO_TOTAL_BYTES_INVALID', 'repo operation budgets are invalid');
    }
    if ((this.workspaceId === undefined) !== (this.workspacePolicy === undefined)) {
      throw repoError(
        'PATH_OUTSIDE_WORKSPACE',
        'workspaceId and WorkspacePolicy must be supplied together',
      );
    }
  }

  private async withReadTurn<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.readTail;
    let release!: () => void;
    this.readTail = new Promise<void>(resolveRelease => {
      release = resolveRelease;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  chargeParseResults(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw repoError('REPO_PARSE_RESULT_LIMIT_INVALID', 'repo parse-result charge is invalid');
    }
    if (count > this.maxParseResults - this.parseResults) {
      throw repoError(
        'REPO_PARSE_RESULT_LIMIT_EXCEEDED',
        'repo operation parse-result budget is exhausted',
      );
    }
    this.parseResults += count;
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted !== true) return;
    throw Object.assign(new Error('repo operation was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  }

  /** Derive a bounded child reader only after the parent verifies its complete directory chain. */
  async subdirectory(path: string): Promise<RepoReader> {
    if (path === '.') return this;
    this.throwIfAborted();
    const child = await this.resolveExisting(path, 'directory');
    return new RepoReader({
      rootDir: child.path,
      maxFileBytes: this.maxFileBytes,
      maxTotalBytes: Math.min(8_388_608, Math.max(1, this.maxTotalBytes - this.totalBytes)),
      maxParseResults: this.maxParseResults,
      ...(this.workspaceId === undefined ? {} : { workspaceId: this.workspaceId }),
      ...(this.workspacePolicy === undefined ? {} : { workspacePolicy: this.workspacePolicy }),
      ...(this.signal === undefined ? {} : { signal: this.signal }),
      beforeFileOpen: async () => {
        await this.rootAuthority();
        await this.resolveExisting(path, 'directory');
      },
    });
  }

  private validateRelativePath(input: string): string {
    if (
      typeof input !== 'string' ||
      input.length === 0 ||
      input.includes('\0') ||
      isAbsolute(input) ||
      input.includes('\\')
    ) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path must be one portable relative path');
    }
    const segments = input.split('/');
    if (segments.some(segment => segment === '..' || segment === '' || segment === '.')) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path escapes or aliases its workspace root');
    }
    return segments.join('/');
  }

  private async rootAuthority(): Promise<Stats> {
    this.throwIfAborted();
    let metadata: Stats;
    let canonical: string;
    try {
      [metadata, canonical] = await Promise.all([lstat(this.rootDir), realpath(this.rootDir)]);
    } catch (cause) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo root is unavailable', cause);
    }
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      resolve(canonical) !== this.rootDir
    ) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo root is redirected or not a directory');
    }
    if (this.rootIdentity !== null && !sameIdentity(this.rootIdentity, metadata)) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo root identity changed');
    }
    this.rootIdentity = { dev: metadata.dev, ino: metadata.ino };
    if (this.workspacePolicy !== undefined && this.workspaceId !== undefined) {
      try {
        await this.workspacePolicy.assertWithinRoot(this.workspaceId, this.rootDir);
      } catch (cause) {
        throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo root lost workspace authority', cause);
      }
    }
    return metadata;
  }

  private async resolveExisting(
    portablePath: string,
    kind: 'file' | 'directory',
  ): Promise<{ path: string; metadata: Stats }> {
    const relativePath = this.validateRelativePath(portablePath);
    this.throwIfAborted();
    const rootMetadata = await this.rootAuthority();
    const candidate = resolve(this.rootDir, portableToNative(relativePath));
    if (!inside(this.rootDir, candidate)) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path resolves outside its workspace root');
    }
    if (this.workspacePolicy !== undefined && this.workspaceId !== undefined) {
      try {
        const resolved = await this.workspacePolicy.resolveRead(this.workspaceId, candidate);
        if (resolve(resolved) !== candidate) {
          throw repoError('PATH_OUTSIDE_WORKSPACE', 'workspace policy resolved a path alias');
        }
      } catch (cause) {
        const code = (cause as { code?: unknown }).code;
        if (code === 'WORKSPACE_PATH_NOT_FOUND') {
          throw repoError('REPO_FILE_NOT_FOUND', 'repo path does not exist', cause);
        }
        if (code === 'PATH_OUTSIDE_WORKSPACE') throw cause;
        throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path failed workspace policy', cause);
      }
    }
    let current = this.rootDir;
    let finalMetadata = rootMetadata;
    /* eslint-disable no-await-in-loop -- each component must be proven before its child is opened */
    for (const segment of relativePath.split('/')) {
      this.throwIfAborted();
      current = join(current, segment);
      try {
        finalMetadata = await lstat(current);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
          throw repoError('REPO_FILE_NOT_FOUND', 'repo path does not exist', cause);
        }
        throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path cannot be inspected', cause);
      }
      if (finalMetadata.isSymbolicLink() || finalMetadata.dev !== rootMetadata.dev) {
        throw repoError(
          'PATH_OUTSIDE_WORKSPACE',
          'repo path crosses a link or filesystem boundary',
        );
      }
      if (current !== candidate && !finalMetadata.isDirectory()) {
        throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path parent is not a directory');
      }
    }
    /* eslint-enable no-await-in-loop */
    const canonical = await realpath(candidate).catch(cause => {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path cannot be canonicalized', cause);
    });
    if (resolve(canonical) !== candidate || !inside(this.rootDir, canonical)) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo path is redirected outside its authority');
    }
    if (
      (kind === 'file' &&
        (!finalMetadata.isFile() || finalMetadata.isSymbolicLink() || finalMetadata.nlink !== 1)) ||
      (kind === 'directory' && (!finalMetadata.isDirectory() || finalMetadata.isSymbolicLink()))
    ) {
      throw repoError('PATH_OUTSIDE_WORKSPACE', `repo path is not one safe ${kind}`);
    }
    await this.rootAuthority();
    return { path: candidate, metadata: finalMetadata };
  }

  async readBytes(relativePath: string, maxBytes = this.maxFileBytes): Promise<Buffer> {
    return this.withReadTurn(async () => {
      this.throwIfAborted();
      const resolved = await this.resolveExisting(relativePath, 'file');
      const remaining = this.maxTotalBytes - this.totalBytes;
      if (resolved.metadata.size > remaining) {
        throw Object.assign(new Error('repo operation total-byte budget is exhausted'), {
          code: 'REPO_TOTAL_BYTES_EXCEEDED',
          beforeRead: true,
        });
      }
      const boundedMax = Math.min(maxBytes, remaining);
      try {
        await this.beforeFileOpen?.(resolved.path);
        this.throwIfAborted();
        const bytes = await readFileWithinLimit(resolved.path, boundedMax, undefined, {
          expectedIdentity: resolved.metadata,
          ...(this.signal === undefined ? {} : { signal: this.signal }),
          ...(this.afterFileOpen === undefined
            ? {}
            : { beforeRead: () => this.afterFileOpen!(resolved.path) }),
        });
        this.totalBytes += bytes.byteLength;
        await this.resolveExisting(relativePath, 'file');
        this.throwIfAborted();
        return bytes;
      } catch (cause) {
        const code = String((cause as { code?: unknown }).code);
        const bytesRead = (cause as { bytesRead?: unknown }).bytesRead;
        if (Number.isSafeInteger(bytesRead) && (bytesRead as number) > 0) {
          this.totalBytes += Math.min(bytesRead as number, remaining);
        }
        if (code === 'ABORT_ERR' || code === 'REPO_FILE_NOT_FOUND') throw cause;
        if (code === 'FILE_SIZE_LIMIT_EXCEEDED') {
          if (boundedMax === remaining && remaining <= maxBytes) {
            throw Object.assign(new Error('repo operation total-byte budget is exhausted'), {
              code: 'REPO_TOTAL_BYTES_EXCEEDED',
              beforeRead: (cause as { beforeRead?: unknown }).beforeRead === true,
            });
          }
          throw cause;
        }
        throw repoError('PATH_OUTSIDE_WORKSPACE', 'repo file identity changed during read', cause);
      }
    });
  }

  async readText(relativePath: string, maxBytes = this.maxFileBytes): Promise<string> {
    return (await this.readBytes(relativePath, maxBytes)).toString('utf8');
  }

  /** Independent bounded accounting while retaining this reader's root identity and read guards. */
  async withByteBudget(limits: {
    maxFileBytes: number;
    maxTotalBytes: number;
  }): Promise<RepoReader> {
    await this.rootAuthority();
    const child = new RepoReader({
      rootDir: this.rootDir,
      maxFileBytes: Math.min(
        limits.maxFileBytes,
        this.configuredMaxFileBytes ?? limits.maxFileBytes,
      ),
      maxTotalBytes: Math.min(
        limits.maxTotalBytes,
        this.configuredMaxTotalBytes ?? limits.maxTotalBytes,
      ),
      maxParseResults: this.maxParseResults,
      ...(this.workspaceId === undefined ? {} : { workspaceId: this.workspaceId }),
      ...(this.workspacePolicy === undefined ? {} : { workspacePolicy: this.workspacePolicy }),
      ...(this.signal === undefined ? {} : { signal: this.signal }),
      beforeFileOpen: async path => {
        await this.rootAuthority();
        await this.beforeFileOpen?.(path);
      },
      ...(this.afterFileOpen === undefined ? {} : { afterFileOpen: this.afterFileOpen }),
      beforeDirectoryOpen: async path => {
        await this.rootAuthority();
        await this.beforeDirectoryOpen?.(path);
      },
      ...(this.afterDirectoryOpen === undefined
        ? {}
        : { afterDirectoryOpen: this.afterDirectoryOpen }),
    });
    child.rootIdentity = this.rootIdentity;
    return child;
  }

  get byteLimits(): Readonly<{ maxFileBytes: number; maxTotalBytes: number }> {
    return { maxFileBytes: this.maxFileBytes, maxTotalBytes: this.maxTotalBytes };
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await this.resolveExisting(relativePath, 'file');
      return true;
    } catch (cause) {
      if ((cause as { code?: unknown }).code === 'REPO_FILE_NOT_FOUND') return false;
      throw cause;
    }
  }

  async metadata(relativePath: string): Promise<RepoFileMetadata> {
    const { metadata } = await this.resolveExisting(relativePath, 'file');
    return Object.freeze({ size: metadata.size, mtimeMs: metadata.mtimeMs });
  }

  private async ignoreMatcher(): Promise<Ignore> {
    const matcher = ignore();
    const paths = ['.gitignore'];
    await this.rootAuthority();
    const git = await lstat(join(this.rootDir, '.git')).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    });
    if (git !== null) {
      // Worktrees/submodules store a gitdir pointer in a regular file. Never follow it outside
      // this workspace; the workspace's own .gitignore remains authoritative for this scan.
      await this.resolveExisting('.git', git.isDirectory() ? 'directory' : 'file');
      if (git.isDirectory()) paths.push('.git/info/exclude');
    }
    for (const path of paths) {
      try {
        // eslint-disable-next-line no-await-in-loop -- two fixed bounded reads
        matcher.add(await this.readText(path, 1_048_576));
      } catch (cause) {
        if ((cause as { code?: unknown }).code !== 'REPO_FILE_NOT_FOUND') throw cause;
      }
    }
    return matcher;
  }

  async walk(options: WalkOptions = {}): Promise<Readonly<RepoWalkResult>> {
    this.throwIfAborted();
    const authorityMode = options.mode === 'portal-source-authority';
    if (
      authorityMode &&
      (options.extensions !== undefined || options.startDirectories !== undefined)
    ) {
      throw repoError(
        'REPO_AUTHORITY_FILTER_INVALID',
        'authority discovery cannot use semantic filters',
      );
    }
    const cap = options.cap ?? DEFAULT_CAP;
    const maxScanEntries = options.maxScanEntries ?? DEFAULT_MAX_SCAN_ENTRIES;
    if (
      !Number.isSafeInteger(cap) ||
      cap < 1 ||
      !Number.isSafeInteger(maxScanEntries) ||
      maxScanEntries < 1
    ) {
      throw repoError('REPO_SCAN_LIMIT_INVALID', 'repo scan limits are invalid');
    }
    await this.rootAuthority();
    const matcher = authorityMode ? undefined : await this.ignoreMatcher();
    const extensions = options.extensions?.map(extension =>
      extension.startsWith('.') ? extension : `.${extension}`,
    );
    const directories =
      options.startDirectories === undefined
        ? ['']
        : options.startDirectories.map(path => this.validateRelativePath(path));
    if (directories.length === 0) {
      return Object.freeze({ files: Object.freeze([]), scanned: 0, skipped: 0, truncated: false });
    }
    const matches: string[] = [];
    const exclusions: PortalSourceInventory['exclusions'] = [];
    const issues: PortalSourceInventory['issues'] = [];
    const canonicalPaths = new Set<string>();
    let scanned = 0;
    let skipped = 0;
    let truncated = false;
    let currentDirectory = '';
    /* eslint-disable no-await-in-loop -- bounded breadth-first traversal preserves deterministic authority */
    try {
      scan: for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex += 1) {
        this.throwIfAborted();
        const relativeDirectory = directories[directoryIndex] as string;
        currentDirectory = relativeDirectory;
        const resolvedDirectory =
          relativeDirectory === ''
            ? { path: this.rootDir, metadata: await this.rootAuthority() }
            : await this.resolveExisting(relativeDirectory, 'directory');
        await this.beforeDirectoryOpen?.(relativeDirectory);
        this.throwIfAborted();
        const absoluteDirectory = resolvedDirectory.path;
        const entries = [] as Array<{
          name: string;
          directory: boolean;
          file: boolean;
          link: boolean;
        }>;
        let scanCapacityReached = false;
        await withRetainedDirectoryAuthority(
          absoluteDirectory,
          resolvedDirectory.metadata,
          async authority => {
            const stream = await opendir(authority.path, { bufferSize: 1 });
            for await (const entry of stream) {
              this.throwIfAborted();
              if (scanned >= maxScanEntries) {
                truncated = true;
                scanCapacityReached = true;
                break;
              }
              scanned += 1;
              entries.push({
                name: entry.name,
                directory: entry.isDirectory(),
                file: entry.isFile(),
                link: entry.isSymbolicLink(),
              });
            }
            await authority.verify();
          },
          {
            ...(this.afterDirectoryOpen === undefined
              ? {}
              : { afterOpen: () => this.afterDirectoryOpen!(relativeDirectory) }),
            errorCode: 'PATH_OUTSIDE_WORKSPACE',
          },
        );
        if (scanCapacityReached) break scan;
        entries.sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
        for (const entry of entries) {
          const path = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
          if (authorityMode) {
            if (!isPortableSourcePath(path)) {
              issues.push({ code: 'REPO_SOURCE_PATH_UNSAFE' });
              break scan;
            }
            const canonicalPath = path.toLowerCase();
            if (canonicalPaths.has(canonicalPath)) {
              issues.push({ code: 'REPO_SOURCE_PATH_COLLISION', path });
              break scan;
            }
            canonicalPaths.add(canonicalPath);
            const reason = portalSourceExclusion(path);
            if (reason !== undefined) {
              exclusions.push({
                path,
                reason,
                kind: entry.link
                  ? 'link'
                  : entry.directory
                    ? 'directory'
                    : entry.file
                      ? 'file'
                      : 'other',
              });
              skipped += 1;
              continue;
            }
            if (entry.link || (!entry.directory && !entry.file)) {
              issues.push({ code: 'REPO_SOURCE_ENTRY_UNSUPPORTED', path });
              break scan;
            }
          }
          if (entry.link) {
            skipped += 1;
            continue;
          }
          if (entry.directory) {
            if (!authorityMode && (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)))
              skipped += 1;
            else directories.push(path);
            continue;
          }
          if (!entry.file || (!authorityMode && entry.name.startsWith('.'))) {
            skipped += 1;
            continue;
          }
          if (
            extensions !== undefined &&
            !extensions.some(extension => entry.name.endsWith(extension))
          ) {
            skipped += 1;
            continue;
          }
          if (matcher?.ignores(path)) {
            skipped += 1;
            continue;
          }
          matches.push(path);
          if (matches.length > cap) {
            truncated = true;
            break scan;
          }
        }
      }
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (!authorityMode || code === 'ABORT_ERR') throw cause;
      issues.push({
        code:
          typeof code === 'string' && code.length > 0
            ? code.slice(0, 128)
            : 'REPO_SOURCE_DISCOVERY_FAILED',
        ...(currentDirectory !== '' && isPortableSourcePath(currentDirectory)
          ? { path: currentDirectory }
          : {}),
      });
    }
    /* eslint-enable no-await-in-loop */
    const files = matches.toSorted(byDepthThenPath).slice(0, cap);
    return Object.freeze({
      files: Object.freeze(files),
      scanned,
      skipped,
      truncated,
      ...(authorityMode ? { exclusions, issues } : {}),
    });
  }
}

/**
 * Back-compatible generator over the root-bound sandbox. New callers consume RepoReader.walk.
 *
 * @yields Portable repo-relative files in deterministic depth/path order.
 */
export async function* walkRepoFiles(
  rootDir: string,
  options: WalkOptions = {},
): AsyncGenerator<string> {
  const result = await new RepoReader({ rootDir }).walk(options);
  yield* result.files;
}

const byDepthThenPath = (left: string, right: string): number => {
  const byDepth = pathDepth(left) - pathDepth(right);
  if (byDepth !== 0) return byDepth;
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

const pathDepth = (path: string): number => {
  let depth = 0;
  for (const character of path) if (character === '/') depth += 1;
  return depth;
};
