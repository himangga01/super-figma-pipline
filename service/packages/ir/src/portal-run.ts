import {
  PortalAcceptanceSchema,
  PortalCorePlanBindingSchema,
  PortalCoreDeclarationsSchema,
  canonicalCoreDeclarations,
  PortalInteractionContractSchema,
  PortalServiceSelectionSchema,
  PortalWorkflowCoverageSchema,
  assertCurrentPortalAnalysis,
  PortalSourceAuthorityVersionSchema,
  PORTAL_SOURCE_AUTHORITY_VERSION,
  PortalDesignEvidenceSchema,
  PortalCaseSchema,
  PortalHashSchema,
  PortalIdSchema,
  PortalLayerSchema,
  PortalPathSchema,
  PortalPlanArgsSchema,
  PortalRequirementSchema,
  PortalScopeSchema,
  PortalStateSchema,
  PortalStrategySchema,
  PortalWorkspaceSchema,
  ServiceGraphProfileSchema,
  type PortalAcceptance,
  type PortalLayer,
  portalRequirementNeedsBlueprint,
} from '@sfp/shared';
import { z } from 'zod';

import { contentHash } from './canonical-json.js';

export const PortalRepositoryGrantSchema = z
  .object({
    role: z.enum(['target', 'reference', 'scratch']),
    workspaceId: PortalWorkspaceSchema,
    rootPath: z.union([z.literal('.'), PortalPathSchema]),
    anchorPath: z.union([z.literal('.'), PortalPathSchema]),
    canonicalPath: z.string().min(1).max(32768),
    identity: z.string().min(1).max(512),
    writable: z.boolean(),
    sourceHash: PortalHashSchema.nullable(),
  })
  .strict();
export const PortalPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    planId: PortalIdSchema,
    coreRecipes: PortalCorePlanBindingSchema.optional(),
    ownerId: z.string().min(1),
    workspaceId: PortalWorkspaceSchema,
    createdAt: z.iso.datetime(),
    request: PortalPlanArgsSchema,
    analysisVersion: z.literal(2).optional(),
    serviceSelection: PortalServiceSelectionSchema.optional(),
    workflowCoverage: PortalWorkflowCoverageSchema.optional(),
    requestedCase: PortalCaseSchema,
    strategy: PortalStrategySchema,
    implementationScope: PortalScopeSchema,
    targetPath: z.union([z.literal('.'), PortalPathSchema]),
    repositories: z.array(PortalRepositoryGrantSchema).min(1).max(10),
    profiles: z
      .array(
        z
          .object({
            workspaceId: PortalWorkspaceSchema,
            rootPath: z.union([z.literal('.'), PortalPathSchema]),
            role: z.enum(['target', 'reference']),
            graph: ServiceGraphProfileSchema,
          })
          .strict(),
      )
      .max(9),
    design: PortalDesignEvidenceSchema,
    interactionContract: PortalInteractionContractSchema.optional(),
    requirements: z.array(PortalRequirementSchema).min(1).max(128),
    requiredLayers: z.array(PortalLayerSchema).min(1).max(10),
    contextHash: PortalHashSchema,
    blueprintHash: PortalHashSchema,
    issues: z.array(z.string()).max(512),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.implementationScope === 'frontend-only') !== (value.strategy === 'blank-frontend'))
      ctx.addIssue({ code: 'custom', message: 'Case scope mismatch' });
    if (
      value.implementationScope === 'frontend-only' &&
      value.requiredLayers.some(layer => !['frontend', 'configuration'].includes(layer))
    )
      ctx.addIssue({ code: 'custom', message: 'C4 backend requirement rejected' });
    if (value.repositories.some(root => root.role === 'reference' && root.writable))
      ctx.addIssue({ code: 'custom', message: 'Reference grants must be read-only' });
  });
export type PortalPlan = z.infer<typeof PortalPlanSchema>;
export const PortalArtifactSchema = z
  .object({ path: PortalPathSchema, hash: PortalHashSchema, bytes: z.number().int().nonnegative() })
  .strict();
export const PortalStoredFileSchema = z
  .object({
    path: PortalPathSchema,
    action: z.enum(['create', 'replace']),
    baseHash: PortalHashSchema.nullable(),
    contentHash: PortalHashSchema,
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
    artifact: PortalArtifactSchema,
  })
  .strict();
export const PortalRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    runId: PortalIdSchema,
    planId: PortalIdSchema,
    coreRecipes: PortalCorePlanBindingSchema.optional(),
    ownerId: z.string().min(1),
    workspaceId: PortalWorkspaceSchema,
    version: z.number().int().positive(),
    state: PortalStateSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deadlineAt: z.number().int().positive(),
    leaseEpoch: z.number().int().nonnegative(),
    lease: z
      .object({
        id: z.string().uuid(),
        authSessionId: z.string(),
        epoch: z.number().int().positive(),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    coreDeclarations: PortalCoreDeclarationsSchema.optional(),
    coreDeclarationsHash: PortalHashSchema.optional(),
    generationAttempts: z.number().int().min(0).max(4),
    files: z.array(PortalStoredFileSchema).max(300),
    candidateHash: PortalHashSchema.nullable(),
    validation: PortalAcceptanceSchema.nullable(),
    lastValidation: PortalAcceptanceSchema.nullable().default(null),
    appliedHash: PortalHashSchema.nullable(),
    issues: z.array(z.string()).max(512),
    operations: z
      .array(z.object({ id: z.string(), name: z.string(), at: z.iso.datetime() }).strict())
      .max(4096),
  })
  .strict();
