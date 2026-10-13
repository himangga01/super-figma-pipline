# Own-service official OAuth portal/control relay

Date: October 12, 2026 (Asia/Seoul).

This implementation follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [the portal integration plan](../../plans/2026-10-12-own-official-oauth-portal.md), [the authorization analysis](../../analysis/official-mcp-authorization.md) and [the independently reviewed engine](own-official-oauth-engine-review.md). The coordinator owns main/native integration, live runtime/Chrome and final acceptance. This author owns only six managed production files and two new tests; daemon/provider and web/public-CLI work have separate SOL owners.

## Baseline and revision 1 source

The six before hashes were read from unchanged main source `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`; both tests were absent. This candidate is excluded from that source's passing whole/artifact checks. Main/native source, actual portal/Chrome/state and the owner's index were not changed.

The original eight-file freeze is preserved at managed `service/.cache/oauth-portal-relay/revision1-preserved`, including manifest SHA-256 `df213eb8ab121d6a2512261f71c29e7c00f1c9f676db6d49a5633eeb2d6a32a6`. Its independent ownership-order finding superseded source approval; the revised freeze is recorded below. The pure shared contract dependency was `service/packages/mcp/src/control/figma-oauth-contract.ts`, SHA-256 `b46deab1f5cb5b15988f07a1b9229559fb7857421ec3736036558d5aa9181006`; it is owned by the daemon author and may receive formatting changes without schema changes. Rebind its final bytes during combined review.

| Owned path | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `service/packages/cli/src/control-client.ts` | `3f6818b0f685060bf639e30418347bce0fcd9501cdea30639ee7fdf230fbc20e` | `fa3aba3b7310747814d4a89dce11962d1d186ef2e8954a0e64889c3b21845afe` |
| `service/packages/cli/test/control-client-oauth-handoff.test.ts` | `new file` | `3611b09204301b1a3bd4d6c080f9ac342a0693d301d1f9cdf163cf3a1f8188fa` |
| `service/packages/portal/src/server.ts` | `3196dbefedaa3c67293ee81a583dd76827e0c16fd6e84acf511f1820946cc594` | `bd7e7e860b976dc6230a0c83aa073327e777ee2bba5b0e7bcc3b510a4038425e` |
| `service/packages/portal/src/control.ts` | `decf556b34e21d5ad7048b26088f468121793834ad8bed07a71f54d336bd097e` | `d7623e55517a393ac19ea9aec13f1147af597be6cfd016458b7ea674888cfb18` |
| `service/packages/portal/src/bridge.ts` | `56db66aaef06b09f184f72728a2a5123c20c1e9581a0323995c6ab81b3cb999d` | `5e729885279e81964144f450c59fd56747282541d0ad90d2a76b6f5ac93ce5b2` |
| `service/packages/portal/src/figma-settings.ts` | `0e2a4f9612dfdefbdbe7dc615f239f96476de9bab1f2cbb7d57c5d82b628ac90` | `c5ebe016937ac62a3940846897c707192ff2d835499d2682867c3875b764b8ea` |
| `service/packages/portal/src/contract.ts` | `0a77805d3a9332c966948f411ee47bb1afd4929aa852a673f993f80c571bd1e3` | `093c1d201aeadc83d157a1770f2e826686ca8db2a2e188b375c95809314d8e84` |
| `service/packages/portal/test/figma-oauth-relay.test.ts` | `new file` | `4e016839933d454c0f1f15fbde766d9ca0484ba970e4627c618eea4c3e8b76d0` |

## Implemented behavior and interface

The portal persists only public preferences. Modern PUT `/api/figma-settings` accepts `revision`, flat `providerInstanceId/configurationGeneration/authGeneration` and nested public `configuration`. The configuration is endpoint/mode, OAuth-token/client-ID/client-secret environment **names**, installed contract reference and digest. It maps to the daemon's POST `/control/figma-mcp/auth/configure`, verifies same provider and nondecreasing generations plus exact returned configuration, then commits the local CAS. A daemon mutation followed by failed local persistence is not automatically retried; read back both authorities. Legacy endpoint/environment-name PUT remains local preference behavior and starts no login.

