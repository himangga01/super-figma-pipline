# Independent review of web portal integration followups

Review date: October 11, 2026, 19:12-19:23 KST (Asia/Seoul).

## Disposition and scope

**No actionable defect was found in these bounded followups. The reviewed frozen files are suitable for the coordinator's integrated whole-source gates.** Independent runs passed **43 capture/coordinator cases, 37 lineage-updater cases and 16 skip-census cases**, with zero failures or skips in all three completed review runs. Main and native copies of all five reviewed files matched the hashes below after execution. This is not a claim of completed live Figma acquisition, frontend generation or final service acceptance.

The coordinator requested review of two implementation slices and subsequently one test-discovery adaptation:

- `scripts/update-service-forks.mjs` and `test/service-fork-lineage.test.ts`: derive explicitly reviewed new workspace names without admitting unrelated names.
- `packages/mcp/src/portal/coordinator.ts` and its existing test file: preserve failed/partial capture diagnostics when prior workflow decisions cannot bind to the new incomplete capture.
- `test/test-skip-census.test.ts`: recognize the service-owned child Chrome checks already registered as mandatory.

The review read the authors' freeze messages, [capture diagnostic report](capture-diagnostics.md), [workspace provenance repair report](workspace-provenance-repair.md), affected production/test code, the [web portal review](review.md), [round-2 verification](verification-round-2.md), [integration record](README.md), shared analysis policy and [repository instructions](../../../AGENTS.md). The [canonical service analysis](../../service-analysis.md) remains the common analysis authority. No Superpowers skill or implementation edit was used by this reviewer.

