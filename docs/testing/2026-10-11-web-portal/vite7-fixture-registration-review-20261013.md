# Vite7 frozen fixture registration: bounded review

Date: October 13, 2026, Asia/Seoul. Scope: read-only Git ignore behavior, frozen fixture hashes and intended source/provenance registration. Read-before references: [AGENTS](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md) and [C2 preparation review](c2-source-profile-preparation-review.md). Root owns all source/provenance changes.

Root's R27 offline `verify-upstream-lock --offline` gate failed `UNMANAGED_DESTINATION` for two integrated R50 Vite7 resolver text fixtures beneath `dist`. This result remains failed. Git's broad `dist` ignore rule had excluded those new frozen paths from Git-driven source fingerprint and reconciliation enumeration. Registering their exact reviewed paths is appropriate; renaming fixture bytes/paths, relaxing provenance or changing the owner's actual index is unnecessary.

Both frozen R50 fixture hashes independently match Main and native:

| Fixture under packages/mcp/test/portal/fixtures/vite7-resolver | SHA-256 |
| --- | --- |
| `dist/node/chunks/config.js.txt` | `c5d2cb692f24bb9d9de7dbd0b86506f1dada18c362aaa7c5a05d460870ced734` |
| `dist/node/module-runner.js.txt` | `e9e66cba21fc780ae9a5a64da48503afa49bf9bc25c69007333c7835b763b89c` |

## First five-line exception: changes requested

Root added only three ancestor-directory negations and two exact file negations. Main/native ignore bytes match, and `git ls-files --others --exclude-standard` currently exposes exactly the fixture license plus those two existing text files. Existing MCP/CLI/plugin/portal/IR/shared generated dist outputs remain ignored.

However, the directory negations also expose arbitrary other future children inside the approved fixture directories. Read-only `git check-ignore -v --no-index` reports no ignore match for `dist/node/config.js` or `dist/node/chunks/foreign.js.txt` beneath this fixture. These probe names were not created; this checks Git's path rules only. Existing-file enumeration alone does not establish exact two-file exception scope.

Recommended narrow correction: after re-including each ancestor directory, add an anchored `/*` child exclusion before re-including the next required directory or exact file. Keep the final exceptions restricted to the two frozen text files. Root should rerun only read-only ignore/path/hash checks and reconcile the resulting source inventory through its existing shadow-index/authority workflow. No test, force-add to the owner index, dependency install, build, native workload, live state or Chrome action was performed by this reviewer.

The final corrected ignore/source/provenance result remains pending at this entry. R27's failure must remain preserved rather than being rewritten as a pass. Final source/build/package/scoped-release evidence and public acceptance are separate. The validation process shares the Windows account's privileges and has no OS/process sandbox.

## Corrected eight-line exception: approved

Root added exactly the three recommended anchored child exclusions between the original directory/file negations. Complete Git diff now contains only eight added lines after the existing `dist` rule. Main/native ignore bytes remain identical. Independently repeated read-only path checks show the three hypothetical sibling paths under `dist`, `dist/node` and `dist/node/chunks` are ignored by their respective anchored child rules, while only the two exact reviewed text paths are re-included. No probe file was created. Existing MCP, CLI, plugin, portal, IR and shared generated dist paths remain ignored by the original broad rule. Git's current untracked fixture enumeration contains only the license and the two reviewed text files.

Both fixture hashes were rechecked after the correction and still exactly match frozen R50 in both Main/native. **Approve this exact narrow ignore registration change.** R27's prior offline failure and the rejected first five-line scope remain preserved. Root's R29 metadata reconciliation and actual offline verifier/final source/build/package results are separate pending gates; this approval does not claim they passed. No tests, product edits, provenance writes, actual-index changes, build or live actions were performed in this recheck.
