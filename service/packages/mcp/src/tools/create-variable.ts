import { VariableInitialValuesSchema } from '@sfp/shared';
import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const CREATE_VARIABLE_TOOL_NAME = 'create_variable';

export const createVariableTool: RawToolSpec = {
  name: CREATE_VARIABLE_TOOL_NAME,
  // EASING / TIMING are intentionally absent from the enum: Figma's createVariable rejects them
  // outright, so listing them would only steer an agent into a call that cannot succeed. The
  // description still names them so an agent that sees such a variable knows why it can't make one.
  // See the note in the sandbox handler (packages/plugin/src/handlers/create-variable.ts).
  description:
    'Create a variable in a collection with resolvedType BOOLEAN / FLOAT / STRING / COLOR. The ' +
    'optional initialValues must cover every actual collection mode with correctly typed values. ' +
    'Without initialValues, set per-mode values with set_variable_value, then attach it with ' +
    'bind_variable_to_node or bind_variable_to_paint. EASING and TIMING variables cannot be created ' +
    'by plugins at all — Figma rejects it; they can only be made in the Figma UI. Returns ' +
    '{ ok, variableId, name }.',
  inputSchema: z.object({
    name: z.string().describe('Variable name, e.g. "color/primary"'),
    collectionId: z.string().describe('Variable collection id'),
    resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']).describe('Variable data type'),
    initialValues: VariableInitialValuesSchema.optional().describe(
      'Exact initial values for all current collection modes, using observed mode IDs. Aliases must exist and have the same resolved type.',
    ),
  }),
  kind: 'write',
};
