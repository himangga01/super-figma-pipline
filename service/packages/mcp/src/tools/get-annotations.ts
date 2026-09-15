import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const GET_ANNOTATIONS_TOOL_NAME = 'get_annotations';

export const getAnnotationsTool: RawToolSpec = {
  name: GET_ANNOTATIONS_TOOL_NAME,
  description:
    'Return Dev Mode annotations as { annotations: [{ nodeId, nodeName, annotations }] }. ' +
    "With nodeId, returns the supported node's exact row even when its annotations array is empty; missing or unsupported nodes produce no row. Without it, scans the current page for all " +
    'annotated nodes.',
  inputSchema: z.object({
    nodeId: z
      .string()
      .describe('Node id to read annotations from; omit to scan the current page')
      .optional(),
  }),
  kind: 'read',
};
