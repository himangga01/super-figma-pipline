# Task 6C1 fix 1 independent review

Date: September 15, 2026. Verdict: changes requested for one reproduced P2 integration mismatch. The original captured-result reservation finding is addressed by fix 1.

## Reviewed bytes and independence

All 22 hashes in `task-6c1-final-owned-files.json` and all 22 original main preimages were independently recomputed and matched. No frozen source or maintained test was edited. The review inspected actual executor/finalizer/artifact publication, hold quota/index validation, legacy binding accounting, retention scope and index wiring, plus the real default CLI retention adapter. The reviewer authored the preceding Task 6F foundation but did not author Task 6C1 or its quota fix; this review concerns those new protocol/retention changes and their integration with the existing client contract. It is not a final whole-code review round or Task 6C2/6D certification.

## Original R1: fixed

The shared `OPERATION_CAPTURE_MAX_BYTES` is 8 MiB. New unverified holds reserve that full amount regardless of a caller's smaller consumption ceiling. Capacity admission also charges the full amount for every old unverified active row, preserving its exact original binding and stored reservation field. Successful verification can tighten accounting to actual verified bytes; it cannot promote a result larger than the binding's consumption ceiling.

The actual `OperationExecutor` checks canonical captured byte length after runtime completion and redaction, before native evidence materialization, output-finalizer publication, success receipt/artifact creation, cache insertion and successful response publication. Exceeding the limit settles `outcome-unknown` with `EVIDENCE_CAPTURE_TOO_LARGE` and preserves its unknown finalizer and hold. No oversized successful artifact is published. `DurableOperationFinalizer.succeed` separately checks before terminal claim/publication, and `OperationEvidenceArtifactStore.createNew` checks before workspace resolution or directory/marker creation. The boundary comparison accepts exactly 8 MiB, and uncaptured operations retain their existing behavior.

Independent execution of the expanded service tests confirmed the small-ceiling rejection, old small signed-row accounting, actual oversized executor result rejection before the deliberately failing artifact port, retained unknown-outcome hold/finalizer, explicit refusal to release unknown outcomes, exact-maximum capture, uncaptured compatibility and direct publication guards. The original diagnostic artifacts were not relabeled as valid evidence or deleted.

## New F2 — P2: valid recipe step IDs can fail metadata admission after an earlier write

Locations:

- `packages/cli/src/recipe-plan.ts`: executable step IDs use the shared local `id` validator, a nonempty string of at most 256 characters, and separately reject the internal prefix.
- `packages/mcp/src/portal/recipes/evidence-contract.ts:22-27`: the new retention binding permits at most 160 characters and only an ASCII token regular expression.
- `packages/cli/src/control-recipe-client.ts:createControlRecipeRetention`: parses each binding only when that step's hold/verify call is reached.

These contracts disagree. A complete recipe can pass `ExecutableRecipeSchema` and begin executing, yet its later valid opaque identifier is rejected by the default retention adapter. The code does not preflight the whole plan against the narrower new contract before effects.

Two independent diagnostics used the maintained real default-retention HTTP fixture. The later rename step was named `later rename`, or a 161-character ASCII identifier. Both complete plans passed the executable schema. In both cases the actual `create_frame` primitive committed, then retention binding parsing rejected the later step's `stepId`. The document retained a frame named `Frame` instead of completing the requested rename. The actual primitive dispatch list was exactly `create_frame`; no second write or duplicate retry occurred.

This is not an owner-permission bypass. It is an avoidable partial execution and contract mismatch in the implemented default protocol. The narrow correction is to deliberately harmonize the server's opaque step-ID contract with the existing 1..256-character client contract, or preflight the same chosen contract for every plan step before any effect. Do not silently rewrite existing IDs/binding hashes. The controller proposed harmonizing the server shape because step IDs participate in a canonical hashed key and are not used as filesystem paths. That proposal was not implemented by this reviewer before the controller reproduces the evidence.

The corrected regression should include valid spaces, a 161-character ID, and Korean/non-ASCII IDs at the chosen length boundary through the real default retention path, plus over-limit rejection before any primitive effect.

## Retained diagnostic

Path:

`C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/cli/test/review-6c1-step-id.diagnostic.test.ts.disabled`

SHA-256: `13cd5f0dca70142202efebed22d9196440794fae93b8ad4b17ade150db363585`.

Command before its in-place disabling:

    node node_modules/vitest/vitest.mjs run packages/cli/test/review-6c1-step-id.diagnostic.test.ts -t 'review: valid recipe step ID' --maxWorkers=1

Result: **2 passed**, 37 inherited cases filtered, 20.36 seconds. Passing means the diagnostics reproduced the defect; these are not safety-pass assertions. The fixture copy uses real persisted control credentials, canonical HTTP metadata admission/execution, actual hold manager, actual operation/receipt/finalizer/artifact stores, and the bounded plugin document port. Only this temporary review diagnostic was added and then renamed; all 22 frozen files remained unchanged.

## Other verified boundaries

No additional actionable defect was established in this bounded pass. Actor, original auth session, workspace, operation kind/name/ID/args and target bindings remain exact. The default adapter calls the dedicated canonical hold/verify routes with no target selector, checks the exact returned binding/key and verified metadata, and does not silently use grounding refresh. Unknown/released/stale outcomes cannot supply dependent outputs.

The actual index retains one durable mutex across receipt/finalizer compaction, pending cleanup, result/native orphan scans and managed tombstone purge. Held operations remain visible to all stages. Recovery defers tombstone expiry; the internal retention snapshot is live only within its callback, with forged/expired snapshots rejected. Existing terminal release semantics are distinct from successful verification and do not permit releasing live dependencies or unknown operations. Changed control credentials/generation remain a new-session recovery boundary, not implicit authority to rewrite old bindings.

The capture limit is a bound on persisted canonical captured result bytes, not transient JavaScript memory, independent native exports, arbitrary owner filesystem edits or OS isolation. Pre-release already-oversized artifacts are not certified by this fix. Those stated limits are accurate.

## Independent validation

- Expanded service command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/recipe-evidence-hold.test.ts packages/mcp/test/execution/egress-finalizer.test.ts packages/mcp/test/fs/operation-evidence-artifact-store.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/service-operation-name.test.ts --maxWorkers=1`: **155 passed**, one existing platform skip, seven files, 14.31 seconds.
- Maintained client command: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/recipe-retention-client.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **48 passed**, three files, 76.30 seconds.
- Together: 203 maintained tests passed and one existing platform skip. The two defect-reproduction diagnostics are additional and reported separately.

Validation used the native separate working copy with the current Windows account's filesystem/process/network privileges. No production source edit, live daemon, Chrome/Figma, browser tool, Superpowers, Docker, dependency installation, build or Git mutation was performed. The main session must independently reproduce F2 before a fix, then obtain review of the corrected final bytes before integration.
