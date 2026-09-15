# Task 4.1: Static module resolution and graph consumption

Status: reviewed and integrated. All findings from the initial, fix, selector and final narrow reviews are closed. Main integrated four exact reviewed file hashes after verifying main preimages. Task 4 as a whole is incomplete; the intermediate pending statuses below describe historical checkpoints.

## Implementation

Main implemented only four disjoint files in the separate native validation copy. No shared/native contracts, dependencies, primary dist, daemon, Chrome, staging or commits were changed. Task 3.3 proceeds independently.

The read-only resolver handles static ESM imports, re-exports, CJS require, TS import-equals and import-type, literal dynamic imports, SFC scripts, conservative extension/index source candidates, JSONC path aliases and relative config inheritance, and declared workspace package exports/condition branches. It returns source targets, evidence configuration paths, declared external provisioning, and explicit unresolved forms. External classification is not installed-package verification.

The service graph consumes these results as file imports, configuration and cross-service dependency edges. It now parses relevant text from the complete authority inventory, including ignored/generated files and mts/cts. Included binary bytes remain in source inventory, not text evidence. Bytes differing from the first inventory observation produce explicit incompleteness. Inventory, parse and edge limits cannot silently become complete. Existing API route heuristics, qualified selectors, broader workflow coverage and consuming selection remain Task 4.2; these are not claimed complete here.

## Main adjudication of first review

Main reran the retained reviewer diagnostic suite: 7 diagnostics passed, reproducing the stated defective behavior. All six formal findings were accepted.

- F1: TS import-type now resolves; recognizable member/custom module loaders and aliased createRequire factories require review instead of disappearing from a complete graph.
- F2: local package resolution now needs self-reference, explicit workspace membership, or an explicit workspace dependency. A matching nested manifest cannot shadow an external dependency. Membership/importer manifests join configuration evidence.
- F3: project references explicitly require review; no false complete alias interpretation. Full referenced-project ownership selection remains unsupported and is not presented as implemented.
- F4: wide AST arrays are enqueued under a bound without argument spreading, both in the resolver and existing graph AST visitor.
- F5: require binding analysis follows destructuring/default/rest/catch/reassignment bindings and conservatively fences ambiguity.
- F6: mixed export subpath/condition objects are rejected at selected levels.

The diagnostic-only test/portal-module-review.diagnostic.test.ts remains in the isolated copy as review evidence; it intentionally asserts obsolete defects and must be excluded from integration/final clean-source validation. No cleanup deletion was attempted.

## Verification

Initial resolver regressions: 6 failed, 1 passed against the empty implementation. Initial actual service-graph integration regressions: 2 failed because resolved edges were absent and dynamic modules falsely complete. After implementation and accepted review fixes, the two owned suites pass 22 tests, exit 0 (1.77 seconds). The truncation test now uses a real constrained RepoReader instead of spying on a reader bypassed by the independent inventory-stage budget.

Commands in the separate service copy:

- pnpm exec vitest run packages/mcp/test/portal/module-resolution.test.ts packages/mcp/test/portal/service-graph.test.ts
- pnpm --filter @sfp/mcp typecheck (exit 0)
- pnpm exec oxlint --deny-warnings (all four owned files, exit 0)
- pnpm exec oxfmt (all four owned files)

Native validation shares the current Windows account, filesystem, processes and network; it is not a sandbox or filesystem snapshot. No final source/package or live portal acceptance claim is made.

## Follow-up selector correction

The scoped fix review found F2 still open for explicit npm aliases and file dependencies. Main reproduced the npm alias failure with a corrected regression before editing. Explicit npm/git/URL selectors now remain external, file/link targets resolve only to their actual bounded declared package directory, conflicting selectors fail, unsupported workspace selectors/version selection require review, and self-reference needs exports or other membership evidence. Added both helper and actual graph regression: the file target produces a dependency edge to outside, never the same-name workspace fixture.

Current final owned suites: 25 tests passed in two files, exit 0 (1.74 seconds). Narrow selector rereview pending. Preserve diagnostic-only test/portal-module-review-fix.diagnostic.test.ts and its recorded temporary fixtures in the isolated copy; exclude them from integration/final clean-source checks.

## Self-reference follow-up

The selector review confirmed the prior selector correction and found one adjacent P2: exported package self-reference must precede a same-name dependency selector. Main reproduced the failure in a corrected regression, then moved self-export resolution ahead of selector handling. Current 26 tests pass across both owned suites, exit 0 (1.71 seconds), with owned-file lint/format success. Narrow self-reference rereview pending; prior review records remain historical evidence.

## Exact owned hashes

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `c7a139e228717427f10f4172299368f8ada6bf4be27128f3ac61b7322e7adaff` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `f7c59c32a5966fd41f7c8c5d380f0ed8cf10df443e89b3fd6937aa9542bb86ac` |
| `packages/mcp/src/portal/service-graph.ts` | `c16761114903e160dc10f4aa14e035554197307df59b85db66875afec27fef93` |
| `packages/mcp/test/portal/service-graph.test.ts` | `7d196de962898196e085fa5c79da437fe387ca63fda68e88996f0fd361b155e4` |
