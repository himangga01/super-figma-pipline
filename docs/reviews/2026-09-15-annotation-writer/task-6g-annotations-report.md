# Task 6G canonical annotation writer

Status: Implemented bounded primitive; frozen for independent review. The higher-level annotation conversion planner and conditional recipe execution are still required. No main integration or Git delivery is claimed.

## Behavior

The new `set_annotations` canonical tool takes one node ID, the exact observed `expectedAnnotations` preimage and the complete desired annotation array. It supports plain or Markdown labels, existing category IDs and the 33 pinned property types in the installed Figma typings. Empty output clears only that admitted preimage. The tool does not execute arbitrary JavaScript, create categories or guess a target.

The contract is based on the official [Figma Annotation API](https://developers.figma.com/docs/plugins/api/Annotation/) and installed `@figma/plugin-typings` 1.135.0, inspected September 15. Figma's API documents assigning the node annotation array; availability and edit permission remain real host requirements. This implementation does not claim native annotation visibility or authoring support for every Figma account. The service's no-Dev-Mode capture path does not depend on this optional writer.

The shared schema bounds each array to 128 rows, each label to 16,384 characters, supported property membership/uniqueness and the aggregate input to 4 MiB / 50,000 JSON values. Unrecognized fields, conflicting label formats and empty annotation rows reject. Existing observed preimages may retain both plain and Markdown fields and unfamiliar pinned property names; output writes use the explicit supported property enum.

The actual plugin handler checks node support and resolves referenced categories. Immediately before its synchronous write it checks cancellation and re-compares the exact current annotation preimage, including changes during asynchronous category lookup. After writing it reads the actual host property and compares every explicitly authored field. An ignored setter cannot produce a successful result. Unrelated node properties remain unchanged.

Actual registry, plugin handler, mutation snapshot, operation policy, design-text input classification, public mutation-result schema and invertible batch authority are connected. Native mutation accounting now snapshots annotations. Batch rollback restores the original annotation array, and canonical request replay uses the existing idempotency/undo machinery. The tool remains governed by normal pinned target, write scope and client approval admission.

## Validation

Native working copy: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`, under the same Windows account, without an OS sandbox.

Command:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/set-annotations.test.ts packages/plugin/test/handlers/set-annotations.test.ts packages/plugin/test/handlers/get-annotations.test.ts packages/plugin/test/handlers/batch.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/policy/result-egress-policy.test.ts --maxWorkers=1

Result: 6 files, 69 tests passed, 4.30 seconds at 09:01:00 on September 15. Coverage includes actual registry parity, writer results, plain/rich/pinned/category values, stale preimages, concurrent category lookup, cancellation, ignored setter, canonical request replay and restoration after a later batch failure. Controlled Figma object fixtures exercise the actual handlers; no live user document was mutated.

The new test first failed because the handler did not exist. After implementation, two fixture call-shape mistakes were corrected to the actual mutation/batch signatures. Literal registry tests were extended by exactly one tool, one write and one batch inverse; no authority check was removed. A raw TypeScript command initially reported Vue module declarations, so the plugin was checked with its actual `vue-tsc --noEmit` toolchain. A test-only cross-package plugin import was moved into the plugin test project, avoiding contamination of MCP ambient types. The bounded JSON predicate's TypeScript narrowing was explicitly constrained to boolean without changing runtime validation.

Final plugin vue-tsc passed; MCP TypeScript passed after these corrections; owned 16-file lint and formatting passed. Generated plugin-contract/provenance snapshots will be refreshed with all settled contracts in Task 6H/final verification. This slice does not bypass those required gates or claim the full source suite has already passed.

Exact source hashes and original main preimages are in `task-6g-annotations-owned-files.json`; all 16 preimages were captured before edits and verified again before freezing. No dependency installation, Docker, Superpowers, live daemon/Chrome/Figma action, original code-kb change, main source copy, Git index mutation, commit or push occurred in this slice.
