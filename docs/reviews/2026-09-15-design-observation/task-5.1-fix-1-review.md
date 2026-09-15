# Task 5.1 correction 1 independent review

Date: 2026-09-15. Reviewer: `review_capture_observation`.

## Outcome

Specification: **pass** for the four accepted findings and their immediate edge cases. Quality: **pass**. No remaining actionable finding was identified in this scoped correction review. The initial review remains preserved in `task-5.1-review.md`.

| Finding | Verification | Outcome |
| --- | --- | --- |
| R1: malformed values resolved | Resolution validates recognized declared types and matching value families, including alias-hop type compatibility. Original arbitrary FLOAT-object probe is now unresolved. Legitimate RGB/RGBA, primitive, TIMING and installed MotionEasing families retain raw values without coercion; malformed/unknown values remain unresolved. | Addressed |
| R2: inconsistent coherence | Both exported boundaries reuse `coherenceMatchesContent`. Independent identifier-only and content-hash-only mismatch tests reject; changed observations remain representable. Original combined-mismatch probe now rejects. | Addressed |
| R3: invalid forest | Parent existence, reverse edges, incoming edge cardinality, root identity and iterative reachability are checked. Orphan, omitted reverse edge, self/disconnected cycle and incorrect-root tests reject. A valid multi-root forest passes. Node/edge limits bound traversal. | Addressed |
| R4: partial-tree node capability | Successful complete/empty bindings, component API and interaction assertions require observed, structurally complete retained tree data. Known truncated, duplicate and malformed trees reject. Independent catalog claims remain valid with matching counts. | Addressed |

R4 follows the controller's adjudication: the current contract has no independent applicable-node scope proof, so known tree omissions invalidate node-capability success. This does not require a separate successful tree provenance assertion when a structurally valid tree is present; the later admitted collector must establish actual applicable-node coverage.

The value whitelist was checked against the installed `packages/plugin/node_modules/@figma/plugin-typings/plugin-api.d.ts` definitions of `VariableResolvedDataType`, `MotionEasing` and `NormalizedSpring`. No upstream or dependency file was changed.

## Fresh verification

Commands ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-normalization.test.ts packages/shared/test/design-observation.test.ts packages/mcp/test/portal/design-evidence.test.ts
3 files passed; 48 tests passed; exit 0.

node node_modules/vitest/vitest.mjs run --config artifacts/review-observation-20260915/vitest.config.ts
1 file passed; all 4 original independent probes passed unchanged; exit 0.
```

All five final source/test files match the refreshed owned-files SHA-256 manifest after these runs:

| Path | SHA-256 |
| --- | --- |
| `packages/shared/src/design-observation.ts` | `08a09f40a923e58178092e01644941f32697c7de9415f9ce2cc4fdc5cadb1513` |
| `packages/shared/src/index.ts` | `d1933cf8dd4a869ec9ca56a6e93e4662b66e48d50211bd709b08bbd5077ddaee` |
| `packages/mcp/src/portal/design-normalization.ts` | `7403fa6f6c579a439067ab7acfd458d249b0994df9d3b5c025403ee0310c4399` |
| `packages/mcp/test/portal/design-normalization.test.ts` | `ec1a05caf90f8e6bfc93b05733ba27d791b89d6f9b1625328317c998fa2e07c4` |
| `packages/shared/test/design-observation.test.ts` | `58c0d67795eab65e10f316267c8925f141cd1fa8898218bc0bd30d41327f348c` |

This review did not reopen later admission, storage, mapping or live-capture integration scope, and does not claim whole-service acceptance. No owned source, diagnostic tests, other workers' files, build output, browser, Figma state, daemon, index, commits or remote refs were changed. No Superpowers, subagents or Docker were used. Native validation shares the current Windows account and host permissions; the separate copy is not an OS sandbox.
