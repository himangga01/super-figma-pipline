import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  connect: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  launch: vi.fn<() => void>(),
  newPage: vi.fn<() => void>(),
  goto: vi.fn<() => void>(),
  cdp: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  detach: vi.fn<() => Promise<void>>(async () => {}),
  transports: [] as Array<{
    state: 'not-requested' | 'awaiting-browser' | 'connected' | 'unavailable';
    closed: boolean;
  }>,
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
  createRetainedChromeTransport: async () => {
    const generation = spies.transports.length + 1;
    const transport = { state: 'connected' as const, closed: false };
    spies.transports.push(transport);
    return {
      endpoint: generation === 1 ? 'chrome' : `chrome-generation-${generation}`,
      headers: {
        Authorization:
          generation === 1
            ? 'fixture-private-transport'
            : `fixture-private-transport-${generation}`,
      },
      state: () => transport.state,
      diagnostics: () => ({
        sent: 1,
        received: 0,
        pendingMethods: ['Browser.getVersion'],
        pendingResets: 0,
      }),
      close: async () => {
        transport.closed = true;
      },
    };
  },
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
beforeEach(() => {
  vi.clearAllMocks();
  spies.transports.splice(0);
});

describe('existing Chrome only', () => {
  it('does not retarget an active source acquisition', async () => {
    const original = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    const first = await connection.open({ url: fileUrl });
    const changed = 'https://www.figma.com/design/nextFixtureKey?node-id=0-1';
    await expect(connection.open({ url: changed })).rejects.toThrow('CHROME_SOURCE_BUSY');
    expect(original.close).not.toHaveBeenCalled();
    await first.close();
    const next = fakeBrowser([changed]);
    expect((await connection.open({ url: changed })).page).toBe(next.pages[0]);
    expect(original.close).toHaveBeenCalledOnce();
    expect(spies.transports).toHaveLength(1);
    await connection.close();
  });

  it('does not report an approved socket as a usable Playwright browser', async () => {
    const fake = fakeBrowser([fileUrl]);
    const browser = await spies.connect();
    spies.connect.mockClear();
    const pending = deferred();
    spies.connect.mockReturnValueOnce(pending.promise);
    const connection = new ExistingChromeConnection();
    const opening = connection.open({ url: fileUrl });
    await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledOnce());
    expect(connection.state()).toBe('initializing');
    pending.resolve(browser);
    await opening;
    expect(connection.state()).toBe('connected');
    await connection.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('distinguishes initialization failure from missing owner permission', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const connection = new ExistingChromeConnection();
    spies.connect.mockRejectedValueOnce(new Error('initialization timeout'));
    try {
      await expect(connection.open({ url: fileUrl })).rejects.toThrow(
        'CHROME_INITIALIZATION_TIMEOUT',
      );
      expect(connection.state()).toBe('initializing');
      expect(log).toHaveBeenCalledWith('[chrome] initialization incomplete', {
        sent: 1,
        received: 0,
        pendingMethods: ['Browser.getVersion'],
        pendingResets: 0,
      });
      expect(spies.transports[0]!.closed).toBe(false);
    } finally {
      await connection.close();
      log.mockRestore();
    }
  });
  it('replaces a terminal remote with a fresh private generation before the next capture', async () => {
    const first = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    await (await connection.open({ url: fileUrl })).close();
    spies.transports[0]!.state = 'unavailable';
    // Failure can precede Playwright's asynchronous disconnected event.
    const second = fakeBrowser([fileUrl]);
    const [a, b] = await Promise.all([
      connection.open({ url: fileUrl }),
      connection.open({ url: fileUrl }),
    ]);
    expect(a.page).toBe(second.pages[0]);
    expect(b.page).toBe(second.pages[0]);
    expect(spies.transports[0]!.closed).toBe(true);
    expect(first.close).toHaveBeenCalledOnce();
    expect(spies.connect.mock.calls).toEqual([
      [
        'chrome',
        {
          timeout: 300_000,
          noDefaults: true,
          headers: { Authorization: 'fixture-private-transport' },
        },
      ],
      [
        'chrome-generation-2',
        {
          timeout: 300_000,
          noDefaults: true,
          headers: { Authorization: 'fixture-private-transport-2' },
        },
      ],
    ]);
    await connection.close();
  });

  it('replaces a failed initial attachment only on a new explicit capture request', async () => {
    const connection = new ExistingChromeConnection();
    spies.connect.mockImplementationOnce(async () => {
      spies.transports[0]!.state = 'unavailable';
      throw new Error('remote disconnected');
    });
    await expect(connection.open({ url: fileUrl })).rejects.toThrow('CHROME_CONNECTION_REQUIRED');
    expect(spies.transports).toHaveLength(1);
    const fresh = fakeBrowser([fileUrl]);
    expect((await connection.open({ url: fileUrl })).page).toBe(fresh.pages[0]);
    expect(spies.connect.mock.calls[1]?.[0]).toBe('chrome-generation-2');
    expect(spies.transports[0]!.closed).toBe(true);
    await connection.close();
  });

  it('retains a pending owner permission generation after a logical client attachment fails', async () => {
    const connection = new ExistingChromeConnection();
    spies.connect.mockImplementationOnce(async () => {
      spies.transports[0]!.state = 'awaiting-browser';
      throw new Error('local attachment timeout');
    });
    await expect(connection.open({ url: fileUrl })).rejects.toThrow('CHROME_CONNECTION_REQUIRED');
    fakeBrowser([fileUrl]);
    await connection.open({ url: fileUrl });
    expect(spies.transports).toHaveLength(1);
    expect(spies.transports[0]!.closed).toBe(false);
    expect(spies.connect.mock.calls[1]?.[0]).toBe('chrome');
    await connection.close();
  });
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
    await session.close();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(spies.transports.at(-1)?.closed).toBe(true);
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
    expect(spies.connect).toHaveBeenCalledWith('chrome', {
      timeout: 60_000,
      noDefaults: true,
      headers: { Authorization: 'fixture-private-transport' },
    });
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
    spies.connect.mockImplementationOnce(async () => {
      spies.transports.at(-1)!.state = 'unavailable';
      throw new Error('disabled');
    });
    await expect(openChromeSession({})).rejects.toThrow(/CHROME_CONNECTION_REQUIRED/);
    expect(spies.transports.at(-1)?.closed).toBe(true);
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
