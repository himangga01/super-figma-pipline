import { expect, it } from 'vitest';

import {
  composeFrame,
  composePalette,
  composeTypeScale,
  resolveCompositionStep,
  validateComposition,
} from '../src/recipe-compositions.js';
import { deriveRecipePalette, deriveRecipeTypeScale } from '../src/recipe-design-system.js';
const hash = `sha256:${'a'.repeat(64)}`;
it('orders frame parenting layout size sizing and paints with explicit zero values', () => {
  const frame = composeFrame({
    sourceHash: hash,
    parentId: '1:1',
    name: 'Card',
    layout: 'VERTICAL',
    spacing: 0,
    padding: 0,
    fill: false,
    radius: 0,
  });
  expect(frame.execution).toBe('planned');
  expect(frame.steps.map(step => step.tool)).toEqual([
    'create_frame',
    'set_auto_layout',
    'set_layout_props',
    'set_auto_layout',
    'set_fills',
    'set_corner_radius',
    'get_node',
  ]);
  expect(frame.steps[2]!.args).toMatchObject({
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'HUG',
  });
  expect(frame.steps[3]!.args).toMatchObject({
    itemSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
  });
  expect(frame.steps[4]!.args.fills).toEqual([]);
  expect(frame.steps[5]!.args.radius).toBe(0);
  expect(
    resolveCompositionStep(frame.steps[3]!, new Map([['create', { nodeId: '9:2' }]])),
  ).toMatchObject({ nodeId: '9:2', paddingTop: 0 });
});
it('expands palette creation and native aliases in dependency order without fallback imports', () => {
  const palette = deriveRecipePalette({ primary: '#123456', secondary: '#654321' }),
    program = composePalette({ sourceHash: hash, namespace: 'Example', palette });
  expect(program.steps.length).toBeLessThanOrEqual(128);
  expect(program.steps.some(step => step.tool === 'add_variable_mode')).toBe(true);
  const alias = program.steps.find(step =>
    step.bindings.some(binding => binding.argument === 'aliasValue'),
  )!;
  const results = new Map(
    alias.bindings.map(binding => [
      binding.stepId,
      Object.fromEntries(
        alias.bindings
          .filter(other => other.stepId === binding.stepId)
          .map(other => [other.field, other.field === 'variableId' ? 'VariableID:9:1' : '9:2']),
      ),
    ]),
  );
  expect(resolveCompositionStep(alias, results)).toMatchObject({
    value: { type: 'VARIABLE_ALIAS', id: 'VariableID:9:1' },
  });
  const paired = composePalette({
    sourceHash: hash,
    namespace: 'Example',
    palette: deriveRecipePalette({ primary: '#123456', modeStrategy: 'paired-collections' }),
  });
  expect(paired.steps.some(step => step.tool === 'add_variable_mode')).toBe(false);
  expect(
    paired.steps
      .filter(step => step.tool === 'create_variable_collection')
      .map(step => step.args.name),
  ).toEqual([
    'Example/Primitives',
    'Example/Semantic Colors/Light',
    'Example/Semantic Colors/Dark',
  ]);
});
it('keeps real available-font read and exact style derivation before text style creation', () => {
  const scale = deriveRecipeTypeScale({
    request: { family: 'Inter', base: 16 },
    fonts: {
      scope: 'available',
      fonts: ['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({
        fontName: { family: 'Inter', style },
        count: 0,
      })),
    },
  });
  const program = composeTypeScale({ sourceHash: hash, scale });
  expect(program.steps[0]).toMatchObject({ tool: 'get_fonts', args: { available: true } });
  expect(program.steps.filter(step => step.tool === 'create_text_style')).toHaveLength(
    scale.rows.length,
  );
  expect(program.steps.at(-1)!.tool).toBe('get_styles');
});
it('rejects arbitrary/forward/incompatible reference fields and missing actual result IDs', () => {
  const program = composeFrame({
    sourceHash: hash,
    parentId: '1:1',
    name: 'Card',
    layout: 'HORIZONTAL',
  });
  const bad = structuredClone(program.steps);
  bad[1]!.bindings[0]!.stepId = 'readback';
  expect(() => validateComposition({ family: 'frame', sourceHash: hash, steps: bad })).toThrow(
    'COMPOSITION_REFERENCE_INVALID',
  );
  expect(() => resolveCompositionStep(program.steps[1]!, new Map())).toThrow(
    'COMPOSITION_RESULT_UNAVAILABLE',
  );
  const arbitrary = structuredClone(program.steps);
  Object.assign(arbitrary[1]!.bindings[0]!, { argument: '$.constructor' });
  expect(() =>
    validateComposition({ family: 'frame', sourceHash: hash, steps: arbitrary }),
  ).toThrow(/Invalid option/u);
});
