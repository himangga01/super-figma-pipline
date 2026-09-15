import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalPlanSchema, PortalRunSchema, storedChecksum, contentHash } from '@sfp/ir';
import { PORTAL_RESULT_SCHEMAS, type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';
import { qualifiedPortalSourceId } from '../../src/portal/service-selection.js';
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
    new PortalCoreLifecycle(new CorePreparations(fixture)),
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
  return { ...fixture, work, coordinator, invoke, capture };
};
it('accepts a multi-screen candidate above 32 MiB and rejects growth beyond 64 MiB', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new-blank' });
  await value.invoke('portal_start', { planId: plan.planId });
  const next = await value.invoke('portal_next', { runId: plan.planId });
  // Seed durable size accounting to exercise the aggregate boundary without allocating 64 MiB.
  const seed = (total: number) =>
    value.store.update('runs', plan.planId, PortalRunSchema, run => ({
      ...run,
      files: Array.from({ length: 8 }, (_, index) => ({
        path: `public/photo-${index}.png`,
        action: 'create' as const,
        baseHash: null,
        contentHash: storedChecksum(`photo-${index}`),
        encoding: 'base64' as const,
        artifact: {
          path: `contents/photo-${index}.json`,
          hash: storedChecksum(`photo-${index}`),
          bytes: total / 8,
        },
      })),
    }));
  const content = 'export {};';
  const args = {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    blueprintHash: plan.blueprintHash,
    contextHash: plan.contextHash,
    files: [
      {
        path: 'src/main.ts',
        action: 'create',
        baseHash: null,
        content,
        contentHash: storedChecksum(content),
      },
    ],
  };
  await seed(40 * 1024 * 1024);
  expect((await value.invoke('portal_submit', args)).state).toBe('generating');
  await seed(64 * 1024 * 1024);
  await expect(value.invoke('portal_submit', args)).rejects.toMatchObject({
    code: 'PORTAL_CANDIDATE_LIMIT',
  });
}, 60_000);
it('returns evidence without a lease for a draft operational blueprint and starts its confirmed replacement', async () => {
  const value = await setup();
  await mkdir(join(value.workspaceRoot, 'legacy'));
  await writeFile(join(value.workspaceRoot, 'legacy/package.json'), '{}');
  const request = { case: 'legacy', targetPath: 'legacy', services: ['.'] };
  const draft = await value.invoke('portal_plan', request);
  expect(PORTAL_RESULT_SCHEMAS.portal_plan.safeParse(draft).success).toBe(true);
  expect(await value.invoke('portal_start', { planId: draft.planId })).toMatchObject({
    state: 'needs-input',
  });
  const context = await value.invoke('portal_next', { runId: draft.planId });
  expect(context.lease).toBeNull();
  expect(context.generationAttempts).toBe(0);
  expect(context.instruction).toContain('portal_plan');
  const requirements = draft.requirements.map((requirement: { layers: string[] }) => ({
    ...requirement,
    workflow: {
      status: 'confirmed',
      roles: ['visitor'],
      states: ['loading', 'ready', 'error'],
      routes: ['/'],
      apiContracts: [],
      dataContracts: [],
      decisions: requirement.layers.map(layer => ({
        layer,
        action: 'implement',
        evidence: 'Reviewed the fixture manifest and selected design requirements',
      })),
    },
  }));
  const confirmed = await value.invoke('portal_plan', { ...request, requirements });
  expect(confirmed.blueprintHash).not.toBe(draft.blueprintHash);
  expect(await value.invoke('portal_start', { planId: confirmed.planId })).toMatchObject({
    state: 'waiting-agent',
  });
}, 60_000);
it('preserves reconciliation after cancelling an uncertain partial source result', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new' });
  await value.invoke('portal_start', { planId: plan.planId });
  await value.store.update('runs', plan.planId, PortalRunSchema, run => ({
    ...run,
    state: 'outcome-unknown' as const,
    appliedHash: null,
  }));
  expect(await value.invoke('portal_cancel', { runId: plan.planId })).toMatchObject({
    state: 'conflict',
  });
}, 60_000);
it('cancels a reserved validation before native work is registered', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new' });
  await value.invoke('portal_start', { planId: plan.planId });
  await value.store.update('runs', plan.planId, PortalRunSchema, run => ({
    ...run,
    state: 'candidate-ready' as const,
    candidateHash: storedChecksum('candidate'),
  }));
  const authority = await value.coordinator.prepare(
    'portal_validate',
    { runId: plan.planId },
    actor,
    value.workspaceId,
    'validation-gap',
  );
  let reached!: () => void, release!: () => void;
  const atPlan = new Promise<void>(resolve => {
    reached = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const original = value.store.get.bind(value.store);
  let blocked = false;
  vi.spyOn(value.store, 'get').mockImplementation(async (kind, id, schema) => {
    if (kind === 'plans' && !blocked) {
      blocked = true;
      reached();
      await gate;
    }
    return original(kind, id, schema);
  });
  const validating = value.coordinator.execute(
    'portal_validate',
    { runId: plan.planId },
    {
      actor,
      workspaceId: value.workspaceId,
      operationId: 'validation-gap',
      authority,
      signal: new AbortController().signal,
    },
  );
  const outcome = validating.catch(error => error);
  await atPlan;
  const cancelAuthority = await value.coordinator.prepare(
    'portal_cancel',
    { runId: plan.planId },
    actor,
    value.workspaceId,
    'cancel-gap',
  );
  const cancelling = value.coordinator.execute(
    'portal_cancel',
    { runId: plan.planId },
    {
      actor,
      workspaceId: value.workspaceId,
      operationId: 'cancel-gap',
      authority: cancelAuthority,
      signal: new AbortController().signal,
    },
  );
  release();
  expect(await outcome).toMatchObject({ code: 'OPERATION_CANCELLED' });
  expect(await cancelling).toMatchObject({ state: 'cancelled' });
  expect(value.work.validate).not.toHaveBeenCalled();
}, 60_000);
it('resolves C1 to C4, retains the known URL and fences submissions by session/lease/context', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new' });
  expect(plan.implementationScope).toBe('frontend-only');
  expect(plan.design.fileKey).toBe('4IBhv1d8hEclifZQrOYxHS');
  const run = await value.invoke('portal_start', { planId: plan.planId });
  const next = await value.invoke('portal_next', { runId: run.runId });
  const source = 'export const title = "Portal";';
  const args = {
    runId: run.runId,
    ...next.lease,
    blueprintHash: plan.blueprintHash,
    contextHash: plan.contextHash,
    files: [
      {
        path: 'src/app.ts',
        action: 'create',
        baseHash: null,
        content: source,
        contentHash: storedChecksum(source),
      },
    ],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path: 'src/app.ts', hash: storedChecksum(source) }],
        assertionIds: [],
      }),
    ),
    finished: true,
  };
  delete args.expiresAt;
  await expect(
    value.invoke('portal_submit', args, { ...actor, authSessionId: `auth1_${'b'.repeat(43)}` }),
  ).rejects.toMatchObject({ code: 'PORTAL_LEASE_INVALID' });
  expect((await value.invoke('portal_submit', args)).state).toBe('candidate-ready');
  await expect(value.invoke('portal_submit', args)).rejects.toMatchObject({
    code: 'PORTAL_LEASE_INVALID',
  });
  await expect(value.invoke('portal_apply', { runId: run.runId })).rejects.toMatchObject({
    code: 'PORTAL_VALIDATION_REQUIRED',
  });
}, 30_000);
it('keeps status/cancel available if the source workspace is unavailable, without cross-owner access', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new' });
  const run = await value.invoke('portal_start', { planId: plan.planId });
  await rename(value.workspaceRoot, `${value.workspaceRoot}-offline`);
  expect((await value.invoke('portal_status', { runId: run.runId })).state).toBe('waiting-agent');
  await expect(
    value.invoke(
      'portal_status',
      { runId: run.runId },
      { ...actor, actorId: `actor1_${'b'.repeat(43)}` },
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_RUN_NOT_FOUND' });
  expect((await value.invoke('portal_cancel', { runId: run.runId })).state).toBe('cancelled');
  expect(value.work.cancel).toHaveBeenCalledWith(run.runId);
}, 30_000);
it('retains full legacy scope and rejects target directory replacement after planning', async () => {
  const value = await setup();
  await mkdir(join(value.workspaceRoot, 'legacy'));
  await writeFile(
    join(value.workspaceRoot, 'legacy/package.json'),
    '{"dependencies":{"express":"5","pg":"8"}}',
  );
  const result = await value.invoke('portal_plan', { case: 'legacy', targetPath: 'legacy' });
  const plan = await value.store.get('plans', result.planId, PortalPlanSchema);
  expect(plan?.implementationScope).toBe('operational-portal');
  expect(plan?.requiredLayers).toEqual(expect.arrayContaining(['frontend', 'backend', 'database']));
  await rename(join(value.workspaceRoot, 'legacy'), join(value.workspaceRoot, 'legacy-old'));
  await mkdir(join(value.workspaceRoot, 'legacy'));
  await expect(value.invoke('portal_start', { planId: result.planId })).rejects.toMatchObject({
    code: 'PORTAL_ROOT_CHANGED',
  });
  expect(await value.store.get('runs', result.planId, PortalRunSchema)).toBeNull();
}, 30_000);

it('rejects a changed candidate after validation admission without executing its profile', async () => {
  const value = await setup();
  const plan = await value.invoke('portal_plan', { case: 'new' });
  await value.invoke('portal_start', { planId: plan.planId });
  const next = await value.invoke('portal_next', { runId: plan.planId });
  const content = 'export const title="Portal";';
  await value.invoke('portal_submit', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    files: [
      {
        path: 'src/app.ts',
        action: 'create',
        baseHash: null,
        content,
        contentHash: storedChecksum(content),
      },
    ],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path: 'src/app.ts', hash: storedChecksum(content) }],
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const input = { runId: plan.planId },
    operationId = 'admitted-validation';
  const authority = await value.coordinator.prepare(
    'portal_validate',
    input,
    actor,
    value.workspaceId,
    operationId,
  );
  await value.store.update('runs', plan.planId, PortalRunSchema, run => ({
    ...run,
    candidateHash: `sha256:${'b'.repeat(64)}`,
  }));
  await expect(
    value.coordinator.execute('portal_validate', input, {
      actor,
      workspaceId: value.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_CANDIDATE_CHANGED' });
  expect(value.work.validate).not.toHaveBeenCalled();
}, 30_000);
it.each(['waiting-agent', 'candidate-ready', 'outcome-unknown', 'completed'] as const)(
  'inspects signed legacy %s records but fences current work',
  async state => {
    const value = await setup();
    const planned = await value.invoke('portal_plan', { case: 'new-blank' });
    const current = await value.invoke('portal_start', { planId: planned.planId });
    expect(planned.sourceAuthorityVersion).toBe(2);
    expect(current.sourceAuthorityVersion).toBe(2);
    await value.store.update('plans', planned.planId, PortalPlanSchema, plan => {
      delete plan.sourceAuthorityVersion;
      return plan;
    });
    await value.store.update('runs', planned.planId, PortalRunSchema, run => {
      delete run.sourceAuthorityVersion;
      run.state = state;
      return run;
    });
    expect(await value.invoke('portal_status', { runId: planned.planId })).toMatchObject({
      state,
      sourceAuthorityStatus:
        state === 'completed' ? 'historical-completed' : 'legacy-replan-required',
    });
    for (const name of ['portal_next', 'portal_validate', 'portal_apply', 'portal_resume'] as const)
      await expect(value.invoke(name, { runId: planned.planId })).rejects.toMatchObject({
        code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
      });
    expect(await value.invoke('portal_cancel', { runId: planned.planId })).toMatchObject({
      state:
        state === 'completed'
          ? 'completed'
          : state === 'outcome-unknown'
            ? 'conflict'
            : 'cancelled',
    });
  },
  30000,
);
it('rejects unknown future signed authority with a stable error', async () => {
  const value = await setup(),
    plan = await value.invoke('portal_plan', { case: 'new-blank' });
  await value.invoke('portal_start', { planId: plan.planId });
  await value.store.update('runs', plan.planId, z.any(), run => ({
    ...run,
    sourceAuthorityVersion: 3,
  }));
  await expect(value.invoke('portal_status', { runId: plan.planId })).rejects.toMatchObject({
    code: 'PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED',
  });
});
it('delivers distinct qualified byte-inventory evidence and explicitly refuses binary text and excluded credentials', async () => {
  const value = await setup();
  for (const root of ['ref-a', 'ref-b']) {
    await mkdir(join(value.workspaceRoot, root));
    await writeFile(
      join(value.workspaceRoot, root, 'schema.graphql'),
      `type Query { ${root === 'ref-a' ? 'first' : 'second'}: Boolean }`,
    );
    await writeFile(join(value.workspaceRoot, root, 'opaque.bin'), Buffer.from([0, 1, 2]));
    await writeFile(join(value.workspaceRoot, root, '.env'), 'PASSWORD=secret');
  }
  const plan = await value.invoke('portal_plan', {
    case: 'new-reference',
    references: ['ref-a', 'ref-b'].map(rootPath => ({ workspaceId: value.workspaceId, rootPath })),
  });
  await value.invoke('portal_start', { planId: plan.planId });
  const evidence = [
    { sourceIndex: 0, path: 'schema.graphql' },
    { sourceIndex: 1, path: 'schema.graphql' },
  ];
  const next = await value.invoke('portal_next', { runId: plan.planId, evidence });
  expect(PORTAL_RESULT_SCHEMAS.portal_next.safeParse(next).success).toBe(true);
  expect(next.evidence).toHaveLength(2);
  expect(next.evidence[0].sourceId).not.toBe(next.evidence[1].sourceId);
  expect(next.evidence.map((row: any) => row.rootPath)).toEqual(['ref-a', 'ref-b']);
  expect(next.sourceInventory[0].files.some((file: any) => file.path === 'opaque.bin')).toBe(true);
  expect(next.evidence[0].sourceId).toBe(next.sourceInventory[0].sourceId);
  for (const [path, code] of [
    ['opaque.bin', 'PORTAL_SOURCE_TEXT_EVIDENCE_UNSUPPORTED'],
    ['.env', 'PORTAL_SOURCE_EVIDENCE_NOT_INCLUDED'],
  ])
    await expect(
      value.invoke('portal_next', { runId: plan.planId, evidence: [{ sourceIndex: 0, path }] }),
    ).rejects.toMatchObject({ code });
}, 30000);

it('inspects legacy partial recovery without mutating or promoting historical authority', async () => {
  const value = await setup();
  const planned = await value.invoke('portal_plan', { case: 'new-blank' });
  await value.invoke('portal_start', { planId: planned.planId });
  const state = 'outcome-unknown' as const;
  await value.store.update('plans', planned.planId, PortalPlanSchema, plan => {
    delete plan.sourceAuthorityVersion;
    return plan;
  });
  await value.store.update('runs', planned.planId, PortalRunSchema, run => {
    delete run.sourceAuthorityVersion;
    run.state = state;
    return run;
  });
  value.work.reconcile = vi.fn<NonNullable<PortalWorkPort['reconcile']>>(async () => ({
    state: 'partial' as const,
    files: [{ path: 'app.js', state: 'candidate' as const }],
  }));
  const before = await value.store.get('runs', planned.planId, PortalRunSchema);
  expect(
    await value.invoke('portal_resume', { runId: planned.planId, reconcile: 'inspect' }),
  ).toMatchObject({
    state,
    issues: expect.arrayContaining([
      'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
      'RECONCILIATION_PARTIAL',
    ]),
  });
  expect(await value.store.get('runs', planned.planId, PortalRunSchema)).toEqual(before);
  await expect(
    value.invoke('portal_resume', { runId: planned.planId, reconcile: 'continue' }),
  ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED' });
});

const writeProject = async (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
};
it('uses qualified web to API to database closure and excludes a proven unrelated jobs package', async () => {
  const value = await setup();
  await writeProject(join(value.workspaceRoot, 'legacy'), {
    'package.json': '{"workspaces":["web","api","db","jobs"]}',
    'web/package.json': '{"name":"web","dependencies":{"react":"1"}}',
    'web/main.ts':
      "fetch('/api/documents'); const ordinary={get:(x:string)=>x}; ordinary.get('/not-api');",
    'api/package.json': '{"name":"api","dependencies":{"express":"1"}}',
    'api/main.ts':
      "import express from 'express'; import '../db/main.js'; const app=express(); app.get('/api/documents',()=>{});",
    'db/package.json': '{"name":"db"}',
    'db/main.ts':
      "import {DatabaseSync} from 'node:sqlite'; export const db=new DatabaseSync('local.sqlite');",
    'jobs/package.json': '{"name":"jobs","dependencies":{"bullmq":"1"}}',
    'jobs/main.ts': "import {Queue} from 'bullmq'; export const jobs=new Queue('jobs');",
    'portal.routes.json': JSON.stringify({
      version: 1,
      services: [
        { rootPath: 'web', deploymentId: 'portal' },
        { rootPath: 'api', deploymentId: 'portal', origin: 'http://localhost:3000' },
      ],
    }),
  });
  const planned = await value.invoke('portal_plan', {
    case: 'legacy',
    targetPath: 'legacy',
    services: ['web'],
  });
  expect(planned.selectedClosure.complete).toBe(true);
  expect(
    planned.selectedClosure.closure.map((item: { rootPath: string }) => item.rootPath).toSorted(),
  ).toEqual(['api', 'db', 'web']);
  expect(planned.requiredLayers).toEqual(
    expect.arrayContaining(['frontend', 'backend', 'api', 'database']),
  );
  expect(planned.requiredLayers).not.toContain('jobs');
  const graph = (await value.store.get('plans', planned.planId, PortalPlanSchema))!.profiles[0]!
    .graph;
  expect(graph.connections!.producers.map(item => item.route)).toEqual(['/api/documents']);
  expect(graph.connections!.clients.map(item => item.route)).toEqual(['/api/documents']);
  expect(graph.connections!.connections.some(item => item.kind === 'http-contract')).toBe(true);
  expect(graph.edges.some(edge => edge.to === '/not-api')).toBe(false);
});
it('requires qualified selectors for identical roots in distinct references', async () => {
  const value = await setup();
  await writeProject(join(value.workspaceRoot, 'reference-a'), {
    'package.json': '{}',
    'main.ts': 'export const a=1;',
  });
  await writeProject(join(value.workspaceRoot, 'reference-b'), {
    'package.json': '{}',
    'main.ts': 'export const b=2;',
  });
  const base = {
    case: 'new-reference',
    references: [
      { workspaceId: value.workspaceId, rootPath: 'reference-a' },
      { workspaceId: value.workspaceId, rootPath: 'reference-b' },
    ],
  };
  await expect(value.invoke('portal_plan', { ...base, services: ['.'] })).rejects.toMatchObject({
    code: 'PORTAL_SERVICE_SELECTION_AMBIGUOUS',
  });
  const discover = await value.invoke('portal_plan', base);
  const selected = discover.selectedClosure.selected[1];
  expect(selected.sourceId).not.toBe(discover.selectedClosure.selected[0].sourceId);
  const exact = await value.invoke('portal_plan', { ...base, services: [selected] });
  expect(exact.selectedClosure.closure).toEqual([selected]);
  await expect(
    value.invoke('portal_plan', { ...base, services: [{ ...selected, sourceIndex: 0 }] }),
  ).rejects.toMatchObject({ code: 'PORTAL_SERVICE_NOT_FOUND' });
});
it('blocks unproven routing before a lease and admits only exact semantic review with all services retained', async () => {
  const value = await setup();
  await writeProject(join(value.workspaceRoot, 'legacy'), {
    'package.json': '{}',
    'main.ts': "fetch('/documents');",
    'sibling/package.json': '{}',
    'sibling/main.ts': 'export const value=1;',
  });
  const request = { case: 'legacy', targetPath: 'legacy', services: ['.'] };
  const draft = await value.invoke('portal_plan', request);
  expect(draft.selectedClosure.complete).toBe(false);
  await value.invoke('portal_start', { planId: draft.planId });
  expect((await value.invoke('portal_next', { runId: draft.planId })).lease).toBeNull();
  const issue = draft.selectedClosure.connections[0].issues.find(
    (item: { code: string }) => item.code === 'PROVIDER_UNRESOLVED',
  );
  const review = {
    ...issue.evidence,
    sourceIndex: 0,
    issue: issue.code,
    decision: 'retain-conservative-closure',
    layers: ['frontend'],
    conclusion:
      'Reviewed the exact fetch call and retain all potential service providers conservatively',
  };
  delete review.reason;
  const accepted = await value.invoke('portal_plan', { ...request, sourceReviews: [review] });
  expect(accepted.selectedClosure.complete).toBe(true);
  expect(
    accepted.selectedClosure.closure.map((item: { rootPath: string }) => item.rootPath).toSorted(),
  ).toEqual(['.', 'sibling']);
  await expect(
    value.invoke('portal_plan', {
      ...request,
      sourceReviews: [{ ...review, hash: storedChecksum('different') }],
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_REVIEW_NOT_BOUND' });
  await writeFile(join(value.workspaceRoot, 'legacy/main.ts'), 'export const = broken');
  await expect(
    value.invoke('portal_plan', {
      ...request,
      sourceReviews: [
        {
          ...review,
          issue: 'AST_ERRORS',
          hash: storedChecksum('export const = broken'),
          offset: 0,
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_REVIEW_NOT_BOUND' });
});
it('keeps an unknown interaction unresolved despite confirmed prose until an exact workflow decision exists', async () => {
  const value = await setup({
    nodes: [
      {
        id: '0:1',
        type: 'FRAME',
        name: 'Workspace',
        children: [
          {
            id: '1:2',
            name: 'Teleport',
            type: 'COMPONENT',
            componentPropertyDefinitions: {},
            reactions: [
              {
                trigger: { type: 'ON_CLICK' },
                action: { type: 'NODE', destinationId: '0:1', navigation: 'NAVIGATE' },
              },
            ],
          },
        ],
      },
    ],
  });
  const requirement = {
    id: 'teleport',
    description: 'Navigate to the target workspace',
    layers: ['frontend'],
    required: true,
    workflow: {
      status: 'confirmed',
      roles: ['visitor'],
      states: ['ready', 'target'],
      routes: ['/'],
      apiContracts: [],
      dataContracts: [],
      decisions: [
        {
          layer: 'frontend',
          action: 'implement',
          evidence: 'Implement navigation to the selected workspace screen',
        },
      ],
    },
  };
  const draft = await value.invoke('portal_plan', {
    case: 'new-blank',
    requirements: [requirement],
  });
  expect(draft.workflowCoverage.complete).toBe(false);
  await value.invoke('portal_start', { planId: draft.planId });
  expect((await value.invoke('portal_next', { runId: draft.planId })).lease).toBeNull();
  const scope = draft.workflowCoverage.scopes.find(
    (item: { status: string }) => item.status === 'unresolved',
  );
  const decision = {
    analysisHash: draft.workflowCoverage.analysisHash,
    evidenceId: scope.evidenceIds[0],
    requirementIds: ['teleport'],
    decision: 'implement',
    rationale: 'Implement the exact observed teleport navigation with a route and state assertion',
  };
  const ready = await value.invoke('portal_plan', {
    case: 'new-blank',
    requirements: [requirement],
    workflowDecisions: [decision],
  });
  expect(ready.workflowCoverage.complete).toBe(true);
  expect((await value.invoke('portal_start', { planId: ready.planId })).state).toBe(
    'waiting-agent',
  );
  await expect(
    value.invoke('portal_plan', {
      case: 'new-blank',
      requirements: [requirement],
      workflowDecisions: [{ ...decision, analysisHash: storedChecksum('old') }],
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_WORKFLOW_DECISION_NOT_BOUND' });
});
it('fences old graph interpretation despite current byte authority while preserving status', async () => {
  const value = await setup();
  const planned = await value.invoke('portal_plan', { case: 'new-blank' });
  await value.invoke('portal_start', { planId: planned.planId });
  await value.store.update('plans', planned.planId, PortalPlanSchema, plan => {
    delete plan.analysisVersion;
    delete plan.serviceSelection;
    delete plan.workflowCoverage;
    return plan;
  });
  expect((await value.invoke('portal_status', { runId: planned.planId })).state).toBe(
    'waiting-agent',
  );
  for (const name of ['portal_next', 'portal_apply', 'portal_validate'] as const)
    await expect(value.invoke(name, { runId: planned.planId })).rejects.toMatchObject({
      code: 'PORTAL_ANALYSIS_REPLAN_REQUIRED',
    });
});

it('pages large collection and selected style catalogs through the actual coordinator result contract', async () => {
  const value = await setup({
    nodes: [{ id: '0:1', name: 'Welcome', type: 'FRAME' }],
    collections: Array.from({ length: 400 }, (_, index) => ({
      id: `collection-${index}`,
      name: `Collection ${index}`,
      modes: [],
    })),
    styles: {
      paints: Array.from({ length: 300 }, (_, index) => ({
        id: `paint-${index}`,
        name: `Paint ${index}`,
        paints: [],
      })),
      texts: [],
      effects: [],
      grids: [],
    },
  });
  const plan = await value.invoke('portal_plan', { case: 'new-blank' });
  await value.invoke('portal_start', { planId: plan.planId });
  const result = await value.invoke('portal_next', {
    runId: plan.planId,
    collectionOffset: 300,
    styleFamily: 'paints',
    styleOffset: 200,
  });
  expect(PORTAL_RESULT_SCHEMAS.portal_next.safeParse(result).success).toBe(true);
  expect(result.designEvidence.totalCollections).toBe(400);
  expect(result.designEvidence.collections[0].id).toBe('collection-300');
  expect(result.designEvidence.nextCollectionOffset).toBeNull();
  expect(result.designEvidence.styles).toMatchObject({
    family: 'paints',
    availability: 'available',
    total: 300,
    nextOffset: null,
  });
  expect(result.designEvidence.styles.rows[0].id).toBe('paint-200');
});
it('keeps document persistence, form failures and source integration evidence while a local dashboard stays read-only', async () => {
  const value = await setup({
    nodes: [
      {
        id: '0:1',
        name: 'Documents',
        type: 'FRAME',
        children: [
          {
            id: '1:2',
            name: 'Create document',
            type: 'COMPONENT',
            componentPropertyDefinitions: {},
            reactions: [
              {
                trigger: { type: 'ON_CLICK' },
                actions: [{ type: 'NODE', destinationId: '0:1', navigation: 'NAVIGATE' }],
              },
            ],
          },
        ],
      },
    ],
  });
  await writeProject(join(value.workspaceRoot, 'reference'), {
    'package.json': '{}',
    'main.ts': 'export const title="Documents";',
  });
  const docs = await value.invoke('portal_plan', {
    case: 'new-reference',
    references: [{ workspaceId: value.workspaceId, rootPath: 'reference' }],
  });
  expect(docs.requiredLayers).toContain('database');
  expect(
    docs.workflowCoverage.evidence.some((entry: { nodeId: string }) => entry.nodeId === '1:2'),
  ).toBe(true);
  const readOnly = await setup({ nodes: [{ id: '0:1', name: 'Dashboard', type: 'FRAME' }] });
  await writeProject(join(readOnly.workspaceRoot, 'reference'), {
    'package.json': '{}',
    'main.ts': 'export const rows=[1,2];',
  });
  const dashboard = await readOnly.invoke('portal_plan', {
    case: 'new-reference',
    references: [{ workspaceId: readOnly.workspaceId, rootPath: 'reference' }],
  });
  expect(dashboard.requiredLayers).not.toContain('database');
  expect(dashboard.requiredLayers).not.toContain('authentication');
  const form = await setup({
    nodes: [
      {
        id: '0:1',
        name: 'Contact form',
        type: 'FRAME',
        children: [
          { id: 'email', type: 'INPUT', name: 'Email' },
          { id: 'error', type: 'TEXT', characters: 'Email is required' },
          {
            id: '1:2',
            name: 'Submit',
            type: 'COMPONENT',
            componentPropertyDefinitions: {},
            reactions: [
              {
                trigger: { type: 'ON_CLICK' },
                actions: [{ type: 'NODE', destinationId: 'error' }],
              },
            ],
          },
        ],
      },
    ],
  });
  await writeProject(join(form.workspaceRoot, 'reference'), {
    'package.json': '{"dependencies":{"nodemailer":"1"}}',
    'main.ts': "import nodemailer from 'nodemailer'; export const mail=nodemailer;",
  });
  const integrated = await form.invoke('portal_plan', {
    case: 'new-reference',
    references: [{ workspaceId: form.workspaceId, rootPath: 'reference' }],
  });
  expect(integrated.requiredLayers).toContain('integration');
  expect(
    (await form.store.get('plans', integrated.planId, PortalPlanSchema))!.profiles[0]!.graph
      .services[0]!.evidence,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'declared-external-module', detail: 'nodemailer' }),
    ]),
  );
  expect(
    integrated.workflowCoverage.issues.every(
      (issue: string) =>
        issue.startsWith('WORKFLOW_SCOPE_UNRESOLVED:') ||
        issue.startsWith('WORKFLOW_BLUEPRINT_REQUIRED:'),
    ),
  ).toBe(true);
  expect(integrated.workflowCoverage.evidence).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'source' })]),
  );
  expect(
    integrated.requirements.some((entry: { workflow?: { states: string[] } }) =>
      entry.workflow?.states.includes('validation-error'),
    ),
  ).toBe(true);
});

it.each(['capture', 'design-publication'] as const)(
  'records elapsed time from the actual %s stage start',
  async stage => {
    let time = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => time);
    try {
      const value = await setup(undefined, () => {
        time = 2400;
        if (stage === 'capture') throw Error('untyped failure');
      });
      if (stage === 'design-publication') {
        const create = value.store.create.bind(value.store);
        vi.spyOn(value.store, 'create').mockImplementation(async (...args) => {
          if (args[0] === 'designs') {
            time = 5100;
            throw Error('publication failure');
          }
          return create(...args);
        });
      }
      const plan = await value.invoke('portal_plan', { case: 'new-blank' });
      expect(plan.design.captureFailure).toMatchObject({
        stage,
        elapsedMs: stage === 'capture' ? 1400 : 2700,
      });
    } finally {
      clock.mockRestore();
    }
  },
);

it('requires qualified source evidence for reference pattern reuse and rejects unselected siblings', async () => {
  const value = await setup();
  await writeProject(join(value.workspaceRoot, 'reference'), {
    'package.json': '{}',
    'main.ts': 'export const title="Portal";',
    'other/package.json': '{}',
    'other/main.ts': 'export const title="Other";',
  });
  const request = {
    case: 'new-reference',
    references: [{ workspaceId: value.workspaceId, rootPath: 'reference' }],
    services: ['.'],
  };
  const requirement = {
    id: 'title',
    description: 'Reuse the existing title pattern',
    required: true,
    layers: ['frontend'],
    workflow: {
      status: 'confirmed',
      roles: ['visitor'],
      states: ['visible'],
      routes: ['/'],
      apiContracts: [],
      dataContracts: [],
      decisions: [
        {
          layer: 'frontend',
          action: 'present',
          evidence: 'Reuse the existing component structure from the selected service',
        },
      ],
    },
  };
  const draft = await value.invoke('portal_plan', { ...request, requirements: [requirement] });
  expect(draft.workflowCoverage.complete).toBe(false);
  expect((await value.invoke('portal_start', { planId: draft.planId })).state).toBe('needs-input');
  const selector = draft.selectedClosure.selected[0];
  const confirmed = {
    ...requirement,
    workflow: {
      ...requirement.workflow,
      decisions: [
        {
          ...requirement.workflow.decisions[0],
          sourceEvidence: [
            {
              sourceId: selector.sourceId,
              sourceIndex: 0,
              path: 'main.ts',
              hash: storedChecksum('export const title="Portal";'),
            },
          ],
        },
      ],
    },
  };
  const ready = await value.invoke('portal_plan', { ...request, requirements: [confirmed] });
  expect(ready.workflowCoverage.complete).toBe(true);
  const wrong = {
    ...confirmed,
    workflow: {
      ...confirmed.workflow,
      decisions: [
        {
          ...confirmed.workflow.decisions[0],
          sourceEvidence: [
            {
              sourceId: selector.sourceId,
              sourceIndex: 0,
              path: 'other/main.ts',
              hash: storedChecksum('export const title="Other";'),
            },
          ],
        },
      ],
    },
  };
  await expect(
    value.invoke('portal_plan', { ...request, requirements: [wrong] }),
  ).rejects.toMatchObject({ code: 'PORTAL_WORKFLOW_SOURCE_EVIDENCE_NOT_BOUND' });
});

it.each([512, 513])(
  'preserves diagnostic completeness with %s uncertainties and returns a bounded draft',
  async count => {
    const value = await setup();
    await writeProject(join(value.workspaceRoot, 'legacy'), {
      'package.json': '{}',
      'main.ts': Array.from({ length: count }, (_, index) => `fetch('/api',options${index});`).join(
        '\n',
      ),
    });
    const request = { case: 'legacy', targetPath: 'legacy' };
    const authority = await value.coordinator.prepare(
      'portal_plan',
      request,
      actor,
      value.workspaceId,
      'inspect-limit',
    );
    const root = authority.roots[0]!;
    const graph = await analyzeServiceGraph(
      new RepoReader({
        rootDir: root.path,
        workspaceId: root.workspaceId,
        workspacePolicy: value.policy,
      }),
      qualifiedPortalSourceId({ ...root, canonicalPath: root.path }),
    );
    const sourceReviews = graph.connections!.issues.map(issue => ({
      sourceId: graph.sourceId,
      sourceIndex: 0,
      path: issue.evidence!.path,
      hash: issue.evidence!.hash,
      offset: issue.evidence!.offset,
      issue: issue.code,
      decision: 'retain-conservative-closure',
      layers: ['frontend'],
      conclusion:
        'Reviewed the exact call and retain the complete source service closure conservatively',
    }));
    const reviewed = await value.invoke('portal_plan', { ...request, sourceReviews });
    expect(reviewed.selectedClosure.complete).toBe(count === 512);
    expect(
      reviewed.selectedClosure.issues.includes(`SERVICE_DIAGNOSTICS_TRUNCATED:${graph.sourceId}`),
    ).toBe(count === 513);
    const draft = await value.invoke('portal_plan', request);
    expect(PORTAL_RESULT_SCHEMAS.portal_plan.safeParse(draft).success).toBe(true);
    expect(draft.issues.length).toBeLessThanOrEqual(512);
    expect(draft.selectedClosure.complete).toBe(false);
  },
);
it.each([false, true])(
  'uses auxiliary authentication evidence only when imported by runtime code: %s',
  async imported => {
    const value = await setup({ nodes: [{ id: '0:1', name: 'Dashboard', type: 'FRAME' }] });
    await writeProject(join(value.workspaceRoot, 'reference'), {
      'package.json': JSON.stringify({
        dependencies: { react: '19' },
        devDependencies: { jsonwebtoken: '1' },
      }),
      'main.ts': imported
        ? "export {identity} from './tests/mail.test.js';"
        : 'export const localData=[1,2,3];',
      'tests/mail.test.ts':
        "import jsonwebtoken from 'jsonwebtoken'; export const identity=jsonwebtoken;",
    });
    const planned = await value.invoke('portal_plan', {
      case: 'new-reference',
      references: [{ workspaceId: value.workspaceId, rootPath: 'reference' }],
    });
    const evidence = planned.workflowCoverage.evidence.filter(
      (entry: { kind: string; path?: string }) =>
        entry.kind === 'source' && entry.path === 'tests/mail.test.ts',
    );
    expect(planned.requiredLayers.includes('authentication')).toBe(imported);
    expect(planned.requiredLayers.includes('authorization')).toBe(imported);
    expect(evidence.length > 0).toBe(imported);
  },
);
it.each([false, true])(
  'retains observed C4 form error states when refinement includes workflow: %s',
  async explicit => {
    const value = await setup({
      nodes: [
        {
          id: '0:1',
          name: 'Contact form',
          type: 'FRAME',
          children: [
            {
              id: '1:1',
              name: 'Submit',
              type: 'COMPONENT',
              componentPropertyDefinitions: {},
              reactions: [
                {
                  trigger: { type: 'ON_CLICK' },
                  actions: [{ type: 'NODE', destinationId: '0:1', navigation: 'NAVIGATE' }],
                },
              ],
            },
            { id: '1:2', type: 'TEXT', characters: 'Invalid email error' },
          ],
        },
      ],
    });
    const draft = await value.invoke('portal_plan', { case: 'new-blank' });
    const inferred = draft.requirements.find(
      (entry: { id: string }) => entry.id === 'figma-form-submit',
    );
    expect(inferred.workflow.states).toContain('validation-error');
    const refined = await value.invoke('portal_plan', {
      case: 'new-blank',
      requirements: [
        {
          id: inferred.id,
          description: 'Implement the contact form',
          layers: ['frontend'],
          required: true,
          ...(explicit
            ? { workflow: { ...inferred.workflow, states: ['custom-state'], routes: ['/contact'] } }
            : {}),
        },
      ],
    });
    const actual = refined.requirements.find((entry: { id: string }) => entry.id === inferred.id);
    expect(actual.workflow.states).toContain('validation-error');
    expect(actual.workflow.states.includes('custom-state')).toBe(explicit);
    expect(actual.workflow.routes.includes('/contact')).toBe(explicit);
    expect(refined.workflowCoverage.complete).toBe(true);
    expect((await value.invoke('portal_start', { planId: refined.planId })).state).toBe(
      'waiting-agent',
    );
  },
);
