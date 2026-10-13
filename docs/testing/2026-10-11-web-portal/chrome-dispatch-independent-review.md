# Independent review of Chrome discovery and dispatch

Analysis date: October 12, 2026 (Asia/Seoul).

This bounded review follows [repository instructions](../../../AGENTS.md), the shared analysis policy and [canonical service analysis](../../service-analysis.md). The coordinator owns the canonical report and final integration. The existing implementation record is in the managed copy's `docs/testing/2026-10-11-web-portal/chrome-dispatch-repair.md`; its earlier failed fixtures and corrected dependency-only synchronization are preserved there.

## Baseline and scope

The coordinator reported native/main service source `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`, published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with substantial existing uncommitted integration work. Its whole check and artifact check passed before this independent review window. Those checks do not cover the proposed Chrome change. This reviewer did not rerun the whole source fingerprint or modify main/native service source, the owner's index, runtime, policy or source Chrome.

The reviewed candidate is in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. The coordinator's reported dependency-only synchronization was inspected as context. Managed dependencies share the native dependency installation; this separates source files, not Windows process authority. Owned fixture Chrome runs under the same Windows account. No Docker, alternate engine, Codex browser control, external Figma connector, live source Chrome or native security approval was used.

The four initial frozen hashes were independently verified before testing:

| Path under managed service | Initial candidate SHA-256 |
| --- | --- |
| `packages/cli/src/chrome-endpoint.ts` | `30b6f449d19089fec74a22f80ff0b810a098621da1caa42922de668fbcc20ee5` |
| `packages/cli/src/browser-session.ts` | `21df365c062beb463fefaa6e67678cf759ee493addb669bec50af3d8cdf57a16` |
| `packages/cli/test/chrome-endpoint.test.ts` | `8eea0cca0e928e952ad510f7a4d0df704ad358af1f6d62711b0ba301e87103e0` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `c666f2bbdab14f523e529187b56e7e7a501e366517944ee45558ce8e48e707fc` |

## Purpose and implemented boundary

Public `chrome.tabs` dispatches through the fixed service feature adapter, CLI argument parsing, `openChromeSession`, existing-profile discovery and the retained Chrome relay. Missing Chrome profile discovery previously returned the sentinel `chrome` to a relay that requires a URL. The candidate returns typed `CHROME_CONNECTION_REQUIRED` instead. The explicit profile override and exact `DevToolsActivePort` browser-path line remain intact.

The new HTTP branch reads the explicitly supplied loopback CDP base's `/json/version/` suffix before creating the existing WebSocket relay. It caps response bytes at 4,096, rejects redirects and malformed/non-WebSocket discovery results, and applies the existing loopback/no-credential/no-query/no-fragment endpoint checks. Explicit WebSocket input continues directly to the retained relay. This adds no fallback browser launch, permission approval or captured design evidence.

## Independent execution and findings on the initial candidate

The independent five-file suite passed **65 tests, zero failed, zero skipped**. Both installed-Google-Chrome headless reconnect cases executed. The actual public feature fixture covered the configured-profile override and explicit HTTP CDP endpoint, and verified retention of unrelated owned pages. This is owned fixture execution, not the owner's retained visible portal or live Figma acceptance.

Command, executed in the managed service root:

```powershell
node node_modules/vitest/vitest.mjs run packages/cli/test/chrome-endpoint.test.ts packages/cli/test/browser-session.test.ts packages/cli/test/browser-source-open.test.ts packages/cli/test/browser-session-reconnect.test.ts packages/cli/test/service-functions.test.ts --project cli --reporter=json --outputFile=.cache/chrome-dispatch-independent-20261012.json
```

The private structured receipt is `.cache/chrome-dispatch-independent-20261012.json` in that managed root. Additional independent probes then confirmed two gaps that the passing suite did not exercise:

| Priority | Finding | Reproduction and consequence |
| --- | --- | --- |
| P2 | HTTP discovery restarts the connection budget | A new owned ephemeral HTTP fixture took 98 ms to return discovery while `connectionTimeoutMs` was 150 ms. The subsequent mocked `connectOverCDP` still received the full 150 ms, and total elapsed time reached 257 ms. `chromeEndpoint` spends the bound and `ExistingChromeConnection.open` forwards the original bound again. The added stage must share an absolute connection deadline and forward the remaining duration. |
| P2 | Cancelling the first HTTP waiter cancels an uncancelled shared waiter | Two simultaneous `ExistingChromeConnection.open` calls shared a pending HTTP discovery. Only the first caller had an abort signal. Cancelling it after the owned server received the request caused both callers to reject with that exact first caller's reason. The new `chromeEndpoint(options, signal)` binds shared physical initialization to a logical caller, contrary to the retained `waitLogically` contract. Shared discovery needs separate lifecycle cancellation while each logical waiter retains its own cancellation. |

