# Figma-to-portal implementation plan

Version: 2.1, 2026-09-08. Owner: main agent. This plan supersedes the earlier all-cases frontend restriction. All newly written or edited Markdown is English. Superpowers are not used.

The user's correction is authoritative: **only case 4 is frontend-only. Cases 2 and 3 must implement every relevant layer needed for a functioning portal, learning the existing or reference service code.** Case 1 is the new-service entry flow and inherits the scope of case 3 or 4 after reference resolution.

This document defines implementation work and acceptance gates. The native portal tool family is now connected to canonical admission, the executor and CLI. Case resolution, source/design evidence, native profiles, candidate submission, validation, application and reconciliation have implementation and targeted tests. This is not a claim that every acceptance-matrix entry or the supplied live Figma portal is complete. See the [native workflow](../../service/docs/portal-native.md). Earlier paint-style adoption evidence remains recorded in the [adoption audit](../reviews/2026-09-07-upstream-adoption-audit.md).

## 1. Known design and persistent instructions

- Reuse the Figma URL already supplied by the user: `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/eCommerce-Website-%7C-Web-Page-Design-%7C-UI-KIT-%7C-Interior-Landing-Page--Community-?node-id=0-1&p=f&t=fAmIbT2LnhPEYvg2-0`.
- Canonical design identity: file `4IBhv1d8hEclifZQrOYxHS`, initial node `0:1`. Do not ask for the URL again. Persist an explicit project design binding.
- Figma access must work without Dev Mode or the official Figma MCP, through the service Desktop plugin or external Playwright/Scripter.
- Attach to the existing Figma Chrome session. Do not launch Chrome, create profiles/tabs, or navigate the existing Figma tab elsewhere. Do not substitute the built-in GPT browser.
- The previous 11-root/3,198-node capture is historical evidence, not a guarantee of the current design or complete collection.
- Preserve the current staged work, the user's changes, and the original `code-kb/` checkouts. Reuse upstream code and useful behavior deliberately, preserving provenance and licenses.
- The user's broad authorization remains in force. Resolve ordinary implementation choices and concrete default output paths without repeatedly requesting approval. Ask only for genuinely missing information that changes the implementation or required environment.

## 2. Case resolution and scope

| Case                                | Inputs and resolution                                                                              | Required implementation scope                                                                                                                                                                                         | Completion                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1: new service from Figma          | New-service intent; reference optional. A specified reference selects C3; no reference selects C4. | Inherited from the selected strategy; C1 is not independently restricted to frontend.                                                                                                                                 | The selected strategy's complete result, with `requestedCase=C1` preserved.                                                                   |
| C2: existing legacy service         | Existing target service, potentially a monorepo with several frontend/backend packages.            | UI and all necessary backend/API/data/auth/configuration/job/integration changes required for the portal's intended workflows. Preserve existing behavior and data contracts where possible; extend them when needed. | An integrated portal that performs its required workflows in the selected environment, plus migration and regression evidence.                |
| C3: new service based on references | New target and one or more explicit reference services.                                            | Learn the relevant full service, including frontend, backend, schemas, auth, data flows, integrations, configuration and operational patterns. Build an independent working portal.                                   | Independent installation/startup, real frontend-to-backend/data/auth workflows, environment configuration, and required integration evidence. |
| C4: new service without references  | New target, no reference or explicit no-reference choice.                                          | Frontend only: routes, responsive UI, components, local state and honest demo adapters. No new backend/API server/database/authentication server is required or generated.                                            | A working frontend with visual/interaction/accessibility evidence and clearly stated demo limitations.                                        |

There are four user-facing cases and three shared strategies: `legacy-portal`, `reference-portal`, and `blank-frontend`. Explicit C3 without a reference requests that missing reference rather than silently switching to C4. Explicit C4 does not scan unrelated nearby repositories. A frontend-only reference does not reduce C3 to C4: if the intended portal requires backend functionality, design the missing compatible backend and record why it is needed.

