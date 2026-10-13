# Independent review of the own-service official Figma OAuth engine

Analysis date: October 12, 2026 (Asia/Seoul).

This review follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md), [the engine plan](../../plans/2026-10-12-own-official-oauth-engine.md) and [the existing authorization analysis](../../analysis/official-mcp-authorization.md). The reviewer owns this report and ignored private probes only. The implementer owns two managed candidate files; the coordinator owns source integration, all runtime/browser operations, client-eligibility decisions and later portal/control wiring.

## Baseline and scope

Main/native recovery source was frozen at `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230` for renewed whole attempt `f5647503...`, reported running at assignment. This OAuth increment is excluded from that source and from the retained compiled QA runtime. Its owned paths are only `service/packages/mcp/src/official-figma-oauth.ts` and `service/packages/mcp/test/official-figma-oauth.test.ts`. Both remained absent from main/native at the final review read. This review claims no whole result or deployment change.

The requested engine adds a session-only explicit begin/callback-complete/cancel/logout/refresh/private-bearer lifecycle. It uses the installed SDK's lower-level start/exchange/refresh functions. It must keep the ordinary official MCP connection's current public `oauthLoginImplemented:false` truthful because public wiring is outside this increment. Synthetic own-client fixtures cannot establish Figma catalog eligibility, an approved client/redirect contract, live token success, tools/schema discovery or authenticated capture.

## Review boundaries

- Registration requires this service's explicitly attested own identity, secret authentication method and approved exact loopback URI before URL construction or transport work. No borrowed client, PAT, silent DCR or SDK convenience `auth()` orchestration is allowed.
- Resource, issuer and authorization/token destinations must remain exactly bound to the official Figma values in validated metadata. Metadata copies and accepted authentication methods must survive caller mutation without endpoint or method fallback, redirects, cookie forwarding or scope expansion.
- State/PKCE/callback cardinality, owner identity, callback listener lease and the original absolute deadline must be checked before a code POST. Consume valid callback authority before the first and only exchange; an uncertain response or OAuth error must not retry that code/rotating refresh token.
- Cancellation, logout, expiry and superseded transactions must erase credentials before observers and reject late publication. Refresh must serialize with completion/logout and expire honestly without a hidden authentication loop. A logical wait must not become unbounded because another method finishes its shared transaction.
- Public status/errors/serialization and any logs must exclude authorization URL/query, code, state, verifier, client secret and bearer/refresh token. Only the private callback receives the authorization URL, and only an owner-bound private getter can return a bearer.

## Pre-freeze finding and correction

Before freeze, a source trace identified a shared-transaction race, classified **P2, transaction availability/lifetime**: `begin` published the pending callback and waiting stage before awaiting an asynchronous authorization handoff. `complete` could then publish credentials and finish the operation while handoff remained held. Finishing cleared the shared deadline timer without aborting the handoff wait; a never-resolving handoff could leave `begin` pending indefinitely, while late handoff success could instead report superseded after the same transaction succeeded. The author accepted this source finding and added an operation-local successful-publication notification for only the begin handoff wait, with a same-generation/current-authorized check. Other I/O keeps its strict active-generation/deadline check. The final source independently passed the held-handoff/successful-callback case and late private handoff rejection. No pre-fix runtime failure was executed by this reviewer; the finding was corrected before freeze.

The independent fixtures block global network and use only injected fetch/clock/responses and synthetic credentials. The actual installed SDK remains in the execution path. No real listener, HTTP request, OAuth flow, browser, credential store, config, portal state or MCP connection was used.

## Final frozen review and executed evidence

The following revision 1 approval is retained as historical evidence only. The subsequent retained-error privacy findings below supersede it; it is not current integration authority.

| Frozen evidence | SHA-256 |
| --- | --- |
| Author manifest, produced `2026-10-12T05:09:32.401Z` | `353a140a4efd8a6de7b49897fd81e89f239d221c651f605a8662286a93a9972b` |
| `service/packages/mcp/src/official-figma-oauth.ts` | `854c0998baae1012a84af46021b571830c2353c2e0e1412db47f8f476b3fbe09` |
| `service/packages/mcp/test/official-figma-oauth.test.ts` | `e3e8970220c8527ee88afddc2d68097afbba237b3eb3b7b6a8615be29de3f34f` |
| Actual native SDK 2.0.0 ESM implementation | `af3ec9fcf3a70fb4681e9b3c11aa18a7ce9aca36fed9f138a6e704043695d414` |
| Actual native SDK declarations | `309cc5f76da5abff0be678d958aba0e875e52909f5f6f0544a45a34ac596cc9c` |
| Independent primary ESM result | `bd7452526289a06c6c47abcf0414796c0ac58d4206f1c46f3891b2cb41f0babc` |

