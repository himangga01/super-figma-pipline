# Independent review of page API capture and portal routing

Review date: October 11, 2026 (Asia/Seoul). This record supplements [the implementation record](page-api-capture.md), [the continuation record](README.md), [the canonical service analysis](../../service-analysis.md), and [the repository instructions](../../../AGENTS.md). Read these records before continuing, verify the current source hashes, and update this review after any repair or new verification. The canonical service analysis remains the cross-agent authority.

## Scope and source baseline

The service collects Figma design facts and assets, admits a specific collector into its portal authority, and checks those facts again before accepting generated frontend work. This review covers the new plugin-free page-global reader, its shared source tags, public Chrome collector selection, admission and effect classification, coherent capture provenance/checkpoints, CLI inspection wiring, and same-collector final freshness. Native archive metadata, the complete-fact comparator implementation, sample resolution, official-MCP transport implementation, and whole-service review belong to separate scopes.

The main checkout is on `main` at `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with substantial authorized uncommitted implementation and documentation work. The reviewed execution copy is `.worktrees/baseline/service`; its detached Git baseline is `6459363354f52940b4c67e399b9e735d7332d4dc`, also with substantial working-tree changes. Commit IDs alone therefore do not describe the reviewed source. The previous whole-service pass at `18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3` predates this increment and does not verify it.

At review start, all 18 paths matched [the original frozen portal manifest](page-api-portal-hashes-initial.json), whose owned-slice fingerprint was `6183e44bf4f9c5d82e96869b63c56f321e8a56bb853d12f3a73fdf8d8d644ed3`. The original manifest was recovered verbatim in data content from the reviewer's retained tool output after the implementation manifest was refreshed; its JSON whitespace differs. The reader and parent-owned wiring had these SHA-256 hashes:

| Path relative to the native service copy | SHA-256 |
| --- | --- |
| `packages/cli/src/figma-page-reader.ts` | `31b782db811c835c51b012e227bbe022e032c82c98bfda7fe5b4a2c51cb9af3d` |
| `packages/cli/test/figma-page-reader.test.ts` | `edc2acb418abf7c44ce8a41dc9a505334171ed90d1e668f0f9535c27014d3af2` |
| `packages/shared/src/figma-capture-query.ts` | `b7dda43f293e6ffb006bb25a3c78a70164376300eb99067500602c6a46b3fbe5` |
| `packages/shared/src/figma-capture-read.ts` | `a1e78a4d3a2b05f36886f233d79f2af1031df83f1cd2a0228038075268ba4772` |
| `packages/shared/src/design-observation.ts` | `ade7ee53d97f46b11e8e3d73e24b1d6a5eda8284bb0855e9325ef4d8bae62d04` |
| `packages/mcp/src/portal/design-normalization.ts` | `c6d008fe6cd7900ecec8400d037ebb5a58ffd9aa24e73c81e0bf10d81af37a3b` |
| `packages/cli/src/commands.ts` | `b20372a2038e1bc012e52715a3f4e4d28586667fd0c4745720964db91589946e` |
| `packages/cli/src/browser-session.ts` | `2507a7ab8add2a4b48885e1e65c7d6f44111cd4999a7294314715a4a42500d3d` |
| `packages/ir/src/inspection-v1.ts` | `b484f161d436540d2ca2c36abb8ce5f83e8fbdaa67390d957b50560a9cbf719e` |
| `packages/ir/test/inspection-v1.test.ts` | `26ca4d809bb63201cdded547a68466be968068bd35c66de45303d5e8e157d734` |

## Finding R1: unbounded readiness retains the capture after its deadline

Priority: P2. Initial status at 16:14 KST: reproduced and sent to the implementing agent. Final status at 16:33 KST: repaired and independently verified as recorded below.

In the original `packages/mcp/src/portal/design-capture.ts`, the page-API transport's `ready()` checked `boundedSignal` immediately before and after `await observeFigmaPage(...)`, but did not race that promise against the signal. `observeFigmaPage`, in `packages/cli/src/browser-session.ts`, awaits locator counts, the title, and text queries. A stalled CDP query can therefore keep readiness pending after the absolute capture deadline expires. The outer `CoherentDesignCapture.capture` only races the caller/lifetime signal; the page port's deadline signal does not settle that outer waiter. Caller cancellation rejects the visible operation but leaves its queued capture tail and session pending. `capture.close()` then waits for that same unresolved tail.

The reviewer reproduced this against actual imported service source, without a browser connection, using `.worktrees/_cache/page-api-review-readiness.mjs`. The probe replaces only `ExistingChromeConnection.prototype.open` with a controlled page and shortens `AbortSignal.timeout` to 30 ms in its own process. The page's first locator `count()` stays unresolved. After 90 ms it checks the expired deadline, then cancels the caller, invokes shutdown, and finally releases the locator promise. It restores both replacements before exit.

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs ../../_cache/page-api-review-readiness.mjs

{"checkpoint":"after-absolute-budget","readinessCalls":1,"deadlineAborted":true,"outcome":"pending","closeCalls":0}
{"checkpoint":"after-cancel-and-close","outcome":"review-cancel","closeCalls":0,"shutdown":"pending"}
{"checkpoint":"after-readiness-release","outcome":"review-cancel","closeCalls":1,"shutdown":"closed"}
```

