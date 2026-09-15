import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalPlanSchema, PortalRunSchema, storedChecksum, contentHash } from '@sfp/ir';
import { PORTAL_RESULT_SCHEMAS, type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
const setup = async (
  design: Record<string, unknown> = { nodes: [{ id: '0:1', name: 'Welcome', type: 'FRAME' }] },
  beforeCapture?: () => void,
) => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const work: PortalWorkPort = {
    prepareValidation: vi.fn<NonNullable<PortalWorkPort['prepareValidation']>>(async () => ({
      hash: contentHash('fixture-environment', {}),
      resources: [],
    })),
    apply: vi.fn<PortalWorkPort['apply']>(),
    validate: vi.fn<PortalWorkPort['validate']>(),
    cancel: vi.fn<PortalWorkPort['cancel']>(async () => {}),
  };
  const capture = await currentCaptureFixture(fixture, {
    nodes: design.nodes as unknown[],
    ...(design.tokens === undefined ? {} : { tokens: design.tokens as unknown[] }),
    ...(design.collections === undefined ? {} : { collections: design.collections as unknown[] }),
    ...(design.styles === undefined
      ? {}
      : {
          styles: design.styles as NonNullable<
            Parameters<typeof currentCaptureFixture>[1]
          >['styles'],
        }),
  });
  const preparations = new CorePreparations(fixture);
  const lifecycle = new PortalCoreLifecycle(preparations);
  const coordinator = new PortalCoordinator(
    fixture.store,
    fixture.policy,
    work,
    Date.now,
    {
      capture: async () => {
        beforeCapture?.();
        return capture.captured;
      },
    },
    undefined,
    lifecycle,
  );
  let operation = 0;
  const invoke = async (name: PortalToolName, input: unknown, who = actor) => {
    const operationId = `test-${++operation}`;
    const authority = await coordinator.prepare(name, input, who, fixture.workspaceId, operationId);
    authority.captureSource = capture.grant;
    return coordinator.execute(name, input, {
      actor: who,
      workspaceId: fixture.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }) as Promise<Record<string, any>>;
  };
  return { ...fixture, work, coordinator, invoke, capture, preparations, lifecycle };
};

it('prepares required core results before publishing blueprint and renews without derivation', async () => {
  const f = await setup();
  const prepare = vi.spyOn(f.preparations, 'prepare');
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  expect(plan.coreRecipes).toMatchObject({ status: 'ready', requiredResults: expect.any(Array) });
  expect(plan.coreRecipes.requiredResults).toHaveLength(7);
  expect(PORTAL_RESULT_SCHEMAS.portal_plan.safeParse(plan).success).toBe(true);
  const stored = await f.store.get('plans', plan.planId, PortalPlanSchema);
  expect(stored?.coreRecipes?.bindingHash).toBe(plan.coreRecipes.bindingHash);
  await f.invoke('portal_start', { planId: plan.planId });
  const next = await f.invoke('portal_next', { runId: plan.planId });
  expect(next.lease).not.toBeNull();
  expect(next.recipes.workItems.length).toBeGreaterThan(0);
  const renewed = await f.invoke('portal_next', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
  });
  expect(renewed.lease.leaseId).toBe(next.lease.leaseId);
  expect(prepare).toHaveBeenCalledTimes(1);
  const item = next.recipes.workItems[0];
  const inspect = await f.invoke('portal_status', {
    runId: plan.planId,
    recipes: { resultId: item.resultId, pageIndex: item.pageIndex },
  });
  expect(inspect.recipes.pageHash).toBe(item.pageHash);
});

it('requires exact page declarations and invalidates them when submitted source changes', async () => {
  const f = await setup();
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  await f.invoke('portal_start', { planId: plan.planId });
  const next = await f.invoke('portal_next', { runId: plan.planId });
  const content = 'export const view = "first";',
    path = 'src/main.ts',
    hash = storedChecksum(content);
  const base = {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    blueprintHash: plan.blueprintHash,
    contextHash: plan.contextHash,
    files: [{ path, action: 'create', baseHash: null, content, contentHash: hash }],
  };
  await expect(f.invoke('portal_submit', { ...base, finished: true })).rejects.toThrow(
    'DECLARATIONS_INCOMPLETE',
  );
  const declarations = next.recipes.workItems.map((item: any) => ({
    resultId: item.resultId,
    resultHash: item.resultHash,
    outputItemId: item.id,
    kind: item.kind,
    files: [{ path, hash }],
    assertionIds: [],
  }));
  expect(
    (await f.invoke('portal_submit', { ...base, coreDeclarations: declarations }))
      .coreDeclarationCount,
  ).toBe(declarations.length);
  const changed = 'export const view = "second";';
  expect(
    (
      await f.invoke('portal_submit', {
        ...base,
        files: [{ ...base.files[0], content: changed, contentHash: storedChecksum(changed) }],
      })
    ).coreDeclarationCount,
  ).toBe(0);
});

