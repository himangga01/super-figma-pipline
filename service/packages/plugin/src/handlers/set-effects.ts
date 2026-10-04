import type { MutateResult, SerializedEffect } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaEffectsBound } from './bindings.js';

export const createSetEffectsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as { nodeId?: unknown; effects?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_effects: nodeId must be a string');
    if (!Array.isArray(p.effects)) throw new TypeError('set_effects: effects must be an array');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);

    execution?.signal.throwIfAborted();
    if (node === null || !('effects' in node)) {
      throw new Error(`set_effects: node ${p.nodeId} not found or cannot have effects`);
    }
    const value = await toFigmaEffectsBound(
      figmaCtx,
      p.effects as SerializedEffect[],
      'set_effects',
    );
    execution?.signal.throwIfAborted();
    (node as BlendMixin).effects = value;
    execution?.recordOwnedWrite?.(node, ['effects']);
    execution?.markMutated?.();

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
