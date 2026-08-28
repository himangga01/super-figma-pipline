import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  FollowerTransportRequestIdSchema,
  type McpSessionId,
  McpSessionIdSchema,
  PRODUCT_MAGIC,
  PublicPingV1Schema,
} from '@sfp/shared';

import {
  createFollowerAuth,
  type FollowerAuthOptions,
  type FollowerChallenge,
  type LeaderGenerationCredentials,
  verifyFollowerChallenge,
} from './follower-auth.js';
import {
  FOLLOWER_RESPONSE_BODY_MAX_BYTES,
  FOLLOWER_RESPONSE_FRAME_MAX_BYTES,
  FOLLOWER_RESPONSE_RECORD_MAX_BYTES,
  FOLLOWER_RESPONSE_RECORD_MAX_COUNT,
  FOLLOWER_RESPONSE_TOTAL_MAX_BYTES,
  PAIR_METADATA_MAX_BYTES,
  readBoundedBody,
  readBoundedFetchBody,
  RequestLimitError,
  RPC_REQUEST_MAX_BYTES,
} from './request-limits.js';

export type { McpSessionId } from '@sfp/shared';
export type FollowerTransportRequestId = `sfp_req1_${string}`;
export type FollowerTransportPath = '/rpc' | '/abdicate';

export interface LeaderInfo {
  serverVersion: string;
  buildId: number;
  leaderGeneration: string;
}

export interface FollowerTransportCall {
  path: FollowerTransportPath;
  transportRequestId: FollowerTransportRequestId;
  plaintext: Uint8Array;
}

export interface AuthenticatedFollowerRequest {
  readonly leaderGeneration: string;
  readonly mcpSession: McpSessionId;
  readonly transportRequestId: FollowerTransportRequestId;
  readonly requestDigest: string;
  readonly path: FollowerTransportPath;
  readonly plaintext: Uint8Array;
}

export interface AuthenticatedPlaintextRecord {
  readonly sequence: number;
  readonly final: boolean;
  readonly plaintext: Uint8Array;
}

export interface FollowerResponseSink {
  write(plaintext: Uint8Array, options: { final: boolean }): Promise<void>;
  truncate(): Promise<void>;
}

export interface FollowerTransportClient {
  readonly mcpSession: McpSessionId;
  leaderInfo(signal?: AbortSignal): Promise<LeaderInfo | undefined>;
  open(
    call: FollowerTransportCall,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AuthenticatedPlaintextRecord>>;
}

export interface FollowerTransportServer {
  serveChallengeHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
  serveHttp(
    req: IncomingMessage,
    res: ServerResponse,
    expectedPath: FollowerTransportPath,
    handler: (
      request: AuthenticatedFollowerRequest,
      response: FollowerResponseSink,
      subscriberSignal: AbortSignal,
    ) => Promise<void>,
  ): Promise<void>;
}

export interface FollowerGenerationAuthority {
  rotate(): Promise<{ generation: string; createdAt: number }>;
}

export interface FollowerControlAuthority {
  authorizeHttp(req: IncomingMessage): Promise<boolean>;
}

export interface FollowerAuthenticatedTransport {
  readonly client: FollowerTransportClient;
  readonly server: FollowerTransportServer;
  readonly generation: FollowerGenerationAuthority;
  readonly control: FollowerControlAuthority;
}

export interface FollowerAuthenticatedTransportOptions extends FollowerAuthOptions {
  leaderUrl: string;
  mcpSession?: McpSessionId;
  fetch?: typeof globalThis.fetch;
}

type RandomBytes = (size: number) => Buffer;

export const FOLLOWER_REQUEST_CONTENT_TYPE = 'application/sfp-encrypted;v=2';
export const FOLLOWER_RESPONSE_CONTENT_TYPE = 'application/sfp-record-stream;v=1';
const FRAME_MAGIC = Buffer.from('SFR1', 'ascii');
const FRAME_HEADER_BYTES = 16;
const FRAME_TAG_BYTES = 16;

export type FollowerTransportErrorCode =
  | 'FOLLOWER_AUTH_INVALID'
  | 'FOLLOWER_RESPONSE_INVALID'
  | 'FOLLOWER_RESPONSE_TRUNCATED'
  | 'PAYLOAD_TOO_LARGE';

export class FollowerTransportError extends Error {
  constructor(
    readonly code: FollowerTransportErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FollowerTransportError';
  }
}

const exactRandom128 = (randomBytes: RandomBytes): string => {
  const bytes = randomBytes(16);
  if (bytes.byteLength !== 16) throw new TypeError('128-bit identifier entropy source failed');
  return bytes.toString('base64url');
};

export const createMcpSessionId = (randomBytes: RandomBytes = systemRandomBytes): McpSessionId =>
  McpSessionIdSchema.parse(`mcp1_${exactRandom128(randomBytes)}`);

export const createFollowerTransportRequestId = (
  randomBytes: RandomBytes = systemRandomBytes,
): FollowerTransportRequestId =>
  FollowerTransportRequestIdSchema.parse(
    `sfp_req1_${exactRandom128(randomBytes)}`,
  ) as FollowerTransportRequestId;

const tokenBytes = (token: string): Buffer => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.byteLength !== 32) throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  return bytes;
};

const secureEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  const size = Math.max(a.byteLength, b.byteLength, 1);
  const paddedA = Buffer.alloc(size);
  const paddedB = Buffer.alloc(size);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.byteLength === b.byteLength;
};

const jsonHmac = (key: Buffer, value: readonly unknown[]): Buffer =>
  createHmac('sha256', key).update(JSON.stringify(value), 'utf8').digest();

const channelKey = (token: string, generation: string, challengeNonce: string): Buffer =>
  jsonHmac(tokenBytes(token), ['sfp-follower-channel-v2', generation, challengeNonce]);

const requestKey = (
  channel: Buffer,
  path: FollowerTransportPath,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
): Buffer => jsonHmac(channel, ['request-aead', 'POST', path, mcpSession, transportRequestId]);

const requestDigestKey = (
  channel: Buffer,
  path: FollowerTransportPath,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
): Buffer => jsonHmac(channel, ['request-digest', 'POST', path, mcpSession, transportRequestId]);

const responseKey = (
  channel: Buffer,
  path: FollowerTransportPath,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
  requestDigest: string,
): Buffer =>
  jsonHmac(channel, ['response-aead', 'POST', path, mcpSession, transportRequestId, requestDigest]);

const digestRequest = (
  key: Buffer,
  path: FollowerTransportPath,
  generation: string,
  challengeNonce: string,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
  plaintext: Buffer,
): string => {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(plaintext.byteLength));
  return createHmac('sha256', key)
    .update(
      JSON.stringify([
        'sfp-follower-request-digest-v2',
        'POST',
        path,
        generation,
        challengeNonce,
        mcpSession,
        transportRequestId,
      ]),
      'utf8',
    )
    .update(length)
    .update(plaintext)
    .digest('base64url');
};

const requestAad = (
  path: FollowerTransportPath,
  generation: string,
  challengeNonce: string,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
  requestDigest: string,
  ciphertextLength: number,
): Buffer =>
  Buffer.from(
    JSON.stringify([
      'sfp-follower-request-v2',
      'POST',
      path,
      generation,
      challengeNonce,
      mcpSession,
      transportRequestId,
      requestDigest,
      ciphertextLength,
    ]),
    'utf8',
  );

const recordAadPrefix = (
  path: FollowerTransportPath,
  httpStatus: number,
  generation: string,
  challengeNonce: string,
  requestDigest: string,
  mcpSession: McpSessionId,
  transportRequestId: FollowerTransportRequestId,
): Buffer =>
  Buffer.from(
    JSON.stringify([
      'sfp-follower-record-v1',
      FOLLOWER_RESPONSE_CONTENT_TYPE,
      'POST',
      path,
      httpStatus,
      generation,
      challengeNonce,
      requestDigest,
      mcpSession,
      transportRequestId,
    ]),
    'utf8',
  );

const recordNoncePrefix = (key: Buffer): Buffer =>
  createHmac('sha256', key).update('sfp-record-nonce-prefix-v1', 'utf8').digest().subarray(0, 8);

const recordNonce = (prefix: Buffer, sequence: number): Buffer => {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce);
  nonce.writeUInt32BE(sequence, 8);
  return nonce;
};

const pathCap = (path: FollowerTransportPath): number =>
  path === '/rpc' ? RPC_REQUEST_MAX_BYTES : PAIR_METADATA_MAX_BYTES;

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

const writeEmpty = (res: ServerResponse, status: number): void => {
  res.writeHead(status, { 'content-length': '0', connection: 'close' });
  res.end();
};