After verifying the freeze, the reviewer copied only the exact two source/test files into `.worktrees/_cache/own-official-oauth-independent-20261012/`, outside shared service source. The private Vitest configuration uses actual native dependencies, a private cache directory and network guards for global fetch, HTTP/HTTPS request and TCP/TLS connection functions. Guard attempts fail the tests. It creates no listener and requires no package installation, junction change or build.

Primary execution at approximately 14:11 KST passed **79/79, zero failures/skips/pending**, comprising the author's full final 67 cases plus twelve independent cases. The SDK ESM implementation and declarations matched the author's manifest exactly. Final managed and private-copy source/test hashes remained equal to the frozen hashes. Main/native paths remained absent.

The twelve independent cases established:

- A valid same-generation callback can resolve `begin` as authorized while the private handoff remains held forever. A later handoff rejection does not erase the successful credentials or leak its canary.
- An uncertain code response yields one POST, clears bearer authority and rejects callback replay. A new explicit transaction is required.
- Caller mutation of issuer/resource/token destination/client secret after begin cannot replace the copied binding. The real SDK request uses the exact official resource/redirect/token endpoint, manual redirects, the original correctly encoded Basic credential, no body secret and no cookie.
- Duplicate code cardinality is rejected before network work while an otherwise valid pending callback remains usable once. An exact consent-denial callback consumes the transaction, makes zero token calls and exposes only the closed denial code.
- A different owner cannot retrieve the private session reference. JSON serialization/status/error strings omit private denial/handoff/response canaries.
- A late old exchange cannot overwrite a subsequently authorized new owner generation. An uncertain rotating-refresh response clears credentials and cannot trigger getter/refresh replay.
- Caller extension of metadata freshness cannot extend the original waiting transaction deadline.
- Missing eligibility, another product identity, unsupported public-client `none` authentication and an unapproved redirect all fail before authorization handoff or requests.

The independently reproduced 67 author cases additionally cover both secret methods, S256/verifier/resource/state construction, issuer/resource/metadata/redirect/lease failures, wrong/missing/duplicate/expired callback fields, SDK error/lost-response non-retry, cancel/logout/signal/deadline late-response fencing, token/response validation and bounded stalled-body handling, refresh rotation/concurrency, pre-cancelled refresh, metadata/token expiry, private projections and held-handoff correction. These are synthetic engine fixtures, not network/discovery/registration/consent/capture observations. Author static evidence reports MCP typecheck and owned lint/format passed; this reviewer did not rerun the complete managed package statics during the frozen whole check.

An initial private run also passed 79/79 against the native SDK CommonJS entry selected by `createRequire.resolve`. Its implementation hash differs because it is another package format. That run is retained as supplementary `review-results-cjs-supplemental.json`, SHA-256 `d1709bef1cee7a929cfeaee6e607a3b696192e90324175bbb75ea1d2e8df3c20`. The private alias was then corrected to the production ESM entry and the final 79/79 result above obtained. No product or installed dependency changed, and the supplementary run is not substituted for ESM evidence.

Reproduction from the native service directory, with the already verified frozen private copies:

```powershell
$env:SFP_OAUTH_REVIEW_NATIVE='C:/2026_project/super-figma-pipline/.worktrees/baseline/service'
node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/own-official-oauth-independent-20261012/review.config.mjs
```

The private evidence root contains the copied frozen engine/test, twelve additional case definitions, network guards, private config/cache and both result files. It contains synthetic values only.

## Evidence and limits

### Revision 2 privacy recheck, October 12

The author reproduced a mutable marked-error privacy failure after revision 1 and retained a 67/68 failed receipt. Revision 2 froze manifest `a6df2734e1585d10e5d75caf586316be2c81227faa404dc90bf873fb319ed4d9`, source `926cf5570c6dbc8c8331a55631dd2c7658de93b2b390017e01f457a2da46a9d6` and test `6d1c8c3878f27115cd6b8f16a4c5241a4b362a1c46b096b3ff8e2adcc6531268`. Its factory freezes errors and gives them an own fixed name; injected handoff/fetch rejections are classified freshly. This source change was independently inspected and copied only into the ignored private fixture after preserving revision 1.

**P1 privacy finding remains open in revision 2.** In actual native Node 24, `Error.stack` is an accessor with a setter; `Object.freeze(Error)` does not disable that setter. A pure probe showed frozen=true, `Reflect.set(stack,canary)`=true and the stack retaining the canary. Independent engine execution with the actual ESM SDK/global network blocked produced **80 passed / four failed / zero skips, 84 cases**: all 68 author cases and the prior twelve boundaries passed, but three immutable-field variants and a real `Response` body-reader rethrow failed.

