# Task 6F fix 1 independent review

Date: September 15, 2026. Verdict: changes required for one concrete transition-model mismatch. Original R1, R2 and R3 are addressed within the stated point-in-time guarded model.

## F1 — P2: clone reconciliation disagrees with the actual canonical handler's sibling order

The clone branch of `service/packages/cli/src/recipe-plan.ts` inserts the produced subtree immediately after the original with `parent.children.splice(position + 1, 0, ...)`. The actual canonical implementation, `service/packages/plugin/src/handlers/clone-node.ts`, calls `parent.appendChild(copy)`. These differ whenever the original is not the last sibling.

The maintained fixture also inserts immediately after the original; its positive clone test contains only the original child, making both behaviors indistinguishable. A diagnostic invoked the actual exported canonical clone handler with a minimal document port and two existing siblings. The handler produced `[original, sibling, copy]`. Passing that actual observed result to `reconcileRecipeMutation` rejected with `RECIPE_SOURCE_CHANGED`, despite the exact predeclared produced-subtree hash and otherwise unchanged source. The clone has already committed at this point, so a supported legitimate operation leaves a blocked partial recipe. Recovery repeats the incorrect model and cannot settle it.

Required correction: model the canonical handler's actual append semantics, and update the fixture to reproduce those semantics. Add a non-last-sibling positive case that validates the entire sibling order and no duplicate mutation on recovery. Do not merely weaken full-tree equality or approve the observed order after the effect. Changing the production primitive instead would require separately assessing its existing behavior and callers; correcting this client model is the narrower fix.

## Accepted fixes verified

- R1: original reads reconstruct history only. New pending effects receive distinct fresh canonical source observations; expected state advances through modeled mutations and predeclared creation postimages. Restart after a completed mutation recovers the original write, while a missing post-read can reconcile the exact modeled transition. Changed source blocks before the next effect. Unknown original write/read outcomes still block instead of being reissued as a replacement write.
- R2: all literal mutation inputs receive upfront coverage checks against the original guarded tree, including later targets before an earlier effect. Resolved generated references are checked against the modeled tree. Unsupported parent/layout cases reject conservatively.
- R3: every successful return obtains a new full-source observation and applies final assertions to that current tree. Completed resume returns a distinct `currentReadback` operation/receipt without repeating mutations; changed final state rejects.
- Postimage normalization removes structural node `id` and `parentId` only while traversing actual `children`. Independent diagnostic checks confirmed nested variable alias IDs, style IDs and nested value IDs remain significant. Structural ID remapping alone preserves the hash, but invalid internal parent links reject. Generated IDs remain bound through the actual creation receipt, unique/new-node checks, exact parent relationships and subsequent full-source comparison.
- Internal observations have explicit operation names, immutable original IDs, exact argument/schema/owner/session/target bindings and retention reservations. Fresh observation slots are durably bounded at 512; post-read slots remain bounded by the 128-step recipe.

## Native validation and reviewed bytes

- Maintained focused suite: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **39 passed**, 51.22 seconds.
- Independent diagnostic suite: `node node_modules/vitest/vitest.mjs run packages/cli/test/review-task6f-fix1.diagnostic.test.ts --maxWorkers=1`: **2 passed**, 413 milliseconds. The clone test deliberately asserts the erroneous rejection to preserve the observed finding; the normalization test asserts correct behavior.
- All six current owned hashes matched `task-6f-owned-files.json`. The five changed files matched the fix-1 report; `control-client.ts` remained unchanged.
- No owned source or existing tests were edited. The original four unsafe-observation diagnostics were not enabled or changed. The new diagnostic is retained at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/cli/test/review-task6f-fix1.diagnostic.test.ts.disabled`, outside test discovery and integration scope.

## Scope and remaining dependencies

The currentness guarantees are point-in-time observations around separately admitted primitives, not an atomic source compare-and-swap or ABA protection. This limitation is stated accurately. Missing production Task 6C retention still fails by default. Changed control credentials/generation remain fenced; no old owner-session identity is rewritten. Cross-session admission, advanced recipe generation, public routing and live authoring remain explicit unfinished dependencies. This review does not mark those as complete.

Validation used the native separate working copy with the current Windows account's filesystem/process/network permissions, not an OS sandbox. No Superpowers, Docker, subagent, live browser, Figma, daemon, build, dependency or Git mutation was used.
