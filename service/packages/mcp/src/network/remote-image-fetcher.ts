import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP, isIPv4, type LookupFunction } from 'node:net';
import { domainToASCII } from 'node:url';

export const REMOTE_IMAGE_LIMITS = Object.freeze({
  maxDnsAnswers: 16,
  maxRedirects: 3,
  maxDecodedBytes: 6_291_456,
  maxBase64Bytes: 8_388_608,
  maxResponseHeaderBytes: 16_384,
  maxLocationBytes: 4_096,
  dnsMs: 5_000,
  connectTlsMs: 10_000,
  responseHeaderMs: 10_000,
  bodyIdleMs: 5_000,
  wholeFetchMs: 30_000,
});

export interface RemoteImagePolicy {
  allowedDomains: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export interface RemoteImageFetchResult {
  bytes: Uint8Array;
  mime: string;
  finalUrlHash: `sha256:${string}`;
}

export interface RemoteImageFetcher {
  fetchApproved(
    url: string,
    policy: RemoteImagePolicy,
    signal: AbortSignal,
  ): Promise<Readonly<RemoteImageFetchResult>>;
}

export type RemoteImageResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly PinnedAddress[]>;

export interface RemoteImageRequestOptions extends HttpsRequestOptions {
  protocol: 'https:';
  hostname: string;
  port: 443;
  servername: string;
  method: 'GET';
  agent: false;
  family: 4 | 6;
  autoSelectFamily: false;
  maxHeaderSize: 16_384;
  lookup: LookupFunction;
  headers: Readonly<Record<string, string>>;
}

export type RemoteImageRequestFactory = (
  options: RemoteImageRequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

interface RemoteImageTimeouts {
  dnsMs: number;
  connectTlsMs: number;
  responseHeaderMs: number;
  bodyIdleMs: number;
  wholeFetchMs: number;
}

export interface RemoteImageFetcherDependencies {
  resolver?: RemoteImageResolver;
  request?: RemoteImageRequestFactory;
  /** Tests and stricter deployments may only lower, never raise, fixed runtime deadlines. */
  timeouts?: Partial<RemoteImageTimeouts>;
}

type RemoteError = Error & { code: string };

const remoteError = (
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): RemoteError => Object.assign(new Error(message), { code, ...details });

const abortError = (): RemoteError =>
  Object.assign(new Error('remote image fetch was aborted'), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });

const abortReason = (signal: AbortSignal): RemoteError => {
  const reason = signal.reason as { code?: unknown } | undefined;
  return typeof reason?.code === 'string' && reason.code.startsWith('REMOTE_')
    ? (signal.reason as RemoteError)
    : abortError();
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortReason(signal);
};

const supportedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const validExactDomain = (input: string): boolean => {
  if (
    input.length < 1 ||
    input.length > 253 ||
    input !== input.toLowerCase() ||
    input.endsWith('.') ||
    input.startsWith('.') ||
    input.includes('*') ||
    input.includes(':') ||
    input.includes('/') ||
    input.includes('@') ||
    isIP(input) !== 0 ||
    domainToASCII(input) !== input
  ) {
    return false;
  }
  const labels = input.split('.');
  return (
    labels.length >= 3 &&
    labels.every(
      label =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  );
};

export const validateRemoteImagePolicy = (
  input: RemoteImagePolicy,
): Readonly<RemoteImagePolicy> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    !Array.isArray(input.allowedDomains) ||
    input.allowedDomains.length > 256 ||
    !Number.isSafeInteger(input.maxRedirects) ||
    input.maxRedirects < 0 ||
    input.maxRedirects > REMOTE_IMAGE_LIMITS.maxRedirects ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    input.maxBytes > REMOTE_IMAGE_LIMITS.maxDecodedBytes ||
    !Array.isArray(input.allowedMimeTypes) ||
    input.allowedMimeTypes.length < 1 ||
    input.allowedMimeTypes.length > supportedMimeTypes.size
  ) {
    throw remoteError('REMOTE_POLICY_INVALID', 'remote image policy is invalid');
  }
  const domains = [...input.allowedDomains];
  const mimeTypes = [...input.allowedMimeTypes];
  if (
    domains.some(domain => typeof domain !== 'string' || !validExactDomain(domain)) ||
    new Set(domains).size !== domains.length ||
    mimeTypes.some(
      mime =>
        typeof mime !== 'string' || !supportedMimeTypes.has(mime) || mime !== mime.toLowerCase(),
    ) ||
    new Set(mimeTypes).size !== mimeTypes.length
  ) {
    throw remoteError('REMOTE_POLICY_INVALID', 'remote image policy is invalid');
  }
  return Object.freeze({
    allowedDomains: Object.freeze(domains),
    maxRedirects: input.maxRedirects,
    maxBytes: input.maxBytes,
    allowedMimeTypes: Object.freeze(mimeTypes),
  });
};

