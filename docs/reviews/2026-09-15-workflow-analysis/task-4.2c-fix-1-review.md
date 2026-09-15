# Task 4.2c fix 1 scoped rereview

## Outcome

Specification: pass for the bounded workflow foundation. Quality: pass. All three initial P2 findings are addressed. No additional actionable finding was identified in the fixes or nearby behavior inspected. Detailed coverage admission, coordinator integration and whole-portal completion remain outside this approval.

## Findings verified

1. **Child-label provenance:** Labels now carry their source observation. Matching child records join candidate evidence for both noncommerce actions and existing commerce/account definitions, while the control retains interaction identity. The original missing-child-evidence diagnostic passes. Draft layer decisions also bind a hash of the sorted complete evidence-ID set, so their shortened readable list does not remove the identity of additional evidence.
2. **Interpretation limits:** Child-label and sibling-state limits now produce explicit `CONTROL_LABEL_LIMIT` or `SIBLING_CONTEXT_LIMIT` issues. The final uncertainty pass removes affected controls from the interpreted set and retains them in unclassified interactions, even if a partial draft candidate exists. The original child-33 conflict diagnostic passes, and the owned suite independently tests sibling-state exhaustion.
3. **Context locality:** Generic mutation inference stops at the nearest supported ancestor context. Owned regressions cover both Documents/Task editor and Tasks/Document editor nesting, nearer Settings context, and conflicting entity labels at the same nearest level. Same-level conflicts produce `AMBIGUOUS_MUTATION_CONTEXT`, no invented mutation candidate and an unclassified control. The original nearest-task diagnostic passes.

The source still emits draft-only workflows, empty unverified route/API/data contracts and frontend-only C4 candidates. None of the fixes synthesizes semantic authority from supplied source hints or claims implemented interaction coverage.

## Verification

Executed in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run --config .cache/review-task4-2c/vitest.config.mjs`: 3 retained original diagnostic assertions passed, exit 0.
- `corepack pnpm exec vitest run packages/mcp/test/portal/workflow-requirements.test.ts`: 20 passed, exit 0.
- Fresh SHA-256 checks matched the refreshed owned manifest: source `f87961cffa6eb6a4c3c814f4eb1c5fb7d01cd27eafd0af6a37076def6015c6e7`; test `a95df61df896dcc485d816ebef6592adfe3f1e54f0db7c6c02a5bca5a99981ff`.

The worker reports fresh full MCP typecheck and lint success, and the main session reports its own 20-test pass. This scoped rereview independently ran the tests above; it did not repeat the full compiler or lint checks.

## Preservation and scope

The original review and ignored `.cache/review-task4-2c/` diagnostic files remain unchanged. Only this new review document was written. No owned source/test, dependency, browser, daemon, build, primary dist, index, commit or push was modified. No Superpowers, Docker or subagents were used.

The helper remains a bounded draft-observation foundation. Later work must establish source-hint semantics and admission, use detailed interaction coverage in the coordinator, and verify actual portal behavior. Native checks share the Windows account, filesystem, process namespace and network; the separate working copy is not an OS sandbox or atomic filesystem snapshot.
