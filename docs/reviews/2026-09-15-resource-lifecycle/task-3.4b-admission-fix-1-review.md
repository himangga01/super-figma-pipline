# Task 3.4b admission fix 1 review

## Verdict

Pass for the scoped admission correction. Finding A1/P2 is resolved by the reviewed bytes. No additional actionable admission defect was established in the correction or nearby cancellation compatibility paths. The independent lifecycle reviewer owns the lifecycle CAS and broker ACK corrections. This is not a whole-service completion or release approval.

## Reviewed correction

Read the fix report, six-file correction manifest, refreshed 20-file integration manifest/diff, corrected executor, and committed-to-review regression tests. Traced the approved-resumption handshake through both cancellation entrypoints, queued dispatch, failure settlement, and the single cached finalization path.

`executeApproved` now creates `reservationPreparation` before asynchronous reservation work starts. Successful preparation attaches the actual durability object before resolving this handshake and before the post-reservation observer. `performPreDispatchCancellation` waits for that ownership result, so a cancellation during late reservation attachment cannot declare settlement while the actual reservation remains unknown to it. The original failure boundary now shares the same cached cancellation settlement as resumed execution; the cancelled queue-transition failure also reuses it. An already aborted approved operation is checked before fresh reservation work.

The reservation failure branch retains its existing explicit failure settlement and rejects the attachment handshake after that branch finishes. The correction does not turn a failed reservation into successful cancellation evidence or run project code after cancellation.

## Independent verification

Ran from the isolated service directory:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/execution/operation-executor.test.ts --maxWorkers=1
```

Result: **31 tests passed**, one file, exit 0; total duration 3.31 seconds. This independently covers both new real-store attachment cases and existing executor approval, queued cancellation, durability, replay, and demotion cases.

The two new boundary regressions use actual OperationJournal, EgressManifestStore, and OperationEvidenceReceiptStore. Both verify zero runtime calls, cancelled terminal status, exactly one egress finalization, exactly one evidence reservation release, and a real `final` egress state. The late-attachment case pauses the actual reservation return after it has persisted, requests cancellation, and then permits attachment. This covers the defect beyond merely moving the diagnostic observer.

The old failing diagnostic remains preserved as `.test.ts.disabled`; it was not re-enabled or edited. No source or test edits were made during this re-review. No daemon, browser, dependency, build, Git index, commit, or push operations were performed. Native validation uses the ordinary Windows account permissions and is not an OS sandbox.

The reported broader 108-test pass belongs to implementation/main verification; this reviewer does not claim to have independently repeated that sweep.

## Exact review authority

All six correction files and all 20 integration files matched their respective manifests immediately before reporting; zero mismatches. The two admission-specific reviewed bytes are:

| Path | SHA-256 |
| --- | --- |
| `service/packages/mcp/src/execution/operation-executor.ts` | `6b1ebe80e41e9665e88c121c30d66e22de6ca5b5904deb7b04659a55bfca4eea` |
| `service/packages/mcp/test/execution/operation-executor.test.ts` | `171b04fc597d6ca8548dbc1a1f596a02824c210c4c5fec0e7c8ffac022f03b4b` |

- Correction manifest SHA-256: `8429999a84e37f663cb2becb26518800d273597129be90929d545a4430d02c43`.
- Full integration manifest SHA-256: `53ae16db19a84069d00adb74b346b28316a54198de05708f3e375533662d47ba`.
- Refreshed full review diff SHA-256: `3e7660d8df0820d2d4f09412f49b60cb7f65f71e5762fcacd3b554a04385e06f`.
