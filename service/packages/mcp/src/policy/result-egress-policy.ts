import {
  ALL_DATA_CLASSES,
  PORTAL_TOOL_NAMES,
  EgressPolicyError,
  type ClassifiedPayload,
  type DataClass,
  type ResultEgressPolicy,
  type ResultEgressPolicyRegistry,
} from '@sfp/shared';

import { RESULT_SCHEMAS } from '../../../shared/src/result-schemas.js';
import { parseBatchOperations } from '../tools/batch.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

const frozenClasses = <T extends readonly DataClass[]>(...classes: T): Readonly<T> =>
  Object.freeze(classes);

const PUBLIC = frozenClasses('public');
const PROJECT_CODE = frozenClasses('project-code');
const DESIGN_TEXT = frozenClasses('design-text');
const DESIGN_IMAGE = frozenClasses('design-image');
const DESIGN_TEXT_AND_IMAGE = frozenClasses('design-text', 'design-image');
const PROJECT_AND_DESIGN_TEXT = frozenClasses('project-code', 'design-text');
const PROJECT_DESIGN_TEXT_AND_IMAGE = frozenClasses('project-code', 'design-text', 'design-image');

/** Literal upper bounds. Each baseline name owns one row even when rows share pure classifiers. */
const POSSIBLE_RESULT_CLASSES = Object.freeze({
  ...Object.fromEntries(
    PORTAL_TOOL_NAMES.map(name => [
      name,
      name === 'portal_next' ? PROJECT_DESIGN_TEXT_AND_IMAGE : PROJECT_AND_DESIGN_TEXT,
    ]),
  ),
  export_tokens: PROJECT_AND_DESIGN_TEXT,
  export_frames_to_pdf: PROJECT_CODE,
  doctor: PUBLIC,
  import_library_variable: DESIGN_TEXT,
  ping: frozenClasses('public', 'design-text', 'secret'),
  get_selection: DESIGN_TEXT_AND_IMAGE,
  get_document: DESIGN_TEXT_AND_IMAGE,
  get_node: DESIGN_TEXT_AND_IMAGE,
  get_nodes_info: DESIGN_TEXT_AND_IMAGE,
  get_metadata: DESIGN_TEXT,
  get_pages: DESIGN_TEXT,
  search_nodes: DESIGN_TEXT_AND_IMAGE,
  scan_text_nodes: DESIGN_TEXT_AND_IMAGE,
  scan_nodes_by_types: DESIGN_TEXT_AND_IMAGE,
  get_styles: PROJECT_DESIGN_TEXT_AND_IMAGE,
  get_variable_defs: PROJECT_DESIGN_TEXT_AND_IMAGE,
  portal_capture_read: PROJECT_DESIGN_TEXT_AND_IMAGE,
  portal_capture_asset: DESIGN_IMAGE,
  get_local_components: DESIGN_TEXT,
  get_component_api: DESIGN_TEXT,
  get_viewport: DESIGN_TEXT,
  get_fonts: DESIGN_TEXT,
  get_annotations: DESIGN_TEXT,
  get_reactions: DESIGN_TEXT,
  get_motion_styles: DESIGN_TEXT_AND_IMAGE,
  get_node_motion: DESIGN_TEXT_AND_IMAGE,
  list_files: frozenClasses('design-text', 'secret'),
  get_design_context: PROJECT_DESIGN_TEXT_AND_IMAGE,
  get_screenshot: frozenClasses('public', 'design-image'),
  save_screenshots: PROJECT_CODE,
  save_image_fills: PROJECT_CODE,
  export_pdf: PROJECT_CODE,
  export_video: PROJECT_CODE,
  analyze_project: PROJECT_CODE,
  scan_components: PROJECT_CODE,
  component_map: PROJECT_AND_DESIGN_TEXT,
  token_map: PROJECT_AND_DESIGN_TEXT,
  icon_map: PROJECT_AND_DESIGN_TEXT,
  design_diff: PROJECT_AND_DESIGN_TEXT,
  set_fills: PUBLIC,
  set_text: PUBLIC,
  set_text_properties: PUBLIC,
  set_text_range: PUBLIC,
  create_frame: DESIGN_TEXT,
  set_opacity: PUBLIC,
  set_visible: PUBLIC,
  rename_node: PUBLIC,
  set_annotations: PUBLIC,
  delete_nodes: PUBLIC,
  create_text: DESIGN_TEXT,
  create_rectangle: DESIGN_TEXT,
  set_corner_radius: PUBLIC,
  set_strokes: PUBLIC,
  move_nodes: PUBLIC,
  set_position: PUBLIC,
  resize_nodes: PUBLIC,
  set_auto_layout: PUBLIC,
  set_layout_props: PUBLIC,
  set_layout_grids: PUBLIC,
  set_blend_mode: PUBLIC,
  set_mask: PUBLIC,
  set_arc: PUBLIC,
  set_constraints: PUBLIC,
  rotate_nodes: PUBLIC,
  lock_nodes: PUBLIC,
  unlock_nodes: PUBLIC,
  clone_node: DESIGN_TEXT,
  set_effects: PUBLIC,
  create_paint_style: DESIGN_TEXT,
  create_text_style: DESIGN_TEXT,
  create_effect_style: DESIGN_TEXT,
  create_grid_style: DESIGN_TEXT,
  update_paint_style: DESIGN_TEXT,
  update_text_style: DESIGN_TEXT,
  update_effect_style: DESIGN_TEXT,
  apply_style_to_node: PUBLIC,
  delete_style: DESIGN_TEXT,
  create_variable_collection: DESIGN_TEXT,
  add_variable_mode: DESIGN_TEXT,
  create_variable: PROJECT_AND_DESIGN_TEXT,
  set_variable_value: PROJECT_AND_DESIGN_TEXT,
  bind_variable_to_node: PUBLIC,
  bind_variable_to_paint: PUBLIC,
  rename_variable: PROJECT_AND_DESIGN_TEXT,
  set_variable_code_syntax: PROJECT_AND_DESIGN_TEXT,
  delete_variable: PROJECT_AND_DESIGN_TEXT,
  delete_variable_collection: DESIGN_TEXT,
  group_nodes: DESIGN_TEXT,
  ungroup_nodes: PUBLIC,
  reparent_nodes: PUBLIC,
  reorder_nodes: PUBLIC,
  find_replace_text: PUBLIC,
  batch_rename_nodes: PUBLIC,
  add_page: DESIGN_TEXT,
  delete_page: PUBLIC,
  rename_page: PUBLIC,
  navigate_to_page: PUBLIC,
  set_reactions: PUBLIC,
  remove_reactions: PUBLIC,
  swap_component: PUBLIC,
  set_instance_properties: PUBLIC,
  add_component_property: DESIGN_TEXT,
  bind_component_property: PUBLIC,
  edit_component_property: DESIGN_TEXT,
  delete_component_property: DESIGN_TEXT,
  detach_instance: DESIGN_TEXT,
  import_image: DESIGN_TEXT,
  import_svg: DESIGN_TEXT,
  create_ellipse: DESIGN_TEXT,
  create_component: DESIGN_TEXT,
  create_section: DESIGN_TEXT,
  create_instance: DESIGN_TEXT,
  combine_as_variants: DESIGN_TEXT,
  apply_animation_style: PUBLIC,
  remove_animation_style: PUBLIC,
  apply_manual_keyframe_track: PUBLIC,
  remove_manual_keyframe_track: PUBLIC,
  set_timeline_duration: PUBLIC,
  batch: frozenClasses('public', 'project-code', 'design-text', 'design-image'),
} as const satisfies Readonly<Record<string, readonly DataClass[]>>);

