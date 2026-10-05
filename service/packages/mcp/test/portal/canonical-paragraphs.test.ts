import { expect, it } from 'vitest';

import { BrowserReadQuerySchema } from '../../../shared/src/figma-capture-query.js';
import { readFigmaCapture, type FigmaCaptureApi } from '../../../shared/src/figma-capture-read.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';

const fixture = () => {
  const runs: Array<Record<string, unknown>> = [
    {
      start: 0,
      end: 4,
      characters: 'One\n',
      listOptions: { type: 'ORDERED' },
      indentation: 0,
      textWrapStyle: 'AUTO',
      lineHeight: { unit: 'PIXELS', value: 18 },
      letterSpacing: { unit: 'PIXELS', value: 1 },
    },
    {
      start: 4,
      end: 7,
      characters: 'Two',
      listOptions: { type: 'UNORDERED' },
      indentation: 2,
      textWrapStyle: 'BALANCE',
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 2 },
    },
  ];
  const text = {
    id: '1:2',
    name: 'Local text',
    type: 'TEXT',
    parent: null,
    characters: 'One\nTwo',
    textWrapStyle: 'BALANCE',
    boundVariables: {},
    reactions: [],
    getStyledTextSegments: (fields: readonly string[]) =>
      runs.map(run =>
        Object.fromEntries(
          Object.entries(run).filter(([key]) =>
            ['start', 'end', 'characters', ...fields].includes(key),
          ),
        ),
      ),
  };
  const page = {
    id: '0:1',
    name: 'Page',
    type: 'PAGE',
    parent: null,
    selection: [],
    children: [text],
  };
  const figma = {
    root: { id: '0:0', name: 'Fixture', type: 'DOCUMENT', parent: null },
    currentPage: page,
    getNodeById: (id: string) => (id === text.id ? text : page),
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  } as unknown as FigmaCaptureApi;
  const read = async () =>
    JSON.parse(
      await readFigmaCapture(
        BrowserReadQuerySchema.parse({ nodeId: text.id, includeTokens: false }),
        figma,
      ),
    );
  return { runs, text, read };
};

it('captures local paragraph wrapping and numbered/bulleted nested runs without text styles', async () => {
  const f = fixture();
  const captured = await f.read();
  expect(captured.nodes[0].textWrapStyle).toBe('BALANCE');
  expect(captured.nodes[0].textSegments).toEqual(f.runs);
});

it.each(['listOptions', 'indentation', 'textWrapStyle'])(
  'changes same-ID capture identity when only run %s changes',
  async field => {
    const f = fixture();
    const before = normalizeDesignObservation(await f.read());
    f.runs[0]![field] =
      field === 'listOptions' ? { type: 'UNORDERED' } : field === 'indentation' ? 3 : 'BALANCE';
    const after = normalizeDesignObservation(await f.read());
    expect(after.nodes[0]?.id).toBe(before.nodes[0]?.id);
    expect(after.contentHash).not.toBe(before.contentHash);
  },
);
