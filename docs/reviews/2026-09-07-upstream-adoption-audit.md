# Original upstream utilization and active adoption

Date: 2026-09-07. Consolidated by the main agent from three independent source audits and targeted implementation work.

## Verdict

**The service does not yet fully utilize all useful capabilities from the three original projects.** Name coverage is strong, but several behaviors are partial, some workflow knowledge is only retained as documentation, and portal implementation orchestration remains planned.

The decision is to actively adopt useful code and workflows, with concrete triggers, implementations and acceptance evidence. This is not a plan to stop at a catalog. The first missing behavior, paint-style token export, was implemented during this audit.

The corrected application scope is part of every adoption task: C2/C3 implement the relevant complete portal across UI/backend/API/data/authentication and other required layers; only C4 is frontend-only. The known Figma URL is retained in the [active portal plan](../plans/2026-09-07-portal-four-cases-plan.md).

## 1. What was audited

| Source         | Original pin                               | Local HEAD observed                        | Feature coverage result                                                                                                                                                                               |
| -------------- | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Figwright      | `a835e81b575eab2c9265a67f9353c89b848f81ca` | `202f3beb158cc40da80b7121834353c7ce5283e1` | 112/112 original tool names mapped; two skills and ten references retained; current orchestration uses a subset. The newer local HEAD was not substituted for the original pin.                       |
| figma-mcp-rust | `6094566436577b29d04393c774d51492c12671e1` | Same as pin                                | 73/73 tool names mapped. Twelve original prompt names and thirteen original skill names are not retained as their original catalogs. Several useful behaviors require adapters or recipe integration. |
| figmosha2      | `547cefb4c90abaa1da68db5455b921cbf3f8a5b9` | Same as pin                                | Twenty helpers and twelve CLI parser entries are listed in metadata. Related primitives often exist, but the original globals/parsers and several composite semantics are not implemented.            |

All three upstream checkouts were clean and left unchanged; no fetch or upstream update was performed. Original feature reads use pinned Git content. This audits the original supplied versions, not the latest remote releases.

The current canonical catalog has 116 tools: 51 native, 57 adapter and 8 experimental-native labels. Its 114 lexical upstream names contain 71 names shared by Figwright and Rust; the totals must not be added as distinct features. The Rust compatibility metadata labels 17 names same, 43 adapter, 11 incompatible and two unique. Those labels are not differential behavioral test results.

[Coverage CSV](2026-09-07-upstream-coverage.csv) contains 256 traceability rows: 187 source-to-canonical associations, 20 Figmosha helpers, 12 Figmosha parser entries, 12 Rust prompts, 13 Rust skills and 12 retained Figwright skill/reference documents. This is an evidence index with overlapping associations, not a 256-feature completion percentage. The individual audits also cover transport, UI, packaging, diagnostics and other non-tool behavior.

## 2. Useful gaps found

| Finding                           | Actual gap                                                                                                                                                        | Product impact                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paint-style export                | Before this change, `export_tokens` read variables only, while Rust also exported local paint styles.                                                             | Style-only legacy designs could yield an empty palette. **Addressed in source in this turn.**                                                             |
| Chrome/graph mapping parity       | Direct joins do not consistently retain canonical component/token override handling, paint-style token joins and feedback.                                        | The same design/reference can produce weaker reuse decisions through a different collection path.                                                         |
| Retained skill guidance           | Figwright's two skills and ten references remain the pinned text, including old Chrome launch, baseline-path and token-drift instructions.                        | Available knowledge is not yet a coherent current portal driver. Modernization must retain useful fidelity guidance and respect the user's browser rules. |
| Rust workflow catalog             | Original read/design strategies, prototype flow, style audit, token/palette/type-scale/variants, annotations, bulk/text/override workflows are not fully adapted. | Useful task-level behavior is missing even though many primitive tools exist.                                                                             |
| Figmosha target/search helpers    | ID normalization is not page/selection resolution; substring search is not case-sensitive exact descendant search.                                                | A mapped helper name can select different nodes or produce a different result.                                                                            |
| Figmosha compositions             | Frame/clone/import/variant helpers require dependent IDs, convenience semantics and readback not supplied by a static batch or one primitive.                     | The full workflow is not achieved by labeling a primitive as an alias.                                                                                    |
| Variable and color helpers        | Import and explicit local binding primitives exist, but automatic typed lookup/import composition and real hex/solid builders are incomplete.                     | Reuse requires avoidable manual sequencing and cannot claim original helper parity.                                                                       |
| Doctor and asset/motion workflows | Basic diagnostics and export primitives exist; complete readiness/remedy and selected asset/motion pipelines are not fully integrated.                            | A healthy-looking daemon or successful connection does not establish complete design acquisition or portal fidelity.                                      |
| NOISE authoring                   | Rust supports a NOISE effect subtype that the canonical write schema does not currently accept.                                                                   | Exact authoring parity is incomplete; useful support or an explicit render-preserving fallback is needed when a design requires it.                       |
| Full portal implementation        | The three Figma toolkits and current frontend profile scanner do not implement the required C2/C3 backend/domain/data/auth generation and integrated acceptance.  | This needs new service-graph analysis and orchestration that consumes the adopted design capabilities.                                                    |

Eight motion/video entries remain experimental and deferred in current metadata. They should be selected and verified when relevant, rather than counted as universally available or ignored when a required design depends on them.

## 3. Concrete work completed in this turn

### Paint-style token export

`service/packages/mcp/src/tools/safe-union.ts::handleExportTokens` now reads both `get_variable_defs` and `get_styles` through the existing pinned dispatch path.

