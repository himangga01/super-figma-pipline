import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const SET_REACTIONS_TOOL_NAME = 'set_reactions';

// Preserve complete read output through the transport. The plugin validates supported closed
// native write shapes before effects and rejects unknown fields instead of dropping them.
const trigger = z
  .looseObject({
    type: z.string().optional(),
    timeout: z.number().optional(),
    delay: z.number().optional(),
  })
  .nullable();

const action = z.looseObject({
  type: z.string(),
  destinationId: z.string().nullable().optional(),
  navigation: z.string().optional(),
  url: z.string().optional(),
});

const reaction = z.looseObject({ trigger, actions: z.array(action) });

export const setReactionsTool: RawToolSpec = {
  name: SET_REACTIONS_TOOL_NAME,
  description:
    "Replace all of a node's prototype reactions — this overwrites existing reactions rather than " +
    "appending. Each reaction pairs a trigger (e.g. { type: 'ON_CLICK' }) with an actions array " +
    "(e.g. { type: 'NODE', destinationId, navigation, transition }). Best used to round-trip " +
    'supported get_reactions output; unknown trigger/action fields are rejected before effects. ' +
    'To clear all reactions instead use remove_reactions. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node to set reactions on'),
    reactions: z.array(reaction).describe('Reactions to apply (replaces existing)'),
  }),
  kind: 'write',
};
