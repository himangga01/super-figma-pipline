# Task 6C1 independent critical review

Date: September 15, 2026.
Verdict: Changes requested. One reproduced P2 finding in the implemented public protocol.

## Scope and reviewed bytes

Reviewed the frozen 17-path manifest in task-6c1-owned-files.json, including the four CLI paths. Independently recomputed all isolated SHA-256 hashes and all main preimage hashes: 17 of 17 match, no discrepancy. No production file was edited.

The review followed actual service initialization in packages/mcp/src/index.ts, canonical service specs, authenticated HTTP route registration, OperationExecutor integration, default ControlRecipeClient protocol, managed OperationJournal expiry and recovery, receipt/finalizer retention, pending artifact cleanup and result/native orphan scans. It did not infer service support from helpers alone. Task 6C2 core preparation, Task 6D parent adoption policy and cross-session new-authority admission are not certified by this review.

## Finding R1 — P2: Caller-selected result ceiling under-reserves actual retained output

Locations:

- packages/mcp/src/portal/recipes/evidence-contract.ts:23 accepts any maxResultBytes from 1 through 8,388,608.
- packages/mcp/src/portal/recipes/evidence-hold.ts:235-239 uses the supplied ceiling for owner/global quota admission.
- packages/mcp/src/portal/recipes/evidence-hold.ts:366 reserves that same amount for an operation which has not produced evidence yet.
- packages/mcp/src/portal/recipes/evidence-hold.ts:277 checks the result size only during later verification.

A caller can publish a valid 1-byte hold and then invoke its bound primitive through the existing canonical execution path. Nothing in the primitive invocation enforces the held result ceiling. The actual captured artifact and receipt can therefore exceed the reservation. Verification rejects afterward, but the held operation remains protected by every retention sweep while its accounting continues to reserve only one byte. A post-effect rejection does not enforce the advertised admission budget.

This is reachable through the implemented HTTP contract: the route uses RecipeEvidenceArgsSchema, which admits the small ceiling, and the execution path has no corresponding result-ceiling input or hold-manager admission guard. The default CLI currently always requests 8 MiB, which avoids the small-request trigger. However, a second actual-executor reproduction confirms that the executor itself can publish more than 8 MiB, so even this normal ceiling is not enforced.

Reproduction uses the existing real OperationExecutor fixture, actual canonical create_frame capture, receipt and artifact stores, and hold-aware retention. Configure owner and global reserved-byte limits to 1, set binding.maxResultBytes to 1, publish the hold, and invoke the primitive. The operation succeeds and its resultBytes exceeds 1. verifyHeld rejects with RECIPE_HOLD_EVIDENCE_INVALID. Run the complete fixture receipt/finalizer/artifact sweep: the oversized evidence is still retained. The diagnostic passed with these assertions against frozen source.

The second reproduction uses the normal 8 MiB binding and owner/global capacity. Its schema-valid create_frame result has a name string of 8,388,608 characters, so canonical output exceeds 8 MiB. The actual executor succeeds, persists the oversized receipt/artifact, later verification rejects and retention preserves it. Source tracing confirms that operation-executor.ts:183 is only a completion-cache limit; its canonical result path at lines 1615-1660 has no capture ceiling. OperationEvidenceArtifactStore.createNew likewise has no byte-size check before publication. The live relay frame maximum is 64 MiB, not 8 MiB. This uses an actual executor with a simulated plugin response, not a claim about a live Figma name limit.

Recommended correction: reserve the full service-enforced maximum before a held primitive may run, and enforce that maximum before publishing captured result bytes. Fixed 8 MiB schema alone is insufficient without the actual publication/output guard. A result exceeding the bound after runtime must settle conservatively, preserving the original hold and any legitimate unknown-outcome evidence, while never persisting an oversized successful result artifact. Do not weaken retention or remove existing evidence to make the budget appear satisfied. Add regressions for both the valid small-ceiling request and a schema-valid result exceeding the default ceiling.

