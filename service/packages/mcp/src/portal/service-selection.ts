import { contentHash, type PortalPlan } from '@sfp/ir';
import {
  PortalServiceSelectionSchema,
  PortalWorkflowCoverageSchema,
  type PortalPlanArgs,
  type PortalLayer,
} from '@sfp/shared';

import { portalError } from './store.js';
import type { PortalWorkflowAnalysis } from './workflow-requirements.js';

export const qualifiedPortalSourceId = (grant: {
  workspaceId: string;
  role: string;
  rootPath: string;
  canonicalPath: string;
  identity: string;
}): `sha256:${string}` =>
  contentHash('sfp-portal-qualified-source-v1', {
    workspaceId: grant.workspaceId,
    role: grant.role,
    rootPath: grant.rootPath,
    canonicalPath: grant.canonicalPath,
    identity: grant.identity,
  });
const reviewable = new Set([
  'CROSS_LANGUAGE_GRAPH_REQUIRES_REVIEW',
  'UNSUPPORTED_RUNTIME_SOURCE',
  'UNSUPPORTED_NODE_HTTP',
  'UNKNOWN_HTTP_RECEIVER',
  'UNSUPPORTED_HTTP_CLIENT',
  'UNSUPPORTED_CHAINED_HTTP',
  'DYNAMIC_HTTP_OPTIONS',
  'DYNAMIC_HTTP_ROUTE',
  'DYNAMIC_ROUTE',
  'UNRESOLVED_MOUNT',
  'PROVIDER_HANDLER_UNPROVEN',
  'UNSUPPORTED_PROVIDER_ROUTE',
  'ROUTER_MOUNT_UNRESOLVED',
  'AMBIGUOUS_PROVIDER',
  'ROUTING_SCOPE_UNPROVEN',
  'PROVIDER_UNRESOLVED',
]);
const key = (item: { sourceId: string; rootPath: string }) =>
  JSON.stringify([item.sourceId, item.rootPath]);
/** Semantic review retains all source candidates; it never waives byte, parse or limit failures. */
export const selectPortalServices = (
  profiles: ReadonlyArray<Pick<PortalPlan['profiles'][number], 'graph'>>,
  request: Pick<PortalPlanArgs, 'services' | 'sourceReviews'>,
) => {
  const all = profiles.flatMap((profile, sourceIndex) =>
    profile.graph.services.map(service => ({
      sourceId: profile.graph.sourceId!,
      sourceIndex,
      rootPath: service.rootPath,
    })),
  );
  if (
    profiles.some(
      profile =>
        profile.graph.analysisVersion !== 2 ||
        !profile.graph.sourceId ||
        !profile.graph.connections,
    )
  )
    throw portalError('PORTAL_ANALYSIS_REPLAN_REQUIRED');
  const selected = request.services.length
    ? request.services.map(selector => {
        const matches = all.filter(item =>
          typeof selector === 'string'
            ? item.rootPath === selector
            : item.sourceId === selector.sourceId &&
              item.sourceIndex === selector.sourceIndex &&
              item.rootPath === selector.rootPath,
        );
        if (!matches.length) throw portalError('PORTAL_SERVICE_NOT_FOUND');
        if (matches.length !== 1) throw portalError('PORTAL_SERVICE_SELECTION_AMBIGUOUS');
        return matches[0]!;
      })
    : all;
  const closure = new Map(selected.map(item => [key(item), item])),
    issues: string[] = [],
    usedReviews = new Set<number>();
  let conservative = false;
  for (const [sourceIndex, profile] of profiles.entries()) {
    const graph = profile.graph,
      sourceId = graph.sourceId!;
    if (graph.issuesTruncated !== false || graph.connections!.issuesTruncated !== false) {
      conservative = true;
      issues.push('SERVICE_DIAGNOSTICS_TRUNCATED:' + sourceId);
    }
    if (!graph.sourceInventory?.complete) issues.push(`SOURCE_INVENTORY_INCOMPLETE:${sourceId}`);
    const diagnostics = [
      ...graph.issues.map(issue => {
        const split = issue.indexOf(':');
        const code = split < 0 ? issue : issue.slice(0, split),
          path = split < 0 ? undefined : issue.slice(split + 1);
        return {
          code,
          evidence: path
            ? {
                sourceId,
                path,
                hash: graph.files.find(file => file.path === path)?.hash,
                offset: 0,
              }
            : undefined,
        };
      }),
      ...graph.connections!.issues,
    ];
    for (const diagnostic of diagnostics) {
      const ev = diagnostic.evidence;
      // Any unresolved relevance keeps every potential service; an owner may review only exact semantic uncertainty.
      conservative = true;
      const reviewIndex = request.sourceReviews.findIndex(
        review =>
          reviewable.has(diagnostic.code) &&
          ev &&
          review.sourceId === sourceId &&
          review.sourceIndex === sourceIndex &&
          review.path === ev.path &&
          review.hash === ev.hash &&
          review.offset === ev.offset &&
          review.issue === diagnostic.code,
      );
      if (reviewIndex >= 0) usedReviews.add(reviewIndex);
      else
        issues.push(
          `SERVICE_ANALYSIS_UNRESOLVED:${sourceId}:${diagnostic.code}:${ev?.path ?? ''}:${ev?.offset ?? 0}`,
        );
    }
  }
  if (request.sourceReviews.some((_, index) => !usedReviews.has(index)))
    throw portalError('PORTAL_SOURCE_REVIEW_NOT_BOUND');
  if (conservative) for (const item of all) closure.set(key(item), item);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [sourceIndex, profile] of profiles.entries())
      for (const edge of profile.graph.edges) {
        if (edge.kind !== 'depends-on') continue;
        const sourceId = profile.graph.sourceId!,
          from = key({ sourceId, rootPath: edge.from }),
          to = key({ sourceId, rootPath: edge.to });
        if (closure.has(from) && !closure.has(to)) {
          const item = all.find(
            candidate => candidate.sourceIndex === sourceIndex && candidate.rootPath === edge.to,
          );
          if (!item) {
            issues.push(`SERVICE_EDGE_TARGET_MISSING:${to}`);
            continue;
          }
          closure.set(to, item);
          changed = true;
        }
      }
  }
  const value = {
    version: 2 as const,
    selected: [...new Map(selected.map(item => [key(item), item])).values()],
    closure: [...closure.values()],
    connections: profiles.map(profile => profile.graph.connections!),
    reviews: request.sourceReviews,
    complete: issues.length === 0,
    issues:
      issues.length > 512
        ? [...issues.slice(0, 511), 'SERVICE_SELECTION_DIAGNOSTICS_TRUNCATED']
        : issues,
  };
  return PortalServiceSelectionSchema.parse({
    ...value,
    hash: contentHash('sfp-portal-service-selection-v2', value),
  });
};
export const selectedPortalLayers = (
  profiles: ReadonlyArray<Pick<PortalPlan['profiles'][number], 'graph'>>,
  selection: ReturnType<typeof selectPortalServices>,
): PortalLayer[] => [
  ...new Set(
    selection.closure
      .flatMap(
        item =>
          profiles[item.sourceIndex]!.graph.services.find(
            service => service.rootPath === item.rootPath,
          )!.layers,
      )
      .concat(selection.reviews.flatMap(review => review.layers)),
  ),
];

