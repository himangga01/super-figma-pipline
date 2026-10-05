import { runInNewContext } from 'node:vm';

import type { Page } from 'playwright';
import { expect, it } from 'vitest';

import { parseFigmaTarget } from '../src/figma-url.js';
import { createFigmaReadProgram } from '../src/read-program.js';
import { readScripterSnapshot } from '../src/snapshot-reader.js';

const mandatoryFields = [
  'fontName',
  'fontSize',
  'fontWeight',
  'fills',
  'lineHeight',
  'letterSpacing',
  'listOptions',
  'indentation',
  'textWrapStyle',
  'textDecoration',
  'textCase',
  'hyperlink',
  'textStyleId',
  'fillStyleId',
] as const;
const styled = (characters: string, start = 0) => ({
  characters,
  start,
  end: start + characters.length,
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  fontWeight: 400,
  fills: [],
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  listOptions: { type: 'NONE' },
  indentation: 0,
  textWrapStyle: 'AUTO',
  textDecoration: 'NONE',
  textCase: 'ORIGINAL',
  hyperlink: null,
  textStyleId: '',
  fillStyleId: '',
});
function fixture(segments: unknown, characters = 'Text') {
  const node = {
    id: '1:2',
    name: 'Body',
    type: 'TEXT',
    characters,
    boundVariables: {},
    reactions: [],
    getStyledTextSegments: () => segments,
  };
  const figma = {
    root: { name: 'Fixture' },
    currentPage: { id: '0:1', name: 'Page', selection: [], children: [node] },
    getNodeByIdAsync: async () => node,
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
  return { figma, node };
}

it.each(mandatoryFields)(
  'marks an official-shaped omission of requested %s partial without replacing source values',
  async field => {
    const first = styled('Te'),
      second: Record<string, unknown> = styled('xt', 2);
    delete second[field];
    const { figma } = fixture([first, second]);
    const result = JSON.parse(await runInNewContext(createFigmaReadProgram({}), { figma }));
    expect(result).toMatchObject({ truncated: true, valueTruncated: true });
    expect(result.warnings).toContainEqual({
      code: 'TEXT_SEGMENT_FIELD_MISSING',
      nodeId: '1:2',
      segmentIndex: 1,
      field,
    });
    expect(result.nodes[0].textSegments[0]).toEqual(first);
    expect(result.nodes[0].textSegments[1]).toEqual(second);
    expect(result.nodes[0].textSegments[1]).not.toHaveProperty(field);
  },
);

// Controlled postMessage surfaces execute the actual production bridge callback and compiled reader.
// They establish raw transport preservation, not an actual Chrome/CDP or live Figma acceptance.
function rawBridge(figma: unknown) {
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  const listeners = new Set<(event: unknown) => void>();
  const rawResults: string[] = [];
  const parent = {
    postMessage(message: { type: string; id: string; js?: string }) {
      if (message.type !== 'eval') return;
      void Promise.resolve(runInNewContext(message.js!, { figma })).then(result => {
        rawResults.push(result);
        for (const listener of listeners)
          listener({ source: parent, data: { type: 'eval-response', id: message.id, result } });
        return result;
      });
    },
  };
  const window = {
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.delete(listener),
  };
  const frame = {
    url: () => 'https://scripter.rsms.me/',
    evaluate: (callback: { toString(): string }, args: unknown) =>
      runInNewContext('(' + callback.toString() + ')(args)', {
        args,
        window,
        parent,
        setTimeout,
        clearTimeout,
      }),
  };
  const page = { url: () => target.url, frames: () => [frame] } as unknown as Page;
  return { page, target, rawResults, listeners };
}

it('keeps an omitted wrap field incomplete through raw bridge parsing and snapshot reobservation', async () => {
  const segment: Record<string, unknown> = styled('Text');
  delete segment.textWrapStyle;
  const bridge = rawBridge(fixture([segment]).figma);
  const result = await readScripterSnapshot(bridge.page, bridge.target, {});
  expect(result.observation.readComplete).toBe(false);
  expect(result.truncated).toBe(true);
  expect(result.warnings).toContainEqual(
    expect.objectContaining({
      code: 'TEXT_SEGMENT_FIELD_MISSING',
      nodeId: '1:2',
      segmentIndex: 0,
      field: 'textWrapStyle',
    }),
  );
  expect(result.nodes[0]!.textSegments).toEqual([segment]);
  expect(bridge.listeners.size).toBe(0);
});

it('preserves full Chrome-shaped segments and Unicode code units through the compiled read program and raw postMessage bridge', async () => {
  const characters = 'First\u2028Second\uFEFFThird';
  const segment = styled(characters);
  const bridge = rawBridge(fixture([segment], characters).figma);
  const result = await readScripterSnapshot(bridge.page, bridge.target, {});
  expect(result.observation.readComplete).toBe(true);
  expect(result.truncated).toBe(false);
  expect(result.nodes[0]!.characters).toBe(characters);
  expect(result.nodes[0]!.textSegments).toEqual([segment]);
  expect(
    bridge.rawResults.some(value => value.includes('\u2028') && value.includes('\uFEFF')),
  ).toBe(true);
  expect(bridge.listeners.size).toBe(0);
});

it.each(['AUTO', 'BALANCE'])(
  'recovers omitted wrapping only from the observed uniform node-level %s value with provenance',
  async textWrapStyle => {
    const segment: Record<string, unknown> = styled('Text');
    delete segment.textWrapStyle;
    Object.freeze(segment);
    const { figma, node } = fixture([segment]);
    Object.assign(node, { textWrapStyle });
    const bridge = rawBridge(figma);
    const result = await readScripterSnapshot(bridge.page, bridge.target, {});
    expect(result.observation.readComplete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.nodes[0]!.textSegments).toEqual([{ ...segment, textWrapStyle }]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'TEXT_SEGMENT_FIELD_RECOVERED',
        nodeId: '1:2',
        segmentIndex: 0,
        field: 'textWrapStyle',
        source: 'node.textWrapStyle',
      }),
    );
    expect(segment).not.toHaveProperty('textWrapStyle');
  },
);

