# Remaining portal work and adversarial review plan

Status: final v1, September 15, 2026; both planning review rounds adjudicated by the main agent. Implementation authorized.

Round 1 findings are preserved in [its adjudication record](../reviews/2026-09-14-plan-review-round-1.md), and round 2 in [the final decision record](../reviews/2026-09-15-plan-review-round-2.md). Draft snapshots remain historical evidence. The final rules below supersede any conflicting preliminary wording in those drafts.

## Objective and authority

Finish the remaining work in the [active four-case plan](2026-09-07-portal-four-cases-plan.md), then subject the implemented code to two additional critical review rounds. The user requested three independently focused parallel reviewers (N = 3, selected to fit the available concurrency). The main agent verifies findings and makes the final decision; reviewer agreement is not a substitute for evidence.

C1 resolves to C3 when a service reference exists and C4 otherwise. C2 and C3 implement all relevant frontend, backend, API, persistence, authentication, authorization, and integration layers. Only C4 is frontend-only. Foundation upstreams are not business-service references.

Repository constraints remain binding: no Docker/Podman/VM/WSL substitute, English Markdown, preserve existing staged work and original `code-kb` checkouts. The latest supplied repository instructions prohibit further Superpowers skill use. Earlier implementation-stage use remains recorded as historical evidence; continue the approved plan and review protocol directly without invoking those skills. Do not reset or stash unrelated work. The user additionally authorizes commit and push after all implementation, both code-review rounds and final verification are complete. Review the exact change inventory, exclude unrelated changes or credentials, use the configured repository/branch, and do not force-push. Validate native commands in a separate source-bound working copy. These copies share the Windows user's filesystem privileges, process namespace, and network; they are not security sandboxes.

The last service daemon was explicitly stopped by the user. This new implementation request authorizes necessary development/validation runs; inspect ownership and actual state before starting a new owned daemon. Retain one approved Chrome connection during live tests. New Chrome windows/tabs are authorized, but do not create them unnecessarily or replace the user's logged-in profile. Use external Playwright/Scripter or the service Desktop plugin, not the built-in GPT browser or official Figma MCP. Do not ask for the already supplied Figma URL again.

## Baseline and evidence limits

The [September 10 report](../reviews/2026-09-10-live-c4-validation.md) records 3,453 passing tests, 17 platform skips, successful source/package verification, a 3,198-node/283-asset direct capture, and nine C4 visual comparisons below 3%. Its fingerprint is historical until compared with current source. The service's `portal_plan` capture failed twice while the direct collector worked. The service has never applied the final C4 candidate to its intended output directory.

Existing code already implements portal admission, leases, native execution, source/executable binding, candidate submission, visual evidence, application and reconciliation. Preserve and extend this implementation; do not rebuild it as an unverified alternate path. C2/C3 native API/SQLite/authorization fixtures exist, but do not prove full generated-portal acceptance. Upstream tool-name coverage does not prove actual workflow use.

## Review protocol

Planning round 1 reviews this draft and existing source concurrently from three perspectives:

1. Architecture and full-service learning: case boundaries, actual code-pattern transfer, service/dependency analysis, C2/C3 completeness, feasibility and missing interfaces.
2. Design fidelity and upstream utilization: source values/assets/interactions, mapping parity, useful Figwright/Rust/Figmosha behavior, evidence consumption and visual acceptance.
3. Execution, security and verification: native authorities, disclosure, process ownership, cancellation, recovery, resource budgets, test realism, delivery and unsupported-host claims.

Each finding must include severity, source path/line or reproducible evidence, concrete consequence, and a proposed acceptance test or plan correction. Reviewers must actively seek counterexamples, not summarize or approve by default. They may read code and run bounded read-only diagnostics, but must not change source, start Chrome/daemons, install dependencies, alter the index, or spawn additional agents during planning reviews.

The main agent records each finding as accepted, rejected with evidence, or unresolved, verifies accepted technical assertions in source or a reproducer, and revises the plan. Planning round 2 reviews the revised plan and dispositions, including new failure cases and weaknesses in the proposed fixes. After main-agent adjudication, freeze the implementation plan as final v1 with explicit unresolved external prerequisites.

After implementation and relevant tests, code review round 1 uses the final source inventory/diff and concrete acceptance artifacts. The main agent reproduces valid findings, fixes them, and reruns affected checks. Code review round 2 independently reviews the corrected implementation and regressions. Resolve valid findings before completion; if round 2 changes code, verify those changes and request focused confirmation without mislabeling it as an earlier clean review. Preserve all four round records and a final decision ledger.

## Implementation work packages

| ID | Work | Main source boundaries | Required evidence |
| --- | --- | --- | --- |
| W01 | Diagnose and fix service-only live capture failure | CLI browser/session/Scripter collector; portal design capture, coordinator and store | Same built service, permissions and transport as the real run; bounded non-secret exception/stage diagnostics; reproducer and regression; complete service-bound capture |
| W02 | Complete live C1/C4 generation and application | Existing portal CLI/tools; C4 candidate and native profile/harness | Fresh plan, lease and candidate hashes; actual assets; candidate acceptance; application; applied acceptance; preserved source/oracle hashes |
| W03 | Strengthen evidence-backed service learning | Portal service graph, workflow requirements, project conventions, shared/IR contracts | UI-to-API/data/auth/config evidence; imports and multi-package resolution; conflicts/ambiguity; explicit incomplete evidence; consumed patterns in a generated candidate |
| W04 | Complete integrated C2 acceptance | Legacy strategy, native profiles, operational fixtures | Dirty legacy project preserved; real frontend-to-API/data/auth journey; compatibility and migration checks; repair/apply/cancel/reconciliation evidence |
| W05 | Complete independent C3 acceptance | Reference strategy, dependency transfer, native fixtures | Reference read-only; missing relevant layers implemented; clean install/start with reference unavailable; real journey, persistence and authorization; target-specific configuration |
| W06 | Integrate useful upstream workflows | Typed recipe registry, feature-use records, existing canonical execution and service driver | Explicit feature-to-recipe mapping; selected recipe inputs/outputs actually consumed; failures stay failures; no name-only parity claims |
| W07 | Achieve capture/mapping and interaction parity | Chrome/Desktop/graph mapping, tokens/styles/icons/overrides; prototype/motion extraction | Same normalized evidence yields consistent mappings; overrides retained; raw styles/modes/aliases preserved; required interactions become executable checks |
| W08 | Complete recovery and portable capture package support | Capture diagnostics/checkpoints; artifact manifest input, normalization and asset reader | Actionable stage errors; no redundant Chrome attachment; cancellation/timeouts; offline tree-plus-assets integrity; rejected missing/tampered/traversal/changed bindings |
| W09 | Validate supported stack and runtime matrix | React/Vite and Vue/Vite acceptance; native lifecycle and packaging | C1 routing, C4 both stacks, representative C2/C3 end-to-end; Windows native evidence; explicit host availability and non-Windows runtime limitations |
| W10 | Final review, provenance, delivery, commit and push | English plans/reviews/usage docs, source manifests, package artifacts, final candidate and repository history | Two code-review rounds adjudicated; current-source full verification; reproducible installation and output location; honest feature/environment matrix; reviewed task-scoped commit and successful non-force push after completion |

