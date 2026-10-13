# Native contour preview fixture reset diagnosis and repair

Date: October 13, 2026, Asia/Seoul. This test-only causal repair is independently reviewed and integrated; its fresh whole check remains pending.

## Failed baseline and evidence limits

Main/native source `sha256:f8d76e71e491a1df5f5a3b468c705dab8e6645a5e3476e93d07d2f90e8fccf4a` failed whole attempt `db9bbfee-f588-4252-9758-c2d659aa6fe4`. Its 484 registered files ran 5,784 cases: 5,764 assertions passed, zero test assertions failed and twenty existing skips remained. One unhandled `ECONNRESET` caused process exit 1 and strict test-ledger failure. The test phase lasted 1,425,583 ms. [The preserved failure checkpoint](source-url-f8-failed-20261013/failure-checkpoint.json) remains failed; assertion success is not a whole pass.

Vitest associated the error with `preview-native-contours.test.ts` and the last active ancestor-compositing case. The stack was `TCP.onStreamRead`, with `code:ECONNRESET`, `syscall:read` and Windows errno `-4077`. The whole run did not capture the emitting socket identity, so its exact historical socket cannot be proven retrospectively.

Repository instructions and shared analysis policy were read. Diagnosis used a regular copy of exact current source, installed Google Chrome in isolated headless mode, and the service's own contour observer. No source Figma/portal Chrome, live daemon, state, grants, unknown outcomes, Main/native source or C2 files were changed. No Codex browser tool, Docker, installation or build through dependency junctions was used.

## Causal isolated reproduction

Original preview test SHA-256: `76f84fc168d443397c44198cc8ac6c2c1bee0b75e514843670dfe1de215f20ba`. Its owned proxy allowed only GET to the exact local fixture origin. On denied HTTP CONNECT, it called `socket.end(403)` after Node detached the normal HTTP parser. It attached no error listener to that upgraded socket and did not retain it for teardown.

An unmodified single ancestor case passed with exit 0, one pass and three filtered cases. A separate diagnostic setup then connected a real TCP peer only to that owned proxy, sent CONNECT for a denied hostname and used `resetAndDestroy` immediately after the original handler ended its rejection. The proxy never connected to the requested hostname. No synthetic `error` event was emitted. `errorMonitor` observed the server event without consuming it.

The unchanged original assertions still passed, but the process exited 1. The monitor recorded `denied-CONNECT-socket`, `ECONNRESET`, `read`, zero error listeners, and `destroyed:true`/`writableEnded:true`. The JSON reporter's `success:true` did not reflect the process failure, matching the whole failure's assertion-pass/unhandled shape. This proves a fixture defect and its causal transport lifecycle. It does not identify the historical whole socket beyond that matching failure mechanism.

## Minimal one-file repair

Only `packages/mcp/test/portal/preview-native-contours.test.ts` changes. Before ending a denied CONNECT socket, the helper tracks its close promise and installs error/close listeners. It counts only `ECONNRESET` or `EPIPE` from a currently tracked socket in the explicit rejecting/closing lane as expected. Every other error adds a fixed unexpected-error tag, which is asserted empty after teardown. No raw error text is projected.

Teardown destroys and awaits remaining owned CONNECT sockets before closing the proxy/server, including when browser cleanup throws. The exact-origin GET and CONNECT denial rules remain unchanged. A new regression makes a real owned TCP peer reset at that same rejection boundary, requires the expected closing error to occur, and asserts no peer/unexpected transport error. Existing contour/pixel/accessibility acceptance assertions remain unchanged.

This does not globally ignore errors, alter Vitest/test-ledger policy, accept other origins or replace a failed run with a retry-only explanation. A source search across production MCP/portal code found no matching HTTP deny-CONNECT callback/end403 lane. Production preview routing uses Playwright interception; the accepted preview-channel socket and worker configuration lane install error handlers. That inspection supports the fixture-only scope, not a universal claim about every production transport path.

