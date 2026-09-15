# Task 1 Report: Daemon Runtime and Build Identity

## Status

Complete in the isolated validation copy. The reviewed files remain unstaged and uncommitted for controller integration. This task corrects the daemon build-identity input set; it does not establish that the historical live Figma capture exception is fixed.

## Working copy and scope

- Implementation and validation root: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`
- Main checkout source was not edited.
- No dependency versions were changed.
- No Chrome, daemon, Docker, VM, or WSL process was started.
- No historical diagnostic state was cleaned.
- The pre-existing staged index was not changed. `service/scripts/build-server.mjs` remains staged at blob `2a8ce4aad6147aef561a878586ca699d016bf590`; the working-tree status for the three reviewed paths is `AM` for the staged build script and `??` for the two new files.

## Root cause

`packages/mcp/src/portal/design-capture.ts` imports collector runtime code directly from these CLI source modules:

- `packages/cli/src/asset-program.ts`
- `packages/cli/src/browser-session.ts`
- `packages/cli/src/capture-assets.ts`
- `packages/cli/src/snapshot-reader.ts`

The prior `scripts/build-server.mjs` digest walked only `packages/shared`, `packages/ir`, and `packages/mcp`, then appended `pnpm-lock.yaml`. A CLI collector-only edit therefore changed the MCP bundle without changing its advertised build identity. The CLI's `ensureLocalServer` compares the packaged `build-info.json` identity with the healthy daemon's `buildIdentityHash`; a blind digest could cause a stale daemon to be accepted as current.

## Changed paths

1. `service/scripts/build-server.mjs`
   - Replaced the inline partial digest with the focused `computeBuildIdentity(root)` helper.
   - Preserved `SOURCE_DATE_EPOCH`, `schemaVersion`, `buildId`, `identity`, and the `sha256:<64 lowercase hex>` public format.
2. `service/scripts/build-identity.mjs`
   - Added deterministic enumeration for the runtime source trees `cli/src`, `shared/src`, `ir/src`, and `mcp/src`.
   - Added required root/package manifests, the pnpm lock/workspace configuration, root and package TypeScript configuration, MCP/CLI tsdown configuration, the build entry, and the identity helper itself.
   - Excluded generated output, dependencies, coverage, and test-only directories.
   - Added explicit errors for missing roots/files and unsupported filesystem entries instead of silently omitting them.
   - Added byte-length framing for the identity domain, input count, normalized path, and file content. Inputs use forward-slash paths and code-point sorting, so path/content boundaries and ordering are unambiguous across platforms.
3. `service/test/build-identity.test.ts`
   - Added the CLI collector regression, deterministic enumeration, source/config mutation, excluded output/test stability, required-input failure, and the existing CLI stale-daemon comparison test.
   - The stale-daemon test uses a mocked child process because this task expressly forbids daemon starts. It verifies that a healthy daemon with the wrong identity is rejected and that the packaged entry is selected; the second matching status is accepted.

Including the complete CLI source tree is deliberately conservative. It covers the current direct collector imports and any future transitive CLI source import without coupling identity correctness to a manually maintained four-file list. Plugin source is not included because it is not an input to the daemon's tsdown build. Installed dependencies and generated bundles are excluded; package manifests and `pnpm-lock.yaml` bind dependency selection without hashing `node_modules`.

## TDD evidence

### Initial test-first red

The regression test was added before the helper. The first run failed because the production helper did not yet exist:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "detects a CLI collector change"
exit_code=1

Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
Error: Cannot find module '/scripts/build-identity.mjs'
```

### Behavioral red reproducing the omission

After the implementation existed, its reviewed byte hash was recorded as `CFBB258458065448E34226396FCF00E4713E0C824C8C8A17FE103622B5C31EFB`. I temporarily removed only `packages/cli/src` from the helper's source input list and ran the collector regression:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "detects a CLI collector change"
exit_code=1

FAIL  |root| test/build-identity.test.ts > daemon build identity > detects a CLI collector change that the legacy digest misses
AssertionError: expected 'sha256:a23a6a49c3e0bea1ebb42e8bfb8dcc…' not to be 'sha256:a23a6a49c3e0bea1ebb42e8bfb8dcc…' // Object.is equality
  at test/build-identity.test.ts:92:50

Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
```

This is the bounded behavioral reproduction: changing only the CLI collector left both the legacy digest and the temporarily regressed actual helper unchanged, so the required inequality failed.

### Restoration and focused green

I restored `packages/cli/src`, confirmed the helper returned to the exact pre-mutation hash, and reran the same regression:

```text
> $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'scripts/build-identity.mjs').Hash; ...; pnpm exec vitest run test/build-identity.test.ts -t "detects a CLI collector change"
exit_code=0
restored_sha256=CFBB258458065448E34226396FCF00E4713E0C824C8C8A17FE103622B5C31EFB

