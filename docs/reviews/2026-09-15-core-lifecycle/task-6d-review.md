# Task 6D main independent review

Verdict: Scoped PASS for the 20-file lifecycle integration. Main did not author these changes. This is not either final whole-code review round and does not certify the pending native consumption producer.

Reviewed actual index injection, current core definition/schema identities, coordinator plan/start/next/submit/cancel paths, public resume behavior, signed capacity-intent recovery, bounded page codec and the IR consumption gate. The required current core material is loaded through the signed preparation path before blueprint publication and lease issuance. A declaration is never promoted to verified implementation. Missing legacy authority remains inspectable with no current lease.

Public resume uses a new admitted operation and an existing owner/workspace-bound reservation. The original request excludes only the resume control field; changed request/source/capture inputs cannot replace the immutable intent. Existing completed plan summaries remain immutable inspection; subsequent execution still uses current authority checks. There is no re-execution of the old failed operation or replacement of its journal row.

The capacity migration preserves charged legacy rows and reconstructs identity only from matching signed records. Unknown prefixes fail closed. Retained pages/results are not evicted or freed merely by cancelling a dependency. This remains explicit finite retained capacity, not an unlimited storage claim.

Legacy declaration eligibility includes unchanged baseline target files plus submitted replacements and excludes reference-only files. Declaration material changes invalidate prior references. Exact page/result membership and bounds remain distinct from later per-row verification. The representable public JSON page codec retains the existing exact runtime page validation and avoids a global unrepresentable-schema waiver.

Current completion requires the correct owner/workspace, core context, blueprint, candidate, declaration digest, exact required-result hash set, target and verifier version. The receipt must be supplied by the pending actual Task 6E producer; no declaration or successful helper flag fills it in. Four delegated NativeWork/test paths remain outside this integration and will be copied only with their eventual combined Task 6E evidence.

## Main validation

Main ran the exact 14-suite command listed in the implementation report. Result: 155 tests passed, 77.01 seconds; September 15 at 09:54:49. These include actual canonical failure/new-operation resume, signed stores, source edits and added binary members, cancelled/foreign/legacy identities, page tampering, declaration invalidation, direct shared imports, public page serialization and completion identity negatives. Native receipt-dependent positives remain Task 6E; this run does not imply they passed.

The final 20 hashes and original main preimages must match at the guarded copy. Preserve all earlier staged work and the four explicitly delegated paths. Remaining full-service work includes actual consumption/compiler/native receipts, conditional compositions and routing, live C4/C2/C3 verification, portable capture and provenance, final whole-code reviews, clean source checks and authorized main publication.
