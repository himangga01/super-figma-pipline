import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const BATCH_RENAME_NODES_TOOL_NAME = 'batch_rename_nodes';

export const batchRenameNodesTool: RawToolSpec = {
  name: BATCH_RENAME_NODES_TOOL_NAME,
  description:
    'Rename many nodes at once from a [{ nodeId, name }] list. Missing nodes are skipped. ' +
    'Returns { ok, affected }.',
  inputSchema: z.object({
    renames: z
      .array(z.object({ nodeId: z.string(), name: z.string() }))
      .describe('Per-node rename instructions'),
  }),
  kind: 'write',
};
