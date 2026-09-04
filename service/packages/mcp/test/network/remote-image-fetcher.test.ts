import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { PassThrough } from 'node:stream';
import type { TLSSocket } from 'node:tls';

import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteImageFetcher,
  REMOTE_IMAGE_LIMITS,
  type RemoteImageFetcher,
  type RemoteImagePolicy,
  type RemoteImageResolver,
  type RemoteImageRequestFactory,
  type RemoteImageRequestOptions,
} from '../../src/network/remote-image-fetcher.js';

// Fixed 2020-2040 self-signed leaf trusted only by the local test client. Its sole SAN is
// wrong.example.test, intentionally not assets.example.com. Password: sfp-test.
const WRONG_HOST_PFX_BASE64 =
  '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';
const WRONG_HOST_CERT_DER_BASE64 =
  'MIIC/DCCAeSgAwIBAgIJALeFoSyd4exEMA0GCSqGSIb3DQEBCwUAMB0xGzAZBgNVBAMTEndyb25nLmV4YW1wbGUudGVzdDAeFw0yMDAxMDEwMDAwMDBaFw00MDAxMDEwMDAwMDBaMB0xGzAZBgNVBAMTEndyb25nLmV4YW1wbGUudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALn5oX15bks7OWgfVOw/NTKHMb3EZMNHrhTt2O+CSu8myYYz/Ni9sph72IF7mzBWeng7F3lAjFUSaulFYFtrHo5wb3s4QkbtKAN6giWs8olxpvXNib23AGGqAr38iJAgxelAeeOMrXFvkFIWNSfX1Kutr1N98YBI91vaN1O9QQ2ZS3BfS2lOfJrJatitWfdtDvKnNKld/Kz9yvjs0INsIn5+9lZa4kFvRHn+fGSL6EuwQzAAUfD2lMRUYQ8Al8RMbfJbqGC54jVVh3XNYQQq3HCz1kf8HZL10r605T6PHEWhZ1EPA4pl0qdecnHPWKe7+S/3sZsqY4SeXkOXAuaUQMUCAwEAAaM/MD0wHQYDVR0RBBYwFIISd3JvbmcuZXhhbXBsZS50ZXN0MAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgWgMA0GCSqGSIb3DQEBCwUAA4IBAQB786tKlSOTY5NnxvMklAbOlJlovUtWba8aIAEkQ0tiazyL7OVrF+jzfC2uC9WA8GAuFL3Zdw8ntNwxwOuRq6PfNBWm4R8TG8aZ1a2z9nnd3/sJ75vWfywOWMHdYonsLoVeRDtDtcMJjCRncuyoZUySMeqyG5JhJxORQbNiyl5GdlsZbQMrhD2wjo3ibZotlsbqPS0Y7d/82+isT6ca0+z7Z7366K1Q6IL/V3L3mGVMBEXMIXH5GkPqpIQxT3dMXhPBm6VGIY/dh14x9A8erTk4QfO5ndxYVMo1aVpMCbEPs6G34OpJvT+jsuuxWJxkOR9OoCmtJs1wr+/wVAzvrEPr';

const certificatePem = (derBase64: string): string =>
  `-----BEGIN CERTIFICATE-----\n${derBase64.match(/.{1,64}/gu)?.join('\n') ?? ''}\n-----END CERTIFICATE-----\n`;

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_IHDR = Buffer.concat([
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13),
  Buffer.alloc(4),
]);
const PNG_IEND = Buffer.from('0000000049454e4400000000', 'hex');
const pngBytes = (size = PNG_SIGNATURE.length + PNG_IHDR.length + PNG_IEND.length): Buffer => {
  if (size < PNG_SIGNATURE.length + PNG_IHDR.length + PNG_IEND.length) {
    throw new Error('PNG fixture size is too small');
  }
  const bytes = Buffer.alloc(size);
  PNG_SIGNATURE.copy(bytes, 0);
  PNG_IHDR.copy(bytes, PNG_SIGNATURE.length);
  PNG_IEND.copy(bytes, size - PNG_IEND.length);
  return bytes;
};
const webpContainer = (chunks: readonly Readonly<{ type: string; bytes: Buffer }>[]): Buffer => {
  const payloadBytes = chunks.reduce(
    (total, chunk) => total + 8 + chunk.bytes.byteLength + (chunk.bytes.byteLength % 2),
    0,
  );
  const bytes = Buffer.alloc(12 + payloadBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  let offset = 12;
  for (const chunk of chunks) {
    bytes.write(chunk.type, offset, 'ascii');
    bytes.writeUInt32LE(chunk.bytes.byteLength, offset + 4);
    chunk.bytes.copy(bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength + (chunk.bytes.byteLength % 2);
  }
  return bytes;
};
const webpBytes = (chunkType = 'VP8 ', chunkBytes = Buffer.from([1])): Buffer =>
  webpContainer([{ type: chunkType, bytes: chunkBytes }]);
const extendedWebpBytes = (): Buffer =>
  webpContainer([
    { type: 'VP8X', bytes: Buffer.alloc(10) },
    { type: 'VP8 ', bytes: Buffer.from([1]) },
  ]);
const PNG = pngBytes();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]);
const GIF = Buffer.from('GIF89a;');
const WEBP = webpBytes();

type FetchSignal = Parameters<RemoteImageFetcher['fetchApproved']>[2];
const compileTimeAbortSignal: AbortSignal = null as unknown as FetchSignal;
void compileTimeAbortSignal;

