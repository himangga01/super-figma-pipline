# Web portal verification round 2

Date: October 11, 2026, initial round results at 18:49-18:57 KST and final repair recheck at 18:58-18:59 KST (Asia/Seoul).

## Final round-2 disposition at 18:59 KST

**Round 2 is complete for its stated source/fixture scope. R2-1 and R2-2 are repaired and independently reverified.** The unchanged thirteen-probe adversarial script now passes **13/13**, and the expanded complete portal project passes **58/58**, both with zero failures and zero skips. No additional actionable defect was reproduced during the repair recheck. The original failing evidence remains below; root-owned round 3, integrated whole-source/artifact verification and real-source acceptance are separate obligations.

The coordinator synchronized exactly the implementation owner's two frozen repair files into main and native before this reviewer ran the recheck. Their hashes were checked before test execution and again after all tests/static checks:

| Repaired path | SHA-256 |
| --- | --- |
| `packages/portal/src/bridge.ts` | `15447d4c0a45cad7f2d16969e49415a57347fac4f3a66a06844334ae3712061e` |
| `packages/portal/test/backend.test.ts` | `a61f319354b17c378eecafa481045a6c07070efc6905c3ee5c85f44145af782e` |

At 18:59:40 KST, the independently recomputed full portal source/config/test digest was `sha256:0086f2d89615091e074ae6130eee9e8fdc149e0ce673b332697dca037ff7511f`, using the same definition as the initial package digest below. The private adversarial script stayed at SHA-256 `0969a3de9557f033e444555844120ebada00160cb9909893bc7928c3976b7d25` for the final red and green runs.

The repaired approval callback correlates the original abort-controller ownership, operation ID, pending prompt and awaiting-approval state, and refuses to change a retained unresolved operation. The resume gate independently checks the unresolved-operation record as well as public unknown status. The new tests demonstrate that approval and rejection responses cannot reopen mutating reconciliation, replace completed status, or overwrite a newer operation's own approval wait.

Pending starts now count toward the same four-operation limit as active work. A start transfers its reserved slot synchronously into the guarded launch, and actions on existing runs use that launch guard too. The independent probes confirm that the fifth parallel start/action is rejected and that failed workspace lookup, run persistence and pre-dispatch action persistence do not leak capacity. The source review checked that the transfer has no asynchronous gap between deleting the pending-start reservation and establishing the active slot.

Executed repaired-source evidence in native `.cache`:

| Evidence | Result |
| --- | --- |
| `portal-round-2-adversarial-green-20261011.tap` | All original and extended **13 probes passed**, zero failures/skips; Node test exit 0. |
| `portal-round-2-repaired-suite-20261011.json` | At 18:58:56 KST, **58 tests passed in four files**, zero failures/skips: 47 backend, nine frontend model/API and two service-owned installed-Chrome wrappers. |
| Direct package TypeScript, scoped lint and formatting checks | Passed after both test runs, using existing binaries without install/build. |

The suite command matches the initial command below except for the repaired JSON output filename. The private Node command and assertions are unchanged. Test data stayed in owned fixture directories and injected control calls. No actual daemon, source Chrome, Figma capture or filesystem application was used to prove these concurrency repairs.

This reviewer changed only private probes/evidence and this report. The implementation owner and coordinator made and integrated the production repair; this round's independent pass should be carried forward with these exact hashes. The remaining sections preserve the initial failed state and investigation.

## Scope and initial disposition

The owner explicitly requested three verification rounds focused on the integrated web portal and backend. This is round 2, an independent adversarial review and executed verification in `C:/2026_project/super-figma-pipline/.worktrees/baseline/service`. The coordinator owns round 1, production-build/real-server round 3, integration and the source Chrome/daemon. This round read the [earlier independent review](review.md), the current server/bridge/store/contract and tests, the [implementation plan](../../plans/2026-10-11-service-web-portal.md), shared analysis policy and [repository instructions](../../../AGENTS.md). No Superpowers skill was used.

**Initial disposition: repair required.** The full existing portal suite passed 48/48, but newly executed negative/concurrency probes found two defect classes. The first is P1: a delayed approval/rejection response can erase the public unknown state and enable mutating reconciliation despite a retained unresolved operation. The same race can overwrite completion. The second is P2: concurrent starts and actions can exceed the stated four-operation bound.

