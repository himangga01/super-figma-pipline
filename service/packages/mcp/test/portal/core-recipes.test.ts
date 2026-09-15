import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storedChecksum, contentHash, canonicalJson } from '@sfp/ir';
import { type DesignObservation, type DesignJson } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import {
  deriveCoreRecipeBundle,
  verifyCoreRecipePages,
  type CoreRecipeBundle,
} from '../../src/portal/recipes/core-derivation.js';
import {
  coreHash,
  prepareCoreRecipeSource,
  prepareCoreRecipeSources,
  type PreparedCoreRecipeSource,
} from '../../src/portal/recipes/core-source.js';
import { analyzeServiceGraph } from '../../src/portal/service-graph.js';
import { selectPortalServices } from '../../src/portal/service-selection.js';

const hash = `sha256:${'a'.repeat(64)}` as const;
const red = { r: 1, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 1, a: 1 };
const collection = {
  id: 'c',
  name: 'Theme',
  key: '',
  defaultModeId: 'light',
  modes: [
    { modeId: 'light', name: 'Same' },
    { modeId: 'dark', name: 'Same' },
  ],
};
const variable = {
  id: 'v',
  name: 'Primary',
  key: '',
  collectionId: 'c',
  resolvedType: 'COLOR',
  valuesByMode: { light: red, dark: blue },
};
const root = { id: '1:2', type: 'FRAME', name: 'Home', reactions: [], children: [] };
const styles = { paints: [], texts: [], effects: [], grids: [] };
function raw(overrides: Record<string, unknown> = {}) {
  return {
    source: 'figma-plugin-api-via-scripter',
    requestedNodeId: '0:1',
    nodes: [root],
    tokens: [],
    collections: [],
    styles,
    ...overrides,
  };
}
function observed(input: unknown): DesignObservation {
  const base = normalizeDesignObservation(input);
  return normalizeDesignObservation(input, {
    evidenceVersion: 1,
    contentHash: base.contentHash,
    capabilities: base.capabilities.map(capability => ({
      name: capability.name,
      status:
        capability.reason === 'SOURCE_PARTIAL'
          ? 'partial'
          : capability.retainedCount
            ? 'complete'
            : 'empty',
      count: capability.retainedCount,
    })),
    coherence: {
      status: 'observed',
      atomic: false,
      method: 'content-reobservation',
      before: base.contentHash,
      after: base.contentHash,
      contentHash: base.contentHash,
      outcome: 'matched',
    },
    sourceBinding: {
      status: 'observed',
      fileIdentityHash: hash,
      scopeId: '0:1',
      sessionId: 'session',
      generation: 'attempt',
      method: 'file-key',
    },
  });
}
const asset = (nodeId = '1:2', bytes = Buffer.from('same export bytes')) => ({
  record: {
    query: { kind: 'png' as const, nodeId },
    status: 'captured' as const,
    path: `assets/${nodeId.replace(':', '-')}.png`,
    sha256: storedChecksum(bytes),
    bytes: bytes.length,
  },
  bytes,
});
const derive = (
  observation: DesignObservation,
  options: Partial<Parameters<typeof deriveCoreRecipeBundle>[0]> = {},
) =>
  deriveCoreRecipeBundle({
    observation,
    strategy: 'blank-frontend',
    assets: [asset()],
    ...options,
  });
const rows = (bundle: CoreRecipeBundle, recipeId: string) =>
  bundle.pages.filter(item => item.page.recipeId === recipeId).flatMap(item => item.page.rows);
const result = (bundle: CoreRecipeBundle, recipeId: string) =>
  bundle.results.find(item => item.recipeId === recipeId)!.output;
const dirs: string[] = [];
afterEach(async () => {
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
});
async function repository(extra: Record<string, string> = {}) {
  const path = await mkdtemp(join(tmpdir(), 'sfp-core-recipes-'));
  dirs.push(path);
  const files = {
    'package.json': JSON.stringify({ name: 'core-fixture', dependencies: { react: '19.2.8' } }),
    'src/Button.tsx': 'export function Button() { return <button>Save</button>; }',
    'src/tokens.css': ':root { --primary: #ff0000; }',
    ...extra,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = join(path, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  return new RepoReader({ rootDir: path });
}

it('internally selects core recipes and never omits captured roots when the caller supplies a subset', () => {
  const observation = observed(raw({ nodes: [root, { ...root, id: '1:3', type: 'RECTANGLE' }] }));
  const bundle = derive(observation, { requiredRootIds: ['1:2'], assets: [asset()] });
  expect(bundle.results).toHaveLength(7);
  expect(bundle.results.every(value => value.required)).toBe(true);
  expect(
    rows(bundle, 'ground-design')
      .filter(row => row.kind === 'obligation')
      .map(row => row.obligation.itemId),
  ).toContain('1:3');
  expect(
    rows(bundle, 'resolve-assets')
      .filter(row => row.kind === 'asset')
      .map(row => row.nodeId),
  ).toEqual(expect.arrayContaining(['1:2', '1:3']));
  expect(result(bundle, 'resolve-assets').status).toBe('blocked');
  const missing = derive(observation, {
    requiredRootIds: ['9:9'],
    assets: [asset(), asset('1:3')],
  });
  expect(
    rows(missing, 'ground-design').some(
      row => row.kind === 'issue' && row.issue.code === 'CORE_REQUIRED_ROOT_MISSING',
    ),
  ).toBe(true);
});

it('distinguishes proved empty catalogs from missing APIs and produces C4 construction obligations', () => {
  const complete = derive(observed(raw()));
  expect(result(complete, 'derive-tokens')).toMatchObject({
    status: 'ready',
    applicability: 'proved-empty',
  });
  expect(
    rows(complete, 'map-design').some(
      row => row.kind === 'obligation' && row.obligation.kind === 'construct-component',
    ),
  ).toBe(true);
  const { tokens: _tokens, collections: _collections, styles: _styles, ...missingRaw } = raw();
  const missing = derive(normalizeDesignObservation(missingRaw));
  expect(result(missing, 'derive-tokens')).toMatchObject({
    status: 'blocked',
    applicability: 'unresolved',
  });
  expect(result(missing, 'ground-design').status).toBe('blocked');
});

it('produces equal Chrome/Desktop token semantics while retaining distinct source observation hashes', () => {
  const nodes = [
    {
      ...root,
      resolvedVariableModes: { c: 'dark' },
      boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'v' }] },
      fills: [{ type: 'SOLID', color: blue }],
    },
  ];
  const chrome = observed(raw({ nodes, tokens: [variable], collections: [collection] }));
  const desktop = observed({
    source: 'desktop-plugin',
    fileUrlIdentityVerified: true,
    scope: { nodeId: '0:1' },
    document: { nodes },
    variables: { variables: [variable], collections: [collection] },
    styles,
  });
  const a = derive(chrome),
    b = derive(desktop);
  const semantic = (bundle: CoreRecipeBundle) =>
    rows(bundle, 'derive-tokens').filter(
      row => row.kind === 'variable' || row.kind === 'token-export' || row.kind === 'binding',
    );
  expect(semantic(a)).toEqual(semantic(b));
  expect(a.observationHash).not.toBe(b.observationHash);
  expect(
    semantic(a)
      .filter(row => row.kind === 'token-export')
      .map(row => row.cssValue),
  ).toEqual(expect.arrayContaining(['#FF0000', '#0000FF']));
});

