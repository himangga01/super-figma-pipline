import { createHash } from 'node:crypto';

import { canonicalJson, contentHash } from '@sfp/ir';
import {
  PORTAL_CORE_RECIPE_LIMITS,
  PortalCoreRecipePageSchema,
  PortalCoreRecipeManifestSchema,
  SerializedPaintStyleSchema,
  SerializedVariableSchema,
  type DesignJson,
  type DesignObservation,
  type DesignCapabilityName,
  type PortalCoreRecipeRow,
  type PortalCoreRecipePage,
  type PortalRecipeDefinition,
} from '@sfp/shared';
import { z } from 'zod';

import { observationVariableDefs } from '../../mapping/design-mapping.js';
import { resolveFigmaTokens, resolvePaintStyleTokens } from '../../tokens/figma-tokens.js';
import { PortalCapturedAssetSchema } from '../design-capture.js';
import { planDesignImageReferences, normalizePortalDesign } from '../design-normalization.js';
import { analyzePortalWorkflows } from '../workflow-requirements.js';
import {
  coreHash,
  freezeCore,
  readCoreRecipeSource,
  verifyCoreObservation,
  assertCoreTokenWork,
  type PreparedCoreRecipeSource,
} from './core-source.js';

type RecipeId = PortalRecipeDefinition['recipeId'];
type Manifest = z.infer<typeof PortalCoreRecipeManifestSchema>;
type Asset = z.infer<typeof PortalCapturedAssetSchema>;
type Row = PortalCoreRecipeRow;
export const CORE_RECIPE_CONTRACT_HASH = contentHash('sfp-core-recipe-contract-v1', {
  // Existing binding/interaction schemas retain bounded observed JSON through custom codecs.
  page: PortalCoreRecipePageSchema.toJSONSchema({ unrepresentable: 'any' }),
  observedJsonCodec: 'bounded-design-json-v1',
  manifest: PortalCoreRecipeManifestSchema.toJSONSchema(),
  limits: PORTAL_CORE_RECIPE_LIMITS,
  algorithmVersion: 'core-derivation-qualified-source-v2',
});
const coreIds = [
  'ground-design',
  'map-design',
  'derive-tokens',
  'audit-styles',
  'resolve-assets',
  'derive-interactions',
  'plan-design-implementation',
] as const;
const requiredCapabilities: Record<(typeof coreIds)[number], readonly DesignCapabilityName[]> = {
  'ground-design': ['tree', 'componentApis'],
  'map-design': ['tree', 'variables', 'collections', 'paintStyles', 'bindings', 'componentApis'],
  'derive-tokens': ['variables', 'collections', 'paintStyles', 'bindings'],
  'audit-styles': ['tree', 'paintStyles', 'textStyles', 'effectStyles', 'gridStyles', 'bindings'],
  'resolve-assets': ['tree'],
  'derive-interactions': ['tree', 'interactions'],
  'plan-design-implementation': ['tree'],
};
const object = (value: unknown): value is Record<string, DesignJson> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback = 'unknown') =>
  typeof value === 'string' && value.length ? value : fallback;
const material = (value: DesignJson) => ({ hash: coreHash(value), value });
const key = (...values: unknown[]) => coreHash(values);
const good = (status: string) => status === 'complete' || status === 'empty';
const checksum = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const jsonBytes = (value: unknown) => Buffer.byteLength(canonicalJson(value));
const assetKey = (query: Asset['query']) =>
  canonicalJson(
    query.kind === 'image' ? { ...query, imageHash: query.imageHash.toLowerCase() } : query,
  );

