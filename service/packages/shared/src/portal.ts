import { z } from 'zod';

import {
  PortalCorePlanBindingSchema,
  PortalCoreDeclarationBatchSchema,
  PortalCoreEvidenceViewSchema,
} from './portal-core-lifecycle.js';
import { PortalRecipeVerifiedConsumptionSchema } from './portal-recipes.js';
export * from './portal-core-lifecycle.js';

import { PortalInteractionContractSchema } from './portal-observations.js';
export * from './portal-observations.js';

import {
  PortalCaptureSourceSchema,
  PortalCaptureDescriptorSchema,
  type PortalCaptureGrant,
} from './portal-capture-source.js';
import { ProjectProfileSchema } from './project-profile.js';

export const DEFAULT_PORTAL_DESIGN_URL =
  'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
export const PORTAL_TOOL_NAMES = [
  'portal_plan',
  'portal_start',
  'portal_next',
  'portal_submit',
  'portal_apply',
  'portal_validate',
  'portal_status',
  'portal_resume',
  'portal_cancel',
] as const;
export type PortalToolName = (typeof PORTAL_TOOL_NAMES)[number];
export const PortalCaseSchema = z.enum(['new', 'legacy', 'new-reference', 'new-blank']);
export const PortalStrategySchema = z.enum(['legacy-portal', 'reference-portal', 'blank-frontend']);
export const PortalScopeSchema = z.enum(['operational-portal', 'frontend-only']);
export const PortalLayerSchema = z.enum([
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
]);
export type PortalLayer = z.infer<typeof PortalLayerSchema>;
export const PortalHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const PortalIdSchema = z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u);
export const PortalWorkspaceSchema = z.string().uuid();
export const PortalPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    path =>
      !path.startsWith('/') &&
      !/[\\:]/u.test(path) &&
      !Array.from(path).some(
        character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      path.split('/').every(part => part !== '' && part !== '.' && part !== '..') &&
      !path
        .split('/')
        .some(
          part =>
            /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
        ),
    'Use a portable relative path without aliases or reserved names',
  );
const RelativeRootSchema = z.union([z.literal('.'), PortalPathSchema]);
const ReferenceSchema = z
  .object({
    workspaceId: PortalWorkspaceSchema,
    rootPath: RelativeRootSchema.default('.'),
    role: z.enum(['primary', 'supplemental']).default('primary'),
  })
  .strict();
const DesignSchema = z
  .object({
    url: z.url().default(DEFAULT_PORTAL_DESIGN_URL),
    source: PortalCaptureSourceSchema.default('chrome'),
    artifactPath: PortalPathSchema.optional(),
    artifactHash: PortalHashSchema.optional(),
    freshness: z.enum(['require-live', 'allow-pinned']).default('require-live'),
  })
  .strict();
