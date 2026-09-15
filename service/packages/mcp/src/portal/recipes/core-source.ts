import { lstat } from 'node:fs/promises';
import { posix } from 'node:path';

import { canonicalJson, contentHash, type GroundingGraphV1 } from '@sfp/ir';
import {
  PORTAL_CORE_RECIPE_LIMITS,
  PortalPlanArgsSchema,
  PortalCoreSourceContextSchema,
  type PortalCoreSourceContext,
  DesignObservationSchema,
  isBoundedDesignJson,
  type DesignObservation,
  type PortalSourceInventory,
  type ServiceGraphProfile,
} from '@sfp/shared';
import { z } from 'zod';

import type { RepoReader, WalkOptions, RepoWalkResult } from '../../fs/repo-walk.js';
import { scanRepoSvgs } from '../../icons/repo-icons.js';
import {
  mapObservationComponents,
  mapObservationIcons,
  mapObservationTokens,
  normalizeMappingObservation,
} from '../../mapping/design-mapping.js';
import { loadMappingTokenSource, readMappingOverrides } from '../../mapping/mapping-overrides.js';
import { analyzeProject, isUtilityFirst, type ProjectProfile } from '../../profile/profile.js';
import { scanComponents } from '../../scan/scan.js';
import { normalizeDesignObservation } from '../design-normalization.js';
import { analyzeServiceGraph } from '../service-graph.js';
import { selectPortalServices, selectedPortalLayers } from '../service-selection.js';
import { collectPortalSourceInventory } from '../source-inventory.js';

export const coreHash = (value: unknown) => contentHash('sfp-core-material-v1', value);
export function assertCoreTokenWork(observation: DesignObservation): void {
  const modes = new Map(
    observation.catalogs.collections.map(collection => [
      collection.id,
      Array.isArray(collection.raw.modes) ? collection.raw.modes.length : 0,
    ]),
  );
  let cells = 0;
  for (const variable of observation.catalogs.variables)
    if (
      (cells += modes.get(variable.collectionId) ?? 0) >
      PORTAL_CORE_RECIPE_LIMITS.tokenResolutionCells
    )
      throw new Error('CORE_TOKEN_MATRIX_LIMIT');
}
export function freezeCore<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCore(child);
    Object.freeze(value);
  }
  return value;
}
/** Rebuild from retained raw content; parsed self-reported normalized fields are not sufficient. */
export function verifyCoreObservation(input: unknown): DesignObservation {
  const observation = DesignObservationSchema.parse(input);
  const rebuilt = normalizeDesignObservation(
    observation.raw,
    observation.authority === 'collector-observed'
      ? {
          evidenceVersion: 1,
          contentHash: observation.contentHash,
          capabilities: observation.capabilities.map(({ name, status, count }) => ({
            name,
            status,
            count,
          })),
          coherence: observation.coherence,
          sourceBinding: observation.sourceBinding,
        }
      : undefined,
  );
  if (canonicalJson(rebuilt) !== canonicalJson(observation))
    throw new Error('CORE_OBSERVATION_CHANGED');
  return rebuilt;
}
const brand: unique symbol = Symbol('core-source');
export interface PreparedCoreRecipeSource {
  readonly [brand]: true;
  readonly sourceId: `sha256:${string}`;
  readonly sourceHash: `sha256:${string}`;
}
interface PreparedSourceData {
  sourceId: `sha256:${string}`;
  sourceHash: `sha256:${string}`;
  rootIdentityHash: `sha256:${string}`;
  observationHash: `sha256:${string}`;
  inventory: PortalSourceInventory;
  graph: ServiceGraphProfile;
  context: PortalCoreSourceContext;
  selection: ReturnType<typeof selectPortalServices>;
  effectivePaths: readonly string[];
  mappingResults: NonNullable<GroundingGraphV1['mappingResults']> | null;
  mappingIssue: string | null;
}
const capsules = new WeakMap<object, PreparedSourceData>();

const SourceRequestSchema = z
  .object({
    services: PortalPlanArgsSchema.shape.services,
    sourceReviews: PortalPlanArgsSchema.shape.sourceReviews,
  })
  .strict();
