import { randomUUID } from 'node:crypto';

import { contentHash, PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import type { ActorContext } from '@sfp/shared';
import { z } from 'zod';

import {
  PortalNativeRegistrationSchema,
  PortalNativeProfileSchema,
  type PortalNativeProfile,
  type PortalNativeWork,
} from './native-work.js';
import { portalError, type PortalStore } from './store.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const registration = z
  .object({
    profileId: z.string(),
    recordId: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceHash: hash,
    executionMode: z.literal('native-working-copy'),
  })
  .strict();
export const ProfilePreparationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    preparationId: z.string().uuid(),
    requestId: z.string().uuid(),
    ownerId: z.string(),
    workspaceId: z.string().uuid(),
    planId: PortalPlanSchema.shape.planId,
    contextHash: hash,
    sourceId: hash,
    profileId: z.string(),
    requestHash: hash,
    preparedHash: hash.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    preparationDeadlineAt: z.number().int(),
    registrationDeadlineAt: z.number().int().nullable(),
    issuerDeadlineAt: z.number().int(),
    status: z.enum(['preparing', 'ready', 'registering', 'registered', 'failed', 'unknown']),
    producerPending: z.boolean(),
    errorCode: z.string().nullable(),
    registration: registration.nullable(),
  })
  .strict();
type Row = z.infer<typeof ProfilePreparationRecordSchema>;
export const ProfilePreparationStatusSchema = ProfilePreparationRecordSchema.extend({
  issuerAvailable: z.boolean(),
}).strict();
export const ProfilePreparationBeginSchema = z
  .object({
    profile: z.lazy(() => PortalNativeRegistrationSchema),
    requestId: z.string().uuid(),
    deadlineAt: z.number().int().positive(),
  })
  .strict();
export const ProfilePreparationQuerySchema = z
  .object({
    preparationId: z.string().uuid().optional(),
    planId: PortalPlanSchema.shape.planId.optional(),
    requestId: z.string().uuid().optional(),
    requestHash: hash.optional(),
  })
  .strict()
  .refine(v => v.preparationId !== undefined || v.planId !== undefined, {
    message: 'PORTAL_PROFILE_PREPARATION_SELECTOR_REQUIRED',
  });
export const ProfilePreparationIdSchema = z.object({ preparationId: z.string().uuid() }).strict();
const kind = 'profile-preparations';
const codes = new Set([
  'PORTAL_PROFILE_SOURCE_CHANGED',
  'PORTAL_COMPILER_SOURCE_REQUIRED',
  'PORTAL_COMPILER_SOURCE_INCOMPLETE',
  'PORTAL_COMPILER_PACKAGE_CHANGED',
  'PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED',
  'PORTAL_COMPILER_PACKAGE_LAYOUT_UNSUPPORTED',
  'PORTAL_COMPILER_FRAMEWORK_VERSION_UNSUPPORTED',
  'PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED',
  'PORTAL_COMPILER_LOCK_UNSUPPORTED',
  'PORTAL_COMPILER_LOCK_AMBIGUOUS',
  'PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED',
  'PORTAL_COMPILER_LOCK_INTEGRITY_REQUIRED',
  'PORTAL_COMPILER_ENVIRONMENT_REVIEW_REQUIRED',
  'PORTAL_COMPILER_FRAMEWORK_REQUIRED',
  'PORTAL_COMPILER_ACCEPTANCE_FIELDS_REJECTED',
  'PORTAL_COMPILER_CAPACITY',
  'PORTAL_COMPILER_RUN_STATE_REJECTED',
  'PORTAL_ARTIFACT_CHANGED',
  'PORTAL_ARTIFACT_LIMIT',
  'OPERATION_CANCELLED',
  'PORTAL_BUDGET_EXHAUSTED',
  'PORTAL_SOURCE_CHANGED',
  'PORTAL_ROOT_CHANGED',
  'PORTAL_PROFILE_PREPARATION_CHANGED',
  'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE',
  'PORTAL_NATIVE_CLEANUP_UNKNOWN',
]);
const code = (error: unknown) => {
  try {
    const v = (error as { code?: unknown })?.code;
    return typeof v === 'string' && codes.has(v) ? v : 'PORTAL_PROFILE_PREPARATION_FAILED';
  } catch {
    return 'PORTAL_PROFILE_PREPARATION_FAILED';
  }
};
type Live = {
  row: Row;
  controller: AbortController;
  profile: PortalNativeProfile | null;
  done: Promise<void> | null;
  confirmed: boolean;
};

