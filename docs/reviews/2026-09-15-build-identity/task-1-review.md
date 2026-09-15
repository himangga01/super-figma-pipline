# Task 1 Review: Daemon Build Identity

## Verdicts

- **Specification compliance: Changes requested.** The current implementation binds the present CLI collector sources, package sources, manifests, lockfile, build entry, helper, and explicit TypeScript/tsdown configuration. Its basename-based source exclusions do not satisfy the requirement to exclude tests only when they are not runtime inputs.
- **Code quality: Changes requested.** The hashing format and deterministic ordering are clear, but the stale-daemon test is coupled to ignored generated artifacts and is not reliable from a clean source checkout.

## Findings

### Medium — Runtime inputs can be silently excluded by directory name

**File:** `service/scripts/build-identity.mjs:26` (used at line 59)

`walkSource` skips every directory named `test`, `tests`, or `__tests__` below each enumerated `src` root without checking whether the daemon build imports a file from that directory. A legitimate runtime helper at, for example, `packages/mcp/src/test/runtime-helper.ts` would be bundled if an entry imports it, yet changes to it would leave the advertised identity unchanged. This conflicts with the brief's explicit condition that tests may be omitted only when they are not actual runtime inputs. The added exclusion test does not cover this branch: it creates `packages/cli/test/...`, which is already outside `packages/cli/src` and would be ignored even if `ignoredDirectoryNames` did not exist. Enumerate all regular files under the selected `src` roots, or exclude only files proven not to participate in the runtime build.

### Medium — Stale-daemon test depends on untracked build output

**File:** `service/test/build-identity.test.ts:157`

The test calls the real `runtimePaths()`, which resolves `@sfp/mcp` through `packages/mcp/dist/index.mjs`, and then reads `packages/mcp/dist/build-info.json`. `git ls-files -- packages/mcp/dist/**` returns no files and `.gitignore` excludes `dist`, so the focused test only passes when a prior build has populated those artifacts. A clean checkout running the documented focused command before a build can fail during package resolution or the build-info read, unrelated to the behavior under test. Make the expected entry/build-info paths injectable, mock package resolution at the boundary, or place the comparison test in a focused CLI test that supplies temporary packaged artifacts.

## Verified observations

- The three reviewed file hashes match the hashes recorded in `task-1-report.md`.
- `packages/mcp/src/index.ts` imports `packages/mcp/package.json`, and that manifest is included in `requiredFiles`.
- `packages/shared/src/capability-manifest.ts` imports three root `capabilities/*.json` files, but the module is not exported from `packages/shared/src/index.ts` and is not imported by the current MCP/CLI/IR runtime graph. Those JSON files are therefore not current daemon build inputs. If this module later enters the daemon graph, the directory-walk design will not discover its out-of-tree JSON imports.
- No ignored-name directories currently exist below the four selected `src` roots; the first finding concerns the helper's promised behavior for an actual runtime import, not a currently omitted file.

## Cannot verify

- I did not rerun the reported red/green sequence, focused tests, package builds, typechecks, lint, or formatting checks. The review constraints prohibit broad reruns, and code inspection identified the two concerns above without requiring a bounded test.
- The report's historical command outputs and claimed execution order are not independently attestable from repository state alone.

## Scoped Fix Round 1 Re-review

### Verdicts

- **Specification compliance: Pass.** The corrected implementation satisfies the Task 1 input-binding requirements reviewed here.
- **Code quality: Pass.** Both prior findings are addressed, and the scoped fix introduces no new finding.

### Prior finding status

1. **Runtime inputs silently excluded by directory name: ADDRESSED.** `walkSource` now traverses every directory beneath the four selected `src` roots. The new regression explicitly places an imported runtime helper below `packages/mcp/src/test` and verifies that changing it changes the identity. Test, generated, and coverage directories outside the selected source roots remain outside the identity set.
2. **Stale-daemon test depends on untracked build output: ADDRESSED.** The test mocks the package-resolution boundary and creates its own temporary `index.mjs` and adjacent `build-info.json`. It still exercises the production `runtimePaths`, build-info validation, health/status comparison, and spawn decision, and it asserts the temporary entry is the spawn target. It no longer depends on `packages/mcp/dist`.

### New findings

None.

### Verification scope

- The corrected file hashes match the Round 1 table in `task-1-report.md`.
- I did not rerun the reported tests or build. The scoped diff and affected code paths were sufficient to resolve the two prior findings without a bounded rerun.
