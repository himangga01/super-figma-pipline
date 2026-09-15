# Task 3.4b admission review

## Verdict

Changes required: one reproduced P2 defect in the approved-operation cancellation/reservation boundary. Main independently confirmed the same failure. This bounded review does not establish whole-service completion or replace either final code-review round.

## Scope and method

Reviewed the task brief, implementation investigation, implementation report, frozen 20-file manifest, and task diff. Traced canonical SQLite observations, resource declarations, profile preparation/registration, owner nonce binding, configuration/lifetime verification, repository versus execution identity, coordinator preparation, executor admission/fingerprints/cancellation, environment control routes/CLI, source-version JSON-schema compatibility, acceptance emission, apply receipt consumption, and IR completion requirements. Read lifecycle interfaces consumed by these paths. The parallel reviewer owns deep broker/lifecycle concurrency review.

No owned source bytes were edited. One uniquely named diagnostic test was added in the isolated copy and retained for reproduction; exclude it from source integration. No daemon, browser, primary distribution, dependency, Git index, commit, or push operations were performed. Tests execute with this Windows account's ordinary filesystem/process/network privileges; this is not an OS sandbox.

## Finding A1 — P2: cancellation can strand reservations created while approved execution is resuming

Location: `service/packages/mcp/src/execution/operation-executor.ts:1484` through 1494, interacting with `performPreDispatchCancellation` at lines 1991 through 2013 and cached `preDispatchSettlement` at lines 1973 through 1976.

After `resumeApprovedTool` starts, `prepareDurability` can already have persisted the real egress and evidence reservations while the cancellation state still has `durability: null`. The assignment happens only after the awaited `afterEvidenceReservationFsync` boundary. If either cancellation entrypoint runs then, it finalizes the journal as `pre-egress-rejected` without settling those reservations. On resumption, `executeApproved` attaches the reservation but sees a terminal journal status, skips cancellation settlement, removes its controller, and throws. The shared cached cancellation promise also describes the earlier null-reservation state. The journal claims a settled cancelled operation while its egress record remains `pre-only` and its reservation was never released by this path.

This is an uncovered consuming race in the cancellation scope, not evidence that the entire defect was first introduced by this patch. It remains consequential because the task adds owner/run cancellation over pending approval as well as queued execution and promises durable settlement, not only runtime suppression.

Reproduction uses actual `OperationExecutor`, `OperationJournal`, `EgressManifestStore`, and `OperationEvidenceReceiptStore`:

1. Begin an approval-bound operation with real durable stores.
2. Resume it and pause at `afterEvidenceReservationFsync`, after reservations exist but before cancellation state attachment.
3. Call the actual executor cancellation API, then release the pause.
4. Observe `OPERATION_CANCELLED`, zero runtime calls, and journal status `pre-egress-rejected`.
5. `egress.classifyOperationState(actorId, operationId).kind` is `pre-only`, where the required settled state is `final`.

Fix the reservation ownership/cancellation handshake so cancellation cannot declare durable settlement before an in-progress reservation is either attached and finalized or safely released. Preserve exactly-once finalization for queued cancellation and both public cancellation entrypoints. Add this boundary regression, including late attachment and durable reservation release; do not weaken journal finality or ignore residual egress.

## Verification and evidence

Command from the isolated service directory:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/execution/review-task34b-admission-diagnostic.test.ts --maxWorkers=1
```

Result: one intentionally failing test, exit 1. Output: `REVIEW_EGRESS_AFTER_CANCEL pre-only`; assertion expected `final`, received `pre-only`. Earlier assertions for cancellation, zero runtime, and terminal journal passed. The test took 192 ms; total Vitest duration was 1.62 seconds. Main independently reproduced this failure.

Retained diagnostic: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/execution/review-task34b-admission-diagnostic.test.ts`.

Diagnostic SHA-256: `3419f932d91e6e77ce59cd8975f58d95963b7ced7e6fbc9df08801b95ca4d4d0`.

The implementer's reported 99-test pass is historical input, not an independent claim by this review. Main is running the broader consuming sweep separately. Deep lifecycle/native-process findings belong to the parallel lifecycle report.

## Verified design observations

- SQLite resource keys use retained parent identity plus case-normalized ASCII leaf, keeping missing-to-created keys stable. Unsupported URI/short-name/link/companion aliases reject instead of receiving independent keys.
- The prepared grant binds owner, plan, candidate source, profile ID, environment/resource configuration, broker identity/program, namespace identity, lifetime, and disposition. Registration verifies existing authority without refreshing timestamps. The owner action nonce hashes the submitted prepared profile.
- Execution identity is separate from repository authority. Coordinator preparation derives it before policy admission; executor argument fingerprints include it. Validation re-expands and compares it before native resource acquisition.
- Public pending cancellation checks owner/run and relevant portal operations. The reproduced failure concerns reservation timing, not an observed cross-owner cancellation bypass.
- Missing environment authority remains parseable for historical records but cannot register or execute current native work. New acceptance includes the environment receipt reference; apply verifies its signed lifecycle owner/run/source/target/repository binding. IR completion adds a current component-presence gate without successful historical defaults.

These observations are scoped source and consumer checks, not guarantees about arbitrary same-account source code or undeclared database/network effects.

## Reviewed byte authority

All 20 owned isolated files matched `task-3.4b-owned-files.json` immediately before reporting; zero mismatches. The exact file/hash table in that manifest is incorporated as this review's byte authority.

Manifest SHA-256: `8807ad909b2ea4b3791465df0b91238751cae3c30cfafc9bce45a295270d831e`.

Review diff SHA-256: `4e0de3b7a29b42fbbe873d781eb018dcabfe6bcd53cb6b0b60dfcda16ec48769`.