export const PortalRequirementSchema = z
  .object({
    id: z.string().min(1).max(128),
    description: z.string().min(1).max(2048),
    layers: z.array(PortalLayerSchema).min(1).max(10),
    required: z.boolean().default(true),
    workflow: z
      .object({
        status: z.enum(['draft', 'confirmed']),
        roles: z.array(z.string().min(1).max(128)).min(1).max(32),
        states: z.array(z.string().min(1).max(256)).min(1).max(64),
        routes: z.array(z.string().min(1).max(512)).max(64),
        apiContracts: z.array(z.string().min(1).max(2048)).max(64),
        dataContracts: z.array(z.string().min(1).max(2048)).max(64),
        decisions: z
          .array(
            z
              .object({
                layer: PortalLayerSchema,
                action: z.enum(['present', 'extend', 'implement']),
                evidence: z.string().min(1).max(2048),
                sourceEvidence: z
                  .array(
                    z
                      .object({
                        sourceId: PortalHashSchema,
                        sourceIndex: z.number().int().min(0).max(8),
                        path: PortalPathSchema,
                        hash: PortalHashSchema,
                      })
                      .strict(),
                  )
                  .max(64)
                  .optional(),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export const portalRequirementNeedsBlueprint = (
  requirement: z.infer<typeof PortalRequirementSchema>,
): boolean => {
  const workflow = requirement.workflow;
  return (
    !workflow ||
    workflow.status !== 'confirmed' ||
    requirement.layers.some(
      layer => !workflow.decisions.some(decision => decision.layer === layer),
    ) ||
    (requirement.layers.some(layer => ['backend', 'api'].includes(layer)) &&
      !workflow.apiContracts.length) ||
    (requirement.layers.some(layer => ['database', 'storage'].includes(layer)) &&
      !workflow.dataContracts.length)
  );
};
/** Explicit selectors bind a service to the verified repository grant, never permission. */
export const PortalQualifiedServiceSchema = z
  .object({
    sourceId: PortalHashSchema,
    sourceIndex: z.number().int().min(0).max(8),
    rootPath: RelativeRootSchema,
  })
  .strict();
export const PortalServiceSelectorSchema = z.union([
  RelativeRootSchema,
  PortalQualifiedServiceSchema,
]);
export const PortalSemanticReviewSchema = z
  .object({
    sourceId: PortalHashSchema,
    sourceIndex: z.number().int().min(0).max(8),
    path: PortalPathSchema,
    hash: PortalHashSchema,
    issue: z.string().min(1).max(256),
    offset: z.number().int().nonnegative(),
    decision: z.literal('retain-conservative-closure'),
    layers: z.array(PortalLayerSchema).max(10),
    conclusion: z.string().min(20).max(4096),
  })
  .strict();
export const PortalWorkflowDecisionSchema = z
  .object({
    analysisHash: PortalHashSchema,
    evidenceId: z.string().min(1).max(256),
    requirementIds: z.array(z.string().min(1).max(128)).min(1).max(128),
    decision: z.enum(['implement', 'reuse', 'extend']),
    rationale: z.string().min(20).max(2048),
  })
  .strict();
export const PortalConnectionEvidenceSchema = z
  .object({
    sourceId: z.string().min(1).max(512),
    path: PortalPathSchema,
    hash: PortalHashSchema,
    offset: z.number().int().nonnegative(),
    reason: z.string().max(2048),
  })
  .strict();
const ConnectionEndpointSchema = z
  .object({
    sourceId: z.string(),
    serviceId: z.string(),
    method: z.string(),
    route: z.string(),
    origin: z.string().optional(),
    evidence: PortalConnectionEvidenceSchema,
    supportingEvidence: z.array(PortalConnectionEvidenceSchema).optional(),
  })
  .strict();
export const PortalConnectionAnalysisSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    issuesTruncated: z.boolean().optional(),
    producers: z.array(ConnectionEndpointSchema).max(10000),
    clients: z.array(ConnectionEndpointSchema).max(10000),
    data: z
      .array(
        z
          .object({
            sourceId: z.string(),
            serviceId: z.string(),
            module: z.string(),
            status: z.literal('candidate'),
            evidence: PortalConnectionEvidenceSchema,
          })
          .strict(),
      )
      .max(10000),
    configuration: z
      .array(
        z
          .object({
            sourceId: z.string(),
            serviceId: z.string(),
            module: z.string(),
            status: z.literal('candidate'),
            evidence: PortalConnectionEvidenceSchema,
          })
          .strict(),
      )
      .max(10000),
    connections: z
      .array(
        z
          .object({
            kind: z.enum(['module-dependency', 'http-contract']),
            fromSourceId: z.string(),
            fromServiceId: z.string(),
            toSourceId: z.string(),
            toServiceId: z.string(),
            evidence: z.array(PortalConnectionEvidenceSchema),
            routingBasis: z
              .array(z.enum(['supported-configuration', 'admitted-source-review']))
              .optional(),
          })
          .strict(),
      )
      .max(10000),
    issues: z
      .array(
        z
          .object({ code: z.string(), evidence: PortalConnectionEvidenceSchema.optional() })
          .strict(),
      )
      .max(512),
  })
  .strict();
export const PortalServiceSelectionSchema = z
  .object({
    version: z.literal(2),
    hash: PortalHashSchema,
    selected: z.array(PortalQualifiedServiceSchema).max(1152),
    closure: z.array(PortalQualifiedServiceSchema).max(1152),
    connections: z.array(PortalConnectionAnalysisSchema).max(9),
    reviews: z.array(PortalSemanticReviewSchema).max(512),
    complete: z.boolean(),
    issues: z.array(z.string()).max(512),
  })
  .strict();
export const PortalWorkflowCoverageSchema = z
  .object({
    version: z.literal(1),
    analysisHash: PortalHashSchema,
    evidence: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.enum(['design', 'source']),
            hash: PortalHashSchema,
            nodeId: z.string().optional(),
            nodePath: z.string().optional(),
            sourceId: z.string().optional(),
            path: z.string().optional(),
            labels: z.array(z.string()).optional(),
            rationale: z.string().optional(),
            sourceHintKind: z
              .enum(['configured-integration', 'persistence', 'read-api', 'authentication'])
              .optional(),
          })
          .strict(),
      )
      .max(10000),
    scopes: z
      .array(
        z
          .object({
            id: z.string(),
            evidenceIds: z.array(z.string()),
            requirementIds: z.array(z.string()),
            status: z.enum(['covered', 'unresolved']),
          })
          .strict(),
      )
      .max(10000),
    decisions: z.array(PortalWorkflowDecisionSchema).max(512),
    complete: z.boolean(),
    issues: z.array(z.string()).max(512),
  })
  .strict();
export const assertCurrentPortalAnalysis = (
  plan: {
    analysisVersion?: number | undefined;
    serviceSelection?: { version: number; complete: boolean } | undefined;
    workflowCoverage?: { version: number; complete: boolean } | undefined;
    profiles?:
      | Array<{
          graph: {
            analysisVersion?: number | undefined;
            issuesTruncated?: boolean | undefined;
            connections?: { issuesTruncated?: boolean | undefined } | undefined;
          };
        }>
      | undefined;
  },
  requireResolved = true,
): void => {
  if (
    plan.analysisVersion !== 2 ||
    plan.serviceSelection?.version !== 2 ||
    plan.workflowCoverage?.version !== 1 ||
    plan.profiles?.some(
      profile =>
        profile.graph.analysisVersion !== 2 ||
        typeof profile.graph.issuesTruncated !== 'boolean' ||
        typeof profile.graph.connections?.issuesTruncated !== 'boolean',
    )
  )
    throw Object.assign(new Error('PORTAL_ANALYSIS_REPLAN_REQUIRED'), {
      code: 'PORTAL_ANALYSIS_REPLAN_REQUIRED',
    });
  if (
    requireResolved &&
    (!plan.serviceSelection.complete ||
      !plan.workflowCoverage.complete ||
      plan.profiles?.some(
        profile => profile.graph.issuesTruncated || profile.graph.connections?.issuesTruncated,
      ))
  )
    throw Object.assign(new Error('PORTAL_ANALYSIS_RESOLUTION_REQUIRED'), {
      code: 'PORTAL_ANALYSIS_RESOLUTION_REQUIRED',
    });
};
export const PortalPlanArgsSchema = z
  .object({
    resumePlanId: PortalIdSchema.optional(),
    case: PortalCaseSchema.default('new'),
    targetPath: RelativeRootSchema.optional(),
    references: z.array(ReferenceSchema).max(8).default([]),
    design: DesignSchema.default({
      url: DEFAULT_PORTAL_DESIGN_URL,
      source: 'chrome',
      freshness: 'require-live',
    }),
    services: z.array(PortalServiceSelectorSchema).max(32).default([]),
    sourceReviews: z.array(PortalSemanticReviewSchema).max(512).default([]),
    workflowDecisions: z.array(PortalWorkflowDecisionSchema).max(512).default([]),
    requirements: z.array(PortalRequirementSchema).max(128).default([]),
    stack: z.enum(['auto', 'react-vite', 'vue-vite']).default('auto'),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.case === 'legacy' && request.targetPath === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['targetPath'],
        message: 'A legacy target is required',
      });
    if (request.case === 'new-reference' && request.references.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'A reference service is required',
      });
    if (request.case === 'new-blank' && request.references.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Explicit no-reference builds cannot read reference services',
      });
    if (
      new Set(request.references.map(reference => `${reference.workspaceId}/${reference.rootPath}`))
        .size !== request.references.length
    )
      ctx.addIssue({ code: 'custom', path: ['references'], message: 'Duplicate reference root' });
    const blank =
      request.case === 'new-blank' || (request.case === 'new' && request.references.length === 0);
    if (
      blank &&
      request.requirements.some(requirement =>
        requirement.layers.some(layer => !['frontend', 'configuration'].includes(layer)),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['requirements'],
        message: 'Case 4 only implements frontend behavior and configuration',
      });
    if (
      !/^https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[A-Za-z0-9]{10,128}(?:\/[^/?#\s]*)?\/?(?:\?[^#\s]*)?(?:#[^\s]*)?$/u.test(
        request.design.url,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['design', 'url'],
        message: 'Use an HTTPS Figma file URL without credentials or a custom port',
      });
  });
