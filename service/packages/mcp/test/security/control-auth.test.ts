import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { decode, encode } from '@msgpack/msgpack';
import { PRODUCT_MAGIC, PROTOCOL_VERSION, RpcResponseSchema } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import { dispatchTool } from '../../src/dispatch.js';
import { ControlRouteRegistry } from '../../src/election/control-route-registry.js';
import { Follower } from '../../src/election/follower.js';
import {
  attachLeaderEndpoints,
  type LeaderEndpointDeps,
} from '../../src/election/leader-endpoints.js';
import { NodeRole } from '../../src/election/node.js';
import { createFollowerAuth } from '../../src/security/follower-auth.js';
import {
  createFollowerAuthenticatedTransport,
  createFollowerTransportRequestId,
  type FollowerAuthenticatedTransport,
  FollowerTransportError,
} from '../../src/security/follower-transport.js';
import { RPC_REQUEST_MAX_BYTES } from '../../src/security/request-limits.js';

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: Record<string, unknown>;
}

const servers: Server[] = [];

const call = async (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: Buffer | string,
): Promise<HttpResult> =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        } catch {
          // RPC uses MessagePack and empty unauthorized responses are allowed.
        }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: bytes, json });
      });
    });
    req.once('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

const start = async (extraDeps: Partial<LeaderEndpointDeps> = {}) => {
  const generation = {
    generation: Buffer.alloc(16, 1).toString('base64url'),
    followerToken: Buffer.alloc(32, 2).toString('base64url'),
    controlToken: Buffer.alloc(32, 3).toString('base64url'),
    createdAt: Date.now(),
  };
  const challenges: string[] = [];
  const relayed: unknown[] = [];
  const http = createServer();
  servers.push(http);
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const port = (http.address() as AddressInfo).port;
  const transport = await createFollowerAuthenticatedTransport({
    leaderUrl: `http://127.0.0.1:${port}`,
    mcpSession: `mcp1_${Buffer.alloc(16, 4).toString('base64url')}`,
    memory: generation,
  });
  attachLeaderEndpoints(http, {
    ...extraDeps,
    relay: {
      sessions: { connected: () => [] },
      pickActiveSessionId: () => undefined,
      pendingCount: () => 0,
      lastRequestAt: () => 0,
      sendRequest: async (_tool: string, args: unknown) => {
        relayed.push(args);
        return { ok: true };
      },
      skewNotice: () => null,
    } as never,
    serverVersion: '0.1.0',
    buildId: 42,
    leaderGeneration: generation.generation,
    transport,
    pairing: {
      createChallenge: async (actor: string) => {
        challenges.push(actor);
        return {
          challengeId: 'ABCDEFGHIJ',
          code: '12345678',
          expiresAt: 1234,
          attemptsRemaining: 5,
        };
      },
      exchange: async () => ({ wsTicket: 'ticket', expiresAt: 1234 }),
    },
  });
  return { port, generation, transport, challenges, relayed };
};

const sealedCall = async (
  _port: number,
  transport: FollowerAuthenticatedTransport,
  path: '/rpc' | '/abdicate',
  plaintext: Buffer,
): Promise<HttpResult> => {
  const records = await transport.client.open(
    { path, transportRequestId: createFollowerTransportRequestId(), plaintext },
    AbortSignal.timeout(5_000),
  );
  let body: Buffer | undefined;
  for await (const record of records) {
    if (record.sequence !== 0 || !record.final || body !== undefined) {
      throw new Error('expected one final opaque record');
    }
    body = Buffer.from(record.plaintext);
  }
  if (body === undefined) throw new Error('missing final opaque record');
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
  } catch {
    // RPC remains MessagePack after the encrypted transport envelope is opened.
  }
  return { status: 200, headers: {}, body, json };
};