### W01: capture diagnosis before changing behavior

Inspect the exact failure stage before assuming Chrome permission denial. Reproduce the existing capture class through the real daemon path, not only an exported collector function. Compare target identity, activity emulation, Scripter readiness, snapshot serialization, retained transport forwarding, owner-state permissions, checkpoint schema and publication. Keep diagnostics bounded and avoid logging credentials, raw private design content or CDP bearer endpoints. Preserve failed plans and diagnostic folders. Repair the demonstrated cause, then test failure categorization and recovery without bypassing capture completeness, freshness, or security checks.

### W02: supplied live design

Use file `4IBhv1d8hEclifZQrOYxHS`, node `0:1`. Reuse the September 10 candidate as a source draft, not as proof of a fresh plan. Reconcile current design differences and bind every required source root to its oracle. The historical scope is nine screens/states plus two decorative assets; discover actual current scope rather than hardcode that count as completeness. Keep the existing 3% maximum visual threshold and exact dimensions. Test real interaction, keyboard/focus, form/error state, route changes, persistence, responsive layouts and missing assets. Submit actual files in bounded batches, register the exact native closure, validate, apply, then validate the applied tree. The intended target is `C:/Users/c/Projects/SuperFigmaPortals/figma-ecommerce-c4-20260910`; confirm absence/identity before writing.

### W03-W05: full-service learning and operational cases

Inventory the current analyzer before selecting extensions. Improve supported JS/TS and Vue/Svelte package/import/router/API/schema/auth patterns with source locations, not unsupported claims of universal semantic inference. Other languages retain explicit evidence quality and incomplete results until a supported parser/adapter or exact reviewed source conclusion justifies them. Keep whole relevant layers conservatively when dependency precision is insufficient. Add qualified source/service selectors and deterministic ambiguity handling when references contain colliding roots or names.

Build representative independent fixture services that are not the three foundation repositories. Use native Node and SQLite where compatible, with actual frontend requests, durable writes across restart, unauthenticated/unauthorized rejection, scoped ownership and failure states. For C2 preserve unrelated dirty files and existing contracts. For C3 prove the generated target works without importing or reading the reference directory at runtime; implement required layers absent from a frontend-only reference. Do not claim these fixtures validate a user's unspecified production database/provider environment. Record exact supported stack/contracts and external prerequisites.

### W06-W07: useful behavior, not indiscriminate design mutation

Implement a typed recipe registry and immutable use records linked to source feature IDs, trigger, case, tools/effects, inputs, output evidence, and terminal outcome. Choose the integration point in the existing portal driver/admission architecture during planning review; avoid an unauthenticated side channel or nested actor impersonation. Only completed, validated outputs may satisfy a consuming plan or requirement.

Cover U1-U10 from the active plan. Prioritize complete grounding; consistent component/token/icon/override mapping; variables and local paint styles; typed page/selection/URL/node and exact-name target lookup; local/library variable resolution; dependent-result compositions; style/token/palette/type-scale/variant workflows; font-safe text/rename/annotation/override work; prototype/motion-to-assertion extraction; asset/export/diff handoff; and connection diagnostics. Map all thirteen Rust skill intents and twelve prompt intents explicitly, together with both Figwright skill families and Figmosha helper semantics. Deduplicate equivalent implementations without claiming incomplete convenience helpers are aliases.

Design-writing recipes are conditional capabilities: implement and test their declared effects through canonical authorization and final-state readback, but do not mutate the user's source Figma merely to demonstrate unrelated authoring features. Experimental motion/video and NOISE must be supported with valid evidence or exposed as explicit prerequisites/fidelity-preserving alternatives when relevant. A documentation label alone is not implementation or use.

### W08-W10: completion and reproducibility

An offline capture package must bind file/node scope, snapshot hash, asset manifest and asset bytes; standalone JSON remains insufficient. Validate bounded paths, symlinks/reparse points, duplicated identifiers, byte budgets and target identity. Distinguish offline visual completeness from fresh live-design verification.

Run the native suite and browser journeys in separate clean source copies. Record source fingerprints before and after verification, mirror staged deletions, and preserve historical review receipts. Refresh canonical contracts and provenance only for owned changes. Run final full source/package verification after code-review fixes, not only before them. Never claim non-Windows native runtime acceptance without running on that host; if unavailable, retain a precise external validation prerequisite and complete independent Windows/code work.

## Dependencies and execution order

