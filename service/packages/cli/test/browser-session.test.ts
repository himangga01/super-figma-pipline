import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  connect: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  launch: vi.fn<() => void>(),
  newPage: vi.fn<() => void>(),
  goto: vi.fn<() => void>(),
  cdp: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  detach: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: spies.connect,
    launch: spies.launch,
    launchPersistentContext: spies.launch,
  },
}));
vi.mock('../src/chrome-endpoint.js', () => ({
  resolveExistingChromeEndpoint: async () => 'chrome',
}));
vi.mock('../../mcp/src/portal/chrome-transport.js', () => ({
  createRetainedChromeTransport: async () => ({
    endpoint: 'chrome',
    headers: { Authorization: 'fixture-private-transport' },
    state: () => 'connected',
    close: async () => {},
  }),
}));
import { ExistingChromeConnection, openChromeSession } from '../src/browser-session.js';

const fileUrl = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/Example?node-id=0-1';
const fakeBrowser = (urls: string[]) => {
  const close = vi.fn<() => Promise<void>>(async () => undefined);
  const context = {
    pages: () => pages,
    newPage: spies.newPage,
    newCDPSession: async () => ({ send: spies.cdp, detach: spies.detach }),
  } as unknown as BrowserContext;
  const pages = urls.map(
    url => ({ url: () => url, context: () => context, goto: spies.goto }) as unknown as Page,
  );
  spies.connect.mockResolvedValue({
    contexts: () => [context],
    close,
    isConnected: () => true,
  } as unknown as Browser);
  return { close, pages };
};
beforeEach(() => vi.clearAllMocks());

