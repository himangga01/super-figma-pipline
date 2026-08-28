import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

export const PAIR_METADATA_MAX_BYTES = 16 * 1024;
export const RPC_REQUEST_MAX_BYTES = 9 * 1024 * 1024;
export const HTTP_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
export const FOLLOWER_RESPONSE_RECORD_MAX_BYTES = 64 * 1024 * 1024;
export const FOLLOWER_RESPONSE_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
export const FOLLOWER_RESPONSE_RECORD_MAX_COUNT = 4_096;
export const FOLLOWER_RESPONSE_FRAME_MAX_BYTES = 67_108_896;
export const FOLLOWER_RESPONSE_BODY_MAX_BYTES = 67_239_936;
export const WS_FRAME_MAX_BYTES = 64 * 1024 * 1024;
export const DECODED_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
export const BASE64_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const EXPERIMENTAL_VIDEO_MAX_BYTES = 48 * 1024 * 1024;

export class RequestLimitError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  readonly status = 413;

  constructor(readonly limit: number) {
    super(`request payload exceeds ${limit} bytes`);
    this.name = 'RequestLimitError';
  }
}

const declaredLength = (stream: Readable): number | undefined => {
  const headers = (stream as Partial<IncomingMessage>).headers;
  const raw = headers?.['content-length'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

/**
 * Read an HTTP body with a counter in front of every Buffer allocation/concatenation.
 *
 * The stream is paused as soon as the next chunk would cross the cap. Callers should answer with
 * `Connection: close` for that error, so unread attacker-controlled bytes cannot be reinterpreted
 * as another request on the same connection.
 */
export const readBoundedBody = (stream: Readable, maxBytes: number): Promise<Buffer> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return Promise.reject(new TypeError('maxBytes must be a non-negative safe integer'));
  }
  if ((declaredLength(stream) ?? 0) > maxBytes) {
    stream.pause();
    return Promise.reject(new RequestLimitError(maxBytes));
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const cleanup = (): void => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('aborted', onAborted);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.pause();
      reject(error);
    };
    const onData = (chunk: Buffer | Uint8Array | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes.byteLength > maxBytes - size) {
        fail(new RequestLimitError(maxBytes));
        return;
      }
      size += bytes.byteLength;
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => fail(new Error('request body aborted'));

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('aborted', onAborted);
  });
};

/** Bounded reader for WHATWG fetch responses; cancels before concatenating an over-limit chunk. */
export const readBoundedFetchBody = async (
  response: Response,
  maxBytes = HTTP_RESPONSE_MAX_BYTES,
): Promise<Buffer> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('maxBytes must be a non-negative safe integer');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new RequestLimitError(maxBytes);
  }
  if (response.body === null) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- streaming counter must inspect each chunk
      const item = await reader.read();
      if (item.done) return Buffer.concat(chunks, size);
      const bytes = Buffer.from(item.value);
      if (bytes.byteLength > maxBytes - size) {
        // eslint-disable-next-line no-await-in-loop -- cancel the exact stream that crossed the cap
        await reader.cancel().catch(() => {});
        throw new RequestLimitError(maxBytes);
      }
      size += bytes.byteLength;
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock();
  }
};

export const fitsHttpResponse = (byteLength: number): boolean =>
  Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= HTTP_RESPONSE_MAX_BYTES;
