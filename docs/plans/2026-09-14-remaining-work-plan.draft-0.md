# Remaining portal work and adversarial review plan

Status: draft 0, awaiting two planning review rounds.

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

Planning reviews and main decisions precede implementation. W01 then W02 establish the real vertical slice. W03 and W06 establish shared analysis/recipe interfaces before W04/W05/W07 consuming workflows. W08 can proceed after the capture contract is settled. W09 validates all completed strategies and W10 closes the two code-review rounds and delivery. Independent implementation may be delegated only with explicit disjoint file ownership and main-agent integration; avoid overlapping worker edits.

## Completion ledger

| Gate | Status | Evidence |
| --- | --- | --- |
| Planning review round 1 | Pending | Three perspectives and main adjudication required |
| Planning review round 2 | Pending | Revised plan and main adjudication required |
| Final implementation plan | Pending | Must follow both planning rounds |
| W01-W10 implementation | Pending | Historical code and evidence are the baseline |
| Code review round 1 | Pending | Final implemented source and acceptance evidence |
| Code review round 2 | Pending | Corrected source and verified findings |
| Final verification and delivery | Pending | No unresolved required failures or hidden partial acceptance |
| Commit and push | Pending | User authorized only after the completed work and final verification; verify remote and branch first |
