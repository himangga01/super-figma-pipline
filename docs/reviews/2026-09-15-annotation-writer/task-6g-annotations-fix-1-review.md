# Task 6G annotation rollback fix 1: independent rereview

Verdict: PASS for the frozen three-file correction. Both original findings are resolved, and no additional blocker was found in this bounded annotation inverse. Higher-level annotation conversion, conditional recipe execution, generated contracts and final whole-service verification remain outside this review.

## Identity and scope

Verified all 16 final source hashes against `task-6g-annotations-owned-files.json`, and all original main-tree preimages. The three-file delta matches `task-6g-annotations-fix-1-owned-files.json`: the actual writer/private outcomes, specialized batch inverse wiring and five regression tests. No production or main-tree source was edited during rereview.

The implementation retains the existing canonical registry, target/write admission and public mutation result. Private WeakMap entries are tied to actual result/error object identities; transport-shaped data does not supply mutation proof. Frozen immediate pre-write and observed post-write annotation arrays preserve intermediate states for repeated writes.

## Finding dispositions

### R1: resolved

A preflight failure has no recorded annotation write outcome. The specialized inverse returns without assigning the old snapshot, preserving a concurrent edit made during category lookup or cancellation. After a real write, restoration compares current annotations to the recorded postimage; a later different value produces `ANNOTATION_ROLLBACK_CONFLICT` and `BATCH_PARTIAL_CHANGE`, preserving that later edit.

The batch passes the failed handler's error only to its corresponding inverse. Other inverse behavior is unchanged. Two annotation writes to one node unwind using their actual immediate preimages rather than one initial capture snapshot. A setter that mutates and then throws retains its actual failure outcome, allowing a conditional, verified restore.

### R2: resolved

After assignment of the recorded preimage, the inverse rereads and compares the actual annotation state. An ignored restore produces `ANNOTATION_ROLLBACK_READBACK_MISMATCH` and `BATCH_PARTIAL_CHANGE`; it no longer reports a clean rollback while the changed annotation remains. An unknown postimage, missing node or unverified result does not authorize a blind restoration.

This remains optimistic comparison on the existing host API, not a claim of an atomic Figma transaction or detection of all ABA changes.

## Independent validation

The complete reported six-file selection was independently rerun:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/set-annotations.test.ts packages/plugin/test/handlers/set-annotations.test.ts packages/plugin/test/handlers/get-annotations.test.ts packages/plugin/test/handlers/batch.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/policy/result-egress-policy.test.ts --maxWorkers=1

Result: 74 tests passed, 4.15 seconds, September 15 at 09:16:48. This includes all five new inverse regressions and the original direct writer, replay, schema, registry and policy coverage.

Three additional independent diagnostics exercise:

1. Cancellation during category lookup after a concurrent edit: no annotation setter or undo assignment occurs, and the concurrent value remains.
2. A mutating setter throws and its immediate postimage is unreadable: the inverse refuses restoration, leaves the changed value intact, and reports a partial change/conflict.
3. A deliberately substituted internal handler returns a JSON-shaped success without a private outcome: the inverse refuses to treat that object as write evidence. This is an internal fault injection, not a claim that public clients can replace registered handlers.

Result: all three passed, 521 ms at 09:18:57. The diagnostic's initial synchronous/async call typing was corrected using Promise.resolve; the final diagnostic and production plugin typecheck passed together:

    node packages/plugin/node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p packages/plugin/tsconfig.json

Retained diagnostic:

`C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/plugin/test/handlers/review-6g-annotations-fix1.diagnostic.test.ts.disabled`

SHA-256: `bd11445b3f55e0a02b3751ce81c7c8801b2895abf68cb7871f7c0703bc72279f`.

The final diagnostic was run under the same filename without `.disabled`, then retained in place under the disabled suffix. No live Figma/Chrome/daemon interaction, Docker, Superpowers, dependency change, main integration or Git mutation was performed. All host behavior in these tests is controlled fixture data exercising the actual handler and inverse code.
