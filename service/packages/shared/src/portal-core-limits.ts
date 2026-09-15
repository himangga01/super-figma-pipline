export const PORTAL_CORE_RECIPE_IDS = [
  'ground-design',
  'map-design',
  'derive-tokens',
  'audit-styles',
  'resolve-assets',
  'derive-interactions',
  'plan-design-implementation',
] as const;

export const PORTAL_CORE_RECIPE_LIMITS = Object.freeze({
  pageRows: 256,
  pageBytes: 1_048_576,
  pages: 4096,
  bundleBytes: 134_217_728,
  assetBytes: 536_870_912,
  assetFileBytes: 16_777_216,
  tokenResolutionCells: 200_000,
  auditBindingComparisons: 1_000_000,
});
