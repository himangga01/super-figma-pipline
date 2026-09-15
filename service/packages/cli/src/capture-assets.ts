import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Page } from 'playwright';
import type { z } from 'zod';

import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';
import { RepoReader } from '../../mcp/src/fs/repo-walk.js';
import {
  normalizeDesignObservation,
  planDesignImageReferences,
} from '../../mcp/src/portal/design-normalization.js';
import type { AssetQuerySchema } from './asset-program.js';
import type { FigmaTarget } from './figma-url.js';
import type { BrowserNode } from './scripter-bridge.js';
import { readScripterAsset } from './scripter-bridge.js';
import { equivalentVisibleVectorSources } from './vector-export-source.js';

type Query = z.infer<typeof AssetQuerySchema>;
export interface CapturedAsset {
  query: Query;
  status: 'captured' | 'unavailable' | 'pending';
  path?: string | undefined;
  sha256?: string | undefined;
  bytes?: number | undefined;
  reason?: string | undefined;
  exportedFrom?: { nodeId: string; geometryHash: string } | undefined;
}
export const captureBrowserAssets = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  nodes: BrowserNode[],
  folder: string,
  options: {
    deadlineAt?: number;
    signal?: AbortSignal;
    maxAssets?: number;
    previous?: CapturedAsset[];
    renderingComplete?: boolean;
    retryUnavailable?: boolean;
    maxTotalBytes?: number;
  } = {},
): Promise<CapturedAsset[]> => {
  return captureDesignAssets(
    nodes,
    folder,
    query => readScripterAsset(page, target, query, options),
    options,
  );
};

