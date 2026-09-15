import {
  GetAnnotationsResultSchema,
  SerializedTextSegmentSchema,
  SetAnnotationsArgsSchema,
  annotationStateKey,
  type SerializedTextSegment,
} from '@sfp/shared';
import { z } from 'zod';

import { setAnnotationsTool } from '../../mcp/src/tools/set-annotations.js';
import { setFillsTool } from '../../mcp/src/tools/set-fills.js';
import { setStrokesTool } from '../../mcp/src/tools/set-strokes.js';
import { setTextRangeTool } from '../../mcp/src/tools/set-text-range.js';
import { setTextTool } from '../../mcp/src/tools/set-text.js';
import type { RawToolSpec } from '../../mcp/src/tools/spec.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import {
  recipeHash,
  recipeError,
  recipeSourceNodes,
  type RecipeSourceNode,
} from './recipe-plan.js';

type SceneTool = 'set_annotations' | 'set_text' | 'set_text_range' | 'set_fills' | 'set_strokes';
const tools: Record<SceneTool, RawToolSpec> = {
  set_annotations: setAnnotationsTool,
  set_text: setTextTool,
  set_text_range: setTextRangeTool,
  set_fills: setFillsTool,
  set_strokes: setStrokesTool,
};
const bounded = (input: unknown, bytes: number, values: number): boolean =>
  isBoundedDesignJson(input, bytes, values);
interface SceneOperation {
  id: string;
  tool: SceneTool;
  args: Record<string, unknown>;
}
interface SceneComposition {
  version: 1;
  execution: 'planned';
  family: string;
  sourceHash: string;
  evidenceHashes: string[];
  operations: SceneOperation[];
  preservedNodeIds: string[];
  decisions: Array<{ nodeId: string; field: string; outcome: string }>;
  prerequisites: string[];
}
const source = (root: RecipeSourceNode) => {
  if (!bounded(root, 8388608, 200000)) throw recipeError('RECIPE_SCENE_INPUT_LIMIT');
  return recipeSourceNodes(root);
};
const requireNode = (nodes: Map<string, RecipeSourceNode>, id: string) => {
  const found = nodes.get(id);
  if (!found) throw recipeError('RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE');
  return found;
};
const operation = (id: string, tool: SceneTool, args: unknown): SceneOperation => ({
  id,
  tool,
  args: tools[tool].inputSchema.strict().parse(args),
});
const publish = (plan: SceneComposition) => {
  if (!bounded(plan, 1048576, 50000) || plan.operations.length > 126)
    throw recipeError('RECIPE_COMPOSITION_LIMIT');
  return { ...plan, hash: recipeHash(plan) };
};

