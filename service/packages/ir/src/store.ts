import { z } from 'zod';

import { canonicalJson, storedChecksum, encodeCanonicalJson } from './canonical-json.js';
import { GroundingGraphV1Schema, type GroundingGraphV1 } from './grounding-graph-v1.js';
import {
  SnapshotStorageKeySchema,
  StoredSnapshotRefSchema,
  type SnapshotStorageKey,
  type SnapshotStoragePort,
  type StoredSnapshotRef,
} from './snapshot-storage.js';
import {
  RepoRelativePathSchema,
  Sha256WireSchema,
  SnapshotLocatorSchema,
  SnapshotV1Schema,
  snapshotRelativePath,
  type SnapshotLocator,
  type SnapshotV1,
} from './snapshot-v1.js';

export const StoredGroundingGraphRefSchema = SnapshotLocatorSchema.extend({
  graphId: z.string().regex(/^grounding:sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]$/u),
  relativePath: RepoRelativePathSchema,
  checksum: Sha256WireSchema,
  contentHash: Sha256WireSchema,
  bytes: z.number().int().positive().max(33_554_432),
  refreshedAt: z.iso.datetime({ offset: true }),
  edgeCount: z.number().int().min(0).max(200_000),
  staleEdgeCount: z.number().int().min(0).max(200_000),
}).strict();
export type StoredGroundingGraphRef = z.infer<typeof StoredGroundingGraphRefSchema>;
export interface GraphStoragePort {
  create(key: SnapshotStorageKey, graph: GroundingGraphV1): Promise<StoredGroundingGraphRef>;
  loadByLocator(
    locator: SnapshotLocator,
  ): Promise<{ ref: StoredGroundingGraphRef; graph: GroundingGraphV1 } | null>;
  replaceByLocator(
    locator: SnapshotLocator,
    graph: GroundingGraphV1,
    expectedChecksum: `sha256:${string}`,
    actorId: string,
    approvalId: string,
  ): Promise<StoredGroundingGraphRef>;
  list(
    workspaceId: string,
    fileIdentityHash: `sha256:${string}`,
  ): Promise<readonly StoredGroundingGraphRef[]>;
}
export const SnapshotCaptureResultSchema = z
  .object({
    snapshot: StoredSnapshotRefSchema,
    graph: StoredGroundingGraphRefSchema.nullable(),
    graphIssue: z
      .object({ code: z.string().min(1).max(128), messageHash: Sha256WireSchema })
      .strict()
      .nullable(),
  })
  .strict();
export const GroundingRefreshArgsSchema = z
  .object({
    locator: SnapshotLocatorSchema,
    expectedGraphChecksum: Sha256WireSchema,
  })
  .strict();
export const GroundingRefreshResultSchema = z
  .object({
    fidelity: z.enum(['complete-leaf', 'partial']),
    graph: StoredGroundingGraphRefSchema,
    checkedCodeRefs: z.number().int().nonnegative(),
    verifiedEdges: z.number().int().nonnegative(),
    staleEdges: z.number().int().nonnegative(),
  })
  .strict();

export const encodeStored = encodeCanonicalJson;
export const decodeStored = (bytes: Uint8Array): unknown => {
  if (bytes.byteLength > 33_554_432) throw new Error('SNAPSHOT_STORAGE_LIMIT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (text !== `${canonicalJson(value)}\n`) throw new Error('SNAPSHOT_NON_CANONICAL');
  return value;
};
const locatorFields = (value: SnapshotLocator) =>
  SnapshotLocatorSchema.parse({
    workspaceId: value.workspaceId,
    fileIdentityHash: value.fileIdentityHash,
    snapshotId: value.snapshotId,
  });
export const assertLocator = (expected: SnapshotLocator, actual: SnapshotLocator): void => {
  if (canonicalJson(locatorFields(expected)) !== canonicalJson(locatorFields(actual)))
    throw new Error('SNAPSHOT_LOCATOR_MISMATCH');
};
export const snapshotRef = (input: SnapshotV1): StoredSnapshotRef => {
  const snapshot = SnapshotV1Schema.parse(input),
    bytes = encodeStored(snapshot);
  return StoredSnapshotRefSchema.parse({
    ...snapshot.locator,
    relativePath: snapshotRelativePath(snapshot.locator),
    checksum: storedChecksum(bytes),
    bytes: bytes.byteLength,
    fidelity: snapshot.fidelity,
  });
};
export const graphRef = (input: GroundingGraphV1): StoredGroundingGraphRef => {
  const graph = GroundingGraphV1Schema.parse(input),
    bytes = encodeStored(graph);
  return StoredGroundingGraphRefSchema.parse({
    ...graph.locator,
    graphId: graph.graphId,
    relativePath: snapshotRelativePath(graph.locator, true),
    checksum: storedChecksum(bytes),
    contentHash: graph.contentHash,
    bytes: bytes.byteLength,
    refreshedAt: graph.refreshedAt,
    edgeCount: graph.edges.length,
    staleEdgeCount: graph.edges.filter(edge => edge.state === 'stale').length,
  });
};
export class SnapshotStore {
  constructor(private readonly storage: SnapshotStoragePort) {}
  async save(key: SnapshotStorageKey, input: SnapshotV1): Promise<StoredSnapshotRef> {
    SnapshotStorageKeySchema.parse(key);
    const snapshot = SnapshotV1Schema.parse(input);
    assertLocator(key, snapshot.locator);
    if (canonicalJson(key.fileIdentity) !== canonicalJson(snapshot.connector.fileIdentity))
      throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
    const ref = await this.storage.save(key, snapshot);
    if (canonicalJson(ref) !== canonicalJson(snapshotRef(snapshot)))
      throw new Error('SNAPSHOT_STORAGE_REF_MISMATCH');
    return ref;
  }
  async load(locator: SnapshotLocator): Promise<SnapshotV1 | null> {
    const loaded = await this.storage.loadByLocator(SnapshotLocatorSchema.parse(locator));
    if (loaded === null) return null;
    const snapshot = SnapshotV1Schema.parse(loaded.snapshot);
    assertLocator(locator, snapshot.locator);
    if (canonicalJson(loaded.ref) !== canonicalJson(snapshotRef(snapshot)))
      throw new Error('SNAPSHOT_STORAGE_REF_MISMATCH');
    return snapshot;
  }
}
