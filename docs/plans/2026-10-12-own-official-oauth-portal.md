# Own-service official OAuth portal integration design

Date: October 12, 2026 (Asia/Seoul).

This is a proposed second delivery, not implemented login. Read [the authorization analysis](../analysis/official-mcp-authorization.md), [the engine implementation](../testing/2026-10-11-web-portal/own-official-oauth-engine.md), [the engine plan](2026-10-12-own-official-oauth-engine.md), [the current retained-tab record](../testing/2026-10-11-web-portal/retained-tab-live-qa.md) and [repository instructions](../../AGENTS.md) first. The root's a476a925 source and its independent whole/artifact result do not include this managed engine or proposed wiring. Source ownership must be assigned before implementation. No live authentication, browser action, network, state, policy, preference or source change is authorized by this design alone.

## Deliverable and explicit prerequisites

Add useful remote-connection settings that expose start, status, cancel, logout and explicit refresh. The normal status view must remain informative when configuration is absent, show the exact blocked prerequisite, and make no remote request or consent handoff. Preserve current endpoint-specific probes/reads and the legitimate externally provisioned **own-service** token mode. Desktop remains separate and never receives remote credentials.

The operator must first obtain this service's accepted Figma client/eligibility contract, own credential acquisition instructions, client authentication method and exact approved callback contract. A new-client waitlist or a registration endpoint advertisement is not that contract. A checkbox records a declaration, not verified Figma registration. Do not borrow an approved application's name, client ID, secret, tokens, cookies or credential store. No DCR or public-client fallback is included. [Figma client access policy](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

Only client-ID and client-secret **environment variable names** may enter/save portal configuration. The UI, JSON APIs, activity, jobs and signed preference files must never receive or persist their values, OAuth tokens, verifier, state, code, consent URL or actual callback URL/query. A configured, query-free approved redirect URI is non-secret contract metadata and may be shown; it is distinct from an actual callback request containing code/state. Existing environment-token compatibility remains explicit and must not imply another application's token is acceptable.

Require an operator-installed, secret-free own-client contract record before start: service name, contract/evidence reference, client-ID digest, supported method, allowed redirect contract, version and operator declaration. Compare the named environment's resolved client ID with that contract digest. Actual Figma approval remains an operator-provided external fact; status must label the source as declared/contract-supplied and avoid claiming server-verified eligibility merely because the form or record exists. Later successful own-client exchange and authenticated probe are separately recorded observations.

## Ownership and one provider instance

The daemon owns the engine, credential references, protected metadata acquisition, callback listener/lease and temporary private consent-URL handoff registry. Use the same `createFigmaMcpSettingsEndpoint` provider instance that `index.ts` already supplies to probes, reads and generation. CLI and portal are control clients; neither creates a separate token owner or imports daemon credentials into the browser.

Bind every operation to authenticated internal owner, provider instance, configuration version, auth generation, original deadline, contract digest and endpoint. The internal owner ID must come from authenticated control authority, never an arbitrary public body field. Environment lookup is limited to explicitly configured own-service variable names in that daemon's environment. Saving a preference does not set process environment or manufacture credential availability. Missing names/values/contract produce a closed blocked state.

Changing configuration, cancelling, logout or expiry invalidates private handoffs and old readiness probes. Rotate/replace credentials only under one owner/generation. Add credential generation to capture/probe request context and abort dependent official requests on retirement; reject late results from an older generation. Do not replace a transport mid-RPC or silently reconnect/replay. Refresh is an explicit action, not SDK convenience auth or a capture-triggered browser flow. Each attempt keeps its original capture/login/token budget. The first engine currently expires credentials at the metadata freshness bound and requires refresh before access-token expiry; configure a deliberate bounded policy and show it truthfully. Do not claim an eight-hour capture grant or token lifetime from a successful login.

## Routes and consent delivery

Names below are proposed route contracts. Reuse the existing host/origin/fetch-site/CSRF validation in `packages/portal/src/server.ts` and authenticated private control routing. GET status is read-only. All start/configuration/cancel/logout/refresh/handoff actions require explicit owner-authorized POST or the existing protected PUT settings action. No GET creates a login, redeems a handoff or refreshes credentials.

| Portal surface | Daemon/control behavior | Response |
| --- | --- | --- |
| Existing PUT `/api/figma-settings` | Save only endpoint/mode, environment names and contract references with configuration CAS | Safe configuration/status |
| GET `/api/figma-settings/auth` | Read same provider's status and declared prerequisites | Safe status only |
| POST `/api/figma-settings/auth/start` | Admit owner/scope, validate contract/env references, obtain bounded official metadata, bind lease, begin one transaction | Safe provider/generation/flow status; no consent URL |
| POST `/api/figma-settings/auth/handoff` | Redeem that owner's pending private handoff once, with provider/config/auth generation and original deadline | Validated HTTP 303 Location to the exact official consent endpoint; no JSON URL |
| POST `/api/figma-settings/auth/cancel` | Cancel only the specified current login transaction | Safe status |
| POST `/api/figma-settings/auth/logout` | Retire local credentials, pending listener/handoff and dependent requests | Safe status; no remote-revocation claim |
| POST `/api/figma-settings/auth/refresh` | One bounded engine refresh with current owner/config generation | Safe status; probe readiness invalidated |

Add a dedicated internal control response method for the private redirect relay. Existing CLI `control-client.ts` uses `redirect:'error'` and JSON parsing, so do not weaken its general request method. The new owner-only method must use manual redirects, validate the pinned daemon response and exact official authorization origin/path, and relay only the intended Location header. It must not follow that Location with daemon/portal credentials. The URL is stored only in daemon private memory, then delivered through the protected native-navigation response header. No public JSON, feature-job stdout/result, diagnostics context or activity row may contain it.

The browser consent view opens as an explicitly requested separate tab in the owner's existing Google Chrome window. Retain the current portal tab and source Figma session. A same-origin static consent page can prepare a native POST form for the handoff; it must not create auth state on GET. The owner chooses Continue and then performs Figma sign-in/consent manually. No service code approves native security dialogs or Figma consent. CLI start prints safe instructions/status and points the owner to that portal consent view; it must not route a private authorization URL into normal CLI JSON/stdout that feature jobs archive. Future browser-opening support requires a separate explicit owner action and review.

Two existing web guards require deliberate narrow work:

- Native forms cannot set `x-sfp-csrf`. Keep that header requirement for every existing route. Only the specific bounded handoff form may accept the same CSRF token as a form field, after strict same-origin/Host/fetch-site validation and exact body/content-type/field limits. It is not a general CSRF exemption or alternate public credential endpoint. Do not put the form token in a URL.
- Current portal CSP sets `form-action 'self'`. Keep global portal policy intact. A separate static consent document may use a narrowly scoped form policy allowing only self and the exact official authorization destination, with self scripts, no external resources, no referrer and no caching. Verify actual installed Chrome behavior across the 303 redirect; do not broaden all portal forms to arbitrary Figma destinations.

## Actual loopback callback owner

Bind the contract-approved URI exclusively on literal `127.0.0.1` or `::1` before engine begin or handoff. The callback owner retains the server/address identity and supplies a real `assertBound` lease plus shutdown signal. No listener search/fallback, port reuse, tunnel or wildcard binding. Use an ephemeral port only if the accepted client contract explicitly permits it, and set the actual approved bound URI before calling the engine. Otherwise occupy the exact fixed port or fail closed. Loopback standards do not establish Figma's registration acceptance. [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3).

The dedicated callback listener bypasses ordinary portal/control body/URL/audit middleware and emits only closed stage/error facts. It is not a public login/settings endpoint. Require the exact listener Host/path/port, loopback connection, bounded single GET envelope, valid active state, code cardinality and issuer under the pinned metadata. It must not log request.url, query, Referer, code, state, SDK error body or response credentials. Return a static no-store/no-referrer callback result page with no external resources or raw parameters.

The OAuth protocol's callback GET completes the **already POST-authorized** one-use transaction; it is the explicit exception to ordinary GET mutation prohibition. It never starts login or changes configuration. If the project chooses to prohibit even this protocol continuation, a different accepted redirect contract is needed before implementation; do not pretend OAuth redirects are ordinary read-only requests. The engine consumes valid state before exchange and no lost code response is replayed.

Hold the listener while the original transaction is active; close it and invalidate handoff on cancellation/deadline/shutdown. A successful callback and delayed consent-response acknowledgment may race. Use the frozen engine's same-generation publication settlement, retain the original deadline, and report the truthful final stage. Auth redirect navigation/POST requests may already have effects after cancellation; fence late publication and show login required rather than retrying consumed state. Logout clears local references and aborts owned requests, not remote Figma grants. JavaScript strings/transport copies are not securely zeroized.

## Portal, CLI and fence behavior

The settings panel presents configured/missing environment names, declared contract state, daemon/provider match, stage, expiry and generation. Keep `oauthLoginImplemented:false` until real routes, listener, handoff and provider wiring exist and their integration tests pass. Then report implemented-but-blocked distinctly from authorized, compatible probe and accepted full capture. Saving names alone never produces a connected indicator.

Keep status/read-only inspection accessible during errors. Apply existing scoped admission to configuration/start/refresh and mark side-effect phase before local listener/state or remote exchange effects. Preserve unknown operations and their original operation IDs; auth actions cannot abandon an old export fence, restart an original job, renew its grant/deadline or replace its receipt. Cancel/logout target exact auth-owned resources and must not clear unrelated fences. If an overlapping unknown fence blocks a normal mutator, explain it and leave that route blocked. A lost/partial token exchange cannot become automatic job Retry. A new explicit login uses a new transaction and manual consent only after allowed admission.

Expose every implemented CLI/control capability in the public feature inventory and settings UI. Start/handoff use the privileged owner form path, not a generic archived JSON result containing a URL. Do not add a general model-callable tool that can approve itself. Preserve existing `figma-mcp config/probe/read` arguments and aliases. Official MCP capture still requires compatible `use_figma`, correct file/assets/freshness and independent Chrome parity. Desktop supplemental reads and OAuth login are separate finish lines. Existing source/data grants, including pending owner decisions, remain unchanged.

## Proposed implementation ownership

Assign disjoint scopes after engine review. Do not start simultaneous edits to shared route/contract files.

| Owner scope | Paths |
| --- | --- |
| Daemon/auth owner | New `packages/mcp/src/control/figma-oauth-callback.ts` and tests; `control/figma-settings-endpoint.ts`, `control/route-registry.ts`, `index.ts`, `official-figma-mcp.ts` and existing provider/route tests |
| Portal/control relay owner | `packages/portal/src/server.ts`, `control.ts`, `bridge.ts`, `figma-settings.ts`, `contract.ts`; `packages/cli/src/control-client.ts` and matching private-redirect/control/portal tests |
| UI/public commands owner | `packages/portal/web/figma-settings.js` plus the consent document/script; `packages/cli/src/official-figma-mcp-command.ts`, public library/header exports if needed, command/settings Chrome tests; coordinate shared source inventory changes with root |
| Root integration/review | Catalog/feature coverage, schemas/docs, packaging/provenance/census, explicit source reconciliation, whole check, actual runtime/Chrome authority and final acceptance |

## Meaningful tests and acceptance gates

Test the actual installed SDK/engine through real owned loopback listener and native control/portal HTTP servers, with intercepted official metadata/token responses and globally blocked live auth network. Test occupied/mismatched ports, host/path/issuer/state/code cardinality, callback-before-POST, replay/restart, original deadline, held handoff/callback completion, cancellation and shutdown, duplicate starts and refreshes, config/provider replacement, stale probes/results and credential/request generation. Require actual listener closure proof; do not substitute a stub lease.

Test POST-only mutation, native-form CSRF field limits, wrong/missing Origin and fetch-site, same-origin host confusion, redirect/header injection, manual control redirect handling and no daemon credential forwarding. Run installed Chrome against the owned consent document to prove tab retention, popup/form/303/CSP behavior and that no consent is clicked automatically. Capture canaries must be absent from JSON/status/activity/diagnostics/error/stdout/artifacts, including callback query, Location relay and request/error middleware.

Test missing configuration as useful blocked UI with zero discovery/registration/token/consent calls; reject arbitrary application identity, absent approved contract, wrong client-ID digest, unsupported auth and secret absence. Test unknown workspace fences and uncertain auth attempts without replay or resolution. Packaging must contain the actual public listener/consent resources and use one provider in CLI/probe/capture. Preserve prior failed checks and exact source fingerprints; engine fixtures and old a476 whole/artifact passes are not this integration's acceptance.

Only after owner-provided real contract/credentials and manual consent may the root perform actual own-service exchange/refresh/probe. Then verify who/what server access was granted, compatible full-program tool schema, actual scoped capture, same-scope independent Chrome comparison and frontend freshness/acceptance. Do not use external approved clients or claim those gates from a local mock, checkbox or settings preview.
