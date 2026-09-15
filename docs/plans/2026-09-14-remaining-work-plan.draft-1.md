# Remaining portal work and adversarial review plan

Status: draft 1, round 1 adjudicated; awaiting planning review round 2.

Round 1 findings and main-agent decisions are preserved in [the adjudication record](../reviews/2026-09-14-plan-review-round-1.md). This revision adds binding contracts and negative acceptance gates; it is not permission to start implementation before round 2.

## Objective and authority

Finish the remaining work in the [active four-case plan](2026-09-07-portal-four-cases-plan.md), then subject the implemented code to two additional critical review rounds. The user requested three independently focused parallel reviewers (N = 3, selected to fit the available concurrency). The main agent verifies findings and makes the final decision; reviewer agreement is not a substitute for evidence.

C1 resolves to C3 when a service reference exists and C4 otherwise. C2 and C3 implement all relevant frontend, backend, API, persistence, authentication, authorization, and integration layers. Only C4 is frontend-only. Foundation upstreams are not business-service references.

Repository constraints remain binding: no Docker/Podman/VM/WSL substitute, English Markdown, preserve existing staged work and original `code-kb` checkouts. The latest user instruction authorizes Superpowers only after the plan is finalized and implementation starts; check the latest version before use. Planning reviews remain without Superpowers. This explicit implementation-stage authorization supersedes the repository's earlier blanket skill prohibition for that stage. Do not reset or stash unrelated work. The user additionally authorizes commit and push after all implementation, both code-review rounds and final verification are complete. Review the exact change inventory, exclude unrelated changes or credentials, use the configured repository/branch, and do not force-push. Validate native commands in a separate source-bound working copy. These copies share the Windows user's filesystem privileges, process namespace, and network; they are not security sandboxes.

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

Core grounding/mapping/style/read-strategy recipes must be consumed in final C4 and C2/C3 candidates. Test missing/tampered/stale/failed result references, unrelated successful recipes, wrong owner/source, cancelled dependent steps and retry after a partial effect. The required recipe/result/consumption set participates in context, blueprint and candidate identity so replacing evidence invalidates dependent acceptance.

Migrate machine-readable capability metadata and embedded mirrors to separate availability, semantic equivalence/adaptation, implementation status, prerequisites and actual run use. Pending helpers cannot remain implemented aliases. All thirteen Rust skill intents, twelve prompt intents, both Figwright skill families and useful Figmosha semantics receive stable mappings and behavioral tests. Conditional/experimental status is explicit and never counted as universal live use.

### Concrete acceptance matrix and final gates

Deliver two complete operational test artifacts: a dirty C2 legacy portal and a C3 independent portal with a frontend-only reference requiring missing backend layers. A browser creates/edits data through actual target HTTP, services restart, data reloads, and anonymous/cross-user access is rejected. Include migration compatibility, frontend error states and applied receipts. Intentionally broken candidates (authorization bypass, memory-only persistence, fake frontend success and reference-path imports) must fail their corresponding checks. A shared success exit code cannot substitute for a reviewed command that actually performs these assertions.

C4 requires the supplied live design, actual service-bound generation/apply/applied-validation, and core recipe consumption. Cover both advertised React/Vite and Vue/Vite presets in the local matrix; only claim live design acceptance for the particular executed artifact. Portable packages bind source scope and tree/assets hashes; offline visual completeness is distinct from fresh live verification.

The release validated in this Windows workspace is a Windows native release. Preserve non-Windows implementation paths and run portable unit checks, but do not advertise unexecuted non-Windows native journeys as verified. Actual external production databases/providers or unavailable Desktop hosts remain named external acceptance prerequisites; complete independent implementation and tests without fabricating those results. No unresolved supported-path correctness defect can be closed as an external prerequisite.

After the two code-review rounds, rerun all affected checks and the final source/package suite on the exact completed inventory. Review the accumulated task changes, preserve unrelated files and historical evidence, then commit and non-force push to `origin` on `feat/super-figma-pipeline-v0.1`. This branch currently has no upstream; set its tracking branch on the first authorized push after checking the remote for conflicts. Never push before the completion gates.

## Completion ledger

| Gate | Status | Evidence |
| --- | --- | --- |
| Planning review round 1 | Complete: revise | Architecture, fidelity and execution findings adjudicated in round 1 record |
| Planning review round 2 | Pending | Revised plan and main adjudication required |
| Final implementation plan | Pending | Must follow both planning rounds |
| W01-W10 implementation | Pending | Historical code and evidence are the baseline |
| Code review round 1 | Pending | Final implemented source and acceptance evidence |
| Code review round 2 | Pending | Corrected source and verified findings |
| Final verification and delivery | Pending | No unresolved required failures or hidden partial acceptance |
| Commit and push | Pending | User authorized only after the completed work and final verification; verify remote and branch first |
