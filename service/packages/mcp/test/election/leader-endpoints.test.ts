import { createServer, type Server as HttpServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { decode, encode } from '@msgpack/msgpack';
import {
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  ErrorCode,
  getRelayBudget,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
  SystemMethod,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { z } from 'zod';

import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import { ControlRouteRegistry } from '../../src/election/control-route-registry.js';
import {
  ABDICATE_PATH,
  attachLeaderEndpoints,
  type LeaderEndpointDeps,
  PING_PATH,
  RPC_PATH,
} from '../../src/election/leader-endpoints.js';
import { Relay } from '../../src/relay/relay.js';
import {
  createFollowerAuthenticatedTransport,
  createFollowerTransportRequestId,
  type FollowerAuthenticatedTransport,
} from '../../src/security/follower-transport.js';

interface Bound {
  http: HttpServer;
  relay: Relay;
  port: number;
  detach: () => void;
  plugins: WebSocket[];
  transport: FollowerAuthenticatedTransport;
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
const authenticatedHello = (clientVersion = MIN_PLUGIN_VERSION) => ({
  credential: { kind: 'ticket' as const, value: 'test-ticket' },
  nonce: Buffer.alloc(16, 4).toString('base64url'),
  protocolVersion: PROTOCOL_VERSION,
  productVersion: '0.1.0',
  pluginVersion: clientVersion,
  pluginGeneration: 'plugin-generation-test',
  editorType: 'figma' as const,
  mode: 'default',
  fileIdentity: { kind: 'figma-file-key' as const, value: 'file-key-test' },
  fileName: 'Endpoint Test',
  capabilities: [],
});

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

const startLeader = async (
  rpcTimeoutMs = 5_000,
  extraDeps: Partial<LeaderEndpointDeps> = {},
): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({
    serverVersion: '1.0.0',
    server: http,
    authenticator: {
      authenticateHello: async (_input, context) => ({
        sessionId: context.requestedSessionId,
        rotatedResumeToken: Buffer.alloc(32, 5).toString('base64url'),
        resumeExpiresAt: Date.now() + 60_000,
      }),
    },
  });
  const transport = await createFollowerAuthenticatedTransport({
    leaderUrl: `http://127.0.0.1:${port}`,
    mcpSession: `mcp1_${Buffer.alloc(16, 8).toString('base64url')}`,
    memory: TEST_CREDENTIALS,
  });
  const detach = attachLeaderEndpoints(http, {
    ...extraDeps,
    relay,
    serverVersion: '1.0.0',
    rpcTimeoutMs,
    leaderGeneration: extraDeps.leaderGeneration ?? TEST_GENERATION,
    transport: extraDeps.transport ?? transport,
    pairing:
      extraDeps.pairing ??
      ({
        createChallenge: async () => ({
          challengeId: 'ABCDEFGHIJ',
          code: '12345678',
          expiresAt: Date.now() + 60_000,
          attemptsRemaining: 5,
        }),
        exchange: async () => ({
          wsTicket: 'AAAAAAAAAAAAAAAAAAAAAA',
          expiresAt: Date.now() + 30_000,
        }),
      } satisfies LeaderEndpointDeps['pairing']),
    innerRpcHandler:
      extraDeps.innerRpcHandler ??
      (async (opened, response) => {
        let decoded: unknown;
        try {
          decoded = decode(opened.plaintext);
        } catch {
          await response.write(
            Buffer.from(
              encode({
                kind: 'err',
                requestId: '',
                code: ErrorCode.InvalidRequest,
                message: 'invalid msgpack body',
              } satisfies RpcResponse),
            ),
            { final: true },
          );
          return;
        }
        const rpc = (await import('@sfp/shared')).RpcRequestSchema.safeParse(decoded);
        if (!rpc.success) {
          await response.write(
            Buffer.from(
              encode({
                kind: 'err',
                requestId: '',
                code: ErrorCode.InvalidParams,
                message: 'invalid rpc request',
              } satisfies RpcResponse),
            ),
            { final: true },
          );
          return;
        }
        const { requestId, toolName, args, sessionId } = rpc.data;
        let body: RpcResponse;
        try {
          let notice: string | null = null;
          const result = await relay.sendRequest(
            toolName,
            args,
            rpcTimeoutMs ?? getRelayBudget(toolName),
            sessionId,
            served => {
              notice = relay.skewNotice(served);
            },
          );
          body = {
            kind: 'ok',
            requestId,
            result,
            ...(notice === null ? {} : { notice }),
          };
        } catch (error) {
          const message = (error as Error).message;
          const code =
            message.startsWith('no plugin connected') || message.startsWith('pinned session')
              ? ErrorCode.PluginDisconnected
              : message.includes('timeout')
                ? ErrorCode.Timeout
                : ErrorCode.Internal;
          body = { kind: 'err', requestId, code, message };
        }
        await response.write(Buffer.from(encode(body)), { final: true });
      }),
  });
  const b: Bound = { http, relay, port, detach, plugins: [], transport };
  all.push(b);
  return b;
};

const openOne = async (
  port: number,
  path: '/rpc' | '/abdicate',
  plaintext: Buffer,
): Promise<Buffer> => {
  const bound = all.find(item => item.port === port);
  if (bound === undefined) throw new Error('leader fixture not found');
  const records = await bound.transport.client.open(
    {
      path,
      transportRequestId: createFollowerTransportRequestId(),
      plaintext,
    },
    AbortSignal.timeout(5_000),
  );
  let result: Buffer | undefined;
  for await (const record of records) {
    if (record.sequence !== 0 || !record.final || result !== undefined) {
      throw new Error('expected one final opaque record');
    }
    result = Buffer.from(record.plaintext);
  }
  if (result === undefined) throw new Error('missing final opaque record');
  return result;
};

const postAbdicate = async (
  port: number,
  body: unknown,
): Promise<{ status: number; body: { ok: boolean; reason?: string } }> => {
  const plaintext = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return {
    status: 200,
    body: JSON.parse((await openOne(port, ABDICATE_PATH, plaintext)).toString('utf8')) as {
      ok: boolean;
      reason?: string;
    },
  };
};

const attachFakePlugin = async (
  b: Bound,
  handle: (method: string, params: unknown) => Promise<unknown>,
  clientVersion: string = MIN_PLUGIN_VERSION,
): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws`, { origin: 'null' });
  ws.binaryType = 'arraybuffer';
  await new Promise<void>(resolve => ws.once('open', () => resolve()));
  const sessionId = newId();

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

  const helloParams = authenticatedHello(clientVersion);
  ws.send(
    encodeEnvelope(
      createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams }),
    ),
  );
  await helloReceived;
  b.plugins.push(ws);
  return ws;
};

const callRpc = async (port: number, req: RpcRequest): Promise<RpcResponse> => {
  const buf = new Uint8Array(await openOne(port, RPC_PATH, Buffer.from(encode(req))));
  return RpcResponseSchema.parse(decode(buf));
};

describe('leader endpoints', () => {
  it('GET /ping returns stable server identity without plugin-count oracle', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.serverVersion).toBe('1.0.0');
    expect(body.plugins).toBeUndefined();

    await attachFakePlugin(b, async () => ({ noop: true }));
    const res2 = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2).toEqual(body);
  });

  it('GET /ping never exposes the active relay session', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.activeSessionId).toBeUndefined();

    await attachFakePlugin(b, async () => ({ noop: true }));
    const res2 = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(b.relay.pickActiveSessionId()).toBeDefined();
    expect(body2.activeSessionId).toBeUndefined();
  });

  it('POST /rpc honors a sessionId pin and rejects an unknown one', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ pinned: true }));
    const sid = b.relay.pickActiveSessionId();
    expect(typeof sid).toBe('string');

    const ok = await callRpc(b.port, {
      requestId: 'r1',
      toolName: 'get_design_context',
      sessionId: sid,
    });
    expect(ok).toMatchObject({ kind: 'ok', result: { pinned: true } });

    const bad = await callRpc(b.port, {
      requestId: 'r2',
      toolName: 'get_design_context',
      sessionId: 'ghost',
    });
    expect(bad).toMatchObject({ kind: 'err', code: ErrorCode.PluginDisconnected });
  });

  it('POST /rpc forwards to plugin and returns its result', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('get_selection');
      expect(params).toEqual({ fileKey: 'abc' });
      return { ids: ['1:1', '1:2'] };
    });

    const resp = await callRpc(b.port, {
      requestId: 'r-1',
      toolName: 'get_selection',
      args: { fileKey: 'abc' },
    });
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.requestId).toBe('r-1');
    expect(resp.result).toEqual({ ids: ['1:1', '1:2'] });
  });

  it('POST /rpc carries the skew warning back to the follower that asked', async () => {
    // The production half of the warning for anyone whose MCP server is a follower — a normal
    // state, since several servers share one plugin and only one of them holds the relay. Faking
    // this response in the dispatch test proves the follower *reads* it; nothing proved the leader
    // ever *writes* it. Deleting the attachment left all 1387 tests green.
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }), '0.0.1');

    const resp = await callRpc(b.port, { requestId: 'r-skew', toolName: 'set_fills', args: {} });

    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.notice).toMatch(/older than this server/i);
    expect(resp.notice).toMatch(/unverified/i);
  });

  it('POST /rpc attaches no warning for a current plugin', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }));

    const resp = await callRpc(b.port, { requestId: 'r-ok', toolName: 'set_fills', args: {} });

    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.notice).toBeUndefined();
  });

  it('POST /rpc queues request and surfaces Timeout when no plugin ever connects', async () => {
    const b = await startLeader(50);
    const resp = await callRpc(b.port, {
      requestId: 'r-2',
      toolName: 'whatever',
    });
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
    expect(resp.requestId).toBe('r-2');
  });

  it('POST /rpc flushes queued call once plugin connects', async () => {
    const b = await startLeader(1_000);
    const respPromise = callRpc(b.port, {
      requestId: 'r-flush',
      toolName: 'late_tool',
      args: { x: 1 },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(b.relay.queuedCount()).toBe(1);

    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('late_tool');
      expect(params).toEqual({ x: 1 });
      return { ok: 'flushed' };
    });

    const resp = await respPromise;
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.result).toEqual({ ok: 'flushed' });
  });

  it('POST /rpc returns TIMEOUT when plugin does not reply in time', async () => {
    const b = await startLeader(50);
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws`, { origin: 'null' });
    ws.binaryType = 'arraybuffer';
    await new Promise<void>(resolve => ws.once('open', () => resolve()));
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: authenticatedHello(),
        }),
      ),
    );
    await new Promise<void>(resolve => ws.once('message', () => resolve()));
    b.plugins.push(ws);

    const resp = await callRpc(b.port, { requestId: 'r-3', toolName: 'slow_tool' });
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
  });

  it('POST /rpc rejects invalid msgpack body', async () => {
    const b = await startLeader();
    const plaintext = await openOne(b.port, RPC_PATH, Buffer.from([0xff, 0xff, 0xff]));
    expect(RpcResponseSchema.parse(decode(plaintext))).toMatchObject({
      kind: 'err',
      code: ErrorCode.InvalidRequest,
    });
  });

  it('POST /rpc rejects schema-invalid request', async () => {
    const b = await startLeader();
    const buf = new Uint8Array(
      await openOne(b.port, RPC_PATH, Buffer.from(encode({ requestId: 'r-x' }))),
    );
    const parsed = RpcResponseSchema.parse(decode(buf));
    if (parsed.kind !== 'err') throw new Error(`expected err, got ${parsed.kind}`);
    expect(parsed.code).toBe(ErrorCode.InvalidParams);
  });

  it('GET on unknown path returns 404', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}/nope`);
    expect(res.status).toBe(404);
  });

  it('refuses any request carrying an Origin, since only browsers send one', async () => {
    const b = await startLeader();
    const attach = await attachFakePlugin(b, () => Promise.resolve({ pong: true }));
    expect(attach).toBeDefined();

    // The CSRF shape: a simple request needs no preflight, so the page's POST would land and its
    // side effect would happen even though the reply is unreadable.
    const rpc = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
      body: Buffer.from(encode({ requestId: 'r-csrf', toolName: 'ping' })),
    });
    expect(rpc.status).toBe(403);

    const ping = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(ping.status).toBe(403);

    const abdicate = await fetch(`http://127.0.0.1:${b.port}${ABDICATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ buildId: 999_999 }),
    });
    expect(abdicate.status).toBe(403);
  });

  it('refuses a request addressed to a rebound domain, on the readable GET path too', async () => {
    const b = await startLeader();

    // What DNS rebinding looks like on the wire: the page believes it is same-origin with
    // attacker.com, so it sends no Origin and *can* read the reply — but Host gives it away.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: b.port,
          path: PING_PATH,
          method: 'GET',
          headers: { host: 'evil.example:' + String(b.port) },
        },
        res => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('POST /rpc fails closed for the legacy plaintext follower transport', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from(encode({ requestId: 'r-ct', toolName: 'ping' })),
    });
    expect(res.status).toBe(401);
  });

  it('POST /abdicate fails closed for the legacy plaintext follower transport', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${ABDICATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ buildId: 999_999 }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /ping advertises the buildId (0 when unset)', async () => {
    const bare = await startLeader();
    const bareBody = (await (
      await fetch(`http://127.0.0.1:${bare.port}${PING_PATH}`)
    ).json()) as Record<string, unknown>;
    expect(Object.keys(bareBody).toSorted()).toEqual([
      'buildId',
      'leaderGeneration',
      'ok',
      'product',
      'protocolVersion',
      'role',
      'serverVersion',
    ]);
    expect(bareBody.buildId).toBe(0);

    const stamped = await startLeader(5_000, { buildId: 1234 });
    const stampedBody = (await (
      await fetch(`http://127.0.0.1:${stamped.port}${PING_PATH}`)
    ).json()) as { buildId: number };
    expect(stampedBody.buildId).toBe(1234);
  });
});

