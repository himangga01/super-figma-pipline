# Reviewed workspace membership provenance repair

Date: October 11, 2026 (Asia/Seoul), implementation frozen at 19:17 KST.

## Baseline and observed blocker

The service's local web portal is a new `@sfp/portal` workspace with an actual backend, public CLI bridge and browser assets. Its membership must be admitted through the same source/review authority as other service changes before the integrated source can pass offline provenance verification. Read the [integration record](README.md), [packaging report](packaging.md), [packaging review](packaging-review.md), [portal plan](../../plans/2026-10-11-service-web-portal.md) and [canonical service analysis](../../service-analysis.md) before reusing this finding. Shared analysis policy and current project instructions were read; no Superpowers skill was used.

The coordinator reported that actual four-archive publishing/runtime verification passed, but r5 reconciliation, which applied 118 fork changes and 115 manifest changes, left `rootAuthority.workspacePackageNames` at five names. Offline provenance therefore still failed the workspace-name comparison. That failure is preserved; actual packaging success does not turn it into a provenance pass. The coordinator reported main/native source `23fe2942...` and prepared an unexecuted r6 follow-up against the r5 alternate index. These are coordinator observations, not a whole-source pass executed by this worker.

Implementation uses the existing managed checkout `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`, at published Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus existing uncommitted integration work. Before editing, its `scripts/update-service-forks.mjs` matched the native updater exactly at SHA-256 `d0a78019640ca716291c20a911c38d5180da06f181e95395d0a2ca71d83a5824`. Ownership is limited to that script and `test/service-fork-lineage.test.ts`. No real upstream lock, generated metadata, source Chrome, dependency tree, main/native source or owner index was edited by this worker.

## Implemented authority derivation

The existing reconciler already verifies the source commit, original authority hashes, slice allowlist, ordered explicit review entries, exact prior-claim classes, and equality of reviewed worktree/index bytes. Its prior package/root/knip projection updates remain. The repair adds a workspace-name derivation **after** those review checks and before authority publication:

- A direct `packages/*/package.json` name can become new membership only if that exact manifest was explicitly reviewed, its original index status is `A`, and it is absent from HEAD. The original addition status is retained even when existing protection claims cause reconciliation to normalize the change to `M`.
- Only these reviewed addition names are appended. Existing authority names are retained and UTF-8 sorted. Names from other HEAD/index manifests are read solely for collision/identity validation and are never unioned into authority. An existing unreviewed name remains unadmitted and can still fail the unchanged offline verifier.
- Existing manifest names cannot be renamed or retroactively admitted by an addition review. A D+A path relocation of a HEAD-owned package identity is rejected. Duplicate identities, malformed/missing names, malformed prior membership and non-regular/unmerged indexed manifest entries remain blocking. Supported names are bounded lowercase ASCII npm-style identities, at most 214 characters.
- A previously published partial addition may retain its already admitted name only with an exact same-path protected byte claim. This preserves retry behavior without treating an arbitrary old name as new authorization.
- HEAD and index scans are bounded to 128 direct workspace manifests and 262,144 bytes per parsed manifest. They do not reconstruct general rename history, scan/execute package modules or absorb other workspace paths. Unsupported evidence fails conservatively.

The actual r6 prerequisite is explicitly covered: `packages/portal/package.json` is absent from HEAD and still an original staged `A`, while r5 has already recorded its unchanged hash as protected. The root workspace name is derived from that reviewed manifest rather than by manually editing the lock. Source/index bytes are rechecked again by the existing final publication fence, and the existing atomic three-authority transaction remains unchanged. The lock schema and offline verifier were not weakened.

## Regression evidence

Twelve added fixture scenarios cover ordinary new membership, the r5 protected-addition case, unreviewed existing/new names remaining outside authority, retained protected retry, name/path renames, duplicates, malformed names, committed existing-but-unadmitted manifests, and worktree/index byte drift. Fixtures create independent temporary Git repositories and use existing hermetic Git helpers. They do not stage into or reconcile the real owner repository.

Initial RED at **19:12:45 KST**: **28 passed / 9 failed** across 37 cases. Four valid addition variants kept only the old name; rename/path-rename/duplicate/malformed cases incorrectly succeeded. The committed-existing fixture initially failed its own allowlist before reaching the intended assertion. Its explicit allowlist was corrected and a separate targeted RED at **19:14:18 KST** then proved that the updater wrongly accepted that existing manifest. Targeted name filtering excluded the other 36 cases in that diagnostic run; these were not new skips.

GREEN at **19:15:39 KST**: **37/37 passed**, zero failures/skips, including all prior baseline/prior-claim/index/partial-recovery/transaction tests and every new membership case. The final subsequent change only hoisted predicate functions and made index-record narrowing explicit for JS type/lint checking; final tools typecheck, scoped lint and formatting passed at the frozen hashes below. The independent reviewer was asked to run the exact 37-case suite against that final source before integration. Do not treat the preceding GREEN as a newly executed final-hash whole-source pass.

```powershell
# Managed service working directory; direct installed native binaries, no install/build
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 --project root test/service-fork-lineage.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.tools.json
node node_modules/oxlint/bin/oxlint --deny-warnings scripts/update-service-forks.mjs test/service-fork-lineage.test.ts
node node_modules/oxfmt/bin/oxfmt --check scripts/update-service-forks.mjs test/service-fork-lineage.test.ts
```

