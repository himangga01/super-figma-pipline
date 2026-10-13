import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Windows ships a libarchive tar that supports both tgz and zip, unlike Git's GNU tar. */
export const resolveArchiveTar = () => {
  if (process.platform !== 'win32') return 'tar';
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error('WINDOWS_NATIVE_TAR_UNAVAILABLE');
  const executable = join(systemRoot, 'System32', 'tar.exe');
  if (!existsSync(executable)) throw new Error('WINDOWS_NATIVE_TAR_UNAVAILABLE');
  return executable;
};
