# Round 1 platform review

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Lane: platform security, concurrency, filesystem/state reliability and multi-client lifecycle.

This is a static review, not a runtime acceptance report. All 185 assigned files still match the baseline hashes in `source-manifest.json`. All 85 assigned production files were inspected completely. Seventeen assigned tests/helpers were inspected completely; 82 tests have targeted excerpts and precise unread ranges, and one generated contract received metadata inspection. The remaining test bodies must be closed in round two. No test, build, installation, native helper, browser, daemon, Docker or source/Git mutation was performed.

## Current findings

Paths in this table are relative to `service/packages/mcp/src/`. Severity P1 means a correctness or service-blocking defect requiring priority remediation; P2 means a bounded reliability or preservation defect.

| ID | Severity | Current path and lines | Older relation | Observable consequence |
| --- | --- | --- | --- | --- |
| R1-PL01 | P1 | `fs/atomic-file.ts:1927-1931,2005-2070,2074-2085` | OPS-2 remains current | A repeatedly updated target stops accepting new versions after 64 retained predecessors, or earlier at the byte cap. |
| R1-PL02 | P1 | `fs/atomic-file.ts:2121-2151,2174-2189` | Narrow concurrent-edit preservation defect; related to T07's filesystem invariants | A same-inode edit is moved away from its visible path, and ordinary replacement recovery cannot restore it. |
| R1-PL03 | P1 | `relay/relay.ts:205-214,762-771`; `execution/operation-executor.ts:1711-1781` | K7 / WS-4 remains current | A dispatched effectful plugin timeout becomes durable failed/no-output even when the plugin later completes an edit. |
| R1-PL04 | P2 | `execution/operation-journal.ts:828-837,1475-1488`; receipt store `:492-495`; egress store `:349-352` | Explicit pre-existing T09 limitation | A sweep can discard the only settlement link before evidence expires, retaining receipt/egress rows indefinitely. |
| R1-PL05 | P1 | `control/router.ts:443-451`; `index.ts:1362-1371`; `election/leader-endpoints.ts:246-256` | LC-6 / K25 remains current; T09 removed one trigger | One failed lazy control initialization poisons subsequent control requests for the generation while public ping continues answering. |
| R1-PL06 | P2 | `execution/native-evidence-artifact-port.ts:734-779` | New narrower metadata cleanup preservation defect; no attribution to T09 changes | Cleanup deletes a manifest edited in place after digest verification. Exported assets are outside this deletion path. |

### R1-PL01 — Successful replacement permanently spends retained-version capacity

**Evidence.** `fs/atomic-file.ts:1927-1931` defaults to 64 rows, 67,108,864 retained bytes and a 10,000-entry directory scan. The inventory at `:2005-2047` counts names for the target basename. `:2053-2070` rejects a new retained generation prospectively with `REPLACE_RETAINED_CAPACITY_EXCEEDED`. Successful publication at `:2074-2085` removes the prepared temporary alias but retains the previous version. There is no retirement path for these successfully superseded versions.

**Trigger and consequence.** Replace one ordinary target through more than 64 distinct old/new digest pairs. Its 65th replacement fails; sufficiently large versions hit the retained byte cap sooner. The row and byte limits are per target file, while the directory scan bound covers all entries. This affects long-lived records as well as workspace outputs. `security/document-binding-store.ts:118-125` uses the defaults. A targeted cross-lane read of `portal/store.ts:120-149` confirms ordinary run records use them too; recipe-hold and environment records use larger explicit limits and should not be described as sharing the 64-row default.

**Root cause.** A bounded crash-recovery residue budget is also a lifetime budget for successful updates.

**Counterevidence checked.** Prospective checks preserve the current target and deliberately fail closed. Crash recovery validates digests and supports retry of the same old/new pair. These safeguards are sound, but neither reclaims completed predecessor generations. `test/fs/atomic-file.test.ts:334-365` characterizes capacity refusal rather than sustainable repeated updates.

**Older relation.** OPS-2 is current in the baseline; this is not a new T01/T08/T09 regression.

**Bounded fix.** Retire only authenticated, fully superseded service generations after a durable commit/recovery proof. Retain unresolved crash predecessors and any recovery linkage still required. Define a small bounded history policy and reuse it across the relevant stores. Raising the caps or deleting every similarly named file would defer or violate the invariant.

