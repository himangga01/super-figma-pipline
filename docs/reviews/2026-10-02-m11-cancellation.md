# M11 cancellation and uncertain effects

Date: 2026-10-02 (Asia/Seoul). Source baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`, with the ongoing authorized remediation changes in the shared working tree. This evidence covers M11 and findings F16, F25 and F26 in the [September 30 remediation plan](../plans/2026-09-30-code-remediation-plan.md). It does not supersede historical review evidence or claim live Figma acceptance.

## Implemented behavior

- A sandbox request that was posted and then timed out or lost its bridge reports `PLUGIN_OUTCOME_UNKNOWN`. An initial posting failure remains an ordinary transport failure. The relay client preserves the uncertainty code instead of translating it to an internal error.
- The daemon relay classifies dispatched timeouts, relay shutdown and uncertain plugin errors using operation-policy effect metadata. A potentially effectful Figma request carries `committed: true`, which the existing executor uses to publish a durable uncertain finalizer. Read-only and undispatched timeout failures do not assert a document effect. Timeout and shutdown also attempt cooperative cancellation using the exact operation/action binding.
- Inside the executor's acquired resource grant, a mutation checks the durable journal for an unresolved uncertain effect on the same Figma file identity. A later mutation requires explicit authorized `operations.resolve`; reads remain admitted. This survives executor restart. The journal inspection interface is required and missing inspection fails closed with a settled predispatch rejection. Historical uncertain tombstones use conservative operation-policy metadata when an effect summary is absent. Resolution authority, current authentication and signed operation bindings are unchanged.
- Cancellation and disconnect settle dispatched activity rows as `outcome-unknown`. A live dispatch set supplies the busy indicator independently of the capped history. Duplicate cancellation and late callbacks cannot settle or decrement a call twice. The activity row exposes uncertainty and removes the pending animation without changing backend authority.
- Awaited mutation handlers check cancellation after lookup, font, style, variable and other preflight waits. Paint/effect/grid assignments resolve their awaited values before checking and assigning. Text-range handlers check between awaited setters. Creation placement and text-style binding helpers receive the execution context. Existing mutation markers preserve partial creation/import effects. Existing cleanup catches remain independent of caller cancellation; reaction and batch changes belong to the separate M12 lane.

## Executed evidence

Validation ran with Node 24.21.0 in the existing native working copy at `.worktrees/baseline/service`; only owned files were synchronized. No Docker, alternate browser runtime, installation or main-checkout build was used.

Actual failing triggers observed before their repairs:

- Three failures: text changed after cancellation during deferred font loading; cloning continued after a cancelled deferred lookup; an inner dispatched timeout lacked an uncertain code.
- Four failures: cancelled and disconnected activity stayed pending; an effectful relay timeout lacked an uncertain disposition; a later mutation ran after a persisted uncertain effect across executor restart.
- Ten additional ordinary setter/removal handlers continued after cancellation during a deferred lookup. Two creation/helper triggers wrote text or appended a node after cancellation.
- The real authenticated WebSocket relay-to-executor test was also run with the timeout disposition temporarily removed in the validation copy, restored in `finally`. It reproduced a false `failed` journal record with a non-null no-output receipt. The corrected implementation produces `outcome-unknown`, no success/no-output receipt, an uncertain egress finalizer, and a rejection of the next mutation even after a late raw result arrives. The red log is `.worktrees/_cache/m11-relay-executor-red.log`.

The final focused run passed **216 tests in 10 files**, with no skipped tests, using:

```text
node node_modules/vitest/vitest.mjs run
  packages/plugin/test/sandbox/mutation-cancellation.test.ts
  packages/plugin/test/sandbox/tool-bridge.test.ts
  packages/plugin/test/relay/client.test.ts
  packages/plugin/test/composables/use-relay-session.test.ts
  packages/plugin/test/components/tab-activity-row.test.ts
  packages/plugin/test/mutation.test.ts
  packages/mcp/test/relay/relay.test.ts
  packages/mcp/test/execution/operation-executor.test.ts
  packages/mcp/test/execution/completed-result-replay.test.ts
  packages/mcp/test/execution/file-queue.test.ts
```

This includes the production queue invariant that aborting an active callback retains its writer grant until the callback actually settles, existing partial-change/Undo behavior, replay checks and the actual inner bridge-to-client uncertainty frame. The green log is `.worktrees/_cache/m11-focused-green.log`.

Scoped lint and formatting checks passed on the 93 synchronized paths recorded in `.worktrees/_cache/m11-all-files.json`. MCP TypeScript passed. Plugin TypeScript passed before the concurrent M12 tests were added; its latest run was blocked only by two in-progress reaction-test ambient-type/local-name issues, already reported to that lane. The integrated suite and release provenance remain owned by the coordinating task.

A subsequent concurrent M12 snapshot briefly produced 215 passing tests and one failing existing batch rollback test: `node.name` remained `Temporary` instead of `After`. That current-attempt log is preserved separately at `.worktrees/_cache/m11-focused-current.log`; the failure was not accepted or excluded from the original declared scope. M12 completed its owned-write instrumentation and the next focused mutation/cancellation rerun passed 21 of 21 tests. A separate explicitly declared nine-file M11-only run, excluding that in-progress mutation suite, passed 210 of 210 tests. The final ten-file rerun and current green log again include the mutation suite.

## Verification limits

The relay/executor regression uses a real local WebSocket transport and durable stores. Sandbox and UI regressions use production modules with controlled host objects and deferred font/lookup responses. They do not demonstrate live Figma cancellation. JavaScript synchronous mutation is not preemptible, and an already-invoked asynchronous host mutator can finish after cancellation. Such effects remain partial or uncertain; a stopped spinner or a late raw transport result cannot authorize automatic replay or clear the durable fence. Explicit reconciliation remains necessary.

The handler inventory was repaired beyond the named examples, but individual real-Figma cancellation acceptance for every mutation handler was not executed. M12 owns independent inverse-proof and reaction changes and preserves the M11 guards. No portal coordinator, native worker, portal schema, provenance authority or generated contract was modified by this lane.
