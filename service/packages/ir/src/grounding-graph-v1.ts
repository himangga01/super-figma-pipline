import {
  canonicalFileIdentityHash,
  FileIdentitySchema,
  DesignObservationSchema,
} from '@sfp/shared';
import { z } from 'zod';

import {
  ComponentMappingSchema,
  TokenMappingSchema,
  IconMappingSchema,
} from '../../shared/src/result-schemas.js';
import { canonicalJson, contentHash } from './canonical-json.js';
import { SnapshotLocatorSchema, Sha256WireSchema, RepoRelativePathSchema } from './snapshot-v1.js';

export const GroundingNodeLocatorV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('figma-node'), nodeId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('repo-path'), path: RepoRelativePathSchema }).strict(),
  z
    .object({
      kind: z.literal('repo-symbol'),
      path: RepoRelativePathSchema,
      symbol: z.string().min(1).max(512),
    })
    .strict(),
]);

export const GroundingNodeV1Schema = z
  .object({
    nodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
    kind: z.enum(['design-node', 'component', 'token', 'code-file', 'code-symbol']),
    locator: GroundingNodeLocatorV1Schema,
    contentHash: Sha256WireSchema,
  })
  .strict();

export const GroundingEvidenceRefV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('snapshot-node'),
      nodeId: z.string().min(1).max(256),
      contentHash: Sha256WireSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('repo-range'),
      path: RepoRelativePathSchema,
      startLine: z.number().int().min(1).max(10000000),
      endLine: z.number().int().min(1).max(10000000),
      contentHash: Sha256WireSchema,
    })
    .strict()
    .refine(value => value.endLine >= value.startLine),
]);

export const GroundingEvidenceV1Schema = z
  .object({
    source: z.enum(['automatic', 'human']),
    refs: z.array(GroundingEvidenceRefV1Schema).min(1).max(32),
    evidenceHash: Sha256WireSchema,
    verifiedBy: z.union([z.literal('system'), z.string().regex(/^actor1_[A-Za-z0-9_-]{43}$/)]),
    verifiedAt: z.iso.datetime({ offset: true }),
    baseVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.source === 'automatic') !== (value.verifiedBy === 'system')) {
      ctx.addIssue({ code: 'custom', message: 'evidence source/verifier mismatch' });
    }
  });

export const GroundingEdgeV1Schema = z
  .object({
    edgeId: z.string().regex(/^sfp_ge1_[0-9a-f]{64}$/),
    fromNodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
    toNodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
    kind: z.enum(['implements', 'maps-token', 'uses-component', 'derived-from']),
    state: z.enum(['candidate', 'verified', 'stale']),
    confidence: z.number().finite().min(0).max(1),
    evidence: z.array(GroundingEvidenceV1Schema).min(1).max(16),
  })
  .strict();

const isStrictlySortedUnique = <T>(values: readonly T[], key: (value: T) => string): boolean =>
  values.every((value, index) => index === 0 || key(values[index - 1] as T) < key(value));

export const groundingGraphContentHash = (value: unknown): `sha256:${string}` =>
  contentHash(
    'sfp-grounding-graph-v1',
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([key]) => key !== 'refreshedAt' && key !== 'contentHash',
      ),
    ),
  );

export const GroundingGraphV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    graphVersion: z.number().int().min(1),
    graphId: z.string().regex(/^grounding:sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]$/),
    locator: SnapshotLocatorSchema,
    fileIdentity: FileIdentitySchema,
    snapshotContentHash: Sha256WireSchema,
    mappingObservation: DesignObservationSchema.optional(),
    mappingResults: z
      .strictObject({
        version: z.literal(1),
        codeSourceHash: Sha256WireSchema,
        tokens: z.array(TokenMappingSchema).max(20000),
        components: z.array(ComponentMappingSchema.omit({ observations: true })).max(100000),
        icons: z.array(IconMappingSchema).max(100000),
      })
      .optional(),
    baseGraphContentHash: Sha256WireSchema.nullable(),
    nodes: z.array(GroundingNodeV1Schema).max(100000),
    edges: z.array(GroundingEdgeV1Schema).max(200000),
    refreshedAt: z.iso.datetime({ offset: true }),
    contentHash: Sha256WireSchema,
  })
  .strict()
  .superRefine((graph, ctx) => {
    const nodeIds = new Set(graph.nodes.map(node => node.nodeId));
    const edgeIds = new Set(graph.edges.map(edge => edge.edgeId));
    if (graph.graphId !== `grounding:${graph.locator.snapshotId}`)
      ctx.addIssue({ code: 'custom', path: ['graphId'], message: 'graph/locator mismatch' });
    if (canonicalFileIdentityHash(graph.fileIdentity) !== graph.locator.fileIdentityHash)
      ctx.addIssue({
        code: 'custom',
        path: ['fileIdentity'],
        message: 'file identity hash mismatch',
      });
    if (
      nodeIds.size !== graph.nodes.length ||
      !isStrictlySortedUnique(graph.nodes, node => node.nodeId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'node IDs must be unique and sorted',
      });
    if (
      edgeIds.size !== graph.edges.length ||
      !isStrictlySortedUnique(
        graph.edges,
        edge => `${edge.fromNodeId}\0${edge.toNodeId}\0${edge.kind}\0${edge.edgeId}`,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['edges'],
        message: 'edge keys must be unique and sorted',
      });
    for (const [edgeIndex, edge] of graph.edges.entries()) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId))
        ctx.addIssue({
          code: 'custom',
          path: ['edges', edgeIndex],
          message: 'edge endpoint missing',
        });
      if (
        !isStrictlySortedUnique(
          edge.evidence,
          evidence => `${evidence.source}\0${evidence.evidenceHash}\0${evidence.verifiedAt}`,
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['edges', edgeIndex, 'evidence'],
          message: 'evidence must be unique and sorted',
        });
      for (const [evidenceIndex, evidence] of edge.evidence.entries()) {
        if (evidence.baseVersion > graph.graphVersion)
          ctx.addIssue({
            code: 'custom',
            path: ['edges', edgeIndex, 'evidence', evidenceIndex, 'baseVersion'],
            message: 'future evidence version',
          });
        if (!isStrictlySortedUnique(evidence.refs, ref => canonicalJson(ref)))
          ctx.addIssue({
            code: 'custom',
            path: ['edges', edgeIndex, 'evidence', evidenceIndex, 'refs'],
            message: 'evidence refs must be unique and sorted',
          });
      }
    }
    if (groundingGraphContentHash(graph) !== graph.contentHash)
      ctx.addIssue({ code: 'custom', path: ['contentHash'], message: 'content hash mismatch' });
  });
export type GroundingGraphV1 = z.infer<typeof GroundingGraphV1Schema>;
