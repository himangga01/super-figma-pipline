import { z } from 'zod';

export type DesignJson =
  | null
  | boolean
  | number
  | string
  | DesignJson[]
  | { [key: string]: DesignJson };

export const DESIGN_OBSERVATION_LIMITS = {
  rawBytes: 16 * 1024 * 1024,
  values: 500_000,
  depth: 128,
  nodes: 100_000,
  catalogEntries: 10_000,
  bindings: 100_000,
  interactions: 100_000,
  issues: 256,
} as const;

/** Validate before any recursive JSON/schema operation; never invoke accessors or toJSON. */
export function isBoundedDesignJson(
  value: unknown,
  maxBytes: number = DESIGN_OBSERVATION_LIMITS.rawBytes,
  maxValues: number = DESIGN_OBSERVATION_LIMITS.values,
): value is DesignJson {
  let values = 0,
    bytes = 0;
  const stringBytes = (text: string) => {
    bytes += 2;
    for (const character of text) {
      const code = character.codePointAt(0)!;
      bytes +=
        code === 34 || code === 92
          ? 2
          : code < 32
            ? [8, 9, 10, 12, 13].includes(code)
              ? 2
              : 6
            : code < 128
              ? 1
              : code < 2048
                ? 2
                : code >= 0xd800 && code <= 0xdfff
                  ? 6
                  : code < 65536
                    ? 3
                    : 4;
      if (bytes > maxBytes) return false;
    }
    return bytes <= maxBytes;
  };
  const active = new Set<object>();
  const pending: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.exit) {
      active.delete(item.value as object);
      continue;
    }
    if (++values > maxValues || item.depth > DESIGN_OBSERVATION_LIMITS.depth || bytes > maxBytes)
      return false;
    const current = item.value;
    if (current === null || typeof current === 'boolean') {
      bytes += current === false ? 5 : 4;
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      bytes += JSON.stringify(current).length;
      continue;
    }
    if (typeof current === 'string') {
      if (!stringBytes(current)) return false;
      continue;
    }
    if (typeof current !== 'object' || active.has(current)) return false;
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (!array && prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) return false;
    if (array ? keys.length > 100_001 : keys.length > 10_000) return false;
    bytes += 2 + Math.max(0, keys.length - (array ? 2 : 1));
    active.add(current);
    pending.push({ value: current, depth: item.depth, exit: true });
    for (const key of keys as string[]) {
      if (array && key === 'length') continue;
      if (!array) {
        if (!stringBytes(key)) return false;
        bytes++;
      }
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) return false;
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
    if (array && keys.length !== current.length + 1) return false;
  }
  return bytes <= maxBytes;
}

const json = z.custom<DesignJson>(isBoundedDesignJson, 'DESIGN_OBSERVATION_JSON_INVALID');
const record = z.record(z.string().max(1024), json);
const id = z.string().min(1).max(1024);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const DesignCapabilityNameSchema = z.enum([
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
]);
export type DesignCapabilityName = z.infer<typeof DesignCapabilityNameSchema>;
export const DesignCapabilitySchema = z
  .strictObject({
    name: DesignCapabilityNameSchema,
    status: z.enum(['complete', 'empty', 'partial', 'unsupported', 'failed']),
    // Collector enumeration count can be unknown even when some rows were retained.
    count: z.number().int().min(0).max(100_000).nullable(),
    retainedCount: z.number().int().min(0).max(100_000),
    evidence: z.enum(['legacy-unverified', 'collector-observed']),
    reason: z.enum([
      'API_NOT_OBSERVED',
      'ENUMERATION_UNVERIFIED',
      'ENUMERATION_COMPLETE',
      'SOURCE_PARTIAL',
      'API_UNSUPPORTED',
      'API_FAILED',
    ]),
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === 'complete' &&
        (value.count === null || value.count === 0 || value.count !== value.retainedCount)) ||
      (value.status === 'empty' && (value.count !== 0 || value.retainedCount !== 0))
    )
      ctx.addIssue({ code: 'custom', message: 'CAPABILITY_COUNT_UNVERIFIED' });
    if (
      value.evidence === 'legacy-unverified' &&
      (value.status === 'complete' || value.status === 'empty')
    )
      ctx.addIssue({ code: 'custom', message: 'LEGACY_CAPABILITY_UNVERIFIED' });
  });