export type PortalRun = z.infer<typeof PortalRunSchema>;
export const portalCandidateHash = (
  files: PortalRun['files'],
  plan: Pick<PortalPlan, 'contextHash' | 'blueprintHash' | 'coreRecipes'>,
  declarations?: unknown,
): `sha256:${string}` => {
  if(plan.coreRecipes && declarations===undefined)
    throw new Error('PORTAL_CORE_DECLARATIONS_REQUIRED');
  return contentHash(plan.coreRecipes ? 'sfp-portal-candidate-v2' : 'sfp-portal-candidate-v1', {
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    ...(plan.coreRecipes ? {declarationsHash:contentHash('sfp-portal-core-declarations-v1',canonicalCoreDeclarations(declarations))} : {}),
    files: files
      .map(file => ({
        path: file.path,
        hash: file.contentHash,
        base: file.baseHash,
        action: file.action,
      }))
      .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
};
const layerChecks: Partial<Record<PortalLayer, PortalAcceptance['checks'][number]['kind']>> = {
  backend: 'api',
  api: 'api',
  database: 'persistence',
  authentication: 'authorization',
  authorization: 'authorization',
  jobs: 'integration',
  storage: 'persistence',
  integration: 'integration',
};
/**
 * Completion depends on server-produced evidence for every required layer, not a client success
 * flag.
 */
export const portalCompletionIssues = (
  plan: PortalPlan,
  report: PortalAcceptance,
  expectedHash: string,
  run?: Pick<
    PortalRun,
    'candidateHash' | 'coreRecipes' | 'coreDeclarations' | 'coreDeclarationsHash'
  >,
  target?: 'candidate' | 'applied',
): string[] => {
  PortalSourceAuthorityVersionSchema.parse(plan.sourceAuthorityVersion);
  PortalSourceAuthorityVersionSchema.parse(report.sourceAuthorityVersion);
  const issues: string[] = [];
  const core = plan.coreRecipes,
    consumption = report.recipeConsumption;
  if (!core || core.status !== 'ready' || core.requiredResults.length !== 7)
    issues.push('PORTAL_CORE_REPLAN_REQUIRED');
  let declarationsCurrent = false;
  try {
    declarationsCurrent =
      !!run &&
      !!core &&
      run.coreRecipes?.bindingHash === core.bindingHash &&
      run.coreDeclarations?.length === core.workItemCount &&
      run.coreDeclarationsHash ===
        contentHash(
          'sfp-portal-core-declarations-v1',
          canonicalCoreDeclarations(run.coreDeclarations),
        );
  } catch {
    /* Invalid or legacy declarations never become current evidence. */
  }
  if (!declarationsCurrent) issues.push('PORTAL_CORE_DECLARATIONS_REQUIRED');
  if (
    !core ||
    !run ||
    !consumption ||
    !target ||
    consumption.recipeAuthorityVersion !== 1 ||
    consumption.ownerId !== plan.ownerId ||
    consumption.workspaceId !== plan.workspaceId ||
    consumption.contextHash !== core.contextHash ||
    consumption.blueprintHash !== plan.blueprintHash ||
    consumption.candidateHash !== run.candidateHash ||
    consumption.declarationsHash !== run.coreDeclarationsHash ||
    consumption.target !== target ||
    consumption.verifierVersion !== 'core-consumption-v1' ||
    JSON.stringify([...consumption.resultHashes].toSorted()) !==
      JSON.stringify(core.requiredResults.map(row => row.resultHash).toSorted())
  )
    issues.push('PORTAL_RECIPE_CONSUMPTION_REQUIRED');
  if (
    !plan.design.capture ||
    report.capture?.version !== 2 ||
    report.capture.originalDescriptorHash !==
      contentHash('sfp-portal-capture-descriptor-v2', plan.design.capture)
  )
    issues.push('PORTAL_CAPTURE_RECEIPT_REQUIRED');
  if (
    plan.request.design.freshness === 'require-live' &&
    (!plan.design.capture ||
      report.capture?.freshDesignFingerprint !== plan.design.capture.designFingerprint)
  )
    issues.push('PORTAL_CAPTURE_FRESHNESS_REQUIRED');
  try {
    assertCurrentPortalAnalysis(plan);
  } catch (error) {
    issues.push((error as Error).message);
  }
  if (
    report.analysisHash !==
    contentHash('sfp-portal-analysis-receipt-v1', {
      selection: plan.serviceSelection,
      coverage: plan.workflowCoverage,
    })
  )
    issues.push('PORTAL_ANALYSIS_RECEIPT_REQUIRED');
  const interaction = plan.interactionContract;
  const observations = report.observations;
  if (
    !interaction ||
    !interaction.complete ||
    !observations ||
    observations.interactionContractHash !==
      contentHash('sfp-interaction-contract-v1', interaction) ||
    !observations.executedObservationIds.length ||
    new Set(observations.executedObservationIds).size !==
      observations.executedObservationIds.length ||
    JSON.stringify([...observations.executedAssertionIds].toSorted()) !==
      JSON.stringify(interaction.interactions.map(value => value.id).toSorted()) ||
    JSON.stringify([...observations.executedWorkflowIds].toSorted()) !==
      JSON.stringify([...interaction.workflowIds].toSorted())
  )
    issues.push('PORTAL_OBSERVATION_RECEIPT_REQUIRED');
  if (report.nativeEnvironment?.version !== 1) issues.push('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
  if (report.nativeArtifactAuthority?.version !== 1)
    issues.push('PORTAL_ARTIFACT_AUTHORITY_REQUIRED');
  if (
    report.nativeArtifactAuthority?.moduleFenceProtocol !== 'sfp-native-module-fence-v1' ||
    !report.nativeArtifactAuthority.moduleEvidenceHash
  )
    issues.push('PORTAL_NATIVE_MODULE_EVIDENCE_REQUIRED');
  if (
    plan.sourceAuthorityVersion !== PORTAL_SOURCE_AUTHORITY_VERSION ||
    report.sourceAuthorityVersion !== PORTAL_SOURCE_AUTHORITY_VERSION
  )
    issues.push('PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED');
  if (report.sourceHash !== expectedHash) issues.push('VALIDATION_SOURCE_CHANGED');
  if (!plan.design.artifactHash || report.designHash !== plan.design.artifactHash)
    issues.push('VALIDATION_DESIGN_CHANGED');
  if (
    plan.issues?.some(
      issue =>
        issue.startsWith('WORKFLOW_SOURCE_EVIDENCE_REQUIRED:') ||
        issue === 'WORKFLOW_SOURCE_HINT_LIMIT',
    )
  )
    issues.push('PORTAL_WORKFLOW_SOURCE_REVIEW_REQUIRED');
  if (!report.runtimeVerified) issues.push('RUNTIME_NOT_VERIFIED');
  if (!plan.design.complete) issues.push('DESIGN_INCOMPLETE');
  if (
    plan.request.design.freshness === 'require-live' &&
    (!plan.design.liveVerified || !report.liveDesignVerified)
  )
    issues.push('LIVE_DESIGN_NOT_VERIFIED');
  if (report.checks.some(check => check.required && check.status !== 'passed'))
    issues.push('REQUIRED_CHECK_NOT_PASSED');
  const requiredKinds = new Set<PortalAcceptance['checks'][number]['kind']>([
    'build',
    'typecheck',
    'interaction',
    'accessibility',
    'visual',
    'source-scope',
  ]);
  for (const layer of plan.requiredLayers) {
    const kind = layerChecks[layer];
    if (kind) requiredKinds.add(kind);
  }
  if (plan.strategy !== 'legacy-portal') requiredKinds.add('independence');
  if (
    plan.strategy !== 'blank-frontend' &&
    plan.requiredLayers.some(layer => !['frontend', 'configuration'].includes(layer))
  )
    requiredKinds.add('journey');
  if (plan.strategy !== 'blank-frontend' && plan.requiredLayers.includes('database'))
    requiredKinds.add('migration');
  for (const kind of requiredKinds)
    if (
      !report.checks.some(
        check => check.kind === kind && check.required && check.status === 'passed',
      )
    )
      issues.push(`MISSING_REQUIRED_CHECK:${kind}`);
  for (const requirement of plan.requirements.filter(item => item.required)) {
    if (plan.strategy !== 'blank-frontend') {
      if (portalRequirementNeedsBlueprint(requirement))
        issues.push(`WORKFLOW_BLUEPRINT_REQUIRED:${requirement.id}`);
    }
    if (
      !report.checks.some(
        check =>
          check.required &&
          check.status === 'passed' &&
          check.requirementIds.includes(requirement.id),
      )
    )
      issues.push(`REQUIREMENT_NOT_VERIFIED:${requirement.id}`);
    const kinds = new Set<PortalAcceptance['checks'][number]['kind']>();
    for (const layer of requirement.layers) {
      if (layer === 'frontend') {
        kinds.add('interaction');
        kinds.add('accessibility');
        kinds.add('visual');
      }
      const kind = layerChecks[layer];
      if (kind) kinds.add(kind);
      if (layer === 'database') kinds.add('migration');
    }
    if (plan.strategy !== 'blank-frontend' && requirement.layers.some(layer => layerChecks[layer]))
      kinds.add('journey');
    for (const kind of kinds)
      if (
        !report.checks.some(
          check =>
            check.kind === kind &&
            check.required &&
            check.status === 'passed' &&
            check.requirementIds.includes(requirement.id),
        )
      )
        issues.push(`REQUIREMENT_CHECK_MISSING:${requirement.id}:${kind}`);
  }
  return issues;
};
