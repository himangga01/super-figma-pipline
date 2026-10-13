import { createHash } from 'node:crypto';

import type { FetchLike } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  OfficialFigmaOAuthEngine,
  type OfficialFigmaOAuthConfiguration,
} from '../src/official-figma-oauth.js';

const OWNER = 'fixture-owner';
const SECRET = 'OWN_SECRET_CANARY:+/=';
const ACCESS = 'ACCESS_CANARY';
const REFRESH = 'REFRESH_CANARY';
const CODE = 'CODE_CANARY';
const ISSUER = 'https://api.figma.com';
const RESOURCE = 'https://mcp.figma.com/mcp';
const TOKEN = 'https://api.figma.com/v1/oauth/token';
const REDIRECT = 'http://127.0.0.1:41234/oauth/figma/callback';
const engines: OfficialFigmaOAuthEngine[] = [];
const config = (): OfficialFigmaOAuthConfiguration => ({
  client: {
    name: 'super-figma-pipeline',
    eligibility: 'operator-attested',
    clientId: 'sfp-fixture-client',
    clientSecret: SECRET,
    authenticationMethod: 'client_secret_basic',
    redirectUri: REDIRECT,
    redirectApproved: true,
  },
  resourceMetadata: {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: ['mcp:connect'],
  },
  authorizationMetadata: {
    issuer: ISSUER,
    authorization_endpoint: 'https://www.figma.com/oauth/mcp',
    token_endpoint: TOKEN,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:connect'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    authorization_response_iss_parameter_supported: true,
  },
  metadataValidUntil: 1_000_000,
});
const response = (
  data: unknown = {
    access_token: ACCESS,
    refresh_token: REFRESH,
    token_type: 'Bearer',
    expires_in: 60,
    scope: 'mcp:connect',
  },
  status = 200,
) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
};
function fixture(transport?: FetchLike) {
  let now = 1000,
    url: URL | undefined,
    bound = true;
  const fetch = vi.fn<FetchLike>(transport ?? (async () => response()));
  const handoff = vi.fn<(value: URL) => void>((value: URL) => {
    url = value;
  });
  const engine = new OfficialFigmaOAuthEngine({
    ownerId: OWNER,
    fetch,
    now: () => now,
    authorizationHandoff: handoff,
  });
  engines.push(engine);
  const configuration = config();
  const lease = {
    redirectUri: REDIRECT,
    assertBound: () => {
      if (!bound) throw Error('BOUND_SECRET_CANARY');
    },
  };
  return {
    engine,
    fetch,
    handoff,
    configuration,
    lease,
    advance: (value: number) => {
      now = value;
    },
    unbind: () => {
      bound = false;
    },
    begin: (signal?: AbortSignal, deadlineAt = 5000) =>
      engine.begin({ ownerId: OWNER, configuration, callback: lease, deadlineAt, signal }),
    authorization: () => url!,
    callback: () => {
      const callback = new URL(REDIRECT);
      callback.searchParams.set('state', url!.searchParams.get('state')!);
      callback.searchParams.set('code', CODE);
      callback.searchParams.set('iss', ISSUER);
      return callback;
    },
  };
}
beforeEach(() => {
  // No test can accidentally fall through to a live official or arbitrary HTTP destination.
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw Error('LIVE_HTTP_FORBIDDEN');
  });
});
afterEach(() => {
  for (const engine of engines.splice(0)) engine.logout(OWNER);
  if (vi.mocked(globalThis.fetch).mock.calls.length) throw Error('LIVE_HTTP_CALLED');
  vi.restoreAllMocks();
});

