# Independent own-service OAuth portal/control relay review

Date: October 12, 2026 (Asia/Seoul).

Read [the author record](own-official-oauth-portal-relay.md), [the portal design](../../plans/2026-10-12-own-official-oauth-portal.md), [the daemon candidate](own-official-oauth-daemon.md), [the canonical service analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md) first. This SOL reviewer owns no relay product files. Main/native remain at a476; real client credentials, consent, runtime state, Chrome and unknown operations were untouched.


## Current revision-two approval

**The repaired eight-file relay is approved for scoped integration**, at manifest `c2e91af7753aa25d5bf4563b33a22bd025b188b809cde987cc38275753fcaecf`. Every managed and copied-fixture hash matched before final review publication. Only four relay paths changed from initial source: control client/test and portal server/test. The private bearer continuity proof now repeats after awaited admission, with no additional awaited work before request creation. The independent regression that previously observed one forbidden request now observes zero. Existing one-use, closed-error, no-retry and private header-only behavior remains intact.

Executed final independent R3 result: **69/69, zero failures/skips**, comprising 68 author cases and the added independent owner-wait regression. Receipt SHA-256 `1b52b762f4a3b67fdbbf5325269fd616a545dfadd4ad180b277dea53090c475e`; exact source/receipt evidence `d9516b8f374610c4eaaa3ce220e657ebdf84d95d8e579ae55daa9b4b3472c3db`. CLI no-emit typecheck (only the untyped private review probe excluded), portal no-emit typecheck, all eight owned deny-warning lint and formatting checks exited zero. Static receipt SHA-256 `4b948e70deba6cbf4c396c2f291a44ec91bb019598c035fcf8dc58384c81c0a6`. No fixture output path overwritten an author receipt. Original eight source files and manifest remain archived at `service/.cache/oauth-relay-independent/source-r1/` and `manifest-r1.json`; both failed R1/R2 receipts remain intact.

The dedicated consent GET alone now sets `referrer-policy:same-origin`, preserving the real browser's same-origin native POST Origin. Normal portal responses, private 303 handoff and callbacks retain no-referrer. Root/UI owner supplied the separate installed-Chrome Origin:null reproduction; this review verifies changed response policy and strict Origin/form guards in actual owned HTTP fixtures, not that Chrome observation. External destinations still receive no referrer. The pure shared contract remains `b46deab1f5cb5b15988f07a1b9229559fb7857421ec3736036558d5aa9181006`.

Approval covers the concrete repaired finding and these eight source files. It does not claim atomic process/fence exclusion, real spawned-daemon identity, actual Chrome navigation, packaging, combined whole-source acceptance or official authentication. Root must retain the sequential-snapshot limitation and complete those separate gates.

## Initial reviewed source and result

The initial eight-file RELAY8 manifest SHA-256 is `df213eb8ab121d6a2512261f71c29e7c00f1c9f676db6d49a5633eeb2d6a32a6`. A private regular source fixture at `service/.cache/oauth-relay-independent/fixture/service` contains those exact hashes, verified against the copied fixture. Six production files and two author tests were overlaid on main a476, with pure public contract `b46deab1f5cb5b15988f07a1b9229559fb7857421ec3736036558d5aa9181006`. Native installed dependencies are accessed for reads; no install or build was run. Subsequent author repairs are not part of this initial source result.

**Initial RELAY8 is not approved.** The author's complete 67-case cohort passed, while a new independent ownership-wait regression failed. Exact R2 result: **67 passed, one failed, zero skipped**. Receipt SHA-256 `9af45a4802f521b5521f3711988c9b67b795ffcecab28f14643627192b00e1b8`; source/receipt evidence SHA-256 `2316b1bc93b7cf1edb71d85cf533df91e77fbc53eb78f3b63a0b8e5169364134`.

## Reproduced finding

**P1: private control bearer can be sent after owner proof becomes stale during admission.** In initial `packages/cli/src/control-client.ts`, `officialFigmaOAuthHandoff` verifies the daemon/listener twice, then awaits trusted `beforeRequest`, then creates the authenticated HTTP request. If the owner changes during the awaited admission work, the second proof is stale before the bearer is sent. The response-stage proof cannot undo that disclosure.

The independent test uses an actual owned loopback HTTP listener, injected protected-state credentials and injected process proof. Its admission callback changes the trusted proof identity. Expected zero authenticated requests; observed one request. This is a service-control fixture, not an attack against or modification of a real daemon. No real credential or external network was involved. The frozen private regression path is `packages/cli/test/oauth-relay-independent.test.ts` inside the review fixture.

The author accepted the finding and is preparing a minimal continuity recheck after awaited admission, with no further awaited work before dispatch. Root explicitly chose that narrow repair. Final admission and native process checks remain bounded sequential snapshots, not an atomic lock or OS sandbox. A new unknown fence may arise during the final asynchronous process proof; do not describe that sequence as atomic process/fence exclusion. The existing no-retry policy limits uncertain handoff effects but does not create atomic authority.

## Source review and preserved boundaries

The read-only review found the agreed public status/action schemas unchanged. Local preferences contain only environment names and installed-contract references; safe status rejects undeclared fields. Status GET does not start/redeem a flow. Start/configuration/refresh/handoff check global unknown admission; cancel/logout remain exact auth cleanup and do not resolve unrelated unknown outcomes. Probe readiness retains provider/config/auth binding separately and invalidates late same-provider changes.

The native form exception is confined to the exact handoff POST. It requires same Origin/Host/fetch-site, navigate/document headers, a bounded UTF-8 form and exactly five unique fields. General mutation routes retain header CSRF. Consent GET is query-free and static, direct template access is blocked, global form-action remains self, and only the dedicated consent/redirect response permits the exact official endpoint. Redirect relay uses a single POST, exact 303 and one Location, empty body, closed query/resource/S256/loopback checks, closed errors and no URL-bearing JSON/stdout/activity. No redirect is followed with private daemon credentials.

The first review config accidentally named `control-http.test.ts` rather than `control-client-http.test.ts`, omitting 23 existing cases. R1 preserved **44 passed, one failed**. The corrected R2 cohort confirms all 67 author cases; the same new independent finding remains failed. This fixture-selection correction does not alter product bytes or claim a former pass.

## Limits and continuation

The revised exact manifest and independent regression are approved as recorded above. Continue with root-owned combined integration and acceptance gates. Scope approval must stay separate from the root's combined integration/package/whole checks and real authentication. The tests inject the Windows ownership proof and protected credential port; actual spawned-daemon PID/start/listener ownership is not established. Actual installed-Chrome native Origin/CSRF/form/CSP/303/tab behavior remains a separate combined gate. No actual approved client contract, login, exchange, refresh, tool entitlement, full capture, parity or frontend acceptance is inferred from fixtures. Root owns artifact packaging accommodations for the raw template and canonical nonce-substituted consent route.
