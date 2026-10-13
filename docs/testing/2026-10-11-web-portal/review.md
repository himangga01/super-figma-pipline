# Independent web portal review

Review date: October 11, 2026, initially 17:32 KST; latest independent delta recheck at 18:24-18:25 KST (Asia/Seoul).

## Source evidence and approval UI delta recheck at 18:25 KST

**The latest reviewed delta has no remaining actionable finding in this bounded scope. R1-R7 remain closed, and the coordinator's subsequently observed false source-completion display is repaired.** This is source/fixture acceptance of the mapper and approval interface, not successful live Figma acquisition or final service acceptance.

The coordinator's actual R2 run had recorded `FIGMA_TAB_NOT_FOUND`, `context.design.complete:false`, `liveVerified:false`, and missing-design issues while its source node was completed. The reviewer read the retained private R2 JSON and extracted only those nonsecret evidence fields into an independent injected-control probe. On the repaired source it produces source `failed` with message `FIGMA_TAB_NOT_FOUND`, requirements `waiting`, and generation `pending`. No actual capture was retried in this review, and no fixture result replaces the historical failed acquisition.

The new mapper derives source completion from the retained plan or `portal_next` blueprint. It requires complete design evidence and, for the selected `require-live` policy, recorded live verification. Missing-design issues prevent completion even when boolean flags conflict. Independent additional cases verified that contradictory complete/live flags plus missing-design evidence stay waiting, while complete live capture with only unresolved business requirements keeps the source completed and requirements waiting. The six new backend regressions also cover unverified live data, explicitly allowed pinned capture, incomplete live-verified data and blueprint replacement. The original operation-fence and proof-order probes were repeated unchanged and still passed.

The approval UI now obtains selectable requests from the current run's retained prompts, filters by current operation and expiry, and rechecks those conditions immediately before submitting. A single valid prompt is selected automatically; multiple prompts expose a target-label selector. Target, operation, effects and expiry are escaped for display. The explicit approve/reject button sends only the selected retained approval ID; it does not accept a typed ID or decide automatically. The backend independently validates the current operation, request identity and expiry. Polling while the dialog is open can update run state, so the submission-time check also rejects a selection invalidated since the dialog opened.

The reviewer independently executed the expanded project suite:

```powershell
node node_modules/vitest/vitest.mjs run --project portal --no-cache
```

Result at 18:24:25 KST: **48/48 tests passed in four files, zero failures and zero skips**. The total includes 37 backend tests, nine frontend model/API tests and two required service-owned installed-Google-Chrome wrapper cases. Unlike the earlier read-only browser-evidence checks, this delta review directly ran those authorized service-owned fixture wrappers. They bind fresh random loopback ports, use real `PortalServer`/`PortalStore`/`PortalBridge` instances with injected unavailable/deferred control boundaries, and launch separate owned headless Chrome sessions. One repeats the eleven editing/save/viewport checks and independently reopens persisted data; the other verifies selection of the second live approval and rejection of the remaining single approval through actual HTTP. Both inspect browser errors and clean up only verified owned temporary directories. No user Figma session, actual daemon, native Chrome security approval or external Codex browser tool was used.

Package TypeScript, scoped lint and formatting checks passed with direct installed binaries after the suite. The independent temporary `delta-recheck.mjs` reran the prior mutation/result/proof/restart matrix and added the three source-evidence probes above. No source, configuration or dependency was edited by this reviewer.

Hashes verified after all checks:

| File | SHA-256 |
| --- | --- |
| `src/bridge.ts` | `a1c768017da79f35b1e1411fc8487b03f365e56d770fcbf52ab4cefe1c54c717` |
| `test/backend.test.ts` | `f6fe9b4e0a03f9dc7f33de8c6e625a4d3991828b38f8ab454b32a2ad043d5574` |
| `web/app.js` | `dc75a442c0e3d6958b4d7f9cc26e92c1b2298b218b2f9f0cef93bf7ea5f72b92` |
| `web/model.js` | `baa72ccd8395298036c5964e51e5599e36724d588b8f4bf47c1de75825f8790c` |
| `test/browser.test.ts` | `efacd4e44cb8faaab9f9baf233b1fee3c7dbf571fc320191e51187264ba5bae3` |
| `web/tests/approval-check.mjs` | `2f75f89e31a4678571a20da37d133060e2978271be2ef3e6af882dfe23465f3f` |
| `web/tests/chrome-check.mjs` | `178ea8fdca270183f629f6ed2ebecb018649cd4094c950a46896f80e95ca1092` |
| `vitest.config.ts` | `27d74ae348da3ae449598449bc001b68b9c414146148af43b325ea213feb6c5c` |
| `package.json` | `6ec19febbe036e91364350dca4359170fd25333c6aa25475294674f4d2cf4100` |

