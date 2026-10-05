import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

import { windowsDirectoryLeaseInvocation } from './atomic-file.js';
import { directoryLeaseTarget } from './windows-directory-lease-broker.js';

export const WINDOWS_DIRECTORY_PUBLICATION_PROTOCOL = 'windows-directory-publication-v1' as const;
const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$source = @'
using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
[StructLayout(LayoutKind.Sequential)]
public struct SfpCreationInformation {
  public uint Attributes;
  public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
  public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
}
public static class SfpDirectoryPublication {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out SfpCreationInformation value);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool MoveFileExW([MarshalAs(UnmanagedType.LPWStr)] string source,
    [MarshalAs(UnmanagedType.LPWStr)] string destination, uint flags);
  public static string Publish(string source, string destination, string identity) {
    if (!String.Equals(source.Substring(0, source.LastIndexOf('\\')),
      destination.Substring(0, destination.LastIndexOf('\\')),
      StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("parent mismatch");
    // Retain the observed inode across the fixed move. Sharing DELETE permits this pathname
    // operation; same-owner changes between identity check and syscall remain outcome-unknown.
    using (SafeFileHandle handle = CreateFileW(source, 0x80, 7, IntPtr.Zero, 3,
      0x02200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      SfpCreationInformation info;
      if (!GetFileInformationByHandle(handle, out info))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      string actual = info.Volume.ToString(CultureInfo.InvariantCulture) + ":" +
        (((ulong)info.IndexHigh << 32) | info.IndexLow).ToString(CultureInfo.InvariantCulture);
      if ((info.Attributes & 0x10) == 0 || (info.Attributes & 0x400) != 0 || actual != identity)
        throw new ArgumentException("staged identity mismatch");
      // Zero flags: no replacement, copy/delete, delayed move, or cross-volume fallback.
      if (!MoveFileExW(source, destination, 0))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      return actual;
    }
  }
}
'@
try {
  if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw 'restricted language mode' }
  Add-Type -TypeDefinition $source -ErrorAction Stop
  $value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SFP_DIRECTORY_PUBLICATION)) | ConvertFrom-Json
  $result = [SfpDirectoryPublication]::Publish([string]$value.source, [string]$value.destination, [string]$value.identity)
  [Console]::Out.WriteLine('PUBLISHED windows-directory-publication-v1 ' + $result)
  exit 0
} catch {
  [Console]::Error.WriteLine('DIRECTORY_PUBLICATION_FAILED')
  exit 1
}
`;
export const windowsDirectoryPublicationProgramHash =
  `sha256:${createHash('sha256').update(script).digest('hex')}` as const;
export const windowsDirectoryPublicationInvocation = () => ({
  protocol: WINDOWS_DIRECTORY_PUBLICATION_PROTOCOL,
  programHash: windowsDirectoryPublicationProgramHash,
  executable: windowsDirectoryLeaseInvocation().executable,
  args: [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ],
  timeoutMs: 15000,
  maxBuffer: 8192,
});
/** A fixed, no-replacement rename of one identity-bound staged directory to a sibling path. */
export const publishWindowsDirectory = async (
  source: string,
  destination: string,
  identity: string,
): Promise<void> => {
  if (
    process.platform !== 'win32' ||
    !isAbsolute(source) ||
    !isAbsolute(destination) ||
    dirname(source) !== dirname(destination) ||
    source === destination ||
    !/^\.sfp-native-directory-[0-9a-f-]{36}$/u.test(basename(source)) ||
    !/^[0-9]+:[0-9]+$/u.test(identity)
  )
    throw Object.assign(new Error('DIRECTORY_PUBLICATION_INVALID'), {
      code: 'DIRECTORY_PUBLICATION_INVALID',
    });
  const invocation = windowsDirectoryPublicationInvocation();
  const result = await promisify(execFile)(invocation.executable, invocation.args, {
    windowsHide: true,
    shell: false,
    timeout: invocation.timeoutMs,
    maxBuffer: invocation.maxBuffer,
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      SFP_DIRECTORY_PUBLICATION: Buffer.from(
        JSON.stringify({
          source: directoryLeaseTarget(source),
          destination: directoryLeaseTarget(destination),
          identity,
        }),
      ).toString('base64'),
    },
  });
  if (
    result.stdout.trim() !== `PUBLISHED ${invocation.protocol} ${identity}` ||
    result.stderr.trim()
  )
    throw Object.assign(new Error('DIRECTORY_PUBLICATION_INVALID'), {
      code: 'DIRECTORY_PUBLICATION_INVALID',
      stdout: result.stdout,
      stderr: result.stderr,
    });
};