Full portal scope does not mean copying every unrelated subsystem from a reference. Build a `RequiredWorkflowManifest` from the user's goal, Figma UX, and relevant legacy/reference behavior. Mark each capability as required, already present, to extend, to implement, or not applicable with evidence. Static portals can have no required backend; that is a justified architectural result, not an all-cases ban on backend work.

For new output, resolve explicit path, configured output root, then a safe generated project directory. If that location overlaps a reference, use a separate user output root such as `~/Projects/SuperFigmaPortals`. Bind the concrete canonical parent before writing, reject collisions, and do not overwrite existing directories. Lack of an existing repository is normal for C1/C4. A missing or ambiguous C2 target is a different input problem; keep independent design analysis moving.

## 3. What the three upstreams provide, and what they do not

Use the pinned originals as the initial audit baseline:

| Source         | Pinned revision                            | Audited surface                                                                          | Current conclusion                                                                                                                                         |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Figwright      | `a835e81b575eab2c9265a67f9353c89b848f81ca` | 112 tool names, two product skills, ten references, mapping/assets/reliability workflows | All tool names and the two skills are present. Some calling paths omit useful behavior; retained instructions need modernization and actual orchestration. |
| figma-mcp-rust | `6094566436577b29d04393c774d51492c12671e1` | 73 tool names, 12 prompts, 13 skills, plugin/bridge/export behavior                      | All 73 names map into the service, but behavior, prompts, skills and workflow coverage are incomplete.                                                     |
| figmosha2      | `547cefb4c90abaa1da68db5455b921cbf3f8a5b9` | 20 helpers, 12 CLI parser entries, bridge/plugin/diagnostic workflows                    | Primitive capabilities often exist, but documented aliases/composites overstate actual semantic equivalence.                                               |

These projects provide substantial Figma and design-to-code knowledge. Their Figma mutation tools do not themselves implement a portal backend, database or business process. Full C2/C3 service analysis and implementation orchestration are additions that must use their useful design capabilities as inputs.

Keep `foundationUpstreams` separate from `serviceReferences`. The three original toolkits are foundations of this pipeline; their presence does not automatically select C3 or make them a business-portal reference. C3 uses explicitly designated service code. Learned patterns mean evidence-backed code analysis and reuse in the generation context, not an unimplemented model-training claim.

Do not confuse four evidence levels: registered/present, behaviorally equivalent or deliberately adapted, actually used by a workflow, and executed with verifiable results. A name match or a test-file path is not complete utilization. An explicit unsupported feature is not completed by documenting its name.

## 4. Active upstream adoption, not a passive inventory

Create an executable, typed `WorkflowRecipeRegistry`. Each recipe records upstream feature IDs, trigger, case/scope applicability, supported primitive tools, declared effects, evidence inputs/outputs, failure handling and acceptance tests. The portal agent driver selects recipes when their conditions occur and records a `FeatureUseRecord`; it does not execute every design-mutating tool on every portal build.

