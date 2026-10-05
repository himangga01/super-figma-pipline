import { expect, it } from 'vitest';

import { compareFigmaCaptureNodes, normalizeFigmaNativeNodes } from '../src/figma-native-nodes.js';

it('expands instance IDs and resolves bound text styles and scale without a reference capture', () => {
  const guid = (sessionID: number, localID: number) => ({ sessionID, localID });
  const message = {
    nodeChanges: [
      { guid: guid(0, 1), type: 'CANVAS', name: 'Page' },
      {
        guid: guid(2, 1),
        type: 'SYMBOL',
        name: 'Master',
        stackChildAlignSelf: 'CENTER',
        horizontalConstraint: 'MAX',
        verticalConstraint: 'CENTER',
      },
      {
        guid: guid(2, 2),
        parentIndex: { guid: guid(2, 1), position: '!' },
        type: 'TEXT',
        name: 'Title',
        fontSize: 24,
        styleIdForText: { guid: guid(9, 1) },
        textData: { characters: 'Preserve \u2028\ufeff' },
      },
      {
        guid: guid(9, 1),
        type: 'TEXT',
        styleType: 'TEXT',
        fontSize: 20,
        paragraphSpacing: 10,
        fontName: { family: 'Fixture', style: 'Regular' },
        lineHeight: { units: 'RAW', value: 1.2 },
      },
      {
        guid: guid(1, 1),
        parentIndex: { guid: guid(0, 1), position: '!' },
        type: 'INSTANCE',
        name: 'Card',
        horizontalConstraint: 'SCALE',
        symbolData: { symbolID: guid(2, 1), uniformScaleFactor: 0.5 },
        transform: { m00: 1, m11: 1, m02: 10, m12: 20 },
      },
    ],
  };
  const result = normalizeFigmaNativeNodes(message, '0:1');
  expect(result.complete).toBe(false);
  expect(result.nodeCount).toBe(2);
  expect(result.nodes[0]).toMatchObject({
    id: '1:1',
    type: 'INSTANCE',
    name: 'Card',
    layoutAlign: 'INHERIT',
    constraints: { horizontal: 'SCALE', vertical: 'MIN' },
    children: [
      {
        id: 'I1:1;2:2',
        characters: 'Preserve \u2028\ufeff',
        fontSize: 10,
        paragraphSpacing: 5,
        fontName: { family: 'Fixture', style: 'Regular' },
        lineHeight: { unit: 'PERCENT', value: 120 },
      },
    ],
  });
});

it('reports missing nodes and properties without treating a partial comparison as acceptance', () => {
  const report = compareFigmaCaptureNodes(
    [{ id: '1:1', name: 'First', width: 10 }],
    [
      { id: '1:1', name: 'First', width: 12, fontSize: 16 },
      { id: '1:2', name: 'Missing' },
    ],
  );
  expect(report.missingNodes).toEqual(['1:2']);
  expect(report.differences.map(row => row.field)).toEqual(['width', 'fontSize']);
  expect(report.fullCaptureAccepted).toBe(false);
});

it('uses native override identities inside instances while preserving standalone component IDs', () => {
  const guid = (sessionID: number, localID: number) => ({ sessionID, localID });
  const message = {
    nodeChanges: [
      { guid: guid(0, 1), type: 'CANVAS', name: 'Page' },
      { guid: guid(2, 1), type: 'SYMBOL', name: 'Master' },
      {
        guid: guid(2, 2),
        overrideKey: guid(9, 8),
        parentIndex: { guid: guid(2, 1) },
        type: 'VECTOR',
        name: 'Shape',
        strokeWeight: 1,
      },
      {
        guid: guid(1, 1),
        parentIndex: { guid: guid(0, 1) },
        type: 'INSTANCE',
        name: 'Instance',
        symbolData: {
          symbolID: guid(2, 1),
          symbolOverrides: [{ guidPath: { guids: [guid(9, 8)] }, strokeWeight: 3 }],
        },
        derivedSymbolData: [
          {
            guidPath: { guids: [guid(9, 8)] },
            transform: { m02: 4, m12: 6 },
            size: { x: 2, y: 3 },
          },
        ],
      },
    ],
  };
  const instance = normalizeFigmaNativeNodes(message, '0:1');
  expect(instance.nodes[0]).toMatchObject({
    childIds: ['I1:1;9:8'],
    children: [{ id: 'I1:1;9:8', x: 4, y: 6, width: 2, height: 3, strokeWeight: 3 }],
  });
  const component = normalizeFigmaNativeNodes(message, '2:1');
  expect(component.nodes[0]).toMatchObject({
    childIds: ['2:2'],
    children: [{ id: '2:2', strokeWeight: 1 }],
  });
  message.nodeChanges.push({
    guid: guid(2, 3),
    overrideKey: guid(9, 8),
    parentIndex: { guid: guid(2, 1) },
    type: 'VECTOR',
    name: 'Collision',
    strokeWeight: 1,
  });
  expect(() => normalizeFigmaNativeNodes(message, '0:1')).toThrow('FIGMA_NATIVE_NODE_ID_DUPLICATE');
});

