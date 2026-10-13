# Service web portal user guide

Updated: October 14, 2026.

Current operator note,07:58KST: open `http://127.0.0.1:4315` in Google Chrome. QA portal28816 and daemon36208/3059 are restored and verified on released sourcea28/build0c4. [The actual runtime proof](testing/2026-10-11-web-portal/qa-final-runtime-verified-20261014.json) preserves original records and failed-helper history. Source-only guard integration afterward does not change the running build. Use normal recovery/status controls and inspect unresolved operations before retrying. Figma capture freshness/application and full C2/C3 checks remain pending. [Service analysis](service-analysis.md) and [progress](analysis/progress-2026-10-12.md) give the newest state; earlier runtime descriptions below are historical evidence.

For the current October 13 QA runtime, open `http://127.0.0.1:4315` in Google Chrome. Its matching control daemon is 3059; primary 4310/3055 is a separate historical runtime. The portal saves workflows, collects Figma evidence, tracks coding work and requests validation/application. A coding agent connected to the service implements the application. Clicking Start does not launch a background coding model.

The earlier QA deployment on4315/3059 used source6f87/buildcc91, recorded in [its historical receipt](testing/2026-10-11-web-portal/qa-cdd-scoped-replacement-execution-20261013.json). Primary4310/3055 and303d/ff198 QA are also historical baselines. The retained catalog inventory records129 MCP tools and69 CLI feature entries, including four retained source-profile job controls. Eleven direct CLI aliases target ten MCP tools; these counts are not unique capabilities. Catalog schemas and rendered controls do not establish successful execution of every feature. No extra catalog test is repeated solely for this guide update.

The historical6f87 CDD [production capture](testing/2026-10-11-web-portal/cdd-6f87-current-capture-20261013.json) succeeded through the service's retained Chrome connection. Current complete generated-frontend application acceptance remains0/1. Use status from the runtime you actually connect to. Owner permission for native approval handling is granted, but the supported native control backend is unavailable; no current Allow click succeeded. Official MCP live verification is deferred. A server update or historical capture does not complete current generation/application. The owner has excluded the second eCommerce test and collector-comparison test from this completion.

The Korean interface uses these labels. Quoted labels below reproduce the application text:

| Action                                       | Visible label                                      |
| -------------------------------------------- | -------------------------------------------------- |
| Open the persistent guide                    | `사용 가이드`                                      |
| Register an existing workspace               | `작업 공간 등록`, then `등록`                      |
| Fill guided source and requirements settings | `새 작업 설정`, then `초안에 적용`                 |
| Edit existing basic settings                 | `기본 설정·요구사항 편집`                          |
| Review observed unresolved decisions         | `미해결 범위 검토`, then `검토 내용을 초안에 반영` |
| Save, check and start a new run              | `저장`, `검사`, `실행`                             |
| Copy IDs/instructions for a coding agent     | `에이전트 전달 정보`                               |

The advanced section `고급: 현재 웹 연결에서 코딩` is for work that intentionally uses the current web connection's lease. It is not the normal external-agent handoff.

## Prepare the local service

Use the existing running service and portal when they are already available. In a newly prepared installation, build the service using [the setup instructions](../service/README.md), then start these entries in separate terminals from the built `service` directory:

```powershell
node packages/mcp/dist/daemon-entry.mjs
node packages/portal/dist/index.mjs
```

Both processes and the coding agent must use the same Windows owner, exact service-state location and matching control port. Current tested QA uses 4315/3059; do not reuse the historical 3055 worker connection for it or guess a port override from an unrelated state directory. Obtain the operator-supplied current worker configuration and verify its actual runtime identity. Keep the existing daemon running while you connect an agent. Chrome permission applies to the service connection; it is not a portal login. Hosting is currently local and single-owner.