The first seven independent probes produced four passes and three failures. The extended twelve-probe run produced seven passes and five failures, adding a late-rejection case, the existing-run action-limit case and three admission-cleanup controls. A final thirteenth timing variant produced seven passes and six failures: a stale approval response also overwrites a newer operation's awaiting-approval status. These are the same two defect classes, not six unrelated bugs. Failures were reported immediately to the coordinator and assigned to the implementation owner. Earlier passing checkpoints do not cover these newly tested interleavings.

## Source baseline

The native validation copy has detached Git HEAD `6459363354f52940b4c67e399b9e735d7332d4dc` plus the coordinator's synchronized uncommitted source. The main published baseline remains separately recorded in the canonical report. The coordinator reported copying 35 reviewed paths with main/native whole-source fingerprint `2137324f...` before subsequent integration wiring. That historical prefix alone does not identify this test source.

At 18:54:06 KST, the portal-only source/config/test digest was independently computed as `sha256:f2afa1d4803e19a932b1d96273851cd7843d0b5c0728a6e1fe0c1b487cb5c835`. Definition: all files below `packages/portal` except `node_modules` and generated `dist`, sorted by slash-normalized relative path; SHA-256 over each UTF-8 relative name, NUL, exact bytes, NUL. This package digest avoids attributing concurrent README/provenance edits to a backend runtime change. The temporary `.cache` probes are outside that digest.

| File | Initial round SHA-256 |
| --- | --- |
| `src/bridge.ts` | `a1c768017da79f35b1e1411fc8487b03f365e56d770fcbf52ab4cefe1c54c717` |
| `src/store.ts` | `d0b48571e254c4fcf15d490bb59ed2878067ff57291b14edbe3195f6b572e21c` |
| `src/server.ts` | `ab10030f84c0bdf7fffac04cba98140157316b0aba5b9e8840b90f8a23382700` |
| `src/contract.ts` | `046b0335ef0c0a64f0ef5fc730cd6b00222524f702a520b87ebf373006a285bd` |
| `src/control.ts` | `1c946916f47c2fddb15f5423c8bb9057e9578832a42afb7235e3ba643f9906c2` |
| `test/backend.test.ts` | `f6fe9b4e0a03f9dc7f33de8c6e625a4d3991828b38f8ab454b32a2ad043d5574` |
| `package.json` | `b24e512457d928850cca601504e7fe5c4f9fe0f1d32ccd7d37b5145e4eca5fcb` |

The coordinator removed only an unused exported type from the contract and declared the already locked Playwright test dependency while this round was starting. Those changes do not alter the reviewed runtime failure paths. The source hashes above include those integration edits. The dependency install was performed by the coordinator before giving this reviewer the test-ready signal; this reviewer did not install or mutate dependencies.

## Executed baseline suite

From the native service directory at 18:49:53 KST:

```powershell
node node_modules/vitest/vitest.mjs run --project portal --no-cache --reporter=default --reporter=json --outputFile=.cache/portal-round-2-suite-20261011.json
```

Result: **48 passed, zero failed, zero skipped, four files**. This includes 37 backend cases, nine model/API cases and two required installed-Google-Chrome wrappers. The Chrome wrappers launch separate owned headless sessions, exercise real fresh loopback fixture servers and use injected control boundaries. They do not connect to the user's Figma Chrome or real daemon. The JSON report is retained at the exact native `.cache` path in the command.

Existing coverage already includes workflow graph validation, stale revisions, wrong run identities, source-evidence truthfulness, Host/Origin/CSRF/path guards, original-operation proof, unknown restart recovery, saved validation profiles, explicit approval identity, UI edits and approval selection. The round-2 additions exercise concurrency and post-await state changes absent from that suite.

## R2-1, P1: delayed approval responses bypass the unresolved-operation resume fence

Initial locations: `packages/portal/src/bridge.ts:299-305` and `:346-352`. Actual production control behavior was checked at `packages/cli/src/control-client.ts:187-197`.

The approval handler awaits `ControlClient.decide`, then unconditionally changes the retained run to `active`. The original service operation is independently monitored and may finish or fail before the approval HTTP response reaches this handler. The production ControlClient has a separate approval request and operation-monitoring flow, so this ordering is not forbidden by the integration contract.

Independent reproduction using the real bridge/store and a deferred injected control boundary:

1. Start a run in `ready-to-apply`. Request apply, emit its operation ID and valid approval prompt, and hold the apply result.
2. Request approval and hold the `decide` response.
3. Reject the original apply result with `CONTROL_AUTH_BUSY`. Wait until the bridge records `unknown` and its private unresolved-operation identity.
4. Resolve the delayed decision response. The handler changes the public run status to `active`.
5. Request `resume` with `reconcile: continue`. The guard checks only `run.status === 'unknown'`, so it misses the private unresolved-operation field and dispatches `portal_resume`.

