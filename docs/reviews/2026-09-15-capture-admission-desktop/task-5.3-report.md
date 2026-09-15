# Task 5.3: Admitted Desktop and Chrome capture integration

Date: 2026-09-15. Implementation candidate is ready for controller review and integration. This report covers the assigned capture admission, collector, descriptor and current consumer gates. It does not claim live Desktop host acceptance, final live C4 implementation, Task 5.5 interaction receipts, portable packages or Task 6 recipe completion.

## Environment and ownership

All source edits and native checks ran in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. No Superpowers skill, Docker, subagent, browser attachment, Figma call, daemon, primary build, dependency installation or Git mutation was performed. The native working copy shares the Windows account, filesystem permissions, process namespace and network; it is not an OS sandbox. Original code-kb checkouts were not changed.

The controller released shared portal, IR plan, coordinator, native work and profile closure after integrating reviewed Task 4.2b fix 1. Source/analysis/native lifecycle gates and independent catalog paging remain present. Task 5.4 mapping producers were preserved. The controller owns migration of preexisting coordinator/native/capture-flow/operational/IR test fixtures; those edits are deliberately absent from this candidate manifest.

## Canonical admission and invocation

The design request now selects source: chrome or desktop, with Chrome as the existing default. The new portal-source target selector is request intent, never permission. MCP leader and follower adapters and the CLI use it only as the implicit default for portal_plan and portal_validate. Explicit none, active and session selectors are retained; contradictory selectors fail. The generic target resolver rejects portal-source outside canonical portal admission.

preparePortalCaptureAuthority is the production preparation helper used by index.ts and integration tests. It resolves the owner-checked request or signed run/plan before selecting a target, then preserves repository/native preparation. Other portal status, cancellation and inspection calls stay target-free. No untrusted caller can supply an actor, generation, grant or handler dispatch capability through the new query schemas.

Desktop admission uses the actual authenticated session index and existing signed DocumentBindingStore or privileged bootstrap session bindings. Direct Figma file keys and owner-confirmed document/session bindings are supported without Dev Mode. Duplicate matching sessions require an explicit session choice. Wrong files, unverified identities, missing sessions, unsupported editors and replaced generations fail before capture effects. Session identity is copied before asynchronous binding reads, so in-place source-object mutation cannot refresh the originally observed identity. Binding resolution uses the actual signed store; a modified binding with an unchanged HMAC fails verification.

The immutable execution fingerprint gains the capture grant without replacing repository, native environment or candidate identity. Existing native/database/repository lanes remain; the selected Figma resource adds a conflicting execution lane. Desktop grants contain session, plugin generation, actual file identity hash, execution key, binding method and binding hash. The runtime revalidates these before and after every plugin child read/export, including after consent waits.

Chrome has a deliberate two-stage ordering. Before approval, its grant contains only canonical requested URL/scope and collector mode, explicitly phase requested-source. An unopened CDP connection is not inspected before its declared external-browser-read permission. The existing service connection then selects and verifies the actual page before any design read. That page is retained across all reads, exports and reobservation. Signed attempt records now retain selected-source observation, honest collector provenance and service page/attempt identities. Those identities are not plugin generations or document epochs. No additional Chrome client is created by this change.

## Shared closed collector and Desktop transport

The previously reviewed Chrome read query implementation is now a compiled shared function. Desktop calls the compiled function through two fully registered canonical plugin read primitives: portal_capture_read and portal_capture_asset. Their argument/result schemas, plugin handlers, runtime result validation, operation policies and egress policies are closed together. Both remain separate from the nine portal lifecycle tools. Asset arguments and results use strict object envelopes around typed query/result variants.

Chrome serializes this same fixed compiled read function with schema-validated data for Scripter. There is no caller-provided JavaScript and no Desktop eval path. Existing Chrome generated-program tests exercise the resulting program in a controlled VM. Tree, root, catalog and reference queries retain prior bounds, exact cursors and final ordered reobservation. Catalogs preserve variable/collection values, modes, aliases and four independent style families; missing APIs are not successful empty catalogs. Remote references are read-only, never library imports.

