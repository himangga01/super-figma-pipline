import {
  hashActionRequest,
  type ActionNonceStore,
  type ActorContext,
  type RegisteredWorkspaceRoot,
  type ResolvedWorkspaceRegistration,
  type WorkspaceConfigStore,
} from '@sfp/shared';
import { z } from 'zod';

import type { ActionNonceAuthority } from './action-nonce-store.js';

const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const NonceSchema = z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u);
export const WorkspaceAddRequestSchema = z
  .object({
    path: z.string().min(1).max(32_768),
    actionNonce: NonceSchema,
  })
  .strict();
export const WorkspaceRebindRequestSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    path: z.string().min(1).max(32_768),
    actionNonce: NonceSchema,
  })
  .strict();
export const WorkspaceRemoveRequestSchema = z
  .object({ workspaceId: WorkspaceIdSchema, actionNonce: NonceSchema })
  .strict();
export const WorkspaceSetDefaultRequestSchema = z
  .object({ workspaceId: WorkspaceIdSchema.nullable(), actionNonce: NonceSchema })
  .strict();

interface WorkspaceEndpointNonceStore extends ActionNonceStore {
  registrationFor?(
    actor: Readonly<ActorContext>,
    value: string,
  ): Readonly<ResolvedWorkspaceRegistration> | undefined;
}

export const createWorkspaceEndpoints = (dependencies: {
  store: WorkspaceConfigStore;
  nonceStore: WorkspaceEndpointNonceStore;
  registrationForNonce?: (
    actor: Readonly<ActorContext>,
    value: string,
  ) => Readonly<ResolvedWorkspaceRegistration> | undefined;
}) => {
  const registrationFor =
    dependencies.registrationForNonce ??
    ((actor: Readonly<ActorContext>, value: string) =>
      (dependencies.nonceStore as ActionNonceAuthority).registrationFor(actor, value));
  const boundRegistration = (
    principal: Readonly<ActorContext>,
    request: { path: string; actionNonce: string },
  ): Readonly<ResolvedWorkspaceRegistration> => {
    const registration = registrationFor(principal, request.actionNonce);
    if (registration === undefined || registration.requestedPath !== request.path) {
      throw Object.assign(new Error('workspace nonce registration binding is invalid'), {
        code: 'ACTION_NONCE_INVALID',
      });
    }
    return registration;
  };
  return Object.freeze({
    add: async (
      principal: Readonly<ActorContext>,
      input: unknown,
    ): Promise<RegisteredWorkspaceRoot> => {
      const request = WorkspaceAddRequestSchema.parse(input);
      const registration = boundRegistration(principal, request);
      const expectedHash = hashActionRequest('workspace.add', { realPath: registration.realPath });
      return dependencies.store.addResolved(principal.actorId, registration, revalidate =>
        dependencies.nonceStore.consumeCas(
          principal,
          request.actionNonce,
          'workspace.add',
          expectedHash,
          revalidate,
        ),
      );
    },
    /**
     * Binds a registration to the identity resolved when its nonce was issued. The nonce hash
     * covers the workspace ID and the server-resolved real path, and the registration is
     * revalidated immediately before the nonce is consumed.
     */
    rebind: async (
      principal: Readonly<ActorContext>,
      input: unknown,
    ): Promise<RegisteredWorkspaceRoot> => {
      const request = WorkspaceRebindRequestSchema.parse(input);
      const registration = boundRegistration(principal, request);
      const expectedHash = hashActionRequest('workspace.rebind', {
        workspaceId: request.workspaceId,
        realPath: registration.realPath,
      });
      return dependencies.store.rebindResolved(
        principal.actorId,
        request.workspaceId,
        registration,
        revalidate =>
          dependencies.nonceStore.consumeCas(
            principal,
            request.actionNonce,
            'workspace.rebind',
            expectedHash,
            revalidate,
          ),
      );
    },
    list: async () => dependencies.store.list(),
    remove: async (principal: Readonly<ActorContext>, input: unknown): Promise<void> => {
      const request = WorkspaceRemoveRequestSchema.parse(input);
      const requestHash = hashActionRequest('workspace.remove', {
        workspaceId: request.workspaceId,
      });
      await dependencies.store.removeAuthorized(principal.actorId, request.workspaceId, () =>
        dependencies.nonceStore.consumeCas(
          principal,
          request.actionNonce,
          'workspace.remove',
          requestHash,
        ),
      );
    },
    setDefault: async (principal: Readonly<ActorContext>, input: unknown): Promise<void> => {
      const request = WorkspaceSetDefaultRequestSchema.parse(input);
      const requestHash = hashActionRequest('workspace.set-default', {
        workspaceId: request.workspaceId,
      });
      await dependencies.store.setDefaultAuthorized(principal.actorId, request.workspaceId, () =>
        dependencies.nonceStore.consumeCas(
          principal,
          request.actionNonce,
          'workspace.set-default',
          requestHash,
        ),
      );
    },
    getDefault: async () => dependencies.store.getDefault(),
  });
};
