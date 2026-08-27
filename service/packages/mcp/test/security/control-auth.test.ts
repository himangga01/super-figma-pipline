import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { decode, encode } from '@msgpack/msgpack';
import { PRODUCT_MAGIC, PROTOCOL_VERSION } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchTool } from '../../src/dispatch.js';
import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import { NodeRole } from '../../src/election/node.js';
import { createFollowerAuth } from '../../src/security/follower-auth.js';
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

const start = async () => {
  const generation = {
    generation: Buffer.alloc(16, 1).toString('base64url'),
    followerToken: Buffer.alloc(32, 2).toString('base64url'),
    controlToken: Buffer.alloc(32, 3).toString('base64url'),
    createdAt: Date.now(),
  };
  const auth = await createFollowerAuth({
    memory: generation,
  });
  const challenges: string[] = [];
  const relayed: unknown[] = [];
  const http = createServer();
  servers.push(http);
  attachLeaderEndpoints(http, {
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
    auth,
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
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  return { port: (http.address() as AddressInfo).port, generation, auth, challenges, relayed };
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
    const { port, generation, relayed } = await start();
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

    const allowed = await call(
      port,
      'POST',
      '/rpc',
      {
        'content-type': 'application/msgpack',
        authorization: `Bearer ${generation.followerToken}`,
        'x-sfp-leader-generation': generation.generation,
      },
      rpc,
    );
    expect(allowed.status).toBe(200);
    expect(relayed).toEqual([{ secret: 'do-not-forward' }]);
  });

  it('rejects an oversized authenticated RPC before decoding or relaying it', async () => {
    const { port, generation, relayed } = await start();
    const response = await call(
      port,
      'POST',
      '/rpc',
      {
        'content-type': 'application/msgpack',
        authorization: `Bearer ${generation.followerToken}`,
        'x-sfp-leader-generation': generation.generation,
      },
      Buffer.alloc(RPC_REQUEST_MAX_BYTES + 1),
    );
    expect(response.status).toBe(413);
    expect(response.headers.connection).toBe('close');
    expect(decode(response.body)).toMatchObject({
      kind: 'err',
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(relayed).toHaveLength(0);
  });

  it('requires follower auth on /abdicate before parsing its body', async () => {
    const { port, generation } = await start();
    const missing = await call(
      port,
      'POST',
      '/abdicate',
      { 'content-type': 'application/json' },
      '{invalid',
    );
    expect(missing.status).toBe(401);

    const allowed = await call(
      port,
      'POST',
      '/abdicate',
      {
        'content-type': 'application/json',
        authorization: `Bearer ${generation.followerToken}`,
        'x-sfp-leader-generation': generation.generation,
      },
      JSON.stringify({ buildId: 1 }),
    );
    expect(allowed.status).toBe(200);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe abdication buildId %s',
    async buildId => {
      const { port, generation } = await start();
      const response = await call(
        port,
        'POST',
        '/abdicate',
        {
          'content-type': 'application/json',
          authorization: `Bearer ${generation.followerToken}`,
          'x-sfp-leader-generation': generation.generation,
        },
        JSON.stringify({ buildId }),
      );
      expect(response.status).toBe(400);
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
    const { port, generation, auth } = await start();
    const current = await auth.rotate();
    const body = Buffer.from(encode({ requestId: 'r1', toolName: 'get_document' }));

    const oldFollower = await call(
      port,
      'POST',
      '/rpc',
      {
        'content-type': 'application/msgpack',
        authorization: `Bearer ${generation.followerToken}`,
        'x-sfp-leader-generation': generation.generation,
      },
      body,
    );
    expect(oldFollower.status).toBe(401);

    const oldControl = await call(port, 'POST', '/control/pair/challenge', {
      authorization: `Bearer ${generation.controlToken}`,
      'x-sfp-leader-generation': generation.generation,
    });
    expect(oldControl.status).toBe(401);

    const newFollower = await call(
      port,
      'POST',
      '/rpc',
      {
        'content-type': 'application/msgpack',
        authorization: `Bearer ${current.followerToken}`,
        'x-sfp-leader-generation': current.generation,
      },
      body,
    );
    expect(newFollower.status).toBe(200);
  });
});

describe('leader identity and unknown-role handling', () => {
  it('quarantines a previously trusted follower before args or Authorization reach a replacement port', async () => {
    const generation = Buffer.alloc(16, 51).toString('base64url');
    const followerToken = Buffer.alloc(32, 52).toString('base64url');
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
                  activeSessionId: 'session-before-replacement',
                }
              : { ok: true, serverVersion: 'lookalike' },
          ),
        );
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
    const follower = new Follower({
      leaderUrl: `http://127.0.0.1:${port}`,
      credentialProvider: async () => ({
        generation,
        value: `Bearer ${followerToken}`,
      }),
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

    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
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
    const body = JSON.stringify({
      ok: true,
      product: PRODUCT_MAGIC,
      protocolVersion: PROTOCOL_VERSION,
      role: 'leader',
      serverVersion: '0.1.0',
      buildId: 1,
      leaderGeneration: 'generation',
    });
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      responseMaxBytes: Buffer.byteLength(body) - 1,
      fetch: async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    await expect(follower.ping()).resolves.toBe(false);
  });

  it('converts an oversized follower RPC response into typed PAYLOAD_TOO_LARGE', async () => {
    const generation = Buffer.alloc(16, 61).toString('base64url');
    const pingBody = JSON.stringify({
      ok: true,
      product: PRODUCT_MAGIC,
      protocolVersion: PROTOCOL_VERSION,
      role: 'leader',
      serverVersion: '0.1.0',
      buildId: 1,
      leaderGeneration: generation,
    });
    const responseCap = Buffer.byteLength(pingBody) + 8;
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      responseMaxBytes: responseCap,
      credentialProvider: async () => ({
        generation,
        value: `Bearer ${Buffer.alloc(32, 62).toString('base64url')}`,
      }),
      fetch: async (_input, init) =>
        init?.method === 'POST'
          ? new Response(Buffer.alloc(responseCap + 1), { status: 200 })
          : new Response(pingBody, {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
    });
    await expect(follower.sendRpc('get_document', {}, 'oversized-response')).resolves.toMatchObject(
      {
        kind: 'err',
        requestId: 'oversized-response',
        code: 'PAYLOAD_TOO_LARGE',
      },
    );
  });

  it('rejects product-looking ping data with a malformed leader generation', async () => {
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
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
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('network must not be reached');
    });
    const follower = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      fetch,
      credentialProvider: async () => ({ generation: 'g', value: 'Bearer token' }),
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
    expect(fetch).not.toHaveBeenCalled();
  });
});
