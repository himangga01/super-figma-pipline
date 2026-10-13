# Fresh actual-UI Scripter candidate driver

Date: October 11, 2026 (Asia/Seoul). The coordinator requested a private one-shot driver for the newly completed actual web run. This prepares a concrete execution artifact for root review; the author did not execute it, acquire a coding lease, submit files, install dependencies, start an application, control source Chrome, validate or apply a candidate.

Latest update: the coordinator subsequently executed the reviewed driver and the bounded continuation below. Candidate submission succeeded; native validation/application remain pending. Earlier sections preserve the pre-execution handoff rather than claiming that no coordinator execution occurred.

Read the [usage implementation record](usage-guide-implementation.md), [current candidate review](../2026-10-10-continuation/cdd-page-api-candidate-review.md), [canonical service analysis](../../service-analysis.md) and [AGENTS.md](../../../AGENTS.md) before reuse. The older unapplied candidate's authoring/review history is preserved. No R8 or reference frontend was read or copied for this continuation.

## Exact current authority

- Public web run: `a408d340-12ab-417e-abf7-20d129d150b0`.
- Core run/plan: `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d`.
- Workspace: `4362ae3f-a37a-44c0-98e2-aa1c1f2623ae`.
- Current target: `cdd-usage-round-2-r2`.
- Source: Chrome/Scripter, CDD file `ly06O8jAcrd7oWmwhz5Vr6`, node `1378:120`.
- Current capture hash: `sha256:c69045257d5b541f3af3d941dad61559bc4702c7fb22040ecee641012cdba102`.
- Read-only current public record: `.worktrees/_cache/portal-usage-20261011/current-scripter-run.json`. It reports awaiting-agent, complete/live-verified design and complete workflow coverage. The coordinator had not requested web Next or obtained a lease.

The source baseline is the portal's `935216d1...` epoch plus the coordinator's ongoing source changes. A new complete source check is still owed. Historical page-API/Scripter preparation, the first failed actual UI capture and the newly complete source run remain separate observations. This driver does not convert any preparation into accepted implementation or a passing third round.

## Prepared files and comparison

The approved 44-file unapplied candidate at `.worktrees/_cache/cdd-page-api-authoring-20261011` was copied into the new owned `.worktrees/_cache/cdd-ui-scripter-authoring-20261011-r2`. Each copied submission file was SHA-256 compared with its source. The output-file manifest and three root PNG oracle files were copied separately; root PNGs remain evidence-only and are excluded from the implementation submission. No `node_modules`, old execution helper or custom server was copied or executed.

Filesystem inspection compared the current stored capture's raw bytes against the hash in the actual public plan, then compared its projected source facts with the approved candidate. All 192 node records are exactly equal. The style rows are exactly equal across paints/texts/effects/grids, with counts 39/16/1/0. Variables and collections are empty. All 25 captured asset metadata records match, and the approved candidate/oracle bytes have the hashes and lengths declared by the current capture. The current 7-result core binding differs and must be fetched/rebound rather than copied from the old run.

Private preparation evidence is `.worktrees/_cache/cdd-ui-scripter-preparation-20261011-r2.json`. This preparatory inspection did not independently verify the protected record's MAC; the execution driver therefore obtains authenticated public service context and rechecks these same bindings before submission. The copied candidate intentionally retains its original metadata until that fresh context has been obtained.

## Driver behavior and safety boundaries

The concrete driver is `.worktrees/_cache/cdd-ui-scripter-driver-20261011-r2.mjs`, SHA-256 `9b5fad655ea66ab1bdb2b12e7bb239320e56b55382e72fa1ce706306f55532af`. Node syntax checking passed. Its implementation was reviewed at source level; it has not had an executed end-to-end run or fixture run.

The driver requires explicit execution/submission flags, state root, control port and actual loopback portal URL. It reads the current public web record, verifies the exact run/workspace/target, frontend-only C4 scope, four confirmed requirement IDs, complete Scripter capture, workflow/interaction coverage and core preparation. It uses one `ControlClient` for status, a new coding lease, all context pages and all submissions, with a credential-continuity check before each invocation.

Before every invocation it issues an original operation ID, writes that ID/name/workspace/argument hash to an exclusive intent file, and passes the exact operation ID to `invoke`. No raw lease body is printed or placed in the intent metadata. On an invocation exception, it retains an unknown/unconfirmed record for inspection and stops. It does not automatically retry, take over a prior lease, reuse an existing submitted candidate or reset a deadline. The exclusive context directory prevents replay of this one-shot driver. A missing receipt after an intent is not permission to rerun it.

