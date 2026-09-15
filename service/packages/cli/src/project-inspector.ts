import { realpath } from 'node:fs/promises';

import type { DesignObservation } from '@sfp/shared';

import { RepoReader } from '../../mcp/src/fs/repo-walk.js';
import { detectIconLibraries, scanRepoSvgs } from '../../mcp/src/icons/repo-icons.js';
import type { ComponentMapping } from '../../mcp/src/join/component-map.js';
import type { IconMapping } from '../../mcp/src/join/icon-map.js';
import type { TokenMapping } from '../../mcp/src/join/token-map.js';
import {
  mapObservationComponents,
  mapObservationIcons,
  mapObservationTokens,
  normalizeMappingObservation,
} from '../../mcp/src/mapping/design-mapping.js';
import {
  readMappingOverrides,
  loadMappingTokenSource,
} from '../../mcp/src/mapping/mapping-overrides.js';
import { analyzeProject, isUtilityFirst, readProjectDeps } from '../../mcp/src/profile/profile.js';
import { scanComponents } from '../../mcp/src/scan/scan.js';
import type { loadProjectTokens } from '../../mcp/src/tokens/load.js';
import type { BrowserNode } from './scripter-bridge.js';

/** Local owner-invoked analysis uses the same bounded filesystem readers and pure mapping engines. */
export interface ProjectInspectionResult {
  schemaVersion: number;
  rootDir: string;
  profile: Awaited<ReturnType<typeof analyzeProject>>;
  components: Awaited<ReturnType<typeof scanComponents>>;
  tokens: Awaited<ReturnType<typeof loadProjectTokens>>;
  iconLibraries: ReturnType<typeof detectIconLibraries>;
  mappings: { components: ComponentMapping[]; tokens: TokenMapping[]; icons: IconMapping[] };
  observation: DesignObservation;
  codeSourceHash: string;
  designIncomplete: boolean | null;
  guidance: string;
}
export const inspectProject = async (
  rootDir: string,
  design?: {
    nodes: BrowserNode[];
    tokens: unknown[];
    collections: unknown[];
    truncated: boolean;
    styles?: unknown;
  },
): Promise<ProjectInspectionResult> => {
  const root = await realpath(rootDir);
  const reader = new RepoReader({ rootDir: root });
  const profile = await analyzeProject(root, reader);
  const components = await scanComponents(root, profile.componentExtensions, reader);
  const { loaded, codeSourceHash } = await loadMappingTokenSource(reader, profile);
  const svgs = await scanRepoSvgs(root, reader);
  const iconLibraries = detectIconLibraries(await readProjectDeps(root, reader));
  const observation = normalizeMappingObservation({
    source: 'figma-plugin-api-via-scripter',
    nodes: design?.nodes ?? [],
    tokens: design?.tokens ?? [],
    collections: design?.collections ?? [],
    ...(design?.styles === undefined ? {} : { styles: design.styles }),
  });
  const overrides = await readMappingOverrides(reader);

  const mappings = {
    components: mapObservationComponents(observation, components, {
      threshold: 0.7,
      overrides: overrides.components,
      overridesOnDisk: overrides.componentsOnDisk,
    }),
    tokens: mapObservationTokens(observation, loaded.tokens, {
      threshold: 0.7,
      utilityFirst: isUtilityFirst(profile.styling.system),
      overrides: overrides.tokens,
      proofs: overrides.proofs,
      codeSourceHash,
    }),
    icons: mapObservationIcons(observation, svgs, {
      threshold: 0.7,
      svg: profile.svg,
      utilityFirst: isUtilityFirst(profile.styling.system),
    }),
  };
  return {
    schemaVersion: 1,
    rootDir: root,
    profile,
    components,
    tokens: loaded,
    iconLibraries,
    mappings,
    observation,
    codeSourceHash,
    designIncomplete: design?.truncated ?? null,
    guidance:
      'Read the cited source files and reuse their APIs and conventions. Mapping candidates with ambiguity require source inspection.',
  };
};
