/**
 * Tool RPC across the iframe boundary: the relay hands a tool call to `handler`, this turns it into
 * a bridge message the sandbox can execute, and resolves once the matching reply comes back.
 */

import { getToolBudget, newId } from '@sfp/shared';

import {
  createToolCancel,
  createToolCall,
  isPluginBridgeMessage,
  type PluginExecutionBinding,
  type PluginBridgeMessage,
  type PluginToolProgress,
} from '../../protocol/bridge.js';
import { onSandboxMessage, postToSandbox } from './messaging.js';

export type PostMessageFn = (msg: PluginBridgeMessage) => void;
export type SubscribeFn = (cb: (raw: unknown) => void) => () => void;

export interface ToolBridgeOptions {
  timeoutMs?: number;
  log?: (msg: string) => void;
  postMessage?: PostMessageFn;
  subscribe?: SubscribeFn;
  onProgress?: (
    binding: Readonly<PluginExecutionBinding>,
    progress: PluginToolProgress['progress'],
  ) => void;
}

export interface ToolBridge {
  handler: ToolBridgeHandler;
  cancel: (binding: Readonly<PluginExecutionBinding>) => boolean;
  pendingCount: () => number;
  dispose: () => void;
}

export type ToolBridgeHandler = (
  method: string,
  params: unknown,
  binding?: Readonly<PluginExecutionBinding>,
) => Promise<unknown>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  binding?: Readonly<PluginExecutionBinding>;
}

const sameBinding = (
  left: Readonly<PluginExecutionBinding> | undefined,
  right: Readonly<PluginExecutionBinding>,
): boolean =>
  left !== undefined &&
  left.requestId === right.requestId &&
  left.operationId === right.operationId &&
  left.actionNonce === right.actionNonce;

const cancellationError = () =>
  Object.assign(new Error('sandbox operation cancelled'), {
    name: 'AbortError',
    code: 'OPERATION_CANCELLED',
  });

export const createToolBridge = (opts: ToolBridgeOptions = {}): ToolBridge => {
  const log = opts.log ?? ((): void => {});
  const post = opts.postMessage ?? postToSandbox;
  const subscribe = opts.subscribe ?? onSandboxMessage;

  const pending = new Map<string, Pending>();

  const postCancellation = (id: string, binding: Readonly<PluginExecutionBinding>): void => {
    try {
      post(createToolCancel({ id, binding }));
    } catch {
      log(`[tool-bridge] failed to post cancellation for id=${id}`);
    }
  };

  const unsubscribe = subscribe(raw => {
    if (!isPluginBridgeMessage(raw)) return;
    if (raw.kind === 'tool-call' || raw.kind === 'tool-cancel') return;
    const entry = pending.get(raw.id);
    if (entry === undefined) {
      log(`[tool-bridge] orphan ${raw.kind} for id=${raw.id}`);
      return;
    }
    if (raw.kind === 'tool-progress') {
      if (!sameBinding(entry.binding, raw.binding)) {
        log(`[tool-bridge] mismatched progress for id=${raw.id}`);
        return;
      }
      opts.onProgress?.(raw.binding, raw.progress);
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(raw.id);
    if (raw.kind === 'tool-result') {
      entry.resolve(raw.result);
    } else {
      entry.reject(Object.assign(new Error(`${raw.code}: ${raw.message}`), { code: raw.code }));
    }
  });

  const handler: ToolBridgeHandler = (method, params, binding) =>
    new Promise<unknown>((resolve, reject) => {
      const id = newId();
      // Per-tool budget (innermost layer B) so a heavy tool isn't capped at the default window while
      // the relay still waits. An explicit opts.timeoutMs overrides for tests. See getToolBudget.
      const timeoutMs = opts.timeoutMs ?? getToolBudget(method);
      const timer = setTimeout(() => {
        pending.delete(id);
        if (binding !== undefined) postCancellation(id, binding);
        reject(new Error(`sandbox tool timeout (method=${method})`));
      }, timeoutMs);
      pending.set(id, {
        resolve,
        reject,
        timer,
        method,
        ...(binding === undefined ? {} : { binding }),
      });
      try {
        post(createToolCall({ id, method, params, ...(binding === undefined ? {} : { binding }) }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error('sandbox transport unavailable'));
      }
    });

  const cancel = (binding: Readonly<PluginExecutionBinding>): boolean => {
    const match = [...pending.entries()].find(([, entry]) => sameBinding(entry.binding, binding));
    if (match === undefined) return false;
    const [id, entry] = match;
    clearTimeout(entry.timer);
    pending.delete(id);
    postCancellation(id, binding);
    entry.reject(cancellationError());
    return true;
  };

  const dispose = (): void => {
    unsubscribe();
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      if (entry.binding !== undefined) postCancellation(id, entry.binding);
      entry.reject(new Error('tool bridge disposed'));
    }
    pending.clear();
  };

  return {
    handler,
    cancel,
    pendingCount: () => pending.size,
    dispose,
  };
};
