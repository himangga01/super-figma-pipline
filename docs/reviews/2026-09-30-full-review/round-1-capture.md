# Round 1 capture and plugin review

Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Static review, September 30, 2026. Paths below are relative to `service/packages/`. No tests, builds, browsers, native helpers or daemons were executed. No source or Git state was changed.

| ID | Severity | Current file and line | Older ID | User consequence |
| --- | --- | --- | --- | --- |
| CAP-01 | Medium | `cli/src/portal-commands.ts:197`; `mcp/src/portal/capture-source-admission.ts:58` | SVC-10, dedicated CLI part | Live Desktop planning through the dedicated command fails with TARGET_REQUIRED. |
| CAP-02 | Medium | `mcp/src/portal/design-evidence.ts:169` | No exact predecessor verified | Captured images above 5 MiB cannot be returned through the agent asset response. |
| CAP-03 | Medium | `mcp/src/portal/chrome-transport.ts:93`; `cli/src/browser-session.ts:134` | SVC-5 | A dropped Chrome connection remains unavailable until daemon restart. |
| CAP-04 | Low | `plugin/ui/relay/client.ts:1118`; `plugin/ui/composables/useRelaySession.ts:282` | No exact predecessor verified | Cancelled or disconnected calls remain visibly pending and keep the busy indicator active. |
| CAP-05 | High | `plugin/src/handlers/set-text.ts:24`; `plugin/src/handlers/clone-node.ts:11` | K19, cancellation part | An acknowledged cancellation during preflight can still be followed by a document write. |
| CAP-06 | Medium | `plugin/src/handlers/batch.ts:179`, `:193`, `:506` | No exact predecessor verified | Failed batches can flatten mixed typography while reporting BATCH_ROLLED_BACK. |
| CAP-07 | High | `mcp/src/portal/interaction-evidence.ts:179`, `:230`; `observation-manifest.ts:55` | SVC-2, narrowed | An unsupported reaction blocks planning even when the owner could reasonably exclude it from the requested C4 scope. |
| CAP-08 | Medium | `plugin/src/handlers/convert.ts:82`; `plugin/src/handlers/set-reactions.ts:22` | No exact predecessor verified | The advertised reaction round trip strips keys and action configuration. |
| CAP-09 | Medium | `plugin/src/serializer.ts:547`, `:569` | FID-6, generic serializer only | Generic reads omit top-level sizing modes and absolute-child constraints. |
| CAP-10 | Medium | `plugin/src/serializer.ts:694` | FID-8, mixed leading/tracking part | Generic reads omit runs when only line height or letter spacing is mixed. |

## Findings

### CAP-01: dedicated Desktop planning selects no target

**Trigger and consequence.** Run the dedicated `sfp portal plan` command with `design.source: "desktop"` and no current artifact, or require-live freshness. The command sends `targetSelector: { kind: "none" }`. Desktop admission requires a pinned plugin target and rejects this with `TARGET_REQUIRED`, so the otherwise authorized Desktop capture never begins.

**Trace and counterevidence.** `commands.ts:48` routes the dedicated command before the generic administrator handler. `portal-commands.ts:197` supplies the selector; `capture-source-admission.ts:58` rejects it. The coordinator requests live capture for missing evidence or require-live freshness. Generic `tools call portal_plan` has a working `portal-source` selector at `admin-commands.ts:377`. Existing artifact planning and Chrome planning are separate paths. This finding concerns the dedicated live Desktop command, not all Desktop access.

**Fix boundary and acceptance.** Use the same source-aware target admission as the generic command. Exercise the dedicated command through real admission with a pinned Desktop session, matching file identity and generation; require successful capture scheduling. Also reject absent, mismatched and changed sessions before capture. The inspected `portal-commands.test.ts` mocks invoke and expects the default none selector, so it does not prove Desktop usability. This is the current dedicated-command component of SVC-10.

### CAP-02: capture and response asset limits disagree

**Trigger and consequence.** Capture an original image between 5,242,881 and 16,777,216 bytes, then request its ID through `portal_next` asset delivery. Capture and verification allow it and persist its digest, but `readPortalAssets` constructs a `RepoReader` with `maxFileBytes: 5_242_880`. It cannot deliver that captured asset through the response path. Multiple individually valid assets can also hit the 20 MiB aggregate response budget.

