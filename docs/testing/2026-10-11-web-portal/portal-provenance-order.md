# Portal provenance publication order

Date: October 13, 2026 (Asia/Seoul). Read-only diagnosis after C2 preparation. Read [AGENTS.md](../../../AGENTS.md) and the shared analysis policy first. Scope is the root's R16 alternate-index publication of reviewed portal/OAuth/approval/package code, README, catalog and census. No source, metadata, authority transaction, Git index or process was changed by this reviewer.

## Actual current evidence

The historical sequence reported to this reviewer was: updater bound an old change manifest; staged verification rejected its rows; `--write` changed 212 rows to 209; offline verification rejected the old protected hash. That historical failure remains failure evidence. The later read-only snapshot is already consistent:

- Main and native `capabilities/change-manifests/task-review-2026-10-10.json` both have 209 rows and SHA-256 `a5e249e32a9d7675b380ccf5fc62801f8e26efe9fbb51ec3e950100a27580b66`.
- Both `upstream-lock.json` protected rows contain that exact hash; both lock files hash to `9c4246c7f88e348378aaf7e909fb208adc7aec12053fb620191011ec30831db0`.
- The existing native `.cache/review-20261011-r16.index`, read against main, has 212 cached changed paths and 209 semantic paths. Its staged manifest has 209 rows and staged lock has the same protected hash.
- Main HEAD is `22517932dc9b2cb974c177ec4eacb84d4b16e254`; native HEAD is `6459363354f52940b4c67e399b9e735d7332d4dc`. They are distinct baseline contexts despite copied source bytes.

The212-to 209 difference is expected: the generated manifest excludes its four `authorityPaths`; three of those are changed in this index. It does not show three semantic source files being dropped.

## Source-confirmed cause and safe order

`update-service-forks.mjs` reads cached blobs using the inherited `GIT_INDEX_FILE`, honors `SFP_REPOSITORY_ROOT`, and excludes the manifest/map/rules/lock from its normal source-row update loop. Its reconciliation checks the exact HEAD and pre-publication authority hashes. An old reconciliation record cannot safely be rerun after authority publication.

`verify-staged-change-manifest.mjs --write` also honors that root and alternate index. It derives semantic rows from cached blobs, writes the manifest, then `registerGeneratedManifest` updates the lock's protected manifest hash and applicable rules/owned rows through the authority transaction. The writer already performs that registration; no baseline waiver is needed. A partial publication or copying only the new manifest to another tree can leave the other tree's old lock inconsistent.

`verify-upstream-lock.mjs` derives its root from its **physical script path**. It does not honor `SFP_REPOSITORY_ROOT`. Running the native script checks native files, even if the updater/writer environment selected main. This root difference is material to the reported stale protected hash. The current equality snapshot cannot establish precisely which earlier copy/interruption caused that historical mismatch.

For a fresh, frozen round, root should use this order:

1. Finish semantic inputs and derived catalog/census/README, stage them in the intended alternate index, and create a fresh reconciliation record against the current intended HEAD and authority bytes. Keep the owner index separate.
2. Set the same absolute `GIT_INDEX_FILE` and explicit `SFP_REPOSITORY_ROOT` for updater and manifest writer. Run `node service/scripts/update-service-forks.mjs --slice review-2026-10-10 --index service/capabilities/change-manifests/task-review-2026-10-10.json --reconcile <fresh-record>` **once**, while its baseline still matches. Do not reuse the already consumed R16 preparation helper or old review record.
3. Stage generated `service/upstream-lock.json`, `service/vendor-map.json` and `service/vendor-rules.json` into that same index. Then run `node service/scripts/verify-staged-change-manifest.mjs --write --slice review-2026-10-10` under the same root/index.
4. Stage all four resulting authority paths, including the manifest and updated lock/rules/map. If native verification is intended, copy and compare the complete resulting authority/source set, not only the manifest.
5. Run staged verification without `--write` under the same root/index. Run `node <intended-root>/service/scripts/verify-upstream-lock.mjs --offline` using the script physically located in the tree being checked. Verify main/native and staged/worktree hashes separately.

For the already reconciled current R16 snapshot, do not start again at step 2 with the old record. Continue with final read-only checks if root's actual latest verifier succeeded. If new semantic bytes appear, preserve this round and produce a new exact reconciliation baseline/alternate-index round. No old-baseline exception, stale review claim, SourceEpoch change, execution-budget renewal or user-index mutation is justified by this derived-file ordering issue.

The source locations are `update-service-forks.mjs:929` (reserved authority paths), `:472` (reconciliation baseline), `verify-staged-change-manifest.mjs:42` (generated registration), `:305` (authority exclusion), `:341` (write then register), and `verify-upstream-lock.mjs:11/:266` (physical root/protected hash). These source/read-index observations are not a newly executed full/offline verifier pass; root owns that verification and all publication actions.
