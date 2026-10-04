import {
  contentHash,
  PortalPlanSchema,
  PortalRunSchema,
  storedChecksum,
  portalCompletionIssues,
} from '@sfp/ir';
import {
  NO_CAPTURE_OPTIONS,
  PortalAcceptanceSchema,
  type ActorContext,
  type PortalToolName,
  type RuntimeExecutionScope,
} from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import { portalNativeDeadline } from '../../src/portal/native-resources.js';
import {
  PortalCoreLifecycle,
  coreDeclarationsHash,
} from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
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

async function fixture() {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const captured = await currentCaptureFixture(f);
  let time = Date.now();
  const work: PortalWorkPort = {
    prepareValidation: async () => ({
      hash: contentHash('test-environment', {}),
      resources: [{ key: 'portal:test-environment', mode: 'write' }],
    }),
    validate: vi.fn<PortalWorkPort['validate']>(),
    apply: vi.fn<PortalWorkPort['apply']>(),
    cancel: vi.fn<PortalWorkPort['cancel']>(async () => {}),
    reconcile: vi.fn<NonNullable<PortalWorkPort['reconcile']>>(async () => ({
      state: 'applied',
      files: [],
    })),
  };
  const issuer = operationIdIssuerFromKey(f.key);
  const journal = new OperationJournal({ stateRoot: f.stateRoot, actorId: actor.actorId });
  await journal.recover();
  const queue = new FileExecutionQueue();
  const preparations = new CorePreparations(f);
  const lifecycle = new PortalCoreLifecycle(preparations);
  const coordinator: PortalCoordinator = new PortalCoordinator(
    f.store,
    f.policy,
    work,
    () => time,
    { capture: async () => captured.captured },
    (principal, runId) => executor.cancelPendingPortalRun(principal, runId),
    lifecycle,
  );
  const executor: OperationExecutor = new OperationExecutor({
    issuer,
    journal,
    queue,
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async () => {
          throw Error('No plugin access');
        },
      },
      {
        execute: async (scope, name, input, signal, _plugin, _reporter, action) =>
          coordinator.execute(name as PortalToolName, input, {
            actor: scope.actor,
            workspaceId: f.workspaceId,
            operationId: action!.operationId,
            authority: scope.portalAuthority!,
            signal,
          }),
      },
    ),
  });
  const prepare = async (name: PortalToolName, input: unknown) => {
    const operationId = issuer.issue(actor.actorId, Date.now());
    const authority = await coordinator.prepare(name, input, actor, f.workspaceId, operationId);
    authority.captureSource = captured.grant;
    return { operationId, authority };
  };
  const direct = async (name: PortalToolName, input: unknown) => {
    const prepared = await prepare(name, input);
    return coordinator.execute(name, input, {
      actor,
      workspaceId: f.workspaceId,
      ...prepared,
      signal: new AbortController().signal,
    }) as Promise<Record<string, unknown>>;
  };
  const invoke = async (
    name: PortalToolName,
    input: unknown,
    admitted?: Awaited<ReturnType<typeof prepare>>,
  ) => {
    const prepared = admitted ?? (await prepare(name, input));
    const scope: RuntimeExecutionScope = {
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      leaderGeneration: 'generation-test',
      actor,
      workspace: { workspaceId: f.workspaceId, workspaceRoot: f.workspaceRoot },
      target: {
        sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
        pluginGeneration: 'plugin-g1',
        fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
        fileExecutionKey: 'figma:file-a',
      },
      consent: {
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      },
      portalAuthority: prepared.authority,
    };
    return executor.invokeTool(scope, name, input, prepared.operationId, NO_CAPTURE_OPTIONS);
  };
  const planned = await direct('portal_plan', { case: 'new-blank' });
  const runId = planned.planId as string;
  await direct('portal_start', { planId: runId });
  const candidateHash = storedChecksum('candidate');
  const validation = PortalAcceptanceSchema.parse({
    sourceAuthorityVersion: 2,
    sourceHash: candidateHash,
    designHash: null,
    environmentId: 'reviewed-precondition',
    checks: [{ id: 'build', kind: 'build', status: 'passed', required: true, requirementIds: [] }],
    liveDesignVerified: false,
    runtimeVerified: false,
    evidencePaths: [],
  });
  // A signed ready state is the precondition under test; this fixture does not claim native acceptance.
  await f.store.update('runs', runId, PortalRunSchema, run => ({
    ...run,
    state: 'ready-to-apply' as const,
    candidateHash,
    validation,
  }));
  const plan = (await f.store.get('plans', runId, PortalPlanSchema))!;
  const state = () => f.store.get('runs', runId, PortalRunSchema);
  return {
    ...f,
    coordinator,
    preparations,
    lifecycle,
    work,
    executor,
    journal,
    prepare,
    direct,
    invoke,
    state,
    runId,
    plan,
    candidateHash,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

it('completed applied validation releases exact plan and run core dependencies at the native acceptance report seam', async () => {
  const f = await fixture();
  const scope = { ownerId: f.plan.ownerId, workspaceId: f.plan.workspaceId };
  const core = f.plan.coreRecipes!;
  const preparationId = core.preparationId!;
  const before = await f.preparations.inspect(scope, preparationId);
  expect(before.dependencies.toSorted()).toEqual([`plan:${f.runId}`, `run:${f.runId}`].toSorted());
  const evidence = await f.lifecycle.view(scope, core);
  const declarations = evidence.workItems.map(item => ({
    resultId: item.resultId,
    resultHash: item.resultHash,
    outputItemId: item.id,
    kind: item.kind,
    files: [{ path: 'fixture-native-acceptance.ts', hash: f.candidateHash }],
    assertionIds: [],
  }));
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    state: 'applied-awaiting-validation' as const,
    appliedHash: f.candidateHash,
    coreDeclarations: declarations,
    coreDeclarationsHash: coreDeclarationsHash(declarations),
  }));
  const initial = (await f.state())!;
  const seamHash = contentHash('test-native-acceptance-report-seam', { runId: f.runId });
  // Only this controlled WorkPort report stands in for native acceptance. No browser, FE build,
  // applied filesystem, module receipt or source consumption is proved by this coordinator test.
  const report = PortalAcceptanceSchema.parse({
    sourceAuthorityVersion: 2,
    sourceHash: f.candidateHash,
    designHash: f.plan.design.artifactHash,
    environmentId: 'fixture-native-acceptance-report-seam',
    runtimeVerified: true,
    liveDesignVerified: true,
    checks: [
      'build',
      'typecheck',
      'interaction',
      'accessibility',
      'visual',
      'source-scope',
      'independence',
    ].map(kind => ({
      id: `fixture-${kind}`,
      kind,
      status: 'passed',
      required: true,
      requirementIds: f.plan.requirements.map(requirement => requirement.id),
    })),
    evidencePaths: [],
    analysisHash: contentHash('sfp-portal-analysis-receipt-v1', {
      selection: f.plan.serviceSelection,
      coverage: f.plan.workflowCoverage,
    }),
    capture: {
      version: 2,
      originalDescriptorHash: contentHash(
        'sfp-portal-capture-descriptor-v2',
        f.plan.design.capture,
      ),
      freshDesignFingerprint: f.plan.design.capture!.designFingerprint,
    },
    observations: {
      version: 1,
      manifestHash: seamHash,
      receiptHash: seamHash,
      interactionContractHash: contentHash(
        'sfp-interaction-contract-v1',
        f.plan.interactionContract,
      ),
      executedObservationIds: ['fixture-native-seam-root'],
      executedAssertionIds: f.plan.interactionContract!.interactions.map(value => value.id),
      executedWorkflowIds: f.plan.interactionContract!.workflowIds,
    },
    nativeEnvironment: {
      version: 1,
      attemptId: seamHash.slice(7),
      executionHash: seamHash,
      receiptHash: seamHash,
      target: 'applied',
      disposition: 'retained-artifact',
    },
    nativeArtifactAuthority: {
      version: 1,
      manifestHash: seamHash,
      outputReceiptHash: seamHash,
      moduleFenceProtocol: 'sfp-native-module-fence-v1',
      moduleEvidenceHash: seamHash,
    },
    recipeConsumption: {
      recipeAuthorityVersion: 1,
      ownerId: f.plan.ownerId,
      workspaceId: f.plan.workspaceId,
      contextHash: core.contextHash,
      blueprintHash: f.plan.blueprintHash,
      candidateHash: f.candidateHash,
      target: 'applied',
      verifierVersion: 'core-consumption-v1',
      resultHashes: core.requiredResults.map(value => value.resultHash),
      declarationsHash: initial.coreDeclarationsHash,
      findings: [
        {
          kind: 'review',
          decision: 'accepted',
          reviewerId: f.plan.ownerId,
          rationale:
            'Controlled native acceptance report seam for terminal dependency lifecycle only.',
          sourceHashes: [seamHash],
          evidenceHash: seamHash,
        },
      ],
    },
  });
  expect(portalCompletionIssues(f.plan, report, f.candidateHash, initial, 'applied')).toEqual([]);
  f.work.validate = vi.fn<PortalWorkPort['validate']>(async () => report);
  expect(await f.invoke('portal_validate', { runId: f.runId, target: 'applied' })).toMatchObject({
    state: 'completed',
    appliedHash: f.candidateHash,
  });
  const completed = (await f.state())!;
  expect(completed).toMatchObject({
    state: 'completed',
    appliedHash: f.candidateHash,
    validation: report,
  });
  expect((await f.preparations.inspect(scope, preparationId)).dependencies).toEqual([]);
  expect(await f.invoke('portal_resume', { runId: f.runId, reconcile: 'none' })).toMatchObject({
    state: 'completed',
    appliedHash: f.candidateHash,
  });
  expect(await f.state()).toMatchObject({
    state: 'completed',
    lease: null,
    leaseEpoch: completed.leaseEpoch,
    validation: report,
  });
  expect((await f.preparations.inspect(scope, preparationId)).dependencies).toEqual([]);
  expect(f.work.validate).toHaveBeenCalledTimes(1);
  expect(f.work.reconcile).not.toHaveBeenCalled();
}, 30000);

