# Independent review of local capture recovery, proof and progress

Review date: October 12, 2026 (Asia/Seoul).

This review follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md), [the approved implementation plan](../../plans/2026-10-12-local-capture-recovery.md) and [the existing recovery analysis](../../analysis/portal-local-capture-recovery.md). The coordinator owns live Chrome, integration, source/state authority and any actual recovery decision. The implementation author owns candidate source and tests; the reviewer owns this English report and later isolated fixtures only.

## Baseline and authority boundary

Protected main/native service source at assignment was `sha256:31e47b614fbc093b160d562e7b4107a4c1ad473965237b086f100663bb4f5ef5`, on published main HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with existing uncommitted integration work. Whole attempt `ed4b77cc-acc5-4b28-b869-ae3d0efa891a` was frozen/pending at assignment, then ended failed with 5,348 passed, two failed and twenty skipped, as reported by the coordinator. Its fixed release epoch is separate from runtime deadlines and any new confirmation window. It does not cover the changing managed recovery candidate or the separate failure-repair candidate.

The coordinator subsequently integrated four independently reviewed, nonoverlapping MCP failure-repair files. At the pre-overlay checkpoint, main/native combined source was `sha256:f29b9e17f3e24fb5b187b2b86bd09f9913105fc72200a2fb1797eee208e0cc58`, unreconciled and with no active whole check. The later exact native recovery overlay is recorded below. Recovery-owned before hashes were compared individually against the original main paths; the combined overlay was not incorrectly required to retain the entire old 31e4 fingerprint. Actual retained QA remains a separately compiled 31e4 runtime and does not cover this candidate.

The three old local capture unknowns are distinct from the three daemon-journal unknowns: page-API job `4f6d727a-8c4a-4183-865e-746c04efd2c1`, Dev Mode blocked export `2d367c4a-c986-47da-8d19-8d2f5cdffa93`, and connection-only QA export `fa9b8cbc-2d60-4412-a5b1-a6adb4f6b0e5`. Their original outcome/evidence/deadline remains unchanged. **No actual owner permission to abandon any fence exists.** Chrome Allow, model-data consent or a request to implement recovery cannot substitute for that decision.

The review now includes exact frozen source inspection, ten independent boundary cases, an owned installed-Chrome UI fixture and separately compiled public-library/control proof checks. The coordinator supplied the native overlay after verifying the final manifest. All fixture state and compiled output was privately owned and separate from live state. No actual recovery decision, live endpoint, source Chrome action, installation or additional subagent was used.

## Reviewed implemented contract

The candidate separates the original unknown result from an explicit, immutable `owner-abandoned` fence disposition. Eligibility is narrow: one of the seven enumerated local Chrome inspection/export/copy features, a write-classified unknown composite, zero daemon operations and a non-null available workspace. Journal-backed, guided, unsupported or null-scoped uncertainty retains its existing fence. Acknowledgment does not dispatch the capture, resolve a daemon operation, grant egress or accept an output.

`prepare-recovery` creates a new one-use, sixty-second decision challenge bound to exact row and workspace identity. `abandon-local` needs the same challenge/fingerprint/binding, explicit acknowledgment and hashed rationale/evidence. Current producer, deferred source work and cleanup must be quiescent at the durable decision boundary. A restarted/historical producer needs an additional explicit owner assertion, recorded as `operator-asserted-prior-runtime`; it is not machine proof of the old process or browser actions.

Prospective pre-effect proof is a separate private CLI-library authority. A genuine object identity is stored in module-private `WeakSet`/`WeakMap` state, bound to the service-created invocation ID and mutable effect-issued state. The public getter can inspect proof but cannot mint it. Codes, messages, paths, JSON fields, prototypes or missing folders confer no proof. Effect boundaries must be marked before queuing opening/selection, target focus/attachment, local output creation and source actions. Only a settled invocation with genuine no-effect proof can become a new failed/cancelled job. The existing unknown rows must never be reclassified retroactively.

