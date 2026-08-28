import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { decode, encode } from '@msgpack/msgpack';
import {
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  ErrorCode,
  FollowerTransportRequestIdSchema,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import { Relay } from '../../src/relay/relay.js';
import { createFollowerAuthenticatedTransport } from '../../src/security/follower-transport.js';

interface Bound {
  http: HttpServer;
  relay: Relay;
  port: number;
  detach: () => void;
  plugins: WebSocket[];
}

const all: Bound[] = [];
const TEST_GENERATION = Buffer.alloc(16, 1).toString('base64url');
const TEST_FOLLOWER_TOKEN = Buffer.alloc(32, 2).toString('base64url');
const TEST_CONTROL_TOKEN = Buffer.alloc(32, 3).toString('base64url');
const TEST_CREDENTIALS = {
  generation: TEST_GENERATION,
  followerToken: TEST_FOLLOWER_TOKEN,
  controlToken: TEST_CONTROL_TOKEN,
  createdAt: 1,
};
const TEST_SERVER_TRANSPORT = await createFollowerAuthenticatedTransport({
  leaderUrl: 'http://127.0.0.1:1',
  mcpSession: `mcp1_${Buffer.alloc(16, 9).toString('base64url')}`,
  memory: TEST_CREDENTIALS,
});
const TEST_PAIRING = {
  createChallenge: async () => ({
    challengeId: 'ABCDEFGHIJ',
    code: '12345678',
    expiresAt: Date.now() + 60_000,
    attemptsRemaining: 5,
  }),
  exchange: async () => ({ wsTicket: 'AAAAAAAAAAAAAAAAAAAAAA', expiresAt: Date.now() + 30_000 }),
};
const TEST_RELAY_AUTHENTICATOR = {
  authenticateHello: async (_input: unknown, context: { requestedSessionId: string }) => ({
    sessionId: context.requestedSessionId,
    rotatedResumeToken: Buffer.alloc(32, 3).toString('base64url'),
    resumeExpiresAt: Date.now() + 60_000,
  }),
};
interface TestFollowerOptions {
  leaderUrl: string;
  rpcTimeoutMs?: number;
  pingTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const testFollower = async (options: TestFollowerOptions): Promise<Follower> => {
  const transport = await createFollowerAuthenticatedTransport({
    leaderUrl: options.leaderUrl,
    mcpSession: `mcp1_${Buffer.alloc(16, 10).toString('base64url')}`,
    memory: TEST_CREDENTIALS,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return new Follower({
    leaderUrl: options.leaderUrl,
    transport: transport.client,
    ...(options.rpcTimeoutMs === undefined ? {} : { rpcTimeoutMs: options.rpcTimeoutMs }),
    ...(options.pingTimeoutMs === undefined ? {} : { pingTimeoutMs: options.pingTimeoutMs }),
  });
};

afterEach(async () => {
  await Promise.all(
    all.map(async b => {
      for (const ws of b.plugins) ws.close();
      b.detach();
      await b.relay.stop();
      await new Promise<void>(resolve => b.http.close(() => resolve()));
    }),
  );
  all.length = 0;
});

const startLeader = async (): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({
    serverVersion: '1.0.0',
    server: http,
    authenticator: TEST_RELAY_AUTHENTICATOR,
  });
  const detach = attachLeaderEndpoints(http, {
    relay,
    serverVersion: '1.0.0',
    leaderGeneration: TEST_GENERATION,
    transport: TEST_SERVER_TRANSPORT,
    pairing: TEST_PAIRING,
  });
  const b: Bound = { http, relay, port, detach, plugins: [] };
  all.push(b);
  return b;
};

const startLeaderWithTimeout = async (rpcTimeoutMs: number): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({
    serverVersion: '1.0.0',
    server: http,
    authenticator: TEST_RELAY_AUTHENTICATOR,
  });
  const detach = attachLeaderEndpoints(http, {
    relay,
    serverVersion: '1.0.0',
    rpcTimeoutMs,
    leaderGeneration: TEST_GENERATION,
    transport: TEST_SERVER_TRANSPORT,
    pairing: TEST_PAIRING,
  });
  const b: Bound = { http, relay, port, detach, plugins: [] };
  all.push(b);
  return b;
};

const attachFakePlugin = async (
  b: Bound,
  handle: (method: string, params: unknown) => Promise<unknown>,
): Promise<void> => {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws`, { origin: 'null' });
  ws.binaryType = 'arraybuffer';
  await new Promise<void>(resolve => ws.once('open', () => resolve()));

  let helloResolved: (() => void) | null = null;
  const helloReceived = new Promise<void>(resolve => {
    helloResolved = resolve;
  });
  ws.on('message', async (data: ArrayBuffer) => {
    const env = decodeEnvelope(data);
    if (env.kind === 'res' && helloResolved !== null) {
      helloResolved();
      helloResolved = null;
      return;
    }
    if (
      env.kind === 'req' &&
      env.method !== SystemMethod.Ping &&
      env.method !== SystemMethod.Hello
    ) {
      const result = await handle(env.method, env.params);
      ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId: env.sessionId, result })));
    }
  });

  ws.send(
    encodeEnvelope(
      createRequest({
        id: 'h',
        sessionId: newId(),
        method: SystemMethod.Hello,
        params: {
          credential: { kind: 'ticket', value: 'test-ticket' },
          nonce: Buffer.alloc(16, 4).toString('base64url'),
          protocolVersion: PROTOCOL_VERSION,
          productVersion: '0.1.0',
          pluginVersion: MIN_PLUGIN_VERSION,
          pluginGeneration: 'plugin-generation-test',
          editorType: 'figma',
          mode: 'default',
          fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
          fileName: 'Follower Test',
          capabilities: [],
        },
      }),
    ),
  );
  await helloReceived;
  b.plugins.push(ws);
};

describe('Follower HTTP client', () => {
  it('ping returns true when leader is up', async () => {
    const b = await startLeader();
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    expect(await f.ping()).toBe(true);
  });

  it('ping returns false for unreachable leader', async () => {
    const f = await testFollower({
      leaderUrl: 'http://127.0.0.1:1',
      pingTimeoutMs: 200,
    });
    expect(await f.ping()).toBe(false);
  });

  it('ping returns false when the port is held by a non-figwright server', async () => {
    const http = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not a figwright leader');
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${port}` });
    try {
      expect(await f.ping()).toBe(false);
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
  });

  it('sendRpc round-trips through leader to plugin', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('get_doc');
      expect(params).toEqual({ depth: 2 });
      return { name: 'My Doc', pages: 3 };
    });

    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const resp = await f.sendRpc('get_doc', { depth: 2 }, 'r-42');
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.requestId).toBe('r-42');
    expect(resp.result).toEqual({ name: 'My Doc', pages: 3 });
  });

  it('keeps caller-visible RPC requestId separate from the canonical outer transport ID', async () => {
    let observedOuter = '';
    let observedInner = '';
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      transport: {
        mcpSession: `mcp1_${Buffer.alloc(16, 90).toString('base64url')}`,
        leaderInfo: async () => undefined,
        open: async call => {
          observedOuter = call.transportRequestId;
          observedInner = (decode(call.plaintext) as { requestId: string }).requestId;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                sequence: 0,
                final: true,
                plaintext: Buffer.from(
                  encode({ kind: 'ok', requestId: observedInner, result: { ok: true } }),
                ),
              };
            },
          };
        },
      },
    });
    await expect(follower.sendRpc('get_document', {}, 'r-42')).resolves.toMatchObject({
      kind: 'ok',
      requestId: 'r-42',
    });
    expect(observedInner).toBe('r-42');
    expect(FollowerTransportRequestIdSchema.safeParse(observedOuter).success).toBe(true);
    expect(observedOuter).not.toBe(observedInner);
  });

  it.each(['non-final', 'multiple', 'missing-final'] as const)(
    'sendRpc rejects a %s legacy collector shape',
    async shape => {
      const follower = new Follower({
        leaderUrl: 'http://127.0.0.1:1',
        transport: {
          mcpSession: `mcp1_${Buffer.alloc(16, 91).toString('base64url')}`,
          leaderInfo: async () => undefined,
          open: async () => ({
            async *[Symbol.asyncIterator]() {
              if (shape === 'missing-final') return;
              yield {
                sequence: 0,
                final: shape !== 'non-final',
                plaintext: Buffer.from(
                  encode({ kind: 'ok', requestId: 'legacy-shape', result: {} }),
                ),
              };
              if (shape === 'multiple') {
                yield {
                  sequence: 1,
                  final: true,
                  plaintext: Buffer.from(
                    encode({ kind: 'ok', requestId: 'legacy-shape', result: {} }),
                  ),
                };
              }
            },
          }),
        },
      });
      await expect(follower.sendRpc('get_document', {}, 'legacy-shape')).resolves.toMatchObject({
        kind: 'err',
        requestId: 'legacy-shape',
        code: ErrorCode.Internal,
      });
    },
  );

  it('sendRpc surfaces leader-side err response', async () => {
    const b = await startLeaderWithTimeout(50);
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const resp = await f.sendRpc('whatever', undefined, 'r-no-plugin');
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
    expect(resp.requestId).toBe('r-no-plugin');
  });

  it('sendRpc returns NotLeader before forwarding when strict identity is unreachable', async () => {
    const f = await testFollower({
      leaderUrl: 'http://127.0.0.1:1',
      rpcTimeoutMs: 200,
    });
    const resp = await f.sendRpc('x', undefined, 'r-dead');
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.NotLeader);
    expect(resp.requestId).toBe('r-dead');
  });

  it('sendRpc ends early when the caller aborts, without waiting out its budget', async () => {
    // A leader that never answers — the shape of a wedged one. The budget here is 60s, so the only
    // thing that can end this call in test time is the abort actually reaching the request.
    const b = await startLeader();
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const abort = new AbortController();
    const started = Date.now();
    const pending = f.sendRpc('get_doc', {}, 'r-abort', undefined, 60_000, abort.signal);
    setTimeout(() => abort.abort(new Error('port conflict')), 50);

    const resp = await pending;
    const elapsed = Date.now() - started;
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Internal);
    expect(resp.message).toMatch(/transport/);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('sendRpc still honours its own budget when no abort signal is given', async () => {
    const b = await startLeader();
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const started = Date.now();
    const resp = await f.sendRpc('get_doc', {}, 'r-budget', undefined, 300);
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('resolveActiveSession stays undefined instead of consulting the public ping oracle', async () => {
    const b = await startLeader();
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    // No plugin yet → undefined, caller falls back to unpinned routing.
    expect(await f.resolveActiveSession()).toBeUndefined();

    await attachFakePlugin(b, async () => ({ noop: true }));
    expect(b.relay.pickActiveSessionId()).toBeDefined();
    expect(await f.resolveActiveSession()).toBeUndefined();
  });

  it('resolveActiveSession returns undefined when the leader is unreachable', async () => {
    const f = await testFollower({ leaderUrl: 'http://127.0.0.1:1', pingTimeoutMs: 200 });
    expect(await f.resolveActiveSession()).toBeUndefined();
  });

  it('leaderInfo reports version and buildId of a confirmed leader', async () => {
    const http = createServer();
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;
    const relay = new Relay({
      serverVersion: 'test-2.0.0',
      server: http,
      authenticator: TEST_RELAY_AUTHENTICATOR,
    });
    const detach = attachLeaderEndpoints(http, {
      relay,
      serverVersion: 'test-2.0.0',
      buildId: 777,
      leaderGeneration: TEST_GENERATION,
      transport: TEST_SERVER_TRANSPORT,
      pairing: TEST_PAIRING,
    });
    all.push({ http, relay, port, detach, plugins: [] });

    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${port}` });
    expect(await f.leaderInfo()).toEqual({
      serverVersion: 'test-2.0.0',
      buildId: 777,
      leaderGeneration: TEST_GENERATION,
    });
  });

  it('leaderInfo is undefined for a non-figwright responder and an unreachable leader', async () => {
    const http = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;
    try {
      const f = await testFollower({ leaderUrl: `http://127.0.0.1:${port}` });
      expect(await f.leaderInfo()).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()));
    }

    const dead = await testFollower({ leaderUrl: 'http://127.0.0.1:1', pingTimeoutMs: 200 });
    expect(await dead.leaderInfo()).toBeUndefined();
  });

  it('does not send abdication to a responder without strict leader identity', async () => {
    const http = createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;
    try {
      const f = await testFollower({ leaderUrl: `http://127.0.0.1:${port}` });
      expect(await f.requestAbdication(200)).toBe('error');
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
  });

  it('requestAbdication maps transport failure to error', async () => {
    const f = await testFollower({ leaderUrl: 'http://127.0.0.1:1', pingTimeoutMs: 200 });
    expect(await f.requestAbdication(200)).toBe('error');
  });

  it('sendRpc threads sessionId so the leader pins the call', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }));
    const sid = b.relay.pickActiveSessionId();
    const f = await testFollower({ leaderUrl: `http://127.0.0.1:${b.port}` });

    const ok = await f.sendRpc('get_design_context', {}, 'r-pin', sid);
    expect(ok.kind).toBe('ok');

    const bad = await f.sendRpc('get_design_context', {}, 'r-ghost', 'ghost-session');
    if (bad.kind !== 'err') throw new Error(`expected err, got ${bad.kind}`);
    expect(bad.code).toBe(ErrorCode.PluginDisconnected);
  });
});
