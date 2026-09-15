# Task 4.2c: Draft workflow analysis foundation

Status: implementation ready for review. The detailed coverage gate still requires Task 4.2b coordinator integration. This task does not complete Task 4 or confirm any implemented workflow.

## Owned files

Only the existing workflow helper and its test changed in the separate native validation working copy. No shared schema, coordinator, service graph, connection analyzer, native executor, index, dependency, daemon, Chrome session, primary dist, commit or push changed. No Superpowers, subagents or Docker were used.

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/workflow-requirements.ts` | `9fec36ffcad8a64dfd5b3ac4a67a4a3bf193457198064c7aea1d74f1992be3ec` |
| `packages/mcp/test/portal/workflow-requirements.test.ts` | `8644d628e479b85147df9a6b282764a218be1f4939906fb8554b6daa60505a49` |

## Interface

`inferPortalWorkflows(design, scope)` remains the requirements-array compatibility wrapper. Its output now carries explicitly draft workflow details. Existing commerce/account identifiers and C4 local-demo wording remain compatible.

`analyzePortalWorkflows(design, scope, { sourceHints?, limits? })` returns:

- `version: 1`, `analysisComplete`, `analysisHash` and `interactionCoverage: 'draft' | 'incomplete'`.
- Candidate workflows with requirements, evidence IDs and interpreted interaction IDs.
- Qualified design/source evidence and explicit unclassified interactive scopes.
- Stable issues for malformed, absent, empty, cyclic/shared, duplicate-ID, bounded or ambiguous observations.

The complete flag describes bounded supported observation analysis. The coverage field never says complete or confirmed. Every requirement has `workflow.status: 'draft'`, an explicitly provisional user role, observed state markers, empty unproven route/API/data contract lists and draft layer decisions. `observed-design` is a fallback observation marker, not an invented business state or execution proof.

## Behavior and evidence

Concrete short control labels, immediate control label children and bounded nearby context support document/task creation and editing, form submission, settings changes, search/filtering, read-only dashboards and configured integration candidates. Existing commerce/account patterns now match short complete labels rather than arbitrary corpus substrings. A marketing paragraph or generic Save/Create label under a marketing ancestor does not invent backend persistence. Conflicting labels remain draft candidates with explicit ambiguity and an unclassified interactive scope.

Operational document/task mutations require relevant frontend, backend, API and database layers. Forms require a delivery contract without automatically inventing a database. Read-only dashboards/search remain frontend candidates unless supplied source evidence indicates remote data or other relevant layers. Only the explicit frontend-only scope forces every candidate to frontend local-demo behavior. Authentication is inferred from account design evidence or an explicit source-bound candidate hint, never simply from a dashboard's presence.

Optional source hints have a qualified source ID, path, text hash, bounded supplied text, hint kind, linked design node IDs and candidate rationale. The helper rehashes supplied bytes, rejects conflicting qualified source snapshots and unresolved/ambiguous design identities, and retains source provenance. This verifies bytes, not semantic truth, review admission or permissions. Task 4.2b must derive these hints from supported analysis or admitted source-bound review; public caller assertions are not authority. Configured integration behavior is not fabricated from integration marketing text without a corresponding source hint and actionable control.

Design evidence hashes bind the bounded analysis projection: node identity/path, short labels, control indication and projected reaction trigger/action/destination observations. The analysis hash binds that projection, candidates and issues; it is not a replacement for the full raw-capture hash or coherent capture authority. No unbounded or cyclic raw object is serialized to create an evidence ID. Task 5 still owns richer normalized interaction identities, full reaction semantics and capture coherence. Uninterpreted controls remain explicitly listed, including form fields whose detailed behavior has not been inferred.

## Bounds

Traversal has node, depth, text, reaction/action and retained-evidence caps. Source hints have count, text, metadata and linked-node limits. Missing or exhausted observations do not gain success defaults. Wide child arrays are queued with bounded loops without argument spreading; cyclic/shared child objects are detected. State extraction and contextual matching read bounded immediate siblings and ancestors, not all prose in unrelated subtrees.

## Verification

Initial detailed regressions produced 7 failures with the old helper while the 3 existing wrapper tests passed. Follow-up regressions reproduced an empty capture incorrectly appearing complete, marketing ancestor text implying persistence, and conflicting source snapshots being accepted. Each was fixed before final checks.

Final native checks in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run packages/mcp/test/portal/workflow-requirements.test.ts`: 14 passed, exit 0, 230 ms.
- `corepack pnpm exec oxlint --deny-warnings packages/mcp/src/portal/workflow-requirements.ts packages/mcp/test/portal/workflow-requirements.test.ts`: exit 0.
- Both owned files formatted with `corepack pnpm exec oxfmt`.
- A read-only TypeScript compiler API check loaded the actual MCP tsconfig, selected the two owned files as roots, included their imported dependencies and used `noEmit: true`: zero diagnostics, exit 0.
- Full `corepack pnpm --filter @sfp/mcp typecheck` was attempted twice and currently exits 1 solely because the concurrently edited `native-module-fence.ts` reports `hostProbes` implicit `any[]` at lines 103 and 214 (TS7034/TS7005). No workflow diagnostics occurred. The native file was not edited by this task; main was notified. A full MCP pass is not claimed.

The tests cover real nested raw design shapes for document/task controls, read-only dashboards, form validation failure, qualified integration hints, source corruption/conflict, unmatched required controls, marketing negatives, duplicate/missing IDs, 80,000-child traversal input, null/empty/cyclic captures, conflicting labels, settings and remote-read hints, evidence exhaustion, deterministic hashes, existing commerce compatibility and all-frontend C4 candidates.

Native checks share the Windows account, filesystem, processes and network. The separate working copy is not an OS sandbox or atomic filesystem snapshot. No final portal, live capture, whole-code review or publication completion is claimed.
