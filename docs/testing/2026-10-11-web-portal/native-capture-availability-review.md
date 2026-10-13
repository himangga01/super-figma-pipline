# Independent native-download availability policy review

Date: 2026-10-13, Asia/Seoul. Reviewer: SOL. Status: exact four-path proposal approved for root integration after independent execution and post-run hash verification.

## Scope and source

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [supplement implementation](native-capture-supplement-implementation.md), [contour producer review](native-contour-consumption-review.md), and the exact root-owned policy manifest. This report covers the narrow optional-export policy and store-only production wiring. Root owns integration, runtime deployment, admission and live capture; no delegate performs those actions.

The four-path frozen proposal is `.worktrees/_cache/native-policy-root-20261013/frozen-policy-files.json`, SHA-256 `2143aa6eee816ad50a98b365e0d0440c3b154410ea0e3d7d470d6e3d73233c84`. Its dependency is supplier revision 2 manifest `31720871a4f6547e6b464e744bfc04f2f79162794b3d782e6ae72e9dd8d9ec14`.

| Path | Before | Proposed after |
| --- | --- | --- |
| `packages/mcp/src/portal/design-capture.ts` | `42d22b1d300455de81aec494df4a713262450fc838172ec4bc4911f1cb21dbe7` | `6278899c421059366780405fd801143981e9e377b38b9a86d58c983a0853ce57` |
| `packages/mcp/test/portal/capture-coherence.test.ts` | `afb9a9922216328f54eb2f87cc33bd0bcf7113e66e3fbe1a8e74f57da02e31e7` | `2bdd186338eae1b3f7aa2e8cfa8c81572d5bee90a498fdb1b5da7fbdb02bb2ab` |
| `packages/cli/test/figma-web-export.test.ts` | `0365ba6a2d67bb25f8bdf0c44f73b72a6307af19e3b0c858eb7ae55c90191dc5` | `c40f351b5566386e5fbfbe13e842a35f4d0de12ce239bc186e839247f08039ea` |
| `packages/mcp/src/index.ts` | `74ac932dbbdc00bc9e1225289faf206022b0fe0b6e09d22a60b4b1f1ad36a2de` | `a1ac55dc67da5c9345a7b1dcf66a5d856f625707ebd544b896727006411f324b` |

## Source inspection

The service's primary collector remains usable when the optional native Save action is confirmed disabled. This is an internal constructor policy. Boolean native-supplement opt-in without `nativeContourUnavailable:'retain-primary'` continues to require a native document.

The exception branch accepts only an `Error` whose entire message is `FIGMA_WEB_EXPORT_UNAVAILABLE`. It rechecks the original combined signal and unchanged 300-second capture deadline before suppressing that exception. Empty native results, message suffixes, timeouts, target changes and unsupported modals still reject. Primary after-read coherence and session cleanup still execute. The result has no newly signed supplement when native export is unavailable. A recipe that requests native contours must still obtain a current signed capsule and fail closed if none exists.

The actual exporter emits this exact error after observing disabled Save and before issuing Save activation. It can already have opened the File menu or restored Design Mode. The fallback is consequently an availability decision after bounded source UI work, not a proof that no source UI effect occurred. The unchanged post-read and cleanup requirements remain necessary.

Exporter `finally` restores the page download hooks. Although that function suppresses a restoration rejection, the real ExistingChrome transport registers the physical restoration promise with `sourceWork(..., true)`. Its rejection sets `nativeCleanupFailure`; `closeAfterNative` then rejects primary publication. The independent unavailable-plus-restoration-failure case confirms this rejection and blocks the next attachment. An injected internal test transport can manufacture the exact message; such a transport is not a public caller input or evidence of a real browser condition.

Production index wiring enables the availability policy on the admitted ExistingChrome capture and supplies `StoredNativeContourAcquisition` to the same PortalNativeWork instance. Profile preparation performs protected lookup only. It does not start an export, copy an old capsule into a new capture, grant access, or manufacture a source proof when disabled Save leaves no current supplement.

