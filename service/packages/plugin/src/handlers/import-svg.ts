import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

/**
 * Import an SVG as editable vector nodes via createNodeFromSvg (a FrameNode of VECTOR paths), the
 * write-side mirror of codegen's icon/logo export. The frame keeps the SVG's intrinsic size unless
 * width/height are given. Invalid markup throws from createNodeFromSvg → a clear tool error.
 */
export const createImportSvgHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      svg?: unknown;
      name?: unknown;
      parentId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof p.svg !== 'string' || p.svg.trim() === '') {
      throw new TypeError('import_svg: svg must be a non-empty SVG markup string');
    }

    const node = figmaCtx.createNodeFromSvg(p.svg);
    execution?.recordOwnedWrite?.(node, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      node.name = p.name;
      execution?.recordOwnedWrite?.(node, ['name']);
    }
    if (typeof p.width === 'number' || typeof p.height === 'number') {
      node.resize(
        typeof p.width === 'number' ? p.width : node.width,
        typeof p.height === 'number' ? p.height : node.height,
      );
      execution?.recordOwnedWrite?.(node, ['width', 'height']);
    }
    if (typeof p.x === 'number') {
      node.x = p.x;
      execution?.recordOwnedWrite?.(node, ['x']);
    }
    if (typeof p.y === 'number') {
      node.y = p.y;
      execution?.recordOwnedWrite?.(node, ['y']);
    }

    await placeNode(figmaCtx, node, p.parentId, 'import_svg', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = { ok: true, nodeId: node.id, name: node.name, type: node.type };
    return result;
  };
