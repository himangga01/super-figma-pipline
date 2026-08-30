import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BATCHABLE_TOOL_NAMES as POLICY_BATCHABLE_TOOL_NAMES } from '../packages/mcp/src/tools/batch.js';
import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { SERVER_ONLY_TOOLS, TOOL_RUNTIMES } from '../packages/mcp/src/tools/runtime-registry.js';
import { BATCHABLE_TOOL_NAMES as PLUGIN_BATCHABLE_TOOL_NAMES } from '../packages/plugin/src/handlers/batch.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import {
  FIGMOSHA_FEATURE_MAP,
  RUST_TOOL_COMPAT,
  schemaContractJson,
  UNION_MANIFEST,
} from '../packages/shared/src/capability-manifest.js';
import { RESULT_SCHEMAS } from '../packages/shared/src/result-schemas.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[0-9a-f]{64}$/;

const BASELINE_SERVER_ONLY = [
  'analyze_project',
  'component_map',
  'design_diff',
  'icon_map',
  'save_screenshots',
  'scan_components',
  'token_map',
] as const;

const BASELINE_SERVER_ADAPTER_NAMES = [
  'ping',
  'get_screenshot',
  'get_design_context',
  'save_screenshots',
  'save_image_fills',
  'export_pdf',
  'export_video',
  'analyze_project',
  'scan_components',
  'component_map',
  'token_map',
  'icon_map',
  'import_image',
  'design_diff',
] as const;

const PLANNED_SAFE_UNION = [
  'doctor',
  'export_frames_to_pdf',
  'export_tokens',
  'import_library_variable',
] as const;

const EXPERIMENTAL_NATIVE = [
  'apply_animation_style',
  'apply_manual_keyframe_track',
  'export_video',
  'get_motion_styles',
  'get_node_motion',
  'remove_animation_style',
  'remove_manual_keyframe_track',
  'set_timeline_duration',
] as const;

describe('tool contract authorities', () => {
  it('keeps policy batch children equal to the plugin invertible allowlist', () => {
    expect([...POLICY_BATCHABLE_TOOL_NAMES].toSorted()).toEqual(
      [...PLUGIN_BATCHABLE_TOOL_NAMES].toSorted(),
    );
  });

  it('has one strict result schema and runtime for every baseline tool', () => {
    const names = ALL_TOOL_SPECS.map(spec => spec.name).toSorted();

    expect(names).toHaveLength(112);
    expect(Object.keys(RESULT_SCHEMAS).toSorted()).toEqual(names);
    expect(Object.keys(TOOL_RUNTIMES).toSorted()).toEqual(names);
    expect(
      Object.values(TOOL_RUNTIMES).filter(binding => binding.execution === 'server-adapter'),
    ).toHaveLength(14);

    for (const [name, schema] of Object.entries(RESULT_SCHEMAS)) {
      const jsonSchema = schema.toJSONSchema({ unrepresentable: 'any' });
      expect({
        name,
        type: jsonSchema.type,
        additionalProperties: jsonSchema.additionalProperties,
      }).toEqual({ name, type: 'object', additionalProperties: false });
    }
  });

  it('finalizes every raw spec with the canonical schema and exact authority ids', () => {
    for (const spec of ALL_TOOL_SPECS) {
      expect(spec.resultSchema).toBe(RESULT_SCHEMAS[spec.name]);
      expect(spec.runtimeId).toBe(`runtime:${spec.name}`);
      expect(spec.policyId).toBe(`tool:${spec.name}:v1`);
      expect(spec.handlerAuthority).toBe(
        SERVER_ONLY_TOOLS.has(spec.name) ? 'server-only' : 'plugin-handler',
      );
    }
  });

  it('derives the literal seven server-only tools while retaining 105 plugin handlers', () => {
    expect([...SERVER_ONLY_TOOLS].toSorted()).toEqual([...BASELINE_SERVER_ONLY]);
    expect(Object.keys(createSandboxHandlers({} as never))).toHaveLength(105);
  });

  it('keeps handler parity independent from the exact baseline execution adapters', () => {
    const grouped = Object.values(TOOL_RUNTIMES).reduce<Record<string, number>>(
      (counts, binding) => {
        counts[binding.execution] = (counts[binding.execution] ?? 0) + 1;
        return counts;
      },
      {},
    );

    expect(grouped).toEqual({ 'plugin-direct': 98, 'server-adapter': 14 });
    expect(
      Object.entries(TOOL_RUNTIMES)
        .filter(([, binding]) => binding.execution === 'server-adapter')
        .map(([name]) => name)
        .toSorted(),
    ).toEqual([...BASELINE_SERVER_ADAPTER_NAMES].toSorted());
  });

  it('binds exact baseline target requirements after strict args parsing', () => {
    const byName = Object.fromEntries(ALL_TOOL_SPECS.map(spec => [spec.name, spec]));
    const requirement = (name: string, args: unknown): unknown =>
      (
        byName[name] as unknown as {
          targetRequirementFor?: (parsed: unknown) => unknown;
        }
      )?.targetRequirementFor?.(args);

    expect(requirement('analyze_project', { rootDir: '.' })).toBe('forbidden');
    expect(requirement('scan_components', { rootDir: '.' })).toBe('forbidden');
    expect(requirement('ping', {})).toBe('optional');
    expect(requirement('get_selection', {})).toBe('required');
  });
});