it('retains timing, easing, aliases, multiple actual mode IDs and unsupported future material', () => {
  const tokens = [
    variable,
    {
      ...variable,
      id: 'alias',
      valuesByMode: {
        light: { type: 'VARIABLE_ALIAS', id: 'v' },
        dark: { type: 'VARIABLE_ALIAS', id: 'v' },
      },
    },
    { ...variable, id: 'timing', resolvedType: 'TIMING', valuesByMode: { light: 0.3, dark: 0.5 } },
    {
      ...variable,
      id: 'ease',
      resolvedType: 'EASING',
      valuesByMode: {
        light: {
          type: 'CUSTOM_CUBIC_BEZIER',
          easingFunctionCubicBezier: { x1: 0.1, y1: -0.2, x2: 0.8, y2: 1.2 },
        },
        dark: { type: 'LINEAR' },
      },
    },
    {
      ...variable,
      id: 'future',
      resolvedType: 'FUTURE_VECTOR',
      valuesByMode: { light: { x: 1, y: 2 }, dark: { x: 2, y: 3 } },
    },
  ];
  const bundle = derive(observed(raw({ tokens, collections: [collection] })));
  const values = rows(bundle, 'derive-tokens').filter(row => row.kind === 'variable');
  expect(values).toHaveLength(10);
  expect(values.find(row => row.variableId === 'future')).toMatchObject({
    status: 'unsupported',
    material: { value: expect.objectContaining({ x: expect.any(Number) }) },
  });
  expect(
    values.find(row => row.variableId === 'ease' && row.modeId === 'light')!.material.value,
  ).toEqual(tokens[3]!.valuesByMode.light);
  expect(result(bundle, 'derive-tokens').status).toBe('blocked');
});

it('does not guess cross-collection aliases by mode name or silently resolve material conflicts', () => {
  const tokens = [
    variable,
    {
      ...variable,
      id: 'alias',
      collectionId: 'other',
      valuesByMode: {
        light: { type: 'VARIABLE_ALIAS', id: 'v' },
        dark: { type: 'VARIABLE_ALIAS', id: 'v' },
      },
    },
  ];
  const bundle = derive(
    observed(raw({ tokens, collections: [collection, { ...collection, id: 'other' }] })),
  );
  expect(
    rows(bundle, 'derive-tokens')
      .filter(row => row.kind === 'token-export')
      .filter(row => row.sourceId === 'alias')
      .every(row => row.cssValue === null),
  ).toBe(true);
  expect(result(bundle, 'derive-tokens').status).toBe('blocked');
  const conflict = derive(
    observed(
      raw({
        tokens: [variable, { ...variable, valuesByMode: { light: blue, dark: blue } }],
        collections: [collection],
      }),
    ),
  );
  expect(result(conflict, 'derive-tokens').status).toBe('blocked');
  expect(
    rows(conflict, 'derive-tokens').some(
      row => row.kind === 'issue' && row.issue.code === 'CORE_OBSERVATION_DUPLICATE_ID',
    ),
  ).toBe(true);
});

it('exports styles-only color tokens and retains gradient/image/effect/grid material instead of empty success', () => {
  const paint = {
    id: 'paint',
    name: 'Brand',
    paints: [{ type: 'SOLID', color: red, opacity: 0.5, visible: true }],
  };
  const gradient = {
    id: 'gradient',
    name: 'Gradient',
    paints: [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [{ position: 0, color: red }],
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    ],
  };
  const bundle = derive(
    observed(
      raw({
        styles: {
          paints: [paint, gradient],
          texts: [],
          effects: [{ id: 'noise', name: 'Texture', effects: [{ type: 'NOISE', noiseSize: 1 }] }],
          grids: [{ id: 'grid', name: 'Grid', layoutGrids: [{ pattern: 'COLUMNS', count: 12 }] }],
        },
      }),
    ),
  );
  expect(rows(bundle, 'derive-tokens').filter(row => row.kind === 'style')).toHaveLength(4);
  expect(
    rows(bundle, 'derive-tokens').find(
      row => row.kind === 'token-export' && row.sourceId === 'paint',
    ),
  ).toMatchObject({ cssValue: '#FF000080', status: 'resolved' });
  expect(
    rows(bundle, 'derive-tokens').find(
      row => row.kind === 'token-export' && row.sourceId === 'gradient',
    ),
  ).toMatchObject({ cssValue: null, status: 'unsupported' });
});

it('audits raw paints and text runs by actual material, preserving opacity and duplicate-style ambiguity', () => {
  const paint = { id: 'p1', name: 'Same', paints: [{ type: 'SOLID', color: red, opacity: 0.5 }] };
  const nodes = [
    {
      ...root,
      fills: [{ type: 'SOLID', color: red, opacity: 0.5 }],
      textSegments: [
        {
          start: 0,
          end: 4,
          fills: [{ type: 'SOLID', color: blue }],
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16,
        },
      ],
    },
  ];
  const bundle = derive(
    observed(raw({ nodes, styles: { ...styles, paints: [paint, { ...paint, id: 'p2' }] } })),
  );
  expect(
    rows(bundle, 'audit-styles').find(
      row => row.kind === 'style-audit' && row.property === '/fills',
    ),
  ).toMatchObject({ status: 'ambiguous', matchingStyleIds: ['p1', 'p2'] });
  expect(
    rows(bundle, 'audit-styles').filter(
      row => row.kind === 'style-audit' && row.property.startsWith('/textSegments/0'),
    ),
  ).toHaveLength(2);
});

it('verifies actual asset bytes and keeps distinct root usages even when PNG hashes match', () => {
  const observation = observed(raw({ nodes: [root, { ...root, id: '1:3' }] }));
  const correct = derive(observation, { assets: [asset(), asset('1:3')] });
  expect(rows(correct, 'resolve-assets').filter(row => row.kind === 'asset')).toHaveLength(2);
  expect(result(correct, 'resolve-assets').status).toBe('ready');
  const tampered = derive(observation, {
    assets: [{ ...asset(), bytes: Buffer.from('tampered') }, asset('1:3')],
  });
  expect(result(tampered, 'resolve-assets').status).toBe('blocked');
  expect(() => derive(observation, { assets: [asset(), asset()] })).toThrow(
    'CORE_DUPLICATE_ASSET_QUERY',
  );
  expect(() => derive(observation, { assets: [asset('1:2', Buffer.alloc(16_777_217))] })).toThrow(
    'CORE_ASSET_BYTE_LIMIT',
  );
});

