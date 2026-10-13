import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';

import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { test } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../../mcp/src/portal/chrome-runtime.js';

async function fixture(context) {
  const executablePath = googleChromeExecutable();
  requireChrome(context, executablePath);
  if (!executablePath) throw Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const sources = Object.fromEntries(
    await Promise.all(
      ['service-functions.js', 'schema-form.js', 'api.js'].map(async name => [
        name,
        await readFile(new URL('../' + name, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const id = '00000000-0000-4000-8000-000000000001',
    approvalId = '00000000-0000-4000-8000-000000000002';
  let held = null,
    holdNext = false,
    detailReads = 0,
    holdList = false,
    listRelease = null;
  const actions = [];
  const deniedSockets = new Set(),
    unexpectedDeniedSocketErrors = [];
  let job = {
    id,
    name: 'egress.allow',
    type: 'feature',
    status: 'awaiting-confirmation',
    workspaceId: null,
    deadlineAt: Date.now() + 300000,
    operations: [],
    operationId: null,
    approvals: [
      {
        source: 'portal',
        approvalId,
        operationName: 'egress.allow',
        target: { label: 'Owned fixture impact confirmation' },
        effectSummary: ['Owned fixture only; no policy or external effect'],
        expiresAt: Date.now() + 300000,
      },
    ],
    actions: [
      { action: 'approve', enabled: true, reason: '' },
      { action: 'reject', enabled: true, reason: '' },
    ],
    requestPreview: { args: {}, targetSelector: { kind: 'none' } },
    result: null,
    error: null,
    outputHash: null,
    outputBytes: null,
    outputUnavailable: null,
    progress: [],
    recovery: { available: false, challenge: null },
  };
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/bootstrap')
      return response.end(JSON.stringify({ csrfToken: 'OWNED_APPROVAL_CSRF' }));
    if (request.url === '/api/service/catalog')
      return response.end(
        JSON.stringify({
          tools: [],
          features: [
            {
              name: 'egress.allow',
              description: 'Owned approval fixture',
              group: 'egress',
              kind: 'write',
              prerequisites: [],
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            },
          ],
        }),
      );
    if (request.url === '/api/service/jobs') {
      if (holdList) {
        holdList = false;
        await new Promise(resolve => {
          listRelease = resolve;
        });
        listRelease = null;
      }
      return response.end(JSON.stringify({ jobs: [job] }));
    }
    if (request.url === `/api/service/jobs/${id}`) {
      detailReads++;
      if (holdNext) {
        holdNext = false;
        await new Promise(resolve => {
          held = resolve;
        });
        held = null;
      }
      return response.end(JSON.stringify({ job }));
    }
    if (request.url === `/api/service/jobs/${id}/actions`) {
      let bytes = '';
      for await (const chunk of request) bytes += chunk;
      const body = JSON.parse(bytes);
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['x-sfp-csrf'], 'OWNED_APPROVAL_CSRF');
      actions.push(body);
      job = {
        ...job,
        status: 'succeeded',
        approvals: [],
        actions: [],
        result: { fixtureOnly: true },
        requestPreview: null,
      };
      return response.end(JSON.stringify({ job }));
    }
    if (request.url === '/fixture.js') {
      response.setHeader('content-type', 'text/javascript');
      return response.end(
        "import{createApi}from'/api.js';import{mountServiceFunctions}from'/service-functions.js';const api=createApi();await api.bootstrap();window.fixtureReadCompletions=0;const read=api.serviceJob;api.serviceJob=async(...args)=>{const data=await read(...args);window.fixtureReadCompletions++;return data};window.disposeFixture=mountServiceFunctions(document.getElementById('functions'),{api,administrative:true});document.addEventListener('pointerdown',event=>{if(event.target.dataset.jobAction){window.fixtureDownTarget=event.target;window.fixtureDownTrusted=event.isTrusted}});document.addEventListener('pointerup',event=>{window.fixtureUpTrusted=event.isTrusted});",
      );
    }
    const name = request.url.slice(1);
    if (sources[name]) {
      response.setHeader('content-type', 'text/javascript');
      return response.end(sources[name]);
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="functions"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const blocker = createServer((request, response) => {
    const transportError = error => {
      if (!['ECONNRESET', 'EPIPE'].includes(error.code))
        unexpectedDeniedSocketErrors.push('UNEXPECTED_OWNED_PROXY_STREAM_ERROR');
    };
    request.on('error', transportError);
    response.on('error', transportError);
    let target;
    try {
      target = new URL(request.url);
    } catch {
      response.writeHead(502);
      return response.end();
    }
    if (target.origin !== origin) {
      response.writeHead(502);
      return response.end();
    }
    const forward = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: target.pathname + target.search,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${address.port}` },
      },
      result => {
        result.on('error', error => {
          transportError(error);
          response.destroy();
        });
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    forward.on('error', error => {
      transportError(error);
      if (!response.headersSent) response.writeHead(502);
      if (!response.writableEnded) response.end();
    });
    request.pipe(forward);
  });
  blocker.on('connect', (_request, socket) => {
    deniedSockets.add(socket);
    socket.on('error', error => {
      if (!['ECONNRESET', 'EPIPE'].includes(error.code))
        unexpectedDeniedSocketErrors.push('UNEXPECTED_DENIED_SOCKET_ERROR');
      socket.destroy();
    });
    socket.on('close', () => deniedSockets.delete(socket));
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const blockerAddress = blocker.address();
  assert(blockerAddress && typeof blockerAddress !== 'string');
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath,
    headless: true,
    args: ['--disable-background-networking'],
    proxy: { server: `http://127.0.0.1:${blockerAddress.port}`, bypass: '<-loopback>' },
  });
  const browserContext = await browser.newContext();
  await browserContext.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await browserContext.newPage();
  await page.goto(origin + '/');
  await page.locator(`[data-job-id="${id}"]`).click();
  const button = page.locator('[data-job-action=approve]');
  await expect(button).toBeVisible();
  await page.evaluate(
    () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return {
    page,
    button,
    actions,
    id,
    approvalId,
    reads: () => detailReads,
    holdNextRead: () => {
      holdNext = true;
    },
    readHeld: () => held !== null,
    releaseRead: () => held?.(),
    holdNextList: () => {
      holdList = true;
    },
    listHeld: () => listRelease !== null,
    releaseList: () => listRelease?.(),
    close: async () => {
      held?.();
      listRelease?.();
      await browser.close();
      for (const socket of deniedSockets) socket.destroy();
      blocker.closeAllConnections();
      await new Promise(resolve => blocker.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      expect(unexpectedDeniedSocketErrors).toEqual([]);
    },
  };
}

test('keeps the same awaiting-confirmation approval target across an actual poll between trusted pointer down and up', async context => {
  const f = await fixture(context);
  try {
    f.holdNextRead();
    await expect.poll(f.readHeld, { timeout: 15000 }).toBe(true);
    await f.button.scrollIntoViewIfNeeded();
    const box = await f.button.boundingBox();
    assert(box);
    await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await f.page.mouse.down();
    const before = await f.page.evaluate(() => fixtureReadCompletions);
    f.releaseRead();
    await f.page.waitForFunction(value => fixtureReadCompletions > value, before);
    await f.page.evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await f.page.mouse.up();
    expect(await f.page.evaluate(() => [fixtureDownTrusted, fixtureUpTrusted])).toEqual([
      true,
      true,
    ]);
    await expect.poll(() => f.actions.length, { timeout: 6000 }).toBe(1);
    expect(f.actions).toEqual([{ action: 'approve', approvalId: f.approvalId }]);
    await expect(f.page.locator('#service-job-detail')).toContainText('성공');
  } finally {
    await f.close();
  }
}, 60000);

test('makes approval unavailable during an existing request and restores a trusted ordinary click after it settles', async context => {
  const f = await fixture(context);
  try {
    f.holdNextList();
    await f.page.getByRole('button', { name: '요청 기록 새로고침' }).click();
    await expect.poll(f.listHeld, { timeout: 15000 }).toBe(true);
    await expect(f.button).toBeDisabled();
    expect(f.actions).toHaveLength(0);
    f.releaseList();
    await expect(f.button).toBeEnabled();
    await f.button.click();
    await expect.poll(() => f.actions.length).toBe(1);
    expect(f.actions[0]).toEqual({ action: 'approve', approvalId: f.approvalId });
  } finally {
    await f.close();
  }
}, 60000);
