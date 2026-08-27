import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const DELETE_PAGE_TOOL_NAME = 'delete_page';

export const deletePageTool: RawToolSpec = {
  name: DELETE_PAGE_TOOL_NAME,
  description:
    'Delete a page by id. The current page and the last remaining page cannot be deleted. ' +
    'Returns { ok, nodeId }.',
  inputSchema: z.object({
    pageId: z.string().describe('Page id to delete'),
  }),
  kind: 'write',
  destructive: true,
};
