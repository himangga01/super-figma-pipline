import { canonicalFileIdentityHash } from '@sfp/shared';

import { contentHash } from '../src/canonical-json.js';
import { groundingGraphContentHash, type GroundingGraphV1 } from '../src/grounding-graph-v1.js';

export const graphFixture = (count = 4): GroundingGraphV1 => {
  const hash = `sha256:${'a'.repeat(64)}` as const;
  const fileIdentity = { kind: 'figma-file-key' as const, value: 'fixture-file' };
  const locator = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    fileIdentityHash: canonicalFileIdentityHash(fileIdentity),
    snapshotId: 'sfp_snap1_AAAAAAAAAAAAAAAAAAAAAA',
  };
  const nodes: GroundingGraphV1['nodes'] = Array.from({ length: count }, (_, i) => ({
    nodeId: `sfp_gn1_${i.toString(16).padStart(64, '0')}`,
    kind: 'design-node',
    locator: { kind: 'figma-node', nodeId: `1:${i}` },
    contentHash: hash,
  }));
  const evidence = {
    source: 'automatic' as const,
    refs: [{ kind: 'snapshot-node' as const, nodeId: '1:0', contentHash: hash }],
    verifiedBy: 'system' as const,
    verifiedAt: '2026-09-06T00:00:00.000Z',
    baseVersion: 1,
  };
  const edges: GroundingGraphV1['edges'] = Array.from({ length: count * 2 }, (_, i) => ({
    edgeId: `sfp_ge1_${i.toString(16).padStart(64, '0')}`,
    fromNodeId: nodes[Math.floor(i / 2)]!.nodeId,
    toNodeId: nodes[(Math.floor(i / 2) + 1 + (i % 2)) % count]!.nodeId,
    kind: 'derived-from' as const,
    state: 'candidate' as const,
    confidence: 0.7,
    evidence: [{ ...evidence, evidenceHash: contentHash('sfp-grounding-evidence-v1', evidence) }],
  })).toSorted((a, b) => {
    const left = `${a.fromNodeId}\0${a.toNodeId}\0${a.kind}\0${a.edgeId}`,
      right = `${b.fromNodeId}\0${b.toNodeId}\0${b.kind}\0${b.edgeId}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const graph: GroundingGraphV1 = {
    schemaVersion: 1,
    graphVersion: 1,
    graphId: `grounding:${locator.snapshotId}`,
    locator,
    fileIdentity,
    snapshotContentHash: hash,
    baseGraphContentHash: null,
    nodes,
    edges,
    refreshedAt: evidence.verifiedAt,
    contentHash: hash,
  };
  graph.contentHash = groundingGraphContentHash(graph);
  return graph;
};