const parseIpv4 = (address: string): readonly number[] | null =>
  isIPv4(address) ? address.split('.').map(part => Number(part)) : null;

const ipv4Key = (address: string): string | null => {
  const bytes = parseIpv4(address);
  return bytes === null ? null : bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const parseIpv6Half = (half: string): number[] | null => {
  if (half === '') return [];
  const values = half.split(':');
  if (values.some(value => !/^[0-9a-f]{1,4}$/u.test(value))) return null;
  return values.map(value => Number.parseInt(value, 16));
};

const parseIpv6 = (input: string): readonly number[] | null => {
  if (input.length < 2 || input.includes('%') || input.startsWith('[') || input.endsWith(']')) {
    return null;
  }
  let address = input.toLowerCase();
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(address.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const high = ((ipv4[0] as number) << 8) | (ipv4[1] as number);
    const low = ((ipv4[2] as number) << 8) | (ipv4[3] as number);
    address = `${address.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = parseIpv6Half(halves[0] as string);
  const right = parseIpv6Half(halves[1] ?? '');
  if (left === null || right === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
};

const ipv6Key = (address: string): string | null => {
  const words = parseIpv6(address);
  return words === null ? null : words.map(word => word.toString(16).padStart(4, '0')).join('');
};

const prefixMatches = (
  words: readonly number[],
  prefix: readonly number[],
  bits: number,
): boolean => {
  const completeWords = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < completeWords; index += 1) {
    if (words[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return ((words[completeWords] as number) & mask) === ((prefix[completeWords] as number) & mask);
};

const globalIpv4 = (address: string): boolean => {
  const bytes = parseIpv4(address);
  if (bytes === null) return false;
  const [a, b, c, d] = bytes as readonly [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
};

const globalIpv6 = (address: string): boolean => {
  const words = parseIpv6(address);
  if (words === null) return false;
  if (!prefixMatches(words, [0x2000, 0, 0, 0, 0, 0, 0, 0], 3)) return false;
  const allZero = words.every(word => word === 0);
  const loopback = words.slice(0, 7).every(word => word === 0) && words[7] === 1;
  const ipv4Compatible = words.slice(0, 6).every(word => word === 0);
  return !(
    allZero ||
    loopback ||
    ipv4Compatible ||
    prefixMatches(words, [0, 0, 0, 0, 0, 0xffff, 0, 0], 96) ||
    prefixMatches(words, [0x0064, 0xff9b, 0, 0, 0, 0, 0, 0], 96) ||
    prefixMatches(words, [0x0064, 0xff9b, 0x0001, 0, 0, 0, 0, 0], 48) ||
    prefixMatches(words, [0x0100, 0, 0, 0, 0, 0, 0, 0], 64) ||
    prefixMatches(words, [0x2001, 0, 0, 0, 0, 0, 0, 0], 23) ||
    prefixMatches(words, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32) ||
    prefixMatches(words, [0x2002, 0, 0, 0, 0, 0, 0, 0], 16) ||
    prefixMatches(words, [0x3fff, 0, 0, 0, 0, 0, 0, 0], 20) ||
    prefixMatches(words, [0x5f00, 0, 0, 0, 0, 0, 0, 0], 16) ||
    prefixMatches(words, [0xfc00, 0, 0, 0, 0, 0, 0, 0], 7) ||
    prefixMatches(words, [0xfe80, 0, 0, 0, 0, 0, 0, 0], 10) ||
    prefixMatches(words, [0xfec0, 0, 0, 0, 0, 0, 0, 0], 10) ||
    prefixMatches(words, [0xff00, 0, 0, 0, 0, 0, 0, 0], 8)
  );
};

export const isGlobalRemoteAddress = (address: string, family: 4 | 6): boolean =>
  family === 4 ? globalIpv4(address) : globalIpv6(address);

const addressKey = (address: string, family: 4 | 6): string | null =>
  family === 4 ? ipv4Key(address) : ipv6Key(address);

export const vetRemoteAddresses = (
  input: readonly PinnedAddress[],
): readonly Readonly<PinnedAddress>[] => {
  if (!Array.isArray(input) || input.length < 1) {
    throw remoteError('REMOTE_DNS_ANSWER_INVALID', 'remote DNS returned no usable answers');
  }
  if (input.length > REMOTE_IMAGE_LIMITS.maxDnsAnswers) {
    throw remoteError('REMOTE_DNS_ANSWER_LIMIT_EXCEEDED', 'remote DNS answer cap was exceeded');
  }
  const seen = new Set<string>();
  const output: Readonly<PinnedAddress>[] = [];
  for (const row of input) {
    if (
      typeof row !== 'object' ||
      row === null ||
      typeof row.address !== 'string' ||
      (row.family !== 4 && row.family !== 6) ||
      isIP(row.address) !== row.family
    ) {
      throw remoteError('REMOTE_DNS_ANSWER_INVALID', 'remote DNS returned a malformed answer');
    }
    const key = addressKey(row.address, row.family);
    if (key === null || seen.has(`${row.family}:${key}`)) {
      throw remoteError('REMOTE_DNS_ANSWER_INVALID', 'remote DNS returned duplicate answers');
    }
    if (!isGlobalRemoteAddress(row.address, row.family)) {
      throw remoteError('REMOTE_ADDRESS_DENIED', 'remote DNS returned a non-global address');
    }
    seen.add(`${row.family}:${key}`);
    output.push(Object.freeze({ address: row.address, family: row.family }));
  }
  return Object.freeze(output);
};

const defaultResolver: RemoteImageResolver = (hostname, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      operation();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    dnsLookup(hostname, { all: true, verbatim: true }, (error, rows) => {
      finish(() => {
        if (error !== null) reject(remoteError('REMOTE_DNS_FAILED', 'remote DNS failed'));
        else
          resolve(
            rows.map(row => ({
              address: row.address,
              family: row.family as 4 | 6,
            })),
          );
      });
    });
  });

const defaultRequest: RemoteImageRequestFactory = (options, onResponse) =>
  httpsRequest(options, onResponse);

const timeoutDefaults: Readonly<RemoteImageTimeouts> = Object.freeze({
  dnsMs: REMOTE_IMAGE_LIMITS.dnsMs,
  connectTlsMs: REMOTE_IMAGE_LIMITS.connectTlsMs,
  responseHeaderMs: REMOTE_IMAGE_LIMITS.responseHeaderMs,
  bodyIdleMs: REMOTE_IMAGE_LIMITS.bodyIdleMs,
  wholeFetchMs: REMOTE_IMAGE_LIMITS.wholeFetchMs,
});

const validateTimeouts = (
  overrides: Partial<RemoteImageTimeouts> | undefined,
): Readonly<RemoteImageTimeouts> => {
  const result = { ...timeoutDefaults, ...overrides };
  for (const name of Object.keys(timeoutDefaults) as (keyof RemoteImageTimeouts)[]) {
    if (
      !Number.isSafeInteger(result[name]) ||
      result[name] < 1 ||
      result[name] > timeoutDefaults[name]
    ) {
      throw remoteError('REMOTE_TIMEOUTS_INVALID', 'remote image timeout is invalid');
    }
  }
  return Object.freeze(result);
};

const raceSignal = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const finish = (next: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      next();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });

const hasForbiddenRawUrlCharacter = (value: string): boolean =>
  [...value].some(character => {
    const point = character.codePointAt(0) as number;
    return point <= 0x20 || point === 0x7f || character === '\\';
  });

const rawAuthorityIsInvalid = (value: string, prefixLength: number): boolean => {
  const authorityAndSuffix = value.slice(prefixLength);
  const authorityEnd = authorityAndSuffix.search(/[/?#]/u);
  const rawAuthority =
    authorityEnd < 0 ? authorityAndSuffix : authorityAndSuffix.slice(0, authorityEnd);
  return rawAuthority.length === 0 || rawAuthority.includes('@') || rawAuthority.includes('%');
};

const admitUrl = (rawUrl: string, allowedDomains: ReadonlySet<string>): URL => {
  if (
    typeof rawUrl !== 'string' ||
    !rawUrl.startsWith('https://') ||
    hasForbiddenRawUrlCharacter(rawUrl)
  ) {
    throw remoteError('REMOTE_URL_INVALID', 'remote image URL is invalid');
  }
  if (rawAuthorityIsInvalid(rawUrl, 'https://'.length)) {
    throw remoteError('REMOTE_URL_INVALID', 'remote image URL is invalid');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw remoteError('REMOTE_URL_INVALID', 'remote image URL is invalid');
  }
  const hostname = url.hostname;
  const addressHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    hostname === '' ||
    hostname.endsWith('.') ||
    isIP(addressHostname) !== 0 ||
    url.port !== '' ||
    url.hash !== ''
  ) {
    throw remoteError('REMOTE_URL_INVALID', 'remote image URL is invalid');
  }
  if (!allowedDomains.has(hostname)) {
    throw remoteError('REMOTE_DOMAIN_NOT_ALLOWED', 'remote image host is not allowed');
  }
  return url;
};

interface ParsedHeaders {
  values: ReadonlyMap<string, readonly string[]>;
}

const parseRawHeaders = (rawHeaders: readonly string[]): ParsedHeaders => {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) {
    throw remoteError('REMOTE_HEADERS_INVALID', 'remote response headers are invalid');
  }
  let bytes = 2;
  const values = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index] as string;
    const value = rawHeaders[index + 1] as string;
    bytes += Buffer.byteLength(name) + 2 + Buffer.byteLength(value) + 2;
    if (
      bytes > REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) ||
      [...value].some(character => {
        const point = character.codePointAt(0) as number;
        return point < 0x20 || point === 0x7f;
      })
    ) {
      throw remoteError(
        bytes > REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes
          ? 'REMOTE_HEADERS_TOO_LARGE'
          : 'REMOTE_HEADERS_INVALID',
        'remote response headers are invalid',
      );
    }
    const key = name.toLowerCase();
    const rows = values.get(key) ?? [];
    rows.push(value);
    values.set(key, rows);
  }
  return { values };
};

const singleHeader = (
  headers: ParsedHeaders,
  name: string,
  missingAllowed = false,
): string | null => {
  const values = headers.values.get(name) ?? [];
  if (values.length === 0 && missingAllowed) return null;
  if (values.length !== 1) {
    throw remoteError('REMOTE_HEADERS_INVALID', 'remote response header cardinality is invalid');
  }
  return values[0] as string;
};

const redirectStatus = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

const parseRedirectLocation = (headers: ParsedHeaders): string => {
  const values = headers.values.get('location') ?? [];
  if (
    values.length !== 1 ||
    values[0] === '' ||
    Buffer.byteLength(values[0] as string) > REMOTE_IMAGE_LIMITS.maxLocationBytes
  ) {
    throw remoteError('REMOTE_REDIRECT_INVALID', 'remote redirect location is invalid');
  }
  return values[0] as string;
};

const admitRedirectLocation = (
  rawLocation: string,
  current: URL,
  allowedDomains: ReadonlySet<string>,
): URL => {
  if (hasForbiddenRawUrlCharacter(rawLocation)) {
    throw remoteError('REMOTE_REDIRECT_INVALID', 'remote redirect location is invalid');
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(rawLocation)) {
    if (
      rawLocation.startsWith('https://') &&
      rawAuthorityIsInvalid(rawLocation, 'https://'.length)
    ) {
      throw remoteError('REMOTE_REDIRECT_INVALID', 'remote redirect location is invalid');
    }
    return admitUrl(rawLocation, allowedDomains);
  }
  if (rawLocation.startsWith('//')) {
    if (rawLocation.length < 3 || rawLocation[2] === '/' || rawAuthorityIsInvalid(rawLocation, 2)) {
      throw remoteError('REMOTE_REDIRECT_INVALID', 'remote redirect location is invalid');
    }
  }
  let resolved: URL;
  try {
    resolved = new URL(rawLocation, current);
  } catch {
    throw remoteError('REMOTE_REDIRECT_INVALID', 'remote redirect location is invalid');
  }
  return admitUrl(resolved.href, allowedDomains);
};

const parseBodyHeaders = (
  headers: ParsedHeaders,
  policy: Readonly<RemoteImagePolicy>,
): Readonly<{ mime: string; contentLength: number | null }> => {
  let mime: string;
  try {
    mime = singleHeader(headers, 'content-type') as string;
  } catch {
    throw remoteError('REMOTE_MIME_INVALID', 'remote image MIME is invalid');
  }
  if (!policy.allowedMimeTypes.includes(mime) || !supportedMimeTypes.has(mime)) {
    throw remoteError('REMOTE_MIME_INVALID', 'remote image MIME is invalid');
  }
  let encoding: string | null;
  try {
    encoding = singleHeader(headers, 'content-encoding', true);
  } catch {
    throw remoteError('REMOTE_ENCODING_DENIED', 'remote image encoding is denied');
  }
  if (encoding !== null && encoding !== 'identity') {
    throw remoteError('REMOTE_ENCODING_DENIED', 'remote image encoding is denied');
  }
  const transferValues = headers.values.get('transfer-encoding') ?? [];
  if (
    transferValues.length > 1 ||
    (transferValues.length === 1 && transferValues[0] !== 'chunked')
  ) {
    throw remoteError('REMOTE_CONTENT_LENGTH_INVALID', 'remote image transfer length is invalid');
  }
  const lengthValues = headers.values.get('content-length') ?? [];
  if (lengthValues.length > 1 || (lengthValues.length === 1 && transferValues.length > 0)) {
    throw remoteError('REMOTE_CONTENT_LENGTH_INVALID', 'remote image content length is invalid');
  }
  if (lengthValues.length === 0) return Object.freeze({ mime, contentLength: null });
  const rawLength = lengthValues[0] as string;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(rawLength)) {
    throw remoteError('REMOTE_CONTENT_LENGTH_INVALID', 'remote image content length is invalid');
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength)) {
    throw remoteError('REMOTE_CONTENT_LENGTH_INVALID', 'remote image content length is invalid');
  }
  if (contentLength > policy.maxBytes || contentLength > REMOTE_IMAGE_LIMITS.maxDecodedBytes) {
    throw remoteError('REMOTE_BODY_TOO_LARGE', 'remote image body exceeds its cap', {
      beforeRead: true,
      bytesRead: 0,
    });
  }
  return Object.freeze({ mime, contentLength });
};

const signatureMatches = (mime: string, bytes: Buffer): boolean => {
  if (mime === 'image/png') {
    return (
      bytes.length >= 45 &&
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.subarray(12, 16).toString('ascii') === 'IHDR' &&
      bytes.readUInt32BE(bytes.length - 12) === 0 &&
      bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii') === 'IEND'
    );
  }
  if (mime === 'image/jpeg') {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    );
  }
  if (mime === 'image/gif') {
    return (
      bytes.length >= 7 &&
      ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) &&
      bytes[bytes.length - 1] === 0x3b
    );
  }
  if (
    mime !== 'image/webp' ||
    bytes.length < 22 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return false;
  }
  let offset = 12;
  let first = true;
  let imageChunkSeen = false;
  while (offset < bytes.length) {
    if (offset > bytes.length - 8) return false;
    const chunkType = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkBytes = bytes.readUInt32LE(offset + 4);
    const payloadEnd = offset + 8 + chunkBytes;
    const paddedEnd = payloadEnd + (chunkBytes % 2);
    if (!Number.isSafeInteger(payloadEnd) || paddedEnd > bytes.length) return false;
    if (first) {
      if (!['VP8 ', 'VP8L', 'VP8X'].includes(chunkType)) return false;
      if (chunkBytes < 1 || (chunkType === 'VP8X' && chunkBytes !== 10)) return false;
      imageChunkSeen = chunkType === 'VP8 ' || chunkType === 'VP8L';
      first = false;
    } else if (chunkType === 'VP8 ' || chunkType === 'VP8L') {
      imageChunkSeen = true;
    }
    offset = paddedEnd;
  }
  return imageChunkSeen && offset === bytes.length;
};

type HopResult =
  | Readonly<{ kind: 'redirect'; location: string }>
  | Readonly<{ kind: 'image'; bytes: Buffer; mime: string }>;

const normalizePeerFamily = (family: string | number | undefined): 4 | 6 | null =>
  family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : null;

class NodeRemoteImageFetcher implements RemoteImageFetcher {
  private readonly resolver: RemoteImageResolver;
  private readonly request: RemoteImageRequestFactory;
  private readonly timeouts: Readonly<RemoteImageTimeouts>;

  constructor(dependencies: RemoteImageFetcherDependencies) {
    this.resolver = dependencies.resolver ?? defaultResolver;
    this.request = dependencies.request ?? defaultRequest;
    this.timeouts = validateTimeouts(dependencies.timeouts);
  }

  private async resolve(hostname: string, signal: AbortSignal): Promise<readonly PinnedAddress[]> {
    const phase = new AbortController();
    const onParentAbort = () => phase.abort(abortReason(signal));
    signal.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(
      () => phase.abort(remoteError('REMOTE_DNS_TIMEOUT', 'remote image DNS timed out')),
      this.timeouts.dnsMs,
    );
    try {
      throwIfAborted(signal);
      const rows = await raceSignal(this.resolver(hostname, phase.signal), phase.signal);
      return vetRemoteAddresses(rows);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ABORT_ERR' || String(error.code).startsWith('REMOTE_'))
      ) {
        throw error;
      }
      throw remoteError('REMOTE_DNS_FAILED', 'remote DNS failed');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onParentAbort);
      if (!phase.signal.aborted) {
        phase.abort(remoteError('REMOTE_DNS_PHASE_SETTLED', 'remote image DNS phase settled'));
      }
    }
  }

  private requestHop(
    url: URL,
    pinned: Readonly<PinnedAddress>,
    policy: Readonly<RemoteImagePolicy>,
    signal: AbortSignal,
  ): Promise<HopResult> {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      let settled = false;
      let lookupCalls = 0;
      let secureConnected = false;
      let responseEnded = false;
      let request: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      let socket: IncomingMessage['socket'] | undefined;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let headerTimer: ReturnType<typeof setTimeout> | undefined;
      let bodyTimer: ReturnType<typeof setTimeout> | undefined;

      const clearTimers = (): void => {
        if (connectTimer !== undefined) clearTimeout(connectTimer);
        if (headerTimer !== undefined) clearTimeout(headerTimer);
        if (bodyTimer !== undefined) clearTimeout(bodyTimer);
      };
      const cleanupListeners = (): void => {
        signal.removeEventListener('abort', onAbort);
        clearTimers();
      };
      const destroyTransport = (): void => {
        response?.destroy();
        request?.destroy();
        if (socket !== undefined && !socket.destroyed) socket.destroy();
      };
      const closeBeforeRedirect = (): Promise<void> =>
        new Promise((resolveClose, rejectClose) => {
          const targets = [
            ...new Set([response, request, socket].filter(item => item !== undefined)),
          ];
          const pending = new Set(targets.filter(target => target.closed !== true));
          let closeSettled = false;
          const listeners = new Map<(typeof targets)[number], () => void>();
          const cleanup = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onCloseAbort);
            for (const [target, listener] of listeners) {
              target.removeListener('close', listener);
            }
          };
          const finish = (error?: Error): void => {
            if (closeSettled) return;
            closeSettled = true;
            cleanup();
            if (error === undefined) resolveClose();
            else rejectClose(error);
          };
          const onCloseAbort = () => finish(abortReason(signal));
          const timer = setTimeout(
            () =>
              finish(
                remoteError(
                  'REMOTE_REDIRECT_CLEANUP_TIMEOUT',
                  'remote redirect transport cleanup timed out',
                ),
              ),
            this.timeouts.bodyIdleMs,
          );
          signal.addEventListener('abort', onCloseAbort, { once: true });
          for (const target of pending) {
            const listener = () => {
              pending.delete(target);
              if (pending.size === 0) finish();
            };
            listeners.set(target, listener);
            target.once('close', listener);
          }
          try {
            destroyTransport();
          } catch {
            finish(
              remoteError(
                'REMOTE_REDIRECT_CLEANUP_FAILED',
                'remote redirect transport cleanup failed',
              ),
            );
            return;
          }
          for (const target of pending) {
            if (target.closed === true) listeners.get(target)?.();
          }
          if (pending.size === 0) finish();
        });
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        const ownedCode =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string' &&
          (error.code === 'ABORT_ERR' || error.code.startsWith('REMOTE_'));
        const failure = ownedCode
          ? (error as unknown as Error)
          : remoteError('REMOTE_REQUEST_FAILED', 'remote image request failed');
        destroyTransport();
        reject(failure);
      };
      const resolveOnce = (result: HopResult): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resolve(result);
      };
      const onAbort = () => rejectOnce(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });

      const resetBodyTimer = (): void => {
        if (bodyTimer !== undefined) clearTimeout(bodyTimer);
        bodyTimer = setTimeout(
          () => rejectOnce(remoteError('REMOTE_BODY_TIMEOUT', 'remote image body timed out')),
          this.timeouts.bodyIdleMs,
        );
      };

      const lookup: LookupFunction = ((
        requestedHostname: string,
        lookupOptions: { all?: boolean; family?: number },
        callback: (error: NodeJS.ErrnoException | null, address?: string, family?: number) => void,
      ) => {
        lookupCalls += 1;
        if (
          settled ||
          lookupCalls !== 1 ||
          requestedHostname !== url.hostname ||
          lookupOptions.all === true ||
          (lookupOptions.family !== undefined &&
            lookupOptions.family !== 0 &&
            lookupOptions.family !== pinned.family)
        ) {
          callback(
            remoteError('REMOTE_DNS_PIN_VIOLATION', 'remote connection attempted another lookup'),
          );
          return;
        }
        callback(null, pinned.address, pinned.family);
      }) as LookupFunction;

      const requestOptions: RemoteImageRequestOptions = {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        servername: url.hostname,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        agent: false,
        family: pinned.family,
        autoSelectFamily: false,
        maxHeaderSize: REMOTE_IMAGE_LIMITS.maxResponseHeaderBytes,
        lookup,
        headers: Object.freeze({
          Host: url.hostname,
          Accept: 'image/png, image/jpeg, image/gif, image/webp',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        }),
      };

      const onResponse = (incoming: IncomingMessage): void => {
        if (settled) {
          incoming.destroy();
          return;
        }
        if (response !== undefined) {
          incoming.destroy();
          rejectOnce(remoteError('REMOTE_REQUEST_FAILED', 'remote server sent multiple responses'));
          return;
        }
        response = incoming;
        if (headerTimer !== undefined) clearTimeout(headerTimer);
        if (
          !secureConnected ||
          lookupCalls !== 1 ||
          (request as (ClientRequest & { reusedSocket?: boolean }) | undefined)?.reusedSocket ===
            true
        ) {
          rejectOnce(remoteError('REMOTE_DNS_PIN_VIOLATION', 'remote connection lost DNS pin'));
          return;
        }
        let headers: ParsedHeaders;
        try {
          headers = parseRawHeaders(incoming.rawHeaders);
        } catch (error) {
          rejectOnce(error);
          return;
        }
        const status = incoming.statusCode;
        if (typeof status !== 'number') {
          rejectOnce(remoteError('REMOTE_STATUS_INVALID', 'remote response status is invalid'));
          return;
        }
        if (redirectStatus(status)) {
          let location: string;
          try {
            location = parseRedirectLocation(headers);
          } catch (error) {
            rejectOnce(error);
            return;
          }
          void closeBeforeRedirect().then(
            () => resolveOnce(Object.freeze({ kind: 'redirect', location })),
            rejectOnce,
          );
          return;
        }
        if (status !== 200) {
          rejectOnce(remoteError('REMOTE_STATUS_INVALID', 'remote response status is invalid'));
          return;
        }
        let bodyHeaders: Readonly<{ mime: string; contentLength: number | null }>;
        try {
          bodyHeaders = parseBodyHeaders(headers, policy);
        } catch (error) {
          rejectOnce(error);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        resetBodyTimer();
        incoming.on('data', (chunk: Buffer | Uint8Array | string) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > policy.maxBytes || total > REMOTE_IMAGE_LIMITS.maxDecodedBytes) {
            rejectOnce(
              remoteError('REMOTE_BODY_TOO_LARGE', 'remote image body exceeds its cap', {
                beforeRead: false,
                bytesRead: total,
              }),
            );
            return;
          }
          chunks.push(bytes);
          resetBodyTimer();
        });
        incoming.once('aborted', () =>
          rejectOnce(remoteError('REMOTE_BODY_TRUNCATED', 'remote image body was aborted')),
        );
        incoming.once('error', rejectOnce);
        incoming.once('end', () => {
          if (settled) return;
          responseEnded = true;
          if (bodyTimer !== undefined) clearTimeout(bodyTimer);
          if (incoming.complete !== true) {
            rejectOnce(remoteError('REMOTE_BODY_TRUNCATED', 'remote image body is incomplete'));
            return;
          }
          if (bodyHeaders.contentLength !== null && bodyHeaders.contentLength !== total) {
            rejectOnce(
              remoteError(
                'REMOTE_CONTENT_LENGTH_MISMATCH',
                'remote image content length does not match body',
              ),
            );
            return;
          }
          const bytes = Buffer.concat(chunks, total);
          const base64Length = Math.ceil(bytes.byteLength / 3) * 4;
          if (base64Length > REMOTE_IMAGE_LIMITS.maxBase64Bytes) {
            rejectOnce(
              remoteError('REMOTE_BASE64_TOO_LARGE', 'remote image base64 exceeds its cap'),
            );
            return;
          }
          if (!signatureMatches(bodyHeaders.mime, bytes)) {
            rejectOnce(
              remoteError('REMOTE_SIGNATURE_INVALID', 'remote image signature is invalid'),
            );
            return;
          }
          resolveOnce(Object.freeze({ kind: 'image', bytes, mime: bodyHeaders.mime }));
        });
        incoming.once('close', () => {
          if (!responseEnded && !settled) {
            rejectOnce(remoteError('REMOTE_BODY_TRUNCATED', 'remote image body closed early'));
          }
        });
      };

      try {
        request = this.request(requestOptions, onResponse);
      } catch {
        rejectOnce(remoteError('REMOTE_REQUEST_FAILED', 'remote image request failed'));
        return;
      }
      if (settled) {
        request.destroy();
        return;
      }
      request.once('error', rejectOnce);
      request.once('socket', connectedSocket => {
        if (settled) {
          connectedSocket.destroy();
          return;
        }
        socket = connectedSocket;
        connectedSocket.once('secureConnect', () => {
          if (settled) return;
          if (connectTimer !== undefined) clearTimeout(connectTimer);
          if (lookupCalls !== 1) {
            rejectOnce(remoteError('REMOTE_DNS_PIN_VIOLATION', 'remote connection lost DNS pin'));
            return;
          }
          const family = normalizePeerFamily(connectedSocket.remoteFamily);
          const peerKey =
            family === null || connectedSocket.remoteAddress === undefined
              ? null
              : addressKey(connectedSocket.remoteAddress, family);
          const pinnedKey = addressKey(pinned.address, pinned.family);
          if (
            family !== pinned.family ||
            peerKey === null ||
            pinnedKey === null ||
            peerKey !== pinnedKey
          ) {
            rejectOnce(
              remoteError('REMOTE_ADDRESS_CHANGED', 'remote peer differs from pinned address'),
            );
            return;
          }
          secureConnected = true;
          headerTimer = setTimeout(
            () =>
              rejectOnce(
                remoteError('REMOTE_HEADERS_TIMEOUT', 'remote image response headers timed out'),
              ),
            this.timeouts.responseHeaderMs,
          );
        });
      });
      connectTimer = setTimeout(
        () =>
          rejectOnce(remoteError('REMOTE_CONNECT_TIMEOUT', 'remote image connection timed out')),
        this.timeouts.connectTlsMs,
      );
      try {
        request.end();
      } catch {
        rejectOnce(remoteError('REMOTE_REQUEST_FAILED', 'remote image request failed'));
      }
    });
  }

  async fetchApproved(
    rawUrl: string,
    inputPolicy: RemoteImagePolicy,
    callerSignal: AbortSignal,
  ): Promise<Readonly<RemoteImageFetchResult>> {
    if (callerSignal.aborted) throw abortError();
    const policy = validateRemoteImagePolicy(inputPolicy);
    const allowedDomains = new Set(policy.allowedDomains);
    const lifetime = new AbortController();
    const onCallerAbort = () => lifetime.abort(abortError());
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    const wholeTimer = setTimeout(
      () => lifetime.abort(remoteError('REMOTE_FETCH_TIMEOUT', 'remote image fetch timed out')),
      this.timeouts.wholeFetchMs,
    );
    try {
      let current = admitUrl(rawUrl, allowedDomains);
      const visited = new Set([current.href]);
      let redirects = 0;
      /* eslint-disable no-await-in-loop -- every redirect is re-admitted before the next DNS hop */
      for (;;) {
        throwIfAborted(lifetime.signal);
        const addresses = await this.resolve(current.hostname, lifetime.signal);
        const hop = await this.requestHop(
          current,
          addresses[0] as Readonly<PinnedAddress>,
          policy,
          lifetime.signal,
        );
        if (hop.kind === 'image') {
          return Object.freeze({
            bytes: hop.bytes,
            mime: hop.mime,
            finalUrlHash: `sha256:${createHash('sha256').update(current.href).digest('hex')}`,
          });
        }
        if (redirects >= policy.maxRedirects) {
          throw remoteError(
            'REMOTE_REDIRECT_LIMIT_EXCEEDED',
            'remote image redirect cap was exceeded',
          );
        }
        const next = admitRedirectLocation(hop.location, current, allowedDomains);
        if (visited.has(next.href)) {
          throw remoteError('REMOTE_REDIRECT_LOOP', 'remote image redirect loop was detected');
        }
        visited.add(next.href);
        current = next;
        redirects += 1;
      }
      /* eslint-enable no-await-in-loop */
    } finally {
      if (!lifetime.signal.aborted) {
        lifetime.abort(remoteError('REMOTE_FETCH_SETTLED', 'remote image fetch settled'));
      }
      clearTimeout(wholeTimer);
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export const createRemoteImageFetcher = (
  dependencies: RemoteImageFetcherDependencies = {},
): RemoteImageFetcher => new NodeRemoteImageFetcher(dependencies);
