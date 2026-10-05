# Control failure diagnostics and verified review repairs

**Outcome at 23:14 KST.** The instrumented R5 run established the cause of the R3–R5 preparation failures. A read-only approvals poll failed control authorization when one Windows state probe exceeded the serialized probe worker's 5 s request timeout (`STATE_ACL_COMMAND_FAILED <- WINDOWS_BOUNDARY_TIMEOUT`). The CLI then cancelled the still-running `portal_plan`. After the [typed busy and bounded monitoring repair](#cause-established-by-r5-and-repair), fresh R6 met the same probe timeout once, waited it out without cancelling, and produced plan `sfp_portal1_709fa34d66dd3de4b68be30c3f5f5f66` with:

- a complete, live-verified capture;
- complete workflow coverage: 92/92 scopes, 89 explicit decisions, no issues;
- all five requirements confirmed.

Its design fingerprints match R2. This is preparation only; no frontend was generated or applied.

Date: October 4, 2026, approximately 21:44–23:20 KST (Asia/Seoul). Published baseline `5b9343efc82ef47ba56f412acbd4eee5a328d335` on `remediation/2026-09-27`, with continuing uncommitted changes. The starting source matched the [evening handoff](../../../handoff/reboot-2026-10-04-evening.md) in both copies at `sha256:fc47c9f0...`; the owner Git index SHA-256 remained `5a793522...` throughout. The PC had not rebooted since September 30, but the retained daemon was no longer running.

## R4 HTTP 500: what the code establishes

The saved R3/R4 records were re-read against current code. R4 was dispatched at 21:26:01 KST and failed at 21:27:06, 65 seconds later, before the interrupted whole check started at 21:28. R3 failed 102 seconds after dispatch. R2's successful preparation of the same design took about 158 seconds. In both failures the server recorded `outcome-unknown` after the client had already written its failure: 24 ms later for R4, 2.5 s later for R3. This fits the client's poll-failure path, where the cancellation request does not complete and the client then aborts the main request.

`CONTROL_REQUEST_FAILED (500)` means the response had no `code` the CLI accepts (`^[A-Z][A-Z0-9_]{0,127}$`). Two server paths produce exactly that client message, and neither recorded a cause:

1. **Leader catch-all.** Any exception outside the typed control router becomes `500 {"error":"internal"}`; if headers were already sent, the socket is destroyed instead (ECONNRESET). Control authorization runs outside the router's error handling. On Windows it performs two complete state-permission verifications per request: `whoami.exe`, plus ACL and boundary probes through one serialized PowerShell worker per process (64 pending requests, 5 s per request).
2. **Router projection with a non-conforming code.** The router publishes `String(error.code)`. A DOMException timeout yields `{"code":"23"}`, which the CLI also reports as `CONTROL_REQUEST_FAILED (500)`. A regression reproduced this.

No daemon stderr from R4 exists, so R4's own path cannot be proven retroactively. R5 later established the same mechanism on the instrumented daemon (below). The failed public operations were preserved and not replayed.

## Cause established by R5 and repair

After the owner approved Chrome, the service `chrome-open` attached to the already open eCommerce tab at 22:55 without creating a tab. R5 then started on build `80b913fd...`, using a new context and target. About 80 seconds into capture, the daemon logged:

`[leader] control authorization unavailable (GET /control/approvals; StatePermissionError/STATE_ACL_COMMAND_FAILED <- Error/WINDOWS_BOUNDARY_TIMEOUT; 7502 ms)`

The CLI treated this failed *poll* as fatal, requested cancellation and abandoned the main request. The public operation became `outcome-unknown` / `OPERATION_CANCELLED_AFTER_DISPATCH` ([record](r5-preparation-failure.json)). On Windows, each control request verifies credential state on both sides, and the monitoring loop polls every 300 ms. By code inspection (an inference, not a measurement), that is about two `whoami.exe` runs and four probe requests per request on the daemon and about twice that in the CLI. All probes in a process go through one PowerShell worker that also serves the capture's state writes.

