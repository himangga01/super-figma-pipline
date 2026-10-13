import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { test } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../../mcp/src/portal/chrome-runtime.js';
import { PortalBridge } from '../../src/bridge.js';
import { defaultWorkflow } from '../../src/contract.js';
import { createPortalServer } from '../../src/server.js';
import { PortalStore } from '../../src/store.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
async function fixture(context, { saved = false, held = false } = {}) {
  const executablePath = googleChromeExecutable();
  requireChrome(context, executablePath);
  if (!executablePath) throw Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const directory = await mkdtemp(
    fileURLToPath(new URL('./first-workspace-owned-', import.meta.url)),
  );
  const store = await PortalStore.open(directory);
  if (saved) await store.createWorkflow({ ...defaultWorkflow(), name: 'Saved owner draft' });
  let release,
    registered = false,
    invokes = 0;
  const gate = held
    ? new Promise(resolve => {
        release = resolve;
      })
    : Promise.resolve();
  const workspace = { workspaceId, realPath: directory, availability: 'available' };
  const bridge = new PortalBridge(store, {
    health: async () => true,
    workspaces: async () => (registered ? [workspace] : []),
    registerWorkspace: async folder => {
      assert.equal(folder, directory);
      registered = true;
      await gate;
      return workspace;
    },
    invoke: async () => {
      invokes++;
      throw Error('UNEXPECTED_SERVICE_DISPATCH');
    },
    decide: async () => {
      throw Error('UNEXPECTED_SERVICE_DECISION');
    },
  });
  const server = createPortalServer({
    store,
    bridge,
    webRoot: fileURLToPath(new URL('../', import.meta.url)),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port,
    origin = `http://127.0.0.1:${port}`;
  const sockets = new Set(),
    transportErrors = [];
  const transportError = error => {
    if (!['ECONNRESET', 'EPIPE'].includes(error.code))
      transportErrors.push('UNEXPECTED_PROXY_ERROR');
  };
  const proxy = createServer((request, response) => {
    request.on('error', transportError);
    response.on('error', transportError);
    let target;
    try {
      target = new URL(request.url);
    } catch {
      response.writeHead(403).end();
      return;
    }
    if (target.origin !== origin) {
      response.writeHead(403).end();
      return;
    }
    const forward = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: target.pathname + target.search,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${port}` },
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
  proxy.on('connect', (_request, socket) => {
    sockets.add(socket);
    socket.on('error', error => {
      transportError(error);
      socket.destroy();
    });
    socket.on('close', () => sockets.delete(socket));
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath,
    headless: true,
    args: ['--disable-background-networking'],
    proxy: { server: `http://127.0.0.1:${proxy.address().port}`, bypass: '<-loopback>' },
  });
  const browserContext = await browser.newContext();
  await browserContext.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await browserContext.newPage(),
    errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.goto(origin);
  await expect(page.locator('.app-shell')).toBeVisible();
  return {
    page,
    store,
    registered: () => registered,
    release: () => release?.(),
    register: async () => {
      await page.locator('.workspace-register-trigger').click();
      await page.locator('#workspace-registration-form [name=folder]').fill(directory);
      await page.locator('#workspace-registration-form [type=submit]').click();
      if (!held) await expect(page.locator('[data-field=workspaceId]')).toHaveValue(workspaceId);
    },
    close: async () => {
      release?.();
      await browser.close();
      for (const socket of sockets) socket.destroy();
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
      expect(errors).toEqual([]);
      expect(transportErrors).toEqual([]);
      expect(invokes).toBe(0);
      expect(store.listRuns()).toEqual([]);
    },
  };
}

test('opens and applies a local guided draft after trusted first workspace registration without saving or running', async context => {
  const f = await fixture(context);
  try {
    await f.register();
    await f.page.locator('[data-action=guided-setup]').click();
    const form = f.page.locator('#guided-setup-form');
    await expect(form).toBeVisible();
    await expect(f.page.locator('#save-state')).toHaveText('아직 저장하지 않은 초안');
    await form.locator('[name=name]').fill('First guided owner draft');
    await form.locator('[name=workspaceId]').selectOption(workspaceId);
    await form
      .locator('[name=figmaUrl]')
      .fill('https://www.figma.com/design/OwnedFixture?node-id=0-1');
    await form.locator('[name=targetPath]').fill('generated/owned-first-draft');
    await form.locator('[name=description]').fill('An owner-provided local draft requirement');
    await form.locator('[type=submit]').click();
    await expect(form).toBeHidden();
    await expect(f.page.locator('[data-field=name]')).toHaveValue('First guided owner draft');
    await expect(f.page.locator('#save-state')).toHaveText('저장되지 않은 변경');
    expect(f.store.listWorkflows()).toEqual([]);
  } finally {
    await f.close();
  }
}, 20000);

test('preserves an unsaved user edit and blocks new setup after workspace registration', async context => {
  const f = await fixture(context);
  try {
    await f.page.locator('[data-field=name]').fill('Meaningful unsaved owner edit');
    await f.register();
    await f.page.locator('[data-action=guided-setup]').click();
    await expect(f.page.locator('#guided-setup-form')).toHaveCount(0);
    await expect(f.page.locator('[data-field=name]')).toHaveValue('Meaningful unsaved owner edit');
    await expect(f.page.locator('#save-state')).toHaveText('저장되지 않은 변경');
    expect(f.store.listWorkflows()).toEqual([]);
  } finally {
    await f.close();
  }
}, 20000);

test('marks saved workflow workspace selection dirty and preserves its stored original', async context => {
  const f = await fixture(context, { saved: true });
  try {
    const original = structuredClone(f.store.listWorkflows());
    await f.register();
    await f.page.locator('[data-action=guided-setup]').click();
    await expect(f.page.locator('#guided-setup-form')).toHaveCount(0);
    await expect(f.page.locator('#save-state')).toHaveText('저장되지 않은 변경');
    expect(f.store.listWorkflows()).toEqual(original);
  } finally {
    await f.close();
  }
}, 20000);

test('checks pristine state when a held registration response arrives after a trusted user edit', async context => {
  const f = await fixture(context, { held: true });
  try {
    await f.register();
    await expect.poll(f.registered).toBe(true);
    await f.page.locator('#workspace-dialog [data-action=close-workspace]').first().click();
    await f.page.locator('[data-field=name]').fill('Edit made while registration was pending');
    f.release();
    await expect(f.page.locator('[data-field=workspaceId]')).toHaveValue(workspaceId);
    await f.page.locator('[data-action=guided-setup]').click();
    await expect(f.page.locator('#guided-setup-form')).toHaveCount(0);
    await expect(f.page.locator('[data-field=name]')).toHaveValue(
      'Edit made while registration was pending',
    );
    await expect(f.page.locator('#save-state')).toHaveText('저장되지 않은 변경');
    expect(f.store.listWorkflows()).toEqual([]);
  } finally {
    await f.close();
  }
}, 20000);
