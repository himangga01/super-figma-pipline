import { expect, it, vi } from 'vitest';

import { createImportLibraryVariableHandler } from '../../src/handlers/import-library-variable.js';

it('loads only the requested library reference and reports its usable identity', async () => {
  const importVariableByKeyAsync = vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({
      id: 'v:1',
      key: 'key',
      name: 'Primary',
      resolvedType: 'COLOR',
      variableCollectionId: 'c:1',
    });
  const handler = createImportLibraryVariableHandler({
    editorType: 'figma',
    variables: { importVariableByKeyAsync },
  } as never);
  await expect(handler({ key: 'key' })).resolves.toEqual({
    ok: true,
    id: 'v:1',
    key: 'key',
    name: 'Primary',
    resolvedType: 'COLOR',
    collectionId: 'c:1',
  });
  expect(importVariableByKeyAsync).toHaveBeenCalledExactlyOnceWith('key');
  await expect(handler({ key: '' })).rejects.toThrow(/Too small/u);
  expect(importVariableByKeyAsync).toHaveBeenCalledTimes(1);
});
it('does not attempt library access in unsupported editors', async () => {
  const load = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  const handler = createImportLibraryVariableHandler({
    editorType: 'figjam',
    variables: { importVariableByKeyAsync: load },
  } as never);
  await expect(handler({ key: 'key' })).rejects.toThrow('UNAVAILABLE');
  expect(load).not.toHaveBeenCalled();
});