const followerWithFacade = async (options: {
  leaderUrl: string;
  generation: string;
  followerToken: string;
  controlToken?: string;
  fetch?: typeof globalThis.fetch;
  pingTimeoutMs?: number;
}): Promise<Follower> => {
  const transport = await createFollowerAuthenticatedTransport({
    leaderUrl: options.leaderUrl,
    mcpSession: `mcp1_${Buffer.alloc(16, 6).toString('base64url')}`,
    memory: {
      generation: options.generation,
      followerToken: options.followerToken,
      controlToken: options.controlToken ?? Buffer.alloc(32, 7).toString('base64url'),
      createdAt: 1,
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return new Follower({
    leaderUrl: options.leaderUrl,
    transport: transport.client,
    ...(options.pingTimeoutMs === undefined ? {} : { pingTimeoutMs: options.pingTimeoutMs }),
  });
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe('follower and control middleware', () => {
  it('requires the follower token on /rpc and never forwards unauthorized args', async () => {
    const { port, transport, relayed } = await start();
    const rpc = Buffer.from(
      encode({ requestId: 'r1', toolName: 'get_document', args: { secret: 'do-not-forward' } }),
    );

    const missing = await call(
      port,
      'POST',
      '/rpc',
      { 'content-type': 'application/msgpack' },
      rpc,
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.connection).toBe('close');
    expect(relayed).toHaveLength(0);

    const allowed = await sealedCall(port, transport, '/rpc', rpc);
    expect(allowed.status).toBe(200);
    expect(relayed).toEqual([{ secret: 'do-not-forward' }]);
  });

  it('keeps the canonical transport ID separate from the legacy RPC requestId', async () => {
    const { port, transport, relayed } = await start();
    const plaintext = Buffer.from(
      encode({ requestId: 'body-request', toolName: 'get_document', args: { ok: true } }),
    );
    const response = await sealedCall(port, transport, '/rpc', plaintext);
    expect(RpcResponseSchema.parse(decode(response.body))).toMatchObject({
      kind: 'ok',
      requestId: 'body-request',
    });
    expect(relayed).toEqual([{ ok: true }]);
  });

  it('rejects an oversized authenticated RPC before decoding or relaying it', async () => {
    const { transport, relayed } = await start();
    await expect(
      transport.client.open(
        {
          path: '/rpc',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext: Buffer.alloc(RPC_REQUEST_MAX_BYTES + 1),
        },
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(relayed).toHaveLength(0);
  });

  it('requires follower auth on /abdicate before parsing its body', async () => {
    const { port, transport } = await start();
    const missing = await call(
      port,
      'POST',
      '/abdicate',
      { 'content-type': 'application/json' },
      '{invalid',
    );
    expect(missing.status).toBe(401);

    const allowed = await sealedCall(
      port,
      transport,
      '/abdicate',
      Buffer.from(JSON.stringify({ buildId: 1 }), 'utf8'),
    );
    expect(allowed.status).toBe(200);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe abdication buildId %s',
    async buildId => {
      const { port, transport } = await start();
      const response = await sealedCall(
        port,
        transport,
        '/abdicate',
        Buffer.from(JSON.stringify({ buildId }), 'utf8'),
      );
      expect(response).toMatchObject({ status: 200, json: { ok: false, reason: 'invalid' } });
    },
  );

  it('requires control auth on every /control path and emits no CORS/PNA headers', async () => {
    const { port, generation, challenges } = await start();
    const missing = await call(port, 'POST', '/control/pair/challenge');
    expect(missing.status).toBe(401);
    expect(challenges).toHaveLength(0);

    const namespaceRoot = await call(port, 'GET', '/control');
    expect(namespaceRoot.status).toBe(401);

    const allowed = await call(port, 'POST', '/control/pair/challenge', {
      authorization: `Bearer ${generation.controlToken}`,
      'x-sfp-leader-generation': generation.generation,
    });
    expect(allowed).toMatchObject({
      status: 200,
      json: { challengeId: 'ABCDEFGHIJ', code: '12345678', attemptsRemaining: 5 },
    });
    expect(challenges).toEqual(['owner-local']);
    expect(allowed.headers['access-control-allow-origin']).toBeUndefined();
    expect(allowed.headers['access-control-allow-private-network']).toBeUndefined();
    expect(allowed.headers['cache-control']).toBe('no-store');

    const forbiddenFutureRoute = await call(port, 'POST', '/control/tools/call', {
      authorization: `Bearer ${generation.controlToken}`,
      'x-sfp-leader-generation': generation.generation,
    });
    expect(forbiddenFutureRoute.status).toBe(404);
  });

  it('authenticates before deriving a principal or dispatching the typed Task7 router', async () => {
    let principalDerivations = 0;
    let routeCalls = 0;
    const typed = new AuthenticatedControlRouter();
    typed.register({
      id: 'status',
      method: 'GET',
      path: '/control/status',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handle: async () => {
        routeCalls += 1;
        return { ok: true as const };
      },
    });
    typed.freeze();
    const controlRoutes = new ControlRouteRegistry();
    controlRoutes.register(
      '/control',
      createControlHttpHandler({
        router: typed,
        principalForRequest: async () => {
          principalDerivations += 1;
          return {
            actorId: `actor1_${'A'.repeat(43)}`,
            authSessionId: `auth1_${'B'.repeat(43)}`,
            entryPath: 'control',
          };
        },
      }),
    );
    const { port, generation } = await start({ controlRoutes });

    expect((await call(port, 'GET', '/control/status')).status).toBe(401);
    expect(principalDerivations).toBe(0);
    expect(routeCalls).toBe(0);
    const allowed = await call(port, 'GET', '/control/status', {
      authorization: `Bearer ${generation.controlToken}`,
      'x-sfp-leader-generation': generation.generation,
    });
    expect(allowed).toMatchObject({ status: 200, json: { ok: true } });
    expect(principalDerivations).toBe(1);
    expect(routeCalls).toBe(1);
  });

  it('rejects unread chunked bodies on pair-challenge and closes unknown control routes', async () => {
    const { port, generation, challenges, relayed } = await start();
    const challengeBody = JSON.stringify({ actor: 'body-must-not-authorize' });
    const headers = {
      authorization: `Bearer ${generation.controlToken}`,
      'content-type': 'application/json',
      'x-sfp-leader-generation': generation.generation,
    };
    const challenge = await call(
      port,
      'POST',
      '/control/pair/challenge',
      { ...headers, 'content-length': String(Buffer.byteLength(challengeBody)) },
      challengeBody,
    );
    expect(challenge.status).toBe(400);
    expect(challenge.headers.connection).toBe('close');
    expect(challenges).toEqual([]);

    const unknown = await call(
      port,
      'POST',
      '/control/not-a-route',
      headers,
      'x'.repeat(32 * 1024),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers.connection).toBe('close');
    expect(challenges).toEqual([]);
    expect(relayed).toEqual([]);
  });

  it('rejects old follower and control tokens immediately after generation rotation', async () => {
    const { port, generation, transport } = await start();
    const oldClient = await createFollowerAuthenticatedTransport({
      leaderUrl: `http://127.0.0.1:${port}`,
      mcpSession: `mcp1_${Buffer.alloc(16, 5).toString('base64url')}`,
      memory: generation,
    });
    await transport.generation.rotate();
    const body = Buffer.from(encode({ requestId: 'r1', toolName: 'get_document' }));

    await expect(
      oldClient.client.open(
        {
          path: '/rpc',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext: body,
        },
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });

    const oldControl = await call(port, 'POST', '/control/pair/challenge', {
      authorization: `Bearer ${generation.controlToken}`,
      'x-sfp-leader-generation': generation.generation,
    });
    expect(oldControl.status).toBe(401);

    expect(body.byteLength).toBeGreaterThan(0);
  });
});

describe('leader identity and unknown-role handling', () => {
  it('quarantines a previously trusted follower before args or Authorization reach a replacement port', async () => {
    const generation = Buffer.alloc(16, 51).toString('base64url');
    const followerToken = Buffer.alloc(32, 52).toString('base64url');
    const credentials = {
      generation,
      followerToken,
      controlToken: Buffer.alloc(32, 53).toString('base64url'),
      createdAt: 1,
    };
    let serverTransport!: FollowerAuthenticatedTransport;
    let identity: 'leader' | 'foreign' = 'leader';
    const sensitiveRequests: Array<{ authorization: string | undefined; body: string }> = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/ping') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            identity === 'leader'
              ? {
                  ok: true,
                  product: PRODUCT_MAGIC,
                  protocolVersion: PROTOCOL_VERSION,
                  role: 'leader',
                  serverVersion: '0.1.0',
                  buildId: 1,
                  leaderGeneration: generation,
                }
              : { ok: true, serverVersion: 'lookalike' },
          ),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/follower/challenge') {
        void serverTransport.server.serveChallengeHttp(req, res);
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        sensitiveRequests.push({
          authorization:
            typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
          body: Buffer.concat(chunks).toString('base64'),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    serverTransport = await createFollowerAuthenticatedTransport({
      leaderUrl: `http://127.0.0.1:${port}`,
      mcpSession: `mcp1_${Buffer.alloc(16, 50).toString('base64url')}`,
      memory: credentials,
    });
    const follower = await followerWithFacade({
      leaderUrl: `http://127.0.0.1:${port}`,
      generation,
      followerToken,
      controlToken: credentials.controlToken,
    });
    await expect(follower.leaderInfo()).resolves.toMatchObject({ leaderGeneration: generation });

    identity = 'foreign';
    await expect(
      follower.sendRpc('get_document', { secret: 'must-not-reach-replacement' }, 'replacement-rpc'),
    ).resolves.toMatchObject({ kind: 'err', code: 'NOT_LEADER' });
    await expect(follower.requestAbdication(2)).resolves.toBe('error');
    await expect(follower.resolveActiveSession()).resolves.toBeUndefined();
    expect(sensitiveRequests).toEqual([]);
  });

  it('sends only bound ciphertext if a fully mimicking port replaces the leader after proof', async () => {
    const generation = Buffer.alloc(16, 54).toString('base64url');
    const followerToken = Buffer.alloc(32, 55).toString('base64url');
    const auth = await createFollowerAuth({
      memory: {
        generation,
        followerToken,
        controlToken: Buffer.alloc(32, 56).toString('base64url'),
        createdAt: 1,
      },
    });
    let observedHeaders: Headers | undefined;
    let observedCiphertext: Buffer | undefined;
    const ping = JSON.stringify({
      ok: true,
      product: PRODUCT_MAGIC,
      protocolVersion: PROTOCOL_VERSION,
      role: 'leader',
      serverVersion: '0.1.0',
      buildId: 1,
      leaderGeneration: generation,
    });
    const follower = await followerWithFacade({
      leaderUrl: 'http://127.0.0.1:1',
      generation,
      followerToken,
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'POST') {
          observedHeaders = new Headers(init.headers);
          observedCiphertext = Buffer.from(init.body as Buffer);
          return new Response(Buffer.from([0xc0]), {
            status: 200,
            headers: { 'content-type': 'application/sfp-encrypted' },
          });
        }
        return new Response(
          String(input).endsWith('/follower/challenge')
            ? JSON.stringify(await auth.issueFollowerChallenge())
            : ping,
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const secret = 'must-not-be-visible-to-replacement';
    await follower.sendRpc('get_document', { secret }, 'mimic-rpc');
    expect(observedHeaders?.get('authorization')).toBeNull();
    expect(observedCiphertext).toBeDefined();
    expect(observedCiphertext?.toString('utf8')).not.toContain(secret);
    expect(observedCiphertext?.toString('base64')).not.toContain(
      Buffer.from(secret).toString('base64'),
    );
  });

  it('returns strict product/protocol/build identity and rejects a foreign 2xx responder', async () => {
    const { port } = await start();
    const ping = await call(port, 'GET', '/ping');
    expect(ping).toMatchObject({
      status: 200,
      json: {
        ok: true,
        product: PRODUCT_MAGIC,
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: '0.1.0',
        buildId: 42,
      },
    });

    const follower = await followerWithFacade({
      leaderUrl: 'http://127.0.0.1:1',
      generation: Buffer.alloc(16, 80).toString('base64url'),
      followerToken: Buffer.alloc(32, 81).toString('base64url'),
      fetch: async () =>
        new Response(JSON.stringify({ ok: true, serverVersion: 'foreign' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(follower.ping()).resolves.toBe(false);
    await expect(follower.leaderInfo()).resolves.toBeUndefined();
  });

  it('rejects an otherwise valid leader identity above the bounded HTTP response cap', async () => {
    const generation = Buffer.alloc(16, 82).toString('base64url');
    const body = JSON.stringify({
      ok: true,
      product: PRODUCT_MAGIC,
      protocolVersion: PROTOCOL_VERSION,
      role: 'leader',
      serverVersion: '0.1.0',
      buildId: 1,
      leaderGeneration: generation,
    });
    const follower = await followerWithFacade({
      leaderUrl: 'http://127.0.0.1:1',
      generation,
      followerToken: Buffer.alloc(32, 83).toString('base64url'),
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': '16385' },
        }),
    });
    await expect(follower.ping()).resolves.toBe(false);
  });

  it('converts an oversized follower RPC response into typed PAYLOAD_TOO_LARGE', async () => {
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      transport: {
        mcpSession: `mcp1_${Buffer.alloc(16, 60).toString('base64url')}`,
        leaderInfo: async () => undefined,
        open: async () => {
          throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
        },
      },
    });
    await expect(follower.sendRpc('get_document', {}, 'oversized-response')).resolves.toMatchObject(
      {
        kind: 'err',
        requestId: 'oversized-response',
        code: 'PAYLOAD_TOO_LARGE',
      },
    );
  });

  it('rejects an authenticated RPC response whose decoded requestId differs from its transport binding', async () => {
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      transport: {
        mcpSession: `mcp1_${Buffer.alloc(16, 70).toString('base64url')}`,
        leaderInfo: async () => undefined,
        open: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              sequence: 0,
              final: true,
              plaintext: Buffer.from(
                encode({ kind: 'ok', requestId: 'different-request', result: { leaked: true } }),
              ),
            };
          },
        }),
      },
    });

    await expect(follower.sendRpc('get_document', {}, 'expected-request')).resolves.toMatchObject({
      kind: 'err',
      requestId: 'expected-request',
      code: 'INTERNAL_ERROR',
    });
  });

  it('rejects product-looking ping data with a malformed leader generation', async () => {
    const follower = await followerWithFacade({
      leaderUrl: 'http://127.0.0.1:1',
      generation: Buffer.alloc(16, 84).toString('base64url'),
      followerToken: Buffer.alloc(32, 85).toString('base64url'),
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            product: PRODUCT_MAGIC,
            protocolVersion: PROTOCOL_VERSION,
            role: 'leader',
            serverVersion: '0.1.0',
            buildId: 1,
            leaderGeneration: 'not-a-generation',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    await expect(follower.ping()).resolves.toBe(false);
  });

  it('fails an Unknown node before a follower request can send tool args', async () => {
    const open = vi.fn<() => Promise<never>>(async () => {
      throw new Error('network must not be reached');
    });
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      transport: {
        mcpSession: `mcp1_${Buffer.alloc(16, 86).toString('base64url')}`,
        leaderInfo: async () => undefined,
        open,
      },
    });
    const unknownNode = {
      role: NodeRole.Unknown,
      isLeader: () => false,
      isFollower: () => false,
      isConflicted: () => false,
      onRoleChange: () => () => {},
    };

    await expect(
      dispatchTool(
        { node: unknownNode as never, follower },
        'get_document',
        { secret: 'must-not-leave-process' },
        { maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_LEADER' });
    expect(open).not.toHaveBeenCalled();
  });
});
