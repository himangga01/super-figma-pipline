# Portal scope correction and main-agent decision

Date: 2026-09-07. Decision owner: main agent.

## Authoritative correction

The previous plan incorrectly applied a frontend-only limit to all four cases. The user clarified that this limit applies **only to case 4**. Cases 2 and 3 must learn the relevant complete legacy/reference service and implement everything needed for the portal's intended operation, including backend, APIs, persistence, authentication and other required layers. Case 1 inherits case 3 or 4 after reference resolution.

The [portal plan v2.0](../plans/2026-09-07-portal-four-cases-plan.md) is now authoritative. Earlier frontend plans and reviews remain historical, not current scope instructions. The user's additional instruction that new/edited Markdown be English is recorded in `AGENTS.md`.

## Changes to the implementation contract

| Earlier decision                                                      | Corrected decision                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontendOnly:true` for every request                                 | Case-derived `implementationScope`: C4 frontend-only; C2/C3 operational-portal.                                                             |
| Modify only frontend packages                                         | Analyze and modify the necessary target service graph across UI/API/domain/data/auth/config/jobs/integrations.                              |
| An unsupported existing API leaves the UI feature unavailable         | In C2/C3, implement or extend the required API/domain/data behavior where appropriate, preserving compatibility and evidence.               |
| Transfer only reference frontend code                                 | Transfer the relevant complete service patterns and implementation closure into an independently runnable target.                           |
| Globally forbid backend routes, migrations and auth/data dependencies | Forbid them in C4; permit required, scoped and validated C2/C3 changes with distinct environment effects.                                   |
| Frontend fixture success is the application acceptance target         | C2/C3 require real integrated backend/persistence/auth/domain behavior in the selected environment; mocks alone are insufficient.           |
| Proposed `frontend_*` orchestration family                            | Proposed `portal_*` family with the same canonical execution discipline; no duplicate unimplemented API families.                           |
| Upstream feature list implies utilization                             | Track presence, semantic parity/adaptation, actual workflow use, and execution evidence separately. Actively adopt useful missing behavior. |

The prior review's good execution decisions remain: actor/origin preservation, pre-approval scope resolution, role-bound references, independent status/cancel lanes, durable leases, multi-file recovery, source hashes and actual validation. Expand those mechanisms to backend and environment resources rather than bypassing them.

## Active reuse decision

The three original projects contain useful features that the service does not yet fully use. Adopt their design grounding, mapping, token/style, asset, prototype/motion, font-safe editing, target/variable helpers, typed compositions, diagnostics and workflow knowledge. The [cross-source audit and adoption backlog](2026-09-07-upstream-adoption-audit.md) and three independent audits provide the concrete work.

Do not equate active reuse with invoking every canvas mutation on every run. The product must select relevant recipes, execute their supported primitives, and consume their results in the portal blueprint or validation. Deliberate transport/security replacements must retain useful behavior through appropriate typed adapters.

The first concrete adoption is implemented: `export_tokens` now includes local paint styles. Targeted tests, type checking, lint and MCP/CLI builds passed. This is not a claim that the complete portal engine, all helpers or every upstream workflow has been implemented.

## Review evidence and remaining implementation

The same three subagents independently audited Figwright, figma-mcp-rust and figmosha2 under the corrected scope, recording pinned versions and separate evidence levels. No upstream checkout was changed or fetched, and no live Figma test was performed in this audit. The main agent consolidated their findings and owns this decision.

Implement the v2.0 stages with their explicit gates. C4 can complete as a frontend; C2/C3 cannot be called complete while required backend or integrated service behavior is replaced by a demo or left blocked. Real external configuration or provider availability must be reported honestly, without inventing credentials or claiming production success from local tests.
