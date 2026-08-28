import { execFile } from 'node:child_process';
import type { BigIntStats, Stats } from 'node:fs';
import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, parse, posix, resolve, win32 } from 'node:path';

import type { StatePermissions } from '@sfp/shared';

import { resolveDefaultStateRoot } from '../runtime-paths.js';

const SYSTEM_SID = 'S-1-5-18';
const SID_PATTERN = /^S-\d-\d+(?:-\d+)+$/i;
const ALLOW_ACE_TYPES = new Set(['A', 'OA', 'XA', 'ZA']);
const WINDOWS_DIRECTORY_ATTRIBUTE = 0x10;
const WINDOWS_REPARSE_ATTRIBUTE = 0x400;
const WINDOWS_ACL_PROBE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$item=Get-Item -LiteralPath $env:SFP_STATE_ACL_TARGET -Force',
  '$acl=Get-Acl -LiteralPath $item.FullName',
  '[ordered]@{path=$item.FullName;attributes=[int64]$item.Attributes;sddl=$acl.Sddl}|ConvertTo-Json -Compress',
].join(';');
const WINDOWS_BOUNDARY_PROBE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$paths=ConvertFrom-Json $env:SFP_STATE_BOUNDARY_PATHS',
  '$records=@()',
  'foreach($path in $paths){$item=Get-Item -LiteralPath $path -Force;$records+=[pscustomobject]@{path=$item.FullName;attributes=[int64]$item.Attributes}}',
  'ConvertTo-Json -InputObject $records -Compress',
].join(';');

export type StatePermissionErrorCode =
  | 'STATE_ACL_COMMAND_FAILED'
  | 'STATE_ACL_INSECURE'
  | 'STATE_ACL_INVALID'
  | 'STATE_IDENTITY_CHANGED'
  | 'STATE_MODE_INSECURE'
  | 'STATE_OWNER_MISMATCH'
  | 'STATE_PATH_REPARSE'
  | 'STATE_WORKSPACE_OVERLAP'
  | 'STATE_PATH_UNSAFE';

export class StatePermissionError extends Error {
  readonly code: StatePermissionErrorCode;

  constructor(code: StatePermissionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StatePermissionError';
    this.code = code;
  }
}

export interface StatePermissionCommand {
  file: string;
  args: readonly string[];
}

export interface WindowsAclProbeRecord {
  path: string;
  attributes: number;
  sddl: string;
}

export type WindowsAclProbe = (path: string) => Promise<WindowsAclProbeRecord>;
export type WindowsBoundaryProbe = (
  paths: readonly string[],
) => Promise<readonly Pick<WindowsAclProbeRecord, 'attributes' | 'path'>[]>;

export type StatePermissionCommandRunner = (
  file: string,
  args: readonly string[],
  options?: { environment?: Readonly<Record<string, string>> },
) => Promise<{ stdout: string; stderr: string }>;

export interface StatePermissionOptions {
  platform?: NodeJS.Platform;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  command?: StatePermissionCommandRunner;
  windowsAclProbe?: WindowsAclProbe;
  windowsBoundaryProbe?: WindowsBoundaryProbe;
  currentUid?: () => number | undefined;
  forbiddenRoots?: readonly string[];
}

export interface BoundStatePermissions extends StatePermissions {
  readonly stateRoot: string;
  inspectSecure(path: string): Promise<SecurePathIdentity>;
}

export interface AuthStatePermissions {
  readonly stateRoot: string;
  ensureSecure(path: string): Promise<void>;
  verifySecure(path: string): Promise<void>;
}

export interface SecurePathIdentity {
  canonicalPath: string;
  key: string;
  directory: boolean;
  file: boolean;
}

const runExecFile: StatePermissionCommandRunner = (file, args, options) =>
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

const safeResolvedPath = (input: string): string => {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new StatePermissionError('STATE_PATH_UNSAFE', 'state path must be a non-empty string');
  }
  const path = resolve(input);
  if (path === parse(path).root) {
    throw new StatePermissionError(
      'STATE_PATH_UNSAFE',
      'refusing to change permissions on a filesystem root',
    );
  }
  return path;
};

