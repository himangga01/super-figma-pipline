import { expect, it } from 'vitest';

import { nativeContainerProperties, nativeLayoutSizing } from '../src/figma-native-layout.js';

it('reports container and corner fields with omitted defaults only for their Plugin API types', () => {
  expect(nativeContainerProperties({}, 'FRAME')).toEqual({
    values: {
      cornerSmoothing: 0,
      strokesIncludedInLayout: false,
      numberOfFixedChildren: 0,
      overflowDirection: 'NONE',
      layoutGrids: [],
      targetAspectRatio: null,
    },
    unknown: [],
  });
  expect(nativeContainerProperties({ cornerSmoothing: 0.6 }, 'VECTOR')).toEqual({
    values: { cornerSmoothing: 0.6, targetAspectRatio: null },
    unknown: [],
  });
  expect(nativeContainerProperties({}, 'TEXT').values).toEqual({ targetAspectRatio: null });
  expect(nativeContainerProperties({}, 'LINE').values).toEqual({});
  expect(nativeContainerProperties({}, 'GROUP').values).toEqual({ targetAspectRatio: null });
  expect(
    nativeContainerProperties({ bordersTakeSpace: true, scrollDirection: 'VERTICAL' }, 'INSTANCE')
      .values,
  ).toMatchObject({ strokesIncludedInLayout: true, overflowDirection: 'VERTICAL' });
});

it('converts native layout grids and leaves unobserved grid forms unknown', () => {
  const color = { r: 1, g: 0, b: 0, a: 0.1 };
  const columns = {
    type: 'STRETCH',
    axis: 'X',
    visible: false,
    numSections: 12,
    offset: 100,
    sectionSize: 10,
    gutterSize: 30,
    color,
    pattern: 'STRIPES',
  };
  expect(
    nativeContainerProperties(
      {
        layoutGrids: [
          columns,
          { ...columns, axis: 'Y', type: 'CENTER', numSections: 3, sectionSize: 40 },
          { pattern: 'GRID', visible: true, sectionSize: 8, color },
        ],
      },
      'FRAME',
    ).values.layoutGrids,
  ).toEqual([
    {
      pattern: 'COLUMNS',
      visible: false,
      color,
      gutterSize: 30,
      alignment: 'STRETCH',
      count: 12,
      offset: 100,
      boundVariables: {},
    },
    {
      pattern: 'ROWS',
      visible: false,
      color,
      gutterSize: 30,
      alignment: 'CENTER',
      count: 3,
      sectionSize: 40,
      boundVariables: {},
    },
    { pattern: 'GRID', visible: true, color, sectionSize: 8, boundVariables: {} },
  ]);
  for (const grid of [
    { ...columns, gutterSizeVar: {} },
    { ...columns, pattern: 'DIAGONAL' },
    { ...columns, numSections: 0 },
  ]) {
    const result = nativeContainerProperties({ layoutGrids: [grid] }, 'FRAME');
    expect(result.unknown).toEqual(['layoutGrids']);
    expect(result.values).not.toHaveProperty('layoutGrids');
  }
  expect(
    nativeContainerProperties(
      { targetAspectRatio: { x: 1, y: 2 }, fixedChildrenDivider: 'a' },
      'FRAME',
    ).unknown,
  ).toEqual(['numberOfFixedChildren', 'targetAspectRatio']);
});

