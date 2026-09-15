import type { GetStylesResult } from '@sfp/shared';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { mergeSinglePagePdfs } from '../../src/execution/pdf-merge.js';
import type { AtomicWritePort } from '../../src/fs/atomic-file.js';
import {
  handleDoctor,
  handleExportFramesToPdf,
  handleExportTokens,
} from '../../src/tools/safe-union.js';

const defs = {
  collections: [
    {
      id: 'c',
      name: 'Theme',
      key: 'c',
      defaultModeId: 'light',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
      ],
      variableIds: ['v', 'a'],
    },
  ],
  variables: [
    {
      id: 'v',
      key: 'v',
      name: 'Color/Primary',
      collectionId: 'c',
      resolvedType: 'COLOR',
      valuesByMode: { light: { r: 1, g: 1, b: 1, a: 1 }, dark: { r: 0, g: 0, b: 0, a: 1 } },
    },
    {
      id: 'a',
      key: 'a',
      name: 'Color/Alias',
      collectionId: 'c',
      resolvedType: 'COLOR',
      valuesByMode: {
        light: { type: 'VARIABLE_ALIAS', id: 'v' },
        dark: { type: 'VARIABLE_ALIAS', id: 'v' },
      },
    },
  ],
};
const tokenDispatcher =
  (variables: unknown = defs, paints: GetStylesResult['paints'] = []) =>
  async (name: string) =>
    name === 'get_styles' ? { paints, texts: [], effects: [], grids: [] } : variables;
