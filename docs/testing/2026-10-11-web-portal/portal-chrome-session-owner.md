# Portal-owned Chrome session continuation

Date: October 12, 2026 (Asia/Seoul). This record supplements the [Chrome dispatch review](chrome-dispatch-repair.md), [retained-tab evidence](retained-tab-live-qa.md), [canonical service analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md).

## Confirmed gap and source baseline

**Subsequent root verification, 03:54 KST.** This exact reviewed candidate and its companions were integrated in source `sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`. [The current whole check](full-source-f0dc/full-source-checkpoint.json) and [separate artifact check](full-source-f0dc/artifact-contents-checkpoint.json) passed. The actual retained-tab read still failed `CHROME_CONNECTION_REQUIRED` at its original 180-second bound, so positive live reuse is not established. [The execution record](retained-tab-live-qa.md) contains current process identities, three passing logging rounds and the separate official-authentication blocker. This update preserves the implementation/review evidence below without relabeling source fixtures as live acceptance.

The retained UI's earlier explicit-endpoint `chrome.tabs` job `31faeef0-6642-46e9-a758-17f8d718f35b` succeeded at source `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`. After the authorized QA restart at source `sha256:ce6fdc2dcba4d29f2741507fe0d38c021b961cbb1f19b1ec83c2a618329d735f`, three default-endpoint jobs failed after approximately 60, 180 and 60 seconds. Their persisted public code was `SERVICE_UNAVAILABLE`; diagnostic causes record `CHROME_CONNECTION_REQUIRED` at the compiled Playwright connection call. A current explicit-endpoint comparison also timed out. Missing discovery configuration would fail before that stage. The restart script derives the profile from `USERPROFILE` before changing QA `LOCALAPPDATA`, and the public feature adapter has no subprocess or environment replacement on this path. No precise native approval failure cause was established.

The implemented lifecycle does establish a usability defect: each public Chrome feature calls `runCommand`, which calls standalone `openChromeSession`, constructs a new physical `ExistingChromeConnection`, and closes it after that one command. The previous pending or approved socket cannot be reused. A slow manual native approval can therefore arrive after its job and physical handshake have ended. This review did not create additional native approval prompts or control source Chrome.

The coordinator authorized a bounded managed-only repair while the current native whole check continued. Existing owned files were compared with current native bytes before editing; all matched. The protected native/main source and active jobs were not modified. Diagnostics' active three-file scope and the artifact startup fixture remain separately owned.

The native source was independently read-hashed unchanged at `sha256:673629ce8080ac1e697d144143b7b5d2c3a58482745a7ef885d0ea09578a0bfa` before this candidate's verification.

## Owned implementation scope and native before hashes

| Managed path under service | Exact native before SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `5a34bf368faae00467489e1f184b64210d6c119e7e5affbd72cac24c826f971f` |
| `packages/cli/src/commands.ts` | `74cdeb89eb100eaec58caa8bbd80acbe437bf46e3eb3a16909b78861340eff1a` |
| `packages/cli/src/service-functions.ts` | `e0c957acaa72319b33ae283074a978825770596f3c875e0cb4b1d2f9107f19bf` |
| `packages/cli/src/library.ts` | `703a5f2ce21a22f9dfc7f08780421831d03a1dae6679ff51a36690168472b52a` |
| `packages/portal/src/control.ts` | `1f9198c796c82febccd2934e58b672aefe93068025ae088586f458112bc6d0c1` |
| `packages/portal/src/bridge.ts` | `2497b28f32adfd41cfc93c896187d67d2a4c50a740423e0e210e9e6b81faf0fe` |
| `packages/portal/src/server.ts` | `9ae5ede1ce50cd56012945db98e7a56d7cfd784ce42fa7ae9a07ce9b93ce08c5` |

Tests are restricted to the existing CLI browser-session and reconnect files plus existing portal service-control/backend files. No new Chrome census file is planned. Every new parameterized test must include a case identifier in its full title.

## Intended and implemented behavior

The implemented candidate adds a portal-scoped `ChromeSessionOwner`, exported through the public CLI library. The bound portal control creates one owner and injects it into Chrome feature command execution. Each command acquires an exclusive logical lease. An overlapping command receives `CHROME_SOURCE_BUSY`; no command waits in a new queue and no job deadline is extended. Existing `ExistingChromeConnection` source/file/selection guards remain active.

A logical command releases only its own source session. A failed or cancelled local wait leaves a healthy/nonterminal physical permission handshake available for a later explicitly created job. The original job remains failed or cancelled. The shared physical connection's original initialization timeout is not reset by a later waiter. There is no automatic replay of a source mutation or reuse of expired job deadlines.

