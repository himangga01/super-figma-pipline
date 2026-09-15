import { contentHash, storedChecksum, type PortalPlan } from '@sfp/ir';
import type { WorkspacePolicy } from '@sfp/shared';

import { RepoReader } from '../fs/repo-walk.js';
import { PortalCapturedDesignSchema } from './design-capture.js';
import { normalizePortalDesign } from './design-normalization.js';
import { portalError, type PortalStore } from './store.js';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
type StyleFamily = 'paints' | 'texts' | 'effects' | 'grids';
interface CatalogOffsets {
  collectionOffset?: number;
  styleFamily?: StyleFamily;
  styleOffset?: number;
}
const catalogPage = (rows: unknown[], offset: number, signal: AbortSignal) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
    throw portalError('PORTAL_DESIGN_CATALOG_OFFSET_INVALID');
  if (rows.length > 100_000) throw portalError('PORTAL_DESIGN_CATALOG_LIMIT');
  const selected: unknown[] = [];
  let bytes = 2;
  for (let at = offset; at < rows.length && selected.length < 128; at++) {
    signal.throwIfAborted();
    const size = Buffer.byteLength(JSON.stringify(rows[at])) + (selected.length ? 1 : 0);
    if (bytes + size > 524_288) {
      if (!selected.length) throw portalError('PORTAL_DESIGN_CATALOG_ROW_LIMIT');
      break;
    }
    bytes += size;
    selected.push(rows[at]);
  }
  return {
    rows: selected,
    total: rows.length,
    nextOffset: offset + selected.length < rows.length ? offset + selected.length : null,
  };
};
/** Preserve original Figma values while paging the hierarchy; never substitute editor DOM values. */
export const readPortalDesignPage = async (
  plan: PortalPlan,
  policy: WorkspacePolicy,
  offset: number,
  limit: number,
  signal: AbortSignal,
  store?: PortalStore,
  tokenOffset = 0,
  catalogOffsets: CatalogOffsets = {},
) => {
  if (!plan.design.artifactPath || !plan.design.artifactHash) return null;
  let bytes: Uint8Array;
  if (plan.design.storage === 'owner-state') {
    const record = await store?.get('designs', plan.planId, PortalCapturedDesignSchema);
    if (!record) throw portalError('PORTAL_DESIGN_CAPTURE_MISSING');
    bytes = Buffer.from(record.raw);
  } else {
    if (!policy.resolveRoot) throw portalError('WORKSPACE_REQUIRED');
    const root = await policy.resolveRoot(plan.workspaceId);
    bytes = await new RepoReader({
      rootDir: root,
      workspaceId: plan.workspaceId,
      workspacePolicy: policy,
      signal,
      maxFileBytes: 16_777_216,
    }).readBytes(plan.design.artifactPath);
  }
  if (storedChecksum(bytes) !== plan.design.artifactHash)
    throw portalError('PORTAL_DESIGN_HASH_MISMATCH');
  const input = normalizePortalDesign(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>,
  );
  if (!Array.isArray(input.nodes)) throw portalError('PORTAL_DESIGN_ARTIFACT_UNSUPPORTED');
  const pending: Array<{ value: unknown; parentId: string | null }> = input.nodes
    .map(value => ({ value, parentId: null }))
    .toReversed();
  const nodes: Array<{
    id: string;
    parentId: string | null;
    childIds: string[];
    properties: Record<string, unknown>;
  }> = [];
  const seen = new Set<string>();
  let index = 0,
    selectedBytes = 0;
  while (pending.length) {
    signal.throwIfAborted();
    if (index >= 100_000) throw portalError('PORTAL_DESIGN_NODE_LIMIT');
    const { value, parentId } = pending.pop()!;
    if (!object(value) || typeof value.id !== 'string' || seen.has(value.id))
      throw portalError('PORTAL_DESIGN_NODE_INVALID');
    seen.add(value.id);
    const { children, ...properties } = value;
    const descendants = Array.isArray(children) ? children : [];
    const childIds = descendants.map(child => {
      if (!object(child) || typeof child.id !== 'string')
        throw portalError('PORTAL_DESIGN_NODE_INVALID');
      return child.id;
    });
    if (index >= offset && nodes.length < limit) {
      const row = { id: value.id, parentId, childIds, properties };
      const size = Buffer.byteLength(JSON.stringify(row));
      if (selectedBytes + size > 524_288) throw portalError('PORTAL_DESIGN_PAGE_LIMIT');
      selectedBytes += size;
      nodes.push(row);
    }
    index++;
    for (let at = descendants.length - 1; at >= 0; at--)
      pending.push({ value: descendants[at], parentId: value.id });
  }
  const tokens = catalogPage(Array.isArray(input.tokens) ? input.tokens : [], tokenOffset, signal);
  const collections = catalogPage(
    Array.isArray(input.collections) ? input.collections : [],
    catalogOffsets.collectionOffset ?? 0,
    signal,
  );
  const family = catalogOffsets.styleFamily;
  if (family !== undefined && !['paints', 'texts', 'effects', 'grids'].includes(family))
    throw portalError('PORTAL_DESIGN_STYLE_FAMILY_INVALID');
  const styleCatalog = object(input.styles) ? input.styles : {};
  if (
    family !== undefined &&
    styleCatalog[family] !== undefined &&
    !Array.isArray(styleCatalog[family])
  )
    throw portalError('PORTAL_DESIGN_CATALOG_INVALID');
  const styles =
    family === undefined
      ? null
      : {
          family,
          availability: Array.isArray(styleCatalog[family])
            ? ('available' as const)
            : ('unavailable' as const),
          ...catalogPage(
            Array.isArray(styleCatalog[family]) ? styleCatalog[family] : [],
            catalogOffsets.styleOffset ?? 0,
            signal,
          ),
        };
  return {
    artifactHash: plan.design.artifactHash,
    totalNodes: index,
    nodes,
    nextOffset: offset + nodes.length < index ? offset + nodes.length : null,
    tokens: tokens.rows,
    totalTokens: tokens.total,
    nextTokenOffset: tokens.nextOffset,
    collections: collections.rows,
    totalCollections: collections.total,
    nextCollectionOffset: collections.nextOffset,
    styles,
  };
};

