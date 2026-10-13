# Super Figma Pipeline local web portal

The portal is a login-free, same-origin interface to the private local service. It edits workflows, exposes implemented public functions, retains job/approval history and tracks real capture, coding-agent, validation and application states. Start does not launch a background coding model.

Build/install the verified service distribution first. From its service directory, start the daemon and portal in separate terminals:

```powershell
node packages/mcp/dist/daemon-entry.mjs
node packages/portal/dist/index.mjs
```

Open `http://127.0.0.1:4310` in Google Chrome. `SFP_PORTAL_PORT` selects the portal port and `SFP_CONTROL_PORT` its private daemon port. Both processes must use the same owner and matching `LOCALAPPDATA`/`SFP_STATE_ROOT`; `SFP_PORTAL_STATE_ROOT` selects the portal store. Keep the current portal tab and source Figma session. Native Chrome permission is manual and distinct from portal or Figma login.

Read [DEBUGGING.md](DEBUGGING.md) for bounded diagnostic files, request/job correlation, privacy and write-failure limits. A source checkout also includes [the complete portal user guide](../../../docs/portal-user-guide.md).

## Source catalog and deployed availability

The October 13 source inventory contains **129 MCP tools and 65 CLI feature entries**. Eleven CLI entries directly alias MCP tools, so these counts are not 194 unique capabilities. Service Functions exposes actual input schemas and retained job results; Administration and Connection Settings provide the corresponding operator controls.

These counts were derived from the integrated source, not queried from a running service. At this documentation update, the retained QA daemon still used its cached a476 build. Refresh the portal's catalog/status after a verified matching daemon/portal deployment. A newer static page, a rendered control or a source inventory does not prove its backend is deployed or an effect succeeded.

## Official Figma connection settings

Actual official MCP verification is deferred at the owner's October 12 request. This section describes the own-OAuth-capable build after its verified deployment, not successful Figma eligibility, authentication or full capture. Older running builds can report OAuth unavailable.

Choose the remote official endpoint `https://mcp.figma.com/mcp` or the separate Desktop endpoint `http://127.0.0.1:3845/mcp`. Remote mode supports this service's own approved OAuth client or an externally provisioned own-service OAuth token **environment-name reference**. Do not extract another application's token/cookies or paste any client ID, secret, token, verifier, callback code/state or authorization URL into this UI.

### Operator setup before Connect

Obtain Figma's accepted contract for **this service's own client**, accepted `client_secret_basic` or `client_secret_post` authentication and exact fixed callback URI. A waitlist, advertised registration endpoint or declaration is not accepted eligibility; the service does not perform dynamic registration or public-client fallback.

Install a secret-free UTF-8 contract record at `<daemon-state-root>/figma-auth/contracts/<reference>.json` with the service's verified private owner/SYSTEM protection. The loader requires regular single-link files and protected directories, not symlinks or permissive inherited ACLs. Its fields are `schemaVersion:1`, `serviceName:super-figma-pipeline`, `eligibility:accepted-own-service-client`, `operatorDeclaration:true`, a nonsecret `evidenceReference`, approved `clientIdDigest`, accepted `authenticationMethod`, exact query-free `redirectUri`, and `callbackMode:fixed`. Declare acceptance only after obtaining it. The URI uses HTTP literal `127.0.0.1` or `[::1]`, an approved nonzero fixed port and non-root path; no fallback/tunnel is chosen.

`clientIdDigest` is `sha256:...` of the exact client ID's UTF-8 bytes. The settings contract digest is `sha256:...` of the exact installed JSON bytes; whitespace changes it. The reference is the filename stem without `.json`, limited to 64 ASCII letters, digits, underscores or hyphens. The installed record is limited to 16,384 bytes. Use UTF-8 without a byte-order mark. These references do not prove Figma accepted the client.

Provision actual accepted client/secret values privately in the **daemon's environment**. Enter only variable names, for example `OWN_FIGMA_CLIENT_ID` and `OWN_FIGMA_CLIENT_SECRET`, plus the installed reference/digest in settings. Saving names does not set environment values. Inspect active/unknown work before any controlled restart needed for provisioning; do not blindly restart or replay jobs.

### Connect and consent

