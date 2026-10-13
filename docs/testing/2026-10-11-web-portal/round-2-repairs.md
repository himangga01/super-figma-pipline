# Web portal round-two lifecycle repairs

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the backend implementation](backend.md), [the independent round-two verification](verification-round-2.md), [the web portal plan](../../plans/2026-10-11-service-web-portal.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns integration, three verification rounds, retained process changes and live acceptance. This task changed only `packages/portal/src/bridge.ts` and `packages/portal/test/backend.test.ts` in the managed `4d3e` service checkout, plus this report.

## Baseline and reproduced findings

The local web portal exposes real public-service workflow operations without a separate login. Its bridge preserves service operation identifiers, waits for explicit approvals and keeps mutations fenced when their original outcome is unknown. It also limits simultaneous bridge operations to four.

The coordinator and reviewer identified the integrated starting bridge at SHA-256 `a1c768017da79f35b1e1411fc8487b03f365e56d770fcbf52ab4cefe1c54c717`; the review record retains the initial package identity and failing evidence. The managed implementation directory was `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`, with authorized pre-existing portal work. Main and native service files were not edited by this task. A published Git baseline alone does not identify these uncommitted package changes.

The reviewer supplied the service-source reproduction script `.cache/portal-round-2-adversarial-20261011.mjs` in the native validation copy and its retained failing TAP output. Its extended matrix established two defect classes:

- A delayed approval or rejection response unconditionally wrote `status:'active'` after its original operation had already become unknown or completed. It could also overwrite a newer operation's approval-wait state. The resume guard checked only the public status string, so a retained private `unresolvedOperation` record could be bypassed after that status overwrite.
- Starts checked `active.size` before awaiting workspace lookup. Five different workflows could all pass that check before any launch registered an active operation. Actions on previously created runs also bypassed the global limit because `launch()` did not enforce it.

This task added six direct bridge regressions before changing production code. At **18:54:29 KST**, all six failed as expected: delayed approve/reject changed unknown to active, delayed approve/reject changed completed to active, five simultaneous starts were accepted, and five simultaneous actions were accepted. These were actual bridge/store results under controlled asynchronous service boundaries, not source-text assertions.

## Implemented behavior

Before submitting an approval decision, the bridge retains the active operation controller and prompt identity. After the service decision resolves, it changes state only if that same controller is still active, the current operation ID still matches the prompt, the run is still awaiting that same approval and no private unresolved-operation fence exists. The check runs inside the serialized store update against current state. A late response may be recorded as a submitted decision, but it cannot replace unknown/completed state, consume a newer operation's prompt or relabel the newer operation as active.

Mutating resume requires inspection whenever either the public status is unknown or the private unresolved-operation record remains present. The original operation pointer, correlated service journal/tombstone validation and authenticated resolution path are unchanged. A result snapshot or successful decision response is not evidence that an earlier uncertain mutation was resolved.

Capacity admission now counts both active operations and start reservations held across workspace lookup and run persistence. A start transfers its reservation synchronously into `launch()` before the first awaited launch write. `launch()` enforces the same four-slot limit for actions and rejects a duplicate active run. Existing `finally` and error paths release reservations or active slots on workspace failure, run-persistence failure, pre-dispatch launch failure and settled operations. Approval/rejection and cancellation of an already active operation control that existing operation; they do not allocate a second operation slot.

No automatic replay, new service credential access, new authentication mechanism, arbitrary operation dispatch, workflow-state fabrication or capacity increase was added.

## Executed verification

The final backend file includes ten new cases:

- Delayed approve and reject after an unknown mutation, retaining the original operation ID and private fence and refusing mutating resume. The test additionally verifies that the durable fence wins if the public status is stale.
- Delayed approve and reject after completed results.
- A delayed old decision after a new operation begins waiting for its own approval.
- Five concurrent starts held at workspace lookup, and five concurrent actions on ready runs, each admitting exactly four and returning `RUN_LIMIT` for the fifth.
- Capacity recovery after workspace lookup failure, run-persistence failure and pre-dispatch launch-update failure, each allowing four later operations while still rejecting a fifth.

| Start time, KST | Check | Result |
| --- | --- | --- |
| 18:54:29 | Six new approval/capacity regressions against old bridge | Six failed for the reproduced defects; 37 unrelated cases filtered. |
| 18:55:16 | Same six regressions after repair | Six passed; 37 unrelated cases filtered. |
| 18:56:37 | Expanded complete backend test file | 47 passed, zero failed, zero skipped. |
| 18:57:09 | Final complete backend test file after a test-only lint correction | 47 passed, zero failed, zero skipped. |
| Final source | Portal TypeScript check, scoped lint and formatting | All exited successfully. |

An intermediate lint check reported a shadowed callback variable in a test cleanup loop. Renaming that callback parameter removed the warning; the full backend file was then rerun. No test or production limit was relaxed.

Commands used direct installed binaries with native Vitest config loading and no cache. No package-manager automatic installation was invoked.

```text
# From the managed service/packages/portal directory:
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache test/backend.test.ts

# From the managed service directory:
node node_modules/typescript/lib/tsc.js --noEmit -p packages/portal/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
node node_modules/oxfmt/bin/oxfmt --check packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
```

The tests execute the actual bridge and durable store with controlled service-port responses. They prove the exercised lifecycle and admission boundaries, not live daemon, Chrome, generation or application acceptance. This task did not run the full source suite, build/install dependencies, use Superpowers, operate source Chrome, restart the portal or daemon, modify main/native service code, change provenance/index state or commit. The managed checkout runs under the Windows owner account and is not an OS sandbox.

## Frozen handoff

Frozen after tests and static checks at **18:57:37 KST**. Paths are relative to managed `service`. Slice SHA-256 is `fe6f98fc45985ccc8c68d4c5d88135bcba375773957b5df46d6b819e49c234d3`, computed over JSON of the ordered `{path,sha256}` records below without hash prefixes.

| Path | SHA-256 |
| --- | --- |
| `packages/portal/src/bridge.ts` | `15447d4c0a45cad7f2d16969e49415a57347fac4f3a66a06844334ae3712061e` |
| `packages/portal/test/backend.test.ts` | `a61f319354b17c378eecafa481045a6c07070efc6905c3ee5c85f44145af782e` |

The independent reviewer received these hashes and the quiet recheck window for the latest 13-probe adversarial matrix. Independent final verification and the coordinator's integration/restart gates remain separate evidence. No new product choice is required to complete this bounded repair.
