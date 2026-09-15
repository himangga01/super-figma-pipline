import { z } from 'zod';

import { PORTAL_CORE_RECIPE_IDS, PORTAL_CORE_RECIPE_LIMITS } from './portal-core-limits.js';
export { PORTAL_CORE_RECIPE_IDS, PORTAL_CORE_RECIPE_LIMITS } from './portal-core-limits.js';

import {
  isBoundedDesignJson,
  DesignBindingObservationSchema,
  DesignInteractionObservationSchema,
} from './design-observation.js';
import { PortalLayerSchema, PortalPathSchema } from './portal.js';

// These contracts describe evidence. Parsing never proves provenance or authorizes execution.
export const PORTAL_RECIPE_AUTHORITY_VERSION = 1 as const;
export const PORTAL_RECIPE_LIMITS = Object.freeze({
  definitions: 64,
  steps: 128,
  resultItems: 4096,
  evidence: 1024,
  declarations: 1024,
  recordBytes: 16 * 1024 * 1024,
  values: 200_000,
});
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().min(1).max(256);
const label = z.string().min(1).max(2048);
const path = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    value =>
      !value.includes('\\') &&
      !value.includes(':') &&
      ![...value].some(character => character.charCodeAt(0) < 32) &&
      value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
    'Expected a portable relative path',
  );
const unique = <T>(rows: readonly T[], key: (row: T) => string) =>
  new Set(rows.map(key)).size === rows.length;
const strings = (maximum: number) =>
  z
    .array(id)
    .max(maximum)
    .refine(rows => unique(rows, row => row), 'Duplicate ID');
const hashes = (maximum: number) =>
  z
    .array(hash)
    .min(1)
    .max(maximum)
    .refine(rows => unique(rows, row => row), 'Duplicate hash');
const bounded = <T extends z.ZodType>(schema: T) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (
        !isBoundedDesignJson(value, PORTAL_RECIPE_LIMITS.recordBytes, PORTAL_RECIPE_LIMITS.values)
      )
        ctx.addIssue({ code: 'custom', message: 'PORTAL_RECIPE_RECORD_LIMIT_OR_NON_JSON' });
    })
    .pipe(schema);

export const PORTAL_RECIPE_IDS = [
  'ground-design',
  'map-design',
  'plan-design-implementation',
  'audit-styles',
  'derive-tokens',
  'resolve-assets',
  'derive-interactions',
  'diagnose-connection',
  'resolve-target',
  'resolve-variable',
  'describe-tree',
  'describe-variants',
  'convert-paint',
  'replace-text',
  'rename-nodes',
  'transfer-instance-overrides',
  'plan-annotations',
  'convert-annotations',
  'assemble-frame',
  'clone-adjacent',
  'instantiate-component',
  'bind-variable',
  'set-variant',
  'author-tokens',
  'derive-palette',
  'author-palette',
  'derive-type-scale',
  'author-type-scale',
  'derive-variants',
  'author-variants',
  'remove-nodes',
  'export-handoff',
  'diff-design',
  'author-motion',
] as const;
export const PortalRecipeIdSchema = z.enum(PORTAL_RECIPE_IDS);
export const PortalRecipeFeatureIdSchema = z
  .string()
  .max(160)
  .regex(
    /^(rust\.(skill|prompt)|figwright\.(skill|reference)|figmosha\.(helper|cli))\.[A-Za-z0-9_.-]+$/u,
  );
export const PortalRecipeStrategySchema = z.enum([
  'blank-frontend',
  'reference-portal',
  'legacy-portal',
]);
export const PortalRecipeEffectSchema = z.enum([
  'read',
  'derive',
  'design-write',
  'library-import',
  'artifact-write',
]);

export const PortalRecipeEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capture'), captureHash: hash, itemId: id }).strict(),
  z
    .object({ kind: z.literal('source'), sourceId: id, inventoryHash: hash, path, fileHash: hash })
    .strict(),
  z
    .object({
      kind: z.literal('operation'),
      operationId: id,
      receiptHash: hash,
      resultHash: hash,
      targetHash: hash,
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact'),
      artifactId: id,
      hash,
      bytes: z.number().int().nonnegative().max(536_870_912),
    })
    .strict(),
]);
const evidence = z.array(PortalRecipeEvidenceSchema).min(1).max(PORTAL_RECIPE_LIMITS.evidence);
const qualifiedSource = z.object({ sourceId: id, inventoryHash: hash, graphHash: hash }).strict();
const definitionBinding = z
  .object({ recipeId: PortalRecipeIdSchema, definitionHash: hash })
  .strict();

