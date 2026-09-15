import type {
  ApprovalRequirement,
  ConcurrencyRequirement,
  Effect,
  IdempotencyRequirement,
  PolicyInvocationContext,
  OperationPolicy,
  OperationPolicyRegistry,
} from '@sfp/shared';
import { PORTAL_TOOL_NAMES } from '@sfp/shared';

import { parseBatchOperations } from '../tools/batch.js';

type ParsedArgs = Readonly<Record<string, unknown>>;

const FIGMA_READ = Object.freeze({ type: 'figma-read' } as const);
const FIGMA_UI = Object.freeze({ type: 'figma-ui' } as const);
const FIGMA_LIBRARY_IMPORT = Object.freeze({ type: 'figma-library-import' } as const);

const network = (urlArg: string): Effect => Object.freeze({ type: 'network', urlArg });

const figmaWrite = (destructive = false, broad = false): Effect =>
  Object.freeze({ type: 'figma-write', destructive, broad });

const filesystemRead = (...pathArgs: string[]): Effect =>
  Object.freeze({ type: 'filesystem-read', pathArgs: Object.freeze(pathArgs) });

const filesystemWrite = (destructive: boolean, ...pathArgs: string[]): Effect =>
  Object.freeze({
    type: 'filesystem-write',
    pathArgs: Object.freeze(pathArgs),
    destructive,
  });

const hasResolvedOverwrite = (
  context: PolicyInvocationContext,
  pathArgs: readonly string[],
): boolean => pathArgs.some(pathArg => context.resolvedPaths?.[pathArg]?.overwrites === true);

const approvalForEffects = (effects: readonly Effect[]): ApprovalRequirement => {
  if (
    effects.some(
      effect =>
        effect.type === 'network' ||
        effect.type === 'native-process-run' ||
        effect.type === 'external-browser-read' ||
        effect.type === 'figma-library-import' ||
        (effect.type === 'figma-write' && (effect.destructive || effect.broad)) ||
        (effect.type === 'filesystem-write' && effect.destructive),
    )
  ) {
    return 'explicit-user';
  }
  return effects.some(effect => effect.type === 'figma-write' || effect.type === 'filesystem-write')
    ? 'client'
    : 'none';
};

const policy = (
  toolName: string,
  possibleEffects: readonly Effect[],
  effectsFor: OperationPolicy['effectsFor'],
  idempotencyFor: OperationPolicy['idempotencyFor'],
  concurrency: ConcurrencyRequirement,
  possibleIdempotency: IdempotencyRequirement,
): OperationPolicy =>
  Object.freeze({
    toolName,
    possibleEffects: Object.freeze([...possibleEffects]),
    possibleIdempotency,
    effectsFor,
    idempotencyFor,
    approvalFor: (effects: readonly Effect[]) => approvalForEffects(effects),
    concurrency,
  });

const staticPolicy = (
  toolName: string,
  effects: readonly Effect[],
  idempotency: IdempotencyRequirement,
  concurrency: ConcurrencyRequirement,
): OperationPolicy => {
  const immutableEffects = Object.freeze([...effects]);
  return policy(
    toolName,
    immutableEffects,
    () => immutableEffects,
    () => idempotency,
    concurrency,
    idempotency,
  );
};

const FIGMA_READ_TOOL_NAMES = [
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
  'portal_capture_read',
  'portal_capture_asset',
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
] as const;

const DESTRUCTIVE_WRITE_TOOL_NAMES = [
  'delete_nodes',
  'delete_style',
  'delete_variable',
  'delete_variable_collection',
  'ungroup_nodes',
  'delete_page',
  'remove_reactions',
  'delete_component_property',
  'detach_instance',
  'remove_animation_style',
  'remove_manual_keyframe_track',
] as const;

const BROAD_WRITE_TOOL_NAMES = ['find_replace_text', 'batch_rename_nodes'] as const;

