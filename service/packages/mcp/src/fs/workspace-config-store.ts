import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { chmod, lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import type { WorkspaceConfigStore, WorkspaceRoot, WorkspaceUsageGuard } from '@sfp/shared';

import type { BoundStatePermissions, SecurePathIdentity } from '../security/state-permissions.js';
import { StatePermissionError } from '../security/state-permissions.js';

const CONFIG_VERSION = 1;
const CONFIG_FILENAME = 'workspaces.v1.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface StateMutationQueue {
  tail: Promise<void>;
}

const stateMutationQueues = new Map<string, StateMutationQueue>();

export type WorkspaceErrorCode =
  | 'COMMIT_OUTCOME_UNKNOWN'
  | 'STATE_WORKSPACE_OVERLAP'
  | 'WORKSPACE_ALREADY_CONFIGURED'
  | 'WORKSPACE_AUTH_REQUIRED'
  | 'WORKSPACE_BOUNDARY_UNAVAILABLE'
  | 'WORKSPACE_CONFIG_INVALID'
  | 'WORKSPACE_CONFIG_WRITE_FAILED'
  | 'WORKSPACE_DIRECTORY_REQUIRED'
  | 'WORKSPACE_IN_USE'
  | 'WORKSPACE_NOT_CONFIGURED'
  | 'WORKSPACE_PATH_ESCAPE'
  | 'WORKSPACE_PATH_INVALID'
  | 'WORKSPACE_PATH_NOT_FOUND'
  | 'WORKSPACE_PATH_REPARSE'
  | 'WORKSPACE_ROOT_UNAVAILABLE'
  | 'WORKSPACE_USAGE_CHECK_FAILED';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

export class WorkspaceCommitOutcomeUnknownError extends WorkspaceError {
  readonly committed: boolean;

  constructor(committed: boolean, cause: unknown) {
    super(
      'COMMIT_OUTCOME_UNKNOWN',
      'workspace config rename completed but durability could not be confirmed',
      cause,
    );
    this.name = 'WorkspaceCommitOutcomeUnknownError';
    this.committed = committed;
  }
}

export interface WorkspaceConfigDurability {
  setPrivateFileMode(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

interface WorkspaceConfigPayload {
  version: 1;
  workspaces: WorkspaceRoot[];
}

interface WorkspaceConfigEnvelope extends WorkspaceConfigPayload {
  checksum: string;
}

export const workspaceConfigPath = (stateRoot: string): string =>
  join(resolve(stateRoot), CONFIG_FILENAME);

const normalizedForComparison = (path: string): string =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

const contains = (root: string, candidate: string): boolean => {
  const fromRoot = relative(normalizedForComparison(root), normalizedForComparison(candidate));
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
  );
};

const pathsOverlap = (left: string, right: string): boolean =>
  contains(left, right) || contains(right, left);

const checksumFor = (payload: WorkspaceConfigPayload): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const workspaceFromUnknown = (value: unknown): WorkspaceRoot | undefined => {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value).toSorted();
  if (JSON.stringify(keys) !== JSON.stringify(['addedAt', 'path', 'realPath', 'workspaceId'])) {
    return undefined;
  }
  const { workspaceId, path, realPath: canonicalPath, addedAt } = value;
  if (
    typeof workspaceId !== 'string' ||
    workspaceId.trim() === '' ||
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    typeof canonicalPath !== 'string' ||
    !isAbsolute(canonicalPath) ||
    typeof addedAt !== 'string' ||
    Number.isNaN(Date.parse(addedAt)) ||
    new Date(addedAt).toISOString() !== addedAt
  ) {
    return undefined;
  }
  return { workspaceId, path, realPath: canonicalPath, addedAt };
};

const configFromUnknown = (value: unknown): WorkspaceConfigEnvelope | undefined => {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value).toSorted();
  if (JSON.stringify(keys) !== JSON.stringify(['checksum', 'version', 'workspaces'])) {
    return undefined;
  }
  if (
    value.version !== CONFIG_VERSION ||
    !Array.isArray(value.workspaces) ||
    typeof value.checksum !== 'string' ||
    !SHA256_PATTERN.test(value.checksum)
  ) {
    return undefined;
  }
  const workspaces = value.workspaces.map(workspaceFromUnknown);
  if (workspaces.some(workspace => workspace === undefined)) return undefined;
  const parsed = workspaces as WorkspaceRoot[];
  const ids = new Set<string>();
  const realPaths = new Set<string>();
  for (const workspace of parsed) {
    const comparablePath = normalizedForComparison(workspace.realPath);
    if (ids.has(workspace.workspaceId) || realPaths.has(comparablePath)) return undefined;
    ids.add(workspace.workspaceId);
    realPaths.add(comparablePath);
  }
  return { version: CONFIG_VERSION, workspaces: parsed, checksum: value.checksum };
};

const authenticatedActor = (actorId: string): void => {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new WorkspaceError(
      'WORKSPACE_AUTH_REQUIRED',
      'workspace configuration requires an authenticated explicit action',
    );
  }
};

