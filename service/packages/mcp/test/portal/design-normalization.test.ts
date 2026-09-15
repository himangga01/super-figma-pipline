import { describe, expect, it } from 'vitest';

import {
  normalizeDesignObservation,
  normalizePortalDesign,
  planDesignImageReferences,
} from '../../src/portal/design-normalization.js';

const collection = {
  id: 'c',
  name: 'Theme',
  key: 'ck',
  defaultModeId: 'light',
  modes: [
    { modeId: 'light', name: 'Light' },
    { modeId: 'dark', name: 'Dark' },
  ],
};
const token = {
  id: 'v',
  name: 'space',
  key: 'vk',
  resolvedType: 'FLOAT',
  valuesByMode: { light: 8, dark: 16 },
};
const nodes = [
  {
    id: 'n',
    type: 'FRAME',
    boundVariables: { itemSpacing: { type: 'VARIABLE_ALIAS', id: 'v' } },
    resolvedVariableModes: { c: 'dark' },
    itemSpacing: 16,
  },
];
const chrome = () => ({
  source: 'figma-plugin-api-via-scripter',
  nodes,
  tokens: [{ ...token, variableCollectionId: 'c' }],
  collections: [collection],
});
const desktop = () => ({
  source: 'desktop-plugin',
  fileUrlIdentityVerified: true,
  document: { children: nodes },
  variables: { variables: [{ ...token, collectionId: 'c' }], collections: [collection] },
  styles: { paints: [{ id: 'p', paints: [] }], texts: [], effects: [], grids: [] },
});