That retention applies to pending reads without source-opening or node-selection intent. Failed/cancelled `openIfMissing` or `selectNode` initialization retires its physical generation and synchronously clears its intent callbacks, preventing late native approval from creating or navigating a source for an expired command. The abort hook disarms the source before asynchronous teardown finishes. A session delivered at a cancellation boundary is released rather than returned. Capture command execution checks cancellation before its first copy navigation.

Standalone CLI calls retain their original ownership: without injection, `openChromeSession` owns and closes its own physical connection. Portal close releases the portal's physical owner before reporting successful shutdown and preserves existing diagnostics flush/error handling.

An idle new command may deliberately select a different validated endpoint. The old owner is closed, its cleanup time is deducted from that command's original connection bound, and a fresh physical generation requires normal manual native approval. `undefined` and the explicit `chrome` sentinel select the same default identity; explicit loopback endpoints are canonicalized. Invalid endpoint/URL input must not destroy a healthy connection. Cancellation/deadline expiry during cleanup must prevent late attachment. Pending cleanup remains busy and shutdown must await it. Recovery from an interrupted switch must require a new explicit job after confirmed physical cleanup.

Failed retirement is quarantined. A later idempotent close cannot turn the earlier failed cleanup into success; new requests are rejected and shutdown returns the original cleanup error. The known Playwright connection wrappers now assign their explicit `CHROME_CONNECTION_REQUIRED` or `CHROME_INITIALIZATION_TIMEOUT` code and preserve their cause, so public jobs can display the existing Chrome guidance instead of a generic unavailable code.

This owner belongs to the portal process's public CLI features. Workflow capture in the daemon keeps its separate authorized connection. The repair does not change daemon status, borrow primary private state, share approvals across processes, automate security dialogs, introduce another visible browser, or establish one approval for all service subsystems.

## Verification checkpoint and limits

The final focused run passed **127/127**, with zero failures or skips, across four existing files: CLI browser-session (39), CLI reconnect (7), portal service-control (14) and portal backend (67). The earlier 114-case and then 119-case checkpoints also passed; later additions cover settlement cancellation, late approval safety and the actual owned Chrome public feature reuse.

The owned headless installed-Chrome fixture used `channel:'chrome'` and the installed Google Chrome executable, invoked the real public `chrome.tabs` feature twice through the same injected owner, and retained unrelated pages. It is a service-source fixture, not manual approval or retained visible-tab acceptance. No new Chrome test file or alternate browser engine was introduced. Mocked lifecycle cases preserve the first timeout/cancellation, same-generation read reacquisition, original physical timeout, overlap rejection, guarded endpoint change, cleanup deadline/cancellation/recovery, failed-retirement quarantine and late opening/selection intent retirement.

CLI and portal package TypeScript checks passed. Lint with warnings denied and formatting passed across all eleven owned files. An initial lint attempt retained two `promise(always-return)` warnings; explicit return values repaired them without changing behavior. The corrected static import closure checked 371 files and found only the separately owned active diagnostics implementation outside this candidate; no stale or missing dependency remained. Source edits were restricted to seven production files and four existing test files.

The frozen manifest is `.task-evidence/portal-chrome-session-owner/frozen-files.json` under the managed repository root. The final private test receipt is `.cache/portal-chrome-owner-final-tests.json`. The [independent SOL review](chrome-session-owner-review.md) approved all eleven exact hashes after its own 127/127 run, fourteen additional private lifecycle/boundary probes, CLI/portal typechecks, a build/import of the actual public CLI library into isolated output, pre-cancelled open and idle close, unique test-title census and post-check hash verification. Its helper setup failures remain distinguished from production findings. No source changed during that review.

Exact-file integration remains the coordinator's responsibility. Preserve the separately failed native whole checkpoint and combine this candidate with the separately reviewed startup-fixture/diagnostics companions before new whole/artifact checks and actual two-feature same-tab acceptance.

The manifest fingerprint is `a743c7b04fd152088ef34e2cdebb9b013d7637e20bc9897584b9001f1d76fc00`. Its eleven candidate hashes are the integration authority for this bounded change; the native before hashes above must not be replaced with stale managed dependency bytes.

Existing composite-write job outcome rules are unchanged. A write feature that encounters source busy after its execution callback begins may retain a conservative unknown-outcome fence. The coordinator explicitly preserved that policy rather than treating an error-code string alone as authoritative proof of no effect. Read-only `chrome.tabs` failures remain failed; live acceptance should use sequential reads and must not probe concurrent writes against the owner's source Figma. No original unknown job is cleared or replayed.

The native working copy and managed dependencies run under the same Windows user. Their source separation is not an operating-system sandbox. Temporary fixtures and dependencies do not establish actual retained-tab permission, source capture, official MCP authorization or frontend acceptance. The coordinator alone controls live/source Chrome and final integration.
