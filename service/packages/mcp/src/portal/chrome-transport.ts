import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

export interface RetainedChromeTransport {
  endpoint: string;
  headers: Record<string, string>;
  state(): 'not-requested' | 'awaiting-browser' | 'connected' | 'unavailable';
  diagnostics(): {
    sent: number;
    received: number;
    pendingMethods: string[];
    pendingResets: number;
  };
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
  scope?: { matchesTarget(url: string): boolean },
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
  let sent = 0;
  let received = 0;
  let lastPendingMethods: string[] = [];
  let queuedBytes = 0;
  let queued: Array<{ owner: WebSocket; message: string }> = [];
  const pending = new Map<
    number,
    {
      owner: WebSocket;
      originalId: number;
      method: string;
      scopedAttach?: { waitForDebuggerOnStart: boolean };
      scopedRoot?: boolean;
    }
  >();
  const resets = new Set<number>();
  const ownedAttachments = new Set<string>();
  const pendingMethods = () =>
    [...new Set([...pending.values()].map(item => item.method))].slice(0, 32);
  const flush = () => {
    if (remote?.readyState !== WebSocket.OPEN || resets.size) return;
    for (const item of queued)
      if (item.owner === client && item.owner.readyState === WebSocket.OPEN) {
        sent++;
        remote.send(item.message);
      }
    queued = [];
    queuedBytes = 0;
  };

  const clearClient = (socket: WebSocket) => {
    if (client !== socket) return;
    const attachmentUnsettled = [...pending.values()].some(request => request.scopedRoot);
    client = null;
    queued = [];
    queuedBytes = 0;
    lastPendingMethods = pendingMethods();
    pending.clear();
    if (attachmentUnsettled) {
      // The root attachment may have taken effect. Closing this CDP connection detaches
      // only its debugger sessions; never replay an attachment with an unknown outcome.
      remote?.terminate();
      failed = true;
      return;
    }
    if (remote?.readyState === WebSocket.OPEN) {
      for (const sessionId of ownedAttachments) {
        const id = ++sequence;
        resets.add(id);
        remote.send(
          JSON.stringify({ id, method: 'Target.detachFromTarget', params: { sessionId } }),
        );
      }
      ownedAttachments.clear();
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
    const reason =
      pending.size > 0
        ? 'Chrome connection unavailable; pending outcomes unknown'
        : 'Chrome connection unavailable';
    failed = true;
    queued = [];
    queuedBytes = 0;
    pending.clear();
    resets.clear();
    client?.close(1011, reason);
  };
  const ensureRemote = (userAgent: string | undefined) => {
    if (remote || closed || failed) return;
    // No handshake timeout: the single permission request lives until owner approval or shutdown.
    remote = new WebSocket(remoteEndpoint, {
      perMessageDeflate: false,
      maxPayload: 33_554_432,
      // Preserve the authenticated Playwright client's real identity across the relay.
      // Never forward the private relay credential, cookies or other client headers.
      ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
    });
    remote.on('open', flush);
    remote.on('error', fail);
    remote.on('close', fail);
    remote.on('message', (data, binary) => {
      if (binary || closed) return;
      received++;
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
          if (request?.scopedRoot && !message.error) {
            const sessionId = (message.result as { sessionId?: unknown } | undefined)?.sessionId;
            if (typeof sessionId !== 'string') {
              fail();
              return;
            }
            ownedAttachments.add(sessionId);
          }
          if (
            request?.scopedAttach &&
            request.owner === client &&
            client?.readyState === WebSocket.OPEN &&
            !message.error
          ) {
            const result = message.result as
              | { targetInfos?: Array<{ type?: string; url?: string; targetId?: string }> }
              | undefined;
            const targets =
              result?.targetInfos?.filter(
                target =>
                  target.type === 'page' &&
                  typeof target.url === 'string' &&
                  scope!.matchesTarget(target.url),
              ) ?? [];
            if (targets.length !== 1 || typeof targets[0]!.targetId !== 'string') {
              client.send(
                JSON.stringify({
                  id: request.originalId,
                  error: {
                    code: -32000,
                    message:
                      targets.length === 0 ? 'FIGMA_TAB_NOT_FOUND' : 'CHROME_TARGET_AMBIGUOUS',
                  },
                }),
              );
              return;
            }
            const id = ++sequence;
            pending.set(id, {
              owner: client,
              originalId: request.originalId,
              method: 'Target.attachToTarget',
              scopedRoot: true,
            });
            sent++;
            remote!.send(
              JSON.stringify({
                id,
                method: 'Target.attachToTarget',
                params: { targetId: targets[0]!.targetId, flatten: true },
              }),
            );
            return;
          }
          if (request?.owner === client && client?.readyState === WebSocket.OPEN)
            client.send(JSON.stringify({ ...message, id: request.originalId }));
        } else if (!resets.size && client?.readyState === WebSocket.OPEN)
          client.send(data.toString());
      } catch {
        fail();
      }
    });
  };
  sockets.on('connection', (socket, request) => {
    const userAgent = request.headers['user-agent'];
    client = socket;
    lastPendingMethods = [];
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
        const scopedAttach =
          scope &&
          message.sessionId === undefined &&
          message.method === 'Target.setAutoAttach' &&
          (message.params as { autoAttach?: boolean } | undefined)?.autoAttach === true
            ? {
                waitForDebuggerOnStart:
                  (message.params as { waitForDebuggerOnStart?: boolean })
                    .waitForDebuggerOnStart === true,
              }
            : undefined;
        pending.set(id, {
          owner: socket,
          originalId: message.id as number,
          method: scopedAttach
            ? 'Target.getTargets'
            : /^[A-Za-z]+\.[A-Za-z]{1,80}$/u.test(message.method)
              ? message.method
              : 'unknown',
          ...(scopedAttach ? { scopedAttach } : {}),
        });
        // Scope root attachment before Playwright initializes any page. Nested iframe/worker
        // attachment remains unchanged, and Chrome produces the real attachment events.
        const encoded = JSON.stringify(
          scopedAttach ? { id, method: 'Target.getTargets' } : { ...message, id },
        );
        ensureRemote(userAgent);
        if (remote?.readyState === WebSocket.OPEN && !resets.size) {
          sent++;
          remote.send(encoded);
        } else {
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
    const userAgent = request.headers['user-agent'];
    if (
      closed ||
      failed ||
      request.url !== '/chrome-cdp' ||
      request.headers.origin !== undefined ||
      (userAgent !== undefined &&
        (typeof userAgent !== 'string' ||
          userAgent.length > 512 ||
          /[^\x20-\x7e]/u.test(userAgent))) ||
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
    // Protocol method names and counters only: never parameters, URLs, headers or response data.
    diagnostics: () => ({
      sent,
      received,
      pendingMethods: client ? pendingMethods() : lastPendingMethods,
      pendingResets: resets.size,
    }),
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
