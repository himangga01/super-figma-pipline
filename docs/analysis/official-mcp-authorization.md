# Service-owned official Figma MCP authorization

Analysis date: October 12, 2026, Asia/Seoul. This narrowly scoped review supplements [the canonical service analysis](../service-analysis.md), [the earlier OAuth investigation](../testing/2026-10-10-continuation/official-oauth-setup.md), [the capture implementation](../testing/2026-10-10-continuation/official-mcp-path.md), and [repository instructions](../../AGENTS.md). Read this record and those authorities before later authorization work; refresh its source and evidence after new results. Only this report was edited by this reviewer.

## Decision and immediate continuation

### Current delivery checkpoint, October 12 at 16:36 KST

The actually integrated and deployed QA source remains `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`; its login is still unimplemented. A separately managed session-only OAuth engine revision 3 is now implemented and [independently approved](../testing/2026-10-11-web-portal/own-official-oauth-engine-review.md): 69 author plus sixteen independent actual-SDK cases pass with global network blocked. Earlier mutable-error and immutable-stack privacy failures remain in that record. It is not part of a476 or a live auth claim.

The [portal integration plan](../plans/2026-10-12-own-official-oauth-portal.md) is being implemented by three disjoint SOL agents: actual loopback callback/provider/control, private portal handoff relay, and UI/public CLI. The backend's current controlled scope passes 178/178; final freezes and independent combined integration review are still owed. The public handoff uses an owner/CSRF-protected POST and private redirect, not an OAuth URL returned in public JSON/logs. Missing own-service contract/configuration must stop before network or callback allocation. Probe/read/generation must share one provider and authorization generation. Credentials remain session-only.

No actual client registration, own credentials, Figma consent, token exchange, authenticated probe or official file capture has been accepted. The earlier access-policy review below remains dated evidence; no new external policy request occurred in this checkpoint. Fixture success cannot establish eligibility or full-program capability. Actual positive official acceptance remains separate from code delivery and from the authorized Chrome workflow.

The service has an official MCP transport and capture adapter, but **does not implement its own OAuth login or client registration**. Its supported remote credential path is an externally provisioned, current access token for this service, referenced by environment-variable name. A nonempty environment value is a configuration hint, not proof of token validity, client eligibility or capture readiness.

There are two useful next paths:

1. For an existing official supplemental read without remote OAuth implementation, the owner can enable the official Figma Desktop server and invoke the service's existing endpoint-specific probe/read features. This does not require changing saved portal preferences. No listener was present on port 3845 at this review's observation, so the local path is not ready yet.
2. For the required remote full-program acquisition, implement and test the session-only OAuth engine now using the installed SDK and controlled fixtures. Activating a real login still requires Figma eligibility for this service's own client identity and its accepted registration/redirect/client-authentication contract. Do not use an approved external application's token or change the client name to impersonate it. The October 12 continuation below defines a small implementation scope that does not depend on credentials or a live registration attempt.

