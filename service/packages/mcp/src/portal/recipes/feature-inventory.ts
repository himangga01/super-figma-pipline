import { PortalRecipeFeatureIdSchema, PortalRecipeIdSchema } from '@sfp/shared';
import { z } from 'zod';

const SourceFeatureSchema = z
  .object({
    featureId: PortalRecipeFeatureIdSchema,
    source: z.enum(['figma-mcp-rust', 'figwright', 'figmosha2']),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    path: z.string().min(1),
    intent: z.string().min(1),
    recipeIds: z.array(PortalRecipeIdSchema).max(8),
    semanticDisposition: z.enum(['adaptation', 'rejected']),
    implementation: z.enum(['planned', 'not-applicable']),
    prerequisites: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine(
    feature =>
      (feature.semanticDisposition === 'rejected') === (feature.recipeIds.length === 0) &&
      (feature.semanticDisposition === 'rejected') ===
        (feature.implementation === 'not-applicable'),
    'Rejected features have no executable recipe mapping',
  );
export type PortalRecipeSourceFeature = z.infer<typeof SourceFeatureSchema>;
type RecipeId = z.infer<typeof PortalRecipeIdSchema>;

const pins = {
  'figma-mcp-rust': '6094566436577b29d04393c774d51492c12671e1',
  figwright: 'a835e81b575eab2c9265a67f9353c89b848f81ca',
  figmosha2: '547cefb4c90abaa1da68db5455b921cbf3f8a5b9',
} as const;
const rust: ReadonlyArray<readonly [string, string | null, readonly RecipeId[], string]> = [
  [
    'annotation-conversion',
    'annotation_conversion_strategy',
    ['plan-annotations', 'convert-annotations'],
    'Match annotation text to explicit targets and verify native annotations; canonical writer missing',
  ],
  [
    'bridge-troubleshooting',
    null,
    ['diagnose-connection'],
    'Diagnose authenticated service transport and pinned target without copying upstream port or leader behavior',
  ],
  [
    'bulk-rename',
    'bulk_rename_strategy',
    ['rename-nodes'],
    'Compute scoped exact rename rows, preserve hierarchy and component masters',
  ],
  [
    'design-strategy',
    'design_strategy',
    ['plan-design-implementation', 'assemble-frame'],
    'Ground structure, naming, layout and reusable service patterns before optional design writes',
  ],
  [
    'design-token-generation',
    'design_token_generation_strategy',
    ['derive-tokens', 'author-tokens'],
    'Preserve raw values, modes, aliases and styles; author and bind only approved tokens',
  ],
  [
    'generate-color-palette',
    'generate_color_palette',
    ['derive-palette', 'author-palette'],
    'Preview deterministic primitive scale and semantic aliases; preserve failed mode outcomes',
  ],
  [
    'generate-component-variants',
    'generate_component_variants',
    ['derive-variants', 'author-variants'],
    'Inspect and clone explicit variant axes; preserve original and verify child changes',
  ],
  [
    'generate-type-scale',
    'generate_type_scale',
    ['derive-type-scale', 'author-type-scale'],
    'Compute rounded scale, actual fonts, line height and letter spacing; avoid duplicate styles',
  ],
  [
    'prototype-flow-mapping',
    'reaction_to_connector_strategy',
    ['derive-interactions'],
    'Translate source reactions to required assertions, retaining unsupported and overlay/state actions',
  ],
  [
    'read-design-strategy',
    'read_design_strategy',
    ['ground-design'],
    'Complete scoped hierarchy, catalogs, components and assets with explicit unresolved coverage',
  ],
  [
    'style-audit',
    'style_audit_strategy',
    ['audit-styles'],
    'Audit raw versus linked values without changing appearance or intentional overrides',
  ],
  [
    'swap-instance-overrides',
    'swap_overrides_instances',
    ['transfer-instance-overrides'],
    'Transfer compatible text, paint and property overrides with exact target mapping and readback',
  ],
  [
    'text-replacement',
    'text_replacement_strategy',
    ['replace-text'],
    'Replace exact text in bounded chunks with range-aware font loading and preserved styling',
  ],
];
const figwright: ReadonlyArray<readonly [string, string, readonly RecipeId[], string]> = [
  [
    'skill',
    'figma-codegen',
    ['ground-design', 'map-design', 'plan-design-implementation', 'diff-design'],
    'Use admitted portal flow and verify required result consumption in generated code',
  ],
  [
    'skill',
    'figma-build',
    ['assemble-frame', 'author-tokens', 'author-variants'],
    'Conditionally author source-grounded reusable systems through actual owner admission',
  ],
  [
    'reference',
    'figma-codegen.grounding',
    ['ground-design'],
    'Per-node/range fidelity and complete resumable sections',
  ],
  [
    'reference',
    'figma-codegen.assets-and-icons',
    ['resolve-assets', 'map-design', 'export-handoff'],
    'Reuse real images/SVG/icons with source and byte provenance',
  ],
  [
    'reference',
    'figma-codegen.stylesheets',
    ['plan-design-implementation'],
    'Respect source stylesheet imports and nesting; prove selectors are used',
  ],
  [
    'reference',
    'figma-codegen.responsive',
    ['plan-design-implementation', 'derive-interactions'],
    'Distinguish breakpoint variants from states and verify scoped viewport behavior',
  ],
  [
    'reference',
    'figma-codegen.verify',
    ['plan-design-implementation'],
    'Native candidate and applied checks with independent verified consumption',
  ],
  [
    'reference',
    'figma-codegen.motion',
    ['derive-interactions'],
    'Preserve keyframes, easing and stagger; test temporal behavior independently of stills',
  ],
  [
    'reference',
    'figma-build.write-rules',
    ['assemble-frame', 'bind-variable', 'replace-text'],
    'Ordered layout, HUG/FILL/FIXED, source token bindings and font-safe rich text',
  ],
  [
    'reference',
    'figma-build.author-design-system',
    ['author-tokens', 'author-palette', 'author-type-scale', 'author-variants'],
    'Reuse existing catalogs and explicit library/mode capabilities',
  ],
  [
    'reference',
    'figma-build.assemble-screens',
    ['assemble-frame', 'instantiate-component'],
    'Create then size/bind through typed result dependencies and final readback',
  ],
  [
    'reference',
    'figma-build.motion',
    ['author-motion'],
    'Conditional canonical motion writes with API prerequisite and temporal readback',
  ],
];
const helpers: ReadonlyArray<readonly [string, readonly RecipeId[], string]> = [
  [
    'bF',
    ['bind-variable'],
    'Resolve explicit local/library variable then bind exact fill index preserving other paints',
  ],
  [
    'bS',
    ['bind-variable'],
    'Resolve explicit local/library variable then bind exact stroke index preserving other paints',
  ],
  [
    'bN',
    ['bind-variable'],
    'Bind a supported numeric/node property to an explicitly resolved variable',
  ],
  [
    'findByName',
    ['resolve-target'],
    'First exact case-sensitive descendant with complete stable traversal',
  ],
  [
    'findAllByName',
    ['resolve-target'],
    'All exact case-sensitive descendants; completeness cannot be inferred from truncated search',
  ],
  [
    'dumpTree',
    ['describe-tree'],
    'Bounded tree text with depth, optional sizes/text/layout and explicit truncation',
  ],
  [
    'withFonts',
    ['replace-text'],
    'Range-aware font preflight instead of arbitrary callbacks or upstream mixed-font skip',
  ],
  ['setText', ['replace-text'], 'Canonical font-safe text/range edits and verification'],
  [
    'cloneNext',
    ['clone-adjacent'],
    'Directional clone placement and optional rename under the same verified parent',
  ],
  ['variant', ['set-variant'], 'Set declared instance properties and verify variant state'],
  [
    'variantsOf',
    ['describe-variants'],
    'Return current variant plus component-set groups and all variant names',
  ],
  [
    'sel',
    ['resolve-target'],
    'Explicit current selection and deterministic empty/multiple selection handling',
  ],
  ['hex', ['convert-paint'], 'Validated RGB/RRGGBB conversion to normalized channels'],
  ['solid', ['convert-paint'], 'Canonical solid paint with finite normalized opacity'],
  [
    'frame',
    ['assemble-frame'],
    'Create/reparent then layout, dimensions, sizing, padding and paints in canonical order',
  ],
  [
    'resolve',
    ['resolve-target'],
    'Tagged node, URL, current page or selection; normalization alone is insufficient',
  ],
  ['node', ['resolve-target'], 'Resolve exact node under admitted file/scope'],
  [
    'var_',
    ['resolve-variable'],
    'Distinguish local lookup from explicitly authorized library import',
  ],
  [
    'importComp',
    ['instantiate-component'],
    'Explicit adaptation: canonical component-key operation imports and creates an instance',
  ],
  [
    'importVar',
    ['resolve-variable'],
    'Canonical library import with identity/type receipt and declared mutation',
  ],
];
const cli: ReadonlyArray<readonly [string, readonly RecipeId[], string]> = [
  ['status', ['diagnose-connection'], 'Service readiness summary'],
  ['doctor', ['diagnose-connection'], 'Bounded typed connection diagnosis'],
  ['sel', ['resolve-target'], 'Explicit selected-node resolution'],
  ['exec', [], 'General-purpose upstream JavaScript execution is intentionally rejected'],
  ['tree', ['describe-tree'], 'Bounded tree projection'],
  ['find', ['resolve-target'], 'Exact typed search adaptation'],
  ['text', ['replace-text'], 'Scoped font-safe text edits'],
  ['variant', ['set-variant'], 'Declared instance property change'],
  ['clone', ['clone-adjacent'], 'Typed dependent clone placement'],
  ['rm', ['remove-nodes'], 'Canonical scoped deletion with existing authorization'],
  [
    'import-component',
    ['instantiate-component'],
    'Explicit component import/instantiate adaptation',
  ],
  ['icomp', ['instantiate-component'], 'Same declared import/instantiate intent'],
];

function row(
  source: PortalRecipeSourceFeature['source'],
  featureId: string,
  path: string,
  recipeIds: readonly RecipeId[],
  intent: string,
): PortalRecipeSourceFeature {
  return SourceFeatureSchema.parse({
    source,
    featureId,
    path,
    revision: pins[source],
    recipeIds: [...recipeIds],
    intent,
    semanticDisposition: recipeIds.length ? 'adaptation' : 'rejected',
    implementation: recipeIds.length ? 'planned' : 'not-applicable',
    prerequisites: recipeIds.length
      ? ['recipe-executor-and-verifier-not-integrated']
      : ['arbitrary-execution-not-supported'],
  });
}
const rows = [
  ...rust.flatMap(([skill, prompt, recipes, intent]) => {
    const features = [
      row('figma-mcp-rust', `rust.skill.${skill}`, `skills/${skill}/SKILL.md`, recipes, intent),
    ];
    if (prompt !== null)
      features.push(
        row('figma-mcp-rust', `rust.prompt.${prompt}`, `prompts/${prompt}.md`, recipes, intent),
      );
    return features;
  }),
  ...figwright.map(([kind, name, recipes, intent]) => {
    const [family, reference] = name.split('.');
    return row(
      'figwright',
      `figwright.${kind}.${name}`,
      kind === 'skill'
        ? `skills/${family}/SKILL.md`
        : `skills/${family}/references/${reference}.md`,
      recipes,
      intent,
    );
  }),
  ...helpers.map(([name, recipes, intent]) =>
    row('figmosha2', `figmosha.helper.${name}`, 'plugin/code.js', recipes, intent),
  ),
  ...cli.map(([name, recipes, intent]) =>
    row('figmosha2', `figmosha.cli.${name}`, 'figmosha.py', recipes, intent),
  ),
].toSorted((a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0));

export function validatePortalRecipeFeatureInventory(input: unknown): PortalRecipeSourceFeature[] {
  const parsed = z.array(SourceFeatureSchema).min(1).max(256).parse(input);
  if (new Set(parsed.map(value => value.featureId)).size !== parsed.length)
    throw new Error('PORTAL_RECIPE_DUPLICATE_FEATURE');
  return parsed;
}
export const PORTAL_RECIPE_FEATURE_INVENTORY: readonly (Readonly<
  Omit<PortalRecipeSourceFeature, 'recipeIds' | 'prerequisites'>
> & {
  readonly recipeIds: readonly RecipeId[];
  readonly prerequisites: readonly string[];
})[] = Object.freeze(
  validatePortalRecipeFeatureInventory(rows).map(value =>
    Object.freeze({
      ...value,
      recipeIds: Object.freeze(value.recipeIds),
      prerequisites: Object.freeze(value.prerequisites),
    }),
  ),
);
