# Task 6B fix 2: Correct one-character service-root ownership

Date: September 15, 2026. Status: frozen for independent review; not integrated.

## Reproduction and correction

The final fix-1 inspection identified a real shared edge case: root `.` and a one-character service root such as `a` both had string length one. Stable sorting therefore chose `.` for `a/Button.tsx`. The controller approved a coordinated correction in the existing graph analyzer and core source ownership projection.

Two real-filesystem regressions were added before changing the comparators. Both failed against fix-1 bytes: graph service `a` had no `frontend` layer, and core mapping of `a/Button.tsx` was `unmapped`. The fixture also contains a nested `a/n` service and a sibling service, so it checks specificity rather than merely introducing another root.

Both comparators now assign `.` specificity zero and retain actual path length for other matching directory roots. A longer nested root still wins. No other graph construction, dependency, review, layer or mapping algorithm changed.

The graph regression verifies that `a` owns its frontend, `a/n` owns its backend, `.` does not absorb that frontend, and the real `a -> b` import dependency survives. The core regression verifies the actual canonical `a/Button.tsx` candidate, closure exactly `a`, retained full-root inventory identity, exclusion of nested/sibling backends, and the missing backend-construction obligation for the selected frontend reference.

## Validation

All commands ran natively in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

- Before correction: the two selected filesystem regressions failed as described above; 51 unrelated cases were filtered by name.
- Focused post-fix command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-recipes.test.ts packages/mcp/test/portal/service-graph.test.ts -t 'one-character' --maxWorkers=1`: two passed, 51 filtered, 2.50 seconds.
- Final exact command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-recipes.test.ts packages/shared/test/core-recipe-pages.test.ts packages/shared/test/portal-recipes.test.ts packages/mcp/test/portal/recipe-definitions.test.ts packages/mcp/test/portal/service-graph.test.ts --maxWorkers=1`: **75 passed**, five files, 13.47 seconds. This includes the preserved original 43-case core/contract sweep, the fix-1 additions, both short-root regressions and all existing service-graph tests.
- Final shared and MCP package TypeScript checks: exit 0. The earlier non-owned transient `core-preparation.ts` error was corrected by its owner; the final MCP check was rerun successfully.
- Eight owned-file lint/format and exports-focused Knip: exit 0.

An earlier full command used a redundant `portal/../` test path. Vitest normalized it and also reported all 75 cases; the final exact command above was rerun so no file-selection ambiguity remains.

The original diagnostic remains disabled and unchanged. No browser, live Figma, daemon, Superpowers, Docker, dependency, build or Git mutation was performed. Native process/filesystem/network privileges are shared with the Windows account, not isolated by an OS sandbox.

## Frozen evidence and integration

The 63-test fix-1 snapshot is preserved in `task-6b-fix-1-full-owned-files.json`, `task-6b-fix-1-full-review.diff`, and `task-6b-fix-1-report.md`. The original review and initial manifest remain unchanged.

`task-6b-owned-files.json` is the final **eight-file** allowlist with original main preimages, which were freshly verified. `task-6b-fix-2-owned-files.json` records the four-file delta below. The first two are modifications of fix 1; the graph source/test are the controller-approved additional scope.

| File | SHA-256 |
| --- | --- |
| packages/mcp/src/portal/recipes/core-source.ts | e06ebc3686d4e50a4ad0396db006ed317719b575b8bf3cead2b4a43ee6e9132b |
| packages/mcp/test/portal/core-recipes.test.ts | d069c1da3bac737b36ae5c38d346409107db632167a9c65a43041364f8726ea3 |
| packages/mcp/src/portal/service-graph.ts | f8d3d0d590647ccfc49adb3b1b02efc737edac23f95011d3b3b3d1cdcddc5943 |
| packages/mcp/test/portal/service-graph.test.ts | b454b277ddc8c3487d738366a7760d8e278216c51b90d26c8cd5efe713653cf7 |

The other four fix-1 files are unchanged. Original main preimages and exact hashes are available in the full manifest. No main integration or commit was performed. The guarded derivation scope and explicit canonical parser/profile limitations from fix 1 still apply; owner admission, durable preparation, portal lifecycle and native consumption remain separate integration work.
