# Task 5.1: Bounded design observation and normalization foundation

Date: 2026-09-15. Status: implementation complete for the assigned foundation; controller review and integration pending.

## Scope and implementation

Only the five owned service files below were edited in the separate native source copy at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. The main checkout receives this report only. No Superpowers skills, subagents, Docker, browser, daemon, Figma calls, primary build output, dependencies, staging, commits or push were used. Native validation shares the current Windows account, filesystem permissions, process namespace and network; the working copy is not an OS sandbox.

The existing `normalizePortalDesign` preserves Chrome object compatibility. Desktop output now exposes the actual `variables.variables` and `variables.collections` arrays rather than wrapping the complete variable-definitions response as a token. Styles remain under the original `styles` namespace; document `globalVars` has its own namespace. The legacy Desktop completeness behavior remains conservative, and cyclic tree traversal no longer repeatedly revisits the same object.

The new pure `normalizeDesignObservation(raw, collectorEvidence?)` produces `observationVersion: 1`, flat nodes with parent/child identities and non-recursive raw properties, variable and collection catalogs, separate paint/text/effect/grid style catalogs, style-variable definitions, raw component contracts/overrides, source-linked reactions and per-property variable binding observations. The retained raw record is an owned JSON copy. No source values are replaced with null solely for normalization. Chrome variable collection IDs and Desktop collection IDs normalize to the same explicit field while preserving each original variable record.

Bindings resolve only through captured collection IDs and mode IDs. Current-node resolved modes and nearest captured ancestor resolved/explicit selections retain their node ID and basis. Aliases entering another collection use that collection's captured selection. Matching mode names, default modes and first available values are not resolution evidence. Missing ancestor context, missing remote variables, missing modes, malformed mode selections and cyclic/over-budget aliases remain unresolved. Rendered property values are retained separately from catalog-resolved values.

The image-reference planning helper preserves distinct source usages for node fills, strokes, Chrome `textSegments` and Desktop `segments`, including both fill and stroke paints in text runs. Shared immutable image bytes may subsequently be fetched once without losing their usage identities.

## Collector interface and evidence boundary

Chrome input remains `{ source: 'figma-plugin-api-via-scripter', nodes, tokens, collections, styles? }`. Optional `styles` uses the actual Desktop `GetStylesResult` family names: `paints`, `texts`, `effects`, `grids`, and optional `variables`. Desktop input remains `{ source: 'desktop-plugin', document, variables: { variables, collections }, styles }`.

New evidence is supplied separately from raw records and parsed with `DesignCollectorEvidenceSchema`. Its `evidenceVersion: 1` and `contentHash` must match the normalized semantic content. Raw legacy `liveVerified`, `complete`, coverage flags or similarly named evidence cannot promote a legacy observation.

Capability names are `tree`, `variables`, `collections`, `paintStyles`, `textStyles`, `effectStyles`, `gridStyles`, `bindings`, `componentApis`, and `interactions`. States `complete`, `empty`, `partial`, `unsupported`, and `failed` remain distinct. `count` is the collector's known enumeration count or explicit null; normalized `retainedCount` is the number of retained normalized rows. Successful complete/empty evidence requires a known count matching retained rows, and empty requires zero. A failed/partial/unsupported enumeration may have no known count while retaining some rows. Legacy arrays, including empty arrays, never imply successful enumeration. Known malformed or truncated data cannot satisfy a complete capability claim.

Explicit external empty proof for a node capability can be represented over a valid tree even when its node fields are absent. The later collector must actually establish coverage of every applicable node: absence of an INSTANCE API field cannot itself establish an empty component API enumeration. This foundation does not perform collector admission or independently verify those assertions.

Coherence records describe non-atomic content re-observation or document-epoch observations. Matched evidence requires equal before/after identifiers and the same semantic content hash. Source binding separately records observed file identity, scope, session, generation and binding method. All such records describe collector provenance; none are authorization grants or proof of live/atomic capture. Legacy records receive unverified coherence and source binding.

The semantic hash binds source, scope, original tree/catalog/style containers (including rejected or duplicate raw entries) and global variables. It excludes outer capture timestamps and timing diagnostics. Object-key ordering is canonical; array ordering remains part of source content. Chrome and Desktop raw serialization differences may produce different hashes even when normalized values and bindings are equivalent.

## Bounds and failure behavior