**Counterevidence.** Original-copy submission at `coordinator.ts:1388-1403` allows 16 MiB per asset and 32 MiB aggregate. The asset is therefore usable by the digest-bound copy path; this is a response-reader limitation, not proof that the original asset is wholly unusable. The collector chunks image bytes and the inspected `capture-assets.test.ts` exercises seven 16 MiB originals through bounded batches.

**Fix boundary and acceptance.** Keep the exact original and its digest. Provide a bounded preview or an explicitly chunked artifact response, with the relationship to the original recorded; avoid simply inflating inline model responses. Capture a 6 MiB and a 16 MiB image, request preview/chunks and verify complete coverage, digest binding and unchanged original-copy behavior. Test aggregate requests and cancellation. No exact older finding was verified.

### CAP-03: terminal Chrome failure is permanently retained

**Trigger and consequence.** After attachment, close or restart Chrome, or let the remote websocket fail. `fail()` sets `failed = true`; `ensureRemote()` returns whenever that flag is set. A subsequent capture clears a disconnected Playwright browser but retains the same transport through `this.transport ??=`. New local connections see unavailable transport. Restoring Chrome alone does not restore the service; daemon restart does.

**Counterevidence.** The retained connection deliberately preserves a single pending Chrome permission request when a logical caller abandons it. The inspected Chrome transport tests prove that intended invariant and authenticate the local proxy; they do not cover remote failure followed by a new capture. Missing-tab recovery and local-client reconnection work while the remote transport remains healthy.

**Fix boundary and acceptance.** Distinguish a live pending permission handshake from terminal remote failure. On a new explicit capture, replace a terminally failed transport, rediscover the existing endpoint and respect Chrome's approval mechanism. Test a remote close followed by an explicit retry, endpoint replacement, pending-permission cancellation, denied attachment and cleanup. Preserve the forbidden tab-creation, navigation and browser-closure commands. Current SVC-5; medium because restart is a recovery workaround.

### CAP-04: cancellation leaves stale pending activity

**Trigger and consequence.** Dispatch a tool call, then cancel it or disconnect. The controller is aborted; both success and catch paths return before `settle` when aborted (`client.ts:1118,1131`). `abortPendingTools` clears actual pending work without settling its history entries. `useRelaySession.ts:282` derives busy from any retained pending activity entry. The row continues breathing and the sweep stays active until history eviction.

**Counterevidence.** Exact operation/action-nonce cancellation and late-response suppression are intentional and correctly checked. The inspected test at `relay/client.test.ts:1000-1061` asserts one exact cancel and no late response; it does not assert terminal activity or busy state. This is operator feedback, not evidence that the call still runs.

**Fix boundary and acceptance.** Settle each cancelled/disconnected row exactly once with a terminal outcome while continuing to suppress transport replies from abandoned work. Prefer live pending work for busy derivation. Cancel both a resolving and a rejecting deferred handler; disconnect during work; assert terminal rows, cleared busy, preserved call totals and no late wire response. No exact predecessor verified.

### CAP-05: handlers resume writes after preflight cancellation

**Trigger and consequence.** Cancel `set_text` while `loadFontAsync` is pending. Once the promise resolves, `set-text.ts:26` still writes characters. Similarly, cancel `clone_node` during lookup; `clone-node.ts:17` still clones after it resumes. The mutation wrapper checks cancellation at `mutation.ts:395,426`, before entering the handler, but cannot protect handler-internal waits. `code.ts:132-139` aborts and removes the active execution; the dispatcher suppresses the late result. The document can therefore change after the caller has received cancellation, without a late success reply.

**Counterevidence.** `create-variable` and `set-annotations` perform final prewrite checks; batch checks between child operations. Those patterns are sound. This is cooperative preflight cancellation, not a claim that synchronous native mutations already executing can be preempted.

**Fix boundary and acceptance.** Require an abort check after every asynchronous preflight and before its first write; for multi-stage handlers, check between awaited write stages. Integrate deferred fonts and node lookups with the actual sandbox cancellation bridge and assert zero writes after cancel, no clone, no late success and a valid Undo boundary for effects completed before cancellation. Existing set-text and clone tests check normal behavior, not this race. Current K19 cancellation component.

### CAP-06: mixed typography rollback reports a false clean restoration

