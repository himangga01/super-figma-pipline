import {
  type ApprovalPromptV1,
  type AuthenticatedHello,
  createError,
  createEvent,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  type HelloResult,
  newId,
  PROTOCOL_VERSION,
  type RequestEnvelope,
  type ResponseEnvelope,
  SystemMethod,
} from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  isAdmittedPluginFrame,
  PLUGIN_FRAME_MAX_BYTES,
  RelayClient as ProductionRelayClient,
  type RelayClientOptions,
  type WebSocketCtor,
} from '../../ui/relay/client.js';
import { ACTIVITY_LIMIT } from '../../ui/relay/state.js';

interface FakeSocket {
  url: string;
  binaryType: BinaryType;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

interface FakeSocketControl extends FakeSocket {
  sent: Uint8Array[];
  fireOpen(): void;
  fireReceive(env: Envelope): void;
  fireRaw(data: unknown): void;
  fireServerClose(code?: number, reason?: string): void;
}

const buildFakeFactory = (
  behavior: (sock: FakeSocketControl, port: number) => void,
): { WS: WebSocketCtor; sockets: FakeSocketControl[] } => {
  const sockets: FakeSocketControl[] = [];

  class FakeWS implements FakeSocket {
    binaryType: BinaryType = 'blob';
    readyState = 0;
    onopen: ((ev: Event) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    sent: Uint8Array[] = [];

    constructor(public url: string) {
      const port = Number(new URL(url).port);
      const control: FakeSocketControl = Object.assign(this, {
        sent: this.sent,
        fireOpen: () => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));
        },
        fireReceive: (env: Envelope) => {
          const bytes = encodeEnvelope(env);
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          this.onmessage?.({ data: ab } as MessageEvent);
        },
        fireRaw: (data: unknown) => {
          this.onmessage?.({ data } as MessageEvent);
        },
        fireServerClose: (code = 1000, reason = '') => {
          this.readyState = 3;
          this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
        },
      });
      sockets.push(control);
      queueMicrotask(() => behavior(control, port));
    }

    send(data: ArrayBuffer | ArrayBufferView): void {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      this.sent.push(bytes);
    }

    close(code = 1000, reason = ''): void {
      this.readyState = 3;
      this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
    }
  }

  return { WS: FakeWS as unknown as WebSocketCtor, sockets };
};

const TEST_SESSION_ID = 'test-authenticated-session';
const TEST_PLUGIN_GENERATION = 'test-plugin-generation';

class RelayClient extends ProductionRelayClient {
  private authenticated = false;

  constructor(options: RelayClientOptions) {
    super({ ...options, sessionId: options.sessionId ?? TEST_SESSION_ID });
  }

  override async connect(): Promise<void> {
    if (this.authenticated) return super.connect();
    this.authenticated = true;
    this.configureHelloSeed({
      provisionalSessionId: this.sessionId,
      pluginGeneration: TEST_PLUGIN_GENERATION,
    });
    return this.connectWithTicket(
      { wsTicket: 'A'.repeat(22), expiresAt: Date.now() + 60_000 },
      {
        protocolVersion: PROTOCOL_VERSION,
        productVersion: '0.1.0',
        pluginVersion: '0.1.0',
        pluginGeneration: TEST_PLUGIN_GENERATION,
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
        fileName: 'Test file',
        capabilities: [],
      },
    );
  }
}

const helloResult = (overrides: Partial<HelloResult> = {}): HelloResult => ({
  serverVersion: '1.0.0',
  protocolVersion: PROTOCOL_VERSION,
  sessionResumed: false,
  sessionId: TEST_SESSION_ID,
  rotatedResumeToken: 'B'.repeat(43),
  resumeExpiresAt: Date.now() + 60_000,
  ...overrides,
});

const createBoundRequest = (
  input: Parameters<typeof createRequest>[0],
): ReturnType<typeof createRequest> =>
  createRequest({
    ...input,
    operationId: input.operationId ?? `operation-${input.id}`,
    actionNonce: input.actionNonce ?? `nonce-${input.id}`,
  });