const policy = (overrides: Partial<RemoteImagePolicy> = {}): RemoteImagePolicy => ({
  allowedDomains: ['assets.example.com'],
  maxRedirects: 3,
  maxBytes: REMOTE_IMAGE_LIMITS.maxDecodedBytes,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  ...overrides,
});

interface RequestScript {
  status?: number;
  headers?: readonly (readonly [string, string])[];
  chunks?: readonly Buffer[];
  peerAddress?: string;
  peerFamily?: 'IPv4' | 'IPv6';
  lookupHost?: string;
  lookupMode?: 'once' | 'twice' | 'none';
  lookupAll?: boolean;
  omitSecureConnect?: boolean;
  omitResponse?: boolean;
  responseDelayMs?: number;
  synchronousCloseOnDestroy?: boolean;
  socketCloseDelayMs?: number;
  omitEnd?: boolean;
  afterResponse?: () => void;
  afterChunk?: (index: number) => void;
  afterLookup?: () => void;
  afterSocket?: () => void;
  afterSecureConnect?: () => void;
  complete?: boolean;
  reusedSocket?: boolean;
}

const requestHarness = (scripts: readonly RequestScript[]) => {
  const options: RemoteImageRequestOptions[] = [];
  const destroyedRequests: boolean[] = [];
  const destroyedResponses: boolean[] = [];
  const destroyedSockets: boolean[] = [];
  const closedSockets: boolean[] = [];
  let requestIndex = 0;
  const requestFactory = ((requestOptions, onResponse) => {
    const script = scripts[requestIndex++] ?? {};
    options.push(requestOptions);
    const requestEvents = new EventEmitter();
    const socketEvents = new EventEmitter();
    const socket = Object.assign(socketEvents, {
      remoteAddress: script.peerAddress ?? '8.8.8.8',
      remoteFamily: script.peerFamily ?? 'IPv4',
      destroyed: false,
      closed: false,
      destroy: () => {
        Object.defineProperty(socket, 'destroyed', { value: true, configurable: true });
        destroyedSockets.push(true);
        const close = () => {
          Object.defineProperty(socket, 'closed', { value: true, configurable: true });
          closedSockets.push(true);
          socketEvents.emit('close');
        };
        if (script.socketCloseDelayMs === undefined) close();
        else setTimeout(close, script.socketCloseDelayMs);
        return socket;
      },
    }) as unknown as TLSSocket;
    let requestDestroyed = false;
    const clientRequest = Object.assign(requestEvents, {
      destroyed: false,
      reusedSocket: script.reusedSocket ?? false,
      end: () => {
        queueMicrotask(() => {
          if (requestDestroyed) return;
          const deliver = () => {
            requestEvents.emit('socket', socket);
            script.afterSocket?.();
            if (script.omitSecureConnect === true) return;
            socketEvents.emit('secureConnect');
            script.afterSecureConnect?.();
            if (script.omitResponse === true) return;
            const respond = () => {
              const response = new PassThrough({ autoDestroy: false }) as PassThrough & {
                statusCode?: number;
                rawHeaders: string[];
                socket: TLSSocket;
              };
              response.statusCode = script.status ?? 200;
              response.rawHeaders = (
                script.headers ?? [
                  ['Content-Type', 'image/png'],
                  ['Content-Length', String(PNG.byteLength)],
                ]
              ).flatMap(([name, value]) => [name, value]);
              response.socket = socket;
              Object.defineProperty(response, 'complete', {
                value: script.complete ?? true,
                configurable: true,
              });
              const destroy = response.destroy.bind(response);
              response.destroy = error => {
                destroyedResponses.push(true);
                if (script.synchronousCloseOnDestroy === true) response.emit('close');
                return destroy(error);
              };
              onResponse(response as unknown as IncomingMessage);
              script.afterResponse?.();
              queueMicrotask(() => {
                for (const [index, chunk] of (script.chunks ?? [PNG]).entries()) {
                  if (response.destroyed) break;
                  response.write(chunk);
                  script.afterChunk?.(index);
                }
                if (script.omitEnd !== true && !response.destroyed) response.end();
              });
            };
            if (script.responseDelayMs === undefined) respond();
            else setTimeout(respond, script.responseDelayMs);
          };
          const lookupMode = script.lookupMode ?? 'once';
          if (lookupMode === 'none') {
            deliver();
            return;
          }
          const invokeLookup = () =>
            requestOptions.lookup(
              script.lookupHost ?? requestOptions.hostname,
              { all: script.lookupAll === true },
              (error, address, family) => {
                if (error !== null) {
                  requestEvents.emit('error', error);
                  return;
                }
                if (script.peerAddress === undefined && typeof address === 'string') {
                  Object.assign(socket, {
                    remoteAddress: address,
                    remoteFamily: family === 6 ? 'IPv6' : 'IPv4',
                  });
                }
                script.afterLookup?.();
                deliver();
              },
            );
          invokeLookup();
          if (lookupMode === 'twice') invokeLookup();
        });
        return clientRequest;
      },
      destroy: (error?: Error) => {
        if (requestDestroyed) return clientRequest;
        requestDestroyed = true;
        destroyedRequests.push(true);
        if (!socket.destroyed) socket.destroy();
        if (error !== undefined) queueMicrotask(() => requestEvents.emit('error', error));
        requestEvents.emit('close');
        return clientRequest;
      },
      setTimeout: () => clientRequest,
    }) as unknown as ClientRequest;
    return clientRequest;
  }) as RemoteImageRequestFactory;
  return {
    request: requestFactory,
    options,
    destroyedRequests,
    destroyedResponses,
    destroyedSockets,
    closedSockets,
  };
};

