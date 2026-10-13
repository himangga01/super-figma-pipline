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
    scope?: { missingTargetUrl?(): string | null; selectedNodeUrl?(): string | null };
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
  createRetainedChromeTransport: async (
    _endpoint: string,
    scope?: { missingTargetUrl?(): string | null; selectedNodeUrl?(): string | null },
  ) => {
    const generation = spies.transports.length + 1;
    const transport = { state: 'connected' as const, closed: false, ...(scope ? { scope } : {}) };
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
import {
  ChromeSessionOwner,
  ExistingChromeConnection,
  openChromeSession,
} from '../src/browser-session.js';
import { parseFigmaTarget } from '../src/figma-url.js';

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
  const browser = {
    contexts: () => [context],
    close,
    isConnected: () => true,
  } as unknown as Browser;
  spies.connect.mockResolvedValue(browser);
  return { close, pages, browser };
};
beforeEach(() => {
  vi.clearAllMocks();
  spies.transports.splice(0);
});

it('keeps recovery blocked through cancelled physical focus initialization and late cleanup', async () => {
  const fake = fakeBrowser([fileUrl]);
  const owner = new ChromeSessionOwner();
  let initialize!: (value: unknown) => void;
  let cleaned!: () => void;
  const activity = {
    send: vi.fn<() => Promise<void>>(async () => {}),
    detach: vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>(resolve => {
          cleaned = resolve;
        }),
    ),
  };
  const pending = new Promise(resolve => {
    initialize = resolve;
  });
  const context = fake.pages[0]!.context();
  const session = vi.spyOn(context, 'newCDPSession').mockImplementation(() => pending as never);
  const abort = new AbortController();
  const beforeSourceEffect = vi.fn<() => void>();
  const opening = owner.open({ url: fileUrl, beforeSourceEffect }, abort.signal);
  await vi.waitFor(() => expect(session).toHaveBeenCalledOnce());
  abort.abort(Error('owner cancelled'));
  await expect(opening).rejects.toThrow('owner cancelled');
  expect(owner.captureQuiescence()).toBe('unconfirmed');
  expect(beforeSourceEffect).toHaveBeenCalledOnce();
  await expect(
    owner.open({ url: fileUrl, cdp: 'ws://127.0.0.1:9222/devtools/browser/owned-retiring-focus' }),
  ).rejects.toThrow('CHROME_SOURCE_CLEANUP_UNCONFIRMED');
  expect(owner.captureQuiescence()).toBe('unconfirmed');
  initialize(activity);
  await vi.waitFor(() => expect(activity.detach).toHaveBeenCalledOnce());
  expect(activity.send).toHaveBeenCalledWith('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  expect(owner.captureQuiescence()).toBe('unconfirmed');
  cleaned();
  await vi.waitFor(() => expect(owner.captureQuiescence()).toBe('quiescent'));
  await owner.close();
});

it('retains unconfirmed normal source-session cleanup instead of reopening recovery', async () => {
  const fake = fakeBrowser([fileUrl]);
  Object.assign(fake.pages[0]!, { isClosed: () => false });
  const owner = new ChromeSessionOwner();
  const session = await owner.open({ url: fileUrl });
  spies.detach.mockRejectedValueOnce(Error('owned detach failure'));
  await expect(session.close()).rejects.toThrow('owned detach failure');
  expect(owner.captureQuiescence()).toBe('unconfirmed');
  await expect(owner.close()).rejects.toThrow('owned detach failure');
});

