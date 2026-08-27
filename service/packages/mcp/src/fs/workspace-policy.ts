import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';

import type { WorkspaceConfigStore, WorkspacePolicy, WorkspaceRoot } from '@sfp/shared';

import { WorkspaceError } from './workspace-config-store.js';

type ResolutionMode = 'read' | 'write';
const WINDOWS_REPARSE_ATTRIBUTE = 0x400;
const WINDOWS_BOUNDARY_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$paths=ConvertFrom-Json $env:SFP_BOUNDARY_PATHS',
  '$records=@()',
  'foreach($path in $paths){$item=Get-Item -LiteralPath $path -Force;$records+=[pscustomobject]@{path=$item.FullName;attributes=[int64]$item.Attributes}}',
  'ConvertTo-Json -InputObject $records -Compress',
].join(';');

export interface WorkspaceBoundaryInspector {
  assertSafe(root: string, paths: readonly string[]): Promise<void>;
}

export interface WorkspacePolicyOptions {
  platform?: NodeJS.Platform;
  boundaryInspector?: WorkspaceBoundaryInspector;
}

export type BoundaryCommandRunner = (
  file: string,
  args: readonly string[],
  options?: { environment?: Readonly<Record<string, string>> },
) => Promise<{ stdout: string; stderr: string }>;

const runBoundaryCommand: BoundaryCommandRunner = (file, args, options) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        env: { ...process.env, ...options?.environment },
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) reject(error);
        else resolvePromise({ stdout, stderr });
      },
    );
  });

const mountInfoPath = (value: string): string =>
  value.replaceAll(/\\([0-7]{3})/gu, (_match, octal: string) =>
    String.fromCodePoint(Number.parseInt(octal, 8)),
  );

export const createLinuxBoundaryInspector = (
  options: {
    readMountInfo?: () => Promise<string>;
  } = {},
): WorkspaceBoundaryInspector => ({
  assertSafe: async (root, paths) => {
    let contents: string;
    try {
      contents = await (
        options.readMountInfo ?? (() => readFile('/proc/self/mountinfo', 'utf8'))
      )();
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_BOUNDARY_UNAVAILABLE',
        'Linux mount boundaries could not be inspected',
        error,
      );
    }
    const mountPoints = new Set<string>();
    for (const line of contents.split('\n').filter(Boolean)) {
      const fields = line.split(' ');
      const separator = fields.indexOf('-');
      if (separator < 6 || fields[4] === undefined) {
        throw new WorkspaceError(
          'WORKSPACE_BOUNDARY_UNAVAILABLE',
          'Linux mountinfo contains a malformed record',
        );
      }
      mountPoints.add(posix.resolve(mountInfoPath(fields[4])));
    }
    const canonicalRoot = posix.resolve(root);
    const nestedMount = paths
      .map(path => posix.resolve(path))
      .find(path => path !== canonicalRoot && mountPoints.has(path));
    if (nestedMount !== undefined) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_REPARSE',
        'workspace path crosses a nested Linux mount or bind point',
      );
    }
  },
});

export const createWindowsBoundaryInspector = (
  command: BoundaryCommandRunner = runBoundaryCommand,
): WorkspaceBoundaryInspector => ({
  assertSafe: async (_root, paths) => {
    let stdout: string;
    try {
      ({ stdout } = await command(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_BOUNDARY_SCRIPT],
        { environment: { SFP_BOUNDARY_PATHS: JSON.stringify(paths) } },
      ));
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_BOUNDARY_UNAVAILABLE',
        'Windows reparse boundaries could not be inspected',
        error,
      );
    }
    let records: unknown;
    try {
      records = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_BOUNDARY_UNAVAILABLE',
        'Windows boundary probe returned malformed JSON',
        error,
      );
    }
    if (!Array.isArray(records) || records.length !== paths.length) {
      throw new WorkspaceError(
        'WORKSPACE_BOUNDARY_UNAVAILABLE',
        'Windows boundary probe returned the wrong record count',
      );
    }
    for (const [index, record] of records.entries()) {
      if (
        typeof record !== 'object' ||
        record === null ||
        typeof (record as { path?: unknown }).path !== 'string' ||
        !Number.isSafeInteger((record as { attributes?: unknown }).attributes)
      ) {
        throw new WorkspaceError(
          'WORKSPACE_BOUNDARY_UNAVAILABLE',
          'Windows boundary probe returned an invalid record',
        );
      }
      const expected = paths[index] as string;
      const observed = record as { path: string; attributes: number };
      if (win32.resolve(observed.path).toLowerCase() !== win32.resolve(expected).toLowerCase()) {
        throw new WorkspaceError(
          'WORKSPACE_BOUNDARY_UNAVAILABLE',
          'Windows boundary probe record does not match the requested path',
        );
      }
      if ((observed.attributes & WINDOWS_REPARSE_ATTRIBUTE) !== 0) {
        throw new WorkspaceError(
          'WORKSPACE_PATH_REPARSE',
          'workspace path crosses a Windows reparse point',
        );
      }
    }
  },
});

