/* eslint-disable no-await-in-loop -- source copying and journaled compare-and-swap writes have strict ordering */
import { lstat, mkdtemp, mkdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contentHash,
  PortalPlanSchema,
  PortalRunSchema,
  portalCompletionIssues,
  storedChecksum,
  type PortalPlan,
  type PortalRun,
} from '@sfp/ir';
import {
  PortalAcceptanceSchema,
  PortalCheckSchema,
  PortalHashSchema,
  PortalIdSchema,
  PortalPathSchema,
  type PortalAcceptance,
  type WorkspacePolicy,
} from '@sfp/shared';
import {
  PortalSourceAuthorityVersionSchema,
  assertCurrentPortalSourceAuthority,
  assertCurrentPortalAnalysis,
} from '@sfp/shared';
import { z } from 'zod';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { PortalRecipeUseSchema } from '../../../shared/src/portal-recipe-use.js';
import { CorePreparations } from './recipes/core-preparation.js';
import { PortalCoreLifecycle } from './recipes/core-lifecycle.js';
import { loadCoreConsumptionInput } from './recipes/consumption-input.js';
import { compileCoreConsumption, attachCoreConsumption } from './recipes/core-consumption.js';
import { PortalObservationManifestSchema } from '../../../shared/src/portal-observations.js';
import {
  AtomicFileStore,
  readFileWithinLimit,
  WorkspaceAtomicFileStore,
  withRetainedDirectoryChain,
} from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import {
  createStatePermissions,
  type BoundStatePermissions,
} from '../security/state-permissions.js';
import { resolvePortalAuthority, rootIdentity, type PortalAuthority } from './authority.js';
import { portalContentBytes, type PortalFileContent } from './content.js';
import type { PortalWorkPort } from './coordinator.js';
import {
  PortalCapturedDesignSchema,
  portalDesignFingerprint,
  assertPortalCaptureDescriptor,
  verifyPortalCaptureFiles,
  assertPortalCapturedGrant,
  describePortalCapture,
  type PortalDesignCapturePort,
} from './design-capture.js';
import { derivePortalInteractionContract } from './interaction-evidence.js';
import {
  nativeScriptPackageTrees,
  prepareNativeArtifactAuthority,
  verifyNativeArtifactAuthority,
  verifyNativeOutputReceipts,
} from './native-artifacts.js';
import { NativeEnvironmentLifecycle } from './native-lifecycle.js';
import { verifyNativeModuleEvidence } from './native-module-fence.js';
import {
  expandNativeEnvironment,
  verifyNativeEnvironment,
  prepareNativeEnvironment,
  NativeEnvironmentExecutionSchema,
  type NativeEnvironmentExecution,
} from './native-resources.js';
import { NativePortalRunner, NativeProfileSchema } from './native-runner.js';
import { preparePortalObservationManifest } from './observation-manifest.js';
import { NATIVE_PREVIEW_BOOTSTRAP } from './preview-worker.js';
import {
  assertPortalProfileClosure,
  requirePortalInventory,
  portalBaselineFiles,
  portalMaterialFiles,
  assertPortalMaterialFiles,
} from './profile-closure.js';
import { isPortalSourcePath } from './service-graph.js';
import { selectPortalServices } from './service-selection.js';
import { assertFrontendSource } from './source-guard.js';
import { collectPortalSourceInventory } from './source-inventory.js';
import { PortalStore, portalError } from './store.js';
import { verifyPortalVisualEvidence } from './visual-evidence.js';

/** Owner-reviewed assertions map concrete native commands to acceptance requirements. */
export const PortalNativeProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    ownerId: z.string().min(1),
    planId: PortalIdSchema,
    contextHash: PortalHashSchema,
    native: NativeProfileSchema,
    observationManifest: PortalObservationManifestSchema.optional(),
    recipeUse: PortalRecipeUseSchema.optional(),
    sourceReviews: z
      .array(
        z
          .object({
            sourceId: PortalHashSchema.optional(),
            sourceIndex: z.number().int().min(0).max(8).optional(),
            workspaceId: z.string(),
            rootPath: z.string(),
            path: PortalPathSchema,
            hash: PortalHashSchema,
            layers: z
              .array(
                z.enum([
                  'frontend',
                  'backend',
                  'api',
                  'database',
                  'authentication',
                  'authorization',
                  'jobs',
                  'storage',
                  'integration',
                  'configuration',
                ]),
              )
              .min(1),
            conclusion: z.string().min(20).max(4096),
          })
          .strict(),
      )
      .max(5000)
      .default([]),
    assertions: z
      .array(
        z
          .object({
            commandId: z.string(),
            check: PortalCheckSchema.omit({ status: true, reason: true }),
          })
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict()
  .superRefine((profile, ctx) => {
    const commands = new Set(profile.native.commands.map(command => command.id));
    if (profile.assertions.some(assertion => !commands.has(assertion.commandId)))
      ctx.addIssue({
        code: 'custom',
        message: 'Every acceptance assertion must name a reviewed command',
      });
    if (
      new Set(profile.assertions.map(assertion => assertion.check.id)).size !==
      profile.assertions.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate acceptance check ID' });
  });
export type PortalNativeProfile = z.infer<typeof PortalNativeProfileSchema>;
export const PortalNativeRegistrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    planId: PortalIdSchema,
    contextHash: PortalHashSchema,
    native: NativeProfileSchema,
    recipeUse: PortalRecipeUseSchema.optional(),
    sourceReviews: PortalNativeProfileSchema.shape.sourceReviews,
    assertions: PortalNativeProfileSchema.shape.assertions,
  })
  .strict();
const ApplySchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    runId: PortalIdSchema,
    ownerId: z.string(),
    candidateHash: PortalHashSchema,
    authorityHash: PortalHashSchema,
    targetIdentity: z.string().min(1).max(512).nullable().optional(),
    state: z.enum(['prepared', 'applying', 'applied', 'conflict']),
    files: z
      .array(
        z
          .object({
            path: PortalPathSchema,
            before: PortalHashSchema.nullable(),
            after: PortalHashSchema,
            state: z.enum(['pending', 'intent', 'written']),
          })
          .strict(),
      )
      .max(300),
  })
  .strict();
export const PortalStoredValidationSchema = z
  .object({
    report: PortalAcceptanceSchema,
    commandEvidence: z.unknown(),
    workPath: z.string(),
    sourceReviews: PortalNativeProfileSchema.shape.sourceReviews,
  })
  .strict();
const exists = async (path: string) =>
  lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

/** Native execution and source publication. Reference roots are always read-only. */
export class PortalNativeWork implements PortalWorkPort {
  private readonly jobs = new Map<
    string,
    { controller: AbortController; done: Promise<unknown> }
  >();
  readonly environments: NativeEnvironmentLifecycle;
  private readonly runner: NativePortalRunner;
  private readonly permissions: BoundStatePermissions;
  private readonly coreLifecycle: PortalCoreLifecycle;
  constructor(
    private readonly options: {
      stateRoot: string;
      leaderGeneration?: string;
      store: PortalStore;
      policy: WorkspacePolicy;
      permissions?: BoundStatePermissions;
      runner?: NativePortalRunner;
      designCapture?: PortalDesignCapturePort;
      validatorModuleUrl?: string;
      firefoxExecutable?: string;
    },
  ) {
    this.environments = new NativeEnvironmentLifecycle(
      options.store,
      options.stateRoot,
      options.permissions,
      options.leaderGeneration,
    );
    this.runner = options.runner ?? new NativePortalRunner();
    this.permissions = options.permissions ?? createStatePermissions(options.stateRoot);
    this.coreLifecycle=new PortalCoreLifecycle(new CorePreparations({stateRoot:options.stateRoot,store:options.store,permissions:this.permissions}));
  }

