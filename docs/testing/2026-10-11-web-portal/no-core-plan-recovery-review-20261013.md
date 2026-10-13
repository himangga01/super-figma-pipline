# No-Core original-plan recovery candidate

Date: October 13, 2026 (Asia/Seoul). Source baseline: Main/native `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`. This independent candidate is not integrated or deployed. Read the canonical [recovery analysis](../../analysis/portal-local-capture-recovery.md) before continuing; the older local-composite disposition remains a separate mechanism.

## Problem and implemented candidate

The portal bridge disabled Refresh when an unknown plan had no service run ID. Its ordinary refresh path also attempted `portal_status` with a null ID. The workflow therefore remained fenced even when the authenticated original operation had settled before dispatch.

Only `packages/portal/src/bridge.ts` and `packages/portal/test/backend.test.ts` change in an owned regular copy under `.worktrees/_cache/no-core-recovery-20261013/work/service`. Refresh becomes available for an idle unknown run with an exact retained `portal_plan` ID and a supported authenticated inspection control. It inspects the existing operation without invoking another tool, replaying the request, modifying daemon authority or renewing a deadline.

The new classifier accepts a full `OperationRecordSchema` record only when the operation ID, workspace, tool kind and `portal_plan` name match, status is `pre-egress-rejected`, and settlement is recorded. Missing, malformed, foreign, uncertain, generic rejected/failed/succeeded records and tombstones cannot establish this proof. The executor's demotion logic distinguishes `pre-egress-rejected` for pending approval from generic rejected/failed states; generic rejection is deliberately excluded.

Inspection reserves the existing bridge operation slot while retaining the original unknown snapshot. Commit rechecks its exact active signal, non-aborted state, absence of close, unknown run status, retained operation identity/workspace and missing Core ID. Cancelled, closed or stale inspections cannot classify the run. Proven pre-dispatch rejection changes the current portal run to failed with an explicit no-source-dispatch message, retains its original operation ID and preceding events, and appends the former unknown status to a disposition event in the same atomic store transaction that clears its unresolved fence. The authenticated journal remains unchanged. The existing start guard then allows a genuinely new run ID; uncertain records keep the original fence.

## Independent review correction: R2

Root rejected R1's separate event write after classification because a concurrent start or persistence failure could observe the cleared fence before the disposition event became durable. R1 remains preserved. R2 writes the event, current classification and unresolved-fence removal together. Its read-only inspection avoids changing the original snapshot before that transaction. A real filesystem test replaces the destination with a directory to force the atomic rename to fail: the unknown snapshot, original events and start fence remain unchanged. After restoring the original destination, the successful disposition and its event survive reopening the store. No mocked journal result is treated as live historical acceptance.

## Verification and limits

- R2's four changed tests passed: authenticated pre-dispatch rejection and a fresh run; mixed invalid/foreign/uncertain evidence; exclusive inspection and late proof after cancellation/close; actual atomic persistence failure and durable retry.
- One existing activity-capacity HTTP test passed, confirming Refresh remains available at full activity capacity. This existing case checks the established Core-backed inspection path; it is not a new live no-Core acceptance claim.
- R1's final focused receipt had four passed, zero failed, 66 filtered. R2 reran only its four changed cases with four passed, zero failed and 67 filtered. TypeScript 6.0.3 checked 387 source files with zero diagnostics after R2; the two changed files passed lint and formatting checks.
- The first local type adapter produced missing-dependency diagnostics because Windows path separators prevented its read-only native fallback. Normalizing adapter paths corrected that setup and the actual no-emit check passed. No product source change was used to suppress diagnostics.

R1 frozen evidence remains in `.worktrees/_cache/no-core-recovery-20261013/freeze/frozen-files.json`. Current R2 exact files and preimage/after hashes are in `.worktrees/_cache/no-core-recovery-20261013/freeze-r2/frozen-files.json`. The Main/native files remain unchanged. The copy shares the Windows account and reads existing native dependencies; it is neither an OS nor a process sandbox. No whole suite, live API, Chrome, service replacement, actual historical recovery or application acceptance was executed. Root must independently review and integrate this candidate at its chosen live-phase boundary before deployment or recovery claims.
