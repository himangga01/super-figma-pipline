import { expect, it } from 'vitest';

import { nativeComponentProperties } from '../src/figma-native-components.js';
import { normalizeFigmaNativeNodes, compareFigmaCaptureNodes } from '../src/figma-native-nodes.js';

const guid = (localID: number) => ({ sessionID: 1, localID });
const fixture = () => {
  const set = {
    guid: guid(1),
    type: 'FRAME',
    isStateGroup: true,
    name: 'Button',
    componentPropDefs: [{ id: guid(99), name: 'State', type: 'VARIANT' }],
  };
  const component = {
    guid: guid(2),
    type: 'SYMBOL',
    name: 'Display name is not a property assignment',
    parentIndex: { guid: guid(1) },
    variantPropSpecs: [{ propDefId: guid(99), value: 'Pressed' }],
  };
  const node = { guid: guid(3), type: 'INSTANCE', symbolData: { symbolID: guid(2) } };
  return {
    set,
    component,
    node,
    byId: new Map([
      ['1:1', set],
      ['1:2', component],
    ] as Array<[string, Record<string, unknown>]>),
  };
};

it('reads variant assignments by native property identity without guessing local keys or defaults', () => {
  const f = fixture();
  const result = nativeComponentProperties(f.node, 'INSTANCE', f.byId);
  expect(result.values.variantProperties).toEqual({ State: 'Pressed' });
  expect(result.values.componentProperties).toEqual({
    State: { type: 'VARIANT', value: 'Pressed', boundVariables: {} },
  });
  expect(result.values.nativeMainComponent).toMatchObject({ id: '1:2', componentSetId: '1:1' });
  expect(result.values).not.toHaveProperty('mainComponent');
  expect(result.unknown).toEqual(['mainComponent', 'componentApi']);
});

it('does not treat assignments, missing definitions or duplicate identities as empty properties', () => {
  const f = fixture();
  expect(
    nativeComponentProperties({ ...f.node, componentPropAssignments: [] }, 'INSTANCE', f.byId)
      .unknown,
  ).toContain('componentProperties');
  f.component.variantPropSpecs.push({ propDefId: guid(99), value: 'Other' });
  expect(nativeComponentProperties(f.node, 'INSTANCE', f.byId).unknown).toContain(
    'variantProperties',
  );
  expect(nativeComponentProperties(f.node, 'INSTANCE', new Map()).unknown).toContain(
    'componentProperties',
  );
});

it('normalizes native component sets and reports unsupported component facts as unobserved', () => {
  const f = fixture();
  const result = normalizeFigmaNativeNodes({ nodeChanges: [f.set, f.component] }, '1:1');
  expect(result.nodes[0]!.type).toBe('COMPONENT_SET');
  const report = compareFigmaCaptureNodes(result.nodes, [
    {
      id: '1:1',
      type: 'COMPONENT_SET',
      componentPropertyDefinitions: { State: { type: 'VARIANT', defaultValue: 'Pressed' } },
    },
  ]);
  expect(report.differences).toEqual([]);
  expect(report.unobservedPositions).toBe(1);
  expect(report.fullCaptureAccepted).toBe(false);
});
