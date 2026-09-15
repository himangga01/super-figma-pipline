import { ErrorCode, type ProgressEvent } from '@sfp/shared';

import {
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  type PluginToolError,
  type PluginToolResult,
} from '../protocol/bridge.js';
import { withEditorContext } from '../protocol/editor-context.js';
import { settleHandlerFailure, settleHandlerOutcome } from './mutation.js';

export type SandboxProgress = Omit<ProgressEvent, 'operationId' | 'emittedAt'>;
export interface SandboxExecutionContext {
  readonly requestId?: string;
  readonly signal: Pick<AbortSignal, 'aborted' | 'reason' | 'throwIfAborted'>;
  report(progress: Readonly<SandboxProgress>): void;
  markMutated?(): void;
}
export type SandboxToolHandler = (
  params: unknown,
  context?: Readonly<SandboxExecutionContext>,
) => unknown | Promise<unknown>;
export type SandboxHandlers = Record<string, SandboxToolHandler>;

export interface DispatchInput {
  raw: unknown;
  handlers: SandboxHandlers;
  /**
   * `figma.editorType`, so a handler error can name the editor it was raised in. Required rather
   * than optional on purpose: an optional field is exactly the kind of claim that gets silently
   * dropped at one call site and never noticed (see `editor-context.ts`).
   */
  editorType: string;
  log?: (msg: string) => void;
  execution?: Readonly<SandboxExecutionContext>;
}

export type DispatchOutcome =
  | { kind: 'reply'; reply: PluginToolResult | PluginToolError }
  | { kind: 'ignore' };

export const dispatchSandboxMessage = async (input: DispatchInput): Promise<DispatchOutcome> => {
  const cancelled = (): boolean => input.execution?.signal.aborted === true;
  if (!isPluginBridgeMessage(input.raw)) return { kind: 'ignore' };
  if (input.raw.kind !== 'tool-call') return { kind: 'ignore' };
  if (cancelled()) return { kind: 'ignore' };

  const { id, method, params } = input.raw;
  const handler = input.handlers[method];
  const log = input.log ?? ((): void => {});

  if (handler === undefined) {
    log(`[sandbox] no handler for ${method}`);
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code: ErrorCode.MethodNotFound,
        message: `no sandbox handler (method=${method})`,
      }),
    };
  }

  try {
    input.execution?.report({
      phase: 'received',
      completed: 0,
      total: 1,
      message: 'request received',
    });
    if (cancelled()) return { kind: 'ignore' };
    input.execution?.report({
      phase: 'dispatched',
      completed: 0,
      total: 1,
      message: 'request dispatched',
    });
    const result = settleHandlerOutcome(await handler(params, input.execution));
    if (cancelled()) return { kind: 'ignore' };
    input.execution?.report({
      phase: 'completed',
      completed: 1,
      total: 1,
      message: 'request completed',
    });
    return { kind: 'reply', reply: createToolResult({ id, result }) };
  } catch (err) {
    const mutation = settleHandlerFailure(err);
    if (cancelled()) return { kind: 'ignore' };
    const raised = err instanceof Error ? err.message : String(err);
    log(`[sandbox] handler ${method} threw: ${raised}`);
    // FigJam and Dev Mode reject whole classes of call that Figma Design accepts, and the API's own
    // error rarely says which editor it came from. Naming it here is what lets an agent re-plan
    // instead of retrying the same call.
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code:
          mutation === true || mutation === 'unknown'
            ? 'PLUGIN_PARTIAL_CHANGE'
            : ErrorCode.Internal,
        message: withEditorContext(raised, input.editorType),
      }),
    };
  }
};
