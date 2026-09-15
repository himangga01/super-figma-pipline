import {
  canonicalJson,
  hashSnapshot,
  SnapshotCaptureArgsSchema,
  SnapshotV1Schema,
  type SnapshotFidelity,
  type SnapshotV1,
} from '@sfp/ir';
import {
  canonicalFileIdentityHash,
  GetDesignContextResultSchema,
  PROTOCOL_VERSION,
  type GetDesignContextResult,
  type ProgressReporter,
  type RuntimeExecutionScope,
} from '@sfp/shared';

type Section = { nodeId: string; planPath: string[]; depth: number };
const hasTruncation = (input: unknown): boolean => {
  if (Array.isArray(input)) return input.some(hasTruncation);
  if (input === null || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return value.truncated === true || Object.values(value).some(hasTruncation);
};

export const captureSnapshot = async (input: {
  scope: RuntimeExecutionScope;
  snapshotId: string;
  nodeIds: string[];
  fileName: string;
  productVersion: string;
  read(nodeId: string, signal: AbortSignal): Promise<unknown>;
  signal: AbortSignal;
  reporter?: ProgressReporter;
}): Promise<SnapshotV1> => {
  const { scope, signal } = input;
  const identity = scope.target.fileIdentity;
  if (
    scope.workspace.workspaceId === null ||
    identity === null ||
    identity.kind === 'unstable-readonly' ||
    scope.target.sessionId === null ||
    scope.target.pluginGeneration === null
  )
    throw new Error('SNAPSHOT_STABLE_TARGET_REQUIRED');
  const { nodeIds } = SnapshotCaptureArgsSchema.parse({ nodeIds: input.nodeIds });
  const fidelity: SnapshotFidelity = {
    detail: 'full',
    truncated: false,
    omitted: [],
    unsupported: [],
    visitedCount: 0,
    expandedSections: [],
    completeLeafSections: [],
    issues: [],
  };
  const pending: Section[] = nodeIds.map(nodeId => ({ nodeId, planPath: [nodeId], depth: 0 }));
  const seen = new Set<string>();
  const sections: Array<{ nodeId: string; context: GetDesignContextResult }> = [];
  const observed: GetDesignContextResult = {
    nodes: [],
    globalVars: { styles: {} },
    variables: {},
    styles: {},
    projectTokens: {},
  };
  const rootIndices = new Map<string, number>();
  const observedNodes = new Map<string, string>();
  let order = 0,
    bytes = 0;
  const issue = (
    section: Section,
    status: SnapshotFidelity['issues'][number]['status'],
    code: string,
    position: number,
  ) => {
    fidelity.truncated = true;
    fidelity.issues.push({ ...section, status, code, order: position });
    if (status !== 'failed') fidelity.omitted.push(section.nodeId);
  };
  while (pending.length > 0) {
    signal.throwIfAborted();
    const section = pending.shift()!,
      position = order++;
    if (section.depth > 8) {
      issue(section, 'omitted-depth', 'CAPTURE_DEPTH_LIMIT', position);
      continue;
    }
    if (fidelity.visitedCount >= 256) {
      issue(section, 'omitted-section-cap', 'CAPTURE_SECTION_LIMIT', position);
      continue;
    }
    const key = `${scope.target.pluginGeneration}\0${section.nodeId}`;
    if (seen.has(key)) {
      issue(section, 'omitted-cycle', 'CAPTURE_CYCLE', position);
      continue;
    }
    seen.add(key);
    fidelity.visitedCount++;
    try {
      // eslint-disable-next-line no-await-in-loop -- stable depth-first plan order, below the concurrency bound of two
      const context = GetDesignContextResultSchema.parse(await input.read(section.nodeId, signal));
      signal.throwIfAborted();
      const size = Buffer.byteLength(canonicalJson(context));
      if (bytes + size > 12_000_000) {
        issue(section, 'omitted-section-cap', 'CAPTURE_BYTE_LIMIT', position);
        continue;
      }
      bytes += size;
      sections.push({ nodeId: section.nodeId, context });
      for (const node of context.nodes) {
        const index = rootIndices.get(node.id);
        if (index === undefined) {
          rootIndices.set(node.id, observed.nodes.length);
          observed.nodes.push(node);
        } else if (context.sectionPlan === undefined) observed.nodes[index] = node;
      }
      if (context.sectionPlan === undefined) {
        const inspect = (node: GetDesignContextResult['nodes'][number]): void => {
          const value = canonicalJson({ ...node, children: node.children?.map(child => child.id) });
          if (observedNodes.has(node.id) && observedNodes.get(node.id) !== value) {
            fidelity.truncated = true;
            fidelity.unsupported.push(`NODE_CHANGED:${node.id}`.slice(0, 512));
          }
          observedNodes.set(node.id, value);
          for (const child of node.children ?? []) inspect(child);
        };
        context.nodes.forEach(inspect);
      }
      const merge = (target: Record<string, unknown>, values: Record<string, unknown>) => {
        for (const [id, value] of Object.entries(values)) {
          if (Object.hasOwn(target, id) && canonicalJson(target[id]) !== canonicalJson(value)) {
            fidelity.truncated = true;
            fidelity.unsupported.push(`CONTEXT_CHANGED:${id}`.slice(0, 512));
          } else target[id] = value;
        }
      };
      merge(observed.globalVars!.styles, context.globalVars?.styles ?? {});
      merge(observed.variables!, context.variables ?? {});
      merge(observed.styles!, context.styles ?? {});
      merge(observed.projectTokens!, context.projectTokens ?? {});
      if (context.sectionPlan !== undefined) {
        fidelity.expandedSections.push({ ...section, order: position, status: 'expanded-plan' });
        if (
          (context.sectionPlan.sectionsOmitted ?? 0) > 0 ||
          context.sectionPlan.sections.length > 60
        )
          issue(section, 'omitted-section-cap', 'CAPTURE_PLAN_OMITTED', position);
        pending.unshift(
          ...context.sectionPlan.sections.slice(0, 60).map(child => ({
            nodeId: child.nodeId,
            planPath: [...section.planPath, child.nodeId],
            depth: section.depth + 1,
          })),
        );
      } else if (hasTruncation(context.nodes)) {
        issue(section, 'failed', 'CAPTURE_DEGRADED', position);
      } else
        fidelity.completeLeafSections.push({
          ...section,
          order: position,
          status: 'complete-leaf',
        });
    } catch (error) {
      signal.throwIfAborted();
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code).slice(0, 128)
          : 'CAPTURE_SECTION_FAILED';
      issue(section, 'failed', code, position);
    }
    input.reporter?.report({
      phase: 'capturing',
      completed: fidelity.visitedCount,
      total: Math.min(256, fidelity.visitedCount + pending.length),
      message: 'design section captured',
    });
  }
  const snapshot = {
    schemaVersion: 1 as const,
    locator: {
      workspaceId: scope.workspace.workspaceId,
      fileIdentityHash: canonicalFileIdentityHash(identity),
      snapshotId: input.snapshotId,
    },
    connector: {
      protocolVersion: PROTOCOL_VERSION,
      productVersion: input.productVersion,
      sessionId: scope.target.sessionId,
      pluginGeneration: scope.target.pluginGeneration,
      fileIdentity: identity,
      fileName: input.fileName,
      editorType: scope.target.editorType ?? 'figma',
    },
    target: { nodeIds },
    observed,
    fidelity,
    capturedAt: new Date().toISOString(),
    extensions: { sections },
    contentHash: '',
  };
  snapshot.contentHash = hashSnapshot(snapshot);
  return SnapshotV1Schema.parse(snapshot);
};
