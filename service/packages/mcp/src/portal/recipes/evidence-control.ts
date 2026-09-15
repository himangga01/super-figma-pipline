import { NO_CAPTURE_OPTIONS, ServiceOperationRequestV1Schema } from '@sfp/shared';
import { z } from 'zod';

import type { AuthenticatedControlRouter } from '../../control/router.js';
import type { LeaderGenerationExecutionPlane } from '../../execution/execution-plane.js';
import {
  RECIPE_EVIDENCE_OPERATION_NAMES,
  RecipeEvidenceArgsSchema,
  RecipeEvidenceResultSchema,
} from './evidence-contract.js';

/** Explicit canonical service envelopes, never a fallback to grounding.refresh or direct mutation. */
export function registerRecipeEvidenceRoutes(
  router: AuthenticatedControlRouter,
  plane: Pick<LeaderGenerationExecutionPlane, 'invokeServiceFrames'>,
): void {
  for (const name of RECIPE_EVIDENCE_OPERATION_NAMES) {
    const schema = ServiceOperationRequestV1Schema.extend({
      serviceOperationName: z.literal(name),
      rawArgs: RecipeEvidenceArgsSchema,
    }).strict();
    router.register({
      id: name,
      method: 'POST',
      path: `/control/recipes/evidence/${name.split('.').at(-1)}`,
      routeClass: 'service',
      inputSchema: schema,
      outputSchema: RecipeEvidenceResultSchema,
      handle: async (principal, input, signal) => {
        const request = schema.parse(input);
        for await (const frame of plane.invokeServiceFrames(
          principal,
          request,
          NO_CAPTURE_OPTIONS,
        )) {
          if (signal?.aborted) throw new Error('CONTROL_SUBSCRIBER_DISCONNECTED');
          if (frame.type === 'result') return RecipeEvidenceResultSchema.parse(frame.result);
          if (frame.type === 'error')
            throw Object.assign(new Error(frame.error.message), frame.error);
        }
        throw new Error('CONTROL_TERMINAL_MISSING');
      },
    });
  }
}