| Adoption group                                 | Concrete use in the product                                                                                              | Required work and acceptance                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1: complete design grounding                  | All cases: source capture, section planning/resume, component API, variable modes, reactions, assets and fidelity.       | Apply Rust read/design strategies and Figwright grounding/catalog guidance. Persist included/excluded/unresolved scope. A required missing section or asset cannot disappear from the completion denominator.                                                                         |
| U2: full mapping fidelity                      | C2/C3 primarily; C4 after shared components/tokens are created. Reuse component/token/icon maps and persisted overrides. | Unify Chrome, Desktop and graph mapping behavior. Preserve explicit mappings, ambiguous candidates, paint-style pseudo-tokens, aliases/imports and source hashes. Do not let the Chrome path silently use a weaker mapping algorithm.                                                 |
| U3: variables and paint styles                 | All cases: palette extraction, legacy style-only designs, selected modes, aliases and export.                            | Paint-style JSON/CSS export is adopted now. Extend style/token audits and verify raw paints, modes, opacity and collisions. Use source token values and semantic bindings; do not replace Figma values merely because a target token has the same name.                               |
| U4: precise target and variable helpers        | All cases: current page/selection, URL/node ID, exact-name descendants, local variable versus library key.               | Implement Figmosha's useful resolution semantics with tagged requests, exact case-sensitive search, deterministic ambiguity handling and explicit import effects. Keep `node-id.ts` as normalization, not a claimed full resolver.                                                    |
| U5: typed dependent compositions               | Needed design authoring/refinement: frame construction, clone placement, import/instantiate/focus, bind and read back.   | Add closed recipes with typed prior-result references. Reuse canonical primitives and outcome tracking. Do not claim the existing static batch supports IDs from preceding results. Verify final node state, partial failure and retries.                                             |
| U6: text, styles and reusable systems          | Content synchronization and missing design-system structure.                                                             | Activate font-safe text/range edits, bulk rename, override-preserving swaps, annotation conversion, style audit, token/palette/type-scale/variant recipes. Preserve source design intent; generation of new design primitives is conditional, not a reason to alter every input file. |
| U7: prototype and motion to implementation     | All cases: required interactions; C2/C3 also connect them to real server/auth/data actions.                              | Adapt Rust prototype-flow mapping and Figwright motion/reactivity guidance into given/action/expected assertions and application contracts. Preserve unsupported/experimental properties explicitly.                                                                                  |
| U8: assets, export and comparison              | All cases: actual images/SVG, node PNG, ordered PDF handoff, selective design diffs.                                     | Complete assets before visual acceptance, use node exports rather than editor screenshots, verify PDF order/failures, and scope code updates from confirmed design differences. Add validated NOISE authoring support or an explicit render-preserving fallback when relevant.        |
| U9: connection recovery and reliable execution | All cases: initial readiness and recovery after a failure.                                                               | Expand useful doctor diagnostics, bounded progress/absolute deadlines, cancellation and reconnect behavior. Reuse the authenticated service execution plane, not an upstream unauthenticated bridge.                                                                                  |
| U10: actual skill/prompt routing               | All cases, selected by task.                                                                                             | Adapt all useful Rust skill recipes and prompt intents into English service-owned workflows; connect both retained Figwright skills and useful Figmosha workflows to the real driver. Each recipe needs a callable implementation or explicit prerequisite and a workflow test.       |

The Rust skill catalog to map is: annotation-conversion, bridge-troubleshooting, bulk-rename, design-strategy, design-token-generation, generate-color-palette, generate-component-variants, generate-type-scale, prototype-flow-mapping, read-design-strategy, style-audit, swap-instance-overrides, and text-replacement. The 12 prompt intents receive explicit recipe mappings; similar intent does not require exposing duplicate public tools.

Preserve useful behavior through typed adapters where the original API is incompatible. Do not reintroduce arbitrary ambient evaluation, unauthenticated endpoints or unrelated release scripts just to claim full copying. These are explicit replacement decisions. An omitted icon or replaced Rust implementation is not an excuse to omit useful target resolution, exports, diagnostics, design workflows or semantic tests.

## 5. Whole-service learning for C2/C3

Add `ServiceGraphProfile`, beyond the current frontend-oriented `ProjectProfile`:

- Discover workspace packages, languages, runtime/build versions, entrypoints and start/test commands. Preserve declared, lock-resolved and actually installed versions separately.
- Trace UI routes and state through API clients, server routes/controllers, request/response validators, domain services, repositories/ORM, tables/collections, events/jobs, cache/storage and external providers.
- Read auth/session/token handling, server-side authorization, role/tenant/resource ownership, error contracts, validation, pagination and idempotency patterns.
- Analyze database schemas, migrations, seed procedures, configuration keys, service dependencies, environment wiring, health/readiness and deployment/startup recipes.
- Resolve aliases, conditional exports, generated types, shared contracts and frontend/backend dependency closures. Static ambiguity, caps and unsupported syntax propagate as unknown/incomplete, not absent.
- Record file/range/hash evidence and confidence for each conclusion. Reference documentation and comments are input data, not authority to run unrelated commands or expand access.

