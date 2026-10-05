# T04: CI and static-gate truthfulness (K6, VER-1, VER-6/VER-7 checkJs)

- Date: 2026-09-27
- Branch: `rem/t03-t04-tooling`, on top of the T03 commit
- Plan: [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md), task T04, and decision
  D4 (Firefox in a fixed `PLAYWRIGHT_BROWSERS_PATH`)
- Findings, recorded in the [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md):
  - K6: CI checks out a shallow history while a test runs `git show`.
  - VER-1: CI never installs Firefox, the native Vite test is never enabled, and `verify:source`
    does not record skipped suites.
  - VER-6/VER-7, checkJs part only: scripts and root tests are never type-checked.

## Result

- CI reports every gate separately, installs the pinned Playwright Firefox, and verifies provenance
  against the checked-out upstreams. It also runs an owner-like Windows lane with Korean-character
  paths and a nightly native React/Vite acceptance job.
- Skipped tests are visible:
  - `verify:source` records every skipped test from Vitest's JSON report.
  - A skipped required suite fails unless `SFP_ALLOW_SKIP=<suite>` names it.
  - The Firefox tests fail with an install hint instead of skipping silently.
- `pnpm typecheck` now also type-checks `scripts/**/*.mjs` and `test/**/*.ts` through
  `tsconfig.tools.json`.

## Changes

### CI workflow (`.github/workflows/service-ci.yml`)

- The repository checkout uses `fetch-depth: 0` (K6), because
  `test/task-8a-direct-fs-importers.test.ts` reads blobs at a pinned commit.
- `actions/setup-node` reads `node-version-file: service/.node-version` (v24.17.0). Before this
  change the workflow pinned 24.19.0.
- Installation runs `corepack pnpm install --frozen-lockfile --ignore-scripts`.
- `PLAYWRIGHT_BROWSERS_PATH` is fixed to `$RUNNER_TEMP/ms-playwright`, or to a Korean-character path
  in the non-ASCII lane. Firefox is installed with the following commands:
  - on Linux, `corepack pnpm --filter @sfp/cli exec playwright install --with-deps firefox`;
  - on Windows, the same command without `--with-deps`.
- The former `corepack pnpm verify` step is split into separate gates, and each gate has its own step:
  - provenance, `--offline`;
  - provenance, `--with-upstreams ../code-kb`;
  - typecheck;
  - lint;
  - format;
  - knip;
  - the T02 placeholder;
  - build;
  - test;
  - the test skip census;
  - graph memory;
  - SBOM;
  - notices;
  - packaging;
  - checksums;
  - artifact contents;
  - the isolated packed runtime.
- Every gate has `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`. The brief asked
  for `if: always()`. This condition keeps the property that matters: each gate reports even after
  an earlier gate fails. It differs from `always()` in two cases:
  - after a cancellation, it stops, as GitHub recommends;
  - after a failed dependency installation, it skips the gates, which would otherwise only produce
    noise.
- The new step `node scripts/verify-upstream-lock.mjs --with-upstreams ../code-kb` checks the lock
  against the three upstream checkouts. The script requires the root argument.
- The matrix has three entries:
  - `windows-latest` (default): required.
  - `windows-latest` (`non-ascii-paths`): required. A `pwsh` step points `TEMP`, `TMP`,
    `LOCALAPPDATA` and `PLAYWRIGHT_BROWSERS_PATH` at
    `$RUNNER_TEMP\사용자-한글경로\...`. Corepack's cache and the pnpm store follow `LOCALAPPDATA`,
    so they move there too. This lane is expected to fail until T01 (OPS-1, lease protocol v2)
    lands. It is left required on purpose, because it mirrors the owner's machine.
  - `ubuntu-latest`: informational, through `continue-on-error: ${{ matrix.os == 'ubuntu-latest' }}`.
- The new `native-vite-acceptance` job runs on `schedule` (nightly at 18:17 UTC, which is 03:17
  KST) and on `workflow_dispatch`, on `windows-latest`:
  - It runs `packages/mcp/test/portal/native-artifacts.test.ts` with
    `SFP_NATIVE_VITE_ACCEPTANCE=1`.
  - It then runs `node scripts/test-skip-census.mjs <report> --forbid-skips`, so that a renamed flag
    cannot turn the acceptance test back into a silent skip.
- The placeholder step `node scripts/update-contracts.mjs --check || true` carries a comment saying
  that T02 owns it, and that `|| true` should become `git diff --exit-code` once T02 lands. T04 does
  not write the generator.