const safeStateRoot = (input: string): string => {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new WorkspaceError('WORKSPACE_CONFIG_INVALID', 'state root must be a non-empty path');
  }
  const stateRoot = resolve(input);
  if (stateRoot === parse(stateRoot).root) {
    throw new WorkspaceError(
      'WORKSPACE_CONFIG_INVALID',
      'workspace config cannot use a filesystem root as owner state',
    );
  }
  return stateRoot;
};

const immutableWorkspace = (workspace: WorkspaceRoot): WorkspaceRoot =>
  Object.freeze({ ...workspace });

const workspaceRecord = (workspace: WorkspaceRoot): WorkspaceRoot => ({
  workspaceId: workspace.workspaceId,
  path: workspace.path,
  realPath: workspace.realPath,
  addedAt: workspace.addedAt,
});

const handleIdentityKey = (metadata: BigIntStats): string =>
  `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;

export const createWorkspaceConfigStore = (
  stateRootInput: string,
  usageGuard: WorkspaceUsageGuard,
  permissions: BoundStatePermissions,
  durabilityOverrides: Partial<WorkspaceConfigDurability> = {},
): WorkspaceConfigStore => {
  const requestedStateRoot = safeStateRoot(stateRootInput);
  const stateRoot = safeStateRoot(permissions.stateRoot);
  const configPath = workspaceConfigPath(stateRoot);
  const durability: WorkspaceConfigDurability = {
    setPrivateFileMode:
      durabilityOverrides.setPrivateFileMode ??
      (async path => {
        if (process.platform !== 'win32') await chmod(path, 0o600);
      }),
    syncDirectory:
      durabilityOverrides.syncDirectory ??
      (async path => {
        if (process.platform === 'win32') return;
        const directory = await open(path, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }),
  };

  const ensureStateRoot = async (): Promise<{
    identity: SecurePathIdentity;
    realPath: string;
  }> => {
    const identity = await permissions.inspectSecure(stateRoot);
    const requestedRealPath = await realpath(requestedStateRoot).catch(error => {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config state-root spelling cannot be resolved',
        error,
      );
    });
    if (
      normalizedForComparison(requestedRealPath) !== normalizedForComparison(identity.canonicalPath)
    ) {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config state root does not match its bound permission authority',
      );
    }
    const metadata = await lstat(stateRoot, { bigint: true }).catch(error => {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'owner state root is unavailable',
        error,
      );
    });
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      handleIdentityKey(metadata) !== identity.key
    ) {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'owner state root must be a real directory',
      );
    }
    return { identity, realPath: identity.canonicalPath };
  };

  const mutationQueue = async (): Promise<StateMutationQueue> => {
    const { identity } = await ensureStateRoot();
    const queueKey = `${identity.key}:${CONFIG_FILENAME}`;
    let queue = stateMutationQueues.get(queueKey);
    if (queue === undefined) {
      queue = { tail: Promise.resolve() };
      stateMutationQueues.set(queueKey, queue);
    }
    return queue;
  };

  const readSecureConfigText = async (): Promise<string | undefined> => {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(configPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config cannot be opened without following links',
        error,
      );
    }
    try {
      const handleBefore = await handle.stat({ bigint: true });
      if (!handleBefore.isFile()) {
        throw new WorkspaceError(
          'WORKSPACE_CONFIG_INVALID',
          'workspace config must be a regular file',
        );
      }
      const inspected = await permissions.inspectSecure(configPath);
      if (!inspected.file || inspected.key !== handleIdentityKey(handleBefore)) {
        throw new StatePermissionError(
          'STATE_IDENTITY_CHANGED',
          'workspace config pathname does not identify the opened file',
        );
      }
      const raw = await handle.readFile('utf8');
      const handleAfter = await handle.stat({ bigint: true });
      if (handleIdentityKey(handleBefore) !== handleIdentityKey(handleAfter)) {
        throw new StatePermissionError(
          'STATE_IDENTITY_CHANGED',
          'workspace config identity changed while it was read',
        );
      }
      return raw;
    } finally {
      await handle.close();
    }
  };

  const readConfig = async (): Promise<WorkspaceRoot[]> => {
    const { realPath: stateRealPath } = await ensureStateRoot();
    const raw = await readSecureConfigText();
    if (raw === undefined) return [];
    let unknownConfig: unknown;
    try {
      unknownConfig = JSON.parse(raw);
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config is not valid JSON',
        error,
      );
    }
    const config = configFromUnknown(unknownConfig);
    if (config === undefined) {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config does not match its closed schema',
      );
    }
    const payload: WorkspaceConfigPayload = {
      version: CONFIG_VERSION,
      workspaces: config.workspaces,
    };
    if (checksumFor(payload) !== config.checksum) {
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_INVALID',
        'workspace config checksum does not match its records',
      );
    }
    if (config.workspaces.some(workspace => pathsOverlap(stateRealPath, workspace.realPath))) {
      throw new WorkspaceError(
        'STATE_WORKSPACE_OVERLAP',
        'workspace config overlaps owner-only service state',
      );
    }
    return config.workspaces.map(workspaceRecord);
  };

  const writeConfig = async (workspaces: readonly WorkspaceRoot[]): Promise<void> => {
    await ensureStateRoot();
    const payload: WorkspaceConfigPayload = {
      version: CONFIG_VERSION,
      workspaces: workspaces.map(workspaceRecord),
    };
    const envelope: WorkspaceConfigEnvelope = {
      ...payload,
      checksum: checksumFor(payload),
    };
    const temporaryPath = join(stateRoot, `.workspaces.v1.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let renamed = false;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await durability.setPrivateFileMode(temporaryPath);
      await permissions.ensureSecure(temporaryPath);
      await permissions.verifySecure(temporaryPath);
      await rename(temporaryPath, configPath);
      renamed = true;
      await permissions.verifySecure(configPath);
      await durability.syncDirectory(stateRoot);
    } catch (error) {
      if (renamed) {
        let committed = false;
        try {
          const observedRaw = await readSecureConfigText();
          const observed =
            observedRaw === undefined ? undefined : configFromUnknown(JSON.parse(observedRaw));
          committed =
            observed !== undefined &&
            observed.checksum === envelope.checksum &&
            checksumFor({ version: CONFIG_VERSION, workspaces: observed.workspaces }) ===
              observed.checksum;
        } catch {
          committed = false;
        }
        throw new WorkspaceCommitOutcomeUnknownError(committed, error);
      }
      throw new WorkspaceError(
        'WORKSPACE_CONFIG_WRITE_FAILED',
        'workspace config could not be committed atomically',
        error,
      );
    } finally {
      await handle?.close().catch(() => undefined);
      if (!renamed) {
        await unlink(temporaryPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      }
    }
  };

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    return mutationQueue().then(queue => {
      const result = queue.tail.then(operation);
      queue.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
  };

  return Object.freeze({
    add: async (actorId: string, input: string): Promise<WorkspaceRoot> => {
      authenticatedActor(actorId);
      return mutate(async () => {
        const { realPath: stateRealPath } = await ensureStateRoot();
        if (typeof input !== 'string' || input.trim() === '') {
          throw new WorkspaceError(
            'WORKSPACE_DIRECTORY_REQUIRED',
            'workspace path must name an existing directory',
          );
        }
        const normalizedPath = resolve(input);
        let metadata: Awaited<ReturnType<typeof stat>>;
        let canonicalPath: string;
        try {
          metadata = await stat(normalizedPath);
          canonicalPath = await realpath(normalizedPath);
        } catch (error) {
          throw new WorkspaceError(
            'WORKSPACE_DIRECTORY_REQUIRED',
            'workspace path must name an existing directory',
            error,
          );
        }
        if (!metadata.isDirectory()) {
          throw new WorkspaceError(
            'WORKSPACE_DIRECTORY_REQUIRED',
            'workspace path must name an existing directory',
          );
        }
        if (pathsOverlap(stateRealPath, canonicalPath)) {
          throw new WorkspaceError(
            'STATE_WORKSPACE_OVERLAP',
            'approved workspace cannot overlap owner-only service state',
          );
        }
        const workspaces = await readConfig();
        if (
          workspaces.some(
            workspace =>
              normalizedForComparison(workspace.realPath) ===
              normalizedForComparison(canonicalPath),
          )
        ) {
          throw new WorkspaceError(
            'WORKSPACE_ALREADY_CONFIGURED',
            'the workspace real path is already approved',
          );
        }
        let workspaceId = randomUUID();
        while (workspaces.some(workspace => workspace.workspaceId === workspaceId)) {
          workspaceId = randomUUID();
        }
        const workspace: WorkspaceRoot = {
          workspaceId,
          path: normalizedPath,
          realPath: canonicalPath,
          addedAt: new Date().toISOString(),
        };
        await writeConfig([...workspaces, workspace]);
        return immutableWorkspace(workspace);
      });
    },
    list: async (): Promise<readonly WorkspaceRoot[]> => {
      const queue = await mutationQueue();
      await queue.tail;
      return Object.freeze((await readConfig()).map(immutableWorkspace));
    },
    remove: async (actorId: string, workspaceId: string): Promise<void> => {
      authenticatedActor(actorId);
      return mutate(async () => {
        const workspaces = await readConfig();
        const workspace = workspaces.find(entry => entry.workspaceId === workspaceId);
        if (workspace === undefined) {
          throw new WorkspaceError('WORKSPACE_NOT_CONFIGURED', 'workspace is not configured');
        }
        let unsettled: boolean;
        try {
          unsettled = await usageGuard.hasUnsettled(workspaceId);
        } catch (error) {
          throw new WorkspaceError(
            'WORKSPACE_USAGE_CHECK_FAILED',
            'workspace usage could not be verified',
            error,
          );
        }
        if (unsettled) {
          throw new WorkspaceError(
            'WORKSPACE_IN_USE',
            'workspace still has unsettled operation references',
          );
        }
        await writeConfig(workspaces.filter(entry => entry.workspaceId !== workspaceId));
      });
    },
  });
};
