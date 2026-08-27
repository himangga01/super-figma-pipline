import { z } from 'zod';

import figmoshaFeatureMapJson from '../../../capabilities/figmosha-feature-map.json' with { type: 'json' };
import rustToolCompatJson from '../../../capabilities/rust-tool-compat.json' with { type: 'json' };
import unionManifestJson from '../../../capabilities/union-manifest.json' with { type: 'json' };

export interface SourceContract {
  source: string;
  schemaHash: string;
}

export interface CanonicalToolRow {
  name: string;
  sourceRefs: readonly string[];
  sourceContracts: readonly SourceContract[];
  targetContractHash: string;
  disposition: 'native' | 'adapter' | 'experimental-native';
  registration: 'advertised';
  availability: readonly string[];
  investment: 'active' | 'deferred';
  implementationStatus: 'planned' | 'implemented';
  implementation: string;
  test: string;
  policyId: string;
}

export interface SourceToolRow {
  name: string;
  sources: readonly string[];
  compatibility: 'same' | 'adapter' | 'incompatible' | 'unique';
  sourceContracts: readonly SourceContract[];
  canonicalName: string;
}

export interface SourceFeatureRow {
  name: string;
  source: 'figmosha2';
  mapping: string;
  disposition: 'native' | 'adapter' | 'alias' | 'rejected';
  implementation: string | null;
  test: string;
}

export interface UnionManifestV1 {
  schemaVersion: 1;
  canonicalTools: readonly CanonicalToolRow[];
  sourceSurfaces: {
    lexicalTools: readonly SourceToolRow[];
    figmoshaHelpers: readonly SourceFeatureRow[];
    figmoshaCliParsers: readonly SourceFeatureRow[];
  };
}

export interface RustToolCompatV1 {
  schemaVersion: 1;
  tools: readonly SourceToolRow[];
}

export interface FigmoshaFeatureMapV1 {
  schemaVersion: 1;
  helpers: readonly SourceFeatureRow[];
  cliParsers: readonly SourceFeatureRow[];
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const SourceContractSchema = z
  .object({ source: z.string().min(1), schemaHash: sha256Schema })
  .strict();
const SourceToolRowSchema = z
  .object({
    name: z.string().min(1),
    sources: z.array(z.string().min(1)).min(1),
    compatibility: z.enum(['same', 'adapter', 'incompatible', 'unique']),
    sourceContracts: z.array(SourceContractSchema).min(1),
    canonicalName: z.string().min(1),
  })
  .strict();
const SourceFeatureRowSchema = z
  .object({
    name: z.string().min(1),
    source: z.literal('figmosha2'),
    mapping: z.string().min(1),
    disposition: z.enum(['native', 'adapter', 'alias', 'rejected']),
    implementation: z.string().min(1).nullable(),
    test: z.string().min(1),
  })
  .strict();
const CanonicalToolRowSchema = z
  .object({
    name: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1),
    sourceContracts: z.array(SourceContractSchema).min(1),
    targetContractHash: sha256Schema,
    disposition: z.enum(['native', 'adapter', 'experimental-native']),
    registration: z.literal('advertised'),
    availability: z.array(z.string().min(1)).min(1),
    investment: z.enum(['active', 'deferred']),
    implementationStatus: z.enum(['planned', 'implemented']),
    implementation: z.string().min(1),
    test: z.string().min(1),
    policyId: z.string().min(1),
  })
  .strict();
const UnionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    canonicalTools: z.array(CanonicalToolRowSchema),
    sourceSurfaces: z
      .object({
        lexicalTools: z.array(SourceToolRowSchema),
        figmoshaHelpers: z.array(SourceFeatureRowSchema),
        figmoshaCliParsers: z.array(SourceFeatureRowSchema),
      })
      .strict(),
  })
  .strict();
const RustToolCompatSchema = z
  .object({ schemaVersion: z.literal(1), tools: z.array(SourceToolRowSchema) })
  .strict();
const FigmoshaFeatureMapSchema = z
  .object({
    schemaVersion: z.literal(1),
    helpers: z.array(SourceFeatureRowSchema),
    cliParsers: z.array(SourceFeatureRowSchema),
  })
  .strict();

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

/** Stable JSON bytes used by every checked-in SHA-256 schema contract. */
export const stableContractJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const schemaContractJson = (input: z.ZodType, result: z.ZodType): string =>
  stableContractJson({
    schemaVersion: 1,
    input: input.toJSONSchema({ unrepresentable: 'any' }),
    result: result.toJSONSchema({ unrepresentable: 'any' }),
  });

const assertUnique = (values: readonly string[], label: string): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
};

const unionManifest = UnionManifestSchema.parse(unionManifestJson);
const rustToolCompat = RustToolCompatSchema.parse(rustToolCompatJson);
const figmoshaFeatureMap = FigmoshaFeatureMapSchema.parse(figmoshaFeatureMapJson);

assertUnique(
  unionManifest.canonicalTools.map(row => row.name),
  'canonical tool',
);
assertUnique(
  unionManifest.sourceSurfaces.lexicalTools.map(row => row.name),
  'lexical tool',
);
assertUnique(
  unionManifest.sourceSurfaces.figmoshaHelpers.map(row => row.name),
  'figmosha helper',
);
assertUnique(
  unionManifest.sourceSurfaces.figmoshaCliParsers.map(row => row.name),
  'figmosha CLI parser',
);

if (
  stableContractJson(rustToolCompat.tools) !==
  stableContractJson(unionManifest.sourceSurfaces.lexicalTools)
) {
  throw new Error('rust-tool-compat.json diverges from union-manifest lexicalTools');
}
if (
  stableContractJson(figmoshaFeatureMap.helpers) !==
    stableContractJson(unionManifest.sourceSurfaces.figmoshaHelpers) ||
  stableContractJson(figmoshaFeatureMap.cliParsers) !==
    stableContractJson(unionManifest.sourceSurfaces.figmoshaCliParsers)
) {
  throw new Error('figmosha-feature-map.json diverges from union-manifest source surfaces');
}

export const UNION_MANIFEST: UnionManifestV1 = unionManifest;
export const RUST_TOOL_COMPAT: RustToolCompatV1 = rustToolCompat;
export const FIGMOSHA_FEATURE_MAP: FigmoshaFeatureMapV1 = figmoshaFeatureMap;