it('production executor queues resume against active validation while cancellation preserves its fence', async () => {
  const f = await fixture();
  let reached!: () => void;
  const started = new Promise<void>(resolve => {
    reached = resolve;
  });
  f.work.validate = async (_plan, _run, _files, signal) => {
    reached();
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  const validating = f.invoke('portal_validate', { runId: f.runId }).catch(error => error);
  await started;
  const resumeArgs = { runId: f.runId, reconcile: 'none' };
  const admitted = await f.prepare('portal_resume', resumeArgs);
  const resuming = f.invoke('portal_resume', resumeArgs, admitted).catch(error => error);
  try {
    await vi.waitFor(() => expect(f.journal.get(admitted.operationId)?.status).toBe('queued'));
  } finally {
    await f.invoke('portal_cancel', { runId: f.runId });
    await Promise.all([validating, resuming]);
  }
  expect(await f.state()).toMatchObject({ state: 'cancelled', lease: null });
  expect((await f.state())!.leaseEpoch).toBeGreaterThan(0);
}, 30000);

it('rejects a queued resume whose lease epoch changed after admission', async () => {
  const f = await fixture();
  const args = { runId: f.runId, reconcile: 'none' };
  const admitted = await f.prepare('portal_resume', args);
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    leaseEpoch: run.leaseEpoch + 1,
  }));
  const before = await f.state();
  await expect(f.invoke('portal_resume', args, admitted)).rejects.toMatchObject({
    code: 'PORTAL_RUN_SUPERSEDED',
  });
  expect(await f.state()).toEqual(before);
}, 30000);

