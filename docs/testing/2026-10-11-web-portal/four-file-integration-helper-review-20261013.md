# Four-file integration helper: independent review

## Root review of held-file revision R2

Root reviewed the complete R1-to-R2 delta at helper hash `02c62affb3ac3f55253687739e88fc5dd6ebfce6251c85e2373ff34e4b1d30ef`. R2 pins bigint file/directory identities and preimages, verifies a held non-truncating file descriptor before mutation, persists each path's intent before writing, and atomically publishes later verified/failed receipts. Root accepts this correction conditionally for the exact reviewed four-file batch on unchanged source/index. No integration has occurred. Further route-resolution and preview-navigation fixes are being prepared, so the four-file helper must not be invoked as though it covers a later larger batch.

The three owned-root fixtures address the identified late symlink/hardlink substitutions and receipt failure after mutation. A durable `intent` remains an unknown write outcome after interruption even when its pre-write snapshot contains `mutationStarted:false`. Held-file checks are application-level safeguards under the same Windows owner; they do not prevent every concurrent alias creation or provide cross-file atomicity, an OS sandbox or automatic rollback. R1 stays rejected and preserved.

Date: October 13, 2026, Asia/Seoul. R1 review and subsequent owner-authorized bounded R2 preparation. Original reviewed helper: `.worktrees/_cache/r60-main-integration-preparation-20261013/integrate-reviewed-four-files.mjs`, SHA-256 `1fd325bf12ea112dcb79c0b3d77e649a1c57ce93c1db69dffe52046f3c30c59e`.

**Decision: R1 is rejected and preserved. A separate R2 candidate addresses both findings, passes three bounded fixtures and read-only preflight, and awaits Root's exact-hash review before execution.** No integration was performed. The reviewer became the R2 helper author after Root explicitly accepted both findings and assigned the repair; the R2 evidence below is author evidence, not a self-issued independent approval.

## R2 candidate and bounded proof

New helper: `.worktrees/_cache/r60-main-integration-preparation-20261013/integrate-reviewed-four-files-r2.mjs`, SHA-256 `02c62affb3ac3f55253687739e88fc5dd6ebfce6251c85e2373ff34e4b1d30ef`. The original R1 hash remains unchanged. R2 retains the exact four logical/eight physical targets, candidate hashes, lineage, preimages, source/index baseline and reviewed No-Core receipt. Its explicit mutation argument is `--integrate-reviewed-four-files-r2`; no execution argument was used here.

R2 captures canonical parent directory identities and the original file's bigint device/inode/size/timestamps/link count. Immediately before mutation it opens a non-truncating `r+` handle, checks the path and held handle against that snapshot, hashes bytes read through the held handle, and repeats index/path/identity/bytes checks after publishing intent. A substituted same-byte symlink or hardlink therefore cannot turn the late hash check into authority to overwrite a foreign target. It writes only through the verified held handle, syncs and rechecks the postimage through that handle/path, then verifies all eight final physical identities/hashes before success.

The prepared receipt contains all eight target/backup mappings. A selected target's intent is published before mutation using an exclusive temporary file, file sync and rename. A verified or failed status follows the observed result. If later receipt publication fails, the last published record still identifies that attempted path and its retained backup. The catch preserves partial/uncertain work, disables replay and does not roll back. Receipt publication is atomic at the application rename boundary; there is no cross-file transaction or power-loss durability guarantee.

The new owned-root proof script `.worktrees/_cache/r60-main-integration-preparation-20261013/prove-four-file-helper-r2.mjs` passed **three cases, zero failures** at 20:43:57.671 KST. [The portable proof](four-file-integration-helper-r2-proof-20261013.json) pins the R2 helper hash and outcomes:

- Replace the target with an actual same-byte symlink after durable intent: identity rejection before mutation; the outside same-byte fixture file remains unchanged; failed attempt is retained.
- Replace the target with an actual same-byte hardlink after durable intent: the same pre-mutation rejection and unchanged outside file.
- Reject atomic receipt publication after a successful target mutation using a controlled expected-directory identity mismatch: the exact target postimage exists, the in-memory attempt is uncertain, and the unchanged last published receipt retains its path/backup and pre-mutation intent. This is a controlled publication rejection, not a simulated claim of an actual kernel rename failure.