Required repair: logically bound readiness by its retained absolute deadline and cancellation signal, abandon late read-only results, and release the logical capture/session without closing or resetting the user's source page. Add a held-readiness regression for both deadline expiry and explicit cancellation/shutdown. Also inspect the actual `selectExistingFigma` session-close wrapper: it awaits its CDP activity detach before releasing active-session bookkeeping, so cleanup must not be described as bookkeeping only.

This is a liveness and resource-lifetime failure. The reproduction did not publish a successful capture, alter a Figma document, or bypass source admission.

## Finding R2: cancellation can lose ownership of an acquired handle

Priority: P3. Initial status at 16:17 KST: reproduced and sent to the implementing agent. Final status at 16:33 KST: repaired and independently verified as recorded below.

In `packages/cli/src/figma-page-reader.ts`, `bounded()` awaited `waitLogically(work(), signal, releaseLate)` and then called `assertActive(options)` before returning the value. If cancellation arrived after the waiter resolved but before this continuation, `assertActive` threw. The waiter had already resolved, so its late-value cleanup did not run, while `openPageRead` never received the handle and could not dispose it. No read was accepted, but the acquired browser reference was leaked.

The source-import probe `.worktrees/_cache/page-api-review-handle.mjs` uses a controlled page whose `evaluateHandle()` returns an immediately fulfilled handle and schedules cancellation at successive microtask offsets. It counts acquisition, evaluation and disposal. Offsets 1, 2, 4 and 5 disposed exactly once; offset 3 deterministically left the handle undisposed:

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs ../../_cache/page-api-review-handle.mjs