it('turns source reactions into required assertions and blocks missing destinations and unknown actions', () => {
  const reaction = {
    trigger: { type: 'ON_CLICK' },
    actions: [{ type: 'NODE', navigation: 'NAVIGATE', destinationId: '1:3' }, { type: 'CLOSE' }],
  };
  const observation = observed(
    raw({
      nodes: [
        { ...root, reactions: [reaction] },
        { ...root, id: '1:3' },
      ],
    }),
  );
  const bundle = derive(observation, { assets: [asset(), asset('1:3')] });
  expect(rows(bundle, 'derive-interactions').find(row => row.kind === 'interaction')).toMatchObject(
    {
      expectations: [
        { action: 'NODE/NAVIGATE', status: 'required' },
        { action: 'CLOSE', status: 'required' },
      ],
    },
  );
  const missing = derive(observed(raw({ nodes: [{ ...root, reactions: [reaction] }] })));
  expect(result(missing, 'derive-interactions').status).toBe('blocked');
  const unsupported = derive(
    observed(
      raw({
        nodes: [
          {
            ...root,
            reactions: [
              {
                trigger: { type: 'ON_CLICK' },
                actions: [{ type: 'SET_VARIABLE', variableId: 'v', variableValue: 3 }],
              },
            ],
          },
        ],
      }),
    ),
  );
  expect(result(unsupported, 'derive-interactions').status).toBe('blocked');
});

it('pages more than 4096 actual mode rows without dropping records and rejects tampered pages', () => {
  const tokens = Array.from({ length: 2100 }, (_, index) => ({ ...variable, id: `v${index}` }));
  const bundle = derive(observed(raw({ tokens, collections: [collection] })));
  expect(rows(bundle, 'derive-tokens').filter(row => row.kind === 'variable')).toHaveLength(4200);
  const output = result(bundle, 'derive-tokens'),
    pages = bundle.pages.filter(item => item.page.recipeId === 'derive-tokens');
  expect(pages.length).toBeGreaterThan(1);
  expect(() => verifyCoreRecipePages(output, pages)).not.toThrow();
  const changed = JSON.parse(JSON.stringify(pages)) as typeof pages;
  changed[0]!.page.rows[0]!.id = 'tampered';
  expect(() => verifyCoreRecipePages(output, changed)).toThrow('CORE_PAGE_BINDING_MISMATCH');
  expect(() => verifyCoreRecipePages(output, pages.slice(1))).toThrow('CORE_PAGE_SET_MISMATCH');
});

it('rejects mutated normalized evidence and forged source capsules', () => {
  const observation = observed(raw());
  const changed = JSON.parse(JSON.stringify(observation)) as DesignObservation;
  changed.nodes[0]!.properties.name = 'Changed without raw evidence';
  expect(() => derive(changed)).toThrow('CORE_OBSERVATION_CHANGED');
  expect(() =>
    derive(observation, {
      strategy: 'reference-portal',
      sources: [{ sourceId: hash, sourceHash: hash } as PreparedCoreRecipeSource],
    }),
  ).toThrow('CORE_SOURCE_CAPSULE_INVALID');
});

it('uses canonical mappings from actual bounded source bytes, retaining source-qualified collisions and overrides', async () => {
  const observation = observed(
    raw({
      nodes: [
        {
          ...root,
          type: 'INSTANCE',
          name: 'Button',
          mainComponent: { id: 'main', name: 'Button', key: '' },
          componentApi: { properties: {} },
          componentProperties: {},
        },
      ],
      tokens: [variable],
      collections: [collection],
    }),
  );
  const a = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: await repository({ 'docs/figma-token-map.md': '| Primary | var(--primary) |\n' }),
    observation,
  });
  const bId = `sha256:${'b'.repeat(64)}` as const;
  const b = await prepareCoreRecipeSource({
    sourceId: bId,
    reader: await repository(),
    observation,
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [a, b] });
  const mappings = rows(bundle, 'map-design').filter(row => row.kind === 'mapping');
  expect(new Set(mappings.map(row => row.sourceId))).toEqual(new Set([hash, bId]));
  expect(
    mappings.every(
      row =>
        row.codeSourceHash.startsWith('sha256:') && row.sourceInventoryHash.startsWith('sha256:'),
    ),
  ).toBe(true);
  expect(Object.isFrozen(a)).toBe(true);
  expect(
    new Set(
      rows(bundle, 'plan-design-implementation')
        .filter(row => row.kind === 'strategy')
        .map(row => row.sourceId)
        .filter(value => value !== null),
    ),
  ).toEqual(new Set([hash, bId]));
  const next = observed(raw({ nodes: [{ ...root, name: 'Other source' }] }));
  expect(() => derive(next, { strategy: 'reference-portal', sources: [a] })).toThrow(
    'CORE_SOURCE_CAPSULE_INVALID',
  );
});

it('retains deterministic source-bound page and manifest hashes without claiming runtime use', () => {
  const observation = observed(raw());
  const a = derive(observation),
    b = derive(observation);
  expect(a).toEqual(b);
  expect(
    a.results.every(
      value => value.outputHash === contentHash('sfp-portal-recipe-output-v1', value.output),
    ),
  ).toBe(true);
  expect(Object.isFrozen(a.pages[0]!.page.rows)).toBe(true);
  expect(a).not.toHaveProperty('candidateHash');
  const materialValues = rows(a, 'plan-design-implementation')
    .filter(row => row.kind === 'strategy')
    .map(row => row.material.value);
  expect(materialValues).toContainEqual(
    expect.objectContaining({ layers: ['frontend', 'configuration'] } as unknown as DesignJson),
  );
});

it('recounts page obligations/issues and checks material hashes before result-store adoption', () => {
  const bundle = derive(observed(raw()));
  const output = result(bundle, 'ground-design'),
    pages = bundle.pages.filter(value => value.page.recipeId === 'ground-design');
  expect(() => verifyCoreRecipePages({ ...output, obligationCount: 0 }, pages)).toThrow(
    'CORE_MANIFEST_COUNTS_MISMATCH',
  );
  expect(() => verifyCoreRecipePages({ ...output, capabilityEvidence: [] }, pages)).toThrow(
    'CORE_CAPABILITY_SET_MISMATCH',
  );
  expect(() => verifyCoreRecipePages({ ...output, contractHash: hash }, pages)).toThrow(
    'CORE_CONTRACT_MISMATCH',
  );
  const strategy = result(bundle, 'plan-design-implementation');
  const changed = JSON.parse(
    JSON.stringify(
      bundle.pages.filter(value => value.page.recipeId === 'plan-design-implementation'),
    ),
  ) as typeof pages;
  const fact = changed[0]!.page.rows.find(value => value.kind === 'strategy')!;
  fact.material.hash = hash;
  changed[0]!.hash = coreHash(changed[0]!.page);
  const forged = {
    ...strategy,
    pages: changed.map(({ hash: pageHash, page }) => ({
      index: page.index,
      hash: pageHash,
      rows: page.rows.length,
      bytes: Buffer.byteLength(canonicalJson(page)),
    })),
  };
  expect(() => verifyCoreRecipePages(forged, changed)).toThrow('CORE_MATERIAL_HASH_MISMATCH');
});

