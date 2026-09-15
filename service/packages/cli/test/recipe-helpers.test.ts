import { canonicalFileIdentityHash } from '@sfp/shared';
import { expect, it } from 'vitest';

import { normalizeDesignObservation } from '../../mcp/src/portal/design-normalization.js';
import {
  createRecipeDesignView,
  resolveRecipeTarget,
  findRecipeDescendants,
  dumpRecipeTree,
  resolveRecipeVariable,
  recipeHexColor,
  recipeSolidPaint,
  recipePadding,
  recipeVariants,
} from '../src/recipe-helpers.js';

const fileKey = 'abcdefghijk',
  fileHash = canonicalFileIdentityHash({ kind: 'figma-file-key', value: fileKey });
const frame = (id: string, name: string, children: unknown[] = []) => ({
  id,
  type: 'FRAME',
  name,
  width: 100,
  height: 80,
  reactions: [],
  children,
});
function observation(extra: Record<string, unknown> = {}) {
  const raw = {
    source: 'figma-plugin-api-via-scripter',
    requestedNodeId: '0:1',
    nodes: [
      {
        ...frame('0:1', 'Button', [
          frame('1:1', 'Button', [frame('1:2', 'button')]),
          frame('1:3', 'Button'),
        ]),
        type: 'PAGE',
      },
    ],
    selection: { nodes: [{ id: '1:3' }, { id: '1:1' }] },
    tokens: [],
    collections: [],
    styles: { paints: [], texts: [], effects: [], grids: [] },
    ...extra,
  };
  const first = normalizeDesignObservation(raw);
  return normalizeDesignObservation(raw, {
    evidenceVersion: 1,
    contentHash: first.contentHash,
    capabilities: first.capabilities.map(capability => ({
      name: capability.name,
      status: capability.retainedCount ? 'complete' : 'empty',
      count: capability.retainedCount,
    })),
    coherence: {
      status: 'observed',
      atomic: false,
      method: 'content-reobservation',
      before: first.contentHash,
      after: first.contentHash,
      contentHash: first.contentHash,
      outcome: 'matched',
    },
    sourceBinding: {
      status: 'observed',
      fileIdentityHash: fileHash,
      scopeId: '0:1',
      sessionId: 'session',
      generation: 'generation',
      method: 'file-key',
    },
  });
}
it('resolves only explicit bound node/page/URL/selection targets', () => {
  const view = createRecipeDesignView(observation());
  expect(
    resolveRecipeTarget(view, {
      kind: 'url',
      url: `https://www.figma.com/design/${fileKey}?node-id=1-1`,
    }).targets[0]!.nodeId,
  ).toBe('1:1');
  expect(resolveRecipeTarget(view, { kind: 'page', nodeId: '0:1' }).targets[0]!.type).toBe('PAGE');
  expect(
    resolveRecipeTarget(view, { kind: 'selection', pick: 'first' }).targets.map(row => row.nodeId),
  ).toEqual(['1:3']);
  expect(
    resolveRecipeTarget(view, { kind: 'selection', pick: 1 }).targets.map(row => row.nodeId),
  ).toEqual(['1:1']);
  expect(resolveRecipeTarget(view, { kind: 'selection', pick: 'all' }).targets).toHaveLength(2);
  expect(() =>
    resolveRecipeTarget(view, {
      kind: 'url',
      url: 'https://www.figma.com/design/otherfilekey?node-id=1-1',
    }),
  ).toThrow('RECIPE_TARGET_FILE_MISMATCH');
  expect(() => resolveRecipeTarget(view, { kind: 'selection', pick: 5 })).toThrow(
    'RECIPE_SELECTION_INDEX_MISSING',
  );
  expect(() => resolveRecipeTarget(view, { kind: 'node', nodeId: '9:9' })).toThrow(
    'RECIPE_TARGET_NOT_OBSERVED',
  );
  expect(() => resolveRecipeTarget(view, { kind: 'selection' } as never)).toThrow(/pick/u);
});
it('does not promote missing or empty selection into the first observed root', () => {
  expect(() =>
    resolveRecipeTarget(createRecipeDesignView(observation({ selection: { nodes: [] } })), {
      kind: 'selection',
      pick: 'first',
    }),
  ).toThrow('RECIPE_SELECTION_EMPTY');
  expect(() =>
    resolveRecipeTarget(createRecipeDesignView(observation({ selection: null })), {
      kind: 'selection',
      pick: 'all',
    }),
  ).toThrow('RECIPE_SELECTION_NOT_OBSERVED');
});
it('uses exact case-sensitive stable descendant order and excludes the root', () => {
  const view = createRecipeDesignView(observation());
  expect(findRecipeDescendants(view, '0:1', 'Button')).toMatchObject({
    complete: true,
    matches: ['1:1', '1:3'],
  });
  expect(findRecipeDescendants(view, '0:1', 'button')).toMatchObject({
    complete: true,
    matches: ['1:2'],
  });
  expect(findRecipeDescendants(view, '0:1', 'Button', { first: true })).toMatchObject({
    matches: ['1:1'],
  });
  expect(findRecipeDescendants(view, '0:1', 'Button', { maxNodes: 1 })).toMatchObject({
    complete: false,
    visited: 1,
  });
});
it('keeps depth and output truncation explicit and refuses forged views', () => {
  const view = createRecipeDesignView(observation());
  expect(dumpRecipeTree(view, '0:1', { maxDepth: 0 })).toMatchObject({
    visited: 1,
    truncated: true,
  });
  expect(dumpRecipeTree(view, '0:1').truncated).toBe(false);
  expect(() => dumpRecipeTree(JSON.parse(JSON.stringify(view)), '0:1')).toThrow(
    'RECIPE_DESIGN_VIEW_INVALID',
  );
});
it('uses explicit local variable/mode semantics and never imports after a failed lookup', () => {
  const red = { r: 1, g: 0, b: 0, a: 1 };
  const view = createRecipeDesignView(
    observation({
      collections: [
        { id: 'c', name: 'C', defaultModeId: 'm', modes: [{ modeId: 'm', name: 'Same' }] },
        { id: 'd', name: 'D', defaultModeId: 'n', modes: [{ modeId: 'n', name: 'Same' }] },
      ],
      tokens: [
        {
          id: 'v',
          name: 'Base',
          collectionId: 'c',
          resolvedType: 'COLOR',
          valuesByMode: { m: red },
        },
        {
          id: 'a',
          name: 'Alias',
          collectionId: 'd',
          resolvedType: 'COLOR',
          valuesByMode: { n: { type: 'VARIABLE_ALIAS', id: 'v' } },
        },
      ],
    }),
  );
  expect(resolveRecipeVariable(view, { kind: 'local', id: 'v' })).toMatchObject({
    status: 'identity',
  });
  expect(() =>
    resolveRecipeVariable(view, { kind: 'local', id: 'a', modeByCollection: { d: 'n' } }),
  ).toThrow('RECIPE_VARIABLE_MODE_REQUIRED');
  expect(
    resolveRecipeVariable(view, { kind: 'local', id: 'a', modeByCollection: { d: 'n', c: 'm' } }),
  ).toMatchObject({ status: 'resolved', aliasChain: ['a', 'v'], value: red });
  expect(() => resolveRecipeVariable(view, { kind: 'local', id: 'missing' })).toThrow(
    'RECIPE_LOCAL_VARIABLE_NOT_FOUND',
  );
  expect(resolveRecipeVariable(view, { kind: 'library', key: 'published-key' })).toMatchObject({
    status: 'import-required',
    effect: 'library-import',
    operation: { tool: 'import_library_variable', args: { key: 'published-key' } },
  });
});
it('preserves explicit zero values and validates paint/hex/padding inputs', () => {
  expect(recipeHexColor(' #09f ')).toEqual({ r: 0, g: 153 / 255, b: 1 });
  expect(recipeSolidPaint('#fff', 0)).toMatchObject([
    { type: 'SOLID', opacity: 0, color: { r: 1, g: 1, b: 1 } },
  ]);
  expect(recipePadding(0)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(recipePadding([2, 0])).toEqual({ top: 2, right: 0, bottom: 2, left: 0 });
  expect(recipePadding(undefined)).toBeUndefined();
  expect(() => recipeSolidPaint('#fff', 2)).toThrow(/1/u);
  expect(() => recipeHexColor('#abcd')).toThrow('RECIPE_HEX_INVALID');
});
it('projects real component-set groups and all variants rather than merely echoing component API', () => {
  const definition = {
    id: '3:1',
    type: 'COMPONENT',
    name: 'Size=Small',
    variantProperties: { Size: 'Small' },
    componentPropertyDefinitions: {},
    reactions: [],
    children: [],
  };
  const view = createRecipeDesignView(
    observation({
      nodes: [
        {
          ...frame('0:1', 'Page'),
          type: 'PAGE',
          children: [
            {
              ...frame('2:1', 'Instance'),
              type: 'INSTANCE',
              mainComponent: { id: '3:1', name: 'Size=Small', key: '' },
              componentApi: { properties: {} },
              componentProperties: {},
            },
            {
              ...frame('3:0', 'Button'),
              type: 'COMPONENT_SET',
              variantGroupProperties: { Size: { values: ['Small', 'Large'] } },
              componentPropertyDefinitions: {},
              children: [
                definition,
                {
                  ...definition,
                  id: '3:2',
                  name: 'Size=Large',
                  variantProperties: { Size: 'Large' },
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(recipeVariants(view, '2:1')).toMatchObject({
    current: 'Size=Small',
    groups: { Size: { values: ['Small', 'Large'] } },
    all: [
      { nodeId: '3:1', name: 'Size=Small' },
      { nodeId: '3:2', name: 'Size=Large' },
    ],
  });
});
