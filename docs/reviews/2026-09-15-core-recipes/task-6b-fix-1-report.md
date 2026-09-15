# Task 6B fix 1: Qualified source context and semantic reviews

Date: September 15, 2026. Status: frozen for independent review; not integrated. The original R1/R2 cases and the expanded supported-scope fixtures pass. A one-character service-root ownership edge case identified during final inspection is explicitly recorded below for controller adjudication.

## Changes

`prepareCoreRecipeSources({ sources, observation, sourceContext? })` now prepares a complete ordered source batch. `sources` contains actual `{ sourceId, reader }` entries. `sourceContext` accepts only the existing strict `services` selectors and `sourceReviews` shapes, defaulting to empty arrays; it is bounded JSON before schema parsing. No caller-supplied complete flag, layer list, graph, closure or self-hash supplies authority. The existing single-source `prepareCoreRecipeSource` delegates to this path; global source indices and multi-reference reviews require batch preparation.

Every root receives its original complete byte inventory, bigint device/inode/root identity and a freshly analyzed graph. The implementation then calls the existing `selectPortalServices` against those actual graphs in the original source-index order. A controller-approved type-only signature change lets `selectPortalServices` and `selectedPortalLayers` accept their actual graph-only inputs; no fake workspace grants, UUIDs, unsafe profile casts or runtime selection-policy change was introduced.

The resulting immutable capsule binds the global request hash, selection hash, review hash, ordered source members and their inventory/graph/root identities, per-source selected and dependency-closure roots, effective path hash and computed layers. Its source hash, bundle source descriptors and input hash include this context. Typed `source-context` rows appear in mapping and implementation-strategy pages. Source facts and canonical mappings link to their context, and page adoption rejects missing context, inconsistent membership, altered context identity, open-ended layer values and invalid relative roots. The core contract hash includes the new page shape and `core-derivation-qualified-source-v2` algorithm identity.

Whole-root selection remains the explicit default. Separately prepared whole-root, unreviewed single-source capsules remain composable for compatibility; qualified or reviewed batches must be supplied intact and in their original order. Same-path sources retain distinct qualified identities. An omitted or reordered qualified member is rejected rather than silently rebased.

## R1: Selected closure and mapping inputs

Effective services, layers and service facts now follow the verified dependency closure. The unrelated `jobs` backend no longer suppresses the Checkout backend-construction obligation when only an independent `web` frontend is selected. A genuinely related backend dependency remains in scope and can provide the backend layer. Entire root inventories and graph identities remain bound even when sibling services are excluded from effective implementation context.

Mapping discovery is filtered **before** the actual component/token/icon parsers and canonical joins. The reader retains its original root, path checks, byte budgets and direct read/import authority. Its semantic walk preserves the real canonical walk's exclusion rules and ordering; qualified filtering happens before the consumer's bounded result cap is applied. Inventory discovery is never filtered. Exact file import and configuration-input edges expand the relevant file set. This is not a subdirectory reader or a post-hoc output-page filter.

Actual effective service `codePatterns` supply mapping profiles and component extensions. Token config paths are rebased from their service-relative location to the original root; child bytes are not represented as a different root package. Multiple compatible profile inputs feed canonical token loading and one bound aggregate hash. Incompatible SVG/utility-reference conventions block mapping instead of arbitrarily choosing an excluded/root profile. Out-of-scope component override paths cannot become candidates; their canonical stale-override evidence remains visible. Direct and generated token discovery limits remain explicit failures.

## R2: Exact semantic reviews and hard limits

The existing selector validates reviews against actual source ID, global source index, issue, path, file hash and offset. Exact admitted Node HTTP review evidence now permits the corresponding reviewed selection to feed strategy derivation even though the raw graph remains intentionally incomplete. Raw diagnostics and actual review records remain paged source evidence; review conclusions/layers are included in immutable input identity.

The implementation uses verified selection completeness rather than unconditional raw graph incompleteness. It preserves conservative closure rules. A semantic review cannot waive byte/inventory failures, syntax errors, diagnostic truncation or unreviewable issues. Selected source-pattern truncation/unread-file conditions and canonical mapping discovery failures remain blockers as well. Stale, wrong-source, wrong-offset and wrong-global-index reviews reject. No review record is accepted merely because it says complete or contains a plausible hash.

This is a pure derivation input binding, not owner admission. A later admitted portal consumer must obtain these selectors/reviews from its authenticated request and persist the exact source context. Capsules remain in-process WeakMap-bound objects and cannot be recreated from JSON or reused after restart without reading admitted source bytes again.

## Validation

All validation ran natively in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