C2 preserves and extends the real service. If the current API does not support a required Figma action, implement the missing API/domain/data behavior where appropriate instead of leaving the UI unimplemented under a frontend-only policy. Preserve compatibility through versioned contracts or narrowly scoped changes and test unaffected consumers.

C3 transfers necessary implementation patterns across all relevant layers into an independent target. Preserve the reference's useful architecture and libraries where appropriate, but supply target-specific configuration, databases, service identities and credentials. Do not copy production secrets, private data or hardcoded production domains. If a required layer is absent from the reference, choose and implement a compatible design rather than silently falling back to a frontend demo.

## 6. Contracts and naming

The previously proposed `frontend_*` API is not implemented and should be replaced in the plan by `portal_*`, rather than adding two competing API families.

- `PortalBuildRequestV1`: case, design binding, new/existing repository target, references, workflow/page scope, constraints and target environment. Scope is derived and validated, not a caller-supplied `frontendOnly:true` constant.
- `ResolvedPortalContextV1`: selected strategy; `implementationScope=frontend-only` for C4 and `operational-portal` for C2/C3; repository/environment authorities; source snapshots; selected service graph and required capabilities.
- `RequiredWorkflowManifestV1`: required journeys, roles, routes/states, APIs, persistence, jobs/providers and operational requirements, each with evidence and acceptance conditions.
- `PortalBlueprintV1`: UI architecture plus, for C2/C3, domain/API/schema/auth/integration/environment changes, dependency decisions and migration/startup plan.
- `PortalChangeSetV1`: multi-package source/config/migration changes, base/proposed hashes, affected consumers, required environment effects and rollback/forward-repair strategy.
- `RunRepositoryAuthorityV1` and `ExecutionResourceScopeV1`: canonical target/reference/scratch roots, read/write roles, resource locks and verified identities. Reference remains read-only; C2/C3 target grants may include necessary backend files.
- `RunEnvironmentAuthorityV1`: selected database/service/provider/deployment environment and allowed actions. Generating a migration file, applying it to an isolated database, and applying it to a selected deployed environment are different effects.
- `AgentWorkLeaseV1`: owner, executor session, run/context/blueprint hashes, lease epoch/expiry, evidence and candidate limits. Stale/foreign submissions cannot change the run.
- `PortalValidationReportV1`: source/design/schema/environment versions, test IDs, commands, logs/artifacts, actual runtime behavior, required/optional status, partial or blocked outcomes.
- `UpstreamFeatureCoverageV1` and `FeatureUseRecordV1`: complete feature inventory, semantic disposition, selected recipes, actual calls/results, tests and live-evidence scope. Include non-tool features.

Use nine canonical ToolSpec/server-adapter entries: `portal_plan`, `portal_start`, `portal_next`, `portal_submit`, `portal_apply`, `portal_validate`, `portal_status`, `portal_resume`, `portal_cancel`. CLI uses the same `invokeTool` path. The current source registry has 125 tools, with no additional Figma plugin handler; registration and successful end-to-end acceptance remain separate checks.

Existing snapshot/grounding service operations and private identity rules remain unchanged. New portal domains do not justify actor impersonation, direct handler execution or bypassing admission.

## 7. Real generation and application flow

Use the actual MCP client-driven pull/submit adapter defined in the earlier execution review: plan/start, lease a work item, return bounded evidence, submit real candidate files, validate, repair, apply and validate the applied result. CLI without an active coding agent reports `waiting-agent`; it does not pretend that guidance text or a scaffold is an implemented portal.