describe('RelayClient', () => {
  it('routes a bound approval prompt to the UI and returns its exact decision without sandbox execution', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const hello = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: hello.id, sessionId: hello.sessionId, result: helloResult() }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    const tool = vi.fn<() => Promise<void>>(async () => {});
    client.setToolHandler(tool);
    client.setApprovalHandler(async prompt => ({
      version: 1,
      type: 'approval.decision',
      approvalId: prompt.approvalId,
      operationId: prompt.operationId,
      promptHash: prompt.promptHash,
      decision: 'approved',
    }));
    await client.connect();
    const prompt: ApprovalPromptV1 = {
      version: 1,
      type: 'approval.prompt',
      approvalId: `sfp_ap1_${'A'.repeat(22)}`,
      operationId: 'operation-approval',
      operationKind: 'tool',
      operationName: 'create_frame',
      channel: 'plugin-session',
      promptHash: `sha256:${'a'.repeat(64)}`,
      effectSummary: ['figma-write'],
      target: { fileIdentityHash: null, label: 'Current file', targetCount: 1 },
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    sockets[0]!.fireReceive(
      createRequest({
        id: 'approval-request',
        sessionId: TEST_SESSION_ID,
        method: SystemMethod.Approval,
        params: prompt,
      }),
    );
    await vi.waitFor(() =>
      expect(sockets[0]!.sent.map(decodeEnvelope)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'approval-request',
            kind: 'res',
            result: expect.objectContaining({
              decision: 'approved',
              promptHash: prompt.promptHash,
            }),
          }),
        ]),
      ),
    );
    expect(tool).not.toHaveBeenCalled();
    await client.disconnect();
  });

  it('opens no WebSocket until an authenticated credential is handed off', async () => {
    const { WS, sockets } = buildFakeFactory(socket => socket.fireServerClose(1006, 'refused'));
    const client = new ProductionRelayClient({ ports: [3055], clientVersion: '0.0.0', WS });

    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(sockets).toEqual([]);
      expect(client.getState().status).toBe('idle');
    } finally {
      await client.disconnect();
    }
  });

  it('admits the exact binary frame cap and rejects string, Blob, and max plus one', () => {
    expect(isAdmittedPluginFrame(new ArrayBuffer(PLUGIN_FRAME_MAX_BYTES))).toBe(true);
    expect(isAdmittedPluginFrame(new ArrayBuffer(PLUGIN_FRAME_MAX_BYTES + 1))).toBe(false);
    expect(isAdmittedPluginFrame('not binary')).toBe(false);
    expect(isAdmittedPluginFrame(new Blob())).toBe(false);
  });

  it('closes a live socket on a nonbinary frame before any tool activity', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
      );
    });
    const handler = vi.fn<() => Promise<void>>(async () => undefined);
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.setToolHandler(handler);
    await client.connect();

    sockets[0]!.fireRaw('not binary');

    expect(sockets[0]?.readyState).toBe(3);
    expect(handler).not.toHaveBeenCalled();
    expect(client.getState().totalCalls).toBe(0);
    await client.disconnect();
  });

  it('connects, sends hello, and reaches connected state', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const helloReq = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: helloReq.id, sessionId: helloReq.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    const seen: string[] = [];
    client.subscribe(s => seen.push(s.status));

    await client.connect();

    expect(client.getState().status).toBe('connected');
    expect(client.getState().port).toBe(3055);
    expect(client.getState().sessionResumed).toBe(false);
    expect(seen).toContain('connecting');
    expect(seen).toContain('connected');

    const helloReq = decodeEnvelope(sockets[0]!.sent[0]!) as RequestEnvelope;
    const params = helloReq.params as AuthenticatedHello;
    expect(helloReq.method).toBe('$hello');
    expect(params.credential.kind).toBe('ticket');
    expect(params.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('falls back to next port when first port refuses', async () => {
    const { WS, sockets } = buildFakeFactory((sock, port) => {
      if (port === 3055) {
        sock.fireServerClose(1006, 'connection refused');
        return;
      }
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055, 3056], clientVersion: '0.0.0', WS });
    await client.connect();
    expect(client.getState().port).toBe(3056);
    expect(sockets).toHaveLength(2);
  });

  it('enters the retry loop (not a terminal throw) when no server is up yet', async () => {
    const { WS } = buildFakeFactory(sock => sock.fireServerClose(1006, 'refused'));
    const client = new RelayClient({
      ports: [3055, 3056],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
      log: vi.fn<(msg: string) => void>(),
    });
    // The initial probe failing is not fatal: connect() resolves and keeps retrying in the
    // background (status flips to 'reconnecting') rather than rejecting.
    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.getState().status).toBe('reconnecting');
    expect(client.getState().lastError).toMatch(/no Figwright server on :3055/);
    await client.disconnect();
  });

  it('auto-connects when a plugin opened before the server, once the server appears', async () => {
    let attempt = 0;
    const { WS, sockets } = buildFakeFactory(sock => {
      attempt += 1;
      if (attempt === 1) {
        // First sweep: server not up yet (plugin opened before the MCP client launched it).
        sock.fireServerClose(1006, 'refused');
        return;
      }
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    const seen: string[] = [];
    client.subscribe(s => seen.push(s.status));

    await client.connect();
    expect(client.getState().status).toBe('reconnecting');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    // A cold-start retry is a first connection, not a reconnect — the diagnostic count stays at 0.
    expect(client.getState().reconnectCount).toBe(0);
    expect(seen).toContain('reconnecting');
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    await client.disconnect();
  });

  it('wake() cuts the cold-start back-off short and connects immediately', async () => {
    let attempt = 0;
    const { WS } = buildFakeFactory(sock => {
      attempt += 1;
      if (attempt === 1) {
        // Plugin opened before the server: the first probe finds nothing.
        sock.fireServerClose(1006, 'refused');
        return;
      }
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      // A one-second floor means the natural back-off can't fire inside the 50ms window below — only
      // wake() (a tab refocus) can pull the retry forward.
      reconnectInitialDelayMs: 1_000,
    });

    await client.connect();
    expect(client.getState().status).toBe('reconnecting');

    // Server came up while the tab was hidden; the user refocuses Figma. wake() must probe now rather
    // than sitting out the 1s sleep.
    client.wake();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    // A woken cold-start retry is still a first connection, not a reconnect.
    expect(client.getState().reconnectCount).toBe(0);
    await client.disconnect();
  });

  it('wake() is a no-op while connected (no extra probe socket)', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    await client.connect();
    expect(client.getState().status).toBe('connected');

    client.wake();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Still on the one live socket — a foreground nudge must not churn an already-healthy connection.
    expect(client.getState().status).toBe('connected');
    expect(sockets).toHaveLength(1);
    await client.disconnect();
  });

  it('treats an authenticated hello rejection as definitive without credential fallback', async () => {
    const { WS, sockets } = buildFakeFactory((sock, port) => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      if (port === 3055) {
        sock.fireReceive(
          createError({
            id: req.id,
            sessionId: req.sessionId,
            code: ErrorCode.InvalidParams,
            message: 'bad params',
          }),
        );
        return;
      }
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055, 3056], clientVersion: '0.0.0', WS });
    await client.connect().catch(() => undefined);
    expect(client.getState().port).toBeNull();
    expect(sockets).toHaveLength(1);
    await client.connect();
    expect(sockets).toHaveLength(1);
  });

  it('surfaces a hello rejection reason (e.g. protocol mismatch) in lastError', async () => {
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createError({
          id: req.id,
          sessionId: req.sessionId,
          code: ErrorCode.ProtocolMismatch,
          message: 'protocol mismatch: server speaks 0.1.0, plugin speaks 9.9.9 — update …',
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    await client.connect().catch(() => undefined);
    expect(client.getState().lastError).toBe('PROTOCOL_MISMATCH');
    await client.disconnect();
  });

  it('stops retrying once a server refuses this build, instead of re-offering it forever', async () => {
    // The refusal is terminal — the plugin has to be replaced — and a refused client never sets
    // hasConnected, so the back-off loop would take the 150ms cold-start ceiling and re-offer the
    // same rejected handshake ~7x a second for as long as the panel is open, writing a rejection
    // into the server's log every time. Counting sockets is the point of this test: the banner
    // looked correct while that was happening.
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createError({
          id: req.id,
          sessionId: req.sessionId,
          code: ErrorCode.ProtocolMismatch,
          message: 'plugin too old: this server (v0.4.0) needs the Figwright plugin at v0.4.0',
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.3.0',
      WS,
      reconnectInitialDelayMs: 1,
    });

    await client.connect().catch(() => undefined);
    const afterConnect = sockets.length;
    // Well past several cold-start intervals: an unbounded loop would have opened many more.
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(sockets.length).toBe(afterConnect);
    expect(client.getState().versionNotice).toBe('PROTOCOL_MISMATCH');
    expect(client.getState().status).toBe('disconnected');
    await client.disconnect();
  });

  it('shows the skew warning from a successful hello without treating it as a failure', async () => {
    // The plugin is served — status must reach connected — but the panel has to say the results
    // coming back may be incomplete. Carried on the hello so it is visible before any call is made.
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({
            skewNotice: 'Figwright plugin v0.3.0 is older than this server (v0.4.0).',
          }),
        }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.3.0', WS });

    await client.connect();

    expect(client.getState().status).toBe('connected');
    expect(client.getState().versionNotice).toMatch(/older than this server/i);
    expect(client.getState().lastError).toBeNull();
    await client.disconnect();
  });

  it('leaves the banner clear when the server reports no skew', async () => {
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.4.0', WS });

    await client.connect();

    expect(client.getState().versionNotice).toBeNull();
    await client.disconnect();
  });

  it('keeps retrying when the server is merely absent', async () => {
    // The counterpart the fix must not break: no server yet is the ordinary cold start, and it has
    // to keep probing so the plugin connects on its own once the MCP server launches.
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireServerClose(1006);
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.4.0',
      WS,
      reconnectInitialDelayMs: 1,
    });

    await client.connect();
    const afterConnect = sockets.length;
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(sockets.length).toBeGreaterThan(afterConnect);
    expect(client.getState().versionNotice).toBeNull();
    await client.disconnect();
  });

  it('responds to server-initiated $ping with ok result', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    await client.connect();

    const sentBeforePing = liveSock!.sent.length;
    liveSock!.fireReceive(
      createRequest({
        id: 'srv-ping-1',
        sessionId: client.sessionId,
        method: SystemMethod.Ping,
      }),
    );

    expect(liveSock!.sent.length).toBe(sentBeforePing + 1);
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!) as ResponseEnvelope;
    expect(reply.kind).toBe('res');
    expect(reply.id).toBe('srv-ping-1');
    expect(reply.result).toEqual({ ok: true });
  });

  it('reconnects automatically after server closes the live socket', async () => {
    let attempt = 0;
    const { WS, sockets } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: attempt > 1 }),
        }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    const seen: string[] = [];
    client.subscribe(s => seen.push(s.status));

    await client.connect();
    expect(client.getState().status).toBe('connected');

    sockets[0]!.fireServerClose(1001, 'leader gone');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    expect(client.getState().sessionResumed).toBe(true);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('reconnecting');

    await client.disconnect();
  });

  it('does not reconnect after explicit disconnect()', async () => {
    let attempt = 0;
    const { WS } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    await client.connect();
    await client.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(attempt).toBe(1);
    expect(client.getState().status).toBe('disconnected');
  });

  it('dispatches non-system req to registered tool handler and replies with res', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const handler = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
      async (method, params) => ({ received: { method, params } }),
    );
    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    client.setToolHandler(handler);
    await client.connect();

    const sentBefore = liveSock!.sent.length;
    liveSock!.fireReceive(
      createBoundRequest({
        id: 'tool-1',
        sessionId: client.sessionId,
        method: 'ping',
        params: { hello: 'world' },
      }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    expect(handler).toHaveBeenCalledWith(
      'ping',
      { hello: 'world' },
      {
        requestId: 'tool-1',
        operationId: 'operation-tool-1',
        actionNonce: 'nonce-tool-1',
      },
    );
    expect(liveSock!.sent.length).toBe(sentBefore + 1);
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'res',
      id: 'tool-1',
      result: { received: { method: 'ping', params: { hello: 'world' } } },
    });
  });

  it.each([
    ['missing', 'unbound-tool', {}],
    ['operation-only', 'operation-only-tool', { operationId: 'operation-only' }],
    ['nonce-only', 'nonce-only-tool', { actionNonce: 'nonce-only' }],
    [
      'oversized request id',
      'R'.repeat(385),
      { operationId: 'operation-valid', actionNonce: 'nonce-valid' },
    ],
  ] as const)(
    'rejects a %s execution binding before activity or handler dispatch',
    async (_name, requestId, fields) => {
      const { WS, sockets } = buildFakeFactory(sock => {
        sock.fireOpen();
        const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
        sock.fireReceive(
          createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
        );
      });
      const handler = vi.fn<() => Promise<void>>(async () => undefined);
      const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
      client.setToolHandler(handler);
      await client.connect();
      sockets[0]!.fireReceive(
        createRequest({
          id: requestId,
          sessionId: client.sessionId,
          method: 'get_pages',
          ...fields,
        }),
      );
      await new Promise(resolve => setTimeout(resolve, 5));

      expect(handler).not.toHaveBeenCalled();
      expect(client.getState().totalCalls).toBe(0);
      expect(decodeEnvelope(sockets[0]!.sent.at(-1)!)).toMatchObject({
        kind: 'err',
        id: requestId,
        error: { code: ErrorCode.InvalidRequest },
      });
    },
  );

  it('cancels a queued bound request before sandbox dispatch', async () => {
    let flush!: () => void;
    const cancelScheduled = vi.fn<() => void>();
    const scheduleDispatch = vi.fn<(run: () => void) => () => void>(run => {
      flush = run;
      return cancelScheduled;
    });
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
      );
    });
    const handler = vi.fn<() => Promise<void>>(async () => undefined);
    const cancel = vi.fn<() => boolean>(() => true);
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      scheduleDispatch,
    });
    client.setToolHandler(handler);
    client.setToolCancelHandler(cancel);
    await client.connect();
    const binding = { operationId: 'queued-operation', actionNonce: 'queued-nonce' };
    sockets[0]!.fireReceive(
      createRequest({
        id: 'queued-request',
        sessionId: client.sessionId,
        method: 'get_pages',
        ...binding,
      }),
    );
    sockets[0]!.fireReceive(
      createEvent({
        id: 'queued-cancel',
        sessionId: client.sessionId,
        method: SystemMethod.Cancel,
        params: binding,
      }),
    );
    flush();
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(cancelScheduled).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(client.getState().totalCalls).toBe(0);
    expect(
      sockets[0]!.sent.some(bytes => {
        const envelope = decodeEnvelope(bytes);
        return (
          (envelope.kind === 'res' || envelope.kind === 'err') && envelope.id === 'queued-request'
        );
      }),
    ).toBe(false);
  });

  it('rejects duplicate active bindings and cannot revive a queued request after disconnect', async () => {
    let flush!: () => void;
    const cancelScheduled = vi.fn<() => void>(() => {
      throw new Error('scheduler cancellation failed');
    });
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
      );
    });
    const handler = vi.fn<() => Promise<void>>(async () => undefined);
    const bridgeCancel = vi.fn<() => boolean>(() => true);
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      scheduleDispatch: run => {
        flush = run;
        return cancelScheduled;
      },
    });
    client.setToolHandler(handler);
    client.setToolCancelHandler(bridgeCancel);
    await client.connect();
    const first = {
      id: 'duplicate-request',
      sessionId: client.sessionId,
      method: 'get_pages',
      operationId: 'duplicate-operation',
      actionNonce: 'duplicate-nonce',
    };
    sockets[0]!.fireReceive(createRequest(first));
    sockets[0]!.fireReceive(
      createRequest({
        ...first,
        operationId: 'different-operation',
        actionNonce: 'different-nonce',
      }),
    );
    sockets[0]!.fireReceive(createRequest({ ...first, id: 'different-request' }));

    const errors = sockets[0]!.sent
      .map(bytes => decodeEnvelope(bytes))
      .filter(envelope => envelope.kind === 'err');
    expect(errors).toHaveLength(2);
    expect(errors.every(envelope => envelope.error.code === ErrorCode.InvalidRequest)).toBe(true);

    await client.disconnect();
    flush();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(cancelScheduled).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(bridgeCancel).not.toHaveBeenCalled();
    expect(client.getState().totalCalls).toBe(0);
  });

  it('fails a throwing dispatch scheduler without entering activity or the sandbox', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
      );
    });
    const handler = vi.fn<() => Promise<void>>(async () => undefined);
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      scheduleDispatch: () => {
        throw new Error('scheduler unavailable');
      },
    });
    client.setToolHandler(handler);
    await client.connect();
    sockets[0]!.fireReceive(
      createBoundRequest({
        id: 'scheduler-error',
        sessionId: client.sessionId,
        method: 'get_pages',
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(client.getState().totalCalls).toBe(0);
    expect(decodeEnvelope(sockets[0]!.sent.at(-1)!)).toMatchObject({
      kind: 'err',
      id: 'scheduler-error',
      error: { code: ErrorCode.Internal },
    });
    await client.disconnect();
  });

  it('continues clearing dispatched entries when one sandbox canceller throws', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const request = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: request.id, sessionId: request.sessionId, result: helloResult() }),
      );
    });
    const never = new Promise<unknown>(() => undefined);
    const cancel = vi
      .fn<(context: unknown) => boolean>()
      .mockImplementationOnce(() => {
        throw new Error('first cancellation failed');
      })
      .mockReturnValue(true);
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      scheduleDispatch: run => {
        run();
        return () => undefined;
      },
    });
    client.setToolHandler(async () => never);
    client.setToolCancelHandler(cancel);
    await client.connect();
    for (const id of ['dispatch-a', 'dispatch-b']) {
      sockets[0]!.fireReceive(
        createBoundRequest({ id, sessionId: client.sessionId, method: 'get_pages' }),
      );
    }

    await client.disconnect();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(
      client.sendProgress(
        {
          requestId: 'dispatch-b',
          operationId: 'operation-dispatch-b',
          actionNonce: 'nonce-dispatch-b',
        },
        {
          operationId: 'operation-dispatch-b',
          phase: 'cancelled',
          completed: 0,
          total: 1,
          message: 'cancelled',
          emittedAt: 1,
        },
      ),
    ).toBe(false);
  });

  it('passes an exact operation/action binding only for fully bound tool requests', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });
    const handler = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.setToolHandler(handler);
    await client.connect();

    liveSock!.fireReceive(
      createRequest({
        id: 'bound-tool',
        sessionId: client.sessionId,
        method: 'get_pages',
        operationId: 'operation-1',
        actionNonce: 'nonce-1',
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(handler).toHaveBeenCalledWith('get_pages', undefined, {
      requestId: 'bound-tool',
      operationId: 'operation-1',
      actionNonce: 'nonce-1',
    });
  });

  it('routes one exact cancel to the registered sandbox bridge and ignores duplicates', async () => {
    let liveSock: FakeSocketControl | undefined;
    let settle!: (value: unknown) => void;
    const pendingResult = new Promise<unknown>(resolve => {
      settle = resolve;
    });
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });
    const cancel = vi.fn<(context: unknown) => boolean>(() => true);
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.setToolHandler(async () => pendingResult);
    client.setToolCancelHandler(cancel);
    await client.connect();
    const context = {
      requestId: 'cancel-tool',
      operationId: 'operation-cancel',
      actionNonce: 'nonce-cancel',
    };
    liveSock!.fireReceive(
      createRequest({
        id: context.requestId,
        sessionId: client.sessionId,
        method: 'get_pages',
        operationId: context.operationId,
        actionNonce: context.actionNonce,
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    liveSock!.fireReceive(
      createEvent({
        id: 'cancel-1',
        sessionId: client.sessionId,
        method: SystemMethod.Cancel,
        params: { operationId: context.operationId, actionNonce: context.actionNonce },
      }),
    );
    liveSock!.fireReceive(
      createEvent({
        id: 'cancel-duplicate',
        sessionId: client.sessionId,
        method: SystemMethod.Cancel,
        params: { operationId: context.operationId, actionNonce: context.actionNonce },
      }),
    );
    settle({ late: true });
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(context);
    expect(
      liveSock!.sent.some(bytes => {
        const envelope = decodeEnvelope(bytes);
        return envelope.kind === 'res' && envelope.id === context.requestId;
      }),
    ).toBe(false);
  });

  it('emits at most twenty matching progress frames while the bound request is pending', async () => {
    let liveSock: FakeSocketControl | undefined;
    let settle!: (value: unknown) => void;
    const pendingResult = new Promise<unknown>(resolve => {
      settle = resolve;
    });
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.setToolHandler(async () => pendingResult);
    await client.connect();
    const context = {
      requestId: 'progress-tool',
      operationId: 'operation-progress',
      actionNonce: 'nonce-progress',
    };
    liveSock!.fireReceive(
      createRequest({
        id: context.requestId,
        sessionId: client.sessionId,
        method: 'get_pages',
        operationId: context.operationId,
        actionNonce: context.actionNonce,
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    const progress = {
      operationId: context.operationId,
      phase: 'dispatched',
      completed: 0,
      total: 1,
      message: 'request dispatched',
      emittedAt: 1,
    };

    expect(Array.from({ length: 20 }, () => client.sendProgress(context, progress))).toEqual(
      Array.from({ length: 20 }, () => true),
    );
    expect(client.sendProgress(context, progress)).toBe(false);
    expect(client.sendProgress({ ...context, actionNonce: 'wrong' }, progress)).toBe(false);
    const sentProgress = liveSock!.sent
      .map(bytes => decodeEnvelope(bytes))
      .filter(envelope => envelope.kind === 'evt' && envelope.method === SystemMethod.Progress);
    expect(sentProgress).toHaveLength(20);
    expect(sentProgress.every(event => event.id === context.requestId)).toBe(true);

    settle({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(client.sendProgress(context, progress)).toBe(false);
  });

  it('ignores a cancel queued by a stale live socket after reconnect', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: sockets.length > 1 }),
        }),
      );
    });
    const never = new Promise<unknown>(() => undefined);
    const cancel = vi.fn<(context: unknown) => boolean>(() => true);
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      reconnectInitialDelayMs: 1,
    });
    client.setToolHandler(async () => never);
    client.setToolCancelHandler(cancel);
    await client.connect();
    sockets[0]!.fireServerClose(1001, 'reconnect');
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    const context = {
      requestId: 'new-live-tool',
      operationId: 'new-live-operation',
      actionNonce: 'new-live-nonce',
    };
    sockets[1]!.fireReceive(
      createRequest({
        id: context.requestId,
        sessionId: client.sessionId,
        method: 'get_pages',
        operationId: context.operationId,
        actionNonce: context.actionNonce,
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    const staleCancel = createEvent({
      id: 'stale-cancel',
      sessionId: client.sessionId,
      method: SystemMethod.Cancel,
      params: { operationId: context.operationId, actionNonce: context.actionNonce },
    });

    sockets[0]!.fireReceive(staleCancel);
    expect(cancel).not.toHaveBeenCalled();
    sockets[1]!.fireReceive(staleCancel);
    expect(cancel).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('replies METHOD_NOT_FOUND when no tool handler is registered', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    await client.connect();

    liveSock!.fireReceive(
      createBoundRequest({ id: 'tool-2', sessionId: client.sessionId, method: 'ping' }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'err',
      id: 'tool-2',
      error: { code: ErrorCode.MethodNotFound },
    });
  });

  it('replies INTERNAL_ERROR when the tool handler throws', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    client.setToolHandler(async () => {
      throw new Error('sandbox blew up');
    });
    await client.connect();

    liveSock!.fireReceive(
      createBoundRequest({ id: 'tool-3', sessionId: client.sessionId, method: 'ping' }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'err',
      error: {
        code: ErrorCode.Internal,
        message: expect.stringContaining('sandbox blew up'),
      },
    });
  });

  const connectWithLiveSocket = async (
    handler?: (method: string, params: unknown) => Promise<unknown>,
  ): Promise<{ client: RelayClient; live: FakeSocketControl }> => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    if (handler !== undefined) client.setToolHandler(handler);
    await client.connect();
    return { client, live: liveSock! };
  };

  it('records a successful tool call in activity with ok status and duration', async () => {
    const { client, live } = await connectWithLiveSocket(async () => ({ ok: true }));
    live.fireReceive(
      createBoundRequest({ id: 't-1', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    const s = client.getState();
    expect(s.totalCalls).toBe(1);
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0]).toMatchObject({ id: 't-1', method: 'get_pages', status: 'ok' });
    expect(s.activity[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures the result payload (what the LLM receives) on a successful call', async () => {
    const result = { pages: [{ id: '0:1', name: 'Page 1' }] };
    const { client, live } = await connectWithLiveSocket(async () => result);
    live.fireReceive(
      createBoundRequest({ id: 't-p', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    const payload = client.getState().activity[0]?.payload;
    expect(payload).toBeDefined();
    expect(payload?.preview).toContain('"name": "Page 1"');
    expect(payload?.bytes).toBe(JSON.stringify(result).length);
    expect(payload?.truncated).toBe(false);
  });

  it('captures the request params at call start', async () => {
    const { client, live } = await connectWithLiveSocket(async () => ({ ok: true }));
    live.fireReceive(
      createBoundRequest({
        id: 't-r',
        sessionId: client.sessionId,
        method: 'get_design_context',
        params: { nodeId: '3:21', detail: 'full' },
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    const request = client.getState().activity[0]?.request;
    expect(request).toBeDefined();
    expect(request?.preview).toContain('"nodeId": "3:21"');
    expect(request?.preview).toContain('"detail": "full"');
  });

  it('records the server version from the hello handshake', async () => {
    const { client } = await connectWithLiveSocket();
    expect(client.getState().serverVersion).toBe('1.0.0');
  });

  it('attaches no payload to a failed call', async () => {
    const { client, live } = await connectWithLiveSocket(async () => {
      throw new Error('nope');
    });
    live.fireReceive(
      createBoundRequest({ id: 't-e', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(client.getState().activity[0]?.status).toBe('error');
    expect(client.getState().activity[0]?.payload).toBeUndefined();
  });

  it('records a throwing tool call as an error with its message', async () => {
    const { client, live } = await connectWithLiveSocket(async () => {
      throw new Error('boom');
    });
    live.fireReceive(
      createBoundRequest({ id: 't-2', sessionId: client.sessionId, method: 'get_node' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(client.getState().activity[0]).toMatchObject({
      id: 't-2',
      method: 'get_node',
      status: 'error',
      error: expect.stringContaining('boom'),
    });
  });

  it('records an error entry when no tool handler is registered', async () => {
    const { client, live } = await connectWithLiveSocket();
    live.fireReceive(
      createBoundRequest({ id: 't-3', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(client.getState().activity[0]).toMatchObject({ id: 't-3', status: 'error' });
  });

  it('keeps activity most-recent-first and capped at ACTIVITY_LIMIT', async () => {
    const { client, live } = await connectWithLiveSocket(async () => ({ ok: true }));
    const total = ACTIVITY_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      live.fireReceive(
        createBoundRequest({ id: `t-${i}`, sessionId: client.sessionId, method: `m_${i}` }),
      );
    }
    await new Promise(resolve => setTimeout(resolve, 20));

    const s = client.getState();
    expect(s.totalCalls).toBe(total);
    expect(s.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(s.activity[0]?.method).toBe(`m_${total - 1}`);
  });

  it('tracks connectedAt and bumps reconnectCount on auto-reconnect', async () => {
    let attempt = 0;
    const { WS, sockets } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: attempt > 1 }),
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    await client.connect();
    expect(client.getState().connectedAt).toBeTypeOf('number');
    expect(client.getState().reconnectCount).toBe(0);

    sockets[0]!.fireServerClose(1001, 'leader gone');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    expect(client.getState().reconnectCount).toBe(1);
    expect(client.getState().connectedAt).toBeTypeOf('number');
    await client.disconnect();
    expect(client.getState().connectedAt).toBeNull();
  });

  it('reuses sessionId across reconnect attempts', async () => {
    const sessionId = newId();
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionId: req.sessionId, sessionResumed: true }),
        }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      sessionId,
      WS,
    });
    await client.connect();
    const helloReq = decodeEnvelope(sockets[0]!.sent[0]!) as RequestEnvelope;
    expect(helloReq.sessionId).toBe(sessionId);
    expect(client.getState().sessionResumed).toBe(true);
  });
});
