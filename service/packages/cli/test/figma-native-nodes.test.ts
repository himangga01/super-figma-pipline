import { expect, it } from 'vitest';

import { compareFigmaCaptureNodes, normalizeFigmaNativeNodes } from '../src/figma-native-nodes.js';

it('expands instance IDs and resolves bound text styles and scale without a reference capture', () => {
  const guid = (sessionID: number, localID: number) => ({ sessionID, localID });
  const message = {
    nodeChanges: [
      { guid: guid(0, 1), type: 'CANVAS', name: 'Page' },
      { guid: guid(2, 1), type: 'SYMBOL', name: 'Master', stackChildAlignSelf: 'CENTER' },
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
