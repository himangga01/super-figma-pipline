import {
  canonicalJson,
  contentHash,
  PortalPlanSchema,
  PortalRunSchema,
  portalCandidateHash,
  storedChecksum,
  type PortalPlan,
  type PortalRun,
} from '@sfp/ir';
import { isBoundedDesignJson, type PortalCoreRecipePage, type WorkspacePolicy } from '@sfp/shared';
import { z } from 'zod';

import { RepoReader } from '../../fs/repo-walk.js';
import { portalContentBytes } from '../content.js';
import { PortalCapturedDesignSchema, assertPortalCaptureDescriptor } from '../design-capture.js';
import { normalizeDesignObservation } from '../design-normalization.js';
import { PortalStore, portalError } from '../store.js';
import { coreDeclarationsHash, PortalCoreLifecycle } from './core-lifecycle.js';
import { coreHash } from './core-source.js';

const contentSchema = z
  .object({
    content: z.string(),
    hash: z.string(),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  })
  .strict();
export interface ConsumptionPage {
  workItemId: string;
  resultId: string;
  resultHash: string;
  pageHash: string;
  page: PortalCoreRecipePage;
  files: Array<{ path: string; hash: string }>;
  assertionIds: string[];
}
/** Read only material that the current signed candidate actually declares; not arbitrary paths. */
export async function loadCoreConsumptionInput(
  dependencies: {
    store: PortalStore; lifecycle: PortalCoreLifecycle; policy: WorkspacePolicy;
    /** Trusted NativeWork guard: signed apply journal, actual target identity and complete bytes. */
    verifyAppliedTarget?(plan:PortalPlan,run:PortalRun,signal:AbortSignal):Promise<void>;
  },
  request: { ownerId: string; planId: string; candidateHash: string; target?:'candidate'|'applied' },
  signal?: AbortSignal,
) {
  const plan = await dependencies.store.get('plans', request.planId, PortalPlanSchema);
  const run = await dependencies.store.get('runs', request.planId, PortalRunSchema);
  if (
    !plan ||
    !run ||
    plan.ownerId !== request.ownerId ||
    run.ownerId !== request.ownerId ||
    run.planId !== plan.planId ||
    run.workspaceId !== plan.workspaceId
  )
    throw portalError('PORTAL_CONSUMPTION_OWNER_MISMATCH');
  if (
    !plan.coreRecipes ||
    !run.coreRecipes ||
    canonicalJson(plan.coreRecipes) !== canonicalJson(run.coreRecipes) ||
    plan.coreRecipes.status !== 'ready' ||
    run.state === 'cancelled' ||
    run.candidateHash !== request.candidateHash ||
    portalCandidateHash(run.files, plan, run.coreDeclarations) !== request.candidateHash
  )
    throw portalError('PORTAL_CONSUMPTION_CANDIDATE_CHANGED');
  const applied=request.target==='applied';
  if(applied){
    if(run.appliedHash!==request.candidateHash || !dependencies.verifyAppliedTarget)
      throw portalError('PORTAL_CONSUMPTION_APPLIED_AUTHORITY_REQUIRED');
    await dependencies.verifyAppliedTarget(plan,run,signal??new AbortController().signal);
  }
  const declarations = run.coreDeclarations ?? [];
  if (!run.coreDeclarationsHash || coreDeclarationsHash(declarations) !== run.coreDeclarationsHash)
    throw portalError('PORTAL_CONSUMPTION_DECLARATIONS_CHANGED');
  const material = await dependencies.lifecycle.readForConsumption(
    { ownerId: plan.ownerId, workspaceId: plan.workspaceId },
    plan.coreRecipes,
  );
  const captured = await dependencies.store.get('designs', plan.planId, PortalCapturedDesignSchema);
  if (!captured) throw portalError('PORTAL_CONSUMPTION_CAPTURE_REQUIRED');
  assertPortalCaptureDescriptor(captured, plan.design.capture);
  const observation = normalizeDesignObservation(
    JSON.parse(captured.raw),
    captured.collectorEvidence,
  );
  const observationHash = coreHash(observation);
  const pages: ConsumptionPage[] = [];
  const kinds: Record<string, string> = {
    'ground-design': 'scope',
    'map-design': 'mapping',
    'derive-tokens': 'token',
    'audit-styles': 'style',
    'resolve-assets': 'asset',
    'derive-interactions': 'interaction',
    'plan-design-implementation': 'strategy',
  };
  const usedDeclarations = new Set<string>();
  for (const result of material.results) {
    if (result.result.status !== 'succeeded' || result.manifest.observationHash !== observationHash)
      throw portalError('PORTAL_CONSUMPTION_RESULT_CHANGED');
    const reference = plan.coreRecipes.requiredResults.find(
      row => row.resultId === result.result.resultId,
    );
    if (!reference) throw portalError('PORTAL_CONSUMPTION_RESULT_CHANGED');
    for (const page of result.pages) {
      const workItemId = contentHash('sfp-portal-core-work-item-v1', {
        resultId: reference.resultId,
        pageHash: page.hash,
      });
      const declaration = declarations.find(
        row => row.resultId === reference.resultId && row.outputItemId === workItemId,
      );
      if (
        !declaration ||
        declaration.resultHash !== reference.resultHash ||
        declaration.kind !== kinds[reference.recipeId] ||
        usedDeclarations.has(workItemId)
      )
        throw portalError('PORTAL_CONSUMPTION_DECLARATIONS_CHANGED');
      usedDeclarations.add(workItemId);
      pages.push({
        workItemId,
        resultId: reference.resultId,
        resultHash: reference.resultHash,
        pageHash: page.hash,
        page: page.page,
        files: declaration.files,
        assertionIds: declaration.assertionIds,
      });
    }
  }
  if (usedDeclarations.size !== declarations.length)
    throw portalError('PORTAL_CONSUMPTION_DECLARATIONS_CHANGED');
  const eligible = new Map<string, { hash: string; baseline: boolean }>();
  const baseline =
    plan.strategy === 'legacy-portal'
      ? plan.profiles.find(profile => profile.role === 'target')
      : undefined;
  if (baseline) {
    if (!baseline.graph.sourceInventory?.complete)
      throw portalError('PORTAL_CONSUMPTION_SOURCE_REQUIRED');
    for (const file of baseline.graph.sourceInventory.files)
      eligible.set(file.path, { hash: file.hash, baseline: true });
  }
  for (const file of run.files)
    eligible.set(file.path, { hash: file.contentHash, baseline: false });
  const requested = new Map<string, string>();
  for (const page of pages)
    for (const file of page.files) {
      if (eligible.get(file.path)?.hash !== file.hash)
        throw portalError('PORTAL_CONSUMPTION_FILE_CHANGED');
      requested.set(file.path, file.hash);
    }
  const root = baseline
    ? plan.repositories.find(
        candidate =>
          candidate.role === 'target' &&
          candidate.workspaceId === baseline.workspaceId &&
          candidate.rootPath === baseline.rootPath,
      )
    : undefined;
  const reader = root
    ? new RepoReader({
        rootDir: root.canonicalPath,
        workspaceId: root.workspaceId,
        workspacePolicy: dependencies.policy,
        maxFileBytes: 16_777_216,
        maxTotalBytes: 134_217_728,
        ...(signal ? { signal } : {}),
      })
    : null;
  const files = new Map<string, { hash: string; bytes: Buffer }>();
  let totalBytes = 0;
  for (const [path, hash] of [...requested].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    signal?.throwIfAborted();
    let bytes: Buffer;
    if (eligible.get(path)!.baseline) {
      if (!reader) throw portalError('PORTAL_CONSUMPTION_SOURCE_REQUIRED');
      // Sequential reads enforce a single aggregate material budget.
      // eslint-disable-next-line no-await-in-loop
      bytes = Buffer.from(await reader.readBytes(path));
    } else {
      // Signed deduplicated contents are reachable only through this owner's actual run reference.
      // eslint-disable-next-line no-await-in-loop
      const stored = await dependencies.store.get('contents', hash.slice(7), contentSchema);
      if (!stored || stored.hash !== hash) throw portalError('PORTAL_CONSUMPTION_CONTENT_MISSING');
      bytes = portalContentBytes({ path, content: stored.content, encoding: stored.encoding });
    }
    if (bytes.byteLength > 16_777_216 || (totalBytes += bytes.byteLength) > 134_217_728)
      throw portalError('PORTAL_CONSUMPTION_MATERIAL_LIMIT');
    if (storedChecksum(bytes) !== hash) throw portalError('PORTAL_CONSUMPTION_FILE_CHANGED');
    files.set(path, { hash, bytes });
  }
  // The original target inventory is intentionally replaced after an approved apply. Its complete
  // applied bytes are checked by the actual journal/root guard; reference snapshots stay unchanged.
  await dependencies.lifecycle.assertSourcesCurrent(applied
    ? {...plan,profiles:plan.profiles.filter(profile=>profile.role==='reference')}
    : plan, dependencies.policy, signal);
  if(applied)await dependencies.verifyAppliedTarget!(plan,run,signal??new AbortController().signal);
  const current=await dependencies.store.get('runs',request.planId,PortalRunSchema);
  if(!current || current.ownerId!==request.ownerId || current.state==='cancelled' ||
      current.candidateHash!==run.candidateHash || current.coreDeclarationsHash!==run.coreDeclarationsHash ||
      canonicalJson(current.coreRecipes)!==canonicalJson(run.coreRecipes))
    throw portalError('PORTAL_CONSUMPTION_CANDIDATE_CHANGED');
  signal?.throwIfAborted();
  return {
    plan,
    run,
    captured,
    observation,
    pages,
    files,
    materialHash: contentHash('sfp-core-consumption-material-v1', {
      contextHash: plan.coreRecipes.contextHash,
      blueprintHash: plan.blueprintHash,
      candidateHash: run.candidateHash,
      declarationsHash: run.coreDeclarationsHash,
      pages: pages.map(page => ({
        resultHash: page.resultHash,
        pageHash: page.pageHash,
        workItemId: page.workItemId,
      })),
      files: [...files].map(([path, file]) => ({ path, hash: file.hash })),
    }),
  };
}

