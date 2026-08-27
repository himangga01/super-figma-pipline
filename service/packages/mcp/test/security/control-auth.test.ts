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