const parseCsvRecord = (output: string): string[] => {
  const input = output.replace(/^\uFEFF/, '').trim();
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] as string;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field !== '') return [];
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      return [];
    } else {
      field += character;
    }
  }
  if (quoted) return [];
  fields.push(field);
  return fields;
};

const currentWindowsSid = async (command: StatePermissionCommandRunner): Promise<string> => {
  let stdout: string;
  try {
    ({ stdout } = await command('whoami.exe', ['/user', '/fo', 'csv', '/nh']));
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_COMMAND_FAILED',
      'failed to obtain the current Windows SID',
      error,
    );
  }
  const fields = parseCsvRecord(stdout);
  const sid = fields.length === 2 ? fields[1] : undefined;
  if (sid === undefined || !SID_PATTERN.test(sid)) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'whoami returned an invalid current-user SID record',
    );
  }
  return sid.toUpperCase();
};

const probeAclWithPowerShell = async (
  path: string,
  command: StatePermissionCommandRunner,
): Promise<WindowsAclProbeRecord> => {
  let stdout: string;
  try {
    ({ stdout } = await command(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_PROBE_SCRIPT],
      { environment: { SFP_STATE_ACL_TARGET: path } },
    ));
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_COMMAND_FAILED',
      'failed to inspect the Windows state ACL',
      error,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'Windows ACL probe returned malformed JSON',
      error,
    );
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Partial<WindowsAclProbeRecord>).path !== 'string' ||
    !Number.isSafeInteger((value as Partial<WindowsAclProbeRecord>).attributes) ||
    typeof (value as Partial<WindowsAclProbeRecord>).sddl !== 'string'
  ) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'Windows ACL probe returned an invalid record',
    );
  }
  return value as WindowsAclProbeRecord;
};

const probeBoundariesWithPowerShell = async (
  paths: readonly string[],
  command: StatePermissionCommandRunner,
): Promise<readonly Pick<WindowsAclProbeRecord, 'attributes' | 'path'>[]> => {
  let stdout: string;
  try {
    ({ stdout } = await command(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_BOUNDARY_PROBE_SCRIPT],
      { environment: { SFP_STATE_BOUNDARY_PATHS: JSON.stringify(paths) } },
    ));
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_COMMAND_FAILED',
      'failed to inspect Windows state boundaries',
      error,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'Windows state boundary probe returned malformed JSON',
      error,
    );
  }
  if (!Array.isArray(value) || value.length !== paths.length) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'Windows state boundary probe returned the wrong record count',
    );
  }
  return value.map(record => {
    if (
      typeof record !== 'object' ||
      record === null ||
      typeof (record as { path?: unknown }).path !== 'string' ||
      !Number.isSafeInteger((record as { attributes?: unknown }).attributes)
    ) {
      throw new StatePermissionError(
        'STATE_ACL_INVALID',
        'Windows state boundary probe returned an invalid record',
      );
    }
    return record as Pick<WindowsAclProbeRecord, 'attributes' | 'path'>;
  });
};

