# Portal registration failure and strict mock repair

Date: October 13, 2026 (Asia/Seoul). Read [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [the UI/CLI review](own-official-oauth-ui-cli-review.md) and [provenance order](portal-provenance-order.md). Scope: read-only native investigation, private diagnostic fixture and one managed test repair. Root owns native/main integration, R17 provenance and whole-check launch. No live runtime, source Chrome, grant, job, production source or Git metadata was changed by this reviewer.

## Original failure and root cause

Native source `sha256:9c2806c53fe97177935a8e5949a4da4714cda5a18dc10b4bdf5d31c3b133bc95`, whole attempt `d0b76231-1b2c-4492-83e3-ed4a0953e54f`, failed before the sixteen gates while declaring test scope. Its failed report/pointer remains intact under native `service/artifacts/source-checks`. `collect-test-registrations.mjs` called Vitest collection with no reporters, observed exitCode 1 and threw `TEST_REGISTRATION_COLLECTION_FAILED` with an empty unhandled-error array. An empty array did not establish absence of collection errors.

The private diagnostic runner used actual Vitest 4.1.11 public APIs: each module's `state()` and `errors()`, nested-suite `errors()`, and registered children. It reproduced a failed CLI module with zero registrations:

`packages/cli/test/bound-server-session.test.ts` mocked `node:child_process` with only `spawn`. Integrated `control-client.ts:63` now evaluates `promisify(execFile)` at module load for its private owner-proof transport. Vitest correctly rejected the missing `execFile` mock export before either test registered. The error therefore occurred during collection, not inside a test body or an unhandled asynchronous execution. The earlier 54-case OAuth UI/CLI cohort did not include this older bound-session fixture; it was not whole-suite coverage.

## Exact scoped repair and verification

Root authorized only the managed test repair. It adds a typed `execFile` mock that throws on unexpected execution and asserts that neither `spawn` nor `execFile` is called in both retained cases. It does not fall through to a real subprocess, weaken ControlClient owner proof, suppress module errors or change either bound-session assertion.

| Path | Before SHA-256 | Frozen after SHA-256 |
| --- | --- | --- |
| `service/packages/cli/test/bound-server-session.test.ts` | `ec5de6679d1be54e8ce55617c9f50a9b8d01972738e67c6bde058506db6522a2` | `e79e921d15a157e2b041a83bbbe5edd8f8ab27adc62469bd362b17a92c97f614` |

Frozen private manifest: `.worktrees/_cache/portal-registration-diagnosis-20261013/frozen-files.json`, SHA-256 `004192db80af1470a0ca4035ac5581482136765d5a3e1e7be8900d3165a4dc4f`. Managed and regular fixture after bytes matched. Native/main before bytes matched when the manifest was produced; root may subsequently integrate the one-file repair.

Meaningful executed results:

- Exact original focused module: zero cases, failed module/missing export, process exit 1, empty unhandled array. Receipt `registration-diagnosis-bound-before-absolute.json`, SHA-256 `da05e1fc9f47ec857390cab3a4e0c786d7ac04ed016c772392e18ce464ff9706`.
- Repaired focused collection: one module, two registered cases, zero failed modules/unhandled errors, exit 0. Receipt `registration-diagnosis-bound-repaired-absolute.json`, SHA-256 `623a40dd46bf3a3921286896e91f7d979bdbb6d1ef17b40975ded2fa2b12fae8`.
- Actual repaired file execution: **2/2, zero failures/skips, exit 0**. Receipt `bound-repaired-absolute-test.json`, SHA-256 `9a477b4fd3e46aaeddc3fac1b903ee4dd7e2d871b6771b5baf8f7af3a563d141`. Scoped lint with deny-warnings and formatting checks passed.

The private whole collection R1 recorded 474 modules/5,608 registered cases and two failed modules. The second, plugin `variable-binding-coverage.test.ts`, was a private-copy limitation: its direct Node `createRequire(...).resolve('@figma/plugin-typings/package.json')` could not use the Vite dependency resolver. The actual native package exists and its manifest hash is `13752b152a1c8548d7a25f8841a2a0c44fd118c52097c7a0142e67d9b1901849`. That private failure was retained and not relabeled as a native bug or a full passing collection. A first focused filter used the caller-relative path and selected zero files; its outputs remain excluded from success evidence. The corrected commands use the absolute private module path.

## Dist attribution and limits

Native `packages/cli/dist/library.mjs` remained `627a7ad158dc22e81b212abb90d2817d5fc29b0aafb13975cd358ecfaffb4dcb` before and after every diagnostic collection. The observed `commands-Dug_7_C3.mjs`/library/index timestamps were 13:40 KST on October 12, earlier than the failed registration near 00:08 on October 13. Inspected project configs have no globalSetup, and `run-source-checks.mjs` declares scope before its build gate. There is **no evidence that collection rebuilt or changed native dist**. Filename appearance alone is not a mutation observation. This pins the checked library; it does not retroactively prove every earlier dist byte unchanged without an earlier complete inventory.

The diagnostic fixture is a separate regular source/dist copy, with a private Vite cache and readonly native dependency resolution. No install, build, service process launch or test body occurred in diagnostic collection. The actual focused test uses strict mocks and starts no daemon or owner-proof process. The collector script itself was not modified; improving its module-error projection remains a separate possible tooling change rather than an error waiver.

Repeat from native service cwd using the absolute private file:

`node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-registration-diagnosis-20261013/review.config.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-registration-diagnosis-20261013/service/packages/cli/test/bound-server-session.test.ts --reporter=json --outputFile=<new absolute receipt>`

Root must integrate the exact one-file hash, create fresh R17 reconciliation metadata through the established order, recheck actual native full registration and launch its fresh source-bound whole check. This focused repair is not a whole pass, packaged-runtime pass or live acceptance. Original d0b failure and all private failures remain preserved.
# October 13 strict mock typing follow-up

The first repair `e79e921d15a157e2b041a83bbbe5edd8f8ab27adc62469bd362b17a92c97f614` remains historical runtime proof. Root's actual native CLI noEmit subsequently found TS2345: `typeof execFile` includes the `__promisify__` namespace property and cannot describe a plain throwing implementation passed to `vi.fn`.

The managed-only follow-up describes the callable mock using `(...args: Parameters<typeof execFile>) => ReturnType<typeof execFile>`. It retains the same throwing fake and both no-execution assertions. No real process fallback, production ControlClient change or ignored module error was introduced.

Frozen revised file: `packages/cli/test/bound-server-session.test.ts`, before `e79e921d15a157e2b041a83bbbe5edd8f8ab27adc62469bd362b17a92c97f614`, after `f4c892eeab7ffc68347d1e3a09d776ffbba79205a6911ec0bf354e0d7d907d9a`. Separate manifest `.worktrees/_cache/portal-first-workspace-20261013/frozen-mock-v2.json`, SHA-256 `ea2b148004b6119d026a0e9d49d5566e568931429cc5a78368268b223af5edaa`.

The public Vitest collection API collected one module and two cases, zero module/unhandled errors, exit 0. Native CLI dist SHA-256 remained `627a7ad158dc22e81b212abb90d2817d5fc29b0aafb13975cd358ecfaffb4dcb`. Receipt `registration-diagnosis-mock-v2.json`, SHA-256 `dcec3b9f589dde6953e376446bf1f29bac0570a0b337bdf3cbb8b22b1f9dc391`. Actual two tests passed again in the final 26-case cohort described in [the first-workspace repair](first-workspace-setup-repair.md).

Actual managed CLI `tsc --noEmit` no longer reported this mock error, but failed on concurrent unowned C3 changes: `native-work.ts` missing `contextHash` and `react-router-compiler-evidence.ts` optional AbortSignal. No claim of a passing managed whole typecheck is made. A real TypeScript noEmit program against the unchanged native CLI config, with only the revised test supplied through an in-memory read overlay, checked 944 source files with zero diagnostics. The host rejects compiler writes. Run from native service cwd: `node C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/typecheck-overlay.mjs`. Receipt SHA-256 `961962ae7382515930518ba808eefc6d44a1664fee8b07ca6a9c21802ff0217c`. An initial invocation from Main could not find the explicit Node type library; the correct native-cwd execution passed. This validates the isolated candidate, not the concurrent compiler candidate or a whole check.

Scoped lint/format passed. Root owns replacement, fresh provenance reconciliation and whole launch; the original whole failure remains preserved.