const PROJECT_CODE_INPUTS = new Set([
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
  'set_variable_code_syntax',
]);

const DESIGN_TEXT_INPUTS = new Set([
  'set_text',
  'set_text_properties',
  'set_text_range',
  'create_frame',
  'rename_node',
  'set_annotations',
  'create_text',
  'create_rectangle',
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'update_paint_style',
  'update_text_style',
  'update_effect_style',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'rename_variable',
  'group_nodes',
  'find_replace_text',
  'batch_rename_nodes',
  'add_page',
  'rename_page',
  'set_reactions',
  'set_instance_properties',
  'add_component_property',
  'edit_component_property',
  'create_ellipse',
  'create_component',
  'create_section',
  'create_instance',
  'combine_as_variants',
]);

const DESIGN_IMAGE_INPUTS = new Set(['set_fills', 'set_strokes', 'set_effects']);

const VARIABLE_RESULT_NAMES = new Set([
  'create_variable',
  'set_variable_value',
  'rename_variable',
  'set_variable_code_syntax',
  'delete_variable',
]);

const canonicalClasses = (classes: readonly DataClass[]): readonly DataClass[] =>
  Object.freeze(ALL_DATA_CLASSES.filter(dataClass => classes.includes(dataClass)));

const nonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';

const collectKeyframeInputClasses = (value: unknown, classes: Set<DataClass>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyframeInputClasses(item, classes);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (record.type === 'TEXT_DATA') classes.add('design-text');
  if (
    ['COLOR', 'VECTOR', 'CIRCLE', 'LINE', 'CIRCLE_POINT', 'COLOR_POINT'].includes(
      String(record.type),
    )
  ) {
    classes.add('design-image');
  }
  for (const child of Object.values(record)) collectKeyframeInputClasses(child, classes);
};

