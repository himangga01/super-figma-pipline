import { describe, expect, it } from 'vitest';

import {
  BASE64_IMAGE_MAX_BYTES,
  DECODED_IMAGE_MAX_BYTES,
} from '../../src/security/request-limits.js';
import { binaryPayload } from '../../src/tools/binary-payload.js';

describe('binaryPayload', () => {
  it('takes the raw bytes when the plugin answered the binary request', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(binaryPayload({ base64: null, bytes })).toEqual(Buffer.from(bytes));
  });

  it('falls back to base64 for a plugin that dropped the binary flag', () => {
    expect(binaryPayload({ base64: 'iVBORw==' })).toEqual(Buffer.from('iVBORw==', 'base64'));
  });

  it('prefers bytes when a reply somehow carries both', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(binaryPayload({ base64: 'AAAA', bytes })).toEqual(Buffer.from(bytes));
  });

  it('reports nothing exported for base64 null, an absent base64, or an empty reply', () => {
    expect(binaryPayload({ base64: null })).toBeNull();
    expect(binaryPayload({})).toBeNull();
  });

  it('keeps zero-length bytes distinct from nothing exported', () => {
    // A blank-but-real export (an empty frame) must still land a file rather than a null path.
    const empty = binaryPayload({ base64: null, bytes: new Uint8Array(0) });
    expect(empty).not.toBeNull();
    expect(empty?.byteLength).toBe(0);
  });

  it('accepts the exact encoded/decoded image caps and rejects encoded cap plus one quantum', () => {
    const exact = 'A'.repeat(BASE64_IMAGE_MAX_BYTES);
    expect(
      binaryPayload(
        { base64: exact },
        {
          encodedMaxBytes: BASE64_IMAGE_MAX_BYTES,
          decodedMaxBytes: DECODED_IMAGE_MAX_BYTES,
          code: 'PAYLOAD_TOO_LARGE',
        },
      ),
    ).toHaveLength(DECODED_IMAGE_MAX_BYTES);

    expect(() =>
      binaryPayload(
        { base64: `${exact}AAAA` },
        {
          encodedMaxBytes: BASE64_IMAGE_MAX_BYTES,
          decodedMaxBytes: DECODED_IMAGE_MAX_BYTES + 4,
          code: 'PAYLOAD_TOO_LARGE',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('rejects decoded base64 and native bytes at the decoded cap plus one', () => {
    const decodedPlusOne = `${'A'.repeat(BASE64_IMAGE_MAX_BYTES)}AAAA`;
    expect(() =>
      binaryPayload(
        { base64: decodedPlusOne },
        {
          encodedMaxBytes: BASE64_IMAGE_MAX_BYTES + 4,
          decodedMaxBytes: DECODED_IMAGE_MAX_BYTES,
          code: 'PAYLOAD_TOO_LARGE',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));

    expect(
      binaryPayload(
        { bytes: new Uint8Array(DECODED_IMAGE_MAX_BYTES) },
        { decodedMaxBytes: DECODED_IMAGE_MAX_BYTES, code: 'PAYLOAD_TOO_LARGE' },
      ),
    ).toHaveLength(DECODED_IMAGE_MAX_BYTES);
    expect(() =>
      binaryPayload(
        { bytes: new Uint8Array(DECODED_IMAGE_MAX_BYTES + 1) },
        { decodedMaxBytes: DECODED_IMAGE_MAX_BYTES, code: 'PAYLOAD_TOO_LARGE' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });
});
