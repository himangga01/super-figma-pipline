import { hashActionRequest, type ActorContext } from '@sfp/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { createNetworkDomainEndpoints } from '../../src/control/network-domain-endpoints.js';
import { registerTask8BNetworkRoutes } from '../../src/control/route-registry.js';
import {
  AuthenticatedControlRouter,
  createControlHttpHandler,
  createLazyControlHttpHandler,
} from '../../src/control/router.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

describe('authenticated control router', () => {
  it('rejects ambiguous dynamic siblings regardless of parameter names', () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'first.dynamic',
      method: 'GET',
      path: '/control/items/:first',
      routeClass: 'admin',
      inputSchema: z.object({ first: z.string() }).strict(),
      outputSchema: z.string(),
      handle: async () => 'first',
    });

    expect(() =>
      router.register({
        id: 'second.dynamic',
        method: 'GET',
        path: '/control/items/:second',
        routeClass: 'admin',
        inputSchema: z.object({ second: z.string() }).strict(),
        outputSchema: z.string(),
        handle: async () => 'second',
      }),
    ).toThrowError(expect.objectContaining({ code: 'CONTROL_ROUTE_DUPLICATE' }));
  });

  it('rejects an unvalidated public output schema at registration', () => {
    const router = new AuthenticatedControlRouter();
    expect(() =>
      router.register({
        id: 'unknown.output',
        method: 'GET',
        path: '/control/unknown-output',
        routeClass: 'admin',
        inputSchema: z.object({}).strict(),
        outputSchema: z.unknown(),
        handle: async () => ({ secret: true }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'CONTROL_ROUTE_INVALID' }));
  });

  it('rejects async output instead of bypassing the declared decoder', async () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'async.output',
      method: 'GET',
      path: '/control/async-output',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.string(),
      handle: async function* () {
        yield 'unvalidated';
      },
    });
    router.freeze();

    await expect(
      router.dispatch(
        { method: 'GET', path: '/control/async-output', input: {} },
        principal,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_ROUTE_OUTPUT_INVALID' });
  });

  it.each([null, [], 'scalar', 1])('rejects non-object JSON body %j', async bodyInput => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'strict.body',
      method: 'POST',
      path: '/control/strict-body',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.literal('ok'),
      handle: async () => 'ok' as const,
    });
    router.freeze();
    const handler = createControlHttpHandler({
      router,
      principalForRequest: async () => principal,
    });
    const observed = await callHttpHandler(handler, {
      method: 'POST',
      url: '/control/strict-body',
      body: JSON.stringify(bodyInput),
    });

    expect(observed.status).toBe(400);
    expect(observed.body).toContain('CONTROL_ROUTE_INPUT_INVALID');
  });

  it('rejects a logical control path above 9437184 bytes before route lookup', async () => {
    const router = new AuthenticatedControlRouter();
    router.freeze();

    await expect(
      router.dispatch(
        { method: 'GET', path: `/control/${'a'.repeat(9_437_176)}`, input: {} },
        principal,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_REQUEST_TOO_LARGE' });
  });

  it('replaces an oversized response with a bounded typed error', async () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'large.response',
      method: 'GET',
      path: '/control/large-response',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.string(),
      handle: async () => 'x'.repeat(9_437_185),
    });
    router.freeze();
    const handler = createControlHttpHandler({
      router,
      principalForRequest: async () => principal,
    });
    const observed = await callHttpHandler(handler, {
      method: 'GET',
      url: '/control/large-response',
    });

    expect(observed.status).toBe(500);
    expect(observed.body).toBe('{"code":"CONTROL_RESPONSE_TOO_LARGE"}');
  });

  it('does not initialize durable control authorities before the first authenticated request', async () => {
    let initializations = 0;
    const lazy = createLazyControlHttpHandler(async () => {
      initializations += 1;
      return async () => true;
    });

    expect(initializations).toBe(0);
    await Promise.all([lazy({} as never, {} as never), lazy({} as never, {} as never)]);
    expect(initializations).toBe(1);
  });

  it('prefers an exact sibling over an earlier dynamic route', async () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'workspace.remove',
      method: 'DELETE',
      path: '/control/workspaces/:workspaceId',
      routeClass: 'admin',
      inputSchema: z.object({ workspaceId: z.string() }).strict(),
      outputSchema: z.literal('dynamic'),
      handle: async () => 'dynamic' as const,
    });
    router.register({
      id: 'workspace.clear-default',
      method: 'DELETE',
      path: '/control/workspaces/default',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.literal('exact'),
      handle: async () => 'exact' as const,
    });
    router.freeze();

    await expect(
      router.dispatch(
        { method: 'DELETE', path: '/control/workspaces/default', input: {} },
        principal,
        new AbortController().signal,
      ),
    ).resolves.toBe('exact');
  });

  it('returns a bounded JSON null for a successful void mutation', async () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'void.delete',
      method: 'DELETE',
      path: '/control/void',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.undefined(),
      handle: async () => undefined,
    });
    router.freeze();
    const handler = createControlHttpHandler({
      router,
      principalForRequest: async () => principal,
    });
    let status = 0;
    let body = '';
    const request = {
      method: 'DELETE',
      url: '/control/void',
      headers: {},
      async *[Symbol.asyncIterator]() {},
    };
    const response = {
      writeHead: (nextStatus: number) => {
        status = nextStatus;
      },
      end: (value: Uint8Array) => {
        body = Buffer.from(value).toString('utf8');
      },
    };

    await handler(request as never, response as never);

    expect({ status, body }).toEqual({ status: 200, body: 'null' });
  });

  it('accepts a network-domain DELETE nonce only from its single header', async () => {
    const router = networkDomainDeleteRouter();
    const handler = createControlHttpHandler({
      router,
      principalForRequest: async () => principal,
    });
    const actionNonce = `sfp_an1_${'A'.repeat(43)}`;

    const observed = await callHttpHandler(handler, {
      method: 'DELETE',
      url: '/control/network/domains/assets.example.com',
      headers: { 'x-sfp-action-nonce': actionNonce },
    });

    expect(observed).toEqual({
      status: 200,
      body: JSON.stringify({ fqdn: 'assets.example.com', actionNonce }),
    });
  });

  it.each([
    {
      name: 'empty JSON object body',
      url: '/control/network/domains/assets.example.com',
      body: '{}',
      headers: { 'x-sfp-action-nonce': `sfp_an1_${'A'.repeat(43)}` },
    },
    {
      name: 'body-only nonce',
      url: '/control/network/domains/assets.example.com',
      body: JSON.stringify({ actionNonce: `sfp_an1_${'A'.repeat(43)}` }),
      headers: {},
    },
    {
      name: 'body and header conflict',
      url: '/control/network/domains/assets.example.com',
      body: JSON.stringify({ actionNonce: `sfp_an1_${'B'.repeat(43)}` }),
      headers: { 'x-sfp-action-nonce': `sfp_an1_${'A'.repeat(43)}` },
    },
    {
      name: 'query alias',
      url: `/control/network/domains/assets.example.com?actionNonce=sfp_an1_${'A'.repeat(43)}`,
      headers: { 'x-sfp-action-nonce': `sfp_an1_${'A'.repeat(43)}` },
    },
    {
      name: 'duplicate header',
      url: '/control/network/domains/assets.example.com',
      headers: {
        'x-sfp-action-nonce': [`sfp_an1_${'A'.repeat(43)}`, `sfp_an1_${'B'.repeat(43)}`],
      },
    },
  ])('rejects network-domain DELETE nonce provenance: $name', async input => {
    const router = networkDomainDeleteRouter();
    const handler = createControlHttpHandler({
      router,
      principalForRequest: async () => principal,
    });

    const observed = await callHttpHandler(handler, {
      method: 'DELETE',
      url: input.url,
      ...(input.body === undefined ? {} : { body: input.body }),
      headers: input.headers,
    });

    expect(observed.status).toBe(400);
    expect(observed.body).toBe('{"code":"CONTROL_ROUTE_INPUT_INVALID"}');
  });

  it.each([
    {
      name: 'query conflict',
      url: '/control/network/domains?fqdn=cdn.example.com',
      headers: {},
    },
    {
      name: 'scalar header alias',
      url: '/control/network/domains',
      headers: { 'x-sfp-action-nonce': `sfp_an1_${'B'.repeat(43)}` },
    },
    {
      name: 'array header alias',
      url: '/control/network/domains',
      headers: {
        'x-sfp-action-nonce': [`sfp_an1_${'B'.repeat(43)}`, `sfp_an1_${'C'.repeat(43)}`],
      },
    },
  ])('rejects network-domain POST nonce provenance: $name', async input => {
    const handler = createControlHttpHandler({
      router: networkDomainPostRouter(),
      principalForRequest: async () => principal,
    });

    const observed = await callHttpHandler(handler, {
      method: 'POST',
      url: input.url,
      body: JSON.stringify({
        fqdn: 'assets.example.com',
        actionNonce: `sfp_an1_${'A'.repeat(43)}`,
      }),
      headers: input.headers,
    });

    expect(observed).toEqual({
      status: 400,
      body: '{"code":"CONTROL_ROUTE_INPUT_INVALID"}',
    });
  });

  it.each([
    ['REMOTE_DOMAIN_ALREADY_EXISTS', 409],
    ['REMOTE_DOMAIN_CAS_MISMATCH', 409],
    ['REMOTE_DOMAIN_NOT_FOUND', 404],
    ['REMOTE_DOMAIN_CAPACITY_EXCEEDED', 409],
    ['REMOTE_DOMAIN_TEMP_LIMIT_EXCEEDED', 409],
    ['OPERATION_CANCELLED', 409],
    ['ADMIN_AUDIT_QUERY_INVALID', 400],
    ['APPROVAL_CONTROL_SESSION_MISMATCH', 400],
    ['APPROVAL_GENERATION_MISMATCH', 400],
    ['APPROVAL_HASH_MISMATCH', 400],
    ['APPROVAL_ID_INVALID', 400],
    ['APPROVAL_RESUME_INVALID', 400],
    ['APPROVAL_SESSION_MISMATCH', 400],
    ['APPROVAL_TARGET_MISMATCH', 400],
    ['APPROVAL_TERMINAL_INVALID', 400],
    ['CANCEL_AUTH_SESSION_MISMATCH', 400],
    ['DEMOTION_TICKET_INVALID', 400],
    ['EVIDENCE_FINALIZER_MISMATCH', 400],
    ['EXECUTION_PLANE_ALREADY_BOUND', 409],
    ['INVOCATION_CONSENT_INVALID', 400],
    ['INVOCATION_ORIGIN_INVALID', 400],
    ['INVOCATION_PRINCIPAL_INVALID', 400],
    ['INVOCATION_WORKSPACE_INVALID', 400],
    ['LEADER_GENERATION_CLOSE_TIMEOUT_INVALID', 400],
    ['OPERATION_EVIDENCE_INVALID', 400],
    ['OPERATION_ID_REQUIRED', 400],
    ['OPERATION_RESOLUTION_CONFIRMATION_INVALID', 400],
    ['POLICY_WORKSPACE_REQUIRED', 400],
    ['PRE_EGRESS_TERMINAL_INVALID', 400],
    ['REMOTE_CONTENT_LENGTH_INVALID', 400],
    ['REMOTE_CONTENT_LENGTH_MISMATCH', 400],
    ['REMOTE_DNS_ANSWER_INVALID', 400],
    ['REMOTE_HEADERS_INVALID', 400],
    ['REMOTE_MIME_INVALID', 400],
    ['REMOTE_POLICY_INVALID', 400],
    ['REMOTE_REDIRECT_INVALID', 400],
    ['REMOTE_SIGNATURE_INVALID', 400],
    ['REMOTE_STATUS_INVALID', 400],
    ['REMOTE_TIMEOUTS_INVALID', 400],
    ['REMOTE_URL_INVALID', 400],
    ['SNAPSHOT_AUTHORITY_MISMATCH', 400],
    ['TARGET_ALREADY_EXISTS', 409],
    ['WORKSPACE_REQUIRED', 400],
    ['REMOTE_DOMAIN_NOT_FOUND_ALREADY', 500],
    ['REMOTE_DOMAIN_FUTURE_INVALID', 500],
    ['REMOTE_FQDN_FUTURE_INVALID', 500],
    ['PLUGIN_SECRET_INVALID', 500],
    ['SECRET_ALREADY', 500],
    ['SECRET_CAS_MISMATCH', 500],
    ['OPERATION_SECRET_INVALID', 500],
    ['REMOTE_SECRET_INVALID', 500],
    ['INVOCATION_SECRET_REQUIRED', 500],
    ['UNKNOWN_FAILURE', 500],
    ['toString', 500],
  ] as const)(
    'maps exact public error %s to HTTP %s without substring expansion',
    async (code, status) => {
      const router = new AuthenticatedControlRouter();
      router.register({
        id: 'error.projection',
        method: 'GET',
        path: '/control/error-projection',
        routeClass: 'admin',
        inputSchema: z.object({}).strict(),
        outputSchema: z.undefined(),
        handle: async () => {
          throw Object.assign(new Error('projected'), { code });
        },
      });
      router.freeze();
      const handler = createControlHttpHandler({
        router,
        principalForRequest: async () => principal,
      });

      const observed = await callHttpHandler(handler, {
        method: 'GET',
        url: '/control/error-projection',
      });

      expect(observed).toEqual({ status, body: JSON.stringify({ code }) });
    },
  );

  it('dispatches sibling routes after one freeze and rejects duplicate method/path', async () => {
    const router = new AuthenticatedControlRouter();
    router.register({
      id: 'status',
      method: 'GET',
      path: '/control/status',
      routeClass: 'admin',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handle: async () => ({ ok: true as const }),
    });
    expect(() =>
      router.register({
        id: 'duplicate',
        method: 'GET',
        path: '/control/status',
        routeClass: 'admin',
        inputSchema: z.object({}).strict(),
        outputSchema: z.unknown(),
        handle: async () => null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CONTROL_ROUTE_DUPLICATE' }));
    router.freeze();
    await expect(
      router.dispatch(
        { method: 'GET', path: '/control/status', input: {} },
        principal,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ ok: true });
    expect(() =>
      router.register({
        id: 'late',
        method: 'GET',
        path: '/control/late',
        routeClass: 'admin',
        inputSchema: z.object({}).strict(),
        outputSchema: z.unknown(),
        handle: async () => null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CONTROL_ROUTE_FROZEN' }));
  });

  it('registers the three bounded network-domain routes on the existing router before freeze', async () => {
    const calls: string[] = [];
    const router = new AuthenticatedControlRouter();
    registerTask8BNetworkRoutes(router, {
      list: async () => {
        calls.push('list');
        return Object.freeze([
          Object.freeze({
            fqdnAscii: 'assets.example.com',
            addedBy: principal.actorId,
            addedAt: '2026-09-05T00:00:00.000Z',
          }),
        ]);
      },
      add: async (_principal, input) => {
        const request = input as Readonly<{ fqdn: string }>;
        calls.push(`add:${request.fqdn}`);
        return Object.freeze({
          fqdnAscii: request.fqdn.toLowerCase(),
          addedBy: principal.actorId,
          addedAt: '2026-09-05T00:00:00.000Z',
        });
      },
      remove: async (_principal, input) => {
        const request = input as Readonly<{ fqdn: string }>;
        calls.push(`remove:${request.fqdn}`);
      },
    });
    router.freeze();
    const signal = new AbortController().signal;

    await expect(
      router.dispatch(
        { method: 'GET', path: '/control/network/domains', input: {} },
        principal,
        signal,
      ),
    ).resolves.toHaveLength(1);
    await expect(
      router.dispatch(
        {
          method: 'POST',
          path: '/control/network/domains',
          input: { fqdn: 'ASSETS.EXAMPLE.COM', actionNonce: `sfp_an1_${'A'.repeat(43)}` },
        },
        principal,
        signal,
      ),
    ).resolves.toMatchObject({ fqdnAscii: 'assets.example.com' });
    await expect(
      router.dispatch(
        {
          method: 'DELETE',
          path: '/control/network/domains/assets.example.com',
          input: { actionNonce: `sfp_an1_${'B'.repeat(43)}` },
        },
        principal,
        signal,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(['list', 'add:ASSETS.EXAMPLE.COM', 'remove:assets.example.com']);
  });

  it('normalizes a domain before nonce consumption and preserves the nonce on semantic failure', async () => {
    const nonceStore = createActionNonceStore({ leaderGeneration: 'generation-1' });
    const requestHash = hashActionRequest('network-domain.add', {
      domain: 'assets.example.com',
    });
    const claims = await nonceStore.issue(principal, 'network-domain.add', requestHash);
    const calls: string[] = [];
    const endpoints = createNetworkDomainEndpoints({
      nonceStore,
      store: {
        list: async () => Object.freeze([]),
        addAuthorized: async (actorId, fqdnAscii, consumeNonce) => {
          calls.push(`validated:${fqdnAscii}`);
          await consumeNonce();
          calls.push('consumed');
          return Object.freeze({
            fqdnAscii,
            addedBy: actorId,
            addedAt: '2026-09-05T00:00:00.000Z',
          });
        },
        removeAuthorized: async () => undefined,
      },
    });

    await expect(
      endpoints.add(
        principal,
        { fqdn: 'ASSETS.EXAMPLE.COM', actionNonce: claims.value },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ fqdnAscii: 'assets.example.com' });
    expect(calls).toEqual(['validated:assets.example.com', 'consumed']);
    expect(nonceStore.get(claims.value)).toMatchObject({ state: 'consumed' });

    const invalidClaims = await nonceStore.issue(principal, 'network-domain.add', requestHash);
    await expect(
      endpoints.add(
        principal,
        { fqdn: 'example.com', actionNonce: invalidClaims.value },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_FQDN_INVALID' });
    expect(nonceStore.get(invalidClaims.value)).toMatchObject({ state: 'issued' });
  });

  it('rechecks cancellation inside the nonce CAS queue before consuming the domain nonce', async () => {
    const controller = new AbortController();
    let consumed = false;
    const endpoints = createNetworkDomainEndpoints({
      nonceStore: {
        issue: async () => {
          throw new Error('unused');
        },
        consumeCas: async (_actor, _nonce, _action, _hash, beforeConsume) => {
          controller.abort();
          await beforeConsume?.();
          consumed = true;
        },
      },
      store: {
        list: async () => Object.freeze([]),
        addAuthorized: async (actorId, fqdnAscii, consumeNonce) => {
          await consumeNonce();
          return Object.freeze({
            fqdnAscii,
            addedBy: actorId,
            addedAt: '2026-09-05T00:00:00.000Z',
          });
        },
        removeAuthorized: async () => undefined,
      },
    });

    await expect(
      endpoints.add(
        principal,
        { fqdn: 'assets.example.com', actionNonce: `sfp_an1_${'A'.repeat(43)}` },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(consumed).toBe(false);
  });
});

const networkDomainDeleteRouter = (): AuthenticatedControlRouter => {
  const router = new AuthenticatedControlRouter();
  router.register({
    id: 'network-domain.remove',
    method: 'DELETE',
    path: '/control/network/domains/:fqdn',
    routeClass: 'admin',
    inputSchema: z
      .object({
        fqdn: z.string(),
        actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
      })
      .strict(),
    outputSchema: z.object({ fqdn: z.string(), actionNonce: z.string() }).strict(),
    handle: async (_principal, input) => input,
  });
  router.freeze();
  return router;
};

const networkDomainPostRouter = (): AuthenticatedControlRouter => {
  const router = new AuthenticatedControlRouter();
  router.register({
    id: 'network-domain.add',
    method: 'POST',
    path: '/control/network/domains',
    routeClass: 'admin',
    inputSchema: z
      .object({
        fqdn: z.string(),
        actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
      })
      .strict(),
    outputSchema: z.object({ fqdn: z.string(), actionNonce: z.string() }).strict(),
    handle: async (_principal, input) => input,
  });
  router.freeze();
  return router;
};

const callHttpHandler = async (
  handler: ReturnType<typeof createControlHttpHandler>,
  input: {
    method: string;
    url: string;
    body?: string;
    headers?: Readonly<Record<string, string | readonly string[]>>;
  },
): Promise<{ status: number; body: string }> => {
  let status = 0;
  let responseBody = '';
  const chunks = input.body === undefined ? [] : [Buffer.from(input.body)];
  const request = {
    method: input.method,
    url: input.url,
    headers: input.headers ?? {},
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
  const response = {
    writeHead: (nextStatus: number) => {
      status = nextStatus;
    },
    end: (value: Uint8Array) => {
      responseBody = Buffer.from(value).toString('utf8');
    },
  };
  await handler(request as never, response as never);
  return { status, body: responseBody };
};