export const captureDesignAssets = async (
  nodes: BrowserNode[],
  folder: string,
  readAsset: (query: Query) => Promise<Buffer>,
  options: {
    deadlineAt?: number;
    signal?: AbortSignal;
    maxAssets?: number;
    previous?: CapturedAsset[];
    renderingComplete?: boolean;
    retryUnavailable?: boolean;
    maxTotalBytes?: number;
  } = {},
): Promise<CapturedAsset[]> => {
  const queue: Query[] = nodes.map(node => ({ kind: 'png', nodeId: node.id }));
  const equivalentSources =
    options.renderingComplete === true ? equivalentVisibleVectorSources(nodes) : new Map();
  const hashes = new Set(
    planDesignImageReferences(
      normalizeDesignObservation({
        source: 'figma-plugin-api-via-scripter',
        nodes,
        tokens: [],
        collections: [],
      }),
    ).map(usage => usage.imageHash),
  );
  const vectors: Query[] = [];
  const walk = (node: BrowserNode) => {
    if (['VECTOR', 'BOOLEAN_OPERATION'].includes(node.type))
      vectors.push({ kind: 'svg', nodeId: node.id });
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  queue.push(...[...hashes].map(imageHash => ({ kind: 'image' as const, imageHash })));
  queue.push(...vectors);
  if (queue.length > 100_000) throw new Error('ASSET_CAPTURE_RECORD_LIMIT');
  const maxTotalBytes = options.maxTotalBytes ?? 536_870_912;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 536_870_912)
    throw new Error('ASSET_CAPTURE_LIMIT_INVALID');
  if (queue.length === 0) return [];
  const maxAssets = options.maxAssets ?? 64;
  if (!Number.isSafeInteger(maxAssets) || maxAssets < 1 || maxAssets > 256)
    throw new Error('ASSET_CAPTURE_LIMIT_INVALID');
  await mkdir(join(folder, 'assets'), { recursive: true });
  const results: CapturedAsset[] = [],
    files = new AtomicFileStore();
  const svgBytes = new Map<string, Buffer>();
  let total = 0,
    retained = 0,
    attempted = 0;
  const priorReader = new RepoReader({
    rootDir: folder,
    ...(options.signal ? { signal: options.signal } : {}),
    maxFileBytes: 16_777_216,
    maxTotalBytes: 536_870_912,
  });
  const verifiedPrior = new Set<number>();
  for (const [index, query] of queue.entries()) {
    const previous = options.previous?.[index];
    if (
      previous?.status !== 'captured' ||
      !previous.path ||
      !previous.sha256 ||
      (previous.exportedFrom && options.renderingComplete !== true) ||
      JSON.stringify(previous.query) !== JSON.stringify(query)
    )
      continue;
    // eslint-disable-next-line no-await-in-loop -- verify all prior bytes before allocating any new asset
    const bytes = await priorReader.readBytes(previous.path);
    if (
      previous.bytes !== bytes.length ||
      'sha256:' + createHash('sha256').update(bytes).digest('hex') !== previous.sha256
    )
      throw new Error('ASSET_CAPTURE_CHANGED');
    retained += bytes.length;
    if (retained > maxTotalBytes) throw new Error('ASSET_CAPTURE_TOTAL_LIMIT');
    verifiedPrior.add(index);
  }
  for (const [index, query] of queue.entries()) {
    options.signal?.throwIfAborted();
    const previous = options.previous?.[index];
    if (
      previous?.status === 'unavailable' &&
      options.retryUnavailable === false &&
      JSON.stringify(previous.query) === JSON.stringify(query)
    ) {
      results.push(previous);
      continue;
    }
    if (
      previous?.status === 'captured' &&
      previous.path &&
      previous.sha256 &&
      (!previous.exportedFrom || options.renderingComplete === true) &&
      JSON.stringify(previous.query) === JSON.stringify(query)
    ) {
      if (!verifiedPrior.has(index)) throw new Error('ASSET_CAPTURE_CHANGED');
      results.push(previous);
      continue;
    }
    if (Date.now() >= (options.deadlineAt ?? Infinity)) {
      results.push({ query, status: 'pending', reason: 'ASSET_CAPTURE_TIMEOUT' });
      continue;
    }
    if (attempted >= maxAssets || total >= 64_000_000) {
      results.push({ query, status: 'pending', reason: 'ASSET_CAPTURE_BUDGET' });
      continue;
    }
    attempted++;
    try {
      const exportedFrom = query.kind === 'svg' ? equivalentSources.get(query.nodeId) : undefined;
      const exportQuery = exportedFrom
        ? { kind: 'svg' as const, nodeId: exportedFrom.nodeId }
        : query;
      const cached = exportQuery.kind === 'svg' ? svgBytes.get(exportQuery.nodeId) : undefined;
      // eslint-disable-next-line no-await-in-loop -- Figma exports run sequentially under a fixed capture budget
      const bytes = cached ?? (await readAsset(exportQuery));
      if (retained + bytes.length > maxTotalBytes) throw new Error('ASSET_CAPTURE_TOTAL_LIMIT');
      if (exportQuery.kind === 'svg') svgBytes.set(exportQuery.nodeId, bytes);
      if (total + bytes.length > 64_000_000) {
        results.push({ query, status: 'pending', reason: 'ASSET_CAPTURE_BUDGET' });
        continue;
      }
      total += bytes.length;
      retained += bytes.length;
      const digest = createHash('sha256').update(bytes).digest('hex');
      const suffix =
        query.kind === 'image'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? 'png'
            : bytes[0] === 255 && bytes[1] === 216
              ? 'jpg'
              : 'bin'
          : query.kind;
      const path = `assets/${index}-${digest.slice(0, 16)}.${suffix}`;
      // eslint-disable-next-line no-await-in-loop -- create only after the exact asset is verified
      try {
        // eslint-disable-next-line no-await-in-loop -- publish a content-addressed asset
        await files.createNew(join(folder, path), bytes);
      } catch (error) {
        // Recover exact bytes published before an interrupted progress checkpoint.
        // eslint-disable-next-line no-await-in-loop -- recovery never overwrites an existing asset
        const existing = await priorReader.readBytes(path).catch(() => null);
        if (!existing || !Buffer.from(existing).equals(bytes)) throw error;
      }
      results.push({
        query,
        status: 'captured',
        path,
        sha256: `sha256:${digest}`,
        bytes: bytes.length,
        ...(exportedFrom ? { exportedFrom } : {}),
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof Error && error.message.includes('BROWSER_TARGET_CHANGED')) throw error;
      if (error instanceof Error && error.message === 'ASSET_CAPTURE_TOTAL_LIMIT') throw error;
      results.push({ query, status: 'unavailable', reason: 'ASSET_READ_FAILED' });
    }
  }
  return results;
};
