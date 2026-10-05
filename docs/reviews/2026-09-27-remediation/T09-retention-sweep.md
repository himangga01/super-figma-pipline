# T09: retention sweep isolation (LC-1)

Date: 2026-09-27. Task: T09 of the [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md). Finding: LC-1 in section 3.1 of the [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md). Reviewer constraint: TD-7 ("T09 outcomes") in Appendix C of the fix plan. The T06a characterization is recorded in [T06a-critical-reproductions.md](T06a-critical-reproductions.md), and the unavailable-workspace semantics in [T08-workspace-rows.md](T08-workspace-rows.md).

- Branch: `rem/t09-retention-sweep`, based on `89c20dd` (the T08 merge).
- Commits:
  - `ac39dda` fix(execution): isolate the leader retention sweep from initialization (LC-1);
  - the commit that adds this note.
- Result: a built daemon now starts as leader over the durable cleanup intent of a 31-day-old `snapshot.capture` receipt whose workspace `.sfp` folder was deleted. `/control/status` and a tool call work, and the intent ends done. The T06a LC-1 characterization is flipped into regression tests. `service/upstream-lock.json` is unchanged.

## The defect

Line numbers are at `89c20dd`.

- Leader runtime initialization awaited the retention sweep (`mcp/src/index.ts:960`, `await retention.sweep()`).
- The sweep's cleanup callback, `removeRetainedArtifacts` (`index.ts:850-886`), threw `NATIVE_ARTIFACT_IDENTITY_MISMATCH` for every native evidence kind other than `export` and `no-artifact`. `snapshot.capture` and `grounding.refresh` record `snapshot` and `grounding-graph` evidence (`mcp/src/snapshot/snapshot-operation-evidence.ts:61,87`).
- Compaction writes the cleanup intents durably before it removes the receipts (`mcp/src/execution/operation-evidence-receipt-store.ts:472`), and `drainPendingArtifactCleanup` (`:531-545`) drained them without per-intent isolation. The first snapshot intent aborted the drain, and the next start found the same intent.
- The whole sweep, including every workspace orphan scan, ran under one acquisition of the recipe-hold retention lock (`mcp/src/portal/recipes/evidence-hold.ts:460-466`).
- `removeLinked` (`mcp/src/fs/operation-evidence-artifact-store.ts:1587`) threw `WORKSPACE_PATH_NOT_FOUND` when the workspace's `.sfp` folder had been deleted.

Reproduced at the process level before the fix: the new acceptance test, run against a build of `89c20dd`, logged `[execution] leader runtime initialization failed (Error: native evidence cleanup requires manual verification)`. `/control/status` returned 500 while `/ping` answered.

## Design

### Scheduling

- Leader initialization no longer sweeps. At its end, after the last generation check, it calls `scheduleRetentionSweeps(retention, log)` (`execution/retention-sweep.ts`). The startup sweep starts on the next timer turn, after the initialization promise has settled, and the daily sweeps follow. Both timers are unreferenced, and runtime close stops them.
- A failed sweep is only logged: `[retention] startup sweep failed (<code>)` or `[retention] scheduled sweep failed (<code>)`. `LEADER_GENERATION_CLOSED` from a closed generation is not logged.
- `GenerationRetentionCoordinator` (`execution/execution-plane.ts`) now passes the sweep an abort signal. `close()` aborts it and waits for the running sweep, which stops at its next batch boundary. `close()` no longer rethrows the sweep's failure: before T09, a rejected sweep made runtime close throw before the stores were flushed.

### Batches and the lock scope

`runRetentionSweep` runs four phases. Each batch calls `RecipeEvidenceHolds.withRetentionSweep` on its own, so it takes the lock and a fresh snapshot of held operations, and releases both at its end.

