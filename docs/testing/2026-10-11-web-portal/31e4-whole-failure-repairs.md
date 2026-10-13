# Source 31e4 whole-check failure follow-up

Date: October 12, 2026 (Asia/Seoul).

## Outcome and remaining attribution

The native module trace collector now rejects incomplete or malformed JSONL with the existing typed `PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED` error. It never skips partial records or converts them into successful evidence. The unrelated-listener negative preview fixture now accepts only failed validation without observations or that precise evidence rejection. Its positive preview, preparation, stored feedback and forged-stdout checks remain intact.

The original two diagnostics write failures **remain unattributed**. The original fixture discarded its diagnostic failure signals. The retained whole-check summary therefore cannot distinguish mutex acquisition failure, a pre-write deadline, incomplete rotation, an issued write error, or another filesystem failure. The isolated baseline and 100 repeated real concurrent writer cases passed. This is not proof that the original losses were repaired or caused by load. No speculative production logger change, deadline increase, additional retry, alternate mutex slot, or weaker zero-loss assertion was made. The test now preserves sanitized failure signals and checks confirmed flushes and durable rows, so another failure can identify its phase.

## Instructions, source and ownership

This work follows [repository instructions](../../../AGENTS.md), the shared analysis policy, [the existing diagnostics retry review](server-diagnostics-retry-review.md), and [the earlier independent diagnostics review](server-diagnostics-independent-review.md). The root exclusively controls native integration, live Chrome, service processes and state. This author used no live service, source Chrome, credentials, approval automation, external browser tools, Docker, alternate browser engine or Superpowers skill.

The immutable baseline supplied by the root is `sha256:31e47b614fbc093b160d562e7b4107a4c1ad473965237b086f100663bb4f5ef5`. The preserved whole check reported **5,348 passed, two failed, 20 skipped, 5,370 total**. Its earlier type/lint/format/contract/build checks passed, but its test and ledger checks failed. The fixed source-epoch artifact value is `1791202532`; it was not changed or used to reset any runtime deadline.

