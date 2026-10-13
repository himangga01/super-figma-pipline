# Activity filter draft preservation

Date: October 11–12, 2026, Asia/Seoul.

## Observed behavior and scope

The parent reproduced a live same-tab UX race: opening Activity History and immediately typing into the action filter lost the unsent input when the initial asynchronous history load rendered the page again. The resulting request had no action filter and showed unfiltered records. This report supplements [activity history](activity-log.md), [the user guide](../../portal-user-guide.md), [canonical analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md).

The worker synchronized the current native `app.js`, existing Chrome runner and its wrapper into managed `4d3e/service`. Ownership was limited to those three paths. The service backend, activity storage schema, applied-query API, visible owner Chrome and runtime state were not changed.

## Implemented behavior

The activity form now has a distinct in-memory filter draft. Input/change events update that draft without changing the applied query. Before replacing the rendered page, the app captures the current form values, including disabled fields, and the focused field's selection. The new form renders the draft and restores that field's focus and selection with no scroll jump. Navigation away retains the draft without focusing a hidden or different view.

Only explicit form submission converts the draft dates and replaces the applied query. Refresh and pagination continue to use the applied query. The existing request epoch comparison is unchanged, so an older response cannot replace results from a newer applied filter. No raw filter values were added to activity telemetry.

## Executed regressions

The existing owned installed-Chrome runner still uses the actual portal HTTP server and real isolated store. It delays a real GET request and continues it normally; it does not fabricate a response or perform a live acceptance action. Three checks were added after the original eleven:

- The delayed first load preserves unsent action text, focused input and its selected character range. A refresh still sends the original unfiltered query rather than silently applying the draft.
- Explicit Apply sends the actual `guide.open` query and shows matching persisted records produced by the guide UI.
- An older held response for `guide.open` cannot overwrite newer `workflow.update` results or the newer filter draft.

RED at **23:56:37 on October 11** reproduced the original empty string versus `guide.open` failure. The selected check passed after implementation. After one test-helper scoping lint correction, the final complete browser wrapper passed **2/2, zero failures/skips**, at **00:00:17 on October 12**. This retains the earlier save/approval coverage and now verifies fourteen runner checks. Portal TypeScript, scoped lint and formatting passed. No new Chrome-suite file or registry exception was added.

The independent reviewer subsequently verified the exact three hashes and passed the same two actual-HTTP Chrome cases at **00:02:21**, retaining all fourteen checks and finding no scoped issue. Its private receipt is `.cache/activity-draft-independent-browser.json`. The parent separately reported six successful same-tab live settings/activity checks after integration, including a retained filter and the original job remaining unknown; that execution belongs to the parent's live QA record, not this worker's fixture result.

## Frozen paths

| Path | SHA-256 |
| --- | --- |
| `packages/portal/web/app.js` | `61842fbf00d44dca7fa0a0a76c495914dc15ce8b2ba16965d7141781512e350a` |
| `packages/portal/web/tests/chrome-check.mjs` | `353d71ccb6bbc41ddcae2f90688886eef72fe6dc2d3d2e227c88e4a31d6b754b` |
| `packages/portal/test/browser.test.ts` | `22e90dd20dd5c512277f11259cf0487b927af8330d10594a1ed2b2b99865768e` |

The parent owns integration and renewed whole-source verification. This UI repair does not resolve an unknown operation, make a capture complete or establish generated-frontend acceptance.