const possibleInputClassesFor = (toolName: string, args: UnknownRecord): readonly DataClass[] => {
  if (PORTAL_TOOL_NAMES.some(name => name === toolName))
    return toolName === 'portal_submit' ? PROJECT_DESIGN_TEXT_AND_IMAGE : PROJECT_AND_DESIGN_TEXT;
  if (toolName === 'import_image') {
    const classes: DataClass[] = [];
    if (nonEmptyString(args.name)) classes.push('design-text');
    if (nonEmptyString(args.data) || nonEmptyString(args.url)) classes.push('design-image');
    return classes.length === 0 ? PUBLIC : canonicalClasses(classes);
  }
  if (toolName === 'import_svg') {
    return nonEmptyString(args.name)
      ? canonicalClasses(['design-text', 'design-image'])
      : DESIGN_IMAGE;
  }
  if (toolName === 'batch') {
    return canonicalClasses(
      parseBatchOperations(args).flatMap(operation =>
        resultEgressPolicyFor(operation.tool).possibleInputClasses(operation.params),
      ),
    );
  }
  if (toolName === 'apply_manual_keyframe_track') {
    const classes = new Set<DataClass>();
    collectKeyframeInputClasses(args.track, classes);
    return classes.size === 0 ? PUBLIC : canonicalClasses([...classes]);
  }
  if (PROJECT_CODE_INPUTS.has(toolName)) return PROJECT_CODE;
  if (DESIGN_TEXT_INPUTS.has(toolName)) return DESIGN_TEXT;
  if (DESIGN_IMAGE_INPUTS.has(toolName)) return DESIGN_IMAGE;
  return PUBLIC;
};

const serializedMetrics = (value: unknown): { bytes: number; tokens: number } => {
  const serialized = JSON.stringify(value) ?? 'null';
  const bytes = Buffer.byteLength(serialized, 'utf8');
  return { bytes, tokens: Math.max(1, Math.ceil(bytes / 4)) };
};

const classified = <T>(value: T, classes: readonly DataClass[]): ClassifiedPayload<T> =>
  Object.freeze({ value, classes: canonicalClasses(classes), ...serializedMetrics(value) });

const containsNonNullKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) return value.some(item => containsNonNullKey(item, key));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined) return true;
  return Object.values(record).some(item => containsNonNullKey(item, key));
};

const containsColorLikeValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsColorLikeValue);
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.r === 'number' &&
    typeof record.g === 'number' &&
    typeof record.b === 'number'
  ) {
    return true;
  }
  return Object.values(record).some(containsColorLikeValue);
};

const hasNonEmptyArray = (value: unknown, keys: readonly string[]): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.some(key => Array.isArray(record[key]) && record[key].length > 0);
};

const SERIALIZED_VISUAL_RESULT_NAMES = new Set([
  'get_selection',
  'get_document',
  'get_node',
  'get_nodes_info',
  'search_nodes',
  'scan_text_nodes',
  'scan_nodes_by_types',
]);