Fresh `portal_next` pages provide all nodes, each style family, the asset inventory and the seven current work items/recipe pages. Exact node/style/asset differences stop execution for review. Matching asset bytes are rebound to the current asset IDs. Only after those checks does the driver refresh the capture hash, binding metadata, current derive-tokens material, all 44 file hashes and seven core declarations. It submits create-only file/asset batches through the same lease. Final candidate-ready is a service submission result, not validation/application/final acceptance.

The driver requests no automatic service approvals (`approve:false`). Any requested service approval must be reviewed through the currently opened portal or otherwise by the coordinator's authorized service path. Native Chrome security approval is never automated. It contains no package installation, setup/deploy hook, application startup, browser launch, validation or application call. The source Chromium connection remains root-owned.

Context/results, including the coding lease, are saved only in the private `.worktrees/_cache/cdd-ui-scripter-context-20261011-r2` folder. The driver requests restrictive filesystem modes, but those Unix mode bits alone do not prove Windows ACL isolation. It runs under the same Windows owner account and is not an OS sandbox. The coordinator should preserve the folder's privacy and inspect original operations before any continuation after an unknown outcome. No authentication token, credential or secret value is included in this report.

## How the coordinator can execute after review

From the repository root, using the current reviewed native CLI library:

```powershell
node .worktrees/_cache/cdd-ui-scripter-driver-20261011-r2.mjs --execute --submit --state-root C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline --control-port 3055 --portal-url http://127.0.0.1:4310/
```

Port `3055` is the control endpoint. The earlier `41108` identifier referred to the daemon process ID, not its port; the chat planning reference was corrected before execution. The driver requires an explicit port and never hardcodes `41108`.

After a successful submission, the user/coordinator requests actual service status through the portal to observe candidate-ready. Fresh native profile preparation, review, candidate validation, guarded application, applied validation and current-source acceptance remain separate authorized steps. The current run's budget reportedly expires around 22:34; expiration must remain a failure/continuation boundary, not be reset by this helper.

## Actual initial failures and bounded continuation

The coordinator's first attempt failed with `STATE_PATH_UNSAFE` before issuing any operation because the caller did not use the daemon's `LOCALAPPDATA` anchor. The original r2 context retains only its driver intent and was not replayed. The coordinator corrected the environment and used the separate exclusive `cdd-ui-scripter-context-20261011-r2-envfix` folder. That attempt acquired a real lease and completed all current node/style/work-page reads.

The original writer used indented JSON and expanded `src/design-data.json` to 1,547,652 bytes, exceeding the one-MiB source-file submission bound. The attempt stopped before any submission intent or operation; no candidate files or declarations had been submitted. This was a helper serialization error. The original lease, reads and receipts were preserved.

The reviewed continuation `.worktrees/_cache/cdd-ui-scripter-continuation-20261011-r2-envfix.mjs` has SHA-256 `217d1618119a2f5c6bd2d882305961f680f80afa809aa9c2bf5a977a12d219dc`. It compacts only that design JSON, verifies identical parsed facts and recalculates every file hash/declaration. The resulting file is 878,843 bytes. File batches respect the actual one-MiB decoded aggregate/per-file limit, and each final JSON argument packet stays below two MiB, within the service's eight-MiB argument and nine-MiB control-envelope bounds.

The continuation calls only read-only `portal_status` and `portal_submit`; it never calls `portal_next`, replays known reads, renews a lease or changes the run deadline. It uses the exact latest authenticated receipt's original lease ID/epoch and observed 22:12:05 expiration. Control authentication sessions derive from the owner key, credential and leader generation, not a JavaScript client object. The original driver had not persisted its credential hash, so a newly read hash alone could not prove original continuity. The continuation therefore checked public epoch/expiry and relied on the server's first submission to validate the exact original lease ID, epoch and authentication binding. A rejection would stop without taking a new lease. Every operation again had an original ID and durable pre-dispatch argument hash, with an exclusive ledger and unknown-on-error records.

The coordinator executed it with control port 3055 and the correct `LOCALAPPDATA`. The actual service accepted the original lease and returned `candidate-ready` with 44 files and seven declarations. Candidate hash: `sha256:ac97faf24d1bbc428e5c1e2d5c61429d81e9f40241546794c8ad53ba9a11fdcf`. Filesystem review verified that the authenticated final receipt, all 44 local byte hashes, the submitted catalog and all seven declaration file maps agree. The current token/style catalog contains 95 rows. The seven work pages include two audit-styles pages; they are matched by result ID plus exact page hash, not result ID alone.

The author did not execute either driver. Node syntax checks passed, and local receipt/file comparisons were executed. No installation, browser launch, native validation or application is claimed by this candidate-ready result. For future reproduction, the caller must set `LOCALAPPDATA` to the same `cdd-native-appdata` anchor as the retained daemon; this is a path-authority prerequisite, not a reason to weaken `STATE_PATH_UNSAFE`.