export interface CoreRecipeBundle {
  version: 1;
  contractHash: `sha256:${string}`;
  inputHash: `sha256:${string}`;
  observationHash: `sha256:${string}`;
  sources: Array<{
    sourceId: string;
    sourceHash: string;
    rootIdentityHash: string;
    inventoryHash: string;
    graphHash: string;
    codeSourceHash: string | null;
    sourceContextHash: string;
    selectionHash: string;
    reviewsHash: string;
    effectivePathsHash: string;
  }>;
  results: Array<{
    recipeId: RecipeId;
    required: true;
    output: Manifest;
    outputHash: `sha256:${string}`;
  }>;
  pages: Array<{ hash: `sha256:${string}`; page: PortalCoreRecipePage }>;
}
class Rows {
  readonly values: Row[] = [];
  constructor(
    readonly recipeId: RecipeId,
    private readonly budget: { bytes: number },
  ) {}
  add(row: Row) {
    if ((this.budget.bytes += jsonBytes(row)) > PORTAL_CORE_RECIPE_LIMITS.bundleBytes)
      throw new Error('CORE_BUNDLE_LIMIT');
    this.values.push(row);
  }
  issue(code: string, itemId: string, blocking = true) {
    this.add({ kind: 'issue', id: key('issue', code, itemId), issue: { code, itemId, blocking } });
  }
  obligation(
    kind: Extract<Row, { kind: 'obligation' }>['obligation']['kind'],
    itemId: string,
    reason: string,
    sourceId?: string,
  ) {
    const id = key('obligation', kind, itemId, sourceId ?? null);
    this.add({
      kind: 'obligation',
      id,
      obligation: { id, kind, itemId, reason, ...(sourceId === undefined ? {} : { sourceId }) },
    });
  }
}
function finalize(
  rows: Rows,
  inputHash: `sha256:${string}`,
  observationHash: `sha256:${string}`,
  observation: DesignObservation,
  applicability: Manifest['applicability'],
): { output: Manifest; pages: CoreRecipeBundle['pages'] } {
  const values = [...new Map(rows.values.map(row => [row.id, row])).values()].toSorted((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (values.length !== rows.values.length) throw new Error('CORE_DUPLICATE_ROW');
  const pages: CoreRecipeBundle['pages'] = [];
  let pending: Row[] = [],
    pendingBytes = 0;
  const publish = () => {
    if (!pending.length) return;
    const page = PortalCoreRecipePageSchema.parse({
      pageVersion: 1,
      recipeId: rows.recipeId,
      index: pages.length,
      rows: pending,
    });
    if (jsonBytes(page) > PORTAL_CORE_RECIPE_LIMITS.pageBytes)
      throw new Error('CORE_PAGE_BYTE_LIMIT');
    pages.push({ hash: coreHash(page), page });
    pending = [];
    pendingBytes = 0;
  };
  for (const row of values) {
    const size = jsonBytes(row),
      header = jsonBytes({
        pageVersion: 1,
        recipeId: rows.recipeId,
        index: pages.length,
        rows: [],
      });
    if (header + size > PORTAL_CORE_RECIPE_LIMITS.pageBytes)
      throw new Error('CORE_ITEM_BYTE_LIMIT');
    if (
      pending.length &&
      (pending.length === PORTAL_CORE_RECIPE_LIMITS.pageRows ||
        header + pendingBytes + size + 1 > PORTAL_CORE_RECIPE_LIMITS.pageBytes)
    )
      publish();
    pendingBytes += size + (pending.length ? 1 : 0);
    pending.push(row);
  }
  publish();
  const issueRows = values.filter(row => row.kind === 'issue');
  const blockingIssueCount = issueRows.filter(row => row.issue.blocking).length;
  const output = PortalCoreRecipeManifestSchema.parse({
    schemaId: 'sfp.recipe.core-manifest.v1',
    contractHash: CORE_RECIPE_CONTRACT_HASH,
    recipeId: rows.recipeId,
    derivationVersion: 1,
    inputHash,
    observationHash,
    status: blockingIssueCount ? 'blocked' : 'ready',
    applicability: blockingIssueCount ? 'unresolved' : applicability,
    pages: pages.map(({ hash, page }) => ({
      index: page.index,
      hash,
      rows: page.rows.length,
      bytes: jsonBytes(page),
    })),
    rowCount: values.length,
    obligationCount: values.filter(row => row.kind === 'obligation').length,
    issueCount: issueRows.length,
    blockingIssueCount,
    capabilityEvidence: observation.capabilities
      .filter(capability =>
        requiredCapabilities[rows.recipeId as (typeof coreIds)[number]].includes(capability.name),
      )
      .map(capability => ({
        name: capability.name,
        status: capability.status,
        count: capability.count,
        retainedCount: capability.retainedCount,
        hash: coreHash(capability),
      })),
  });
  return { output, pages };
}

function deriveScope(rows: Rows, observation: DesignObservation, roots: ReadonlySet<string>) {
  const existing = new Set(observation.nodes.map(node => node.id));
  for (const root of roots) {
    rows.obligation(
      'implement-root',
      root,
      'Implement every captured scoped root, including primitive export obligations.',
    );
    if (!existing.has(root)) rows.issue('CORE_REQUIRED_ROOT_MISSING', root);
  }
  for (const node of observation.nodes) {
    const properties = node.properties;
    const api = Object.fromEntries(
      ['componentApi', 'componentPropertyDefinitions', 'componentProperties']
        .filter(field => properties[field] !== undefined)
        .map(field => [field, properties[field]!]),
    ) as Record<string, DesignJson>;
    const overrides = Object.fromEntries(
      ['propertyOverrides', 'textOverrides', 'overrides']
        .filter(field => properties[field] !== undefined)
        .map(field => [field, properties[field]!]),
    ) as Record<string, DesignJson>;
    rows.add({
      kind: 'scope',
      id: key('node', node.id),
      nodeId: node.id,
      root: roots.has(node.id),
      nodeType: text(properties.type),
      propertiesHash: coreHash(properties),
      componentApi: Object.keys(api).length ? material(api) : null,
      overrides: Object.keys(overrides).length ? material(overrides) : null,
    });
  }
}
function deriveTokens(rows: Rows, observation: DesignObservation) {
  for (const collection of observation.catalogs.collections)
    rows.add({
      kind: 'collection',
      id: key('collection', collection.id),
      collectionId: collection.id,
      material: material(collection.raw),
    });
  let resolved: ReturnType<typeof resolveFigmaTokens> = [];
  let canResolve = true;
  try {
    assertCoreTokenWork(observation);
  } catch {
    rows.issue('CORE_TOKEN_MATRIX_LIMIT', 'variables');
    canResolve = false;
  }
  if (canResolve)
    try {
      resolved = resolveFigmaTokens(observationVariableDefs(observation));
    } catch {
      rows.issue('CORE_TOKEN_PROJECTION_UNSUPPORTED', 'variables');
      const supported = observation.catalogs.variables.filter(
        variable =>
          SerializedVariableSchema.safeParse({
            ...variable.raw,
            id: variable.id,
            key: variable.raw.key ?? '',
            collectionId: variable.collectionId,
            valuesByMode: Object.fromEntries(
              Object.entries(variable.valuesByMode).map(([mode, value]) => [
                mode,
                object(value) && 'r' in value ? { ...value, a: value.a ?? 1 } : value,
              ]),
            ),
          }).success,
      );
      try {
        resolved = resolveFigmaTokens(
          observationVariableDefs({
            ...observation,
            catalogs: { ...observation.catalogs, variables: supported },
          }),
        );
      } catch {
        /* The complete raw catalogs remain in rows/input evidence; no empty success is inferred. */
      }
    }
  const byId = new Map(resolved.map(token => [token.sourceId, token]));
  const invalidCatalog = observation.issues.some(issue =>
    ['variables', 'collections'].some(
      scope => issue.scope === scope || issue.scope.startsWith(`${scope}/`),
    ),
  );
  for (const variable of observation.catalogs.variables) {
    const declaredType = text(variable.raw.resolvedType ?? variable.raw.type);
    const supported = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN', 'TIMING', 'EASING'].includes(
      declaredType,
    );
    if (!supported) rows.issue('CORE_VARIABLE_TYPE_UNSUPPORTED', variable.id);
    const entries = Object.entries(variable.valuesByMode);
    if (!entries.length) rows.issue('CORE_VARIABLE_MODES_MISSING', variable.id);
    for (const [modeId, value] of entries) {
      rows.add({
        kind: 'variable',
        id: key('variable', variable.id, modeId),
        variableId: variable.id,
        collectionId: variable.collectionId,
        modeId,
        name: text(variable.raw.name, variable.id),
        declaredType,
        status: invalidCatalog ? 'conflict' : supported ? 'observed' : 'unsupported',
        metadata: material(
          Object.fromEntries(
            Object.entries(variable.raw).filter(([field]) => field !== 'valuesByMode'),
          ),
        ),
        material: material(value),
      });
      const actual = invalidCatalog ? null : (byId.get(variable.id)?.modeValues?.[modeId] ?? null);
      const cssValue =
        actual === null || ['TIMING', 'EASING'].includes(declaredType)
          ? null
          : declaredType === 'STRING'
            ? JSON.stringify(actual)
            : String(actual);
      rows.add({
        kind: 'token-export',
        id: key('token-export', variable.id, modeId),
        sourceKind: 'variable',
        sourceId: variable.id,
        collectionId: variable.collectionId,
        modeId,
        cssValue,
        status: cssValue !== null ? 'resolved' : actual === null ? 'unresolved' : 'unsupported',
        materialHash: coreHash(value),
      });
      if (actual === null) rows.issue('CORE_TOKEN_MODE_UNRESOLVED', `${variable.id}/${modeId}`);
    }
  }
  for (const family of ['paintStyles', 'textStyles', 'effectStyles', 'gridStyles'] as const)
    for (const [index, style] of observation.catalogs[family].entries()) {
      const styleId = text(style.id, `retained-${index}`);
      rows.add({
        kind: 'style',
        id: key('style', family, styleId),
        styleId,
        family,
        material: material(style),
      });
      if (family === 'paintStyles') {
        const parsed = SerializedPaintStyleSchema.safeParse({
          ...style,
          key: style.key ?? '',
          description: style.description ?? '',
        });
        const token = parsed.success ? resolvePaintStyleTokens([parsed.data])[0] : undefined;
        const bound =
          Array.isArray(style.paints) &&
          style.paints.some(
            paint =>
              object(paint) &&
              ((object(paint.boundVariables) && Object.keys(paint.boundVariables).length > 0) ||
                (Array.isArray(paint.gradientStops) &&
                  paint.gradientStops.some(
                    stop =>
                      object(stop) &&
                      object(stop.boundVariables) &&
                      Object.keys(stop.boundVariables).length > 0,
                  ))),
          );
        rows.add({
          kind: 'token-export',
          id: key('style-export', styleId),
          sourceKind: 'paint-style',
          sourceId: styleId,
          collectionId: null,
          modeId: null,
          cssValue:
            bound || token?.value === undefined || token.value === null
              ? null
              : String(token.value),
          status: bound
            ? 'unresolved'
            : token?.value === undefined || token.value === null
              ? 'unsupported'
              : 'resolved',
          materialHash: coreHash(style),
        });
      }
    }
  for (const binding of observation.bindings) {
    rows.add({
      kind: 'binding',
      id: key('binding', binding.nodeId, binding.property, binding.variableId),
      observation: binding,
    });
    if (binding.status !== 'resolved')
      rows.issue(
        `CORE_BINDING_${binding.reason ?? 'UNRESOLVED'}`,
        `${binding.nodeId}:${binding.property}`,
      );
  }
}

function paintSignature(value: DesignJson): string {
  if (!Array.isArray(value)) return canonicalJson(value);
  return canonicalJson(
    value.map(paint => {
      if (!object(paint)) return paint;
      const color =
        object(paint.color) && 'r' in paint.color
          ? { ...paint.color, a: paint.color.a ?? 1 }
          : paint.color;
      return {
        ...paint,
        visible: paint.visible ?? true,
        opacity: paint.opacity ?? 1,
        blendMode: paint.blendMode ?? 'NORMAL',
        ...(color === undefined ? {} : { color }),
      };
    }),
  );
}
function deriveStyleAudit(rows: Rows, observation: DesignObservation) {
  const fields = [
    ['fills', 'paintStyles', 'paints', 'fillStyleId'],
    ['strokes', 'paintStyles', 'paints', 'strokeStyleId'],
    ['effects', 'effectStyles', 'effects', 'effectStyleId'],
    ['layoutGrids', 'gridStyles', 'layoutGrids', 'gridStyleId'],
  ] as const;
  const paintIndexes = new Map<string, Map<string, string[]>>();
  const styleIds = new Map<string, Set<string>>();
  for (const family of ['paintStyles', 'textStyles', 'effectStyles', 'gridStyles'] as const)
    styleIds.set(family, new Set(observation.catalogs[family].map(style => text(style.id))));
  for (const [, family, styleField] of fields) {
    if (paintIndexes.has(family)) continue;
    const index = new Map<string, string[]>();
    for (const style of observation.catalogs[family])
      if (style[styleField] !== undefined) {
        const signature = paintSignature(style[styleField]!),
          ids = index.get(signature) ?? [];
        ids.push(text(style.id));
        index.set(signature, ids);
      }
    paintIndexes.set(family, index);
  }
  const bindingsByNode = new Map<string, DesignObservation['bindings']>();
  for (const binding of observation.bindings) {
    const found = bindingsByNode.get(binding.nodeId) ?? [];
    found.push(binding);
    bindingsByNode.set(binding.nodeId, found);
  }
  const textIndexes = new Map<string, Map<string, string[]>>();
  let inspectedBindings = 0;
  for (const node of observation.nodes) {
    const overrideFields = new Set<string>();
    if (Array.isArray(node.properties.overrides))
      for (const override of node.properties.overrides)
        if (object(override) && override.id === node.id && Array.isArray(override.overriddenFields))
          for (const field of override.overriddenFields)
            if (typeof field === 'string') overrideFields.add(field);
    const scan = (properties: Record<string, DesignJson>, prefix: string) => {
      for (const [field, family, _styleField, linkField] of fields) {
        const value = properties[field];
        const property = `${prefix}/${field}`;
        if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
        if (!Array.isArray(value)) {
          rows.add({
            kind: 'style-audit',
            id: key('audit', node.id, property),
            nodeId: node.id,
            property,
            status: 'unresolved',
            material: material(value),
            matchingStyleIds: [],
          });
          rows.issue('CORE_STYLE_MATERIAL_UNSUPPORTED', `${node.id}:${property}`);
          continue;
        }
        const nodeBindings = bindingsByNode.get(node.id) ?? [];
        if (
          (inspectedBindings += nodeBindings.length) >
          PORTAL_CORE_RECIPE_LIMITS.auditBindingComparisons
        )
          throw new Error('CORE_AUDIT_WORK_LIMIT');
        const bindings = nodeBindings.filter(
          binding => binding.property === property || binding.property.startsWith(`${property}/`),
        );
        const linked = typeof properties[linkField] === 'string' ? properties[linkField] : null;
        const matchingStyleIds = paintIndexes.get(family)!.get(paintSignature(value)) ?? [];
        const explicitOverride = overrideFields.has(field);
        const status = bindings.length
          ? bindings.every(binding => binding.status === 'resolved')
            ? 'bound'
            : 'unresolved'
          : linked
            ? styleIds.get(family)!.has(linked)
              ? 'linked'
              : 'unresolved'
            : explicitOverride
              ? 'intentional-override'
              : matchingStyleIds.length > 1
                ? 'ambiguous'
                : 'raw';
        rows.add({
          kind: 'style-audit',
          id: key('audit', node.id, property),
          nodeId: node.id,
          property,
          status,
          material: material(value),
          matchingStyleIds,
        });
        if (status === 'unresolved')
          rows.issue('CORE_STYLE_BINDING_UNRESOLVED', `${node.id}:${property}`);
      }
      if (properties.fontSize !== undefined || properties.fontName !== undefined) {
        const linked = typeof properties.textStyleId === 'string' ? properties.textStyleId : null;
        const tuple = Object.fromEntries(
          ['fontName', 'fontSize', 'lineHeight', 'letterSpacing']
            .filter(field => properties[field] !== undefined)
            .map(field => [field, properties[field]!]),
        ) as Record<string, DesignJson>;
        const selectedFields = Object.keys(tuple),
          indexKey = canonicalJson(selectedFields);
        let index = textIndexes.get(indexKey);
        if (!index) {
          index = new Map<string, string[]>();
          for (const style of observation.catalogs.textStyles) {
            const signature = canonicalJson(
                Object.fromEntries(selectedFields.map(field => [field, style[field] ?? null])),
              ),
              ids = index.get(signature) ?? [];
            ids.push(text(style.id));
            index.set(signature, ids);
          }
          textIndexes.set(indexKey, index);
        }
        const matches = index.get(canonicalJson(tuple)) ?? [];
        const status = linked
          ? styleIds.get('textStyles')!.has(linked)
            ? 'linked'
            : 'unresolved'
          : matches.length > 1
            ? 'ambiguous'
            : 'raw';
        rows.add({
          kind: 'style-audit',
          id: key('audit', node.id, prefix, 'typography'),
          nodeId: node.id,
          property: `${prefix}/typography`,
          status,
          material: material(tuple),
          matchingStyleIds: matches,
        });
        if (status === 'unresolved')
          rows.issue('CORE_TEXT_STYLE_UNRESOLVED', `${node.id}:${prefix}`);
      }
    };
    scan(node.properties, '');
    for (const field of ['segments', 'textSegments'])
      if (Array.isArray(node.properties[field]))
        for (const [index, segment] of node.properties[field].entries())
          if (object(segment)) scan(segment, `/${field}/${index}`);
  }
}

function deriveInteractions(rows: Rows, observation: DesignObservation) {
  const nodeIds = new Set(observation.nodes.map(node => node.id));
  for (const interaction of observation.interactions) {
    const temporal =
      object(interaction.trigger) &&
      ['AFTER_TIMEOUT', 'ON_MEDIA_HIT', 'ON_MEDIA_END'].includes(text(interaction.trigger.type));
    const expectations = interaction.actions.map((raw, actionIndex) => {
      const action = object(raw) ? text(raw.type) : 'unknown';
      const navigation = object(raw) ? text(raw.navigation, '') : '';
      const destinationId =
        object(raw) && typeof raw.destinationId === 'string' ? raw.destinationId : null;
      const needsDestination =
        ['NAVIGATE', 'OPEN_OVERLAY', 'SWAP_OVERLAY', 'CHANGE_TO'].includes(action) ||
        (action === 'NODE' && ['NAVIGATE', 'OVERLAY', 'SWAP', 'CHANGE_TO'].includes(navigation));
      const supported =
        [
          'BACK',
          'CLOSE',
          'CLOSE_OVERLAY',
          'NAVIGATE',
          'OPEN_OVERLAY',
          'SWAP_OVERLAY',
          'CHANGE_TO',
        ].includes(action) ||
        (action === 'NODE' && ['NAVIGATE', 'OVERLAY', 'SWAP', 'CHANGE_TO'].includes(navigation));
      const status =
        !supported ||
        !object(interaction.trigger) ||
        ![
          'ON_CLICK',
          'ON_HOVER',
          'ON_PRESS',
          'ON_DRAG',
          'AFTER_TIMEOUT',
          'MOUSE_UP',
          'MOUSE_DOWN',
          'MOUSE_ENTER',
          'MOUSE_LEAVE',
          'ON_KEY_DOWN',
        ].includes(text(interaction.trigger.type))
          ? 'unsupported'
          : needsDestination && (destinationId === null || !nodeIds.has(destinationId))
            ? 'missing-destination'
            : 'required';
      if (status !== 'required')
        rows.issue(
          status === 'unsupported'
            ? 'CORE_INTERACTION_UNSUPPORTED'
            : 'CORE_INTERACTION_DESTINATION_MISSING',
          `${interaction.id}/${actionIndex}`,
        );
      rows.obligation(
        'implement-interaction',
        `${interaction.id}/${actionIndex}`,
        'Implement the source trigger/action and verify its required visible state and relevant service behavior.',
      );
      return {
        actionIndex,
        action: navigation ? `${action}/${navigation}` : action,
        destinationId,
        status,
        temporal: temporal || (object(raw) && raw.transition !== undefined),
      } as const;
    });
    if (!expectations.length) rows.issue('CORE_INTERACTION_ACTION_MISSING', interaction.id);
    rows.add({
      kind: 'interaction',
      id: key('interaction', interaction.id),
      nodeId: interaction.nodeId,
      observation: interaction,
      expectations,
    });
  }
  for (const node of observation.nodes)
    if (
      ['animationStyles', 'animations', 'manualKeyframeTracks', 'timeline'].some(
        field => node.properties[field] !== undefined,
      )
    )
      rows.issue('CORE_TEMPORAL_MOTION_REQUIRES_ASSERTIONS', node.id);
}

/** Pure derivation over already allocated input bytes. It does not constrain caller allocations. */
export function deriveCoreRecipeBundle(input: {
  observation: DesignObservation;
  strategy: 'blank-frontend' | 'reference-portal' | 'legacy-portal';
  requiredRootIds?: readonly string[];
  assets: readonly { record: Asset; bytes?: Uint8Array }[];
  sources?: readonly PreparedCoreRecipeSource[];
}): CoreRecipeBundle {
  if (!['blank-frontend', 'reference-portal', 'legacy-portal'].includes(input.strategy))
    throw new Error('CORE_STRATEGY_INVALID');
  const observation = verifyCoreObservation(input.observation),
    observationHash = coreHash(observation);
  if (
    (input.requiredRootIds?.length ?? 0) > 100000 ||
    input.assets.length > 100000 ||
    (input.sources?.length ?? 0) > 9
  )
    throw new Error('CORE_INPUT_LIMIT');
  const roots = new Set([...observation.roots, ...(input.requiredRootIds ?? [])]);
  const sources = (input.sources ?? []).map(source =>
    readCoreRecipeSource(source, observationHash),
  );
  if (new Set(sources.map(source => source.sourceId)).size !== sources.length)
    throw new Error('CORE_DUPLICATE_SOURCE');
  for (const source of sources) {
    // Independently prepared whole-root sources remain composable. Qualified/reviewed batches must
    // retain their complete ordered source set; omission/reordering cannot change index meaning.
    if (
      source.context.members.length > 1 ||
      source.context.mode === 'qualified' ||
      source.selection.reviews.length
    ) {
      if (
        source.context.members.length !== sources.length ||
        source.context.members.some(
          (member, index) =>
            sources[index]?.sourceId !== member.sourceId ||
            sources[index]?.context.contextHash !== source.context.contextHash,
        )
      )
        throw new Error('CORE_SOURCE_CONTEXT_SET_MISMATCH');
    }
  }
  if (input.strategy === 'blank-frontend' && sources.length)
    throw new Error('CORE_C4_SOURCE_CASE_MISMATCH');
  const assets = new Map<
    string,
    { record: Asset; status: 'verified-bytes' | 'invalid' | 'missing' | 'unavailable' }
  >();
  let assetBytes = 0;
  for (const supplied of input.assets) {
    const record = PortalCapturedAssetSchema.parse(supplied.record),
      id = assetKey(record.query);
    if (assets.has(id)) throw new Error('CORE_DUPLICATE_ASSET_QUERY');
    if (
      supplied.bytes &&
      (supplied.bytes.byteLength > PORTAL_CORE_RECIPE_LIMITS.assetFileBytes ||
        (assetBytes += supplied.bytes.byteLength) > PORTAL_CORE_RECIPE_LIMITS.assetBytes)
    )
      throw new Error('CORE_ASSET_BYTE_LIMIT');
    const status =
      record.status === 'unavailable'
        ? 'unavailable'
        : record.status !== 'captured' || supplied.bytes === undefined
          ? 'missing'
          : record.bytes !== supplied.bytes.byteLength ||
              !record.bytes ||
              checksum(supplied.bytes) !== record.sha256
            ? 'invalid'
            : 'verified-bytes';
    assets.set(id, { record, status });
  }
  const sourceDescriptors = sources
    .map(source => ({
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      rootIdentityHash: source.rootIdentityHash,
      inventoryHash: source.inventory.hash,
      graphHash: coreHash(source.graph),
      codeSourceHash: source.mappingResults?.codeSourceHash ?? null,
      sourceContextHash: source.context.contextHash,
      selectionHash: source.context.selectionHash,
      reviewsHash: source.context.reviewsHash,
      effectivePathsHash: source.context.effectivePathsHash,
    }))
    .toSorted((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
  const inputHash = coreHash({
    contractHash: CORE_RECIPE_CONTRACT_HASH,
    observationHash,
    strategy: input.strategy,
    roots: [...roots].toSorted(),
    sources: sourceDescriptors,
    assets: [...assets]
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, value]) => ({ id, record: value.record, status: value.status })),
  });
  const budget = { bytes: 0 };
  const outputs = new Map(coreIds.map(recipeId => [recipeId, new Rows(recipeId, budget)]));
  const coherent =
    observation.authority === 'collector-observed' &&
    observation.coherence.status === 'observed' &&
    observation.coherence.outcome === 'matched' &&
    observation.sourceBinding.status === 'observed';
  for (const recipeId of coreIds) {
    const rows = outputs.get(recipeId)!;
    if (!coherent) rows.issue('CORE_CAPTURE_UNVERIFIED', 'capture');
    for (const capability of observation.capabilities)
      if (requiredCapabilities[recipeId].includes(capability.name) && !good(capability.status)) {
        rows.issue('CORE_CAPABILITY_INCOMPLETE', capability.name);
        rows.obligation(
          'resolve-capability',
          capability.name,
          'A missing, failed or partial capability cannot be treated as a proven empty catalog.',
        );
      }
  }
  deriveScope(outputs.get('ground-design')!, observation, roots);
  if (!roots.size) outputs.get('ground-design')!.issue('CORE_CAPTURE_SCOPE_EMPTY', 'roots');
  deriveTokens(outputs.get('derive-tokens')!, observation);
  deriveStyleAudit(outputs.get('audit-styles')!, observation);
  deriveInteractions(outputs.get('derive-interactions')!, observation);
  for (const issue of observation.issues)
    for (const recipeId of ['ground-design', 'map-design', 'derive-tokens'] as const)
      outputs.get(recipeId)!.issue(`CORE_OBSERVATION_${issue.code}`, issue.scope);
  const assetRows = outputs.get('resolve-assets')!;
  const usages = [...roots].map(nodeId => ({
    nodeId,
    property: 'root-oracle',
    query: { kind: 'png' as const, nodeId },
  }));
  const vectors = observation.nodes
    .filter(node => ['VECTOR', 'BOOLEAN_OPERATION'].includes(text(node.properties.type)))
    .map(node => ({
      nodeId: node.id,
      property: 'vector-material',
      query: { kind: 'svg' as const, nodeId: node.id },
    }));
  const allUsages: Array<{ nodeId: string; property: string; query: Asset['query'] }> = [
    ...usages,
    ...vectors,
    ...planDesignImageReferences(observation).map(usage => ({
      nodeId: usage.nodeId,
      property: usage.property,
      query: { kind: 'image' as const, imageHash: usage.imageHash },
    })),
  ];
  for (const usage of allUsages) {
    const found = assets.get(assetKey(usage.query));
    const status = found?.status ?? 'missing';
    assetRows.add({
      kind: 'asset',
      id: key('usage', usage.nodeId, usage.property, usage.query),
      nodeId: usage.nodeId,
      property: usage.property,
      query: usage.query,
      status,
      contentHash: found?.record.sha256 ?? null,
      exportedFrom: found?.record.exportedFrom ?? null,
      bytes: found?.record.bytes ?? null,
    });
    if (status !== 'verified-bytes') {
      assetRows.issue('CORE_REQUIRED_ASSET_UNVERIFIED', `${usage.nodeId}:${usage.property}`);
      assetRows.obligation(
        'supply-asset',
        `${usage.nodeId}:${usage.property}`,
        'Supply exact captured original/export bytes for this distinct source usage.',
      );
    }
  }
  const maps = outputs.get('map-design')!,
    strategy = outputs.get('plan-design-implementation')!;
  const workflows = analyzePortalWorkflows(
    normalizePortalDesign(observation.raw),
    input.strategy === 'blank-frontend' ? 'frontend-only' : 'operational-portal',
  );
  const sourceLayers = new Set(sources.flatMap(source => source.context.effectiveLayers));
  for (const candidate of workflows.candidates) {
    strategy.add({
      kind: 'strategy',
      id: key('workflow-candidate', candidate.requirement.id),
      sourceId: null,
      status: 'construction',
      sourceHash: observationHash,
      material: material({
        family: 'workflow-candidate',
        value: candidate,
      } as unknown as DesignJson),
    });
    for (const layer of candidate.requirement.layers)
      if (!sourceLayers.has(layer))
        strategy.obligation(
          'construct-layer',
          `${candidate.requirement.id}:${layer}`,
          'Implement this required layer even if the selected reference contains only frontend code.',
        );
  }
  for (const item of workflows.unclassifiedInteractions) {
    strategy.add({
      kind: 'strategy',
      id: key('unclassified-workflow', item.evidenceId),
      sourceId: null,
      status: 'unresolved',
      sourceHash: observationHash,
      material: material({ family: 'unclassified-workflow', value: item }),
    });
    strategy.obligation(
      'resolve-source',
      item.evidenceId,
      'Resolve this draft interaction in the confirmed workflow blueprint before generation can be admitted.',
    );
  }
  for (const evidence of workflows.evidence)
    strategy.add({
      kind: 'strategy',
      id: key('workflow-evidence', evidence.id),
      sourceId: null,
      status: 'observed',
      sourceHash: observationHash,
      material: material({ family: 'workflow-evidence', value: evidence } as unknown as DesignJson),
    });
  if (!workflows.analysisComplete) strategy.issue('CORE_WORKFLOW_ANALYSIS_INCOMPLETE', 'workflows');
  if (input.strategy !== 'blank-frontend' && sources.length === 0) {
    maps.issue('CORE_SERVICE_SOURCE_MISSING', 'sources');
    strategy.issue('CORE_SERVICE_SOURCE_MISSING', 'sources');
  }
  for (const source of sources) {
    maps.add({
      kind: 'source-context',
      id: key('source-context', source.sourceId),
      context: source.context,
    });
    strategy.add({
      kind: 'source-context',
      id: key('source-context', source.sourceId),
      context: source.context,
    });
    const effectiveRoots = new Set(source.context.closureRoots),
      effectivePaths = new Set(source.effectivePaths);
    const effectiveServices = source.graph.services.filter(service =>
      effectiveRoots.has(service.rootPath),
    );
    const effectiveServiceIds = new Set(effectiveServices.map(service => service.id));
    const addSourceFact = (family: string, index: string | number, value: unknown) =>
      strategy.add({
        kind: 'strategy',
        id: key('source-strategy', source.sourceId, family, index),
        sourceId: source.sourceId,
        status: source.context.complete ? 'observed' : 'unresolved',
        sourceContextHash: source.context.contextHash,
        sourceHash: source.sourceHash,
        material: material({ family, value } as DesignJson),
      });
    for (const [index, service] of effectiveServices.entries()) {
      const { evidence: sourceEvidence, ...structure } = service;
      addSourceFact('service', index, structure);
      for (const [evidenceIndex, sourceRef] of sourceEvidence.entries())
        addSourceFact('service-evidence', `${index}/${evidenceIndex}`, sourceRef);
    }
    for (const [index, edge] of source.graph.edges.entries())
      if (
        edge.kind === 'depends-on'
          ? effectiveRoots.has(edge.from) && effectiveRoots.has(edge.to)
          : effectivePaths.has(edge.evidence.path)
      )
        addSourceFact('edge', index, edge);
    if (source.graph.connections)
      for (const family of [
        'producers',
        'clients',
        'data',
        'configuration',
        'connections',
        'issues',
      ] as const)
        for (const [index, value] of source.graph.connections[family].entries())
          if (
            family === 'issues' ||
            ('serviceId' in value && effectiveServiceIds.has(value.serviceId)) ||
            ('fromServiceId' in value &&
              effectiveServiceIds.has(value.fromServiceId) &&
              effectiveServiceIds.has(value.toServiceId))
          )
            addSourceFact(family, index, value);
    for (const [index, issue] of source.graph.issues.entries())
      addSourceFact('raw-graph-issue', index, issue);
    for (const [index, review] of source.selection.reviews.entries())
      if (review.sourceId === source.sourceId) addSourceFact('source-review', index, review);
    if (!source.context.complete) {
      strategy.issue('CORE_SERVICE_SELECTION_INCOMPLETE', source.sourceId);
      maps.issue('CORE_SERVICE_SELECTION_INCOMPLETE', source.sourceId);
    }
    if (!effectiveRoots.size) continue;
    if (
      effectiveServices.some(
        service =>
          service.codePatterns?.conventions?.truncated ||
          service.codePatterns?.conventions?.unreadFiles.length,
      )
    )
      strategy.issue('CORE_SOURCE_PATTERN_INCOMPLETE', source.sourceId);
    if (!source.mappingResults) {
      maps.issue(source.mappingIssue ?? 'CORE_MAPPING_MISSING', source.sourceId);
      continue;
    }
    for (const [mappingKind, mappings] of [
      ['component', source.mappingResults.components],
      ['token', source.mappingResults.tokens],
      ['icon', source.mappingResults.icons],
    ] as const)
      for (const [index, mapping] of mappings.entries()) {
        const mappingId =
          mappingKind === 'token' && 'sourceId' in mapping
            ? (mapping.sourceId ?? `token-${index}`)
            : 'figmaComponentName' in mapping
              ? mapping.figmaComponentName
              : 'figmaName' in mapping
                ? mapping.figmaName
                : `mapping-${index}`;
        const overrideStatus =
          'overrideStatus' in mapping ? (mapping.overrideStatus ?? 'absent') : 'absent';
        const mappingRowId = key('mapping', source.sourceId, mappingKind, index);
        const members =
          'instances' in mapping
            ? { field: 'instances' as const, values: mapping.instances }
            : 'nodeIds' in mapping
              ? { field: 'nodeIds' as const, values: mapping.nodeIds }
              : null;
        const metadata = Object.fromEntries(
          Object.entries(mapping).filter(([field]) => field !== members?.field),
        );
        maps.add({
          kind: 'mapping',
          id: mappingRowId,
          sourceId: source.sourceId,
          mappingKind,
          mappingId,
          sourceInventoryHash: source.inventory.hash,
          sourceContextHash: source.context.contextHash,
          codeSourceHash: source.mappingResults.codeSourceHash,
          status: mapping.status,
          overrideStatus,
          canonicalHash: coreHash(mapping),
          members: members ? { field: members.field, count: members.values.length } : null,
          material: material(metadata as DesignJson),
        });
        if (members)
          for (const [memberIndex, value] of members.values.entries())
            maps.add({
              kind: 'mapping-member',
              id: key('mapping-member', mappingRowId, memberIndex),
              mappingRowId,
              index: memberIndex,
              material: material(value as DesignJson),
            });
        if (
          mapping.status !== 'high' ||
          overrideStatus === 'stale' ||
          overrideStatus === 'legacy-unverified'
        )
          maps.obligation(
            'reuse-review',
            `${mappingKind}:${mappingId}`,
            'Resolve or construct the mapped source intent; candidate/name scores are not verified runtime use.',
            source.sourceId,
          );
      }
  }
  const candidates = new Map<string, Set<string>>();
  for (const row of maps.values)
    if (row.kind === 'mapping' && ['high', 'medium'].includes(row.status)) {
      const scope = `${row.mappingKind}:${row.mappingId}`,
        matches = candidates.get(scope) ?? new Set<string>();
      matches.add(row.sourceId);
      candidates.set(scope, matches);
    }
  for (const [scope, matches] of candidates)
    if (matches.size > 1) {
      maps.issue('CORE_MULTISOURCE_MAPPING_AMBIGUOUS', scope);
      maps.obligation(
        'reuse-review',
        scope,
        'Choose the exact qualified service source before treating multiple reference matches as one mapping.',
      );
    }
  if (input.strategy === 'blank-frontend') {
    strategy.add({
      kind: 'strategy',
      id: key('construction-strategy'),
      sourceId: null,
      status: 'construction',
      sourceHash: observationHash,
      material: material({
        strategy: 'blank-frontend',
        layers: ['frontend', 'configuration'],
        requirement:
          'Construct reusable components, tokens and asset wiring from the captured design; local frontend state is required.',
      }),
    });
    for (const node of observation.nodes)
      if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(text(node.properties.type)))
        maps.obligation(
          'construct-component',
          node.id,
          'Create a reusable component preserving captured API and explicit overrides.',
        );
    for (const variable of observation.catalogs.variables)
      maps.obligation(
        'construct-token',
        variable.id,
        'Create source-value/mode-aware code tokens; preserve every collection and explicit binding.',
      );
    for (const style of observation.catalogs.paintStyles)
      maps.obligation(
        'construct-token',
        text(style.id),
        'Preserve the captured paint style; multi-paint/gradient/image styles require their original material.',
      );
    for (const node of observation.nodes)
      if (['VECTOR', 'BOOLEAN_OPERATION'].includes(text(node.properties.type)))
        maps.obligation(
          'construct-icon',
          node.id,
          'Use captured vector material or exact export; do not substitute an unrelated icon.',
        );
    if (!maps.values.some(row => row.kind === 'obligation'))
      for (const root of roots)
        maps.obligation(
          'construct-component',
          root,
          'Create the captured root frontend structure even when no reusable component catalog exists.',
        );
  }
  const results: CoreRecipeBundle['results'] = [],
    pages: CoreRecipeBundle['pages'] = [];
  for (const recipeId of coreIds) {
    const rows = outputs.get(recipeId)!;
    const actualRows = rows.values.filter(row => row.kind !== 'issue' && row.kind !== 'obligation');
    const result = finalize(
      rows,
      inputHash,
      observationHash,
      observation,
      actualRows.length === 0 && !rows.values.some(row => row.kind === 'obligation')
        ? 'proved-empty'
        : 'applicable',
    );
    results.push({
      recipeId,
      required: true,
      output: result.output,
      outputHash: contentHash('sfp-portal-recipe-output-v1', result.output),
    });
    pages.push(...result.pages);
  }
  if (
    pages.length > PORTAL_CORE_RECIPE_LIMITS.pages ||
    pages.reduce((sum, value) => sum + jsonBytes(value.page), 0) >
      PORTAL_CORE_RECIPE_LIMITS.bundleBytes
  )
    throw new Error('CORE_BUNDLE_LIMIT');
  return freezeCore({
    version: 1,
    contractHash: CORE_RECIPE_CONTRACT_HASH,
    inputHash,
    observationHash,
    sources: sourceDescriptors,
    results,
    pages,
  });
}