| Phase | Lock acquisitions | When it fails |
| --- | --- | --- |
| Receipt and egress compaction | 1 | Logged. The tombstone purge is skipped. |
| Cleanup intents | 1 per 32 intents, following a cursor | Logged. The later phases still run. |
| Orphan scans | 1 per available workspace | Logged per workspace. The other workspaces are still scanned. |
| Journal tombstone purge | 1 | Logged. |

- Hold operations proceed between batches, and the next batch honors a hold created in between.
- Splitting the lock is safe for the sweep's own work. A receipt expires 30 days after its operation settled. By then the operation ID is past the issuer's 30-day horizon (`execution/operation-id.ts:141`), so `ensureHeld` rejects a new hold on it with `OPERATION_ID_EXPIRED`. A later batch therefore cannot meet a new hold on an intent that an earlier batch created. The drain still checks `isHeld` for every intent and defers a held one.
- The purge runs only after a successful compaction. Compaction finds expired receipts through the settlement times of the journal tombstones, so purging those tombstones first would leave their receipts unexpirable.
- `evidence-hold.ts` changed only in its comments: `withRetentionSweep` already took the lock per call.

### Cleanup intent outcomes

`cleanupRetainedEvidence(receipt, context)` decides one intent. The drain lists the workspace registry once per batch and passes it in, with its T08 availability.

| Receipt | Condition | Outcome |
| --- | --- | --- |
| Any | The operation is held | deferred (`RECIPE_HOLD_RETENTION_CONFLICT`) |
| No workspace | `no-artifact` evidence | done (unchanged) |
| No workspace | A result artifact or native evidence | failed attempt, `EVIDENCE_ARTIFACT_IDENTITY_MISMATCH` (unchanged) |
| `snapshot` or `grounding-graph` evidence, no result artifact | Any workspace state | done: the evidence is detached |
| `no-artifact` evidence, no result artifact | Any workspace state | done (unchanged) |
| A result artifact or `export` evidence | The workspace is not registered | done |
| The same | The workspace is `unavailable` or `legacy-unbound` (T08) | deferred, with the T08 cause (`WORKSPACE_ROOT_MISSING`, `WORKSPACE_ROOT_IDENTITY_CHANGED` or `WORKSPACE_ROOT_UNBOUND`) |
| The same | Available, and the fixed operation directory is verifiably missing | done, inside `removeLinked` or `removeLinkedManifest` |
| The same | Available | removed through the stores, as before T09, then done |
| The same | The removal throws `WORKSPACE_NOT_CONFIGURED` (the row was removed after the listing) | done |
| The same | The removal throws `WORKSPACE_ROOT_UNAVAILABLE` (the root disappeared after the listing) | deferred, with the policy error's cause |
| Any | Any other error | failed attempt; the third one is a terminal quarantine |

"Target file missing" is decided by the stores at the fixed operation directory, which the workspace policy resolves inside the verified root. A partial state, such as a cleanup marker without its result file, stays fail-closed as before. It fails, it is quarantined after three sweeps, and the orphan scan then removes the lone marker once the operation's tombstone is purged.

### Detaching snapshot and grounding-graph evidence

- The intent completes with a `done` row. Compaction had already removed the receipt from the receipt log, so this releases the last receipt linkage. The drain makes no filesystem call for these kinds, whatever the workspace's state.
- The files under `.sfp/snapshots/v1/` and `.sfp/grounding-graphs/v1/` stay in the workspace. A grounding graph is rewritten by `grounding.refresh` and depends on its snapshot, so deleting them stays the owner's decision.
- No daemon command deletes them today. `WorkspaceSnapshotStorage.delete` requires an approval hook that production does not wire, so the owner deletes them by hand. The orphan scans read only `.sfp/operation-evidence`, so they never touch these files either.

### Versioned cleanup rows, quarantine and truncation

- **Rows.** The v1 rows `add` and `done` are unchanged. T09 adds two v2 rows to the same hash chain, under the same hash domain:

  ```json
  {"schemaVersion":2,"kind":"failed","operationId":"…","receipt":null,"attempts":1,"errorCode":"EBUSY","previousRecordHash":"…","recordHash":"…"}
  ```

  `kind` is `failed` for one failed attempt, or `quarantine` for the terminal row.