/** Explicit note-to-target mappings; source notes are never deleted or hidden. */
export function composeAnnotationConversion(input: {
  root: RecipeSourceNode;
  annotations: unknown;
  mappings: Array<{
    noteNodeId: string;
    targetNodeId: string;
    categoryId?: string;
    properties?: string[];
  }>;
}) {
  const nodes = source(input.root);
  if (!isBoundedDesignJson(input.mappings, 131072, 10000))
    throw recipeError('RECIPE_ANNOTATION_MAPPING_LIMIT');
  const mappings = z
    .array(
      z.strictObject({
        noteNodeId: z.string().min(1).max(512),
        targetNodeId: z.string().min(1).max(256),
        categoryId: z.string().min(1).max(256).optional(),
        properties: z.array(z.string()).max(33).optional(),
      }),
    )
    .min(1)
    .max(64)
    .parse(input.mappings);
  const observed = GetAnnotationsResultSchema.parse(input.annotations);
  if (new Set(observed.annotations.map(row => row.nodeId)).size !== observed.annotations.length)
    throw recipeError('RECIPE_ANNOTATION_READ_AMBIGUOUS');
  const grouped = new Map<string, z.infer<typeof SetAnnotationsArgsSchema>>(),
    preservedNodeIds: string[] = [];
  const decisions: SceneComposition['decisions'] = [];
  for (const mapping of mappings) {
    const note = requireNode(nodes, mapping.noteNodeId),
      target = requireNode(nodes, mapping.targetNodeId);
    if (
      note.type !== 'TEXT' ||
      typeof note.characters !== 'string' ||
      !note.characters.trim() ||
      note.id === target.id
    )
      throw recipeError('RECIPE_ANNOTATION_NOTE_INVALID');
    const actual = observed.annotations.find(row => row.nodeId === target.id);
    if (!actual) throw recipeError('RECIPE_ANNOTATION_PREIMAGE_MISSING');
    const appended = {
      label: note.characters,
      ...(mapping.categoryId ? { categoryId: mapping.categoryId } : {}),
      ...(mapping.properties ? { properties: mapping.properties } : {}),
    };
    const state =
      grouped.get(target.id) ??
      SetAnnotationsArgsSchema.parse({
        nodeId: target.id,
        expectedAnnotations: actual.annotations,
        annotations: actual.annotations,
      });
    if (
      !state.annotations.some(row => annotationStateKey([row]) === annotationStateKey([appended]))
    ) {
      state.annotations = SetAnnotationsArgsSchema.parse({
        ...state,
        annotations: [...state.annotations, appended],
      }).annotations;
      decisions.push({ nodeId: target.id, field: 'annotations', outcome: 'append-exact-note' });
    } else decisions.push({ nodeId: target.id, field: 'annotations', outcome: 'already-present' });
    grouped.set(target.id, SetAnnotationsArgsSchema.parse(state));
    preservedNodeIds.push(note.id);
  }
  const operations: SceneOperation[] = [];
  for (const [index, args] of [...grouped.values()].entries())
    if (annotationStateKey(args.annotations) !== annotationStateKey(args.expectedAnnotations))
      operations.push(operation(`annotation-${index}`, 'set_annotations', args));
  return publish({
    version: 1,
    execution: 'planned',
    family: 'convert-annotations',
    sourceHash: recipeHash(input.root),
    evidenceHashes: [recipeHash(observed)],
    operations,
    preservedNodeIds: [...new Set(preservedNodeIds)],
    decisions,
    prerequisites: [
      'CURRENT_FULL_SOURCE_AND_ANNOTATION_READS',
      'SPECIALIZED_SET_ANNOTATIONS_PREIMAGE_AND_READBACK',
      'HOST_ANNOTATION_WRITE_CAPABILITY',
    ],
  });
}

const boundary = (characters: string, index: number) =>
  Number.isInteger(index) &&
  index >= 0 &&
  index <= characters.length &&
  !(
    index > 0 &&
    index < characters.length &&
    /[\uD800-\uDBFF]/u.test(characters[index - 1]!) &&
    /[\uDC00-\uDFFF]/u.test(characters[index]!)
  );