For detailed server troubleshooting, use [the packaged debugging guide](../service/packages/portal/DEBUGGING.md). Enable `SFP_DIAGNOSTICS_LEVEL=debug` before starting the relevant portal and daemon. Their separate state directories contain bounded JSONL diagnostics with request/job IDs, processing times, sanitized errors and source locations. `/api/health` reports logging failures and retention limits. User activity remains visible in the portal; diagnostic files provide additional server evidence and can report incomplete writes under load.

The connection panel separates two facts:

| Displayed state               | What to do                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Local service unavailable     | Start or inspect the local service, then refresh connection status.                         |
| Chrome not requested          | Open the intended Figma file in Chrome; the first source request will ask for a connection. |
| Waiting for Chrome            | Check Chrome's remote-control permission prompt and respond yourself.                       |
| Chrome initializing           | Wait for the current connection attempt and refresh its status.                             |
| Chrome connected              | Continue with source collection. This state alone does not prove a successful capture.      |
| Chrome unavailable or unknown | Check Chrome and the current run's recorded failure before starting another operation.      |

For service-owned Figma Web access, keep the source file open in Google Chrome and enable its remote connection through `chrome://inspect/#remote-debugging` if the service setup requires it. Accept native Chrome prompts manually. Preview validation uses a separate owned Chrome session.

## Register a workspace

1. Create or choose an existing local project folder in File Explorer, for example `C:\FigmaProjects`. The portal does not create this workspace folder.
2. Open workspace registration from the first-run guide or workspace controls. Enter the full local folder path and submit.
3. Wait for the service-confirmed registration. Select the returned workspace in the workflow settings.

Relative paths, web URLs, network shares and device paths are rejected. Registration does not make a folder the global MCP default, rebind a moved folder or inspect arbitrary files for the browser. If a registered folder has moved or changed identity, have the service operator inspect the existing registration instead of repeatedly adding it.

## First CDD workflow without reference frontend code

Create a draft and use these settings:

| Setting            | Example                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Workspace          | Your confirmed `C:\FigmaProjects` registration                                                                     |
| Case               | New frontend without reference, `new-blank` / C4                                                                   |
| Figma source       | Independent Chrome page API                                                                                        |
| Figma URL          | `https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120`                                             |
| Freshness          | Require a live source                                                                                              |
| Output target      | `cdd-demo-01`, an unused relative folder inside the workspace                                                      |
| References         | Empty                                                                                                              |
| Validation profile | Agree its ID with the coding agent before starting; the service must later prepare and register that exact profile |

The output target is separate from the workspace root. Choose a new target if the example already contains work. C4 uses Figma evidence and new implementation code; do not attach an existing frontend as a reference. It supports honest local demo behavior, not an invented production backend or account service.

Keep the five execution stages connected in order: source, requirements, generation, validation and output. Extra branches are editable drafts and are not currently executable. Save the workflow, check the readiness list and start it once. Follow the live execution map and recorded events rather than assuming that a successful button click means generation finished.

## Confirm observed workflow decisions

If a run asks for input after a complete capture, open its observed workflow-decision panel. The CDD design can expose several unclassified interactions; the current reviewed example has eight. Use the rows actually returned by your run, not a copied list from an older run.

For each row, read the source control/evidence, select an appropriate already-confirmed requirement, choose `implement`, `reuse` or `extend`, and write a rationale for the intended behavior. For the no-reference C4 example, a newly implemented local interaction normally uses `implement`. `reuse` and `extend` require real applicable source evidence. There is no general-purpose “ignore this interaction” decision.

Save these explicit choices as a new workflow draft revision, then start a fresh plan. The service checks the current analysis hash, evidence and requirement identities. If the source changed, review the new evidence again. Incomplete capture cannot accept old decisions; solve the recorded capture problem first. Confirming decisions does not itself generate code.

## Prepare compiler evidence for an existing reference

Use this only when an existing-reference plan's source analysis requests compiler evidence. The no-reference C4 example above does not need a fabricated reference. For legacy/reference cases, preserve the relevant complete portal requirements, including observed backend, API, data, authentication and workflow behavior.

