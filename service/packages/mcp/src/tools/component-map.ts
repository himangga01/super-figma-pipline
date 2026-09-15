import type { GetDesignContextResult } from '@sfp/shared';
import { z } from 'zod';

import { RepoReader } from '../fs/repo-walk.js';
import type { ComponentMapping } from '../join/component-map.js';
import { observeMappingContext, mapObservationComponents } from '../mapping/design-mapping.js';
import { readMappingOverrides } from '../mapping/mapping-overrides.js';
import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents } from '../scan/scan.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './get-design-context.js';
import type { RawToolSpec } from './spec.js';

export const COMPONENT_MAP_TOOL_NAME = 'component_map';

const DEFAULT_THRESHOLD = 0.7;

const inputSchema = z.object({
  nodeId: z.string().describe('Root node id; omit to use the selection or current page').optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence at/above which a match counts as a reliable reuse (default 0.7)')
    .optional(),
  rootDir: z.string().describe('Project root to scan; defaults to the server cwd').optional(),
});

export interface ComponentMapResult {
  mappings: ComponentMapping[];
  /** Distinct Figma component names with no code candidate ≥ 0.5 — the "to build" list. */
  unmapped: string[];
  profile: ProjectProfile;
  scannedComponentCount: number;
  /**
   * Map-file rows whose recorded target no longer resolves (file deleted/renamed since it was
   * recorded). The mapping degraded to the fuzzy/unmapped result instead; re-record or remove the
   * row. Present only when at least one row is stale.
   */
  staleOverrides?: { figmaComponentName: string; name: string; filePath: string }[];
}

export const componentMapTool: RawToolSpec = {
  name: COMPONENT_MAP_TOOL_NAME,
  description:
    'Map the Figma component instances in a selection/subtree to existing local code components, so ' +
    'they can be reused instead of regenerated. Joins the grounded Figma component names (and their ' +
    'variant axes) against an AST scan of the project; an explicit docs/figma-component-map.md row ' +
    '(FigmaName | code/path) is an unverified hint; file existence and name agreement do not prove API compatibility. A row whose ' +
    'target no longer resolves (deleted/renamed) is reported in staleOverrides and degrades to the ' +
    'fuzzy result rather than a phantom import. Each distinct component is mapped once with all its ' +
    'instance ids. A mapped candidate also reports matchedProps (Figma axes the component already ' +
    'has) and unmatchedProps (axes it lacks → component-extension TODOs). ' +
    'Returns { mappings (candidate + confidence + status high/medium/low/unmapped), unmapped, ' +
    'staleOverrides, profile }.',
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Orchestrate the join: pull the grounded Figma tree (reusing get_design_context — no dedicated
 * plugin handler), scan the local project, read any explicit map file, and join. Filesystem +
 * dispatch live here; the matching itself is pure (join/component-map.ts).
 */
export const handleComponentMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  reader?: RepoReader,
): Promise<ComponentMapResult> => {
  const args = inputSchema.parse(rawArgs);
  const rootDir = reader?.rootDir ?? args.rootDir ?? process.cwd();
  const repo = reader ?? new RepoReader({ rootDir });
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const contextArgs: Record<string, unknown> = { detail: 'full', dedupeComponents: true };
  if (args.nodeId !== undefined) contextArgs.nodeId = args.nodeId;

  // No doc-wide get_local_components here: get_design_context now carries each variant instance's
  // owning COMPONENT_SET (id + name) on its mainComponent, so collectFigmaComponents can group/name
  // by the set directly. The old scan called findAllWithCriteria over the whole document (68s+ /
  // 30s-timeout on large multi-page files) just to recover those set names.
  const [context, profile, overrides] = await Promise.all([
    dispatch(GET_DESIGN_CONTEXT_TOOL_NAME, contextArgs) as Promise<GetDesignContextResult>,
    analyzeProject(rootDir, repo),
    readMappingOverrides(repo),
  ]);

  const scanned = await scanComponents(rootDir, profile.componentExtensions, repo);

  const observation = observeMappingContext(context);
  const mappings = mapObservationComponents(observation, scanned, {
    threshold,
    overrides: overrides.components,
    overridesOnDisk: overrides.componentsOnDisk,
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaComponentName);
  // Stale rows (target gone) that degraded to a fuzzy/unmapped result — surfaced so the caller can
  // re-record or delete them, keeping the map file self-healing rather than accreting dead entries.
  const staleOverrides = mappings.flatMap(m =>
    m.staleOverride === undefined
      ? []
      : [{ figmaComponentName: m.figmaComponentName, ...m.staleOverride }],
  );

  return {
    mappings,
    unmapped,
    profile,
    scannedComponentCount: scanned.length,
    ...(staleOverrides.length > 0 ? { staleOverrides } : {}),
  };
};
