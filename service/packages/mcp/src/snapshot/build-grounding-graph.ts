import {
  canonicalJson,
  contentHash,
  groundingGraphContentHash,
  GroundingGraphV1Schema,
  storedChecksum,
  type GroundingGraphV1,
  type SnapshotV1,
} from '@sfp/ir';
import type { DesignContextNode } from '@sfp/shared';

import type { RepoReader } from '../fs/repo-walk.js';
import { scanRepoSvgs } from '../icons/repo-icons.js';
import {
  observeMappingContext,
  mapObservationComponents,
  mapObservationIcons,
  mapObservationTokens,
} from '../mapping/design-mapping.js';
import { readMappingOverrides, loadMappingTokenSource } from '../mapping/mapping-overrides.js';
import { analyzeProject, isUtilityFirst } from '../profile/profile.js';
import { scanComponents } from '../scan/scan.js';
import { parseCssCustomProperties } from '../tokens/tokens.js';

type Node = GroundingGraphV1['nodes'][number];
type Edge = GroundingGraphV1['edges'][number];
type Ref = Edge['evidence'][number]['refs'][number];
const reference = (node: Node): Ref => {
  if (node.locator.kind !== 'figma-node') throw new Error('GRAPH_NODE_LOCATOR_INVALID');
  return { kind: 'snapshot-node', nodeId: node.locator.nodeId, contentHash: node.contentHash };
};
export const buildGroundingGraph = async (
  snapshot: SnapshotV1,
  reader: RepoReader,
): Promise<GroundingGraphV1> => {
  const nodes = new Map<string, Node>(),
    edges = new Map<string, Edge>();
  const design = new Map<string, Node>();
  const now = new Date().toISOString();
  const addNode = (kind: Node['kind'], locator: Node['locator'], hash: string): Node => {
    const nodeId = `sfp_gn1_${contentHash('sfp-grounding-node-v1', { kind, locator }).slice(7)}`;
    const node = { nodeId, kind, locator, contentHash: hash };
    nodes.set(nodeId, node);
    return node;
  };
  const addEdge = (
    from: Node,
    to: Node,
    kind: Edge['kind'],
    confidence: number,
    refs: Ref[],
    verified = false,
  ) => {
    const sorted = [...new Map(refs.map(ref => [canonicalJson(ref), ref])).entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, ref]) => ref);
    const evidence = {
      source: 'automatic' as const,
      refs: sorted,
      verifiedBy: 'system',
      verifiedAt: now,
      baseVersion: 1,
    };
    const edgeId = `sfp_ge1_${contentHash('sfp-grounding-edge-v1', { from: from.nodeId, to: to.nodeId, kind }).slice(7)}`;
    edges.set(edgeId, {
      edgeId,
      fromNodeId: from.nodeId,
      toNodeId: to.nodeId,
      kind,
      state: verified ? 'verified' : 'candidate',
      confidence,
      evidence: [{ ...evidence, evidenceHash: contentHash('sfp-grounding-evidence-v1', evidence) }],
    });
  };
  const collect = (node: DesignContextNode, parent?: Node) => {
    const current = addNode(
      'design-node',
      { kind: 'figma-node', nodeId: node.id },
      contentHash('sfp-design-node-v1', node),
    );
    design.set(node.id, current);
    if (parent !== undefined)
      addEdge(current, parent, 'derived-from', 1, [reference(current), reference(parent)], true);
    if (node.mainComponent !== undefined) {
      const component = addNode(
        'component',
        { kind: 'figma-node', nodeId: node.mainComponent.id },
        contentHash('sfp-component-v1', node.mainComponent),
      );
      addEdge(
        current,
        component,
        'uses-component',
        1,
        [reference(current), reference(component)],
        true,
      );
    }
    for (const child of node.children ?? []) collect(child, current);
  };
  snapshot.observed.nodes.forEach(node => collect(node));
  const profile = await analyzeProject(reader.rootDir, reader);
  const components = await scanComponents(reader.rootDir, profile.componentExtensions, reader);
  const observation = observeMappingContext(snapshot.observed);
  const overrides = await readMappingOverrides(reader);
  const componentMappings = mapObservationComponents(observation, components, {
    threshold: 0.7,
    overrides: overrides.components,
    overridesOnDisk: overrides.componentsOnDisk,
  });
  const files = new Map<string, { node: Node; ref: Ref; text: string }>();
  const codeFile = async (path: string) => {
    const existing = files.get(path);
    if (existing !== undefined) return existing;
    const bytes = await reader.readBytes(path);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const hash = storedChecksum(bytes),
      node = addNode('code-file', { kind: 'repo-path', path }, hash);
    const entry = {
      node,
      text,
      ref: {
        kind: 'repo-range' as const,
        path,
        startLine: 1,
        endLine: text.split('\n').length,
        contentHash: hash,
      },
    };
    files.set(path, entry);
    return entry;
  };
  const symbol = async (path: string, name: string) => {
    const file = await codeFile(path);
    const node = addNode(
      'code-symbol',
      { kind: 'repo-symbol', path, symbol: name },
      contentHash('sfp-code-symbol-v1', { path, name, fileHash: file.node.contentHash }),
    );
    addEdge(node, file.node, 'derived-from', 1, [file.ref], true);
    return { node, ref: file.ref };
  };
  for (const mapping of componentMappings) {
    if (mapping.candidate === undefined) continue;
    // eslint-disable-next-line no-await-in-loop -- source evidence is read under one bounded repository authority
    const target = await symbol(mapping.candidate.filePath, mapping.candidate.name);
    for (const instance of mapping.instances) {
      const source = design.get(instance.nodeId);
      if (source !== undefined)
        addEdge(source, target.node, 'implements', mapping.candidate.confidence, [
          reference(source),
          target.ref,
        ]);
    }
  }
  const svgs = await scanRepoSvgs(reader.rootDir, reader);
  const iconMappings = mapObservationIcons(observation, svgs, {
    threshold: 0.7,
    svg: profile.svg,
    utilityFirst: isUtilityFirst(profile.styling.system),
  });
  for (const mapping of iconMappings) {
    if (mapping.candidate === undefined) continue;
    // eslint-disable-next-line no-await-in-loop -- each icon edge must carry the actual asset checksum
    const target = await codeFile(mapping.candidate.filePath);
    for (const id of mapping.nodeIds) {
      const source = design.get(id);
      if (source !== undefined)
        addEdge(source, target.node, 'implements', mapping.candidate.confidence, [
          reference(source),
          target.ref,
        ]);
    }
  }
  const tokenNodes = new Map<string, Node>();
  for (const [id, token] of Object.entries(snapshot.observed.variables ?? {}))
    tokenNodes.set(
      id,
      addNode('token', { kind: 'figma-node', nodeId: id }, contentHash('sfp-token-v1', token)),
    );
  const { loaded, codeSourceHash } = await loadMappingTokenSource(reader, profile);
  for (const style of observation.catalogs.paintStyles) {
    if (typeof style.id === 'string')
      tokenNodes.set(
        style.id,
        addNode(
          'token',
          { kind: 'figma-node', nodeId: style.id },
          contentHash('sfp-token-v1', style),
        ),
      );
  }

  const tokenMappings = mapObservationTokens(observation, loaded.tokens, {
    threshold: 0.7,
    utilityFirst: isUtilityFirst(profile.styling.system),
    overrides: overrides.tokens,
    proofs: overrides.proofs,
    codeSourceHash,
  });
  for (const mapping of tokenMappings) {
    if (mapping.candidate === undefined) continue;
    const token = loaded.tokens.find(
      item => item.name === mapping.candidate!.token && item.from === mapping.candidate!.from,
    );
    if (token === undefined) continue;
    const candidates =
      token.from !== undefined
        ? [token.from]
        : token.cssVar === undefined && loaded.source !== null
          ? [loaded.source]
          : loaded.files;
    for (const path of candidates) {
      // eslint-disable-next-line no-await-in-loop -- locate a real declaration; never invent a token source file
      const file = await codeFile(path);
      if (
        token.cssVar !== undefined &&
        !parseCssCustomProperties(file.text).some(
          item => item.name === token.name && item.value === token.value,
        )
      )
        continue;
      // eslint-disable-next-line no-await-in-loop -- the file result is reused through the scoped cache
      const target = await symbol(path, mapping.candidate.token);
      const source = mapping.sourceId ? tokenNodes.get(mapping.sourceId) : undefined;
      if (source)
        addEdge(source, target.node, 'maps-token', mapping.candidate.confidence, [
          reference(source),
          target.ref,
        ]);
    }
  }
  const graph = {
    schemaVersion: 1 as const,
    graphVersion: 1,
    graphId: `grounding:${snapshot.locator.snapshotId}`,
    locator: snapshot.locator,
    fileIdentity: snapshot.connector.fileIdentity,
    snapshotContentHash: snapshot.contentHash,
    mappingObservation: observation,
    mappingResults: {
      version: 1 as const,
      codeSourceHash,
      tokens: tokenMappings,
      components: componentMappings.map(({ observations: _observations, ...mapping }) => mapping),
      icons: iconMappings,
    },
    baseGraphContentHash: null,
    nodes: [...nodes.values()].toSorted((a, b) =>
      a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
    ),
    edges: [...edges.values()].toSorted((a, b) => {
      const left = `${a.fromNodeId}\0${a.toNodeId}\0${a.kind}\0${a.edgeId}`,
        right = `${b.fromNodeId}\0${b.toNodeId}\0${b.kind}\0${b.edgeId}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    refreshedAt: now,
    contentHash: '',
  };
  graph.contentHash = groundingGraphContentHash(graph);
  return GroundingGraphV1Schema.parse(graph);
};