The independently computed backend/config/test digest is now `sha256:b08f25d746ac7dba0e31b50868c9931ae0076bcbc7c60d5127bbc73343b025a6`. It uses the previously documented sorted names/bytes plus NUL definition and now includes the added browser wrapper in `test/`. It excludes `web/`, generated output and dependencies; it is not the integrated whole-service fingerprint. The preceding `dfc280a1...` checkpoint remains historical.

The coordinator must integrate this exact source, register the required Chrome cases/provenance in the root gates, restart the latest production backend, and complete the source/artifact checks. The retained port 4310 process predates the mapper repair and was not used as its proof here. A failed live capture caused by the separate stale-tab problem remains failed until the coordinator restores and verifies the real service path. Existing CDD, eCommerce and official-MCP obligations remain distinct.

## Final independent disposition at 17:57 KST

**R1-R7 are closed in the reviewed frozen source. No additional actionable defect was reproduced in this bounded final recheck.** This permits the coordinator to proceed with integration and the remaining acceptance steps; it does not establish actual daemon, Figma, generation, application, whole-source or artifact acceptance.

The final backend scope digest was independently recomputed after the read-only verification commands as `sha256:dfc280a1b464e2f80d9f6842c858c5b3bc9f66a21a0ae1c9cbffa244d13a36ca`. It matches the implementer's final freeze. The reviewed source remains in the separate managed checkout at the same published Git HEAD; no source file or dependency was modified by this reviewer.

The R6 repair retains private unresolved-operation identity and correlates a full authenticated service journal record or tombstone before obtaining a fresh run status. Inspection is a fixed internal read of the retained ID; the browser cannot supply an arbitrary operation ID or control route. The existing service operation endpoint verifies the principal and returns the record/tombstone directly, matching the adapter's parser. The reviewer inspected this code path but did not invoke it against a real daemon.

The original independent R6 reproduction now returns:

```json
{
  "before": { "status": "unknown", "operationId": "unresolved-apply" },
  "after": {
    "status": "unknown",
    "operationId": "unresolved-apply",
    "applyEnabled": false
  }
}
```

Final executed checks:

- The original four backend probes and the successful-status escape probe all show their corrected outcomes.
- All six issued-mutation error probes (`next`, `submit`, `validate`, `apply`, `resume`, `cancel`) remain unknown. Workspace/run binding, `approve: false` and saved validation profile assertions pass.
- Mismatched run identity, invalid state, oversized result and a foreign terminal event preserve unknown and keep apply disabled.
- An additional independent proof-order probe records `inspect:unresolved-apply`, then `portal_status`. A failed fresh read after valid proof preserves unknown and the original ID. A later valid proof followed by a completed fresh read resolves the fence.
- An independent interrupted-inspection snapshot probe preserves the original mutation through an in-flight status-read ID, a queued terminal status-read event, and reopening/recovery of the persisted snapshot. The final result event is recorded after the queued event; recovered and unresolved settled runs retain `unresolved-apply` and unknown status. This tests queued events emitted during the invocation. It does not claim coverage of arbitrary callbacks emitted after a control implementation has already settled; the inspected production ControlClient has no such callback path.
- `node node_modules/vitest/vitest.mjs run --project portal --no-cache`: **31/31 passed** at 17:56 KST. This includes missing/pending/foreign/malformed/unknown/abandoned proof, explicit reconciliation limits, restart and valid terminal-proof cases.
- `node --test packages/portal/web/tests/model.test.mjs packages/portal/web/tests/api.test.mjs`: **8/8 passed**.
- Package TypeScript, scoped source/test/frontend lint and scoped formatting checks passed using installed direct binaries. No install, build or whole check was performed by this reviewer.

The temporary script `final-recheck.mjs` extends the earlier scripts in the same reviewer-owned temporary directory. The source and test hashes below were read after these commands:

