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

/** Attach only. Never launch Chrome, create a tab, navigate an existing tab, or copy a profile. */
interface ChromeSessionOptions {
  url?: string;
  cdp?: string;
}
const chromeEndpoint = async (options: ChromeSessionOptions) =>
  options.cdp === undefined || options.cdp === 'chrome'
    ? await resolveExistingChromeEndpoint()
    : assertLoopbackCdp(options.cdp);
const attachChrome = async (options: ChromeSessionOptions, timeout = 60_000): Promise<Browser> => {
  const endpoint = await chromeEndpoint(options);
  return chromium.connectOverCDP(endpoint, { timeout, noDefaults: true }).catch(error => {
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
  if (options.url !== undefined) parseFigmaTarget(options.url);
  const browser = await attachChrome(options);
  try {
    return await selectExistingFigma(browser, options, () => browser.close());
  } catch (error) {
    await browser.close();
    throw error;
  }
};

/** Keep one owner-approved connection for the daemon lifetime, including missing-tab recovery. */
export class ExistingChromeConnection {
  private browser: Browser | null = null;
  private connecting: Promise<Browser> | null = null;
  private closed = false;
  private endpoint: string | null = null;
  private transport: RetainedChromeTransport | null = null;
  state(): ReturnType<RetainedChromeTransport['state']> {
    return this.closed
      ? 'unavailable'
      : (this.transport?.state() ?? (this.connecting ? 'awaiting-browser' : 'not-requested'));
  }

  async open(options: ChromeSessionOptions, signal?: AbortSignal): Promise<ChromeSession> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('CHROME_CONNECTION_CLOSED');
    if (options.url !== undefined) parseFigmaTarget(options.url);
    const endpoint = options.cdp ?? 'chrome';
    if (this.endpoint !== null && this.endpoint !== endpoint)
      throw new Error('CHROME_CONNECTION_ENDPOINT_CHANGED');
    this.endpoint = endpoint;
    if (this.browser?.isConnected() === false) this.browser = null;
    if (!this.browser) {
      if (!this.connecting) {
        const pending = (async () => {
          this.transport ??= await createRetainedChromeTransport(await chromeEndpoint(options));
          if (this.closed) {
            await this.transport.close();
            throw new Error('CHROME_CONNECTION_CLOSED');
          }
          try {
            return await chromium.connectOverCDP(this.transport.endpoint, {
              timeout: 300_000,
              noDefaults: true,
              headers: this.transport.headers,
            });
          } catch (cause) {
            // The authenticated local client may time out; the one Chrome permission request remains alive.
            throw new Error(
              'CHROME_CONNECTION_REQUIRED: the existing Chrome connection is not ready',
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
    return waitLogically(
      selectExistingFigma(this.browser!, options, async () => {}),
      signal,
      session => session.close(),
    );
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
