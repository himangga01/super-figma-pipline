import { ImportLibraryVariableArgsSchema, ImportLibraryVariableResultSchema } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createImportLibraryVariableHandler =
  (host: typeof figma): SandboxToolHandler =>
  async params => {
    const { key } = ImportLibraryVariableArgsSchema.parse(params);
    if (
      host.editorType !== 'figma' ||
      typeof host.variables?.importVariableByKeyAsync !== 'function'
    )
      throw new Error('LIBRARY_VARIABLE_IMPORT_UNAVAILABLE');
    const variable = await host.variables.importVariableByKeyAsync(key);
    return ImportLibraryVariableResultSchema.parse({
      ok: true,
      id: variable.id,
      key: variable.key,
      name: variable.name,
      resolvedType: variable.resolvedType,
      collectionId: variable.variableCollectionId,
    });
  };
