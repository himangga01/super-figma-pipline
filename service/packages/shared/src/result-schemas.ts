import { z } from 'zod';

import { GetLocalComponentsResultSchema, GetComponentApiResultSchema } from './components.js';
import { GetDesignContextResultSchema } from './design-context.js';
import {
  ExportPdfResultSchema,
  ExportVideoResultSchema,
  GetAnnotationsResultSchema,
  GetFontsResultSchema,
  GetMotionStylesResultSchema,
  GetNodeMotionResultSchema,
  GetReactionsResultSchema,
  GetScreenshotResultSchema,
  GetViewportResultSchema,
  ListFilesResultSchema,
  SaveImageFillsResultSchema,
  SaveScreenshotsResultSchema,
} from './queries.js';
import {
  GetDocumentResultSchema,
  GetMetadataResultSchema,
  GetNodeResultSchema,
  GetNodesInfoResultSchema,
  GetPagesResultSchema,
  GetSelectionResultSchema,
  NodeListResultSchema,
} from './serialized-node.js';
import { GetStylesResultSchema } from './styles.js';
import { GetVariableDefsResultSchema } from './variables.js';
import {
  ApplyAnimationStyleResultSchema,
  BatchNodeResultSchema,
  BatchResultSchema,
  CollectionResultSchema,
  ComponentPropertyResultSchema,
  CreateResultSchema,
  DeleteCollectionResultSchema,
  ModeResultSchema,
  MutateResultSchema,
  StyleResultSchema,
  VariableResultSchema,
} from './writes.js';

export type ResultSchema = z.ZodType<unknown>;
export type ResultSchemaRegistry = Readonly<Record<string, ResultSchema>>;

const strictResult = (schema: z.ZodObject): ResultSchema => schema.strict();

/** Build a closed result authority without object-literal overwrite hiding duplicate rows. */
export const createResultSchemaRegistry = (
  entries: readonly (readonly [name: string, schema: ResultSchema])[],
): ResultSchemaRegistry => {
  const registry: Record<string, ResultSchema> = Object.create(null) as Record<
    string,
    ResultSchema
  >;
  for (const [name, schema] of entries) {
    if (registry[name] !== undefined) throw new Error(`duplicate result schema: ${name}`);
    if (!(schema instanceof z.ZodObject)) {
      throw new Error(`result schema must be a strict object: ${name}`);
    }
    const strictSchema = schema.strict();
    const jsonSchema = strictSchema.toJSONSchema({ unrepresentable: 'any' });
    if (jsonSchema.type !== 'object' || jsonSchema.additionalProperties !== false) {
      throw new Error(`result schema must be a strict object: ${name}`);
    }
    registry[name] = strictSchema;
  }
  return Object.freeze(registry);
};

const PluginPingSchema = z
  .object({
    apiVersion: z.string(),
    editorType: z.string(),
    currentPageId: z.string(),
    currentPageName: z.string(),
    fileKey: z.string().nullable(),
    ts: z.number(),
  })
  .strict();

const PingServerInfoSchema = z
  .object({
    version: z.string(),
    role: z.enum(['unknown', 'leader', 'follower', 'conflicted']),
    port: z.number().nullable(),
    ts: z.number(),
    buildId: z.number(),
    leaderVersion: z.string().optional(),
    leaderBuildId: z.number().optional(),
    buildSkew: z.string().optional(),
    versionSkew: z.string().optional(),
    portConflict: z.string().optional(),
  })
  .strict();

const PingSessionInfoSchema = z
  .object({
    id: z.string(),
    fileName: z.string().nullable(),
    pageName: z.string().nullable(),
    lastActivityAt: z.number(),
    pluginVersion: z.string(),
  })
  .strict();

export const PingResultSchema = z
  .object({
    ok: z.literal(true),
    hop: z.enum(['server-only', 'e2e']),
    server: PingServerInfoSchema,
    sessions: z
      .object({
        connectedCount: z.number(),
        routedSessionId: z.string().nullable(),
        routedFileName: z.string().nullable(),
        routedPageName: z.string().nullable(),
        all: z.array(PingSessionInfoSchema),
      })
      .strict()
      .optional(),
    plugin: PluginPingSchema.nullable(),
    dispatchError: z.string().optional(),
  })
  .strict();

