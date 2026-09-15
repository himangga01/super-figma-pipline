# Task 6A fix 1: Conservative canonical effect declarations

Date: September 15, 2026. Status: reviewed finding F1 addressed; independent main verification pending. This remains a contracts/catalog subtask, with all recipes planned and no executor or portal lifecycle integration.

## Verified finding and correction

Main's P2 finding was valid. I independently ran `packages/mcp/test/portal/review-task6a-effects.test.ts` before editing. Both tests failed and reported the exact three missing effects: `transfer-instance-overrides:swap_component:library-import`, `export-handoff:export_frames_to_pdf:read`, and `diff-design:design_diff:artifact-write`.

The shared schema previously chose one effect category per tool. It now validates the full conservative set for each of its 46 allowed canonical step tools. Since these skeletons do not constrain arguments, `create_instance` and `swap_component` require both design write and possible library import; `design_diff`, PDF export and token export require read and possible artifact write. Direct library-variable import has its actual library-import effect. Every missing effect is rejected independently. This projection supplements the planned definition contract; it does not replace actual canonical admission.

The three frozen recipe declarations are corrected. Definition identity now explicitly hashes the complete shared effect projection in addition to behavior/verifier versions, structural schemas and limits, so changed effect semantics invalidate earlier definition hashes.

A new ordinary regression imports actual `OPERATION_POLICIES`, compares every supported step tool's entire possible-effect set against the shared projection, checks every catalog step and rejects each individually omitted required effect. Unknown canonical effect types fail the test; there is no exclusion list or default ignore. Additional regressions reject the previously accepted narrow diff/export/swap/component declarations.

The unused `portalRecipeConsumptionContentHash` export is now exercised by a meaningful receipt identity test. It verifies canonical result ordering and that candidate, applied-target, owner, workspace, blueprint, declaration, verifier, result-set, evidence, source-root and state changes alter identity. Malformed generic reviewed flags reject. This tests content binding, not actual runtime verification or signature authority.

## Final verification

All commands ran natively under the same Windows account in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`; this is a separate working copy, not an OS sandbox.

| Check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/shared/test/portal-recipes.test.ts packages/shared/test/portal.test.ts packages/mcp/test/portal/recipe-definitions.test.ts packages/mcp/test/portal/review-task6a-effects.test.ts --maxWorkers=1` | 4 files, 26 tests passed, 1.70 seconds, exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json` | Exit 0 |
| Owned production/test `oxlint --deny-warnings` | Exit 0, no warnings/errors |
| Six owned paths `oxfmt --check` | All matched files formatted, exit 0 |
| `node node_modules/knip/bin/knip.js` | Exit 0, no findings |

The final 26-test sweep includes the two original main diagnostics, which were not edited. The integration-owned three-file sweep accounts for 24 tests. During development, one new test initially expected a different Zod error phrase; its expectation was corrected to the actual invalid-discriminator error. Initial and final evidence is retained without claiming that this was a production behavior failure.

## Changed delta and full manifest

Only three of the original six owned source paths changed. `task-6a-owned-files.json` now contains all six final hashes and unchanged original main preimages. `task-6a-fix-1-owned-files.json` contains the three-path delta, plus `previousHash` for the initial reviewed isolated bytes. Main's preserved `task-6a-initial-*` evidence remains untouched. The original main shared-index preimage still matches; all other owned paths remain absent from main.

| Changed service-relative path | Final SHA-256 |
| --- | --- |
| packages/shared/src/portal-recipes.ts | 5d50e138a17a2b62f608e70d7843bab52ca41903e72fad01337d53e5131f516e |
| packages/mcp/src/portal/recipes/definitions.ts | c3d3cc25a29a449f10e8f267eec5c8bb9ff26039ae014210af839098d04892f8 |
| packages/mcp/test/portal/recipe-definitions.test.ts | f005c8cfad6b5c51afe5cb28d443ae6434c52b2768e1bbbada382640ef698c57 |

No other source, diagnostic, browser, daemon, build, dependency, Git or original upstream state was changed. No Superpowers, Docker or subagent was used. Source is frozen for main review.

## Remaining limits

All previous handoff limits remain: definitions are non-executable skeletons; actual typed parameter adapters, dependent owner-client execution, retained outputs and crash recovery, persistent owner-wide retention, portal lease/application gates, mechanical consumption and source-bound review receipts must still be implemented. A narrower local-only or no-output branch needs a closed validated argument restriction and new definition identity before its declared effect set can be reduced. This fix does not authorize effectful work itself.
