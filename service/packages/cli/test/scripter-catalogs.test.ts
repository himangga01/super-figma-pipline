import { runInNewContext } from 'node:vm';

import type { Page } from 'playwright';
import { expect, it } from 'vitest';

import { parseFigmaTarget } from '../src/figma-url.js';
import { createFigmaReadProgram } from '../src/read-program.js';
import { readScripterSnapshot } from '../src/snapshot-reader.js';

const fixture = (count = 0) => {
  const node = { id: '1:1', name: 'Root', type: 'TEXT', characters: 'before' };
  const figma = {
    root: { name: 'Fixture' },
    currentPage: { id: '0:1', name: 'Page', selection: [], children: [node] },
    getNodeByIdAsync: async () => node,
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () =>
      Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        name: `Paint ${i}`,
        paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      })),
    getLocalTextStylesAsync: async () => [{ id: 'text', name: 'Body', fontSize: 16 }],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
  const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
  const frame = {
    url: () => 'https://scripter.rsms.me/',
    evaluate: (_: unknown, args: { program: string }) => runInNewContext(args.program, { figma }),
  };
  const page = { url: () => target.url, frames: () => [frame] } as unknown as Page;
  return { figma, node, frame, page, target };
};
it('records whether a symbolic font value is the actual mixed sentinel without logging symbol descriptions', async () => {
  const { figma } = fixture();
  const mixed = Symbol('mixed');
  Object.assign(figma, {
    mixed,
    getLocalTextStylesAsync: async () => [
      { id: 'known', name: 'Known', fontSize: 16, fontName: mixed },
      { id: 'unknown', name: 'Unknown', fontSize: 16, fontName: Symbol('private-description') },
      { id: 'plain', name: 'Plain', fontSize: 16, fontName: { family: 'Inter', style: 'Regular' } },
    ],
  });
  const raw = JSON.parse(
    await runInNewContext(createFigmaReadProgram({ mode: 'tokens' }), { figma }),
  );
  expect(raw.styles.texts[0].fontNameObservation).toEqual({ kind: 'symbol', isMixed: true });
  expect(raw.styles.texts[1].fontNameObservation).toEqual({ kind: 'symbol', isMixed: false });
  expect(raw.styles.texts[2].fontName).toEqual({ family: 'Inter', style: 'Regular' });
  expect(raw.styles.texts[2]).not.toHaveProperty('fontNameObservation');
  expect(JSON.stringify(raw)).not.toContain('private-description');
});
it.each([true, false])(
  'checks the exact style identity before recovering a symbolic font (valid=%s)',
  async valid => {
    const { figma } = fixture();
    const mixed = Symbol('mixed');
    Object.assign(figma, {
      mixed,
      getLocalTextStylesAsync: async () => [
        { id: 'known', name: 'Known', fontSize: 16, fontName: mixed },
      ],
      getStyleByIdAsync: async () => ({
        id: valid ? 'known' : 'unrelated',
        type: 'TEXT',
        fontName: { family: 'Inter', style: 'Regular' },
      }),
    });
    const raw = JSON.parse(
      await runInNewContext(createFigmaReadProgram({ mode: 'tokens' }), { figma }),
    );
    expect(raw.styles.texts[0]?.fontName).toEqual(
      valid ? { family: 'Inter', style: 'Regular' } : undefined,
    );
    expect(raw.styles.texts[0]?.fontNameObservation).toEqual(
      valid
        ? {
            kind: 'symbol',
            isMixed: true,
            recovery: 'getStyleByIdAsync.fontName',
          }
        : undefined,
    );
    expect(raw.catalogs.textStyles.state).toBe(valid ? 'complete' : 'failed');
    expect(raw.styles.texts).toHaveLength(valid ? 1 : 0);
  },
);
it('delivers all independent style pages through the actual parser with zero variables', async () => {
  const { page, target } = fixture(513);
  const result = await readScripterSnapshot(page, target, {});
  expect(result.styles.paints).toHaveLength(513);
  expect(result.styles.texts).toHaveLength(1);
  expect(result.catalogs.variables.state).toBe('empty');
  expect(result.catalogs.paintStyles.state).toBe('complete');
  expect(result.observation.reobserved).toBe(true);
});
it('distinguishes missing, failed and successfully empty APIs', async () => {
  const { figma } = fixture();
  Object.defineProperty(figma, 'getLocalPaintStylesAsync', { value: undefined });
  Object.defineProperty(figma, 'getLocalTextStylesAsync', {
    get() {
      throw new Error('private detail');
    },
  });
  const raw = JSON.parse(
    await runInNewContext(createFigmaReadProgram({ mode: 'tokens' }), { figma }),
  );
  expect(raw.catalogs.paintStyles.state).toBe('unsupported');
  expect(raw.catalogs.textStyles.state).toBe('failed');
  expect(raw.catalogs.effectStyles.state).toBe('empty');
  expect(JSON.stringify(raw)).not.toContain('private detail');
});
it('rejects same-ID property mutation during bounded reobservation', async () => {
  const { page, target, frame, figma, node } = fixture();
  let trees = 0;
  frame.evaluate = async (_, args) => {
    if (args.program.includes('"mode":"tree"') && ++trees === 2) node.characters = 'after';
    return runInNewContext(args.program, { figma });
  };
  await expect(readScripterSnapshot(page, target, {})).rejects.toThrow('BROWSER_CONTENT_CHANGED');
});
it('rejects duplicate catalog IDs', async () => {
  const { figma, page, target } = fixture();
  figma.getLocalTextStylesAsync = async () => [
    { id: 'same', name: 'A', fontSize: 1 },
    { id: 'same', name: 'B', fontSize: 2 },
  ];
  const result = await readScripterSnapshot(page, target, {});
  expect(result.catalogs.textStyles.state).toBe('failed');
});
it('retains aliases, actual modes and unresolved nonlocal variable references', async () => {
  const { node, figma, page, target } = fixture();
  Object.assign(node, {
    resolvedVariableModes: { c: 'dark' },
    boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'remote' }] },
  });
  Object.defineProperty(figma.variables, 'getLocalVariablesAsync', {
    value: async () => [
      {
        id: 'local',
        name: 'Alias',
        valuesByMode: { dark: { type: 'VARIABLE_ALIAS', id: 'remote' } },
      },
    ],
  });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.nodes[0]?.resolvedVariableModes).toEqual({ c: 'dark' });
  expect(result.observation.referencedVariables).toEqual({
    status: 'unsupported',
    unresolvedVariableIds: ['remote'],
  });
  expect(result.tokens[0]).toMatchObject({
    valuesByMode: { dark: { type: 'VARIABLE_ALIAS', id: 'remote' } },
  });
});
it('detects same-ID catalog value changes in the final pass', async () => {
  const { figma, page, target } = fixture();
  let count = 0;
  figma.getLocalTextStylesAsync = async () => [
    { id: 'text', name: 'Body', fontSize: ++count === 1 ? 16 : 18 },
  ];
  await expect(readScripterSnapshot(page, target, {})).rejects.toThrow('BROWSER_CONTENT_CHANGED');
});
it('keeps bounded reads incomplete when there is no budget for a full second pass', async () => {
  const { figma, page, target } = fixture();
  figma.currentPage.children = Array.from({ length: 130 }, (_, i) => ({
    id: `1:${i}`,
    name: 'Node',
    type: 'TEXT',
    characters: 'same',
  }));
  figma.getNodeByIdAsync = async (id?: string) =>
    figma.currentPage.children.find(node => node.id === id)!;
  const result = await readScripterSnapshot(page, target, {});
  expect(result.capture.calls).toBe(256);
  expect(result.observation.reobserved).toBe(false);
  expect(result.pendingScopes).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: 'REOBSERVATION_BUDGET' })]),
  );
});