Figma's current official policy limits server connections to catalog-listed clients and provides a new-client waitlist. This restriction was rechecked on October 12; the service's own eligibility remains unverified. Advertising a dynamic registration endpoint does not establish permission to register this application. [Figma access policy](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [remote setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/).

## Source and actual verification

At the initial review, main was on `main` at published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted continuation work. The main service was independently read-hashed to **`sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`**. The auth transport was already modified relative to HEAD; settings modules were already untracked implementation files. No working-tree source, process, service state, preference, credential, browser or Git index was changed. The later source reviewed below supersedes this baseline for its affected conclusions.

[The current-source actual settings receipt](../testing/2026-10-11-web-portal/official-settings-f0dc.json) records a completed service-owned remote probe with `FIGMA_MCP_AUTH_REQUIRED`, `programCaptureSupported:false`, and `readyForCaptureAttempt:false`. It did not change configuration or collect a file. This reviewer did not replay that probe or attempt login. The coordinator's successful Chrome reads are separate authorization evidence and cannot authorize official MCP requests.

Read-only OS inspection at `2026-10-12T01:23:07Z` found **zero listening endpoints on local port 3845**. There was no process named `Figma`; the broader name match returned only `figma_agent`, which is not proof that the Figma Desktop application or its official server is running. This observation can become stale. No connection to that port or application control occurred.

Verification consisted of source search/read, current source hashing, installed SDK declarations, the above listener/process observation, historical receipts, and current public documentation. No authentication, token exchange, registration, file read, test suite or live acceptance was executed by this review.

## Implemented architecture and gaps

| Code reference | Current implemented behavior |
| --- | --- |
| [official-figma-mcp.ts](../../service/packages/mcp/src/official-figma-mcp.ts), `officialFigmaConnectionFromEnvironment` at line 43 | Reads `SFP_FIGMA_MCP_OAUTH_TOKEN_ENV` as a variable name and resolves its value only through an in-memory bearer callback. No OAuth transaction, expiry, refresh or persistence exists. |
| Same file, `connectOfficial` at line 188 | Accepts only the two exact official endpoints. Its fetch wrapper permits only the selected `/mcp` URL, rejects redirects, and converts 401/403 to a typed auth-required failure. Remote transport receives `{token:callback}`; local transport receives no remote credential. |
| [figma-settings-endpoint.ts](../../service/packages/mcp/src/control/figma-settings-endpoint.ts), lines 33–46 and 108–119 | The actual daemon status schema fixes `oauthLoginImplemented:false` and `clientRegistration:'unverified'`. One provider instance supplies explicit probe/read and generation, with bounded requests. |
| [index.ts](../../service/packages/mcp/src/index.ts), lines 987–994 | Passes that provider's `connection` into the real generation/capture runtime. A login provider must be installed here so probes and generation use the same authorization. |
| [figma-settings.ts](../../service/packages/portal/src/figma-settings.ts), `get`, `save`, `probe` | Persists only endpoint and desired environment-name preferences. Saving does not modify daemon process environment. Readiness requires matching provider instance/configuration and a successful compatible probe; `fullCaptureAccepted` stays false. |
| [figma-settings.js](../../service/packages/portal/web/figma-settings.js) | Offers preference save, connection probe, status and application to a new draft. It states that login is unimplemented and registration unverified. There is no Connect/OAuth callback workflow. |
| [official-figma-mcp-command.ts](../../service/packages/cli/src/official-figma-mcp-command.ts) | Implements `config`, `probe`, and `read`, optionally using a named environment variable for an already authorized remote token. No login/register/refresh/logout command exists. |
| [official-mcp-capture.ts](../../service/packages/mcp/src/portal/official-mcp-capture.ts) and `openOfficialFigmaCapture` | Full capture executes service-fixed read/export programs through compatible `use_figma`, validating nonce, file/scope identity, assets, capabilities and original deadlines. It does not accept caller JavaScript or fall back to Chrome. |

The installed `@modelcontextprotocol/client` is **2.0.0**. Its `OAuthClientProvider`, `auth`, discovery, PKCE verifier/token/client-information methods and issuer-bound storage contracts are available. They are not wired into this service. Replacing the existing token callback alone cannot bootstrap OAuth: the current guarded fetch excludes the authorization/discovery/token hosts and throws on the challenge before an automatic OAuth flow could use it. Keep that capture destination guard; implement a separate explicit auth transport.

Searches found no service implementation of DPAPI, Credential Manager, OAuth registration/exchange, callback handling or refresh-token storage. Signed/HMAC records are not encryption. The existing owner ACL and retained-directory/atomic-file helpers can support a dedicated store but must not be described as an existing encrypted vault.

One existing handoff is misleading: `officialFigmaConfiguration` tells the owner to configure an approved external MCP client and authenticate there. That setup does not provision this service's own approved credentials. Replace the wording during implementation with service-registration and service-login steps; do not instruct token extraction or reuse from Codex, Claude, Cursor or another connector.

## Existing Desktop path without preference changes

The service's local adapter intentionally does not send remote OAuth credentials to `http://127.0.0.1:3845/mcp`. It can use the official Desktop app's own signed-in/file context when the server is enabled and accepts this service's handshake. Current official setup requires opening a Design file in the Desktop app, entering Dev Mode, and enabling its MCP server. The documented localhost interface supports supplemental design/context reads. Eligibility and a successful own-service handshake still need actual verification. [Official Desktop setup](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/).

Use the existing portal **All functions** feature form, without saving the settings panel:

```json
{"name":"figma-mcp.probe","args":{"endpoint":"http://127.0.0.1:3845/mcp"}}
```

After the owner manually opens the exact CDD file/page in Desktop and the probe succeeds, the existing read arguments are:

```json
{"name":"figma-mcp.read","args":{"endpoint":"http://127.0.0.1:3845/mcp","url":"https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120","tool":"get_metadata"}}
```

Select the normal available result workspace and `none` Figma selector as required by feature-job admission. These features dispatch fixed daemon routes with the supplied endpoint; they do not call preference save. Direct CLI equivalents, using the service's own CLI entry, are:

```text
sfp figma-mcp probe --endpoint http://127.0.0.1:3845/mcp
sfp figma-mcp read --endpoint http://127.0.0.1:3845/mcp --url https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120 --tool get_metadata
```

Do not confuse the dedicated settings panel's Probe button with these endpoint-specific features: that panel probes its saved preference. Do not supply `--oauth-token-env` for Desktop.

The adapter supports five named reads. If the local schema accepts only `nodeId`, the response explicitly reports `desktop-active-file-unverified`; the URL's file key is not proof of the active Desktop file. A schema accepting `fileKey` still yields request-only binding, not runtime-native identity. The existing ordinary read result always has `fullCapture:false`.

Figma documents `use_figma` as remote-only. The current full service collector requires that tool, while `get_metadata` is a sparse outline and `get_design_context` supplies design/code context. Therefore a successful local read can support comparison or diagnostics, but cannot satisfy this project's full official acquisition or reference-free frontend acceptance. Creating a new sparse-context generation contract would be separate product work, not a reason to relax the existing full-capture gates. [Official tool capabilities](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).

## Minimal own-service authorization implementation

This is a proposed design, not implemented behavior.

1. **Registration gate:** establish this service's approved identity, accepted redirect URI and client-auth method with Figma. The earlier October 11 SDK discovery advertised DCR, `mcp:connect`, S256 and secret-based token authentication, but no public-client `none` method or CIMD declaration. Those are dated metadata facts, not refreshed observations or registration permission. Re-discover through a fixed, bounded official auth allowlist when implementing the authorized setup. Do not embed a shared confidential secret in the distributed CLI or impersonate a listed client.
2. **Small first delivery:** use a daemon-owned, session-only `OAuthClientProvider` plus explicit authenticated-owner `auth-status`, `login`, `cancel-login` and `logout` operations. Expose the same actions in portal settings; add all implemented public commands to the existing feature catalog and coverage inventory. Normal probe/capture must return login-required rather than opening consent, registering or expanding scope automatically.
3. **One-use login transaction:** bind an approved loopback callback before producing the authorization URL. Bind random state, S256 verifier, issuer/resource/client, exact redirect URI, owner, discovery version and a fixed interactive deadline. The owner opens the official consent URL in Chrome and performs login/consent manually. Validate callback state, issuer, exact host/path/port, size and one-use completion before exchanging the code once. A lost exchange response is not permission to replay a potentially consumed code. Restart invalidates pending login; it never renews an existing capture deadline. This design follows MCP's resource-bound authorization requirements. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
4. **Provider lifecycle:** route the resulting token callback to both daemon probes/reads and capture. Serialize refresh and logout for the same owner/client; reject stale writers and late publications. Extend the literal-false/unverified status schemas with truthful stages, expiry and a non-secret authorization generation. Invalidate old readiness probes on refresh/replacement/logout instead of comparing only environment name and token-presence boolean. Preserve an explicit compatibility mode for legitimate externally provisioned service-owned tokens.
5. **Persistence later, if required:** add an owner-bound DPAPI CurrentUser or Credential Manager store using existing protected state/atomic boundaries for its metadata. Encrypt access/refresh tokens and client credentials; do not store them in signed portal JSON, project files, logs, artifacts or shell arguments. Session-only mode avoids introducing a vault in the first delivery and must explicitly report restart-required login. Neither ACLs nor encryption create an OS sandbox against the same user/admin.
6. **Separate finish lines:** verify own-service login and token refresh first, authenticated tools/schema discovery second, then actual fixed-program capture/parity/freshness and a separate accepted frontend. No new capture engine is required merely to add authorization, but the authenticated server's `use_figma` schema/runtime/envelope remains unverified and may require a bounded compatibility repair.

## Required tests and acceptance

- Actual installed SDK fixtures: accepted/denied registration, discovered issuer/resource/S256/auth method, unavailable registration gate, no automatic auth from ordinary capture, and no substitution of another client's identity.
- Callback and endpoint guards: wrong/missing state or issuer, occupied socket, unexpected host/path/port, duplicate code, restart/replay, oversized input, redirects, changed issuer/token destination, and bearer leakage to Desktop or auth discovery.
- Lifetime/concurrency: original login deadline, cancellation/shutdown, delayed exchange/refresh, lost response, refresh rotation, stale publication, two owners, logout during capture and invalidated probe generation. No success after expiry and no automatic uncertain-code retry.
- Privacy: code/verifier/state/token/client-secret/callback query or SDK error-body canaries absent from public JSON, UI, activity audit, diagnostic logs, errors and artifacts. Public status shows stage/expiry/generation only. General diagnostics and activity paths must not receive raw callback parameters.
- Vault, if enabled: encrypted round trip, wrong owner, corruption, ACL/reparse races, CAS refresh, no plaintext fallback and explicit session-only behavior when secure storage is unavailable.
- Source fixtures followed by service-owned actual acceptance: owner manual Chrome consent, service exchange/refresh/probe, actual file identity/assets/full-program capture, independent same-scope Chrome comparison, source freshness and reference-free frontend gates. Desktop metadata success remains supplemental.

## Open decisions and limits

The actionable external question is whether Figma will approve this service and what registration/client-secret/redirect contract it grants. The first implementation decision is whether session-only credentials satisfy local hosting or persistence is required immediately. Desktop can provide an earlier supplemental read only after its owner-enabled server is running and actual compatibility is checked; it cannot replace the remote full-program requirement.

This review made no live auth attempt and cannot infer registration eligibility, token validity, user identity, quota exhaustion, local tool availability or full capture from the earlier auth-required result. No Codex connector, external browser control, credential reuse, Chrome cookie access or security-approval automation was used. The coordinator owns runtime work, canonical analysis/instruction links and any later implementation authorization.

## October 12 continuation: implementable before registration

The root now reports unreconciled main/native source `sha256:f29b9e17f3e24fb5b187b2b86bd09f9913105fc72200a2fb1797eee208e0cc58` after integrating the separate whole-check follow-up. This short review did not independently hash the complete service or infer a whole-source pass. Current authorization source was read and bound to these hashes:

- `official-figma-mcp.ts`: `d5a4e2cf07e373ff3e3081299c646d1262a7e6310ea35919da9db583e0ef6820`.
- `control/figma-settings-endpoint.ts`: `747c31c5317e8cb920eb09cec20d833bce72b2fa44663680d75a06b401fa32c4`.

Both still implement the externally provisioned bearer callback, fixed MCP fetch destination and literal-false OAuth-login status described above. No source, process, state, preference, credential or browser was changed in this continuation. Only this existing report was updated. Current public access documentation was read again, but no official MCP/discovery/registration/token request or auth attempt occurred. Client catalog eligibility remains an external requirement. [Figma access policy](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

**The installed SDK and dated metadata are enough to implement an offline-tested, explicit service OAuth engine now. They are not enough to activate a credential-free public-client Figma login.** PKCE does not replace the client authentication method. The earlier Figma metadata advertises S256 with `client_secret_basic`/`client_secret_post`, not `none`; actual registration can change what this service is allowed to use. Fresh metadata and an accepted own-client contract must be validated before a real operation. The implementation need not wait for those facts to build its state machine, callback guards, lifecycle and negative tests.

### New version-specific SDK findings

Installed package-local `@modelcontextprotocol/client` 2.0.0 provides these exports in `dist/index.d.mts`: `OAuthClientProvider` at line 228, `startAuthorization` at 791, `exchangeAuthorization` at 833, and `refreshAuthorization` at 871. Its implementation in `dist/index.mjs` adds two constraints to the earlier design:

1. `auth()` at line 610 retries `authInternal()` on `invalid_client`, `unauthorized_client` and `invalid_grant`, including the same authorization-code options. It can also dynamically register when client information is missing. Therefore do not use that convenience orchestration for the one-use callback transaction or wire an interactive OAuth provider into ordinary MCP capture. Use the exported lower-level start/exchange/refresh functions under the service's own explicit admission and consumption states. Each exchange/refresh request must be issued once; an indeterminate response requires a new explicitly initiated login, not automatic code or rotating-token replay.
2. `selectClientAuthMethod` at line 457 can fall back to `none` or another method even when no supported method matches the available credentials. It honors a supplied supported `token_endpoint_auth_method`, but the service must positively validate that declared method against fresh metadata and credential availability before calling the SDK. With the dated Figma metadata, missing own-client secret is a blocked prerequisite, not an invitation to try public-client authentication.

The lower-level `startAuthorization` builds S256 locally without an HTTP request. `exchangeAuthorization` validates callback issuer according to the provided metadata and performs one token POST; it does not know the callback's state or the service owner's lifetime. `refreshAuthorization` preserves an old refresh token when a successful response does not rotate it. The host must provide mandatory state, exact resource/issuer/client/redirect binding, bounded guarded fetch, response limits, cancellation, generation checks and private token storage. These are implemented SDK mechanisms, not proof of Figma permission or live compatibility. The protocol requires resource-bound authorization and PKCE; the host still owns its callback transaction. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

### Recommended first candidate: two new files

Own only `service/packages/mcp/src/official-figma-oauth.ts` and `service/packages/mcp/test/official-figma-oauth.test.ts` for the first implementation/review. This avoids the active CLI/portal recovery scope. No new dependency, alternate capture engine, persistent vault, public login route, live registration, browser opener or ordinary-capture OAuth automation is needed for this candidate.

Implement a session-only owner for `status`, `begin`, `complete`, `cancel`, `logout`, and a private bearer callback. Inject metadata, service-owned registration information, an explicit eligibility/redirect contract, clock and fetch transport. Missing eligibility/registration/secret/approved redirect returns a concrete blocked status before creating a consent URL or issuing network work. A fixture's synthetic client identity is explicitly a fixture and must never be promoted into production configuration.

The engine should:

- Pin the one MCP resource and validated Figma issuer/authorization/token endpoints. Reject absent S256, unsupported client authentication, guessed endpoint fallbacks, redirects and metadata changes during a transaction. Keep discovery credential-free and registration excluded from this first transport. Tests can inject dated sanitized metadata without discovering anything live.
- Allocate one transaction with random state, SDK S256 verifier, exact owner/client/resource/issuer/redirect/discovery generation and an absolute interactive deadline. Construct an authorization URL only after the callback owner supplies a successfully bound, contract-approved loopback URI. Do not assume arbitrary ephemeral callback ports are accepted by Figma; their native-app standard support does not prove this registration's acceptance. [RFC 8252 loopback redirects](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3).
- Validate a callback envelope's exact state, code cardinality, deadline and issuer. Consume its state before the single exchange. Serialize refresh/logout, prevent late token publication after cancellation or owner/generation change, and keep tokens/secret/verifier/code in memory. Expired or uncertain refresh stops authenticated use and reports explicit login required. No SDK `auth()` recovery loop.
- Publish only stage, expiry and authorization generation. Return the access token solely through the private callback that can later feed `OfficialFigmaConnectionOptions.oauthToken`. Never return raw SDK errors, OAuth URL queries, codes, verifiers, refresh tokens or secrets through portal status/activity/diagnostics. Session-only credentials disappear on daemon restart; this is not encrypted persistence or an OS sandbox.

Tests should run the actual installed SDK with injected controlled responses, plus owned local fixtures if needed. Verify S256/resource/state construction, both supported secret methods, refusal of missing secret or unsupported `none`, zero requests without the registration gate, no DCR or automatic auth, wrong/duplicate/expired state, changed issuer/resource/redirect, callback consumption and one POST even after `invalid_grant`/`invalid_client`/lost response, refresh rotation and uncertain response, concurrent completion/logout, cancellation and unchanged absolute deadlines, stale-publication rejection, and credential canaries absent from every public projection/error. Mock success establishes the engine contract, not live Figma login.

### Second delivery and operator-blocked finish

After independent review, wire the engine into the existing daemon owner/control authorization and callback listener, then the portal settings and public CLI/catalog. Concrete later paths are `control/figma-settings-endpoint.ts`, `index.ts` (one provider for probe/read/generation), `official-figma-mcp.ts` (private bearer callback and corrected handoff wording), `packages/cli/src/official-figma-mcp-command.ts`, portal control/settings/schema/web UI, and their existing tests/inventory. Stage one must leave `oauthLoginImplemented:false` truthful because no public login workflow is wired yet. Stage two can report an implemented but registration-blocked login without claiming authorization or capture readiness.

Operator-blocked facts remain this application's Figma eligibility, own client ID/auth method and service-specific credential acquisition, accepted redirect URI/port contract, fresh supported metadata, manual owner consent and actual token/probe success. They do not block writing the first candidate. Real DCR must be a later expressly authorized own-service setup step only if Figma supports it for this identity; no listed client's ID/name/token or REST app grant is a substitute. Secure persistence is optional later product work. Full-program `use_figma` discovery, file/asset/freshness comparison and final frontend acceptance remain separate service-owned gates after authentication.
