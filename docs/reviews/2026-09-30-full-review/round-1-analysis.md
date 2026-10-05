# Round 1: service analysis and design mappings

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Reviewer lane: analysis.

All 67 assigned files were read completely: 39 runtime source files and 28 tests. Their current SHA-256 values match the review manifest. Cross-lane reads were targeted and are listed in the coverage file. This is static evidence only: no test, build, helper, browser, daemon, package installation or source/Git mutation was performed. Only this report and its coverage file were written.

## Service assessment

The current implementation has stronger source identity, bounded parsing, conservative selection and explicit mapping review than the historical review described. Those improvements do not establish complete C2/C3 service learning. Two omissions can leave analysis apparently complete while omitting relevant inputs or client contracts, and several ordinary source shapes still block preparation. Static completeness is a statement about the supported analysis, not proof that an operational portal works. Only C4 is frontend-only; C2/C3 must include all relevant API, data, auth, configuration and integration behavior.

| ID | Severity | Current behavior | Historical relation |
| --- | --- | --- | --- |
| R1A-01 | High | A CSS import into excluded generated output leaves required bytes outside source identity | T26/SVC-8 regression boundary |
| R1A-02 | High | `globalThis.fetch` produces no client or diagnostic | Narrow current SA-6 omission |
| R1A-03 | High | Same-source component display names collide in reuse-review obligations | Current SA-8 |
| R1A-04 | High | BOM source hints fail workflow hash validation after graph acceptance | Residual SA-3 beyond T26 scope |
| R1A-05 | High | Built-in collection methods are treated as unproved HTTP calls | Narrow current SA-5 false positive |
| R1A-06 | High | SVG query imports recommended by profiling fail module resolution | Additional current SA-4 shape |
| R1A-07 | Medium | Unread component binding types and mixed rest props can become a complete prop list | Mapping API completeness defect |

Severity reflects either an unbound required input, an omitted service dependency, or an ordinary C2/C3 preparation blocker. These findings do not assert that the final runtime acceptance gate has been bypassed.

## Actionable findings

### R1A-01: required stylesheet input can remain outside the source authority

**Evidence.** `service/packages/mcp/src/portal/source-path-policy.ts:10` defines generated-output directories, and line 70 excludes them at any directory depth. `source-inventory.ts:96` hashes an exclusion's path, kind and reason, without its contents. `module-resolution.ts:34` recognizes JS/TS/Vue/Svelte source, and line 528 skips other input types. `service-graph.ts:235` checks excluded required inputs only through those module references. `tokens/load.ts:276` returns immediately when the selected CSS entry declares any tokens.

**Trigger and consequence.** A selected frontend imports `src/global.css`, whose content includes `@import '../build/tokens.css';` and one own custom property. The committed `build/tokens.css` is required by the stylesheet but excluded from the authority inventory. There is no stylesheet reference for the required-input check to inspect, and changing only the imported file's bytes leaves the inventory identity unchanged. Token loading can also return the entry's own variables without reading the imported token file. Consequently a graph/context can claim complete analysis without binding a stylesheet that changes the actual rendered service.

**Root cause and counterevidence.** The new directory policy assumes output bytes are dispensable before proving whether the selected source consumes them. T26 correctly blocks relative JS imports into `build/` and preserves unrelated generated-output exclusions. The inspected tests cover those cases, including a 6,000-file `dist/` and stable hashes after generated-byte changes. They do not cover this CSS import. `generated-tokens.ts` and token-loader notes can identify generated token output, but a note is neither a bound required-input reference nor an authority receipt. Legitimately regenerated output may be acceptable when reviewed provisioning evidence binds it; this finding concerns a required committed stylesheet with no such binding.

**Relation and fix boundary.** This is a current authority gap at the T26/SVC-8 exclusion boundary, not a request to reinclude all build output. Analyze supported stylesheet dependency forms and either bind required bytes through an explicit input/provisioning contract or issue a named blocking exclusion. Keep credentials unread and unreferenced generated directories excluded.

**Regression and service acceptance.** Add a frontend fixture with an imported CSS entry that has own variables and imports `build/tokens.css`. A change to the imported bytes must invalidate the appropriate authority or remain explicitly blocked; both entry and target must be named. Keep the unrelated large-output control complete. In a separate native working copy, verify that C2/C3 preparation cannot authorize stale styles and that the actual built page uses the bound imported values. Recheck the explicitly provisioned generated-output case separately.

