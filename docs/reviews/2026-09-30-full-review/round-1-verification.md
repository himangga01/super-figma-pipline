# Round 1: verification, release and service readiness

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Scope: the 124 files assigned to the verification lane in `source-manifest.json`.

This is a static review. No repository tests, builds, installations, vendoring commands, native helpers, browsers, daemons or CI jobs were executed. Read-only PowerShell inspections parsed metadata and computed hashes; those are integrity observations, not test passes. No source or Git state was changed. The earlier platform report IDs were renamed to `R1-PL01`–`R1-PL06` to avoid collision with the portal report.

## Current assessment

The service remains a development distribution. Current README and native guidance correctly distinguish registration, source tests, native fixture execution, live Figma evidence and real target-service acceptance. Only C4 is frontend-only; C2/C3 retain the relevant backend/API/data/auth/migration/job/integration layers and an unmocked frontend-to-service journey. Native work copies, executable hashes and owned-process cancellation run with the owner's account privileges; they do not create an OS filesystem or network sandbox.

The verification changes are substantial and useful: full Git history, pinned upstream checkouts, installed Firefox, independent CI gates, an explicit known-failure ledger, visible required-suite skips, checkJs for tooling, and hermetic packaging Git. They do not establish a green combined baseline. The checked-in provenance authority currently drifts on 149 unique paths, and the ledger still names 90 known-failure test entries, not 90 unique defects. No current remote CI result or full post-integration acceptance was established by this review.

| ID | Severity | Current path | Earlier relation | Consequence |
| --- | --- | --- | --- | --- |
| R1-V01 | P2 | `scripts/test-skip-census.mjs` | Residual VER-1 / T04 gap | Required suite absence can appear as zero required skips |
| R1-V02 | P2 | `scripts/run-source-checks.mjs` | T04 report publication | Failed rerun leaves a prior success report beside overwritten logs |
| R1-V03 | P1, release gate | `upstream-lock.json` | Acknowledged K5 / pending T05a | Current provenance verification cannot pass |
| R1-V04 | P3 | `schemas/upstream-lock-v2.schema.json` | Existing provenance contract divergence | Published schema rejects 59 legitimate current fork records |
| R1-V05 | P2 | `scripts/update-service-forks.mjs` | Authority transaction / T05a boundary | Concurrent maintainer authority edit can be overwritten |

Paths in this table are relative to `service/`. Severity denotes repair priority, not evidence of a released product or an exploited security boundary.

## Findings

### R1-V01 — required-suite presence is not checked

**Evidence:** `service/scripts/test-skip-census.mjs:64–88` examines only reported assertions and derives blocked suites from skipped assertions. `service/scripts/check-test-report.mjs:77–105,113–153` requires presence only for ledger entries. `service/scripts/run-source-checks.mjs:68–87` publishes the resulting census. CI invokes the checker and census at `.github/workflows/service-ci.yml:133–138`.

**Trigger:** a full-run report omits `packages/cli/test/browser-observation.test.ts`, `packages/mcp/test/portal/preview-consumption.test.ts` or `packages/mcp/test/portal/preview.test.ts`, for example after a discovery/configuration regression. Keep the reported ledgered failures and their recorded messages unchanged.

**Consequence:** neither gate detects those missing required suites. The census reports no required skips for them, and the ledger can accept the reported failures. This weakens the claim that required browser checks participated in the full run.

**Root cause:** absence is not a skip, and neither gate compares the report's file set with the required-suite registry or a declared run scope.

**Counterevidence:** the current CI test command has a fixed full-run glob and uses pipe failure propagation; this is not proof that current CI deliberately omits files. Missing prerequisites now fail with an actionable Firefox message. Reported skips are blocked unless explicitly allowed. The ledger rejects missing, renamed, skipped, newly passing or differently failing ledgered tests, suite import failures and logged unhandled errors. `preview-native.test.ts` has a ledger entry, so omitting that file wholesale is already rejected. No report tampering is required for the bounded discovery gap.

