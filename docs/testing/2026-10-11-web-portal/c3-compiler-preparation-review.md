# Independent C3 compiler preparation review

Date: 2026-10-13, Asia/Seoul.

## Decision and exact source

**Approve the exact29-file C3 R3 candidate for root integration.** The confirmed ambiguous-lock finding was repaired and the original independent failure cases now pass. This approves the source-preparation boundary described below, not deployment, generation, authenticated live execution or complete C3 acceptance.

Final managed manifest: `service/.cache/c3-compiler-admission/frozen-files.json`, SHA-256 `a98882dd9b8e79c77e5fe8d4623ec709ad3ffa922fbb3151b959e15d073956ad`. Final author implementation report hash: `1b6e12474d86c0c1bc54bf41db1d40854274303392bc173f47a9ebd62002acdf`. All29 managed and independent-copy after hashes were checked again after execution. R2 `70b24edb2bcf5316e29a543e7d624d962a37651c01fd85a48335997796c93421` and R1 `0552dc513d3674786d40a4afbfa1cf5d693c51c9c2eff23373d293ca7ff99c24` remain historical freezes.

Read-before references: [the implementation record](c3-compiler-preparation-implementation.md), [C3 readiness](c3-native-readiness.md), [sample preparation](../2026-10-10-continuation/sample-generated-inputs.md), [sample malware review](../../analysis/oss-samples-malware-review.md), [canonical service analysis](../../service-analysis.md), [repository instructions](../../../AGENTS.md), and the shared analysis policy. The original author baseline is `c00eb2add4411a6177ffa4fbd4c22f231fd1a5f2ac06c02924426473dfad4042`, with later derived authority baseline `9c2806c53fe97177935a8e5949a4da4714cda5a18dc10b4bdf5d31c3b133bc95`. These hashes are historical context; this review binds exact files in the final manifest.

The independent source copy is `.worktrees/_cache/c3-independent-review-20261013/service`. It is a regular copy overlaid with exactly the reviewed candidate. Source schema aliases point explicitly to that private copy. Native installed dependencies are read through separately located dependency links; no install or build ran through the managed tree. The independently executed compiler creates its own regular reference copy, temporary state, actor/session/workspace identities, source profile, compiler output and bundle. Main/native source, actual source Chrome, service runtime, policies, grants and Git were not modified by this review.

## Purpose and architecture

The new service path obtains genuine compiler observations for a screened React Router reference before normal capture/core/coding prerequisites are ready. It addresses configuration outside TypeScript project roots, conservative immutable literal imports, and the genuine virtual SSR module. A private compiler namespace preserves actual generated modules separately from reference source inventory.

`portal_prepare_source` and its CLI alias accept only bound run/profile/source/deadline input. Owner preparation constructs fixed reviewed dependency-copy/typegen/build commands, binds actual package context/importer/lock/source/executable/artifact bytes, and registers the owner-reviewed exact profile. Native execution is followed by module/output receipt verification and private issuance of compiler evidence. Replanning may consume that current private evidence; ordinary validation and application keep their existing capture, candidate, core, recipe, workflow and acceptance checks.

## Confirmed finding and repair

**P2, ambiguous lock projection, repaired in R3.** In the exact R2 parser, a valid v9 lock followed by `lockfileVersion: '10.0'` still returned the earlier v9 package facts. Appending `importers: {}` also returned the earlier selected importer. Two independently authored rejection tests failed; a separate executable/private-output configuration rejection passed. Existing native byte/profile/result guards still held, so this was incorrect admission of contradictory lock facts, not demonstrated arbitrary code execution.

The author changed only `react-router-compiler-evidence.ts` and its associated lock test in R3. Source hash changed from `66928264a4b08caf0d88cdadf8bf1168286ea9c38c68a706b62947238ee18654` to `c17c1a3bc0d37c6ef32c9feb0d1360c5b38abcc84e8e9fdbe298f1481b5ea12d`. Test hash changed from `ba337e8b2a4c6ea043e145dd4f149f59a32149dc21469ece2158495663275de4` to `607746733b0cc1f08ae2cb83269b4b29e28c13c8998c9fbff7aa92b488333ed9`.

