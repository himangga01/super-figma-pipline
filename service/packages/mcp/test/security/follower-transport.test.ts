import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { relative, resolve as resolvePath } from 'node:path';

import {
  FollowerTransportRequestIdSchema,
  McpSessionIdSchema,
  PRODUCT_MAGIC,
  PublicPingV1Schema,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFollowerAuthenticatedTransport,
  createFollowerTransportRequestId,
  createMcpSessionId,
  type FollowerAuthenticatedTransport,
} from '../../src/security/follower-transport.js';
import {
  FOLLOWER_RESPONSE_BODY_MAX_BYTES,
  FOLLOWER_RESPONSE_RECORD_MAX_BYTES,
  FOLLOWER_RESPONSE_RECORD_MAX_COUNT,
  FOLLOWER_RESPONSE_TOTAL_MAX_BYTES,
  PAIR_METADATA_MAX_BYTES,
  RPC_REQUEST_MAX_BYTES,
} from '../../src/security/request-limits.js';

const generation = Buffer.alloc(16, 1).toString('base64url');
const credentials = {
  generation,
  followerToken: Buffer.alloc(32, 20).toString('base64url'),
  controlToken: Buffer.alloc(32, 21).toString('base64url'),
  createdAt: 1,
};
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

type FetchWrapper = (base: typeof globalThis.fetch) => typeof globalThis.fetch;

const startHarness = async (
  options: {
    handler?: Parameters<FollowerAuthenticatedTransport['server']['serveHttp']>[3];
    wrapFetch?: FetchWrapper;
    mcpSessionByte?: number;
    configureResponse?: (response: ServerResponse) => void;
  } = {},
): Promise<{ transport: FollowerAuthenticatedTransport; port: number }> => {
  let serverTransport!: FollowerAuthenticatedTransport;
  const http = createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/ping') {
        const body = Buffer.from(
          JSON.stringify({
            ok: true,
            product: PRODUCT_MAGIC,
            protocolVersion: '0.1.0',
            serverVersion: '0.1.0',
            buildId: 1,
            leaderGeneration: generation,
            role: 'leader',
          }),
        );
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
        });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && req.url === '/follower/challenge') {
        await serverTransport.server.serveChallengeHttp(req, res);
        return;
      }
      const path = req.url === '/abdicate' ? '/abdicate' : '/rpc';
      options.configureResponse?.(res);
      await serverTransport.server.serveHttp(
        req,
        res,
        path,
        options.handler ??
          (async (request, response) => {
            await response.write(Buffer.from(request.plaintext), { final: true });
          }),
      );
    })();
  });
  servers.push(http);
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const port = (http.address() as AddressInfo).port;
  const leaderUrl = `http://127.0.0.1:${port}`;
  serverTransport = await createFollowerAuthenticatedTransport({
    leaderUrl,
    mcpSession: `mcp1_${Buffer.alloc(16, 22).toString('base64url')}`,
    memory: credentials,
  });
  const transport =
    options.wrapFetch === undefined
      ? serverTransport
      : await createFollowerAuthenticatedTransport({
          leaderUrl,
          mcpSession: `mcp1_${Buffer.alloc(16, options.mcpSessionByte ?? 23).toString('base64url')}`,
          memory: credentials,
          fetch: options.wrapFetch(globalThis.fetch.bind(globalThis)),
        });
  return { transport, port };
};

const collect = async (
  records: AsyncIterable<{ sequence: number; final: boolean; plaintext: Uint8Array }>,
): Promise<Array<{ sequence: number; final: boolean; plaintext: Buffer }>> => {
  const values: Array<{ sequence: number; final: boolean; plaintext: Buffer }> = [];
  for await (const record of records)
    values.push({ ...record, plaintext: Buffer.from(record.plaintext) });
  return values;
};

const openEcho = async (
  transport: FollowerAuthenticatedTransport,
  plaintext = Buffer.from('authenticated body'),
  path: '/rpc' | '/abdicate' = '/rpc',
) =>
  transport.client.open(
    { path, transportRequestId: createFollowerTransportRequestId(), plaintext },
    AbortSignal.timeout(5_000),
  );

