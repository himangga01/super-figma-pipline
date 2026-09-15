# Task 6B Independent Critical Review

Date: September 15, 2026. Verdict: changes required before integration. This is a scoped Task 6B review, not either final whole-code review round.

## Reviewed scope and evidence

Reviewed the five frozen paths in `task-6b-owned-files.json`, the implementation report, Task 4 service selection and qualified source review consumers, and the final plan's W03/W06 requirements. All five isolated file SHA-256 values still exactly matched the owned-file manifest after review. No frozen implementation or test file was edited.

Review and tests used `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. No Superpowers, Docker, browser, Figma, daemon, build, dependency installation, Git mutation or subagents were used. Native execution retained the same Windows account's filesystem/process/network privileges; this working copy is not an OS sandbox.

## Findings

### R1 — P1: Preserve the qualified selected closure when preparing source recipes

Locations: `packages/mcp/src/portal/recipes/core-source.ts:109` (preparation input), `packages/mcp/src/portal/recipes/core-derivation.ts:807` (layer union) and `:868` (all-service material emission).

`prepareCoreRecipeSource` accepts only source ID, reader and observation. It captures and maps the whole repository; `deriveCoreRecipeBundle` has no selected closure input either. The strategy recipe therefore unions layers from every graph service and emits unrelated services even when Task 4's current, complete selection deliberately excludes them. In particular, an unrelated backend package suppresses the selected frontend reference's required backend construction obligation.

Reproduced with a real temporary workspace repository containing a React `web` package and an independent Express `jobs` package. The actual `analyzeServiceGraph` and `selectPortalServices` returned `complete: true`, closure exactly `web`, and selected layers without `backend`. Actual `prepareCoreRecipeSource` and `deriveCoreRecipeBundle` over the same repository/Checkout observation then emitted the `jobs` service and omitted every `construct-layer` obligation ending in `:backend`.

Whole-repository default selection is legitimate; explicit qualified selection must be distinguishable from it. This cannot be repaired solely by a later wrapper passing a subdirectory reader: doing so changes the inventory/root identity and drops valid cross-package relative imports or a multi-service closure. It also cannot be repaired by filtering output pages afterward, because immutable source/input/result identities and canonical mappings already describe the wrong scope.

Required fix: add a validated, content-bound representation of the admitted qualified selection to source preparation/bundle derivation. Preserve full root byte authority while deriving effective services, mapping candidates and required layers from the selected dependency closure. Bind its identity into the capsule/source descriptor/input hash. Reuse the existing qualified selection logic; do not accept arbitrary caller-supplied layer lists. Cover same-source unrelated siblings, retained related dependencies, same-path multi-reference qualification, and absent selection's documented whole-root default.

### R2 — P2: Honor exact admitted semantic source reviews without waiving hard failures

Location: `packages/mcp/src/portal/recipes/core-derivation.ts:893`, with the same missing source-context input at `core-source.ts:109`.

The unconditional `source.graph.incomplete` block ignores Task 4's bounded semantic review path. A plan can have a current complete reviewed selection while the raw graph remains intentionally incomplete; this distinction is already represented by `selectPortalServices`, which validates review issue/path/hash/offset/source binding and retains the conservative closure. Core preparation cannot receive that evidence, so all such supported reviewed plans become permanently blocked again.

Reproduced with an actual Node HTTP server source. The analyzer reported `UNSUPPORTED_NODE_HTTP`; an exact source review with `retain-conservative-closure` made actual `selectPortalServices` return `complete: true`. The real source capsule still produced a blocked implementation strategy with `CORE_SERVICE_GRAPH_INCOMPLETE`.

Required fix: carry and validate the exact admitted semantic review/selection result against the freshly analyzed source. Preserve raw diagnostics for evidence, but distinguish successfully reviewed semantic uncertainty from unresolved or unreviewable byte, parse, inventory and diagnostic-truncation failures. Bind the review identity and reviewed layers into derivation inputs. Reject stale/unbound review evidence and retain existing conservative dependencies. Do not turn raw graph incompleteness into unconditional success.

## Checks and non-findings

| Check | Result |
| --- | --- |
| Existing core/page/recipe-definition sweep | 4 files, 43 tests passed; 6.08 seconds; exit 0 |
| Actual filesystem/selection/capsule diagnostic sweep | 2 diagnostic tests passed, 22 inherited tests skipped; 1.68 seconds; exit 0 |
| Frozen five-path SHA-256 verification after diagnostics | All match `task-6b-owned-files.json` |

The diagnostic assertions intentionally establish the current incorrect behavior, rather than assert a hypothetical fix. The first test proves the unrelated backend suppression; the second proves reviewed-source blockage. The diagnostic reused the existing core test helpers so its observation, assets and capsules followed the actual implementation contracts.

The diagnostic was retained with identical bytes at `packages/mcp/test/portal/review-core-recipes.diagnostic.test.ts.disabled` in the isolated service copy. SHA-256: `46d8f428c3773bf0b74d20191cd31b3b9822b844a11a5f01c4b68fefe19f59e2`. Renaming was restricted to the resolved validation path and verified by hash; no historical diagnostic was deleted. It is review evidence, not a source file to integrate.

No additional actionable defect was established in the inspected raw-observation rebuild, missing-versus-empty capability gating, forged/deserialized capsule rejection, source pre/post inventory binding, asset byte/query distinctions, material/page membership and count checks, or explicit oversized-material failure paths. Existing tests exercised 4,200 variable-mode rows and 4,200 mapping-member rows, malformed material, missing/tampered members, deterministic hashes, stale canonical overrides, and C4 construction. Unsupported or exceeded derivation paths retain blockers or throw explicit bounded errors; I did not find a successful hard-issue truncation path in this scoped code.

This review does not claim owner admission, durable result retention, actual candidate consumption, native/runtime behavior, live source export fidelity or complete portal integration. Those remain the stated later consumer tasks. The two findings concern information this pure API must represent for those consumers to implement the already accepted scope correctly.
