import { decodeFollowerInnerMessage, encodeFollowerInnerMessage } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { NodeRole } from '../../src/election/node.js';
import { FollowerInvocationClient } from '../../src/execution/follower-invocation-client.js';
import {
  FollowerTransportError,
  type AuthenticatedPlaintextRecord,
  type FollowerTransportClient,
} from '../../src/security/follower-transport.js';

const records = async function* (): AsyncIterable<AuthenticatedPlaintextRecord> {
  yield { sequence: 0, final: false, plaintext: Uint8Array.from([1, 2]) };
  yield { sequence: 1, final: true, plaintext: Uint8Array.from([3]) };
};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
const operationId = 'operation-follower-mcp-cancel';
const tool = encodeFollowerInnerMessage({
  version: 1,
  type: 'tool',
  request: {
    version: 1,
    requestId,
    operationId,
    toolName: 'get_selection',
    rawArgs: {},
    workspaceId: null,
    targetSelector: { kind: 'active' },
  },
});
const cancel = encodeFollowerInnerMessage({
  version: 1,
  type: 'cancel',
  requestId,
  operationId,
});
const acceptedRecord = (): AuthenticatedPlaintextRecord => ({
  sequence: 0,
  final: false,
  plaintext: encodeFollowerInnerMessage({
    version: 1,
    type: 'accepted',
    requestId,
    operationId,
    operationKind: 'tool',
    operationName: 'get_selection',
  }),
});
const terminalRecord = (overrides?: { requestId?: typeof requestId; operationId?: string }) => ({
  sequence: 0,
  final: true,
  plaintext: encodeFollowerInnerMessage({
    version: 1,
    type: 'result',
    requestId: overrides?.requestId ?? requestId,
    operationId: overrides?.operationId ?? operationId,
    result: { cancelled: true },
  }),
});
const cancelErrorRecord = (code: string, retryable: boolean): AuthenticatedPlaintextRecord => ({
  sequence: 0,
  final: true,
  plaintext: encodeFollowerInnerMessage({
    version: 1,
    type: 'error',
    requestId,
    operationId,
    error: { code, message: 'authenticated cancel failed', retryable },
  }),
});
const waitForAbort = (signal: AbortSignal): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
const invocationThenWait = (signal: AbortSignal): AsyncIterable<AuthenticatedPlaintextRecord> =>
  (async function* () {
    yield acceptedRecord();
    await waitForAbort(signal);
  })();
const acknowledgement = (): AsyncIterable<AuthenticatedPlaintextRecord> =>
  (async function* () {
    yield terminalRecord();
  })();
const recordsFailingWith = (
  next: () => Promise<never>,
): AsyncIterable<AuthenticatedPlaintextRecord> => ({
  [Symbol.asyncIterator]: () => ({ next }),
});
const transportFor = (open: FollowerTransportClient['open']): FollowerTransportClient =>
  ({
    mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
    leaderInfo: async () => undefined,
    open,
  }) as FollowerTransportClient;
const decodedTypes = (sent: readonly Uint8Array[]): string[] =>
  sent.map(bytes => decodeFollowerInnerMessage(bytes).type);
const collect = async (stream: AsyncIterable<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  let error: unknown;
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { chunks, error };
};