const frameSizeAt = (body: Buffer, offset: number): number =>
  16 + body.readUInt32BE(offset + 12) + 16;

describe('public follower transport identities', () => {
  it('accepts only canonical 128-bit mcp-session and transport-request identifiers', () => {
    expect(McpSessionIdSchema.parse(`mcp1_${Buffer.alloc(16, 2).toString('base64url')}`)).toMatch(
      /^mcp1_[A-Za-z0-9_-]{22}$/,
    );
    expect(
      FollowerTransportRequestIdSchema.parse(
        `sfp_req1_${Buffer.alloc(16, 3).toString('base64url')}`,
      ),
    ).toMatch(/^sfp_req1_[A-Za-z0-9_-]{22}$/);

    for (const invalid of [
      'mcp1_short',
      `mcp1_${'A'.repeat(21)}B`,
      `sfp_req1_${'A'.repeat(21)}B`,
      `sfp_req1_${Buffer.alloc(16, 4).toString('base64url')}=`,
    ]) {
      expect(McpSessionIdSchema.safeParse(invalid).success).toBe(false);
      expect(FollowerTransportRequestIdSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts exactly the seven PublicPingV1 fields and rejects every oracle extension', () => {
    const ping = {
      ok: true,
      product: PRODUCT_MAGIC,
      protocolVersion: '0.1.0',
      serverVersion: '0.1.0',
      buildId: 7,
      leaderGeneration: generation,
      role: 'leader',
    };
    expect(PublicPingV1Schema.parse(ping)).toEqual(ping);
    expect(PublicPingV1Schema.safeParse({ ...ping, plugins: 1 }).success).toBe(false);
    expect(
      PublicPingV1Schema.safeParse({ ...ping, activeSessionId: 'private-session' }).success,
    ).toBe(false);
    const { role: _role, ...missingRole } = ping;
    expect(PublicPingV1Schema.safeParse(missingRole).success).toBe(false);
  });

  it('creates separate canonical 128-bit session and per-call transport identifiers', () => {
    const mcpSession = createMcpSessionId(size => Buffer.alloc(size, 4));
    const firstRequest = createFollowerTransportRequestId(size => Buffer.alloc(size, 5));
    const secondRequest = createFollowerTransportRequestId(size => Buffer.alloc(size, 6));

    expect(mcpSession).toBe(`mcp1_${Buffer.alloc(16, 4).toString('base64url')}`);
    expect(firstRequest).toBe(`sfp_req1_${Buffer.alloc(16, 5).toString('base64url')}`);
    expect(secondRequest).toBe(`sfp_req1_${Buffer.alloc(16, 6).toString('base64url')}`);
    expect(firstRequest).not.toBe(secondRequest);
    expect(firstRequest.slice('sfp_req1_'.length)).not.toBe(mcpSession.slice('mcp1_'.length));
  });

  it('keeps the injected mcpSession stable without exposing tokens or keys on the facade', async () => {
    const mcpSession = `mcp1_${Buffer.alloc(16, 7).toString('base64url')}` as const;
    const transport = await createFollowerAuthenticatedTransport({
      leaderUrl: 'http://127.0.0.1:1',
      mcpSession,
      memory: {
        generation,
        followerToken: Buffer.alloc(32, 8).toString('base64url'),
        controlToken: Buffer.alloc(32, 9).toString('base64url'),
        createdAt: 1,
      },
    });

    expect(transport.client.mcpSession).toBe(mcpSession);
    expect(Object.keys(transport).toSorted()).toEqual([
      'client',
      'control',
      'generation',
      'server',
    ]);
    expect(JSON.stringify(transport)).not.toMatch(/token|key|authorization/i);
    expect(Object.keys(await transport.generation.rotate()).toSorted()).toEqual([
      'createdAt',
      'generation',
    ]);
    expect(transport.client.mcpSession).toBe(mcpSession);
  });

  it('keeps private follower crypto behind exactly one production importer', async () => {
    const sourceRoot = resolvePath('packages/mcp/src');
    const names = (await readdir(sourceRoot, { recursive: true }))
      .filter(name => name.endsWith('.ts'))
      .toSorted();
    const importers: string[] = [];
    for (const name of names) {
      const path = resolvePath(sourceRoot, name);
      const contents = await readFile(path, 'utf8');
      if (/from ['"][^'"]*follower-auth\.js['"]/.test(contents)) {
        importers.push(relative(sourceRoot, path).replaceAll('\\', '/'));
      }
    }
    expect(importers).toEqual(['security/follower-transport.ts']);
  });

  it('keeps the transitional unpinned fallback behind exactly two read-only aggregators', async () => {
    const dispatch = await readFile(resolvePath('packages/mcp/src/dispatch.ts'), 'utf8');
    const index = await readFile(resolvePath('packages/mcp/src/index.ts'), 'utf8');
    expect(dispatch).not.toContain('.resolveActiveSession(');
    expect([...index.matchAll(/await routedDispatch\(\)/g)]).toHaveLength(2);
    expect(index).toContain('handleComponentMap(await routedDispatch()');
    expect(index).toContain('handleIconMap(await routedDispatch()');
  });
});

describe('opaque authenticated follower stream', () => {
  it('yields an authenticated non-final record before the delayed final record', async () => {
    const mcpSession = `mcp1_${Buffer.alloc(16, 10).toString('base64url')}` as const;
    const transportRequestId = `sfp_req1_${Buffer.alloc(16, 11).toString('base64url')}` as const;
    let releaseFinal!: () => void;
    const finalBarrier = new Promise<void>(resolve => {
      releaseFinal = resolve;
    });
    let transport!: Awaited<ReturnType<typeof createFollowerAuthenticatedTransport>>;
    const http = createServer((req, res) => {
      void (async () => {
        if (req.method === 'GET' && req.url === '/ping') {
          const body = Buffer.from(
            JSON.stringify({
              ok: true,
              product: PRODUCT_MAGIC,
              protocolVersion: '0.1.0',
              serverVersion: '0.1.0',
              buildId: 1,
              leaderGeneration: generation,
              role: 'leader',
            }),
          );
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-length': String(body.byteLength),
          });
          res.end(body);
          return;
        }
        if (req.method === 'GET') {
          await transport.server.serveChallengeHttp(req, res);
          return;
        }
        await transport.server.serveHttp(req, res, '/rpc', async (request, response) => {
          expect(request).toMatchObject({
            leaderGeneration: generation,
            mcpSession,
            transportRequestId,
            path: '/rpc',
          });
          expect(Buffer.from(request.plaintext).toString('utf8')).toBe('opaque request');
          await response.write(Buffer.from('accepted'), { final: false });
          await finalBarrier;
          await response.write(Buffer.from('terminal'), { final: true });
        });
      })();
    });
    servers.push(http);
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const port = (http.address() as AddressInfo).port;
    transport = await createFollowerAuthenticatedTransport({
      leaderUrl: `http://127.0.0.1:${port}`,
      mcpSession,
      memory: {
        generation,
        followerToken: Buffer.alloc(32, 12).toString('base64url'),
        controlToken: Buffer.alloc(32, 13).toString('base64url'),
        createdAt: 1,
      },
    });
    const stream = await transport.client.open(
      {
        path: '/rpc',
        transportRequestId,
        plaintext: Buffer.from('opaque request'),
      },
      AbortSignal.timeout(2_000),
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 0, final: false, plaintext: Buffer.from('accepted') },
    });
    const terminal = iterator.next();
    const beforeRelease = await Promise.race([
      terminal.then(() => 'resolved' as const),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 25)),
    ]);
    expect(beforeRelease).toBe('pending');
    releaseFinal();
    await expect(terminal).resolves.toMatchObject({
      done: false,
      value: { sequence: 1, final: true, plaintext: Buffer.from('terminal') },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each(['extra', 'missing', 'foreign'] as const)(
    'strict leaderInfo rejects %s public ping identity',
    async mutation => {
      const { transport } = await startHarness({
        wrapFetch: base => async (input, init) => {
          const response = await base(input, init);
          if (!String(input).endsWith('/ping')) return response;
          const body = (await response.json()) as Record<string, unknown>;
          if (mutation === 'extra') body.plugins = 1;
          if (mutation === 'missing') delete body.role;
          if (mutation === 'foreign') body.product = 'foreign-product';
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });
      await expect(transport.client.leaderInfo()).resolves.toBeUndefined();
    },
  );

  it.each([
    [
      'body',
      (input: string, init: RequestInit) => {
        const body = Buffer.from(init.body as Buffer);
        body[0] = (body[0] ?? 0) ^ 1;
        return [input, { ...init, body }] as const;
      },
    ],
    [
      'path',
      (input: string, init: RequestInit) => [input.replace('/rpc', '/abdicate'), init] as const,
    ],
    ['method', (input: string, init: RequestInit) => [input, { ...init, method: 'PUT' }] as const],
    [
      'generation',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('x-sfp-leader-generation', Buffer.alloc(16, 30).toString('base64url'));
        return [input, { ...init, headers }] as const;
      },
    ],
    [
      'mcpSession',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('x-sfp-mcp-session', `mcp1_${Buffer.alloc(16, 31).toString('base64url')}`);
        return [input, { ...init, headers }] as const;
      },
    ],
    [
      'transportRequestId',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set(
          'x-sfp-transport-request-id',
          `sfp_req1_${Buffer.alloc(16, 32).toString('base64url')}`,
        );
        return [input, { ...init, headers }] as const;
      },
    ],
    [
      'digest',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('x-sfp-request-digest', Buffer.alloc(32, 33).toString('base64url'));
        return [input, { ...init, headers }] as const;
      },
    ],
    [
      'iv',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('x-sfp-request-iv', Buffer.alloc(12, 34).toString('base64url'));
        return [input, { ...init, headers }] as const;
      },
    ],
    [
      'tag',
      (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        headers.set('x-sfp-request-tag', Buffer.alloc(16, 35).toString('base64url'));
        return [input, { ...init, headers }] as const;
      },
    ],
  ] as const)('rejects request %s tampering before the handler', async (_name, mutate) => {
    let handled = 0;
    const { transport } = await startHarness({
      handler: async (_request, response) => {
        handled += 1;
        await response.write(Buffer.from('should not run'), { final: true });
      },
      wrapFetch: base => async (input, init) => {
        if (init?.method !== 'POST') return base(input, init);
        const [url, changed] = mutate(String(input), init);
        return base(url, changed);
      },
    });

    await expect(openEcho(transport)).rejects.toBeInstanceOf(Error);
    expect(handled).toBe(0);
  });

  it('consumes each authenticated request challenge exactly once', async () => {
    let replayStatus = 0;
    let handled = 0;
    const { transport } = await startHarness({
      handler: async (request, response) => {
        handled += 1;
        await response.write(Buffer.from(request.plaintext), { final: true });
      },
      wrapFetch: base => async (input, init) => {
        const response = await base(input, init);
        if (init?.method === 'POST') {
          const replay = await base(input, { ...init, body: Buffer.from(init.body as Buffer) });
          replayStatus = replay.status;
          await replay.body?.cancel();
        }
        return response;
      },
    });
    await expect(collect(await openEcho(transport))).resolves.toHaveLength(1);
    expect(replayStatus).toBe(401);
    expect(handled).toBe(1);
  });

  it.each([
    [
      'status',
      (status: number, headers: Headers, body: Buffer) => ({ status: status + 1, headers, body }),
    ],
    [
      'generation',
      (status: number, headers: Headers, body: Buffer) => {
        headers.set('x-sfp-leader-generation', Buffer.alloc(16, 40).toString('base64url'));
        return { status, headers, body };
      },
    ],
    [
      'mcpSession',
      (status: number, headers: Headers, body: Buffer) => {
        headers.set('x-sfp-mcp-session', `mcp1_${Buffer.alloc(16, 41).toString('base64url')}`);
        return { status, headers, body };
      },
    ],
    [
      'transportRequestId',
      (status: number, headers: Headers, body: Buffer) => {
        headers.set(
          'x-sfp-transport-request-id',
          `sfp_req1_${Buffer.alloc(16, 42).toString('base64url')}`,
        );
        return { status, headers, body };
      },
    ],
    [
      'digest',
      (status: number, headers: Headers, body: Buffer) => {
        headers.set('x-sfp-request-digest', Buffer.alloc(32, 43).toString('base64url'));
        return { status, headers, body };
      },
    ],
    [
      'sequence',
      (status: number, headers: Headers, body: Buffer) => {
        body.writeUInt32BE(1, 8);
        return { status, headers, body };
      },
    ],
    [
      'final',
      (status: number, headers: Headers, body: Buffer) => {
        body[5] = (body[5] ?? 0) ^ 1;
        return { status, headers, body };
      },
    ],
    [
      'truncated',
      (status: number, headers: Headers, body: Buffer) => {
        body[5] = (body[5] ?? 0) ^ 2;
        return { status, headers, body };
      },
    ],
    [
      'length',
      (status: number, headers: Headers, body: Buffer) => {
        body.writeUInt32BE(body.readUInt32BE(12) + 1, 12);
        return { status, headers, body };
      },
    ],
    [
      'tag',
      (status: number, headers: Headers, body: Buffer) => {
        body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
        return { status, headers, body };
      },
    ],
  ] as const)('rejects response %s tampering without accepting a record', async (_name, mutate) => {
    const { transport } = await startHarness({
      wrapFetch: base => async (input, init) => {
        const response = await base(input, init);
        if (init?.method !== 'POST') return response;
        const changed = mutate(
          response.status,
          new Headers(response.headers),
          Buffer.from(await response.arrayBuffer()),
        );
        return new Response(changed.body, { status: changed.status, headers: changed.headers });
      },
    });
    const yielded: unknown[] = [];
    await expect(
      (async () => {
        for await (const record of await openEcho(transport)) yielded.push(record);
      })(),
    ).rejects.toBeInstanceOf(Error);
    expect(yielded).toEqual([]);
  });

  it('parses every header, ciphertext, and tag boundary when HTTP arrives one byte at a time', async () => {
    const { transport } = await startHarness({
      wrapFetch: base => async (input, init) => {
        const response = await base(input, init);
        if (init?.method !== 'POST') return response;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        });
        return new Response(stream, { status: response.status, headers: response.headers });
      },
    });
    await expect(
      collect(await openEcho(transport, Buffer.from('one-byte chunks'))),
    ).resolves.toEqual([{ sequence: 0, final: true, plaintext: Buffer.from('one-byte chunks') }]);
  });

  it('rejects old challenge and unary response downgrades without fallback', async () => {
    for (const downgrade of ['challenge', 'response'] as const) {
      const { transport } = await startHarness({
        wrapFetch: base => async (input, init) => {
          const response = await base(input, init);
          if (downgrade === 'challenge' && String(input).endsWith('/follower/challenge')) {
            const body = (await response.json()) as Record<string, unknown>;
            delete body.followerTransportVersion;
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (downgrade === 'response' && init?.method === 'POST') {
            return new Response(await response.arrayBuffer(), {
              status: 200,
              headers: { 'content-type': 'application/sfp-encrypted' },
            });
          }
          return response;
        },
      });
      await expect(openEcho(transport)).rejects.toBeInstanceOf(Error);
    }
  });

  it.each(['duplicate', 'gap', 'reorder'] as const)(
    'rejects %s response record ordering',
    async mutation => {
      const { transport } = await startHarness({
        handler: async (_request, response) => {
          await response.write(Buffer.from('first'), { final: false });
          await response.write(Buffer.from('second'), { final: true });
        },
        wrapFetch: base => async (input, init) => {
          const response = await base(input, init);
          if (init?.method !== 'POST') return response;
          const body = Buffer.from(await response.arrayBuffer());
          const firstSize = frameSizeAt(body, 0);
          if (mutation === 'duplicate') body.writeUInt32BE(0, firstSize + 8);
          if (mutation === 'gap') body.writeUInt32BE(2, firstSize + 8);
          const changed =
            mutation === 'reorder'
              ? Buffer.concat([body.subarray(firstSize), body.subarray(0, firstSize)])
              : body;
          return new Response(changed, { status: response.status, headers: response.headers });
        },
      });
      await expect(collect(await openEcho(transport))).rejects.toBeInstanceOf(Error);
    },
  );

  it.each(['eof-before-final', 'bytes-after-final'] as const)(
    'rejects %s without inventing a terminal record',
    async mutation => {
      const { transport } = await startHarness({
        handler: async (_request, response) => {
          if (mutation === 'eof-before-final') {
            await response.write(Buffer.from('progress'), { final: false });
            return;
          }
          await response.write(Buffer.from('terminal'), { final: true });
        },
        wrapFetch: base => async (input, init) => {
          const response = await base(input, init);
          if (init?.method !== 'POST') return response;
          const body = Buffer.from(await response.arrayBuffer());
          const changed =
            mutation === 'eof-before-final'
              ? body.subarray(0, frameSizeAt(body, 0))
              : Buffer.concat([body, Buffer.from([0])]);
          return new Response(changed, { status: response.status, headers: response.headers });
        },
      });
      await expect(collect(await openEcho(transport))).rejects.toBeInstanceOf(Error);
    },
  );

  it('rejects a valid encrypted record replayed into another request and mcpSession', async () => {
    let replayBody: Buffer | undefined;
    const replayingFetch: FetchWrapper = base => async (input, init) => {
      const response = await base(input, init);
      if (init?.method !== 'POST') return response;
      const current = Buffer.from(await response.arrayBuffer());
      const body = replayBody ?? current;
      replayBody ??= current;
      return new Response(body, { status: response.status, headers: response.headers });
    };
    const first = await startHarness({ wrapFetch: replayingFetch, mcpSessionByte: 50 });
    await expect(
      collect(await openEcho(first.transport, Buffer.from('first'))),
    ).resolves.toHaveLength(1);
    await expect(
      collect(await openEcho(first.transport, Buffer.from('second'))),
    ).rejects.toBeInstanceOf(Error);

    const secondClient = await createFollowerAuthenticatedTransport({
      leaderUrl: `http://127.0.0.1:${first.port}`,
      mcpSession: `mcp1_${Buffer.alloc(16, 51).toString('base64url')}`,
      memory: credentials,
      fetch: replayingFetch(globalThis.fetch.bind(globalThis)),
    });
    await expect(collect(await openEcho(secondClient))).rejects.toBeInstanceOf(Error);
  });

  it('keeps mcpSession process-stable while every call uses a separate transport ID', async () => {
    const observed: Array<{ mcpSession: string; transportRequestId: string }> = [];
    const { transport } = await startHarness({
      handler: async (request, response) => {
        observed.push(request);
        await response.write(Buffer.from('ok'), { final: true });
      },
    });
    await collect(await openEcho(transport, Buffer.from('one')));
    await collect(await openEcho(transport, Buffer.from('two')));
    expect(observed).toHaveLength(2);
    expect(observed[0]?.mcpSession).toBe(observed[1]?.mcpSession);
    expect(observed[0]?.transportRequestId).not.toBe(observed[1]?.transportRequestId);
    expect(observed.every(value => McpSessionIdSchema.safeParse(value.mcpSession).success)).toBe(
      true,
    );
    expect(
      observed.every(
        value => FollowerTransportRequestIdSchema.safeParse(value.transportRequestId).success,
      ),
    ).toBe(true);
  });

  it('iterator return closes only the transport subscription', async () => {
    let subscriberClosed = false;
    let semanticCancels = 0;
    const { transport } = await startHarness({
      handler: async (_request, response, subscriberSignal) => {
        await response.write(Buffer.from('progress'), { final: false });
        await new Promise<void>(resolve => {
          subscriberSignal.addEventListener(
            'abort',
            () => {
              subscriberClosed = true;
              resolve();
            },
            { once: true },
          );
        });
        semanticCancels += 0;
      },
    });
    const iterator = (await openEcho(transport))[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { sequence: 0 } });
    await iterator.return?.();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(subscriberClosed).toBe(true);
    expect(semanticCancels).toBe(0);
  });

  it.each([
    ['/abdicate', PAIR_METADATA_MAX_BYTES - 1, true],
    ['/abdicate', PAIR_METADATA_MAX_BYTES, true],
    ['/abdicate', PAIR_METADATA_MAX_BYTES + 1, false],
    ['/rpc', RPC_REQUEST_MAX_BYTES - 1, true],
    ['/rpc', RPC_REQUEST_MAX_BYTES, true],
    ['/rpc', RPC_REQUEST_MAX_BYTES + 1, false],
  ] as const)(
    'enforces the exact %s request cap at %s bytes',
    async (path, size, accepted) => {
      let handled = 0;
      const { transport } = await startHarness({
        handler: async (request, response) => {
          handled += 1;
          await response.write(Buffer.from(String(request.plaintext.byteLength)), { final: true });
        },
      });
      const opened = openEcho(transport, Buffer.alloc(size), path);
      const outcome = await opened.then(
        async records => ({ kind: 'ok' as const, records: await collect(records) }),
        (error: { code?: string }) => ({ kind: 'error' as const, code: error.code }),
      );
      expect(outcome).toMatchObject(
        accepted
          ? {
              kind: 'ok',
              records: [{ sequence: 0, final: true, plaintext: Buffer.from(String(size)) }],
            }
          : { kind: 'error', code: 'PAYLOAD_TOO_LARGE' },
      );
      expect(handled).toBe(accepted ? 1 : 0);
    },
    30_000,
  );

  it.each([
    [FOLLOWER_RESPONSE_RECORD_MAX_BYTES - 1, true],
    [FOLLOWER_RESPONSE_RECORD_MAX_BYTES, true],
    [FOLLOWER_RESPONSE_RECORD_MAX_BYTES + 1, false],
  ] as const)(
    'enforces the exact single-record response cap at %s bytes',
    async (size, accepted) => {
      const { transport } = await startHarness({
        handler: async (_request, response) => {
          await response.write(Buffer.alloc(size), { final: true });
        },
      });
      const records = collect(await openEcho(transport, Buffer.from('cap')));
      const outcome = await records.then(
        values => ({
          kind: 'ok' as const,
          count: values.length,
          byteLength: values[0]?.plaintext.byteLength,
        }),
        (error: { code?: string }) => ({ kind: 'error' as const, code: error.code }),
      );
      expect(outcome).toEqual(
        accepted
          ? { kind: 'ok', count: 1, byteLength: size }
          : { kind: 'error', code: 'FOLLOWER_RESPONSE_TRUNCATED' },
      );
    },
    30_000,
  );

  it.each([
    [FOLLOWER_RESPONSE_TOTAL_MAX_BYTES, true],
    [FOLLOWER_RESPONSE_TOTAL_MAX_BYTES + 1, false],
  ] as const)(
    'enforces the cumulative authenticated response cap at %s bytes',
    async (total, accepted) => {
      const firstSize = Math.floor(total / 2);
      const secondSize = total - firstSize;
      const { transport } = await startHarness({
        handler: async (_request, response) => {
          await response.write(Buffer.alloc(firstSize), { final: false });
          await response.write(Buffer.alloc(secondSize), { final: true });
        },
      });
      const records = collect(await openEcho(transport, Buffer.from('cumulative')));
      const outcome = await records.then(
        values => ({ kind: 'ok' as const, count: values.length }),
        (error: { code?: string }) => ({ kind: 'error' as const, code: error.code }),
      );
      expect(outcome).toEqual(
        accepted
          ? { kind: 'ok', count: 2 }
          : { kind: 'error', code: 'FOLLOWER_RESPONSE_TRUNCATED' },
      );
    },
    30_000,
  );

  it.each([
    [FOLLOWER_RESPONSE_RECORD_MAX_COUNT, true],
    [FOLLOWER_RESPONSE_RECORD_MAX_COUNT + 1, false],
  ] as const)(
    'enforces the %s-slot record boundary with authenticated truncation',
    async (writes, accepted) => {
      const { transport } = await startHarness({
        handler: async (_request, response) => {
          for (let sequence = 0; sequence < writes; sequence += 1) {
            // eslint-disable-next-line no-await-in-loop -- the wire contract requires serial writes
            await response.write(Buffer.from([sequence & 0xff]), {
              final: accepted && sequence === writes - 1,
            });
          }
        },
      });
      const records = collect(await openEcho(transport, Buffer.from('records')));
      const outcome = await records.then(
        values => ({ kind: 'ok' as const, count: values.length }),
        (error: { code?: string }) => ({ kind: 'error' as const, code: error.code }),
      );
      expect(outcome).toEqual(
        accepted
          ? { kind: 'ok', count: FOLLOWER_RESPONSE_RECORD_MAX_COUNT }
          : { kind: 'error', code: 'FOLLOWER_RESPONSE_TRUNCATED' },
      );
    },
    30_000,
  );

  it('rejects a declared outer response body above the cap before parsing', async () => {
    const { transport } = await startHarness({
      wrapFetch: base => async (input, init) => {
        const response = await base(input, init);
        if (init?.method !== 'POST') return response;
        const body = await response.arrayBuffer();
        const headers = new Headers(response.headers);
        headers.set('content-length', String(FOLLOWER_RESPONSE_BODY_MAX_BYTES + 1));
        return new Response(body, { status: response.status, headers });
      },
    });
    await expect(openEcho(transport)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('waits for drain before the handler can write its next record', async () => {
    let responseRef: ServerResponse | undefined;
    let firstWrite = true;
    let firstWriteReturned = false;
    const { transport } = await startHarness({
      configureResponse: response => {
        responseRef = response;
        const write = response.write.bind(response);
        response.write = ((chunk: Uint8Array) => {
          const result = write(chunk);
          if (firstWrite) {
            firstWrite = false;
            return false;
          }
          return result;
        }) as typeof response.write;
      },
      handler: async (_request, response) => {
        await response.write(Buffer.from('first'), { final: false });
        firstWriteReturned = true;
        await response.write(Buffer.from('second'), { final: true });
      },
    });
    const iterator = (await openEcho(transport))[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { sequence: 0 } });
    expect(firstWriteReturned).toBe(false);
    responseRef?.emit('drain');
    await expect(iterator.next()).resolves.toMatchObject({ value: { sequence: 1, final: true } });
    expect(firstWriteReturned).toBe(true);
  });

  it('fails closed on concurrent response sink writes', async () => {
    const { transport } = await startHarness({
      handler: async (_request, response) => {
        await Promise.all([
          response.write(Buffer.from('first'), { final: false }),
          response.write(Buffer.from('concurrent'), { final: true }),
        ]);
      },
    });
    await expect(collect(await openEcho(transport))).rejects.toMatchObject({
      code: 'FOLLOWER_RESPONSE_TRUNCATED',
    });
  });

  it('still emits authenticated truncation when a concurrent write races backpressure', async () => {
    let responseRef: ServerResponse | undefined;
    let firstWrite = true;
    const { transport } = await startHarness({
      configureResponse: response => {
        responseRef = response;
        const write = response.write.bind(response);
        response.write = ((chunk: Uint8Array) => {
          const result = write(chunk);
          if (firstWrite) {
            firstWrite = false;
            return false;
          }
          return result;
        }) as typeof response.write;
      },
      handler: async (_request, response) => {
        await Promise.all([
          response.write(Buffer.from('progress'), { final: false }),
          response.write(Buffer.from('concurrent'), { final: true }),
        ]);
      },
    });
    const stream = await transport.client.open(
      {
        path: '/rpc',
        transportRequestId: createFollowerTransportRequestId(),
        plaintext: Buffer.from('race'),
      },
      AbortSignal.timeout(750),
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { sequence: 0, final: false } });
    responseRef?.emit('drain');
    await expect(iterator.next()).rejects.toMatchObject({ code: 'FOLLOWER_RESPONSE_TRUNCATED' });
  });

  it('releases the response reader after a verified final and EOF', async () => {
    let body: ReadableStream<Uint8Array> | null = null;
    const { transport } = await startHarness({
      wrapFetch: base => async (input, init) => {
        const response = await base(input, init);
        if (init?.method === 'POST') body = response.body;
        return response;
      },
    });
    await collect(await openEcho(transport));
    expect((body as ReadableStream<Uint8Array> | null)?.locked).toBe(false);
  });
});
