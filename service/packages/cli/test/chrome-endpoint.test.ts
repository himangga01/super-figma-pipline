import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  resolveChromeWebSocketEndpoint,
  resolveExistingChromeEndpoint,
} from '../src/chrome-endpoint.js';
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  for (const root of roots.splice(0)) {
    const part = relative(tmpdir(), root);
    if (!part || isAbsolute(part) || part.startsWith('..'))
      throw Error('Invalid discovery fixture root');
    await rm(root, { recursive: true, force: true });
  }
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-chrome-endpoint-'));
  roots.push(root);
  return { root, options: { environment: { SFP_CHROME_USER_DATA_DIR: root } } };
};
it('uses the exact existing browser websocket path rather than dropping its identifier', async () => {
  const value = await fixture();
  await writeFile(
    join(value.root, 'DevToolsActivePort'),
    '9222\n/devtools/browser/existing-browser-id\n',
  );
  expect(await resolveExistingChromeEndpoint(value.options)).toBe(
    'ws://127.0.0.1:9222/devtools/browser/existing-browser-id',
  );
});
it('reports a missing Chrome discovery prerequisite before constructing a websocket relay', async () => {
  const value = await fixture();
  await expect(resolveExistingChromeEndpoint(value.options)).rejects.toMatchObject({
    code: 'CHROME_CONNECTION_REQUIRED',
  });
});
it('refuses malformed discovery content without allowing another host or URL', async () => {
  const value = await fixture();
  await writeFile(
    join(value.root, 'DevToolsActivePort'),
    '9222\n//remote.example/devtools/browser/token\n',
  );
  await expect(resolveExistingChromeEndpoint(value.options)).rejects.toThrow(
    'CHROME_CDP_RECORD_INVALID',
  );
});

const httpFixture = async (handler: RequestListener) => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP_FIXTURE_ADDRESS_INVALID');
  return `http://127.0.0.1:${address.port}`;
};

it('resolves an explicit loopback HTTP endpoint to its validated Chrome websocket', async () => {
  const paths: string[] = [];
  const endpoint = await httpFixture((request, response) => {
    paths.push(request.url ?? '');
    response.end(
      JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fixture-id' }),
    );
  });
  expect(await resolveChromeWebSocketEndpoint(`${endpoint}/cdp`)).toBe(
    'ws://127.0.0.1:9222/devtools/browser/fixture-id',
  );
  expect(paths).toEqual(['/cdp/json/version/']);
});

it('preserves explicit websocket endpoints and rejects invalid input without a request', async () => {
  const request = vi.fn<RequestListener>();
  const endpoint = await httpFixture(request);
  const websocket = endpoint.replace('http:', 'ws:') + '/devtools/browser/fixture-id';
  expect(await resolveChromeWebSocketEndpoint(websocket)).toBe(websocket);
  for (const input of [
    'chrome',
    'http://remote.example:9222',
    `${endpoint}/?token=private`,
    `${endpoint}/#private`,
  ])
    await expect(resolveChromeWebSocketEndpoint(input)).rejects.toMatchObject({
      code: 'CHROME_CDP_INVALID',
    });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  'http://127.0.0.1:9222',
  'ws://remote.example:9222/devtools/browser/id',
  'ws://127.0.0.1:9222/path?token=private',
  'ws://user:password@127.0.0.1:9222/path',
])('rejects an unsafe HTTP discovery websocket result: %s', async result => {
  const endpoint = await httpFixture((_request, response) =>
    response.end(JSON.stringify({ webSocketDebuggerUrl: result })),
  );
  await expect(resolveChromeWebSocketEndpoint(endpoint)).rejects.toMatchObject({
    code: 'CHROME_CDP_INVALID',
  });
});

it('does not follow a discovery redirect', async () => {
  const follow = vi.fn<RequestListener>((_request, response) => {
    response.end('{}');
  });
  const destination = await httpFixture(follow);
  const endpoint = await httpFixture((_request, response) => {
    response.writeHead(302, { Location: destination });
    response.end();
  });
  await expect(resolveChromeWebSocketEndpoint(endpoint)).rejects.toMatchObject({
    code: 'CHROME_CONNECTION_REQUIRED',
  });
  expect(follow).not.toHaveBeenCalled();
});

it.each(['not-json', '{}', 'x'.repeat(4097)])(
  'rejects malformed or oversized HTTP discovery data (case %#)',
  async data => {
    const endpoint = await httpFixture((_request, response) => response.end(data));
    await expect(resolveChromeWebSocketEndpoint(endpoint)).rejects.toMatchObject({
      code: 'CHROME_CDP_INVALID',
    });
  },
);

it('bounds stalled HTTP discovery without opening a browser connection', async () => {
  const endpoint = await httpFixture(() => {});
  await expect(resolveChromeWebSocketEndpoint(endpoint, { timeoutMs: 50 })).rejects.toMatchObject({
    code: 'CHROME_CONNECTION_REQUIRED',
  });
});

it('cancels stalled discovery using the caller reason and never requests after pre-cancellation', async () => {
  const seen = vi.fn<RequestListener>(() => {});
  const endpoint = await httpFixture(seen);
  const reason = Error('owned-discovery-cancelled');
  await expect(
    resolveChromeWebSocketEndpoint(endpoint, { signal: AbortSignal.abort(reason) }),
  ).rejects.toBe(reason);
  expect(seen).not.toHaveBeenCalled();
  const controller = new AbortController();
  const reading = resolveChromeWebSocketEndpoint(endpoint, { signal: controller.signal });
  await vi.waitFor(() => expect(seen).toHaveBeenCalledOnce());
  controller.abort(reason);
  await expect(reading).rejects.toBe(reason);
});
