# Execution efficiency and Fast mode review

Date: October 13, 2026, Asia/Seoul. Source: Main/native `sha256:6f87f836d872a4ba8ab49533f6447a7c921adb6b8af3dae75ddd6241e8b8a1cb`, main HEAD 22517932 with existing uncommitted work. Actual QA remains old 303d/ff198. Read [the canonical service analysis](../service-analysis.md) and [repository instructions](../../AGENTS.md) before continuing.

## Verified settings and limits

A read-only allowlisted scan of the local Codex config found model `gpt-6.1-sol`, reasoning default `xhigh` and `service_tier="fast"`. This verifies local defaults only. The current parent turn and each existing delegate's effective settings, or the provider's returned serving tier, are not exposed by the available tools. No global config was changed and no secret/config body was printed. [Official OpenAI Fast mode documentation](https://developers.openai.com/api/docs/guides/fast-mode) distinguishes requested configuration from the tier reported in the response. This does not prove this conversation's effective tier or justify changing the user's global preferences.

Fast model serving is separate from native tool execution. Actual records contain multi-minute compiler-profile preparation/registration, source reads and filesystem validation. They also expose avoidable agent/harness errors: delayed ordinary approval monitoring, unnecessary post-finish coding leases, invalid source encoding/catalog envelope, omitted TypeScript transform flag and wrong provenance path prefix. Root acknowledges these avoidable delays. Native-format, inconsistent navigation-budget and generated route-type resolution failures were separately reproduced and repaired without waiving criteria. No causal claim about provider latency is made without response/timing evidence.

## Revised execution policy

- At 21:41 KST, Root interrupted the long-running mechanical scoped-publisher preparation and preserved its fixed input/precision-comparison artifacts. Ownership transferred to a fresh `gpt-6.1-sol` delegate with explicitly selected `medium` reasoning and no full-history fork. The assignment is restricted to wiring already collected evidence, without new tests, builds, source edits or live actions. The same-state QA controller remains ready and blocked only on the final publisher output. This is a verified delegation-setting action; it does not prove the current parent request's serving tier.

- Keep all passing checks closed unless a relevant input/code change, failure or unresolved finding gives a concrete reason to rerun them. Never repeat the whole suite or already passed complete functional UI checks.
- The current nine-file code/catalog inputs passed exact changed statics, generated checks, provenance and build/package/artifact checks. The source is now fixed at 6f87. Do not rerun those checks while merely constructing the scoped release report.
- Publish the already executed evidence, seal the independently reviewed replacement helper, execute its actual preflight/replacement/postchecks, and then perform remaining CDD acceptance through service tools. No extra preparatory suite or historical-record census belongs ahead of this critical path.
- Reuse prior service-owned facts/results only when their exact input and authority remain valid. An expired run or retired issuer cannot be reconstructed from JSON or presented as current acceptance. Record the changed binding when genuinely fresh capture or validation is necessary.
- Use SOL delegates with separate ownership. Assign low/medium reasoning to mechanical artifact/result work; reserve high reasoning for evidenced security/authority or complex implementation review. Existing effective delegate settings remain unverified until explicitly configured for a new delegated run.
- Chrome/API control has one owner. Root owns integration and release review; other delegates work on independent source/artifact preparation. Stop or hand off an idle delegate instead of duplicating its completed checks.

## Current continuation and acceptance limits

The reviewed eight-file repair batch and one generated diagnostic catalog are integrated. Current source checks/build/package pass; runtime replacement and complete CDD acceptance are still pending. Independent same-CDD collector comparison, complete applicable C2/C3 and final main commit/push remain owed. The second eCommerce test is owner-skipped and official MCP live owner-deferred, neither passed. C2/C3 historical plan inputs reference the skipped file and must not be executed verbatim. Rebind only with the actual current scope and required workflow contracts; do not invent backend behavior or count C4 demos as full-case success.

This review is based on actual local config values, source-bound project receipts and official documentation. It is not a provider-side performance trace, a whole-source pass or a completed frontend acceptance report.