## Executed verification and freeze

Private evidence root: `.worktrees/_cache/native-preview-reset-diagnosis-20261013`.

| Receipt | Result | SHA-256 |
| --- | --- | --- |
| `original-isolated-r1.json` | 1 pass, 3 filtered, process 0 | `2c2ae42426fc158b8581342f1408c220189740cf7db87ccb615f4621b198ca1b` |
| `original-controlled-r2.json` | 1 assertion pass, 3 filtered, process 1 with real unhandled reset | `bd0017946fdb120a23160651e6dc816e007e8b4bfacb61c19ff638748d925c9d` |
| `socket-controlled-r2.jsonl` | Denied CONNECT, zero error listeners | `762e892a824f5a32a4879b340d3720e0c89092e5c134227040f910788c99d6cc` |
| `repaired-full-r1.json` | 5/5, no failures/skips, process 0 | `750612c6b968f1705c1f6ac0716f379e0187914919c2acb529b38d4c55c03574` |
| `repaired-controlled-full-r2.json` | 5/5, no failures/skips/unhandled failure, process 0 | `73755e57049a254e253ec8ddf147f92e1bcff4500f62b647e6f81f4963402003` |
| `socket-repaired-controlled-r2.jsonl` | Six real reset events, each with an error listener | `1b24fe1e06aaec314a2745d4325a0d31fc333ccc3e074ae9df066528dc11f41a` |

Full regular-copy MCP no-emit reported zero diagnostics. Scoped lint with warnings denied and formatting checks passed. The initial unused test import warning was removed before freeze; no production change was needed.

Frozen one-file manifest: `.worktrees/_cache/native-preview-reset-diagnosis-20261013/frozen-files.json`, SHA-256 `3d5e93c84a41b4c1342ec0e59a0331bfa5d10ce7d10f989ba96fddea69626c19`. Frozen test SHA-256: `3b3fd32e7adfe35dd9286decaf18a8c32d52d512161e6840074637b9338df93a`. The source root is its `work/service` directory. All original failures/monitor data remain separate and unchanged.

Repeat with a unique receipt from any terminal:

```powershell
node C:/2026_project/super-figma-pipline/.worktrees/baseline/service/node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/native-preview-reset-diagnosis-20261013/work/isolated.config.mjs --configLoader native --reporter=json --outputFile=C:/ABS/OWNED/unique-preview-reset-review.json
```

Root owns independent reproduction, the additional required Chrome registration/census, source integration, provenance, new whole/artifact gates and deployment. This bounded fixture pass does not establish a current whole pass, live CDD generation or final application acceptance.
## Root independent review and integration: 14:30 KST

Root reviewed the exact one-file freeze `3d5e93c84a41b4c1342ec0e59a0331bfa5d10ce7d10f989ba96fddea69626c19` and independently ran all five cases in its separate regular current-code copy with installed Google Chrome: **5/5 passed, zero failed/skipped, process exit zero**. The real TCP reset regression ran through the owned deny proxy. Root mechanically verified the entire original four-test assertion suffix is byte-identical; only fixture lifecycle and the new regression are changed. This approves the test-only repair without establishing the original whole's exact emitter.

[The integration receipt](preview-reset-test-integration-20261013.json) and [R25 provenance](preview-reset-r25-provenance-20261013.json) record exact hashes and limits. Alternate-index verification passes 255 semantic changes/four derived authorities, and offline upstream checks pass three upstreams/238 rows. Main/native chosen source is `sha256:1de53379d5742ccb8be95c0a7b7fc0f98528db79e846d4b2c482c641b8aeb00a`. Fresh whole `8f4753c4-e895-4751-9346-f8a6e8fb6cbb` is pending in native session 94655 with the fixed artifact epoch; no pass, artifact acceptance, replacement or frontend completion is claimed. The earlier f8 failure is preserved, with no ledger waiver.