/** Font/range evidence must cover the actual text; mixed does not mean skip font loading. */
export function observedTextRuns(node: RecipeSourceNode): {
  fonts: Array<{ family: string; style: string }>;
  segments: SerializedTextSegment[];
} {
  if (node.type !== 'TEXT' || typeof node.characters !== 'string')
    throw recipeError('RECIPE_TEXT_NODE_REQUIRED');
  const segments =
    node.segments === undefined
      ? []
      : z.array(SerializedTextSegmentSchema).max(10000).parse(node.segments);
  const font = z
    .strictObject({ family: z.string().min(1).max(256), style: z.string().min(1).max(256) })
    .safeParse(node.fontName);
  const fonts = new Map<string, { family: string; style: string }>();
  if (font.success) fonts.set(recipeHash(font.data), font.data);
  if (segments.length) {
    let end = 0;
    for (const segment of segments) {
      if (
        segment.start !== end ||
        segment.end <= segment.start ||
        !boundary(node.characters, segment.start) ||
        !boundary(node.characters, segment.end) ||
        segment.characters !== node.characters.slice(segment.start, segment.end)
      )
        throw recipeError('RECIPE_TEXT_RUNS_INCOMPLETE');
      end = segment.end;
      fonts.set(recipeHash(segment.fontName), segment.fontName);
    }
    if (end !== node.characters.length) throw recipeError('RECIPE_TEXT_RUNS_INCOMPLETE');
  } else if (!font.success) throw recipeError('RECIPE_TEXT_FONTS_UNOBSERVED');
  return { fonts: [...fonts.values()], segments };
}
export function composeTextReplacement(input: {
  root: RecipeSourceNode;
  nodeId: string;
  characters: string;
  ranges?: unknown[];
}) {
  const nodes = source(input.root),
    node = requireNode(nodes, input.nodeId),
    runs = observedTextRuns(node);
  const characters = z.string().max(100000).parse(input.characters);
  if (
    runs.segments.length &&
    characters.length !== String(node.characters).length &&
    input.ranges === undefined
  )
    throw recipeError('RECIPE_TEXT_RANGE_REMAP_REQUIRED');
  const operations = [operation('text', 'set_text', { nodeId: node.id, characters })];
  if (input.ranges !== undefined) {
    const args = setTextRangeTool.inputSchema
      .strict()
      .parse({ nodeId: node.id, ranges: input.ranges });
    const ranges = z
      .array(
        z
          .object({
            start: z.number(),
            end: z.number(),
            fontName: z.object({ family: z.string(), style: z.string() }).optional(),
          })
          .passthrough(),
      )
      .max(10000)
      .parse(args.ranges);
    if (!bounded(args, 524288, 30000)) throw recipeError('RECIPE_TEXT_RANGE_LIMIT');
    for (const range of ranges)
      if (
        !boundary(characters, range.start) ||
        !boundary(characters, range.end) ||
        range.end <= range.start
      )
        throw recipeError('RECIPE_TEXT_RANGE_INVALID');
    if (runs.segments.length && characters.length !== String(node.characters).length) {
      const ordered = ranges.toSorted((a, b) => a.start - b.start);
      let end = 0;
      for (const range of ordered) {
        if (range.start !== end || !range.fontName)
          throw recipeError('RECIPE_TEXT_RANGE_REMAP_REQUIRED');
        end = range.end;
      }
      if (end !== characters.length) throw recipeError('RECIPE_TEXT_RANGE_REMAP_REQUIRED');
    }
    operations.push(operation('ranges', 'set_text_range', args));
  } else
    for (const segment of runs.segments)
      if (!boundary(characters, segment.start) || !boundary(characters, segment.end))
        throw recipeError('RECIPE_TEXT_RANGE_REMAP_REQUIRED');
  return publish({
    version: 1,
    execution: 'planned',
    family: 'author-text',
    sourceHash: recipeHash(input.root),
    evidenceHashes: [recipeHash(runs)],
    operations,
    preservedNodeIds: [],
    decisions: [],
    prerequisites: [
      'CURRENT_FULL_SOURCE_READ',
      'CANONICAL_ALL_CURRENT_AND_REQUESTED_FONT_LOADS',
      'PREDECLARED_TEXT_RUN_AND_REFLOW_POSTIMAGE',
      'UNCHANGED_UNRELATED_FIELDS_AND_BINDINGS',
    ],
  });
}

type Path = Array<{ name: string; type: string }>;
const descendants = (root: RecipeSourceNode): Array<{ node: RecipeSourceNode; path: Path }> => {
  const result: Array<{ node: RecipeSourceNode; path: Path }> = [],
    pending = [{ node: root, path: [] as Path }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.path.length) result.push(current);
    const seen = new Set<string>();
    for (const child of current.node.children ?? []) {
      if (typeof child.name !== 'string' || typeof child.type !== 'string')
        throw recipeError('RECIPE_OVERRIDE_PATH_UNOBSERVED');
      const segment = { name: child.name, type: child.type },
        key = recipeHash(segment);
      if (seen.has(key)) throw recipeError('RECIPE_OVERRIDE_PATH_AMBIGUOUS');
      seen.add(key);
      pending.push({ node: child, path: [...current.path, segment] });
    }
  }
  return result;
};
const mainId = (instance: RecipeSourceNode) =>
  z.object({ id: z.string() }).parse(instance.mainComponent).id;