**Meaningful acceptance test.** Perform thousands of distinct updates and restart at each publication seam. The latest bytes and MAC/checksum must remain valid, retained rows/bytes must stay bounded, pending recovery must still complete, and altered or foreign entries must remain untouched.

### R1-PL02 — Same-inode user edit loses its visible pathname during replacement

**Evidence.** `fs/atomic-file.ts:2121` verifies the expected content. The operation then creates/fsyncs its temporary and awaits hooks. After `beforeReplaceCommit` at `:2135`, `:2136-2143` verifies only file type, link count and identity. `:2146` renames the target to a name encoding the earlier digest. The post-rename digest check at `:2151` rejects an intervening in-place edit. The catch at `:2174-2189` keeps the retained file and does not restore the original pathname. Recovery at `:2088-2089` again insists that retained bytes match the old expected digest.

**Trigger and consequence.** Another owner process writes or truncates the target in place after the first digest check, preserving its inode. The identity check passes, the edited bytes move to `.replace-retained`, and the replacement fails. The original visible pathname can remain absent and a retry fails on the digest mismatch. The edited bytes survive in quarantine; this finding does not claim irrecoverable byte deletion. It does establish a visibility/recovery defect and potential source-data impact where callers replace workspace files.

**Root cause.** Identity continuity is treated as content continuity across an asynchronous window. The post-mutation error path conserves bytes but omits recovery of their visible location.

**Counterevidence checked.** A new-inode pathname replacement is detected, no-replace publication preserves a later winner, and post-quarantine failures carry a committed/outcome-unknown distinction. Those protections do not cover an in-place write. The fully inspected Atomic tests cover pathname swaps and crash boundaries but do not assert preservation of an in-place edit at this hook.

**Older relation.** Related to concurrent user-edit guarantees underlying T07; narrower than a stale accusation that Atomic always overwrites a new-inode winner. Attribution to a particular recent commit was not established.

**Bounded fix.** Add content proof at the latest commit boundary and a conservative recovery path that preserves the newly edited inode and restores visibility when the original path is still vacant, without replacing a foreign winner. Distinguish authored replacement success from recovery of foreign bytes. A second digest check alone is not an OS-level atomic compare-and-swap against an unrelated writer.

**Meaningful acceptance test.** In `beforeReplaceCommit`, write different bytes to the existing target with `writeFile` and verify the inode stayed the same. Assert those bytes remain at the original path, or a precise durable recovery state restores that path after restart, and never replace a foreign path winner. Cover edits of equal size, growth and truncation.

### R1-PL03 — Effectful dispatched timeout is durably reported as known failure

**Evidence.** `relay/relay.ts:205-214` takes the pending request and rejects a plain Error on timeout. `:361-371` records dispatch before sending. An authenticated late result is discarded at `:762-771` once the pending entry is gone. In `execution/operation-executor.ts:1711-1762`, the absence of `committed: true` and `runtimeCompleted` leads a still-dispatched operation to `durableFinalizer.fail` with a no-output manifest. The finalizer at `:455-498` writes the failure receipt/finalizer and failed journal transition.

**Trigger and consequence.** An effectful plugin method exceeds the relay deadline after actual dispatch and later finishes. The journal and evidence record known failed/no-output while a Figma edit exists. A subsequent fresh operation can repeat the effect based on that false certainty. This is not a claim that the existing operation ID is automatically replayed: the issuer, journal, replay fingerprint and completed cache protect that separate case.

**Root cause.** Transport loss of response is converted to a runtime failure without preserving whether an effectful request was dispatched or whether absence of effects was proved.

**Counterevidence checked.** Explicit dispatched cancellation/demotion settles outcome-unknown. `PLUGIN_PARTIAL_CHANGE` and `UNDO_FAILED` errors carry `committed: true` at `relay.ts:774-786`. Typed committed runtime failures are covered by the executor test declarations and source branches. The timeout path supplies none of this disposition. Pre-dispatch queue timeout is a different no-effect case and should remain distinguishable.

**Older relation.** Current K7/WS-4 behavior. T01/T08/T09 do not repair this path.

