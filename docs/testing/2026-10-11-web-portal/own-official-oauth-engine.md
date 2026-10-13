# Own-service official OAuth engine candidate

Date: October 12, 2026 (Asia/Seoul).

This managed-only candidate implements the internal session lifecycle requested by [the engine plan](../../plans/2026-10-12-own-official-oauth-engine.md). It reuses [the authorization analysis](../../analysis/official-mcp-authorization.md), [repository instructions](../../../AGENTS.md) and the shared analysis policy. It does not wire public login, acquire client credentials, establish Figma eligibility, open consent, or authenticate against a real server.

## Baseline and frozen scope

The root's reconciled main/native baseline is `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. The root owns its whole check and later integration. These two new files were absent in main, native baseline and managed at the initial check. Their before hashes are null. No previous work was overwritten.

| Managed service-relative path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/official-figma-oauth.ts` | `c5f91dca14205d8e5c7a522ab33a32a8c605bedec355b5ca2c0a6e66dd617e34` |
| `packages/mcp/test/official-figma-oauth.test.ts` | `9d6552b39bc1cd12f182be589f515f4939554504300888539c650f16ff8b489d` |

The candidate remains outside main/native and their current whole check. No existing provider, portal, CLI, catalog, provenance, policy, fence, state, credential store, Git index, browser or live process was changed. Documentation additions are this report and the separately requested [portal integration design](../../plans/2026-10-12-own-official-oauth-portal.md).

## Implemented engine and interface

The exported `OfficialFigmaOAuthEngine` uses runtime-private fields and the installed SDK 2.0.0 lower-level `startAuthorization`, `exchangeAuthorization` and `refreshAuthorization` functions. It never calls SDK `auth()`, dynamic registration, automatic refresh, browser control or a default global fetch. A trusted transport must be supplied explicitly.

| Interface | Contract and visibility |
| --- | --- |
| Constructor | Receives a fixed internal `ownerId`, intercepted/approved `fetch`, clock and private `authorizationHandoff(URL)` callback. Owner-string equality is an internal binding, not control-plane authentication. |
| `begin` | Receives the matching owner, fresh configuration, an approved callback lease, caller's absolute deadline and optional signal. Returns safe status only. Configuration is copied into private closed fields after validation. |
| Configuration | Requires this service's literal name, operator-attested eligibility, own client ID/secret, one supported secret-authentication method, approved exact loopback redirect, exact official resource/issuer/endpoints, S256, code grant/scope and a finite metadata freshness bound. Operator declaration is not independent Figma approval. |
| Callback lease | The future listener owner supplies exact redirect URI, `assertBound()` and optional close signal. The engine does not bind a socket; it checks the trusted lease before URL handoff and callback exchange. Lease fields and metadata are copied. |
| Private handoff | Receives the consent URL, including secret state, only after gates pass. It must never put that URL into public JSON, status, activity or logs. No engine code opens or approves a browser. |
| `complete` | Accepts owner and the raw callback URL only through the future dedicated callback owner. Validates exact base URI, allowed/cardinal query fields, constant-time state, code size, optional/advertised issuer and bound lease. Consumes the valid state before issuing one token POST. Returns safe status. |
| `refresh` | Explicit owner action with an original deadline/signal. Uses one refresh POST, excludes concurrent operations, clears the old bearer during refresh and rejects stale publication. It must start before current credential expiry. |
| `cancel` / `logout` | Retire local binding, pending verifier/state and tokens before synchronous abort observers run. Abort the owned request signal and detach timers/listeners. They do not remotely revoke tokens or clear any existing operation fence. A later begin supplies fresh configuration and state. |
| `bearer` | Private-purpose synchronous getter for future transport wiring, restricted to the matching owner. It never refreshes or opens consent. Expired/cancelled/missing credentials return undefined. Do not expose it as a public endpoint or serialize its return value. |
| `status` | Returns stage, closed code, generation, expiry, `sessionOnly:true` and `clientEligibility:'operator-attested'` or `'unconfigured'`. It contains no client ID, secret, token, verifier, state, callback/consent URL or owner ID. Serializing the engine itself yields an empty object. |

Stages are blocked, preparing, waiting-for-callback, exchanging, authorized, refreshing, cancelled, logged-out, expired and login-required. Every operation uses the original absolute budget and owner/generation binding. Interactive and token lifetime are capped by the provided metadata freshness bound. Cancel/logout/expiry clear local credential references. A token exchange failure consumes that transaction permanently; a new explicitly initiated login is required. Refresh loss clears the old tokens rather than retrying a possibly rotated refresh token.

Token requests are confined to the exact official token destination with the exact MCP resource, POST grant and redirect. Redirects, changed response origin, cookies, wrong content type and oversized bodies fail closed. Response reads share the actual abort signal/deadline and a 64-KiB byte cap. Basic credentials use form encoding before Base64; post credentials use form parameters. Access tokens must be bounded valid Bearer material with positive explicit expiry and the expected scope. No raw SDK error body or cancellation reason is returned.

## Races and preserved findings

The independent reviewer identified a pre-freeze held-handoff race: a callback could publish tokens while an asynchronous handoff was still pending, leaving `begin` stuck or reporting a superseded transaction. An operation-local successful-publication notification now settles the bounded begin wait on the same valid generation. A never-completed callback still obeys the original deadline, and delayed or cancelled handoffs cannot overwrite a subsequent transaction. The positive concurrent callback/held-handoff fixture passes.

Revision one passed 67 author tests and the reviewer's 12 primary SDK boundary tests. Its source/test/manifest remain privately archived. Final author inspection then identified a distinct privacy defect: a returned factory Error was mutable, so a retained marked error could have its message/code overwritten and be rethrown by an injected transport. The executed before-fix regression produced **67 passed, one failed** and exposed the dummy canary. Revision two freezes factory errors with closed own fields, and explicitly reclassifies external handoff/transport rejections rather than treating a retained public error as private authority. The added rethrow regression passes. It does not broaden retry authority or classify a failed token exchange as pre-effect safe.

The expanded revision-two review then produced **80 passed, four failed**: Node 24's native `Error.stack` accessor still accepts its setter after `Object.freeze`. A real standard Response body stream could rethrow a previously marked public error with that altered stack and an unrelated old code. The author reproduced the body boundary in a distinct **68 passed, one failed** receipt. Revision three materializes stack as a non-writable own data property before freezing and classifies body-reader errors as fresh external response failures. The regression checks both data-property immutability and the resulting closed code. Original cancellation/deadline races remain separate. Revision-two source/test/manifest and both failed receipts remain historical evidence.

Initial static checks also exposed the project's exact optional-property rules and lint conventions. Private nullable fields, optional SDK issuer arguments and callback signal typing were repaired without changing public wiring. A harmless promise-return lint warning was removed before the final freeze. These intermediate failures were preserved in the work record; no passing focused result is presented as a whole-source pass.

## Executed verification

A private full-main service source copy, excluding dependency trees/generated output, was created at managed `service/.cache/own-official-oauth-engine/main-fixture/service`. Only the two owned files were overlaid. Already installed native dependencies were linked for reads. An explicit `.mjs` config with native config loader and a private cache directory avoided config-bundle/cache output through dependency junctions. No install or package build was run.

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/focused.config.mjs --configLoader native --reporter=json --outputFile=.cache/oauth-engine-final-r7.json
node node_modules/typescript/bin/tsc -p packages/mcp/tsconfig.json --noEmit
node node_modules/.pnpm/oxlint@1.80.0/node_modules/oxlint/bin/oxlint packages/mcp/src/official-figma-oauth.ts packages/mcp/test/official-figma-oauth.test.ts
node node_modules/.pnpm/oxfmt@0.65.0/node_modules/oxfmt/bin/oxfmt --check packages/mcp/src/official-figma-oauth.ts packages/mcp/test/official-figma-oauth.test.ts
```

