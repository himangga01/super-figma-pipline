import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hashSnapshot,
  SnapshotV1Schema,
  GroundingGraphV1Schema,
  groundingGraphContentHash,
} from '@sfp/ir';
import { canonicalFileIdentityHash, GetDesignContextResultSchema } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectProject } from '../../cli/src/project-inspector.js';
import { TokenMapResultSchema, ComponentMapResultSchema } from '../../shared/src/result-schemas.js';
import { RepoReader } from '../src/fs/repo-walk.js';
import { mapObservationTokens } from '../src/mapping/design-mapping.js';
import { loadMappingTokenSource } from '../src/mapping/mapping-overrides.js';
import { normalizeDesignObservation } from '../src/portal/design-normalization.js';
import { analyzeProject } from '../src/profile/profile.js';
import { buildGroundingGraph } from '../src/snapshot/build-grounding-graph.js';
import { handleComponentMap } from '../src/tools/component-map.js';
import { handleIconMap } from '../src/tools/icon-map.js';
import { handleTokenMap } from '../src/tools/token-map.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const red = { r: 1, g: 0, b: 0, a: 1 },
  blue = { r: 0, g: 0, b: 1, a: 1 };
const collection = {
  id: 'c',
  key: '',
  name: 'Theme',
  defaultModeId: 'light',
  variableIds: ['red', 'blue'],
  modes: [
    { modeId: 'light', name: 'Light' },
    { modeId: 'dark', name: 'Dark' },
  ],
};
const variables = [
  {
    id: 'red',
    key: '',
    name: 'Same',
    collectionId: 'c',
    resolvedType: 'COLOR',
    valuesByMode: { light: red, dark: blue },
  },
  {
    id: 'blue',
    key: '',
    name: 'Same',
    collectionId: 'c',
    resolvedType: 'COLOR',
    valuesByMode: { light: blue, dark: blue },
  },
];
const paints = [
  {
    id: 'style',
    key: '',
    name: 'Paint red',
    description: '',
    paints: [{ type: 'SOLID' as const, color: red, opacity: 1, visible: true }],
  },
];
const nodes = [
  {
    id: 'button',
    name: 'Button',
    type: 'INSTANCE',
    mainComponent: { id: 'main', key: '', name: 'Button' },
    componentProperties: { size: { type: 'VARIANT' as const, value: 'large' } },
    componentApi: {
      properties: {
        size: { type: 'VARIANT', defaultValue: 'small', variantOptions: ['small', 'large'] },
        disabled: { type: 'BOOLEAN', defaultValue: false },
      },
    },
    propertyOverrides: [{ name: 'Label', visible: false }],
    explicitVariableModes: { c: 'dark' },
    boundVariables: { fills: ['red'] },
  },
  {
    id: 'light',
    name: 'Other',
    type: 'RECTANGLE',
    resolvedVariableModes: { c: 'light' },
    boundVariables: { fills: ['red'] },
  },
  { id: 'icon', name: 'Arrow', type: 'VECTOR', width: 16, height: 16 },
];
const context = GetDesignContextResultSchema.parse({
  nodes,
  variables: Object.fromEntries(
    variables.map(variable => [
      variable.id,
      {
        name: variable.name,
        type: variable.resolvedType,
        collectionId: variable.collectionId,
        valuesByMode: variable.valuesByMode,
        collection,
        resolution: 'observed',
      },
    ]),
  ),
  styles: {
    style: { name: 'Paint red', type: 'PAINT', paints: paints[0]!.paints, resolution: 'observed' },
  },
});
const dispatch = async (name: string) => {
  if (name === 'get_variable_defs') return { variables, collections: [collection] };
  if (name === 'get_styles') return { paints, texts: [], effects: [], grids: [] };
  if (name === 'get_design_context') return context;
  throw new Error('Unexpected tool');
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sfp-mapping-consumers-'));
  directories.push(root);
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '1' } }));
  await writeFile(join(root, 'theme.css'), ':root { --red: #ff0000; --blue: #0000ff; }');
  await writeFile(
    join(root, 'Button.tsx'),
    'export function Button({size}:{size:string}) {return <button>{size}</button>}',
  );
  await writeFile(
    join(root, 'Arrow.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0h10"/></svg>',
  );
  return root;
}
function snapshot(observed = context) {
  const fileIdentity = { kind: 'figma-file-key' as const, value: 'mapping-fixture' };
  const source = {
    schemaVersion: 1 as const,
    locator: {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      fileIdentityHash: canonicalFileIdentityHash(fileIdentity),
      snapshotId: 'sfp_snap1_AAAAAAAAAAAAAAAAAAAAAA',
    },
    connector: {
      protocolVersion: '1',
      productVersion: '1',
      sessionId: 'test',
      pluginGeneration: '1',
      fileIdentity,
      fileName: 'Fixture',
      editorType: 'figma',
    },
    target: { nodeIds: nodes.map(node => node.id) },
    observed,
    fidelity: {
      detail: 'full' as const,
      truncated: false,
      omitted: [],
      unsupported: [],
      visitedCount: 0,
      expandedSections: [],
      completeLeafSections: [],
      issues: [],
    },
    capturedAt: '2026-09-15T00:00:00.000Z',
    contentHash: '',
    extensions: {},
  };
  source.contentHash = hashSnapshot(source);
  return SnapshotV1Schema.parse(source);
}
describe('real mapping consumers', () => {
  it('Chrome inspection, Desktop tools and persisted graph preserve IDs, values, styles, sibling modes and APIs', async () => {
    const root = await fixture();
    const chrome = await inspectProject(root, {
      nodes,
      tokens: variables,
      collections: [collection],
      styles: { paints },
      truncated: false,
    });
    const desktop = TokenMapResultSchema.parse(
      await handleTokenMap(dispatch, { rootDir: root, nodeId: 'button' }),
    );
    expect(desktop.mappings).toEqual(chrome.mappings.tokens);
    expect(desktop.observation!.bindings).toEqual(chrome.observation.bindings);
    expect(desktop.observation!.bindings.map(binding => binding.value)).toEqual([blue, red]);
    const component = ComponentMapResultSchema.parse(
      await handleComponentMap(dispatch, { rootDir: root }),
    );
    expect(component.mappings).toEqual(chrome.mappings.components);
    expect(component.mappings[0]?.candidate?.unmatchedProps).toContain('disabled');
    expect(component.mappings[0]?.observations?.[0]?.properties.propertyOverrides).toEqual(
      nodes[0]!.propertyOverrides,
    );
    const icon = await handleIconMap(dispatch, { rootDir: root });
    expect(icon.mappings).toEqual(chrome.mappings.icons);
    const graph = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
    expect(graph.mappingObservation?.bindings).toEqual(chrome.observation.bindings);
    expect(graph.mappingObservation?.catalogs.variables).toEqual(
      chrome.observation.catalogs.variables,
    );
    for (const id of ['red', 'blue', 'style']) {
      const source = graph.nodes.find(
        node => node.locator.kind === 'figma-node' && node.locator.nodeId === id,
      )!;
      const edges = graph.edges.filter(
        edge => edge.fromNodeId === source.nodeId && edge.kind === 'maps-token',
      );
      expect(edges).toHaveLength(1);
      const target = graph.nodes.find(node => node.nodeId === edges[0]!.toNodeId)!;
      expect(target.locator).toMatchObject({ symbol: id === 'blue' ? 'blue' : 'red' });
    }
  });
  it('all consumers read the same versioned override and reject source, type, mode and code drift', async () => {
    const root = await fixture();
    const first = await handleTokenMap(dispatch, { rootDir: root });
    const blueToken = first.mappings.find(token => token.sourceId === 'blue')!;
    const proof = {
      version: 2,
      sourceId: 'blue',
      type: 'COLOR',
      value: '#0000FF',
      collectionId: 'c',
      defaultModeId: 'light',
      modeValues: blueToken.modeValues,
      ref: 'var(--blue)',
      token: 'blue',
      projectValue: '#0000ff',
      codeSourceHash: first.codeSourceHash,
    };
    const mapPath = join(root, 'docs/figma-token-map.md');
    await writeFile(mapPath, '```sfp-token-map-v2\n' + JSON.stringify([proof]) + '\n```');
    const mapped = await handleTokenMap(dispatch, { rootDir: root });
    expect(mapped.mappings.find(token => token.sourceId === 'blue')?.overrideStatus).toBe(
      'verified',
    );
    const renamedDispatch = async (name: string) =>
      name === 'get_variable_defs'
        ? {
            variables: variables.map(variable =>
              variable.id === 'blue' ? { ...variable, name: 'Renamed' } : variable,
            ),
            collections: [collection],
          }
        : dispatch(name);
    expect(
      (await handleTokenMap(renamedDispatch, { rootDir: root })).mappings.find(
        token => token.sourceId === 'blue',
      )?.overrideStatus,
    ).toBe('verified');
    const changedDispatch = async (name: string) =>
      name === 'get_variable_defs'
        ? {
            variables: variables.map(variable =>
              variable.id === 'blue'
                ? { ...variable, valuesByMode: { light: red, dark: blue } }
                : variable,
            ),
            collections: [collection],
          }
        : dispatch(name);
    expect(
      (await handleTokenMap(changedDispatch, { rootDir: root })).mappings.find(
        token => token.sourceId === 'blue',
      )?.overrideStatus,
    ).toBe('stale');
    const chrome = await inspectProject(root, {
      nodes,
      tokens: variables,
      collections: [collection],
      truncated: false,
      styles: { paints },
    });
    expect(chrome.mappings.tokens).toEqual(mapped.mappings);
    const provenGraph = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
    expect(
      provenGraph.mappingObservation?.catalogs.variables.some(variable => variable.id === 'blue'),
    ).toBe(true);
    for (const patch of [
      { value: '#ffffff' },
      { type: 'FLOAT' },
      { modeValues: { light: '#0000FF', dark: '#FFFFFF' } },
      { ref: 'var(--red)' },
    ]) {
      await writeFile(
        mapPath,
        '```sfp-token-map-v2\n' + JSON.stringify([{ ...proof, ...patch }]) + '\n```',
      );
      expect(
        (await handleTokenMap(dispatch, { rootDir: root })).mappings.find(
          token => token.sourceId === 'blue',
        )?.overrideStatus,
      ).toBe('stale');
    }
    await writeFile(mapPath, '```sfp-token-map-v2\n' + JSON.stringify([proof]) + '\n```');
    await writeFile(
      join(root, 'theme.css'),
      ':root { --red:#ff0000; --blue:#0000ff; } /* changed source */',
    );
    expect(
      (await handleTokenMap(dispatch, { rootDir: root })).mappings.find(
        token => token.sourceId === 'blue',
      )?.overrideStatus,
    ).toBe('stale');
  });
  it('conflicting catalog IDs stay incomplete instead of proving the retained first row', () => {
    const observation = normalizeDesignObservation({
      source: 'figma-plugin-api-via-scripter',
      nodes: [],
      tokens: [variables[0], { ...variables[0], valuesByMode: { light: blue, dark: blue } }],
      collections: [collection],
    });
    const mappings = mapObservationTokens(
      observation,
      [{ name: 'Same', value: '#ff0000', cssVar: 'var(--same)' }],
      { threshold: 0.7 },
    );
    expect(observation.issues.some(issue => issue.code === 'DUPLICATE_ID')).toBe(true);
    expect(mappings[0]).toMatchObject({
      sourceId: 'red',
      figmaValue: null,
      resolution: 'unresolved',
    });
    expect(mappings[0]?.status).not.toBe('high');
  });
  it('all three adapters resolve aliases only from independent per-node collection selections', async () => {
    const root = await fixture();
    const aliasCollection = {
      id: 'semantic',
      key: '',
      name: 'Semantic',
      defaultModeId: 'sLight',
      variableIds: ['alias'],
      modes: [{ modeId: 'sLight', name: 'Light' }],
    };
    const alias = {
      id: 'alias',
      key: '',
      name: 'Alias',
      resolvedType: 'COLOR',
      collectionId: 'semantic',
      valuesByMode: { sLight: { type: 'VARIABLE_ALIAS', id: 'red' } },
    };
    const tree = [
      {
        id: 'parent',
        name: 'Parent',
        type: 'FRAME',
        explicitVariableModes: { semantic: 'sLight', c: 'dark' },
        children: [
          {
            id: 'darkChild',
            name: 'Dark',
            type: 'RECTANGLE',
            boundVariables: { fills: ['alias'] },
          },
          {
            id: 'lightChild',
            name: 'Light',
            type: 'RECTANGLE',
            explicitVariableModes: { c: 'light' },
            boundVariables: { fills: ['alias'] },
          },
        ],
      },
      {
        id: 'unknown',
        name: 'Unknown',
        type: 'RECTANGLE',
        explicitVariableModes: { semantic: 'sLight' },
        boundVariables: { fills: ['alias'] },
      },
    ];
    const aliasContext = GetDesignContextResultSchema.parse({
      ...context,
      nodes: tree,
      variables: {
        ...context.variables,
        alias: {
          name: 'Alias',
          type: 'COLOR',
          collectionId: 'semantic',
          valuesByMode: alias.valuesByMode,
          collection: aliasCollection,
        },
      },
    });
    const aliasDispatch = async (name: string) =>
      name === 'get_variable_defs'
        ? { variables: [...variables, alias], collections: [collection, aliasCollection] }
        : name === 'get_design_context'
          ? aliasContext
          : dispatch(name);
    const chrome = await inspectProject(root, {
      nodes: tree,
      tokens: [...variables, alias],
      collections: [collection, aliasCollection],
      styles: { paints },
      truncated: false,
    });
    const desktop = await handleTokenMap(aliasDispatch, { rootDir: root, nodeId: 'parent' });
    const graph = await buildGroundingGraph(
      snapshot(aliasContext),
      new RepoReader({ rootDir: root }),
    );
    expect(chrome.observation.bindings).toEqual(desktop.observation.bindings);
    expect(graph.mappingObservation?.bindings).toEqual(chrome.observation.bindings);
    expect(chrome.observation.bindings).toMatchObject([
      { nodeId: 'darkChild', status: 'resolved', value: blue, aliasChain: ['alias', 'red'] },
      { nodeId: 'lightChild', status: 'resolved', value: red, aliasChain: ['alias', 'red'] },
      { nodeId: 'unknown', status: 'unresolved', reason: 'MODE_UNOBSERVED' },
    ]);
  });
  it('preserves ambiguous SCSS declaring files in Chrome and Desktop adapters', async () => {
    const root = await fixture();
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { sass: '1' } }));
    await writeFile(join(root, 'a.scss'), '$accent: #123456;');
    await writeFile(join(root, 'b.scss'), '$accent: #123456;');
    await writeFile(join(root, 'docs/figma-token-map.md'), '| Same | $accent |');
    const chrome = await inspectProject(root, {
      nodes,
      tokens: variables,
      collections: [collection],
      styles: { paints },
      truncated: false,
    });
    const desktop = await handleTokenMap(dispatch, { rootDir: root });
    expect(chrome.mappings.tokens).toEqual(desktop.mappings);
    expect(desktop.mappings[0]?.candidate?.ambiguousFrom?.length).toBeGreaterThan(0);
    expect(desktop.mappings[0]?.overrideStatus).toBe('legacy-unverified');
    expect(desktop.mappings[0]?.status).not.toBe('high');
  });

  it('does not turn an unavailable catalog value or malformed proof into verified output', async () => {
    const root = await fixture();
    const unavailable = async (name: string) =>
      name === 'get_variable_defs'
        ? { variables: [{ ...variables[0], valuesByMode: {} }], collections: [collection] }
        : dispatch(name);
    const result = await handleTokenMap(unavailable, { rootDir: root });
    expect(result.mappings[0]).toMatchObject({
      sourceId: 'red',
      figmaValue: null,
      resolution: 'unresolved',
    });
    expect(result.mappings[0]?.status).not.toBe('high');
    await writeFile(
      join(root, 'docs/figma-token-map.md'),
      '```sfp-token-map-v2\n[{"version":3}]\n```',
    );
    await expect(handleTokenMap(dispatch, { rootDir: root })).rejects.toThrow(/Invalid/);
  });
  it('rejects token source changes between actual parser bytes and proof publication', async () => {
    const root = await fixture();
    const profile = await analyzeProject(root, new RepoReader({ rootDir: root }));
    class MutatingReader extends RepoReader {
      changed = false;
      override async readBytes(path: string, maxBytes?: number): Promise<Buffer> {
        const bytes = await super.readBytes(path, maxBytes);
        if (path === 'theme.css' && !this.changed) {
          this.changed = true;
          await writeFile(join(root, path), bytes.toString('utf8').replace('#ff0000', '#00ff00'));
        }
        return bytes;
      }
    }
    const reader = new MutatingReader({ rootDir: root });
    await expect(loadMappingTokenSource(reader, profile)).rejects.toThrow('MAPPING_SOURCE_CHANGED');
    expect(reader.changed).toBe(true);
    const stable = await loadMappingTokenSource(new RepoReader({ rootDir: root }), profile);
    expect(stable.codeSourceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it('merges selected remote dependencies with local catalogs across all three consumers', async () => {
    const root = await fixture();
    const remoteDispatch = async (name: string) =>
      name === 'get_variable_defs'
        ? { variables: [], collections: [] }
        : name === 'get_styles'
          ? { paints: [], texts: [], effects: [], grids: [] }
          : dispatch(name);
    const desktop = await handleTokenMap(remoteDispatch, { rootDir: root, nodeId: 'button' });
    const chrome = await inspectProject(root, {
      nodes,
      tokens: variables,
      collections: [collection],
      styles: { paints },
      truncated: false,
    });
    const graph = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
    expect(desktop.mappings).toEqual(chrome.mappings.tokens);
    expect(desktop.observation.bindings).toEqual(chrome.observation.bindings);
    expect(graph.mappingResults?.tokens).toEqual(desktop.mappings);
  });
  it('retains conflicting local/context values as incomplete instead of trusting the first row', async () => {
    const root = await fixture();
    const conflictingDispatch = async (name: string) =>
      name === 'get_variable_defs'
        ? {
            variables: [
              { ...variables[0], valuesByMode: { light: blue, dark: blue } },
              variables[1],
            ],
            collections: [collection],
          }
        : dispatch(name);
    const desktop = await handleTokenMap(conflictingDispatch, { rootDir: root, nodeId: 'button' });
    expect(desktop.observation.issues.some(issue => issue.code === 'DUPLICATE_ID')).toBe(true);
    expect(desktop.mappings.find(mapping => mapping.sourceId === 'red')).toMatchObject({
      figmaValue: null,
      resolution: 'unresolved',
    });
    expect(desktop.observation.bindings.every(binding => binding.status === 'unresolved')).toBe(
      true,
    );
  });
  it('marks a missing recorded component path stale despite a same-name symbol elsewhere', async () => {
    const root = await fixture();
    await writeFile(join(root, 'docs/figma-component-map.md'), '| Button | missing/Button.tsx |');
    const desktop = await handleComponentMap(dispatch, { rootDir: root });
    const chrome = await inspectProject(root, {
      nodes,
      tokens: variables,
      collections: [collection],
      styles: { paints },
      truncated: false,
    });
    const graph = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
    expect(desktop.mappings[0]).toMatchObject({
      overrideStatus: 'stale',
      source: 'scan',
      candidate: { filePath: 'Button.tsx' },
    });
    expect(chrome.mappings.components).toEqual(desktop.mappings);
    expect(graph.mappingResults?.components[0]).toMatchObject({
      overrideStatus: 'stale',
      candidate: { filePath: 'Button.tsx' },
    });
  });
  it('persists proof validity and exact code-source binding in graph content identity', async () => {
    const root = await fixture();
    const initial = await handleTokenMap(dispatch, { rootDir: root });
    const token = initial.mappings.find(mapping => mapping.sourceId === 'blue')!;
    const proof = {
      version: 2,
      sourceId: 'blue',
      type: 'COLOR',
      value: '#0000FF',
      collectionId: 'c',
      defaultModeId: 'light',
      modeValues: token.modeValues,
      ref: 'var(--blue)',
      token: 'blue',
      projectValue: '#0000ff',
      codeSourceHash: initial.codeSourceHash,
    };
    const save = async (value: unknown) =>
      writeFile(
        join(root, 'docs/figma-token-map.md'),
        '```sfp-token-map-v2\n' + JSON.stringify([value]) + '\n```',
      );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
    try {
      await save(proof);
      const verified = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
      await save({ ...proof, codeSourceHash: 'sha256:' + '0'.repeat(64) });
      const stale = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
      expect(
        verified.mappingResults?.tokens.find(mapping => mapping.sourceId === 'blue')
          ?.overrideStatus,
      ).toBe('verified');
      expect(
        stale.mappingResults?.tokens.find(mapping => mapping.sourceId === 'blue')?.overrideStatus,
      ).toBe('stale');
      expect(verified.mappingResults?.codeSourceHash).toBe(initial.codeSourceHash);
      expect(
        verified.mappingResults?.components.every(mapping => !('observations' in mapping)),
      ).toBe(true);
      expect(verified.contentHash).not.toBe(stale.contentHash);
    } finally {
      vi.useRealTimers();
    }
  });
  it('deduplicates metadata differences but rejects real collection-mode and paint conflicts', async () => {
    const root = await fixture();
    const metadata = async (name: string) =>
      name === 'get_variable_defs'
        ? {
            variables: variables.map(variable => ({
              ...variable,
              key: 'library-key',
              description: 'metadata',
              codeSyntax: {},
              valuesByMode: Object.fromEntries(
                Object.entries(variable.valuesByMode).map(([mode, value]) => [
                  mode,
                  { ...value, hex: value === red ? '#FF0000' : '#0000FF' },
                ]),
              ),
            })),
            collections: [
              {
                ...collection,
                key: 'collection-key',
                variableIds: ['blue', 'red', 'unreferenced'],
                modes: collection.modes.toReversed(),
              },
            ],
          }
        : name === 'get_styles'
          ? {
              paints: paints.map(paint => ({
                ...paint,
                key: 'style-key',
                description: 'metadata',
              })),
              texts: [],
              effects: [],
              grids: [],
            }
          : dispatch(name);
    const stable = await handleTokenMap(metadata, { rootDir: root, nodeId: 'button' });
    expect(stable.observation.issues.some(issue => issue.code === 'DUPLICATE_ID')).toBe(false);
    expect(stable.mappings.find(mapping => mapping.sourceId === 'red')?.figmaValue).toBe('#FF0000');
    const modeConflict = async (name: string) =>
      name === 'get_variable_defs'
        ? {
            variables,
            collections: [{ ...collection, defaultModeId: 'dark' }],
          }
        : dispatch(name);
    const conflicted = await handleTokenMap(modeConflict, { rootDir: root, nodeId: 'button' });
    expect(
      conflicted.observation.issues.some(
        issue => issue.code === 'DUPLICATE_ID' && issue.scope.startsWith('collections/'),
      ),
    ).toBe(true);
    expect(conflicted.observation.bindings.every(binding => binding.status === 'unresolved')).toBe(
      true,
    );
    const styleConflict = async (name: string) =>
      name === 'get_styles'
        ? {
            paints: [{ ...paints[0], paints: [{ ...paints[0]!.paints[0], color: blue }] }],
            texts: [],
            effects: [],
            grids: [],
          }
        : dispatch(name);
    const painted = await handleTokenMap(styleConflict, { rootDir: root, nodeId: 'button' });
    expect(
      painted.observation.issues.some(
        issue => issue.code === 'DUPLICATE_ID' && issue.scope.startsWith('paintStyles/'),
      ),
    ).toBe(true);
    expect(painted.mappings.find(mapping => mapping.sourceId === 'style')).toMatchObject({
      figmaValue: null,
      resolution: 'unresolved',
    });
  });
  it('binds compact mapping provenance to graph hash while allowing historical graph absence', async () => {
    const root = await fixture();
    const graph = await buildGroundingGraph(snapshot(), new RepoReader({ rootDir: root }));
    expect(GroundingGraphV1Schema.safeParse(graph).success).toBe(true);
    const changed = structuredClone(graph);
    changed.mappingResults!.codeSourceHash = 'sha256:' + 'f'.repeat(64);
    expect(GroundingGraphV1Schema.safeParse(changed).success).toBe(false);
    const legacy = structuredClone(graph);
    delete legacy.mappingResults;
    legacy.contentHash = groundingGraphContentHash(legacy);
    expect(GroundingGraphV1Schema.safeParse(legacy).success).toBe(true);
    expect(legacy.mappingResults).toBeUndefined();
    expect(graph.mappingResults?.components.every(mapping => !('observations' in mapping))).toBe(
      true,
    );
    expect(graph.mappingResults?.tokens.every(mapping => !('raw' in mapping))).toBe(true);
  });
});
