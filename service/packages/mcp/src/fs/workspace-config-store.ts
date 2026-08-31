import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { chmod, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import type {
  RegisteredWorkspaceRoot,
  ResolvedWorkspaceRegistration,
  WorkspaceBootstrapStore,
  WorkspaceRegistrationResolver,
  WorkspaceRoot,
  WorkspaceUsageGuard,
} from '@sfp/shared';

import type { BoundStatePermissions, SecurePathIdentity } from '../security/state-permissions.js';
import { StatePermissionError } from '../security/state-permissions.js';
import {
  createWorkspaceRegistrationResolver,
  sameWorkspaceRegistration,
  WorkspaceRegistrationError,
} from './workspace-registration-resolver.js';

const CONFIG_FILENAME = 'workspaces.v1.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

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
  | 'WORKSPACE_DEFAULT_IN_USE'
  | 'WORKSPACE_DEFAULT_INVALID'
  | 'WORKSPACE_DIRECTORY_REQUIRED'
  | 'WORKSPACE_IN_USE'
  | 'WORKSPACE_NOT_CONFIGURED'
  | 'WORKSPACE_PATH_ESCAPE'
  | 'WORKSPACE_PATH_INVALID'
  | 'WORKSPACE_PATH_NOT_FOUND'
  | 'WORKSPACE_PATH_REPARSE'
  | 'WORKSPACE_REGISTRATION_CHANGED'
  | 'WORKSPACE_ROOT_IDENTITY_CHANGED'
  | 'WORKSPACE_ROOT_UNAVAILABLE'
  | 'WORKSPACE_USAGE_CHECK_FAILED';

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WorkspaceError';
  }
}

export class WorkspaceCommitOutcomeUnknownError extends WorkspaceError {
  constructor(
    readonly committed: boolean,
    cause: unknown,
  ) {
    super(
      'COMMIT_OUTCOME_UNKNOWN',
      'workspace config rename completed but durability could not be confirmed',
      cause,
    );
    this.name = 'WorkspaceCommitOutcomeUnknownError';
  }
}

