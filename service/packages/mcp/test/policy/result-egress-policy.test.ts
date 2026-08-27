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

describe('baseline result-egress policy authority', () => {
  it('has one complete classifier row for every baseline tool', () => {
    const names = ALL_TOOL_SPECS.map(tool => tool.name).toSorted();

    expect(names).toHaveLength(112);
    expect(Object.keys(RESULT_EGRESS_POLICIES).toSorted()).toEqual(names);
    for (const name of names) {
      const policy = RESULT_EGRESS_POLICIES[name]!;
      expect(typeof policy.possibleInputClasses).toBe('function');
      expect(typeof policy.classifyInput).toBe('function');
      expect(typeof policy.classifyResult).toBe('function');
      expect(typeof policy.redactResult).toBe('function');
      expect(policy.possibleResultClasses.length).toBeGreaterThan(0);
      expect(policy.possibleResultClasses.every(value => ALL_DATA_CLASSES.includes(value))).toBe(
        true,
      );
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

  it('redacts denied secret, image, and project-code fields while preserving result shape', () => {
    expect(
      resultEgressPolicyFor('list_files').redactResult(
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
      ),
    ).toEqual({
      files: [
        {
          fileKey: null,
          fileName: 'Fixture file',
          currentPage: { id: '1:1', name: 'Fixture page' },
        },
      ],
    });

    expect(
      resultEgressPolicyFor('get_screenshot').redactResult(
        { images: [{ nodeId: '1:2', format: 'PNG', base64: 'AA==' }] },
        ['public'],
      ),
    ).toEqual({ images: [{ nodeId: '1:2', format: 'PNG', base64: null }] });

    const redactedScan = resultEgressPolicyFor('scan_components').redactResult(scanFixture, [
      'public',
    ]) as typeof scanFixture;
    expect(redactedScan.components[0]!.filePath).toBe('[redacted]');
    expect(redactedScan.components[0]!.propNames).toEqual(['[redacted]']);
    expect(redactedScan.profile.rootDir).toBe('[redacted]');
    expect(redactedScan.profile.evidence).toEqual(['[redacted]']);
  });
});
