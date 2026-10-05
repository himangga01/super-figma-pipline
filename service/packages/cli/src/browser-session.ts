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
  if (options.openIfMissing && options.url === undefined) throw new Error('FIGMA_URL_REQUIRED');
  if (options.url !== undefined) parseFigmaTarget(options.url);
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
};

/** Retain a healthy owner-approved connection; terminal remotes require a fresh private generation. */
export class ExistingChromeConnection {
  private browser: Browser | null = null;
  private connecting: Promise<Browser> | null = null;
  private closed = false;
  private endpoint: string | null = null;
  private transport: RetainedChromeTransport | null = null;
  private fileKey: string | null = null;
  private openTargetUrl: string | null = null;
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
    const openTargetUrl =
      options.openIfMissing && options.url ? parseFigmaTarget(options.url).url : null;
    const endpoint = options.cdp ?? 'chrome';
    if (this.endpoint !== null && this.endpoint !== endpoint)
      throw new Error('CHROME_CONNECTION_ENDPOINT_CHANGED');
    const changeFile = this.fileKey !== requestedFileKey;
    // The transport reads the opening intent while it initializes, so it must not change underneath it.
    if (
      (changeFile || openTargetUrl !== this.openTargetUrl) &&
      (this.connecting || this.activeSessions)
    )
      throw new Error('CHROME_SOURCE_BUSY: another source acquisition is active');
    this.fileKey = requestedFileKey;
    this.openTargetUrl = openTargetUrl;
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
            missingTargetUrl: () => this.openTargetUrl,
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
            const targetFailure = [
              'FIGMA_TAB_NOT_FOUND',
              'CHROME_TARGET_AMBIGUOUS',
              'CHROME_CONTEXT_AMBIGUOUS',
              'FIGMA_URL_INVALID',
            ].find(code => cause instanceof Error && cause.message.includes(code));
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
    if (openTargetUrl) await this.openSource(openTargetUrl, requestedFileKey, options, signal);
    // Capture completion releases its logical session, never the shared CDP transport.
    this.activeSessions++;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      this.activeSessions--;
    };
    try {
      const session = await waitLogically(
        selectExistingFigma(this.browser!, options, release),
        signal,
        selected => selected.close(),
      );
      // The requested source is selected: a tab opened for it now belongs to the owner.
      if (openTargetUrl) this.transport?.releaseCreatedTargets();
      return session;
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async openSource(
    url: string,
    fileKey: string | null,
    options: ChromeSessionOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const pages = this.browser!.contexts().flatMap(context => context.pages());
    if (pages.length !== 1) throw new Error('CHROME_TARGET_AMBIGUOUS');
    const page = pages[0]!;
    try {
      if (page.url() === 'about:blank')
        await waitLogically(
          page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
          signal,
        );
      await waitLogically(
        page.waitForURL(
          candidate => {
            try {
              return parseFigmaTarget(candidate.href).fileKey === fileKey;
            } catch {
              return false;
            }
          },
          {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(options.connectionTimeoutMs ?? 60_000, 60_000),
          },
        ),
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      // A sign-in redirect or another destination never reaches the requested file.
      if (/\/login(?:[/?]|$)/u.test(page.url()))
        throw new Error('FIGMA_LOGIN_REQUIRED: sign in inside the existing Figma tab', {
          cause: error,
        });
      if ((error as { name?: unknown } | null)?.name === 'TimeoutError')
        throw new Error('FIGMA_TAB_NOT_FOUND: the requested Figma file did not open', {
          cause: error,
        });
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
