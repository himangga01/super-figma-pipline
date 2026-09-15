import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const CREATE_VARIABLE_COLLECTION_TOOL_NAME = 'create_variable_collection';

export const createVariableCollectionTool: RawToolSpec = {
  name: CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  description:
    'Create a variable collection. Figma auto-creates a default mode; optional defaultModeName names that actual mode before success. ' +
    'Returns { ok, collectionId, defaultModeId, name }.',
  inputSchema: z.object({
    name: z.string().describe('Collection name, e.g. "Theme"'),
    defaultModeName: z.string().min(1).max(256).optional(),
  }),
  kind: 'write',
};
