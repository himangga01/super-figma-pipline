import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const RENAME_NODE_TOOL_NAME = 'rename_node';

export const renameNodeTool: RawToolSpec = {
  name: RENAME_NODE_TOOL_NAME,
  description:
    "Rename a single canvas node's layer name; does not affect a component's name elsewhere or its " +
    'instances. To rename a document page use rename_page; to rename many nodes by pattern use ' +
    'batch_rename_nodes. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Figma node id'),
    name: z.string().describe('New layer name'),
  }),
  kind: 'write',
};