export const PortalRecipeInputContextSchema = bounded(
  z
    .object({
      recipeAuthorityVersion: z.literal(1),
      ownerId: id,
      workspaceId: id,
      intentId: id,
      strategy: PortalRecipeStrategySchema,
      authorityHash: hash,
      captureHash: hash,
      assetManifestHash: hash,
      scopeHash: hash,
      sourceHashes: z
        .array(qualifiedSource)
        .max(9)
        .refine(rows => unique(rows, row => row.sourceId), 'Duplicate source ID'),
      capabilityVersions: z
        .array(z.object({ id, version: z.number().int().positive(), hash }).strict())
        .min(1)
        .max(64)
        .refine(rows => unique(rows, row => row.id), 'Duplicate capability ID'),
      selections: z
        .array(
          definitionBinding
            .extend({
              required: z.boolean(),
              applicability: z.enum(['applicable', 'not-applicable', 'unresolved']),
              evidence,
            })
            .strict(),
        )
        .min(1)
        .max(PORTAL_RECIPE_LIMITS.definitions)
        .refine(rows => unique(rows, row => row.recipeId), 'Duplicate recipe ID')
        .refine(
          rows => rows.every(row => !(row.required && row.applicability === 'not-applicable')),
          'Required recipe cannot be not applicable',
        ),
    })
    .strict(),
);

const capabilityName = z.enum([
  'tree',
  'variables',
  'collections',
  'paintStyles',
  'textStyles',
  'effectStyles',
  'gridStyles',
  'bindings',
  'componentApis',
  'interactions',
]);
const sourceProperty = z.enum([
  'fill',
  'stroke',
  'text',
  'effect',
  'grid',
  'spacing',
  'radius',
  'layout',
  'component',
]);
const color = z
  .object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1),
  })
  .strict();
export const PortalRecipeValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('COLOR'), value: color }).strict(),
  z.object({ type: z.literal('FLOAT'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('STRING'), value: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('BOOLEAN'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('ALIAS'), variableId: id, collectionId: id, modeId: id }).strict(),
]);
const token = z
  .object({
    id,
    name: label,
    collectionId: id,
    modeId: id,
    value: PortalRecipeValueSchema,
    sourceValueHash: hash,
    evidence,
  })
  .strict();
const tokenRows = z
  .array(token)
  .max(PORTAL_RECIPE_LIMITS.resultItems)
  .refine(
    rows => unique(rows, row => JSON.stringify([row.id, row.collectionId, row.modeId])),
    'Duplicate token/mode',
  );
const targets = z
  .array(
    z
      .object({
        id,
        fileKey: id,
        nodeId: id,
        name: label,
        sourceHash: hash,
      })
      .strict(),
  )
  .max(PORTAL_RECIPE_LIMITS.resultItems)
  .refine(rows => unique(rows, row => row.id), 'Duplicate target ID');
const decisions = z
  .array(
    z
      .object({
        id,
        requirementIds: strings(128),
        conclusion: label,
        rationale: label,
        evidence,
        disposition: z.enum(['required', 'recommended', 'not-applicable', 'unresolved']),
      })
      .strict(),
  )
  .max(512)
  .refine(rows => unique(rows, row => row.id), 'Duplicate decision ID');

export const PortalCoreMaterialSchema = z
  .object({
    hash,
    // Exact observed material is data, never an interpreted script or a substitute for a typed row.
    value: z
      .unknown()
      .refine(value => isBoundedDesignJson(value, 524_288, 50_000), 'CORE_MATERIAL_LIMIT')
      .pipe(z.json()),
  })
  .strict();
const coreId = z.string().min(1).max(4096);
const coreIssue = z.object({ code: coreId, itemId: coreId, blocking: z.boolean() }).strict();
const obligation = z
  .object({
    id: coreId,
    kind: z.enum([
      'implement-root',
      'construct-component',
      'construct-layer',
      'construct-token',
      'construct-icon',
      'reuse-review',
      'resolve-capability',
      'supply-asset',
      'implement-interaction',
      'resolve-source',
    ]),
    itemId: coreId,
    sourceId: coreId.optional(),
    reason: label,
  })
  .strict();
export const PortalCoreSourceContextSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['whole-root', 'qualified']),
    sourceId: hash,
    sourceIndex: z.number().int().min(0).max(8),
    members: z
      .array(
        z
          .object({ sourceId: hash, rootIdentityHash: hash, inventoryHash: hash, graphHash: hash })
          .strict(),
      )
      .min(1)
      .max(9),
    requestHash: hash,
    selectionHash: hash,
    reviewsHash: hash,
    contextHash: hash,
    selectedRoots: z.array(z.union([z.literal('.'), z.lazy(() => PortalPathSchema)])).max(128),
    closureRoots: z.array(z.union([z.literal('.'), z.lazy(() => PortalPathSchema)])).max(128),
    effectivePathsHash: hash,
    effectiveLayers: z.array(z.lazy(() => PortalLayerSchema)).max(10),
    complete: z.boolean(),
    issues: z.array(z.string().max(8192)).max(512),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !unique(value.members, row => row.sourceId) ||
      value.members[value.sourceIndex]?.sourceId !== value.sourceId ||
      !unique(value.selectedRoots, row => row) ||
      !unique(value.closureRoots, row => row) ||
      value.selectedRoots.some(root => !value.closureRoots.includes(root)) ||
      !unique(value.effectiveLayers, row => row) ||
      value.complete !== (value.issues.length === 0)
    )
      ctx.addIssue({ code: 'custom', message: 'CORE_SOURCE_CONTEXT_INVALID' });
  });