Planning reviews and main decisions precede implementation. After finalization, W01 capture diagnosis and the W03 complete-inventory correction can progress independently. Correct native source/applied/environment binding before new operational profile execution. Establish core W06/W07 grounding, mapping, interaction and consumption contracts before final W02 live C4 acceptance; an earlier diagnostic C4 run is not final acceptance. W03/W06 then feed W04/W05 integrated operational artifacts. W08 portable-package work uses the settled capture contract. W09 covers the completed strategies, followed by both W10 code-review rounds, final verification, delivery, commit and push. A browser prerequisite must not stop independent source/recipe work. Delegated implementation requires disjoint file ownership and main-agent integration.

## Draft 1 binding decisions

### Complete source and applied-tree authority

Introduce a complete transferable byte inventory separate from semantic observations. Every allowed copied source/config/asset file records qualified source ID, path, bytes and hash, including unsupported extensions and binary data. Parse coverage is a separate per-file status; unsupported syntax cannot silently remove a runtime input from authority. Inventory limits are hard incomplete conditions, not permission to skip files. Exclude credentials, dependencies and declared generated/runtime directories consistently during inventory, staging and verification.

Native profiles require the complete selected baseline plus submitted replacements/creations. Before execution/application, recompute path membership and hashes so additions, deletions and edits invalidate stale authority. Applied validation snapshots and rechecks the complete expected relevant target tree before and after native execution, not just the apply journal's overlays. Runtime databases, caches, logs and build outputs must be explicit environment-owned paths outside source closure, never an arbitrary exclusion that can hide imported application code.

Required negative cases: imported `.mts/.cts`, runtime-read GraphQL and binary files; missing profile entry; newly added or deleted input; and a paused applied validation during which an untouched backend/configuration file changes. Keep original dirty legacy files and reference roots unchanged.

### Qualified graph and workflow coverage

Use stable source identity derived from workspace ID, repository role/root and verified root identity. Carry it through graph service IDs, qualified selectors, every evidence row, requirements, transfer decisions and receipts. Retain the old unqualified selector only where unique. The same relative filename in two same-workspace references must remain distinct.

Resolve ESM/CJS imports, literal dynamic imports, re-exports, relative extension/index candidates, workspace package names/exports and supported TS path aliases into source/file/package edges. Tag unresolved dynamic or external forms explicitly and retain the required conservative closure. Distinguish known API producer registrations from client calls; emit evidence-backed `depends-on`, API provider/consumer, persistence and configuration edges. Do not infer a full call graph from names alone. Selection excludes a demonstrably unrelated package, while unresolved relevance remains blocked or explicitly reviewed rather than silently dropped.

Add scope coverage entries linking every intended root/screen/action and relevant service capability to requirement IDs, source references and an implemented/reused/extended/not-applicable/unresolved decision. Confirmed requirement prose alone cannot suppress uncovered required evidence. Unknown non-commerce intent stays unresolved until a concrete blueprint resolves it. Include create/edit/document ownership and durable reload, plus a legitimately read-only reference portal that does not need a database.

### Native environment resources

Extend reviewed profiles with resolved test resource grants. Default Node/SQLite acceptance provisions a unique, owned per-run environment directory/database, with stable path identity, lifetime and cleanup ownership. A declared shared database/service requires an explicit stable resource key and an execution lane shared across runs; otherwise reject the shared configuration. Never infer disposability from an `environmentKind` string. Repository and environment identities remain distinct. Test same-database contention, independent database progress and cancellation that cannot remove another run's resources. Unspecified production environments remain outside the local completion claim.

### Versioned capture and Desktop integration

Define explicit capture capabilities for tree scope, variables/collections/modes/aliases, paint/text/effect/grid styles, component APIs and interactions. Each is complete/empty/partial/unsupported/failed with bounded cursors and evidence. Determine required capability coverage from selected workflows; a missing required catalog cannot become an empty successful collection. Keep raw values and a normalized observation, both hash-bound.

Add an admitted Desktop implementation of `PortalDesignCapturePort`, not merely a mapping test around the separate CLI reader. Source selection is explicit (`chrome`, `desktop`, `package`) or deterministic auto-selection of a uniquely bound available source. Extend pre-approval authority to bind the selected Desktop instance and document identity; ambiguous or wrong-file instances fail before capture. Reuse existing authenticated tool/relay execution with the parent operation's declared target/effects, cancellation and evidence, not an unauthenticated/direct-handler path. Desktop exports root PNGs and original assets, and uses the same-document freshness check for live validation. A missing Desktop host is reported separately from adapter/contract implementation.

W01 diagnostics must record stage, stable error category, expected/running build identity, actual owned entry path and relevant artifact hashes. Bind daemon identity to its complete transitive runtime/build closure, including imported CLI source. A CLI-only edit must invalidate stale daemon reuse. Make individual queue/connect waits abortable without cancelling the retained Chrome permission transport. Reconcile aggregate logical capture bytes, required-PNG oracle bytes, per-file reads and retained storage. The 64 MB capture batch limit is intentional; the historical >100 MB capture must remain valid if it fits the chosen total/subset bounds. Required-oracle acceptance may stream bounded reads rather than impose an incompatible hidden cumulative reader cap.

### Canonical mapping and required interactions

One canonical observation-to-mapping adapter feeds Chrome inspection, Desktop tool mapping and persisted graphs. Preserve resolved values for the selected mode, raw aliases, style pseudo-tokens, component APIs, explicit overrides, ambiguity and source hashes. Never set source values to null merely to share a mapper. Token override validation includes actual values; a same-name different-value token cannot silently alter Figma. Modernize the reachable service skills and references before enabling routing. Candidate reuse is conditional on verified semantics and provenance, not compulsory for a medium score.

Canonical interaction evidence records source/target node, trigger, action semantics, transition/state/motion properties and unsupported details. Required assertion IDs link these interactions to the blueprint and reviewed harness checks. Empty visual action arrays cannot satisfy required interaction coverage. Preserve deterministic still-image comparison and add separate real state/motion execution where required. Route/request, persistence-after-restart, keyboard/overlay, variable-state and timing assertions must observe the actual application. Unsupported required motion remains incomplete.

### Recipe execution, consumption and metadata

