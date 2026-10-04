import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

export const createCreateRectangleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    const rect = figmaCtx.createRectangle();
    execution?.recordOwnedWrite?.(rect, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      rect.name = p.name;
      execution?.recordOwnedWrite?.(rect, ['name']);
    }
    if (typeof p.width === 'number' && typeof p.height === 'number') rect.resize(p.width, p.height);
    execution?.recordOwnedWrite?.(rect, ['width', 'height']);
    if (typeof p.x === 'number') {
      rect.x = p.x;
      execution?.recordOwnedWrite?.(rect, ['x']);
    }
    if (typeof p.y === 'number') {
      rect.y = p.y;
      execution?.recordOwnedWrite?.(rect, ['y']);
    }

    await placeNode(figmaCtx, rect, p.parentId, 'create_rectangle', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