1. Register the real reference workspace and inspect the retained plan/run context. Keep its actual service run ID and selected source hash. A source-preparation run must have no submitted candidate or active coding lease; unresolved workflows can remain `needs-input`.
2. Ask the coding agent to use Service Functions `portal.profile.prepare` with `purpose:"source-preparation"`, matching source/package context and exact reviewed native commands. Review the complete returned object and its source, importer, lock/configuration and artifact bindings. Register that exact prepared object with `portal.profile.register`. Preparing or registering a profile does not execute it.
3. In Service Functions, select CLI feature `portal.prepare-source` or MCP tool `portal_prepare_source`. Use an available result workspace and fill the four required fields from the current service context:

| Field | Actual value to use |
| --- | --- |
| `runId` | Original service run ID beginning `sfp_portal1_` |
| `profileId` | ID of the exact registered source-purpose profile |
| `sourceId` | Selected source's `sha256:` identity from the current plan |
| `deadlineAt` | Absolute epoch milliseconds no later than the original run deadline |

4. Review and submit once. Read the retained compiler result and any blocked requirement. Failure or unknown outcome does not automatically retry. Successful evidence belongs to the current owner/workspace/source and daemon generation; a restart or retired authority requires fresh preparation. Create a fresh plan to consume current evidence and inspect its remaining decisions.

The equivalent command is `portal prepare-source <service-run-id> --args-file <bound-source-preparation.json>`. Its argument file contains the same four fields. Use actual returned IDs and the original deadline, not copied example values.

Compiler success alone does not confirm a business workflow or finish source analysis. It does not collect Figma, acquire a coding lease, generate/submit/apply code or pass whole/frontend acceptance. Capture remains a separate admitted operation. A requested native contour recipe also needs a current protected source supplement; profile preparation only looks it up and fails closed when it is missing.

## Hand the run to your coding agent

When the run reaches `awaiting-agent`, give your existing coding agent the workspace, the **service run ID**, the current plan/context and the intended output target. The portal's web run UUID is a UI/history identifier; service tools use the `serviceRunId`, which starts with `sfp_portal1_`.

A practical request to the agent is:

> Continue the existing service run shown in this portal. Use this workspace and serviceRunId, inspect its current status, obtain coding context through the service, implement the CDD frontend without reference frontend code, and submit real candidate files. Preserve its existing budgets and source/blueprint identities. Prepare a native validation profile for review, fix failed checks, and ask me to review any explicit approval before application. Do not create a separate replacement run or claim generation finished before the service records it.

The agent, not the user, handles coding leases, file hashes, asset references and submission JSON. A lease is bound to the authenticated session that acquired it. Let the chosen agent request its own context/lease and submit using the same connection. Do not acquire a web lease and paste it into a different MCP session; inspect an existing lease before changing clients.

### Connect an MCP-capable coding client

Configure a local stdio server with command `node` and the absolute path to this service's built `packages/mcp/dist/index.mjs`. This connects to **Super Figma Pipeline**, not the separate Figma connector. For clients that accept an `mcpServers` object, the equivalent configuration is:

```json
{
  "mcpServers": {
    "super-figma-pipeline": {
      "command": "node",
      "args": ["C:/path/to/service/packages/mcp/dist/index.mjs"]
    }
  }
}
```

Replace the path with the installed built service directory. Run the client under the same Windows owner and with the same `LOCALAPPDATA` configuration as the running daemon. If the operator uses a dedicated state location, ask them to provide the matching connection configuration; do not copy private authentication values into this JSON.

For **this PC's historical October 11 verification runtime only**, the coordinator supplied this nonsecret connection configuration. It uses the existing daemon on port 3055 and portal on port 4310; it does not require restarting either process:

```json
{
  "mcpServers": {
    "super-figma-pipeline": {
      "command": "node",
      "args": [
        "C:/2026_project/super-figma-pipline/.worktrees/baseline/service/packages/mcp/dist/index.mjs"
      ],
      "env": {
        "LOCALAPPDATA": "C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-native-appdata",
        "SFP_STATE_ROOT": "C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline"
      }
    }
  }
}
```