describe('opaque follower invocation client', () => {
  it('uses the authenticated public stream facade once and yields ordered plaintext only', async () => {
    const open = vi.fn<FollowerTransportClient['open']>(async () => records());
    const transport = {
      mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
      leaderInfo: async () => undefined,
      open,
    } as FollowerTransportClient;
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const signal = new AbortController().signal;
    const stream = await client.open(Uint8Array.from([9, 8, 7]), signal);
    const chunks: number[][] = [];
    for await (const chunk of stream) chunks.push([...chunk]);

    expect(chunks).toEqual([[1, 2], [3]]);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/rpc',
        plaintext: Uint8Array.from([9, 8, 7]),
        transportRequestId: expect.stringMatching(/^sfp_req1_/),
      }),
      expect.any(AbortSignal),
    );
  });

  it.each([NodeRole.Unknown, NodeRole.Conflicted, NodeRole.Leader])(
    'forwards no payload while role is %s',
    async role => {
      const open = vi.fn<FollowerTransportClient['open']>();
      const client = new FollowerInvocationClient(
        {
          mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
          leaderInfo: async () => undefined,
          open,
        } as unknown as FollowerTransportClient,
        () => role,
      );
      await expect(
        client.open(Uint8Array.from([1]), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'FOLLOWER_ROLE_REQUIRED' });
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('latches an abort before transport open until the matching accepted record is authenticated', async () => {
    const opened = deferred();
    const releaseOpen = deferred();
    const sent: Uint8Array[] = [];
    const transport = transportFor(async (input, signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return acknowledgement();
      }
      opened.resolve();
      await releaseOpen.promise;
      return invocationThenWait(signal);
    });
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const opening = client.open(tool, controller.signal, cancel);
    await opened.promise;

    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    await Promise.resolve();
    const beforeAccepted = decodedTypes(sent);
    releaseOpen.resolve();
    const outcome = await collect(await opening);

    expect(beforeAccepted).toEqual(['tool']);
    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
    expect(outcome.chunks.map(bytes => decodeFollowerInnerMessage(bytes).type)).toEqual([
      'accepted',
    ]);
  });

  it('keeps the authenticated body open when abort lands after headers but before accepted', async () => {
    const bodyEntered = deferred();
    const releaseAccepted = deferred();
    const sent: Uint8Array[] = [];
    const transport = transportFor(async (input, signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return acknowledgement();
      }
      return (async function* () {
        bodyEntered.resolve();
        await releaseAccepted.promise;
        yield acceptedRecord();
        await waitForAbort(signal);
      })();
    });
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const stream = await client.open(tool, controller.signal, cancel);
    const consuming = collect(stream);
    await bodyEntered.promise;

    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    await Promise.resolve();
    const beforeAccepted = decodedTypes(sent);
    releaseAccepted.resolve();
    const outcome = await consuming;

    expect(beforeAccepted).toEqual(['tool']);
    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
    expect(outcome.chunks.map(bytes => decodeFollowerInnerMessage(bytes).type)).toEqual([
      'accepted',
    ]);
  });

  it('processes a matching accepted record that arrives in the same turn as abort', async () => {
    const sent: Uint8Array[] = [];
    const controller = new AbortController();
    const transport = transportFor(async (input, signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return acknowledgement();
      }
      return (async function* () {
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
        yield acceptedRecord();
        await waitForAbort(signal);
      })();
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);

    const outcome = await collect(await client.open(tool, controller.signal, cancel));

    expect(outcome.chunks.map(bytes => decodeFollowerInnerMessage(bytes).type)).toEqual([
      'accepted',
    ]);
    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
  });

  it('sends exactly one authenticated same-session cancel after accepted', async () => {
    const sent: Uint8Array[] = [];
    const transport = transportFor(
      async (input, signal): Promise<AsyncIterable<AuthenticatedPlaintextRecord>> => {
        sent.push(Uint8Array.from(input.plaintext));
        if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
          return acknowledgement();
        }
        return invocationThenWait(signal);
      },
    );
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const stream = await client.open(tool, controller.signal, cancel);
    const consuming = (async () => {
      for await (const chunk of stream) {
        void chunk;
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
      }
    })();
    await consuming.catch(() => undefined);

    expect(sent.map(bytes => decodeFollowerInnerMessage(bytes))).toEqual([
      expect.objectContaining({
        type: 'tool',
        request: expect.objectContaining({ requestId, operationId }),
      }),
      { version: 1, type: 'cancel', requestId, operationId },
    ]);
  });

  it('does not cancel when an authenticated matching terminal arrives before accepted', async () => {
    const sent: Uint8Array[] = [];
    const transport = transportFor(async input => {
      sent.push(Uint8Array.from(input.plaintext));
      return (async function* () {
        yield terminalRecord();
      })();
    });
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const stream = await client.open(tool, controller.signal, cancel);

    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    const outcome = await collect(stream);

    expect(decodedTypes(sent)).toEqual(['tool']);
    expect(outcome.error).toBeUndefined();
    expect(outcome.chunks.map(bytes => decodeFollowerInnerMessage(bytes).type)).toEqual(['result']);
  });

  it('surfaces an authenticated cancel acknowledgement with the wrong operation identity', async () => {
    const sent: Uint8Array[] = [];
    const transport = transportFor(async (input, signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return (async function* () {
          yield terminalRecord({ operationId: 'operation-wrong' });
        })();
      }
      return invocationThenWait(signal);
    });
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const iterator = (await client.open(tool, controller.signal, cancel))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    await expect(iterator.next()).rejects.toMatchObject({ code: 'FOLLOWER_STREAM_INVALID' });
    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
  });

  it('reconciles a latched abort after the authenticated invocation stream fails before accepted', async () => {
    const bodyEntered = deferred();
    const releaseFailure = deferred();
    const sent: Uint8Array[] = [];
    const transport = transportFor(async (input, _signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return acknowledgement();
      }
      return recordsFailingWith(async () => {
        bodyEntered.resolve();
        await releaseFailure.promise;
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      });
    });
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const consuming = collect(await client.open(tool, controller.signal, cancel));
    await bodyEntered.promise;

    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    releaseFailure.resolve();
    const outcome = await consuming;

    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
    expect(outcome.error).toMatchObject({ code: 'FOLLOWER_RESPONSE_TRUNCATED' });
  });

  it('retries only authenticated not-yet-admitted cancel responses until delayed admission', async () => {
    const sent: Uint8Array[] = [];
    let cancelAttempts = 0;
    const controller = new AbortController();
    const transport = transportFor(async input => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        cancelAttempts += 1;
        return (async function* () {
          yield cancelAttempts < 3
            ? cancelErrorRecord('FOLLOWER_CANCEL_NOT_ADMITTED', true)
            : terminalRecord();
        })();
      }
      return recordsFailingWith(async () => {
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      });
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);

    const outcome = await collect(await client.open(tool, controller.signal, cancel));

    expect(decodedTypes(sent)).toEqual(['tool', 'cancel', 'cancel', 'cancel']);
    expect(outcome.error).toMatchObject({ code: 'FOLLOWER_RESPONSE_TRUNCATED' });
  });

  it('surfaces authenticated cancel failure instead of the pre-accepted stream error', async () => {
    const sent: Uint8Array[] = [];
    const controller = new AbortController();
    const transport = transportFor(async input => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        return (async function* () {
          yield cancelErrorRecord('INTERNAL_ERROR', false);
        })();
      }
      return recordsFailingWith(async () => {
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      });
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);

    const outcome = await collect(await client.open(tool, controller.signal, cancel));

    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
    expect(outcome.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
  });

  it('surfaces cancel authentication failure after a latched pre-accepted disconnect', async () => {
    const sent: Uint8Array[] = [];
    const controller = new AbortController();
    const transport = transportFor(async input => {
      sent.push(Uint8Array.from(input.plaintext));
      if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
        throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
      }
      return recordsFailingWith(async () => {
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
        throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
      });
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);

    const outcome = await collect(await client.open(tool, controller.signal, cancel));

    expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
    expect(outcome.error).toMatchObject({ code: 'FOLLOWER_AUTH_INVALID' });
  });

  it('surfaces bounded cancel timeout after a latched pre-accepted disconnect', async () => {
    vi.useFakeTimers();
    try {
      const sent: Uint8Array[] = [];
      const controller = new AbortController();
      const transport = transportFor(async (input, signal) => {
        sent.push(Uint8Array.from(input.plaintext));
        if (decodeFollowerInnerMessage(input.plaintext).type === 'cancel') {
          return new Promise<never>((_resolve, reject) => {
            const abort = (): void => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
        }
        return recordsFailingWith(async () => {
          controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
          throw new FollowerTransportError('FOLLOWER_RESPONSE_TRUNCATED');
        });
      });
      const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
      const consuming = collect(await client.open(tool, controller.signal, cancel));

      await vi.advanceTimersByTimeAsync(5_000);
      const outcome = await consuming;

      expect(decodedTypes(sent)).toEqual(['tool', 'cancel']);
      expect(outcome.error).toMatchObject({ code: 'FOLLOWER_CANCEL_TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces initial follower authentication failure without manufacturing cancel', async () => {
    const sent: Uint8Array[] = [];
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
    const transport = transportFor(async input => {
      sent.push(Uint8Array.from(input.plaintext));
      throw new FollowerTransportError('FOLLOWER_AUTH_INVALID');
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);

    await expect(client.open(tool, controller.signal, cancel)).rejects.toMatchObject({
      code: 'FOLLOWER_AUTH_INVALID',
    });
    expect(decodedTypes(sent)).toEqual(['tool']);
  });

  it('treats subscriber iterator disconnect as unsubscribe without sending cancel', async () => {
    const sent: Uint8Array[] = [];
    const transport = transportFor(async (input, signal) => {
      sent.push(Uint8Array.from(input.plaintext));
      return invocationThenWait(signal);
    });
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const iterator = (await client.open(tool, new AbortController().signal, cancel))[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await iterator.return?.();

    expect(decodedTypes(sent)).toEqual(['tool']);
  });
});
