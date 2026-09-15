# Task 5.4 fix 1 report

Date: 2026-09-15. Status: frozen for scoped rereview. All three independently reproduced P2 findings are addressed. This is not final whole-code review or live service acceptance.

## Scope and preserved evidence

Source changes remain entirely in the separate native copy at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. Eight files changed within the original 24-file ownership manifest. No new source path, index export, portal/native/coordinator/capture change, daemon, browser, build, dependency, Docker, upstream checkout, skill, subagent or Git mutation was introduced.

The main SDD workspace retains `task-5.4-initial-report.md`, `task-5.4-initial-owned-files.json` and `task-5.4-initial-review.diff` unchanged. The full current `task-5.4-owned-files.json` preserves every ORIGINAL main beforeHash. `task-5.4-fix1-delta.json` records initial/current hashes for the eight changed paths; `task-5.4-fix1.diff` compares exact reconstructed initial reviewed bytes with current bytes. Initial reconstruction was hash-checked against the preserved initial manifest before producing the delta.

The frozen reviewer diagnostic `packages/mcp/test/review-task54-parity.test.ts` remains unchanged at SHA-256 `1b6d9106f264274b026add48ec0012b90a59e8a674141c293f0ded61ec4f790b`. It is excluded from integration, along with its retained fixtures.

## F1: Retain referenced remote dependencies and conflicts

The existing common observeMappingContext adapter now accepts optional local variables/styles catalogs. Desktop token_map supplies both local catalogs and the selected full context. Referenced remote variables, collections and paint styles already returned by that context are merged rather than discarded.

Materially identical records deduplicate despite missing/different library keys, descriptions, collection membership metadata, ordering of collection modes, empty code syntax, or color convenience hex/alpha fields. Local rows and the full original context remain retained in the raw observation. Actual value, type, default-mode, mode or paint differences retain duplicate-ID evidence and remain incomplete; one read cannot overwrite another. The shared mapping normalization wrapper makes bindings unresolved when a variable/collection conflict exists, instead of letting the retained first row masquerade as a trustworthy resolution. Chrome inspection and persisted-context mapping use the same wrapper. No collector/coherence authority is added.

## F2: Bind a component override to its recorded path

Recorded component resolution now stays within the exact recorded path. A same-name symbol in a different file cannot validate a missing target. Missing target paths produce stale override evidence and a normal scan candidate that carries its real path. Parsed same-file results use their actual scanned symbol name. Existing unparsed files remain low-confidence legacy hints, and file existence still does not prove component API compatibility.

## F3: Persist canonical mapping results and proof/source binding

GroundingGraphV1 now optionally stores compact mappingResults with version 1, codeSourceHash and strict token/component/icon mapping items. These use the existing strict shared result-item schemas; no duplicate schema predicates or shared/index.ts edit was added. Component observation copies are omitted from mappingResults because mappingObservation already retains the design evidence.

The existing graph content hash binds mappingResults. In particular, current verified versus stale token proof status now creates different stored graph content identity even when the fallback candidate and confidence are otherwise the same. The current code-source binding, source IDs, mode values, stale rows, legacy hint status and ambiguity remain inspectable. Historical graphs without mappingResults remain valid and receive no fabricated proof. Existing graph storage byte bounds are unchanged. Catalog proof status is still distinct from runtime token/theme use or component API verification.

## Red/green and native verification

Four new actual-consumer regressions initially failed for remote catalog loss, conflict handling, missing component paths and graph proof persistence. After fixes, those tests and the unchanged three reviewer diagnostics pass. Additional cases cover metadata-only duplicates, actual mode/paint conflicts, graph hash tampering, compact result payloads and legacy graph absence.

Final combined native run: **419 tests passed in 28 files**, exit 0. This consists of 416 owned/existing affected tests plus the three frozen reviewer diagnostics. It includes token/join/snapshot/guard/projection suites and actual Chrome/Desktop/persisted-graph consumers using bounded repository readers and strict result schemas.