Both probes transpiled the exact reviewed TypeScript source into isolated JavaScript contexts and used only newly owned ephemeral loopback HTTP servers. Playwright connections and relay creation were mocked; neither probe connected to a real browser or live service. The timing probe intentionally demonstrated the full forwarded bound; its elapsed values are one measured fixture result, not production timing guarantees. The cancellation probe observed two consumers, one cancelled signal and two identical rejections, with zero relay/Playwright invocations.

The findings were sent to the implementation owner and coordinator before approval. The owner acknowledged the budget gap and unfroze only the assigned browser-session and reconnect-test scope for correction. No reviewer production edit was made. The initial candidate was **not approved for integration** at that checkpoint. The corrected-candidate disposition below supersedes that pending state while preserving the reproduced failures.

## Corrected candidate and independent recheck

The author subsequently froze these four files. All four hashes were independently verified both before and after the corrected checks:

| Path under managed service | Final reviewed SHA-256 |
| --- | --- |
| `packages/cli/src/chrome-endpoint.ts` | `30b6f449d19089fec74a22f80ff0b810a098621da1caa42922de668fbcc20ee5` |
| `packages/cli/src/browser-session.ts` | `5a34bf368faae00467489e1f184b64210d6c119e7e5affbd72cac24c826f971f` |
| `packages/cli/test/chrome-endpoint.test.ts` | `8eea0cca0e928e952ad510f7a4d0df704ad358af1f6d62711b0ba301e87103e0` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `254465bff788536a3257837ebb3d6ea299661f5c5025049fcad4264c629f0387` |

HTTP discovery now returns its absolute connection deadline with the resolved endpoint. The pending initialization subtracts elapsed time, including relay preparation, before forwarding the remainder to `connectOverCDP`; an expired remainder rejects before that call. Configured-profile and explicit-WebSocket paths preserve their existing timeout arguments and retained permission behavior. Shared endpoint discovery uses a class-owned controller. Cancelling a logical waiter leaves the shared discovery alive for another waiter. Class closure aborts that discovery; standalone cancellation closes its owned connection promptly.

The same independent five-file command, changing only the output receipt to `.cache/chrome-dispatch-independent-repaired-20261012.json`, passed **69 tests, zero failed, zero skipped**. The four added regression cases cover shared HTTP/attachment budget, cancellation isolation and prompt class-close/standalone-cancel behavior. Both real installed-Google-Chrome headless reconnect cases passed again; their actual public feature/profile/HTTP checks and unrelated-page retention remain fixtures. Receipt SHA-256: `173a225f66f116495c9c2bd2c447c139aed0b654a29a0c2cc640a2a6aa8dcdf8`. The initial 65-case receipt is retained separately with hash `4569be30b00931b29fc1fb92cba86686230e6a92a9827417f823e5173697591f`.

Five additional independent revised-source probes passed using new ephemeral loopback HTTP servers and mocked Playwright/relay objects:

| Probe | Observed result |
| --- | --- |
| Discovery and attachment share the 150-ms original budget | Playwright received 54 ms after discovery; measured total was 155 ms, including scheduling overhead. The full 150-ms timeout was not forwarded again. |
| First of two HTTP waiters cancels | The first received its exact cancellation reason; the uncancelled second completed and selected the expected mock page with one attachment call. |
| Class closes during pending HTTP discovery | Pending discovery rejected `CHROME_CONNECTION_CLOSED` promptly; no relay or attachment was created. |
| Standalone waiter cancels during pending HTTP discovery | The original caller reason was preserved promptly; owned closure stopped discovery before relay/attachment creation. |
| Relay preparation exhausts the original deadline | `CHROME_CONNECTION_REQUIRED` rejected before any Playwright dispatch. |

The first attempt to run the revised custom probes failed in the review harness because its isolated context omitted the newly needed `AbortController` global. No discovery or browser call occurred in that attempt. Adding the standard global to the harness, with no source change, produced the five passing results above. This harness correction is distinct from the two initial production findings.

Independent CLI typecheck also passed:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json
```

**Disposition: no remaining blocking finding in this bounded four-file review.** Both initial findings were corrected and independently rechecked. This approves the exact final candidate for coordinator integration; it is not whole-source verification, deployment approval or successful live Figma acceptance.

## Remaining verification and limits

The revised-hash, bounded-suite, deadline, cancellation and closure checks above are complete. Integrate only the exact four final reviewed files, preserving separately owned diagnostics and exact native transitive prerequisites. Bind a new integrated source fingerprint and run the coordinator's required current-source checks. Preserve explicit WebSocket/profile dispatch, retained permission generations, endpoint restrictions, session release and reconnect behavior. Do not weaken source-selection guards or retry an original unknown operation.

The unresolved operational question remains whether the coordinator's private launcher supplies the intended profile path to the actual portal process. This review did not read that live process environment or repair its launcher. Actual same-tab portal `chrome.tabs`, source collection, official-MCP authorization, generation and frontend acceptance remain separate execution obligations. No new product behavior beyond the bounded connection fixes is authorized by this report.
