# Published d722 scoped release evidence

Recorded October 14, 2026, Asia/Seoul. This directory records the service-owned scoped release for the login-free portal, CLI and MCP implementation. Root completed read-only publisher preflight with zero output writes, then published the eight selected aggregates and source inventory. Publication does not replace the daemon, renew authority or complete case acceptance.

## Immutable release bindings

| Binding | Value |
| --- | --- |
| Main/native source | `sha256:d722c32152149464c961c660622a95e3da603eb00f291e28b15c024507bcd87d` |
| Release | `1fb30463-ea9c-446d-88fe-bd750b6c28d6` |
| [Published report](scoped-release-report.json) | SHA-256 `1fba5d15ddc8fd08f7e92c691d8bea2d256fa95af90b22e2b3f40354a741885a` |
| [Source list](source-list-v2.json) | SHA-256 `2c1c1b75b3edd1370fc8558bcb00427a925db576346744530e93af50f0070769`; 1,361 rows |
| Build identity | `sha256:7632acd6e38c4887b44325ef6cb1439f55170bdb7452ce3985aae3eb629cb1d1` |
| Source epoch / build ID | `1791202532` / `1791202532000` |
| [Build/package receipt](build-package-scoped-receipt.json) | SHA-256 `d57383a2d1fccd8cc7812da37b8afa3b655268fa57b34fab6dd4b6000c5bed4a` |

The report and source list were not rewritten when these portable copies were added. The owner Git index remained `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675` during the author?s evidence-copy work. This is same-owner filesystem verification, not an OS sandbox or cross-file atomicity.

## Selected implementation and verification

The eight aggregate names preserve the deployment compatibility contract. Names such as `reviewed-35-integration` and `c2-r50-targeted` do not announce another execution of their historical scopes.

| Aggregate | Actual evidence and scope |
| --- | --- |
| [Reviewed integration](scoped-aggregates/reviewed-35-integration.json) | Historical 35-file/R52/eight-file integration plus exact No-Core, source diagnostics, test cleanup, C3 producer and final C3 test-style supersessions. The final October 14 delta contains eight unique source/test files. |
| [Artifact precision](scoped-aggregates/artifact-precision-targeted.json) | Historical 56-pass/1-skip component result with 53 current byte-identical closure files. No precision rerun. The historical whole failure?s cause remains unproven. |
| [Compiler component coverage](scoped-aggregates/c2-r50-targeted.json) | Historical reviewed compiler components and their bounded targeted evidence. No new R50 run or complete C2/C3 acceptance. |
| [Types](scoped-aggregates/changed-source-types.json) | Actual closed CLI/portal typechecks at source195ba and MCP typecheck at source15c074, with explicit later test-only supersessions. No new final whole-source type pass is claimed. |
| [Lint/format](scoped-aggregates/changed-source-lint-format.json) | Actual final eight-file lint and format passed at d722 after earlier affected batches failed. Passing type and functional checks were not repeated. |
| [Diagnostics/contracts](scoped-aggregates/diagnostics-contracts.json) | Current diagnostics check passed. Public contracts retain historical closed unchanged-schema coverage; contracts were not rerun. |
| [Provenance](scoped-aggregates/provenance.json) | R67?s five actual shadow-index commands passed; 281 manifest changes and four authority paths were observed. Exact derived metadata synchronized Main/native. |
| [Build/package](scoped-aggregates/build-package.json) | Eight actual commands passed, four archive hashes were verified and exactly one focused artifact test passed. |

The No-Core implementation accepts genuine canonical authenticated retained terminal pre-egress proof with the original operation/workspace/tool identity and no result/receipt. It preserves active-abort, compare-and-swap and the single durable recovery update. The diagnostic implementation retains page identity guards and failure codes, records fixed safe phases, and logs the original capture failure before retaining the failed freshness check. The C3 producer retains bounded generated React Router types for every admitted producer without loosening issuer, output, deadline or source guards. These implemented deltas do not establish actual historical-run recovery or a new live source capture.