it('never issues a current coding lease from a legacy plan without recipe authority', async () => {
  const f = await setup();
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  await f.store.update('plans', plan.planId, PortalPlanSchema, stored => {
    delete stored.coreRecipes;
    return stored;
  });
  expect((await f.invoke('portal_start', { planId: plan.planId })).state).toBe('needs-input');
  expect((await f.invoke('portal_next', { runId: plan.planId })).lease).toBeNull();
});

it('keeps unavailable capture inspectable with no fabricated core preparation', async () => {
  const f = await setup(undefined, () => {
    throw Error('capture unavailable');
  });
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  expect(plan.coreRecipes).toMatchObject({
    status: 'blocked',
    preparationId: null,
    requiredResults: [],
  });
  expect((await f.invoke('portal_start', { planId: plan.planId })).state).toBe('needs-input');
  expect((await f.invoke('portal_next', { runId: plan.planId })).lease).toBeNull();
});

it('rejects a changed retained page before lease renewal', async () => {
  const f = await setup();
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  await f.invoke('portal_start', { planId: plan.planId });
  const next = await f.invoke('portal_next', { runId: plan.planId });
  const item = next.recipes.workItems[0],
    id = contentHash('sfp-core-page-record-v1', {
      contextHash: plan.coreRecipes.contextHash,
      pageHash: item.pageHash,
    });
  const path = join(f.stateRoot, 'portal/core-pages', id.slice(7) + '.json');
  const original = await readFile(path, 'utf8');
  await writeFile(
    path,
    original.replace(/"mac":"[a-f0-9]{64}"/u, '"mac":"' + '0'.repeat(64) + '"'),
  );
  await expect(
    f.invoke('portal_next', { runId: plan.planId, leaseId: next.lease.leaseId }),
  ).rejects.toThrow('PORTAL_RECORD_TAMPERED');
  const run = await f.store.get('runs', plan.planId, PortalRunSchema);
  expect(run?.generationAttempts).toBe(1);
});

it('resumes an interrupted plan using its immutable captured bytes and required results', async () => {
  let captures = 0;
  const f = await setup(undefined, () => {
    captures++;
  });
  const request = { case: 'new-blank' };
  const operationId = 'interrupted-plan';
  const authority = await f.coordinator.prepare(
    'portal_plan',
    request,
    actor,
    f.workspaceId,
    operationId,
  );
  authority.captureSource = f.capture.grant;
  const execute = () =>
    f.coordinator.execute('portal_plan', request, {
      actor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }) as Promise<any>;
  const create = f.store.create.bind(f.store);
  let interrupted = false;
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    if (args[0] === 'plans' && !interrupted) {
      interrupted = true;
      throw Error('plan publication interrupted');
    }
    return create(...args);
  });
  await expect(execute()).rejects.toThrow('plan publication interrupted');
  vi.restoreAllMocks();
  const recovered = await execute();
  expect(recovered.coreRecipes.status).toBe('ready');
  expect(captures).toBe(1);
  const ledger = JSON.parse(
    await readFile(join(f.stateRoot, 'portal/core-capacity/index.json'), 'utf8'),
  );
  expect(ledger.payload.rows).toHaveLength(1);
  expect(
    (
      await f.preparations.inspect(
        { ownerId: actor.actorId, workspaceId: f.workspaceId },
        recovered.coreRecipes.preparationId,
      )
    ).dependencies,
  ).toContain('plan:' + recovered.planId);
});