export const DesignCoherenceSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unverified'), atomic: z.literal(false) }),
  z.strictObject({
    status: z.literal('observed'),
    atomic: z.literal(false),
    method: z.enum(['content-reobservation', 'document-epoch']),
    before: id,
    after: id,
    contentHash: hash,
    outcome: z.enum(['matched', 'changed', 'failed']),
  }),
]);
const coherenceMatchesContent = (
  coherence: z.infer<typeof DesignCoherenceSchema>,
  contentHash: string,
): boolean =>
  coherence.status !== 'observed' ||
  (coherence.contentHash === contentHash &&
    (coherence.outcome !== 'matched' || coherence.before === coherence.after));
export const DesignSourceBindingSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unverified') }),
  z.strictObject({
    status: z.literal('observed'),
    fileIdentityHash: hash,
    scopeId: id,
    sessionId: id,
    generation: id,
    method: z.enum(['file-key', 'owner-confirmed-document']),
  }),
]);

/** A collector assertion is typed evidence, not an authorization grant or live verification. */
export const DesignCollectorEvidenceSchema = z
  .strictObject({
    evidenceVersion: z.literal(1),
    contentHash: hash,
    capabilities: z
      .array(
        z.strictObject({
          name: DesignCapabilityNameSchema,
          status: z.enum(['complete', 'empty', 'partial', 'unsupported', 'failed']),
          count: z.number().int().min(0).max(100_000).nullable(),
        }),
      )
      .max(10),
    coherence: DesignCoherenceSchema,
    sourceBinding: DesignSourceBindingSchema,
  })
  .superRefine((value, ctx) => {
    for (const capability of value.capabilities) {
      if (
        (capability.status === 'complete' &&
          (capability.count === null || capability.count === 0)) ||
        (capability.status === 'empty' && capability.count !== 0)
      )
        ctx.addIssue({ code: 'custom', message: 'CAPABILITY_COUNT_UNVERIFIED' });
    }
    if (new Set(value.capabilities.map(item => item.name)).size !== value.capabilities.length)
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_CAPABILITY' });
    if (!coherenceMatchesContent(value.coherence, value.contentHash))
      ctx.addIssue({ code: 'custom', message: 'COHERENCE_EVIDENCE_MISMATCH' });
  });
export type DesignCollectorEvidence = z.infer<typeof DesignCollectorEvidenceSchema>;

export const DesignBindingObservationSchema = z
  .strictObject({
    nodeId: id,
    property: z.string().min(1).max(4096),
    variableId: id,
    status: z.enum(['resolved', 'unresolved']),
    modeSelections: z
      .array(
        z.strictObject({
          collectionId: id,
          modeId: id,
          nodeId: id,
          basis: z.enum(['resolved', 'explicit']),
        }),
      )
      .max(128),
    aliasChain: z.array(id).max(128),
    value: json.optional(),
    renderedValue: json.optional(),
    reason: z
      .enum([
        'VARIABLE_MISSING',
        'COLLECTION_MISSING',
        'MODE_UNOBSERVED',
        'MODE_MISSING',
        'ALIAS_CYCLE',
        'ALIAS_LIMIT',
        'MALFORMED_VALUE',
      ])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === 'resolved'
        ? value.value === undefined || value.reason !== undefined
        : value.reason === undefined || value.value !== undefined
    )
      ctx.addIssue({ code: 'custom', message: 'BINDING_RESOLUTION_INCONSISTENT' });
  });
export type DesignBindingObservation = z.infer<typeof DesignBindingObservationSchema>;

export const DesignInteractionObservationSchema = z.strictObject({
  id,
  nodeId: id,
  index: z.number().int().min(0),
  rawHash: hash,
  trigger: json,
  actions: z.array(json).max(4096),
  raw: record,
  status: z.enum(['observed', 'unsupported']),
});

