import { ALL_DATA_CLASSES } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import {
  RESULT_EGRESS_POLICIES,
  resultEgressPolicyFor,
} from '../../src/policy/result-egress-policy.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

const scanFixture = {
  components: [
    {
      name: 'FixtureButton',
      filePath: 'src/components/FixtureButton.tsx',
      exportKind: 'named',
      propNames: ['label'],
      propsExtracted: true,
      framework: 'react',
    },
  ],
  profile: {
    rootDir: 'C:/approved/project',
    framework: 'react',
    language: 'ts',
    styling: { system: 'plain-css' },
    svg: { mode: 'url' },
    componentExtensions: ['.tsx'],
    evidence: ['package.json'],
  },
};

const schemaContainsProperty = (schema: unknown, property: string): boolean => {
  if (Array.isArray(schema)) return schema.some(value => schemaContainsProperty(value, property));
  if (typeof schema !== 'object' || schema === null) return false;
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (
    typeof properties === 'object' &&
    properties !== null &&
    Object.hasOwn(properties, property)
  ) {
    return true;
  }
  return Object.values(record).some(value => schemaContainsProperty(value, property));
};

describe('baseline result-egress policy authority', () => {
  it('has one complete classifier row for every baseline tool', () => {
    const names = ALL_TOOL_SPECS.map(tool => tool.name).toSorted();

    expect(names).toHaveLength(128);
    expect(Object.keys(RESULT_EGRESS_POLICIES).toSorted()).toEqual(names);
    for (const name of names) {
      const policy = RESULT_EGRESS_POLICIES[name]!;
      const input =
        name === 'batch'
          ? {
              ops: [{ tool: 'set_opacity', params: { nodeId: '1:2', opacity: 0.5 } }],
            }
          : {};
      expect(typeof policy.possibleInputClasses).toBe('function');
      expect(typeof policy.classifyInput).toBe('function');
      expect(typeof policy.classifyResult).toBe('function');
      expect(typeof policy.redactResult).toBe('function');
      expect(policy.possibleResultClasses.length).toBeGreaterThan(0);
      expect(policy.possibleResultClasses.every(value => ALL_DATA_CLASSES.includes(value))).toBe(
        true,
      );
      expect(Object.isFrozen(policy.possibleInputClasses(input))).toBe(true);
      expect(Object.isFrozen(policy.possibleResultClasses)).toBe(true);
    }
  });

  it('includes project-code in every result schema that can carry codeSyntax', () => {
    const codeSyntaxTools = ALL_TOOL_SPECS.filter(tool =>
      schemaContainsProperty(
        tool.resultSchema.toJSONSchema({ unrepresentable: 'any' }),
        'codeSyntax',
      ),
    ).map(tool => tool.name);

    expect(codeSyntaxTools).toEqual([
      'get_styles',
      'get_variable_defs',
      'get_design_context',
      'create_variable',
      'set_variable_value',
      'rename_variable',
      'set_variable_code_syntax',
      'delete_variable',
    ]);
    for (const name of codeSyntaxTools) {
      expect(resultEgressPolicyFor(name).possibleResultClasses).toContain('project-code');
    }
  });

  it('uses visual upper bounds for serialized design, style, variable, and motion results', () => {
    for (const name of [
      'get_selection',
      'get_document',
      'get_node',
      'get_nodes_info',
      'search_nodes',
      'scan_text_nodes',
      'scan_nodes_by_types',
      'get_styles',
      'get_variable_defs',
      'get_motion_styles',
      'get_node_motion',
    ]) {
      expect(resultEgressPolicyFor(name).possibleResultClasses).toContain('design-image');
    }
  });

  it('classifies literal public, design text, design image, and project code inputs', () => {
    expect(resultEgressPolicyFor('get_selection').classifyInput({}).classes).toEqual(['public']);
    expect(
      resultEgressPolicyFor('create_text').classifyInput({ text: 'fixture-copy' }).classes,
    ).toEqual(['design-text']);
    expect(resultEgressPolicyFor('import_image').classifyInput({ data: 'AA==' }).classes).toEqual([
      'design-image',
    ]);
    expect(
      resultEgressPolicyFor('scan_components').classifyInput({ rootDir: '.' }).classes,
    ).toEqual(['project-code']);
    expect(
      resultEgressPolicyFor('import_image').classifyInput({
        data: 'AA==',
        name: 'Fixture image',
      }).classes,
    ).toEqual(['design-text', 'design-image']);
  });

  it('classifies manual keyframe text and visual values from the parsed track', () => {
    const base = {
      nodeId: '1:2',
      field: { type: 'PROPERTY', name: 'OPACITY' },
    } as const;
    expect(
      resultEgressPolicyFor('apply_manual_keyframe_track').classifyInput({
        ...base,
        track: {
          keyframes: [{ timelinePosition: 0, value: { type: 'TEXT_DATA', value: 'Fixture copy' } }],
        },
      }).classes,
    ).toEqual(['design-text']);
    expect(
      resultEgressPolicyFor('apply_manual_keyframe_track').classifyInput({
        ...base,
        track: {
          keyframes: [
            {
              timelinePosition: 0,
              value: { type: 'COLOR', value: { r: 1, g: 0, b: 0, a: 1 } },
            },
          ],
        },
      }).classes,
    ).toEqual(['design-image']);
  });

  it('declares design context as text and image and classifies scan output as project code', () => {
    expect(resultEgressPolicyFor('get_design_context').possibleResultClasses).toEqual([
      'project-code',
      'design-text',
      'design-image',
    ]);
    expect(resultEgressPolicyFor('scan_components').classifyResult(scanFixture).classes).toEqual([
      'project-code',
    ]);
  });

  it('keeps optional project-code result classes conditional on actual fields', () => {
    expect(
      resultEgressPolicyFor('get_design_context').classifyResult({ nodes: [] }).classes,
    ).toEqual(['design-text', 'design-image']);
    expect(
      resultEgressPolicyFor('get_design_context').classifyResult({
        nodes: [],
        projectTokens: { '#ffffff': { ref: 'var(--surface)', name: 'surface' } },
      }).classes,
    ).toEqual(['project-code', 'design-text', 'design-image']);
    expect(
      resultEgressPolicyFor('create_variable').classifyResult({
        ok: true,
        variableId: 'Variable:1',
        name: 'surface',
      }).classes,
    ).toEqual(['design-text']);
    expect(
      resultEgressPolicyFor('create_variable').classifyResult({
        ok: true,
        variableId: 'Variable:1',
        name: 'surface',
        codeSyntax: { WEB: '--surface' },
      }).classes,
    ).toEqual(['project-code', 'design-text']);
  });

  it('finds nested codeSyntax and visual variable/style fields recursively', () => {
    expect(
      resultEgressPolicyFor('get_variable_defs').classifyResult({
        collections: [],
        variables: [
          {
            id: 'Variable:1',
            name: 'surface',
            key: 'published-key',
            resolvedType: 'COLOR',
            collectionId: 'Collection:1',
            valuesByMode: { light: { r: 1, g: 1, b: 1, a: 1, hex: '#ffffff' } },
            codeSyntax: { WEB: '--surface' },
          },
        ],
      }).classes,
    ).toEqual(['project-code', 'design-text', 'design-image']);

    expect(
      resultEgressPolicyFor('get_styles').classifyResult({
        paints: [],
        texts: [
          {
            id: 'Style:1',
            name: 'Heading',
            key: 'heading-key',
            description: 'Fixture heading',
            fontName: { family: 'Inter', style: 'Bold' },
            fontSize: 24,
            lineHeight: { unit: 'PIXELS', value: 28 },
            letterSpacing: { unit: 'PIXELS', value: 0 },
            textWrapStyle: 'BALANCE',
          },
        ],
        effects: [],
        grids: [],
      }).classes,
    ).toEqual(['design-text', 'design-image']);

    expect(
      resultEgressPolicyFor('get_styles').classifyResult({
        paints: [],
        texts: [],
        effects: [],
        grids: [],
        variables: {
          'Variable:1': {
            name: 'surface',
            type: 'COLOR',
            codeSyntax: { WEB: '--surface' },
          },
        },
      }).classes,
    ).toEqual(['project-code', 'design-text']);

    expect(
      resultEgressPolicyFor('get_design_context').classifyResult({
        nodes: [],
        variables: {
          'Variable:1': {
            name: 'surface',
            type: 'COLOR',
            codeSyntax: { WEB: '--surface' },
          },
        },
      }).classes,
    ).toEqual(['project-code', 'design-text', 'design-image']);
  });

  it('keeps every actual class inside its declared upper bound for all 127 policies', () => {
    const breaches = ALL_TOOL_SPECS.flatMap(tool => {
      const policy = resultEgressPolicyFor(tool.name);
      const actual = policy.classifyResult({}).classes;
      return actual
        .filter(dataClass => !policy.possibleResultClasses.includes(dataClass))
        .map(dataClass => `${tool.name}:${dataClass}`);
    });

    expect(breaches).toEqual([]);
  });

  it('classifies public mutation output and actual image and secret-bearing results exactly', () => {
    expect(
      resultEgressPolicyFor('set_opacity').classifyResult({ ok: true, nodeId: '1:2' }).classes,
    ).toEqual(['public']);
    expect(
      resultEgressPolicyFor('get_screenshot').classifyResult({
        images: [{ nodeId: '1:2', format: 'PNG', base64: 'AA==' }],
      }).classes,
    ).toEqual(['design-image']);
    expect(
      resultEgressPolicyFor('list_files').classifyResult({
        files: [
          {
            fileKey: 'fixture-file-key',
            fileName: 'Fixture file',
            currentPage: { id: '1:1', name: 'Fixture page' },
          },
        ],
      }).classes,
    ).toEqual(['design-text', 'secret']);
    expect(
      resultEgressPolicyFor('list_files').classifyResult({
        files: [
          {
            fileKey: null,
            fileName: 'Fixture file',
            currentPage: { id: '1:1', name: 'Fixture page' },
          },
        ],
      }).classes,
    ).toEqual(['design-text']);
  });

  it('reports byte/token metadata without retaining a second raw payload', () => {
    const args = { text: 'fixture-copy' } as const;
    const classified = resultEgressPolicyFor('create_text').classifyInput(args);

    expect(classified.value).toBe(args);
    expect(classified.bytes).toBe(Buffer.byteLength(JSON.stringify(args), 'utf8'));
    expect(classified.tokens).toBeGreaterThan(0);
  });

  it('fails closed with the denied actual class instead of returning partial invalid output', () => {
    const denials = [
      ['set_opacity', { ok: true, nodeId: '1:2' }, [], 'public'],
      ['scan_components', scanFixture, [], 'project-code'],
      [
        'list_files',
        {
          files: [
            {
              fileKey: null,
              fileName: 'Fixture file',
              currentPage: { id: '1:1', name: 'Fixture page' },
            },
          ],
        },
        [],
        'design-text',
      ],
      [
        'get_screenshot',
        { images: [{ nodeId: '1:2', format: 'PNG', base64: 'AA==' }] },
        [],
        'design-image',
      ],
      [
        'list_files',
        {
          files: [
            {
              fileKey: 'fixture-file-key',
              fileName: 'Fixture file',
              currentPage: { id: '1:1', name: 'Fixture page' },
            },
          ],
        },
        ['design-text'],
        'secret',
      ],
    ] as const;

    for (const [name, result, allowed, deniedClass] of denials) {
      expect(() => resultEgressPolicyFor(name).redactResult(result, allowed)).toThrowError(
        expect.objectContaining({ code: 'EGRESS_CLASS_NOT_ALLOWED', deniedClass }),
      );
    }
  });

  it('validates allow-all output while preserving typed arrays and valid design context', () => {
    const screenshot = {
      images: [
        {
          nodeId: '1:2',
          format: 'PNG',
          base64: null,
          bytes: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    };
    const allowedScreenshot = resultEgressPolicyFor('get_screenshot').redactResult(screenshot, [
      'public',
      'design-image',
    ]) as typeof screenshot;
    expect(allowedScreenshot).toEqual(screenshot);
    expect(allowedScreenshot.images[0]!.bytes).toBeInstanceOf(Uint8Array);

    const designContext = {
      nodes: [],
      variables: {
        'Variable:1': {
          name: 'surface',
          type: 'COLOR',
          codeSyntax: { WEB: '--surface' },
        },
      },
    };
    expect(
      resultEgressPolicyFor('get_design_context').redactResult(designContext, [
        'project-code',
        'design-text',
        'design-image',
      ]),
    ).toEqual(designContext);
  });

  it('rejects an invalid result even when every classified class is allowed', () => {
    expect(() =>
      resultEgressPolicyFor('get_screenshot').redactResult(
        {
          images: [{ nodeId: '1:2', format: 'PNG', base64: 'AA==' }],
          unexpected: true,
        },
        ['public', 'design-image'],
      ),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_RESULT_INVALID' }));
  });
});