const readByteBudgetFixture = async (roots: number) => {
  const { figma, page, target } = fixture();
  figma.currentPage.children = Array.from({ length: roots }, (_, root) => ({
    id: `1:${root}`,
    name: 'Frame',
    type: 'FRAME',
    characters: '',
    children: Array.from({ length: 10 }, (_child, child) => ({
      id: `2:${root * 10 + child}`,
      name: 'Text',
      type: 'TEXT',
      characters: 'x'.repeat(20_000),
    })),
  }));
  figma.getNodeByIdAsync = async (id?: string) =>
    figma.currentPage.children.find(node => node.id === id)!;
  return readScripterSnapshot(page, target, {});
};
it('reserves bounded reobservation capacity for a complete first pass', async () => {
  const result = await readByteBudgetFixture(40);
  expect(result.capture.bytes).toBeLessThanOrEqual(24_000_000);
  expect(result.nodeCount).toBe(440);
  expect(result.capture.bytes).toBeGreaterThan(12_000_000);
  expect(result.observation.reobserved).toBe(true);
  expect(result.observation.readComplete).toBe(true);
  expect(result.truncated).toBe(false);
});
it('keeps an oversized first pass incomplete under its original byte limit', async () => {
  const result = await readByteBudgetFixture(70);
  expect(result.capture.bytes).toBeLessThanOrEqual(24_000_000);
  expect(result.observation.readComplete).toBe(false);
  expect(result.pendingScopes).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: 'SNAPSHOT_READ_BUDGET' })]),
  );
});
it('keeps content hashes independent of capture timestamps', async () => {
  const { page, target } = fixture(1);
  const first = await readScripterSnapshot(page, target, {});
  const second = await readScripterSnapshot(page, target, {});
  expect(first.observation.contentHash).toBe(second.observation.contentHash);
  expect(second.capture.atomic).toBe(false);
});
it('cancels before touching the existing page', async () => {
  const { page, target } = fixture();
  let touches = 0;
  page.frames = () => {
    touches++;
    throw new Error('unexpected attach');
  };
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    readScripterSnapshot(page, target, {}, { signal: controller.signal }),
  ).rejects.toThrow('cancelled');
  expect(touches).toBe(0);
});
it('rejects reordered child identities even when child count remains unchanged', async () => {
  const { node, figma, page, target, frame } = fixture();
  const children = [
    { id: '1:2', name: 'A', type: 'TEXT', characters: 'a' },
    { id: '1:3', name: 'B', type: 'TEXT', characters: 'b' },
  ];
  Object.assign(node, { type: 'FRAME', children });
  figma.getNodeByIdAsync = async (id?: string) =>
    id === '1:1' ? node : children.find(child => child.id === id)!;
  frame.evaluate = async (_, args) => {
    if (args.program.includes('"childrenOnly":true')) children.reverse();
    return runInNewContext(args.program, { figma });
  };
  await expect(readScripterSnapshot(page, target, { maxNodes: 1 })).rejects.toThrow(
    'BROWSER_SCOPE_CHANGED',
  );
});
it('does not promote a lossy earlier catalog page to complete', async () => {
  const { figma, page, target } = fixture(257);
  const original = figma.getLocalPaintStylesAsync;
  figma.getLocalPaintStylesAsync = async () => {
    const rows = await original();
    rows[0]!.name = 'x'.repeat(21000);
    return rows;
  };
  const result = await readScripterSnapshot(page, target, {});
  expect(result.styles.paints).toHaveLength(257);
  expect(result.catalogs.paintStyles.state).toBe('partial');
  expect(result.truncated).toBe(true);
});
it('pages variables and collections independently of the larger style family', async () => {
  const { figma, page, target } = fixture(513);
  Object.defineProperty(figma.variables, 'getLocalVariablesAsync', {
    value: async () =>
      Array.from({ length: 257 }, (_, i) => ({
        id: `v${i}`,
        name: `Variable ${i}`,
        valuesByMode: { mode: i },
      })),
  });
  Object.defineProperty(figma.variables, 'getLocalVariableCollectionsAsync', {
    value: async () =>
      Array.from({ length: 258 }, (_, i) => ({
        id: `c${i}`,
        name: `Collection ${i}`,
        modes: [{ modeId: `m${i}`, name: 'Same name' }],
        defaultModeId: `m${i}`,
      })),
  });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.tokens).toHaveLength(257);
  expect(result.collections).toHaveLength(258);
  expect(result.styles.paints).toHaveLength(513);
  expect(result.catalogs.collections.state).toBe('complete');
});
it('retains mixed text style and variable bindings requested from the API', async () => {
  const { node, page, target } = fixture();
  Object.assign(node, {
    getStyledTextSegments: (fields: string[]) => {
      expect(fields).toEqual(
        expect.arrayContaining(['boundVariables', 'textStyleId', 'fillStyleId']),
      );
      return [
        {
          characters: 'Text',
          textStyleId: 'text',
          fillStyleId: 'paint',
          boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'remote' } },
        },
      ];
    },
  });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.nodes[0]?.textSegments).toEqual([
    expect.objectContaining({
      textStyleId: 'text',
      fillStyleId: 'paint',
      boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'remote' } },
    }),
  ]);
  expect(result.observation.referencedVariables.unresolvedVariableIds).toEqual(['remote']);
});
it('rejects duplicate root identities', async () => {
  const { figma, node, page, target } = fixture();
  figma.currentPage.children = [node, node];
  await expect(readScripterSnapshot(page, target, {})).rejects.toThrow('BROWSER_DUPLICATE_NODE');
});