This PC-specific configuration is not a default for a fresh installation. Use the normal installation's owner-state location there. For CLI commands against this verification runtime, use the same two environment values and the CLI entry under `.worktrees/baseline/service/packages/cli/dist/index.mjs`.

MCP selects the sole registered workspace or an explicit service default. With multiple workspaces, the owner can set the intended default using the CLI:

```powershell
node packages/cli/dist/index.mjs workspace list
node packages/cli/dist/index.mjs workspace default <workspace-id>
```

Changing that default affects MCP workspace selection. It is a separate explicit owner action; web registration does not do it automatically. The agent then uses `portal_status`, `portal_next` and `portal_submit` on the existing service run. The service-returned tool schemas are authoritative.

### Use the CLI from an existing coding agent instead

An agent with terminal access can use the same built service under the matching owner/state environment. It should pass the workspace explicitly:

```powershell
node packages/cli/dist/index.mjs portal status <service-run-id> --workspace-id <workspace-id>
node packages/cli/dist/index.mjs portal next <service-run-id> --workspace-id <workspace-id>
node packages/cli/dist/index.mjs portal submit <service-run-id> --workspace-id <workspace-id> --args-file <agent-prepared-candidate.json>
```

The candidate file is prepared by the agent from the current returned lease and evidence. Do not type those fields by hand. If a service approval is requested, review that exact operation through its service/client approval interface. Refresh the portal to see work performed by the agent.

## Read current native geometry for authoring

After the geometry-capable daemon is verified and deployed, the coding agent can request supplemental native geometry through existing MCP tool `portal_next` or CLI feature `portal.next`. In Service Functions, select the same tool/feature, choose the run's actual workspace, include the optional `nativeGeometry` object and review the request. Ordinary Next without this object keeps its existing behavior. `portal_status` does not add this paging option.

Use a genuinely current admitted capture with its signed native supplement. The service looks up protected bytes; it does not open Chrome or export a document during this read. Missing or unproven supplement requires a fresh admitted source capture. A profile, caller path, native export from an earlier run, or copied glyph JSON cannot substitute. Current authorization must include both `design-text` and `design-image` within its original scope/deadline. The read does not grant data permission or renew the original run deadline.

Start with the current service run ID and this optional object:

```json
{
  "runId": "<current-service-run-id>",
  "nativeGeometry": { "section": "resources", "offset": 0, "limit": 64 }
}
```

Replace the placeholder with the actual returned run ID. Read `nativeGeometry.binding.bindingHash`, `nextOffset`, section totals and the surrounding `lease`. Next can claim or renew a coding lease for a ready run; the native portion is lookup-only, not the entire tool. Use the same authenticated agent/session and return its exact `leaseId` on later Next calls while that lease exists. An unresolved `needs-input` run can return evidence without a lease and still requires a fresh confirmed plan before generation.

Follow each returned `nextOffset`, not an assumed step of 64. Supply the first `bindingHash` on every later resources page and on nodes-section entry at offset zero. Continue nodes pages the same way. The limit is at most 64 rows and 256 KiB of encoded UTF-8 JSON per geometry page; a large page can contain fewer rows. A single oversized row fails closed instead of truncating a path or returning a stalled cursor. Stop on binding mismatch, expiry or cancellation, inspect actual status, and obtain new current context rather than combining pages from different bindings.

Resources provide current normalized SVG `d`, source-derived resource IDs, path/commands hashes and font metadata. Nodes provide full characters, dimensions, native layout size, nominal API font size, actual painted sizes, validated paint and every glyph placement, including empty spaces. Resolve each placement's `resourceId` against the complete resource collection. Preserve the returned matrix, source index and paint; do not guess font sizes or replace a native/nominal discrepancy with convenient CSS. The agent must independently verify all page totals, binding fields and references before constructing new code or declarations.

For the public CLI, put only optional Next fields in the argument file because the positional ID supplies `runId`:

```json
{ "nativeGeometry": { "section": "resources", "offset": 0, "limit": 64 } }
```

```powershell
node packages/cli/dist/index.mjs portal next <service-run-id> --workspace-id <workspace-id> --args-file <native-page.json>
```

Add the current `leaseId` and returned continuation `bindingHash`/offset to that file when applicable. Do not duplicate `runId` in it. Through Service Functions or MCP, include `runId` in the JSON object as shown above.

Each page is supplemental, declares `fullCapture:false` and `atomic:false`, and remains bound to the signed owner/workspace/plan/context/capture/document and original run deadline. The ordered checks cannot prove an atomic cross-record snapshot or detect ABA/post-read changes. Public pages support authoring; they do not authorize candidate-supplied expected contours, prove complete acquisition or establish accepted output. The server independently derives validation expectations. The current QA catalog is deployed 303d on 4315/3059; descriptor parity does not establish native geometry execution or acceptance. The older cached-a476/three-journey statements are historical. Current complete CDD journeys remain **0/1**, and official MCP live remains owner-deferred.

## Prepare, validate and apply

1. The agent submits actual files/assets and marks the candidate finished. Candidate-ready is not applied or accepted.
2. The agent prepares a profile containing the real build, test, Chrome preview and cleanup commands for the configured profile ID. Have it use the service profile preparation command:

   ```powershell
   node packages/cli/dist/index.mjs portal profile --args-file <agent-prepared-native-profile.json>
   ```

3. Review the returned prepared file, especially commands, paths, dependencies, environment and expected observations. Only after your explicit confirmation, register that exact returned file:

   ```powershell
   node packages/cli/dist/index.mjs portal profile --args-file <returned-prepared-file> --yes
   ```

4. Request candidate validation with that profile through the portal or have the agent invoke `portal_validate`. Let the agent repair genuine failures and resubmit using the service's next lease. Do not remove failing checks to obtain a pass.
5. When the service reports ready-to-apply, review its explicit application approval and request Apply. Review native Chrome prompts yourself if one appears.
6. Validate the applied target and final live source freshness. A successful build, candidate validation or application alone is not final completion. Trust the recorded completed state and its evidence.

The agent can construct the correct `portal_validate` arguments for candidate versus applied checks and the chosen profile; the user does not need to construct hash or lease JSON. Profile registration does not execute its commands. For detailed operator requirements, see [the native portal workflow](../service/docs/portal-native.md).

## Interpret pauses and failures

| Run state           | Meaning and next step                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awaiting-input`    | Inspect the source/requirements issues. Complete capture or explicit decisions may be missing.                                                                      |
| `awaiting-agent`    | Connect a coding agent and hand it the existing service run. No background model is running.                                                                        |
| `awaiting-approval` | Review the displayed operation and approve or reject it explicitly.                                                                                                 |
| `failed`            | Inspect the recorded error and fix its cause before a new operation.                                                                                                |
| `unknown`           | The prior effect is unresolved. Inspect and resolve that original service operation before continuing; do not replay it or create a replacement to evade the fence. |
| `completed`         | The service recorded completion of the required run gates. Inspect its output and evidence.                                                                         |

For a missing Figma tab or Chrome timeout, check the selected file, native permission prompt and existing run first. For an unavailable folder, check the original registration and real folder. For a missing validation profile, have the agent prepare and register the correct profile after review. Old deadlines and attempt budgets are not reset by refreshing the UI.

## Read activity history

The activity view separates screen intents from authoritative server results and states observed from the service. An intent such as clicking Start is not a successful capture or generated application. Filter by workflow, run, type, source, status or date and inspect the correlated IDs and safe counts.

Meaningful edits and committed graph gestures are recorded; individual keystrokes, mouse movement, code, requirement text, passwords, tokens and leases are not activity payloads. Unchanged polling does not produce repeated progress entries. A result from an external coding agent appears only after the portal actually observes its service state.

History has a visible capacity and is not automatically evicted. At capacity, existing history remains readable and new effects requiring an audit record are blocked. Cancellation and unknown-outcome inspection remain available; a recording failure is shown separately from their real result. If an audit write fails after an effect, inspect existing state before retrying. Do not assume that a missing final log entry means the effect did not occur.

## Official Figma MCP connection and own-service OAuth

Actual official Figma MCP verification is **deferred at the owner's request on October 12**. These instructions describe the own-OAuth-capable build after verified integration/deployment. They do not establish Figma client eligibility, completed authentication or capture. An older running build may report OAuth login unavailable. Chrome collection and normal portal work remain separate.

Choose the official remote endpoint `https://mcp.figma.com/mcp` or the separate Desktop endpoint `http://127.0.0.1:3845/mcp` in connection settings. Remote access supports this service's approved own OAuth client or an externally provisioned **own-service** OAuth token reference. Do not borrow another application's identity, cookies, token or credential store. A personal access token is not a substitute for official MCP authorization.

