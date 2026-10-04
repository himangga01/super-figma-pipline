import type { MutateResult } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createGetReactionsHandler } from '../../src/handlers/get-reactions.js';
import { createSetReactionsHandler } from '../../src/handlers/set-reactions.js';

const withNode = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('set_reactions handler', () => {
  it('bounds the complete replacement instead of each reaction independently', async () => {
    let writes = 0;
    const node = {
      id: '1:1',
      async setReactionsAsync() {
        writes++;
      },
    };
    const reactions = Array.from({ length: 2 }, () => ({
      trigger: { type: 'ON_CLICK' },
      actions: [{ type: 'URL', url: 'x'.repeat(150_000) }],
    }));
    await expect(
      createSetReactionsHandler(withNode(node))({ nodeId: node.id, reactions }),
    ).rejects.toThrow('REACTION_WRITE_VALUE_LIMIT');
    expect(writes).toBe(0);
  });
  it('round-trips keyboard, overlay placement, easing and conditional actions without losing fields', async () => {
    const original = [
      {
        trigger: { type: 'ON_KEY_DOWN', device: 'KEYBOARD', keyCodes: [16, 65] },
        actions: [
          {
            type: 'NODE',
            destinationId: '2:2',
            navigation: 'OVERLAY',
            overlayRelativePosition: { x: 20, y: 30 },
            preserveScrollPosition: false,
            resetScrollPosition: true,
            resetVideoPosition: false,
            resetInteractiveComponents: true,
            transition: {
              type: 'DISSOLVE',
              duration: 0.3,
              easing: {
                type: 'CUSTOM_CUBIC_BEZIER',
                easingFunctionCubicBezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
              },
            },
          },
        ],
      },
      {
        trigger: { type: 'ON_CLICK' },
        actions: [
          {
            type: 'CONDITIONAL',
            conditionalBlocks: [
              {
                condition: {
                  type: 'EXPRESSION',
                  resolvedType: 'BOOLEAN',
                  value: {
                    expressionFunction: 'EQUALS',
                    expressionArguments: [
                      {
                        type: 'VARIABLE_ALIAS',
                        value: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' },
                      },
                      { type: 'BOOLEAN', value: true },
                    ],
                  },
                },
                actions: [
                  {
                    type: 'SET_VARIABLE',
                    variableId: 'VariableID:1:2',
                    variableValue: { type: 'BOOLEAN', value: false },
                  },
                ],
              },
              { actions: [{ type: 'BACK' }] },
            ],
          },
        ],
      },
      {
        trigger: { type: 'MOUSE_ENTER', delay: 0, deprecatedVersion: false },
        actions: [{ type: 'URL', url: 'https://example.com', openInNewTab: false }],
      },
    ];
    const node = {
      id: '1:1',
      reactions: structuredClone(original),
      async setReactionsAsync(reactions: typeof original) {
        this.reactions = reactions;
      },
    };
    const host = withNode(node);
    const read = createGetReactionsHandler(host);
    const captured = (await read({ nodeId: node.id })) as { reactions: typeof original };
    await createSetReactionsHandler(host)({ nodeId: node.id, reactions: captured.reactions });
    expect(node.reactions).toEqual(original);
    expect(((await read({ nodeId: node.id })) as { reactions: unknown }).reactions).toEqual(
      original,
    );
  });

  it.each([
    { trigger: { type: 'ON_KEY_DOWN', device: 'KEYBOARD', keyCodes: ['A'] }, actions: [] },
    { trigger: { type: 'ON_CLICK', inventedFlag: true }, actions: [] },
    { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'UNKNOWN_ACTION' }] },
    {
      trigger: { type: 'ON_CLICK' },
      actions: [{ type: 'NODE', destinationId: '2:2', navigation: 'FUTURE', transition: null }],
    },
    {
      trigger: { type: 'ON_CLICK' },
      actions: [
        {
          type: 'NODE',
          destinationId: '2:2',
          navigation: 'OVERLAY',
          overlayRelativePosition: { x: 1, y: 2, extra: true },
        },
      ],
    },
    {
      trigger: { type: 'ON_CLICK' },
      actions: [
        {
          type: 'CONDITIONAL',
          conditionalBlocks: [
            { condition: { type: 'BOOLEAN', value: true, extra: 1 }, actions: [{ type: 'CLOSE' }] },
          ],
        },
      ],
    },
    {
      trigger: { type: 'ON_CLICK' },
      actions: [
        {
          type: 'NODE',
          destinationId: '2:2',
          navigation: 'NAVIGATE',
          transition: { type: 'DISSOLVE', duration: 0.2, easing: { type: 'LINEAR' }, hidden: true },
        },
      ],
    },
  ])('rejects unsupported closed reaction shape before any write: %j', async reaction => {
    let writes = 0;
    const node = {
      id: '1:1',
      async setReactionsAsync() {
        writes++;
      },
    };
    await expect(
      createSetReactionsHandler(withNode(node))({ nodeId: node.id, reactions: [reaction] }),
    ).rejects.toThrow(/Invalid|Unrecognized/);
    expect(writes).toBe(0);
  });

  it('checks cancellation after awaited node lookup before replacing reactions', async () => {
    const controller = new AbortController();
    let writes = 0;
    const node = {
      id: '1:1',
      async setReactionsAsync() {
        writes++;
      },
    };
    const host = {
      getNodeByIdAsync: async () => {
        controller.abort(new Error('cancelled'));
        return node;
      },
    } as unknown as typeof figma;
    await expect(
      createSetReactionsHandler(host)(
        { nodeId: node.id, reactions: [] },
        { signal: controller.signal, report: () => {} },
      ),
    ).rejects.toThrow('cancelled');
    expect(writes).toBe(0);
  });
  it('converts and applies reactions via setReactionsAsync', async () => {
    const setReactionsAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', setReactionsAsync };
    const f = { getNodeByIdAsync: async () => node } as unknown as typeof figma;

    const result = (await createSetReactionsHandler(f)({
      nodeId: '1:1',
      reactions: [
        {
          trigger: { type: 'ON_CLICK' },
          actions: [{ type: 'NODE', destinationId: '2:2', navigation: 'NAVIGATE' }],
        },
      ],
    })) as MutateResult;

    expect(setReactionsAsync).toHaveBeenCalledWith([
      {
        trigger: { type: 'ON_CLICK' },
        actions: [{ type: 'NODE', destinationId: '2:2', navigation: 'NAVIGATE' }],
      },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on bad input or unsupported node', async () => {
    await expect(createSetReactionsHandler(withNode({}))({ reactions: [] })).rejects.toThrow(
      /nodeId/,
    );
    await expect(
      createSetReactionsHandler(withNode({}))({ nodeId: '1:1', reactions: 'x' }),
    ).rejects.toThrow(/reactions/);
    await expect(
      createSetReactionsHandler(withNode({ id: '1:1' }))({ nodeId: '1:1', reactions: [] }),
    ).rejects.toThrow(/cannot have reactions/);
  });
});
