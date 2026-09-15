# Task 5.4 implementation report

Date: 2026-09-15. Status: implemented and frozen for independent review.

## Scope and ownership

All implementation and native validation ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. No main source, dependency versions, index, browser, Figma document, daemon, primary dist, Docker, upstream code-kb checkout, commit or push was changed. No skills or subagents were used. Native execution uses the same Windows account and filesystem/process/network permissions; this working copy is not an operating-system sandbox.

Twenty-four owned source/test files are listed below. Additional controller-approved contracts are the mapping sections of shared/result-schemas.ts and optional GroundingGraphV1.mappingObservation. No shared/index.ts, shared/portal.ts, IR portal-run, action nonce, capture, normalization or DesignObservation implementation was changed. No serializer.ts edit was needed: full get_design_context reads actual node mode records and reuses the component API serializer.

## Implemented behavior

- One common normalization/mapping adapter feeds actual Chrome inspectProject, Desktop token/component/icon tools and persisted grounding graph. It consumes the reviewed normalizeDesignObservation contract. Standalone reads remain legacy-unverified observations, never coherent/live capture authority.
- Variable mapping retains source ID, collection ID, default mode ID and ID-keyed modeValues. Display-name changes do not replace source identity. Catalog defaults are presentation only. Missing collection/value context is unresolved; same-named modes in different collections are not joined, and no first/default mode substitutes for observed node selections.
- Actual per-node collection selections, inheritance, aliases, observed values, component APIs, variant/property and instance override evidence survive the consumers. The graph retains mappingObservation under its existing content hash. Historical graphs without that field remain readable.
- Full Desktop get_design_context now emits referenced variable values, bounded alias dependency closure, collections/modes and paint-style values. Missing references retain unavailable observations. Existing get-variable-defs value serialization and get-component-api property serialization are reused.
- Single-solid paint styles produce the same pseudo-token records in all consumers. token_map propagates style enumeration failures. Optional nodeId collects full context through the existing dispatch and retained plugin scope. The current operation policy already declares FIGMA_READ plus retained repository reads; nodeId adds no filesystem argument or effect. Existing index dispatch calls plugin.execute with the retained scope and derived child action; no routing bypass was introduced.
- Legacy map rows remain capped, explicitly unverified hints. Component file existence preserves a low-confidence hint, never API proof; missing API axes are surfaced. Shared override loading uses retained RepoReader for map contents and component target existence, and tolerates only REPO_FILE_NOT_FOUND. Other authority/read/decoding failures propagate.
- Version-2 token proof rows in an sfp-token-map-v2 JSON fence bind sourceId/type/value/collectionId/defaultModeId/modeValues and token/ref/projectValue/from/codeSourceHash. Current source IDs allow naming drift; changed value/type/modes/reference or source bytes invalidate verification. Duplicate proofs are not authoritative. Only mechanically comparable uniform catalog values verify; different target declarations, unsupported easing conversions and theme-varying source values remain unverified. Runtime property/theme consumption is separate.
- The code-source loader records the exact bytes actually supplied to existing token parsers, including importer/config reads absent from loaded.files. It delegates all operations to the same retained RepoReader, rejects conflicting repeated reads and reobserves recorded bytes before publishing the codeSourceHash. It does not replace readers with raw filesystem access or claim atomic capture.
- Duplicate/malformed catalog IDs retain raw evidence and explicit incompleteness; their retained first rows cannot become verified mapping values. Ambiguous SCSS declaring files remain visible, including legacy override paths. Name-only and unsupported unit/color matches remain capped candidates.

## Red/green and verification

Initial focused regressions reproduced both defects before implementation: a cross-collection alias incorrectly resolved through an equally named/default mode, and a legacy same-name/ref row with a changed color incorrectly returned high confidence. Both passed after the implementation.

