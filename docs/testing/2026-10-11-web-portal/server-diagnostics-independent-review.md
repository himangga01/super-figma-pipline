# Independent server diagnostics review

Review date: October 12, 2026 (Asia/Seoul). This review supplements the [implementation record](server-diagnostics-implementation.md), [canonical service analysis](../../service-analysis.md), and [repository instructions](../../../AGENTS.md).

## Reviewed baseline and purpose

The protected main/native service baseline is `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`, at published main HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with existing uncommitted integration work. The reviewer operated only on source in the managed copy and owned temporary fixtures. No native/main service code, live process, service policy, source Chrome connection, retained job or user files were modified. This English documentation file is the review handoff.

The initial candidate's 17-file manifest is `.task-evidence/server-diagnostics/frozen-files.json` under the managed repository root, with manifest fingerprint `edfaaa3f47dabb129dd12d43c74257d42cd92deaa400bec8b9d3c67bf11d3bb4` and managed source snapshot `sha256:7e8a0c390ff9ad09ba6414d889af710b4b41df9ac09356710f83c2273d3ddd57`. All 17 exact file hashes were independently verified before executing tests. The snapshot includes shared managed-copy contents; it is not an integrated source or whole-check acceptance baseline.

The feature adds asynchronous JSONL operational diagnostics to the portal, imported public CLI and private daemon. Its authority remains separate from user activity, durable service jobs, operation approval and unknown-outcome recovery. A request/job ID helps correlate evidence; it cannot establish execution or authorize an operation.

## Confirmed findings

**D1: legitimate writers sharing one component filename can exceed the documented file limit.** `Diagnostics.append` reads the current byte length and later opens/appends without coordination between separate logger instances. The queue protects only one instance. Two instances using the same state root and `daemon` component independently observed a file below their 4,096-byte limit, then appended records. The resulting file was **4,156 bytes**, reproduced on the first owned probe attempt. No symlink, path replacement, malformed setting, excessive payload or untrusted filesystem actor was used.

This has implemented runtime relevance: `packages/mcp/src/index.ts` constructs a logger at the shared state root before leader/follower election; each daemon process records `daemon.ready` and `daemon.stopped`. They use the same `diagnostics/daemon.jsonl` path. Therefore independently queued writers can coexist even if only the leader serves HTTP. The debugging guide says each file is limited to 1 MiB. The same inspect/append race applies at that default boundary.

Repair legitimate writer ownership or coordination, then repeat both the existing single-writer checks and an independent concurrent-writer probe. A same-user path-replacement disclaimer does not describe this ordinary software concurrency failure. No reviewer source edits were made; the author and coordinator received the finding and reproducible evidence.

**D2: the real compiled CLI failure frames are omitted.** The stack parser accepts only lowercase module characters and catalog-exact filenames. The existing native public CLI contains the generated chunk `commands-CSukwD4X.mjs`. A guarded invocation of that already built CLI's `executeServiceFeature('chrome.tabs')` with a malformed Figma URL threw `ERR_INVALID_URL` in the URL parser before Chrome discovery or any service request. Its useful error frames were `commands-CSukwD4X.mjs` at `8613:14`, `20520:30`, and `75623:24`. The candidate projection dropped all three and retained only the outer `library.mjs:455:2` dispatch frame. A synthetic frame with the same valid generated filename also dropped.

The coordinator requested this actual built-code check before approval. Repair safe recognition of closed bundle families while hashing unknown suffixes rather than exposing arbitrary filenames. Preserve useful module-family and line/column information and the existing omission of paths, function names, URLs and error messages. Add a meaningful built-chunk regression and rerun the already-built CLI callback probe.

The first exploratory owned full-CLI bundle fixture failed to import because its simplified build configuration incorrectly bundled Playwright's package code and encountered `__dirname` in ESM. That was a fixture setup failure; it did not execute a Chrome action. The corrected probe uses the already built native public CLI, as the coordinator requested, and builds only the candidate diagnostics module into owned temporary output. It does not build or modify native/managed package outputs, discovery records, live state or browser connections. The probe returns only safe module basenames and line numbers rather than printing raw stacks.

## Verified behavior

- All 17 frozen hashes matched before review execution.
- The two new source test files passed **7/7**, with zero skips: private error/cause projection, queue/rotation and failure signals, hostile error getters, distinct built-bundle context, and real portal/daemon HTTP correlation.
- An independently built diagnostics module passed seven additional checks: frozen hashes, closed-label/body/cause/URL privacy, 30 overlapping asynchronous request/job contexts, rejection of invalid correlation header hints, single-writer queue/rotation bounds, refusal of multiply linked log files, and refusal of a Windows directory junction. Owned target files/directories remained unchanged in the link probes.
- Unknown event/function/phase/outcome strings were hashed rather than copied. A known message prefix remained readable as `CHROME_CDP_INVALID`; its arbitrary message suffix, body, header and private WebSocket input did not appear in the persisted record. Cyclic causes stopped without repeating data.
- The packaging hermetic fixture passed **2/2**, including actual archive creation with `DEBUGGING.md`. Static package metadata and archive scripts both include the guide. This verifies the owned fixture and packaging mechanism, not current integrated release artifacts.
- Static inspection confirms the process-wide asynchronous context is shared across separately built portal/CLI bundles. Headers retain only syntactically valid UUID hints; they do not confer service authority. The CLI records the daemon's own response ID separately from the portal's parent ID.
- Source and tests preserve cancellation/execution results when diagnostic writes fail. Portal close flushes the bounded queue before invoking the Node close callback. The daemon flushes after its existing orderly teardown under the existing hard-exit backstop. Abrupt termination can still lose queued operational records.

