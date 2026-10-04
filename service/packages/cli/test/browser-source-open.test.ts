import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  launch: vi.fn<() => void>(),
}));
vi.mock('playwright', () => ({
  chromium: { connectOverCDP: mocks.connect, launch: mocks.launch },
}));
vi.mock('../src/chrome-endpoint.js', () => ({
  resolveExistingChromeEndpoint: async () => 'chrome',
}));
vi.mock('../../mcp/src/portal/chrome-transport.js', () => ({
  createRetainedChromeTransport: async () => ({
    endpoint: 'chrome',
    headers: { Authorization: 'fixture-private-transport' },
    state: () => 'connected',
    diagnostics: () => ({ sent: 1, received: 0, pendingMethods: [], pendingResets: 0 }),
    close: async () => {},
  }),
}));
import { openChromeSession } from '../src/browser-session.js';
import { runCommand } from '../src/commands.js';

const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/Example?node-id=0-1';
const canonicalUrl = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
const setup = (urls: string[]) => {
  const pages: Page[] = [];
  const context = {
    pages: () => pages,
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
        current = destination;
      }),
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
  mocks.connect.mockResolvedValue(browser as unknown as Browser);
  return { browser, context, pages };
};

beforeEach(() => vi.clearAllMocks());

it('opens the requested source through the service CLI in existing Chrome without changing unrelated tabs', async () => {
  const fixture = setup(['https://example.com/']);
  const unrelated = fixture.pages[0]!;
  const emit = vi.fn<(value: unknown) => void>();
  await runCommand(['chrome-open', '--url', url], emit);
  expect(fixture.context.newPage).toHaveBeenCalledOnce();
  expect(fixture.pages[1]!.goto).toHaveBeenCalledWith(canonicalUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  expect(unrelated.goto).not.toHaveBeenCalled();
  expect(fixture.pages[1]!.close).not.toHaveBeenCalled();
  expect(fixture.browser.close).toHaveBeenCalledOnce();
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

it('does not guess a browser context for a new source tab', async () => {
  const fixture = setup([]);
  fixture.browser.contexts = () => [fixture.context, fixture.context];
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    'CHROME_CONTEXT_AMBIGUOUS',
  );
  expect(fixture.context.newPage).not.toHaveBeenCalled();
});

it('closes only its newly created tab when navigation fails', async () => {
  const fixture = setup(['https://example.com/']);
  const created = {
    goto: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('navigation failed')),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  vi.mocked(fixture.context.newPage).mockResolvedValueOnce(created as unknown as Page);
  await expect(openChromeSession({ url, openIfMissing: true })).rejects.toThrow(
    'navigation failed',
  );
  expect(created.close).toHaveBeenCalledOnce();
  expect(fixture.pages[0]!.close).not.toHaveBeenCalled();
  expect(fixture.browser.close).toHaveBeenCalledOnce();
});

it('distinguishes accepted Chrome connections that time out during Playwright initialization', async () => {
  mocks.connect.mockRejectedValueOnce(
    new Error('Timeout 60000ms exceeded. Call log: <ws connected>'),
  );
  await expect(openChromeSession({ url })).rejects.toThrow('CHROME_INITIALIZATION_TIMEOUT');
});