Final combined native run passed **410 tests in 27 files**, exit 0. It includes actual three-consumer tests with real bounded filesystem discovery/readers, strict mapping result schemas and persisted graph validation; cross-collection aliases with inherited and sibling selections; duplicate names/IDs; unavailable values; missing component API axes and retained instance overrides; ambiguous SCSS files; name drift, actual same-name value drift, malformed proofs and stale source/type/mode/ref proofs. A native source mutation after the parser read is rejected with MAPPING_SOURCE_CHANGED, while the unchanged source succeeds. Plugin producer tests cover real serialized values, dependency aliases, collections, mode records, paint values and component API options. Existing token, join, snapshot, projection and design-context guard suites also pass.

The final combined command was:

```text
corepack pnpm exec vitest run packages/mcp/test/mapping-consumers.test.ts packages/mcp/test/mapping-parity.test.ts packages/cli/test/project-inspector.test.ts packages/mcp/test/tools/token-map.test.ts packages/mcp/test/tools/component-map.test.ts packages/plugin/test/handlers/get-design-context.test.ts packages/shared/test/design-context-dedupe.test.ts packages/ir/test/grounding-graph.test.ts packages/mcp/test/tokens packages/mcp/test/join packages/mcp/test/snapshot packages/mcp/test/tools/design-context-guard.test.ts packages/plugin/test/handlers/projection-coverage.test.ts packages/plugin/test/handlers/get-component-api.test.ts packages/ir/test/snapshot-v1.test.ts
```

Native package typechecks passed for @sfp/mcp, @sfp/cli, @sfp/shared, @sfp/ir and @sfp/plugin (plugin uses vue-tsc). An initial plain tsc invocation for the Vue plugin was the wrong validator and reported unresolved .vue imports; the package's actual vue-tsc command passed. A transient hoisted helper type was corrected, and MCP/CLI checks were rerun successfully. Oxfmt formatting/checks and oxlint --deny-warnings passed for all owned files. The complete existing knip command passed after removing the now-unused CLI-only browserVariableDefs helper. Test assertions that depended on unsafe historical alias/override/high-confidence semantics were updated; matching, source selection and ambiguity checks were retained.

## Remaining integration handshake

- Task 6 must consume these canonical mapping values, node bindings and explicit proof status in typed recipe results and verify required actual source/runtime use. A verified uniform catalog override is not evidence of CSS theme wiring or component runtime API compatibility. Unsupported conversions remain explicit candidates.
- Existing service prompts/skills still include historical claims that name/ref rows become confidence 1 or that a collection default is an active theme. The actual mapping tool descriptions have been corrected here. Task 6 owns broader prompt/skill modernization: specifically packages/mcp/src/prompts/figma-to-code.ts has the obsolete confidence-1 row guidance, as observed by source search. This task did not edit that out-of-scope prompt.
- There is no existing record-token-map writer tool in the current source/tool registry. Proofs use the existing repository map-file format and bounded reader; no new authoring effect or relaxed nonce/filesystem write path was introduced. A future admitted writer must retain existing writer authority and produce the v2 shape, not resurrect name/ref verification.
- The optional graph observation remains within existing storage byte limits; limits were not raised. Large inputs may fail bounded storage rather than silently dropping evidence. No live Desktop or Chrome acceptance, primary build, package regeneration, portal apply or source-wide release acceptance was attempted.
- Parent final contract/provenance regeneration, two whole-code review rounds and final delivery remain required. Diagnostic .task-5.4-owned-files.json and .task-5.4-test-results.json in the native service copy are local scratch evidence, not source integration inputs.

## Exact reviewed source bytes