The four originally owned managed files already matched current main/native exactly. Both managed and native-before bytes were preserved privately before editing; no stale refresh was required. A new focused collector test was added within the authorized extra-test scope. Changes exist only in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline`:

| Service-relative path | Native before SHA-256 | Final SHA-256 | Integration disposition |
| --- | --- | --- | --- |
| `packages/mcp/src/diagnostics.ts` | `739d182662af6b77bfa84378ee7e4c8b593b03c7b20d6eb36380ab3d32252a40` | Same | Unchanged validation dependency, not a repair delta |
| `packages/mcp/test/diagnostics.test.ts` | `10005ca85cafff0581da57558455cf412de949df72058d965e458f2591b3752c` | `e92132efbd5d93062ec779010f277cda8d083dde8f4d3693fed54a7b84190325` | Changed test |
| `packages/mcp/src/portal/native-module-fence.ts` | `36dee4088aa59673b3f72815482fea6f3ab6d84f5659bacb571ee2e38c7dd7ee` | `277256620d5bf2056bf10071f6f3ec727d45d7ddcfbffbf9e1f534ce9ffdd2df` | Changed production collector |
| `packages/mcp/test/portal/preview-native.test.ts` | `8f52b764de18a7285fb12c27a74255e74852902ac2feb754de2b82c9011d72bd` | `8bdc84e5f586b5fa01f6379041a7bf4159f3190a0e316dfb9095b11c58d64773` | Changed negative-case contract |
| `packages/mcp/test/portal/native-module-fence-evidence.test.ts` | Absent | `90f364232fc2ad04a67d1a77ad41457231e4aee8c58a792675b7cafb04ac7d69` | New focused unit/process test |

This report is the only portable Markdown addition by this author. Other agents' CLI, portal, debugging-guide, catalog, provenance and canonical-analysis files were not edited.

## Evidence and diagnosis

The preserved [whole-check summary](full-source-31e4-test-failed/test-summary.json) records:

- Diagnostics test `keeps the file cap when two independent loggers append to the same state concurrently`: expected zero write failures, observed two. Both logger instances used `signal: () => {}`, so the failure code was not retained by that test. The summary proves lost records, not their phase or cause.
- Preview test `executes a prepared owned worker through NativeWork and ignores forged stdout reports`: `SyntaxError: Unexpected end of JSON input` from collector line 271. The failing call at test line 366 belongs to the deliberate `unrelated-listener` rejection case after the positive preview and forged-profile checks. It is not a positive preview acceptance failure.

The [native runner](../../../service/packages/mcp/src/portal/native-runner.ts) awaits child closure, termination and control finish before calling `collectEvidence`. The [verified preload](../../../service/packages/mcp/src/portal/native-module-fence-source.ts) synchronously appends newline-terminated records. A process stopped during append can leave a permanent empty or partial trace even after actual closure. The previous collector trimmed bytes and called raw `JSON.parse`, leaking an untyped SyntaxError for partial content and accepting some noncanonical frames. Waiting arbitrarily cannot finish a terminated producer's missing bytes.

The exact original trace bytes were not retained in the whole-check report. The specific empty-versus-truncated framing is therefore unknown. A controlled owned Node producer now demonstrates the mechanism: it writes a valid start record followed by a partial module record, acknowledges that write, is terminated, and is awaited through `close`. Collection then rejects the present partial evidence, including when evidence is optional for a failed command. No process or trace is replayed.

## Implemented behavior

[The collector](../../../service/packages/mcp/src/portal/native-module-fence.ts) retains its existing policy/preload hashes, path/link checks, eight-MiB trace limit, 16-MiB total limit, module inventory verification and generated-file receipt checks. Before parsing it now requires nonempty newline-terminated bytes, decodes UTF-8 strictly, and requires every JSONL record to be a non-null, non-array object. It preserves a leading BOM for the JSON parser to reject instead of silently discarding it. Malformed framing, invalid bytes and invalid records produce the existing typed evidence-changed error. Valid start-policy/protocol checks and violation errors keep their earlier behavior. Optional collection can still return undefined when no trace exists, but cannot discard a present invalid trace.

[The preview test](../../../service/packages/mcp/test/portal/preview-native.test.ts) recognizes two safe outcomes for its deliberately unowned server: `runtimeVerified: false` with no observations, or precisely `PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED` with no accepted result. Arbitrary rejection codes and successful runtime verification fail the assertion. No production job classifier, operation fence, cleanup protocol or deadline changed.

[The diagnostics test](../../../service/packages/mcp/test/diagnostics.test.ts) retains `writeFailures === 0` and the file-size cap. It additionally captures the existing sanitized failure signals, requires both bounded flushes to confirm completion, requires exactly one written row per logger, and verifies both request IDs exist in retained JSONL. Failure signals appear in assertion evidence; successful pre-write retry/recovery signals do not falsely fail the test. The production logger remains byte-identical to 31e4, including privacy projection, bounded queue, rotation, mutex acquisition/hold limits and the single privately authenticated pre-write retry. Issued, partial or indeterminate writes are still never replayed.

## Executed verification and failed setup

A private service source copy was made from current main, excluding dependency trees and generated cache/dist directories, then overlaid with only the owned candidate paths. Existing real native dependencies were linked read-only in intent. Tests, config, outputs and bundles used the private copy's source and owned cache/temp locations. Native dependency package contents were not installed, rebuilt or edited.

The first fixture startup failed before any test because package-local dependency links were initially missing, leaving plugin-vue unresolved. The default Vite config loader also generated a config bundle under the existing dependency junction's `.vite-temp`. That unintended generated-cache write was reported to the root. The setup was corrected by adding package-local dependency links and using an explicit private `.mjs` config, native config loader and private `cacheDir`. All subsequent fixture config/cache/output paths were private. The setup failure is not product failure evidence, and this report does not claim that the initial attempt made no dependency-cache writes.

Commands ran from `service/.cache/31e4-whole-failure-repairs/main-fixture/service`:

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/focused.config.mjs --configLoader native --reporter=json --outputFile=.cache/31e4-baseline-instrumented-r1.json
node node_modules/vitest/vitest.mjs run --config .cache/cap-stress.config.mjs --configLoader native --reporter=json --outputFile=.cache/31e4-cap-stress-r1.json
node node_modules/vitest/vitest.mjs run --config .cache/candidate.config.mjs --configLoader native --reporter=json --outputFile=.cache/31e4-candidate-final-28.json
node node_modules/typescript/bin/tsc -p packages/mcp/tsconfig.json --noEmit
node node_modules/.pnpm/oxlint@1.80.0/node_modules/oxlint/bin/oxlint packages/mcp/src/portal/native-module-fence.ts packages/mcp/test/diagnostics.test.ts packages/mcp/test/portal/preview-native.test.ts packages/mcp/test/portal/native-module-fence-evidence.test.ts
node node_modules/.pnpm/oxfmt@0.65.0/node_modules/oxfmt/bin/oxfmt --check packages/mcp/src/portal/native-module-fence.ts packages/mcp/test/diagnostics.test.ts packages/mcp/test/portal/preview-native.test.ts packages/mcp/test/portal/native-module-fence-evidence.test.ts
```

