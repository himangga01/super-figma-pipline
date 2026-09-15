import {
  canonicalJson,
  contentHash,
  groundingGraphContentHash,
  GroundingGraphV1Schema,
  storedChecksum,
  type GroundingGraphV1,
} from '@sfp/ir';

import type { RepoReader } from '../fs/repo-walk.js';

/**
 * Refresh source validity; an unchanged fuzzy mapping is still a candidate, not a visual
 * verification.
 */
export const refreshGroundingGraph = async (
  input: GroundingGraphV1,
  reader: RepoReader,
  signal: AbortSignal,
) => {
  const before = GroundingGraphV1Schema.parse(input);
  const graph = structuredClone(before);
  graph.graphVersion++;
  graph.baseGraphContentHash = before.contentHash;
  graph.refreshedAt = new Date().toISOString();
  const files = new Map<string, string | null>();
  let checkedCodeRefs = 0;
  for (const edge of graph.edges) {
    let stale = false;
    for (const evidence of edge.evidence) {
      for (const ref of evidence.refs) {
        signal.throwIfAborted();
        if (ref.kind !== 'repo-range') continue;
        checkedCodeRefs++;
        if (!files.has(ref.path)) {
          try {
            // eslint-disable-next-line no-await-in-loop -- each path is bounded and revalidated by RepoReader
            const bytes = await reader.readBytes(ref.path);
            files.set(
              ref.path,
              new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
            );
          } catch (error) {
            if (
              typeof error !== 'object' ||
              error === null ||
              !('code' in error) ||
              error.code !== 'REPO_FILE_NOT_FOUND'
            )
              throw error;
            files.set(ref.path, null);
          }
        }
        const text = files.get(ref.path);
        const lines = text?.split('\n');
        const hash =
          lines === undefined || ref.endLine > lines.length
            ? null
            : storedChecksum(lines.slice(ref.startLine - 1, ref.endLine).join('\n'));
        if (hash !== ref.contentHash) stale = true;
        if (evidence.source === 'automatic' && hash !== null) ref.contentHash = hash;
      }
      if (evidence.source === 'automatic') {
        evidence.refs.sort((a, b) =>
          canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0,
        );
        evidence.baseVersion = graph.graphVersion;
        evidence.verifiedAt = graph.refreshedAt;
        const { evidenceHash: _oldHash, ...contents } = evidence;
        evidence.evidenceHash = contentHash('sfp-grounding-evidence-v1', contents);
      }
    }
    if (stale) edge.state = 'stale';
    edge.evidence.sort((a, b) => {
      const left = `${a.source}\0${a.evidenceHash}\0${a.verifiedAt}`,
        right = `${b.source}\0${b.evidenceHash}\0${b.verifiedAt}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  graph.contentHash = groundingGraphContentHash(graph);
  return {
    graph: GroundingGraphV1Schema.parse(graph),
    checkedCodeRefs,
    verifiedEdges: graph.edges.filter(edge => edge.state === 'verified').length,
    staleEdges: graph.edges.filter(edge => edge.state === 'stale').length,
  };
};
