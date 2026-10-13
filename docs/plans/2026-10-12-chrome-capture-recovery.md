# Chrome capture recovery after native authorization

Date: October 12, 2026 (Asia/Seoul).
Source baseline: `main` at `22517932dc9b2cb974c177ec4eacb84d4b16e254`, extensive existing uncommitted changes; verified main/native source `sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`.

## Evidence and scope

The existing primary portal Chrome tab successfully reused its source connection for two explicit reads. Actual independent acquisition then found no page-global API. A separate native-export request failed because the Figma web Dev Mode upgrade dialog intercepted Main menu clicks. See [the live record](../testing/2026-10-11-web-portal/retained-tab-live-qa.md). Those failed composites remain unknown, with their original workspace fences and private partial artifacts. The previously expired preparation, runs, leases and egress grant are not renewed or replayed by this plan.

The immediate implementation owns only the CLI native-export module and its Chrome test file. Add a bounded preflight that recognizes the exact upgrade dialog and clicks only its scoped Back to Design Mode button. Check original file URL, deadline and cancellation before and after each asynchronous step. Unknown dialogs, paid actions and native security approvals remain outside this handler. Install the export Blob hooks only after preflight succeeds, and retain existing cleanup and byte limits.

## Execution and review

1. Implement the two-file candidate in the managed copy, preserving any stale managed source before refreshing those exact inputs.
2. Verify actual installed-Chrome fixtures for successful dismissal/export, rejection or non-interaction with unknown dialogs, paid-action absence, identity/cancellation/deadline boundaries and hook cleanup. Keep owned headless fixtures separate from the live source session.
3. Independently review the frozen candidate, integrate only its exact files, reconcile source provenance and run applicable native checks and a fresh whole/artifact check. The f0dc pass does not cover new source.
4. Use fresh owned validation state/output for the repaired live acquisition. Preserve both original primary unknown jobs and their fences. Keep the same visible portal tab and source Chrome session; never copy an old grant into fresh state.
5. Re-probe actual page-API availability after returning to Design Mode. If still absent, preserve that result and use independently acquired native export facts only within their evidenced coverage. Do not fill this collector from Scripter or claim full capture from bounded parity.
6. Obtain any required fresh data-egress authorization with its concrete current scope before model-context collection. The public allow action currently grants four data classes for eight hours; native Chrome Allow does not authorize it.
7. Complete fresh CDD generation/repair acceptance before the final separate-output eCommerce tests through Chrome and official MCP. Own-service official authorization and full-program capability remain separate unresolved prerequisites.

## Verification limits

This plan is authorized implementation and service-owned validation. It is not executed capture, final frontend acceptance, an unknown-operation resolution or an authorization renewal. [The canonical report](../service-analysis.md) remains the common analysis authority.