const ProjectProfileSchema = z
  .object({
    rootDir: z.string(),
    framework: z.enum(['next', 'nuxt', 'react', 'vue', 'svelte', 'solid', 'angular', 'unknown']),
    language: z.enum(['ts', 'js']),
    styling: z
      .object({
        system: z.enum([
          'tailwind',
          'unocss',
          'css-variables',
          'scss',
          'css-modules',
          'plain-css',
          'unknown',
        ]),
        configPath: z.string().optional(),
        tailwindVersion: z.number().optional(),
        classNaming: z.enum(['ampersand', 'flat']).optional(),
      })
      .strict(),
    svg: z
      .object({
        mode: z.enum(['component', 'url']),
        loader: z.string().optional(),
        importHint: z.string().optional(),
      })
      .strict(),
    componentExtensions: z.array(z.string()),
    evidence: z.array(z.string()),
  })
  .strict();

const ScannedComponentSchema = z
  .object({
    name: z.string(),
    filePath: z.string(),
    exportKind: z.enum(['default', 'named']),
    propNames: z.array(z.string()),
    propsExtracted: z.boolean(),
    framework: z.enum(['react', 'vue', 'svelte', 'angular']),
  })
  .strict();

export const AnalyzeProjectResultSchema = ProjectProfileSchema;
export const ScanComponentsResultSchema = z
  .object({ components: z.array(ScannedComponentSchema), profile: ProjectProfileSchema })
  .strict();

const MappingStatusSchema = z.enum(['high', 'medium', 'low', 'unmapped', 'framework-builtin']);
const FigmaInstanceSchema = z
  .object({
    nodeId: z.string(),
    props: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  })
  .strict();
const ComponentMappingSchema = z
  .object({
    figmaComponentName: z.string(),
    mainComponentId: z.string().optional(),
    variantAxes: z.array(z.string()),
    instances: z.array(FigmaInstanceSchema),
    instanceCount: z.number(),
    candidate: z
      .object({
        name: z.string(),
        filePath: z.string(),
        confidence: z.number(),
        matchedProps: z.array(z.string()),
        unmatchedProps: z.array(z.string()),
        ambiguousWith: z
          .array(z.object({ name: z.string(), filePath: z.string() }).strict())
          .optional(),
      })
      .strict()
      .optional(),
    status: MappingStatusSchema,
    source: z.enum(['map-file', 'scan']),
    staleOverride: z.object({ name: z.string(), filePath: z.string() }).strict().optional(),
  })
  .strict();

export const ComponentMapResultSchema = z
  .object({
    mappings: z.array(ComponentMappingSchema),
    unmapped: z.array(z.string()),
    profile: ProjectProfileSchema,
    scannedComponentCount: z.number(),
    staleOverrides: z
      .array(
        z
          .object({ figmaComponentName: z.string(), name: z.string(), filePath: z.string() })
          .strict(),
      )
      .optional(),
  })
  .strict();

const TokenValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const TokenMappingSchema = z
  .object({
    figmaName: z.string(),
    figmaValue: TokenValueSchema,
    figmaType: z.string(),
    figmaModes: z.record(z.string(), TokenValueSchema).optional(),
    candidate: z
      .object({
        token: z.string(),
        ref: z.string(),
        cssVar: z.string().optional(),
        utility: z.string().optional(),
        from: z.string().optional(),
        confidence: z.number(),
        matchedBy: z.array(z.enum(['name', 'value', 'map-file'])),
        ambiguousWith: z.array(z.string()).optional(),
        ambiguousFrom: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    builtin: z.object({ scale: z.string(), step: z.string() }).strict().optional(),
    source: z.literal('style').optional(),
    staleOverride: z.object({ ref: z.string() }).strict().optional(),
    status: MappingStatusSchema,
  })
  .strict();

export const TokenMapResultSchema = z
  .object({
    mappings: z.array(TokenMappingSchema),
    unmapped: z.array(z.string()),
    themedCollections: z.array(
      z.object({ name: z.string(), modes: z.array(z.string()), defaultMode: z.string() }).strict(),
    ),
    profile: ProjectProfileSchema,
    tokenSource: z.string().nullable(),
    projectTokenCount: z.number(),
    staleOverrides: z
      .array(z.object({ figmaName: z.string(), ref: z.string() }).strict())
      .optional(),
    note: z.string().optional(),
  })
  .strict();

const IconMappingSchema = z
  .object({
    figmaName: z.string(),
    name: z.string(),
    nodeIds: z.array(z.string()),
    fill: z
      .object({ hex: z.string().optional(), variable: z.boolean().optional() })
      .strict()
      .optional(),
    candidate: z
      .object({
        filePath: z.string(),
        colorContract: z.enum(['currentColor', 'fixed', 'multi-color', 'unknown']),
        recolor: z.string(),
        confidence: z.number(),
      })
      .strict()
      .optional(),
    status: MappingStatusSchema,
  })
  .strict();

export const IconMapResultSchema = z
  .object({
    mappings: z.array(IconMappingSchema),
    unmapped: z.array(z.string()),
    iconLibraries: z.array(z.string()),
    profile: ProjectProfileSchema,
    svgFileCount: z.number(),
  })
  .strict();

const FieldChangeSchema = z
  .object({
    field: z.string(),
    before: z.union([z.json(), z.undefined()]),
    after: z.union([z.json(), z.undefined()]),
  })
  .strict();
const NodeChangeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    path: z.string(),
    kind: z.enum(['added', 'removed', 'changed']),
    fields: z.array(FieldChangeSchema).optional(),
  })
  .strict();
