# Independent review of canonical No-Core inspection

Date: October 14, 2026 (Asia/Seoul). Review only; no implementation, test rerun, daemon request, Chrome action, integration, deployment or historical recovery was performed. Read [AGENTS](../../../AGENTS.md), [the preceding recovery review](no-core-plan-recovery-review-20261013.md) and [canonical recovery analysis](../../analysis/portal-local-capture-recovery.md) first.

## Exact scope and conclusion

No blocking finding was identified in the frozen two-file delta. Approval applies to the reviewed source change and preserves the separate integration, deployment and actual authenticated recovery gates.

Baseline native source is `sha256:6f87f836d872a4ba8ab49533f6447a7c921adb6b8af3dae75ddd6241e8b8a1cb`. Frozen manifest `.worktrees/_cache/no-core-public-inspection-20261014/freeze/frozen-files.json` is `5f0b524767e23929148ac990b1d1773a02617e9cd161ae56f7f0fd8b15da2194`. Independent reads reverified both final hashes:

| File | Final SHA-256 |
| --- | --- |
| `packages/portal/src/bridge.ts` | `23eaae954eb16bb4bff335b6a3c82f5fbc2c3bd142eab8d01ca0b42c03c88ace` |
| `packages/portal/test/backend.test.ts` | `e1e8a5ec7968ac3ab4c4edba27dfceb0262d6554a5c4493755f984667015ff3a` |

The bridge expands authenticated inspection from a full `OperationRecordSchema` record to the strict union with the actual canonical `OperationTombstoneSchema`. It requires the original operation ID, the retained workspace, tool kind, `portal_plan`, `pre-egress-rejected`, a valid settlement timestamp, null result hash and null operation receipt. A tombstone must remain unexpired at the store callback. Generic terminal statuses, missing metadata, foreign operations/workspaces and expired proof remain unknown and fenced.

## Verified authority and producer behavior

- `packages/portal/src/control.ts` obtains evidence through authenticated `GET /control/operations/<exact-original-id>`; it does not accept proof in a refresh request. `packages/mcp/src/control/operation-endpoints.ts` returns only the current principal actor's journal record/tombstone. A later authentication session can inspect the same actor's original operation without creating cancellation or replay authority.
- `packages/shared/src/operations.ts` uses strict canonical objects, binds origin authentication metadata and requires the tombstone horizon to equal original `issuedAt + 2,592,000,000`. Missing required fingerprint/args/capture/workspace/result/receipt fields cannot be replaced by schema defaults. Optional settlement is additionally required by this classifier.
- `packages/mcp/src/execution/operation-journal.ts` permits `pending-approval` to reach `pre-egress-rejected`, but a dispatched operation cannot acquire that status. Demotion explicitly restricts dispatched outcomes to succeeded, failed or unknown. Initial pre-egress rejection and executor rejection occur before runtime dispatch. The canonical compaction preserves original identity, status, hashes and settlement rather than inventing a replacement proof DTO.
- The original-run signal, close state, active inspection identity, unknown status, missing Core ID, retained operation identity/name and workspace are rechecked in `store.updateRun`. The tombstone expiry comparison occurs after those checks inside the same mutation callback. The disposition event, classification and unresolved-fence removal remain one durable update, preserving R2's repaired atomicity.
- The implementation neither renews the original operation horizon nor invokes the rejected original plan. It clears only this bridge's proven original-plan fence. Other unknown jobs, physical producer uncertainty and separate local-composite recovery are unchanged.

## Evidence and limits

The writer's retained receipt reports two new targeted cases passed, 12 negative variants, 71 filtered, and successful lint/format checks of the two files. It records formatting after tests and no repetition of the four closed prior recovery tests. This independent review inspected their exact source and receipt but did not repeat them or convert their fixtures into actual historical recovery evidence.

The changed cases cover canonical tombstone acceptance, absence of full-record defaults, durable reopening, no replay, and foreign/generic/sparse/expired rejection. The existing abort/close/atomic-store tests remain dated evidence; their guarded code remains unchanged except that the safe-proof classifier now executes inside the mutation callback. No new executable acceptance, full-suite pass or live producer observation is claimed.

Root should integrate only these exact frozen files after the active source-6f CDD run reaches its chosen safe boundary, then perform the authorized actual inspection through the authenticated service path. A canonical terminal pre-egress tombstone establishes this original operation's pre-dispatch outcome. It does not prove cleanup of unrelated Chrome producers, resolve a separate unknown operation, establish current capture or replace any required manual native browser security approval.