it.each([
  {
    case: 'a primary-axis grower fills a horizontal parent',
    node: { type: 'FRAME', layoutMode: 'NONE', layoutGrow: 1, layoutAlign: 'INHERIT' },
    parent: { layoutMode: 'HORIZONTAL' },
    expected: ['FILL', 'FIXED'],
  },
  {
    case: 'a counter-axis stretch fills a vertical parent horizontally',
    node: { type: 'RECTANGLE', layoutGrow: 0, layoutAlign: 'STRETCH' },
    parent: { layoutMode: 'VERTICAL' },
    expected: ['FILL', 'FIXED'],
  },
  {
    case: 'auto-sized auto layout hugs on its own axes',
    node: {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'FIXED',
    },
    parent: null,
    expected: ['FIXED', 'HUG'],
  },
  {
    case: 'auto-width text hugs only inside an auto-layout parent',
    node: { type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT' },
    parent: { layoutMode: 'HORIZONTAL' },
    expected: ['HUG', 'HUG'],
  },
  {
    case: 'auto-height text hugs vertically inside an auto-layout parent',
    node: { type: 'TEXT', textAutoResize: 'HEIGHT' },
    parent: { layoutMode: 'VERTICAL' },
    expected: ['FIXED', 'HUG'],
  },
  {
    case: 'auto-width text outside auto layout stays fixed',
    node: { type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT' },
    parent: { layoutMode: 'NONE' },
    expected: ['FIXED', 'FIXED'],
  },
  {
    case: 'a hidden auto-layout child is not laid out',
    node: { type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT', visible: false, layoutGrow: 1 },
    parent: { layoutMode: 'HORIZONTAL' },
    expected: ['FIXED', 'FIXED'],
  },
  {
    case: 'an absolutely positioned child is not laid out',
    node: { type: 'RECTANGLE', layoutPositioning: 'ABSOLUTE', layoutGrow: 1 },
    parent: { layoutMode: 'HORIZONTAL' },
    expected: ['FIXED', 'FIXED'],
  },
  {
    case: 'an unknown parent layout leaves sizing unknown',
    node: { type: 'RECTANGLE', layoutGrow: 1 },
    parent: { type: 'FRAME' },
    expected: [undefined, undefined],
  },
  {
    case: 'an unknown own container layout leaves sizing unknown',
    node: { type: 'FRAME' },
    parent: null,
    expected: [undefined, undefined],
  },
])('derives layout sizing: $case', ({ node, parent, expected }) => {
  expect([nativeLayoutSizing(node, parent, true), nativeLayoutSizing(node, parent, false)]).toEqual(
    expected,
  );
});

import { normalizeNativeLayout } from '../src/figma-native-layout.js';
import { normalizeFigmaNativeNodes, compareFigmaCaptureNodes } from '../src/figma-native-nodes.js';

it('converts native automatic layout, asymmetric padding and explicit bounds independently', () => {
  const result = normalizeNativeLayout(
    {
      stackMode: 'VERTICAL',
      stackPrimarySizing: 'FIXED',
      stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
      stackPrimaryAlignItems: 'SPACE_EVENLY',
      stackCounterAlignItems: 'CENTER',
      stackHorizontalPadding: 20,
      stackPaddingRight: 12,
      stackVerticalPadding: 8,
      stackPaddingBottom: 4,
      stackSpacing: -2,
      stackWrap: 'WRAP',
      stackCounterSpacing: 6,
      stackReverseZIndex: true,
      minSize: { x: 100 },
      maxSize: { y: 500 },
      mask: true,
      maskType: 'OUTLINE',
      horizontalConstraint: 'SCALE',
      verticalConstraint: 'MAX',
      stackPositioning: 'ABSOLUTE',
    },
    true,
  );
  expect(result.unknown).toEqual([]);
  expect(result.values).toMatchObject({
    layoutMode: 'VERTICAL',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'AUTO',
    primaryAxisAlignItems: 'SPACE_BETWEEN',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 4,
    itemSpacing: -2,
    layoutWrap: 'WRAP',
    counterAxisSpacing: 6,
    itemReverseZIndex: true,
    minWidth: 100,
    minHeight: null,
    maxWidth: null,
    maxHeight: 500,
    isMask: true,
    maskType: 'VECTOR',
    constraints: { horizontal: 'SCALE', vertical: 'MAX' },
    layoutPositioning: 'ABSOLUTE',
  });
});

it('leaves unsupported and nonfinite layout fields unknown instead of applying defaults', () => {
  const result = normalizeNativeLayout(
    { stackMode: 'GRID', stackSpacing: Infinity, stackPrimarySizing: 'future', maskType: 'future' },
    true,
  );
  expect(result.unknown).toEqual(
    expect.arrayContaining(['layoutMode', 'itemSpacing', 'primaryAxisSizingMode', 'maskType']),
  );
  expect(result.values).not.toHaveProperty('layoutMode');
  expect(normalizeNativeLayout({ stackPadding: 10 }, true).unknown).toContain(
    'legacy-stack-layout',
  );
  expect(normalizeNativeLayout({}, false).values).not.toHaveProperty('layoutMode');
});

it('normalizes and compares actual frame layout through the node collector', () => {
  const node = {
    guid: { sessionID: 1, localID: 1 },
    type: 'FRAME',
    name: 'Stack',
    stackMode: 'HORIZONTAL',
    stackSpacing: 5,
  };
  const result = normalizeFigmaNativeNodes({ nodeChanges: [node] }, '1:1');
  expect(result.nodes[0]).toMatchObject({
    layoutMode: 'HORIZONTAL',
    itemSpacing: 5,
    maskType: 'ALPHA',
  });
  const comparison = compareFigmaCaptureNodes(result.nodes, [
    { id: '1:1', itemSpacing: 6, layoutMode: 'HORIZONTAL' },
  ]);
  expect(comparison.differences).toEqual([
    { nodeId: '1:1', field: 'itemSpacing', actual: 5, expected: 6 },
  ]);
});
