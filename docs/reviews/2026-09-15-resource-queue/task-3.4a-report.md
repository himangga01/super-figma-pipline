# Task 3.4a implementation report

## Scope and outcome

Implemented the in-memory multi-resource queue foundation in the isolated native working copy at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915`. Only the two owned source/test paths below were edited. The existing single-key test file remains unchanged.

This completes the bounded queue subtask only. Canonical resource discovery, execution authority, operation-executor cancellation integration, durable claims, environment ownership, recovery and lifecycle receipts remain separate Task 3.4 work. No browser, daemon, build output, dependency, Git index, commit or push state was changed.

## API and behavior

The exported `FileExecutionResource` interface contains `readonly key: string` and `readonly mode: 'read' | 'write'`. The new method is:

```ts
runResources<T>(
  resources: readonly FileExecutionResource[],
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T>
```

- Accepts 1 through 64 raw resource entries, before deduplication. Each key must be a nonempty string of at most 1024 UTF-16 code units. Invalid declarations reject the returned promise before reserving resources.
- Copies the declarations, promotes duplicate keys to their strongest mode and sorts them using deterministic code-unit comparison. Keys are already canonical caller inputs; the queue does not normalize paths, case, Unicode or whitespace and does not grant filesystem permissions.
- Acquires the complete resource set atomically. A waiting request holds no active grants. Requests blocked by existing activity become fairness barriers only for later requests that conflict with their declared keys/modes. Compatible reads and independent resources continue to progress. A waiting writer cannot be bypassed by later conflicting readers.
- Cancellation rejects and removes pending work promptly using the original `AbortSignal.reason`, detaches the listener and reevaluates remaining waiters. Pre-aborted submissions never run. Once granted, the listener is detached and abort does not release resources, even before the callback microtask starts. Running work retains the complete set until its actual promise settles.
- Synchronous throws and asynchronous rejections release all held resources before settling the returned promise. Empty resource states are removed.
- The existing `run(key, concurrency, operation)` API uses the same lock namespace and preserves its null-target and concurrency mapping. Its historical key acceptance is preserved; new resource declaration limits apply to `runResources`.
- No global pending capacity limit was introduced. Existing independent status/control lanes continue to progress. Per-resource declarations are bounded, but queue memory and admission rate are not newly capped. Any future capacity rule must account for control availability.
- Callers must declare their complete resource set in one call. The implementation does not acquire nested locks; the API is not reentrant, and callers must not wait on a nested acquisition of their held resource.

## Verification

The new regression suite was run before implementation: all 11 new tests failed because `runResources` did not exist. After implementation and lint corrections, fresh final checks passed:

| Check | Result |
| --- | --- |
| `corepack pnpm exec vitest run packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/resource-queue.test.ts` | 2 files, 17 tests passed, exit 0 |
| `corepack pnpm exec tsc --noEmit -p packages/mcp/tsconfig.json` | Full MCP typecheck passed, exit 0 |
| `corepack pnpm exec oxlint --deny-warnings packages/mcp/src/execution/file-queue.ts packages/mcp/test/execution/resource-queue.test.ts` | Passed, exit 0 |
| `corepack pnpm exec oxfmt --check packages/mcp/src/execution/file-queue.ts packages/mcp/test/execution/resource-queue.test.ts` | Passed, exit 0 |

The final test run began at 04:22:52 local on September 15, 2026. Coverage includes opposite resource order, duplicate mixed modes, shared single-key/multi-key locks, concurrent reads, conflicting FIFO fairness, independent progress, pending cancellation removing its fairness barrier, pre-aborted reasons, abort after grant, synchronous/asynchronous failures, resource reuse, caller declaration mutation, raw entry/key/mode bounds and cancellation-listener removal. Existing status/control, null-target, read/write and synchronous failure regressions all passed unchanged.

Validation ran with the native toolchain in a separate working copy under the same Windows account and filesystem/process permissions. It did not provide an operating-system sandbox. No Docker or Superpowers skills were used for this subtask.

## Exact owned files

Paths are relative to the isolated `service` directory. Hashes are SHA-256 of final file bytes.

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/execution/file-queue.ts` | `13ff4a2336b0c14e30461e33563b72fb97b0c2d49adce11077dafcfb102fdc78` |
| `packages/mcp/test/execution/resource-queue.test.ts` | `df4e9cee308ee7e932edfeb82b6b27912c94cf557f77e45f61b391a57cd0a09d` |

The source is frozen for main-session review and exact-byte integration. No task completion claim extends to the remaining Task 3.4 caller or durable lifecycle implementation.