const strictChallenge = (value: unknown): FollowerChallenge | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).toSorted().join(',') !==
      'expiresAt,followerTransportVersion,generation,nonce,product,proof' ||
    record.product !== PRODUCT_MAGIC ||
    record.followerTransportVersion !== 1 ||
    typeof record.generation !== 'string' ||
    typeof record.nonce !== 'string' ||
    typeof record.expiresAt !== 'number' ||
    typeof record.proof !== 'string'
  ) {
    return undefined;
  }
  return record as unknown as FollowerChallenge;
};

interface RequestCryptoContext {
  generation: string;
  challengeNonce: string;
  requestDigest: string;
  mcpSession: McpSessionId;
  transportRequestId: FollowerTransportRequestId;
  path: FollowerTransportPath;
  responseKey: Buffer;
}

const sealRequest = (
  token: string,
  challenge: FollowerChallenge,
  call: FollowerTransportCall,
  mcpSession: McpSessionId,
  randomBytes: RandomBytes,
): { body: Buffer; headers: Record<string, string>; context: RequestCryptoContext } => {
  const plaintext = Buffer.from(call.plaintext);
  if (plaintext.byteLength > pathCap(call.path)) {
    throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
  }
  const transportRequestId = FollowerTransportRequestIdSchema.parse(
    call.transportRequestId,
  ) as FollowerTransportRequestId;
  const channel = channelKey(token, challenge.generation, challenge.nonce);
  const digest = digestRequest(
    requestDigestKey(channel, call.path, mcpSession, transportRequestId),
    call.path,
    challenge.generation,
    challenge.nonce,
    mcpSession,
    transportRequestId,
    plaintext,
  );
  const iv = randomBytes(12);
  if (iv.byteLength !== 12) throw new TypeError('request IV entropy source failed');
  const cipher = createCipheriv(
    'aes-256-gcm',
    requestKey(channel, call.path, mcpSession, transportRequestId),
    iv,
  );
  cipher.setAAD(
    requestAad(
      call.path,
      challenge.generation,
      challenge.nonce,
      mcpSession,
      transportRequestId,
      digest,
      plaintext.byteLength,
    ),
  );
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const response = responseKey(channel, call.path, mcpSession, transportRequestId, digest);
  return {
    body,
    headers: {
      'content-type': FOLLOWER_REQUEST_CONTENT_TYPE,
      'x-sfp-follower-transport-version': '1',
      'x-sfp-leader-generation': challenge.generation,
      'x-sfp-follower-nonce': challenge.nonce,
      'x-sfp-follower-proof': challenge.proof,
      'x-sfp-mcp-session': mcpSession,
      'x-sfp-transport-request-id': transportRequestId,
      'x-sfp-request-digest': digest,
      'x-sfp-request-iv': iv.toString('base64url'),
      'x-sfp-request-tag': cipher.getAuthTag().toString('base64url'),
    },
    context: {
      generation: challenge.generation,
      challengeNonce: challenge.nonce,
      requestDigest: digest,
      mcpSession,
      transportRequestId,
      path: call.path,
      responseKey: response,
    },
  };
};