Repair, with integrity unchanged:

- Authorization still fails closed. Only probe-capacity outcomes (timeout, queue full, queue timeout), reached through the command-failure wrapper alone, return `503 CONTROL_AUTH_BUSY`; every other exception stays `500 CONTROL_AUTH_UNAVAILABLE`.
- While only monitoring, the CLI tolerates that typed busy state, or the same transient probe outcome in its own credential read, for at most 60 s of consecutive failures. It polls every second during that window, emits `monitoring-delayed` and does not cancel.
- Approval decisions, untyped failures and an exhausted window keep the existing cancellation/unknown-outcome path. No mutation is replayed.

[Two regressions](auth-busy-red-tests.json) failed first. [Related suites](auth-busy-tests.json) then passed 468 with 0 failures and 9 existing Unix-only skips across 21 files, and CLI/MCP typecheck and scoped lint/format passed.

The third provenance round initially ran from a malformed derived helper. Shell `set -e` did not stop the chained commands, so an empty alternate index was created and the updater and manifest writers failed (`ENOENT`, `CHANGE_MANIFEST_OUT_OF_SCOPE`). A byte comparison confirmed that every authority file was unchanged. The empty index was kept as `.cache/auth-busy-20261004.failed-helper.index`, and the corrected helper was rerun with strict `&&` chaining. It passed with 62 semantic changes, 178 forks, 3 upstreams and 238 vendor rows. Main and native sources match at `sha256:ac67794db1460d34bd24435e2545faa6b3ae6d596be6cadce21b515c5ac2a099`, and the owner index is unchanged.

R6 ran on rebuilt daemon `29fd134f...` from 23:10:28 to 23:14:11 KST. At 23:12:47 a poll met the same probe timeout (`control authorization busy`, 8,580 ms). The CLI recorded `monitoring-delayed`, and the operation finished `succeeded` ([result](r6-preparation-result.json)). The private plan is in `.worktrees/_cache/ecommerce-service-context-20261004-prep-r6`. The probe-load root cause remains open. Candidate reductions include caching the per-process Windows SID, reusing verified credential state within a request path, and gentler polling; each needs its own review.

## Instrumentation implemented

- Control authorization that throws now fails closed with `500 {"code":"CONTROL_AUTH_UNAVAILABLE"}`; no control route runs.
- The leader catch-all and router server failures (status >= 500) log one bounded line: method, route words with identifiers replaced by `:param`, error name/code chain (at most four causes) and elapsed milliseconds. Messages, query values, identifiers and credentials are never written. The daemon wires its stderr logger into the router.
- Successful, 4xx and other existing 500 bodies are unchanged, including the deliberate `toString` passthrough contract.

[Red tests](red-tests.json) failed for the intended reasons (3 of 115); [focused tests](tests.json) then passed 115/115, and [related suites](related-tests.json) passed 338 with 0 failures and 8 existing Unix-only skips. MCP typecheck, scoped lint/format and [bounded provenance](provenance-checkpoint.json) passed (59 semantic changes, 178 forks, 3 upstreams, 238 vendor rows).

## Code review and repairs

The built-in `code-review` skill reviewed the uncommitted `service/packages` changes (high effort). A separate read-only verification confirmed or rejected each finding:

| Finding | Verdict | Disposition |
| --- | --- | --- |
| F2 failed source opening leaves blank/login tabs in the owner's Chrome (HEAD's cleanup removed) | Confirmed | Repaired |
| F3 PNG re-export proof throws at bounded read/decoder limits, aborting acceptance | Plausible (not reachable at eCommerce/CDD scale) | Repaired |
| F7 source-open navigation ignores cancellation; sign-in redirect ends as raw Playwright timeout | Confirmed | Repaired |
| F1 shared opening intent across concurrent `open()` calls | Plausible (latent) | Repaired; reproduced in a regression |
| F9 proof re-hashes both full captures (efficiency) | Confirmed | Open |
| F10 v2 fingerprint formula duplicated in `ir` | Plausible | Open |
| F4 re-observation shares the 256-call cap (pre-existing, explicit) | Plausible | Open |
| F5 malformed native style row aborts node comparison | Plausible | Open |
| F8 retry shares the cumulative response budget | Intentional, documented | No change |
| F6 symmetric padding defaults | Refuted by recorded comparisons | No change |

