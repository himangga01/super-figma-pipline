import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

const SCALE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const;
type ScaleMode = (typeof SCALE_MODES)[number];

/**
 * Import validated base64 data and place it as a rectangle with an IMAGE fill. The daemon owns URL
 * fetching and its allowlist; a plugin request can never initiate an external fetch. The rectangle
 * defaults to the image's intrinsic size unless width/height are given.
 */
export const createImportImageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      data?: unknown;
      url?: unknown;
      name?: unknown;
      parentId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      scaleMode?: unknown;
    };
    if (typeof p.data !== 'string' || p.data.trim() === '' || p.url !== undefined) {
      throw new TypeError(
        'import_image: provide validated data; URL sources must be fetched by the daemon',
      );
    }
    const data = p.data.trim();
    const scaleMode: ScaleMode = SCALE_MODES.includes(p.scaleMode as ScaleMode)
      ? (p.scaleMode as ScaleMode)
      : 'FILL';

    const image = figmaCtx.createImage(figmaCtx.base64Decode(data));
    const size = await image.getSizeAsync();

    const rect = figmaCtx.createRectangle();
    execution?.markMutated?.();
    if (typeof p.name === 'string') rect.name = p.name;
    rect.resize(
      typeof p.width === 'number' ? p.width : size.width,
      typeof p.height === 'number' ? p.height : size.height,
    );
    if (typeof p.x === 'number') rect.x = p.x;
    if (typeof p.y === 'number') rect.y = p.y;
    rect.fills = [{ type: 'IMAGE', scaleMode, imageHash: image.hash }];

    await placeNode(figmaCtx, rect, p.parentId, 'import_image');

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
