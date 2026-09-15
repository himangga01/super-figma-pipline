# Task 2 scoped review

## Verdicts

- **Specification: PASS WITH CONCERNS for this per-task gate.** The scoped cancellation and diagnostic behavior is implemented, and the report distinguishes actual service capture success from an unproven historical failure cause. This is not a verdict that the historical exception was causally repaired or that final Case 4 acceptance is complete.
- **Code quality: PASS WITH ONE NON-BLOCKING P3 FINDING.** No blocking correctness issue was found in the reviewed changes. The elapsed-time diagnostic issue below should be corrected before these timings are used to interpret slow failures.

## Scope and evidence

Read `task-2-brief.md` first, then `task-2-report.md` and the supplied 12-file `task-2-review.diff`. The first tool response truncated part of the diff; only the omitted portions were subsequently retrieved. The controller independently verified the exact 12-file hashes against the isolated checkout at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`.

The only additional source inspection followed named cross-interface risks: logical session acquisition/release in `selectExistingFigma`, retained transport shutdown behavior, and the native worker executable selection and launch flags. No source or index was changed. No test, daemon restart, Chrome operation, broad repository search, or subagent was run. Retained PID 23776 and exec session 64596 were left untouched.

The reported 59 focused passing tests, typechecks, formatting/lint checks, alternate build, and final-source native startup are supporting implementation evidence supplied by the report; this review did not rerun them. No additional test was needed to establish the static timing finding.

## Finding

### P3: Failure elapsed time starts after cleanup and fallback operations fail

- `service/packages/mcp/src/portal/design-capture.ts:226`
- `service/packages/mcp/src/portal/coordinator.ts:479`

The cleanup failure constructor receives `Date.now()` inside the catch after `session.close()` rejects. The coordinator likewise supplies `Date.now()` only after an older capture port or design publication has failed. Since `PortalCaptureError` subtracts that timestamp immediately, a cleanup, legacy capture, or design-publication operation that takes minutes before failing normally reports approximately zero elapsed milliseconds. This makes those diagnostics misleading, and qualifies the report's statement that failure elapsed time is recorded per stage. Capture a timestamp immediately before cleanup and before each coordinator boundary, and pass the corresponding timestamp when wrapping its failure. This does not affect cancellation, failure classification, confidentiality, or cause precedence.

## Reviewed behavior

- A cancelled same-file waiter receives cancellation without releasing its internal queue tail. Subsequent work remains behind its predecessor, and the queued read checks cancellation before opening a session. The new three-request regression exercises overtaking prevention and verifies that only the two active requests snapshot and export assets.
- Shared connection assignment belongs to the shared promise, independent of any cancelled caller. A cancelled connection waiter does not select a tab session; another caller can reuse the same pending connection. Late logical sessions are released, with cleanup rejection suppressed only after cancellation has already been delivered.
- Shutdown sets the closed flag before awaiting transport teardown. A browser that resolves during shutdown is closed by the shared completion branch rather than being assigned for reuse; the closing caller absorbs that rejected connection promise. The regression checks exactly one browser close. The retained transport's close implementation is idempotent.
- Stage entry checks prevent work at subsequent capture boundaries after cancellation. Snapshot and asset operations retain their signals, deadlines, per-batch limits, and completeness checks. Existing directory/boundary protection calls remain present.
- A failed main capture retains its original internal cause when session cleanup also fails. A cleanup-only failure receives its own typed category, and cancellation retains precedence through the logical waiter and signal checks.
- Public error codes and types are allowlisted. Schema evidence bounds issue count, path count, path depth, and string length, and replaces unknown field names and numeric indices. Coordinator fallback no longer publishes arbitrary exception codes. Original exceptions remain internal causes.
- The new failure field is optional without a default. Older design records acquire no invented diagnostic or capability evidence. Wider generated contract/capability updates remain outside this gate as stated in the task report.
- The ACL fix imports the Security module from the selected native PowerShell executable's own `$PSHOME` before the worker announces readiness. It preserves `Get-Acl -LiteralPath`, native executable selection, noninteractive/no-profile launch, and existing ACL/boundary decisions. It changes neither global environment nor execution policy. The native conflicting-module regression and unsanitized Node-child startup are appropriately separate from the historical capture experiment.

## Cannot verify or claim from this gate

- The historical `DESIGN_CAPTURE_FAILED` cause remains unestablished. A successful diagnostic run supplies current-path success evidence, not a failing-before/passing-after proof for that historical exception.
- The retained live diagnostic build is reported as `sha256:c6b50249d56323b57b7a9019f999d8c045bf32d998cdf9e12e34d6d338eb75d2`; it predates the final startup, cleanup, and fallback refinements. It does not prove live capture on final source identity `sha256:e5317cda5983a02aba78a022c3384acfcbfe618f3c508033f71c9765c69a2e3e`.
- This review did not independently query the live daemon, signed owner-state records, raw design bytes, or 283 asset files. The report records their successful checks and honestly separates the two build identities.
- Final coherent/catalog/recipe-integrated Case 4 acceptance, a later reviewed restart if required, and the user's two broad whole-code review rounds remain later gates.
- Native execution in a separate working copy is not an OS sandbox. The same-owner filesystem/process access limits described in the report are accurate.
