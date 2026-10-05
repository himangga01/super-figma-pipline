import type { MutateResult, SerializedPaint } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';

const PER_SIDE = [
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
] as const;

export const createSetStrokesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      strokes?: unknown;
      strokeWeight?: unknown;
      strokeAlign?: unknown;
      dashPattern?: unknown;
      strokeTopWeight?: unknown;
      strokeRightWeight?: unknown;
      strokeBottomWeight?: unknown;
      strokeLeftWeight?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_strokes: nodeId must be a string');
    if (!Array.isArray(p.strokes)) throw new TypeError('set_strokes: strokes must be an array');
    if (
      p.strokeWeight !== undefined &&
      (typeof p.strokeWeight !== 'number' || p.strokeWeight < 0)
    ) {
      throw new TypeError('set_strokes: strokeWeight must be a non-negative number');
    }
    if (p.dashPattern !== undefined && !Array.isArray(p.dashPattern)) {
      throw new TypeError('set_strokes: dashPattern must be an array of numbers');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    execution?.signal.throwIfAborted();
    if (node === null || !('strokes' in node)) {
      throw new Error(`set_strokes: node ${p.nodeId} not found or cannot have strokes`);
    }
    const value = await toFigmaPaintsBound(figmaCtx, p.strokes as SerializedPaint[], 'set_strokes');
    execution?.signal.throwIfAborted();
    (node as GeometryMixin).strokes = value;
    execution?.recordOwnedWrite?.(node, ['strokes']);
    execution?.markMutated?.();
    if (typeof p.strokeWeight === 'number') {
      (node as { strokeWeight: number }).strokeWeight = p.strokeWeight;
      execution?.recordOwnedWrite?.(node, ['strokeWeight', ...PER_SIDE]);
    }
    if (typeof p.strokeAlign === 'string') {
      (node as { strokeAlign: string }).strokeAlign = p.strokeAlign;
      execution?.recordOwnedWrite?.(node, ['strokeAlign']);
    }
    if (Array.isArray(p.dashPattern)) {
      (node as { dashPattern: readonly number[] }).dashPattern = p.dashPattern as number[];
      execution?.recordOwnedWrite?.(node, ['dashPattern']);
    }
    // Per-side weights live on IndividualStrokesMixin (frames/rects/components). Set them after the
    // uniform strokeWeight so a per-side value overrides it; skip silently on nodes that lack them.
    for (const side of PER_SIDE) {
      const v = p[side];
      if (typeof v === 'number') {
        if (!(side in node)) {
          throw new Error(`set_strokes: node ${p.nodeId} does not support per-side stroke weights`);
        }
        (node as unknown as Record<string, number>)[side] = v;
        execution?.recordOwnedWrite?.(node, [side, 'strokeWeight']);
      }
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