it.each([Symbol('mixed'), undefined, 'UNKNOWN', null])(
  'keeps omitted wrapping partial for a mixed, absent or unsupported node value %s',
  async textWrapStyle => {
    const segment: Record<string, unknown> = styled('Text');
    delete segment.textWrapStyle;
    const { figma, node } = fixture([segment]);
    Object.assign(node, { textWrapStyle });
    const result = JSON.parse(await runInNewContext(createFigmaReadProgram({}), { figma }));
    expect(result.valueTruncated).toBe(true);
    expect(result.nodes[0].textSegments).toEqual([segment]);
    expect(result.warnings).toContainEqual({
      code: 'TEXT_SEGMENT_FIELD_MISSING',
      nodeId: '1:2',
      segmentIndex: 0,
      field: 'textWrapStyle',
    });
    expect(
      result.warnings.some(
        (value: { code: string }) => value.code === 'TEXT_SEGMENT_FIELD_RECOVERED',
      ),
    ).toBe(false);
  },
);

it.each([
  { label: 'undefined', segments: undefined },
  { label: 'null', segments: null },
  { label: 'object', segments: {} },
  { label: 'empty array', segments: [] },
])('does not promote $label getter to complete nonempty text', async ({ segments }) => {
  const { figma } = fixture(segments);
  const result = JSON.parse(await runInNewContext(createFigmaReadProgram({}), { figma }));
  expect(result.nodes[0].characters).toBe('Text');
  expect(result.nodes[0].textSegments).toEqual(segments);
  expect(result.valueTruncated).toBe(true);
  expect(result.warnings).toContainEqual(
    expect.objectContaining({ code: 'TEXT_SEGMENTS_INVALID', nodeId: '1:2' }),
  );
});

it('keeps a true empty text result complete and a malformed nonempty range partial', async () => {
  const empty = fixture([], '');
  const emptyResult = JSON.parse(
    await runInNewContext(createFigmaReadProgram({}), { figma: empty.figma }),
  );
  expect(emptyResult).toMatchObject({ truncated: false, valueTruncated: false });
  expect(emptyResult.nodes[0].textSegments).toEqual([]);
  const bad = styled('Text');
  bad.end = 3;
  const malformed = fixture([bad]);
  const partial = JSON.parse(
    await runInNewContext(createFigmaReadProgram({}), { figma: malformed.figma }),
  );
  expect(partial.valueTruncated).toBe(true);
  expect(partial.nodes[0].textSegments).toEqual([bad]);
  expect(partial.warnings).toContainEqual({
    code: 'TEXT_SEGMENT_RANGE_INVALID',
    nodeId: '1:2',
    segmentIndex: 0,
  });
});

it.each(['characters', 'start', 'end'])(
  'retains a segment missing structural %s as partial',
  async field => {
    const segment: Record<string, unknown> = styled('Text');
    delete segment[field];
    const { figma } = fixture([segment]);
    const result = JSON.parse(await runInNewContext(createFigmaReadProgram({}), { figma }));
    expect(result.valueTruncated).toBe(true);
    expect(result.nodes[0].textSegments).toEqual([segment]);
    expect(result.warnings).toContainEqual({
      code: 'TEXT_SEGMENT_FIELD_MISSING',
      nodeId: '1:2',
      segmentIndex: 0,
      field,
    });
  },
);
