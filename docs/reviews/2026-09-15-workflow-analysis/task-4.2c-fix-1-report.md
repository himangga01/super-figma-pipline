# Task 4.2c: Review fix 1

Status: all three accepted P2 findings addressed; scoped rereview pending. The initial implementation report, initial snapshots, review and diagnostic files remain unchanged. Detailed coverage admission and Task 4.2b coordinator integration remain pending.

## Changes

1. Action labels now retain their originating observations. A child label used to infer a workflow joins that candidate's evidence, while the control remains the interaction identity. The same rule covers legacy commerce/account matching. Per-layer draft decisions also bind a content hash of the entire candidate evidence set, so the bounded human-readable list does not discard the identity of additional evidence.
2. Immediate control-label and sibling-state interpretation caps now emit `CONTROL_LABEL_LIMIT` and `SIBLING_CONTEXT_LIMIT`. Affected controls remain explicitly uncertain/unclassified even when an earlier observed label supplied a draft candidate. A later conflicting action or failure-state label cannot be silently treated as absent. No unbounded child/sibling scan or argument spreading was added.
3. Generic mutation labels use the nearest supported entity/settings context. A Task editor inside Documents produces a task edit, and the inverse nesting produces a document edit. Conflicting supported labels at the same nearest level produce `AMBIGUOUS_MUTATION_CONTEXT` and retain an unclassified interaction instead of applying fixed noun priority. Nearer Settings context also takes precedence over a distant Documents frame.

Only the two workflow files changed in the separate validation copy. No shared, native, coordinator, service graph, connection, dependency, runtime, browser, daemon, build, index, commit or push changes were made. No Superpowers, subagents or Docker were used.

## Red and green verification

Before source edits, 19 owned tests ran: the 14 baseline tests and the inverse-nesting regression passed; four regressions failed for missing child evidence, the control-label cap, the independently exercised sibling-state cap, and the nearer task context. The final suite also covers conflicting same-level context and nearer settings context.

Final checks in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run packages/mcp/test/portal/workflow-requirements.test.ts`: 20 passed, exit 0, 256 ms.
- `corepack pnpm exec vitest run --config .cache/review-task4-2c/vitest.config.mjs`: all three retained independent review diagnostics now pass, exit 0, 249 ms. Diagnostics were not edited or deleted.
- `corepack pnpm --filter @sfp/mcp typecheck`: exit 0. The unrelated concurrent native typing errors recorded in the initial report are no longer present in this fresh run; this task did not edit that file.
- `corepack pnpm exec oxlint --deny-warnings packages/mcp/src/portal/workflow-requirements.ts packages/mcp/test/portal/workflow-requirements.test.ts`: exit 0.
- Both owned files formatted with `corepack pnpm exec oxfmt`.

## Exact final hashes

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/workflow-requirements.ts` | `f87961cffa6eb6a4c3c814f4eb1c5fb7d01cd27eafd0af6a37076def6015c6e7` |
| `packages/mcp/test/portal/workflow-requirements.test.ts` | `a95df61df896dcc485d816ebef6592adfe3f1e54f0db7c6c02a5bca5a99981ff` |

Native validation shares the Windows account, filesystem, process namespace and network; the separate copy is not an OS sandbox or atomic filesystem snapshot. No final portal, live capture, whole-code review or publication completion is claimed.
