import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Read only Chrome's small discovery record; never read/copy cookies or launch a browser. */
export const resolveExistingChromeEndpoint = async (
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
  } = {},
): Promise<string> => {
  const environment = options.environment ?? process.env,
    platform = options.platform ?? process.platform,
    homeDirectory = options.homeDirectory ?? homedir();
  const directory =
    environment.SFP_CHROME_USER_DATA_DIR ??
    (platform === 'win32'
      ? environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
        : null
      : platform === 'darwin'
        ? join(homeDirectory, 'Library', 'Application Support', 'Google', 'Chrome')
        : platform === 'linux'
          ? join(environment.XDG_CONFIG_HOME ?? join(homeDirectory, '.config'), 'google-chrome')
          : null);
  if (!directory) return 'chrome';
  if (!isAbsolute(directory))
    throw new Error('CHROME_CDP_RECORD_INVALID: Chrome data directory must be absolute');
  const path = join(directory, 'DevToolsActivePort');
  const before = await lstat(path, { bigint: true }).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!before) return 'chrome';
  if (before.isSymbolicLink() || !before.isFile() || before.size > 4096n)
    throw new Error('CHROME_CDP_RECORD_INVALID: invalid Chrome debugging discovery record');
  const handle = await open(path, 'r');
  try {
    const held = await handle.stat({ bigint: true });
    if (held.ino !== before.ino || held.dev !== before.dev || held.size > 4096n)
      throw new Error('CHROME_CDP_RECORD_CHANGED');
    const bytes = Buffer.alloc(4097),
      { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) throw new Error('CHROME_CDP_RECORD_INVALID');
    const lines = bytes.subarray(0, bytesRead).toString('utf8').trim().split(/\r?\n/u);
    const port = Number(lines[0]),
      browserPath = lines[1] ?? '/devtools/browser';
    if (
      !/^\d{1,5}$/u.test(lines[0] ?? '') ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !/^\/devtools\/browser(?:\/[A-Za-z0-9-]{1,128})?$/u.test(browserPath)
    )
      throw new Error('CHROME_CDP_RECORD_INVALID: invalid local browser endpoint');
    // The second line is required by Chrome instances whose root /devtools/browser endpoint is unavailable.
    return `ws://127.0.0.1:${port}${browserPath}`;
  } finally {
    await handle.close();
  }
};