describe('two-layer capability manifest', () => {
  it('materializes all canonical and source surfaces at their exact cardinalities', () => {
    expect(UNION_MANIFEST.schemaVersion).toBe(1);
    expect(UNION_MANIFEST.canonicalTools).toHaveLength(116);
    expect(UNION_MANIFEST.sourceSurfaces.lexicalTools).toHaveLength(114);
    expect(UNION_MANIFEST.sourceSurfaces.figmoshaHelpers).toHaveLength(20);
    expect(UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers).toHaveLength(12);

    expect(RUST_TOOL_COMPAT.tools).toEqual(UNION_MANIFEST.sourceSurfaces.lexicalTools);
    expect(FIGMOSHA_FEATURE_MAP.helpers).toEqual(UNION_MANIFEST.sourceSurfaces.figmoshaHelpers);
    expect(FIGMOSHA_FEATURE_MAP.cliParsers).toEqual(
      UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers,
    );
  });

  it('keeps only the four safe-union rows planned and every baseline row implemented', () => {
    const planned = UNION_MANIFEST.canonicalTools
      .filter(row => row.implementationStatus === 'planned')
      .map(row => row.name)
      .toSorted();
    const implemented = UNION_MANIFEST.canonicalTools.filter(
      row => row.implementationStatus === 'implemented',
    );

    expect(planned).toEqual([...PLANNED_SAFE_UNION]);
    expect(implemented).toHaveLength(112);
    expect(implemented.map(row => row.name).toSorted()).toEqual(
      ALL_TOOL_SPECS.map(spec => spec.name).toSorted(),
    );
  });

  it('marks exactly Motion seven plus video experimental-native and deferred-investment', () => {
    const experimental = UNION_MANIFEST.canonicalTools
      .filter(row => row.disposition === 'experimental-native')
      .map(row => row.name)
      .toSorted();

    expect(experimental).toEqual([...EXPERIMENTAL_NATIVE]);
    for (const name of EXPERIMENTAL_NATIVE) {
      const row = UNION_MANIFEST.canonicalTools.find(candidate => candidate.name === name);
      expect(row).toMatchObject({
        implementationStatus: 'implemented',
        investment: 'deferred',
        registration: 'advertised',
      });
    }
  });

  it('retains two source contracts for all 71 common names and one for unique names', () => {
    const common = UNION_MANIFEST.sourceSurfaces.lexicalTools.filter(
      row => row.sources.length === 2,
    );
    const unique = UNION_MANIFEST.sourceSurfaces.lexicalTools.filter(
      row => row.sources.length === 1,
    );

    expect(common).toHaveLength(71);
    expect(unique).toHaveLength(43);
    expect(
      Object.fromEntries(
        ['same', 'adapter', 'incompatible', 'unique'].map(compatibility => [
          compatibility,
          UNION_MANIFEST.sourceSurfaces.lexicalTools.filter(
            row => row.compatibility === compatibility,
          ).length,
        ]),
      ),
    ).toEqual({ same: 17, adapter: 43, incompatible: 11, unique: 43 });
    for (const row of common) {
      expect(row.sources).toEqual(['figma-mcp-rust', 'figwright']);
      expect(row.sourceContracts.map(contract => contract.source)).toEqual([
        'figma-mcp-rust',
        'figwright',
      ]);
      expect(row.sourceContracts).toHaveLength(2);
      expect(
        UNION_MANIFEST.canonicalTools.find(candidate => candidate.name === row.canonicalName)
          ?.sourceContracts,
      ).toEqual(row.sourceContracts);
    }
    for (const row of unique) {
      expect(row.sourceContracts).toHaveLength(1);
      expect(
        UNION_MANIFEST.canonicalTools.find(candidate => candidate.name === row.canonicalName)
          ?.sourceContracts,
      ).toEqual(row.sourceContracts);
    }
  });

  it('uses deterministic target schema hashes distinct from the retained source contracts', () => {
    for (const spec of ALL_TOOL_SPECS) {
      const row = UNION_MANIFEST.canonicalTools.find(candidate => candidate.name === spec.name);
      expect(row).toBeDefined();
      expect(row!.targetContractHash).toBe(
        sha256(schemaContractJson(spec.inputSchema, spec.resultSchema)),
      );
      expect(row!.sourceContracts.every(contract => hashPattern.test(contract.schemaHash))).toBe(
        true,
      );
      expect(row!.sourceContracts.map(contract => contract.schemaHash)).not.toContain(
        row!.targetContractHash,
      );
    }
  });

  it('rejects raw exec only in its source row and never exposes it canonically', () => {
    const execRows = UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers.filter(
      row => row.name === 'exec',
    );

    expect(execRows).toEqual([
      expect.objectContaining({ disposition: 'rejected', implementation: null }),
    ]);
    expect(
      [
        ...UNION_MANIFEST.sourceSurfaces.figmoshaHelpers,
        ...UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers,
      ].flatMap(row => (row.implementation === null ? [] : [row.implementation])),
    ).not.toContain('packages/cli/src/index.ts');
    expect(UNION_MANIFEST.canonicalTools.map(row => row.name)).not.toContain('exec');
  });

  it('maps 12 figmosha CLI parsers to exactly 11 behavior identities', () => {
    const parsers = UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers;
    const importComponent = parsers.find(row => row.name === 'import-component');
    const importComponentAlias = parsers.find(row => row.name === 'icomp');

    expect(new Set(parsers.map(row => row.mapping))).toHaveLength(11);
    expect(importComponentAlias?.mapping).toBe(importComponent?.mapping);
  });
});