it('production executor rejects operation replay with a different retained resume fence', async () => {
  const f = await fixture();
  const args = { runId: f.runId, reconcile: 'none' };
  const first = await f.prepare('portal_resume', args);
  await f.invoke('portal_resume', args, first);
  const second = await f.prepare('portal_resume', args);
  second.operationId = first.operationId;
  await expect(f.invoke('portal_resume', args, second)).rejects.toMatchObject({
    code: 'OPERATION_ID_CONFLICT',
  });
}, 30000);

it('preserves an already retained conflict fence when publication returns a proved result', async () => {
  const f = await fixture();
  f.work.apply = async () => {
    await f.store.update('runs', f.runId, PortalRunSchema, run => ({
      ...run,
      state: 'conflict' as const,
      leaseEpoch: run.leaseEpoch + 1,
      version: run.version + 1,
    }));
    return { hash: f.candidateHash };
  };
  expect(await f.invoke('portal_apply', { runId: f.runId })).toMatchObject({
    state: 'conflict',
    appliedHash: f.candidateHash,
  });
}, 30000);

it('retains the single recovery attempt budget across repeated rejected validation', async () => {
  const f = await fixture();
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    state: 'applied-awaiting-validation' as const,
    appliedHash: f.candidateHash,
  }));
  f.advance(3_600_001);
  f.work.validate = async () => {
    throw Object.assign(Error('Reviewed validation failure'), { code: 'TEST_VALIDATION_REJECTED' });
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    await expect(
      f.invoke('portal_validate', { runId: f.runId, target: 'applied' }),
    ).rejects.toMatchObject({ code: 'TEST_VALIDATION_REJECTED' });
  }
  const before = await f.state();
  await expect(
    f.invoke('portal_validate', { runId: f.runId, target: 'applied' }),
  ).rejects.toMatchObject({ code: 'PORTAL_RECOVERY_BUDGET_EXHAUSTED' });
  expect(await f.state()).toEqual(before);
}, 30000);

