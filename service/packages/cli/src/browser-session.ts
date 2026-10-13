import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { diagnose } from '../../mcp/src/diagnostics.js';
import {
  createRetainedChromeTransport,
  type RetainedChromeTransport,
} from '../../mcp/src/portal/chrome-transport.js';
import {
  resolveChromeWebSocketEndpoint,
  resolveExistingChromeEndpoint,
} from './chrome-endpoint.js';
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
  selectNode?: boolean;
  connectionTimeoutMs?: number;
  beforeSourceEffect?: () => void;
}
const chromeEndpoint = async (options: ChromeSessionOptions, signal?: AbortSignal) => {
  if (options.cdp === undefined || options.cdp === 'chrome')
    return { endpoint: await resolveExistingChromeEndpoint(), deadlineAt: null };
  let endpoint: string;
  try {
    endpoint = assertLoopbackCdp(options.cdp);
  } catch {
    throw Object.assign(new Error('CHROME_CDP_INVALID: use a loopback Chrome debugging endpoint'), {
      code: 'CHROME_CDP_INVALID',
    });
  }
  if (endpoint.startsWith('ws:')) return { endpoint, deadlineAt: null };
  const deadlineAt = Date.now() + (options.connectionTimeoutMs ?? 300_000);
  return {
    deadlineAt,
    endpoint: await resolveChromeWebSocketEndpoint(endpoint, {
      ...(options.connectionTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.connectionTimeoutMs }),
      ...(signal === undefined ? {} : { signal }),
    }),
  };
};
const matchingFigmaPages = (browser: Browser, fileKey: string | null) =>
  browser
    .contexts()
    .flatMap(context => context.pages())
    .filter(page => {
      try {
        const observed = parseFigmaTarget(page.url());
        return fileKey === null || observed.fileKey === fileKey;
      } catch {
        return false;
      }
    });