```text
corepack pnpm exec vitest run packages/mcp/test/mapping-consumers.test.ts packages/mcp/test/mapping-parity.test.ts packages/cli/test/project-inspector.test.ts packages/mcp/test/tools/token-map.test.ts packages/mcp/test/tools/component-map.test.ts packages/plugin/test/handlers/get-design-context.test.ts packages/shared/test/design-context-dedupe.test.ts packages/ir/test/grounding-graph.test.ts packages/mcp/test/tokens packages/mcp/test/join packages/mcp/test/snapshot packages/mcp/test/tools/design-context-guard.test.ts packages/plugin/test/handlers/projection-coverage.test.ts packages/plugin/test/handlers/get-component-api.test.ts packages/ir/test/snapshot-v1.test.ts packages/mcp/test/review-task54-parity.test.ts
```

Shared, IR, CLI and plugin package typechecks passed (plugin uses vue-tsc). The unmodified MCP package typecheck additionally includes the retained, unrelated Task 4.2b reviewer diagnostic `test/portal/review-task42b-consumers.diagnostic.test.ts`, which has five unused imports. That diagnostic was not edited. A temporary validation-only `packages/mcp/tsconfig.task54-fix1-check.json` extends the real configuration and excludes only that file in addition to its original dist/node_modules exclusions; the MCP source and remaining tests passed that check. The config is scratch evidence, not an integration input. An initially missing import in the new legacy graph test was corrected before the final passing run.

Oxfmt formatting/checks and oxlint --deny-warnings passed for all 24 owned files. Knip reports only the independently active Task 6 export `portalRecipeConsumptionContentHash` in `packages/mcp/src/portal/recipes/definitions.ts`; no Task 5.4 unused export is reported. This is not recorded as a globally clean knip result.

## Remaining scope

The initial report's Task 6 handshake remains: consume canonical mapping results and proof status in typed recipes; modernize historical prompt/skill confidence-1 guidance; verify actual code/runtime theme and API use. No live Chrome/Desktop capture, portal apply, primary build, artifact regeneration, full release acceptance or final whole-code review is claimed. Native checks share the user's Windows account and filesystem/process/network permissions; the separate copy is not an OS sandbox.

## Fix delta

| Path | Initial SHA-256 | Current SHA-256 |
| --- | --- | --- |
| `service/packages/cli/src/project-inspector.ts` | `699686375d7840c3719a0012bb0b43d2b56a9e67eda29361b6d71b4d59f113df` | `f65654d5a78ed79d2a5f07e180bb4347e8920c39555350e0e965f50c9893ca9f` |
| `service/packages/mcp/src/join/component-map.ts` | `58386a7ee16a2c5ae8eacba7c7cd6a882b6cc8cef02a52d1aa736923de89fdf1` | `139c5eea24d13e55a5dc31909b96312605089367491e682d805e394bfec99cd7` |
| `service/packages/mcp/src/mapping/design-mapping.ts` | `d6d18f608fd68c9902b119319fe8e73e9bb337ec4e602d695cab75c6a1b12273` | `8325ae9e7f583d700c94fae26138583d2f33c2144b64c8a43a366e9814526684` |
| `service/packages/mcp/src/tools/token-map.ts` | `27e7a2ecaea8f9c8228c699be1ebd5d13ac2770d40281e28c3d9bc6b26d50fe3` | `23ed5b33a3565b067713c295502f1f8beb30c67bb8e6b9082b2e2ce4305cfe56` |
| `service/packages/mcp/src/snapshot/build-grounding-graph.ts` | `9b446641e1027d030c115ae3952e728a6571853c735f8e83f3eb730ff4ad32d5` | `bbacc372f878068b3ac00bec77baaa2cb9d84140e349b3297b7c678ddad5a7dd` |
| `service/packages/shared/src/result-schemas.ts` | `cdcccf2adb6e142fcfdf9c04bd310c53a123f1e34ca96c8c5b976a0d8b944b4c` | `1001ad22316230db2eed7bab52103af4c7db6016e683c90028ad13c6ae9206be` |
| `service/packages/ir/src/grounding-graph-v1.ts` | `6133bb7649e9f71f6df361f317e95f912e14766b9337dfad1ff04201dcc3869b` | `3ac1b3e10fab9a0866bd8f10488b371012bf09d9825c51db4590676694f53b4b` |
| `service/packages/mcp/test/mapping-consumers.test.ts` | `b33b2e157f0972dc0ed013043e899f20c1183882c420fd39c242993fad9de957` | `6867b1626be02cc978daf9a5663cd3dcd53a207bf4771e7b0175488adb0217f0` |