const actualResultClassesFor = (
  toolName: string,
  result: unknown,
  possible: readonly DataClass[],
): readonly DataClass[] => {
  if (toolName === 'ping' || toolName === 'list_files') {
    return canonicalClasses(
      containsNonNullKey(result, 'fileKey')
        ? possible
        : possible.filter(dataClass => dataClass !== 'secret'),
    );
  }
  if (toolName === 'get_screenshot') {
    return containsNonNullKey(result, 'base64') || containsNonNullKey(result, 'bytes')
      ? DESIGN_IMAGE
      : PUBLIC;
  }
  if (SERIALIZED_VISUAL_RESULT_NAMES.has(toolName)) return DESIGN_TEXT_AND_IMAGE;
  if (toolName === 'get_styles') {
    const classes: DataClass[] = ['design-text'];
    if (containsNonNullKey(result, 'codeSyntax')) classes.push('project-code');
    if (hasNonEmptyArray(result, ['paints', 'texts', 'effects', 'grids'])) {
      classes.push('design-image');
    }
    return canonicalClasses(classes);
  }
  if (toolName === 'get_variable_defs') {
    const classes: DataClass[] = ['design-text'];
    if (containsNonNullKey(result, 'codeSyntax')) classes.push('project-code');
    if (containsColorLikeValue(result)) classes.push('design-image');
    return canonicalClasses(classes);
  }
  if (toolName === 'get_motion_styles' || toolName === 'get_node_motion') {
    return DESIGN_TEXT_AND_IMAGE;
  }
  if (toolName === 'get_design_context') {
    return containsNonNullKey(result, 'projectTokens') || containsNonNullKey(result, 'codeSyntax')
      ? canonicalClasses(['project-code', 'design-text', 'design-image'])
      : DESIGN_TEXT_AND_IMAGE;
  }
  if (VARIABLE_RESULT_NAMES.has(toolName)) {
    return containsNonNullKey(result, 'codeSyntax')
      ? canonicalClasses(['project-code', 'design-text'])
      : DESIGN_TEXT;
  }
  return possible;
};

const createPolicy = (
  toolName: string,
  possibleResultClasses: readonly DataClass[],
): ResultEgressPolicy<UnknownRecord, UnknownRecord> => {
  const possible = canonicalClasses(possibleResultClasses);
  return Object.freeze({
    possibleInputClasses: (args: UnknownRecord) => possibleInputClassesFor(toolName, args),
    possibleResultClasses: possible,
    classifyInput: (args: UnknownRecord) =>
      classified(args, possibleInputClassesFor(toolName, args)),
    classifyResult: (result: UnknownRecord) =>
      classified(result, actualResultClassesFor(toolName, result, possible)),
    redactResult: (result: UnknownRecord, allowed: readonly DataClass[]) => {
      const deniedClass = actualResultClassesFor(toolName, result, possible).find(
        dataClass => !allowed.includes(dataClass),
      );
      if (deniedClass !== undefined) {
        throw new EgressPolicyError(
          'EGRESS_CLASS_NOT_ALLOWED',
          `result egress does not allow ${deniedClass}`,
          { deniedClass },
        );
      }
      const parsed = RESULT_SCHEMAS[toolName]?.safeParse(result);
      if (parsed === undefined || !parsed.success) {
        throw new EgressPolicyError(
          'EGRESS_RESULT_INVALID',
          `result does not match the ${toolName} schema`,
          parsed === undefined ? {} : { cause: parsed.error },
        );
      }
      return parsed.data as UnknownRecord;
    },
  });
};

const createRegistry = (): ResultEgressPolicyRegistry => {
  const registry: Record<string, ResultEgressPolicy<UnknownRecord, UnknownRecord>> = Object.create(
    null,
  ) as Record<string, ResultEgressPolicy<UnknownRecord, UnknownRecord>>;
  for (const [name, classes] of Object.entries(POSSIBLE_RESULT_CLASSES)) {
    registry[name] = createPolicy(name, classes);
  }
  return Object.freeze(registry);
};

export const RESULT_EGRESS_POLICIES = createRegistry();

export const resultEgressPolicyFor = (
  toolName: string,
): ResultEgressPolicy<UnknownRecord, UnknownRecord> => {
  const found = RESULT_EGRESS_POLICIES[toolName];
  if (found === undefined) throw new Error(`result egress policy missing for ${toolName}`);
  return found;
};
