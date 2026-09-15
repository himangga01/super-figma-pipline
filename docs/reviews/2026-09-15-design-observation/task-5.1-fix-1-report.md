# Task 5.1 review correction 1

Date: 2026-09-15. Status: all four accepted review findings corrected; controller re-review and integration pending. Initial implementation, review and hash evidence remain unchanged in the initial task artifacts.

## Corrections

### R1: Validate binding values and alias type compatibility

Variable resolution now requires a recognized declared type and a matching observed value. BOOLEAN and STRING remain their exact primitive types; FLOAT and TIMING require finite numbers. COLOR accepts legitimate RGB and RGBA without adding or changing channels, validates channel ranges and optional serialized hex. EASING accepts the currently installed Figma motion easing families, including HOLD, custom cubic bezier and normalized spring data. Required custom payloads and their numeric fields are checked. Unknown future types or malformed values remain raw catalog evidence and produce unresolved bindings with `MALFORMED_VALUE`; they are not silently coerced or returned as resolved objects.

Every variable alias hop must retain the original declared resolved type. A FLOAT alias into a STRING variable is unresolved even when the STRING's own value is valid. The existing same-type cross-collection alias and independent node mode selection behavior remains covered.

Source reference: installed `packages/plugin/node_modules/@figma/plugin-typings/plugin-api.d.ts` defines `VariableResolvedDataType`, including TIMING, and the actual `MotionEasing` / `NormalizedSpring` families. No dependency or upstream file was modified.

### R2: Apply coherence invariants at both public boundaries

A single coherence/content predicate is now used by both `DesignCollectorEvidenceSchema` and `DesignObservationSchema`. Observed coherence must bind the enclosing content hash, and matched before/after identifiers must be equal. Independent tests modify only the identifiers and only the hash; both are rejected. A genuine changed observation remains representable. This is structural consistency of provenance, not authorization or independent live verification.

### R3: Enforce a bounded valid forest

The public observation schema now requires every parent to exist, every non-root node to appear exactly once in its parent's child list, every listed child to name that parent, and roots to match parentless nodes. Iterative traversal from roots must reach every node exactly once. Orphans, omitted reverse edges, self cycles, disconnected cycles and incorrect root sets are rejected; a valid multi-root forest passes. The validation is bounded by the existing 100,000-node limit and an explicit 100,000-edge scan bound, without recursive ancestor traversal.

### R4: Require structural full-tree coverage for successful node capabilities

Complete or empty bindings, component API and interaction evidence now requires a structurally valid fully retained tree. Known truncation, omitted children, duplicate/malformed tree entries and tree-level incompleteness reject such claims even when their count matches the retained subset.

As confirmed by the controller, this is a structural/full-retention requirement. It does not require an additional successful tree enumeration assertion when the raw tree is otherwise valid but legacy provenance remains unverified. Explicit empty proof over a valid tree remains supported; the collector remains responsible for actual applicable-node coverage.

Independent catalogs are kept independent. An unfinished tree or Desktop section plan alone cannot invalidate a separately observed complete catalog with the correct count. Generic value truncation remains conservative for all capabilities because the omitted value may belong to any catalog. Tests cover complete and empty claims for all three node capabilities and successful independent variable enumeration on partial trees, including a top-level unfinished-tree flag.

## Validation

All commands ran natively in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

The new focused regressions were run before implementation: **13 failed and 33 passed across two files, exit 1**, reproducing malformed object/primitive/color/easing resolution, alias type mismatch, false coherence, invalid forests and incomplete-tree binding coverage. Additional positive and negative cases were then retained in the owned test files.

Final focused suite:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-normalization.test.ts packages/shared/test/design-observation.test.ts packages/mcp/test/portal/design-evidence.test.ts
3 files passed; 48 tests passed; exit 0.
```

The original independent review probes were also rerun without editing their files:

```text
node node_modules/vitest/vitest.mjs run --config artifacts/review-observation-20260915/vitest.config.ts
1 file passed; 4 tests passed; exit 0.
```

Static checks pass:

- Shared package TypeScript check, exit 0.
- MCP package TypeScript check, exit 0.
- `oxfmt --check` on the five owned files, exit 0.
- `oxlint --deny-warnings` on the five owned files, exit 0 after correcting one local variable shadowing warning.

## Final candidate hashes

Paths are relative to the isolated `service` directory. The shared barrel export is unchanged from the initial implementation. The controller should compare these final bytes against the preserved initial review diff before integrating them.

| Path | SHA-256 |
| --- | --- |
| `packages/shared/src/design-observation.ts` | `08a09f40a923e58178092e01644941f32697c7de9415f9ce2cc4fdc5cadb1513` |
| `packages/shared/src/index.ts` | `d1933cf8dd4a869ec9ca56a6e93e4662b66e48d50211bd709b08bbd5077ddaee` |
| `packages/mcp/src/portal/design-normalization.ts` | `7403fa6f6c579a439067ab7acfd458d249b0994df9d3b5c025403ee0310c4399` |
| `packages/mcp/test/portal/design-normalization.test.ts` | `ec1a05caf90f8e6bfc93b05733ba27d791b89d6f9b1625328317c998fa2e07c4` |
| `packages/shared/test/design-observation.test.ts` | `58c0d67795eab65e10f316267c8925f141cd1fa8898218bc0bd30d41327f348c` |

## Limits and ownership

Only the original five-file ownership set was used; this correction changes four of those source/test files and leaves the existing barrel export unchanged. No shared portal schema, CLI collector, admission/store/coordinator, native runtime, dependencies, primary build output, index, commit or remote state was changed. No Superpowers skills, subagents, Docker, browser, daemon or Figma interaction was used. No source was copied into the main checkout; this report is the only new main-workspace file from this correction.

The separate working copy still shares the host's Windows account, filesystem permissions, network and process namespace. Whole capture integration, applicable-node collector proof, live coherence, mapping, durable acceptance and final service verification remain later task boundaries.
