import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type RequestListener, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import {
  ChromeSessionOwner,
  ExistingChromeConnection,
  openChromeSession,
} from '../src/browser-session.js';
import { resolveExistingChromeEndpoint } from '../src/chrome-endpoint.js';
import { ControlClient } from '../src/control-client.js';
import { executeServiceFeature } from '../src/service-functions.js';

const discoveryUrl = 'https://www.figma.com/design/httpDiscoveryFixtureKey?node-id=0-1';
const discoveryReply = JSON.stringify({
  webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/browser/owned-mock',
});
async function httpDiscovery(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP_FIXTURE_ADDRESS_INVALID');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>(resolveClose => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
function mockAttachedBrowser() {
  const context = {
    pages: () => [page],
    newCDPSession: async () => ({ send: async () => {}, detach: async () => {} }),
  } as unknown as BrowserContext;
  const page = { url: () => discoveryUrl, context: () => context } as unknown as Page;
  const browser = {
    contexts: () => [context],
    isConnected: () => true,
    close: vi.fn<() => Promise<void>>(async () => {}),
  } as unknown as Browser;
  return { browser, page };
}

it('uses the original connection deadline across HTTP discovery and Playwright attachment', async () => {
  let observedTime = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => observedTime);
  const http = await httpDiscovery((_request, response) => {
    observedTime += 75;
    response.end(discoveryReply);
  });
  const fake = mockAttachedBrowser();
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(fake.browser);
  const connection = new ExistingChromeConnection();
  try {
    const session = await connection.open({
      url: discoveryUrl,
      cdp: http.endpoint,
      connectionTimeoutMs: 200,
    });
    expect(connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 125 }),
    );
    await session.close();
  } finally {
    await connection.close();
    connect.mockRestore();
    clock.mockRestore();
    await http.close();
  }
});

it('cancels one logical HTTP waiter without cancelling the other shared connection consumer', async () => {
  let response: ServerResponse | undefined;
  const http = await httpDiscovery((_request, reply) => {
    response = reply;
  });
  const fake = mockAttachedBrowser();
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(fake.browser);
  const connection = new ExistingChromeConnection(),
    controller = new AbortController();
  try {
    const first = connection
      .open({ url: discoveryUrl, cdp: http.endpoint, connectionTimeoutMs: 2000 }, controller.signal)
      .catch(error => error);
    await vi.waitFor(() => expect(response).toBeDefined());
    const second = connection.open({
      url: discoveryUrl,
      cdp: http.endpoint,
      connectionTimeoutMs: 2000,
    });
    const reason = Error('first-logical-waiter-cancelled');
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect(connect).not.toHaveBeenCalled();
    response!.end(discoveryReply);
    const selected = await second;
    expect(selected.page).toBe(fake.page);
    expect(connect).toHaveBeenCalledOnce();
    await selected.close();
  } finally {
    await connection.close();
    connect.mockRestore();
    await http.close();
  }
});

it.each(['connection-close', 'standalone-cancel'] as const)(
  'stops pending HTTP discovery promptly on %s',
  async action => {
    let received = false;
    const http = await httpDiscovery(() => {
      received = true;
    });
    const connect = vi.spyOn(chromium, 'connectOverCDP');
    const connection = new ExistingChromeConnection(),
      controller = new AbortController();
    try {
      const pending = (
        action === 'connection-close'
          ? connection.open({ url: discoveryUrl, cdp: http.endpoint, connectionTimeoutMs: 5000 })
          : openChromeSession(
              { url: discoveryUrl, cdp: http.endpoint, connectionTimeoutMs: 5000 },
              controller.signal,
            )
      ).catch(error => error);
      await vi.waitFor(() => expect(received).toBe(true));
      const started = performance.now(),
        reason = Error('standalone-discovery-cancelled');
      if (action === 'connection-close') await connection.close();
      else controller.abort(reason);
      const error = await pending;
      expect(action === 'connection-close' ? error.message : error).toBe(
        action === 'connection-close' ? 'CHROME_CONNECTION_CLOSED' : reason,
      );
      expect(performance.now() - started).toBeLessThan(1000);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await connection.close();
      connect.mockRestore();
      await http.close();
    }
  },
);

it('rejects a malformed explicit Chrome endpoint with a typed error before any connection', async () => {
  await expect(
    openChromeSession({
      url: 'https://www.figma.com/design/endpointFixtureKey?node-id=0-1',
      cdp: 'not-a-url',
    }),
  ).rejects.toMatchObject({ code: 'CHROME_CDP_INVALID' });
});