The capture slice was authored in managed checkout `1be9`; the updater slice was authored in managed checkout `4d3e`. Both contain authorized uncommitted changes beyond published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`. The coordinator copied the frozen source into main and the native validation copy at `.worktrees/baseline/service`, whose detached Git baseline is `6459363354f52940b4c67e399b9e735d7332d4dc`. Exact file hashes, rather than either Git HEAD alone, identify this review.

## Workspace provenance admission

The updater previously retained the old `rootAuthority.workspacePackageNames` even after the new portal manifest was explicitly reviewed and staged. The bounded addition runs inside the existing reconciliation path, after the review baseline, allowed scope, prior claims, working-tree bytes and index bytes have all been verified.

The new helper considers only reviewed `packages/<directory>/package.json` entries. A new membership name must come from an original staged add whose path is absent from HEAD. It validates bounded manifest JSON and package-name syntax, requires the index to identify that same path, and rejects collisions with existing HEAD ownership. This uses the original staged status before reconciliation can reinterpret a protected partial-run add as a modification. The partial-run case with an existing matching protected byte claim remains supported.

HEAD and index manifests provide collision/invalid-identity evidence, not new membership authority. Unreviewed existing or newly staged package names are not appended. Prior authorized names are retained and deterministically sorted. Existing-path renames, moved ownership, duplicate names, malformed manifests, attempts to retroactively admit an existing committed package, and worktree/index review drift fail. The checks run before authority publication, and negative fixtures verify unchanged lock bytes after rejection. Existing lineage and atomic transaction recovery behavior remains covered by the same suite.

The author froze the two paths after type-narrowing and regex hoisting. This reviewer ran the full lineage file against those final hashes, rather than relying on the author's earlier green run before those static edits. **37/37 passed** at 19:18:49 KST in 34.98 seconds. The run includes the twelve new membership cases and existing baseline/prior-claim/scope/hash, move/delete, partial-update and crash-recovery controls.

This reviewer did not execute the updater against the owner's actual index, lock or authority metadata. The tests create fresh temporary Git repositories and direct the updater to them through its explicit repository-root input. The coordinator remains responsible for the actual reconciliation and subsequent offline/whole verification.

## Capture diagnostics and workflow-decision authority

The existing coordinator already retained a safe typed capture diagnostic, then attempted to bind supplied workflow decisions against the incomplete design analysis. A binding exception could therefore hide the original collection failure.

The repair passes no accepted decisions to coverage calculation when `design.complete` is false. If the request contained decisions, coverage remains explicitly incomplete and records `WORKFLOW_DECISIONS_REQUIRE_COMPLETE_CAPTURE`. The original request retains those supplied decisions for evidence and later explicit replanning. No decision is rebound or promoted to accepted authority.

The new coordinator cases assert the original failed-capture code/stage or partial-capture issue, `design.complete:false`, no capture descriptor, zero accepted decisions, unchanged stored request, `needs-input`, no coding lease and zero generation attempts. The existing complete-design case still permits a correctly bound decision and rejects an obsolete analysis hash with `PORTAL_WORKFLOW_DECISION_NOT_BOUND`.

The reviewer inspected the actual `portal_start`/`portal_next` admission conditions and the narrow production diff. No capture, freshness, scope or generation gate was relaxed. A controlled `CHROME_CONNECTION_REQUIRED` fixture is not evidence of the specific hidden cause of the earlier live R5 failure; that cause requires the coordinator's next authorized live observation.

The authoritative independent integrated run used the ordinary native workspace with no managed alias and passed **43/43** at 19:15:01 KST in 74.68 seconds: 33 coordinator, six capture-flow and four capture-failure cases. It used service fixtures with injected capture/work ports and temporary state. No user Chrome or actual daemon was contacted. An earlier managed validation attempt had started before the coordinator's native-copy notification; its final result is not used for this conclusion. The retained native JSON is the review's source-bound execution evidence.

## Mandatory Chrome-suite discovery

The additional one-line test change extends the existing launcher-discovery expression to recognize literal `web/tests/chrome-check.mjs` and `web/tests/approval-check.mjs` child entry points. The new portal browser test launches Chrome through those service-owned subprocesses, so the old direct-launch-only expression missed it even though the mandatory registry already included it.

The comparison still requires exact equality between discovered launcher files and the eleven registered mandatory Chrome files. Every registered file must still contain `requireChrome(`. No production prerequisite guard, skip rule, required registry entry or runtime assertion was removed by this adaptation. The independently executed complete census file passed **16/16** at 19:16:31 KST. The coordinator's earlier 17-pass/one-failure combined docs/census result remains separate initial evidence in native `.cache/portal-integration-docs-census-20261011.json`; this reviewer did not replace it.

## Commands and retained execution evidence

Capture/coordinator and census commands ran from native `service`:

```powershell
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/coordinator.test.ts packages/mcp/test/portal/capture-flow.test.ts packages/mcp/test/portal/capture-failure.test.ts --no-cache --maxWorkers 1 --reporter=default --reporter=json --outputFile=.cache/integration-followup-capture-20261011.json
node node_modules/vitest/vitest.mjs run test/test-skip-census.test.ts --no-cache --maxWorkers 1 --reporter=default --reporter=json --outputFile=.cache/integration-followup-census-20261011.json
```

The frozen updater command ran from managed `4d3e/service`:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 --project root test/service-fork-lineage.test.ts --reporter=default --reporter=json --outputFile=C:/2026_project/super-figma-pipline/.worktrees/_cache/integration-followup-lineage-20261011.json
```

Native MCP TypeScript and scoped capture/census lint/format checks passed. Managed tool-script TypeScript and two-file updater lint/format checks also passed; their exit codes were individually checked. All commands used direct installed binaries. No install, package upgrade, generated build, real metadata reconciliation or whole check was performed by this reviewer.

## Exact reviewed files

All five main/native hashes were checked equal at 19:20:02 KST and verified unchanged again after static checking at 19:22:42 KST. The updater pair also matches the author-frozen managed source used for its tests. The capture pair matches the author-frozen source copied before the native run. The table includes the later census test-only adaptation explicitly.

| Path relative to `service` | SHA-256 |
| --- | --- |
| `scripts/update-service-forks.mjs` | `3a767d13dd766db0ed2e948de220571962920563393ebbd39afa6d9f15535777` |
| `test/service-fork-lineage.test.ts` | `747ffd6190ff8dfcd1ed6165f4599577b710db3ae5aa42149e6675c3c92c448f` |
| `packages/mcp/src/portal/coordinator.ts` | `8c0cf3f0f93acd3bba25487833c0a51075233bc551b609c5d0eb94c68ebf87c9` |
| `packages/mcp/test/portal/coordinator.test.ts` | `687dcaeaad5b8419744e0dd9aee5024f55a756e500d0e14f87a0fc4bd5fe56ac` |
| `test/test-skip-census.test.ts` | `7fb711267f6d9e9f1bbf77aa22529b5e1a0aaff746da25c422aab70829554aab` |

These are bounded file identities, not the whole-service fingerprint. The coordinator must recompute the full baseline after reconciliation and generated metadata stabilization before relying on whole-source gates.

## Limits and continuation

The reviewer wrote only this English report and test execution evidence. All implementation changes and copying into main/native were performed by their assigned owners. The tests used owned temporary repositories/state under the same Windows owner account, which provides no OS security sandbox. No source Figma session, real daemon, actual capture, model generation, application, native browser approval, Codex browser connector, Docker, commit or owner-index mutation was performed by this review.

The coordinator can proceed with the exact reviewed files, actual authority reconciliation and the integrated offline/whole/artifact checks. Preserve the independent web round-2 failures and passing repairs as prior evidence rather than treating this followup as a replacement for those rounds. A new authorized live run must separately establish source acquisition and applicable generation/acceptance. No new product decision is required for these bounded fixes.
