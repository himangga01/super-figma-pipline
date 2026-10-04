import type { BatchResult } from '@sfp/shared';

import type {
  SandboxExecutionContext,
  SandboxHandlers,
  SandboxToolHandler,
} from '../dispatcher.js';
import {
  captureCreatedNode,
  createdNodeStillOwned,
  CREATED_NODE_PROPERTY,
  observeCreatedFields,
  type CreatedNodeSnapshot,
} from './batch-created.js';
import { assertFigmaEditor, isMotionNode, toPlainJson } from './motion-shared.js';
import { annotationBatchInverse } from './set-annotations.js';

/**
 * Apply supported invertible writes as one batch with verified, conflict-aware rollback.
 *
 * 1. Capture (read-only): resolve every op's target and snapshot what undo needs. Any failure here
 *    aborts before a single mutation, so a bad op id never leaves the document half-changed.
 * 2. Apply: run the real write handlers in order; if one throws, undo the already-applied ops in
 *    reverse and reject. Reuses the existing handlers for apply so there is no second copy of the
 *    mutation logic — this module only adds the inverse (undo) for each invertible op.
 *
 * Only ops with a registered inverse are accepted; destructive ops (delete_*, ungroup, …) have no
 * faithful inverse and are rejected before effects. Unknown effects, conflicts and unverified
 * restoration produce BATCH_PARTIAL_CHANGE, preserving concurrent edits.
 */

/** Per-op inverse. `capture` runs before any mutation; `undo` restores the pre-op state on rollback. */
interface BatchInverse {
  /**
   * Read-only: validate the target and snapshot whatever `undo` will need. Throw to abort the
   * batch.
   */
  capture(figmaCtx: typeof figma, params: unknown): Promise<unknown>;
  /** Restore the pre-op state. Receives the capture snapshot and the op's apply result. Best-effort. */
  undo(
    figmaCtx: typeof figma,
    params: unknown,
    captured: unknown,
    result: unknown,
    failure?: unknown,
    owned?: OwnedWrites,
  ): Promise<void>;
}

/** Mixed aggregates need a supported individual-field inverse; they cannot be assigned directly. */
const restorable = (value: unknown): boolean => typeof value !== 'symbol';

type OwnedWrites = ReadonlyMap<BaseNode, Record<string, unknown>>;
interface NodeSnapshot {
  id: string;
  node: BaseNode;
  snapshot: Record<string, unknown>;
}
const cloneValue = (value: unknown): unknown =>
  typeof value === 'symbol' || value === undefined ? value : toPlainJson(value);
const sameValue = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) ||
  (typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null &&
    JSON.stringify(left) === JSON.stringify(right));

/** Restore only observed writes still owned by this operation, and verify the host's result. */
const restoreOwned = (
  node: BaseNode | null,
  captured: NodeSnapshot,
  owned: OwnedWrites | undefined,
  failure: unknown,
  write?: (snapshot: Record<string, unknown>) => void,
): void => {
  if (node !== captured.node) throw new Error(`node ${captured.id} identity changed`);
  const bag = node as unknown as Record<string, unknown>;
  const writes = owned?.get(node) ?? {};
  const eligible: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const [key, previous] of Object.entries(captured.snapshot)) {
    if (!(key in writes)) {
      if (failure !== undefined && !sameValue(bag[key], previous)) conflicts.push(key);
      continue;
    }
    if (!sameValue(bag[key], writes[key])) {
      conflicts.push(key);
      continue;
    }
    // Mixed aggregate corner/stroke values are restored by their observed individual fields.
    if (restorable(previous)) eligible[key] = cloneValue(previous);
  }
  if (write !== undefined) {
    if (Object.keys(eligible).length > 0) {
      const merged = Object.fromEntries(Object.keys(captured.snapshot).map(key => [key, bag[key]]));
      write({ ...merged, ...eligible });
    }
  } else {
    for (const [key, previous] of Object.entries(eligible)) {
      // A prior restoration may update a coupled aggregate (uniform corner/stroke values).
      if (!sameValue(bag[key], writes[key]) && !sameValue(bag[key], previous)) {
        conflicts.push(key);
        continue;
      }
      bag[key] = previous;
    }
  }
  for (const key of Object.keys(eligible)) {
    if (!sameValue(bag[key], captured.snapshot[key])) conflicts.push(key);
  }
  for (const [key, previous] of Object.entries(captured.snapshot)) {
    if (typeof previous === 'symbol' && key in writes && !sameValue(bag[key], previous))
      conflicts.push(key);
  }
  if (conflicts.length > 0)
    throw new Error(`unverified or conflicting properties: ${conflicts.join(', ')}`);
};

