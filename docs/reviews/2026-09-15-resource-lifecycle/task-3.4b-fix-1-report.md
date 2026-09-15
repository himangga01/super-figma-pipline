# Task 3.4b fix 1 report

## Review findings addressed

This correction addresses admission finding A1/P2 and lifecycle finding P1. Only six previously owned files changed. The initial report, 20-file manifest, review diff, and diagnostic evidence remain preserved. No unrelated worker source, dependency, browser, daemon, primary distribution, Git index, commit, or remote was changed.

### A1: approved reservation attachment and cancellation

Approved resumption now publishes a reservation-preparation handshake on the cancellation state before starting asynchronous reservation work. Cancellation waits for that handshake before declaring durable settlement. Successful preparation attaches both real reservations before the observer/fsync pause; failed preparation rejects the handshake after the existing reservation failure settlement path. An already aborted operation cannot begin fresh reservation work.

Both cancellation callers and resumed dispatch share the same cached pre-dispatch settlement promise. A cancelled queue-transition failure also uses that settlement rather than separately finalizing/releasing the same reservation. Direct admission attaches reservation ownership before its observer pause too.

Two regressions use actual OperationJournal, EgressManifestStore, and OperationEvidenceReceiptStore at the already-attached and late-attachment boundaries. They verify no runtime call, cancelled terminal status, exactly one finalizer, exactly one evidence-reservation release, and a real final egress record instead of residual pre-only state. Existing queued and public portal-cancellation regressions remain in the consuming sweep.

### P1: durable lifecycle closure and checked transitions

Attempts now carry a monotonically advancing revision, an irreversible executionClosed fence, and a cleanup-claim identity. Every lifecycle mutation advances the signed revision. beforeLaunch and owned-child creation recheck their observed revision, allowed current state, stop predicates, and closure state inside the actual PortalStore CAS. Permit rejects closed execution.

finish claims cleanup durably before asynchronous directory/resource verification, checking the exact current revision and stopped-process predicates in the CAS. That claim closes future launch/permit transitions. The released transition again checks revision, cleanup-claim identity, closure, and every process state. Idempotent release preserves an existing valid receipt; interrupted claim release can resume without reopening execution. A stale finisher does not quarantine or overwrite a different winning cleanup claim or changed observed revision.

Owner reconciliation rejects live ready/running execution even between already stopped commands. It requires a closed cleanup/quarantine/released attempt and carries the exact inspected revision/hash through finish to the cleanup CAS. Missing process proof remains quarantined. This is durable per-record transition coordination, not merely a per-instance mutex.

Six deterministic signed-store/native-filesystem regressions cover cleanup winning before launch, a paused launch losing after cross-manager release, an already permitted launch winning before stale cleanup CAS, live reconciliation rejection, changed inspected revisions, and recovery after an interrupted resource-claim release. Synthetic process identifiers isolate these state-machine interleavings; existing real Windows process tests remain the separate proof of actual broker ownership and termination.

### STOPPED delivery and durable acknowledgment

The fixed Windows broker now waits boundedly for an ACK after sending its authenticated STOPPED frame. The owner sends ACK only after the matching PID/birth/token stop receipt is durably persisted. The broker therefore cannot ordinarily exit before durable receipt delivery. The same handshake covers denied permits and normal/failure/cancellation exits.

Transport closure alone neither proves a stop nor invalidates a matching STOPPED receipt that becomes durable. Protocol mismatch and absent proof still fail closed. The existing one-second receipt wait was not increased. The broker acknowledgment wait is bounded at five seconds and retains EOF/Job safeguards.

A real native regression pauses stop-receipt persistence and proves that the broker remains alive, the signed process row remains permitted, and exit/release occurs only after persistence and ACK. This proves the corrected ordering. The precise cause of the historical intermittent cleanup failure is still unproven; this report does not claim that the same failure was directly reproduced. An implementation-iteration C# declaration error was corrected before the native ACK regression passed.

## Verification

- Focused approved/queued cancellation regressions: 3 passed, exit 0.
- Native environment plus executor sweep during correction: 52 passed, exit 0.
- Six final lifecycle interleaving/recovery regressions: 6 passed, exit 0.
- Real paused-ACK broker regression: passed, exit 0.
- Final MCP, CLI, shared, and IR TypeScript checks: each exit 0.
- Owned 20-file format check and lint with `--deny-warnings`: exit 0.
- Final eight-file consuming sweep: **108 passed across 8 files**, exit 0, 136.74 seconds, one Vitest worker. This includes the previously intermittent failed-unasserted-step case. Command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-environment.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/execution/file-queue.test.ts packages/ir/test/portal-completion.test.ts packages/shared/test/portal.test.ts --maxWorkers=1`.

The preserved admission diagnostic was renamed by main to `.test.ts.disabled`, keeping its exact bytes while excluding it from normal TypeScript/test discovery. Neither review diagnostic is an integration artifact.

## Limits and remaining gates

The existing Windows/SQLite, finite retention, same-account, no-OS-sandbox, and no-automatic-deletion limits remain unchanged. Lost process evidence cannot be cleared by a caller boolean or a disappeared PID. The newly required attempt transition fields are part of the still-unreleased lifecycle protocol; this task never deployed its earlier implementation to actual owner state. Historical profiles/acceptance without environment authority remain inspectable and fenced.

Independent scoped re-review and main integration are still required. Later whole-service review rounds, capture/portal fixture acceptance, release provenance, and Git publication remain main-session work.

## Exact corrected bytes

The full updated 20-file integration authority is `task-3.4b-owned-files.json`; its original main-checkout preimage hashes are preserved. `task-3.4b-fix-1-owned-files.json` records these six files against their initially reviewed hashes for scoped re-review.

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/native-lifecycle.ts` | `101a2c885ea75e13eb751c0c442c4b0fb3af05015c46f00f72a3fc2424bccf67` |
| `packages/mcp/src/portal/native-process-control.ts` | `676153ee52e728910c7d26ef6a0ae7f682cc636db97d3240e9ff8bd0875234fd` |
| `packages/mcp/src/portal/windows-job.ts` | `86ace3d85fd7b494f2555bfb1fcafcc38e2b237776e8884a8bdb488834d90435` |
| `packages/mcp/src/execution/operation-executor.ts` | `6b1ebe80e41e9665e88c121c30d66e22de6ca5b5904deb7b04659a55bfca4eea` |
| `packages/mcp/test/portal/native-environment.test.ts` | `9d2ee307c782117b4b1e89e5a690aaa625c3ef11d3b54940e5dd2c998f1975fd` |
| `packages/mcp/test/execution/operation-executor.test.ts` | `171b04fc597d6ca8548dbc1a1f596a02824c210c4c5fec0e7c8ffac022f03b4b` |
