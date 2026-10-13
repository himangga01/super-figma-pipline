# Current QA replacement helper: independent review

## R2 review: October 13, 2026, 10:44 KST

R1's filesystem-only gate later revealed two real packaging assumptions that its initial fixtures had not exercised: staged MCP plugin paths differ from native workspace paths, and published package metadata is a defined projection of the source package JSON. The original R1 helper, approval, tests and failed filesystem receipt remain preserved. R1 approval did not establish an actual release-gate pass.

Root inspected the exact R2 diff and the corresponding `scripts/package-artifacts.mjs` projection. R2 maps only three known MCP plugin entries to the actual plugin code, HTML and manifest, rejects unknown/foreign/traversal mappings, and verifies the exact published metadata projection while pinning the original native package JSON. All other archive and compiled/web checks remain intact; neither missing files nor mismatched bytes are skipped.

R2 manifest SHA-256 is `7e3562796725e20836348940fa3b7c00d5e4294e329b61af345bc9e336e3463c`. Only `replacement.mjs` changed, to `873a24befe41cc656ec6cc4c9185f307a42a07d7278af546d81dc06f38b3e522`; both PowerShell files retain their R1 hashes below. Root independently reran the fourteen author tests plus eight additional tests: **22 passed, zero failed or skipped**. Root then invoked only the exported filesystem `gates` function against current db69 whole/artifact/source-list evidence: all four archives and 45 native release files passed, and all three helper hashes remained unchanged.

[The independent filesystem receipt](qa-replacement-r2-root-filesystem-review-20261013.json) records the actual closure. This does not invoke helper modes, create an intent, call service HTTP, control Chrome, change processes or authorize db69 deployment. **R2 is approved conditionally for the specified replacement after the chosen final source receives fresh gates and execution-time preflight.** New geometry/C2 source changes still await review; the sole controller has no final execution config yet.

## Preserved R1 review

Date: October 13, 2026, 09:31 KST. Reviewer: Root. Author and sole live controller: `official_oauth_backend_sol`. Main/native source under whole verification is `sha256:8523ee9227d80ef3c6701326e566e85349f9e4665bc679d62e8b86efdc2951a0`; Git main HEAD remains `22517932dc9b2cb974c177ec4eacb84d4b16e254` with uncommitted changes.

**The frozen R1 helper is approved for the specified same-state QA replacement after fresh whole/artifact gates and execution-time preflight pass. No live replacement was executed in this review.** This follows [the readiness report](qa-current-replacement-readiness-20261013.md), [AGENTS.md](../../../AGENTS.md) and [canonical service analysis](../../service-analysis.md). The later sole-controller assignment supersedes the readiness report's earlier Root-only execution assignment.

## Exact reviewed closure

The helper lives in the native working copy's `.cache/qa-current-replacement-20261013`. Manifest SHA-256 is `eb24e4bbe4f77b6124070e7a6f99785219f2d5d0ed02f41e064522e1cf6367af`.

| File | SHA-256 |
| --- | --- |
| `replacement.mjs` | `cf08eff715a82a2cbed6404803affbb63ec2b6b28dfd247cb580e743a8232416` |
| `stop-owned.ps1` | `33a883cb01523dbe18501c98fc7849924e3046fc6b2c868f1d411ef62ce4bf20` |
| `start-owned.ps1` | `c71b08b81be18a77a1999b6ed4503a7c7b1fcf9b4583322ddb172eeead2ac2ad` |

Root read all three files and rechecked these hashes after testing. The helper requires exact source-list, succeeded whole/report, artifact checkpoint, archive/compiled closure and runtime build identity bindings. It pins existing process creation/command/listener identities and approved descendants, protects a new creator-owned private directory before copying stopped state, preserves unknown rows and expired historical runs, starts only the same QA namespace, and verifies retained authority after startup. Failure retains the phase and does not automatically replay, roll back, renew deadlines or reset outcomes. Primary servers and both Chrome roots remain outside the mutation scope.

## Executed checks

Root ran `node --test .cache/qa-current-replacement-20261013/replacement.test.mjs .cache/qa-current-replacement-20261013/root-independent.test.mjs` from the native copy. Result: **20 passed, zero failed, cancelled or skipped**, exit zero. This reruns the author's twelve checks, including actual Windows ACL inheritance and exclusive byte-copy verification in disposable fixture directories, and adds eight independent cases.

The additional cases refuse an unexpired row under the expired-row exception, changed lease, applied publication, extra signed core run, deleted original unknown row, newly started server activity, unresolved retained portal operation and source-list traversal before filesystem access. The independent test file hash is `2bb69672bd5bafcea7d1607dd77dab2cdb244bf024874bc4c221c3d2c4787e90`. Existing state was read for fixture inputs; tests did not invoke helper modes, service HTTP calls, Chrome actions, stops or starts.

## Limits and continuation

This is static and fixture approval of a specific local-process helper, not a deployment, atomic live snapshot, graceful diagnostics flush or observed browser-side cleanup. The native working copy shares the same Windows user; ACL checks do not establish OS/process isolation. Future source/archive/helper changes require fresh bindings and affected review. At this checkpoint the whole attempt `c767a7fd-75d7-4ed4-97e5-12fb953f597c` remains pending. Root must supply its final succeeded source-bound gates plus the separate artifact result before the sole controller executes preflight and any stop/start action. That agent records actual execution in its separate replacement receipt; frontend acceptance remains a later step.