it('discovers an authorized replacement source page on a retained healthy Chrome connection', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const profileRoot = await mkdtemp(join(tmpdir(), 'sfp-owned-chrome-replacement-'));
  const absolute = resolve(profileRoot);
  if (
    !absolute.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !absolute.includes('sfp-owned-chrome-replacement-')
  )
    throw Error('CHROME_FIXTURE_CLEANUP_PATH_INVALID');
  const previousProfile = process.env.SFP_CHROME_USER_DATA_DIR;
  process.env.SFP_CHROME_USER_DATA_DIR = profileRoot;
  const connection = new ExistingChromeConnection();
  let context: BrowserContext | undefined;
  const targetUrl = 'https://www.figma.com/design/replacementFixtureKey?node-id=0-1';
  try {
    context = await chromium.launchPersistentContext(profileRoot, {
      channel: 'chrome',
      executablePath,
      headless: true,
      args: ['--remote-debugging-port=0'],
    });
    await context.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Owned replacement fixture</title><main>Replacement source</main>',
      }),
    );
    const original = context.pages()[0] ?? (await context.newPage());
    await original.goto(targetUrl);
    const unrelated = await context.newPage();
    await unrelated.setContent('<title>Unrelated owned page</title>');
    const first = await connection.open({ url: targetUrl });
    expect(first.context.pages()).toHaveLength(1);
    await first.close();
    await original.close();
    await vi.waitFor(() => expect(first.page.isClosed()).toBe(true));
    expect(connection.state()).toBe('connected');
    // A separately approved service client opens the replacement in the same owned browser.
    const alternate = await openChromeSession({ url: targetUrl, openIfMissing: true });
    expect(alternate.page.url()).toBe(targetUrl);
    await alternate.close();
    const replacement = await connection.open({ url: targetUrl });
    expect(await replacement.page.title()).toBe('Owned replacement fixture');
    expect(replacement.page).not.toBe(first.page);
    expect(replacement.context.pages()).toHaveLength(1);
    expect(context.pages()).toHaveLength(2);
    expect(await unrelated.title()).toBe('Unrelated owned page');
    expect(unrelated.isClosed()).toBe(false);
    await replacement.close();
    const ownerReplacement = context.pages().find(page => page.url() === targetUrl)!;
    await ownerReplacement.close();
    await vi.waitFor(() => expect(replacement.page.isClosed()).toBe(true));
    const wrongFile = await context.newPage();
    await wrongFile.goto('https://www.figma.com/design/unrelatedFixtureKey?node-id=0-1');
    await expect(connection.open({ url: targetUrl, connectionTimeoutMs: 2000 })).rejects.toThrow(
      'FIGMA_TAB_NOT_FOUND',
    );
    expect(context.pages()).toHaveLength(2);
    const duplicateA = await context.newPage();
    const duplicateB = await context.newPage();
    await duplicateA.goto(targetUrl);
    await duplicateB.goto(targetUrl);
    await expect(connection.open({ url: targetUrl, connectionTimeoutMs: 2000 })).rejects.toThrow(
      'CHROME_TARGET_AMBIGUOUS',
    );
    expect(context.pages()).toHaveLength(4);
    expect(await unrelated.title()).toBe('Unrelated owned page');
  } finally {
    await connection.close();
    await context?.close();
    if (previousProfile === undefined) delete process.env.SFP_CHROME_USER_DATA_DIR;
    else process.env.SFP_CHROME_USER_DATA_DIR = previousProfile;
    await rm(absolute, { recursive: true, force: true });
  }
}, 30000);