it('preserves native float32 placement, automatic line height and independent edge values', () => {
  const guid = (localID: number) => ({ sessionID: 1, localID });
  const message = {
    nodeChanges: [
      { guid: guid(0), type: 'CANVAS', name: 'Page' },
      {
        guid: guid(1),
        parentIndex: { guid: guid(0) },
        type: 'FRAME',
        name: 'Frame',
        transform: { m02: 10000 },
        size: { x: 100, y: 100 },
      },
      {
        guid: guid(2),
        parentIndex: { guid: guid(1) },
        type: 'TEXT',
        name: 'Auto',
        transform: { m02: Math.fround(0.1) },
        size: { x: 20, y: 30 },
        lineHeight: { units: 'PERCENT', value: 100 },
        letterSpacing: { units: 'PERCENT', value: 100 },
      },
      {
        guid: guid(3),
        parentIndex: { guid: guid(1) },
        type: 'TEXT',
        name: 'Explicit',
        lineHeight: { units: 'RAW', value: 1 },
      },
      {
        guid: guid(4),
        parentIndex: { guid: guid(1) },
        type: 'ROUNDED_RECTANGLE',
        name: 'Rounded',
        rectangleCornerRadiiIndependent: true,
        rectangleTopLeftCornerRadius: 10,
        rectangleTopRightCornerRadius: 10,
        rectangleBottomLeftCornerRadius: 10,
        rectangleBottomRightCornerRadius: 10,
      },
      {
        guid: guid(5),
        parentIndex: { guid: guid(1) },
        type: 'FRAME',
        name: 'Mixed',
        rectangleCornerRadiiIndependent: true,
        rectangleTopLeftCornerRadius: 10,
        borderStrokeWeightsIndependent: true,
        borderTopWeight: 1,
        strokeWeight: 1,
      },
      { guid: guid(6), parentIndex: { guid: guid(1) }, type: 'ELLIPSE', name: 'Round' },
    ],
  };
  const children = normalizeFigmaNativeNodes(message, '1:0').nodes[0]!.children as Array<
    Record<string, unknown>
  >;
  expect(children[0]).toMatchObject({
    absoluteTransform: [
      [1, 0, Math.fround(10000 + Math.fround(0.1))],
      [0, 1, 0],
    ],
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PERCENT', value: 100 },
  });
  expect(children[1]).toMatchObject({ lineHeight: { unit: 'PERCENT', value: 100 } });
  expect(children[2]).toMatchObject({ cornerRadius: 10, topLeftRadius: 10, bottomRightRadius: 10 });
  expect(children[3]).toMatchObject({
    cornerRadius: 'mixed',
    strokeWeight: 'mixed',
    strokeTopWeight: 1,
    strokeBottomWeight: 0,
  });
  expect(children[4]).toMatchObject({ cornerRadius: 0 });
});

it('resolves imported style keys at their recorded version without borrowing reference paints', () => {
  const guid = (localID: number) => ({ sessionID: 1, localID });
  const paint = (r: number) => [{ type: 'SOLID', color: { r, g: 0, b: 0, a: 1 } }];
  const message = {
    nodeChanges: [
      { guid: guid(0), type: 'CANVAS', name: 'Page' },
      {
        guid: guid(1),
        parentIndex: { guid: guid(0) },
        type: 'VECTOR',
        name: 'Shape',
        fillPaints: paint(0),
        styleIdForFill: { assetRef: { key: 'fixture-key', version: '2:3' } },
      },
      {
        guid: guid(8),
        type: 'RECTANGLE',
        name: 'Remote',
        styleType: 'FILL',
        key: 'fixture-key',
        version: '2:3',
        fillPaints: paint(1),
      },
    ],
  };
  expect(normalizeFigmaNativeNodes(message, '1:0').nodes[0]?.fills).toMatchObject([
    { color: { r: 1, g: 0, b: 0 } },
  ]);
  message.nodeChanges[2]!.version = '2:4';
  const stale = normalizeFigmaNativeNodes(message, '1:0');
  expect(stale.nodes[0]?.fills).toMatchObject([{ color: { r: 0, g: 0, b: 0 } }]);
  expect(stale.warnings).toContainEqual({
    code: 'NATIVE_STYLE_UNAVAILABLE',
    nodeId: '1:1',
    detail: 'FILL',
  });
});