/** Transfer actual overrides only where the target still has its own component's baseline value. */
export function composeInstanceOverrideTransfer(input: {
  root: RecipeSourceNode;
  sourceInstanceId: string;
  targetInstanceIds: string[];
  fields: Array<'characters' | 'fills' | 'strokes'>;
}) {
  const nodes = source(input.root),
    from = requireNode(nodes, input.sourceInstanceId);
  const targetIds = z
    .array(z.string().min(1).max(512))
    .min(1)
    .max(32)
    .parse(input.targetInstanceIds);
  const fields = z
    .array(z.enum(['characters', 'fills', 'strokes']))
    .min(1)
    .max(3)
    .parse(input.fields);
  if (
    from.type !== 'INSTANCE' ||
    new Set(targetIds).size !== targetIds.length ||
    targetIds.includes(from.id) ||
    new Set(fields).size !== fields.length
  )
    throw recipeError('RECIPE_OVERRIDE_TARGET_INVALID');
  const baseline = requireNode(nodes, mainId(from)),
    baselinePaths = new Map(descendants(baseline).map(row => [recipeHash(row.path), row.node]));
  if (baseline.type !== 'COMPONENT') throw recipeError('RECIPE_OVERRIDE_BASELINE_UNAVAILABLE');
  const operations: SceneOperation[] = [],
    decisions: SceneComposition['decisions'] = [];
  for (const targetId of targetIds) {
    const target = requireNode(nodes, targetId);
    if (target.type !== 'INSTANCE') throw recipeError('RECIPE_OVERRIDE_TARGET_INVALID');
    const targetBaseline = requireNode(nodes, mainId(target));
    const sourceComponent = z
        .object({ id: z.string(), componentSetId: z.string().optional() })
        .parse(from.mainComponent),
      targetComponent = z
        .object({ id: z.string(), componentSetId: z.string().optional() })
        .parse(target.mainComponent);
    if (
      targetBaseline.type !== 'COMPONENT' ||
      (sourceComponent.id !== targetComponent.id &&
        (!sourceComponent.componentSetId ||
          sourceComponent.componentSetId !== targetComponent.componentSetId))
    )
      throw recipeError('RECIPE_OVERRIDE_COMPONENT_MISMATCH');
    const targetPaths = new Map(descendants(target).map(row => [recipeHash(row.path), row.node])),
      targetBasePaths = new Map(
        descendants(targetBaseline).map(row => [recipeHash(row.path), row.node]),
      );
    for (const row of descendants(from)) {
      const key = recipeHash(row.path),
        original = baselinePaths.get(key),
        destination = targetPaths.get(key),
        destinationBase = targetBasePaths.get(key);
      if (!original || !destination || !destinationBase)
        throw recipeError('RECIPE_OVERRIDE_PATH_MISMATCH');
      for (const field of fields) {
        if (!Object.hasOwn(row.node, field) && !Object.hasOwn(original, field)) continue;
        if (
          ![row.node, original, destination, destinationBase].every(node =>
            Object.hasOwn(node, field),
          )
        )
          throw recipeError('RECIPE_OVERRIDE_VALUE_UNOBSERVED');
        if (recipeHash(row.node[field]) === recipeHash(original[field])) continue;
        if (recipeHash(destination[field]) === recipeHash(row.node[field])) {
          decisions.push({ nodeId: destination.id, field, outcome: 'already-matched' });
          continue;
        }
        if (recipeHash(destination[field]) !== recipeHash(destinationBase[field])) {
          decisions.push({
            nodeId: destination.id,
            field,
            outcome: 'preserve-intentional-target-override',
          });
          continue;
        }
        if (field === 'characters') {
          const text = composeTextReplacement({
            root: input.root,
            nodeId: destination.id,
            characters: z.string().parse(row.node.characters),
          });
          for (const planned of text.operations)
            operations.push({ ...planned, id: `override-${operations.length}` });
        } else {
          const styleField = field === 'fills' ? 'fill' : 'stroke';
          for (const node of [row.node, destination])
            if (
              node.styleIds &&
              typeof node.styleIds === 'object' &&
              Reflect.get(node.styleIds, styleField)
            )
              throw recipeError('RECIPE_OVERRIDE_SHARED_STYLE_REQUIRES_EXPLICIT_BINDING');
          operations.push(
            operation(
              `override-${operations.length}`,
              field === 'fills' ? 'set_fills' : 'set_strokes',
              { nodeId: destination.id, [field]: row.node[field] },
            ),
          );
        }
        decisions.push({ nodeId: destination.id, field, outcome: 'transfer-source-override' });
      }
    }
  }
  return publish({
    version: 1,
    execution: 'planned',
    family: 'copy-instance-overrides',
    sourceHash: recipeHash(input.root),
    evidenceHashes: [],
    operations,
    preservedNodeIds: [from.id, baseline.id],
    decisions,
    prerequisites: [
      'CURRENT_FULL_SOURCE_AND_COMPONENT_SUBTREES',
      'PER_TOOL_PAINT_TEXT_AND_REFLOW_POSTIMAGES',
      'ACTUAL_VARIABLE_AND_FONT_PREFLIGHT',
      'UNCHANGED_INTENTIONAL_TARGET_OVERRIDES',
    ],
  });
}
