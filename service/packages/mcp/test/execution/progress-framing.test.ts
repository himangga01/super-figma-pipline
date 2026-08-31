import { encode } from '@msgpack/msgpack';
import {
  decodeFollowerInnerMessage,
  encodeFollowerInnerMessage,
  FOLLOWER_INNER_MAX_PAYLOAD_BYTES,
  FollowerInnerMessageSchema,
  measureMessagePackUpperBound,
  safeInvocationError,
} from '@sfp/shared';
import { describe, expect, it } from 'vitest';

const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;

describe('strict four-byte MessagePack invocation framing', () => {
  it('round-trips a strict frame with one big-endian payload length', () => {
    const input = {
      version: 1,
      type: 'cancel',
      requestId,
      operationId: 'operation-1',
    } as const;
    const encoded = encodeFollowerInnerMessage(input);

    expect(
      new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(0, false),
    ).toBe(encoded.byteLength - 4);
    expect(decodeFollowerInnerMessage(encoded)).toEqual(input);
    expect(FollowerInnerMessageSchema.parse(input)).toEqual(input);
  });

  it('rejects an oversized declared prefix before MessagePack decode or payload allocation', () => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(FOLLOWER_INNER_MAX_PAYLOAD_BYTES + 1);
    expect(() => decodeFollowerInnerMessage(prefix)).toThrowError(
      expect.objectContaining({ code: 'FOLLOWER_INNER_TOO_LARGE', beforeDecode: true }),
    );
  });

  it('rejects unknown fields and trailing bytes', () => {
    expect(() =>
      encodeFollowerInnerMessage({
        version: 1,
        type: 'cancel',
        requestId,
        operationId: 'operation-1',
        actorId: 'forged',
      }),
    ).toThrowError(expect.objectContaining({ code: 'FOLLOWER_INNER_INVALID' }));
    const valid = encodeFollowerInnerMessage({
      version: 1,
      type: 'cancel',
      requestId,
      operationId: 'operation-1',
    });
    expect(() => decodeFollowerInnerMessage(Buffer.concat([valid, Buffer.from([0])]))).toThrowError(
      expect.objectContaining({ code: 'FOLLOWER_INNER_LENGTH_MISMATCH' }),
    );
  });

  it('rejects an over-limit outbound MessagePack value in preflight before encoder allocation', () => {
    expect(() =>
      encodeFollowerInnerMessage({
        version: 1,
        type: 'result',
        requestId,
        operationId: 'operation-1',
        result: 'a'.repeat(FOLLOWER_INNER_MAX_PAYLOAD_BYTES + 1),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'FOLLOWER_INNER_TOO_LARGE',
        beforeEncode: true,
      }),
    );
  });

  it('redacts adversarial plugin/internal messages to one bounded typed safe error', () => {
    const secret =
      'C:\\Users\\owner\\secret.fig https://token.example/a?key=abc data:image/png;base64,AAAA';
    const safe = safeInvocationError(
      Object.assign(new Error(secret.repeat(100)), {
        code: 'PLUGIN_RESULT_INVALID',
        rawArgs: secret,
      }),
    );

    expect(safe).toEqual({
      code: 'PLUGIN_RESULT_INVALID',
      message: 'plugin returned an invalid result',
      retryable: false,
    });
    expect(JSON.stringify(safe)).not.toContain('secret.fig');
    expect(JSON.stringify(safe)).not.toContain('token.example');
    expect(JSON.stringify(safe)).not.toContain('base64');
  });

  it('rejects a noninteger numeric array from a real MessagePack upper bound before encoding', () => {
    const members = Math.floor(FOLLOWER_INNER_MAX_PAYLOAD_BYTES / 9) + 1;
    const values = Array.from({ length: members }, () => 1.5);
    expect(() =>
      measureMessagePackUpperBound(values, FOLLOWER_INNER_MAX_PAYLOAD_BYTES),
    ).toThrowError(
      expect.objectContaining({
        code: 'FOLLOWER_INNER_TOO_LARGE',
        beforeEncode: true,
        beforeAllocation: true,
      }),
    );
  });

  it('never undercounts actual MessagePack bytes for nested adversarial prefix boundaries', () => {
    const corpus: unknown[] = [
      Array.from({ length: 15 }, (_, index) => index),
      Array.from({ length: 16 }, (_, index) => index + 0.5),
      Array.from({ length: 256 }, () => -32_769),
      Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`k${index}`, index])),
      Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`k${index}`, 'two-byte'])),
      {
        nested: [
          { text: String.fromCodePoint(0x1f600).repeat(1_024), bin: new Uint8Array(65_536) },
        ],
      },
    ];
    for (const value of corpus) {
      const actual = encode(value).byteLength;
      expect(measureMessagePackUpperBound(value, actual + 1_024)).toBeGreaterThanOrEqual(actual);
    }
  });
});
