# Independent own-service official OAuth daemon review

Date: October 12, 2026 (Asia/Seoul). Reviewer: independent SOL delegate.

Read-before references: [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [the integration plan](../../plans/2026-10-12-own-official-oauth-portal.md), [authorization analysis](../../analysis/official-mcp-authorization.md), [engine review](own-official-oauth-engine-review.md), and [daemon implementation report](own-official-oauth-daemon.md). This report owns no daemon or relay source. The root owns deployment, state, Chrome, integration and release gates.

## Baseline, source and purpose

Main/native baseline remains `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. The reviewed managed candidate is the eleven-file manifest `service/.cache/own-official-oauth-daemon/frozen-files.json`, SHA-256 `e222697a58519a8d7c5a6887d9ea34c7269af9567282b3a2f1bed4d9793814cb`. Every owned managed/author-fixture file matched its exact after hash before execution. Engine R3 and pure shared contract remain separate unchanged dependencies. The a476 whole/artifact pass excludes this increment.

The provider owns public names-only configuration, an installed own-client declaration/digest gate, fresh fixed-origin discovery, one original-budget transaction, an exact owned loopback callback listener, a single-use private303 handoff and generation-bound credential leases. The daemon wiring supplies the same provider connection to probe/read and program capture. Typed status contains only closed public configuration and binding facts; external-token compatibility is explicit. GET status does not start discovery/consent/refresh.

## Preserved revision 1 finding

**P1, reproduced in revision 1 and resolved in revision 2: JSON escaping bypasses known-secret result exclusion.** Frozen provider `fd666caa84718b62c072b4ffc0be7fab471c1812b6911578f9442c35e7bee0d9` calls `JSON.stringify(value)` and compares that text with raw sensitive values. A permitted client secret containing a quote and backslash passes successful injected SDK authorization, then its escaped representation no longer contains the raw secret. The guard accepts a nested result containing it. Two additional tests exercise the actual public settings `endpoint.read`: both a nested value and an object key containing the secret are returned publicly. This is an executed publication failure, not only a source hypothesis. The author accepted the finding and repaired its owned provider/test. The original freeze was withheld; the repaired exact source approval and executed recheck are recorded below.

First private receipt: `oauth-daemon-independent-20261012/independent-r1.json`, SHA-256 `9d0790d8c3dd9035a83c859c755a73aafe0888e4e136c4d9fa94cd4d11246b21`, seven passing and one failing boundary case. Expanded `independent-r1-expanded.json`, SHA-256 `ed17011ef6e400f2744d3f9df4256ba5d62acb1ec601ed3559c5270437cd7c09`, preserves seven passing and three failing cases, adding public endpoint value/key publication. No actual credential is present; all canaries are synthetic.

## Executed review evidence

The author's six-file cohort was independently re-executed against verified frozen bytes: **183/183, zero failures/skips**. A distinct output `fixture/service/packages/mcp/.cache/daemon-independent-r1.json` preserves that rerun; it does not overwrite the author final R6 receipt. The actual SDK uses injected responses. New provider tests globally forbid remote fetch and use owned Node loopback HTTP only. No live authentication, browser, callback to a production listener, contract installation, config/grant/fence change, state mutation or source-tree build/install occurred.

A separate regular source copy at native ignored `.worktrees/_cache/oauth-daemon-independent-20261012/service` contains the exact eleven-source overlay and untouched engine R3, with native dependency resolution and a private Vite cache. Eight initial independent probes, later expanded to ten, cover:

- JSON-escaped sensitive material in nested public values and keys, including actual public read publication.
- Failed handoff delivery consumes the URI once, without a second token request or revived handoff.
- Cancel awaits actual listener close sufficiently for an owned server to rebind the exact fixed callback port.
- Invalid issuer and duplicate raw state reject before a token POST, preserve the pending transaction and return only a static private rejection page.
- Successful status/serialization creates no extra discovery/token/refresh I/O.
- Unsupported public-client operator declaration yields zero remote requests and no listening callback socket.
- A held external bearer lease rejects an environment token replacement rather than returning the new value under the old binding.

Source review confirms exact literal callback Host/path/method/peer/body bounds and no generic URL logging middleware; cleanup/deadline closes only the owned server. State/code cardinality and token one-use behavior remain in independently reviewed engine R3. The metadata wrapper restricts exact official URLs/methods, manual redirects, cookies and bounded response bodies. Installed records are digest/client-ID bound and secret-method constrained; they remain an operator declaration rather than machine proof of Figma eligibility. Credential leases combine retirement signals and generation/token checks, SDK transport has no full auth provider/DCR fallback, and Desktop receives neither remote bearer nor lease.

## Reproduction and limits

From native service cwd, after rechecking the relevant exact frozen source overlay:

`node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-daemon-independent-20261012/review.config.mjs --outputFile.json=C:/2026_project/super-figma-pipline/.worktrees/_cache/oauth-daemon-independent-20261012/independent-review.json`

The private test is `service/packages/mcp/test/control/oauth-independent.test.ts` under that fixture. Its setup derives reusable synthetic helpers from the author test and adds independently chosen adversarial assertions; no production source is changed.

The injected permissions seam does not validate real Windows ACL protection. Actual daemon startup, packaged dependency/resource closure, combined portal native form/CSP behavior, installed client eligibility, real manual consent, authenticated official tool availability and complete source capture remain separate gates. A fixture pass cannot establish source/data authorization, remote grant revocation or CDD/eCommerce frontend acceptance. No real service state, process or source Chrome was inspected or operated by this review. Root must reconcile catalog/provenance and run combined source-bound release gates after repaired source approval.

## Revision 2 final independent source approval

Approve the exact eleven-file revised manifest SHA-256 `4e305e019d0c4fb87e1943d410afb7b0b8dc75ab189ebcc6dacd9a3e0d8474dd` for root integration. Every managed and independent private overlay file matched that manifest after execution. Only provider `af12be3b799ec8dd5a654441ad5665d28d3dac6c4aeb02ea82abf5703826ef2d` and test `ea86456ee36035da34187b362136f40bcab43b8244a3f0dbc8132d5fec57a484` changed from revision 1; the other nine, pure schema and frozen engine R3 remain unchanged. No remaining source-review blocker was found.

The provider now checks both raw sensitive material and its JSON-escaped representation in serialized keys/values, rejects publication above 2 MiB, and projects serialization failures to closed immutable errors. It does not claim complete exfiltration prevention against arbitrary re-encoding or an OS memory bound before serialization. The actual known-value publication finding is repaired. Original source and all failing receipts remain preserved; no failure was rewritten as a pass.

Independent final execution: **188/188 existing revised cases plus 10/10 private boundary cases, zero failures/skips**. The original own 7/10 failing cohort remains in independent-r1-expanded.json. All three previously failing assertions now pass, including actual public settings-read key/value rejection after successful intercepted SDK authorization.

| Distinct independent receipt | SHA-256 | Result |
| --- | --- | --- |
| `oauth-daemon-independent-20261012/independent-r2.json` | `6a0b3478cd93c7aa206e81f377d90fd484b1f8fffec659cb1bbbb92bef281f2c` |10/10 |
| `fixture/service/packages/mcp/.cache/daemon-independent-r2.json` | `01f207ac2ac9c4d6a77919de2c97e241f9516e1288f212c4e00b6c7dfba8a00d` |188/188 |

Author R9 and final static receipts are separately recorded in the revised manifest. Independent acceptance here includes source/hash review and the two actual executions; author MCP type/lint/format evidence is not relabeled as an independent static run.

| Revised owned source path | SHA-256 |
| --- | --- |
| `packages/mcp/src/control/figma-oauth-callback.ts` | `aa1fcd9db89a9d77b26b4e36d31d7db868d9be58cb6a625b8e91f740470d7597` |
| `packages/mcp/src/control/figma-oauth-contract.ts` | `b46deab1f5cb5b15988f07a1b9229559fb7857421ec3736036558d5aa9181006` |
| `packages/mcp/src/control/figma-oauth-handoff.ts` | `f47591eb2cd2124f3c6db3746bf9c416481333e7b823c7479fe8994b5bb09b41` |
| `packages/mcp/src/control/figma-oauth-metadata.ts` | `1cd0f7adffb5c6b993c470ef480f0488b5d6b3cd8129a471e266c128fa9a9a5c` |
| `packages/mcp/src/control/figma-oauth-provider.ts` | `af12be3b799ec8dd5a654441ad5665d28d3dac6c4aeb02ea82abf5703826ef2d` |
| `packages/mcp/src/control/figma-oauth-state.ts` | `700196f42b51018cbd587143f9569a944a47b6e6aeb70ca1dce88e18387a6e38` |
| `packages/mcp/src/control/figma-settings-endpoint.ts` | `2a3e766744e56b3088a84364f34f2218ec3fd536257a2c96ac8bb7183de7da5c` |
| `packages/mcp/src/control/route-registry.ts` | `9ab919bbe51b1c335cee135dc14f7a2d2e8b75acf842d6e903073795538cf73b` |
| `packages/mcp/src/index.ts` | `74ac932dbbdc00bc9e1225289faf206022b0fe0b6e09d22a60b4b1f1ad36a2de` |
| `packages/mcp/src/official-figma-mcp.ts` | `ae1fc1050fcf5a8911b587281fa5ddc636f1165e54f6331fc70995770d1ff2f3` |
| `packages/mcp/test/control/figma-oauth-provider.test.ts` | `ea86456ee36035da34187b362136f40bcab43b8244a3f0dbc8132d5fec57a484` |

The same callback shutdown/strict envelope, missing-configuration no-I/O, owner/session/generation retirement, installed-contract and metadata/token destination boundaries were retained. The pure public schema and provider tuple remain compatible with the separately frozen portal relay. This approval remains bounded to the managed source candidate; combined actual daemon startup, real Windows state ACL, public package/artifact closure, source-bound whole gates and installed-Chrome portal flow are root-owned verification. Missing accepted own-client facts and manual consent still prevent any claim of actual Figma authentication or full capture.
