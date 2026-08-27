import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const GET_PAGES_TOOL_NAME = 'get_pages';

export const getPagesTool: RawToolSpec = {
  name: GET_PAGES_TOOL_NAME,
  description: 'Return id+name of every page in the active Figma file.',
  inputSchema: z.object({}),
  kind: 'read',
};
