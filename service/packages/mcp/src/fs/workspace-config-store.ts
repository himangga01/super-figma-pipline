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
  WorkspaceUnavailableReason,
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
  | 'WORKSPACE_ROOT_MISSING'
  | 'WORKSPACE_ROOT_UNAVAILABLE'
  | 'WORKSPACE_ROOT_UNBOUND'
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
/**
 * A v3 row persists its binding state, never its availability. A bound row is the v2 row followed
 * by `state: 'bound'`; a legacy-unbound row is a v1 row, which has no identity key, followed by
 * `state: 'legacy-unbound'`. Only add and rebind write a root identity.
 */
interface BoundWorkspaceRecord {
  workspaceId: string;
  path: string;
  realPath: string;
  rootIdentityKey: string;
  addedAt: string;
  state: 'bound';
}
interface LegacyUnboundWorkspaceRecord {
  workspaceId: string;
  path: string;
  realPath: string;
  addedAt: string;
  state: 'legacy-unbound';
}
type WorkspaceRecord = BoundWorkspaceRecord | LegacyUnboundWorkspaceRecord;
interface WorkspaceConfigV3Payload {
  version: 3;
  workspaces: WorkspaceRecord[];
  defaultWorkspaceId: string | null;
}
type WorkspaceConfigPayload =
  | WorkspaceConfigV1Payload
  | WorkspaceConfigV2Payload
  | WorkspaceConfigV3Payload;
