import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

export const createCreateTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      characters?: unknown;
      x?: unknown;
      y?: unknown;
      fontSize?: unknown;
    };
    if (typeof p.characters !== 'string') {
      throw new TypeError('create_text: characters must be a string');
    }

    const text = figmaCtx.createText();
    execution?.recordOwnedWrite?.(text, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    await figmaCtx.loadFontAsync(text.fontName as FontName);
    execution?.signal.throwIfAborted(); // default font must be loaded first
    execution?.signal.throwIfAborted();
    text.characters = p.characters;
    execution?.recordOwnedWrite?.(text, ['characters']);
    if (typeof p.fontSize === 'number') {
      text.fontSize = p.fontSize;
      execution?.recordOwnedWrite?.(text, ['fontSize']);
    }
    if (typeof p.x === 'number') {
      text.x = p.x;
      execution?.recordOwnedWrite?.(text, ['x']);
    }
    if (typeof p.y === 'number') {
      text.y = p.y;
      execution?.recordOwnedWrite?.(text, ['y']);
    }

    await placeNode(figmaCtx, text, p.parentId, 'create_text', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = { ok: true, nodeId: text.id, name: text.name, type: text.type };
    return result;
  };
