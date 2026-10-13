import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import {
  Diagnostics,
  diagnose,
  diagnosticHeaders,
  observeHttp,
} from '../../mcp/src/diagnostics.js';
import { PortalBridge } from '../src/bridge.js';
import { createPortalServer } from '../src/server.js';
import { PortalStore } from '../src/store.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing address');
  return `http://127.0.0.1:${address.port}`;
}
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'sfp-diagnostics-http-'));
  cleanup.push(() => rm(value, { recursive: true, force: true }));
  return value;
}

it('correlates real portal HTTP, durable failed job and daemon HTTP while omitting input and result bodies', async () => {
  const portalRoot = await root(),
    daemonRoot = await root();
  const portalDiagnostics = new Diagnostics(portalRoot, 'portal', { level: 'debug' });
  const daemonDiagnostics = new Diagnostics(daemonRoot, 'daemon', { level: 'debug' });
  const secret = 'PRIVATE_TOKEN_OR_CODE_BODY';
  const daemon = createServer((request, response) =>
    observeHttp(daemonDiagnostics, request, response, { buildId: 123 }, () => {
      diagnose(
        'control.dispatch-error',
        { status: 500 },
        Object.assign(new TypeError(`Invalid URL ${secret}`), {
          code: 'ERR_INVALID_URL',
          input: secret,
        }),
        'error',
      );
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'ERR_INVALID_URL' }));
    }),
  );
  const daemonUrl = await listen(daemon),
    store = await PortalStore.open(portalRoot);
  const descriptor = {
    name: 'status',
    description: 'Read service',
    group: 'service',
    kind: 'read' as const,
    inputSchema: {},
    prerequisites: [],
    confirmationRequired: false,
  };
  const bridge = new PortalBridge(store, {
    health: async () => true,
    workspaces: async () => [],
    invoke: async () => null,
    decide: async () => {},
    serviceJobs: {
      catalog: async () => ({ tools: [], features: [descriptor] }),
      prepare: async input => ({ descriptor, args: input.args }),
      execute: async (_input, context) => {
        await context.beforeInvoke({
          operationId: 'owned-operation',
          name: 'status',
          kind: 'service',
          workspaceId: null,
        });
        const response = await fetch(`${daemonUrl}/control/status?private=${secret}`, {
          headers: { ...diagnosticHeaders(), authorization: secret },
        });
        expect(response.status).toBe(500);
        throw Object.assign(new TypeError(`Invalid URL ${secret}`), {
          code: 'ERR_INVALID_URL',
          input: secret,
        });
      },
      decide: async () => {},
      inspect: async () => null,
    },
  });
  const server = createPortalServer({
    store,
    bridge,
    webRoot: portalRoot,
    diagnostics: portalDiagnostics,
  });
  const url = await listen(server);
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  const response = await fetch(`${url}/api/service/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sfp-csrf': bootstrap.csrfToken },
    body: JSON.stringify({
      type: 'feature',
      name: 'status',
      args: { code: secret },
      workspaceId: null,
      targetSelector: { kind: 'none' },
    }),
  });
  expect(response.status).toBe(202);
  const { job } = await response.json(),
    requestId = response.headers.get('x-sfp-request-id');
  const jobs = await bridge.jobs();
  await jobs.idle();
  expect(jobs.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'ERR_INVALID_URL' });
  await portalDiagnostics.flush();
  await daemonDiagnostics.flush();
  const portal = await readFile(join(portalDiagnostics.directory, 'portal.jsonl'), 'utf8');
  const daemonLog = await readFile(join(daemonDiagnostics.directory, 'daemon.jsonl'), 'utf8');
  expect(portal + daemonLog).not.toContain(secret);
  expect(portal + daemonLog).not.toContain('authorization');
  const rows = portal
    .trim()
    .split('\n')
    .map(value => JSON.parse(value));
  expect(rows.find(row => row.event === 'job.execution-error')).toMatchObject({
    requestId,
    jobId: job.id,
  });
  expect(rows.find(row => row.event === 'job.finished')).toMatchObject({
    outcome: 'failed',
    jobId: job.id,
  });
  const daemonRows = daemonLog
    .trim()
    .split('\n')
    .map(value => JSON.parse(value));
  expect(daemonRows.find(row => row.event === 'http.finish')).toMatchObject({
    parentRequestId: requestId,
    jobId: job.id,
    status: 500,
    buildId: 123,
  });
  expect(
    rows.some(
      row => row.event === 'job.operation-retained' && row.operationIdHash?.startsWith('sha256:'),
    ),
  ).toBe(true);
  const health = await (await fetch(`${url}/api/health`)).json();
  expect(health.diagnostics).toMatchObject({
    location: 'diagnostics/portal.jsonl',
    writeFailures: 0,
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
  expect(portalDiagnostics.status().pending).toBe(0);
});

it('retains a typed HTTP error and activity audit when diagnostics persistence fails', async () => {
  const stateRoot = await root(),
    store = await PortalStore.open(stateRoot);
  await writeFile(join(stateRoot, 'diagnostics'), 'owned obstruction');
  const logger = new Diagnostics(stateRoot, 'portal', { signal: () => {} });
  const server = createPortalServer({
    store,
    bridge: new PortalBridge(store, {
      health: async () => true,
      workspaces: async () => [],
      invoke: async () => null,
      decide: async () => {},
    }),
    webRoot: stateRoot,
    diagnostics: logger,
  });
  const url = await listen(server),
    response = await fetch(`${url}/api/not-present?token=private`);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  await logger.flush();
  expect(logger.status().writeFailures).toBeGreaterThan(0);
  expect(store.listActivities({}).activities.some(row => row.type === 'request.rejected')).toBe(
    true,
  );
});
