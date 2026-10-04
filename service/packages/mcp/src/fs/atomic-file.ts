import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
} from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readdir,
  rename,
  truncate,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

import type { WorkspacePolicy } from '@sfp/shared';

import {
  DirectoryLeaseBroker,
  DirectoryLeaseBrokerPool,
  WINDOWS_DIRECTORY_LEASE_PROTOCOL,
} from './windows-directory-lease-broker.js';

export interface AtomicFilePublication {
  path: string;
  bytes: number;
}

export interface AtomicReplaceOptions {
  destructiveApproved: boolean;
  expectedDigest64: string;
}

export interface AtomicWritePort {
  createNew(target: string, bytes: Uint8Array): Promise<Readonly<AtomicFilePublication>>;
  replace(
    target: string,
    bytes: Uint8Array,
    options: AtomicReplaceOptions,
  ): Promise<Readonly<AtomicFilePublication>>;
}

export interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
  nlink: number;
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

/**
 * Protocol v2 lease helper. The wire is ASCII-only in both directions: paths travel as base64 of
 * their UTF-16LE code units, and the helper echoes the SHA-256 of the bytes it received. Explicit
 * BOM-less UTF-8 streams replace the console code page, which garbled non-ASCII paths (OPS-1).
 * Every request is parsed inside its own `try`, so a malformed line gets an error response. A
 * constrained or compile-restricted host reports RESTRICTED instead of READY; Node then fails with
 * HOST_POWERSHELL_RESTRICTED and never falls back to lease-less writes.
 */
const windowsDirectoryLeaseScript = String.raw`
$ErrorActionPreference = 'Stop'
$languageMode = $ExecutionContext.SessionState.LanguageMode
if ($languageMode -ne 'FullLanguage') {
  Write-Output ('RESTRICTED language-mode ' + $languageMode)
  exit 3
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8, $false)
$writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true
$writer.NewLine = [string][char]10
$source = @'
using System;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

[StructLayout(LayoutKind.Sequential)]
public struct SfpByHandleFileInformation {
  public uint FileAttributes;
  public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
  public uint VolumeSerialNumber;
  public uint FileSizeHigh;
  public uint FileSizeLow;
  public uint NumberOfLinks;
  public uint FileIndexHigh;
  public uint FileIndexLow;
}

public sealed class SfpDirectoryLease {
  public SafeFileHandle Handle;
  public string Identity;
  public string PathSha256;
}

public static class SfpRetainedDirectoryLease {
  // The helper serves one request at a time, so one provider instance is never shared.
  static readonly SHA256 Digest = new SHA256CryptoServiceProvider();

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(
    string path,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(
    SafeFileHandle handle,
    out SfpByHandleFileInformation information);

  public static SfpDirectoryLease Acquire(string pathUtf16B64) {
    byte[] bytes = Convert.FromBase64String(pathUtf16B64);
    if (bytes.Length < 2 || bytes.Length > 65534 || (bytes.Length & 1) != 0) {
      throw new ArgumentException("lease path encoding is invalid");
    }
    // Copy code units verbatim; Encoding.Unicode would replace unpaired surrogates.
    char[] units = new char[bytes.Length / 2];
    Buffer.BlockCopy(bytes, 0, units, 0, bytes.Length);
    string path = new string(units);
    if (path.IndexOf('\0') >= 0) {
      throw new ArgumentException("lease path contains NUL");
    }
    StringBuilder digest = new StringBuilder(64);
    foreach (byte value in Digest.ComputeHash(bytes)) {
      digest.Append(value.ToString("x2", CultureInfo.InvariantCulture));
    }
    const uint FILE_SHARE_READ = 0x00000001;
    const uint FILE_SHARE_WRITE = 0x00000002;
    const uint OPEN_EXISTING = 3;
    const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    SafeFileHandle handle = CreateFileW(
      ExtendedPath(path),
      0,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      IntPtr.Zero);
    if (handle.IsInvalid) {
      int code = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(code, "CreateFileW failed: " + code.ToString(CultureInfo.InvariantCulture));
    }
    try {
      SfpByHandleFileInformation information;
      if (!GetFileInformationByHandle(handle, out information)) {
        int code = Marshal.GetLastWin32Error();
        throw new Win32Exception(code, "GetFileInformationByHandle failed: " + code.ToString(CultureInfo.InvariantCulture));
      }
      ulong index = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
      SfpDirectoryLease lease = new SfpDirectoryLease();
      lease.Handle = handle;
      lease.Identity = information.VolumeSerialNumber.ToString(CultureInfo.InvariantCulture) + ":" + index.ToString(CultureInfo.InvariantCulture);
      lease.PathSha256 = digest.ToString();
      return lease;
    } catch {
      handle.Dispose();
      throw;
    }
  }

  // Extended-length paths bypass MAX_PATH; paths that are already prefixed are kept verbatim.
  public static string ExtendedPath(string path) {
    if (path.StartsWith(@"\\?\", StringComparison.Ordinal) || path.StartsWith(@"\\.\", StringComparison.Ordinal)) {
      return path;
    }
    if (path.StartsWith(@"\\", StringComparison.Ordinal)) {
      return @"\\?\" + "UNC" + path.Substring(1);
    }
    if (path.Length >= 3 && path[1] == ':' && path[2] == '\\') {
      return @"\\?\" + path;
    }
    throw new ArgumentException("lease path is not fully qualified");
  }

  // JSON string literal restricted to printable ASCII, so no code page can alter a response.
  public static string JsonString(string text) {
    StringBuilder builder = new StringBuilder("\"");
    foreach (char unit in text ?? string.Empty) {
      if (unit == '"' || unit == '\\') {
        builder.Append('\\').Append(unit);
      } else if (unit < ' ' || unit > '~') {
        builder.Append("\\u").Append(((int)unit).ToString("x4", CultureInfo.InvariantCulture));
      } else {
        builder.Append(unit);
      }
    }
    return builder.Append('"').ToString();
  }
}
'@
try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Core'
} catch {
  $writer.WriteLine('RESTRICTED add-type ' + [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes([string]$_.Exception.Message)))
  exit 4
}
$handles = @{}
try {
  $writer.WriteLine('READY ${WINDOWS_DIRECTORY_LEASE_PROTOCOL}')
  while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    $id = ''
    try {
      $request = ConvertFrom-Json -InputObject $line
      if ($request -isnot [System.Management.Automation.PSCustomObject]) { throw 'lease request is not an object' }
      if ($request.id -isnot [string] -or $request.id -cnotmatch '^[0-9a-f]{32}$') { throw 'lease request id is invalid' }
      $id = $request.id
      if ($request.action -ceq 'acquire') {
        if ($request.pathUtf16B64 -isnot [string]) { throw 'lease request path is invalid' }
        if ($handles.ContainsKey($id)) { throw 'lease id is already held' }
        $lease = [SfpRetainedDirectoryLease]::Acquire($request.pathUtf16B64)
        $handles[$id] = $lease.Handle
        $response = '{"id":"' + $id + '","ok":true,"identity":"' + $lease.Identity + '","pathSha256":"' + $lease.PathSha256 + '"}'
      } elseif ($request.action -ceq 'release') {
        if ($handles.ContainsKey($id)) {
          $handles[$id].Dispose()
          $handles.Remove($id)
        }
        $response = '{"id":"' + $id + '","ok":true}'
      } else {
        throw 'unknown directory lease command'
      }
    } catch {
      $response = '{"id":"' + $id + '","ok":false,"error":' + [SfpRetainedDirectoryLease]::JsonString([string]$_.Exception.Message) + '}'
    }
    $writer.WriteLine($response)
  }
} finally {
  foreach ($handle in $handles.Values) { $handle.Dispose() }
}
`;

export const resolveWindowsPowerShellExecutable = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const systemRoot = environment.SystemRoot;
  if (
    systemRoot === undefined ||
    !win32.isAbsolute(systemRoot) ||
    systemRoot.includes('\0') ||
    [...systemRoot].some(
      character => (character.codePointAt(0) as number) <= 0x1f || '"<>|'.includes(character),
    )
  ) {
    throw Object.assign(new Error('Windows SystemRoot is not one validated absolute path'), {
      code: 'DIRECTORY_LEASE_EXECUTABLE_INVALID',
    });
  }
  const normalizedRoot = win32.normalize(systemRoot);
  const executable = win32.join(
    normalizedRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (
    !win32.isAbsolute(executable) ||
    win32.relative(normalizedRoot, executable).startsWith('..')
  ) {
    throw Object.assign(new Error('Windows PowerShell path escapes SystemRoot'), {
      code: 'DIRECTORY_LEASE_EXECUTABLE_INVALID',
    });
  }
  return executable;
};

