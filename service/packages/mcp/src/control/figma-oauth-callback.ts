import { createServer, type Server } from 'node:http';

import type { OfficialFigmaOAuthCallbackLease } from '../official-figma-oauth.js';
import { figmaOAuthError } from './figma-oauth-contract.js';
import { assertApprovedLoopbackUri } from './figma-oauth-state.js';

/** Dedicated protocol continuation. No generic URL/body/diagnostic/activity middleware. */
export class FigmaOAuthCallbackListener {
  readonly #controller = new AbortController();
  #server: Server | undefined;
  #uri: URL;
  #closing = false;
  #close: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  private constructor(uri: URL) {
    this.#uri = uri;
  }
  static async bind(options: {
    redirectUri: string;
    deadlineAt: number;
    signal: AbortSignal;
    now?: () => number;
    onCallback: (rawUrl: string) => Promise<void>;
  }): Promise<FigmaOAuthCallbackListener> {
    const now = options.now ?? Date.now;
    const uri = assertApprovedLoopbackUri(options.redirectUri);
    if (options.signal.aborted || options.deadlineAt <= now())
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
    const listener = new FigmaOAuthCallbackListener(uri);
    const server = createServer(
      { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
      (request, response) => {
        response.setHeader('cache-control', 'no-store');
        response.setHeader('referrer-policy', 'no-referrer');
        response.setHeader(
          'content-security-policy',
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        response.setHeader('content-type', 'text/html; charset=utf-8');
        void (async () => {
          const hostCount = request.rawHeaders.filter(
            (value, index) => index % 2 === 0 && value.toLowerCase() === 'host',
          ).length;
          const raw = request.url ?? '';
          const peer = request.socket.remoteAddress;
          if (
            listener.#closing ||
            options.signal.aborted ||
            now() >= options.deadlineAt ||
            request.method !== 'GET' ||
            hostCount !== 1 ||
            request.headers.host !== uri.host ||
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') ||
            !raw.startsWith('/') ||
            raw.startsWith('//') ||
            Buffer.byteLength(raw) > 8192 ||
            raw.split('?')[0] !== uri.pathname ||
            request.headers['transfer-encoding'] !== undefined ||
            (request.headers['content-length'] !== undefined &&
              request.headers['content-length'] !== '0')
          ) {
            response.statusCode = 400;
            response.end(
              '<!doctype html><title>Callback rejected</title><p>This callback was rejected.</p>',
            );
            return;
          }
          try {
            listener.assertBound();
            // The only raw URL boundary is this private callback invocation. Never return or log it.
            await options.onCallback(uri.origin + raw);
            response.statusCode = 200;
            response.end(
              '<!doctype html><title>Figma authorization complete</title><p>Return to the service portal.</p>',
            );
            void listener.close().catch(() => {});
          } catch {
            response.statusCode = 400;
            response.end(
              '<!doctype html><title>Callback rejected</title><p>Check the service authorization status.</p>',
            );
          }
        })().catch(() => {
          if (!response.headersSent) response.statusCode = 400;
          response.end();
        });
      },
    );
    listener.#server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const closed = () => reject(figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED'));
        server.once('close', closed);
        server.once('error', reject);
        server.listen(
          {
            host: uri.hostname === '[::1]' ? '::1' : '127.0.0.1',
            port: Number(uri.port),
            exclusive: true,
            signal: options.signal,
          },
          () => {
            server.removeListener('close', closed);
            server.removeListener('error', reject);
            resolve();
          },
        );
      });
      listener.assertBound();
      if (options.signal.aborted || now() >= options.deadlineAt)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
      const abort = () => {
        void listener.close().catch(() => {});
      };
      options.signal.addEventListener('abort', abort, { once: true });
      server.once('close', () => options.signal.removeEventListener('abort', abort));
      server.on('error', () => {
        void listener.close().catch(() => {});
      });
      listener.#timer = setTimeout(abort, Math.max(1, options.deadlineAt - now()));
      listener.#timer.unref();
      return listener;
    } catch {
      await listener.close().catch(() => {});
      throw figmaOAuthError(
        options.signal.aborted ? 'FIGMA_MCP_OAUTH_CANCELLED' : 'FIGMA_MCP_OAUTH_PORT_UNAVAILABLE',
      );
    }
  }
  assertBound(): void {
    const address = this.#server?.address();
    if (
      this.#closing ||
      !this.#server?.listening ||
      !address ||
      typeof address === 'string' ||
      address.port !== Number(this.#uri.port) ||
      address.address !== (this.#uri.hostname === '[::1]' ? '::1' : '127.0.0.1')
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
  }
  lease(): OfficialFigmaOAuthCallbackLease {
    this.assertBound();
    return Object.freeze({
      redirectUri: this.#uri.href,
      assertBound: () => this.assertBound(),
      signal: this.#controller.signal,
    });
  }
  close(): Promise<void> {
    if (this.#close) return this.#close;
    this.#closing = true;
    clearTimeout(this.#timer);
    this.#controller.abort();
    const server = this.#server;
    this.#close = new Promise<void>((resolve, reject) => {
      if (!server?.listening) {
        resolve();
        return;
      }
      server.close(error =>
        error ? reject(figmaOAuthError('FIGMA_MCP_OAUTH_CALLBACK_REJECTED')) : resolve(),
      );
      server.closeIdleConnections();
      // Active callback response is allowed to settle, then connection closure proves retirement.
      const timer = setTimeout(() => server.closeAllConnections(), 1000);
      timer.unref();
      server.once('close', () => clearTimeout(timer));
    });
    return this.#close;
  }
}