### Operator prerequisites for own OAuth

First obtain Figma's acceptance of this service's own client, supported secret authentication method and exact approved fixed callback contract. A waitlist, advertised registration endpoint, saved form or declaration is not that acceptance. This service does not perform dynamic registration or use a public-client fallback.

Install the secret-free UTF-8 contract at `<daemon-state-root>/figma-auth/contracts/<reference>.json` using the service's protected state mechanism. Its directory/file must have verified private owner/SYSTEM protection, be a regular single-link file and fit the bounded loader. Do not use linked/permissive files or put client/secret/token values in the record. Required fields are:

| Field                  | Required meaning                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | `1`                                                                                                                   |
| `serviceName`          | `super-figma-pipeline`                                                                                                |
| `eligibility`          | `accepted-own-service-client`, declared only after actual operator-obtained acceptance                                |
| `operatorDeclaration`  | `true`; an operator statement, not server-verified registration                                                       |
| `evidenceReference`    | Nonsecret reference to the accepted contract                                                                          |
| `clientIdDigest`       | `sha256:...` of the exact approved client ID's UTF-8 bytes; no client ID value                                        |
| `authenticationMethod` | Accepted `client_secret_basic` or `client_secret_post`                                                                |
| `redirectUri`          | Exact approved query-free HTTP loopback URI with literal `127.0.0.1` or `[::1]`, fixed nonzero port and non-root path |
| `callbackMode`         | `fixed`; no port scan, fallback or tunnel                                                                             |

The settings reference is the filename stem without `.json`, using at most 64 ASCII letters, digits, underscores or hyphens. The installed record is limited to 16,384 bytes. Its contract digest is `sha256:...` of the **exact installed bytes**, so whitespace changes require a new digest. These digests are references, not credentials or proof of Figma acceptance. Use UTF-8 without a byte-order mark.

Provision accepted client ID/secret values through the approved private credential channel in the **daemon's environment**. The portal accepts only their variable names, such as `OWN_FIGMA_CLIENT_ID` and `OWN_FIGMA_CLIENT_SECRET`, plus contract reference/digest. Saving names does not set environment values. If provisioning requires a restart, first inspect active jobs, unknown outcomes and source sessions through the controlled procedure. Do not blindly restart/replay work or extract another application's tokens.

### Connect through the portal

1. Select remote own-OAuth mode. Enter client-ID/client-secret **environment names** and installed contract reference/digest. Save references once.
2. Read authentication status (`인증 상태 읽기`). Missing contract, wrong digest, missing environment or an occupied approved callback port produces a useful blocked state. A blocked prerequisite does not start discovery, exchange or consent navigation. An unknown-work fence needs separate review; authentication cannot clear it.
3. Once configuration is ready, explicitly choose Start login (`새 로그인 시작`). The service retains the original bounded deadline and provider/configuration/auth-generation binding. A saved declaration alone is not a connected state.
4. Open the separate consent tab (`별도 탭에서 동의 화면 열기`). Keep the original portal tab and existing Figma source session. Its GET only reads status. Choose Continue there, then complete Figma sign-in/consent and any native permission yourself. No service script approves either dialog.
5. Return to the retained portal and read current state. Cancelled, expired or superseded flows cannot be redeemed; changed consent-page query/hash also blocks submission. Do not copy callback URLs/code/state into the portal or CLI, or retry a consumed handoff.
6. Explicitly probe the official server through the same daemon provider. Observed authorization, compatible tool support and complete scoped capture are separate facts. Login or one supplemental read does not establish full design/assets, generation or frontend acceptance.