describe('existing Chrome only', () => {
  it('closes an owned browser that resolves during daemon shutdown', async () => {
    const fake = fakeBrowser([fileUrl]);
    const browser = await spies.connect();
    spies.connect.mockClear();
    const pending = deferred();
    spies.connect.mockReturnValueOnce(pending.promise);
    const connection = new ExistingChromeConnection();
    const opening = connection.open({ url: fileUrl }).catch(error => error);
    await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledOnce());
    const closing = connection.close();
    pending.resolve(browser);
    await closing;
    expect(await opening).toMatchObject({ message: 'CHROME_CONNECTION_CLOSED' });
    expect(fake.close).toHaveBeenCalledOnce();
    expect(spies.cdp).not.toHaveBeenCalled();
  });
  it('abandons a shared connection wait promptly and reuses its late approved transport', async () => {
    const fake = fakeBrowser([fileUrl]);
    const browser = await spies.connect();
    spies.connect.mockClear();
    const pending = deferred();
    spies.connect.mockReturnValue(pending.promise);
    const connection = new ExistingChromeConnection();
    const cancelled = new AbortController();
    const reason = new Error('cancelled');
    const first = connection.open({ url: fileUrl }, cancelled.signal).catch(error => error);
    await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledOnce());
    cancelled.abort(reason);
    expect(
      await Promise.race([
        first,
        new Promise(resolve => setTimeout(() => resolve('still waiting'), 100)),
      ]),
    ).toBe(reason);
    expect(spies.cdp).not.toHaveBeenCalled();
    const second = connection.open({ url: fileUrl });
    pending.resolve(browser);
    await (await second).close();
    expect(spies.connect).toHaveBeenCalledOnce();
    expect(spies.cdp).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
    await connection.close();
  });
  it('releases a logical session that arrives after its waiter was cancelled', async () => {
    const fake = fakeBrowser([fileUrl]);
    const pending = deferred();
    spies.cdp.mockReturnValueOnce(pending.promise);
    const connection = new ExistingChromeConnection();
    const cancelled = new AbortController();
    const reason = new Error('cancelled');
    const opening = connection.open({ url: fileUrl }, cancelled.signal).catch(error => error);
    await vi.waitFor(() => expect(spies.cdp).toHaveBeenCalledOnce());
    cancelled.abort(reason);
    expect(
      await Promise.race([
        opening,
        new Promise(resolve => setTimeout(() => resolve('still waiting'), 100)),
      ]),
    ).toBe(reason);
    pending.resolve(undefined);
    await vi.waitFor(() => expect(spies.detach).toHaveBeenCalledOnce());
    expect(fake.close).not.toHaveBeenCalled();
    await connection.close();
  });
  it('releases logical sessions after the transport has already closed', async () => {
    const fake = fakeBrowser([fileUrl]);
    const session = await openChromeSession({ url: fileUrl });
    const browser = (await spies.connect.mock.results[0]!.value) as Browser;
    browser.isConnected = () => false;
    spies.detach.mockRejectedValueOnce(new Error('Target closed'));
    await expect(session.close()).resolves.toBeUndefined();
    await session.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });
  it('keeps the selected Figma renderer active and releases only its target session', async () => {
    fakeBrowser([fileUrl]);
    const session = await openChromeSession({ url: fileUrl });
    expect(spies.cdp).toHaveBeenCalledWith('Emulation.setFocusEmulationEnabled', { enabled: true });
    await session.close();
    expect(spies.detach).toHaveBeenCalledOnce();
  });
  it('reuses one permitted connection across capture sessions and closes it only at daemon shutdown', async () => {
    const fake = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    const first = await connection.open({ url: fileUrl });
    await first.close();
    const second = await connection.open({ url: fileUrl });
    expect(second.page).toBe(first.page);
    await second.close();
    expect(spies.connect).toHaveBeenCalledOnce();
    expect(spies.connect).toHaveBeenCalledWith('chrome', {
      timeout: 300_000,
      noDefaults: true,
      headers: { Authorization: 'fixture-private-transport' },
    });
    expect(fake.close).not.toHaveBeenCalled();
    await connection.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });
  it('keeps the permitted transport when the Figma tab is temporarily absent', async () => {
    const fake = fakeBrowser(['https://example.com/']);
    const connection = new ExistingChromeConnection();
    await expect(connection.open({ url: fileUrl })).rejects.toThrow('FIGMA_TAB_NOT_FOUND');
    const page = { url: () => fileUrl, context: () => fake.pages[0]!.context() } as Page;
    fake.pages.push(page);
    expect((await connection.open({ url: fileUrl })).page).toBe(page);
    expect(spies.connect).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
    expect(spies.launch).not.toHaveBeenCalled();
    expect(spies.newPage).not.toHaveBeenCalled();
    expect(spies.goto).not.toHaveBeenCalled();
    await connection.close();
  });
  it('shares an in-flight connection between simultaneous consumers', async () => {
    fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    await Promise.all([connection.open({ url: fileUrl }), connection.open({ url: fileUrl })]);
    expect(spies.connect).toHaveBeenCalledOnce();
    await connection.close();
  });
  it('finds the exact existing file without launching, navigating, or creating tabs', async () => {
    const fake = fakeBrowser(['https://example.com/', fileUrl]);
    const session = await openChromeSession({ url: fileUrl });
    expect(spies.connect).toHaveBeenCalledWith('chrome', { timeout: 60_000, noDefaults: true });
    expect(session.page).toBe(fake.pages[1]);
    expect(spies.launch).not.toHaveBeenCalled();
    expect(spies.newPage).not.toHaveBeenCalled();
    expect(spies.goto).not.toHaveBeenCalled();
    await session.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });
  it('discovers the only Figma design tab when no URL is provided', async () => {
    fakeBrowser(['chrome://inspect/#remote-debugging', fileUrl]);
    const session = await openChromeSession({});
    expect(session.target.fileKey).toBe('4IBhv1d8hEclifZQrOYxHS');
  });
  it.each([{ urls: [] }, { urls: [fileUrl, fileUrl] }])(
    'fails closed for missing or ambiguous matching tabs: %j',
    async ({ urls }) => {
      const fake = fakeBrowser(urls);
      await expect(openChromeSession({ url: fileUrl })).rejects.toThrow(
        /FIGMA_TAB_NOT_FOUND|CHROME_TARGET_AMBIGUOUS/,
      );
      expect(fake.close).toHaveBeenCalledOnce();
      expect(spies.launch).not.toHaveBeenCalled();
      expect(spies.newPage).not.toHaveBeenCalled();
    },
  );
  it('rejects remote CDP endpoints before attaching', async () => {
    await expect(
      openChromeSession({ url: fileUrl, cdp: 'https://remote.example:9222' }),
    ).rejects.toThrow(/CHROME_CDP_INVALID/);
    expect(spies.connect).not.toHaveBeenCalled();
  });
  it('reports the existing browser connection prerequisite without launching a fallback', async () => {
    spies.connect.mockRejectedValue(new Error('disabled'));
    await expect(openChromeSession({})).rejects.toThrow(/CHROME_CONNECTION_REQUIRED/);
    expect(spies.launch).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