- Raw JSON is checked before hashing, retention, recursion or schema parsing: 16 MiB encoded JSON, 500,000 values, depth 128, finite numbers, plain objects/dense arrays, no accessors, cycles or non-JSON values. UTF-8 byte accounting includes JSON escapes and surrogate handling before serialization.
- Each raw array is bounded to 100,000 entries; object keys and schema field lengths are bounded. Normalized output has a separate 64 MiB / 2,000,000-value preflight. This limits combined raw retention and normalized evidence; it is not a claim that the asset capture budget is 64 MiB.
- Nodes: 100,000. Each catalog family: 10,000. Bindings/interactions/image usages: 100,000. Alias chains/mode observations: 128. Aggregate alias/ancestor resolution work: 500,000 steps. Individual reaction action arrays: 4,096. Recorded issues: 256.
- Malformed, duplicate, truncated and catalog-over-limit observations retain their raw evidence and explicit partial issues. Cyclic, unsupported-source, non-JSON and global-over-limit records fail before stronger observation publication. Issue-array exhaustion does not reset the internal incomplete capability set.

## Validation

Initial TDD command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-normalization.test.ts`.

Initial result: 6 failed tests, including the actual existing Desktop variable-wrapper mismatch and the new missing observation APIs. The implementation then passed those six tests.

Final focused command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-normalization.test.ts packages/shared/test/design-observation.test.ts packages/mcp/test/portal/design-evidence.test.ts`.

Final result: **3 test files, 23 tests passed, exit 0**. Coverage includes equivalent Desktop/Chrome bindings; style namespaces; legacy fencing; missing API versus externally proved empty; null enumeration counts and failed/partial/unsupported states; content binding and timestamp stability; sibling/ancestor selections and independent cross-collection aliases; missing remote aliases, cycles and absent modes; component APIs/overrides and ordered reactions; duplicate/malformed entries; raw and catalog limits; input mutation isolation; text-run/stroke image references; bounded aggregate alias work; strict versions/coherence; UTF-8 byte limits; accessors, sparse arrays, cycles and excessive depth. Existing design-evidence paging tests pass unchanged.

Final static checks, each exit 0:

- `node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json --noEmit`
- `node node_modules/typescript/bin/tsc -p packages/mcp/tsconfig.json --noEmit`
- `node node_modules/oxfmt/bin/oxfmt --check` with exactly the five owned paths
- `node node_modules/oxlint/bin/oxlint --deny-warnings` with exactly the five owned paths

Earlier full MCP typechecks observed transient errors in concurrently edited native/CLI files; their owners corrected them. The final commands above passed. No full build, full source verification or live capture acceptance is claimed by this bounded task.

## Exact reviewed-source candidates

Paths are relative to the isolated `service` directory. Hashes are SHA-256 of the final tested bytes.

| Path | SHA-256 |
| --- | --- |
| `packages/shared/src/design-observation.ts` | `77a070c92ec79d42afd82d9306458341caefb7405d5b0f9a2a405301449810b2` |
| `packages/shared/src/index.ts` | `d1933cf8dd4a869ec9ca56a6e93e4662b66e48d50211bd709b08bbd5077ddaee` |
| `packages/mcp/src/portal/design-normalization.ts` | `729303dd620f1b981e2b665d6975f6a525f2ba0a22bb6cd8bb8b04933c6d8f9d` |
| `packages/mcp/test/portal/design-normalization.test.ts` | `e02baa9ccea0d934f30399afd22bdde138af5780e36f4da0680be77f1aa33b96` |
| `packages/shared/test/design-observation.test.ts` | `c7ce8542607335843b345dd9b096b15af66fcb0364476470611617b99941fb7c` |

Main preimages observed before integration: `packages/shared/src/index.ts` = `7fcb3a14730e18ede4aa07e574a81a055bc897582724bdb78c030768705d2937`; `packages/mcp/src/portal/design-normalization.ts` = `051341df27d9506900e5cc1c1a3e0e8e85a7a851745cd44036246a1a738dd49b`. The other three paths do not yet exist in main. No owned source file was copied to main by this implementer.

## Remaining boundaries

This is not whole capture pipeline parity. Later tasks must integrate admitted Chrome/Desktop collectors, applicable-node enumeration proof, coherent tree/catalog/export observations, checkpoint/storage contracts, canonical mapping/override consumers, source-linked required interaction coverage, distinct visual receipts and actual C4 acceptance. A recognized reaction wire family is retained observation, not proof that an executable recipe covers every nested action or motion semantic. The image-reference helper does not independently establish a complete export manifest. Existing legacy consumers continue using `normalizePortalDesign`; stronger observation analysis is a separate export until those integrations are reviewed.