Keep the existing nine `portal_*` tool family. Extend its typed contracts rather than create a competing portal API. Add service-owned recipe definitions with stable feature IDs, version/hash, input/output schemas, trigger/scope, declared effects, ordered typed steps, evidence requirements and terminal statuses.

Read/derive recipes consume the admitted plan's captured observation and qualified source graph. Their immutable result records bind plan/context/design/source hashes and recipe version; blueprint/work items reference required results. `portal_next` exposes the selected typed work items and available result references. `portal_submit` adds bounded consumption references linking the exact result/version to candidate file hashes and/or required assertion IDs. The server validates source/result/plan ownership and invalidation. Candidate assertions verify material outputs where mechanically supported; distinguish declared consumption from verified consumption instead of treating arbitrary client claims as proof.

Conditional design-authoring compositions use a service-owned client executor that invokes each existing canonical primitive through `ControlClient.invoke`, with explicit target/effects, typed prior-result references, per-operation outcomes and final readback. No arbitrary JavaScript, direct handler calls, inherited actor impersonation, or static batch pretending to support dependent IDs. The consumer references owner-bound canonical operation/evidence IDs, which the server resolves through an injected authoritative evidence reader. Partial/unknown effects remain partial/unknown and cannot satisfy a successful use record. Design-changing results require a new source-bound plan before dependent acceptance. Do not perform unrelated design writes on the user's original file.

Core grounding/mapping/style/read-strategy recipes must be consumed in final C4 and C2/C3 candidates. Test missing/tampered/stale/failed result references, unrelated successful recipes, wrong owner/source, cancelled dependent steps and retry after a partial effect. The acyclic identity construction below binds selection, results and consumption at distinct lifecycle stages without rewriting prior identities.

Migrate machine-readable capability metadata and embedded mirrors to separate availability, semantic equivalence/adaptation, implementation status, prerequisites and actual run use. Pending helpers cannot remain implemented aliases. All thirteen Rust skill intents, twelve prompt intents, both Figwright skill families and useful Figmosha semantics receive stable mappings and behavioral tests. Conditional/experimental status is explicit and never counted as universal live use.

### Concrete acceptance matrix and final gates

Deliver two complete operational test artifacts: a dirty C2 legacy portal and a C3 independent portal with a frontend-only reference requiring missing backend layers. A browser creates/edits data through actual target HTTP, services restart, data reloads, and anonymous/cross-user access is rejected. Include migration compatibility, frontend error states and applied receipts. Intentionally broken candidates (authorization bypass, memory-only persistence, fake frontend success and reference-path imports) must fail their corresponding checks. A shared success exit code cannot substitute for a reviewed command that actually performs these assertions.

C4 requires the supplied live design, actual service-bound generation/apply/applied-validation, and core recipe consumption. Cover both advertised React/Vite and Vue/Vite presets in the local matrix; only claim live design acceptance for the particular executed artifact. Portable packages bind source scope and tree/assets hashes; offline visual completeness is distinct from fresh live verification.

The release validated in this Windows workspace is a Windows native release. Preserve non-Windows implementation paths and run portable unit checks, but do not advertise unexecuted non-Windows native journeys as verified. Actual external production databases/providers or unavailable Desktop hosts remain named external acceptance prerequisites; complete independent implementation and tests without fabricating those results. No unresolved supported-path correctness defect can be closed as an external prerequisite.

After the two code-review rounds, rerun all affected checks and the final source/package suite on the exact completed inventory. Review and commit the accumulated task changes on `feat/super-figma-pipeline-v0.1`, preserving unrelated files and historical evidence. The latest user instruction requires the latest completed code on the remote main branch: fetch current remote state, merge the task into `main` in a clean integration working copy, preserve concurrent history, resolve conflicts and verify the resulting merged source before a non-force push to `origin/main`. If necessary, publish the feature branch as an intermediate record, but that alone is not completion. Verify the remote main commit contains the completed work. Never push before the completion gates.

## Final v1 rules from round 2

These rules are normative refinements to the work packages above.

### Acyclic preparation and consumption

1. An immutable input context binds repository/environment/design authority, complete source and capture hashes, capability versions and selected recipe definitions. It contains neither recipe result hashes nor candidate consumption records.
2. The admitted `portal_plan` preparation phase runs required read/derive recipes on that input context. Each immutable result binds the input context, recipe definition/version, typed inputs, output hash and authoritative evidence. Persist resumable preparation/result checkpoints before publishing the resolved plan. Missing required results prevent issuance of a coding lease. Restart may reuse verified results with identical inputs; lease renewal does not repeat effects.
3. The resolved immutable blueprint binds the input context, confirmed scope/requirements and a deterministically sorted set of required result hashes. Publishing a replacement result requires a new blueprint/plan revision and fences old leases, profiles and acceptance; it never mutates an earlier context.
4. Candidate identity binds the blueprint, exact submitted file hashes and declared result-to-file/assertion consumption references. The references contain file hashes, not a circular reference to the final candidate hash.
5. Verified consumption and acceptance receipts bind the resulting candidate hash, blueprint, result hashes and actual assertion/review evidence. They do not feed back into context or result identity. Required mechanical outputs need verified runtime/source use; unused CSS/components, wrong-mode CSS and comments mentioning receipt IDs fail. Nonmechanical strategy conclusions need an exact source/result/candidate-bound review decision with rationale; absent such evidence they remain incomplete. Source-derived applicability and verified empty-catalog decisions cannot be overridden merely by omitting a requested recipe.

Conditional owner-client authoring is a separate effectful recipe lifecycle. Each step invokes an existing admitted primitive under the current owner's actual authority, with captured typed results when needed. Its receipt binds recipe version, input/output target identity and canonical operation outcomes. A fresh input context may adopt its verified final readback only when the current captured design matches; source-changing effects never rewrite the earlier portal plan. Successful status without a required result artifact is insufficient. Reference-counted, bounded retention protects required receipts/results/readbacks while dependent plans remain active; retention exhaustion blocks rather than silently discarding evidence. Before retrying a write after a crash, reconcile its original operation ID and actual readback. Unknown effects never automatically repeat or become success.