const pdf = async (width: number, pageCount = 1) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([width, 100]);
  return doc.save();
};
describe('safe union tools', () => {
  it('exports paint-style-only legacy palettes without dropping opacity or raw paint definitions', async () => {
    const paints: GetStylesResult['paints'] = [
      {
        id: 's1',
        key: 'k1',
        name: 'Brand/Gold',
        description: '',
        paints: [{ type: 'SOLID', visible: true, opacity: 0.5, color: { r: 1, g: 0, b: 0 } }],
      },
      {
        id: 's2',
        key: 'k2',
        name: 'Layered',
        description: '',
        paints: [
          { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } },
          { type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } },
        ],
      },
    ];
    const dispatch = tokenDispatcher({ variables: [], collections: [] }, paints);
    const json = await handleExportTokens(dispatch, { format: 'json' });
    expect(JSON.parse(json.content!)).toEqual({
      variables: [],
      collections: [],
      paintStyles: paints,
    });
    expect(json.tokenCount).toBe(1);
    const css = await handleExportTokens(dispatch, { format: 'css' });
    expect(css.content).toContain('--brand-gold: #FF000080;');
    expect(css.tokenCount).toBe(1);
    expect(css.warnings).toEqual([expect.stringContaining('Layered')]);
  });
  it('resolves bound paint styles in the requested variable mode and preserves colliding names', async () => {
    const paints: GetStylesResult['paints'] = [
      {
        id: 's1',
        key: 'k1',
        name: 'Color/Primary',
        description: '',
        paints: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 1, g: 1, b: 1 },
            boundVariables: { color: 'v' },
          },
        ],
      },
    ];
    const css = await handleExportTokens(tokenDispatcher(defs, paints), {
      format: 'css',
      mode: 'Dark',
    });
    expect(css.content).toContain('--color-primary: #000000;');
    expect(css.content).toMatch(/--color-primary-[0-9a-f]{8}: #000000;/u);
    expect(css.tokenCount).toBe(3);
    expect(css.warnings).toContain('Disambiguated CSS variable: Color/Primary');
    paints[0]!.paints[0]!.opacity = 0.5;
    const translucent = await handleExportTokens(tokenDispatcher(defs, paints), {
      format: 'css',
      mode: 'Dark',
    });
    expect(translucent.content).toMatch(/--color-primary-[0-9a-f]{8}: #00000080;/u);
  });
  it('does not publish an incomplete export when the style read fails', async () => {
    const files: AtomicWritePort = {
      createNew: vi.fn<AtomicWritePort['createNew']>(),
      replace: vi.fn<AtomicWritePort['replace']>(),
    };
    await expect(
      handleExportTokens(
        async name => {
          if (name === 'get_styles') throw new Error('STYLE_READ_FAILED');
          return defs;
        },
        { format: 'json', outPath: 'tokens.json' },
        files,
      ),
    ).rejects.toThrow('STYLE_READ_FAILED');
    expect(files.createNew).not.toHaveBeenCalled();
  });
  it('retains all modes and aliases in JSON and resolves the selected CSS mode', async () => {
    const json = await handleExportTokens(tokenDispatcher(), { format: 'json' });
    expect(JSON.parse(json.content!)).toEqual(defs);
    const css = await handleExportTokens(tokenDispatcher(), { format: 'css', mode: 'Dark' });
    expect(css.content).toContain('--color-primary: #000000');
    expect(css.content).toContain('--color-alias: #000000');
    expect(css.tokenCount).toBe(2);
  });
  it('quotes arbitrary string values and does not overwrite existing files', async () => {
    const values = {
      collections: defs.collections,
      variables: [
        {
          ...defs.variables[0],
          resolvedType: 'STRING',
          valuesByMode: { light: '"; } body { display:none' },
        },
      ],
    };
    const result = await handleExportTokens(tokenDispatcher(values), { format: 'css' });
    expect(result.content).toContain('"\\22 ; } body { display:none"');
    const files = {
      createNew: vi
        .fn<AtomicWritePort['createNew']>()
        .mockRejectedValue(new Error('TARGET_ALREADY_EXISTS')),
      replace: vi.fn<AtomicWritePort['replace']>(),
    };
    await expect(
      handleExportTokens(tokenDispatcher(), { format: 'json', outPath: 'tokens.json' }, files),
    ).rejects.toThrow('TARGET_ALREADY_EXISTS');
    expect(files.replace).not.toHaveBeenCalled();
  });
  it('merges frames in request order, validates identity, and publishes only a complete PDF', async () => {
    const first = await pdf(111),
      second = await pdf(222);
    let published: Uint8Array | undefined;
    const files: AtomicWritePort = {
      createNew: vi.fn<AtomicWritePort['createNew']>(async (path, bytes) => {
        published = bytes;
        return { path, bytes: bytes.length };
      }),
      replace: vi.fn<AtomicWritePort['replace']>(),
    };
    const result = await handleExportFramesToPdf(
      async (_name, args) => {
        const { nodeId } = args as { nodeId: string };
        return { nodeId, bytes: nodeId === '1:1' ? first : second, base64: null };
      },
      { nodeIds: ['1:1', '2:2'], outPath: 'frames.pdf' },
      files,
    );
    expect(result.pageCount).toBe(2);
    const doc = await PDFDocument.load(published!);
    expect(doc.getPages().map(page => page.getWidth())).toEqual([111, 222]);
    vi.mocked(files.createNew).mockClear();
    await expect(
      handleExportFramesToPdf(
        async () => ({ nodeId: 'wrong', bytes: first }),
        { nodeIds: ['1:1'], outPath: 'bad.pdf' },
        files,
      ),
    ).rejects.toThrow('IDENTITY_MISMATCH');
    expect(files.createNew).not.toHaveBeenCalled();
    await expect(mergeSinglePagePdfs([await pdf(100, 2)])).rejects.toThrow('PAGE_COUNT_INVALID');
  });
  it('reports unavailable plugins and failed round trips without leaking errors', async () => {
    const roundTrip = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('private details'));
    expect(
      (await handleDoctor({}, { role: 'leader', pluginConnected: false, roundTrip })).overall,
    ).toBe('degraded');
    expect(roundTrip).not.toHaveBeenCalled();
    const result = await handleDoctor(
      { roundTrip: true },
      { role: 'leader', pluginConnected: true, roundTrip },
    );
    expect(result.overall).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private details');
  });
});
