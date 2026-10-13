# Service-owned official Figma OAuth setup

Analysis date: October 11, 2026 (Asia/Seoul).

This is a read-only design investigation during the merged-source freeze. It supplements [the official source implementation](official-mcp-path.md), [the continuation record](README.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The parent owns canonical analysis and instruction updates.

## Decision

A service-owned login command can remove manual access-token handling, but it cannot establish this service's eligibility to register with Figma. The installed SDK supplies the OAuth mechanisms. Figma's current official policy separately restricts the clients that may connect. The next product step is to obtain a supported client registration for this service and confirm its allowed redirect URI, then implement explicit login around that registration. Advertising a dynamic registration endpoint is not proof that an unlisted service may register successfully.

Figma's [access documentation](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/#which-mcp-clients-are-supported) states:

> Only clients listed in the Figma MCP Catalog are able to connect to the Figma MCP Server.

The excerpt is 17 words. The page links to the [catalog](https://www.figma.com/mcp-catalog/) and a [new-client waitlist](https://form.asana.com/?d=10497086658021&k=kBG-ejRQTdY8x_H6a4vM3Q). No waitlist submission or registration was made. An ordinary Figma personal access token or REST OAuth grant has not been demonstrated to authorize the MCP resource and its `mcp:connect` scope. Do not ask the owner to paste a token or imply that any Figma token solves the client-registration prerequisite.

## Baseline and actual work

- Published main: `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with authorized uncommitted implementation and report changes.
- Frozen merged service fingerprint reported by the parent and recorded in the canonical analysis: `sha256:18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3`. Whole attempt `b61a1d7a-b4bd-4b5a-bc19-a189b72cfe9a` was running when this investigation began; no whole-check outcome is inferred here.
- Read installed `@modelcontextprotocol/client` **2.0.0** declarations and implementation under `.worktrees/baseline/service/packages/mcp/node_modules/@modelcontextprotocol/client/dist/`, plus the service's current official client, state permissions, runtime paths and signed record store.
- Read current official Figma documentation, MCP authorization requirements and the native-app redirect standard. Search results from third-party tutorials were not used to establish registration eligibility.
- Executed two credential-free, read-only discovery GETs through the installed service SDK, with a fixed official URL allowlist, manual redirect rejection, no Authorization/Cookie headers and a 15-second request bound. This was metadata investigation, not an implemented CLI login or authentication acceptance test.
- No service code, generated metadata, credentials, daemon state or browser state was changed. No client was registered, no consent URL was opened, no token endpoint was called, and no existing connector credential was inspected. Only this Markdown report was added by this investigation.

## Observed public OAuth metadata

At **15:01:29 KST**, `discoverOAuthServerInfo('https://mcp.figma.com/mcp', { fetchFn: guardedReadOnlyFetch })` returned:

| Public discovery request | HTTP result |
| --- | --- |
| `https://mcp.figma.com/.well-known/oauth-protected-resource/mcp` | 200 |
| `https://api.figma.com/.well-known/oauth-authorization-server` | 200 |

The returned public metadata advertised:

| Field | Observed value |
| --- | --- |
| Protected resource | `https://mcp.figma.com/mcp` |
| Authorization server and issuer | `https://api.figma.com` |
| Authorization endpoint | `https://www.figma.com/oauth/mcp` |
| Token endpoint | `https://api.figma.com/v1/oauth/token` |
| Dynamic client registration endpoint | `https://api.figma.com/v1/oauth/mcp/register` |
| Resource and authorization scopes | `mcp:connect` |
| Response type | `code` |
| Grant types | `authorization_code`, `refresh_token`, `urn:ietf:params:oauth:grant-type:jwt-bearer` |
| PKCE challenge method | `S256` |
| Token-endpoint client authentication | `client_secret_basic`, `client_secret_post` |
| Client ID Metadata Document support | No `client_id_metadata_document_supported` field was advertised. |

These results establish advertised discovery, authorization-code, PKCE and dynamic-registration interfaces. They do not establish successful registration, allowed client metadata, accepted callback addresses, granted client authentication method, login, refresh, user identity or tool access. In particular, the metadata does not advertise token-endpoint authentication method `none`. A native public-client flow cannot assume that a client ID alone will suffice. An approved per-installation registration might receive credentials; that was not attempted. Embedding a shared confidential client secret in a distributed CLI is not a proposed solution.

The read-only command imported `discoverOAuthServerInfo` from the installed `@modelcontextprotocol/client/dist/index.mjs` and ran from the native service copy using `node --input-type=module` with a stdin script. Its fetch wrapper accepted only GET, rejected authentication/cookie headers and redirects, and printed only the allowlisted public fields above. It did not invoke `auth()`, `registerClient()`, `exchangeAuthorization()` or `refreshAuthorization()`.

## What the installed SDK can do

The installed declarations in `dist/index.d.mts` and implementation in `dist/index.mjs` are the version-specific source of truth for this proposal:

| SDK capability | Implementation implication |
| --- | --- |
| `OAuthClientProvider` | Host supplies client metadata, redirect URI, saved registration, token storage, PKCE verifier storage, authorization URL handoff and credential invalidation. |
| `discoverOAuthServerInfo` | Discovers the protected resource and authorization server. Keep issuer validation enabled and enforce the service's own endpoint restrictions. |
| `auth(provider, options)` | Orchestrates discovery, approved registration when needed, authorization-code exchange and refresh. It can register automatically if client information is absent, so do not call it before the registration gate has been satisfied. |
| `startAuthorization` | Creates an S256 verifier/challenge and authorization URL. The host still needs a mandatory random state and a pending login transaction. |
| `auth(..., { authorizationCode, iss })` | Supports callback exchange and issuer validation. The host must validate the callback state first; the SDK API does not receive the callback's state value. |
| `saveDiscoveryState` and `discoveryState` | Preserve issuer/resource discovery alongside the verifier throughout the redirect round trip. The installed SDK warns or rejects when that binding is missing. |
| `clientInformation` and token callbacks | Values are issuer-bound in v2. Service storage must additionally bind owner, client, MCP endpoint/resource and scopes. |
| `registerClient` | Still implements dynamic registration. The installed SDK marks DCR deprecated for the newer protocol in favor of advertised Client ID Metadata Documents; current Figma discovery does not advertise that alternative. |

The installed `startAuthorization` rejects an explicitly incompatible PKCE-method list but permits an absent list. The service should enforce a positive `S256` advertisement before proceeding. MCP requires PKCE support verification, resource-bound authorization, suitable redirects and callback state handling. These requirements inform the proposed guards below. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## Current service gaps

`packages/mcp/src/official-figma-mcp.ts` currently accepts externally authorized credentials through an in-memory callback. `SFP_FIGMA_MCP_OAUTH_TOKEN_ENV` names a variable; it is not an OAuth login implementation. The CLI has `config`, `probe` and `read`, but no service-owned registration, callback, token exchange, refresh or logout workflow.

The current guarded MCP fetch accepts only the configured `/mcp` URL and turns 401/403 into `FIGMA_MCP_AUTH_REQUIRED` before the SDK's automatic authorization path can act. Replacing the bearer provider with `OAuthClientProvider` alone would therefore fail. A separate explicit auth workflow needs separate endpoint rules; the ordinary capture transport should keep its existing MCP destination restriction and should not unexpectedly open login or widen scopes during capture.

`PortalStore` signs records with HMAC and verifies owner-state boundaries. It does not encrypt payloads. A repository search found no DPAPI or Windows Credential Manager integration for persistent OAuth secrets. Reusing signed portal JSON for plaintext refresh tokens or client secrets would misrepresent the existing protection. Existing Windows ACL and atomic-file helpers can support the surrounding record lifecycle, but confidential credential storage remains new implementation work.

## Proposed CLI and session flow

This section is a design, not an implemented command set.

1. Add `sfp figma-mcp auth-status` and explicit `sfp figma-mcp login`. Status reports stages such as `client-registration-required`, `ready-for-consent`, `waiting-for-callback`, `authorized` and `expired`, plus sanitized scope/expiry/endpoint facts. It never returns tokens, authorization codes or PKCE verifiers. The login command runs under the existing authenticated owner control channel; it does not become a general MCP tool that a model can use to approve itself.
2. On login, validate the one remote MCP resource, perform bounded fresh discovery, require the observed official issuer/endpoints and S256, and load the service's own approved client registration. If registration is absent, stop with a concrete registration prerequisite. After Figma approval, a separately authorized setup step may use the advertised DCR endpoint with the real service identity, or install service-specific preregistered metadata. Never impersonate a catalog client, copy its client ID/secret, or obtain its cached tokens. A generic REST OAuth application is not assumed to be an MCP registration.
3. Bind the callback listener before constructing the authorization request. Propose an exclusive loopback listener at `http://127.0.0.1:<approved-port>/oauth/figma/callback`. Use an ephemeral port only if this service's Figma registration explicitly accepts the loopback-port behavior. Otherwise use the exact approved fixed port and fail if occupied. The native-app standard supports loopback redirects, including variable ports, but this investigation did not test Figma's registration acceptance. Do not introduce a tunnel or a third-party callback service to bypass a mismatch. [RFC 8252, section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3)
4. Create a pending transaction bound to owner, issuer, resource, client registration, exact redirect URI, discovery hash, one random state, one S256 verifier, a fixed login deadline and one-use completion status. A proposed ten-minute interactive login deadline is independent of existing capture/run deadlines and never renews those deadlines. Prefer an in-memory pending transaction in the owning daemon. A daemon restart invalidates unfinished login rather than replaying an uncertain authorization code.
5. Print the official authorization URL for the owner to open manually in Google Chrome. A future explicitly requested `--open-chrome` may launch the validated URL through the service without attaching CDP, reading cookies or controlling the page. Keep this manual consent interaction separate from source capture and preview sessions. The user performs sign-in, any SSO and consent. The service does not inspect or click browser security approvals.
6. Accept one bounded GET on the exact callback path and bound local socket. Require the correct state, deadline and pending owner transaction; reject duplicates, wrong hosts/ports/paths, malformed parameters and replay. Validate `iss` according to the pinned issuer metadata. Do not log the request URL/query, code or state. Use a static no-store callback page with no external resources. Exchange the code once through the SDK, using the saved verifier and exact redirect URI, then erase pending verifier/code material.
7. Store only this service's credentials through a dedicated owner-bound credential store, and expose a bearer callback to the ordinary official client. A bounded refresh path may rotate this service's own refresh token under a per-owner/client lock. Preserve issuer/resource/scope binding on replacement. On missing or invalid refresh credentials, return an explicit login-required status; do not launch browser consent from a capture operation. Keep insufficient-scope handling explicit and do not silently expand scopes.
8. After successful exchange, run the service's official `probe` and verify actual tool capabilities. Authorization success is not complete capture. Only the existing independent acquisition, asset, identity, freshness and frontend validation gates can establish acceptance. Add `sfp figma-mcp logout` to stop new authenticated requests, clear pending transactions and remove this service's stored credential record. Remote revocation is only available if an approved documented/discovered endpoint is implemented; none was advertised in the selected metadata recorded above.

## Endpoint and storage boundaries

The proposed auth fetch wrapper is separate from the unchanged capture fetch. Its permitted operations are narrow:

| Destination | Permitted use |
| --- | --- |
| `https://mcp.figma.com/.well-known/oauth-protected-resource/mcp` | Credential-free GET discovery; a root well-known fallback only if explicitly implemented and tested. |
| `https://api.figma.com/.well-known/oauth-authorization-server` | Credential-free GET issuer discovery. Reject changed issuer/endpoints until reviewed. |
| `https://www.figma.com/oauth/mcp` | Construct a browser authorization URL for manual Chrome consent. Never send an MCP bearer token here. |
| `https://api.figma.com/v1/oauth/mcp/register` | POST only during the explicit approved client setup operation. Never triggered as a side effect of a portal plan or capture. |
| `https://api.figma.com/v1/oauth/token` | POST form data only for this service's authorized code exchange or refresh, with the registered client-auth method. |
| `https://mcp.figma.com/mcp` | MCP operations with this service's MCP-scoped access token. |
| The exact admitted `127.0.0.1` callback socket | Receive the one pending browser response. It is not a network forwarding proxy. |

Reject redirects in discovery, registration and token fetches; do not forward credentials to a redirected host. Bind all network work to a fixed deadline, cancellation and response-size limit. The current installed SDK uses different hosts for the authorization and resource servers, so a broad wildcard host exception is unnecessary. User-controlled browser navigation during manual SSO is distinct from service HTTP requests.

For Windows persistence, implement a dedicated encrypted credential record under the existing validated owner-state root, for example `official-figma/oauth/<owner-and-client-key>/`. Proposed protection is Windows DPAPI with `CurrentUser`, coupled with the existing owner/SYSTEM ACL checks, retained directory checks and atomic create/CAS replacement. Test the fixed helper and transport before enabling persistence. Until that exists, use a session-only credential cache and report that restart requires login. Never fall back silently to plaintext portal JSON, project files, environment files, shell arguments or general operation artifacts.

DPAPI and owner-only ACLs do not isolate credentials from the same Windows owner, administrators or an already compromised process. No OS sandbox is claimed. Encrypt client secrets and refresh tokens as well as access tokens when persisted; keep pending codes and verifiers out of logs and durable general-purpose evidence. Public client metadata, endpoint hashes and sanitized expiration status can remain in non-secret records. Do not change global external-model secret-egress permissions to implement direct Figma token exchange.

## Tests required before implementation can be accepted

- Protocol fixtures using the actual installed SDK: discovered DCR/S256, absent S256 rejection, missing/changed issuer, unsupported client authentication, no CIMD claim, and registration denied without a retry under another client's identity.
- Exact HTTP method/destination checks: redirects, hostname aliases, non-default HTTPS ports, credentials in URLs, arbitrary metadata URLs, unexpected token destinations and bearer leakage. Ensure plain probe/capture never registers or opens consent.
- Callback tests: state mismatch, missing state, wrong `iss`, timeout, occupied port, foreign Host, duplicate callback/code, unexpected path, oversized request, replay after restart and two owners logging in concurrently. Verify that port binding occurs before authorization starts.
- Cancellation and unknown-outcome tests: delayed discovery/registration/token responses, closing the login command, daemon shutdown, lost exchange responses, no late publication and no automatic replay of a possibly consumed code.
- Storage tests: ACL/reparse-boundary failure, encrypted round trip, wrong Windows owner, corrupted ciphertext, missing vault support, atomic refresh rotation, stale-writer rejection, concurrent refresh, logout fencing and no plaintext fallback.
- Redaction tests: no authorization code, verifier, client secret, token, callback query, request/response body or credential-bearing SDK error in CLI JSON, logs, journal, reports, diagnostic artifacts, progress events or model-visible data. SDK `RegistrationRejectedError` retains server body and submitted metadata; sanitize before publication.
- Integration after client approval: manual Chrome consent, service-owned exchange/refresh/probe, then actual official tool discovery and separate new-frontend acquisition/generation/validation. Do not count an approved external client's login as this service's acceptance.

## Practical blockers and supported continuation

The confirmed policy blocker is approved-client eligibility. Metadata confirms advertised DCR and S256; registration permission and the accepted loopback redirect remain untested. The server advertises secret-based token authentication, so the approved registration must specify how this installed service receives and protects its own credentials. The service additionally needs the explicit login/callback flow and a secret store; these do not exist in the frozen implementation.

An owner can use a catalog-supported client and its [documented Figma OAuth setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), but that client's token is not a service setup artifact and its reads do not satisfy the project acceptance rules. The service-compatible route is Figma approval for this service or another Figma-documented registration route explicitly permitting this service's own OAuth identity. Then the proposed login removes manual token handling while keeping consent manual.

Enabling `http://127.0.0.1:3845/mcp` can support the existing local five-tool supplemental read path. It does not establish the required remote full-program acquisition, and it does not remove the remote client-registration prerequisite. No authentication or capture success is claimed by this analysis.
