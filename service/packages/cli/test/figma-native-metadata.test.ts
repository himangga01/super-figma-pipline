import { expect, it } from 'vitest';

import { nativeMetadataProperties } from '../src/figma-native-metadata.js';

const key = 'a'.repeat(40);
const read = (
  node: Record<string, unknown>,
  type: string,
  context: { parentIsGrid?: boolean; variables?: boolean } = {},
) => nativeMetadataProperties(node, type, { parentIsGrid: false, variables: false, ...context });

it('maps imported style references to Plugin API style IDs and leaves local styles unknown', () => {
  const imported = read(
    {
      styleIdForFill: { assetRef: { key, version: '4:3' } },
      styleIdForStrokeFill: { assetRef: { key, version: '12:7' } },
    },
    'RECTANGLE',
  );
  expect(imported.values).toMatchObject({
    fillStyleId: `S:${key},4:3`,
    strokeStyleId: `S:${key},12:7`,
    effectStyleId: '',
  });
  expect(imported.values).not.toHaveProperty('gridStyleId');
  expect(imported.values).not.toHaveProperty('textStyleId');
  expect(imported.unknown).toEqual([]);

  const local = read({ styleIdForEffect: { guid: { sessionID: 1, localID: 88 } } }, 'FRAME');
  expect(local.values).toMatchObject({ fillStyleId: '', strokeStyleId: '', gridStyleId: '' });
  expect(local.values).not.toHaveProperty('effectStyleId');
  expect(local.unknown).toContain('effectStyleId');

  const group = read({}, 'GROUP');
  expect(group.values).not.toHaveProperty('fillStyleId');
  expect(group.values).not.toHaveProperty('strokeStyleId');
  expect(group.values).not.toHaveProperty('annotations');
  expect(group.values).toMatchObject({ effectStyleId: '' });
});

it('keeps text style IDs unknown when runs or text-style overrides could change them', () => {
  expect(
    read({ styleIdForText: { assetRef: { key, version: '1:2' } } }, 'TEXT').values,
  ).toMatchObject({ textStyleId: `S:${key},1:2`, fillStyleId: '' });
  const overridden = read(
    { styleIdForText: { assetRef: { key, version: '1:2' } }, isOverrideOverTextStyle: true },
    'TEXT',
  );
  expect(overridden.unknown).toContain('textStyleId');
  const runs = read(
    {
      styleIdForFill: { assetRef: { key, version: '1:2' } },
      textData: {
        styleOverrideTable: [
          { styleID: 1, styleIdForFill: { guid: { sessionID: 1, localID: 9 } } },
        ],
      },
    },
    'TEXT',
  );
  expect(runs.unknown).toContain('fillStyleId');
  expect(read({ inheritFillStyleID: { sessionID: 1, localID: 2 } }, 'FRAME').unknown).toContain(
    'fillStyleId',
  );
});

it('reports grid auto-layout defaults only outside unobserved native grid layouts', () => {
  const frame = read({ stackMode: 'VERTICAL' }, 'FRAME');
  expect(frame.values).toMatchObject({
    gridRowCount: 0,
    gridColumnCount: 0,
    gridRowGap: 0,
    gridColumnGap: 0,
    gridRowSizes: [],
    gridColumnSizes: [],
    gridRowAnchorIndex: -1,
    gridColumnAnchorIndex: -1,
    gridRowSpan: 1,
    gridColumnSpan: 1,
    gridChildHorizontalAlign: 'AUTO',
    gridChildVerticalAlign: 'AUTO',
  });
  const text = read({}, 'TEXT');
  expect(text.values).not.toHaveProperty('gridRowCount');
  expect(text.values).toMatchObject({ gridRowSpan: 1, gridChildVerticalAlign: 'AUTO' });

  const grid = read({ stackMode: 'GRID', gridRows: [{}] }, 'FRAME');
  expect(grid.values).not.toHaveProperty('gridRowCount');
  expect(grid.unknown).toEqual(expect.arrayContaining(['gridRowCount', 'gridColumnSizes']));
  const child = read({}, 'RECTANGLE', { parentIsGrid: true });
  expect(child.values).not.toHaveProperty('gridRowAnchorIndex');
  expect(child.unknown).toEqual(
    expect.arrayContaining(['gridRowAnchorIndex', 'gridChildVerticalAlign']),
  );
  expect(read({ gridRowSpan: 2 }, 'RECTANGLE').unknown).toContain('gridRowSpan');
});