export type PortalPlanArgs = z.infer<typeof PortalPlanArgsSchema>;
export const resolvePortalCase = (input: unknown) => {
  const request = PortalPlanArgsSchema.parse(input);
  const strategy =
    request.case === 'legacy'
      ? 'legacy-portal'
      : request.references.length > 0
        ? 'reference-portal'
        : 'blank-frontend';
  return {
    requestedCase: request.case,
    strategy,
    implementationScope: strategy === 'blank-frontend' ? 'frontend-only' : 'operational-portal',
  } as const;
};

export const PortalEvidenceSchema = z
  .object({
    sourceId: PortalHashSchema.optional(),
    sourceRole: z.enum(['runtime', 'auxiliary', 'configuration', 'asset']).optional(),
    path: PortalPathSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    hash: PortalHashSchema,
    kind: z.string().min(1).max(64),
    detail: z.string().max(2048),
  })
  .strict();
export const PortalServiceSchema = z
  .object({
    id: z.string().min(1).max(128),
    rootPath: RelativeRootSchema,
    languages: z.array(z.string()).max(16),
    frameworks: z.array(z.string()).max(32),
    layers: z.array(PortalLayerSchema).max(10),
    dependencies: z.record(z.string(), z.string()),
    scripts: z.record(z.string(), z.string()),
    codePatterns: ProjectProfileSchema.optional(),
    evidence: z.array(PortalEvidenceSchema).max(512),
  })
  .strict();
