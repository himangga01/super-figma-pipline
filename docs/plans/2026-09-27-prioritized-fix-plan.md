# Prioritized fix plan

Date: September 27, 2026. Baseline: `main` at `0a0f3ad`. Status: **draft v2**. Version 1 was reviewed by three plan reviewers (sequencing, technical design, coverage and verifiability). All of their findings were accepted (Appendix C). This version awaits owner approval and owner decisions. No code has been changed.

## 0. Document precedence

- **This plan governs execution order, task scope and gates** for remediating the September 27 review findings.
- **The [code remediation plan](2026-09-27-code-remediation-plan.md) remains the evidence record.** Its findings ledger (section 3) and its fix directions to avoid (Appendix B) stay normative. Its workstream design (section 4) is guidance. Where this plan differs, this plan wins, and each difference is listed in Appendix B.
- **The [remaining-work plan](2026-09-14-remaining-work-plan.md) keeps its W01–W10 and Task 1–8 structure.** The September 27 review rounds are not its two post-implementation code-review rounds; those rounds still run after implementation (section 6, final gate). Section 5 maps this plan onto that structure.
- **Finding IDs** (K1, SVC-1, OPS-1 and so on) refer to the remediation plan's ledger.

## 1. Ranking method

Tasks are ranked by the criteria below, in this order.

1. Blocks the core C4 path on the owner's machine, or wedges the daemon or loses data. The owner's machine is Windows 11 with a Korean locale and a user profile path containing Korean characters.
2. Blocks verification of other fixes: test suite, provenance lock, the console pop-up policy.
3. Produces wrong results or duplicated effects in normal use.
4. Enables C2/C3. The active plan delivers C4 first, and C2/C3 also needs owner decision D1.
5. Design fidelity, security hardening, long-term state lifecycle, and release integrity, in that order.

Within a tier, tasks that unblock others or are small come first. Tasks that edit the same file are sequenced. Only tasks whose files are disjoint run in parallel lanes (section 4).

## 2. Execution rules

**Test first.** Each task starts with a failing reproduction. Reproductions are normal tests that assert the current error code, for example `rejects.toMatchObject({ code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED' })`. They are flipped when the fix lands. Do not use `it.fails`: it passes on any error, including a failed reason assertion.

**Native, separate working copy.** Validate natively in a separate working copy bound to the source hash. Do not use Docker, a VM or WSL. These copies share the Windows user's filesystem privileges, process namespace and network, so they are not security sandboxes. Destructive tests (T07, T15a, T37) and every native run before G2 use a disposable state root. That root is a scratch `LOCALAPPDATA` whose path contains Korean characters, so OPS-1 coverage is kept.

**Consent.** Every local test run on the owner's machine needs the owner's confirmation, whether focused or full, because tests spawn PowerShell and other helpers. Ask once per task, batching that task's runs. Do not start local runs until T03 has landed.

**Per-task gate.** A task is done only when all of the following hold:
- Its focused tests pass, and type checks and lint pass for the touched packages.
- Its acceptance tests pass.
- It has passed the offline provenance step: regenerate the `serviceFiles` hashes and a change-manifest slice with the T05a tooling, and run `verify-upstream-lock --offline`. The provenance diff is recorded.
- It has an English evidence note under `docs/reviews/2026-09-27-remediation/`.

**Protocol versioning.** Bump `PROTOCOL_VERSION` whenever a plugin/daemon wire schema changes. Bump the directory-lease protocol whenever the lease script or its spawn changes.

**Sequenced files.** These files have one owner at a time:
- `mcp/src/fs/atomic-file.ts`
- `mcp/src/portal/native-work.ts`
- `mcp/src/portal/coordinator.ts`
- `mcp/src/index.ts`
- `mcp/src/portal/native-lifecycle.ts`
- `mcp/src/execution/execution-plane.ts`
- `mcp/src/execution/operation-executor.ts`
- `mcp/src/execution/operation-journal.ts`
- `mcp/src/fs/workspace-policy.ts`
- `mcp/src/portal/native-runner.ts`
- `mcp/src/portal/native-artifacts.ts`
- `mcp/src/relay/relay.ts`
- `mcp/src/election/leader-endpoints.ts`
- `mcp/src/security/state-permissions.ts`
- `shared/src/portal.ts`

**Commits and pushes.** Commit only when the owner asks. Push only as the owner approves under decision D9. Never force-push.

**Paths and sizes.** Paths are relative to `service/packages/` unless they start with `service/`, `docs/` or `.github/`. Sizes: S is about one day or less, M is a few days, L is a week or more.

## 3. Owner decisions

| ID | Decision | Needed by | Recommendation |
| --- | --- | --- | --- |
| D9 | CI evidence protocol: push a named remediation branch for each gate (never `main`); authenticate `gh` or read results in the Actions web UI. Without D9, CI evidence moves to the final gate. | G0 | Approve branch pushes per gate. |
| D3 | Recipe-hold history retention. `keep` would hit the replace cap again, because the hold index is one record updated on every hold. | T07 | Discard, keeping only active holds. |
| D4 | Validation browser. The daemon launches Playwright's bundled Firefox (`index.ts:699`), and Playwright is pinned at 1.63.0 in both packages. | T04 | Keep Playwright pinned. Install its Firefox into a fixed `PLAYWRIGHT_BROWSERS_PATH`. Treat any Playwright upgrade as a re-registration event. |
| D6 | Asynchronous long-running portal operations with polling. This decides the shape of `portal_status` and the operation IDs. | T16 | Adopt, at least for `portal_validate`. |
| D2 | Visual acceptance policy | T18 | Keep the 3% threshold. Add per-root waivers and absolute-bounds oracles. |
| D8 | Per-candidate profile approval | T13 | Keep it, with `reprepare --from`. |
| D5 | Egress for `ping` and `list_files` | T21b | Redact the `fileKey` value at egress and keep the result schema. |
| D1 | Supported-stack matrix for C2/C3 | T25 | Limit claims to a published matrix. |
| D7 | Semantics of `state reset` and key rotation | T37 | A reset requires all clients stopped and an explicit confirmation. |

## 4. Prioritized tasks

Critical path to G2:

T00 → T01 → T06c (probe) → T07 → T15a → T13 → T14b → T19a → T21a → G2

These run in parallel with it:
- T14a runs alongside T13.
- T18 starts right after T06c and precedes T16.
- T16 starts after T07 and T18.

Lane D alone is several weeks of work, so G2 is realistically several weeks after G0.

### P0 — Enable this machine and restore a truthful baseline

#### T00. Environment bootstrap and baseline census — new, S–M

- **Change:**
  - Create the separate working copy.
  - Use Node 24.17 per `.node-version`. T04 aligns CI with it.
  - Run `corepack pnpm install --frozen-lockfile --ignore-scripts`.
  - Install Playwright Firefox into a fixed `PLAYWRIGHT_BROWSERS_PATH` (D4). This is a download that needs the owner's consent.
  - Re-clone `code-kb/` at the SHAs pinned in the CI workflow. `vendor-upstreams.test.ts` junctions into it. This needs network access.
  - Run `pnpm verify:source` once with ASCII `TEMP`, `TMP` and `LOCALAPPDATA` (the interim workaround for OPS-1), archive `source-checks-report.json`, and triage every failure into a task.
  - Run an environment probe:
    - `netsh interface ipv4 show excludedportrange protocol=tcp`;
    - the PowerShell language mode;
    - whether workspace candidates live under OneDrive;
    - `netstat` state text.
    
    Record which of the environment-dependent items in T12 actually apply.
- **Acceptance:**
  - An evidence note that lists every failing test, each with the task that owns it.
  - Every environment item recorded as either applicable or not.

#### T01. Lease broker encoding and helper budgets (OPS-1, plus the lease parts of OPS-5, OPS-8 and OPS-C1) — critical, M