- Final four-file sweep: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-recipes.test.ts packages/shared/test/core-recipe-pages.test.ts packages/shared/test/portal-recipes.test.ts packages/mcp/test/portal/recipe-definitions.test.ts --maxWorkers=1`: **63 passed**, 9.48 seconds. The original 43 cases remain included.
- Shared package TypeScript: exit 0.
- MCP package TypeScript passed before the final concurrent Task 6C edit. The last check reported exactly one non-owned error: `packages/mcp/test/portal/recipe-evidence-hold.test.ts:731`, nullable operation result path passed to a string parameter. The controller was notified; no foreign file was edited. This report does not claim the final whole-package check passed.
- Six owned-file lint and format checks: exit 0.
- `knip --include exports --reporter compact`: exit 0.

New fixtures cover the reproduced frontend/unrelated-backend case, scoped component candidates and stale overrides, explicit whole-root default, related runtime/config and backend dependencies, excluded Angular-root versus selected React profile/extension/token behavior, accurately rebased literal Tailwind config, full-root relative dependency evidence, exact Node HTTP review and changed review identity, stale/wrong reviews, same-path multi-reference ordering, hard syntax/byte/discovery/pattern limits, truncated diagnostics despite exact reviews for every retained issue, context page mutation/removal, and bounded getter-free request parsing.

Canonical limitations remain explicit in tests: imported theme objects are not evaluated by the existing static token parser, so the required value remains unmapped with a reuse-review obligation rather than a guessed token. Vue runtime analysis currently emits `UNSUPPORTED_RUNTIME_SOURCE`; it remains blocked without review, and exact review retains the existing conservative closure instead of fabricating a narrower selection. The supported mixed-framework fixture uses Angular/React to isolate selected-profile behavior without waiving either limitation.

The original diagnostic remains disabled and unchanged, SHA-256 `46d8f428c3773bf0b74d20191cd31b3b9822b844a11a5f01c4b68fefe19f59e2`. No original diagnostic was enabled or copied into source. Earlier temporary Vue/imported-theme assertions were corrected to match the actual supported contracts; production parsers were not changed to make them pass.

## Final inspection edge case requiring adjudication

After freezing the final test bytes, inspection found that both the pre-existing `service-graph.ts` `fileRoot` helper and this slice's corresponding `core-source.ts` `ownerRoot` rank matching roots by string length. The root `.` ties a one-character service root such as `a`, and the stable sorted order puts `.` first. This appears to assign `a/x.ts` to `.` rather than `a`. The controller was notified immediately. The final suite uses `web`, `jobs`, `shared` and `api`; it does not prove this edge case safe. A focused real-filesystem reproducer and coordinated graph/ownership correction are required if confirmed. Merely fixing mapping ownership would leave the freshly analyzed graph's layers and dependency edges inconsistent. No unapproved `service-graph.ts` edit was made.

## Integration boundaries and files

The full six-file allowlist with verified original main preimages is `task-6b-owned-files.json`; the delta and original frozen hashes are in `task-6b-fix-1-owned-files.json`. The first five files are the original ownership. `service-selection.ts` has only two parameter-type changes, independently confirmed with a no-index diff. The source remains frozen for review.

| File | SHA-256 |
| --- | --- |
| packages/shared/src/portal-recipes.ts | d30f92999cf21829b556dde6fee2d151c57ecb4f82903a5c0618fd710b295c90 |
| packages/shared/test/core-recipe-pages.test.ts | b5a59323a4d7c682538449bba0f0f51c4b03592c6162d65f4bdf575ccf5ebea8 |
| packages/mcp/src/portal/recipes/core-source.ts | 946148f7cdc8d0bfd8c8f27bf24ce88c9b297258f500076438af3dd7e54d910c |
| packages/mcp/src/portal/recipes/core-derivation.ts | 3bfe821361cf4f01677ab30e5cb08b514b5fe67395b755b3eaf15b97690acaa6 |
| packages/mcp/test/portal/core-recipes.test.ts | c46340627c8cea2c33559b25e500ba8365b1cc1b598b3807ec0ef380c8ad5fe7 |
| packages/mcp/src/portal/service-selection.ts | 71a5d6cb637761f96d137594aba676e72156daa7149a0ad4fd7dd3f8b7051b93 |

Actual owner admission, durable preparation, signed result retention, lease gates, candidate/native consumption, live validation and public routing remain later Tasks 6C/6D/6E/6H. No CLI/6F/6C client, capture, preview/native, shared portal, IR, mapping implementation, browser, Figma, daemon, build, dependency or Git mutation was made. No Superpowers, Docker or subagents were used. The native copy shares the Windows account's filesystem, network and process privileges and is not an OS sandbox.
