# Task 4.1 Fix and Graph Integration Review

## Verdict

Changes requested for one remaining P1 issue in the F2 fix. The other five original findings are addressed within the declared bounded contract. The new graph consumer correctly carries module resolution and incompleteness into service evidence for the covered cases; however, it also reproduces the remaining erroneous package selection as an authoritative cross-service edge.

The initial `task-4.1-review.md` remains historical evidence. This review covers the four exact hashes in `task-4.1-owned-files.json`; all four were independently recomputed and matched. No owned source files were edited.

## Original finding disposition

| Finding | Disposition | Evidence |
| --- | --- | --- |
| F1: omitted loader and import-type forms | Addressed | Import-type resolves; recognizable member/createRequire forms explicitly require review. Full arbitrary loader emulation is not claimed. |
| F2: unrelated manifest selection | Partially addressed; still open | Unrelated fixtures are fenced, but proven workspace presence still overrides contradictory explicit dependency selectors. See R1. |
| F3: ignored project references | Addressed conservatively | Project references produce `CONFIG_PROJECT_REFERENCES_REQUIRE_REVIEW`; full referenced-project configuration selection is not claimed. |
| F4: wide AST throws | Addressed | The owned resolver regression and an independent actual `analyzeServiceGraph` call return hard incompleteness without throwing. |
| F5: destructured require | Addressed | Bound-name traversal covers the regression's destructured/default/rest/reassignment/catch cases. |
| F6: mixed export shapes | Addressed | Selected mixed subpath/condition objects are rejected at both tested levels. |

## R1 — P1: Workspace presence still overrides the importer's explicit dependency target

Location: `service/packages/mcp/src/portal/module-resolution.ts:459-478`.

The candidate filter accepts every matching workspace member before considering whether the importer's declared dependency actually selects that member. Consequently, both fixtures below return `complete: true` and resolve `pkg` to `packages/local/index.js`:

```json
{
  "package.json": "{\"workspaces\":[\"packages/*\"],\"dependencies\":{\"pkg\":\"npm:remote-package@1\"}}",
  "main.ts": "import 'pkg';",
  "packages/local/package.json": "{\"name\":\"pkg\",\"version\":\"1.0.0\",\"main\":\"index.js\"}",
  "packages/local/index.js": "export {};"
}
```

Replacing the dependency selector with `file:./outside` produces the same result even though that explicit local target is missing. The `local-package-membership-unresolved` check at lines 477-478 is never reached after the mismatched workspace candidate succeeds.

An independent actual `analyzeServiceGraph` call using the second fixture returned `incomplete: false`, an import edge to `packages/local/index.js`, and a `depends-on` edge from `.` to `packages/local`. This can cause the subsequent service-selection consumer to include the wrong service and omit the declared one. This is a remaining part of the accepted F2 issue, not a request for unrestricted package-manager emulation.

Honor explicit dependency selectors before accepting membership-based candidates. Resolve supported local/workspace selectors against their declared target; classify an explicit external alias as external or mark unsupported selection incomplete. Conflicting or unimplemented selector semantics must not produce a complete local resolution. Add both alias and mismatched file/link/workspace-target regressions, including one actual graph-consumer assertion.

## Graph integration observations

The new consumer uses authority-inventory members rather than the previous semantic walk to obtain relevant text, checks reobserved byte hashes, adds actual source/configuration edges, and carries unresolved modules into hard incompleteness. Binary bytes remain inventory members rather than fabricated text evidence. Module and graph AST queue bounds now fail safely in the reproduced wide-source case.

Task 4.2 API producer/consumer interpretation, broader workflow coverage, qualified selectors, and service selection remain outside this bounded acceptance. No new finding is raised merely because those future tasks are incomplete.

## Verification

Working directory: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

```powershell
& ./node_modules/.bin/vitest.cmd run packages/mcp/test/portal/module-resolution.test.ts packages/mcp/test/portal/service-graph.test.ts
& ./node_modules/.bin/vitest.cmd run test/portal-module-review-fix.diagnostic.test.ts --reporter=verbose --silent=false
```

The two owned suites passed all 22 tests, exit 0. The independent diagnostic suite passed four checks, exit 0: three assert the remaining defective behavior and one verifies the corrected actual graph AST bound. Passing defect-reproduction assertions is not evidence of correct implementation.

Retained review-only artifacts, excluded from source integration and final clean validation:

- Isolated `service/test/portal-module-review-fix.diagnostic.test.ts`.
- `C:/Users/c/AppData/Local/Temp/sfp-review-module-wide-zDYEa7`.
- `C:/Users/c/AppData/Local/Temp/sfp-review-module-edge-1W451y`.

The earlier obsolete diagnostic suite was not run as a correctness test. No browser, daemon, dist, index, commit, Docker, or Superpowers operation was performed.
