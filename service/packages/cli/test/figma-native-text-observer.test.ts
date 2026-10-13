import { expect, it } from 'vitest';

import { normalizeFigmaNativeNodes } from '../src/figma-native-nodes.js';

it('observes effective instance text and preserves the original public normalization when observer mutates snapshots', () => {
  const id = (localID: number) => ({ sessionID: 1, localID });
  const message = {
    nodeChanges: [
      { guid: id(0), type: 'CANVAS' },
      { guid: id(10), type: 'SYMBOL' },
      {
        guid: id(11),
        parentIndex: { guid: id(10), position: '!' },
        type: 'TEXT',
        textData: { characters: 'Default' },
        derivedTextData: { glyphs: [{ commandsBlob: 0 }] },
      },
      {
        guid: id(1),
        parentIndex: { guid: id(0), position: '!' },
        type: 'INSTANCE',
        symbolData: {
          symbolID: id(10),
          symbolOverrides: [{ guidPath: { guids: [id(11)] }, textData: { characters: 'Actual' } }],
        },
        derivedSymbolData: [
          { guidPath: { guids: [id(11)] }, derivedTextData: { glyphs: [{ commandsBlob: 7 }] } },
        ],
      },
    ],
  };
  const baseline = normalizeFigmaNativeNodes(message, '1:0'),
    seen: Array<unknown> = [];
  const observed = normalizeFigmaNativeNodes(message, '1:0', entry => {
    seen.push(structuredClone(entry));
    (entry.effective as Record<string, unknown>).textData = { characters: 'Mutated' };
    (entry.normalized as Record<string, unknown>).characters = 'Mutated';
  });
  expect(observed).toEqual(baseline);
  expect(seen).toMatchObject([
    {
      nodeId: 'I1:1;1:11',
      effective: {
        textData: { characters: 'Actual' },
        derivedTextData: { glyphs: [{ commandsBlob: 7 }] },
      },
      normalized: { characters: 'Actual' },
    },
  ]);
});