it('resolves effect styles inside instances and compares effects as a declared field', () => {
  const guid = (sessionID: number, localID: number) => ({ sessionID, localID });
  const shadow = (a: number) => ({
    type: 'DROP_SHADOW',
    offset: { x: 0, y: 2 },
    radius: 6,
    visible: true,
    blendMode: 'NORMAL',
    spread: 0,
    showShadowBehindNode: true,
    color: { r: 0, g: 0, b: 0, a },
  });
  const message = {
    nodeChanges: [
      { guid: guid(0, 1), type: 'CANVAS', name: 'Page' },
      { guid: guid(2, 1), type: 'SYMBOL', name: 'Master' },
      {
        guid: guid(2, 2),
        parentIndex: { guid: guid(2, 1) },
        type: 'TEXT',
        name: 'Label',
        effects: [shadow(0.2)],
        styleIdForEffect: { guid: guid(9, 1) },
      },
      { guid: guid(9, 1), type: 'RECTANGLE', styleType: 'EFFECT', effects: [shadow(0.55)] },
      {
        guid: guid(1, 1),
        parentIndex: { guid: guid(0, 1) },
        type: 'INSTANCE',
        name: 'Card',
        symbolData: { symbolID: guid(2, 1) },
      },
      {
        guid: guid(3, 1),
        parentIndex: { guid: guid(0, 1) },
        type: 'RECTANGLE',
        name: 'Glass',
        effects: [{ type: 'GLASS', radius: 4, visible: true }],
      },
    ],
  };
  const native = normalizeFigmaNativeNodes(message, '0:1');
  const label = (native.nodes[0]!.children as Array<Record<string, unknown>>)[0];
  expect(native.nodes[0]?.effects).toEqual([]);
  expect(label?.effects).toEqual([
    {
      type: 'DROP_SHADOW',
      visible: true,
      radius: 6,
      boundVariables: {},
      color: { r: 0, g: 0, b: 0, a: 0.55 },
      offset: { x: 0, y: 2 },
      spread: 0,
      blendMode: 'NORMAL',
      showShadowBehindNode: true,
    },
  ]);
  expect(native.nodes[1]).not.toHaveProperty('effects');
  expect(native.warnings).toContainEqual({ code: 'NATIVE_EFFECTS_UNSUPPORTED', nodeId: '3:1' });
  const report = compareFigmaCaptureNodes(native.nodes, [
    { id: '1:1', effects: [] },
    { id: '3:1', effects: [{ type: 'GLASS' }] },
  ]);
  expect(report.comparedFields).toContain('effects');
  expect(report.differences).toEqual([
    { nodeId: '3:1', field: 'effects', actual: undefined, expected: [{ type: 'GLASS' }] },
  ]);
});

it('emits stroke miter limits, dash patterns and side weights only for Plugin API stroke types', () => {
  const guid = (localID: number) => ({ sessionID: 1, localID });
  const child = (localID: number, fields: Record<string, unknown>) => ({
    guid: guid(localID),
    parentIndex: { guid: guid(0), position: String.fromCharCode(64 + localID) },
    ...fields,
  });
  const message = {
    nodeChanges: [
      { guid: guid(0), type: 'CANVAS', name: 'Page' },
      child(1, { type: 'FRAME', name: 'Frame', strokeWeight: 2 }),
      child(2, { type: 'FRAME', name: 'Group', resizeToFit: true, strokeWeight: 1 }),
      child(3, { type: 'TEXT', name: 'Text', strokeWeight: 1 }),
      child(4, {
        type: 'VECTOR',
        name: 'Dashed',
        strokeWeight: 1,
        miterLimit: 10,
        dashPattern: [4, 2],
      }),
      child(5, {
        type: 'ROUNDED_RECTANGLE',
        name: 'Edges',
        strokeWeight: 1,
        borderStrokeWeightsIndependent: true,
        borderTopWeight: 1,
        borderRightWeight: 0,
        borderBottomWeight: 0,
        borderLeftWeight: 0,
      }),
      child(6, { type: 'VECTOR', name: 'Tagged', strokeWeight: 1, dashPattern: [1, 'x'] }),
    ],
  };
  const native = normalizeFigmaNativeNodes(message, '1:0');
  const [frame, group, text, dashed, edges, tagged] = native.nodes;
  const sides = (value: unknown) => ({
    strokeTopWeight: value,
    strokeRightWeight: value,
    strokeBottomWeight: value,
    strokeLeftWeight: value,
  });
  expect(frame).toMatchObject({ strokeMiterLimit: 4, dashPattern: [], ...sides(2) });
  for (const field of ['strokeMiterLimit', 'dashPattern', 'strokeTopWeight'])
    expect(group).not.toHaveProperty(field);
  expect(text).toMatchObject({ strokeMiterLimit: 4, dashPattern: [] });
  expect(text).not.toHaveProperty('strokeTopWeight');
  expect(dashed).toMatchObject({ strokeMiterLimit: 10, dashPattern: [4, 2] });
  expect(edges).toMatchObject({
    strokeWeight: 'mixed',
    strokeTopWeight: 1,
    strokeRightWeight: 0,
    strokeBottomWeight: 0,
    strokeLeftWeight: 0,
  });
  expect(tagged).not.toHaveProperty('dashPattern');
  expect(native.warnings).toContainEqual({
    code: 'NATIVE_STROKE_UNSUPPORTED',
    nodeId: '1:6',
    detail: 'dashPattern',
  });
  expect(compareFigmaCaptureNodes(native.nodes, []).comparedFields).toEqual(
    expect.arrayContaining([
      'strokeMiterLimit',
      'dashPattern',
      'strokeTopWeight',
      'strokeLeftWeight',
    ]),
  );
});

