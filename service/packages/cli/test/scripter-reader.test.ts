import { runInNewContext } from 'node:vm';

import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { parseFigmaTarget } from '../src/figma-url.js';
import { createFigmaReadProgram, readScripterSnapshot } from '../src/scripter-reader.js';

describe('bounded read-only Figma program', () => {
  const fixture = (children: Array<Record<string, unknown>>, tokenCount = 0) => {
    const nodes = new Map<string, Record<string, unknown>>();
    const collect = (node: Record<string, unknown>) => {
      nodes.set(node.id as string, node);
      for (const child of (node.children ?? []) as Array<Record<string, unknown>>) collect(child);
    };
    children.forEach(collect);
    const figma = {
      root: { name: 'Fixture' },
      currentPage: { id: '0:1', name: 'Page', selection: [], children },
      getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
      variables: {
        getLocalVariablesAsync: async () =>
          Array.from({ length: tokenCount }, (_, i) => ({
            id: `v${i}`,
            name: `Token${i}`,
            resolvedType: 'FLOAT',
            valuesByMode: { default: i },
          })),
      },
    };
    const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
    const page = {
      url: () => target.url,
      frames: () => [
        {
          url: () => 'https://scripter.rsms.me/',
          evaluate: (_: unknown, args: { program: string }) =>
            runInNewContext(args.program, { figma }),
        },
      ],
    } as unknown as Page;
    return { figma, page, target };
  };

  it('captures editable text and typography without truncating duplicate glyph outlines', async () => {
    const { page, target } = fixture([
      {
        id: '1:1',
        name: 'Body',
        type: 'TEXT',
        characters: 'A complete description',
        fontName: { family: 'Poppins', style: 'Regular' },
        fontSize: 16,
        fillGeometry: [{ windingRule: 'NONZERO', data: 'M 0 0 '.repeat(50_000) }],
        strokeGeometry: [],
      },
      {
        id: '1:2',
        name: 'Icon',
        type: 'VECTOR',
        fillGeometry: [{ windingRule: 'NONZERO', data: 'M 0 0 L 1 1' }],
        strokeGeometry: [{ windingRule: 'NONZERO', data: 'M 1 0 L 0 1' }],
      },
    ]);
    const result = await readScripterSnapshot(page, target, { depth: 5 });
    expect(result.truncated).toBe(false);
    expect(result.nodes[0]).toMatchObject({
      characters: 'A complete description',
      fontName: { family: 'Poppins', style: 'Regular' },
      geometrySource: 'characters-and-fonts',
    });
    expect(result.nodes[0]).not.toHaveProperty('fillGeometry');
    expect(result.nodes[0]).not.toHaveProperty('strokeGeometry');
    expect(result.nodes[1]).toMatchObject({
      fillGeometry: [{ windingRule: 'NONZERO', data: 'M 0 0 L 1 1' }],
      strokeGeometry: [{ windingRule: 'NONZERO', data: 'M 1 0 L 0 1' }],
    });
    expect(result.coverage).toMatchObject({ textGeometry: 'characters-and-fonts' });
    // Catalog metadata and the final full reread remain small relative to omitted glyph outlines.
    expect(result.capture.bytes).toBeLessThan(40_000);
  });

  it('retains completed roots when a later read exhausts the overall deadline', async () => {
    const { page, target, figma } = fixture([
      { id: '1:1', name: 'First', type: 'FRAME' },
      { id: '1:2', name: 'Later', type: 'FRAME' },
    ]);
    const frame = page.frames()[0]!;
    frame.evaluate = (async (_: unknown, args: { program: string } | string) => {
      if (typeof args === 'string') return '';
      if (args.program.includes('"nodeId":"1:2"')) return new Promise<string>(() => {});
      return runInNewContext(args.program, { figma });
    }) as typeof frame.evaluate;
    page.frames = () => [frame];
    const result = await readScripterSnapshot(
      page,
      target,
      { depth: 5 },
      { deadlineAt: Date.now() + 100 },
    );
    expect(result.nodes.map(node => node.id)).toEqual(['1:1']);
    expect(result.truncated).toBe(true);
    expect(result.pendingRootIds).toContain('1:2');
  });

  it('enumerates all roots independently of the subtree node budget and pages through variables', async () => {
    const { page, target } = fixture(
      Array.from({ length: 3 }, (_, i) => ({
        id: `1:${i}`,
        name: `Root${i}`,
        type: 'FRAME',
        children: [],
      })),
      257,
    );
    const result = await readScripterSnapshot(page, target, { maxNodes: 1, depth: 5 });
    expect(result).toMatchObject({ nodeCount: 3, truncated: false, pendingRootIds: [] });
    expect(result.tokens).toHaveLength(257);
    expect(new Set(result.tokens.map(token => (token as { id: string }).id)).size).toBe(257);
  });

  it('resumes nested child gaps without losing their parent relationships or order', async () => {
    const { page, target } = fixture([
      {
        id: '1:1',
        name: 'Root',
        type: 'FRAME',
        children: [
          {
            id: '1:2',
            name: 'Inner',
            type: 'FRAME',
            children: [
              { id: 'I1:3;2:4', name: 'Instance child', type: 'TEXT', characters: 'Actual' },
            ],
          },
          { id: '1:4', name: 'Sibling', type: 'RECTANGLE' },
        ],
      },
    ]);
    const result = await readScripterSnapshot(page, target, { maxNodes: 1, depth: 5 });
    expect(result).toMatchObject({
      nodeCount: 4,
      truncated: false,
      pendingScopes: [],
      nodes: [
        {
          id: '1:1',
          children: [
            { id: '1:2', children: [{ id: 'I1:3;2:4', characters: 'Actual' }] },
            { id: '1:4' },
          ],
        },
      ],
    });
  });

  it('preserves mask and grid fields and explicitly reports property and token limits', async () => {
    const { figma } = fixture(
      [
        {
          id: '1:1',
          type: 'FRAME',
          name: 'Masked Grid',
          isMask: true,
          maskType: 'ALPHA',
          gridRowCount: 2,
          gridColumnCount: 3,
          componentProperties: Object.fromEntries(
            Array.from({ length: 129 }, (_, i) => [`p${i}`, { value: i }]),
          ),
        },
      ],
      257,
    );
    const result = JSON.parse(await runInNewContext(createFigmaReadProgram({}), { figma }));
    expect(result.nodes[0]).toMatchObject({
      isMask: true,
      maskType: 'ALPHA',
      gridRowCount: 2,
      gridColumnCount: 3,
    });
    expect(result).toMatchObject({ truncated: true, valueTruncated: true, nextTokenOffset: 256 });
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROPERTY_LIMIT', omitted: 1 })]),
    );
  });

  it('keeps an explicit depth limit incomplete instead of reading past it', async () => {
    const { page, target } = fixture([
      {
        id: '1:1',
        name: 'Root',
        type: 'FRAME',
        children: [{ id: '1:2', name: 'Child', type: 'TEXT' }],
      },
    ]);
    const result = await readScripterSnapshot(page, target, { depth: 0 });
    expect(result).toMatchObject({ nodeCount: 1, truncated: true, pendingRootIds: ['1:1'] });
    expect(result.pendingScopes[0]?.reason).toBe('DEPTH_LIMIT');
  });

  it('reads exact layout, mixed text segments, reactions and token values without mutation', async () => {
    const text = Object.freeze({
      id: '1:2',
      name: 'Title',
      type: 'TEXT',
      characters: 'Hello',
      fontName: Symbol('mixed'),
      fontSize: 32,
      getStyledTextSegments: () => [
        { characters: 'Hello', fontName: { family: 'Poppins', style: 'Bold' } },
      ],
    });
    const frame = Object.freeze({
      id: '1:1',
      name: 'Home',
      type: 'FRAME',
      width: 1440,
      height: 4835,
      layoutMode: 'VERTICAL',
      itemSpacing: 24,
      children: [text],
      reactions: [
        { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '2:1' }] },
      ],
    });
    const mutation = vi.fn<() => never>(() => {
      throw new Error('mutation forbidden');
    });
    const figma = Object.freeze({
      root: { name: 'Fixture' },
      currentPage: { id: '0:1', name: 'Design', children: [frame], selection: [] },
      variables: {
        getLocalVariablesAsync: async () => [
          {
            id: 'v1',
            name: 'Brand',
            resolvedType: 'COLOR',
            valuesByMode: { default: { r: 1, g: 0, b: 0 } },
          },
        ],
      },
      createFrame: mutation,
      commitUndo: mutation,
    });
    const result = JSON.parse(
      await runInNewContext(createFigmaReadProgram({ depth: 5 }), { figma }),
    );
    expect(result).toMatchObject({
      nodeCount: 2,
      truncated: false,
      nodes: [
        {
          id: '1:1',
          width: 1440,
          height: 4835,
          itemSpacing: 24,
          children: [
            {
              characters: 'Hello',
              fontName: 'mixed',
              textSegments: [{ fontName: { family: 'Poppins', style: 'Bold' } }],
            },
          ],
        },
      ],
      tokens: [{ id: 'v1', name: 'Brand' }],
    });
    expect(result.nodes[0].reactions[0].actions[0].destinationId).toBe('2:1');
    expect(mutation).not.toHaveBeenCalled();
  });
  it('reports depth and node budgets instead of claiming complete output', async () => {
    const child = { id: '1:2', name: 'Child', type: 'TEXT', characters: 'x' };
    const root = { id: '1:1', name: 'Root', type: 'FRAME', children: [child] };
    const figma = {
      root: { name: 'Fixture' },
      currentPage: { id: '0:1', name: 'Page', selection: [], children: [root] },
    };
    const result = JSON.parse(
      await runInNewContext(createFigmaReadProgram({ depth: 0, maxNodes: 1 }), { figma }),
    );
    expect(result.truncated).toBe(true);
    expect(result.nodeCount).toBe(1);
    expect(result.nodes[0].omittedChildren).toBe(1);
  });
  it.each([
    { nodeId: "1:2');figma.createFrame()//" },
    { code: 'figma.createFrame()' },
    { maxNodes: 2001 },
    { depth: 99 },
  ])('rejects unsupported input %j', input => {
    expect(() => createFigmaReadProgram(input)).toThrow(/Invalid|Unrecognized|Too big/);
  });
  it('normalizes only Figma URLs and removes tracking parameters', () => {
    const target = parseFigmaTarget(
      'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/name?node-id=117-336&t=tracking',
    );
    expect(target.nodeId).toBe('117:336');
    expect(target.url).not.toContain('tracking');
    expect(() => parseFigmaTarget('https://evil.example/design/4IBhv1d8hEclifZQrOYxHS')).toThrow(
      /FIGMA_URL_INVALID/,
    );
  });
});