const openRequest = async (
  auth: Awaited<ReturnType<typeof createFollowerAuth>>,
  req: IncomingMessage,
  expectedPath: FollowerTransportPath,
): Promise<{ request: AuthenticatedFollowerRequest; context: RequestCryptoContext }> => {
  if (
    req.method !== 'POST' ||
    req.url !== expectedPath ||
    header(req, 'content-type') !== FOLLOWER_REQUEST_CONTENT_TYPE
  ) {
    throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  }
  const ciphertext = await readBoundedBody(req, pathCap(expectedPath));
  const generation = header(req, 'x-sfp-leader-generation');
  const challengeNonce = header(req, 'x-sfp-follower-nonce');
  const proof = header(req, 'x-sfp-follower-proof');
  const mcpSession = McpSessionIdSchema.parse(header(req, 'x-sfp-mcp-session'));
  const transportRequestId = FollowerTransportRequestIdSchema.parse(
    header(req, 'x-sfp-transport-request-id'),
  ) as FollowerTransportRequestId;
  const digest = header(req, 'x-sfp-request-digest');
  const ivValue = header(req, 'x-sfp-request-iv');
  const tagValue = header(req, 'x-sfp-request-tag');
  if (
    digest === undefined ||
    !/^[A-Za-z0-9_-]{43}$/.test(digest) ||
    ivValue === undefined ||
    !/^[A-Za-z0-9_-]{16}$/.test(ivValue) ||
    tagValue === undefined ||
    !/^[A-Za-z0-9_-]{22}$/.test(tagValue)
  ) {
    throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  }
  const secret = await auth.consumeFollowerChallenge({
    followerTransportVersion: Number(header(req, 'x-sfp-follower-transport-version')),
    generation,
    nonce: challengeNonce,
    proof,
  });
  const channel = channelKey(secret.followerToken, secret.generation, secret.nonce);
  const iv = Buffer.from(ivValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  if (iv.byteLength !== 12 || tag.byteLength !== 16) {
    throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  }
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      requestKey(channel, expectedPath, mcpSession, transportRequestId),
      iv,
    );
    decipher.setAAD(
      requestAad(
        expectedPath,
        secret.generation,
        secret.nonce,
        mcpSession,
        transportRequestId,
        digest,
        ciphertext.byteLength,
      ),
    );
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new FollowerTransportError('FOLLOWER_AUTH_INVALID', { cause: error });
  }
  if (plaintext.byteLength > pathCap(expectedPath)) {
    throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
  }
  const observed = digestRequest(
    requestDigestKey(channel, expectedPath, mcpSession, transportRequestId),
    expectedPath,
    secret.generation,
    secret.nonce,
    mcpSession,
    transportRequestId,
    plaintext,
  );
  if (!secureEqual(observed, digest)) throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
  const context: RequestCryptoContext = {
    generation: secret.generation,
    challengeNonce: secret.nonce,
    requestDigest: digest,
    mcpSession,
    transportRequestId,
    path: expectedPath,
    responseKey: responseKey(channel, expectedPath, mcpSession, transportRequestId, digest),
  };
  return {
    request: {
      leaderGeneration: secret.generation,
      mcpSession,
      transportRequestId,
      requestDigest: digest,
      path: expectedPath,
      plaintext,
    },
    context,
  };
};

const frameHeader = (
  sequence: number,
  ciphertextLength: number,
  options: { final: boolean; truncated: boolean },
): Buffer => {
  const value = Buffer.alloc(FRAME_HEADER_BYTES);
  FRAME_MAGIC.copy(value, 0);
  value[4] = 1;
  value[5] = (options.final ? 1 : 0) | (options.truncated ? 2 : 0);
  value.writeUInt16BE(0, 6);
  value.writeUInt32BE(sequence, 8);
  value.writeUInt32BE(ciphertextLength, 12);
  return value;
};