Progress consists only of closed phase names and bounded timestamps/history. It must arrive before connection opening, never imply that a native permission popup is visible, and never expose endpoints, arguments, URLs, tokens or raw errors. One bounded selected-active-job poll must preserve unsent inputs/confirmation state, stop on terminal/disposal and reject stale responses. Progress cannot alter execution, deadlines, approvals or recovery eligibility.

## Draft review findings and status

These observations apply to changing managed source and are not executed failures of a frozen candidate. The initial read of `local-capture-execution.ts` had hash `0c6467f46606e659293ab6fe046c88d00d2f3f4356b2c0475ed28d89a367a3cd`; `service-jobs.ts` was already an intermediate candidate, not the immutable native baseline. Final review must include all changes from native source and every new file.

| ID | Boundary concern found by source trace | Pre-freeze status, superseded by final verification below |
| --- | --- | --- |
| R1 | Challenge expiry was checked before asynchronous audit/binding/serialized persistence, permitting a slow audit or queue to commit after sixty seconds | Author accepted and added a final workspace/TTL/fingerprint/quiescence check in the serialized commit. Await frozen regression and independent delayed-audit/queue proof. |
| R2 | For `open:false`, cancellation during actual `newCDPSession` initialization could settle the logical runtime/lease while a later focus call or cleanup still remained pending. Opening/selection URL fields alone reported quiescent | Author accepted and added actual source-initialization and late-session-cleanup tracking plus failed-work uncertainty. Await independently gated initialization/cleanup cases. |
| R3 | Tracking only the current connection could lose old pending/failed source work when retirement/endpoint change/new read replaced the connection. `ExistingChromeConnection.close` did not drain that work in the inspected draft | Author added retained retiring-source references and checks before replacement/connection opening and recovery. Await frozen cross-generation pending/failed-work probes. |
| R4 | The new private proof wrapper lacked the original typed public error code, so `publicError` would collapse a genuine `CHROME_CONNECTION_REQUIRED` into `SERVICE_UNAVAILABLE` | Author preserves the closed diagnostic code and cause through `diagnosticError`, with an explicit safe fallback. Code remains separate from private proof authority. Await actual public-library regression. |
| R5 | Readiness-failure output-folder creation had no direct effect marker and relied on an earlier focus marker | Author added a direct marker before the failure folder. Await issued-effect/output-boundary proof. |
| R6 | Copy cleanup used an abortable logical wait around the real restore evaluation and swallowed its failure; export restoration also swallowed rejection. The public runtime promise could settle while source hooks/restoration remained pending or unconfirmed, outside selected-session tracking | Author added helper callbacks retaining actual source-work promises and restoration cleanup through owner-level pending receipts/sticky cleanup failures. Await frozen real-helper cancellation, restoration and rejected-cleanup probes; swallowed errors alone must not restore recovery authority. |
| R7 | After a successful tracked Scripter snapshot, `captureBrowserAssets` used an untracked asset bridge. `evaluateReadProgram` races actual frame evaluation against cancellation and detached/caught its cancel evaluation; asset acquisition can swallow per-asset errors | Author selected conservative quarantine: immediate internal uncertainty on logical cancellation, cleanup-sensitive actual evaluation/top-level asset tracking, and no clearance from a successful cancel-message RPC. Browser timeout/read rejection also remains unconfirmed. Await frozen regressions and independent success/rejection settlement cases. This source trace has no executed reproduction yet. |
| R8 | Every one-second active poll replaced the entire job-detail HTML, closing exact-input/response disclosures and removing the currently focused approval button. Preserving the external feature form and terminal recovery draft did not preserve active approval review state | Author added same-job disclosure state and approval/summary focus restoration, plus an owned Chrome regression. Draft correction inspected; independent Chrome execution still awaits frozen source. This is a source-visible UX issue, not an executed recovery-authority failure. |