const daclFromSddl = (sddl: string): string | undefined => {
  const start = sddl.indexOf('D:');
  if (start === -1) return undefined;
  let depth = 0;
  for (let index = start + 2; index < sddl.length; index += 1) {
    const character = sddl[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (depth === 0 && character === 'S' && sddl[index + 1] === ':') {
      return sddl.slice(start, index);
    }
    if (depth < 0) return undefined;
  }
  return depth === 0 ? sddl.slice(start) : undefined;
};

const verifyWindowsDacl = (listing: string, currentSid: string, directory: boolean): void => {
  const dacl = daclFromSddl(listing);
  if (dacl === undefined) {
    throw new StatePermissionError('STATE_ACL_INVALID', 'Windows ACL probe returned no state DACL');
  }
  const firstAce = dacl.indexOf('(');
  const controls = dacl.slice(2, firstAce === -1 ? undefined : firstAce);
  if (!controls.includes('P')) {
    throw new StatePermissionError('STATE_ACL_INSECURE', 'state DACL inheritance is not protected');
  }

  const allowed = new Set([currentSid.toUpperCase(), SYSTEM_SID, 'SY']);
  const required = new Set([currentSid.toUpperCase(), SYSTEM_SID]);
  const acePattern = /\(([^()]*)\)/gu;
  let aceCount = 0;
  for (const match of dacl.matchAll(acePattern)) {
    aceCount += 1;
    const fields = (match[1] as string).split(';');
    if (fields.length < 6) {
      throw new StatePermissionError('STATE_ACL_INVALID', 'state DACL contains a malformed ACE');
    }
    const [type, flags, rights, , , rawPrincipal] = fields;
    const principal = rawPrincipal?.toUpperCase();
    if (flags?.includes('ID')) {
      throw new StatePermissionError('STATE_ACL_INSECURE', 'state DACL contains an inherited ACE');
    }
    if (type === undefined || !ALLOW_ACE_TYPES.has(type)) continue;
    if (principal === undefined || !allowed.has(principal)) {
      throw new StatePermissionError(
        'STATE_ACL_INSECURE',
        'state DACL grants access to an unexpected principal',
      );
    }
    if (rights !== 'FA' && rights?.toLowerCase() !== '0x1f01ff') {
      throw new StatePermissionError(
        'STATE_ACL_INSECURE',
        'state DACL does not grant full control to its owner principals',
      );
    }
    if (directory && (!flags?.includes('OI') || !flags.includes('CI'))) {
      throw new StatePermissionError(
        'STATE_ACL_INSECURE',
        'state directory DACL does not protect descendant objects',
      );
    }
    required.delete(principal === 'SY' ? SYSTEM_SID : principal);
  }
  if (aceCount === 0 || required.size > 0) {
    throw new StatePermissionError(
      'STATE_ACL_INSECURE',
      'state DACL is missing the current user or SYSTEM full-control ACE',
    );
  }
};

const assertSafeMetadata = async (path: string): Promise<Stats> => {
  const metadata = await lstat(path).catch(error => {
    throw new StatePermissionError('STATE_PATH_UNSAFE', 'state path is unavailable', error);
  });
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
    throw new StatePermissionError(
      'STATE_PATH_UNSAFE',
      'state path must be a regular file or directory, not a link or special object',
    );
  }
  return metadata;
};

interface PathIdentity {
  device: bigint;
  inode: bigint;
  birthtimeNs: bigint;
  directory: boolean;
  file: boolean;
}

const pathIdentity = async (path: string): Promise<PathIdentity> => {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw new StatePermissionError('STATE_PATH_UNSAFE', 'state path is unavailable', error);
  }
  if (metadata.ino === 0n) {
    throw new StatePermissionError(
      'STATE_ACL_INVALID',
      'platform did not provide a stable state path identity',
    );
  }
  return {
    device: metadata.dev,
    inode: metadata.ino,
    birthtimeNs: metadata.birthtimeNs,
    directory: metadata.isDirectory(),
    file: metadata.isFile(),
  };
};

const sameIdentity = (left: PathIdentity, right: PathIdentity): boolean =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.birthtimeNs === right.birthtimeNs &&
  left.directory === right.directory &&
  left.file === right.file;

export const isSecureUnixMode = (mode: number, directory: boolean): boolean =>
  (mode & 0o7777) === (directory ? 0o700 : 0o600);

