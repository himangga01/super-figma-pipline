# Repository instructions

- Write every new or edited Markdown document in English, including headings, tables, comments, and examples that are explanatory prose.
- Existing historical Markdown documents do not need translation unless they are edited. Preserve historical review evidence; link to an English replacement when superseding it.
- This documentation rule does not change the user's preferred language for conversation.
- Do not use Superpowers skills for work in this repository.
- Do not use or install Docker. Run validation with the project's native toolchain in a separate working copy, and state the actual filesystem/process protection limits accurately.
- This is a Chrome-only service. Use Google Chrome for browser capture, previews, validation and browser tests. For owned headless sessions, select Playwright's `chrome` channel and the installed Google Chrome executable; keep the user's existing Figma session separate. Do not introduce alternate browser engines or fallback runtimes.
- Figma MCP integration supports only Figma's official servers. Primary live collection and frontend acceptance use Chrome, Playwright and authorized remote control of Figma Web. When official MCP reads are available, compare their recorded facts with the Chrome collector and repair discrepancies; supplemental reads do not establish complete capture or frontend acceptance.
- The active scope is defined in `docs/plans/2026-09-07-portal-four-cases-plan.md`: only case 4 is frontend-only; legacy/reference cases require the relevant complete portal. Earlier all-cases frontend plans are superseded historical documents.

## Service-owned acceptance tooling

- Test the service through its own CLI, MCP tools, collectors and validation pipeline. Do not use Codex browser control, the Codex in-app browser, CUA, or Codex-connected external tools to perform or substitute any service test step.
- Open and control Figma in Google Chrome through the service's Playwright path and the user's authorized remote-debugging connection. Official Figma MCP tests must use the service's official-server integration, not the Codex Figma connector.
- Repair missing or failing service capabilities, then rerun the service workflow. Do not bypass a failure with an external tool or count externally collected data as a successful service capture, generation or acceptance result.
- Preserve earlier external-tool observations as dated supplemental evidence only. They do not satisfy service acceptance. Keep source Figma sessions separate from owned Chrome preview sessions and never automate browser security approvals.
- Support a bundled local development-plugin acquisition path for Figma Desktop, with its required code/UI/resources included. Chrome remains the only browser for web acquisition, previews and browser tests.
- Implement independent Chrome acquisition through service-owned Playwright/CDP without Scripter. Compare its facts against service-owned Chrome/Scripter acquisition on the same file and node scope, repair missing or differing collection/normalization behavior, and repeat the comparison. Do not populate one collector's output from the other's output to manufacture parity.

## Service analysis

- For every substantive analysis, first read the relevant existing report and the shared policy at `C:/Users/강지혜/.agents/analysis-policy.md`. Verify the report's baseline against the current branch, working tree and newer evidence before reusing conclusions.
- Update the relevant project Markdown report before the final reply. Include the date, source baseline, implemented behavior, findings, evidence, verification limits and concrete continuation steps. Preserve historical evidence and keep project Markdown as the common handoff authority across agents. A chat-only analysis is insufficient.
- Reuse existing reports in `docs/`; use `docs/code-analysis.md` or `docs/analysis/<topic>.md` only when no relevant canonical report exists. Record newly established canonical paths here. Link the updated report and this instruction file in the final analysis reply.
- Use [docs/service-analysis.md](docs/service-analysis.md) as the canonical service-analysis report. For future service-analysis requests, read it first, verify its source baseline against current code and newer evidence, and refresh affected sections rather than assuming historical results are current.
- Save service-analysis results in that English Markdown report, with the analysis date, source baseline, evidence, implemented behavior, open issues and actual verification limits. Preserve dated historical review evidence.

## Reboot handoff

- For the latest reboot request, read [docs/handoff/reboot-2026-10-04-evening.md](docs/handoff/reboot-2026-10-04-evening.md) first. It supersedes the earlier runtime state, preserves the R8/frontend and source-change backups, records the interrupted current-source whole check, and identifies the unresolved R3/R4 control failures. Its final section is the current remaining-work list (09:47 KST, October 5), separated into owner inputs and agent work. Never treat a pending pointer from the stopped check as a pass or replay an unknown-outcome operation automatically.
- Then read [docs/testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md](docs/testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md) for the continuation after that handoff (October 4, from 21:44 KST, no reboot). It records:

- the HTTP 500 diagnostics and the established R3–R5 cause, a timed-out authorization probe during monitoring;
- the typed busy and bounded-monitoring repair;
- the verified code-review findings and repairs;
- the successful R6 preparation;
- the memory-interrupted whole check and the later passing whole check `a59a6e15...` at source `ac67794d...`.

Then read [docs/testing/2026-10-04-ecommerce-parity/native-effects/README.md](docs/testing/2026-10-04-ecommerce-parity/native-effects/README.md). It covers the later independent native collector increments (effects, strokes, sizing, text and container fields, 87 compared fields) and the 36 remaining fields. Its source `62023ddd...` still needs a fresh whole check.

It is evidence; `docs/service-analysis.md` remains the canonical analysis.
- Before resuming after the planned reboot, read [docs/handoff/reboot-2026-10-04.md](docs/handoff/reboot-2026-10-04.md). It records the verified source baseline, generated frontend backup, private state locations, expired egress/run budgets and restart sequence. Recheck live connections after restart and preserve the existing applied output. Continue to use `docs/service-analysis.md` as the canonical analysis authority.
- For the later October 4 continuation, also read [docs/testing/2026-10-04-cdd-resume/README.md](docs/testing/2026-10-04-cdd-resume/README.md). It records fresh R8 evidence and subsequent repairs after the published reboot baseline. Update that execution record and the canonical analysis after new results; retain earlier failed runs and distinct source fingerprints.
- Also read [docs/testing/2026-10-04-ecommerce-parity/README.md](docs/testing/2026-10-04-ecommerce-parity/README.md) for the later complete eCommerce preparation and independent field comparison. Keep bounded field parity distinct from complete independent acquisition and final frontend acceptance.

## Additional final acceptance

- After the previously requested implementation, case acceptance and review/check gates, run [the final new-frontend acceptance](docs/testing/2026-10-02-final-figma-preparation/README.md) against Figma file `4IBhv1d8hEclifZQrOYxHS`, page `0:1`. Test official Figma MCP and unofficial Figma Web acquisition through Chrome, Playwright and authorized remote control, using separate new frontend outputs without reference frontend code. Preparation, metadata comparison and source fixture tests do not establish this final acceptance.
- The owner reconfirmed the execution order on October 2: finish the current CDD generation/comparison/repair acceptance first, then execute the eCommerce final test. Include the independent Chrome collector parity loop; do not forget or replace the official-MCP path or the no-reference-frontend condition.
- Before continuing live acceptance, read [the current CDD record](docs/testing/2026-10-03-cdd-generation/README.md) and [the independent collector record](docs/testing/2026-10-02-chrome-parity/README.md). Preserve the distinction between candidate success, guarded application, applied runtime checks, final source freshness and complete acceptance; do not reset recorded run deadlines or reuse a historical pass as a current result.