/** Retained signed metadata is an audit/status record. Only this process's issued map is authority. */
export class ProfilePreparations {
  private readonly live = new Map<string, Live>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: PortalStore,
    private readonly work: PortalNativeWork,
  ) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(action);
    this.tail = next;
    return next;
  }
  private active(signal: Readonly<{ aborted: boolean }>, deadlineAt: number) {
    if (signal.aborted) throw portalError('OPERATION_CANCELLED');
    if (Date.now() >= deadlineAt) throw portalError('PORTAL_BUDGET_EXHAUSTED');
  }
  private async binding(actor: Readonly<ActorContext>, profile: PortalNativeProfile) {
    const plan = await this.store.get('plans', profile.planId, PortalPlanSchema),
      run = await this.store.get('runs', profile.planId, PortalRunSchema);
    if (
      !plan ||
      !run ||
      plan.ownerId !== actor.actorId ||
      run.ownerId !== actor.actorId ||
      plan.contextHash !== profile.contextHash ||
      profile.ownerId !== actor.actorId
    )
      throw portalError('PORTAL_PROFILE_SOURCE_CHANGED');
    if (
      profile.purpose !== 'source-preparation' ||
      !profile.sourcePreparation ||
      !plan.profiles.some(p => p.graph.sourceId === profile.sourcePreparation!.sourceId) ||
      run.candidateHash ||
      run.lease ||
      !['needs-input', 'blocked', 'waiting-agent'].includes(run.state)
    )
      throw portalError('PORTAL_COMPILER_RUN_STATE_REJECTED');
    return { plan, run };
  }
  private async save(entry: Live) {
    entry.row.updatedAt = new Date().toISOString();
    await this.store.update(
      kind,
      entry.row.preparationId,
      ProfilePreparationRecordSchema,
      () => entry.row,
    );
  }
  private view(row: Row) {
    const entry = this.live.get(row.preparationId);
    return ProfilePreparationStatusSchema.parse({
      ...row,
      issuerAvailable:
        !!entry?.confirmed &&
        this.work.sourceProfileIssuerAvailable(row.preparationId) &&
        ['ready', 'registered'].includes(row.status),
    });
  }
  async list(
    actor: Readonly<ActorContext>,
    selector: z.infer<typeof ProfilePreparationQuerySchema>,
  ) {
    const rows = await this.work.profilePreparationRows(ProfilePreparationRecordSchema);
    return rows
      .filter(
        r =>
          r.ownerId === actor.actorId &&
          (!selector.preparationId || r.preparationId === selector.preparationId) &&
          (!selector.planId || r.planId === selector.planId) &&
          (!selector.requestId || r.requestId === selector.requestId) &&
          (!selector.requestHash || r.requestHash === selector.requestHash),
      )
      .map(r => this.view(r));
  }
  async status(actor: Readonly<ActorContext>, id: string) {
    const row = await this.store.get(kind, id, ProfilePreparationRecordSchema);
    if (!row || row.ownerId !== actor.actorId)
      throw portalError('PORTAL_PROFILE_PREPARATION_NOT_FOUND');
    return this.view(row);
  }
  async result(actor: Readonly<ActorContext>, id: string) {
    const row = await this.status(actor, id),
      entry = this.live.get(id);
    if (!entry?.profile || !row.issuerAvailable || !['ready', 'registered'].includes(row.status))
      throw portalError('PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE');
    await this.binding(actor, entry.profile);
    const { ownerId: _, ...result } = entry.profile;
    return result;
  }
  async begin(actor: Readonly<ActorContext>, raw: unknown, signal: Readonly<{ aborted: boolean }>) {
    const request = ProfilePreparationBeginSchema.parse(raw),
      profile = PortalNativeProfileSchema.parse({ ...request.profile, ownerId: actor.actorId });
    if (profile.sourcePreparation?.preparationId !== undefined)
      throw portalError('PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE');
    const { plan, run } = await this.binding(actor, profile);
    this.active(signal, request.deadlineAt);
    const requestHash = contentHash('sfp-profile-preparation-request-v1', {
      profile: request.profile,
      deadlineAt: request.deadlineAt,
      requestId: request.requestId,
    });
    request.deadlineAt = Math.min(request.deadlineAt, run.deadlineAt);
    this.active(signal, request.deadlineAt);
    return this.serial(async () => {
      const rows = await this.work.profilePreparationRows(ProfilePreparationRecordSchema);
      this.active(signal, request.deadlineAt);
      await this.binding(actor, profile);
      this.active(signal, request.deadlineAt);
      const existing = rows.find(
        r => r.ownerId === actor.actorId && r.requestId === request.requestId,
      );
      if (existing && existing.requestHash !== requestHash)
        throw portalError('PORTAL_PROFILE_PREPARATION_REQUEST_CHANGED');
      if (existing) throw portalError('PORTAL_PROFILE_PREPARATION_ALREADY_REQUESTED');
      if (rows.length >= 64) throw portalError('PORTAL_PROFILE_PREPARATION_CAPACITY');
      const now = new Date().toISOString(),
        id = randomUUID(),
        row: Row = {
          schemaVersion: 1,
          preparationId: id,
          requestId: request.requestId,
          ownerId: actor.actorId,
          workspaceId: plan.workspaceId,
          planId: plan.planId,
          contextHash: plan.contextHash,
          sourceId: profile.sourcePreparation!.sourceId,
          profileId: profile.native.id,
          requestHash,
          preparedHash: null,
          createdAt: now,
          updatedAt: now,
          preparationDeadlineAt: request.deadlineAt,
          registrationDeadlineAt: null,
          issuerDeadlineAt: run.deadlineAt,
          status: 'preparing',
          producerPending: true,
          errorCode: null,
          registration: null,
        };
      await this.store.create(kind, id, row, ProfilePreparationRecordSchema);
      const entry: Live = {
        row,
        controller: new AbortController(),
        profile: null,
        done: null,
        confirmed: false,
      };
      this.live.set(id, entry);
      entry.done = this.produce(
        entry,
        request.deadlineAt,
        async bounded => {
          const prepared = await this.work.prepareProfile(profile, bounded, id);
          this.active(bounded, request.deadlineAt);
          await this.binding(actor, prepared);
          this.active(bounded, request.deadlineAt);
          entry.profile = prepared;
          row.preparedHash = contentHash('sfp-prepared-profile-v2', prepared);
          row.status = 'ready';
        },
        profile,
      );
      return this.view(row);
    });
  }
  private async produce(
    entry: Live,
    deadlineAt: number,
    action: (signal: AbortSignal) => Promise<void>,
    profile: PortalNativeProfile,
  ) {
    try {
      await this.work.sourceProfileJob(profile, entry.controller.signal, deadlineAt, action);
    } catch (error) {
      this.work.retireSourceProfile(entry.row.preparationId);
      entry.profile = null;
      entry.row.errorCode = code(error);
      entry.row.status =
        entry.row.registrationDeadlineAt !== null ||
        entry.controller.signal.aborted ||
        Date.now() >= deadlineAt ||
        ['OPERATION_CANCELLED', 'PORTAL_NATIVE_CLEANUP_UNKNOWN'].includes(entry.row.errorCode)
          ? 'unknown'
          : 'failed';
    } finally {
      entry.row.producerPending = false;
      try {
        await this.save(entry);
        this.active(entry.controller.signal, deadlineAt);
        entry.confirmed = ['ready', 'registered'].includes(entry.row.status);
      } catch {
        this.work.retireSourceProfile(entry.row.preparationId);
        entry.confirmed = false;
        entry.row.status = 'unknown';
        entry.profile = null;
        await this.save(entry).catch(() => undefined);
      }
    }
  }
  async register(
    actor: Readonly<ActorContext>,
    raw: PortalNativeProfile,
    deadlineAt: number,
    signal: Readonly<{ aborted: boolean }>,
  ) {
    const profile = PortalNativeProfileSchema.parse(raw),
      id = profile.sourcePreparation?.preparationId;
    if (!id) throw portalError('PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE');
    const { run } = await this.binding(actor, profile);
    deadlineAt = Math.min(deadlineAt, run.deadlineAt);
    this.active(signal, deadlineAt);
    return this.serial(async () => {
      const row = await this.status(actor, id),
        entry = this.live.get(id);
      this.active(signal, deadlineAt);
      if (
        !entry?.profile ||
        !row.issuerAvailable ||
        row.status !== 'ready' ||
        row.preparedHash !== contentHash('sfp-prepared-profile-v2', profile)
      )
        throw portalError('PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE');
      entry.confirmed = false;
      entry.row.status = 'registering';
      entry.row.registrationDeadlineAt = deadlineAt;
      entry.row.producerPending = true;
      entry.controller = new AbortController();
      await this.save(entry);
      entry.done = this.produce(
        entry,
        deadlineAt,
        async bounded => {
          const recordId = await this.work.registerProfile(profile, bounded);
          this.active(bounded, deadlineAt);
          entry.row.registration = {
            profileId: profile.native.id,
            recordId,
            sourceHash: profile.native.sourceHash,
            executionMode: 'native-working-copy',
          };
          entry.row.status = 'registered';
        },
        profile,
      );
      return this.view(entry.row);
    });
  }
  async cancel(actor: Readonly<ActorContext>, id: string) {
    await this.status(actor, id);
    const entry = this.live.get(id);
    if (entry?.row.producerPending) {
      this.work.retireSourceProfile(id);
      entry.confirmed = false;
      entry.controller.abort(portalError('OPERATION_CANCELLED'));
      entry.row.status = 'unknown';
      entry.row.errorCode = 'OPERATION_CANCELLED';
      await this.save(entry);
    }
    return this.status(actor, id);
  }
}
const managers = new WeakMap<PortalNativeWork, ProfilePreparations>();
export const profilePreparations = (store: PortalStore, work: PortalNativeWork) => {
  let manager = managers.get(work);
  if (!manager) {
    manager = new ProfilePreparations(store, work);
    managers.set(work, manager);
  }
  return manager;
};
