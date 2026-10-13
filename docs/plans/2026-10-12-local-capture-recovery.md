# Local capture recovery and connection visibility

Date: October 12, 2026 (Asia/Seoul).
Baseline: main/native source `sha256:31e47b614fbc093b160d562e7b4107a4c1ad473965237b086f100663bb4f5ef5`; the renewed whole check remains pending. Read [the recovery analysis](../analysis/portal-local-capture-recovery.md), [the live record](../testing/2026-10-11-web-portal/retained-tab-live-qa.md), and [repository instructions](../../AGENTS.md) before implementation.

## Confirmed problem

A failed local Chrome capture can remain an unknown composite with no daemon operation. Its public Inspect action cannot settle that row. The unresolved row permanently blocks same-workspace mutations and null-scope administration, including data-policy configuration. The portal also discards non-approval CLI progress and the CLI emits no connection phase before its Chrome open resolves. These gaps obstruct the requested portal workflows and debugging.

## Required behavior

Separate an explicit owner decision about the local capture fence from the original unknown outcome. Release only narrowly allowlisted local Chrome capture fences, bind the exact current row/workspace and acknowledgment, require producer/deferred-mutation quiescence, and persist a durable audit. Keep the original status, identifiers, timestamps, deadline, argument hash, result and evidence unchanged. The action dispatches no original capture, grants no model permission and cannot resolve daemon-journal unknowns. An unavailable quiescence proof must leave the fence intact. Legacy evidence may require an explicit operator assertion in addition to observable current-runtime checks; any such limitation must be named rather than represented as machine proof.

For future operations, add trusted service-owned proof of a failure before capture actions or local writes were issued. Mark unsafe opening/selection intents before they can be queued and mark output creation/source actions before dispatch. Do not infer proof from an error message, a missing directory, arbitrary caller fields or old rows. A genuine new pre-effect failure can end as failed; uncertainty stays unknown. Never retroactively classify the existing failed captures through this new mechanism.

Expose a bounded set of safe connection/capture phases. Emit a connection-attempt phase before opening Chrome, retain only closed phase names and safe counters in portal diagnostics/history, and show those phases without persisting URLs, endpoints, arguments, tokens or messages. Connection-attempt visibility does not prove a native approval popup exists. Refresh active jobs while preserving input and confirmation drafts. Do not introduce automatic security approval or automatic retries.

## Execution and verification

Implement in the managed copy while main/native remain frozen for their current whole check. Give one implementer ownership of the recovery/proof/progress change and a separate reviewer ownership of independent tests/reporting. Verify durable recovery, restart persistence, unsupported and journal-backed rows, wrong confirmation/binding, busy or unresolved producers, partial writes, cancellation, late completion, forged proof and unchanged unknown outcomes/deadlines. Verify progress privacy and browser draft preservation through owned installed-Chrome fixtures. Integrate only reviewed exact files after the current source check settles, reconcile provenance and rerun required native gates.

The operator must review and expressly authorize any actual fence disposition. Earlier Chrome Allow and the pending eight-hour model-data question do not authorize it. Actual capture, CDD/frontend acceptance, official MCP authentication and the subsequent eCommerce tests remain separate gates.