const ObservationShape = z
  .strictObject({
    observationVersion: z.literal(1),
    source: z.enum(['chrome', 'desktop']),
    authority: z.enum(['legacy-unverified', 'collector-observed']),
    contentHash: hash,
    raw: record.refine(value => isBoundedDesignJson(value), 'DESIGN_OBSERVATION_RAW_LIMIT'),
    roots: z.array(id).max(DESIGN_OBSERVATION_LIMITS.nodes),
    nodes: z
      .array(
        z.strictObject({
          id,
          parentId: id.nullable(),
          childIds: z.array(id).max(DESIGN_OBSERVATION_LIMITS.nodes),
          properties: record,
        }),
      )
      .max(DESIGN_OBSERVATION_LIMITS.nodes),
    catalogs: z.strictObject({
      variables: z
        .array(z.strictObject({ id, collectionId: id, valuesByMode: record, raw: record }))
        .max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      collections: z
        .array(z.strictObject({ id, raw: record }))
        .max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      paintStyles: z.array(record).max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      textStyles: z.array(record).max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      effectStyles: z.array(record).max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      gridStyles: z.array(record).max(DESIGN_OBSERVATION_LIMITS.catalogEntries),
      styleVariables: record,
      globalVars: json.optional(),
    }),
    bindings: z.array(DesignBindingObservationSchema).max(DESIGN_OBSERVATION_LIMITS.bindings),
    interactions: z
      .array(DesignInteractionObservationSchema)
      .max(DESIGN_OBSERVATION_LIMITS.interactions),
    capabilities: z.array(DesignCapabilitySchema).length(10),
    coherence: DesignCoherenceSchema,
    sourceBinding: DesignSourceBindingSchema,
    issues: z
      .array(
        z.strictObject({
          code: z.enum([
            'MALFORMED',
            'DUPLICATE_ID',
            'LIMIT',
            'SOURCE_PARTIAL',
            'UNRESOLVED_BINDING',
            'UNSUPPORTED_INTERACTION',
          ]),
          scope: z.string().min(1).max(4096),
        }),
      )
      .max(DESIGN_OBSERVATION_LIMITS.issues),
  })
  .superRefine((value, ctx) => {
    const nodeIds = new Set(value.nodes.map(node => node.id));
    if (
      nodeIds.size !== value.nodes.length ||
      new Set(value.roots).size !== value.roots.length ||
      new Set(value.capabilities.map(capability => capability.name)).size !==
        value.capabilities.length
    )
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_OBSERVATION_ID' });
    const byId = new Map(value.nodes.map(node => [node.id, node]));
    const incoming = new Map<string, number>();
    let invalid = false,
      edgeCount = 0;
    for (const node of value.nodes) {
      if (
        Object.hasOwn(node.properties, 'children') ||
        (node.parentId !== null && !byId.has(node.parentId)) ||
        new Set(node.childIds).size !== node.childIds.length
      )
        invalid = true;
      for (const child of node.childIds) {
        if (++edgeCount > DESIGN_OBSERVATION_LIMITS.nodes) {
          invalid = true;
          break;
        }
        if (byId.get(child)?.parentId !== node.id) invalid = true;
        incoming.set(child, (incoming.get(child) ?? 0) + 1);
      }
      if (edgeCount > DESIGN_OBSERVATION_LIMITS.nodes) break;
    }
    for (const node of value.nodes)
      if ((incoming.get(node.id) ?? 0) !== (node.parentId === null ? 0 : 1)) invalid = true;
    // Valid parent/child membership plus root reachability rules out disconnected cycles.
    const reached = new Set<string>();
    const pending = [...value.roots];
    if (!invalid)
      while (pending.length) {
        const nodeId = pending.pop()!;
        if (reached.has(nodeId)) {
          invalid = true;
          break;
        }
        reached.add(nodeId);
        const node = byId.get(nodeId);
        if (!node) {
          invalid = true;
          break;
        }
        for (const child of node.childIds) pending.push(child);
      }
    if (invalid || reached.size !== value.nodes.length)
      ctx.addIssue({ code: 'custom', message: 'NODE_RELATIONSHIP_INVALID' });
    if (
      value.roots.length !== value.nodes.filter(node => node.parentId === null).length ||
      value.roots.some(root => !nodeIds.has(root) || byId.get(root)?.parentId !== null)
    )
      ctx.addIssue({ code: 'custom', message: 'ROOT_RELATIONSHIP_INVALID' });
    if (!coherenceMatchesContent(value.coherence, value.contentHash))
      ctx.addIssue({ code: 'custom', message: 'COHERENCE_EVIDENCE_MISMATCH' });
    if (
      value.authority === 'legacy-unverified' &&
      (value.coherence.status !== 'unverified' ||
        value.sourceBinding.status !== 'unverified' ||
        value.capabilities.some(capability => capability.evidence !== 'legacy-unverified'))
    )
      ctx.addIssue({ code: 'custom', message: 'LEGACY_OBSERVATION_UNVERIFIED' });
  });
export const DesignObservationSchema = z.preprocess((value, ctx) => {
  if (!isBoundedDesignJson(value, 64 * 1024 * 1024, 2_000_000)) {
    ctx.addIssue({ code: 'custom', message: 'DESIGN_OBSERVATION_JSON_INVALID' });
    return z.NEVER;
  }
  return value;
}, ObservationShape);
export type DesignObservation = z.infer<typeof DesignObservationSchema>;