const sealRecord = (
  context: RequestCryptoContext,
  sequence: number,
  plaintext: Buffer,
  options: { final: boolean; truncated: boolean },
): Buffer => {
  const headerBytes = frameHeader(sequence, plaintext.byteLength, options);
  const cipher = createCipheriv(
    'aes-256-gcm',
    context.responseKey,
    recordNonce(recordNoncePrefix(context.responseKey), sequence),
  );
  cipher.setAAD(
    Buffer.concat([
      recordAadPrefix(
        context.path,
        200,
        context.generation,
        context.challengeNonce,
        context.requestDigest,
        context.mcpSession,
        context.transportRequestId,
      ),
      headerBytes,
    ]),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([headerBytes, ciphertext, cipher.getAuthTag()]);
};

const writeWithBackpressure = (
  res: ServerResponse,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<void> => {
  if (res.write(bytes)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
      res.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED'));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED'));
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const createResponseSink = (
  res: ServerResponse,
  context: RequestCryptoContext,
  signal: AbortSignal,
): { sink: FollowerResponseSink; isTerminal(): boolean } => {
  let sequence = 0;
  let cumulative = 0;
  let terminal = false;
  let writing = false;
  let truncateRequested = false;

  const emit = async (plaintext: Buffer, final: boolean, truncated: boolean): Promise<void> => {
    if (terminal) throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
    if (writing) {
      truncateRequested = true;
      throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
    }
    writing = true;
    try {
      const frame = sealRecord(context, sequence, plaintext, { final, truncated });
      if (frame.byteLength > FOLLOWER_RESPONSE_FRAME_MAX_BYTES) {
        throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
      }
      await writeWithBackpressure(res, frame, signal);
      sequence += 1;
      if (final) {
        terminal = true;
        res.end();
      }
    } finally {
      writing = false;
    }
    if (truncateRequested && !terminal) {
      truncateRequested = false;
      await emit(Buffer.alloc(0), true, true);
    }
  };

  const truncate = async (): Promise<void> => {
    if (terminal) return;
    if (writing) {
      truncateRequested = true;
      return;
    }
    await emit(Buffer.alloc(0), true, true);
  };

  const sink: FollowerResponseSink = Object.freeze({
    write: async (value: Uint8Array, options: { final: boolean }) => {
      const plaintext = Buffer.from(value);
      if (!options.final && plaintext.byteLength === 0) {
        throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
      }
      if (sequence >= FOLLOWER_RESPONSE_RECORD_MAX_COUNT - 1 && !options.final) {
        await truncate();
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      }
      if (
        plaintext.byteLength > FOLLOWER_RESPONSE_RECORD_MAX_BYTES ||
        plaintext.byteLength > FOLLOWER_RESPONSE_TOTAL_MAX_BYTES - cumulative
      ) {
        await truncate();
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      }
      cumulative += plaintext.byteLength;
      await emit(plaintext, options.final, false);
    },
    truncate,
  });
  return { sink, isTerminal: () => terminal };
};

interface IncrementalReader {
  readExact(size: number, allowCleanEof?: boolean): Promise<Buffer | undefined>;
  close(cancel?: boolean): Promise<void>;
}

const incrementalReader = (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): IncrementalReader => {
  const reader = body.getReader();
  let pending: Uint8Array | undefined;
  let pendingOffset = 0;
  let total = 0;
  let closed = false;
  const onAbort = (): void => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const readExact = async (size: number, allowCleanEof = false): Promise<Buffer | undefined> => {
    const output = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      if (pending === undefined || pendingOffset === pending.byteLength) {
        // eslint-disable-next-line no-await-in-loop -- stream chunks are consumed in wire order
        const item = await reader.read();
        if (item.done) {
          if (allowCleanEof && offset === 0) return undefined;
          throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
        }
        total += item.value.byteLength;
        if (total > FOLLOWER_RESPONSE_BODY_MAX_BYTES) {
          // eslint-disable-next-line no-await-in-loop -- cancel the exact stream that crossed the cap
          await reader.cancel().catch(() => {});
          throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
        }
        pending = item.value;
        pendingOffset = 0;
      }
      const available = (pending?.byteLength ?? 0) - pendingOffset;
      const count = Math.min(size - offset, available);
      output.set(pending?.subarray(pendingOffset, pendingOffset + count) ?? [], offset);
      pendingOffset += count;
      offset += count;
    }
    return output;
  };

  return {
    readExact,
    close: async (cancel = true) => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', onAbort);
      if (cancel) await reader.cancel().catch(() => {});
      reader.releaseLock();
    },
  };
};