export type PortalCoreSourceContext = z.infer<typeof PortalCoreSourceContextSchema>;
const coreRow = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('source-context'),
      id: coreId,
      context: PortalCoreSourceContextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('scope'),
      id: coreId,
      nodeId: coreId,
      root: z.boolean(),
      nodeType: coreId,
      propertiesHash: hash,
      componentApi: PortalCoreMaterialSchema.nullable(),
      overrides: PortalCoreMaterialSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('variable'),
      id: coreId,
      variableId: coreId,
      collectionId: coreId,
      modeId: coreId,
      name: label,
      declaredType: coreId,
      status: z.enum(['observed', 'unsupported', 'conflict']),
      metadata: PortalCoreMaterialSchema,
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('collection'),
      id: coreId,
      collectionId: coreId,
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('token-export'),
      id: coreId,
      sourceKind: z.enum(['variable', 'paint-style']),
      sourceId: coreId,
      collectionId: coreId.nullable(),
      modeId: coreId.nullable(),
      cssValue: z.string().max(8192).nullable(),
      status: z.enum(['resolved', 'unresolved', 'unsupported']),
      materialHash: hash,
    })
    .strict(),
  z
    .object({
      kind: z.literal('style'),
      id: coreId,
      styleId: coreId,
      family: z.enum(['paintStyles', 'textStyles', 'effectStyles', 'gridStyles']),
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('binding'), id, observation: DesignBindingObservationSchema })
    .strict(),
  z
    .object({
      kind: z.literal('style-audit'),
      id: coreId,
      nodeId: coreId,
      property: coreId,
      status: z.enum(['bound', 'linked', 'raw', 'ambiguous', 'intentional-override', 'unresolved']),
      material: PortalCoreMaterialSchema,
      matchingStyleIds: strings(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mapping'),
      id: coreId,
      sourceId: coreId,
      mappingKind: z.enum(['component', 'token', 'icon']),
      mappingId: coreId,
      sourceInventoryHash: hash,
      sourceContextHash: hash,
      codeSourceHash: hash,
      status: coreId,
      overrideStatus: z.enum(['verified', 'legacy-unverified', 'stale', 'absent']),
      canonicalHash: hash,
      members: z
        .object({
          field: z.enum(['instances', 'nodeIds']),
          count: z.number().int().min(0).max(100000),
        })
        .strict()
        .nullable(),
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mapping-member'),
      id: coreId,
      mappingRowId: coreId,
      index: z.number().int().min(0).max(99999),
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('asset'),
      id: coreId,
      nodeId: coreId,
      property: coreId,
      query: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('image'), imageHash: id }).strict(),
        z.object({ kind: z.enum(['png', 'svg']), nodeId: id }).strict(),
      ]),
      status: z.enum(['verified-bytes', 'missing', 'unavailable', 'invalid']),
      exportedFrom: z.object({ nodeId: coreId, geometryHash: hash }).strict().nullable(),
      contentHash: hash.nullable(),
      bytes: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('interaction'),
      id: coreId,
      nodeId: coreId,
      observation: DesignInteractionObservationSchema,
      expectations: z
        .array(
          z
            .object({
              actionIndex: z.number().int().nonnegative(),
              action: coreId,
              destinationId: coreId.nullable(),
              status: z.enum(['required', 'unsupported', 'missing-destination']),
              temporal: z.boolean(),
            })
            .strict(),
        )
        .max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal('strategy'),
      id: coreId,
      sourceId: coreId.nullable(),
      sourceContextHash: hash.optional(),
      status: z.enum(['observed', 'construction', 'unresolved']),
      sourceHash: hash,
      material: PortalCoreMaterialSchema,
    })
    .strict(),
  z.object({ kind: z.literal('obligation'), id, obligation }).strict(),
  z.object({ kind: z.literal('issue'), id, issue: coreIssue }).strict(),
]);
const corePageShape = z
  .object({
    pageVersion: z.literal(1),
    recipeId: PortalRecipeIdSchema,
    index: z.number().int().min(0).max(4095),
    rows: z
      .array(coreRow)
      .min(1)
      .max(PORTAL_CORE_RECIPE_LIMITS.pageRows)
      .refine(rows => unique(rows, row => row.id), 'Duplicate core row ID'),
  })
  .strict();
