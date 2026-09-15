import { canonicalJson, contentHash, storedChecksum, type PortalPlan } from '@sfp/ir';
import {
  PORTAL_CORE_RECIPE_IDS,
  PortalRecipeInputContextSchema,
  type PortalRecipeInputContext,
  type PortalAuthority,
  type WorkspacePolicy,
} from '@sfp/shared';

import {
  PortalCorePlanBindingSchema,
  PortalCoreEvidenceViewSchema,
  PortalCoreDeclarationsSchema,
  PortalCoreDeclarationBatchSchema,
  PortalCoreWorkItemSchema,
  canonicalCoreDeclarations,
  type PortalCorePlanBinding,
  type PortalCoreWorkItem,
  type PortalCoreDeclarations,
} from '../../../../shared/src/portal-core-lifecycle.js';
import { RepoReader } from '../../fs/repo-walk.js';
import { resolvePortalAuthority } from '../authority.js';
import {
  assertPortalCaptureDescriptor,
  requireCurrentPortalCapture,
  verifyPortalCaptureFiles,
  type PortalCapturedDesign,
} from '../design-capture.js';
import { normalizeDesignObservation } from '../design-normalization.js';
import { collectPortalSourceInventory } from '../source-inventory.js';
import { portalError } from '../store.js';
import { CORE_RECIPE_CONTRACT_HASH, type deriveCoreRecipeBundle } from './core-derivation.js';
import { CorePreparations } from './core-preparation.js';
import { coreHash, prepareCoreRecipeSources } from './core-source.js';
import {
  PORTAL_RECIPE_CATALOG,
  validatePortalRecipeResultBinding,
  portalRecipeResultHash,
} from './definitions.js';

type Scope = { ownerId: string; workspaceId: string };
type Input = Parameters<typeof deriveCoreRecipeBundle>[0];
type Context = Omit<
  PortalRecipeInputContext,
  'recipeAuthorityVersion' | 'capabilityVersions' | 'selections'
>;
type Read = Awaited<ReturnType<CorePreparations['readResults']>>;
const kinds: Record<(typeof PORTAL_CORE_RECIPE_IDS)[number], PortalCoreWorkItem['kind']> = {
  'ground-design': 'scope',
  'map-design': 'mapping',
  'derive-tokens': 'token',
  'audit-styles': 'style',
  'resolve-assets': 'asset',
  'derive-interactions': 'interaction',
  'plan-design-implementation': 'strategy',
};
const hashBinding = (value: Omit<PortalCorePlanBinding, 'bindingHash'>) =>
  contentHash('sfp-portal-core-binding-v1', value);
const definitions = () =>
  PORTAL_CORE_RECIPE_IDS.map(recipeId => {
    const row = PORTAL_RECIPE_CATALOG.find(entry => entry.definition.recipeId === recipeId);
    if (
      !row ||
      row.definition.execution !== 'implemented' ||
      row.definition.implementationHash !== CORE_RECIPE_CONTRACT_HASH ||
      row.definition.outputSchemaId !== 'sfp.recipe.core-manifest.v1'
    )
      throw portalError('PORTAL_CORE_DEFINITION_UNAVAILABLE');
    return row;
  });
