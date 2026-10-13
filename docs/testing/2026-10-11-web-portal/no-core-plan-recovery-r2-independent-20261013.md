# Independent review: exact No-Core original-plan recovery R2

Review date: October 13, 2026, Asia/Seoul. Closed at 20:25:39.503 KST (`2026-10-13T11:25:39.503Z`). Decision: **approved for integration of the exact frozen two-file candidate**, with no blocking findings in this bounded review. Integration, deployment and recovery of an actual historical run remain unverified.

This review follows [AGENTS.md](../../../AGENTS.md), the shared personal analysis policy, the current [service analysis](../../service-analysis.md), the canonical [recovery analysis](../../analysis/portal-local-capture-recovery.md), and the existing [candidate/R1 rejection record](no-core-plan-recovery-review-20261013.md). Root owns updates to those common authorities. This reviewer owns only this report, its [closed receipt](no-core-plan-recovery-r2-independent-20261013.json), and its ignored regular review copy.

## Source binding and initial state

The Main/native baseline is `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`, on Main HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`. Main already contained substantial modified and untracked work. The owner's index SHA-256 was `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675` at opening and closing. No source integration, staging or commit was performed.

The exact frozen manifest is `.worktrees/_cache/no-core-recovery-20261013/freeze-r2/frozen-files.json`, SHA-256 `97b219177b9d705ea122dde1e42004b74c5df607290c20f7e1966ee17255fcb2`.

| Candidate file | Main/native preimage SHA-256 | Approved R2 SHA-256 |
| --- | --- | --- |
| `packages/portal/src/bridge.ts` | `5e729885279e81964144f450c59fd56747282541d0ad90d2a76b6f5ac93ce5b2` | `ab7008aea8646ade1eff75bb03b5e5c755656662e815dc1775185528ea94b9e2` |
| `packages/portal/test/backend.test.ts` | `e788e7330434cadbc28bad0179b5fe7dfa7fa57bfc0a80501406280d1cc7355a` | `2b47f7e3c843b47cb19ea4eb20038de330c90d80602c58499842e62d116538ac` |

A new regular copy was created at `.worktrees/_cache/no-core-r2-independent-review-20261013/service`. All 1,357 baseline files were copied only after their bytes matched the existing `public-r60-ready-r63/main-base-files.json` manifest. Both candidate preimages and frozen postimages were verified before overlay. Closing readbacks checked all 1,357 manifest entries in Main, native and the review copy: Main/native retained the baseline, while the review copy retained exactly the expected two-file delta. This verifies manifest-bound baseline entries; it does not claim a new whole-source release or rederive the canonical source fingerprint.

## Purpose, architecture and findings

The service turns retained Figma acquisition and generation workflows into a local portal. An uncertain `portal_plan` response can leave a guided run unknown before any Core run ID exists. The existing bridge could not expose Refresh for that state, even when the authenticated original operation had conclusively settled before dispatch. This candidate adds one narrowly constrained inspection path through the existing Refresh action.

1. **Eligibility and proof are narrow.** `bridge.ts:844` requires an idle unknown no-Core run whose unresolved operation is explicitly `portal_plan`, with a nonempty retained ID equal to the run's original operation ID, and an inspection control. `inspectNoCorePlan` accepts the complete strict `OperationRecordSchema`, then requires exact operation ID, workspace, tool kind/name, settled timestamp and `pre-egress-rejected`. Generic failed/rejected/succeeded/unknown records cannot clear this fence. Tombstones cannot pass the full-record schema. The public control adapter uses the existing authenticated operation GET, without an additional tool invocation. The inspected execution-plane lifecycle settles pending approval as pre-egress-rejected, queued work as failed and dispatched work as unknown; the new classifier preserves those distinctions.

2. **R2 closes R1's split-write issue.** `bridge.ts:869` commits the proof event, failed classification, approval/node cleanup and unresolved-fence removal inside one `PortalStore.updateRun`. `store.ts:108` clones the stored data, serializes the change, writes an owned temporary file and renames it before publishing the clone in memory. There is no separate disposition-event write after releasing the fence. Unknown status, original operation ID and prior events remain retained until that transaction. The four-case run exercised a real destination-directory rename failure, verified the original snapshot/start fence, then retried and reopened the store to verify the complete successful disposition.

3. **Asynchronous inspection stays exclusive.** The existing launch reserves the active slot before starting the read. Its four-operation capacity and concurrent-run checks remain unchanged. Before admitting classification, the store callback checks the exact active signal, absence of cancellation/close, current unknown state, absent Core ID, and unchanged original operation/workspace identity. Late proof after cancellation or close was executed independently and retained unknown status. Field-staleness guards were inspected statically; the requested four cases do not separately mutate every guarded field. Cancellation/close after a store transaction has already been admitted is not a rollback mechanism for that transaction.

4. **Fresh execution and activity semantics remain bounded.** The existing public start guard continues to reject this workflow while it is unknown or unresolved. The positive test proves that only a distinct new run may start after successful classification, with no replay performed by Refresh. The HTTP server already treats Refresh as necessary cleanup when activity capacity is exhausted (`server.ts:708`); its warning/fence path was inspected and is unchanged. That existing HTTP capacity case was filtered in this independent run, rather than counted as a new pass.

No candidate change edits the authenticated daemon journal, renews an operation/run/grant deadline or changes a data authorization. The disposition records the previous unknown status as history and establishes only the narrow pre-dispatch classification.

## Independent execution

Run from the new owned review directory:

```text
node C:/2026_project/super-figma-pipline/.worktrees/baseline/service/node_modules/vitest/vitest.mjs run --config review.config.mjs --project portal -t 'no-Core original plan inspection' backend.test.ts --reporter=verbose --reporter=json --outputFile.json=targeted-report.json
```

Vitest 4.1.11 exited zero: **four passed, zero failed, 67 filtered**, one test file, reported duration 1.46 seconds. The four executed cases cover exact pre-dispatch proof and fresh start, invalid/foreign/uncertain proof, exclusive inspection and cancellation/close, and real failed persistence with durable retry. The closed receipt binds the exact case names and raw JSON report hash. Type/lint/format results in the author manifest remain author evidence; they were not repeated here.

The configuration resolves existing native dependencies read-only and maps service imports into the regular owned source copy. There was no dependency junction, dependency installation, build, Docker invocation, full suite, browser action, live API call or mutation of Main/native source. Tests used fresh owned temporary fixture stores. These are same-owner Windows processes with ordinary filesystem permissions, not an OS filesystem, process or network sandbox. Hash checks provide observed integrity evidence, not access isolation.

## Limits, risks and continuation

The operation records in these tests are controlled fixtures. This independent pass does not authenticate a real retained operation, prove historical source dispatch absence, settle an actual unknown run, establish a public compiler positive or complete a portal/Figma/frontend journey. Successful rename and reopen establish application-level atomic publication; no power-loss durability or fsync guarantee was exercised. Inspection errors intentionally leave the original unknown snapshot and fence intact, so an unavailable authenticated control still requires retry or diagnosis.

Root can integrate only the two approved frozen byte sequences at its selected reviewed boundary, preserve R1 rejection evidence, and bind later source/build/release evidence honestly. Any actual recovery should use the deployed existing Refresh action through the sole authorized live controller and retain original history/deadlines. No product question is needed for this narrow classifier; expanding recovery beyond exact settled pre-egress rejection requires separately specified evidence and authorization. Official-MCP live verification remains owner-deferred, and the second/final eCommerce acceptance remains owner-skipped, not passed.