| File | SHA-256 |
| --- | --- |
| `src/bridge.ts` | `c6f04e148490155037c8b8fb793b611f5838e9d26ee8f9f8438c7664aab77bec` |
| `src/contract.ts` | `c9cd78dc0907fd74062d4184009c9529f6409cb16ae1092d5e7fe97e586afc94` |
| `src/control.ts` | `1c946916f47c2fddb15f5423c8bb9057e9578832a42afb7235e3ba643f9906c2` |
| `src/store.ts` | `d0b48571e254c4fcf15d490bb59ed2878067ff57291b14edbe3195f6b572e21c` |
| `test/backend.test.ts` | `75b591bbe030a375842f6f1adad7e268df97438b9a09ea9565ef0b4e8084e7c9` |
| `web/app.js` | `1b96504de7cde73186c11171d38aee466cc5659ae6f61f0c46222acbe764147a` |
| `web/model.js` | `e378de6c98f5545309ab7f82c284d305e8fa50260a9db4ef7d8669ef13c7942b` |
| `web/tests/chrome-check.mjs` | `178ea8fdca270183f629f6ed2ebecb018649cd4094c950a46896f80e95ca1092` |

For R7, the reviewer verified the early busy return in `zoom()`, checked the frozen app/test hashes against the frontend repair record, and read `portal-qa-wheel-green-20261011/result.json`. The frontend worker's authorized service-owned installed-Chrome run reports **11 checks and zero page errors**, including the real Ctrl+wheel gesture during a manually gated HTTP save, after its recorded failing run. The earlier text/JSON checks remain present. This reviewer did not operate Chrome. Port 4311 still hosted the older backend process, so that frontend evidence must not be described as acceptance of the final repaired backend build.

The coordinator's remaining work is to integrate the frozen package, restart the latest production server with owned test storage, rerun integrated Chrome checks, exercise the genuine daemon bridge when authorized runtime conditions permit, and complete the integrated source/artifact gates. Preserve CDD-before-eCommerce acceptance and the separate official-MCP path. The historical dispositions below explain the repairs and are superseded by this final section.

## Independent repair recheck at 17:45-17:48 KST

**Disposition at that checkpoint: the original R1-R5 reproductions were repaired, but R6 below remained a P1 blocker.** A smaller remaining frontend save-lock omission was R7. These findings and evidence are retained as history; the final section above supersedes their open status.

The backend scope digest was independently recomputed as `sha256:d10f548c8c8f53bff72998daa165c5fb92ee47b6b1ec5c3a9c923913cc6e00eb`, matching the implementer's freeze. The repeated temporary backend probes now observe unknown plus disabled apply for R1, retained `unknown-start` operation identity for R2, an unknown interrupted generation node for R3, and waiting applied validation for R4. A fresh no-cache backend run passed **16/16**, and a fresh frontend model/API run passed **8/8**.

An additional injected-control matrix exercised `next`, `submit`, `validate`, `apply`, `resume` and `cancel` after issued `CONTROL_AUTH_BUSY` errors. All six preserve unknown status and disable next/submit/validate/apply. The probes assert route-bound service run ID, original workspace, `approve: false`, and the saved `owner-reviewed` validation profile. Separate mismatched run ID, invalid state, oversized result and foreign terminal-operation event cases all retain unknown and keep apply disabled. These probes use the same private temporary directory as the initial review, with `recheck.mjs`; no daemon or browser was involved.

R5's source fix now commits ordinary text fields on input and retains structured JSON as a raw draft until it parses. Save/check/start cannot silently submit a prior plan while that draft is invalid. The reviewer read the coordinator's real `portal-qa-green-20261011/result.json`: **10 checks, zero browser errors**, including a gated real HTTP save, Ctrl+S without blur, and invalid JSON preservation/no-request/correction. This is coordinator-executed installed-Chrome evidence, not a reviewer browser run. It used port 4311 with the intentionally unavailable daemon, and its explicit capture/generation/application flags are false.

Rechecked file hashes before further R6/R7 repairs:

| File | SHA-256 |
| --- | --- |
| `src/bridge.ts` | `ce135a20fd1b096ea214eed6f9a07f773a9a7ec13e6fc40b0abd7a20dac5ac7a` |
| `src/store.ts` | `45452f6c7462ed8ce3175d9b10249e0ab39762c041f2315f7670237d6005746d` |
| `test/backend.test.ts` | `65137ef373d66d76e65e88a7f052e9da6b027ff85e92f434383a220410a1cb7b` |
| `web/app.js` | `ce63d6bd00dba41c3e0f7a92b8b616a1341fa979e0a9699451e30444f3fbbdac` |
| `web/model.js` | `e378de6c98f5545309ab7f82c284d305e8fa50260a9db4ef7d8669ef13c7942b` |
| `web/tests/chrome-check.mjs` | `b19c06f7160138e60ca9d6deea811d4d4ce1217b601b7935c477c4c17cd69fbe` |

