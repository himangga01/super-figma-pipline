import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BATCHABLE_TOOL_NAMES as POLICY_BATCHABLE_TOOL_NAMES } from '../packages/mcp/src/tools/batch.js';
import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { SERVER_ONLY_TOOLS, TOOL_RUNTIMES } from '../packages/mcp/src/tools/runtime-registry.js';
import { BATCHABLE_TOOL_NAMES as PLUGIN_BATCHABLE_TOOL_NAMES } from '../packages/plugin/src/handlers/batch.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import {
  FIGMOSHA_FEATURE_MAP,
  RUST_TOOL_COMPAT,
  UNION_MANIFEST,
} from '../packages/shared/src/capability-manifest.js';
import { PORTAL_TOOL_NAMES } from '../packages/shared/src/portal.js';
import { RESULT_SCHEMAS } from '../packages/shared/src/result-schemas.js';
import { SERVICE_LOCAL_TOOL_NAMES, SERVICE_SOURCE } from '../scripts/contracts-lib.mjs';

// Tool counts are derived, never restated. This file checks the registry against its own
// authorities and the committed capability manifest against its own provenance. Whether the two
// agree is the single drift check in contract-drift.test.ts, which names `pnpm contracts:update`.

const hashPattern = /^[0-9a-f]{64}$/;
const sorted = (values: Iterable<string>): string[] => [...values].toSorted();
const registeredNames = (): string[] => sorted(ALL_TOOL_SPECS.map(spec => spec.name));

const BASELINE_SERVER_ONLY = [
  ...PORTAL_TOOL_NAMES,
  'analyze_project',
  'component_map',
  'design_diff',
  'doctor',
  'export_frames_to_pdf',
  'export_tokens',
  'icon_map',
  'save_screenshots',
  'scan_components',
  'token_map',
] as const;

const BASELINE_SERVER_ADAPTER_NAMES: readonly string[] = [
  ...PORTAL_TOOL_NAMES,
  'doctor',
  'export_frames_to_pdf',
  'export_tokens',
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
];

const SAFE_UNION_IMPLEMENTATIONS = {
  doctor: 'packages/mcp/src/tools/safe-union.ts',
  export_frames_to_pdf: 'packages/mcp/src/tools/safe-union.ts',
  export_tokens: 'packages/mcp/src/tools/safe-union.ts',
  import_library_variable: 'packages/plugin/src/handlers/import-library-variable.ts',
} as const;

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

const runtimeNames = (execution: string): string[] =>
  sorted(
    Object.entries(TOOL_RUNTIMES)
      .filter(([, binding]) => binding.execution === execution)
      .map(([name]) => name),
  );