R2's separate `--preflight-only` command exited zero with `writesPerformed:0`, four logical files/eight intended targets, 303d baseline and unchanged index. The proof mutates only new owned temporary fixture roots; product Main/native files, Git index, QA and live surfaces remain untouched. Same-owner Windows races after the last checks remain possible. Held handles and repeated identity checks narrow the boundary; they do not create an OS filesystem/process/network sandbox. Root must independently review this exact R2 hash and hold actual execution until its verified live-phase boundary.

This review follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [service analysis](../../service-analysis.md), [recovery analysis](../../analysis/portal-local-capture-recovery.md), [R60 independent review](c2-css-decoder-r60-review-20261013.md) and [No-Core R2 independent review](no-core-plan-recovery-r2-independent-20261013.md). Root owns canonical documentation and execution after a verified phase boundary. The reviewer read the complete four-file helper and its original two-file `integrate-r60.mjs` template; both share the findings below.

## Baseline and intended behavior

Main/native baseline is `sha256:303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`, with existing uncommitted work on HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`. The owner index is pinned to `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675`.

The helper admits exactly four logical paths: R60 compiler source/test and No-Core R2 bridge/backend test. Each is copied to both Main and native, giving eight intended target writes. It uses a fixed project directory, explicit execution argument, four pinned R54/R56/R58/R60 manifests and per-file lineage, exact frozen bytes/preimages, and the pinned approved No-Core receipt `097ff7fdb9a2debeb695e6fbd57943eb4b3fd7b8d9272743fb115829e3adc278`. Candidate path values do not drive target selection. The existing evidence directory must be absent, backups are exclusive, automatic replay is explicitly false, and final Main/native fingerprints plus index are checked. It does not copy daemon state, grants, profiles or any runtime authority.

## Findings requiring correction

1. **Initial regular-file verification is not retained at the mutation boundary.** `regular(p)` checks file type, lack of a symlink and a single link during preparation. Later, the mutation loop hashes `w.p` and calls pathname-based `writeFile(w.p, w.after)` without a fresh regular/identity check. `hashFile` follows symlinks. A target replaced after preparation by a symlink to a same-byte file, or a new hardlink to one, passes the late preimage hash and is then overwritten through the new pathname. Fixed lexical paths therefore do not establish the advertised physical write scope at that boundary. This is a static counterexample; no Main/native substitution was attempted. Recheck canonical parent containment and regular/single-link identity at mutation, use a non-truncating held file handle or bounded replacement mechanism that avoids following a newly substituted target, and retain an explicit same-owner race limitation. These safeguards do not create an OS sandbox.

2. **The receipt omits an uncertain write if mutation fails before verification.** The loop appends a path to `receipt.writes` only after `writeFile` and its postimage hash both succeed. A partial/truncated write, readback error, process exit or failure before that append can alter the target while leaving it absent from the persisted write list. The catch status is conservative, but the receipt has no complete planned-target mapping or pre-mutation attempted-path record. Its numeric backups cannot by themselves identify the uncertain target after process loss. Record all eight planned target/backup mappings in the prepared receipt, durably mark the selected target as an attempt before mutation, and mark it verified only after its postimage/identity checks. Receipt publication must preserve the last valid record on failure. A failed attempt stays non-replayable and requires explicit reconciliation; no automatic rollback is implied.

The final success counter is correctly eight, and the earlier four-counter preparation mistake did not execute integration. Final equality of the source fingerprints does not supply the missing attempt history or physical-file boundary.

## Executed check and limits

Only this authorized read-only command ran:

```text
node .worktrees/_cache/r60-main-integration-preparation-20261013/integrate-reviewed-four-files.mjs --preflight-only
```

Exit zero. Output reported `preflightOnly:true`, `writesPerformed:0`, `files:4`, `intendedTargetWrites:8`, the exact 303d baseline and `ownerIndexUnchanged:true`, with all four expected manifest hashes. No evidence directory, backup or execution receipt was created by that branch. No source write, Git staging, integration, build, install, broad/full test, QA/API read, browser action or runtime authority change was performed by this reviewer.

The review is static plus preflight. The eight-write loop, write-error paths, receipt interruption and postintegration fingerprint branch were not executed. Same-owner Windows directory separation and hashes provide observed integrity checks, not filesystem/process/network isolation. Actual integration must remain held until Root's verified live-phase boundary, followed by exact-hash review of the repair and honest source-bound checks. No product decision is required to correct these two accounting/write-scope gaps.