type SourceRequest = z.input<typeof SourceRequestSchema>;
interface SourceInput {
  sourceId: `sha256:${string}`;
  reader: RepoReader;
}
interface FreshSource {
  sourceId: `sha256:${string}`;
  reader: RepoReader;
  inventory: PortalSourceInventory;
  rootIdentityHash: `sha256:${string}`;
  identity: { dev: bigint; ino: bigint };
  graph: ServiceGraphProfile;
}

const ownerRoot = (graph: ServiceGraphProfile, path: string) =>
  graph.services
    .filter(service => service.rootPath === '.' || path.startsWith(service.rootPath + '/'))
    .toSorted(
      (a, b) =>
        (b.rootPath === '.' ? 0 : b.rootPath.length) - (a.rootPath === '.' ? 0 : a.rootPath.length),
    )[0]?.rootPath;
function selectedPaths(source: FreshSource, roots: readonly string[]): Set<string> {
  const selected = new Set(roots),
    paths = new Set(
      source.inventory.files
        .filter(file => selected.has(ownerRoot(source.graph, file.path) ?? ''))
        .map(file => file.path),
    );
  const known = new Set(source.inventory.files.map(file => file.path));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of source.graph.edges) {
      if (
        edge.kind === 'imports' &&
        paths.has(edge.from) &&
        known.has(edge.to) &&
        !paths.has(edge.to)
      ) {
        paths.add(edge.to);
        changed = true;
      }
      // Graph configuration edges point from configuration input to its consuming file.
      if (
        edge.kind === 'configures' &&
        paths.has(edge.to) &&
        known.has(edge.from) &&
        !paths.has(edge.from)
      ) {
        paths.add(edge.from);
        changed = true;
      }
    }
  }
  return paths;
}
/** Discovery is scoped before canonical parsing/joining; reads still use the complete retained root. */
function mappingReader(
  reader: RepoReader,
  inventory: PortalSourceInventory,
  paths: ReadonlySet<string>,
  scoped: boolean,
): RepoReader {
  return new Proxy(reader, {
    get(target, key) {
      if (key === 'walk')
        return async (options: WalkOptions = {}): Promise<RepoWalkResult> => {
          if (options.mode === 'portal-source-authority') return target.walk(options);
          if (!scoped) {
            const walked = await target.walk(options);
            if (walked.truncated) throw new Error('CORE_MAPPING_DISCOVERY_LIMIT');
            return walked;
          }
          // Preserve canonical semantic walk exclusions/order while applying its result cap only
          // after qualified filtering. The full byte inventory already caps the entire root.
          const walked = await target.walk({ ...options, cap: inventory.limits.maxFiles });
          if (walked.truncated) throw new Error('CORE_MAPPING_DISCOVERY_LIMIT');
          const files = walked.files.filter(path => paths.has(path));
          if (files.length > (options.cap ?? 5000)) throw new Error('CORE_MAPPING_DISCOVERY_LIMIT');
          return Object.freeze({
            ...walked,
            files: Object.freeze(files),
            skipped: walked.skipped + walked.files.length - files.length,
          });
        };
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
function selectedProfiles(source: FreshSource, roots: readonly string[]): ProjectProfile[] {
  return source.graph.services
    .filter(service => roots.includes(service.rootPath) && service.codePatterns)
    .map(service => {
      const profile = service.codePatterns!;
      return Object.assign({}, profile, {
        rootDir: source.reader.rootDir,
        styling: {
          ...profile.styling,
          ...(profile.styling.configPath === undefined
            ? {}
            : {
                configPath:
                  service.rootPath === '.'
                    ? profile.styling.configPath
                    : posix.join(service.rootPath, profile.styling.configPath),
              }),
        },
      }) as ProjectProfile;
    });
}
/** Global source order is part of qualification. This validates evidence, not owner permission. */
export async function prepareCoreRecipeSources(input: {
  sources: readonly SourceInput[];
  observation: DesignObservation;
  sourceContext?: SourceRequest;
}): Promise<PreparedCoreRecipeSource[]> {
  if (
    input.sources.length < 1 ||
    input.sources.length > 9 ||
    new Set(input.sources.map(source => source.sourceId)).size !== input.sources.length
  )
    throw new Error('CORE_SOURCE_SET_INVALID');
  if (
    input.sourceContext !== undefined &&
    !isBoundedDesignJson(input.sourceContext, 4194304, 50000)
  )
    throw new Error('CORE_SOURCE_CONTEXT_LIMIT');
  const observation = verifyCoreObservation(input.observation),
    request = SourceRequestSchema.parse(input.sourceContext ?? {});
  const sources: FreshSource[] = [];
  /* eslint-disable no-await-in-loop -- one bounded root per source, then a global qualified selection */
  for (const inputSource of input.sources) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(inputSource.sourceId))
      throw new Error('CORE_SOURCE_ID_INVALID');
    const reader = await inputSource.reader.withByteBudget({
      maxFileBytes: 16777216,
      maxTotalBytes: 134217728,
    });
    const inventory = await collectPortalSourceInventory(reader);
    if (!inventory.complete) throw new Error('CORE_SOURCE_INVENTORY_INCOMPLETE');
    const identity = await lstat(reader.rootDir, { bigint: true }),
      rootIdentityHash = coreHash({
        root: reader.rootDir,
        dev: String(identity.dev),
        ino: String(identity.ino),
      });
    const graph = await analyzeServiceGraph(reader, inputSource.sourceId);
    if (graph.sourceInventory?.hash !== inventory.hash) throw new Error('CORE_SOURCE_CHANGED');
    sources.push({
      sourceId: inputSource.sourceId,
      reader,
      inventory,
      identity,
      rootIdentityHash,
      graph,
    });
  }
  const profiles = sources.map(source => ({ graph: source.graph })),
    selection = selectPortalServices(profiles, request);
  const members = sources.map(source => ({
    sourceId: source.sourceId,
    rootIdentityHash: source.rootIdentityHash,
    inventoryHash: source.inventory.hash,
    graphHash: coreHash(source.graph),
  }));
  const common = {
    mode: request.services.length ? ('qualified' as const) : ('whole-root' as const),
    members,
    requestHash: coreHash(request),
    selectionHash: selection.hash,
    reviewsHash: coreHash(selection.reviews),
  };
  const contextHash = coreHash(common),
    payloads: PreparedSourceData[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const roots = selection.closure
      .filter(item => item.sourceId === source.sourceId && item.sourceIndex === sourceIndex)
      .map(item => item.rootPath);
    const paths = selectedPaths(source, roots),
      scoped = paths.size !== source.inventory.files.length;
    const context = PortalCoreSourceContextSchema.parse({
      version: 1,
      ...common,
      contextHash,
      sourceId: source.sourceId,
      sourceIndex,
      selectedRoots: selection.selected
        .filter(item => item.sourceId === source.sourceId && item.sourceIndex === sourceIndex)
        .map(item => item.rootPath),
      closureRoots: roots,
      effectivePathsHash: coreHash(source.inventory.files.filter(file => paths.has(file.path))),
      effectiveLayers: selectedPortalLayers(profiles, {
        ...selection,
        closure: selection.closure.filter(item => item.sourceIndex === sourceIndex),
        reviews: selection.reviews.filter(review => review.sourceIndex === sourceIndex),
      }),
      complete: selection.complete,
      issues: selection.issues,
    });
    let mappingResults: PreparedSourceData['mappingResults'] = null,
      mappingIssue: string | null = null;
    if (roots.length)
      try {
        assertCoreTokenWork(observation);
        const candidateReader = mappingReader(source.reader, source.inventory, paths, scoped);
        const selected = selectedProfiles(source, roots);
        const sourceProfiles = selected.length
          ? selected
          : [await analyzeProject(source.reader.rootDir, candidateReader)];
        if (
          sourceProfiles.some(
            profile => profile.conventions?.truncated || profile.conventions?.unreadFiles.length,
          )
        )
          throw new Error('CORE_SOURCE_PATTERN_INCOMPLETE');
        const profile = sourceProfiles[0]!;
        if (
          sourceProfiles.some(
            other =>
              other.svg.mode !== profile.svg.mode ||
              isUtilityFirst(other.styling.system) !== isUtilityFirst(profile.styling.system),
          )
        )
          throw new Error('CORE_MAPPING_PROFILE_CONFLICT');
        const extensions = [
          ...new Set(sourceProfiles.flatMap(sourceProfile => sourceProfile.componentExtensions)),
        ];
        const scanned = await scanComponents(source.reader.rootDir, extensions, candidateReader);
        const overrides = await readMappingOverrides(source.reader);
        const loads = [];
        for (const selectedProfile of sourceProfiles)
          loads.push(await loadMappingTokenSource(candidateReader, selectedProfile));
        const loadedTokens = [
          ...new Map(
            loads.flatMap(load => load.loaded.tokens).map(token => [coreHash(token), token]),
          ).values(),
        ];
        const codeSourceHash =
          loads.length === 1
            ? loads[0]!.codeSourceHash
            : coreHash({
                kind: 'selected-canonical-token-loads',
                loads: loads.map(load => load.codeSourceHash),
              });
        const mappedObservation = normalizeMappingObservation(observation.raw);
        const eligibleOverrides = new Set(
          [...overrides.components]
            .filter(([, row]) => paths.has(row.filePath))
            .map(([key]) => key),
        );
        const components = mapObservationComponents(mappedObservation, scanned, {
          threshold: 0.7,
          overrides: overrides.components,
          overridesOnDisk: new Set(
            [...overrides.componentsOnDisk].filter(key => eligibleOverrides.has(key)),
          ),
        });
        const tokens = mapObservationTokens(mappedObservation, loadedTokens, {
          threshold: 0.7,
          utilityFirst: isUtilityFirst(profile.styling.system),
          overrides: overrides.tokens,
          proofs: overrides.proofs,
          codeSourceHash,
        });
        const icons = mapObservationIcons(
          mappedObservation,
          await scanRepoSvgs(source.reader.rootDir, candidateReader),
          {
            threshold: 0.7,
            svg: profile.svg,
            utilityFirst: isUtilityFirst(profile.styling.system),
          },
        );
        if (
          components.some(map => map.candidate && !paths.has(map.candidate.filePath)) ||
          icons.some(map => map.candidate && !paths.has(map.candidate.filePath))
        )
          throw new Error('CORE_MAPPING_PATH_OUTSIDE_SELECTION');
        mappingResults = {
          version: 1,
          codeSourceHash,
          components: components.map(({ observations: _observations, ...mapping }) => mapping),
          tokens,
          icons,
        };
      } catch (error) {
        mappingIssue = [
          'CORE_MAPPING_PROFILE_CONFLICT',
          'CORE_SOURCE_PATTERN_INCOMPLETE',
          'CORE_MAPPING_DISCOVERY_LIMIT',
        ].includes((error as Error).message)
          ? (error as Error).message
          : 'CORE_CANONICAL_MAPPING_UNAVAILABLE';
      }
    const payload = {
      sourceId: source.sourceId,
      rootIdentityHash: source.rootIdentityHash,
      observationHash: coreHash(observation),
      inventory: source.inventory,
      graph: source.graph,
      context,
      selection,
      effectivePaths: [...paths].toSorted(),
      mappingResults,
      mappingIssue,
    };
    payloads.push({ ...payload, sourceHash: coreHash(payload) });
  }
  // Recheck every full root after all global selection and mapping work, before publishing any capsule.
  for (const source of sources) {
    const after = await collectPortalSourceInventory(source.reader),
      identity = await lstat(source.reader.rootDir, { bigint: true });
    if (
      !after.complete ||
      after.hash !== source.inventory.hash ||
      identity.dev !== source.identity.dev ||
      identity.ino !== source.identity.ino
    )
      throw new Error('CORE_SOURCE_CHANGED');
  }
  /* eslint-enable no-await-in-loop */
  return payloads.map(payload => {
    const capsule = Object.freeze({
      [brand]: true as const,
      sourceId: payload.sourceId,
      sourceHash: payload.sourceHash,
    });
    capsules.set(capsule, freezeCore(payload));
    return capsule;
  });
}
/** Single-root compatibility wrapper. Use batch preparation for global qualified indices/reviews. */
export async function prepareCoreRecipeSource(
  input: SourceInput & { observation: DesignObservation; sourceContext?: SourceRequest },
): Promise<PreparedCoreRecipeSource> {
  return (
    await prepareCoreRecipeSources({
      sources: [input],
      observation: input.observation,
      ...(input.sourceContext ? { sourceContext: input.sourceContext } : {}),
    })
  )[0]!;
}
export function readCoreRecipeSource(
  capsule: PreparedCoreRecipeSource,
  observationHash: string,
): PreparedSourceData {
  const value = capsules.get(capsule);
  if (!value || value.observationHash !== observationHash)
    throw new Error('CORE_SOURCE_CAPSULE_INVALID');
  return value;
}