  async cancel(runId: string): Promise<void> {
    const job = this.jobs.get(runId);
    job?.controller.abort(portalError('OPERATION_CANCELLED'));
    await this.runner.cancel(runId);
    await job?.done.catch(error => {
      if ((error as { code?: string }).code === 'PORTAL_NATIVE_CLEANUP_UNKNOWN') throw error;
    });
  }
  async close(): Promise<void> {
    await Promise.all([...this.jobs.keys()].map(runId => this.cancel(runId)));
    await this.runner.close();
  }
  private async owned<T>(
    runId: string,
    signal: AbortSignal,
    deadlineAt: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.jobs.has(runId)) throw portalError('PORTAL_NATIVE_RUN_BUSY');
    signal.throwIfAborted();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0 || remaining > 3_600_000) throw portalError('PORTAL_BUDGET_EXHAUSTED');
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(portalError('PORTAL_BUDGET_EXHAUSTED')),
      remaining,
    );
    const combined = AbortSignal.any([signal, controller.signal]);
    const done = Promise.resolve().then(() => work(combined));
    this.jobs.set(runId, { controller, done });
    try {
      return await done;
    } finally {
      clearTimeout(timer);
      this.jobs.delete(runId);
    }
  }
  async assertCapture(plan: PortalPlan): Promise<void> {
    if (!plan.design.capture || plan.design.storage !== 'owner-state')
      throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
    if (
      plan.design.artifactHash !== plan.design.capture.rawHash ||
      plan.design.assetManifestHash !== plan.design.capture.assetManifestHash ||
      plan.request.design.source !== plan.design.capture.source.kind ||
      parseFigmaTarget(plan.design.url).url !== plan.design.capture.source.url
    )
      throw portalError('PORTAL_CAPTURE_EVIDENCE_CHANGED');
    const captured = await this.options.store.get(
      'designs',
      plan.planId,
      PortalCapturedDesignSchema,
    );
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
  validate(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    signal: AbortSignal,
    target: 'candidate' | 'applied',
    profileId: string,
    prepared?: PortalAuthority,
    capture?: PortalDesignCapturePort,
  ): Promise<PortalAcceptance> {
    return this.owned(run.runId, signal, run.deadlineAt, ownedSignal =>
      this.validateFiles(plan, run, files, ownedSignal, target, profileId, prepared, capture),
    );
  }
  apply(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<{ hash: `sha256:${string}` }> {
    return this.owned(run.runId, signal, run.deadlineAt, ownedSignal =>
      this.applyFiles(plan, run, files, authority, ownedSignal),
    );
  }
  async reconcile(
    plan: PortalPlan,
    run: PortalRun,
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<{
    state: 'not-applied' | 'applied' | 'partial' | 'conflict';
    files: Array<{ path: string; state: 'preimage' | 'candidate' | 'conflict' | 'recoverable' }>;
  }> {
    if (this.jobs.has(run.runId)) throw portalError('PORTAL_NATIVE_RUN_BUSY');
    const record = await this.options.store.get('apply', run.runId, ApplySchema);
    if (!record) throw portalError('PORTAL_APPLY_EVIDENCE_REQUIRED');
    if (
      record.ownerId !== plan.ownerId ||
      record.candidateHash !== run.candidateHash ||
      record.authorityHash !== authority.hash
    )
      throw portalError('PORTAL_APPLY_RECORD_CONFLICT');
    const files: Array<{
      path: string;
      state: 'preimage' | 'candidate' | 'conflict' | 'recoverable';
    }> = [];
    for (const file of record.files) {
      signal.throwIfAborted();
      try {
        const recovery =
          plan.sourceAuthorityVersion === 2 &&
          run.sourceAuthorityVersion === 2 &&
          record.sourceAuthorityVersion === 2
            ? await this.recoveryState(authority.roots[0]!, file, signal)
            : null;
        const hash = recovery
          ? recovery.actual
          : await this.currentHash(authority, file.path, signal);
        const state = recovery?.recoverable
          ? 'recoverable'
          : hash === file.after && file.state !== 'pending'
            ? 'candidate'
            : hash === file.before && file.state !== 'written'
              ? 'preimage'
              : 'conflict';
        files.push({ path: file.path, state });
      } catch (error) {
        if ((error as { code?: string }).code !== 'PORTAL_APPLIED_SOURCE_CHANGED') throw error;
        files.push({ path: file.path, state: 'conflict' });
      }
    }
    const current =
      plan.sourceAuthorityVersion === 2 &&
      run.sourceAuthorityVersion === 2 &&
      record.sourceAuthorityVersion === 2;
    let baselineConflict = false;
    if (current) {
      try {
        await this.verifyMixed(plan, run, authority, record, signal);
      } catch (error) {
        if ((error as { code?: string }).code !== 'PORTAL_APPLIED_SOURCE_CHANGED') throw error;
        baselineConflict = true;
        for (const path of (error as { conflicts?: string[] }).conflicts ?? [])
          if (!files.some(file => file.path === path)) files.push({ path, state: 'conflict' });
      }
    }
    const state =
      baselineConflict || files.some(file => file.state === 'conflict')
        ? 'conflict'
        : files.every(file => file.state === 'candidate')
          ? 'applied'
          : files.every(file => file.state === 'preimage')
            ? 'not-applied'
            : 'partial';
    if (state === 'applied' && current)
      await this.options.store.update('apply', run.runId, ApplySchema, value => {
        value.state = 'applied';
        for (const file of value.files) file.state = 'written';
        return value;
      });
    return { state, files };
  }

  async prepareValidation(
    plan: PortalPlan,
    run: PortalRun,
    profileId: string,
    target: 'candidate' | 'applied',
    operationId: string,
    authority: PortalAuthority,
  ): Promise<NativeEnvironmentExecution> {
    assertCurrentPortalSourceAuthority(plan, run);
    assertCurrentPortalAnalysis(plan);
    await this.assertCapture(plan);
    const key = contentHash('sfp-portal-profile-key-v1', {
      planId: plan.planId,
      profileId,
      candidateHash: run.candidateHash,
    }).slice(7);
    const profile = await this.options.store.get('profiles', key, PortalNativeProfileSchema);
    if (!profile || profile.ownerId !== plan.ownerId || profile.contextHash !== plan.contextHash)
      throw portalError('PORTAL_NATIVE_PROFILE_REQUIRED');
    await this.assertPreparedProfile(profile);
    const grant = await verifyNativeEnvironment(profile, this.options.stateRoot, [
      ...authority.roots.map(root => root.path),
      ...(profile.native.externalArtifacts ?? []).map(value => value.root),
    ]);
    return expandNativeEnvironment(grant, {
      operationId,
      runId: run.runId,
      target,
      profileHash: contentHash('sfp-portal-profile-v1', profile),
      repositoryHash: authority.hash,
      repositoryKey: authority.resource.key,
    });
  }

  private async validateFiles(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    signal: AbortSignal,
    target: 'candidate' | 'applied',
    profileId: string,
    prepared?: PortalAuthority,
    capture?: PortalDesignCapturePort,
  ): Promise<PortalAcceptance> {
    if (plan.request.design.freshness === 'require-live') {
      const grant = prepared?.captureSource;
      if (
        !grant ||
        grant.kind !== plan.request.design.source ||
        grant.url !== parseFigmaTarget(plan.design.url).url ||
        (!capture && (grant.kind === 'desktop' || !this.options.designCapture))
      )
        throw portalError('PORTAL_CAPTURE_ADMISSION_REQUIRED');
    }
    const profileKey = contentHash('sfp-portal-profile-key-v1', {
      planId: plan.planId,
      profileId,
      candidateHash: run.candidateHash,
    }).slice(7);
    const profile = await this.options.store.get('profiles', profileKey, PortalNativeProfileSchema);
    if (!profile) throw portalError('PORTAL_NATIVE_PROFILE_REQUIRED');
    assertCurrentPortalAnalysis(plan);
    await this.assertCapture(plan);
    assertCurrentPortalSourceAuthority(plan, run, profile, profile.native);
    assertPortalProfileClosure(plan, run, profile.native);
    if (
      profile.ownerId !== plan.ownerId ||
      profile.planId !== plan.planId ||
      profile.contextHash !== plan.contextHash ||
      profile.native.sourceHash !== run.candidateHash ||
      profile.native.id !== profileId
    )
      throw portalError('PORTAL_NATIVE_PROFILE_SCOPE_CHANGED');
    const authority = await resolvePortalAuthority(
      this.options.policy,
      plan.workspaceId,
      plan.request,
      plan.planId,
      plan.implementationScope,
      plan,
      target === 'applied',
    );
    assertCurrentPortalAnalysis(plan);
    await this.assertCapture(plan);
    assertCurrentPortalSourceAuthority(plan, run);
    this.checkContents(plan, run, files);
    if (target === 'candidate') await this.verifySources(plan, authority, signal, profile);
    if (target === 'applied') await this.verifyApplied(plan, run, authority, signal);
    if (!prepared?.nativeEnvironment) throw portalError('PORTAL_ENVIRONMENT_ADMISSION_REQUIRED');
    const execution = NativeEnvironmentExecutionSchema.parse(prepared.nativeEnvironment);
    const expected = await this.prepareValidation(
      plan,
      run,
      profileId,
      target,
      execution.operationId,
      authority,
    );
    if (
      contentHash('sfp-native-execution-envelope-v1', expected) !==
        contentHash('sfp-native-execution-envelope-v1', execution) ||
      prepared.executionAuthorityHash !== execution.hash
    )
      throw portalError('PORTAL_ENVIRONMENT_ADMISSION_CHANGED');
    const grant = await verifyNativeEnvironment(
      profile,
      this.options.stateRoot,
      authority.roots.map(root => root.path),
    );
    await this.environments.acquire(execution, grant, signal);
    try {
      const workPath = await this.environments.ownedChild(execution.attemptId, 'work');
      await this.stage(plan, run, files, authority, signal, target, profile, workPath);
      const privateHome = await this.environments.ownedChild(execution.attemptId, 'home');
      const captured =
        plan.design.storage === 'owner-state'
          ? await this.options.store.get('designs', plan.planId, PortalCapturedDesignSchema)
          : null;
      if (
        captured &&
        contentHash('sfp-portal-design-assets-v1', captured.assets) !==
          plan.design.assetManifestHash
      )
        throw portalError('PORTAL_DESIGN_HASH_MISMATCH');
      await this.assertPreparedProfile(profile);
      const native = profile.native;
      const result = await this.runner.execute(
        run.runId,
        native,
        workPath,
        run.candidateHash!,
        signal,
        run.deadlineAt,
        { execution, lifecycle: this.environments, privateHome },
      );
      if (target === 'applied') await this.verifyApplied(plan, run, authority, signal);
      await this.assertPreparedProfile(profile);
      const checks = profile.assertions.map(({ commandId, check }) => {
        const command = result.commands.find(entry => entry.commandId === commandId);
        return {
          ...check,
          status:
            command?.status === 'passed'
              ? ('passed' as const)
              : command
                ? ('failed' as const)
                : ('blocked' as const),
          ...(command?.status === 'passed'
            ? {}
            : {
                reason: command
                  ? `Native command ${commandId}: ${command.status}`
                  : `Native command ${commandId} did not execute`,
              }),
        };
      });
      checks.push({
        id: 'native-command-sequence',
        kind: 'source-scope',
        requirementIds: [],
        required: true,
        status:
          result.commands.length === profile.native.commands.length &&
          result.commands.every(
            command =>
              command.status === 'passed' &&
              command.moduleEvidence?.protocol === 'sfp-native-module-fence-v1',
          )
            ? 'passed'
            : 'failed',
        reason: 'Every approved native command must execute successfully.',
      });
      const visualAssertions = profile.assertions.filter(entry => entry.check.kind === 'visual');
      const visualCommands = new Set(visualAssertions.map(entry => entry.commandId));
      const visualOutput = result.commands
        .filter(
          command =>
            visualCommands.has(command.commandId) &&
            command.status === 'passed' &&
            command.previewReceipt,
        )
        .map(command => 'SFP_PREVIEW_REPORT:' + JSON.stringify(command.previewReceipt!.report))
        .join('\n');
      const publishedFiles = new Map<string, string>();
      if (plan.strategy === 'legacy-portal') {
        for (const source of plan.profiles.filter(entry => entry.role === 'target'))
          for (const file of requirePortalInventory(source).files)
            publishedFiles.set(file.path, file.hash);
      }
      for (const file of run.files) publishedFiles.set(file.path, file.contentHash);
      const visualVerified =
        visualAssertions.length > 0 &&
        (await verifyPortalVisualEvidence(
          captured,
          visualOutput,
          workPath,
          signal,
          publishedFiles,
          profile.observationManifest,
          plan.interactionContract,
        ));
      for (const { commandId, check } of profile.assertions.filter(entry =>
        ['visual', 'interaction', 'accessibility'].includes(entry.check.kind),
      )) {
        const resultCheck = checks.find(entry => entry.id === check.id)!;
        if (
          resultCheck.status === 'passed' &&
          (!visualVerified ||
            !result.commands.some(
              command => command.commandId === commandId && command.previewReceipt,
            ))
        ) {
          resultCheck.status = 'blocked';
          resultCheck.reason = 'PORTAL_DESIGN_ORACLE_COVERAGE_REQUIRED';
        }
      }
      checks.push({
        id: 'native-source-scope',
        kind: 'source-scope',
        requirementIds: [],
        required: true,
        status: 'passed',
      });
      if (!captured) throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
      assertPortalCaptureDescriptor(captured, plan.design.capture);
      let liveDesignVerified = false;
      let freshDesignFingerprint: string | null = null;
      const scopedCapture =
        capture ??
        (prepared?.captureSource?.kind === 'chrome' ? this.options.designCapture : undefined);
      if (plan.request.design.freshness === 'require-live' && captured && scopedCapture) {
        if (!prepared?.captureSource) throw portalError('PORTAL_CAPTURE_ADMISSION_REQUIRED');
        const refreshed = await scopedCapture.capture(plan.planId, plan.design.url, signal);
        if (!prepared?.captureSource) throw portalError('PORTAL_CAPTURE_ADMISSION_REQUIRED');
        assertPortalCapturedGrant(refreshed, prepared.captureSource);
        await verifyPortalCaptureFiles(refreshed, signal);
        const fresh = describePortalCapture(
          refreshed,
          plan.design.capture!.source,
          prepared.captureSource,
        );
        freshDesignFingerprint = fresh.designFingerprint;
        liveDesignVerified =
          JSON.stringify(fresh.source) === JSON.stringify(plan.design.capture!.source) &&
          portalDesignFingerprint(refreshed) === portalDesignFingerprint(captured);
      }
      await this.assertPreparedProfile(profile);
      await verifyNativeOutputReceipts(workPath, result.outputReceipts, signal);
      for (const command of result.commands)
        if (command.moduleEvidence)
          await verifyNativeModuleEvidence(command.moduleEvidence, signal);
      if (target === 'applied') await this.verifyApplied(plan, run, authority, signal);
      const receipt = await this.environments.finish(execution.attemptId);
      await this.assertCapture(plan);
      if (target === 'applied') await this.verifyApplied(plan, run, authority, signal);
      const report = PortalAcceptanceSchema.parse({
        capture: {
          version: 2,
          originalDescriptorHash: contentHash(
            'sfp-portal-capture-descriptor-v2',
            plan.design.capture,
          ),
          freshDesignFingerprint,
        },
        nativeEnvironment: {
          version: 1,
          attemptId: execution.attemptId,
          executionHash: execution.hash,
          receiptHash: contentHash('sfp-native-lifecycle-receipt-v1', receipt),
          target,
          disposition: 'retained-artifact',
        },
        nativeArtifactAuthority: {
          version: 1,
          moduleFenceProtocol: 'sfp-native-module-fence-v1',
          moduleEvidenceHash: contentHash(
            'sfp-native-module-execution-evidence-v1',
            result.commands.map(command => ({
              commandId: command.commandId,
              commandHash: command.commandHash,
              moduleEvidence: command.moduleEvidence ?? null,
            })),
          ),
          manifestHash: result.artifactAuthorityHash,
          outputReceiptHash: contentHash('sfp-native-output-receipts-v1', result.outputReceipts),
        },
        sourceAuthorityVersion: 2,
        analysisHash: contentHash('sfp-portal-analysis-receipt-v1', {
          selection: plan.serviceSelection,
          coverage: plan.workflowCoverage,
        }),
        sourceHash: run.candidateHash,
        designHash: plan.design.artifactHash,
        environmentId: execution.attemptId,
        checks,
        liveDesignVerified,
        ...(visualVerified && profile.observationManifest && plan.interactionContract
          ? {
              observations: {
                version: 1,
                manifestHash: contentHash(
                  'sfp-observation-manifest-v1',
                  profile.observationManifest,
                ),
                interactionContractHash: contentHash(
                  'sfp-interaction-contract-v1',
                  plan.interactionContract,
                ),
                receiptHash: contentHash(
                  'sfp-owned-preview-receipts-v1',
                  result.commands.flatMap(command =>
                    command.previewReceipt ? [command.previewReceipt] : [],
                  ),
                ),
                executedObservationIds: profile.observationManifest.screens.map(value => value.id),
                executedAssertionIds: plan.interactionContract.interactions.map(value => value.id),
                executedWorkflowIds: plan.interactionContract.workflowIds,
              },
            }
          : {}),
        runtimeVerified:
          visualVerified &&
          Boolean(profile.observationManifest) &&
          checks.some(
            check =>
              check.status === 'passed' &&
              [
                'interaction',
                'api',
                'persistence',
                'authorization',
                'integration',
                'journey',
              ].includes(check.kind),
          ),
        evidencePaths: [],
      });
      const evidenceId = contentHash('sfp-portal-native-result-v1', {
        runId: run.runId,
        version: run.version,
        target,
        result,
        report,
      }).slice(7);
      report.evidencePaths.push(`portal/validation/${evidenceId}.json`);
      await this.options.store.create(
        'validation',
        evidenceId,
        { report, commandEvidence: result, workPath, sourceReviews: profile.sourceReviews },
        PortalStoredValidationSchema,
      );
      return report;
    } catch (error) {
      await this.environments
        .finish(execution.attemptId)
        .catch(async () =>
          this.environments
            .quarantine(execution.attemptId, 'PORTAL_NATIVE_CLEANUP_UNKNOWN')
            .catch(() => {}),
        );
      throw error;
    }
  }

  /** Called only from an owner-authorized profile registration path, never from agent submissions. */
  private async consumptionInput(profile:PortalNativeProfile,target?:'candidate'|'applied',signal?:AbortSignal){
    const run=await this.options.store.get('runs',profile.planId,PortalRunSchema);
    if(!run || run.ownerId!==profile.ownerId)throw portalError('PORTAL_RUN_NOT_FOUND');
    return loadCoreConsumptionInput({store:this.options.store,lifecycle:this.coreLifecycle,policy:this.options.policy,
      verifyAppliedTarget:async(plan,run,signal)=>{
        const authority=await resolvePortalAuthority(this.options.policy,plan.workspaceId,plan.request,plan.planId,plan.implementationScope,plan);
        await this.verifyApplied(plan,run,authority,signal);
      },
    },{ownerId:profile.ownerId,planId:profile.planId,candidateHash:profile.native.sourceHash,target:target??(run.appliedHash?'applied':'candidate')},signal);
  }
  async assertRecipeRegistration(input:PortalNativeProfile):Promise<void>{
    const profile=PortalNativeProfileSchema.parse(input);
    await this.assertPreparedProfile(profile);
    if(profile.recipeUse?.prepared?.status!=='ready')throw portalError('PORTAL_CONSUMPTION_PREPARATION_REQUIRED');
  }
  async registerProfile(input: PortalNativeProfile): Promise<string> {
    const profile = PortalNativeProfileSchema.parse(input);
    assertCurrentPortalSourceAuthority(profile, profile.native);
    const plan = await this.options.store.get('plans', profile.planId, PortalPlanSchema);
    if (!plan || plan.ownerId !== profile.ownerId || plan.contextHash !== profile.contextHash)
      throw portalError('PORTAL_PLAN_NOT_FOUND');
    await this.assertCapture(plan);
    await this.assertRecipeRegistration(profile);
    const id = contentHash('sfp-portal-profile-key-v1', {
      planId: profile.planId,
      profileId: profile.native.id,
      candidateHash: profile.native.sourceHash,
    }).slice(7);
    await this.options.store.create('profiles', id, profile, PortalNativeProfileSchema);
    return id;
  }

  /** Read-only owner-scoped preparation; returned bytes must be approved before registration. */
  async prepareProfile(input: PortalNativeProfile): Promise<PortalNativeProfile> {
    const profile = PortalNativeProfileSchema.parse(input);
    assertCurrentPortalSourceAuthority(profile, profile.native);
    const plan = await this.options.store.get('plans', profile.planId, PortalPlanSchema);
    if (!plan || plan.ownerId !== profile.ownerId || plan.contextHash !== profile.contextHash)
      throw portalError('PORTAL_PLAN_NOT_FOUND');
    assertCurrentPortalSourceAuthority(plan);
    assertCurrentPortalAnalysis(plan);
    await this.assertCapture(plan);
    const environment = { ...profile.native.environment };
    const declarations = [...(profile.native.externalArtifacts ?? [])].filter(
      value => !['service-bundle', 'browser-runtime', 'captured-assets'].includes(value.kind),
    );
    delete environment.SFP_PORTAL_VALIDATOR_URL;
    delete environment.SFP_PORTAL_FIREFOX_EXECUTABLE;
    delete environment.SFP_FIGMA_ASSET_ROOT;
    if (this.options.validatorModuleUrl) {
      const entry = fileURLToPath(this.options.validatorModuleUrl);
      environment.SFP_PORTAL_VALIDATOR_URL = this.options.validatorModuleUrl;
      declarations.push({ root: dirname(entry), kind: 'service-bundle' });
      declarations.push(...(await nativeScriptPackageTrees(entry, dirname(entry))));
    }
    if (this.options.firefoxExecutable) {
      environment.SFP_PORTAL_FIREFOX_EXECUTABLE = this.options.firefoxExecutable;
      declarations.push({ root: dirname(this.options.firefoxExecutable), kind: 'browser-runtime' });
    }
    const captured = await this.options.store.get(
      'designs',
      profile.planId,
      PortalCapturedDesignSchema,
    );
    if (captured) {
      environment.SFP_FIGMA_ASSET_ROOT = captured.assetRoot;
      declarations.push({ root: captured.assetRoot, kind: 'captured-assets' });
    }
    const externalArtifacts = declarations
      .filter(
        (value, index) =>
          declarations.findIndex(
            other => other.root === value.root && other.kind === value.kind,
          ) === index,
      )
      .toSorted((a, b) => a.root.localeCompare(b.root));
    const commands = profile.native.commands.map(command =>
      command.preview
        ? {
            ...command,
            args: ['-e', NATIVE_PREVIEW_BOOTSTRAP],
            preview: {
              ...command.preview,
              bootstrapHash: storedChecksum(NATIVE_PREVIEW_BOOTSTRAP),
              serverArgs: command.preview.serverArgs ?? command.args,
            },
          }
        : command,
    );
    let observationManifest = profile.observationManifest;
    if (commands.some(command => command.preview)) {
      if (
        !captured ||
        !this.options.validatorModuleUrl ||
        !this.options.firefoxExecutable ||
        !plan.interactionContract
      )
        throw portalError('PORTAL_PREVIEW_PREPARATION_REQUIRED');
      const contract = derivePortalInteractionContract(
        captured,
        plan.requirements,
        plan.workflowCoverage,
      );
      if (
        contentHash('sfp-interaction-contract-v1', contract) !==
        contentHash('sfp-interaction-contract-v1', plan.interactionContract)
      )
        throw portalError('PORTAL_INTERACTION_CONTRACT_CHANGED');
      const screens = commands.flatMap(command => command.preview?.spec.screens ?? []);
      const assets = commands.flatMap(command => command.preview?.spec.assets ?? []);
      observationManifest = preparePortalObservationManifest(
        captured,
        contract,
        screens.map(screen => ({
          ...screen,
          rootNodeId: screen.rootNodeId ?? '',
          state: screen.state ?? '',
        })),
        assets,
        plan.requirements.flatMap(value => value.workflow?.routes ?? []),
      );
      const workflows = screens.flatMap(screen =>
        screen.workflowAssertions.map(value => value.requirementId),
      );
      if (
        workflows.length !== contract.workflowIds.length ||
        new Set(workflows).size !== workflows.length ||
        contract.workflowIds.some(id => !workflows.includes(id))
      )
        throw portalError('PORTAL_PREVIEW_WORKFLOW_COVERAGE_REQUIRED');
      for (const command of commands)
        if (command.preview) {
          if (command.preview.spec.root !== '.')
            throw portalError('PORTAL_PREVIEW_PRIVATE_ROOT_REQUIRED');
          for (const entry of [
            ...command.preview.spec.screens.map(screen => ({
              ...screen,
              nodeId: screen.rootNodeId,
            })),
            ...command.preview.spec.assets,
          ]) {
            const oracle = captured.assets.find(
              asset => asset.query.kind === 'png' && asset.query.nodeId === entry.nodeId,
            );
            if (
              !oracle ||
              entry.oraclePath !== oracle.path ||
              entry.oracleHash !== oracle.sha256 ||
              (entry.oracleRoot !== undefined && entry.oracleRoot !== captured.assetRoot)
            )
              throw portalError('PORTAL_PREVIEW_ORACLE_BINDING_REQUIRED');
            entry.oracleRoot = captured.assetRoot;
          }
          command.preview.spec = {
            ...command.preview.spec,
            outputDirectory: '.sfp-native-preview/' + command.id,
            manifest: observationManifest,
            interactionContract: contract,
            screens: command.preview.spec.screens.map(screen => ({
              ...screen,
              oracleRoot: captured.assetRoot,
            })),
            assets: command.preview.spec.assets.map(asset => ({
              ...asset,
              oracleRoot: captured.assetRoot,
            })),
          };
          const outputPath = '.sfp-native-preview/' + command.id;
          if (!(command.produces ?? []).some(output => output.path === outputPath))
            command.produces = [
              ...(command.produces ?? []),
              { path: outputPath, kind: 'generated-output' as const },
            ];
        }
    }
    const consumption=await this.consumptionInput(profile);
    const compiled=compileCoreConsumption(consumption,profile.recipeUse,observationManifest);
    const attached=attachCoreConsumption(commands,compiled);
    const assertions=[...profile.assertions];
    for(const addition of attached.added){
      const original=profile.assertions.find(value=>value.commandId===addition.from&&value.check.kind==='visual');
      if(!original)throw portalError('PORTAL_CONSUMPTION_VISUAL_ASSERTION_REQUIRED');
      assertions.push({commandId:addition.to,check:{...original.check,id:'core-visual-'+contentHash('sfp-core-assertion-v1',addition).slice(7,31)}});
    }
    const native = { ...profile.native, commands:attached.commands, environment, externalArtifacts };
    if (native.environmentAuthority)
      await verifyNativeEnvironment({ ...profile, native }, this.options.stateRoot);
    else
      native.environmentAuthority = await prepareNativeEnvironment(
        { ...profile, native },
        this.options.stateRoot,
      );
    native.artifactAuthority = await prepareNativeArtifactAuthority(native);
    return PortalNativeProfileSchema.parse({ ...profile, native, observationManifest, recipeUse:compiled.use, assertions });
  }
  private async assertPreparedProfile(profile: PortalNativeProfile): Promise<void> {
    await verifyNativeEnvironment(profile, this.options.stateRoot);
    await verifyNativeArtifactAuthority(profile.native);
    const expected = await this.prepareProfile(profile);
    if (
      contentHash('sfp-prepared-profile-v1', expected) !==
      contentHash('sfp-prepared-profile-v1', profile)
    )
      throw portalError('PORTAL_PROFILE_PREPARATION_CHANGED');
  }

  private checkContents(plan: PortalPlan, run: PortalRun, files: PortalFileContent[]): void {
    if (plan.strategy !== 'legacy-portal' && plan.request.stack !== 'auto') {
      const framework = plan.request.stack === 'react-vite' ? 'react' : 'vue';
      const manifest = files.find(
        file =>
          /(?:^|\/)package\.json$/u.test(file.path) &&
          file.encoding !== 'base64' &&
          file.content.includes(`"${framework}"`),
      );
      if (!manifest || manifest.encoding === 'base64')
        throw portalError('PORTAL_FRONTEND_STACK_MISMATCH');
      const value = JSON.parse(manifest.content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const dependencies = { ...value.dependencies, ...value.devDependencies };
      if (typeof dependencies[framework] !== 'string' || typeof dependencies.vite !== 'string')
        throw portalError('PORTAL_FRONTEND_STACK_MISMATCH');
    }
    if (
      !files.length ||
      run.files.length !== files.length ||
      new Set(files.map(file => file.path.toLowerCase())).size !== files.length
    )
      throw portalError('PORTAL_CANDIDATE_PATH_ALIAS');
    for (const file of files) {
      PortalPathSchema.parse(file.path);
      if (!isPortalSourcePath(file.path)) throw portalError('PORTAL_SOURCE_PATH_FORBIDDEN');
      const saved = run.files.find(entry => entry.path === file.path);
      if (!saved || storedChecksum(portalContentBytes(file)) !== saved.contentHash)
        throw portalError('PORTAL_CANDIDATE_HASH_MISMATCH');
      if (plan.implementationScope === 'frontend-only' && file.encoding !== 'base64')
        assertFrontendSource(file.path, file.content);
    }
  }

  private async stage(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    authority: PortalAuthority,
    signal: AbortSignal,
    target: 'candidate' | 'applied',
    profile: PortalNativeProfile,
    preparedDirectory?: string,
  ): Promise<string> {
    const workRoot = join(this.options.stateRoot, 'portal', 'work');
    await this.permissions.verifySecure(this.options.stateRoot);
    const directory =
      preparedDirectory ??
      (await withRetainedDirectoryChain(
        this.options.stateRoot,
        workRoot,
        async () => {
          await this.permissions.ensureSecure(join(this.options.stateRoot, 'portal'));
          await this.permissions.ensureSecure(workRoot);
          const path = await mkdtemp(join(workRoot, `${run.runId}-`));
          await this.permissions.ensureSecure(path);
          return path;
        },
        { createMissing: true },
      ));
    const atomic = new AtomicFileStore({ maxReplaceBytes: 16_777_216 });
    const copied = new Map<string, string>();
    if (plan.strategy === 'legacy-portal' || target === 'applied') {
      if (target === 'candidate') await this.verifySources(plan, authority, signal, profile);
      const root = authority.roots[0]!;
      const reader = new RepoReader({
        rootDir: root.path,
        workspaceId: root.workspaceId,
        workspacePolicy: this.options.policy,
        signal,
        maxTotalBytes: 134_217_728,
        maxFileBytes: 16_777_216,
      });
      const expected =
        target === 'applied' ? portalMaterialFiles(plan, run) : portalBaselineFiles(plan);
      let observed: Pick<import('@sfp/shared').PortalSourceInventory, 'files' | 'complete'>;
      if (target === 'applied') {
        const journal = await this.options.store.get('apply', run.runId, ApplySchema);
        if (!journal) throw portalError('PORTAL_APPLY_EVIDENCE_REQUIRED');
        observed = await this.materialInventory(plan, root, journal, signal);
      } else observed = await collectPortalSourceInventory(reader);
      assertPortalMaterialFiles(
        expected,
        observed,
        target === 'applied' ? 'PORTAL_APPLIED_SOURCE_CHANGED' : 'PORTAL_SOURCE_CHANGED',
      );
      for (const [path, hash] of expected) {
        signal.throwIfAborted();
        const bytes = await reader.readBytes(path);
        if (storedChecksum(bytes) !== hash) throw portalError('PORTAL_SOURCE_CHANGED');
        if (target === 'applied' || !run.files.some(file => file.path === path))
          await withRetainedDirectoryChain(
            directory,
            join(directory, dirname(path)),
            held => atomic.createNew(held.child(path.split('/').at(-1)!), bytes),
            { createMissing: true },
          );
        copied.set(path, hash);
      }
      if (target === 'candidate') await this.verifySources(plan, authority, signal, profile);
    }
    for (const file of files) {
      signal.throwIfAborted();
      const saved = run.files.find(entry => entry.path === file.path)!;
      if (target === 'applied') {
        if (copied.get(file.path) !== saved.contentHash)
          throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
        continue;
      }
      const original = copied.get(file.path) ?? null;
      if (original !== saved.baseHash) throw portalError('PORTAL_BASE_CHANGED');
      // eslint-disable-next-line no-await-in-loop -- immutable candidate overlay onto the separate work copy
      await withRetainedDirectoryChain(
        directory,
        join(directory, dirname(file.path)),
        held => {
          const path = held.child(file.path.split('/').at(-1)!);
          return atomic.createNew(path, portalContentBytes(file));
        },
        { createMissing: true },
      );
    }
    assertPortalMaterialFiles(
      portalMaterialFiles(plan, run),
      await collectPortalSourceInventory(new RepoReader({ rootDir: directory, signal })),
      'PORTAL_WORKING_COPY_SOURCE_CHANGED',
    );
    return directory;
  }

  private async verifySources(
    plan: PortalPlan,
    authority: PortalAuthority,
    signal: AbortSignal,
    reviewed?: Pick<PortalNativeProfile, 'sourceReviews'>,
  ): Promise<void> {
    for (const profile of plan.profiles) {
      const grant = authority.roots.find(
        root =>
          root.workspaceId === profile.workspaceId &&
          root.rootPath === profile.rootPath &&
          root.role === profile.role,
      )!;
      // eslint-disable-next-line no-await-in-loop -- each reference and legacy source is independently revalidated
      const saved = requirePortalInventory(profile);
      const observed = await collectPortalSourceInventory(
        new RepoReader({
          rootDir: grant.path,
          workspaceId: grant.workspaceId,
          workspacePolicy: this.options.policy,
          signal,
        }),
        saved.limits,
      );
      if (!observed.complete || observed.hash !== saved.hash)
        throw portalError('PORTAL_SOURCE_CHANGED');
      // Exact semantic reviews were admitted during planning and bound before the coding lease.
      assertCurrentPortalAnalysis(plan);
      const recomputed = selectPortalServices(plan.profiles, plan.request);
      if (recomputed.hash !== plan.serviceSelection!.hash)
        throw portalError('PORTAL_ANALYSIS_SOURCE_CHANGED');
      for (const review of reviewed?.sourceReviews ?? []) {
        if (
          !plan.serviceSelection!.reviews.some(
            entry =>
              entry.sourceId === review.sourceId &&
              entry.sourceIndex === review.sourceIndex &&
              entry.path === review.path &&
              entry.hash === review.hash &&
              entry.conclusion === review.conclusion &&
              entry.layers.length === review.layers.length &&
              entry.layers.every(layer => review.layers.includes(layer)),
          )
        )
          throw portalError('PORTAL_SOURCE_REVIEW_NOT_BOUND');
      }
    }
  }

  private async currentHash(
    authority: PortalAuthority,
    path: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const root = authority.roots[0]!;
    const policyPath = authority.targetPath === '.' ? path : `${authority.targetPath}/${path}`;
    const resolved = await this.options.policy.resolveWrite(
      root.workspaceId,
      policyPath.replaceAll('/', sep),
    );
    if (!resolved.overwrites) return null;
    return storedChecksum(
      await new RepoReader({
        rootDir: root.path,
        workspaceId: root.workspaceId,
        workspacePolicy: this.options.policy,
        signal,
        maxFileBytes: 16_777_216,
      }).readBytes(path),
    );
  }

  /** Inspect only the exact prepared/retained generations authorized by this signed write intent. */
  private async recoveryState(
    root: PortalAuthority['roots'][number],
    row: z.infer<typeof ApplySchema>['files'][number],
    signal: AbortSignal,
  ) {
    if (row.before === null || row.state === 'pending') return null;
    const parts = row.path.split('/'),
      name = parts.pop()!;
    const parent = join(root.path, ...parts);
    if (!(await exists(parent))) return null;
    return withRetainedDirectoryChain(root.path, parent, async held => {
      const retainedName = `.${name}.${row.before!.slice(7)}.${row.after.slice(7)}.replace-retained`;
      const preparedName = `.${name}.${row.after.slice(7)}.replace-new`;
      const retained = await exists(held.child(retainedName)),
        prepared = await exists(held.child(preparedName));
      if (!retained && !prepared) return null;
      const target = await exists(held.child(name));
      const paired =
        target &&
        prepared &&
        target.dev === prepared.dev &&
        target.ino === prepared.ino &&
        target.nlink === 2 &&
        prepared.nlink === 2;
      const read = async (
        entry: NonNullable<typeof target>,
        filename: string,
        hash: string,
        links: number[],
      ) => {
        if (!entry.isFile() || entry.isSymbolicLink() || !links.includes(entry.nlink))
          throw portalError('PORTAL_RETAINED_CAS_RECOVERY_REQUIRED');
        const bytes = await readFileWithinLimit(held.child(filename), 16_777_216, undefined, {
          expectedIdentity: entry,
          allowedLinks: links,
          signal,
        });
        if (storedChecksum(bytes) !== hash) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
        return bytes.length;
      };
      const artifacts = new Map<string, { hash: string; bytes: number }>();
      if (retained)
        artifacts.set([...parts, retainedName].join('/'), {
          hash: row.before!,
          bytes: await read(retained, retainedName, row.before!, [1]),
        });
      if (prepared)
        artifacts.set([...parts, preparedName].join('/'), {
          hash: row.after,
          bytes: await read(prepared, preparedName, row.after, paired ? [2] : [1]),
        });
      let actual: string | null = null;
      if (target) {
        if (!target.isFile() || target.isSymbolicLink() || (target.nlink !== 1 && !paired))
          throw portalError('PORTAL_RETAINED_CAS_RECOVERY_REQUIRED');
        actual = storedChecksum(
          await readFileWithinLimit(held.child(name), 16_777_216, undefined, {
            expectedIdentity: target,
            allowedLinks: paired ? [2] : [1],
            signal,
          }),
        );
      }
      if (
        actual !== row.before &&
        actual !== row.after &&
        !(actual === null && retained && prepared)
      )
        throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
      if (paired && actual !== row.after) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
      return {
        actual,
        artifacts,
        targetBytes: target?.size ?? 0,
        recoverable: actual === null || Boolean(prepared && retained),
      };
    });
  }
  private async materialInventory(
    plan: PortalPlan,
    root: PortalAuthority['roots'][number],
    record: z.infer<typeof ApplySchema>,
    signal: AbortSignal,
  ) {
    const reader = new RepoReader({
      rootDir: root.path,
      workspaceId: root.workspaceId,
      workspacePolicy: this.options.policy,
      signal,
      maxFileBytes: 16_777_216,
      maxTotalBytes: 134_217_728,
    });
    const baseline = portalBaselineFiles(plan);
    const permitted = new Map<string, { hash: string; bytes: number }>();
    const recovered = new Map<string, { hash: string; bytes: number }>();
    let recoveryBytes = 0;
    for (const row of record.files) {
      const recovery = await this.recoveryState(root, row, signal);
      if (!recovery) continue;
      for (const [path, file] of recovery.artifacts) {
        if (baseline.has(path)) continue;
        recoveryBytes += file.bytes;
        if (recoveryBytes > 134_217_728) throw portalError('PORTAL_RECOVERY_ARTIFACT_LIMIT');
        permitted.set(path, file);
      }
      if (recovery.actual !== null)
        recovered.set(row.path, { hash: recovery.actual, bytes: recovery.targetBytes });
    }
    const walk = await reader.walk({
      mode: 'portal-source-authority',
      cap: 5000 + permitted.size,
      maxScanEntries: 20000 + permitted.size,
    });
    if (walk.truncated || walk.issues?.length) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
    const files: import('@sfp/shared').PortalSourceInventory['files'] = [];
    let materialBytes = 0;
    for (const path of walk.files) {
      if (permitted.has(path)) continue;
      if (files.length >= 5000) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
      const recoveredFile = recovered.get(path);
      const bytes = recoveredFile ? undefined : await reader.readBytes(path);
      const file = recoveredFile ?? { hash: storedChecksum(bytes!), bytes: bytes!.length };
      materialBytes += file.bytes;
      if (materialBytes > 134_217_728) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
      files.push({ path, ...file, classification: 'binary' });
    }
    return { files, complete: true };
  }
  private assertJournal(run: PortalRun, record: z.infer<typeof ApplySchema>): void {
    if (
      record.files.length !== run.files.length ||
      record.files.some(
        row =>
          !run.files.some(
            file =>
              file.path === row.path &&
              file.baseHash === row.before &&
              file.contentHash === row.after,
          ),
      )
    )
      throw portalError('PORTAL_APPLY_RECORD_CONFLICT');
  }
  private async targetInventory(
    plan: PortalPlan,
    authority: PortalAuthority,
    signal: AbortSignal,
    record: z.infer<typeof ApplySchema>,
  ) {
    const check = async () => {
      const current = await resolvePortalAuthority(
        this.options.policy,
        plan.workspaceId,
        plan.request,
        plan.planId,
        plan.implementationScope,
        plan,
        true,
      );
      if (current.hash !== authority.hash) throw portalError('PORTAL_AUTHORITY_CHANGED');
    };
    await check();
    const root = authority.roots[0]!;
    const present = await exists(root.path);
    if (
      present &&
      (!record.targetIdentity || (await rootIdentity(root.path)) !== record!.targetIdentity)
    )
      throw portalError('PORTAL_APPLIED_TARGET_IDENTITY_CHANGED');
    if (!present && record.targetIdentity)
      throw portalError('PORTAL_APPLIED_TARGET_IDENTITY_CHANGED');
    const inventory = present ? await this.materialInventory(plan, root, record, signal) : null;
    await check();
    if (inventory && (await rootIdentity(root.path)) !== record!.targetIdentity)
      throw portalError('PORTAL_APPLIED_TARGET_IDENTITY_CHANGED');
    return inventory;
  }
  /** Every untouched baseline file plus each journal row's permitted preimage/postimage. */
  private async verifyMixed(
    plan: PortalPlan,
    run: PortalRun,
    authority: PortalAuthority,
    record: z.infer<typeof ApplySchema>,
    signal: AbortSignal,
  ): Promise<void> {
    assertCurrentPortalAnalysis(plan);
    assertCurrentPortalSourceAuthority(plan, run, record);
    this.assertJournal(run, record);
    const inventory = await this.targetInventory(plan, authority, signal, record);
    if (inventory && !inventory.complete) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
    const actual = new Map((inventory?.files ?? []).map(file => [file.path, file.hash]));
    const expected = portalBaselineFiles(plan);
    for (const row of record.files) {
      const hash = actual.get(row.path) ?? null;
      const recovery =
        row.state === 'intent' ? await this.recoveryState(authority.roots[0]!, row, signal) : null;
      if (
        !(
          (row.state !== 'written' && hash === row.before) ||
          (row.state !== 'pending' && hash === row.after) ||
          (hash === null && recovery?.recoverable)
        )
      )
        throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
      if (hash === null) expected.delete(row.path);
      else expected.set(row.path, hash);
    }
    const conflicts = [...new Set([...actual.keys(), ...expected.keys()])].filter(
      path => actual.get(path) !== expected.get(path),
    );
    if (conflicts.length)
      throw Object.assign(portalError('PORTAL_APPLIED_SOURCE_CHANGED'), { conflicts });
  }

  private async verifyApplied(
    plan: PortalPlan,
    run: PortalRun,
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<void> {
    const record = await this.options.store.get('apply', run.runId, ApplySchema);
    if (
      !record ||
      record.ownerId !== plan.ownerId ||
      record.state !== 'applied' ||
      record.candidateHash !== run.candidateHash ||
      record.authorityHash !== authority.hash
    )
      throw portalError('PORTAL_APPLY_EVIDENCE_REQUIRED');
    assertCurrentPortalAnalysis(plan);
    assertCurrentPortalSourceAuthority(plan, run, record);
    this.assertJournal(run, record);
    const inventory = await this.targetInventory(plan, authority, signal, record);
    if (!inventory) throw portalError('PORTAL_APPLIED_SOURCE_CHANGED');
    assertPortalMaterialFiles(
      portalMaterialFiles(plan, run),
      inventory,
      'PORTAL_APPLIED_SOURCE_CHANGED',
    );
  }

  private async applyFiles(
    plan: PortalPlan,
    run: PortalRun,
    files: PortalFileContent[],
    authority: PortalAuthority,
    signal: AbortSignal,
  ): Promise<{ hash: `sha256:${string}` }> {
    assertCurrentPortalAnalysis(plan);
    await this.assertCapture(plan);
    assertCurrentPortalSourceAuthority(plan, run);
    this.checkContents(plan, run, files);
    if (
      !run.candidateHash ||
      !run.validation ||
      portalCompletionIssues(plan, run.validation, run.candidateHash, run, 'candidate').length
    )
      throw portalError('PORTAL_VALIDATION_REQUIRED');
    const environment = run.validation.nativeEnvironment;
    if (!environment || environment.target !== 'candidate')
      throw portalError('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
    const lifecycle = await this.environments.verifyReceipt(
      environment.attemptId,
      plan.ownerId,
      environment.receiptHash,
    );
    if (
      lifecycle.execution.hash !== environment.executionHash ||
      lifecycle.execution.runId !== run.runId ||
      lifecycle.execution.sourceHash !== run.candidateHash ||
      lifecycle.execution.target !== environment.target ||
      lifecycle.execution.repositoryHash !== authority.hash
    )
      throw portalError('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
    let record = await this.options.store.get('apply', run.runId, ApplySchema);
    const currentAuthority = await resolvePortalAuthority(
      this.options.policy,
      plan.workspaceId,
      plan.request,
      plan.planId,
      plan.implementationScope,
      plan,
      record !== null,
    );
    if (currentAuthority.hash !== authority.hash) throw portalError('PORTAL_AUTHORITY_CHANGED');
    if (
      record &&
      (record.ownerId !== plan.ownerId ||
        record.candidateHash !== run.candidateHash ||
        record.authorityHash !== authority.hash)
    )
      throw portalError('PORTAL_APPLY_RECORD_CONFLICT');
    if (record) assertCurrentPortalSourceAuthority(record);
    if (record?.state === 'conflict') throw portalError('PORTAL_RECONCILIATION_REQUIRED');
    if (!record) {
      const evidenceId = run.validation?.evidencePaths
        .map(path => /^portal\/validation\/([a-f0-9]{64})\.json$/u.exec(path)?.[1])
        .find(Boolean);
      const evidence = evidenceId
        ? await this.options.store.get('validation', evidenceId, PortalStoredValidationSchema)
        : null;
      if (evidence && evidence.report.sourceHash !== run.candidateHash)
        throw portalError('PORTAL_VALIDATION_REQUIRED');
      await this.verifySources(plan, authority, signal, evidence ?? undefined);
      if (plan.strategy !== 'legacy-portal' && (await exists(authority.roots[0]!.path)))
        throw portalError('PORTAL_NEW_TARGET_EXISTS');
      for (const file of run.files) {
        // eslint-disable-next-line no-await-in-loop -- all-file preflight precedes the first mutation
        if ((await this.currentHash(authority, file.path, signal)) !== file.baseHash)
          throw portalError('PORTAL_BASE_CHANGED');
      }
      record = await this.options.store.create(
        'apply',
        run.runId,
        {
          schemaVersion: 1,
          sourceAuthorityVersion: 2,
          runId: run.runId,
          ownerId: plan.ownerId,
          candidateHash: run.candidateHash,
          authorityHash: authority.hash,
          targetIdentity:
            plan.strategy === 'legacy-portal' ? await rootIdentity(authority.roots[0]!.path) : null,
          state: 'prepared',
          files: run.files.map(file => ({
            path: file.path,
            before: file.baseHash,
            after: file.contentHash,
            state: 'pending',
          })),
        },
        ApplySchema,
      );
    }
    const writer = new WorkspaceAtomicFileStore({
      workspaceId: plan.workspaceId,
      workspacePolicy: this.options.policy,
      atomicFiles: new AtomicFileStore({ maxReplaceBytes: 16_777_216 }),
      afterFinalResolveBeforeUse: async () => {
        signal.throwIfAborted();
        if ((await rootIdentity(authority.roots[0]!.path)) !== record!.targetIdentity)
          throw portalError('PORTAL_APPLIED_TARGET_IDENTITY_CHANGED');
      },
    });
    let committed = record.files.some(file => file.state !== 'pending');
    try {
      if (!record.targetIdentity) {
        const root = authority.roots[0]!;
        if (
          plan.strategy === 'legacy-portal' ||
          record.state !== 'prepared' ||
          (await exists(root.path))
        )
          throw portalError('PORTAL_TARGET_IDENTITY_RECOVERY_REQUIRED');
        const workspaceRoot = await this.options.policy.resolveRoot!(plan.workspaceId);
        const identity = await withRetainedDirectoryChain(
          workspaceRoot,
          dirname(root.path),
          async held => {
            signal.throwIfAborted();
            await mkdir(held.child(root.path.split(/[\\/]/u).at(-1)!));
            committed = true;
            return rootIdentity(root.path);
          },
          { createMissing: true },
        );
        record = await this.options.store.update('apply', run.runId, ApplySchema, value => {
          value.targetIdentity = identity;
          return value;
        });
      }
      await this.verifyMixed(plan, run, authority, record, signal);
      for (const file of record.files) {
        signal.throwIfAborted();
        const latest = await this.options.store.get('apply', run.runId, ApplySchema);
        if (!latest) throw portalError('PORTAL_APPLY_EVIDENCE_REQUIRED');
        await this.verifyMixed(plan, run, authority, latest, signal);
        // eslint-disable-next-line no-await-in-loop -- reject replacement of the retained target anchor between publications
        if (
          (
            await resolvePortalAuthority(
              this.options.policy,
              plan.workspaceId,
              plan.request,
              plan.planId,
              plan.implementationScope,
              plan,
              true,
            )
          ).hash !== authority.hash
        )
          throw portalError('PORTAL_AUTHORITY_CHANGED');
        // eslint-disable-next-line no-await-in-loop -- reconcile signed write intent against the current file
        const recovery = await this.recoveryState(authority.roots[0]!, file, signal);
        if (recovery?.recoverable) {
          const root = authority.roots[0]!;
          const policyPath =
            authority.targetPath === '.' ? file.path : `${authority.targetPath}/${file.path}`;
          const resolved = await this.options.policy.resolveWrite(
            root.workspaceId,
            policyPath.replaceAll('/', sep),
          );
          if (resolved.path !== join(root.path, ...file.path.split('/')))
            throw portalError('PORTAL_AUTHORITY_CHANGED');
          committed = true;
          await withRetainedDirectoryChain(root.path, dirname(resolved.path), async held => {
            signal.throwIfAborted();
            if ((await rootIdentity(root.path)) !== record!.targetIdentity)
              throw portalError('PORTAL_APPLIED_TARGET_IDENTITY_CHANGED');
            return new AtomicFileStore({ maxReplaceBytes: 16_777_216 }).replace(
              held.child(file.path.split('/').at(-1)!),
              portalContentBytes(files.find(row => row.path === file.path)!),
              { destructiveApproved: true, expectedDigest64: file.before!.slice(7) },
            );
          });
          await this.options.store.update('apply', run.runId, ApplySchema, value => {
            value.files.find(row => row.path === file.path)!.state = 'written';
            return value;
          });
          continue;
        }
        const actual = recovery
          ? recovery.actual
          : await this.currentHash(authority, file.path, signal);
        if (file.state !== 'pending' && actual === file.after) {
          // eslint-disable-next-line no-await-in-loop -- a recovered publication must be durably observed
          await this.options.store.update('apply', run.runId, ApplySchema, value => {
            value.files.find(row => row.path === file.path)!.state = 'written';
            return value;
          });
          continue;
        }
        if (actual !== file.before || file.state === 'written')
          throw portalError('PORTAL_BASE_CHANGED');
        // eslint-disable-next-line no-await-in-loop -- persist intent before touching source; interruption cannot erase this boundary
        await this.options.store.update('apply', run.runId, ApplySchema, value => {
          value.state = 'applying';
          value.files.find(row => row.path === file.path)!.state = 'intent';
          return value;
        });
        committed = true;
        signal.throwIfAborted();
        const path =
          authority.targetPath === '.' ? file.path : `${authority.targetPath}/${file.path}`;
        const bytes = portalContentBytes(files.find(row => row.path === file.path)!);
        // eslint-disable-next-line no-await-in-loop -- serial compare-and-swap publication; no reference writes
        if (file.before === null) await writer.createNew(path, bytes);
        // eslint-disable-next-line no-await-in-loop -- exact preimage digest is mandatory for replacement
        else
          await writer.replace(path, bytes, {
            destructiveApproved: true,
            expectedDigest64: file.before.slice(7),
          });
        // eslint-disable-next-line no-await-in-loop -- file publication is durable before its journal pointer
        await this.options.store.update('apply', run.runId, ApplySchema, value => {
          value.files.find(row => row.path === file.path)!.state = 'written';
          return value;
        });
      }
      await this.options.store.update('apply', run.runId, ApplySchema, value => {
        value.state = 'applied';
        return value;
      });
      await this.verifyApplied(plan, run, authority, signal);
      return { hash: run.candidateHash as `sha256:${string}` };
    } catch (error) {
      // Retain write intents for explicit reconciliation. Never overwrite a user's newer file to roll back.
      throw Object.assign(error instanceof Error ? error : portalError('PORTAL_APPLY_FAILED'), {
        committed,
      });
    }
  }
}