const DesignDiffChangesSchema = z
  .object({
    added: z.array(NodeChangeSchema),
    removed: z.array(NodeChangeSchema),
    changed: z.array(NodeChangeSchema),
  })
  .strict();

export const DesignDiffResultSchema = z
  .object({
    status: z.enum(['baseline-created', 'diff', 'no-changes']),
    nodeId: z.string(),
    snapshotPath: z.string(),
    baselineCapturedAt: z.string().optional(),
    summary: z
      .object({ added: z.number(), removed: z.number(), changed: z.number() })
      .strict()
      .optional(),
    changes: DesignDiffChangesSchema.optional(),
    baselineUpdated: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();

const RESULT_SCHEMA_ENTRIES = [
  ['ping', PingResultSchema],
  ['get_selection', strictResult(GetSelectionResultSchema)],
  ['get_document', strictResult(GetDocumentResultSchema)],
  ['get_node', strictResult(GetNodeResultSchema)],
  ['get_nodes_info', strictResult(GetNodesInfoResultSchema)],
  ['get_metadata', strictResult(GetMetadataResultSchema)],
  ['get_pages', strictResult(GetPagesResultSchema)],
  ['search_nodes', strictResult(NodeListResultSchema)],
  ['scan_text_nodes', strictResult(NodeListResultSchema)],
  ['scan_nodes_by_types', strictResult(NodeListResultSchema)],
  ['get_styles', strictResult(GetStylesResultSchema)],
  ['get_variable_defs', strictResult(GetVariableDefsResultSchema)],
  ['get_local_components', strictResult(GetLocalComponentsResultSchema)],
  ['get_component_api', strictResult(GetComponentApiResultSchema)],
  ['get_viewport', strictResult(GetViewportResultSchema)],
  ['get_fonts', strictResult(GetFontsResultSchema)],
  ['get_annotations', strictResult(GetAnnotationsResultSchema)],
  ['get_reactions', strictResult(GetReactionsResultSchema)],
  ['get_motion_styles', strictResult(GetMotionStylesResultSchema)],
  ['get_node_motion', strictResult(GetNodeMotionResultSchema)],
  ['list_files', strictResult(ListFilesResultSchema)],
  ['get_design_context', strictResult(GetDesignContextResultSchema)],
  ['get_screenshot', strictResult(GetScreenshotResultSchema)],
  ['save_screenshots', strictResult(SaveScreenshotsResultSchema)],
  ['save_image_fills', strictResult(SaveImageFillsResultSchema)],
  ['export_pdf', strictResult(ExportPdfResultSchema)],
  ['export_video', strictResult(ExportVideoResultSchema)],
  ['analyze_project', AnalyzeProjectResultSchema],
  ['scan_components', ScanComponentsResultSchema],
  ['component_map', ComponentMapResultSchema],
  ['token_map', TokenMapResultSchema],
  ['icon_map', IconMapResultSchema],
  ['design_diff', DesignDiffResultSchema],
  ['set_fills', strictResult(MutateResultSchema)],
  ['set_text', strictResult(MutateResultSchema)],
  ['set_text_properties', strictResult(MutateResultSchema)],
  ['set_text_range', strictResult(MutateResultSchema)],
  ['create_frame', strictResult(CreateResultSchema)],
  ['set_opacity', strictResult(MutateResultSchema)],
  ['set_visible', strictResult(MutateResultSchema)],
  ['rename_node', strictResult(MutateResultSchema)],
  ['delete_nodes', strictResult(BatchNodeResultSchema)],
  ['create_text', strictResult(CreateResultSchema)],
  ['create_rectangle', strictResult(CreateResultSchema)],
  ['set_corner_radius', strictResult(MutateResultSchema)],
  ['set_strokes', strictResult(MutateResultSchema)],
  ['move_nodes', strictResult(BatchNodeResultSchema)],
  ['set_position', strictResult(MutateResultSchema)],
  ['resize_nodes', strictResult(BatchNodeResultSchema)],
  ['set_auto_layout', strictResult(MutateResultSchema)],
  ['set_layout_props', strictResult(MutateResultSchema)],
  ['set_layout_grids', strictResult(MutateResultSchema)],
  ['set_blend_mode', strictResult(MutateResultSchema)],
  ['set_mask', strictResult(MutateResultSchema)],
  ['set_arc', strictResult(MutateResultSchema)],
  ['set_constraints', strictResult(MutateResultSchema)],
  ['rotate_nodes', strictResult(BatchNodeResultSchema)],
  ['lock_nodes', strictResult(BatchNodeResultSchema)],
  ['unlock_nodes', strictResult(BatchNodeResultSchema)],
  ['clone_node', strictResult(CreateResultSchema)],
  ['set_effects', strictResult(MutateResultSchema)],
  ['create_paint_style', strictResult(StyleResultSchema)],
  ['create_text_style', strictResult(StyleResultSchema)],
  ['create_effect_style', strictResult(StyleResultSchema)],
  ['create_grid_style', strictResult(StyleResultSchema)],
  ['update_paint_style', strictResult(StyleResultSchema)],
  ['update_text_style', strictResult(StyleResultSchema)],
  ['update_effect_style', strictResult(StyleResultSchema)],
  ['apply_style_to_node', strictResult(MutateResultSchema)],
  ['delete_style', strictResult(StyleResultSchema)],
  ['create_variable_collection', strictResult(CollectionResultSchema)],
  ['add_variable_mode', strictResult(ModeResultSchema)],
  ['create_variable', strictResult(VariableResultSchema)],
  ['set_variable_value', strictResult(VariableResultSchema)],
  ['bind_variable_to_node', strictResult(MutateResultSchema)],
  ['bind_variable_to_paint', strictResult(MutateResultSchema)],
  ['rename_variable', strictResult(VariableResultSchema)],
  ['set_variable_code_syntax', strictResult(VariableResultSchema)],
  ['delete_variable', strictResult(VariableResultSchema)],
  ['delete_variable_collection', strictResult(DeleteCollectionResultSchema)],
  ['group_nodes', strictResult(CreateResultSchema)],
  ['ungroup_nodes', strictResult(BatchNodeResultSchema)],
  ['reparent_nodes', strictResult(BatchNodeResultSchema)],
  ['reorder_nodes', strictResult(BatchNodeResultSchema)],
  ['find_replace_text', strictResult(BatchNodeResultSchema)],
  ['batch_rename_nodes', strictResult(BatchNodeResultSchema)],
  ['add_page', strictResult(CreateResultSchema)],
  ['delete_page', strictResult(MutateResultSchema)],
  ['rename_page', strictResult(MutateResultSchema)],
  ['navigate_to_page', strictResult(MutateResultSchema)],
  ['set_reactions', strictResult(MutateResultSchema)],
  ['remove_reactions', strictResult(MutateResultSchema)],
  ['swap_component', strictResult(MutateResultSchema)],
  ['set_instance_properties', strictResult(MutateResultSchema)],
  ['add_component_property', strictResult(ComponentPropertyResultSchema)],
  ['bind_component_property', strictResult(MutateResultSchema)],
  ['edit_component_property', strictResult(ComponentPropertyResultSchema)],
  ['delete_component_property', strictResult(ComponentPropertyResultSchema)],
  ['detach_instance', strictResult(CreateResultSchema)],
  ['import_image', strictResult(CreateResultSchema)],
  ['import_svg', strictResult(CreateResultSchema)],
  ['create_ellipse', strictResult(CreateResultSchema)],
  ['create_component', strictResult(CreateResultSchema)],
  ['create_section', strictResult(CreateResultSchema)],
  ['create_instance', strictResult(CreateResultSchema)],
  ['combine_as_variants', strictResult(CreateResultSchema)],
  ['apply_animation_style', strictResult(ApplyAnimationStyleResultSchema)],
  ['remove_animation_style', strictResult(MutateResultSchema)],
  ['apply_manual_keyframe_track', strictResult(MutateResultSchema)],
  ['remove_manual_keyframe_track', strictResult(MutateResultSchema)],
  ['set_timeline_duration', strictResult(MutateResultSchema)],
  ['batch', strictResult(BatchResultSchema)],
] as const satisfies readonly (readonly [string, ResultSchema])[];

export const RESULT_SCHEMAS = createResultSchemaRegistry(RESULT_SCHEMA_ENTRIES);
