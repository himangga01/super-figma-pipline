# Limited review: Figma Web Copy as collector

Analysis date: October 11, 2026 (Asia/Seoul), approximately 14:18 KST.

This is a limited independent review of the uncommitted Copy as collector and its same-file node-navigation grant. It is not either required final whole-service review and does not establish live asset capture or frontend acceptance. The canonical authority remains [the service analysis](../../service-analysis.md), with [the continuation record](README.md) and [repository instructions](../../../AGENTS.md).

## Baseline and scope

The main checkout is on `main` at `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted implementation and documentation changes. The reviewed native copy is `.worktrees/baseline/service`, whose detached Git baseline is `6459363354f52940b4c67e399b9e735d7332d4dc`. Its five listed tracked files are modified and `figma-web-copy.ts` is untracked. These hashes identify the actual reviewed bytes; neither checkout's HEAD alone identifies this implementation.

| Native service path | SHA-256 |
| --- | --- |
| `packages/cli/src/figma-web-copy.ts` | `2f1410f69be66f2f2d16fbde5c48145bc0aa8826d6e0127603f14c6ffdd5423e` |
| `packages/cli/src/commands.ts` | `a9f3a53872c891d61323296c32e62e658982049c1ca33a1a17f09daf80d7680b` |
| `packages/cli/src/browser-session.ts` | `a1a2453dd5d40a1d714f4fd078534eeb9760814bee883aff790dd7211dc9996a` |
| `packages/mcp/src/portal/chrome-transport.ts` | `6126a02ba32adb6912655c8596b282210000bc4656b2c81d2e996491b569101c` |
| `packages/cli/test/figma-web-export.test.ts` | `1d4ca15d54d79116dc08b1f99317e4b560e30be00412b0d1e5cc417157070e55` |
| `packages/mcp/test/portal/chrome-transport.test.ts` | `e44a6b619bb21eab62d058cc2ae461bb784113bb7e37acbdc9ff196ee8bdfe0a` |

The parent agent owns these production and test files and is continuing repairs. This report describes only the hashes above. No production files were edited by this reviewer. Subsequent repairs need their own source hashes and verification evidence before findings can be closed.

## Purpose and implemented structure

The service converts authorized Figma sources into generated applications with source-bound collection and validation. This addition supplies supplemental SVG/PNG assets independently of Scripter. The standalone `chrome-copy` command requests one explicit node selection, waits for the Figma editor, then invokes `copyFigmaWebAsset`.

The collector wraps the selected page's `navigator.clipboard.write`, `writeText`, and `DataTransfer.prototype.setData`; it does not call a clipboard read API. Matching bytes are retained in page-local state and transported in 256 KiB chunks. It creates a local asset and metadata using the atomic file store, records a digest and PNG dimensions, and declares `fullAssetAcceptance: false`. Descriptor restoration attempts to preserve the original clipboard methods. The transport validates a same-file Figma node URL and grants an exact-URL `Page.navigate` once on the scoped root session.

## Findings

### WC-1: URL identity does not establish the actual selected node

Priority: P1. Status: open at the reviewed source; parent is repairing it.

`figma-web-copy.ts:20-25` checks only the browser URL. Line 96 then presses Escape before opening the menu. A node URL can remain present while the editor has no selected layer, so passing this check is insufficient to bind copied bytes to the recorded `nodeId`. The command also skips navigation whenever the URL already contains the desired node (`commands.ts:403-404`), even if the actual selection has changed.

The parent reported fresh service-owned live evidence during this review: the failed attempt showed the Page sidebar and disabled duplicate action after the unconditional Escape, while the URL retained the node ID. This reviewer did not operate Chrome or independently inspect that live artifact; this is explicitly parent-provided evidence consistent with the code defect.

Remove unconditional selection-clearing actions and verify an independently observed, exactly matching single selected-layer identifier immediately before the explicit Copy as action. Fail closed for absent, ambiguous, or changed selections. Recheck the selection before publication. A matching URL should remain a file/navigation guard, not be the sole selection proof. Preserve the failed live attempt and test a fixture where URL and actual selection disagree.

The same parent-provided live observation showed the submenu label `Copy as`, whereas line 105 accepts only `Copy/Paste as` and the Korean variants. Update the selector from the observed UI and preserve a regression. This selector mismatch is a live usability failure, distinct from selection provenance.

### WC-2: An unfinished asynchronous copy can publish before ambiguity is detected

Priority: P1. Status: reproduced independently at the reviewed source.

`figma-web-copy.ts:53-75` retains the first matching ClipboardItem before awaiting later items. The polling loop at lines 118-132 treats any nonzero byte count as completion. It has no pending-call/completed-transaction state. The chunk loop and final publication do not recheck the hook's error state.

A browser-free Node VM harness executed the unchanged collector implementation after TypeScript stripping, with a mocked Page and in-memory AtomicFileStore. The requested write contained two SVG ClipboardItems: the first resolved immediately and the second after 600 ms. The collector returned successfully and wrote both artifact records before the write hook settled:

```json
{"accepted":"figma-web-copy","writeSettledAtReturn":false,"filesWritten":2}
{"writeEventuallySettled":true}
```

The second item eventually sets `FIGMA_WEB_COPY_AMBIGUOUS`, but the success result has already been published and cleanup has removed the state. This is a control-flow reproduction, not a statement that live Figma currently emits multiple ClipboardItems.

Track in-flight writes and their settled result. Freeze one validated payload only after the requested write completes, reject late or additional matching captures, and recheck the terminal state before publication. Add delayed-second-item and rejected-`getType` regressions. Do not equate availability of the first bytes with completion of the requested copy.

### WC-3: The deadline cannot terminate a stalled browser operation

Priority: P1. Status: reproduced independently at the reviewed source.

The collector checks the deadline between operations, but initial hook installation, polling, chunk extraction and restoration all await `page.evaluate` without an enforced remaining-time/abort race (`figma-web-copy.ts:30`, `122`, `137`, `209`). The finally block can therefore hold the caller indefinitely even after an earlier timeout or error. The Escape keyboard call is also unbounded. The new CLI navigation uses a fixed 30-second timeout instead of the remaining invocation budget (`commands.ts:404`).

In a browser-free mock where the initial `page.evaluate` never resolves, a 25 ms deadline was still pending at 151 ms:

```json
{"deadlineMs":25,"observedMs":151,"outcome":"still-pending"}
```

This proves that the supplied deadline does not bound an in-flight call. It does not establish how often Chrome actually stalls.

Apply a shared remaining-time and abort bound to browser operations, and a separately bounded cleanup path. Preserve an explicit cleanup-unknown result if restoration cannot be confirmed. A Promise race alone cannot cancel work already sent to Chrome; record that limit, avoid publishing success after it, and do not replay an unknown-outcome Copy as action automatically. Pass the remaining budget to navigation and readiness operations as well.

### WC-4: Legacy clipboard preservation remains unverified

Priority: P2. Status: confirmed forwarding behavior; actual system clipboard impact untested by this reviewer.

`figma-web-copy.ts:81-85` suppresses matching SVG text in `DataTransfer.setData` but forwards every other MIME representation. It does not own or cancel the whole browser copy event. An SVG copy event can include both HTML and plain text, so interception of one representation is not proof that the system clipboard remains unchanged.

A browser-free harness emitted `text/html` followed by matching SVG `text/plain` through one DataTransfer. The collector succeeded while the original method received the HTML representation:

```json
{"legacyAssetAccepted":"figma-web-copy","forwardedDataTransferTypes":["text/html"]}
```

The existing test uses a detached `new DataTransfer()` and stubs the async clipboard methods. It proves hook restoration and matching-payload interception in that fixture, not browser copy-event or physical clipboard preservation. The wrong-text fixture intentionally forwards to the original `writeText` and does not assert preservation for that path.

Either implement and verify whole-event interception for the explicitly requested legacy copy, or narrow the claim to what the implementation and tests establish. Preserve unrelated user copy behavior deliberately, with a defined active capture window. No clipboard read was performed by this reviewer.

## Target isolation and acceptance claims

The reviewed navigation grant is scoped to the root attachment's CDP session and the exact authorized URL. It is consumed on use. The validator restricts both URLs to HTTPS Figma design/file URLs, the same file key, and one syntactically valid node query. Focused fake-CDP tests reject an unrelated session, another URL, reuse, a different file, missing node, extra query parameters and an external host. I found no actionable widening of that exact navigation grant in the reviewed change.

That result is not an adversarial audit of every CDP command or proof of an OS security boundary. Selection state and page content still require the guards described above.

The output's `fullAssetAcceptance: false` and PNG scale limitation are appropriate. A local digest identifies retained bytes; it does not establish that those bytes depict the requested node or match an independent source snapshot. PNG signature/IHDR/dimension checks are not complete PNG decoding, and SVG prefix/suffix checks are not complete SVG validation. Keep these outputs supplemental until source binding, independent dimensions/render comparison and actual capture-admission checks succeed.

## Verification and limits

Read the shared analysis policy, project instructions, current canonical analysis and October 10-11 continuation record before reviewing the scoped files and diffs. The historical whole pass at `f975a577...` predates this change and does not cover it.

Executed from the separate native working copy:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/chrome-transport.test.ts --maxWorkers=1
```