const ORDINARY_WRITE_TOOL_NAMES = [
  'set_fills',
  'set_text',
  'set_text_properties',
  'set_text_range',
  'create_frame',
  'set_opacity',
  'set_visible',
  'rename_node',
  'set_annotations',
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
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'bind_variable_to_node',
  'bind_variable_to_paint',
  'rename_variable',
  'set_variable_code_syntax',
  'group_nodes',
  'reparent_nodes',
  'reorder_nodes',
  'add_page',
  'rename_page',
  'set_reactions',
  'set_instance_properties',
  'add_component_property',
  'bind_component_property',
  'edit_component_property',
  'import_svg',
  'create_ellipse',
  'create_component',
  'create_section',
  'combine_as_variants',
  'apply_animation_style',
  'apply_manual_keyframe_track',
  'set_timeline_duration',
] as const;

const readEntries = FIGMA_READ_TOOL_NAMES.map(
  name => [name, staticPolicy(name, [FIGMA_READ], 'safe-retry', 'parallel-read')] as const,
);

const ordinaryWriteEntries = ORDINARY_WRITE_TOOL_NAMES.map(
  name => [name, staticPolicy(name, [figmaWrite()], 'operation-id', 'file-write')] as const,
);

const destructiveWriteEntries = DESTRUCTIVE_WRITE_TOOL_NAMES.map(
  name => [name, staticPolicy(name, [figmaWrite(true)], 'operation-id', 'file-write')] as const,
);

const broadWriteEntries = BROAD_WRITE_TOOL_NAMES.map(
  name =>
    [name, staticPolicy(name, [figmaWrite(false, true)], 'operation-id', 'file-write')] as const,
);

const localReadPolicy = (
  name: string,
  figma: boolean,
  pathArgs: readonly string[] = ['rootDir'],
): OperationPolicy =>
  staticPolicy(
    name,
    figma ? [FIGMA_READ, filesystemRead(...pathArgs)] : [filesystemRead(...pathArgs)],
    'safe-retry',
    'parallel-read',
  );

const filesystemWriterPolicy = (
  name: string,
  pathArg: 'outDir' | 'outPath',
  idempotency: IdempotencyRequirement = 'operation-id',
  concurrency: ConcurrencyRequirement = 'file-write',
): OperationPolicy => {
  const possibleEffects = [FIGMA_READ, filesystemWrite(true, pathArg)] as const;
  return policy(
    name,
    possibleEffects,
    (_args, context) =>
      Object.freeze([
        FIGMA_READ,
        filesystemWrite(hasResolvedOverwrite(context, [pathArg]), pathArg),
      ]),
    () => idempotency,
    concurrency,
    idempotency,
  );
};

const importImagePolicy = policy(
  'import_image',
  [network('url'), figmaWrite()],
  (args: ParsedArgs) => {
    const write = figmaWrite();
    return typeof args.url === 'string' && args.url.trim() !== ''
      ? Object.freeze([network('url'), write])
      : Object.freeze([write]);
  },
  (args: ParsedArgs) =>
    typeof args.url === 'string' && args.url.trim() !== '' ? 'never-auto-retry' : 'operation-id',
  'file-write',
  'never-auto-retry',
);

const libraryImportPolicy = (toolName: 'create_instance' | 'swap_component'): OperationPolicy =>
  policy(
    toolName,
    [FIGMA_LIBRARY_IMPORT, figmaWrite()],
    (args: ParsedArgs) =>
      typeof args.componentKey === 'string' && args.componentKey.trim() !== ''
        ? Object.freeze([FIGMA_LIBRARY_IMPORT, figmaWrite()])
        : Object.freeze([figmaWrite()]),
    (args: ParsedArgs) =>
      typeof args.componentKey === 'string' && args.componentKey.trim() !== ''
        ? 'never-auto-retry'
        : 'operation-id',
    'file-write',
    'never-auto-retry',
  );

