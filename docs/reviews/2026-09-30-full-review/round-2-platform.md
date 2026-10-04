# Round 2 platform, security and concurrency challenge

Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Date: September 30, 2026. This is the existing contracts reviewer's second turn with a rotated platform/security/concurrency perspective, not a fresh reviewer identity. Review is static: no tests, builds, installations, repository helpers, browsers, daemons, source changes or Git mutations were run.

The nine assigned canonical findings survive with the bounds below. No additional independent canonical defect is asserted. R2-PL06 extends F16 to the normal sandbox bridge timeout path and specifies actual timer ordering. The companion plain-array coverage record closes all 41 `closure.platform` files: 663,173 bytes and 17,557 lines, with complete bounded body reads. Production cross-reads are recorded separately with exact inspected and uninspected ranges.

| R2 ID | Severity / relation | Production evidence | Challenge disposition and fix revision |
| --- | --- | --- | --- |
| R2-PL01 | High; confirms F03 / M01 | `portal/store.ts:120-149`; `fs/atomic-file.ts:1927-1930,2004-2071` | Ordinary signed run/apply records retain distinct old generations until the 65th prospective replacement exceeds the per-target row cap. Reclaim proved obsolete generations; increasing the cap is insufficient. |
| R2-PL02 | High; confirms F08 / M01 with explicit limits | `fs/atomic-file.ts:2121-2151,2174-2194` | An in-place edit between digest verification and rename passes inode checks; post-rename digest rejection leaves the edited file at the hidden retained path. Use absence-only restoration or explicit owned recovery disposition, never overwrite a successor. |
| R2-PL03 | Medium; confirms narrowed F21 / M01 | `execution/retention-sweep.ts:94-117`; `execution/native-evidence-artifact-port.ts:555,734-779` | Cleanup can delete edited private native-manifest metadata after its initial hash check. Exported assets and arbitrary source are outside this deletion path. Preserve unverifiable metadata and truthful disposition. |
| R2-PL04 | Medium; confirms F07 / M04 | `execution/operation-journal.ts:828-836,1488,1554-1555`; `index.ts:874-877` | Issuance-horizon purge can remove the settlement link before receipt/egress settlement-horizon expiry. Retain independent settlement authority without extending operation-ID authorization. |
| R2-PL05 | High; confirms narrowed F22 / M10 | `index.ts:1330-1331,1353,1412`; `control/router.ts:443-451`; `execution/execution-plane.ts:312-314` | Only the outer registered control handler permanently caches rejection. The generation initializer already evicts failed attempts. Fix the owning outer cache while preserving authentication, generation fences and successful single-flight. |
| R2-PL06 | High; extends F16 / M11 | `shared/src/tool-budgets.ts:18-25,47-66`; `plugin/ui/sandbox/tool-bridge.ts:113-118`; `plugin/ui/relay/client.ts:1117-1142`; `operation-executor.ts:1732-1761` | The normal inner timeout also reaches failed/no-output without proof of zero effects. Carry typed timeout/effect uncertainty through bridge, Relay and durable finalization; no blind replay. |
| R2-PL07 | Medium / High; confirms F25 / F26 / M11 | `plugin/ui/relay/client.ts:911-931,1118,1131,1254-1275`; `plugin/src/handlers/set-text.ts:24-26`; `clone-node.ts:10-14` | UI activity and effect lifetime differ. Settle abandoned activity honestly, retain active grants, and add final cooperative checks after awaited preflight. |
| R2-PL08 | High; confirms F39 / M15 | `scripts/update-service-forks.mjs:546-550,806-840,447-465,392-402` | A staging snapshot taken after derivation accepts a concurrent maintainer edit as expected-old, then replaces it with stale derived bytes. Bind all three authority inputs at the original reads and preserve recovery conflicts. |
| R2-PL09 | Rejected broad security claim; no new F ID | `index.ts:1052`; `policy/approval-prompt.ts:79-85`; `plugin/ui/components/TabApprovals.vue:30`; `approval-gate.ts:8-12` | Native execution is explicitly disclosed in the target label and authorized through the selected channel. Generic effect wording remains a usability concern, not evidence of concealed native execution. |