The initial review therefore has **one confirmed blocking finding** despite passing existing source and packaging fixtures. It is not approved for integration yet.

## Revision 2 runtime recheck

The author retained the original manifest as `frozen-files-v1.json` and supplied `frozen-files-v2.json`, with fingerprint `4712f2a384287d04c95be3e723b4bc026d1f8b33bfbde66139a58a97246afd90` and managed source snapshot `sha256:5c04bd15efc467d2571ea0cc3d263a7c76d9aeba1d3b8b3ed793d346e8389a39`. The runtime logger now serializes append and rotation through one deterministic, exclusive loopback TCP mutex slot derived from the canonical directory and component. A collision or unavailable slot fails logging with an observable counter; it never chooses another slot or closes a foreign holder. The OS releases the slot when an owned holder process terminates. An issued filesystem mutation keeps ownership until it settles. `flush` separately reports an unconfirmed bounded wait rather than releasing a mutex while a write is still pending.

The coordinator separately requested a portable closed-catalog generator. Its authorized guide update changed `packages/portal/DEBUGGING.md` before the review's full 17-file preflight. That preflight stopped before any test on the guide hash mismatch. This was documented snapshot drift, not a runtime failure. Under the coordinator's instruction to begin runtime review while the guide/generator revision was pending, the reviewer verified the **remaining exact 16 runtime/packaging file hashes** against the preserved revision-2 manifest and explicitly excluded the changing guide.

The revised independent runner passed **nine probes**, including twelve iterations with two logger instances sharing one file and four coordinated runs with two actual owned Node processes. Every log file remained at or below 4,096 bytes; both current process request IDs were retained in the bounded rotations. The original failing receipt was not overwritten. The new runtime receipt is `.cache/diagnostics-independent-probe-v2-runtime-result.json`.

The two revised source test files then passed **13/13**, with zero skips. This run includes strict same-process/process writer bounds, the foreign-holder and owned-crash paths, a held filesystem write with an unconfirmed flush, cause/context privacy, public catalog coverage, independently built correlation bundles, and real portal/daemon HTTP behavior. Its receipt is `.cache/diagnostics-independent-revised-tests-20261012.json`.

**D1 is repaired in the reviewed revision-2 runtime. D2 remains blocking.** Final approval requires the built-frame repair, a complete revised manifest, guide/generator review and final hash verification. The original failing candidate and its misleading hard-bound behavior remain historical evidence.

## Final revision 3 approval

At 02:08 KST, the reviewer verified **all 18 exact file hashes** against `frozen-files-v3.json` and the active manifest. Its fingerprint is `e0f127bcb3b99872c85ff0d4d44fee7ec71e65b11442705b0b5f44696979ceb4`, superseding revision 2. Its managed source snapshot is `sha256:c090392cfbc62b6538747a03ef0adfbcfb8830da5a73dcdb4815c9e135ab1371`; it still describes the shared managed copy, not an integrated native whole-check baseline.

The revised logger, closed catalog, guide and new `scripts/update-diagnostics-catalog.mjs` were included. The catalog generator reads production source labels plus actual registered feature/tool inventories, excludes tests/fixtures/caches/dependencies/self, and offers a nondestructive `--check`. Static review found no feature execution, browser connection, credential/log/result read, or dependency installation in that path. The documented check passed and public catalog coverage includes all 186 entries. One reviewer invocation used the guessed filename `generate-diagnostics-catalog.mjs` and failed before execution with `MODULE_NOT_FOUND`; the corrected documented command ran successfully. That command mistake does not establish a generator defect.

The full independent runner passed **nine checks**, including strict same-process and four coordinated two-process writer runs, privacy, 30 overlapping contexts and owned hardlink/junction fixtures. Its final receipt is separate from the original failing D1 receipt.

The already built native CLI callback probe repeated the malformed URL failure before any Chrome discovery. The projection now retains all three useful frames as `module:"commands.mjs"`, a stable `chunkHash`, and the original `8613:14`, `20520:30`, and `75623:24` positions. The generated hash suffix and absolute path are omitted. The synthetic uppercase chunk case also retains its position. Closed source-family recognition and hashed suffixes preserve useful built locations without copying arbitrary filenames. **D2 is repaired.** The original omitted-frame receipt remains preserved.

