import { contentHash, PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import {
  assertCurrentPortalSourceAuthority,
  hashActionRequest,
  type ActionNonceStore,
  type ActorContext,
} from '@sfp/shared';
import { z } from 'zod';

import type { AuthenticatedControlRouter } from '../control/router.js';
import { NativeAttemptSchema } from './native-lifecycle.js';
import { PortalNativeRegistrationSchema, type PortalNativeWork } from './native-work.js';
import { assertPortalProfileClosure } from './profile-closure.js';
import { type PortalStore, portalError } from './store.js';

const RequestSchema = z
  .object({
    profile: PortalNativeRegistrationSchema,
    actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
  })
  .strict();
const ResultSchema = z
  .object({
    profileId: z.string(),
    recordId: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    executionMode: z.literal('native-working-copy'),
  })
  .strict();

export const createPortalProfileEndpoint =
  (dependencies: { store: PortalStore; work: PortalNativeWork; nonces: ActionNonceStore }) =>
  async (actor: Readonly<ActorContext>, input: unknown, signal: Readonly<{ aborted: boolean }>) => {
    const { profile, actionNonce } = RequestSchema.parse(input);
    const active = () => {
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
    };
    active();
    const plan = await dependencies.store.get('plans', profile.planId, PortalPlanSchema);
    if (!plan || plan.ownerId !== actor.actorId) throw portalError('PORTAL_PLAN_NOT_FOUND');
    const run = await dependencies.store.get('runs', profile.planId, PortalRunSchema);
    if (!run || run.ownerId !== actor.actorId) throw portalError('PORTAL_RUN_NOT_FOUND');
    if (plan.contextHash !== profile.contextHash || run.candidateHash !== profile.native.sourceHash)
      throw portalError('PORTAL_PROFILE_SOURCE_CHANGED');
    assertCurrentPortalSourceAuthority(plan, run, profile, profile.native);
    assertPortalProfileClosure(plan, run, profile.native);
    await dependencies.work.assertCapture(plan);
    const requestHash = hashActionRequest('portal.profile.register', {
      planId: profile.planId,
      profileHash: contentHash('sfp-portal-profile-request-v1', profile),
    });
    await dependencies.nonces.consumeCas(
      actor,
      actionNonce,
      'portal.profile.register',
      requestHash,
      async () => {
        active();
        await dependencies.work.assertCapture(plan);
      },
    );
    active();
    const recordId = await dependencies.work.registerProfile({
      ...profile,
      ownerId: actor.actorId,
    });
    return {
      profileId: profile.native.id,
      recordId,
      sourceHash: profile.native.sourceHash,
      executionMode: 'native-working-copy' as const,
    };
  };
export const createPortalProfilePreparationEndpoint =
  (dependencies: { store: PortalStore; work: PortalNativeWork }) =>
  async (actor: Readonly<ActorContext>, input: unknown, signal: Readonly<{ aborted: boolean }>) => {
    const profile = PortalNativeRegistrationSchema.parse(input);
    if (signal.aborted) throw portalError('OPERATION_CANCELLED');
    const plan = await dependencies.store.get('plans', profile.planId, PortalPlanSchema);
    const run = await dependencies.store.get('runs', profile.planId, PortalRunSchema);
    if (!plan || plan.ownerId !== actor.actorId) throw portalError('PORTAL_PLAN_NOT_FOUND');
    if (!run || run.ownerId !== actor.actorId) throw portalError('PORTAL_RUN_NOT_FOUND');
    assertCurrentPortalSourceAuthority(plan, run, profile, profile.native);
    if (plan.contextHash !== profile.contextHash || run.candidateHash !== profile.native.sourceHash)
      throw portalError('PORTAL_PROFILE_SOURCE_CHANGED');
    assertPortalProfileClosure(plan, run, profile.native);
    const prepared = await dependencies.work.prepareProfile({ ...profile, ownerId: actor.actorId });
    if (signal.aborted) throw portalError('OPERATION_CANCELLED');
    return PortalNativeRegistrationSchema.parse({
      schemaVersion: prepared.schemaVersion,
      sourceAuthorityVersion: prepared.sourceAuthorityVersion,
      planId: prepared.planId,
      contextHash: prepared.contextHash,
      native: prepared.native,
      sourceReviews: prepared.sourceReviews,
      assertions: prepared.assertions,
    });
  };
export const registerPortalControlRoutes = (
  router: AuthenticatedControlRouter,
  endpoint: ReturnType<typeof createPortalProfileEndpoint>,
  prepare?: ReturnType<typeof createPortalProfilePreparationEndpoint>,
): void => {
  if (prepare)
    router.register({
      id: 'portal.profile.prepare',
      method: 'POST',
      path: '/control/portal/profiles/prepare',
      routeClass: 'admin',
      inputSchema: PortalNativeRegistrationSchema,
      outputSchema: PortalNativeRegistrationSchema,
      handle: prepare,
    });
  router.register({
    id: 'portal.profile.register',
    method: 'POST',
    path: '/control/portal/profiles',
    routeClass: 'admin',
    inputSchema: RequestSchema,
    outputSchema: ResultSchema,
    handle: endpoint,
  });
};

const EnvironmentInspectSchema = z
  .object({ attemptId: z.string().regex(/^[a-f0-9]{64}$/u) })
  .strict();
const EnvironmentReconcileSchema = EnvironmentInspectSchema.extend({
  receiptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
}).strict();
export const registerPortalEnvironmentRoutes = (
  router: AuthenticatedControlRouter,
  work: PortalNativeWork,
  nonces: ActionNonceStore,
): void => {
  router.register({
    id: 'portal.environment.inspect',
    method: 'POST',
    path: '/control/portal/environments/inspect',
    routeClass: 'admin',
    inputSchema: EnvironmentInspectSchema,
    outputSchema: z.object({ record: NativeAttemptSchema, receiptHash: z.string() }).strict(),
    handle: async (actor, input) => {
      const { attemptId } = EnvironmentInspectSchema.parse(input);
      const record = await work.environments.inspect(attemptId, actor.actorId);
      return { record, receiptHash: contentHash('sfp-native-lifecycle-receipt-v1', record) };
    },
  });
  router.register({
    id: 'portal.environment.reconcile',
    method: 'POST',
    path: '/control/portal/environments/reconcile',
    routeClass: 'admin',
    inputSchema: EnvironmentReconcileSchema,
    outputSchema: NativeAttemptSchema,
    handle: async (actor, input, signal) => {
      const { attemptId, receiptHash, actionNonce } = EnvironmentReconcileSchema.parse(input);
      const requestHash = hashActionRequest('portal.environment.reconcile', {
        attemptId,
        receiptHash,
      });
      await nonces.consumeCas(
        actor,
        actionNonce,
        'portal.environment.reconcile',
        requestHash,
        async () => {
          if (signal.aborted) throw portalError('OPERATION_CANCELLED');
        },
      );
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
      return work.environments.reconcile(attemptId, actor.actorId, receiptHash);
    },
  });
};