The agent must learn and implement the C2/C3 service graph, not only Figma markup. Generate in dependency order: contracts/schema and required backend services, shared types/adapters, reusable frontend components/routes, integrated journeys, then operational wiring. In C4 the backend portion is not applicable.

Reuse the existing journal, admission, evidence, egress, atomic-file and idempotency authorities. Extend the pre-approval resolver to recover verified multi-root/environment grants from run/plan IDs. Do not first resolve target permissions deep inside a runtime adapter.

The outer executor selects resource-specific lanes: short run-CAS metadata, repository source application, environment/database migration, process jobs, and independent status/cancel control. Long validation cannot block its own cancellation behind the same `target:none` queue. Agent waiting holds no write lock. Different repositories can progress independently; conflicting writes or schema changes use the same verified resource identity lock.

Default generation allows an initial candidate and at most three repair rounds, with persistent elapsed-time/file/byte budgets. Reconnect does not reset them. Larger full-service work is partitioned into explicit work items; an exhausted budget yields incomplete work, not success. If the adapter cannot measure model cost, do not claim a verified spending cap.

## 8. Runtime, data and integration execution

The user has explicitly prohibited Docker. Use the project's native toolchain in a separate, hash-bound working copy. Do not install Docker or introduce another container/VM as an automatic substitute. Resolve the actual executable, working directory, package scripts, environment, runtime versions, deadlines and owned process tree before execution. Dependency installation disables lifecycle scripts by default; any necessary script execution is an explicit native execution profile.

Canonical source writes remain restricted to the target grant and never write into references. Native validation runs under the local owner account: separate working directories, command/profile validation, environment filtering and process ownership are not a filesystem/network security sandbox. Do not claim container-equivalent isolation. Inspect the approved script/configuration closure and refuse unknown profiles or unexpected changes. Never pass real production credentials into a generated validation task. Required native runtimes, databases and provider test configurations are tracked as actual prerequisites; their absence is reported without preventing independent planning/generation work.

- C4 runs frontend install/build/interaction/visual checks only.
- C2/C3 validation provisions the real required service topology: application backend, a disposable native or explicitly configured test database with actual migrations and seeds, and required local jobs/cache/storage/provider test services.
- Implement real domain and persistence logic. A mocked HTTP response is useful for a unit test but is not sufficient integrated portal acceptance for C2/C3.
- Use existing or official provider sandbox/test environments when external services are required. A required missing credential/configuration remains an explicit blocked integration; do not replace it with fake success and declare the portal complete.
- Keep code generation, isolated schema migration, configured environment migration, provider calls and deployment as separate declared effects, with exact target/environment identity and evidence.
- Default tests do not write to production databases, charge money, or contact real recipients. Functional adapters are implemented and verified against the selected test environment; production readiness/deployment is a separate recorded claim tied to actual configuration and requested destination.
- Backend-only operations are forbidden in C4. For C2/C3 they are allowed when present in the required workflow/change manifest and the resolved target/environment grant. The earlier global ban on API routes, server actions, DB/auth/payment dependencies and backend config is removed.

Keep Figma Chrome capture independent of local validation. Use external Playwright with an explicitly installed headless Firefox preview profile; WebKit is optional after platform qualification. Record host OS separately from the actual runtime OS, browser, fonts and image digest. Do not launch Chrome or mutate the user's existing Figma tab for preview.

## 9. Source and data recovery

Capture C2's actual staged/unstaged/untracked filesystem state for the baseline. Preserve the Git index and unrelated changes; do not reset/stash/add automatically. Validation input closure includes shared backend/frontend contracts, configuration and lockfiles, not only changed UI files. Recheck hashes before applying.

Use a durable multi-file patch journal with before/after identities, write intent, applied observation, backups, recovery outcomes and publish commit point. New targets use same-volume no-replace publication; an existing empty directory is still a collision. Recover only files still matching this run's applied result. Preserve concurrent user edits and surface conflicts/unknown outcomes.

