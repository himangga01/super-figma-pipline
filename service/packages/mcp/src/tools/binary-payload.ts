/**
 * Reading the export payload off a plugin reply, whichever way it arrived.
 *
 * The disk-landing tools (save_screenshots / export_pdf / export_video / save_image_fills) ask the
 * plugin for raw bytes with a `binary: true` request flag, written as a literal at each dispatch
 * site rather than shared as a constant — `test/plugin-contract.ts` reads the plugin-facing
 * argument surface out of the source text, and a spread of a named constant is exactly the shape it
 * cannot see. A plugin new enough to understand it answers with `bytes` — msgpack carries a
 * Uint8Array as a native `bin`, so the payload skips base64's 33% inflation and the encoder's
 * per-character string scan. A plugin predating the flag drops it silently (handlers read named
 * params off a loose cast) and answers with `base64`, so both shapes stay live and this is the one
 * place that knows the difference.
 */

/** A reply carrying export bytes one way or the other. */
export interface BinaryCarrier {
  base64?: string | null | undefined;
  bytes?: Uint8Array | undefined;
}

export type BinaryPayloadLimitCode = 'PAYLOAD_TOO_LARGE' | 'EXPORT_TOO_LARGE';

export interface BinaryPayloadLimits {
  encodedMaxBytes?: number;
  decodedMaxBytes: number;
  code: BinaryPayloadLimitCode;
}

export class BinaryPayloadError extends Error {
  readonly status = 413;

  constructor(
    readonly code: BinaryPayloadLimitCode,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`[${code}] binary payload ${observed} exceeds ${limit} bytes`);
    this.name = 'BinaryPayloadError';
  }
}

const assertLimit = (observed: number, limit: number, code: BinaryPayloadLimitCode): void => {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('binary limit is invalid');
  if (observed > limit) throw new BinaryPayloadError(code, limit, observed);
};

/** Computes decoded bytes without allocating/decoding the attacker-controlled base64 string. */
export const base64DecodedByteLength = (base64: string): number =>
  Buffer.byteLength(base64, 'base64');

export const assertBase64Payload = (base64: string, limits: BinaryPayloadLimits): void => {
  if (limits.encodedMaxBytes !== undefined) {
    assertLimit(Buffer.byteLength(base64, 'utf8'), limits.encodedMaxBytes, limits.code);
  }
  assertLimit(base64DecodedByteLength(base64), limits.decodedMaxBytes, limits.code);
};

/**
 * The payload as bytes, or null when nothing was exported. `bytes` wins when present; otherwise the
 * legacy base64 is decoded. Both absent (or base64 null) means the node was missing, not
 * exportable, or the export failed — every caller maps that to a null path.
 */
export const binaryPayload = (
  carrier: BinaryCarrier,
  limits?: BinaryPayloadLimits,
): Buffer | null => {
  if (carrier.bytes !== undefined) {
    if (limits !== undefined)
      assertLimit(carrier.bytes.byteLength, limits.decodedMaxBytes, limits.code);
    return Buffer.from(carrier.bytes);
  }
  const b64 = carrier.base64;
  if (b64 === undefined || b64 === null) return null;
  if (limits !== undefined) assertBase64Payload(b64, limits);
  const decoded = Buffer.from(b64, 'base64');
  if (limits !== undefined) assertLimit(decoded.byteLength, limits.decodedMaxBytes, limits.code);
  return decoded;
};
