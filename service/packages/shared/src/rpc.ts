import { decode, encode } from '@msgpack/msgpack';
import { z } from 'zod';

import { InvocationCancelV1Schema } from './control.js';
import { InvocationRequestV1Schema } from './invocation.js';
import { InvocationFrameV1Schema, PROGRESS_TRANSPORT_LIMITS } from './progress.js';
import { ServiceOperationRequestV1Schema } from './service-operations.js';

export const RpcRequestSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  args: z.unknown().optional(),
  // Pins this call to a specific plugin session on the leader. A follower running a multi-call tool
  // (e.g. component_map) resolves the active session once, then sends every sub-call with the same
  // sessionId so they can't drift to different plugins mid-flight. Absent = route to most-active.
  sessionId: z.string().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcOkResponseSchema = z.object({
  kind: z.literal('ok'),
  requestId: z.string(),
  result: z.unknown(),
  // Set by the leader when the plugin that served this call is older than the server. Only the
  // leader holds the relay, so a follower has no other way to learn it — and the warning has to
  // reach whoever is actually calling tools, whichever role their process ended up in.
  notice: z.string().optional(),
});
export type RpcOkResponse = z.infer<typeof RpcOkResponseSchema>;

export const RpcErrResponseSchema = z.object({
  kind: z.literal('err'),
  requestId: z.string(),
  code: z.string(),
  message: z.string(),
});
export type RpcErrResponse = z.infer<typeof RpcErrResponseSchema>;

export const RpcResponseSchema = z.discriminatedUnion('kind', [
  RpcOkResponseSchema,
  RpcErrResponseSchema,
]);
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const FOLLOWER_INNER_MAX_TOTAL_BYTES = 9_437_184 as const;
export const FOLLOWER_INNER_MAX_PAYLOAD_BYTES = 9_437_180 as const;
export const FOLLOWER_RESPONSE_MAX_CUMULATIVE_BYTES = 67_108_864 as const;

const FollowerToolInvocationSchema = z
  .object({ version: z.literal(1), type: z.literal('tool'), request: InvocationRequestV1Schema })
  .strict();
const FollowerServiceInvocationSchema = z
  .object({
    version: z.literal(1),
    type: z.literal('service'),
    request: ServiceOperationRequestV1Schema,
  })
  .strict();
const FollowerCancelSchema = InvocationCancelV1Schema.extend({
  type: z.literal('cancel'),
}).strict();
export const FollowerInnerMessageSchema = z.union([
  FollowerToolInvocationSchema,
  FollowerServiceInvocationSchema,
  FollowerCancelSchema,
  InvocationFrameV1Schema,
]);
export type FollowerInnerMessage = z.infer<typeof FollowerInnerMessageSchema>;

const innerError = (code: string, message: string, details: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...details });

const messagePackUtf8Bytes = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) as number;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
};
const messagePackStringPrefix = (length: number): number =>
  length <= 31 ? 1 : length <= 0xff ? 2 : length <= 0xffff ? 3 : 5;
const messagePackBinaryPrefix = (length: number): number =>
  length <= 0xff ? 2 : length <= 0xffff ? 3 : 5;
const messagePackCollectionPrefix = (length: number): number =>
  length <= 15 ? 1 : length <= 0xffff ? 3 : 5;