export const PortalSourceInventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    policyVersion: z.literal('portal-source-v1'),
    hash: PortalHashSchema,
    files: z
      .array(
        z
          .object({
            path: PortalPathSchema,
            bytes: z.number().int().min(0).max(16_777_216),
            hash: PortalHashSchema,
            classification: z.enum(['text', 'binary']),
          })
          .strict(),
      )
      .max(5000),
    exclusions: z
      .array(
        z
          .object({
            path: PortalPathSchema,
            kind: z.enum(['file', 'directory', 'link', 'other']),
            reason: z.enum([
              'git-metadata',
              'provisioned-dependencies',
              'credentials',
              'service-runtime',
            ]),
          })
          .strict(),
      )
      .max(20000),
    limits: z
      .object({
        maxFiles: z.number().int().min(1).max(5000),
        maxFileBytes: z.number().int().min(1).max(16_777_216),
        maxTotalBytes: z.number().int().min(1).max(134_217_728),
        maxScanEntries: z.number().int().min(1).max(20000),
      })
      .strict(),
    scannedEntries: z.number().int().min(0).max(20000),
    totalBytes: z.number().int().min(0).max(134_217_728),
    complete: z.boolean(),
    issues: z
      .array(
        z.object({ code: z.string().min(1).max(128), path: PortalPathSchema.optional() }).strict(),
      )
      .max(512),
  })
  .strict();
export type PortalSourceInventory = z.infer<typeof PortalSourceInventorySchema>;

export const ServiceGraphProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    rootPath: RelativeRootSchema,
    sourceHash: PortalHashSchema,
    // Historical semantic graphs have no byte authority inventory; never synthesize one.
    sourceInventory: PortalSourceInventorySchema.optional(),
    analysisVersion: z.literal(2).optional(),
    issuesTruncated: z.boolean().optional(),
    sourceId: PortalHashSchema.optional(),
    connections: PortalConnectionAnalysisSchema.optional(),
    services: z.array(PortalServiceSchema).max(128),
    files: z
      .array(
        z
          .object({
            path: PortalPathSchema,
            hash: PortalHashSchema,
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(5000),
    edges: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            kind: z.enum([
              'imports',
              'provides-api',
              'consumes-api',
              'persists',
              'depends-on',
              'configures',
            ]),
            evidence: PortalEvidenceSchema,
          })
          .strict(),
      )
      .max(10000),
    incomplete: z.boolean(),
    lexicalReviewable: z.boolean().default(false),
    issues: z.array(z.string()).max(512),
  })
  .strict();
export type ServiceGraphProfile = z.infer<typeof ServiceGraphProfileSchema>;

export const PortalCheckSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum([
      'build',
      'typecheck',
      'interaction',
      'accessibility',
      'visual',
      'api',
      'persistence',
      'authorization',
      'migration',
      'integration',
      'independence',
      'source-scope',
      'journey',
    ]),
    requirementIds: z.array(z.string()).max(128),
    required: z.boolean(),
    status: z.enum(['pending', 'passed', 'failed', 'blocked', 'skipped', 'not-applicable']),
    reason: z.string().max(2048).optional(),
  })
  .strict();
/** Missing authority markers remain historical and never imply current verification. */
export const PORTAL_SOURCE_AUTHORITY_VERSION = 2 as const;
export const PortalSourceAuthorityVersionSchema = z
  .number()
  .int()
  .positive()
  .max(PORTAL_SOURCE_AUTHORITY_VERSION)
  .superRefine(value => {
    if (value !== undefined && value > PORTAL_SOURCE_AUTHORITY_VERSION)
      throw Object.assign(new Error('PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED'), {
        code: 'PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED',
      });
  })
  .optional();
export const assertCurrentPortalSourceAuthority = (
  ...records: Array<{ sourceAuthorityVersion?: number | undefined }>
): void => {
  for (const record of records) {
    PortalSourceAuthorityVersionSchema.parse(record.sourceAuthorityVersion);
    if (record.sourceAuthorityVersion !== PORTAL_SOURCE_AUTHORITY_VERSION)
      throw Object.assign(new Error('PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED'), {
        code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
      });
  }
};

