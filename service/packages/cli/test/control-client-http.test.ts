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
const fixture = async (
  handle: (request: IncomingMessage, response: ServerResponse) => void,
  options: { monitoringGraceMs?: number; monitoringSteadyAfterMs?: number } = {},
) => {
  const server = createServer(handle);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  shutdown.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return new ControlClient({ stateRoot: 'fixture', port: address.port, ...options });
};
const operationFixture = (approvals: (read: number, response: ServerResponse) => void) => {
  const counts = { toolCalls: 0, approvalReads: 0, cancellations: 0 };
  let toolResponse: ServerResponse | undefined;
  let statusReads = 0;
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/control/tools/call') {
      counts.toolCalls++;
      toolResponse = response;
    } else if (request.url === '/control/approvals') {
      approvals(++counts.approvalReads, response);
    } else if (request.url?.endsWith('/cancel')) {
      counts.cancellations++;
      response.end('{}');
    } else {
      response.end(JSON.stringify({ status: 'dispatched' }));
      if (++statusReads === 2) toolResponse!.end(JSON.stringify({ planId: 'fixture-plan' }));
    }
  };
  return { counts, handle };
};
const invokePlan = (client: ControlClient, emit: (value: unknown) => void = () => {}) =>
  client.invoke({
    name: 'portal_plan',
    kind: 'tool',
    args: {},
    workspaceId: null,
    targetSelector: { kind: 'none' },
    approve: false,
    operationId: 'sfp_op1_fixture.' + 'A'.repeat(43),
    timeoutMs: 10_000,
    emit,
  });
const busy = (response: ServerResponse) => {
  response.writeHead(503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 'CONTROL_AUTH_BUSY' }));
};

it('keeps a dispatched operation through bounded typed authorization-busy polls', async () => {
  const operation = operationFixture((read, response) => {
    if (read <= 2) busy(response);
    else response.end('[]');
  });
  const client = await fixture(operation.handle);
  const emitted: unknown[] = [];
  await expect(invokePlan(client, value => emitted.push(value))).resolves.toEqual({
    planId: 'fixture-plan',
  });
  expect(operation.counts).toMatchObject({ toolCalls: 1, cancellations: 0 });
  expect(emitted).toContainEqual(
    expect.objectContaining({ status: 'monitoring-delayed', code: 'CONTROL_AUTH_BUSY' }),
  );
});