- **Reader.** The schema is closed per version. A v2 row must continue its pending intent's failure count by exactly one. `errorCode` must match `^[A-Z][A-Z0-9_]{0,95}$`. Error messages are never persisted or logged, and an error without such a code is recorded as `CLEANUP_FAILED`.
- **Attempts.** `CLEANUP_INTENT_MAX_ATTEMPTS` is 3. Attempts 1 and 2 write `failed`, and attempt 3 writes `quarantine` instead. The counts survive restarts, so every leader start counts as one attempt, not a fresh one. A quarantined intent is never retried.
- **Truncation.** `done` and `quarantine` are both terminal, and an intent is pending until one of them is written. After every terminal row, if nothing is pending, the log is truncated to zero bytes and the chain restarts, exactly as after the last `done` before T09. A quarantined intent therefore never holds truncation back. Its `add`, `failed` and `quarantine` rows are dropped with the rest of the log.
- **What stays after truncation.** The quarantine log line, and the evidence on disk. Result artifacts keep their cleanup marker, and export evidence its manifest, under `.sfp/operation-evidence/`. The orphan scans find them again once the operation's journal tombstone is purged, and report `manual-cleanup` if they cannot remove them.
- **Deferred intents are not terminal.** While a workspace stays unavailable, its deferred intents keep the log from truncating. Every sweep logs them, and they end when the workspace is available again, rebound or removed.
- **Capacity.** Compaction checks that the log can take each new intent's longest path to a terminal row: two `failed` rows and a `quarantine` row with a 96-character code. Before T09 it counted the `done` row only.
- **Downgrade.** A build before T09 rejects a v2 row as `EVIDENCE_RECEIPT_CORRUPT`, so a downgrade with a failed or quarantined intent still in the log fails closed. A drain in which every intent succeeds writes no v2 row.
- **Order.** The drain visits intents in code-unit order of their operation IDs, instead of `localeCompare`, with an `after` cursor and a batch `limit`. Each sweep visits each pending intent at most once.

### Workspace scans

`sweepAvailableWorkspaces` (`fs/workspace-config-store.ts`) now isolates each visit. A failing scan logs `[retention] workspace <id> evidence scan failed (<code>); the other workspaces are still scanned`. The function returns `{scanned, skipped, failed}` and stops before the next workspace once the signal aborts. This closes both sweep follow-ups that T08 recorded: a workspace that disappears between the listing and its scan, and a failing scan of an available workspace.

## Files

Paths are relative to `service/packages/`.

| File | Change |
| --- | --- |
| `mcp/src/execution/retention-sweep.ts` (new) | `cleanupRetainedEvidence`, `runRetentionSweep`, `scheduleRetentionSweeps`, `RETENTION_SWEEP_LIMITS` |
| `mcp/src/execution/operation-evidence-receipt-store.ts` | Isolated, batched drain with a report; v2 `failed` and `quarantine` rows; durable failure counts; truncation after either terminal row; capacity projection |
| `mcp/src/execution/execution-plane.ts` | `GenerationRetentionCoordinator` passes an abort signal, and `close()` does not rethrow a failed sweep |
| `mcp/src/index.ts` | Removes the cleanup closure and the awaited sweep; wires `runRetentionSweep` and schedules the sweeps after initialization. The per-workspace orphan-scan body stays in `index.ts`, so the lane D pins in `test/task-8a-direct-fs-importers.test.ts` hold. |
| `mcp/src/fs/operation-evidence-artifact-store.ts` | `removeLinked` returns when the fixed operation directory is verifiably missing |
| `mcp/src/fs/workspace-config-store.ts` | `sweepAvailableWorkspaces` isolates each workspace, returns a summary and honors an abort signal |
| `mcp/src/portal/recipes/evidence-hold.ts` | Comments: the lock is taken per retention batch |

