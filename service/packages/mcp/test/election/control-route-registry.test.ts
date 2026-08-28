import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ControlRouteRegistry,
  ControlRouteRegistryError,
} from '../../src/election/control-route-registry.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';

const servers: Server[] = [];

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

const start = async (routes: ControlRouteRegistry): Promise<number> => {
  const server = createServer();
  servers.push(server);
  attachLeaderEndpoints(server, {
    relay: {
      sessions: { connected: () => [] },
      pickActiveSessionId: () => undefined,
      pendingCount: () => 0,
      lastRequestAt: () => 0,
    } as never,
    serverVersion: '0.1.0',
    buildId: 1,
    leaderGeneration: Buffer.alloc(16, 1).toString('base64url'),
    transport: {
      control: { authorizeHttp: async () => true },
      server: {
        serveChallengeHttp: async () => {
          throw new Error('not used');
        },
        serveHttp: async () => {
          throw new Error('not used');
        },
      },
    },
    pairing: {
      createChallenge: async () => {
        throw new Error('not used');
      },
      exchange: async () => {
        throw new Error('not used');
      },
    },
    controlRoutes: routes,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
};

describe('ControlRouteRegistry', () => {
  it('rejects invalid, duplicate, overlapping, and post-freeze registration', () => {
    for (const prefix of ['/rpc', '/control', '/control/', '/control/x?query=1', '/control/x/']) {
      const registry = new ControlRouteRegistry();
      expect(() => registry.register(prefix, async () => true)).toThrowError(
        expect.objectContaining<Partial<ControlRouteRegistryError>>({
          code: 'CONTROL_ROUTE_INVALID',
        }),
      );
    }

    const registry = new ControlRouteRegistry();
    registry.register('/control/task7', async () => true);
    for (const prefix of ['/control/task7', '/control/task7/child', '/control/other']) {
      expect(() => registry.register(prefix, async () => true)).toThrowError(
        expect.objectContaining<Partial<ControlRouteRegistryError>>({
          code: 'CONTROL_ROUTE_DUPLICATE',
        }),
      );
    }
    registry.freeze();
    expect(() => registry.register('/control/late', async () => true)).toThrowError(
      expect.objectContaining<Partial<ControlRouteRegistryError>>({ code: 'CONTROL_ROUTE_FROZEN' }),
    );
  });

  it('freezes before listener attach and invokes the matching async handler exactly once', async () => {
    const routes = new ControlRouteRegistry();
    let calls = 0;
    routes.register('/control/task7', async (_req, res) => {
      calls += 1;
      await new Promise(resolve => setImmediate(resolve));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    });
    const port = await start(routes);
    expect(() => routes.register('/control/late', async () => true)).toThrowError(
      expect.objectContaining({ code: 'CONTROL_ROUTE_FROZEN' }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/control/task7/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(calls).toBe(1);

    const unknown = await fetch(`http://127.0.0.1:${port}/control/other`, {
      method: 'POST',
      body: 'unread',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('connection')).toBe('close');
    expect(calls).toBe(1);
  });

  it.each([
    ['returns false after sending headers', true, false],
    ['returns true without sending headers', false, true],
  ] as const)('fails closed when a handler %s', async (_case, sendHeaders, result) => {
    const routes = new ControlRouteRegistry();
    routes.register('/control/task7', async (_req, res) => {
      if (sendHeaders) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('partial');
      }
      await new Promise(resolve => setImmediate(resolve));
      return result;
    });
    const port = await start(routes);
    const outcome = await fetch(`http://127.0.0.1:${port}/control/task7`).then(
      async response => {
        try {
          await response.text();
          return { kind: 'response' as const, status: response.status };
        } catch {
          return { kind: 'closed' as const };
        }
      },
      () => ({ kind: 'closed' as const }),
    );
    expect(outcome).not.toEqual({ kind: 'response', status: 404 });
    expect(outcome).toMatchObject(
      sendHeaders ? { kind: 'closed' } : { kind: 'response', status: 500 },
    );
  });
});