export const windowsDirectoryLeaseInvocation = () => ({
  protocol: WINDOWS_DIRECTORY_LEASE_PROTOCOL,
  executable: resolveWindowsPowerShellExecutable(),
  args: [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(windowsDirectoryLeaseScript, 'utf16le').toString('base64'),
  ],
});
// The native module fence admits exactly this spawn shape: the approved args, windowsHide and
// three pipes. Keep it byte-identical or update native-module-fence-source.ts in lockstep.
const createWindowsDirectoryLeaseBroker = (): Promise<DirectoryLeaseBroker> => {
  const invocation = windowsDirectoryLeaseInvocation();
  return DirectoryLeaseBroker.start({
    spawnChild: () =>
      spawn(invocation.executable, invocation.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    // A cold start compiles the helper with Add-Type and is scanned by antivirus.
    startupTimeoutMs: 30_000,
    requestTimeoutMs: 10_000,
    shutdownTimeoutMs: 5_000,
    forceKillTimeoutMs: 5_000,
    maxLineBytes: 16_384,
    maxStdoutBytes: 4_194_304,
    maxStderrBytes: 65_536,
    // A 32,767-unit path is 87,380 base64 characters on the wire.
    maxCommandBytes: 131_072,
    maxPending: 256,
    unrefChild: true,
  });
};
const windowsDirectoryLeasePool = new DirectoryLeaseBrokerPool(createWindowsDirectoryLeaseBroker, {
  idleRetirementMs: 600_000,
});

export const acquireWindowsDirectoryLease = async (
  path: string,
): Promise<{ identity: { dev: bigint; ino: bigint }; release(): Promise<void> }> => {
  const lease = await windowsDirectoryLeasePool.acquire(path);
  const match = /^([0-9]+):([0-9]+)$/u.exec(lease.identity);
  if (match === null) {
    await lease.release().catch(() => undefined);
    await windowsDirectoryLeasePool.close();
    throw Object.assign(new Error('directory authority lease returned an invalid identity'), {
      code: 'DIRECTORY_AUTHORITY_INVALID',
    });
  }
  return {
    identity: { dev: BigInt(match[1] as string), ino: BigInt(match[2] as string) },
    release: () => lease.release(),
  };
};

export interface RetainedDirectoryAuthority {
  readonly path: string;
  child(name: string): string;
  verify(): Promise<void>;
}

export interface RetainedDirectoryChainOptions {
  createMissing?: boolean;
  errorCode?: string;
  afterLeafOpen?: (path: string) => Promise<void>;
}

/** Descends from a capability that the caller already retains for `rootPath`. */
export const withRetainedDirectoryDescendantChain = async <T>(
  rootPath: string,
  rootAuthority: RetainedDirectoryAuthority,
  directoryPath: string,
  operation: (authority: RetainedDirectoryAuthority) => Promise<T>,
  options: RetainedDirectoryChainOptions = {},
): Promise<T> => {
  const canonicalRoot = resolve(rootPath);
  const canonicalDirectory = resolve(directoryPath);
  const descendant = relative(canonicalRoot, canonicalDirectory);
  if (descendant === '..' || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw Object.assign(new Error('retained directory chain escapes its root'), {
      code: options.errorCode ?? 'DIRECTORY_AUTHORITY_INVALID',
    });
  }
  const segments = descendant === '' ? [] : descendant.split(sep);
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('retained directory chain contains an invalid segment'), {
      code: options.errorCode ?? 'DIRECTORY_AUTHORITY_INVALID',
    });
  }
  const descend = async (authority: RetainedDirectoryAuthority, index: number): Promise<T> => {
    if (index === segments.length) {
      await options.afterLeafOpen?.(canonicalDirectory);
      await authority.verify();
      return operation(authority);
    }
    const childPath = authority.child(segments[index] as string);
    let childIdentity = await lstat(childPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (childIdentity === null) {
      if (options.createMissing !== true) {
        throw Object.assign(new Error('retained directory chain descendant is missing'), {
          code: options.errorCode ?? 'DIRECTORY_AUTHORITY_INVALID',
        });
      }
      let created = false;
      try {
        await mkdir(childPath, { recursive: false });
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      if (created) await fsyncDirectory(authority.path);
      await authority.verify();
      childIdentity = await lstat(childPath);
    }
    if (!childIdentity.isDirectory() || childIdentity.isSymbolicLink()) {
      throw Object.assign(new Error('retained directory chain descendant is not direct'), {
        code: options.errorCode ?? 'DIRECTORY_AUTHORITY_INVALID',
      });
    }
    return withRetainedDirectoryAuthority(
      childPath,
      childIdentity,
      childAuthority => descend(childAuthority, index + 1),
      options.errorCode === undefined ? {} : { errorCode: options.errorCode },
    );
  };
  await rootAuthority.verify();
  return descend(rootAuthority, 0);
};

/**
 * Retains every directory from an already-authorized root through `directoryPath`. Missing
 * descendants are created one segment at a time through the retained parent capability; no
 * recursive pathname mkdir runs before the root authority is held.
 */
export const withRetainedDirectoryChain = async <T>(
  rootPath: string,
  directoryPath: string,
  operation: (authority: RetainedDirectoryAuthority) => Promise<T>,
  options: RetainedDirectoryChainOptions = {},
): Promise<T> => {
  const canonicalRoot = resolve(rootPath);
  const canonicalDirectory = resolve(directoryPath);
  const rootIdentity = await lstat(canonicalRoot);
  return withRetainedDirectoryAuthority(
    canonicalRoot,
    rootIdentity,
    authority =>
      withRetainedDirectoryDescendantChain(
        canonicalRoot,
        authority,
        canonicalDirectory,
        operation,
        options,
      ),
    options.errorCode === undefined ? {} : { errorCode: options.errorCode },
  );
};

export const withRetainedDirectoryAuthority = async <T>(
  path: string,
  expectedIdentity: FileIdentity,
  operation: (authority: RetainedDirectoryAuthority) => Promise<T>,
  options: { afterOpen?: () => Promise<void>; errorCode?: string } = {},
): Promise<T> => {
  const errorCode = options.errorCode ?? 'DIRECTORY_AUTHORITY_INVALID';
  const fail = (message: string, cause?: unknown) =>
    Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
      code: errorCode,
    });
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    throw fail('directory authority cannot be opened without following links', cause);
  }
  let windowsLease: Awaited<ReturnType<typeof acquireWindowsDirectoryLease>> | undefined;
  let result: T | undefined;
  let failure: unknown;
  try {
    await options.afterOpen?.();
    const [held, pathname] = await Promise.all([handle.stat(), lstat(path).catch(() => null)]);
    if (
      pathname === null ||
      !held.isDirectory() ||
      !pathname.isDirectory() ||
      pathname.isSymbolicLink() ||
      !sameIdentity(expectedIdentity, held) ||
      !sameIdentity(expectedIdentity, pathname)
    ) {
      throw fail('directory authority identity changed while opening');
    }
    if (process.platform === 'win32') {
      windowsLease = await acquireWindowsDirectoryLease(path).catch(cause => {
        throw fail('directory authority cannot acquire a no-delete lease', cause);
      });
      const [heldBig, pathnameBig] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(path, { bigint: true }).catch(() => null),
      ]);
      if (
        pathnameBig === null ||
        !heldBig.isDirectory() ||
        !pathnameBig.isDirectory() ||
        pathnameBig.isSymbolicLink() ||
        heldBig.dev !== windowsLease.identity.dev ||
        heldBig.ino !== windowsLease.identity.ino ||
        pathnameBig.dev !== windowsLease.identity.dev ||
        pathnameBig.ino !== windowsLease.identity.ino
      ) {
        throw fail('directory authority lease retained a different identity');
      }
    } else if (process.platform !== 'linux' && process.platform !== 'darwin') {
      throw fail('directory authority is unsupported on this platform');
    }
    const authorityPath =
      process.platform === 'linux'
        ? join('/proc/self/fd', String(handle.fd))
        : process.platform === 'darwin'
          ? join('/dev/fd', String(handle.fd))
          : path;
    const verify = async (): Promise<void> => {
      const [retained, current] = await Promise.all([handle.stat(), lstat(path).catch(() => null)]);
      if (
        current === null ||
        !retained.isDirectory() ||
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameIdentity(expectedIdentity, retained) ||
        !sameIdentity(expectedIdentity, current)
      ) {
        throw fail('directory authority changed during retained use');
      }
    };
    await verify();
    result = await operation({
      path: authorityPath,
      child: name => join(authorityPath, name),
      verify,
    });
  } catch (error) {
    failure = error;
  }
  const cleanupFailures: unknown[] = [];
  try {
    await windowsLease?.release();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await handle.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    const combined = new AggregateError(
      [...(failure === undefined ? [] : [failure]), ...cleanupFailures],
      'retained directory authority operation or release failed',
    );
    const committed =
      typeof failure === 'object' &&
      failure !== null &&
      'committed' in failure &&
      failure.committed === true &&
      'path' in failure &&
      typeof failure.path === 'string' &&
      'bytes' in failure &&
      typeof failure.bytes === 'number'
        ? { path: failure.path, bytes: failure.bytes }
        : typeof result === 'object' &&
            result !== null &&
            'path' in result &&
            typeof result.path === 'string' &&
            'bytes' in result &&
            typeof result.bytes === 'number'
          ? { path: result.path, bytes: result.bytes }
          : null;
    if (committed !== null) {
      throw committedMutationError(committed.path, committed.bytes, combined);
    }
    throw combined;
  }
  if (failure !== undefined) throw failure;
  return result as T;
};

const lstatMaybeAtomic = (path: string) =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

const canonicalPathMutexes = new Map<string, { tail: Promise<void>; users: number }>();

export interface CanonicalPathMutexOptions {
  timeoutMs?: number;
  afterOwnerSyncBeforePublish?: (temporaryPath: string, lockPath: string) => Promise<void>;
  afterPublishBeforeTempUnlink?: (temporaryPath: string, lockPath: string) => Promise<void>;
  processStartIdentity?: (pid: number) => Promise<string | null>;
  /** Stable logical paths key the process mutex; retained capability paths address the lock. */
  filesystemTarget?: string;
  retainedParentAuthority?: boolean;
}

interface PathLockOwner {
  schemaVersion: 2;
  pid: number;
  processStartIdentity: string;
  createdAt: number;
  token: string;
}

const validPathLockOwner = (value: unknown): value is PathLockOwner =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify(['createdAt', 'pid', 'processStartIdentity', 'schemaVersion', 'token']) &&
  (value as PathLockOwner).schemaVersion === 2 &&
  Number.isSafeInteger((value as PathLockOwner).pid) &&
  (value as PathLockOwner).pid > 0 &&
  typeof (value as PathLockOwner).processStartIdentity === 'string' &&
  /^[A-Za-z0-9._:-]{1,128}$/u.test((value as PathLockOwner).processStartIdentity) &&
  Number.isSafeInteger((value as PathLockOwner).createdAt) &&
  /^[0-9a-f]{32}$/u.test((value as PathLockOwner).token);

const execFileUtf8 = (file: string, args: readonly string[]): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      { encoding: 'utf8', windowsHide: true, timeout: 2_000, maxBuffer: 1_024 },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolvePromise(stdout);
      },
    );
  });

export const probeProcessStartIdentity = async (
  pid: number,
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> => {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/u);
      const startTicks = fields[19];
      return startTicks !== undefined && /^[0-9]+$/u.test(startTicks)
        ? `linux:${startTicks}`
        : null;
    }
    if (platform === 'darwin') {
      const started = (await execFileUtf8('/bin/ps', ['-o', 'lstart=', '-p', String(pid)])).trim();
      return started.length > 0
        ? `darwin:${createHash('sha256').update(started).digest('hex')}`
        : null;
    }
    if (platform === 'win32') {
      const executable = resolveWindowsPowerShellExecutable(environment);
      const command = `[Console]::Out.Write(([Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks))`;
      const ticks = (
        await execFileUtf8(executable, [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          command,
        ])
      ).trim();
      return /^[0-9]+$/u.test(ticks) ? `win32:${ticks}` : null;
    }
  } catch {
    return null;
  }
  return null;
};

let cachedCurrentProcessStartIdentity: Promise<string | null> | null = null;

