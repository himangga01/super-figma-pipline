import { PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import { PortalIdSchema } from '@sfp/shared';

import { FileExecutionQueue } from '../execution/file-queue.js';
import type { NativeAttemptArchivePolicy } from './native-lifecycle.js';
import { portalRunStateResource } from './native-resources.js';
import { PortalApplyJournalSchema } from './native-work.js';
import {
  portalCoreAuthorityResource,
  type CorePreparationArchivePolicy,
} from './recipes/core-preparation.js';
import { PortalStore, portalError } from './store.js';

async function assertClosedHistory(store: PortalStore, runId: string, ownerId: string) {
  const run = await store.get('runs', runId, PortalRunSchema);
  const plan = run ? await store.get('plans', run.planId, PortalPlanSchema) : null;
  if (
    !run ||
    !plan ||
    run.runId !== runId ||
    run.ownerId !== ownerId ||
    plan.ownerId !== run.ownerId ||
    run.workspaceId !== plan.workspaceId
  )
    throw portalError('PORTAL_ENVIRONMENT_ARCHIVE_AUTHORITY_REQUIRED');
  if (!['cancelled', 'completed'].includes(run.state) || run.lease !== null)
    throw portalError('PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED');
  const apply = await store.get('apply', run.runId, PortalApplyJournalSchema);
  if (apply && (apply.ownerId !== run.ownerId || apply.runId !== run.runId))
    throw portalError('PORTAL_ENVIRONMENT_ARCHIVE_AUTHORITY_REQUIRED');
  const noEffect =
    apply?.state === 'prepared' &&
    apply.files.every(file => file.state === 'pending') &&
    (!apply.targetIdentity || plan.strategy === 'legacy-portal') &&
    !apply.rootCreations?.length;
  const fullyApplied =
    apply?.state === 'applied' &&
    apply.files.every(file => file.state === 'written') &&
    (apply.rootCreations ?? []).every(root => root.phase === 'published');
  if (
    (apply && !noEffect && !fullyApplied) ||
    (run.appliedHash && (!fullyApplied || apply?.candidateHash !== run.appliedHash))
  )
    throw portalError('PORTAL_ENVIRONMENT_ARCHIVE_DEPENDENCY_PINNED');
  return { run, plan };
}

/** Historical receipt authority survives archival; active or uncertain effects remain pinned. */
export function createNativeAttemptArchivePolicy(dependencies: {
  store: PortalStore;
  queue: FileExecutionQueue;
}): NativeAttemptArchivePolicy {
  return {
    withArchiveEligibility: (record, work) => {
      const resources = new Map(
        record.execution.resources.map(resource => [resource.key, resource]),
      );
      const runResource = portalRunStateResource(record.execution.runId);
      resources.set(runResource.key, runResource);
      return dependencies.queue.runResources([...resources.values()], async () => {
        await assertClosedHistory(
          dependencies.store,
          record.execution.runId,
          record.execution.ownerId,
        );
        return work();
      });
    },
  };
}

/** Recover only exact dependency metadata left behind by a signed terminal transition. */
export function createCorePreparationArchivePolicy(dependencies: {
  store: PortalStore;
  queue: FileExecutionQueue;
  releaseDependency(
    scope: { ownerId: string; workspaceId: string },
    preparationId: string,
    dependencyId: string,
  ): Promise<void>;
}): CorePreparationArchivePolicy {
  return {
    withArchiveEligibility: (record, work) => {
      const scope = { ownerId: record.ownerId, workspaceId: record.workspaceId };
      return dependencies.queue.runResources([portalCoreAuthorityResource(scope)], async () => {
        for (const reference of record.dependencies) {
          const match = /^(?:plan|run):(.+)$/u.exec(reference);
          if (!match || !PortalIdSchema.safeParse(match[1]).success)
            throw portalError('CORE_DEPENDENCY_ACTIVE');
          const id = match[1]!;
          // eslint-disable-next-line no-await-in-loop -- reread each independently signed dependency
          const run = await dependencies.store.get('runs', id, PortalRunSchema);
          // eslint-disable-next-line no-await-in-loop
          const plan = await dependencies.store.get('plans', run?.planId ?? id, PortalPlanSchema);
          if (
            !run ||
            !plan ||
            run.ownerId !== scope.ownerId ||
            plan.ownerId !== scope.ownerId ||
            run.workspaceId !== scope.workspaceId ||
            plan.workspaceId !== scope.workspaceId ||
            plan.coreRecipes?.preparationId !== record.preparationId ||
            run.coreRecipes?.preparationId !== record.preparationId ||
            (reference.startsWith('plan:') ? plan.planId !== id : run.runId !== id)
          )
            throw portalError('CORE_DEPENDENCY_ACTIVE');
          // The global queue also fences every dependent portal transition and native execution.
          // eslint-disable-next-line no-await-in-loop
          await assertClosedHistory(dependencies.store, run.runId, scope.ownerId);
          // eslint-disable-next-line no-await-in-loop -- each release retains signed revision history
          await dependencies.releaseDependency(scope, record.preparationId, reference);
        }
        return work();
      });
    },
  };
}