{"offset":1,"acquired":1,"disposed":1,"evaluated":0,"failure":"review-cancel"}
{"offset":2,"acquired":1,"disposed":1,"evaluated":0,"failure":"review-cancel"}
{"offset":3,"acquired":1,"disposed":0,"evaluated":0,"failure":"review-cancel"}
{"offset":4,"acquired":1,"disposed":1,"evaluated":0,"failure":"review-cancel"}
{"offset":5,"acquired":1,"disposed":1,"evaluated":1,"failure":"review-cancel"}
```

Required repair: when the post-result active check rejects, release an already-acquired value through its supplied cleanup callback and preserve the original cancellation/deadline outcome. Retain a regression that verifies exactly one disposal at this boundary, including controls on either side. The reproduction imports actual reader source but substitutes the page object; it does not assert a measured frequency in live Figma.

## Reviewed implemented behavior

- `readFigmaPageSnapshot` and `readFigmaPageAsset` execute fixed service-owned reader/exporter functions against a retained `window.figma` handle. Strict query schemas reject executable caller fields and source overrides before any API lookup. The locally compiled wrapper contains only the closed service program and JSON-serialized arguments. No Scripter import, frame lookup, plugin invocation, or fallback appears in this reader.
- The reader binds the explicit URL/file key, actual API object, current page object/ID, scope object/ID, and containing page. It checks these before and after each query. Descendant queries and node exports must stay within the admitted scope. Image chunks retain the requested hash, offset, total-byte consistency and canonical base64 checks. The source tags remain `figma-web-page-api` and `chrome-page-api`.
- Snapshot continuation and per-evaluation waits keep the supplied absolute deadline. The direct reader releases retained handles and rejects late results on cancellation. As documented, already-running page JavaScript can finish later; the service does not forcibly stop it by disrupting the user's page. Ordered reads cannot detect ABA changes or changes after the final observation.
- Portal requests accept `design.collector` only for Chrome. Optional collector fields have no schema default, preserving the historical omitted-field grant and descriptor shape. The explicit value flows from admitted source authority into execution policy, Chrome read approval labels, capture routing, descriptors and final freshness. A missing page-API port fails closed; Scripter is not a fallback.
- The page-API coherent capture port shares the retained Chrome connection but uses separate collector provenance, session identity and progress-key namespace. Capability and asset admission require actual complete evidence. Unsupported catalogs remain incomplete, and `pageApiObservation.fullCapture:false` remains a transport receipt rather than an admission claim.
- Native validation requires the same effective collector as the plan and a scoped capture port for page API. It reacquires fresh source facts and verifies files before exact fingerprint or bounded PNG-reexport comparison. The unchanged and changed-width NativeWork tests exercise the actual freshness implementation.
- The CLI rejects incompatible `--page-api`/`--ui-only`, wrong-command and target-scope combinations. The precise branch calls the page reader and independent asset callback, then publishes `chrome-page-api` inspection provenance. Reader success and CLI inspection fidelity are distinct from portal admission and frontend acceptance.

## Reviewer-executed verification

All commands below ran in `.worktrees/baseline/service` with `.worktrees/_cache/bin` added to PATH. No whole suite, build, provenance update, daemon action, source Chrome operation, Codex browser/CUA/external Figma connector, Docker, commit, or index-editing command was requested or performed by the reviewer. The reviewer changed only this report, the recovered historical manifest, and private reproduction scripts. Git status/baseline inspection was read-only; this review did not certify byte-for-byte index preservation. Tests use the native owner account; the separate copy is not an OS sandbox and does not provide filesystem/process isolation from that account.

| Start time, KST | Command | Result |
| --- | --- | --- |
| 16:10:23 | `pnpm exec vitest run packages/cli/test/figma-page-reader.test.ts packages/mcp/test/portal/page-api-admission.test.ts packages/mcp/test/portal/page-api-flow.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/policy/operation-policy.test.ts` | 5 files, 53 passed, 0 failed, 0 skipped. The reader fixture uses installed Google Chrome, Playwright `channel: 'chrome'`, a locally fulfilled page, and no Scripter frame. |
| 16:11:49 | `pnpm exec vitest run packages/mcp/test/portal/native-work.test.ts -t 'reobserves page-api'` | 2 selected cases passed. Vitest displayed 41 skipped because the name filter excluded them; these are not newly introduced policy skips. |
| 16:14:10 | `pnpm exec vitest run packages/cli/test/browser-source-open.test.ts packages/ir/test/inspection-v1.test.ts` | 2 files, 21 passed, 0 failed, 0 skipped. |

These passing cases predate the R1/R2 repairs. They establish the tested boundaries, not the absence of all defects. The public portal flow fixture supplies controlled native profile/validation dependencies. It does not establish an approved real target profile or a finished frontend flow.

## Repair verification at 16:33 KST

Both findings are closed for the reviewed source. No additional material defect was established in this scope. The parent reports that the integrated main/native source is `sha256:6faae6271793a8f80728301a66cf627cfc32b3da89678f63093cfcad8b549cff`; its newly started whole check is pending and is not a result of this review.

The final [24-path implementation manifest](page-api-portal-hashes.json) has owned-slice fingerprint `sha256:62036c45ac0b1fad0f066b11c6b866a163d9ae102638f31f613fdf3bb320e6bb`. The reviewer rehashed all 24 files at 16:32:47 KST and found no mismatch. The repaired reader is `f346bb9781c7bd44392821529dee9db9b2a70fb2ae35c1a1600bc07f8981ccd0`; coherent capture is `0db6ee493563dff2b0f34de47fcf7d6c3ececc4065c4a4caf60adb89a5f48c26`. These replace the original hashes above without changing the historical failed reproductions.

The additional reviewed parent-owned paths have these final hashes:

| Path relative to the native service copy | SHA-256 |
| --- | --- |
| `packages/cli/src/commands.ts` | `a727c8eefc675b8c87f020903681053804f875fa59b79e285ee7025a2e982747` |
| `packages/cli/src/browser-session.ts` | `f0d7e86bbdd81a1489f906c9c2d43fd00b27483866d7a6ce9bd4e24285261024` |
| `packages/cli/test/browser-observation-bounds.test.ts` | `388d3e5235b41209364473007c1ac770a83425b8526c8f92b021ed83fd81f2ae` |
| `packages/ir/src/inspection-v1.ts` | `b484f161d436540d2ca2c36abb8ce5f83e8fbdaa67390d957b50560a9cbf719e` |
| `packages/ir/test/inspection-v1.test.ts` | `26ca4d809bb63201cdded547a68466be968068bd35c66de45303d5e8e157d734` |

The repaired retained Chrome ports logically bound readiness using the existing absolute capture deadline and signal. The parent also changed `observeFigmaPage` itself to check cancellation/deadline before each RPC factory and after its result. This prevents a late response from dispatching subsequent locator/title/text requests. The default standalone observation limit is five seconds; portal calls supply their existing absolute capture deadline.

Session cleanup now starts the actual close/detach and waits at most five seconds, further bounded by the remaining capture deadline. An unconfirmed cleanup raises `PORTAL_CAPTURE_CLEANUP_UNCONFIRMED`; a shared fence blocks new page-API and Scripter captures until that cleanup resolves successfully. A rejected detach does not clear the fence. This is logical abandonment, not proof that a stalled CDP detach finished. The repair neither closes nor resets the user's Figma page. Shared connection shutdown remains owned by the existing capture owner. An otherwise complete capture with unconfirmed cleanup is rejected by the new regression.

The reader now transfers an acquired handle to its cleanup callback when the post-wait active check rejects. Cleanup starts once, is not awaited indefinitely after cancellation, and cannot replace the original cancellation result.

The reviewer reran both original source-import probes against the repaired source. The R1 output now fails before releasing the held locator, invokes session close once, and drains shutdown:

```text
{"checkpoint":"after-absolute-budget","readinessCalls":1,"deadlineAborted":true,"outcome":"DESIGN_CAPTURE_FAILED","closeCalls":1}
{"checkpoint":"after-cancel-and-close","outcome":"DESIGN_CAPTURE_FAILED","closeCalls":1,"shutdown":"closed"}
{"checkpoint":"after-readiness-release","outcome":"DESIGN_CAPTURE_FAILED","closeCalls":1,"shutdown":"closed"}
```

The original R2 probe now reports `acquired:1`, `disposed:1`, and the original `review-cancel` failure for every microtask offset 1 through 5. Offset 3, which previously leaked, now disposes exactly once.

A third source-import probe, `.worktrees/_cache/page-api-review-observation.mjs`, independently holds the first actual observer RPC and checks both cancellation and deadline expiry. It was run with the same Node transform/import-loader command as the earlier probes:

```text
{"mode":"cancel","checkpoint":"before-held-read-release","outcome":"review-observer-cancelled","calls":["initial-count"]}
{"mode":"cancel","checkpoint":"after-held-read-release","outcome":"review-observer-cancelled","calls":["initial-count"]}
{"mode":"deadline","checkpoint":"before-held-read-release","outcome":"The operation was aborted due to timeout","calls":["initial-count"]}
{"mode":"deadline","checkpoint":"after-held-read-release","outcome":"The operation was aborted due to timeout","calls":["initial-count"]}
```

No later browser RPC was dispatched when the held call eventually resolved. These controlled probes do not claim that a physically stalled renderer or remote transport was forcibly cancelled.

The reviewer executed the following final checks without changing service code or deadlines:

| Start time, KST | Command | Result |
| --- | --- | --- |
| 16:28:08 | `pnpm exec vitest run packages/cli/test/figma-page-reader.test.ts packages/cli/test/browser-observation-bounds.test.ts packages/cli/test/browser-observation.test.ts packages/cli/test/browser-source-open.test.ts packages/ir/test/inspection-v1.test.ts packages/mcp/test/portal/page-api-admission.test.ts packages/mcp/test/portal/page-api-flow.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/policy/operation-policy.test.ts` | **Failed:** 90 passed, 1 failed, 0 skipped across nine files. The reader's combined full-tree/catalog/PNG/SVG/2 MiB image case exceeded its existing 5,000 ms test limit; Vitest reported 6,106 ms. All other reader, portal, observer, policy and CLI/IR cases passed. |
| 16:29:08 | `pnpm exec vitest run packages/cli/test/figma-page-reader.test.ts` | **17/17 passed** unchanged in a quiet, isolated rerun. No assertion, test timeout or production limit was relaxed. |
| 16:31:27 | `pnpm exec vitest run packages/mcp/test/portal/page-api-flow.test.ts` | **8/8 passed** after the implementer's final explicit-return lint correction. Final test hash: `44bf0b671d5945503bfb4c03b65fe98a2911173bed9fd0bf9652b219ffc48c47`. |
| 16:31:40 | `pnpm exec vitest run packages/mcp/test/portal/native-work.test.ts -t 'reobserves page-api'` | **2 selected cases passed**; 41 unrelated cases were excluded by the name filter. Unchanged facts passed exact freshness and changed facts failed freshness, using the scoped page-API port. |

The failed nine-file run overlapped the implementation agent's focused suite. Concurrent load is a plausible contributor; this review did not collect a timing trace that proves it caused the timeout. The isolated pass does not retroactively change that failed result or establish whole-suite timing stability. The implementation agent separately reports 122/122 focused passes and passing typecheck/lint/format; those are attributed implementation evidence, not additional tests run by this reviewer.

The reviewer checked 29 source/test hashes at 16:28:18 and again at 16:29:51 without differences. The subsequent explicit-return correction changed only the page-API flow test and its manifest; that final test was rerun independently above. The final 24 implementation hashes plus five parent-owned hashes match the reviewed state. Further tests stopped before the parent's whole-check work, except for the already-running two selected NativeWork cases, which completed successfully.

## Inspected live evidence and limits

The parent controls live source Chrome. This reviewer read its retained service artifacts rather than operating that session:

- `.worktrees/_cache/cdd-page-api-20261011-r2/ly06O8jAcrd7oWmwhz5Vr6-1791700676330-554c8671/design.json` records 192 nodes, page and requested scope `1378:120`, `truncated:false`, and page API provenance. Its inspection manifest records all values/assets captured and no reference workspace code. The source receipt remains explicitly non-atomic and `fullCapture:false`.
- `.worktrees/_cache/cdd-page-api-comparison-20261011-r3/ly06O8jAcrd7oWmwhz5Vr6-1791702245345-cf7dc94e/capture-comparison.json` records matching independently collected page-API/Scripter facts: 192/192 nodes, 36,205 compared positions, and 25 verified asset files, with zero differences. It preserves `fullCaptureAccepted:false`. The comparator's implementation is being reviewed separately; this reviewer inspected its result, not an independently rerun comparison.

These artifacts support the actual page-global API's compatibility with this CDD scope. They do not establish public portal admission, eCommerce collection, complete application generation, guarded application, applied runtime checks, final live freshness, official-MCP acceptance, or a current whole-service pass. No current quota or endpoint availability claim is made.

## Continuation

1. The R1/R2 repairs and independent rechecks are complete. Preserve both the original failures and the final frozen hashes above.
2. Complete the parent's current-source whole/package checks for integrated source `6faae627...`; their result was pending when this review ended. The required Chrome census must include the reader fixture. Retain the focused timeout as evidence when assessing suite stability.
3. Execute the page-API route through the real authorized public portal and its unchanged generation, validation, application and final freshness gates. Preserve the ordered CDD-before-eCommerce acceptance and separate official-MCP/no-reference-frontend requirements.

No additional product decision is required for this scoped repair. External inputs for official MCP and later live cases remain recorded in the canonical service analysis.
