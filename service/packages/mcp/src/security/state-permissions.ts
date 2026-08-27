import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import type { StatePermissions } from '@sfp/shared';

const SYSTEM_SID = 'S-1-5-18';
const SID_PATTERN = /^S-\d-\d+(?:-\d+)+$/i;
const ALLOW_ACE_TYPES = new Set(['A', 'OA', 'XA', 'ZA']);

export type StatePermissionErrorCode =
  | 'STATE_ACL_COMMAND_FAILED'
  | 'STATE_ACL_INSECURE'
  | 'STATE_ACL_INVALID'
  | 'STATE_MODE_INSECURE'
  | 'STATE_OWNER_MISMATCH'
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

export type StatePermissionCommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface StatePermissionOptions {
  platform?: NodeJS.Platform;
  command?: StatePermissionCommandRunner;
  readWindowsAcl?: (path: string) => Promise<string>;
  currentUid?: () => number | undefined;
}

const runExecFile: StatePermissionCommandRunner = (file, args) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      { encoding: 'utf8', shell: false, windowsHide: true },
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

const decodeIcaclsSave = (contents: Buffer): string => {
  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    return contents.subarray(2).toString('utf16le');
  }
  if (contents.includes(0)) return contents.toString('utf16le');
  return contents.toString('utf8');
};

const readAclWithIcacls = async (
  path: string,
  command: StatePermissionCommandRunner,
): Promise<string> => {
  const metadata = await lstat(path);
  const outputDirectory = metadata.isDirectory() ? path : dirname(path);
  const listingPath = join(outputDirectory, `.sfp-acl-${process.pid}-${randomUUID()}.txt`);
  try {
    await command('icacls.exe', [path, '/save', listingPath, '/c']);
    return decodeIcaclsSave(await readFile(listingPath));
  } catch (error) {
    throw new StatePermissionError(
      'STATE_ACL_COMMAND_FAILED',
      'failed to read the Windows state ACL',
      error,
    );
  } finally {
    await unlink(listingPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
};

const daclFromListing = (listing: string): string | undefined =>
  listing
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.startsWith('D:'));

const verifyWindowsDacl = (listing: string, currentSid: string, directory: boolean): void => {
  const dacl = daclFromListing(listing);
  if (dacl === undefined) {
    throw new StatePermissionError('STATE_ACL_INVALID', 'icacls returned no state DACL');
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

export const createStatePermissions = (options: StatePermissionOptions = {}): StatePermissions => {
  const platform = options.platform ?? process.platform;
  const command = options.command ?? runExecFile;
  const currentUid = options.currentUid ?? (() => process.getuid?.());
  const readWindowsAcl =
    options.readWindowsAcl ?? ((path: string) => readAclWithIcacls(path, command));

  const verifyWindows = async (path: string, sid: string, directory?: boolean): Promise<void> => {
    const metadata = await assertSafeMetadata(path);
    verifyWindowsDacl(await readWindowsAcl(path), sid, directory ?? metadata.isDirectory());
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
    if ((metadata.mode & 0o777) !== expected) {
      throw new StatePermissionError(
        'STATE_MODE_INSECURE',
        `state path mode must be ${expected.toString(8)}`,
      );
    }
  };

  return Object.freeze({
    ensureSecure: async (input: string): Promise<void> => {
      const path = safeResolvedPath(input);
      let metadata: Stats | undefined = await lstat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return undefined;
      });
      if (metadata === undefined) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        metadata = await assertSafeMetadata(path);
      } else if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new StatePermissionError(
          'STATE_PATH_UNSAFE',
          'refusing to secure a linked state path',
        );
      }

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
      await verifyUnix(path);
    },
    verifySecure: async (input: string): Promise<void> => {
      const path = safeResolvedPath(input);
      if (platform === 'win32') {
        await verifyWindows(path, await currentWindowsSid(command));
      } else {
        await verifyUnix(path);
      }
    },
  });
};