### R1A-02: qualified global fetch silently disappears from the client graph

**Evidence.** `service/packages/mcp/src/portal/service-connections.ts:664` recognizes only an identifier callee named `fetch`. Lines 650–651 look up member receivers in the factory/import receiver map. The missing-receiver branch at line 696 checks Node HTTP imports, axios and rooted chains, then continues at line 720.

**Trigger and consequence.** `globalThis.fetch('/api/docs')` has no receiver entry and no import binding. It emits neither a client nor a diagnostic. With otherwise valid source input, connection analysis can remain complete with an empty client list. A frontend selected from a multi-service source then lacks the HTTP dependency evidence that an equivalent bare `fetch` supplies. This leaves the service client graph unproved even when its `complete` flag is true; it does not prove that a later real workflow can pass without an API.

**Root cause and counterevidence.** The analyzer distinguishes known imported factories but does not recognize this ordinary qualified global client. Tests cover bare fetch, shadowed fetch/factories, axios and unresolved provider contracts. The qualification has none of their diagnostics. No broader claim about every Nest/Next/tRPC shape is needed to establish this omission.

**Relation and fix boundary.** This is a narrow current SA-6 omission. Support explicit qualified global fetch with binding/mutation checks, or conservatively diagnose unsupported use. Preserve shadowed-client uncertainty and exact method/path matching; do not promote every member named `fetch` to a global client.

**Regression and service acceptance.** Pair bare and `globalThis.fetch` calls against the same exact provider and compare client/dependency evidence. Add shadowed/mutated `globalThis` and arbitrary-object controls. In a C2/C3 fixture with separately selected web/API packages, preparation must retain the relevant API service, and native acceptance must observe the browser request and returned data from that service. An unmatched provider must remain an unresolved contract.

### R1A-03: distinct components with one display name crash recipe preparation

**Evidence.** `service/packages/mcp/src/join/component-map.ts:383` groups component usages by component/set identity when available, so two distinct IDs may retain the name `Button`. Candidate confidence is capped at line 297. `portal/recipes/core-derivation.ts:968` chooses display names as component `mappingId`, while line 978 already creates a distinct `mappingRowId`. Lines 1017–1021 create reuse-review obligations using only mapping kind, display name and source. `Rows.obligation` at line 123 uses those fields as the row identity; `finalize` at line 141 rejects duplicate rows with `CORE_DUPLICATE_ROW`.

**Trigger and consequence.** Two distinct captured components named `Button` map against the same source and both require review. Their mapping rows and captured memberships differ, but their obligation IDs coincide. Preparation throws rather than yielding distinct reviewable mapping decisions. This is an ordinary collision across libraries or similarly named local components.

**Root cause and counterevidence.** Captured component identity and mapping row identity are already retained; the obligation projection discards them. Different source IDs do separate the obligation keys, so this report does not claim that every cross-source equal name causes the same throw. The duplicate-row guard is valuable and should stay strict.

**Relation and fix boundary.** This is current SA-8, with a concrete same-source path. Key obligations and decisions by mapping row plus captured/source identity. Keep the human display name as a label. Global renaming or silently deduplicating the obligations would hide independent decisions.

**Regression and service acceptance.** Capture two same-name components with different main/set IDs and instances, prepare/read all mapping recipe pages, and assert distinct obligations and correct memberships. Repeat with identical names across sources and with one component reused many times. In a C2/C3 plan, both reuse decisions must be reviewable without a preparation throw, and generated usages must retain the chosen component identity.

### R1A-04: T26 BOM acceptance stops before workflow source hints

**Evidence.** `service/packages/mcp/src/portal/coordinator.ts:801` reads raw bytes; line 802 hashes those bytes and line 804 compares the graph's raw hash. It places that hash beside BOM-stripped decoded text at line 810. `workflow-requirements.ts:326` instead compares `digest(hint.text)` with the raw hash and emits `SOURCE_HASH_MISMATCH`. The issue helper at line 143 sets `analysisComplete=false`; workflow coverage propagates incompleteness at lines 625–636. Coordinator line 1110 checks workflow coverage before starting a ready plan.

