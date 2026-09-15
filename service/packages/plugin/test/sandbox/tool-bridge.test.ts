import { describe, expect, it, vi } from 'vitest';

import {
  createToolProgress,
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  type PluginBridgeMessage,
} from '../../protocol/bridge.js';
import {
  createToolBridge,
  type PostMessageFn,
  type SubscribeFn,
} from '../../ui/sandbox/tool-bridge.js';

interface Harness {
  bridge: ReturnType<typeof createToolBridge>;
  sent: PluginBridgeMessage[];
  emit: (raw: unknown) => void;
}

const setup = (timeoutMs?: number): Harness => {
  const sent: PluginBridgeMessage[] = [];
  const emitter: { current: ((raw: unknown) => void) | null } = { current: null };
  const postMessage: PostMessageFn = msg => sent.push(msg);
  const subscribe: SubscribeFn = cb => {
    emitter.current = cb;
    return () => {
      emitter.current = null;
    };
  };
  const bridge = createToolBridge({
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    postMessage,
    subscribe,
  });
  return {
    bridge,
    sent,
    emit: raw => emitter.current?.(raw),
  };
};

describe('createToolBridge', () => {
  it('posts a tagged tool-call when handler is invoked', async () => {
    const { bridge, sent, emit } = setup();
    const promise = bridge.handler('ping', { foo: 1 });
    expect(sent).toHaveLength(1);
    expect(isPluginBridgeMessage(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: 'tool-call',
      method: 'ping',
      params: { foo: 1 },
    });
    emit(createToolResult({ id: sent[0]!.id, result: { pong: true } }));
    await expect(promise).resolves.toEqual({ pong: true });
    expect(bridge.pendingCount()).toBe(0);
  });

  it('rejects when sandbox replies with tool-error', async () => {
    const { bridge, sent, emit } = setup();
    const promise = bridge.handler('ping', undefined);
    emit(createToolError({ id: sent[0]!.id, code: 'BOOM', message: 'sandbox failed' }));
    await expect(promise).rejects.toThrow(/BOOM: sandbox failed/);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('times out when sandbox never replies', async () => {
    const { bridge } = setup(20);
    await expect(bridge.handler('ping', undefined)).rejects.toThrow(/timeout/);
  });

  it('does not retain pending work when posting the initial sandbox call fails', async () => {
    const bridge = createToolBridge({
      timeoutMs: 60_000,
      postMessage: message => {
        if (message.kind === 'tool-call') throw new Error('sandbox transport unavailable');
      },
      subscribe: () => () => undefined,
    });

    await expect(bridge.handler('ping', undefined)).rejects.toThrow(/transport unavailable/);
    const retained = bridge.pendingCount();
    bridge.dispose();
    expect(retained).toBe(0);
  });

  it('forwards timeout and disposal cancellation for bound sandbox work', async () => {
    const binding = {
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      operationId: 'operation-timeout',
      actionNonce: 'action-timeout',
    } as const;
    const timed = setup(10);
    await expect(timed.bridge.handler('ping', {}, binding)).rejects.toThrow(/timeout/);
    expect(timed.sent.at(-1)).toMatchObject({ kind: 'tool-cancel', binding });

    const disposed = setup();
    const pending = disposed.bridge.handler('ping', {}, binding);
    disposed.bridge.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(disposed.sent.at(-1)).toMatchObject({ kind: 'tool-cancel', binding });
  });

  it('ignores orphan replies for unknown ids', async () => {
    const log = vi.fn<(msg: string) => void>();
    const emitter: { current: ((raw: unknown) => void) | null } = { current: null };
    const bridge = createToolBridge({
      log,
      postMessage: () => {},
      subscribe: cb => {
        emitter.current = cb;
        return () => {
          emitter.current = null;
        };
      },
    });
    emitter.current?.(createToolResult({ id: 'never-sent', result: 1 }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('orphan'));
    bridge.dispose();
  });

  it('ignores non-bridge messages (e.g. Figma internals)', () => {
    const { emit } = setup();
    emit({ pluginMessage: 'something else' });
    emit(undefined);
    emit({ tag: 'wrong', kind: 'tool-result', id: 'x' });
    // nothing to assert beyond no throw
    expect(true).toBe(true);
  });

  it('dispose rejects pending and unsubscribes', async () => {
    const { bridge } = setup();
    const promise = bridge.handler('ping', undefined);
    bridge.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('binds progress and cancellation to the exact request, operation and action nonce', async () => {
    const progress: string[] = [];
    const sent: PluginBridgeMessage[] = [];
    let emit: ((raw: unknown) => void) | undefined;
    const bridge = createToolBridge({
      postMessage: message => sent.push(message),
      subscribe: listener => {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
      onProgress: (_binding, event) => progress.push(event.phase),
    });
    const binding = {
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      operationId: 'operation-1',
      actionNonce: 'action-nonce-1',
    } as const;
    const promise = bridge.handler('ping', {}, binding);
    const call = sent[0]!;
    expect(call).toMatchObject({ kind: 'tool-call', binding });

    emit?.(
      createToolProgress({
        id: call.id,
        binding,
        progress: {
          operationId: binding.operationId,
          phase: 'dispatched',
          completed: 0,
          total: 1,
          message: '',
          emittedAt: 1,
        },
      }),
    );
    expect(progress).toEqual(['dispatched']);
    expect(bridge.cancel({ ...binding, actionNonce: 'wrong' })).toBe(false);
    expect(bridge.cancel(binding)).toBe(true);
    expect(bridge.cancel(binding)).toBe(false);
    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
    });
    expect(sent.at(-1)).toMatchObject({ kind: 'tool-cancel', binding });

    emit?.(
      createToolProgress({
        id: call.id,
        binding,
        progress: {
          operationId: binding.operationId,
          phase: 'late',
          completed: 1,
          total: 1,
          message: '',
          emittedAt: 2,
        },
      }),
    );
    expect(progress).toEqual(['dispatched']);
    expect(bridge.pendingCount()).toBe(0);
    bridge.dispose();
  });
});
