# Independent OAuth UI, public CLI and approval review

Date: October 12, 2026 (Asia/Seoul). Reviewer: independent SOL delegate.

Read-before references: [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [the implementation plan](../../plans/2026-10-12-own-official-oauth-portal.md), [authorization analysis](../../analysis/official-mcp-authorization.md), [the UI/CLI implementation report](own-official-oauth-ui-cli.md), [daemon review](own-official-oauth-daemon-review.md), and [relay report](own-official-oauth-portal-relay.md). Only this report and ignored private fixtures are reviewer-owned. The root owns source integration, runtime/state, source Chrome and release gates.

## Baseline and purpose

Main/native baseline is `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. The initial sixteen-file managed manifest SHA-256 is `a953396a573d83a04b0cbd7fe6e3e873181a06a7cfbe02329e0827273b174c82`, at `service/.cache/official-oauth-ui-cli/frozen-files.json`. All sixteen after hashes and nine existing native before hashes matched before execution; seven new paths were absent from native. The pure schema dependency matched its separate daemon-owned frozen hash. Old a476 whole/runtime evidence excludes this increment.

The candidate presents safe public OAuth configuration/status and explicit actions, manual native consent continuation, same-provider public CLI status/probe/read and six catalogued auth commands. It stores only environment names and installed contract references, preserves local drafts/readiness bindings, and repairs approval controls so an unchanged poll does not replace a trusted pointer target. Missing own-client facts remain blocked prerequisites. No automatic consent, refresh, browser opening, grant renewal or unknown replay is implemented.

## Preserved revision 1 findings, resolved in revision 2

**Validation blocker, reproduced: denied proxy socket reset escapes fixture lifecycle handling.** The first independent full cohort passed all forty assertions and all seven files, but exited one due to an unhandled `read ECONNRESET` from a TCP stream. Vitest attributed the latest execution to the busy approval Chrome test. Its owned denial proxy ends detached CONNECT sockets without an error listener; the author confirmed that lifecycle gap and root authorized a narrow two-test repair. This first run is failed verification despite its forty passing assertions. The deny-only forwarding policy and network assertions must remain unchanged.

**P2, reproduced: late consent URL query/hash bypasses canonical-document guard.** Initial consent load checks `location.search/location.hash`, but manual submit does not recheck them. Two installed-Chrome probes load the clean document, then use same-origin history replacement to add a query or fragment and perform a trusted Continue click. Each still invokes the native submit seam once. The expected result is no dispatch with cleared/disabled form. The prototype submit seam is intercepted only in these private probes to record intent without redeeming a handoff or contacting Figma. This confirms a submitted-document guard gap; it does not assert actual secret exposure or a bypass of daemon state/CSRF/generation validation. The author was asked to recheck the URL at submit entry and immediately before native submission after its awaited status read.

Positive independent Chrome cases already passed: a replacement configuration generation under the same flow refuses native handoff; a replacement daemon provider disables auth actions while retaining an unsaved environment-name draft. The full cohort also covers stale cancelled status, explicit cleanup/refresh generations, safe closed errors and unchanged approval-pointer/busy-state behavior.

**P2, reproduced: actual retained-fence codes become a generic connection failure.** The approved relay uses `RUN_OUTCOME_UNKNOWN` and `SERVICE_JOB_OUTCOME_UNKNOWN`. The UI's `safeAuthError` recognizes only the older `SERVICE_UNKNOWN_MUTATION_FENCE`; both real codes become `FIGMA_AUTH_REQUEST_FAILED`, so the useful instruction to inspect the original unknown is lost. Two direct runtime probes of the copied pure module reproduce that projection mismatch. The proposed repair adds exactly the two known closed codes and a fixed explanation, preserving unknown jobs and discarding every raw transport message. No admission or fence authority change is requested.

## Executed evidence and isolation

The independent regular source copy is native ignored `.worktrees/_cache/oauth-ui-cli-independent-20261012/service`. It was copied from native baseline without dependency/generated/cache links, then overlaid with exactly sixteen owned files plus the pure shared contract. Native installed dependencies are resolved through a private resolver/cache. No install, package build, dependency junction mutation or shared source mutation occurred.

First full output: `focused-independent-r1.json`, forty passing assertions, zero skipped, one unhandled error and process exit one. First independent boundaries: `boundary-r1.json`, two passing and two failing cases, process exit one. Both are preserved, separate from every author output. Browser fixtures start an owned denial proxy before installed Google Chrome launches; only the exact nominated loopback origin can be forwarded, every CONNECT and other destination is refused, and browser routing adds a second check. This is application proxy isolation, not an OS network sandbox. No source Chrome, live portal/daemon, real credential, contract, grant, fence or capture was operated.

The full initial receipt SHA-256 is `5815607480d0e0174ac17abfbe01e12621c4f563da80aa108aed6e4a622bdfc8`. Browser boundaries receipt SHA-256 is `1e5bacbf90f286b92634dcd9fc51891c767f2748d8254835e78362974653e1e1`. Additional `error-boundary-r1.json` preserves two failing known-fence projection probes. These failed outputs remain excluded from passing verification.

Expanded `boundary-r1-expanded.json` adds held-status races: query and fragment changes while Continue awaits its latest safe status also each invoke native submit once. It records two passing and four failing installed-Chrome cases against unchanged original private source. This proves both entry and post-await checks are needed. No new handoff is actually redeemed by these intercepted-submit probes. Root subsequently approved all three narrow repairs; the author preserves the initial source/manifest and prepares a revised full freeze.

The new browser cases retain the author's genuine owned proxy/helper rather than replacing browser requests with another tool. Synthetic metadata/configuration and the intercepted submit counter are independent fixture facts only. The CLI cases exercise the same ControlClient route boundary rather than resolving CLI process environment values. Existing SDK/provider acceptance remains separately reviewed daemon evidence.

## Commands and current limits

From native service cwd:

`node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-ui-cli-independent-20261012/review.config.mjs --outputFile.json=C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-ui-cli-independent-20261012/focused-independent-next.json`

`node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-ui-cli-independent-20261012/independent.config.mjs --outputFile.json=C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-ui-cli-independent-20261012/boundary-next.json`

The private config selects the exact cohort without duplicate include patterns and writes unique receipt paths. After the author provides a revised full SHA manifest, copy only its changed regular files into the private fixture, rerun the full cohort and meaningful boundaries, and rehash every sixteen-file source before approval. No source approval was issued for the initial overall manifest. The revised exact source approval and green independent execution appear below.

Actual packaged static resources, required Chrome census, catalog/provenance reconciliation, combined daemon/relay/UI operation, fresh source-bound whole/artifact gates, accepted own-client facts, manual consent and authenticated full capture remain root-owned gates. No fixture establishes Figma client eligibility, token/grant lifetime, remote revocation or CDD/eCommerce frontend acceptance.

## Immediate bounded approval subset decision

Root requested an immediate separate decision on the approval subset while overall OAuth findings remain pending. Its exact original manifest is `service/.cache/official-oauth-ui-cli/approval-frozen-files.json`, SHA-256 `1c35eed7d0214471904e9a4620964bbb86c8ca2590a2383346b5928747f68630`:

| Path | Exact original SHA-256 |
| --- | --- |
| `packages/portal/web/service-functions.js` | `36c0d05f81dcc63db109eaff6a6bc0239e797d85624f90dce95cf91a503c0e19` |
| `packages/portal/web/tests/service-job-approval-pointer.test.mjs` | `b0782473ff5dc5b5b3280e3ff05bc3e1ddecf531bd47aeca76e5cd60d59b8fc9` |
| `packages/portal/web/tests/local-capture-progress.test.mjs` | `dea8ed68928a2c88bea448e5ee83bb942abed46f6bb98ccaf2090ea7492805fe` |

Functional source approval is given for this bounded subset: source review and the independent three installed-Chrome assertions confirm preserved unchanged trusted pointer targets, visibly disabled approval during busy requests, and retained focus/disclosures/drafts. The separate consent URL and error-label findings do not affect it. This does not convert the overall R1 process exit into a passing validation result. The denied-socket teardown fix changes a test hash; root must bind and independently rerun that repaired subset before claiming green verification. The root exclusively owns any static live overlay or fresh grant operation.

The owner explicitly deferred official Figma MCP live verification while non-MCP/portal work continues. This is a scoped acceptance deferral, not evidence of client eligibility or completed official authentication. The remaining overall sixteen-file source repair and review continue without requiring a real login.

## Revision 2 final independent source approval

Approve exact revised sixteen-file manifest `a07566ba819eca4f4e8cbfca5fd2d45b4382c26fc619a3ed8f90d493064d1cfe` for root integration. All sixteen managed and independent regular fixture files, plus the pure shared schema, matched exact hashes before and after execution. Twelve files remain byte-identical to revision 1. The only changes are public helper `37c224301b981a75ea0eb59755142199372de6bf5ec9b8b5671bb365631056f9`, consent JS `cfa0bd18655247a3dcaff6520b250bfd329484d857be7b94a077428416d01b0c`, OAuth test `29ed09255609f04e0dc09d8412a009a17f65d099bd37caa06429bac6020c9379`, and approval test `dff63cabdb36c6f1f14388d29e513801ce11c5cad45d380312767a9260c01dac`. No remaining reviewer blocker was found.

The two denial proxies now attach owned socket/HTTP stream lifecycle handlers, allow only expected ECONNRESET/EPIPE teardown events, track unexpected events under fixed tags and assert their absence at cleanup. The exact nominated-origin forwarding restriction and complete CONNECT denial remain unchanged. The consent form checks query/hash before its status read and again immediately before native submission after the awaited read. The pure helper reads an error code once, preserves the two actual closed retained-fence codes, and produces a fixed review explanation without using the transport message.

Independent final verification: **46/46 existing revised cases plus 8/8 separate boundaries, zero skipped/unhandled errors, every process exited zero**. The forty initial assertions are still historical failed-process evidence; they were not retroactively promoted. Revised source was recopied only after the author announced its exact freeze. The separate six Chrome cases cover query/hash changes at entry and during held Continue status, same-flow configuration-generation replacement and a different daemon provider while retaining a reference draft. Two pure cases verify actual retained-fence codes with hostile message canaries. Every previously failing assertion now passes.

The full revised cohort includes thirteen installed-Chrome registrations and thirty-three nonbrowser assertions. Of those nonbrowser assertions, two new error-projection cases are in the OAuth-named test file; they are not browser acceptance. The private additional cohort adds six installed-Chrome and two pure cases. Scoped independent no-emit checking returned zero errors; scoped sixteen-file denied-warning lint and formatting checks passed. These are bounded source checks, not the combined whole/build/runtime gate.

| Distinct independent receipt | SHA-256 | Passed |
| --- | --- | --- |
| `focused-independent-r2.json` | `e175c02d9695fdd94c6bd48f081d47a043555c1e4d678796eec1c9457ad721c7` | 46 |
| `boundary-r2.json` | `250eef155e03c4ef2e0e9303881a0c5e83000deab889195f4ce3a8a8b2f265ea` | 6 |
| `error-boundary-r2.json` | `ec242bb4fd11ea6852423bbd1cc8c39c4dab8d8d06dd6530258cb4de396c3300` | 2 |

The original full failure receipt, initial and expanded browser failures, pure error failures, original sixteen source files and original manifest remain in the private evidence tree. The author separately preserves its original source/receipts. None of these failed runs was overwritten.

The repaired approval subset manifest is `service/.cache/official-oauth-ui-cli/approval-frozen-files-v2.json`, SHA-256 `2c12962ae86bd78a367db5ea89d8961d5fa3110833d13694e428666dc042aefb`. Its production `service-functions.js` remains `36c0d05f81dcc63db109eaff6a6bc0239e797d85624f90dce95cf91a503c0e19`, retained progress test remains `dea8ed68928a2c88bea448e5ee83bb942abed46f6bb98ccaf2090ea7492805fe`, and only the approval test has the revised lifecycle hash above. All three actual Chrome cases independently pass with the repaired fixtures, now with clean process exit. The earlier functional-only decision is superseded by this green bounded verification. It establishes no actual grant or policy mutation.

| Revised owned path | SHA-256 |
| --- | --- |
| `packages/portal/web/figma-settings.js` | `00a6349b3c16da3b31cab8e32da0dde5cc5764724abd1d9fd01fb9f4cbb66575` |
| `packages/portal/web/api.js` | `4b608fcde06ebb2e2a8bf2d3bda7ba682a3a72920b8762ce55db8f6390b05102` |
| `packages/portal/web/figma-auth-public.js` | `37c224301b981a75ea0eb59755142199372de6bf5ec9b8b5671bb365631056f9` |
| `packages/portal/web/figma-auth-consent.html` | `a517ebb46e30626d50ab7562b459e209a8d93d617370fd367524bba7319f4eea` |
| `packages/portal/web/figma-auth-consent.js` | `cfa0bd18655247a3dcaff6520b250bfd329484d857be7b94a077428416d01b0c` |
| `packages/portal/web/figma-auth-consent.css` | `92936bf38172f7af6875e8be212882ff6a7db8eceb186306ced37a347e6abc73` |
| `packages/portal/web/service-functions.js` | `36c0d05f81dcc63db109eaff6a6bc0239e797d85624f90dce95cf91a503c0e19` |
| `packages/portal/web/tests/official-oauth-settings.test.mjs` | `29ed09255609f04e0dc09d8412a009a17f65d099bd37caa06429bac6020c9379` |
| `packages/portal/web/tests/service-job-approval-pointer.test.mjs` | `dff63cabdb36c6f1f14388d29e513801ce11c5cad45d380312767a9260c01dac` |
| `packages/portal/web/tests/local-capture-progress.test.mjs` | `dea8ed68928a2c88bea448e5ee83bb942abed46f6bb98ccaf2090ea7492805fe` |
| `packages/cli/src/official-figma-mcp-command.ts` | `d129f1e6a536c2e2045472bdb7db73ad01296b7fda9599d2e8a4023cefddafe9` |
| `packages/cli/src/service-functions.ts` | `5e979e50b00a2cfc2bdbc60f016020a4c2c098e028721efcea42f3698f10113f` |
| `packages/cli/src/commands.ts` | `335a807e57092b40851b1c351af74228971721531d47e349407e3ff371b458ad` |
| `packages/cli/test/official-figma-mcp-auth.test.ts` | `31d12be4451480fc852c0c6dd313d3f95bee14419c5df5b068352a8c9ade98db` |
| `packages/cli/test/service-functions.test.ts` | `2c6b5c6956ab4862b997a7ff54e0c7cb83f1a7a9c030c5c5ad05eb3b0b5da1f6` |
| `packages/cli/test/official-figma-mcp.test.ts` | `bd090eb43a4d4a8fddf67fad20594f4024fa88078e769c85355fc8f1f0f5c2ca` |

Root must still reconcile exact combined backend/relay/engine/static resources, census, catalog/provenance and source-bound whole/artifact/runtime evidence. The public CLI source and command tests route through the same daemon ControlClient boundary and do not copy CLI environment values; full actual deployed CLI/provider proof remains combined root-owned verification. Proxy/browser intent fixtures do not prove real external consent or client eligibility. The owner's official MCP live deferral remains explicitly deferred. No source Chrome, live state, grant, fence, secret, deadline, process deployment or Git operation was changed by this review.