**Bounded fix.** Propagate a typed disposition from relay through the pinned runtime: not dispatched, definitively no effect, or dispatched with uncertain effects. For effectful dispatched timeout/disconnect without a definitive no-effect response, persist unknown journal/egress outcome and prohibit blind replay. Retain late-response identity binding; a late response must not silently turn a contradictory durable failure into success.

**Meaningful acceptance test.** A paired fake plugin accepts a real effectful invocation, waits beyond the relay deadline, applies one edit and sends a late successful response. Assert unknown terminal/evidence state, no no-output failure receipt, no automatic replay, and restart continuity. Also assert a timeout before dispatch produces known no-output.

### R1-PL04 — Journal expiry can remove the only evidence-retention clock

**Evidence.** `operation-journal.ts:1475-1488` sets tombstone expiry to `issuedAt + 2,592,000,000`. `:828-837` returns null once neither active row nor tombstone exists. Receipt compaction at `operation-evidence-receipt-store.ts:492-495` and egress compaction at `egress-manifest-store.ts:349-352` retain rows with null linkage and expire others relative to their settlement time. `index.ts:870-935` uses the journal settlement callback under the retention/hold authority.

**Trigger and consequence.** An operation has nonzero duration and a sweep falls after issued-at plus 30 days but before settled-at plus 30 days. Receipt/egress compaction correctly retains the not-yet-expired rows, then tombstone purge removes the settlement link. Later sweeps see null and retain them indefinitely. Over time, hard-capacity stores reject admissions. The finding is a bounded long-term leak/capacity issue, not an immediate startup failure.

**Root cause.** The authoritative settlement record has a shorter horizon than records whose eligibility depends on it.

**Counterevidence checked.** T09 correctly orders successful compaction before tombstone purge and skips purge after compaction failure. It correctly protects held and unresolved evidence. Ordering cannot fix this interval because the evidence has not expired at the first sweep. T09's historical report explicitly acknowledges this pre-existing limitation. The inspected retention tests use 31-day advances or supplied linkage; they do not cover two sweeps straddling these distinct clocks.

**Older relation.** Explicit T09 limitation; distinct from the repaired LC-1 startup-isolation bug and not introduced by its sweep extraction.

**Bounded fix.** Align settlement-link lifetime with dependent evidence, or add a durable settlement index/deletion handshake proving that every dependent record is eligible and cleaned before unlinking the clock. Preserve active holds, unresolved outcomes, pre-runtime reservations and recovery linkage. Null cannot simply mean permission to delete.

**Meaningful acceptance test.** Use a nonzero operation duration, sweep inside the mismatched interval, restart, then sweep beyond settlement plus 30 days. Eligible receipt/egress records must eventually compact while held, unknown and not-yet-linked records remain protected.

### R1-PL05 — Rejected lazy control initialization stays rejected forever

**Evidence.** `control/router.ts:443-451` caches `factory()` with `initialized ??=` and never clears a rejected promise. By contrast, `GenerationRuntimeLifecycleRegistry` at `execution/execution-plane.ts:312-315` removes rejected initialization state, permitting retry. `index.ts:1362-1371` logs eager runtime initialization failure. Public ping at `election/leader-endpoints.ts:246-256` is served independently of successful runtime initialization.

**Trigger and consequence.** The first authenticated control request encounters a runtime factory failure. Subsequent control requests await the same rejected promise even after the underlying condition is corrected, including when another entry successfully initializes the same generation. The leader stays reachable by public ping and the control API remains unusable until the handler/generation is replaced. Routine liveness therefore does not establish readiness.

**Root cause.** Successful single-flight caching also permanently caches failure, inconsistently with the generation registry's recovery semantics.

**Counterevidence checked.** The fully read body `test/execution/execution-plane-lifecycle.test.ts:218-232` asserts that rejected registry initialization can retry. The read body `test/control/control-router.test.ts:169-179` asserts only successful lazy initialization coalescing; it does not exercise rejection. T09 removed the deterministic old retention-startup trigger but ordinary transient or partial initialization failure remains possible.

**Older relation.** LC-6/K25 remains current. Do not label repaired LC-1 as the trigger in the current code.