const acquireInterprocessPathLock = async (
  canonicalPath: string,
  options: CanonicalPathMutexOptions = {},
): Promise<() => Promise<void>> => {
  const lockPath = `${options.filesystemTarget ?? canonicalPath}.sfp-lock`;
  if (options.retainedParentAuthority !== true) {
    await mkdir(dirname(lockPath), { recursive: true });
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw Object.assign(new Error('path lock timeout is invalid'), { code: 'PATH_LOCK_INVALID' });
  }
  const deadline = Date.now() + timeoutMs;
  const identityProbe = options.processStartIdentity ?? probeProcessStartIdentity;
  const currentProcessStartIdentity = await (options.processStartIdentity === undefined
    ? (cachedCurrentProcessStartIdentity ??= identityProbe(process.pid))
    : identityProbe(process.pid));
  if (currentProcessStartIdentity === null) {
    if (options.processStartIdentity === undefined) cachedCurrentProcessStartIdentity = null;
    throw Object.assign(new Error('current process start identity is unavailable'), {
      code: 'PATH_LOCK_INVALID',
    });
  }
  /* eslint-disable no-await-in-loop -- lock acquisition retries one verified filesystem authority */
  for (;;) {
    const token = randomBytes(16).toString('hex');
    const temporaryPath = join(dirname(lockPath), `.${basename(lockPath)}.${token}.sfp-tmp`);
    let ownerHandle: Awaited<ReturnType<typeof open>> | undefined;
    let published = false;
    try {
      ownerHandle = await open(temporaryPath, 'wx', 0o600);
      const owner: PathLockOwner = {
        schemaVersion: 2,
        pid: process.pid,
        processStartIdentity: currentProcessStartIdentity,
        createdAt: Date.now(),
        token,
      };
      const ownerBytes = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8');
      await ownerHandle.writeFile(ownerBytes);
      await ownerHandle.sync();
      await options.afterOwnerSyncBeforePublish?.(temporaryPath, lockPath);
      try {
        await link(temporaryPath, lockPath);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw cause;
        throw Object.assign(new Error('path lock publication failed', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      published = true;
      await fsyncDirectory(dirname(lockPath));
      await options.afterPublishBeforeTempUnlink?.(temporaryPath, lockPath);
      const [identity, publishedIdentity] = await Promise.all([
        ownerHandle.stat(),
        lstat(lockPath),
      ]);
      if (!identity.isFile() || identity.nlink !== 1) {
        if (
          !identity.isFile() ||
          identity.nlink !== 2 ||
          !publishedIdentity.isFile() ||
          publishedIdentity.isSymbolicLink() ||
          publishedIdentity.nlink !== 2 ||
          !sameIdentity(identity, publishedIdentity)
        ) {
          throw Object.assign(new Error('path lock identity is invalid'), {
            code: 'PATH_LOCK_INVALID',
          });
        }
      }
      await unlink(temporaryPath);
      await fsyncDirectory(dirname(lockPath));
      const [retainedIdentity, current] = await Promise.all([ownerHandle.stat(), lstat(lockPath)]);
      if (
        !retainedIdentity.isFile() ||
        retainedIdentity.nlink !== 1 ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        !sameIdentity(retainedIdentity, current) ||
        retainedIdentity.size !== ownerBytes.byteLength
      ) {
        throw Object.assign(new Error('path lock identity is invalid'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const retainedHandle = ownerHandle;
      ownerHandle = undefined;
      return async () => {
        try {
          const pathnameAtRelease = await lstat(lockPath);
          if (
            !pathnameAtRelease.isFile() ||
            pathnameAtRelease.isSymbolicLink() ||
            pathnameAtRelease.nlink !== 1 ||
            !sameIdentity(retainedIdentity, pathnameAtRelease)
          ) {
            throw Object.assign(new Error('path lock changed before release'), {
              code: 'PATH_LOCK_INVALID',
            });
          }
          await unlink(lockPath);
          await fsyncDirectory(dirname(lockPath));
        } finally {
          await retainedHandle.close();
        }
      };
    } catch (error) {
      await ownerHandle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      });
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if (published) {
          await unlink(lockPath).catch(cause => {
            if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
          });
          await fsyncDirectory(dirname(lockPath));
        }
        throw error;
      }
      let existingHandle: Awaited<ReturnType<typeof open>>;
      try {
        existingHandle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw Object.assign(new Error('existing path lock cannot be opened', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const metadata = await existingHandle.stat();
      const pathname = await lstat(lockPath);
      if (
        !metadata.isFile() ||
        metadata.nlink < 1 ||
        metadata.nlink > 2 ||
        metadata.size < 1 ||
        metadata.size > 4_096 ||
        !pathname.isFile() ||
        pathname.isSymbolicLink() ||
        !sameIdentity(metadata, pathname)
      ) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock is not regular'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      const ownerBytes = Buffer.alloc(metadata.size);
      try {
        const observed = await existingHandle.read(ownerBytes, 0, ownerBytes.byteLength, 0);
        if (observed.bytesRead !== ownerBytes.byteLength) {
          throw new Error('short lock owner read', { cause: error });
        }
      } catch (cause) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock owner is invalid', { cause }), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      let owner: unknown;
      try {
        owner = JSON.parse(ownerBytes.toString('utf8')) as unknown;
      } catch {
        owner = null;
      }
      if (!validPathLockOwner(owner)) {
        await existingHandle.close();
        throw Object.assign(new Error('existing path lock owner is invalid'), {
          code: 'PATH_LOCK_INVALID',
        });
      }
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (cause) {
        alive = (cause as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      const observedStartIdentity = alive
        ? owner.pid === process.pid && options.processStartIdentity === undefined
          ? currentProcessStartIdentity
          : await identityProbe(owner.pid)
        : null;
      const staleProcessProven =
        !alive ||
        (observedStartIdentity !== null && observedStartIdentity !== owner.processStartIdentity);
      if (staleProcessProven && Date.now() - owner.createdAt >= 1_000) {
        const rechecked = await lstat(lockPath);
        const descriptorRecheck = await existingHandle.stat();
        if (
          !sameIdentity(metadata, rechecked) ||
          !sameIdentity(metadata, descriptorRecheck) ||
          rechecked.nlink !== metadata.nlink
        ) {
          await existingHandle.close();
          throw Object.assign(new Error('stale path lock changed during recovery'), {
            code: 'PATH_LOCK_INVALID',
          });
        }
        let linkedTemporary: string | null = null;
        if (metadata.nlink === 2) {
          const candidate = join(
            dirname(lockPath),
            `.${basename(lockPath)}.${owner.token}.sfp-tmp`,
          );
          const candidateMetadata = await lstat(candidate).catch((cause: NodeJS.ErrnoException) => {
            if (cause.code === 'ENOENT') return null;
            throw cause;
          });
          if (candidateMetadata === null || !sameIdentity(metadata, candidateMetadata)) {
            await existingHandle.close();
            throw Object.assign(new Error('stale path lock link group is invalid'), {
              code: 'PATH_LOCK_INVALID',
            });
          }
          linkedTemporary = candidate;
        }
        await unlink(lockPath);
        if (linkedTemporary !== null) await unlink(linkedTemporary);
        await fsyncDirectory(dirname(lockPath));
        await existingHandle.close();
        continue;
      }
      await existingHandle.close();
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('timed out waiting for path authority lock'), {
          code: 'PATH_LOCK_TIMEOUT',
        });
      }
      await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 10));
    }
  }
  /* eslint-enable no-await-in-loop */
};

export const withCanonicalPathMutex = async <T>(
  canonicalPath: string,
  operation: () => Promise<T>,
  options: CanonicalPathMutexOptions = {},
): Promise<T> => {
  let mutex = canonicalPathMutexes.get(canonicalPath);
  if (mutex === undefined) {
    mutex = { tail: Promise.resolve(), users: 0 };
    canonicalPathMutexes.set(canonicalPath, mutex);
  }
  mutex.users += 1;
  const previous = mutex.tail;
  let release!: () => void;
  mutex.tail = new Promise<void>(resolveTail => {
    release = resolveTail;
  });
  await previous;
  let releaseInterprocess: () => Promise<void>;
  try {
    releaseInterprocess = await acquireInterprocessPathLock(canonicalPath, options);
  } catch (error) {
    release();
    mutex.users -= 1;
    if (mutex.users === 0 && canonicalPathMutexes.get(canonicalPath) === mutex) {
      canonicalPathMutexes.delete(canonicalPath);
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    try {
      await releaseInterprocess();
    } finally {
      release();
      mutex.users -= 1;
      if (mutex.users === 0 && canonicalPathMutexes.get(canonicalPath) === mutex) {
        canonicalPathMutexes.delete(canonicalPath);
      }
    }
  }
};
const defaultBoundedReader = (path: string): Promise<Uint8Array> => readFile(path);

export const readFileWithinLimit = async (
  path: string,
  maxBytes: number,
  reader: (path: string) => Promise<Uint8Array> = defaultBoundedReader,
  options: {
    beforeRead?: () => Promise<void>;
    expectedIdentity?: FileIdentity;
    signal?: AbortSignal;
    allowedLinks?: readonly number[];
  } = {},
): Promise<Buffer> => {
  const throwIfAborted = (beforeRead: boolean, bytesRead = 0): void => {
    if (options.signal?.aborted !== true) return;
    throw Object.assign(new Error('bounded file read was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
      beforeRead,
      bytesRead,
    });
  };
  throwIfAborted(true);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw Object.assign(new Error('bounded file limit is invalid'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
  }
  const allowedLinks = options.allowedLinks ?? [1];
  if (
    allowedLinks.length === 0 ||
    allowedLinks.some(value => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw Object.assign(new Error('bounded file link authority is invalid'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: true,
    });
  }
  const metadata = await lstat(path);
  if (options.expectedIdentity !== undefined && !sameIdentity(options.expectedIdentity, metadata)) {
    throw Object.assign(new Error('bounded file identity differs from retained authority'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: true,
    });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || !allowedLinks.includes(metadata.nlink)) {
    throw Object.assign(new Error('bounded file is not a regular file'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: true,
    });
  }
  if (metadata.size > maxBytes) {
    throw Object.assign(new Error('bounded file exceeds its declared limit'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
  }
  let bytes: Buffer;
  if (reader === defaultBoundedReader) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await options.beforeRead?.();
      throwIfAborted(true);
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        !allowedLinks.includes(opened.nlink) ||
        !sameIdentity(metadata, opened)
      ) {
        throw Object.assign(new Error('bounded file identity changed before read'), {
          code: 'FILE_IDENTITY_INVALID',
          beforeRead: true,
        });
      }
      if (opened.size > maxBytes) {
        throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
          code: 'FILE_SIZE_LIMIT_EXCEEDED',
          beforeRead: true,
        });
      }
      const chunks: Buffer[] = [];
      let total = 0;
      /* eslint-disable no-await-in-loop -- descriptor reads are sequential and stop at the cap */
      for (;;) {
        throwIfAborted(total === 0, total);
        const chunk = Buffer.allocUnsafe(Math.min(65_536, maxBytes - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) {
          throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
            code: 'FILE_SIZE_LIMIT_EXCEEDED',
            beforeRead: false,
            bytesRead: total,
          });
        }
        chunks.push(chunk.subarray(0, bytesRead));
        const during = await handle.stat();
        if (during.size > maxBytes) {
          throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
            code: 'FILE_SIZE_LIMIT_EXCEEDED',
            beforeRead: false,
            bytesRead: total,
          });
        }
      }
      /* eslint-enable no-await-in-loop */
      bytes = Buffer.concat(chunks, total);
    } finally {
      await handle.close();
    }
  } else {
    await options.beforeRead?.();
    throwIfAborted(true);
    const immediatelyBefore = await lstat(path);
    if (immediatelyBefore.size > maxBytes || !sameIdentity(metadata, immediatelyBefore)) {
      throw Object.assign(new Error('bounded file grew beyond its declared limit'), {
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        beforeRead: true,
      });
    }
    bytes = Buffer.from(await reader(path));
  }
  throwIfAborted(false, bytes.byteLength);
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    !allowedLinks.includes(after.nlink) ||
    !sameIdentity(metadata, after)
  ) {
    throw Object.assign(new Error('bounded file identity changed during read'), {
      code: 'FILE_IDENTITY_INVALID',
      beforeRead: false,
    });
  }
  if (bytes.byteLength > maxBytes) {
    throw Object.assign(new Error('bounded file exceeds its declared limit'), {
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: false,
    });
  }
  return bytes;
};

