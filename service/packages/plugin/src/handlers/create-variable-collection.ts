import type { CollectionResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createCreateVariableCollectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as { name?: unknown; defaultModeName?: unknown };
    if (typeof p.name !== 'string') {
      throw new TypeError('create_variable_collection: name must be a string');
    }
    if (
      p.defaultModeName !== undefined &&
      (typeof p.defaultModeName !== 'string' ||
        p.defaultModeName.length < 1 ||
        p.defaultModeName.length > 256)
    ) {
      throw new TypeError(
        'create_variable_collection: defaultModeName must contain 1..256 characters',
      );
    }

    const collection = figmaCtx.variables.createVariableCollection(p.name);
    execution?.markMutated?.();
    const createdId = collection.id;
    if (p.defaultModeName !== undefined) {
      try {
        collection.renameMode(collection.defaultModeId, p.defaultModeName as string);
        if (
          collection.modes.find(mode => mode.modeId === collection.defaultModeId)?.name !==
          p.defaultModeName
        ) {
          throw new Error('default mode name readback mismatch');
        }
      } catch (cause) {
        try {
          collection.remove();
          if ((await figmaCtx.variables.getVariableCollectionByIdAsync(createdId)) !== null)
            throw new Error('object still exists', { cause });
        } catch {
          throw new Error(
            'create_variable_collection: initialization failed; cleanup unverified, partial effect requires reconciliation',
            { cause },
          );
        }
        throw new Error(
          'create_variable_collection: initialization failed; created collection removal verified',
          { cause },
        );
      }
    }

    const result: CollectionResult = {
      ok: true,
      collectionId: collection.id,
      defaultModeId: collection.defaultModeId,
      name: collection.name,
    };
    return result;
  };
