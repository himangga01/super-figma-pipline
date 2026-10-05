import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

export const createCreateFrameHandler =
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

    const frame = figmaCtx.createFrame();
    execution?.recordOwnedWrite?.(frame, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      frame.name = p.name;
      execution?.recordOwnedWrite?.(frame, ['name']);
    }
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      frame.resize(p.width, p.height);
      execution?.recordOwnedWrite?.(frame, ['width', 'height']);
    }
    if (typeof p.x === 'number') {
      frame.x = p.x;
      execution?.recordOwnedWrite?.(frame, ['x']);
    }
    if (typeof p.y === 'number') {
      frame.y = p.y;
      execution?.recordOwnedWrite?.(frame, ['y']);
    }

    await placeNode(figmaCtx, frame, p.parentId, 'create_frame', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = { ok: true, nodeId: frame.id, name: frame.name, type: frame.type };
    return result;
  };
