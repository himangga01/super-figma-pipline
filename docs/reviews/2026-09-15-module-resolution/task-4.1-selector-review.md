# Task 4.1 Selector Correction Review

## Verdict

The previous P1 R1/F2 workspace-selector override is corrected. One adjacent P2 self-reference precedence regression remains in the new selector logic. The four source/test hashes match the refreshed `task-4.1-owned-files.json`. No owned source changes were made.

## Verified correction

Explicit external aliases are classified as external before unrelated workspace-name matching. Explicit file/link selectors select their actual in-scope manifest directory. A missing file target produces incomplete unresolved evidence rather than selecting another same-name workspace. Uncertain workspace ranges and unsupported selectors are explicitly incomplete. The new actual service-graph test verifies that the selected file target receives the dependency edge and that the unrelated same-name package does not.

The original R1 finding in `task-4.1-fix-review.md` can be closed.

## S1 — P2: Dependency-selector handling precedes exported package self-reference

Location: `service/packages/mcp/src/portal/module-resolution.ts:474-475` (external-selector early return), before the self-reference candidate branch at lines 478-482.

Reproduction:

```json
{
  "package.json": "{\"name\":\"pkg\",\"exports\":\"./self.cjs\",\"dependencies\":{\"pkg\":\"npm:remote-package@1\"}}",
  "main.cjs": "require('pkg');",
  "self.cjs": "module.exports = 1;"
}
```

The helper returns `complete: true`, `status: external`, and an empty target list. Native Node resolution with `createRequire(mainPath).resolve('pkg')` resolves the same fixture to its own `self.cjs` because the package exports a self-reference. The dependency-selector early return prevents the existing self-reference condition from running. A file/link selector can similarly redirect the self-reference before that condition is checked.

Resolve the supported exported self-reference before applying external/local dependency selectors, or explicitly mark the conflict incomplete. Keep ordinary workspace members subject to the corrected selector rules. Add a regression that checks exported self-reference alongside a same-name dependency selector.

This is a reproduced precedence issue in the changed selector branch; no arbitrary package-manager or loader emulation is requested.

## Verification

Working directory: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

```powershell
& ./node_modules/.bin/vitest.cmd run packages/mcp/test/portal/module-resolution.test.ts packages/mcp/test/portal/service-graph.test.ts
& ./node_modules/.bin/vitest.cmd run test/portal-module-review-selector.diagnostic.test.ts --reporter=verbose --silent=false
```

All 25 owned tests passed, exit 0. Three independent diagnostics passed, exit 0: two verify correct missing-file/exact-link behavior, and one proves the remaining self-reference disagreement with native Node resolution. The latter intentionally asserts the defective result and is not a correctness test. Node only resolved the filename; the fixture module was not imported or executed.

Retained diagnostic-only artifacts, excluded from production integration and final clean-source checks:

- Isolated `service/test/portal-module-review-selector.diagnostic.test.ts`.
- `C:/Users/c/AppData/Local/Temp/sfp-review-selector-self-4x23Fo`.

Prior review reports remain intact. No browser, daemon, build output, index, commit, Docker, or Superpowers operation was performed.