Read-only polling preserves unsaved references. `operator-contract` labels a declared installed contract. `serverAuthorizationObserved` records a server-auth observation. Neither alone establishes acquisition or data-egress permission. Data grants, workspace fences and original capture/run deadlines remain separate.

### Session cleanup and explicit refresh

Own-OAuth credentials live only in session memory. Cancel (`현재 로그인 취소`) targets the current bound flow. Local logout (`로컬 세션 로그아웃`) retires that service session and its owned handoff/listener/dependent requests. Neither promises remote Figma revocation or rollback of an issued request. Logout does not remove operator environment provisioning or resolve old jobs.

Refresh (`인증 명시적으로 갱신`) is a deliberate bounded action before expiry. Capture does not automatically refresh or reopen consent. After uncertain exchange/refresh, inspect status instead of replaying a consumed code or possibly rotated token. Restart loses session credentials while references can remain. Clearing references does not guarantee zeroization of JavaScript/SDK copies.

### Public CLI and Desktop

Commands are `figma-mcp auth status|configure|start|cancel|logout|refresh`. Use the matching owner/state. Default CLI examples assume control port 3055; use matching portal controls for a separately configured runtime rather than pointing private state at an unrelated default endpoint.

`auth status` prints safe provider/configuration/auth generations. Mutations require their exact current `--provider-instance-id`, `--configuration-generation`, `--auth-generation`. Configure accepts `--client-id-env`, `--client-secret-env`, `--contract-reference`, `--contract-digest` names/references. Start/refresh require original absolute `--deadline-at` epoch milliseconds; cancel/logout accept current `--flow-id`. Re-read status on a binding mismatch instead of incrementing generations yourself.

CLI start emits safe status and relative portal consent-view instructions, never an authorization URL, and opens no browser. Terminal probe/read use the same daemon provider. External-token mode `--oauth-token-env` must match the configured daemon environment **name**; the CLI does not copy its local value. No token extraction, callback copying or generic JSON handoff is supported.

The same six authentication actions can be selected directly in Service Functions. The dedicated Connection Settings panel remains the convenient path for editing references and opening the manual consent page.

| Catalog feature | Generated input |
| --- | --- |
| `figma-mcp.auth.status` | Empty object; read safe current status |
| `figma-mcp.auth.configure` | Current binding and `configuration` references |
| `figma-mcp.auth.start` | Current binding and original absolute `deadlineAt` |
| `figma-mcp.auth.cancel` | Current binding and current `flowId`, or null when applicable |
| `figma-mcp.auth.logout` | Current binding and current `flowId`, or null when applicable |
| `figma-mcp.auth.refresh` | Current binding and original absolute `deadlineAt` |

Read status first. The binding has `providerInstanceId`, `configurationGeneration` and `authGeneration`; copy that exact tuple from current status rather than inventing generations. Configuration has `endpoint`, `mode`, `oauthTokenEnv`, `clientIdEnv`, `clientSecretEnv`, `contractReference` and `contractDigest`. Unused references are null; environment-name fields never contain credential values. If a request is stale, refresh status and review again. Status GET only reads state. Consent continuation remains a separate manual native form following explicit Start, not another JSON feature or a callback URL to paste.

