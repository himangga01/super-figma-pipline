import type { CollectionResult } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateVariableCollectionHandler } from '../../src/handlers/create-variable-collection.js';

const fakeFigma = (): typeof figma =>
  ({
    variables: {
      createVariableCollection: (name: string) => ({
        id: 'VC:0',
        name,
        defaultModeId: 'M:0',
      }),
    },
  }) as unknown as typeof figma;

describe('create_variable_collection handler', () => {
  function fixture(options: { ignoreRename?: boolean; failRemove?: boolean } = {}) {
    let exists = false;
    const collection = {
      id: 'VC:new',
      name: 'Theme',
      defaultModeId: 'actual:mode',
      modes: [{ modeId: 'actual:mode', name: 'Mode 1' }],
      renameMode: vi.fn<(id: string, name: string) => void>((id, name) => {
        if (id !== 'actual:mode') throw new Error('guessed mode');
        if (!options.ignoreRename) collection.modes[0]!.name = name;
      }),
      remove: vi.fn<() => void>(() => {
        if (options.failRemove) throw new Error('cannot remove');
        exists = false;
      }),
    };
    const createVariableCollection = vi.fn<() => typeof collection>(() => {
      exists = true;
      return collection;
    });
    const f = {
      variables: {
        createVariableCollection,
        getVariableCollectionByIdAsync: vi.fn<() => Promise<typeof collection | null>>(async () =>
          exists ? collection : null,
        ),
      },
    } as unknown as typeof figma;
    return { f, collection, createVariableCollection };
  }
  it('names the actual generated default mode before successful return', async () => {
    const data = fixture();
    await expect(
      createCreateVariableCollectionHandler(data.f)({ name: 'Theme', defaultModeName: 'Light' }),
    ).resolves.toEqual({
      ok: true,
      collectionId: 'VC:new',
      defaultModeId: 'actual:mode',
      name: 'Theme',
    });
    expect(data.collection.renameMode).toHaveBeenCalledWith('actual:mode', 'Light');
  });
  it('rejects invalid mode names before creating an object', async () => {
    const data = fixture();
    await expect(
      createCreateVariableCollectionHandler(data.f)({ name: 'Theme', defaultModeName: '' }),
    ).rejects.toThrow(/defaultModeName/);
    expect(data.createVariableCollection).not.toHaveBeenCalled();
  });
  it('checks actual mode readback and verifies exact new collection removal', async () => {
    const data = fixture({ ignoreRename: true });
    await expect(
      createCreateVariableCollectionHandler(data.f)({ name: 'Theme', defaultModeName: 'Light' }),
    ).rejects.toThrow(/removal verified/);
    expect(data.collection.remove).toHaveBeenCalledOnce();
  });
  it('preserves a partial outcome when cleanup fails', async () => {
    const data = fixture({ ignoreRename: true, failRemove: true });
    await expect(
      createCreateVariableCollectionHandler(data.f)({ name: 'Theme', defaultModeName: 'Light' }),
    ).rejects.toThrow(/partial effect requires reconciliation/);
  });
  it('creates a collection and returns its id + default mode', async () => {
    const handler = createCreateVariableCollectionHandler(fakeFigma());
    const result = (await handler({ name: 'Theme' })) as CollectionResult;
    expect(result).toEqual({ ok: true, collectionId: 'VC:0', defaultModeId: 'M:0', name: 'Theme' });
  });

  it('throws when name is missing', async () => {
    await expect(createCreateVariableCollectionHandler(fakeFigma())({})).rejects.toThrow(/name/);
  });
});
