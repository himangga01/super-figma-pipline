import { createHash } from 'node:crypto';

import { canonicalJson, contentHash } from '@sfp/ir';
import { canonicalFileIdentityHash } from '@sfp/shared';
import { z } from 'zod';

import { RepoReader } from '../../mcp/src/fs/repo-walk.js';
import { AssetQuerySchema } from './asset-program.js';
import { parseFigmaTarget } from './figma-url.js';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CAPTURE_COMPARISON_INVALID');
  return value as Row;
};
const sourceKinds = new Set([
  'figma-web-page-api',
  'figma-plugin-api-via-scripter',
  'figma-desktop-plugin',
  'figma-plugin-api-pinned',
  'official-figma-mcp',
]);
// Exclude only named transport metadata; future observed facts must remain visible.
const transportKeys = new Set([
  'source',
  'requestedUrl',
  'nodes',
  'observation',
  'capture',
  'pageApiObservation',
]);
const observationTransportKeys = new Set(['contentHash', 'queryCount', 'limits']);
const nodeId = /^I?\d+:\d+(?:;I?\d+:\d+)*$/u;

function snapshot(input: unknown) {
  // Validate finite plain JSON and bound nesting before traversing caller-provided records.
  canonicalJson(input);
  const value = row(input);
  if (
    value.schemaVersion !== 1 ||
    !sourceKinds.has(String(value.source)) ||
    typeof value.requestedUrl !== 'string' ||
    !Array.isArray(value.nodes) ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.pendingScopes) ||
    !Array.isArray(value.pendingRootIds)
  )
    throw new Error('CAPTURE_COMPARISON_INVALID');
  const target = parseFigmaTarget(value.requestedUrl);
  for (const key of ['requestedNodeId', 'pageId', 'scopeNodeId'])
    if (typeof value[key] !== 'string' || !nodeId.test(value[key] as string))
      throw new Error('CAPTURE_COMPARISON_INVALID');
  if (
    target.nodeId !== value.requestedNodeId ||
    value.requestedNodeId !== value.scopeNodeId ||
    (value.scopeType === 'PAGE' && value.scopeNodeId !== value.pageId)
  )
    throw new Error('CAPTURE_COMPARISON_SCOPE_MISMATCH');
  const entries = new Map<string, unknown>();
  const stack = value.nodes
    .map((item, index) => ({ item, parent: null as string | null, index, depth: 0 }))
    .toReversed();
  while (stack.length) {
    const work = stack.pop()!,
      node = row(work.item);
    if (
      typeof node.id !== 'string' ||
      node.id.length > 512 ||
      !nodeId.test(node.id) ||
      entries.has(node.id)
    )
      throw new Error('CAPTURE_NODE_ID_INVALID');
    if (work.depth > 128 || entries.size >= 100_000) throw new Error('CAPTURE_COMPARISON_LIMIT');
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error('CAPTURE_COMPARISON_INVALID');
    const children = (node.children ?? []) as unknown[];
    entries.set(node.id, {
      properties: Object.fromEntries(
        Object.entries(node).filter(([key]) => !['id', 'children'].includes(key)),
      ),
      parentId: work.parent,
      index: work.index,
      childIds: children.map(child => row(child).id),
    });
    for (let i = children.length - 1; i >= 0; i--)
      stack.push({ item: children[i], parent: node.id, index: i, depth: work.depth + 1 });
  }
  if (value.nodeCount !== entries.size) throw new Error('CAPTURE_NODE_COUNT_INVALID');
  const observation = row(value.observation);
  return {
    value,
    target,
    nodeCount: entries.size,
    complete:
      value.truncated === false &&
      value.pendingScopes.length === 0 &&
      value.pendingRootIds.length === 0 &&
      observation.readComplete === true &&
      observation.reobserved === true,
    facts: {
      document: Object.fromEntries(
        Object.entries(value).filter(([key]) => !transportKeys.has(key)),
      ),
      observation: Object.fromEntries(
        Object.entries(observation).filter(([key]) => !observationTransportKeys.has(key)),
      ),
      tree: { rootIds: value.nodes.map(node => row(node).id), nodes: Object.fromEntries(entries) },
    },
  };
}

const AssetSchema = z
  .object({
    query: AssetQuerySchema,
    status: z.enum(['captured', 'pending', 'unavailable']),
    path: z.string().optional(),
    sha256: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    bytes: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
    exportedFrom: z.object({ nodeId: z.string(), geometryHash: z.string() }).strict().optional(),
  })
  .strict();
export interface VerifiedCaptureAssets {
  records: Record<string, unknown>;
  count: number;
  verifiedFiles: number;
  allCaptured: boolean;
}

