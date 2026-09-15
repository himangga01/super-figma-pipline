import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

export interface RetainedChromeTransport {
  endpoint: string;
  headers: Record<string, string>;
  state(): 'not-requested' | 'awaiting-browser' | 'connected' | 'unavailable';
  close(): Promise<void>;
}

const forbidden = new Set([
  'Browser.close',
  'Browser.setDownloadBehavior',
  'Target.createTarget',
  'Target.closeTarget',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Page.navigate',
  'Page.navigateToHistoryEntry',
  'Page.reload',
]);

/** Keep the Chrome permission handshake independent of a single Playwright caller's timeout. */
export const createRetainedChromeTransport = async (
  remoteEndpoint: string,
): Promise<RetainedChromeTransport> => {
  const url = new URL(remoteEndpoint);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('CHROME_CDP_INVALID');
  const authorization = `Bearer ${randomBytes(32).toString('base64url')}`;
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 33_554_432,
  });
  let remote: WebSocket | null = null;
  let client: WebSocket | null = null;
  let closed = false;
  let failed = false;
  let sequence = 0;
  let queuedBytes = 0;
  let queued: Array<{ owner: WebSocket; message: string }> = [];
  const pending = new Map<number, { owner: WebSocket; originalId: number }>();
  const resets = new Set<number>();
  const flush = () => {
    if (remote?.readyState !== WebSocket.OPEN || resets.size) return;
    for (const item of queued)
      if (item.owner === client && item.owner.readyState === WebSocket.OPEN)
        remote.send(item.message);
    queued = [];
    queuedBytes = 0;
  };

  const clearClient = (socket: WebSocket) => {
    if (client !== socket) return;
    client = null;
    queued = [];
    queuedBytes = 0;
    pending.clear();
    if (remote?.readyState === WebSocket.OPEN) {
      // Disable only this connection's automatic target attachments, never close user tabs.
      const autoAttachId = ++sequence,
        discoveryId = ++sequence;
      resets.add(autoAttachId);
      resets.add(discoveryId);
      remote.send(
        JSON.stringify({
          id: autoAttachId,
          method: 'Target.setAutoAttach',
          params: { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
        }),
      );
      remote.send(
        JSON.stringify({
          id: discoveryId,
          method: 'Target.setDiscoverTargets',
          params: { discover: false },
        }),
      );
    }
  };
  const fail = () => {
    failed = true;
    queued = [];
    queuedBytes = 0;
    pending.clear();
    resets.clear();
    client?.close(1011, 'Chrome connection unavailable');
  };
  const ensureRemote = () => {
    if (remote || closed || failed) return;
    // No handshake timeout: the single permission request lives until owner approval or shutdown.
    remote = new WebSocket(remoteEndpoint, { perMessageDeflate: false, maxPayload: 33_554_432 });
    remote.on('open', flush);
    remote.on('error', fail);
    remote.on('close', fail);
    remote.on('message', (data, binary) => {
      if (binary || closed) return;
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (typeof message.id === 'number') {
          if (resets.delete(message.id)) {
            if (message.error) fail();
            else flush();
            return;
          }
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (request?.owner === client && client?.readyState === WebSocket.OPEN)
            client.send(JSON.stringify({ ...message, id: request.originalId }));
        } else if (!resets.size && client?.readyState === WebSocket.OPEN)
          client.send(data.toString());
      } catch {
        fail();
      }
    });
  };
  sockets.on('connection', socket => {
    client = socket;
    socket.on('error', () => clearClient(socket));
    socket.on('close', () => clearClient(socket));
    socket.on('message', (data, binary) => {
      if (binary || socket !== client || failed || closed) {
        socket.close(1008);
        return;
      }
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!Number.isSafeInteger(message.id) || typeof message.method !== 'string') {
          socket.close(1008);
          return;
        }
        if (forbidden.has(message.method)) {
          socket.send(
            JSON.stringify({
              id: message.id,
              ...(typeof message.sessionId === 'string' ? { sessionId: message.sessionId } : {}),
              error: { code: -32601, message: 'The existing browser connection is attach-only' },
            }),
          );
          return;
        }
        if (pending.size >= 1024) {
          socket.close(1009);
          return;
        }
        const id = ++sequence;
        pending.set(id, { owner: socket, originalId: message.id as number });
        const encoded = JSON.stringify({ ...message, id });
        ensureRemote();
        if (remote?.readyState === WebSocket.OPEN && !resets.size) remote.send(encoded);
        else {
          queuedBytes += Buffer.byteLength(encoded);
          if (queued.length >= 64 || queuedBytes > 1_048_576) {
            socket.close(1009);
            return;
          }
          queued.push({ owner: socket, message: encoded });
        }
      } catch {
        socket.close(1008);
      }
    });
  });
  server.on('upgrade', (request, socket, head) => {
    const supplied = request.headers.authorization;
    if (
      closed ||
      failed ||
      request.url !== '/chrome-cdp' ||
      request.headers.origin !== undefined ||
      typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(authorization) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(authorization))
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    if (client !== null) {
      socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, connection =>
      sockets.emit('connection', connection, request),
    );
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('CHROME_TRANSPORT_LISTEN_FAILED');
  return {
    endpoint: `ws://127.0.0.1:${address.port}/chrome-cdp`,
    headers: { Authorization: authorization },
    state: () =>
      closed || failed
        ? 'unavailable'
        : remote === null
          ? 'not-requested'
          : remote.readyState === WebSocket.OPEN
            ? 'connected'
            : 'awaiting-browser',
    async close() {
      if (closed) return;
      closed = true;
      remote?.terminate();
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      await new Promise<void>(done => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
};