**Trigger and consequence.** A valid single-BOM source supplies persistence, API, authentication or integration evidence to the selected service closure. The graph and connection analysis accept the source after T26, but its coordinator-created workflow hint fails the decoded-text hash comparison. C2/C3 workflow planning becomes incomplete even though the raw source version matches.

**Root cause and counterevidence.** Producer and consumer use different byte/text contracts. `service-connections.ts:102` explicitly tolerates one stripped BOM while preserving raw identity, and the inspected graph/connection tests verify single-BOM acceptance and rejection of unrelated/double-BOM bytes. That scoped fix is correct; it does not fix the workflow consumer. Workflow tests use hashes of their provided text and do not exercise this coordinator boundary.

**Relation and fix boundary.** This is residual SA-3 in an additional consumer, not a regression of the repaired graph comparison. Use a shared verified raw-byte/text contract for hints; retain source/path/hash binding and reject mismatched versions. Do not make hashing generally tolerant of arbitrary altered bytes.

**Regression and service acceptance.** Produce the hint through the coordinator from a single-BOM file and compare it with the no-BOM control. Verify accepted workflow candidates and coverage, plus unrelated bytes, conflicting source versions, malformed UTF-8 and double-BOM controls. In C2/C3, a BOM auth/API/data source must permit the same plan refinement as its no-BOM counterpart and subsequently exercise the required authenticated/persisted journey in the native service.

### R1A-05: known non-HTTP collections generate per-call HTTP uncertainty

**Evidence.** `service/packages/mcp/src/portal/service-connections.ts:579` registers variables initialized by any call/new expression as receivers. Line 599 assigns `unknown` when factory inference fails. Lines 722–726 diagnose HTTP-named methods on those receivers; line 90 includes `get` and `delete`. `service-selection.ts:112` processes every diagnostic, and line 136 conservatively retains all services. Exact semantic reviews are possible through lines 118–125.

**Trigger and consequence.** `const cache = new Map(); cache.get('key'); cache.delete('key');` becomes an unproved HTTP receiver and emits `UNKNOWN_HTTP_RECEIVER` for collection operations. Normal application collections can make analysis incomplete and require individual source-ID/index/path/hash/offset reviews. Many calls amplify noise and bounded review pressure. The consequence is unnecessary selected-service incompleteness, not proof that every such repository exceeds a cap.

**Root cause and counterevidence.** Candidate receiver discovery is broader than evidence that a receiver may perform HTTP. The existing arbitrary-get control initializes `cache = {}`, which avoids the call/new branch and does not cover built-in collections. Unknown network factories and mutated/shadowed supported factories correctly remain uncertain. Exact owner review can resolve the diagnostic, so it is not an unreviewable hard blocker.

**Relation and fix boundary.** This is the concrete receiver portion of current SA-5. Distinguish statically recognized non-HTTP built-ins from unproved network-capable factories, with shadowing/mutation checks. Do not suppress supported HTTP uncertainty solely because its method resembles a collection method.

**Regression and service acceptance.** Cover unshadowed Map/Set get/delete, a factory returning a documented non-HTTP collection where support is explicit, an unknown network factory, and shadowed/mutated express/axios controls. Assert no fabricated clients/providers for collections and preserved uncertainty for unproved HTTP. A real C2/C3 web/API service with normal cache use must prepare without collection-specific reviews and still execute its HTTP/data journeys.

### R1A-06: profiling recommends SVG imports the resolver rejects

**Evidence.** `service/packages/mcp/src/profile/profile.ts:753` recommends `./icon.svg?react` for `vite-plugin-svgr`; line 758 recommends `?component` for `vite-svg-loader`. `module-resolution.ts:406` passes the whole relative specifier to `fileResolution`; lines 309–323 look for that literal inventory path. Query suffixes are not separated. `service-graph.ts:224` treats incomplete module analysis as hard incomplete; `service-selection.ts:26` has no module-resolution diagnostic in its reviewable set.

**Trigger and consequence.** An ordinary React/Vue Vite source uses the service's own recommended SVG loader syntax, with the real `icon.svg` present. The query-bearing path is absent from the inventory, so resolution emits an unresolved target and C2/C3 preparation is hard blocked. An icon mapping/profile can simultaneously recommend the rejected form.