const defaultBoundaryInspector = (platform: NodeJS.Platform): WorkspaceBoundaryInspector => {
  if (platform === 'win32') return createWindowsBoundaryInspector();
  if (platform === 'linux') return createLinuxBoundaryInspector();
  if (platform === 'darwin') return { assertSafe: async () => undefined };
  return {
    assertSafe: async () => {
      throw new WorkspaceError(
        'WORKSPACE_BOUNDARY_UNAVAILABLE',
        `workspace boundary inspection is unsupported on ${platform}`,
      );
    },
  };
};

const comparable = (path: string): string =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

const within = (root: string, candidate: string): boolean => {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
  );
};

const invalidInput = (input: string): void => {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new WorkspaceError('WORKSPACE_PATH_INVALID', 'workspace path input is invalid');
  }
  const alternateSeparator = process.platform === 'win32' ? '/' : '\\';
  if (input.includes(alternateSeparator)) {
    throw new WorkspaceError(
      'WORKSPACE_PATH_INVALID',
      'workspace path uses the alternate platform separator',
    );
  }
  if (input.split(sep).some(segment => segment === '..')) {
    throw new WorkspaceError(
      'WORKSPACE_PATH_ESCAPE',
      'workspace path contains a parent traversal segment',
    );
  }
  if (process.platform === 'win32') {
    if (input.startsWith('\\\\?\\') || input.startsWith('\\\\.\\')) {
      throw new WorkspaceError('WORKSPACE_PATH_INVALID', 'Windows device paths are not accepted');
    }
    const withoutDrive = /^[A-Za-z]:/.test(input) ? input.slice(2) : input;
    if (withoutDrive.includes(':')) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'Windows alternate data stream paths are not accepted',
      );
    }
    if (
      withoutDrive
        .split(sep)
        .filter(Boolean)
        .some(segment => segment.endsWith('.') || segment.endsWith(' '))
    ) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'Windows trailing-dot and trailing-space aliases are not accepted',
      );
    }
    const reservedDevice =
      /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/iu;
    if (
      withoutDrive
        .split(sep)
        .filter(Boolean)
        .some(segment => reservedDevice.test(segment))
    ) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'Windows reserved device basenames are not accepted',
      );
    }
  }
};

const configuredWorkspace = async (
  store: Pick<WorkspaceConfigStore, 'list'>,
  workspaceId: string,
): Promise<WorkspaceRoot> => {
  const workspace = (await store.list()).find(entry => entry.workspaceId === workspaceId);
  if (workspace === undefined) {
    throw new WorkspaceError('WORKSPACE_NOT_CONFIGURED', 'workspace is not configured');
  }
  return workspace;
};

const unavailableRoot = (cause?: unknown): WorkspaceError =>
  new WorkspaceError(
    'WORKSPACE_ROOT_UNAVAILABLE',
    'configured workspace root is no longer a stable directory',
    cause,
  );

interface WalkResult {
  existing: boolean;
  canonicalPath?: string;
  finalKind?: 'directory' | 'file';
}

interface WorkspaceRootIdentity {
  device: number;
  inode: number;
  birthtimeMs: number;
}

