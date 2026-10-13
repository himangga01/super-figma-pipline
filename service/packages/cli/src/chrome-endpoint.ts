import { lstat, open } from 'node:fs/promises';
import { get } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { assertLoopbackCdp } from './figma-url.js';

const connectionRequired = () =>
  Object.assign(
    new Error(
      'CHROME_CONNECTION_REQUIRED: enable remote debugging in the existing Google Chrome session, or provide its loopback --cdp endpoint or SFP_CHROME_USER_DATA_DIR',
    ),
    { code: 'CHROME_CONNECTION_REQUIRED' },
  );
const invalidEndpoint = () =>
  Object.assign(new Error('CHROME_CDP_INVALID: use a loopback Chrome debugging endpoint'), {
    code: 'CHROME_CDP_INVALID',
  });
const validatedEndpoint = (input: string) => {
  try {
    return assertLoopbackCdp(input);
  } catch {
    throw invalidEndpoint();
  }
};

/** Resolve only Chrome's loopback HTTP discovery route before the retained WebSocket relay. */
export const resolveChromeWebSocketEndpoint = async (
  input: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> => {
  options.signal?.throwIfAborted();
  const url = new URL(validatedEndpoint(input));
  if (url.protocol === 'ws:') return url.href;
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.pathname += 'json/version/';
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 60_000, 60_000));
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const request = get(url, { signal: options.signal }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(connectionRequired());
        request.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 4096) {
          reject(invalidEndpoint());
          request.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () =>
        reject(options.signal?.aborted ? options.signal.reason : connectionRequired()),
      );
    });
    const timer = setTimeout(() => request.destroy(connectionRequired()), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () =>
      reject(options.signal?.aborted ? options.signal.reason : connectionRequired()),
    );
  });
  options.signal?.throwIfAborted();
  let result: unknown;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalidEndpoint();
  }
  if (
    !result ||
    typeof result !== 'object' ||
    !('webSocketDebuggerUrl' in result) ||
    typeof result.webSocketDebuggerUrl !== 'string'
  )
    throw invalidEndpoint();
  const endpoint = validatedEndpoint(result.webSocketDebuggerUrl);
  if (!endpoint.startsWith('ws:')) throw invalidEndpoint();
  return endpoint;
};

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
  if (!directory) throw connectionRequired();
  if (!isAbsolute(directory))
    throw new Error('CHROME_CDP_RECORD_INVALID: Chrome data directory must be absolute');
  const path = join(directory, 'DevToolsActivePort');
  const before = await lstat(path, { bigint: true }).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!before) throw connectionRequired();
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