export const PortalCoreRecipePageSchema = z
  .unknown()
  .refine(
    (value): boolean => isBoundedDesignJson(value, PORTAL_CORE_RECIPE_LIMITS.pageBytes, 100_000),
    'CORE_PAGE_INPUT_LIMIT',
  )
  .pipe(corePageShape);
export type PortalCoreRecipeRow = z.infer<typeof coreRow>;
export type PortalCoreRecipePage = z.infer<typeof PortalCoreRecipePageSchema>;
export const PortalCoreRecipeManifestSchema = z
  .object({
    schemaId: z.literal('sfp.recipe.core-manifest.v1'),
    contractHash: hash,
    recipeId: PortalRecipeIdSchema,
    derivationVersion: z.literal(1),
    inputHash: hash,
    observationHash: hash,
    status: z.enum(['ready', 'blocked']),
    applicability: z.enum(['applicable', 'proved-empty', 'unresolved']),
    pages: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            hash,
            rows: z.number().int().min(1).max(256),
            bytes: z.number().int().positive().max(PORTAL_CORE_RECIPE_LIMITS.pageBytes),
          })
          .strict(),
      )
      .max(PORTAL_CORE_RECIPE_LIMITS.pages),
    rowCount: z.number().int().min(0).max(1_048_576),
    obligationCount: z.number().int().min(0).max(1_048_576),
    issueCount: z.number().int().min(0).max(1_048_576),
    blockingIssueCount: z.number().int().min(0).max(1_048_576),
    capabilityEvidence: z
      .array(
        z
          .object({
            name: capabilityName,
            status: z.enum(['complete', 'empty', 'partial', 'unsupported', 'failed']),
            count: z.number().int().nonnegative().nullable(),
            retainedCount: z.number().int().nonnegative(),
            hash,
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.pages.some((page, index) => page.index !== index) ||
      value.pages.reduce((sum, page) => sum + page.rows, 0) !== value.rowCount
    )
      ctx.addIssue({ code: 'custom', message: 'CORE_PAGE_COUNTS_INVALID' });
    if (
      value.blockingIssueCount > value.issueCount ||
      (value.status === 'ready') !== (value.blockingIssueCount === 0) ||
      (value.applicability === 'proved-empty' &&
        (value.obligationCount !== 0 || value.rowCount !== value.issueCount)) ||
      (value.status === 'ready' &&
        value.capabilityEvidence.some(
          capability => !['complete', 'empty'].includes(capability.status),
        )) ||
      new Set(value.capabilityEvidence.map(capability => capability.name)).size !==
        value.capabilityEvidence.length
    )
      ctx.addIssue({ code: 'custom', message: 'CORE_STATUS_INVALID' });
  });