export const measureMessagePackUpperBound = (value: unknown, maxBytes: number): number => {
  let bytes = 0;
  const add = (count: number): void => {
    bytes += count;
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
      throw innerError('FOLLOWER_INNER_TOO_LARGE', 'inner follower message exceeds its limit', {
        beforeEncode: true,
        beforeAllocation: true,
      });
    }
  };
  const visit = (child: unknown, ancestors: Set<object>): void => {
    if (child === null || typeof child === 'boolean') {
      add(1);
      return;
    }
    if (typeof child === 'number') {
      if (!Number.isFinite(child)) {
        add(9);
      } else if (!Number.isInteger(child)) {
        add(9);
      } else if (child >= 0) {
        add(
          child <= 0x7f ? 1 : child <= 0xff ? 2 : child <= 0xffff ? 3 : child <= 0xffffffff ? 5 : 9,
        );
      } else {
        add(
          child >= -32 ? 1 : child >= -128 ? 2 : child >= -32768 ? 3 : child >= -2147483648 ? 5 : 9,
        );
      }
      return;
    }
    if (typeof child === 'string') {
      const length = messagePackUtf8Bytes(child);
      add(messagePackStringPrefix(length) + length);
      return;
    }
    if (child instanceof Uint8Array) {
      add(messagePackBinaryPrefix(child.byteLength) + child.byteLength);
      return;
    }
    if (typeof child !== 'object' || child === undefined || ancestors.has(child)) {
      throw innerError('FOLLOWER_INNER_INVALID', 'inner follower value cannot be encoded', {
        beforeEncode: true,
      });
    }
    ancestors.add(child);
    if (Array.isArray(child)) {
      add(messagePackCollectionPrefix(child.length));
      for (const member of child) visit(member, ancestors);
    } else {
      const entries = Object.entries(child);
      add(messagePackCollectionPrefix(entries.length));
      for (const [key, member] of entries) {
        visit(key, ancestors);
        visit(member, ancestors);
      }
    }
    ancestors.delete(child);
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) add(Number.MAX_SAFE_INTEGER);
  visit(value, new Set());
  return bytes;
};

export const encodeFollowerInnerMessage = (value: unknown): Uint8Array => {
  const parsed = FollowerInnerMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw innerError('FOLLOWER_INNER_INVALID', 'inner follower message is invalid', {
      cause: parsed.error,
    });
  }
  const maxPayload =
    parsed.data.type === 'progress'
      ? PROGRESS_TRANSPORT_LIMITS.maxProgressFrameBytesIncludingPrefix - 4
      : FOLLOWER_INNER_MAX_PAYLOAD_BYTES;
  measureMessagePackUpperBound(parsed.data, maxPayload);
  const payload = encode(parsed.data);
  if (payload.byteLength > maxPayload) {
    throw innerError('FOLLOWER_INNER_TOO_LARGE', 'inner follower message exceeds its limit', {
      beforeEncode: true,
    });
  }
  const frame = new Uint8Array(payload.byteLength + 4);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
};

export const decodeFollowerInnerMessage = (input: Uint8Array): FollowerInnerMessage => {
  if (input.byteLength < 4) {
    throw innerError('FOLLOWER_INNER_LENGTH_MISMATCH', 'inner follower prefix is incomplete', {
      beforeDecode: true,
    });
  }
  const bytes = input;
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    0,
    false,
  );
  if (declared > FOLLOWER_INNER_MAX_PAYLOAD_BYTES) {
    throw innerError('FOLLOWER_INNER_TOO_LARGE', 'inner follower message exceeds its limit', {
      beforeDecode: true,
    });
  }
  if (declared + 4 !== bytes.byteLength) {
    throw innerError('FOLLOWER_INNER_LENGTH_MISMATCH', 'inner follower length does not match', {
      beforeDecode: true,
    });
  }
  let decoded: unknown;
  try {
    decoded = decode(bytes.subarray(4));
  } catch (cause) {
    throw innerError('FOLLOWER_INNER_INVALID', 'inner follower MessagePack is invalid', { cause });
  }
  const parsed = FollowerInnerMessageSchema.safeParse(decoded);
  if (!parsed.success) {
    throw innerError('FOLLOWER_INNER_INVALID', 'inner follower message is invalid', {
      cause: parsed.error,
    });
  }
  if (
    parsed.data.type === 'progress' &&
    bytes.byteLength > PROGRESS_TRANSPORT_LIMITS.maxProgressFrameBytesIncludingPrefix
  ) {
    throw innerError('FOLLOWER_INNER_TOO_LARGE', 'inner progress frame exceeds its limit', {
      beforeDecode: false,
    });
  }
  return parsed.data;
};