Tests:

- `mcp/test/execution/operation-evidence-receipt.characterization.test.ts`: rewritten from the T06a characterization into three LC-1 regression tests. The file name is kept, so the T06a evidence still resolves. The copied callback is gone; the tests import the production `cleanupRetainedEvidence`.
- `mcp/test/execution/retention-sweep.test.ts` (new): ten tests for the outcomes, batches, lock scope, phase isolation, logging, abort and scheduling.
- `mcp/test/e2e/retention-startup.test.ts` (new): the process-level acceptance test against the built daemon.
- `mcp/test/execution/operation-evidence-receipt.test.ts`: new block `isolated cleanup intent drain (T09, LC-1)`, three tests.
- `mcp/test/fs/operation-evidence-artifact-store.test.ts`: one new test. One existing test, "recovers a receipt cleanup crash after removeLinked and durably completes the intent", expected the drain to reject when the callback threw. The drain now records a failed attempt and resolves, and the rest of that test is unchanged.
- `mcp/test/fs/workspace-config-store.characterization.test.ts`: the T08 sweep test now expects the summary, and its source pin follows the iteration into `retention-sweep.ts`. One new test for the isolation of a failing workspace scan.
- `mcp/test/execution/execution-plane-lifecycle.test.ts`: one new test for the coordinator's signal and close.

## Required tests

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Flip LC-1: 31-day-old `snapshot` and `grounding-graph` receipts drain without throwing, and a later harmless intent drains too | `operation-evidence-receipt.characterization.test.ts`: "expired snapshot and grounding-graph evidence drains through the production cleanup without throwing, detaches the evidence and drains the later harmless intent too". The receipts come from the real snapshot services. All three intents end done in order, the log is truncated, the snapshot and graph files still exist, and a restarted store has nothing to drain. Filesystem ports that throw if called prove that detaching touches nothing. |
| 2 | A 31-day-old snapshot receipt whose `.sfp` folder was deleted: the leader initialization path completes, and the intent ends done or quarantined | Process level: `e2e/retention-startup.test.ts`, below. Unit level: "the retention sweep drains a 31-day-old snapshot receipt whose .sfp folder was deleted, and tool calls keep working" runs `runRetentionSweep` over the real journal, receipt, egress and recipe-hold stores and real orphan scans; a second capture then succeeds through the same execution plane. The source test "index.ts drains through the production cleanup and schedules the sweep after leader initialization instead of awaiting it" pins the wiring. |
| 3 | Unregistered gives done, unavailable gives deferred, repeated failure gives quarantine, and the log can still truncate | `retention-sweep.test.ts`: "gives done for an unregistered workspace, deferred for an unavailable one, and a terminal versioned quarantine row for repeated failure, after which the cleanup log still truncates". It uses the real workspace store (the unavailable root is deleted) and real receipt stores restarted between drains. It checks the v2 rows, that the quarantined intent is not retried, and that the log truncates once the owner removes the unavailable registration. "gives done for a registered, available workspace whose .sfp folder, and so the target file, is missing" uses the real artifact store, native port and workspace policy. |
| 4 | One workspace's orphan scan throwing does not stop the others | `retention-sweep.test.ts`: "keeps scanning the other workspaces when one workspace orphan scan throws"; `workspace-config-store.characterization.test.ts`: "a failing evidence scan of one available workspace is logged and the other workspaces are still scanned" |
| 5 | The sweep does not hold the recipe-hold lock across the whole run | `retention-sweep.test.ts`: "takes the recipe-hold lock per batch, so a real hold operation proceeds between batches and the next batch honors it". A real `RecipeEvidenceHolds.ensureHeld` runs between the orphan scans of two workspaces. If the sweep still held the lock, that call could not acquire it and the sweep would never finish. The next batch sees the new hold. |

