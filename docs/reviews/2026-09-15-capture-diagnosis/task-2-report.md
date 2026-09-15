# Task 2 report: capture diagnosis and logical cancellation

Status: **DONE_WITH_CONCERNS**. The cancellation and bounded diagnostic changes are implemented and verified in the separate copy. The actual current service capture succeeded. The historical generic capture exception did not reproduce, so its historical root cause is not established and is not claimed fixed.

## Scope and protection limits

All implementation, builds and tests ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. Only this requested report is written to the controller's SDD workspace. No main source edits, staging, commits, push, dependency changes, Docker, VM, WSL, portal apply, browser launch, navigation or additional Chrome client were performed. The three Task 1 files were not edited. This is native execution under the same owner account, without an OS sandbox or filesystem isolation guarantee. The separate copy protects against accidental edits to the main checkout; it does not prevent arbitrary native child processes from reaching other owner-accessible paths.

## Live service experiment

Fresh serialized process/port inspection confirmed Chrome PID 16236 listening on loopback port 9222 and no service on 3055. An initial mixed PowerShell table hid the TCP fields; that observation was corrected using explicit JSON before connection.

The actual existing owner state was used: `C:/Users/c/AppData/Local/SuperFigmaPipeline`. The admitted CLI confirmed existing external workspace `896a1a22-4313-4154-9de9-0512ea505fe3` at `C:/Users/c/Projects/SuperFigmaPortals`. Its expired egress grant was renewed through normal `egress allow` for the same public, project-code, design-text and design-image classes. The CLI invoked:

```text
node packages/cli/dist/index.mjs portal plan --case new-blank --out C:/Users/c/Projects/SuperFigmaPortals/figma-ecommerce-task2-20260915 --stack react-vite --yes --capture-result --timeout 420
```

Normal control admission, approval and signed owner-state publication were used. No actor was constructed or impersonated. The selected file was the approved Figma file `4IBhv1d8hEclifZQrOYxHS`, node `0:1`.

The service reported `awaiting-browser`; the controller surfaced the actual native Allow prerequisite and the user confirmed it. The same connection subsequently reported `connected`. The single operation succeeded with `issues: []`:

| Evidence | Value |
| --- | --- |
| Plan | `sfp_portal1_61291b5d8bdca9a318c8f808dc29e827` |
| Captured at | `2026-09-14T15:52:21.089Z` |
| Nodes | 3,198 |
| Truncated | false |
| Assets | 283, all captured |
| Complete / live verified | true / true |
| Raw hash | `sha256:fbdd986faadc4ac9ab12718d6150ced21910ec9a7e27ab175a2cb44fadba72c5` |
| Asset manifest hash | `sha256:dc47757dab2b1becca0a461989352bcffc3c4811c9e1e0401c4402d9a8b8a6eb` |
| Raw bytes/hash check | match |
| Fresh asset byte-length/hash checks | 283 checked, 0 mismatches |
| Live build expected/running identity | `sha256:c6b50249d56323b57b7a9019f999d8c045bf32d998cdf9e12e34d6d338eb75d2` |

The completed design is `portal/designs/sfp_portal1_61291b5d8bdca9a318c8f808dc29e827.json` in the actual owner state. A signed capture-progress checkpoint was also published by the capture flow. Only bounded counts and hashes were extracted for this report; raw design values and credentials are omitted. No first failing capture stage exists in this fresh run. Successful stage-transition timing was not instrumented; failure elapsed time is recorded per stage, and the accepted request/capture timestamps are retained.

This is current service capture evidence, not final coherent/catalog/recipe-integrated Case 4 acceptance. No direct collector comparison or speculative historical-exception fix was made because the service itself succeeded.

## Independently demonstrated startup defect

The initial owned daemon PID 3252, exec session 2921, exited before listening with `STATE_ACL_COMMAND_FAILED`, caused by `WINDOWS_BOUNDARY_PROBE_FAILED`. Native Windows PowerShell could not load `Microsoft.PowerShell.Security` for `Get-Acl`. A Node child-launch comparison reproduced the inherited PowerShell 7 module-path failure; using native Windows module discovery loaded the command successfully. This is a demonstrated startup/environment defect, distinct from the historical capture exception.

