import { expect, it } from 'vitest';

import { GroundingGraphV1Schema, groundingGraphContentHash } from '../src/grounding-graph-v1.js';
import { graphFixture } from './graph-fixture.js';

it('validates graph identity, unique sorted nodes, endpoints and evidence authority', () => {
  expect(GroundingGraphV1Schema.safeParse(graphFixture()).success).toBe(true);
  const cases = [
    (graph: ReturnType<typeof graphFixture>) => {
      graph.nodes.push(graph.nodes[0]!);
    },
    (graph: ReturnType<typeof graphFixture>) => {
      graph.edges[0]!.toNodeId = `sfp_gn1_${'f'.repeat(64)}`;
    },
    (graph: ReturnType<typeof graphFixture>) => {
      graph.edges[0]!.evidence[0]!.source = 'human';
    },
    (graph: ReturnType<typeof graphFixture>) => {
      graph.edges[0]!.evidence[0]!.baseVersion = 2;
    },
  ];
  for (const mutate of cases) {
    const graph = graphFixture();
    mutate(graph);
    graph.contentHash = groundingGraphContentHash(graph);
    expect(GroundingGraphV1Schema.safeParse(graph).success).toBe(false);
  }
  const tampered = graphFixture();
  tampered.edges[0]!.confidence = 0.1;
  expect(GroundingGraphV1Schema.safeParse(tampered).success).toBe(false);
});
