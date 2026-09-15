# Task 3.4b lifecycle review

## Verdict

Changes requested. One P1 correctness finding is reproduced against the frozen implementation. The existing native environment suite passes, but it does not cover reconciliation racing the next command transition.

This is the independent durable lifecycle/process review. The other reviewer owns admission, hash/nonce, and public cancellation coverage. No owned implementation file, distribution, daemon, browser, dependency, Git index, commit, or remote was changed. Tests ran natively in the separate validation working copy under the same Windows account; this is not an operating-system sandbox.

## P1: Reconciliation can release claims while a new command is permitted

**Location:** `service/packages/mcp/src/portal/native-lifecycle.ts:433-446`, with the related snapshot checks at lines 427-430 and 459-466 and the launch transition in `beforeLaunch`.

The public reconciliation path accepts an inspected ready/running attempt whenever its recorded commands are currently stopped. `finish()` reads and checks that snapshot, awaits directory/resource observations, then performs unconditional CAS transformations to `cleanup` and `released`. Those transformations do not recheck the current process states or the inspected receipt revision. Meanwhile, the legitimate validation runner can perform `beforeLaunch()` and `permit()` for the next command. These calls persist a new permitted process between the initial check and the terminal CAS, which then preserves that process row while overwriting the attempt state to released and releasing its shared resource claims.

A deterministic reproduction using the real signed PortalStore and filesystem pauses `finish()` after its directory verification, persists the competing next-command intent and permit, and resumes reconciliation. The returned signed record has `state: released` and `processes[0].state: permitted`. A second attempt then acquires the same shared SQLite claim successfully. The test uses synthetic process receipt values only to isolate this state-transition interleaving; the trusted process-control caller normally makes these same lifecycle calls. No caller forgery is needed for the production race: the owner reconciliation endpoint and the running validation can execute concurrently.

This defeats the required rule that shared resources remain held until every project process is proven stopped. It also means the exact inspected receipt is checked too early to constrain the terminal mutation. The existing queue does not protect the owner reconciliation route, which directly invokes the lifecycle manager.

**Required correction:** make the per-attempt lifecycle transitions mutually consistent across reconciliation and runner calls. Bind reconciliation to the inspected revision and reject or explicitly coordinate live execution. Recheck allowed state and process-stop predicates inside the actual transition CAS; an earlier snapshot check is insufficient. Ensure the symmetric race, where `beforeLaunch()` validates before a concurrent terminal transition and then writes afterward, cannot reopen a released attempt without claims. Add deterministic tests for both interleavings and for successful recovery of an interrupted release. Do not solve this by silently accepting missing process proof.

## Independent verification

- Read the task brief, implementation investigation, report, owned manifest, scoped diff, and the lifecycle/process/runner/work/store consumers.
- Reran `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-environment.test.ts --maxWorkers=1`: **16 passed**, exit 0, 21.99 seconds. This exercises actual Windows broker compilation/execution, permit ordering, descendant draining, failure/timeout/cancellation/parent EOF, lost broker proof, signed restart quarantine, directory replacement, SQLite persistence, and the 32-command CAS capacity test. The capacity test deliberately uses synthetic receipts; real broker tests cover native process evidence separately.
- Ran the independently added deterministic regression with `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-task34b-lifecycle-race.test.ts --maxWorkers=1`: **1 passed**, exit 0, 1.40 seconds. Its assertions demonstrate the faulty release and conflicting admission, rather than an expected corrected behavior.
- Recomputed SHA-256 for all **20** owned implementation paths: **zero mismatches** against `task-3.4b-owned-files.json`.
- Did not rerun the full 99-test sweep or duplicate the other reviewer's admission tests.

## Reviewed evidence and limits

The fixed broker clears its control-data environment before project launch, waits for the persisted permit, communicates on a separate token-bound pipe, and drains Job membership using opened handles before reporting stopped. Restart reconciliation does not kill a disk-recorded PID and does not treat root-process disappearance as proof of tree termination. The native tests support these bounded Windows claims. Retained work/HOME directories preserve the module evidence lifetime; no automatic recursive deletion was introduced. Signed claims continue blocking another attempt when stop proof is absent.

The namespace retention limit is an admission check, not a live disk quota, and the same-account execution limitations are described accurately in the implementation report. This review does not certify undeclared filesystem/network effects, other operating systems, final release contracts, or the later portal fixture/live Figma acceptance matrix.

## Exact review artifacts

- Owned source hashes: `task-3.4b-owned-files.json` (all 20 verified unchanged).
- `task-3.4b-review.diff`: `4e0de3b7a29b42fbbe873d781eb018dcabfe6bcd53cb6b0b60dfcda16ec48769`.
- Finding file `native-lifecycle.ts`: `d8df006564d9d5abe77b10b6cf20906e1978455c047656c5a588e853de3cd269`.
- Unique excluded diagnostic: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-task34b-lifecycle-race.test.ts`, SHA-256 `086aeaa427f2220d59055fd19bb12fd8a0f80d3beaf128340b95205ddb275187`. It is not one of the 20 owned files and must not be integrated as production test coverage unchanged, because it asserts the defect. Keep it as review evidence or replace it with an implementation-owned regression that asserts safe behavior.

The existing fixture cleanup removed only the temporary directories created by these tests. Previously retained or denied diagnostic cleanup was not touched.
