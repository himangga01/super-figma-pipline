import { expect, it, vi } from 'vitest';

import type { RecipeSourceNode } from '../src/recipe-plan.js';
import {
  composeAnnotationConversion,
  composeInstanceOverrideTransfer,
  composeTextReplacement,
  observedTextRuns,
} from '../src/recipe-scene-compositions.js';

const frame = (
  id: string,
  name: string,
  parentId: string | null,
  type = 'FRAME',
): RecipeSourceNode => ({
  id,
  name,
  type,
  parentId,
  x: 0,
  y: 0,
  width: 100,
  height: 30,
  children: [],
});
const text = (id: string, parentId: string, characters: string): RecipeSourceNode => ({
  ...frame(id, 'Label', parentId, 'TEXT'),
  characters,
  fontName: { family: 'Inter', style: 'Regular' },
});
const add = (parent: RecipeSourceNode, child: RecipeSourceNode) => {
  parent.children!.push(child);
  return child;
};

it('annotation conversion preserves source notes and existing annotations through the specialized actual writer', async () => {
  const root = frame('1:1', 'Page', null),
    target = add(root, frame('1:2', 'Button', root.id)),
    note = add(root, text('1:3', root.id, 'Use the accessible label.'));
  const annotated = {
    id: target.id,
    name: target.name,
    type: 'FRAME',
    annotations: [{ label: 'Existing developer note' }],
  };
  const { createSetAnnotationsHandler } = await vi.importActual<{
    createSetAnnotationsHandler: (context: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/set-annotations.js');
  const plan = composeAnnotationConversion({
    root,
    annotations: {
      annotations: [{ nodeId: target.id, nodeName: 'Button', annotations: annotated.annotations }],
    },
    mappings: [{ noteNodeId: note.id, targetNodeId: target.id, properties: ['width'] }],
  });
  expect(plan.execution).toBe('planned');
  expect(plan.preservedNodeIds).toEqual([note.id]);
  expect(plan.operations).toHaveLength(1);
  await createSetAnnotationsHandler({ getNodeByIdAsync: async () => annotated })(
    plan.operations[0]!.args,
  );
  expect(annotated.annotations).toEqual([
    { label: 'Existing developer note' },
    { label: 'Use the accessible label.', properties: [{ type: 'width' }] },
  ]);
  expect(note.characters).toBe('Use the accessible label.');
  expect(root.children).toHaveLength(2);
});
it('annotation conversion requires an exact target row and never treats an absent row as empty', () => {
  const root = frame('1:1', 'Page', null),
    target = add(root, frame('1:2', 'Button', root.id)),
    note = add(root, text('1:3', root.id, 'Note'));
  expect(() =>
    composeAnnotationConversion({
      root,
      annotations: { annotations: [] },
      mappings: [{ noteNodeId: note.id, targetNodeId: target.id }],
    }),
  ).toThrow('RECIPE_ANNOTATION_PREIMAGE_MISSING');
  const plan = composeAnnotationConversion({
    root,
    annotations: {
      annotations: [{ nodeId: target.id, nodeName: 'Button', annotations: [{ label: 'Note' }] }],
    },
    mappings: [{ noteNodeId: note.id, targetNodeId: target.id }],
  });
  expect(plan.operations).toHaveLength(0);
  expect(plan.decisions[0]!.outcome).toBe('already-present');
});
it('actual targeted annotation read supports conversion into an empty supported target', async () => {
  const root = frame('1:1', 'Page', null),
    target = add(root, frame('1:2', 'Button', root.id)),
    note = add(root, text('1:3', root.id, 'First note'));
  const host = { ...target, annotations: [] };
  const { createGetAnnotationsHandler } = await vi.importActual<{
    createGetAnnotationsHandler: (context: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/get-annotations.js');
  const annotations = await createGetAnnotationsHandler({ getNodeByIdAsync: async () => host })({
    nodeId: target.id,
  });
  const plan = composeAnnotationConversion({
    root,
    annotations,
    mappings: [{ noteNodeId: note.id, targetNodeId: target.id }],
  });
  expect(plan.operations[0]!.args).toEqual({
    nodeId: target.id,
    expectedAnnotations: [],
    annotations: [{ label: 'First note' }],
  });
});
const mixed = () => ({
  ...text('1:2', '1:1', 'AB'),
  fontName: 'mixed',
  segments: [
    {
      characters: 'A',
      start: 0,
      end: 1,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fills: [],
      textDecoration: 'NONE',
      textCase: 'ORIGINAL',
    },
    {
      characters: 'B',
      start: 1,
      end: 2,
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 16,
      fills: [],
      textDecoration: 'NONE',
      textCase: 'ORIGINAL',
    },
  ],
});
it('mixed text requires complete ranges and explicit remapping across length changes', () => {
  const root = frame('1:1', 'Page', null),
    child = add(root, mixed());
  expect(observedTextRuns(child).fonts).toHaveLength(2);
  expect(() => composeTextReplacement({ root, nodeId: child.id, characters: 'Longer' })).toThrow(
    'RECIPE_TEXT_RANGE_REMAP_REQUIRED',
  );
  expect(() => composeTextReplacement({ root, nodeId: child.id, characters: '😀' })).toThrow(
    'RECIPE_TEXT_RANGE_REMAP_REQUIRED',
  );
  const plan = composeTextReplacement({
    root,
    nodeId: child.id,
    characters: 'Hello',
    ranges: [{ start: 0, end: 5, fontName: { family: 'Inter', style: 'Bold' } }],
  });
  expect(plan.operations.map(row => row.tool)).toEqual(['set_text', 'set_text_range']);
  expect(() => observedTextRuns({ ...child, segments: [mixed().segments[0]] })).toThrow(
    'RECIPE_TEXT_RUNS_INCOMPLETE',
  );
});
it('actual text handler loads every mixed source font before replacing text', async () => {
  const root = frame('1:1', 'Page', null),
    child = add(root, mixed()),
    plan = composeTextReplacement({ root, nodeId: child.id, characters: 'CD' });
  const mixedSymbol = Symbol('mixed'),
    calls: string[] = [];
  let characters = 'AB';
  const host = {
    id: child.id,
    type: 'TEXT',
    fontName: mixedSymbol,
    getRangeAllFontNames: () => observedTextRuns(child).fonts,
    get characters() {
      return characters;
    },
    set characters(value: string) {
      calls.push('write');
      characters = value;
    },
  };
  const { createSetTextHandler } = await vi.importActual<{
    createSetTextHandler: (context: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/set-text.js');
  await createSetTextHandler({
    mixed: mixedSymbol,
    getNodeByIdAsync: async () => host,
    loadFontAsync: async (font: { style: string }) => {
      calls.push(font.style);
    },
  })(plan.operations[0]!.args);
  expect(calls).toEqual(['Regular', 'Bold', 'write']);
  expect(characters).toBe('CD');
});
function overrides() {
  const root = frame('1:1', 'Page', null),
    component = add(root, frame('1:10', 'Button', root.id, 'COMPONENT'));
  add(component, text('1:11', component.id, 'Base'));
  const original = add(root, frame('1:20', 'Source', root.id, 'INSTANCE')),
    target = add(root, frame('1:30', 'Target', root.id, 'INSTANCE'));
  original.mainComponent = target.mainComponent = {
    id: component.id,
    key: 'component-key',
    name: 'Button',
  };
  add(original, text('1:21', original.id, 'Source'));
  const targetText = add(target, text('1:31', target.id, 'Base'));
  return { root, component, original, target, targetText };
}
it('exact override transfer changes only targets still equal to their own baseline', () => {
  const data = overrides();
  const plan = composeInstanceOverrideTransfer({
    root: data.root,
    sourceInstanceId: data.original.id,
    targetInstanceIds: [data.target.id],
    fields: ['characters'],
  });
  expect(plan.operations).toMatchObject([
    { tool: 'set_text', args: { nodeId: data.targetText.id, characters: 'Source' } },
  ]);
  expect(data.targetText.characters).toBe('Base');
  data.targetText.characters = 'Intentional';
  const protectedPlan = composeInstanceOverrideTransfer({
    root: data.root,
    sourceInstanceId: data.original.id,
    targetInstanceIds: [data.target.id],
    fields: ['characters'],
  });
  expect(protectedPlan.operations).toHaveLength(0);
  expect(protectedPlan.decisions).toContainEqual({
    nodeId: data.targetText.id,
    field: 'characters',
    outcome: 'preserve-intentional-target-override',
  });
});
it('ambiguous names and incompatible component paths cannot be guessed during override mapping', () => {
  const data = overrides();
  add(data.target, text('1:32', data.target.id, 'Base'));
  expect(() =>
    composeInstanceOverrideTransfer({
      root: data.root,
      sourceInstanceId: data.original.id,
      targetInstanceIds: [data.target.id],
      fields: ['characters'],
    }),
  ).toThrow('RECIPE_OVERRIDE_PATH_AMBIGUOUS');
  data.target.children!.pop();
  data.targetText.name = 'Different path';
  expect(() =>
    composeInstanceOverrideTransfer({
      root: data.root,
      sourceInstanceId: data.original.id,
      targetInstanceIds: [data.target.id],
      fields: ['characters'],
    }),
  ).toThrow('RECIPE_OVERRIDE_PATH_MISMATCH');
});
