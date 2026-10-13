# Independent service function integration review

Date: October 11, 2026, Asia/Seoul. This is a bounded ongoing review of the newly authored generic service-function catalog/jobs and settings integration in managed `4d3e/service`. The source was still changing under its separate owner during the initial finding; final reviewed hashes must be appended after the owner freezes. Follow the [repository instructions](../../../AGENTS.md), [portal integration record](README.md), and [canonical service analysis](../../service-analysis.md). The [settings report](figma-settings.md) separately records the seven settings paths and their frozen tests.

The feature catalog exposes registered CLI/MCP descriptors and validated forms. Its job manager persists original operation identities and status metadata, retains raw results only in bounded process memory, and requires actual retained service approval IDs or a distinct portal confirmation. Static inspection covered the server's same-origin/CSRF routes, closed descriptor dispatch, settings workflow binding, activity metadata, operation-proof inspection and frontend preview/action gating. This inspection does not establish actual execution of all public functions.

## P1: a pending confirmation could cross a newly created unknown-outcome fence

At 21:33:02 KST, an independent private test reproduced this sequence against the actual `ServiceJobs` class and `PortalStore`, with no daemon or browser:

1. Create a same-workspace write job B that waits for its portal confirmation.
2. Create write job A, retain its original operation identity, and throw a transport error after dispatch. Its durable state becomes `unknown`.
3. Approve B's already retained confirmation.

Before repair, B dispatched despite A's unresolved outcome. Expected dispatch history was `['first.write']`; actual history was `['first.write', 'pending.write']`. Creation-time fencing alone was insufficient because the wait separated admission from the effect. The author was notified immediately and accepted a repair covering approval, queued start, and the actual pre-dispatch retention boundary, with unchanged reviewed arguments and recovery classification.

The independent repro is managed `.cache/portal-job-review.test.ts`, with `.cache/portal-job-review-vitest.mjs` and retained `.cache/portal-job-review-red.json`. It uses generated private storage under `.cache/portal-job-review/`; no production store, control session, source Chrome or real workspace effect is involved. The final repaired-source rerun is still pending in this section.

## Verification limits

The owner subsequently required all active browser testing to reuse one existing visible Chrome tab. This reviewer stopped isolated browser launches and does not control the coordinator's production browser. The one earlier private guide fixture failed in its own response-wrapper assumption before activity assertions; it is recorded in [usage-live-tests.md](usage-live-tests.md), without being counted as a UI pass. Actual guide/activity/settings/full-catalog acceptance must use the coordinator's retained browser and integrated source. Nonbrowser and real-HTTP controlled fixtures remain available for final source-bound review.

## 21:53 repaired-source verification

The original independent pending-confirmation probe passed at **21:42:07** against the author's frozen repair. The manager retains the parsed read-only/recovery classification, checks same-scope unknown jobs and the trusted bridge's guided-run guard at confirmation, queued start and before/after durable operation retention. It does not reparse or replace the reviewed arguments, reset the deadline, or infer an original outcome from an unrelated status snapshot. The independent red receipt is preserved alongside `.cache/portal-job-review-green.json`.

The author's ten-path manifest [service-jobs-hashes.json](service-jobs-hashes.json), slice `de2cc13a3b1b45258833bb871750cd746475699116791d1f15b5fd9591f40130`, matched every reviewed file before the recheck. The actual job manager SHA-256 is `4ffb817ee3739ba6893ce6886a95b6aef3176adf4619e76e713a29340ab254d1`; bridge is `2497b28f32adfd41cfc93c896187d67d2a4c50a740423e0e210e9e6b81faf0fe`; server is `692263a807d76a258e3393cd0719313e6ef58b989fb84d792599b4e63261d8d6`. The independent four-suite run passed **107/107** at 21:42:08, including the settings author's additional environment-compatibility regression. P1 is closed on these reviewed sources.

The author subsequently added an exact read-only exception for the pure local features `tools.list` and `figma-mcp.config`, preserving mutation/recovery classification for other local operations. This reviewer independently reran service-job/control suites at **21:53:21: 26/26 passed**. Superseding hashes are `a0fe970a35f1e259db15e35467d564008be72f74e6a7957ff4acad20b8cbb8b8` for control and `375b611602f9afb13df44e3f9152716766c441a0d3711466013d92fc11bf2917` for its test. The separately reviewed public tool-catalog declaration correction is `bd5889dc589313207f10af146010165e88420844b40877c2e616496d97142a77`; the CLI feature adapter observed during preparation is `b38e06b6562bd5289edfcca1fde79fdcd12e31b1c6c167afa04482155b87fc8f`. See the author's [feature backend review](service-feature-backend-review.md) for its independent Desktop invocation and native portability findings; those are not relabeled as this reviewer's executed checks.

No remaining concrete defect was identified in this bounded nonbrowser recheck. This is not an all-function live acceptance claim. The private actual UI runner below is prepared but has not been executed by this reviewer.

## Actual all-function UI runner handoff

