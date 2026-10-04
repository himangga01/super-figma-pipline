import { PortalPlanSchema, PortalRunSchema, storedChecksum } from '@sfp/ir';
import type { ActorContext } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import {
  createNativeAttemptArchivePolicy,
  createCorePreparationArchivePolicy,
} from '../../src/portal/archive-eligibility.js';
import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import type { NativeAttempt } from '../../src/portal/native-lifecycle.js';
import { portalRunStateResource } from '../../src/portal/native-resources.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
async function fixture() {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const captured = await currentCaptureFixture(value);
  const preparations = new CorePreparations(value);
  const coordinator = new PortalCoordinator(
    value.store,
    value.policy,
    {
      apply: vi.fn<PortalWorkPort['apply']>(),
      validate: vi.fn<PortalWorkPort['validate']>(),
      cancel: async () => {},
    },
    Date.now,
    { capture: async () => captured.captured },
    undefined,
    new PortalCoreLifecycle(preparations),
  );
  const args = {
    case: 'new-blank',
    design: { url: captured.grant.url, source: 'chrome', freshness: 'allow-pinned' },
  };
  const authority = await coordinator.prepare(
    'portal_plan',
    args,
    actor,
    value.workspaceId,
    'archive-plan',
  );
  authority.captureSource = captured.grant;
  const result = (await coordinator.execute('portal_plan', args, {
    actor,
    workspaceId: value.workspaceId,
    operationId: 'archive-plan',
    authority,
    signal: new AbortController().signal,
  })) as { planId: string };
  const start = { planId: result.planId };
  const startAuthority = await coordinator.prepare(
    'portal_start',
    start,
    actor,
    value.workspaceId,
    'archive-start',
  );
  await coordinator.execute('portal_start', start, {
    actor,
    workspaceId: value.workspaceId,
    operationId: 'archive-start',
    authority: startAuthority,
    signal: new AbortController().signal,
  });
  const plan = (await value.store.get('plans', result.planId, PortalPlanSchema))!;
  const queue = new FileExecutionQueue();
  const policy = createNativeAttemptArchivePolicy({ store: value.store, queue });
  // This controlled record isolates the trusted lifecycle policy callback; it grants no receipt.
  const record = {
    execution: {
      ownerId: actor.actorId,
      runId: plan.planId,
      resources: [{ key: 'portal:attempt:test', mode: 'write' }],
    },
  } as NativeAttempt;
  const state = (next: 'cancelled' | 'completed' | 'validating-candidate') =>
    value.store.update('runs', plan.planId, PortalRunSchema, run => ({ ...run, state: next }));
  return { ...value, plan, queue, policy, record, state, preparations };
}
it('pins active attempts and rejects missing or mismatched signed run authority', async () => {
  const value = await fixture();
  const remove = vi.fn<() => Promise<string>>(async () => 'deleted');
  await expect(value.policy.withArchiveEligibility(value.record, remove)).rejects.toMatchObject({
    code: 'PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED',
  });
  await value.state('cancelled');
  await expect(
    value.policy.withArchiveEligibility(
      {
        ...value.record,
        execution: {
          ...value.record.execution,
          ownerId: 'other-owner',
        },
      },
      remove,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_ENVIRONMENT_ARCHIVE_AUTHORITY_REQUIRED' });
  await expect(
    value.policy.withArchiveEligibility(
      {
        ...value.record,
        execution: {
          ...value.record.execution,
          runId: 'missing-run',
        },
      },
      remove,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_ENVIRONMENT_ARCHIVE_AUTHORITY_REQUIRED' });
  expect(remove).not.toHaveBeenCalled();
});
it('rereads reachability only after obtaining the production run and execution fence', async () => {
  const value = await fixture();
  await value.state('cancelled');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const active = value.queue.runResources([portalRunStateResource(value.plan.planId)], () => gate);
  const remove = vi.fn<() => Promise<string>>(async () => 'deleted');
  const archive = value.policy.withArchiveEligibility(value.record, remove).catch(error => error);
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
  await value.state('validating-candidate');
  release();
  await active;
  expect(await archive).toMatchObject({ code: 'PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED' });
  expect(remove).not.toHaveBeenCalled();
});
it('allows closed history but keeps partial application pinned under cancellation', async () => {
  const value = await fixture();
  await value.state('cancelled');
  const remove = vi.fn<() => Promise<string>>(async () => 'deleted');
  expect(await value.policy.withArchiveEligibility(value.record, remove)).toBe('deleted');
  const hash = storedChecksum('controlled application');
  await value.store.create(
    'apply',
    value.plan.planId,
    {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      runId: value.plan.planId,
      ownerId: actor.actorId,
      candidateHash: hash,
      authorityHash: hash,
      state: 'applying',
      targetIdentity: null,
      files: [{ path: 'app.js', before: null, after: hash, state: 'intent' }],
    },
    (await import('../../src/portal/native-work.js')).PortalApplyJournalSchema,
  );
  remove.mockClear();
  await expect(value.policy.withArchiveEligibility(value.record, remove)).rejects.toMatchObject({
    code: 'PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED',
  });
  expect(remove).not.toHaveBeenCalled();
});
it('allows a zero-write legacy journal that retains its original target directory identity', async () => {
  const value = await fixture();
  await value.state('cancelled');
  // The controlled signed plan isolates the legacy no-write predicate, not legacy acceptance.
  await value.store.update('plans', value.plan.planId, PortalPlanSchema, plan => ({
    ...plan,
    request: { ...plan.request, case: 'legacy' as const, targetPath: plan.targetPath },
    requestedCase: 'legacy' as const,
    strategy: 'legacy-portal' as const,
    implementationScope: 'operational-portal' as const,
  }));
  const hash = storedChecksum('controlled legacy preimage');
  const schema = (await import('../../src/portal/native-work.js')).PortalApplyJournalSchema;
  await value.store.create(
    'apply',
    value.plan.planId,
    {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      ownerId: actor.actorId,
      runId: value.plan.planId,
      candidateHash: hash,
      authorityHash: hash,
      targetIdentity: 'original-target-identity',
      state: 'prepared',
      files: [{ path: 'app.js', before: hash, after: hash, state: 'pending' }],
    },
    schema,
  );
  expect(
    await value.policy.withArchiveEligibility(value.record, async () => 'closed history'),
  ).toBe('closed history');
});
it('recovers only terminal signed plan/run dependencies before reviewing current archival proof', async () => {
  const value = await fixture();
  const scope = { ownerId: actor.actorId, workspaceId: value.workspaceId };
  const preparationId = value.plan.coreRecipes!.preparationId!;
  const archivePreparations = new CorePreparations({
    ...value,
    archivePolicy: createCorePreparationArchivePolicy({
      store: value.store,
      queue: value.queue,
      releaseDependency: async (boundScope, id, reference) => {
        await value.preparations.setDependency(boundScope, id, reference, false);
      },
    }),
  });
  await expect(archivePreparations.reviewArchive(scope, preparationId)).rejects.toMatchObject({
    code: 'PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED',
  });
  const before = await value.preparations.inspect(scope, preparationId);
  expect(before.dependencies).toContain('plan:' + value.plan.planId);
  expect(before.dependencies).toContain('run:' + value.plan.planId);
  await value.state('cancelled');
  const reviewed = await archivePreparations.reviewArchive(scope, preparationId);
  expect(reviewed.archiveHash).toMatch(/^sha256:/u);
  const after = await value.preparations.inspect(scope, preparationId);
  expect(after.dependencies).toEqual([]);
  expect(after.revision).toBeGreaterThan(before.revision);
  await value.preparations.setDependency(scope, preparationId, 'unknown-history', true);
  await expect(archivePreparations.reviewArchive(scope, preparationId)).rejects.toMatchObject({
    code: 'CORE_DEPENDENCY_ACTIVE',
  });
  expect((await value.preparations.inspect(scope, preparationId)).dependencies).toEqual([
    'unknown-history',
  ]);
});