### Package-manager entries without Windows-only paths

New module `scripts/package-manager-entry.mjs`:

- `resolvePnpmEntry()` uses `npm_execpath` only when its file name is pnpm's (`pnpm`, `pnpm.cjs`,
  `pnpm.js`). Otherwise it uses corepack's `pnpm` bin, found with `require.resolve('corepack/package.json')`.
- `resolveNpmEntry()` does the same with `npm-cli.js` and `require.resolve('npm/package.json')`.

Both search the Node.js installation's own package directory, `<dir>/node_modules` on Windows and
`<prefix>/lib/node_modules` on POSIX. Both throw `PNPM_ENTRY_NOT_FOUND`/`NPM_ENTRY_NOT_FOUND` with a
remedy. The previous code had two problems:

- It joined `dirname(process.execPath)` with `node_modules/...`, which exists only in the Windows
  layout.
- It accepted any `npm_execpath`. Under `npm run`, `release-common.mjs` would have run `npm list -r`,
  which is the wrong tool.

Users:

- `release-common.mjs:49-50`, in `installedPackages()` for the SBOM and notices;
- `smoke-packed-mcp.mjs:10`;
- `run-source-checks.mjs`, which had the same pnpm fallback.

### Visible skips

- `scripts/test-skip-census.mjs` (new) parses a Vitest JSON report.
  - It lists every test whose status is not `passed` or `failed`, with its file, full name, status
    and, if any, its required suite.
  - `REQUIRED_SUITES` currently holds one suite, `firefox`. It lists the four test files that launch
    Playwright Firefox. A skipped test in one of those files blocks, unless `SFP_ALLOW_SKIP`, a comma-
    or space-separated list, names the suite.
  - `--forbid-skips` makes any skip blocking.
  - The command-line form prints the census and exits 1 with `REQUIRED_SUITE_SKIPPED: <suites>`. It
    can also write the census as JSON (`--out`).
- `vitest.config.ts` adds a JSON reporter when `SFP_VITEST_JSON_REPORT` is set. `verify:source` and
  CI use this; normal runs are unchanged.
- `scripts/run-source-checks.mjs`:
  - It runs the `verify` check with `SFP_VITEST_JSON_REPORT=artifacts/source-checks/vitest-report.json`.
  - It publishes `artifacts/source-checks/test-skips.json`.
  - It fails with `SOURCE_CHECK_FAILED:required-suite-skipped:<suites>` when a required suite
    skipped without an allowance, and with `SOURCE_CHECK_FAILED:vitest-report-missing` when the
    report is missing.
  - The final `source-checks-report.json` moves to `schemaVersion: 2`, with a `testSkips` field that
    holds the report path, the allowed suites, the skipped required suites and every skipped test.
    No code reads this report.
- `test/support/required-suite.ts` (new) is the runtime half. `requireFirefox(context, firefox.executablePath())`
  behaves as follows:
  - If the browser is missing, it throws `REQUIRED_SUITE_PREREQUISITE_MISSING` with the install
    command `corepack pnpm --filter @sfp/cli exec playwright install firefox`.
  - If `SFP_ALLOW_SKIP` includes `firefox`, it calls `context.skip(...)` instead.
