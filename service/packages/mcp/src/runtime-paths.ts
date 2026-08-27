import { homedir } from 'node:os';
import { posix, resolve, win32 } from 'node:path';

import type { RuntimePaths, WorkspaceConfigStore, WorkspaceRoot } from '@sfp/shared';

export type RuntimePathErrorCode =
  | 'STATE_LOCATION_UNAVAILABLE'
  | 'STATE_PLATFORM_UNSUPPORTED'
  | 'STATE_WORKSPACE_OVERLAP';

export class RuntimePathError extends Error {
  readonly code: RuntimePathErrorCode;

  constructor(code: RuntimePathErrorCode, message: string) {
    super(message);
    this.name = 'RuntimePathError';
    this.code = code;
  }
}

export interface RuntimePathOptions {
  platform?: NodeJS.Platform;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  stateRoot?: string;
}

const requiredLocation = (value: string | undefined, variable: string): string => {
  if (value === undefined || value.trim() === '') {
    throw new RuntimePathError(
      'STATE_LOCATION_UNAVAILABLE',
      `${variable} is required to locate owner-only service state`,
    );
  }
  return value;
};

const requiredAbsoluteLocation = (
  value: string | undefined,
  variable: string,
  pathApi: typeof posix | typeof win32,
): string => {
  const location = requiredLocation(value, variable);
  if (!pathApi.isAbsolute(location)) {
    throw new RuntimePathError(
      'STATE_LOCATION_UNAVAILABLE',
      `${variable} must be an absolute owner-state location`,
    );
  }
  return location;
};

/** Resolve the platform's owner-state location without reading or registering any workspace. */
export const resolveDefaultStateRoot = (options: RuntimePathOptions = {}): string => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === 'win32') {
    return win32.resolve(
      requiredAbsoluteLocation(environment.LOCALAPPDATA, 'LOCALAPPDATA', win32),
      'SuperFigmaPipeline',
    );
  }
  if (platform === 'darwin') {
    return posix.resolve(
      requiredAbsoluteLocation(homeDirectory, 'home directory', posix),
      'Library',
      'Application Support',
      'SuperFigmaPipeline',
    );
  }
  if (platform === 'linux') {
    const absoluteHome = requiredAbsoluteLocation(homeDirectory, 'home directory', posix);
    const stateHome =
      environment.XDG_STATE_HOME === undefined ||
      environment.XDG_STATE_HOME.trim() === '' ||
      !posix.isAbsolute(environment.XDG_STATE_HOME)
        ? posix.resolve(absoluteHome, '.local', 'state')
        : environment.XDG_STATE_HOME;
    return posix.resolve(stateHome, 'super-figma-pipeline');
  }
  throw new RuntimePathError(
    'STATE_PLATFORM_UNSUPPORTED',
    `owner-only state location is not defined for ${platform}`,
  );
};

const overlaps = (left: string, right: string, platform: NodeJS.Platform): boolean => {
  const pathApi = platform === 'win32' ? win32 : posix;
  const normalize = (value: string): string => {
    const normalized = pathApi.resolve(value);
    return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  const leftToRight = pathApi.relative(normalizedLeft, normalizedRight);
  const rightToLeft = pathApi.relative(normalizedRight, normalizedLeft);
  const within = (value: string): boolean =>
    value === '' ||
    (!value.startsWith(`..${pathApi.sep}`) && value !== '..' && !pathApi.isAbsolute(value));
  return within(leftToRight) || within(rightToLeft);
};

const immutableWorkspace = (workspace: WorkspaceRoot): WorkspaceRoot =>
  Object.freeze({ ...workspace });

/** Load the approved roots independently from the platform-owned state location. */
export const createRuntimePaths = async (
  store: Pick<WorkspaceConfigStore, 'list'>,
  options: RuntimePathOptions = {},
): Promise<RuntimePaths> => {
  const platform = options.platform ?? process.platform;
  const rawStateRoot = options.stateRoot ?? resolveDefaultStateRoot(options);
  const stateRoot =
    platform === process.platform
      ? resolve(rawStateRoot)
      : platform === 'win32'
        ? win32.resolve(rawStateRoot)
        : posix.resolve(rawStateRoot);
  const workspaceRoots = (await store.list()).map(immutableWorkspace);
  const overlap = workspaceRoots.find(workspace =>
    overlaps(stateRoot, workspace.realPath, platform),
  );
  if (overlap !== undefined) {
    throw new RuntimePathError(
      'STATE_WORKSPACE_OVERLAP',
      `workspace ${overlap.workspaceId} overlaps owner-only service state`,
    );
  }
  return Object.freeze({ stateRoot, workspaceRoots: Object.freeze(workspaceRoots) });
};
