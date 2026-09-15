import {
  hashCanonicalJson,
  IdentityBootstrapArgsSchema,
  IdentityBootstrapResultSchema,
  IdentityReadResultSchema,
  type FileIdentity,
} from '@sfp/shared';
import { z } from 'zod';

import type { SandboxHandlers } from './dispatcher.js';
import { FILE_IDENTITY_KEY, FILE_IDENTITY_NAMESPACE } from './file-identity.js';
import { withMutationOutcome } from './mutation.js';

export const createIdentityBootstrap = (
  host: typeof figma,
  generation: () => string,
  hold: (value: boolean) => void,
) => {
  let publication: { nonce: string; identity: FileIdentity; published: boolean } | null = null;
  const raw = () => host.root.getSharedPluginData(FILE_IDENTITY_NAMESPACE, FILE_IDENTITY_KEY);
  const rawHash = () => hashCanonicalJson('sfp-document-identity-value-v1', raw());
  const handlers: SandboxHandlers = {
    '$identity.read': params => {
      z.object({})
        .strict()
        .parse(params ?? {});
      const value = raw(),
        uuid = z.string().uuid().safeParse(value);
      return IdentityReadResultSchema.parse({
        fileName: host.root.name,
        fileKey: host.fileKey || null,
        documentUuid: uuid.success ? uuid.data : null,
        rawHash: rawHash(),
        pluginGeneration: generation(),
      });
    },
    '$identity.bootstrap': withMutationOutcome(
      host,
      'identity.bootstrap',
      async (params, context) => {
        const request = IdentityBootstrapArgsSchema.parse(params);
        if (request.readOnly) throw new Error('IDENTITY_WRITE_REQUIRES_PERSISTENT_MODE');
        if (request.pluginGeneration !== generation() || rawHash() !== request.expectedRawHash)
          throw Object.assign(new Error('identity precondition changed'), {
            code: 'IDENTITY_PRECONDITION_FAILED',
          });
        if (host.fileKey) throw new Error('NATIVE_FILE_IDENTITY_AVAILABLE');
        const mutated = raw() !== request.documentUuid;
        hold(true);
        try {
          if (mutated) {
            host.root.setSharedPluginData(
              FILE_IDENTITY_NAMESPACE,
              FILE_IDENTITY_KEY,
              request.documentUuid,
            );
            context?.markMutated?.();
          }
          if (raw() !== request.documentUuid) throw new Error('IDENTITY_PRECONDITION_FAILED');
        } catch (error) {
          try {
            if (rawHash() !== request.expectedRawHash) context?.markMutated?.();
            else hold(false);
          } catch {
            context?.markMutated?.();
          }
          throw error;
        }
        const identity: FileIdentity = {
          kind: 'document-plugin-uuid',
          value: request.documentUuid,
        };
        publication = { nonce: request.publishNonce, identity, published: false };
        return IdentityBootstrapResultSchema.parse({ fileIdentity: identity, mutated });
      },
    ),
  };
  return {
    handlers,
    publish: (nonce: string): boolean => {
      if (
        publication === null ||
        publication.nonce !== nonce ||
        publication.identity.kind !== 'document-plugin-uuid' ||
        raw() !== publication.identity.value
      )
        return false;
      publication.published = true;
      hold(false);
      return true;
    },
    ready: (nonce: string): boolean => {
      if (
        publication === null ||
        !publication.published ||
        publication.nonce !== nonce ||
        publication.identity.kind !== 'document-plugin-uuid' ||
        raw() !== publication.identity.value
      )
        return false;
      publication = null;
      hold(false);
      return true;
    },
  };
};
