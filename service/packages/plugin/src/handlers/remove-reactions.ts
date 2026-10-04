import type { MutateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Clear all prototype reactions from a node. */
export const createRemoveReactionsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as { nodeId?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('remove_reactions: nodeId must be a string');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    execution?.signal.throwIfAborted();
    if (
      node === null ||
      typeof (node as { setReactionsAsync?: unknown }).setReactionsAsync !== 'function'
    ) {
      throw new Error(`remove_reactions: node ${p.nodeId} not found or cannot have reactions`);
    }
    execution?.signal.throwIfAborted();
    const applying = (node as ReactionMixin).setReactionsAsync([]);
    execution?.markMutated?.();
    await applying;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