1. Select remote own-OAuth mode, save references and read current authentication status.
2. Missing contract/environment, changed digest or occupied approved callback port remains a useful blocked state. No discovery, exchange or consent navigation starts for a blocked prerequisite. Resolve an unrelated unknown-work fence through its own reviewed procedure.
3. Explicitly start a new login. The original bounded deadline and provider/configuration/auth generation remain in force.
4. Open the separate consent-tab link. The original portal tab stays open. The consent page GET only reads local status. Choose Continue there, then review Figma sign-in/consent and any native browser approval yourself.
5. Return to the portal and read actual status. Changed query/hash, cancelled/expired flow or stale generation blocks handoff. Do not copy callback URLs/code/state or replay a consumed handoff.
6. Probe through the same daemon provider. Login, observed server authorization, compatible program tools and complete scoped capture are separate facts. None grants model-data permission, resets a capture deadline or proves frontend completion.

The interface labels installed eligibility as an operator contract declaration. Status polling preserves unsaved references and never automatically starts login or refresh. Desktop receives no remote credential/session; local probe/read remains supplemental where fixed-program support is absent.

### Session actions and CLI

Cancel targets the current bound login. Local logout clears the owned session/handoff/listener and retires dependent requests; it does not claim remote revocation, rollback, removal of environment provisioning or resolution of old jobs. Own-OAuth tokens are session-only memory and disappear on restart while reference settings can remain. Clearing JavaScript/SDK references is not guaranteed zeroization.

Refresh is explicit and bounded before expiry. Capture never automatically refreshes or opens consent. Inspect uncertain exchange/refresh before a new explicit login; do not retry consumed code or a possibly rotated refresh token.

The public CLI supports:

```powershell
node packages/cli/dist/index.mjs figma-mcp auth status
```

It also provides `configure`, `start`, `cancel`, `logout` and `refresh`. Mutations require exact current `--provider-instance-id`, `--configuration-generation`, `--auth-generation`. Configure accepts environment names and contract references; start/refresh require original absolute `--deadline-at` epoch milliseconds, and cancel/logout accept current `--flow-id`. Re-read status on mismatch. CLI start prints safe status and relative portal consent-view instructions, never an authorization URL or automatic browser command.

Terminal probe/read share the daemon provider. External mode `--oauth-token-env` must match that daemon's configured environment name; no local token value is copied. Default CLI connections assume port 3055 and matching owner/state. For a separately configured runtime, use its portal controls rather than mismatched private state/default ports.

The same six functions are available through Service Functions. Select the exact feature, read the generated form, review the request and submit once:

| Feature                    | Required input                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `figma-mcp.auth.status`    | Empty object; reads safe current status                                                                                  |
| `figma-mcp.auth.configure` | Current binding plus `configuration` containing endpoint/mode, environment names and installed contract reference/digest |
| `figma-mcp.auth.start`     | Current binding plus original absolute `deadlineAt`                                                                      |
| `figma-mcp.auth.cancel`    | Current binding plus current `flowId`, which may be null                                                                 |
| `figma-mcp.auth.logout`    | Current binding plus current `flowId`, which may be null                                                                 |
| `figma-mcp.auth.refresh`   | Current binding plus original absolute `deadlineAt`                                                                      |

The binding is `providerInstanceId`, `configurationGeneration` and `authGeneration` from a fresh status read. Re-read on a mismatch; never invent or increment generations. Configuration contains all seven fields: `endpoint`, `mode`, `oauthTokenEnv`, `clientIdEnv`, `clientSecretEnv`, `contractReference` and `contractDigest`. Unused references are null. Values in the environment remain private to the daemon. No catalog field accepts callback code/state, tokens, client-secret values or an authorization URL. Consent handoff remains the separate manual native form after an explicit Start transaction, not a generic JSON function.

## Prepare compiler evidence from a reference source

For an existing-source case, Service Functions exposes MCP tool `portal_prepare_source` and CLI alias `portal.prepare-source`. This runs an explicitly reviewed source-preparation profile in a fresh owned native work copy. It does not collect Figma, issue a coding lease, submit/apply code or complete acceptance.

