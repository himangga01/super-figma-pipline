# Preview workflow navigation budget repair

Date: October 13, 2026 (Asia/Seoul). Baseline: Main/native source `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`. Read [the service analysis](../../service-analysis.md) before continuing. This exact two-file candidate is not integrated or deployed and does not establish current CDD acceptance.

## Cause and minimal behavior change

The controller reported an actual workflow reload failure: `page.goto('/')`, waiting for `networkidle`, timed out at 5,000 ms. Source confirms that `preview.ts` sets the context's ordinary action timeout to 5,000 ms. Initial screen navigation explicitly uses 30,000 ms, but the workflow reset navigation omitted that explicit option and inherited the shorter context timeout.

The candidate adds the same existing 30,000 ms timeout to workflow reset navigation. It keeps `networkidle`, the 5,000 ms assertion timeout, comparison/workflow criteria and frontend bytes unchanged. The existing combined caller/300,000 ms signal still closes the owned browser on abort. No global deadline, original run deadline or native profile budget is extended.

## Meaningful service-owned Chrome verification

The changed fixture runs `assertNativePortalPreview` with the service's installed Google Chrome path and `chrome` channel in a separate owned headless session. Its local server answers the first screen request normally but delays the second, actual workflow-reset navigation by 6,200 ms. The real source-bound form then changes state and its observation passes. It checks executed behavior rather than mocking `goto` options.

The unchanged source failed this fixture with `page.goto: Timeout 5000ms exceeded` at the workflow reset. After the minimal change, the final focused run passed both cases, zero failed and four filtered. The delayed navigation case took approximately 8.24 seconds including launch, screenshots and workflow observations. A second case stalls that workflow response for 20 seconds, supplies a 3,500 ms caller signal, observes the second request and actual rejection, and settles in approximately 3.57 seconds. This verifies that the larger per-navigation allowance does not bypass the shorter caller boundary. This cancellation case also passed before the source change.

TypeScript 6.0.3 checked 116 source files with zero diagnostics. The two changed files pass lint and formatting checks. An initial lint finding required an explicit rejection-message assertion; the test was corrected and the exact two changed cases rerun. No whole suite or previously passed full UI suite ran.

## Evidence and continuation limits

Exact source and test copies, Main preimages and receipt hashes are under `.worktrees/_cache/preview-navigation-budget-20261013/freeze/frozen-files.json`. Retained receipts are `targeted-red.json`, `targeted-green.json`, `targeted-final.json` and `typecheck-receipt.json`. The exact candidate changes only `packages/mcp/src/portal/preview.ts` and `packages/mcp/test/portal/preview-interactions.test.ts` in that regular copy.

The fixture is separate from the retained owner Chrome/Figma sessions and current CDD source run. Main/native, frontend, API, authority and original deadlines were not changed. The copy shares the Windows account and reads existing dependencies; it provides no OS/process sandbox. Root must independently review and integrate at the chosen live-phase boundary. Only a subsequently executed, source-bound service validation can establish current CDD success. The owner-skipped eCommerce and owner-deferred official MCP live paths remain unpassed.
