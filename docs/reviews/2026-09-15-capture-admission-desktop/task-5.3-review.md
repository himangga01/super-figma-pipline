# Task 5.3 independent admission and Desktop review

## Decision

Scoped PASS. No actionable defect was reproduced in the reviewed Task 5.3 candidate. This is a task review, not either final whole-code review round, final service acceptance, or a live Desktop/Chrome certification. All 46 candidate files still matched the supplied owned-file SHA-256 manifest after review.

## Scope and source inspection

Reviewed the final remaining-work plan, Task 5.3 admission notes/report/diff, and Task 5.2b authority handoff. Source was inspected in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. No frozen production source was edited. No Superpowers, Docker, dependency installation, build, browser connection, daemon, Figma operation, subagent, or Git mutation was used. Native tests share the Windows account and its filesystem/process/network privileges; this is not an OS sandbox.

The review followed the actual default CLI and leader/follower MCP selector paths into index.ts, preparePortalCaptureAuthority, LeaderGenerationExecutionPlane, OperationExecutor, createPortalCaptureRuntime, validated pinned plugin runtime and registered plugin handlers. It also inspected coordinator generation/publication, profile preparation/registration nonce handling, NativeWork validation/application and IR completion consumers.

Confirmed boundaries:

- portal-source is restricted request intent. Explicit contradictory Chrome selectors and Desktop none are rejected. Generic target resolution cannot turn portal-source into an implicit active target.
- Signed run/plan owner lookup precedes Desktop discovery for validation. Desktop selection binds actual session, generation, file identity, execution key and signed owner document/session evidence. Generation and identity are compared across binding awaits and the selected target is retained through approval and child execution.
- Capture grants enter the operation argument identity without replacing repository/native authority. Existing resource lanes are retained with the additional selected Figma resource.
- Chrome preapproval authority is explicitly requested URL/scope only. Actual selected-page observation belongs to the approved service connection; no independent client or preapproval design read was added.
- Desktop uses the two compiled closed primitives, canonical input/result schemas, handler registry and policy/egress entries. No caller code or Desktop eval is exposed. Child actions retain the parent operation, use distinct derived nonces and revalidate the pinned target before and after each child.
- The shared collector preserves ordered tree/catalog/reference continuation and reobservation, exact asset query identities, original stroke/styled-text images and separate root exports even with equal bytes. Missing APIs remain incomplete. Non-atomic coherence and absent document epochs are stated accurately.
- Current original descriptors bind the exact original grant, raw/manifest hashes, semantic fingerprints and collector evidence. Consumers verify signed records plus actual referenced asset bytes. Freshness validates a new admitted capture independently and compares semantic scope/fingerprint without replacing the original asset root or requiring identical attempt evidence.
- Historical/partial inspection does not issue a generation lease. Current profile, generation, native/apply and unsafe resume consumers require current capture evidence. Final applied-source verification remains after freshness, output verification, lifecycle completion and the final original capture check.

## Executed verification

1. Capture admission, Desktop collection, descriptor, controlled execution-plane and native admission suites: 5 files, 33 tests passed, exit 0, 7.80 seconds.
2. Operation policy, result egress policy and CLI admin command suites: 3 files, 43 tests passed, exit 0, 3.76 seconds. Two additional nonexistent path filters in that command matched no suites and are not counted as verification.
3. Independent controlled execution-plane diagnostics: 1 file, 2 tests passed, exit 0, 2.90 seconds. The first creates a signed plan and run, then validates as another owner and verifies rejection before session discovery or plugin effects. The second submits arbitrary code through both canonical read and asset arguments and verifies argument rejection before any plugin effect or approval. The first diagnostic run used invalid noncanonical request-ID suffixes; correcting the diagnostic IDs allowed the intended boundary tests to execute. That initial result was a diagnostic setup error, not a production finding.

The diagnostics reused the real plane/executor/journal, validated runtime registry, compiled handlers, production admission helper and signed PortalStore fixture. No claim is made that the controlled Plugin API is a live relay/browser.

Independent diagnostic source is preserved, disabled from routine discovery, at service/packages/mcp/test/portal/review-task53-admission.diagnostic.test.ts.disabled in the isolated copy. SHA-256: f2d8c0e4a686a807e466031e8705063fbbc962a83e614a856ef80b7426484366. It is review scratch and is not part of the 46-file integration manifest.

## Remaining verification boundaries

The main agent's separately migrated six fixture test files are outside this candidate manifest. Their reported 71 passing tests, including native fresh-positive and postfreshness target-change coverage, are useful controller evidence but were not rerun in this review and are not included in the 78 independently executed tests above.

Final generated contract/provenance closure, current daemon build, real supplied-Figma Chrome acceptance, live paired Desktop host acceptance, portable capture packages, recipe behavior/consumption, interaction/visual receipt completeness and final whole-code reviews remain their explicit later work. Concurrent Task 6 changes were not certified by this review.