it('emits layout sizing derived only from decoded native layout fields', () => {
  const guid = (localID: number) => ({ sessionID: 1, localID });
  const message = {
    nodeChanges: [
      { guid: guid(0), type: 'CANVAS', name: 'Page' },
      {
        guid: guid(1),
        parentIndex: { guid: guid(0), position: 'A' },
        type: 'FRAME',
        name: 'Row',
        stackMode: 'HORIZONTAL',
        stackPrimarySizing: 'RESIZE_TO_FIT',
      },
      {
        guid: guid(2),
        parentIndex: { guid: guid(1), position: 'A' },
        type: 'TEXT',
        name: 'Label',
        textAutoResize: 'WIDTH_AND_HEIGHT',
      },
      {
        guid: guid(3),
        parentIndex: { guid: guid(1), position: 'B' },
        type: 'ROUNDED_RECTANGLE',
        name: 'Spacer',
        stackChildPrimaryGrow: 1,
      },
    ],
  };
  const native = normalizeFigmaNativeNodes(message, '1:0');
  expect(native.nodes[0]).toMatchObject({
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'FIXED',
    children: [
      { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' },
      { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED' },
    ],
  });
  expect(compareFigmaCaptureNodes(native.nodes, []).comparedFields).toEqual(
    expect.arrayContaining(['layoutSizingHorizontal', 'layoutSizingVertical']),
  );
});

it('explains unpainted stroke side widths only when both collectors record no stroke paints', () => {
  const node = (strokes: unknown[], weight: number) => ({
    id: '1:1',
    strokes,
    strokeWeight: weight,
    strokeTopWeight: weight,
  });
  const unpainted = compareFigmaCaptureNodes([node([], 1)], [node([], 0.7)]);
  expect(unpainted.differences.map(row => row.field)).toEqual(['strokeWeight', 'strokeTopWeight']);
  expect(unpainted.unexplainedDifferenceCount).toBe(0);
  const paint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
  const painted = compareFigmaCaptureNodes([node([paint], 1)], [node([paint], 0.7)]);
  expect(painted.unexplainedDifferenceCount).toBe(2);
});

it('compares an explicit default weight axis only with independent native weight evidence', () => {
  const fontName = { family: 'Example', style: 'Bold' };
  const actual = [
    {
      id: '1:1',
      fontName,
      resolvedFontRanges: [{ start: 0, end: 1, fontName, nativeFontWeight: 700 }],
    },
  ];
  const reference = (axes: Record<string, number>) => [
    {
      id: '1:1',
      fontName: 'mixed',
      textSegments: [{ start: 0, end: 1, fontName: { ...fontName, variationSettings: axes } }],
    },
  ];
  const equal = compareFigmaCaptureNodes(actual, reference({ wght: 700 }));
  expect(equal.fontRangeEvidence).toEqual([{ nodeId: '1:1', matches: true }]);
  expect(equal.differences).toHaveLength(1);
  expect(
    compareFigmaCaptureNodes(actual, reference({ wght: 600 })).fontRangeEvidence[0]?.matches,
  ).toBe(false);
  expect(
    compareFigmaCaptureNodes(actual, reference({ wght: 700, wdth: 80 })).fontRangeEvidence[0]
      ?.matches,
  ).toBe(false);
});
