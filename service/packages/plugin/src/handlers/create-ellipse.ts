import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

export const createCreateEllipseHandler =
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

    const ellipse = figmaCtx.createEllipse();
    execution?.recordOwnedWrite?.(ellipse, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      ellipse.name = p.name;
      execution?.recordOwnedWrite?.(ellipse, ['name']);
    }
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      ellipse.resize(p.width, p.height);
      execution?.recordOwnedWrite?.(ellipse, ['width', 'height']);
    }
    if (typeof p.x === 'number') {
      ellipse.x = p.x;
      execution?.recordOwnedWrite?.(ellipse, ['x']);
    }
    if (typeof p.y === 'number') {
      ellipse.y = p.y;
      execution?.recordOwnedWrite?.(ellipse, ['y']);
    }

    await placeNode(figmaCtx, ellipse, p.parentId, 'create_ellipse', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = {
      ok: true,
      nodeId: ellipse.id,
      name: ellipse.name,
      type: ellipse.type,
    };
    return result;
  };