/**
 * Bind required observations to concrete requirement IDs; prose confirmation cannot erase
 * observations.
 */
export const coverPortalWorkflows = (
  analysis: PortalWorkflowAnalysis,
  requirements: PortalPlanArgs['requirements'],
  decisions: PortalPlanArgs['workflowDecisions'],
) => {
  const remainingAnalysisIssues = analysis.issues.filter(
    issue =>
      !(
        ['AMBIGUOUS_WORKFLOW', 'AMBIGUOUS_MUTATION_CONTEXT'].includes(issue.code) &&
        analysis.unclassifiedInteractions.some(
          scope =>
            scope.nodePath === issue.nodePath &&
            decisions.some(decision => decision.evidenceId === scope.evidenceId),
        )
      ),
  );
  const issues = remainingAnalysisIssues.map(
      issue => `WORKFLOW_ANALYSIS:${issue.code}:${issue.nodePath ?? ''}`,
    ),
    scopes: Array<{
      id: string;
      evidenceIds: string[];
      requirementIds: string[];
      status: 'covered' | 'unresolved';
    }> = [];
  const known = new Set(analysis.evidence.map(item => item.id));
  for (const decision of decisions)
    if (
      decision.analysisHash !== analysis.analysisHash ||
      !known.has(decision.evidenceId) ||
      decision.requirementIds.some(
        id =>
          !requirements.some(
            requirement =>
              requirement.id === id &&
              requirement.required &&
              requirement.workflow?.status === 'confirmed',
          ),
      ) ||
      decisions.filter(other => other.evidenceId === decision.evidenceId).length !== 1
    )
      throw portalError('PORTAL_WORKFLOW_DECISION_NOT_BOUND');
  for (const candidate of analysis.candidates)
    scopes.push({
      id: candidate.requirement.id,
      evidenceIds: [...new Set([...candidate.evidenceIds, ...candidate.interactionIds])],
      requirementIds: [candidate.requirement.id],
      status: requirements.some(requirement => requirement.id === candidate.requirement.id)
        ? 'covered'
        : 'unresolved',
    });
  for (const interaction of analysis.unclassifiedInteractions) {
    const decision = decisions.find(item => item.evidenceId === interaction.evidenceId);
    scopes.push({
      id: interaction.evidenceId,
      evidenceIds: [interaction.evidenceId],
      requirementIds: decision?.requirementIds ?? [],
      status: decision ? 'covered' : 'unresolved',
    });
    if (!decision) issues.push(`WORKFLOW_SCOPE_UNRESOLVED:${interaction.evidenceId}`);
  }
  return PortalWorkflowCoverageSchema.parse({
    version: 1,
    analysisHash: analysis.analysisHash,
    evidence: analysis.evidence,
    scopes,
    decisions,
    complete:
      remainingAnalysisIssues.length === 0 && scopes.every(scope => scope.status === 'covered'),
    issues: issues.slice(0, 512),
  });
};
