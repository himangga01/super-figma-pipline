import type { Effect, PolicyInvocationContext } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { OPERATION_POLICIES, operationPolicyFor } from '../../src/policy/operation-policy.js';
import { evaluateOperationPolicy } from '../../src/policy/policy-engine.js';
import { annotationsFor } from '../../src/tools/annotations.js';
import { BATCHABLE_TOOL_NAMES as POLICY_BATCHABLE_TOOL_NAMES } from '../../src/tools/batch.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

const BASELINE_TOOL_NAMES = [
  'ping',
  'get_selection',
  'get_document',
  'get_node',
  'get_nodes_info',
  'get_metadata',
  'get_pages',
  'search_nodes',
  'scan_text_nodes',
  'scan_nodes_by_types',
  'get_styles',
  'get_variable_defs',
  'get_local_components',
  'get_component_api',
  'get_viewport',
  'get_fonts',
  'get_annotations',
  'get_reactions',
  'get_motion_styles',
  'get_node_motion',
  'list_files',
  'get_design_context',
  'get_screenshot',
  'save_screenshots',
  'save_image_fills',
  'export_pdf',
  'export_video',
  'analyze_project',
  'scan_components',
  'component_map',
  'token_map',
  'icon_map',
  'design_diff',
  'set_fills',
  'set_text',
  'set_text_properties',
  'set_text_range',
  'create_frame',
  'set_opacity',
  'set_visible',
  'rename_node',
  'delete_nodes',
  'create_text',
  'create_rectangle',
  'set_corner_radius',
  'set_strokes',
  'move_nodes',
  'set_position',
  'resize_nodes',
  'set_auto_layout',
  'set_layout_props',
  'set_layout_grids',
  'set_blend_mode',
  'set_mask',
  'set_arc',
  'set_constraints',
  'rotate_nodes',
  'lock_nodes',
  'unlock_nodes',
  'clone_node',
  'set_effects',
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'update_paint_style',
  'update_text_style',
  'update_effect_style',
  'apply_style_to_node',
  'delete_style',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'bind_variable_to_node',
  'bind_variable_to_paint',
  'rename_variable',
  'set_variable_code_syntax',
  'delete_variable',
  'delete_variable_collection',
  'group_nodes',
  'ungroup_nodes',
  'reparent_nodes',
  'reorder_nodes',
  'find_replace_text',
  'batch_rename_nodes',
  'add_page',
  'delete_page',
  'rename_page',
  'navigate_to_page',
  'set_reactions',
  'remove_reactions',
  'swap_component',
  'set_instance_properties',
  'add_component_property',
  'bind_component_property',
  'edit_component_property',
  'delete_component_property',
  'detach_instance',
  'import_image',
  'import_svg',
  'create_ellipse',
  'create_component',
  'create_section',
  'create_instance',
  'combine_as_variants',
  'apply_animation_style',
  'remove_animation_style',
  'apply_manual_keyframe_track',
  'remove_manual_keyframe_track',
  'set_timeline_duration',
  'batch',
] as const;

const DESTRUCTIVE_TOOL_NAMES = [
  'delete_component_property',
  'delete_nodes',
  'delete_page',
  'delete_style',
  'delete_variable',
  'delete_variable_collection',
  'detach_instance',
  'remove_animation_style',
  'remove_manual_keyframe_track',
  'remove_reactions',
  'ungroup_nodes',
] as const;

const context: PolicyInvocationContext = {
  workspace: { workspaceId: null, workspaceRoot: null },
  resolvedPaths: {},
};

const workspaceContext: PolicyInvocationContext = {
  workspace: { workspaceId: 'workspace-1', workspaceRoot: 'C:/approved/project' },
  resolvedPaths: {
    outDir: { path: 'C:/approved/project/artifacts', overwrites: false },
    outPath: { path: 'C:/approved/project/artifacts/export.pdf', overwrites: false },
    rootDir: { path: 'C:/approved/project', overwrites: false },
  },
};

const effects = (
  name: string,
  args: Readonly<Record<string, unknown>>,
  ctx = context,
): Effect[] => [...operationPolicyFor(name).effectsFor(args, ctx)];

const types = (items: readonly Effect[]): string[] => items.map(effect => effect.type);

const spec = (name: string) => {
  const found = ALL_TOOL_SPECS.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`missing fixture spec: ${name}`);
  return found;
};

