import { canonicalFileIdentityHash, DocumentBindingRequestSchema, SystemMethod } from '@sfp/shared';
import { z } from 'zod';

import type { TargetResolver } from '../execution/target-resolver.js';
import type { Relay } from '../relay/relay.js';
import type { AuthenticatedControlRouter } from './router.js';

export const registerIdentityRoutes = (
  router: AuthenticatedControlRouter,
  relay: Relay,
  targets: TargetResolver,
): void => {
  router.register({
    id: 'identity.offer',
    method: 'POST',
    path: '/control/identity/offer',
    routeClass: 'admin',
    inputSchema: z
      .object({
        sessionId: z.string().min(1).max(256),
        fileKey: DocumentBindingRequestSchema.shape.fileKey,
        readOnly: z.boolean().default(true),
      })
      .strict(),
    outputSchema: z.object({ offered: z.literal(true) }).strict(),
    handle: async (_principal, input) => {
      const target = targets.resolve({ kind: 'session', sessionId: input.sessionId }, 'required');
      if (
        target.fileIdentity === null ||
        target.fileExecutionKey === null ||
        target.pluginGeneration === null ||
        target.editorType == null ||
        target.capabilities == null
      )
        throw new Error('IDENTITY_TARGET_UNAVAILABLE');
      return relay.sendRequest(
        SystemMethod.BindingOffer,
        { fileKey: input.fileKey, readOnly: input.readOnly },
        10_000,
        input.sessionId,
        undefined,
        undefined,
        {
          sessionId: input.sessionId,
          pluginGeneration: target.pluginGeneration,
          fileIdentity: target.fileIdentity,
          fileIdentityHash: canonicalFileIdentityHash(target.fileIdentity),
          fileExecutionKey: target.fileExecutionKey,
          editorType: target.editorType,
          capabilities: target.capabilities,
        },
      ) as Promise<{ offered: true }>;
    },
  });
};