The process-level acceptance test (`e2e/retention-startup.test.ts`) seeds a temporary owner state with the real stores: owner egress, the owner principal key, a registered workspace, and a `snapshot.capture` receipt that the receipt store's own compaction turns into a cleanup intent 31 days after completion. It then deletes the workspace's `.sfp` folder and starts the built daemon. It asserts that the leader becomes ready, `/ping` answers, `/control/status` returns 200 with `role: 'leader'`, the `ping` tool succeeds, the sweep logs `cleanup done=1`, the cleanup log is truncated, the daemon exits 0 on stdin EOF, and a restarted store has nothing to drain.

Additional tests:

- The decision table, including detaching on unavailable and unregistered workspaces, a held intent, both `workspaceId: null` cases, `export` removal with the fixed context, `legacy-unbound`, and the removal races.
- Batches of 32 following the cursor; phase isolation with the purge skipped after a failed compaction; the log lines; abort between batches; scheduling that never waits and only logs failures.
- Store level: isolation, durable counts, `CLEANUP_FAILED` for an error without a code (the message is not persisted), deferral without a row, the cursor and code-unit order, the batch-size check, and seven malformed v2 rows rejected as `EVIDENCE_RECEIPT_CORRUPT`.
- `removeLinked` with a deleted `.sfp` folder, over the real workspace policy.
- `GenerationRetentionCoordinator`: `close()` aborts the running sweep's signal and does not rethrow its failure.

## Commands and results

Environment:
- Windows 11 Pro 10.0.26200, Node 24.21.0, pnpm 11.24.0, Vitest 4.1.11.
- Working copy: the git worktree `.worktrees/lane-c`. It is a separate working copy, not a sandbox: it shares the Windows user's filesystem privileges, process namespace and network.
- Only focused test files were run; the full suite was not.
- Test processes: the acceptance test starts the built daemon; the real workspace policy starts the boundary probe; the real directory leases use the lease broker. Every spawn site passes `windowsHide: true`, and T09 adds no production spawn site.
- Superpowers skills were authorized for this task but were not available in this session. The test-first and verification discipline was followed by hand.

Environment for every command, run from `service/`:

```sh
export PATH="/c/Windows/System32:/c/2026_project/super-figma-pipline/.worktrees/_cache/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH='C:\2026_project\super-figma-pipline\.worktrees\_cache\ms-playwright'
export TEMP='C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp'; export TMP="$TEMP"
export LOCALAPPDATA='C:\2026_project\super-figma-pipline\.worktrees\_cache\localappdata-ascii'
```

| Check | Result |
| --- | --- |
| Baseline at `89c20dd`: characterization, receipt store, T08 characterization, lifecycle | 4 files: 46 passed |
| Baseline at `89c20dd`: artifact store, native evidence port, recipe evidence hold, workspace config store | 4 files: 141 passed, 4 skipped |
| Red: `e2e/retention-startup.test.ts` against a build of `89c20dd` | 1 failed: `/control/status` returned 500, and stderr showed `leader runtime initialization failed (Error: native evidence cleanup requires manual verification)` |
| Red: the new and updated unit tests before the fix | 2 files could not import `retention-sweep.js`, and 8 tests failed, each for the intended reason: the drain rejected instead of isolating, v2 rows were rejected, `removeLinked` threw `WORKSPACE_PATH_NOT_FOUND`, the sweep helper returned nothing and did not isolate, and the coordinator passed no signal. A ninth failure in the same parallel run was the existing test "preserves a replacement installed during the artifact-quarantine async window across restart", before any source change; see the limitations. |
| Green: characterization, `retention-sweep`, receipt store, T08 characterization, lifecycle | 5 files: 62 passed |
| Green: artifact store, native evidence port, recipe evidence hold, workspace config store | 4 files: 142 passed, 4 skipped |
| Focused regression set: the above plus boundary limits, admin audit, atomic file, remote domains, the portal store characterization, the snapshot services and the root `test/task-8a-direct-fs-importers.test.ts` | 16 files: 331 passed, 5 skipped |
| `packages/mcp/test/execution` (all), workspace config, policy, resolver, atomicity and usage-guard tests, and the recipe evidence-hold and read-back tests | 46 files: 463 passed, 5 skipped |
| `pnpm build`, then `e2e/retention-startup.test.ts`, `e2e/process-lifecycle.test.ts` and `e2e/mcp-wire.test.ts` | 3 files: 27 passed, 1 skipped |
| `pnpm typecheck` | Exit 0 |
| `pnpm lint` | Exit 0 |
| `pnpm format:check` | Exit 0. Only the changed files were formatted, with `pnpm exec oxfmt <files>`. |
| `pnpm knip` | Exit 0 |
| `pnpm contracts:update --check` | "All 4 generated tool-contract artifacts are current." |
| `node scripts/verify-upstream-lock.mjs --offline` | Stops at the pre-existing `[PROTECTED_AUTHORITY] protected service file hash mismatch: README.md` (K5), as in T06a and T08 |

