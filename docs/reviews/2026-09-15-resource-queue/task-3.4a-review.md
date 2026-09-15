# Task 3.4a independent review

## Verdict

Specification: **PASS** for the bounded in-memory queue foundation.

Code quality: **PASS**. No actionable defects were found in the two reviewed files.

This verdict does not complete Task 3.4. Canonical resource discovery, executor cancellation integration, durable claims, environment ownership, recovery and lifecycle receipts remain the explicit Task 3.4b scope. The helper neither canonicalizes keys nor grants filesystem authority. It intentionally has no global pending-request capacity limit and is not reentrant.

## Review evidence

Reviewed the implementation report, owned-file manifest, final queue implementation, new regression suite, and unchanged single-key regression suite against the previous queue source in the main checkout.

- Resource declarations are copied, bounded before deduplication, sorted deterministically and promoted to the strongest duplicate mode.
- Admission checks the full declaration before changing active state. Blocked requests hold no partial grants.
- Earlier blocked requests establish barriers only for conflicting read/write modes on their declared keys. Compatible readers and disjoint requests can proceed, while a waiting conflicting writer cannot be bypassed by later readers.
- Pending cancellation removes the exact request, detaches its listener, preserves the original reason and immediately reevaluates the queue. Active grants detach their cancellation listener and remain held until the callback promise settles, including abort before the callback microtask.
- Both synchronous throws and asynchronous rejections release the complete grant set. Empty state entries are removed. The single-key API shares the same namespace and retains its existing key and concurrency mapping.

## Independent verification

Native validation ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service` under the same Windows account and filesystem/process permissions as the main workspace; this was not an operating-system sandbox.

| Check | Result |
| --- | --- |
| `corepack pnpm exec vitest run packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/resource-queue.test.ts` | 2 files, 17 tests passed, exit 0; independently rerun at 04:25:28 local on September 15, 2026 |
| Additional inline Node stress check against the actual TypeScript queue | 100 deterministic rounds, 4,000 submissions, 3,147 started operations and 853 pending cancellations; exit 0 |
| Final file hashes | Both matched the implementation manifest exactly |

The additional stress check used mixed read/write declarations across eight resource keys, duplicate declarations, callback failures, pending cancellation and cancellation after admission. It asserted active mutual exclusion, no bypass of earlier pending conflicting requests, eventual progress after releasing callbacks, and empty active/pending internal collections after settlement. It executed from standard input and created no diagnostic files. An earlier stress run also passed but did not produce pending cancellations because of the pseudo-random selection method; the reported final run corrected that selection and asserted that cancellations occurred.

The implementer's MCP typecheck, lint and format results were read as supporting evidence and were not independently rerun for this review. No owned source/test files, Git index, browser, daemon, build output, dependency state, commits or remote refs were changed. No Superpowers skills, Docker or additional agents were used.

## Reviewed file hashes

Paths are relative to the isolated `service` directory. Digests are SHA-256 of reviewed final bytes.

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/execution/file-queue.ts` | `13ff4a2336b0c14e30461e33563b72fb97b0c2d49adce11077dafcfb102fdc78` |
| `packages/mcp/test/execution/resource-queue.test.ts` | `df4e9cee308ee7e932edfeb82b6b27912c94cf557f77e45f61b391a57cd0a09d` |
