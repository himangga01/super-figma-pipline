# Task 6A: Recipe contracts and closed definition catalog

Date: September 15, 2026. Status: bounded implementation complete; independent main-agent review/integration pending. This does not complete Task 6 or activate any recipe executor.

## Scope and limits

Implemented only in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. Main source was not edited. The only main writes are this report, `task-6a-owned-files.json`, and the captured index preimage. The original `code-kb` trees remained read-only. No Superpowers, Docker, subagents, browser/daemon/build, dependencies, staging, commits or push.

The native checks ran under the existing Windows account in the separate working copy. This is source separation, not filesystem/process/network isolation or an OS sandbox.

## Implemented contracts

- Explicit recipe authority v1, absent/zero legacy inspection, and stable current/future/invalid marker fences. No missing marker becomes current. Existing portal records and consumers are untouched.
- Strict stage separation: input context contains owner/workspace/intent, authority/capture/assets/scope/source hashes and definition selections; results contain context/definition/input bindings; blueprint bindings contain required result hashes; candidate declarations contain exact file/assertion references without a candidate hash; verified-consumption records contain the resulting candidate hash and concrete runtime/source/review evidence.
- Eleven closed result families selected by `schemaId`: grounding, mapping, tokens, style audit, strategy, interactions, assets, targets, paint, authoring and diagnostics. They contain structured evidence items rather than an arbitrary JSON payload. Result failure/blocked/cancelled/unknown variants cannot carry a successful output.
- Closed typed input options for mode, node/Figma URL/page/selection/exact-name target, local/library variable, palette, type-scale and directional clone planning. There is no arbitrary caller JavaScript, callback, command or JSONPath.
- Closed tool/derive/readback steps; duplicate steps and forward/unsupported/incompatible result references reject. Reference fields match canonical producer shapes, including imported variable `id` and collection `defaultModeId`. A declared write/import/artifact step requires its effect classification.
- Explicit per-record JSON validation before recursive schema parsing: 16 MiB and 200,000 values, rejecting cycles/accessors/non-JSON; bounded result items, references, steps and declarations. These limits do **not** implement owner-wide persistent retention, reference counting or execution budgets.
- Pure domain-separated content identity helpers bind definition behavior/verifier versions, actual input/output/step structural schemas and enforced limit constants. Context selection/source/capability and blueprint required-result order is canonicalized; candidate declarations canonicalize their file/assertion references. Result binding helpers check owner/workspace/context/input/definition/output identity and refuse failed or tampered results. These helpers do **not** verify a signature or manufacture server ownership.

## Definition and feature inventory

The immutable catalog includes 34 stable recipe IDs, all explicitly `execution: planned`, with `recipe-executor-and-verifier-not-integrated` prerequisites. They are declarative ordered specifications, not runnable implementations. Typed authoring parameter expansion and verified dispatch remain Task 6F/6G work. The incomplete annotation writer and experimental motion/readback prerequisites are explicit.

All 69 original non-tool features are recorded with source-qualified IDs, pinned revision, source path, actual semantic intent and recipe mappings:

| Surface | Count |
| --- | ---: |
| Rust skills | 13 |
| Rust prompts | 12 |
| Figwright skill families | 2 |
| Figwright reference documents | 10 |
| Figmosha helpers | 20 |
| Figmosha CLI parser entries | 12 |

Every adapted feature has an exact bidirectional recipe mapping. Unknown/duplicate feature IDs, duplicate recipe IDs and mismatched feature assignments reject. `figmosha.cli.exec` is deliberately rejected with no recipe mapping and `implementation: not-applicable`. All other source features remain planned; existing primitive functionality is not relabeled as complete workflow use. Deep-frozen catalog data prevents runtime mutation of published definitions/feature mappings.

## Verification

Initial test-first result: the six initial contract tests could not import the missing module; Vitest exited 1 before implementation. The first implementation passed all six. Additional catalog, binding and safety tests were added as concrete interfaces settled. Type/lint findings during development were corrected (shared test `structuredClone` typing, required test error messages, immutable-array APIs and canonical result field names).

Final commands, from the isolated service root:

| Check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/shared/test/portal-recipes.test.ts packages/shared/test/portal.test.ts packages/mcp/test/portal/recipe-definitions.test.ts --maxWorkers=1` | 3 files, 21 tests passed, 1.25 seconds, exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json` | Exit 0 |
| `node node_modules/oxlint/bin/oxlint --deny-warnings packages/shared/src/portal-recipes.ts packages/shared/test/portal-recipes.test.ts packages/mcp/src/portal/recipes packages/mcp/test/portal/recipe-definitions.test.ts` | Exit 0, no warnings/errors |
| `node node_modules/oxfmt/bin/oxfmt --check packages/shared/src/index.ts packages/shared/src/portal-recipes.ts packages/shared/test/portal-recipes.test.ts packages/mcp/src/portal/recipes packages/mcp/test/portal/recipe-definitions.test.ts` | All six matched files formatted, exit 0 |

Tests cover all inventory counts and bidirectional mappings; duplicate/unknown/misassigned IDs; no implemented claim; immutable nested definitions; behavior/verifier/output-schema/step hash changes; context/blueprint ordering and forbidden cross-stage fields; exact successful result bindings and altered output bytes; failed result refusal; candidate file-hash changes; legacy/future markers; wrong type/field/forward references; arbitrary tool/JSONPath/script refusal; explicit local/import separation; cyclic/accessor/aggregate limit refusal; missing output families; and concrete receipt evidence rather than a generic reviewed flag.

## Exact owned files

`task-6a-owned-files.json` contains `path`, `hash`, and `beforeHash` for all six paths. The original shared-index preimage was captured before any edits and still matches main. All other paths are new in main. Reverify hashes and main preimages before copying.

| Path relative to service | SHA-256 |
| --- | --- |
| packages/shared/src/index.ts | 28db878e44aec87148c26fb1d232e2f7b1a4c423fab3db46641f64467bbb19bf |
| packages/shared/src/portal-recipes.ts | 292d7beeae113e6537f2a68873b8fe93c162dee33f27a85085c1110bb655dd3d |
| packages/shared/test/portal-recipes.test.ts | 343f28994085e8b3e4c3e3408f2e7fb28d8940966f15c52f2ed6348c1838444a |
| packages/mcp/src/portal/recipes/feature-inventory.ts | bc632f46f2596572a894ef0ea11f0c7e56fbecd753b2aca2aca6a0ca1d864ee4 |
| packages/mcp/src/portal/recipes/definitions.ts | 2d21e94331d756cae1b5b12cfee3e89173010bf66326ba5253d1ab6015bcadff |
| packages/mcp/test/portal/recipe-definitions.test.ts | 86d434fe3f4e11c905d8a0662f5657fe40fa50d4187b3172ab9fc9e94a2e6275 |

## Required handoff and remaining work

1. Main independently reviews these schema/catalog bytes. They are not used by portal plan/lease/candidate/apply/completion yet; do not claim current runtime fencing merely because helpers exist.
2. Task 6B must implement actual derive algorithms and verifiers using settled Task 4/5 qualified source and capture/mapping contracts. Extend specialized output/input fields deliberately when real adapters need them; never hide missing shapes in arbitrary JSON.
3. Task 6C must persist signed context/preparation/result records, recover publication interruptions and implement bounded owner-wide reference retention. Per-record bounds here do not solve persistence or compaction.
4. Task 6D must wire the acyclic lifecycle into existing shared/IR/coordinator schemas and gate coding leases on required successful results. Marker checks do not replace signed state/evidence verification.
5. Task 6E must produce server-verified runtime/source/review consumption receipts. The `VerifiedConsumption` schema validates evidence structure only; no test here proves a visible component, correct-mode CSS, asset usage or operational behavior.
6. Task 6F/6G must supply complete typed authoring parameters, canonical owner-client dispatch, effect expansion, required output artifact verification, original-operation crash recovery and final-state readback. Catalog steps are planning skeletons with prerequisites; they must not be treated as executable plans. In particular local binding must not execute the catalog's representative library-import branch automatically.
7. Skill/prompt routing, public capability JSON mirrors and provenance remain unedited until implementations settle. All full-source checks, live cases, final whole-code review rounds and commit/main push remain controller work.