The preflight now inspects the complete top-level document before deriving selected facts. Only unique known keys, exact quoted version9, block-only sections and known boolean settings are accepted. Duplicate/replaced/unsupported roots cannot leave earlier facts active. The original two lock negatives, the original closed-configuration denial, and the independently read screened v9 importer all passed against R3. The six actual package facts remain usable; React Router is8.4.0 and Vite8.0.3. No parser or runtime source was changed by the reviewer.

The preceding R2 differs from R1 only by the optional `i.evidence?.path` guard in a Docker-role assertion. That test-only undefined-to-false correction did not change runtime behavior.

## Trust boundaries checked

| Boundary | Source review and executed evidence |
| --- | --- |
| Genuine result origin | Native results are process-issued objects in a WeakMap, bound to run, resolved work root, source/profile hash, original deadline and full result hash. Serialized/copied/changed results cannot issue proof. A real caller-written fake build remains rejected because it lacks the prepared compiler-profile brand. |
| Closed compiler configuration | AST checks permit only the inspected SSR configuration, fixed input and approved zero-argument framework plugins. Root/output redirection, executable custom plugin options, aliases, spreads, accessors and unsupported shapes remain rejected. |
| Source/package/runtime binding | Complete source inventory and root identity are rechecked; the actual registered reference, package-context importer, source manifests, installed versions, executable bytes and artifact tree are bound. Compiler source and private output namespaces remain distinct. |
| One-use attempt | Durable atomic `compiler-attempts` creation precedes provisioning/execution. Unknown or failed attempts do not replay. Native run ownership and original deadlines remain in force. Historical author retry/capacity receipts were read as author evidence, not counted as independent successes. |
| Exact Tailwind loader | Only the fixed302-byte body/hash at the canonical package location inside verified provisioned dependencies may register. Options, alternate/query/data URLs, repeated registration, changed bytes and foreign members remain denied. Trace and output rechecks remain active. |
| Inert Vite resolver adapter | Only the reviewed resolver function source hashes and actual hash-bound Vite files are recognized. The caller callback is not registered or executed. The service hook decodes bounded two-string data, verifies importer/target bytes and rejects foreign/unsupported schemes and hooks. |
| Private issuer and freshness | Evidence binds owner, primary workspace, source inventory, origin plan/context and current runtime generation. Retained module/output receipts are reverified before/after freshness boundaries. Replanning and recipe propagation require the current private issuer; persisted metadata cannot recreate it after restart. |
| Preparation is not acceptance | Source-only results require replan and declare restart expiry. Genuine preparation left the original run unchanged. Even after exact conservative middleware reviews, the fresh run remained `needs-input`, with no coding lease and incomplete operational workflows. |

The reviewed native guard checks actual module bytes, identities, links and provisioned/generated output ownership. It remains a local owner-account execution mechanism, not an OS or universal network sandbox. Locked installed bytes and prior malware screening are not an independent reconstruction/authentication of every package tarball.

## Independently executed results

The corrected private R2 cohort passed **267/267**, zero skips. Existing module-evidence verification contributes11 separately executed passing cases. R3 delta verification passed **21/21**, zero skips: four independently authored cases including the original failures and real v9 context, six compiler/config/lock cases, and11 existing module-evidence cases. These counts overlap and must not be summed as unique tests. Final exact R3 MCP noEmit exited0.

Two affected actual-native/legacy NativeWork assertions passed separately against R3, with41 unrelated cases explicitly filtered. This is a2-case result, not a43-case pass.