The existing daemon base authentication schema remains unchanged except Boolean `oauthLoginImplemented`. Separate auth status is the agreed pure `FigmaOAuthStatusSchema`. It contains safe provider/config/auth generations, public configuration refs, closed stage/code, expiry, non-secret flow UUID, handoff availability, declared eligibility source and server-authorization observation. It never contains authorization URL/query, callback code/state, credential values or tokens.

| Portal route | Control route/action | Admission and output |
| --- | --- | --- |
| GET `/api/figma-settings/auth` | GET `/control/figma-mcp/auth/status` | Exact safe status; no query parameters or auth start |
| POST `/api/figma-settings/auth/start` | POST `/control/figma-mcp/auth/start` | Flat binding plus original absolute deadline; protected JSON/header CSRF |
| POST `/api/figma-settings/auth/refresh` | POST `/control/figma-mcp/auth/refresh` | Same binding/deadline; explicit action only |
| POST `/api/figma-settings/auth/cancel` / `logout` | Matching control action | Flat binding plus nullable flow ID; exact owned cleanup stays available during unknown fences |
| POST `/api/figma-settings/auth/handoff` | Dedicated private control handoff | Native form only, one POST, private 303 Location only; no JSON URL/body |
| GET `/figma-auth-consent` | No control mutation | Query-free static document, one replaced nonce, no-store/same-origin referrer policy and narrowly scoped CSP |

Configuration/start/refresh/handoff are global owner mutations and overlap every retained service-job or guided unknown fence. They check before admission, again after queued/status waits, and immediately before the real control request through a trusted `beforeRequest` callback. Cancel/logout do not clear an unrelated fence. Safe fence codes survive a last-moment refusal. No original job, deadline, grant, operation or evidence is changed.

Probe readiness now retains `lastProbe.authBinding = {providerInstanceId,configurationGeneration,authGeneration}` separately from old `result.authentication`. A current new provider must match that tuple and existing settings revision/endpoint/base provider/environment/credential checks. Same-provider refresh/logout/config generation changes invalidate old readiness. A changed auth tuple during a held probe/read rejects stale publication. Old daemons explicitly lacking the new status retain legacy behavior; unsupported new auth APIs fail closed.

### Private redirect transport

`ControlClient.officialFigmaOAuthHandoff(raw, deliverLocation, options)` returns `Promise<void>`. The validated URL reaches only a trusted server callback, not a returned/archived JSON value. It sends one POST, never follows a redirect and never retries a consumed handoff. Existing general JSON request/redirect/retry semantics remain unchanged; the optional trusted dispatch callback adds a final admission check.

The default private relay currently proves Windows daemon ownership through its public leader note, live PID/start time, Node executable/service entry and sole literal-loopback listener. It matches leader generation to protected local control credentials, checks continuity before admission, repeats physical continuity after the awaited admission immediately before socket creation, and checks again before delivery. These sequential bounded snapshots do not provide OS-atomic ownership or fence admission across socket creation. Unknown platform/identity is blocked rather than guessed. The fixture seam is a trusted host function, never a public body field. This is native continuity protection, not an OS sandbox or general cryptographic mutual authentication.

The 303 must have exactly one Location and no body. The destination is exactly `https://www.figma.com/oauth/mcp`, with closed single query fields, the official resource, `mcp:connect`, code response/S256, bounded client ID, state/challenge shapes and a query-free literal-loopback callback. Userinfo/fragment/foreign destinations/duplicate or additional fields are rejected. Every transport/proof/delivery error is projected to fixed closed errors without raw URI/body/cause. The server validates the official destination again, holds it only in a local closure until safe audit settlement, then emits its private header and empty response.

### Consent document and form

The UI owner supplies `web/figma-auth-consent.html/js/css` and `figma-auth-public.js`. The HTML must contain `__SFP_FIGMA_CONSENT_NONCE__` exactly once on its module-script nonce. Direct `/figma-auth-consent.html` is blocked so the dedicated route cannot be bypassed. Normal portal CSP remains self-only for forms; only the dedicated document/validated handoff allows the exact official consent endpoint. No GET redeems or starts login.

Only the exact handoff POST accepts form CSRF. It requires exact same Origin/Host, `Sec-Fetch-Site:same-origin`, `Sec-Fetch-Mode:navigate`, `Sec-Fetch-Dest:document`, URL-encoded UTF-8, at most 4 KiB and exactly five nonduplicate fields: `csrf/providerInstanceId/configurationGeneration/authGeneration/flowId`. No OAuth callback fields are accepted. All other mutations keep the existing header-CSRF requirement and JSON lane. General activity/audit records only closed actions and safe identity/generation counters; private handoff material is never summarized.

