import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';

import type { NativeEnvironmentLifecycle } from './native-lifecycle.js';
import { portalError } from './store.js';

/**
 * One bounded local pipe with a separate secret control token for the trusted broker only. This is
 * owner-account coordination, not protection against arbitrary same-account code.
 */
export async function nativeProcessControl(
  lifecycle: NativeEnvironmentLifecycle,
  attemptId: string,
  commandId: string,
  executableHash: string,
  signal: AbortSignal,
) {
  const token = randomUUID(),
    pipeName = `sfp-native-${randomUUID()}`,
    path = `\\\\.\\pipe\\${pipeName}`;
  let socket: Socket | undefined,
    stopped = false,
    expectedPid: number | undefined,
    protocolError: unknown;
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  try {
    await lifecycle.beforeLaunch(attemptId, commandId, token, executableHash);
  } catch (error) {
    server.close();
    throw error;
  }
  let pending = Promise.resolve();
  let stopRequested = signal.aborted;
  let receiptResolve!: () => void;
  const receiptArrived = new Promise<void>(resolve => {
    receiptResolve = resolve;
  });
  const onAbort = () => {
    stopRequested = true;
    socket?.write('STOP\n');
  };
  signal.addEventListener('abort', onAbort, { once: true });
  server.on('connection', connection => {
    if (socket) {
      connection.destroy();
      return;
    }
    socket = connection;
    let buffer = '';
    connection.on('error', () => {
      // Transport closure cannot prove a stop, or invalidate a matching STOPPED receipt that
      // subsequently becomes durable. finish still rejects absent proof and protocol mismatch.
    });
    connection.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 1024) {
        protocolError = portalError('PORTAL_ENVIRONMENT_PROCESS_PROTOCOL');
        connection.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        pending = pending
          .then(async () => {
            const match = /^(READY|STOPPED)\|([a-f0-9-]{36})\|(\d{1,10})\|(\d{1,24})$/u.exec(line);
            if (!match || match[2] !== token || Number(match[3]) !== expectedPid)
              throw portalError('PORTAL_ENVIRONMENT_PROCESS_PROTOCOL');
            if (match[1] === 'READY') {
              await lifecycle.permit(attemptId, token, Number(match[3]), match[4]!);
              connection.write(signal.aborted || stopRequested ? 'STOP\n' : 'PERMIT\n');
            } else {
              await lifecycle.stopped(attemptId, token, Number(match[3]), match[4]!);
              stopped = true;
              connection.write('ACK\n');
              receiptResolve();
            }
            return undefined;
          })
          .catch(error => {
            protocolError = error;
            connection.destroy();
          });
      }
    });
  });
  return {
    pipeName,
    token,
    spawned: (pid: number | undefined) => {
      expectedPid = pid;
    },
    stop: () => {
      stopRequested = true;
      socket?.write('STOP\n');
    },
    async finish() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          receiptArrived,
          new Promise<void>(resolve => {
            timer = setTimeout(resolve, 1000);
          }),
        ]);
        await pending;
        if (protocolError || !stopped) throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      signal.removeEventListener('abort', onAbort);
      socket?.destroy();
      server.close();
    },
  };
}