Test deterministic result ordering, interrupted result/blueprint publication, stale revisions, absent/redacted/malformed output artifacts, compaction of referenced results, and a crash between a successful design write and its recipe-step checkpoint.

### Inventory discovery and provisioning

Add an authority-specific traversal policy rather than reuse semantic `RepoReader.walk` exclusions. Repository ignore rules, dot prefixes, and directory names such as `build`, `dist` or `vendor` are not authority to omit required application inputs. Record explicit bounded exclusion/provisioning decisions in the inventory hash. A required input is byte-bound, reproducibly generated from bound inputs by a reviewed tool with verified output, or blocking. Credentials remain excluded and surface as explicit runtime configuration prerequisites. Unsupported symlinks/junctions are rejected or explicitly incomplete, never silently absent.

Test ignored imported generated clients, `.config/loader.js`, required nonsecret dotfile and `.well-known` data, checked-in `build/` code, changed `.gitignore`, required linked inputs, stale generated outputs and changed generator schemas. Keep same-account protection limits explicit.

### State versions and partial application

Version authority-bearing plan/run/profile/apply/capture/recipe records and read older signed schemas through explicit legacy readers. Preserve legacy status, evidence and cancellation; do not fill absent inventories, grants, coverage or use records with successful defaults. Old completed records stay historical, and old leases/profiles/validation cannot authorize current execution or completion. Unknown future versions fail with a stable version error.

Legacy partial applications remain inspectable through signed preimages/postimages and current root identities. Before any continuation under the new contract, reconcile the mixed tree, bind untouched current baseline inputs with fresh current-version authority and preserve concurrent edits. Where old evidence cannot establish safe continuation, retain the partial result and require a fresh reviewed recovery/replan instead of deleting history, blindly continuing or automatically rolling back user changes. Test old waiting/candidate/completed and intent/partially-written journals, concurrent untouched baseline edits, and restart during migration/reconciliation.

### External tools and native resources

Before approval, resolve canonical owner-bound environment grants, allowed actions, effective configuration and all required resource identities. Bind these grants into profile/admission/report hashes. Acquire multi-resource grants in deterministic canonical order; status/cancel remain independent. Persist owned resource leases, per-run directory identities and pending cleanup. Unconfirmed process termination or cleanup quarantines affected shared resources across daemon restart until verified reconciliation; a conflicting run cannot reuse them. Test aliases/case variants of the same database, post-approval configuration changes, opposite requested acquisition order, queued cancellation, restart and cleanup-unknown.

Add a reviewed external artifact manifest alongside project closure: interpreter and supported external script/package-manager entrypoints, acceptance harnesses, validator module/bundle and browser runtime identities. Bind daemon-injected artifacts and effective environment before execution/acceptance, not as unreviewed late values. Dependency provisioning records lock/config/tool identities, installation outcome and bounded installed-artifact verification; an interpreter hash is not a claim that arbitrary dependencies are transitively verified. Detect external harness/validator/browser/package-manager replacement and dependency changes between install and assertions. Unsupported external loaders/inputs require an explicit prerequisite, not silent trust.

### Capture coherence, per-node modes and visual identity

Guard tree/catalog pagination and required exports with a supported document-change epoch and/or bounded content re-observation, consistently across Chrome/Desktop. Compare content, not just root IDs or file URL. Detect same-file text/token/reaction/child changes, invalidate affected checkpoint evidence, and retry within budget or remain incomplete. Retain explicit atomicity limitations; optimistic re-observation must not be labeled an atomic snapshot. Test mid-tree, tree-to-export and resumed-capture changes through controlled adapters without gratuitous live design mutation.

Separate catalog token mapping from per-node/property binding resolution. Resolve actual collection modes, ancestor inheritance and cross-collection aliases using captured node evidence; do not substitute matching mode names or a single global mode. Unresolved dependencies stay explicit. Test siblings with different modes, nested overrides and aliases into independently selected collections, including actual rendered values and Chrome/Desktop/graph parity.

Visual receipts bind the source capture/scope/root ID, intended route/state, viewport and assertion ID as well as oracle and actual PNG hashes. Distinct source roots with identical bytes require their distinct executions; duplicate/substituted reports do not cover an omitted route/state. Sharing implementation is allowed after both required journeys execute.

### Full-service C3 transfer and publication

In addition to frontend-only-reference completion, add a bounded C3 full-service transfer fixture. Transfer a distinguishable backend validation/error/ownership convention and persistent schema into target files, using a second qualified reference with a colliding relative path. Verify target-specific configuration and HTTP behavior, independent clean startup, exclusion of unrelated packages and rejection of a candidate that drops the required convention or retains reference paths. This does not require another full live visual-design artifact.

No supported-path defect or unimplemented adapter can be declared an external prerequisite. Final commit, merge and push follow both post-implementation review rounds and the exact-source verification/delivery gates. Inspect remote branch state, merge into the current remote main history, verify any conflict resolutions and merged behavior, and confirm the remote main commit. Preserve concurrent remote history and never force-push. Do not switch the dirty main working directory to main while implementation is ongoing.

Remote preflight on September 15 found no advertised branch heads on `origin` (and no HEAD/main/master refs). Recheck at publication time. If still empty, publish the fully verified completed history as the initial `main` branch; there is no existing main history to merge. If a main branch appears meanwhile, fetch and merge it under the normal conflict/verification gates. The final criterion remains the completed code on remote main.

## Completion ledger