it.each(['client_secret_basic', 'client_secret_post'] as const)(
  'uses actual SDK S256 and one own-client token exchange with %s',
  async method => {
    const f = fixture();
    f.configuration.client.authenticationMethod = method;
    expect(await f.begin()).toMatchObject({
      stage: 'waiting-for-callback',
      sessionOnly: true,
      clientEligibility: 'operator-attested',
    });
    const authorization = f.authorization();
    expect(authorization.origin + authorization.pathname).toBe('https://www.figma.com/oauth/mcp');
    expect(authorization.searchParams.get('resource')).toBe(RESOURCE);
    expect(authorization.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(authorization.searchParams.get('scope')).toBe('mcp:connect');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(
      await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
    ).toMatchObject({ stage: 'authorized', code: null });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [destination, init] = f.fetch.mock.calls[0]!;
    const body = init!.body as URLSearchParams;
    expect(String(destination)).toBe(TOKEN);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(body.get('resource')).toBe(RESOURCE);
    expect(body.get('code')).toBe(CODE);
    expect(body.get('redirect_uri')).toBe(REDIRECT);
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
      authorization.searchParams.get('code_challenge'),
    );
    const headers = new Headers(init!.headers);
    const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    expect(headers.get('authorization')).toBe(
      method === 'client_secret_basic'
        ? 'Basic ' +
            Buffer.from(`${encode(f.configuration.client.clientId)}:${encode(SECRET)}`).toString(
              'base64',
            )
        : null,
    );
    expect(body.get('client_secret')).toBe(method === 'client_secret_post' ? SECRET : null);
    expect(f.engine.bearer(OWNER)).toBe(ACCESS);
    await expect(
      f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
    ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED' });
    expect(f.fetch).toHaveBeenCalledOnce();
  },
);

it.each([
  'eligibility',
  'name',
  'secret',
  'resource',
  'authorization-server',
  'issuer',
  'authorize',
  'token',
  'scope',
  'response-type',
  'grant',
  'pkce',
  'unsupported-none',
  'unsupported-secret-method',
  'expired-metadata',
  'redirect-unapproved',
  'redirect-remote',
  'redirect-alias',
  'redirect-query',
  'unbound-lease',
  'poisoned-metadata',
] as const)(
  'blocks malformed own-client configuration before handoff or network: %s',
  async kind => {
    const f = fixture();
    const c = f.configuration;
    const mutations: Record<typeof kind, () => void> = {
      eligibility: () => {
        Object.assign(c.client, { eligibility: 'unverified' });
      },
      name: () => {
        Object.assign(c.client, { name: 'another-approved-application' });
      },
      secret: () => {
        c.client.clientSecret = '';
      },
      resource: () => {
        c.resourceMetadata.resource = 'https://mcp.figma.com/other';
      },
      'authorization-server': () => {
        c.resourceMetadata.authorization_servers = ['https://attacker.invalid'];
      },
      issuer: () => {
        c.authorizationMetadata.issuer = 'https://attacker.invalid';
      },
      authorize: () => {
        c.authorizationMetadata.authorization_endpoint = 'https://attacker.invalid/authorize';
      },
      token: () => {
        c.authorizationMetadata.token_endpoint = 'https://attacker.invalid/token';
      },
      scope: () => {
        c.authorizationMetadata.scopes_supported = ['other'];
      },
      'response-type': () => {
        c.authorizationMetadata.response_types_supported = ['token'];
      },
      grant: () => {
        c.authorizationMetadata.grant_types_supported = ['refresh_token'];
      },
      pkce: () => {
        c.authorizationMetadata.code_challenge_methods_supported = ['plain'];
      },
      'unsupported-none': () => {
        Object.assign(c.client, { authenticationMethod: 'none' });
      },
      'unsupported-secret-method': () => {
        c.authorizationMetadata.token_endpoint_auth_methods_supported = ['client_secret_post'];
      },
      'expired-metadata': () => {
        c.metadataValidUntil = 1000;
      },
      'redirect-unapproved': () => {
        Object.assign(c.client, { redirectApproved: false });
      },
      'redirect-remote': () => {
        c.client.redirectUri = 'https://attacker.invalid/callback';
      },
      'redirect-alias': () => {
        c.client.redirectUri = 'http://localhost:41234/oauth/figma/callback';
      },
      'redirect-query': () => {
        c.client.redirectUri = REDIRECT + '?secret=CANARY';
      },
      'unbound-lease': () => {
        f.unbind();
      },
      'poisoned-metadata': () => {
        Object.defineProperty(c, 'authorizationMetadata', {
          get: () => {
            throw Error(SECRET);
          },
        });
      },
    };
    mutations[kind]();
    const error = await f.begin().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(f.engine.status()).toMatchObject({
      stage: 'blocked',
      clientEligibility: 'unconfigured',
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.handoff).not.toHaveBeenCalled();
    expect(String(error)).not.toContain(SECRET);
    expect(JSON.stringify(f.engine.status())).not.toContain('attacker');
  },
);

it('requires a new explicit configured begin after cancellation and never infers registration', async () => {
  const f = fixture();
  await expect(
    f.engine.begin({ ownerId: OWNER, callback: f.lease, deadlineAt: 5000 }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED' });
  await f.begin();
  const old = f.callback();
  f.engine.cancel(OWNER);
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  await f.begin();
  expect(f.authorization().searchParams.get('state')).not.toBe(old.searchParams.get('state'));
  await expect(f.engine.complete({ ownerId: OWNER, callbackUrl: old.href })).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_CALLBACK_REJECTED',
  });
  expect(f.fetch).not.toHaveBeenCalled();
});

it.each([
  'owner',
  'state',
  'duplicate-state',
  'duplicate-code',
  'issuer',
  'missing-issuer',
  'host',
  'path',
  'fragment',
  'unknown-query',
  'oversize',
] as const)(
  'rejects callback identity without consuming a valid pending transaction: %s',
  async kind => {
    const f = fixture();
    await f.begin();
    const bad = f.callback();
    const mutations: Record<typeof kind, () => void> = {
      owner: () => {},
      state: () => bad.searchParams.set('state', 'wrong'),
      'duplicate-state': () => bad.searchParams.append('state', bad.searchParams.get('state')!),
      'duplicate-code': () => bad.searchParams.append('code', CODE),
      issuer: () => bad.searchParams.set('iss', 'https://attacker.invalid'),
      'missing-issuer': () => bad.searchParams.delete('iss'),
      host: () => {
        bad.hostname = 'localhost';
      },
      path: () => {
        bad.pathname = '/other';
      },
      fragment: () => {
        bad.hash = 'private';
      },
      'unknown-query': () => bad.searchParams.set('extra', SECRET),
      oversize: () => bad.searchParams.set('code', 'x'.repeat(9000)),
    };
    mutations[kind]();
    await expect(
      f.engine.complete({
        ownerId: kind === 'owner' ? 'other-owner' : OWNER,
        callbackUrl: bad.href,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(
      await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
    ).toMatchObject({ stage: 'authorized' });
    expect(f.fetch).toHaveBeenCalledOnce();
  },
);

it.each(['invalid_client', 'unauthorized_client', 'invalid_grant', 'lost-response'] as const)(
  'never retries an exchanged code after %s',
  async kind => {
    const f = fixture(async () => {
      if (kind === 'lost-response')
        throw Object.assign(Error(SECRET + CODE), { code: 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED' });
      return response({ error: kind, error_description: SECRET + CODE }, 400);
    });
    await f.begin();
    const error = await f.engine
      .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED' });
    expect(String(error)).not.toContain(SECRET);
    expect(f.engine.status()).toMatchObject({
      stage: 'login-required',
      clientEligibility: 'unconfigured',
    });
    await expect(
      f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
    ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED' });
    expect(f.fetch).toHaveBeenCalledOnce();
  },
);

it.each(['cancel', 'logout', 'signal', 'deadline'] as const)(
  'fences a late exchange response and aborts actual fetch on %s',
  async action => {
    const gate = deferred<Response>(),
      entered = deferred<void>();
    let signal: AbortSignal | undefined;
    const f = fixture(async (_url, init) => {
      signal = init?.signal ?? undefined;
      entered.resolve();
      return gate.promise;
    });
    const cancel = new AbortController();
    await f.begin(cancel.signal);
    const completion = f.engine
      .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
      .catch((error: unknown) => error);
    await entered.promise;
    if (action === 'cancel') f.engine.cancel(OWNER);
    if (action === 'logout') f.engine.logout(OWNER);
    if (action === 'signal') cancel.abort(Error(SECRET));
    if (action === 'deadline') {
      f.advance(5000);
      f.engine.status();
    }
    const error = await completion;
    gate.resolve(response());
    await Promise.resolve();
    expect(error).toBeInstanceOf(Error);
    expect(signal?.aborted).toBe(true);
    expect(f.engine.bearer(OWNER)).toBeUndefined();
    expect(f.engine.status().stage).toBe(
      action === 'logout' ? 'logged-out' : action === 'deadline' ? 'expired' : 'cancelled',
    );
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(error)).not.toContain(SECRET);
  },
);

it('consumes a callback before the first asynchronous exchange and excludes concurrent begin or completion', async () => {
  const gate = deferred<Response>(),
    entered = deferred<void>();
  const f = fixture(async () => {
    entered.resolve();
    return gate.promise;
  });
  await f.begin();
  const completion = f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  await entered.promise;
  await expect(f.begin()).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_BUSY' });
  await expect(
    f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED' });
  gate.resolve(response());
  expect(await completion).toMatchObject({ stage: 'authorized' });
  expect(f.fetch).toHaveBeenCalledOnce();
});

it('pins copied metadata and callback identity and does not read caller mutations during exchange', async () => {
  const f = fixture();
  await f.begin();
  f.configuration.authorizationMetadata.token_endpoint = 'https://attacker.invalid/token';
  f.configuration.resourceMetadata.resource = 'https://attacker.invalid/mcp';
  f.configuration.client.clientSecret = 'REPLACED_SECRET';
  f.lease.redirectUri = 'http://127.0.0.1:9999/other';
  expect(await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href })).toMatchObject(
    { stage: 'authorized' },
  );
  expect(String(f.fetch.mock.calls[0]![0])).toBe(TOKEN);
});

it('rejects an unbound callback lease and consumes a valid denial without sending a code', async () => {
  const f = fixture();
  await f.begin();
  f.unbind();
  await expect(
    f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CALLBACK_REJECTED' });
  f.engine.cancel(OWNER);
  const second = fixture();
  await second.begin();
  const denial = second.callback();
  denial.searchParams.delete('code');
  denial.searchParams.set('error', 'access_denied');
  await expect(
    second.engine.complete({ ownerId: OWNER, callbackUrl: denial.href }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CONSENT_DENIED' });
  expect(second.fetch).not.toHaveBeenCalled();
  expect(second.engine.bearer(OWNER)).toBeUndefined();
});

it.each([
  'redirect',
  'changed-response-url',
  'oversize-body',
  'wrong-content-type',
  'missing-expiry',
  'wrong-scope',
  'invalid-bearer',
] as const)('rejects untrusted token responses without publishing credentials: %s', async kind => {
  const f = fixture(async () => {
    if (kind === 'redirect')
      return new Response('', { status: 302, headers: { location: 'https://attacker.invalid' } });
    if (kind === 'changed-response-url') {
      const value = response();
      Object.defineProperty(value, 'url', { value: 'https://attacker.invalid/token' });
      return value;
    }
    if (kind === 'oversize-body') return response({ access_token: 'x'.repeat(70_000) });
    if (kind === 'wrong-content-type')
      return new Response(SECRET, { headers: { 'content-type': 'text/plain' } });
    if (kind === 'missing-expiry') return response({ access_token: ACCESS, token_type: 'Bearer' });
    if (kind === 'invalid-bearer')
      return response({ access_token: 'nonASCII_\u00e9', token_type: 'Bearer', expires_in: 60 });
    return response({ access_token: ACCESS, token_type: 'Bearer', expires_in: 60, scope: 'other' });
  });
  await f.begin();
  const error = await f.engine
    .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
    .catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(String(error)).not.toContain(SECRET);
});

it('rotates refresh tokens once, rejects concurrent refresh and invalidates the published generation', async () => {
  const gate = deferred<Response>(),
    entered = deferred<void>();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls === 1) return response();
    if (calls === 2) {
      entered.resolve();
      return gate.promise;
    }
    return response({ access_token: 'FINAL_ACCESS', token_type: 'Bearer', expires_in: 60 });
  });
  await f.begin();
  await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  const initialGeneration = f.engine.status().generation;
  const refreshing = f.engine.refresh({ ownerId: OWNER, deadlineAt: 5000 });
  await entered.promise;
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  await expect(f.engine.refresh({ ownerId: OWNER, deadlineAt: 5000 })).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_BUSY',
  });
  gate.resolve(
    response({
      access_token: 'ROTATED_ACCESS',
      refresh_token: 'ROTATED_REFRESH',
      token_type: 'Bearer',
      expires_in: 60,
    }),
  );
  expect(await refreshing).toMatchObject({ stage: 'authorized' });
  expect(f.engine.status().generation).toBeGreaterThan(initialGeneration);
  await f.engine.refresh({ ownerId: OWNER, deadlineAt: 5000 });
  expect((f.fetch.mock.calls[2]![1]!.body as URLSearchParams).get('refresh_token')).toBe(
    'ROTATED_REFRESH',
  );
  expect(f.engine.bearer(OWNER)).toBe('FINAL_ACCESS');
});

it.each(['logout', 'cancel', 'deadline', 'lost-response'] as const)(
  'retires old tokens and prevents a stale refresh publication on %s',
  async action => {
    const gate = deferred<Response>(),
      entered = deferred<void>();
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      if (calls === 1) return response();
      entered.resolve();
      if (action === 'lost-response') throw Error(REFRESH);
      return gate.promise;
    });
    await f.begin();
    await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
    const refresh = f.engine
      .refresh({ ownerId: OWNER, deadlineAt: 5000 })
      .catch((error: unknown) => error);
    await entered.promise;
    if (action === 'logout') f.engine.logout(OWNER);
    if (action === 'cancel') f.engine.cancel(OWNER);
    if (action === 'deadline') {
      f.advance(5000);
      f.engine.status();
    }
    const error = await refresh;
    gate.resolve(response());
    await Promise.resolve();
    expect(error).toBeInstanceOf(Error);
    expect(f.engine.bearer(OWNER)).toBeUndefined();
    expect(String(error)).not.toContain(REFRESH);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  },
);

it('clears secrets on expiry, never automatically refreshes a bearer and cannot be controlled by another owner', async () => {
  const f = fixture();
  await f.begin();
  await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  expect(() => f.engine.logout('other-owner')).toThrow('FIGMA_MCP_OAUTH_OWNER_MISMATCH');
  expect(() => f.engine.bearer('other-owner')).toThrow('FIGMA_MCP_OAUTH_OWNER_MISMATCH');
  f.advance(61_000);
  expect(f.engine.status()).toMatchObject({
    stage: 'expired',
    clientEligibility: 'unconfigured',
    expiresAt: null,
  });
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  await expect(f.engine.refresh({ ownerId: OWNER, deadlineAt: 70_000 })).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_TOKEN_REQUIRED',
  });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(JSON.stringify(f.engine)).toBe('{}');
  const status = JSON.stringify(f.engine.status());
  for (const secret of [SECRET, ACCESS, REFRESH, CODE, f.authorization().href])
    expect(status).not.toContain(secret);
});