All paths in the table are under `service/packages/mcp/src` unless prefixed with `shared`, `plugin`, or `scripts`; those prefixes denote the corresponding `service/packages` package or `service/scripts`.

## R2-PL01–03: bounded ownership and preservation, not absolute filesystem exclusion

F03 is production-reachable for ordinary PortalStore kinds. Recipe holds and environment records have separate configured limits, but ordinary run/apply state receives the default 64 retained rows. Each distinct expected/new digest pair creates another retained filename. The prospective row check rejects before the next replacement. Row/byte accounting is per target basename; directory scan accounting is shared. Existing recovery retains old bytes deliberately, so deleting every retained file after success would remove recovery authority.

F08 is a narrower preservation failure than arbitrary external deletion. Verification at line 2121 establishes old bytes, asynchronous preparation/hook work follows, and line 2136 checks regular-file identity rather than current digest. A same-inode edit then moves into the retained pathname at line 2146. Line 2151 detects altered bytes, but the catch restores nothing when retained state exists. The exported committed-error flag accurately records that a filesystem effect occurred; it does not restore the visible path.

F21 uses the production retention export branch to call `removeLinkedManifest`. The fixed context-derived pathname and manifest digest checks protect target selection. They do not prove that bytes stay unchanged after the asynchronous cleanup hook and later awaits. Inode-only checks before deletion permit edited metadata to be removed. The asset paths contained in the metadata are not unlinked here.

**Counterevidence:** Complete reads of `local-tool-boundary.test.ts` and `operation-evidence-artifact-store.test.ts` show extensive descriptor, parent-chain, replacement, hardlink and quarantine recovery cases. They establish intended foreign-path preservation, not an absolute guarantee against another process writing the same open inode. Artifact-store cases at lines 1671–1776 demonstrate absence-only recovery and preservation of a foreign target; they do not repair these different production paths.

**Fix revision:** M01 already states the correct same-owner/open-inode limitation at plan line 44. Preserve it. Distinguish ownership/identity proof, byte verification, and an explicit conflict/recovery disposition. Reclamation must account for both target-specific limits and shared directory scan limits. A restoration uses exclusive absence-only publication and never replaces a newer pathname. Edited retained metadata remains available with a specific disposition when safe restoration cannot be proved. Repeated hash checks narrow known windows; they cannot establish an OS sandbox or eliminate every same-owner race.

**Meaningful acceptance:** More than 64 distinct ordinary state replacements, retention byte/scan boundaries, interrupted reclamation, an in-place edit after the initial digest check, a new target winning restoration, and an edit after native-manifest verification. Assert actual bytes and visible/recovery locations rather than merely rejection codes. Keep symlink/hardlink defenses.

## R2-PL04: settlement retention must remain separate from invocation authority

A terminal operation is converted to a tombstone carrying `settledAt`, but expires from `issuedAt + 30 days`. Both receipt and egress compaction retain a row whose settlement callback returns null. Production wires that callback to the journal and returns null for active holds. T09 runs compaction before purge and skips purge if compaction failed. This ordering is correct counterevidence, but it does not fix a successful compaction that observes evidence younger than 30 days followed by removal of an older issuance-horizon tombstone.

Trigger: issue at t0, settle later at t1, then sweep in the interval from t0+30 days to t1+30 days. Compaction legitimately keeps the evidence; purge removes its only settlement lookup. Future compaction receives null and keeps it indefinitely. A held operation is intentionally retained; that is not this defect.

**Fix revision:** M04 can keep a settlement link through evidence expiry or use a durable independent link. Do not extend the issuer's operation-ID validity or make an expired ID executable again. Preserve active/dependent holds and durable cleanup intents. Receipt-compatible attempt reclamation must retain or explicitly version/detach receipt identity before removing its directory. Same-owner release after session rotation remains a separately authorized release operation; it does not authorize cross-session evidence reuse.