The diagnostic live daemon was started with a process-local native `PSModulePath` so the live experiment could proceed without changing owner state. The production fix is narrower: the trusted native worker explicitly imports its own `$PSHOME` Security module by its fixed module path. It changes no global or parent environment, execution policy, ACL policy, or boundary verification.

A controlled real native-worker test exported a conflicting `Get-Acl` from an inherited module path. It failed before the fix with the same module-loading class, then passed after the fixed native import. Existing fresh ACL-mutation and junction-detection tests still pass. Other native PowerShell call sites were inspected: the production ACL reads use this worker; alternate state-permission probes are the injected-command fallback. The atomic/job/workspace helpers do not invoke `Get-Acl`; no broad refactor was introduced.

Microsoft documents the intermediate-process module-path inheritance issue in [Starting Windows PowerShell from PowerShell 7](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.6#starting-windows-powershell-from-powershell-7). The chosen fixed native-module import also avoids Windows environment-key alias concerns.

Fresh final-source native startup validation used `dist-task2-check/daemon-entry.mjs`, free port 3056 and separate owner-state fixture `../task2-native-runtime/SuperFigmaPipeline`. Its parent directory was explicitly prepared after an initial fixture-only `STATE_PATH_UNSAFE`/missing-parent failure. No guard was changed. With the original unsanitized PowerShell 7 module path inherited through Node, final daemon PID 12856 reached `/ping` successfully, then exited cleanly on owned shutdown. No Chrome connection was requested. The final build identity was `sha256:e5317cda5983a02aba78a022c3384acfcbfe618f3c508033f71c9765c69a2e3e`. The actual live daemon's dist directory was preserved during this alternate build.

## Cancellation and diagnostic changes

- A logical abort race abandons unresolved queue/connection promises promptly while preserving the underlying shared operation and ordering. The queue's internal tail remains until its predecessor settles, preventing later work from overtaking it.
- Shared connection completion owns its browser assignment/cleanup independently of each waiter. Cancelled connection waiters never select a session or start reads; a session arriving after cancellation is released. Normal later reuse keeps one connection. A browser arriving during daemon shutdown is closed exactly once.
- Capture boundary checks prevent subsequent snapshot, asset and checkpoint publication after cancellation. Late-session and queue tests assert absence of these effects. Cancellation and primary errors retain precedence over cleanup errors.
- Typed failures record connection, readiness, state preparation, snapshot, checkpoint read, assets, final readiness, schema, publication and cleanup boundaries. Unknown older capture ports use an unclassified `capture` stage. The optional `captureFailure` design field has no default and invents no capability for older records.
- Public evidence contains allowlisted code/type/stage, bounded elapsed time and bounded sanitized schema paths/counts. Original causes remain internal. Arbitrary exception messages, exception codes, credentials, CDP endpoints and private field names are excluded.
- Existing budgets, source/boundary checks, per-batch limits and completeness conditions remain in place.

Red/green evidence: connection and late-session tests initially remained `still waiting`; queue cancellation initially remained `still waiting`; a primary snapshot TypeError was initially hidden by cleanup failure; shutdown initially failed to close the late browser; the incompatible module-path test initially failed to import ACL commands; and an unknown capture-port failure initially received the wrong publication boundary. Each demonstrated regression passes after its focused correction.

## Verification

Fresh focused tests: **7 files, 59 tests passed**:

```text
pnpm exec vitest run packages/mcp/test/portal/capture-failure.test.ts packages/mcp/test/portal/capture-session.test.ts packages/mcp/test/portal/capture-flow.test.ts packages/cli/test/browser-session.test.ts packages/mcp/test/fs/windows-boundary-probe-worker.test.ts packages/mcp/test/portal/capture-continuation.test.ts packages/shared/test/portal.test.ts
```

MCP, CLI and shared typechecks passed. Targeted oxlint with `--deny-warnings` and oxfmt checks passed for all 12 changed files. The final MCP alternate build and publint passed. Native startup and live asset integrity checks passed. No whole-suite run or final product acceptance is claimed. Generated capability manifests and wider contract migration/integration remain the controller's later tasks.

## Ownership handoff

| Resource | Current state |
| --- | --- |
| Retained live daemon | PID 23776; parent PID 23944; exec session 64596; healthy loopback 3055 |
| Retained daemon entry | `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/dist/daemon-entry.mjs` |
| Retained live build | `sha256:c6b50249d56323b57b7a9019f999d8c045bf32d998cdf9e12e34d6d338eb75d2` |
| Chrome | User-owned PID 16236; loopback 9222; one retained service connection; do not close user browser/tab |
| Portal invocation | Exec session 4281 exited 0; no outstanding operation |
| Native startup fixture | PID 12856 exited; port 3056 has no listener; no remaining child observed |
| Initial startup failure | PID 3252/session 2921 exited 1; no connection acquired |

The authenticated operation identifier is retained in the private investigation record.

The retained live build deliberately predates the final startup, cleanup and fallback-diagnostic refinements. It must not be represented as running final-source bytes. Final-source build identity was independently recomputed as `sha256:e5317cda5983a02aba78a022c3384acfcbfe618f3c508033f71c9765c69a2e3e`. The controller owns a later reviewed restart and final Case 4 validation. Keep the current healthy connection until that restart is necessary.

Local evidence files: `service/.task2/live-capture.json`, `service/.task2/native-startup.json`, and `service/.task2/source-hashes.json` within the separate copy. They are investigation artifacts, not production integration files.

## Final source bytes for integration

Paths below are relative to the separate copy's `service` directory. Integrate only these 12 implementation/test files for Task 2.

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/logical-wait.ts` | `58a0ef7faf2c39c373627f416fcb3e995b3f081c15158404c4ed3361f7b5f919` |
| `packages/cli/src/browser-session.ts` | `3c3803fb117a4867fe402b6f7ed55746327a7962872642e15030ff9ae0513f7e` |
| `packages/cli/test/browser-session.test.ts` | `c0b29437a065d957b3f01d79b7d1413e3b6cc993a6a7f31940463e1c3ca64212` |
| `packages/mcp/src/portal/design-capture.ts` | `b55bd23e783c9d9c6d8b2683f6dcd25ffc11b0004a9516ea76dc66fedfacfd4f` |
| `packages/mcp/src/portal/capture-failure.ts` | `398ff45e5f9b7870404204bf90483153f253a7b7cb51587724ee1be8a5c805f0` |
| `packages/mcp/src/portal/coordinator.ts` | `5e0dafbe37d6803b4edf1a322cf1e8c6077360bd8c30b67062e2b492a8b063a7` |
| `packages/mcp/test/portal/capture-session.test.ts` | `c773dd9e502600cfc90c62721ad584f1d29eeaaf7e81aae661172128d09a8181` |
| `packages/mcp/test/portal/capture-failure.test.ts` | `5b329c0908a159edb19152b552fbd8e01adaee2ecca4f7f71b2604bebdf534b0` |
| `packages/mcp/test/portal/capture-flow.test.ts` | `74c8a2528c4384b658e1be1508606970bf783d66e55fc93f50a2966b372f387e` |
| `packages/shared/src/portal.ts` | `55f81dbfdea10a0f2a9eecf152b138c985df4183bfd6c580f85be4a4bfc441a9` |
| `packages/mcp/src/fs/windows-boundary-probe-worker.ts` | `ce637eb339400af2e63d2780df2ea712249b1a7900530781fdafdc61af482f5f` |
| `packages/mcp/test/fs/windows-boundary-probe-worker.test.ts` | `4a85328addc5cc456d8360960d82360841c20438a9398ea45fefef61fbe86e88` |
