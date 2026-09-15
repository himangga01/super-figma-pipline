import { createHash } from 'node:crypto';

import {
  DESIGN_OBSERVATION_LIMITS,
  DesignCollectorEvidenceSchema,
  DesignObservationSchema,
  isBoundedDesignJson,
  type DesignBindingObservation,
  type DesignCapabilityName,
  type DesignCollectorEvidence,
  type DesignJson,
  type DesignObservation,
} from '@sfp/shared';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** Preserve raw Desktop/Chrome observations while presenting a common, non-deduplicated tree. */
export const normalizePortalDesign = (record: Record<string, unknown>): Record<string, unknown> => {
  if (Array.isArray(record.nodes)) return record;
  if (record.source !== 'desktop-plugin' || !object(record.document)) return record;
  const document = record.document;
  const nodes = Array.isArray(document.children)
    ? document.children
    : Array.isArray(document.nodes)
      ? document.nodes
      : object(document.node)
        ? [document.node]
        : [];
  let partial =
    nodes.length === 0 ||
    document.sectionPlan !== undefined ||
    record.fileUrlIdentityVerified !== true;
  const pending: unknown[] = [...nodes];
  const seen = new Set<object>();
  let count = 0;
  while (pending.length) {
    if (++count > 100_000) {
      partial = true;
      break;
    }
    const value = pending.pop();
    if (!object(value)) {
      partial = true;
      continue;
    }
    if (seen.has(value)) {
      partial = true;
      continue;
    }
    seen.add(value);
    if (value.deduped === true || value.truncated === true) partial = true;
    if (Array.isArray(value.children)) for (const child of value.children) pending.push(child);
  }
  return {
    ...record,
    nodes,
    truncated: partial,
    requestedNodeId: object(record.scope) ? record.scope.nodeId : undefined,
    tokens:
      object(record.variables) && Array.isArray(record.variables.variables)
        ? record.variables.variables
        : [],
    collections:
      object(record.variables) && Array.isArray(record.variables.collections)
        ? record.variables.collections
        : [],
    ...(document.globalVars === undefined ? {} : { globalVars: document.globalVars }),
  };
};