it('reattaches to restarted installed Chrome through fresh discovery without restarting the owner', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const profileRoot = await mkdtemp(join(tmpdir(), 'sfp-owned-chrome-reconnect-'));
  const absolute = resolve(profileRoot);
  if (
    !absolute.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !absolute.includes('sfp-owned-chrome-reconnect-')
  )
    throw new Error('CHROME_FIXTURE_CLEANUP_PATH_INVALID');
  const previousProfile = process.env.SFP_CHROME_USER_DATA_DIR;
  process.env.SFP_CHROME_USER_DATA_DIR = profileRoot;
  const connection = new ExistingChromeConnection();
  let context: BrowserContext | undefined;
  const targetUrl = 'https://www.figma.com/design/reconnectFixtureKey/Owned?node-id=0-1';
  const featureOwner = new ChromeSessionOwner();
  const startChrome = async () => {
    const owned = await chromium.launchPersistentContext(profileRoot, {
      channel: 'chrome',
      executablePath,
      headless: true,
      args: ['--remote-debugging-port=0', '--site-per-process'],
    });
    context = owned;
    await owned.route('https://scripter.rsms.me/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main>Reader frame ready</main>',
      }),
    );
    await owned.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Owned reconnect fixture</title><main>Capture target</main><iframe src="https://scripter.rsms.me/owned-fixture"></iframe>',
      }),
    );
    const page = owned.pages()[0] ?? (await owned.newPage());
    await page.goto(targetUrl);
    const inspector = await owned.newCDPSession(page);
    const targets = await inspector.send('Target.getTargets');
    expect(
      targets.targetInfos.some(
        target => target.type === 'iframe' && target.url.startsWith('https://scripter.rsms.me/'),
      ),
    ).toBe(true);
    await inspector.detach();
    return page;
  };
  try {
    await startChrome();
    const unrelated = await context!.newPage();
    await unrelated.goto('about:blank');
    const standalone = await openChromeSession({ url: targetUrl });
    expect(standalone.context.pages()).toHaveLength(1);
    await standalone.page.frameLocator('iframe').getByText('Reader frame ready').waitFor();
    await standalone.close();
    expect(context!.pages()).toHaveLength(2);
    // The portal CLI feature runs in its host process, so its profile override must survive dispatch.
    const featureContext = {
      workspaceId: null,
      targetSelector: { kind: 'none' } as const,
      signal: new AbortController().signal,
      emit: vi.fn<(value: unknown) => void>(),
      chromeSessionOwner: featureOwner,
    };
    const client = new ControlClient({ stateRoot: join(profileRoot, 'unused-service-state') });
    expect(
      await executeServiceFeature(
        client,
        'chrome.tabs',
        { url: targetUrl, wait: 10 },
        featureContext,
      ),
    ).toMatchObject({ status: 'attached-existing-chrome', title: 'Owned reconnect fixture' });
    expect(
      await executeServiceFeature(
        client,
        'chrome.tabs',
        { url: targetUrl, wait: 10 },
        featureContext,
      ),
    ).toMatchObject({ status: 'attached-existing-chrome', title: 'Owned reconnect fixture' });
    const endpoint = new URL(await resolveExistingChromeEndpoint());
    const httpEndpoint = `http://${endpoint.host}`;
    expect(
      await executeServiceFeature(
        client,
        'chrome.tabs',
        { url: targetUrl, cdp: httpEndpoint, wait: 10 },
        featureContext,
      ),
    ).toMatchObject({ status: 'attached-existing-chrome', title: 'Owned reconnect fixture' });
    expect(context!.pages()).toHaveLength(2);
    const first = await connection.open({ url: targetUrl });
    expect(await first.page.title()).toBe('Owned reconnect fixture');
    await first.page.frameLocator('iframe').getByText('Reader frame ready').waitFor();
    expect(first.context.pages()).toHaveLength(1);
    expect(context!.pages()).toHaveLength(2);
    await first.close();
    await context!.close();
    context = undefined;
    await vi.waitFor(() => expect(connection.state()).toBe('unavailable'));
    await startChrome();
    const second = await connection.open({ url: targetUrl });
    expect(await second.page.title()).toBe('Owned reconnect fixture');
    expect(second.page).not.toBe(first.page);
    expect(connection.state()).toBe('connected');
    await second.close();
    const addedUrl = 'https://www.figma.com/design/explicitOpenFixtureKey/Owned?node-id=0-1';
    const opened = await openChromeSession({ url: addedUrl, openIfMissing: true });
    expect(opened.target.fileKey).toBe('explicitOpenFixtureKey');
    expect(opened.context.pages()).toHaveLength(1);
    expect(await opened.page.title()).toBe('Owned reconnect fixture');
    expect(context!.pages()).toHaveLength(2);
    expect(second.page.url()).toBe(targetUrl);
    await opened.close();
    // Detaching this service client must leave both source tabs open.
    expect(context!.pages()).toHaveLength(2);
    const changedSource = await connection.open({ url: addedUrl });
    expect(changedSource.page.url()).toBe(
      'https://www.figma.com/design/explicitOpenFixtureKey?node-id=0-1',
    );
    expect(changedSource.context.pages()).toHaveLength(1);
    await changedSource.close();
    const originalSource = await connection.open({ url: targetUrl });
    expect(originalSource.page.url()).toBe(targetUrl);
    expect(originalSource.context.pages()).toHaveLength(1);
    await originalSource.close();
    expect(context!.pages()).toHaveLength(2);
  } finally {
    await featureOwner.close();
    await connection.close();
    await context?.close();
    if (previousProfile === undefined) delete process.env.SFP_CHROME_USER_DATA_DIR;
    else process.env.SFP_CHROME_USER_DATA_DIR = previousProfile;
    await rm(absolute, { recursive: true, force: true });
  }
}, 30_000);