export const PortalAcceptanceSchema = z
  .object({
    recipeConsumption: z.lazy(() => PortalRecipeVerifiedConsumptionSchema).optional(),
    observations: z
      .object({
        version: z.literal(1),
        manifestHash: PortalHashSchema,
        interactionContractHash: PortalHashSchema,
        receiptHash: PortalHashSchema,
        executedObservationIds: z.array(z.string()).max(256),
        executedAssertionIds: z.array(z.string()).max(4096),
        executedWorkflowIds: z.array(z.string()).max(128),
      })
      .strict()
      .optional(),
    capture: z
      .object({
        version: z.literal(2),
        originalDescriptorHash: PortalHashSchema,
        freshDesignFingerprint: PortalHashSchema.nullable(),
      })
      .strict()
      .optional(),
    nativeEnvironment: z
      .object({
        version: z.literal(1),
        attemptId: z.string().regex(/^[a-f0-9]{64}$/u),
        executionHash: PortalHashSchema,
        receiptHash: PortalHashSchema,
        target: z.enum(['candidate', 'applied']),
        disposition: z.literal('retained-artifact'),
      })
      .strict()
      .optional(),
    nativeArtifactAuthority: z
      .object({
        version: z.number().int().positive(),
        manifestHash: PortalHashSchema,
        outputReceiptHash: PortalHashSchema,
        moduleFenceProtocol: z.literal('sfp-native-module-fence-v1').optional(),
        moduleEvidenceHash: PortalHashSchema.optional(),
      })
      .strict()
      .optional(),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    analysisHash: PortalHashSchema.optional(),
    sourceHash: PortalHashSchema,
    designHash: PortalHashSchema.nullable(),
    environmentId: z.string().min(1).max(128),
    checks: z.array(PortalCheckSchema).min(1).max(512),
    liveDesignVerified: z.boolean(),
    runtimeVerified: z.boolean(),
    evidencePaths: z.array(PortalPathSchema).max(1024),
  })
  .strict();
export type PortalAcceptance = z.infer<typeof PortalAcceptanceSchema>;
export const PortalStateSchema = z.enum([
  'planned',
  'needs-input',
  'waiting-agent',
  'generating',
  'candidate-ready',
  'validating-candidate',
  'ready-to-apply',
  'applying',
  'applied-awaiting-validation',
  'validating-applied',
  'completed',
  'blocked',
  'failed',
  'cancel-requested',
  'cancelled',
  'conflict',
  'outcome-unknown',
]);
export const PortalCandidateFileSchema = z
  .object({
    path: PortalPathSchema,
    action: z.enum(['create', 'replace']),
    baseHash: PortalHashSchema.nullable(),
    // Base64 transport expands bytes by 4/3; the decoded submission budget stays one MiB.
    content: z.string().max(1_398_104),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
    contentHash: PortalHashSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    const contentSize =
      file.encoding === 'base64'
        ? (file.content.length / 4) * 3 -
          (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0)
        : file.content.length;
    if (contentSize > 1_048_576)
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'File content exceeds one MiB' });
    if ((file.action === 'create') !== (file.baseHash === null))
      ctx.addIssue({
        code: 'custom',
        message: 'Replacement requires an exact base hash; creation requires an absent target',
      });
  });
export const PortalStartArgsSchema = z.object({ planId: PortalIdSchema }).strict();
export const PortalRunArgsSchema = z.object({ runId: PortalIdSchema }).strict();
export const PortalResumeArgsSchema = PortalRunArgsSchema.extend({
  reconcile: z.enum(['none', 'inspect', 'continue']).default('none'),
}).strict();
export const PortalRecipeReadArgsSchema = z
  .object({
    workOffset: z.number().int().min(0).max(4096).default(0),
    resultId: PortalHashSchema.optional(),
    pageIndex: z.number().int().min(0).max(4095).default(0),
  })
  .strict();
