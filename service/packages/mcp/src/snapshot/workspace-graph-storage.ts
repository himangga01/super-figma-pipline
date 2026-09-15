import {
  assertLocator,
  canonicalJson,
  decodeStored,
  encodeStored,
  graphRef,
  GroundingGraphV1Schema,
  SnapshotLocatorSchema,
  SnapshotStorageKeySchema,
  snapshotRelativePath,
  type GraphStoragePort,
  type GroundingGraphV1,
  type SnapshotLocator,
  type SnapshotStorageKey,
  type StoredGroundingGraphRef,
} from '@sfp/ir';
import { canonicalFileIdentityHash, type WorkspacePolicy } from '@sfp/shared';

import { NamespaceFiles } from '../fs/namespace-files.js';

const humanEvidence = (graph: GroundingGraphV1): string =>
  canonicalJson(
    graph.edges.flatMap(edge =>
      edge.evidence
        .filter(evidence => evidence.source === 'human')
        .map(evidence => ({ edgeId: edge.edgeId, evidence })),
    ),
  );
export class WorkspaceGraphStorage implements GraphStoragePort {
  private readonly files: NamespaceFiles;
  constructor(
    policy: WorkspacePolicy,
    private readonly authorizeReplace: (
      actorId: string,
      approvalId: string,
      locator: SnapshotLocator,
    ) => Promise<void>,
  ) {
    this.files = new NamespaceFiles(policy);
  }
  async create(
    inputKey: SnapshotStorageKey,
    input: GroundingGraphV1,
  ): Promise<StoredGroundingGraphRef> {
    const key = SnapshotStorageKeySchema.parse(inputKey),
      graph = GroundingGraphV1Schema.parse(input);
    assertLocator(key, graph.locator);
    if (canonicalFileIdentityHash(key.fileIdentity) !== graph.locator.fileIdentityHash)
      throw new Error('GRAPH_IDENTITY_MISMATCH');
    const ref = graphRef(graph);
    await this.files.create(key.workspaceId, ref.relativePath, encodeStored(graph));
    return ref;
  }
  async loadByLocator(input: SnapshotLocator) {
    const locator = SnapshotLocatorSchema.parse(input);
    const bytes = await this.files.read(locator.workspaceId, snapshotRelativePath(locator, true));
    if (bytes === null) return null;
    const graph = GroundingGraphV1Schema.parse(decodeStored(bytes));
    assertLocator(locator, graph.locator);
    return { ref: graphRef(graph), graph };
  }
  async replaceByLocator(
    locator: SnapshotLocator,
    input: GroundingGraphV1,
    expectedChecksum: `sha256:${string}`,
    actorId: string,
    approvalId: string,
  ) {
    const current = await this.loadByLocator(locator),
      graph = GroundingGraphV1Schema.parse(input);
    assertLocator(locator, graph.locator);
    if (current === null || current.ref.checksum !== expectedChecksum)
      throw new Error('GRAPH_CHECKSUM_CONFLICT');
    if (
      graph.graphVersion !== current.graph.graphVersion + 1 ||
      graph.baseGraphContentHash !== current.graph.contentHash ||
      graph.snapshotContentHash !== current.graph.snapshotContentHash ||
      humanEvidence(graph) !== humanEvidence(current.graph)
    )
      throw new Error('GRAPH_REFRESH_CONFLICT');
    await this.authorizeReplace(actorId, approvalId, locator);
    await this.files.replace(
      locator.workspaceId,
      snapshotRelativePath(locator, true),
      encodeStored(graph),
      expectedChecksum,
    );
    return graphRef(graph);
  }
  async list(
    workspaceId: string,
    fileIdentityHash: `sha256:${string}`,
  ): Promise<readonly StoredGroundingGraphRef[]> {
    const locator = SnapshotLocatorSchema.parse({
      workspaceId,
      fileIdentityHash,
      snapshotId: `sfp_snap1_${'A'.repeat(22)}`,
    });
    const refs: StoredGroundingGraphRef[] = [];
    for (const name of await this.files.list(
      workspaceId,
      `.sfp/grounding-graphs/v1/${locator.fileIdentityHash.slice(7)}`,
    )) {
      // eslint-disable-next-line no-await-in-loop -- bounded, locator-verified graph history
      const loaded = await this.loadByLocator({ ...locator, snapshotId: name.slice(0, -5) });
      if (loaded !== null) refs.push(loaded.ref);
    }
    return refs;
  }
}