- **Change:** introduce protocol v2, as one protocol bump.
  - The wire format is ASCII-only: each path is sent as base64 of its UTF-16LE bytes.
  - The script reads and writes through explicit UTF-8 stdin/stdout streams with no BOM.
  - Each request is parsed inside the per-request `try`.
  - Paths are opened with `\\?\`, or `\\?\UNC\` for UNC paths.
  - The echo is the SHA-256 of the received UTF-16LE bytes. Node closes the broker on any mismatch.
  - The startup budget is 30 seconds, with pre-warming and idle retirement after minutes.
  - The first 4 KiB of stderr is kept in errors.
  - A startup probe checks for Add-Type and Constrained Language Mode and fails with `HOST_POWERSHELL_RESTRICTED`. The broker never falls back to lease-less writes.
  - The artifact schema accepts both `windows-directory-lease-v1` and `-v2`. A stored v1 profile maps to a typed re-prepare error instead of a raw ZodError.
  - The module fence is updated in lockstep, with byte-identical spawn options.
  - The boundary worker and the test probes in `state-permissions.ts` get the same stream setup.
- **Files:**
  - `mcp/src/fs/atomic-file.ts` (script and spawn)
  - `mcp/src/fs/windows-directory-lease-broker.ts`
  - `mcp/src/fs/windows-boundary-probe-worker.ts`
  - `mcp/src/security/state-permissions.ts`
  - `mcp/src/portal/native-artifacts.ts`
  - `mcp/src/portal/native-module-fence-source.ts`
- **Acceptance:**
  - Unit tests: surrogate pairs, NFD names, paths over 300 characters, UNC paths, and a mismatched echo.
  - A stored v1 profile returns the typed error.
  - A fenced preview-lease end-to-end test passes.
  - `verify:source` passes with the default Korean-path `TEMP` and `LOCALAPPDATA`.
  - A native soak of 1,000 leases passes, and the T06b census shows no visible windows.

#### T02. Tool-contract drift and plan housekeeping (K3, K4, VER-5) — high, S

- **Change:**
  - Add a `contracts:update` generator. From `ALL_TOOL_SPECS` it writes `capabilities/union-manifest.json`, `packages/mcp/test/plugin-contract.json` and the README count sections.
  - Tests assert derived equalities: the 125 upstream canonical tools plus an explicit list of service-local tools. Fix docs-sync and the CLI test that expects 127.
  - Update the completion ledger in the remaining-work plan, and point `docs/plans/README.md` at this plan.
- **Files:**
  - `service/test/tool-contract.test.ts`
  - `service/test/upstream-parity.test.ts`
  - `service/test/docs-sync.test.ts`
  - `cli/test/admin-commands.test.ts`
  - the new generator in `service/scripts/`
  - `service/README.md`
  - `mcp/README.md`
  - `docs/plans/2026-09-14-remaining-work-plan.md` (ledger only)
- **Acceptance:** adding a dummy tool fails exactly one drift check, and the failure names the generator.

#### T03. Pop-up-free, hermetic tooling (K21, VER-8) — medium, S

- **Change:**
  - Add `windowsHide: true` to every spawn in `service/scripts/` and in the tests.
  - Give packaging and test-fixture git commands a hermetic environment:
    - point `GIT_CONFIG_GLOBAL` at an empty file;
    - pass `-c commit.gpgsign=false -c core.hooksPath=`;
    - use `init --template=` and `commit --no-verify`;
    - unset `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE`.
- **Acceptance:**
  - A grep gate finds no spawn without `windowsHide`.
  - The tests simulate a hostile git configuration through `GIT_CONFIG_SYSTEM` or a temporary `HOME` (signing plus a `commit-msg` hook), never by touching the owner's `~/.gitconfig`. Under that configuration, artifacts are byte-identical and no prompt appears.

#### T04. CI and static-gate truthfulness (K6, VER-1, the generator drift check, and the checkJs part of VER-6/VER-7) — high, M

- **Change:**
  - Set `fetch-depth: 0`, take the Node version from `.node-version`, and install with `--ignore-scripts`.
  - Install Playwright Firefox into the fixed path (D4).
  - Split the gates into separate steps with `if: always()`.
  - Run `contracts:update` followed by `git diff --exit-code`.
  - Add a Windows lane with non-ASCII `TEMP` and `LOCALAPPDATA`.
  - Add a nightly job with `SFP_NATIVE_VITE_ACCEPTANCE=1`, plus `workflow_dispatch` so it can be run on demand.
  - Remove the Windows-only npm/pnpm entry paths (`release-common.mjs:49-50`, `smoke-packed-mcp.mjs:10`).
  - `windows-latest` is required. `ubuntu-latest` is informational until P7.
  - Make skips visible:
    - `run-source-checks` records skipped tests from the Vitest JSON report;
    - platform guards use `ctx.skip()`;
    - a required suite fails unless `SFP_ALLOW_SKIP=<suite>` is set.
  - Type-check `service/scripts/` and the root tests through a `checkJs` configuration.
- **Files:**
  - `.github/workflows/service-ci.yml`
  - `service/scripts/run-source-checks.mjs`, `release-common.mjs`, `smoke-packed-mcp.mjs`
  - `service/tsconfig.tools.json` (new)
  - `service/package.json`
  - tests that have platform guards
- **Acceptance:**
  - With an empty `PLAYWRIGHT_BROWSERS_PATH`, `verify:source` fails unless `SFP_ALLOW_SKIP` is set.
  - A seeded type error in a script fails `typecheck`.
  - Under D9, the CI log shows the Firefox suites and the non-ASCII lane.

#### T05a. Offline provenance tooling and refresh (K5 offline part, VER-C1) — high (process), M

- **Change:**
  - Wire `verify-staged-change-manifest`.
  - Anchor the Figwright string allowlist by content instead of by line and column.
  - Record the `review-2026-09-27` slice for `8a8dd01`, `8a0b4c7`, `0a0f3ad` and the P0 changes, then refresh `upstream-lock.json` offline.
  - Document the per-task provenance step from section 2. Staging is required for this step.
- **Placement:** last in P0.
- **Acceptance:**
  - `verify-upstream-lock --offline` passes.
  - The allowlist survives a line shift.
  - New test files under the managed roots register without `UNMANAGED_DESTINATION`.

#### T06a. Critical reproductions — S

- **Change:** add normal tests that assert the current error codes for K1, SVC-1, OPS-2, LC-1, LC-2, SA-1 and SA-2.
- **Placement:** before T05a, so that these tests are registered in the lock.

#### T06b. Test harnesses — M

- **Change:** build five harnesses.
  - Fault-injection seams for `replace` and for per-file apply in `NativeWork.apply`.
  - A signed-state seeder, for example for 31-day-old receipts and legacy v1 records. It is needed because the daemon has no clock override.
  - A window and helper-process census that lists visible windows and leaked child processes.
  - A scripted soak runner.
  - A disposable state-root helper.
- **Acceptance:** each harness has a self-test.

**Gate G0 (barrier).** All three conditions must hold:
- `pnpm verify:source` exits 0 in the separate working copy with ASCII paths (report archived).
- After T01, it exits 0 again with the default Korean-path `TEMP` and `LOCALAPPDATA`.
- The critical reproductions fail for the documented reasons.

If D9 is approved, the Windows CI run on the pushed remediation branch is green. Otherwise, CI evidence moves to the final gate.

### P1 — Keep the daemon alive on this machine (G1 is a checkpoint, not a barrier)

#### T06c. C4 plan-stage probe — S

- **Why here:** plan-time gates such as SVC-2 can stop C4 before any lease exists.
- **Change:** on a disposable state root, run only capture and `portal_plan` for the supplied design: file `4IBhv1d8hEclifZQrOYxHS`, node `0:1`. Record every plan-time blocking issue. The result sets the scope of T18.
- **Prerequisites:**
  - Figma access to the file.
  - Chrome remote debugging with one approved connection. The owner clicks "Allow" in Chrome.
  - Egress consent.
- **Depends on:** T01. Run it on a disposable root, before T07, if needed.

#### T07. Store replace integrity and the apply journal (OPS-2, R2B-1, R2A-1, R2A-2, R2A-3, CC-7) — critical, L

- **Change:**
  - Every `replace()` caller chooses a retention mode, following a per-caller table:
    - **`discard`:** `PortalStore`, including the apply record, `fs/namespace-files.ts` (snapshot and graph storage), and `security/document-binding-store.ts`. Before replacing, discard collects verified stale generations of its own target. After durable publication, it unlinks the retained previous generation.
    - **`backup`:** user-target writes (apply, `tools/design-diff.ts`).
      - The pre-image is written and fsynced to `apply-backups/<runId>/<nonce>`, and `{nonce, backupHash}` is recorded at `intent`.
      - After publication, the user-tree sidecar is unlinked.
      - Backups are reference-counted and collected when the run completes or is cancelled.
    - **`keep`:** only where decision D3 requires history.
  - Reads never return null for an interrupted replace.
    - When the store is writable, the read rolls forward under the path mutex.
    - Otherwise it throws `PORTAL_RECORD_RECOVERY_REQUIRED`.
    - `reconcileReplaceArtifacts` runs before the first retention sweep.
  - Legacy v1 apply rows keep legacy-name recovery.
  - Inventories exclude only sidecars that an active row proves.
  - The append-only intent-log option is dropped, because `discard` already bounds the apply record.
  - Journal compaction:
    - an error after the rename call reloads the journal from disk;
    - the rename retries on EPERM or EBUSY;
    - a failure after a durable tombstone is non-fatal.
  - Invariants:
    - the compare-and-swap before rename is unchanged;
    - never delete bytes that are not proven to be ours;
    - apply recovery still sees the retained and prepared files during an interrupted publish.
- **Files:**
  - `mcp/src/fs/atomic-file.ts`
  - `mcp/src/portal/store.ts`
  - `mcp/src/fs/namespace-files.ts`
  - `mcp/src/security/document-binding-store.ts`
  - `mcp/src/tools/design-diff.ts`
  - `mcp/src/portal/native-work.ts` (apply journal and recovery only)
  - `mcp/src/portal/source-path-policy.ts`
  - `mcp/src/execution/operation-journal.ts` (compaction)
- **Acceptance:**
  - Crash injection at every replace hook, plus a forced `link` EPERM. A new process reads A or B, never null.
  - Kill between the rename and the link of `recipe-holds/index`, then restart. Held receipts survive.
  - 5,000 sequential run updates succeed.
  - Through the T06b per-file seam, kill `NativeWork.apply` at file 150 of 300 and resume from the journal. The end-to-end `resume continue` check belongs to G2.
  - The sequence A→B, revert to A, then A→B again succeeds.
  - After an apply, `git status --porcelain` lists only candidate paths.
  - Upgrade in the middle of an apply that has a v1 row, then resume.
  - A planted file with a sidecar-style name is still inventoried.
  - Backups are collected on completion and on cancel.
- **Depends on:** T01 and D3.

#### T08. Per-row workspace validation (LC-2) — critical, M

- **Change:**
  - Each row is validated individually.
  - Unavailable rows are persisted verbatim, never dropped and never given a re-derived identity.
  - Workspace config v3 adds a `legacy-unbound` state for v1 rows, which have no identity key.
  - Only `add` and a nonce-protected `rebind` may set identities.
  - Removing an unavailable row requires a nonce and the `hasUnsettled` check.
- **Files:**
  - `mcp/src/fs/workspace-config-store.ts`
  - `mcp/src/fs/workspace-registration-resolver.ts`
  - `mcp/src/fs/workspace-policy.ts`
  - `mcp/src/control/workspace-endpoints.ts`
  - `cli/src/admin-commands.ts`
  - `mcp/src/index.ts` (sweep loop)
- **Acceptance:**
  - Delete A: tools on B work, `workspace list` shows A as unavailable, and `workspace remove A` succeeds.
  - Add C while A is unavailable: A is kept.
  - Recreate a different directory at A's path: A stays unavailable.

#### T09. Retention sweep isolation (LC-1) — critical, S–M

- **Change:**
  - The sweep runs after leader initialization, in batches, without holding the recipe-hold mutex across every workspace scan.
  - Each cleanup intent is isolated, with these outcomes:

    | Condition | Outcome |
    | --- | --- |
    | Unregistered workspace | done |
    | Registered, available, file missing | done |
    | Unavailable workspace | deferred |
    | Repeated failure | terminal, versioned quarantine row |

  - Snapshot and grounding-graph cleanup only detaches the evidence. Deleting the files stays a user command, because graph files are rewritten and depend on snapshots.
- **Files:**
  - `mcp/src/index.ts`
  - `mcp/src/execution/operation-evidence-receipt-store.ts`
  - `mcp/src/fs/operation-evidence-artifact-store.ts`
  - `mcp/src/snapshot/snapshot-operation-evidence.ts`
  - `mcp/src/portal/recipes/evidence-hold.ts` (lock scope)
- **Acceptance:** seed a 31-day-old snapshot receipt whose `.sfp` folder was deleted, using the T06b seeder. The leader starts, tool calls and `/control/status` work, and the intent ends as done or quarantined.
- **Depends on:** T08.

#### T10. Leader health and unhandled rejections (LC-6, K25, CC-4) — high, S–M

- **Change:**
  - Reset a rejected lazy control initialization.
  - Report runtime health in `/ping`.
  - Yield leadership after repeated initialization failures, using a backoff shared with T22.
  - Replace the `setImmediate` admission loop with a promise.
  - Control calls honor abort.
  - Attach a handler to `demotionSettlement`, and add a process-level rejection logger.
- **Files:**
  - `mcp/src/control/router.ts`
  - `mcp/src/election/leader-endpoints.ts`
  - `mcp/src/execution/execution-plane.ts`
  - `mcp/src/execution/operation-executor.ts` (settlement only)
  - `mcp/src/index.ts`
- **Acceptance:**
  - After one injected initialization failure, the next call re-initializes.
  - A persistent failure yields leadership within 30 seconds.
  - A forced settlement rejection does not crash a Node 24 child process.
- **Depends on:** T09 (`index.ts`).

#### T11. Windows process cost (OPS-3, K11, SEC-C1) — high, M

- **Change:**
  - Cache the user SID for the life of the process.
  - Pin `whoami.exe` and `icacls.exe` to `%SystemRoot%\System32`.
  - Snapshot the workspace registry once per operation.
  - Reuse each directory's lease within an operation. Writes still lease every segment of the chain.
  - Cache boundary verdicts for reads only, with the handle-identity recheck. ACL verdicts are never cached across operations.
  - Reject unknown pairing challenge IDs in memory, before any disk or ACL work.
- **Files:**
  - `mcp/src/security/state-permissions.ts`
  - `mcp/src/fs/workspace-policy.ts`
  - `mcp/src/fs/workspace-config-store.ts`
  - `mcp/src/fs/repo-walk.ts`
  - `mcp/src/security/pairing-manager.ts`
- **Acceptance:**
  - A 2,000-file inventory launches no `whoami.exe` after the first call. It finishes in under 10 seconds on the owner's machine, which is the reference lane.
  - Renaming an intermediate directory during a workspace `replace` fails.
  - Bogus pairing exchanges launch no `whoami.exe`.
- **Depends on:** T08 (shared files).

#### T12. Windows robustness bundle (K13, OPS-9, OPS-10, K15 listener detection) — medium, M

Items that the T00 probe marks as not applicable are deferred.

- **Change:**
  - **K13:** normalize path separators inside the input schema, before hashing. Document that pre-upgrade operation IDs cannot be replayed.
  - **OPS-9:** accept cloud-file reparse tags, keep rejecting name surrogates, and give an OneDrive-specific message.
  - **OPS-10:**
    - start stdio before `election.start()` (`index.ts:1411`);
    - treat EACCES or EPERM on bind as a conflicted state with an `excludedportrange` diagnosis;
    - make the port configurable.
  - **K15:** detect preview listeners without parsing localized `netstat` text.
- **Files:**
  - `mcp/src/execution/execution-plane.ts`
  - `mcp/src/fs/workspace-policy.ts`
  - `mcp/src/election/election.ts`
  - `mcp/src/index.ts`
  - `mcp/src/portal/preview-listener.ts`
- **Acceptance:**
  - Path schema tests.
  - An EACCES bind stub leaves stdio alive.
  - OneDrive attributes are stubbed.
  - A test with non-English `netstat` output, run in the owner-machine lane.
- **Depends on:** T10 (`index.ts`, `execution-plane.ts`) and T11 (`workspace-policy.ts`).

**Checkpoint G1.** All five conditions must hold:
- 1,000 leases pass.
- 5,000 run updates pass.
- The seeded 31-day scenario passes.
- The deleted-workspace scenario passes.
- A 30-minute scripted soak shows no visible windows and no leaked helper processes in the census.

P2 may start once T07 has landed.

### P2 — Complete a C4 run end to end

G2 requires T13, T14a, T14b, T15a, T16, T18, T19a and T21a. P2b does not gate G2.

#### T15a. Native lifecycle, capacity and recipe holds (CC-2, K9, CC-C2, LC-3) — high, M–L

- **Why before T13:** without this task, the first native validations can exhaust capacity for good.
- **Change:**
  - **Attempt directories:**
    - Persist the directory identity before exposing the directory: create it under a temporary name, persist the identity, then rename it.
    - `checkRetention` quarantines only unverifiable non-terminal attempts.
    - At leader start, a sweep touches only non-terminal attempts from other generations, and only with a proof that the process is gone.
  - **Disk usage:**
    - Record usage inside the `finish()` transition to `released`, or in a separate record. A released attempt record is never mutated, and the schema gets no new `.default()`.
    - Walk only legacy attempts.
  - **Reclaim:**
    - Reclaim an attempt only when the run named by `execution.runId` is terminal and has no unfinished apply journal.
    - Keep the claim records of attempts that are kept.
    - Delete with no-follow semantics and identity checks, so that pnpm junctions are never traversed.
  - **Recipe holds:**
    - Add `IndexSchema` v2 with a migration.
    - Bind holds to the actor and the plan, in both the CLI client and the evidence contract.
    - Release holds on completion or abort.
    - Expire a hold only when its operation or plan is terminal.
    - Prune released rows.
- **Files:**
  - `mcp/src/portal/native-lifecycle.ts`
  - `mcp/src/portal/recipes/evidence-hold.ts`
  - `mcp/src/portal/recipes/evidence-contract.ts`
  - `mcp/src/portal/recipes/core-preparation.ts`
  - `cli/src/control-recipe-client.ts`
  - `mcp/src/index.ts` (sweep hook)
- **Acceptance:**
  - Restart the daemon between candidate validation and apply. The apply still passes `verifyReceipt`.
  - A junction inside an attempt that points at a sentinel directory survives reclaim.
  - Make `ensureSecure` throw once after `mkdir`. The next acquire succeeds.
  - A v1 hold index loads.
  - 50 consecutive validations run without exhausting capacity.
  - 3,000 recipe steps across leader handovers stay within the cap under D3's discard.
- **Depends on:** T07 and T10.

#### T18. Capture and visual gates, scoped by T06c (SVC-2, SVC-9, FID-9) — high, M

- **Change:**
  - Separate blocking capture issues from advisory ones.
  - Map URL actions to external links, and MOUSE_ENTER/LEAVE to hover.
  - Allow owner-recorded exclusions per reaction and per root, and return the actual blocking codes with matching instructions.
  - Export oracles with absolute bounds, keep the render bounds separately, and record the document color profile.
  - Allow per-root waivers for frames that are not screens.
- **Files:**
  - `mcp/src/portal/design-capture.ts`
  - `mcp/src/portal/interaction-evidence.ts`
  - `mcp/src/portal/coordinator.ts` (the plan-issue hunk only)
  - `shared/src/figma-capture-assets.ts`
  - `mcp/src/portal/visual-evidence.ts`
  - `mcp/src/portal/preview.ts`
- **Acceptance:**
  - A fixture with a URL reaction, MOUSE_ENTER, a 300-vertex vector and a variant set reaches `waiting-agent` with advisory issues only.
  - For a root with a drop shadow, the oracle's dimensions equal the node's.
  - Rerunning T06c shows no plan-time blockers.
- **Owner decision:** D2.
- **Depends on:** T06c.

#### T13. Profile preparation and registration by hash (SVC-1, R2B-2, R2B-4) — critical, M–L

- **Change:**
  - **Storage:** prepared profiles are stored server-side at `prepared-profiles/<preparedHash>`. The store id drops the `sha256:` prefix. Each record holds the owner, plan, candidate and expiry, with a per-owner cap and a TTL.
  - **Prepare** returns the hash plus a paged review of the prepared profile. The review shows:
    - executables and arguments;
    - the working directory;
    - timeouts;
    - lifecycle scripts;
    - outputs;
    - split core commands and their assertions;
    - environment variable names and service values;
    - external artifacts and authority hashes;
    - the recipe-use status;
    - every recipe review.
  - **Register:**
    - Accepts only a hash that the owner supplies explicitly. The CLI recomputes that hash from the reassembled review pages.
    - The action nonce binds both `planId` and `preparedHash`.
    - The re-prepare comparison stays as the time-of-check guard.
  - **Re-registration** after an authority change requires a new prepare, a new review and a new nonce, applied with compare-and-swap against the old record.
  - **Determinism:** preparation is idempotent and locale-independent.
- **Files:**
  - `mcp/src/portal/control.ts`
  - `mcp/src/portal/native-work.ts` (profile section)
  - `mcp/src/portal/store.ts` (new kind and compare-and-swap delete)
  - `cli/src/admin-commands.ts`
- **Acceptance:**
  - An idempotence test.
  - Nonce, hash, expiry and owner mismatches are rejected.
  - Environment drift between prepare and register fails with `PORTAL_PROFILE_PREPARATION_CHANGED`.
  - CLI tests pass against a fake control client.
  - A native registration succeeds on a disposable Korean-path state root.
- **Owner decisions:** D4, D8.
- **Depends on:** T01, T07 and T15a.

#### T14a. Consumption verification logic (K1, R2B-3, FID-4, FID-5) — critical, M

- **Change:**
  - Refactor `verifyConsumptionObservations` so that it returns a result per check.
  - Split batches by encoded and worst-case size, so they fit the 4 MiB preview channel.
  - Compare rendered values, scaling opacity variables.
  - Emit one check per rendered CSS property.
  - Emit gap checks only for auto-layout frames, using per-axis longhands.
  - Skip radius and box checks for ellipses and vectors.
  - Treat `normal` as zero where that is equivalent.
- **Files:**
  - `mcp/src/portal/recipes/core-consumption.ts`
  - `mcp/src/portal/recipes/consumption-values.ts`
  - `mcp/src/portal/preview-channel.ts`
- **Acceptance:**
  - Unit tests for each rule.
  - A maximal batch fits the channel.
  - An opacity-40 fixture expects 0.4.
- **Parallel with:** T13, because the files are disjoint.

#### T14b. Consumption receipt integration, remaining-work Task 6E (K1) — critical, M

- **Change:** after output and module evidence, and after `assertPreparedProfile`:
  - Parse each preview receipt's consumption report and require the batch hashes to match.
  - Verify every check and require full coverage.
  - Emit `recipeConsumption` in exactly the shape that `portalCompletionIssues` checks.
  - On failure, emit no receipt. Instead add a required failed `core-consumption` check that carries a bounded list of check IDs and error codes.
  - Never relax the gate for C4, and never trust worker flags.
- **Files:** `mcp/src/portal/native-work.ts` (validation section).
- **Acceptance:**
  - A verified receipt passes `portalCompletionIssues`.
  - A mismatch, a missing report, a duplicate check or a batch-hash mismatch produces no receipt.
  - Observation order does not change the result.
  - A fixpoint property test for multi-batch profiles passes. It is hand-rolled, or uses a newly added property-testing library.
  - A native C4 validation in Firefox passes.
- **Depends on:** T13 and T14a.

#### T16. Run protocol and evidence paging (SVC-6, OPS-4, R2B-5, LC-9, K22) — high, L

- **Change:**
  - **`portal_next`** only claims or renews the lease. It returns an envelope of at most 64 KiB with section cursors.
  - **Evidence paging:**
    - Evidence moves to read-only paged sections of at most 64 KiB each.
    - They are served through a read-only evidence authority that runs `portal_next`'s source, capture and core assertions without taking the run lock.
    - They come from a cached, verified design index and never write the run record.
    - Cursors are bound to `(planId, contextHash, inventoryHash, artifactHash)`. A stale cursor returns a typed error.
  - **Attempts and leases:**
    - Generation attempts are counted per submission, not per lease claim.
    - A lease token is valid across sessions of the same owner.
    - Reads after the work has finished consume no attempt.
  - **Candidate files:** submitted candidate files can be removed.
  - **Documentation:** update the server instructions and the generated contracts (T02).
- **Files:**
  - `mcp/src/portal/coordinator.ts`
  - `mcp/src/portal/design-evidence.ts`
  - `mcp/src/portal/presentation.ts`
  - `shared/src/portal.ts`
  - `mcp/src/tools/portal.ts`
  - `mcp/src/instructions.ts`
- **Acceptance:**
  - A default `portal_next` stays at or under 64 KiB on a fixture with 5,000 files.
  - Paging a 50k-node design takes under 60 seconds on the owner's machine, with event-loop delay p99 under 100 ms.
  - A stale cursor gives a typed error.
  - An expired and reclaimed lease leaves the attempt count unchanged.
  - A file can be removed from a candidate.
- **Owner decision:** D6.
- **Depends on:** T07 and T18 (`coordinator.ts`). Parallel with T13 and T14.

#### T19a. Repair feedback and recoverable apply (SVC-7, K14, CC-5) — medium, M

- **Change:**
  - **Repair feedback:**
    - Prepare returns the blocking requirements.
    - The preview worker sends its per-screen report on failure, and diff images are exposed.
    - `reprepare --from <hash>` reuses the reviewed commands. It still needs a new nonce per candidate.
  - **Recoverable apply:**
    - An apply preflight failure with `committed=false` returns to a recoverable `blocked` state.
    - Errors raised after `work.apply` resolves are marked committed.
    - Generation, validation and apply get separate bounded budgets.
- **Files:**
  - `mcp/src/portal/preview-worker.ts`
  - `mcp/src/portal/preview.ts`
  - `mcp/src/portal/native-work.ts` (apply preflight)
  - `mcp/src/portal/coordinator.ts` (apply catch)
  - `cli/src/admin-commands.ts`
  - `shared/src/tool-budgets.ts`
- **Acceptance:**
  - The agent sees the dimension difference, for example `1440×4213 vs 1440×4214`.
  - Re-preparing from a hash reuses the reviewed commands.
  - A `PORTAL_BASE_CHANGED` preflight can be retried after the fix.
  - A failure injected after apply is recorded as `outcome-unknown`.
- **Depends on:** T13, T14b and T16.

#### T21a. Chrome transport recovery and CLI diagnostics (SVC-5, K18) — medium, M

- **Change:**
  - On a transport failure, discard the transport and the browser, and recreate both on the next capture with backoff. Chrome's consent prompt is never bypassed.
  - Report a typed `CHROME_CONNECTION_REQUIRED`.
  - Retry transient poll errors.
  - Run the stale-daemon check for every command.
  - Add tests for `commands.ts`, `server-session.ts` and `control-client.ts`.
- **Files:**
  - `mcp/src/portal/chrome-transport.ts`
  - `cli/src/browser-session.ts`
  - `cli/src/chrome-endpoint.ts`
  - `cli/src/control-client.ts`
  - `cli/src/commands.ts`
  - `cli/src/server-session.ts`
- **Acceptance:**
  - After a killed remote socket, the next capture succeeds.
  - A transient poll error does not cancel the operation.
- **Parallel with:** lane D.

**Gate G2 (diagnostic for W02; W02 closes at G3).**

- **Prerequisites** (all needed before G2 can run):
  - Figma access to file `4IBhv1d8hEclifZQrOYxHS` (node `0:1`).
  - Chrome remote debugging with one approved connection, including the owner's click.
  - Egress consent.
  - A registered workspace and output directory on this machine.
  - An MCP coding-agent session that generates the candidate from scratch. The September 10 candidate is not on this machine.
  - npm registry access.
  - Playwright Firefox (D4).
  - Decisions D2, D4 and D8, plus D6 if the chosen client times out.
- **Pass condition:** two consecutive C4 runs complete with a Korean-path `TEMP` and state root, without restarting the daemon. Each run goes plan → prepare → register by hash → candidate validation → apply → applied validation → `completed`.
- **Also required:**
  - An 8-hour soak with a follower attached. The census must show no visible windows and no leaked helpers.
  - A daemon restart between validation and apply, followed by `resume continue`.
- **Evidence:** an English evidence document.

### P2b — Correctness work that does not gate G2

#### T17. Execution correctness (K7, CC-C1, CC-1, CC-3, CC-6) — high, M

- **Change:**
  - **Proof of no effect.** A shared plugin guard runs before the first write and returns `effectStarted: false` when a handler fails before writing. This pulls the K19 cancel-check piece forward from T24.
  - **Post-dispatch failures.** After dispatch, an effectful tool's failure is `outcome-unknown` unless that proof exists. Add late-result reconciliation, and a distinct plugin bridge timeout code.
  - **Bulk abandon** for `outcome-unknown` rows, moved here from T22.
  - **Cancel race.** A synchronous per-operation dispatch claim is set before the journal await. Only the pre-dispatch winner finalizes egress, and only then transitions the journal.
  - **Settlements.** Memoized settlements reset on rejection. `finalizeUnknown` reuses an existing finalizer and always releases the reservation.
  - **Resume.** `portal_resume(reconcile: 'none')` is rejected only while a job is live, or while the attempt is not yet released or quarantined.
  - **Approvals.** `rejectToolApproval` is idempotent for settled rows. Cancelling a pending run also cancels the broker prompt.
- **Files:**
  - `mcp/src/execution/operation-executor.ts`
  - `mcp/src/execution/egress-manifest-store.ts`
  - `mcp/src/relay/relay.ts`
  - `plugin/ui/sandbox/tool-bridge.ts`
  - `plugin/ui/relay/client.ts`
  - `plugin/src/mutation.ts`
  - `plugin/src/dispatcher.ts`
  - `mcp/src/portal/coordinator.ts` (resume hunk)
  - `mcp/src/control/operation-endpoints.ts`
- **Acceptance:**
  - A handler error raised before any write is recorded as `failed`.
  - Latch the journal's `dispatched` append and cancel meanwhile. The row ends terminal, with no finalizer conflict and no reservation left.
  - Bulk abandon clears `outcome-unknown` rows.
- **Depends on:** T10 (`operation-executor.ts`) and T19a (`coordinator.ts`).

#### T19b. Asynchronous long operations (OPS-6) — medium, M

- **Change:** long operations return an operation ID immediately, and clients poll `portal_status`. Document the client timeout settings.
- **Acceptance:** under a 60-second client timeout, a 5-minute validation completes by polling.
- **Owner decision:** D6.

#### T21b. Agent surface (SVC-4, SVC-3, R2A-4, SVC-10) — medium, M

- **Change:**
  - **SVC-4:** redact the `fileKey` value at egress according to its data class, and make the upper bound depend on consent. The result schema is unchanged, so its hash stays stable. Errors name the `egress allow` command, and consent can be renewed.
  - **SVC-3:** post-plan portal tools resolve the workspace from the plan or run.
  - **R2A-4:** tool descriptions state which steps need the CLI owner channel.
  - **SVC-10:**
    - The CLI desktop plan uses the `portal-source` selector.
    - The plugin's resume credential is persisted in client storage.
    - The one-use code is removed after it is used.
- **Files:**
  - `mcp/src/policy/result-egress-policy.ts`
  - `mcp/src/execution/mcp-invocation-adapter.ts`
  - `mcp/src/tools/portal.ts`
  - `cli/src/portal-commands.ts`
  - `plugin/ui/composables/useRelaySession.ts`
  - `plugin/ui/relay/client.ts`
- **Acceptance:**
  - The `ping` schema hash is unchanged.
  - After consent, `ping` succeeds.
  - A C3 plan's `portal_next` works over MCP.
  - A relaunched plugin reconnects without a new code.
- **Depends on:** T17 (`client.ts`) and T16 (`tools/portal.ts`).

#### T22. Leadership handover correctness (K10, LC-5, LC-10, K26) — medium–high, M

- **Change:**
  - On a demotion durability failure, fail-stop: close the listener and exit. Use the backoff shared with T10.
  - After the T15a sweep, a startup pass makes stranded validation runs resumable.
  - "Busy" includes executor work and native runs, so a step-down drains first.
  - Include the operation ID in every error, and make a retry with the same ID return the stored outcome.
  - Recover journal rows with a reader that tolerates retired tools.
- **Files:**
  - `mcp/src/execution/execution-plane.ts`
  - `mcp/src/election/node.ts`
  - `mcp/src/election/leader-endpoints.ts`
  - `mcp/src/index.ts`
  - `mcp/src/execution/operation-journal.ts`
- **Acceptance:**
  - A newer build waits until an in-flight apply settles.
  - A forced durability failure exits cleanly and a follower takes over.
  - A daemon killed mid-validation leaves a run that can be resumed.
- **Depends on:** T15a, T10, T14b and T17.

### P3 — Design-data fidelity and version gates

#### T23. Canonical capture adapter, paint data and overrides (FID-2, FID-1, FID-3) — high, M

- **Change:**
  - **One adapter** from the raw capture to the mapping projection. Alias objects become IDs, and `definitions` becomes `properties`. Core-source, the Chrome inspector and the snapshot builder all use it.
  - **Paint data:** opacity, blend mode, and per-paint, per-stop and per-effect bindings are carried through, and in-process consumers use an undeduplicated projection.
  - **Overrides:** capture `componentPropertyReferences`, `overrides` and `exposedInstances`. Instances that have non-visual overrides or different modes are not deduplicated.
- **Files:**
  - `mcp/src/mapping/design-mapping.ts`
  - `shared/src/design-context-dedupe.ts`
  - `shared/src/figma-capture-read.ts`
  - `plugin/src/handlers/get-design-context.ts`
  - `mcp/src/join/icon-map.ts`
  - `mcp/src/join/component-map.ts`
  - `cli/src/project-inspector.ts`
- **Acceptance:**
  - A raw fixture with a bound solid, a bound gradient stop and a variant instance maps to the same output as the equivalent serializer fixture.
  - Opacities survive.
  - A nested variant override is captured.

#### T24. Serializer, mapping and handler safety (FID-6, FID-7, FID-8, FID-10, K16, K19, K8) — medium, L

- **Change:**
  - **Serializer:**
    - emit sizing modes, and the constraints of absolutely positioned children;
    - emit the transform, or the bounding box with flip flags;
    - add the missing text-segment triggers, leading trim, lists and text-style fields.
  - **Assets:** plan assets for VIDEO and PATTERN fills, or mark the capture partial.
  - **Mapping:**
    - graphs get the same local catalogs as `token_map`, and invalidation is scoped to the affected rows;
    - same-name tokens with different values are flagged;
    - walk truncation is propagated.
  - **Handlers:**
    - return a typed `RESULT_TOO_LARGE` instead of dropping the socket;
    - observe only the requested targets;
    - apply the cancel guard from T17 to every handler.
- **Files:**
  - `plugin/src/serializer.ts`
  - `plugin/src/mutation.ts`
  - `plugin/src/handlers/*`
  - `mcp/src/mapping/design-mapping.ts`
  - `mcp/src/portal/design-normalization.ts`
  - `mcp/src/snapshot/build-grounding-graph.ts`
  - `mcp/src/join/token-map.ts`
  - `mcp/src/scan/scan.ts`
  - `mcp/src/icons/repo-icons.ts`
  - `mcp/src/tokens/repo-css.ts`
- **Acceptance:**
  - One fixture per case.
  - A scoped `batch` on a 20k-node page succeeds.
  - Route parity passes, using recorded dual-route fixtures (Chrome and Desktop) or a paired Desktop plugin.
- **Depends on:** T17 (guard).

#### T36. Version gates (LC-8, VER-2) — medium, S–M

- **Why here:** it moved ahead of G3, so that a stale development plugin cannot hide during fidelity work.
- **Change:**
  - Advertise a state-format version and refuse leadership over newer state.
  - Add a schema hash to the follower handshake, and the plugin build hash to `hello`.
  - Include the plugin in the build identity.
- **Files:**
  - `mcp/src/election/*`
  - `mcp/src/relay/relay.ts`
  - `shared/src/version.ts`
  - `shared/src/protocol.ts`
  - `service/scripts/build-identity.mjs`
  - `mcp/tsdown.config.ts`
- **Acceptance:**
  - An older build over newer state reports `STATE_FORMAT_NEWER`.
  - A stale plugin build gets a warning.
- **Depends on:** T17 and T22 (`relay.ts`, `leader-endpoints.ts`).

**Gate G3 (closes W02).**
- The fidelity fixture suite passes.
- Route parity passes. This uses recorded dual-route fixtures, or a paired Desktop plugin if one is available. Either prerequisite must be stated.
- The G2 C4 run is re-validated.

### P4 — C2/C3 enablement (after decision D1)

#### T25. Supported-stack matrix (D1) — S

- **Change:** publish the matrix, and add fixture skeletons plus negative fixtures for each stack. A stack that needs a native database server (for example PostgreSQL for `pg`) lists it as a prerequisite, or the matrix uses SQLite-compatible stacks, in line with the remaining-work plan.
- **Acceptance:** the matrix document exists, and each stack has a failing-by-design fixture skeleton.

#### T26. Analysis limits and inventory policy (SA-1, SA-2, SA-3, SVC-8, K24) — critical, M

- **Change:**
  - **Conventions:** record convention evidence as a sample with counts. Block only on unread effective inputs.
  - **Large files:** treat lockfiles and large data files as hashes only.
  - **Evidence:** aggregate evidence per service, specifier and kind. Emit one configuration candidate per configuration file.
  - **Encoding:** decode tolerantly of a BOM.
  - **Generated outputs:** record generated-output directories as explicit exclusions.
  - **Reporting:** name offending paths, escaped, and return plan issues instead of throwing.
  - **Credentials:** match only credential file formats and names.
- **Files:**
  - `mcp/src/profile/conventions.ts`
  - `mcp/src/portal/recipes/core-source.ts`
  - `mcp/src/portal/service-graph.ts`
  - `mcp/src/portal/service-connections.ts`
  - `mcp/src/portal/source-path-policy.ts`
  - `mcp/src/portal/source-inventory.ts`
  - `mcp/src/fs/repo-walk.ts`
- **Acceptance:**
  - A 200-file React fixture is not truncated.
  - A 900 KB lockfile plus 800 imports raises no limit issue.
  - A BOM-prefixed source matches its hash.
  - A 6,000-file `dist/` plus an NFD filename still gives a complete plan.

#### T27. Diagnostic registry and rule-level reviews (K2, SA-5) — high, M

- **Change:**
  - Keep one diagnostic-code registry, checked exhaustively.
  - Owners review by rule (code plus path pattern), and reviews survive a re-clone.
  - Create receivers only from proven HTTP factories.
  - Parse `.vue` and `.svelte` script blocks.
- **Files:**
  - `mcp/src/portal/service-selection.ts`
  - `mcp/src/portal/service-connections.ts`
  - `shared/src/portal.ts` (sequenced after T16 and T20)
- **Acceptance:**
  - A `:id` route can be reviewed.
  - Ordinary snippets such as `new Map().get` and `app.use(router)` raise no issues.

#### T28. Module resolution for default templates (SA-4) — high, M

- **Change:** support:
  - project references and `tsconfig.app.json`;
  - package `extends` and ancestor manifests;
  - export conditions treated as alternatives, with a reviewable `BUILD_OUTPUT_MISSING`;
  - `#imports`.
- **Files:** `mcp/src/portal/module-resolution.ts`.
- **Acceptance:** the create-vite, create-vue, Nx and Turborepo templates resolve with `complete: true`.

#### T29. Framework adapters, layers and contracts (SA-6, SA-7, SA-9, SA-10) — high, L

- **Change:**
  - Add framework adapters for the matrix. Emit `UNSUPPORTED_FRAMEWORK:<pkg>` when a framework is imported and no adapter handles it.
  - Use a dependency-category table that covers subpaths and framework wrappers. Server files of full-stack frameworks count as backend, and schema files count as data.
  - Match contracts across sources at plan level, with routing bindings built from reviews.
  - Normalize trailing slashes.
  - Document or remove `portal.routes.json`.
  - Separate relevant layers from provided layers. C3 always emits construct obligations.
- **Files:**
  - `mcp/src/portal/service-connections.ts`
  - `mcp/src/portal/service-graph.ts`
  - `mcp/src/portal/service-selection.ts`
  - `mcp/src/portal/recipes/core-derivation.ts`
  - `ir/src/portal-run.ts`
- **Acceptance:**
  - Each matrix snippet yields an endpoint or an explicit diagnostic.
  - C2 fixtures raise `MISSING_REQUIRED_CHECK` for persistence, API and authorization where those apply.
  - A two-reference fixture yields one HTTP contract.

#### T30. Obligation keys and source selection (SA-8) — high (latent), S–M

- **Change:** key obligations by mapping row ID, and let the owner select the source for each mapping.
- **Files:**
  - `mcp/src/portal/recipes/core-derivation.ts`
  - `mcp/src/join/component-map.ts`
- **Acceptance:** duplicate-name and two-reference fixtures become ready after a selection.

#### T31. Package managers for native profiles (K15 package-manager part) — medium, M

- **Change:** support pnpm and yarn installs with lifecycle scripts disabled by default, with provisioning evidence.
- **Files:**
  - `mcp/src/portal/native-artifacts.ts`
  - `mcp/src/portal/native-runner.ts`
- **Acceptance:** a pnpm workspace fixture validates natively.

**Gate G4.** Each matrix stack has an integrated acceptance fixture. For each, all of these must hold:
- The plan reaches `waiting-agent` with no owner reviews for ordinary code.
- A candidate validates natively.
- The real HTTP, persistence and authorization checks run and pass.
- Its negative fixtures produce explicit unsupported diagnostics.

Native service prerequisites are listed for each stack.

### P5 — Security hardening

#### T20. Approval honesty (SEC-1) — medium, S–M

- **Change:**
  - Give every effect type an explicit label, checked exhaustively; an unknown effect disables approval.
  - Show resolved values in prompts: profile ID, executable hashes, output paths, URL host and Chrome target.
  - Keep the destructive and broad qualifiers.
  - Reject bidi and format characters in portal paths.
- **Files:**
  - `plugin/ui/components/TabApprovals.vue`
  - `mcp/src/policy/approval-prompt.ts`
  - `shared/src/portal.ts` (sequenced after T16)
- **Acceptance:**
  - A component test covers every effect type.
  - A U+202E path is rejected.

#### T32. Pre-authentication limits (SEC-2, SEC-3, SEC-C2) — medium, S–M

- **Change:**
  - **SEC-2:** count pairing attempts per challenge, throttle per connection, and mint bootstrap tickets through an internal path.
  - **SEC-3:** cap unauthenticated frames at 16 KiB before decoding, set decoder length and depth limits, and cap the number of unauthenticated sockets.
  - **SEC-C2:** require a custom header on `/follower/challenge`.
- **Files:**
  - `mcp/src/security/pairing-manager.ts`
  - `mcp/src/relay/relay.ts`
  - `shared/src/codec.ts`
  - `mcp/src/election/leader-endpoints.ts`
- **Acceptance:**
  - After 100 bogus exchanges, a fresh pairing still succeeds.
  - A 1 MiB frame sent before `hello` never reaches the decoder.

#### T33. Untrusted-data guidance (SEC-4) — medium, S

- **Change:** the prompt and the server instructions state that Figma text, repository content and command output are data. Tool results wrap them in an untrusted envelope.
- **Files:**
  - `mcp/src/prompts/figma-to-code.ts`
  - `mcp/src/instructions.ts`
  - portal result presenters
- **Acceptance:**
  - A prompt snapshot test.
  - An injected-annotation fixture.

#### T34. Plugin messaging and CDP proxy (SEC-5, SEC-6) — low, S–M

- **Change:**
  - Accept `pluginMessage` only from `window.parent`.
  - The CDP proxy uses a method allowlist, is bound to the Figma target, and is released after an idle period.
- **Files:**
  - `plugin/ui/sandbox/messaging.ts`
  - `mcp/src/portal/chrome-transport.ts`
- **Acceptance:**
  - An event from a foreign source is ignored.
  - `Network.getAllCookies` is rejected.

### P6 — Long-term state lifecycle

#### T35. Incremental log verification (LC-4) — high, M

- **Change:** the receipt and egress stores keep a verified in-memory index and verify only the rows appended since the last check.
- **Files:**
  - `mcp/src/execution/operation-evidence-receipt-store.ts`
  - `mcp/src/execution/egress-manifest-store.ts`
- **Acceptance:** with 100,000 receipts, durability overhead stays under 50 ms at p95 on the owner's machine.

#### T37. Keys and supported reset (LC-7, LC-11) — medium, M

- **Change:**
  - Add key IDs and a keyring.
  - A missing key with existing state fails with `STATE_KEY_MISSING`.
  - Add `state reset` and `rotate-key` commands.
  - Add an owner-invoked ACL repair.
  - Use a disposable state root for all tests.
- **Files:**
  - `mcp/src/security/principal-derivation.ts`
  - `mcp/src/security/state-permissions.ts`
  - `mcp/src/portal/store.ts`
  - `mcp/src/security/document-binding-store.ts`
  - `cli/src/admin-commands.ts`
- **Acceptance:**
  - Deleting the key makes startup refuse, with a remediation message.
  - A foreign ACE is repaired rather than fatal.
- **Owner decision:** D7.

#### T38. Pairing and fence pruning (K12) — medium, S

- **Change:** prune expired pairing rows, and compact the generation-fence log.
- **Files:**
  - `mcp/src/security/pairing-manager.ts`
  - `mcp/src/execution/operation-journal.ts`
- **Acceptance:** 10,000 reconnects keep the pairing state bounded.

### P7 — Release integrity and documentation

#### T05b. Upstream-dependent provenance (K5, remainder) — M

- **Change:**
  - Run `verify-upstream-lock --with-upstreams` in CI.
  - Regenerate the SBOM and notices with `SOURCE_DATE_EPOCH` set to the commit time, and add a drift check.
  - Backfill the change manifests.
- **Acceptance:** both lock modes pass, and regeneration shows no drift.

#### T39. Reproducible, bound artifacts (VER-4) — high, M

- **Change:**
  - Set `SOURCE_DATE_EPOCH` from the commit.
  - The manifest binds the commit, a dirty flag, the build identity and the source hash.
  - Ship a shrinkwrap, and run the smoke test offline.
  - `verify-artifacts` requires the runtime entries.
- **Acceptance:**
  - Two clean builds produce identical checksums.
  - Deleting `portal-validation.mjs` fails verification.

#### T40. Packed smoke and remaining CLI tests (VER-3) — high, M

- **Change:**
  - The packed smoke exercises `status` through a real daemon, plus the plugin bootstrap from the packed assets.
  - Add tests for the CLI modules that T21a does not cover.
- **Acceptance:**
  - The packed smoke fails if `index.html` lacks `<head>`, or if the build identity does not match.
  - Coverage exists for `plugin-bootstrap.ts` and `artifacts.ts`.

#### T41. Embedded programs, production dead-code check, and the CLI recipe engine (VER-7, VER-6, K17 engine) — medium, L

- **Change:**
  - Move the embedded PowerShell, C# and preload programs into real files that are linted, type-checked and pinned by hash.
  - Add `knip --production`.
  - Wire the unreachable CLI recipe engine into a real command under remaining-work Task 6F, or delete it.
- **Files:**
  - `mcp/src/fs/atomic-file.ts` (embedded scripts)
  - `mcp/src/fs/windows-boundary-probe-worker.ts`
  - `mcp/src/portal/windows-job.ts`
  - `mcp/src/portal/native-module-fence-source.ts`
  - `mcp/src/portal/preview-consumption.ts`
  - `cli/src/recipe-*.ts`
  - `service/knip.json`
  - `service/package.json`
- **Acceptance:**
  - A seeded error in an embedded program fails lint or typecheck.
  - `knip --production` is clean.
  - Each protocol change bumps its version (section 2).

#### T42. Metadata and documentation honesty (K17 metadata, VER-9, K20) — low–medium, S

- **Change:**
  - Mark pending helpers as `pending`.
  - Fix the operator documentation: `tools list`, Firefox for packed installs, and `--ignore-scripts` in the `.ps1` helpers.
  - Supersede stale status documents with English successor documents rather than editing the historical Korean ones.
- **Acceptance:**
  - The capability metadata tests reject `alias` for pending helpers.
  - A docs test pins the operator commands.

**Final gate.**
- Run the two post-implementation code-review rounds and the exact-source verification required by the remaining-work plan (W10).
- The Windows CI is green on the delivery branch under D9.
- Delivery follows the remaining-work plan's rules.

## 5. Lanes, sizes and mapping

| Lane | Tasks, in order |
| --- | --- |
| A. Storage and Windows filesystem | T01 → T07 → T11 → T12 (after T10) |
| B. Baseline and tooling | T00 → T02 → T03 → T04 → T06a → T06b → T05a; later T05b, T39–T42 |
| C. Lifecycle and index hooks | T08 → T09 → T10 → T15a → T22 → T36 |
| D. Portal core | T06c → T18 → T13 (with T14a) → T14b → T16 → T19a → T19b |
| E. Execution plane, relay and CLI | T21a; T17 → T21b; T32 |
| F. Plugin and shared fidelity | T23 → T24; T20; T33; T34 |
| G. Service analysis (after D1) | T25 → T26 → T27 → T28 → T29 → T30 → T31 |
| H. Long-term state | T35, T37, T38 |

**Revised sizes:**
- L: T07, T16, T24, T29, T41.
- M: T01.

**Mapping to the remaining-work plan:**

| This plan | Remaining-work plan |
| --- | --- |
| G2 and G3 | W02 (live C4) |
| T14b | Task 6E |
| T41 (recipe engine) | Task 6F |
| T23 and T24 | W07 |
| T25–T31 | Prerequisites of W03–W05 |
| T05b and T39–T42 | Part of W10 |
| T04 and T31 | Part of W09 |

**Still open after T42:**
- W08: portable capture packages.
- The 27 planned upstream recipes (W06, Task 6).
- Representative C2/C3 portals beyond the G4 fixtures (Task 7).
- The final review rounds, delivery and push (Task 8).

## Appendix A: finding-to-task index

| Task | Findings |
| --- | --- |
| T00 | environment census; applicability of OPS-9, OPS-10, OPS-C1, K15 |
| T01 | OPS-1, OPS-5 (lease), OPS-8 (lease), OPS-C1 |
| T02 | K3, K4, VER-5 |
| T03 | K21, VER-8 |
| T04 | K6, VER-1, VER-6/VER-7 (checkJs) |
| T05a | K5 (offline), VER-C1 |
| T05b | K5 (upstream) |
| T06a | reproductions of K1, SVC-1, OPS-2, LC-1, LC-2, SA-1, SA-2 |
| T06b | test harnesses |
| T06c | plan-time C4 probe (SVC-2 scope) |
| T07 | OPS-2, R2B-1, R2A-1, R2A-2, R2A-3, CC-7 |
| T08 | LC-2 |
| T09 | LC-1 |
| T10 | LC-6, K25, CC-4 |
| T11 | OPS-3, K11, SEC-C1 |
| T12 | K13, OPS-9, OPS-10, K15 (listener) |
| T13 | SVC-1, R2B-2, R2B-4 |
| T14a, T14b | K1, R2B-3, FID-4, FID-5 |
| T15a | CC-2, K9, CC-C2, LC-3 |
| T16 | SVC-6, OPS-4, R2B-5, LC-9, K22 |
| T17 | K7, CC-C1, CC-1, CC-3, CC-6, K19 (guard) |
| T18 | SVC-2, SVC-9, FID-9 |
| T19a | SVC-7, K14, CC-5 |
| T19b | OPS-6 |
| T20 | SEC-1 |
| T21a | SVC-5, K18 |
| T21b | SVC-4, SVC-3, R2A-4, SVC-10 |
| T22 | K10, LC-5, LC-10, K26 |
| T23 | FID-2, FID-1, FID-3 |
| T24 | FID-6, FID-7, FID-8, FID-10, K16, K19, K8 |
| T25 | D1 |
| T26 | SA-1, SA-2, SA-3, SVC-8, K24 |
| T27 | K2, SA-5 |
| T28 | SA-4 |
| T29 | SA-6, SA-7, SA-9, SA-10 |
| T30 | SA-8 |
| T31 | K15 (package managers) |
| T32 | SEC-2, SEC-3, SEC-C2 |
| T33 | SEC-4 |
| T34 | SEC-5, SEC-6 |
| T35 | LC-4 |
| T36 | LC-8, VER-2 |
| T37 | LC-7, LC-11 |
| T38 | K12 |
| T39 | VER-4 |
| T40 | VER-3 |
| T41 | VER-7, VER-6 (production), K17 (engine) |
| T42 | K17 (metadata), VER-9, K20 |

K23 and OPS-C2 are handled in T15a, which keeps full re-verification before each command that executes an external artifact (see Appendix B). The shared inventory reuse applies only to the prepare and assert calls made before launch.

## Appendix B: deviations from the remediation plan

| Item | Remediation plan | This plan | Reason |
| --- | --- | --- | --- |
| Provenance | One-off WS-0 refresh | Per-task offline slice (T05a rule); upstream parts in T05b (P7) | The lock pins most source and test hashes, so it goes stale on every task. |
| Phases | Phase barriers | G0 is a barrier; G1 is a checkpoint; G2 prerequisites listed explicitly | Avoids putting environment-dependent work on the C4 critical path. |
| SEC-3 | Phase 1 quick item | P5 (T32) | The trigger needs browser local-network access; single-user machine. Revisit if the plugin UI runs in a browser. |
| LC-8, VER-2 | WS-3 | T36 in P3, before G3 | Stale development plugins must be detected before fidelity work. |
| K12, LC-4, LC-7, LC-11 | WS-2 (Phase 1) | P6 | Not on the C4 critical path; T07 covers the data-integrity parts. |
| VER-6, VER-7 | WS-0 | `checkJs` in T04; `knip --production` and embedded programs in T41 | Type checks are needed per task; the rest is large. |
| K23, OPS-C2 | "Hash once per validation" | Re-verify before each command that executes an external artifact | A build step could tamper with and restore the browser between checks (security). |
| T11 lease scope | One lease per root | Reuse each directory's lease; writes lease every segment | Junction-swap protection on Windows. |
| Apply journal | Append-only log or pruning | `discard` plus `backup` retention modes; no new log format | Smaller change; legacy rows stay recoverable. |
| D4 | Pin a Firefox ESR | Keep Playwright pinned; fixed browser path | The daemon launches Playwright's bundled Firefox. |
| SEC-1 | Phase 1 quick item | P5 (T20) | C4 over Chrome uses the CLI approval channel; the plugin UI is not on the G2 path. |

## Appendix C: plan review dispositions (version 1 → version 2)

The three reviewers raised 34 findings. All were accepted. The main session verified these points in code:
- the lock's managed roots and hash pinning;
- the `replace()` callers;
- `verifyReceipt`'s exact-hash and `released` requirements;
- the null recipe-hold index;
- the v1 literal in the lease artifact schema;
- the Playwright pin.

| Reviewer | Findings | How applied |
| --- | --- | --- |
| Sequencing (PS-1–PS-12) | CI needs pushes; stale lock; native runs before capacity fixes; plan-time C4 blockers; over-serialized critical path; file-list errors; G1 barrier; environment bootstrap; decision timing; `it.fails`; gate definitions; protocol bump timing | D9; T05a/T05b split and per-task provenance; T15a moved before T13 with disposable roots; T06c probe and T18 early; explicit G2 prerequisites and P2b; corrected files and sequenced list; G1 checkpoint; T00; decision table with due dates; normal-test reproductions; gate definitions; protocol rule in section 2 and T36 before G3 |
| Technical design (TD-1–TD-12) | Reclaim vs `verifyReceipt`; null reads; lease authority coupling; sidecars and backups; recovery dead ends; hash-once security; unavailable rows and snapshot cleanup; hold index migration; approval integrity and fixpoint; lease scope; evidence authority; hash stability | T15a rules and tests; T07 read rollback, reconcile before sweep, compaction reload; T01 single bump with v1/v2 parsing and the fence; T07 `backup` mode; T17 `effectStarted` guard and bulk abandon, T22 startup pass; Appendix B K23 row; T08 v3 schema and T09 outcomes; T15a `IndexSchema` v2; T13 owner-supplied hash and T14b fixpoint test; T11 wording; T16 evidence authority and cursors; T21b redaction and T12 schema normalization |
| Coverage and verifiability (CV-1–CV-10 plus the coverage table) | G2 prerequisites; per-task provenance; CI evidence; bootstrap and "full suite"; apply-path tests before K1; document precedence; lane overlaps; environment-bound criteria; D4 restatement; sizes; partial coverage (K22, K17, SA-7, SA-9, SVC-7, SEC-2, the dropped invariants, the generator drift check, OPS-10 `index.ts`, LC-3 CLI, file lists, `checkJs` timing, SEC-3) | G2 prerequisites and Korean-path requirement; section 2 per-task gate; D9; T00 and the G0 definition; T06b per-file seam and apply tests against `NativeWork.apply`; section 0 and section 5 mapping; extended sequenced files and lanes; owner-machine lane, stubs and reference lane stated; D4; resized tasks; each partial item added to its task |