export const createStatePermissions = (
  stateRootInput: string,
  options: StatePermissionOptions = {},
): BoundStatePermissions => {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? win32 : posix;
  const stateRoot = safeResolvedPath(stateRootInput);
  const expectedStateRoot = resolveDefaultStateRoot({
    platform,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
  });
  const comparable = (path: string): string =>
    platform === 'win32' ? pathApi.resolve(path).toLowerCase() : pathApi.resolve(path);
  const contains = (root: string, candidate: string): boolean => {
    const fromRoot = pathApi.relative(comparable(root), comparable(candidate));
    return (
      fromRoot === '' ||
      (!fromRoot.startsWith(`..${pathApi.sep}`) &&
        fromRoot !== '..' &&
        !pathApi.isAbsolute(fromRoot))
    );
  };
  if (comparable(stateRoot) !== comparable(expectedStateRoot)) {
    throw new StatePermissionError(
      'STATE_PATH_UNSAFE',
      'state permissions must bind the canonical product state root',
    );
  }
  const stateParent = pathApi.dirname(stateRoot);
  if (comparable(stateParent) === comparable(pathApi.parse(stateParent).root)) {
    throw new StatePermissionError(
      'STATE_PATH_UNSAFE',
      'product state parent cannot be a filesystem root',
    );
  }
  if (
    (options.forbiddenRoots ?? []).some(
      root => contains(root, stateRoot) || contains(stateRoot, root),
    )
  ) {
    throw new StatePermissionError(
      'STATE_WORKSPACE_OVERLAP',
      'product state root overlaps a forbidden workspace root',
    );
  }
  const command = options.command ?? runExecFile;
  const currentUid = options.currentUid ?? (() => process.getuid?.());
  const windowsAclProbe =
    options.windowsAclProbe ?? ((path: string) => probeAclWithPowerShell(path, command));
  const windowsBoundaryProbe =
    options.windowsBoundaryProbe ??
    (options.windowsAclProbe === undefined
      ? (paths: readonly string[]) => probeBoundariesWithPowerShell(paths, command)
      : (paths: readonly string[]) =>
          Promise.all(
            paths.map(async path => {
              const { attributes, path: observedPath } = await windowsAclProbe(path);
              return { attributes, path: observedPath };
            }),
          ));
  let boundRootIdentity: PathIdentity | undefined;

  const assertBoundRootIdentity = (identity: PathIdentity): void => {
    if (boundRootIdentity === undefined) {
      boundRootIdentity = identity;
      return;
    }
    if (!sameIdentity(boundRootIdentity, identity)) {
      throw new StatePermissionError(
        'STATE_IDENTITY_CHANGED',
        'bound product state root identity changed',
      );
    }
  };

  const currentBoundRootIdentity = async (): Promise<PathIdentity> => {
    const identity = await pathIdentity(stateRoot);
    assertBoundRootIdentity(identity);
    return identity;
  };

  const assertRootIdentityUnchanged = (before: PathIdentity, after: PathIdentity): void => {
    if (!sameIdentity(before, after)) {
      throw new StatePermissionError(
        'STATE_IDENTITY_CHANGED',
        'bound product state root changed during state access',
      );
    }
    assertBoundRootIdentity(after);
  };

  const assertContained = (path: string, action: string): void => {
    if (!contains(stateRoot, path)) {
      throw new StatePermissionError(
        'STATE_PATH_UNSAFE',
        `state permissions cannot ${action} a path outside the bound product root`,
      );
    }
  };

  const assertNoReparseAncestors = async (path: string): Promise<void> => {
    const rootParent = dirname(stateRoot);
    const fromRoot = pathApi.relative(stateRoot, path);
    const descendants =
      fromRoot === ''
        ? [stateRoot]
        : [
            stateRoot,
            ...fromRoot
              .split(pathApi.sep)
              .map((_, index, segments) =>
                pathApi.join(stateRoot, ...segments.slice(0, index + 1)),
              ),
          ];
    const observedCandidates: Array<{
      canonical: string;
      identity: PathIdentity;
      path: string;
    }> = [];
    /* eslint-disable no-await-in-loop -- each ancestor identity must be established in path order */
    for (const candidate of [rootParent, ...descendants]) {
      let metadata: Stats;
      try {
        metadata = await lstat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && candidate !== rootParent) break;
        throw new StatePermissionError(
          'STATE_PATH_UNSAFE',
          'state path parent or ancestor is unavailable',
          error,
        );
      }
      if (metadata.isSymbolicLink()) {
        throw new StatePermissionError(
          'STATE_PATH_REPARSE',
          'state path contains a symbolic-link or junction ancestor',
        );
      }
      const canonical = await realpath(candidate).catch(error => {
        throw new StatePermissionError(
          'STATE_PATH_UNSAFE',
          'state path ancestor cannot be resolved',
          error,
        );
      });
      if (comparable(canonical) !== comparable(candidate)) {
        throw new StatePermissionError(
          'STATE_PATH_REPARSE',
          'state path ancestor resolves through a reparse boundary',
        );
      }
      const identity = await pathIdentity(candidate);
      if (comparable(candidate) === comparable(stateRoot)) assertBoundRootIdentity(identity);
      observedCandidates.push({
        canonical,
        identity,
        path: candidate,
      });
    }
    if (platform === 'win32') {
      const records = await windowsBoundaryProbe(
        observedCandidates.map(candidate => candidate.path),
      );
      if (records.length !== observedCandidates.length) {
        throw new StatePermissionError(
          'STATE_ACL_INVALID',
          'Windows state boundary probe returned the wrong record count',
        );
      }
      for (const [index, candidate] of observedCandidates.entries()) {
        const record = records[index] as Pick<WindowsAclProbeRecord, 'attributes' | 'path'>;
        if (comparable(record.path) !== comparable(candidate.canonical)) {
          throw new StatePermissionError(
            'STATE_ACL_INVALID',
            'Windows ancestor probe record does not identify the inspected path',
          );
        }
        if ((record.attributes & WINDOWS_REPARSE_ATTRIBUTE) !== 0) {
          throw new StatePermissionError(
            'STATE_PATH_REPARSE',
            'Windows state ancestor is a reparse point',
          );
        }
        const identityAfter = await pathIdentity(candidate.path);
        if (comparable(candidate.path) === comparable(stateRoot)) {
          assertBoundRootIdentity(identityAfter);
        }
        if (!sameIdentity(candidate.identity, identityAfter)) {
          throw new StatePermissionError(
            'STATE_IDENTITY_CHANGED',
            'Windows state ancestor changed during reparse inspection',
          );
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  };

  const verifyWindows = async (path: string, sid: string, directory?: boolean): Promise<void> => {
    const metadata = await assertSafeMetadata(path);
    const identityBefore = await pathIdentity(path);
    if (comparable(path) === comparable(stateRoot)) assertBoundRootIdentity(identityBefore);
    const canonicalBefore = await realpath(path);
    const record = await windowsAclProbe(path);
    const identityAfter = await pathIdentity(path);
    const canonicalAfter = await realpath(path);
    if (!sameIdentity(identityBefore, identityAfter) || canonicalBefore !== canonicalAfter) {
      throw new StatePermissionError(
        'STATE_IDENTITY_CHANGED',
        'state path identity changed during ACL verification',
      );
    }
    if (comparable(path) === comparable(stateRoot)) assertBoundRootIdentity(identityAfter);
    if (resolve(record.path).toLowerCase() !== resolve(canonicalAfter).toLowerCase()) {
      throw new StatePermissionError(
        'STATE_ACL_INVALID',
        'Windows ACL probe record does not identify the inspected path',
      );
    }
    if ((record.attributes & WINDOWS_REPARSE_ATTRIBUTE) !== 0) {
      throw new StatePermissionError('STATE_PATH_UNSAFE', 'Windows state path is a reparse point');
    }
    const isDirectory = directory ?? metadata.isDirectory();
    if (
      isDirectory !== ((record.attributes & WINDOWS_DIRECTORY_ATTRIBUTE) !== 0) ||
      (!metadata.isDirectory() && !metadata.isFile())
    ) {
      throw new StatePermissionError(
        'STATE_ACL_INVALID',
        'Windows ACL probe path type does not match the inspected object',
      );
    }
    verifyWindowsDacl(record.sddl, sid, isDirectory);
  };

  const verifyUnix = async (path: string): Promise<void> => {
    const metadata = await assertSafeMetadata(path);
    const uid = currentUid();
    if (uid === undefined || metadata.uid !== uid) {
      throw new StatePermissionError(
        'STATE_OWNER_MISMATCH',
        'state path is not owned by the current user',
      );
    }
    const expected = metadata.isDirectory() ? 0o700 : 0o600;
    if (!isSecureUnixMode(metadata.mode, metadata.isDirectory())) {
      throw new StatePermissionError(
        'STATE_MODE_INSECURE',
        `state path mode must be ${expected.toString(8)}`,
      );
    }
  };

  const verifySecurePath = async (input: string): Promise<SecurePathIdentity> => {
    const path = safeResolvedPath(input);
    assertContained(path, 'inspect');
    await assertNoReparseAncestors(path);
    const rootIdentityBefore = await currentBoundRootIdentity();
    if (platform === 'win32') {
      await verifyWindows(path, await currentWindowsSid(command));
    } else {
      await verifyUnix(path);
    }
    assertRootIdentityUnchanged(rootIdentityBefore, await currentBoundRootIdentity());
    const identity = await pathIdentity(path);
    if (comparable(path) === comparable(stateRoot)) assertBoundRootIdentity(identity);
    return {
      canonicalPath: await realpath(path),
      key: `${identity.device}:${identity.inode}:${identity.birthtimeNs}`,
      directory: identity.directory,
      file: identity.file,
    };
  };

  return Object.freeze({
    stateRoot,
    ensureSecure: async (input: string): Promise<void> => {
      const path = safeResolvedPath(input);
      assertContained(path, 'mutate');
      await assertNoReparseAncestors(path);
      let metadata: Stats | undefined = await lstat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return undefined;
      });
      if (metadata === undefined) {
        if (comparable(path) !== comparable(stateRoot)) {
          throw new StatePermissionError(
            'STATE_PATH_UNSAFE',
            'only the validated product state leaf may be created by the permission authority',
          );
        }
        const parentMetadata = await lstat(dirname(path)).catch(error => {
          throw new StatePermissionError(
            'STATE_PATH_UNSAFE',
            'product state parent must already exist',
            error,
          );
        });
        if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
          throw new StatePermissionError(
            'STATE_PATH_REPARSE',
            'product state parent is not a real directory',
          );
        }
        await mkdir(path, { recursive: false, mode: 0o700 });
        metadata = await assertSafeMetadata(path);
      } else if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new StatePermissionError(
          'STATE_PATH_UNSAFE',
          'refusing to secure a linked state path',
        );
      }

      const identityBefore = await pathIdentity(path);
      const rootIdentityBefore =
        comparable(path) === comparable(stateRoot)
          ? identityBefore
          : await currentBoundRootIdentity();
      assertBoundRootIdentity(rootIdentityBefore);

      if (platform === 'win32') {
        const sid = await currentWindowsSid(command);
        const inheritedFlags = metadata.isDirectory() ? '(OI)(CI)F' : 'F';
        try {
          await command('icacls.exe', [path, '/inheritance:r']);
          await command('icacls.exe', [path, '/grant:r', `*${sid}:${inheritedFlags}`]);
          await command('icacls.exe', [path, '/grant:r', `*${SYSTEM_SID}:${inheritedFlags}`]);
        } catch (error) {
          throw new StatePermissionError(
            'STATE_ACL_COMMAND_FAILED',
            'failed to apply the owner-only Windows state ACL',
            error,
          );
        }
        const identityAfter = await pathIdentity(path);
        if (!sameIdentity(identityBefore, identityAfter)) {
          throw new StatePermissionError(
            'STATE_IDENTITY_CHANGED',
            'state path identity changed while applying its ACL',
          );
        }
        if (comparable(path) === comparable(stateRoot)) assertBoundRootIdentity(identityAfter);
        const rootIdentityAfter =
          comparable(path) === comparable(stateRoot)
            ? identityAfter
            : await currentBoundRootIdentity();
        assertRootIdentityUnchanged(rootIdentityBefore, rootIdentityAfter);
        await verifyWindows(path, sid, metadata.isDirectory());
        return;
      }

      const uid = currentUid();
      if (uid === undefined || metadata.uid !== uid) {
        throw new StatePermissionError(
          'STATE_OWNER_MISMATCH',
          'refusing to change a state path not owned by the current user',
        );
      }
      await chmod(path, metadata.isDirectory() ? 0o700 : 0o600);
      const identityAfter = await pathIdentity(path);
      if (!sameIdentity(identityBefore, identityAfter)) {
        throw new StatePermissionError(
          'STATE_IDENTITY_CHANGED',
          'state path identity changed while applying its mode',
        );
      }
      if (comparable(path) === comparable(stateRoot)) assertBoundRootIdentity(identityAfter);
      const rootIdentityAfter =
        comparable(path) === comparable(stateRoot)
          ? identityAfter
          : await currentBoundRootIdentity();
      assertRootIdentityUnchanged(rootIdentityBefore, rootIdentityAfter);
      await verifyUnix(path);
    },
    verifySecure: async (input: string): Promise<void> => {
      await verifySecurePath(input);
    },
    inspectSecure: verifySecurePath,
  });
};