| Gate | Status | Evidence |
| --- | --- | --- |
| Planning review round 1 | Complete: revise | Architecture, fidelity and execution findings adjudicated in round 1 record |
| Planning review round 2 | Complete: corrections accepted | Three fresh perspectives; main source verification and final rules above |
| Final implementation plan | Final v1 | Both planning rounds completed; implementation authorized |
| W01-W10 implementation | In progress | Task 1 integrated; Task 2 live diagnosis and regression work underway; remaining packages pending |
| Code review round 1 | Pending | Final implemented source and acceptance evidence |
| Code review round 2 | Pending | Corrected source and verified findings |
| Final verification and delivery | Pending | No unresolved required failures or hidden partial acceptance |
| Commit, merge and main push | Pending | User requires completed latest code on remote main after review/verification; clean integration and non-force push |

Implementation checkpoint: Task 1 is complete and integrated after one correction/re-review round. [Implementation evidence](../reviews/2026-09-15-build-identity/task-1-report.md) and [task review](../reviews/2026-09-15-build-identity/task-1-review.md) are preserved outside scratch. Seven focused tests passed again after hash-checked integration. This does not complete W01's capture diagnosis or the later work packages.

## Execution task decomposition

### Task 1: Bind daemon build identity to all runtime and build inputs

This is the first bounded W01 correction (round-1 E6), not a claim to resolve the historical live capture exception. Edit and validate in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`, an isolated source snapshot of `C:/project/2026/super-figma-pipline`. The controller integrates reviewed changes into the main checkout. Read the current `service/scripts/build-server.mjs`, MCP/CLI build configurations, and CLI `server-session.ts` current-build check. The MCP capture implementation imports CLI collector source, but the build script hashes only shared/IR/MCP and the lockfile.

Implement a deterministic build identity helper used by the actual build script. Bind all relevant source packages, imported CLI collector inputs, build entry/config/helper inputs, manifests/lock and explicit behavior-affecting build configuration; omit generated outputs, dependencies and tests unless they are actual runtime inputs. Avoid self-referential output hashes. Use unambiguous path/content boundaries and deterministic ordering; fail explicitly on missing required input rather than silently omitting it. Conservative inclusion of extra source packages is acceptable; hashing an arbitrary unrelated directory is not. Preserve `SOURCE_DATE_EPOCH` behavior and the existing public `build-info.json` fields and hash format.

Allowed source edits: `service/scripts/build-server.mjs`, one focused new build-identity helper under `service/scripts`, a focused test under `service/test`, and an existing CLI server-session test only if needed to verify stale-build rejection. Do not edit portal capture/runtime/schema files in this task, change dependency versions, stage, commit or push. User authorized commits only at the final completion gate. No subagents, Docker/VM/WSL or Chrome/daemon interaction.

Use TDD: demonstrate that a CLI-only collector change leaves the old build identity unchanged, then prove the fixed actual helper changes identity. Also cover deterministic enumeration, source/config changes, generated/test-output stability where excluded, required-input failure and existing stale-daemon identity comparison. Validate natively in the separate copy `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`, retaining test command/output and red/green evidence. Reviewed files must be copied back without altering unrelated staged work, and their bytes must match the tested files. Full source verification remains the controller's final gate; do not rerun the entire suite for this bounded task.

Write the detailed report in the task-specific SDD workspace's `task-1-report.md`, including exact changed paths, reasoning, tests/output, source-copy comparison and remaining limitations. Return status, a concise test summary and concerns. Do not claim that this fixes the live Figma problem without actual service capture evidence.

### Task 2: Diagnose the service capture exception and make logical waits cancellable

This is W01's diagnostic and cancellation subtask. Edit and validate only in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`. The controller integrates reviewed files into the main checkout. Task 1's build helper is integrated and reviewed; do not modify its three files. Read the task-specific `capture-investigation.md` notebook before changing capture behavior. The historical generic exception has no established root cause yet.

Own the narrow CLI browser/session/Scripter and portal capture/coordinator diagnostic paths plus focused tests. Add bounded typed stage/error categorization for connection, readiness, state preparation, snapshot, checkpoint read, assets, schema/checkpoint publication and logical cleanup. Keep public diagnostics free of bearer/CDP endpoints, arbitrary exception text, raw design values and credentials. Stable stage/code/type and bounded schema-path/count evidence are appropriate. Preserve original causes internally for testing; do not hide a primary failure behind a cleanup error. Prefer a stable optional diagnostic/failure contract without pretending older records have new verified capabilities. Broader capture capabilities, mapping/coherence and state migrations belong to subsequent tasks.

Use the actual newly built daemon path to identify the first failing boundary, then trace and repair that demonstrated cause with a failing regression. Do not infer permission failure from `DESIGN_CAPTURE_FAILED` and do not declare Task 1 the cause without reproduction. A direct exported collector call is a comparison, not sufficient service acceptance. Bound diagnostics and retry work; do not layer speculative fixes. Keep code changes focused and separate independently established cancellation behavior from the historical-exception fix.

Logical cancellation must promptly abandon same-file queue waiting or a shared connection wait without cancelling the underlying approved transport, creating another browser session, or executing a snapshot/export/store publication for the cancelled request. Release a session obtained after cancellation. Add focused tests with unresolved predecessor/connection promises, cancellation, late resolution, normal reuse and cleanup error precedence. Existing deadlines, source/boundary checks, per-batch limits and completeness gates must not be weakened.

The user authorizes necessary owned service runs and external Playwright access. Before a live run, verify the actual current daemon/process/port state; historical PIDs are not authority. Main observed Chrome on loopback 9222 and no service listener 3055 on September 15, but recheck. Start only the current isolated build, use the known Figma URL `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1`, and retain one service-owned Chrome connection. Use the actual CLI/control invocation with user-authorized approval; do not impersonate an actor or bypass service admission/store signing. Do not run ad-hoc Chrome clients, the built-in browser, official Figma MCP, or unrelated design mutations. If Chrome needs a native permission click, report the actual prerequisite to the controller and continue independent diagnostic/test work; never click a security dialog through an unauthorized workaround. Do not publish/apply a portal in this diagnostic task.

