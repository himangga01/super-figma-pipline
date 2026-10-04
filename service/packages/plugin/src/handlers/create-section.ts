import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

export const createCreateSectionHandler =
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

    const section = figmaCtx.createSection();
    execution?.recordOwnedWrite?.(section, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      section.name = p.name;
      execution?.recordOwnedWrite?.(section, ['name']);
    }
    // Sections size via resizeWithoutConstraints (they have no constraint behaviour).
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      section.resizeWithoutConstraints(p.width, p.height);
      execution?.recordOwnedWrite?.(section, ['width', 'height']);
    }
    if (typeof p.x === 'number') {
      section.x = p.x;
      execution?.recordOwnedWrite?.(section, ['x']);
    }
    if (typeof p.y === 'number') {
      section.y = p.y;
      execution?.recordOwnedWrite?.(section, ['y']);
    }

    await placeNode(figmaCtx, section, p.parentId, 'create_section', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = {
      ok: true,
      nodeId: section.id,
      name: section.name,
      type: section.type,
    };
    return result;
  };