type JsonRecord = Record<string, DesignJson>;
const jsonObject = (value: DesignJson | undefined): value is JsonRecord => object(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024;
const pointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const canonical = (value: DesignJson): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (jsonObject(value))
    return `{${Object.keys(value)
      .toSorted()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: DesignJson): string =>
  `sha256:${createHash('sha256').update('sfp-design-observation-v1\0').update(canonical(value)).digest('hex')}`;
const capabilityNames: DesignCapabilityName[] = [
  'tree',
  'variables',
  'collections',
  'paintStyles',
  'textStyles',
  'effectStyles',
  'gridStyles',
  'bindings',
  'componentApis',
  'interactions',
];

const variableTypes = new Set(['BOOLEAN', 'COLOR', 'EASING', 'FLOAT', 'STRING', 'TIMING']);
const easingTypes = new Set([
  'EASE_IN',
  'EASE_OUT',
  'EASE_IN_AND_OUT',
  'LINEAR',
  'EASE_IN_BACK',
  'EASE_OUT_BACK',
  'EASE_IN_AND_OUT_BACK',
  'CUSTOM_CUBIC_BEZIER',
  'GENTLE',
  'QUICK',
  'BOUNCY',
  'SLOW',
  'CUSTOM_SPRING',
  'HOLD',
]);
const finite = (value: DesignJson | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const unit = (value: DesignJson | undefined): value is number =>
  finite(value) && value >= 0 && value <= 1;
/** Recognize captured value families without coercing raw values or guessing future types. */
const validVariableValue = (type: string, value: DesignJson): boolean => {
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  if (type === 'STRING') return typeof value === 'string';
  if (type === 'FLOAT' || type === 'TIMING') return finite(value);
  if (!jsonObject(value)) return false;
  if (type === 'COLOR')
    return (
      unit(value.r) &&
      unit(value.g) &&
      unit(value.b) &&
      (value.a === undefined || unit(value.a)) &&
      (value.hex === undefined ||
        (typeof value.hex === 'string' && /^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/.test(value.hex)))
    );
  if (type !== 'EASING' || typeof value.type !== 'string' || !easingTypes.has(value.type))
    return false;
  const bezier = value.easingFunctionCubicBezier,
    spring = value.easingFunctionSpring;
  if (
    (value.type === 'CUSTOM_CUBIC_BEZIER' && bezier === undefined) ||
    (value.type === 'CUSTOM_SPRING' && spring === undefined)
  )
    return false;
  if (
    bezier !== undefined &&
    (!jsonObject(bezier) ||
      !unit(bezier.x1) ||
      !finite(bezier.y1) ||
      !unit(bezier.x2) ||
      !finite(bezier.y2))
  )
    return false;
  return spring === undefined || (jsonObject(spring) && unit(spring.bounce));
};

/**
 * A bounded semantic adapter. Its output describes observations; it never grants capture authority.
 * Raw legacy success/coverage fields deliberately cannot supply the external collector evidence.
 */
export function normalizeDesignObservation(
  input: unknown,
  collectorEvidence?: DesignCollectorEvidence,
): DesignObservation {
  if (!isBoundedDesignJson(input) || !jsonObject(input))
    throw new Error('DESIGN_OBSERVATION_JSON_INVALID');
  // Own the retained raw bytes: subsequent caller mutation cannot change an observation's evidence.
  const raw = JSON.parse(JSON.stringify(input)) as JsonRecord;
  const source =
    raw.source === 'desktop-plugin' || raw.source === 'figma-plugin-api-pinned'
      ? 'desktop'
      : raw.source === 'figma-plugin-api-via-scripter'
        ? 'chrome'
        : null;
  if (source === null) throw new Error('DESIGN_OBSERVATION_SOURCE_UNSUPPORTED');
  const document = jsonObject(raw.document) ? raw.document : {};
  const definitions = jsonObject(raw.variables) ? raw.variables : {};
  const tree =
    source === 'chrome' || raw.source === 'figma-plugin-api-pinned'
      ? raw.nodes
      : (document.children ??
        document.nodes ??
        (jsonObject(document.node) ? [document.node] : undefined));
  const variableRows =
    source === 'chrome' || raw.source === 'figma-plugin-api-pinned'
      ? raw.tokens
      : definitions.variables;
  const collectionRows =
    source === 'chrome' || raw.source === 'figma-plugin-api-pinned'
      ? raw.collections
      : definitions.collections;
  const styles = jsonObject(raw.styles) ? raw.styles : {};
  const issues: DesignObservation['issues'] = [];
  const incomplete = new Set<DesignCapabilityName>();
  const issue = (
    code: DesignObservation['issues'][number]['code'],
    scope: string,
    capability: DesignCapabilityName,
  ) => {
    incomplete.add(capability);
    if (issues.length < DESIGN_OBSERVATION_LIMITS.issues)
      issues.push({ code, scope: scope.slice(0, 4096) });
  };
  const rows = (value: DesignJson | undefined, scope: DesignCapabilityName): JsonRecord[] => {
    if (!Array.isArray(value)) {
      if (value !== undefined) issue('MALFORMED', scope, scope);
      return [];
    }
    if (value.length > DESIGN_OBSERVATION_LIMITS.catalogEntries) issue('LIMIT', scope, scope);
    const ids = new Set<string>();
    const result: JsonRecord[] = [];
    for (const row of value.slice(0, DESIGN_OBSERVATION_LIMITS.catalogEntries)) {
      if (!jsonObject(row) || !validId(row.id)) {
        issue('MALFORMED', scope, scope);
        continue;
      }
      if (ids.has(row.id)) {
        issue('DUPLICATE_ID', `${scope}/${pointer(row.id)}`, scope);
        continue;
      }
      ids.add(row.id);
      result.push(row);
    }
    return result;
  };
  const catalogs: DesignObservation['catalogs'] = {
    variables: [],
    collections: [],
    paintStyles: rows(styles.paints, 'paintStyles'),
    textStyles: rows(styles.texts, 'textStyles'),
    effectStyles: rows(styles.effects, 'effectStyles'),
    gridStyles: rows(styles.grids, 'gridStyles'),
    styleVariables: jsonObject(styles.variables) ? styles.variables : {},
    ...(document.globalVars === undefined && raw.globalVars === undefined
      ? {}
      : { globalVars: document.globalVars ?? raw.globalVars! }),
  };
  if (raw.styles !== undefined && !jsonObject(raw.styles))
    for (const name of ['paintStyles', 'textStyles', 'effectStyles', 'gridStyles'] as const)
      issue('MALFORMED', 'styles', name);
  if (styles.variables !== undefined && !jsonObject(styles.variables))
    for (const name of ['paintStyles', 'textStyles', 'effectStyles', 'gridStyles'] as const)
      issue('MALFORMED', 'styles/variables', name);
  for (const [name, field] of [
    ['paintStyles', 'paints'],
    ['effectStyles', 'effects'],
    ['gridStyles', 'grids'],
  ] as const) {
    for (const style of catalogs[name])
      if (!Array.isArray(style[field]) || style[field].some(entry => !jsonObject(entry)))
        issue('MALFORMED', `${name}/${pointer(style.id as string)}`, name);
  }
  for (const style of catalogs.textStyles)
    if (!jsonObject(style.fontName) || typeof style.fontSize !== 'number')
      issue('MALFORMED', `textStyles/${pointer(style.id as string)}`, 'textStyles');
  for (const row of rows(variableRows, 'variables')) {
    const collectionId = row.collectionId ?? row.variableCollectionId;
    if (
      !validId(collectionId) ||
      !jsonObject(row.valuesByMode) ||
      (row.collectionId !== undefined &&
        row.variableCollectionId !== undefined &&
        row.collectionId !== row.variableCollectionId)
    ) {
      issue('MALFORMED', `variables/${pointer(row.id as string)}`, 'variables');
      continue;
    }
    catalogs.variables.push({
      id: row.id as string,
      collectionId,
      valuesByMode: row.valuesByMode,
      raw: row,
    });
  }
  for (const row of rows(collectionRows, 'collections')) {
    if (
      !Array.isArray(row.modes) ||
      row.modes.length > 128 ||
      row.modes.some(mode => !jsonObject(mode) || !validId(mode.modeId)) ||
      new Set(row.modes.map(mode => (mode as JsonRecord).modeId)).size !== row.modes.length
    ) {
      issue('MALFORMED', `collections/${pointer(row.id as string)}`, 'collections');
      continue;
    }
    catalogs.collections.push({ id: row.id as string, raw: row });
  }
  const nodes: DesignObservation['nodes'] = [];
  const byId = new Map<string, DesignObservation['nodes'][number]>();
  const roots: string[] = [];
  if (!Array.isArray(tree)) issue('MALFORMED', 'tree', 'tree');
  const pending = (Array.isArray(tree) ? tree : [])
    .map(value => ({ value, parentId: null as string | null }))
    .toReversed();
  while (pending.length) {
    if (nodes.length >= DESIGN_OBSERVATION_LIMITS.nodes) {
      issue('LIMIT', 'tree', 'tree');
      break;
    }
    const { value, parentId } = pending.pop()!;
    if (!jsonObject(value) || !validId(value.id) || !validId(value.type)) {
      issue('MALFORMED', 'tree', 'tree');
      continue;
    }
    if (byId.has(value.id)) {
      issue('DUPLICATE_ID', `tree/${pointer(value.id)}`, 'tree');
      continue;
    }
    const properties = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'children'),
    );
    const node = { id: value.id, parentId, childIds: [] as string[], properties };
    nodes.push(node);
    byId.set(node.id, node);
    if (parentId === null) roots.push(node.id);
    else byId.get(parentId)!.childIds.push(node.id);
    if (
      value.truncated === true ||
      value.deduped === true ||
      (typeof value.omittedChildren === 'number' && value.omittedChildren > 0)
    )
      issue('SOURCE_PARTIAL', `tree/${pointer(value.id)}`, 'tree');
    if (value.children !== undefined && !Array.isArray(value.children))
      issue('MALFORMED', `tree/${pointer(value.id)}/children`, 'tree');
    if (Array.isArray(value.children))
      for (let index = value.children.length - 1; index >= 0; index--)
        pending.push({ value: value.children[index]!, parentId: node.id });
  }
  if (raw.truncated === true || document.sectionPlan !== undefined)
    issue('SOURCE_PARTIAL', 'tree', 'tree');
  // Value loss may affect any catalog; an unfinished tree alone does not invalidate an
  // independently observed complete catalog and its exact enumeration count.
  if (raw.valueTruncated === true) {
    for (const name of capabilityNames) issue('SOURCE_PARTIAL', name, name);
  }
  const variables = new Map(catalogs.variables.map(variable => [variable.id, variable]));
  const collections = new Map(catalogs.collections.map(collection => [collection.id, collection]));
  const bindings: DesignObservation['bindings'] = [];
  let resolutionSteps = 0;
  const bind = (
    node: DesignObservation['nodes'][number],
    property: string,
    variableId: string,
    renderedValue?: DesignJson,
  ) => {
    if (bindings.length >= DESIGN_OBSERVATION_LIMITS.bindings || property.length > 4096) {
      issue('LIMIT', 'bindings', 'bindings');
      return;
    }
    const result: DesignBindingObservation = {
      nodeId: node.id,
      property,
      variableId,
      status: 'unresolved',
      modeSelections: [],
      aliasChain: [],
      ...(renderedValue === undefined ? {} : { renderedValue }),
    };
    let currentId = variableId;
    let expectedType: string | undefined;
    while (true) {
      if (++resolutionSteps > DESIGN_OBSERVATION_LIMITS.values) {
        result.reason = 'ALIAS_LIMIT';
        issue('LIMIT', 'bindings', 'bindings');
        break;
      }
      if (result.aliasChain.includes(currentId)) {
        result.reason = 'ALIAS_CYCLE';
        break;
      }
      if (result.aliasChain.length >= 128) {
        result.reason = 'ALIAS_LIMIT';
        break;
      }
      result.aliasChain.push(currentId);
      const variable = variables.get(currentId);
      if (!variable) {
        result.reason = 'VARIABLE_MISSING';
        break;
      }
      const resolvedType = variable.raw.resolvedType;
      if (
        typeof resolvedType !== 'string' ||
        !variableTypes.has(resolvedType) ||
        (expectedType !== undefined && resolvedType !== expectedType)
      ) {
        result.reason = 'MALFORMED_VALUE';
        break;
      }
      expectedType ??= resolvedType;
      const collection = collections.get(variable.collectionId);
      if (!collection) {
        result.reason = 'COLLECTION_MISSING';
        break;
      }
      let cursor: typeof node | undefined = node;
      let selection: DesignBindingObservation['modeSelections'][number] | undefined;
      let malformedMode = false;
      while (cursor && !selection) {
        if (++resolutionSteps > DESIGN_OBSERVATION_LIMITS.values) {
          result.reason = 'ALIAS_LIMIT';
          issue('LIMIT', 'bindings', 'bindings');
          break;
        }
        for (const [field, basis] of [
          ['resolvedVariableModes', 'resolved'],
          ['explicitVariableModes', 'explicit'],
        ] as const) {
          const modes = cursor.properties[field];
          if (
            modes !== undefined &&
            (!jsonObject(modes) ||
              (Object.hasOwn(modes, collection.id) && !validId(modes[collection.id])))
          ) {
            malformedMode = true;
            break;
          }
          if (jsonObject(modes) && validId(modes[collection.id])) {
            selection = {
              collectionId: collection.id,
              modeId: modes[collection.id] as string,
              nodeId: cursor.id,
              basis,
            };
            break;
          }
        }
        if (malformedMode) break;
        cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
      }
      if (result.reason === 'ALIAS_LIMIT') break;
      if (!selection) {
        result.reason = 'MODE_UNOBSERVED';
        break;
      }
      result.modeSelections.push(selection);
      if (
        !(collection.raw.modes as JsonRecord[]).some(mode => mode.modeId === selection.modeId) ||
        !Object.hasOwn(variable.valuesByMode, selection.modeId)
      ) {
        result.reason = 'MODE_MISSING';
        break;
      }
      const value = variable.valuesByMode[selection.modeId]!;
      if (jsonObject(value) && value.type === 'VARIABLE_ALIAS') {
        if (!validId(value.id)) {
          result.reason = 'MALFORMED_VALUE';
          break;
        }
        currentId = value.id;
      } else if (!validVariableValue(resolvedType, value)) {
        result.reason = 'MALFORMED_VALUE';
        break;
      } else {
        result.status = 'resolved';
        result.value = value;
        break;
      }
    }
    bindings.push(result);
    if (result.status === 'unresolved')
      issue('UNRESOLVED_BINDING', `${node.id}${property}`, 'bindings');
  };
  const interactions: DesignObservation['interactions'] = [];
  let bindingObserved = false,
    interactionObserved = false,
    componentObserved = false;
  for (const node of nodes) {
    const queue: Array<{ value: DesignJson; path: string }> = [
      { value: node.properties, path: '' },
    ];
    while (queue.length) {
      const { value, path } = queue.pop()!;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--)
          queue.push({ value: value[index]!, path: `${path}/${index}` });
        continue;
      }
      if (!jsonObject(value)) continue;
      if (value.boundVariables !== undefined) {
        bindingObserved = true;
        if (!jsonObject(value.boundVariables))
          issue('MALFORMED', `${node.id}${path}/boundVariables`, 'bindings');
        else
          for (const [field, references] of Object.entries(value.boundVariables)) {
            const refs = Array.isArray(references) ? references : [references];
            for (const [index, reference] of refs.entries()) {
              const variableId =
                typeof reference === 'string'
                  ? reference
                  : jsonObject(reference) && reference.type === 'VARIABLE_ALIAS'
                    ? reference.id
                    : undefined;
              if (!validId(variableId)) {
                issue(
                  'MALFORMED',
                  `${node.id}${path}/boundVariables/${pointer(field)}`,
                  'bindings',
                );
                continue;
              }
              const suffix = Array.isArray(references) ? `/${index}` : '';
              const rendered =
                Array.isArray(references) && Array.isArray(value[field])
                  ? value[field][index]
                  : value[field];
              bind(node, `${path}/${pointer(field)}${suffix}`, variableId, rendered);
            }
          }
      }
      for (const [key, child] of Object.entries(value))
        if (key !== 'boundVariables') queue.push({ value: child, path: `${path}/${pointer(key)}` });
    }
    if (
      node.properties.componentPropertyDefinitions !== undefined ||
      node.properties.componentApi !== undefined
    ) {
      componentObserved = true;
      for (const field of ['componentPropertyDefinitions', 'componentApi'])
        if (node.properties[field] !== undefined && !jsonObject(node.properties[field]))
          issue('MALFORMED', `${node.id}/${field}`, 'componentApis');
    }
    const reactions = node.properties.reactions;
    if (reactions === undefined) continue;
    interactionObserved = true;
    if (!Array.isArray(reactions)) {
      issue('MALFORMED', `${node.id}/reactions`, 'interactions');
      continue;
    }
    if (reactions.length > 4096) issue('LIMIT', `${node.id}/reactions`, 'interactions');
    for (const [index, reaction] of reactions.slice(0, 4096).entries()) {
      if (interactions.length >= DESIGN_OBSERVATION_LIMITS.interactions) {
        issue('LIMIT', 'interactions', 'interactions');
        break;
      }
      if (!jsonObject(reaction)) {
        issue('MALFORMED', `${node.id}/reactions/${index}`, 'interactions');
        continue;
      }
      const actions = Array.isArray(reaction.actions)
        ? reaction.actions
        : reaction.action === undefined
          ? []
          : [reaction.action];
      // Recognizing the wire family is not execution support; downstream recipes must cover semantics.
      const triggers = [
        'ON_CLICK',
        'ON_HOVER',
        'ON_PRESS',
        'ON_DRAG',
        'AFTER_TIMEOUT',
        'MOUSE_UP',
        'MOUSE_DOWN',
        'MOUSE_ENTER',
        'MOUSE_LEAVE',
        'ON_KEY_DOWN',
        'ON_MEDIA_HIT',
        'ON_MEDIA_END',
      ];
      const actionTypes = new Set([
        'BACK',
        'CLOSE',
        'URL',
        'NODE',
        'UPDATE_MEDIA_RUNTIME',
        'SET_VARIABLE',
        'SET_VARIABLE_MODE',
        'CONDITIONAL',
      ]);
      const supported =
        jsonObject(reaction.trigger) &&
        typeof reaction.trigger.type === 'string' &&
        triggers.includes(reaction.trigger.type) &&
        actions.length > 0 &&
        actions.length <= 4096 &&
        actions.every(
          action =>
            jsonObject(action) && typeof action.type === 'string' && actionTypes.has(action.type),
        );
      if (!supported)
        issue('UNSUPPORTED_INTERACTION', `${node.id}/reactions/${index}`, 'interactions');
      const rawHash = digest(reaction);
      interactions.push({
        id: digest([node.id, index, reaction]),
        nodeId: node.id,
        index,
        rawHash,
        trigger: reaction.trigger ?? null,
        actions: actions.slice(0, 4096),
        raw: reaction,
        status: supported ? 'observed' : 'unsupported',
      });
    }
  }
  const scope = Object.fromEntries(
    ['pageId', 'scopeNodeId', 'scopeType', 'scope', 'requestedNodeId']
      .filter(key => raw[key] !== undefined)
      .map(key => [key, raw[key]!]),
  ) as JsonRecord;
  // The original semantic containers also bind rejected/duplicate entries; timing is not content.
  const contentHash = digest({
    source,
    scope,
    tree: tree ?? null,
    variables: variableRows ?? null,
    collections: collectionRows ?? null,
    styles: raw.styles ?? null,
    globalVars: document.globalVars ?? raw.globalVars ?? null,
  });
  if (collectorEvidence !== undefined && !isBoundedDesignJson(collectorEvidence))
    throw new Error('DESIGN_OBSERVATION_EVIDENCE_INVALID');
  const evidence =
    collectorEvidence === undefined
      ? undefined
      : DesignCollectorEvidenceSchema.parse(collectorEvidence);
  if (evidence && evidence.contentHash !== contentHash)
    throw new Error('DESIGN_OBSERVATION_EVIDENCE_MISMATCH');
  const observed: Record<DesignCapabilityName, boolean> = {
    tree: Array.isArray(tree),
    variables: Array.isArray(variableRows),
    collections: Array.isArray(collectionRows),
    paintStyles: Array.isArray(styles.paints),
    textStyles: Array.isArray(styles.texts),
    effectStyles: Array.isArray(styles.effects),
    gridStyles: Array.isArray(styles.grids),
    bindings: bindingObserved,
    componentApis: componentObserved,
    interactions: interactionObserved,
  };
  const counts: Record<DesignCapabilityName, number> = {
    tree: nodes.length,
    variables: catalogs.variables.length,
    collections: catalogs.collections.length,
    paintStyles: catalogs.paintStyles.length,
    textStyles: catalogs.textStyles.length,
    effectStyles: catalogs.effectStyles.length,
    gridStyles: catalogs.gridStyles.length,
    bindings: bindings.length,
    componentApis: nodes.filter(
      node =>
        node.properties.componentPropertyDefinitions !== undefined ||
        node.properties.componentApi !== undefined,
    ).length,
    interactions: interactions.length,
  };
  const capabilities: DesignObservation['capabilities'] = capabilityNames.map(name => {
    const proof = evidence?.capabilities.find(item => item.name === name);
    if (proof) {
      const success = proof.status === 'complete' || proof.status === 'empty';
      const emptyNodeCapability =
        proof.status === 'empty' &&
        ['bindings', 'componentApis', 'interactions'].includes(name) &&
        observed.tree &&
        !incomplete.has('tree');
      const nodeCapability = ['bindings', 'componentApis', 'interactions'].includes(name);
      if (
        (success && nodeCapability && (!observed.tree || incomplete.has('tree'))) ||
        (success && proof.count !== counts[name]) ||
        (!success && proof.count !== null && proof.count < counts[name]) ||
        (success && (incomplete.has(name) || (!observed[name] && !emptyNodeCapability))) ||
        (proof.status === 'complete' && proof.count === 0) ||
        (proof.status === 'empty' && proof.count !== 0)
      )
        throw new Error('DESIGN_OBSERVATION_CAPABILITY_MISMATCH');
      return {
        name,
        status: proof.status,
        count: proof.count,
        retainedCount: counts[name],
        evidence: 'collector-observed',
        reason: success
          ? 'ENUMERATION_COMPLETE'
          : proof.status === 'failed'
            ? 'API_FAILED'
            : proof.status === 'unsupported'
              ? 'API_UNSUPPORTED'
              : 'SOURCE_PARTIAL',
      };
    }
    return {
      name,
      status: incomplete.has(name) || observed[name] ? 'partial' : 'unsupported',
      count: null,
      retainedCount: counts[name],
      evidence: 'legacy-unverified',
      reason: incomplete.has(name)
        ? 'SOURCE_PARTIAL'
        : observed[name]
          ? 'ENUMERATION_UNVERIFIED'
          : 'API_NOT_OBSERVED',
    };
  });
  return DesignObservationSchema.parse({
    observationVersion: 1,
    source,
    authority: evidence ? 'collector-observed' : 'legacy-unverified',
    contentHash,
    raw,
    roots,
    nodes,
    catalogs,
    bindings,
    interactions,
    capabilities,
    coherence: evidence?.coherence ?? { status: 'unverified', atomic: false },
    sourceBinding: evidence?.sourceBinding ?? { status: 'unverified' },
    issues,
  });
}

/** Preserve distinct usages even when immutable image bytes can later share one fetch. */
export function planDesignImageReferences(
  observation: DesignObservation,
): Array<{ nodeId: string; property: string; imageHash: string }> {
  const references: Array<{ nodeId: string; property: string; imageHash: string }> = [];
  const scanPaints = (nodeId: string, value: DesignJson | undefined, path: string) => {
    if (!Array.isArray(value)) return;
    for (const [index, paint] of value.entries()) {
      if (!jsonObject(paint) || paint.type !== 'IMAGE' || !validId(paint.imageHash)) continue;
      if (references.length >= DESIGN_OBSERVATION_LIMITS.bindings)
        throw new Error('DESIGN_IMAGE_REFERENCE_LIMIT');
      references.push({ nodeId, property: `${path}/${index}`, imageHash: paint.imageHash });
    }
  };
  for (const node of observation.nodes) {
    for (const field of ['fills', 'strokes'])
      scanPaints(node.id, node.properties[field], `/${field}`);
    for (const field of ['textSegments', 'segments']) {
      const segments = node.properties[field];
      if (Array.isArray(segments))
        for (const [index, segment] of segments.entries())
          if (jsonObject(segment)) {
            for (const paintField of ['fills', 'strokes'])
              scanPaints(node.id, segment[paintField], `/${field}/${index}/${paintField}`);
          }
    }
  }
  return references;
}