const workspaceRootIdentity = (metadata: Stats): WorkspaceRootIdentity => ({
  device: metadata.dev,
  inode: metadata.ino,
  birthtimeMs: metadata.birthtimeMs,
});

const sameWorkspaceRootIdentity = (
  left: WorkspaceRootIdentity,
  right: WorkspaceRootIdentity,
): boolean =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.birthtimeMs === right.birthtimeMs;

const walkDescendants = async (
  root: string,
  candidate: string,
  mode: ResolutionMode,
  boundaryInspector: WorkspaceBoundaryInspector,
  assertPersistentRootIdentity: (identity: WorkspaceRootIdentity) => void,
): Promise<WalkResult> => {
  let rootMetadata: Stats;
  let currentRoot: string;
  try {
    rootMetadata = await lstat(root);
    currentRoot = await realpath(root);
  } catch (error) {
    throw unavailableRoot(error);
  }
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    comparable(currentRoot) !== comparable(root)
  ) {
    throw unavailableRoot();
  }
  const identityBefore = workspaceRootIdentity(rootMetadata);
  const finish = async (result: WalkResult): Promise<WalkResult> => {
    let metadataAfter: Stats;
    let canonicalAfter: string;
    try {
      metadataAfter = await lstat(root);
      canonicalAfter = await realpath(root);
    } catch (error) {
      throw unavailableRoot(error);
    }
    const identityAfter = workspaceRootIdentity(metadataAfter);
    if (
      metadataAfter.isSymbolicLink() ||
      !metadataAfter.isDirectory() ||
      comparable(canonicalAfter) !== comparable(root) ||
      !sameWorkspaceRootIdentity(identityBefore, identityAfter)
    ) {
      throw unavailableRoot();
    }
    assertPersistentRootIdentity(identityAfter);
    return result;
  };
  const rootDevice = (await stat(root)).dev;
  const descendant = relative(root, candidate);
  const segments = descendant === '' ? [] : descendant.split(sep);
  const existingPaths: string[] = [];
  const observedIdentities = new Map<string, WorkspaceRootIdentity>();
  const observedPathKeys = new Set<string>();
  const addObservedPath = (path: string, metadata: Stats): void => {
    const key = comparable(path);
    if (observedPathKeys.has(key)) return;
    observedPathKeys.add(key);
    existingPaths.push(path);
    observedIdentities.set(path, workspaceRootIdentity(metadata));
  };
  addObservedPath(root, rootMetadata);
  const assertBoundarySafe = async (): Promise<void> => {
    await boundaryInspector.assertSafe(root, existingPaths);
    const identitiesAfter = await Promise.all(
      existingPaths.map(async path => {
        try {
          return [path, workspaceRootIdentity(await lstat(path))] as const;
        } catch (error) {
          throw new WorkspaceError(
            'WORKSPACE_PATH_REPARSE',
            'workspace path changed during boundary inspection',
            error,
          );
        }
      }),
    );
    for (const [path, identityAfter] of identitiesAfter) {
      const identityObserved = observedIdentities.get(path);
      if (
        identityObserved === undefined ||
        !sameWorkspaceRootIdentity(identityObserved, identityAfter)
      ) {
        throw new WorkspaceError(
          'WORKSPACE_PATH_REPARSE',
          'workspace path identity changed during boundary inspection',
        );
      }
    }
  };
  let current = root;
  let lastCanonicalPath = currentRoot;
  let finalKind: 'directory' | 'file' | undefined = 'directory';
  let previousWasDirectory = true;
  /* eslint-disable no-await-in-loop -- each component establishes whether the next may be inspected */
  for (const segment of segments) {
    if (!previousWasDirectory) {
      if (mode === 'read') {
        await assertBoundarySafe();
        return finish({ existing: false });
      }
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'a workspace output parent is not a directory',
      );
    }
    current = join(current, segment);
    let metadata: Stats;
    try {
      metadata = await lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        await assertBoundarySafe();
        return finish({ existing: false });
      }
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace descendant cannot be inspected',
        error,
      );
    }
    addObservedPath(current, metadata);
    if (mode === 'write' && metadata.isSymbolicLink()) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_REPARSE',
        'workspace output traverses a symbolic link or junction',
      );
    }
    let canonicalPath: string;
    let followed: Awaited<ReturnType<typeof stat>>;
    try {
      canonicalPath = await realpath(current);
      followed = await stat(current);
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace descendant cannot be resolved',
        error,
      );
    }
    if (!within(root, canonicalPath)) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_ESCAPE',
        'workspace descendant resolves outside its approved root',
      );
    }
    addObservedPath(canonicalPath, followed);
    if (followed.dev !== rootDevice) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_REPARSE',
        'workspace descendant crosses a mount or reparse boundary',
      );
    }
    if (mode === 'write' && comparable(canonicalPath) !== comparable(current)) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_REPARSE',
        'workspace output traverses a redirected filesystem object',
      );
    }
    lastCanonicalPath = canonicalPath;
    finalKind = followed.isDirectory() ? 'directory' : followed.isFile() ? 'file' : undefined;
    previousWasDirectory = followed.isDirectory();
  }
  /* eslint-enable no-await-in-loop */
  await assertBoundarySafe();
  return finish({
    existing: true,
    canonicalPath: lastCanonicalPath,
    ...(finalKind === undefined ? {} : { finalKind }),
  });
};

