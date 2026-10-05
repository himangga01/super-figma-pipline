# Windows native process cleanup race

Date: October 4, 2026 (Asia/Seoul). Published baseline: `5b9343efc82ef47ba56f412acbd4eee5a328d335`, plus the recorded uncommitted repairs. Current matching main/native source: `sha256:170487cf0d214cf755cbdd223e2a6eb4e2778ec06f5ef27b38bed87a893a8bb2`.

## Actual failure

Full-source attempt `8ba0fbde-9d07-4e62-b172-3e28b3dec566`, at source `4d004e08...`, passed 4,713 tests but failed one required Chrome/native preview case with `PORTAL_NATIVE_CLEANUP_UNKNOWN`; 20 existing skips remained. The [failed report](failed-source-report.json), [tests](failed-source-tests.json), [scope](failed-source-scope.json) and [skip census](failed-source-skips.json) are retained. Its earlier pairing and producer-output failures did not recur. The saved preview fixture output shows its first visual invocation succeeded; a later invocation in the same test failed during cleanup. The precise original Win32 return code was not retained, so attribution of that particular failure remains an inference.

Inspection found that the trusted broker returned cleanup failure immediately when `TerminateProcess` failed after enumerating a job member. Microsoft documents that [termination is asynchronous and an already terminated process can return access denied](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess). Enumeration and termination are separate operations, so natural exit or a previous termination request can race with that check.

Three real Windows cases launched 16 short-lived descendants inside the service broker's job. All [three cases failed before repair](race-before.json), returning broker exit 126 rather than success. All [three passed after repair](race-after.json). These executed results establish the reproduced race scenario, without asserting that every earlier intermittent native failure had the same cause.

## Repair and verification

The broker now continues its existing bounded membership polling after a termination request. A failed API call is not treated as proof of termination. Only a later job query containing the broker alone can emit `STOPPED`. Persistent live members, failed job queries, missing receipts and missing durable acknowledgment remain failures. The polling count, polling delay, command deadlines, ownership checks and private receipt protocol were not relaxed.

The [expanded native/Chrome suite](expanded-tests.json) passed 44 cases with one existing conditional skip, including the actual prepared preview worker and lifecycle failure cases. MCP typecheck and scoped lint/format passed. The [source checkpoint](source-checkpoint.json) records bounded provenance verification with 32 semantic changes, four authority paths, three pinned upstreams and 238 vendor rows. The main owner index remains unchanged.

At approximately 19:23 KST, fresh full-source attempt `c5a36f06-ab1f-4d47-8ff4-2222abc985a0` passed all 16 source/package gates at the unchanged `170487cf...` fingerprint. The [complete checkpoint](full-source-checkpoint.json) records 426 files and 4,737 cases: 4,717 passed, zero failed and 20 existing skips. All 37 required Chrome cases across nine files passed without skips or overrides. [The report](full-source-report.json), [tests](full-source-tests.json), [scope](full-source-scope.json) and [skip census](full-source-skips.json) preserve the result. The separate [artifact-content case](artifact-contents-checkpoint.json) also passed at the same source. Earlier failed attempts remain failed evidence. No release, commit or push was performed for these new changes.

The native test working copy and subprocesses retain the Windows owner's privileges. The Job Object controls owned child lifetimes; it is not an OS filesystem or network sandbox. No Docker or alternate browser was used, and no browser approval was automated.
