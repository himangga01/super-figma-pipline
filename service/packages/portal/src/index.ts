import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { Diagnostics, diagnosticError } from '../../mcp/src/diagnostics.js';
import { PortalBridge } from './bridge.js';
import { publicError } from './contract.js';
import { createServiceControl } from './control.js';
import { createPortalServer } from './server.js';
import { PortalStore } from './store.js';
let diagnostics: Diagnostics | undefined;

async function main(): Promise<void> {
  const port = Number(process.env.SFP_PORTAL_PORT ?? '4310');
  const controlPort = Number(process.env.SFP_CONTROL_PORT ?? '3055');
  if (![port, controlPort].every(v => Number.isInteger(v) && v >= 1024 && v <= 65535))
    throw new Error('Invalid port');
  const directory = resolve(
    process.env.SFP_PORTAL_STATE_ROOT ??
      join(process.env.LOCALAPPDATA ?? homedir(), 'SuperFigmaPipeline', 'web-portal'),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, 'server.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1)
      throw new Error('Portal state lock needs inspection', { cause: error });
    try {
      process.kill(pid, 0);
      throw new Error('Portal state is already in use', { cause: error });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  diagnostics = new Diagnostics(directory, 'portal');
  try {
    const store = await PortalStore.open(directory);
    await store.recoverInterrupted();
    const control = await createServiceControl({
      port: controlPort,
      ...(process.env.SFP_STATE_ROOT ? { stateRoot: process.env.SFP_STATE_ROOT } : {}),
    });
    const server = createPortalServer({
      diagnostics,
      store,
      bridge: new PortalBridge(store, control),
      webRoot: resolve(import.meta.dirname, '../web'),
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolveListen);
    });
    process.stdout.write(`Super Figma Pipeline portal: http://127.0.0.1:${port}\n`);
    diagnostics.record('portal.ready');
    const stop = () => {
      server.close(error => {
        // eslint-disable-next-line promise/no-promise-in-callback -- release the owned state lock after Node's close callback reports diagnostics completion
        void unlink(lockPath).finally(() => process.exit(error ? 1 : 0));
      });
      server.closeIdleConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await unlink(lockPath);
    throw error;
  }
}
void main().catch(async error => {
  diagnostics?.record('portal.startup-error', {}, error, 'error');
  const flushed = await diagnostics?.flush();
  if (!diagnostics)
    process.stderr.write(
      JSON.stringify({
        component: 'portal',
        event: 'portal.startup-error',
        error: diagnosticError(error),
      }) + '\n',
    );
  const safe = publicError(error);
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
  if (flushed === false) process.exit(1);
});