it('preserves actual verified and stale mapping override status from the canonical adapter', async () => {
  const observation = observed(
    raw({
      tokens: [{ ...variable, valuesByMode: { light: red, dark: red } }],
      collections: [collection],
    }),
  );
  const reader = await repository();
  const first = await prepareCoreRecipeSource({ sourceId: hash, reader, observation });
  const firstBundle = derive(observation, { strategy: 'reference-portal', sources: [first] });
  const mapping = rows(firstBundle, 'map-design')
    .filter(value => value.kind === 'mapping')
    .find(value => value.mappingKind === 'token')!;
  const proof = {
    version: 2,
    sourceId: 'v',
    type: 'COLOR',
    value: '#FF0000',
    collectionId: 'c',
    defaultModeId: 'light',
    modeValues: { light: '#FF0000', dark: '#FF0000' },
    ref: 'var(--primary)',
    token: 'primary',
    projectValue: '#ff0000',
    codeSourceHash: mapping.codeSourceHash,
  };
  const path = join(reader.rootDir, 'docs/figma-token-map.md');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '```sfp-token-map-v2\n' + JSON.stringify([proof]) + '\n```');
  const current = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: new RepoReader({ rootDir: reader.rootDir }),
    observation,
  });
  const verified = rows(
    derive(observation, { strategy: 'reference-portal', sources: [current] }),
    'map-design',
  ).find(value => value.kind === 'mapping' && value.mappingKind === 'token');
  expect(verified).toMatchObject({ overrideStatus: 'verified' });
  await writeFile(
    path,
    '```sfp-token-map-v2\n' + JSON.stringify([{ ...proof, codeSourceHash: hash }]) + '\n```',
  );
  const changed = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: new RepoReader({ rootDir: reader.rootDir }),
    observation,
  });
  expect(
    rows(
      derive(observation, { strategy: 'reference-portal', sources: [changed] }),
      'map-design',
    ).find(value => value.kind === 'mapping' && value.mappingKind === 'token'),
  ).toMatchObject({ overrideStatus: 'stale' });
});

it('rejects source bytes changed between complete inventory and actual canonical analysis', async () => {
  const source = await repository();
  let reads = 0;
  const reader = new RepoReader({
    rootDir: source.rootDir,
    beforeFileOpen: async path => {
      if (path.endsWith('Button.tsx') && ++reads === 2)
        await writeFile(
          join(source.rootDir, 'src/Button.tsx'),
          'export function Button() { return <div>Changed</div>; }',
        );
    },
  });
  await expect(
    prepareCoreRecipeSource({ sourceId: hash, reader, observation: observed(raw()) }),
  ).rejects.toThrow('CORE_SOURCE_CHANGED');
});

it('pages canonical component membership without dropping repeated instances or accepting missing members', async () => {
  const instances = Array.from({ length: 4200 }, (_, index) => ({
    id: `10:${index + 1}`,
    type: 'INSTANCE',
    name: 'Button',
    mainComponent: { id: 'main', name: 'Button', key: '' },
    componentApi: { properties: {} },
    componentProperties: {},
    reactions: [],
  }));
  const observation = observed(raw({ nodes: [{ ...root, children: instances }] }));
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: await repository(),
    observation,
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(rows(bundle, 'map-design').filter(row => row.kind === 'mapping-member')).toHaveLength(
    4200,
  );
  const manifest = result(bundle, 'map-design'),
    pages = bundle.pages.filter(value => value.page.recipeId === 'map-design');
  expect(() => verifyCoreRecipePages(manifest, pages)).not.toThrow();
  const changed = JSON.parse(JSON.stringify(pages)) as typeof pages;
  const group = changed.flatMap(value => value.page.rows).find(value => value.kind === 'mapping')!;
  group.members!.count--;
  for (const value of changed) value.hash = coreHash(value.page);
  const changedManifest = {
    ...manifest,
    pages: changed.map(({ hash: pageHash, page }) => ({
      index: page.index,
      hash: pageHash,
      rows: page.rows.length,
      bytes: Buffer.byteLength(canonicalJson(page)),
    })),
  };
  expect(() => verifyCoreRecipePages(changedManifest, changed)).toThrow(
    'CORE_MAPPING_MEMBER_SET_MISMATCH',
  );
});

it('requires missing operational layers for a frontend-only reference while keeping C4 frontend-only', async () => {
  const observation = observed(raw({ nodes: [{ ...root, name: 'Checkout' }] }));
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: await repository(),
    observation,
  });
  const referenced = derive(observation, { strategy: 'reference-portal', sources: [source] });
  const obligations = rows(referenced, 'plan-design-implementation').filter(
    row => row.kind === 'obligation',
  );
  expect(
    obligations.some(
      row =>
        row.obligation.kind === 'construct-layer' && row.obligation.itemId.endsWith(':backend'),
    ),
  ).toBe(true);
  const blank = derive(observation);
  expect(
    rows(blank, 'plan-design-implementation')
      .filter(row => row.kind === 'obligation')
      .every(row => !/:(backend|api|database|authentication)$/u.test(row.obligation.itemId)),
  ).toBe(true);
});

it('bounds sparse variable-mode expansion without discarding the retained observed values', () => {
  const modes = [
    ...collection.modes,
    ...Array.from({ length: 126 }, (_, index) => ({ modeId: `m${index}`, name: `M${index}` })),
  ];
  const tokens = Array.from({ length: 2000 }, (_, index) => ({ ...variable, id: `v${index}` }));
  const bundle = derive(observed(raw({ tokens, collections: [{ ...collection, modes }] })));
  expect(rows(bundle, 'derive-tokens').filter(row => row.kind === 'variable')).toHaveLength(4000);
  expect(
    rows(bundle, 'derive-tokens').some(
      row => row.kind === 'issue' && row.issue.code === 'CORE_TOKEN_MATRIX_LIMIT',
    ),
  ).toBe(true);
  expect(result(bundle, 'derive-tokens').status).toBe('blocked');
});

it('does not export a bound paint style as one unconditional default-mode color', () => {
  const paint = {
    id: 'bound',
    name: 'Bound',
    paints: [
      { type: 'SOLID', color: red, opacity: 1, visible: true, boundVariables: { color: 'v' } },
    ],
  };
  const bundle = derive(
    observed(
      raw({
        tokens: [variable],
        collections: [collection],
        styles: { ...styles, paints: [paint] },
      }),
    ),
  );
  expect(
    rows(bundle, 'derive-tokens').find(
      row => row.kind === 'token-export' && row.sourceId === 'bound',
    ),
  ).toMatchObject({ cssValue: null, status: 'unresolved' });
  expect(
    rows(bundle, 'derive-tokens').find(row => row.kind === 'style' && row.styleId === 'bound'),
  ).toMatchObject({ material: { value: paint } });
});

