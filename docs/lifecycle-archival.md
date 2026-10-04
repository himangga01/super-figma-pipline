# Lifecycle archival and evidence retention

This protocol implements the M04 retention corrections in [the remediation plan](plans/2026-09-30-code-remediation-plan.md). It preserves historical receipt identity while reclaiming eligible service-owned data. Archival does not renew an operation ID or authorize another execution.

## Settlement and evidence holds

Operation tombstones retain their original issuance-based `expiresAt`. Reclamation additionally requires a known settlement time at least 30 days old, no active hold, and no authenticated receipt or egress finalizer remaining. A failed evidence-store query prevents purge. Historical records without a proved settlement time remain retained. Unresolved `outcome-unknown` records retain their file-effect fence until explicit resolution.

The existing admitted `recipe.evidence.release` operation permits the same actor and workspace to release a settled hold after session rotation. It still requires its explicit user approval and rejects unsettled operations and retained dependencies. The signed release audit records the current actor/session; the originating binding, including its original session, remains immutable. Holding and consuming evidence still require the original session binding.

## Reviewed native archival

1. POST `{ "attemptId": "<64 hexadecimal characters>" }` to `/control/portal/environments/archive/review` as the owning actor.
2. Review the owned attempt using the existing environment inspection endpoint and the returned `receiptHash`, `archiveHash`, byte count and entry count. The archive hash binds the complete server-observed identity/digest inventory.
3. Request an action nonce for `portal.environment.archive`. Its semantic request is exactly `{ attemptId, receiptHash, archiveHash }`.
4. POST those three fields and `actionNonce` to `/control/portal/environments/archive`.

The attempt must be released and execution-closed with all recorded processes stopped. Production eligibility must hold the same execution queue resources as native work and reread signed run, plan and apply records. Active, uncertain and partially applied work remains pinned. Terminal, unreachable attempts may preserve their historical receipt through `sfp-native-attempt-archive-v1` authority.

The signed inventory precedes deletion. Each file or directory has a durable deletion intent; restart resumes only matching identities and bytes. Missing unstarted entries, edited files, unexpected directory entries, hardlinks, symlinks and replaced ancestors block reclamation. No recursive path deletion or adoption of a foreign replacement occurs. The active reservation is removed only after complete reclamation. The original attempt record remains an immutable replay fence and receipt authority.

An exact released, execution-closed attempt with reason `no-effects-started`, `provisioningStarted: false`, no creation intents, children or processes, and no bound directory identity may use `sfp-native-no-effect-archive-v1`. This proof retains the parent identity and verifies the expected directory is absent before review and before completion. A foreign directory appearing in that interval blocks reclamation. An unexplained missing directory is not eligible. Its empty inventory proves no service effects and does not authorize deletion of a replacement.

## Reviewed core preparation archival

1. POST `{ workspaceId, preparationId }` to `/control/portal/core/archive/review` as the owner.
2. Request a `portal.core.archive` action nonce for exactly `{ workspaceId, preparationId, archiveHash }` using the returned hash.
3. POST those fields and `actionNonce` to `/control/portal/core/archive`.

Pending/running preparations, orphan reservations and unresolved dependencies remain charged. Production review holds the owner/workspace core authority queue resource. It may reconcile exact stale dependency references proved terminal by signed plan/run records; it cannot erase arbitrary references. Reconciliation changes the preparation revision and invalidates an older archive approval. Review itself performs no directory deletion or audit erasure.

The signed `sfp-core-preparation-archive-v1` audit preserves the original preparation, intent identity and input/result/page hashes. Large evidence records are atomically replaced by signed `sfp-core-record-archive-v1` markers. Interrupted reductions stay charged until matching markers and durable progress complete. The originating intent remains fenced; archived records cannot be adopted or consumed. `verifyArchive` verifies the historical audit and marker bindings independently of consumption.

A signed publication ledger records each immutable page/result identity, digest and byte count before publication. New preparations publish a complete empty ledger before their preparation record, so cancellation before any output still has provable publication authority. Archival includes the verified published prefix and ledger even when cancellation precedes recording a completed result. Planned but absent records are not adopted. Legacy failed/running preparations without complete historical publication authority remain charged with `CORE_ARCHIVE_PUBLICATION_RECOVERY_REQUIRED`; retry cannot retroactively legitimize an unaccounted prefix. Completed legacy preparations remain readable through their existing result proofs.

An actual child exit after atomic temp fsync but before canonical publication can leave a physical `.sfp-tmp` file. Under retained directory authority, review, resumption and final capacity release inspect exact atomic temp basenames associated with this preparation's signed record/publication identities, including intended records whose canonical file is absent. A match rejects with `CORE_ARCHIVE_PUBLICATION_TEMP_RECOVERY_REQUIRED` and retains the reservation. Production does not adopt or delete uncertain temp bytes. Unrelated record identities remain untouched. A scan beyond 1,000,000 names in one directory rejects with `CORE_ARCHIVE_PUBLICATION_SCAN_LIMIT`. Recovery of these uncertain temps remains an explicit operational prerequisite; archival cannot silently free their charge.

## Capacity and protection limits

The active ceilings remain 128 native attempts, 32 preparations per owner and 128 preparations globally. Each native/core archive namespace has a separate signed ceiling of 4,096 archive reservations and 64 MiB of reserved audit/marker metadata. Exhaustion rejects before reclamation. Unknown reservations remain charged. Existing record-size and directory-scan limits can reject earlier. Historical audits are not automatically deleted.

Deletion checks retain ancestor authority and recheck inode identity and file digests. Another process with the same Windows owner privileges can still change a checked pathname or inode between verification and the filesystem effect. This is not an OS sandbox. Windows directory fsync can return `EPERM`; the persisted inventory records `eperm-limited`. Executed interruption tests cover process termination, not power loss.

The publication ledger permits the existing maximum of 4,096 pages plus seven results (4,103 entries). A preparation archive additionally accounts for the input and ledger (4,105 entries). A schema boundary test verifies this bound; a maximum-sized physical corpus was not executed.

## Executed focused evidence

Native Windows validation used Node 24.21.0 in the separate validation copy. The rehearsals filled the actual 128-attempt ceiling with SQLite databases and dependency directories, rejected the next attempt, reclaimed an approved attempt, and completed the 129th reservation while verifying its predecessor's receipt. Core rehearsal completed 33 distinct preparations for one owner and 130 globally, with the existing owner/global ceilings enforced until eligible archival.

Focused tests also cover actual child exits before native deletion and after unlink, a core child exit after record reduction but before progress persistence, preserved capacity during interruption, wrong owners, changed review hashes, nonce replay, exhausted audit accounting, physical marker accounting, session rotation and both settlement horizons. Production queue/eligibility integration and integrated service acceptance have separate verification evidence; these focused tests do not constitute a full-suite or release claim.
