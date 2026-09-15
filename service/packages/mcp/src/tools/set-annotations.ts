import { SetAnnotationsArgsSchema } from '@sfp/shared';

import type { RawToolSpec } from './spec.js';

export const setAnnotationsTool: RawToolSpec = {
  name: 'set_annotations',
  description:
    "Replace one supported node's native annotations after matching its exact observed " +
    'expectedAnnotations. Supports plain or Markdown labels, existing category IDs and pinned ' +
    'properties. An empty annotations array clears the admitted preimage. Read get_annotations ' +
    'first and again after writing. Host annotation support and write permission are required. Returns { ok, nodeId }.',
  inputSchema: SetAnnotationsArgsSchema,
  kind: 'write',
};
