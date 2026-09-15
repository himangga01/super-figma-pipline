# Task 4.2b fix 1

Status: ready for focused re-review. All three independently reported P2 defects were reproduced in maintained regressions before corrections. No main source integration, Git mutation, browser/daemon action, dependency change, primary dist build, Docker, Superpowers or subagent use occurred.

## R1: diagnostic completeness

Connection analysis now emits an explicit issuesTruncated flag. It becomes irreversibly true when any diagnostic cannot be retained. Service graph analysis independently retains its own diagnostic-loss flag, including previously guarded/sliced paths. The 512 retained records stay intact; a 513th issue cannot replace or silently disappear from the completeness contract.

Selection propagates either loss state as a hard SERVICE_DIAGNOSTICS_TRUNCATED issue. Exact, fully retained semantic uncertainties remain reviewable: the 512-call boundary can be fully reviewed, while the 513-call case cannot. It does not blanket reject every complete=false connection analysis. Current graph consumers require explicit diagnostic-completeness metadata; old absent fields remain inspectable but cannot satisfy current preparation/generation/native acceptance.

Aggregate selection/plan issue output remains bounded. Overflow retains a non-reviewable limit marker and unresolved coverage, rather than overflowing the strict max-512 plan result or dropping the hard condition. Coordinator tests exercise both an unreviewed bounded draft and reviews of every retained diagnostic; separate graph tests verify 512/513 lexical-file boundaries.

## R2: runtime-relevant source hints

Graph evidence now carries its actual semantic source role. Runtime module closure can promote an auxiliary-named file when a resolved runtime-origin dependency imports it, including transitive imports. The same role is consumed by connection analysis, runtime module layers/edges and coordinator hints. Auxiliary evidence and complete source bytes remain retained for inventory and inspection.

The coordinator no longer derives authentication/integration hints from every retained module evidence row. It consumes only graph-classified runtime evidence. A JWT import used solely in a test file no longer adds authentication or authorization to a local read-only dashboard. A production re-export/import of that same file retains its relevant identity evidence; the fix is not a blanket filename exclusion. The closure is conservative static source relevance, not proof that every imported module executes in every runtime branch.

## R3: C4 observed workflow preservation

When a declared requirement matches an inferred ID but omits workflow, the coordinator preserves a copy of the inferred workflow observations. When a workflow is supplied, the existing union of observed states/routes remains in effect. Required layers and required status are retained in either case. C4 still allows a frontend draft workflow without imposing operational C2/C3 confirmation; both variants retain the observed validation-error state and receive a lease only under the existing C4 rules.

## Verification

- Maintained regressions initially reproduced all three defects (3 failing, 2 positive boundary cases passing).
- Focused corrected coordinator/connection/graph sweep: 60 passed, exit 0, 12.89 seconds.
- Final original ten-file consumer/native sweep with new regressions: 141 passed, exit 0, 107.74 seconds. It includes actual operational HTTP/authorization/SQLite restart fixtures and the native-work source/lifecycle consumers.
- Full Shared, IR, MCP and CLI TypeScript checks: all exit 0.
- All 14 owned files: formatting check and lint with deny-warnings pass.
- Final source hashes and every original main preimage rechecked before publishing the manifests.

Validation ran in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. It shares the Windows account, filesystem, processes and network; it is not an OS sandbox. The original disabled reviewer diagnostic remains unchanged and was not enabled for these runs. No current live capture, generated portal completion, final broad review or publication success is claimed.

## Integration manifests

The complete task-4.2b-owned-files.json contains 14 paths and preserves each original main preimage. The correction-only task-4.2b-fix-1-owned-files.json contains 8 changed paths; its beforeHash is the initially reviewed task hash where present, or the original main hash for added ownership. Initial report/review evidence is preserved by the main agent.

| Correction file | SHA-256 |
| --- | --- |
| `packages/shared/src/portal.ts` | `03baa0702866381b70f571694b07e49672137c57b858eab84474946888c59059` |
| `packages/mcp/src/portal/service-graph.ts` | `60e54255426fc9d1b258266dcac180c5dc742988e785183685697f7c66a3b9f3` |
| `packages/mcp/src/portal/coordinator.ts` | `7000e25123b3446cf34625a430a0594eb06ae682919d1235385403373ec8d045` |
| `packages/mcp/src/portal/service-selection.ts` | `5691df576b65b209e07857693a9e9ed010bbe37b2caba7650bb972aea6ba4ada` |
| `packages/mcp/test/portal/coordinator.test.ts` | `b33b14beb3ac5a545b6cf65ee4c5965d866430e9043e77ba8138c1c1ee410c67` |
| `packages/mcp/test/portal/service-graph.test.ts` | `260cde4d614cb613833e18f52dcc9e33750e7a5818c0c986542e2b865e2a2898` |
| `packages/mcp/src/portal/service-connections.ts` | `1c85ece38bd3fa0f23759e69e085007ed9ac8268bfb2f6f74cf0b697b37b3e0f` |
| `packages/mcp/test/portal/service-connections.test.ts` | `9fa79caa3d1890447301cdde06e334d8c9451b001c78458158216e942d00ecbd` |