it('keeps image-fill and vector usage separate from root exports and verifies their exact bytes', () => {
  const imageHash = 'a'.repeat(40),
    bytes = Buffer.from('original image bytes');
  const observation = observed(
    raw({
      nodes: [
        {
          ...root,
          fills: [{ type: 'IMAGE', imageHash }],
          children: [{ id: '2:3', type: 'VECTOR', name: 'Icon', reactions: [] }],
        },
      ],
    }),
  );
  const image = {
    record: {
      query: { kind: 'image' as const, imageHash: imageHash.toUpperCase() },
      status: 'captured' as const,
      path: 'assets/original.bin',
      bytes: bytes.length,
      sha256: storedChecksum(bytes),
    },
    bytes,
  };
  const svgBytes = Buffer.from('<svg/>');
  const svg = {
    record: {
      query: { kind: 'svg' as const, nodeId: '2:3' },
      status: 'captured' as const,
      path: 'assets/icon.svg',
      bytes: svgBytes.length,
      sha256: storedChecksum(svgBytes),
    },
    bytes: svgBytes,
  };
  const bundle = derive(observation, { assets: [asset(), image, svg] });
  expect(
    rows(bundle, 'resolve-assets')
      .filter(row => row.kind === 'asset')
      .map(row => row.query.kind)
      .toSorted(),
  ).toEqual(['image', 'png', 'svg']);
  expect(result(bundle, 'resolve-assets').status).toBe('ready');
  expect(() =>
    derive(observation, {
      assets: [
        image,
        { ...image, record: { ...image.record, query: { kind: 'image', imageHash } } },
      ],
    }),
  ).toThrow('CORE_DUPLICATE_ASSET_QUERY');
});

it('retains non-array mixed style material as unresolved instead of a proved empty audit', () => {
  const bundle = derive(observed(raw({ nodes: [{ ...root, fills: 'MIXED' }] })));
  expect(result(bundle, 'audit-styles')).toMatchObject({
    status: 'blocked',
    applicability: 'unresolved',
  });
  expect(rows(bundle, 'audit-styles').find(row => row.kind === 'style-audit')).toMatchObject({
    status: 'unresolved',
    material: { value: 'MIXED' },
  });
});
const sourceRows = (bundle: CoreRecipeBundle) => rows(bundle, 'plan-design-implementation');
const structureRoots = (bundle: CoreRecipeBundle) =>
  sourceRows(bundle)
    .filter(
      row =>
        row.kind === 'strategy' && (row.material.value as { family?: string }).family === 'service',
    )
    .map(
      row =>
        (
          (row as Extract<typeof row, { kind: 'strategy' }>).material.value as unknown as {
            value: { rootPath: string };
          }
        ).value.rootPath,
    );
const componentObservation = () =>
  observed(
    raw({
      nodes: [
        {
          ...root,
          name: 'Checkout',
          children: [
            {
              id: '1:3',
              type: 'INSTANCE',
              name: 'Button',
              reactions: [],
              mainComponent: { id: 'main', name: 'Button', key: '' },
              componentApi: { properties: {} },
              componentProperties: {},
            },
          ],
        },
      ],
    }),
  );
const workspaceFiles = {
  'package.json': JSON.stringify({ name: 'root', workspaces: ['web', 'jobs'] }),
  'web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '19.2.8' } }),
  'web/Button.tsx': 'export function Button(){return <button>Web</button>}',
  'jobs/package.json': JSON.stringify({ name: 'jobs', dependencies: { express: '5.0.0' } }),
  'jobs/main.ts': "import express from 'express';const app=express();app.get('/jobs',()=>{});",
  'jobs/Button.tsx': 'export function Button(){return <button>Jobs</button>}',
};
it('preserves qualified frontend closure, full byte inventory and scoped canonical mapping candidates', async () => {
  const observation = componentObservation(),
    reader = await repository({
      ...workspaceFiles,
      'docs/figma-component-map.md': '| Button | jobs/Button.tsx |\n',
    });
  const graph = await analyzeServiceGraph(reader, hash),
    selection = selectPortalServices([{ graph }], { services: ['web'], sourceReviews: [] });
  expect(selection.complete).toBe(true);
  expect(selection.closure.map(row => row.rootPath)).toEqual(['web']);
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: [{ sourceId: hash, sourceIndex: 0, rootPath: 'web' }] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(structureRoots(bundle)).toEqual(['web']);
  expect(bundle.sources[0]!.inventoryHash).toBe(graph.sourceInventory!.hash);
  expect(
    sourceRows(bundle).some(
      row =>
        row.kind === 'obligation' &&
        row.obligation.kind === 'construct-layer' &&
        row.obligation.itemId.endsWith(':backend'),
    ),
  ).toBe(true);
  const mapping = rows(bundle, 'map-design').find(
    row => row.kind === 'mapping' && row.mappingKind === 'component',
  );
  expect(mapping).toMatchObject({
    overrideStatus: 'stale',
    material: { value: { candidate: { filePath: 'web/Button.tsx' } } },
  });
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: { mode: 'qualified', closureRoots: ['web'], complete: true },
  });
});
it('whole-root default remains explicit and retains all services rather than pretending a narrower selection', async () => {
  const observation = componentObservation(),
    reader = await repository(workspaceFiles);
  const all = await prepareCoreRecipeSource({ sourceId: hash, reader, observation });
  const chosen = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  const whole = derive(observation, { strategy: 'reference-portal', sources: [all] }),
    selected = derive(observation, { strategy: 'reference-portal', sources: [chosen] });
  expect(structureRoots(whole)).toContain('jobs');
  expect(structureRoots(selected)).not.toContain('jobs');
  expect(whole.sources[0]!.inventoryHash).toBe(selected.sources[0]!.inventoryHash);
  expect(whole.inputHash).not.toBe(selected.inputHash);
  expect(sourceRows(whole).find(row => row.kind === 'source-context')).toMatchObject({
    context: { mode: 'whole-root' },
  });
});
it('retains related runtime and configuration dependencies while excluding an unrelated sibling', async () => {
  const observation = componentObservation(),
    reader = await repository({
      ...workspaceFiles,
      'package.json': JSON.stringify({ name: 'root', workspaces: ['web', 'shared', 'jobs'] }),
      'web/Button.tsx':
        "import {label} from '../shared/label';export function Button(){return <button>{label}</button>}",
      'web/tsconfig.json': '{"extends":"../shared/tsconfig.json"}',
      'shared/package.json': '{"name":"shared"}',
      'shared/label.ts': 'export const label="Shared";',
      'shared/tsconfig.json': '{"compilerOptions":{"strict":true}}',
    });
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(structureRoots(bundle)).toEqual(expect.arrayContaining(['web', 'shared']));
  expect(structureRoots(bundle)).not.toContain('jobs');
  const facts = sourceRows(bundle)
    .filter(row => row.kind === 'strategy')
    .map(row => row.material.value);
  expect(JSON.stringify(facts)).toContain('shared/label.ts');
  expect(JSON.stringify(facts)).toContain('shared/tsconfig.json');
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: { complete: true },
  });
});
it('derives selected React extensions and tokens instead of the excluded Angular root profile', async () => {
  const observation = observed(
    raw({
      nodes: [
        {
          ...root,
          type: 'INSTANCE',
          name: 'Button',
          mainComponent: { id: 'main', name: 'Button', key: '' },
          componentApi: { properties: {} },
          componentProperties: {},
        },
      ],
      tokens: [{ ...variable, valuesByMode: { light: blue, dark: blue } }],
      collections: [collection],
    }),
  );
  const reader = await repository({
    ...workspaceFiles,
    'package.json': JSON.stringify({
      name: 'root',
      workspaces: ['web', 'jobs'],
      dependencies: { '@angular/core': '21.0.0', tailwindcss: '3.4.0' },
    }),
    'tailwind.config.ts': "export default {theme:{colors:{primary:'#ff0000'}}};",
    'web/package.json': '{"name":"web","dependencies":{"react":"19.2.8"}}',
    'web/tokens.css': ':root { --primary: #0000ff; }',
    'web/Button.tsx': 'export function Button(){return <button>Selected React</button>}',
  });
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(
    rows(bundle, 'map-design').find(
      row => row.kind === 'mapping' && row.mappingKind === 'component',
    ),
  ).toMatchObject({ material: { value: { candidate: { filePath: 'web/Button.tsx' } } } });
  expect(
    rows(bundle, 'map-design').find(row => row.kind === 'mapping' && row.mappingKind === 'token'),
  ).toMatchObject({
    material: {
      value: { candidate: { ref: 'var(--primary)', matchedBy: expect.arrayContaining(['value']) } },
    },
  });
});
it('rebases a selected token config and retains its full-root relative import dependency', async () => {
  const observation = observed(
    raw({
      tokens: [{ ...variable, valuesByMode: { light: blue, dark: blue } }],
      collections: [collection],
    }),
  );
  const reader = await repository({
    ...workspaceFiles,
    'package.json': '{"workspaces":["web","shared","jobs"]}',
    'web/package.json': '{"name":"web","dependencies":{"react":"19.2.8","tailwindcss":"3.4.0"}}',
    'web/tailwind.config.ts':
      "import {spacing} from '../shared/colors';export default {theme:{colors:{primary:'#0000ff'},spacing}};",
    'shared/package.json': '{"name":"shared"}',
    'shared/colors.ts': "export const spacing={small:'4px'};",
  });
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(structureRoots(bundle)).toContain('shared');
  expect(structureRoots(bundle)).not.toContain('jobs');
  expect(
    rows(bundle, 'map-design').find(row => row.kind === 'mapping' && row.mappingKind === 'token'),
  ).toMatchObject({
    material: {
      value: { candidate: { ref: 'primary', matchedBy: expect.arrayContaining(['value']) } },
    },
  });
});
const semanticReviews = (graph: Awaited<ReturnType<typeof analyzeServiceGraph>>, sourceIndex = 0) =>
  graph
    .connections!.issues.filter(issue => issue.evidence)
    .map(issue => ({
      sourceId: graph.sourceId!,
      sourceIndex,
      path: issue.evidence!.path,
      hash: issue.evidence!.hash,
      offset: issue.evidence!.offset,
      issue: issue.code,
      decision: 'retain-conservative-closure' as const,
      layers: ['backend' as const],
      conclusion:
        'Reviewed the exact Node HTTP source and retained every potentially related service.',
    }));
