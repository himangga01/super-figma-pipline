# Task 6G canonical annotation writer: independent review

Verdict: changes required for the newly enabled annotation batch inverse. The standalone writer and canonical registration have useful working coverage, but the batch path can overwrite an unrelated concurrent edit and can falsely claim successful rollback.

## Reviewed scope and identity

Reviewed the frozen 16-file manifest `task-6g-annotations-owned-files.json`, including shared input/result schemas, canonical MCP registry and policy/data classification, actual plugin registry, mutation snapshots, writer, inverse and tests. All 16 isolated source hashes and main-tree preimages matched the manifest before validation. The initial manifest/report are retained as `task-6g-annotations-initial-owned-files.json` and `task-6g-annotations-initial-report.md`.

The installed `@figma/plugin-typings` Annotation, AnnotationPropertyType, AnnotationsMixin and AnnotationsAPI declarations agree with the proposed API shape and 33 writable property names. Category lookup and the direct writer's final preimage/cancellation/readback checks were inspected. The higher-level converter, conditional recipe execution and generated contract refresh are explicitly outside this frozen primitive and remain required later.

No production source, main working tree, dependency, Git state or live Figma/Chrome document was modified. Tests use actual handlers with controlled host objects in the separate native working copy; this is not a claim of live account support or an OS sandbox.

## R1 — P1: a rejected stale annotation write still overwrites the concurrent edit in batch rollback

Locations: `packages/plugin/src/handlers/batch.ts:366` enables the generic inverse; the snapshot assignment occurs at line 56 and the failed operation is unconditionally included at lines 476-480. The standalone writer correctly throws `ANNOTATION_PREIMAGE_CHANGED` after asynchronous category lookup, before its own assignment.

Concrete reproduction:

1. The batch captures `[{ label: "Existing" }]`.
2. During `getAnnotationCategoriesAsync`, another edit changes it to `[{ label: "Concurrent user edit" }]`.
3. `set_annotations` detects the changed preimage and rejects without writing its requested value.
4. Batch rollback assigns the earlier snapshot to the failed operation anyway, erasing the concurrent edit.
5. The error says `BATCH_ROLLED_BACK`. The actual mutation wrapper sees the original final value and `settleHandlerFailure` reports `false`, so the unwanted rollback assignment is not identified as a document change.

The new exact-preimage guarantee therefore holds only for the raw handler, not its reachable canonical batch path. Use an annotation-specific inverse that knows whether and what this invocation actually wrote. A failure before writing must not perform restoration. After a write, undo must compare the currently observed value against that invocation's owned output before restoring; an unrelated later edit must be preserved and reported as a conflict/partial rollback.

Acceptance coverage should include asynchronous category/preimage failure, cancellation before write, a concurrent edit after a successful write, and multiple annotation writes to the same node in one batch. Mutation state must come from actual write outcomes, not a caller boolean or an assumed successful handler return.

## R2 — P2: an ignored restore is reported as a clean annotation rollback

Locations: `packages/plugin/src/handlers/batch.ts:50-58` performs the generic assignment without a readback; lines 486-494 decide the rollback result solely from thrown undo errors.

A controlled host setter accepts the requested `Desired` annotation but ignores restoration to `Existing`. A later rename operation fails. The batch's annotation undo returns without throwing, so the result is `BATCH_ROLLED_BACK` and a message saying the operation was restored, even though the node still contains `Desired`.

This is the rollback equivalent of the ignored-setter case that the direct writer already checks. The annotation inverse must reread and verify the restored preimage. Ignored, normalized-to-different or unreadable restoration must produce `BATCH_PARTIAL_CHANGE` (or an equally explicit non-restored state), with mutation accounting retained accurately. Do not silently broaden generic inverse behavior without its own scope and tests; a dedicated annotation inverse is sufficient for these findings.

## Reproductions and validation

Retained diagnostic:

`C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/plugin/test/handlers/review-6g-annotations.diagnostic.test.ts.disabled`

SHA-256: `d0a719ab923ab8d4db1878a17432f612ae8b38bffc30d9319561e7d572345614`.

It was run as the same path without `.disabled`, then renamed in place with unchanged bytes. Both diagnostics passed because they assert the reproduced incorrect behavior. The file imports and exercises the actual batch, annotation writer, rename handler and mutation wrapper; it does not copy their implementation.

Run/filter:

    node node_modules/vitest/vitest.mjs run packages/plugin/test/handlers/review-6g-annotations.diagnostic.test.ts --maxWorkers=1

Result: 2 reproduced findings, 505 ms, September 15 at 09:05:50. For independent reproduction, use the exact retained bytes under a temporary test filename or temporarily restore its test suffix, then retain the diagnostic again.

The implementation's complete reported selection was independently rerun:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/set-annotations.test.ts packages/plugin/test/handlers/set-annotations.test.ts packages/plugin/test/handlers/get-annotations.test.ts packages/plugin/test/handlers/batch.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/policy/result-egress-policy.test.ts --maxWorkers=1

Result: all 69 tests passed, 4.13 seconds, September 15 at 09:07:34. Those tests do not cover either failing inverse condition. Their passing status is retained alongside, rather than substituted for, the two additional findings.

## Other review observations

The direct handler correctly rechecks its preimage and cancellation after category lookup and checks actual authored fields after assignment. Schema bounds, plain/rich format separation, existing-category validation, pinned property membership, result classification and normal request replay appear consistent with the bounded primitive. No additional blocker was found in those portions. The requested fixes and an independent rereview remain necessary before integrating this slice.
