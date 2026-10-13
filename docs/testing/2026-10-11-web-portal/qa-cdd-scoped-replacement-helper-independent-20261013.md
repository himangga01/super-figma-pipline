# Incoming CDD scoped QA helper: independent review

Date: October 13, 2026, Asia/Seoul. Closed at 21:26:22.128 KST. **Conditionally approve the exact frozen R2 helper logic.** R1 remains rejected and preserved for its missing current-runtime assertion. R2 repairs that finding, and its one changed binding fixture passed independently. Actual final selected-source gates, grant sealing/configuration, runtime preflight, replacement and postchecks remain required. No sealing, configuration, preflight, intent or execution mode was invoked in this review.

Read-before: [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [service analysis](../../service-analysis.md), [earlier scoped helper R1/R2/R3 review](qa-scoped-release-helper-review-20261013.md), and the author's incoming CDD helper report in its managed documentation copy. This review owns only this report, its eventual closed receipt and the ignored regular fixture copy. Root owns final source/release evidence; the sole controller owns actual QA/Chrome and later replacement.

## R2 exact approval and executed changed check

R2 frozen manifest SHA-256 is `94ee1aa8da146d7788f66f3fa88038c7fdfb2921862ffcf9ba53cc53e55e5317`; runtime manifest SHA-256 is `320c8665018aefbe2bce26358bad52feb5df5dad041dfc257def5c69d2618164`. All fourteen frozen members matched regular single-link files and exact hashes at preparation and closing. The closed [independent receipt](qa-cdd-scoped-replacement-helper-independent-20261013.json) retains R1's rejection/eight-case evidence and R2's decision, hashes, fixture result and conditions.

| File | Approved R2 SHA-256 |
| --- | --- |
| `replacement.mjs` | `37530db9f512867e1d052be7e7047389d2a47d2076bdd03e52a76c23fcbb79fa` |
| `scoped-gates.mjs` | `f93e46ea20abb0a86c850ce9c92a7eecf9cb1f57cbcf9deeaf62e600821da06c` |
| `start-owned.ps1` | `8776cbe2943e7f770d4eabc47b5cb39cdbde0b0b0f0696b84f4493213e3e4111` |
| `stop-owned.ps1` | `0b5a4472a73f753f9cd1188b6364ee01f9d149f01064a9571b2b8bfd0972ffc1` |
| `current-retained-state-private.json` | `102c67a0c0c0812ec77a909360e9ef0d95cc275d13448e55fc7cf692088657d8` |

The complete runtime diff from preserved R1 adds only `assertOldRuntimeBinding` and invokes it in preflight after reading the hash-pinned actual current replacement receipt. It requires the original 303d source and selected release, observed build ID `1791202532000`/ff198 identity, receipt-to-status equality and the two exact current QA parent tuples. The four other runtime files are unchanged. Historical a476 runtime evidence remains a separate preservation check. No retention, grant, stop/start, source/report/archive or failure rule is relaxed.

A new regular `r2-fixture` copy uses only the five runtime members and the changed binding test/manifest. As for R1, only its copied `TOOL` baseline location is redirected to that owned directory. `node --test old-build-r2.test.mjs` passed **one changed case, zero failed/cancelled/skipped**, exit zero, approximately 71.8 ms. It accepts the exact synthetic old cohort and rejects changed observed build ID, changed observed build identity and a changed receipt parent PID. The previous eight retention cases were not repeated. This verifies the pure assertion and complete static call placement, not an actual authenticated old-runtime read.

Conditional approval requires Root's actual final selected report/receipts/source/build/archive/artifact bindings, a fresh actual same-namespace grant seal and immutable approved configuration, the sole controller's exact physical/authenticated preflight, one exclusive new intent, confirmed stopped-state backup and successful new-runtime/retention postchecks. No actual final gate input is certified by this helper review. Original unknown outcomes, candidates, native records and expired CDD deadlines must remain unchanged. The new normal service observer/profile/context must bind the coherent deployed release; no bare compiled swap or issuer resurrection is permitted.

## Exact R1 freeze and baseline

R1 frozen manifest SHA-256 is `f351ef767fafc65797057ca1c3228cd4e4a5fd5259f0a993f1f49b60a0e76f85`; runtime manifest SHA-256 is `62db2f9bf98719295cb14de6b6555e62719fac368bda3a7ad8de9ed4a523b966`. All twelve frozen members were independently verified as regular single-link files with exact bytes/hashes. The five runtime files are:

| File | R1 SHA-256 |
| --- | --- |
| `replacement.mjs` | `8b0ba6a7bf5fe043d8eeb41a8050f7be11f3004eefe943d68bf17b153ea92aac` |
| `scoped-gates.mjs` | `f93e46ea20abb0a86c850ce9c92a7eecf9cb1f57cbcf9deeaf62e600821da06c` |
| `start-owned.ps1` | `8776cbe2943e7f770d4eabc47b5cb39cdbde0b0b0f0696b84f4493213e3e4111` |
| `stop-owned.ps1` | `0b5a4472a73f753f9cd1188b6364ee01f9d149f01064a9571b2b8bfd0972ffc1` |
| `current-retained-state-private.json` | `102c67a0c0c0812ec77a909360e9ef0d95cc275d13448e55fc7cf692088657d8` |

Root reports an incoming integrated Main/native source beginning `6f87f8`, with final selected gates/build/archive/artifact inputs still being prepared. This reviewer did not certify that complete source fingerprint or run source/build gates. Loaded QA remains separately bound to source `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732` and build identity `ff198de511a397495e98379c2f241bedf0332d6d7ba85c2a8c6bca3468465187`. Main HEAD remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted integration work. The owner index readback is unchanged at `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675`.

## Blocking current-runtime finding

R1 preflight calls `clientRead()` without its optional expected-build argument. It records old status but does not assert the exact current old build identity/source before stop. The `runtime.json` hash `7d485981a63194772dcd90e9af55f3a9d86aff67a902bcbd60cc0196989fc6f9` is preserved historical a476 evidence; it does not bind the current 303d QA release. Treating it as that current binding would conflate two deployments. This rejected R1 finding is repaired by the exact R2 diff above.

The controller confirmed that the actual current scoped replacement receipt is instead hash `ac666d68e197558da77471fe73eb64a49086ea6cfb1274402d9276264afe69bd`. Its sanitized binding identifies the 303d source, exact current QA parent tuples and build ID `1791202532000` with ff198 build identity. This is controller-supplied closed evidence, not a reviewer live read. R2 must pin that exact current receipt, correlate its source/build/parent tuples and assert the actually observed old build identity before stop. Historical a476/failed-intent/empty-publication evidence must stay preserved independently.

## Reviewed retained behavior

The complete helper and both PowerShell scripts were read, and executable deltas were compared against the reviewed R3 predecessor. Current QA daemon PID 31832/start 1791878320636/3059 and portal PID 22000/start 1791878388334/4315 agree across JavaScript and stop script. Exact executable/command/start/listener checks and held parent handles precede stop. Primary PID 7460/3055, PID 27636/4310, source Chrome 2072 and retained Chrome 9932 remain outside stop scope. Only two bound QA parents may be killed; bound children must retire through EOF. No native browser approval is automated.

The new baseline retains twelve portal rows, eight workflows, eleven core rows, two unknown jobs and two released native attempts. Exact row/payload/file hashes, original candidate/deadline/lease fields, unknown outcomes and released producer records remain pinned. Duplicate/missing rows, pending job/activity, live retained lease, changed application/candidate, reopened native producer and substituted baseline bytes reject. Passive generation is restricted to the exact baseline row whose retained lease is already expired. Replacement does not resolve an unknown or renew any original deadline.

The broker guard distinguishes actual PID 36468 from its execution-session identifier. It binds the exact creation/command receipt, zero pending RPCs, 33 completed requests and controlled retirement while refusing false graceful/exit-zero/QA-stop/Chrome-stop/cancel claims. No broker or browser retirement was executed by this reviewer.

The one-use handoff namespace is new. Failure preserves the intent and partly completed phase without replay or automatic rollback. The helper copies only confirmed stopped anchor state into a newly protected immutable backup, verifies stopped source/destination inventories, retains the existing namespace and authority, and checks the new compiled/archive closure before startup. New listener/generation and chosen build checks precede private traffic. The scoped report requires eight honest selected checks, one portal journey and no whole-pass claim; source-list/receipt/archive/artifact paths and hashes remain bound. Final selected source/build/archive inputs are not supplied by this review.

## Independent R1 execution and limits

All twelve frozen members were copied into `.worktrees/_cache/qa-cdd-helper-independent-20261013/fixture`. Only the copied `TOOL` constant was redirected to that regular owned directory so imported retention functions read its immutable baseline, rather than the native helper directory. This one fixture-root adaptation changes no validation algorithm. Original runtime hashes were checked separately. Private fixture JSON and fake authentication values were not printed or included in this report.

`node --test changed-retention.test.mjs` ran only the eight supplied changed cases: **eight passed, zero failed/cancelled/skipped**, exit zero, duration approximately 171 ms. They cover retention, expired/live lease distinction, candidate/application/deadline/duplicate changes, unknown/pending work, native-record closure, baseline substitution, honest broker retirement and cross-script tuple/namespace agreement. No old cohort or broad/full suite was repeated.

These are pure fixture/script checks. They do not establish actual process absence, authenticated quiescence, model-grant sealing, final source/gate/configuration correctness, stopped backup, replacement, postchecks or portal/CDD acceptance. No product/native source, frozen author helper, Git index, QA, Chrome or grant was changed. Same-owner Windows processes and copied files do not create an OS filesystem, process or network sandbox.

## Continuation

The R2 correction and its one changed positive/negative fixture are now independently verified without repeating this eight-case cohort. Actual execution still requires Root's selected final source/build/archive/artifact gates, fresh same-state grant observation/seal, approved configuration, physical preflight and one-use postchecks. Keep the expired 21:11:52.593 KST CDD deadline unchanged and use a distinct fresh ordinary context when required. Bare compiled observer swaps, copied old profiles/leases or resurrected issuers do not establish service acceptance. Final eCommerce is owner-skipped and official-MCP live verification is owner-deferred, not passed.

## R3 historical grant metadata repair: October 13, 2026

**Conditionally approve exact R3 for fresh actual observation/seal and source-bound configuration, followed by the existing preflight/execution gates.** R2's actual observation/seal attempt failed before seal publication, configuration, intent or server/policy effects. The closed failure receipt, SHA-256 `92e5919ae695472d7c8bdd3998afa041cabbf0868a1e073b4eeeba41256350e5`, records `RETAINED_GRANT_METADATA_MISSING` and a previously copied source list. This review verified those delivered receipt bytes; it did not repeat the live observation. R2's review checked retention and runtime binding but did not exercise the grant-sealing metadata dependency. The actual failure exposes that verification limit and remains failed.

R3 frozen manifest SHA-256 is `37be8e2acf11bcf13f753324e1f22af97c696a1f54f5d5d54bce4ec304102155`; runtime manifest SHA-256 is `8e917d23e2b0884870371d2c8166edd31bf220efd67597232a7349425cbb1d26`. The replacement hash is `ba94a3a84180c21e39f3379055e6198c7f24bb480c3fd03a8c3758361e1b105b`, and retained baseline hash is `2357439824f4058ecf5cbebafa8ad8dc613d708535d9c950bbaa2b4bbe4e72b8`. The other three runtime files retain the exact R2 hashes above. All seventeen frozen members matched regular single-link files and exact hashes at opening/closing. [The separate R3 receipt](qa-cdd-scoped-replacement-helper-r3-independent-20261013.json) binds these results. The original R2 approval JSON remains unchanged at `0a3508690428780174ef18db17fb0d342ffafb9c89208e4aec73c326b77dd32e`.

An exact object comparison against preserved R2 proves that the baseline adds only `grant` with three historical fields: original configuration `2026-10-12T23:00:48.660Z`, original expiry `2026-10-13T07:00:48.660Z`, and original archived-grant hash `01773157b0c30fe511f81811b6b62cea24647770ba5f61f14769d943ca2f39f1`. These equal the grant metadata in the hash-pinned historical baseline `4c5452a95ce88d8241ccce91745c1153301f365a0985d2a34a41d905e3ad75da`. Removing that one new object leaves all other retained data exactly equal, including twelve portal rows, eight workflows, eleven core rows, two unknown jobs and two retired native attempts. The complete replacement-code comparison proves a single baseline-hash literal substitution, with no sealer or runtime guard change. Scoped gates and both PowerShell scripts are byte-identical to R2.

Historical metadata does not become current policy. The unchanged sealer still obtains the actual current same-state grant through authenticated GETs with physical ownership checks, separately verifies its original-history binding and succeeded public grant job, then repeats actual config/hash validation. The recorded current grant uses `2026-10-13T07:21:06.181Z` through `2026-10-13T15:21:06.181Z`; its dates, classes and policy bytes are not renewed or rewritten by this repair. No old grant is copied into a fresh namespace, and no candidate, lease or run deadline changes.

The concrete reason for one new check is the actual failed seal and R3's added metadata. Following [the efficiency policy](../../analysis/work-efficiency-20261013.md), the prior eight retention and one old-runtime binding cases remained closed. A new regular `r3-fixture` copy redirects only its immutable `TOOL` baseline location and ran `node --test grant-history-r3.test.mjs`: **one passed, zero failed/cancelled/skipped**, exit zero, approximately 69.1 ms. It checks exact restored history and archived bytes, then exercises the unchanged binding/job validators with retained grant-job fixture data. Its namespace and egress hash are synthetic; this fixture does not establish a successful actual grant seal.

The copied source list is byte-identical to its preserved R2 copy, as recorded by the R3 receipt. Reusing that deterministic published input requires no unknown-operation replay and does not authorize copying or renewing policy. Root's already published 6f87 source and selected report/build/archive/artifact evidence remain separate authority; this narrow repair gives no reason to rerun source gates, builds, passing fixtures or a whole suite.

Actual R3 seal/configuration, exact old 303d/ff198 physical/authenticated preflight, exclusive intent, stopped-state backup, replacement and all new-runtime/retention postchecks remain required. Preserve R1/R2 freezes, the actual R2 failure and original approval receipt, all unknown outcomes and the expired 21:11:52.593 KST CDD deadline. No helper mode, live request, source/Git/Chrome/policy change or deployment was performed by this reviewer. Same-owner Windows copies and hashes do not establish an OS sandbox. Full CDD acceptance and independent collector comparison remain separate work; eCommerce stays owner-skipped and official-MCP live stays owner-deferred.