Filesystem rollback does not undo database changes, deployed state, queued jobs or provider effects. Track schema versions and environmental actions separately. Prefer compatible migrations, validated forward repair and tested backup/restore procedures appropriate to the selected environment. Never claim an external operation was rolled back merely because source files were restored. Reconcile uncertain effects before retrying; use business idempotency keys where the underlying operation supports them.

Cancellation first fences new claims/submissions/effects, then stops only owned jobs/processes and records remaining source/data effects. Same-owner authenticated resume can reconcile a portal run without weakening cancellation rules for unrelated operations. Persist artifacts for response-loss recovery; do not depend on a short memory cache.

## 10. Acceptance criteria

Support matrix keys include case, strategy, frontend/backend/data/auth/provider adapters, router/render mode, runtime versions, target kind, required workflow hash and design scope hash. Detection, generation, source application, build, runtime and integrated acceptance are separate capabilities. Unsupported stacks are not silently converted to C4.

| Acceptance group             | Required evidence                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 without reference         | No unnecessary existing-repository/stack/URL question; safe new output; C4 scope inherited; real frontend artifacts and checks.                                                                                                              |
| C1 with reference            | C1 identity preserved; C3 scope inherited; required full-service layers identified and implemented.                                                                                                                                          |
| C2 clean and dirty legacy    | Real frontend-to-API/domain/database flows, server-side authorization, migration/backward compatibility where required, unchanged unrelated code/index/data, baseline versus new failures.                                                   |
| C3 one or several references | Reference manifests unchanged; complete necessary dependency closure; independent clean install/start with target configuration; real persistence/auth/jobs/integrations as required; no reference path/secret/production-domain dependency. |
| C4 explicit no-reference     | No unrelated repository reads, no backend/API server/database/auth server generated; functional frontend and honest local demo states.                                                                                                       |
| Shared UX                    | Required routes directly load/reload; actions change the expected state/data; keyboard/focus/accessibility/overflow/error checks; responsive states match the scope.                                                                         |
| C2/C3 service behavior       | Real requests reach real target handlers; valid writes persist and are visible on reread/restart when persistence is required; invalid/unauthorized/cross-user requests fail; jobs and webhooks are verified where required.                 |
| Environment readiness        | Documented and tested startup, migrations, required configuration/secret names, health/readiness and integration mode. Provider test doubles, sandbox evidence, and production evidence are distinctly labeled.                              |
| Visual fidelity              | Same Figma node export PNG and source scope, runtime PNG/diff, stable viewport/DPR/fonts/assets/time/locale. Editor screenshots are not the design oracle.                                                                                   |
| Failure/recovery             | Missing reference/config, stale source, partial capture, expired lease, schema conflict, provider failure, child crash, partial apply, duplicate retry and response loss have explicit outcomes.                                             |

For C2/C3, build success plus mocked API tests cannot produce `portal-completed`. Every required journey and required service layer must pass integrated acceptance in the named environment. A required blocked or skipped test remains incomplete. For C4, frontend-only acceptance is sufficient when demo limitations are explicit. Production deployment is not inferred from local or sandbox success.

Discover the complete intended design scope rather than silently reducing the request to Home. Classify real screens, overlays, responsive variants, components/assets and notes, retaining unresolved items. The previously observed Home, Shop, Single Product, Cart, Checkout, Contact, Blog and Comparison names are candidates to revalidate, not a fresh capture.

## 11. Implementation order

