import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ControlClient } from './control-client.js';

export const runtimePaths = async () => {
  const entry = createRequire(import.meta.url).resolve('@sfp/mcp');
  const packedPlugin = resolve(dirname(entry), 'plugin');
  const pluginRoot = await access(resolve(packedPlugin, 'manifest.json')).then(
    () => packedPlugin,
    () => resolve(dirname(entry), '../../plugin'),
  );
  return { entry, pluginRoot, buildInfo: resolve(dirname(entry), 'build-info.json') };
};

export const ensureLocalServer = async (
  client: ControlClient,
): Promise<Readonly<{ owned: boolean; close(): Promise<void> }>> => {
  const { entry, buildInfo } = await runtimePaths();
  await access(entry);
  const expected = JSON.parse(await readFile(buildInfo, 'utf8')) as { identity?: string };
  if (typeof expected.identity !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(expected.identity))
    throw new Error('SERVER_BUILD_INFO_INVALID');
  const matches = async () =>
    (await client.health()) && (await client.status()).buildIdentityHash === expected.identity;
  if (await matches()) return { owned: false, close: async () => undefined };
  const child: ChildProcess = spawn(process.execPath, [entry], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let failed: Error | null = null;
  child.once('error', error => {
    failed = error;
  });
  // Drain diagnostics without exposing authentication data or retaining unbounded output.
  child.stderr?.resume();
  const close = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    child.stdin?.end();
    const ended = new Promise<void>(done => child.once('exit', () => done()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ended,
        new Promise<void>(done => {
          timer = setTimeout(done, 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (child.exitCode === null) child.kill();
  };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (failed !== null || child.exitCode !== null) {
      // eslint-disable-next-line no-await-in-loop -- only the owned failed child is closed
      await close();
      throw failed ?? new Error('LOCAL_SERVER_START_FAILED');
    }
    // eslint-disable-next-line no-await-in-loop -- bounded startup polling
    if (await matches()) return { owned: true, close };
    // eslint-disable-next-line no-await-in-loop -- bounded startup polling
    await delay(1_000);
  }
  await close();
  throw new Error('LOCAL_SERVER_START_TIMEOUT');
};