**Older relation:** residual coverage gap after T04/VER-1. Do not revive the repaired allegation that Firefox is never installed or that its missing executable is silently skipped.

**Bounded fix:** give the census an explicit expected scope. Full source/CI runs must require every registered required file to appear and have assertions; focused nightly or developer runs must declare their smaller expected file set. Keep visible allowed skips separate from missing execution, and preserve the strict ledger behavior.

**Meaningful acceptance:** remove each of the three unledgered required files from an otherwise acceptable full report and require failure naming the absent file. Check an empty assertion list and duplicate file records. Retain controls for a complete report, an explicitly allowed visible Firefox skip, the ledgered preview-native omission, and the explicitly scoped nightly native-artifacts report.

### R1-V02 — failed reruns retain a prior success report and can replace its evidence logs

**Evidence:** `service/scripts/run-source-checks.mjs:33–40` reuses `artifacts/source-checks/` and removes only the old Vitest JSON. `:88–120` rewrites per-check logs and throws on a blocking failure. `:131–154` replaces `artifacts/source-checks-report.json` only after every check and the final source-hash comparison succeed.

**Trigger:** run verification after a previous successful invocation, then encounter a type/lint/build/provenance/prerequisite failure or final source change.

**Consequence:** the previous success-shaped final report remains at the customary current-report path. Earlier logs in the second invocation may already have replaced files whose hashes the old report records, creating a hybrid evidence directory. A person or external evidence collector reading the current path can misattribute old success to the failed attempt.

**Root cause:** no run-specific evidence directory, pending/failed current record or invalidation of the previous current pointer exists.

**Counterevidence:** the failed invocation still exits unsuccessfully and does not publish a new success. The old report has a timestamp, source hash, log hashes, known-defect status and explicit false live/target/remote-CI flags. A careful reader can identify stale or mismatched evidence. No production consumer that trusts this file was found; the search found its publisher and documentation. Artifact verification independently hashes archive contents. This is an evidence lifecycle defect, not a proved bypass of artifact verification or portal acceptance.

**Older relation:** report-lifecycle gap around T04's truthful verification output. The schema-v3 known-defect label is sound and should remain.

**Bounded fix:** retain each attempt in its own directory, publish an attempt ID with its exact report/log hashes, and update a current status/pointer to pending then failed/succeeded. Preserve older reports as historical records; never overwrite their linked evidence. A smaller fix may invalidate the current success pointer before any log rewrite and publish a failed attempt record.

**Meaningful acceptance:** seed a valid prior report/log set, fail a subsequent early check and then fail a late check. The current attempt must read failed, previous success must remain independently inspectable, and no report may resolve to another attempt's logs. A source-change failure must have the same behavior.

### R1-V03 — integrated source remains outside its provenance authority

**Evidence:** `service/scripts/verify-upstream-lock.mjs:259–283` requires exact protected-file hashes; `:623–672` requires registered managed closure. The current `service/upstream-lock.json:30–2028,2029–4482` contains 499 managed-owned and 613 service-file rows. Read-only SHA-256 comparison of all 1,112 rows against baseline working bytes found 263 mismatched rows across 149 unique paths. The vendor-map digest itself still matches the lock. Current `service/SBOM.spdx.json:6` names lock digest `505dbecccc138e31765d8a54f7fd7b01a99f8a61c749a8b953ab1cb5bccd9b8a`; the actual pnpm lock digest is `4e498a2e3bc24dfb765cab09c54066f33971dbf1c8b4da794caf9c342b8ed40f`.

**Trigger:** run either current provenance gate against the integrated source. Both modes invoke exact service-file verification before later upstream checks (`verify-upstream-lock.mjs:847–867`). Source verification invokes the offline gate at `run-source-checks.mjs:54`; CI independently invokes both modes at `service-ci.yml:94–99`.

**Consequence:** current provenance acceptance cannot be green. The committed SBOM is not bound to the current lock digest. No successful packaging or current source report can be inferred from targeted remediation test results.