const mergeBatchEffects = (effects: readonly Effect[]): readonly Effect[] => {
  const nonWrites: Effect[] = [];
  const seen = new Set<string>();
  let destructive = false;
  for (const effect of effects) {
    if (effect.type === 'figma-write') {
      destructive ||= effect.destructive;
      continue;
    }
    const key = JSON.stringify(effect);
    if (!seen.has(key)) {
      seen.add(key);
      nonWrites.push(effect);
    }
  }
  return Object.freeze([...nonWrites, figmaWrite(destructive, true)]);
};

const idempotencyRank: Readonly<Record<IdempotencyRequirement, number>> = Object.freeze({
  'safe-retry': 0,
  'operation-id': 1,
  'never-auto-retry': 2,
});

const batchPolicy = policy(
  'batch',
  [FIGMA_LIBRARY_IMPORT, figmaWrite(false, true)],
  (args: ParsedArgs, context) =>
    mergeBatchEffects(
      parseBatchOperations(args).flatMap(operation =>
        operationPolicyFor(operation.tool).effectsFor(operation.params, context),
      ),
    ),
  (args: ParsedArgs) =>
    parseBatchOperations(args)
      .map(operation => operationPolicyFor(operation.tool).idempotencyFor(operation.params))
      .reduce((worst, current) =>
        idempotencyRank[current] > idempotencyRank[worst] ? current : worst,
      ),
  'file-write',
  'never-auto-retry',
);

const designDiffPolicy = policy(
  'design_diff',
  [FIGMA_READ, filesystemRead('rootDir'), filesystemWrite(true, 'snapshotPath')],
  (args: ParsedArgs, context) => {
    const overwrites = hasResolvedOverwrite(context, ['snapshotPath']);
    const writesSnapshot = args.update === true || !overwrites;
    return Object.freeze([
      FIGMA_READ,
      filesystemRead('rootDir'),
      ...(writesSnapshot
        ? [filesystemWrite(args.update === true && overwrites, 'snapshotPath')]
        : []),
    ]);
  },
  () => 'operation-id',
  'file-write',
  'operation-id',
);

const entries = [
  ...readEntries,
  ['analyze_project', localReadPolicy('analyze_project', false)],
  ['scan_components', localReadPolicy('scan_components', false)],
  ['component_map', localReadPolicy('component_map', true)],
  ['token_map', localReadPolicy('token_map', true, ['rootDir', 'tokenSource'])],
  ['icon_map', localReadPolicy('icon_map', true)],
  ['save_screenshots', filesystemWriterPolicy('save_screenshots', 'outDir')],
  ['save_image_fills', filesystemWriterPolicy('save_image_fills', 'outDir')],
  ['export_pdf', filesystemWriterPolicy('export_pdf', 'outPath')],
  [
    'export_video',
    filesystemWriterPolicy('export_video', 'outPath', 'never-auto-retry', 'exclusive-heavy'),
  ],
  ['design_diff', designDiffPolicy],
  [
    'export_frames_to_pdf',
    filesystemWriterPolicy('export_frames_to_pdf', 'outPath', 'operation-id', 'exclusive-heavy'),
  ],
  [
    'export_tokens',
    policy(
      'export_tokens',
      [FIGMA_READ, filesystemWrite(true, 'outPath')],
      (args, context) =>
        args.outPath === undefined
          ? [FIGMA_READ]
          : [FIGMA_READ, filesystemWrite(hasResolvedOverwrite(context, ['outPath']), 'outPath')],
      args => (args.outPath === undefined ? 'safe-retry' : 'operation-id'),
      'exclusive-heavy',
      'operation-id',
    ),
  ],
  [
    'doctor',
    policy(
      'doctor',
      [FIGMA_READ],
      args => (args.roundTrip === true ? [FIGMA_READ] : []),
      () => 'safe-retry',
      'parallel-read',
      'safe-retry',
    ),
  ],
  [
    'import_library_variable',
    staticPolicy('import_library_variable', [FIGMA_LIBRARY_IMPORT], 'operation-id', 'file-write'),
  ],
  ...ordinaryWriteEntries,
  ...destructiveWriteEntries,
  ...broadWriteEntries,
  ['create_instance', libraryImportPolicy('create_instance')],
  ['swap_component', libraryImportPolicy('swap_component')],
  ['navigate_to_page', staticPolicy('navigate_to_page', [FIGMA_UI], 'safe-retry', 'file-write')],
  ['import_image', importImagePolicy],
  ['batch', batchPolicy],
] as const satisfies readonly (readonly [string, OperationPolicy])[];

