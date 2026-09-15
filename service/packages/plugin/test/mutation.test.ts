import { describe, expect, it, vi } from 'vitest';

import { createToolCall } from '../protocol/bridge.js';
import { createSandboxCancellation } from '../src/cancellation.js';
import { dispatchSandboxMessage, type SandboxHandlers } from '../src/dispatcher.js';
import { createCreatePaintStyleHandler } from '../src/handlers/create-paint-style.js';
import { createSandboxHandlers } from '../src/handlers/registry.js';
import { createIdempotencyCache, idempotent } from '../src/idempotency.js';
import { settleHandlerOutcome, withMutationOutcome } from '../src/mutation.js';

const fixture = () => {
  const node = { id: '1:1', type: 'RECTANGLE', name: 'Before', opacity: 1 };
  const page = { id: '0:1', type: 'PAGE', name: 'Page', children: [node] };
  const commitUndo = vi.fn<() => void>();
  const host = {
    currentPage: page,
    commitUndo,
    getNodeByIdAsync: async (id: string) => (id === page.id ? page : id === node.id ? node : null),
  } as unknown as typeof figma;
  return { host, node, commitUndo };
};
const invoke = (
  handlers: SandboxHandlers,
  method: string,
  params: unknown,
  requestId = 'request',
) =>
  dispatchSandboxMessage({
    raw: createToolCall({ id: requestId, method, params }),
    handlers,
    editorType: 'figma',
    execution: { requestId, signal: createSandboxCancellation().signal, report: () => {} },
  });

describe('top-level mutation and Undo contract', () => {
  it('commits once for a changed write and never again for its cached replay or a no-op', async () => {
    const { host, node, commitUndo } = fixture();
    const handlers = createSandboxHandlers(host);
    const args = { nodeId: node.id, opacity: 0.25 };
    await expect(invoke(handlers, 'set_opacity', args)).resolves.toMatchObject({
      reply: { kind: 'tool-result', result: { ok: true, nodeId: node.id } },
    });
    expect(commitUndo).toHaveBeenCalledTimes(1);
    await invoke(handlers, 'set_opacity', args);
    await invoke(handlers, 'set_opacity', args, 'another-request');
    expect(commitUndo).toHaveBeenCalledTimes(1);
    expect(node.opacity).toBe(0.25);
  });

  it('commits one boundary for a whole batch and none when a failed batch restores its state', async () => {
    const { host, node, commitUndo } = fixture();
    const handlers = createSandboxHandlers(host);
    await invoke(handlers, 'batch', {
      ops: [
        { tool: 'rename_node', params: { nodeId: node.id, name: 'After' } },
        { tool: 'set_opacity', params: { nodeId: node.id, opacity: 0.25 } },
      ],
    });
    expect(commitUndo).toHaveBeenCalledTimes(1);
    await invoke(
      handlers,
      'batch',
      {
        ops: [
          { tool: 'rename_node', params: { nodeId: node.id, name: 'Temporary' } },
          { tool: 'set_opacity', params: { nodeId: node.id, opacity: 'invalid' } },
        ],
      },
      'failed-batch',
    );
    expect(node.name).toBe('After');
    expect(commitUndo).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a partial effect after a failed request is replayed', async () => {
    const { host, node, commitUndo } = fixture();
    const apply = vi.fn<() => Promise<never>>(async () => {
      node.opacity -= 0.1;
      throw new Error('host write failed');
    });
    const handlers = {
      set_opacity: idempotent(
        createIdempotencyCache(),
        withMutationOutcome(host, 'set_opacity', apply),
      ),
    };
    const first = await invoke(handlers, 'set_opacity', { nodeId: node.id });
    expect(first).toMatchObject({ reply: { kind: 'tool-error', code: 'PLUGIN_PARTIAL_CHANGE' } });
    await invoke(handlers, 'set_opacity', { nodeId: node.id });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(commitUndo).toHaveBeenCalledTimes(1);
    expect(node.opacity).toBe(0.9);
  });

  it('tracks a created style even if a later setter fails before a result is returned', async () => {
    const { host, commitUndo } = fixture();
    const created: unknown[] = [];
    host.createPaintStyle = (() => {
      const style = {
        id: 'style-1',
        get name() {
          return 'Default';
        },
        set name(_value: string) {
          throw new Error('name setter failed');
        },
      };
      created.push(style);
      return style;
    }) as typeof host.createPaintStyle;
    const handlers = {
      create_paint_style: withMutationOutcome(
        host,
        'create_paint_style',
        createCreatePaintStyleHandler(host),
      ),
    };
    const result = await invoke(handlers, 'create_paint_style', { name: 'Brand', paints: [] });
    expect(created).toHaveLength(1);
    expect(result).toMatchObject({ reply: { code: 'PLUGIN_PARTIAL_CHANGE' } });
    expect(commitUndo).toHaveBeenCalledTimes(1);
  });

  it('performs no write or Undo if the pre-execution observation fails', async () => {
    const { host, commitUndo } = fixture();
    host.getNodeByIdAsync = async () => {
      throw new Error('document read failed');
    };
    const apply = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    await invoke({ set_opacity: withMutationOutcome(host, 'set_opacity', apply) }, 'set_opacity', {
      nodeId: '1:1',
    });
    expect(apply).not.toHaveBeenCalled();
    expect(commitUndo).not.toHaveBeenCalled();
  });

  it('does not treat an arbitrary read payload as an executable mutation outcome', () => {
    const payload = { value: { ok: true }, mutated: true };
    expect(settleHandlerOutcome(payload)).toBe(payload);
  });
});