**Root cause:** integrated protected/managed changes and new tooling have not received the pending class-aware authority refresh and release-metadata regeneration.

**Counterevidence:** this is explicitly acknowledged K5/T05a work, not a regression allegation against T01/T02/T03/T04/T08/T09/T26. T02 records 60 K5 ledger failures; current ledger entries preserve those names/messages. The release pipeline regenerates SBOM/notices before packaging, so stale committed SBOM bytes are not proof that a freshly completed release would retain them. All three copied upstream license hashes match their pinned lock authorities. The tool catalog has 128 unique canonical tools, 114 lexical rows, 20 Figmosha helpers and 12 parsers; the Rust/Figmosha companion surfaces exactly match their corresponding union surfaces.

**Older relation:** current continuation of K5 / pending T05a, with exact integrated counts rather than the older 93-path census. Earlier scoped PASS claims do not claim provenance completion.

**Bounded fix:** repair the updater's lost-update boundary first (R1-V05), then audit changed/new paths by their actual provenance class and refresh the protected hashes, package projections, managed closure and change-manifest evidence together. Regenerate SBOM/notices from the pinned installed production set and review changes. Do not weaken exact hashes, remove mutation tests, invent upstream lineage or broadly allow unmanaged destinations to obtain a green gate.

**Meaningful acceptance:** both offline and pinned-upstream gates must pass for the final integrated tree, then reject a one-byte protected-file mutation, an unmanaged source addition, a dependency-projection mutation and an origin/commit mutation. Recheck all 60 K5 tests and remove ledger entries only after the genuine mutation cases pass. Bind regenerated SBOM namespace to the actual lock digest and verify packaged licenses/notices and isolated runtime entries in the authorized native validation copy.

### R1-V04 — published lock schema and executable validator disagree on valid transition tasks

**Evidence:** `service/schemas/upstream-lock-v2.schema.json:60–79` permits only the enumerated original task IDs. Current lock data contains 59 service-fork records with `review-YYYY-MM-DD` tasks (first example `service/upstream-lock.json:4919`). The updater accepts that form at `update-service-forks.mjs:516–535`; the verifier accepts it at `verify-upstream-lock.mjs:458–462`. The function named `verifyLockV2Schema` checks selected schema authority fields but does not apply the schema's service-fork definition (`:52–86`).

**Trigger:** a standards-compliant consumer validates the current lock against its published v2 JSON Schema.

**Consequence:** 59 legitimate current records are invalid under the declared contract, while the executable verifier accepts their task format. Editors or future validators cannot rely on the checked-in schema as the authority.

**Root cause:** review-slice support was added to executable regular expressions but not to the schema.

**Counterevidence:** the current custom verifier's regex accepts the intended review format and still validates origin, hashes, exact row keys and parent lineage. This mismatch is not the cause of the current protected-file hash gate failure. No current runtime consumer using a separate JSON Schema validator was demonstrated.

**Older relation:** existing provenance contract inconsistency, independent of T02 tool-contract regeneration and the T04 checkJs wiring.

**Bounded fix:** express the same bounded original-task/review-date alternatives in the schema and enforce one shared contract through actual schema validation or a tested equivalent. Preserve strict variants, paths, exact keys and the pinned lineage checks.

**Meaningful acceptance:** validate actual baseline lock data using the published schema; review-slice records must pass and malformed review IDs, unknown tasks, extra variant fields, traversal paths and invalid hashes must fail. Challenge both the script and schema with the same corpus so permissive drift is visible.

### R1-V05 — authority transaction can overwrite an edit made after its derivation read

**Evidence:** `service/scripts/update-service-forks.mjs:543–550` reads the three authority JSON files for derivation. `:800–836` constructs the intended rules/map/lock bytes from those parsed objects. `:445–467` then rereads each destination and records that later version as `oldSha256`. `:384–402` compares the destination with this later hash before replacement.