**Bounded fix.** Clear only the failed lazy flight, allow a bounded subsequent single-flight retry, and reconcile/dispose any partially initialized durable authorities before reuse. Represent runtime readiness through an authenticated health surface and clear service errors. Any handoff or availability improvement must retain admission closure and the mandatory durable generation fence.

**Meaningful acceptance test.** The same lazy handler's first factory call fails; a later call succeeds after the condition is corrected. Concurrent retries invoke one factory, all later requests use the recovered handler, and the health surface distinguishes reachable from ready. Include a failure after partial durable recovery and prove that no second authority or obsolete generation timer remains live.

### R1-PL06 — Native manifest cleanup ignores in-place edits after hashing

**Evidence.** `native-evidence-artifact-port.ts:734-745` hashes and validates manifest bytes. It then awaits `beforeCleanupCommit` at `:746`, checks only inode/type/link count at `:747-755`, and renames at `:760`. After fsync and another asynchronous hook at `:768-770`, `:771-778` checks descriptor/path identity, then unlinks at `:779`. It does not reread the content at either final boundary.

**Trigger and consequence.** An owner process edits `native-manifest.v1.json` in place after the initial hash or during the quarantine fsync window. The inode remains unchanged, so the edited metadata is deleted. This is confined to service evidence manifest metadata; the exported images/PDFs/assets recorded inside that manifest are not unlinked by this code.

**Root cause.** A content-authorized cleanup operation validates subsequent identity but not subsequent content before irreversible deletion.

**Counterevidence checked.** Retained-directory authority, descriptor binding and pathname replacement checks protect different identities and ancestry. `test/execution/native-evidence-artifact-port.test.ts:346-385` replaces the pathname by rename followed by writing a new inode, and correctly expects preservation. Its fully inspected bodies do not test an in-place manifest edit in these cleanup windows. Result artifact cleanup has stronger final synchronous content checks at `fs/operation-evidence-artifact-store.ts:1215-1283,1333-1348`; it should not be accused of this same unconditional delete.

**Older relation.** New narrow cleanup preservation finding, sharing the identity-versus-content theme of R1-PL02. No recent-change regression attribution was established.

**Bounded fix.** Revalidate manifest content through the held descriptor immediately before deletion, after the final asynchronous boundary, and preserve altered metadata for explicit owner/manual resolution. Keep digest/context and directory proofs. Do not widen cleanup to exported assets or assume an owner-only state ACL prevents the owner from editing workspace metadata.

**Meaningful acceptance test.** Use both `beforeCleanupCommit` and `afterNativeQuarantineFsync` to write different bytes through the same inode. Cleanup must refuse deletion and leave edited bytes visible or precisely recoverable after restart. Assert assets stay unchanged, and retain the existing new-inode replacement tests.

## Integrated fix assessment and sound invariants

**T01.** The assigned lease broker/helper code implements ASCII-only protocol v2, exact UTF-16LE path bytes, digest echo checks, explicit streams, fixed System32 execution paths, separate startup/request budgets, bounded diagnostics and pool retirement. Restricted hosts fail closed without a lease-free fallback. The fully inspected lease tests cover codec, echo mismatch, restricted children, budgets, backpressure, termination ownership, local Korean/NFD/surrogate/long paths, and an opt-in soak. Those tests were not executed. Real UNC shares, WDAC/AppLocker/AMSI host enforcement, helper latency and process drain still require native validation. No current evidence supports reusing the old claim that Korean paths universally break the repaired lease protocol.

**T08.** The production store preserves bound and legacy-unbound rows; read operations do not adopt missing/recreated roots or rewrite legacy state. Per-row availability isolates unrelated registrations. Policy targets the selected row, and rebind requires nonce-bound registration revalidation and the unsettled-operation guard. The fully inspected workspace tests/characterization exercise these properties. Removing or re-binding an unknown-outcome workspace must continue to fail until settlement; this safeguard is intentional.

**T09.** Initialization schedules retention after successful runtime assembly. Cleanup is batched under fresh hold scopes, supports abort, isolates failed intents/workspaces, records durable retry counts and terminal quarantine, and detaches snapshot/grounding-graph receipts without deleting their user-managed files. The focused fully read tests, including built-daemon acceptance source, support this scoped repair. They were not run; the built test skips when dist is missing. R1-PL04 is explicitly separate. Deferred unavailable-workspace intents can keep a bounded log alive; quarantined on-disk evidence and user-managed snapshots/graphs can require owner cleanup.

