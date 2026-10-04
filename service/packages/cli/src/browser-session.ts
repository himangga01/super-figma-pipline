import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  createRetainedChromeTransport,
  type RetainedChromeTransport,
} from '../../mcp/src/portal/chrome-transport.js';
import { resolveExistingChromeEndpoint } from './chrome-endpoint.js';
import { assertLoopbackCdp, parseFigmaTarget, type FigmaTarget } from './figma-url.js';
import { waitLogically } from './logical-wait.js';

export interface ChromeSession {
  context: BrowserContext;
  page: Page;
  target: Readonly<FigmaTarget>;
  cdpEndpoint: string;
  close(): Promise<void>;
}

/** Attach to existing Chrome. Creating a missing source tab requires an explicit owner request. */
interface ChromeSessionOptions {
  url?: string;
  cdp?: string;
  openIfMissing?: boolean;
  connectionTimeoutMs?: number;
}
const chromeEndpoint = async (options: ChromeSessionOptions) =>
  options.cdp === undefined || options.cdp === 'chrome'
    ? await resolveExistingChromeEndpoint()
    : assertLoopbackCdp(options.cdp);
const attachChrome = async (options: ChromeSessionOptions, timeout = 60_000): Promise<Browser> => {
  const endpoint = await chromeEndpoint(options);
  return chromium
    .connectOverCDP(endpoint, {
      timeout: options.connectionTimeoutMs ?? timeout,
      noDefaults: true,
    })
    .catch(error => {
      const detail = error instanceof Error ? error.message : '';
      if (detail.includes('<ws connected>') && /timeout/iu.test(detail))
        throw new Error(
          'CHROME_INITIALIZATION_TIMEOUT: Chrome accepted the connection but Playwright could not finish browser initialization',
          { cause: error },
        );
      throw new Error(
        'CHROME_CONNECTION_REQUIRED: enable remote debugging in the existing Chrome at chrome://inspect/#remote-debugging, then allow its connection prompt',
        { cause: error },
      );
    });
};
const selectExistingFigma = async (
  browser: Browser,
  options: ChromeSessionOptions,
  close: () => Promise<void>,
): Promise<ChromeSession> => {
  const requested = options.url === undefined ? null : parseFigmaTarget(options.url);
  const matches = browser
    .contexts()
    .flatMap(context => context.pages())
    .filter(page => {
      try {
        const observed = parseFigmaTarget(page.url());
        return requested === null || observed.fileKey === requested.fileKey;
      } catch {
        return false;
      }
    });
  if (matches.length === 0 && options.openIfMissing) {
    if (!requested) throw new Error('FIGMA_URL_REQUIRED');
    const contexts = browser.contexts();
    if (contexts.length !== 1) throw new Error('CHROME_CONTEXT_AMBIGUOUS');
    const created = await contexts[0]!.newPage();
    try {
      await created.goto(requested.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return await selectExistingFigma(browser, { ...options, openIfMissing: false }, close);
    } catch (error) {
      await created.close().catch(() => {});
      throw error;
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? 'FIGMA_TAB_NOT_FOUND: open the requested file in this Chrome'
        : 'CHROME_TARGET_AMBIGUOUS: more than one tab contains the requested file',
    );
  }
  const page = matches[0]!;
  const target = requested ?? parseFigmaTarget(page.url());
  // noDefaults leaves unrelated tabs untouched. Keep only this renderer active so
  // background-tab throttling cannot stall Figma's plugin exports or UI actions.
  const activity = await page.context().newCDPSession(page);
  try {
    await activity.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch (error) {
    await activity.detach().catch(() => {});
    throw error;
  }
  let released = false;
  return {
    context: page.context(),
    page,
    target,
    cdpEndpoint:
      options.cdp === undefined || options.cdp === 'chrome'
        ? 'chrome'
        : assertLoopbackCdp(options.cdp),
    close: async () => {
      if (released) return;
      released = true;
      try {
        // The transport may already be gone during cancellation or daemon shutdown.
        try {
          await activity.detach();
        } catch (error) {
          if (browser.isConnected() && !page.isClosed()) throw error;
        }
      } finally {
        await close();
      }
    },
  };
};

export const openChromeSession = async (options: ChromeSessionOptions): Promise<ChromeSession> => {
  if (options.openIfMissing && options.url === undefined) throw new Error('FIGMA_URL_REQUIRED');
  if (options.url !== undefined) parseFigmaTarget(options.url);
  if (!options.openIfMissing) {
    // Standalone collection needs the same selected-target attachment as portal capture.
    // Its transport belongs to this invocation, so close both logical and physical sessions.
    const connection = new ExistingChromeConnection();
    try {
      const session = await connection.open({
        ...options,
        connectionTimeoutMs: options.connectionTimeoutMs ?? 60_000,
      });
      let released = false;
      return {
        ...session,
        close: async () => {
          if (released) return;
          released = true;
          try {
            await session.close();
          } finally {
            await connection.close();
          }
        },
      };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
  const browser = await attachChrome(options);
  try {
    return await selectExistingFigma(browser, options, () => browser.close());
  } catch (error) {
    await browser.close();
    throw error;
  }
};

/** Retain a healthy owner-approved connection; terminal remotes require a fresh private generation. */
export class ExistingChromeConnection {
  private browser: Browser | null = null;
  private connecting: Promise<Browser> | null = null;
  private closed = false;
  private endpoint: string | null = null;
  private transport: RetainedChromeTransport | null = null;
  private fileKey: string | null = null;
  private activeSessions = 0;
  state(): ReturnType<RetainedChromeTransport['state']> | 'initializing' {
    if (this.closed) return 'unavailable';
    const transport = this.transport?.state();
    if (transport === 'connected')
      return this.browser?.isConnected() ? 'connected' : 'initializing';
    return transport ?? (this.connecting ? 'awaiting-browser' : 'not-requested');
  }

  async open(options: ChromeSessionOptions, signal?: AbortSignal): Promise<ChromeSession> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('CHROME_CONNECTION_CLOSED');
    const requestedFileKey =
      options.url === undefined ? null : parseFigmaTarget(options.url).fileKey;
    const endpoint = options.cdp ?? 'chrome';
    if (this.endpoint !== null && this.endpoint !== endpoint)
      throw new Error('CHROME_CONNECTION_ENDPOINT_CHANGED');
    const changeFile = this.fileKey !== requestedFileKey;
    if (changeFile && (this.connecting || this.activeSessions))
      throw new Error('CHROME_SOURCE_BUSY: another source acquisition is active');
    this.fileKey = requestedFileKey;
    this.endpoint = endpoint;
    if (this.browser?.isConnected() === false) this.browser = null;
    if (
      changeFile ||
      this.connecting ||
      !this.browser ||
      this.transport?.state() === 'unavailable'
    ) {
      if (!this.connecting) {
        const pending = (async () => {
          if (changeFile && this.browser) {
            // Retain the approved remote socket while replacing only the local Playwright view.
            await this.browser.close();
            this.browser = null;
          }
          if (this.transport?.state() === 'unavailable') {
            const obsolete = this.transport;
            const staleBrowser = this.browser;
            this.transport = null;
            this.browser = null;
            await obsolete.close();
            if (staleBrowser) await staleBrowser.close();
          }
          this.transport ??= await createRetainedChromeTransport(await chromeEndpoint(options), {
            matchesTarget: url => {
              try {
                const target = parseFigmaTarget(url);
                return this.fileKey === null || target.fileKey === this.fileKey;
              } catch {
                return false;
              }
            },
          });
          if (this.closed) {
            await this.transport.close();
            throw new Error('CHROME_CONNECTION_CLOSED');
          }
          try {
            return await chromium.connectOverCDP(this.transport.endpoint, {
              timeout: options.connectionTimeoutMs ?? 300_000,
              noDefaults: true,
              headers: this.transport.headers,
            });
          } catch (cause) {
            // The authenticated local client may time out; the one Chrome permission request remains alive.
            const targetFailure = ['FIGMA_TAB_NOT_FOUND', 'CHROME_TARGET_AMBIGUOUS'].find(
              code => cause instanceof Error && cause.message.includes(code),
            );
            if (targetFailure) throw new Error(targetFailure, { cause });
            const initializedTransport = this.transport.state() === 'connected';
            if (initializedTransport)
              console.error('[chrome] initialization incomplete', this.transport.diagnostics());
            throw new Error(
              initializedTransport
                ? 'CHROME_INITIALIZATION_TIMEOUT: Chrome accepted the connection but Playwright could not finish browser initialization'
                : 'CHROME_CONNECTION_REQUIRED: the existing Chrome connection is not ready',
              { cause },
            );
          }
        })()
          .then(async browser => {
            if (this.closed) {
              await browser.close();
              throw new Error('CHROME_CONNECTION_CLOSED');
            }
            this.browser = browser;
            return browser;
          })
          .finally(() => {
            if (this.connecting === pending) this.connecting = null;
          });
        this.connecting = pending;
      }
      await waitLogically(this.connecting, signal);
    }
    signal?.throwIfAborted();
    if (this.closed) throw new Error('CHROME_CONNECTION_CLOSED');
    // Capture completion releases its logical session, never the shared CDP transport.
    this.activeSessions++;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      this.activeSessions--;
    };
    try {
      return await waitLogically(
        selectExistingFigma(this.browser!, options, release),
        signal,
        session => session.close(),
      );
    } catch (error) {
      await release();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport?.close();
    const browser = this.browser ?? (await this.connecting?.catch(() => null));
    this.browser = null;
    if (browser) await browser.close();
  }
}

export const observeFigmaPage = async (page: Page, target: Readonly<FigmaTarget>) => {
  const url = page.url();
  let matches = false;
  try {
    matches = parseFigmaTarget(url).fileKey === target.fileKey;
  } catch {
    /* authentication route */
  }
  const login =
    (await page.getByRole('textbox', { name: /email|이메일/iu }).count()) > 0 ||
    /\/login(?:[/?]|$)/u.test(url);
  const blocked =
    (await page
      .getByText(/request access|you need access|액세스 요청|접근 권한이 필요/iu)
      .count()) > 0;
  const guest =
    (await page.getByText(/댓글 달기, 편집, 검사|sign up.*(?:comment|inspect|edit)/iu).count()) > 0;
  // Figma hides its application focus target when screenreader support is disabled.
  // Require the rendered canvas as well so a hidden marker alone is not readiness.
  const app = page.getByRole('application', { name: /Figma/iu, includeHidden: true });
  const ready =
    matches &&
    (await app.count()) > 0 &&
    (await page.locator('canvas').filter({ visible: true }).count()) > 0 &&
    !login &&
    !blocked;
  return {
    schemaVersion: 1 as const,
    source: 'playwright-chrome-ui' as const,
    status: login
      ? ('login-required' as const)
      : blocked
        ? ('access-required' as const)
        : ready && guest
          ? ('guest-preview' as const)
          : ready
            ? ('ready' as const)
            : ('loading' as const),
    targetUrl: target.url,
    title: await page.title(),
    layers: ready
      ? (await page.getByRole('treegrid').allTextContents()).map(text => text.slice(0, 30_000))
      : [],
    pages: ready
      ? (await page.getByRole('grid').allTextContents()).map(text => text.slice(0, 10_000))
      : [],
    exactDesignValues: false,
  };
};