Before freeze, these corrections were source observations without independent execution. That checkpoint is retained as historical review evidence. The final manifest includes copy/export, Scripter/snapshot/assets and their tests. The final verification and approval below supersede the preparation-only status without converting draft observations into claimed executed failures.

## Independent verification plan

The following cases exercise actual security/durability boundaries rather than duplicating implementation predicates. Use the coordinator's isolated candidate and new owned fixture state; never load/copy live state or operate source Chrome.

### Recovery and persistence

1. Through real same-origin HTTP/CSRF, prepare/acknowledge one owned unknown local row. Compare the original persisted job core, status, timestamps, deadline, argument hash, operation/result metadata and existing evidence bytes before/after. Only a new disposition/audit may appear. Restart and verify original outcome remains unknown and the specific acknowledged fence stays released.
2. Bind two unknowns in one workspace plus another scoped/global/journal-backed uncertainty. Acknowledge one local row and verify all other overlapping fences remain. Recovery must make zero original runtime/tool calls and must not change egress or a guided-run/journal record.
3. Reject wrong job, challenge, confirmation, row fingerprint, workspace binding, missing/unavailable/replaced workspace, null workspace, nonallowlisted name, read-only/local/single-operation proof, any retained daemon operation and duplicate challenge consumption. A stale fingerprint must be rejected after row mutation, not derived from caller claims.
4. Hold audit, final binding and serialized queue past challenge expiry. Recheck at the decision boundary. Concurrent preparations/acknowledgments and workspace replacement while awaiting the queue must not commit stale authority.
5. Inject audit failure, temporary-write failure, rename failure and ambiguous post-rename response. Before a confirmed durable disposition, memory must keep the fence active and durable failure must prevent dispatch. After committed disposition, audit-settlement failure must not trigger replay/rollback; readback/restart must identify the durable decision honestly.
6. Historical rows require the explicit producer-retired assertion; false/omitted assertions fail. Public/audit quiescence must say operator-asserted, not observed. Current-runtime rows cannot use that assertion to bypass a known pending/failed producer.

### Producers and source effects

7. Hold the actual runtime promise after cancellation wins the caller race. A released logical slot or terminal row must not enable preparation/acknowledgment until the producer settles.
8. Gate actual selected-session initialization after its effect marker, abort the logical caller, and then allow focus/late cleanup. Recovery remains unavailable through the entire pending period. A failed cleanup remains unavailable even when no current logical lease exists.
9. Repeat that uncertainty across physical retirement, changed endpoint and a new successful read. A healthy new generation must not erase the old generation's pending/failed cleanup. Shutdown and cleanup errors must remain observable without creating a replacement generation late.
   Also gate actual copy/export hook installation/restoration and source-action promises. An already-aborted logical wrapper cannot hide the underlying restoration task; a rejected restoration must leave current-runtime recovery unavailable rather than reporting observed quiescence.
10. With owned installed headless Chrome, distinguish no source action from an issued focus/navigation/click/export/copy. Mark before request/intent publication and before all local/failure output writes. An issued or partially completed action stays unknown even when a directory is absent or a code claims connection failure. No native approval is automated.

### Prospective proof and progress

11. Obtain genuine new proof through the compiled public CLI and its getter. It is accepted only for the exact settled invocation. Forge code/message/path/emit payload, clone/prototype/cause, different invocation ID, same error after a later marked effect, and a separately bundled module's object. All invalid proof stays unknown. Old rows without proof remain unknown after restart.
12. Race cancellation/timeout versus producer settlement and output/state durability. Late genuine proof cannot rewrite an already settled unknown or revive an old deadline. Persisted safe proof must not depend on re-inferring runtime absence after restart.
13. Insert endpoint/token/body/error canaries into runtime emits and progress callbacks. Only the closed phases and bounded observation metadata may appear in job progress/history/diagnostics. Terminal or cancelled late progress must be dropped, and throwing progress observation must not change execution.
14. In an owned installed-Chrome function view, type multiline/large unsent inputs, retain focus/caret, confirmation/recovery rationale and disclosure state while safe progress updates. Verify one in-flight bounded poll, terminal/disposal stop, delayed older responses after selection change/action, and no accidental recovery submit. Unknown recovery forms must not be repeatedly rebuilt by active polling.
15. Verify the actual public proof getter export/contract in an isolated built package, including missing-export artifact rejection and distinct-bundle identity behavior. A stub-only portable fixture cannot certify the real proof implementation.