export const createWorkspacePolicy = (
  store: Pick<WorkspaceConfigStore, 'list'>,
  options: WorkspacePolicyOptions = {},
): WorkspacePolicy => {
  const boundaryInspector =
    options.boundaryInspector ?? defaultBoundaryInspector(options.platform ?? process.platform);
  const rootIdentities = new Map<string, WorkspaceRootIdentity>();
  const identityGuard =
    (workspaceId: string) =>
    (identity: WorkspaceRootIdentity): void => {
      const existing = rootIdentities.get(workspaceId);
      if (existing !== undefined && !sameWorkspaceRootIdentity(existing, identity)) {
        throw unavailableRoot();
      }
      rootIdentities.set(workspaceId, identity);
    };
  const prepare = async (
    workspaceId: string,
    input: string,
  ): Promise<{ root: string; candidate: string }> => {
    invalidInput(input);
    const workspace = await configuredWorkspace(store, workspaceId);
    const root = resolve(workspace.realPath);
    const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
    if (!within(root, candidate)) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_ESCAPE',
        'workspace path is outside its approved root',
      );
    }
    return { root, candidate };
  };

  const resolveWrite = async (
    workspaceId: string,
    input: string,
  ): Promise<{ path: string; overwrites: boolean }> => {
    const { root, candidate } = await prepare(workspaceId, input);
    if (comparable(root) === comparable(candidate)) {
      await walkDescendants(root, candidate, 'read', boundaryInspector, identityGuard(workspaceId));
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace root itself is not a writable output path',
      );
    }
    const walked = await walkDescendants(
      root,
      candidate,
      'write',
      boundaryInspector,
      identityGuard(workspaceId),
    );
    if (walked.existing && walked.finalKind !== 'file') {
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace overwrite target must be a regular file',
      );
    }
    return walked.existing
      ? { path: walked.canonicalPath as string, overwrites: true }
      : { path: candidate, overwrites: false };
  };

  return Object.freeze({
    resolveRead: async (workspaceId: string, input: string): Promise<string> => {
      const { root, candidate } = await prepare(workspaceId, input);
      const walked = await walkDescendants(
        root,
        candidate,
        'read',
        boundaryInspector,
        identityGuard(workspaceId),
      );
      if (!walked.existing) {
        throw new WorkspaceError(
          'WORKSPACE_PATH_NOT_FOUND',
          'workspace read target does not exist',
        );
      }
      return walked.canonicalPath as string;
    },
    resolveWrite,
    assertWithinRoot: async (workspaceId: string, path: string): Promise<void> => {
      const { root, candidate } = await prepare(workspaceId, path);
      const existing = await walkDescendants(
        root,
        candidate,
        'read',
        boundaryInspector,
        identityGuard(workspaceId),
      );
      if (!existing.existing) {
        await walkDescendants(
          root,
          candidate,
          'write',
          boundaryInspector,
          identityGuard(workspaceId),
        );
      }
    },
  });
};