type WorkspaceConfigEnvelope = WorkspaceConfigPayload & { checksum: string };
interface WorkspaceConfigState {
  workspaces: WorkspaceRecord[];
  defaultWorkspaceId: string | null;
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
const boundRecord = (
  workspace: Readonly<LegacyWorkspaceRoot>,
  rootIdentityKey: string,
): BoundWorkspaceRecord => ({
  workspaceId: workspace.workspaceId,
  path: workspace.path,
  realPath: workspace.realPath,
  rootIdentityKey,
  addedAt: workspace.addedAt,
  state: 'bound',
});
const legacyUnboundRecord = (
  workspace: Readonly<LegacyWorkspaceRoot>,
): LegacyUnboundWorkspaceRecord => ({
  workspaceId: workspace.workspaceId,
  path: workspace.path,
  realPath: workspace.realPath,
  addedAt: workspace.addedAt,
  state: 'legacy-unbound',
});
const canonicalRecord = (record: Readonly<WorkspaceRecord>): WorkspaceRecord =>
  record.state === 'bound'
    ? boundRecord(record, record.rootIdentityKey)
    : legacyUnboundRecord(record);
const v3WorkspaceFromUnknown = (value: unknown): WorkspaceRecord | undefined => {
  if (!isPlainObject(value)) return undefined;
  if (value.state === 'bound') {
    if (
      !exactKeys(value, ['workspaceId', 'path', 'realPath', 'rootIdentityKey', 'addedAt', 'state'])
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
    return boundRecord(common, value.rootIdentityKey);
  }
  if (value.state === 'legacy-unbound') {
    if (!exactKeys(value, ['workspaceId', 'path', 'realPath', 'addedAt', 'state']))
      return undefined;
    const common = commonWorkspace(value);
    return common === undefined ? undefined : legacyUnboundRecord(common);
  }
  return undefined;
};

const uniqueWorkspaces = (
  workspaces: readonly Readonly<{ workspaceId: string; realPath: string }>[],
): boolean => {
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

/** Closed v2/v3 envelope rows with unique IDs and real paths and a default naming one row. */
const defaultedRows = <Row extends { workspaceId: string; realPath: string }>(
  value: Record<string, unknown>,
  rowFromUnknown: (row: unknown) => Row | undefined,
): { workspaces: Row[]; defaultWorkspaceId: string | null } | undefined => {
  const defaultWorkspaceId = value.defaultWorkspaceId;
  if (
    !exactKeys(value, ['version', 'workspaces', 'defaultWorkspaceId', 'checksum']) ||
    !Array.isArray(value.workspaces) ||
    !(defaultWorkspaceId === null || typeof defaultWorkspaceId === 'string')
  ) {
    return undefined;
  }
  const rows = value.workspaces.map(rowFromUnknown);
  if (rows.some(row => row === undefined)) return undefined;
  const workspaces = rows as Row[];
  if (
    !uniqueWorkspaces(workspaces) ||
    (defaultWorkspaceId !== null &&
      !workspaces.some(workspace => workspace.workspaceId === defaultWorkspaceId))
  ) {
    return undefined;
  }
  return { workspaces, defaultWorkspaceId };
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
    const parsed = defaultedRows(value, v2WorkspaceFromUnknown);
    if (parsed === undefined) return undefined;
    const payload: WorkspaceConfigV2Payload = { version: 2, ...parsed };
    if (checksumFor(payload) !== value.checksum) return undefined;
    return { ...payload, checksum: value.checksum };
  }
  if (value.version === 3) {
    const parsed = defaultedRows(value, v3WorkspaceFromUnknown);
    if (parsed === undefined) return undefined;
    const payload: WorkspaceConfigV3Payload = { version: 3, ...parsed };
    if (checksumFor(payload) !== value.checksum) return undefined;
    return { ...payload, checksum: value.checksum };
  }
  return undefined;
};

/** Reads never migrate: v1 rows become legacy-unbound and v2 rows become bound, verbatim. */
const configState = (config: WorkspaceConfigEnvelope): WorkspaceConfigState => {
  if (config.version === 1) {
    return { workspaces: config.workspaces.map(legacyUnboundRecord), defaultWorkspaceId: null };
  }
  if (config.version === 2) {
    return {
      workspaces: config.workspaces.map(row => boundRecord(row, row.rootIdentityKey)),
      defaultWorkspaceId: config.defaultWorkspaceId,
    };
  }
  return { workspaces: config.workspaces, defaultWorkspaceId: config.defaultWorkspaceId };
};

const unavailabilityCause = (workspace: Readonly<WorkspaceRoot>): WorkspaceError | undefined => {
  if (workspace.availability === undefined || workspace.availability === 'available') {
    return undefined;
  }
  if (workspace.availability === 'legacy-unbound') {
    return new WorkspaceError(
      'WORKSPACE_ROOT_UNBOUND',
      'the legacy workspace registration has no recorded root identity; rebind it explicitly',
    );
  }
  return workspace.unavailableReason === 'WORKSPACE_ROOT_IDENTITY_CHANGED'
    ? new WorkspaceError(
        'WORKSPACE_ROOT_IDENTITY_CHANGED',
        'the registered path now resolves to a directory other than the recorded root identity',
      )
    : new WorkspaceError(
        'WORKSPACE_ROOT_MISSING',
        'the registered path no longer resolves to an accessible real directory',
      );
};

/** The precise error for an operation that targets a registration that is not available. */
export const workspaceUnavailableError = (
  workspace: Readonly<WorkspaceRoot>,
): WorkspaceError | undefined => {
  const cause = unavailabilityCause(workspace);
  return cause === undefined
    ? undefined
    : new WorkspaceError(
        'WORKSPACE_ROOT_UNAVAILABLE',
        `workspace ${workspace.workspaceId} is ${workspace.availability} (${cause.code}); rebind or remove its registration`,
        cause,
      );
};

export interface WorkspaceSweepSummary {
  readonly scanned: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
}
const WELL_FORMED_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,95}$/u;

/**
 * Visits available registrations in order; logs and skips unavailable and legacy-unbound rows. A
 * failing visit is logged by error code and does not stop the other workspaces (LC-1, T09). An
 * aborted signal stops the iteration before the next workspace.
 */
export const sweepAvailableWorkspaces = async (
  workspaces: readonly Readonly<WorkspaceRoot>[],
  log: (line: string) => void,
  visit: (workspace: Readonly<WorkspaceRoot>) => Promise<void>,
  signal?: AbortSignal,
): Promise<WorkspaceSweepSummary> => {
  const scanned: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  /* eslint-disable no-await-in-loop -- each workspace orphan set is identity-verified in order */
  for (const workspace of workspaces) {
    if (signal?.aborted === true) break;
    const cause = unavailabilityCause(workspace);
    if (cause !== undefined) {
      skipped.push(workspace.workspaceId);
      log(
        `[retention] workspace ${workspace.workspaceId} is ${workspace.availability} (${cause.code}); its evidence scan is skipped until it is rebound or removed`,
      );
      continue;
    }
    try {
      await visit(workspace);
      scanned.push(workspace.workspaceId);
    } catch (error) {
      failed.push(workspace.workspaceId);
      const code = (error as { code?: unknown } | null | undefined)?.code;
      log(
        `[retention] workspace ${workspace.workspaceId} evidence scan failed (${
          typeof code === 'string' && WELL_FORMED_ERROR_CODE.test(code)
            ? code
            : error instanceof Error
              ? error.name
              : 'NonError'
        }); the other workspaces are still scanned`,
      );
    }
  }
  /* eslint-enable no-await-in-loop */
  return Object.freeze({
    scanned: Object.freeze(scanned),
    skipped: Object.freeze(skipped),
    failed: Object.freeze(failed),
  });
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
const immutableWorkspace = <Workspace extends WorkspaceRoot>(workspace: Workspace): Workspace =>
  Object.freeze({ ...workspace });
/** The listed view of a bound record: available unless an observation gives a reason. */
const boundWorkspace = (
  record: Readonly<BoundWorkspaceRecord>,
  unavailableReason?: WorkspaceUnavailableReason,
): RegisteredWorkspaceRoot =>
  immutableWorkspace({
    workspaceId: record.workspaceId,
    path: record.path,
    realPath: record.realPath,
    rootIdentityKey: record.rootIdentityKey,
    addedAt: record.addedAt,
    ...(unavailableReason === undefined
      ? { availability: 'available' as const }
      : { availability: 'unavailable' as const, unavailableReason }),
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

  /**
   * Observes one row. A failure never escapes: the row is listed as unavailable and its record,
   * including the recorded identity, stays exactly as persisted. Legacy rows have no identity to
   * compare, so they are never adopted here.
   */
  const listedWorkspace = async (record: Readonly<WorkspaceRecord>): Promise<WorkspaceRoot> => {
    if (record.state === 'legacy-unbound') {
      return immutableWorkspace({
        workspaceId: record.workspaceId,
        path: record.path,
        realPath: record.realPath,
        addedAt: record.addedAt,
        availability: 'legacy-unbound',
      });
    }
    let current: Readonly<ResolvedWorkspaceRegistration>;
    try {
      current = await registrationResolver.resolveForNonce(record.path);
    } catch {
      return boundWorkspace(record, 'WORKSPACE_ROOT_MISSING');
    }
    const recorded = {
      requestedPath: record.path,
      realPath: record.realPath,
      identityKey: record.rootIdentityKey,
    };
    return sameWorkspaceRegistration(recorded, current)
      ? boundWorkspace(record)
      : boundWorkspace(record, 'WORKSPACE_ROOT_IDENTITY_CHANGED');
  };

  /** Reads the persisted rows without touching any registered workspace. */
  const readConfig = async (): Promise<WorkspaceConfigState> => {
    const { realPath: stateRealPath } = await ensureStateRoot();
    const raw = await readSecureConfigText();
    if (raw === undefined) return { workspaces: [], defaultWorkspaceId: null };
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
    return configState(config);
  };

  /** Every explicit mutation writes v3 and carries rows it does not target through verbatim. */
  const writeConfig = async (
    workspaces: readonly Readonly<WorkspaceRecord>[],
    defaultWorkspaceId: string | null,
  ): Promise<void> => {
    await ensureStateRoot();
    const payload: WorkspaceConfigV3Payload = {
      version: 3,
      workspaces: workspaces.map(canonicalRecord),
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

  const revalidateRegistration = async (
    expected: Readonly<ResolvedWorkspaceRegistration>,
  ): Promise<Readonly<ResolvedWorkspaceRegistration>> => {
    try {
      return await registrationResolver.revalidateInsideMutation(expected);
    } catch (error) {
      throw new WorkspaceError(
        'WORKSPACE_REGISTRATION_CHANGED',
        'workspace registration changed before nonce consumption',
        error,
      );
    }
  };

  const assertSettled = async (workspaceId: string): Promise<void> => {
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
  };

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
      let record!: BoundWorkspaceRecord;
      await addResolvedWorkspaceAtomically({
        expected,
        revalidate: () => revalidateRegistration(expected),
        consumeNonceCas,
        commit: async () => {
          let workspaceId = randomUUID();
          while (state.workspaces.some(entry => entry.workspaceId === workspaceId)) {
            workspaceId = randomUUID();
          }
          record = boundRecord(
            {
              workspaceId,
              path: expected.requestedPath,
              realPath: expected.realPath,
              addedAt: new Date().toISOString(),
            },
            expected.identityKey,
          );
          await writeConfig([...state.workspaces, record], state.defaultWorkspaceId);
        },
      });
      return boundWorkspace(record);
    });
  };

  /**
   * Replaces one row's path and root identity and keeps its ID, creation time and default. Like
   * removal it requires settled operations, because unsettled operations were authorized against
   * the recorded root and their recovery reads evidence under it.
   */
  const rebindResolved = async (
    actorId: string,
    workspaceId: string,
    expected: Readonly<ResolvedWorkspaceRegistration>,
    consumeNonceCas: (revalidateImmediatelyBeforeConsume: () => Promise<void>) => Promise<void>,
  ): Promise<RegisteredWorkspaceRoot> => {
    authenticatedActor(actorId);
    return mutate(async () => {
      const { realPath: stateRealPath } = await ensureStateRoot();
      const state = await readConfig();
      const current = state.workspaces.find(entry => entry.workspaceId === workspaceId);
      if (current === undefined) {
        throw new WorkspaceError('WORKSPACE_NOT_CONFIGURED', 'workspace is not configured');
      }
      if (pathsOverlap(stateRealPath, expected.realPath)) {
        throw new WorkspaceError(
          'STATE_WORKSPACE_OVERLAP',
          'approved workspace cannot overlap owner-only service state',
        );
      }
      if (
        state.workspaces.some(
          entry =>
            entry.workspaceId !== workspaceId &&
            normalizedForComparison(entry.realPath) === normalizedForComparison(expected.realPath),
        )
      ) {
        throw new WorkspaceError(
          'WORKSPACE_ALREADY_CONFIGURED',
          'the workspace real path is already approved for another workspace',
        );
      }
      await assertSettled(workspaceId);
      const record = boundRecord(
        {
          workspaceId,
          path: expected.requestedPath,
          realPath: expected.realPath,
          addedAt: current.addedAt,
        },
        expected.identityKey,
      );
      await addResolvedWorkspaceAtomically({
        expected,
        revalidate: () => revalidateRegistration(expected),
        consumeNonceCas,
        commit: () =>
          writeConfig(
            state.workspaces.map(entry => (entry.workspaceId === workspaceId ? record : entry)),
            state.defaultWorkspaceId,
          ),
      });
      return boundWorkspace(record);
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
      await assertSettled(workspaceId);
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
    rebindResolved,
    list: async () => {
      const queue = await mutationQueue();
      await queue.tail;
      const { workspaces } = await readConfig();
      return Object.freeze(await Promise.all(workspaces.map(listedWorkspace)));
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