const parsedBatch = (
  ops: readonly Readonly<{ tool: string; params?: Readonly<Record<string, unknown>> }>[],
): Readonly<Record<string, unknown>> =>
  spec('batch').inputSchema.parse({ ops }) as Readonly<Record<string, unknown>>;

describe('baseline operation policy authority', () => {
  it('has exactly one named policy for each literal baseline tool', () => {
    expect(BASELINE_TOOL_NAMES).toHaveLength(112);
    expect(Object.keys(OPERATION_POLICIES).toSorted()).toEqual([...BASELINE_TOOL_NAMES].toSorted());
    expect(ALL_TOOL_SPECS.map(tool => tool.name)).toEqual([...BASELINE_TOOL_NAMES]);
    expect(
      Object.entries(OPERATION_POLICIES).filter(([name, policy]) => policy.toolName !== name),
    ).toEqual([]);
  });

  it('classifies import_image by its parsed source', () => {
    const schema = spec('import_image').inputSchema;
    for (const invalid of [
      {},
      { data: '', url: undefined },
      { data: '   ' },
      { url: '\t' },
      { data: '   ', url: 'https://assets.example.com/a.png' },
      { data: 'AA==', url: '\t' },
      { data: 'AA==', url: 'https://assets.example.com/a.png' },
    ]) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }

    const dataArgs = schema.parse({ data: '  AA==  ' }) as Readonly<Record<string, unknown>>;
    const urlArgs = schema.parse({
      url: '  https://assets.example.com/a.png  ',
    }) as Readonly<Record<string, unknown>>;
    expect(dataArgs).toMatchObject({ data: 'AA==' });
    expect(urlArgs).toMatchObject({ url: 'https://assets.example.com/a.png' });
    expect(types(effects('import_image', dataArgs))).toEqual(['figma-write']);
    expect(types(effects('import_image', urlArgs))).toEqual(['network', 'figma-write']);
  });

  it('classifies published component keys as library imports', () => {
    for (const [name, rawArgs] of [
      ['create_instance', { componentKey: '  published-component  ' }],
      ['swap_component', { instanceId: '1:2', componentKey: '  published-component  ' }],
    ] as const) {
      const schema = spec(name).inputSchema;
      expect(schema.safeParse({ ...rawArgs, componentKey: '   ' }).success).toBe(false);
      expect(schema.safeParse({ ...rawArgs, componentId: '1:3', componentKey: '\t' }).success).toBe(
        false,
      );
      const args = schema.parse(rawArgs) as Readonly<Record<string, unknown>>;
      expect(args.componentKey).toBe('published-component');
      const resolved = effects(name, args);
      expect(resolved).toEqual([
        { type: 'figma-library-import' },
        { type: 'figma-write', destructive: false, broad: false },
      ]);
      expect(operationPolicyFor(name).approvalFor(resolved, context)).toBe('explicit-user');
      expect(operationPolicyFor(name).idempotencyFor(args)).toBe('never-auto-retry');
      expect(annotationsFor(spec(name))).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }

    expect(types(effects('create_instance', { componentId: '1:3' }))).toEqual(['figma-write']);
    expect(types(effects('swap_component', { instanceId: '1:2', componentId: '1:3' }))).toEqual([
      'figma-write',
    ]);
  });

  it('unions parsed batch child effects and derives the worst retry requirement', () => {
    const libraryBatch = parsedBatch([
      { tool: 'set_opacity', params: { nodeId: '1:2', opacity: 0.5 } },
      { tool: 'create_instance', params: { componentKey: '  published-component  ' } },
    ]);
    const libraryEffects = effects('batch', libraryBatch);
    expect(libraryEffects).toEqual([
      { type: 'figma-library-import' },
      { type: 'figma-write', destructive: false, broad: true },
    ]);
    expect(operationPolicyFor('batch').idempotencyFor(libraryBatch)).toBe('never-auto-retry');
    expect(operationPolicyFor('batch').approvalFor(libraryEffects, context)).toBe('explicit-user');

    const networkBatch = parsedBatch([
      {
        tool: 'import_image',
        params: { url: 'https://assets.example.com/batch.png' },
      },
    ]);
    expect(effects('batch', networkBatch)).toEqual([
      { type: 'network', urlArg: 'url' },
      { type: 'figma-write', destructive: false, broad: true },
    ]);
    expect(operationPolicyFor('batch').idempotencyFor(networkBatch)).toBe('never-auto-retry');
    expect(annotationsFor(spec('batch')).openWorldHint).toBe(true);
  });

  it('rejects nested, unsupported, and malformed batch children before policy evaluation', () => {
    expect(
      spec('batch').inputSchema.safeParse({
        ops: [{ tool: 'batch', params: { ops: [{ tool: 'set_opacity', params: {} }] } }],
      }).success,
    ).toBe(false);
    expect(
      spec('batch').inputSchema.safeParse({
        ops: [{ tool: 'delete_nodes', params: { nodeIds: ['1:2'] } }],
      }).success,
    ).toBe(false);
    expect(
      spec('batch').inputSchema.safeParse({
        ops: [{ tool: 'set_opacity', params: { nodeId: '1:2' } }],
      }).success,
    ).toBe(false);
    expect(
      spec('batch').inputSchema.safeParse({ ops: [{ tool: 'set_opacity', params: null }] }).success,
    ).toBe(false);
    expect(
      spec('batch').inputSchema.safeParse({
        ops: [
          {
            tool: 'create_instance',
            params: { componentId: '1:3', componentKey: '   ' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('covers the plugin invertible batch allowlist exactly without admitting nested batch', () => {
    expect(POLICY_BATCHABLE_TOOL_NAMES).toHaveLength(30);
    expect(POLICY_BATCHABLE_TOOL_NAMES).not.toContain('batch');
    expect(POLICY_BATCHABLE_TOOL_NAMES).not.toContain('swap_component');
  });

  it('assigns the exact multi-effects to every baseline local tool', () => {
    const actual = Object.fromEntries(
      [
        'analyze_project',
        'scan_components',
        'component_map',
        'token_map',
        'icon_map',
        'save_screenshots',
        'save_image_fills',
        'export_pdf',
        'export_video',
        'design_diff',
      ].map(name => [name, types(effects(name, {}, workspaceContext))]),
    );

    expect(actual).toEqual({
      analyze_project: ['filesystem-read'],
      scan_components: ['filesystem-read'],
      component_map: ['figma-read', 'filesystem-read'],
      token_map: ['figma-read', 'filesystem-read'],
      icon_map: ['figma-read', 'filesystem-read'],
      save_screenshots: ['figma-read', 'filesystem-write'],
      save_image_fills: ['figma-read', 'filesystem-write'],
      export_pdf: ['figma-read', 'filesystem-write'],
      export_video: ['figma-read', 'filesystem-write'],
      design_diff: ['figma-read', 'filesystem-read', 'filesystem-write'],
    });
  });

  it('binds each filesystem effect to the literal parsed path arguments it consumes', () => {
    expect(
      effects('token_map', { rootDir: '.', tokenSource: 'tokens.css' }, workspaceContext),
    ).toContainEqual({
      type: 'filesystem-read',
      pathArgs: ['rootDir', 'tokenSource'],
    });
    expect(effects('save_screenshots', { outDir: 'artifacts' }, workspaceContext)).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['outDir'],
      destructive: false,
    });
    expect(effects('export_pdf', { outPath: 'artifact.pdf' }, workspaceContext)).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['outPath'],
      destructive: false,
    });
  });

  it('keeps navigation UI-only and gives every other baseline write a Figma document effect', () => {
    const writes = ALL_TOOL_SPECS.filter(tool => tool.kind === 'write');
    expect(writes).toHaveLength(79);
    expect(types(effects('navigate_to_page', { pageId: '1:2' }))).toEqual(['figma-ui']);

    const missingDocumentWrite = writes
      .filter(tool => tool.name !== 'navigate_to_page')
      .filter(tool => {
        const args =
          tool.name === 'batch'
            ? parsedBatch([{ tool: 'set_opacity', params: { nodeId: '1:2', opacity: 0.5 } }])
            : {};
        return !types(effects(tool.name, args)).includes('figma-write');
      })
      .map(tool => tool.name);
    expect(missingDocumentWrite).toEqual([]);
  });

  it('marks update and resolved overwrite targets as destructive filesystem writes', () => {
    const update = effects('design_diff', { update: true }, workspaceContext);
    expect(update).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['rootDir'],
      destructive: true,
    });

    const overwriteContext: PolicyInvocationContext = {
      ...workspaceContext,
      resolvedPaths: {
        ...workspaceContext.resolvedPaths,
        outPath: { path: 'C:/approved/project/artifacts/export.pdf', overwrites: true },
      },
    };
    expect(
      effects('export_pdf', { outPath: 'artifacts/export.pdf' }, overwriteContext),
    ).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['outPath'],
      destructive: true,
    });
  });

  it('classifies a new output conservatively when overwrite resolution is not present yet', () => {
    const unresolvedContext = {
      workspace: { workspaceId: 'workspace-1', workspaceRoot: 'C:/approved/project' },
    } as PolicyInvocationContext;

    expect(effects('export_pdf', { outPath: 'new.pdf' }, unresolvedContext)).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['outPath'],
      destructive: false,
    });
  });

  it('uses literal approval levels for reads, writes, overwrites, broad writes, and network', () => {
    expect(operationPolicyFor('get_node').approvalFor(effects('get_node', {}), context)).toBe(
      'none',
    );
    expect(
      operationPolicyFor('navigate_to_page').approvalFor(effects('navigate_to_page', {}), context),
    ).toBe('none');
    expect(operationPolicyFor('set_text').approvalFor(effects('set_text', {}), context)).toBe(
      'client',
    );
    expect(
      operationPolicyFor('export_pdf').approvalFor(
        effects('export_pdf', { outPath: 'new.pdf' }, workspaceContext),
        workspaceContext,
      ),
    ).toBe('client');
    const batchArgs = parsedBatch([
      { tool: 'set_opacity', params: { nodeId: '1:2', opacity: 0.5 } },
    ]);
    expect(operationPolicyFor('batch').approvalFor(effects('batch', batchArgs), context)).toBe(
      'explicit-user',
    );
    expect(
      operationPolicyFor('import_image').approvalFor(
        effects('import_image', { url: 'https://assets.example.com/a.png' }),
        context,
      ),
    ).toBe('explicit-user');

    for (const name of DESTRUCTIVE_TOOL_NAMES) {
      expect(operationPolicyFor(name).approvalFor(effects(name, {}), context)).toBe(
        'explicit-user',
      );
    }
  });

  it('declares retry and concurrency behavior without inferring it from tool kind', () => {
    expect(operationPolicyFor('get_node').idempotencyFor({})).toBe('safe-retry');
    expect(operationPolicyFor('navigate_to_page').idempotencyFor({ pageId: '1:2' })).toBe(
      'safe-retry',
    );
    expect(operationPolicyFor('set_text').idempotencyFor({ text: 'fixture' })).toBe('operation-id');
    expect(operationPolicyFor('import_image').idempotencyFor({ data: 'AA==' })).toBe(
      'operation-id',
    );
    expect(
      operationPolicyFor('import_image').idempotencyFor({
        url: 'https://assets.example.com/a.png',
      }),
    ).toBe('never-auto-retry');
    expect(operationPolicyFor('export_video').idempotencyFor({})).toBe('never-auto-retry');

    expect(operationPolicyFor('get_node').concurrency).toBe('parallel-read');
    expect(operationPolicyFor('set_text').concurrency).toBe('file-write');
    expect(operationPolicyFor('navigate_to_page').concurrency).toBe('file-write');
    expect(operationPolicyFor('export_video').concurrency).toBe('exclusive-heavy');
    expect(
      Object.values(OPERATION_POLICIES).filter(policy => policy.concurrency === 'exclusive-heavy'),
    ).toHaveLength(1);
  });

  it('requires an approved workspace for filesystem effects but not Figma-only calls', () => {
    expect(evaluateOperationPolicy('get_node', {}, context).effects).toEqual([
      { type: 'figma-read' },
    ]);
    expect(() => evaluateOperationPolicy('analyze_project', {}, context)).toThrowError(
      expect.objectContaining({ code: 'POLICY_WORKSPACE_REQUIRED' }),
    );
    expect(evaluateOperationPolicy('analyze_project', {}, workspaceContext).effects).toEqual([
      { type: 'filesystem-read', pathArgs: ['rootDir'] },
    ]);
  });
});

describe('conservative MCP annotations', () => {
  it('advertises the union of possible dynamic effects with all four MCP hints', () => {
    expect(annotationsFor(spec('get_node'))).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(annotationsFor(spec('navigate_to_page'))).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(annotationsFor(spec('design_diff'))).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(annotationsFor(spec('import_image'))).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(annotationsFor(spec('delete_nodes'))).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});
