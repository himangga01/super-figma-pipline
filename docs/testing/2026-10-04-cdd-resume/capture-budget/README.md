# eCommerce collection capacity and test continuation

Date: October 4, 2026 (Asia/Seoul). Published baseline: `5b9343efc82ef47ba56f412acbd4eee5a328d335`. Current main/native source fingerprint: `sha256:4d004e087192d771e2ff361e625c2d08c8f1585dde37bbd0164841c1601bc308`, recorded in the [checkpoint](source-checkpoint.json). The implementation and evidence are uncommitted.

## Actual collection boundary

The initial `--max-nodes 6000` invocation was an orchestration error: this option is a per-query limit of 1 through 2,000, not a whole-page limit. The snapshot reader already continues across roots and partial subtrees. The CLI now validates these parameters before requesting a browser connection and explains the batch meaning in help. No query limit was raised.

With the valid 2,000-node batch setting, service-owned Chrome/Scripter read all 3,198 eCommerce nodes. However, [the actual result](ecommerce-before-repair.json) remained truncated because the final ordered reread exhausted the combined byte budget. It recorded 14 original queries, 21 total calls, 10,537,570 accepted bytes, `REOBSERVATION_BUDGET`, `readComplete: false`, 57 captured assets and 226 pending assets. The CLI's successful process exit and `exactDesignValues: true` did not establish complete capture; its explicit truncation and asset coverage remain authoritative.

The repair reserves a separate 12,000,000-byte accepted-response allowance for initial collection and its exact ordered reread, for at most 24,000,000 accepted bytes combined. The original per-pass allowance, 256-call total, deadline, per-query schema, value-truncation checks and exact digest comparison remain enforced. A complete first pass therefore retains capacity for its equally bounded reread. An oversized first pass still remains incomplete. Live acceptance of this repair is pending a fresh completed source connection and collection.

## Independent comparison remains partial

The service compared the independently exported native document with the recorded incomplete Scripter capture. [The diagnostic](ecommerce-parity-gaps.json) covers 88,135 positions and retains 1,537 property differences, including 1,139 not explained by the existing representation rules. Both inputs contain 3,198 nodes, but 33 IDs are missing and 33 different IDs are extra. All 45 available original-image hashes match; 858 font ranges match and nine differ. Style comparison has one ambiguous `Primary` name pair, which is not silently matched. These results require further investigation and fresh complete collection. They do not authorize copying reference facts into the independent collector or claiming native admission.

## Test investigation and repairs

The previous [full-source failure](../chrome-opening/failed-source-report.json) was preserved. An [unchanged isolated run](isolated-failures.json) passed the native producer fixture but reproduced the pairing timeout. The timeout test armed a real 10 ms timer before its asynchronous file-backed credential-commit barrier. It could expire before reaching the intended assertion point and leave cleanup waiting on the held barrier.

The test now advances a controlled timeout only after reaching that barrier. It retains real sockets, actual persistence and every assertion rejecting credential/session publication after termination. Held fixture barriers are released during cleanup. Production authentication timeout behavior is unchanged. The native producer failure remains unexplained: isolated and expanded runs passed, and its assertion now retains exact failed command diagnostics without altering the runner, raising timeouts, adding skips or claiming a product repair.

The [budget regression](budget-red-tests.json) failed before the capacity change. [Six focused repair cases](focused-repairs.json), [129 expanded cases](expanded-tests.json) with one existing conditional skip, and [three final fixtures](final-fixtures.json) passed. Affected CLI/MCP typechecks and scoped lint/format passed after routine test-structure lint corrections. This checkpoint's alternate-index manifest has 29 semantic changes and four authority paths; offline verification preserves three upstreams, 238 vendor rows and 178 forks. Full-source attempt `8ba0fbde-9d07-4e62-b172-3e28b3dec566` subsequently passed 4,713 cases but failed one native cleanup case. The [Windows drain continuation](../windows-drain/README.md) preserves that failure and the subsequent reproduced race repair.

## Remaining work

Finish current source/package checks, complete a fresh eCommerce Scripter collection, and compare complete same-scope inputs. Chrome security approvals remain manual; official MCP still requires an available authorized official server. Complete independent collector admission, Desktop activation, the relevant other case/review gates, and then both final eCommerce frontend generations without reference frontend code. The earlier CDD Chrome/Scripter R8 run remains completed; these additional obligations remain open.
