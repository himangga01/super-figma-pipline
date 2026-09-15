# Task 4.2b: Qualified service and workflow consumers

Status: fix 1 implemented and verified in the separate native working copy, ready for focused re-review. Initial review found three P2 defects; all three were reproduced and corrected. See task-4.2b-fix-1-report.md. No main source integration, staging, commit or push was performed by this worker.

## Implemented behavior

The actual service graph now emits analysis version 2, grant-derived qualified source identifiers, source-qualified service IDs and evidence, and the reviewed connection analyzer's separate producers, clients, data/configuration candidates and proven static connections. The old every-object-get-is-an-API extraction is removed. Tests and examples cannot become runtime providers merely because they contain route calls; complete byte inventory remains independent of semantic relevance. Existing module resolution, hard source bounds and native source authority remain in force.

Planning accepts either an unambiguous legacy root string or an explicit selector with sourceId, sourceIndex and rootPath. Colliding reference roots require the explicit selector. The actual coordinator computes directed service dependency closure, derives required layers only from that closure and admitted conservative reviews, and binds selection, connection evidence and workflow coverage into context and blueprint. A selected web -> API -> database fixture excludes an unrelated jobs package. The source byte inventory remains complete for native authority and historical/source review; generation instructions identify selectedClosure.closure as the implementation relevance scope.

A source-qualified semantic review identifies source ID/index, path/hash, exact issue code and offset, retained layers and a conclusion. Only the explicit semantic uncertainty allowlist can be reviewed. Such review always retains every potential service; it cannot waive missing or changed source bytes, malformed syntax, module-resolution incompleteness, resource/evidence limits or unsafe configuration. Old native profile prose reviews cannot introduce new conclusions: any supplied profile review must match a qualified review already bound into the plan. Historical records remain parseable and inspectable; current graph/coverage preparation, generation, native application and acceptance reject missing analysis markers. Native acceptance carries a hash of the selected closure and workflow coverage, checked by IR completion.

Detailed workflow analysis is consumed by the coordinator. Observed document/task mutations, forms, settings, dashboards/search and configured integration candidates retain design/source evidence, candidate requirements, observed states and routes. Qualified imported API/data/auth/integration evidence from selected services is re-read and rehashed before becoming source hints. Multiple hint kinds from the same file are retained. Hints apply conservatively to captured root scopes; more than 128 roots or 256 hints remains an explicit unresolved bound. A local read-only dashboard does not gain invented authentication or storage. Unknown interactive scopes require an exact analysisHash/evidenceId-bound decision naming confirmed requirement IDs; arbitrary confirmed requirement prose does not hide an uncovered control. Only semantic workflow ambiguity can be resolved this way; malformed or bounded observations remain blocked.

Workflow decisions that claim existing or extended source patterns use qualified sourceEvidence references. Missing references block the blueprint; wrong source ID/index/hash or evidence belonging to an unselected sibling service is rejected. Inferred required layers and observed states/routes survive refinement. Draft or unresolved coverage gets no coding lease. Existing native per-layer, requirement, journey, API/data/auth and source checks remain required; coverage metadata alone never verifies implemented behavior.

## Supported routing configuration

The bounded explicit source configuration is portal.routes.json at a verified repository root:

```json
{
  "version": 1,
  "services": [
    { "rootPath": "web", "deploymentId": "portal" },
    { "rootPath": "api", "deploymentId": "portal", "origin": "http://localhost:3000" }
  ]
}
```

Each service root must exist in the analyzed graph. Optional routePrefix is a literal external mount prefix. The connection helper validates origins/prefixes and exact source evidence, rejects duplicate/ambiguous routing, and only connects a unique matching method/route provider under that declared deployment. The declaration is static configuration evidence, not evidence that the deployment has run. Actual generated portals still require native/browser journeys. Missing routing scope requires exact semantic review with conservative closure, not guessed same-path matching. Arbitrary Vite proxy/Next rewrite/custom deployment code is not automatically interpreted by this adapter.

Node HTTP control-flow routing, runtime SFC/MDX and unsupported semantic forms retain explicit uncertainty and may use the exact qualified review contract when all hard byte/parser/module conditions are satisfied. Dynamic or ambiguous providers are blocked unless reviewed with all potential services retained. This is bounded supported analysis, not a universal cross-language execution trace or an inferred database call graph.

## Coordinated capture consumer changes

Task 5.2c paging: portal_next now accepts independent collectionOffset, optional styleFamily and styleOffset, forwards them to the reviewed design-evidence helper, and exposes paged collections and the selected style family through the strict canonical result schema. A real coordinator regression reads collection 300 from 400 and paint style 200 from 300 and validates the entire result. Catalog availability is not collector capability/completeness authority.