describe('existing Chrome only', () => {
  it('refreshes only the local view after its source disappears and retains the approved transport', async () => {
    const original = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    await (await connection.open({ url: fileUrl })).close();
    original.pages.splice(0);
    const replacement = fakeBrowser([fileUrl]);
    const selected = await connection.open({ url: fileUrl });
    expect(selected.page).toBe(replacement.pages[0]);
    expect(original.close).toHaveBeenCalledOnce();
    expect(spies.transports).toHaveLength(1);
    expect(spies.transports[0]!.closed).toBe(false);
    expect(spies.connect).toHaveBeenCalledTimes(2);
    expect(spies.launch).not.toHaveBeenCalled();
    expect(spies.newPage).not.toHaveBeenCalled();
    await selected.close();
    await connection.close();
  });
  it('does not replace a disappeared source while an acquisition still owns its session', async () => {
    const original = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    const first = await connection.open({ url: fileUrl });
    original.pages.splice(0);
    await expect(connection.open({ url: fileUrl })).rejects.toThrow('CHROME_SOURCE_BUSY');
    expect(original.close).not.toHaveBeenCalled();
    expect(spies.connect).toHaveBeenCalledOnce();
    await first.close();
    await connection.close();
  });
  it('preserves cancellation and the supplied connection bound during replacement discovery', async () => {
    const original = fakeBrowser([fileUrl]);
    const connection = new ExistingChromeConnection();
    await (await connection.open({ url: fileUrl })).close();
    original.pages.splice(0);
    const replacement = fakeBrowser([fileUrl]);
    const pending = deferred();
    spies.connect.mockReturnValueOnce(pending.promise);
    spies.cdp.mockClear();
    const controller = new AbortController();
    const opening = connection
      .open({ url: fileUrl, connectionTimeoutMs: 321 }, controller.signal)
      .catch(error => error);
    await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledTimes(2));
    const reason = Error('replacement-deadline');
    controller.abort(reason);
    expect(await opening).toBe(reason);
    expect(spies.connect).toHaveBeenLastCalledWith(
      'chrome',
      expect.objectContaining({ timeout: 321, noDefaults: true }),
    );
    pending.resolve(replacement.browser);
    await vi.waitFor(() => expect(connection.state()).toBe('connected'));
    expect(spies.cdp).not.toHaveBeenCalled();
    const next = await connection.open({ url: fileUrl });
    expect(next.page).toBe(replacement.pages[0]);
    expect(spies.transports).toHaveLength(1);
    await next.close();
    await connection.close();
  });
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
    const cause = new Error('initialization timeout');
    spies.connect.mockRejectedValueOnce(cause);
    try {
      const failure = await connection.open({ url: fileUrl }).catch(error => error);
      expect(failure).toMatchObject({ code: 'CHROME_INITIALIZATION_TIMEOUT', cause });
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

describe('portal Chrome session ownership', () => {
  it('disposes a session resolved at the same instant as logical cancellation without returning a live lease', async () => {
    const fake = fakeBrowser([fileUrl]),
      owner = new ChromeSessionOwner(),
      controller = new AbortController();
    const reason = Error('cancelled at session settlement');
    const release = vi.fn<() => Promise<void>>(async () => {});
    const opening = vi
      .spyOn(ExistingChromeConnection.prototype, 'open')
      .mockImplementationOnce(async () => {
        queueMicrotask(() => controller.abort(reason));
        return {
          context: fake.pages[0]!.context(),
          page: fake.pages[0]!,
          target: parseFigmaTarget(fileUrl),
          cdpEndpoint: 'chrome',
          close: release,
        };
      });
    try {
      await expect(owner.open({ url: fileUrl }, controller.signal)).rejects.toBe(reason);
      expect(release).toHaveBeenCalledOnce();
      expect(spies.transports).toHaveLength(0);
    } finally {
      opening.mockRestore();
      await owner.close();
    }
  });
  it.each(['open-source', 'select-node'] as const)(
    'disarms expired mutation intent before a late approval after logical cancellation: %s',
    async mode => {
      const fake = fakeBrowser([fileUrl]),
        pending = deferred(),
        owner = new ChromeSessionOwner();
      const controller = new AbortController();
      spies.connect.mockReturnValueOnce(pending.promise);
      try {
        const first = owner
          .open(
            {
              url: fileUrl,
              ...(mode === 'open-source' ? { openIfMissing: true } : { selectNode: true }),
            },
            controller.signal,
          )
          .catch(error => error);
        await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledOnce());
        const transport = spies.transports[0]!;
        expect(
          mode === 'open-source'
            ? transport.scope?.missingTargetUrl?.()
            : transport.scope?.selectedNodeUrl?.(),
        ).toBeTruthy();
        const reason = Error('original mutation command cancelled');
        controller.abort(reason);
        expect(await first).toBe(reason);
        expect(transport.closed).toBe(true);
        expect(transport.scope?.missingTargetUrl?.()).toBeNull();
        expect(transport.scope?.selectedNodeUrl?.()).toBeNull();
        const lateEffects: string[] = [];
        transport.state = 'connected';
        if (!transport.closed && transport.scope?.missingTargetUrl?.())
          lateEffects.push('Target.createTarget');
        if (!transport.closed && transport.scope?.selectedNodeUrl?.())
          lateEffects.push('Page.navigate');
        expect(lateEffects).toEqual([]);
        pending.resolve(fake.browser);
        await owner.close();
        expect(await first).toBe(reason);
      } finally {
        pending.resolve(fake.browser);
        await owner.close();
      }
    },
  );

  it.each(['open-source', 'select-node'] as const)(
    'retires source mutation intent after its original connection timeout before any late approval: %s',
    async mode => {
      fakeBrowser([fileUrl]);
      const owner = new ChromeSessionOwner();
      spies.connect.mockImplementationOnce(async () => {
        spies.transports[0]!.state = 'awaiting-browser';
        throw Error('original connection timeout');
      });
      try {
        const first = await owner
          .open({
            url: fileUrl,
            connectionTimeoutMs: 123,
            ...(mode === 'open-source' ? { openIfMissing: true } : { selectNode: true }),
          })
          .catch(error => error);
        expect(first).toMatchObject({ code: 'CHROME_CONNECTION_REQUIRED' });
        const transport = spies.transports[0]!;
        expect(transport.closed).toBe(true);
        expect(transport.scope?.missingTargetUrl?.()).toBeNull();
        expect(transport.scope?.selectedNodeUrl?.()).toBeNull();
        transport.state = 'connected';
        await new Promise<void>(done => setImmediate(done));
        await (await owner.open({ url: fileUrl })).close();
        expect(spies.transports).toHaveLength(2);
        expect(first).toMatchObject({ code: 'CHROME_CONNECTION_REQUIRED' });
      } finally {
        await owner.close();
      }
    },
  );
  it('retains one physical connection across sequential logical commands until owner shutdown', async () => {
    const fake = fakeBrowser([fileUrl]);
    const owner = new ChromeSessionOwner();
    try {
      await (await owner.open({ url: fileUrl })).close();
      await (await owner.open({ url: fileUrl, cdp: 'chrome' })).close();
      expect(spies.connect).toHaveBeenCalledOnce();
      expect(spies.transports).toHaveLength(1);
      expect(spies.transports[0]!.closed).toBe(false);
      expect(fake.close).not.toHaveBeenCalled();
    } finally {
      await owner.close();
    }
    expect(fake.close).toHaveBeenCalledOnce();
    expect(spies.transports[0]!.closed).toBe(true);
  });

  it('retains a pending native handshake after the first local connection timeout and keeps its failure settled', async () => {
    fakeBrowser([fileUrl]);
    const owner = new ChromeSessionOwner();
    spies.connect.mockImplementationOnce(async () => {
      spies.transports[0]!.state = 'awaiting-browser';
      throw Error('first original connection timeout');
    });
    try {
      const first = await owner
        .open({ url: fileUrl, connectionTimeoutMs: 123 })
        .catch(error => error);
      expect(first.message).toContain('CHROME_CONNECTION_REQUIRED');
      expect(spies.transports[0]!.closed).toBe(false);
      spies.transports[0]!.state = 'connected';
      await (await owner.open({ url: fileUrl, connectionTimeoutMs: 456 })).close();
      expect(first.message).toContain('CHROME_CONNECTION_REQUIRED');
      expect(spies.transports).toHaveLength(1);
      expect(spies.connect).toHaveBeenCalledTimes(2);
      expect(spies.connect.mock.calls[0]?.[1]).toMatchObject({ timeout: 123 });
      expect(spies.connect.mock.calls[1]?.[1]).toMatchObject({ timeout: 456 });
    } finally {
      await owner.close();
    }
  });

  it('lets a new same-file read share pending physical initialization after logical cancellation without extending it', async () => {
    const fake = fakeBrowser([fileUrl]),
      pending = deferred();
    spies.connect.mockReturnValueOnce(pending.promise);
    const owner = new ChromeSessionOwner(),
      controller = new AbortController();
    try {
      const first = owner
        .open({ url: fileUrl, connectionTimeoutMs: 321 }, controller.signal)
        .catch(error => error);
      await vi.waitFor(() => expect(spies.connect).toHaveBeenCalledOnce());
      const reason = Error('first logical command cancelled');
      controller.abort(reason);
      expect(await first).toBe(reason);
      await expect(
        owner.open({ url: 'https://www.figma.com/design/otherOwnerFixtureKey?node-id=0-1' }),
      ).rejects.toThrow('CHROME_SOURCE_BUSY');
      const second = owner.open({ url: fileUrl, connectionTimeoutMs: 999 });
      pending.resolve(fake.browser);
      const session = await second;
      expect(session.page).toBe(fake.pages[0]);
      expect(spies.connect).toHaveBeenCalledOnce();
      expect(spies.connect.mock.calls[0]?.[1]).toMatchObject({ timeout: 321 });
      expect(spies.transports[0]!.closed).toBe(false);
      await session.close();
    } finally {
      pending.resolve(fake.browser);
      await owner.close();
    }
  });

  it('rejects overlapping source commands before changing endpoints or the active source', async () => {
    fakeBrowser([fileUrl]);
    const owner = new ChromeSessionOwner();
    try {
      const first = await owner.open({ url: fileUrl });
      await expect(
        owner.open({
          url: fileUrl,
          cdp: 'ws://127.0.0.1:9222/devtools/browser/other-owned-endpoint',
        }),
      ).rejects.toMatchObject({ code: 'CHROME_SOURCE_BUSY' });
      expect(spies.transports).toHaveLength(1);
      expect(spies.transports[0]!.closed).toBe(false);
      await first.close();
    } finally {
      await owner.close();
    }
  });

  it('validates changed endpoint and URL inputs before closing the healthy owner connection', async () => {
    const fake = fakeBrowser([fileUrl]),
      owner = new ChromeSessionOwner();
    try {
      await (await owner.open({ url: fileUrl })).close();
      await expect(owner.open({ url: fileUrl, cdp: 'not-a-url' })).rejects.toMatchObject({
        code: 'CHROME_CDP_INVALID',
      });
      await expect(
        owner.open({ url: 'not-a-url', cdp: 'ws://127.0.0.1:9222/devtools/browser/owned' }),
      ).rejects.toMatchObject({ code: 'ERR_INVALID_URL' });
      expect(fake.close).not.toHaveBeenCalled();
      await (await owner.open({ url: fileUrl })).close();
      expect(spies.connect).toHaveBeenCalledOnce();
    } finally {
      await owner.close();
    }
  });

  it('quarantines a failed physical retirement and surfaces its original error during shutdown', async () => {
    const original = fakeBrowser([fileUrl]),
      owner = new ChromeSessionOwner();
    const failure = Error('unconfirmed physical cleanup');
    await (await owner.open({ url: fileUrl })).close();
    original.close.mockRejectedValueOnce(failure);
    await expect(
      owner.open({
        url: fileUrl,
        cdp: 'ws://127.0.0.1:9222/devtools/browser/failed-cleanup-owned',
      }),
    ).rejects.toBe(failure);
    await expect(owner.open({ url: fileUrl })).rejects.toMatchObject({
      code: 'CHROME_CONNECTION_CLOSED',
      cause: failure,
    });
    await expect(
      owner.open({ url: fileUrl, cdp: 'ws://127.0.0.1:9222/devtools/browser/another-owned' }),
    ).rejects.toMatchObject({ code: 'CHROME_CONNECTION_CLOSED' });
    await expect(owner.close()).rejects.toBe(failure);
    expect(original.close).toHaveBeenCalledOnce();
    expect(spies.connect).toHaveBeenCalledOnce();
  });

  it('replaces an idle explicitly changed endpoint and deducts physical cleanup from its original connection deadline', async () => {
    let time = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => time);
    const original = fakeBrowser([fileUrl]),
      owner = new ChromeSessionOwner();
    try {
      await (await owner.open({ url: fileUrl })).close();
      original.close.mockImplementationOnce(async () => {
        time += 75;
      });
      const replacement = fakeBrowser([fileUrl]);
      const session = await owner.open({
        url: fileUrl,
        cdp: 'ws://127.0.0.1:9222/devtools/browser/replacement-owned',
        connectionTimeoutMs: 200,
      });
      expect(session.page).toBe(replacement.pages[0]);
      expect(original.close).toHaveBeenCalledOnce();
      expect(spies.transports).toHaveLength(2);
      expect(spies.transports[0]!.closed).toBe(true);
      expect(spies.connect.mock.calls[1]?.[1]).toMatchObject({ timeout: 125 });
      await session.close();
    } finally {
      await owner.close();
      clock.mockRestore();
    }
  });

  it('returns an endpoint-switch cancellation promptly while shutdown still waits for physical cleanup', async () => {
    const original = fakeBrowser([fileUrl]),
      cleanup = deferred(),
      owner = new ChromeSessionOwner();
    const controller = new AbortController();
    try {
      await (await owner.open({ url: fileUrl })).close();
      original.close.mockReturnValueOnce(cleanup.promise as Promise<void>);
      const switching = owner
        .open(
          {
            url: fileUrl,
            cdp: 'ws://127.0.0.1:9222/devtools/browser/cancelled-owned',
            connectionTimeoutMs: 1000,
          },
          controller.signal,
        )
        .catch(error => error);
      await vi.waitFor(() => expect(original.close).toHaveBeenCalledOnce());
      const reason = Error('endpoint switch cancelled');
      controller.abort(reason);
      expect(await switching).toBe(reason);
      await expect(owner.open({ url: fileUrl })).rejects.toMatchObject({
        code: 'CHROME_SOURCE_BUSY',
      });
      let closed = false;
      const closing = owner.close().then(() => {
        closed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      cleanup.resolve(undefined);
      await closing;
      expect(spies.connect).toHaveBeenCalledOnce();
      await expect(owner.open({ url: fileUrl })).rejects.toThrow('CHROME_CONNECTION_CLOSED');
    } finally {
      cleanup.resolve(undefined);
      await owner.close();
    }
  });

  it('settles an endpoint-switch timeout without late attachment or early release of its physical cleanup', async () => {
    const original = fakeBrowser([fileUrl]),
      cleanup = deferred(),
      owner = new ChromeSessionOwner();
    try {
      await (await owner.open({ url: fileUrl })).close();
      original.close.mockReturnValueOnce(cleanup.promise as Promise<void>);
      await expect(
        owner.open({
          url: fileUrl,
          cdp: 'ws://127.0.0.1:9222/devtools/browser/timed-out-owned',
          connectionTimeoutMs: 25,
        }),
      ).rejects.toMatchObject({ code: 'CHROME_CONNECTION_REQUIRED' });
      expect(spies.connect).toHaveBeenCalledOnce();
      await expect(owner.open({ url: fileUrl })).rejects.toMatchObject({
        code: 'CHROME_SOURCE_BUSY',
      });
    } finally {
      cleanup.resolve(undefined);
      await owner.close();
    }
  });

  it.each(['cancelled', 'expired'] as const)(
    'allows a new same-old-endpoint job after confirmed cleanup of an interrupted switch: %s',
    async mode => {
      const original = fakeBrowser([fileUrl]),
        cleanup = deferred(),
        owner = new ChromeSessionOwner();
      const controller = new AbortController();
      try {
        await (await owner.open({ url: fileUrl })).close();
        original.close.mockReturnValueOnce(cleanup.promise as Promise<void>);
        const switching = owner
          .open(
            {
              url: fileUrl,
              cdp: 'ws://127.0.0.1:9222/devtools/browser/interrupted-owned',
              connectionTimeoutMs: mode === 'expired' ? 25 : 1000,
            },
            controller.signal,
          )
          .catch(error => error);
        await vi.waitFor(() => expect(original.close).toHaveBeenCalledOnce());
        if (mode === 'cancelled') controller.abort(Error('interrupted source switch'));
        const failure = await switching;
        expect(failure).toBeInstanceOf(Error);
        expect(spies.connect).toHaveBeenCalledOnce();
        await expect(owner.open({ url: fileUrl })).rejects.toMatchObject({
          code: 'CHROME_SOURCE_BUSY',
        });
        const replacement = fakeBrowser([fileUrl]);
        cleanup.resolve(undefined);
        await new Promise<void>(done => setImmediate(done));
        const restored = await owner.open({ url: fileUrl, connectionTimeoutMs: 321 });
        expect(restored.page).toBe(replacement.pages[0]);
        expect(spies.transports).toHaveLength(2);
        expect(spies.connect.mock.calls[1]?.[1]).toMatchObject({ timeout: 321 });
        expect(failure).toBeInstanceOf(Error);
        await restored.close();
      } finally {
        cleanup.resolve(undefined);
        await owner.close();
      }
    },
  );
});