## Frozen source and final verification

Final integration review is **approved for these exact twenty-four files only**, bound to manifest SHA-256 `cd8f2d9e09895ad44f804cea65e0ef95811cd1d12c3646166d0b72aba135185e`. The manifest was produced at `2026-10-12T04:23:50.887Z`. All nineteen prior-file hashes matched main before the overlay, and all five new paths were absent. All twenty-four candidate bytes matched both managed and native copies after verification. Native combined source remained `sha256:cdcdc704e6f8a48ab07f85174da259540c002487c958ae31c92504c453e67411`, including the four separate nonoverlapping failure repairs. Main integration and release/provenance gates remain the coordinator's work.

The reviewer used `C:/2026_project/super-figma-pipline/.worktrees/baseline/service` as the isolated candidate, with its actual native dependencies. Private fixtures/results live in `.worktrees/_cache/local-capture-independent-20261012/`. Tests did not load/copy a live state root, replay a capture, renew a deadline, grant policy or use Chrome 9932. This is same-account native isolation, not an operating-system filesystem/process/network sandbox.

| Independent check | Executed result and evidence |
| --- | --- |
| Ten boundary cases | 10/10 passed, zero skips/failures. Exact original persisted rows and evidence survived one of two same-workspace decisions; the other scoped/global overlap remained fenced after restart. Two concurrent uses yielded one durable decision. Gated final binding, expiry and cleanup changes rejected commit. A post-commit audit-response failure retained a durable separate disposition without replay. Real asset collection that swallowed bridge rejection remained quarantined, and successful late browser evaluation/cancel posting did not clear uncertainty. Public-library proof accepted only the exact invocation and rejected counterfeit identities. Receipt `independent-recovery-result.json`, SHA-256 `413ead7c8d6586835987ab25a514a780edc7279ea6f9355843e5c86337186491`. |
| Owned Chrome progress/approval UI | Passed using installed Google Chrome, `channel:'chrome'`, headless and an owned ephemeral loopback fixture. Expanded active approval disclosure and focused approval button survived two polls; multiline feature input, caret and focus survived subsequent progress. Four reads, maximum one in-flight detail request, zero owner actions, disposal stopped polling, zero page errors. Receipt `approval-progress-chrome-result.json`, SHA-256 `fbfe1b1912b4ae2083c6bcdfe0aa54b55706fb2fd74549b78c2c215906d5322b`. |
| Actual separately compiled public boundary | Passed with two independently instantiated CLI bundles and a separate portal-control bundle compiled from the frozen native source. The public getter accepted the genuine exact invocation through portal runtime; a different invocation, a separate library instance, JSON clone, prototype, cause/code object and fresh message-equivalent Error were rejected. The private factory was absent from public exports, and `CHROME_CONNECTION_REQUIRED` remained the safe typed code. Receipt `compiled-boundary/result.json`, SHA-256 `3ad1e2b4f74e3233aa6b2b1373834efd65f53c16e9feefa45e13062d058d4a47`. |
| Final integrity | Manifest hash and all twenty-four managed/native files matched after all checks; combined native source fingerprint remained the coordinator's supplied hash. No source modification was needed after freeze. |

The author's retained history is separate evidence: R1 90/100, R2 102/102, R3 105/106, R4 123/124, R5 142/143, R6 143/143, R7 145/145, R8 147/147 and R9 focused UI 1/1. The final manifest records those exact receipts, no skips, static exits zero and a separately built getter boundary. The reviewer inspected those receipts and final corrections; the ten independent cases/UI/build checks above are the checks executed by this reviewer, not a claim to have independently rerun all 147 author cases.