**Trigger and consequence.** Start with a text node whose font size is mixed across runs. Batch `set_text_properties` to a uniform size, then force a later operation to fail. The inverse snapshots node-level `figma.mixed` at `batch.ts:179`, and `restorable` at line 40 excludes symbols. Undo at line 193 therefore skips the original font-size state. No inverse exception occurs, and lines 499-506 report `BATCH_ROLLED_BACK` despite the flattened typography remaining.

**Counterevidence.** Uniform typography rollback is covered by the inspected test at `batch.test.ts:351-401`. Per-corner and per-side scalar snapshots address some mixed geometry. The annotation inverse verifies its own write and detects readback/conflict; that recent T26 path is not reflagged. Text shortening and subsequent run-boundary loss were not proven here and are not included in this finding.

**Fix boundary and acceptance.** Either reject affected mixed properties during read-only batch capture or snapshot and restore complete per-run values with inverse readback. A test must model real per-run font sizes, flatten them, fail a subsequent child and assert byte-equivalent restored runs, or rejection before any effect. Restoration uncertainty must produce a partial-change outcome, never clean rollback. No exact older predecessor verified.

### CAP-07: every captured reaction is mandatory regardless of requested scope

**Trigger and consequence.** An otherwise usable pinned source contains a URL action or MOUSE_ENTER reaction that is outside the desired C4 implementation. `interaction-evidence.ts:68-91` implements a limited action/trigger set, line 133 marks unsupported semantics blocked, line 179 still assigns `required: true`, and line 230 makes the contract incomplete. `preparePortalObservationManifest` rejects any incomplete contract at line 55. There is no evidence-bound owner exclusion per reaction/root. Planning remains blocked rather than distinguishing requested obligations from advisory source details.

**Counterevidence and scope.** Rejecting an unsupported *required* interaction is sound. Missing captured destinations, temporal evidence and source-root identity must remain fail closed. The inspected tests cover supported navigation, missing destinations and motion separation. This report does not demand support for every Figma interaction or bypass all completeness checks. C2/C3 still require their complete relevant portals; only C4 is frontend-only. Capture's global completeness condition at `design-capture.ts:560-565` is a related limitation, but this finding's concrete trigger is mandatory reaction gating.

**Fix boundary and acceptance.** Define requested, evidence-bound scope and relevance before gating; allow explicit owner-recorded exclusions with reasons per reaction/root while preserving all required obligations. Test URL/MOUSE_ENTER outside scope reaching the appropriate C4 agent phase with advisories; the same interaction marked required must still block. Changed capture fingerprints must invalidate exclusions. This is the narrowed current SVC-2 product limitation.

### CAP-08: reaction write conversion drops fields preserved by reads

**Trigger and consequence.** Round-trip `get_reactions` output into `set_reactions`, as the public tool description recommends. The current reader clones complete bounded values, and shared/public schemas retain additional JSON fields. However, `convert.ts:82-96` keeps only type/timeout/delay on triggers and type/destination/navigation/url/transition on actions. ON_KEY_DOWN loses device/keyCodes; overlays lose relative placement; conditional and variable actions lose their payloads. Figma can reject the incomplete value or apply changed/default behavior when replacing the whole reaction array.

**Counterevidence.** Ordinary ON_CLICK navigation survives and is the only conversion scenario in the inspected set-reactions test. The read test explicitly preserves keyboard, overlay and conditional fields (`get-reactions.test.ts:10-52`). Transition contents themselves are passed through. This is a current read/write mismatch; no attribution to T01/T08/T09/T26 or a verified older ID is made.

**Fix boundary and acceptance.** Use a bounded, type-aware full conversion for supported actions/triggers, or reject unsupported fields before calling the setter. Do not silently strip accepted data. Round-trip the reader fixture through the public schema and handler and assert exact native setter values, including keyboard, placement, condition and variable payloads. Add native capability validation and unchanged preimage on rejected writes.

### CAP-09: generic serializer omits sizing and absolute-child constraints

**Trigger and consequence.** Read a top-level auto-layout frame using HUG sizing through `get_node`, `get_document` or full `get_design_context`. The serializer only emits layoutSizingHorizontal/Vertical inside `isAutoLayoutParent` at line 547, so a frame parented by a page loses its own sizing modes. An ABSOLUTE child of an auto-layout frame gets layoutPositioning at line 557 but skips constraints because they are in the mutually exclusive else branch at line 569. Consumers cannot reconstruct those responsive behaviors from the generic read.