it('honors exact admitted Node HTTP semantic reviews while retaining raw diagnostics and review bindings', async () => {
  const observation = observed(raw()),
    reader = await repository({
      'server.ts': "import {createServer} from 'node:http';createServer((req,res)=>res.end('ok'));",
    });
  const graph = await analyzeServiceGraph(reader, hash),
    reviews = semanticReviews(graph);
  expect(graph.incomplete).toBe(true);
  expect(reviews.map(review => review.issue)).toContain('UNSUPPORTED_NODE_HTTP');
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { sourceReviews: reviews },
  });
  const bundle = derive(observation, { strategy: 'legacy-portal', sources: [source] });
  expect(result(bundle, 'plan-design-implementation').status).toBe('ready');
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: { complete: true, effectiveLayers: expect.arrayContaining(['backend']) },
  });
  expect(
    sourceRows(bundle).some(
      row =>
        row.kind === 'strategy' &&
        (row.material.value as { family?: string }).family === 'source-review',
    ),
  ).toBe(true);
  const changed = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: {
      sourceReviews: reviews.map(review =>
        Object.assign({}, review, {
          conclusion: review.conclusion + ' Additional reviewed explanation.',
        }),
      ),
    },
  });
  expect(derive(observation, { strategy: 'legacy-portal', sources: [changed] }).inputHash).not.toBe(
    bundle.inputHash,
  );
});
it('rejects stale, wrong-offset and wrong-source semantic reviews instead of accepting a caller completion claim', async () => {
  const observation = observed(raw()),
    reader = await repository({
      'server.ts': "import {createServer} from 'node:http';createServer((req,res)=>res.end('ok'));",
    });
  const graph = await analyzeServiceGraph(reader, hash),
    reviews = semanticReviews(graph);
  for (const replacement of [
    { offset: 999 },
    { sourceId: `sha256:${'b'.repeat(64)}` as const },
    { hash: `sha256:${'b'.repeat(64)}` as const },
  ])
    await expect(
      prepareCoreRecipeSource({
        sourceId: hash,
        reader,
        observation,
        sourceContext: { sourceReviews: reviews.map(review => ({ ...review, ...replacement })) },
      }),
    ).rejects.toThrow('PORTAL_SOURCE_REVIEW_NOT_BOUND');
  await expect(
    prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: { complete: true } as never,
    }),
  ).rejects.toThrow(/unrecognized|Unrecognized/u);
  await writeFile(
    join(reader.rootDir, 'server.ts'),
    "import {createServer} from 'node:http';createServer((req,res)=>res.end('changed'));",
  );
  await expect(
    prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: { sourceReviews: reviews },
    }),
  ).rejects.toThrow('PORTAL_SOURCE_REVIEW_NOT_BOUND');
});
it('qualifies same-path references in one global batch and rejects omitted or reordered members', async () => {
  const observation = componentObservation(),
    a = await repository(workspaceFiles),
    b = await repository(workspaceFiles),
    bId = `sha256:${'b'.repeat(64)}` as const;
  await expect(
    prepareCoreRecipeSources({
      sources: [
        { sourceId: hash, reader: a },
        { sourceId: bId, reader: b },
      ],
      observation,
      sourceContext: { services: ['web'] },
    }),
  ).rejects.toThrow('PORTAL_SERVICE_SELECTION_AMBIGUOUS');
  const sources = await prepareCoreRecipeSources({
    sources: [
      { sourceId: hash, reader: a },
      { sourceId: bId, reader: b },
    ],
    observation,
    sourceContext: { services: [{ sourceId: bId, sourceIndex: 1, rootPath: 'web' }] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources });
  expect(structureRoots(bundle)).toEqual(['web']);
  expect(
    rows(bundle, 'map-design')
      .filter(row => row.kind === 'mapping')
      .every(row => row.sourceId === bId),
  ).toBe(true);
  expect(
    sourceRows(bundle)
      .filter(row => row.kind === 'source-context')
      .map(row => row.context.sourceIndex),
  ).toEqual([0, 1]);
  expect(() =>
    derive(observation, { strategy: 'reference-portal', sources: [sources[1]!] }),
  ).toThrow('CORE_SOURCE_CONTEXT_SET_MISMATCH');
  expect(() =>
    derive(observation, { strategy: 'reference-portal', sources: sources.toReversed() }),
  ).toThrow('CORE_SOURCE_CONTEXT_SET_MISMATCH');
});
it('hard syntax errors cannot be waived by a review or replaced by a complete flag', async () => {
  const observation = observed(raw()),
    reader = await repository({ 'broken.ts': 'export const broken = ;' });
  const graph = await analyzeServiceGraph(reader, hash),
    issue = graph.issues.find(entry => entry.startsWith('AST_ERRORS:'))!;
  expect(issue).toBeDefined();
  const path = issue.slice(issue.indexOf(':') + 1);
  await expect(
    prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: {
        sourceReviews: [
          {
            sourceId: hash,
            sourceIndex: 0,
            path,
            hash: graph.files.find(file => file.path === path)!.hash,
            offset: 0,
            issue: 'AST_ERRORS',
            decision: 'retain-conservative-closure',
            layers: ['backend'],
            conclusion: 'Attempted semantic review cannot waive a real source syntax failure.',
          },
        ],
      },
    }),
  ).rejects.toThrow('PORTAL_SOURCE_REVIEW_NOT_BOUND');
  const source = await prepareCoreRecipeSource({ sourceId: hash, reader, observation });
  expect(
    result(
      derive(observation, { strategy: 'reference-portal', sources: [source] }),
      'plan-design-implementation',
    ).status,
  ).toBe('blocked');
});
it('full-root byte failures and canonical mapping discovery limits stay hard failures', async () => {
  const observation = observed(raw()),
    reader = await repository();
  await expect(
    prepareCoreRecipeSource({
      sourceId: hash,
      reader: new RepoReader({ rootDir: reader.rootDir, maxFileBytes: 16 }),
      observation,
    }),
  ).rejects.toThrow('CORE_SOURCE_INVENTORY_INCOMPLETE');
  const files = Object.fromEntries(
    Array.from({ length: 201 }, (_, index) => [
      `web/colors/${index}.css`,
      `:root { --color${index}: #000000; }`,
    ]),
  );
  const many = await repository({ ...workspaceFiles, ...files });
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader: many,
    observation,
    sourceContext: { services: ['web'] },
  });
  expect(
    result(derive(observation, { strategy: 'reference-portal', sources: [source] }), 'map-design')
      .status,
  ).toBe('blocked');
});
it('unsupported imported-theme values remain unmapped obligations without a guessed token', async () => {
  const observation = observed(
    raw({
      tokens: [{ ...variable, valuesByMode: { light: blue, dark: blue } }],
      collections: [collection],
    }),
  );
  const reader = await repository({
    ...workspaceFiles,
    'package.json': '{"workspaces":["web","shared","jobs"]}',
    'web/package.json': '{"name":"web","dependencies":{"react":"19.2.8","tailwindcss":"3.4.0"}}',
    'web/tailwind.config.ts':
      "import {colors} from '../shared/colors';export default {theme:{colors}};",
    'shared/package.json': '{"name":"shared"}',
    'shared/colors.ts': "export const colors={primary:'#0000ff'};",
  });
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] }),
    mapping = rows(bundle, 'map-design').find(
      row => row.kind === 'mapping' && row.mappingKind === 'token',
    );
  expect(mapping).toMatchObject({ status: 'unmapped' });
  expect(
    (mapping as Extract<typeof mapping, { kind: 'mapping' }>).material.value,
  ).not.toHaveProperty('candidate');
  expect(
    rows(bundle, 'map-design').some(
      row =>
        row.kind === 'obligation' &&
        row.obligation.kind === 'reuse-review' &&
        row.obligation.itemId === 'token:v',
    ),
  ).toBe(true);
});
it('unsupported Vue runtime stays unresolved or reviewed with conservative closure instead of silently narrowing it', async () => {
  const observation = observed(raw()),
    reader = await repository({
      ...workspaceFiles,
      'web/package.json': '{"name":"web","dependencies":{"vue":"3.5.0"}}',
      'web/Button.vue':
        '<template><button>Vue</button></template><script setup lang="ts">const label="Vue"</script>',
    });
  const graph = await analyzeServiceGraph(reader, hash),
    reviews = semanticReviews(graph);
  expect(reviews.some(review => review.issue === 'UNSUPPORTED_RUNTIME_SOURCE')).toBe(true);
  const unresolved = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'] },
  });
  expect(
    result(
      derive(observation, { strategy: 'reference-portal', sources: [unresolved] }),
      'plan-design-implementation',
    ).status,
  ).toBe('blocked');
  const reviewed = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { services: ['web'], sourceReviews: reviews },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [reviewed] });
  expect(structureRoots(bundle)).toContain('jobs');
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: { complete: true, closureRoots: expect.arrayContaining(['web', 'jobs']) },
  });
});
it('truncated semantic diagnostics stay blocked even when every retained diagnostic has an exact review', async () => {
  const observation = observed(raw()),
    reader = await repository({
      'many.ts': Array.from(
        { length: 520 },
        (_, index) => `fetch('/route-${index}',unknownOptions);`,
      ).join('\n'),
    });
  const graph = await analyzeServiceGraph(reader, hash);
  expect(graph.connections!.issuesTruncated).toBe(true);
  const source = await prepareCoreRecipeSource({
    sourceId: hash,
    reader,
    observation,
    sourceContext: { sourceReviews: semanticReviews(graph) },
  });
  const bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(result(bundle, 'plan-design-implementation').status).toBe('blocked');
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: {
      complete: false,
      issues: expect.arrayContaining([expect.stringContaining('SERVICE_DIAGNOSTICS_TRUNCATED')]),
    },
  });
});
it('a semantic review cannot cross a global source index in same-path references', async () => {
  const observation = observed(raw()),
    code = {
      'server.ts': "import {createServer} from 'node:http';createServer((req,res)=>res.end('ok'));",
    },
    a = await repository(code),
    b = await repository(code),
    bId = `sha256:${'b'.repeat(64)}` as const;
  const graphA = await analyzeServiceGraph(a, hash),
    graphB = await analyzeServiceGraph(b, bId);
  await expect(
    prepareCoreRecipeSources({
      sources: [
        { sourceId: hash, reader: a },
        { sourceId: bId, reader: b },
      ],
      observation,
      sourceContext: {
        sourceReviews: [...semanticReviews(graphA, 0), ...semanticReviews(graphB, 0)],
      },
    }),
  ).rejects.toThrow('PORTAL_SOURCE_REVIEW_NOT_BOUND');
  const sources = await prepareCoreRecipeSources({
    sources: [
      { sourceId: hash, reader: a },
      { sourceId: bId, reader: b },
    ],
    observation,
    sourceContext: {
      sourceReviews: [...semanticReviews(graphA, 0), ...semanticReviews(graphB, 1)],
    },
  });
  expect(
    result(
      derive(observation, { strategy: 'reference-portal', sources }),
      'plan-design-implementation',
    ).status,
  ).toBe('ready');
});
it('typed source context pages reject altered selection identity even with recalculated page envelopes', async () => {
  const observation = observed(raw()),
    source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader: await repository(),
      observation,
    }),
    bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  const pages = structuredClone(bundle.pages.filter(page => page.page.recipeId === 'map-design'));
  const context = pages.flatMap(page => page.page.rows).find(row => row.kind === 'source-context')!;
  context.context.selectionHash = hash;
  for (const page of pages) page.hash = coreHash(page.page);
  const manifest = {
    ...result(bundle, 'map-design'),
    pages: pages.map(({ page, hash: pageHash }) => ({
      index: page.index,
      hash: pageHash,
      rows: page.rows.length,
      bytes: Buffer.byteLength(canonicalJson(page)),
    })),
  };
  expect(() => verifyCoreRecipePages(manifest, pages)).toThrow('CORE_SOURCE_CONTEXT_HASH_MISMATCH');
});
it('retains a related backend dependency instead of constructing an already selected backend layer', async () => {
  const observation = componentObservation(),
    reader = await repository({
      ...workspaceFiles,
      'package.json': '{"workspaces":["web","api","jobs"]}',
      'web/Button.tsx':
        "import type { Cart } from '../api/contracts';export function Button(props:{cart:Cart}){return <button>Checkout</button>}",
      'api/package.json': '{"name":"api","dependencies":{"express":"5.0.0"}}',
      'api/contracts.ts': 'export interface Cart { id:string }',
      'api/main.ts':
        "import express from 'express';const app=express();app.get('/checkout',()=>{});",
    });
  const source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: { services: ['web'] },
    }),
    bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(structureRoots(bundle)).toEqual(expect.arrayContaining(['web', 'api']));
  expect(structureRoots(bundle)).not.toContain('jobs');
  expect(
    sourceRows(bundle).some(
      row =>
        row.kind === 'obligation' &&
        row.obligation.kind === 'construct-layer' &&
        row.obligation.itemId.endsWith(':backend'),
    ),
  ).toBe(false);
});
it('missing source context cannot be hidden by recalculating page counts and hashes', async () => {
  const observation = componentObservation(),
    source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader: await repository(),
      observation,
    }),
    bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  const pages = structuredClone(bundle.pages.filter(page => page.page.recipeId === 'map-design'));
  for (const item of pages) {
    item.page.rows = item.page.rows.filter(row => row.kind !== 'source-context');
    item.hash = coreHash(item.page);
  }
  const manifest = {
    ...result(bundle, 'map-design'),
    rowCount: pages.reduce((sum, item) => sum + item.page.rows.length, 0),
    pages: pages.map(({ page, hash: pageHash }) => ({
      index: page.index,
      hash: pageHash,
      rows: page.rows.length,
      bytes: Buffer.byteLength(canonicalJson(page)),
    })),
  };
  expect(() => verifyCoreRecipePages(manifest, pages)).toThrow('CORE_SOURCE_CONTEXT_MISSING');
});
it('selected source and pattern size limits remain blocked with their original diagnostics', async () => {
  const observation = observed(raw()),
    reader = await repository({
      ...workspaceFiles,
      'web/large.ts': 'export const text = "' + 'a'.repeat(270000) + '";',
    });
  const source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: { services: ['web'] },
    }),
    bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: { complete: false },
  });
  expect(result(bundle, 'plan-design-implementation').status).toBe('blocked');
  expect(
    sourceRows(bundle).some(
      row => row.kind === 'issue' && row.issue.code === 'CORE_SOURCE_PATTERN_INCOMPLETE',
    ),
  ).toBe(true);
});
it('bounds source review inputs before reading getters or recursive context material', async () => {
  const observation = observed(raw()),
    reader = await repository();
  let getterCalls = 0;
  const sourceContext = Object.defineProperty({}, 'services', {
    enumerable: true,
    get() {
      getterCalls++;
      return ['.'];
    },
  });
  await expect(
    prepareCoreRecipeSource({ sourceId: hash, reader, observation, sourceContext }),
  ).rejects.toThrow('CORE_SOURCE_CONTEXT_LIMIT');
  expect(getterCalls).toBe(0);
});
it('maps a one-character selected root without absorbing its nested or sibling services', async () => {
  const observation = componentObservation(),
    reader = await repository({
      'package.json': '{"workspaces":["a","a/n","z"]}',
      'a/package.json': '{"name":"a","dependencies":{"react":"19.2.8"}}',
      'a/Button.tsx': 'export function Button(){return <button>Selected</button>}',
      'a/n/package.json': '{"name":"nested","dependencies":{"express":"5.0.0"}}',
      'a/n/Button.tsx': 'export function Button(){return <button>Nested</button>}',
      'z/package.json': '{"name":"z","dependencies":{"express":"5.0.0"}}',
      'z/Button.tsx': 'export function Button(){return <button>Sibling</button>}',
    });
  const graph = await analyzeServiceGraph(reader, hash);
  const source = await prepareCoreRecipeSource({
      sourceId: hash,
      reader,
      observation,
      sourceContext: { services: ['a'] },
    }),
    bundle = derive(observation, { strategy: 'reference-portal', sources: [source] });
  expect(
    rows(bundle, 'map-design').find(
      row => row.kind === 'mapping' && row.mappingKind === 'component',
    ),
  ).toMatchObject({ material: { value: { candidate: { filePath: 'a/Button.tsx' } } } });
  expect(structureRoots(bundle)).toEqual(['a']);
  expect(bundle.sources[0]!.inventoryHash).toBe(graph.sourceInventory!.hash);
  expect(sourceRows(bundle).find(row => row.kind === 'source-context')).toMatchObject({
    context: {
      effectiveLayers: expect.arrayContaining(['frontend']),
      closureRoots: ['a'],
      complete: true,
    },
  });
  expect(
    sourceRows(bundle).some(
      row =>
        row.kind === 'obligation' &&
        row.obligation.kind === 'construct-layer' &&
        row.obligation.itemId.endsWith(':backend'),
    ),
  ).toBe(true);
});