Result at 14:18 KST: 1 file passed, 23 tests passed, no skips or failures. This suite uses fake CDP servers. Three browser-free VM probes described above exercised unchanged collector control flow with in-memory file writes and mocked browser primitives. Preliminary harness syntax/mock-return mistakes were corrected before the reported probes; they were not service failures.

No live browser operation, clipboard read, daemon restart, full suite, build, source reconciliation, official MCP probe, portal run, frontend acceptance, commit or push was performed by this reviewer. The parent separately owns live attempts and source repairs. Native validation runs with the Windows owner's permissions in a separate working copy, not in an OS sandbox. No Docker or Codex browser/Figma connector was used.

## Continuation

Repair WC-1 through WC-3 before treating this collector as reliably usable. Add the delayed transaction and stalled-operation regressions, resolve or explicitly limit WC-4, and preserve live failure evidence. Rehash and re-review the final files after parent changes. Then run service-owned live SVG and PNG capture on an explicitly observed selected node, compare independent rendering and scale facts, and keep full asset/frontend acceptance false until its separate gates pass.

The parent should link this bounded review and its repair status from the continuation record and canonical service analysis. No competing canonical analysis authority is introduced here. Remaining product question: whether legacy copy preservation is a supported guarantee or an explicitly bounded limitation; the current fixture does not answer it.