Two private UI harness failures are preserved separately. The first assumed a workspace-root Playwright module path and stopped before candidate/UI/Chrome execution. It was corrected to resolve the native CLI package's installed dependency with `createRequire`. The second declared the intended text fixture optional, so multiline fill timed out after the approval-focus/disclosure checks; the fixture was corrected to require that field. Owned Chrome and fixture listener were closed in both paths. Only private harness files changed. Final UI execution passed; neither failure is attributed to product behavior.

The private compiled CLI bundle hash is `37def541b0e933205c70f82d08654218ef17cddd3fc634ed826b6842b60ae9f1` for both separately instantiated copies; portal-control is `ef41f793e8a7c6ad6620d57ac814a688e8711b31ff6920aa8495c76618505bec`. Four compiler `INEFFECTIVE_DYNAMIC_IMPORT` warnings were retained in the result. The checks prove this separately compiled public object-identity contract, not a newly packed release, OAuth session or live Figma acquisition.

R1 through R8 have no outstanding integration blocker in the reviewed source. Source inspection confirms actual initialization/late-cleanup receipts are retained across generation changes, effect marks precede queued source intents and normal/failure output paths, and own cleanup uncertainty prevents a capture from being reported as successful. Interrupted Scripter work is conservatively quarantined even if browser-side promises settle. This may leave an owning runtime unable to recover until an explicitly established producer-retirement boundary; that is an intentional limit, not permission to clear uncertainty.

### Exact final file hashes

| Frozen path | SHA-256 |
| --- | --- |
| `service/packages/cli/src/commands.ts` | `4ef01f26d4abb4decb070e86deb01b16ea715e672b1cbb5f8266d6ef5661ee5b` |
| `service/packages/cli/src/service-functions.ts` | `1df07a9fa0b8213e043660ab6d44d2d6f16561781348af21218fc18905fa7f92` |
| `service/packages/cli/src/browser-session.ts` | `3d7de7962798b545c8de3e3e65917b8ea530b67d574dba98a287121db85f1e91` |
| `service/packages/cli/src/library.ts` | `5affbcda1d371784a6f123155b70c5e5e341e355870d0891544e1be8a453ea05` |
| `service/packages/portal/src/service-jobs.ts` | `8d3e04f71cf0ddf74ae2aefbe0e3d0edb0b90d9ffa7416fd57e6ca43b3575e93` |
| `service/packages/portal/src/control.ts` | `decf556b34e21d5ad7048b26088f468121793834ad8bed07a71f54d336bd097e` |
| `service/packages/portal/src/contract.ts` | `0a77805d3a9332c966948f411ee47bb1afd4929aa852a673f993f80c571bd1e3` |
| `service/packages/portal/web/service-functions.js` | `757065688ec43b2acf519cb5b8073554a18865e458813c6762322bbd0efc2a51` |
| `service/packages/portal/DEBUGGING.md` | `82853e36979b7fda86c3139924cba244255c1f52ea4c2e438c02017f22e8e31e` |
| `service/scripts/verify-artifacts.mjs` | `f830be1f4b2a98992fa0baa66a7339ba96af2d6f026d7c76ecb97eb50d8fa86f` |
| `service/test/portal-artifact-startup.test.ts` | `79bea84da156a81ce54ae342d26e2c1b45c6241aa1c5fa5d1cf921f7229cbdfd` |
| `service/packages/cli/test/browser-session.test.ts` | `9ae1902dcd7760a6e16151eb5065d6ddb7667836a4eb16972bb2bcf81378b5ef` |
| `service/packages/portal/web/api.js` | `839d093685ba0c0d56072d7ec679357cd2dc9a3d4096ee50a17bca57a14bb9e5` |
| `service/packages/cli/src/figma-web-copy.ts` | `27fe629f1e074c04eebd932117fc2e231e09b72f2a10759396e5c71d7d98b928` |
| `service/packages/cli/src/figma-web-export.ts` | `f47dbf2c5e482f358fb88912726b36feba1edaf98c9ed194d3fd39cbfca78970` |
| `service/scripts/test-skip-census.mjs` | `9e300dfe4862245c9f77bdd67e47c851b7b9a412693c0d504f4288c00adfb23b` |
| `service/packages/cli/src/scripter-bridge.ts` | `49fe18d6e3b1b0d132d8f4cf151fc8686c1d13c92044e1be8650aed64cc366ce` |
| `service/packages/cli/src/snapshot-reader.ts` | `579efc45e0e459173201d903310744b4cf53df6da06de7709800ff53fa088cd2` |
| `service/packages/cli/src/capture-assets.ts` | `7e87267a53cc7124136b24e5effc66e25bfecae5edf243c7a4603c1b22f73d0d` |
| `service/packages/cli/src/local-capture-execution.ts` | `a30ab55ee3958fcb8949c503c67f9ec362559c2ac4a23725f6f75a97a3ecff70` |
| `service/packages/cli/test/local-capture-proof.test.ts` | `cdd38e7041dabc7cf2fa860e5f2030943385e915bf2461bf6e74d1a6bd5639e2` |
| `service/packages/cli/test/local-capture-helper-quiescence.test.ts` | `eccda21eb24383761dfc6aaed7c9684c4c39f443dd0e8a3fa4d99745952ff02e` |
| `service/packages/portal/test/local-capture-recovery.test.ts` | `da944aba90f8f06c7fae4ffc323620f08fa015ae68f27a4581fb3ccef518a41f` |
| `service/packages/portal/web/tests/local-capture-progress.test.mjs` | `0ccb220881a776f52cf9803eec4f2e0b009749d9ba1da01c176c31bcc24bdc13` |