Results:

| Run | Result | Scope |
| --- | --- | --- |
| Instrumented 31e4 baseline | 17/17 passed, zero skips | Existing diagnostics and real owned Chrome preview; no product change |
| Repeated baseline concurrent cap probe | 100/100 selected cases passed | Real filesystem/OS mutex, 15 other registrations explicitly filtered and reported as skipped |
| Intermediate candidate | 26/26 passed | Initial nine collector boundary registrations |
| Intermediate candidate with actual producer case | 27/27 passed | Subsequently fixed test-only ForkOptions declaration mismatch |
| Final exact candidate | **28/28 passed, zero skips** | Diagnostics 16, owned Chrome preview one, collector evidence 11 |
| Final static checks | Passed | MCP typecheck and owned changed-file lint/format |

An intermediate lint check rejected Vitest's extra assertion-message argument and reported a shadowed callback name. The test now uses a normal one-argument assertion object containing safe failure signals, and the callback name is distinct. The actual child test initially used inline `windowsHide`, which Node's ForkOptions declaration omits; it now uses the existing project pattern `ForkOptions & { windowsHide: boolean }`, preserving the runtime option. All failures and intermediate test receipts remain distinct. A direct decoder probe also verified that the default TextDecoder strips a BOM; explicit preservation and its negative test prevent that newly permissive parse path.

The final collector cases cover empty content, a parseable header without its newline, a truncated second record, invalid complete JSON, a blank record, null/array records, invalid UTF-8, a leading BOM, complete valid framing followed by violation/policy tampering, and actual producer closure with a partial record. No incomplete record is ignored. The Chrome preview used the service's existing installed-Google-Chrome path and owned headless worker. It did not connect to the user's source Chrome.

## Frozen handoff and next gates

Private evidence is under managed `service/.cache/31e4-whole-failure-repairs/`:

- `before/before-files.json` and the managed/native-before copies preserve all four original file hashes and bytes.
- `original/test-summary.json` and `original/report.json` preserve the 31e4 failed whole-check evidence.
- `frozen-files.json`, SHA-256 `8fd1ea4b2fa11e434ade2fae945b8b8387c7305ed70a832ff379481de09ac02f`, binds four changed files, one unchanged validation dependency, before hashes and all test-receipt hashes.
- `candidate.patch`, SHA-256 `d14e48cd994363bff7211b8c05617723497e96ab54e8361c510b959910e08b19`, contains only the four changed paths against exact native-before bytes. The first generated new-file header failed the read-only apply check. Its patch and manifest were preserved as `candidate-patch-invalid-header-r1.patch` and `frozen-files-pre-patch-correction.json`; correcting that private header changed no candidate source. Read-only `git apply --check` against current main/native then passed.
- `main-fixture/service/packages/mcp/.cache/31e4-candidate-final-28.json`, SHA-256 `3604e60e57e794a259bcd8b1f725af3ae90bb17a662b4f511a5f0ec829a08fc3`, is the final exact focused receipt. All original native-before hashes and final fixture/managed hashes matched again at freeze.

Source files are frozen for independent review. Root-owned integration and a new full source-bound check remain required. Another concurrent-logger failure must retain the new safe failure signals and be diagnosed from that phase before changing logger policy. The old two losses cannot be recreated by a later retry and stay recorded as failures. No full-source pass, complete Figma acquisition, frontend acceptance, OS sandbox, cross-user protection, live service recovery, or safe operation replay is established by these fixtures. Existing unknown-operation fences and product deadlines remain unchanged.
