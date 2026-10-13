# Official Figma MCP connection settings

Date: October 11, 2026, Asia/Seoul. Authoring checkout: managed `4d3e`, Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus the coordinator's integrated source and concurrent owned changes. The native production baseline was `935216d1...` before these additions. This report covers the seven frozen settings files below, not the whole concurrent working tree. Follow the [repository instructions](../../../AGENTS.md), [canonical service analysis](../../service-analysis.md), and [earlier official OAuth setup evidence](../2026-10-10-continuation/official-oauth-setup.md).

## Implemented behavior

The connection page persists a preferred official endpoint and an optional OAuth environment-variable **name**, never an OAuth token. Only `https://mcp.figma.com/mcp` and `http://127.0.0.1:3845/mcp` are accepted. Desktop settings reject a remote OAuth reference. Strict request and disk schemas reject credential fields, arbitrary URLs and unrecognized fields. The fixed settings file uses bounded reads, rejects links/non-files, and publishes revision-checked updates by atomic replacement. An in-flight probe cannot publish its result over a newer saved configuration.

The daemon constructs one connection provider used by both actual generation and the explicit metadata/tool probe. The new authenticated control routes are `GET /control/figma-mcp/status` and `POST /control/figma-mcp/probe`. The latter accepts only the official endpoint, uses the request cancellation signal, a 20-second bound and a single-flight guard. Desktop probes do not receive the remote OAuth callback. Error results expose a closed sanitized code, never SDK messages or raw response bodies.

Status reports the effective startup environment reference, credential presence, and a random provider-instance identity. Invalid or token-shaped references are masked. A malformed optional MCP reference does not stop unrelated Chrome service startup. Saving a different desired OAuth reference does not mutate the process environment: the page reports the operator restart requirement until the actual daemon provider matches. A restarted provider invalidates earlier probe readiness even when its environment name is unchanged. Existing connected Chrome work must finish before the coordinator restarts the daemon.

The portal manager fills a missing `plan.design.officialEndpoint` from the persisted preference when saving an official-MCP workflow; it preserves explicit endpoints and Chrome workflows. A test runs this bound workflow through the actual `PortalStore` and `PortalBridge` and observes the selected endpoint in `portal_plan`. The frontend also offers an explicit apply-to-draft action. Applying the preference does not save or start a run. The backend owner must integrate `bindWorkflow` in workflow create/update handlers and the closed settings routes; the frontend owner supplies the persistent navigation and API adapter. Those other owners' hook files are not part of this seven-file freeze.

The page distinguishes effective authentication, tool discovery, capture-attempt readiness and actual full capture. A successful probe always retains `fullCapture:false`; it does not read a Figma file or establish generation acceptance. No OAuth login or client-registration flow has been invented. Official remote installation currently requires OAuth and a supported registered client; obtaining service-authorized credentials remains a separate unresolved prerequisite. See the [official remote setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), [Desktop setup](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/) and [access limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/). These references were research, not executed connection acceptance.

## Frozen source