describe('POST /abdicate', () => {
  it('accepts a strictly newer build and releases after the response flushes', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    const { status, body } = await postAbdicate(b.port, { buildId: 200 });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    // onAbdicate fires on the response's 'finish' — by the time fetch resolved, it flushed.
    await new Promise(r => setTimeout(r, 20));
    expect(released).toBe(1);
  });

  it('refuses an equal or older build', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    expect((await postAbdicate(b.port, { buildId: 100 })).body).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect((await postAbdicate(b.port, { buildId: 50 })).body).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(released).toBe(0);
  });

  it('answers unsupported when no release hook is wired', async () => {
    const b = await startLeader(5_000, { buildId: 100, abdicateQuietWindowMs: 0 });
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('defers while a relay request is in flight', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    // No plugin connected → the request queues as pending until its own timeout.
    const pending = b.relay.sendRequest('slow_tool', {}, 1_000).catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(released).toBe(0);
    await pending;
  });

  it('defers inside the quiet window after recent traffic, then accepts once it elapses', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 150,
    });
    // A completed (timed-out) request leaves no pending entry but stamps lastRequestAt.
    await b.relay.sendRequest('quick_tool', {}, 10).catch(() => {});
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(released).toBe(0);

    await new Promise(r => setTimeout(r, 160));
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({ ok: true });
    await new Promise(r => setTimeout(r, 20));
    expect(released).toBe(1);
  });

  it('rejects malformed bodies', async () => {
    const b = await startLeader(5_000, { buildId: 100, abdicateQuietWindowMs: 0 });
    for (const body of ['not json{{', {}, { buildId: 'newest' }]) {
      expect(await postAbdicate(b.port, body)).toEqual({
        status: 200,
        body: { ok: false, reason: 'invalid' },
      });
    }
  });
});