it('rejects a precancelled begin without a consent URL and keeps its original callback deadline', async () => {
  const f = fixture(),
    cancel = new AbortController();
  cancel.abort(Error(SECRET));
  await expect(f.begin(cancel.signal)).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
  expect(f.engine.status()).toMatchObject({
    stage: 'cancelled',
    clientEligibility: 'unconfigured',
  });
  expect(f.handoff).not.toHaveBeenCalled();
  await f.begin();
  f.advance(5000);
  await expect(
    f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED' });
  expect(f.fetch).not.toHaveBeenCalled();
});

it('bounds a stalled response body with the original wall-clock timer and aborts the actual request', async () => {
  const entered = deferred<void>();
  let signal: AbortSignal | undefined,
    cancelled = false;
  const f = fixture(async (_url, init) => {
    signal = init?.signal ?? undefined;
    entered.resolve();
    return new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  await f.begin(undefined, 1100);
  const complete = f.engine
    .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
    .catch((error: unknown) => error);
  await entered.promise;
  expect(await complete).toMatchObject({ code: 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED' });
  await Promise.resolve();
  expect(signal?.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  expect(f.fetch).toHaveBeenCalledOnce();
});

it('retires a delayed private handoff and cannot let it overwrite a subsequent explicit begin', async () => {
  const entered = deferred<void>(),
    gate = deferred<void>();
  let delivered: URL | undefined,
    handoffs = 0;
  const fetch = vi.fn<FetchLike>(async () => response());
  const engine = new OfficialFigmaOAuthEngine({
    ownerId: OWNER,
    fetch,
    now: () => 1000,
    authorizationHandoff: async url => {
      delivered = url;
      handoffs++;
      if (handoffs === 1) {
        entered.resolve();
        await gate.promise;
      }
    },
  });
  engines.push(engine);
  const begin = () =>
    engine.begin({
      ownerId: OWNER,
      configuration: config(),
      callback: { redirectUri: REDIRECT, assertBound: () => {} },
      deadlineAt: 5000,
    });
  const old = begin().catch((error: unknown) => error);
  await entered.promise;
  const oldState = delivered!.searchParams.get('state');
  engine.cancel(OWNER);
  expect(await begin()).toMatchObject({ stage: 'waiting-for-callback' });
  const currentState = delivered!.searchParams.get('state');
  gate.resolve();
  expect(await old).toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
  expect(currentState).not.toBe(oldState);
  expect(engine.status()).toMatchObject({ stage: 'waiting-for-callback', code: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('does not re-publish an old exchanged token after a new explicit owner transaction', async () => {
  const entered = deferred<void>(),
    gate = deferred<Response>();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls === 1) {
      entered.resolve();
      return gate.promise;
    }
    return response({ access_token: 'NEW_SESSION_ACCESS', token_type: 'Bearer', expires_in: 60 });
  });
  await f.begin();
  const old = f.engine
    .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
    .catch((error: unknown) => error);
  await entered.promise;
  f.engine.cancel(OWNER);
  await f.begin();
  await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  gate.resolve(response());
  expect(await old).toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
  expect(f.engine.bearer(OWNER)).toBe('NEW_SESSION_ACCESS');
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

it('cannot publish beyond the metadata freshness bound or the original refresh token expiry', async () => {
  const f = fixture();
  f.configuration.metadataValidUntil = 2000;
  await f.begin();
  await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  expect(f.engine.status().expiresAt).toBe(2000);
  f.advance(2000);
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  const gate = deferred<Response>(),
    entered = deferred<void>();
  let calls = 0;
  const second = fixture(async () => {
    calls++;
    if (calls === 1)
      return response({
        access_token: ACCESS,
        refresh_token: REFRESH,
        token_type: 'Bearer',
        expires_in: 1,
      });
    entered.resolve();
    return gate.promise;
  });
  await second.begin();
  await second.engine.complete({ ownerId: OWNER, callbackUrl: second.callback().href });
  const refresh = second.engine
    .refresh({ ownerId: OWNER, deadlineAt: 5000 })
    .catch((error: unknown) => error);
  await entered.promise;
  second.advance(2000);
  second.engine.status();
  gate.resolve(response());
  expect(await refresh).toMatchObject({ code: 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED' });
  expect(second.engine.bearer(OWNER)).toBeUndefined();
});

it('does not leak raw handoff errors, caller cancellation reasons or incomplete credentials through public objects', async () => {
  const engine = new OfficialFigmaOAuthEngine({
    ownerId: OWNER,
    fetch: async () => response(),
    now: () => 1000,
    authorizationHandoff: () => {
      throw Object.assign(Error(SECRET + CODE), { code: 'FORGED_CODE_' + SECRET });
    },
  });
  engines.push(engine);
  const error = await engine
    .begin({
      ownerId: OWNER,
      configuration: config(),
      callback: { redirectUri: REDIRECT, assertBound: () => {} },
      deadlineAt: 5000,
    })
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: 'FIGMA_MCP_OAUTH_HANDOFF_FAILED' });
  expect(String(error)).not.toContain(SECRET);
  expect(JSON.stringify(error)).not.toContain(CODE);
  expect(JSON.stringify(engine.status())).not.toContain(SECRET);
  expect(JSON.stringify(engine)).toBe('{}');
});

it('keeps a precancelled refresh terminal and makes no second token request', async () => {
  const f = fixture();
  await f.begin();
  await f.engine.complete({ ownerId: OWNER, callbackUrl: f.callback().href });
  const cancel = new AbortController();
  cancel.abort(Error(SECRET));
  await expect(
    f.engine.refresh({ ownerId: OWNER, deadlineAt: 5000, signal: cancel.signal }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
  expect(f.engine.status()).toMatchObject({
    stage: 'cancelled',
    clientEligibility: 'unconfigured',
  });
  expect(f.engine.bearer(OWNER)).toBeUndefined();
  expect(f.fetch).toHaveBeenCalledOnce();
});

it('settles begin on a validated callback while its private handoff is still held', async () => {
  const entered = deferred<void>(),
    gate = deferred<void>();
  let delivered: URL | undefined;
  const fetch = vi.fn<FetchLike>(async () => response());
  const engine = new OfficialFigmaOAuthEngine({
    ownerId: OWNER,
    fetch,
    now: () => 1000,
    authorizationHandoff: async url => {
      delivered = url;
      entered.resolve();
      await gate.promise;
    },
  });
  engines.push(engine);
  const begin = engine.begin({
    ownerId: OWNER,
    configuration: config(),
    callback: { redirectUri: REDIRECT, assertBound: () => {} },
    deadlineAt: 5000,
  });
  await entered.promise;
  const callback = new URL(REDIRECT);
  callback.searchParams.set('state', delivered!.searchParams.get('state')!);
  callback.searchParams.set('code', CODE);
  callback.searchParams.set('iss', ISSUER);
  expect(await engine.complete({ ownerId: OWNER, callbackUrl: callback.href })).toMatchObject({
    stage: 'authorized',
  });
  expect(await begin).toMatchObject({ stage: 'authorized' });
  gate.resolve();
  await Promise.resolve();
  expect(engine.status()).toMatchObject({ stage: 'authorized', code: null });
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not trust a retained public factory error rethrown by an untrusted transport or expose modified fields', async () => {
  let retained: unknown;
  const f = fixture(async () => {
    throw retained;
  });
  retained = await f.engine
    .begin({ ownerId: OWNER, callback: f.lease, deadlineAt: 5000 })
    .catch((error: unknown) => error);
  Reflect.set(retained as object, 'message', SECRET);
  Reflect.set(retained as object, 'code', 'FORGED_' + SECRET);
  await f.begin();
  const error = await f.engine
    .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
    .catch((value: unknown) => value);
  expect(String(error)).not.toContain(SECRET);
  expect(JSON.stringify(f.engine.status())).not.toContain(SECRET);
  expect(error).toMatchObject({ code: 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED' });
  expect(Object.isFrozen(retained)).toBe(true);
  expect(f.fetch).toHaveBeenCalledOnce();
});

it('seals the native Error stack accessor and classifies retained public errors from a real response body as external', async () => {
  let retained: unknown;
  const f = fixture(async () => response());
  retained = await f.engine
    .begin({ ownerId: OWNER, callback: f.lease, deadlineAt: 5000 })
    .catch((error: unknown) => error);
  Reflect.set(retained as object, 'stack', SECRET + CODE);
  f.fetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(retained);
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await f.begin();
  const error = await f.engine
    .complete({ ownerId: OWNER, callbackUrl: f.callback().href })
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED' });
  expect((error as Error).stack).not.toContain(SECRET);
  const descriptor = Object.getOwnPropertyDescriptor(retained, 'stack');
  expect(descriptor).toMatchObject({ writable: false, configurable: false });
  expect(descriptor?.set).toBeUndefined();
  expect(f.engine.status()).toMatchObject({
    stage: 'login-required',
    code: 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
  });
  expect(f.fetch).toHaveBeenCalledOnce();
});
