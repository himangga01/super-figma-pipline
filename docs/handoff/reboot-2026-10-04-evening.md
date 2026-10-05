# Reboot handoff: October 4 evening

To continue on another PC, use the [October 5 handoff](another-pc-2026-10-05.md) for setup and operations. This record stays the evidence history.

Prepared at approximately 21:35 KST on October 4, 2026, at the owner's request. This supersedes the operational state in the [earlier handoff](reboot-2026-10-04.md), preserving its historical evidence. No reboot, new commit or push was performed.

Later continuation, approximately 21:44–23:25 KST, without a reboot: also read the [control diagnostics and review repairs](../testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md) and the current section of the [service analysis](../service-analysis.md). The retained daemon described below was no longer running when work resumed.

- The R3–R5 failures are explained: a monitoring poll's authorization probe timed out, and the CLI then cancelled the dispatched plan. That behavior was repaired.
- R6 succeeded: plan `sfp_portal1_709fa34d66dd3de4b68be30c3f5f5f66`, with complete workflow coverage.
- Both service copies now match at `sha256:ac67794d...`.
- Earlier whole check `41c4cda8...` was stopped by Claude Code because the system was critically low on memory; it is interrupted, not passed.
- Fresh whole check `a59a6e15...` then passed all 16 gates at source `ac67794d...`: 4,769 passed, 0 failed, 20 existing skips, all 37 required Chrome cases passed, and the artifact-content case passed.
- After midnight, [independent native collector increments](../testing/2026-10-04-ecommerce-parity/native-effects/README.md) moved both copies to `sha256:62023ddd...`. They now compare 87 fields with zero unexplained differences. That source has passed focused tests and eight provenance rounds. Its whole check `1c7268c7...` passed the static and build gates, then Claude Code stopped it for low memory at the test gate, so it is interrupted, not passed.
- The owner then installed Figma Desktop (free Starter account). Its official local MCP port did not open, and the first development-plugin pairing did not complete. See the [service analysis](../service-analysis.md) and the [remaining work](#remaining-work-at-0947-kst-on-october-5) below.
- No daemon is running. The restart sequence below still applies, after a passing whole check of the current source.

## Read first

Read [AGENTS.md](../../AGENTS.md), the shared analysis policy, [service analysis](../service-analysis.md), [complete collection](../testing/2026-10-04-ecommerce-parity/README.md), [native behavior repairs](../testing/2026-10-04-ecommerce-parity/native-behavior/README.md), and [the latest control repair](../testing/2026-10-04-ecommerce-parity/control-poll/README.md). Keep all new Markdown in English. Use only service-owned Chrome/Playwright/CDP, CLI, MCP integration and validators for acceptance. No Codex browser/CUA/Figma connector, Superpowers or Docker. Do not automate browser approvals or reinstall Orca/hooks.

## Saved source and verification

| Item | Recorded state |
| --- | --- |
| Repository | `C:/2026_project/super-figma-pipline` |
| Branch / published HEAD | `remediation/2026-09-27` / `5b9343efc82ef47ba56f412acbd4eee5a328d335` |
| Main/native service source | `sha256:fc47c9f0f64114d700e4da3d026c2070925842f8d5ea433ddb929824c5f43263` |
| Owner Git index SHA-256 | `5a79352238185329aee8c904a5158b713ba9645d7af966917d09c2930652500a`, unchanged |
| Native working copy | `.worktrees/baseline/service` |
| Latest completed whole check | `1dac9a33-07f8-44fd-83b0-65026f8ac713`, source `e2755bc7...` |
| Completed check result | All 16 gates; 4,748 passed, zero failed, 20 existing skips; all 37 mandatory Chrome cases passed; separate artifact-content case passed |
| Newer control repair | Eleven real-HTTP tests, CLI typecheck/build, scoped lint/format and provenance passed |
| Interrupted whole check | `b4a7a8fa-cec6-4a0a-bc3a-b3d0c491298a`, source `fc47c9f0...` |

The latest whole check completed static/build gates and reached tests. The owner then requested reboot preparation. Its exact Node controller (PID 19576, started at 21:28 KST) and owned descendants were stopped after checking process identity. The stored pointer remains `pending`; **this attempt is interrupted, not passed**. Do not reinterpret its missing terminal report as success or alter its UUID/deadlines. [The checkpoint](2026-10-04-evening/checkpoint.json) and copied [pointer](2026-10-04-evening/interrupted-source-pointer.json)/[report](2026-10-04-evening/interrupted-source-report.json) preserve this distinction. Run a fresh whole check after restart.

The latest alternate review index is `.worktrees/baseline/service/.cache/control-poll-20261004.index`. Manifest verification covers 53 semantic changes and four authority paths, with 178 retained forks, three upstreams and 238 vendor rows. Preserve this index and earlier review records. The real owner index was not staged or changed.

## Preserved outputs and backups

CDD Chrome/Scripter R8 completed its C4 candidate, guarded application, applied runtime/visual/interaction checks and final live source freshness. Run: `sfp_portal1_6e77baedbfa0c9c948a44811d8d80d26`. Candidate/applied hash: `sha256:e424d2eeaea2faec441255fe558b9b8ca77f0dc695503822d3f8cdf721152848`.

The applied output is `.worktrees/_cache/cdd-service-outputs/cdd-chrome-frontend-r8`. All **44 files, 19,284,760 bytes**, were rehashed against the candidate manifest during this handoff. The [ZIP backup](2026-10-04-evening/cdd-chrome-frontend-r8.zip) has 44 independently rehashed entries; [its receipt](2026-10-04-evening/cdd-r8-backup.json) and [file manifest](2026-10-04-evening/cdd-r8-files.json) record the hashes. ZIP SHA-256: `7826319bb8780bb67e5347b95fec0702a73c6ac9544c8f242d1a19563686f74e`. Preserve R7 and its earlier backup too. Do not use CDD output as reference frontend code for eCommerce.

[The source-change backup receipt](2026-10-04-evening/source-changes-backup.json) identifies the tracked and untracked work saved in a separate ZIP. This local backup is not a Git commit or push. Private runtime state, credentials, raw design archives and caches are excluded from that source archive.

## Current product evidence

- eCommerce preparation R2 captured 3,198 nodes, 11 roots and all 283 assets (101,154,854 bytes), with complete ordered reobservation. It has no generated frontend.
- Independently collected native inputs compare at 124,734 eCommerce positions and 8,778 CDD positions. Unexplained differences in the declared fields are zero; 408/73 representation differences remain recorded. All 66 eCommerce click-navigation actions now match. Full native capture/admission remains false.
- Implemented repairs cover identity/style/geometry/font/vector interpretation, supported layout/mask/bounds, instance placement and single-action prototype fragments. Effects, additional node/catalog/variable semantics, independent SVG/root-PNG exports and portal admission remain open.
- Candidate capacity was increased from 64 MiB to 96 MiB to preserve the 89,090,574-byte original image set, with unchanged per-file/submission and 128 MiB working-copy limits. It has bounded tests but no live eCommerce candidate/application yet.
- The latest CLI repair retries only one bodyless control GET after `ECONNRESET`, preserving the original timeout, credentials and cumulative byte budget. Mutations and structured HTTP errors are never replayed.

## Unresolved live preparation failures

R3 attempted five confirmed frontend demo workflows and 89 explicit scope mappings. It encountered a polling connection reset; the client cancelled after dispatch and public state became `outcome-unknown` / `OPERATION_CANCELLED_AFTER_DISPATCH`. The bounded read-retry repair was then implemented and tested.

R4 used a separate context/target after that repair. It encountered **`CONTROL_REQUEST_FAILED (500)`**, again followed by cancellation after dispatch. Its public state is also `outcome-unknown`. The underlying server error is **not diagnosed or fixed**. No R3/R4 plan or target frontend was produced; the 89 unresolved R2 workflow issues are not accepted as resolved. Do not automatically replay either issued operation. Preserve partial capture artifacts and both public operation records.

Next diagnosis: instrument the service's exact failing control route with bounded, non-secret diagnostics and reproduce the HTTP 500. The generic fallback is in `packages/mcp/src/election/leader-endpoints.ts`; possible causes before the control handler have not been established. Do not waive authentication/integrity failures or broaden the GET retry to blanket HTTP 500 retries. Helpers must retain operation IDs and progress, as the R4 helper now does.

Private on-disk continuation locations (preserve; do not publish their contents):

| Purpose | Location relative to repository |
| --- | --- |
| Service owner state | `.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline` |
| Separate verification state | `.worktrees/_cache/verification-20261004-r8-appdata` |
| CDD R8 context | `.worktrees/_cache/cdd-codegen-context-20261004-r8` |
| Complete eCommerce R2 context | `.worktrees/_cache/ecommerce-service-context-20261004-prep-r2` |
| Failed R3 / R4 contexts | `.worktrees/_cache/ecommerce-service-context-20261004-prep-r3` and `...-r4` |
| Fresh independent native input | `.worktrees/_cache/live-ecommerce-native-refresh-20261004/4IBhv1d8hEclifZQrOYxHS-1791110752199-869e9afe/document.fig` |
| Latest comparison outputs | `.worktrees/_cache/ecommerce-parity-behavior-20261004` and `.worktrees/_cache/cdd-parity-behavior-20261004` |

## Restart sequence

At 21:33 KST the retained daemon was healthy on port 3055, build `b667c982...`, Chrome `connected`, zero paired Desktop plugins. It predates newer source changes. The owned verification tree was stopped; the source daemon and user Chrome were preserved. Do not assume their connection survives reboot.

From `.worktrees/baseline/service`, establish the same service state explicitly:

```powershell
$sfpUserLocalAppData = $env:LOCALAPPDATA
$env:SFP_CHROME_USER_DATA_DIR = Join-Path $sfpUserLocalAppData 'Google/Chrome/User Data'
$env:LOCALAPPDATA = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-native-appdata'
$env:PATH = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/bin;' + $env:PATH
node packages/cli/dist/index.mjs status
node packages/cli/dist/index.mjs egress status
```

Start `node packages/mcp/dist/daemon-entry.mjs` in a dedicated service process only if the daemon is absent. Verify the newly started build rather than assuming the old identity. Reopen either requested file using the service's `chrome-open --url` path and let the owner manually approve any new Chrome prompt. Recheck `status`; do not restart a healthy approved daemon repeatedly.

The recorded external-model egress scope allows public, project-code, design-text and design-image classes and expires **October 5 at 00:24:12 KST**. Recheck after restart; if expired, renew only that previously authorized scope through `node packages/cli/dist/index.mjs egress allow`. Do not reset expired portal run deadlines or overwrite applied outputs.

Run fresh complete verification in a separate terminal with `LOCALAPPDATA` set to the verification state above, the cache `bin` on PATH, then `node scripts/run-source-checks.mjs`. After a successful unchanged-source result, use `.cache/save-cdd-full-checks.mjs` and `.cache/run-cdd-artifact-scope.mjs` with a new documentation destination. These same-owner native processes/directories are not an OS sandbox.

The service's local official MCP probe at 21:12 KST returned `fetch failed`; the earlier remote probe required authentication. The owner has been asked to enable Figma Desktop's official Dev Mode MCP server. Test using `figma-mcp probe --endpoint http://127.0.0.1:3845/mcp` through the service CLI; do not use the Codex connector. Desktop development-plugin pairing/live collection also remains unexecuted.

## Required completion order

1. Diagnose the new control-server failure and rerun a valid public preparation flow; finish current-source checks.
2. Finish independent native acquisition and compare it against separate Chrome/Scripter evidence; finish authenticated official MCP and Desktop acquisition.
3. Complete relevant C1–C3 full-portal cases and independent review gates. Preserve the completed CDD Chrome/Scripter C4 result and revalidate affected behavior when changes require it.
4. Run the final eCommerce test with **two separate new frontend outputs, no reference frontend code**, through official MCP and Chrome. Capture preparation and field parity do not establish final acceptance.
5. Refresh canonical reports before claiming completion. Do not commit or push unless requested.

## Remaining work at 09:47 KST on October 5

The state was rechecked at 09:47 KST on October 5, without a reboot:

- Both service copies still match at `sha256:62023ddd...`. The owner index is unchanged (`5a793522...`). 92 changed or untracked paths remain uncommitted.
- The whole-check pointer for `1c7268c7...` is still `pending`, meaning interrupted, not passed.
- No daemon or Node process is running. Free memory is 3.9 GB of 15.6 GB, below the roughly 5.5 GB the passing whole check had.
- Figma Desktop is running, but port 3845 has no listener.
- Figma's [rate limits and access page](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), read that morning, gives the Starter plan 20 tool calls per month and recommends a Professional or higher plan for more. The fetched text did not state the desktop server's seat requirement, so that part remains an inference.
- The external-model egress scope expired at 00:24:12 KST on October 5.

Step status: step 1's control repair is done, but its current-source whole check is not. Step 2 is partly done: native comparison covers 87 fields, while official MCP and Desktop acquisition have no capture. Steps 3–5 have not started.

### Needs the owner

| Item | Reason | Owner action |
| --- | --- | --- |
| Whole check at `62023ddd...` | Required before live work on this source; Claude Code's memory reaper stopped two attempts at the test gate | Free memory, run it in a separate terminal, or restart Claude Code with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`; then request the run |
| Desktop plugin pairing | The pairing code expires after 5 minutes | Be present, start the bundled plugin and paste a fresh `pair` code within 5 minutes |
| Official MCP path | Starter quota of 20 calls per month; the local server is not listening | Choose one: upgrade the plan or seat; authorize the remote server with OAuth and accept the quota; or record the official path as plan-blocked, which leaves the final acceptance incomplete |
| Chrome connection | Each new live session needs Chrome's remote-debugging prompt approved | Approve the prompt when live work resumes |
| C2/C3 environments | C2 needs a real legacy target and C3 needs reference services, each with test environments and credentials | Name the available targets, or decide which cases are relevant |

Before generation, renew external-model egress for the previously authorized scope only.

### Agent work that needs no owner input

1. **Native collector.** Add the 36 remaining fields: grid auto-layout, style identifiers, variables, annotations and exports, component semantics, render bounds, vectors and arcs. Independent SVG and root-PNG exports and native capture admission also remain; `fullCaptureAccepted` is false.
2. **Open review findings.** F4 (shared 256-call re-observation cap), F5 (a malformed native style row aborts node comparison), F9 (proof re-hashing), F10 (duplicated fingerprint formula), and the Windows authorization probe load.
3. **Official MCP source boundary.** The portal source schema admits only Chrome and Desktop sources, so an official MCP read cannot yet produce its own frontend. Design and test this before the final test; a live test needs MCP access.
4. **Pairing usability.** Propose a repair for the 5-minute code inside the 900 s `connect` wait. A pairing-lifetime change touches an authentication boundary, so it needs the owner's review before it is applied.

### Then, in order

1. Desktop live collection after pairing, compared against separate Chrome evidence.
2. Relevant C1–C3 full-portal cases and independent review gates, including the open items of the [M01–M17 plan](../plans/2026-09-30-code-remediation-plan.md).
3. The final eCommerce test: two separate new frontends from official MCP and Chrome, without reference frontend code. Each must complete its candidate, guarded application, applied runtime checks and final source freshness.
4. Refresh reports and the final release review: `verify:release`, remote CI and two final critical review rounds have not been run. Commit or push only on request.