Paths are relative to the service directory. The companion task-5.4-owned-files.json contains each source hash and main-checkout beforeHash for guarded integration.

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/project-inspector.ts` | `699686375d7840c3719a0012bb0b43d2b56a9e67eda29361b6d71b4d59f113df` |
| `packages/mcp/src/tokens/figma-tokens.ts` | `60c3605e5007e2f20af20363a3d3ac23b27d9dfcb8c90c12fbc0d6ad15c18126` |
| `packages/mcp/src/join/token-map.ts` | `d83eb6b4beff96b4242aa5ac6f97125110e04fa73465fa6310a99bba50c20eb9` |
| `packages/mcp/src/join/component-map.ts` | `58386a7ee16a2c5ae8eacba7c7cd6a882b6cc8cef02a52d1aa736923de89fdf1` |
| `packages/mcp/src/mapping/design-mapping.ts` | `d6d18f608fd68c9902b119319fe8e73e9bb337ec4e602d695cab75c6a1b12273` |
| `packages/mcp/src/mapping/mapping-overrides.ts` | `23827d3a308e8a9ebb8fad3b9663f0d0d95b67a3a5ce8b5c44d1c240a20a1f76` |
| `packages/mcp/src/tools/token-map.ts` | `27e7a2ecaea8f9c8228c699be1ebd5d13ac2770d40281e28c3d9bc6b26d50fe3` |
| `packages/mcp/src/tools/component-map.ts` | `12db3c61baaf9e2231613ee893cd5d7b59a15918371fb466544c451e56accccf` |
| `packages/mcp/src/tools/icon-map.ts` | `ddbb130ee3e153506a6543b9926c5e5d63a548b5480ab481d0625678eb358287` |
| `packages/mcp/src/snapshot/build-grounding-graph.ts` | `9b446641e1027d030c115ae3952e728a6571853c735f8e83f3eb730ff4ad32d5` |
| `packages/shared/src/design-context.ts` | `02891bfad17a407a44e2fe18c9705bfbe3aa3005a2dca32e186c957bb1afbec5` |
| `packages/shared/src/result-schemas.ts` | `cdcccf2adb6e142fcfdf9c04bd310c53a123f1e34ca96c8c5b976a0d8b944b4c` |
| `packages/ir/src/grounding-graph-v1.ts` | `6133bb7649e9f71f6df361f317e95f912e14766b9337dfad1ff04201dcc3869b` |
| `packages/plugin/src/handlers/get-design-context.ts` | `e89c389a82bbf91a6a6e6d7b5c8c93ad3cc65a671dfc0dfc29fc1d40da232409` |
| `packages/plugin/src/handlers/get-variable-defs.ts` | `104f0b767e247352429a055f1963f4b3f5d1938b5ce6fcf94717824f1b61a69a` |
| `packages/plugin/src/handlers/get-component-api.ts` | `07ddd28f36a57f78a77b6645342d71a3774be3dc24b73ad21e7eb8426fa3d3f5` |
| `packages/mcp/test/mapping-parity.test.ts` | `20a8595ee45252f1ef5428fcec6a628d16da9aede56b6681acd2a249b772828f` |
| `packages/mcp/test/mapping-consumers.test.ts` | `b33b2e157f0972dc0ed013043e899f20c1183882c420fd39c242993fad9de957` |
| `packages/mcp/test/join/token-map.test.ts` | `f8672f66a8f9037eea97e8f9600aade35478e7664210647689b6a9578d49c8f1` |
| `packages/mcp/test/join/component-map.test.ts` | `49bea760e378f75adaedd277c07d8ed4e4706a40b18ca16ac7dbcef24b91e4b8` |
| `packages/mcp/test/tools/token-map.test.ts` | `e1993561f40ca64c503ee14b9846f005ad3a6b6633d9232211d6f506c209a9bf` |
| `packages/mcp/test/tools/component-map.test.ts` | `c602dd3eaf8c6384e518b15be8c533c36cb255f6bb0084baf1f0044570ccb722` |
| `packages/mcp/test/tokens/figma-tokens.test.ts` | `cb31dec31fae31a0f754d15f762f21912096f6e443a538241923549c968aef6e` |
| `packages/plugin/test/handlers/get-design-context.test.ts` | `2487458ca8b23268b9d579080ab8bdbf73d07669d0ef7a26ef3af24d3bff1f81` |
