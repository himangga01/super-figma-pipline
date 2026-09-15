import { createHash } from 'node:crypto';

import type { Page } from 'playwright';

import type { FigmaTarget } from './figma-url.js';
import { BrowserReadQuerySchema } from './read-program.js';
import { readScripterDesign, type BrowserNode } from './scripter-bridge.js';

type Query = ReturnType<typeof BrowserReadQuerySchema.parse>;
interface PendingScope {
  nodeId: string | null;
  mode: Query['mode'];
  offset: number;
  depth: number;
  reason: string;
}
type Work =
  | { kind: 'node'; id: string; depth: number; parent?: BrowserNode }
  | { kind: 'children'; node: BrowserNode; depth: number; offset: number };

const countNodes = (items: BrowserNode[]): number =>
  items.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read and resume bounded subtrees, preserving partial results and every unfinished scope. */
export const readScripterSnapshot = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown,
  options: { deadlineAt?: number; signal?: AbortSignal } = {},
) => {
  return readDesignSnapshot(
    target,
    input,
    args => readScripterDesign(page, target, args, options),
    options,
  );
};

/** Shared bounded continuation and full ordered reobservation, independent of transport. */
export const readDesignSnapshot = async (
  target: Readonly<FigmaTarget>,
  input: unknown,
  readQuery: (input: Query) => ReturnType<typeof readScripterDesign>,
  options: { deadlineAt?: number; signal?: AbortSignal } = {},
) => {
  const query = BrowserReadQuerySchema.parse(input);
  const startedAt = new Date().toISOString();
  const pendingScopes: PendingScope[] = [];
  const warnings: unknown[] = [];
  let calls = 0,
    bytes = 0,
    valueTruncated = false;
  const observations: Array<{ args: Partial<Query>; hash: string }> = [];
  let rechecking = false;
  const read = async (args: Partial<Query>) => {
    options.signal?.throwIfAborted();
    if (Date.now() >= (options.deadlineAt ?? Infinity)) throw new Error('SNAPSHOT_READ_BUDGET');
    if (calls >= 256 || bytes >= 12_000_000) throw new Error('SNAPSHOT_READ_BUDGET');
    calls++;
    const result = await readQuery({ ...query, ...args });
    const size = Buffer.byteLength(JSON.stringify(result));
    if (bytes + size > 12_000_000) throw new Error('SNAPSHOT_READ_BUDGET');
    bytes += size;
    valueTruncated ||= result.valueTruncated;
    if (!rechecking) {
      warnings.push(...result.warnings.slice(0, Math.max(0, 1024 - warnings.length)));
      observations.push({ args, hash: digest(result) });
    }
    return result;
  };
  const overview = await read({ mode: 'roots', includeTokens: false, offset: 0 });
  const assertPage = (result: Awaited<ReturnType<typeof read>>) => {
    if (overview.scopeType !== 'DOCUMENT' && result.pageId !== overview.pageId)
      throw new Error('BROWSER_PAGE_CHANGED');
  };
  const assertRoots = (result: Awaited<ReturnType<typeof read>>) => {
    assertPage(result);
    if (JSON.stringify(result.rootIds) !== JSON.stringify(overview.rootIds))
      throw new Error('BROWSER_SCOPE_CHANGED');
  };
  const roots = [...overview.nodes];
  let next = overview.nextRootOffset;
  while (next !== null) {
    const offset = next;
    try {
      // eslint-disable-next-line no-await-in-loop -- a page cursor belongs to this exact root scope
      const result = await read({ mode: 'roots', includeTokens: false, offset });
      assertRoots(result);
      if (result.nextRootOffset !== null && result.nextRootOffset !== offset + result.nodes.length)
        throw new Error('BROWSER_CURSOR_INVALID');
      if (
        JSON.stringify(result.nodes.map(node => node.id)) !==
        JSON.stringify(overview.rootIds.slice(offset, offset + result.nodes.length))
      )
        throw new Error('BROWSER_SCOPE_CHANGED');
      roots.push(...result.nodes);
      next = result.nextRootOffset;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'SNAPSHOT_READ_BUDGET') throw error;
      pendingScopes.push({
        nodeId: query.nodeId ?? overview.scopeNodeId,
        mode: 'roots',
        offset,
        depth: query.depth,
        reason: error.message,
      });
      break;
    }
  }
  const tokens: unknown[] = [],
    collections: unknown[] = [];
  const styles = {
    paints: [] as unknown[],
    texts: [] as unknown[],
    effects: [] as unknown[],
    grids: [] as unknown[],
  };
  const catalogs = structuredClone(overview.catalogs);
  if (query.includeTokens) {
    const families = [
      ['variables', 'tokenOffset', tokens],
      ['collections', 'collectionOffset', collections],
      ['paintStyles', 'paintOffset', styles.paints],
      ['textStyles', 'textOffset', styles.texts],
      ['effectStyles', 'effectOffset', styles.effects],
      ['gridStyles', 'gridOffset', styles.grids],
    ] as const;
    const offsets = {
      tokenOffset: 0,
      collectionOffset: 0,
      paintOffset: 0,
      textOffset: 0,
      effectOffset: 0,
      gridOffset: 0,
    };
    const done = new Set<string>();
    const lossy = new Set<string>();
    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop -- independent cursors advance within the same catalog observation
        const result = await read({ mode: 'tokens', includeTokens: true, ...offsets });
        assertPage(result);
        const rows = {
          variables: result.tokens,
          collections: result.collections,
          paintStyles: result.styles.paints,
          textStyles: result.styles.texts,
          effectStyles: result.styles.effects,
          gridStyles: result.styles.grids,
        };
        for (const [family, offsetKey, output] of families) {
          if (done.has(family)) continue;
          const status = result.catalogs[family];
          if (catalogs[family].count !== null && status.count !== catalogs[family].count)
            throw new Error('BROWSER_CATALOG_CHANGED');
          const ids = new Set(output.map(row => (row as { id: string }).id));
          for (const row of rows[family]) {
            const id = (row as { id: string }).id;
            if (typeof id !== 'string' || ids.has(id)) throw new Error('BROWSER_CATALOG_CHANGED');
            ids.add(id);
          }
          output.push(...rows[family]);
          if (status.valueTruncated) lossy.add(family);
          catalogs[family] =
            lossy.has(family) && status.state === 'complete'
              ? { ...status, state: 'partial', valueTruncated: true }
              : status;
          if (status.nextOffset === null) {
            done.add(family);
            offsets[offsetKey] = status.count ?? 0;
          } else {
            if (
              status.nextOffset !== offsets[offsetKey] + rows[family].length ||
              status.nextOffset <= offsets[offsetKey]
            )
              throw new Error('BROWSER_CURSOR_INVALID');
            offsets[offsetKey] = status.nextOffset;
          }
        }
        if (done.size === families.length) break;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'SNAPSHOT_READ_BUDGET') throw error;
        for (const [family] of families)
          if (!done.has(family)) catalogs[family] = { ...catalogs[family], state: 'partial' };
        pendingScopes.push({
          nodeId: query.nodeId ?? overview.scopeNodeId,
          mode: 'tokens',
          offset: offsets.tokenOffset,
          depth: 0,
          reason: error.message,
        });
        break;
      }
    }
  }
  const nodes: BrowserNode[] = [];
  const queue: Work[] = roots.map(node => ({ kind: 'node', id: node.id, depth: query.depth }));
  const gaps = (node: BrowserNode, remaining: number): void => {
    if ((node.omittedChildren ?? 0) > 0) {
      if (remaining > 0)
        queue.push({
          kind: 'children',
          node,
          depth: remaining - 1,
          offset: node.children?.length ?? 0,
        });
      else
        pendingScopes.push({
          nodeId: node.id,
          mode: 'roots',
          offset: node.children?.length ?? 0,
          depth: 0,
          reason: 'DEPTH_LIMIT',
        });
    }
    for (const child of node.children ?? []) gaps(child, remaining - 1);
  };
  const unfinished = (work: Work, reason: string) =>
    pendingScopes.push({
      nodeId: work.kind === 'node' ? work.id : work.node.id,
      mode: work.kind === 'node' ? 'tree' : 'roots',
      offset: work.kind === 'node' ? 0 : work.offset,
      depth: work.depth,
      reason,
    });
  while (queue.length > 0) {
    const work = queue.shift()!;
    try {
      if (work.kind === 'children') {
        // eslint-disable-next-line no-await-in-loop -- append children from the same bounded parent cursor
        const result = await read({
          mode: 'roots',
          nodeId: work.node.id,
          childrenOnly: true,
          offset: work.offset,
          includeTokens: false,
        });
        assertPage(result);
        if (JSON.stringify(result.rootIds) !== JSON.stringify(work.node.childIds))
          throw new Error('BROWSER_SCOPE_CHANGED');
        if (
          result.nextRootOffset !== null &&
          result.nextRootOffset !== work.offset + result.nodes.length
        )
          throw new Error('BROWSER_CURSOR_INVALID');
        if (
          JSON.stringify(result.nodes.map(node => node.id)) !==
          JSON.stringify(result.rootIds.slice(work.offset, work.offset + result.nodes.length))
        )
          throw new Error('BROWSER_SCOPE_CHANGED');
        queue.push(
          ...result.nodes.map(child => ({
            kind: 'node' as const,
            id: child.id,
            depth: work.depth,
            parent: work.node,
          })),
        );
        if (result.nextRootOffset !== null) queue.push({ ...work, offset: result.nextRootOffset });
      } else {
        let result;
        try {
          // eslint-disable-next-line no-await-in-loop -- one Scripter execution at a time
          result = await read({
            mode: 'tree',
            nodeId: work.id,
            depth: work.depth,
            includeTokens: false,
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes('BROWSER_DESIGN_RESULT_TOO_LARGE') ||
            work.depth === 0
          )
            throw error;
          // eslint-disable-next-line no-await-in-loop -- re-read only the root, then descend through its children
          result = await read({ mode: 'tree', nodeId: work.id, depth: 0, includeTokens: false });
        }
        assertPage(result);
        const node = result.nodes[0];
        if (node === undefined || node.id !== work.id) throw new Error('BROWSER_NODE_MISMATCH');
        if (work.parent === undefined) nodes.push(node);
        else {
          (work.parent.children ??= []).push(node);
          work.parent.omittedChildren = Math.max(0, (work.parent.omittedChildren ?? 0) - 1);
          if (work.parent.omittedChildren === 0) {
            delete work.parent.omittedChildren;
            delete work.parent.omissionReason;
          }
        }
        gaps(node, work.depth);
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'SNAPSHOT_READ_BUDGET') throw error;
      unfinished(work, error.message);
      for (const rest of queue) unfinished(rest, error.message);
      break;
    }
  }
  const referenceIssues: Array<{ family: string; id: string; status: string }> = [];
  const attemptedReferences = new Set<string>();
  const scanReferences = () => {
    const wanted = {
      variables: new Set<string>(),
      collections: new Set<string>(),
      styles: new Set<string>(),
    };
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const row = value as Record<string, unknown>;
      if (row.type === 'VARIABLE_ALIAS' && typeof row.id === 'string') wanted.variables.add(row.id);
      if (typeof row.variableCollectionId === 'string')
        wanted.collections.add(row.variableCollectionId);
      for (const [key, child] of Object.entries(row)) {
        if (
          ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'gridStyleId', 'textStyleId'].includes(
            key,
          ) &&
          typeof child === 'string' &&
          child
        ) {
          if (child !== 'mixed') wanted.styles.add(child);
          else if (
            !Array.isArray(row.textSegments) ||
            row.textSegments.length === 0 ||
            !row.textSegments.every(
              segment =>
                segment &&
                typeof segment === 'object' &&
                typeof (segment as Record<string, unknown>)[key] === 'string' &&
                (segment as Record<string, unknown>)[key] !== 'mixed',
            )
          ) {
            const id = 'mixed:' + String(row.id ?? 'segment') + ':' + key;
            if (!referenceIssues.some(issue => issue.id === id))
              referenceIssues.push({ family: 'styles', id, status: 'unsupported' });
          }
        }
        visit(child);
      }
    };
    visit({ nodes, tokens, styles });
    const existing = { variables: tokens, collections, styles: Object.values(styles).flat() };
    return Object.fromEntries(
      Object.entries(wanted).map(([family, ids]) => {
        const known = new Set(
          existing[family as keyof typeof existing].map(row => (row as { id: string }).id),
        );
        return [
          family,
          [...ids]
            .filter(id => !known.has(id) && !attemptedReferences.has(family + '/' + id))
            .toSorted(),
        ];
      }),
    ) as Record<'variables' | 'collections' | 'styles', string[]>;
  };
  for (let round = 0; round < 32; round++) {
    const wanted = scanReferences();
    if (!Object.values(wanted).some(ids => ids.length)) break;
    if (
      Object.values(wanted).reduce((n, ids) => n + ids.length, 0) + attemptedReferences.size >
      10000
    ) {
      referenceIssues.push({ family: 'closure', id: 'budget', status: 'partial' });
      break;
    }
    const selected = Object.fromEntries(
      Object.entries(wanted).map(([family, ids]) => [family, ids.slice(0, 256)]),
    ) as typeof wanted;
    for (const [family, ids] of Object.entries(selected))
      for (const id of ids) attemptedReferences.add(family + '/' + id);
    try {
      // eslint-disable-next-line no-await-in-loop -- dependency IDs arise from the prior bounded read
      const result = await read({
        mode: 'references',
        includeTokens: false,
        variableIds: selected.variables,
        collectionIds: selected.collections,
        styleIds: selected.styles,
      });
      assertPage(result);
      if (!result.references) {
        referenceIssues.push({ family: 'closure', id: 'reader', status: 'unsupported' });
        break;
      }
      tokens.push(...result.references.variables);
      collections.push(...result.references.collections);
      for (const unknown of result.references.styles) {
        const row = unknown as { type?: string; layoutGrids?: unknown };
        const family = (
          { PAINT: 'paints', TEXT: 'texts', EFFECT: 'effects', GRID: 'grids' } as const
        )[row.type as 'PAINT'];
        if (family)
          styles[family].push(row.type === 'GRID' ? { ...row, grids: row.layoutGrids } : row);
        else referenceIssues.push({ family: 'styles', id: 'type', status: 'unsupported' });
      }
      referenceIssues.push(...result.references.unresolved);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'SNAPSHOT_READ_BUDGET') throw error;
      referenceIssues.push({ family: 'closure', id: 'budget', status: 'partial' });
      break;
    }
  }
  const remaining = scanReferences();
  if (Object.values(remaining).some(ids => ids.length))
    referenceIssues.push({ family: 'closure', id: 'continuation', status: 'partial' });
  const unresolvedVariableIds = referenceIssues
    .filter(issue => issue.family === 'variables')
    .map(issue => issue.id);
  let reobserved = false;
  rechecking = true;
  try {
    for (const observed of observations) {
      // eslint-disable-next-line no-await-in-loop -- a final ordered pass checks all earlier successful scopes
      const result = await read(observed.args);
      if (digest(result) !== observed.hash) throw new Error('BROWSER_CONTENT_CHANGED');
    }
    reobserved = true;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'SNAPSHOT_READ_BUDGET') throw error;
    pendingScopes.push({
      nodeId: query.nodeId ?? overview.scopeNodeId,
      mode: 'roots',
      offset: 0,
      depth: 0,
      reason: 'REOBSERVATION_BUDGET',
    });
  }
  return {
    schemaVersion: 1,
    source: overview.source,
    requestedUrl: target.url,
    requestedNodeId: query.nodeId,
    fileName: overview.fileName,
    pageId: overview.pageId,
    pageName: overview.pageName,
    scopeNodeId: overview.scopeNodeId,
    scopeType: overview.scopeType,
    nodes,
    tokens,
    collections,
    styles,
    catalogs,
    observation: {
      version: 1,
      method: 'ordered-query-reobservation',
      atomic: false,
      reobserved,
      readComplete:
        reobserved &&
        !valueTruncated &&
        pendingScopes.length === 0 &&
        (!query.includeTokens ||
          Object.values(catalogs).every(status => ['complete', 'empty'].includes(status.state))) &&
        referenceIssues.length === 0,
      queryCount: observations.length,
      contentHash: digest({
        source: target.url,
        pageId: overview.pageId,
        scopeNodeId: overview.scopeNodeId,
        requestedDepth: query.depth,
        rootIds: overview.rootIds,
        nodes,
        tokens,
        collections,
        styles,
        catalogs,
      }),
      capabilities: Object.entries(catalogs).map(([name, status]) => ({
        name,
        status: status.state,
        count: status.count,
      })),
      referencedClosure: {
        status: referenceIssues.length ? 'partial' : 'complete',
        issues: referenceIssues,
      },
      referencedVariables: {
        status:
          unresolvedVariableIds.length > 0
            ? 'unsupported'
            : query.includeTokens &&
                ['complete', 'empty'].includes(catalogs.variables.state) &&
                !valueTruncated &&
                pendingScopes.length === 0
              ? 'complete'
              : 'partial',
        unresolvedVariableIds,
      },
      limits: { calls: 256, bytes: 12000000 },
    },
    nodeCount: countNodes(nodes),
    sectionCount: nodes.length,
    pendingRootIds: [
      ...new Set(
        pendingScopes.map(scope => scope.nodeId).filter((id): id is string => id !== null),
      ),
    ],
    pendingScopes,
    truncated: valueTruncated || pendingScopes.length > 0,
    warnings,
    coverage: overview.coverage,
    capture: { startedAt, finishedAt: new Date().toISOString(), calls, bytes, atomic: false },
  };
};
