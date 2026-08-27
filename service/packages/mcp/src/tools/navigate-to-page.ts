import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const NAVIGATE_TO_PAGE_TOOL_NAME = 'navigate_to_page';

export const navigateToPageTool: RawToolSpec = {
  name: NAVIGATE_TO_PAGE_TOOL_NAME,
  description:
    'Switch the active page. Subsequent selection / read tools operate on this page. ' +
    'Returns { ok, nodeId }.',
  inputSchema: z.object({
    pageId: z.string().describe('Page id to navigate to'),
  }),
  kind: 'write',
};