Private receipts are outside service source under the managed root's `.task-evidence/`: `workspace-membership-red.json`, `workspace-membership-committed-red.json` and `workspace-membership-green.json`. Intermediate static checking found index-match narrowing and predicate-scoping issues; both were repaired. No fixture test requires old generated project artifacts or a live daemon/browser.

## Frozen hashes and remaining verification

| Managed service file | SHA-256 |
| --- | --- |
| `scripts/update-service-forks.mjs` | `3a767d13dd766db0ed2e948de220571962920563393ebbd39afa6d9f15535777` |
| `test/service-fork-lineage.test.ts` | `747ffd6190ff8dfcd1ed6165f4599577b710db3ae5aa42149e6675c3c92c448f` |

Source is frozen for independent review. The coordinator must integrate the two files and execute r6 with fresh exact review/index/authority bindings, explicitly rereviewing the protected staged portal manifest. Then repeat the unchanged offline provenance verifier, reconcile the updater/test source change, reestablish the full source fingerprint and complete renewed whole/artifact gates. This worker has not executed r6, edited the lock by hand, restaged the owner's index or claimed an offline/global pass. Rename support beyond these conservative rejection rules remains out of scope; no new product decision is needed for the reviewed portal addition.

Independent frozen-source recheck subsequently reported **37/37 passed, zero skips**, beginning at **19:18:49 KST**, with no actionable finding in the bounded helper, twelve new scenarios or retained transaction/review guards. The reviewer confirmed that main/native held these exact two hashes at 19:20 after coordinator integration. This closes the focused implementation review gate; actual r6/offline verification and renewed whole-source acceptance still require the coordinator's recorded execution. See the linked reviewer follow-up in the integration record when available.

## Re-review of the admitted uncommitted portal manifest, October 11 from 21:54 KST

The parent reported that the next native reconciliation rejected `packages/portal/package.json` after three newly implemented web assets were added to its publication list. The package was already admitted by r6, while published HEAD still lacked the new workspace. The failed r7 stopped before metadata publication and did not change the owner's index. These are coordinator execution observations; this worker did not run r7 or edit real metadata.

The two owned source files were copied from main into the managed working copy before editing. Their starting hashes matched the earlier table exactly. Inspection of current main authority showed `@sfp/portal` already in `rootAuthority.workspacePackageNames` and the same manifest protected at SHA-256 `b24e512457d928850cca601504e7fe5c4f9fe0f1d32ccd7d37b5145e4eca5fcb`. No package projection or fork row supplied an independent path-to-name binding for this manifest.

The blocker was the retained-addition branch's requirement that the protected **old** hash equal the explicitly reviewed **new** hash. That supports an identical retry but rejects a real re-review. A second regression showed that changing the same protected uncommitted manifest to a new package name was incorrectly treated as another new membership. The unchanged offline verifier could subsequently detect stale membership, but the updater must reject that rename before publishing authority.

The bounded repair preserves all existing review, prior-claim, index, HEAD and collision checks. A changed protected addition is accepted only when:

1. The explicit review's prior claims exactly match the hash-bound baseline authority and its new bytes match both the worktree and index.
2. The path is still an original staged addition absent from HEAD, and the index has that unique name at exactly that path.
3. There is exactly one previously protected direct workspace manifest absent from HEAD, at this same path, and exactly one previously admitted package name absent from HEAD, equal to its reviewed name.

This singleton requirement reconstructs the identity only when the existing authority leaves one possible binding. Multiple prior uncommitted additions remain blocked because the historical authority has no path/name table. No arbitrary scan of unreachable Git objects, new authority schema, name union from unreviewed manifests, rename support or manual membership edit was introduced. Unchanged protected retries and ordinary reviewed new additions retain their previous behavior.

Six new hermetic temporary-repository cases cover the actual three-asset manifest update and negative prior-hash, path, name, duplicate-name and ambiguous-multiple-addition cases. The targeted RED at **21:57:21** produced **four passes and two failures**: the valid re-review was rejected, and the rename was accepted. The other 37 tests were deliberately filtered, not newly skipped. Targeted GREEN at **21:58:07** passed all six. Tools TypeScript, scoped lint and formatting passed after the repair. The complete lineage-file result and final freeze are recorded below when that run settles.

No actual owner index, upstream lock, vendor metadata, source Chrome, daemon, dependency tree or native/main implementation was mutated by this worker. The parent must integrate the two reviewed files, generate fresh exact reconciliation bindings, retry publication through the updater and rerun the unchanged offline verifier before advancing to the whole-source gates.

The complete lineage suite, started at **21:59:11 KST**, passed **43/43 with zero failures or skips** in 42.69 seconds. It includes all 37 earlier lineage/transaction checks and the six new re-review cases. The two-file repair is frozen:

| Managed service file | SHA-256 |
| --- | --- |
| `scripts/update-service-forks.mjs` | `1e42d79ced118c7b1a7f2e0303c021371268c96c4b5a2605d4e349d54d85775a` |
| `test/service-fork-lineage.test.ts` | `c2d131a35dbb95adb77067849eab59c044db6220069d7e966bf6f09b9db8d759` |

Validation used the same focused command above, with the explicit installed compiler entry `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.tools.json`. This fixture pass does not replace the parent's actual reconciliation, offline verifier or current-source whole check.