Keep a record of owned daemon PID, exec session, entry path, expected/running build hashes and outstanding operations for the controller. Do not repeatedly restart a healthy retained connection. Stop only owned processes when required by a proven rebuild or cleanup; keep the user's Chrome/tab. No Docker, VM, WSL, dependency-version changes, staging, commits, push or subagents. User permits Superpowers now; use systematic debugging, TDD and fresh verification without repeating plan approval.

Run focused native tests in the separate copy, including the original failing class/flow and cancellation cases. Report exact source bytes, actual diagnostic outputs, before/after evidence, negative cases and remaining prerequisites in `task-2-report.md` in this plan's SDD workspace. Do not equate a diagnostic complete capture with final coherent/catalog/recipe-integrated C4 acceptance; that later gate remains required.

### Task 3: Complete byte inventory, state compatibility and native authority

Execute the prerequisite W03/W04/W09 authority corrections: authority-specific traversal, qualified inventory, old-state read/fencing, complete source/applied/mixed-tree validation, external tool manifests, resolved environment resources and cleanup quarantine. Split into bounded implementation briefs with disjoint ownership after capture/build interfaces settle. All required negative scenarios are specified in final v1; source discovery and semantic analysis remain separate.

### Task 3.1: Authority-specific discovery and complete byte inventory

This is the foundation for W03 and the reviewed native source-closure corrections, not the entire Task 3 authority migration. Edit/test only `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`. The controller integrates reviewed bytes. Task 1 and Task 2 are reviewed/integrated; their uncommitted changes remain in this snapshot. Do not modify their unrelated files or staged index. Do not touch the connected actual-state daemon, its primary `packages/mcp/dist`, or Chrome. If a test needs build output, build to a separate task-owned directory and record its limits.

Read `fs/repo-walk.ts`, `portal/service-graph.ts`, shared `portal.ts`, and their focused tests. The current generic walk silently skips dotfiles/dotdirectories, repository ignore matches, default ignored directory names and links; the graph then applies another semantic extension filter. Its `files` list is not a complete byte inventory.

Add a bounded authority traversal mode or focused equivalent using the existing retained directory/path protections. Preserve default semantic-walk behavior for other consumers. Authority discovery must not silently omit files because of `.gitignore`, dot prefixes or names such as `build`, `dist`, `vendor`, `test`. Known Git metadata, provisioned dependencies, credentials and service-owned runtime artifacts may be excluded only through explicit policy decisions recorded in the inventory. Do not recursively enter `node_modules` or `.git` merely to count their files. Required unsupported links, unsafe paths, collisions, unreadable files and exhausted limits are explicit incompleteness/errors, never complete silent omission. Use fixed service policy, not an arbitrary caller callback allowing unbound exclusions.

Define a versioned `PortalSourceInventory` schema and focused collection helper. Record normalized relative paths, byte counts, SHA-256 hashes, file classification where supported, explicit exclusions/provisioning reasons, limits and completeness. Preserve binary bytes; never force assets through UTF-8 decoding. Default bounds must align with native source readers: at most 5,000 files, 16 MiB per source file and 128 MiB aggregate; directory scan bounds remain finite. Hash deterministic inventory membership, content and exclusion decisions with unambiguous canonical framing. A change to an included ignored/dot/generated file or `.gitignore` must alter the inventory identity. Excluded credentials are not read or hashed as source content.

Integrate the inventory into `analyzeServiceGraph` as an explicit new field, separate from its semantic text-file/evidence list and parse-coverage status. Preserve legacy stored graphs as lacking the new inventory; do not fabricate one from their filtered `files`. New analyzed source identity must include complete inventory identity, and inventory failure must make the graph incomplete. Keep binary files out of text evidence; later tasks update required native closure and qualified evidence delivery. Do not claim this subtask alone closes legacy execution/applied-authority gaps. Do not broaden semantic API/module inference in this task; Task 4 owns it. Avoid circular imports between schema primitives, graph, source-path policy and the new inventory helper.

Allowed edits: generic repository-walk options/implementation and focused tests; a small portal source inventory/path-policy module; shared source-inventory types/schema and exports; minimal service-graph integration and its tests. Native profile/coordinator/application migration, external artifacts and resource grants are separate substeps. Any necessary interface ambiguity should be reported to the controller rather than silently bypassed.

TDD acceptance: byte-bind `.mts/.cts`, GraphQL, shell/text inputs and binary assets; include an ignored imported `src/generated/client.ts`, a nonsecret dotfile and `.config/loader.js`, `.well-known` data and checked-in `build/` code; unchanged semantic walks retain their old behavior; unsupported symlink/junction or unsafe required input is explicit; limits cannot become complete results; credentials/dependency/Git exclusions are explicit and do not read secret contents; ordering is deterministic and file addition/removal/change alters source identity. Tests must exercise real bounded filesystem discovery, not copied predicates or fake passing inventory objects.

Run focused native tests and relevant type/lint/format checks in the separate copy. No Docker/VM/WSL, dependency updates, browser/daemon interaction, subagents, main source edits, staging, commit or push. Write detailed evidence and exact source hashes to this plan's SDD workspace `task-3.1-report.md`, and return concise status/tests/concerns. All later Task 3 substeps and final review/verification remain required.

### Task 3.2: Versioned source and applied-tree authority

