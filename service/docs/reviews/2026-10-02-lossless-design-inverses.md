# Lossless design reads and verified inverses

Date: 2026-10-02. Scope: remediation M12, findings F24, F30, F32, F33, F34, F41 and F42. Source is the current authorized remediation working tree; final source authority reconciliation is pending the integrated source freeze. This record supplements the September 30 review evidence without replacing historical findings.

## Implemented behavior

- Non-solid paint opacity participates in simplified style identity independently of gradient stop alpha and node opacity. Image, video, pattern and shader paints retain non-default opacity.
- Plugin serialization retains top-level HUG/FIXED dimensions, auto-layout axis sizing, constraints on absolute auto-layout children, single-item list options, and segments whose only variation is leading or tracking. The canonical capture requests paragraph list options, indentation and wrapping, so changing those fields changes normalized observation hashes.
- Reaction writes preserve supported native keyboard triggers, overlay placement, easing, variable values and conditional action trees. Strict, recursive shapes follow the installed Plugin API declarations. The complete replacement is bounded before node lookup or effect dispatch. Unknown fields and unsupported variants fail before effects rather than being omitted. Read schemas continue retaining future fields.
- Batch handlers record actual owned values immediately after successful host assignments. Inverses retain the captured node object, refresh pre-state at each operation boundary, and restore only observed writes whose current values still match. Rollback reloads fonts independently of caller cancellation and checks ownership again after awaited work. Manual edits remain intact; other eligible fields and nodes can still be restored.
- Rollback verifies actual restored values and removal. Silent host no-ops, changed identity, unknown failed setter effects, concurrent edits and failed restoration report `BATCH_PARTIAL_CHANGE`. A failing multi-property setter can roll back its proved earlier assignments. Unowned typography fields are never overwritten merely because they were in a preflight snapshot.
- Mixed typography and full-text replacement with multiple style/paragraph ranges are rejected during read-only batch preflight until an exact range inverse is supported. Mixed corner/stroke aggregates use native individual-field inverses and require verified aggregate readback. Motion collection inverses retain identity and observed state; an unrelated collection change conservatively prevents restoration. Created-node deletion requires an immediate readable native property/prototype and subtree snapshot, refreshed only by observed own assignments, unchanged identity/state, and confirmed removal. Failed creates without an identity remain uncertain.
- Annotation rollback now fences the captured and actual written node object, preserving its existing expected-state and restoration readback checks.

## Red and green evidence

The tests use stateful native API fixtures, selective styled-segment fields, real raw handlers and host setters, including setters that partially mutate, throw, silently ignore restoration, and permit concurrent edits.

| Regression                                                                                             | Observed red result  | Verified green result                               |
| ------------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------- |
| Paint opacity, layout/constraint/list serialization, leading/tracking, canonical paragraph sensitivity | 14 expected failures | 115 tests passed in 3 files                         |
| Complete reaction round-trip, closed writes and cancellation                                           | 10 expected failures | 19 tests passed in 3 files                          |
| Manual edits, unowned typography, silent setter, mixed typography and replacement identity             | 5 expected failures  | Batch and mutation boundary tests passed            |
| Edited created node and silently surviving removal                                                     | 2 expected failures  | Both creation ownership cases passed                |
| Full-text replacement of distinct paragraph runs                                                       | 1 expected failure   | Read-only rejection preserves earlier batch targets |
| Annotation same-id replacement and aggregate reaction bound                                            | 2 expected failures  | 28 tests passed in 2 files                          |

Latest combined focused command, from `.worktrees/baseline/service`:

```powershell
& ..\..\_cache\bin\pnpm.CMD --config.verify-deps-before-run=false exec vitest run packages/plugin/test/handlers/batch.test.ts packages/plugin/test/handlers/set-annotations.test.ts packages/plugin/test/handlers/set-reactions.test.ts packages/plugin/test/handlers/remove-reactions.test.ts packages/plugin/test/handlers/get-reactions.test.ts packages/plugin/test/serializer.test.ts packages/shared/test/design-context-dedupe.test.ts packages/mcp/test/portal/canonical-paragraphs.test.ts packages/plugin/test/mutation.test.ts
```

Result: 9 files, 193 tests passed at 02:37:00 local time. After the dispatcher structural-type fix and explanatory wording update, the final focused run also included every existing handler test corresponding to the owned source manifest:

```powershell
$m12TestFiles = @(Get-Content -LiteralPath .cache/m12-test-files.json -Raw | ConvertFrom-Json)
& ..\..\_cache\bin\pnpm.CMD --config.verify-deps-before-run=false exec vitest run @m12TestFiles
```

Result: 34 files, 264 tests passed at 02:40:16 local time. The local manifest `.cache/m12-files.json` records the 51 synchronized source, test and evidence paths; `.cache/m12-test-files.json` records the exact 34-file test selection. This is a focused run, not the full repository suite.

Native package typechecks for `@sfp/plugin` and `@sfp/shared` passed. Scoped `oxlint --deny-warnings` and `oxfmt --check` passed over the M12 file manifest. MCP typechecking initially exposed the observer's Plugin API ambient type crossing into MCP tests; that local issue was fixed. The latest MCP check remains blocked by concurrently moving root archive/native-work tests outside M12, including the pending archive-eligibility module/schema and `native-work.test.ts` status fixture. These failures are retained as integration limits.

## Actual verification limits

The native validation copy is a separate filesystem checkout with existing dependencies, not a filesystem or process sandbox. This lane did not install dependencies, run Docker, access the user's Chrome/Figma session, commit, stage the main index or publish artifacts. The parent agent will run the integrated suite after all source changes stabilize.

These tests establish supported local read/write/inverse behavior. Expanded live Figma checks for mixed text, reactions, canonical captures, readable native creation snapshots and host-coupled fields remain required; they are not claimed here. No full generated frontend or release acceptance is claimed. The earlier live official-versus-Chrome field comparison is separate evidence and does not substitute for these checks.