readDesignSnapshot and captureDesignAssets extract transport callbacks from the existing Chrome implementations. CoherentDesignCapture shares before/read, asset export, after/read comparison and signed checkpoint persistence. Desktop and Chrome both retain the existing two-attempt, 300-second coherence window, 256-call/12 MB individual reader budget, independent reference closure limits, 512 asset batches per attempt, 100,000 records and 512 MiB aggregate logical asset budget. Image chunks retain 1 MiB transfer pieces and a 16 MiB original limit; node exports remain exact-scale PNG or SVG within the existing 5 MB per-export wire bound. Stroke and styled-text image references are included, and identical root bytes never collapse distinct root export queries.

The Desktop transport retains RuntimeExecutionScope, the validated PinnedPluginRuntimePort, reporter and parent RuntimeActionContext. Every child gets a deterministic distinct parent-bound action nonce. Cancellation returns without continuing to exports; a late underlying Plugin API read cannot authorize further work. Closing the scoped collector does not close the user's plugin session. The raw Desktop source is figma-plugin-api-pinned and its provenance is pinned-desktop-plugin-v2. Legacy desktop-plugin payload normalization remains supported for inspection. Desktop output is never labeled Chrome output.

Coherence remains non-atomic. Ordered rereads do not detect transient ABA changes or changes after an earlier final read, and no document epoch is invented. A real paired service plugin in Figma Design is required for Desktop execution; installing Figma alone is not evidence of that connection.

## Current descriptor and consumers

A current immutable plan descriptor includes version 2; original raw/asset-manifest hashes; content, source, contract and asset fingerprints; the semantic design fingerprint; the original collector evidence/provenance digest; and the exact original admission grant. The latter also enters the evidence digest, binding the actual Desktop document identity and owner-confirmation record into plan identity. Legacy records remain parseable, but boolean complete/liveVerified fields cannot create current execution proof.

Original descriptor verification compares the original signed designs record, source kind/canonical URL, raw hash, asset manifest and exact admission/evidence. A bounded RepoReader verifies actual referenced asset bytes, sizes and hashes before profile, generation and execution authority is consumed. The original asset root is retained. Complete capture publication requires the admitted grant to match the observed collector, file, requested scope and Desktop session/generation.

Coordinator preparation/execution, profile preparation/registration, native validation/application and IR completion now consume current descriptor proof. Partial designs can start needs-input runs and be inspected through portal_next with no generation lease. Status/cancel and resume inspection retain their historical target-free behavior. Source-only inspection utilities do not gain a new capture prerequisite.

Native require-live validation rejects absent, wrong-file or wrong-collector grants before profile lookup, native execution or freshness capture. Desktop additionally requires the operation-scoped capture capability; admitted Chrome can use the retained service-owned Chrome port. Freshness independently validates current capture and bytes using the newly admitted grant, then compares semantic source/fingerprint. It deliberately does not compare the fresh attempt's whole raw/evidence digest to the original attempt. Acceptance carries the original descriptor hash and fresh semantic fingerprint. Final applied-source verification occurs after the new capture/asset checks as well as the existing native/output checks, preserving the postfreshness source fence.

## Verification

The broad focused command completed with 21 files and 235 tests passing (21.05 seconds). It covered capture admission, Desktop collection, descriptors, real execution-plane/runtime integration, native admission negatives, existing Chrome coherence/session/normalization, browser readers/catalogs/assets, target resolution, execution-plane lifecycle, shared portal schemas, runtime authority, operation/egress policies and CLI admin/portal commands.

After the final narrow diagnostic/source-observation changes, capture-admission, capture-coherence and capture-plane were rerun: 3 files, 27 tests passed (6.01 seconds). Owned-file oxfmt and oxlint --deny-warnings passed. MCP tsc and plugin vue-tsc passed. CLI tsc passed before concurrent Task 6F protocol changes; the latest CLI run reported only recipe-runner.ts:57 missing operationName, outside these owned files. Knip reported only the concurrent unused RecipeAuthority export in recipe-plan.ts; the unused private CLI MAX_CAPTURED_IMAGE_BYTES re-export was removed, while its actual shared limit and consumers remain.

New controlled tests use real signed owner stores and the production admission helper. Positive Desktop and Chrome paths traverse LeaderGenerationExecutionPlane, OperationExecutor/OperationJournal, the validated runtime registry, scoped capture factory and signed plan publication. Regressions include wrong/duplicate/replaced targets; in-place identity replacement during a binding await; actual signed no-Dev-Mode document bindings and HMAC tampering; generation change during consent; direct/follower MCP intent; explicit CLI overrides; bounded catalog continuation; original stroke/text image bytes; identical-byte distinct root queries; same-ID mutation during export; missing APIs; waiting-read cancellation; changed original assets; legacy/current descriptor separation; and no-grant native validation with zero profile/native/capture effects.