**Trigger:** a maintainer edits one of those authority files after the initial read but before the later `oldContents` read, while the updater processes staged changes or formats its results.

**Consequence:** the newly edited bytes become the accepted transaction preimage, but the intended replacement was derived without them. The updater can complete successfully and silently discard that maintainer edit.

**Root cause:** the transaction preimage is captured at staging time rather than bound to the exact original bytes used to compute its result. The later compare detects edits after staging, not edits after derivation began.

**Counterevidence:** durable temporaries are exclusive-created and fsynced, the pointer is recoverable, a target changed after staging is rejected unless it already equals the intended new version, and the crash tests in `service/test/service-fork-lineage.test.ts:614–699` exercise inter-rename and pre-pointer recovery. Those controls are valuable; they do not cover this earlier lost-update window. Scope is developer authority maintenance, not a portal runtime write or an OS sandbox escape.

**Older relation:** current concurrency gap in the class-aware provenance updater; retain the integrated durable publication fixes. It belongs alongside T05a authority refresh rather than weakening runtime fail-closed policies.

**Bounded fix:** retain raw bytes/digests with the initial JSON reads and pass their digests into transaction staging. Reject any destination that no longer matches the derivation preimage before publication. Keep old/new recovery rules, fsync order, exact transaction target set and conflict behavior. A cooperating updater lease may serialize updater processes, but must not substitute for detecting independent maintainer edits.

**Meaningful acceptance:** pause after initial authority read, make a valid maintainer edit, resume and require conflict with that edit preserved and no new transaction published. Repeat for all three authorities. Keep controls for unchanged success, edits after staging, crashes after each rename, pre-pointer crashes and retry convergence.

## Integrated changes and inspected evidence

Historical reports were inspected for their scoped results and limits; they are not fresh runtime results at this baseline.

| Task | Evidence and current counterevidence |
| --- | --- |
| T01 | Records 198 passed / 6 skipped across focused files in ASCII and Korean paths, while broader portal failures remained. Real policy-enforced WDAC/AppLocker and real UNC execution were not available. This lane retains the repaired encoding/lease behavior verified in the platform review; no old non-ASCII allegation is repeated. |
| T02 | Registry-driven contracts, strict classification and the single drift gate are present. Root tests cover tool/handler/result/runtime parity and docs count blocks. Its historical full run still failed on known defects and timing-sensitive failures; provenance was explicitly pending. |
| T03 | Hermetic Git drops inherited redirect/config channels and neutralizes hooks/signing/templates/ignore/attributes. The packaging regression constructs hostile private config and compares actual archive digests without touching the user's Git config. Spawn hygiene statically checks scripts/tests, including embedded programs and explicit exemptions. No window census is implied. |
| T04 | CI has full history, pinned Node from .node-version, Firefox installation, separate gates, Korean state paths, known-failure checking and a nightly opt-in native-artifact job. Root scripts/tests are included in checkJs; its noImplicitAny=false choice is explicit. The nightly assertion checks actual locked React/Vite installation/build output, not live Figma or UX. The Linux lane is informational, and the native-artifacts fixture still has Windows-layout npm paths; do not claim cross-platform acceptance. |
| T08 | Historical per-row workspace evidence preserves unavailable registrations and explicit rebind identity checks. Two historical baseline failures described there were subsequently addressed by T02/Windows test gating; the report is not current proof that they remain. Its historical Korean operations guide lacks rebind, but current English native guidance describes recovery and source conflicts. |
| T09 | Historical evidence includes the built-daemon retention/startup regression (27 passed / 1 skipped for its three e2e files), scoped isolation tests and explicit retention limitations. Keep scheduled isolated cleanup and uncertain outcomes. The tombstone horizon and health issues are separately covered by the platform report; no claim that the repaired startup poisoning persists. |
| T26 | Records source sampling with exact counts, hash-only large members, BOM handling and named unsafe/generated exclusions. Its report lists focused Windows evidence and open coordinator/module-resolution follow-ups. This lane makes no new claim that all full service analysis is complete merely from its focused passes. |

