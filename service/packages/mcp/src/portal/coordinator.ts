/* eslint-disable no-await-in-loop -- durable state/content ordering and independently bound source roots must remain sequential */
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import {
  storedChecksum,
  contentHash,
  PortalPlanSchema,
  PortalRunSchema,
  portalCandidateHash,
  portalCompletionIssues,
  type PortalPlan,
  type PortalRun,
} from '@sfp/ir';
import {
  PORTAL_INPUT_SCHEMAS,
  assertCurrentPortalSourceAuthority,
  assertCurrentPortalAnalysis,
  PortalPlanArgsSchema,
  resolvePortalCase,
  portalRequirementNeedsBlueprint,
  type ActorContext,
  type ProgressReporter,
  type PortalAcceptance,
  type PortalLayer,
  type PortalToolName,
  type WorkspacePolicy,
} from '@sfp/shared';
import { z } from 'zod';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { RepoReader } from '../fs/repo-walk.js';
import { resolvePortalAuthority, type PortalAuthority } from './authority.js';
import { PortalCaptureError } from './capture-failure.js';
import { portalContentBytes, type PortalFileContent } from './content.js';
import {
  PortalCapturedDesignSchema,
  type PortalDesignCapturePort,
  describePortalCapture,
  assertPortalCapturedGrant,
  assertPortalCaptureDescriptor,
  verifyPortalCaptureFiles,
} from './design-capture.js';
import { readPortalAssets, readPortalDesignPage } from './design-evidence.js';
import { normalizePortalDesign } from './design-normalization.js';
import { derivePortalInteractionContract } from './interaction-evidence.js';
import { PortalStoredValidationSchema } from './native-work.js';
import { requirePortalInventory } from './profile-closure.js';
import {
  PortalCoreLifecycle,
  coreDeclarationsHash,
  coreRequirementsHash,
  unavailableCoreBinding,
} from './recipes/core-lifecycle.js';
import { analyzeServiceGraph, isPortalSourcePath } from './service-graph.js';
import {
  qualifiedPortalSourceId,
  selectPortalServices,
  selectedPortalLayers,
  coverPortalWorkflows,
} from './service-selection.js';
import { assertFrontendSource } from './source-guard.js';
import { classifyPortalSourceBytes } from './source-inventory.js';
import { PortalStore, portalError } from './store.js';
import { analyzePortalWorkflows, type PortalWorkflowSourceHint } from './workflow-requirements.js';

const contentSchema = z
  .object({
    content: z.string(),
    hash: z.string(),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  })
  .strict();
