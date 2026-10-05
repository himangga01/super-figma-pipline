import type { CreateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { CREATED_NODE_PROPERTY } from './batch-created.js';
import { placeNode } from './place.js';

/**
 * Instantiate a component (local `componentId` or published `componentKey`) and place it like the
 * other create_* tools. Mirrors swap_component's component resolution; undo (in batch) = remove.
 */
export const createCreateInstanceHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      componentId?: unknown;
      componentKey?: unknown;
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
    };
    let componentKey: string | undefined;
    if (p.componentKey !== undefined) {
      if (typeof p.componentKey !== 'string' || p.componentKey.trim() === '') {
        throw new TypeError('create_instance: componentKey must be a nonempty string');
      }
      componentKey = p.componentKey.trim();
    }
    if (typeof p.componentId !== 'string' && componentKey === undefined) {
      throw new TypeError('create_instance: provide componentId or componentKey');
    }

    let component: ComponentNode;
    if (componentKey !== undefined) {
      const resolvedEffectValue1 = await figmaCtx.importComponentByKeyAsync(componentKey);
      component = resolvedEffectValue1;
      execution?.markMutated?.();
      execution?.signal.throwIfAborted();
    } else {
      const node = await figmaCtx.getNodeByIdAsync(p.componentId as string);
      execution?.signal.throwIfAborted();
      if (node === null || node.type !== 'COMPONENT') {
        throw new Error(`create_instance: component ${String(p.componentId)} not found`);
      }
      component = node as ComponentNode;
    }

    const instance = component.createInstance();
    execution?.recordOwnedWrite?.(instance, [CREATED_NODE_PROPERTY]);
    execution?.markMutated?.();
    if (typeof p.name === 'string') {
      instance.name = p.name;
      execution?.recordOwnedWrite?.(instance, ['name']);
    }
    if (typeof p.x === 'number') {
      instance.x = p.x;
      execution?.recordOwnedWrite?.(instance, ['x']);
    }
    if (typeof p.y === 'number') {
      instance.y = p.y;
      execution?.recordOwnedWrite?.(instance, ['y']);
    }

    await placeNode(figmaCtx, instance, p.parentId, 'create_instance', execution);
    execution?.signal.throwIfAborted();

    const result: CreateResult = {
      ok: true,
      nodeId: instance.id,
      name: instance.name,
      type: instance.type,
    };
    return result;
  };