All 28 assigned scripts and all 20 assigned root TypeScript tests/helpers were read completely. This includes the contract generator, provenance verifier/updaters, report checker, skip census, release packager/verifier, isolated runtime smokes, graph-memory scripts, source hooks, Windows wrappers and their tests. No inspected characterization or expected-error assertion is counted as product success.

The ledger structurally contains 90 unique explicit defects: T14b/K1 17, T13/SVC-1 13, T05a/K5 60. All entries have failureIncludes and existing test paths. This is named technical debt; the checker correctly rejects stale or changed failures rather than promoting them to passes.

## Sound invariants to preserve

- Tool counts and target schemas derive from the live registry; upstream source contracts are retained rather than fabricated.
- Missing committed plugin-contract baselines cannot be silently recreated by regeneration.
- Ledgered failures retain names, messages and fix owners; spawn failure, signal termination and missing reports fail source verification.
- Packaging Git is isolated from the user's hooks, signing and repository redirection. Archive verification binds exact file sets, hashes and required notices.
- Fresh runtime smoke state is separate, owned MCP/daemon children are stopped, and the daemon's stdin-EOF lifecycle differs deliberately from MCP.
- Source/hash, live design and target-service gates remain distinct. C2/C3 required service journeys cannot be replaced with frontend mock success.
- Work-copy/hash/environment/job controls manage authority and lifecycle under the owner's account. Claims of an OS sandbox must not be introduced.
- Provenance repair must retain strict class, origin, parent lineage, destination closure and concurrent edit protection.

## Coverage and limitations

`round-1-verification-coverage.json` contains exactly the 124 assigned paths: 94 full reads and 30 metadata inspections. There are no unreviewed or targeted assigned code/test/config bodies. All 124 working bytes match their baseline-manifest SHA-256 values. Metadata depth means complete structural/hash/contract checks described in each row, not a claimed line-by-line semantic read of generated inventories or repeated third-party notices.

Metadata checks covered every lock authority row, the vendor-map digest and counts, license hashes, union/companion surfaces and implementation/test path existence, all change-manifest row hash/status shapes and duplicates, all slice authority path duplicates/unsafe forms, every known-failure row, SBOM namespace/package relationships and notices headings, and pnpm lock resolution/integrity counts. The lock has 364 resolution records, all with SHA-512 integrity. Dependency importer lines 1–290 were read; transitive lock semantics at 291–3627 were not individually reviewed. Third-party notices were inspected through all 45 package/version headings against the SBOM, not every repeated license paragraph. No external vulnerability or legal certification is claimed.

Cross-lane reads for this report: `packages/mcp/test/portal/native-artifacts.test.ts:218–231,381–466` plus its opt-in/npm references; historical T01 report 176–207,292–310; T02 142–237; T03 158–229; T04 208–284; T08 127–206; T09 140–197; T26 1–30,215–354, with section/keyword inspection elsewhere. These historical reports were read more broadly in the preceding platform task, but only the bounded verification evidence is relied on here. The native-artifacts test's other bodies are not counted as full verification-lane coverage and remain assigned to the portal review. Reading retained service skills here was artifact inspection, not execution of their workflows.

No newly generated archive, reproducibility run, service account connection, remote CI run, actual target portal, provider/database journey, enforced host policy or platform acceptance was exercised. Exact contract regeneration against imports was not executed; current static code and the committed contract consistency were inspected.

## Recommended order

1. Bind provenance derivation to original authority bytes (R1-V05), then complete audited class-aware refresh (R1-V03) and align its published schema (R1-V04).
2. Require explicit suite presence for each run scope (R1-V01) and preserve per-attempt report/log provenance (R1-V02).
3. In the separately authorized native validation copy, establish a clean integrated static/test/provenance/archive/runtime gate and retain named known defects as defects.
4. Verify operational C2/C3 portals, live Figma and real target-service acceptance independently. Broad completion remains unsupported until those actual required journeys pass.