/** Hash files under an explicit source capture root before comparing manifest claims. */
export async function verifyCaptureAssets(
  input: unknown,
  rootDir: string,
): Promise<VerifiedCaptureAssets> {
  const assets = z.array(AssetSchema).max(100_000).parse(input);
  const reader = new RepoReader({ rootDir, maxFileBytes: 16_777_216, maxTotalBytes: 536_870_912 });
  const records: Record<string, unknown> = Object.create(null);
  let verifiedFiles = 0;
  for (const asset of assets) {
    const key = canonicalJson(asset.query);
    if (Object.hasOwn(records, key)) throw new Error('CAPTURE_ASSET_DUPLICATE');
    if (asset.status === 'captured') {
      if (!asset.path || !asset.sha256 || asset.bytes === undefined)
        throw new Error('CAPTURE_ASSET_INVALID');
      // eslint-disable-next-line no-await-in-loop -- verify each retained file within the aggregate byte budget
      const bytes = await reader.readBytes(asset.path);
      if (
        bytes.length !== asset.bytes ||
        'sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.sha256
      )
        throw new Error('CAPTURE_ASSET_BYTES_CHANGED');
      verifiedFiles++;
    }
    const { path: _path, ...facts } = asset;
    records[key] = facts;
  }
  return {
    records,
    count: assets.length,
    verifiedFiles,
    allCaptured: verifiedFiles === assets.length,
  };
}

/** Exact observed facts, including geometry and metadata outside the native conversion subset. */
export function compareCaptureFacts(
  actual: unknown,
  reference: unknown,
  actualAssets?: VerifiedCaptureAssets,
  referenceAssets?: VerifiedCaptureAssets,
) {
  const a = snapshot(actual),
    b = snapshot(reference);
  if (
    a.target.fileKey !== b.target.fileKey ||
    ['requestedNodeId', 'pageId', 'scopeNodeId', 'scopeType'].some(
      key => a.value[key] !== b.value[key],
    )
  )
    throw new Error('CAPTURE_COMPARISON_SCOPE_MISMATCH');
  if (Boolean(actualAssets) !== Boolean(referenceAssets))
    throw new Error('CAPTURE_COMPARISON_ASSETS_REQUIRED');
  let comparedPositions = 0,
    differenceCount = 0,
    visited = 0;
  const differences: Array<{
    path: string;
    actualHash: string | null;
    referenceHash: string | null;
  }> = [];
  const compare = (
    left: unknown,
    right: unknown,
    path: string,
    hasLeft = true,
    hasRight = true,
    depth = 0,
  ): void => {
    if (++visited > 2_000_000 || depth > 128) throw new Error('CAPTURE_COMPARISON_LIMIT');
    if (hasLeft && hasRight && Array.isArray(left) && Array.isArray(right)) {
      if (left.length === 0 && right.length === 0) {
        comparedPositions++;
        return;
      }
      for (let i = 0; i < Math.max(left.length, right.length); i++)
        compare(left[i], right[i], path + '/' + i, i < left.length, i < right.length, depth + 1);
      return;
    }
    if (
      hasLeft &&
      hasRight &&
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const l = row(left),
        r = row(right),
        keys = [...new Set([...Object.keys(l), ...Object.keys(r)])].toSorted();
      if (!keys.length) {
        comparedPositions++;
        return;
      }
      for (const key of keys)
        compare(
          l[key],
          r[key],
          path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
          Object.hasOwn(l, key),
          Object.hasOwn(r, key),
          depth + 1,
        );
      return;
    }
    comparedPositions++;
    if (hasLeft !== hasRight || left !== right) {
      differenceCount++;
      if (differences.length < 200)
        differences.push({
          path,
          actualHash: hasLeft ? contentHash('sfp-compared-value', left) : null,
          referenceHash: hasRight ? contentHash('sfp-compared-value', right) : null,
        });
    }
  };
  compare(a.facts, b.facts, '/facts');
  const factDifferences = differenceCount;
  if (actualAssets && referenceAssets)
    compare(actualAssets.records, referenceAssets.records, '/assets');
  return {
    schemaVersion: 1,
    kind: 'sfp-read-comparison',
    scope: {
      fileKeyHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: a.target.fileKey }),
      requestedNodeId: a.value.requestedNodeId,
      pageId: a.value.pageId,
      scopeNodeId: a.value.scopeNodeId,
    },
    actualSnapshotHash: contentHash('sfp-read-snapshot-v1', actual),
    referenceSnapshotHash: contentHash('sfp-read-snapshot-v1', reference),
    actualFactsHash: contentHash('sfp-read-facts-v1', a.facts),
    referenceFactsHash: contentHash('sfp-read-facts-v1', b.facts),
    actualAssetsHash: actualAssets
      ? contentHash('sfp-verified-asset-facts-v1', actualAssets.records)
      : null,
    referenceAssetsHash: referenceAssets
      ? contentHash('sfp-verified-asset-facts-v1', referenceAssets.records)
      : null,
    actualSource: a.value.source,
    referenceSource: b.value.source,
    actualNodes: a.nodeCount,
    referenceNodes: b.nodeCount,
    inputsReportComplete: a.complete && b.complete,
    observedFactsEqual: factDifferences === 0,
    verifiedAssetBytesEqual: Boolean(
      actualAssets &&
      referenceAssets &&
      actualAssets.allCaptured &&
      referenceAssets.allCaptured &&
      differenceCount === factDifferences,
    ),
    assetCount: actualAssets?.count ?? 0,
    comparedPositions,
    differenceCount,
    factDifferences,
    assetDifferences: differenceCount - factDifferences,
    differences,
    differencesTruncated: differenceCount > differences.length,
    fullCaptureAccepted: false,
    limitation:
      'Exact recorded facts and verified asset bytes only. Separate source observations are not atomic; portal capture admission, freshness and frontend acceptance remain separate gates.',
  };
}