const selectExistingFigma = async (
  browser: Browser,
  options: ChromeSessionOptions,
  close: () => Promise<void>,
): Promise<ChromeSession> => {
  const requested = options.url === undefined ? null : parseFigmaTarget(options.url);
  const matches = matchingFigmaPages(browser, requested?.fileKey ?? null);
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
  options.beforeSourceEffect?.();
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

export const openChromeSession = async (
  options: ChromeSessionOptions,
  signal?: AbortSignal,
): Promise<ChromeSession> => {
  signal?.throwIfAborted();
  if (options.openIfMissing && options.url === undefined) throw new Error('FIGMA_URL_REQUIRED');
  if (options.url !== undefined) parseFigmaTarget(options.url);
  // Standalone collection needs the same selected-target attachment as portal capture.
  // Its transport belongs to this invocation, so close both logical and physical sessions.
  const connection = new ExistingChromeConnection();
  try {
    const session = await connection.open(
      { ...options, connectionTimeoutMs: options.connectionTimeoutMs ?? 60_000 },
      signal,
    );
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

/** One portal owns the physical connection; each command owns only its logical source session. */
export class ChromeSessionOwner {
  private connection = new ExistingChromeConnection();
  private requestedEndpoint: string | null = null;
  private active = false;
  private closing: Promise<void> | null = null;
  private transition: Promise<void> | null = null;
  private retired = false;
  private retirementFailure: { cause: unknown } | null = null;
  private retiringSources = new Set<ExistingChromeConnection>();
  private captureWork = new Map<Promise<unknown>, string | undefined>();
  private captureCleanupFailures = new Set<string | undefined>();
  /** Observe physical helper work; logical cancellation never removes its pending receipt. */
  trackCaptureWork<T>(pending: Promise<T>, cleanup = false, executionId?: string): Promise<T> {
    this.captureWork.set(pending, executionId);
    void pending.then(
      () => {
        this.captureWork.delete(pending);
        return undefined;
      },
      cause => {
        this.captureWork.delete(pending);
        if (cleanup) {
          this.captureCleanupFailures.add(executionId);
          diagnose(
            'job.execution-error',
            { jobId: executionId, phase: 'source-cleanup' },
            cause,
            'error',
          );
        }
        return undefined;
      },
    );
    return pending;
  }
  captureExecutionQuiescent(executionId?: string): boolean {
    return (
      !this.captureCleanupFailures.has(executionId) &&
      !this.captureCleanupFailures.has(undefined) &&
      ![...this.captureWork.values()].some(id => id === executionId || id === undefined)
    );
  }
  markCaptureUnconfirmed(executionId?: string): void {
    this.captureCleanupFailures.add(executionId);
    diagnose(
      'job.execution-error',
      { jobId: executionId, phase: 'source-cleanup' },
      new Error('SCRIPTER_SOURCE_RETIREMENT_UNCONFIRMED'),
      'error',
    );
  }
  private retiredSourceQuiescent(): boolean {
    for (const source of this.retiringSources) {
      if (!source.sourceWorkQuiescent()) return false;
      this.retiringSources.delete(source);
    }
    return true;
  }

  /** Pending read-only attachment is allowed; deferred source intents/cleanup are not. */
  captureQuiescence(): 'quiescent' | 'busy' | 'unconfirmed' {
    if (this.captureWork.size || this.captureCleanupFailures.size) return 'unconfirmed';
    if (this.retirementFailure) return 'unconfirmed';
    if (!this.retiredSourceQuiescent()) return 'unconfirmed';
    if (this.active || this.transition) return 'busy';
    if (!this.connection.sourceWorkQuiescent()) return 'unconfirmed';
    if (!this.retired && !this.connection.sourceIntentQuiescent()) return 'unconfirmed';
    return 'quiescent';
  }

  private retire(): Promise<void> {
    if (this.retirementFailure) return Promise.reject(this.retirementFailure.cause);
    if (this.transition) return this.transition;
    if (this.retired) return Promise.resolve();
    // Retain old initialization/late cleanup even after its socket has closed.
    this.retiringSources.add(this.connection);
    const transition = this.connection.close();
    this.transition = transition;
    void transition.then(
      () => {
        this.retired = true;
        if (this.transition === transition) this.transition = null;
        return undefined;
      },
      cause => {
        this.retirementFailure = { cause };
        if (this.transition === transition) this.transition = null;
        return undefined;
      },
    );
    return transition;
  }

  async open(options: ChromeSessionOptions, signal?: AbortSignal): Promise<ChromeSession> {
    signal?.throwIfAborted();
    if (this.closing) throw new Error('CHROME_CONNECTION_CLOSED');
    if (this.captureWork.size || this.captureCleanupFailures.size)
      throw Object.assign(new Error('CHROME_SOURCE_CLEANUP_UNCONFIRMED'), {
        code: 'CHROME_SOURCE_CLEANUP_UNCONFIRMED',
      });
    if (!this.retiredSourceQuiescent()) throw new Error('CHROME_SOURCE_CLEANUP_UNCONFIRMED');
    if (this.retirementFailure)
      throw Object.assign(
        new Error('CHROME_CONNECTION_CLOSED: previous source cleanup is unconfirmed', {
          cause: this.retirementFailure.cause,
        }),
        { code: 'CHROME_CONNECTION_CLOSED' },
      );
    if (this.active || this.transition)
      throw Object.assign(new Error('CHROME_SOURCE_BUSY: another Chrome command is active'), {
        code: 'CHROME_SOURCE_BUSY',
      });
    const deadlineAt = Date.now() + (options.connectionTimeoutMs ?? 300_000);
    const target = options.url === undefined ? null : parseFigmaTarget(options.url);
    if (options.openIfMissing && !target) throw new Error('FIGMA_URL_REQUIRED');
    if (options.selectNode && !target?.nodeId) throw new Error('FIGMA_WEB_COPY_NODE_REQUIRED');
    let endpoint = options.cdp ?? 'chrome';
    if (endpoint !== 'chrome') {
      try {
        endpoint = assertLoopbackCdp(endpoint);
      } catch {
        throw Object.assign(
          new Error('CHROME_CDP_INVALID: use a loopback Chrome debugging endpoint'),
          { code: 'CHROME_CDP_INVALID' },
        );
      }
    }
    this.active = true;
    const mutationIntent = options.openIfMissing === true || options.selectNode === true;
    let attemptedOpen = false;
    const abortIntent = () => {
      if (mutationIntent && attemptedOpen && this.connection.hasSourceIntent())
        void this.retire().catch(() => {});
    };
    try {
      let connectionTimeoutMs = options.connectionTimeoutMs;
      if (this.retired) {
        // Only a newly requested job can recreate a confirmed closed generation.
        this.connection = new ExistingChromeConnection();
        this.requestedEndpoint = null;
        this.retired = false;
      }
      if (this.requestedEndpoint !== null && this.requestedEndpoint !== endpoint) {
        // A new idle command deliberately selects a different endpoint. Its old grant is not reused.
        const transition = this.retire();
        const cleanupDeadline = new AbortController();
        const timer = setTimeout(
          () =>
            cleanupDeadline.abort(
              Object.assign(
                new Error(
                  'CHROME_CONNECTION_REQUIRED: the original Chrome connection deadline expired during endpoint cleanup',
                ),
                { code: 'CHROME_CONNECTION_REQUIRED' },
              ),
            ),
          Math.max(1, deadlineAt - Date.now()),
        );
        try {
          await waitLogically(
            transition,
            signal ? AbortSignal.any([signal, cleanupDeadline.signal]) : cleanupDeadline.signal,
          );
        } finally {
          clearTimeout(timer);
        }
        signal?.throwIfAborted();
        if (this.closing) throw new Error('CHROME_CONNECTION_CLOSED');
        if (!this.retiredSourceQuiescent()) throw new Error('CHROME_SOURCE_CLEANUP_UNCONFIRMED');
        connectionTimeoutMs = deadlineAt - Date.now();
        if (connectionTimeoutMs <= 0)
          throw Object.assign(
            new Error(
              'CHROME_CONNECTION_REQUIRED: the original Chrome connection deadline expired during endpoint cleanup',
            ),
            { code: 'CHROME_CONNECTION_REQUIRED' },
          );
        this.connection = new ExistingChromeConnection();
        this.retired = false;
      }
      this.requestedEndpoint = endpoint;
      signal?.throwIfAborted();
      signal?.addEventListener('abort', abortIntent, { once: true });
      attemptedOpen = true;
      const session = await this.connection.open(
        {
          ...options,
          ...(options.cdp === undefined ? {} : { cdp: endpoint }),
          ...(connectionTimeoutMs === undefined ? {} : { connectionTimeoutMs }),
        },
        signal,
      );
      if (signal?.aborted || this.closing) {
        await session.close();
        signal?.throwIfAborted();
        throw new Error('CHROME_CONNECTION_CLOSED');
      }
      let released = false;
      return {
        ...session,
        close: async () => {
          if (released) return;
          released = true;
          signal?.removeEventListener('abort', abortIntent);
          try {
            await session.close();
          } catch (cause) {
            this.retirementFailure = { cause };
            throw cause;
          } finally {
            this.active = false;
          }
        },
      };
    } catch (error) {
      signal?.removeEventListener('abort', abortIntent);
      if (mutationIntent && attemptedOpen && this.connection.hasSourceIntent())
        void this.retire().catch(() => {});
      this.active = false;
      throw error;
    }
  }

  close(): Promise<void> {
    this.closing ??= this.retire();
    return this.closing;
  }
}

/** Retain a healthy owner-approved connection; terminal remotes require a fresh private generation. */
export class ExistingChromeConnection {
  private browser: Browser | null = null;
  private connecting: Promise<Browser> | null = null;
  private closed = false;
  private endpoint: string | null = null;
  private transport: RetainedChromeTransport | null = null;
  private endpointDiscovery: AbortController | null = null;
  private fileKey: string | null = null;
  private openTargetUrl: string | null = null;
  private selectedNodeUrl: string | null = null;
  private activeSessions = 0;
  private sourceWork = new Set<Promise<unknown>>();
  private sourceCleanupFailure = false;
  sourceWorkQuiescent(): boolean {
    return this.sourceWork.size === 0 && !this.sourceCleanupFailure;
  }
  private trackSourceWork<T>(pending: Promise<T>, failedCleanup: () => boolean): Promise<T> {
    this.sourceWork.add(pending);
    void pending.then(
      () => {
        this.sourceWork.delete(pending);
        return undefined;
      },
      () => {
        this.sourceWork.delete(pending);
        if (failedCleanup()) this.sourceCleanupFailure = true;
        return undefined;
      },
    );
    return pending;
  }
  hasSourceIntent(): boolean {
    return this.openTargetUrl !== null || this.selectedNodeUrl !== null;
  }
  sourceIntentQuiescent(): boolean {
    return !this.hasSourceIntent() || (!this.connecting && this.transport?.state() === 'connected');
  }
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
    if (options.selectNode && (!options.url || !parseFigmaTarget(options.url).nodeId))
      throw new Error('FIGMA_WEB_COPY_NODE_REQUIRED');
    const selectedNodeUrl =
      options.selectNode && options.url ? parseFigmaTarget(options.url).url : null;
    const endpoint = options.cdp ?? 'chrome';
    if (this.endpoint !== null && this.endpoint !== endpoint)
      throw new Error('CHROME_CONNECTION_ENDPOINT_CHANGED');
    const changeFile = this.fileKey !== requestedFileKey;
    const changeSelection = this.selectedNodeUrl !== selectedNodeUrl;
    // Root attachment is deliberately scoped, so a healthy socket does not discover new tabs.
    // On a new request, refresh only the local view when its selected page has disappeared.
    const refreshSource =
      !this.connecting &&
      this.browser?.isConnected() === true &&
      matchingFigmaPages(this.browser, requestedFileKey).length === 0;
    // The transport reads the opening intent while it initializes, so it must not change underneath it.
    if (
      (changeFile || changeSelection || refreshSource || openTargetUrl !== this.openTargetUrl) &&
      (this.connecting || this.activeSessions)
    )
      throw new Error('CHROME_SOURCE_BUSY: another source acquisition is active');
    this.fileKey = requestedFileKey;
    this.openTargetUrl = openTargetUrl;
    this.selectedNodeUrl = selectedNodeUrl;
    this.endpoint = endpoint;
    if (this.browser?.isConnected() === false) this.browser = null;
    if (
      changeFile ||
      changeSelection ||
      refreshSource ||
      this.connecting ||
      !this.browser ||
      this.transport?.state() === 'unavailable'
    ) {
      if (!this.connecting) {
        const pending = (async () => {
          if ((changeFile || changeSelection || refreshSource) && this.browser) {
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
          let connectionDeadlineAt: number | null = null;
          if (!this.transport) {
            const discovery = new AbortController();
            this.endpointDiscovery = discovery;
            let resolved: Awaited<ReturnType<typeof chromeEndpoint>>;
            try {
              resolved = await chromeEndpoint(options, discovery.signal);
            } finally {
              if (this.endpointDiscovery === discovery) this.endpointDiscovery = null;
            }
            connectionDeadlineAt = resolved.deadlineAt;
            if (this.closed) throw new Error('CHROME_CONNECTION_CLOSED');
            this.transport = await createRetainedChromeTransport(resolved.endpoint, {
              missingTargetUrl: () => this.openTargetUrl,
              selectedNodeUrl: () => this.selectedNodeUrl,
              matchesTarget: url => {
                try {
                  const target = parseFigmaTarget(url);
                  return this.fileKey === null || target.fileKey === this.fileKey;
                } catch {
                  return false;
                }
              },
            });
          }
          if (this.closed) {
            await this.transport.close();
            throw new Error('CHROME_CONNECTION_CLOSED');
          }
          const connectionTimeoutMs =
            connectionDeadlineAt === null
              ? (options.connectionTimeoutMs ?? 300_000)
              : connectionDeadlineAt - Date.now();
          if (connectionTimeoutMs <= 0)
            throw Object.assign(
              new Error(
                'CHROME_CONNECTION_REQUIRED: the original Chrome connection deadline expired during discovery',
              ),
              { code: 'CHROME_CONNECTION_REQUIRED' },
            );
          try {
            return await chromium.connectOverCDP(this.transport.endpoint, {
              timeout: connectionTimeoutMs,
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
            const code = initializedTransport
              ? 'CHROME_INITIALIZATION_TIMEOUT'
              : 'CHROME_CONNECTION_REQUIRED';
            throw Object.assign(
              new Error(
                initializedTransport
                  ? 'CHROME_INITIALIZATION_TIMEOUT: Chrome accepted the connection but Playwright could not finish browser initialization'
                  : 'CHROME_CONNECTION_REQUIRED: the existing Chrome connection is not ready',
                { cause },
              ),
              { code },
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
      let effectStarted = false;
      const selecting = this.trackSourceWork(
        selectExistingFigma(
          this.browser!,
          {
            ...options,
            beforeSourceEffect: () => {
              effectStarted = true;
              options.beforeSourceEffect?.();
            },
          },
          release,
        ),
        () => effectStarted,
      );
      const session = await waitLogically(selecting, signal, selected =>
        this.trackSourceWork(selected.close(), () => true),
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
    this.openTargetUrl = null;
    this.selectedNodeUrl = null;
    this.endpointDiscovery?.abort(new Error('CHROME_CONNECTION_CLOSED'));
    await this.transport?.close();
    const browser = this.browser ?? (await this.connecting?.catch(() => null));
    this.browser = null;
    if (browser) await browser.close();
  }
}

/** Availability probe only: never invoke a page API or treat its presence as capture acceptance. */
export async function probeFigmaWebRuntime(
  page: Page,
  target: Readonly<FigmaTarget>,
  options: { deadlineAt?: number; signal?: AbortSignal } = {},
) {
  const check = () => {
    options.signal?.throwIfAborted();
    if (parseFigmaTarget(page.url()).fileKey !== target.fileKey)
      throw new Error('BROWSER_TARGET_CHANGED');
  };
  check();
  const remaining = Math.min(5_000, (options.deadlineAt ?? Date.now() + 5_000) - Date.now());
  if (remaining <= 0) throw new Error('FIGMA_WEB_RUNTIME_TIMEOUT');
  const timeout = AbortSignal.timeout(remaining);
  const result = await waitLogically(
    page.evaluate(fileKey => {
      try {
        const value = (globalThis as unknown as Record<string, unknown>)['figma'];
        const api = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
        const currentPage = api?.['currentPage'];
        const pageId =
          currentPage && typeof currentPage === 'object'
            ? (currentPage as Record<string, unknown>)['id']
            : null;
        const available =
          typeof api?.['getNodeByIdAsync'] === 'function' && typeof pageId === 'string';
        const runtimeFileKey = api?.['fileKey'];
        const fileKeyMatches = runtimeFileKey === fileKey;
        const identityVerified = available && fileKeyMatches;
        return {
          available,
          identityVerified,
          fileKeyPresent: api !== null && 'fileKey' in api,
          fileKeyType: runtimeFileKey === null ? 'null' : typeof runtimeFileKey,
          fileKeyMatches,
          // Synchronous observations only. They do not prove stability across a full read.
          stableApiObject:
            api === null
              ? null
              : (globalThis as unknown as Record<string, unknown>)['figma'] === api,
          stablePageObject:
            !currentPage || typeof currentPage !== 'object'
              ? null
              : api?.['currentPage'] === currentPage,
          pageId: typeof pageId === 'string' && /^\d+:\d+$/u.test(pageId) ? pageId : null,
          reason: available ? 'candidate-api-only' : 'api-not-exposed',
          fullCapture: false,
        };
      } catch {
        return {
          available: false,
          identityVerified: false,
          fileKeyPresent: null,
          fileKeyType: null,
          fileKeyMatches: null,
          stableApiObject: null,
          stablePageObject: null,
          pageId: null,
          reason: 'runtime-unavailable',
          fullCapture: false,
        };
      }
    }, target.fileKey),
    options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  );
  check();
  return result;
}

export const observeFigmaPage = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  options: { deadlineAt?: number; signal?: AbortSignal } = {},
) => {
  const deadlineAt = options.deadlineAt ?? Date.now() + 5_000;
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadlineAt) throw new Error('FIGMA_OBSERVATION_TIMEOUT');
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    // Check before constructing the next RPC; an abandoned prior read may settle later.
    check();
    const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
    const result = await waitLogically(
      operation(),
      options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    );
    check();
    return result;
  };
  check();
  const url = page.url();
  let matches = false;
  try {
    matches = parseFigmaTarget(url).fileKey === target.fileKey;
  } catch {
    /* authentication route */
  }
  const login =
    (await read(() => page.getByRole('textbox', { name: /email|이메일/iu }).count())) > 0 ||
    /\/login(?:[/?]|$)/u.test(url);
  const blocked =
    (await read(() =>
      page.getByText(/request access|you need access|액세스 요청|접근 권한이 필요/iu).count(),
    )) > 0;
  const guest =
    (await read(() =>
      page.getByText(/댓글 달기, 편집, 검사|sign up.*(?:comment|inspect|edit)/iu).count(),
    )) > 0;
  // Figma hides its application focus target when screenreader support is disabled.
  // Require the rendered canvas as well so a hidden marker alone is not readiness.
  const app = page.getByRole('application', { name: /Figma/iu, includeHidden: true });
  const ready =
    matches &&
    (await read(() => app.count())) > 0 &&
    (await read(() => page.locator('canvas').filter({ visible: true }).count())) > 0 &&
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
    title: await read(() => page.title()),
    layers: ready
      ? (await read(() => page.getByRole('treegrid').allTextContents())).map(text =>
          text.slice(0, 30_000),
        )
      : [],
    pages: ready
      ? (await read(() => page.getByRole('grid').allTextContents())).map(text =>
          text.slice(0, 10_000),
        )
      : [],
    exactDesignValues: false,
  };
};
