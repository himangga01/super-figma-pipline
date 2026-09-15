import {
  createError,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  PROTOCOL_VERSION,
  type RequestEnvelope,
} from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { RelayClient, type RelayHelloSnapshot, type WebSocketCtor } from '../../ui/relay/client.js';

interface SocketControl {
  readonly url: string;
  readonly sent: Uint8Array[];
  binaryType: BinaryType;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  fireOpen(): void;
  fireReceive(envelope: Envelope): void;
  fireServerClose(): void;
  holdClientClose(): void;
  releaseClose(): void;
}

const fakeSockets = (behavior: (socket: SocketControl, index: number) => void) => {
  const sockets: SocketControl[] = [];
  class FakeWebSocket implements SocketControl {
    readonly sent: Uint8Array[] = [];
    binaryType: BinaryType = 'blob';
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private closeHeld = false;
    constructor(readonly url: string) {
      sockets.push(this);
      queueMicrotask(() => behavior(this, sockets.indexOf(this)));
    }
    send(data: ArrayBuffer | ArrayBufferView): void {
      this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
    }
    close(code = 1000, reason = ''): void {
      if (this.closeHeld) {
        this.readyState = 2;
        return;
      }
      this.readyState = 3;
      this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
    }
    fireOpen(): void {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }
    fireReceive(envelope: Envelope): void {
      const bytes = encodeEnvelope(envelope);
      this.onmessage?.({
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      } as MessageEvent);
    }
    fireServerClose(): void {
      this.close(1006, 'transport lost');
    }
    holdClientClose(): void {
      this.closeHeld = true;
    }
    releaseClose(): void {
      this.closeHeld = false;
      this.close(1000, 'released');
    }
  }
  return { sockets, WS: FakeWebSocket as unknown as WebSocketCtor };
};

const seed = { provisionalSessionId: 'provisional-session', pluginGeneration: 'plugin-gen-1' };
const stableHello = (): RelayHelloSnapshot => ({
  protocolVersion: PROTOCOL_VERSION,
  productVersion: '0.1.0',
  pluginVersion: '0.1.0',
  pluginGeneration: seed.pluginGeneration,
  editorType: 'figma',
  mode: 'default',
  fileIdentity: { kind: 'figma-file-key', value: 'file-key-1' },
  fileName: 'Design',
  capabilities: [],
});
const unstableHello = (): RelayHelloSnapshot => ({
  ...stableHello(),
  fileIdentity: {
    kind: 'unstable-readonly',
    sessionId: seed.provisionalSessionId,
    pluginGeneration: seed.pluginGeneration,
  },
});
const helloResult = (sessionId: string, token: string, sessionResumed: boolean) => ({
  serverVersion: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  sessionResumed,
  sessionId,
  rotatedResumeToken: token,
  resumeExpiresAt: Date.now() + 60_000,
});