### R6, P1: a successful status snapshot still clears an unresolved mutation

**Location:** repaired `src/bridge.ts:349-354` and `src/bridge.ts:490-504`; actual service status semantics are in `packages/mcp/src/portal/coordinator.ts:468-474`.

The new unresolved-operation restoration runs only when the post-call run status is still unknown. However, `portal_status` returns the run snapshot and does not establish the terminal disposition of a previously dispatched operation. A pending or delayed original operation can coexist with its prior run state. Applying that snapshot can therefore reopen mutation controls and replace the unresolved operation ID with the status read's ID.

Independent reproduction:

1. Begin in `ready-to-apply`.
2. Make `portal_apply` emit operation `unresolved-apply`, then fail monitoring with `CONTROL_AUTH_BUSY`.
3. Confirm the fixed bridge now retains unknown.
4. Explicitly refresh. Let `portal_status` emit operation `status-read` and return the existing `ready-to-apply` snapshot, without any terminal evidence for `unresolved-apply`.

Actual result:

```json
{
  "before": { "status": "unknown", "operationId": "unresolved-apply" },
  "after": {
    "status": "awaiting-input",
    "operationId": "status-read",
    "applyEnabled": true
  }
}
```

Keep the unresolved operation fence and identity until correlated original-operation evidence or the authorized reconciliation path resolves it. A successful read of the last run state alone must not discard that fence. The fixture establishes the adapter bug; the source confirms the status endpoint lacks the required operation-disposition proof. No live unknown operation was created.

### R7, P3: Ctrl+wheel can still edit the viewport during save

**Location:** `web/app.js:467-475` and `zoom()` immediately below it.

The new save lock disables controls and guards pointer/key node mutation. The canvas wheel listener still calls `zoom()` without a busy guard, and `zoom()` updates the saved builder viewport and dirty flag. Ctrl+wheel while the HTTP save is pending can therefore change the local viewport before the save response replaces it and clears dirty state. This is a source-confirmed, narrow viewport-loss path; the reviewer did not run Chrome for it. Add a busy guard and include the wheel gesture in the existing delayed-save Chrome check. It does not invalidate the separately verified text/JSON repair.

## Scope, source and disposition

