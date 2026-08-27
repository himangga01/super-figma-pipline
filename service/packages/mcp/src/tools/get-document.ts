import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const GET_DOCUMENT_TOOL_NAME = 'get_document';

export const getDocumentTool: RawToolSpec = {
  name: GET_DOCUMENT_TOOL_NAME,
  description:
    'Return the full node tree (recursive children) of the active Figma page, with base geometry, rotation, opacity, cornerRadius, and fills enrichment.',
  inputSchema: z.object({}),
  kind: 'read',
};
