import type { SerializedEffect, StyleResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaEffectsBound } from './bindings.js';

export const createUpdateEffectStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      effects?: unknown;
      description?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_effect_style: styleId must be a string');
    }

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    execution?.signal.throwIfAborted();
    if (style === null || style.type !== 'EFFECT') {
      throw new Error(`update_effect_style: effect style ${p.styleId} not found`);
    }
    const es = style as EffectStyle;
    if (typeof p.name === 'string') es.name = p.name;
    if (Array.isArray(p.effects)) {
      const resolvedEffectValue1 = await toFigmaEffectsBound(
        figmaCtx,
        p.effects as SerializedEffect[],
        'update_effect_style',
      );
      execution?.signal.throwIfAborted();
      es.effects = resolvedEffectValue1;
      execution?.markMutated?.();
    }
    if (typeof p.description === 'string') es.description = p.description;

    const result: StyleResult = { ok: true, styleId: es.id, name: es.name };
    return result;
  };