export const PortalStatusArgsSchema = PortalRunArgsSchema.extend({
  recipes: PortalRecipeReadArgsSchema.optional(),
}).strict();
export const PortalNextArgsSchema = PortalRunArgsSchema.extend({
  recipes: PortalRecipeReadArgsSchema.optional(),
  tokenOffset: z.number().int().min(0).max(100_000).default(0),
  collectionOffset: z.number().int().min(0).max(100_000).default(0),
  styleFamily: z.enum(['paints', 'texts', 'effects', 'grids']).optional(),
  styleOffset: z.number().int().min(0).max(100_000).default(0),
  assetOffset: z.number().int().min(0).max(100_000).default(0),
  assetIds: z.array(z.number().int().min(0).max(100_000)).max(8).default([]),
  designOffset: z.number().int().min(0).max(100_000).default(0),
  designLimit: z.number().int().min(1).max(100).default(20),
  leaseId: z.string().uuid().optional(),
  fileOffset: z.number().int().min(0).max(5000).default(0),
  evidence: z
    .array(
      z.object({ sourceIndex: z.number().int().min(0).max(8), path: PortalPathSchema }).strict(),
    )
    .max(16)
    .default([]),
}).strict();
export const PortalSubmitArgsSchema = PortalRunArgsSchema.extend({
  leaseId: z.string().uuid(),
  leaseEpoch: z.number().int().positive(),
  blueprintHash: PortalHashSchema,
  contextHash: PortalHashSchema,
  files: z.array(PortalCandidateFileSchema).max(10).default([]),
  assets: z
    .array(
      z
        .object({
          path: PortalPathSchema,
          assetId: z.number().int().min(0).max(100_000),
          contentHash: PortalHashSchema,
          action: z.enum(['create', 'replace']),
          baseHash: PortalHashSchema.nullable(),
        })
        .strict()
        .superRefine((file, ctx) => {
          if ((file.action === 'create') !== (file.baseHash === null))
            ctx.addIssue({
              code: 'custom',
              message: 'Asset replacement requires the exact base hash',
            });
        }),
    )
    .max(10)
    .default([]),
  coreDeclarations: PortalCoreDeclarationBatchSchema.default([]),
  finished: z.boolean().default(false),
})
  .strict()
  .superRefine((value, ctx) => {
    if (!value.files.length && !value.assets.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Submit at least one source file or captured asset',
      });
  });
export const PortalValidateArgsSchema = PortalRunArgsSchema.extend({
  target: z.enum(['candidate', 'applied']).default('candidate'),
  profileId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/u)
    .default('node-frontend'),
}).strict();
export const PORTAL_INPUT_SCHEMAS = {
  portal_plan: PortalPlanArgsSchema,
  portal_start: PortalStartArgsSchema,
  portal_next: PortalNextArgsSchema,
  portal_submit: PortalSubmitArgsSchema,
  portal_apply: PortalRunArgsSchema,
  portal_validate: PortalValidateArgsSchema,
  portal_status: PortalStatusArgsSchema,
  portal_resume: PortalResumeArgsSchema,
  portal_cancel: PortalRunArgsSchema,
} as const;

export interface PortalAuthority {
  captureSource?: PortalCaptureGrant;
  executionAuthorityHash?: `sha256:${string}`;
  executionResources?: Array<{ key: string; mode: 'read' | 'write' }>;
  nativeEnvironment?: unknown;
  candidateHash?: string | null;
  workspaceId: string;
  targetPath: string;
  scope: 'operational-portal' | 'frontend-only';
  roots: Array<{
    workspaceId: string;
    rootPath: string;
    anchorPath: string;
    path: string;
    identity: string;
    role: 'target' | 'reference';
    writable: boolean;
  }>;
  hash: `sha256:${string}`;
  resource: { kind: 'run' | 'repo' | 'process' | 'control' | 'browser'; key: `portal:${string}` };
}
export const PortalCaptureFailureSchema = z
  .object({
    stage: z.enum([
      'capture',
      'connection',
      'readiness',
      'state-preparation',
      'snapshot',
      'checkpoint-read',
      'assets',
      'final-readiness',
      'schema',
      'checkpoint-publication',
      'design-publication',
      'cleanup',
    ]),
    code: z.enum([
      'DESIGN_CAPTURE_FAILED',
      'PORTAL_CAPTURE_TARGET_CHANGED',
      'PORTAL_CAPTURE_SOURCE_MISMATCH',
      'PORTAL_CAPTURE_SCOPE_MISMATCH',
      'PORTAL_CAPTURE_COLLECTOR_MISMATCH',
      'PORTAL_CAPTURE_CONTENT_CHANGED',
      'PORTAL_CAPTURE_CURRENT_REQUIRED',
      'PORTAL_CAPTURE_ASSET_CHANGED',
      'PORTAL_CAPTURE_ADMISSION_REQUIRED',
      'BROWSER_CONTENT_CHANGED',
      'CHROME_CONNECTION_REQUIRED',
      'FIGMA_TAB_NOT_FOUND',
      'CHROME_TARGET_AMBIGUOUS',
      'SCRIPTER_INSTALL_REQUIRED',
      'BROWSER_TARGET_CHANGED',
      'SCRIPTER_READ_TIMEOUT',
      'SNAPSHOT_READ_BUDGET',
      'CHROME_CDP_RECORD_INVALID',
      'CHROME_CDP_RECORD_CHANGED',
      'PORTAL_CHROME_DESIGN_NOT_READY',
      'PORTAL_CHROME_DESIGN_CHANGED',
      'STATE_PATH_UNSAFE',
      'STATE_ACL_INVALID',
      'STATE_ACL_INSECURE',
      'PORTAL_RECORD_TAMPERED',
      'PORTAL_RECORD_LIMIT',
      'PORTAL_RECORD_NOT_FOUND',
    ]),
    type: z.enum([
      'schema-error',
      'type-error',
      'range-error',
      'syntax-error',
      'timeout-error',
      'filesystem-error',
      'error',
      'non-error',
    ]),
    elapsedMs: z.number().int().min(0).max(3_600_000),
    schemaIssueCount: z.number().int().min(0).max(100_000).optional(),
    schemaPaths: z.array(z.string().max(256)).max(8).optional(),
  })
  .strict();
