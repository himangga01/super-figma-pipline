import {
  assertLocator,
  SnapshotLocatorSchema,
  snapshotRelativePath,
  type SnapshotLocator,
} from '@sfp/ir';
import type { NativeEvidenceArtifactPortContract, WorkspacePolicy } from '@sfp/shared';

import { WorkspaceGraphStorage } from './workspace-graph-storage.js';
import { WorkspaceSnapshotStorage } from './workspace-snapshot-storage.js';

const mismatch = () =>
  Object.assign(new Error('stored service artifact does not match its result'), {
    code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
  });
export const materializeSnapshotEvidence = async (
  policy: WorkspacePolicy,
  input: Parameters<
    NonNullable<NativeEvidenceArtifactPortContract['materializeServiceArtifact']>
  >[0],
): ReturnType<NonNullable<NativeEvidenceArtifactPortContract['materializeServiceArtifact']>> => {
  const { projection, context, signal } = input;
  signal?.throwIfAborted();
  const snapshots = new WorkspaceSnapshotStorage(policy);
  const graphs = new WorkspaceGraphStorage(policy, async () => {
    throw mismatch();
  });
  let locator: SnapshotLocator;
  if (projection.kind === 'snapshot-candidate') {
    locator = SnapshotLocatorSchema.parse({
      workspaceId: projection.metadata.workspaceId,
      fileIdentityHash: projection.metadata.fileIdentityHash,
      snapshotId: projection.metadata.snapshotId,
    });
  } else locator = SnapshotLocatorSchema.parse(JSON.parse(projection.metadata.locator));
  if (locator.workspaceId !== context.workspaceId) throw mismatch();
  const snapshot = await snapshots.loadByLocator(locator);
  if (snapshot === null) throw mismatch();
  if (projection.kind === 'snapshot-candidate') {
    const fidelity = snapshot.snapshot.fidelity.truncated ? 'partial' : 'complete-leaf';
    if (
      projection.artifactRelativePath !== snapshot.ref.relativePath ||
      projection.metadata.refRelativePath !== snapshot.ref.relativePath ||
      projection.metadata.checksum !== snapshot.ref.checksum ||
      projection.metadata.fidelity !== fidelity
    )
      throw mismatch();
    if (projection.metadata.graph !== undefined) {
      const graph = await graphs.loadByLocator(locator);
      if (
        graph === null ||
        graph.ref.relativePath !== projection.metadata.graph.relativePath ||
        graph.ref.checksum !== projection.metadata.graph.checksum ||
        graph.graph.snapshotContentHash !== snapshot.snapshot.contentHash
      )
        throw mismatch();
      assertLocator(snapshot.snapshot.locator, graph.graph.locator);
    }
    signal?.throwIfAborted();
    return {
      kind: 'snapshot',
      ...locator,
      snapshotId: locator.snapshotId as `sfp_snap1_${string}`,
      fileIdentityHash: locator.fileIdentityHash as `sha256:${string}`,
      refRelativePath: snapshot.ref.relativePath,
      checksum: snapshot.ref.checksum as `sha256:${string}`,
      fidelity,
      artifactRelativePath: snapshot.ref.relativePath,
      artifactDigest64: snapshot.ref.checksum.slice(7),
    };
  }
  const graph = await graphs.loadByLocator(locator);
  const fidelity =
    snapshot.snapshot.fidelity.truncated || (graph?.ref.staleEdgeCount ?? 1) > 0
      ? 'partial'
      : 'complete-leaf';
  if (
    graph === null ||
    projection.artifactRelativePath !== snapshotRelativePath(locator, true) ||
    projection.metadata.checksum !== graph.ref.checksum ||
    graph.graph.snapshotContentHash !== snapshot.snapshot.contentHash ||
    projection.metadata.fidelity !== fidelity
  )
    throw mismatch();
  signal?.throwIfAborted();
  return {
    kind: 'grounding-graph',
    locator: projection.metadata.locator,
    artifactRelativePath: graph.ref.relativePath,
    artifactDigest64: graph.ref.checksum.slice(7),
    checksum: graph.ref.checksum as `sha256:${string}`,
    fidelity,
  };
};