**Root cause and counterevidence.** Bundler resource identity and transformation identity are conflated into a filesystem path. Profile tests explicitly pin these recommendations. The resolver handles ordinary asset paths, package declarations and supported aliases, but its tests do not pair those recommendations with module resolution. A loader dependency alone does not prove that every possible query transformation is configured.

**Relation and fix boundary.** This is an additional concrete SA-4 shape. Resolve the underlying bytes for supported, evidence-backed loader queries, retain query/transformation identity, and keep unsupported queries/configurations explicit. Do not strip arbitrary queries indiscriminately or execute configuration during static analysis.

**Regression and service acceptance.** Pair React `?react` and Vue `?component` import fixtures with supported loader evidence and the actual SVG target. Verify missing/excluded targets, unsupported suffixes and an ordinary asset control. A native C2/C3 fixture must prepare, build and render the recommended component form using the chosen asset; C4 icon guidance should use the same supported contract.

### R1A-07: unread public API can be downgraded to an apparently complete empty/subset API

**Evidence.** `service/packages/mcp/src/scan/scan.ts:283` returns unknown when a component binding's type argument cannot be read. Lines 333–334 then fall back to the function parameters, where line 211 treats no parameter as a complete empty API. Lines 213–225 omit rest elements and mark a nonempty untyped destructuring subset complete. `join/component-map.ts:194` turns every unobserved variant axis into an unmatched prop when `propsExtracted` is true.

**Trigger and consequence.** `import type { Props } from './types'; export const Button: React.FC<Props> = () => <button/>;` declares a public API through an unread imported binding type, but the scanner reports complete/no props because the body ignores its parameter. Similarly, `({size, ...rest})` can report a complete `size`-only API although the rest is unknown. Mappings then issue false missing-axis/extension guidance and change candidate confidence based on invented absence.

**Root cause and counterevidence.** The code conflates no binding contract with an unread binding contract, and treats a partially readable pattern as closed. Parameter annotation handling at lines 218–222 correctly preserves known names with `extracted:false`; that behavior should be retained. Scan tests cover local binding types, imported parameter types and rest-only patterns, but omit the imported binding/no-parameter and mixed-rest controls. Mapping candidates remain capped and core review is required, so this does not establish verified runtime reuse.

**Relation and fix boundary.** This is a current mapping API completeness defect; no exact older finding is asserted. Preserve declared-contract uncertainty before parameter fallback, and keep known names while marking genuinely open rest patterns incomplete. Do not discard the successfully read local API or suppress proven prop matches.

**Regression and service acceptance.** Cover imported FC/Solid binding types with no parameter and destructuring, fully readable local types, genuinely prop-less functions, mixed/rest-only patterns, and corresponding variant-axis joins. Review the analogous Svelte typed-destructuring path before claiming consistency across frameworks. In a native React/Vue/Svelte fixture, mapping guidance must not demand an API extension merely because a declaration is unread, and generated component usage must typecheck against the actual public API.

## T26 recheck and invariants to preserve

The historical SA-1 claim that the 32-row convention sample itself signals truncation no longer applies. The current code retains exact counts and deterministic samples, while unread/parse-limit failures remain explicit. SA-2's large lock/data materialization path has been changed to hash-only authority with exact dependency targets and aggregate evidence counts. Inspected characterization tests exercise those boundaries; they were not executed here. The service graph's single-BOM repair is correct within its tested boundary. R1A-04 identifies a separate workflow consumer.

T26's generated-output/unsafe-path and credential policy is substantially narrower and more explicit. Ordinary `credentials.ts`, `secret.ts` and `.env.example` are retained; protected credential files are excluded without reading their values. Required relative JS imports into exclusions are named and hard blocked. R1A-01 identifies the uncovered stylesheet boundary; package/alias generated-output diagnostics remain a separately documented T26 open item, not a new fully reviewed finding here.

Preserve raw-byte hashes, qualified source/service identity, strict source-review binding, conservative closure after semantic uncertainty, parse/file/result limits, complete-inventory prerequisites, candidate-versus-verified mapping distinctions, legacy override downgrades, exact color comparison, mode-aware alias uncertainty, non-Latin case folding, atomic snapshot storage and refresh CAS. A source graph or map is evidence for generation; it is not operational acceptance.

