# Retained Chrome source-tab replacement repair

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the continuation record](README.md), [the page API implementation](page-api-capture.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns live source Chrome, daemon operations, integration, provenance and whole checks. This task changed only the five managed-service paths listed below and this report.

## Baseline and live trigger

The service retains the owner's approved Chrome connection across separate source acquisitions. Its relay deliberately attaches Playwright to the selected Figma page rather than initializing unrelated user pages. Subsequent explicit acquisitions must continue to find the authorized file when its earlier tab has been closed and replaced.

The coordinator reported that a fresh service `chrome-open` found the CDD title and URL at 18:18 KST, but the retained daemon still returned `FIGMA_TAB_NOT_FOUND`. A separate direct control plan with no web target selector reproduced the failure, ruling out that selector as the established explanation. This task inspected the retained plan's sanitized design failure: connection stage, elapsed zero milliseconds, incomplete capture and `liveVerified:false`, for file `ly06O8jAcrd7oWmwhz5Vr6`, node `1378:120`.

Parent-owned evidence locations:

- `.worktrees/_cache/web-portal-cdd-20261011-r4/run.json`
- `.worktrees/_cache/cdd-page-api-context-20261011-selector-none/plan.json`, plan `sfp_portal1_77e68de771b833c36bc67cdf5caca2f8`

These are observed live failures, not new successful acceptance. Earlier successful CDD collection and expired/blocked runs remain separate evidence. This task did not replay a live operation or operate the source browser.

Implementation used `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`, at Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with substantial pre-existing authorized changes. The coordinator identifies its base as `6faae627...` with separately reviewed sample and accessibility repairs; the relevant initial production browser paths match the retained main/native implementation. The parent-reported later `1a5...` whole checkpoint does not verify this new repair. The frozen three accessibility paths and six sample paths were left unchanged.

## Established cause

Two owned regressions reproduced the mechanism:

1. The scoped relay translates the browser-level `Target.setAutoAttach` initialization into one `Target.getTargets` request and an attachment to the exact matching page. It does not broadly auto-attach new top-level pages. `ExistingChromeConnection.open()` previously reused a healthy Playwright browser without another target scan. After its selected page closed, the remote socket could remain connected while that local view had no matching page, even if another approved service client had opened a replacement.
2. Relay bookkeeping retained a root attachment after Chrome emitted `Target.detachedFromTarget`. Closing the obsolete local view could therefore attempt to detach an already-dead session. This is not evidence that the remote browser connection failed, and a redundant detach could unnecessarily retire it during reset.

At **18:26:02 KST**, the real owned-Chrome replacement test failed at the next `connection.open()` with the same `FIGMA_TAB_NOT_FOUND` message. It had already verified that the retained connection still reported connected and that a separate service `openChromeSession(..., openIfMissing:true)` successfully opened the replacement. At **18:26:19 KST**, the protocol regression separately failed because reset sent one redundant `Target.detachFromTarget` after a confirmed detach event.

## Implemented behavior

`browser-session.ts` shares one exact Figma-file matching function between selection and the retained-view check. On a new explicit request, if the healthy local browser view has no matching source page, the connection refreshes that local Playwright view over the same retained approved relay. Existing target selection then performs its normal scoped scan and attachment. It does not launch a browser, enable broad page initialization, request another remote permission handshake, navigate unrelated tabs or create a source tab unless the caller separately requested `openIfMissing`.

An active logical acquisition prevents this refresh with `CHROME_SOURCE_BUSY`. The original caller signal still bounds its wait, and the supplied connection timeout reaches the replacement initialization unchanged. Cancelling a waiter does not restart its budget or accept a selected session. As in the existing connection design, shared initialization can finish later; an explicit later caller can reuse it, while the cancelled request does not perform selected-page activity. This preserves the distinction between abandoning one logical acquisition and tearing down the owner's retained authorization.

`chrome-transport.ts` now removes confirmed detached session IDs from owned attachment and navigation bookkeeping before forwarding Chrome's detach event. Reset still detaches this relay's remaining attachments and disables only this connection's auto-attachment/discovery. It does not close user pages. Existing unknown-outcome handling, private relay credentials, endpoint restrictions and target ambiguity checks are unchanged.

The owned Chrome regression additionally verifies that a replacement for another file is rejected, two matching replacements are rejected as ambiguous, no missing tab is silently created, and the unrelated fixture page remains open with its original title. The replacement Playwright context exposes only the selected source page.

## Verification

All commands ran through direct installed tool binaries in the managed service copy. The installed Chrome fixture uses Playwright's `chrome` channel, its resolved Google Chrome executable, an owned temporary profile, a loopback debugging port and locally fulfilled Figma-shaped URLs. A separate approved service connection opens the replacement in that owned browser. It never connects to the user's source Chrome.

| Start time, KST | Check | Result |
| --- | --- | --- |
| 18:26:02 | Owned Chrome replacement regression before repair | Failed with `FIGMA_TAB_NOT_FOUND` after the replacement was independently opened. |
| 18:26:19 | Confirmed-detach bookkeeping regression before repair | Failed because reset sent a redundant detach for the destroyed session. |
| 18:26:58 | Both original regressions after repair | 2 selected cases passed; 24 other cases filtered by name. |
| 18:28:14 | Four-file affected run including existing CLI source-open tests | 49 cases passed in three files; `browser-source-open.test.ts` failed during module initialization and executed zero cases. |
| 18:28:40 | Source-open suite alone, native config loader, no cache, one worker | Same module-initialization failure before any case. |
| 18:29:56 | Final changed test files | 3 files, 49 passed, zero failed, zero skipped. |
| Final source | CLI and MCP TypeScript checks; scoped lint and formatting | All exited successfully. |

The unchanged source-open suite failure is `TypeError: Cannot read properties of undefined (reading 'default')` at `packages/shared/src/portal.ts:853`, while evaluating `PortalCoreDeclarationBatchSchema.default([])`, with the import chain through `portal-recipes.ts` and `portal-core-lifecycle.ts`. This task changed no production imports or shared schemas. The failure is outside these owned changes and remains an explicit integration verification limit; it is not counted as a pass or silently skipped. No unrelated shared-schema repair was attempted.

The final tests cover actual installed Chrome restart and page replacement, the retained relay generation, active-session exclusion, cancellation during a pending replacement connection, forwarding the configured timeout, delayed initialization without a cancelled caller's page activity, exact-file selection, ambiguity, unrelated-page preservation, relay reset and existing protocol guards. `browser-session-reconnect.test.ts` was already in the mandatory Chrome census, so no registry change was required.

```text
node node_modules/vitest/vitest.mjs run packages/cli/test/browser-session.test.ts packages/cli/test/browser-session-reconnect.test.ts packages/mcp/test/portal/chrome-transport.test.ts
node node_modules/typescript/lib/tsc.js --noEmit -p packages/cli/tsconfig.json
node node_modules/typescript/lib/tsc.js --noEmit -p packages/mcp/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings <the five owned paths below>
node node_modules/oxfmt/bin/oxfmt --check <the five owned paths below>
```

No whole suite, daemon restart, dependency installation, main/native service edit, source Chrome operation, Codex browser/Figma connector, Docker, commit, index mutation or provenance update was performed. The managed checkout and owned profile avoid mixing test state with user tabs, but run under the same Windows owner account and do not provide an OS security sandbox.

## Final owned paths

Frozen after the final tests and static checks at **18:29:59 KST**. Slice SHA-256 is `63a2c6975567af3f3a93ee703f709eec2d40ce860c3df374163e5ec3f0d1560f`, computed over JSON of the ordered `{path,sha256}` entries below without hash prefixes.

| Path relative to managed `service` | SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `bcb847671d664491d412fd33ce0c36db3fa3a8dbcd37ff448560d9c2e7545896` |
| `packages/mcp/src/portal/chrome-transport.ts` | `96ee2e62ab36739aff909de959a8b935803465a717348bad36dd05bcbe86cf1d` |
| `packages/cli/test/browser-session.test.ts` | `6e14e79c2a14285a0cf4a30a6342349261a496ad7fd497548eef1d25c5a57772` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `6bd5369f20c9603dab75103ae8e37e9a76dd676a89690bba13a275124e30e3fc` |
| `packages/mcp/test/portal/chrome-transport.test.ts` | `77faa7878e24f45709d0e6838bcf52fa132aef059f8a3a072d96e05c281da407` |

Independent review is required before integration. The coordinator must resolve or separately account for the source-open initialization failure, integrate/reconcile the five paths and run required current-source checks before authorized live verification. A successful owned-tab replacement is not proof that the retained live daemon has been repaired or that any new CDD plan has succeeded. No new product decision is needed for the bounded connection repair.


## Restoration after the later October 11 integration regression

Date: October 11, 2026, Asia/Seoul. The coordinator reported whole attempt `03252751-bc87-4506-a992-838977314c0a` at source `e2f01...` with 5,239 passing cases, nine failures and 20 existing skips. Five failures belonged to retained Chrome replacement discovery and its busy/cancellation guards. The other four packaging/census failures remain outside this repair. The failed whole result is retained; this focused restoration does not convert it into a whole pass.

The managed, main and native `browser-session.ts` had identical regressed SHA-256 `45e0b75729740c563e98a83a807ea0d687698362e364704dc0caf5245b56e97f`. Comparing it with the earlier reviewed baseline showed that a later integration had dropped `matchingFigmaPages`, missing-source detection, the active-session refresh fence and the local-view reattachment trigger. The intended newer changes were only an optional standalone cancellation signal and additional safe runtime diagnostic fields.

The correct baseline was read with `git show :service/packages/cli/src/browser-session.ts` against the explicitly selected alternate index `.worktrees/baseline/service/.cache/review-20261011-r6.index`. That read returned file SHA-256 `bcb847671d664491d412fd33ce0c36db3fa3a8dbcd37ff448560d9c2e7545896`. The alternate index hash was `4deb5ad50c27b1d67fe3aa1511b6792d33d6eafed0a832b333d9051288231bf1` both before and after the read. No Git index was written.

The implementation restored that baseline in the managed `4d3e` copy, then reapplied only:

- `openChromeSession(options, signal)` checks the optional abort signal and forwards it into the retained connection's `open` call.
- The runtime availability probe exposes only file-key presence/type/match and synchronous API/page-object stability observations. It does not return a different raw file key or claim full capture.

The final diff against the reviewed baseline contains exactly those two retained additions. The existing replacement and detach bookkeeping semantics remain intact. Two stale managed test files were synchronized byte-for-byte from the native tests before validation; no test was weakened or newly excluded.

At **22:40:06 KST**, the six focused suites passed **57/57, zero failures and zero skips**:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 test/browser-session.test.ts test/browser-session-reconnect.test.ts test/browser-runtime-probe.test.ts test/browser-source-open.test.ts test/browser-observation.test.ts test/browser-observation-bounds.test.ts
```

This includes the actual installed-Google-Chrome replacement and runtime-probe fixtures, with owned temporary profiles and locally fulfilled fixture URLs. It also preserves the source-missing, ambiguity, active-session, cancellation and original-bound checks. CLI TypeScript, scoped lint and formatting passed. Only fixture-created headless Chrome instances were opened/closed; the user's source Chrome, daemon and portal processes were not controlled.

The single production file is frozen at SHA-256 `7c658eac651371db198ae4fb18c9bf41e88a4e9343a457f4a498778b07172d54`. The parent must copy only `packages/cli/src/browser-session.ts`, reconcile the changed source and rerun the current-source gates. Packaging/census repair and the remaining preview validation work are separate scopes.