The real native positive is explicitly **R2 source evidence**. Before execution the reviewer verified99 retained source files,8,217 dependency files and670 relative links in a fresh regular reference workspace. No dependency download, install, lifecycle hook, Docker or borrowed build result was used. An independently generated helper bundle used the private source and fresh synthetic actor/session/workspace/state/output. The service prepared and registered the actual source-purpose profile, ran React Router typegen and Vite/SSR build, observed17 generated members, replanned and retained eight exact conservative middleware reviews. The compiler module issues disappeared; workflow completion, capture, core and ordinary coding prerequisites remained unresolved.

The eight genuinely issued capsule probes passed: current issuer verification, foreign owner rejection, foreign primary workspace rejection, copied capsule rejection, foreign generation rejection, foreign graph-workspace rejection, capsule retirement after close, and graph retirement after close. The original run was unchanged. This fresh execution does not adopt the author's R15/R17 receipts and is not relabeled as a new R3 native build. R3's only runtime-source delta is the preflight guard, and its actual pinned context was replayed separately.

### Receipts under the independent root

| Receipt | SHA-256 | Meaning |
| --- | --- | --- |
| `independent-cohort-r2.json` | `f833ff319bd5edb30d80b431599dafb8a3be885f630b1d43300c40f80911d3ef` |267 R2 cases passed, zero skips |
| `independent-boundaries-r1.json` | `2c821cc9fdea0a35df778d388e8456455695f9ac6b31b52fa1d3d19c671338ff` |12 pass,2 fail; both independent lock rejections failed |
| `independent-boundaries-r3-final.json` | `fce2887b58d38e346297c5f74d3ebec664bb8353079ed9e1b5c9550a51ff7a05` |21 R3 cases passed, zero skips |
| `native-r1/native-real-result.json` | `456f1d1bca30c850a990baed125592f6bd04ccf066510ff00ce57073e2468fa0` |Actual owned R2 source preparation/replan,17 members, original run unchanged |
| `native-r1/genuine-capsule-boundaries.json` | `8084893eedb52d8e1681ee1e15c1e2663c5ba0657cb5ee94dce0c1d4709e27c1` |Eight independent genuine-issuer conditions true |
| `native-input-binding.json` | `5825ad2cbbeab2b09c501f397f6e504f7ed65a61696da42c00aa2ac48ba88ddb` |Fresh source/dependency/link verification and helper provenance |
| `native-r1/reviewed-source-plan.json` | `40decabb461f581e38fe5d70e3fedc497a62533e0880c1d5d9be5ff35a4ace89` |Complete conservative closure, incomplete workflows, needs-input, no lease |
| `source-binding-r3.json` | `7dc81a5c65b694447eeaff6cb03d1708885f5ff65ae5d786253043b02312e0ba` |Final exact29 overlay and prior R2 binding |
| `independent-native-work-affected-r3-corrected.json` | `452f6fbafa8c1590af1450847ff9723173d2794e19921bc8b476b46828789df6` |Two affected actual-native/legacy cases passed,41 filtered |

An initial reviewer harness resolved shared/IR imports to old native source. Its243/245 result and two CLI collection errors remain in `independent-cohort-r1.json`; it is not a valid candidate result. The corrected config uses explicit private source aliases. An incorrectly selected NativeWork characterization command matched no tests; its four filtered cases are not passes. Both harness failures are retained rather than converted into product failures or successful execution.

## Limits and continuation

There is no remaining confirmed C3 blocker in the reviewed R3 scope. Root must integrate the exact29 files, preserve separate producer/supplier/policy reviews, update public inventory/aliases/provenance and perform a fresh source-bound whole/artifact check. A current actual owner source-preparation operation, authenticated HTTP/action-nonce admission, Windows ACL acceptance, actual source Chrome, Figma capture, target generation, business API/data/auth implementation and complete portal acceptance remain unexecuted by this review.

The private fixture exercises actual service classes and public tool dispatch with synthetic owner/state permissions. It cannot substitute for actual operator authority or daemon deployment. Earlier author/native results and independent R2 compilation remain source-bound historical evidence. No old deadline or data grant was copied or renewed, no unknown operation was replayed, and official live MCP remains owner-deferred.