it('still cancels on untyped monitoring failures and after the bounded busy window', async () => {
  const unavailable = operationFixture((_read, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 'CONTROL_AUTH_UNAVAILABLE' }));
  });
  await expect(invokePlan(await fixture(unavailable.handle))).rejects.toMatchObject({
    code: 'CONTROL_AUTH_UNAVAILABLE',
    status: 500,
  });
  expect(unavailable.counts).toMatchObject({ toolCalls: 1, cancellations: 1 });
  const persistent = operationFixture((_read, response) => busy(response));
  await expect(
    invokePlan(await fixture(persistent.handle, { monitoringGraceMs: 1_500 })),
  ).rejects.toMatchObject({ code: 'CONTROL_AUTH_BUSY', status: 503 });
  expect(persistent.counts).toMatchObject({ toolCalls: 1, cancellations: 1 });
});
it('slows read-only monitoring after the initial window to bound daemon authorization load', async () => {
  const timed = () => {
    let statusReads = 0;
    const handle = (request: IncomingMessage, response: ServerResponse) => {
      if (request.url === '/control/tools/call')
        setTimeout(() => response.end(JSON.stringify({ planId: 'fixture-plan' })), 2_500);
      else if (request.url === '/control/approvals') response.end('[]');
      else {
        statusReads++;
        response.end(JSON.stringify({ status: 'running' }));
      }
    };
    return { handle, reads: () => statusReads };
  };
  const fast = timed();
  await expect(invokePlan(await fixture(fast.handle))).resolves.toEqual({ planId: 'fixture-plan' });
  const steady = timed();
  await expect(
    invokePlan(await fixture(steady.handle, { monitoringSteadyAfterMs: 0 })),
  ).resolves.toEqual({ planId: 'fixture-plan' });
  expect(fast.reads()).toBeGreaterThanOrEqual(6);
  expect(steady.reads()).toBeLessThanOrEqual(4);
}, 20_000);

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
it.each([
  { status: 404, code: 'OPERATION_NOT_FOUND' },
  { status: 401, code: 'AUTH_FAILED' },
  { status: 503, code: 'ECONNRESET' },
])('preserves structured $status control errors without retrying', async ({ status, code }) => {
  let calls = 0;
  const client = await fixture((_request, response) => {
    calls++;
    response.writeHead(status);
    response.end(JSON.stringify({ code }));
  });
  await expect(client.request('/control/test')).rejects.toMatchObject({
    code,
    status,
  });
  expect(calls).toBe(1);
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

it('recovers one reset during read-only operation polling without cancelling or repeating a tool', async () => {
  const operationId = 'sfp_op1_fixture.' + 'A'.repeat(43);
  let toolCalls = 0,
    approvalReads = 0,
    cancellations = 0;
  let toolResponse: ServerResponse | undefined;
  const client = await fixture((request, response) => {
    if (request.url === '/control/tools/call') {
      toolCalls++;
      toolResponse = response;
    } else if (request.url === '/control/approvals') {
      if (++approvalReads === 1) request.socket.destroy();
      else response.end('[]');
    } else if (request.url?.endsWith('/cancel')) {
      cancellations++;
      response.end('{}');
    } else {
      response.end(JSON.stringify({ operationId, status: 'succeeded' }));
      toolResponse!.end(JSON.stringify({ planId: 'fixture-plan' }));
    }
  });
  await expect(
    client.invoke({
      name: 'portal_plan',
      kind: 'tool',
      args: {},
      workspaceId: null,
      targetSelector: { kind: 'none' },
      approve: false,
      operationId,
      timeoutMs: 2000,
      emit: () => {},
    }),
  ).resolves.toEqual({ planId: 'fixture-plan' });
  expect({ toolCalls, approvalReads, cancellations }).toEqual({
    toolCalls: 1,
    approvalReads: 2,
    cancellations: 0,
  });
});

it('bounds reset recovery to one read retry and never repeats a mutating request', async () => {
  const calls = { GET: 0, POST: 0 };
  const client = await fixture(request => {
    calls[request.method as keyof typeof calls]++;
    request.socket.destroy();
  });
  await expect(client.request('/control/test')).rejects.toMatchObject({ code: 'ECONNRESET' });
  await expect(client.request('/control/test', 'POST', {})).rejects.toMatchObject({
    code: 'ECONNRESET',
  });
  expect(calls).toEqual({ GET: 2, POST: 1 });
});

it('restarts a truncated read response without mixing bytes from the two responses', async () => {
  let calls = 0;
  const client = await fixture((_request, response) => {
    if (++calls === 1) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"partial":');
      setTimeout(() => response.destroy(), 10);
    } else response.end('{"complete":true}');
  });
  await expect(client.request('/control/test')).resolves.toEqual({ complete: true });
  expect(calls).toBe(2);
});

it('retains the original caller deadline across a read retry', async () => {
  let calls = 0;
  const client = await fixture(request => {
    if (++calls === 1) request.socket.destroy();
  });
  await expect(
    client.request('/control/test', 'GET', undefined, { timeoutMs: 80 }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(2);
});

it('keeps the cumulative response-byte cap across a truncated read and retry', async () => {
  let calls = 0;
  const body = ' '.repeat(20 * 1024 * 1024);
  const client = await fixture((_request, response) => {
    if (++calls === 1) {
      response.writeHead(200);
      response.write(body, () => setTimeout(() => response.destroy(), 20));
    } else response.end(JSON.stringify({ body }));
  });
  await expect(client.request('/control/test')).rejects.toThrow('CONTROL_RESPONSE_TOO_LARGE');
  expect(calls).toBe(2);
});