Final exact revision-three result: **69/69 passed, zero skips**; MCP typecheck, owned lint with no warnings, and formatting passed. Tests use the real SDK's S256 and exchange/refresh logic with injected fetch/clock. Global fetch is blocked and checked in every fixture. No live HTTP, OAuth, MCP, consent, source Chrome, Figma data or browser operation was attempted.

The final [independent SOL review](own-official-oauth-engine-review.md) approved the exact revision-three hashes after **85/85 passed**: 69 author cases plus 16 independent ESM SDK boundaries, with live networking blocked. It independently verified the immutable own stack data property and real Response-body rethrow rejection, preserving the earlier 80/84 failure. Its primary receipt SHA-256 is `348b2d3d538f3132907cb97dad8bd20cefa9d7630a0cacbfafd7d9d5094b503e`. Review approval covers this internal engine and does not establish public portal wiring or live Figma authorization.

Coverage includes both client secret methods, PKCE/state/resource construction, prerequisite and adversarial metadata rejection before handoff/network, callback identity/cardinality/issuer/owner, duplicate/expired/denied callbacks, one-use invalid-client/grant and lost responses, cancellation/logout/actual fetch abort, stalled body deadline, response limits/redirects, copied binding, held handoff, old generation versus new credentials, refresh rotation/concurrency/loss/expiry, no automatic bearer refresh, and public privacy including retained factory error rethrow through transport and actual response body streams.

