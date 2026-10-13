# Independent review of bounded diagnostics retry

Analysis date: October 12, 2026 (Asia/Seoul).

This review follows [repository instructions](../../../AGENTS.md), the shared analysis policy and [canonical service analysis](../../service-analysis.md). It reuses the earlier [independent diagnostics review](server-diagnostics-independent-review.md), [implementation record](server-diagnostics-implementation.md), [retained-tab record](retained-tab-live-qa.md) and [sanitized live logging receipt](server-diagnostics-live-check.json). Earlier concurrency, compiled-stack and source-check failures remain historical evidence.

## Baseline and scope

The coordinator reports main/native source `sha256:673629ce8080ac1e697d144143b7b5d2c3a58482745a7ef885d0ea09578a0bfa`, published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted integration work. Whole attempt `79cecde8-fb11-43ea-a6da-35031cf76edd` was active when this bounded review began; this report does not claim its outcome. The earlier `87e13974-81f3-451c-a014-98987d9e0083` scope-declaration failure and narrow unique-title repair are preserved in the retained-tab record.

The author edits only the managed `packages/mcp/src/diagnostics.ts`, `packages/mcp/test/diagnostics.test.ts` and `packages/portal/DEBUGGING.md`. The reviewer owns no author files, prepares probes only in private managed `.cache`, and writes this English review report. No native/main production edit, root index change, package installation, dependency-junction mutation, live runtime, state/policy or source/portal Chrome control is authorized by this scope. The managed service root is `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`.

The native baseline remained frozen while its whole check ran. Its exact comparison hashes are:

| Native service path | Baseline SHA-256 |
| --- | --- |
| `packages/mcp/src/diagnostics.ts` | `262f802e38bdaf2eea07623e98b0dcf13e3c046ea55bbac8e5230ef9f8154c1d` |
| `packages/mcp/test/diagnostics.test.ts` | `5697b30ec0eecea2a233ca8d2f80674504aa5d51f7600c7d06079a24bfc0812e` |
| `packages/portal/DEBUGGING.md` | `f980631cae8fa98cbd562ac48f61592b3a9cfd1c707c312db2a8966eb2b32267` |

Initial managed observations below were taken while the author was already editing. The `a897...` source is an intermediate candidate, not the native baseline:

| Managed service path | SHA-256 at initial read |
| --- | --- |
| `packages/mcp/src/diagnostics.ts` | `a897849886a2c62a3b54cadfbeb8ecd9f7a3dc4685bef8e6c42b1e509c9ffa9f` |
| `packages/mcp/test/diagnostics.test.ts` | `5697b30ec0eecea2a233ca8d2f80674504aa5d51f7600c7d06079a24bfc0812e` |
| `packages/portal/DEBUGGING.md` | `f980631cae8fa98cbd562ac48f61592b3a9cfd1c707c312db2a8966eb2b32267` |

These are intermediate observations, not the final review binding. Final source deltas must be compared against the native `262f802e...` baseline above so early author changes remain included. The coordinator must supply the final three candidate hashes before any candidate execution.

## Purpose and current structure

Actual validation-runtime diagnostics recorded three lost writes while the UI and whole-check load overlapped. The retained stderr identified `DIAGNOSTICS_WRITE_DEADLINE` after handle inspection and before line append. The visible failure counters accurately report loss. That evidence does not establish whether filesystem delay or event-loop scheduling consumed the budget, and a later retry cannot recreate the original missing records.

The logger serializes one instance's immutable JSONL lines through a bounded FIFO promise queue. Separate instances/processes serialize each inspect/rotate/append transaction through the existing exclusive loopback mutex. Acquisition remains limited to 250 ms; a separate 250-ms cooperative hold deadline is checked before filesystem mutations. Already issued filesystem work settles before ownership is released. Flush separately waits at most two seconds and reports unconfirmed completion without timer-unlocking a pending writer.

The proposed change permits one additional attempt only for a privately authenticated pre-append deadline condition. The exact captured line must be reused after the original handle and mutex have fully settled/released. Failed, partial or indeterminate append attempts must never be replayed. Retry/recovery observations must remain visible through bounded safe signals and counters rather than hiding lost writes or changing job outcomes.

