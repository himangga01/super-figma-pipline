# Full code and service review report

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`, branch `remediation/2026-09-27`. Status: two review rounds and main-session adjudication complete; implementation is planned.

The service is not ready for complete portal acceptance. The supported prepared-profile transport disagrees with registration, and native validation does not produce the mandatory verified recipe-consumption receipt. Durable replacement, directory creation, concurrent run state and effect classification also need repair before exposing that path. Existing strict consumption, ownership and uncertainty gates should remain intact.

## Results

- **42 accepted or narrowed actionable findings: 23 High, 19 Medium.** Round one produced 40 raw findings, merged to 39 canonical findings. Round two added three: permanent core-preparation capacity (F40), lost paragraph/list capture semantics (F41), and rollback overwriting concurrent manual edits (F42).
- F04 was lowered to Medium because exact source-bound owner review provides a supported path around the HTTP false positive. The proposed source-qualified candidate grouping fix was rejected because it would hide intentional cross-source ambiguity. Other criticisms were narrowed against production callers and counterexamples rather than accepted by reviewer agreement.
- **1,084 manifest files covered:** 1,052 complete body reads and 32 concrete metadata consistency checks, with zero remaining targeted-only or unread files. Round two closed all 292 first-round test-body gaps. All source hashes and HEAD remain at the baseline. See [coverage and limits](coverage-summary.md).
- Static source and metadata verification only. No tests, build, installation, repository helper, browser, daemon or live acceptance ran. Inspected assertions and historical test reports are not current passing evidence. Only review/plan documentation changed.

The [final ledger and dispositions](round-2-main-disposition.md), [machine-readable findings](main-findings.json) and [main source revalidation](main-verification-notes.md) preserve every accepted finding, its scope, counterevidence and task mapping. The existing 149-path provenance drift is acknowledged open work, not a newly introduced regression or an executed verifier result. Stale repaired-path allegations, total asset-copy failure and the broad concealed-native-execution claim were not promoted.

## Review method

Five subagent identities contributed six perspectives per round, in parallel batches of up to three. A further thread could not be created because of the tool limit; existing threads were reused with rotated assignments. The second round challenged findings and repair boundaries, searched for omissions, closed unread test bodies and rechecked metadata. It does not claim fresh identities, different models or two complete production-body reads. The main session independently traced findings and adjusted acceptance, severity and the plan.

| Perspective | Round 1 | Round 2 |
| --- | --- | --- |
| Portal workflow and recovery | [Report](round-1-portal.md) | [Challenge](round-2-portal.md) |
| Source and full-service analysis | [Report](round-1-analysis.md) | [Challenge](round-2-analysis.md) |
| Platform, security and concurrency | [Report](round-1-platform.md) | [Challenge](round-2-platform.md) |
| Capture, UI and design fidelity | [Report](round-1-capture.md) | [Challenge](round-2-capture.md) |
| Contracts, recipes and consumption | [Report](round-1-contracts.md) | [Challenge](round-2-contracts.md) |
| Verification, provenance and release | [Report](round-1-verification.md) | [Challenge](round-2-verification.md) |

## Remediation outcome

The completed English [code remediation plan](../../plans/2026-09-30-code-remediation-plan.md) defines 17 tasks with source boundaries, dependencies, preserved safeguards and meaningful acceptance conditions. Start with data preservation, rollback conflicts, durable recovery and uncertain effects; then repair the exact public profile and authenticated consumption flow. Bootstrap provenance with the updater CAS repair before reconciling authority and requiring integrated gates.

Only C4 is frontend-only. C2/C3 still require their complete relevant portal layers and real service journeys; C1 inherits its reference/no-reference branch. Complete native/live case acceptance and post-implementation review remain required. Future native validation uses a separate working copy with the same Windows owner filesystem/process/network privileges, not an OS sandbox. No Docker or Orca/hook installation was used.
