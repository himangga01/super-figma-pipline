import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../mcp/src/security/state-permissions.js', () => ({
  createStatePermissions: () => ({ verifySecure: async () => {} }),
}));
vi.mock('../../mcp/src/security/follower-auth.js', () => ({
  createFollowerAuth: async () => ({
    authorization: async () => ({ value: 'fixture-credential', generation: 'fixture-generation' }),
  }),
}));

import { ControlClient } from '../src/control-client.js';

const shutdown: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of shutdown.splice(0)) await close();
});
const fixture = async (handle: (request: IncomingMessage, response: ServerResponse) => void) => {
  const server = createServer(handle);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  shutdown.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return new ControlClient({ stateRoot: 'fixture', port: address.port });
};
it('uses the reviewed control credential and accepts a delayed chunked response', async () => {
  const client = await fixture((request, response) => {
    expect(request.headers.authorization).toBe('fixture-credential');
    expect(request.headers['x-sfp-leader-generation']).toBe('fixture-generation');
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"state":');
      response.end('"ready"}');
    }, 60);
  });
  expect(
    await client.request('/control/test', 'POST', { example: true }, { timeoutMs: 1000 }),
  ).toEqual({ state: 'ready' });
});
it('preserves structured control errors instead of retrying or following redirects', async () => {
  const client = await fixture((_request, response) => {
    response.writeHead(404);
    response.end('{"code":"OPERATION_NOT_FOUND"}');
  });
  await expect(client.request('/control/test')).rejects.toMatchObject({
    code: 'OPERATION_NOT_FOUND',
    status: 404,
  });
});
it('aborts an unresponsive request at the caller budget', async () => {
  const client = await fixture(() => {});
  await expect(
    client.request('/control/test', 'GET', undefined, { timeoutMs: 50 }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it('reports the same operation public failure code without repeating its tool request', async () => {
  const operationId = 'sfp_op1_fixture.' + 'A'.repeat(43);
  let calls = 0;
  const client = await fixture((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/control/tools/call') {
      calls++;
      response.writeHead(500);
      response.end(JSON.stringify({ code: 'INTERNAL_ERROR' }));
    } else if (request.url === '/control/approvals') response.end('[]');
    else
      response.end(
        JSON.stringify({
          operationId,
          status: 'failed',
          errorCode: 'PORTAL_BINARY_SOURCE_FORBIDDEN',
        }),
      );
  });
  await expect(
    client.invoke({
      name: 'portal_submit',
      kind: 'tool',
      args: {},
      workspaceId: null,
      targetSelector: { kind: 'none' },
      approve: false,
      operationId,
      emit: () => {},
    }),
  ).rejects.toMatchObject({
    code: 'PORTAL_BINARY_SOURCE_FORBIDDEN',
    operationId,
    operationStatus: 'failed',
  });
  expect(calls).toBe(1);
});
