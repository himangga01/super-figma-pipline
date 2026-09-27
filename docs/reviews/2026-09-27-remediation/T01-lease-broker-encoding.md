# T01 evidence: lease broker encoding and helper budgets

- **Task.** T01 in the [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md). It covers OPS-1 and the lease parts of OPS-5, OPS-8 and OPS-C1. Two scope additions came from the coordinator:
  - the bare-name part of K11: pin `whoami.exe` and `icacls.exe` to `%SystemRoot%\System32`;
  - a separate startup budget for the boundary worker (a non-lease part of OPS-5).
- **Branch.** `rem/t01-lease-v2`. Base commit: `5be8cc7`.
- **Commits.** `60850d6`, `dc4815c`, `a241b52`, `17619b1`, `8334e11`, plus the commit that adds this note.
- **Date.** September 27, 2026.

## 1. Summary

The directory-lease broker now speaks protocol `windows-directory-lease-v2`:

- The wire is ASCII-only in both directions.
- The helper uses explicit BOM-less UTF-8 streams and parses each request inside its own `try`.
- Paths are opened as extended-length (`\\?\`) targets.
- The helper echoes the SHA-256 of the path bytes it received, and Node checks it.

Leases now work on the owner's Korean-locale machine, including under the real `C:\Users\강지혜\...` profile path. The boundary worker and the test-only state probes use the same stream setup. `whoami.exe`, `icacls.exe` and `powershell.exe` run from `System32` instead of PATH.

With the Korean `TEMP` and `LOCALAPPDATA`, the relevant suites went from 413 failing tests to 34 (section 6.4). No test that passed at the base commit fails consistently after the change.

## 2. Environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200, culture `ko-KR` |
| Console code page (`[Console]::InputEncoding` and `OutputEncoding`) | 949 |
| PowerShell | Windows PowerShell 5.1, `FullLanguage` |
| Node | 24.21.0 |
| Shell | Git Bash; `/usr/bin` precedes `System32` on PATH |
| ASCII variant | `TEMP=TMP=C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp`, `LOCALAPPDATA=...\_cache\localappdata-ascii` |
| Korean variant | `TEMP=TMP=C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp-한글경로`, `LOCALAPPDATA=...\_cache\localappdata-한글` |

## 3. Root cause as observed

Before any change, the real v1 broker was driven from a scratch copy of `atomic-file.ts` and `windows-directory-lease-broker.ts`, with the ASCII `TEMP`. The script under test was the unmodified code.

| Request | Observed result |
| --- | --- |
| ASCII directory | Lease granted (341 ms, including broker start). |
| Directory named `강지혜-상태` | `DIRECTORY_LEASE_ACQUIRE_FAILED: CreateFileW failed: 123` (`ERROR_INVALID_NAME`). The path arrived garbled. |
| `...\강지혜\AppData\Local` (profile shape) | `DIRECTORY_LEASE_PROTOCOL_INVALID: directory lease child exited unexpectedly`, on every attempt. |
| Raw line `{not-json` | The broker exited with code 1 and no response. |

The profile-shaped request shows the fatal case. Node sent the UTF-8 bytes `ea b0 95 ec a7 80 ed 98 9c 5c 5c 41 70 70`, which is `강지혜\\App` inside the JSON string. .NET decoded stdin with code page 949. It paired the lead byte `0x9c` with the first escape backslash `0x5c` and consumed both bytes. That left `\App`, which is an invalid JSON escape. `ConvertFrom-Json` then threw outside the per-request `try`, so the script ended and the broker died. A state root under a Korean profile path therefore makes every retained-directory lease fail.

The broker's stderr was CLIXML encoded in code page 949. It contained a "preparing modules for first use" progress record and the `ConvertFrom-Json` error. Only its byte count had been kept (OPS-8).

## 4. Design

### 4.1 Lease protocol v2

The changes are in `atomic-file.ts` (script, spawn, budgets) and `windows-directory-lease-broker.ts` (codec, validation, pool).

- **ASCII wire.**
  - Node sends `{"action":"acquire","id":<32 hex>,"pathUtf16B64":<base64 of the exact UTF-16LE code units>}`.
  - Any code unit outside printable ASCII in a request line is escaped as `\uXXXX`, as defense in depth.
  - A stdout line that is not printable ASCII is a protocol failure.
- **Explicit streams.**
  - The helper reads a `StreamReader` over `[Console]::OpenStandardInput()` and writes a `StreamWriter` over `[Console]::OpenStandardOutput()`. Both use `UTF8Encoding($false)`, and the writer uses `AutoFlush`.
  - Responses are built from validated ASCII fields. Error text goes through a helper that escapes everything outside printable ASCII.
  - The console code page is never changed (Appendix B, item 2).
- **Per-request parsing.**
  - `ConvertFrom-Json` and all validation run inside the per-request `try`.
  - Malformed input gets `{"id":"","ok":false,"error":...}`, and the helper keeps serving.
  - Node treats a response with no pending owner as a broker failure (`DIRECTORY_LEASE_PROTOCOL_INVALID`) and closes the broker.
- **Exact path handling.**
  - Node sends the extended-length form of the resolved path: `\\?\C:\...` or `\\?\UNC\server\share\...`. Paths that already carry `\\?\` or `\\.\` are kept verbatim. This is the same form that Node's `fs` opens.
  - The helper adds the same prefix when it is missing.
  - The helper copies the UTF-16 code units verbatim (`Buffer.BlockCopy`), so unpaired surrogates survive.
  - No Unicode normalization is applied, so NFD names stay NFD.
  - Empty paths, NUL characters and paths longer than 32,767 units are rejected in Node with `DIRECTORY_LEASE_PATH_INVALID`.
- **Echo check.**
  - The acquire response carries `pathSha256`, the SHA-256 of the UTF-16LE bytes that the helper received. The helper reuses one FIPS-compliant `SHA256CryptoServiceProvider`.
  - On a mismatch, Node rejects the acquire and closes the broker with `DIRECTORY_LEASE_ECHO_MISMATCH`. Closing the broker also releases the handle to the unexpected path.
- **Budgets (the lease part of OPS-5).**
  - Startup (READY) and requests have separate budgets: 30 s for startup, 10 s per request. Shutdown and force-kill stay at 5 s.
  - `maxCommandBytes` is now 131,072. A 32,767-unit path is 87,380 base64 characters.
  - `maxLineBytes` is now 16,384.
  - The pool retires the broker after 10 minutes with no held or in-flight lease.
  - The pool also recycles an idle broker once it has used half of its lifetime stdout cap (4 MiB). Before this change, a long-lived broker would fail a lease in progress after about 16,000 leases (v2 sizes).
- **Stderr (the lease part of OPS-8).**
  - The first 4 KiB of stderr is kept as raw bytes. Broker failures carry `stderr`, `stderrBytes` and `stderrBase64`, and their message ends with an excerpt.
  - For CLIXML, the excerpt keeps only the error stream and decodes `_xHHHH_` and XML entities.
  - The raw bytes stay available because PowerShell's own host writes stderr in the OEM code page.
- **Restricted hosts (the lease part of OPS-C1).**
  - The helper checks `$ExecutionContext.SessionState.LanguageMode` before anything else. Outside `FullLanguage`, it prints `RESTRICTED language-mode <mode>` instead of READY.
  - An `Add-Type` failure prints `RESTRICTED add-type <base64 UTF-16LE message>`.
  - A child that exits before READY with `ScriptContainedMaliciousContent` on stderr is classified as blocked by antivirus (AMSI).
  - All three raise `HOST_POWERSHELL_RESTRICTED`. No lease-less fallback exists.
- **Versioning.**
  - The protocol literal is `windows-directory-lease-v2`, and the READY line carries it.
  - The artifact schema accepts both `-v1` and `-v2`. `verifyNativeArtifactAuthority` rejects a stored `-v1` directory-lease authority with `PORTAL_ARTIFACT_REPREPARE_REQUIRED` before recomputing anything. Previously it would have been a raw `ZodError` or a misleading `PORTAL_ARTIFACT_CHANGED`.
- **Module fence.**
  - The spawn keeps the shape that the fence admits: `spawn(executable, args, { stdio: ['pipe','pipe','pipe'], windowsHide: true })`, with five args. `native-module-fence-source.ts` therefore needs no change.
  - A new fenced test runs the exact v2 invocation from inside the fence and completes an acquire and release on a Korean-named directory.

### 4.2 Boundary worker and test-only state probes

- **Boundary worker** (`windows-boundary-probe-worker.ts`).
  - The worker no longer changes `[Console]::InputEncoding` or `OutputEncoding`. It uses the same explicit reader and writer as the lease helper.
  - Requests carry `pathsUtf16B64`, and records return `pathUtf16B64`. Node decodes them back to `{ path, attributes, sddl? }`.
  - Responses escape non-ASCII error text only when present, and non-ASCII output is a protocol failure.
  - Default caps grow to cover the base64 expansion: 1 MiB per request, 4 MiB per response line.
  - Paths are converted with static .NET calls, because a PowerShell function call per path had doubled request latency (section 7). An unpaired surrogate decodes to U+FFFD, so Node's exact path comparison fails closed.
- **Test-only probes** (`state-permissions.ts`), used only with an injected command runner.
  - Paths go in through `SFP_STATE_ACL_TARGET_UTF16B64` and `SFP_STATE_BOUNDARY_PATHS_UTF16B64` (base64 UTF-16LE) and come back as `pathUtf16B64`.
  - The output is written through an explicit BOM-less UTF-8 `StreamWriter`.

### 4.3 K11 bare-name part (scope addition)

- The production runner in `state-permissions.ts` resolves `whoami.exe`, `icacls.exe` and `powershell.exe` under `%SystemRoot%\System32`, falling back to `windir`. It never searches PATH.
- It fails closed with `STATE_ACL_COMMAND_FAILED` when that root is missing, not absolute, or contains control or quote characters.
- It does not cache the SID; SID caching belongs to T11.
- Tests that call `whoami.exe` or `icacls.exe` directly now use the `System32` path.

### 4.4 Boundary worker startup budget (scope addition)

- READY has its own budget, `startupTimeoutMs`, which defaults to 30 s. The 5 s per-request budget is unchanged.
- Queued requests default to a deadline of the startup budget plus one request budget (35 s), so they survive a cold start just as the first request does.
- Idle retirement defaults to 10 minutes instead of 5 s.

## 5. Files changed

Paths are relative to `service/packages/`.

| File | Change |
| --- | --- |
| `mcp/src/fs/windows-directory-lease-broker.ts` | Protocol constant, path codec, ASCII request lines, response and echo validation, `RESTRICTED` handling, stderr retention, separate startup budget, pool idle retirement and stdout-budget recycling. |
| `mcp/src/fs/atomic-file.ts` | v2 helper script, the invocation's protocol literal, broker budgets, pool options. The spawn shape is unchanged. |
| `mcp/src/portal/native-artifacts.ts` | Schema accepts v1 and v2; stored v1 fails with `PORTAL_ARTIFACT_REPREPARE_REQUIRED`. |
| `mcp/src/fs/windows-boundary-probe-worker.ts` | Explicit streams, ASCII wire, larger default caps, startup budget, queue and idle defaults. |
| `mcp/src/security/state-permissions.ts` | System32 pinning; ASCII wire and explicit UTF-8 output for the test-only probes. |
| `mcp/test/fs/windows-directory-lease-broker.test.ts` | Fake children moved to v2. New codec, echo, restricted-host, stderr, budget, idle and recycling tests. New real-broker tests on Windows, including the soak. |
| `mcp/test/portal/native-artifacts.test.ts` | Schema literal test; stored v1 authority maps to the typed error through a signed store round trip and the runner. |
| `mcp/test/portal/preview-lease.test.ts` | Fenced positive test: the exact v2 spawn leases a Korean-named directory inside the module fence. |
| `mcp/test/fs/windows-boundary-probe-worker.test.ts` | Fake child moved to the ASCII wire. New ASCII-wire test, real-worker test for Korean, NFD and surrogate-pair names, and slow-startup test. `icacls.exe` pinned. |
| `mcp/test/fs/runtime-paths.test.ts` | Probe-wire assertions. Real probes on a Korean-named state root. PATH-planting regression test. `whoami.exe` pinned. |
| `mcp/test/fs/workspace-config-store.test.ts` | `icacls.exe` pinned. |

`native-module-fence-source.ts` is unchanged, because the spawn shape is byte-identical. `service/upstream-lock.json` is not edited; the hashes of these 11 files change.

## 6. Tests and results

All runs used `node node_modules/vitest/vitest.mjs run <paths>` from `service/`, with this environment:

```
export PATH="/c/2026_project/super-figma-pipline/.worktrees/_cache/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH='C:\2026_project\super-figma-pipline\.worktrees\_cache\ms-playwright'
export TEMP=<variant> TMP=<variant> LOCALAPPDATA=<variant>   # see section 2
```

### 6.1 Red before the fix

The new tests ran against the unchanged production code, with the ASCII `TEMP`. The paths were `packages/mcp/test/fs/windows-directory-lease-broker.test.ts`, `packages/mcp/test/fs/windows-boundary-probe-worker.test.ts`, `packages/mcp/test/fs/runtime-paths.test.ts`, `packages/mcp/test/portal/native-artifacts.test.ts` and `packages/mcp/test/portal/preview-lease.test.ts`.

Result: **63 failed | 55 passed | 3 skipped (121)**. The failures were for the expected reasons:

- Real broker on Korean directories: `CreateFileW failed: 123`.
- Constrained-language harness: `DIRECTORY_LEASE_PROTOCOL_INVALID` (the child died) instead of `HOST_POWERSHELL_RESTRICTED`.
- Stored v1 authority: `PORTAL_ARTIFACT_CHANGED` instead of the typed re-prepare error.
- Real probes on a Korean state root: "Windows ancestor probe record does not identify the inspected path" (a garbled `FullName`).
- PATH-planting test: `whoami.exe /user /fo csv /nh` failed; it ran the MSYS `whoami`.
- Codec, echo and wire tests: the functions and fields did not exist yet.

**K11 red-to-green.** With `/c/Windows/System32` placed first on PATH, and the base code:

- `runtime-paths.test.ts` gave 3 failed | 36 passed | 1 skipped (40). The Windows state tests that fail under the plain Git Bash PATH passed, which confirms the MSYS shadowing.
- The PATH-planting regression still failed at `whoami.exe /user`, because the planted look-alike precedes `System32`.

After the fix, `runtime-paths.test.ts` and `workspace-config-store.test.ts` pass under the plain Git Bash PATH. `test/execution/identity-bootstrap-coordinator.test.ts`, which the coordinator also listed, passes with both `TEMP` variants.

**Boundary worker startup budget.** The new slow-startup test failed before `8334e11` with "Windows boundary request expired in the queue": an 8 s READY exceeds the 5 s budget. It passes after.

### 6.2 Final results

These are the results at `8334e11`, the final code commit.

| Suite | TEMP | Failed | Passed | Skipped | Total |
| --- | --- | --- | --- | --- | --- |
| `test/fs` + `test/security` | ASCII | 1 | 467 | 7 | 475 |
| `test/fs` + `test/security` | Korean | 1 | 467 | 7 | 475 |
| `test/portal` | ASCII | 33 | 486 | 2 | 521 |
| `test/portal` | Korean | 33 | 486 | 2 | 521 |

The focused files for this task all pass with both variants when they run together: 9 files, 198 passed and 6 skipped (204).

| File | Passed | Skipped |
| --- | --- | --- |
| `windows-directory-lease-broker.test.ts` | 40 | 1 (the gated soak) |
| `windows-boundary-probe-worker.test.ts` | 23 | 0 |
| `runtime-paths.test.ts` | 39 | 1 |
| `workspace-config-store.test.ts` | 27 | 3 |
| `atomic-file.test.ts` | 23 | 0 |
| `native-artifacts.test.ts` | 15 | 1 (opt-in acceptance) |
| `native-module-fence.test.ts` | 28 | 0 |
| `preview-lease.test.ts` | 2 | 0 |
| `identity-bootstrap-coordinator.test.ts` | 1 | 0 |

Static checks on the 11 changed files:

- `tsc --noEmit -p tsconfig.json` exits 0 for `shared`, `ir`, `mcp` and `cli`; `vue-tsc --noEmit` exits 0 for `plugin`. These ran directly, because `pnpm typecheck` tried to reinstall `node_modules` without a TTY and aborted without changing anything.
- `oxlint --deny-warnings` exits 0.
- `oxfmt --check` exits 0.

### 6.3 Baseline for comparison

The base production files (`git checkout 5be8cc7 -- <5 src files>`, restored afterwards) ran against the new tests. The slow-startup test did not exist yet, so the fs totals are 474.

| Suite | TEMP | Failed | Passed | Skipped | Total |
| --- | --- | --- | --- | --- | --- |
| `test/fs` + `test/security` | ASCII | 64 | 403 | 7 | 474 |
| `test/fs` + `test/security` | Korean | 129 | 338 | 7 | 474 |
| `test/portal` | ASCII | 35 | 484 | 2 | 521 |
| `test/portal` | Korean | 284 | 235 | 2 | 521 |

With the old tests and old code, the suites gave:

- `test/fs` + `test/security`, ASCII `TEMP`: 6 failed | 430 passed | 6 skipped (442).
- `test/fs` + `test/security`, Korean `TEMP`: 72 failed | 364 passed | 6 skipped (442).
- `test/portal`, ASCII `TEMP`: 33 failed | 483 passed | 2 skipped (518).

### 6.4 Per-test comparison from the Vitest JSON reports

These compare `8334e11` with the baseline in 6.3.

| Suite | Fixed | Still failing | New failures |
| --- | --- | --- | --- |
| fs + security, ASCII | 63 | 1 | 0 |
| fs + security, Korean | 128 | 1 | 0 |
| portal, Korean | 251 | 33 | 0 |
| portal, ASCII | 4 | 31 | 2 flakes, see below |

The Korean-variant totals behind the summary are 129 + 284 = 413 failing before and 1 + 33 = 34 after.

The two ASCII portal flakes are `native-artifacts > rejects change of provisioned artifacts by an assertion` and `native-runner > finishes when a root exits while a descendant holds inherited output pipes`.

- Both are process-tree tests.
- In the full run, the command exited with 126, the native job helper's "job not drained" path in `windows-job.ts`. T01 does not touch that file.
- Both files then passed 26/26, with 1 skip, in three isolated runs.
- An earlier full run had the same kind of flake in `rejects add of provisioned artifacts`; that file then passed 15/15 in three isolated runs.

One coordinator test is borderline at its timeout at the base commit as well: `coordinator > blocks unproven routing before a lease ...`.

- Run alone, with cold starts, it took 4963, 4989 and 5006 ms at the base commit, against a 5 s default timeout. After the change it took 5029, 5111 and 5133 ms, which is about +2% from the larger helper cold start.
- In steady state it took 3964–4244 ms before and 4010–4133 ms after.
- It passed in the final full runs.

### 6.5 Remaining failures, all pre-existing

- **`test/fs`.** `workspace-policy.test.ts > rejects a nested Linux bind mount ...` is a Linux-specific test that fails on Windows, including at the base commit.
- **The boundary worker's `bounds hang failure` flake is gone.** Its replacement worker had to start within the 40 ms request budget. The isolated failure rate was 1/10 at the base commit. It was 0/10 with the first ASCII-wire worker, and 0/10 after the startup budget removed the cause.
- **`test/portal`.**
  - `native-work` (27), `operational-native` (2), `consumption-input` (1) and `preview-native` (1) fail with `PORTAL_VALIDATION_REQUIRED` or `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` (SVC-1/K1).
  - The other causes are `PORTAL_PROFILE_PREPARATION_CHANGED`, `DECLARATIONS_CHANGED` versus `PORTAL_CONSUMPTION_CANDIDATE_CHANGED`, a missing `dist/portal-validation.mjs` (no build in this working copy), and tests near their timeouts.
  - With the Korean `TEMP`, `core-coordinator` and `core-recipes` hit timeouts in the final full run. The same tests also fail at the base commit with that `TEMP`.

## 7. Performance check

The first full portal run after the change showed a consistent 30–45% slowdown in lease-heavy coordinator tests. Alternating before/after runs confirmed it. The cause was the first boundary-worker version, which made two PowerShell function calls per path.

| Measurement | Base commit (v1) | First v2 | Final v2 |
| --- | --- | --- | --- |
| Boundary worker, 12-path request | 5.3–5.5 ms | 13.5–15.4 ms | 5.8 ms |
| Boundary worker, ACL request | 1.4 ms | 2.1–2.7 ms | 1.4–1.5 ms |
| Lease helper, time to READY | 271–292 ms | 311–337 ms | about 315 ms |
| Lease acquire and release cycle (same session) | 0.91 ms | — | 0.82 ms |

Commit `17619b1` replaced the per-path function calls with static .NET calls and reused one SHA-256 provider. After it, alternating runs of the five heaviest coordinator tests matched the base commit within noise.

## 8. Soak

The soak runs with `SFP_LEASE_SOAK=1` and the filter `-t "soaks 1,000"`. It performs 1,000 sequential acquire/release cycles through `acquireWindowsDirectoryLease` on `<TEMP>\강지혜-XXXX\강지혜\AppData\Local`, after one warm-up lease. Every lease identity must equal `lstat` (dev, ino).

| TEMP | 1,000 cycles | Whole test, including cold start and fixture |
| --- | --- | --- |
| Korean | 618 ms | 1023 ms |
| ASCII (directory still Korean-named) | 674 ms | 1150 ms |

A separate read-only check leased a directory under the real profile, `C:\Users\강지혜\AppData\Local\Temp\claude\...\scratchpad`, with the committed code: 100 cycles in 485 ms, with 0 identity mismatches. Before the fix, a path with this shape killed the broker (section 3).

## 9. Deviations from the design

- **Pinning mechanism (K11).** The call sites pass fixed logical names (`whoami.exe`, `icacls.exe`, `powershell.exe`). The production runner maps them to absolute `System32` paths and refuses anything else. The coordinator asked for absolute paths at the call sites.
  - Reason: simulated-`win32` tests inject fake runners and also run on POSIX CI, where no `SystemRoot` exists.
  - Every production execution still uses the pinned path, and the PATH-planting test proves it with the real runner.
- **No pre-warming.** The broker still starts on first use; the 30 s startup budget covers a cold start. Pre-warming would have to be wired into daemon startup in `mcp/src/index.ts`, a sequenced file outside the T01 file list.
- **Error code at the retained-directory layer.** `withRetainedDirectoryAuthority` still wraps lease failures in its caller's code (`DIRECTORY_AUTHORITY_INVALID` by default). `HOST_POWERSHELL_RESTRICTED` is the `cause`. Callers of `acquireWindowsDirectoryLease` receive `HOST_POWERSHELL_RESTRICTED` directly.
- **Boundary worker queue deadline.** The boundary worker's queue deadline changed as well, and the coordinator did not ask for that. The new default is the startup budget plus one request budget. Without it, requests that queue behind a cold start would still expire after 5 s. Explicit options still override the default.

## 10. Limitations and open issues

- **Coverage limits.**
  - **Restricted hosts.** A real WDAC or AppLocker policy was not available. `__PSLockdownPolicy=4` does not enforce constrained language mode on this machine. The real-PowerShell test runs the exact helper after switching its session to `ConstrainedLanguage`, which exercises the helper's check but not a policy-enforced session. `Add-Type` and AMSI failures are covered with fake children only.
  - **UNC paths.** No share was available, so UNC paths are covered by unit tests of the codec and of the bytes the broker receives. The real-broker tests use local drive paths, including a path longer than 300 characters.
- **Stderr is not transcoded.** PowerShell's host writes stderr in the OEM code page. The raw first 4 KiB is kept losslessly as base64; the message excerpt is decoded as UTF-8, so Korean text in it may show replacement characters.
- **Lone surrogates in the boundary worker.** The lease path keeps unpaired surrogates exactly. The boundary worker turns them into U+FFFD, and Node's exact path comparison then fails closed.
- **Fenced preview end to end.** `preview-native.test.ts` still fails at profile registration (`PORTAL_CONSUMPTION_PREPARATION_REQUIRED`, SVC-1), before any lease is taken. The new fenced test in `preview-lease.test.ts` covers the fence and the v2 lease directly.
- **Not run here.**
  - `verify:source` (the whole suite) was not run; G0 belongs to the main session.
  - The e2e files `process-lifecycle` and `mcp-wire` need a fresh `dist` build and spawn without `windowsHide` (a T03 item), so they were not run. They failed only because of the MSYS `whoami` shadowing, which the pinning removes.
  - No window census was taken, because the T06b harness does not exist yet. Every new spawn uses `windowsHide: true`, and the production spawn shape is unchanged.
- **Open issues for other tasks.**
  - `mcp/src/fs/workspace-policy.ts` has the same test-only probe pattern: raw `FullName` returned through the console code page. That file is sequenced to another task.
  - `knip.json` lists `icacls.exe` under `ignoreBinaries`. The tests no longer call the bare name, so that entry may become an unused configuration hint.
  - `probeProcessStartIdentity` in `atomic-file.ts` still uses a 2 s PowerShell budget. It belongs to the non-lease part of OPS-5.
  - The coordinator test in section 6.4 is borderline at the 5 s default timeout at the base commit as well. It needs an explicit timeout in a follow-up.
  - The native job helper in `windows-job.ts` can return 126 under full-suite load. That causes intermittent process-tree failures.
- **Provenance.** `service/upstream-lock.json` must be refreshed for the 11 changed files, together with a change-manifest slice, in the per-task provenance step.