export type PortalCaptureFailure = z.infer<typeof PortalCaptureFailureSchema>;
export const PortalDesignEvidenceSchema = z
  .object({
    capture: PortalCaptureDescriptorSchema.optional(),
    storage: z.enum(['workspace', 'owner-state']).default('workspace'),
    assetManifestHash: PortalHashSchema.nullable().default(null),
    url: z.url(),
    fileKey: z.string(),
    nodeId: z.string().nullable(),
    artifactPath: PortalPathSchema.nullable(),
    artifactHash: PortalHashSchema.nullable(),
    liveVerified: z.boolean(),
    complete: z.boolean(),
    captureFailure: PortalCaptureFailureSchema.optional(),
  })
  .strict();
export const PortalPlanResultSchema = z
  .object({
    coreRecipes: PortalCorePlanBindingSchema.optional(),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    stack: z.enum(['auto', 'react-vite', 'vue-vite']),
    serviceSelection: z.array(PortalServiceSelectorSchema).max(32),
    analysisVersion: z.literal(2).optional(),
    selectedClosure: PortalServiceSelectionSchema.optional(),
    interactionContract: PortalInteractionContractSchema.optional(),
    workflowCoverage: PortalWorkflowCoverageSchema.optional(),
    planId: PortalIdSchema,
    requestedCase: PortalCaseSchema,
    strategy: PortalStrategySchema,
    implementationScope: PortalScopeSchema,
    targetPath: RelativeRootSchema,
    contextHash: PortalHashSchema,
    blueprintHash: PortalHashSchema,
    design: PortalDesignEvidenceSchema,
    requirements: z.array(PortalRequirementSchema).max(128),
    requiredLayers: z.array(PortalLayerSchema).max(10),
    services: z
      .array(
        z
          .object({
            workspaceId: PortalWorkspaceSchema,
            sourceId: PortalHashSchema.optional(),
            sourceIndex: z.number().int().min(0).max(8).optional(),
            role: z.enum(['target', 'reference']),
            rootPath: RelativeRootSchema,
            referenceRole: z.enum(['primary', 'supplemental']).nullable(),
            services: z
              .array(
                z
                  .object({
                    rootPath: RelativeRootSchema,
                    layers: z.array(PortalLayerSchema),
                    frameworks: z.array(z.string()),
                    languages: z.array(z.string()),
                    codePatterns: ProjectProfileSchema.optional(),
                  })
                  .strict(),
              )
              .max(128),
            incomplete: z.boolean(),
          })
          .strict(),
      )
      .max(9),
    issues: z.array(z.string()).max(512),
  })
  .strict();
export const PortalRunResultSchema = z
  .object({
    coreRecipes: PortalCorePlanBindingSchema.optional(),
    coreDeclarationCount: z.number().int().min(0).max(4096).optional(),
    coreDeclarationsHash: PortalHashSchema.optional(),
    recipes: PortalCoreEvidenceViewSchema.optional(),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    sourceAuthorityStatus: z.enum(['current', 'legacy-replan-required', 'historical-completed']),
    runId: PortalIdSchema,
    planId: PortalIdSchema,
    version: z.number().int().positive(),
    state: PortalStateSchema,
    generationAttempts: z.number().int().min(0).max(4),
    files: z
      .array(
        z
          .object({
            path: PortalPathSchema,
            action: z.enum(['create', 'replace']),
            contentHash: PortalHashSchema,
          })
          .strict(),
      )
      .max(300),
    candidateHash: PortalHashSchema.nullable(),
    appliedHash: PortalHashSchema.nullable(),
    validation: PortalAcceptanceSchema.nullable(),
    lastValidation: PortalAcceptanceSchema.nullable().default(null),
    issues: z.array(z.string()).max(512),
    lease: z
      .object({ epoch: z.number().int().positive(), expiresAt: z.number().int().positive() })
      .strict()
      .nullable(),
  })
  .strict();
