import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalRunSchema } from '@sfp/ir';
import type { ActorContext, PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
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
async function setup(kind: 'new-reference' | 'legacy' = 'new-reference') {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await mkdir(join(fixture.workspaceRoot, 'reference/server'), { recursive: true });
  await writeFile(
    join(fixture.workspaceRoot, 'reference/package.json'),
    '{"type":"module","devDependencies":{"@react-router/dev":"8.4.0"}}',
  );
  await writeFile(
    join(fixture.workspaceRoot, 'reference/server/app.ts'),
    'export const app=import("virtual:react-router/server-build");',
  );
  await writeFile(
    join(fixture.workspaceRoot, 'reference/react-router.config.ts'),
    'export default {ssr:true};',
  );
  await writeFile(join(fixture.workspaceRoot, 'reference/vite.config.ts'), 'export default {};');
  await writeFile(
    join(fixture.workspaceRoot, 'design.json'),
    JSON.stringify({
      requestedUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      requestedNodeId: '0:1',
      nodes: [{ id: '0:1', type: 'FRAME', name: 'Owned fixture' }],
    }),
  );
  const prepareSource = vi.fn<NonNullable<PortalWorkPort['prepareSource']>>(
    async (_plan, _run, _profile, sourceId) => ({
      schemaVersion: 1,
      preparationId: 'sha256:' + 'a'.repeat(64),
      sourceId,
      sourceInventoryHash: 'sha256:' + 'b'.repeat(64),
      compilerEvidenceHash: 'sha256:' + 'c'.repeat(64),
      status: 'ready',
      sourcePreparationOnly: true,
      requiresReplan: true,
      authorityExpiresOnRestart: true,
      generatedFiles: 4,
    }),
  );
  const work: PortalWorkPort = {
    prepareSource,
    validate: vi.fn<PortalWorkPort['validate']>(),
    apply: vi.fn<PortalWorkPort['apply']>(),
    cancel: vi.fn<PortalWorkPort['cancel']>(async () => {}),
  };
  const coordinator = new PortalCoordinator(fixture.store, fixture.policy, work);
  let next = 0;
  const invoke = async (name: PortalToolName, input: unknown) => {
    const operationId = 'source-fixture-' + ++next,
      authority = await coordinator.prepare(name, input, actor, fixture.workspaceId, operationId);
    return coordinator.execute(name, input, {
      actor,
      workspaceId: fixture.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }) as Promise<Record<string, any>>;
  };
  const plan = await invoke('portal_plan', {
    case: kind,
    targetPath: kind === 'legacy' ? 'reference' : 'out',
    references:
      kind === 'legacy' ? [] : [{ workspaceId: fixture.workspaceId, rootPath: 'reference' }],
    design: { artifactPath: 'design.json', freshness: 'allow-pinned' },
  });
  await invoke('portal_start', { planId: plan.planId });
  return { ...fixture, plan, invoke, prepareSource, work };
}
it('admits only source preparation for an unresolved draft and preserves the original run and lease absence', async () => {
  const value = await setup(),
    before = await value.store.get('runs', value.plan.planId, PortalRunSchema);
  expect(before!.state).toBe('needs-input');
  expect(before!.lease).toBeNull();
  const result = await value.invoke('portal_prepare_source', {
    runId: value.plan.planId,
    profileId: 'c3-source',
    sourceId: value.plan.services[0].sourceId,
    deadlineAt: before!.deadlineAt,
  });
  expect(result).toMatchObject({
    sourcePreparationOnly: true,
    requiresReplan: true,
    authorityExpiresOnRestart: true,
  });
  expect(value.prepareSource).toHaveBeenCalledTimes(1);
  expect(await value.store.get('runs', value.plan.planId, PortalRunSchema)).toEqual(before);
  await expect(
    value.invoke('portal_validate', { runId: value.plan.planId, profileId: 'c3-source' }),
  ).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_CURRENT_REQUIRED' });
});
it('rejects deadline extension and candidate/lease source preparation before its producer', async () => {
  const value = await setup(),
    run = await value.store.get('runs', value.plan.planId, PortalRunSchema);
  const args = {
    runId: value.plan.planId,
    profileId: 'c3-source',
    sourceId: value.plan.services[0].sourceId,
    deadlineAt: run!.deadlineAt,
  };
  await expect(
    value.invoke('portal_prepare_source', { ...args, deadlineAt: args.deadlineAt + 1 }),
  ).rejects.toMatchObject({ code: 'PORTAL_BUDGET_EXHAUSTED' });
  await value.store.update('runs', value.plan.planId, PortalRunSchema, current => ({
    ...current,
    state: 'blocked' as const,
    candidateHash: 'sha256:' + 'd'.repeat(64),
  }));
  await expect(value.invoke('portal_prepare_source', args)).rejects.toMatchObject({
    code: 'PORTAL_COMPILER_RUN_STATE_REJECTED',
  });
  expect(value.prepareSource).not.toHaveBeenCalled();
});

it('public source preparation preserves an unresolved legacy target run without requiring a fabricated reference', async () => {
  const value = await setup('legacy'),
    before = await value.store.get('runs', value.plan.planId, PortalRunSchema);
  expect(value.plan.services[0].role).toBe('target');
  await value.invoke('portal_prepare_source', {
    runId: value.plan.planId,
    profileId: 'c2-source',
    sourceId: value.plan.services[0].sourceId,
    deadlineAt: before!.deadlineAt,
  });
  expect(value.prepareSource).toHaveBeenCalledTimes(1);
  expect(await value.store.get('runs', value.plan.planId, PortalRunSchema)).toEqual(before);
  expect(before!.lease).toBeNull();
});

it('keeps the physical source producer fenced from next and submission while status remains available', async () => {
  const value = await setup();
  value.work.hasPendingSourcePreparation = () => true;
  const before = await value.store.get('runs', value.plan.planId, PortalRunSchema);
  await expect(value.invoke('portal_next', { runId: value.plan.planId })).rejects.toMatchObject({
    code: 'PORTAL_NATIVE_RUN_BUSY',
  });
  await expect(
    value.invoke('portal_submit', {
      runId: value.plan.planId,
      leaseId: '123e4567-e89b-42d3-a456-426614174000',
      leaseEpoch: 1,
      blueprintHash: 'sha256:' + 'a'.repeat(64),
      contextHash: 'sha256:' + 'b'.repeat(64),
      files: [
        {
          path: 'owned-fixture.ts',
          action: 'create',
          baseHash: null,
          content: 'export {};',
          contentHash: 'sha256:' + 'c'.repeat(64),
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_RUN_BUSY' });
  expect((await value.invoke('portal_status', { runId: value.plan.planId })).runId).toBe(
    value.plan.planId,
  );
  expect(await value.store.get('runs', value.plan.planId, PortalRunSchema)).toEqual(before);
});
