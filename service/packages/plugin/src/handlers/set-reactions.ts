import type { MutateResult, SerializedReaction } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaReaction } from './convert.js';
import { boundReactionWrite } from './reaction-write.js';

/** Replace a node's prototype reactions. Uses setReactionsAsync (required under dynamic-page). */
export const createSetReactionsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as { nodeId?: unknown; reactions?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_reactions: nodeId must be a string');
    if (!Array.isArray(p.reactions))
      throw new TypeError('set_reactions: reactions must be an array');
    if (p.reactions.length > 4096) throw new TypeError('REACTION_WRITE_VALUE_LIMIT');
    boundReactionWrite(p.reactions);
    const reactions = (p.reactions as SerializedReaction[]).map(toFigmaReaction);

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    execution?.signal.throwIfAborted();
    if (
      node === null ||
      typeof (node as { setReactionsAsync?: unknown }).setReactionsAsync !== 'function'
    ) {
      throw new Error(`set_reactions: node ${p.nodeId} not found or cannot have reactions`);
    }
    execution?.signal.throwIfAborted();
    const applying = (node as ReactionMixin).setReactionsAsync(reactions);
    execution?.markMutated?.();
    await applying;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