Repairs:

- The relay closes, with a bounded wait, only tabs that it created for an explicit source opening and that its caller never accepted. Accepted and pre-existing tabs stay open, and clients still cannot send `Target.closeTarget`.
- The CLI accepts the tab only after selecting the source. Sign-in redirects map to `FIGMA_LOGIN_REQUIRED`, pages that never reach the file to `FIGMA_TAB_NOT_FOUND`, and cancellation stops the wait. A concurrent open with a different opening intent is `CHROME_SOURCE_BUSY`.
- Proof read-capacity and decoder limits return no proof. Freshness then fails while evidence is retained, and changed asset bytes still throw `PORTAL_CAPTURE_ASSET_CHANGED`.

[Nine regressions](review-fixes-red-tests.json) failed first. [Related suites](review-fixes-tests.json), including the installed-Chrome reconnect suite and native work, then passed 125/125. A later lint-only refactor of the relay's bounded wait passed 40/40 targeted tests, CLI/MCP typecheck and scoped lint/format. The second bounded provenance round passed with 60 semantic changes. Main and native sources match at `sha256:206bd90046daeb35c3493ca1031ef16b905b3c5bea06479c76a023b5bd3201cf`.

## Live state and continuation

The instrumented daemon (build `sha256:b78dc44a...`, source `ed9aba99...`) started at 22:04:55 with stderr captured privately under `.worktrees/_cache/daemon-logs`. Egress remained valid until October 5, 00:24:12 KST. The service `chrome-open` for eCommerce waited 300 seconds and ended `CHROME_CONNECTION_REQUIRED`: Chrome's connection prompt was not approved in that window. No connection was established, so no tab was created. No browser approval was automated. The daemon logged only startup lines and was stopped after an identity check before the whole check, because that check rebuilds the same `dist`.

Fresh whole check `41c4cda8...` at source `206bd900...` passed its typecheck, lint, format, knip, contract and build gates. At the start of its test gate, Claude Code stopped the background shell because the system was critically low on memory. The attempt is [interrupted, not passed](interrupted-source-check.json); its pointer remains `pending` and it was not restarted automatically.

The owner then approved Chrome and requested a fresh whole check. The R5 and R6 sequence above followed. The R6 daemon (working set 771 MB) was stopped after an identity check to free memory, and a new whole check was started at source `ac67794d...`. Attempt `a59a6e15-5c33-472d-b947-a86d249124f8` passed all 16 gates at 23:30 KST ([checkpoint](full-source-checkpoint.json), [report](full-source-report.json)):

- 430 files and 4,789 tests: 4,769 passed, 0 failed, 20 skipped. The skip names match the previous census.
- All 37 required Chrome cases passed with no skips.
- The separate [artifact-content case](artifact-contents-checkpoint.json), run `c36285dd...`, passed 1/1. The R5/R6 helpers (`.worktrees/baseline/service/.cache/prepare-ecommerce-workflows-r{5,6}-20261004.mjs`) use new contexts and targets, never replay earlier operations, and record operation IDs, HTTP status and public operation status.

Continue in this order:

1. When live work resumes, restart the daemon from the verified build with stderr captured; the owner approves Chrome's prompt.
2. Continue the evening handoff's remaining order: independent native acquisition and comparison, authenticated official MCP, Desktop acquisition, C1–C3 cases and review gates.
3. Then use the complete R6 preparation for final dual-path eCommerce generation without reference frontend code, after a fresh live source check.