it('finishes admitted publication after generation expiry using its retained effect horizon', async () => {
  const f = await fixture();
  const generationDeadline = (await f.state())!.deadlineAt;
  f.advance(3_599_999);
  f.work.apply = async () => {
    f.advance(2);
    return { hash: f.candidateHash };
  };
  expect(await f.invoke('portal_apply', { runId: f.runId })).toMatchObject({
    state: 'applied-awaiting-validation',
  });
  const effect = (await f.state())!.nativeBudget?.effect;
  expect(effect?.deadlineAt).toBe(generationDeadline - 1 + 1_800_000);
  f.work.validate = async () => {
    throw Object.assign(Error('Controlled validation'), { code: 'TEST_VALIDATION_REJECTED' });
  };
  await expect(
    f.invoke('portal_validate', { runId: f.runId, target: 'applied' }),
  ).rejects.toMatchObject({ code: 'TEST_VALIDATION_REJECTED' });
  expect((await f.state())!.nativeBudget).toEqual({
    version: 1,
    effect: { ...effect, attempts: 2 },
  });
  expect((await f.state())!.deadlineAt).toBe(generationDeadline);
}, 30000);

it('resume-none cannot erase a durable cancellation awaiting its owning operation', async () => {
  const f = await fixture();
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    state: 'cancel-requested' as const,
    leaseEpoch: 17,
  }));
  await expect(
    f.direct('portal_resume', { runId: f.runId, reconcile: 'none' }),
  ).rejects.toMatchObject({ code: 'PORTAL_STATE_NOT_RESUMABLE' });
  expect(await f.state()).toMatchObject({ state: 'cancel-requested', leaseEpoch: 17 });
}, 30000);