// Output families contain actual typed evidence items. There is no arbitrary payload escape hatch.
export const PORTAL_RECIPE_OUTPUT_SCHEMAS = {
  'sfp.recipe.core-manifest.v1': PortalCoreRecipeManifestSchema,
  'sfp.recipe.grounding.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.grounding.v1'),
      roots: z
        .array(
          z
            .object({
              nodeId: id,
              decision: z.enum(['included', 'excluded', 'unresolved']),
              reason: label,
              evidence,
            })
            .strict(),
        )
        .min(1)
        .max(4096)
        .refine(rows => unique(rows, row => row.nodeId), 'Duplicate root ID'),
      capabilities: z
        .array(
          z
            .object({
              name: capabilityName,
              status: z.enum(['complete', 'empty', 'partial', 'unsupported', 'failed']),
              evidenceHash: hash,
            })
            .strict(),
        )
        .min(1)
        .max(10)
        .refine(rows => unique(rows, row => row.name), 'Duplicate capability'),
    })
    .strict(),
  'sfp.recipe.mapping.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.mapping.v1'),
      mappings: z
        .array(
          z
            .object({
              id,
              sourceNodeId: id,
              sourceValueHash: hash,
              kind: z.enum(['component', 'token', 'icon']),
              disposition: z.enum(['matched', 'ambiguous', 'unmapped']),
              targets: z
                .array(z.object({ sourceId: id, path, fileHash: hash, symbol: id }).strict())
                .max(32),
              evidence,
            })
            .strict()
            .refine(
              row =>
                row.disposition === 'matched'
                  ? row.targets.length === 1
                  : row.disposition === 'unmapped'
                    ? row.targets.length === 0
                    : row.targets.length >= 2,
              'Mapping disposition/targets mismatch',
            ),
        )
        .max(4096)
        .refine(rows => unique(rows, row => row.id), 'Duplicate mapping ID'),
      catalogEvidenceHash: hash,
    })
    .strict(),
  'sfp.recipe.tokens.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.tokens.v1'),
      tokens: tokenRows,
      catalogEvidenceHash: hash,
    })
    .strict(),
  'sfp.recipe.style-audit.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.style-audit.v1'),
      catalogEvidenceHash: hash,
      findings: z
        .array(
          z
            .object({
              id,
              nodeId: id,
              property: sourceProperty,
              observedHash: hash,
              status: z.enum(['linked', 'raw', 'ambiguous', 'intentional-override', 'unsupported']),
              matchingIds: strings(32),
              evidence,
            })
            .strict(),
        )
        .max(4096)
        .refine(rows => unique(rows, row => row.id), 'Duplicate finding ID'),
    })
    .strict(),
  'sfp.recipe.strategy.v1': z
    .object({ schemaId: z.literal('sfp.recipe.strategy.v1'), decisions })
    .strict(),
  'sfp.recipe.interactions.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.interactions.v1'),
      coverageHash: hash,
      assertions: z
        .array(
          z
            .object({
              id,
              sourceNodeId: id,
              sourceInteractionId: id,
              trigger: id,
              action: id,
              requirementIds: strings(128),
              expectedHash: hash,
              disposition: z.enum(['required', 'unsupported', 'review-required']),
              evidence,
            })
            .strict(),
        )
        .max(4096)
        .refine(rows => unique(rows, row => row.id), 'Duplicate assertion ID'),
    })
    .strict(),
  'sfp.recipe.assets.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.assets.v1'),
      manifestHash: hash,
      assets: z
        .array(
          z
            .object({
              id,
              nodeId: id,
              hash,
              bytes: z.number().int().nonnegative().max(536_870_912),
              usage: z.enum(['image', 'icon', 'oracle', 'handoff', 'fidelity-fallback']),
              evidence,
            })
            .strict(),
        )
        .max(4096)
        .refine(rows => unique(rows, row => row.id), 'Duplicate asset ID'),
    })
    .strict(),
  'sfp.recipe.targets.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.targets.v1'),
      targets,
      resolution: z.enum(['resolved', 'empty', 'ambiguous']),
    })
    .strict()
    .refine(
      row =>
        row.resolution === 'empty'
          ? row.targets.length === 0
          : row.resolution === 'ambiguous'
            ? row.targets.length >= 2
            : row.targets.length >= 1,
      'Target resolution mismatch',
    ),
  'sfp.recipe.paint.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.paint.v1'),
      color,
      opacity: z.number().min(0).max(1),
    })
    .strict(),
  'sfp.recipe.authoring.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.authoring.v1'),
      targetHash: hash,
      readbackHash: hash,
      operations: z
        .array(
          z.object({ stepId: id, operationId: id, receiptHash: hash, resultHash: hash }).strict(),
        )
        .min(1)
        .max(128)
        .refine(
          rows => unique(rows, row => row.stepId) && unique(rows, row => row.operationId),
          'Duplicate authoring step/operation',
        ),
      targets,
    })
    .strict(),
  'sfp.recipe.diagnostics.v1': z
    .object({
      schemaId: z.literal('sfp.recipe.diagnostics.v1'),
      checks: z
        .array(
          z
            .object({
              id,
              status: z.enum(['pass', 'warn', 'fail']),
              code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
              evidenceHash: hash,
            })
            .strict(),
        )
        .min(1)
        .max(64)
        .refine(rows => unique(rows, row => row.id), 'Duplicate diagnostic ID'),
    })
    .strict(),
} as const;
export const PortalRecipeOutputSchema = z.discriminatedUnion('schemaId', [
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.core-manifest.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.grounding.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.mapping.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.tokens.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.style-audit.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.strategy.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.interactions.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.assets.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.targets.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.paint.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.authoring.v1'],
  PORTAL_RECIPE_OUTPUT_SCHEMAS['sfp.recipe.diagnostics.v1'],
]);
export type PortalRecipeOutputSchemaId = keyof typeof PORTAL_RECIPE_OUTPUT_SCHEMAS;
export const PortalRecipeOutputSchemaIdSchema = z.enum(
  Object.keys(PORTAL_RECIPE_OUTPUT_SCHEMAS) as [
    PortalRecipeOutputSchemaId,
    ...PortalRecipeOutputSchemaId[],
  ],
);

const resultIdentity = {
  recipeAuthorityVersion: z.literal(1),
  resultId: id,
  ownerId: id,
  workspaceId: id,
  contextHash: hash,
  recipeId: PortalRecipeIdSchema,
  definitionHash: hash,
  inputHash: hash,
  evidence,
};
export const PortalRecipeResultSchema = bounded(
  z.discriminatedUnion('status', [
    z
      .object({
        ...resultIdentity,
        status: z.literal('succeeded'),
        outputHash: hash,
        output: PortalRecipeOutputSchema,
      })
      .strict(),
    z
      .object({
        ...resultIdentity,
        status: z.enum(['failed', 'cancelled', 'blocked', 'outcome-unknown']),
        code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
      })
      .strict(),
  ]),
);

