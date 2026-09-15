# Task 6F fix 2 independent review

Date: September 15, 2026. Verdict: PASS for the two-file F1 correction. No new actionable finding in this bounded review.

## Confirmed correction

`recipe-plan.ts` now appends the validated clone subtree, matching the actual canonical `createCloneNodeHandler`. It still requires the original to belong to the observed parent, preserves all existing sibling order and values, checks new structural IDs and parent relationships, binds the produced subtree to the original operation receipt and predeclared postimage, and compares the full modeled tree with the actual observed tree. Full-tree equality was not weakened.

The maintained HTTP fixture loads the actual exported handler with `vi.importActual` and invokes it through a bounded document port. The regression now contains an original with a recursive child and an existing following sibling. It observes `[original, following sibling, copy]`, verifies the copied child's parent ID, interrupts after the durable clone checkpoint, resumes successfully and asserts exactly one `clone_node` dispatch. The original subtree remains unchanged. This reproduces the production placement behavior that the previous fixture missed.

The currentness, upfront source coverage, final fresh readback, receipt/retention checks and durable original-ID recovery code remain unchanged from the reviewed fix-1 versions. The corrected append operation remains within those checks.

## Independent validation

Command: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts -t 'actual canonical clone handler|rejects changed source|completed resume|later unobserved literal|unexpected produced value|produced postimages' --maxWorkers=1`.

Result: **7 passed**, 29 filtered by the name selector, 13.37 seconds. Selected coverage includes the actual-handler clone/restart regression, source changes during ordinary execution and after restart, stale completed-state rejection, upfront later-target coverage, predeclared postimage rejection and structural normalization.

All six owned hashes matched the current full manifest. The two corrected files are:

| File | SHA-256 |
| --- | --- |
| `service/packages/cli/src/recipe-plan.ts` | `623a5faa0a73f5892225550510c7335fe6413e8718a785617a8a4563e99d2a32` |
| `service/packages/cli/test/recipe-runner.test.ts` | `9494272aaccf48aafb17daa0e27a4f4b78a1f7212ceb1ccf4bb74c259bc21552` |

Both earlier diagnostic files remain disabled and unchanged, with their recorded hashes `caee75e0368ef098925d74f407205ec453989c641ac4608bf249b57a1d477616` and `babf775e09471378fe48c1159ca3f39bf7421d9cd58950146a7695534b2f2c08`. No owned file or diagnostic was edited during this review.

## Remaining scope

The existing MCP tool description still says the clone is inserted immediately after the original. Its metadata correction is already reported to main and is outside this two-file implementation review. It should be corrected before broader recipe-generation claims rely on that description.

This PASS does not complete production retention integration, advanced recipes, public routing or live authoring. The stated point-in-time consistency and same-session limitations remain accurate. Validation used the native separate working copy and shares the Windows account's filesystem/process/network permissions; it is not an OS sandbox. No Superpowers, Docker, subagent, browser, live Figma, daemon, build, dependency or Git mutation was used.
