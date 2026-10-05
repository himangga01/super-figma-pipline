import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  launch: vi.fn<() => void>(),
  createTarget: vi.fn<(url: string) => void>(),
  transport: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  releaseCreated: vi.fn<() => void>(),
  closeTransport: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('playwright', () => ({
  chromium: { connectOverCDP: mocks.connect, launch: mocks.launch },
}));
vi.mock('../src/chrome-endpoint.js', () => ({
  resolveExistingChromeEndpoint: async () => 'chrome',
}));
vi.mock('../../mcp/src/portal/chrome-transport.js', () => ({
  createRetainedChromeTransport: (...args: unknown[]) => mocks.transport(...args),
}));
import { ExistingChromeConnection, openChromeSession } from '../src/browser-session.js';
import { runCommand } from '../src/commands.js';

const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/Example?node-id=0-1';
const canonicalUrl = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
const setup = (urls: string[]) => {
  const pages: Page[] = [];
  let selected: Page[] = [];
  let contextCount = 1;
  let navigationFailure = false;
  let navigationLanding: string | null = null;
  let navigationHold: Promise<void> | null = null;
  let scope: { matchesTarget(url: string): boolean; missingTargetUrl?(): string | null };
  mocks.transport.mockImplementation(async (_endpoint, input) => {
    scope = input as typeof scope;
    return {
      endpoint: 'chrome',
      headers: { Authorization: 'fixture-private-transport' },
      state: () => 'connected',
      diagnostics: () => ({ sent: 1, received: 0, pendingMethods: [], pendingResets: 0 }),
      releaseCreatedTargets: mocks.releaseCreated,
      close: mocks.closeTransport,
    };
  });
  const context = {
    pages: () => selected,
    newCDPSession: async () => ({
      send: vi.fn<(...args: unknown[]) => Promise<void>>(),
      detach: vi.fn<() => Promise<void>>(),
    }),
    newPage: vi.fn<() => Promise<unknown>>(async () => makePage('about:blank')),
  } as unknown as BrowserContext;
  const makePage = (initial: string) => {
    let current = initial;
    const page = {
      url: () => current,
      title: async () => 'Figma source',
      context: () => context,
      goto: vi.fn<(destination: string) => Promise<void>>(async destination => {
        if (navigationHold) await navigationHold;
        if (navigationFailure) throw new Error('navigation failed');
        current = navigationLanding ?? destination;
      }),
      waitForURL: async (matches: (url: URL) => boolean) => {
        if (!matches(new URL(current)))
          throw Object.assign(new Error('page.waitForURL: Timeout 60000ms exceeded.'), {
            name: 'TimeoutError',
          });
      },
      close: vi.fn<() => Promise<void>>(async () => {
        pages.splice(pages.indexOf(page as unknown as Page), 1);
      }),
    };
    pages.push(page as unknown as Page);
    return page;
  };
  urls.forEach(makePage);
  const browser = {
    contexts: () => [context],
    close: vi.fn<() => Promise<void>>(async () => {}),
    isConnected: () => true,
  };
  mocks.connect.mockImplementation(async () => {
    selected = pages.filter(page => scope.matchesTarget(page.url()));
    if (selected.length > 1) throw new Error('CHROME_TARGET_AMBIGUOUS');
    if (!selected.length) {
      if (!scope.missingTargetUrl?.()) throw new Error('FIGMA_TAB_NOT_FOUND');
      if (contextCount !== 1) throw new Error('CHROME_CONTEXT_AMBIGUOUS');
      mocks.createTarget('about:blank');
      selected = [makePage('about:blank') as unknown as Page];
    }
    return browser as unknown as Browser;
  });
  return {
    browser,
    context,
    pages,
    setContextCount: (count: number) => {
      contextCount = count;
    },
    failNavigation: () => {
      navigationFailure = true;
    },
    landNavigationAt: (destination: string) => {
      navigationLanding = destination;
    },
    holdNavigation: () => {
      navigationHold = new Promise<void>(() => {});
    },
  };
};

beforeEach(() => vi.clearAllMocks());

it('opens the requested source through the service CLI in existing Chrome without changing unrelated tabs', async () => {
  const fixture = setup(['https://example.com/']);
  const unrelated = fixture.pages[0]!;
  const emit = vi.fn<(value: unknown) => void>();
  await runCommand(['chrome-open', '--url', url], emit);
  expect(mocks.createTarget).toHaveBeenCalledWith('about:blank');
  expect(fixture.context.newPage).not.toHaveBeenCalled();
  expect(fixture.pages[1]!.goto).toHaveBeenCalledWith(canonicalUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  expect(unrelated.goto).not.toHaveBeenCalled();
  expect(fixture.pages[1]!.close).not.toHaveBeenCalled();
  expect(fixture.browser.close).toHaveBeenCalledOnce();
  expect(mocks.releaseCreated).toHaveBeenCalledOnce();
  expect(mocks.releaseCreated.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.closeTransport.mock.invocationCallOrder[0]!,
  );
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'attached-existing-chrome', url: canonicalUrl }),
  );
});