/** Retaining an unused catalog is source export evidence only, never proof of rendered use. */
export function verifyCoreCatalogExport(
  page: ConsumptionPage,
  rowId: string,
  path: string,
  files: ReadonlyMap<string, { hash: string; bytes: Uint8Array }>,
) {
  const row = page.page.rows.find(candidate => candidate.id === rowId);
  if (!row || !['variable', 'collection', 'style', 'token-export'].includes(row.kind))
    throw portalError('PORTAL_CONSUMPTION_CATALOG_KIND');
  const file = files.get(path);
  if (
    !file ||
    !page.files.some(value => value.path === path && value.hash === file.hash) ||
    storedChecksum(file.bytes) !== file.hash
  )
    throw portalError('PORTAL_CONSUMPTION_FILE_CHANGED');
  if (file.bytes.byteLength > 16_777_216) throw portalError('PORTAL_CONSUMPTION_MATERIAL_LIMIT');
  const parsed = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(file.bytes),
  ) as unknown;
  if (!isBoundedDesignJson(parsed, 16_777_216, 200_000))
    throw portalError('PORTAL_CONSUMPTION_MATERIAL_LIMIT');
  const exported = z
    .object({
      schema: z.literal('sfp.core-materials.v1'),
      resultId: z.string(),
      resultHash: z.string(),
      rows: z.array(z.unknown()).max(16384),
    })
    .strict()
    .parse(parsed);
  if (
    exported.resultId !== page.resultId ||
    exported.resultHash !== page.resultHash ||
    exported.rows.filter(value => coreHash(value) === coreHash(row)).length !== 1
  )
    throw portalError('PORTAL_CONSUMPTION_CATALOG_CHANGED');
  return {
    kind: 'source' as const,
    path,
    fileHash: file.hash,
    rowHash: coreHash(row),
    evidenceHash: contentHash('sfp-core-catalog-export-v1', {
      resultHash: page.resultHash,
      pageHash: page.pageHash,
      rowHash: coreHash(row),
      path,
      fileHash: file.hash,
    }),
  };
}
