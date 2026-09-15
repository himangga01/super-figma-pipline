import { SerializedReactionSchema } from '@sfp/shared';
import type { GetReactionsResult, SerializedReaction } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

// Clone the complete Plugin API value, including conditional/variable actions,
// overlay placement and easing. Stop explicitly instead of silently losing fields.
const serializeReactions = (
  source: readonly Reaction[],
): { reactions: SerializedReaction[]; truncated: boolean } => {
  let values = 0,
    characters = 0,
    truncated = false;
  const seen = new WeakSet<object>();
  const clone = (value: unknown, depth = 0): unknown => {
    if (++values > 50_000 || depth > 24) {
      truncated = true;
      return null;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 250_000) {
        truncated = true;
        return '';
      }
      return value;
    }
    if (typeof value !== 'object') {
      truncated = true;
      return null;
    }
    if (seen.has(value)) {
      truncated = true;
      return null;
    }
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (value.length > 4096) truncated = true;
      result = value.slice(0, 4096).map(item => clone(item, depth + 1));
    } else {
      const output: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value)) {
        if (values >= 50_000) {
          truncated = true;
          break;
        }
        output[key] = clone((value as Record<string, unknown>)[key], depth + 1);
      }
      result = output;
    }
    seen.delete(value);
    return result;
  };
  const reactions: SerializedReaction[] = [];
  for (const reaction of source.slice(0, 4096)) {
    const value = clone({
      trigger: reaction.trigger,
      actions: reaction.actions ?? (reaction.action === undefined ? [] : [reaction.action]),
    });
    const parsed = SerializedReactionSchema.safeParse(value);
    if (parsed.success) reactions.push(parsed.data);
    else truncated = true;
  }
  return { reactions, truncated: truncated || source.length > 4096 };
};

const hasReactions = (node: BaseNode): node is BaseNode & { reactions: readonly Reaction[] } =>
  'reactions' in node && Array.isArray((node as { reactions?: unknown }).reactions);

export const createGetReactionsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== 'string') {
      throw new TypeError('get_reactions: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(nodeId);
    const captured = serializeReactions(node !== null && hasReactions(node) ? node.reactions : []);
    const result: GetReactionsResult = {
      nodeId,
      reactions: captured.reactions,
      ...(captured.truncated ? { truncated: true, warnings: ['REACTION_VALUE_LIMIT'] } : {}),
    };
    return result;
  };
