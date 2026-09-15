import { createHash } from 'node:crypto';

import type { PortalLayer, PortalPlanArgs } from '@sfp/shared';

type Scope = 'frontend-only' | 'operational-portal';
type Requirement = PortalPlanArgs['requirements'][number];
type Kind =
  | 'commerce-catalog'
  | 'commerce-cart'
  | 'commerce-checkout'
  | 'account-session'
  | 'document-create'
  | 'document-edit'
  | 'task-create'
  | 'task-edit'
  | 'form-submit'
  | 'settings-update'
  | 'search-filter'
  | 'read-dashboard'
  | 'configured-integration';
export interface PortalWorkflowSourceHint {
  kind: 'configured-integration' | 'persistence' | 'read-api' | 'authentication';
  sourceId: string;
  path: string;
  hash: string;
  text: string;
  designNodeIds: readonly string[];
  /** Candidate rationale, not semantic proof, owner review admission or permission. */
  rationale?: string;
}
export interface PortalWorkflowEvidence {
  id: string;
  kind: 'design' | 'source';
  hash: string;
  nodeId?: string;
  nodePath?: string;
  sourceId?: string;
  path?: string;
  labels?: string[];
  rationale?: string;
  sourceHintKind?: PortalWorkflowSourceHint['kind'];
}
export interface PortalWorkflowAnalysis {
  version: 1;
  analysisComplete: boolean;
  /** Draft interpretation never proves implemented or confirmed interaction coverage. */
  interactionCoverage: 'draft' | 'incomplete';
  analysisHash: string;
  evidence: PortalWorkflowEvidence[];
  candidates: {
    kind: Kind;
    requirement: Requirement;
    evidenceIds: string[];
    interactionIds: string[];
  }[];
  unclassifiedInteractions: {
    evidenceId: string;
    nodeId?: string;
    nodePath: string;
    reason: string;
  }[];
  issues: { code: string; nodePath?: string }[];
}
type Node = Record<string, unknown>;
type Observation = {
  value: Node;
  path: string;
  parent?: Observation;
  id?: string;
  labels: string[];
  evidenceId: string;
  interactive: boolean;
  children: Observation[];
  reactions: { trigger: string; actions: { type: string; destinationId?: string }[] }[];
};
const object = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const bounded = (value: number | undefined, fallback: number) =>
  Number.isInteger(value ?? fallback) && (value ?? fallback) > 0
    ? Math.min(value ?? fallback, fallback)
    : 0;
const short = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 96 &&
  !/[\r\n]/u.test(value)
    ? value.trim()
    : undefined;
const definitions: { kind: Kind; pattern: RegExp; layers: PortalLayer[]; description: string }[] = [
  {
    kind: 'commerce-catalog',
    pattern: /^(?:shop|product details?|product list|catalog|상품|제품 상세)$/iu,
    layers: ['frontend', 'api', 'database'],
    description:
      'Display and navigate the product catalog using the required service data contract',
  },
  {
    kind: 'commerce-cart',
    pattern: /^(?:shopping cart|add to cart|cart totals?|장바구니)$/iu,
    layers: ['frontend', 'api', 'database', 'authorization'],
    description:
      'Implement cart quantities, totals and durable ownership across the required service layers',
  },
  {
    kind: 'commerce-checkout',
    pattern:
      /^(?:checkout|place order|billing details|order confirmation|주문하기|주문 완료|결제)$/iu,
    layers: ['frontend', 'backend', 'api', 'database', 'authorization'],
    description: 'Validate checkout, persist an order and enforce access to its data',
  },
  {
    kind: 'account-session',
    pattern: /^(?:sign in|log in|sign up|reset password|my account|로그인|회원가입)$/iu,
    layers: ['frontend', 'api', 'authentication', 'authorization'],
    description: 'Implement account and session behavior with positive and negative access cases',
  },
];
const mutationLayers: PortalLayer[] = ['frontend', 'backend', 'api', 'database'];

