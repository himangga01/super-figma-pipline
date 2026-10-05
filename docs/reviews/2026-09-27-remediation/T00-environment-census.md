# T00: environment bootstrap and baseline census

Date: September 27, 2026. Base commit: `5be8cc7` (plan documents on top of `0a0f3ad`). Executed by the main session.

## Environment

- Windows 11 with a Korean locale. The user profile path contains Korean characters.
- Node.js `v24.21.0`. `.node-version` pins `24.17.0`; the version is within `engines` (`>=24 <25`), and the difference is recorded, not corrected.
- `pnpm@11.24.0` through Corepack 0.36.0. `pnpm` is not on the system `PATH`, and package scripts call `pnpm` directly. User-local shims were created with `corepack enable --install-directory .worktrees/_cache/bin pnpm`. That directory is prepended to `PATH` for validation runs. The system configuration is unchanged.
- Git 2.55 (Git for Windows). The system configuration sets `core.autocrlf=true`. `service/.gitattributes` forces LF inside `service/`, so service hashes are unaffected.

## Separate working copies

- Validation and implementation run in git worktrees under `.worktrees/` (ignored by `.gitignore`):
  - `baseline`: detached at the base commit;
  - one task worktree per lane.
- The integration branch is `remediation/2026-09-27`, in the main checkout.
- These worktrees share the Windows user's privileges, process namespace and network. They are not security sandboxes.

## Provisioning

- `pnpm install --frozen-lockfile --ignore-scripts`: all 200 packages were reused from the existing pnpm store, and nothing was downloaded.
- Playwright `1.63.0` Firefox (`firefox-1543`) was installed into the fixed path `.worktrees/_cache/ms-playwright`, used as `PLAYWRIGHT_BROWSERS_PATH` (decision D4).
- `code-kb/` was re-cloned at the SHAs pinned by the CI workflow:

  | Upstream | Pinned SHA |
  | --- | --- |
  | figwright | `a835e81b` |
  | figma-mcp-rust | `60945664` |
  | figmosha2 | `547cefb4` |

  Git for Windows' system `core.autocrlf=true` checked out figma-mcp-rust and figmosha2 with CRLF. They were re-checked out with a local `core.autocrlf=false`; all three now have LF working trees. Each worktree links `code-kb` with a directory junction.

## Environment probe

| Item | Result |
| --- | --- |
| Executable resolution | In Git Bash, the bare name `whoami.exe` resolves to Git's MSYS `whoami`, which rejects `/user`. Production code calls `whoami.exe` and `icacls.exe` by bare name (K11). This breaks state-permission verification whenever the daemon or the tests run from a shell whose `PATH` lists Git's `usr/bin` before `System32`. Moved into T01 (lane A) as the K11 bare-name fix. |
| Non-ASCII paths | The default `TEMP` and `LOCALAPPDATA` are under the Korean profile path (OPS-1). The census used ASCII overrides under `.worktrees/_cache/`. |

## Baseline census (ASCII `TEMP`/`LOCALAPPDATA`, pnpm shims on `PATH`)

Static gates, each run separately:

| Gate | Result | Cause |
| --- | --- | --- |
| `typecheck` | pass (once `pnpm` is on `PATH`) | — |
| `build` | pass (once `pnpm` is on `PATH`) | — |
| `lint --deny-warnings` | fail | `no-shadow` and `no-map-spread` warnings in `portal/recipes/core-consumption.ts`, `portal/native-work.ts` and `test/portal/native-work.test.ts` |
| `format:check` | fail | 13 files, including the minified `core-consumption.ts` |
| `knip` | fail | Unused exports `verifyConsumptionObservations` and `consumptionBatchHash` (K1) |
| `verify-upstream-lock --offline` | fail | `PROTECTED_AUTHORITY`: `README.md` hash mismatch (K5) |

Vitest (`--exclude test/artifact-contents.test.ts`) took 426 s. Of 4,146 tests, 3,989 passed, 116 failed and 41 were skipped.

| Group | Failures | Cause | Owner |
| --- | --- | --- | --- |
| Tool-contract drift | 13 | 128-tool registry versus literal counts, docs-sync, plugin contract, an untyped schema property, node-id coverage | T02 (lane B) |
| Stale upstream lock | 60 (`vendor-upstreams`) | `PROTECTED_AUTHORITY` fires before the checks under test | T05a |
| Recipe-consumption defects | 30 (`native-work` 27, `operational-native` 2, `preview-native` 1) | `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` / `PORTAL_VALIDATION_REQUIRED` (SVC-1, K1) | T13, T14 |
| Executable resolution | 10 (`runtime-paths` 3, `workspace-config-store` 2, `identity-bootstrap-coordinator` 1, `process-lifecycle` 3, `mcp-wire` file-level) | MSYS `whoami` shadowing | T01 |
| Other | 3 | Windows run of a Linux bind-mount case; 6 MiB image-fetch timeout (31.7 s); a consumption-input error-code expectation | T02 triage |

A rerun of the executable-resolution group with `System32` first on `PATH` passed. That confirms the cause.

## Decisions applied for this execution

The owner instructed "proceed", and to commit and push when the work is complete. The plan's recommended defaults apply unless the owner revises them:

| Decision | Applied default |
| --- | --- |
| D2 | Keep the 3% threshold; add per-root waivers and absolute-bounds oracles. |
| D3 | Discard recipe-hold history after release. |
| D4 | Keep Playwright pinned; use a fixed browser path. |
| D5 | Redact `fileKey`. |
| D6 | Adopt asynchronous long operations. |
| D7 | A reset requires all clients stopped and an explicit confirmation. |
| D8 | Keep per-candidate profile approval with `reprepare --from`. |
| D9 | No intermediate pushes. CI evidence comes from the final push of the remediation branch. |
| D1 | Remains an owner decision before any C2/C3 support claim. |

## Superpowers

The owner instructed the use of the latest Superpowers plugin (Anthropic Directory `Superpowers` 6.4.1, by obra). An install card was presented, but at the time of this census the plugin was not enabled in the session. Until it is, subagents follow the same disciplines manually: test-first, systematic debugging, and verification before completion. The repository's AGENTS.md prohibition on Superpowers is superseded for this work by the owner's explicit instruction.