/** Single-node op: snapshot the given properties and restore them on undo. props[0] is required. */
const nodeProps = (tool: string, props: readonly string[]): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') throw new TypeError(`batch/${tool}: nodeId must be a string`);
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null) throw new Error(`batch/${tool}: node ${id} not found`);
    const required = props[0]!;
    if (!(required in node)) throw new Error(`batch/${tool}: node ${id} has no ${required}`);
    const bag = node as unknown as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const k of props) if (k in node) snapshot[k] = cloneValue(bag[k]);
    if (
      props.some(k => typeof snapshot[k] === 'symbol') &&
      !(
        (typeof snapshot.cornerRadius === 'symbol' &&
          props.slice(1).every(k => typeof snapshot[k] === 'number')) ||
        (typeof snapshot.strokeWeight === 'symbol' &&
          ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'].every(
            k => typeof snapshot[k] === 'number',
          ))
      )
    ) {
      throw new Error(`batch/${tool}: mixed property has no faithful inverse`);
    }
    return { id, node, snapshot };
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const snapshot = captured as NodeSnapshot;
    restoreOwned(await figmaCtx.getNodeByIdAsync(snapshot.id), snapshot, owned, failure);
  },
});

/** Multi-node op: snapshot per applicable node via `read`, restore via `write` on undo. */
const nodesSnapshot = (
  tool: string,
  read: (node: SceneNode) => Record<string, unknown> | null,
  write: (node: SceneNode, snap: Record<string, unknown>) => void,
): BatchInverse => ({
  async capture(figmaCtx, params) {
    const ids = (params as { nodeIds?: unknown } | null)?.nodeIds;
    if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) {
      throw new TypeError(`batch/${tool}: nodeIds must be a string[]`);
    }
    const nodes = await Promise.all((ids as string[]).map(id => figmaCtx.getNodeByIdAsync(id)));
    const snaps: NodeSnapshot[] = [];
    nodes.forEach((node, i) => {
      if (node === null) return;
      const snap = read(node as SceneNode);
      if (snap !== null)
        snaps.push({
          id: (ids as string[])[i]!,
          node,
          snapshot: cloneValue(snap) as Record<string, unknown>,
        });
    });
    return snaps;
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const snaps = captured as NodeSnapshot[];
    const nodes = await Promise.all(snaps.map(s => figmaCtx.getNodeByIdAsync(s.id)));
    const failures: unknown[] = [];
    nodes.forEach((node, i) => {
      try {
        restoreOwned(node, snaps[i]!, owned, failure, snap => write(node as SceneNode, snap));
      } catch (error) {
        failures.push(error);
      }
    });
    if (failures.length > 0)
      throw new AggregateError(failures, 'multi-node restoration was not verified');
  },
});

/** Create op: validate parentId (if any) up front; undo removes the node the op created. */
const createInverse = (tool: string, hasParent = true): BatchInverse => ({
  async capture(figmaCtx, params) {
    if (!hasParent) return null;
    const parentId = (params as { parentId?: unknown } | null)?.parentId;
    if (typeof parentId !== 'string') return null;
    const parent = await figmaCtx.getNodeByIdAsync(parentId);
    if (parent === null || !('appendChild' in parent)) {
      throw new Error(`batch/${tool}: parent ${parentId} not found or cannot contain children`);
    }
    return null;
  },
  async undo(figmaCtx, _params, _captured, result, _failure, owned) {
    const id = (result as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') {
      throw new Error('creation failed before returning an identity; created node may remain');
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null) return;
    const snapshot = owned?.get(node)?.[CREATED_NODE_PROPERTY] as CreatedNodeSnapshot | undefined;
    if (snapshot === undefined || !createdNodeStillOwned(snapshot))
      throw new Error('created node identity or state is no longer owned');
    if (!('remove' in node)) throw new Error('created node cannot be removed');
    (node as { remove(): void }).remove();
    if ((await figmaCtx.getNodeByIdAsync(id)) !== null)
      throw new Error('created node removal was not verified');
  },
});