export interface PortalExecution {
  reporter?: ProgressReporter;
  actor: Readonly<ActorContext>;
  workspaceId: string | null;
  operationId: string;
  authority: PortalAuthority;
  capture?: PortalDesignCapturePort;
  signal: AbortSignal;
}
export interface PortalWorkPort {
  prepareValidation?(
    plan: PortalPlan,
    run: PortalRun,
    profileId: string,
    target: 'candidate' | 'applied',
    operationId: string,
    authority: PortalAuthority,
  ): Promise<{ hash: string; resources: Array<{ key: string; mode: 'read' | 'write' }> }>;
  validate(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    signal: AbortSignal,
    target: 'candidate' | 'applied',
    profileId: string,
    prepared?: PortalAuthority,
    capture?: PortalDesignCapturePort,
  ): Promise<PortalAcceptance>;
  apply(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<{ hash: `sha256:${string}` }>;
  cancel(runId: string): Promise<void>;
  reconcile?(
    plan: PortalPlan,
    run: PortalRun,
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<{
    state: 'not-applied' | 'applied' | 'partial' | 'conflict';
    files: Array<{ path: string; state: 'preimage' | 'candidate' | 'conflict' | 'recoverable' }>;
  }>;
}
const terminal = new Set<PortalRun['state']>(['completed', 'cancelled']);
const publicRun = (run: PortalRun) => ({
  coreRecipes: run.coreRecipes,
  coreDeclarationCount: run.coreDeclarations?.length,
  coreDeclarationsHash: run.coreDeclarationsHash,
  sourceAuthorityVersion: run.sourceAuthorityVersion,
  sourceAuthorityStatus:
    run.sourceAuthorityVersion === 2
      ? 'current'
      : run.state === 'completed'
        ? 'historical-completed'
        : 'legacy-replan-required',
  runId: run.runId,
  planId: run.planId,
  version: run.version,
  state: run.state,
  generationAttempts: run.generationAttempts,
  files: run.files.map(file => ({
    path: file.path,
    action: file.action,
    contentHash: file.contentHash,
  })),
  candidateHash: run.candidateHash,
  appliedHash: run.appliedHash,
  validation: run.validation,
  lastValidation: run.lastValidation,
  issues: run.issues,
  lease: run.lease === null ? null : { epoch: run.lease.epoch, expiresAt: run.lease.expiresAt },
});
const redactSource = (source: string) =>
  source
    .replace(
      /(\b(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key)\s*[:=]\s*)(['"])[^'"\r\n]+\2/giu,
      '$1"[redacted literal]"',
    )
    .replace(/(https?:\/\/)[^/@\s]+@/gu, '$1[redacted]@');

export class PortalCoordinator {
  private readonly operations = new Map<
    string,
    { controller: AbortController; done: Promise<unknown> }
  >();
  constructor(
    private readonly store: PortalStore,
    private readonly policy: WorkspacePolicy,
    private readonly work: PortalWorkPort,
    private readonly now: () => number = Date.now,
    private readonly capture?: PortalDesignCapturePort,
    private readonly cancelPending?: (
      actor: Readonly<ActorContext>,
      runId: string,
    ) => Promise<void>,
    private readonly recipes?: PortalCoreLifecycle,
  ) {}
  private async plan(id: string, actor: string): Promise<PortalPlan> {
    const plan = await this.store.get('plans', id, PortalPlanSchema);
    if (plan === null || plan.ownerId !== actor) throw portalError('PORTAL_PLAN_NOT_FOUND');
    return plan;
  }
  private async run(id: string, actor: string): Promise<PortalRun> {
    const run = await this.store.get('runs', id, PortalRunSchema);
    if (run === null || run.ownerId !== actor) throw portalError('PORTAL_RUN_NOT_FOUND');
    return run;
  }
  async captureRequest(
    name: PortalToolName,
    input: unknown,
    actor: Readonly<ActorContext>,
  ): Promise<{ source: 'chrome' | 'desktop'; url: string } | null> {
    const args = PORTAL_INPUT_SCHEMAS[name].parse(input);
    if (name === 'portal_plan') {
      const request = PortalPlanArgsSchema.parse(args);
      return !request.design.artifactPath || request.design.freshness === 'require-live'
        ? { source: request.design.source, url: request.design.url }
        : null;
    }
    if (name !== 'portal_validate') return null;
    const run = await this.run((args as { runId: string }).runId, actor.actorId);
    const plan = await this.plan(run.planId, actor.actorId);
    return plan.request.design.freshness === 'require-live'
      ? { source: plan.request.design.source, url: plan.design.url }
      : null;
  }
  private async recipeEvidence(
    plan: PortalPlan,
    run: PortalRun,
    query?: Parameters<PortalCoreLifecycle['view']>[2],
  ) {
    if (!this.recipes || !plan.coreRecipes) return undefined;
    const view = await this.recipes.view(
      { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
      plan.coreRecipes,
      query,
    );
    return {
      ...view,
      declarationStatus: view.workItems.map(item => ({
        workItemId: item.id,
        declared: (run.coreDeclarations ?? []).some(
          row =>
            row.resultId === item.resultId &&
            row.resultHash === item.resultHash &&
            row.outputItemId === item.id &&
            row.kind === item.kind,
        ),
      })),
    };
  }
  private async assertCore(plan: PortalPlan, run?: PortalRun): Promise<void> {
    if (!this.recipes || !plan.coreRecipes) throw portalError('PORTAL_CORE_REPLAN_REQUIRED');
    if (run && run.coreRecipes?.bindingHash !== plan.coreRecipes.bindingHash)
      throw portalError('PORTAL_CORE_BINDING_CHANGED');
    await this.recipes.verify(
      { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
      plan.coreRecipes,
    );
  }
  private async assertCapture(plan: PortalPlan): Promise<void> {
    if (!plan.design.capture || plan.design.storage !== 'owner-state')
      throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
    if (
      plan.design.artifactHash !== plan.design.capture.rawHash ||
      plan.design.assetManifestHash !== plan.design.capture.assetManifestHash ||
      plan.request.design.source !== plan.design.capture.source.kind ||
      parseFigmaTarget(plan.design.url).url !== plan.design.capture.source.url
    )
      throw portalError('PORTAL_CAPTURE_EVIDENCE_CHANGED');
    const captured = await this.store.get('designs', plan.planId, PortalCapturedDesignSchema);
    if (!captured) throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
    assertPortalCaptureDescriptor(captured, plan.design.capture);
    if (!plan.interactionContract) throw portalError('PORTAL_INTERACTION_REPLAN_REQUIRED');
    if (
      contentHash(
        'sfp-interaction-contract-v1',
        derivePortalInteractionContract(captured, plan.requirements, plan.workflowCoverage),
      ) !== contentHash('sfp-interaction-contract-v1', plan.interactionContract)
    )
      throw portalError('PORTAL_INTERACTION_CONTRACT_CHANGED');
    await verifyPortalCaptureFiles(captured);
  }
  async prepare(
    name: PortalToolName,
    input: unknown,
    actor: Readonly<ActorContext>,
    workspaceId: string | null,
    operationId: string,
  ): Promise<PortalAuthority> {
    const args = PORTAL_INPUT_SCHEMAS[name].parse(input);
    let plan: PortalPlan | undefined;
    if (name !== 'portal_plan')
      plan = await this.plan(
        'planId' in args
          ? args.planId
          : (await this.run((args as { runId: string }).runId, actor.actorId)).planId,
        actor.actorId,
      );
    const id = plan?.workspaceId ?? workspaceId;
    if (!id) throw portalError('WORKSPACE_REQUIRED');
    if (workspaceId !== null && workspaceId !== id) throw portalError('PORTAL_WORKSPACE_MISMATCH');
    const controlRequest = plan?.request ?? PortalPlanArgsSchema.parse(args);
    const { resumePlanId, ...originalRequest } = controlRequest;
    const request = PortalPlanArgsSchema.parse(originalRequest),
      choice = resolvePortalCase(request);
    if (name === 'portal_plan' && resumePlanId) {
      if (!this.recipes) throw portalError('PORTAL_CORE_RUNTIME_REQUIRED');
      await this.recipes.inspectIntent({ ownerId: actor.actorId, workspaceId: id }, resumePlanId);
      const previousRun = await this.store.get('runs', resumePlanId, PortalRunSchema);
      if (previousRun?.ownerId === actor.actorId && previousRun.state === 'cancelled')
        throw portalError('PORTAL_CORE_INTENT_CANCELLED');
    }
    const planId =
      plan?.planId ??
      resumePlanId ??
      `sfp_portal1_${contentHash('sfp-portal-plan-id-v1', { owner: actor.actorId, operationId }).slice(7, 39)}`;
    if (plan && (name === 'portal_status' || name === 'portal_cancel'))
      return {
        workspaceId: id,
        targetPath: plan.targetPath,
        scope: plan.implementationScope,
        roots: [],
        hash: contentHash('sfp-portal-control-authority-v1', {
          owner: actor.actorId,
          planId,
          contextHash: plan.contextHash,
        }),
        resource: { kind: 'control', key: `portal:control:${planId}` },
      };
    if (
      plan &&
      !(name === 'portal_resume' && 'reconcile' in args && args.reconcile === 'inspect')
    ) {
      assertCurrentPortalSourceAuthority(plan);
      if (!['portal_start', 'portal_next'].includes(name)) {
        await this.assertCapture(plan);
        await this.assertCore(
          plan,
          'runId' in args ? await this.run(args.runId, actor.actorId) : undefined,
        );
      }
      assertCurrentPortalAnalysis(plan, !['portal_start', 'portal_next'].includes(name));
    }
    const authority = await resolvePortalAuthority(
      this.policy,
      id,
      request,
      planId,
      choice.implementationScope,
      plan,
      (name === 'portal_validate' && 'target' in args && args.target === 'applied') ||
        (name === 'portal_resume' && 'reconcile' in args && args.reconcile !== 'none'),
    );
    const repositoryResource = authority.resource;
    const runId = 'runId' in args ? args.runId : planId;
    authority.resource =
      name === 'portal_apply' ||
      (name === 'portal_resume' && 'reconcile' in args && args.reconcile === 'continue')
        ? authority.resource
        : {
            kind:
              name === 'portal_validate'
                ? 'process'
                : name === 'portal_status' || name === 'portal_cancel'
                  ? 'control'
                  : 'run',
            key: `portal:${name === 'portal_validate' ? 'process' : name === 'portal_status' || name === 'portal_cancel' ? 'control' : 'run'}:${runId}`,
          };
    if (name === 'portal_validate' || name === 'portal_apply' || name === 'portal_resume')
      authority.candidateHash = (await this.run(runId, actor.actorId)).candidateHash;
    if (
      name === 'portal_plan' &&
      this.capture &&
      (!request.design.artifactPath || request.design.freshness === 'require-live')
    )
      authority.resource = {
        kind: 'browser',
        key: `portal:browser:${contentHash('sfp-portal-browser-file-v1', new URL(request.design.url).pathname.split('/')[2]).slice(7)}`,
      };
    if (name === 'portal_validate' && plan && 'profileId' in args && 'target' in args) {
      if (!this.work.prepareValidation) throw portalError('PORTAL_ENVIRONMENT_ADMISSION_REQUIRED');
      const environment = await this.work.prepareValidation(
        plan,
        await this.run(runId, actor.actorId),
        String(args.profileId),
        args.target as 'candidate' | 'applied',
        operationId,
        { ...authority, resource: repositoryResource },
      );
      authority.nativeEnvironment = environment;
      authority.executionAuthorityHash = environment.hash as `sha256:${string}`;
      authority.executionResources = environment.resources;
    }
    return authority;
  }
  execute(name: PortalToolName, input: unknown, execution: PortalExecution): Promise<unknown> {
    const args = PORTAL_INPUT_SCHEMAS[name].parse(input);
    const owned =
      name === 'portal_validate' ||
      name === 'portal_apply' ||
      (name === 'portal_resume' && 'reconcile' in args && args.reconcile !== 'none');
    if (!owned) return this.executeReserved(name, input, execution);
    const key = `${execution.actor.actorId}:${(args as { runId: string }).runId}`;
    if (this.operations.has(key)) return Promise.reject(portalError('PORTAL_NATIVE_RUN_BUSY'));
    const controller = new AbortController();
    const scoped = { ...execution, signal: AbortSignal.any([execution.signal, controller.signal]) };
    const done = Promise.resolve().then(() => this.executeReserved(name, input, scoped));
    const reservation = { controller, done };
    this.operations.set(key, reservation);
    return done.finally(() => {
      if (this.operations.get(key) === reservation) this.operations.delete(key);
    });
  }
  private async executeReserved(
    name: PortalToolName,
    input: unknown,
    execution: PortalExecution,
  ): Promise<unknown> {
    execution.signal.throwIfAborted();
    const args = PORTAL_INPUT_SCHEMAS[name].parse(input);
    if (name === 'portal_plan') return this.createPlan(PortalPlanArgsSchema.parse(args), execution);
    if (name !== 'portal_cancel' && name !== 'portal_status') {
      const planId =
        'planId' in args
          ? args.planId
          : (await this.run((args as { runId: string }).runId, execution.actor.actorId)).planId;
      const plan = await this.plan(planId, execution.actor.actorId);
      const inspect =
        name === 'portal_resume' &&
        PORTAL_INPUT_SCHEMAS.portal_resume.parse(args).reconcile === 'inspect';
      if (!inspect) {
        assertCurrentPortalSourceAuthority(plan);
        if (!['portal_start', 'portal_next'].includes(name)) {
          await this.assertCapture(plan);
          await this.assertCore(
            plan,
            'runId' in args ? await this.run(args.runId, execution.actor.actorId) : undefined,
          );
        }
        assertCurrentPortalAnalysis(plan, false);
        if ('runId' in args)
          assertCurrentPortalSourceAuthority(await this.run(args.runId, execution.actor.actorId));
      }
    }
    execution.signal.throwIfAborted();
    if (name === 'portal_start') return this.start((args as { planId: string }).planId, execution);
    const runId = (args as { runId: string }).runId;
    if (name === 'portal_status') {
      const run = await this.run(runId, execution.actor.actorId);
      const query = PORTAL_INPUT_SCHEMAS.portal_status.parse(args).recipes;
      if (!query) return publicRun(run);
      const plan = await this.plan(run.planId, execution.actor.actorId);
      return { ...publicRun(run), recipes: await this.recipeEvidence(plan, run, query) };
    }
    if (name === 'portal_next')
      return this.next(PORTAL_INPUT_SCHEMAS.portal_next.parse(args), execution);
    if (name === 'portal_submit')
      return this.submit(PORTAL_INPUT_SCHEMAS.portal_submit.parse(args), execution);
    if (name === 'portal_validate') {
      const validation = PORTAL_INPUT_SCHEMAS.portal_validate.parse(args);
      return this.validate(runId, validation.target, execution, validation.profileId);
    }
    if (name === 'portal_apply') return this.apply(runId, execution);
    if (name === 'portal_cancel') {
      const active = this.operations.get(`${execution.actor.actorId}:${runId}`);
      active?.controller.abort(portalError('OPERATION_CANCELLED'));
      await this.cancelPending?.(execution.actor, runId);
      let sourceOutcomeUncertain = false;
      const updated = await this.mutate(runId, execution, run => {
        if (terminal.has(run.state)) return run;
        sourceOutcomeUncertain = [
          'applying',
          'outcome-unknown',
          'conflict',
          'applied-awaiting-validation',
        ].includes(run.state);
        run.state = 'cancel-requested';
        run.lease = null;
        run.leaseEpoch++;
        return run;
      });
      await this.work.cancel(runId);
      await active?.done.catch(error => {
        if ((error as { code?: string }).code === 'PORTAL_NATIVE_CLEANUP_UNKNOWN') throw error;
      });
      const cancelled = await this.mutate(runId, execution, run => {
        if (updated.state !== 'completed' && run.state === 'cancel-requested')
          run.state = run.appliedHash || sourceOutcomeUncertain ? 'conflict' : 'cancelled';
        return run;
      });
      if (cancelled.state === 'cancelled' && this.recipes) {
        const plan = await this.plan(cancelled.planId, execution.actor.actorId);
        if (plan.coreRecipes) {
          const scope = { ownerId: plan.ownerId, workspaceId: plan.workspaceId };
          await this.recipes.release(scope, plan.coreRecipes, 'run:' + cancelled.runId);
          await this.recipes.release(scope, plan.coreRecipes, 'plan:' + plan.planId);
        }
      }
      return publicRun(cancelled);
    }
    if (
      name === 'portal_resume' &&
      PORTAL_INPUT_SCHEMAS.portal_resume.parse(args).reconcile !== 'none'
    ) {
      const run = await this.run(runId, execution.actor.actorId),
        plan = await this.plan(run.planId, execution.actor.actorId);
      if (terminal.has(run.state)) return publicRun(run);
      if (
        !['applying', 'outcome-unknown', 'conflict', 'applied-awaiting-validation'].includes(
          run.state,
        )
      )
        throw portalError('PORTAL_STATE_NOT_RECONCILABLE');
      if (execution.authority.candidateHash !== run.candidateHash)
        throw portalError('PORTAL_CANDIDATE_CHANGED');
      if (!this.work.reconcile) throw portalError('PORTAL_RECONCILIATION_REQUIRED');
      const observed = await this.work.reconcile(plan, run, execution.authority, execution.signal);
      if (plan.sourceAuthorityVersion !== 2 || run.sourceAuthorityVersion !== 2)
        return {
          ...publicRun(run),
          issues: [
            ...run.issues,
            'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
            `RECONCILIATION_${observed.state.toUpperCase()}`,
            ...observed.files.map(file => `${file.state}:${file.path}`),
          ],
        };
      if (
        observed.state === 'partial' &&
        PORTAL_INPUT_SCHEMAS.portal_resume.parse(args).reconcile === 'continue'
      ) {
        const contents = await this.contents(run);
        execution.signal.throwIfAborted();
        const applied = await this.work.apply(
          plan,
          run,
          contents,
          execution.authority,
          execution.signal,
        );
        return publicRun(
          await this.mutate(runId, execution, current => {
            if (current.state === 'cancel-requested' || current.state === 'cancelled')
              return current;
            current.appliedHash = applied.hash;
            current.state = 'applied-awaiting-validation';
            current.validation = null;
            return current;
          }),
        );
      }
      return publicRun(
        await this.mutate(runId, execution, current => {
          if (current.state === 'cancel-requested' || current.state === 'cancelled') return current;
          current.lease = null;
          current.leaseEpoch++;
          current.issues = [
            ...plan.issues,
            `RECONCILIATION_${observed.state.toUpperCase()}`,
            ...observed.files.map(file => `${file.state}:${file.path}`),
          ];
          if (observed.state === 'applied') {
            current.appliedHash = current.candidateHash;
            current.state = 'applied-awaiting-validation';
            current.validation = null;
          } else if (observed.state === 'not-applied') {
            current.appliedHash = null;
            current.state = 'candidate-ready';
            current.validation = null;
          } else current.state = observed.state === 'partial' ? 'outcome-unknown' : 'conflict';
          return current;
        }),
      );
    }
    return publicRun(
      await this.mutate(runId, execution, run => {
        if (['applying', 'outcome-unknown', 'conflict'].includes(run.state))
          throw portalError('PORTAL_RECONCILIATION_REQUIRED');
        if (terminal.has(run.state)) return run;
        if (this.now() >= run.deadlineAt) throw portalError('PORTAL_BUDGET_EXHAUSTED');
        if (run.state === 'needs-input') return run;
        run.lease = null;
        run.leaseEpoch++;
        run.state = run.appliedHash
          ? 'applied-awaiting-validation'
          : run.candidateHash
            ? 'candidate-ready'
            : 'waiting-agent';
        return run;
      }),
    );
  }
  private async createPlan(
    request: z.infer<typeof PortalPlanArgsSchema>,
    execution: PortalExecution,
  ) {
    const { authority, actor, operationId } = execution;
    const { resumePlanId, ...originalRequest } = request;
    request = PortalPlanArgsSchema.parse(originalRequest);
    const choice = resolvePortalCase(request);
    const planId =
      resumePlanId ??
      `sfp_portal1_${contentHash('sfp-portal-plan-id-v1', { owner: actor.actorId, operationId }).slice(7, 39)}`;
    if (resumePlanId) {
      if (!this.recipes) throw portalError('PORTAL_CORE_RUNTIME_REQUIRED');
      await this.recipes.inspectIntent(
        { ownerId: actor.actorId, workspaceId: authority.workspaceId },
        resumePlanId,
      );
      const previousRun = await this.store.get('runs', resumePlanId, PortalRunSchema);
      if (previousRun?.ownerId === actor.actorId && previousRun.state === 'cancelled')
        throw portalError('PORTAL_CORE_INTENT_CANCELLED');
    }
    execution.reporter?.report({
      phase: 'portal-plan',
      completed: 0,
      total: null,
      message: `Plan ${planId}. Resume an interrupted reserved preparation with resumePlanId and the same original request.`,
    });
    const old = await this.store.get('plans', planId, PortalPlanSchema);
    if (old) {
      if (old.ownerId !== actor.actorId) throw portalError('PORTAL_PLAN_NOT_FOUND');
      if (
        resumePlanId &&
        contentHash('sfp-portal-core-request-v1', old.request) !==
          contentHash('sfp-portal-core-request-v1', request)
      )
        throw portalError('PORTAL_CORE_RESUME_REQUEST_CHANGED');
      return this.summary(old);
    }
    const target = authority.roots[0]!;
    const exists = await lstat(target.path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (choice.strategy === 'legacy-portal' && !exists?.isDirectory())
      throw portalError('PORTAL_LEGACY_TARGET_MISSING');
    if (choice.strategy !== 'legacy-portal' && exists !== null)
      throw portalError('PORTAL_NEW_TARGET_EXISTS');
    const profiles: PortalPlan['profiles'] = [];
    const issues: string[] = [];
    if (choice.strategy === 'legacy-portal' && request.stack !== 'auto')
      throw portalError('PORTAL_LEGACY_STACK_OVERRIDE_UNSUPPORTED');
    for (const root of authority.roots) {
      if (root.role === 'target' && choice.strategy !== 'legacy-portal') continue;
      // eslint-disable-next-line no-await-in-loop -- bounded independent role-specific readers
      const graph = await analyzeServiceGraph(
        new RepoReader({
          rootDir: root.path,
          workspaceId: root.workspaceId,
          workspacePolicy: this.policy,
          signal: execution.signal,
        }),
        qualifiedPortalSourceId({ ...root, canonicalPath: root.path }),
      );
      profiles.push({
        workspaceId: root.workspaceId,
        rootPath: root.rootPath,
        role: root.role,
        graph,
      });
      if (graph.incomplete) issues.push(`SOURCE_ANALYSIS_INCOMPLETE:${root.workspaceId}`);
    }
    const url = new URL(request.design.url),
      fileKey = url.pathname.split('/')[2]!,
      nodeId = url.searchParams.get('node-id')?.replace(/^(\d+)-(\d+)$/u, '$1:$2') ?? null;
    const design: PortalPlan['design'] = {
      storage: 'workspace',
      assetManifestHash: null,
      url: request.design.url,
      fileKey,
      nodeId,
      artifactPath: request.design.artifactPath ?? null,
      artifactHash: null,
      liveVerified: false,
      complete: false,
    };
    let designDocument: Record<string, unknown> | null = null;
    if (request.design.artifactPath) {
      const base = await this.policy.resolveRoot!(authority.workspaceId);
      const reader = new RepoReader({
        rootDir: base,
        workspaceId: authority.workspaceId,
        workspacePolicy: this.policy,
      });
      const bytes = await reader.readBytes(request.design.artifactPath, 16_777_216);
      design.artifactHash = storedChecksum(bytes);
      if (request.design.artifactHash && request.design.artifactHash !== design.artifactHash)
        throw portalError('PORTAL_DESIGN_HASH_MISMATCH');
      const record = normalizePortalDesign(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<
          string,
          unknown
        >,
      );
      const recordedUrl =
        typeof record.requestedUrl === 'string'
          ? record.requestedUrl
          : typeof record.target === 'object' && record.target !== null
            ? (record.target as Record<string, unknown>).requestedUrl
            : undefined;
      if (
        typeof recordedUrl !== 'string' ||
        new URL(recordedUrl).pathname.split('/')[2] !== fileKey
      )
        throw portalError('PORTAL_DESIGN_FILE_MISMATCH');
      if (
        record.requestedNodeId !== undefined &&
        nodeId !== null &&
        record.requestedNodeId !== nodeId
      )
        throw portalError('PORTAL_DESIGN_SCOPE_MISMATCH');
      // A standalone JSON tree does not bind usable image assets or visual oracles.
      design.complete = false;
      issues.push('PINNED_ASSET_MANIFEST_REQUIRED');
      designDocument = record;
      if (!design.complete) issues.push('DESIGN_ARTIFACT_PARTIAL_OR_UNSUPPORTED');
    }
    if (
      this.capture &&
      (!request.design.artifactPath || request.design.freshness === 'require-live')
    ) {
      let captureFinished = false;
      let captureStageStarted = Date.now();
      try {
        const capture = execution.capture ?? this.capture;
        if (!capture || !execution.authority.captureSource)
          throw portalError('PORTAL_CAPTURE_ADMISSION_REQUIRED');
        const retainedCapture = await this.store.get('designs', planId, PortalCapturedDesignSchema);
        const captured =
          retainedCapture ?? (await capture.capture(planId, request.design.url, execution.signal));
        if (captured.complete) {
          await verifyPortalCaptureFiles(captured, execution.signal);
          assertPortalCapturedGrant(captured, execution.authority.captureSource);
          design.capture = describePortalCapture(
            captured,
            {
              kind: execution.authority.captureSource.kind,
              url: request.design.url,
            },
            execution.authority.captureSource,
          );
        }
        captureFinished = true;
        execution.signal.throwIfAborted();
        captureStageStarted = Date.now();
        if (!retainedCapture)
          await this.store.create('designs', planId, captured, PortalCapturedDesignSchema);
        design.storage = 'owner-state';
        design.artifactPath = `portal/designs/${planId}.json`;
        design.artifactHash = captured.hash;
        design.assetManifestHash = contentHash('sfp-portal-design-assets-v1', captured.assets);
        design.complete = captured.complete;
        design.liveVerified = true;
        designDocument = JSON.parse(captured.raw) as Record<string, unknown>;
        if (!captured.complete) issues.push('DESIGN_CAPTURE_PARTIAL');
      } catch (error) {
        execution.signal.throwIfAborted();
        const failure =
          error instanceof PortalCaptureError
            ? error
            : new PortalCaptureError(
                captureFinished ? 'design-publication' : 'capture',
                error,
                captureStageStarted,
              );
        design.captureFailure = failure.diagnostic;
        issues.push(failure.code);
      }
    }
    if (!design.artifactHash) issues.push('DESIGN_CAPTURE_REQUIRED');
    if (request.design.freshness === 'require-live' && !design.liveVerified)
      issues.push('LIVE_DESIGN_VERIFICATION_REQUIRED');
    const layers = new Set<PortalLayer>(['frontend']);
    const serviceSelection = selectPortalServices(profiles, request);
    issues.push(...serviceSelection.issues);
    if (choice.implementationScope === 'operational-portal')
      for (const layer of selectedPortalLayers(profiles, serviceSelection)) layers.add(layer);
    const allRootIds = Array.isArray(designDocument?.nodes)
      ? designDocument.nodes.flatMap(node =>
          node && typeof node === 'object' && 'id' in node && typeof node.id === 'string'
            ? [node.id]
            : [],
        )
      : [];
    const nodeIds = [...new Set(allRootIds)].slice(0, 128);
    const sourceHints: PortalWorkflowSourceHint[] = [];
    for (const selected of serviceSelection.closure) {
      const profile = profiles[selected.sourceIndex]!,
        service = profile.graph.services.find(item => item.rootPath === selected.rootPath)!;
      const root = authority.roots.find(
        candidate =>
          candidate.role === profile.role &&
          candidate.workspaceId === profile.workspaceId &&
          candidate.rootPath === profile.rootPath,
      )!;
      const reader = new RepoReader({
        rootDir: root.path,
        workspaceId: root.workspaceId,
        workspacePolicy: this.policy,
        signal: execution.signal,
      });
      const hints = new Map<string, { path: string; kind: PortalWorkflowSourceHint['kind'] }>();
      const hint = (path: string, kind: PortalWorkflowSourceHint['kind']) =>
        hints.set(JSON.stringify([path, kind]), { path, kind });
      for (const evidence of service.evidence) {
        if (evidence.sourceRole !== 'runtime') continue;
        if (evidence.kind === 'persists') hint(evidence.path, 'persistence');
        if (evidence.kind === 'provides-api') hint(evidence.path, 'read-api');
        if (['resolved-module', 'declared-external-module'].includes(evidence.kind)) {
          if (
            /^(?:passport|next-auth|@auth\/|better-auth|jsonwebtoken|jose)/u.test(evidence.detail)
          )
            hint(evidence.path, 'authentication');
          if (/^(?:stripe|nodemailer|twilio|@sendgrid\/)/u.test(evidence.detail))
            hint(evidence.path, 'configured-integration');
        }
      }
      for (const { path, kind } of hints.values()) {
        if (sourceHints.length >= 256) {
          issues.push('WORKFLOW_SOURCE_HINT_LIMIT');
          break;
        }
        const bytes = await reader.readBytes(path, 262144),
          hash = storedChecksum(bytes);
        if (profile.graph.files.find(file => file.path === path)?.hash !== hash)
          throw portalError('PORTAL_SOURCE_CHANGED');
        sourceHints.push({
          kind,
          sourceId: selected.sourceId,
          path,
          hash,
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          designNodeIds: nodeIds,
          rationale:
            'Observed capability in the selected conservative service closure; blueprint must confirm application to this design',
        });
      }
    }
    if (sourceHints.length && allRootIds.length > 128) issues.push('WORKFLOW_SOURCE_HINT_LIMIT');
    const workflowAnalysis = analyzePortalWorkflows(designDocument, choice.implementationScope, {
      sourceHints,
    });
    const inferred = workflowAnalysis.candidates.map(candidate => candidate.requirement);
    const declared = request.requirements.map(requirement => ({
      ...requirement,
      layers: [...requirement.layers],
    }));
    for (const inferredRequirement of inferred) {
      const existing = declared.find(requirement => requirement.id === inferredRequirement.id);
      if (existing) {
        existing.layers = [...new Set([...existing.layers, ...inferredRequirement.layers])];
        existing.required ||= inferredRequirement.required;
        if (!existing.workflow && inferredRequirement.workflow)
          existing.workflow = structuredClone(inferredRequirement.workflow);
        if (existing.workflow && inferredRequirement.workflow) {
          existing.workflow.states = [
            ...new Set([...existing.workflow.states, ...inferredRequirement.workflow.states]),
          ];
          existing.workflow.routes = [
            ...new Set([...existing.workflow.routes, ...inferredRequirement.workflow.routes]),
          ];
        }
      } else declared.push(inferredRequirement);
    }
    for (const requirement of declared) for (const layer of requirement.layers) layers.add(layer);
    const requirements = declared.length
      ? declared
      : [
          {
            id: 'portal-experience',
            description:
              choice.implementationScope === 'frontend-only'
                ? 'Implement the selected Figma frontend with functional local state'
                : 'Implement the required portal journeys across the relevant complete service',
            layers: [...layers],
            required: true,
          },
        ];
    if (choice.strategy !== 'blank-frontend')
      for (const requirement of requirements.filter(
        entry => entry.required && portalRequirementNeedsBlueprint(entry),
      ))
        issues.push(`WORKFLOW_BLUEPRINT_REQUIRED:${requirement.id}`);
    for (const requirement of requirements)
      for (const decision of requirement.workflow?.decisions ?? []) {
        const refs = decision.sourceEvidence ?? [];
        if (['present', 'extend'].includes(decision.action) && refs.length === 0)
          issues.push('WORKFLOW_SOURCE_EVIDENCE_REQUIRED:' + requirement.id + ':' + decision.layer);
        for (const ref of refs) {
          const profile = profiles[ref.sourceIndex];
          if (
            !profile ||
            profile.graph.sourceId !== ref.sourceId ||
            !profile.graph.files.some(file => file.path === ref.path && file.hash === ref.hash) ||
            !serviceSelection.closure.some(
              selected =>
                selected.sourceId === ref.sourceId &&
                selected.rootPath ===
                  profile.graph.services
                    .filter(
                      service =>
                        service.rootPath === '.' || ref.path.startsWith(service.rootPath + '/'),
                    )
                    .toSorted(
                      (a, b) =>
                        (b.rootPath === '.' ? 0 : b.rootPath.length) -
                        (a.rootPath === '.' ? 0 : a.rootPath.length),
                    )[0]?.rootPath,
            )
          )
            throw portalError('PORTAL_WORKFLOW_SOURCE_EVIDENCE_NOT_BOUND');
        }
      }
    const workflowCoverage = coverPortalWorkflows(
      workflowAnalysis,
      requirements,
      request.workflowDecisions,
    );
    const blueprintIssues = issues.filter(
      issue =>
        issue.startsWith('WORKFLOW_BLUEPRINT_REQUIRED:') ||
        issue.startsWith('WORKFLOW_SOURCE_EVIDENCE_REQUIRED:') ||
        issue === 'WORKFLOW_SOURCE_HINT_LIMIT',
    );
    if (blueprintIssues.length) {
      workflowCoverage.complete = false;
      workflowCoverage.issues.push(...blueprintIssues);
    }
    issues.push(...workflowCoverage.issues);
    if (issues.length > 512) {
      issues.splice(511, issues.length - 511, 'PORTAL_PLAN_ISSUES_TRUNCATED');
      workflowCoverage.complete = false;
      workflowCoverage.issues = [
        ...workflowCoverage.issues.slice(0, 511),
        'PORTAL_PLAN_ISSUES_TRUNCATED',
      ];
    }
    const storedCapture = design.capture
      ? await this.store.get('designs', planId, PortalCapturedDesignSchema)
      : null;
    const interactionContract = storedCapture
      ? derivePortalInteractionContract(storedCapture, requirements, workflowCoverage)
      : undefined;
    if (interactionContract && !interactionContract.complete) {
      issues.push('PORTAL_REQUIRED_INTERACTION_UNSUPPORTED', ...interactionContract.issues);
      workflowCoverage.complete = false;
    }
    if (!design.capture) issues.push('PORTAL_CAPTURE_CURRENT_REQUIRED');
    if (issues.length > 512) {
      issues.splice(511, issues.length - 511, 'PORTAL_PLAN_ISSUES_TRUNCATED');
      workflowCoverage.complete = false;
    }
    const contextHash = contentHash('sfp-portal-context-v1', {
      analysisVersion: 2,
      serviceSelection,
      workflowCoverage,
      interactionContract,
      sourceAuthorityVersion: 2,
      authority: authority.hash,
      stack: request.stack,
      requestedServices: request.services,
      references: request.references,
      profiles,
      design,
    });
    const plan = PortalPlanSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      planId,
      ownerId: actor.actorId,
      workspaceId: authority.workspaceId,
      createdAt: new Date(this.now()).toISOString(),
      request,
      ...choice,
      targetPath: authority.targetPath,
      repositories: authority.roots.map(root => ({
        role: root.role,
        workspaceId: root.workspaceId,
        rootPath: root.rootPath,
        anchorPath: root.anchorPath,
        canonicalPath: root.path,
        identity: root.identity,
        writable: root.writable,
        sourceHash:
          profiles.find(
            profile =>
              profile.workspaceId === root.workspaceId &&
              profile.role === root.role &&
              profile.rootPath === root.rootPath,
          )?.graph.sourceHash ?? null,
      })),
      profiles,
      analysisVersion: 2,
      serviceSelection,
      workflowCoverage,
      design,
      interactionContract,
      requirements,
      requiredLayers: [...layers],
      contextHash,
      blueprintHash: contentHash('sfp-portal-blueprint-v1', {
        contextHash,
        requirements,
        interactionContract,
        scope: choice.implementationScope,
      }),
      issues,
    });
    if (resumePlanId && (!storedCapture || !design.capture || !design.complete))
      throw portalError('PORTAL_CORE_RESUME_CAPTURE_CHANGED');
    plan.coreRecipes =
      storedCapture && design.capture && design.complete && this.recipes
        ? await this.recipes.preparePlan(
            plan,
            storedCapture,
            authority,
            this.policy,
            execution.signal,
          )
        : unavailableCoreBinding(
            coreRequirementsHash(plan),
            !this.recipes ? 'PORTAL_CORE_RUNTIME_REQUIRED' : 'PORTAL_CAPTURE_CURRENT_REQUIRED',
          );
    plan.blueprintHash = contentHash('sfp-portal-blueprint-v2', {
      contextHash: plan.contextHash,
      requirements: plan.requirements,
      interactionContract: plan.interactionContract,
      scope: plan.implementationScope,
      coreBindingHash: plan.coreRecipes.bindingHash,
    });
    if (plan.coreRecipes.status === 'ready')
      await this.recipes!.retain(
        { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
        plan.coreRecipes,
        'plan:' + plan.planId,
      );
    else plan.issues = [...plan.issues.slice(0, 511), plan.coreRecipes.code!];
    await this.store.create('plans', planId, plan, PortalPlanSchema);
    return this.summary(plan);
  }
  private summary(plan: PortalPlan) {
    return {
      planId: plan.planId,
      coreRecipes: plan.coreRecipes,
      sourceAuthorityVersion: plan.sourceAuthorityVersion,
      stack: plan.request.stack,
      serviceSelection: plan.request.services,
      analysisVersion: plan.analysisVersion,
      selectedClosure: plan.serviceSelection,
      workflowCoverage: plan.workflowCoverage,
      interactionContract: plan.interactionContract,
      requestedCase: plan.requestedCase,
      strategy: plan.strategy,
      implementationScope: plan.implementationScope,
      targetPath: plan.targetPath,
      contextHash: plan.contextHash,
      blueprintHash: plan.blueprintHash,
      design: plan.design,
      requirements: plan.requirements,
      requiredLayers: plan.requiredLayers,
      services: plan.profiles.map((profile, sourceIndex) => ({
        sourceId: this.sourceId(plan, sourceIndex),
        sourceIndex,
        workspaceId: profile.workspaceId,
        role: profile.role,
        rootPath: profile.rootPath,
        referenceRole:
          profile.role === 'reference'
            ? (plan.request.references.find(
                reference =>
                  reference.workspaceId === profile.workspaceId &&
                  reference.rootPath === profile.rootPath,
              )?.role ?? null)
            : null,
        services: profile.graph.services.map(service => ({
          rootPath: service.rootPath,
          layers: service.layers,
          frameworks: service.frameworks,
          languages: service.languages,
          ...(service.codePatterns ? { codePatterns: service.codePatterns } : {}),
        })),
        incomplete: profile.graph.incomplete,
      })),
      issues: plan.issues,
    };
  }
  private async start(planId: string, execution: PortalExecution) {
    const plan = await this.plan(planId, execution.actor.actorId);
    const existing = await this.store.get('runs', planId, PortalRunSchema);
    if (existing) {
      assertCurrentPortalSourceAuthority(existing);
      if (
        plan.coreRecipes?.status !== 'ready' ||
        existing.coreRecipes?.bindingHash !== plan.coreRecipes.bindingHash
      )
        return publicRun(
          await this.mutate(existing.runId, execution, run => {
            if (run.lease) run.leaseEpoch++;
            run.lease = null;
            if (!terminal.has(run.state)) run.state = 'needs-input';
            return run;
          }),
        );
      await this.assertCore(plan, existing);
      return publicRun(existing);
    }
    if (plan.coreRecipes?.status === 'ready') {
      await this.assertCore(plan);
      await this.recipes!.retain(
        { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
        plan.coreRecipes,
        'run:' + plan.planId,
      );
    }
    const at = new Date(this.now()).toISOString();
    const run = PortalRunSchema.parse({
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      runId: planId,
      planId,
      coreRecipes: plan.coreRecipes,
      coreDeclarations: [],
      coreDeclarationsHash: coreDeclarationsHash([]),
      ownerId: plan.ownerId,
      workspaceId: plan.workspaceId,
      version: 1,
      state:
        plan.coreRecipes?.status !== 'ready' ||
        !plan.design.complete ||
        !plan.design.capture ||
        !plan.serviceSelection?.complete ||
        !plan.workflowCoverage?.complete ||
        plan.issues.some(
          issue =>
            issue.startsWith('WORKFLOW_BLUEPRINT_REQUIRED:') ||
            issue.startsWith('WORKFLOW_SOURCE_EVIDENCE_REQUIRED:') ||
            issue === 'WORKFLOW_SOURCE_HINT_LIMIT',
        )
          ? 'needs-input'
          : 'waiting-agent',
      createdAt: at,
      updatedAt: at,
      deadlineAt: this.now() + 3_600_000,
      leaseEpoch: 0,
      lease: null,
      generationAttempts: 0,
      files: [],
      candidateHash: null,
      validation: null,
      appliedHash: null,
      issues: plan.coreRecipes
        ? plan.issues
        : [...plan.issues.slice(0, 511), 'PORTAL_CORE_REPLAN_REQUIRED'],
      operations: [{ id: execution.operationId, name: 'portal_start', at }],
    });
    await this.store.create('runs', run.runId, run, PortalRunSchema);
    return publicRun(run);
  }
  private mutate(
    id: string,
    execution: PortalExecution,
    change: (run: PortalRun) => PortalRun | Promise<PortalRun>,
  ) {
    return this.store.update('runs', id, PortalRunSchema, async run => {
      if (run.ownerId !== execution.actor.actorId) throw portalError('PORTAL_RUN_NOT_FOUND');
      const next = await change(run);
      next.version++;
      next.updatedAt = new Date(this.now()).toISOString();
      if (!next.operations.some(operation => operation.id === execution.operationId))
        next.operations.push({
          id: execution.operationId,
          name: 'portal-step',
          at: next.updatedAt,
        });
      return next;
    });
  }
  private async next(
    args: z.infer<typeof PORTAL_INPUT_SCHEMAS.portal_next>,
    execution: PortalExecution,
  ) {
    const { runId, leaseId } = args;
    const before = await this.run(runId, execution.actor.actorId);
    const plan = await this.plan(before.planId, execution.actor.actorId);
    const [evidence, designEvidence, assets, validationEvidence, recipes] = await Promise.all([
      this.evidence(plan, execution.authority, args.evidence),
      readPortalDesignPage(
        plan,
        this.policy,
        args.designOffset,
        args.designLimit,
        execution.signal,
        this.store,
        args.tokenOffset,
        {
          collectionOffset: args.collectionOffset,
          styleOffset: args.styleOffset,
          ...(args.styleFamily ? { styleFamily: args.styleFamily } : {}),
        },
      ),
      readPortalAssets(plan, this.store, args.assetOffset, args.assetIds, execution.signal),
      this.validationEvidence(before),
      this.recipeEvidence(plan, before, args.recipes),
    ]);
    if (plan.design.capture && plan.design.complete) await this.assertCapture(plan);
    if (plan.coreRecipes?.status === 'ready' && before.state !== 'needs-input') {
      // The bounded view already revalidated all signed results/pages for this binding.
      if (
        !recipes ||
        before.coreRecipes?.bindingHash !== plan.coreRecipes.bindingHash ||
        recipes.binding.bindingHash !== plan.coreRecipes.bindingHash
      )
        throw portalError('PORTAL_CORE_BINDING_CHANGED');
      await this.recipes!.assertSourcesCurrent(plan, this.policy, execution.signal);
    }
    const run = await this.mutate(runId, execution, value => {
      if (
        value.state === 'needs-input' ||
        plan.coreRecipes?.status !== 'ready' ||
        !plan.design.capture ||
        !plan.design.complete
      ) {
        value.state = 'needs-input';
        value.lease = null;
        if (!plan.coreRecipes && !value.issues.includes('PORTAL_CORE_REPLAN_REQUIRED'))
          value.issues = [...value.issues.slice(0, 511), 'PORTAL_CORE_REPLAN_REQUIRED'];
        return value;
      }
      assertCurrentPortalAnalysis(plan);
      if (
        terminal.has(value.state) ||
        [
          'applying',
          'cancel-requested',
          'conflict',
          'outcome-unknown',
          'validating-candidate',
          'validating-applied',
        ].includes(value.state)
      )
        throw portalError('PORTAL_STATE_NOT_CLAIMABLE');
      if (this.now() >= value.deadlineAt) throw portalError('PORTAL_BUDGET_EXHAUSTED');
      if (value.lease && value.lease.expiresAt > this.now()) {
        if (
          value.lease.id !== leaseId ||
          value.lease.authSessionId !== execution.actor.authSessionId
        )
          throw portalError('PORTAL_LEASE_BUSY');
        value.lease.expiresAt = Math.min(value.deadlineAt, this.now() + 600_000);
        return value;
      }
      if (value.appliedHash) throw portalError('PORTAL_ALREADY_APPLIED');
      if (value.generationAttempts >= 4) throw portalError('PORTAL_REPAIR_BUDGET_EXHAUSTED');
      value.leaseEpoch++;
      value.generationAttempts++;
      value.lease = {
        id: randomUUID(),
        authSessionId: execution.actor.authSessionId,
        epoch: value.leaseEpoch,
        expiresAt: Math.min(value.deadlineAt, this.now() + 600_000),
      };
      value.state = 'generating';
      return value;
    });
    return {
      ...publicRun(run),
      recipes,
      lease:
        run.lease === null
          ? null
          : { leaseId: run.lease.id, leaseEpoch: run.lease.epoch, expiresAt: run.lease.expiresAt },
      blueprint: this.summary(plan),
      instruction:
        (run.state === 'needs-input'
          ? 'Read this evidence and refine every required workflow with roles, states, routes, API/data contracts and per-layer decisions. Call portal_plan again with these requirements and the same case/design/target/references. Start the new confirmed plan; this draft issues no coding lease.'
          : plan.implementationScope === 'frontend-only'
            ? 'Submit an independent frontend; do not create backend services.'
            : 'Learn and implement the complete relevant service in selectedClosure.closure. Qualify reused or extended source patterns by sourceId, sourceIndex, path and hash. The full byte inventory remains authority and review evidence, not a direction to copy unrelated services. Real API, data and auth behavior are required where the blueprint requires them.') +
        ' Read recipes.workItems and fetch each exact page with recipes.resultId and recipes.pageIndex on portal_next or portal_status. Submit coreDeclarations for every page using its exact result/hash/work-item ID/kind and current target file hashes or assertion IDs. declarationStatus reports declarations only; actual native consumption must still be verified.' +
        ' Bind each rendered source root with data-sfp-root and each required interaction/form element with data-sfp-node using its exact captured node ID. Preserve source identity across routes and states. The interactionContract defines mandatory source assertions; unsupported required semantics block completion. Register typed native command.preview specifications with root set to ., exact source root/state (source:<nodeId>), route, viewport, oracle and assertion IDs. A prepared service-owned worker launches the direct Node server and Firefox; stdout reports do not prove execution. Workflow assertions must observe a real changed state. Temporal motion is validated separately from still images.',
      sourceInventory: plan.profiles.map((profile, index) => ({
        sourceId: this.sourceId(plan, index),
        sourceIndex: index,
        workspaceId: profile.workspaceId,
        rootPath: profile.rootPath,
        role: profile.role,
        files: requirePortalInventory(profile).files.slice(args.fileOffset, args.fileOffset + 200),
        totalFiles: requirePortalInventory(profile).files.length,
        nextOffset:
          args.fileOffset + 200 < requirePortalInventory(profile).files.length
            ? args.fileOffset + 200
            : null,
      })),
      evidence,
      designEvidence,
      assets,
      validationEvidence,
    };
  }
  /** Stable per verified grant, independent of ordering; Task 4 consumes sourceId + relative path. */
  private sourceId(plan: PortalPlan, sourceIndex: number): `sha256:${string}` {
    const profile = plan.profiles[sourceIndex]!;
    const grant = plan.repositories.find(
      root =>
        root.workspaceId === profile.workspaceId &&
        root.rootPath === profile.rootPath &&
        root.role === profile.role,
    );
    if (!grant) throw portalError('PORTAL_SOURCE_GRANT_REQUIRED');
    return qualifiedPortalSourceId(grant);
  }
  private async evidence(
    plan: PortalPlan,
    authority: PortalAuthority,
    requested: Array<{ sourceIndex: number; path: string }>,
  ) {
    const result: Array<{
      sourceId: string;
      sourceIndex: number;
      workspaceId: string;
      rootPath: string;
      role: 'target' | 'reference';
      path: string;
      sourceHash: string;
      content: string;
    }> = [];
    for (const item of requested) {
      const profile = plan.profiles[item.sourceIndex];
      const file =
        profile && requirePortalInventory(profile).files.find(entry => entry.path === item.path);
      if (!file) throw portalError('PORTAL_SOURCE_EVIDENCE_NOT_INCLUDED');
      if (file.classification === 'binary')
        throw portalError('PORTAL_SOURCE_TEXT_EVIDENCE_UNSUPPORTED');
    }
    let bytes = 0;
    for (const [sourceIndex, profile] of plan.profiles.entries()) {
      const grant = authority.roots.find(
        root =>
          root.workspaceId === profile.workspaceId &&
          root.role === profile.role &&
          root.rootPath === profile.rootPath,
      );
      const saved = plan.repositories.find(
        root =>
          root.workspaceId === profile.workspaceId &&
          root.role === profile.role &&
          root.rootPath === profile.rootPath,
      );
      if (
        !grant ||
        !saved ||
        grant.identity !== saved.identity ||
        grant.path !== saved.canonicalPath
      )
        throw portalError('PORTAL_SOURCE_GRANT_REQUIRED');
      const reader = new RepoReader({
        rootDir: grant.path,
        workspaceId: grant.workspaceId,
        workspacePolicy: this.policy,
      });
      for (const file of requirePortalInventory(profile).files) {
        if (
          requested.length &&
          !requested.some(item => item.sourceIndex === sourceIndex && item.path === file.path)
        )
          continue;
        if (file.classification === 'binary') continue;
        if (result.length >= 16 || bytes + file.bytes > 1_048_576) break;
        const contentBytes = await reader.readBytes(file.path);
        if (storedChecksum(contentBytes) !== file.hash) throw portalError('PORTAL_SOURCE_CHANGED');
        if (classifyPortalSourceBytes(contentBytes) !== 'text')
          throw portalError('PORTAL_SOURCE_TEXT_EVIDENCE_UNSUPPORTED');
        bytes += file.bytes;
        result.push({
          sourceId: this.sourceId(plan, sourceIndex),
          sourceIndex,
          workspaceId: profile.workspaceId,
          rootPath: profile.rootPath,
          role: profile.role,
          path: file.path,
          sourceHash: file.hash,
          content: redactSource(new TextDecoder('utf-8', { fatal: true }).decode(contentBytes)),
        });
      }
    }
    return result;
  }
  private async submit(
    args: z.infer<typeof PORTAL_INPUT_SCHEMAS.portal_submit>,
    execution: PortalExecution,
  ) {
    const plan = await this.plan(
      (await this.run(args.runId, execution.actor.actorId)).planId,
      execution.actor.actorId,
    );
    if (plan.blueprintHash !== args.blueprintHash || plan.contextHash !== args.contextHash)
      throw portalError('PORTAL_BLUEPRINT_CHANGED');
    const submittedFiles = [...args.files];
    if (args.assets.length) {
      const captured =
        plan.design.storage === 'owner-state'
          ? await this.store.get('designs', plan.planId, PortalCapturedDesignSchema)
          : null;
      if (
        !captured ||
        contentHash('sfp-portal-design-assets-v1', captured.assets) !==
          plan.design.assetManifestHash
      )
        throw portalError('PORTAL_ASSET_NOT_AVAILABLE');
      const reader = new RepoReader({
        rootDir: captured.assetRoot,
        signal: execution.signal,
        maxFileBytes: 16_777_216,
        maxTotalBytes: 33_554_432,
      });
      for (const asset of args.assets) {
        const original = captured.assets[asset.assetId];
        if (
          !original ||
          original.status !== 'captured' ||
          !original.path ||
          original.sha256 !== asset.contentHash
        )
          throw portalError('PORTAL_ASSET_NOT_AVAILABLE');
        const bytes = await reader.readBytes(original.path);
        if (storedChecksum(bytes) !== asset.contentHash) throw portalError('PORTAL_ASSET_CHANGED');
        submittedFiles.push({
          path: asset.path,
          action: asset.action,
          baseHash: asset.baseHash,
          contentHash: asset.contentHash,
          encoding: 'base64',
          content: Buffer.from(bytes).toString('base64'),
        });
      }
    }
    const result = await this.mutate(args.runId, execution, async run => {
      if (run.operations.some(operation => operation.id === execution.operationId)) return run;
      if (
        run.state !== 'generating' ||
        !run.lease ||
        run.lease.id !== args.leaseId ||
        run.lease.epoch !== args.leaseEpoch ||
        run.lease.authSessionId !== execution.actor.authSessionId ||
        run.lease.expiresAt <= this.now()
      )
        throw portalError('PORTAL_LEASE_INVALID');
      if (args.files.reduce((sum, file) => sum + portalContentBytes(file).length, 0) > 1_048_576)
        throw portalError('PORTAL_SUBMISSION_LIMIT');
      for (const file of submittedFiles) {
        if (
          !isPortalSourcePath(file.path) ||
          /(?:^|\/)(?:node_modules|\.git|\.sfp)\//u.test(file.path)
        )
          throw portalError('PORTAL_SOURCE_PATH_FORBIDDEN');
        if (plan.implementationScope === 'frontend-only' && file.encoding === 'utf8')
          assertFrontendSource(file.path, file.content);
        const bytes = portalContentBytes(file);
        if (storedChecksum(bytes) !== file.contentHash)
          throw portalError('PORTAL_CANDIDATE_HASH_MISMATCH');
        const id = file.contentHash.slice(7);
        // eslint-disable-next-line no-await-in-loop -- resolve immutable content before publishing its durable pointer
        const old = await this.store.get('contents', id, contentSchema);
        // eslint-disable-next-line no-await-in-loop -- durable immutable content precedes the run pointer
        if (old === null)
          await this.store.create(
            'contents',
            id,
            { content: file.content, hash: file.contentHash, encoding: file.encoding },
            contentSchema,
          );
        const row = {
          path: file.path,
          action: file.action,
          baseHash: file.baseHash,
          contentHash: file.contentHash,
          encoding: file.encoding,
          artifact: {
            path: `contents/${id}.json`,
            hash: file.contentHash,
            bytes: bytes.length,
          },
        };
        const index = run.files.findIndex(item => item.path === file.path);
        if (index < 0) run.files.push(row);
        else run.files[index] = row;
      }
      if (
        run.files.length > 300 ||
        run.files.reduce((sum, file) => sum + file.artifact.bytes, 0) > 67_108_864
      )
        throw portalError('PORTAL_CANDIDATE_LIMIT');
      if (!this.recipes || !plan.coreRecipes) throw portalError('PORTAL_CORE_REPLAN_REQUIRED');
      const available = new Map(
        plan.profiles
          .filter(profile => profile.role === 'target')
          .flatMap(
            profile =>
              profile.graph.sourceInventory?.files.map(file => [file.path, file.hash] as const) ??
              [],
          ),
      );
      for (const file of run.files) available.set(file.path, file.contentHash);
      run.coreDeclarations = await this.recipes.mergeDeclarations(
        { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
        plan.coreRecipes,
        [...available].map(([path, hash]) => ({ path, hash })),
        run.coreDeclarations ?? [],
        args.coreDeclarations,
        args.finished,
      );
      run.coreDeclarationsHash = coreDeclarationsHash(run.coreDeclarations);
      if (run.validation) run.lastValidation = run.validation;
      run.validation = null;
      run.candidateHash = portalCandidateHash(run.files, plan, run.coreDeclarations);
      if (args.finished) {
        run.state = 'candidate-ready';
        run.lease = null;
      }
      return run;
    });
    return publicRun(result);
  }
  private async contents(run: PortalRun) {
    return Promise.all(
      run.files.map(async file => {
        const value = await this.store.get('contents', file.contentHash.slice(7), contentSchema);
        if (!value || value.hash !== file.contentHash) throw portalError('PORTAL_CONTENT_MISSING');
        return { path: file.path, content: value.content, encoding: value.encoding };
      }),
    );
  }
  private async validationEvidence(run: PortalRun) {
    const report = run.validation ?? run.lastValidation;
    const path = report?.evidencePaths.find(candidate =>
      /^portal\/validation\/[a-f0-9]{64}\.json$/u.test(candidate),
    );
    if (!report || !path) return null;
    const record = await this.store.get(
      'validation',
      path.split('/')[2]!.slice(0, -5),
      PortalStoredValidationSchema,
    );
    if (!record || record.report.sourceHash !== report.sourceHash)
      throw portalError('PORTAL_VALIDATION_EVIDENCE_CHANGED');
    const evidence = record.commandEvidence as { commands?: unknown };
    if (!Array.isArray(evidence.commands)) throw portalError('PORTAL_VALIDATION_EVIDENCE_CHANGED');
    return {
      sourceHash: report.sourceHash,
      commands: evidence.commands.slice(-4).map(value => {
        const command = value as Record<string, unknown>,
          output = typeof command.output === 'string' ? command.output : '';
        return {
          commandId: String(command.commandId),
          status: String(command.status),
          exitCode: typeof command.exitCode === 'number' ? command.exitCode : null,
          output: output.slice(0, 65536),
          truncated: output.length > 65536,
        };
      }),
    };
  }
  private async validate(
    id: string,
    target: 'candidate' | 'applied',
    execution: PortalExecution,
    profileId: string,
  ) {
    const initial = await this.mutate(id, execution, run => {
      if (
        execution.authority.candidateHash !== undefined &&
        execution.authority.candidateHash !== run.candidateHash
      )
        throw portalError('PORTAL_CANDIDATE_CHANGED');
      if (
        !['candidate-ready', 'blocked', 'ready-to-apply', 'applied-awaiting-validation'].includes(
          run.state,
        )
      )
        throw portalError('PORTAL_STATE_NOT_VALIDATABLE');
      if (target === 'applied' && !run.appliedHash) throw portalError('PORTAL_NOT_APPLIED');
      if (target === 'candidate' && run.appliedHash) throw portalError('PORTAL_ALREADY_APPLIED');
      if (!run.candidateHash) throw portalError('PORTAL_NO_CANDIDATE');
      run.lease = null;
      run.leaseEpoch++;
      run.state = target === 'candidate' ? 'validating-candidate' : 'validating-applied';
      return run;
    });
    try {
      const plan = await this.plan(initial.planId, execution.actor.actorId);
      const contents = await this.contents(initial);
      execution.signal.throwIfAborted();
      const report = await this.work.validate(
        plan,
        initial,
        contents,
        execution.signal,
        target,
        profileId,
        execution.authority,
        execution.capture,
      );
      return publicRun(
        await this.mutate(id, execution, run => {
          if (run.state === 'cancel-requested' || run.state === 'cancelled') return run;
          if (run.version !== initial.version) throw portalError('PORTAL_VALIDATION_SUPERSEDED');
          if (run.candidateHash !== initial.candidateHash)
            throw portalError('PORTAL_CANDIDATE_CHANGED');
          run.validation = report;
          const issues = portalCompletionIssues(
            plan,
            report,
            initial.candidateHash!,
            initial,
            target,
          );
          run.issues = [...plan.issues, ...issues];
          run.state = issues.length
            ? 'blocked'
            : target === 'candidate'
              ? 'ready-to-apply'
              : 'completed';
          return run;
        }),
      );
    } catch (error) {
      await this.mutate(id, execution, run => {
        if (run.state.startsWith('validating')) {
          run.state = 'blocked';
          run.issues.push((error as { code?: string }).code ?? 'PORTAL_VALIDATION_FAILED');
        }
        return run;
      });
      throw error;
    }
  }
  private async apply(id: string, execution: PortalExecution) {
    const initial = await this.mutate(id, execution, run => {
      if (
        execution.authority.candidateHash !== undefined &&
        execution.authority.candidateHash !== run.candidateHash
      )
        throw portalError('PORTAL_CANDIDATE_CHANGED');
      if (
        run.state !== 'ready-to-apply' ||
        !run.validation ||
        run.validation.sourceHash !== run.candidateHash
      )
        throw portalError('PORTAL_VALIDATION_REQUIRED');
      run.state = 'applying';
      return run;
    });
    try {
      const plan = await this.plan(initial.planId, execution.actor.actorId);
      const contents = await this.contents(initial);
      execution.signal.throwIfAborted();
      const result = await this.work.apply(
        plan,
        initial,
        contents,
        execution.authority,
        execution.signal,
      );
      return publicRun(
        await this.mutate(id, execution, run => {
          run.appliedHash = result.hash;
          run.state =
            run.state === 'cancel-requested' || run.state === 'cancelled'
              ? 'conflict'
              : 'applied-awaiting-validation';
          run.validation = null;
          return run;
        }),
      );
    } catch (error) {
      await this.mutate(id, execution, run => {
        run.state = (error as { committed?: boolean }).committed ? 'outcome-unknown' : 'conflict';
        run.issues.push((error as { code?: string }).code ?? 'PORTAL_APPLY_FAILED');
        return run;
      });
      throw error;
    }
  }
}