## Independent review plan

After final freeze, verify all three exact hashes and inspect the delta against the immutable native baseline. Then run the author's diagnostics tests with the existing real-HTTP diagnostics tests and independently probe:

- A genuine pre-append deadline recovers with exactly two acquisition attempts, one issued line append and the original immutable bytes.
- A second pre-append deadline does not trigger a third attempt; failure and retry counters remain distinguishable.
- Forged error codes/messages, inherited fields, copied/prototyped objects, causes and public symbols cannot manufacture retry eligibility. The eligibility authority must remain private to the module and must reflect the actual write phase.
- Issued append rejection, pending append, partial append, indeterminate completion, handle-close failure and mutex-release failure cannot trigger line replay.
- A deadline during partial descending rotation cannot trigger a second rotation that deletes an additional retained history row. A fully completed rotation before the append deadline is checked separately because its current-file state can permit safe recovery without another rotation. This is a coordinator-requested risk probe, not a confirmed finding before execution.
- Retry starts only after original handle closure and mutex release; the next FIFO line remains behind both attempts and `pending` counts one queued record throughout.
- Existing queue capacity, rotation/file bounds, 250-ms acquisition/hold limits, two-second flush and cancellation independence remain unchanged. A flush timeout does not unlock or retry a pending append.
- Retry/recovery signals and status counters expose the bounded attempt without leaking raw messages, paths, input/result bodies, credentials or private browser endpoints. Failed signal output cannot alter persisted write behavior.

The independent failure-phase probes will transpile the exact frozen source into fresh isolated JavaScript contexts and substitute controlled filesystem/mutex objects. They will not import live service state, invoke an operation or touch Chrome. Existing service-owned tests may create only their owned temporary directories/listeners/processes. This is same-user native fixture verification, not an OS sandbox or actual runtime acceptance.

## Final candidate and independent execution

The author froze the three-file candidate in managed `.task-evidence/server-diagnostics/retry-frozen-files.json`, with declared manifest aggregate `9204a233a9141b499f2368ec32847bc459d6d4ae1441c73095cf7629cc548d9a`. The reviewer independently verified every file hash before and after execution and inspected the full delta against the immutable native baseline, including the early changes omitted from the intermediate `a897...` observation:

| Managed service path | Final reviewed SHA-256 |
| --- | --- |
| `packages/mcp/src/diagnostics.ts` | `739d182662af6b77bfa84378ee7e4c8b593b03c7b20d6eb36380ab3d32252a40` |
| `packages/mcp/test/diagnostics.test.ts` | `10005ca85cafff0581da57558455cf412de949df72058d965e458f2591b3752c` |
| `packages/portal/DEBUGGING.md` | `d7002d65fd3c1705f98c8d9f368fbb578e8a1443a5a6cc3cd76c4437dbb13eed` |

Retry eligibility uses a module-private `WeakSet` populated only by the internal deadline factory. The first catch consumes that exact object identity. The transaction separately disqualifies any error after append issuance or incomplete rotation; handle-close and mutex-release failures remove any marker and override a pre-write expiry. Successful cleanup precedes the fixed 10-ms background delay and one second `appendTransaction` call. The second call is outside the retry catch, so it cannot trigger a third attempt. The captured immutable row and queue position remain unchanged.

The acquisition and cooperative hold limits remain 250 ms each. The retry is a second bounded transaction, so total background work for an eligible row may include two acquisition/hold periods plus the 10-ms delay; the unchanged queue and flush limits are not a claim that the whole two-attempt row finishes within one transaction's 250 ms. Issued filesystem work still settles before unlock. `preWriteRetries`, `recoveredWrites` and bounded sanitized `diagnostics.retry` signals expose the behavior through existing health/status metadata. A recovered first attempt does not increment terminal `writeFailures`; exhausted or ineligible writes do.