it('refuses a new source context under an interrupted existing plan intent', async () => {
  const f = await setup();
  await mkdir(join(f.workspaceRoot, 'legacy'));
  await writeFile(join(f.workspaceRoot, 'legacy/package.json'), '{}');
  await writeFile(join(f.workspaceRoot, 'legacy/main.ts'), 'export const value=1;');
  const request = { case: 'legacy', targetPath: 'legacy' };
  const operationId = 'same-intent';
  const authority = await f.coordinator.prepare(
    'portal_plan',
    request,
    actor,
    f.workspaceId,
    operationId,
  );
  authority.captureSource = f.capture.grant;
  const execute = () =>
    f.coordinator.execute('portal_plan', request, {
      actor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    });
  const create = f.store.create.bind(f.store);
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    if (args[0] === 'plans') throw Error('plan publication interrupted');
    return create(...args);
  });
  await expect(execute()).rejects.toThrow('plan publication interrupted');
  vi.restoreAllMocks();
  await writeFile(join(f.workspaceRoot, 'legacy/main.ts'), 'export const value=2;');
  await expect(execute()).rejects.toThrow('CORE_PREPARATION_INTENT_CHANGED');
});

it('retains one-character source ownership through confirmed workflow admission and lease freshness', async () => {
  const f = await setup();
  await mkdir(join(f.workspaceRoot, 'legacy/a'), { recursive: true });
  await writeFile(join(f.workspaceRoot, 'legacy/package.json'), '{"workspaces":["a"]}');
  await writeFile(
    join(f.workspaceRoot, 'legacy/a/package.json'),
    '{"name":"a","dependencies":{"react":"19.2.8"}}',
  );
  const content = 'export function Button(){return <button>Portal</button>}';
  await writeFile(join(f.workspaceRoot, 'legacy/a/Button.tsx'), content);
  const request = { case: 'legacy', targetPath: 'legacy', services: ['a'] };
  const draft = await f.invoke('portal_plan', request),
    selector = draft.selectedClosure.selected[0];
  const requirements = draft.requirements.map((requirement: any) =>
    Object.assign({}, requirement, {
      workflow: {
        status: 'confirmed',
        roles: ['visitor'],
        states: ['loading', 'ready', 'error'],
        routes: ['/'],
        apiContracts: [],
        dataContracts: [],
        decisions: requirement.layers.map((layer: string) => ({
          layer,
          action: 'present',
          evidence: 'Use the exact selected one-character source component',
          sourceEvidence: [
            {
              sourceId: selector.sourceId,
              sourceIndex: 0,
              path: 'a/Button.tsx',
              hash: storedChecksum(content),
            },
          ],
        })),
      },
    }),
  );
  const plan = await f.invoke('portal_plan', { ...request, requirements });
  expect(plan.workflowCoverage.complete).toBe(true);
  expect(plan.coreRecipes.status).toBe('ready');
  await f.invoke('portal_start', { planId: plan.planId });
  const next = await f.invoke('portal_next', { runId: plan.planId });
  expect(next.lease).not.toBeNull();
  await writeFile(
    join(f.workspaceRoot, 'legacy/a/Button.tsx'),
    content + '\nexport const changed=true;',
  );
  await expect(
    f.invoke('portal_next', { runId: plan.planId, leaseId: next.lease.leaseId }),
  ).rejects.toThrow('PORTAL_SOURCE_CHANGED');
  await writeFile(join(f.workspaceRoot, 'legacy/a/Button.tsx'), content);
  await writeFile(join(f.workspaceRoot, 'legacy/a/late.bin'), Buffer.from([0, 255]));
  await expect(
    f.invoke('portal_next', { runId: plan.planId, leaseId: next.lease.leaseId }),
  ).rejects.toThrow('PORTAL_CORE_SOURCE_CHANGED');
});

it('releases only the cancelled plan/run dependencies while retaining signed evidence', async () => {
  const f = await setup();
  const plan = await f.invoke('portal_plan', { case: 'new-blank' });
  await f.invoke('portal_start', { planId: plan.planId });
  const scope = { ownerId: actor.actorId, workspaceId: f.workspaceId };
  expect(
    (await f.preparations.inspect(scope, plan.coreRecipes.preparationId)).dependencies.toSorted(),
  ).toEqual(['plan:' + plan.planId, 'run:' + plan.planId].toSorted());
  expect((await f.invoke('portal_cancel', { runId: plan.planId })).state).toBe('cancelled');
  expect(
    (await f.preparations.inspect(scope, plan.coreRecipes.preparationId)).dependencies,
  ).toEqual([]);
  const inspect = await f.invoke('portal_status', { runId: plan.planId, recipes: {} });
  expect(inspect.recipes.results).toHaveLength(7);
});
