# Portal Chrome CLI discovery and dispatch review

Analysis date: October 12, 2026 (Asia/Seoul).

This bounded record supplements the canonical [service analysis](../../service-analysis.md) and [retained-tab execution record](retained-tab-live-qa.md), following [repository instructions](../../../AGENTS.md). The coordinator owns updates to those shared authorities.

## Baseline and purpose

The native/main source baseline supplied by the coordinator is `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`, at published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with uncommitted integration work. Its whole check was active during this review. No main/native service source, service state, existing Chrome connection or Git index was changed by this reviewer.

Implementation is restricted to the managed service copy at `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. The four owned source/test files were compared with exact native bytes before editing. They already matched. The managed dependencies use a junction to the native installation; this is filesystem separation of source changes, not an operating-system sandbox or independent dependency installation. Tests run as the same Windows user. No Docker, alternate browser engine, Codex browser connector or external Figma connector was used.

The portal exposes public CLI features through a fixed adapter. `chrome.tabs` should attach to the selected existing, authorized Google Chrome source, report the actual tab, and disconnect its service client without closing owner tabs. It does not establish design capture or frontend acceptance.

## Actual failed job and code trace

The original actual UI job is `354dca88-a7a9-4d61-bd8b-5d427f804976`, created at `2026-10-11T15:59:34.607Z`. It failed immediately with `ERR_INVALID_URL` for `chrome.tabs` arguments containing the valid CDD URL and `wait:60`, with workspace `49e7b1c8-4a07-4f12-b6b6-83bd2638774f` and target selector `none`. Its private receipts remain under `.worktrees/_cache/portal-functions-delete-20261012/evidence/source-chrome-1791734374191/`; they must not be replaced with a later successful job.

Implemented call chain:

1. `packages/portal/src/control.ts` loads the public CLI library and calls `executeServiceFeature` in the portal process.
2. `packages/cli/src/service-functions.ts` validates the feature and builds `chrome-tabs --url <url> --wait 60`, omitting undefined CDP input.
3. `packages/cli/src/commands.ts` correctly parses those arguments and calls `openChromeSession`.
4. `packages/cli/src/browser-session.ts` resolves Chrome discovery and creates the retained service relay.
5. `packages/mcp/src/portal/chrome-transport.ts` requires a WebSocket URL and starts with `new URL(remoteEndpoint)`.

The CLI resolver already honors `SFP_CHROME_USER_DATA_DIR` before `LOCALAPPDATA`. Neither the adapter nor browser-session dispatch replaces that environment. A connected daemon does not establish that a separate portal process has the same discovery environment.

Two existing capability defects were confirmed:

- Missing `DevToolsActivePort` caused `resolveExistingChromeEndpoint` to return the literal `chrome`. The retained relay then attempted `new URL('chrome')`, producing the observed error family before any Chrome handshake. Installed service Playwright 1.63.0 can interpret that literal only by reading the default profile's same record. It does not discover an endpoint when the record is missing. The service must report the missing prerequisite explicitly.
- The public CLI accepts loopback HTTP CDP endpoints, but the retained relay accepts only WebSocket URLs. HTTP discovery was not resolved before relay creation.

The coordinator reported an additional private launcher finding: Windows PowerShell 5 parsed a UTF-8 script without a BOM using an incorrect encoding for the literal Korean username in the intended profile path. The actual default Chrome record exists. That launcher investigation is separate from the capability fixes here. This reviewer did not inspect live process environment or endpoint contents, and does not claim a verified launcher repair or a successful rerun of the original actual UI job.

## Managed implementation

`chrome-endpoint.ts` now reports `CHROME_CONNECTION_REQUIRED` when no configured/default discovery record exists, with guidance to use the existing Chrome debugging endpoint or explicit profile directory. It preserves the configured profile, the secure record checks and its exact browser-path line.

The HTTP resolver reads only the loopback endpoint's `/json/version/` route. It does not follow redirects, bounds response bytes to 4,096, limits the request to the caller's connection bound with a 60-second ceiling, and preserves cancellation reasons. It validates the discovered WebSocket against the same loopback, protocol, credential, query and fragment constraints. It never launches a browser or logs endpoint contents.

`browser-session.ts` preserves explicit WebSocket dispatch without HTTP requests and applies HTTP resolution before creating the original retained relay. Malformed explicit CDP input receives typed `CHROME_CDP_INVALID`. Existing source-selection, connection-generation, retained-permission and session-release behavior remain in place.

Independent review subsequently confirmed two defects in the first HTTP implementation: discovery and attachment each received the full original connection timeout, and the first logical caller's cancellation signal could cancel shared discovery for an uncancelled second consumer. The revised implementation carries one absolute HTTP deadline through attachment and derives the remaining timeout. The connection owns the discovery cancellation controller; logical callers retain `waitLogically` isolation, while explicit class close and standalone cancellation abort the owned discovery promptly. Default-profile and explicit-WebSocket paths retain their original Playwright timeout values.

## Verification and preserved failures

- The initial endpoint regression run retained 12 failures and two passes. Missing-record discovery resolved to `chrome` instead of rejecting; HTTP resolution was absent.
- After implementation, all 15 endpoint tests passed. They cover exact record paths, missing records, HTTP path resolution, unsafe discovered endpoints, malformed/oversized payloads, redirects, stalled requests and cancellation.
- A four-file run passed 57/57 with zero skips: endpoint, browser-session, source-open and installed-Chrome reconnect cases. The owned headless Chrome reconnect fixture executed the actual public `chrome.tabs` feature both through the configured profile override and through explicit HTTP CDP. Both produced the actual owned fixture title and retained the unrelated page. These fixture results do not establish live Figma or retained visible-tab acceptance.
- A later five-file run retained 63 passes and one failure. The existing replacement-source case expected `FIGMA_TAB_NOT_FOUND`, but received `CHROME_CONNECTION_REQUIRED: the existing Chrome connection is not ready`. Two isolated repeats also failed, including an earlier replacement attachment with relay reason `Chrome connection unavailable`. The new public-feature profile/HTTP paths in the second case passed in these repeats. No production bounds or acceptance expectations were relaxed.
- The first failing five-file checkpoint used browser-session hash `79c77c575c0268da22bb5b654be42459422d3ab208a27178691fc66e542f402b`, reconnect-test hash `d49569de9fa2d7b28d737911095d6dad8de6cb91c5a62dde7c579cae8d82ec30`, and the stale relay hash `6126a02ba32adb6912655c8596b282210000bc4656b2c81d2e996491b569101c`. It preceded the final typed malformed-CDP correction. The last exploratory repeat added only a temporary fixture catch that would redact endpoint URLs; that instrumentation was removed from final source. Its error occurred before that catch was reached. There was no threshold or production-code modification to suppress the failure.
- Static isolation review then found that managed `chrome-transport.ts` was stale. Native hash `96ee2e62ab36739aff909de959a8b935803465a717348bad36dd05bcbe86cf1d` differs from managed hash `6126a02ba32adb6912655c8596b282210000bc4656b2c81d2e996491b569101c`. The entire difference is the missing native `Target.detachedFromTarget` handler that removes released session IDs from `ownedAttachments` and `sourceNavigations`. A stale released attachment can produce an erroneous later detach/reset and invoke `fail()`. This is a concrete test-source mismatch; it cannot be dismissed as contention or treated as an accepted regression.
- With owned Chrome reruns paused during the native whole check, the non-Chrome four-file run passed 62/62 with zero skips. The malformed-CDP-only case passed 1/1, with the two Chrome cases excluded by its name filter. CLI package typecheck, scoped lint and scoped format checks passed after correcting exact optional argument types and typed mocks.
- After the coordinator approved dependency-only synchronization, the managed relay, service-graph, module-resolution and coordinator were replaced with exact native bytes. These are not implementation changes for integration. A repeated static TypeScript import-closure traversal checked 360 source/test files. Apart from the four owned capability files, only separately owned active diagnostic additions differed. No corrected-baseline owned Chrome rerun has occurred yet.
- At 01:17 KST, the coordinator provided a quiet window after the native baseline whole check. The final attempt retained 38 passes and three suite-load failures before any owned Chrome launch: synchronized module-resolution imports `package-config-evidence.ts`, but that file was absent from the managed copy. The initial closure helper had incorrectly skipped missing local dependencies. Its corrected native-counterpart traversal checked 361 files and identified only that missing dependency, with native hash `594a03189b6de2b532f16d1a2c18432493e8f65566df63655598797592d9355e`, plus active diagnostics deltas. The private structured failure receipt is `.cache/chrome-dispatch-final-20261012.json` in the managed service. An exact dependency-only synchronization was requested; this failure is not an installed-Chrome or actual portal execution result.
- At 01:18 KST, the coordinator approved copying that exact missing dependency. The corrected 361-file closure had no stale or missing imports, leaving only the four owned Chrome candidate files and the separate active diagnostic additions. The final quiet-window five-file run then **passed 65/65, with zero failures or skips**. The count includes the newly added malformed-CDP case. Both installed Google Chrome replacement/restart cases passed; the real public `chrome.tabs` feature passed through the explicit profile override and HTTP endpoint against the owned headless fixture. Its private structured receipt is `.cache/chrome-dispatch-final-repaired-20261012.json`. All earlier failures remain retained. This resolves the reproduced managed-baseline fixture failures for this bounded suite, without changing source guards or timeout thresholds.
- The [independent SOL review](chrome-dispatch-independent-review.md) reran that first candidate successfully at 65/65, then retained two additional confirmed blocking probes: an HTTP response consumed 98 ms of a 150 ms connection budget, but Playwright still received 150 ms; cancelling one shared discovery consumer also rejected the uncancelled second consumer. The initial passing suite is not rewritten as a pass for these missing behaviors.
- At 01:29 KST, the revised implementation added four cases covering the shared HTTP deadline, isolated logical cancellation, class close during discovery, and standalone cancellation during discovery. The HTTP-only run passed 4/4 with the three unrelated cases excluded by its name filter. The subsequent full five-file suite **passed 69/69, with zero failures or skips**, followed by passing CLI package typecheck, scoped lint and scoped format. The revised private receipt is `.cache/chrome-dispatch-final-reviewed-20261012.json`; the original 65-case receipts and both independent findings remain separate. Final independent verification of the revised frozen hashes is pending.
- The independent SOL reviewer then verified the revised frozen hashes, reran **69/69** with zero skips, passed CLI typecheck, and passed five additional owned HTTP/mock-attachment checks. The [independent record](chrome-dispatch-independent-review.md) now approves the exact four-file candidate for integration, while retaining both initial blocking findings. The reviewer corrected an omitted `AbortController` in its own VM harness before those additional probes; no production source changed for that harness correction. This approval remains separate from integrated-source and actual retained-tab acceptance.

Revised frozen candidate file hashes after the independent HTTP lifetime repairs:

| Path under service | SHA-256 |
| --- | --- |
| `packages/cli/src/chrome-endpoint.ts` | `30b6f449d19089fec74a22f80ff0b810a098621da1caa42922de668fbcc20ee5` |
| `packages/cli/src/browser-session.ts` | `5a34bf368faae00467489e1f184b64210d6c119e7e5affbd72cac24c826f971f` |
| `packages/cli/test/chrome-endpoint.test.ts` | `8eea0cca0e928e952ad510f7a4d0df704ad358af1f6d62711b0ba301e87103e0` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `254465bff788536a3257837ebb3d6ea299661f5c5025049fcad4264c629f0387` |

Commands use `node node_modules/vitest/vitest.mjs run ... --project cli`, `node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json`, and the installed `oxlint`/`oxfmt` CLI files. Ordinary `pnpm` was not on this review process's PATH; the first attempted pnpm invocation did not execute.

## Remaining work and limits

Keep the exact native synchronization of transitive prerequisites separate from the four implementation changes, without integrating old managed versions back into main/native or overwriting the separate active diagnostic changes. Independently review the four-file capability change and preserve the successful corrected-baseline receipt together with every earlier failure.

The coordinator must verify the private launcher's profile encoding, integrate reviewed source bytes after the active whole check finishes, bind a new source fingerprint, and rerun `chrome.tabs` in the same retained actual portal tab. Do not replay original unknown operations. This record supplies no official MCP authorization, live design collection, generation, application or final frontend acceptance.

No product decision is required for the bounded repairs. The open operational question is whether the corrected launcher makes the actual portal process resolve the already authorized source Chrome profile. The corrected-baseline owned fixture suite has passed; actual retained-tab acceptance and integrated-source checks remain separate.