const declarationKey = (row: { resultId: string; outputItemId: string }) =>
  JSON.stringify([row.resultId, row.outputItemId]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const coreRequirementsHash = (
  plan: Pick<
    PortalPlan,
    | 'requirements'
    | 'implementationScope'
    | 'workflowCoverage'
    | 'serviceSelection'
    | 'interactionContract'
  >,
) =>
  contentHash('sfp-portal-core-requirements-v1', {
    requirements: plan.requirements,
    scope: plan.implementationScope,
    workflowCoverage: plan.workflowCoverage,
    serviceSelection: plan.serviceSelection,
    interactionContract: plan.interactionContract,
  });

/** Pure drafts carry no fabricated preparation or successful required result. */
export function unavailableCoreBinding(
  requirementsHash: `sha256:${string}`,
  code: string,
): PortalCorePlanBinding {
  const value = {
    recipeAuthorityVersion: 1 as const,
    status: 'blocked' as const,
    code,
    contractHash: CORE_RECIPE_CONTRACT_HASH,
    requirementsHash,
    preparationId: null,
    contextHash: null,
    inputHash: null,
    requiredResults: [],
    workItemsHash: null,
    workItemCount: 0,
  };
  return PortalCorePlanBindingSchema.parse({ ...value, bindingHash: hashBinding(value) });
}

export function coreDeclarationsHash(input: unknown): `sha256:${string}` {
  return contentHash('sfp-portal-core-declarations-v1', canonicalCoreDeclarations(input));
}

/** Actual signed preparation and dependency lifecycle; declarations never prove implementation. */
export class PortalCoreLifecycle {
  constructor(private readonly preparations: CorePreparations) {}
  inspectIntent(scope: Scope, intentId: string) {
    return this.preparations.inspectIntent(scope, intentId);
  }

  /** Re-read complete source authority before publication or any new/renewed coding lease. */
  async assertSourcesCurrent(plan: PortalPlan, policy: WorkspacePolicy, signal?: AbortSignal) {
    for (const profile of plan.profiles) {
      signal?.throwIfAborted();
      const grant = plan.repositories.find(
        root =>
          root.role === profile.role &&
          root.workspaceId === profile.workspaceId &&
          root.rootPath === profile.rootPath,
      );
      if (!grant || !profile.graph.sourceInventory?.complete)
        throw portalError('PORTAL_CORE_SOURCE_REQUIRED');
      // eslint-disable-next-line no-await-in-loop -- each retained source has independent byte authority
      const inventory = await collectPortalSourceInventory(
        new RepoReader({
          rootDir: grant.canonicalPath,
          workspaceId: grant.workspaceId,
          workspacePolicy: policy,
          ...(signal ? { signal } : {}),
        }),
      );
      if (!inventory.complete || inventory.hash !== profile.graph.sourceInventory.hash)
        throw portalError('PORTAL_CORE_SOURCE_CHANGED');
    }
  }

  /** The coordinator has already admitted and signed these source/capture/scope inputs. */
  async preparePlan(
    plan: PortalPlan,
    captured: PortalCapturedDesign,
    authority: PortalAuthority,
    policy: WorkspacePolicy,
    signal: AbortSignal,
  ): Promise<PortalCorePlanBinding> {
    if (
      !plan.design.capture ||
      plan.design.storage !== 'owner-state' ||
      plan.workspaceId !== authority.workspaceId ||
      plan.implementationScope !== authority.scope
    )
      throw portalError('PORTAL_CORE_ADMISSION_REQUIRED');
    requireCurrentPortalCapture(captured);
    assertPortalCaptureDescriptor(captured, plan.design.capture);
    await verifyPortalCaptureFiles(captured, signal);
    const observation = normalizeDesignObservation(
      JSON.parse(captured.raw),
      captured.collectorEvidence,
    );
    const sources = plan.profiles.map(profile => {
      const root = authority.roots.find(
        candidate =>
          candidate.role === profile.role &&
          candidate.workspaceId === profile.workspaceId &&
          candidate.rootPath === profile.rootPath,
      );
      if (!root || !profile.graph.sourceId) throw portalError('PORTAL_CORE_SOURCE_REQUIRED');
      return {
        sourceId: profile.graph.sourceId as `sha256:${string}`,
        reader: new RepoReader({
          rootDir: root.path,
          workspaceId: root.workspaceId,
          workspacePolicy: policy,
          signal,
        }),
      };
    });
    const preparedSources = sources.length
      ? await prepareCoreRecipeSources({
          sources,
          observation,
          sourceContext: {
            services: plan.request.services,
            sourceReviews: plan.request.sourceReviews,
          },
        })
      : [];
    const reader = new RepoReader({
      rootDir: captured.assetRoot,
      signal,
      maxFileBytes: 16_777_216,
      maxTotalBytes: 536_870_912,
    });
    const assets: Array<Input['assets'][number]> = [];
    for (const record of captured.assets) {
      signal.throwIfAborted();
      if (record.status !== 'captured' || !record.path || !record.sha256 || !record.bytes)
        throw portalError('PORTAL_CORE_ASSET_REQUIRED');
      // eslint-disable-next-line no-await-in-loop -- aggregate retained asset reads are bounded
      const bytes = await reader.readBytes(record.path);
      if (bytes.length !== record.bytes || storedChecksum(bytes) !== record.sha256)
        throw portalError('PORTAL_CORE_ASSET_CHANGED');
      assets.push({ record, bytes });
    }
    const requirementsHash = coreRequirementsHash(plan);
    const binding = await this.prepare(
      { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
      {
        ownerId: plan.ownerId,
        workspaceId: plan.workspaceId,
        intentId: plan.planId,
        strategy: plan.strategy,
        authorityHash: authority.hash,
        captureHash: contentHash('sfp-portal-capture-descriptor-v2', plan.design.capture),
        assetManifestHash: contentHash('sfp-portal-design-assets-v1', captured.assets),
        scopeHash: contentHash('sfp-portal-core-admitted-scope-v1', {
          requirementsHash,
          contextHash: plan.contextHash,
          requestHash: contentHash('sfp-portal-core-request-v1', plan.request),
        }),
        sourceHashes: plan.profiles.map(profile => ({
          sourceId: profile.graph.sourceId!,
          inventoryHash: profile.graph.sourceInventory!.hash,
          graphHash: coreHash(profile.graph),
        })),
      },
      { observation, strategy: plan.strategy, assets, sources: preparedSources },
      requirementsHash,
      signal,
    );
    await this.assertSourcesCurrent(plan, policy, signal);
    await verifyPortalCaptureFiles(captured, signal);
    const finalAuthority = await resolvePortalAuthority(
      policy,
      plan.workspaceId,
      plan.request,
      plan.planId,
      plan.implementationScope,
      plan,
    );
    if (finalAuthority.hash !== authority.hash) throw portalError('PORTAL_CORE_SOURCE_CHANGED');
    return binding;
  }

  private workItems(read: Read): PortalCoreWorkItem[] {
    return read.results
      .flatMap(stored => {
        const recipeId = PORTAL_CORE_RECIPE_IDS.find(id => id === stored.result.recipeId);
        if (!recipeId) throw portalError('PORTAL_CORE_RESULT_SET_CHANGED');
        const resultHash = portalRecipeResultHash(stored.result);
        return stored.pages.map(page =>
          PortalCoreWorkItemSchema.parse({
            id: contentHash('sfp-portal-core-work-item-v1', {
              resultId: stored.result.resultId,
              pageHash: page.hash,
            }),
            recipeId,
            resultId: stored.result.resultId,
            resultHash,
            pageHash: page.hash,
            pageIndex: page.page.index,
            rows: page.page.rows.length,
            kind: kinds[recipeId],
          }),
        );
      })
      .toSorted((a, b) => compare(a.recipeId, b.recipeId) || a.pageIndex - b.pageIndex);
  }

  private bind(read: Read, requirementsHash: `sha256:${string}`): PortalCorePlanBinding {
    const catalog = definitions();
    const requiredResults = read.results
      .map(stored => {
        const current = catalog.find(row => row.definition.recipeId === stored.result.recipeId);
        if (!current || current.definitionHash !== stored.result.definitionHash)
          throw portalError('PORTAL_CORE_DEFINITION_CHANGED');
        if (stored.result.status === 'succeeded')
          validatePortalRecipeResultBinding(stored.result, current.definition, {
            ownerId: read.preparation.ownerId,
            workspaceId: read.preparation.workspaceId,
            contextHash: read.preparation.contextHash,
            inputHash: read.preparation.inputHash,
          });
        return {
          recipeId: stored.result.recipeId,
          definitionHash: current.definitionHash,
          resultId: stored.result.resultId,
          resultHash: portalRecipeResultHash(stored.result),
        };
      })
      .toSorted((a, b) => compare(a.recipeId, b.recipeId));
    const items = this.workItems(read);
    const ready = read.preparation.status === 'ready';
    const value = {
      recipeAuthorityVersion: 1 as const,
      status: ready ? ('ready' as const) : ('blocked' as const),
      code: ready ? null : (read.preparation.code ?? 'PORTAL_CORE_PREPARATION_NOT_READY'),
      contractHash: CORE_RECIPE_CONTRACT_HASH,
      requirementsHash,
      preparationId: read.preparation.preparationId,
      contextHash: read.preparation.contextHash,
      inputHash: read.preparation.inputHash,
      requiredResults,
      workItemsHash: contentHash('sfp-portal-core-work-items-v1', items),
      workItemCount: items.length,
    };
    return PortalCorePlanBindingSchema.parse({
      ...value,
      bindingHash: hashBinding(value as Omit<PortalCorePlanBinding, 'bindingHash'>),
    });
  }

  async prepare(
    scope: Scope,
    admitted: Context,
    input: Input,
    requirementsHash: `sha256:${string}`,
    signal?: AbortSignal,
  ) {
    const context = PortalRecipeInputContextSchema.parse({
      ...admitted,
      recipeAuthorityVersion: 1,
      capabilityVersions: [{ id: 'core-derivation', version: 1, hash: CORE_RECIPE_CONTRACT_HASH }],
      selections: definitions().map(({ definition, definitionHash }) => ({
        recipeId: definition.recipeId,
        definitionHash,
        required: true,
        applicability: 'applicable',
        evidence: [
          { kind: 'capture', captureHash: admitted.captureHash, itemId: admitted.intentId },
        ],
      })),
    });
    const prepared = await this.preparations.prepare(scope, context, input, signal);
    const read = await this.preparations.readResults(scope, prepared.preparationId);
    return this.bind(read, requirementsHash);
  }

  private async read(scope: Scope, supplied: PortalCorePlanBinding): Promise<Read> {
    const binding = PortalCorePlanBindingSchema.parse(supplied);
    const { bindingHash, ...base } = binding;
    if (hashBinding(base) !== bindingHash || binding.contractHash !== CORE_RECIPE_CONTRACT_HASH)
      throw portalError('PORTAL_CORE_BINDING_CHANGED');
    if (!binding.preparationId) throw portalError('PORTAL_CORE_PREPARATION_REQUIRED');
    const read = await this.preparations.readResults(scope, binding.preparationId);
    if (
      canonicalJson(this.bind(read, binding.requirementsHash as `sha256:${string}`)) !==
      canonicalJson(binding)
    )
      throw portalError('PORTAL_CORE_BINDING_CHANGED');
    return read;
  }

  async verify(scope: Scope, binding: PortalCorePlanBinding): Promise<void> {
    await this.readForConsumption(scope, binding);
  }

  /** Internal verifier bridge, never a transport-provided result or permission grant. */
  async readForConsumption(scope: Scope, binding: PortalCorePlanBinding): Promise<Read> {
    const read = await this.read(scope, binding);
    if (read.preparation.status !== 'ready') throw portalError('PORTAL_CORE_PREPARATION_NOT_READY');
    return read;
  }

  async retain(scope: Scope, binding: PortalCorePlanBinding, dependencyId: string): Promise<void> {
    await this.verify(scope, binding);
    await this.preparations.setDependency(scope, binding.preparationId!, dependencyId, true);
  }

  async release(scope: Scope, binding: PortalCorePlanBinding, dependencyId: string): Promise<void> {
    if (binding.preparationId)
      await this.preparations.setDependency(scope, binding.preparationId, dependencyId, false);
  }

  async view(
    scope: Scope,
    binding: PortalCorePlanBinding,
    query: {
      workOffset?: number | undefined;
      resultId?: string | undefined;
      pageIndex?: number | undefined;
    } = {},
  ) {
    const offset = query.workOffset ?? 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 4096 ||
      (query.pageIndex !== undefined &&
        (!Number.isSafeInteger(query.pageIndex) || query.pageIndex < 0 || query.pageIndex > 4095))
    )
      throw portalError('PORTAL_CORE_READ_LIMIT');
    if (!binding.preparationId)
      return PortalCoreEvidenceViewSchema.parse({
        binding,
        results: [],
        workItems: [],
        nextWorkOffset: null,
        selectedResultId: null,
        pageHash: null,
        page: null,
      });
    const read = await this.read(scope, binding),
      items = this.workItems(read);
    const selected =
      query.resultId === undefined
        ? null
        : read.results.find(row => row.result.resultId === query.resultId);
    if (query.resultId !== undefined && !selected)
      throw portalError('PORTAL_CORE_RESULT_NOT_FOUND');
    const page = selected?.pages[query.pageIndex ?? 0] ?? null;
    if (selected && !page && selected.pages.length) throw portalError('PORTAL_CORE_PAGE_NOT_FOUND');
    return PortalCoreEvidenceViewSchema.parse({
      binding,
      results: read.results.map(row => ({
        recipeId: row.result.recipeId,
        resultId: row.result.resultId,
        resultHash: portalRecipeResultHash(row.result),
        status: row.result.status,
        pages: row.pages.length,
        issues: row.manifest.issueCount,
        obligations: row.manifest.obligationCount,
      })),
      workItems: items.slice(offset, offset + 50),
      nextWorkOffset: offset + 50 < items.length ? offset + 50 : null,
      selectedResultId: selected?.result.resultId ?? null,
      pageHash: page?.hash ?? null,
      page: page?.page ?? null,
    });
  }

  async mergeDeclarations(
    scope: Scope,
    binding: PortalCorePlanBinding,
    files: ReadonlyArray<{ path: string; hash: string }>,
    previous: unknown,
    additions: unknown,
    finished: boolean,
  ): Promise<PortalCoreDeclarations> {
    const prior = PortalCoreDeclarationsSchema.parse(previous);
    const submitted = PortalCoreDeclarationBatchSchema.parse(additions);
    const read = await this.read(scope, binding);
    if (read.preparation.status !== 'ready') throw portalError('PORTAL_CORE_PREPARATION_NOT_READY');
    const expected = new Map(
      this.workItems(read).map(item => [JSON.stringify([item.resultId, item.id]), item]),
    );
    const currentFiles = new Map(files.map(file => [file.path, file.hash]));
    const live = new Map(
      prior
        .filter(row => row.files.every(file => currentFiles.get(file.path) === file.hash))
        .map(row => [declarationKey(row), row]),
    );
    for (const row of submitted) {
      if (!row.files.every(file => currentFiles.get(file.path) === file.hash))
        throw portalError('PORTAL_CORE_DECLARATION_FILE_CHANGED');
      live.set(declarationKey(row), row);
    }
    const merged = PortalCoreDeclarationsSchema.parse([...live.values()]);
    for (const row of merged) {
      const item = expected.get(declarationKey(row));
      if (!item || item.kind !== row.kind || item.resultHash !== row.resultHash)
        throw portalError('PORTAL_CORE_DECLARATION_NOT_BOUND');
    }
    if (
      finished &&
      (merged.length !== expected.size || [...expected.keys()].some(key => !live.has(key)))
    )
      throw portalError('PORTAL_CORE_DECLARATIONS_INCOMPLETE');
    return merged;
  }
}
