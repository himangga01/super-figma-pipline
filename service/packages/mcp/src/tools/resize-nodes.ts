import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const RESIZE_NODES_TOOL_NAME = 'resize_nodes';

export const resizeNodesTool: RawToolSpec = {
  name: RESIZE_NODES_TOOL_NAME,
  description:
    'Resize nodes to the given width × height (positive). Non-resizable nodes are skipped. Returns { ok, affected }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).describe('Node ids to resize'),
    width: z.number().gt(0),
    height: z.number().gt(0),
  }),
  kind: 'write',
};
