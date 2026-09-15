import {
  FOLLOWER_RESPONSE_MAX_CUMULATIVE_BYTES,
  decodeFollowerInnerMessage,
  encodeFollowerInnerMessage,
  safeInvocationError,
  type ActorContext,
  type InvocationFrameV1,
} from '@sfp/shared';

import type { FollowerResponseSink } from '../security/follower-transport.js';
import { FOLLOWER_CANCEL_NOT_ADMITTED } from './follower-invocation-client.js';

interface FollowerPlanePort {
  invokeTool(
    principal: Readonly<ActorContext>,
    request: unknown,
    subscriberSignal?: AbortSignal,
  ): AsyncIterable<InvocationFrameV1> | Promise<unknown>;
  invokeService(
    principal: Readonly<ActorContext>,
    request: unknown,
    subscriberSignal?: AbortSignal,
  ): AsyncIterable<InvocationFrameV1> | Promise<unknown>;
  cancel(principal: Readonly<ActorContext>, request: unknown): Promise<void>;
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<InvocationFrameV1> =>
  typeof value === 'object' &&
  value !== null &&
  Symbol.asyncIterator in value &&
  typeof value[Symbol.asyncIterator] === 'function';

export const createFollowerInvocationEndpoint =
  (dependencies: {
    principalForMcpSession(mcpSession: string): Readonly<ActorContext>;
    plane: FollowerPlanePort;
  }) =>
  async (
    opened: { readonly mcpSession: string; readonly plaintext: Uint8Array },
    response: FollowerResponseSink,
    subscriberSignal: AbortSignal,
  ): Promise<void> => {
    const inner = decodeFollowerInnerMessage(opened.plaintext);
    const principal = dependencies.principalForMcpSession(opened.mcpSession);
    if (inner.type === 'cancel') {
      try {
        await dependencies.plane.cancel(principal, {
          version: inner.version,
          requestId: inner.requestId,
          operationId: inner.operationId,
        });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        const safe =
          code === 'OPERATION_NOT_FOUND'
            ? {
                code: FOLLOWER_CANCEL_NOT_ADMITTED,
                message: 'operation admission is not yet visible',
                retryable: true,
              }
            : safeInvocationError(error);
        await response.write(
          encodeFollowerInnerMessage({
            version: 1,
            type: 'error',
            requestId: inner.requestId,
            operationId: inner.operationId,
            error: safe,
          }),
          { final: true },
        );
        return;
      }
      await response.write(
        encodeFollowerInnerMessage({
          version: 1,
          type: 'result',
          requestId: inner.requestId,
          operationId: inner.operationId,
          result: { cancelled: true },
        }),
        { final: true },
      );
      return;
    }
    if (inner.type !== 'tool' && inner.type !== 'service') {
      throw Object.assign(
        new Error('follower request must be a tool, service, or cancel message'),
        {
          code: 'FOLLOWER_INNER_INVALID',
        },
      );
    }
    const invoked =
      inner.type === 'tool'
        ? dependencies.plane.invokeTool(principal, inner.request, subscriberSignal)
        : dependencies.plane.invokeService(principal, inner.request, subscriberSignal);
    const request = inner.request;
    const operationKind = inner.type;
    const operationName =
      inner.type === 'tool' ? inner.request.toolName : inner.request.serviceOperationName;
    const frames: AsyncIterable<InvocationFrameV1> = isAsyncIterable(invoked)
      ? invoked
      : (async function* () {
          const operationId = request.operationId ?? `native-${request.requestId}`;
          yield {
            version: 1,
            type: 'accepted',
            requestId: request.requestId,
            operationId,
            operationKind,
            operationName,
          } as InvocationFrameV1;
          try {
            yield {
              version: 1,
              type: 'result',
              requestId: request.requestId,
              operationId,
              result: await invoked,
            } as InvocationFrameV1;
          } catch (error) {
            const safe = safeInvocationError(error);
            yield {
              version: 1,
              type: 'error',
              requestId: request.requestId,
              operationId,
              error: safe,
            } as InvocationFrameV1;
          }
        })();
    if (subscriberSignal.aborted) return;
    let cumulative = 0;
    try {
      for await (const frame of frames) {
        if (subscriberSignal.aborted) return;
        const safeFrame =
          frame.type === 'error'
            ? ({ ...frame, error: safeInvocationError(frame.error) } as InvocationFrameV1)
            : frame;
        const encoded = encodeFollowerInnerMessage(safeFrame);
        cumulative += encoded.byteLength;
        if (cumulative > FOLLOWER_RESPONSE_MAX_CUMULATIVE_BYTES) {
          await response.truncate();
          return;
        }
        await response.write(encoded, {
          final: safeFrame.type === 'result' || safeFrame.type === 'error',
        });
      }
    } catch (error) {
      if (subscriberSignal.aborted) return;
      throw error;
    }
  };
