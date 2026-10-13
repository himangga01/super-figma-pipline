# Login-free web portal backend implementation

Date: October 11, 2026, updated at 18:22 KST (Asia/Seoul). Initial implementation and earlier review evidence are retained below.

## Scope and baseline

This is the bounded backend implementation record for the [approved web portal plan](../../plans/2026-10-11-service-web-portal.md). The [canonical service analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md) remain the cross-agent authorities. This record does not replace Figma generation or case acceptance evidence.

The coordinator supplied frozen service source baseline `1a5d6b0f...`. The managed implementation checkout is `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline`, with Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus the coordinator's synchronized, uncommitted service changes. Existing changes were preserved. Backend ownership is limited to `service/packages/portal/src`, `test`, package/build/type/test configuration. The frontend worker owns `web`; the coordinator owns root package/lockfile, provenance and integrated verification. No commit or push was made.

At the initial handoff, the backend scope digest was `sha256:6b307617603cd8d5c7eda7a9b0fcfbe5e356cd17504b502537751bf7e3b2c50a`. The reviewed repair digest at 17:36 is `sha256:d10f548c8c8f53bff72998daa165c5fb92ee47b6b1ec5c3a9c923913cc6e00eb`. Each covers the sorted relative names and bytes of `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `src/*` and `test/*` within the new package, separated by NUL bytes. It excludes frontend assets, generated `dist` and dependencies. This is a bounded implementation digest, not the project's whole-source fingerprint.

## Implemented behavior

- A real Node HTTP server hosts the frontend and a closed same-origin JSON API. Default binding is `127.0.0.1:4310`; there is no login or account page. Default control connection is the existing local service on port 3055.
- `src/contract.ts` is the authoritative typed HTTP contract. Bootstrap returns service availability, actual registered workspaces when readable, supported source/action capabilities, a CSRF token and an unexecuted editable template. Supported sources are independent Chrome page API, Chrome/Scripter and official Figma MCP. The official endpoint allowlist comes from the existing public service schema.
- Workflow definitions, canvas coordinates and viewport, configuration and revisions persist in a bounded JSON store. Writes serialize and publish by replacement. Revision conflicts return HTTP 409. Drafts may be incomplete, while starting a run requires the supported five-stage graph. Cycles, duplicate identities/connections, missing stages, disconnected stages and unsupported transitions produce validation issues.
- Starting a saved workflow captures its exact revision and immutable graph snapshot, validates workspace/reference availability and invokes public `portal_plan`, then `portal_start`. Legacy/reference/full-portal semantics and requirements are validated by the existing service schema and engine. No alternate generator, browser or service implementation is introduced.
- The adapter resolves the public `@sfp/cli` package and uses `ControlClient`. Its credentials remain server-side. Browser requests cannot select an arbitrary tool, control path, shell command, URL proxy or filesystem read.
- The bridge records real public results and operation progress, retains a bounded event history and exposes explicit `refresh`, `next`, `submit`, `validate`, `apply`, `resume`, `cancel`, `approve` and `reject` actions. Validation defaults to the profile saved on the validation node. Native profiles remain service-managed; the web API does not install or create them.
- A generation lease becomes `awaiting-agent`. The context and submission affordances use the actual `portal_next` and `portal_submit` interfaces. Only the service's completed run state is displayed as completed. The bridge rejects a result belonging to a different service run.
- Approval decisions are limited to unexpired prompts for the active operation. Native Chrome approvals remain manual. Automatic invocation approval is disabled. Cancellation requests are reported as requests until an authoritative outcome is observed.
- Transport uncertainty and interrupted active runs are retained as `unknown`; mutations are not replayed on restart. A failed status read cannot erase an existing unknown-outcome fence. Unknown runs only permit inspection through resume until their service status is reconciled.

## HTTP and storage boundary

| Area | Implemented bound |
| --- | --- |
| Host and origin | Exact local Host including bound port; same-origin Origin and Fetch Metadata checks |
| Mutation integrity | JSON content type and random server-issued `X-SFP-CSRF` token, compared in constant time |
| Routes and input | Closed route table; strict schemas; no arbitrary action/tool proxy; encoded/traversal path aliases rejected |
| Static assets | Root-level allowlisted extensions from the configured web root; real-path containment; no browser access to server source or credentials |
| Browser headers | No-store, nosniff, frame denial, same-origin CSP, no-referrer |
| Request resources | Twelve MiB JSON body, 16 KiB headers, 32 connections, bounded receiving/keep-alive timeouts |
| Retained state | At most 100 workflows, 200 runs, 500 events per run, eight MiB displayed service result, 32 MiB total store |
| Process ownership | A startup PID lock prevents two portal processes from opening the same store; interrupted effects are never automatically restarted |

Default state is under the current user's local application data directory, in `SuperFigmaPipeline/web-portal`. `SFP_PORTAL_STATE_ROOT`, `SFP_PORTAL_PORT`, `SFP_CONTROL_PORT` and `SFP_STATE_ROOT` configure state and local endpoints. These are server startup inputs, not browser-controlled paths.

This runs with the current Windows owner's privileges. A separate checkout and dedicated state directory provide organization and process separation, not an OS sandbox or an independent Windows security principal. Directory/file modes are not a claim of Windows ACL isolation. No Docker was installed or used. Dependency junction targets were treated as read-only; only the new package's generated output was built.

## Verification performed

From the managed `service` directory:

```powershell
node node_modules/vitest/vitest.mjs run --project portal
node node_modules/typescript/bin/tsc --noEmit -p packages/portal/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/src packages/portal/test packages/portal/tsdown.config.ts packages/portal/vitest.config.ts
node packages/portal/node_modules/tsdown/dist/run.mjs --config packages/portal/tsdown.config.ts
```

Initial result at 17:22: **11 backend tests passed**, TypeScript succeeded, scoped lint succeeded, and the production ESM server built successfully. Tests use real temporary-file persistence and a real local HTTP server. The external service boundary is an injected fixture; it does not call the active source daemon or Chrome. The later review repair verification is recorded below.

The test-first implementation initially failed because the new modules did not exist. Subsequent behavioral regressions demonstrably failed before correction: the saved validation profile was ignored, a foreign service run ID could report completion, a failed refresh removed an unknown-outcome fence, and an encoded traversal alias normalized to a valid API path. All are covered by the final passing suite. A test cleanup race was also corrected by waiting for the fixture operation to settle.

The production `dist/index.mjs` was started on `http://127.0.0.1:4311` with a fresh temporary store and intentionally absent control port 59999. Actual HTTP observations were bootstrap 200 with `service.available:false`, workflow creation 201, one persisted workflow returned by list, and frontend HTML 200. This verifies the genuine production server and its daemon-unavailable path. The retained smoke process predates only the final traversal/max-connections change; the later build and fixture suite include that change. The coordinator was told this distinction before handoff.

## Remaining acceptance and limits

The package has not completed an integrated whole-source/artifact check. The root lockfile, launch command, package/artifact/provenance wiring and independent review belong to the coordinator. Frontend Chrome interaction tests belong to the frontend worker and coordinator. The coordinator must start the latest build for final UI acceptance.

No real `portal_plan`, capture, generation, coding submission, native validation, application or official Figma MCP invocation was performed by this backend worker. In particular, fixture success and HTTP availability do not establish Figma frontend acceptance. The active CDD daemon and source Chrome were not controlled or mutated.

Run listing currently includes runs created through this web portal's retained store. GET run returns the latest recorded view; the explicit `refresh` action queries the service. It does not import arbitrary historical daemon runs. If a planning operation becomes unknown before returning a plan/run ID, the UI preserves its operation ID and directs inspection through the service CLI; it cannot safely invent the missing run binding or replay planning. Capacity exhaustion is explicit and requires preserving/rotating the retained store. No account, multi-user/LAN hosting, background coding worker or native-profile editor is implemented.

Continuation order: integrate the package and frontend, independently review the HTTP/bridge/revision/approval boundaries, test the latest built portal using service-owned installed Chrome, exercise the public service workflow when the coordinator's source-connection schedule permits, and run the project whole/artifact gates against the integrated source. Preserve the separate CDD and eCommerce acceptance order and original run budgets.

## Independent review repairs at 17:36 KST

The independent reviewer reproduced four defects in the initial backend. The backend worker verified their source causes and added or strengthened regressions before changing production code. The first new run had **six failing cases and ten passing cases**. Those failures directly covered two post-dispatch error codes, the lost operation pointer, interrupted nodes and both applied-validation states.

| Finding | Verified cause | Repair |
| --- | --- | --- |
| P1: post-dispatch `CONTROL_AUTH_BUSY` re-enabled application | The bridge inferred uncertainty from a short transport-error allowlist, so an exhausted authorization-monitoring budget was recorded as a confirmed failure while the stale service result still said `ready-to-apply` | Any issued mutation with an unobserved disposition is now `unknown`, regardless of error code. Only a matching operation ID plus authenticated terminal failure evidence from the service event or `ControlClient` error can establish failure. The prior unknown fence is preserved independently |
| P2: failed status read lost the unresolved mutation ID | Every invocation cleared `operationId`, including status inspection | Launch captures the unresolved ID and restores it if inspection fails or leaves the service outcome unknown. Read events remain in history |
| P2: restarted run still displayed active nodes | Recovery changed only the run status | Recovery marks active/waiting nodes unknown, records an interruption message and updates the record time |
| P2: applied validation displayed as completed | The shared validation node retained its candidate-validation completion after application | `applied-awaiting-validation` displays validation waiting; `validating-applied` displays validation active. Output remains waiting for final validation |

At 17:35:54, `vitest run --project portal --no-cache` passed **16/16 backend cases**. The suite additionally retains a correlated terminal-failure case to distinguish known failure from unknown disposition. The package TypeScript check, scoped lint and production build all succeeded after formatting. No frontend files, daemon code, dependency targets, main/native source or source Chrome were modified by this repair.

The coordinator's current QA process on port 4311, PID 11312, was deliberately left running. It predates these repairs and remains connected to intentionally absent control port 59999. The latest `packages/portal/dist/index.mjs` was rebuilt, but this worker did not restart or count the older process as validation of the repaired build. Independent recheck and integrated whole/artifact acceptance remain coordinator-owned.

## R6 follow-up: original operation disposition, 17:54 KST

The final independent review found that a *successful* `portal_status` snapshot could still clear the unknown fence while the original mutation remained unresolved. A snapshot saying `ready-to-apply` or `completed` does not prove the original operation's disposition. The earlier four repair probes passed, but that success did not cover this distinct case.

The bridge now persists a private unresolved-operation record with its original ID and operation name. It is excluded from the public `Run` contract. All later inspections preserve that record and its public operation pointer until the authenticated service journal establishes the original disposition. A restart during a status inspection restores the original mutation pointer rather than retaining the inspection operation ID. Missing original IDs remain fenced conservatively.

The only new control capability is an internal `inspectOriginalOperation` read. The production adapter calls the existing authenticated `ControlClient.request` route `/control/operations/<encoded retained ID>` with a ten-second timeout. Browser callers cannot supply this operation ID or a control path. Before accepting proof, the bridge validates the entire public operation-record/tombstone schema and correlates the retained ID, workspace, tool kind, original operation name and settlement timestamp. Pending, missing, malformed, foreign, `outcome-unknown` and `abandoned` records do not clear the fence. A proven terminal disposition is followed by a fresh `portal_status` call; both are needed before the snapshot can reopen actions or display completion.

While unresolved, starting the same workflow is rejected, `next`, `submit`, `validate`, `apply` and idle `cancel` are disabled, and mutating resume is rejected. Explicit resume inspection can read evidence but cannot clear the fence. Cancelling a currently active request still targets that current request through its own abort controller. No effect is automatically replayed, and no new browser action or credential exposure was added.

Twelve newly added matrix cases failed before the repair, covering successful ready/completed snapshots and absent, pending, foreign, malformed, unknown, abandoned and valid operation proof. A thirteenth regression subsequently exposed and closed the missing-original-ID case. The final suite also verifies that valid completion is accepted only after the original proof and a subsequent status read, that inspection cannot erase the retained mutation, and that the private field is absent from public run responses.

At 17:53:42, **31/31 backend tests passed with `--no-cache`**. Package TypeScript, scoped lint and the production build passed. The final bounded backend digest is `sha256:dfc280a1b464e2f80d9f6842c858c5b3bc9f66a21a0ae1c9cbffa244d13a36ca`, using the same definition above. No main/native source, frontend asset, dependency target, active daemon or source Chrome was changed. Port 4311 still runs the coordinator's earlier process; restarting it and independent rechecking the newly frozen source remain coordinator tasks. Actual daemon journal access was implemented but not exercised against the live daemon by this worker.

## Live R2 source-state projection repair, 18:22 KST

The coordinator's actual public-service web run `3b73cc48-807f-49e3-b570-a0a18564878d` reached `needs-input` after source acquisition failed with `FIGMA_TAB_NOT_FOUND`. Its retained plan recorded `design.complete:false`, `liveVerified:false`, and `DESIGN_CAPTURE_REQUIRED`, `LIVE_DESIGN_VERIFICATION_REQUIRED` and `WORKFLOW_ANALYSIS:DESIGN_MISSING` issues. The web graph nevertheless showed the source node completed. Private evidence is retained under the main checkout's `.worktrees/_cache/web-portal-cdd-20261011-r2/`; these were inspected read-only. This was an actual failed acquisition, not capture acceptance. The coordinator owns restoring the source tab and rerunning the service.

The mapper previously inferred source completion from a recorded plan or any state following planning. It now projects source state from the retained plan's design evidence, or `portal_next`'s retained `blueprint.design`, and the workflow's selected freshness policy. Completion requires `design.complete:true`; `require-live` additionally requires `liveVerified:true` and no live-verification issue. Missing-design issues prevent source completion even if flags conflict. A recorded capture failure displays its actual code and failed source state; missing or unverified evidence displays waiting. Requirements remain waiting while required design evidence is missing.

The positive distinction is covered explicitly: complete, live-verified capture with unresolved business workflow requirements displays source completed and requirements waiting. An explicitly permitted complete pinned capture can also complete the source stage under its selected freshness policy. No capture, generation or acceptance receipt is invented. The existing unknown-operation and applied-validation controls remain unchanged.

Six additional regression cases were added. Four failed against the preceding mapper; the valid-capture and allowed-pinned positive controls already passed. After repair, **37/37 backend cases passed** at 18:21:04 using `vitest run --project portal packages/portal/test/backend.test.ts --no-cache`. Package TypeScript, scoped lint and the production build also passed. The frontend worker's separate test/config integration had increased the overall portal project scope, so this worker deliberately ran the backend test file only. The coordinator must rerun the integrated frontend/owned-Chrome suite after incorporating this delta.

Only `src/bridge.ts`, `test/backend.test.ts` and this report were edited for this repair. Neither live portal process PID 33192 nor QA process PID 11312 was stopped or restarted, and no live daemon or source Chrome operation was performed by this worker. The rebuilt `dist/index.mjs` requires coordinator restart and independent review before the repaired behavior can be counted as live acceptance.

Frozen repair file hashes: `src/bridge.ts` is `sha256:a1c768017da79f35b1e1411fc8487b03f365e56d770fcbf52ab4cefe1c54c717`; `test/backend.test.ts` is `sha256:f6fe9b4e0a03f9dc7f33de8c6e625a4d3991828b38f8ab454b32a2ad043d5574`. Earlier bounded package digests predate this repair and the frontend test/config integration.