Consume the reviewed Task 3.1 `graph.sourceInventory` in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`. Edit/test only there; main integrates reviewed bytes. Preserve all earlier uncommitted work and the connected primary daemon/dist. No browser/daemon actions, primary-dist rebuild, subagents, dependency changes, staging, commit or push. Tests needing an entry build must use a separate task-owned output and isolated state/port, never the retained actual-state service.

Read Task 3.1's report/review in the controller SDD workspace and the existing plan/run/native/profile/control/coordinator schemas and application journal. The inventory is an optional field for legacy absence, with no successful default. Its hash includes policy, limits, scan counters and exclusion observations, so it is not a portable copied-file-only digest. Use original-source re-observation under the recorded policy/limits to validate the original source identity, and a separate explicit comparison of included path/byte/hash membership for staging/applied targets. Do not copy `.git`, credentials or `node_modules` merely to make discovery hashes equal.

Introduce an explicit current source-authority version (version 2) on newly created plans/runs and newly registered native profile/apply authority. Versioned readers preserve older signed record inspection/status/cancellation and recovery inspection; missing markers remain legacy, not automatically current. Old completed status remains historical and clearly distinguished from current verification. Unknown future versions fail with a stable explicit error. Legacy leases/profiles/acceptance cannot authorize current generation, native execution, application or completion. Continuing old partial effects requires fresh current-version authority and safe mixed-tree reconciliation; if old evidence cannot establish that, return a precise replan/recovery requirement while retaining every journal and user edit. Never synthesize complete inventory or future environment/recipe proof for old records. Later 3.3/3.4 and Task 6 extend their own required current authority contracts; whole Task 3 is not complete here.

Current legacy native source closure is the complete supported, complete inventory plus submitted creates/replacements. Current C3/C4 source closure is the exact submitted candidate. Require every material input's hash, reject missing/wrong/case-aliased source closure entries, and do not silently fall back to semantic `graph.files`. Separate external/provisioned tool inputs from project source closure; their fuller contracts are 3.3. Staging must copy exactly the intended included source bytes through existing retained readers/writers, verify each against its plan/candidate hash, and detect unexpected included file membership before execution. Original reference/source inputs must still be verified where the existing workflow requires them. Keep normal generated/provisioned outputs distinct; do not introduce an indiscriminate post-build whole-directory comparison that rejects every legitimate build before the later output-manifest contract exists.

Applied validation must verify the complete expected included target file set and contents before staging and after native commands, not merely the submitted overlay journal. Build the expected material target as baseline plus candidates. Detect untouched baseline changes, additions and removals while validation runs; a passing staged-copy test cannot certify a changed actual target. Preserve checked root identities and the existing no-overwrite/preimage safeguards.

Application and continuation must validate the whole relevant mixed target: untouched included baseline files plus each journal row's permitted preimage/postimage state. Do not skip baseline checks just because a journal exists. Preserve concurrent edits and exact partial outcomes. A failure after some source effects must retain accurate committed/conflict/unknown evidence. Do not add a source-delete API in this subtask; unexpected removal is detected and blocked. Native resource lifecycle/quarantine is a separate 3.4 task.

Update source inventory/evidence delivery to retain qualified origin: stable source ID derived from the verified workspace/role/root identity, source index, root path and file-relative path. Use byte-inventory membership for requested evidence. Text requests for unsupported binary data must fail explicitly rather than decode garbage. Never expose excluded credentials or claim that a content hash grants permission to read them. Keep bounded paging/redaction. Same-workspace references with the same relative filename remain distinct. Broader service selector/dependency resolution is Task 4; record the new source identity interface for that consumer. Do not add arbitrary large source-copy or recipe APIs here.

Required TDD cases: missing closure for `.mts`/GraphQL/binary input; changed or added/removed original included input after planning; valid staging despite absent excluded metadata; new versus old plan/run/profile markers; signed legacy waiting/candidate/partial/completed records remaining inspectable but fenced; unknown future version; pause validation then mutate an untouched actual backend/config file, add a file or remove a file; interruption after one journaled write followed by untouched baseline change; intent with actual preimage/postimage reconciliation; same-workspace duplicate reference evidence; binary text-evidence refusal. Preserve existing current-version happy paths and cancellation/recovery tests. Use real filesystem/CAS/native command fixtures where behavior requires them, without touching actual user service state.

Run focused tests and relevant type/lint/format checks, report exact hashes and meaningful red/green evidence to `task-3.2-report.md` in the controller SDD workspace. Explain any compatibility projection, material-membership comparison and remaining 3.3/3.4 dependencies. The controller performs an independent task review before integration; later broad code reviews and final verification remain mandatory.

### Task 3.3: External tool and provisioning manifests

Bind external scripts, package-manager entrypoints, validator/browser artifacts and effective environment/provisioned dependency outputs under the final v1 rules. Keep source input authority separate from verified generated/runtime inputs. A detailed ownership brief is prepared at dispatch.

### Task 3.4: Durable environment resource grants and cleanup

Implement pre-admission canonical resources, sorted multi-resource acquisition, independent cancellation, durable ownership, restart reconciliation and cleanup-unknown quarantine. Apply the final v1 same-account limits and real native tests. Task 3 is complete only after all four substeps integrate and their consuming gates pass.

### Task 4: Resolve service graphs and evidence-backed workflow coverage

Execute W03 with qualified source identity, supported module/API/data/configuration resolution, explicit unresolved coverage and non-commerce/read-only cases. Integrate consumers rather than stopping at graph metadata.

### Task 5: Normalize coherent capture, Desktop support, mapping and interactions

Execute W07 and the capture portions of W08, including catalogs, per-node modes, parity, coherence, admitted Desktop source selection, distinct visual observations and source-linked required interactions. Preserve all original scope and fidelity constraints.

### Task 6: Execute and verify upstream recipes

Execute W06 with the final acyclic lifecycle, owner-admitted conditional compositions, retained typed results, verified required consumption, modernized actual service skills and honest machine-readable metadata. Core recipes must feed the final generated artifacts.

### Task 7: Finish live C1/C4 and representative C2/C3 portals

Execute W02/W04/W05 and W09's frontend matrix after the prerequisite contracts and core recipe integration. Include the supplied live C4, both presets, dirty legacy portal, frontend-only-reference missing-layer portal, and full-service/multi-reference behavioral transfer case, with actual native/browser journeys and applied receipts.

### Task 8: Complete portable capture, release matrix and final reviews

Finish W08/W09/W10. Preserve current-source provenance and package/native evidence. Run the user-required two whole-code critical review rounds with three perspectives each; the main agent reproduces and resolves valid findings, verifies the exact final inventory, and only then commits and non-force pushes the task-scoped work. Missing supported-path implementation is not a completion claim.