/** Read-only candidate interpretation of bounded observations, not a workflow admission gate. */
export const analyzePortalWorkflows = (
  design: Record<string, unknown> | null,
  scope: Scope,
  options: {
    sourceHints?: readonly PortalWorkflowSourceHint[];
    limits?: { maxNodes?: number; maxEvidence?: number };
  } = {},
): PortalWorkflowAnalysis => {
  const result: PortalWorkflowAnalysis = {
    version: 1,
    analysisComplete: true,
    interactionCoverage: 'draft',
    analysisHash: '',
    evidence: [],
    candidates: [],
    unclassifiedInteractions: [],
    issues: [],
  };
  const maxNodes = bounded(options.limits?.maxNodes, 100_000),
    maxEvidence = bounded(options.limits?.maxEvidence, 10_000);
  const issue = (code: string, path?: string) => {
    result.analysisComplete = false;
    if (result.issues.length < 512)
      result.issues.push({ code, ...(path === undefined ? {} : { nodePath: path }) });
  };
  const retainedEvidence = new Set<string>();
  const retain = (record: PortalWorkflowEvidence): boolean => {
    if (retainedEvidence.has(record.id)) return true;
    if (result.evidence.length >= maxEvidence) {
      if (!result.issues.some(item => item.code === 'EVIDENCE_LIMIT')) issue('EVIDENCE_LIMIT');
      return false;
    }
    result.evidence.push(record);
    retainedEvidence.add(record.id);
    return true;
  };
  const observations: Observation[] = [],
    byId = new Map<string, Observation[]>(),
    seen = new WeakSet<object>();
  let textBytes = 0;
  const pending: { value: unknown; path: string; parent?: Observation; depth: number }[] = [];
  const queue = (
    values: unknown[],
    prefix: string,
    parent: Observation | undefined,
    depth: number,
  ) => {
    if (depth > 128) {
      issue('DEPTH_LIMIT', prefix);
      return;
    }
    for (let index = values.length - 1; index >= 0; index--) {
      if (pending.length + observations.length >= maxNodes) {
        issue('NODE_LIMIT', prefix);
        break;
      }
      pending.push({
        value: values[index],
        path: `${prefix}/${index}`,
        ...(parent ? { parent } : {}),
        depth,
      });
    }
  };
  if (!design || !Array.isArray(design.nodes)) issue('DESIGN_MISSING');
  else {
    if (design.nodes.length === 0) issue('DESIGN_EMPTY');
    if (design.truncated === true || design.complete === false) issue('DESIGN_INCOMPLETE');
    queue(design.nodes, 'nodes', undefined, 0);
  }
  let visits = 0;
  while (pending.length) {
    if (++visits > maxNodes) {
      issue('NODE_LIMIT');
      break;
    }
    const entry = pending.pop()!;
    if (!object(entry.value)) {
      issue('MALFORMED_NODE', entry.path);
      continue;
    }
    if (seen.has(entry.value)) {
      issue('CYCLIC_OR_SHARED_NODE', entry.path);
      continue;
    }
    seen.add(entry.value);
    const value = entry.value;
    const id = short(value.id);
    if (!id) issue('MISSING_NODE_ID', entry.path);
    if (value.truncated === true || value.deduped === true) issue('DESIGN_INCOMPLETE', entry.path);
    const labels: string[] = [];
    for (const key of ['name', 'characters']) {
      if (typeof value[key] === 'string') {
        textBytes += Buffer.byteLength(value[key]);
        if (textBytes > 8_388_608) {
          issue('TEXT_LIMIT', entry.path);
          break;
        }
        const label = short(value[key]);
        if (label && !labels.includes(label)) labels.push(label);
      }
    }
    if (textBytes > 8_388_608) break;
    const reactions: Observation['reactions'] = [];
    if (value.reactions !== undefined && !Array.isArray(value.reactions))
      issue('MALFORMED_REACTION', entry.path);
    if (Array.isArray(value.reactions)) {
      if (value.reactions.length > 32) issue('REACTION_LIMIT', entry.path);
      for (const raw of value.reactions.slice(0, 32)) {
        if (!object(raw) || !object(raw.trigger) || !short(raw.trigger.type)) {
          issue('MALFORMED_REACTION', entry.path);
          continue;
        }
        const rawActions = Array.isArray(raw.actions)
          ? raw.actions
          : object(raw.action)
            ? [raw.action]
            : [];
        if (rawActions.length === 0) issue('MALFORMED_REACTION', entry.path);
        if (rawActions.length > 32) issue('REACTION_LIMIT', entry.path);
        const actions: Observation['reactions'][number]['actions'] = [];
        for (const rawAction of rawActions.slice(0, 32)) {
          if (!object(rawAction) || !short(rawAction.type)) {
            issue('MALFORMED_REACTION', entry.path);
            continue;
          }
          const destinationId = short(rawAction.destinationId);
          actions.push({
            type: short(rawAction.type)!,
            ...(destinationId ? { destinationId } : {}),
          });
        }
        reactions.push({ trigger: short(raw.trigger.type)!, actions });
      }
    }
    const type = short(value.type) ?? '';
    const interactive =
      reactions.length > 0 ||
      (Array.isArray(value.reactions) && value.reactions.length > 0) ||
      /^(?:BUTTON|INPUT|SELECT|TEXTAREA|CHECKBOX|RADIO|SWITCH)$/iu.test(type) ||
      labels.some(label =>
        /^(?:button|input|select|checkbox|toggle|text field)(?:\b|\/)/iu.test(label),
      ) ||
      value.requiredInteraction === true;
    const hash = digest(
      JSON.stringify({ path: entry.path, id: id ?? null, type, labels, reactions, interactive }),
    );
    const evidenceId = `design-${hash.slice(7)}`;
    if (
      !retain({
        id: evidenceId,
        kind: 'design',
        hash,
        ...(id ? { nodeId: id } : {}),
        nodePath: entry.path,
        labels,
      })
    )
      break;
    const observation: Observation = {
      value,
      path: entry.path,
      ...(entry.parent ? { parent: entry.parent } : {}),
      ...(id ? { id } : {}),
      labels,
      evidenceId,
      interactive,
      children: [],
      reactions,
    };
    observations.push(observation);
    if (entry.parent) entry.parent.children.push(observation);
    if (id) {
      const matches = byId.get(id) ?? [];
      if (matches.length) issue('DUPLICATE_NODE_ID', entry.path);
      matches.push(observation);
      byId.set(id, matches);
    }
    if (value.children !== undefined && !Array.isArray(value.children))
      issue('MALFORMED_CHILDREN', entry.path);
    if (Array.isArray(value.children))
      queue(value.children, `${entry.path}/children`, observation, entry.depth + 1);
  }
  const hints = new Map<string, { hint: PortalWorkflowSourceHint; evidenceId: string }[]>();
  const sourceVersions = new Map<string, string>(),
    conflictingSources = new Set<string>(),
    validHints: PortalWorkflowSourceHint[] = [];
  if ((options.sourceHints?.length ?? 0) > 256) issue('SOURCE_HINT_LIMIT');
  let sourceBytes = 0;
  for (const hint of (options.sourceHints ?? []).slice(0, 256)) {
    sourceBytes += Buffer.byteLength(hint.text);
    if (
      Buffer.byteLength(hint.text) > 262_144 ||
      sourceBytes > 8_388_608 ||
      hint.designNodeIds.length > 128 ||
      hint.designNodeIds.some(id => !short(id)) ||
      !hint.sourceId ||
      hint.sourceId.length > 512 ||
      !hint.path ||
      hint.path.length > 2048
    ) {
      issue('SOURCE_HINT_LIMIT');
      continue;
    }
    if (digest(hint.text) !== hint.hash) {
      issue('SOURCE_HASH_MISMATCH');
      continue;
    }
    const sourceKey = JSON.stringify([hint.sourceId, hint.path]);
    if (sourceVersions.has(sourceKey) && sourceVersions.get(sourceKey) !== hint.hash) {
      issue('SOURCE_HINT_CONFLICT');
      conflictingSources.add(sourceKey);
    }
    sourceVersions.set(sourceKey, hint.hash);
    validHints.push(hint);
  }
  for (const hint of validHints) {
    if (conflictingSources.has(JSON.stringify([hint.sourceId, hint.path]))) continue;
    const hintId = `source-${digest(JSON.stringify({ sourceId: hint.sourceId, path: hint.path, hash: hint.hash, kind: hint.kind, nodes: hint.designNodeIds, rationale: hint.rationale?.slice(0, 512) ?? '' })).slice(7)}`;
    if (
      !retain({
        id: hintId,
        kind: 'source',
        hash: hint.hash,
        sourceId: hint.sourceId,
        path: hint.path,
        sourceHintKind: hint.kind,
        rationale:
          hint.rationale?.slice(0, 512) ??
          'Supplied source-bound candidate; semantic admission is external',
      })
    )
      break;
    for (const nodeId of hint.designNodeIds) {
      if (byId.get(nodeId)?.length !== 1) {
        issue('SOURCE_HINT_NODE_UNRESOLVED');
        continue;
      }
      const existing = hints.get(nodeId) ?? [];
      existing.push({ hint, evidenceId: hintId });
      hints.set(nodeId, existing);
    }
  }
  const candidates = new Map<
    Kind,
    {
      layers: Set<PortalLayer>;
      description: string;
      evidenceIds: Set<string>;
      interactionIds: Set<string>;
      states: Set<string>;
    }
  >();
  const interpreted = new Set<string>();
  const interpretations = new Map<string, Set<Kind>>();
  const uncertain = new Map<string, string>();
  const add = (
    kind: Kind,
    observation: Observation,
    layers: PortalLayer[],
    description: string,
    context: Observation[],
    linked = hints.get(observation.id ?? '') ?? [],
  ) => {
    let candidate = candidates.get(kind);
    if (!candidate) {
      candidate = {
        layers: new Set(layers),
        description,
        evidenceIds: new Set(),
        interactionIds: new Set(),
        states: new Set(),
      };
      candidates.set(kind, candidate);
    }
    for (const layer of layers) candidate.layers.add(layer);
    for (const member of [observation, ...context]) candidate.evidenceIds.add(member.evidenceId);
    if (observation.interactive) {
      candidate.interactionIds.add(observation.evidenceId);
      interpreted.add(observation.evidenceId);
      const kinds = interpretations.get(observation.evidenceId) ?? new Set<Kind>();
      kinds.add(kind);
      interpretations.set(observation.evidenceId, kinds);
    }
    for (const link of linked) {
      candidate.evidenceIds.add(link.evidenceId);
      if (link.hint.kind === 'read-api') {
        candidate.layers.add('api');
        candidate.layers.add('backend');
      }
      if (link.hint.kind === 'persistence') candidate.layers.add('database');
      if (link.hint.kind === 'authentication') {
        candidate.layers.add('authentication');
        candidate.layers.add('authorization');
      }
    }
    for (const member of context)
      for (const label of member.labels) {
        if (/\b(?:invalid|error|failed|required|try again)\b|오류|필수|실패/iu.test(label))
          candidate.states.add('validation-error');
        if (/\b(?:saved|success|complete|submitted)\b|저장 완료|성공/iu.test(label))
          candidate.states.add('success');
        if (/\b(?:loading|saving|submitting)\b|저장 중|로딩/iu.test(label))
          candidate.states.add('pending');
      }
  };
  for (const observation of observations) {
    if (!observation.id || byId.get(observation.id)?.length !== 1) continue;
    const context: Observation[] = [];
    let ancestor = observation.parent;
    for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parent)
      context.push(ancestor);
    // Immediate label children belong to a control; prose in arbitrary descendants does not.
    const labels = observation.labels.map(label => ({ label, source: observation }));
    if (observation.interactive) {
      if (observation.children.length > 32) {
        issue('CONTROL_LABEL_LIMIT', observation.path);
        uncertain.set(
          observation.evidenceId,
          'Immediate control-label interpretation exceeded its bound',
        );
      }
      for (const child of observation.children.slice(0, 32))
        for (const label of child.labels) labels.push({ label, source: child });
    }
    const surrounding = context.flatMap(item => item.labels);
    const related = context.slice();
    if (observation.parent) {
      if (observation.parent.children.length > 128) {
        issue('SIBLING_CONTEXT_LIMIT', observation.path);
        uncertain.set(observation.evidenceId, 'Sibling-state interpretation exceeded its bound');
      }
      for (const sibling of observation.parent.children.slice(0, 128))
        if (!sibling.interactive) related.push(sibling);
    }
    for (const definition of definitions) {
      const matches = labels.filter(item => definition.pattern.test(item.label));
      if (matches.length)
        add(
          definition.kind,
          observation,
          definition.layers,
          definition.description,
          related.concat(matches.map(item => item.source)),
        );
    }
    if (
      observation.labels.some(label =>
        /^(?:dashboard|overview|analytics|reports|대시보드)$/iu.test(label),
      )
    )
      add(
        'read-dashboard',
        observation,
        ['frontend'],
        'Display observed dashboard information without inventing remote storage or identity requirements',
        related,
      );
    if (!observation.interactive) continue;
    const nearestKinds = new Set<'document' | 'task' | 'settings'>();
    for (const member of context) {
      for (const label of member.labels) {
        if (/^(?:documents?|notes?)(?:\s+(?:editor|list|details?|management))?$/iu.test(label))
          nearestKinds.add('document');
        if (/^tasks?(?:\s+(?:editor|list|details?|management))?$/iu.test(label))
          nearestKinds.add('task');
        if (/^(?:(?:account|profile)\s+)?(?:settings|preferences)$/iu.test(label))
          nearestKinds.add('settings');
      }
      if (nearestKinds.size) break;
    }
    for (const { label, source } of labels) {
      const actionEvidence = related.concat(source);
      const action =
        /^(create|new|add|edit|update|save)\s+(?:a\s+|the\s+)?(document|note|task)s?$/iu.exec(
          label,
        );
      const contextualAction = /^(create|new|add|edit|update|save)(?: changes)?$/iu.exec(label);
      if (contextualAction && nearestKinds.size > 1) {
        issue('AMBIGUOUS_MUTATION_CONTEXT', observation.path);
        uncertain.set(
          observation.evidenceId,
          'Nearest mutation context supports conflicting entity types',
        );
        continue;
      }
      const noun =
        action?.[2]?.toLowerCase() ??
        (contextualAction && nearestKinds.has('document')
          ? 'document'
          : contextualAction && nearestKinds.has('task')
            ? 'task'
            : undefined);
      const verb = action?.[1] ?? contextualAction?.[1];
      if (noun && verb) {
        const kind =
          `${noun === 'task' ? 'task' : 'document'}-${/^(?:create|new|add)$/iu.test(verb) ? 'create' : 'edit'}` as Kind;
        add(
          kind,
          observation,
          mutationLayers,
          'Implement the observed document or task mutation with validation and durable service state',
          actionEvidence,
        );
      } else if (
        /^(?:save|save changes|update settings|apply settings)$/iu.test(label) &&
        nearestKinds.has('settings')
      )
        add(
          'settings-update',
          observation,
          mutationLayers,
          'Validate and persist the observed settings change; confirm its required storage boundary',
          actionEvidence,
        );
      else if (
        /^(?:submit|send|send message|submit form)$/iu.test(label) &&
        surrounding.some(item =>
          /^(?:(?:contact|feedback|application)\s+)?form$|^(?:contact|feedback)$/iu.test(item),
        )
      )
        add(
          'form-submit',
          observation,
          ['frontend', 'backend', 'api'],
          'Submit the observed form with positive and failure behavior; resolve the destination contract',
          actionEvidence,
        );
      else if (/^(?:search|filter|sort|apply filters|clear filters)$/iu.test(label))
        add(
          'search-filter',
          observation,
          ['frontend'],
          'Implement the observed search or filtering behavior and resolve whether its data is local or remote',
          actionEvidence,
        );
      else if (
        /^(?:sync|connect|import|export|send)\b.{0,64}$/iu.test(label) &&
        (hints.get(observation.id)?.some(item => item.hint.kind === 'configured-integration') ??
          false)
      )
        add(
          'configured-integration',
          observation,
          ['frontend', 'backend', 'api', 'integration', 'configuration'],
          'Implement the observed configured integration journey and confirm its external contract',
          actionEvidence,
        );
    }
  }
  for (const [kind, candidate] of candidates) {
    const layers: PortalLayer[] = scope === 'frontend-only' ? ['frontend'] : [...candidate.layers];
    const evidenceIds = [...candidate.evidenceIds].toSorted();
    const evidenceSetHash = digest(JSON.stringify(evidenceIds));
    result.candidates.push({
      kind,
      evidenceIds,
      interactionIds: [...candidate.interactionIds].toSorted(),
      requirement: {
        id: `figma-${kind}`,
        required: true,
        description:
          scope === 'frontend-only'
            ? `Implement the ${kind} frontend journey with honest local demo state`
            : candidate.description,
        layers,
        workflow: {
          status: 'draft',
          roles: ['user'],
          states: candidate.states.size ? [...candidate.states].toSorted() : ['observed-design'],
          routes: [],
          apiContracts: [],
          dataContracts: [],
          decisions: layers.map(layer => ({
            layer,
            action: 'implement',
            evidence: `Draft candidate evidence set ${evidenceSetHash}: ${evidenceIds.slice(0, 8).join(', ')}; required behavior and existing implementation must be reviewed`,
          })),
        },
      },
    });
  }
  for (const observation of observations) {
    if (uncertain.has(observation.evidenceId)) interpreted.delete(observation.evidenceId);
    if ((interpretations.get(observation.evidenceId)?.size ?? 0) > 1) {
      interpreted.delete(observation.evidenceId);
      issue('AMBIGUOUS_WORKFLOW', observation.path);
    }
    if (observation.interactive && !interpreted.has(observation.evidenceId)) {
      result.unclassifiedInteractions.push({
        evidenceId: observation.evidenceId,
        ...(observation.id ? { nodeId: observation.id } : {}),
        nodePath: observation.path,
        reason:
          !observation.id || byId.get(observation.id)?.length !== 1
            ? 'Interactive node identity is missing or ambiguous'
            : (interpretations.get(observation.evidenceId)?.size ?? 0) > 1
              ? 'Interactive scope has conflicting candidate workflows'
              : (uncertain.get(observation.evidenceId) ??
                'Required interactive scope has no supported workflow interpretation'),
      });
    }
  }
  if (!result.analysisComplete || result.unclassifiedInteractions.length)
    result.interactionCoverage = 'incomplete';
  // Hash only the bounded analysis projection, never the possibly cyclic raw capture object.
  result.analysisHash = digest(
    JSON.stringify({
      version: result.version,
      scope,
      complete: result.analysisComplete,
      evidence: result.evidence,
      candidates: result.candidates,
      unclassified: result.unclassifiedInteractions,
      issues: result.issues,
    }),
  );
  return result;
};

/** Compatibility wrapper; callers needing coverage must consume the detailed draft analysis. */
export const inferPortalWorkflows = (
  design: Record<string, unknown> | null,
  scope: Scope,
): PortalPlanArgs['requirements'] =>
  analyzePortalWorkflows(design, scope).candidates.map(candidate => candidate.requirement);