**Security and concurrent lifecycle.** Keep Host/Origin gates before authentication; Origin is not identity. Current follower authentication uses current-generation challenge proofs and AEAD bindings, and the transport verifies record order and terminal EOF. Keep actor/auth-session/generation/action/request nonce bindings, exact plugin session/generation pins, no raw argument/result persistence in journal authority, and prepared receipt/finalizer reciprocal links. The resource queue acquires declared resources atomically and permits disjoint progress; it does not grant authorization. Demotion closes admission before fencing and refuses port release when mandatory durability fails. These are safety properties, and a stuck-port availability fix must preserve them.

Owner-only ACLs protect against other accounts. Retained handles and boundary checks protect specified paths and lifetimes. A working copy, module fence or same-account native process is not a complete OS sandbox: it shares the owner's filesystem/process/network privileges, and a same-owner process can modify file contents in place. R1-PL02 and R1-PL06 reflect this actual protection limit.

## Inspected tests and coverage limitations

Complete assigned tests/helpers inspected, all statically:

- `test/fs/atomic-file.test.ts`, `windows-directory-lease-broker.test.ts`, `workspace-config-store.test.ts`, `workspace-config-store.characterization.test.ts`, `workspace-registration-atomicity.test.ts`, `workspace-registration-resolver.test.ts`, and `workspace-usage-guard.test.ts`.
- `test/execution/file-queue.test.ts`, `mcp-workspace-binding.test.ts`, `native-evidence-artifact-port.test.ts`, `operation-evidence-receipt.characterization.test.ts`, and `retention-sweep.test.ts`.
- `test/control/control-status.test.ts`, `test/e2e/retention-startup.test.ts`, `test/e2e/_helpers.ts`, `test/plugin-contract.ts`, and `test/tool-schema.ts`.

The coverage JSON lists every assigned file and exact read/uninspected line ranges for the 82 targeted test files. No assigned production lines remain uninspected. Targeted test declarations identify intended contracts, not proof of their implementations or acceptance assertions. The generated `test/plugin-contract.json` was parsed for floor, inventory and array shape and matched to its baseline hash; its individual argument rows and derived parity were not accepted as reviewed.

Round two should first close the uninspected bodies of `operation-executor.test.ts`, `execution-plane-lifecycle.test.ts`, `operation-journal.test.ts`, `operation-evidence-receipt.test.ts`, `operation-evidence-artifact-store.test.ts`, `relay.test.ts`, `control-router.test.ts`, `follower-transport.test.ts`, and pairing/network tests; the coverage JSON contains exact ranges rather than a sampling disclaimer. It should then close every other targeted body and contract metadata gap.

Cross-lane dependencies were followed at call sites as needed, including targeted `portal/store.ts:110-153` and source searches for SnapshotStorage, GraphStorage, design-diff and native-work Atomic replacement callers. This does not claim full coverage of those other lanes. Historical T01/T08/T09 review evidence and the current scope/remediation plans were consulted; their earlier command results were not reproduced.

Other older allegations were not promoted without a complete current proof: the narrow queued-cancel/dispatched append interleaving, pairing limiter/history capacity behavior, and larger admission/performance questions need round-two challenge. Required generation-fence failures, conservative result-egress denial, unavailable workspace refusal and explicit store capacity errors must not be changed into permissive fallback behavior merely to improve availability.

## Recommended order

1. Repair R1-PL03 uncertainty classification and challenge cancellation/demotion races without permitting replay.
2. Repair R1-PL02 edit visibility/recovery and R1-PL06 metadata cleanup preservation before adopting any automatic retained-generation deletion.
3. Repair R1-PL01 sustainable authenticated generation retirement while keeping crash recovery and foreign-file preservation.
4. Repair R1-PL05 failure retry/readiness while keeping durable fence ownership.
5. Repair R1-PL04 retention-link horizons and validate long-duration, held and unresolved evidence.
6. Complete the explicit test-body gaps, then perform native validation in a separate working copy with its actual owner-account protection limits stated.

The parent session independently revalidated the six preliminary paths. This report is round-one evidence; final remediation acceptance still depends on the parent dispositions and round-two challenge.