it('reads referenced remote variables, collections and mixed-text style dependencies without imports', async () => {
  const { node, figma, page, target } = fixture();
  Object.assign(node, {
    textStyleId: 'mixed',
    textSegments: [
      {
        textStyleId: 'remoteStyle',
        fills: [],
        boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'remote' } },
      },
    ],
  });
  Object.assign(figma, {
    getStyleByIdAsync: async (id: string) => ({
      id,
      name: 'Remote style',
      type: 'TEXT',
      fontSize: 16,
      boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'remote' } },
    }),
  });
  Object.assign(figma.variables, {
    getVariableByIdAsync: async (id: string) => ({
      id,
      name: 'Remote variable',
      resolvedType: 'FLOAT',
      variableCollectionId: 'remoteCollection',
      valuesByMode: { remoteMode: 16 },
    }),
    getVariableCollectionByIdAsync: async (id: string) => ({
      id,
      name: 'Remote collection',
      modes: [{ modeId: 'remoteMode', name: 'Mode' }],
      defaultModeId: 'remoteMode',
    }),
    importVariableByKeyAsync: () => {
      throw new Error('MUTATION_FORBIDDEN');
    },
  });
  // The actual styled-text API is the producer boundary, not a pre-filled output field.
  Object.assign(node, {
    getStyledTextSegments: () => [
      {
        // A complete remote dependency read still requires complete source typography.
        characters: 'before',
        start: 0,
        end: 6,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 16,
        fontWeight: 400,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        listOptions: { type: 'NONE' },
        indentation: 0,
        textWrapStyle: 'AUTO',
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
        hyperlink: null,
        fillStyleId: '',
        textStyleId: 'remoteStyle',
        fills: [],
        boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'remote' } },
      },
    ],
  });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.tokens).toEqual([expect.objectContaining({ id: 'remote' })]);
  expect(result.collections).toEqual([expect.objectContaining({ id: 'remoteCollection' })]);
  expect(result.styles.texts).toContainEqual(expect.objectContaining({ id: 'remoteStyle' }));
  expect(result.observation.referencedClosure).toMatchObject({ status: 'complete', issues: [] });
  expect(result.observation.readComplete).toBe(true);
});
it('does not confuse complete local style enumeration with unresolved remote style closure', async () => {
  const { node, page, target } = fixture();
  Object.assign(node, { fillStyleId: 'remoteStyle' });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.catalogs.paintStyles.state).toBe('empty');
  expect(result.observation.readComplete).toBe(false);
  expect(result.observation.referencedClosure.issues).toContainEqual({
    family: 'styles',
    id: 'remoteStyle',
    status: 'unsupported',
  });
});
it('includes referenced dependency reads in the final content reobservation', async () => {
  const { node, figma, page, target } = fixture();
  Object.assign(node, { fillStyleId: 'remoteStyle' });
  let reads = 0;
  Object.assign(figma, {
    getStyleByIdAsync: async (id: string) => ({
      id,
      name: 'Remote',
      type: 'PAINT',
      paints: [{ type: 'SOLID', opacity: ++reads === 1 ? 1 : 0.5 }],
    }),
  });
  await expect(readScripterSnapshot(page, target, {})).rejects.toThrow('BROWSER_CONTENT_CHANGED');
});

it('keeps unresolved mixed style IDs incomplete when segment proof is absent', async () => {
  const { node, page, target } = fixture();
  Object.assign(node, { fillStyleId: 'mixed' });
  const result = await readScripterSnapshot(page, target, {});
  expect(result.observation.readComplete).toBe(false);
  expect(result.observation.referencedClosure.issues).toContainEqual({
    family: 'styles',
    id: 'mixed:1:1:fillStyleId',
    status: 'unsupported',
  });
});
