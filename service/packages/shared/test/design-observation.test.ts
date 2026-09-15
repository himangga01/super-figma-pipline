import { describe, expect, it } from 'vitest';

import {
  DesignCollectorEvidenceSchema,
  DesignCapabilityNameSchema,
  DesignObservationSchema,
  isBoundedDesignJson,
  type DesignObservation,
} from '../src/design-observation.js';

const observation = (): DesignObservation => ({
  observationVersion: 1,
  source: 'chrome',
  authority: 'legacy-unverified',
  contentHash: `sha256:${'0'.repeat(64)}`,
  raw: {},
  roots: ['root'],
  nodes: [{ id: 'root', parentId: null, childIds: [], properties: {} }],
  catalogs: {
    variables: [],
    collections: [],
    paintStyles: [],
    textStyles: [],
    effectStyles: [],
    gridStyles: [],
    styleVariables: {},
  },
  bindings: [],
  interactions: [],
  capabilities: DesignCapabilityNameSchema.options.map(name => ({
    name,
    status: 'unsupported',
    count: null,
    retainedCount: 0,
    evidence: 'legacy-unverified',
    reason: 'API_NOT_OBSERVED',
  })),
  coherence: { status: 'unverified', atomic: false },
  sourceBinding: { status: 'unverified' },
  issues: [],
});

describe('bounded design observation contracts', () => {
  it('independently rejects mismatched coherence identifiers and content hashes at the public observation boundary', () => {
    const original = observation();
    const value = {
      ...original,
      authority: 'collector-observed',
      coherence: {
        status: 'observed',
        atomic: false,
        method: 'content-reobservation',
        before: 'a',
        after: 'a',
        contentHash: original.contentHash,
        outcome: 'matched',
      },
    };
    expect(DesignObservationSchema.safeParse(value).success).toBe(true);
    expect(
      DesignObservationSchema.safeParse({ ...value, coherence: { ...value.coherence, after: 'b' } })
        .success,
    ).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...value,
        coherence: { ...value.coherence, contentHash: `sha256:${'1'.repeat(64)}` },
      }).success,
    ).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...value,
        coherence: { ...value.coherence, after: 'b', outcome: 'changed' },
      }).success,
    ).toBe(true);
  });

  it('rejects orphan parents, missing reverse edges, disconnected cycles and wrong root sets', () => {
    const original = observation();
    expect(DesignObservationSchema.safeParse(original).success).toBe(true);
    expect(
      DesignObservationSchema.safeParse({
        ...original,
        roots: [],
        nodes: [{ ...original.nodes[0], parentId: 'missing' }],
      }).success,
    ).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...original,
        nodes: [...original.nodes, { id: 'child', parentId: 'root', childIds: [], properties: {} }],
      }).success,
    ).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...original,
        roots: [],
        nodes: [
          { id: 'a', parentId: 'b', childIds: ['b'], properties: {} },
          { id: 'b', parentId: 'a', childIds: ['a'], properties: {} },
        ],
      }).success,
    ).toBe(false);
    expect(DesignObservationSchema.safeParse({ ...original, roots: [] }).success).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...original,
        roots: ['child'],
        nodes: [{ id: 'child', parentId: 'child', childIds: ['child'], properties: {} }],
      }).success,
    ).toBe(false);
    expect(
      DesignObservationSchema.safeParse({
        ...original,
        roots: ['root', 'other'],
        nodes: [
          { ...original.nodes[0], childIds: ['child'] },
          { id: 'other', parentId: null, childIds: [], properties: {} },
          { id: 'child', parentId: 'root', childIds: [], properties: {} },
        ],
      }).success,
    ).toBe(true);
  });
  it('measures JSON UTF-8 including escapes, surrogate pairs and lone surrogates before hashing', () => {
    for (const [value, size] of [
      ['plain', 7],
      ['\u0000\n\\"', 14],
      ['한국어', 11],
      ['😀', 6],
      ['\ud800', 8],
      [{ a: [null, false, true, 1.25, -1e30] }, 35],
    ] as const) {
      expect(isBoundedDesignJson(value, size)).toBe(true);
      expect(isBoundedDesignJson(value, size - 1)).toBe(false);
    }
  });

  it('rejects accessors, cycles, sparse arrays, non-JSON objects and depth exhaustion', () => {
    let calls = 0;
    const getter = {
      get value() {
        calls++;
        return 1;
      },
    };
    expect(isBoundedDesignJson(getter)).toBe(false);
    expect(calls).toBe(0);
    expect(isBoundedDesignJson(new Date())).toBe(false);
    const sparse: number[] = [];
    sparse.length = 2;
    sparse[1] = 1;
    expect(isBoundedDesignJson(sparse)).toBe(false);
    expect(isBoundedDesignJson({ missing: undefined })).toBe(false);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(isBoundedDesignJson(cyclic)).toBe(false);
    let deep: unknown = null;
    for (let index = 0; index < 130; index++) deep = [deep];
    expect(isBoundedDesignJson(deep)).toBe(false);
    expect(DesignObservationSchema.safeParse(cyclic).success).toBe(false);
  });

  it('fences legacy and future observation versions without synthesized evidence', () => {
    expect(
      DesignObservationSchema.safeParse({ nodes: [], complete: true, liveVerified: true }).success,
    ).toBe(false);
    expect(DesignObservationSchema.safeParse({ observationVersion: 2 }).success).toBe(false);
  });

  it('rejects duplicate capabilities, unknown fields and false matched coherence', () => {
    const hash = `sha256:${'0'.repeat(64)}`;
    const base = {
      evidenceVersion: 1,
      contentHash: hash,
      capabilities: [{ name: 'tree', status: 'empty', count: 0 }],
      coherence: { status: 'unverified', atomic: false },
      sourceBinding: { status: 'unverified' },
    };
    expect(DesignCollectorEvidenceSchema.safeParse(base).success).toBe(true);
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        capabilities: [{ name: 'tree', status: 'complete', count: null }],
      }).success,
    ).toBe(false);
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        capabilities: [{ name: 'tree', status: 'empty', count: null }],
      }).success,
    ).toBe(false);
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        capabilities: [{ name: 'tree', status: 'failed', count: null }],
      }).success,
    ).toBe(true);
    expect(DesignCollectorEvidenceSchema.safeParse({ ...base, approved: true }).success).toBe(
      false,
    );
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        capabilities: [base.capabilities[0], base.capabilities[0]],
      }).success,
    ).toBe(false);
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        coherence: {
          status: 'observed',
          atomic: false,
          method: 'document-epoch',
          before: '1',
          after: '2',
          contentHash: hash,
          outcome: 'matched',
        },
      }).success,
    ).toBe(false);
    expect(
      DesignCollectorEvidenceSchema.safeParse({
        ...base,
        coherence: {
          status: 'observed',
          atomic: true,
          method: 'document-epoch',
          before: '1',
          after: '1',
          contentHash: hash,
          outcome: 'matched',
        },
      }).success,
    ).toBe(false);
  });
});