The controller separately reported migrated native freshness positives/races passing, including different original/fresh evidence hashes with equal semantic fingerprints, a current capture receipt and unchanged original signed asset root/raw. These controller-owned tests are outside this worker's manifest and should be included in final integration verification. No actual Desktop relay connection, final daemon build, final source/package verification or live supplied-Figma acceptance was performed in this task.

## Review and integration

All listed hashes are SHA-256 of final isolated bytes. The companion manifest contains original main preimages captured only after ownership release. Main preimages were rechecked when this report was written. Review/integrate only these paths; retain the separate candidate until controller review passes. Refresh generated tool contracts/provenance and final package artifacts in the planned final integration stage; do not treat the two new service-owned primitives as upstream name-only feature claims.

| Path | SHA-256 |
| --- | --- |
| packages/shared/src/figma-capture-query.ts | 36e4232eee2af2a8f1e2e035b56bf06d9712ac00001c15d0965b813b54547bb6 |
| packages/shared/src/figma-capture-read.ts | 1bfcf669cb074c4e42da0d02f2f8c6d99ca309e4133693f74a3b1d522fe14c3b |
| packages/shared/src/figma-capture-assets.ts | bcb40a40fe95e8ba501cf8185b9840ce848df8c2688da7210a4ca25832afda3e |
| packages/cli/src/read-program.ts | a954226ecc23604170150e0fc8fd61ee41d30bc9ee0279f42caf3aa4ccf61d7e |
| packages/cli/src/asset-program.ts | 101f29087d5bc96622aab596b51fc58662ec178abaf078581337613fc037ae02 |
| packages/cli/src/snapshot-reader.ts | 35c66f589330b9fdf8b429ce59153a6f36e86f522557e90e1908c4431c696150 |
| packages/cli/src/capture-assets.ts | d1aef761351343bb96ae798c958ea4bfbb0f7a53bfe8c0d9e9a79e3aa9dd59e1 |
| packages/cli/src/scripter-bridge.ts | 4be5e1c241960231394c014dd8332d1c90ea2ee8d0446a1656d499bd9d1acbe2 |
| packages/plugin/src/handlers/portal-capture-read.ts | 3ad4f4516f8884e58895c3cb5f837f2ed6e32150a6bcb08ce0003d1ce85c72a7 |
| packages/plugin/src/handlers/portal-capture-asset.ts | fae99c424f14aab23d4af853805b114f08b9fa4a2a54b8c636b94174f7864c11 |
| packages/plugin/src/handlers/registry.ts | ca4c0803c24324abf08e610a52c31b74b78dd33708d5ac6b1c4bb1ebd04ac0b9 |
| packages/mcp/src/tools/portal-capture.ts | 3600346bdf1f02015c3adab3a76043a906d82fc01e5d2eb5ad7318a24a196db8 |
| packages/mcp/src/tools/registry.ts | 789ec5bbc3dc25b424bf3d54b03552d1ccbe6bc7bd01dd68e5607272a033c54e |
| packages/mcp/src/policy/operation-policy.ts | 20dd9455d07ab8989fc92d23144a96c37cc2981e8ea13c641ad5cbc6218136a3 |
| packages/mcp/src/policy/result-egress-policy.ts | 54ae6287eab26de104bdbd376f9b848d646b2149ae802ac22802a619a713d872 |
| packages/shared/src/result-schemas.ts | 62662953547febaa9e247d5b51cb06de27045c485e20ad651a5ed0a06c7b26c0 |
| packages/shared/src/portal-capture-source.ts | b47ab38481fd10a3064680ae03d35939f9515003b568f2511f30f3a160be0d2a |
| packages/mcp/src/portal/capture-source-admission.ts | 9b8b8232327fa5f9ce91328149a81aa72225b8204f92209150db5b2c2ad2f3b6 |
| packages/mcp/src/portal/desktop-capture.ts | bef45be78acb3d2df4e7f359f67d0c114560d7e18c4bfe5f46725031da015438 |
| packages/mcp/src/portal/design-capture.ts | 36a915c197949fea47f93126ca1aa36061620f7461b9b08254275f4f30181a0d |
| packages/mcp/src/portal/design-normalization.ts | f4cbd16c49433543ea679807453cf11edf01224636af5315f90b0a84a511a1c8 |
| packages/shared/src/invocation.ts | 65106c20c060a8e948958154938add56f303cd5c9dd4fbfadf2a6490f1920476 |
| packages/mcp/src/execution/execution-plane.ts | e3f2ba239004b9f08f9ac64c5c98989b878951151d53314955f3c85184bea26d |
| packages/mcp/src/execution/mcp-invocation-adapter.ts | f12e9564fc6fe7cfcffad15c6d081c43b233f64774a1deb71d914ca988719a2c |
| packages/mcp/src/execution/target-resolver.ts | e28c82bfcbe7748cdefe9218b7d5d69402610c354c355222ee8f0519056cc13b |
| packages/mcp/src/index.ts | beeb1e4ae19faae45af1fdacf6d3db7e97fa90e214eedb286380172001411f4d |
| packages/shared/src/portal.ts | e5054aa42348d45cdb2cfaf15d751f82ed4b3f054395b7392ff5adeb5413e674 |
| packages/ir/src/portal-run.ts | e138014a41b8803dc656b56809c0e1edaf9e97fadd54edc4355ed809afe9bfc0 |
| packages/mcp/src/portal/coordinator.ts | 410f8d6a64dba03eb30e68ed8d1c8e596f6079f749e3f72a076d93c32ff2ca9b |
| packages/mcp/src/portal/native-work.ts | 43a94cc42962bbd9bae183af01fbe00964a9fc59e6cca44748d91bc5eef6f9e8 |
| packages/mcp/src/portal/profile-closure.ts | 02780eca7bb84523c2494724b09ea9a268ffded31bca41c026a0b0d340dc3126 |
| packages/mcp/src/portal/control.ts | 6516c3c60810e5d5b7507986d459bbea86cb1bc09d40f57fe874f2c7a37a3ed6 |
| packages/shared/src/operations.ts | c036f33690ae402845a375237298e0a6220c99edc4101b2f83ca0fdb501b3f3e |
| packages/mcp/src/execution/operation-executor.ts | 10672c07fb1278d222278f626fe6c512b46848db9ff056061ee8b5c793af3a65 |
| packages/mcp/test/policy/operation-policy.test.ts | 8efcf669b9e2c9d79f4548fa9e0e0f681696b34d748140580e382f9be7fcbbe6 |
| packages/mcp/test/policy/result-egress-policy.test.ts | 62a190a21bd809bbc905317ffb72942840c261b3c4395859f56f78f83130a8d2 |
| packages/cli/src/admin-commands.ts | 66f114d3a7af0808c4bb7278abb3a07722f2be64a56e63149f0889049310e9ab |
| packages/cli/test/admin-commands.test.ts | 6510f314038932064378ccc7b677094186f4ddbfd0d26a218ac9ffd525cb81a6 |
| packages/mcp/src/portal/capture-runtime.ts | 02c59cf19028097f6ac700cf895092932631d80c1b666a445c72e80aa2191bab |
| packages/mcp/src/portal/capture-admission-runtime.ts | a6165035f5e0c94335b2b2c6514a17230fbf2f8b83d8ef08828d29ae7342d829 |
| packages/mcp/test/portal/capture-fixture.ts | bcb71001a63a6c0a5065ed973ae45a2895f6430fa864b809687039dfedfc2c56 |
| packages/mcp/test/portal/capture-admission.test.ts | cfc339edd247e909af8c157cb74c8d4bc4c8ae8f16e54eb2f9b8786090c34330 |
| packages/mcp/test/portal/desktop-capture.test.ts | 46d480c0e509ed3058f9a6edca29f35ae3f72a071a054e9a5e971e7263cd08f8 |
| packages/mcp/test/portal/capture-descriptor.test.ts | 2b4f4edad848e3ebf749331d3817325d55e9f888468b447046dd070b562e3dc9 |
| packages/mcp/test/portal/capture-plane.test.ts | e62990739d98a0d1d9076d917e6516a51e99de156278c71ca11c47796b0f9d16 |
| packages/mcp/test/portal/capture-native.test.ts | 082c5d57e70e9ec4bc537fb3d7241040f2ef13ae818abdf2ca7bbed21e2749eb |