Managed `service/.cache/portal-all-functions-check.mjs`, SHA-256 `aee448cff5a455fc8fd8f4916e6b5852d2429e6d0c37c31b8d95d21431051a8c`, is ready for the coordinator to copy to the native service's same `.cache/` relative path. It imports the actual service web schema helpers and Playwright from that checkout. Syntax, scoped lint and formatting passed; **two nonbrowser preparation tests passed at 21:52:53**, generating locally valid examples for all actual **128 tool schemas and 58 feature schemas** and checking strict domain-registry interpretation. The initial example preparation failed for the snapshot-ID format and was corrected; `.cache/portal-all-functions-preparation.json` and `-green.json` retain both. Example preparation invokes no function and proves no UI acceptance.

The runner requires the coordinator's existing private `browserWsEndpoint` and production origin 4310. It uses exactly the existing tab/context and disconnects without creating or closing either. It does not change headers, storage, permissions or viewport, and contains no route fulfillment, fake control or direct POST shortcut. All requested service jobs and approvals go through visible forms, preview, request and action buttons.

Full mode searches and opens every actual descriptor and submits its form to the visible **preview only**; preview inputs are bounded test examples, not executed Figma writes. It then executes the explicitly allowlisted real reads: status, workspace list/default, egress status/audit, domain list, approval/operation lists, tool list and official MCP configuration. The daemon-backed official probe records its actual authentication/unavailable outcome without asserting full capture. The settings page is screenshotted separately. Plugin/write prerequisites are recorded as unexecuted, without claiming read-only Chrome proves those effects.

The only allowed mutation is the exact previously absent `portal-acceptance.example.com` domain. The runner rereads the actual registry immediately before adding, requires the actual job's portal impact confirmation, observes the real registry, then removes and verifies absence. It never removes a domain that was present initially. Cleanup is attempted in `finally` after an owned approval submission; unresolved cleanup remains an explicit failure, with no replay or fence bypass. Activity rows from the actual actions are filtered in UI and required to retain the same ID after reload. Evidence preserves screenshots, served asset hashes, sanitized HTTP receipts, exact job outcomes and per-entry reachability/preview results, with raw job bodies and credentials excluded.

```powershell
# Existing-run handoff and activity continuation only. Keep that real run visible first.
node .cache/portal-all-functions-check.mjs --config <private-config.json> --execute --handoff-only --handoff-service-run-id <actual-service-run-id>
# Full catalog and explicitly scoped actual service actions, after coordinator integration.
node .cache/portal-all-functions-check.mjs --config <private-config.json> --execute
```

The handoff-only mode copies the existing run's actual handoff information and verifies activity persistence without starting another design run or acquiring a coding lease. It is a continuation receipt, not a fresh complete usage round. Actual execution, production restart, source Chrome and final acceptance remain with the coordinator. This reviewer has performed no live function action or new browser launch after the owner's reuse instruction.

## Later actual all-function run and Windows domain defect

The coordinator's distinct 4312/3056 QA run subsequently reached all 186 real UI previews and the requested read functions, but actual domain addition failed and retained an unknown composite job. The [Windows ACL repair record](network-domain-acl-repair.md) contains the exact source-level cause, real-permission regression, temporary-file replacement protection, 152-case related verification and prepared-profile authority impact. The original unknown job remains unresolved and fenced; later observed empty domain state does not prove its terminal outcome. No full all-function mutation acceptance is claimed from the partial run.

## October 12, 00:02 independent activity-filter review

The author reproduced an actual HTTP race in which a delayed activity load erased an unsubmitted `guide.open` filter. The reviewed repair separates `activityFilterDraft` from the applied query. Rendering first reads current form values, then restores the focused named field and its selection without scrolling. Refresh/paging still clone the applied filters. The existing request epoch discards stale successes and errors before they can update records or render over a newer applied query.

Privacy inspection found no new raw-input logging path: filter input/change listeners update only local draft state; the global input logger excludes this form; submitting records only the activities view and a boolean `hasValue`. Draft values are escaped when rendered. Named select/date controls are refocused without applying text-selection APIs when the browser provides no numeric selection range.

The three exact frozen hashes were verified:

- `packages/portal/web/app.js`: `61842fbf00d44dca7fa0a0a76c495914dc15ce8b2ba16965d7141781512e350a`
- `packages/portal/web/tests/chrome-check.mjs`: `353d71ccb6bbc41ddcae2f90688886eef72fe6dc2d3d2e227c88e4a31d6b754b`
- `packages/portal/test/browser.test.ts`: `22e90dd20dd5c512277f11259cf0487b927af8330d10594a1ed2b2b99865768e`

This reviewer independently ran the owned installed-Chrome HTTP wrappers at **00:02:21 KST on October 12**: **2/2 passed**, preserving the previous eleven checks and adding three for unsubmitted text/focus/caret, explicit application with real matching persisted records, and rejection of an older delayed response. The fixture holds and then continues actual GET requests; it does not fulfill fake responses. Receipt: managed `.cache/activity-draft-independent-browser.json`. No actionable issue was identified in this bounded change. This check uses isolated fixture storage and controlled service availability, not the production daemon or source Figma; it does not replace any real usage round or generation acceptance.

## October 12 independent nonce-only DELETE review

The [bounded transport review](delete-nonce-transport-review.md) verifies the exact client repair for egress reset, workspace removal and default clearing. Its independent 43/43 pass covers actual HTTP framing, closed-path matching, nonce rejection and no mutation retry. The original actual reset job remains unknown; a fixed future operation cannot establish its missing original outcome. Read this later source-bound review together with the [retained-tab operational record](retained-tab-live-qa.md) before continuing live administration.