const parseResponseRecords = (
  response: Response,
  context: RequestCryptoContext,
  signal: AbortSignal,
): AsyncIterable<AuthenticatedPlaintextRecord> => ({
  async *[Symbol.asyncIterator]() {
    if (response.body === null) throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
    const input = incrementalReader(response.body, signal);
    let expectedSequence = 0;
    let cumulative = 0;
    let completed = false;
    try {
      while (expectedSequence < FOLLOWER_RESPONSE_RECORD_MAX_COUNT) {
        // eslint-disable-next-line no-await-in-loop -- authenticated records are intentionally sequential
        const headerBytes = await input.readExact(FRAME_HEADER_BYTES, true);
        if (headerBytes === undefined)
          throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
        if (
          !headerBytes.subarray(0, 4).equals(FRAME_MAGIC) ||
          headerBytes[4] !== 1 ||
          ((headerBytes[5] ?? 0) & ~3) !== 0 ||
          headerBytes.readUInt16BE(6) !== 0
        ) {
          throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
        }
        const flags = headerBytes[5] ?? 0;
        const final = (flags & 1) !== 0;
        const truncated = (flags & 2) !== 0;
        const sequence = headerBytes.readUInt32BE(8);
        const ciphertextLength = headerBytes.readUInt32BE(12);
        if (
          sequence !== expectedSequence ||
          ciphertextLength > FOLLOWER_RESPONSE_RECORD_MAX_BYTES ||
          (truncated && (!final || ciphertextLength !== 0)) ||
          (!final && ciphertextLength === 0) ||
          ciphertextLength > FOLLOWER_RESPONSE_TOTAL_MAX_BYTES - cumulative
        ) {
          throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
        }
        // eslint-disable-next-line no-await-in-loop -- allocation follows authenticated frame cap validation
        const sealed = await input.readExact(ciphertextLength + FRAME_TAG_BYTES);
        if (sealed === undefined) throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
        let plaintext: Buffer;
        try {
          const decipher = createDecipheriv(
            'aes-256-gcm',
            context.responseKey,
            recordNonce(recordNoncePrefix(context.responseKey), sequence),
          );
          decipher.setAAD(
            Buffer.concat([
              recordAadPrefix(
                context.path,
                response.status,
                context.generation,
                context.challengeNonce,
                context.requestDigest,
                context.mcpSession,
                context.transportRequestId,
              ),
              headerBytes,
            ]),
          );
          decipher.setAuthTag(sealed.subarray(ciphertextLength));
          plaintext = Buffer.concat([
            decipher.update(sealed.subarray(0, ciphertextLength)),
            decipher.final(),
          ]);
        } catch (error) {
          throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID', { cause: error });
        }
        cumulative += plaintext.byteLength;
        expectedSequence += 1;
        if (final) {
          // eslint-disable-next-line no-await-in-loop -- final is yielded only after exact EOF is proved
          if ((await input.readExact(1, true)) !== undefined) {
            throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
          }
          completed = true;
          if (truncated) throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
          yield { sequence, final: true, plaintext };
          return;
        }
        yield { sequence, final: false, plaintext };
      }
      throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
    } finally {
      await input.close(!completed);
    }
  },
});

