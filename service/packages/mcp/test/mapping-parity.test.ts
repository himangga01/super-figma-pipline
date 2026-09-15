import { GetVariableDefsResultSchema } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { joinTokens, parseTokenMapFile } from '../src/join/token-map.js';
import { resolveFigmaTokens } from '../src/tokens/figma-tokens.js';
const defs = GetVariableDefsResultSchema.parse({
  collections: [
    {
      id: 'a',
      name: 'Semantic',
      key: '',
      defaultModeId: 'a1',
      variableIds: ['v'],
      modes: [{ modeId: 'a1', name: 'Light' }],
    },
    {
      id: 'b',
      name: 'Primitive',
      key: '',
      defaultModeId: 'b1',
      variableIds: ['p'],
      modes: [{ modeId: 'b1', name: 'Light' }],
    },
  ],
  variables: [
    {
      id: 'v',
      name: 'Brand',
      key: '',
      resolvedType: 'COLOR',
      collectionId: 'a',
      valuesByMode: { a1: { type: 'VARIABLE_ALIAS', id: 'p' } },
    },
    {
      id: 'p',
      name: 'Brand',
      key: '',
      resolvedType: 'COLOR',
      collectionId: 'b',
      valuesByMode: { b1: { r: 1, g: 0, b: 0, a: 1 } },
    },
  ],
});
describe('canonical mapping authority', () => {
  it('retains source IDs and refuses cross-collection catalog mode guesses', () => {
    const tokens = resolveFigmaTokens(defs);
    expect(tokens[0]).toMatchObject({
      sourceId: 'v',
      collectionId: 'a',
      value: null,
      resolution: 'unresolved',
    });
    expect(tokens[1]).toMatchObject({ sourceId: 'p', value: '#FF0000' });
  });
  it('does not promote a legacy name/ref row to verified value evidence', () => {
    const result = joinTokens(
      [{ sourceId: 'v', name: 'Brand', type: 'COLOR', value: '#FF0000' }],
      [{ name: 'brand', value: '#0000FF', cssVar: 'var(--brand)' }],
      { threshold: 0.7, overrides: parseTokenMapFile('| Brand | var(--brand) |') },
    );
    expect(result[0]?.status).not.toBe('high');
    expect(result[0]?.overrideStatus).toBe('legacy-unverified');
  });
});
