# In-app guide and actual usage acceptance

Date: October 11, 2026 (Asia/Seoul). This record is being prepared while the guide, workspace/activity backend and actual-usage runner are implemented in managed checkout `4d3e`.

## Scope and current status

The owner requested an in-app usage guide and **three actual Chrome UI/service functional rounds**. Fixture/unit passes do not satisfy those rounds. This work follows the [repository instructions](../../../AGENTS.md), [portal plan](../../plans/2026-10-11-service-web-portal.md) and [canonical analysis](../../service-analysis.md). It adds to the [earlier portal verification](README.md), rather than relabeling those isolated tests as actual usage.

The runner is `service/packages/portal/web/tests/live-usage-check.mjs`. It is authored in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service` and is not yet a tested live production entry. The coordinator alone integrates/restarts the portal, controls source Chrome, executes the three real rounds and continues real coding/validation/application. The native production portal and daemon remain separate from authoring. No Superpowers, CUA, Codex browser or external Figma connector is used.

**No actual round is claimed complete in this initial record.** The coordinator separately restored a real CDD capture at approximately 20:06, with `complete:true` and `liveVerified:true`, plan `sfp_portal1_f4471f834ea82da3f979b165e3a06c8c`. That was service diagnostic preparation, not a guide/UI usage round. Its eight pending workflow decisions still require fresh evidence binding and explicit user-interface staging.

## Three-round acceptance matrix

All three rounds use CDD file `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`, and case 4 with different previously unused relative output paths. eCommerce remains after the CDD full-acceptance obligation.

| Round | Actual workflow to exercise | Guide/UI and persistence | Actual source gate | Agent handoff | Generation, validation and application |
| --- | --- | --- | --- | --- | --- |
| 1 | Guided setup, register a new explicitly owned existing empty workspace folder, independent Chrome page API, fresh output target | Pending actual execution | Pending; requires complete and live-verified capture | Pending actual handoff display/copy; no web lease by default | Not executed/accepted |
| 2 | Select the registered workspace, Chrome/Scripter, another fresh output target, edit/save/reload | Pending actual execution | Pending; requires complete and live-verified capture | Pending | Not executed/accepted |
| 3 | New owned browser session, reopen the preceding persisted workflow and guide, keyboard setup/save, page API, third fresh output target | Pending actual execution | Pending; requires complete and live-verified capture | Pending | Not executed/accepted |

Each row must ultimately link its real attempt directory, workflow/run IDs, served-asset hashes, screenshots, request receipts, activity evidence and actual result. A failed capture, input wait, coding-agent wait or pending operation remains that exact outcome. None is a completed generated frontend.

## Runner behavior and operator contract

The runner requires an explicit configuration containing all three rounds and one explicit `--round` selection. It is scoped to the real loopback production portal on port 4310. Every mutation goes through visible portal controls and the actual HTTP endpoints used by the application. It has no route fulfillment, fake control service, direct daemon mutation or alternate browser engine. It launches only a separate owned installed-Google-Chrome session, using Playwright's `chrome` channel.

The coordinator supplies:

- An existing, explicitly owned local workspace folder. Round 1 requires it to be empty and not a link; the web registration feature does not create it.
- A private absolute evidence root outside that workspace.
- The authorized CDD URL and the four previously reviewed product requirements as product input only. Their IDs, descriptions and confirmed roles/states/routes/contracts/implementation rationale are entered through guided fields and checked against the real saved workflow. Prior workflow-decision hashes are not copied as authority.
- Three unique fresh relative target paths, with collectors page API, Scripter and page API in that order.
- Explicitly authorized service approval operation names. The runner permits only its own current source/context/status operations (`portal_plan`, `portal_start`, `portal_next`, `portal_status`), never arbitrary tools or automatic apply. It verifies current run/workspace/operation and unexpired retained prompt identity, displays the selected target/effects, screenshots it, and uses the UI decision button. **Native Chrome Allow remains manual.**

The standard three rounds use `requestContext:false`. Core coding leases bind to the session that acquires them. An external coding agent must request `portal_next` and submit through the same MCP/CLI connection. A web lease must not be copied to that agent. The runner observes/copies the safe agent handoff information and keeps agent waiting separate from generation. An advanced web-only context check requires both `requestContext:true` and `sessionMode:"web-only"` and must not be used for an external coding session.

When `waitForExternalAgent:true`, the runner explicitly clicks the portal's service-status control at bounded intervals to read genuine daemon progress. The normal three-second page poll reads only the portal's retained cache and cannot establish fresh external-agent results. Observation timeout never extends a service budget, replays an operation or automatically cancels an unknown effect.

The required outcome is explicit: `capture`, `agent-handoff` or `generation`. The minimum source gate requires actual complete/live-verified design evidence and a completed source node. `agent-handoff` means the real handoff information is presented/copied or an explicitly opted-in web-only lease was actually returned; it does not mean that code was generated. Full generation acceptance additionally requires the service's completed state, current source authority, candidate/applied hashes, applied-target validation, live/runtime verification and passing required checks. The result preserves all three booleans separately.

## Current-capture workflow decisions

If actual capture completes but its observed workflow evidence remains unresolved, the runner opens and screenshots the real decision panel. It can wait for an explicitly provided local decision receipt. That receipt must contain the exact currently observed `analysisHash` and one reviewed choice for every current unresolved evidence ID, each linked to an actual confirmed requirement with a substantive rationale.

The runner verifies the displayed form's run ID/hash and each current evidence row before selecting its human-readable controls. It never injects workflow JSON or silently maps unbound evidence. The UI stages decisions only into the draft. The runner then performs separate visible save and start actions, and verifies a new run ID and saved revision. The earlier input-wait run remains recorded; it is not retried or erased. Every such service run is retained under the same functional round's `startedRuns` evidence. Rebinding is bounded to one decision/replan pass per runner invocation.

If fresh evidence differs from the receipt, the runner stops and records the mismatch. If no receipt is supplied, the unresolved decision panel is an observed incomplete state, not an accepted source-to-code flow.

## Evidence and failure retention

Each invocation creates a new attempt directory under `round-<n>/<timestamp>-<uuid>`. An exclusive target-claim file prevents silent reuse of a previous attempt's output path. Existing output paths are rejected before the browser starts. Earlier failed attempts are preserved.

Evidence includes `result.json`, sanitized `network.ndjson`, bounded semantic event records, state screenshots, served JS/CSS hashes and per-round latest pointers. Network receipts record method, path, status, selected contract fields and request hashes; they do not record authorization, cookies, CSRF tokens, raw lease credentials, submitted code or entire request/response payloads. The runner does not claim screenshots or event rows that it has not actually observed. Browser/assertion errors remain in the result.

The owner subsequently requested meaningful persistent activity logging and a user-visible activity view. Those backend/UI additions are being authored separately. The real runner will verify visible records from actual actions, persistence after reload, safe filtering and exclusion of a generated test-only secret sentinel from activity storage. These are pending until the log contract and UI freeze are reviewed; they are not fulfilled by current fixture logs.

## Preparation checks executed so far

The runner's three dry-run configurations validated successfully without network requests, browser startup, workspace creation, daemon calls or mutation. The private dry configuration uses placeholder owned paths and product requirements from the owner's prior request; it contains no reused workflow-decision authority.

Six isolated guard cases passed: CDD/C4 three-round configuration, distinct targets, path/service/source/session restrictions, fresh decision-receipt binding, stale/foreign/incomplete evidence rejection, and truthful agent-wait summaries. These are test helpers and **not** the three real functional rounds. Runner syntax, scoped lint and formatting passed at that preparation checkpoint. Subsequent log/guide contract adjustments need the final checks before freeze.

The reviewer independently ran the initial workspace/readiness backend suite: **56/56 passed at 20:12:29 KST**, including the earlier 47 race/unknown/capacity cases. Source inspection verified that the production adapter reuses public `ControlClient.workspace`: real-path canonicalization, existing-root identity refusal, an owner-authenticated hash-bound registration nonce, and a confirmed workspace reread. The closed POST endpoint retains same-origin/CSRF/schema guards and provides no mkdir, rebind or arbitrary control proxy. Bootstrap reads existing status only; it does not initiate Chrome connection. `not-requested`/unknown browser readiness does not change a healthy service's availability and must remain advisory for a first run. This checkpoint predates the newly requested persistent activity additions.

Commands for the coordinator after review/integration:

```powershell
node packages/portal/web/tests/live-usage-check.mjs --config <reviewed-private-config.json> --round 1 --dry-run
node packages/portal/web/tests/live-usage-check.mjs --config <reviewed-private-config.json> --round 1 --execute
# Execute rounds 2 and 3 separately, with their distinct target paths and retained evidence.
```

Only the coordinator should execute the actual production commands. The runner author has performed no live mutation. Final hashes, frozen guide/backend review, activity checks and the three real outcome receipts must be appended after they exist. The separate workspaces and owned browser profile share the Windows owner's privileges and are not an OS sandbox.

## 21:31 runner repair and persistent Chrome steering

The coordinator reported that actual round 1 encountered `FIGMA_PAGE_IDENTITY_CHANGED`, while actual round 2 reached complete/live-verified Scripter capture and then stopped in the runner's decision validation. The latter was a test-harness defect: it incorrectly required an evidence ID to use `sha256:`. The shared workflow-decision contract accepts one to 256 characters, and the actual captured IDs use `design-<64 hexadecimal characters>`. The current analysis hash still uses `sha256:`. These coordinator observations do not turn either failed attempt into completed generation or a completed functional round; their actual receipts remain coordinator-owned.

A new persistent runner regression reproduced the real-prefix rejection before the repair. The runner now follows the shared evidence-ID size contract and retains exact current-set membership, unique/every-pending-row coverage, current analysis hash, run/workflow identity, complete/live capture, confirmed requirement and explicit rationale checks. It finds the displayed row by exact attribute comparison, without putting an arbitrary evidence identifier into a CSS selector. The prefix regression and negative bindings pass.

The owner then requested **one existing visible Chrome window/tab reused for all active testing**. This supersedes round 3's earlier fresh-browser condition. The runner supports `browserWsEndpoint` restricted to an explicit loopback WebSocket endpoint and `browserConnection` of `playwright` or `cdp`. It requires exactly one existing page at the production portal origin, creates no context/page in reuse mode, restores focus, clears its synthetic test header and disconnects its protocol client. It never closes the helper-owned context/page. Actual execution without the endpoint is refused unless the explicit fixture-only `isolatedBrowser:true` flag is supplied; no isolated launch was performed after the owner steering. Round 3 records `round3FreshBrowserSuperseded:true` and still exercises persisted reopen/reload and keyboard controls.

The installed Playwright 1.63 source confirms ordinary `launchServer` isolates contexts between connections. The coordinator must supply a genuinely shared helper endpoint or the owned Chrome CDP endpoint; merely reconnecting to a standard isolated launch server does not expose its other connection's tab. Missing or multiple portal pages cause a refusal, never creation of another window. Endpoint details are private operational data and are not recorded in this report.

At 21:30 KST, **four persistent runner regressions passed**, and the earlier **eight private configuration/decision/activity guard tests passed**. Scoped lint, formatting and syntax passed. Runner SHA-256 is `8fb67e26b58bf9827ec0a36c573d6822291eac8b3cc6b5c241014a5e77f92799`; new `web/tests/live-usage-check.test.mjs` SHA-256 is `bb4bd8e1331da5e8a613ebc2848469674aee1d0d2f6d6144f8754a1caf285c43`. The runner is frozen for the coordinator's fresh real attempt.

Before the one-window steering, one private owned-Chrome HTTP fixture opened the guide by keyboard, verified Escape focus return and the advisory first-run connection state, then failed because its test harness incorrectly expected the saved workflow response to be wrapped in `{workflow}`. It made no daemon/capture/generation call and did not reach activity assertions. The failed attempt remains at managed `.cache/portal-owned-ui/2026-10-11T12-24-18-653Z-ed15025d-b970-40be-ac60-c3c0edcea474/result.json`. This is explicitly not an activity-view pass or one of the three actual rounds. Further broad browser fixtures were paused for the owner's single-window rule and the [shared import-cycle repair](shared-portal-import-cycle.md).

The activity backend and frontend model/API source did pass an independent combined **94/94** settings/backend/model/API test run at 21:11:39 KST, including all 65 then-frozen backend cases. Activity navigation, durable filtering/reload and full catalog UI still require the coordinator's reusable browser and integrated final hooks. The [settings report](figma-settings.md) records separate daemon-owned official status/probe/read checks and their lack of live official-MCP acceptance.

### 21:34 final existing-tab state preservation

The coordinator verified its second Playwright connection sees exactly one helper-owned portal context/page and that disconnect preserves the visible window. The helper uses the installed-version shared-server mode; the runner has not launched or controlled that browser itself.

The final runner does not set or clear extra HTTP headers at all in existing-tab mode, because Playwright cannot reliably read and restore an arbitrary preexisting page header bag. It also does not change the viewport, clear storage, or close the existing page/context. The synthetic Authorization test is explicitly recorded as not injected, with `syntheticAuthorizationExcluded:null`; structural activity redaction checks still run. This supersedes the earlier header-injection/cleanup description for persistent reuse. An isolated fixture may still inject its own sentinel, but no such browser has been launched after the owner's instruction.

Final runner SHA-256: `2d4542d7e262e79bc957b5eb915be5c70a02cea9ab036e5394baf78a5978e369`. Regression-file hash is unchanged. A fresh four-regression plus eight-private-guard run passed at 21:33:49 KST, with scoped lint/format checks passing. The coordinator owns the next actual UI attempt on this source.

### 21:38 actual round-2 trace diagnosis and handoff check repair

The coordinator's retained-window attempt at `.worktrees/_cache/portal-usage-20261011/evidence/round-2/2026-10-11T12-33-16-385Z-7de29274-a8c5-4264-84f6-3a9caf4f82b8` was inspected read-only. Its actual result and failure screenshot show complete/live-verified design, complete workflow coverage, and `awaiting-agent` for service run `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d`. The generation node is waiting, outputs are empty, and no candidate/applied hash or runtime validation is claimed. Nine recorded checks passed through real guided configuration, save/reload, live source capture, current evidence decisions and live graph/events.

The next harness assertion expected the full service run ID inside `.inspector-body`, but that ID is displayed in the actual event timeline. The handoff button was present. The failure occurred before clicking it and before activity verification. The repair checks the actual visible timeline identity, then performs the same explicit handoff copy button and success-notice checks. It does not intercept the clipboard, grant permissions, fabricate copied text, acquire a web lease or change the captured run. The retained failed trace remains unchanged.

Failures now retain the check name and bounded `live-usage-check.mjs:line:column` locations, without copying full stack paths or the owned browser endpoint. A regression verifies this safe diagnostic shape. The round-3 check name now explicitly describes retained-tab reopen when reuse mode is active.

Final runner SHA-256 is `ae469a6553c8be630041d7bb7e7f3e71512f82c3663a399a0b95d6502185a855`; regression SHA-256 is `9007b04733b6a14e6b239aeb9f4d2873f9c7f283ed8506297ed8911a62a0a6e3`. **Five regressions passed** at 21:37:38 KST, with syntax, scoped lint and formatting passing. No browser was opened or controlled by this reviewer during the diagnosis. A fresh actual continuation remains coordinator-owned; the partial trace is not a full functional or generated-output acceptance pass.