/**
 * Create_component is invertible as an empty create (undo removes the new node), but `fromNodeId`
 * componentizes — and consumes — an existing node, which has no faithful inverse (removing the
 * component would destroy the original). Reject that variant up front, like other non-invertible
 * ops.
 */
const componentCreateInverse = createInverse('create_component');
const createComponentInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    if (typeof (params as { fromNodeId?: unknown } | null)?.fromNodeId === 'string') {
      throw new Error(
        'batch/create_component: fromNodeId is not batchable — componentizing a node consumes it and has no faithful inverse',
      );
    }
    return componentCreateInverse.capture(figmaCtx, params);
  },
  undo: componentCreateInverse.undo,
};

// Every field the set_text_properties handler can write. The snapshot must cover all of them —
// an inverse that captures a subset would "roll back" while silently leaving the rest changed,
// breaking the all-or-nothing contract. Restore order matters at the tail: maxLines only takes
// effect once textTruncation is ENDING, so truncation is restored before maxLines (mirrors the
// handler's apply order).
export const TEXT_PROPERTY_KEYS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'paragraphSpacing',
  'paragraphIndent',
  'textWrapStyle',
  'textAutoResize',
  'textTruncation',
  'maxLines',
] as const;

/**
 * Set_text_properties mutates typography, which Figma only allows with the node's fonts loaded — so
 * the undo must reload the captured fonts before restoring, exactly like setTextInverse. Mixed
 * typography is rejected during read-only preflight until an exact range inverse is supported.
 */
const setTextPropertiesInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') {
      throw new TypeError('batch/set_text_properties: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`batch/set_text_properties: node ${id} is not a TEXT node`);
    }
    const text = node as TextNode;
    if (
      TEXT_PROPERTY_KEYS.some(
        k => typeof (text as unknown as Record<string, unknown>)[k] === 'symbol',
      )
    ) {
      throw new Error(
        'batch/set_text_properties: mixed typography has no faithful node-level inverse',
      );
    }
    const fonts =
      text.fontName === figmaCtx.mixed && text.characters.length > 0
        ? text.getRangeAllFontNames(0, text.characters.length)
        : [text.fontName as FontName];
    const bag = text as unknown as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const k of TEXT_PROPERTY_KEYS) if (k in text) snapshot[k] = cloneValue(bag[k]);
    return { id, node, snapshot, fonts };
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const snapshot = captured as NodeSnapshot & { fonts: FontName[] };
    const { id, fonts } = snapshot;
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node !== snapshot.node || node.type !== 'TEXT')
      throw new Error(`node ${id} identity changed`);
    await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    restoreOwned(await figmaCtx.getNodeByIdAsync(id), snapshot, owned, failure);
  },
};

/** Set_text needs every font loaded before `characters` can be restored. */
const setTextInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') throw new TypeError('batch/set_text: nodeId must be a string');
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`batch/set_text: node ${id} is not a TEXT node`);
    }
    const text = node as TextNode;
    if (
      TEXT_PROPERTY_KEYS.some(
        k => typeof (text as unknown as Record<string, unknown>)[k] === 'symbol',
      )
    ) {
      throw new Error('batch/set_text: mixed typography has no faithful node-level inverse');
    }
    if (typeof text.getStyledTextSegments === 'function' && text.characters.length > 0) {
      const segments = text.getStyledTextSegments([
        'fontName',
        'fontSize',
        'lineHeight',
        'letterSpacing',
        'textCase',
        'textDecoration',
        'fills',
        'textStyleId',
        'fillStyleId',
        'listOptions',
        'indentation',
        'textWrapStyle',
      ]);
      // Replacing characters can flatten paragraph and style ranges. Without an exact range
      // inverse, reject their loss before any batch effect.
      if (segments.length > 1)
        throw new Error('batch/set_text: mixed typography ranges have no faithful inverse');
    }
    const fonts =
      text.fontName === figmaCtx.mixed && text.characters.length > 0
        ? text.getRangeAllFontNames(0, text.characters.length)
        : [text.fontName as FontName];
    return { id, node, snapshot: { characters: text.characters }, fonts };
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const snapshot = captured as NodeSnapshot & { fonts: FontName[] };
    const { id, fonts } = snapshot;
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node !== snapshot.node || node.type !== 'TEXT')
      throw new Error(`node ${id} identity changed`);
    await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    restoreOwned(await figmaCtx.getNodeByIdAsync(id), snapshot, owned, failure);
  },
};

