# Task 3.4b lifecycle fix 1 review

## Verdict

Pass for the scoped lifecycle correction and its immediate process-control regressions. The initial P1 reconciliation/launch race is addressed. No new actionable finding was established in this scoped review. Admission finding A1 remains assigned to the other reviewer; this is not a whole-service or release approval.

## Verified correction

The lifecycle now persists a cleanup claim and irreversible execution-closed fence before asynchronous filesystem observations. Its real PortalStore CAS checks the observed revision, allowed current state, and stopped-process predicates. The terminal CAS checks the claim, revision, closure, state, and process predicates again. A competing launch that already won causes stale cleanup to fail without overwriting or quarantining that winner.

The symmetric ordering is also closed: `beforeLaunch` and owned-child creation recheck their observed revision and current closure/state inside the mutation. A launch that inspected an earlier ready record cannot reopen an attempt released by a different manager. Permit rejects closed execution. These are durable record checks backed by the existing expected-byte CAS, rather than an in-memory mutex.

Owner reconciliation rejects live ready/running attempts, including the interval between stopped commands. Closed cleanup/quarantine/released records carry their exact inspected revision and hash into `finish`. Changed inspection evidence rejects before cleanup acquisition. Interrupted resource-claim release remains recoverable using the retained closed execution record. Missing process proof still cannot authorize reconciliation.

The Windows broker now sends STOPPED and waits for a bounded acknowledgment. The parent writes ACK only after the token/PID/birth-matched stopped record is durably persisted. Transport closure alone does not establish proof; missing STOPPED and protocol mismatches still fail. Both denied-permit and normal completion branches retain Job/EOF safeguards. The existing receipt timeout was not increased. The implementation report correctly avoids claiming that the historical intermittent failure's precise cause was reproduced.

## Independent checks

- Read `task-3.4b-fix-1-report.md`, the six-file delta manifest, full twenty-file manifest, current scoped diff, corrected lifecycle/process/broker source, and the new native test cases. Rechecked the underlying PortalStore read-transform-expected-digest CAS behavior.
- Reran `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-environment.test.ts --maxWorkers=1`: **23 passed**, exit 0, **26.58 seconds**.
- That suite includes the six deterministic cross-manager lifecycle/reconciliation/recovery cases, the real paused STOPPED-persistence/ACK case, and the original native broker/SQLite/quarantine/capacity cases. Cross-manager tests use distinct PortalStore instances over real signed state. Synthetic process identifiers in state-machine tests isolate the race; separate broker tests exercise real Windows processes.
- Recomputed hashes: **6/6 delta files** and **20/20 full owned files** match their current manifests, with zero mismatches.
- Did not duplicate the full 108-test sweep, admission review, or unrelated capture work. No new diagnostic test was written during this fix review. No owned code, dependency, distribution, browser, daemon, Git index, commit, or remote was changed.

## Exact authority and limits

The current `task-3.4b-review.diff` SHA-256 is `3e7660d8df0820d2d4f09412f49b60cb7f65f71e5762fcacd3b554a04385e06f`.

The lifecycle/process files reviewed here have these hashes:

| Path | SHA-256 |
| --- | --- |
| `service/packages/mcp/src/portal/native-lifecycle.ts` | `101a2c885ea75e13eb751c0c442c4b0fb3af05015c46f00f72a3fc2424bccf67` |
| `service/packages/mcp/src/portal/native-process-control.ts` | `676153ee52e728910c7d26ef6a0ae7f682cc636db97d3240e9ff8bd0875234fd` |
| `service/packages/mcp/src/portal/windows-job.ts` | `86ace3d85fd7b494f2555bfb1fcafcc38e2b237776e8884a8bdb488834d90435` |
| `service/packages/mcp/test/portal/native-environment.test.ts` | `9d2ee307c782117b4b1e89e5a690aaa625c3ef11d3b54940e5dd2c998f1975fd` |

The original defect reproduction remains historical excluded diagnostic evidence under its disabled filename. It is not an integration artifact. Current implementation-owned regressions assert safe behavior.

The existing Windows/SQLite-only proof, same-account execution, finite admission retention, and no automatic deletion limitations remain unchanged. Native validation used the separate working copy without creating an OS sandbox. Final broad review, portal acceptance, provenance, and publication gates remain open.