const atomicError = (code: string, message: string, cause?: unknown) =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const committedMutationError = (
  target: string,
  bytes: number,
  cause: unknown,
): Error & { code: string; committed: true; path: string; bytes: number } =>
  Object.assign(
    atomicError(
      'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      'atomic output mutated before its final outcome was known',
      cause,
    ),
    { committed: true as const, path: target, bytes },
  );

export type DirectorySyncResult = 'succeeded' | 'eperm-limited';

const fsyncDirectory = async (path: string): Promise<DirectorySyncResult> => {
  let handle;
  let result: DirectorySyncResult = 'succeeded';
  try {
    handle = await open(path, 'r');
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      // Node/Windows cannot fsync a directory handle (EPERM). This is the repository's existing
      // durability adaptation in OperationJournal; the exclusive hard-link remains the commit point.
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      result = 'eperm-limited';
    });
  } catch (cause) {
    throw atomicError(
      'ATOMIC_DIRECTORY_FSYNC_FAILED',
      'atomic publication directory fsync failed',
      cause,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return result;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw atomicError('IMMUTABLE_GENERATION_INVALID', 'value is not JSON');
  return encoded;
};
const digest64 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const prefixedHash = (domain: string, value: unknown): `sha256:${string}` =>
  `sha256:${createHash('sha256')
    .update(domain, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());
const immutableStem = (basePath: string): string =>
  basePath.endsWith('.jsonl') ? basePath.slice(0, -'.jsonl'.length) : basePath;

export type ImmutableGenerationStep =
  | 'temporary-log-fsync'
  | 'temporary-checkpoint-fsync'
  | 'temporary-anchor-fsync'
  | 'generation-log-link'
  | 'generation-checkpoint-link'
  | 'generation-anchor-link'
  | 'directory-fsync-before-pointer'
  | 'before-pointer-replace'
  | 'pointer-replace'
  | 'directory-fsync-after-pointer'
  | 'base-truncate'
  | 'base-fsync'
  | 'temporary-cleanup';

export interface ImmutableGenerationPointerV1 {
  schemaVersion: 1;
  compactionId: string;
  logDigest64: string;
  checkpointHash: `sha256:${string}`;
  anchorHash: `sha256:${string}`;
}

export interface ImmutableGenerationSelection {
  pointer: Readonly<ImmutableGenerationPointerV1>;
  logBytes: Uint8Array;
  previousRecordHash: `sha256:${string}` | null;
  firstRetainedRecordHash: `sha256:${string}` | null;
  baseTailBytes: number;
  baseTailDigest64: string;
}

const writeFsync = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const generationNames = (basePath: string, compactionId: string) => {
  const stem = immutableStem(basePath);
  return {
    log: `${stem}.compact-${compactionId}.jsonl`,
    checkpoint: `${stem}.compact-${compactionId}.checkpoint.json`,
    anchor: `${stem}.compact-${compactionId}.anchor.json`,
    current: `${stem}.current`,
  };
};

export const publishImmutableGeneration = async (input: {
  basePath: string;
  store: string;
  actorHash: string;
  logBytes: Uint8Array;
  rows: number;
  sequence: number;
  previousRecordHash: `sha256:${string}` | null;
  firstRetainedRecordHash: `sha256:${string}` | null;
  baseTailBytes?: Uint8Array;
  now: number;
  hook?: (step: ImmutableGenerationStep) => Promise<void>;
}): Promise<Readonly<ImmutableGenerationPointerV1>> => {
  const directory = dirname(input.basePath);
  const compactionId = randomBytes(16).toString('hex');
  const names = generationNames(input.basePath, compactionId);
  const token = randomBytes(16).toString('hex');
  const temporary = {
    log: join(directory, `.${basename(names.log)}.${token}.tmp`),
    checkpoint: join(directory, `.${basename(names.checkpoint)}.${token}.tmp`),
    anchor: join(directory, `.${basename(names.anchor)}.${token}.tmp`),
    current: join(directory, `.${basename(names.current)}.${token}.tmp`),
  };
  const createdAt = new Date(input.now).toISOString();
  const checkpointBase = {
    schemaVersion: 1 as const,
    store: input.store,
    actorHash: input.actorHash,
    compactionId,
    sequence: input.sequence,
    rows: input.rows,
    bytes: input.logBytes.byteLength,
    previousRecordHash: input.previousRecordHash,
    firstRetainedRecordHash: input.firstRetainedRecordHash,
    baseTailBytes: input.baseTailBytes?.byteLength ?? 0,
    baseTailDigest64: digest64(input.baseTailBytes ?? Buffer.alloc(0)),
    createdAt,
  };
  const checkpointHash = prefixedHash(`sfp-${input.store}-checkpoint-v1`, checkpointBase);
  const checkpoint = { ...checkpointBase, checkpointHash, contentHash: checkpointHash };
  const anchorBase = {
    schemaVersion: 1 as const,
    store: input.store,
    actorHash: input.actorHash,
    compactionId,
    checkpointHash,
    previousRecordHash: input.previousRecordHash,
    createdAt,
  };
  const anchorHash = prefixedHash(`sfp-${input.store}-anchor-v1`, anchorBase);
  const anchor = { ...anchorBase, anchorHash, contentHash: anchorHash };
  const pointer: ImmutableGenerationPointerV1 = {
    schemaVersion: 1,
    compactionId,
    logDigest64: digest64(input.logBytes),
    checkpointHash,
    anchorHash,
  };
  const hook = input.hook ?? (async () => undefined);
  let pointerPublished = false;
  let failure: unknown;
  try {
    await writeFsync(temporary.log, input.logBytes);
    await hook('temporary-log-fsync');
    await writeFsync(temporary.checkpoint, Buffer.from(`${canonicalJson(checkpoint)}\n`));
    await hook('temporary-checkpoint-fsync');
    await writeFsync(temporary.anchor, Buffer.from(`${canonicalJson(anchor)}\n`));
    await hook('temporary-anchor-fsync');
    await link(temporary.log, names.log);
    await hook('generation-log-link');
    await link(temporary.checkpoint, names.checkpoint);
    await hook('generation-checkpoint-link');
    await link(temporary.anchor, names.anchor);
    await hook('generation-anchor-link');
    await fsyncDirectory(directory);
    await hook('directory-fsync-before-pointer');
    await writeFsync(temporary.current, Buffer.from(`${canonicalJson(pointer)}\n`));
    await hook('before-pointer-replace');
    let backup: string | undefined;
    try {
      const currentMetadata = await lstat(names.current);
      if (
        !currentMetadata.isFile() ||
        currentMetadata.isSymbolicLink() ||
        currentMetadata.nlink !== 1
      ) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'current pointer identity is invalid');
      }
      backup = `${names.current}.backup-${token}`;
      await link(names.current, backup);
      await unlink(names.current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    try {
      await link(temporary.current, names.current);
      pointerPublished = true;
      await unlink(temporary.current);
    } catch (cause) {
      if (backup !== undefined) {
        await link(backup, names.current).catch(() => undefined);
      }
      throw cause;
    }
    await hook('pointer-replace');
    await fsyncDirectory(directory);
    await hook('directory-fsync-after-pointer');
    if (backup !== undefined) await unlink(backup);
    await truncate(input.basePath, 0);
    await hook('base-truncate');
    const base = await open(input.basePath, 'a');
    try {
      await base.sync();
      await hook('base-fsync');
    } finally {
      await base.close();
    }
  } catch (error) {
    failure = error;
  }
  try {
    await Promise.all(
      Object.values(temporary).map(path =>
        unlink(path).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }),
      ),
    );
    await hook('temporary-cleanup');
  } catch (error) {
    failure =
      failure === undefined
        ? error
        : new AggregateError([failure, error], 'immutable generation operation and cleanup failed');
  }
  if (failure !== undefined) {
    if (pointerPublished) {
      throw Object.assign(
        atomicError(
          'IMMUTABLE_GENERATION_COMMIT_OUTCOME_UNKNOWN',
          'immutable generation pointer committed before completion',
          failure,
        ),
        { committed: true as const, pointer: Object.freeze(pointer) },
      );
    }
    throw failure;
  }
  return Object.freeze(pointer);
};

const pointerSupportNames = async (
  basePath: string,
): Promise<{
  current: string;
  backups: string[];
  temporaries: string[];
}> => {
  const current = `${immutableStem(basePath)}.current`;
  const directory = dirname(basePath);
  const currentName = basename(current);
  const names = await readdir(directory);
  return {
    current,
    backups: names
      .filter(
        name => name.startsWith(`${currentName}.backup-`) && /\.backup-[0-9a-f]{32}$/u.test(name),
      )
      .map(name => join(directory, name)),
    temporaries: names
      .filter(name => name.startsWith(`.${currentName}.`) && name.endsWith('.tmp'))
      .map(name => join(directory, name)),
  };
};

const recoverPointerPublication = async (basePath: string): Promise<string[]> => {
  const support = await pointerSupportNames(basePath);
  let currentMetadata: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    currentMetadata = await lstat(support.current);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
  if (currentMetadata === null) {
    if (support.backups.length === 0) return [];
    if (support.backups.length !== 1) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer recovery is ambiguous');
    }
    const backupMetadata = await lstat(support.backups[0] as string);
    if (!backupMetadata.isFile() || backupMetadata.isSymbolicLink() || backupMetadata.nlink !== 1) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer backup identity is invalid');
    }
    await link(support.backups[0] as string, support.current);
    await unlink(support.backups[0] as string);
    currentMetadata = await lstat(support.current);
  }
  /* eslint-disable no-await-in-loop -- pointer support identity must be rechecked after each unlink */
  for (const supportPath of [...support.backups, ...support.temporaries]) {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(supportPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw cause;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'pointer support file is invalid');
    }
    if (sameIdentity(metadata, currentMetadata)) {
      await unlink(supportPath);
      currentMetadata = await lstat(support.current);
    }
  }
  /* eslint-enable no-await-in-loop */
  if (
    !currentMetadata.isFile() ||
    currentMetadata.isSymbolicLink() ||
    currentMetadata.nlink !== 1
  ) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'current pointer identity is invalid');
  }
  return support.backups;
};

const readRegularNoFollow = async (
  path: string,
  expectedLinks = 1,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<Buffer> => {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== expectedLinks) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path identity is invalid');
  }
  if (before.size > maxBytes) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path exceeds its hard cap');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== expectedLinks || !sameIdentity(before, opened)) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path changed before read');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    /* eslint-disable no-await-in-loop -- descriptor reads are sequential and stop at the cap */
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path exceeds its hard cap');
      }
      chunks.push(chunk.subarray(0, bytesRead));
      const during = await handle.stat();
      if (during.size > maxBytes) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path grew during read');
      }
    }
    /* eslint-enable no-await-in-loop */
    const bytes = Buffer.concat(chunks, total);
    const after = await lstat(path);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.nlink !== expectedLinks ||
      !sameIdentity(opened, after)
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected path changed during read');
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

const recognizedTemporaryLinks = async (selectedPath: string): Promise<string[]> => {
  const directory = dirname(selectedPath);
  const selectedName = basename(selectedPath);
  return (await readdir(directory))
    .filter(name => {
      const match = new RegExp(
        `^\\.${selectedName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.[0-9a-f]{32}\\.tmp$`,
        'u',
      );
      return match.test(name);
    })
    .map(name => join(directory, name));
};

const readSelectedGenerationMember = async (
  path: string,
  maxBytes: number | undefined,
): Promise<{ bytes: Buffer; temporaryLinks: string[] }> => {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink()) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation member is invalid');
  }
  const temporaryLinks = await recognizedTemporaryLinks(path);
  /* eslint-disable no-await-in-loop -- selected hardlinks require ordered identity validation */
  for (const temporary of temporaryLinks) {
    const metadata = await lstat(temporary);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !sameIdentity(selected, metadata)) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'generation temporary link is foreign');
    }
  }
  /* eslint-enable no-await-in-loop */
  const expectedLinks = temporaryLinks.length + 1;
  if (selected.nlink !== expectedLinks) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation has a foreign link');
  }
  return {
    bytes: await readRegularNoFollow(path, expectedLinks, maxBytes),
    temporaryLinks,
  };
};

const removeUnselectedGenerations = async (
  basePath: string,
  selected: ReadonlySet<string>,
): Promise<void> => {
  const directory = dirname(basePath);
  const prefix = `${basename(immutableStem(basePath))}.compact-`;
  let removed = false;
  /* eslint-disable no-await-in-loop -- validate each pathname immediately before its unlink */
  for (const name of await readdir(directory)) {
    if (!name.startsWith(prefix) || selected.has(name)) continue;
    if (!/\.compact-[0-9a-f]{32}\.(?:jsonl|checkpoint\.json|anchor\.json)$/u.test(name)) continue;
    const path = join(directory, name);
    const metadata = await lstat(path);
    const temporaryLinks = await recognizedTemporaryLinks(path);
    for (const temporary of temporaryLinks) {
      const temporaryMetadata = await lstat(temporary);
      if (
        !temporaryMetadata.isFile() ||
        temporaryMetadata.isSymbolicLink() ||
        !sameIdentity(metadata, temporaryMetadata)
      ) {
        throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected temporary is foreign');
      }
    }
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== temporaryLinks.length + 1
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected generation is not regular');
    }
    const immediatelyBeforeUnlink = await lstat(path);
    if (
      !immediatelyBeforeUnlink.isFile() ||
      immediatelyBeforeUnlink.isSymbolicLink() ||
      immediatelyBeforeUnlink.nlink !== temporaryLinks.length + 1 ||
      !sameIdentity(metadata, immediatelyBeforeUnlink)
    ) {
      throw atomicError('IMMUTABLE_GENERATION_INVALID', 'unselected generation changed');
    }
    await Promise.all(temporaryLinks.map(temporary => unlink(temporary)));
    await unlink(path);
    removed = true;
  }
  /* eslint-enable no-await-in-loop */
  if (removed) await fsyncDirectory(directory);
};

export const readImmutableGeneration = async (input: {
  basePath: string;
  store: string;
  actorHash: string;
  maxLogBytes?: number;
}): Promise<Readonly<ImmutableGenerationSelection> | null> => {
  const current = `${immutableStem(input.basePath)}.current`;
  const staleBackups = await recoverPointerPublication(input.basePath);
  let pointerBytes: Buffer;
  try {
    pointerBytes = await readRegularNoFollow(current, 1, 65_536);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await removeUnselectedGenerations(input.basePath, new Set());
    return null;
  }
  let pointer: ImmutableGenerationPointerV1;
  try {
    const value = JSON.parse(pointerBytes.toString('utf8')) as ImmutableGenerationPointerV1;
    if (
      !exactKeys(value, [
        'schemaVersion',
        'compactionId',
        'logDigest64',
        'checkpointHash',
        'anchorHash',
      ]) ||
      value.schemaVersion !== 1 ||
      !/^[0-9a-f]{32}$/u.test(value.compactionId) ||
      !/^[0-9a-f]{64}$/u.test(value.logDigest64) ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.checkpointHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.anchorHash)
    ) {
      throw new Error('invalid pointer');
    }
    pointer = value;
  } catch (cause) {
    throw atomicError(
      'IMMUTABLE_GENERATION_INVALID',
      'current generation pointer is invalid',
      cause,
    );
  }
  const names = generationNames(input.basePath, pointer.compactionId);
  const selectedNames = new Set([
    basename(names.log),
    basename(names.checkpoint),
    basename(names.anchor),
  ]);
  let logBytes: Buffer;
  let checkpoint: Record<string, unknown>;
  let anchor: Record<string, unknown>;
  let selectedTemporaryLinks: string[];
  try {
    const [log, checkpointMember, anchorMember] = await Promise.all([
      readSelectedGenerationMember(names.log, input.maxLogBytes),
      readSelectedGenerationMember(names.checkpoint, 65_536),
      readSelectedGenerationMember(names.anchor, 65_536),
    ]);
    logBytes = log.bytes;
    checkpoint = JSON.parse(checkpointMember.bytes.toString('utf8')) as Record<string, unknown>;
    anchor = JSON.parse(anchorMember.bytes.toString('utf8')) as Record<string, unknown>;
    selectedTemporaryLinks = [
      ...log.temporaryLinks,
      ...checkpointMember.temporaryLinks,
      ...anchorMember.temporaryLinks,
    ];
  } catch (cause) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation is incomplete', cause);
  }
  const checkpointBase = { ...checkpoint };
  delete checkpointBase.checkpointHash;
  delete checkpointBase.contentHash;
  const anchorBase = { ...anchor };
  delete anchorBase.anchorHash;
  delete anchorBase.contentHash;
  if (
    digest64(logBytes) !== pointer.logDigest64 ||
    !exactKeys(checkpoint, [
      'schemaVersion',
      'store',
      'actorHash',
      'compactionId',
      'sequence',
      'rows',
      'bytes',
      'previousRecordHash',
      'firstRetainedRecordHash',
      'baseTailBytes',
      'baseTailDigest64',
      'checkpointHash',
      'createdAt',
      'contentHash',
    ]) ||
    !exactKeys(anchor, [
      'schemaVersion',
      'store',
      'actorHash',
      'compactionId',
      'checkpointHash',
      'previousRecordHash',
      'anchorHash',
      'createdAt',
      'contentHash',
    ]) ||
    checkpoint.store !== input.store ||
    anchor.store !== input.store ||
    checkpoint.actorHash !== input.actorHash ||
    anchor.actorHash !== input.actorHash ||
    checkpoint.compactionId !== pointer.compactionId ||
    anchor.compactionId !== pointer.compactionId ||
    checkpoint.bytes !== logBytes.byteLength ||
    !Number.isSafeInteger(checkpoint.baseTailBytes) ||
    (checkpoint.baseTailBytes as number) < 0 ||
    typeof checkpoint.baseTailDigest64 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(checkpoint.baseTailDigest64 as string) ||
    checkpoint.checkpointHash !== pointer.checkpointHash ||
    checkpoint.contentHash !== pointer.checkpointHash ||
    anchor.checkpointHash !== pointer.checkpointHash ||
    anchor.anchorHash !== pointer.anchorHash ||
    anchor.contentHash !== pointer.anchorHash ||
    prefixedHash(`sfp-${input.store}-checkpoint-v1`, checkpointBase) !== pointer.checkpointHash ||
    prefixedHash(`sfp-${input.store}-anchor-v1`, anchorBase) !== pointer.anchorHash
  ) {
    throw atomicError('IMMUTABLE_GENERATION_INVALID', 'selected generation verification failed');
  }
  await Promise.all(selectedTemporaryLinks.map(path => unlink(path)));
  if (selectedTemporaryLinks.length > 0) await fsyncDirectory(dirname(input.basePath));
  await Promise.all(
    staleBackups.map(backup =>
      unlink(backup).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }),
    ),
  );
  await removeUnselectedGenerations(input.basePath, selectedNames);
  return Object.freeze({
    pointer: Object.freeze(pointer),
    logBytes,
    previousRecordHash: checkpoint.previousRecordHash as `sha256:${string}` | null,
    firstRetainedRecordHash: checkpoint.firstRetainedRecordHash as `sha256:${string}` | null,
    baseTailBytes: checkpoint.baseTailBytes as number,
    baseTailDigest64: checkpoint.baseTailDigest64 as string,
  });
};

export interface AtomicFileStoreOptions {
  beforeLink?: (path: string) => Promise<void>;
  afterLink?: (path: string) => Promise<void>;
  afterTemporaryOpen?: (path: string) => Promise<void>;
  afterFileFsync?: (path: string) => Promise<void>;
  afterDirectoryFsync?: (path: string, result: DirectorySyncResult) => Promise<void>;
  beforeReplaceCommit?: (path: string) => Promise<void>;
  afterReplaceTemporaryFsync?: () => Promise<void>;
  afterReplaceQuarantineRenameBeforeFsync?: () => Promise<void>;
  afterReplaceQuarantineFsync?: () => Promise<void>;
  afterReplacePublishFsync?: () => Promise<void>;
  /** Only callers whose published record supersedes the old recovery generation may opt in. */
  reclaimRetainedAfterPublish?: boolean;
  /** Authenticates historical metadata before migrating generations that lack cleanup intents. */
  verifyRetainedForReclamation?: (bytes: Uint8Array) => Promise<void>;
  afterReplaceCleanupIntentFsync?: () => Promise<void>;
  afterReplaceRetainedUnlinkFsync?: () => Promise<void>;
  retainedReplaceLimits?: { maxRows: number; maxBytes: number; maxScanEntries: number };
  maxReplaceBytes?: number;
  beforeReplaceBodyRead?: (path: string) => Promise<void>;
  beforeCreateVerificationRead?: (path: string) => Promise<void>;
}

export class AtomicFileStore implements AtomicWritePort {
  constructor(private readonly options: AtomicFileStoreOptions = {}) {}

  async createNew(target: string, bytes: Uint8Array): Promise<Readonly<AtomicFilePublication>> {
    const directory = dirname(target);
    await mkdir(directory, { recursive: true });
    const temporary = join(
      directory,
      `.${basename(target)}.${randomBytes(16).toString('hex')}.sfp-tmp`,
    );
    let handle;
    let temporaryIdentity: FileIdentity | undefined;
    let linked = false;
    let publication: Readonly<AtomicFilePublication> | undefined;
    let failure: unknown;
    try {
      handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      temporaryIdentity = await handle.stat();
      await this.options.afterTemporaryOpen?.(temporary);
      await handle.writeFile(bytes);
      await handle.sync();
      await this.options.afterFileFsync?.(temporary);
      await this.options.beforeLink?.(target);
      try {
        await link(temporary, target);
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          throw atomicError(
            'TARGET_ALREADY_EXISTS',
            'atomic create-new target already exists',
            cause,
          );
        }
        throw atomicError('ATOMIC_LINK_FAILED', 'exclusive hard-link publication failed', cause);
      }
      linked = true;
      await this.options.afterLink?.(target);
      const directorySync = await fsyncDirectory(directory);
      await this.options.afterDirectoryFsync?.(directory, directorySync);
      const [heldMetadata, temporaryMetadata, metadata] = await Promise.all([
        handle.stat(),
        lstat(temporary),
        lstat(target),
      ]);
      if (
        !heldMetadata.isFile() ||
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        !temporaryMetadata.isFile() ||
        temporaryMetadata.isSymbolicLink() ||
        !sameIdentity(heldMetadata, temporaryMetadata) ||
        !sameIdentity(temporaryMetadata, metadata)
      ) {
        throw atomicError('ATOMIC_TARGET_INVALID', 'published target is not a regular file');
      }
      if (metadata.nlink !== 2 || temporaryMetadata.nlink !== 2) {
        throw atomicError('ATOMIC_TARGET_ALIAS', 'published target has a foreign hardlink alias');
      }
      await this.options.beforeCreateVerificationRead?.(target);
      const [heldBeforeRead, temporaryBeforeRead, targetBeforeRead] = await Promise.all([
        handle.stat(),
        lstat(temporary).catch(() => null),
        lstat(target).catch(() => null),
      ]);
      if (
        temporaryBeforeRead === null ||
        targetBeforeRead === null ||
        !heldBeforeRead.isFile() ||
        heldBeforeRead.nlink !== 2 ||
        !temporaryBeforeRead.isFile() ||
        temporaryBeforeRead.isSymbolicLink() ||
        temporaryBeforeRead.nlink !== 2 ||
        !targetBeforeRead.isFile() ||
        targetBeforeRead.isSymbolicLink() ||
        targetBeforeRead.nlink !== 2 ||
        !sameIdentity(heldMetadata, heldBeforeRead) ||
        !sameIdentity(heldMetadata, temporaryBeforeRead) ||
        !sameIdentity(heldMetadata, targetBeforeRead)
      ) {
        throw atomicError(
          'ATOMIC_TARGET_ALIAS',
          'published target identity changed before descriptor verification',
        );
      }
      const expectedDigest = createHash('sha256').update(bytes).digest('hex');
      const observedDigest = createHash('sha256');
      let observedBytes = 0;
      /* eslint-disable no-await-in-loop -- one retained descriptor is streamed to its exact bound */
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(65_536, bytes.byteLength - observedBytes + 1));
        const observed = await handle.read(chunk, 0, chunk.byteLength, observedBytes);
        if (observed.bytesRead === 0) break;
        observedBytes += observed.bytesRead;
        if (observedBytes > bytes.byteLength) break;
        observedDigest.update(chunk.subarray(0, observed.bytesRead));
      }
      /* eslint-enable no-await-in-loop */
      if (observedBytes !== bytes.byteLength || observedDigest.digest('hex') !== expectedDigest) {
        throw atomicError('ATOMIC_TARGET_MISMATCH', 'published target bytes do not match');
      }
      const rechecked = await lstat(target);
      if (!sameIdentity(metadata, rechecked) || rechecked.nlink !== 2) {
        throw atomicError(
          'ATOMIC_TARGET_ALIAS',
          'published target identity changed during verification',
        );
      }
      publication = Object.freeze({ path: target, bytes: observedBytes });
    } catch (cause) {
      failure = linked ? committedMutationError(target, bytes.byteLength, cause) : cause;
    }
    await handle?.close().catch(error => {
      failure ??= error;
    });
    try {
      const cleanupTarget = await lstat(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (
        cleanupTarget !== null &&
        (temporaryIdentity === undefined || !sameIdentity(temporaryIdentity, cleanupTarget))
      ) {
        throw atomicError(
          'ATOMIC_TEMP_CHANGED',
          'atomic temporary pathname changed before cleanup',
        );
      }
      if (cleanupTarget !== null) await unlink(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const cleanupFailure =
          failure === undefined
            ? error
            : new AggregateError(
                [failure, error],
                'atomic create-new operation and cleanup failed',
              );
        failure = linked
          ? committedMutationError(target, bytes.byteLength, cleanupFailure)
          : cleanupFailure;
      }
    }
    if (failure !== undefined) throw failure;
    return publication as Readonly<AtomicFilePublication>;
  }

  async replace(
    target: string,
    bytes: Uint8Array,
    options: AtomicReplaceOptions,
  ): Promise<Readonly<AtomicFilePublication>> {
    if (!options.destructiveApproved) {
      throw atomicError('REPLACE_APPROVAL_REQUIRED', 'atomic replacement requires approval');
    }
    if (!/^[0-9a-f]{64}$/u.test(options.expectedDigest64)) {
      throw atomicError('EXPECTED_HASH_INVALID', 'atomic replacement expected hash is invalid');
    }
    const directory = dirname(target);
    await mkdir(directory, { recursive: true });
    const directoryMetadata = await lstat(directory);
    const maxReplaceBytes = this.options.maxReplaceBytes ?? 8_388_608;
    if (!Number.isSafeInteger(maxReplaceBytes) || maxReplaceBytes < 1) {
      throw atomicError('REPLACE_SOURCE_SIZE_LIMIT_INVALID', 'replace source limit is invalid');
    }
    if (bytes.byteLength > maxReplaceBytes) {
      throw Object.assign(
        atomicError(
          'REPLACE_SOURCE_SIZE_LIMIT_EXCEEDED',
          'replacement bytes exceed the source limit',
        ),
        { beforeRead: true, bytesRead: 0 },
      );
    }
    const newDigest64 = digest64(bytes);
    const temporary = join(directory, `.${basename(target)}.${newDigest64}.replace-new`);
    const retained = join(
      directory,
      `.${basename(target)}.${options.expectedDigest64}.${newDigest64}.replace-retained`,
    );
    const retainedLimits = this.options.retainedReplaceLimits ?? {
      maxRows: 64,
      maxBytes: 67_108_864,
      maxScanEntries: 10_000,
    };
    if (
      !Number.isSafeInteger(retainedLimits.maxRows) ||
      retainedLimits.maxRows < 1 ||
      !Number.isSafeInteger(retainedLimits.maxBytes) ||
      retainedLimits.maxBytes < 1 ||
      !Number.isSafeInteger(retainedLimits.maxScanEntries) ||
      retainedLimits.maxScanEntries < 1
    ) {
      throw atomicError('REPLACE_RETAINED_CAPACITY_INVALID', 'replace retained limits are invalid');
    }
    const inspectBytes = async (path: string, allowedLinks: readonly number[]) => {
      const before = await lstatMaybeAtomic(path);
      if (
        before === null ||
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.dev !== directoryMetadata.dev ||
        !allowedLinks.includes(before.nlink)
      ) {
        throw Object.assign(
          atomicError('TARGET_CHANGED', 'replacement state is not one retained regular file'),
          { beforeRead: true, bytesRead: 0 },
        );
      }
      if (before.size > maxReplaceBytes) {
        throw Object.assign(
          atomicError(
            'REPLACE_SOURCE_SIZE_LIMIT_EXCEEDED',
            'replacement source exceeds its bounded read limit',
          ),
          { beforeRead: true, bytesRead: 0 },
        );
      }
      const observed = await readFileWithinLimit(path, maxReplaceBytes, undefined, {
        expectedIdentity: before,
        allowedLinks,
        ...(this.options.beforeReplaceBodyRead === undefined
          ? {}
          : { beforeRead: () => this.options.beforeReplaceBodyRead!(path) }),
      });
      const after = await lstatMaybeAtomic(path);
      if (
        after === null ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.dev !== directoryMetadata.dev ||
        !sameIdentity(before, after) ||
        !allowedLinks.includes(after.nlink)
      ) {
        throw Object.assign(
          atomicError('TARGET_CHANGED', 'replacement state identity changed during read'),
          { beforeRead: false, bytesRead: observed.byteLength },
        );
      }
      return { identity: after, bytes: observed, digest64: digest64(observed) };
    };
    const verifyBytes = async (
      path: string,
      expectedDigest64: string,
      allowedLinks: readonly number[],
    ) => {
      const inspected = await inspectBytes(path, allowedLinks);
      if (inspected.digest64 !== expectedDigest64) {
        throw Object.assign(atomicError('TARGET_CHANGED', 'replacement state bytes changed'), {
          beforeRead: false,
          bytesRead: inspected.bytes.byteLength,
        });
      }
      return inspected;
    };
    let outputMutated = false;
    try {
      return await withCanonicalPathMutex(target, async () => {
        const cleanupIntent = join(directory, `.${basename(target)}.replace-cleanup`);
        const resumeCleanup = async () => {
          const intentIdentity = await lstatMaybeAtomic(cleanupIntent);
          if (intentIdentity === null) return null;
          const intentBytes = await readFileWithinLimit(cleanupIntent, 16_384, undefined, {
            expectedIdentity: intentIdentity,
            allowedLinks: [1],
          });
          const intent: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(intentBytes),
          );
          if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) {
            throw atomicError('TARGET_CHANGED', 'replacement cleanup intent is invalid');
          }
          const record = intent as Record<string, unknown>;
          if (
            record.version !== 1 ||
            record.target !== basename(target) ||
            typeof record.oldDigest64 !== 'string' ||
            !/^[0-9a-f]{64}$/u.test(record.oldDigest64) ||
            typeof record.newDigest64 !== 'string' ||
            !/^[0-9a-f]{64}$/u.test(record.newDigest64) ||
            typeof record.dev !== 'string' ||
            typeof record.ino !== 'string' ||
            !Number.isSafeInteger(record.bytes) ||
            (record.bytes as number) < 0 ||
            (record.bytes as number) > maxReplaceBytes
          )
            throw atomicError('TARGET_CHANGED', 'replacement cleanup intent binding is invalid');
          const obsoletePath = join(
            directory,
            `.${basename(target)}.${record.oldDigest64}.${record.newDigest64}.replace-retained`,
          );
          const obsolete = await lstatMaybeAtomic(obsoletePath);
          if (obsolete !== null) {
            const owned = await verifyBytes(obsoletePath, record.oldDigest64, [1]);
            if (
              String(owned.identity.dev) !== record.dev ||
              String(owned.identity.ino) !== record.ino ||
              owned.bytes.byteLength !== record.bytes
            ) {
              throw atomicError(
                'TARGET_CHANGED',
                'replacement cleanup generation ownership changed',
              );
            }
            // The durable intent plus the final descriptor read authorizes these exact bytes,
            // never merely a pathname or unchanged inode. Same-owner syscall races remain.
            const descriptor = openSync(obsoletePath, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              const held = fstatSync(descriptor);
              if (
                !held.isFile() ||
                held.nlink !== 1 ||
                !sameIdentity(owned.identity, held) ||
                held.size !== record.bytes
              ) {
                throw atomicError('TARGET_CHANGED', 'replacement cleanup descriptor changed');
              }
              const hash = createHash('sha256');
              const chunk = Buffer.allocUnsafe(65_536);
              let total = 0;
              for (;;) {
                const count = readSync(
                  descriptor,
                  chunk,
                  0,
                  Math.min(chunk.byteLength, (record.bytes as number) - total + 1),
                  total,
                );
                if (count === 0) break;
                total += count;
                if (total > (record.bytes as number))
                  throw atomicError('TARGET_CHANGED', 'replacement cleanup bytes grew');
                hash.update(chunk.subarray(0, count));
              }
              const pathname = lstatSync(obsoletePath);
              const after = fstatSync(descriptor);
              if (
                !pathname.isFile() ||
                pathname.isSymbolicLink() ||
                pathname.nlink !== 1 ||
                after.nlink !== 1 ||
                !sameIdentity(held, pathname) ||
                !sameIdentity(held, after) ||
                total !== record.bytes ||
                hash.digest('hex') !== record.oldDigest64
              ) {
                throw atomicError(
                  'TARGET_CHANGED',
                  'replacement cleanup bytes changed before deletion',
                );
              }
              unlinkSync(obsoletePath);
            } finally {
              closeSync(descriptor);
            }
            await fsyncDirectory(directory);
            await this.options.afterReplaceRetainedUnlinkFsync?.();
          }
          const currentIntent = await readFileWithinLimit(cleanupIntent, 16_384, undefined, {
            expectedIdentity: intentIdentity,
            allowedLinks: [1],
          });
          if (!Buffer.from(currentIntent).equals(Buffer.from(intentBytes))) {
            throw atomicError('TARGET_CHANGED', 'replacement cleanup intent changed');
          }
          await unlink(cleanupIntent);
          await fsyncDirectory(directory);
          return record;
        };
        const authorizeCleanup = async (
          oldDigest64: string,
          successorDigest64: string,
          obsolete: Awaited<ReturnType<typeof inspectBytes>>,
        ) => {
          const intentBytes = Buffer.from(
            `${JSON.stringify({
              version: 1,
              target: basename(target),
              oldDigest64,
              newDigest64: successorDigest64,
              dev: String(obsolete.identity.dev),
              ino: String(obsolete.identity.ino),
              bytes: obsolete.bytes.byteLength,
            })}\n`,
          );
          await new AtomicFileStore().createNew(cleanupIntent, intentBytes);
          await this.options.afterReplaceCleanupIntentFsync?.();
          await resumeCleanup();
        };
        // A durable intent authorizes only this exact obsolete inode and byte sequence. Legacy
        // retained files without such proof remain recovery material and continue to count.
        if (this.options.reclaimRetainedAfterPublish === true) {
          const resumed = await resumeCleanup();
          if (
            resumed?.oldDigest64 === options.expectedDigest64 &&
            resumed.newDigest64 === newDigest64
          ) {
            const current = await verifyBytes(target, newDigest64, [1]);
            return Object.freeze({ path: target, bytes: current.bytes.byteLength });
          }
        }
        const retainedPrefix = `.${basename(target)}.`;
        const retainedSuffix = '.replace-retained';
        const retainedMetrics = { scannedEntries: 0, retainedRows: 0, retainedBytes: 0 };
        const historical: Array<{
          path: string;
          oldDigest64: string;
          newDigest64: string;
          bytes: number;
        }> = [];
        const directoryStream = await opendir(directory, { bufferSize: 1 });
        for await (const entry of directoryStream) {
          if (retainedMetrics.scannedEntries >= retainedLimits.maxScanEntries) {
            throw Object.assign(
              atomicError(
                'REPLACE_RETAINED_CAPACITY_EXCEEDED',
                'replace retained scan capacity is exhausted',
              ),
              retainedMetrics,
            );
          }
          retainedMetrics.scannedEntries += 1;
          if (!entry.name.startsWith(retainedPrefix) || !entry.name.endsWith(retainedSuffix)) {
            continue;
          }
          const retainedNamePattern = /^\..+\.[0-9a-f]{64}\.[0-9a-f]{64}\.replace-retained$/u;
          if (!retainedNamePattern.test(entry.name)) continue;
          const path = join(directory, entry.name);
          const metadata = await lstat(path);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
            throw Object.assign(
              atomicError('TARGET_CHANGED', 'replace retained generation is not one regular file'),
              retainedMetrics,
            );
          }
          retainedMetrics.retainedRows += 1;
          retainedMetrics.retainedBytes += metadata.size;
          const binding = entry.name
            .slice(retainedPrefix.length, -retainedSuffix.length)
            .split('.');
          if (binding.length === 2)
            historical.push({
              path,
              oldDigest64: binding[0]!,
              newDigest64: binding[1]!,
              bytes: metadata.size,
            });
          if (
            (retainedMetrics.retainedRows > retainedLimits.maxRows ||
              retainedMetrics.retainedBytes > retainedLimits.maxBytes) &&
            !(
              this.options.reclaimRetainedAfterPublish === true &&
              this.options.verifyRetainedForReclamation !== undefined
            )
          ) {
            throw Object.assign(
              atomicError(
                'REPLACE_RETAINED_CAPACITY_EXCEEDED',
                'replace retained generation capacity is exhausted',
              ),
              retainedMetrics,
            );
          }
        }
        if (
          historical.length > 0 &&
          (await lstatMaybeAtomic(target)) !== null &&
          this.options.reclaimRetainedAfterPublish === true &&
          this.options.verifyRetainedForReclamation !== undefined
        ) {
          const current = await inspectBytes(target, [1, 2]);
          const publishedDigests = new Set([current.digest64]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const generation of historical) {
              if (
                publishedDigests.has(generation.newDigest64) &&
                !publishedDigests.has(generation.oldDigest64)
              ) {
                publishedDigests.add(generation.oldDigest64);
                changed = true;
              }
            }
          }
          /* eslint-disable no-await-in-loop -- each authenticated historical generation has its own durable cleanup intent */
          for (const generation of historical) {
            if (generation.path === retained) continue;
            if (!publishedDigests.has(generation.newDigest64)) continue;
            const obsolete = await verifyBytes(generation.path, generation.oldDigest64, [1]);
            await this.options.verifyRetainedForReclamation(obsolete.bytes);
            await authorizeCleanup(generation.oldDigest64, generation.newDigest64, obsolete);
            retainedMetrics.retainedRows -= 1;
            retainedMetrics.retainedBytes -= generation.bytes;
          }
          /* eslint-enable no-await-in-loop */
        }
        if (
          retainedMetrics.retainedRows > retainedLimits.maxRows ||
          retainedMetrics.retainedBytes > retainedLimits.maxBytes
        ) {
          throw Object.assign(
            atomicError(
              'REPLACE_RETAINED_CAPACITY_EXCEEDED',
              'unproved retained generations exceed capacity',
            ),
            retainedMetrics,
          );
        }
        let retainedState = await lstatMaybeAtomic(retained);
        let temporaryState = await lstatMaybeAtomic(temporary);
        let targetState = await lstatMaybeAtomic(target);
        if (retainedState !== null) outputMutated = true;

        if (retainedState === null && targetState !== null) {
          const prospectiveRows = retainedMetrics.retainedRows + 1;
          const prospectiveBytes = retainedMetrics.retainedBytes + targetState.size;
          if (
            prospectiveRows > retainedLimits.maxRows ||
            prospectiveBytes > retainedLimits.maxBytes
          ) {
            throw Object.assign(
              atomicError(
                'REPLACE_RETAINED_CAPACITY_EXCEEDED',
                'replace retained generation lacks prospective capacity',
              ),
              {
                ...retainedMetrics,
                retainedRows: retainedMetrics.retainedRows,
                retainedBytes: retainedMetrics.retainedBytes,
              },
            );
          }
        }

        const finishPublished = async (): Promise<Readonly<AtomicFilePublication>> => {
          const published = await verifyBytes(target, newDigest64, [1, 2]);
          temporaryState = await lstatMaybeAtomic(temporary);
          if (temporaryState !== null) {
            const prepared = await verifyBytes(temporary, newDigest64, [2]);
            if (!sameIdentity(prepared.identity, published.identity)) {
              throw atomicError('TARGET_CHANGED', 'replacement temporary alias is foreign');
            }
            await unlink(temporary);
            await fsyncDirectory(directory);
          }
          if (this.options.reclaimRetainedAfterPublish === true) {
            const obsolete = await verifyBytes(retained, options.expectedDigest64, [1]);
            await authorizeCleanup(options.expectedDigest64, newDigest64, obsolete);
          }
          return Object.freeze({ path: target, bytes: published.bytes.byteLength });
        };

        if (retainedState !== null) {
          const old = await verifyBytes(retained, options.expectedDigest64, [1, 2]);
          if (targetState !== null) {
            const current = await inspectBytes(target, [1, 2]);
            if (current.digest64 !== newDigest64) {
              if (
                current.digest64 === options.expectedDigest64 &&
                sameIdentity(old.identity, current.identity)
              ) {
                await unlink(target);
                await fsyncDirectory(directory);
                targetState = null;
              } else {
                throw atomicError('TARGET_CHANGED', 'foreign target won replacement recovery');
              }
            } else {
              return finishPublished();
            }
          }
          temporaryState = await lstatMaybeAtomic(temporary);
          if (temporaryState === null) {
            throw atomicError(
              'TARGET_CHANGED',
              'replacement recovery lost its prepared generation',
            );
          }
          await verifyBytes(temporary, newDigest64, [1]);
          await link(temporary, target);
          await fsyncDirectory(directory);
          await this.options.afterReplacePublishFsync?.();
          return finishPublished();
        }

        const before = await verifyBytes(target, options.expectedDigest64, [1]);
        if (temporaryState === null) {
          const temporaryHandle = await open(temporary, 'wx', 0o600);
          try {
            await temporaryHandle.writeFile(bytes);
            await temporaryHandle.sync();
          } finally {
            await temporaryHandle.close();
          }
          await this.options.afterReplaceTemporaryFsync?.();
        } else {
          await verifyBytes(temporary, newDigest64, [1]);
        }
        try {
          await this.options.beforeReplaceCommit?.(target);
          const immediatelyBeforeCommit = await lstatMaybeAtomic(target);
          if (
            immediatelyBeforeCommit === null ||
            !immediatelyBeforeCommit.isFile() ||
            immediatelyBeforeCommit.isSymbolicLink() ||
            immediatelyBeforeCommit.nlink !== 1 ||
            !sameIdentity(before.identity, immediatelyBeforeCommit)
          ) {
            throw atomicError('TARGET_CHANGED', 'replacement target changed before commit');
          }
          await verifyBytes(target, options.expectedDigest64, [1]);
          await rename(target, retained);
          outputMutated = true;
          await this.options.afterReplaceQuarantineRenameBeforeFsync?.();
          await fsyncDirectory(directory);
          retainedState = await lstatMaybeAtomic(retained);
          try {
            await verifyBytes(retained, options.expectedDigest64, [1]);
          } catch (conflict) {
            // An in-place edit can race rename. Restore through an exclusive link only; an
            // already published successor wins and the edited generation remains recoverable.
            const moved = await lstatMaybeAtomic(retained);
            if (
              moved !== null &&
              moved.isFile() &&
              !moved.isSymbolicLink() &&
              moved.nlink === 1 &&
              sameIdentity(before.identity, moved)
            ) {
              try {
                await link(retained, target);
                await fsyncDirectory(directory);
                const [restored, retainedNow] = await Promise.all([lstat(target), lstat(retained)]);
                if (
                  sameIdentity(moved, restored) &&
                  sameIdentity(moved, retainedNow) &&
                  restored.nlink === 2 &&
                  retainedNow.nlink === 2
                ) {
                  await unlink(retained);
                  await fsyncDirectory(directory);
                }
              } catch (restoreError) {
                if ((restoreError as NodeJS.ErrnoException).code !== 'EEXIST') {
                  throw Object.assign(
                    atomicError(
                      'TARGET_CHANGED',
                      'edited replacement requires explicit recovery',
                      conflict,
                    ),
                    { recoveryPath: retained, restorationError: restoreError },
                  );
                }
              }
            }
            throw Object.assign(
              atomicError(
                'TARGET_CHANGED',
                'edited replacement generation was preserved',
                conflict,
              ),
              { recoveryPath: retained, visiblePath: target },
            );
          }
          await this.options.afterReplaceQuarantineFsync?.();
          try {
            await link(temporary, target);
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
              const current = await lstatMaybeAtomic(target);
              if (current === null) {
                await link(retained, target).catch(() => undefined);
                await fsyncDirectory(directory);
              }
            }
            throw atomicError(
              (cause as NodeJS.ErrnoException).code === 'EEXIST'
                ? 'TARGET_CHANGED'
                : 'ATOMIC_LINK_FAILED',
              'exclusive replacement publication failed',
              cause,
            );
          }
          await fsyncDirectory(directory);
          await this.options.afterReplacePublishFsync?.();
          return finishPublished();
        } catch (error) {
          retainedState = await lstatMaybeAtomic(retained);
          if (retainedState === null) {
            try {
              await unlink(temporary);
            } catch (cleanupError) {
              if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw new AggregateError(
                  [error, cleanupError],
                  'atomic replace operation and cleanup failed',
                  { cause: cleanupError },
                );
              }
            }
          }
          throw error;
        }
      });
    } catch (error) {
      if (!outputMutated) throw error;
      throw committedMutationError(target, bytes.byteLength, error);
    }
  }
}

/** WorkspacePolicy-bound writer used by server adapters. Raw paths are never created first. */
export class WorkspaceAtomicFileStore implements AtomicWritePort {
  constructor(
    private readonly dependencies: {
      workspaceId: string;
      workspacePolicy: WorkspacePolicy;
      atomicFiles: AtomicFileStore;
      beforeParentUse?: (path: string) => Promise<void>;
      afterFinalResolveBeforeUse?: (path: string) => Promise<void>;
    },
  ) {}

  private publicationPath(
    target: string,
    publication: AtomicFilePublication,
  ): AtomicFilePublication {
    return Object.freeze({
      ...publication,
      path: isAbsolute(target) ? target : target.replaceAll('\\', '/'),
    });
  }

  private policyPath(target: string): string {
    return !isAbsolute(target) && process.platform === 'win32'
      ? target.replaceAll('/', sep)
      : target;
  }

  private async registeredRoot(policyTarget: string, resolvedTarget: string): Promise<string> {
    const configured = await this.dependencies.workspacePolicy.resolveRoot?.(
      this.dependencies.workspaceId,
    );
    if (configured !== undefined) return configured;
    if (isAbsolute(policyTarget)) {
      throw atomicError('TARGET_CHANGED', 'workspace root directory authority is unavailable');
    }
    let derived = resolvedTarget;
    for (const segment of policyTarget.split(sep).filter(Boolean)) {
      if (segment === '.') continue;
      derived = dirname(derived);
    }
    return derived;
  }

  async createNew(target: string, bytes: Uint8Array): Promise<Readonly<AtomicFilePublication>> {
    const policyTarget = this.policyPath(target);
    const first = await this.dependencies.workspacePolicy.resolveWrite(
      this.dependencies.workspaceId,
      policyTarget,
    );
    if (first.overwrites) {
      throw atomicError('TARGET_ALREADY_EXISTS', 'workspace create-new target already exists');
    }
    const root = await this.registeredRoot(policyTarget, first.path);
    const parent = dirname(first.path);
    await this.dependencies.beforeParentUse?.(parent);
    return withRetainedDirectoryChain(
      root,
      parent,
      async authority => {
        const final = await this.dependencies.workspacePolicy.resolveWrite(
          this.dependencies.workspaceId,
          policyTarget,
        );
        if (final.overwrites || final.path !== first.path) {
          throw atomicError('TARGET_CHANGED', 'workspace create-new authority changed before use');
        }
        return this.publicationPath(
          target,
          await this.dependencies.atomicFiles.createNew(
            authority.child(basename(final.path)),
            bytes,
          ),
        );
      },
      {
        createMissing: true,
        ...(this.dependencies.afterFinalResolveBeforeUse === undefined
          ? {}
          : { afterLeafOpen: () => this.dependencies.afterFinalResolveBeforeUse!(parent) }),
        errorCode: 'TARGET_CHANGED',
      },
    );
  }

  async replace(
    target: string,
    bytes: Uint8Array,
    options: AtomicReplaceOptions,
  ): Promise<Readonly<AtomicFilePublication>> {
    const policyTarget = this.policyPath(target);
    const resolved = await this.dependencies.workspacePolicy.resolveWrite(
      this.dependencies.workspaceId,
      policyTarget,
    );
    if (!resolved.overwrites) {
      throw atomicError('TARGET_CHANGED', 'workspace replacement target does not exist');
    }
    const root = await this.registeredRoot(policyTarget, resolved.path);
    await this.dependencies.beforeParentUse?.(dirname(resolved.path));
    const parent = dirname(resolved.path);
    return withRetainedDirectoryChain(
      root,
      parent,
      async authority => {
        const final = await this.dependencies.workspacePolicy.resolveWrite(
          this.dependencies.workspaceId,
          policyTarget,
        );
        if (!final.overwrites || final.path !== resolved.path) {
          throw atomicError('TARGET_CHANGED', 'workspace replacement authority changed before use');
        }
        return this.publicationPath(
          target,
          await this.dependencies.atomicFiles.replace(
            authority.child(basename(final.path)),
            bytes,
            options,
          ),
        );
      },
      {
        ...(this.dependencies.afterFinalResolveBeforeUse === undefined
          ? {}
          : { afterLeafOpen: () => this.dependencies.afterFinalResolveBeforeUse!(parent) }),
        errorCode: 'TARGET_CHANGED',
      },
    );
  }
}