**Meaningful acceptance:** Use the actual journal/receipt/egress wiring with t1 greater than t0. Sweep between both horizons, restart, then sweep at settlement expiry. Verify evidence expires and held/dependent rows remain pinned. Existing journal horizon tests settle at issuance time; receipt/egress compaction tests use supplied callbacks, so neither alone covers the production horizon mismatch.

## R2-PL05: repair the failing outer cache without weakening authority

The registered `/control` handler invokes `createLazyControlHttpHandler`. Its rejected `initialized` promise remains cached. The generation lifecycle registry separately removes a failed initialization state at lines 312–314. MCP direct and follower endpoints call that retryable initializer directly. Thus a repaired underlying transient condition can allow MCP/follower initialization while the existing control handler still rejects. An unused generic lazy helper is not the production proof.

The HTTP endpoint authorizes control at `leader-endpoints.ts:265-268` before calling the route registry at line 297. Public ping supplies exactly the seven public identity/liveness fields at lines 246–256. Adding private readiness details to that public response would weaken the present oracle boundary.

**Fix revision:** Clear only the still-owned failed outer attempt after it settles. Concurrent callers share one attempt; successful initialization stays cached; closing generations remain fenced. A subsequent attempt reexecutes all existing integrity and owner-state checks. A corrupted store must continue failing until repaired; eviction must not treat corruption as usable authority. Where necessary, expose readiness through an authenticated surface separate from public liveness.

**Meaningful acceptance:** Actual registered HTTP handler: first initialization fails, concurrent callers receive the same attempt, repaired retry succeeds, MCP can recover after the control failure, corrupted state still rejects, and an old generation cannot initialize after closure. Existing lifecycle/follower/pairing bodies support generation separation and fail-closed identities.

## R2-PL06–07: actual timeout order, effect certainty and execution lifetime

The public leader tool caller at `index.ts:1399-1448` creates the operation and passes client cancellation to the plane. Runtime execution transitions to dispatched at `operation-executor.ts:1563-1570`. The bound runtime at `tools/runtime-registry.ts:157-188,261-274` forwards the signal and awaits it; it does not create a deadline. Executor aborts inspected at lines 918–1010 implement explicit cancellation and generation demotion, not an earlier tool timeout.

For `set_text`, base B is 30 seconds, the bridge uses B, and Relay uses B+5 seconds. Production `useRelaySession.ts:56-63` installs the bridge without a test timeout override. The bridge timeout removes its pending record, posts an exact-bound sandbox cancellation, and rejects a plain Error. The client catches it and sends Internal without aborting its own cancellation controller. Relay's error handling receives no committed flag. Executor's `runtimeCompleted` remains false and its controller remains un-aborted, allowing durable failed/no-output finalization at lines 1732–1761.

If the UI response is lost or its event loop stalls, Relay's own timer at lines 205–214 also rejects plainly. There is no executor deadline that necessarily precedes it. Relay has an actual `entry.dispatched` flag, set immediately before sending at lines 369–371, but timeout does not project it. A pinned reconnecting request can remain undelivered; this is the distinct provably pre-effect branch, not proof that every timeout is uncertain.

F26 supplies a concrete late-effect trigger. `set_text` awaits font loading then writes without receiving/checking its context. `clone_node` awaits lookup then clones without the final check. These are actual registered handlers, wrapped through `handlers/registry.ts:245`; the mutation wrapper checks before calling the asynchronous handler, not after its awaits. Exact bridge cancellation aborts the sandbox context and suppresses its eventual reply, but does not prevent those unchecked late writes. `create-variable.ts:85` is counterevidence showing the required adjacent check already exists in another handler.

F25 separately leaves dispatched activity pending: cancel/disconnect removes execution maps, while aborted completion returns before `settle`. `useRelaySession.ts:282` derives busy from that historical activity.

**Fix revision:** Extend M11's concrete file list and acceptance to the sandbox tool bridge. Use explicit effect disposition/typed uncertainty through both bridge and Relay error projections; missing `committed` is not a no-effect certificate. Preserve known pre-effect adapter failures and undelivered calls. Late effects/results need authenticated, identity-bound reconciliation; no automatic mutating replay is shown or authorized. UI activity may settle cancelled/unknown without claiming that the document stayed unchanged.

