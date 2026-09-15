import { createHash } from 'node:crypto';

import { ExportFramesToPdfArgsSchema, ExportFramesToPdfResultSchema, ExportTokensArgsSchema, ExportTokensResultSchema, GetStylesResultSchema, GetVariableDefsResultSchema } from '@sfp/shared';
import { z } from 'zod';

import { handleExportTokens } from '../../mcp/src/tools/safe-union.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import { catalogSnapshot } from './catalog-recipe.js';
import { recipeHash, recipeError, recipeSourceNodes, type RecipeSourceNode } from './recipe-plan.js';
import { styleSnapshot } from './style-recipe-model.js';

const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const request = z.strictObject({ format: z.enum(['json', 'css']), outPath: z.string().min(1).max(4096).optional(), mode: z.union([z.strictObject({ kind: z.literal('defaults') }), z.strictObject({ kind: z.literal('exact'), value: z.string().min(1).max(512) })]).optional() });
export async function deriveTokenExportRecipe(input: { variables: unknown; styles: unknown; request: z.input<typeof request> }) {
  // Validate full membership/bindings but preserve actual exporter inventory order in byte previews.
  catalogSnapshot(input.variables);
  styleSnapshot(input.styles);
  const variables = GetVariableDefsResultSchema.parse(input.variables), styles = GetStylesResultSchema.parse(input.styles), requested = request.parse(input.request);
  if(requested.format === 'css' && requested.mode === undefined) throw recipeError('RECIPE_EXPORT_MODE_DECISION_REQUIRED');
  if(requested.format === 'json' && requested.mode !== undefined) throw recipeError('RECIPE_EXPORT_JSON_PRESERVES_ALL_MODES');
  if(requested.mode?.kind === 'exact') {
    const mode = requested.mode.value;
    if(variables.collections.some(collection => collection.modes.filter(row => row.modeId === mode || row.name === mode).length !== 1)) throw recipeError('RECIPE_EXPORT_MODE_MISSING_OR_AMBIGUOUS');
  }
  const args = ExportTokensArgsSchema.parse({ format: requested.format, ...(requested.mode?.kind === 'exact' ? { mode: requested.mode.value } : {}), ...(requested.outPath === undefined ? {} : { outPath: requested.outPath }) });
  // This is a fixed, pure preview over supplied snapshots; it does not dispatch an owner operation.
  const preview = ExportTokensResultSchema.parse(await handleExportTokens(async name => {
    if(name === 'get_variable_defs') return variables;
    if(name === 'get_styles') return styles;
    throw recipeError('RECIPE_EXPORT_UNEXPECTED_READ');
  }, { format: args.format, ...(args.mode === undefined ? {} : { mode: args.mode }) }));
  if(preview.content === undefined || Buffer.byteLength(preview.content) > 8388608) throw recipeError('RECIPE_EXPORT_RESULT_LIMIT');
  const blockingWarnings = preview.warnings.filter(warning => /unresolved|using its default mode|not a single visible solid/iu.test(warning));
  const plan = { version: 1 as const, execution: 'planned' as const, family: 'export-tokens' as const, status: blockingWarnings.length ? 'blocked' as const : 'ready-to-plan' as const, variableHash: recipeHash(variables), styleHash: recipeHash(styles), args, expected: { contentHash: digest(Buffer.from(preview.content)), contentBytes: Buffer.byteLength(preview.content), tokenCount: preview.tokenCount, warnings: preview.warnings }, preview: preview.content, blockingWarnings,
    prerequisites: ['CURRENT_FULL_VARIABLE_AND_STYLE_READS', 'CANONICAL_OWNER_ADMISSION', 'EXACT_RETAINED_RESULT_AND_NATIVE_ARTIFACT_READBACK'] };
  return { ...plan, hash: recipeHash(plan) };
}
/** Compare actual bytes supplied by the receipt-bound reader; this pure model grants no path access. */
export function verifyTokenExportRecipe(plan: Awaited<ReturnType<typeof deriveTokenExportRecipe>>, resultInput: unknown, bytes?: Uint8Array) {
  const { hash, ...body } = plan;
  if(hash !== recipeHash(body) || plan.status !== 'ready-to-plan' || digest(Buffer.from(plan.preview)) !== plan.expected.contentHash) throw recipeError('RECIPE_EXPORT_PLAN_INVALID');
  const result = ExportTokensResultSchema.parse(resultInput);
  if(result.format !== plan.args.format || result.tokenCount !== plan.expected.tokenCount || recipeHash(result.warnings) !== recipeHash(plan.expected.warnings)) throw recipeError('RECIPE_EXPORT_RESULT_CHANGED');
  let actual: Uint8Array;
  if(plan.args.outPath === undefined) {
    if(result.content === undefined || result.path !== undefined) throw recipeError('RECIPE_EXPORT_CONTENT_MISSING');
    actual = Buffer.from(result.content);
  } else {
    if(result.path !== plan.args.outPath || result.content !== undefined || bytes === undefined) throw recipeError('RECIPE_EXPORT_ARTIFACT_MISSING');
    actual = bytes;
  }
  if(actual.byteLength !== plan.expected.contentBytes || digest(actual) !== plan.expected.contentHash) throw recipeError('RECIPE_EXPORT_BYTES_CHANGED');
  return { contentHash: digest(actual), bytes: actual.byteLength, tokenCount: result.tokenCount };
}

export function composeFramePdfExport(input: { root: RecipeSourceNode; nodeIds: string[]; outPath: string }) {
  if(!isBoundedDesignJson(input.root, 8388608, 200000)) throw recipeError('RECIPE_EXPORT_SOURCE_LIMIT');
  const nodes = recipeSourceNodes(input.root), args = ExportFramesToPdfArgsSchema.parse({ nodeIds: input.nodeIds, outPath: input.outPath });
  for(const id of args.nodeIds) {
    const node = nodes.get(id);
    if(!node || !['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(String(node.type))) throw recipeError('RECIPE_PDF_TARGET_UNAVAILABLE');
  }
  const plan = { version: 1 as const, execution: 'planned' as const, family: 'export-frames-pdf' as const, sourceHash: recipeHash(input.root), args, frameHashes: args.nodeIds.map(id => recipeHash(nodes.get(id))),
    prerequisites: ['CURRENT_FULL_SOURCE_READ', 'CANONICAL_EXCLUSIVE_WORKSPACE_WRITE', 'RECEIPT_BOUND_NATIVE_MANIFEST_AND_PDF_BYTE_READBACK'] };
  return { ...plan, hash: recipeHash(plan) };
}
/** Metadata is only the first check; a PDF parser must separately verify the actual native bytes. */
export function verifyFramePdfMetadata(plan: ReturnType<typeof composeFramePdfExport>, input: unknown) {
  const { hash, ...body } = plan;
  if(hash !== recipeHash(body)) throw recipeError('RECIPE_EXPORT_PLAN_INVALID');
  const result = ExportFramesToPdfResultSchema.parse(input);
  if(result.path !== plan.args.outPath || result.pageCount !== plan.args.nodeIds.length || recipeHash(result.nodeIds) !== recipeHash(plan.args.nodeIds) || result.warnings.length) throw recipeError('RECIPE_PDF_RESULT_CHANGED');
  return result;
}
