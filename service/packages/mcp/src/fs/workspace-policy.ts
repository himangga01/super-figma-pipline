import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { WorkspaceConfigStore, WorkspacePolicy, WorkspaceRoot } from '@sfp/shared';

import { WorkspaceError } from './workspace-config-store.js';

type ResolutionMode = 'read' | 'write';

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
}

const walkDescendants = async (
  root: string,
  candidate: string,
  mode: ResolutionMode,
): Promise<WalkResult> => {
  let rootMetadata: Awaited<ReturnType<typeof lstat>>;
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
  const rootDevice = (await stat(root)).dev;
  const descendant = relative(root, candidate);
  const segments = descendant === '' ? [] : descendant.split(sep);
  let current = root;
  let lastCanonicalPath = currentRoot;
  let previousWasDirectory = true;
  /* eslint-disable no-await-in-loop -- each component establishes whether the next may be inspected */
  for (const segment of segments) {
    if (!previousWasDirectory) {
      if (mode === 'read') return { existing: false };
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'a workspace output parent is not a directory',
      );
    }
    current = join(current, segment);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { existing: false };
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace descendant cannot be inspected',
        error,
      );
    }
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
    previousWasDirectory = followed.isDirectory();
  }
  /* eslint-enable no-await-in-loop */
  return { existing: true, canonicalPath: lastCanonicalPath };
};

export const createWorkspacePolicy = (
  store: Pick<WorkspaceConfigStore, 'list'>,
): WorkspacePolicy => {
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
      throw new WorkspaceError(
        'WORKSPACE_PATH_INVALID',
        'workspace root itself is not a writable output path',
      );
    }
    const walked = await walkDescendants(root, candidate, 'write');
    return walked.existing
      ? { path: walked.canonicalPath as string, overwrites: true }
      : { path: candidate, overwrites: false };
  };

  return Object.freeze({
    resolveRead: async (workspaceId: string, input: string): Promise<string> => {
      const { root, candidate } = await prepare(workspaceId, input);
      const walked = await walkDescendants(root, candidate, 'read');
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
      if (comparable(root) === comparable(candidate)) return;
      const existing = await walkDescendants(root, candidate, 'read');
      if (!existing.existing) await walkDescendants(root, candidate, 'write');
    },
  });
};