const successFetcher = (
  scripts: readonly RequestScript[],
  resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 as const }]),
) => {
  const harness = requestHarness(scripts);
  return {
    harness,
    resolver,
    fetcher: createRemoteImageFetcher({ resolver, request: harness.request }),
  };
};

describe('remote image fetcher', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP],
  ] as const)('accepts %s only when MIME and signature agree', async (mime, bytes) => {
    const { fetcher } = successFetcher([
      {
        headers: [
          ['Content-Type', mime],
          ['Content-Length', String(bytes.byteLength)],
        ],
        chunks: [bytes],
      },
    ]);
    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/image',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ bytes, mime });
  });

  it.each([
    ['VP8L', webpBytes('VP8L')],
    ['VP8X', extendedWebpBytes()],
  ] as const)('accepts a bounded WebP %s image chunk', async (_chunkType, bytes) => {
    const { fetcher } = successFetcher([
      { headers: [['Content-Type', 'image/webp']], chunks: [bytes] },
    ]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).resolves.toMatchObject({ bytes, mime: 'image/webp' });
  });

  it('pins one vetted address while preserving exact Host, SNI, certificate defaults and no agent', async () => {
    const { fetcher, resolver, harness } = successFetcher([{ chunks: [PNG] }]);
    const result = await fetcher.fetchApproved(
      'https://assets.example.com/a.png?secret=hidden',
      policy(),
      new AbortController().signal,
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('assets.example.com', expect.any(AbortSignal));
    expect(harness.options).toHaveLength(1);
    expect(harness.options[0]).toMatchObject({
      protocol: 'https:',
      hostname: 'assets.example.com',
      port: 443,
      servername: 'assets.example.com',
      agent: false,
      family: 4,
      autoSelectFamily: false,
      maxHeaderSize: 16_384,
      headers: { Host: 'assets.example.com', 'Accept-Encoding': 'identity' },
    });
    expect(harness.options[0]?.checkServerIdentity).toBeUndefined();
    expect(result.finalUrlHash).toBe(
      `sha256:${createHash('sha256')
        .update('https://assets.example.com/a.png?secret=hidden')
        .digest('hex')}`,
    );
    expect(JSON.stringify(result)).not.toContain('secret=hidden');
  });

  it('passes the 16 KiB parser cap into a real Node ClientRequest', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'image/png',
        'x-overflow': 'x'.repeat(REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes),
      });
      response.end(PNG);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server address missing');
    let observedMaxHeaderSize: number | undefined;
    const request: RemoteImageRequestFactory = (options, onResponse) => {
      observedMaxHeaderSize = options.maxHeaderSize;
      let lookupError: NodeJS.ErrnoException | null = null;
      options.lookup(options.hostname, { all: false, family: options.family }, error => {
        lookupError = error;
      });
      if (lookupError !== null) throw lookupError;
      const client = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/',
          method: 'GET',
          agent: false,
          maxHeaderSize: options.maxHeaderSize,
        },
        onResponse,
      );
      client.once('socket', socket => {
        Object.defineProperties(socket, {
          remoteAddress: { value: '8.8.8.8', configurable: true },
          remoteFamily: { value: 'IPv4', configurable: true },
        });
        socket.once('connect', () => socket.emit('secureConnect'));
      });
      return client;
    };
    const fetcher = createRemoteImageFetcher({
      resolver: vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]),
      request,
    });
    try {
      await expect(
        fetcher.fetchApproved(
          'https://assets.example.com/a',
          policy(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'REMOTE_REQUEST_FAILED' });
      expect(observedMaxHeaderSize).toBe(REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('uses the real default TLS hostname checker for a trusted wrong-host certificate', async () => {
    const server = createHttpsServer(
      {
        pfx: Buffer.from(WRONG_HOST_PFX_BASE64, 'base64'),
        passphrase: 'sfp-test',
      },
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(PNG);
      },
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server address missing');
    let rawTlsCode: string | undefined;
    let observedOptions: RemoteImageRequestOptions | undefined;
    const request: RemoteImageRequestFactory = (options, onResponse) => {
      observedOptions = options;
      let lookupError: NodeJS.ErrnoException | null = null;
      options.lookup(options.hostname, { all: false, family: options.family }, error => {
        lookupError = error;
      });
      if (lookupError !== null) throw lookupError;
      const client = httpsRequest(
        {
          ...options,
          hostname: '127.0.0.1',
          port: address.port,
          lookup: undefined,
          ca: certificatePem(WRONG_HOST_CERT_DER_BASE64),
        },
        onResponse,
      );
      client.once('error', error => {
        rawTlsCode = (error as NodeJS.ErrnoException).code;
      });
      return client;
    };
    const fetcher = createRemoteImageFetcher({
      resolver: vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]),
      request,
    });
    try {
      await expect(
        fetcher.fetchApproved(
          'https://assets.example.com/a',
          policy(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'REMOTE_REQUEST_FAILED' });
      expect(rawTlsCode).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      expect(observedOptions?.servername).toBe('assets.example.com');
      expect(observedOptions?.checkServerIdentity).toBeUndefined();
      expect(
        (
          observedOptions as
            | (RemoteImageRequestOptions & { rejectUnauthorized?: boolean })
            | undefined
        )?.rejectUnauthorized,
      ).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each([
    ['http://assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['file:///a.png', 'REMOTE_URL_INVALID'],
    ['data:image/png;base64,AA==', 'REMOTE_URL_INVALID'],
    ['https://user:pass@assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['https://127.0.0.1/a.png', 'REMOTE_URL_INVALID'],
    ['https://[::1]/a.png', 'REMOTE_URL_INVALID'],
    ['https://2130706433/a.png', 'REMOTE_URL_INVALID'],
    ['https://0177.0.0.1/a.png', 'REMOTE_URL_INVALID'],
    ['https://0x7f000001/a.png', 'REMOTE_URL_INVALID'],
    [`\u0000https://assets.example.com/a.png`, 'REMOTE_URL_INVALID'],
    [' https://assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com/a b.png', 'REMOTE_URL_INVALID'],
    ['https:\\assets.example.com\\a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com%2f@evil.example/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com%5c@evil.example/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com%40evil.example/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com%3a443/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets%2eexample%2ecom/a.png', 'REMOTE_URL_INVALID'],
    ['https:///assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['https:////assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['https://@assets.example.com/a.png', 'REMOTE_URL_INVALID'],
    ['https://assets.example.com./a.png', 'REMOTE_URL_INVALID'],
    ['https://img.assets.example.com/a.png', 'REMOTE_DOMAIN_NOT_ALLOWED'],
    ['https://other.example.com/a.png', 'REMOTE_DOMAIN_NOT_ALLOWED'],
    ['https://assets.example.com:444/a.png', 'REMOTE_URL_INVALID'],
  ])('rejects %s before DNS', async (url, code) => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [
      { address: '8.8.8.8', family: 4 as const },
    ]);
    const harness = requestHarness([]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });
    await expect(
      fetcher.fetchApproved(url, policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.options).toEqual([]);
  });

  it('does not let policy approval expand an empty domain allowlist', async () => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [
      { address: '8.8.8.8', family: 4 as const },
    ]);
    const fetcher = createRemoteImageFetcher({ resolver, request: requestHarness([]).request });
    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/a.png',
        policy({ allowedDomains: [] }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_NOT_ALLOWED' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('re-admits and resolves each relative redirect exactly once, destroying the prior response', async () => {
    const resolver = vi.fn<RemoteImageResolver>(async (hostname: string) => [
      { address: hostname === 'assets.example.com' ? '8.8.8.8' : '1.1.1.1', family: 4 as const },
    ]);
    const harness = requestHarness([
      {
        status: 302,
        headers: [['Location', '/second']],
        synchronousCloseOnDestroy: true,
      },
      {
        status: 307,
        headers: [['Location', 'https://cdn.example.com/final.png']],
        synchronousCloseOnDestroy: true,
      },
      { chunks: [PNG] },
    ]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/first',
        policy({ allowedDomains: ['assets.example.com', 'cdn.example.com'] }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });
    expect(resolver.mock.calls.map(call => call[0])).toEqual([
      'assets.example.com',
      'assets.example.com',
      'cdn.example.com',
    ]);
    expect(harness.destroyedResponses).toHaveLength(2);
    expect(harness.options).toHaveLength(3);
  });

  it('waits for the prior redirect socket to close before starting the next DNS hop', async () => {
    let harness!: ReturnType<typeof requestHarness>;
    const observedClosedBeforeResolution: boolean[] = [];
    const resolver = vi.fn<RemoteImageResolver>(async () => {
      observedClosedBeforeResolution.push(harness.closedSockets.length > 0);
      return [{ address: '8.8.8.8', family: 4 }];
    });
    harness = requestHarness([
      {
        status: 302,
        headers: [['Location', '/next']],
        socketCloseDelayMs: 30,
      },
      { chunks: [PNG] },
    ]);
    const fetcher = createRemoteImageFetcher({
      resolver,
      request: harness.request,
      timeouts: { bodyIdleMs: 100 },
    });

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/start',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });
    expect(observedClosedBeforeResolution).toEqual([false, true]);
  });

  it.each(['timeout', 'abort'] as const)(
    'settles redirect cleanup on bounded %s without starting another DNS hop',
    async outcome => {
      const controller = new AbortController();
      const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
      const harness = requestHarness([
        {
          status: 302,
          headers: [['Location', '/next']],
          socketCloseDelayMs: 40,
          ...(outcome === 'abort'
            ? { afterResponse: () => setTimeout(() => controller.abort(), 5) }
            : {}),
        },
      ]);
      const fetcher = createRemoteImageFetcher({
        resolver,
        request: harness.request,
        timeouts: { bodyIdleMs: 15, wholeFetchMs: 100 },
      });

      await expect(
        fetcher.fetchApproved('https://assets.example.com/a', policy(), controller.signal),
      ).rejects.toMatchObject(
        outcome === 'abort'
          ? { name: 'AbortError', code: 'ABORT_ERR' }
          : { code: 'REMOTE_REDIRECT_CLEANUP_TIMEOUT' },
      );
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(harness.options).toHaveLength(1);
      await new Promise(resolve => setTimeout(resolve, 45));
    },
  );

  it('rejects a mixed private DNS set on a redirect before opening its next request', async () => {
    let resolution = 0;
    const resolver = vi.fn<RemoteImageResolver>(async () => {
      resolution += 1;
      return resolution === 1
        ? [{ address: '8.8.8.8', family: 4 }]
        : [
            { address: '1.1.1.1', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ];
    });
    const harness = requestHarness([{ status: 302, headers: [['Location', '/next']] }]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/start',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_ADDRESS_DENIED' });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(harness.options).toHaveLength(1);
  });

  it('accepts the exact raw-header and redirect-location bounds', async () => {
    const exactHeaderFill = 'x'.repeat(16_347);
    await expect(
      successFetcher([
        {
          headers: [
            ['Content-Type', 'image/png'],
            ['X-Fill', exactHeaderFill],
          ],
          chunks: [PNG],
        },
      ]).fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });

    const exactLocation = `/${'a'.repeat(4_095)}`;
    await expect(
      successFetcher([
        { status: 302, headers: [['Location', exactLocation]] },
        { chunks: [PNG] },
      ]).fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });
  });

  it.each([
    ['unlisted', [['Location', 'https://cdn.example.com/a.png']], 'REMOTE_DOMAIN_NOT_ALLOWED'],
    ['downgrade', [['Location', 'http://assets.example.com/a.png']], 'REMOTE_URL_INVALID'],
    ['missing', [], 'REMOTE_REDIRECT_INVALID'],
    [
      'duplicate',
      [
        ['Location', '/a'],
        ['Location', '/b'],
      ],
      'REMOTE_REDIRECT_INVALID',
    ],
    ['oversized', [['Location', `/${'a'.repeat(4_097)}`]], 'REMOTE_REDIRECT_INVALID'],
  ] as const)('rejects %s redirect without a next request', async (_name, headers, code) => {
    const { fetcher, harness } = successFetcher([{ status: 302, headers }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect(harness.options).toHaveLength(1);
    expect(harness.destroyedResponses).toHaveLength(1);
  });

  it.each([
    ['absolute internal space', 'https://assets.example.com/next path'],
    ['absolute backslash', 'https:\\assets.example.com\\next'],
    ['absolute encoded dot', 'https://assets%2eexample%2ecom/next'],
    ['absolute empty authority', 'https:///assets.example.com/next'],
    ['absolute empty authority with four slashes', 'https:////assets.example.com/next'],
    ['absolute empty userinfo', 'https://@assets.example.com/next'],
    ['protocol-relative encoded dot', '//assets%2eexample%2ecom/next'],
    ['protocol-relative empty userinfo', '//@assets.example.com/next'],
  ])('rejects raw redirect Location alias %s before a second hop', async (_name, location) => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const harness = requestHarness([{ status: 302, headers: [['Location', location]] }]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/start',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^REMOTE_(?:HEADERS|REDIRECT)_INVALID$/u),
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(harness.options).toHaveLength(1);
  });

  it('lets the real Node parser reject a NUL Location before response delivery', async () => {
    const server = createNetServer(socket => {
      socket.once('data', () => {
        socket.end(
          Buffer.concat([
            Buffer.from('HTTP/1.1 302 Found\r\nLocation: https://assets.example.com/'),
            Buffer.from([0]),
            Buffer.from('next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'),
          ]),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server address missing');
    let responses = 0;
    try {
      const parserError = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port: address.port }, response => {
          responses += 1;
          response.resume();
          reject(new Error('NUL header unexpectedly reached the response callback'));
        });
        request.once('error', error => resolve(error));
        request.end();
      });
      expect(parserError.code).toBe('HPE_INVALID_HEADER_TOKEN');
      expect(responses).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each([
    ['three slashes', '///assets.example.com/next'],
    ['four slashes', '////assets.example.com/next'],
    ['three slashes plus encoded authority dots', '///assets%2eexample%2ecom/next'],
    ['four slashes plus encoded authority dots', '////assets%2eexample%2ecom/next'],
  ])('rejects protocol-relative redirect alias %s before a second hop', async (_name, location) => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const harness = requestHarness([{ status: 302, headers: [['Location', location]] }]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/start',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_REDIRECT_INVALID' });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(harness.options).toHaveLength(1);
  });

  it('allows exactly two leading slashes for a protocol-relative redirect', async () => {
    const { fetcher, resolver, harness } = successFetcher([
      { status: 302, headers: [['Location', '//assets.example.com/next']] },
      { chunks: [PNG] },
    ]);

    await expect(
      fetcher.fetchApproved(
        'https://assets.example.com/start',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(harness.options).toHaveLength(2);
    expect(harness.options[1]?.path).toBe('/next');
  });

  it('allows exactly three redirects and rejects a fourth or a loop', async () => {
    const redirects: RequestScript[] = [
      { status: 302, headers: [['Location', '/b']] },
      { status: 302, headers: [['Location', '/c']] },
      { status: 302, headers: [['Location', '/d']] },
      { chunks: [PNG] },
    ];
    await expect(
      successFetcher(redirects).fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mime: 'image/png' });
    const fourth = successFetcher([
      ...redirects.slice(0, 3),
      { status: 302, headers: [['Location', '/e']] },
    ]);
    await expect(
      fourth.fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_REDIRECT_LIMIT_EXCEEDED' });
    const loop = successFetcher([{ status: 302, headers: [['Location', '/a']] }]);
    await expect(
      loop.fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_REDIRECT_LOOP' });
  });

  it.each([
    ['missing MIME', [['Content-Length', String(PNG.byteLength)]], PNG, 'REMOTE_MIME_INVALID'],
    [
      'duplicate MIME',
      [
        ['Content-Type', 'image/png'],
        ['Content-Type', 'image/png'],
      ],
      PNG,
      'REMOTE_MIME_INVALID',
    ],
    ['MIME parameters', [['Content-Type', 'image/png; charset=x']], PNG, 'REMOTE_MIME_INVALID'],
    ['wrong signature', [['Content-Type', 'image/jpeg']], PNG, 'REMOTE_SIGNATURE_INVALID'],
    [
      'truncated signature',
      [['Content-Type', 'image/png']],
      PNG.subarray(0, 4),
      'REMOTE_SIGNATURE_INVALID',
    ],
    [
      'gzip',
      [
        ['Content-Type', 'image/png'],
        ['Content-Encoding', 'gzip'],
      ],
      PNG,
      'REMOTE_ENCODING_DENIED',
    ],
    [
      'br',
      [
        ['Content-Type', 'image/png'],
        ['Content-Encoding', 'br'],
      ],
      PNG,
      'REMOTE_ENCODING_DENIED',
    ],
  ] as const)('rejects %s and destroys the response', async (_name, headers, bytes, code) => {
    const { fetcher, harness } = successFetcher([{ headers, chunks: [bytes] }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect(harness.destroyedResponses.length).toBeGreaterThan(0);
  });

  it.each([
    ['JPEG without EOI', 'image/jpeg', JPEG.subarray(0, -2)],
    [
      'PNG with non-13-byte IHDR',
      'image/png',
      (() => {
        const bytes = Buffer.from(PNG);
        bytes.writeUInt32BE(12, 8);
        return bytes;
      })(),
    ],
    [
      'PNG without first IHDR',
      'image/png',
      (() => {
        const bytes = Buffer.from(PNG);
        bytes.write('IDAT', 12, 'ascii');
        return bytes;
      })(),
    ],
    ['PNG without IEND', 'image/png', PNG.subarray(0, -PNG_IEND.length)],
    ['GIF without trailer', 'image/gif', Buffer.from('GIF89a!')],
    [
      'WebP with mismatched RIFF length',
      'image/webp',
      (() => {
        const bytes = Buffer.from(WEBP);
        bytes.writeUInt32LE(bytes.byteLength - 7, 4);
        return bytes;
      })(),
    ],
    ['WebP without an image chunk', 'image/webp', webpBytes('JUNK')],
    ['WebP VP8X without image payload', 'image/webp', webpBytes('VP8X', Buffer.alloc(10))],
    ['WebP VP8X with the wrong fixed chunk size', 'image/webp', webpBytes('VP8X')],
    [
      'WebP with an out-of-range image chunk',
      'image/webp',
      (() => {
        const bytes = Buffer.from(WEBP);
        bytes.writeUInt32LE(bytes.byteLength, 16);
        return bytes;
      })(),
    ],
  ] as const)('rejects malformed %s container structure', async (_name, mime, bytes) => {
    const { fetcher } = successFetcher([{ headers: [['Content-Type', mime]], chunks: [bytes] }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'REMOTE_SIGNATURE_INVALID' });
  });

  it('rejects end-of-stream unless IncomingMessage.complete is true', async () => {
    const { fetcher } = successFetcher([{ chunks: [PNG], complete: false }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'REMOTE_BODY_TRUNCATED' });
  });

  it.each([204, 404, 500])('rejects non-200 status %s', async status => {
    const { fetcher } = successFetcher([{ status, headers: [] }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'REMOTE_STATUS_INVALID' });
  });

  it('accepts the exact 6 MiB body and rejects declared or streamed max plus one', async () => {
    const exact = pngBytes(REMOTE_IMAGE_LIMITS.maxDecodedBytes);
    await expect(
      successFetcher([
        {
          headers: [
            ['Content-Type', 'image/png'],
            ['Content-Length', String(exact.byteLength)],
          ],
          chunks: [exact],
        },
      ]).fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ bytes: exact });

    const declared = successFetcher([
      {
        headers: [
          ['Content-Type', 'image/png'],
          ['Content-Length', String(exact.byteLength + 1)],
        ],
        chunks: [],
      },
    ]);
    await expect(
      declared.fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_BODY_TOO_LARGE', beforeRead: true, bytesRead: 0 });

    const streamed = pngBytes(REMOTE_IMAGE_LIMITS.maxDecodedBytes + 1);
    await expect(
      successFetcher([
        { headers: [['Content-Type', 'image/png']], chunks: [streamed] },
      ]).fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_BODY_TOO_LARGE', beforeRead: false });
  }, 30_000);

  it('enforces explicit chunked bodies below, at, and above the decoded limit', async () => {
    const chunkedHeaders = [
      ['Content-Type', 'image/png'],
      ['Transfer-Encoding', 'chunked'],
    ] as const;
    await expect(
      successFetcher([{ headers: chunkedHeaders, chunks: [PNG] }]).fetcher.fetchApproved(
        'https://assets.example.com/below',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ bytes: PNG });

    const exact = pngBytes(REMOTE_IMAGE_LIMITS.maxDecodedBytes);
    await expect(
      successFetcher([{ headers: chunkedHeaders, chunks: [exact] }]).fetcher.fetchApproved(
        'https://assets.example.com/exact',
        policy(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ bytes: exact });

    const oversized = pngBytes(REMOTE_IMAGE_LIMITS.maxDecodedBytes + 1);
    const over = successFetcher([{ headers: chunkedHeaders, chunks: [oversized] }]);
    let resultCount = 0;
    await expect(
      over.fetcher
        .fetchApproved('https://assets.example.com/over', policy(), new AbortController().signal)
        .then(result => {
          resultCount += 1;
          return result;
        }),
    ).rejects.toMatchObject({ code: 'REMOTE_BODY_TOO_LARGE', beforeRead: false });
    expect(resultCount).toBe(0);
    expect(over.harness.options).toHaveLength(1);
  }, 30_000);

  it.each([
    [
      'duplicate length',
      [
        ['Content-Type', 'image/png'],
        ['Content-Length', '9'],
        ['Content-Length', '9'],
      ],
      'REMOTE_CONTENT_LENGTH_INVALID',
    ],
    [
      'noncanonical length',
      [
        ['Content-Type', 'image/png'],
        ['Content-Length', '09'],
      ],
      'REMOTE_CONTENT_LENGTH_INVALID',
    ],
    [
      'transfer length conflict',
      [
        ['Content-Type', 'image/png'],
        ['Content-Length', '9'],
        ['Transfer-Encoding', 'chunked'],
      ],
      'REMOTE_CONTENT_LENGTH_INVALID',
    ],
  ] as const)('rejects %s', async (_name, headers, code) => {
    const { fetcher } = successFetcher([{ headers, chunks: [PNG] }]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
  });

  it('rejects a lying Content-Length and over-bound raw headers', async () => {
    const lying = successFetcher([
      {
        headers: [
          ['Content-Type', 'image/png'],
          ['Content-Length', '10'],
        ],
        chunks: [PNG],
      },
    ]);
    await expect(
      lying.fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_CONTENT_LENGTH_MISMATCH' });

    const headers = successFetcher([
      {
        headers: [
          ['Content-Type', 'image/png'],
          ['X-Fill', 'x'.repeat(REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes)],
        ],
        chunks: [PNG],
      },
    ]);
    await expect(
      headers.fetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_HEADERS_TOO_LARGE' });
  });

  it.each([
    ['wrong lookup host', { lookupHost: 'other.example.com' }, 'REMOTE_DNS_PIN_VIOLATION'],
    ['second lookup', { lookupMode: 'twice' as const }, 'REMOTE_DNS_PIN_VIOLATION'],
    ['fallback lookup', { lookupAll: true }, 'REMOTE_DNS_PIN_VIOLATION'],
    ['missing lookup', { lookupMode: 'none' as const }, 'REMOTE_DNS_PIN_VIOLATION'],
    ['reused socket', { reusedSocket: true }, 'REMOTE_DNS_PIN_VIOLATION'],
    ['peer drift', { peerAddress: '1.1.1.1' }, 'REMOTE_ADDRESS_CHANGED'],
  ])('fails closed for %s with no fallback', async (_name, script, code) => {
    const { fetcher, harness } = successFetcher([script]);
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect(harness.options).toHaveLength(1);
    expect(harness.destroyedRequests.length + harness.destroyedResponses.length).toBeGreaterThan(0);
  });

  it('aborts pending DNS once and ignores a late resolver callback', async () => {
    let resolveDns!: (rows: readonly [{ address: string; family: 4 }]) => void;
    const resolver = vi.fn<RemoteImageResolver>(
      () =>
        new Promise<readonly [{ address: string; family: 4 }]>(resolve => {
          resolveDns = resolve;
        }),
    );
    const harness = requestHarness([]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });
    const controller = new AbortController();
    let settlements = 0;
    const pending = fetcher
      .fetchApproved('https://assets.example.com/a', policy(), controller.signal)
      .then(
        () => {
          settlements += 1;
          return null;
        },
        error => {
          settlements += 1;
          return error as Error;
        },
      );
    controller.abort();
    await expect(pending).resolves.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    resolveDns([{ address: '8.8.8.8', family: 4 }]);
    await new Promise(resolve => setImmediate(resolve));
    expect(settlements).toBe(1);
    expect(harness.options).toEqual([]);
  });

  it('aborts each DNS child signal on phase timeout and after terminal success', async () => {
    let timedOutSignal: AbortSignal | undefined;
    const timedOutResolver = vi.fn<RemoteImageResolver>(
      (_hostname, signal) =>
        new Promise((_resolve, reject) => {
          timedOutSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const timedOutFetcher = createRemoteImageFetcher({
      resolver: timedOutResolver,
      request: requestHarness([]).request,
      timeouts: { dnsMs: 15, wholeFetchMs: 100 },
    });
    await expect(
      timedOutFetcher.fetchApproved(
        'https://assets.example.com/a',
        policy(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_DNS_TIMEOUT' });
    expect(timedOutSignal?.aborted).toBe(true);

    let successfulSignal: AbortSignal | undefined;
    const successfulResolver = vi.fn<RemoteImageResolver>(async (_hostname, signal) => {
      successfulSignal = signal;
      return [{ address: '8.8.8.8', family: 4 }];
    });
    const successful = successFetcher([{ chunks: [PNG] }], successfulResolver);
    await successful.fetcher.fetchApproved(
      'https://assets.example.com/a',
      policy(),
      new AbortController().signal,
    );
    expect(successfulSignal?.aborted).toBe(true);
  });

  it('rejects a pre-aborted request before DNS and aborts between redirect hops', async () => {
    const preResolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const preHarness = requestHarness([]);
    const preFetcher = createRemoteImageFetcher({
      resolver: preResolver,
      request: preHarness.request,
    });
    const preController = new AbortController();
    preController.abort();
    await expect(
      preFetcher.fetchApproved('https://assets.example.com/a', policy(), preController.signal),
    ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(preResolver).not.toHaveBeenCalled();
    expect(preHarness.options).toEqual([]);

    const redirectController = new AbortController();
    const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const harness = requestHarness([
      {
        status: 302,
        headers: [['Location', '/next']],
        afterResponse: () => redirectController.abort(),
      },
    ]);
    const fetcher = createRemoteImageFetcher({ resolver, request: harness.request });
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), redirectController.signal),
    ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(harness.options).toHaveLength(1);
    expect(harness.destroyedResponses.length).toBeGreaterThan(0);
  });

  it('destroys request, socket and response on a body abort without late success', async () => {
    const controller = new AbortController();
    const { fetcher, harness } = successFetcher([
      {
        headers: [['Content-Type', 'image/png']],
        chunks: [PNG.subarray(0, 8), Buffer.from([1])],
        afterChunk: index => {
          if (index === 0) controller.abort();
        },
      },
    ]);
    let settlements = 0;
    const result = await fetcher
      .fetchApproved('https://assets.example.com/a', policy(), controller.signal)
      .then(
        () => {
          settlements += 1;
          return null;
        },
        error => {
          settlements += 1;
          return error as Error;
        },
      );
    expect(result).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    await new Promise(resolve => setImmediate(resolve));
    expect(settlements).toBe(1);
    expect(harness.destroyedRequests.length).toBeGreaterThan(0);
    expect(harness.destroyedResponses.length).toBeGreaterThan(0);
    expect(harness.destroyedSockets.length).toBeGreaterThan(0);
  });

  it.each(['connect', 'TLS', 'headers'] as const)(
    'honors caller abort during %s admission with one transport cleanup',
    async phase => {
      const controller = new AbortController();
      const script: RequestScript =
        phase === 'connect'
          ? { afterLookup: () => controller.abort() }
          : phase === 'TLS'
            ? { afterSocket: () => controller.abort(), omitSecureConnect: true }
            : { afterSecureConnect: () => controller.abort(), omitResponse: true };
      const { fetcher, harness } = successFetcher([script]);
      await expect(
        fetcher.fetchApproved('https://assets.example.com/a', policy(), controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(harness.options).toHaveLength(1);
      expect(harness.destroyedRequests.length).toBeGreaterThan(0);
      expect(harness.destroyedSockets.length).toBeGreaterThan(0);
    },
  );

  it('lets the whole-fetch timeout abort a pending DNS operation exactly once', async () => {
    let resolverSignal: AbortSignal | undefined;
    const resolver = vi.fn<RemoteImageResolver>(
      (_hostname, signal) =>
        new Promise((_resolve, reject) => {
          resolverSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const harness = requestHarness([]);
    const fetcher = createRemoteImageFetcher({
      resolver,
      request: harness.request,
      timeouts: { dnsMs: 100, wholeFetchMs: 15 },
    });
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'REMOTE_FETCH_TIMEOUT' });
    expect(resolverSignal?.aborted).toBe(true);
    expect(harness.options).toEqual([]);
  });

  it.each([
    ['DNS', { dnsMs: 15, wholeFetchMs: 100 }, {}, 'REMOTE_DNS_TIMEOUT'],
    [
      'TLS',
      { connectTlsMs: 15, wholeFetchMs: 100 },
      { omitSecureConnect: true },
      'REMOTE_CONNECT_TIMEOUT',
    ],
    [
      'headers',
      { responseHeaderMs: 15, wholeFetchMs: 100 },
      { omitResponse: true },
      'REMOTE_HEADERS_TIMEOUT',
    ],
    [
      'body idle',
      { bodyIdleMs: 15, wholeFetchMs: 100 },
      { omitEnd: true, chunks: [PNG.subarray(0, 8)] },
      'REMOTE_BODY_TIMEOUT',
    ],
  ] as const)('times out %s with one terminal cleanup', async (phase, timeouts, script, code) => {
    const resolver =
      phase === 'DNS'
        ? vi.fn<RemoteImageResolver>(() => new Promise<readonly never[]>(() => undefined))
        : vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 as const }]);
    const harness = requestHarness([script]);
    const fetcher = createRemoteImageFetcher({
      resolver,
      request: harness.request,
      timeouts,
    });
    await expect(
      fetcher.fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect({
      requestCount: harness.options.length,
      cleanupPerformed: harness.destroyedRequests.length + harness.destroyedResponses.length > 0,
    }).toEqual(
      phase === 'DNS'
        ? { requestCount: 0, cleanupPerformed: false }
        : { requestCount: 1, cleanupPerformed: true },
    );
  });

  it('keeps a header timeout terminal when a late response callback arrives', async () => {
    const harness = requestHarness([{ responseDelayMs: 30 }]);
    const fetcher = createRemoteImageFetcher({
      resolver: vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]),
      request: harness.request,
      timeouts: { responseHeaderMs: 15, wholeFetchMs: 100 },
    });
    let settlements = 0;
    const result = await fetcher
      .fetchApproved('https://assets.example.com/a', policy(), new AbortController().signal)
      .then(
        () => {
          settlements += 1;
          return null;
        },
        error => {
          settlements += 1;
          return error as Error;
        },
      );
    expect(result).toMatchObject({ code: 'REMOTE_HEADERS_TIMEOUT' });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(settlements).toBe(1);
    expect(harness.destroyedResponses.length).toBeGreaterThan(0);
  });
});