## Inspected tests and limitations

Every assigned test file was read, covering diff/baseline behavior, icon classification, component/token/icon joins, source graphs and inventories, module resolution, workflow inference, project/style profiling, React/Vue/Svelte/Angular scanning, SFC boundaries, snapshot service operations and token parsing/loading. Test descriptions, fixtures and assertions are inspection evidence only. Expected-error characterization cases are not successful product acceptance.

The mixed-`currentColor` SVG rule is a documented fidelity/design limitation, not a proved destructive-recolor defect. `repo-icons.ts:50` lets any currentColor win over hard colors or gradients, and `repo-icons.test.ts:11` deliberately pins that precedence. Icon guidance consequently lacks an explicit mixed/partial-recolor contract. CSS `color` leaves explicit fixed fills/strokes intact; this review found no code that flattens them. Round two should test guidance and actual mixed asset rendering before changing severity or the public contract.

No assigned file remains partially read. Exact cross-lane gaps for round two are:

- `portal/coordinator.ts`: targeted planning/source-hint/coverage paths and start-gate searches; the full lease, submit, apply, validation and reconciliation implementations were not read in this lane.
- `portal/recipes/core-source.ts`: selected preparation/mapping paths, not the whole capsule construction/currentness path. `core-derivation.ts`: initial row/finalize logic and source strategy/map derivation, not all intervening design recipe derivation or complete assembly.
- Integration tests not read in this lane: `service/packages/mcp/test/portal/core-source.characterization.test.ts`, `core-recipes.test.ts`, `core-lifecycle.test.ts`, `core-coordinator.test.ts`, `coordinator.test.ts`, `native-work.test.ts` and `native-work.characterization.test.ts` in that same directory. Cross-lane owners/root must validate their claims; round two should close the mapping-obligation and source-hint integration boundaries explicitly.
- Related unread runtime/contracts: `service/packages/mcp/src/portal/native-work.ts`, `service/packages/mcp/src/portal/recipes/core-lifecycle.ts`, `service/packages/ir/src/portal-run.ts`, `service/packages/shared/src/portal.ts`, `service/packages/shared/src/portal-core-lifecycle.ts` and `service/packages/shared/src/design-observation.ts`. Validation/execution implementations outside this lane were not audited here. These are coverage boundaries, not assertions of defects in those files.
- The September 7 scope plan was read through line 120; the historical remediation plan and T26 report were read selectively. They establish scope/history, not acceptance.
- No real repositories, live Figma observations, rendered pages, API calls, migrations, authentication, integrations or native installations were exercised. Supported-stack equivalence and the hypotheses below require execution in a separate working copy. Such a working copy shares user filesystem/process/network privileges and is not a sandbox.

## Recommended order and acceptance boundary

First repair required-input authority and silent client omissions (R1A-01/02). Then repair identity collisions and byte/text producer-consumer contracts (R1A-03/04). Address ordinary preparation false blockers with regression controls (R1A-05/06), then API completeness guidance (R1A-07). Round two should challenge each trigger and ensure that proposed support does not convert shadowing, unknown configuration or excluded credentials into falsely resolved evidence.

After focused unit and integration regressions, acceptance must run the canonical portal plan/start/evidence/submit/validate/apply workflow on a C2 existing service and a C3 independent target with relevant frontend/API/data/auth/configuration layers. Observe a real authenticated request, persistence and subsequent read, and test a required failure path. Mutating a required source/style/asset after planning must invalidate its evidence. Distinct same-name components must keep distinct review decisions through recipe pagination and generated usages. C4 remains frontend-only and should retain honest local/demo behavior. Native installs/builds and these acceptance checks were proposed, not run.

Additional round-two hypotheses, not actionable findings here: AST traversal pressure in convention sampling; token-index deduplication across SCSS provenance; JS theme spread/override value uncertainty; layer precedence for auth packages whose names contain a frontend framework; and exact token provenance through snapshot graph edges. Their observable impacts and counterevidence require dedicated revalidation before inclusion in a remediation plan.