## Revision 1 executed verification

The original copied source passed **67/67, zero failures/skips**: 23 existing control-HTTP cases, seventeen existing settings cases, twelve new private-relay cases and fifteen new portal/control cases. Result SHA-256 `7780618e0546bf5b38d09e58d8a80d2e7ad070fd8ee8c7e7792c8922cc531d80` is historical hash-only evidence after the independent rerun overwrote that raw receipt. Scoped no-emit type checking returned zero errors, owned lint with deny-warnings passed, and formatting check passed. This original source is superseded by revision 2.

The actual native dependencies were read in a separate regular source copy at `.worktrees/_cache/oauth-portal-relay-fixture-20261012/service`, using a private Vite cache and dependency resolver. No installation, junction creation or package build occurred. Remote fetch is blocked; all executed HTTP requests use new owned loopback fixtures. No SDK login, real daemon, Figma/browser, credential/config store or portal state was used. Credentials/proofs/URLs in fixtures are synthetic.

Meaningful cases cover one header-only 303 without following/JSON return, destination/resource/PKCE/callback/cardinality refusal, proof before credential-bearing requests, changed ownership before delivery, one-POST lost response and cancellation, late admission refusal before any request, native form authority/byte/field bounds, GET nonmutation/normal CSP, privacy in actual persisted activity/diagnostics, modern/legacy CAS, global unknown preservation and exact cleanup, stale same-provider read/probe readiness and an unknown fence appearing during held status.

Preserved initial fixture failures are not attributed to product acceptance: the first resolver selected Vitest's CommonJS shim and collected zero tests; it was corrected to the native ESM test entry. A later Node fetch harness forced `Sec-Fetch-Mode:cors`, so two legitimate-native-form assertions failed at the unchanged strict guard. Native form tests were corrected to actual raw loopback HTTP with the browser navigation headers; negative cases now assert precise 400/403/413/415 outcomes. The corrected full source passed 65 cases, then two new race cases were added; the final whole focused cohort passed 67. Earlier receipts remain in the private evidence root.

## Limits and continuation

This increment awaits independent review and root integration with the daemon and UI/public-CLI candidates. The Windows ownership path was source-reviewed and fixtures exercised injected trusted proof; real spawned-daemon ownership/303 and actual installed-Chrome form/CSP behavior are separately owed by the combined integration/UI owner. No full-source/package/capture acceptance is claimed for this increment or from the old a476 pass.

The static document resources and actual same provider/listener/control handler are separate owners' files, not copied into this source approval. Root must rebind all exact interfaces, regenerate catalog/provenance as required, build/check actual public exports and packaged resources, and run combined source/runtime gates. Real login still requires this service's accepted Figma client/redirect/authentication contract, named credentials and manual consent. No borrowed identity/PAT/DCR, automatic consent, grant/fence release, replay, deadline renewal, source Chrome control or Git operation occurred. Later authenticated full-program capture, Chrome/MCP parity and CDD/eCommerce frontend acceptance remain separate.

## Revision 2 repairs and exact freeze

The independent daemon reviewer reproduced a P1 ownership-order gap: a replacement during awaited admission could receive the prior protected bearer. Revision 2 repeats exact daemon/leader continuity after that await, with no further awaited operation before HTTP request creation. The new owned-loopback regression changes identity during admission and requires zero requests and zero Location delivery. The existing late-fence regression remains passing. This fixes the reproduced ordering gap; sequential process/fence snapshots cannot exclude every OS race. Admission is checked before the actual authenticated POST. Once that sole handoff POST consumes the URI, final response delivery completes the admitted in-flight action and does not re-admit against a newly created fence. New requests remain blocked, and ownership, original request budget, destination/cardinality and safe audit settlement still guard delivery. A lost/blocked delivery is never replayed.

The separate installed-Chrome UI fixture confirmed that a no-referrer consent document causes native POST Origin:null, despite valid CSRF, five fields and fetch metadata. The dedicated consent GET now uses referrer-policy:same-origin, coordinated with the UI owner's HTML meta. Strict exact Origin remains unchanged. Same-origin retains the portal form Origin while omitting Referer on cross-origin official consent. The private303 and callback retain no-referrer; general portal policy remains unchanged. Query-free GET is enforced and the UI owner guards fragments. Actual Chrome recheck belongs to that author and must be rebound in combined review.

