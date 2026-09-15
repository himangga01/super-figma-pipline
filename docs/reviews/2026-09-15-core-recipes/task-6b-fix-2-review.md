# Task 6B independent final fix review

Date: September 15, 2026.
Verdict: Scoped PASS. No additional actionable finding in the original implementation plus fixes 1 and 2.

## Reviewed scope and independence

The reviewer did not implement Task 6B. Reviewed the final eight files from task-6b-owned-files.json, original review and reports, fix-1 report/snapshot, fix-2 report/delta, and actual source consumers. All eight final isolated hashes and original main preimages were independently recomputed and matched. No Task 6B production or test file was edited.

This passes the bounded core derivation and qualified source-context slice. It is not a whole-code review round, portal owner-admission proof, persisted recipe adoption, candidate/runtime consumption proof or live Figma acceptance. Later Task 6C/6D/6E authority remains necessary. The WeakMap capsule binds a real in-process derivation; it is not permission or a signed transport artifact.

## Findings adjudication

R1 is addressed through the real preparation path. prepareCoreRecipeSources analyzes actual graphs in the ordered source batch and calls the existing selectPortalServices. Per-source selected/dependency closure roots and effective layers flow into strategy and mapping. Byte inventory and root identity remain full-root bindings. Scoped discovery filters the canonical semantic walk before component/token/icon parser caps and joins, while full-root direct read/path authority remains intact. Selected profiles supply extensions, utility/SVG conventions and rebased configuration paths. This avoids excluded sibling backend layers or mapping candidates influencing an explicitly selected frontend.

R2 is addressed through exact semantic review matching in the actual selector. Source ID, global index, diagnostic code, source path/hash and offset must match actual retained diagnostics. The core uses selection completeness rather than treating every raw graph uncertainty as unreviewable. Raw diagnostics and exact review material remain in source pages. Syntax/inventory/discovery/pattern limits and truncated diagnostics continue to block. Semantic review retains conservative closure and cannot invent a narrower dependency scope.

The short-root defect is corrected consistently in both actual graph construction and core ownership projection. Root '.' has specificity zero, so a one-character root owns its own files and a longer nested root still wins. The graph diff is exactly this comparator correction. The service-selection.ts diff contains only its two graph-only input type changes; no hidden runtime selection-policy change was found.

Ordered batch membership is enforced when capsules are qualified or reviewed. Same-path multiple sources cannot be ambiguously selected by an unqualified root string, omitted from their prepared batch or silently reindexed. Independently prepared unreviewed whole-root sources retain the explicitly documented compatibility behavior. Source-context rows and source fact/mapping links remain present, and page validation checks typed membership, context identity, inventories, mapping membership and canonical hashes. Hash self-consistency is not misrepresented as owner authority.

## Independent validation

Ran:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-recipes.test.ts packages/shared/test/core-recipe-pages.test.ts packages/shared/test/portal-recipes.test.ts packages/mcp/test/portal/recipe-definitions.test.ts packages/mcp/test/portal/service-graph.test.ts packages/mcp/test/portal/service-selection.test.ts --maxWorkers=1

Result: five actual files, 75 tests passed, 14.38 seconds. There is no standalone service-selection.test.ts file; that extra filter matched nothing. The five named existing files all ran, including real selection/review tests in core-recipes.test.ts. No sixth-file coverage is claimed.

An additional independent real-filesystem probe combined two same-path reference roots, selected source index 1 with one-character service 'a', its real import dependency 'b', and unrelated prefix sibling 'ab'. It verified:

- Effective structure is exactly 'a' and 'b' from the selected reference.
- Source index 0 has empty closure and effective layers.
- Source index 1 retains frontend/backend layers and complete qualified closure.
- Canonical component mapping selects only a/Button.tsx from source index 1.
- The related backend layer does not receive a false missing-layer construction obligation.

Command:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-6b-qualified-short-roots.diagnostic.test.ts -t 'independent review:' --maxWorkers=1

Result: one independent diagnostic passed, 42 inherited tests filtered by name, 1.71 seconds. The diagnostic was retained by in-place rename after the run so it cannot enter ordinary suites:

    C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-6b-qualified-short-roots.diagnostic.test.ts.disabled

SHA-256: 9f0518d61b3d8d04c1f10ac79ee5d80c86518ff8d8d256aca1b9e341b59aee33.

The probe did not change production source. Type/lint claims for this slice remain the author's final evidence; the independent runtime checks above are the reviewer's own runs. All work used native tooling in the separate working copy with the same Windows account's filesystem/process/network privileges, not an OS sandbox. No Superpowers, Docker, dependency installation, build, live daemon, browser/Figma access, Git mutation, commit, push or main integration occurred.

## Exact reviewed hashes

| Service-relative file | SHA-256 |
| --- | --- |
| packages/shared/src/portal-recipes.ts | d30f92999cf21829b556dde6fee2d151c57ecb4f82903a5c0618fd710b295c90 |
| packages/shared/test/core-recipe-pages.test.ts | b5a59323a4d7c682538449bba0f0f51c4b03592c6162d65f4bdf575ccf5ebea8 |
| packages/mcp/src/portal/recipes/core-source.ts | e06ebc3686d4e50a4ad0396db006ed317719b575b8bf3cead2b4a43ee6e9132b |
| packages/mcp/src/portal/recipes/core-derivation.ts | 3bfe821361cf4f01677ab30e5cb08b514b5fe67395b755b3eaf15b97690acaa6 |
| packages/mcp/test/portal/core-recipes.test.ts | d069c1da3bac737b36ae5c38d346409107db632167a9c65a43041364f8726ea3 |
| packages/mcp/src/portal/service-selection.ts | 71a5d6cb637761f96d137594aba676e72156daa7149a0ad4fd7dd3f8b7051b93 |
| packages/mcp/src/portal/service-graph.ts | f8d3d0d590647ccfc49adb3b1b02efc737edac23f95011d3b3b3d1cdcddc5943 |
| packages/mcp/test/portal/service-graph.test.ts | b454b277ddc8c3487d738366a7760d8e278216c51b90d26c8cd5efe713653cf7 |

Main should recheck these hashes and preimages before integrating only the eight-file allowlist. Imported theme evaluation, unsupported Vue runtime semantics, motion/interaction execution, persistent authority and live service validation retain the explicit boundaries in the implementation reports; this review does not promote those pending layers to completed behavior.