## Deviations and their reasons

- **Files against the plan's T09 list.**
  - `snapshot/snapshot-operation-evidence.ts` did not need a change. The detach decision belongs to the cleanup, and the evidence those services record is unchanged.
  - Added: `execution/retention-sweep.ts` (the extracted, testable sweep), `execution/execution-plane.ts` (the coordinator's signal and close) and `fs/workspace-config-store.ts` (the sweep helper T08 introduced).
- **Seeder.** The plan names the T06b seeder, which does not exist yet. The acceptance test seeds with the real stores directly, and the unit test produces its receipt through the real snapshot services.
- **The seam.** `initializeLeaderRuntime` is a closure in the process entry and cannot run in a unit test. The full leader start is therefore covered by the built-daemon test, and the unit tests drive the extracted `runRetentionSweep`, `cleanupRetainedEvidence` and `scheduleRetentionSweeps`. A source test pins the `index.ts` wiring.
- **The drain API changed.** `drainPendingArtifactCleanup` returns a report, takes an optional cursor and limit, and no longer rejects when its callback throws. Existing callbacks that return nothing still mean done, so the recipe evidence-hold tests needed no change.
- **The T08 source pin** now checks that `runRetentionSweep` iterates through `sweepAvailableWorkspaces` and that `index.ts` wires `listWorkspaces` to the store. The T08 behavior test is unchanged apart from the returned summary.

## Limitations and follow-ups

- A deferred intent keeps the cleanup log from truncating until its workspace is available again, rebound or removed. The log grows with the other intents' rows in the meantime, up to the per-actor cap. An automatic end for long deferrals would need an owner decision.
- Quarantine rows are dropped when the log truncates. After that, the trace is the log line and the evidence on disk, which the orphan scans report.
- The sweep takes the recipe-hold lock once per batch instead of once per sweep. Each acquisition verifies the state root's permissions, which on Windows can start the ACL helpers. T11 caches the SID.
- No command deletes snapshot or grounding-graph files; the owner deletes them by hand.
- `/ping` still does not report runtime health. That is T10.
- Pre-existing, observed by reading the code and not tested: a journal tombstone expires 30 days after the operation was issued (`operation-journal.ts:1488`), and a receipt 30 days after it settled. A sweep that falls between the two purges the tombstone before its receipt expires. After that, `settledAt` returns null, and the receipt is never compacted. T09 keeps the purge after the compaction, so it does not make this worse.
- The existing test "preserves a replacement installed during the artifact-quarantine async window across restart" failed once, in a parallel run of six files, before any source change. It passed five times alone and in every later run. It is timing-sensitive under load and is not related to T09.
- `PROTOCOL_VERSION` is unchanged: T09 changes no wire message. The cleanup log is local owner state; a downgrade with v2 rows fails closed, as described above.
- Provenance: `service/upstream-lock.json` was not edited, as instructed. The per-task provenance step (T05a tooling) is still pending.
- Only Windows was exercised. The macOS and Linux branches of the acceptance test were not run.
