# Service web portal frontend implementation

Date: October 11, 2026 (Asia/Seoul).

## Scope and source baseline

The owner requested a login-free operating portal with editable workflow settings and a live execution graph. The frontend was implemented in `service/packages/portal/web/` in the separate managed checkout at `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. Its published Git baseline is `22517932dc9b2cb974c177ec4eacb84d4b16e254`. The checkout also contains synchronized, uncommitted continuation changes; HEAD alone does not identify its complete source. The coordinator owns the integrated source fingerprint and whole-check evidence.

The original main/native source under whole validation, existing Figma Chrome session, control daemon, dependency junction targets, Git index and commits were not modified by the frontend worker. The initial working tree contained unrelated continuation changes. The worker initially owned `packages/portal/web/**` and this execution record. The coordinator later authorized `packages/portal/test/browser.test.ts`, test-related package/configuration edits, and the approval-dialog UI delta described below. Backend source remains separately owned. The managed checkout shares the Windows owner's filesystem/process privileges; it is not an operating-system security sandbox.

This record supplements the [implementation plan](../../plans/2026-10-11-service-web-portal.md). [The service analysis](../../service-analysis.md) remains the canonical analysis authority. Future continuation should read that report, this record and [repository instructions](../../../AGENTS.md), then verify the current source and newer evidence before reusing any result.

## Implemented interface and behavior

The original light interface uses restrained blue accents, Korean product copy, locally defined SVG icons and the system font stack. No image asset, remote font, external runtime framework, login, account controls, invented metrics or fabricated execution results are included.

The inspected design references informed separate aspects of the implementation:

- [7328](https://ref.theseeker.io/r/7328): light three-column composition, node-type accents, selected-node settings and output schema.
- [7550](https://ref.theseeker.io/r/7550): navigation and node library, connected cards, editing and save/test actions.
- [7548](https://ref.theseeker.io/r/7548): distinct live-map view, recorded node state, selected-node details and event history.

Implemented modules:

| File | Responsibility |
| --- | --- |
| `web/index.html` | Local entry point, Korean document language, skip link, loading state and action dialog |
| `web/styles.css` | Original responsive layout, dotted canvas, node cards, inspectors, timeline, focus styles and reduced motion |
| `web/model.js` | Actual node addition/removal, edge creation, cycle rejection, coordinate mutation and metadata-free save input |
| `web/api.js` | Same-origin JSON transport, bootstrap CSRF token, revision save, real run and action endpoints, bounded response timeout and structured errors |
| `web/app.js` | Builder/live views, workspace and case forms, source selection, requirements/stack/profile edits, graph drag/pan/zoom, inspector tabs, save/reload and recorded execution feedback |

Inspector edits update the same workflow plan sent to the backend. Source selection maps independent Chrome collection and Chrome/Scripter to the service's `source: chrome` and corresponding collector, and official MCP to `source: official-mcp`. The official endpoint choices use only Figma's remote endpoint and its Desktop loopback endpoint. Case forms expose target and reference paths, requirements and implementation layers. Structured requirements can carry the service workflow blueprint; missing confirmation is described as requiring input, not automatic completion.

The five-stage draft contains source, requirements, generation, validation and output. Optional nodes and connections modify the persisted graph. The UI explains that the current execution bridge supports exactly one of each stage in order; unsupported branches remain subject to backend execution validation. Node movement is available through dragging, arrow keys and labeled inspector controls. Canvas position and zoom are persisted with builder saves. Revision conflicts retain unsaved local edits and instruct the owner to reload the server's definition.

The live view uses the backend's immutable `Run.graph` snapshot, bound to the run's workflow revision. Its node settings and ports are read-only; viewport changes are local to the view. Recorded node state, error, context, result, approvals, outputs and bounded events are shown without synthesizing completion. Output-schema descriptions use actual public run-node fields. Missing outputs and history have explicit empty states.

Starting a run saves pending builder edits and invokes the actual backend run endpoint. Enabled run actions come from the backend and include context acquisition, agent submission, validation, refresh, cancellation, resume and explicit approval/application requests. Submission uses service JSON, including actual lease identifiers and hashes. The portal does not supply a model or conceal the existing requirement for a coding agent. Changes with uncertain outcomes are not automatically replayed.

## Verification executed by the frontend worker

All commands ran from the managed service checkout. Existing dependencies were used directly; no install or linked-package rebuild was performed. The following commands record the original standalone checkpoint; the test imports and current commands were later migrated to Vitest as described below.

```powershell
node --test packages/portal/web/tests/model.test.mjs packages/portal/web/tests/api.test.mjs
node --check packages/portal/web/app.js
node --check packages/portal/web/tests/chrome-check.mjs
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/web
node node_modules/oxfmt/bin/oxfmt packages/portal/web
```

Results at the latest frontend freeze: eight focused tests passed, syntax checks passed, scoped lint had no warnings, and eight frontend files were formatted. The graph, event-filter and requirement-JSON tests were observed failing against placeholder implementations before their implementation. The two API boundary tests use real local HTTP transport and verify strict save-payload routing, bootstrap integrity-token propagation and revision-conflict errors. They do not substitute for the backend bridge suite or Chrome acceptance.

`pnpm` was unavailable in the worker's shell PATH. The installed formatter/linter entry points were invoked through Node instead. This did not install or modify dependencies.

A post-Chrome check again passed all eight focused tests and scoped lint. At that checkpoint, `oxfmt --check packages/portal/web` flagged only `web/tests/chrome-check.mjs`; the earlier formatter invocation had exited successfully. No served runtime asset was flagged. The coordinator formatted the test file using the installed direct binary. The later R7 verification below passed the complete scoped format check.

## Chrome handoff and actual limits

The frontend worker authored the service-owned check at `web/tests/chrome-check.mjs`. The coordinator owns browser execution and screenshot inspection. It launches a separate owned installed Google Chrome instance with Playwright's `chrome` channel and explicit executable. It connects to the real loopback portal server and checks source/requirement edits, node addition/removal, keyboard coordinates, actual HTTP save/reload, zoom, mobile document overflow and uncaught browser errors. It writes desktop-builder, empty-live and mobile screenshots plus a JSON result.

The coordinator reported an earlier seven-check pass with no page errors and inspected the desktop/mobile screenshots. That observation belongs to the pre-repair frontend checkpoint; it is not a pass for the subsequent source. Later code review identified pending-save mutation loss, focused-input shortcut loss and event-filter mapping issues.

The busy-save regression was verified red by the coordinator against the actual portal HTTP server: `Inspector edits must be locked while a real HTTP save is pending`, actual `false`, expected `true`, preserved under `.worktrees/_cache/portal-qa-save-red3-20261011`. The first replay failed because the fixture process had ended, and the second had a test promise-cleanup error; neither is a product acceptance result. The test now immediately handles and settles its pending response before browser cleanup.

The latest frontend fixes temporarily lock all mutation controls and pointer/keyboard graph movement during pending saves. Normal text edits commit on input so a focused `Ctrl+S` uses the current text. Structured requirements retain their raw JSON draft across rerenders and node navigation, and malformed JSON blocks save/check/start without discarding the draft. Timeline filters read actual event `data.state` and error types; `candidate-ready` remains an input-waiting state and is never mapped to complete.

The authored Chrome check now also gates and forwards the original save request to the actual server while testing control locks, verifies a focused shortcut save through the actual HTTP response, and checks malformed JSON preservation, absence of a mutation request, correction and subsequent successful serialization. The request gate does not fabricate an HTTP response.

At 17:36 KST, the coordinator executed the latest check against `http://127.0.0.1:4311` and reported ten checks passing with no uncaught page errors. The frontend worker read the actual `.worktrees/_cache/portal-qa-green-20261011/result.json`: it records the ten checks, `errors: []`, and explicitly records no source capture, generation or application execution. The saved workflow ID was `19d1ee77-455e-4f1d-bb10-137db9af46fc`. Desktop builder, empty live-map and mobile screenshots accompany that result. This is a focused UI/HTTP checkpoint for the current frontend freeze, not complete real-daemon or Figma frontend acceptance.

### R7: pending-save wheel mutation repair

The independent reviewer found that the canvas's `Ctrl+wheel` handler still called `zoom()` while a save was pending. Button, pointer-drag and node-keyboard locks did not cover that path. The coordinator authorized the frontend worker to use only the owned loopback portal Chrome check for this repair. Source Figma Chrome remained exclusively coordinator-controlled.

The worker added an assertion to the existing manually gated actual POST. It sends Playwright mouse-wheel input while Control is held, observes the actual wheel event on the canvas, and asserts that the full graph transform remains unchanged before releasing the original request. The unfixed application failed at `chrome-check.mjs:138`: the viewport changed from `translate(-22.9187px, 144.834px) scale(0.911483)` to `translate(-68.3105px, 84.1171px) scale(1.00263)`. The failure is recorded in `.worktrees/_cache/portal-qa-wheel-red-20261011/failure.json`.

The repair adds an early `state.busy` return in `zoom()`, so every zoom invocation preserves the saved viewport while a request is pending. The same test then passed eleven checks, retaining all ten prior checks and adding the wheel lock. Evidence is under `.worktrees/_cache/portal-qa-wheel-green-20261011/`, including `result.json`, desktop/mobile screenshots and saved workflow `ac8a4583-4d24-4fc8-928a-30e7b946eb84`. There were no uncaught page errors. No Figma capture, generation or application was executed.

Source identity for this narrow repair:

| File/checkpoint | SHA-256 |
| --- | --- |
| `web/app.js` before R7 | `ce63d6bd00dba41c3e0f7a92b8b616a1341fa979e0a9699451e30444f3fbbdac` |
| `web/app.js` after R7 | `1b96504de7cde73186c11171d38aee466cc5659ae6f61f0c46222acbe764147a` |
| `web/tests/chrome-check.mjs`, identical in red and green | `178ea8fdca270183f629f6ed2ebecb018649cd4094c950a46896f80e95ca1092` |

After the green Chrome execution, all eight focused model/API tests, scoped lint and `oxfmt --check packages/portal/web` passed. Only direct installed tool binaries were used. These file hashes identify the frontend repair and test, not the integrated service source fingerprint. The frontend is frozen again for the independent final recheck and coordinator-owned backend/real-daemon acceptance.

### Vitest integration and explicit approval review UI

At 18:07 KST, the coordinator asked to make portal UI checks part of normal whole verification. Before the wiring change, `vitest run --project portal packages/portal/web/tests` returned `No test files found` with exit code 1. The existing model/API `.test.mjs` files now import `test` from Vitest instead of `node:test`, and the portal project's include list registers them. `test:web` runs `vitest run --config vitest.config.ts web/tests` from the portal package. The earlier standalone `node --test` command is historical and is no longer the supported command for these migrated files.

`packages/portal/test/browser.test.ts` adds two mandatory installed-Chrome cases to the portal project. The wrapper resolves Chrome using the service's `googleChromeExecutable` and calls `requireChrome` from `test/support`. If Chrome is missing it fails before any skip override can act. Both browser children launch the installed executable with Playwright's `chrome` channel in separate owned sessions. Async `execFile` keeps the fixture HTTP server responsive; synchronous process execution is not used.

The first case creates an actual `PortalServer` and `PortalStore` under a newly created, verified temporary directory, binds a random loopback port and injects an unavailable control interface. It runs the unchanged eleven-check script against real HTTP, including the manually held/forwarded POST, focus-preserving shortcut PUT, malformed JSON fence and wheel lock. It reopens the actual store and independently verifies the saved revision, source configuration, requirement text, label and position. No daemon operation is invoked.

The second case addresses the coordinator's approval UX finding. The former dialog required typing `approvalId` into JSON. Its new regression first failed through actual portal HTTP with `Approval must not ask the user to type an internal ID as JSON`, actual 1 textarea, expected 0. The new unit test for filtering current-operation, unexpired prompts was also observed red before implementation. The focused red invocation selected only the approval case with `-t human-readable`; the other Chrome case was intentionally outside that filtered invocation, not skipped for a missing prerequisite.

The dialog now binds to retained, nonexpired prompts for the current operation. A single prompt is selected automatically; multiple prompts use human-readable target labels. It displays target/effect scope and expiry, with the raw prompt in optional read-only details. An explicit approve or reject click submits the selected retained identifier automatically. The client rechecks current operation and expiry; the backend retains its own checks. Coding context/submission JSON remains available for agent handoff. No permission is auto-approved, and no native Chrome security approval is automated.

The approval Chrome case uses an actual `PortalBridge` with a controlled deferred fixture operation, emits two live retained prompts and one expired prompt, then exercises the real server's action endpoint. The browser chooses the second live prompt for approval and the remaining single prompt for rejection without JSON entry. The actual control interface records those two selected IDs and decisions. The fixture then settles before its verified temporary directory is removed. The fixture control interface is injected test evidence; it does not establish real-daemon/Figma acceptance. Browser screenshots/results inside these test-specific temporary directories are checked and then removed. The earlier manually retained checkpoints remain available under `.worktrees/_cache`.

Final verification for this integration:

```powershell
# From the managed service checkout:
node node_modules/vitest/vitest.mjs run --project portal
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/web packages/portal/test/browser.test.ts packages/portal/vitest.config.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/portal/tsconfig.json
node node_modules/oxfmt/bin/oxfmt --check packages/portal/web packages/portal/test/browser.test.ts packages/portal/vitest.config.ts packages/portal/package.json

# From service/packages/portal, validating the test:web command shape:
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts web/tests
```

At 18:15 KST, the complete portal project passed **42 tests in four files**, including nine model/API tests and two mandatory Chrome wrapper cases. There were no skipped cases in that complete run. Scoped lint, portal TypeScript checking and formatting passed. The package-local web-only command separately passed nine tests in two files. An earlier verification attempt found cleanup-only lint violations in the new wrapper; those were repaired with bounded fixture settlement and a separate validated cleanup helper before the final green run.

Frozen frontend/test identities after this delta:

| File | SHA-256 |
| --- | --- |
| `web/app.js` | `dc75a442c0e3d6958b4d7f9cc26e92c1b2298b218b2f9f0cef93bf7ea5f72b92` |
| `web/model.js` | `baa72ccd8395298036c5964e51e5599e36724d588b8f4bf47c1de75825f8790c` |
| `test/browser.test.ts` | `efacd4e44cb8faaab9f9baf233b1fee3c7dbf571fc320191e51187264ba5bae3` |
| `web/tests/chrome-check.mjs`, unchanged eleven-check script | `178ea8fdca270183f629f6ed2ebecb018649cd4094c950a46896f80e95ca1092` |
| `web/tests/approval-check.mjs` | `2f75f89e31a4678571a20da37d133060e2978271be2ef3e6af882dfe23465f3f` |
| `web/tests/model.test.mjs` | `a5856040d47cb945f364b422f052e060b94df05aeea73e58279680be8d21fbf8` |
| `web/tests/api.test.mjs` | `41614ffac61ad5b8af0b56c7e226f536f179915537988d1b917aa9a9dbc42762` |
| `vitest.config.ts` | `27d74ae348da3ae449598449bc001b68b9c414146148af43b325ea213feb6c5c` |

The coordinator owns required-Chrome census registration, knip entries, provenance, the integrated source fingerprint, whole/artifact verification and the independent recheck of the approval UI delta. This portal-project pass does not replace any of those gates or the actual-daemon bridge acceptance.

The backend worker reported a production-build fixture portal at `http://127.0.0.1:4311`, using separate temporary storage and an intentionally absent control server at port 59999. This exercises a genuine unavailable-service state, not live Figma capture. The frontend worker did not independently establish its run results.

Coordinator command:

```powershell
node packages/portal/web/tests/chrome-check.mjs http://127.0.0.1:4311 C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-qa-20261011
```

No source Figma session, actual-daemon control operation, generation, validation, guarded application or final freshness acceptance was executed by the frontend worker. Injected fixture control operations in the approval regression remain test evidence only. The complete repository suite and source/artifact checks remain coordinator responsibilities. Focused Chrome editing/HTTP behavior is now recorded, and the coordinator inspected the earlier desktop/mobile layout. Independent final recheck, real-daemon failure/cancellation feedback, official-MCP authorization and actual agent submission still need their own recorded evidence. A frontend module or focused UI pass does not establish those outcomes.

## Continuation priorities and product limits

1. Complete independent review and the final integrated Chrome recheck; preserve the earlier ten-check and latest eleven-check checkpoints and inspect the final screenshots against the actual integrated source.
2. Integrate backend/package/provenance changes and run the required native source/artifact checks against the integrated source.
3. Exercise real service plan/run status and failure/cancellation paths without disturbing retained source-Figma sessions or resetting run budgets.
4. Preserve the required official MCP and independent Chrome acquisition/generation acceptance workflows. Portal editing and unavailable-server UI checks do not satisfy them.

The portal is a loopback local operating interface. Workspace registration and native Chrome/Figma authorization remain service setup responsibilities. It intentionally exposes the current sequential engine limit, structured requirements and coding-agent submission instead of inventing support for branch execution or unattended generation. Broader execution topologies and an embedded coding worker remain product decisions outside this implementation.
