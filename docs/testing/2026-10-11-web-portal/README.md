# Web portal integration and three-round verification

Date: October 11, 2026 (Asia/Seoul).

## Scope and baseline

The owner requested integration of the login-free service web frontend and backend, then explicitly requested three verification rounds focused on the web portal and backend. This record supplements the [canonical service analysis](../../service-analysis.md), [implementation plan](../../plans/2026-10-11-service-web-portal.md) and [repository instructions](../../../AGENTS.md).

Published main remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`. Integration started from main/native fingerprint `sha256:1a5d6b0f7ad454e8fd31aa9d5e6636b6f2e27af36acaf462ac46b8bd91c56652`, which already had a whole-source and artifact pass. That pass does not cover this increment. The owner index SHA-256 was `ba167c341b304d7e00543aa4fcdcdbc56e000811ec0b8589d2faaa6bde1d9ab2` before and after the initial copy; no commit or push was performed.

The coordinator copied 35 frozen implementation/test files from the two managed working copies into main and the native validation copy. They comprise the 21-file portal, five Chrome replacement paths, three accessibility paths and six package-config paths. The exact initial integration receipt is retained privately at `.worktrees/baseline/service/.cache/integration-web-portal-r5.json`. Both destinations initially fingerprinted to `sha256:2137324f7c122f28e172e504dcab06e12836d5eaedfeb5ec9da905b9e7da7a82`. Subsequent package, documentation, provenance and repair changes require a new final fingerprint.

## Integration changes

- Added `portal:start` and `portal:test`, the portal workspace importer, package metadata and frontend entry points for unused-code checking.
- Registered `packages/portal/test/browser.test.ts` in the mandatory installed-Google-Chrome census. Its two cases must execute without skips.
- Added the existing locked Playwright version as an explicit portal test dependency and removed an unused type re-export. The runtime contract was unchanged by that cleanup.
- Added README startup instructions and the current limits: local hosting, five ordered execution stages, and a coding-agent lease/submission handoff.
- Started fourth-package distribution work so the portal's production server and browser assets can be verified from actual archives alongside the existing MCP, CLI and plugin artifacts.

The first offline lockfile-only resolution could not find cached tsdown registry metadata. The portal importer was then written using the already locked exact versions; `pnpm install --frozen-lockfile --ignore-scripts --offline` succeeded without package upgrades or install hooks. This ran in the native copy's actual dependency directory, not through the managed copies' writable dependency junctions. The regenerated production inventory contains 66 installed packages; the source epoch remains `1791202532`.

Initial build and package typecheck passed. The first root unused-code check found an undeclared test dependency and unused exported type; both were repaired and the repeated check passed. A direct daemon build without the local pnpm shim on PATH failed its publishing check. Repeating with the documented toolchain PATH and fixed source epoch succeeded. These failed commands are not passing verification.

## Three verification rounds

| Round | Executed evidence | Current disposition |
| --- | --- | --- |
| 1: functions and Chrome interface | Initial 48/48 passed. After the independently discovered concurrency repairs, the integrated suite passed **58/58** at 18:58, with no skips | Passed for the repaired portal implementation; the earlier result alone did not find the later races |
| 2: independent backend failure/concurrency review | The original seven probes exposed three failures. The final thirteen exposed six before repair; the unchanged thirteen then all passed. The reviewer independently reran the expanded complete portal suite: **58/58**, no skips | Passed, including late approve/reject/completed/new-operation responses, durable unknown fencing, starts/actions and reservation cleanup |
| 3: built server, distribution and real service connection | Production replacement and four-workflow/four-run retention, eleven editing checks, six actual live-map/event checks, a real service status refresh, and four-archive portable startup passed. Actual CDD R5 did not capture and failed planning | Partially passed. The successful live-Figma acquisition objective is still pending native Chrome approval and a fresh accepted attempt |

The [independent round-2 report](verification-round-2.md) and [repair record](round-2-repairs.md) own the exact reproductions and repair verification. The original [48-case independent review](review.md), [frontend report](frontend.md) and [backend report](backend.md) remain historical evidence.

An additional native integration suite passed **79/79 cases** across browser source-open, replacement/reconnect, transport, and package-config files at 18:55. The ordinary native workspace required no managed-worktree alias. This confirms those combined source tests, not a new successful live Figma capture.

## Owned runtime and remaining work

The coordinator read all 316 retained service operations before daemon replacement: 297 succeeded, 13 failed, three were rejected before egress and three historical outcomes remained unknown. No operation was active. Only the verified owned daemon PID 37744 was stopped; unknown operations were preserved and not replayed. The new daemon PID 27660 started hidden at 18:53:52, build identity `sha256:824441b9880d474efb13883e291e96d8bef0a64b0bbbc980857e6e98e4320fbf`. Its initial status is `not-requested` for Chrome. The existing user Chrome and browser security settings were not changed.

The verified old portal PID 33192 was replaced after its four runs were confirmed inactive. Integrated PID 28424 started at 19:00:59 on port 4310 and uses the retained store; the exact preservation and actual browser/API checks are recorded in [round 3](verification-round-3.md). Its tested portal entry hashes to `aa7b8a52d773c768b973c17ad096b4dd581b6105c3e7df0bb1befda426e2b866`. Later core diagnostic changes still require reloading the daemon.

## Followups and whole-check freeze at 19:20 KST

The initial r5 reconciliation accepted 118 fork changes and 115 semantic manifest changes but offline verification correctly rejected the unregistered sixth workspace. The [workspace provenance repair](workspace-provenance-repair.md) admits only explicitly reviewed, hash-bound original additions, with strict rejection of unrelated, malformed, duplicate or renamed identities. The [capture diagnostic repair](capture-diagnostics.md) preserves incomplete capture and defers unadmitted decisions instead of masking it with a decision-binding error. A final one-line census adaptation recognizes the new Chrome child-script wrappers while retaining the exact required-file registry and prerequisite guards. Its original failure and green 18-case rerun are preserved.

The [independent followup review](integration-followup-review.md) passed 43 native capture cases, 37 lineage cases and 16 census cases, all without skips. The coordinator then executed r6 using the unchanged owner index and a separate alternate index at `.worktrees/baseline/service/.cache/review-20261011-r6.index`. It records 123 fork changes, 178 retained forks, 120 semantic changes and four authority paths. Offline verification passed for three upstreams and 238 vendor rows. The owner index bytes remain `ba167c341b304d7e00543aa4fcdcdbc56e000811ec0b8589d2faaa6bde1d9ab2`.

Main and native now match **`sha256:935216d1aadd504a3e3e1757fde2f7c5056329cdb76220730a64a2522aa184dd`**. Whole attempt **`ae2a7fa1-c542-4a3e-a925-fe3a0a336ebf`** began at 19:20:57 with fixed source epoch `1791202532`. At 19:23 its typecheck, lint, format, unused-code, contract and build stages had finished and the complete tests were running. This is a pending attempt, not a whole-source pass. Keep the source frozen until its source/package/runtime gates settle, then run the separately scoped artifact-content case and record actual limits.

## Completed local checkpoint and final runtime at 19:43 KST

The preceding pending attempt completed successfully at 19:41:12. [All sixteen gates passed](full-source-9352/full-source-checkpoint.json) at unchanged main/native source `935216d1...`: **448 files, 5,125 registrations, 5,105 passed, zero failed and 20 existing skips**. All **70 required Chrome cases in eleven files passed without skips**. The skip identities are unchanged and the known-failure ledger is empty. The test stage took 1,058,071 ms. Actual four-archive package/startup verification and isolated packed-MCP runtime checks passed. The [separate artifact-content case](full-source-9352/artifact-contents-checkpoint.json), `ee5746d0-395c-4a89-bc86-44f4e44a6893`, also passed 1/1 with no skips at the same source.

Before reloading the verified binaries, the coordinator read all 318 service operations: 298 succeeded, 14 failed, three were rejected before egress and three historical outcomes remained unknown. None was active, and none was replayed. The exact owned portal PID 28424 and daemon PID 27660 were stopped after process identity, portal lock and inactive-run checks. Their six-workflow/five-run store was backed up and preserved. At 19:43:01 final portal PID **35944** and daemon PID **41108** started hidden in the native copy. Actual health/status requests confirmed port 4310 is available and the daemon reports build **`sha256:fa06abc94fee3d932497d39e2b7f109021e7d6ff49017fdf880fe57da362e4f7`**. The portal entry remains `aa7b8a52...`, matching the tested backend bytes.

The [sanitized three-round summary](verification-summary.json) binds executed portal results to the final whole source and actual archive hashes. Raw failure logs, temporary fixtures and private state remain separate. One summary helper initially parsed a PowerShell UTF-16 TAP file as UTF-8; the encoding-aware read was corrected without changing the retained evidence or any service source.

A fresh final-build CDD web R6 attempt used a new unused output target after the known failed R5. It settled at 19:49:41 as `awaiting-input`, with a retained plan/run and a 300,004 ms connection-stage timeout. [Its actual result](r6-live-result.json) records incomplete, unverified capture, zero admitted workflow decisions and no coding lease. The corrected diagnostic now preserves the capture failure; the helper's successful-capture assertion still failed. No accepted capture, generated frontend or application is recorded. The source grant and the previous failed run's budgets were not reset. Confirm native Chrome permission/state before a fresh live attempt. Official MCP, the CDD candidate loop, the later independent eCommerce outputs and remote release gates remain separate work.

No web-originated run has yet completed Figma capture, code generation, validation and application. Official service MCP authorization, the CDD candidate loop, subsequent independent eCommerce outputs and the earlier C1-C3/release obligations remain separate unfinished work. Native validation uses the current Windows owner's privileges in a separate copy; it is not an OS sandbox. No Docker, alternate browser or external Codex browser/Figma tool supplied service acceptance.