export interface WorkspaceConfigDurability {
  setPrivateFileMode(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

interface LegacyWorkspaceRoot {
  workspaceId: string;
  path: string;
  realPath: string;
  addedAt: string;
}
interface WorkspaceConfigV1Payload {
  version: 1;
  workspaces: LegacyWorkspaceRoot[];
}
interface WorkspaceConfigV2Payload {
  version: 2;
  workspaces: RegisteredWorkspaceRoot[];
  defaultWorkspaceId: string | null;
}
type WorkspaceConfigPayload = WorkspaceConfigV1Payload | WorkspaceConfigV2Payload;
type WorkspaceConfigEnvelope = WorkspaceConfigPayload & { checksum: string };
interface WorkspaceConfigState {
  workspaces: RegisteredWorkspaceRoot[];
  defaultWorkspaceId: string | null;
  sourceVersion: 1 | 2;
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
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());

const commonWorkspace = (
  value: Record<string, unknown>,
): Omit<LegacyWorkspaceRoot, never> | undefined => {
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
const legacyWorkspaceFromUnknown = (value: unknown): LegacyWorkspaceRoot | undefined => {
  if (!isPlainObject(value) || !exactKeys(value, ['workspaceId', 'path', 'realPath', 'addedAt'])) {
    return undefined;
  }
  return commonWorkspace(value);
};
const v2WorkspaceFromUnknown = (value: unknown): RegisteredWorkspaceRoot | undefined => {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, ['workspaceId', 'path', 'realPath', 'rootIdentityKey', 'addedAt'])
  ) {
    return undefined;
  }
  const common = commonWorkspace(value);
  if (
    common === undefined ||
    typeof value.rootIdentityKey !== 'string' ||
    value.rootIdentityKey === ''
  ) {
    return undefined;
  }
  return {
    workspaceId: common.workspaceId,
    path: common.path,
    realPath: common.realPath,
    rootIdentityKey: value.rootIdentityKey,
    addedAt: common.addedAt,
  };
};

const uniqueWorkspaces = (workspaces: readonly WorkspaceRoot[]): boolean => {
  const ids = new Set<string>();
  const realPaths = new Set<string>();
  for (const workspace of workspaces) {
    const comparablePath = normalizedForComparison(workspace.realPath);
    if (ids.has(workspace.workspaceId) || realPaths.has(comparablePath)) return false;
    ids.add(workspace.workspaceId);
    realPaths.add(comparablePath);
  }
  return true;
};

const configFromUnknown = (value: unknown): WorkspaceConfigEnvelope | undefined => {
  if (
    !isPlainObject(value) ||
    typeof value.checksum !== 'string' ||
    !SHA256_PATTERN.test(value.checksum)
  ) {
    return undefined;
  }
  if (value.version === 1) {
    if (
      !exactKeys(value, ['version', 'workspaces', 'checksum']) ||
      !Array.isArray(value.workspaces)
    ) {
      return undefined;
    }
    const workspaces = value.workspaces.map(legacyWorkspaceFromUnknown);
    if (workspaces.some(workspace => workspace === undefined)) return undefined;
    const payload: WorkspaceConfigV1Payload = {
      version: 1,
      workspaces: workspaces as LegacyWorkspaceRoot[],
    };
    if (!uniqueWorkspaces(payload.workspaces) || checksumFor(payload) !== value.checksum)
      return undefined;
    return { ...payload, checksum: value.checksum };
  }
  if (value.version === 2) {
    if (
      !exactKeys(value, ['version', 'workspaces', 'defaultWorkspaceId', 'checksum']) ||
      !Array.isArray(value.workspaces) ||
      !(value.defaultWorkspaceId === null || typeof value.defaultWorkspaceId === 'string')
    ) {
      return undefined;
    }
    const workspaces = value.workspaces.map(v2WorkspaceFromUnknown);
    if (workspaces.some(workspace => workspace === undefined)) return undefined;
    const parsed = workspaces as RegisteredWorkspaceRoot[];
    if (
      !uniqueWorkspaces(parsed) ||
      (value.defaultWorkspaceId !== null &&
        !parsed.some(workspace => workspace.workspaceId === value.defaultWorkspaceId))
    ) {
      return undefined;
    }
    const payload: WorkspaceConfigV2Payload = {
      version: 2,
      workspaces: parsed,
      defaultWorkspaceId: value.defaultWorkspaceId,
    };
    if (checksumFor(payload) !== value.checksum) return undefined;
    return { ...payload, checksum: value.checksum };
  }
  return undefined;
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
const immutableWorkspace = (workspace: RegisteredWorkspaceRoot): RegisteredWorkspaceRoot =>
  Object.freeze({ ...workspace });
const workspaceRecord = (workspace: RegisteredWorkspaceRoot): RegisteredWorkspaceRoot => ({
  workspaceId: workspace.workspaceId,
  path: workspace.path,
  realPath: workspace.realPath,
  rootIdentityKey: workspace.rootIdentityKey,
  addedAt: workspace.addedAt,
});
const handleIdentityKey = (metadata: BigIntStats): string =>
  `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;

export const addResolvedWorkspaceAtomically = async (input: {
  expected: Readonly<ResolvedWorkspaceRegistration>;
  revalidate(): Promise<Readonly<ResolvedWorkspaceRegistration>>;
  consumeNonceCas(revalidateImmediatelyBeforeConsume: () => Promise<void>): Promise<void>;
  commit(): Promise<void>;
}): Promise<void> => {
  const assertCurrentRegistration = async (): Promise<void> => {
    const current = await input.revalidate();
    if (!sameWorkspaceRegistration(input.expected, current)) {
      throw new WorkspaceError(
        'WORKSPACE_REGISTRATION_CHANGED',
        'workspace registration changed before nonce consumption',
      );
    }
  };
  await assertCurrentRegistration();
  await input.consumeNonceCas(assertCurrentRegistration);
  await input.commit();
};

export const createWorkspaceConfigStore = (
  stateRootInput: string,
  usageGuard: WorkspaceUsageGuard,
  permissions: BoundStatePermissions,
  durabilityOverrides: Partial<WorkspaceConfigDurability> = {},
  registrationResolver: WorkspaceRegistrationResolver = createWorkspaceRegistrationResolver(),
): WorkspaceBootstrapStore => {
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

  const ensureStateRoot = async (): Promise<{ identity: SecurePathIdentity; realPath: string }> => {
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
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) {
        throw new WorkspaceError(
          'WORKSPACE_CONFIG_INVALID',
          'workspace config must be a regular file',
        );
      }
      const inspected = await permissions.inspectSecure(configPath);
      if (!inspected.file || inspected.key !== handleIdentityKey(before)) {
        throw new StatePermissionError(
          'STATE_IDENTITY_CHANGED',
          'workspace config pathname does not identify the opened file',
        );
      }
      const raw = await handle.readFile('utf8');
      const after = await handle.stat({ bigint: true });
      if (handleIdentityKey(before) !== handleIdentityKey(after)) {
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

  const revalidateRows = async (
    rows: readonly (LegacyWorkspaceRoot | RegisteredWorkspaceRoot)[],
    sourceVersion: 1 | 2,
  ): Promise<RegisteredWorkspaceRoot[]> => {
    const validated: RegisteredWorkspaceRoot[] = [];
    /* eslint-disable no-await-in-loop -- preserve fail-closed configured order */
    for (const row of rows) {
      const expected = {
        requestedPath: row.path,
        realPath: row.realPath,
        identityKey: 'rootIdentityKey' in row ? row.rootIdentityKey : '',
      };
      let current: Readonly<ResolvedWorkspaceRegistration>;
      try {
        current =
          sourceVersion === 2
            ? await registrationResolver.revalidateInsideMutation(expected)
            : await registrationResolver.resolveForNonce(row.path);
      } catch (error) {
        throw new WorkspaceError(
          'WORKSPACE_ROOT_IDENTITY_CHANGED',
          'configured workspace root identity changed',
          error,
        );
      }
      if (
        normalizedForComparison(current.realPath) !== normalizedForComparison(row.realPath) ||
        (sourceVersion === 2 && current.identityKey !== expected.identityKey)
      ) {
        throw new WorkspaceError(
          'WORKSPACE_ROOT_IDENTITY_CHANGED',
          'configured workspace root identity changed',
        );
      }
      validated.push({
        workspaceId: row.workspaceId,
        path: row.path,
        realPath: row.realPath,
        rootIdentityKey: current.identityKey,
        addedAt: row.addedAt,
      });
    }
    /* eslint-enable no-await-in-loop */
    return validated;
  };

  const readConfig = async (): Promise<WorkspaceConfigState> => {
    const { realPath: stateRealPath } = await ensureStateRoot();
    const raw = await readSecureConfigText();
    if (raw === undefined) return { workspaces: [], defaultWorkspaceId: null, sourceVersion: 2 };
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
        'workspace config does not match its closed schema or checksum',
      );
    }
    if (config.workspaces.some(workspace => pathsOverlap(stateRealPath, workspace.realPath))) {
      throw new WorkspaceError(
        'STATE_WORKSPACE_OVERLAP',
        'workspace config overlaps owner-only service state',
      );
    }
    return {
      workspaces: await revalidateRows(config.workspaces, config.version),
      defaultWorkspaceId: config.version === 2 ? config.defaultWorkspaceId : null,
      sourceVersion: config.version,
    };
  };

  const writeConfig = async (
    workspaces: readonly RegisteredWorkspaceRoot[],
    defaultWorkspaceId: string | null,
  ): Promise<void> => {
    await ensureStateRoot();
    const payload: WorkspaceConfigV2Payload = {
      version: 2,
      workspaces: workspaces.map(workspaceRecord),
      defaultWorkspaceId,
    };
    const envelope: WorkspaceConfigEnvelope = { ...payload, checksum: checksumFor(payload) };
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
          committed = observed !== undefined && observed.checksum === envelope.checksum;
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

  const mutate = <T>(operation: () => Promise<T>): Promise<T> =>
    mutationQueue().then(queue => {
      const result = queue.tail.then(operation);
      queue.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

  const addResolved = async (
    actorId: string,
    expected: Readonly<ResolvedWorkspaceRegistration>,
    consumeNonceCas: (revalidateImmediatelyBeforeConsume: () => Promise<void>) => Promise<void>,
  ): Promise<RegisteredWorkspaceRoot> => {
    authenticatedActor(actorId);
    return mutate(async () => {
      const { realPath: stateRealPath } = await ensureStateRoot();
      const state = await readConfig();
      if (pathsOverlap(stateRealPath, expected.realPath)) {
        throw new WorkspaceError(
          'STATE_WORKSPACE_OVERLAP',
          'approved workspace cannot overlap owner-only service state',
        );
      }
      if (
        state.workspaces.some(
          workspace =>
            normalizedForComparison(workspace.realPath) ===
            normalizedForComparison(expected.realPath),
        )
      ) {
        throw new WorkspaceError(
          'WORKSPACE_ALREADY_CONFIGURED',
          'the workspace real path is already approved',
        );
      }
      let workspace!: RegisteredWorkspaceRoot;
      await addResolvedWorkspaceAtomically({
        expected,
        revalidate: async () => {
          try {
            return await registrationResolver.revalidateInsideMutation(expected);
          } catch (error) {
            throw new WorkspaceError(
              'WORKSPACE_REGISTRATION_CHANGED',
              'workspace registration changed before nonce consumption',
              error,
            );
          }
        },
        consumeNonceCas,
        commit: async () => {
          let workspaceId = randomUUID();
          while (state.workspaces.some(entry => entry.workspaceId === workspaceId)) {
            workspaceId = randomUUID();
          }
          workspace = {
            workspaceId,
            path: expected.requestedPath,
            realPath: expected.realPath,
            rootIdentityKey: expected.identityKey,
            addedAt: new Date().toISOString(),
          };
          await writeConfig([...state.workspaces, workspace], state.defaultWorkspaceId);
        },
      });
      return immutableWorkspace(workspace);
    });
  };

  const removeAuthorized = async (
    actorId: string,
    workspaceId: string,
    consumeNonceCas: () => Promise<void>,
  ): Promise<void> => {
    authenticatedActor(actorId);
    return mutate(async () => {
      const state = await readConfig();
      const workspace = state.workspaces.find(entry => entry.workspaceId === workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceError('WORKSPACE_NOT_CONFIGURED', 'workspace is not configured');
      }
      if (state.defaultWorkspaceId === workspaceId) {
        throw new WorkspaceError(
          'WORKSPACE_DEFAULT_IN_USE',
          'the current default workspace must be changed or cleared before removal',
        );
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
      await consumeNonceCas();
      await writeConfig(
        state.workspaces.filter(entry => entry.workspaceId !== workspaceId),
        state.defaultWorkspaceId,
      );
    });
  };

  const setDefaultAuthorized = async (
    actorId: string,
    workspaceId: string | null,
    consumeNonceCas: () => Promise<void>,
  ): Promise<void> => {
    authenticatedActor(actorId);
    return mutate(async () => {
      const state = await readConfig();
      if (
        workspaceId !== null &&
        !state.workspaces.some(workspace => workspace.workspaceId === workspaceId)
      ) {
        throw new WorkspaceError(
          'WORKSPACE_DEFAULT_INVALID',
          'default workspace must name an approved registration',
        );
      }
      await consumeNonceCas();
      await writeConfig(state.workspaces, workspaceId);
    });
  };

  const store: WorkspaceBootstrapStore = {
    addResolved,
    add: async (actorId, input) => {
      authenticatedActor(actorId);
      let expected: Readonly<ResolvedWorkspaceRegistration>;
      try {
        expected = await registrationResolver.resolveForNonce(input);
      } catch (error) {
        if (error instanceof WorkspaceRegistrationError) {
          throw new WorkspaceError('WORKSPACE_DIRECTORY_REQUIRED', error.message, error);
        }
        throw error;
      }
      return addResolved(actorId, expected, async revalidate => revalidate());
    },
    list: async () => {
      const queue = await mutationQueue();
      await queue.tail;
      return Object.freeze((await readConfig()).workspaces.map(immutableWorkspace));
    },
    remove: (actorId, workspaceId) => removeAuthorized(actorId, workspaceId, async () => {}),
    removeAuthorized,
    setDefault: (actorId, workspaceId) =>
      setDefaultAuthorized(actorId, workspaceId, async () => {}),
    setDefaultAuthorized,
    getDefault: async () => {
      const queue = await mutationQueue();
      await queue.tail;
      return (await readConfig()).defaultWorkspaceId;
    },
  };
  return Object.freeze(store);
};
