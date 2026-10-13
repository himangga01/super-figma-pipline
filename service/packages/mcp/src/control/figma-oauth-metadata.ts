import {
  discoverOAuthServerInfo,
  type FetchLike,
  type AuthorizationServerMetadata,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/client';

import { figmaOAuthError } from './figma-oauth-contract.js';

const RESOURCE = 'https://mcp.figma.com/mcp';
const METADATA_URLS = new Set([
  'https://mcp.figma.com/.well-known/oauth-protected-resource/mcp',
  'https://api.figma.com/.well-known/oauth-authorization-server',
]);
const TOKEN = 'https://api.figma.com/v1/oauth/token';
/** One captured budget covers request headers and the bounded body. Never follows redirects. */
export function boundedFigmaOAuthFetch(
  transport: FetchLike,
  options: {
    signal: AbortSignal;
    deadlineAt: number;
    now: () => number;
    purpose: 'metadata' | 'token';
  },
): FetchLike {
  return async (input, init) => {
    const destination = String(input),
      method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    if (options.signal.aborted || options.now() >= options.deadlineAt)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    if (
      options.purpose === 'metadata'
        ? !METADATA_URLS.has(destination) ||
          method !== 'GET' ||
          init?.body !== undefined ||
          headers.has('authorization') ||
          headers.has('cookie')
        : destination !== TOKEN || method !== 'POST' || headers.has('cookie')
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_DESTINATION_REJECTED');
    const controller = new AbortController();
    const signal = AbortSignal.any([
      options.signal,
      ...(init?.signal ? [init.signal] : []),
      controller.signal,
    ]);
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(15_000, options.deadlineAt - options.now())),
    );
    timer.unref();
    const active = () => {
      if (signal.aborted || options.now() >= options.deadlineAt)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    };
    const wait = async <T>(action: () => Promise<T>): Promise<T> => {
      active();
      let aborted!: () => void;
      try {
        const interruption = new Promise<never>((_, reject) => {
          aborted = () => reject(figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED'));
          signal.addEventListener('abort', aborted, { once: true });
        });
        const value = await Promise.race([action(), interruption]);
        active();
        return value;
      } finally {
        signal.removeEventListener('abort', aborted);
      }
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await wait(() =>
        transport(input, { ...init, method, headers, redirect: 'manual', signal }),
      );
      if (
        response.redirected ||
        response.headers.has('set-cookie') ||
        (response.url && response.url !== destination) ||
        (response.status >= 300 && response.status < 400) ||
        !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') ||
        !response.body
      )
        throw figmaOAuthError('FIGMA_MCP_OAUTH_METADATA_REJECTED');
      reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let bytes = 0;
      /* eslint-disable no-await-in-loop -- one bounded auth response */
      while (true) {
        const part = await wait(() => reader!.read());
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 65_536) throw figmaOAuthError('FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
        parts.push(part.value);
      }
      /* eslint-enable no-await-in-loop */
      active();
      return new Response(Buffer.concat(parts), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      throw figmaOAuthError(
        options.purpose === 'metadata'
          ? 'FIGMA_MCP_OAUTH_METADATA_REJECTED'
          : 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  };
}

export async function discoverFigmaOAuthMetadata(
  transport: FetchLike,
  bounds: { signal: AbortSignal; deadlineAt: number; now: () => number },
): Promise<{
  resourceMetadata: OAuthProtectedResourceMetadata;
  authorizationMetadata: AuthorizationServerMetadata;
}> {
  try {
    const info = await discoverOAuthServerInfo(RESOURCE, {
      fetchFn: boundedFigmaOAuthFetch(transport, { ...bounds, purpose: 'metadata' }),
    });
    if (
      !['https://api.figma.com', 'https://api.figma.com/'].includes(
        String(info.authorizationServerUrl),
      ) ||
      !info.resourceMetadata ||
      !info.authorizationServerMetadata
    )
      throw Error('invalid');
    return {
      resourceMetadata: info.resourceMetadata,
      authorizationMetadata: info.authorizationServerMetadata,
    };
  } catch {
    throw figmaOAuthError('FIGMA_MCP_OAUTH_METADATA_REJECTED');
  }
}