describe('typed authenticated control extension', () => {
  it('reaches sibling Task7 routes through the single frozen /control seam', async () => {
    const typed = new AuthenticatedControlRouter();
    typed.register({
      id: 'status',
      method: 'GET',
      path: '/control/status',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ schemaVersion: z.literal(1), ok: z.literal(true) }).strict(),
      handle: async () => ({ schemaVersion: 1 as const, ok: true as const }),
    });
    typed.freeze();
    const extension = new ControlRouteRegistry();
    extension.register(
      '/control',
      createControlHttpHandler({
        router: typed,
        principalForRequest: async () => ({
          actorId: `actor1_${'A'.repeat(43)}`,
          authSessionId: `auth1_${'B'.repeat(43)}`,
          entryPath: 'control',
        }),
      }),
    );
    const leader = await startLeader(5_000, { controlRoutes: extension });

    const observed = await new Promise<{ status: number; body: string }>(
      (resolvePromise, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: leader.port,
            method: 'GET',
            path: '/control/status',
            headers: {
              authorization: `Bearer ${TEST_CONTROL_TOKEN}`,
              'x-sfp-leader-generation': TEST_GENERATION,
            },
          },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () =>
              resolvePromise({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );

    expect(observed).toEqual({ status: 200, body: '{"schemaVersion":1,"ok":true}' });
  });
});