Test Files  1 passed (1)
Tests       1 passed | 5 skipped (6)
```

The test itself also asserts that its local reproduction of the legacy algorithm remains equal before and after the CLI-only mutation, while the actual fixed helper changes.

## Fresh validation

### Focused test file

```text
> pnpm exec vitest run test/build-identity.test.ts
exit_code=0

Test Files  1 passed (1)
Tests       6 passed (6)
Duration    591ms
```

The six passing cases cover:

1. CLI collector input changes the fixed identity while the legacy identity stays unchanged.
2. Enumeration and hashing are deterministic despite reversed fixture creation order.
3. Runtime source and behavior-affecting build configuration each change the identity.
4. Generated `dist`, coverage, and test-only inputs do not change the identity.
5. A missing required package manifest fails with `BUILD_IDENTITY_REQUIRED_INPUT_MISSING:packages/mcp/package.json`.
6. A healthy daemon with a stale identity is not accepted as current by `ensureLocalServer`.

### Actual reproducible MCP build

The actual package build was run twice with the same source epoch:

```text
> $env:SOURCE_DATE_EPOCH='1700000000'; pnpm --filter @sfp/mcp build; ...; pnpm --filter @sfp/mcp build; ...
exit_code=0

first={"schemaVersion":1,"buildId":1700000000000,"identity":"sha256:2326b1309928394c173eec194f0f0f1e3821725e5e0f14fa90a1785164539219"}
second={"schemaVersion":1,"buildId":1700000000000,"identity":"sha256:2326b1309928394c173eec194f0f0f1e3821725e5e0f14fa90a1785164539219"}
```

Both builds completed successfully, and tsdown/publint reported no issues. The byte-identical JSON demonstrates preserved `SOURCE_DATE_EPOCH` behavior and deterministic identity generation for unchanged inputs.

### Static and package checks

```text
> pnpm exec oxlint --deny-warnings scripts/build-server.mjs scripts/build-identity.mjs test/build-identity.test.ts
exit_code=0

> pnpm exec oxfmt --check scripts/build-server.mjs scripts/build-identity.mjs test/build-identity.test.ts
exit_code=0
All matched files use the correct format.

> node --check scripts/build-server.mjs; node --check scripts/build-identity.mjs
exit_code=0

> pnpm --filter @sfp/mcp typecheck; pnpm --filter @sfp/cli typecheck
exit_code=0
$ tsc --noEmit -p tsconfig.json
$ tsc --noEmit -p tsconfig.json

> git diff --check -- scripts/build-server.mjs
exit_code=0
git diff --check: clean
```

The full suite was intentionally not rerun because the task brief reserves full source verification for the controller's final gate.

## Tested-byte hashes and integration comparison

These are the exact final bytes that passed the fresh checks:

| Isolated path | SHA-256 |
| --- | --- |
| `service/scripts/build-server.mjs` | `15C9952E40EC51268A54619E88BB9E11DF2655F91F30692D5916DB7ADCE3E718` |
| `service/scripts/build-identity.mjs` | `CFBB258458065448E34226396FCF00E4713E0C824C8C8A17FE103622B5C31EFB` |
| `service/test/build-identity.test.ts` | `549B366FC5BA8BDEF80161D12126A50BF19B77ADCAEB03135691CD634B9FCFE0` |

At report time, the main checkout still has the old `service/scripts/build-server.mjs` at SHA-256 `030B22DF09F003B79B0A80E454CDB81F612FB31B0E12A91AE2D8785116116ED0`, and the two new paths do not exist there. This matches the delegation boundary: the controller will copy the reviewed files. After copying, the controller should compare the three main-checkout hashes with the table above before running the final gate; no unrelated staged paths need to be altered.

## Remaining limitations and concerns

- The helper intentionally invalidates the daemon identity for any CLI source change, even a CLI module unrelated to capture. The task brief permits this conservative source-package scope, and it avoids future direct-import omissions.
- The stale-daemon test mocks process creation and does not start a real daemon, consistent with the task prohibition. Final integration should retain the controller's planned live diagnosis rather than treating this unit result as live-service evidence.
- This task did not reproduce the historical Figma capture exception and makes no claim that capture now succeeds. It only ensures subsequent builds advertise a digest bound to the collector and relevant build inputs.

## Round 1 of 5 Review Corrections

This section supersedes the earlier description of exclusions and the earlier tested-byte table. The corrections address both findings in `task-1-review.md`. No production change to `packages/cli/src/server-session.ts` was necessary.

### Correction 1: Enumerate every regular file below selected source roots

The helper no longer skips directories named `test`, `tests`, `__tests__`, `coverage`, `dist`, or `node_modules` inside a selected `src` tree. It recursively enumerates every regular file below `packages/cli/src`, `packages/ir/src`, `packages/mcp/src`, and `packages/shared/src`. Generated and test-only directories remain excluded when they are siblings of `src`, because they are outside the selected roots; a directory name inside `src` has no special exclusion behavior.

The focused regression makes the runtime relationship explicit: fixture `packages/mcp/src/index.ts` imports `./test/runtime-helper.js`, and changing `packages/mcp/src/test/runtime-helper.ts` must change the identity.

Red with the reviewed blanket exclusion still present:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "hashes an imported runtime helper"
exit_code=1

FAIL  |root| test/build-identity.test.ts > daemon build identity > hashes an imported runtime helper even when its directory is named test
AssertionError: expected 'sha256:07129b19c70a92b449c96fe079132f…' not to be 'sha256:07129b19c70a92b449c96fe079132f…' // Object.is equality
  at test/build-identity.test.ts:145:50

Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
```