| Stage                                        | Deliverable                                                                                                                                | Completion gate                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| P0: corrected scope and coverage authorities | Case-derived scope, required workflow/service graph contracts, upstream feature/use ledger, explicit useful-adoption backlog.              | C4-only frontend restriction; C2/C3 cannot be silently downgraded; metadata cannot stand in for behavior.                            |
| P1: useful OSS grounding adoption            | U1-U4 plus core U10 read/codegen/verification guidance, full mapping, token/style export and typed resolution.                             | Recipe results feed the blueprint. Correct stale Chrome/config instructions before use. Paint-style export is the first landed item. |
| P2: full-service analysis                    | Multi-language/package/service graph, API/domain/schema/auth/config/integration dependency extraction.                                     | Evidence-backed required changes for representative C2/C3 systems, with incompleteness propagated.                                   |
| P3: execution/environment authorities        | Repo/environment grants, egress, outer resource lanes, native working-copy runner, database/service lifecycle profiles and recovery.                  | Scope/process/cancel/schema failure injections and explicit native execution limits; no claim of a sandbox and no accidental production execution.            |
| P4: actual agent vertical slice              | Portal tools, leases, candidate/validation/repair/apply, and the case-aware English skill/prompt driver.                                   | A real supported coding client produces and applies real files with receipts; waiting-agent and stale responses are handled.         |
| P5: C4 frontend path                         | Reproducible standalone frontend preset, Figma implementation, local state and visual/UX checks.                                           | C1-no-reference and C4 pass without backend generation. This does not prove C2/C3.                                                   |
| P6: C2 integrated legacy path                | Required frontend/backend/API/data/auth changes and migration/compatibility handling in the existing service.                              | Clean/dirty monorepo fixtures and real integrated journeys pass without losing user changes.                                         |
| P7: C3 independent portal path               | Cross-layer reference transfer, missing-layer implementation, target configuration and service topology.                                   | External clean install/start and required real workflows pass with the reference unavailable.                                        |
| P8: reusable advanced OSS workflows          | Remaining advanced U5-U10 recipes and optional round trips; core read/codegen guidance is integrated in P1/P4.                             | Each claimed recipe has a trigger, implementation and workflow test; unneeded design writes are not performed.                       |
| P9: full acceptance and delivery             | Per-case/stack/environment matrix, artifacts, English docs/skills, source provenance, CLI/MCP packaging and supported runtime integration. | Source tests, generated-portal tests and live Figma evidence are separate, current and sufficient for their stated claims.           |

Pure analysis and candidate generation may proceed independently, but no repository script executes before P3's native execution profile checks and no target application occurs before recovery is implemented. Integrate the useful source workflows progressively; do not defer their entire use until after a generic generator has been built.

## 12. Proposed user and agent entry points

```text
sfp portal plan --case new [--reference <repo>] [--out <path>]
sfp portal plan --case legacy --target <repo> [--services <selection>]
sfp portal plan --case new-reference --reference <repo> [--reference <repo2>] [--out <path>]
sfp portal plan --case new-blank [--out <path>] [--stack <frontend-preset>]
sfp portal run --plan <id>
sfp portal status|resume|cancel <run-id>
sfp portal validate <run-id> --environment <resolved-profile>
```

Resolve the saved design binding when design is omitted. Repository target, Figma target and environment target are separate fields. Expose the selected scope and required layers first. Do not require a repository for C1/C4 and do not hide unresolved backend work in C2/C3 behind a demo label.

## 13. Review and implementation evidence

- [Cross-source adoption verdict and implementation status](../reviews/2026-09-07-upstream-adoption-audit.md)
- [Figwright audit](../reviews/2026-09-07-upstream-figwright-audit.md)
- [Rust audit](../reviews/2026-09-07-upstream-rust-audit.md) and [73-tool inventory](../reviews/2026-09-07-upstream-rust-inventory.json)
- [Figmosha audit](../reviews/2026-09-07-upstream-figmosha-audit.md)
- [Scope correction and main decision](../reviews/2026-09-07-portal-scope-decision.md)

The earlier three-agent execution review remains useful for authority, leases, queues, recovery and validation. Its all-cases frontend conclusion is superseded by the user's correction. Backend/domain/environment work must satisfy the expanded acceptance criteria above. The historical 3,325-test pass is a prior baseline, not evidence that this expanded portal engine is implemented.
