import {
  ActionNonceIssueRequestV1Schema,
  hashActionRequest,
  type ActionNonceClaims,
  type ActorContext,
  type WorkspaceRegistrationResolver,
} from '@sfp/shared';

import type { ActionNonceAuthority } from './action-nonce-store.js';
import { ActionNonceError } from './action-nonce-store.js';

export const createActionNonceEndpoint =
  (dependencies: {
    store: ActionNonceAuthority;
    registrationResolver: WorkspaceRegistrationResolver;
  }) =>
  async (
    principal: Readonly<ActorContext>,
    input: unknown,
  ): Promise<Readonly<ActionNonceClaims>> => {
    const request = ActionNonceIssueRequestV1Schema.parse(input);
    if (request.action !== 'workspace.add') {
      return dependencies.store.issue(
        principal,
        request.action,
        request.requestHash as `sha256:${string}`,
      );
    }
    const registration = await dependencies.registrationResolver.resolveForNonce(
      request.registrationPath,
    );
    const expectedHash = hashActionRequest('workspace.add', { realPath: registration.realPath });
    if (request.requestHash !== expectedHash) {
      throw new ActionNonceError(
        'ACTION_NONCE_REQUEST_HASH_MISMATCH',
        'workspace.add request hash does not match the server-resolved real path',
      );
    }
    return dependencies.store.issueWorkspaceAdd(
      principal,
      request.requestHash as `sha256:${string}`,
      registration,
    );
  };
