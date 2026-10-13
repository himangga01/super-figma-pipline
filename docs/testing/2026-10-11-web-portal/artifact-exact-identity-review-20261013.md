# Artifact exact-identity hardening: independent review

Date: October 13, 2026, Asia/Seoul. Verdict: **Approved for integration of the exact two-file defensive change.** No actionable defect was found in the reviewed delta. This is not a diagnosis or repair certification for the historical whole-check failure, a current whole/artifact pass, or live acceptance.

## Scope and source baseline

Read-before references: [project instructions](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md), the author's managed `artifact-quarantine-race-diagnosis-20261013.md`, and the historical [retention review](../../reviews/2026-09-15-recipe-retention/task-6c1-review.md). Root owns canonical instruction/service-analysis updates and integration. This independent reviewer owns this report only.

Main was on `main`, HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with extensive existing modified/untracked work. The chosen source baseline supplied by Root is `sha256:1de53379d5742ccb8be95c0a7b7fc0f98528db79e846d4b2c482c641b8aeb00a`. The reviewer independently checked the frozen manifest and both Main preimages/candidate files with `Get-FileHash`:

| File under service | Main preimage SHA-256 | Reviewed candidate SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/fs/operation-evidence-artifact-store.ts` | `2e0d609ad585237119ef4ef15e84daba98af9d4062550eadba647fa87bddbb3d` | `0df6a134c87125c4fc02a9b0ff02564b9650a11b2999b129b49f645f05c10369` |
| `packages/mcp/test/fs/operation-evidence-artifact-store.test.ts` | `cf2ce5ac3aa48d2fd408acd405d86e37f3fe99181fc538cc287b0e5127e4f63c` | `c97c9f50f05d4742e1419ac9f9632b5d6aa9dba983921f0f23897b3da085b1df` |

The frozen manifest SHA-256 is `8c8d7e381fb6c4deaf92824deb18420715ae9c0669b9568a526d871994b6945d`, under `.worktrees/_cache/artifact-quarantine-race-20261013/precision-frozen-files.json`. These checks identify exact bytes; this review did not recompute the entire service fingerprint.

## Implemented behavior and findings

The store retains bounded result bytes and cleanup markers under workspace/directory authority. Cleanup opens and reads the artifact, moves it into a deterministic quarantine, then checks retained identity/bytes synchronously before unlinking. Recognized retained cleanup supports a restart without replaying the original operation. The change adds private bigint device/inode values to the retained artifact descriptor, supplementing existing numeric metadata. Its purpose is to avoid loss of integer precision when file IDs exceed JavaScript's safe-number range.

- `openVerifiedArtifactFile` captures exact pathname identity before open and compares it with the opened descriptor's exact identity. After the bounded read, it compares the pathname's exact identity again before returning the held descriptor. Acquisition failures close the descriptor through the existing catch path. The returned exact pair is frozen.
- Fresh cleanup compares the held exact pair immediately before rename and after the move. A mismatch throws the existing identity error and does not reach artifact unlink. Recognized already-quarantined cleanup still opens/verifies its actual retained file and reaches the same synchronous commit guard.
- `artifactAtAuthorityMatchesSync` checks both current pathname and held descriptor against the retained exact pair. It retains existing regular-file, symbolic-link, single-link, numeric size, numeric identity, bounded descriptor reread, extra-byte and digest guards. `commitArtifactQuarantineRetentionSync` invokes it before the sole artifact `unlinkSync`. No new awaited callback separates that commit and unlink. Existing directory verification/sync behavior remains intact.
- Artifact handles remain open through commit and close in `cleanupVerifiedArtifact`'s existing finally. Caller close/error logic and restart flow are unchanged. The other unlink sites concern existing marker paths; the change does not refactor their identity or authority policy.
- The complete delta changes only private in-memory artifact identity and adds two tests plus one import. Public/on-disk schemas, marker versions, directory comparisons, capacities, deadlines, byte caps, retention policy and required error assertions are unchanged.

The numeric type/link snapshots and bigint identity snapshots are separate filesystem calls. This is additional exact identity protection, not an atomic filesystem transaction or isolation from another process with the same filesystem privileges. Existing rename/commit race limits remain; no stronger guarantee is inferred. In particular, post-move rejection can preserve an unexpected object at quarantine for recovery, as in the existing design, rather than establishing that no rename ever touched it.

## Independently verified evidence

Read-only `git diff --no-index` inspection covered both complete deltas and source callers, including fresh and retained cleanup paths. An independent Node read-only comparison removed exactly the new two-test block and `open` import, then compared the remaining entire test file with the preserved original: **byte-identical**. This includes all original replacement/restart assertions, not only the named race case.

The reviewer inspected the author's fail-before JSON: the new actual private commit-check fixture failed with `expected true to be false`. Its data uses one real owned file/descriptor with valid bytes and numeric metadata, but supplies a different retained exact inode. It changes no actual file ID, installs no global filesystem mock and does not construct an actual file-ID collision. This establishes a meaningful fail-before guard-wiring regression. The second pure-data fixture uses `9007199254740992n` and its successor, confirms their Number conversions are equal, and checks exact inequality plus matching/device-mismatch cases.

The reviewed author after-report registers 57 cases: 56 passed, zero failed, one unchanged platform skip. Author-reported source noEmit checks 367 files with zero errors; scoped lint and formatting pass. These are inspected author evidence, not reviewer-executed tests. Root is independently rerunning the complete edited file; this reviewer deliberately avoided redundant workloads. No tests, dependency installs, build, live service/state mutation, Chrome/Figma control, helper mode, production-source edit, staging, commit or push were performed in this review. Inspection ran under the same Windows account with unrestricted filesystem privileges, not an OS/process sandbox.

## Historical failure and continuation

Historical whole `8f4753c4-e895-4751-9346-f8a6e8fb6cbb` remains failed at the original replacement-during-quarantine case: 484 files, 5,785 registrations, 5,764 passed, one failed, twenty unchanged skips. Its undefined cleanup result does not establish whether the hook ran, what original branch executed or whether foreign bytes were deleted. Author ordinary original-file/race passes and observed unsafe-number identities do not prove the historical cause. This change is approved defensive precision hardening independently of that unresolved cause.

Root should integrate only the exact reviewed files after its independent complete-file check, preserve the historical failed report, and run the required chosen-source whole/artifact gates before any live replacement or acceptance claim. Record this report's read-before/update-after path in AGENTS through Root's owned instruction update. The open product/diagnostic question remains which legitimate no-op or commit branch produced the historical undefined result. No operator acknowledgment, unknown outcome, operation/run/grant deadline, live acceptance or deferred official-MCP status is changed here.