- The four Firefox test files use the gate:
  - `packages/cli/test/browser-observation.test.ts` used
    `describe.skipIf(!existsSync(firefox.executablePath()))`, which skipped the whole file silently.
    It now gates every test in `beforeEach`, and `beforeAll` launches the browser only when it
    exists.
  - `packages/mcp/test/portal/preview-consumption.test.ts` gates every test in a file-level
    `beforeEach`. This includes one test that does not need the browser; the file as a whole is the
    registered suite.
  - `preview.test.ts` gates two tests and `preview-native.test.ts` gates one. These tests used to
    fail with Playwright's generic `Executable doesn't exist`, which suggests an install command
    that ignores the fixed path.
- A root test (`test/test-skip-census.test.ts`) keeps the registry honest in both directions:
  - every test file that imports `firefox` from `playwright` is registered;
  - every registered file calls `requireFirefox(`.
- Bare `return` guards became `context.skip(<reason>)`, so these cases now show up as skipped
  instead of passing:
  - platform guards in `operation-evidence-artifact-store.test.ts` (Windows lease test) and
    `workspace-policy.test.ts` (reserved device names; `it.each` became `it.for` to receive the
    context);
  - symlink-privilege `EPERM` returns in:
    - `atomic-file.test.ts` (`it.for`);
    - `local-tool-boundary.test.ts`;
    - `operation-evidence-artifact-store.test.ts`, three sites (one `it.for`) plus two link
      capability probes that accept `EPERM`, `ENOTSUP` or `EACCES`;
    - `repo-walk.test.ts`;
    - `e2e/packed-operation-evidence.test.ts` (`it.for`).

  `it.for` keeps the `%s` titles unchanged.

### Type-checking scripts and root tests (checkJs)

`service/tsconfig.tools.json` (new) extends the base config. It sets `noEmit`, `allowJs`, `checkJs`,
`allowImportingTsExtensions` (three scripts import `.ts` sources through Node's type stripping),
`types: ["node"]` and `lib: ["ES2024"]`. It covers:

- `scripts/**/*.mjs`;
- `test/**/*.ts`;
- `@figma/plugin-typings/plugin-api.d.ts` from the plugin package, with
  `test/types/figma-plugin-globals.d.ts` declaring `figma`.

The root tests import the plugin handler sources, which need Figma's global types. The typings'
`index.d.ts` cannot be used, because it redeclares `setTimeout` and `console` and would break the
Node sources in the same program. Without the typings, 428 `Cannot find name` errors appear in plugin
files.

`package.json` changes:

- `"typecheck": "pnpm -r run typecheck && pnpm run typecheck:tools"`;
- `"typecheck:tools": "tsc -p tsconfig.tools.json"`.

As a result, `pnpm verify` and `verify:source` include the new check.

`noImplicitAny` is `false` in this config only. The plain `.mjs` scripts carry no parameter types:

- With `noImplicitAny` on, the program reports 349 errors, all in scripts; the root tests are
  clean.
- With it off, 32 real type errors remain. All other `strict` checks stay on, including
  `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `useUnknownInCatchVariables`.

Annotating about 320 parameters would churn provenance scripts that T02 and T05a are about to change.
Turning `noImplicitAny` on is left as a follow-up.

The 32 errors were fixed with annotations that preserve behavior:

- JSDoc `@type` casts for `catch` values and for indexed reads that are guarded earlier;
- explicit function types for the `fail` helpers (`=> never`) and `assert` (`asserts condition`),
  so that TypeScript narrows after them;
- element types for arrays that start empty (the artifact manifest and the fork transaction);
- `@param {number | null}` for a parameter whose default is `null`;
- a `Promise<void>` context for a listen callback, and an `AddressInfo` cast;
- `node.arguments[0] !== undefined` instead of `node.arguments.length > 0` in two AST walkers. The
  two are equivalent, because the node array has no holes.
- `graph-memory-child.mjs` keeps its throwing `globalThis.gc()` call, cast rather than made
  optional.

## Verification

Commands ran from `service/`. The environment used ASCII `TEMP`/`TMP`/`LOCALAPPDATA` under
`.worktrees/_cache`, `PLAYWRIGHT_BROWSERS_PATH=.worktrees/_cache/ms-playwright` (Firefox 1543),
Node v24.21.0 and git 2.55.0.windows.5. Focused runs only; the full suite was not run.

### Firefox path with an empty `PLAYWRIGHT_BROWSERS_PATH`

The runs used the four Firefox files: `packages/cli/test/browser-observation.test.ts` and
`packages/mcp/test/portal/{preview,preview-consumption,preview-native}.test.ts`.

| Run | Result |
| --- | --- |
| Before the change (`browser-observation` and `preview` files only) | The `browser-observation` file was silently skipped (5 tests skipped). The two `preview` Firefox tests failed with Playwright's `Executable doesn't exist`. |
| After the change, no `SFP_ALLOW_SKIP` | Exit 1: 21 tests failed with `REQUIRED_SUITE_PREREQUISITE_MISSING: Playwright Firefox is not installed at ...\firefox-1543\firefox\firefox.exe. Install it into PLAYWRIGHT_BROWSERS_PATH with "corepack pnpm --filter @sfp/cli exec playwright install firefox". Set SFP_ALLOW_SKIP=firefox ...`; 1 pure test passed. |
| After the change, `SFP_ALLOW_SKIP=firefox` | Exit 0: 21 tests skipped visibly and 1 passed. |
| Census over the allowed run's JSON report | Without `SFP_ALLOW_SKIP`, exit 1 with `REQUIRED_SUITE_SKIPPED: firefox`. With `SFP_ALLOW_SKIP=firefox`, exit 0, and the census lists all 21 skips with `[required: firefox]`. |
| Firefox installed | 21 passed and 1 failed. The failure is `preview-native.test.ts` with `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` at `native-work.ts:794`. It fails identically with the file from `HEAD`, so it is pre-existing and outside this task. |

### `run-source-checks.mjs` plumbing

This check used a temporary copy of the script. The copy differed only in its `checks` array: one
fast `verify` check that runs `browser-observation.test.ts`. The copy was deleted afterwards.

| Case | Result |
| --- | --- |
| Firefox missing, `SFP_ALLOW_SKIP=firefox` | Exit 0. The report has `schemaVersion: 2`, with `testSkips.allowedSuites: ["firefox"]` and 5 skipped tests. |
| Firefox missing, no allowance | `SOURCE_CHECK_FAILED:verify`. The captured log shows the prerequisite message. |
| Firefox present, 4 tests filtered away with `-t` | `SOURCE_CHECK_FAILED:required-suite-skipped:firefox`. This is the census gate on its own. |

### Seeded type error

`Math.max('seeded type error')` was appended to `scripts/generate-checksums.mjs`:

- `pnpm typecheck:tools` exited 2 with
  `scripts/generate-checksums.mjs(12,25): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'`.
- `pnpm typecheck` failed the same way.

After the seed was removed (`git checkout`), `pnpm typecheck:tools` exited 0.

### Focused tests

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run test/test-skip-census.test.ts test/package-manager-entry.test.ts test/spawn-hygiene.test.ts test/package-artifacts-hermetic.test.ts test/authority-class-transition.test.ts test/change-manifest.test.ts test/service-fork-lineage.test.ts test/task-8a-direct-fs-importers.test.ts` | 8 files, 39 tests passed. |
| `node node_modules/vitest/vitest.mjs run test/vendor-upstreams.test.ts` | Same 7 passed / 60 failed as the untouched baseline: the stale `upstream-lock.json` (K5, T05a). |
| The six files whose guards changed: `atomic-file`, `local-tool-boundary`, `operation-evidence-artifact-store`, `repo-walk`, `workspace-policy`, `e2e/packed-operation-evidence` | 168 passed, 2 skipped (existing POSIX-only tests), 1 failed. The failure is `workspace-policy` "rejects a nested Linux bind mount hidden behind an in-root lexical alias", which fails identically at `HEAD` on Windows. On this machine the symlink calls succeeded, so the new `context.skip` paths did not trigger. |
| `resolvePnpmEntry()`/`resolveNpmEntry()` against the running Node, plus `installedPackages()` | `C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js` and `...\npm\bin\npm-cli.js`; `pnpm list` through the resolved entry returned 51 packages. |

### Static checks

- `pnpm typecheck` passed. This covers five packages plus `typecheck:tools` with 0 errors.
- `pnpm exec oxlint --deny-warnings` and `pnpm exec oxfmt --check` passed on every file changed by
  T04.
- `pnpm knip` reports only the two pre-existing unused exports in
  `packages/mcp/src/portal/recipes/core-consumption.ts`. Another lane owns that file.

## Not verified locally, and open items

- **The CI workflow has not run.** `gh` is unauthenticated here, and decision D9 (branch pushes for
  CI evidence) is pending. The YAML parses, and its jobs, conditions and matrix were checked with
  the `yaml` package, but no runner executed it. The following are expected on the first run:
  - Both provenance steps fail until T05a refreshes `upstream-lock.json`.
  - The non-ASCII Windows lane fails until T01 lands.
  - The contracts step only reports until T02 lands.
- The nightly job needs network access to the npm registry (locked React/Vite preset). It has not
  been run here.
- `packages/mcp/test/portal/native-artifacts.test.ts` still builds its npm path as
  `dirname(process.execPath)/node_modules/npm`, which exists only on Windows. The nightly job runs on
  Windows, so it is unaffected. The task scope named only the two scripts.
- Only `firefox` is registered as a required suite. The built-dist e2e suites still skip through
  `describe.skipIf(!existsSync(DIST_ENTRY))` when `dist` is missing. The census now lists those
  skips, but they do not block. In `verify:source` and CI the build runs before the tests.
- `noImplicitAny` is off for the tools program (see above).
- The per-task provenance step (T05a tooling, `verify-upstream-lock --offline`) was not run. The
  tooling does not exist yet, and the lock was already stale at baseline.
- Local runs used Node v24.21.0, not the pinned v24.17.0.