export const PortalRecipeRequiredResultSchema = definitionBinding
  .extend({ resultId: id, resultHash: hash })
  .strict();
export const PortalRecipeBlueprintBindingSchema = bounded(
  z
    .object({
      recipeAuthorityVersion: z.literal(1),
      contextHash: hash,
      requirementsHash: hash,
      requiredResults: z
        .array(PortalRecipeRequiredResultSchema)
        .min(1)
        .max(64)
        .refine(
          rows => unique(rows, row => row.recipeId) && unique(rows, row => row.resultId),
          'Duplicate recipe/result ID',
        ),
    })
    .strict(),
);
export const PortalRecipeCandidateDeclarationSchema = z
  .object({
    resultId: id,
    resultHash: hash,
    outputItemId: id,
    kind: z.enum(['scope', 'mapping', 'token', 'style', 'asset', 'interaction', 'strategy']),
    files: z
      .array(z.object({ path, hash }).strict())
      .max(300)
      .refine(rows => unique(rows, row => row.path.toLowerCase()), 'Duplicate file path'),
    assertionIds: strings(512),
  })
  .strict()
  .refine(
    row => row.files.length > 0 || row.assertionIds.length > 0,
    'Consumption must name a file or assertion',
  );
export const PortalRecipeCandidateDeclarationsSchema = bounded(
  z
    .array(PortalRecipeCandidateDeclarationSchema)
    .min(1)
    .max(PORTAL_RECIPE_LIMITS.declarations)
    .refine(
      rows => unique(rows, row => JSON.stringify([row.resultId, row.outputItemId, row.kind])),
      'Duplicate declaration',
    ),
);

const finding = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('runtime'),
      assertionId: id,
      observationId: id,
      rootNodeId: id,
      route: z.string().min(1).max(2048),
      stateId: id,
      viewport: z
        .object({
          width: z.number().int().min(1).max(16384),
          height: z.number().int().min(1).max(16384),
        })
        .strict(),
      expectedHash: hash,
      actualHash: hash,
      evidenceHash: hash,
    })
    .strict(),
  z
    .object({
      kind: z.literal('source'),
      sourceId: id,
      path,
      fileHash: hash,
      symbol: id,
      evidenceHash: hash,
    })
    .strict(),
  z
    .object({
      kind: z.literal('review'),
      decision: z.literal('accepted'),
      reviewerId: id,
      rationale: label,
      sourceHashes: hashes(64),
      evidenceHash: hash,
    })
    .strict(),
]);
export const PortalRecipeVerifiedConsumptionSchema = bounded(
  z
    .object({
      recipeAuthorityVersion: z.literal(1),
      ownerId: id,
      workspaceId: id,
      contextHash: hash,
      blueprintHash: hash,
      candidateHash: hash,
      target: z.enum(['candidate', 'applied']),
      verifierVersion: id,
      resultHashes: hashes(64),
      declarationsHash: hash,
      findings: z.array(finding).min(1).max(4096),
    })
    .strict(),
);

// Input descriptors reference admitted evidence, not caller-provided executable source.
export const PortalRecipeInputsSchema = z
  .object({
    scopeIds: strings(4096),
    evidence,
    options: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('mode'), collectionId: id, modeId: id }).strict(),
          z
            .object({
              kind: z.literal('target'),
              target: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('node'), fileKey: id, nodeId: id }).strict(),
                z
                  .object({
                    kind: z.literal('figma-url'),
                    url: z
                      .url({ protocol: /^https$/u, hostname: /^(www\.)?figma\.com$/u })
                      .max(4096)
                      .refine(
                        value =>
                          /^https:\/\/(www\.)?figma\.com\/(design|file)\/[A-Za-z0-9]+(?:[/?#]|$)/u.test(
                            value,
                          ),
                        'Expected a Figma design/file URL',
                      ),
                  })
                  .strict(),
                z.object({ kind: z.literal('page'), fileKey: id }).strict(),
                z
                  .object({
                    kind: z.literal('selection'),
                    fileKey: id,
                    index: z.number().int().min(0).max(4095),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal('exact-name'),
                    fileKey: id,
                    rootId: id,
                    name: label,
                    match: z.enum(['first', 'all', 'unique']),
                  })
                  .strict(),
              ]),
            })
            .strict(),
          z
            .object({
              kind: z.literal('variable'),
              variable: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('local'), id }).strict(),
                z.object({ kind: z.literal('library'), key: id, import: z.boolean() }).strict(),
              ]),
            })
            .strict(),
          z
            .object({
              kind: z.literal('palette'),
              primary: color,
              secondary: color.optional(),
              neutral: z.boolean(),
              dark: z.boolean(),
            })
            .strict(),
          z
            .object({
              kind: z.literal('type-scale'),
              fontFamily: label,
              base: z.number().min(1).max(512),
              ratio: z.enum(['minor-third', 'major-third', 'perfect-fourth', 'golden']),
              display: z.boolean(),
              codeFont: label.optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal('clone'),
              direction: z.enum(['left', 'right', 'up', 'down']),
              gap: z.number().min(-100000).max(100000),
              name: label.optional(),
            })
            .strict(),
        ]),
      )
      .max(64),
  })
  .strict();