The final new source suite passed **14/14**, with zero failures or skips. This adds the built-chunk projection regression to the earlier 13-case revision-2 suite. The independently executed packaging fixture passed 2/2 earlier; its packaging source/test hashes were unchanged and matched the final manifest. This review does not replace the author's broader 236-case source checks or establish newly built integrated artifacts.

**Approved for exact-file integration: the 18 files in revision-3 manifest `e0f127bc...`.** Both blocking findings were repaired and independently rechecked. No author-owned source file was changed by the reviewer. Integration, provenance reconciliation, new integrated-source checks, owned runtime restart and actual retained-tab diagnostic acceptance remain the coordinator's responsibility.

## Evidence and commands

Private managed-service evidence:

| Receipt | SHA-256 |
| --- | --- |
| `.cache/diagnostics-independent-probe-result.json` | `0410e602a5d9c1a7511ed67aa940b2faa04a77cd6ed6afab9d40425c98611691` |
| `.cache/diagnostics-independent-existing-tests-20261012.json` | `3777c8828c44468f3add2e83d83315801c450649c9f1067d301471d8ca20a762` |
| `.cache/diagnostics-independent-packaging-20261012.json` | `1e55f6ae2992fbb017d5331f55c9eebb6cc7fa09f78f90f56741174ae1a98fb4` |
| `.cache/diagnostics-independent-probe-v2-runtime-result.json` | `aa300237e94a2de710e25506ebf32ed40340945bea2ca9ec4d77628910201583` |
| `.cache/diagnostics-independent-revised-tests-20261012.json` | `ee1fc861ea25e5e5430c8cc037934996e1e148fc282e3b531c02bc975d060d75` |
| `.cache/diagnostics-built-stack-probe-result.json` | `cf3a1509b93893e77ed0ad12ff7433a19d3dceb246f669da0525e9add2ef1bd8` |
| `.cache/diagnostics-independent-probe-final-result.json` | `4cf2362bd756c12952843f6350c1df8269fb6364053575060266c1cf4f4d51aa` |
| `.cache/diagnostics-built-stack-probe-final-result.json` | `bdf820d8dac33383fe8c8e71c75d5a4645ef5123cf7b2aaf7d009c93c22ae124` |
| `.cache/diagnostics-independent-final-tests-20261012.json` | `418930d7be5d7a8adba9522c42f5d70ffb0c137646dece4f71d5a3f6300789f8` |

The reproducible independent runner is `.cache/diagnostics-independent-probe.mjs` in the managed service. It builds only the diagnostics module into a newly owned temporary directory, checks frozen hashes first, runs probes, records results, verifies the resolved cleanup path remains under the system temporary directory, and removes only that owned fixture. It neither starts Chrome nor imports live daemon state.

Executed source commands:

```text
node .cache/diagnostics-independent-probe.mjs
node node_modules/vitest/vitest.mjs run packages/mcp/test/diagnostics.test.ts packages/portal/test/diagnostics-http.test.ts --reporter default --reporter json --outputFile .cache/diagnostics-independent-existing-tests-20261012.json
node node_modules/vitest/vitest.mjs run test/package-artifacts-hermetic.test.ts --project root --reporter default --reporter json --outputFile .cache/diagnostics-independent-packaging-20261012.json
node .cache/diagnostics-independent-probe.mjs diagnostics-independent-probe-final-result.json
node .cache/diagnostics-built-stack-probe.mjs diagnostics-built-stack-probe-final-result.json
node --experimental-transform-types --disable-warning=ExperimentalWarning scripts/update-diagnostics-catalog.mjs --check
node node_modules/vitest/vitest.mjs run packages/mcp/test/diagnostics.test.ts packages/portal/test/diagnostics-http.test.ts --reporter default --reporter json --outputFile .cache/diagnostics-independent-final-tests-20261012.json
```

The probe runner retained the failed writer-bound check in its result JSON. Its process exit was zero because it completed collection and cleanup; the individual `passed:false` result is the finding. That exit status must not be summarized as all probes passing.

## Limits and continuation

These are source fixtures and independent owned probes under the same Windows user, not an operating-system sandbox. The new writer's documented link/type/link-count checks are best effort under existing state-directory protection. They do not establish complete same-user path-race protection equivalent to the service's hardened atomic-file authority. Existing human-readable log callbacks retain their earlier behavior; the new closed-projection privacy guarantee applies to the JSONL logger and its own failure signals.

No actual retained-tab failure has been correlated with a newly running diagnostic build. No integrated-source whole check or current packaged artifact verification has run for this increment. The reviewer did not establish official MCP authorization, design capture, source generation, application or frontend acceptance.

Integrate only the approved exact revision-3 files, then verify the new source and newly packaged artifacts. Preserve both earlier manifests, passing checks, failed preflight, failed writer probe and compiled-frame omission. The coordinator retains canonical analysis updates, actual retained-tab acceptance and final integration/source verification. A broader public log viewer remains an open product question outside this bounded feature.