it('reuses the unique existing source without navigating or creating a duplicate', async () => {
  const fixture = setup([url]);
  const session = await openChromeSession({ url, openIfMissing: true });
  expect(session.page).toBe(fixture.pages[0]);
  expect(fixture.context.newPage).not.toHaveBeenCalled();
  expect(mocks.createTarget).not.toHaveBeenCalled();
  expect(session.page.goto).not.toHaveBeenCalled();
  await session.close();
});

it('keeps capture attach-only unless source opening is explicitly requested', async () => {
  const fixture = setup([]);
  await expect(openChromeSession({ url })).rejects.toThrow('FIGMA_TAB_NOT_FOUND');
  expect(fixture.context.newPage).not.toHaveBeenCalled();
});

it('rejects ambiguous existing source tabs without opening another', async () => {
  const fixture = setup([url, url]);
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    'CHROME_TARGET_AMBIGUOUS',
  );
  expect(fixture.context.newPage).not.toHaveBeenCalled();
});

it('requires an explicit valid Figma URL before connecting', async () => {
  await expect(runCommand(['chrome-open'], vi.fn<(value: unknown) => void>())).rejects.toThrow(
    'FIGMA_URL_REQUIRED',
  );
  await expect(
    openChromeSession({ url: 'https://example.com/', openIfMissing: true }),
  ).rejects.toThrow('FIGMA_URL_INVALID');
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('rejects invalid capture batch limits before requesting a Chrome connection', async () => {
  setup([]);
  await expect(
    runCommand(
      ['chrome-inspect', '--url', url, '--max-nodes', '6000'],
      vi.fn<(value: unknown) => void>(),
    ),
  ).rejects.toThrow('2000');
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.transport).not.toHaveBeenCalled();
});

it('does not guess a browser context for a new source tab', async () => {
  const fixture = setup([]);
  fixture.setContextCount(2);
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    'CHROME_CONTEXT_AMBIGUOUS',
  );
  expect(fixture.context.newPage).not.toHaveBeenCalled();
  expect(mocks.createTarget).not.toHaveBeenCalled();
});

it('does not replay failed source navigation or close unrelated tabs', async () => {
  const fixture = setup(['https://example.com/']);
  fixture.failNavigation();
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    'navigation failed',
  );
  expect(fixture.pages[1]!.goto).toHaveBeenCalledOnce();
  expect(mocks.createTarget).toHaveBeenCalledOnce();
  expect(fixture.pages[0]!.close).not.toHaveBeenCalled();
  expect(fixture.browser.close).toHaveBeenCalledOnce();
  // The unaccepted created tab is left for the relay's bounded close of its own targets.
  expect(mocks.releaseCreated).not.toHaveBeenCalled();
  expect(mocks.closeTransport).toHaveBeenCalledOnce();
});

it('reports a sign-in redirect as FIGMA_LOGIN_REQUIRED without accepting the created tab', async () => {
  const fixture = setup([]);
  fixture.landNavigationAt('https://www.figma.com/login?cont=%2Fdesign%2F4IBhv1d8hEclifZQrOYxHS');
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    /^FIGMA_LOGIN_REQUIRED/u,
  );
  expect(mocks.createTarget).toHaveBeenCalledOnce();
  expect(mocks.releaseCreated).not.toHaveBeenCalled();
  expect(mocks.closeTransport).toHaveBeenCalledOnce();
});

it('maps a source that never reaches the requested file to FIGMA_TAB_NOT_FOUND', async () => {
  const fixture = setup([]);
  fixture.landNavigationAt('https://www.figma.com/files/recent');
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    /^FIGMA_TAB_NOT_FOUND/u,
  );
  expect(mocks.releaseCreated).not.toHaveBeenCalled();
});

it('stops waiting for a source navigation when its caller is cancelled', async () => {
  const fixture = setup([]);
  fixture.holdNavigation();
  const connection = new ExistingChromeConnection();
  const controller = new AbortController();
  const opening = connection.open({ url, openIfMissing: true }, controller.signal);
  await vi.waitFor(() => expect(fixture.pages[0]?.goto).toHaveBeenCalledOnce());
  controller.abort(new Error('Fixture cancellation'));
  await expect(opening).rejects.toThrow('Fixture cancellation');
  expect(mocks.releaseCreated).not.toHaveBeenCalled();
  await connection.close();
  expect(mocks.closeTransport).toHaveBeenCalledOnce();
});

it('rejects a concurrent open with a different source-opening intent', async () => {
  setup([]);
  const connection = new ExistingChromeConnection();
  const opening = connection.open({ url, openIfMissing: true });
  await expect(connection.open({ url })).rejects.toThrow('CHROME_SOURCE_BUSY');
  const session = await opening;
  expect(mocks.createTarget).toHaveBeenCalledOnce();
  expect(mocks.releaseCreated).toHaveBeenCalledOnce();
  await session.close();
  await connection.close();
});

it('distinguishes accepted Chrome connections that time out during Playwright initialization', async () => {
  mocks.connect.mockRejectedValueOnce(
    new Error('Timeout 60000ms exceeded. Call log: <ws connected>'),
  );
  await expect(openChromeSession({ url })).rejects.toThrow('CHROME_INITIALIZATION_TIMEOUT');
});