const toolNames = [
  'get_node',
  'get_selection',
  'get_design_context',
  'get_variable_defs',
  'get_styles',
  'get_component_api',
  'get_reactions',
  'get_annotations',
  'doctor',
  'ping',
  'create_frame',
  'resize_nodes',
  'reparent_nodes',
  'set_auto_layout',
  'set_layout_props',
  'set_fills',
  'set_strokes',
  'set_corner_radius',
  'set_position',
  'clone_node',
  'rename_node',
  'create_instance',
  'set_instance_properties',
  'set_text',
  'set_text_range',
  'set_text_properties',
  'batch_rename_nodes',
  'swap_component',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'bind_variable_to_node',
  'bind_variable_to_paint',
  'import_library_variable',
  'create_paint_style',
  'create_text_style',
  'apply_style_to_node',
  'delete_nodes',
  'export_tokens',
  'export_frames_to_pdf',
  'design_diff',
  'get_screenshot',
  'apply_animation_style',
  'apply_manual_keyframe_track',
  'set_timeline_duration',
] as const;
const referenceTypes = ['node-id', 'variable-id', 'collection-id', 'mode-id', 'style-id'] as const;
const referenceFields = [
  'nodeId',
  'variableId',
  'collectionId',
  'modeId',
  'defaultModeId',
  'styleId',
  'id',
] as const;
const reference = z
  .object({ stepId: id, field: z.enum(referenceFields), type: z.enum(referenceTypes) })
  .strict();
const toolOutputs: Partial<
  Record<
    (typeof toolNames)[number],
    Partial<Record<(typeof referenceFields)[number], (typeof referenceTypes)[number]>>
  >
> = {
  create_frame: { nodeId: 'node-id' },
  clone_node: { nodeId: 'node-id' },
  create_instance: { nodeId: 'node-id' },
  create_variable: { variableId: 'variable-id' },
  import_library_variable: { id: 'variable-id', collectionId: 'collection-id' },
  create_variable_collection: { collectionId: 'collection-id', defaultModeId: 'mode-id' },
  add_variable_mode: { modeId: 'mode-id' },
  create_paint_style: { styleId: 'style-id' },
  create_text_style: { styleId: 'style-id' },
};
const readTools = new Set<string>([
  'get_node',
  'get_selection',
  'get_design_context',
  'get_variable_defs',
  'get_styles',
  'get_component_api',
  'get_reactions',
  'get_annotations',
  'doctor',
  'ping',
  'get_screenshot',
]);
const artifactTools = new Set<string>(['export_tokens', 'export_frames_to_pdf', 'design_diff']);
/**
 * Unconstrained step skeletons must declare every possible canonical effect. This shared projection
 * is verified against the actual server operation policies; it is not an admission replacement.
 */
export const PORTAL_RECIPE_TOOL_EFFECTS: Readonly<
  Record<(typeof toolNames)[number], readonly z.infer<typeof PortalRecipeEffectSchema>[]>
> = Object.freeze(
  Object.fromEntries(
    toolNames.map(name => {
      const effects: z.infer<typeof PortalRecipeEffectSchema>[] =
        name === 'import_library_variable'
          ? ['library-import']
          : name === 'create_instance' || name === 'swap_component'
            ? ['design-write', 'library-import']
            : artifactTools.has(name)
              ? ['read', 'artifact-write']
              : readTools.has(name)
                ? ['read']
                : ['design-write'];
      return [name, Object.freeze(effects)];
    }),
  ) as Record<(typeof toolNames)[number], readonly z.infer<typeof PortalRecipeEffectSchema>[]>,
);
export const PortalRecipeStepSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id,
      kind: z.literal('derive'),
      algorithm: PortalRecipeIdSchema,
      refs: z.array(reference).max(32),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal('tool'),
      tool: z.enum(toolNames),
      refs: z.array(reference).max(32),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal('readback'),
      tool: z.enum([
        'get_node',
        'get_design_context',
        'get_variable_defs',
        'get_styles',
        'get_component_api',
        'get_annotations',
      ]),
      refs: z.array(reference).max(32),
    })
    .strict(),
]);