describe('authenticated relay resume rotation', () => {
  it('rejects an already-expired ticket before opening a socket', async () => {
    const { WS, sockets } = fakeSockets(() => undefined);
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS, now: () => 1_000 });
    client.configureHelloSeed(seed);

    await expect(
      client.connectWithTicket({ wsTicket: 'K'.repeat(22), expiresAt: 1_000 }, stableHello()),
    ).rejects.toMatchObject({ code: 'PAIR_TICKET_EXPIRED' });
    expect(sockets).toEqual([]);
  });

  it.each(['wrong version', 'wrong session'] as const)(
    'rejects a typed hello error with %s as an uncorrelated body',
    async mismatch => {
      const { WS, sockets } = fakeSockets(socket => {
        socket.fireOpen();
        const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
        const error = createError({
          id: request.id,
          sessionId: mismatch === 'wrong session' ? 'foreign-session' : request.sessionId,
          code: 'PAIR_TICKET_INVALID',
          message: 'PAIR_TICKET_INVALID',
        });
        socket.fireReceive(
          mismatch === 'wrong version' ? ({ ...error, v: 'wrong-protocol' } as Envelope) : error,
        );
      });
      const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
      client.configureHelloSeed(seed);

      await expect(
        client.connectWithTicket(
          { wsTicket: 'L'.repeat(22), expiresAt: Date.now() + 30_000 },
          stableHello(),
        ),
      ).rejects.toMatchObject({ code: 'PAIR_BODY_INVALID' });
      expect(sockets).toHaveLength(1);
      expect(client.getState()).toMatchObject({
        status: 'disconnected',
        port: null,
        sessionResumed: false,
        connectedAt: null,
        lastError: 'PAIR_BODY_INVALID',
      });
    },
  );

  it('rejects an open or mis-correlated authenticated result and does not retry its credential', async () => {
    const { WS, sockets } = fakeSockets(socket => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'wrong-envelope-session',
          result: {
            ...helloResult('server-session-strict', 'resume-token-strict', false),
            secret: 'must-not-be-accepted',
          },
        }),
      );
    });
    const client = new RelayClient({ ports: [3055, 3056], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);

    await expect(
      client.connectWithTicket(
        { wsTicket: 'D'.repeat(22), expiresAt: Date.now() + 30_000 },
        stableHello(),
      ),
    ).rejects.toMatchObject({ code: 'PAIR_BODY_INVALID' });
    expect(sockets).toHaveLength(1);
    expect(client.getState()).toMatchObject({
      status: 'disconnected',
      lastError: 'PAIR_BODY_INVALID',
    });
  });

  it('rejects a sandbox/client plugin-generation mismatch before opening a socket', async () => {
    const { WS, sockets } = fakeSockets(() => undefined);
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);

    await expect(
      client.connectWithTicket(
        { wsTicket: 'E'.repeat(22), expiresAt: Date.now() + 30_000 },
        { ...stableHello(), pluginGeneration: 'other-generation' },
      ),
    ).rejects.toMatchObject({ code: 'PAIR_GENERATION_MISMATCH' });
    expect(sockets).toEqual([]);
  });

  it('publishes a stable identity after one ticket hello', async () => {
    const { WS, sockets } = fakeSockets(socket => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-1',
          result: helloResult('server-session-1', 'resume-token-1', false),
        }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);

    await client.connectWithTicket(
      { wsTicket: 'A'.repeat(22), expiresAt: Date.now() + 30_000 },
      stableHello(),
    );

    expect(sockets).toHaveLength(1);
    expect(client.sessionId).toBe('server-session-1');
    expect(client.getState().status).toBe('connected');
    const request = decodeEnvelope(sockets[0]!.sent[0]!) as RequestEnvelope;
    expect(request.params).toMatchObject({ credential: { kind: 'ticket', value: 'A'.repeat(22) } });
    expect(sockets[0]!.url).toBe('ws://127.0.0.1:3055');
  });

  it('closes an unstable provisional socket before one exact resume hello becomes live', async () => {
    const handler = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    const { WS, sockets } = fakeSockets((socket, index) => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      if (index === 0) {
        socket.fireReceive(
          createResponse({
            id: request.id,
            sessionId: 'server-session-2',
            result: helloResult('server-session-2', 'resume-token-1', false),
          }),
        );
        socket.fireReceive(
          createRequest({
            id: 'provisional-tool',
            sessionId: 'server-session-2',
            method: 'delete_nodes',
          }),
        );
        return;
      }
      expect(sockets[0]?.readyState).toBe(3);
      expect(request.params).toMatchObject({
        credential: { kind: 'resume', value: 'resume-token-1' },
        nonce: expect.any(String),
        fileIdentity: {
          kind: 'unstable-readonly',
          sessionId: 'server-session-2',
          pluginGeneration: seed.pluginGeneration,
        },
      });
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-2',
          result: helloResult('server-session-2', 'resume-token-2', true),
        }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);
    client.setToolHandler(handler);

    await client.connectWithTicket(
      { wsTicket: 'B'.repeat(22), expiresAt: Date.now() + 30_000 },
      unstableHello(),
    );

    expect(sockets).toHaveLength(2);
    expect(handler).not.toHaveBeenCalled();
    expect(client.getState().status).toBe('connected');
  });

  it('replays the exact prepared hello after transport-unknown and rotates only on success', async () => {
    const requests: RequestEnvelope[] = [];
    const { WS, sockets } = fakeSockets((socket, index) => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      requests.push(request);
      if (index === 0) {
        socket.fireServerClose();
        return;
      }
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-3',
          result: helloResult('server-session-3', 'resume-token-1', false),
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      reconnectInitialDelayMs: 1,
    });
    client.configureHelloSeed(seed);

    await client.connectWithTicket(
      { wsTicket: 'C'.repeat(22), expiresAt: Date.now() + 30_000 },
      stableHello(),
    );
    await vi.waitFor(() => expect(client.getState().status).toBe('connected'));

    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(requests[1]?.params).toEqual(requests[0]?.params);
    expect(requests[1]?.id).toBe(requests[0]?.id);
    expect(client.sessionId).toBe('server-session-3');
  });

  it('expires an unknown hello at the exact five-second recovery boundary', async () => {
    let now = 10_000;
    const requests: RequestEnvelope[] = [];
    const { WS, sockets } = fakeSockets((socket, index) => {
      socket.fireOpen();
      if (socket.sent.length > 0) requests.push(decodeEnvelope(socket.sent[0]!) as RequestEnvelope);
      if (index === 0) socket.fireServerClose();
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      now: () => now,
      reconnectInitialDelayMs: 60_000,
    });
    client.configureHelloSeed(seed);

    await client.connectWithTicket(
      { wsTicket: 'F'.repeat(22), expiresAt: now + 30_000 },
      stableHello(),
    );
    expect(requests).toHaveLength(1);
    now += 5_000;
    client.wake();
    await vi.waitFor(() => expect(client.getState().lastError).toBe('PAIR_RESUME_EXPIRED'));

    expect(sockets).toHaveLength(2);
    expect(requests).toHaveLength(1);
    await client.disconnect();
  });

  it('rotates every resume token and ignores a stale socket response', async () => {
    const credentials: string[] = [];
    const nonces: string[] = [];
    const { WS, sockets } = fakeSockets((socket, index) => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      const hello = request.params as { credential: { value: string }; nonce: string };
      credentials.push(hello.credential.value);
      nonces.push(hello.nonce);
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-rotate',
          result: helloResult('server-session-rotate', `resume-token-${index + 1}`, index > 0),
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS,
      reconnectInitialDelayMs: 1,
    });
    client.configureHelloSeed(seed);
    await client.connectWithTicket(
      { wsTicket: 'G'.repeat(22), expiresAt: Date.now() + 30_000 },
      stableHello(),
    );

    sockets[0]!.fireServerClose();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[0]!.fireReceive(
      createResponse({
        id: 'stale-response',
        sessionId: 'server-session-rotate',
        result: helloResult('server-session-rotate', 'stale-token', true),
      }),
    );
    sockets[1]!.fireServerClose();
    await vi.waitFor(() => expect(sockets).toHaveLength(3));

    expect(credentials).toEqual(['G'.repeat(22), 'resume-token-1', 'resume-token-2']);
    expect(new Set(nonces).size).toBe(3);
    await client.disconnect();
  });

  it('disconnect forgets an in-flight credential and closes its handshake socket', async () => {
    const { WS, sockets } = fakeSockets(socket => socket.fireOpen());
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);
    const connecting = client.connectWithTicket(
      { wsTicket: 'I'.repeat(22), expiresAt: Date.now() + 30_000 },
      stableHello(),
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));

    await client.disconnect({ forgetCredential: true });
    await expect(connecting).rejects.toBeInstanceOf(Error);
    expect(sockets[0]?.readyState).toBe(3);
    await client.connect();
    expect(sockets).toHaveLength(1);
  });

  it('settles and detaches a withheld provisional close without opening a resume socket', async () => {
    const { WS, sockets } = fakeSockets(socket => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      socket.holdClientClose();
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-withheld',
          result: helloResult('server-session-withheld', 'resume-token-withheld', false),
        }),
      );
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);
    const connecting = client.connectWithTicket(
      { wsTicket: 'M'.repeat(22), expiresAt: Date.now() + 30_000 },
      unstableHello(),
    );
    await vi.waitFor(() => expect(sockets[0]?.readyState).toBe(2));

    await client.disconnect({ forgetCredential: true });
    const settlement = await Promise.race([
      connecting.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 50)),
    ]);
    expect(settlement).toBe('settled');
    expect(sockets).toHaveLength(1);
  });

  it('does not publish a hello result after disconnect won the response continuation race', async () => {
    let client!: RelayClient;
    const { WS, sockets } = fakeSockets(socket => {
      socket.fireOpen();
      const request = decodeEnvelope(socket.sent[0]!) as RequestEnvelope;
      socket.fireReceive(
        createResponse({
          id: request.id,
          sessionId: 'server-session-race',
          result: helloResult('server-session-race', 'resume-token-race', false),
        }),
      );
      void client.disconnect({ forgetCredential: true });
    });
    client = new RelayClient({ ports: [3055], clientVersion: '0.1.0', WS });
    client.configureHelloSeed(seed);

    await client
      .connectWithTicket(
        { wsTicket: 'J'.repeat(22), expiresAt: Date.now() + 30_000 },
        stableHello(),
      )
      .catch(() => undefined);

    expect(client.getState().status).toBe('disconnected');
    expect(sockets[0]?.readyState).toBe(3);
  });
});