Private manifest: `service/.cache/own-official-oauth-engine/frozen-files.json`, SHA-256 `f533af57855cf27d44fb7cba28f9ede327f1ead88c6c4f4a52c6079a8b5ad453`. It binds both before-null/final hashes, all intermediate receipts and installed SDK hashes. Final receipt `main-fixture/service/packages/mcp/.cache/oauth-engine-final-r7.json` has SHA-256 `dda8f6270e6fb273976ead4be1658d773d8c0fc17caacfb0e4502ddebb3039ee`. Both before-fix privacy/body receipts are separate and hashed in the manifest. `frozen-files-v1.json`, `source-v1.ts`, `test-v1.ts`, and their corresponding v2 files preserve both earlier candidates. Installed SDK 2.0.0 declaration SHA-256 is `309cc5f76da5abff0be678d958aba0e875e52909f5f6f0544a45a34ac596cc9c`; implementation SHA-256 is `af3ec9fcf3a70fb4681e9b3c11aa18a7ce9aca36fed9f138a6e704043695d414`.

## Wiring points and limits

Later authorized ownership must include daemon `control/figma-settings-endpoint.ts`, `control/route-registry.ts`, `index.ts`, and `official-figma-mcp.ts`; CLI `control-client.ts` and `official-figma-mcp-command.ts`; portal `figma-settings.ts`, `control.ts`, `bridge.ts`, `server.ts`, settings web UI and matching schemas/tests. Add the real callback/redirect owner and complete public inventory/provenance only in that later reviewed scope. The current public `oauthLoginImplemented:false` remains correct. The integration design describes exact ownership and tests.

Actual eligibility, own client/secret acquisition, approved redirect/authentication contract, fresh server metadata, manual consent, authenticated probe/tool schema and full-program capture remain operator/live acceptance gates. This module cannot independently verify that a declaration or credential originated with Figma for this application. No checkbox or fixture proves it. A callback lease must be backed by a real listener during integration, not a stubbed assertion. Injected transport/handoff and the authenticated owner binding are trusted host responsibilities.

Local reference clearing is not guaranteed zeroization of JavaScript strings or copies held by the SDK/transport. Session-only memory is neither a vault nor an OS sandbox. An already issued remote token request may have effects despite local cancellation; the engine fences publication and never retries its consumed code or uncertain rotated token. Opaque token audience/user/tool entitlement requires actual service-owned verification later. No prior unknown job is replayed or unfenced, no capture/run deadline or SourceEpoch changes, and successful fixtures do not establish login implementation, registration, full capture or frontend acceptance.