// ── Motion (beta) inverses ───────────────────────────────────────────────────
// Motion authoring joins the batch only where the pre-op state snapshots faithfully — the stagger
// hot-path. apply_animation_style undoes via the appliedStyleId the apply returns; a PROPERTY
// keyframe track round-trips through a deep-cloned snapshot. Indexed fills/strokes/effects tracks
// have no faithful snapshot yet, so they're rejected up front (same honesty stance as
// create_component's fromNodeId) to keep all-or-nothing real. All three gate on the Figma editor.

const applyAnimationStyleInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/apply_animation_style');
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') {
      throw new TypeError('batch/apply_animation_style: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/apply_animation_style: node ${id} not found or does not support Motion`,
      );
    }
    return { id, node, snapshot: { animationStyles: cloneValue(node.animationStyles) } };
  },
  async undo(figmaCtx, _params, captured, result, failure, owned) {
    const snapshot = captured as NodeSnapshot;
    const r = result as { nodeId?: unknown; appliedStyleId?: unknown } | null;
    const node = await figmaCtx.getNodeByIdAsync(snapshot.id);
    restoreOwned(node, snapshot, owned, failure, () => {
      if (node === null || !isMotionNode(node) || typeof r?.appliedStyleId !== 'string')
        throw new Error('animation style identity is unknown');
      node.removeAnimationStyle(r.appliedStyleId);
    });
  },
};

const applyManualKeyframeTrackInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/apply_manual_keyframe_track');
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('batch/apply_manual_keyframe_track: nodeId must be a string');
    }
    const field = p.field as { type?: unknown; name?: unknown } | null;
    if (field?.type !== 'PROPERTY' || typeof field.name !== 'string') {
      throw new Error(
        'batch/apply_manual_keyframe_track: only PROPERTY fields are batchable — indexed fills/strokes/effects tracks have no faithful snapshot',
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/apply_manual_keyframe_track: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    const tracks = node.manualKeyframeTracks as Record<string, unknown>;
    const previous = tracks[field.name];
    // Deep-clone so the snapshot can't be mutated by the apply that follows.
    return {
      id: p.nodeId,
      node,
      snapshot: { manualKeyframeTracks: cloneValue(node.manualKeyframeTracks) },
      field: p.field,
      previous: previous === undefined ? null : toPlainJson(previous),
    };
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const { id, field, previous } = captured as {
      id: string;
      field: KeyframeField;
      previous: ManualKeyframeTrackInput | null;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    restoreOwned(node, captured as NodeSnapshot, owned, failure, () => {
      if (node === null || !isMotionNode(node)) throw new Error(`node ${id} has no Motion API`);
      if (previous === null) node.removeManualKeyframeTrack(field);
      else node.applyManualKeyframeTrack(field, previous);
    });
  },
};

const setTimelineDurationInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/set_timeline_duration');
    const p = (params ?? {}) as { nodeId?: unknown; timelineId?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('batch/set_timeline_duration: nodeId must be a string');
    }
    if (typeof p.timelineId !== 'string') {
      throw new TypeError('batch/set_timeline_duration: timelineId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/set_timeline_duration: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    const timeline = node.timelines.find(t => t.id === p.timelineId);
    if (timeline === undefined) {
      throw new Error(
        `batch/set_timeline_duration: timeline ${p.timelineId} not found on node ${p.nodeId}`,
      );
    }
    return {
      id: p.nodeId,
      node,
      snapshot: { timelines: cloneValue(node.timelines) },
      timelineId: p.timelineId,
      duration: timeline.duration,
    };
  },
  async undo(figmaCtx, _params, captured, _result, failure, owned) {
    const { id, timelineId, duration } = captured as {
      id: string;
      timelineId: string;
      duration: number;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    restoreOwned(node, captured as NodeSnapshot, owned, failure, () => {
      if (node === null || !isMotionNode(node)) throw new Error(`node ${id} has no Motion API`);
      node.setTimelineDuration(timelineId, duration);
    });
  },
};

/** Tool name → inverse. Membership here is the allowlist: only these ops may appear in a batch. */
const INVERSES: Readonly<Record<string, BatchInverse>> = {
  // Single-node property mutations.
  set_fills: nodeProps('set_fills', ['fills']),
  // Snapshot every field the handler can write, not just the headline one: a subset snapshot would
  // "roll back" while silently leaving the rest changed. The per-side weights are also what rescue
  // a node whose uniform strokeWeight reads figma.mixed (a symbol, skipped by `restorable`) — they
  // are plain numbers, so mixed-stroke nodes still restore fully. Order matters: the uniform weight
  // is restored before the per-side values so the sides override it (mirrors the handler).
  set_strokes: nodeProps('set_strokes', [
    'strokes',
    'strokeWeight',
    'strokeAlign',
    'dashPattern',
    'strokeTopWeight',
    'strokeRightWeight',
    'strokeBottomWeight',
    'strokeLeftWeight',
  ]),
  set_opacity: nodeProps('set_opacity', ['opacity']),
  set_visible: nodeProps('set_visible', ['visible']),
  // Same full-coverage rule as set_strokes: per-corner radii are plain numbers, so a node whose
  // uniform cornerRadius reads figma.mixed (skipped by `restorable`) still restores through them
  // (a plain-cornerRadius node like an ellipse has no per-corner props — the `in node` guard skips
  // them and the uniform value alone round-trips). Uniform first, corners after (handler order).
  set_corner_radius: nodeProps('set_corner_radius', [
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomRightRadius',
    'bottomLeftRadius',
  ]),
  set_arc: nodeProps('set_arc', ['arcData']),
  set_blend_mode: nodeProps('set_blend_mode', ['blendMode']),
  set_effects: nodeProps('set_effects', ['effects']),
  set_constraints: nodeProps('set_constraints', ['constraints']),
  rename_node: nodeProps('rename_node', ['name']),
  set_annotations: annotationBatchInverse,
  set_text: setTextInverse,
  set_text_properties: setTextPropertiesInverse,
  // Multi-node mutations.
  move_nodes: nodesSnapshot(
    'move_nodes',
    node => ('x' in node && 'y' in node ? { x: node.x, y: node.y } : null),
    (node, s) => {
      (node as { x: number; y: number }).x = s.x as number;
      (node as { x: number; y: number }).y = s.y as number;
    },
  ),
  resize_nodes: nodesSnapshot(
    'resize_nodes',
    node =>
      typeof (node as { resize?: unknown }).resize === 'function'
        ? { width: node.width, height: node.height }
        : null,
    (node, s) =>
      (node as { resize(w: number, h: number): void }).resize(
        s.width as number,
        s.height as number,
      ),
  ),
  rotate_nodes: nodesSnapshot(
    'rotate_nodes',
    node => ('rotation' in node ? { rotation: (node as { rotation: number }).rotation } : null),
    (node, s) => ((node as { rotation: number }).rotation = s.rotation as number),
  ),
  lock_nodes: nodesSnapshot(
    'lock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => (node.locked = s.locked as boolean),
  ),
  unlock_nodes: nodesSnapshot(
    'unlock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => (node.locked = s.locked as boolean),
  ),
  // Creates — undo removes whatever node the op produced.
  create_frame: createInverse('create_frame'),
  create_rectangle: createInverse('create_rectangle'),
  create_text: createInverse('create_text'),
  create_ellipse: createInverse('create_ellipse'),
  create_component: createComponentInverse,
  create_section: createInverse('create_section'),
  import_image: createInverse('import_image'),
  import_svg: createInverse('import_svg'),
  create_instance: createInverse('create_instance'),
  clone_node: createInverse('clone_node', false),
  // Motion (beta) — staggered authoring in one atomic, undoable call.
  apply_animation_style: applyAnimationStyleInverse,
  apply_manual_keyframe_track: applyManualKeyframeTrackInverse,
  set_timeline_duration: setTimelineDurationInverse,
};

/** Public authority used to prove policy parsing covers every invertible plugin child exactly. */
export const BATCHABLE_TOOL_NAMES = Object.freeze(Object.keys(INVERSES));

interface ParsedOp {
  tool: string;
  params: unknown;
}

const parseOps = (params: unknown): ParsedOp[] => {
  const ops = (params as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) throw new TypeError('batch: ops must be an array');
  if (ops.length === 0) throw new TypeError('batch: ops must not be empty');
  return ops.map((op, i) => {
    const o = op as { tool?: unknown; params?: unknown } | null;
    if (typeof o?.tool !== 'string') throw new TypeError(`batch: ops[${i}].tool must be a string`);
    if (INVERSES[o.tool] === undefined) {
      throw new Error(
        `batch: op '${o.tool}' (index ${i}) is not batchable — only invertible writes are allowed`,
      );
    }
    return { tool: o.tool, params: o.params ?? {} };
  });
};

/**
 * Build the batch handler. `apply` is the map of raw write handlers (un-idempotent — the whole
 * batch carries one requestId and is wrapped once at the top level, so each op runs exactly once on
 * replay).
 */
export const createBatchHandler =
  (figmaCtx: typeof figma, apply: SandboxHandlers): SandboxToolHandler =>
  async (params, context) => {
    const ops = parseOps(params);
    for (const op of ops) {
      if (apply[op.tool] === undefined) throw new Error(`batch: no handler for op '${op.tool}'`);
    }

    // Phase 1 — capture (read-only). Reads are independent, so resolve them together.
    const captured = await Promise.all(
      ops.map(op => INVERSES[op.tool]!.capture(figmaCtx, op.params)),
    );

    // Phase 2 — apply in order; roll back already-applied ops on the first failure.
    const results: unknown[] = [];
    const ownership: Map<BaseNode, Record<string, unknown>>[] = [];
    /* eslint-disable no-await-in-loop -- apply order is significant and rollback needs partial results */
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i]!;
      const writes = new Map<BaseNode, Record<string, unknown>>();
      ownership.push(writes);
      const execution: Readonly<SandboxExecutionContext> = {
        ...context,
        signal: context?.signal ?? new AbortController().signal,
        report: progress => context?.report(progress),
        recordOwnedWrite(identity, properties) {
          // Keep the dispatcher interface usable without Plugin API ambient types in MCP tests.
          const node = identity as BaseNode;
          const snapshot = writes.get(node) ?? {};
          const bag = node as unknown as Record<string, unknown>;
          if (properties.includes(CREATED_NODE_PROPERTY))
            snapshot[CREATED_NODE_PROPERTY] = captureCreatedNode(node);
          const created = snapshot[CREATED_NODE_PROPERTY] as CreatedNodeSnapshot | undefined;
          if (created !== undefined) observeCreatedFields(created, properties);
          for (const key of properties)
            if (key !== 'parent' && key in node) snapshot[key] = cloneValue(bag[key]);
          writes.set(node, snapshot);
          context?.recordOwnedWrite?.(node, properties);
        },
      };
      try {
        context?.signal.throwIfAborted();
        // Refresh each inverse at its apply boundary so overlapping operations unwind in order.
        captured[i] = await INVERSES[op.tool]!.capture(figmaCtx, op.params);
        execution.signal.throwIfAborted();
        results.push(await apply[op.tool]!(op.params, execution));
      } catch (err) {
        // Unwind applied ops in reverse. Keep going even if one undo throws, but record which ones
        // failed so the error never claims a clean rollback that didn't happen.
        const undoFailures: string[] = [];
        // The failing handler may already have changed a property or one of several nodes.
        // Include its captured state; a create without an identity must report uncertainty.
        for (let j = i; j >= 0; j -= 1) {
          try {
            await INVERSES[ops[j]!.tool]!.undo(
              figmaCtx,
              ops[j]!.params,
              captured[j],
              results[j],
              j === i ? err : undefined,
              ownership[j],
            );
          } catch (undoErr) {
            const m = undoErr instanceof Error ? undoErr.message : String(undoErr);
            undoFailures.push(`op ${j} (${ops[j]!.tool}): ${m}`);
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        const rollback =
          undoFailures.length === 0
            ? `rolled back ${i} applied op(s); restored the failing op`
            : `${undoFailures.length} undo(s) FAILED [${undoFailures.join('; ')}] — document may be partially changed`;
        throw Object.assign(
          new Error(`batch: op ${i} (${op.tool}) failed, ${rollback}: ${message}`, {
            cause: err,
          }),
          { code: undoFailures.length === 0 ? 'BATCH_ROLLED_BACK' : 'BATCH_PARTIAL_CHANGE' },
        );
      }
    }
    /* eslint-enable no-await-in-loop */

    const result: BatchResult = { ok: true, results };
    return result;
  };