it('reports empty variable and annotation data only when no native variable or annotation data exists', () => {
  const plain = read({ fillPaints: [{ type: 'SOLID' }] }, 'RECTANGLE');
  expect(plain.values).toMatchObject({
    boundVariables: {},
    explicitVariableModes: {},
    resolvedVariableModes: {},
    annotations: [],
  });
  const bound = read({ fillPaints: [{ type: 'SOLID', colorVar: { value: {} } }] }, 'RECTANGLE');
  expect(bound.unknown).toContain('boundVariables');
  expect(bound.values).toMatchObject({ explicitVariableModes: {} });
  const modes = read({ variableModeBySetMap: { entries: [{}] } }, 'FRAME');
  expect(modes.unknown).toEqual(expect.arrayContaining(['explicitVariableModes']));
  expect(read({}, 'FRAME', { variables: true }).unknown).toContain('resolvedVariableModes');
  // Variable overrides that belong to instance descendants are not this node's bindings.
  expect(
    read({ symbolData: { symbolOverrides: [{ fillPaints: [{ colorVar: {} }] }] } }, 'INSTANCE')
      .values,
  ).toMatchObject({ boundVariables: {} });
  expect(read({ annotations: [{ label: 'Note' }] }, 'FRAME').unknown).toContain('annotations');
});

it('converts observed native export settings and keeps unobserved forms unknown', () => {
  const native = (imageType: string, extra: Record<string, unknown> = {}) => ({
    suffix: '',
    imageType,
    constraint: { type: 'CONTENT_SCALE', value: 2 },
    contentsOnly: true,
    useAbsoluteBounds: false,
    colorProfile: 'DOCUMENT',
    quality: 0.76,
    useBicubicSampler: false,
    ...extra,
  });
  expect(read({}, 'GROUP').values).toMatchObject({ exportSettings: [] });
  expect(
    read({ exportSettings: [native('PNG'), native('JPEG'), native('PDF')] }, 'FRAME').values
      .exportSettings,
  ).toEqual([
    {
      format: 'PNG',
      suffix: '',
      contentsOnly: true,
      colorProfile: 'DOCUMENT',
      constraint: { type: 'SCALE', value: 2 },
    },
    {
      format: 'JPG',
      suffix: '',
      contentsOnly: true,
      colorProfile: 'DOCUMENT',
      constraint: { type: 'SCALE', value: 2 },
    },
    { format: 'PDF', suffix: '', contentsOnly: true, colorProfile: 'DOCUMENT' },
  ]);
  expect(read({ exportSettings: [native('PNG')] }, 'TEXT').values.exportSettings).toEqual([
    {
      format: 'PNG',
      suffix: '',
      contentsOnly: true,
      colorProfile: 'DOCUMENT',
      useAbsoluteBounds: false,
      constraint: { type: 'SCALE', value: 2 },
    },
  ]);
  for (const unobserved of [
    native('SVG'),
    native('PNG', { constraint: { type: 'CONTENT_WIDTH', value: 100 } }),
    native('PNG', { useAbsoluteBounds: true }),
  ])
    expect(read({ exportSettings: [unobserved] }, 'FRAME').unknown).toContain('exportSettings');
});

it('reports full-circle arc data by default and validates recorded ellipse arcs', () => {
  expect(read({}, 'ELLIPSE').values.arcData).toEqual({
    startingAngle: 0,
    endingAngle: Math.fround(2 * Math.PI),
    innerRadius: 0,
  });
  expect(
    read({ arcData: { startingAngle: 1, endingAngle: 3, innerRadius: 0.5 } }, 'ELLIPSE').values
      .arcData,
  ).toEqual({ startingAngle: 1, endingAngle: 3, innerRadius: 0.5 });
  expect(read({ arcData: { startingAngle: 'x' } }, 'ELLIPSE').unknown).toContain('arcData');
  expect(read({}, 'RECTANGLE').values).not.toHaveProperty('arcData');
});