export const PortalNextResultSchema = PortalRunResultSchema.omit({ lease: true })
  .extend({
    validationEvidence: z
      .object({
        sourceHash: PortalHashSchema,
        commands: z
          .array(
            z
              .object({
                commandId: z.string(),
                status: z.string(),
                exitCode: z.number().nullable(),
                output: z.string().max(65536),
                truncated: z.boolean(),
              })
              .strict(),
          )
          .max(4),
      })
      .strict()
      .nullable(),
    assets: z
      .object({
        totalAssets: z.number().int().nonnegative(),
        nextOffset: z.number().int().nonnegative().nullable(),
        inventory: z
          .array(
            z
              .object({
                id: z.number().int().nonnegative(),
                query: z
                  .object({
                    kind: z.enum(['png', 'svg', 'image']),
                    nodeId: z.string().optional(),
                    imageHash: z.string().optional(),
                  })
                  .strict(),
                status: z.enum(['captured', 'unavailable', 'pending']),
                path: PortalPathSchema.optional(),
                sha256: PortalHashSchema.optional(),
                bytes: z.number().int().nonnegative().optional(),
                reason: z.string().optional(),
              })
              .strict(),
          )
          .max(100),
        contents: z
          .array(
            z
              .object({
                id: z.number().int().nonnegative(),
                path: PortalPathSchema,
                hash: PortalHashSchema,
                data: z.string().max(6_990_508).optional(),
                delivery: z.enum(['base64', 'inline-image']).default('base64'),
              })
              .strict()
              .superRefine((value, ctx) => {
                if (value.delivery === 'base64' && value.data === undefined)
                  ctx.addIssue({ code: 'custom', message: 'Base64 delivery requires asset bytes' });
              }),
          )
          .max(8),
      })
      .strict()
      .nullable(),
    designEvidence: z
      .object({
        artifactHash: PortalHashSchema,
        totalNodes: z.number().int().nonnegative(),
        nextOffset: z.number().int().nonnegative().nullable(),
        nodes: z
          .array(
            z
              .object({
                id: z.string(),
                parentId: z.string().nullable(),
                childIds: z.array(z.string()),
                properties: z.record(z.string(), z.json()),
              })
              .strict(),
          )
          .max(100),
        tokens: z.array(z.json()).max(128),
        totalTokens: z.number().int().nonnegative(),
        nextTokenOffset: z.number().int().nonnegative().nullable(),
        collections: z.array(z.json()).max(128),
        totalCollections: z.number().int().nonnegative(),
        nextCollectionOffset: z.number().int().nonnegative().nullable(),
        styles: z
          .object({
            family: z.enum(['paints', 'texts', 'effects', 'grids']),
            availability: z.enum(['available', 'unavailable']),
            rows: z.array(z.json()).max(128),
            total: z.number().int().nonnegative(),
            nextOffset: z.number().int().nonnegative().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    lease: z
      .object({
        leaseId: z.string().uuid(),
        leaseEpoch: z.number().int().positive(),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    blueprint: PortalPlanResultSchema,
    instruction: z.string().max(4096),
    sourceInventory: z
      .array(
        z
          .object({
            sourceId: PortalHashSchema,
            sourceIndex: z.number().int().nonnegative(),
            workspaceId: PortalWorkspaceSchema,
            rootPath: RelativeRootSchema,
            role: z.enum(['target', 'reference']),
            files: PortalSourceInventorySchema.shape.files,
            totalFiles: z.number().int().nonnegative(),
            nextOffset: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(9),
    evidence: z
      .array(
        z
          .object({
            workspaceId: PortalWorkspaceSchema,
            sourceId: PortalHashSchema,
            sourceIndex: z.number().int().nonnegative(),
            rootPath: RelativeRootSchema,
            role: z.enum(['target', 'reference']),
            path: PortalPathSchema,
            sourceHash: PortalHashSchema,
            content: z.string().max(1_048_576),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export const PORTAL_RESULT_SCHEMAS = {
  portal_plan: PortalPlanResultSchema,
  portal_start: PortalRunResultSchema,
  portal_next: PortalNextResultSchema,
  portal_submit: PortalRunResultSchema,
  portal_apply: PortalRunResultSchema,
  portal_validate: PortalRunResultSchema,
  portal_status: PortalRunResultSchema,
  portal_resume: PortalRunResultSchema,
  portal_cancel: PortalRunResultSchema,
} as const;