Existing retained rows need deliberate treatment if retained pre-release fixtures are reused. A current terminal hold whose verification failed can still be explicitly released by its actual bound owner/session when it has no dependents; release does not require successful verification, and this must not be reinterpreted as successful consumption. Absent/running/outcome-unknown rows remain unreleasable by that path. Changing binding.maxResultBytes rewrites the binding hash and is not an accounting repair. Do not silently do that. Since this slice is unpublished and has not run in the user's live daemon, no production legacy migration is presumed necessary. If smaller existing rows are supported, retain their exact bindings and membership and repair conservative accounting under the same mutex before admitting additional work; actual already-oversized evidence needs explicit retained over-budget/quarantine handling, not a fabricated successful verification. A strict new schema which refuses old rows must fail closed and clearly require recovery, not ignore them during a sweep.

## Other reviewed properties

No additional actionable defect was found in this bounded pass:

- Actual actor/session/workspace comparisons precede binding use; IDs are service-issued and actor-verified; existing operations must match kind/name/args/target/session/workspace. The stable actor/plan/step key cannot reopen or change its binding, and an operation cannot be assigned to a second step.
- Canonical hold/verify/release service routes and operation definitions are registered in the actual index. Target selectors are forbidden for these metadata operations. The default client only automatically approves the two fixed metadata operations; primitive approval and existing freshness/recovery guards are unchanged.
- Verification reads the actual journal/receipt/finalizer endpoint and the canonical operation-derived artifact path using the bounded workspace reader. It checks digest, byte count, current result schema and canonical JSON round trip.
- One retained-directory/interprocess mutex spans the entire actual retention callback: receipt compaction, egress compaction, pending artifact cleanup, both orphan scans and managed tombstone purge. Both hold-first and sweep-first orders are covered; a late hold cannot restore already-removed terminal evidence.
- Managed journal implicit cleanup and recovery defer tombstone expiry. Explicit purge requires an active internal snapshot; forged and expired snapshot objects reject. This is internal coordination and does not provide isolation against arbitrary same-process code.
- Explicit release refuses dependencies, absent/unsettled operations and unknown outcomes. Dependency mutation is internal-only. Cancelled mutex waiters check cancellation before publication. A failed artifact publication after real runtime completion produces an unknown outcome whose hold remains retained.
- Store history capacity is finite and explicitly reported; no unlimited physical space or OS sandbox guarantee is assumed.

## Independent validation

Command:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/recipe-evidence-hold.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/service-operation-name.test.ts --maxWorkers=1

Result: 4 files, 55 tests passed; 6.25 seconds.

Focused diagnostic command:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-6c1-quota.diagnostic.test.ts -t 'review: actual output' --maxWorkers=1

Result: 1 diagnostic passed, 12 inherited tests skipped by the explicit name filter; 2.84 seconds. This is a passing reproduction of the defect, not a successful budget enforcement test.

The diagnostic was retained by an in-place rename after execution so it does not enter normal suites:

    C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-6c1-quota.diagnostic.test.ts.disabled

SHA-256: 4290d3358576c34981d1d210edf72b28418e97c9e24a156c2bf4c1387f7023ec.

Validation used the native separate working copy under the same Windows account; it shares filesystem/process/network privileges and is not an OS sandbox. No live daemon, Chrome/Figma, browser tool, Superpowers, Docker, dependency installation, build, Git index change, commit or push was performed. CLI tests were inspected but not rerun in this review; main runs the full focused suites independently.

## Additional maximum-ceiling diagnostic

Command before disabling:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-6c1-max-capture.diagnostic.test.ts -t 'review: real executor' --maxWorkers=1

Result: 1 diagnostic passed, 12 inherited tests filtered; 2.91 seconds. As above, this passes assertions reproducing the defect.

Retained path:

    C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-6c1-max-capture.diagnostic.test.ts.disabled

SHA-256: d6afd9e470c30b765f2c409d39e63ad67c2f650fc3b07b959e6b31139906599a.