describe('capture observation normalization', () => {
  it.each([
    ['FLOAT', { bogus: 'value' }],
    ['FLOAT', '8'],
    ['BOOLEAN', 1],
    ['STRING', false],
    ['COLOR', { r: 0, g: 1 }],
    ['COLOR', { r: 0, g: 1, b: 2 }],
    ['EASING', { type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 'wrong' } }],
    ['EASING', { type: 'CUSTOM_CUBIC_BEZIER' }],
    ['EASING', { type: 'FUTURE_UNKNOWN' }],
  ])('retains malformed %s values as unresolved', (resolvedType, value) => {
    const raw = {
      ...chrome(),
      tokens: [
        { ...token, resolvedType, variableCollectionId: 'c', valuesByMode: { dark: value } },
      ],
    };
    const observed = normalizeDesignObservation(raw);
    expect(observed.bindings[0]).toMatchObject({ status: 'unresolved', reason: 'MALFORMED_VALUE' });
    expect(observed.bindings[0]).not.toHaveProperty('value');
    expect(observed.raw).toEqual(raw);
  });

  it.each([
    ['COLOR', { r: 0.1, g: 0.2, b: 0.3 }],
    ['COLOR', { r: 0.1, g: 0.2, b: 0.3, a: 0.5, hex: '#19334C80' }],
    ['EASING', { type: 'LINEAR' }],
    ['EASING', { type: 'HOLD' }],
    ['EASING', { type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.4 } }],
    [
      'EASING',
      {
        type: 'CUSTOM_CUBIC_BEZIER',
        easingFunctionCubicBezier: { x1: 0.1, y1: -0.2, x2: 0.8, y2: 1.2 },
      },
    ],
    ['TIMING', 0.3],
    ['BOOLEAN', false],
    ['STRING', 'literal'],
    ['FLOAT', -1.25],
  ])('preserves legitimate %s values without value coercion', (resolvedType, value) => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      tokens: [
        { ...token, resolvedType, variableCollectionId: 'c', valuesByMode: { dark: value } },
      ],
    });
    expect(observed.bindings[0]).toMatchObject({ status: 'resolved', value });
  });

  it('requires compatible declared types across each variable alias hop', () => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      tokens: [
        {
          ...token,
          variableCollectionId: 'c',
          valuesByMode: { dark: { type: 'VARIABLE_ALIAS', id: 'other' } },
        },
        {
          ...token,
          id: 'other',
          resolvedType: 'STRING',
          variableCollectionId: 'c',
          valuesByMode: { dark: 'wrong type' },
        },
      ],
    });
    expect(observed.bindings[0]).toMatchObject({
      status: 'unresolved',
      reason: 'MALFORMED_VALUE',
      aliasChain: ['v', 'other'],
    });
  });

  it.each(['bindings', 'componentApis', 'interactions'] as const)(
    'rejects successful %s proof over truncated or malformed trees while catalogs remain independent',
    name => {
      const node = {
        ...nodes[0],
        componentApi: { id: 'component', properties: {} },
        reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'CLOSE' }] }],
      };
      for (const tree of [
        [{ ...node, truncated: true, omittedChildren: 2 }],
        [node, null],
        [node, node],
      ]) {
        const raw = { ...chrome(), nodes: tree };
        const original = normalizeDesignObservation(raw);
        const count = 1;
        const evidence = {
          evidenceVersion: 1 as const,
          contentHash: original.contentHash,
          capabilities: [
            { name, status: count ? ('complete' as const) : ('empty' as const), count },
          ],
          coherence: { status: 'unverified' as const, atomic: false as const },
          sourceBinding: { status: 'unverified' as const },
        };
        expect(() => normalizeDesignObservation(raw, evidence)).toThrow(
          'DESIGN_OBSERVATION_CAPABILITY_MISMATCH',
        );
        expect(
          normalizeDesignObservation(raw, {
            ...evidence,
            capabilities: [{ name: 'variables', status: 'complete', count: 1 }],
          }).capabilities.find(capability => capability.name === 'variables')?.status,
        ).toBe('complete');
      }
      const raw = { ...chrome(), truncated: true, nodes: [{ id: 'empty', type: 'FRAME' }] };
      const original = normalizeDesignObservation(raw);
      const evidence = {
        evidenceVersion: 1 as const,
        contentHash: original.contentHash,
        capabilities: [{ name, status: 'empty' as const, count: 0 }],
        coherence: { status: 'unverified' as const, atomic: false as const },
        sourceBinding: { status: 'unverified' as const },
      };
      expect(() => normalizeDesignObservation(raw, evidence)).toThrow(
        'DESIGN_OBSERVATION_CAPABILITY_MISMATCH',
      );
      expect(
        normalizeDesignObservation(raw, {
          ...evidence,
          capabilities: [{ name: 'variables', status: 'complete', count: 1 }],
        }).capabilities.find(capability => capability.name === 'variables')?.status,
      ).toBe('complete');
    },
  );
  it('flattens actual Desktop variable definitions and keeps style catalogs namespaced', () => {
    const raw = desktop();
    const compatible = normalizePortalDesign(raw);
    expect(compatible.tokens).toEqual(raw.variables.variables);
    expect(compatible.collections).toEqual(raw.variables.collections);
    expect(compatible.styles).toEqual(raw.styles);
    const observed = normalizeDesignObservation(raw);
    expect(observed.catalogs.variables[0]).toMatchObject({
      id: 'v',
      collectionId: 'c',
      valuesByMode: { dark: 16 },
    });
    expect(observed.catalogs.paintStyles).toEqual(raw.styles.paints);
    expect(observed.raw).toEqual(raw);
    expect(normalizeDesignObservation(chrome()).bindings).toEqual(observed.bindings);
  });

  it('does not promote legacy success flags or empty arrays into verified empty catalogs', () => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      liveVerified: true,
      complete: true,
      tokens: [],
      collections: [],
      coverage: { variables: true },
    });
    expect(observed.authority).toBe('legacy-unverified');
    expect(observed.coherence).toEqual({ status: 'unverified', atomic: false });
    expect(observed.capabilities.find(item => item.name === 'variables')?.status).toBe('partial');
    expect(observed.capabilities.find(item => item.name === 'paintStyles')?.status).toBe(
      'unsupported',
    );
  });

  it('binds collector evidence to content and distinguishes successful empty enumeration', () => {
    const raw = { ...chrome(), nodes: [], tokens: [], collections: [] };
    const previous = normalizeDesignObservation(raw);
    const evidence = {
      evidenceVersion: 1 as const,
      contentHash: previous.contentHash,
      capabilities: [{ name: 'variables' as const, status: 'empty' as const, count: 0 }],
      coherence: { status: 'unverified' as const, atomic: false as const },
      sourceBinding: { status: 'unverified' as const },
    };
    expect(
      normalizeDesignObservation(raw, evidence).capabilities.find(
        item => item.name === 'variables',
      ),
    ).toMatchObject({ status: 'empty', evidence: 'collector-observed' });
    expect(() => normalizeDesignObservation(chrome(), evidence)).toThrow(
      'DESIGN_OBSERVATION_EVIDENCE_MISMATCH',
    );
  });

  it('keeps content identity stable across diagnostics while binding semantic changes', () => {
    const first = normalizeDesignObservation({ ...chrome(), capturedAt: 'a', elapsedMs: 1 });
    expect(
      normalizeDesignObservation({ ...chrome(), capturedAt: 'b', elapsedMs: 99 }).contentHash,
    ).toBe(first.contentHash);
    expect(
      normalizeDesignObservation({ ...chrome(), nodes: [{ ...nodes[0], itemSpacing: 17 }] })
        .contentHash,
    ).not.toBe(first.contentHash);
  });

  it('rejects cycles and unsupported JSON before hashing or recursive schema parsing', () => {
    const raw: Record<string, unknown> = chrome();
    raw.self = raw;
    expect(() => normalizeDesignObservation(raw)).toThrow('DESIGN_OBSERVATION_JSON_INVALID');
    expect(() => normalizeDesignObservation({ ...chrome(), value: Infinity })).toThrow(
      'DESIGN_OBSERVATION_JSON_INVALID',
    );
  });

  it('plans stroke and both text-run image references without deduplicating source usages', () => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      nodes: [
        {
          id: 'n',
          type: 'TEXT',
          strokes: [{ type: 'IMAGE', imageHash: 'h' }],
          textSegments: [{ fills: [{ type: 'IMAGE', imageHash: 'h' }] }],
          segments: [{ fills: [{ type: 'IMAGE', imageHash: 'd' }] }],
        },
      ],
    });
    expect(
      planDesignImageReferences(observed).map(item => [item.property, item.imageHash]),
    ).toEqual([
      ['/strokes/0', 'h'],
      ['/textSegments/0/fills/0', 'h'],
      ['/segments/0/fills/0', 'd'],
    ]);
  });

  it('resolves siblings and aliases using independent collection selections, never equal mode names', () => {
    const raw = {
      ...chrome(),
      collections: [
        collection,
        {
          ...collection,
          id: 'b',
          modes: [
            { modeId: 'x', name: 'Dark' },
            { modeId: 'y', name: 'Light' },
          ],
        },
      ],
      tokens: [
        {
          ...token,
          variableCollectionId: 'c',
          valuesByMode: { light: 8, dark: { type: 'VARIABLE_ALIAS', id: 'other' } },
        },
        { ...token, id: 'other', variableCollectionId: 'b', valuesByMode: { x: 32, y: 64 } },
      ],
      nodes: [
        {
          id: 'parent',
          type: 'FRAME',
          explicitVariableModes: { c: 'dark', b: 'y' },
          children: [
            { id: 'left', type: 'FRAME', boundVariables: { itemSpacing: 'v' }, itemSpacing: 64 },
            {
              id: 'right',
              type: 'FRAME',
              resolvedVariableModes: { c: 'light', b: 'x' },
              boundVariables: { itemSpacing: 'v' },
              itemSpacing: 8,
            },
          ],
        },
      ],
    };
    const observed = normalizeDesignObservation(raw);
    expect(observed.bindings).toMatchObject([
      {
        nodeId: 'left',
        value: 64,
        renderedValue: 64,
        aliasChain: ['v', 'other'],
        modeSelections: [
          { collectionId: 'c', modeId: 'dark', nodeId: 'parent', basis: 'explicit' },
          { collectionId: 'b', modeId: 'y', nodeId: 'parent', basis: 'explicit' },
        ],
      },
      {
        nodeId: 'right',
        value: 8,
        renderedValue: 8,
        modeSelections: [
          { collectionId: 'c', modeId: 'light', nodeId: 'right', basis: 'resolved' },
        ],
      },
    ]);
    expect(observed.nodes[0]?.properties).not.toHaveProperty('children');
    const subtree = { ...raw, nodes: [raw.nodes[0]!.children[0]!] };
    expect(normalizeDesignObservation(subtree).bindings[0]).toMatchObject({
      status: 'unresolved',
      reason: 'MODE_UNOBSERVED',
    });
  });

  it('retains unresolved remote aliases, cyclic aliases and missing values instead of a first-value fallback', () => {
    const alias = (id: string) => ({
      ...token,
      variableCollectionId: 'c',
      valuesByMode: { dark: { type: 'VARIABLE_ALIAS', id } },
    });
    expect(
      normalizeDesignObservation({ ...chrome(), tokens: [alias('remote')] }).bindings[0]?.reason,
    ).toBe('VARIABLE_MISSING');
    expect(
      normalizeDesignObservation({ ...chrome(), tokens: [alias('v')] }).bindings[0]?.reason,
    ).toBe('ALIAS_CYCLE');
    expect(
      normalizeDesignObservation({
        ...chrome(),
        tokens: [{ ...token, variableCollectionId: 'c', valuesByMode: { light: 1 } }],
      }).bindings[0]?.reason,
    ).toBe('MODE_MISSING');
  });

  it('retains component contracts, overrides and raw reaction semantics with source identities', () => {
    const properties = { 'Label#1': { type: 'TEXT', defaultValue: 'Buy' } };
    const reaction = {
      trigger: { type: 'ON_CLICK' },
      action: {
        type: 'NODE',
        destinationId: 'overlay',
        navigation: 'OVERLAY',
        transition: { type: 'SMART_ANIMATE', duration: 0.2 },
        overlayRelativePosition: { x: 3, y: 4 },
      },
    };
    const observed = normalizeDesignObservation({
      ...chrome(),
      nodes: [
        {
          ...nodes[0],
          componentPropertyDefinitions: properties,
          componentProperties: { 'Label#1': { type: 'TEXT', value: 'Sell' } },
          overrides: [{ id: 'child', overriddenFields: ['characters'] }],
          reactions: [reaction],
        },
      ],
    });
    expect(observed.nodes[0]?.properties).toMatchObject({
      componentPropertyDefinitions: properties,
      overrides: [{ id: 'child', overriddenFields: ['characters'] }],
    });
    expect(observed.interactions[0]).toMatchObject({
      nodeId: 'n',
      index: 0,
      trigger: reaction.trigger,
      actions: [reaction.action],
      raw: reaction,
      status: 'observed',
    });
    expect(
      normalizeDesignObservation({
        ...chrome(),
        nodes: [{ ...nodes[0], reactions: [reaction, reaction] }],
      }).interactions.map(item => item.id),
    ).toHaveLength(2);
    expect(
      new Set(
        normalizeDesignObservation({
          ...chrome(),
          nodes: [{ ...nodes[0], reactions: [reaction, reaction] }],
        }).interactions.map(item => item.id),
      ).size,
    ).toBe(2);
  });

  it('records malformed/duplicate entries and cannot accept complete evidence for them', () => {
    const raw = {
      ...chrome(),
      nodes: [nodes[0], nodes[0], null],
      tokens: [
        { ...token, variableCollectionId: 'c' },
        { ...token, variableCollectionId: 'c' },
      ],
      styles: { paints: 'wrong', texts: [], effects: [], grids: [] },
    };
    const observed = normalizeDesignObservation(raw);
    expect(observed.issues.map(item => item.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_ID', 'MALFORMED']),
    );
    expect(observed.raw).toEqual(raw);
    expect(() =>
      normalizeDesignObservation(raw, {
        evidenceVersion: 1,
        contentHash: observed.contentHash,
        capabilities: [{ name: 'tree', status: 'complete', count: 1 }],
        coherence: { status: 'unverified', atomic: false },
        sourceBinding: { status: 'unverified' },
      }),
    ).toThrow('DESIGN_OBSERVATION_CAPABILITY_MISMATCH');
  });

  it('enforces catalog and raw byte limits without claiming omitted values complete', () => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      tokens: Array.from({ length: 10_001 }, (_, index) => ({
        ...token,
        id: `v${index}`,
        variableCollectionId: 'c',
      })),
    });
    expect(observed.catalogs.variables).toHaveLength(10_000);
    expect(observed.capabilities.find(item => item.name === 'variables')?.status).toBe('partial');
    expect(observed.issues.some(item => item.code === 'LIMIT')).toBe(true);
    expect(() =>
      normalizeDesignObservation({ ...chrome(), tooLarge: 'x'.repeat(16 * 1024 * 1024) }),
    ).toThrow('DESIGN_OBSERVATION_JSON_INVALID');
  });

  it('does not mutate retained raw evidence when the input is changed later', () => {
    const raw = chrome();
    const observed = normalizeDesignObservation(raw);
    raw.tokens[0]!.valuesByMode.dark = 999;
    expect(observed.catalogs.variables[0]?.valuesByMode.dark).toBe(16);
  });

  it('distinguishes unavailable enumeration count from retained rows for partial, failed and unsupported APIs', () => {
    const raw = chrome();
    const original = normalizeDesignObservation(raw);
    for (const status of ['partial', 'failed', 'unsupported'] as const) {
      const observed = normalizeDesignObservation(raw, {
        evidenceVersion: 1,
        contentHash: original.contentHash,
        capabilities: [{ name: 'variables', status, count: null }],
        coherence: { status: 'unverified', atomic: false },
        sourceBinding: { status: 'unverified' },
      });
      expect(observed.capabilities.find(item => item.name === 'variables')).toMatchObject({
        status,
        count: null,
        retainedCount: 1,
      });
    }
    expect(original.capabilities.find(item => item.name === 'variables')).toMatchObject({
      status: 'partial',
      count: null,
      retainedCount: 1,
    });
  });

  it('accepts explicit empty node-capability proof but never infers proof from omitted fields', () => {
    const raw = { ...chrome(), nodes: [{ id: 'frame', type: 'FRAME' }] };
    const original = normalizeDesignObservation(raw);
    expect(original.capabilities.find(item => item.name === 'interactions')?.status).toBe(
      'unsupported',
    );
    const observed = normalizeDesignObservation(raw, {
      evidenceVersion: 1,
      contentHash: original.contentHash,
      capabilities: [{ name: 'interactions', status: 'empty', count: 0 }],
      coherence: { status: 'unverified', atomic: false },
      sourceBinding: { status: 'unverified' },
    });
    expect(observed.capabilities.find(item => item.name === 'interactions')?.status).toBe('empty');
  });

  it('leaves unknown reaction families and malformed resolved modes explicit', () => {
    const observed = normalizeDesignObservation({
      ...chrome(),
      nodes: [
        {
          ...nodes[0],
          resolvedVariableModes: { c: null },
          explicitVariableModes: { c: 'light' },
          reactions: [{ trigger: { type: 'FUTURE_TRIGGER' }, actions: [{ type: 'CLOSE' }] }],
        },
      ],
    });
    expect(observed.bindings[0]).toMatchObject({ status: 'unresolved', reason: 'MODE_UNOBSERVED' });
    expect(observed.interactions[0]?.status).toBe('unsupported');
    expect(observed.interactions[0]?.raw).toMatchObject({ trigger: { type: 'FUTURE_TRIGGER' } });
  });

  it('cannot prove malformed style catalogs complete or use mismatched capability counts', () => {
    const raw = {
      ...chrome(),
      styles: { paints: [{ id: 'p' }], texts: [], effects: [], grids: [] },
    };
    const observed = normalizeDesignObservation(raw);
    const evidence = {
      evidenceVersion: 1 as const,
      contentHash: observed.contentHash,
      capabilities: [{ name: 'paintStyles' as const, status: 'complete' as const, count: 1 }],
      coherence: { status: 'unverified' as const, atomic: false as const },
      sourceBinding: { status: 'unverified' as const },
    };
    expect(() => normalizeDesignObservation(raw, evidence)).toThrow(
      'DESIGN_OBSERVATION_CAPABILITY_MISMATCH',
    );
    expect(() =>
      normalizeDesignObservation(chrome(), {
        ...evidence,
        contentHash: normalizeDesignObservation(chrome()).contentHash,
        capabilities: [{ name: 'tree', status: 'complete', count: 2 }],
      }),
    ).toThrow('DESIGN_OBSERVATION_CAPABILITY_MISMATCH');
  });

  it('bounds aggregate alias resolution work across nodes, not just each alias chain', () => {
    const raw = {
      ...chrome(),
      tokens: Array.from({ length: 128 }, (_, index) => ({
        ...token,
        id: `alias${index}`,
        variableCollectionId: 'c',
        valuesByMode: {
          dark: index === 127 ? 42 : { type: 'VARIABLE_ALIAS', id: `alias${index + 1}` },
        },
      })),
      nodes: Array.from({ length: 2001 }, (_, index) => ({
        ...nodes[0],
        id: `node${index}`,
        boundVariables: { itemSpacing: 'alias0' },
      })),
    };
    const observed = normalizeDesignObservation(raw);
    expect(observed.bindings[0]?.value).toBe(42);
    expect(observed.bindings.at(-1)?.reason).toBe('ALIAS_LIMIT');
    expect(observed.issues.some(item => item.code === 'LIMIT' && item.scope === 'bindings')).toBe(
      true,
    );
  });
});