export const PortalRecipeDefinitionSchema = bounded(
  z
    .object({
      recipeId: PortalRecipeIdSchema,
      version: z.number().int().positive().max(65535),
      featureIds: z
        .array(PortalRecipeFeatureIdSchema)
        .min(1)
        .max(128)
        .refine(rows => unique(rows, row => row), 'Duplicate feature ID'),
      execution: z.enum(['planned', 'implemented']),
      implementationHash: hash.optional(),
      behaviorVersion: id,
      inputSchemaId: z.literal('sfp.recipe.inputs.v1'),
      outputSchemaId: PortalRecipeOutputSchemaIdSchema,
      verifierVersion: id,
      triggers: z
        .array(
          z.enum([
            'portal-plan',
            'source-patterns',
            'source-interactions',
            'connection-failure',
            'explicit-read',
            'explicit-authoring',
            'explicit-export',
          ]),
        )
        .min(1)
        .max(7)
        .refine(rows => unique(rows, row => row), 'Duplicate trigger'),
      strategies: z
        .array(PortalRecipeStrategySchema)
        .min(1)
        .max(3)
        .refine(rows => unique(rows, row => row), 'Duplicate strategy'),
      effects: z
        .array(PortalRecipeEffectSchema)
        .min(1)
        .max(5)
        .refine(rows => unique(rows, row => row), 'Duplicate effect'),
      prerequisites: strings(64),
      steps: z.array(PortalRecipeStepSchema).min(1).max(PORTAL_RECIPE_LIMITS.steps),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        value.execution === 'implemented'
          ? !PORTAL_CORE_RECIPE_IDS.some(recipeId => recipeId === value.recipeId) ||
            !value.implementationHash ||
            value.outputSchemaId !== 'sfp.recipe.core-manifest.v1' ||
            value.effects.length !== 1 ||
            value.effects[0] !== 'derive' ||
            value.steps.length !== 1 ||
            value.steps[0]?.kind !== 'derive' ||
            value.steps[0].algorithm !== value.recipeId
          : value.implementationHash !== undefined
      )
        ctx.addIssue({ code: 'custom', message: 'PORTAL_RECIPE_IMPLEMENTATION_INVALID' });
      const prior = new Map<string, z.infer<typeof PortalRecipeStepSchema>>();
      for (const step of value.steps) {
        if (prior.has(step.id))
          ctx.addIssue({ code: 'custom', message: `Duplicate step ID: ${step.id}` });
        if (!unique(step.refs, ref => JSON.stringify([ref.stepId, ref.field])))
          ctx.addIssue({ code: 'custom', message: 'Duplicate step reference' });
        for (const ref of step.refs) {
          const producer = prior.get(ref.stepId);
          if (
            !producer ||
            producer.kind !== 'tool' ||
            toolOutputs[producer.tool]?.[ref.field] !== ref.type
          )
            ctx.addIssue({
              code: 'custom',
              message: 'Unsupported, forward or incompatible result reference',
            });
        }
        const needed: readonly z.infer<typeof PortalRecipeEffectSchema>[] =
          step.kind === 'derive' ? ['derive'] : PORTAL_RECIPE_TOOL_EFFECTS[step.tool];
        for (const effect of needed)
          if (!value.effects.includes(effect))
            ctx.addIssue({ code: 'custom', message: `Undeclared ${effect} effect` });
        prior.set(step.id, step);
      }
    }),
);

export type PortalRecipeDefinition = z.infer<typeof PortalRecipeDefinitionSchema>;
export type PortalRecipeInputContext = z.infer<typeof PortalRecipeInputContextSchema>;
export type PortalRecipeResult = z.infer<typeof PortalRecipeResultSchema>;
export type PortalRecipeBlueprintBinding = z.infer<typeof PortalRecipeBlueprintBindingSchema>;
export type PortalRecipeCandidateDeclaration = z.infer<
  typeof PortalRecipeCandidateDeclarationSchema
>;
export type PortalRecipeVerifiedConsumption = z.infer<typeof PortalRecipeVerifiedConsumptionSchema>;

const authorityError = (code: string) => Object.assign(new Error(code), { code });
/** Legacy inspection reports absence; it never synthesizes a current marker or successful result. */
export function readPortalRecipeAuthority(record: {
  recipeAuthorityVersion?: unknown;
  [key: string]: unknown;
}): 'legacy' | 'current' {
  const version = record.recipeAuthorityVersion;
  if (version === undefined || version === 0) return 'legacy';
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
    throw authorityError('PORTAL_RECIPE_AUTHORITY_INVALID');
  if (version !== PORTAL_RECIPE_AUTHORITY_VERSION)
    throw authorityError('PORTAL_RECIPE_AUTHORITY_UNSUPPORTED');
  return 'current';
}
/** Marker fence only: callers must additionally verify signed ownership, evidence and result hashes. */
export function assertCurrentPortalRecipeAuthority(record: {
  recipeAuthorityVersion?: unknown;
  [key: string]: unknown;
}): void {
  if (readPortalRecipeAuthority(record) !== 'current')
    throw authorityError('PORTAL_RECIPE_AUTHORITY_REQUIRED');
}