## Bounded repair follow-up at approximately 14:24 KST

The parent changed the collector during review. The follow-up probe ran at collector SHA-256 `d1f3de5cab3063e1da8502bbad206a2e4e7e31c1d10a4eadb3111891ed912826`. Preserve the original findings and hashes above; this follow-up is not a replacement whole-source review.

At the parent's request, the browser-free harness is preserved as [web-copy-review-probe.mjs](web-copy-review-probe.mjs). It reads and prints the collector source hash, strips TypeScript, uses the service's actual `logical-wait.ts` implementation, and substitutes in-memory files and browser primitives. Run from the repository root:

```text
node --disable-warning=ExperimentalWarning docs/testing/2026-10-10-continuation/web-copy-review-probe.mjs
```

Successful adapted-probe results:

```json
{"probe":"delayed-second-item","rejected":"FIGMA_WEB_COPY_AMBIGUOUS","writeSettled":true}
{"probe":"legacy-mixed-mime","accepted":"figma-web-copy","forwardedDataTransferTypes":["text/html"]}
{"probe":"stalled-evaluate","deadlineMs":25,"observedMs":29,"outcome":"rejected"}
```

The specific WC-2 race and WC-3 stalled-evaluate reproduction now reject correctly at this hash. This does not verify all cleanup-failure, delayed-installation, navigation-deadline or live-browser cases. The added renderer expiry restoration is best effort when the renderer cannot run. Preserve unknown cleanup outcomes explicitly. The saved harness initially required adaptation to newly added APIs; its intermediate missing mock-method errors are not service failures and are not evidence of repair.

WC-4 remains an implementation limitation, now explicitly represented by `clipboardEffects`. WC-1 remains an identity limitation: the result now records `selectionBinding: requested-node-url-only-unverified`, which accurately limits the claim.

I read the parent's service-produced R2 failure JSON and R3 success metadata directly from the private cache. R2 confirms `Copy as` in the menu and Page sidebar with no selected layer. R3 metadata is at `.worktrees/_cache/live-cdd-copy-20261011-r3/ly06O8jAcrd7oWmwhz5Vr6-1791696033394-d351fb64/sfpCopyb138bde46e5b1f804eaad381608a3b3d.json`. It records a PNG with 26,827 bytes, dimensions 1306 by 384, asset digest `sha256:7236c4153e7c508363207b0952901fde6a54e0650d77d36885c4041a60b2495d`, and `fullAssetAcceptance: false`. This reviewer read metadata but did not rehash or decode that PNG.

R3's saved layer attributes show exactly one observed selected row, named GUIDE, with `aria-selected=true`, `data-fpl-selected=true` and `data-fpl-selected-root=true`. The other two observed rows are unselected. None of the recorded attributes identifies the Figma node ID. These facts support a selected-row existence/stability guard. They do not justify a fabricated node-ID selector or equating a row index with a Figma node ID. Names and dimensions can corroborate a target but can coincide for different nodes. Any later selected-row repair requires a new hash and its own regression/live evidence.