**Counterevidence.** The canonical portal collector directly reads sizing and constraints (`shared/src/figma-capture-read.ts:114-126`); this does not establish loss in canonical pinned capture. Full design context faithfully projects fields already present in the serializer. Existing min/max bounds are outside the parent branch and are retained.

**Fix boundary and acceptance.** Emit supported own-axis sizing independently of parent layout; collect constraints for absolute children. Preserve parent-only fields where appropriate. Compare top-level HUG/FIXED and absolute STRETCH/SCALE child fixtures across generic node/context reads and the canonical collector. This is current FID-6, narrowed to generic read fidelity.

### CAP-10: mixed leading/tracking alone does not expand text runs

**Trigger and consequence.** A text node has uniform font, size, fills and case, with only mixed letter spacing or line height. The node-level values serialize to MIXED, but `needsSegments` at `serializer.ts:694-702` tests other mixed properties and never these two. No segments are returned, so generic node/context consumers lack the actual per-run values needed to reproduce typography.

**Counterevidence.** Mixed fonts, sizes, fills, case, decoration, partial links, wrap and multiline lists already trigger segments; their current support is not stale-reflagged. The canonical collector always requests lineHeight and letterSpacing text segments at `shared/src/figma-capture-read.ts:264-280`, so this finding is confined to generic reads and recipes using them.

**Fix boundary and acceptance.** Include mixed lineHeight/letterSpacing in the segment decision, with bounded run output. Test each property varying alone with every other property uniform and assert complete start/end coverage plus exact values in both get_node and full get_design_context. Current narrowed FID-8.

## Service assessment and invariants

The source admission and coherence design is materially stronger than a blind screenshot workflow. Desktop reads bind file identity, session and generation and revalidate the grant around read/export operations. Chrome attaches to an existing selected renderer, retains the owner permission handshake and forbids browser/tab lifecycle and navigation commands. The closed read programs, complete source reobservation, bounded capture attempts, image chunking and exact artifact hashes are important invariants.

The recipe runner retains owner-issued original operation IDs, exclusive local intent claims, server evidence and current readbacks. It does not treat checkpoint JSON as execution authority. The recent T08 workspace-root preservation and T09 retained recipe operation handling were read as current behavior and were not reflagged as unchanged old defects. Cancellation, transport recovery and reaction scope remain the main service usability risks. None of the static review establishes runtime or visual acceptance.

Secondary scoped observations for the second round: generic transform serialization still omits full transforms (FID-7); capture image reference discovery is IMAGE-only and requires closer VIDEO/PATTERN completeness review (FID-10); the approval panel fallback wording still merits the auth lane's SEC-1 review. These are not extra actionable findings without the second round's cross-lane closure. The embedded one-use pairing-code relaunch workflow also warrants focused workflow validation; fresh manual pairing is available.

## Inspected tests and coverage limits

All **223 assigned non-test files** were read completely, including production, handlers, protocol, UI and configuration. **11 of 176 assigned test files** were read completely: CLI capture-assets and portal-commands; MCP Chrome transport, design-evidence and interaction-evidence; plugin dispatcher, clone-node, set-text, get-reactions, set-reactions and progress-cancel. Assertions were inspected, never executed.

Three test files were targeted: batch lines 351-424; relay client lines 1000-1061; use-relay-session grep-only. The remaining **162 assigned test files have no body inspection in this round**. The coverage JSON contains every assigned path, exact line counts and literal outstanding ranges. No generated-file exception or metadata-only substitute was used to imply these tests were covered. Across the remaining test bodies, the second round must close 26,118 lines (26,254 before subtracting the two closed targeted intervals).

Cross-lane source reads, historical finding lookups and authority documents are also recorded in the JSON. Historical reports are comparison evidence, not current proof. The second round should challenge the narrow findings, fully inspect outstanding tests and look for missing cases in asset/video/pattern fidelity, schema conversion, approval copy and recipe response limits.

Recommended order: prevent post-cancel effects and false clean batch restoration first; repair dedicated Desktop admission and terminal Chrome recovery; add bounded asset responses and evidence-bound reaction scope; correct reaction conversion and generic serializer omissions; finish activity feedback. Preserve approval, target binding, required interaction and Undo guarantees while doing so.

