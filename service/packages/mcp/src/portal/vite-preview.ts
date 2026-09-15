import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { portalError } from './store.js';

/** A trusted validation helper, executed inside the native runner's owned process lifetime. */
export const withNativeVitePreview = async <T>(
  root: string,
  work: (baseUrl: string) => Promise<T>,
): Promise<T> => {
  const directory = resolve(root);
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw portalError('PORTAL_PREVIEW_PORT_FAILED');
  const port = address.port;
  await new Promise<void>(done => reservation.close(() => done()));
  const child = spawn(
    process.execPath,
    [
      join(directory, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let spawnError: Error | null = null;
  child.once('error', error => {
    spawnError = error;
  });
  child.stdout.resume();
  child.stderr.resume();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw portalError('PORTAL_VITE_START_FAILED');
      try {
        // eslint-disable-next-line no-await-in-loop -- readiness belongs to this one owned server
        const response = await fetch(baseUrl, {
          signal: AbortSignal.timeout(500),
          redirect: 'error',
        });
        ready = response.ok;
        // eslint-disable-next-line no-await-in-loop -- do not retain readiness response sockets
        await response.body?.cancel();
      } catch {
        /* The owned server has not bound its port yet. */
      }
      if (ready) break;
      // eslint-disable-next-line no-await-in-loop -- bounded readiness polling, never browser reconnects
      await delay(100);
    }
    if (!ready) throw portalError('PORTAL_VITE_READY_TIMEOUT');
    return await work(baseUrl);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(done => child.once('exit', () => done()));
      child.kill();
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
};