1. Register the relevant reference workspace and create the source-bearing plan/run. Inspect its actual context and selected `sourceId`. The run must have no candidate or active coding lease; an unresolved workflow can remain `needs-input`.
2. Have the coding agent prepare a profile through `portal.profile.prepare` with `purpose:source-preparation`, matching `sourcePreparation`, plan/context, package root and exact commands. Review the entire returned profile, including source, importer/lock/configuration and artifact bindings. Register that exact prepared object through `portal.profile.register`. Preparation and registration do not execute it.
3. Select `portal.prepare-source` or `portal_prepare_source`, choose the available result workspace, and fill exactly `runId`, `profileId`, `sourceId` and `deadlineAt`. Use the service run ID, registered profile ID and source hash returned by the current plan. The deadline is absolute epoch milliseconds and must not exceed the original run deadline.
4. Submit once and inspect the retained compiler result. A failed or unknown attempt is not automatically replayed. Successful compiler evidence is owner/workspace/source/generation bound and expires when its daemon authority retires. Create a fresh plan to consume current evidence and review any still-unresolved source/workflow decisions.

The equivalent public command is:

```powershell
node packages/cli/dist/index.mjs portal prepare-source <service-run-id> --args-file <bound-source-preparation.json>
```

For this positional CLI form, the argument file contains `profileId`, `sourceId` and `deadlineAt`; the positional ID supplies `runId`, so do not duplicate it. Service Functions/MCP receive all four fields. Compiler evidence alone does not confirm business workflows or prove full source closure, Figma capture, application or frontend acceptance. Capture and any requested native contour supplement require their own admitted source operation; profile preparation only looks up existing protected capture evidence.

## Supplemental native geometry for new authoring

The integrated source adds optional `nativeGeometry` paging to existing MCP `portal_next` and CLI alias `portal.next`; catalog counts remain 129 MCP/65 CLI. This feature requires a matching verified daemon deployment. Cached a476 and newer static UI alone do not provide it. Actual fresh complete CDD journeys remain 0/3; official MCP live verification is owner-deferred.

In Service Functions, select the tool/alias with the current workspace/run and include `nativeGeometry: { section: "resources", offset: 0, limit: 64 }`. The coding agent follows returned `nextOffset` values, retains the first `binding.bindingHash` for all later pages and nodes-section entry, and checks all totals/references. Each geometry page has at most 64 rows and 256 KiB encoded UTF-8 JSON; oversized single rows fail closed. Normal Next without the object performs no native lookup.

Next can claim/renew a coding lease. Use the same authenticated session and current `leaseId` on subsequent calls when a lease exists. The native supplier only reads current protected signed capture evidence and document bytes; it never opens Chrome or exports on this read. Missing supplement requires a new admitted source capture, not profile preparation, a private path, an earlier document or caller JSON. Current model-data authorization must include design-text and design-image. Original run/grant deadlines stay unchanged.

Resources contain actual normalized SVG `d`, source hashes/IDs and fonts. Nodes retain characters, empty-space glyphs, dimensions, native layout, nominal and painted sizes, paint and exact placements. Resolve every resource reference and preserve source matrices/paint without guessing font sizes. Each page binds current owner/workspace/run/plan/context/full scope/capture/document and original deadline. It is supplemental, fullCapture:false and non-atomic; ordered checks cannot detect ABA or changes after the final observation. Public authoring facts do not replace independently derived server acceptance expectations.

For CLI Next, put the optional geometry object plus any current lease/continuation fields in an argument file, excluding `runId` because the positional ID supplies it:

```powershell
node packages/cli/dist/index.mjs portal next <service-run-id> --workspace-id <workspace-id> --args-file <native-page.json>
```

The source-checkout user guide provides the JSON examples. On mismatch/expiry/cancellation, inspect status and obtain current context; never splice old/new page bindings or reset a deadline. Collection, required interaction semantics, candidate validation, application and final freshness remain separate acceptance gates.

## Jobs, approvals and unknown outcomes

Review the exact pending inputs and impact before confirming an action. Unchanged polling preserves the approval target and disclosures. During an existing request, action controls are disabled until it settles; a click is not success until the server records the result.

Unknown work retains its original outcome/evidence/deadline. Inspection or a separately reviewed local-fence disposition does not replay or declare success. Authentication, settings, status refresh and logout never resolve an original job or grant model data. A fresh operation requires fresh explicit review; expired approval is not renewed by refresh.
