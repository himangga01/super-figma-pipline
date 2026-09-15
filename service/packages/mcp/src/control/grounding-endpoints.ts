import { GroundingRefreshArgsSchema, GroundingRefreshResultSchema } from '@sfp/ir';
import {
  NO_CAPTURE_OPTIONS,
  ServiceOperationRequestV1Schema,
  type ActorContext,
} from '@sfp/shared';
import { z } from 'zod';

import type { LeaderGenerationExecutionPlane } from '../execution/execution-plane.js';

export const GroundingRefreshRequestSchema = ServiceOperationRequestV1Schema.extend({
  serviceOperationName: z.literal('grounding.refresh'),
  rawArgs: GroundingRefreshArgsSchema,
}).strict();
export const createGroundingEndpoint =
  (plane: Pick<LeaderGenerationExecutionPlane, 'invokeServiceFrames'>) =>
  async (
    principal: Readonly<ActorContext>,
    input: unknown,
    signal?: Readonly<{ aborted: boolean }>,
  ) => {
    const request = GroundingRefreshRequestSchema.parse(input);
    for await (const frame of plane.invokeServiceFrames(principal, request, NO_CAPTURE_OPTIONS)) {
      if (signal?.aborted) throw new Error('CONTROL_SUBSCRIBER_DISCONNECTED');
      if (frame.type === 'result') return GroundingRefreshResultSchema.parse(frame.result);
      if (frame.type === 'error') throw Object.assign(new Error(frame.error.message), frame.error);
    }
    throw new Error('CONTROL_TERMINAL_MISSING');
  };
