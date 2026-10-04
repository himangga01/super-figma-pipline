# Code remediation and service completion plan

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`, branch `remediation/2026-09-27`. Status: final correction plan after two review rounds and main-session adjudication. This document describes future implementation; today's review changes documentation only.

## Authority, evidence and scope

The [four-case portal plan](2026-09-07-portal-four-cases-plan.md) defines product scope. Only C4 is frontend-only. C2 preserves and extends a real existing portal across every relevant layer. C3 transfers the required reference architecture into an independent functioning portal. C1 resolves to the reference-based C3 or no-reference C4 branch. Required APIs, authorization, persistence, configuration and real service journeys cannot be replaced by a frontend demo or fake passing command.

The [September 30 report](../reviews/2026-09-30-full-review/final-report.md), [final main dispositions](../reviews/2026-09-30-full-review/round-2-main-disposition.md), [main source verification](../reviews/2026-09-30-full-review/main-verification-notes.md), and hash-bound [source manifest](../reviews/2026-09-30-full-review/source-manifest.json) supply the current evidence. All 42 accepted findings map to M01-M15 below. The September 27 [prioritized plan](2026-09-27-prioritized-fix-plan.md) and [findings record](2026-09-27-code-remediation-plan.md) remain historical evidence. This dated plan governs the sequence for reverified findings at this baseline; it does not erase unrelated outstanding tasks or their evidence.

The [remaining-work plan](2026-09-14-remaining-work-plan.md) retains its W01-W10 requirements and acceptance authority. M16 completes those case/capability requirements; M17 preserves its post-implementation two-round review and delivery gates. Today's source review and correction plan do not close unimplemented W tasks or authorize a release claim.

T01, T02, T03, T04, T08, T09 and T26 have integrated scoped changes. Preserve their repaired behavior, including explicit path encoding, canonical tool contract generation, controlled helper launch, honest CI gates, per-workspace availability, scheduled retention and graph evidence limits. A historical focused test result is not current full-service acceptance.

## Execution conditions

- Use a separate native working copy bound to the reviewed source hash, with a disposable state root, Korean path coverage and explicit test configuration. Never use Docker or reinstall Orca or its hooks.
- The working copy has the same Windows owner's filesystem privileges, process namespace and network access. Hashes, reviewed profiles, environment filtering and process ownership reduce accidental effects; they do not create an operating-system security sandbox.
- Honor existing per-task local-test confirmation requirements unless the owner has already authorized the relevant runs. No runtime test, build, installation, browser, daemon or helper was launched for this review. This document does not claim those gates have passed.
- Review command executable hashes, argv, working directories, services, environment, lifecycle scripts and owned cleanup before native execution. Installation uses ignored lifecycle scripts unless a reviewed profile explicitly enables the required scripts. Do not inherit production secrets or use production databases.
- One implementer owns each shared mutation file at a time, especially `fs/atomic-file.ts`, `portal/native-work.ts`, `portal/coordinator.ts`, `portal/native-lifecycle.ts`, the executor, journal, relay and `index.ts`. Parallelize only disjoint changes with explicit interface handoffs.
- Begin each behavioral correction with a meaningful reproduction of the actual trigger and expected invariant. A test asserting today's defect is characterization, not proof of the repair. Do not weaken consumption, source coverage, ownership or outcome gates to obtain green tests.
- Record focused acceptance, touched-package type/lint checks, provenance changes and limitations in an English evidence note. Wire-schema changes require protocol versioning and compatibility tests; internal derivation changes require invalidation of stale bound plans/profiles when their identity changes.

## Order and dependencies

First protect durable data and execution outcomes (M01–M04, M10–M11 and M12's rollback-conflict correction), then unblock the supported profile/consumption path (M05–M06). Analysis and remaining design-fidelity repairs can proceed in disjoint lanes, but complete before live acceptance. Failed-preview feedback M14 follows receipt contracts. M15 provides trustworthy verification and provenance throughout. Full case implementation M16 follows successful native C4 acceptance; release M17 follows the complete required matrix.

Dependency chains:

- M01 → M02/M04; M02/M03/M04 → safe native publication and recovery.
- M05 → M06 → real candidate validation, apply, applied validation and completion.
- M07/M08/M09 → trustworthy source and recipe preparation for M06/M16.
- M10/M11 → reconnect and effect reconciliation acceptance.
- M12/M13/M14 → design fidelity, complete scoped observations and actionable repair feedback.
- M15 runs as a supporting gate for every task; M16 → M17.

M15 has a bootstrap sequence: repair the authority updater's original-read CAS (F39), reconcile provenance classes/schema and current baseline hashes (F37/F38), then run the integrated baseline gates. During bootstrap, record focused per-task evidence and explicitly pending baseline gates; do not describe those tasks as fully verified. Once the baseline is valid, apply the normal per-task provenance and integrated gates to subsequent changes.

## Implementation tasks

### M01: safe retained replacement and metadata preservation

Findings: F03, F08, F21. Primary files: `service/packages/mcp/src/fs/atomic-file.ts`, `portal/store.ts`, `execution/native-evidence-artifact-port.ts` and their tests.

Retain only generations that are required by a recoverable operation, and reclaim proved obsolete generations using a durable cleanup intent bound to target, bytes and ownership. Account for per-target row/byte limits and shared directory scan limits. Preserve resumability across cleanup interruptions. Raising 64 to a larger value only delays the present failure.

When an in-place edit is discovered after moving the target, preserve or safely restore its visible path using an absence-only publication primitive. Never overwrite a newer target to restore an old one. Surface a specific conflict with an owned recovery location when restoration cannot be proved. Cleanup must not delete edited metadata based solely on unchanged inode identity. Preserve edited/unverifiable metadata and report its disposition. Rechecking hashes narrows a race; it is not an absolute guarantee against another process with the same owner privileges changing an open inode after the check.

Acceptance: more than 64 distinct replacements, a multi-file apply beyond 32 files, byte and directory-scan boundaries, interrupted reclamation/restart, same-inode edits immediately before commit, foreign replacement during restoration, metadata edits/replacements before cleanup, and symlink/hardlink defenses. Assert preserved user bytes and visible paths, not only an error code.

### M02: durable directory creation and root publication

Findings: F10, F12. Files: `portal/native-lifecycle.ts`, `portal/native-work.ts`, lifecycle/apply records and tests. Depends on M01.

Persist a creation intent before exposing a directory, with enough durable proof to distinguish an owned interrupted creation from a foreign preexisting directory. Bind the resulting directory identity before normal work/publication proceeds. Reconciliation must either complete a proved owned creation or report a recoverable quarantine without poisoning unrelated environment admission. Never adopt a directory merely because its pathname exists.

Acceptance: interrupt before and after mkdir, identity persistence and root publication; restart and reconcile each boundary; collide with a preexisting foreign path; change the directory identity while recovery waits. Include both absent-target C4/C3 and existing-target C2 publication. References and unrelated roots remain unchanged.

### M03: recoverable portal transitions and bounded recovery budgets

Findings: F11, F18, F19. Files: `portal/coordinator.ts`, `portal/native-resources.ts`, `portal/native-work.ts`, executor reservation integration and tests. Depends on M02 and coordinates with M06.

Reserve resume against the same run authority used by active validation/application. Add an explicit shared guard for run-state mutation; overlap among repository/process/environment resources alone does not cover the current resume keys. Use compare-and-set state/fence checks; resume-none cannot erase active cancellation, validation or a recovery obligation. Cancellation remains able to signal the owning operation promptly.

Define typed effect dispositions: proved pre-effect rejection, committed/partial application, and unproved dispatched outcome. A genuine preflight failure can return to a reviewable/retryable state without requiring a nonexistent apply journal. Missing `committed` alone is not proof of zero effects. Separate bounded generation, effect and owner-authorized recovery budgets so published work can still obtain applied validation after its generation deadline. Recovery does not grant unlimited execution or a new target authority.

Acceptance: production executor interleavings of validate/cancel/resume, stale lease epochs, preflight rejection with zero writes, interrupted partial apply, deadline crossing before/after effects, and owner-authorized applied validation after generation expiry. Verify exact durable states and preserved cancellation fences.

### M04: receipt-compatible lifecycle reclamation and hold release

Findings: F07, F09, F23, F40. Files: native lifecycle, operation journal, receipt/egress stores, core preparation capacity, recipe evidence holds and their production wiring. Depends on M01–M02.

Keep settlement metadata until its linked receipt/egress evidence can expire. Use a durable independent settlement link or align storage horizons while preserving the original operation-ID authorization/expiry rules. Keeping evidence linkage must not make expired operations dispatchable or expand replay authority. Retention must continue honoring active recipe dependencies and holds.

Reclaim released native attempt directories and attempt IDs with explicit ownership and dependency checks. Existing validation/apply receipts must remain verifiable: either keep required identity-bound evidence or move to a versioned durable receipt authority before deleting its directory. Add an explicit same-owner authorized hold-release/recovery operation after session rotation, preserving the immutable originating binding and unsettled/dependent-operation protections. Do not make held evidence silently consumable by a different session.

Core preparation has a separate lifetime charge of 32 distinct preparations per owner and 128 globally. Cancellation and dependency release do not reclaim it. Add explicit owner-authorized dependency-aware archival/reclamation with physical storage accounting and durable signed audit/receipt identities. Preserve the current orphan/adoption and cancellation-retention protections until reclaim eligibility is proved; simply freeing cancelled rows would weaken admission and history authority.

Acceptance: more than 128 completed reservations under realistic dependency directories, global entry/byte limits, receipt verification after safe reclamation, partial-apply receipts still pinned, settlement after long execution, tombstone/evidence sweeps around both horizons, reconnect/leader restart before hold release, unauthorized/dependent/unsettled release rejection, and cleanup interruption. Exercise more than 32 distinct owner plans and 128 global preparations after eligible reclamation while in-use/orphan records remain charged and signed historical evidence still verifies.

### M05: one public prepared-profile registration contract

Finding: F01. Files: `portal/control.ts`, `portal/native-work.ts`, shared profile schemas, CLI profile command and tests.

Specify a canonical public prepared value containing all required recipe-use and observation-manifest data. Return, register, validate and hash the same semantic value. The CLI must emit/persist and review the exact prepared body, including added execution commands; authority fragments plus the original command list are insufficient. Keep administrative nonce binding to the entire reviewed profile and authenticated owner. Version the contract or explicitly fence old persisted profiles. Fencing controls new effects: preserve old signed apply/validation receipts and the versioned proof needed to reconcile existing partial application. Do not regenerate historical receipts or grant new dispatch merely to migrate them. Reject altered, omitted or stale fields explicitly. Do not require an internal in-process object as the supported workaround.

Acceptance: the real prepare → args-file/CLI review → exact confirmation → register round trip, including observations and recipe use, survives serialization without mutation. Changed commands, environment, closure, manifest or plan hashes fail. Old profiles cannot dispatch under an unreviewed new contract, while valid old signed partial-apply proof remains available for bounded reconciliation. No command executes during registration.

### M06: verified consumption from native execution

Finding: F02. Files: native-work/report producer, native runner/worker evidence channels, core consumption verifier, IR acceptance and relevant shared schemas. Depends on M05 and M07–M09; apply acceptance also requires M01–M04.

Produce authenticated observations for every required compiled recipe obligation from the actual reviewed command execution. Bind them to run, candidate, source, plan, recipe preparation, environment, command and relevant output artifacts. Invoke the existing consumption verifier in production and place its verified receipt in the report. Candidate acceptance and applied acceptance use their own proper bindings. Model declarations, stdout JSON or a caller-supplied passing object are not receipt authority.

Acceptance: a complete C4 candidate can validate, apply, validate the applied target and complete through supported owner APIs. Missing, forged, stale, reordered or mismatched observations remain blocked. Partial application never counts as completion. Failures provide repair evidence. Once these blockers are repaired, rerun the previously masked native tests and remove corresponding ledger entries only when the intended assertions pass.

### M07: complete required input identity and loader resolution

Findings: F06, F14, F15. Files: workflow hints/requirements, source inventory/path policy, module resolution, service graph and token readers.

Keep raw-byte source identity separate from decoded text, including UTF-8 BOM. Do not reconstruct a source digest from normalized text. Trace supported stylesheet dependencies such as local `@import` and inputs in generated/excluded directories when they are required. Unsupported required syntax is explicit incomplete evidence. Reviewed regenerated output receipts remain separate from ordinary committed input; avoid restoring unconditional indexing of huge generated trees.

Resolve documented SVG queries with known loader semantics, while retaining raw asset bytes, query and configured loader evidence. Unknown queries do not become silently supported by stripping their suffix.

Acceptance: BOM and non-BOM capability sources; local CSS importing committed build/dist tokens; mutations of those required bytes change source identity; missing/ambiguous/unsupported inputs block correctly; generated-output receipt paths remain supported; Vite React/Vue SVG queries resolve under the right loader and fail clearly under the wrong one. Preserve T26 evidence-limit and whole-read behavior.

### M08: honest HTTP client discovery

Findings: F04, F05. Files: service connections, module/binding evidence, service selection and graph tests.

Recognize qualified global fetch with lexical binding evidence; shadowed globals remain unknown or locally classified. Track known Map/Set and other supported non-network receiver types without converting their methods into HTTP warnings. Constructor shadowing or mutation prevents a blanket collection exemption. Current selection supports exact owner reviews for unknown receivers; F04 is avoidable review friction, not an unreviewable hard stop. Keep unknown dynamic receivers incomplete and reviewable. Do not label a client omission as proof that the corresponding server endpoint is absent.

Acceptance: direct/globalThis fetch, local shadowing, aliases and supported imports, known Map/Set get/delete calls, real imported HTTP get/delete clients and unknown factories. Assert client rows, unresolved diagnostics, graph completeness and planning outcome separately across C2/C3.

### M09: stable recipe identity and incomplete component APIs

Findings: F13, F17. Files: core derivation, component scanner, component mapping, IR/shared identities and tests.

Use stable mapping-row/source identity for reuse-obligation uniqueness. Distinct same-source components with equal names must not collide; repeated identical evidence remains deterministic. Keep obligation identity separate from candidate equivalence: the existing grouping intentionally flags matching names across reference sources. Adding source identity to that grouping would suppress the ambiguity safeguard and is not an accepted repair. Preserve explicit cross-source ambiguity until an evidence-bound target/source decision resolves it. The proved React/Solid function-extraction paths must distinguish absent props from unresolved imported types and nonexhaustive rest props. Preserve an explicit incomplete API rather than a false complete empty/subset list; other framework forms retain their own supported contracts.

Acceptance: same-source duplicate display names, cross-source equal names, stable replay, deliberate duplicate row rejection, unresolved imported FC types, inferred zero-prop functions, typed/untyped rest destructuring and framework-specific supported forms. Required unresolved API obligations remain visible.

### M10: retryable authenticated readiness

Findings: F22, F29. Files: control router, execution-plane lifecycle, leader readiness and Chrome transport integration.

Evict a failed initialization promise after its owning attempt settles, preserving successful single-flight behavior and generation fences. Retry only via existing fail-closed initialization checks; do not mask integrity/authentication failure. Expose control readiness separately from public liveness where the product needs it. Replace a failed Chrome remote with a fresh authenticated generation; never resurrect old pending requests or credentials implicitly.

Acceptance: first initialization rejection followed by repaired retry, concurrent callers sharing one attempt, MCP initialization succeeding after control rejection, corruption remaining rejected, transient Chrome disconnect/reconnect without daemon restart, wrong-generation/auth failures, and outstanding effectful requests remaining unknown rather than replayed.

### M11: cancellation and uncertain effects across daemon, plugin and UI

Findings: F16, F25, F26. Files: relay, executor, plugin code/dispatcher/mutation handlers, relay client/state and session UI.

Carry dispatched effect uncertainty through both inner sandbox-bridge timeout and relay timeout into the durable operation state. The inner timer normally fires first; its cancellation/error reply also does not prove zero effects. Late results require an authorized reconciliation path, not blind retry. Add cooperative cancellation checks after asynchronous lookup/font/preflight steps and immediately before synchronous writes. Multi-step writes check between awaited effects and report partial changes accurately. A native synchronous mutation already in progress cannot be preempted by JavaScript cancellation.

Settle UI activity on cancel/disconnect as cancelled or outcome-unknown, and derive busy from actual active execution rather than an abandoned historical row. A cleared spinner does not assert that the document was unchanged or release backend execution authority. Preserve the existing queue invariant that active abort retains resource grants until the effect callback settles, and persist any outcome-unknown fence before subsequent conflicting admission.

Acceptance: deferred font/node lookup cancelled through the real bridge produces zero subsequent writes; cancellation after a committed effect remains uncertain/partial; transport timeout followed by a late mutation never becomes known no-output failure; disconnect/reconnect updates activity without duplicate dispatch; active abort keeps grants until callback settlement; pre-dispatch cancellation remains provably effect-free; undo failure and partial-change codes preserve their meaning.

### M12: lossless supported design data and verified inverses

Findings: F24, F30, F32, F33, F34, F41, F42. Files: shared paint simplification/canonical capture, plugin serializer, reaction conversion, typography handlers/inverses and tests.

Preserve non-solid paint opacity independently of stop alpha and node opacity. Include it in style identity so visually distinct paints do not merge. Preserve supported reaction key/overlay/conditional fields or reject an unsupported closed shape before any write; do not send arbitrary loose properties to the native API. Generic reads preserve top-level sizing, absolute-child constraints and text segments when only leading/tracking vary. Canonical capture must also retain per-run list options, indentation and wrapping, including plain locally styled text. Generic reads must detect one-item single-line lists. Preserve existing canonical leading/tracking and evidence-binding protections.

For batch inverses, either snapshot every supported mixed range and verify restoration or reject the unsupported operation during read-only preflight. Generic inverses must record actual owned postwrite values and stable node identity, restore only affected properties whose current value still matches that owned write, and preserve manual changes on conflict. Snapshotting all properties does not authorize restoring properties the operation never changed. Do not report `BATCH_ROLLED_BACK` merely because undo functions did not throw. Preserve conflict-aware annotation inverses and owned undo boundaries.

Acceptance: gradient/image/video/pattern opacity distinctions; reaction read → write → read for keyboard, overlays and supported conditional shapes; unsupported reactions cause zero writes; top-level HUG/FIXED and auto-layout ABSOLUTE constraints; tracking-only/leading-only mixed text; canonical numbered/bulleted/nested lists and per-run wrapping; generic single-item lists; same-ID reobservation changes identity when paragraph semantics change; batch failure after mixed typography restores exact ranges or reports honest partial outcome; manual edits during later awaited failures survive generic property/text/multi-node rollback and yield a conflict/partial result. Live Figma validation remains required beyond mocks.

### M13: explicit capture selection, bounded assets and interaction scope

Findings: F27, F28, F31. Files: dedicated portal CLI, capture admission, design evidence, interaction contract and observation preparation.

Expose explicit Desktop target selection in the supported dedicated CLI and keep grant binding intact. Return bounded previews/artifact references for valid captures above the analysis response cap while retaining original hashes and the working original-copy path. Avoid enlarging the model response without an aggregate budget.

Provide explicit evidence-bound selection/relevance decisions for incidental unsupported interactions, or implement their required semantics. Propagate the decision through core derivation, all required recipe results, preview contracts and consumption; changing only the preview contract leaves planning/leases blocked. Capture incompleteness and a required unsupported action still block acceptance. Any reviewed exclusion is bound to the plan/capture and visible in the obligations; it is not an automatic ignore switch. Retain full admitted source/root evidence rather than allowing caller subsets to erase obligations. URL, pointer and conditional behaviors need concrete assertion support before being advertised as supported.

Acceptance: dedicated Chrome/Desktop plan paths, exact target and ambiguity rejection, large images around both 5 MiB and 16 MiB boundaries plus aggregate limits, original-copy hash verification, supported and unsupported reactions in one capture, scope alteration invalidating old observations, and no hidden omission of required interactions.

### M14: failed preview evidence remains actionable

Finding: F20. Files: preview helper/worker/runner and authenticated evidence channel. Depends on M06 receipt design.

Persist and deliver failed visual results through the same owned channel with an explicit failed status. Preserve expected/actual hashes, differences, scoped roots and safe artifact references. The command/report may fail while its evidence remains usable for repair. Distinguish a completed failed comparison from interrupted or incomplete observation; an exception cannot manufacture a complete failed receipt for checks that never occurred. Do not treat helper stdout or an arbitrary report path as authenticated authority.

Acceptance: failed pixel/interaction comparison returns structured repair evidence; nonzero helper exit, timeout, malformed/tampered receipts and missing artifacts have distinct dispositions; repaired rerun yields a new bound receipt and only successful checks satisfy acceptance.

### M15: trustworthy verification, provenance and release evidence

Findings: F35, F36, F37, F38, F39. Files: CI, source-check runner/report checkers, provenance tooling, artifact smoke tests and package metadata.

Bind verification to the source hash, toolchain, intended test scope, actual collected/executed suites, run identity and owned logs. Declare the full or focused collection scope before collection, then require every expected file/case within that scope. Full source checks require their registered browser suites; a focused native-artifact/nightly run requires its own declared files/frameworks and must not be represented as the full matrix. Retain known-defect failures as failures; do not expand the ledger to absorb unrelated errors. Required suite absence and skip are different and must both be visible. Failed reruns cannot leave a previous success looking like the current result. Store historical success separately from current attempt status.

Complete the pending per-task provenance tooling/change slices and protected-source hash reconciliation using the existing upstream authority. At this baseline, read-only comparison found 263 mismatched authority rows covering 149 unique paths; this is not an executed offline-verifier result. Align the published lock schema with the canonical verifier's transition grammar. Bind provenance transaction expected-old bytes to the initial derivation read; a later staging snapshot must not legitimize overwriting a concurrent maintainer edit. Preserve durable transaction recovery and reject authority drift.

Do not hand-edit away legitimate drift, weaken upstream checks or rewrite preserved evidence to manufacture a pass. Regenerate final contracts, SBOM, notices, checksums and packages from the accepted source, then exercise the packed daemon/MCP surface with disposable state.

Acceptance: omitted required suite, skip, import/hook error, unexpected/stale/differently failing ledger test, test process timeout, failed rerun with old report present, source change during checks, protected provenance drift, contract divergence and artifact tampering all fail correctly. Both schema and verifier accept current legitimate review transitions and reject malformed ones. Inject an authority edit after derivation/before staging and assert it survives with a conflict; retain interrupted transaction recovery tests. Confirm the actual supported native CI/release matrix; informational jobs do not imply platform acceptance.

### M16: complete required case behavior and declared capabilities

Product work retained from the active case and remaining-work plans; these requirements are not invented defects from catalog presence. Depends on the repaired native C4 path and trustworthy analysis.

Complete C4 with actual assets, responsive roots and confirmed interactions. For C2/C3, use real route/client/server/domain/persistence/auth/configuration paths, native test databases/services and negative authorization/error scenarios. C2 preserves compatibility and data behavior; C3/C1-reference starts independently with target-specific configuration and no copied production secrets. Unsupported language/runtime or missing service prerequisites remain explicit needs-input until resolved.

Activate useful planned recipes/prompt routes only with callable implementations, prerequisites and consumption evidence. Preserve unsupported design/render semantics explicitly. Apply the adoption and remaining-work inventories rather than treating a registered public tool count as feature completeness.

Acceptance: C1 with/without reference, C2 legacy extension, C3 independent reference transfer, C4 no-reference frontend; new/existing targets, Chrome/Desktop, one/multiple reference roots, representative supported stacks, real service journeys and meaningful negative cases. Every accepted case has owner-reviewed source/design evidence, candidate and applied validation, cleanup and recovery evidence. References remain unchanged.

### M17: post-implementation review and release decision

After the required implementation and tests, conduct two independent critical review rounds against the final source and reverify their criticisms in the main session. Today's pre-implementation rounds do not replace that remaining-work gate. Close all accepted findings or record a concrete owner-approved deferral with a scope consequence; do not call the service complete with unresolved core blockers.

Run the complete source/artifact/provenance checks in the native separate copy under the established execution rules, then perform live Figma and actual target-service acceptance. Record source hash, versions, commands, result artifacts, actual skips/known defects and platform limits. Refresh service documentation to the accepted current behavior. Merge, publish or release only under the owner's applicable authorization and after a concrete reviewed result exists.

The owner's October 2 extension adds a final no-reference frontend test after the previously requested work and review/check gates: Figma file `4IBhv1d8hEclifZQrOYxHS`, page `0:1`, through both official Figma MCP and unofficial Figma Web acquisition using Chrome, Playwright and authorized remote control. Use separate empty outputs, preserve each path's own inputs, compare matching design facts, and validate both generated frontends through candidate/apply/applied completion. Repairs require renewed affected verification and reviews before final delivery. The [final acceptance record](../testing/2026-10-02-final-figma-preparation/README.md) contains the exact URL, current Chrome inventory, execution order, required evidence and unresolved blockers. Its preparation does not close M16 or M17.

## Completion evidence

### Native validation entry points

Use the separate reviewed working copy's `service` directory. The baseline pins Node `v24.17.0` and `pnpm@11.24.0`; verify their identities and any changed pins before execution. These are current script entry points, not commands run or passed by this review. Each native helper/service test still follows the execution conditions and reviewed profile above.

| Gate                                | Current entry point                                                                                                                           | Required interpretation                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked installation                 | `corepack pnpm install --frozen-lockfile --ignore-scripts`                                                                                    | Inspect native/lifecycle prerequisites before enabling any exceptional script. Preserve the committed lock.                                                           |
| Focused reproduction and acceptance | `corepack pnpm exec vitest run <reviewed test files>`                                                                                         | Declare exact collection scope and use a disposable state root; a focused pass is not full acceptance.                                                                |
| Static workspace checks             | `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm knip`, `corepack pnpm contracts:update --check` | Check touched contracts and generated consistency without absorbing new failures into the ledger.                                                                     |
| Integrated source evidence          | `corepack pnpm verify:source`                                                                                                                 | Run after M15 bootstrap and metadata stabilization; inspect source-bound logs, expected collection, ledger, skips and provenance results.                             |
| Release artifacts                   | `corepack pnpm verify:release`                                                                                                                | Exercise the build/package/checksum/artifact gate against the accepted source and record final artifact hashes. It does not replace live or complete case acceptance. |
| Native and live cases               | Reviewed native acceptance profiles, `SFP_NATIVE_VITE_ACCEPTANCE=1` scoped fixture, Desktop acceptance entry point and actual case journeys   | Preserve explicit process/effect ownership and connection authorization. A React/Vite fixture cannot prove complete C2/C3 service behavior.                           |

Regenerate required metadata before freezing the final verification snapshot. Select and record a reproducible SOURCE_DATE_EPOCH or Git epoch. If a required generator changes tracked bytes, bind the new snapshot and rerun the affected final gates; do not suppress source-change detection.

### Required final record

The final implementation record must map every F ID to its task, fix commit, failing reproduction, passing acceptance, source/provenance slice and remaining limitation. Successful helper tests alone do not prove the supported prepare/register/consume/apply flow. A generated candidate alone is not an applied portal. Full service readiness requires the case matrix and the repaired lifecycle to pass together.