The real-reader reproduction is: obtain a factory-marked registration error, use `Reflect.set` to place a synthetic private query canary in its stack, return a standard `Response` whose `ReadableStream` errors with that retained object, then complete a fresh valid transaction. The engine returned the old marked error with the canary in `error.stack`; sanitization treated marker membership as payload authority. No real secret/network/browser was involved. The failed result is retained as private `revision2-stack-failed.json`; the source/test are held in the private fixture for exact reproduction until the next verified freeze.

Both author and coordinator were notified before integration. The author accepted the finding and added an immutable own stack data field plus fresh classification of external body-reader rejections while preserving independent abort/deadline codes. Revision 2 remains rejected historical evidence. The QA helper static review was prioritized at the coordinator's request while the author repaired OAuth.

### Revision 3 final approval, October 12 at approximately 14:55 KST

**Revision 3 is approved for the exact two-file engine increment below.** The earlier approvals/results are historical; the retained-error privacy finding is resolved in this source.

| Current evidence | SHA-256 |
| --- | --- |
| Revision 3 manifest | `f533af57855cf27d44fb7cba28f9ede327f1ead88c6c4f4a52c6079a8b5ad453` |
| `official-figma-oauth.ts` | `c5f91dca14205d8e5c7a522ab33a32a8c605bedec355b5ca2c0a6e66dd617e34` |
| `official-figma-oauth.test.ts` | `9d6552b39bc1cd12f182be589f515f4939554504300888539c650f16ff8b489d` |
| Primary independent revision 3 result | `348b2d3d538f3132907cb97dad8bd20cefa9d7630a0cacbfafd7d9d5094b503e` |
| Retained independent revision 2 failure | `0e12c08107947c226d2528fc310f3781c74a5ed817027a30b70782152066b863` |

The final source materializes `Error.stack` as a non-writable, non-configurable own data property before freezing; name/code/message are also immutable. Reader rejection is treated as external and converted to fresh `FIGMA_MCP_OAUTH_RESPONSE_REJECTED` inside the bounded read action. Independent timeout/cancel races keep their own closed codes. Retaining a factory-marked Error no longer permits mutable payload or stack authority.

The actual ESM SDK/network-blocked rerun passed **85/85, zero failures/skips**, comprising all 69 final author cases and sixteen independent cases. The previous twelve boundaries remained green. Three new handoff/exchange/refresh variants reject mutation of every public message/code/name/stack field and require fresh stage-appropriate external failure. The real standard Response stream case now returns a distinct response-rejected Error with no synthetic private query canary; it makes one request and publishes no bearer. Post-run managed/private-copy hashes match the new freeze. No product changes were made by the reviewer.

Author history also retains an actual real-stream pre-fix reproduction at 68/69 and a final 69/69/statics pass. The independent revision 2 80/84 failure remains separate. No live auth, client/redirect eligibility, ordinary probe/capture wiring or portal login acceptance is implied. The coordinator reports a476a925 whole/artifact passed unchanged; those gates exclude this managed OAuth candidate and are not rebound to it.

The engine accepts operator-attested eligibility and metadata; it does not independently verify Figma approved this client/secret/authentication/redirect contract or discover fresh metadata. Its injected listener lease is an assertion from a future callback owner, not a bound socket in this increment. Tokens and registration secrets are session-only private fields, not encrypted durable storage or an OS security sandbox. An injected fetch and private handoff remain trusted host capabilities; future wiring must enforce the authenticated local owner and avoid logging raw handoff/callback material.

Public daemon/control/CLI/portal wiring, the real callback listener, metadata acquisition, OAuth ownership admission, ordinary capture's private token integration and invalidation of readiness by authorization generation remain separate work. Keep `oauthLoginImplemented:false` until that public workflow exists. Ordinary probe/capture must not automatically initiate consent, DCR, retries or scope expansion. The lack of public wiring is an explicit first-delivery limit, not a source finding against the two-file engine.

No live HTTP/MCP/OAuth/browser/credential/config/portal-state operation, capture or build occurred. Only this report and ignored private fixtures/results changed; main/native source and the frozen QA readiness report were untouched. A global network guard is a test control, not an operating-system network sandbox. Successful engine fixtures cannot establish actual client eligibility, live token success, official tool/full-program schema compatibility, file/asset/freshness/parity or CDD/eCommerce frontend acceptance. Integration/source/package gates and actual authorized service-owned authentication remain owed.