## Portable evidence closure

Use [the evidence index](portable-evidence-index.json) to map original hash-bound local paths to exact portable copies. It records 77 references, 34 exact copies and eight local-only references, including six raw test reports with sanitized summaries and two local helper modules. Already portable project receipts remain linked in their established locations. Embedded original paths are preserved; neither the published report nor its hashes were rebased to the copy directory.

- [Final reviewed publication configuration](portable-evidence/c5b11c003a2cd0f362a76ef0fe554aaeb6994599febb692d1b5301a6dc9758f7-inputs-final-d722-r67-r2-20261014.json)
- [Five-command static aggregate](portable-evidence/ca61b6fdf29c9a266d1e040de9679bbb8fb7e3c63b2b51627831794851dd5d09-final-static-aggregate-d722-r2-20261014.json)
- [C3 actual Main-preimage normalization](portable-evidence/946a10d211dc27519aa0d5d7668518aafea66d6a752902a849e32856669c0196-c3-r2-normalized-actual-main-preimages.json)
- [C3 style-only normalization](portable-evidence/e1be41e5105522137034eff574f9fb8764d2215433c9548d7dbd01dd6cf36dfa-c3-test-style-normalized-actual-main-preimages.json)
- [Selected C3 assertions](portable-evidence/selected-c3-assertions.json)
- [Immutable R2 diagnostic approval](../source-identity-diagnostics-r2-approval-20261014.md)
- [C3 producer review](../c3-generated-route-type-review-20261014.md)
- [Actual R67 synchronization](../final-scoped-r67-provenance-20261014.json)
- [Current diagnostics/provenance checks](../final-d722-generated-checks-20261014.json)

The selected C3 positive passed in R3 while that original report still contained a negative failure. The corrected negative passed in R4 with the other assertions filtered. The portable summaries preserve original report success/failure counts, assertion names and statuses; they omit raw failure stacks and source snippets. They cannot replace the raw reports for a new evidence issuance or acceptance decision. No clean full-suite result was manufactured, and the already passing positive was not rerun.

Build information, archive manifest, bounded command logs and artifact scope are carried as exact metadata/log copies through the index. Archive binaries and runtime state remain outside this Git documentation closure. An original raw test report remains local-only even when its sanitized summary is carried. No capture facts/assets, grant secrets, browser sessions, credentials or daemon state were copied.

## Preserved failures and remaining acceptance

The [first d722 build attempt](../final-build-path-failure-20261014.json), SHA-256 `0f53103a5fc1c8fa66ca929fea17e6714996608b3703a0cc25ba399607b1430f`, failed because the build subprocess could not locate pnpm through PATH. Its release43f2951b and run06659883 remain failed. The separately named R2 build used the reviewed native PATH/Corepack setup and passed; the failed receipt was not overwritten. Earlier six-file and producer static failures remain linked by the final aggregate and independent reviews.

The prior whole attempt `8f4753c4-e895-4751-9346-f8a6e8fb6cbb` remains failed. No whole rerun occurred. The owner closing scope retains one complete portal journey, owner-skipped final eCommerce and separately deferred official Figma MCP live verification. This scoped report does not assert a whole pass, public C2 compiler positive, complete C2/C3/CDD acceptance, runtime deployment, live No-Core recovery or successful source freshness. Later case/runtime evidence must remain separately dated and source-bound.

For continuation, read [AGENTS.md](../../../../AGENTS.md), [canonical service analysis](../../../service-analysis.md), [C2/C3 continuation](../../../analysis/c2-c3-continuation-20261013.md), [recovery analysis](../../../analysis/portal-local-capture-recovery.md) and the [final release checklist](../final-release-checklist-20261014.md). Root owns remaining case work, runtime authority, canonical report updates and the authorized main commit/push. This evidence-copy task ran no tests, builds, source acquisition, browser or runtime actions.
