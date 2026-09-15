import { ErrorCode } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createToolCall, isPluginBridgeMessage } from '../protocol/bridge.js';
import {
  dispatchSandboxMessage,
  type SandboxExecutionContext,
  type SandboxHandlers,
} from '../src/dispatcher.js';

const executionContext = (signal: AbortSignal, phases: string[]): SandboxExecutionContext => ({
  signal,
  report: progress => phases.push(progress.phase),
});

describe('dispatchSandboxMessage', () => {
  it('replies with tool-result when handler resolves', async () => {
    const handlers: SandboxHandlers = {
      ping: () => ({ pong: true }),
    };
    const raw = createToolCall({ id: 'a', method: 'ping' });
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-result', id: 'a', result: { pong: true } },
    });
  });

  it('awaits async handlers', async () => {
    const handlers: SandboxHandlers = {
      slow: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'done';
      },
    };
    const raw = createToolCall({ id: 'b', method: 'slow' });
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-result', result: 'done' },
    });
  });

  it('replies METHOD_NOT_FOUND when method is unknown', async () => {
    const log = vi.fn<(msg: string) => void>();
    const raw = createToolCall({ id: 'c', method: 'unknown' });
    const outcome = await dispatchSandboxMessage({ raw, handlers: {}, editorType: 'figma', log });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-error', code: ErrorCode.MethodNotFound },
    });
    expect(log).toHaveBeenCalled();
  });

  it('replies INTERNAL_ERROR when handler throws', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('handler exploded');
      },
    };
    const raw = createToolCall({ id: 'd', method: 'boom' });
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'tool-error',
        code: ErrorCode.Internal,
        message: expect.stringContaining('handler exploded'),
      },
    });
  });

  // FigJam and Dev Mode reject whole classes of call the tool surface offers, and the plugin API's
  // own error rarely says which editor raised it. Naming it is what lets an agent re-plan instead
  // of retrying the same call — see protocol/editor-context.ts.
  it('names the editor when a handler throws in a restricted one', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('in read-only mode');
      },
    };
    const raw = createToolCall({ id: 'e', method: 'boom' });

    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'dev' });

    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'tool-error',
        message: expect.stringContaining('in read-only mode'),
      },
    });
    expect((outcome as { reply: { message: string } }).reply.message).toContain('editor: dev');
  });

  // Figma Design is the common case, and it must stay free of the caveat entirely.
  it('adds nothing to an error raised in Figma Design', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('handler exploded');
      },
    };
    const raw = createToolCall({ id: 'f', method: 'boom' });

    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });

    expect((outcome as { reply: { message: string } }).reply.message).toBe('handler exploded');
  });

  it('ignores non-bridge raw messages', async () => {
    const outcome = await dispatchSandboxMessage({
      raw: { foo: 'bar' },
      handlers: { ping: () => ({}) },
      editorType: 'figma',
    });
    expect(outcome.kind).toBe('ignore');
  });

  it('ignores result/error messages (only acts on tool-call)', async () => {
    const result = { tag: '@figwright/bridge', kind: 'tool-result', id: 'x', result: {} };
    expect(isPluginBridgeMessage(result)).toBe(true);
    const outcome = await dispatchSandboxMessage({
      raw: result,
      handlers: { ping: () => ({}) },
      editorType: 'figma',
    });
    expect(outcome.kind).toBe('ignore');
  });

  it('passes the exact optional execution context and emits bounded synthetic progress', async () => {
    const controller = new AbortController();
    const phases: string[] = [];
    let observed: SandboxExecutionContext | undefined;
    const context = executionContext(controller.signal, phases);
    const outcome = await dispatchSandboxMessage({
      raw: createToolCall({ id: 'ctx', method: 'ping' }),
      handlers: {
        ping: (_params, received) => {
          observed = received;
          return { pong: true };
        },
      },
      editorType: 'figma',
      execution: context,
    });

    expect(observed).toBe(context);
    expect(phases).toEqual(['received', 'dispatched', 'completed']);
    expect(outcome.kind).toBe('reply');
  });

  it('suppresses invocation or a late reply when cancellation wins', async () => {
    const before = new AbortController();
    before.abort();
    const beforeHandler = vi.fn<() => void>();
    await expect(
      dispatchSandboxMessage({
        raw: createToolCall({ id: 'before', method: 'ping' }),
        handlers: { ping: beforeHandler },
        editorType: 'figma',
        execution: executionContext(before.signal, []),
      }),
    ).resolves.toEqual({ kind: 'ignore' });
    expect(beforeHandler).not.toHaveBeenCalled();

    const after = new AbortController();
    const outcome = await dispatchSandboxMessage({
      raw: createToolCall({ id: 'after', method: 'ping' }),
      handlers: {
        ping: () => {
          after.abort();
          return { tooLate: true };
        },
      },
      editorType: 'figma',
      execution: executionContext(after.signal, []),
    });
    expect(outcome).toEqual({ kind: 'ignore' });
  });
});
