# First-run workspace registration and service readiness

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the practical user guide](../../portal-user-guide.md), [the integration record](README.md), [the backend record](backend.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns the served runtime, integration, independent review and three real UI/service tests. This worker owns the five backend files listed below and the two English documents. The frontend worker owns web assets and their tests.

## Baseline and scope

The coordinator copied the exact portal source from the verified `935216d1aadd504a3e3e1757fde2f7c5056329cdb76220730a64a2522aa184dd` main/native baseline into `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service` at 20:00:59 KST. Implementation used that managed copy so the served native portal and retained Chrome connection were not changed. Published main remains `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus authorized changes. The `9352...` whole pass predates this increment.

The existing portal could list registered workspaces but could not register a first workspace through its UI. Bootstrap exposed daemon health without the existing public Chrome connection state. Generic service errors were safe but insufficiently actionable for the Korean interface. The new guide also needed to explain the real coding-agent handoff rather than imply an automatic background model.

## Closed API and existing authority

The added route is `POST /api/workspaces`, with strict body `{ "folder": "C:/existing/local/folder" }` and response HTTP 201 `{ "workspace": { "workspaceId": "...", "realPath": "...", "availability": "available" } }`. Optional `unavailableReason` remains part of the existing workspace response contract. It uses the same exact Host, same-origin/Fetch Metadata, JSON body and CSRF guards as other mutations. Relative paths, URLs, network/device paths, control characters and unknown fields are rejected before registration.

The backend calls the existing public `ControlClient.workspace(folder)` method. That method resolves the real path, reuses a valid existing registration, obtains the authenticated `workspace.add` action nonce and uses the service's retained directory-identity checks. The adapter then rereads the registered workspace list and requires the returned ID to be present. A missing confirmation or unavailable/changed folder cannot be reported as successful registration.

The portal does not create directories, set the MCP default, rebind roots, expose filesystem browsing/reads, accept arbitrary tool names or forward arbitrary control URLs. Workspace registration remains an explicit action under the current local owner's existing service authority. Private credentials and nonces are kept in the public client/backend implementation and are not returned to the browser.

## Readiness and safe messages

Bootstrap and health retain `service.available` and `service.message` and add:

```json
{
  "readiness": {
    "statusAvailable": true,
    "browserConnection": "awaiting-browser",
    "browserMessage": "A fixed localized explanation is returned here.",
    "workspaceRegistrationAvailable": true
  }
}
```

`browserConnection` is one of `not-requested`, `awaiting-browser`, `initializing`, `connected`, `unavailable` or the portal's explicit `unknown` fallback. The service adapter reads `/control/status` through the authenticated public `ControlClient` and validates the service status schema. The bridge publishes only the connection state and a fixed Korean explanation; leader identity, plugin metadata, credentials and arbitrary status fields are not passed through. A missing/failed/malformed status read remains unknown even when health succeeds. Offline health does not issue an authenticated status read.

`connected` means that the Chrome connection exists, not that a particular file was captured or accepted. Messages describe manual native approval and inspecting the current run; they do not automate native prompts or take over a source session. Workspace registration availability means that a healthy service connection exposes the registration method, not that an arbitrary folder is already authorized.

Known registration, connection, input, revision, approval and uncertain-outcome errors now receive fixed actionable Korean messages while retaining stable error codes. Untrusted service exception text is not shown. Existing HTTP status and structured input issues remain for portal errors; missing folders return a bounded client-input error. No lease, source-completeness, original-operation-proof, unknown-outcome or approval fence was weakened.

## Coding-agent and guide contract

The guide provides local startup/connection steps, workspace registration, the CDD file/node URL, a new C4 relative target without reference frontend code, review of observed workflow decisions, and candidate/profile/validation/application stages. It separates normal installation configuration from the coordinator-supplied nonsecret configuration for this PC's verification runtime.

The service's MCP and control paths share the local owner's actor identity, while coding leases bind the authenticated session that acquired them. The guide therefore instructs the chosen coding agent to obtain its own `portal_next` lease and submit through the same connection. The user supplies the service run ID and intent, not handcrafted lease/hash JSON. Multiple registered roots require an explicit MCP workspace default or CLI `--workspace-id`. Profile preparation and exact prepared-file registration remain explicit reviewed actions.

The source status supplied by the coordinator at 20:06 reported a complete/live CDD preparation through the existing retained daemon. This worker did not operate that connection. It does not count as one of the requested three real UI/service tests. Official MCP authorization and full Figma-to-frontend acceptance remain separate prerequisites/results.

## Executed validation

At **20:05:22 KST**, seven new tests failed against the prior implementation: five connection states lacked readiness output, status-read failure lacked an explicit unknown state, and the workspace POST route did not exist. After implementation, those seven passed at **20:07:12 KST**. Two further controls cover unavailable registration/disconnected health and a changed workspace identity.

The final backend run at **20:09:51 KST** passed **56/56 cases**, zero failures and zero skips. This includes all prior 47 lifecycle, original-operation-proof, concurrency, graph and HTTP-boundary cases. The nine new cases verify real bridge/HTTP behavior using controlled public-service boundaries, including CSRF/origin rejection, strict local-path/body checks, confirmed registration, safe missing-folder messages, all five observed Chrome states, failed status reads, no private status leakage and unavailable registration.

Portal TypeScript, scoped lint and formatting passed for all five final files. Intermediate static checks found a control-character-regex rule and a missing mock type parameter; they were repaired without changing the requested behavior, and the complete backend suite was rerun. No failed check was counted as a pass.

```text
# Managed service/packages/portal:
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache test/backend.test.ts

# Managed service:
node node_modules/typescript/lib/tsc.js --noEmit -p packages/portal/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/src/contract.ts packages/portal/src/control.ts packages/portal/src/server.ts packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
node node_modules/oxfmt/bin/oxfmt --check packages/portal/src/contract.ts packages/portal/src/control.ts packages/portal/src/server.ts packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
```

The adapter's use of public workspace/status methods was inspected against service source. This worker's tests inject the control boundary; they do not claim to execute authenticated workspace registration against the owner's live daemon. The coordinator owns that proof through the three real UI/service tests. No build/install, source Chrome access, daemon/portal restart, Superpowers use, main/native service edit, commit or index/provenance change was performed. The managed copy uses the current Windows owner account and is not an OS sandbox.

## Verified frozen backend paths

Frozen at **20:10:29 KST**, after the final suite and static checks. Paths are relative to managed `service`. Slice SHA-256 is `d6b962e1b33b33cabab2b423d5521be268806ec65af15283e6b7dd4220aa1a5b`, computed from JSON of the ordered `{path,sha256}` records below without hash prefixes.

| Path | SHA-256 |
| --- | --- |
| `packages/portal/src/contract.ts` | `996454dff3bc6d66c4afd154ab9944408bcdaef0bab9b2da18dd4dc5f1075b14` |
| `packages/portal/src/control.ts` | `b5a91ebce470fba988df4a0a0844156e8c2e758e6c206ebee6e765ab680933d5` |
| `packages/portal/src/server.ts` | `2e632edad892080be49c24105b92918ee0648a3c4ce371b2d0e02cf2c63fa01b` |
| `packages/portal/src/bridge.ts` | `dadb5b712f80ebc00d0589f693de86d4cec07f9627249a81fdb56a653d859dd5` |
| `packages/portal/test/backend.test.ts` | `67cf2b888d8c089ebe47bf8c287ecc31ab6b7e87ca2fd7715519e3dca83e8605` |

Frontend integration, independent review, actual UI/service runs and renewed source/package checks remain coordinator-owned gates. No new product decision is required for this bounded first-run support.