/** Verify every manifest/page relationship before a later store adopts a pure derived result. */
export function verifyCoreRecipePages(
  manifestInput: unknown,
  pages: readonly CoreRecipeBundle['pages'][number][],
): void {
  const manifest = PortalCoreRecipeManifestSchema.parse(manifestInput);
  if (manifest.contractHash !== CORE_RECIPE_CONTRACT_HASH)
    throw new Error('CORE_CONTRACT_MISMATCH');
  const capabilities = requiredCapabilities[manifest.recipeId as (typeof coreIds)[number]];
  if (
    !capabilities ||
    capabilities.length !== manifest.capabilityEvidence.length ||
    capabilities.some(name => !manifest.capabilityEvidence.some(value => value.name === name))
  )
    throw new Error('CORE_CAPABILITY_SET_MISMATCH');
  if (pages.length !== manifest.pages.length) throw new Error('CORE_PAGE_SET_MISMATCH');
  const ids = new Set<string>();
  const contexts = new Map<string, Extract<Row, { kind: 'source-context' }>['context']>();
  const sourceFacts: Array<Extract<Row, { kind: 'strategy' }>> = [];
  const mappings = new Map<string, Extract<Row, { kind: 'mapping' }>>();
  const mappingMembers = new Map<string, Map<number, DesignJson>>();
  let issues = 0,
    blocking = 0,
    obligations = 0;
  for (const [index, item] of pages.entries()) {
    const page = PortalCoreRecipePageSchema.parse(item.page),
      expected = manifest.pages[index]!;
    if (
      page.recipeId !== manifest.recipeId ||
      page.index !== index ||
      coreHash(page) !== item.hash ||
      item.hash !== expected.hash ||
      page.rows.length !== expected.rows ||
      jsonBytes(page) !== expected.bytes
    )
      throw new Error('CORE_PAGE_BINDING_MISMATCH');
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error('CORE_DUPLICATE_ROW');
      ids.add(row.id);
      if (row.kind === 'issue') {
        issues++;
        if (row.issue.blocking) blocking++;
      }
      if (row.kind === 'obligation') obligations++;
      if (row.kind === 'source-context') {
        const context = row.context;
        if (
          contexts.has(context.sourceId) ||
          coreHash({
            mode: context.mode,
            members: context.members,
            requestHash: context.requestHash,
            selectionHash: context.selectionHash,
            reviewsHash: context.reviewsHash,
          }) !== context.contextHash
        )
          throw new Error('CORE_SOURCE_CONTEXT_HASH_MISMATCH');
        contexts.set(context.sourceId, context);
      }
      if (row.kind === 'strategy' && row.sourceId !== null) sourceFacts.push(row);
      if (row.kind === 'mapping') mappings.set(row.id, row);
      if (row.kind === 'mapping-member') {
        const members = mappingMembers.get(row.mappingRowId) ?? new Map<number, DesignJson>();
        if (members.has(row.index)) throw new Error('CORE_DUPLICATE_MAPPING_MEMBER');
        members.set(row.index, row.material.value);
        mappingMembers.set(row.mappingRowId, members);
      }
      for (const field of ['material', 'metadata', 'componentApi', 'overrides'] as const)
        if (field in row) {
          const observed = (
            row as unknown as Record<string, { value: DesignJson; hash: string } | null>
          )[field];
          if (observed && coreHash(observed.value) !== observed.hash)
            throw new Error('CORE_MATERIAL_HASH_MISMATCH');
        }
    }
  }
  if (
    issues !== manifest.issueCount ||
    blocking !== manifest.blockingIssueCount ||
    obligations !== manifest.obligationCount
  )
    throw new Error('CORE_MANIFEST_COUNTS_MISMATCH');
  for (const [mappingRowId, members] of mappingMembers)
    if (
      !mappings.has(mappingRowId) ||
      !mappings.get(mappingRowId)!.members ||
      members.size !== mappings.get(mappingRowId)!.members!.count
    )
      throw new Error('CORE_MAPPING_MEMBER_SET_MISMATCH');
  for (const fact of sourceFacts)
    if (contexts.get(fact.sourceId!)?.contextHash !== fact.sourceContextHash)
      throw new Error('CORE_SOURCE_CONTEXT_MISSING');
  for (const mapping of mappings.values()) {
    const context = contexts.get(mapping.sourceId);
    if (
      !context ||
      context.contextHash !== mapping.sourceContextHash ||
      context.members[context.sourceIndex]?.inventoryHash !== mapping.sourceInventoryHash
    )
      throw new Error('CORE_SOURCE_CONTEXT_MISSING');
    const members = mappingMembers.get(mapping.id) ?? new Map<number, DesignJson>();
    if (
      (mapping.members?.count ?? 0) !== members.size ||
      [...members.keys()].toSorted((a, b) => a - b).some((index, order) => index !== order)
    )
      throw new Error('CORE_MAPPING_MEMBER_SET_MISMATCH');
    const reconstructed = mapping.members
      ? {
          ...(mapping.material.value as Record<string, DesignJson>),
          [mapping.members.field]: Array.from({ length: mapping.members.count }, (_, index) =>
            members.get(index)!,
          ),
        }
      : mapping.material.value;
    if (coreHash(reconstructed) !== mapping.canonicalHash)
      throw new Error('CORE_MAPPING_CANONICAL_HASH_MISMATCH');
  }
}