export const readPortalAssets = async (
  plan: PortalPlan,
  store: PortalStore,
  offset: number,
  ids: number[],
  signal: AbortSignal,
) => {
  if (plan.design.storage !== 'owner-state') return null;
  const record = await store.get('designs', plan.planId, PortalCapturedDesignSchema);
  if (
    !record ||
    contentHash('sfp-portal-design-assets-v1', record.assets) !== plan.design.assetManifestHash
  )
    throw portalError('PORTAL_DESIGN_HASH_MISMATCH');
  const reader = new RepoReader({
    rootDir: record.assetRoot,
    signal,
    maxFileBytes: 5_242_880,
    maxTotalBytes: 20_971_520,
  });
  const contents: Array<{ id: number; path: string; hash: string; data: string }> = [];
  for (const id of ids) {
    const asset = record.assets[id];
    if (!asset || asset.status !== 'captured' || !asset.path || !asset.sha256)
      throw portalError('PORTAL_ASSET_NOT_AVAILABLE');
    // eslint-disable-next-line no-await-in-loop -- bounded hash-bound artifact reads from the signed capture root
    const bytes = await reader.readBytes(asset.path);
    if (storedChecksum(bytes) !== asset.sha256) throw portalError('PORTAL_ASSET_CHANGED');
    contents.push({
      id,
      path: asset.path,
      hash: asset.sha256,
      data: Buffer.from(bytes).toString('base64'),
    });
  }
  return {
    totalAssets: record.assets.length,
    nextOffset: offset + 100 < record.assets.length ? offset + 100 : null,
    inventory: record.assets
      .slice(offset, offset + 100)
      .map((asset, index) => Object.assign({ id: offset + index }, asset)),
    contents,
  };
};