This bounded review covers the new login-free service web portal in the managed checkout at `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service/packages/portal`. The checkout is detached at published Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` and contains synchronized, uncommitted continuation changes. The entire portal package is untracked. Existing unrelated changes were preserved.

The review read the [repository instructions](../../../AGENTS.md), the shared analysis policy, the [canonical service analysis](../../service-analysis.md), the [web portal plan](../../plans/2026-10-11-service-web-portal.md), and the [backend](backend.md) and [frontend](frontend.md) implementation reports. This is supplemental review evidence. The canonical service report remains the common handoff authority.

**Initial disposition at 17:32: repairs and a focused recheck were required before integration or real-daemon portal acceptance.** One P1 uncertainty-fence defect and three P2 backend state/evidence defects were reproduced. A P2 frontend editor-loss defect was identified in source and confirmed by the frontend implementer; its browser regression and repair were in progress when the coordinator requested that this bounded review finish and release its agent slot. The final section above records their later repaired-source recheck.

The coordinator reported the previous main/native whole pass at source `1a5d6b0f...`, with 4,997 passing cases, zero failures, 20 skips, 57 Chrome cases and a separate artifact check. Those results predate portal integration and are historical context, not verification of this package.

## Purpose and implemented structure

The portal supplies a loopback HTTP server, a same-origin workflow editor and an execution map over the existing public service. `server.ts` owns the closed JSON/static routes; `contract.ts` validates workflow inputs and executable topology; `store.ts` persists revisions, immutable run graphs and bounded events; `bridge.ts` translates explicit actions into the existing public portal tools. `control.ts` resolves the public CLI package and keeps `ControlClient` authority server-side. The frontend edits real workflow configuration and reads retained run state rather than invoking an independent generator.

The inspected implementation includes exact local Host checks, matching Origin and Fetch Metadata checks, a server-issued integrity token for POST/PUT, JSON content-type and body limits, strict API routing, root-level static paths with real-path containment, revision checks, a fixed tool-action mapping, route-bound service run IDs, operation-bound approvals, and `approve: false` on service invocation. Dynamic display text is escaped before the inspected `innerHTML` assignments. No arbitrary shell, filesystem, HTTP or service-tool proxy endpoint was found in this scope. These are source and bounded-fixture observations, not a claim of complete security assurance.

## Findings

### R1, P1: post-dispatch monitoring failures can reopen a mutation

**Location:** `src/bridge.ts:344-358`, with action availability at `src/bridge.ts:93-122`. Relevant service behavior is in `packages/cli/src/control-client.ts:312-338`.

The bridge determines uncertain outcomes using a short error-code allowlist. `CONTROL_AUTH_BUSY` is absent. The real ControlClient can throw that code after a dispatched tool has exceeded its monitoring grace period. It requests cancellation on that path, but cancellation is best effort and does not establish that the original mutation had no effect.

Reproduction used a temporary `PortalStore` and an injected `ControlPort`:

1. Return a valid plan ID from `portal_plan` and `ready-to-apply` from `portal_start`.
2. For `portal_apply`, emit `{ status: 'accepted-locally', operationId: 'own-apply' }`.
3. Reject with `{ code: 'CONTROL_AUTH_BUSY', status: 503 }`.
4. Wait for the bridge operation to settle and inspect the run.

Actual sanitized result:

```json
{
  "status": "failed",
  "operationId": "own-apply",
  "errorCode": "CONTROL_AUTH_BUSY",
  "applyEnabled": true
}
```

The old `ready-to-apply` result continues to enable `apply`. An explicit click can therefore dispatch another mutation while the earlier outcome is unresolved. Existing daemon fences remain relevant, but the portal must preserve its own unknown-outcome promise. Repair should conservatively retain unknown after dispatch unless authoritative operation evidence proves a terminal or pre-effect outcome. A transport/error-code classification alone cannot prove no effect. Cover this real monitoring-error shape and malformed/oversized post-effect response handling in the regression.

### R2, P2: failed status reads replace the unresolved operation pointer

**Location:** `src/bridge.ts:386-388` and the error update at `src/bridge.ts:343-364`.

Every invocation sets `operationId` to null before contacting the service, including a status read on an unknown run. If that read fails before emitting a new operation ID, the existing status fence remains unknown but the pointer used to inspect the unresolved operation disappears.

Reproduction started with `outcome-unknown` and operation ID `unknown-start`, then made explicit `refresh` reject with `CONTROL_NOT_READY` before emitting progress. Actual output:

```json
{
  "before": { "status": "unknown", "operationId": "unknown-start" },
  "after": { "status": "unknown", "operationId": null }
}
```

Earlier bounded events still contain historical IDs; the failure does not erase every record. It does erase the run's primary unresolved-operation pointer, and successful progress from a new read can replace that pointer with the read's own ID as well. Preserve the unresolved mutation identity separately from current monitoring work, including across restart and failed refresh.

### R3, P2: restart recovery leaves interrupted nodes running

**Location:** `src/store.ts:161-176`, `recoverInterrupted()`.

Recovery changes interrupted run status to `unknown` but leaves the per-node state unchanged. A temporary stored run with an active generation node was reopened and recovered. The resulting run was unknown while its generation node remained active. The frontend execution map consumes these node statuses directly, so it continues to show execution after the owning web process has stopped.

Convert interrupted active/waiting node states to an unknown state with a recovery explanation. Preserve completed nodes and the exact saved graph/revision. The existing restart test asserts only the overall status and graph retention, so it passes without exercising this mismatch.

### R4, P2: applied validation is shown as completed while still pending

**Location:** `src/bridge.ts:496-518`, specifically the `applied-awaiting-validation` and `validating-applied` mapping.

An authoritative `applied-awaiting-validation` service response produced the following map in the temporary fixture:

```json
[
  { "type": "source", "status": "completed" },
  { "type": "requirements", "status": "completed" },
  { "type": "generation", "status": "completed" },
  { "type": "validation", "status": "completed" },
  { "type": "output", "status": "waiting" }
]
```

The validation node is documented and presented as covering both candidate and applied-result validation. The mapper marks it complete while applied validation is still outstanding; `validating-applied` uses the same completed validation state and marks the output node active. Represent the currently required validation stage as waiting or active until its actual acceptance result is recorded. Keep candidate acceptance distinct from final applied acceptance.

### R5, P2: focused editor text is lost on keyboard save

**Location at initial inspection:** `web/app.js:849-850`, `web/app.js:870-873`, and `busy()` / `save()`.

Configuration text is committed to workflow state only on `change`. Pressing Ctrl+S while an input or textarea still has focus invokes `busy(save)`, whose immediate `render()` removes that editor before its pending value is committed. `save()` then serializes the previous state. Malformed requirements JSON also needs preservation and must block saving the prior value as if the current editor contents succeeded.

The frontend implementer independently confirmed the source path and was adding an installed-Chrome regression that types a node label and presses Ctrl+S without blurring, then reads the actual saved workflow. The proposed repair flushes focused fields before actions, preserves invalid JSON drafts, and prevents in-flight editor changes from being overwritten by a save response. This reviewer did not execute that Chrome regression. The coordinator owns browser verification and should retain the failing and passing evidence.

The coordinator's previously identified event-filter mismatch and in-flight save/edit race were already being repaired by the frontend worker. They are not reported here as independently verified new findings.

## Executed checks and evidence

Executed from the managed `service` directory:

```powershell
node node_modules/vitest/vitest.mjs run --project portal --no-cache
```

Result at 17:31 KST: **one test file and 11 tests passed**, zero failures. This suite exercises temporary persistence and genuine random-port HTTP fixtures with an injected service boundary. It covers Host/Origin/CSRF, traversal rejection, unsafe paths, closed routes, revision and graph constraints, service absence, approval identity, run identity, and some unknown/restart cases. Passing it did not refute R1-R4; their missing assertions are described above.

The four backend probes ran from the reviewer-owned temporary directory `C:/Users/강지혜/AppData/Local/Temp/sfp-portal-review-3708c96d153c4923adecfacdfe4d372f`. `probe.mjs` transpiled portal modules into that temporary directory using the existing TypeScript package and read the managed shared schemas. It used temporary stores and an injected `ControlPort`; it did not connect to any daemon. The first probe launch failed during native TS module resolution before exercising the application. A temporary module loader then resolved source `.js` specifiers to their `.ts` inputs, and the repeated launch produced the four results above. No package installation, shared dependency write or linked-package rebuild was performed.

Source observations at 17:32 KST:

| File | SHA-256 |
| --- | --- |
| `src/bridge.ts` | `e495c4911760b81f6ae1c95300492836526adf54cd408f5002e6ca44a2dc81f9` |
| `src/contract.ts` | `4b6bffab14c66ff6fc45ccfb2eaa339426cfb69b29ee109c411cc01295d25a8f` |
| `src/control.ts` | `e4c66e2a9724843010864bbae4cac8e9ba126cde02ed95b71b08fff321e6d953` |
| `src/index.ts` | `f093b152c20f41b860b5a59a23ef8fd03173701252a0c301e6cca146168d5087` |
| `src/server.ts` | `ab10030f84c0bdf7fffac04cba98140157316b0aba5b9e8840b90f8a23382700` |
| `src/store.ts` | `1829720d262967788a56d364591f6179f5d7888e3abf3015bbca30a973b77958` |
| `test/backend.test.ts` | `6e51b6782b2c6605e53bcdf611ca5fbeabeb59ac19d3013743c40d17d99e6169` |

Frontend changes remained concurrent, so this report does not assign a final accepted frontend fingerprint. The backend scope digest in its implementation report is a separate bounded digest, not the whole service fingerprint. Repairs must establish a new source baseline before results are reused.

## Limits and continuation

No actual daemon bridge call, credential access, source Chrome operation, Figma capture, official MCP request, coding submission, native validation, guarded application, whole-source check or artifact check was executed by this reviewer. No Codex browser, CUA or connected Figma tool was used. The coordinator's seven earlier UI checks against the real HTTP server on port 4311 used an intentionally absent daemon and remain separate evidence. The reviewer did not use that server.

Only this report was written in the persistent project. Temporary probes ran with the same Windows owner's privileges, not an OS sandbox. Node dependency links were read only. The review does not prove behavior of hostile local edits to the store, all possible concurrency interleavings, or production control credentials.

Continuation order:

1. Repair R1-R4 in the backend and add behavioral regressions that fail on the reviewed source. Preserve unresolved operation identity and conservative uncertainty.
2. Complete the frontend focused-editor, invalid-JSON, event-filter and save-lock repairs. The coordinator should execute the failing/passing installed-Chrome evidence against the latest production server build.
3. Recheck the frozen FE/BE source, update this report with exact disposition and hashes, then integrate and run the required source/package/artifact gates.
4. Exercise real public-service plan/run behavior only through service-owned tooling and the coordinator's source-session schedule. Maintain the existing CDD-before-eCommerce order and separate official MCP obligations.

No additional owner approval is needed for these authorized repairs. Remaining product scope questions are the already documented future worker automation and broader graph topology; they do not block the concrete fixes above.
