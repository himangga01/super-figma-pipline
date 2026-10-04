# Final main-session dispositions after round two

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Two review rounds and main-session source revalidation are complete. The final ledger contains **42 actionable findings: 23 High and 19 Medium**. They include narrowed product limitations and acknowledged open provenance work; they are not 42 newly introduced regressions.

Round one produced 40 raw findings, merged to 39 canonical findings. Round two retained those findings with narrower repair boundaries, lowered F04 to Medium, and added F40/F41/F42. R2 challenge IDs are not counted as additional bugs. Historical [round-one dispositions](round-1-main-disposition.md) remain unchanged; this record and [main-findings.json](main-findings.json) define final severity and scope. [Main verification notes](main-verification-notes.md) contain the independent source traces.

## Final ledger

| ID | Severity | Accepted issue | Task | Main verification |
| --- | --- | --- | --- | --- |
| F01 | High | Public prepared-profile transport fails exact registration | M05 | MV01, MV41, MV48 |
| F02 | High | Native validation omits required verified recipe consumption | M06 | MV02 |
| F03 | High | Retained signed replacements exhaust their finite admission limit | M01 | MV03 |
| F04 | Medium | Known collection methods create spurious HTTP review obligations | M08 | MV04, MV46 |
| F05 | High | Qualified global fetch calls are omitted from client discovery | M08 | MV05 |
| F06 | High | BOM-decoded workflow text disagrees with raw-byte source identity | M07 | MV06 |
| F07 | Medium | Journal expiry strands receipt and egress settlement linkage | M04 | MV07 |
| F08 | High | Failed replacement can hide a concurrent same-inode edit | M01 | MV08 |
| F09 | Medium | Completed native attempts have no receipt-compatible reclamation | M04 | MV09 |
| F10 | High | Interrupted attempt mkdir precedes durable ownership identity | M02 | MV10 |
| F11 | High | Resume can rewrite state owned by active validation or cancellation | M03 | MV11 |
| F12 | High | New target publication precedes durable root identity | M02 | MV12 |
| F13 | High | Equal-name mappings collide in same-source reuse obligations | M09 | MV13, MV47 |
| F14 | High | Required stylesheet imports evade excluded-input identity | M07 | MV14 |
| F15 | High | Documented SVG loader queries fail module resolution | M07 | MV15 |
| F16 | High | Dispatched bridge and relay timeouts can be classified effect-free | M11 | MV16, MV45 |
| F17 | Medium | Unresolved component types and rest props appear complete | M09 | MV17 |
| F18 | Medium | Proved preflight apply failures enter unrecoverable conflict | M03 | MV18 |
| F19 | Medium | Generation expiry can strand published validation or recovery | M03 | MV19 |
| F20 | Medium | Failed visual comparison loses authenticated repair feedback | M14 | MV20 |
| F21 | Medium | Cleanup can delete edited private manifest metadata | M01 | MV21 |
| F22 | High | Control initialization permanently caches a rejected attempt | M10 | MV22 |
| F23 | Medium | Rotated owner sessions cannot release settled evidence holds | M04 | MV23 |
| F24 | Medium | Non-solid paint opacity is lost during style simplification | M12 | MV24 |
| F25 | Medium | Cancelled or disconnected activity leaves the panel busy | M11 | MV25 |
| F26 | High | Awaited mutation preflight lacks final cancellation checks | M11 | MV26 |
| F27 | Medium | Dedicated Desktop portal CLI omits target selection | M13 | MV27 |
| F28 | Medium | Valid large captures exceed the analysis response reader cap | M13 | MV28 |
| F29 | High | Chrome transport failure is sticky until daemon restart | M10 | MV29 |
| F30 | High | Mixed typography inverse can claim restoration without restoring | M12 | MV30 |
| F31 | Medium | Incidental unsupported reactions block the required interaction set | M13 | MV31, MV42 |
| F32 | High | Reaction read/write round trips drop meaningful fields | M12 | MV32 |
| F33 | Medium | Generic serialization loses sizing and absolute-child constraints | M12 | MV33 |
| F34 | Medium | Generic segments omit leading-only or tracking-only mixtures | M12 | MV34 |
| F35 | High | Report gates cannot detect absent required nonledgered suites | M15 | MV35, MV48 |
| F36 | Medium | Failed source-check rerun leaves old success at the current path | M15 | MV36 |
| F37 | High | Current protected provenance and committed SBOM remain unreconciled | M15 | MV37 |
| F38 | Medium | Published lock schema rejects valid current transition IDs | M15 | MV38 |
| F39 | High | Provenance staging CAS accepts edits made after derivation | M15 | MV39 |
| F40 | High | Core preparation has a permanent owner and global lifetime quota | M04 | MV40 |
| F41 | Medium | Canonical paragraph semantics and generic single-item lists are lost | M12 | MV43 |
| F42 | High | Generic batch rollback can overwrite concurrent manual edits | M12 | MV44 |

## Material second-round decisions

- F40 is separate from native-attempt and retained-generation capacity. Cancellation retaining its charge is deliberate counterevidence; add authorized dependency-aware reclamation rather than deleting every cancelled record.
- F41 is separate from F34. Canonical capture already retains leading/tracking, but lacks local paragraph/list/indentation/wrapping data. Generic single-item lists need their own trigger.
- F42 is separate from mixed-value inverse loss in F30. Even an exact snapshot can erase a manual edit made during awaited work. Restore only properties proved to remain the owned postwrite values, and report partial/conflicted rollback honestly.
- F04 is avoidable review friction because exact source-bound owner review is supported. F05 remains an omitted client-discovery path, not proof of absent server capability.
- F13 repairs same-source obligation uniqueness. The proposed blanket source-qualified candidate-group key is rejected because it suppresses intentional cross-source ambiguity. M09 explicitly keeps these identities separate.
- M05 must fix the real CLI round trip, not only endpoint schemas. Version fences govern new effects while preserving old signed partial-apply and environment proof for bounded reconciliation. Reclaiming receipts or directories before this proof is durable is rejected.
- M11 covers the earlier sandbox bridge timeout as well as relay loss. Cancellation or a cleared UI spinner is not proof of no effect and cannot release an active queue grant before callback settlement.
- M13 interaction relevance must reach derivation, required preparations, preview and consumption. A preview-only ignore flag or caller root subset would bypass required evidence and is rejected.
- M15 independently declares full/focused scope. Repair F39 CAS first, then class-aware provenance/schema/hash reconciliation, then integrated gates. Bootstrap focused evidence has explicitly pending baseline gates.

## Rejected or unproved claims

Keep the [round-one exclusions](round-1-main-disposition.md#rejected-corrected-or-not-promoted). Old repaired T01/T08/T09/T26 allegations, total loss of large-image copying, arbitrary asset deletion by private-manifest cleanup, concealed native execution, and catalog-presence claims are not promoted. Text-shortening/run-boundary loss beyond the proved mixed inverse requires runtime reproduction. Deterministic SOURCE_DATE_EPOCH or Git epoch contradicts an always-changing SBOM timestamp allegation. No current CI suite omission or artifact-verifier bypass was demonstrated. No claim of an OS sandbox or complete service readiness is made.

## Implementation consequence

All 42 findings map to M01-M15 in the [completed remediation plan](../../plans/2026-09-30-code-remediation-plan.md). M16 preserves the required complete portal case behavior, and M17 requires post-implementation critical review and actual service acceptance. Prioritize durable data, rollback conflicts and uncertain effects before exposing the repaired public profile/consumption flow. No service source, tests, provenance authority, Git index or commits were changed during this review.