## Evidence and verification limits

Root's preserved author evidence records 45/45 focused cases and one installed-Chrome disabled-Save case. Fifteen other Chrome cases were filtered and are not claimed as passed. Root's red availability receipt remains separate.

The independently executed regular fixture is `.worktrees/_cache/native-policy-independent-20261013/service`. Exact producer R3, supplier R2 and policy layers were copied after all manifests and file hashes matched. Policy preimages for the two supplier-owned paths match the supplier dependency. The fixture reads native installed dependencies and uses private cache/report paths. No installation, managed-junction build, source Chrome, live runtime, state, data grant, fence, unknown-job or Git operation was performed. The earlier model-data grant is expired; local preserved inputs do not renew it.

Independent results, all exit 0:

| Receipt | Actual result | SHA-256 |
| --- | --- | --- |
| `policy-focused-r1.json` | Exact focused source cohort 45/45, no skips | `67177d3c93309053ba18b559372e9aaaa2e869471497b4cd2287f6e0a8f1f27e` |
| `policy-boundaries-r1.json` | Four additional race/coherence cases 4/4, no skips | `1bde9d09d72c7a975d40b73fd34061acc0dff9a1f57f94ae757934759239a854` |
| `policy-chrome-r1.json` | Two selected installed-Chrome cases pass; fourteen filtered | `066f5a06684c6f99246f11af9f0721b52074db913f8685832f4856fa6b791d98` |
| `policy-types-r2.json` | Actual managed MCP types with exact virtual policy overlay: zero diagnostics | `ec5a6ab92df94cbcdb4edb4e2edfc728038030375268f1ba77254084c44e986b` |

The additional tests reject cancellation coincident with exact unavailable, expiry coincident with unavailable, physically rejected hook restoration despite unavailable, and repeated post-read source changes despite unavailable. They verify the same original deadline and bounded two-attempt policy, no accepted supplement, and cleanup quarantine rather than accepting unknown physical work.

The Chrome filter `disabled` selects the newly added disabled-Save case and an existing disabled-back preflight case. Both pass; fourteen registrations are intentionally excluded, not claimed as successful executions. Installed Chrome launches only after the owned proxy is listening. Foreign HTTP/CONNECT are denied, Node fetch is limited to currently owned loopback server objects, and source-page fixtures use injected synthetic responses. The Save-disabled case observes zero Save activations, restored hooks and no document.fig. These fixtures do not observe an actual remote Figma condition or establish no earlier File-menu/Design-Mode effect in a live session.

The actual managed package type command initially exposed the separately staged index field while design-capture still had its supplier constructor type. The independent compiler overlay combines the exact four frozen files with actual managed package types and native TypeScript/dependencies: 566 root files, 1,196 source files, zero diagnostics, no emit and no source writes. A preliminary private compiler harness had Windows ESM-path and Node type-root/CWD setup errors; its original script and failed receipt remain preserved. Corrected configuration uses the actual managed config filename/current directory. Neither preliminary harness result is presented as a production failure or pass.

Post-run all four proposed source files and private fixture files match the frozen manifest. `policy-independent-review.json` binds the hashes, separate test receipts and compiler result. Root can integrate exactly these four paths after before-hash checks, then run the actual combined native package type command and whole/artifact checks. This source approval does not establish runtime deployment, source capture, generated application, complete frontend or portal acceptance.

## Reproduction

From native service cwd, run native Vitest with the ignored review root's `focused.config.mjs`, `independent.config.mjs` and `chrome.config.mjs`, `--configLoader native`, JSON reporter and distinct absolute output files. Use `-t disabled` only for the documented two-case Chrome selection. `check-types.mjs` reads the real managed MCP config and exact policy sources through a private compiler host; it never emits or changes managed files. Root remains the sole owner of source integration, full checks and live continuation.
