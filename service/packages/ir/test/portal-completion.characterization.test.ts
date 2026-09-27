import {
  PORTAL_CORE_RECIPE_IDS,
  PortalAcceptanceSchema,
  canonicalCoreDeclarations,
} from '@sfp/shared';
import { expect, it } from 'vitest';

import { PortalCaptureDescriptorSchema } from '../../shared/src/portal-capture-source.js';
import { contentHash } from '../src/canonical-json.js';
import { portalCompletionIssues, type PortalPlan } from '../src/portal-run.js';

/*
 * T06a characterization of finding K1 (remediation plan section 3.1). The fix is task T14b.
 *
 * K1: `portalCompletionIssues` (ir/src/portal-run.ts:183-233) requires `report.recipeConsumption`,
 * but the native validation report builder (mcp/src/portal/native-work.ts:671-752) never sets it.
 * This file pins the gate side: a C4 report with exactly the fields that builder emits, and
 * otherwise complete evidence, fails with PORTAL_RECIPE_CONSUMPTION_REQUIRED and nothing else.
 * The producer side, which flips when T14b wires consumption verification into validation, is in
 * mcp/test/portal/native-work.characterization.test.ts.
 *
 * The fixtures are the synthetic descriptor, plan, report, core binding and receipt of
 * ir/test/portal-completion.test.ts, narrowed to the C4 (blank-frontend) case. They isolate the
 * pure completion predicate; they are not live capture or native verification evidence.
 */
const hash = `sha256:${'a'.repeat(64)}` as const;
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
const interactionContract = {
  version: 1,
  captureFingerprint: hash,
  scopeHash: hash,
  interactions: [],
  workflowIds: [],
  workflows: [],
  complete: true,
  issues: [],
};
// C4: new blank frontend, frontend-only scope, one required frontend workflow.
const plan = {
  sourceAuthorityVersion: 2,
  ownerId: 'owner',
  workspaceId: 'workspace',
  blueprintHash: hash,
  coreRecipes: core,
  interactionContract,
  analysisVersion: 2,
  serviceSelection: { version: 2, complete: true },
  workflowCoverage: { version: 1, complete: true },
  strategy: 'blank-frontend',
  implementationScope: 'frontend-only',
  requiredLayers: ['frontend'],
  requirements: [{ id: 'portal-experience', required: true, layers: ['frontend'] }],
  design: { complete: true, liveVerified: true, artifactHash: hash, capture },
  request: { design: { freshness: 'require-live' } },
} as unknown as PortalPlan;
const run = {
  candidateHash: hash,
  coreRecipes: core,
  coreDeclarations: [],
  coreDeclarationsHash: contentHash(
    'sfp-portal-core-declarations-v1',
    canonicalCoreDeclarations([]),
  ),
};
/**
 * The keys of the `PortalAcceptanceSchema.parse({...})` literal in native-work.ts:671-752, with
 * `observations` present (it is emitted when visual evidence and an observation manifest exist).
 * `recipeConsumption` is not among them: validation never sets it.
 */
const NATIVE_WORK_REPORT_KEYS = [
  'analysisHash',
  'capture',
  'checks',
  'designHash',
  'environmentId',
  'evidencePaths',
  'liveDesignVerified',
  'nativeArtifactAuthority',
  'nativeEnvironment',
  'observations',
  'runtimeVerified',
  'sourceAuthorityVersion',
  'sourceHash',
];
// Parsed the same way native-work.ts parses its report.
const nativeShapedReport = PortalAcceptanceSchema.parse({
  capture: {
    version: 2,
    originalDescriptorHash: contentHash('sfp-portal-capture-descriptor-v2', capture),
    freshDesignFingerprint: hash,
  },
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
    moduleFenceProtocol: 'sfp-native-module-fence-v1',
    moduleEvidenceHash: hash,
    manifestHash: hash,
    outputReceiptHash: hash,
  },
  sourceAuthorityVersion: 2,
  analysisHash: contentHash('sfp-portal-analysis-receipt-v1', {
    selection: plan.serviceSelection,
    coverage: plan.workflowCoverage,
  }),
  sourceHash: hash,
  designHash: hash,
  environmentId: 'a'.repeat(64),
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
    requirementIds: ['portal-experience'],
    required: true,
    status: 'passed',
  })),
  liveDesignVerified: true,
  observations: {
    version: 1,
    manifestHash: hash,
    interactionContractHash: contentHash('sfp-interaction-contract-v1', interactionContract),
    receiptHash: hash,
    executedObservationIds: ['fixture'],
    executedAssertionIds: [],
    executedWorkflowIds: [],
  },
  runtimeVerified: true,
  evidencePaths: [],
});
// The receipt shape that portalCompletionIssues checks (portal-run.ts:216-233).
const consumptionReceipt = {
  recipeAuthorityVersion: 1 as const,
  ownerId: 'owner',
  workspaceId: 'workspace',
  contextHash: hash,
  blueprintHash: hash,
  candidateHash: hash,
  target: 'candidate' as const,
  verifierVersion: 'core-consumption-v1',
  resultHashes: core.requiredResults.map(row => row.resultHash),
  declarationsHash: run.coreDeclarationsHash,
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

it('K1 characterization: an otherwise complete C4 report shaped like native validation fails only with PORTAL_RECIPE_CONSUMPTION_REQUIRED (producer flips in T14b)', () => {
  // K1, fixed by T14b. The report carries exactly the fields native-work.ts:671-752 can emit.
  expect(Object.keys(nativeShapedReport).toSorted()).toEqual(NATIVE_WORK_REPORT_KEYS);
  expect(nativeShapedReport).not.toHaveProperty('recipeConsumption');

  // Current behavior: the missing consumption receipt is the single remaining completion issue,
  // so no report that native validation produces today can complete a C4 run.
  expect(portalCompletionIssues(plan, nativeShapedReport, hash, run, 'candidate')).toEqual([
    'PORTAL_RECIPE_CONSUMPTION_REQUIRED',
  ]);

  // Control: the fixture is otherwise complete. With the receipt that T14b must emit, the same
  // report has no issue. This half does not change when K1 is fixed; the producer test flips.
  expect(
    portalCompletionIssues(
      plan,
      PortalAcceptanceSchema.parse({
        ...nativeShapedReport,
        recipeConsumption: consumptionReceipt,
      }),
      hash,
      run,
      'candidate',
    ),
  ).toEqual([]);
});
