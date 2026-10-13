# Service web portal implementation plan

Date: October 11, 2026 (Asia/Seoul).

## Requested outcome and baseline

The owner added a login-free frontend portal and backend web server for operating this service, with a configurable workflow canvas and a live execution map. This extends the ongoing collector/generation/case acceptance work; it does not cancel either Figma target or the required official-MCP path.

At initial planning, the service had CLI, IR, MCP, shared and Figma plugin packages; its only source HTML entry was the Figma plugin UI. Published HEAD was `22517932...`, and source `1a5d6b0f...` subsequently passed its whole check. Initial portal implementation used a separate managed checkout. The owner then explicitly requested main integration and three web/backend verification rounds. That integration now matches `935216d1...` in main and the native validation copy, with all sixteen local source/package/runtime gates passed. See the [integration record](../testing/2026-10-11-web-portal/README.md) for the final runtime, evidence and incomplete live-source objective.

## Design brief

References were supplied by the owner and inspected on October 11:

- [7328](https://ref.theseeker.io/r/7328): light three-column builder, node-type accents, settings tabs and output schema.
- [7550](https://ref.theseeker.io/r/7550): node library, connected branches, selected-node configuration and save/test actions.
- [7548](https://ref.theseeker.io/r/7548): live execution graph, state filters, selected-node details and transfer/event history.

Reference HTML and original images are retained privately under `.worktrees/_cache/portal-ux-20261011`. The web research tool could not open these URLs; direct HTTPS reads succeeded. Reference viewing is design research, not a service acceptance test.

Use an original Super Figma Pipeline interface: a compact left navigation and node library, a central dotted canvas with draggable connected nodes and pan/zoom, and a right inspector. A builder view edits actual persisted configuration; a live view shows real execution state, events and outputs. Use white/light-gray surfaces, restrained blue emphasis, and distinct source/generation/validation states. No fabricated duration, cost, success-rate or connection statistics. Visible product copy defaults to Korean; project Markdown remains English.

The initial workflow contains Figma source, analysis/requirements, generation, validation and guarded application/output. Expose supported source choices: Chrome page API, Chrome/Scripter and official Figma MCP. Unsupported transitions, cycles or capabilities must produce clear validation feedback. Preserve existing run budgets and unknown-outcome fences; do not automatically replay failed mutations or an unknown operation.

## Architecture and ownership

Add `service/packages/portal` as the web application package. The backend worker owns `src/`, tests, package/build configuration and a small shared API contract; the frontend worker owns `web/` assets/modules/styles and browser-interaction tests. Coordinate contract changes directly. The coordinator owns repository integration, provenance, canonical reports and final service-owned Chrome acceptance. Other ongoing agents own separate files/checkouts.

Prefer the current native Node/TypeScript toolchain and existing service `ControlClient`/public tool interfaces. The server hosts the frontend and a same-origin JSON API, persists workflow definitions and bounded run history, and bridges only supported service operations. Do not expose an arbitrary tool, shell, filesystem or HTTP proxy endpoint. Reuse the daemon's admission, state, source capture, generation, validation and application rules.

There is no sign-in or account system. The initial server binds to `127.0.0.1` and remains useful from installed Chrome. Host/Origin checks, same-origin request integrity, private server-side control credentials, strict request schemas and bounded storage remain necessary. Login-free does not mean exposing local execution authority to unrelated websites. LAN/public exposure is not assumed. Never automate native Chrome approval.

The existing generator issues coding leases to coding agents. The web UI must show actual waiting-for-agent state, context and submission affordances when no worker supplies code. Starting a run is not successful frontend generation. Do not invent an automatic model result or conceal missing official MCP authorization.

## API coordination contract

The backend owns the authoritative typed contract and immediately shares exact shapes with the frontend. Cover bootstrap/health, registered workspaces, workflow list/get/create/update, graph validation, run start/list/get/events and explicit supported run actions. Run records distinguish queued, active, awaiting input/agent/approval, failed, unknown and completed, and retain per-node state and real output references. Save uses revision checking. Start validates the saved graph and binds its revision. Response errors contain stable codes and user-safe explanations, never credential values.

The frontend uses a small API module, renders real unavailable/error/empty states, and persists canvas positions and inspector configuration through the backend. Node addition/removal/connection and selected-node edits must affect the saved graph. Execution actions must call the backend. Templates are labeled unexecuted drafts. Output/schema/event panels display recorded values. Any unavailable action is disabled with its concrete reason.

## Work and acceptance

- [x] Backend: persisted graph schema and constraints, revision fencing, local HTTP/static server, guarded public-service bridge, real run/events and explicit cancellation/action routing. Test malformed graphs, unsafe paths/origins, stale edits, daemon absence, failed/unknown operations and no fabricated completion.
- [x] Frontend: polished referenced layout, navigation, node library, editable canvas, inspector tabs, source/case settings, output schema, live map, execution history and real action feedback. Test save/reload, selected-node editing, graph edges/zoom, run failures and keyboard access in owned Chrome.
- [x] Integration: one documented native start command, coherent package/build/test wiring, production assets, focused review, updated provenance and current-source whole/artifact checks.
- [ ] Acceptance: use only service-owned native/Chrome tooling to open the portal, persist a workflow, invoke a real service plan/run, display actual capture and run states, and verify applicable generation/validation/application results. Keep source Figma Chrome separate from owned portal preview Chrome. No Docker or Codex browser/Figma connector.

The owner explicitly requested parallel implementation. These tasks proceed within that authorization; no extra design-approval round is introduced. Commit/push and external publication are not part of this added implementation step.

Final verification disposition: round 1 passed 58 cases; round 2 independently passed 58 plus thirteen adversarial cases. Round 3 passed production-server persistence, seventeen actual Chrome UI/live-map checks, status refresh and four-archive startup, but final-source CDD R6 encountered a connection timeout. It correctly retained incomplete capture and issued no coding lease. The successful Figma acquisition and complete generation/validation/application objective remains unchecked above. The whole check passed 5,105 cases with twenty existing skips, including all seventy required Chrome cases; the separate artifact-content case passed 1/1.
