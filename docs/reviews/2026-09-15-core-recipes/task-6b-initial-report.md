# Task 6B: Actual core recipe derivations

Date: September 15, 2026. Status: bounded implementation complete, frozen for independent main review. Task 6C/6D storage and portal integration, Task 6E consumption verification, and conditional authoring remain separate work. No complete portal workflow or current live Figma acceptance is claimed here.

## Scope and ownership

Implementation and native checks used only `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. The five owned paths are listed below. Main source, shared index, shared portal contracts, IR portal run, coordinator/native/store, mapping implementations, capture/CLI/plugin/policies/result schemas and public metadata/skills/prompts were not edited. Temporary repository fixtures were created and removed by their tests. Historical diagnostic files were not changed.

No Superpowers, Docker, subagents, browser/daemon/build, dependency installation or Git mutation was used. Native tests run with the same Windows account and filesystem/process/network privileges; the separate working copy is not an OS sandbox. Original `code-kb` repositories stayed read-only. This task reuses the currently reviewed service adapters, rather than claiming that the current Figwright checkout HEAD equals the lockfile pin. Main's noted upstream HEAD/pin discrepancy remains a provenance task; no new claim about unreviewed upstream HEAD material is introduced.

## Exported API and integration contract

### `prepareCoreRecipeSource({ sourceId, reader, observation })`

This asynchronous read-only adapter produces a frozen, opaque `PreparedCoreRecipeSource` for a particular normalized observation. It uses the actual bounded `RepoReader`, complete source inventory before and after analysis, actual root device/inode/path identity, the reviewed service graph analyzer, and canonical mapping adapters:

- `mapObservationComponents`, `mapObservationTokens`, `mapObservationIcons` and `normalizeMappingObservation`;
- actual project profile, component/SVG scans, persisted overrides and token source loader;
- current compact `mappingResults` v1 shape, including `codeSourceHash`, per-item status and override status.

The source ID is caller-supplied qualification, not proof of a grant. The reader's normal boundaries still apply. A capsule is an in-process derivation binding, not actor permission, a signature or protection against arbitrary same-account JavaScript. Nested payloads are frozen. Forged/deserialized objects and a capsule for another observation are refused. Restart must re-read admitted bytes; JSON must never be promoted into a trusted capsule. The source descriptors emitted by the bundle are serializable and can later be included in signed preparation evidence.

Before/after inventory and root checks detect observed source changes. They are optimistic reads, not an OS transaction or an assertion that ABA changes are impossible. The canonical token loader additionally binds its actual parser inputs. Unavailable canonical mapping stays an explicit blocked mapping result while retained source/graph evidence remains available; there is no duplicated join/scoring algorithm or fabricated matched-row input.

### `deriveCoreRecipeBundle({ observation, strategy, requiredRootIds?, assets, sources? })`

This is pure derivation. It accepts previously allocated actual asset buffers with captured records and the optional source capsules, returning:

- bundle version, contract hash, input hash and exact observation hash;
- qualified source/root/inventory/graph/code-source hash descriptors;
- seven internally selected required results: grounding, mapping, tokens, style audit, assets, interactions and implementation strategy;
- typed content-addressed pages and `sfp.recipe.core-manifest.v1` outputs, with output hashes using the existing `sfp-portal-recipe-output-v1` domain.

There is no requested-recipe omission switch. Captured observation roots are always included, even when the caller supplies only a subset. Additional requested roots are checked for presence. Primitive roots still need their own export/implementation obligations. An empty captured scope is blocked.

Normalized observations are rebuilt from their retained raw material and collector evidence before use, rather than accepting modified normalized fields under an unchanged content hash. Coherence/source-binding/collector status and required capability coverage remain explicit. Missing/partial/unsupported/failed catalogs cannot become proved-empty results.

### `verifyCoreRecipePages(manifest, pages)`

This adoption helper verifies the current contract hash, required capability set, exact page count/order/identity/bytes, unique row IDs, aggregate issue/blocking/obligation counts, observed-material hashes and reconstructed canonical mapping hashes. It rejects missing/duplicate mapping members and wrong member indexes. It does not verify owner signatures or establish actual candidate/runtime consumption.

`CORE_RECIPE_CONTRACT_HASH` binds page/manifest structure, algorithm version, bounded observed-JSON codec version and limit constants. Existing binding/interaction schemas use custom observed-JSON codecs; their JSON-schema projection follows the repository's established `unrepresentable: any` treatment while the runtime codec and explicit limits remain enforced. This does not introduce an arbitrary execution payload.

## Implemented behavior

| Core family | Actual derivation |
| --- | --- |
| Grounding | Retains each scoped node's property identity and all observed component API/property definitions and override families; emits every captured/additional root obligation and blocks missing roots/capabilities. |
| Tokens/styles | Preserves collection IDs and full collection material, every retained variable/mode ID and value, variable metadata, all four style families, binding mode selections/alias chains/reasons and rendered values. Canonical token resolution supplies per-mode primitive exports. Names and default mode labels never select a node mode. |
| Specialized values | TIMING/EASING material is retained explicitly, not coerced into invented CSS units. Unknown future variable types remain retained and blocked. Unsupported style structures such as gradients, images and NOISE remain raw observed style material, with unsupported scalar export instead of silent deletion. Bound paint styles are not exported as an unconditional default color. |
| Style audit | Compares actual paint/text material, opacity and links; retains duplicate-style ambiguity, exact observed override fields, raw/unresolved states and per-text-range observations. Non-array mixed material becomes an unresolved row, not a proved-empty audit. Indexes avoid node-by-catalog quadratic paint comparisons. |
| Mapping | Consumes actual canonical results from frozen source capsules; preserves source IDs, complete inventories, code-source hashes, status and verified/legacy/stale overrides. Multiple high/medium matches from distinct sources become an explicit ambiguity. Canonical component/icon memberships are paged and reassembled against the original canonical hash. |
| C4 construction | Emits component, token/style and icon construction obligations even without a reusable reference catalog. A design with no catalog still requires root component construction. No candidate data is fed back into the derivation input. |
| Assets | Verifies supplied actual byte lengths and SHA-256 under per-file/aggregate limits. Root PNGs, vector SVGs and original image usages remain distinct even when bytes match. Image-hash case aliases are normalized for query identity; duplicate semantic queries reject. Export fallback metadata is retained. |
| Interactions | Produces source action/index/destination/temporal expectations and implementation obligations for supported navigation/overlay/change/close/back flows. Missing destinations, absent actions, unsupported triggers/actions and motion requiring separate temporal assertions remain explicit blocked evidence. Raw reactions are retained. |
| Read strategy | Reuses the reviewed workflow analyzer and qualified service graphs. Service structure, individual source evidence/connection/edge items and workflow candidates are paged separately. Required layers absent from a frontend-only C3 reference produce construction obligations; C4 stays frontend-only. Draft/unclassified interactions retain obligations for the confirmed blueprint rather than becoming implementation proof. |

`ready` means this derivation produced its evidence without a blocking capture/source/analysis issue. It does not mean that a strategy was confirmed, code was generated, an obligation was implemented or a runtime assertion passed. Required obligations still need actual blueprint resolution and consumption verification. Definitions remain `execution: planned`; this task did not relabel availability metadata as completed workflow execution.

## Bounds and fidelity limits

- Pages contain at most 256 typed rows and 1 MiB; bundles at most 4,096 pages and 128 MiB of page material. A single observed material value is bounded at 512 KiB/50,000 JSON values. Exceeding these limits is explicit, never successful truncation.
- Mode resolution is capped at 200,000 variable/collection-mode cells before calling the canonical resolver. A sparse oversized matrix becomes blocked while its actually retained variable values still receive rows. Audit binding comparisons are capped at 1,000,000.
- Asset input verification allows at most 16 MiB per buffer and 512 MiB aggregate. The pure function does not control allocation performed by its caller before invocation. Actual image decoding, source-export provenance/geometry and browser visual equivalence are later capture/native verification responsibilities; byte equality alone is not visual or live-source acceptance.
- The raw observation remains part of the input evidence and its hash. Normalizer-reported rejected/conflicting material keeps blocking issues and raw evidence; this task does not manufacture a conflict-free replacement catalog.
- Unsupported interaction expressions/media/variable actions and separate motion timing still require the relevant assertion implementation. Scalar CSS export can be unsupported even while the original typed material is retained for an appropriate framework implementation.
- Source capsules cannot be reused after restart or treated as durable authority. Owner admission, signed retention, mutation/replay recovery, lease gates and native consumption remain outside this pure layer.

## Tests and checks

Final commands from the isolated service root:

| Check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-recipes.test.ts packages/shared/test/core-recipe-pages.test.ts packages/shared/test/portal-recipes.test.ts packages/mcp/test/portal/recipe-definitions.test.ts --maxWorkers=1` | 4 files, 43 tests passed, 6.59 seconds, exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json` | Exit 0 |
| Owned five-path `oxlint --deny-warnings` | Exit 0, no warnings/errors |
| Owned five-path `oxfmt --check` | All matched files formatted, exit 0 |
| `node node_modules/knip/bin/knip.js` | Exit 1 for one concurrent-owner unused type: `RecipeAuthority` in `packages/cli/src/recipe-plan.ts:214`; no Task 6B finding |

The 43-test sweep includes 24 new core/page tests and 19 Task 6A regression tests. New evidence includes Chrome/Desktop semantic parity; proved empty versus absent APIs; caller-omitted and missing required roots; styles-only export; opacity/ambiguity/mixed/range audit; real asset buffer tampering and duplicate queries; image/vector/root distinctions; current/stale canonical override proofs; two same-path reference sources; real source mutation between inventory and analysis; frontend-only C3 missing layers versus C4; 4,200 variable-mode rows; 4,200 component-member rows; sparse matrix budget retention; cyclic/getter/long-ID page input; contract/count/material/member tampering; deterministic hashes; and frozen state.

During development, failing fixtures identified missing JSON omission in a test input, a paint fixture missing the canonical `visible` field, a deliberately varying-mode token that correctly could not receive a fixed-value verified override, and a matrix fixture above the normalizer's existing 128-mode limit. Fixtures were corrected to exercise their intended supported contracts; the production gates were not weakened. A Zod custom-codec JSON-schema projection needed the repository's explicit codec treatment. Earlier concurrent Desktop fixture/type issues cleared before the final successful package typechecks.

## Exact owned bytes

`task-6b-owned-files.json` provides the five final paths, hashes and main preimages. Shared recipe contracts have the reviewed Task 6A fix-1 preimage; all four other paths are new in main. Source is frozen for review. Recheck these bytes/preimages before copying.

| Service-relative path | SHA-256 |
| --- | --- |
| packages/shared/src/portal-recipes.ts | f77398f582bdcace3b54b386d75e7e1a2eb5f680b0780e01791135fa63d27fb5 |
| packages/shared/test/core-recipe-pages.test.ts | 4b1acfea8c3b6cfe26a7dffedb154b3c5d44e81459316ea26bc9b96687ef6165 |
| packages/mcp/src/portal/recipes/core-source.ts | e1972c264db38584669131f91797774ccfe138eaaa3584fd4d8abe9f47d05fec |
| packages/mcp/src/portal/recipes/core-derivation.ts | d2ca7e6d3c2e6abc3f72e9e001f37447f36411883cf418828def6836c796a9c2 |
| packages/mcp/test/portal/core-recipes.test.ts | 38dcb640e8a5d5f319331321838ff6e151c735d3aef7069e572c0b56f4db625a |

## Required next integration

1. Independently review and integrate these exact bytes. This is not either final whole-code review round.
2. Task 6C must persist the immutable admitted input and its source/capture authorities, actual manifest/pages and preparation checkpoints; use `verifyCoreRecipePages` before adopting results and enforce owner-wide reference retention. Recreate source capsules from admitted bytes after restart.
3. Task 6D must update selected core definition schema/behavior identities to this core-manifest contract, run preparation under actual admission, bind required result hashes into the resolved blueprint before leasing, expose pages/work items, and preserve/fence old state. Existing Task 6A definitions deliberately still advertise their planned output contracts until this integration is implemented.
4. Task 6E must resolve obligations and verify actual source/runtime use, including correct modes, visible components/assets, required source-root observations and full operational layers. It must not treat `ready`, a material hash or a draft workflow candidate as proof of implementation.
5. Complete conditional authoring and unsupported relevant interactions/motion, modernize actual skills/prompts/metadata, finish live/native cases, then perform both final code-review rounds and final clean-source verification before the authorized commit/main push.
