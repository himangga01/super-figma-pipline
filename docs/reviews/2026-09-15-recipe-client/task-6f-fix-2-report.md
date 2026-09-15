# Task 6F fix 2: Match canonical clone append order

Date: September 15, 2026. Status: ready for focused independent review. Production retention and the broader authoring task remain incomplete.

## Accepted F1 correction

The controller reproduced the mismatch between the client model and the actual exported `createCloneNodeHandler`: the handler explicitly calls `parent.appendChild(copy)`, while the client inserted the copy immediately after the original. When another sibling followed the original, a legitimate completed clone incorrectly failed reconciliation.

The clone branch in `packages/cli/src/recipe-plan.ts` now appends the already validated produced subtree. It still checks that the original belongs to the expected parent, binds the produced IDs and parent relationships to the original receipt and predeclared postimage, and compares the entire expected tree to the observed tree. Existing sibling order, IDs and values must remain unchanged. No currentness, coverage, identity, result, retention, or full-tree comparison check was removed or relaxed.

The maintained HTTP fixture's clone path now invokes the **actual exported canonical handler**, loaded through `vi.importActual`. Its bounded document port supplies node lookup, recursive cloning and `appendChild`; the test no longer copies the handler's sibling-placement algorithm. The runtime import uses a narrow fixture signature so importing the plugin's ambient Figma types does not contaminate CLI TypeScript compilation.

The strengthened regression has an original node with a recursive child and a following sibling. It simulates a client crash after the clone's retained checkpoint, verifies `[original, following sibling, copy]` ordering and the copy child's new parent ID, resumes successfully, and confirms exactly one original `clone_node` dispatch. The original subtree remains equal to its preimage.

The production primitive was not changed. Its current MCP tool description still says the copy is placed immediately after the original, contrary to the actual handler; that separate metadata correction was reported to the controller for its later routing/provenance work and is outside this two-file fix.

## Validation

Commands ran in the native separate validation copy at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- Focused regression: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts -t 'actual canonical clone handler' --maxWorkers=1`: one selected test passed, 35 filtered by the name selector, 5.50 seconds.
- Affected suite: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **39 passed**, two files, 51.11 seconds.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json`: exit 0.
- Six owned-file `oxlint --deny-warnings` and `oxfmt --check`: exit 0.
- Exports-focused Knip reported one concurrent, non-owned Task 6C export: `createRecipeEvidenceOperations` in `packages/mcp/src/portal/recipes/evidence-operations.ts`. No owned Task 6F export was reported. This is not a whole-repository Knip pass; the controller was informed.

The fix-1 review diagnostic remains disabled and unchanged, SHA-256 `babf775e09471378fe48c1159ca3f39bf7421d9cd58950146a7695534b2f2c08`. The initial and fix-1 review evidence remains preserved. No diagnostic fixture was integrated.

## Scope and hashes

Only the two files below changed from the reviewed fix-1 bytes. `task-6f-fix-2-owned-files.json` records the delta with pre-fix hashes and original main preimages. `task-6f-owned-files.json` is the updated full six-file allowlist. The fix-1 full manifest and diff remain under `task-6f-fix-1-full-*`.

| File | SHA-256 |
| --- | --- |
| packages/cli/src/recipe-plan.ts | 623a5faa0a73f5892225550510c7335fe6413e8718a785617a8a4563e99d2a32 |
| packages/cli/test/recipe-runner.test.ts | 9494272aaccf48aafb17daa0e27a4f4b78a1f7212ceb1ccf4bb74c259bc21552 |

All fix-1 point-in-time read/write/ABA limitations, conservative parent-transition models, source-subtree bounds and unchanged-session fences still apply. Production execution remains unavailable by default until Task 6C's real retention adapter is wired. No browser, live Figma, daemon, Superpowers, Docker, dependency, build or Git operation was performed. The validation process shares the Windows user's permissions and is not an OS sandbox.