const createRegistry = (
  rows: readonly (readonly [string, OperationPolicy])[],
): OperationPolicyRegistry => {
  const registry: Record<string, OperationPolicy> = Object.create(null) as Record<
    string,
    OperationPolicy
  >;
  for (const [name, operationPolicy] of rows) {
    if (registry[name] !== undefined) throw new Error(`duplicate operation policy: ${name}`);
    if (operationPolicy.toolName !== name) {
      throw new Error(`operation policy name mismatch: ${name}`);
    }
    registry[name] = operationPolicy;
  }
  return Object.freeze(registry);
};

const portalEntries = PORTAL_TOOL_NAMES.map(name => {
  const effects: Effect[] =
    name === 'portal_status' ? [{ type: 'portal-state-read' }] : [{ type: 'portal-state-write' }];
  if (name === 'portal_plan' || name === 'portal_next')
    effects.push(filesystemRead('portalSources'));
  if (name === 'portal_apply') effects.push(filesystemWrite(true, 'portalTarget'));
  if (name === 'portal_validate')
    effects.push(
      { type: 'native-process-run', profileArg: 'profileId' },
      { type: 'external-browser-read', urlArg: 'plan.design.url', attachOnly: true },
      filesystemRead('portalSources'),
    );
  if (name === 'portal_cancel') effects.push({ type: 'owned-process-stop' });
  if (name === 'portal_plan') {
    const browser: Effect = {
      type: 'external-browser-read',
      urlArg: 'design.url',
      attachOnly: true,
    };
    return [
      name,
      policy(
        name,
        [...effects, browser, FIGMA_READ],
        (args, context) => {
          const design = args.design as { artifactPath?: string; freshness?: string } | undefined;
          return !design?.artifactPath || design.freshness === 'require-live'
            ? [...effects, context.portalCaptureSource === 'desktop' ? FIGMA_READ : browser]
            : effects;
        },
        () => 'operation-id',
        'exclusive-heavy',
        'operation-id',
      ),
    ] as const;
  }
  if (name === 'portal_validate')
    return [
      name,
      policy(
        name,
        [...effects, FIGMA_READ],
        (_args, context) =>
          context.portalCaptureSource === 'desktop'
            ? [...effects.filter(effect => effect.type !== 'external-browser-read'), FIGMA_READ]
            : effects,
        () => 'operation-id',
        'exclusive-heavy',
        'operation-id',
      ),
    ] as const;
  if (name === 'portal_resume') {
    const writes = filesystemWrite(true, 'portalTarget');
    return [
      name,
      policy(
        name,
        [...effects, filesystemRead('portalTarget'), writes],
        args =>
          args.reconcile === 'continue'
            ? [...effects, filesystemRead('portalTarget'), writes]
            : args.reconcile === 'inspect'
              ? [...effects, filesystemRead('portalTarget')]
              : effects,
        () => 'operation-id',
        'exclusive-heavy',
        'operation-id',
      ),
    ] as const;
  }
  return [
    name,
    staticPolicy(
      name,
      effects,
      name === 'portal_status' ? 'safe-retry' : 'operation-id',
      name === 'portal_status' ? 'parallel-read' : 'exclusive-heavy',
    ),
  ] as const;
});
export const OPERATION_POLICIES = createRegistry([...entries, ...portalEntries]);

/** Fail closed for an unregistered name; callers never synthesize policy from `kind`. */
export const operationPolicyFor = (toolName: string): OperationPolicy => {
  const found = OPERATION_POLICIES[toolName];
  if (found === undefined) throw new Error(`operation policy missing for ${toolName}`);
  return found;
};
