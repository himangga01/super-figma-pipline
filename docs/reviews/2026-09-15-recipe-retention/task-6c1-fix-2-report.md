# Task 6C1 fix 2: Align opaque step identifiers

Date: September 15, 2026. Status: bounded fix complete and frozen for independent review. No main integration was performed.

## Accepted finding and exact correction

The independent fix-1 review reproduced F2: a later step identifier accepted by `ExecutableRecipeSchema` could fail the new retention contract after an earlier `create_frame` had committed. The controller independently reproduced both diagnostics before authorizing this correction.

`RecipeEvidenceBindingSchema.stepId` now accepts the same nonempty string with a maximum length of 256 as the existing executable recipe contract. The narrower 160-character ASCII regular expression was removed. Step IDs are inputs to canonical binding/stable-key hashes and signed record fields; they are not filesystem paths. No ID is trimmed, normalized, shortened, encoded into a different identifier, or otherwise rewritten. The existing plan's internal-prefix rule remains unchanged.

This is the only production change. Owner/session/workspace checks, original operation IDs, target/argument/schema binding, immutable claims, default canonical routes, capture ceilings, full-maximum reservation, legacy accounting, retention locks, current source guards and completion readback were not altered.

The maintained default-protocol fixture now accepts a later step with a space, a 161-character ASCII identifier, and 256 repetitions of Korean syllable U+AC00. Each case runs the real default retention service path, completes both canonical primitives, and checks the unchanged ID in the local step intent and signed server hold index. A 257-character Korean identifier is rejected by the complete plan before any primitive executes. The string length convention is the same existing Zod/JavaScript string bound used by the plan; this change does not introduce a different grapheme-counting rule.

## Validation

Commands ran natively in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

- Targeted new cases: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts -t 'opaque step identifier|beyond the shared limit' --maxWorkers=1`: **4 passed**, 37 cases filtered by name, 47.11 seconds.
- Full client/default-protocol suite: `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/recipe-retention-client.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **52 passed**, three files, 122.43 seconds.
- Full affected service suite: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/recipe-evidence-hold.test.ts packages/mcp/test/execution/egress-finalizer.test.ts packages/mcp/test/fs/operation-evidence-artifact-store.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/service-operation-name.test.ts --maxWorkers=1`: **155 passed**, one existing platform skip, seven files, 14.31 seconds.
- Total maintained affected tests: **207 passed and one existing skip**. The four targeted cases are a subset, not an additional total.
- Changed two-file lint/format and exports-focused Knip: exit 0.
- Shared package TypeScript passed on the latest three-package check. CLI/MCP checks encountered in-progress non-owned errors in `packages/mcp/src/tools/set-annotations.ts:12` (TS2375, the annotation input schema's inferred intersection) and `packages/mcp/test/portal/core-lifecycle.test.ts:14` (unresolved relative module import). No fix-2 file was reported. The controller was notified; no foreign source was edited. This report does not claim those final whole-package checks passed.

The original two-case reproduction remains disabled and byte-identical at `packages/cli/test/review-6c1-step-id.diagnostic.test.ts.disabled`, SHA-256 `13cd5f0dca70142202efebed22d9196440794fae93b8ad4b17ade150db363585`. Its passing assertions establish the pre-fix failure and must not be counted as fixed behavior tests. The controller's independent reproduction is recorded in the parent task.

## Frozen files and preimages

`task-6c1-fix-1-full-owned-files.json` preserves the reviewed 22-file baseline. `task-6c1-final-owned-files.json` now contains all 22 final hashes and original main preimages. `task-6c1-fix-2-owned-files.json` contains only the two changed paths with their pre-fix hashes. Every unchanged source hash and every main preimage was rechecked before writing the manifests.

| File | SHA-256 |
| --- | --- |
| packages/mcp/src/portal/recipes/evidence-contract.ts | 180a9967bac4cf46086cda31499d2c8c85f276aed84c3894b778eea60bb8584d |
| packages/cli/test/recipe-runner.test.ts | e64de70dc0e068b05762e00e234ea19262d2609756ea2cabd7cc8d9658e702ea |

The original 17-file initial manifest, quota fix report, independent fix-1 review and diagnostic evidence remain preserved. A different reviewer/controller must verify the two corrected paths before integration because the independent reviewer implemented this authorized fix after the controller reproduced it.

The original scope limits remain: same-session owner authority is required, cross-session recovery needs separately admitted current authority, and the captured-result ceiling does not claim control over transient memory or unrelated native assets. No browser, live Figma, daemon, Docker, Superpowers, dependency installation, build, Git mutation or unrelated source edit was used. The native working copy shares the Windows account's filesystem/process/network privileges and is not an OS sandbox.