Current manifest: service/.cache/oauth-portal-relay/frozen-files.json SHA-256 `c2e91af7753aa25d5bf4563b33a22bd025b188b809cde987cc38275753fcaecf`. All eight managed and fixture source hashes match. The same original before hashes remain in the manifest. Current after hashes:

| Path | SHA-256 |
| --- | --- |
| `service/packages/cli/src/control-client.ts` | `3ef2b249980a8d6796a06638e3b11537e88f67948af200c76db60b03ea4e6dc2` |
| `service/packages/cli/test/control-client-oauth-handoff.test.ts` | `0ca33212f4505a7b089054b434f9878dd0e5e0027f8bd1c5aed90bd95e8a99bf` |
| `service/packages/portal/src/server.ts` | `1bd438d4bffc1fe0f4fa8db800a57e0033af099ac9f49e792fae5f0f5f835ce2` |
| `service/packages/portal/src/control.ts` | `d7623e55517a393ac19ea9aec13f1147af597be6cfd016458b7ea674888cfb18` |
| `service/packages/portal/src/bridge.ts` | `5e729885279e81964144f450c59fd56747282541d0ad90d2a76b6f5ac93ce5b2` |
| `service/packages/portal/src/figma-settings.ts` | `c5ebe016937ac62a3940846897c707192ff2d835499d2682867c3875b764b8ea` |
| `service/packages/portal/src/contract.ts` | `093c1d201aeadc83d157a1770f2e826686ca8db2a2e188b375c95809314d8e84` |
| `service/packages/portal/test/figma-oauth-relay.test.ts` | `d00590cde1379a17e8f524dd0b6e9713c2e07d0ae294ab8d195094f0630aff0b` |

Executed final revised cohort: **68/68, zero failures/skips**, no-emit typecheck zero errors, deny-warning lint and format checks exit zero. Dedicated author receipt focused-author-r2.json SHA-256 `46dd2e0b33ef32f14d138b6208667a5b82370fdcc1984bafaf13c31027d38c92` is distinct from future reviewer output. The original author67 raw report was overwritten by root's independent rerun; its recorded7780618e hash is historical hash-only evidence with no retained raw copy located. The independent root67 receipt now at focused-result.json has SHA-256 b9a258e3d9a436fec1855842b585d10ee89fb9b03e1d400062b8e42b13c57a4e; it must not be attributed to the author. Original source bytes, the revision1 manifest and earlier failed receipts remain preserved.

Repeat from native service cwd after independently checking the frozen hashes:

`node C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-portal-relay-fixture-20261012/prepare.mjs`

`node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-portal-relay-fixture-20261012/review.config.mjs --outputFile.json=C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-portal-relay-fixture-20261012/focused-independent-r2.json`

`node C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-portal-relay-fixture-20261012/typecheck.mjs`

Do not reuse the default receipt path for an independent run. Preparation copies only private fixture source and reads native dependencies; no source-tree build/install or live action is authorized by these commands. This source freeze awaits independent repaired-regression review and combined runtime/package/Chrome proof.

### Separate installed-Chrome consent-policy evidence

The UI owner subsequently reported one passing targeted installed-Chrome fixture after the dedicated document header and HTML meta both changed to same-origin. It observed the exact owned Origin, five native fields/CSRF/binding, same-origin fetch-site, navigate mode, document destination, pinned303 navigation intent, no CSP violation and no Cookie/Authorization forwarding. Its owned deny-CONNECT proxy blocked actual external transport. Distinct receipt: managed `service/.cache/official-oauth-ui-cli/fixture/.cache/official-oauth-ui-cli/native-origin-after.json`, SHA-256 `c882091f8ebae759357d9ebdfb64a1f71421f030c6078e8d0bdbe233d7630851`; one pass, zero failures, five explicit filter exclusions. The null-Origin before-failure remains separately preserved. This is another author's executed browser-policy proof, not this relay author's independent Chrome run, actual production relay HTTP, real Figma login or manual consent. Combined final acceptance must bind its complete UI source freeze and this relay source together.