Paths are relative to `service/`. SHA-256 values were read after final formatting on October 11 at approximately 21:16 KST.

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/control/figma-settings-endpoint.ts` | `6e4ceee5f7d9d3f1682c0c942b17e84e1f885b5dbafadf1572f3ba47cb693f84` |
| `packages/mcp/test/control/figma-settings-endpoint.test.ts` | `7cae1e7b154e1c8835f3ce1ce0ff3511563fd42ca4c0abec512c175c9956ac9e` |
| `packages/mcp/src/control/route-registry.ts` | `70bb9c397613e12eba7deea9a75d22921601390323684ee3699af0242fdfbfc1` |
| `packages/mcp/src/index.ts` | `e4f6da78b480879d381e029e2535129513829756ef161f6e8e9e36cb792ba4c3` |
| `packages/portal/src/figma-settings.ts` | `fccb985cc079ccf78e332fca04c1673a1cfb681778d91720f642e3f44f235b02` |
| `packages/portal/test/figma-settings.test.ts` | `57cfb1430dc88c19d57888a9496c03ee282fe4b8192c5e9fcdc57e749299c883` |
| `packages/portal/web/figma-settings.js` | `48bd48f409b3911433225f448115b6f9d78c5c55f3065e41e3f58ec23b3195ef` |

The module contract is `PortalFigmaSettings.open(directory, control)` followed by `get()`, `save({revision, endpoint, oauthTokenEnv})`, `probe({revision})`, and `bindWorkflow(input)`. The control adapter provides `figmaMcpStatus()` and `figmaMcpProbe(endpoint)`. The web export is `mountFigmaSettings(container, {api, onActivity, onError, onApplyToDraft})`, returning a cleanup function. `connectionSettingsProbe` receives the revision number; the adapter wraps it in the strict HTTP object. The apply callback receives the endpoint string.

## Executed verification

- Core settings endpoint plus existing control-router suite: **99/99 passed**, two files, no skips, final run at 21:16:38 KST after final formatting. It covers authenticated route boundaries, strict endpoints, shared-provider identity, token non-disclosure, malformed configuration, Desktop credential separation, sanitized errors, cancellation and concurrent probes.
- Portal settings, backend and frontend model/API suites: **94/94 passed**, four files, no skips, at 21:11:39 KST. This includes ten settings cases and all 65 then-frozen backend cases. The settings cases cover persistence/CAS, strict rejected inputs, actual bridge plan binding, configuration/provider changes, old-daemon behavior and stale probe publication.
- Both MCP and portal TypeScript checks passed. Scoped `oxlint --deny-warnings` and `oxfmt --check` passed for all seven settings paths and the separate live runner. Initial authoring type/lint issues were repaired. An incorrect attempt to invoke nonexistent Prettier/ESLint binaries failed without modifying dependencies; the repository's installed oxfmt/oxlint binaries supplied the final checks.

The managed dependency junction otherwise mixes native and managed shared-module identities. The core test run therefore used the private `.cache/figma-settings-mcp-vitest.mjs` configuration to alias `@sfp/shared` to the managed source. This changes only validation resolution; no dependency installation or shared-schema edit occurred.

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/figma-settings-mcp-vitest.mjs --configLoader native --no-cache --maxWorkers 1 packages/mcp/test/control/figma-settings-endpoint.test.ts packages/mcp/test/control/control-router.test.ts
node node_modules/vitest/vitest.mjs run --project portal packages/portal/test/figma-settings.test.ts packages/portal/test/backend.test.ts packages/portal/web/tests/model.test.mjs packages/portal/web/tests/api.test.mjs --no-cache
node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/portal/tsconfig.json
```

## Actual limits and continuation

No actual Figma server probe, OAuth exchange, source Chrome operation, production-daemon restart or generation was performed by this author. Tests injected bounded probe results and private control fixtures. No borrowed connector credential or PAT was used. The seven files need the other owners' route/API/navigation hooks, coordinator integration, source-bound static/build checks and owned UI validation. The old running daemon truthfully remains unsupported until the coordinator restarts the updated service. The three real Chrome usage rounds remain separately tracked in [usage-live-tests.md](usage-live-tests.md).

The configuration file contains public preferences and sanitized probe facts; atomic replacement is not a claim of power-loss durability or an OS security boundary. Multiple independent portal processes sharing one settings directory are not coordinated by an interprocess lock. Deployment remains the single local portal process already assumed by the service store. Browser readiness remains advisory and does not replace source-capture evidence. Native OAuth client eligibility and a real successful official full capture remain open product/acceptance work.

## 21:22 addition: all five official read functions

The coordinator requested coverage of the CLI's existing `figma-mcp.read` capability after the preceding freeze. The authenticated daemon route `POST /control/figma-mcp/read` now accepts only `{endpoint, target:{fileKey,nodeId}, tool}`. The tool is one of `get_design_context`, `get_metadata`, `get_variable_defs`, `get_screenshot`, or `get_code_connect_map`; arbitrary code, tool names and credential fields are refused before dispatch. It invokes the existing official reader using the same generation provider, a 20-second absolute bound, cancellation and capacity shared with probes. Desktop requests receive no remote OAuth callback.

The actual read response preserves the existing `request-only` or `desktop-active-file-unverified` identity classification and `fullCapture:false`. Output binding must match the requested endpoint, file, node and tool. The preview is limited to two MiB, and exact effective-credential echo is rejected. Errors expose a fixed safe message and allowlisted code. The portal manager's `read({revision,target,tool})` chooses the saved endpoint, rejects changed settings before publishing, and never writes file content to settings or activities. Route/API/catalog integration must keep raw read output out of durable activity metadata. The manager exports `FigmaSettingsReadInputSchema`; the control adapter adds `figmaMcpRead({endpoint,target,tool})`.

Final read-addition checks at **21:20:55 KST**: core settings plus router **113/113 passed**; portal manager **16/16 passed**, all without skips. The additions include malformed requests, same-provider use, Desktop separation, unbound/oversized/private response rejection, cancellation, capacity release, authenticated routing, persisted-endpoint selection, unchanged disk content and stale-settings refusal. MCP and portal TypeScript, scoped lint, and formatting passed. No external read or probe was executed.

These hashes supersede the matching paths in the earlier freeze; the MCP index and web module hashes are unchanged:

| Path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/control/figma-settings-endpoint.ts` | `77a63cbd660b23b68a0a6dcbc6efe2f264548578caa7258d397cd982fa3e0015` |
| `packages/mcp/test/control/figma-settings-endpoint.test.ts` | `ddc4f874dd8f90c75183972a580233270270a8254977d11619c6073f8fecc060` |
| `packages/mcp/src/control/route-registry.ts` | `724cf1fb3fe36076abf8346ffe157a720978e1a8137b27f642cc807483fde26e` |
| `packages/portal/src/figma-settings.ts` | `bb9d1522cd1a30fc14c363e6bd4b14be3ee48e1d49dfa0902f81be86e9a07f44` |
| `packages/portal/test/figma-settings.test.ts` | `ce0c3e01921bd2edac0b565c7ae35147dbfa392430dad6345d14cd745eec98bb` |

## 21:42 compatibility correction and final settings freeze

The coordinator correctly identified that the initial FIGMA/OAUTH naming convention unnecessarily narrowed the existing operator-selected environment-reference capability. There was no browser-controlled environment lookup: the browser only saves a preference, while the daemon's existing startup selector determines its provider. The final implementation therefore preserves the existing valid identifier syntax, including names such as `MY_FIGMA_TOKEN`, and removes the invented prefix/uppercase convention from status, desired configuration and Korean guidance. Invalid syntax still fails safely without blocking unrelated Chrome startup. Token fields remain rejected, actual environment values never enter status/settings, and saving a preference still cannot mutate the running daemon's environment. This supersedes the earlier heuristic-name masking/rejection description.

New regressions verify both a valid operator-selected identifier and the distinction between saved preference and effective daemon configuration. Final checks at 21:42 KST: **114/114** core settings/router tests and **107/107** portal job/control/backend/settings tests, plus both TypeScript checks, scoped lint and formatting. The seven-file freeze uses the unchanged registry `724cf1fb...` and index `e4f6da78...`, with these five final replacements:

| Path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/control/figma-settings-endpoint.ts` | `747c31c5317e8cb920eb09cec20d833bce72b2fa44663680d75a06b401fa32c4` |
| `packages/mcp/test/control/figma-settings-endpoint.test.ts` | `6b5457835df60189b17ef89bc00589f5b800bd8cdbe564d6fe22383872288757` |
| `packages/portal/src/figma-settings.ts` | `0e2a4f9612dfdefbdbe7dc615f239f96476de9bab1f2cbb7d57c5d82b628ac90` |
| `packages/portal/test/figma-settings.test.ts` | `ea286946b74e1419298a8321a9410169f754a553f760f6e6daa61c8ca49c2ff3` |
| `packages/portal/web/figma-settings.js` | `6dbce11c8e74d6f083bc0bcf62ae4d6de895901fd2d3baa5a567a0e1b18b5643` |

No live official probe/read, credential exchange or daemon restart was performed by this author. The backend owner has now wired closed settings routes and workflow endpoint binding; controlled HTTP tests are included in the 107-case check. Actual production UI/probe behavior remains coordinator-owned.

## 22:09 native test registration repair

Whole-check attempt `289d68fa...` at source `4602f3d8...` stopped before checks with `TEST_SCOPE_DECLARATION_FAILED`. The actual native registration collector confirmed duplicate names in three parameterized groups: six MCP invalid-read cases shared one name, while four portal invalid-read cases and five portal invalid-settings cases each shared their group's name. Earlier scoped test passes did not detect this registration identity defect. The failed whole-check artifact remains preserved and is not relabeled as passing.

Only the two owned test files were changed in managed `4d3e` and mirrored to the native baseline. Each affected `it.each` name now includes Vitest's `%#` case index. Assertions, inputs, production code and the registration/scope checker are unchanged. Formatting of the affected calls follows the existing formatter.

The **actual native** `scripts/collect-test-registrations.mjs --file <path>` now reports:

| File | Registered cases | Unique names | Duplicate groups |
| --- | --- | --- | --- |
| `packages/mcp/test/control/figma-settings-endpoint.test.ts` | 26 | 26 | 0 |
| `packages/portal/test/figma-settings.test.ts` | 17 | 17 | 0 |

The two native suites passed **43/43**, no skips, at **22:08:49 KST**. Scoped native lint and formatting passed. Before/after collection evidence is retained under native `service/.cache/figma-{mcp,portal}-registration-{before,after}.json`; the execution receipt is `.cache/figma-settings-unique-names-tests.json`. The coordinator owns main-source/provenance resynchronization and the fresh whole check.

The final test-file SHA-256 values supersede their earlier entries:

- MCP test: `7e6ee58b12dd832781c0c52eecbbc7d18c8726933b22d6f620be95c2fc770666`
- Portal test: `155589ddcad8ffc74eeec81e4f7aee64dd45fc56f17918dfc6bfc85fb90b0101`

No browser, external MCP request, daemon action or dependency change occurred during this repair.