- JSON retains variable collections, all modes and aliases, and adds raw `paintStyles` when present plus `styleVariables` when returned. Variables-only output retains its previous shape.
- CSS reuses the existing Figwright-derived `resolvePaintStyleTokens` converter. Single visible solid paints become color tokens; nonrepresentable styles are reported and preserved by JSON rather than converted into invented scalar values.
- Known variable-bound colors use the requested mode and retain paint opacity. Unresolved bindings produce explicit warnings and preserve the observed color.
- Name collisions are deterministic and do not silently replace variable tokens. A failed style read prevents publication of an incomplete file.

This combines a useful Rust export behavior with existing Figwright implementation code. It is a normalized service contract, not a claim to reproduce Rust's original JSON wire shape.

### Honest feature metadata

Both `service/capabilities/figmosha-feature-map.json` and the embedded union surfaces now point `var_`, `importVar` and `doctor` to the existing implementation file. The previous three paths did not exist. Mapping prose now identifies pending exact-search, target-resolution, color-builder, variant, clone and frame recipes instead of claiming nonexistent convenience adapters. Fill/stroke target argument names were corrected.

`service/PROVENANCE.md` now separates current implementation status from Task 1/2 historical scaffolding. Metadata correction does not implement the missing helpers; those remain in the adoption backlog.

### Validation

The [targeted validation record](2026-09-07-adoption-validation.json) identifies the checked source files and the limits of this evidence.

- Six related test files: **65 tests passed** (`tool-contract`, `upstream-parity`, `safe-union`, `figma-tokens`, `operation-policy`, `result-egress-policy`). This includes a regression gate requiring every declared implementation/test path in the capability catalog to exist.
- MCP typecheck and selected-file lint passed.
- MCP and CLI builds passed for the behavior change.
- The Rust reviewer separately ran four focused files/16 tests before the adoption; those overlap other evidence and are not added to the 65 count.
- No new live Figma behavior, full-suite run, complete helper compatibility, generated portal acceptance or packaged release is claimed for this change. The previous 3,325-test/source receipt remains historical and predates this adoption.

## 4. Active adoption backlog

| Priority / group                        | Implement and use                                                                                                                                      | Trigger / integration                                                               | Required proof                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| First / grounding and mapping           | Reuse full Figwright component/token/icon/override logic in Chrome, Desktop and graph paths; finish required assets.                                   | All design-to-blueprint paths, especially C2/C3 reference reuse.                    | Same source/design produces consistent mappings; missing evidence remains partial; verified overrides survive later runs. |
| First / typed target helpers            | Implement page/selection/URL/ID and exact-name descendant resolution using Figmosha semantics.                                                         | Scope resolution and named-component/token workflows.                               | Exact case/root/duplicate/empty-selection/cap/file-change fixtures and a consuming workflow test.                         |
| First / tokens and style audit          | Use the adopted paint-style export; integrate Rust style audit and design-token generation into real palette/theme decisions.                          | Style-only files, raw-style drift, theme/variable mapping.                          | JSON/CSS/mode/opacity behavior plus a blueprint that actually consumes the exported values.                               |
| Next / reusable task recipes            | Adapt all useful Rust skill/prompt intents and both Figwright skill families, plus Figmosha recipe knowledge, into an English callable driver catalog. | Read/design/prototype/text/annotation/rename/style/variant/override/recovery tasks. | Every supported recipe has declared tools/effects and a real end-to-end task result, not only a copied Markdown file.     |
| Next / variable and composition helpers | Typed local/library lookup, color builders, import/bind, dependent-result frame/clone/variant/readback recipes.                                        | Reusable design components, bindings and targeted design authoring.                 | Canonical admission, final node state, font safety, cancellation/partial-effect/retry tests.                              |
| Next / motion, assets and diagnostics   | Need-triggered motion/prototype extraction, curated/composited asset handling, richer doctor and ordered export handoff.                               | Required interactions, unavailable assets, connection failures and design delivery. | Observable behavior/visual results, explicit experimental limits and actionable diagnostics.                              |
| Core portal / C2-C3 service completion  | Service graph and all required UI/API/domain/data/auth/jobs/provider/environment changes.                                                              | Every operational-portal run.                                                       | Real integrated journeys and persistence/auth checks; independent C3 install/start; C2 compatibility and recovery.        |
| Conditional / design round trip         | Reuse existing component/style/variable/layout/write tools for requested code-to-Figma or design-system work.                                          | Only when the task needs a design artifact or counterpart.                          | Correct component/token reuse and scoped readback; no irrelevant canvas mutation.                                         |

The [v2.0 plan](../plans/2026-09-07-portal-four-cases-plan.md) assigns these groups to implementation stages P1, P6-P8 and their acceptance gates. Useful behavior receives an implementation owner/path and tests, while duplicate surfaces can share a single supported recipe.

## 5. Completion rule for upstream utilization

Every inventoried feature receives an explicit disposition: retained-and-used, adapted-and-used, available-on-demand, planned-adoption, conditional/experimental, or replaced/excluded with a reason and alternative. Coverage records bind code and tests; use records bind an actual run's selected recipes and results. A workflow must consume the output for its intended decision or implementation step.

Full utilization is not established today. Useful adoption is now an explicit implementation track, and the first confirmed functional gap has been fixed. The service must not convert a complete tool-name table into a false claim that every source behavior or complete portal workflow has been exercised.

## Source-specific reports

- [Figwright: complete original tool inventory, skills and non-tool behavior](2026-09-07-upstream-figwright-audit.md)
- [Rust: all 73 tools, 12 prompts, 13 skills and adoption recipes](2026-09-07-upstream-rust-audit.md)
- [Figmosha: all 20 helpers, 12 parsers and six adoption recipes](2026-09-07-upstream-figmosha-audit.md)
- [Main scope decision](2026-09-07-portal-scope-decision.md)
