# Task 5.3 consumer fixture peer review

## Decision

Scoped PASS for the six main-authored test-only migrations. No actionable weakening of the existing source, behavior or admission assertions was found. This supplements the separate 46-file production review; it is not a whole-code review round or live service acceptance.

All six isolated candidate hashes and all six main preimage hashes matched task-5.3-fixture-owned-files.json at review time. No candidate or production file was changed by this review.

## Review findings

Read task-5.3-fixture-report.md and the complete six-file diff, then inspected the current capture fixture and affected native/capture-flow consumers in the separate native copy.

- Coordinator setup now produces a controlled current capture through the closed reader, continuation and coherent collector. Explicit grants replace unsupported direct calls with no capture authority. Existing candidate limits, source selection, workflow, catalog paging and lease assertions are retained.
- Component mocks provide explicitly empty component definitions where an available empty API was intended. NAVIGATE metadata makes those positive reaction examples well-formed; negative unknown-action examples and their unresolved behavior were not removed.
- Native and operational fixtures now use a signed owner-state capture with actual PNG bytes instead of standalone JSON or empty-asset boolean claims. Their existing source closure, application, HTTP/SQLite, authorization and reference-independence assertions are unchanged. These direct consumer tests do not claim to repeat canonical browser admission tests.
- Capture-flow still verifies dimensions from the design, exact asset bytes exposed to the agent, and immutable asset identity in submitted files. Its generated 1-by-1 PNG is an import fixture, not an asserted visual oracle for the 1440-by-900 design.
- Source-authority unit tests preserve binary/mts/graphql membership, alias, missing inventory and unexpected closure rejection. Synthetic analysis fields are explicitly labeled as unrelated to the tested material-byte predicate. IR completion similarly labels its synthetic descriptor/receipts and adds missing-capture-receipt rejection while preserving missing API, persistence and authorization checks.
- The old freshness test's manually replaced request/design fields and duplicate signed design creation are replaced with a require-live plan from the start. Both unchanged and changed applied-target branches reach actual native validation and a suspended capture. The unchanged branch proves distinct attempt evidence with equal semantic fingerprints is accepted and checks the original/fresh receipt identity. The changed branch still requires PORTAL_APPLIED_SOURCE_CHANGED after modifying an untouched backend configuration file during freshness. Both assert the original signed raw capture and assetRoot were retained. Synthetic initial acceptance is already labeled as setup for publication/CAS tests, not runtime proof.

## Independent verification

Executed in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service:

1. capture-flow, source-authority and IR portal-completion suites: 3 files, 8 tests passed, exit 0, 4.20 seconds.
2. Native-work suspended freshness filter: 1 file, 2 tests passed, 28 intentionally unselected tests, exit 0, 16.03 seconds. Both the unchanged positive and changed-target rejection executed.

The main agent's full six-file 71-test run, type checks, formatting and lint remain separate controller evidence; they were not unnecessarily repeated. No diagnostics or fixture changes were needed.

No Superpowers, Docker, subagents, live browser/Figma, daemon, build, dependency installation or Git mutation was used. Native validation shares the Windows user privileges and is not an OS sandbox. The decision covers only the six manifest paths and does not certify concurrent recipe work or later final acceptance.