Desktop uses Figma's separately enabled local official MCP server and receives no remote credentials or consent session. Probe/read can remain supplemental; missing fixed-program support prevents complete capture. Use separate new official/Chrome outputs and preserve the no-reference frontend condition. See [authorization findings](analysis/official-mcp-authorization.md) and [the wiring design](plans/2026-10-12-own-official-oauth-portal.md) for limits.


The current catalog also includes four retained preparation controls: `portal.profile.status` requires `preparationId`; `portal.profile.preparations` requires signed `planId` and accepts optional request filters; `portal.profile.result` reads the currently issued prepared result; `portal.profile.cancel` cancels a pending retained producer without replay. CLI paths are `portal profile-status <preparation-id>`, `portal profile-status --args <plan-filter-JSON>`, `portal profile-result <preparation-id>`, and `portal profile-cancel <preparation-id> --yes`. Use the matching owner/state/control connection. Cancellation does not reset deadlines or revoke a completed job by inventing a new outcome. These schemas/catalog controls exist; their presence alone is not successful preparation, registration or compiler execution.

## Use the complete service function catalog

The current source and actual QA catalog expose 129 registered MCP tools and 69 fixed CLI feature entries. The source-derived map has eleven direct aliases targeting ten MCP tools, including both candidate/applied validation modes. These are 198 named entries; logical unique capabilities remain unmeasured. The [source inventory and coverage report](analysis/portal-feature-coverage.md) records exact schemas, alias overlap and actual deployed catalog evidence separately from feature effects. The guided workflow remains the normal starting point; the catalog supports explicit source, diagnostics, administration and recovery tasks.

1. Select a function and read its actual description and prerequisites. Choose a registered available workspace and the required target selector. An authorized paired Figma target is different from the existing Chrome capture connection.
2. Fill the generated argument form and review the request preview. No request is executed while editing or previewing it.
3. Submit once. The portal creates a retained job and shows the original operation ID when the service issues one. Some local administrative functions first require a separate confirmation of the exact pending request. Service-policy approval can still be required afterward.
4. Read the actual job output and its error or workflow state. A successful function call can return an incomplete capture or an awaiting-agent workflow; it is not automatic completion of the application.
5. If the job becomes unknown, use Inspect to query the original authenticated journal. Do not submit a replacement. Composite administrative operations can require their specific service recovery procedure because a single child record cannot prove the whole operation's outcome.

Cancel requests stop the current job's signal without inventing a successful rollback. The original deadline remains in force through confirmation and continuation. Read-only diagnostics and explicit recovery actions remain available when an earlier mutation is uncertain.

For a registered MCP tool or its CLI alias, select an available workspace in the request's Workspace field so the service can retain its result evidence. This also applies to a local `doctor` call in the catalog. `CAPTURE_WORKSPACE_REQUIRED` means that result-capture workspace was omitted. Global CLI administration such as listing domains does not require that selection. To remove or reconnect an unavailable registration, select its ID in the function arguments and leave the separate request workspace field unset.

String fields support multiple lines, including Figma text and SVG input. Ordinary text editing uses the browser's LF line breaks. If exact CRLF, CR or other escaped characters matter, open the field's advanced exact-string section, enable JSON-string input and enter a JSON string such as `"First line\r\nSecond line"`. Review the resulting request before submitting. Invalid JSON does not silently fall back to another value.

Activity filter edits remain a draft until Apply. An asynchronous list refresh preserves those unsent values and the current text selection; refreshing the list does not implicitly apply a new filter.

For a large array or composite argument, use the form's full-input JSON section. The ordinary editor limits rendered controls to keep the page usable; full JSON retains complete schema validation without that rendering limit. JSON parsing and the final complete serialized request are bounded to twelve MiB of UTF-8 bytes, matching the server request limit. Oversized input produces an explicit error rather than being truncated.

Job metadata persists, while argument previews and actual result bodies are kept only in bounded process memory. After a restart, the portal can show the original ID, state and output hash/size, but a raw output may be unavailable. This does not trigger a replay. Activity history records safe function/job identifiers and observed outcomes without copying arguments, code, lease values, pairing codes or output bodies.
