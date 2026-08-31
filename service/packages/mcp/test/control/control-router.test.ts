import type { ActorContext } from '@sfp/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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
});

const callHttpHandler = async (
  handler: ReturnType<typeof createControlHttpHandler>,
  input: { method: string; url: string; body?: string },
): Promise<{ status: number; body: string }> => {
  let status = 0;
  let responseBody = '';
  const chunks = input.body === undefined ? [] : [Buffer.from(input.body)];
  const request = {
    method: input.method,
    url: input.url,
    headers: {},
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
