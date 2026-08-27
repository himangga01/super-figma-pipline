import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const SWAP_COMPONENT_TOOL_NAME = 'swap_component';

export const swapComponentTool: RawToolSpec = {
  name: SWAP_COMPONENT_TOOL_NAME,
  description:
    "Swap an instance's main component. Provide componentKey (published component, imported via the " +
    'API) or componentId (a local COMPONENT node). Returns { ok, nodeId } (the instance id).',
  inputSchema: z.object({
    instanceId: z.string().describe('Instance node id to swap'),
    componentId: z.string().optional().describe('Local component node id'),
    componentKey: z.string().trim().min(1).optional().describe('Published component key'),
  }),
  kind: 'write',
};
