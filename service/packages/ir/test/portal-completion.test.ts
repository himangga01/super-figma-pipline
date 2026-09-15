import {
  PORTAL_CORE_RECIPE_IDS,
  canonicalCoreDeclarations,
  type PortalAcceptance,
} from '@sfp/shared';
import { expect, it } from 'vitest';

import { PortalCaptureDescriptorSchema } from '../../shared/src/portal-capture-source.js';
import { contentHash } from '../src/canonical-json.js';
import { portalCompletionIssues, type PortalPlan } from '../src/portal-run.js';
const hash = `sha256:${'a'.repeat(64)}` as const;
it('cannot finish C2/C3 with frontend checks and mocked-away persistence/auth', () => {
  // Synthetic descriptor/receipts isolate the pure completion predicate, not live capture.
  const capture = PortalCaptureDescriptorSchema.parse({
    version: 2,
    admission: {
      version: 1,
      kind: 'chrome',
      phase: 'requested-source',
      binding: 'selected-page-after-approved-connection',
      url: 'https://www.figma.com/design/fixture?node-id=0-1',
      fileKeyHash: hash,
      requestedNodeId: '0:1',
    },
    rawHash: hash,
    assetManifestHash: hash,
    contentFingerprint: hash,
    sourceFingerprint: hash,
    contractFingerprint: hash,
    assetFingerprint: hash,
    evidenceHash: hash,
    designFingerprint: hash,
    source: {
      kind: 'chrome',
      url: 'https://www.figma.com/design/fixture?node-id=0-1',
      fileKeyHash: hash,
      requestedNodeId: '0:1',
      scopeId: '0:1',
      bindingMethod: 'file-key',
    },
  });
  const plan = {
    sourceAuthorityVersion: 2,
    interactionContract: {
      version: 1,
      captureFingerprint: hash,
      scopeHash: hash,
      interactions: [],
      workflowIds: [],
      workflows: [],
      complete: true,
      issues: [],
    },
    analysisVersion: 2,
    serviceSelection: { version: 2, complete: true },
    workflowCoverage: { version: 1, complete: true },
    strategy: 'reference-portal',
    implementationScope: 'operational-portal',
    requiredLayers: ['frontend', 'backend', 'database', 'authentication'],
    requirements: [{ id: 'orders', required: true, layers: ['frontend'] }],
    design: { complete: true, liveVerified: true, artifactHash: hash, capture },
    request: { design: { freshness: 'require-live' } },
  } as unknown as PortalPlan;
  const report = {
    sourceAuthorityVersion: 2,
    observations: {
      version: 1,
      manifestHash: hash,
      interactionContractHash: contentHash('sfp-interaction-contract-v1', plan.interactionContract),
      receiptHash: hash,
      executedObservationIds: ['fixture'],
      executedAssertionIds: [],
      executedWorkflowIds: [],
    },
    capture: {
      version: 2,
      originalDescriptorHash: contentHash('sfp-portal-capture-descriptor-v2', capture),
      freshDesignFingerprint: hash,
    },
    analysisHash: contentHash('sfp-portal-analysis-receipt-v1', {
      selection: plan.serviceSelection,
      coverage: plan.workflowCoverage,
    }),
    sourceHash: hash,
    designHash: hash,
    environmentId: 'local',
    nativeEnvironment: {
      version: 1,
      attemptId: 'a'.repeat(64),
      executionHash: hash,
      receiptHash: hash,
      target: 'candidate',
      disposition: 'retained-artifact',
    },
    nativeArtifactAuthority: {
      version: 1,
      manifestHash: hash,
      outputReceiptHash: hash,
      moduleFenceProtocol: 'sfp-native-module-fence-v1',
      moduleEvidenceHash: hash,
    },
    runtimeVerified: true,
    liveDesignVerified: true,
    evidencePaths: [],
    checks: [
      'build',
      'typecheck',
      'interaction',
      'accessibility',
      'visual',
      'source-scope',
      'independence',
    ].map(kind => ({
      id: kind,
      kind,
      requirementIds: ['orders'],
      required: true,
      status: 'passed',
    })),
  } as PortalAcceptance;
  expect(portalCompletionIssues(plan, { ...report, observations: undefined }, hash)).toContain(
    'PORTAL_OBSERVATION_RECEIPT_REQUIRED',
  );
  expect(
    portalCompletionIssues({ ...plan, interactionContract: undefined }, report, hash),
  ).toContain('PORTAL_OBSERVATION_RECEIPT_REQUIRED');
  expect(portalCompletionIssues(plan, { ...report, capture: undefined }, hash)).toContain(
    'PORTAL_CAPTURE_RECEIPT_REQUIRED',
  );
  expect(portalCompletionIssues(plan, { ...report, nativeEnvironment: undefined }, hash)).toContain(
    'PORTAL_ENVIRONMENT_RECEIPT_REQUIRED',
  );
  expect(portalCompletionIssues(plan, report, hash)).toEqual(
    expect.arrayContaining([
      'MISSING_REQUIRED_CHECK:api',
      'MISSING_REQUIRED_CHECK:persistence',
      'MISSING_REQUIRED_CHECK:authorization',
    ]),
  );
  expect(
    portalCompletionIssues(
      { ...plan, strategy: 'blank-frontend', requiredLayers: ['frontend'] },
      report,
      hash,
    ),
  ).toEqual(
    expect.arrayContaining([
      'PORTAL_CORE_REPLAN_REQUIRED',
      'PORTAL_CORE_DECLARATIONS_REQUIRED',
      'PORTAL_RECIPE_CONSUMPTION_REQUIRED',
    ]),
  );
  expect(portalCompletionIssues(plan, { ...report, runtimeVerified: false }, hash)).toContain(
    'RUNTIME_NOT_VERIFIED',
  );
  expect(portalCompletionIssues(plan, { ...report, designHash: null }, hash)).toContain(
    'VALIDATION_DESIGN_CHANGED',
  );
  expect(
    portalCompletionIssues(plan, { ...report, nativeArtifactAuthority: undefined }, hash),
  ).toContain('PORTAL_ARTIFACT_AUTHORITY_REQUIRED');
  expect(
    portalCompletionIssues(
      plan,
      { ...report, nativeArtifactAuthority: { ...report.nativeArtifactAuthority!, version: 2 } },
      hash,
    ),
  ).toContain('PORTAL_ARTIFACT_AUTHORITY_REQUIRED');
  const unrelated = {
    ...report,
    checks: [
      ...report.checks,
      {
        id: 'unrelated-api',
        kind: 'api' as const,
        requirementIds: ['another-workflow'],
        required: true,
        status: 'passed' as const,
      },
    ],
  };
  expect(
    portalCompletionIssues(
      { ...plan, requirements: [{ ...plan.requirements[0]!, layers: ['frontend', 'api'] }] },
      unrelated,
      hash,
    ),
  ).toContain('REQUIREMENT_CHECK_MISSING:orders:api');
  // Synthetic records isolate identity gates; actual signed/native consumption is tested by MCP.
  const core = {
    recipeAuthorityVersion: 1 as const,
    status: 'ready' as const,
    code: null,
    contractHash: hash,
    requirementsHash: hash,
    preparationId: hash,
    contextHash: hash,
    inputHash: hash,
    requiredResults: PORTAL_CORE_RECIPE_IDS.map(recipeId => ({
      recipeId,
      definitionHash: hash,
      resultId: contentHash('id', recipeId),
      resultHash: contentHash('result', recipeId),
    })),
    workItemsHash: hash,
    workItemCount: 0,
    bindingHash: hash,
  };
  const currentPlan = {
    ...plan,
    ownerId: 'owner',
    workspaceId: 'workspace',
    blueprintHash: hash,
    coreRecipes: core,
  };
  const currentRun = {
    candidateHash: hash,
    coreRecipes: core,
    coreDeclarations: [],
    coreDeclarationsHash: contentHash(
      'sfp-portal-core-declarations-v1',
      canonicalCoreDeclarations([]),
    ),
  };
  const receipt = {
    recipeAuthorityVersion: 1 as const,
    ownerId: 'owner',
    workspaceId: 'workspace',
    contextHash: hash,
    blueprintHash: hash,
    candidateHash: hash,
    target: 'candidate' as const,
    verifierVersion: 'core-consumption-v1',
    resultHashes: core.requiredResults.map(row => row.resultHash),
    declarationsHash: currentRun.coreDeclarationsHash,
    findings: [
      {
        kind: 'review' as const,
        decision: 'accepted' as const,
        reviewerId: 'unit-test',
        rationale: 'Synthetic completion predicate fixture only; this is not native verification.',
        sourceHashes: [hash],
        evidenceHash: hash,
      },
    ],
  };
  const coreIssues = (value: PortalAcceptance, run = currentRun) =>
    portalCompletionIssues(currentPlan, value, hash, run, 'candidate').filter(
      issue => issue.startsWith('PORTAL_CORE_') || issue === 'PORTAL_RECIPE_CONSUMPTION_REQUIRED',
    );
  expect(coreIssues({ ...report, recipeConsumption: receipt })).toEqual([]);
  expect(coreIssues(report)).toContain('PORTAL_RECIPE_CONSUMPTION_REQUIRED');
  for (const change of [
    { ownerId: 'other' },
    { workspaceId: 'other' },
    { contextHash: contentHash('other', 'context') },
    { blueprintHash: contentHash('other', 'blueprint') },
    { candidateHash: contentHash('other', 'candidate') },
    { declarationsHash: contentHash('other', 'declarations') },
    { verifierVersion: 'old-verifier' },
    { target: 'applied' as const },
    { resultHashes: receipt.resultHashes.slice(1) },
  ])
    expect(coreIssues({ ...report, recipeConsumption: { ...receipt, ...change } })).toContain(
      'PORTAL_RECIPE_CONSUMPTION_REQUIRED',
    );
  expect(
    coreIssues(
      { ...report, recipeConsumption: receipt },
      { ...currentRun, coreDeclarationsHash: hash },
    ),
  ).toContain('PORTAL_CORE_DECLARATIONS_REQUIRED');
});
