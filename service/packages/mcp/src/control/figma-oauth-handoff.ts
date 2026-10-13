import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ActorContext } from '@sfp/shared';

import { FigmaOAuthCodeSchema, figmaOAuthError } from './figma-oauth-contract.js';
import type { FigmaOAuthProvider } from './figma-oauth-provider.js';

/** Called only behind the daemon's existing authenticated owner-control HTTP seam. */
export function createFigmaOAuthHandoffHttpHandler(options: {
  provider: FigmaOAuthProvider;
  principalForRequest: (request: IncomingMessage) => Promise<Readonly<ActorContext>>;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = (request.url ?? '').split('?')[0];
    if (pathname !== '/control/figma-mcp/auth/handoff') return false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    const closed = () => {
      if (!response.writableEnded) abort();
    };
    response.once('close', closed);
    const timer = setTimeout(() => {
      abort();
      request.destroy();
    }, 20_000);
    timer.unref();
    try {
      if (
        request.method !== 'POST' ||
        request.url !== pathname ||
        !/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '') ||
        Number(request.headers['content-length'] ?? 0) > 2048
      )
        throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
      const principal = await options.principalForRequest(request);
      let count = 0;
      const parts: Uint8Array[] = [];
      for await (const chunk of request) {
        if (controller.signal.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
        const bytes = Buffer.from(chunk);
        count += bytes.length;
        if (count > 2048) throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
        parts.push(bytes);
      }
      if (controller.signal.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
      }
      options.provider.handoff(principal, input, controller.signal, url => {
        if (
          controller.signal.aborted ||
          response.destroyed ||
          url.origin !== 'https://www.figma.com' ||
          url.pathname !== '/oauth/mcp' ||
          url.username ||
          url.password ||
          url.hash
        )
          throw figmaOAuthError('FIGMA_MCP_OAUTH_HANDOFF_FAILED');
        // URI is exclusively a private response header, never typed route JSON/body/stdout/audit.
        response.writeHead(303, {
          location: url.href,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-length': '0',
        });
        response.end();
      });
    } catch (error) {
      let code = 'FIGMA_MCP_OAUTH_INPUT_INVALID';
      try {
        const parsed = FigmaOAuthCodeSchema.safeParse((error as { code?: unknown })?.code);
        if (parsed.success) code = parsed.data;
      } catch {
        /* Closed response. */
      }
      if (!response.headersSent && !response.destroyed) {
        const bytes = Buffer.from(JSON.stringify({ code }));
        response.writeHead(409, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'content-length': String(bytes.length),
        });
        response.end(bytes);
      }
    } finally {
      clearTimeout(timer);
      request.removeListener('aborted', abort);
      response.removeListener('close', closed);
    }
    return true;
  };
}
