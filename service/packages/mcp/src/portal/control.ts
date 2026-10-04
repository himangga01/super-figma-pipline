import { contentHash, PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import {
  assertCurrentPortalSourceAuthority,
  hashActionRequest,
  type ActionNonceStore,
  type ActorContext,
} from '@sfp/shared';
import { z } from 'zod';

import type { AuthenticatedControlRouter } from '../control/router.js';
import { NativeAttemptSchema, type NativeEnvironmentLifecycle } from './native-lifecycle.js';
import {
  PortalNativeRegistrationSchema,
  PortalPreparedNativeProfileSchema,
  type PortalNativeWork,
} from './native-work.js';
import { assertPortalProfileClosure } from './profile-closure.js';
import type { CorePreparations } from './recipes/core-preparation.js';
import { type PortalStore, portalError } from './store.js';

const RequestSchema = z
  .object({
    profile: PortalPreparedNativeProfileSchema,
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
    const { ownerId: _ownerId, ...publicProfile } = prepared;
    return PortalPreparedNativeProfileSchema.parse(publicProfile);
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
      outputSchema: PortalPreparedNativeProfileSchema,
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
const ArchiveReviewSchema = z
  .object({
    receiptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    archiveHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    bytes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    completed: z.boolean(),
  })
  .strict();
const EnvironmentArchiveSchema = EnvironmentInspectSchema.extend({
  receiptHash: ArchiveReviewSchema.shape.receiptHash,
  archiveHash: ArchiveReviewSchema.shape.archiveHash,
  actionNonce: RequestSchema.shape.actionNonce,
}).strict();
const CoreArchiveInspectSchema = z
  .object({
    workspaceId: z.string().uuid(),
    preparationId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const CoreArchiveSchema = CoreArchiveInspectSchema.extend({
  archiveHash: ArchiveReviewSchema.shape.archiveHash,
  actionNonce: RequestSchema.shape.actionNonce,
}).strict();
/** Destructive archival requires the exact reviewed durable proof and an owner action nonce. */
export const registerPortalArchiveRoutes = (
  router: AuthenticatedControlRouter,
  environments: NativeEnvironmentLifecycle,
  preparations: CorePreparations,
  nonces: ActionNonceStore,
): void => {
  router.register({
    id: 'portal.environment.archive.review',
    method: 'POST',
    path: '/control/portal/environments/archive/review',
    routeClass: 'admin',
    inputSchema: EnvironmentInspectSchema,
    outputSchema: ArchiveReviewSchema,
    handle: async (actor, input, signal) => {
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
      return environments.reviewArchive(
        EnvironmentInspectSchema.parse(input).attemptId,
        actor.actorId,
      );
    },
  });
  router.register({
    id: 'portal.environment.archive',
    method: 'POST',
    path: '/control/portal/environments/archive',
    routeClass: 'admin',
    inputSchema: EnvironmentArchiveSchema,
    outputSchema: ArchiveReviewSchema,
    handle: async (actor, input, signal) => {
      const { attemptId, receiptHash, archiveHash, actionNonce } =
        EnvironmentArchiveSchema.parse(input);
      await nonces.consumeCas(
        actor,
        actionNonce,
        'portal.environment.archive',
        hashActionRequest('portal.environment.archive', { attemptId, receiptHash, archiveHash }),
        async () => {
          if (signal.aborted) throw portalError('OPERATION_CANCELLED');
          const current = await environments.reviewArchive(attemptId, actor.actorId);
          if (current.receiptHash !== receiptHash || current.archiveHash !== archiveHash)
            throw portalError('PORTAL_ENVIRONMENT_ARCHIVE_CHANGED');
        },
      );
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
      return environments.archive(attemptId, actor.actorId, receiptHash, archiveHash);
    },
  });
  router.register({
    id: 'portal.core.archive.review',
    method: 'POST',
    path: '/control/portal/core/archive/review',
    routeClass: 'admin',
    inputSchema: CoreArchiveInspectSchema,
    outputSchema: ArchiveReviewSchema,
    handle: async (actor, input, signal) => {
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
      const { workspaceId, preparationId } = CoreArchiveInspectSchema.parse(input);
      return preparations.reviewArchive({ ownerId: actor.actorId, workspaceId }, preparationId);
    },
  });
  router.register({
    id: 'portal.core.archive',
    method: 'POST',
    path: '/control/portal/core/archive',
    routeClass: 'admin',
    inputSchema: CoreArchiveSchema,
    outputSchema: ArchiveReviewSchema,
    handle: async (actor, input, signal) => {
      const { workspaceId, preparationId, archiveHash, actionNonce } =
        CoreArchiveSchema.parse(input);
      const scope = { ownerId: actor.actorId, workspaceId };
      await nonces.consumeCas(
        actor,
        actionNonce,
        'portal.core.archive',
        hashActionRequest('portal.core.archive', { workspaceId, preparationId, archiveHash }),
        async () => {
          if (signal.aborted) throw portalError('OPERATION_CANCELLED');
          const current = await preparations.reviewArchive(scope, preparationId);
          if (current.archiveHash !== archiveHash) throw portalError('CORE_ARCHIVE_CHANGED');
        },
      );
      if (signal.aborted) throw portalError('OPERATION_CANCELLED');
      return preparations.archive(scope, preparationId, archiveHash);
    },
  });
};
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
