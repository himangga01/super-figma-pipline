import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { encode } from '@msgpack/msgpack';
import {
  createRequest,
  decodeEnvelope,
  encodeEnvelope,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Relay } from '../../src/relay/relay.js';
import {
  BASE64_IMAGE_MAX_BYTES,
  DECODED_IMAGE_MAX_BYTES,
  EXPERIMENTAL_VIDEO_MAX_BYTES,
  HTTP_RESPONSE_MAX_BYTES,
  PAIR_METADATA_MAX_BYTES,
  RPC_REQUEST_MAX_BYTES,
  RequestLimitError,
  WS_FRAME_MAX_BYTES,
  readBoundedBody,
  readBoundedFetchBody,
} from '../../src/security/request-limits.js';

const servers: Server[] = [];
const relays: Relay[] = [];

afterEach(async () => {
  await Promise.all(relays.splice(0).map(relay => relay.stop()));
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

describe('streaming request limits', () => {
  it('accepts the exact pair metadata cap and rejects the next byte', async () => {
    await expect(
      readBoundedBody(
        Readable.from([Buffer.alloc(PAIR_METADATA_MAX_BYTES)]),
        PAIR_METADATA_MAX_BYTES,
      ),
    ).resolves.toHaveLength(16 * 1024);
    await expect(
      readBoundedBody(
        Readable.from([Buffer.alloc(PAIR_METADATA_MAX_BYTES), Buffer.from([1])]),
        PAIR_METADATA_MAX_BYTES,
      ),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
  });

  it('stops buffering at the first over-limit chunk', async () => {
    let reads = 0;
    const source = Readable.from(
      (async function* chunks() {
        for (let index = 0; index < 100; index += 1) {
          await new Promise<void>(resolve => setImmediate(resolve));
          reads += 1;
          yield Buffer.alloc(4);
        }
      })(),
    );

    await expect(readBoundedBody(source, 5)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(reads).toBeLessThan(100);
  });

  it('defines the transport caps used by HTTP, RPC, frames, images, and video', () => {
    expect({
      pair: PAIR_METADATA_MAX_BYTES,
      rpc: RPC_REQUEST_MAX_BYTES,
      response: HTTP_RESPONSE_MAX_BYTES,
      frame: WS_FRAME_MAX_BYTES,
      decodedImage: DECODED_IMAGE_MAX_BYTES,
      base64Image: BASE64_IMAGE_MAX_BYTES,
      video: EXPERIMENTAL_VIDEO_MAX_BYTES,
    }).toEqual({
      pair: 16 * 1024,
      rpc: 9 * 1024 * 1024,
      response: 64 * 1024 * 1024,
      frame: 64 * 1024 * 1024,
      decodedImage: 6 * 1024 * 1024,
      base64Image: 8 * 1024 * 1024,
      video: 48 * 1024 * 1024,
    });
  });

  it('caps a streamed fetch response before concatenating the over-limit chunk', async () => {
    const exact = new Response(Readable.toWeb(Readable.from([Buffer.alloc(4)])) as ReadableStream);
    await expect(readBoundedFetchBody(exact, 4)).resolves.toHaveLength(4);

    const oversized = new Response(
      Readable.toWeb(Readable.from([Buffer.alloc(4), Buffer.from([1])])) as ReadableStream,
    );
    await expect(readBoundedFetchBody(oversized, 4)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    });
  });
});

describe('WebSocket ingress gates', () => {
  const startRelay = async (maxPayloadBytes = 32): Promise<number> => {
    const server = createServer();
    servers.push(server);
    const relay = new Relay({
      server,
      serverVersion: '0.1.0',
      maxPayloadBytes,
      authenticator: {
        authenticateHello: async () => {
          throw Object.assign(new Error('credential required'), {
            code: 'PAIR_CREDENTIAL_REQUIRED',
          });
        },
      },
    });
    relays.push(relay);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return (server.address() as AddressInfo).port;
  };

  it('requires the exact /ws path', async () => {
    const port = await startRelay(1024);
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/not-ws`, { origin: 'null' });
      ws.once('unexpected-response', (_req, response) => resolve(response.statusCode ?? 0));
      ws.once('error', error => {
        if (!error.message.includes('Unexpected server response')) reject(error);
      });
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('rejects query-bearing /ws URLs so credentials can never move into a URL', async () => {
    const port = await startRelay(1024);
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?credential=url-secret`, {
        origin: 'null',
      });
      ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      ws.once('open', () => {
        ws.close();
        reject(new Error('query-bearing WebSocket path must not open'));
      });
      ws.once('error', error => {
        if (!error.message.includes('Unexpected server response')) reject(error);
      });
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('closes a frame above the configured maxPayload before decoding it', async () => {
    const port = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
    ws.send(Buffer.alloc(33));
    await expect(closed).resolves.toBe(1009);
  });

  it('rejects null Origin without treating it as a WebSocket identity', async () => {
    const port = await startRelay(1024);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(
      encodeEnvelope(
        createRequest({
          id: newId(),
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: {
            clientType: 'plugin',
            clientVersion: '0.1.0',
            protocolVersion: PROTOCOL_VERSION,
          },
        }),
      ),
    );
    const closeCode = await new Promise<number>(resolve => ws.once('close', code => resolve(code)));
    expect(closeCode).toBe(1008);
  });

  it('rejects a WebSocket upgrade with no Origin before any credential exchange', async () => {
    const port = await startRelay();
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      ws.once('open', () => reject(new Error('originless upgrade must not open')));
      ws.once('error', error => {
        if (!error.message.includes('Unexpected server response')) reject(error);
      });
    });
    expect(status).toBe(403);
  });

  it('logs fixed WebSocket reject reasons without reflecting hostile Host or Origin', async () => {
    const server = createServer();
    servers.push(server);
    const logs: string[] = [];
    const relay = new Relay({
      server,
      serverVersion: '0.1.0',
      log: message => logs.push(message),
      authenticator: {
        authenticateHello: async () => {
          throw new Error('not reached');
        },
      },
    });
    relays.push(relay);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const hostileOrigin = 'https://evil.example/Bearer-reflected-secret';
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: hostileOrigin });
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      socket.once('open', () => reject(new Error('hostile Origin must not open')));
      socket.once('error', error => {
        if (!error.message.includes('Unexpected server response')) reject(error);
      });
    });
    expect(status).toBe(403);
    expect(logs.join('\n')).not.toContain(hostileOrigin);
    expect(logs.join('\n')).not.toContain('reflected-secret');
  });

  it('does not register a session when the socket closes during asynchronous hello auth', async () => {
    const server = createServer();
    servers.push(server);
    let finishAuth!: () => void;
    let authStarted!: () => void;
    const started = new Promise<void>(resolve => {
      authStarted = resolve;
    });
    const authGate = new Promise<void>(resolve => {
      finishAuth = resolve;
    });
    const relay = new Relay({
      server,
      serverVersion: '0.1.0',
      authenticator: {
        authenticateHello: async (_input, context) => {
          authStarted();
          await authGate;
          return {
            sessionId: context.requestedSessionId,
            rotatedResumeToken: Buffer.alloc(32, 9).toString('base64url'),
            resumeExpiresAt: Date.now() + 60_000,
          };
        },
      },
    });
    relays.push(relay);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const requestedSessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({
          id: newId(),
          sessionId: requestedSessionId,
          method: SystemMethod.Hello,
          params: {
            credential: { kind: 'ticket', value: 'test-ticket' },
            nonce: Buffer.alloc(16, 8).toString('base64url'),
            protocolVersion: PROTOCOL_VERSION,
            productVersion: '0.1.0',
            pluginVersion: '0.1.0',
            pluginGeneration: 'plugin-generation-test',
            editorType: 'figma',
            mode: 'default',
            fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
            fileName: 'Async Auth Test',
            capabilities: [],
          },
        }),
      ),
    );
    await started;
    ws.close();
    await new Promise<void>(resolve => ws.once('close', () => resolve()));
    finishAuth();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(relay.sessions.list()).toHaveLength(0);
  });

  it('retains zero pre-session frames by rejecting non-hello traffic while auth is pending', async () => {
    const server = createServer();
    servers.push(server);
    let entered!: () => void;
    let release!: () => void;
    const authEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const authBarrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const relay = new Relay({
      server,
      serverVersion: '0.1.0',
      authenticator: {
        authenticateHello: async (_input, context) => {
          entered();
          await authBarrier;
          return {
            sessionId: context.requestedSessionId,
            rotatedResumeToken: Buffer.alloc(32, 81).toString('base64url'),
            resumeExpiresAt: Date.now() + 60_000,
          };
        },
      },
    });
    relays.push(relay);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const sessionId = newId();
    socket.send(
      encodeEnvelope(
        createRequest({
          id: 'pending-auth',
          sessionId,
          method: SystemMethod.Hello,
          params: {
            credential: { kind: 'ticket', value: 'test-ticket' },
            nonce: Buffer.alloc(16, 82).toString('base64url'),
            protocolVersion: PROTOCOL_VERSION,
            productVersion: '0.1.0',
            pluginVersion: '0.1.0',
            pluginGeneration: 'plugin-generation-test',
            editorType: 'figma',
            mode: 'default',
            fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
            fileName: 'Pending Auth Test',
            capabilities: [],
          },
        }),
      ),
    );
    await authEntered;
    const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    socket.send(
      encodeEnvelope(createRequest({ id: 'early-ping', sessionId, method: SystemMethod.Ping })),
    );
    const outcome = await Promise.race([
      close.then(code => ({ kind: 'close' as const, code })),
      new Promise<{ kind: 'timeout'; code: number }>(resolve =>
        setTimeout(() => resolve({ kind: 'timeout', code: 0 }), 30),
      ),
    ]);
    release();
    expect(outcome).toEqual({ kind: 'close', code: 1008 });
    expect(relay.sessions.list()).toHaveLength(0);
  });

  it.each([
    ['exact cap plus another frame', 2_048, 1008],
    ['cap plus one', 2_049, 1009],
  ])(
    'checks auth-pending raw frames before decode at %s',
    async (_case, secondFrameBytes, expectedClose) => {
      const server = createServer();
      servers.push(server);
      let entered!: () => void;
      let release!: () => void;
      const authEntered = new Promise<void>(resolve => {
        entered = resolve;
      });
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      let decodeCalls = 0;
      let commitCalls = 0;
      let provisionalResponseCalls = 0;
      const logs: string[] = [];
      const sessionId = newId();
      const relay = new Relay({
        server,
        serverVersion: '0.1.0',
        maxPayloadBytes: 2_048,
        heartbeatIntervalMs: 1,
        log: message => logs.push(message),
        beforeHelloResponse: async () => {
          provisionalResponseCalls += 1;
        },
        decodeFrame: bytes => {
          decodeCalls += 1;
          return decodeEnvelope(Buffer.from(bytes));
        },
        authenticator: {
          prepareHello: async () => {
            entered();
            await barrier;
            return {
              preparationId: Buffer.alloc(32, 110).toString('base64url'),
              result: {
                sessionId,
                rotatedResumeToken: Buffer.alloc(32, 111).toString('base64url'),
                resumeExpiresAt: Date.now() + 60_000,
              },
            };
          },
          commitHello: async () => {
            commitCalls += 1;
          },
        },
      });
      relays.push(relay);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const port = (server.address() as AddressInfo).port;
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      socket.send(
        encodeEnvelope(
          createRequest({
            id: 'raw-before-decode',
            sessionId,
            method: SystemMethod.Hello,
            params: {
              credential: { kind: 'ticket', value: 'test-ticket' },
              nonce: Buffer.alloc(16, 112).toString('base64url'),
              protocolVersion: PROTOCOL_VERSION,
              productVersion: '0.1.0',
              pluginVersion: '0.1.0',
              pluginGeneration: 'plugin-generation-test',
              editorType: 'figma',
              mode: 'default',
              fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
              fileName: 'Raw Gate Test',
              capabilities: [],
            },
          }),
        ),
      );
      await Promise.race([
        authEntered,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `authenticator was not entered (decodeCalls=${decodeCalls}, logs=${logs.join('|')})`,
                ),
              ),
            500,
          ),
        ),
      ]);
      const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
      socket.send(Buffer.alloc(secondFrameBytes));
      if (secondFrameBytes === 2_048) socket.send(Buffer.from([1, 2, 3]));
      const closeCode = await Promise.race([
        close,
        new Promise<number>(resolve => setTimeout(() => resolve(0), 500)),
      ]);
      release();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(closeCode).toBe(expectedClose);
      expect(decodeCalls).toBe(1);
      expect(commitCalls).toBe(0);
      expect(provisionalResponseCalls).toBe(0);
      expect(relay.sessions.list()).toHaveLength(0);
      expect(relay.pendingCount()).toBe(0);
      expect(relay.lastRequestAt()).toBe(0);
    },
  );

  it('logs only a generic pre-auth decode error and never attacker-controlled secret fields', async () => {
    const server = createServer();
    servers.push(server);
    const logs: string[] = [];
    const relay = new Relay({
      server,
      serverVersion: '0.1.0',
      log: message => logs.push(message),
      authenticator: {
        authenticateHello: async () => {
          throw new Error('must not authenticate malformed envelopes');
        },
      },
    });
    relays.push(relay);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(
      encode({
        v: PROTOCOL_VERSION,
        kind: 'attacker-kind',
        id: 'bad',
        sessionId: 'bad',
        ts: Date.now(),
        credential: { value: 'log-secret-value' },
      }),
    );
    await new Promise<void>(resolve => ws.once('close', () => resolve()));
    expect(logs).toContain('[relay] decode error');
    expect(logs.join('\n')).not.toContain('log-secret-value');
  });

  it('rejects an oversized declared pair body without waiting for its bytes', async () => {
    const server = createServer(async (req, res) => {
      try {
        await readBoundedBody(req, PAIR_METADATA_MAX_BYTES);
        res.writeHead(200).end();
      } catch (error) {
        res.writeHead((error as RequestLimitError).status).end();
      }
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        headers: { 'content-length': String(PAIR_METADATA_MAX_BYTES + 1) },
      });
      req.once('response', response => resolve(response.statusCode ?? 0));
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(413);
  });
});