The coordinator raised a partial-rotation retention risk before freeze. The author added `rotationStarted`/`rotationCompleted` phase tracking rather than assuming no append meant a completely untouched transaction. Independent controlled probes confirm that expiry after `.2` moves to `.3` prevents retry and preserves that moved history; expiry after the full rotation allows line recovery without repeating rotation. This prevents additional retry-induced history loss. It does not make baseline rotation atomic or undo a partial rotation already performed.

Executed independent checks:

| Check | Result |
| --- | --- |
| Exact three-file preflight and postflight | All hashes matched |
| Private controlled phase/privacy/queue/rotation probes | **18 passed, zero failed** |
| Actual service diagnostics and real-HTTP source suites | **18 passed, zero failed, zero skipped** |
| Actual service registration collector | MCP diagnostics: 16 unique cases; portal HTTP diagnostics: two unique cases; names exactly matched executed results |
| MCP TypeScript check | Passed |

The private probe runner transpiles the exact frozen source into fresh contexts with controlled filesystem and mutex objects. It covers genuine recovery/exhaustion, forged code/message/clone/cause rejection, authentic marker reuse after issued write/close/release, partial and pending append, unconfirmed bounded flush, cleanup failures, immutable row/FIFO/queue pressure, throwing signal output, privacy, occupied acquisition and both rotation phases. It does not start a service or Chrome, bind a real listener, read live state or write service files. Its receipt records zero real fixture filesystem writes/listener binds; only private reviewer evidence is saved.

The actual source tests additionally use their owned temporary filesystem, loopback mutex/HTTP fixtures, separately built diagnostics modules and owned child-process concurrency/crash checks. They do not connect to the owner's Chrome or existing daemon/portal. No author source file was changed by the reviewer, no dependency installation was invoked, and no package outputs or junctions were mutated.

Executed commands, from the managed service root:

```powershell
node .cache/diagnostics-retry-independent-probes.mjs 739d182662af6b77bfa84378ee7e4c8b593b03c7b20d6eb36380ab3d32252a40 10005ca85cafff0581da57558455cf412de949df72058d965e458f2591b3752c d7002d65fd3c1705f98c8d9f368fbb578e8a1443a5a6cc3cd76c4437dbb13eed
node node_modules/vitest/vitest.mjs run packages/mcp/test/diagnostics.test.ts packages/portal/test/diagnostics-http.test.ts --reporter=json --outputFile=.cache/diagnostics-retry-independent-tests-20261012.json
node scripts/collect-test-registrations.mjs --file packages/mcp/test/diagnostics.test.ts
node scripts/collect-test-registrations.mjs --file packages/portal/test/diagnostics-http.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json
```

Private managed receipts:

| Receipt | SHA-256 |
| --- | --- |
| `.cache/diagnostics-retry-independent-probes-result-20261012.json` | `7997ffce043ee0f41cbe26c7de244bd2da965730b217d34e6a0ea28de5a41a76` |
| `.cache/diagnostics-retry-independent-tests-20261012.json` | `19d2a556758e6ca65afd3e28a452e7e4ff48925c9548e7b44bc8b48e604a23cd` |

## Current disposition and limits

**Approved for exact-file integration of the three final hashes above.** No blocking finding remains in this bounded retry review. The coordinator's partial-rotation risk was addressed before freeze and verified on the final candidate; no unexecuted intermediate candidate is presented as a failed or passing runtime.

These are same-user native fixtures and controlled error-phase probes, not an OS sandbox or proof of actual loaded-runtime recovery. The earlier three missing records remain historical losses; this patch cannot reconstruct them. The source tests do not establish why the original 250-ms deadline expired under UI/whole-check load or guarantee no future queue/disk/flush loss. The logger remains bounded operational diagnostics, not a durable execution journal, and it never retries a service operation or changes retained unknown jobs.

Root retains exact integration, provenance reconciliation, a new source fingerprint, current-source whole/artifact checks and any explicitly authorized actual-runtime follow-up. Neither the earlier diagnostics acceptance nor the unchanged-source `673629...` whole check verifies an integrated retry build. The review introduces no new product decision; the broader log-viewer question remains outside this scope.