### Reproduction flags

Run from the isolated native service directory, after verifying the manifest/overlay:

```powershell
$env:SFP_REVIEW_CANDIDATE='C:/2026_project/super-figma-pipline/.worktrees/baseline/service'
$env:SFP_REVIEW_DEPENDENCIES='C:/2026_project/super-figma-pipline/.worktrees/baseline/service/node_modules'
$env:SFP_REVIEW_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe'
node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/local-capture-independent-20261012/review.config.mjs
node C:/2026_project/super-figma-pipline/.worktrees/_cache/local-capture-independent-20261012/approval-progress-chrome.mjs
node C:/2026_project/super-figma-pipline/.worktrees/_cache/local-capture-independent-20261012/public-built-boundary.mjs
```

## Verification limits and continuation

The final approval covers source integration of the exact twenty-four candidate files. It does not cover all fifteen proposed verification groups or independently reproduce every author case. Required whole checks, authority reconciliation, production package verification and runtime deployment remain separate. The source had no full passing whole check at this review checkpoint; the prior 31e4 failure remains retained. The independently compiled object boundary is not a substitute for the actual portable artifact gate.

The reviewer wrote only this report and private fixtures/compiled evidence outside native source. Test state was newly allocated under checked owned temporary paths and removed. Only an owned installed headless Chrome and ephemeral fixture listener were started/closed; no service daemon or source Chrome was started, stopped, controlled or inspected. No production source, live state, policy, namespace, index, credential or installed package changed. The private configuration/Chrome script syntax checks preceded candidate execution; final results are bound to the frozen source rather than those preparation-only checks.

The coordinator can integrate the approved hashes and run the required reconciled source/package gates. Any actual abandonment still requires an exact row/workspace/evidence review, confirmation of current producer cleanup and the separately named historical producer-retirement assertion when required, followed by explicit owner acknowledgment. No such actual acknowledgment was granted or exercised here. Preserve all three local unknowns and all three daemon unknowns. Fresh data permission, CDD generation/parity/application acceptance, official MCP authentication and the subsequent eCommerce acceptance remain separately owed.