Actual sanitized failure:

```text
Late approval changed status to active
Dispatched calls: portal_plan, portal_start, portal_apply, portal_resume
Expected rejection: RECONCILIATION_REQUIRED
Actual rejection: none
```

The later launch still carries the private fence, but preserving it after dispatch cannot undo a mutating reconciliation already sent to the service. The injected boundary does not perform filesystem effects; it proves that the guarded call can cross the web control boundary. A late rejection response reproduces the same bypass. A companion case lets apply return `completed` before the approval response and observes the same unconditional write change `completed` back to `active`. The final timing variant starts a new validation after the old apply settles but before its decision response arrives; the old response changes the new operation from `awaiting-approval` to `active`. Checking only whether any operation is active is therefore insufficient. The operation identity must match as well.

Required repair: condition approval-response state changes on the same still-active operation and eligible current state. Independently fence mutating resume whenever either public unknown status or retained unresolved-operation identity exists. Preserve current results and any new operation that began while the approval response was in flight. Approval/rejection transport success must not assert that its original operation is still running.

## R2-2, P2: the global operation bound is not reserved before asynchronous work

Initial locations: `packages/portal/src/bridge.ts:205-210` and `launch()` at `:370` onward.

`start()` checks `active.size` before awaiting workspace lookup, but its per-workflow `starting` set is not counted toward the global bound. Five different workflow starts, all held at that lookup, pass the initial check and all dispatch plans when released. Actual accepted count is **5**, expected **4**.

Actions on previously created runs do not check the global bound at all. A second fixture creates five idle ready-to-apply runs, then starts apply on all five and holds their results. All five are accepted. The capacity rule therefore needs a common reservation boundary for pending starts and active actions, with release on pre-dispatch workspace/persistence failure and normal/error settlement.

This is a resource-bound correctness defect in the portal, not a claim of bypassing the daemon's separate effect admission or an OS isolation boundary. The same-workflow concurrency fence already works: a simultaneous second start gets `RUN_BUSY`, and only one plan is dispatched.

## Additional probes and retained evidence

Private test source:

`service/.cache/portal-round-2-adversarial-20261011.mjs`

It imports the actual native TypeScript modules using the existing service source loader and creates real temporary stores and random-port HTTP servers under `.cache/portal-round-2-fixtures/`. Its deferred promises control only fixture workspaces, service responses and approval transport. It does not replace implementation files or call real service control endpoints.

Command:

```powershell
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs --test --test-reporter=tap .cache/portal-round-2-adversarial-20261011.mjs
```

Retained initial evidence:

| Evidence file in native `.cache` | Result |
| --- | --- |
| `portal-round-2-adversarial-red-20261011.tap` | Original seven probes: four passed, three failed. |
| `portal-round-2-adversarial-extended-red-20261011.tap` | Twelve probes: seven passed, five failed; Node test exit 1. |
| `portal-round-2-adversarial-final-red-20261011.tap` | Thirteen probes: seven passed, six failed; Node test exit 1. The added case covers a stale response after a newer operation begins. |

Passing additional controls verify:

- Simultaneous same-revision HTTP saves publish exactly one winner and one revision conflict; reopening the actual store preserves the winner.
- Hostile Origin/Fetch Metadata, non-JSON content type and an encoded route alias are rejected. Restarting the fixture rotates its mutation token, and the old token cannot mutate the new server.
- Same-workflow concurrent starts dispatch only one plan.
- Expired and foreign approval IDs never reach the control decision boundary.
- Workspace-lookup failure, run-creation persistence failure and action pre-dispatch persistence failure leave capacity available for four later operations. These cleanup controls must remain passing after adding shared reservations.

## Limits and continuation

This round modifies only private test/evidence files and this English report. No portal implementation, dependency, user Chrome, actual daemon, Figma source, native security approval or source capture was changed. The store/server/control fixtures execute under the Windows owner's privileges in the separate native working copy; they are not an OS sandbox. The previous real Figma source failure remains distinct from the local portal regressions and passing UI fixtures.

At the initial failing checkpoint, the implementation owner was assigned only `bridge.ts` and its persistent backend regression file in the managed portal checkout. The coordinator subsequently synchronized the exact frozen repair, and the final section above records the independently passing original/extended probes and complete portal suite. Every failing TAP file remains retained. Root-owned round 3 and integrated whole-source/artifact gates remain separate obligations.