export const createFollowerAuthenticatedTransport = async (
  options: FollowerAuthenticatedTransportOptions,
): Promise<FollowerAuthenticatedTransport> => {
  const auth = await createFollowerAuth(options);
  const mcpSession = options.mcpSession ?? createMcpSessionId(options.randomBytes);
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const randomBytes = options.randomBytes ?? systemRandomBytes;

  const leaderInfo = async (signal?: AbortSignal): Promise<LeaderInfo | undefined> => {
    try {
      const response = await fetch(
        `${options.leaderUrl}/ping`,
        signal === undefined ? {} : { signal },
      );
      if (response.status !== 200 || response.headers.get('content-type') !== 'application/json') {
        await response.body?.cancel().catch(() => {});
        return undefined;
      }
      const raw: unknown = JSON.parse(
        (await readBoundedFetchBody(response, PAIR_METADATA_MAX_BYTES)).toString('utf8'),
      ) as unknown;
      const parsed = PublicPingV1Schema.safeParse(raw);
      if (!parsed.success || parsed.data.role !== 'leader') return undefined;
      return {
        serverVersion: parsed.data.serverVersion,
        buildId: parsed.data.buildId,
        leaderGeneration: parsed.data.leaderGeneration,
      };
    } catch {
      return undefined;
    }
  };

  const client: FollowerTransportClient = Object.freeze({
    mcpSession,
    leaderInfo,
    open: async (call: FollowerTransportCall, signal: AbortSignal) => {
      if (signal.aborted) throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
      const info = await leaderInfo(signal);
      const authorization = await auth.authorization('follower');
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization?.value ?? '')?.[1];
      if (
        info === undefined ||
        authorization === undefined ||
        token === undefined ||
        info.leaderGeneration !== authorization.generation
      ) {
        throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
      }
      const challengeResponse = await fetch(`${options.leaderUrl}/follower/challenge`, { signal });
      if (
        challengeResponse.status !== 200 ||
        challengeResponse.headers.get('content-type') !== 'application/json'
      ) {
        await challengeResponse.body?.cancel().catch(() => {});
        throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
      }
      const challenge = strictChallenge(
        JSON.parse(
          (await readBoundedFetchBody(challengeResponse, PAIR_METADATA_MAX_BYTES)).toString('utf8'),
        ) as unknown,
      );
      if (
        challenge === undefined ||
        challenge.generation !== info.leaderGeneration ||
        !verifyFollowerChallenge(token, challenge)
      ) {
        throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
      }
      const sealed = sealRequest(token, challenge, call, mcpSession, randomBytes);
      const response = await fetch(`${options.leaderUrl}${call.path}`, {
        method: 'POST',
        headers: sealed.headers,
        body: sealed.body,
        signal,
      });
      const responseHeaders = response.headers;
      if (
        response.status !== 200 ||
        responseHeaders.get('content-type') !== FOLLOWER_RESPONSE_CONTENT_TYPE ||
        responseHeaders.get('x-sfp-leader-generation') !== sealed.context.generation ||
        responseHeaders.get('x-sfp-follower-nonce') !== sealed.context.challengeNonce ||
        responseHeaders.get('x-sfp-request-digest') !== sealed.context.requestDigest ||
        responseHeaders.get('x-sfp-mcp-session') !== sealed.context.mcpSession ||
        responseHeaders.get('x-sfp-transport-request-id') !== sealed.context.transportRequestId
      ) {
        await response.body?.cancel().catch(() => {});
        throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
      }
      const declared = responseHeaders.get('content-length');
      if (
        declared !== null &&
        /^\d+$/.test(declared) &&
        Number(declared) > FOLLOWER_RESPONSE_BODY_MAX_BYTES
      ) {
        await response.body?.cancel().catch(() => {});
        throw new FollowerTransportError('PAYLOAD_TOO_LARGE');
      }
      return parseResponseRecords(response, sealed.context, signal);
    },
  });

  const server: FollowerTransportServer = Object.freeze({
    serveChallengeHttp: async (req: IncomingMessage, res: ServerResponse) => {
      if (
        req.method !== 'GET' ||
        req.url !== '/follower/challenge' ||
        header(req, 'content-length') !== undefined ||
        header(req, 'transfer-encoding') !== undefined
      ) {
        writeEmpty(res, 401);
        return;
      }
      try {
        const bytes = Buffer.from(JSON.stringify(await auth.issueFollowerChallenge()), 'utf8');
        if (bytes.byteLength > PAIR_METADATA_MAX_BYTES)
          throw new RequestLimitError(PAIR_METADATA_MAX_BYTES);
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(bytes.byteLength),
          'cache-control': 'no-store',
        });
        res.end(bytes);
      } catch {
        writeEmpty(res, 401);
      }
    },
    serveHttp: async (
      req: IncomingMessage,
      res: ServerResponse,
      expectedPath: FollowerTransportPath,
      handler: (
        request: AuthenticatedFollowerRequest,
        response: FollowerResponseSink,
        subscriberSignal: AbortSignal,
      ) => Promise<void>,
    ) => {
      let opened: Awaited<ReturnType<typeof openRequest>>;
      try {
        opened = await openRequest(auth, req, expectedPath);
      } catch (error) {
        writeEmpty(res, error instanceof RequestLimitError ? 413 : 401);
        return;
      }
      const subscriber = new AbortController();
      const abort = (): void => subscriber.abort();
      req.once('aborted', abort);
      res.once('close', abort);
      res.writeHead(200, {
        'content-type': FOLLOWER_RESPONSE_CONTENT_TYPE,
        'cache-control': 'no-store',
        'x-sfp-leader-generation': opened.context.generation,
        'x-sfp-follower-nonce': opened.context.challengeNonce,
        'x-sfp-request-digest': opened.context.requestDigest,
        'x-sfp-mcp-session': opened.context.mcpSession,
        'x-sfp-transport-request-id': opened.context.transportRequestId,
      });
      const response = createResponseSink(res, opened.context, subscriber.signal);
      try {
        await handler(opened.request, response.sink, subscriber.signal);
      } catch {
        // Authentication succeeded. Transport failure is represented only by an authenticated
        // truncated terminal record, never an unauthenticated semantic body.
      } finally {
        if (!response.isTerminal() && !subscriber.signal.aborted) {
          await response.sink.truncate().catch(() => {});
        }
        req.removeListener('aborted', abort);
        res.removeListener('close', abort);
      }
    },
  });

  const generation: FollowerGenerationAuthority = Object.freeze({
    rotate: async () => {
      const rotated: LeaderGenerationCredentials = await auth.rotate();
      return { generation: rotated.generation, createdAt: rotated.createdAt };
    },
  });
  const control: FollowerControlAuthority = Object.freeze({
    authorizeHttp: (req: IncomingMessage) =>
      auth.authorizeControl(header(req, 'authorization'), header(req, 'x-sfp-leader-generation')),
  });
  return Object.freeze({ client, server, generation, control });
};
