import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import { PairingError } from '../../src/security/pairing-manager.js';

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: Record<string, unknown>;
}

const servers: Server[] = [];

const stubRelay = {
  sessions: { connected: () => [] },
  pickActiveSessionId: () => undefined,
  pendingCount: () => 0,
  lastRequestAt: () => 0,
};

const start = async (): Promise<{
  port: number;
  pairing: { exchangeCalls: number };
  logs: string[];
}> => {
  const http = createServer();
  servers.push(http);
  const pairing = { exchangeCalls: 0 };
  const logs: string[] = [];
  attachLeaderEndpoints(http, {
    relay: stubRelay as never,
    serverVersion: '0.1.0',
    buildId: 42,
    log: message => logs.push(message),
    leaderGeneration: 'leader-generation-a',
    auth: {
      authorizeFollower: async () => false,
      authorizeControl: async () => false,
    },
    pairing: {
      createChallenge: async () => {
        throw new Error('not used');
      },
      exchange: async (_challengeId: string, code: string) => {
        pairing.exchangeCalls += 1;
        if (code === '00000001') throw new PairingError('PAIR_CODE_WRONG', 401);
        if (code === '00000002') throw new PairingError('PAIR_CODE_EXPIRED', 401);
        if (code === '00000003') throw new PairingError('PAIR_CODE_USED', 409);
        if (code === '00000004') throw new PairingError('PAIR_RATE_LIMITED', 429);
        if (code === '00000005') throw new Error('raw internal secret ticket-secret');
        return { wsTicket: 'AAAAAAAAAAAAAAAAAAAAAA', expiresAt: 1234 };
      },
    },
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  return { port: (http.address() as AddressInfo).port, pairing, logs };
};

const call = async (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string | undefined>,
  body?: string,
): Promise<HttpResult> =>
  new Promise((resolve, reject) => {
    const cleanHeaders = Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: cleanHeaders },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
          } catch {
            // Empty hostile-origin responses deliberately contain no oracle body.
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: bytes,
            json,
          });
        });
      },
    );
    req.once('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

const preflightHeaders = (origin: string | undefined): Record<string, string | undefined> => ({
  origin,
  'access-control-request-method': 'POST',
  'access-control-request-headers': 'content-type',
  'access-control-request-private-network': 'true',
});

const post = (
  port: number,
  origin: string | undefined,
  code = '12345678',
  path = '/pair/exchange',
): Promise<HttpResult> =>
  call(
    port,
    'POST',
    path,
    { origin, 'content-type': 'application/json' },
    JSON.stringify({ challengeId: 'ABCDEFGHIJ', code }),
  );

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

describe('private-network pair exchange', () => {
  it.each(['null', 'https://www.figma.com', 'https://figma.com'])(
    'returns the literal PNA response for allowed Origin %s',
    async origin => {
      const { port } = await start();
      const response = await call(port, 'OPTIONS', '/pair/exchange', preflightHeaders(origin));

      expect(response.status).toBe(204);
      expect(response.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-private-network': 'true',
        'access-control-max-age': '0',
        vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
      });
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    },
  );

  it.each([
    ['hostile origin', '/pair/exchange', { ...preflightHeaders('https://evil.example') }],
    ['absent origin', '/pair/exchange', { ...preflightHeaders(undefined) }],
    [
      'wrong method',
      '/pair/exchange',
      { ...preflightHeaders('null'), 'access-control-request-method': 'PUT' },
    ],
    [
      'extra header',
      '/pair/exchange',
      { ...preflightHeaders('null'), 'access-control-request-headers': 'content-type, x-extra' },
    ],
    [
      'missing PNA',
      '/pair/exchange',
      { ...preflightHeaders('null'), 'access-control-request-private-network': undefined },
    ],
    ['wrong path', '/pair/exchange?x=1', { ...preflightHeaders('null') }],
  ])('returns no CORS/PNA oracle for %s', async (_case, path, headers) => {
    const { port } = await start();
    const response = await call(port, 'OPTIONS', path, headers);

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-private-network']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
  });

  it.each([
    [
      'body-bearing OPTIONS',
      'OPTIONS',
      '/pair/exchange',
      { ...preflightHeaders('null'), 'content-length': '4' },
      'body',
      403,
    ],
    ['chunked GET ping', 'GET', '/ping', { 'transfer-encoding': 'chunked' }, 'body', 400],
    [
      'declared GET follower challenge',
      'GET',
      '/follower/challenge',
      { 'content-length': '4' },
      'body',
      400,
    ],
    ['chunked generic 404', 'POST', '/not-a-route', {}, 'body', 404],
  ])(
    'closes %s without leaving unread bytes on keep-alive',
    async (_case, method, path, headers, body, status) => {
      const { port, pairing } = await start();
      const response = await call(port, method, path, headers, body);
      expect(response.status).toBe(status);
      expect(response.headers.connection).toBe('close');
      expect(pairing.exchangeCalls).toBe(0);
    },
  );

  it('rejects a non-loopback Host without an oracle response', async () => {
    const { port } = await start();
    const response = await call(port, 'OPTIONS', '/pair/exchange', {
      ...preflightHeaders('null'),
      host: 'evil.example',
    });
    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.body).toHaveLength(0);
  });

  it('does not log query-string secrets from a rejected Host request', async () => {
    const { port, logs } = await start();
    const response = await call(port, 'GET', '/pair/exchange?code=log-secret-value', {
      host: 'evil.example',
    });
    expect(response.status).toBe(403);
    expect(logs.join('\n')).not.toContain('log-secret-value');
  });

  it.each(['null', 'https://www.figma.com', 'https://figma.com'])(
    'makes POST success and typed errors readable to allowed Origin %s',
    async origin => {
      const { port } = await start();
      const ok = await post(port, origin);
      expect(ok.status).toBe(200);
      expect(ok.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-private-network': 'true',
        'cache-control': 'no-store',
        vary: 'Origin',
      });

      const wrong = await post(port, origin, '00000001');
      expect(wrong.status).toBe(401);
      expect(wrong.json.code).toBe('PAIR_CODE_WRONG');
      expect(wrong.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-private-network': 'true',
        vary: 'Origin',
      });
    },
  );

  it.each([
    ['00000001', 401, 'PAIR_CODE_WRONG'],
    ['00000002', 401, 'PAIR_CODE_EXPIRED'],
    ['00000003', 409, 'PAIR_CODE_USED'],
    ['00000004', 429, 'PAIR_RATE_LIMITED'],
    ['00000005', 500, 'PAIR_INTERNAL'],
  ])('keeps typed %s response readable as %s/%s', async (fixture, status, code) => {
    const { port } = await start();
    const response = await post(port, 'null', fixture);
    expect(response).toMatchObject({ status, json: { code } });
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': 'null',
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    });
    expect(response.body.toString('utf8')).not.toContain('ticket-secret');
  });

  it.each([
    ['invalid JSON', '{', 400, 'PAIR_BODY_INVALID'],
    ['invalid shape', '{}', 400, 'PAIR_BODY_INVALID'],
  ])('keeps allowed-Origin %s errors readable', async (_case, body, status, code) => {
    const { port } = await start();
    const response = await call(
      port,
      'POST',
      '/pair/exchange',
      { origin: 'null', 'content-type': 'application/json' },
      body,
    );
    expect(response).toMatchObject({ status, json: { code } });
    expect(response.headers['access-control-allow-origin']).toBe('null');
  });

  it.each([
    ['chunked', {}],
    ['declared', { 'content-length': String(32 * 1024) }],
  ])('closes a wrong-media pair POST with unread %s bytes', async (_mode, extraHeaders) => {
    const { port, pairing } = await start();
    const response = await call(
      port,
      'POST',
      '/pair/exchange',
      { origin: 'null', 'content-type': 'text/plain', ...extraHeaders },
      'x'.repeat(32 * 1024),
    );
    expect(response).toMatchObject({
      status: 400,
      json: { code: 'PAIR_BODY_INVALID' },
    });
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': 'null',
      'access-control-allow-private-network': 'true',
      connection: 'close',
      vary: 'Origin',
    });
    expect(pairing.exchangeCalls).toBe(0);
  });

  it.each([undefined, 'https://evil.example'])(
    'does not expose or consume a valid exchange for Origin %s',
    async origin => {
      const { port, pairing } = await start();
      const rejected = await post(port, origin);
      expect(rejected.status).toBe(403);
      expect(rejected.headers.vary).toBe('Origin');
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
      expect(rejected.headers['access-control-allow-private-network']).toBeUndefined();
      expect(rejected.headers.connection).toBe('close');
      expect(rejected.body).toHaveLength(0);
      expect(pairing.exchangeCalls).toBe(0);

      const allowed = await post(port, 'null');
      expect(allowed.status).toBe(200);
      expect(pairing.exchangeCalls).toBe(1);
    },
  );
});
