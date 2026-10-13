# Portal usage guide and actual user-flow verification

Date: October 11, 2026 (Asia/Seoul).

## Owner request and baseline

The owner could not understand how to use the integrated portal and explicitly requested a usage guide plus three actual operation tests. The previous three-round record included fixture coverage and a live capture timeout; it must not be represented as three successful user journeys.

Main and the native validation copy initially match `sha256:935216d1aadd504a3e3e1757fde2f7c5056329cdb76220730a64a2522aa184dd`, at published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus uncommitted integration work. Its whole check passed 5,105 cases, twenty existing skips and seventy required Chrome cases. Those results do not cover this new increment. Use [the service analysis](../service-analysis.md) and [previous portal record](../testing/2026-10-11-web-portal/README.md) as historical evidence.

## Implementation

1. Add a persistent, accessible Korean in-app usage guide and a guided new-workflow form. Explain the five stages, source URL versus output folder, supported cases, requirements, saving/checking/running, approvals, real states and next actions.
2. Let the owner register an existing local workspace through a closed, same-origin endpoint backed by the existing authenticated public service client. Do not create folders implicitly, change workspace identity, or expose arbitrary filesystem/tool access.
3. Report daemon availability and Chrome connection state separately. A first run must remain possible when Chrome is not requested yet, because starting the authorized capture initiates that connection. Native Chrome permission remains manual.
4. Replace manual decision-hash JSON with an evidence-bound requirement confirmation interface. Use only current recorded evidence and supported decision values; retain explicit user selection and a new saved run. Incomplete capture admits no decisions or coding lease.
5. Write an English companion guide at `docs/portal-user-guide.md`. Explain the existing coding-agent MCP/CLI handoff with concrete setup and operation steps; do not claim a bundled background model exists or require a normal user to manufacture lease/hash JSON.

Implement in managed checkout `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. Keep the native production source at the reviewed baseline until integration. The frontend, backend and actual-flow runner have separate owners. The coordinator alone controls the owner's source Chrome and performs production integration. No Superpowers, Docker, Codex browser/CUA or external Figma connector is used.

## Three actual user-flow rounds

All three use the current CDD file/page, separate new frontend output targets and no reference frontend repository. The existing CDD-before-eCommerce order remains unchanged.

| Round | Actual UI journey |
| --- | --- |
| 1 | Open the guide, register a new owned existing workspace, configure a new C4 workflow through the guided form, save/reopen/check, start independent Chrome page-API capture, explicitly review current workflow decisions and inspect the real run/context |
| 2 | Use the existing registered workspace, create a separate C4 workflow with Chrome/Scripter, edit/save/reload, run through current approvals and real capture/decision/context states |
| 3 | Reuse the owner's retained Chrome window and portal tab, use keyboard-accessible guide/setup and a saved workflow, select independent Chrome collection with another new target, and verify actual persisted inputs, execution, events and context |

Use only a service-owned installed-Google-Chrome Playwright runner against the real production portal and daemon. Do not fulfill HTTP routes, inject fake control responses or substitute directly posted plan JSON for the user-facing setup steps. Preserve request/result/screenshot evidence in a new attempt directory. Native permission controls are never automated.

The owner's later same-window instruction supersedes this plan's original fresh-session instruction for round 3. Separate owned headless fixtures remain permitted and must be labeled as fixtures. The [retained-tab execution record](../testing/2026-10-11-web-portal/retained-tab-live-qa.md) also records actual all-function testing in a separate native validation instance after primary portal restart was rejected by automatic approval review. This does not establish primary deployment or three complete generation/application journeys.

Track outcomes separately: saved/configured workflow, live capture complete and verified, current decisions admitted, coding-agent context/lease available, candidate generation, validation, guarded application and applied acceptance. An incomplete capture or an awaiting-agent state is not complete frontend acceptance. Repair reproduced service defects and rerun the affected user flow. Never reset a recorded deadline or replay an unknown mutation.

## Connection preparation, not a user-flow test

At 20:06 KST the unchanged native service successfully prepared CDD plan `sfp_portal1_f4471f834ea82da3f979b165e3a06c8c` through the independent page-API collector, with `complete:true` and `liveVerified:true`. The retained daemon reports Chrome connected. This was a separate CLI diagnostic/preparation call, not one of the three UI rounds.

The plan contains eight unresolved workflow scopes; its analysis hash and evidence identities still match the owner's previously confirmed product requirements. The actual plan at `.worktrees/_cache/cdd-guide-connection-20261011/plan.json` is a read-only shape/input reference for the new confirmation UI. Do not reuse its result as proof that a later user-flow capture or generation succeeded. Preserve daemon PID 41108 and its authorized Chrome connection while restarting only the portal backend as needed.
