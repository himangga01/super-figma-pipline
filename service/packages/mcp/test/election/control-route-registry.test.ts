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
  it('accepts only one literal /control registration and rejects duplicates after freeze', () => {
    for (const prefix of ['/rpc', '/control/', '/control/task7', '/control?query=1', '/controlx']) {
      const registry = new ControlRouteRegistry();
      expect(() => registry.register(prefix, async () => true)).toThrowError(
        expect.objectContaining<Partial<ControlRouteRegistryError>>({
          code: 'CONTROL_ROUTE_INVALID',
        }),
      );
    }

    const registry = new ControlRouteRegistry();
    expect(() => registry.register('/control', async () => true)).not.toThrow();
    expect(() => registry.register('/control', async () => true)).toThrowError(
      expect.objectContaining<Partial<ControlRouteRegistryError>>({
        code: 'CONTROL_ROUTE_DUPLICATE',
      }),
    );
    registry.freeze();
    expect(() => registry.register('/control', async () => true)).toThrowError(
      expect.objectContaining<Partial<ControlRouteRegistryError>>({ code: 'CONTROL_ROUTE_FROZEN' }),
    );
  });

  it('routes the /control root and every sibling through one frozen handler exactly once', async () => {
    const routes = new ControlRouteRegistry();
    let calls = 0;
    routes.register('/control', async (req, res) => {
      calls += 1;
      await new Promise(resolve => setImmediate(resolve));
      if (req.url === '/control/unknown') return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ route: req.url }));
      return true;
    });
    const port = await start(routes);
    expect(() => routes.register('/control', async () => true)).toThrowError(
      expect.objectContaining({ code: 'CONTROL_ROUTE_FROZEN' }),
    );

    const siblingUrls = [
      '/control',
      '/control/status',
      '/control/tools/call',
      '/control/workspaces',
      '/control/operations/op-1',
      '/control/network/fetch',
      '/control/snapshots',
    ];
    for (const url of siblingUrls) {
      // eslint-disable-next-line no-await-in-loop -- each route response proves exact-once ownership
      const response = await fetch(`http://127.0.0.1:${port}${url}`);
      expect(response.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop -- consume each response before the next request
      expect(await response.json()).toEqual({ route: url });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(calls).toBe(siblingUrls.length);

    const unknown = await fetch(`http://127.0.0.1:${port}/control/unknown`, {
      method: 'POST',
      body: 'unread',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('connection')).toBe('close');
    expect(calls).toBe(siblingUrls.length + 1);

    for (const url of ['/control?query=1', '/controlx']) {
      // eslint-disable-next-line no-await-in-loop -- negative path checks are independent requests
      const response = await fetch(`http://127.0.0.1:${port}${url}`);
      expect(response.status).toBe(404);
    }
    expect(calls).toBe(siblingUrls.length + 1);
  });

  it.each([
    ['returns false after sending headers', true, false],
    ['returns true without sending headers', false, true],
  ] as const)('fails closed when a handler %s', async (_case, sendHeaders, result) => {
    const routes = new ControlRouteRegistry();
    routes.register('/control', async (_req, res) => {
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