Deferred Task 2/5 timing: the coordinator records the capture stage start before capture and the publication stage start before the signed store write. Generic failures use that actual start; already typed PortalCaptureError instances are unchanged. Controlled clock regressions verify 1400 ms capture and 2700 ms publication durations. This does not establish the cause of any historical live exception.

Current capture descriptor/source admission, Desktop collection, stronger interaction/visual receipts, recipes, live generated-case acceptance and final broad reviews remain their assigned later tasks. These graph gates do not complete those capture contracts.

## Verification

All checks ran natively in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. This copy shares the Windows account, filesystem, processes and network; it is not an OS sandbox. No Docker, Superpowers, subagents, browser/daemon actions, dependency installation or primary dist build was used.

- Final fix-1 ten-file sweep: 141 tests passed, exit 0, 107.74 seconds. Files: coordinator, service-graph, module-resolution, service-connections, workflow-requirements, design-evidence, native-work, operational-native, IR portal-completion and shared portal.
- Actual coordinator suite: 31 tests including closure/excluded sibling, colliding references, exact source review/hard parse rejection, uncovered interaction decisions, legacy analysis fencing, qualified reuse evidence, non-commerce/source evidence, collection/style paging and capture elapsed stages.
- Shared, IR, MCP and CLI full TypeScript checks: exit 0. The previously reported concurrent recipe test errors are no longer present.
- An independent TypeScript compiler API check using the MCP tsconfig with all owned roots and their imported dependencies reports zero diagnostics, exit 0.
- All fourteen owned files: oxfmt write and oxlint --deny-warnings pass.

Development sweeps exposed expected missing graph/acceptance markers in synthetic fixtures, a missing imported schema during implementation, incomplete source fixture dependency declarations and unclassified form fields. They were corrected without weakening the source, graph or coverage gates. Native publication fixtures now bind their synthetic acceptance to actual plan analysis; synthetic receipts remain explicitly unit-test-only. Operational Node HTTP fixtures use exact source-bound semantic reviews and still run real HTTP/authorization/SQLite restart checks.

## Exact owned files

Main preimages were rechecked against the original main checkout before publishing this report. The JSON manifest contains path, beforeHash and final hash for allowlist integration. No other source files are owned by this task.

| File | SHA-256 |
| --- | --- |
| `packages/shared/src/portal.ts` | `03baa0702866381b70f571694b07e49672137c57b858eab84474946888c59059` |
| `packages/ir/src/portal-run.ts` | `5a41a6e5b9502fbd3a1fbf896cd23e554e7b940c172a8e0b4c15e850c5db4b28` |
| `packages/mcp/src/portal/service-graph.ts` | `60e54255426fc9d1b258266dcac180c5dc742988e785183685697f7c66a3b9f3` |
| `packages/mcp/src/portal/coordinator.ts` | `7000e25123b3446cf34625a430a0594eb06ae682919d1235385403373ec8d045` |
| `packages/mcp/src/portal/native-work.ts` | `cdfcab34731be730e30af7fe1a7970885e8ae18435e907b85a30502a10150adb` |
| `packages/mcp/src/portal/profile-closure.ts` | `40b898d2d59493b9eb3e9828b4867e7c0ccffb32edb3e0c73731dbb0d87a2564` |
| `packages/mcp/src/portal/service-selection.ts` | `5691df576b65b209e07857693a9e9ed010bbe37b2caba7650bb972aea6ba4ada` |
| `packages/mcp/test/portal/coordinator.test.ts` | `b33b14beb3ac5a545b6cf65ee4c5965d866430e9043e77ba8138c1c1ee410c67` |
| `packages/mcp/test/portal/service-graph.test.ts` | `260cde4d614cb613833e18f52dcc9e33750e7a5818c0c986542e2b865e2a2898` |
| `packages/ir/test/portal-completion.test.ts` | `ac67dc0f91d260bda8efb4d22b4ae797b5df24a3c90ec40868df446b154f2d5f` |
| `packages/mcp/test/portal/operational-native.test.ts` | `ed6d57c71657091af895e4d612a714f4ee4a1e2287552838a67d3edc14d27850` |
| `packages/mcp/test/portal/native-work.test.ts` | `858a38033ada3d529cffa92dc343f8e353e144402d905681f9254697a340a042` |
| `packages/mcp/src/portal/service-connections.ts` | `1c85ece38bd3fa0f23759e69e085007ed9ac8268bfb2f6f74cf0b697b37b3e0f` |
| `packages/mcp/test/portal/service-connections.test.ts` | `9fa79caa3d1890447301cdde06e334d8c9451b001c78458158216e942d00ecbd` |