The queue body's test at `resource-queue.test.ts:128-143` requires active abort to retain all grants until its callback actually settles. This must survive the UI fix. Bridge cancellation acknowledgment or a cleared spinner alone cannot release effect authority. Persist an unknown-outcome fence before permitting conflicting admission when actual effect settlement cannot be proved. A synchronous Figma API mutation already running cannot be preempted by JavaScript.

**Meaningful acceptance:** Exercise the actual public caller and production bridge with deferred font/node preflight, the real B versus B+5 ordering, and a late committed mutation. Assert durable unknown evidence and no duplicate dispatch. Separately prove zero writes for cancellation before actual dispatch and for handlers honoring the final check. Test cancel/disconnect activity, resource grant lifetime, undo/partial-change codes and authorized late reconciliation. Existing MCP-wire tests cover dispatched cancellation; import-image runtime tests cover pre-dispatch reservation cancellation. Neither substitutes for this timeout path.

## R2-PL08: derivation-time CAS for the complete provenance transaction

The updater reads the three authority JSON values at lines 546–550 and derives new formatted bytes at lines 806–836. `commitAuthorityTransaction` then reads each current target again at line 447 and stores that later hash as `oldSha256`. Recovery accepts this hash at lines 392–402. An ordinary maintainer edit after original reads but before staging becomes accepted old authority and can be overwritten with output derived from the earlier values.

**Counterevidence:** Recovery verifies exact closed target names, prepared bytes and old/new hashes, accepts already-published intended bytes, and preserves unexpected authority versions through conflict. The transaction is not an unconditional overwrite mechanism. The defect is the timing of expected-old acquisition.

**Fix revision:** M15 already correctly binds expected-old to initial derivation reads. Carry exact original bytes/hashes for all three files into staging. Reject drift before starting related publication where possible; retain durable recovery when publication is partial. A conflict must preserve the edited authority and transaction recovery obligations, rather than force rollback over foreign edits. Like M01, this does not promise atomic exclusion of every same-owner filesystem race.

**Meaningful acceptance:** Inject a maintainer edit after derivation and before staging to each of the three targets. Verify conflict, preserved edited bytes, and consistent recoverable transaction status. Retain interruption-after-rename tests and unexpected-version recovery rejection.

## R2-PL09: authorized approval presentation and rejected broader accusation

The prompt retains full effect summary strings and hashes the prompt. Native execution requires explicit approval in `policy/operation-policy.ts:40-52,427-431`. Portal admission carries the explicit native-execution, retained-artifact and same-owner/no-OS-sandbox label from `index.ts:1052` into the prompt's target label. The panel renders that label at line 30. The effect-label fallback may summarize an unfamiliar effect as design information, but the visible target disclosure prevents the asserted broad concealment conclusion.

Control-entry approval selects authenticated owner-control; other entries need a bound plugin target. Chrome portal planning has a forbidden target requirement at `tools/registry.ts:298-302`, so it cannot be assumed to use this plugin panel. An unavailable approval channel causes pre-egress rejection in `execution-plane.ts:857-884`. Keep the incomplete effect wording as a usability improvement and preserve exact prompt/nonce/generation/channel binding.

## Coverage and verification limits

All 41 assigned closure bodies were read completely in 46 bounded batches, including repetitive adapters and test setup/teardown. One combined output truncated a MCP-wire segment; lines 867–1136 were reread separately before the file was marked full. Test bodies were inspected for their actual assertions and counterexamples; none were executed.

The companion coverage array records each assigned file once as full, size, line count, hash and contiguous ranges, plus actual production/document cross-reads. Targeted production files include exact remaining ranges; inherited round-one production coverage is not relabeled as new round-two full coverage. The full source-manifest and closure-assignment documents were used as metadata indexes only.

M01/M04/M10/M11/M15 are accepted directions subject to the revisions above. This review does not certify native/runtime acceptance or complete service readiness.

