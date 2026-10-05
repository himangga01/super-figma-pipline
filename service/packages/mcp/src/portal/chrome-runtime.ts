import { realpathSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

/** Resolve the installed Google Chrome stable binary for hash-bound native previews. */
export const googleChromeExecutable = (
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
  } = {},
): string | undefined => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const candidates =
    platform === 'win32'
      ? [
          environment.ProgramW6432,
          environment.ProgramFiles,
          environment['ProgramFiles(x86)'],
          'C:\\Program Files',
          'C:\\Program Files (x86)',
          environment.LOCALAPPDATA,
        ]
          .filter((root): root is string => Boolean(root))
          .map(root => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : platform === 'linux'
          ? ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']
          : [];
  for (const candidate of new Set(candidates)) {
    try {
      if (statSync(candidate).isFile()) return realpathSync.native(candidate);
    } catch {
      // An absent/inaccessible installation remains an explicit preview prerequisite.
    }
  }
  return undefined;
};
