import type { GetDesignContextResult, GetStylesResult, GetVariableDefsResult } from '@sfp/shared';
import { z } from 'zod';

import { RepoReader } from '../fs/repo-walk.js';
import type { TokenMapping } from '../join/token-map.js';
import { mapObservationTokens, observeMappingContext } from '../mapping/design-mapping.js';
import { readMappingOverrides, loadMappingTokenSource } from '../mapping/mapping-overrides.js';
import { analyzeProject, isUtilityFirst, type ProjectProfile } from '../profile/profile.js';
import { GET_STYLES_TOOL_NAME } from './get-styles.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from './get-variable-defs.js';
import type { RawToolSpec } from './spec.js';

export const TOKEN_MAP_TOOL_NAME = 'token_map';

const DEFAULT_THRESHOLD = 0.7;
const inputSchema = z.object({
  nodeId: z.string().optional(),
  rootDir: z.string().describe('Project root; defaults to the server cwd').optional(),
  tokenSource: z
    .string()
    .describe(
      'Path (relative to rootDir) to the file holding the tokens — a CSS file, a .scss file, or a ' +
        'Tailwind / UnoCSS config (.js/.cjs/.mjs/.ts), read according to its name; overrides detection',
    )
    .optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence at/above which a match counts as reliable (default 0.7)')
    .optional(),
});

export interface TokenMapResult {
  mappings: TokenMapping[];
  codeSourceHash: string;
  observation: ReturnType<typeof observeMappingContext>;
  /** Figma token names with no project token candidate ≥ 0.5 — the gap to define. */
  unmapped: string[];
  /**
   * The file's theme axes: every variable collection with more than one mode (e.g. Light/Dark),
   * with its mode names and default. Mappings whose variable actually changes per mode carry the
   * per-theme values on figmaModes; this is the file-level summary that says themes exist at all.
   */
  themedCollections: { name: string; modes: string[]; defaultMode: string }[];
  profile: ProjectProfile;
  /** Repo-relative token source that was parsed, or null when none was usable. */
  tokenSource: string | null;
  projectTokenCount: number;
  /**
   * Docs/figma-token-map.md rows whose recorded ref no longer resolves to a project token
   * (renamed/removed). The mapping degraded to the normal join; re-record or remove the row.
   * Present only when at least one row is stale.
   */
  staleOverrides?: { figmaName: string; ref: string }[];
  /**
   * How the token pool was assembled, when that isn't just "read the detected source": which files
   * were aggregated, how much of a Tailwind config could not be read statically, or why no source
   * was usable at all.
   */
  note?: string;
}

export const tokenMapTool: RawToolSpec = {
  name: TOKEN_MAP_TOOL_NAME,
  description:
    'Map captured variable catalog values and single-solid paint styles to repository tokens. ' +
    'Source IDs, collection IDs and modeValues preserve identity; catalog defaults are not node selections. ' +
    'Pass nodeId to include actual node bindings, independently selected collection modes and alias resolution. ' +
    'Missing modes, remote dependencies, failed catalogs and ambiguous SCSS declarations are not verified reuse. ' +
    'Candidate refs require source inspection; SCSS candidates require an import from candidate.from. ' +
    'Name matches and unsupported unit/color/theme conversions remain candidates. ' +
    'Historical docs/figma-token-map.md name/ref rows are legacy-unverified hints. ' +
    'A fenced sfp-token-map-v2 JSON array can record sourceId/type/value/collectionId/defaultModeId/modeValues, ' +
    'ref/token/projectValue/from/codeSourceHash; the shared reader verifies exact current design/code evidence ' +
    'and rejects stale proofs. Only mechanically comparable uniform values can verify this catalog proof; ' +
    'runtime theme and property consumption require separate validation. ' +
    'Styles read failures propagate. Outputs retain an observation marked with its actual authority, ' +
    'which standalone mapping reads do not elevate to coherent live capture.',
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Orchestrate the token join: pull the document's variables (reusing get_variable_defs — no
 * dedicated plugin handler), detect the project profile, load its design tokens (tokens/load.ts,
 * shared with the design-context value annotation), and join. Filesystem + dispatch live here; the
 * matching itself is pure (join/token-map.ts).
 */
export const handleTokenMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  reader?: RepoReader,
): Promise<TokenMapResult> => {
  const args = inputSchema.parse(rawArgs);
  const rootDir = reader?.rootDir ?? args.rootDir ?? process.cwd();
  const repo = reader ?? new RepoReader({ rootDir });
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  // Required style catalog failures propagate; an absent result is not an observed empty palette.
  const [defs, styles, profile, overrides, context] = await Promise.all([
    dispatch(GET_VARIABLE_DEFS_TOOL_NAME, {}) as Promise<GetVariableDefsResult>,
    dispatch(GET_STYLES_TOOL_NAME, {}) as Promise<GetStylesResult>,
    analyzeProject(rootDir, repo),
    readMappingOverrides(repo),
    args.nodeId === undefined
      ? Promise.resolve({ nodes: [] } as GetDesignContextResult)
      : (dispatch('get_design_context', {
          nodeId: args.nodeId,
          detail: 'full',
          dedupeComponents: false,
        }) as Promise<GetDesignContextResult>),
  ]);

  const { loaded, codeSourceHash } = await loadMappingTokenSource(repo, profile, args.tokenSource);

  const observation = observeMappingContext(context, { variables: defs, styles });
  const mappings = mapObservationTokens(observation, loaded.tokens, {
    threshold,
    utilityFirst: isUtilityFirst(profile.styling.system),
    overrides: overrides.tokens,
    proofs: overrides.proofs,
    codeSourceHash,
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaName);
  // Stale rows (recorded ref no longer resolves) that degraded to the normal join — surfaced so the
  // caller can re-record or delete them, keeping the map file self-healing.
  const staleOverrides = mappings.flatMap(m =>
    m.staleOverride === undefined ? [] : [{ figmaName: m.figmaName, ref: m.staleOverride.ref }],
  );
  const themedCollections = defs.collections
    .filter(c => c.modes.length > 1)
    .map(c => ({
      name: c.name,
      modes: c.modes.map(m => m.name),
      defaultMode: c.modes.find(m => m.modeId === c.defaultModeId)?.name ?? '',
    }));

  return {
    mappings,
    observation,
    codeSourceHash,
    unmapped,
    themedCollections,
    profile,
    tokenSource: loaded.source,
    projectTokenCount: loaded.tokens.length,
    ...(staleOverrides.length > 0 ? { staleOverrides } : {}),
    ...(loaded.note === undefined ? {} : { note: loaded.note }),
  };
};