it.each([
  'pre-effect-rejected',
  'dispatched-outcome-unknown',
  'partial-or-committed',
  undefined,
] as const)(
  'records an honest apply outcome for %s disposition',
  async disposition => {
    const f = await fixture();
    f.work.apply = async () => {
      throw Object.assign(Error('Controlled work-port boundary failure'), {
        code: 'TEST_APPLY_REJECTED',
        ...(disposition ? { applyEffectDisposition: disposition } : {}),
      });
    };
    await expect(f.invoke('portal_apply', { runId: f.runId })).rejects.toMatchObject({
      code: 'TEST_APPLY_REJECTED',
    });
    expect(await f.state()).toMatchObject({
      state: disposition === 'pre-effect-rejected' ? 'ready-to-apply' : 'outcome-unknown',
      appliedHash: null,
    });
    if (disposition === 'pre-effect-rejected') {
      f.work.apply = async () => ({ hash: f.candidateHash });
    }
    const retry =
      disposition === 'pre-effect-rejected'
        ? await f.invoke('portal_apply', { runId: f.runId })
        : undefined;
    expect(retry === undefined ? undefined : (retry as { state: string }).state).toBe(
      disposition === 'pre-effect-rejected' ? 'applied-awaiting-validation' : undefined,
    );
  },
  30000,
);

it('owner resume preserves published work after generation expiry with a bounded recovery admission', async () => {
  const f = await fixture();
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    state: 'applied-awaiting-validation' as const,
    appliedHash: f.candidateHash,
  }));
  f.advance(3_600_001);
  expect(await f.invoke('portal_resume', { runId: f.runId, reconcile: 'none' })).toMatchObject({
    state: 'applied-awaiting-validation',
    appliedHash: f.candidateHash,
  });
  expect((await f.state())!.nativeBudget?.recovery).toEqual({
    deadlineAt: f.now() + 900_000,
    attempts: 1,
  });
}, 30000);

it('admits bounded owner applied validation after generation expiry and never renews the recovery horizon', async () => {
  const f = await fixture();
  await f.store.update('runs', f.runId, PortalRunSchema, run => ({
    ...run,
    state: 'applied-awaiting-validation' as const,
    appliedHash: f.candidateHash,
  }));
  const originalDeadline = (await f.state())!.deadlineAt;
  f.advance(3_600_001);
  const deadlines: number[] = [];
  f.work.validate = async (_plan, run) => {
    deadlines.push(portalNativeDeadline(run, 'applied'));
    throw Object.assign(Error('Controlled validation rejection'), {
      code: 'TEST_VALIDATION_REJECTED',
    });
  };
  await expect(
    f.invoke('portal_validate', { runId: f.runId, target: 'applied' }),
  ).rejects.toMatchObject({ code: 'TEST_VALIDATION_REJECTED' });
  const first = (await f.state())!;
  expect(first.deadlineAt).toBe(originalDeadline);
  expect(first.nativeBudget?.recovery).toEqual({ deadlineAt: f.now() + 900_000, attempts: 1 });
  expect(deadlines).toEqual([f.now() + 900_000]);
  f.advance(900_001);
  await expect(
    f.invoke('portal_validate', { runId: f.runId, target: 'applied' }),
  ).rejects.toMatchObject({ code: 'PORTAL_RECOVERY_BUDGET_EXHAUSTED' });
  expect((await f.state())!.nativeBudget?.recovery).toEqual(first.nativeBudget?.recovery);
}, 30000);

it('cancellation settles a proved pre-effect apply rejection without a nonexistent recovery journal', async () => {
  const f = await fixture();
  let reached!: () => void;
  const started = new Promise<void>(resolve => {
    reached = resolve;
  });
  let release!: () => void;
  const cleanupComplete = new Promise<void>(resolve => {
    release = resolve;
  });
  f.work.cancel = async () => {
    release();
  };
  f.work.apply = async (_plan, _run, _files, _authority, signal) => {
    reached();
    return new Promise((_resolve, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          void cleanupComplete.then(() =>
            reject(
              Object.assign(Error('No target effect'), {
                applyEffectDisposition: 'pre-effect-rejected',
                code: 'OPERATION_CANCELLED',
              }),
            ),
          );
        },
        { once: true },
      ),
    );
  };
  const applying = f.invoke('portal_apply', { runId: f.runId }).catch(error => error);
  await started;
  expect(await f.invoke('portal_cancel', { runId: f.runId })).toMatchObject({ state: 'cancelled' });
  await applying;
  expect(await f.state()).toMatchObject({ state: 'cancelled', appliedHash: null });
}, 30000);