describe('tool contract authorities', () => {
  it('keeps policy batch children equal to the plugin invertible allowlist', () => {
    expect([...POLICY_BATCHABLE_TOOL_NAMES].toSorted()).toEqual(
      [...PLUGIN_BATCHABLE_TOOL_NAMES].toSorted(),
    );
  });

  it('has one strict result schema and runtime for every registered tool', () => {
    const names = registeredNames();

    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(RESULT_SCHEMAS).toSorted()).toEqual(names);
    expect(Object.keys(TOOL_RUNTIMES).toSorted()).toEqual(names);

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

  it('derives the server-only tools and one plugin handler for every other tool', () => {
    expect(sorted(SERVER_ONLY_TOOLS)).toEqual(sorted(BASELINE_SERVER_ONLY));
    expect(sorted(Object.keys(createSandboxHandlers({} as never)))).toEqual(
      registeredNames().filter(name => !SERVER_ONLY_TOOLS.has(name)),
    );
  });

  it('keeps handler parity independent from the exact baseline execution adapters', () => {
    expect(new Set(Object.values(TOOL_RUNTIMES).map(binding => binding.execution))).toEqual(
      new Set(['plugin-direct', 'server-adapter']),
    );
    expect(runtimeNames('server-adapter')).toEqual(sorted(BASELINE_SERVER_ADAPTER_NAMES));
    expect(runtimeNames('plugin-direct')).toEqual(
      registeredNames().filter(name => !BASELINE_SERVER_ADAPTER_NAMES.includes(name)),
    );
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
  it('points every declared implementation and test to an existing source file', () => {
    const rows = [
      ...UNION_MANIFEST.canonicalTools,
      ...UNION_MANIFEST.sourceSurfaces.figmoshaHelpers,
      ...UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers,
    ];
    for (const row of rows) {
      for (const path of [row.implementation, row.test]) {
        if (path === null) continue;
        expect(existsSync(new URL(`../${path}`, import.meta.url)), `${row.name}: ${path}`).toBe(
          true,
        );
      }
    }
  });

  it('materializes the pinned source surfaces at their exact cardinalities', () => {
    // These count frozen upstream inventories at their pinned commits, not the tool registry.
    expect(UNION_MANIFEST.schemaVersion).toBe(1);
    expect(UNION_MANIFEST.sourceSurfaces.lexicalTools).toHaveLength(114);
    expect(UNION_MANIFEST.sourceSurfaces.figmoshaHelpers).toHaveLength(20);
    expect(UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers).toHaveLength(12);

    expect(RUST_TOOL_COMPAT.tools).toEqual(UNION_MANIFEST.sourceSurfaces.lexicalTools);
    expect(FIGMOSHA_FEATURE_MAP.helpers).toEqual(UNION_MANIFEST.sourceSurfaces.figmoshaHelpers);
    expect(FIGMOSHA_FEATURE_MAP.cliParsers).toEqual(
      UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers,
    );
  });

  it('is the upstream canonical catalog plus the explicitly declared service-local tools', () => {
    const surfaces = UNION_MANIFEST.sourceSurfaces;
    const upstreamSources = new Set([
      ...surfaces.lexicalTools.flatMap(row => row.sources),
      ...surfaces.figmoshaHelpers.map(row => row.source),
      ...surfaces.figmoshaCliParsers.map(row => row.source),
    ]);
    const rows = UNION_MANIFEST.canonicalTools;
    const provenance = (row: (typeof rows)[number]): string =>
      row.sourceContracts.every(contract => upstreamSources.has(contract.source))
        ? 'upstream'
        : row.sourceContracts.every(contract => contract.source === SERVICE_SOURCE)
          ? 'service'
          : 'mixed';
    const upstream = rows.filter(row => provenance(row) === 'upstream').map(row => row.name);
    const service = rows.filter(row => provenance(row) === 'service').map(row => row.name);
    // The canonical catalog is every upstream-sourced tool plus the portal contract; the only
    // other rows are the service-local tools declared in scripts/contracts-lib.mjs.
    const catalog = [...upstream, ...PORTAL_TOOL_NAMES];

    expect(rows.filter(row => provenance(row) === 'mixed').map(row => row.name)).toEqual([]);
    expect(sorted(service)).toEqual(sorted([...PORTAL_TOOL_NAMES, ...SERVICE_LOCAL_TOOL_NAMES]));
    expect(sorted(rows.map(row => row.name))).toEqual(
      sorted([...catalog, ...SERVICE_LOCAL_TOOL_NAMES]),
    );
    expect(new Set([...catalog, ...SERVICE_LOCAL_TOOL_NAMES]).size).toBe(rows.length);
    // Every upstream lexical tool reaches the catalog, and none is relabelled as service-local.
    expect(surfaces.lexicalTools.filter(row => !upstream.includes(row.canonicalName))).toEqual([]);
    expect(
      surfaces.lexicalTools.filter(row =>
        (SERVICE_LOCAL_TOOL_NAMES as readonly string[]).includes(row.canonicalName),
      ),
    ).toEqual([]);
  });

  it('records each service-local tool as an honest service-native row', () => {
    for (const name of SERVICE_LOCAL_TOOL_NAMES) {
      const row = UNION_MANIFEST.canonicalTools.find(candidate => candidate.name === name);
      expect(row).toMatchObject({
        name,
        disposition: 'native',
        registration: 'advertised',
        implementationStatus: 'implemented',
        policyId: `tool:${name}:v1`,
      });
      // Its only source contract is the service's own schema; no upstream contract is invented.
      expect(row!.sourceContracts).toEqual([
        { source: SERVICE_SOURCE, schemaHash: expect.stringMatching(hashPattern) },
      ]);
      expect(row!.sourceRefs.every(ref => ref.startsWith(`${SERVICE_SOURCE}:`))).toBe(true);
    }
  });

  it('implements every canonical tool including the four safe-union tools', () => {
    const rows = UNION_MANIFEST.canonicalTools;

    expect(rows.filter(row => row.implementationStatus !== 'implemented')).toEqual([]);
    for (const [name, implementation] of Object.entries(SAFE_UNION_IMPLEMENTATIONS)) {
      expect(rows.find(row => row.name === name)).toMatchObject({
        implementationStatus: 'implemented',
        implementation,
      });
    }
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

  it('keeps target schema hashes well-formed and distinct from the retained source contracts', () => {
    // Whether each target hash matches the registry schema is the drift check's job: it
    // regenerates every row, so a stale hash fails there exactly once.
    for (const row of UNION_MANIFEST.canonicalTools) {
      expect({ name: row.name, targetContractHash: row.targetContractHash }).toEqual({
        name: row.name,
        targetContractHash: expect.stringMatching(hashPattern),
      });
      expect(row.sourceContracts.every(contract => hashPattern.test(contract.schemaHash))).toBe(
        true,
      );
      expect(row.sourceContracts.map(contract => contract.schemaHash)).not.toContain(
        row.targetContractHash,
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
