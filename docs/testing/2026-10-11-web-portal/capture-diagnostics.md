# Preserve capture failures before workflow-decision binding

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the web portal integration record](README.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns integration, current-source whole checks, daemon/source Chrome operations and live verification. This task changed only the managed coordinator and its existing test file.

## Baseline and observed problem

The coordinator reported that the real web R5 plan awaited native Chrome approval and then failed with `PORTAL_WORKFLOW_DECISION_NOT_BOUND`, hiding the unsuccessful source collection. The retained `.worktrees/_cache/web-portal-cdd-20261011-r5/summary.json` independently inspected by this task reports `status:failed` and that decision-binding code. It does not expose the original capture failure, so this report does not reconstruct a specific live Chrome error from that summary.

Implementation used `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`. Before edits, its `packages/mcp/src/portal/coordinator.ts` matched the native validation file exactly at SHA-256 `58c98cf628cad386ac437cf1c4ebdbd906a80e63a2ec837944582fce477a0f17`. Both copies contain authorized changes beyond the published Git baseline `22517932dc9b2cb974c177ec4eacb84d4b16e254`. Main and native service files were not edited by this task.

`createPlan` already catches capture failures and retains their structured safe diagnostics. However, it subsequently passes every supplied workflow decision to `coverPortalWorkflows`, even when source capture failed or was partial. That function correctly requires the decision's analysis hash and evidence IDs to match current observed evidence. Prior confirmed decisions cannot match a missing or changed partial analysis, so the thrown decision error prevented the plan from returning the more fundamental capture diagnostic.

## Bounded repair and authority

When `design.complete` is false, the coordinator now computes coverage with no admitted workflow decisions. The caller's original decisions remain unchanged in the stored plan request for audit and a later replan. They are absent from `workflowCoverage.decisions` and are not treated as accepted authority. If decisions were supplied, coverage is explicitly incomplete and includes `WORKFLOW_DECISIONS_REQUIRE_COMPLETE_CAPTURE`, even if remaining partial design/source evidence could otherwise appear covered.

The existing capture failure object, partial-capture issue, capture completeness, asset/source requirements and live-verification gates are unchanged. Plan creation can now return those diagnostics. `portal_start` remains `needs-input`, and `portal_next` provides no coding lease or generation attempt for these incomplete plans.

Complete capture still passes the original decisions to the unchanged strict `coverPortalWorkflows` validator. An obsolete analysis hash still throws `PORTAL_WORKFLOW_DECISION_NOT_BOUND`. No decision is silently rebound to new evidence, no missing capture is manufactured and no generation admission criterion is relaxed. `service-selection.ts` was inspected but not modified.

## Executed regression evidence

Two new actual coordinator regressions supplied prior-analysis decisions with a failed capture and a partial capture. At **19:09:58 KST**, both failed against the original code with `PORTAL_WORKFLOW_DECISION_NOT_BOUND`. The failed-capture fixture uses a typed `CHROME_CONNECTION_REQUIRED` connection diagnostic; that controlled code is not claimed as the hidden live R5 cause.

At **19:10:22 KST**, both new cases passed alongside the existing complete-capture decision test. The existing case verifies that a correctly bound decision enables the appropriate flow while an old hash remains rejected. The new cases verify preserved capture code/stage or partial issue, `design.complete:false`, no capture descriptor, zero accepted workflow decisions, incomplete coverage, unchanged stored request, `needs-input`, no lease and zero generation attempts.

The final run began at **19:10:54 KST** and passed **43/43 cases across three files**, with zero failures or skips, in 70.30 seconds: `coordinator.test.ts`, `capture-flow.test.ts` and `capture-failure.test.ts`. MCP TypeScript, scoped lint and formatting passed at the final source.

The ordinary managed MCP test invocation initially failed before collection because the dependency junction resolved duplicate shared-schema module identities at `PortalCoreDeclarationBatchSchema.default`. The already established private managed-test configuration aliases `@sfp/shared` to this same managed tree. Using its absolute path with `--root packages/mcp` resolved that harness issue. An initial relative config path was resolved against the overridden root and could not be found; no test ran in that attempt. No production/shared source was changed to address the harness. Native verification does not require this managed-copy alias.

```powershell
# Managed service directory. Existing private config, no new source/config file.
$taskConfig = (Resolve-Path -LiteralPath '../.task-evidence/managed-cli-vitest.mjs').Path
node node_modules/vitest/vitest.mjs run --config $taskConfig --root packages/mcp --configLoader native --no-cache --maxWorkers 1 test/portal/coordinator.test.ts -t 'capture diagnostics without admitting|unknown interaction unresolved'
node node_modules/vitest/vitest.mjs run --config $taskConfig --root packages/mcp --configLoader native --no-cache --maxWorkers 1 test/portal/coordinator.test.ts test/portal/capture-flow.test.ts test/portal/capture-failure.test.ts test/portal/service-selection.test.ts
node node_modules/typescript/lib/tsc.js --noEmit -p packages/mcp/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/mcp/src/portal/coordinator.ts packages/mcp/test/portal/coordinator.test.ts
node node_modules/oxfmt/bin/oxfmt --check packages/mcp/src/portal/coordinator.ts packages/mcp/test/portal/coordinator.test.ts
```

The final command included a fourth `service-selection.test.ts` name filter, but that file does not exist; exactly the three named existing files executed. The 43-case result makes no claim of an additional fourth test file. No full suite, dependency installation, Superpowers use, Chrome operation, daemon restart, main/native edit, index/provenance change or commit was performed. Tests run with the existing Windows owner permissions; the managed copy is not an OS sandbox.

## Frozen handoff

Verified freeze at **19:12:29 KST**. The two-path slice SHA-256 is `8012704d056484e60d972ded3ded487f5826a41721c49c6cd29610afafb6e214`, computed over JSON of these ordered `{path,sha256}` records without hash prefixes.

| Managed-service path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/coordinator.ts` | `8c0cf3f0f93acd3bba25487833c0a51075233bc551b609c5d0eb94c68ebf87c9` |
| `packages/mcp/test/portal/coordinator.test.ts` | `687dcaeaad5b8419744e0dd9aee5024f55a756e500d0e14f87a0fc4bd5fe56ac` |

The independent reviewer received the hashes and reproduction command for a final recheck before integration. The coordinator must reconcile the two files and execute current-source gates. A subsequent authorized live plan is needed to observe the actual previously masked capture diagnostic; this fixture result does not claim that the source capture itself now succeeds or that historical unknown operations should be replayed.