Green after removing the basename exclusions:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "hashes an imported runtime helper"
exit_code=0

Test Files  1 passed (1)
Tests       1 passed | 6 skipped (7)
```

### Correction 2: Self-contained stale-daemon fixture

The test now mocks only the package-resolution boundary in `node:module` and points `@sfp/mcp` resolution to a temporary `mcp/index.mjs`. It writes that entry and its adjacent `build-info.json` into the test-owned temporary directory. `ensureLocalServer` still executes its real `runtimePaths`, build-info validation, health/status comparison, and spawn decision. The child process remains mocked, and the assertion confirms the temporary packaged entry is the requested spawn target.

No production runtime-path injection was added. The test no longer calls package resolution for `packages/mcp/dist/index.mjs`, reads `packages/mcp/dist/build-info.json`, or depends on an earlier build.

Red after switching resolution to the temporary boundary but before supplying fixture artifacts:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "starts the packaged entry"
exit_code=1

FAIL  |root| test/build-identity.test.ts > CLI stale-daemon identity comparison > starts the packaged entry when a healthy daemon reports a stale identity
Error: ENOENT: no such file or directory, access 'C:\Users\c\AppData\Local\Temp\sfp-packaged-server-noYux0\mcp\index.mjs'
  at ensureLocalServer packages/cli/src/server-session.ts:23:3
  at test/build-identity.test.ts:197:20

Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
```

Green after supplying only test-owned packaged artifacts:

```text
> pnpm exec vitest run test/build-identity.test.ts -t "starts the packaged entry"
exit_code=0

Test Files  1 passed (1)
Tests       1 passed | 6 skipped (7)
```

### Fresh focused verification after both corrections

```text
> pnpm exec vitest run test/build-identity.test.ts
exit_code=0

Test Files  1 passed (1)
Tests       7 passed (7)
Duration    599ms

> pnpm exec oxlint --deny-warnings scripts/build-server.mjs scripts/build-identity.mjs test/build-identity.test.ts
exit_code=0

> pnpm exec oxfmt --check scripts/build-server.mjs scripts/build-identity.mjs test/build-identity.test.ts
exit_code=0
All matched files use the correct format.

> node --check scripts/build-server.mjs; node --check scripts/build-identity.mjs
exit_code=0
```

The actual bounded MCP build also exercised the corrected helper:

```text
> $env:SOURCE_DATE_EPOCH='1700000000'; pnpm --filter @sfp/mcp build; Get-Content -Raw packages/mcp/dist/build-info.json
exit_code=0
Build complete; publint reported no issues.
{"schemaVersion":1,"buildId":1700000000000,"identity":"sha256:8fede76055dfadbf05a890c85b7a7e22ba629e55ebfe59f848872754499aa50f"}
```

### Corrected tested-byte hashes

| Isolated path | SHA-256 |
| --- | --- |
| `service/scripts/build-server.mjs` | `15C9952E40EC51268A54619E88BB9E11DF2655F91F30692D5916DB7ADCE3E718` |
| `service/scripts/build-identity.mjs` | `415A912416B6EB9F82B98D82405DFE9FEBB6202700DBEA121ADA0887BBB70833` |
| `service/test/build-identity.test.ts` | `C37F063A73E53A3FFC94355C0D82FC0C934033DFEA0F7D8590FF885B3BBBB459` |

The main checkout remains unchanged at this boundary: its old `service/scripts/build-server.mjs` hash is `030B22DF09F003B79B0A80E454CDB81F612FB31B0E12A91AE2D8785116116ED0`, and the two new paths are absent. The isolated files remain unstaged and uncommitted.

The review's tentative capabilities-JSON concern was disproved as a current daemon runtime dependency by the reviewer and the controller's main-checkout search. No capability migration or unrelated input-set expansion was made in this task.
