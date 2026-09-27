# T03: pop-up-free, hermetic tooling (K21, VER-8)

- Date: 2026-09-27
- Branch: `rem/t03-t04-tooling`, based on `5be8cc7`
- Plan: [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md), task T03
- Findings: K21 (spawns without `windowsHide`) and VER-8 (packaging and test git commands inherit
  the global git configuration), recorded in the
  [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md)

## Result

Every `child_process` spawn in `service/scripts/` and in the service tests now either passes
`windowsHide: true` or carries a documented exemption. A static guard test enforces this. Packaging
and the git test fixtures run git hermetically. A test proves that a hostile git configuration
leaves the packaged archives byte-identical and invokes no signing program and no hook.

## Changes

### `windowsHide: true` on every spawn (K21)

Code-level spawn sites that lacked the option (56 in total):

| File | Sites |
| --- | --- |
| `scripts/update-service-forks.mjs` | 3 (`git diff --cached`, `git show`, `git cat-file`) |
| `scripts/vendor-upstreams.mjs` | 2 (`gitText`, `gitBytes`) |
| `scripts/verify-staged-change-manifest.mjs` | 5 (`diff --cached`, `show`, `status`, two `rev-parse`) |
| `scripts/verify-upstream-lock.mjs` | 2 (`gitText`, `gitBytes`) |
| `test/authority-class-transition.test.ts` | 2 |
| `test/change-manifest.test.ts` | 10 |
| `test/service-fork-lineage.test.ts` | 16 |
| `test/task-8a-direct-fs-importers.test.ts` | 1 |
| `test/vendor-upstreams.test.ts` | 8 |
| `packages/mcp/test/e2e/mcp-wire.test.ts`, `process-lifecycle.test.ts` | 1 each (the built daemon) |
| `packages/mcp/test/election/leader-lock.test.ts` | 1 |
| `packages/mcp/test/fs/atomic-file.test.ts` | 4 (Node children that take the lease) |

`scripts/package-artifacts.mjs` already hid its git window; it now goes through the hermetic helper
described below.

Eleven programs embedded in string literals also spawn children without the option. They are test
fixtures that model untrusted workload code, so they keep their original shape and carry a
`spawn-hygiene-exempt: <reason>` comment instead:

- `native-environment.test.ts`: a descendant that outlives its root inside the Windows job. The
  broker that starts the root runs with `windowsHide`.
- `native-runner.test.ts`: user code whose descendant keeps inherited output pipes open. The runner
  starts the root with `windowsHide` (`native-runner.ts:630`).
- `native-module-fence.test.ts`, five fixtures: Node children spawned by fenced workload code. The
  fenced parent is started with `windowsHide`, so its children inherit that hidden console.
- `native-module-fence.test.ts`, three fixtures: calls that the fence must refuse before any child
  starts.
- `native-module-fence.test.ts`, one fixture: the options-less promisified `exec` is the case under
  test. The fence adds `windowsHide` itself (`native-module-fence-source.ts:187`), and the child
  transport is mocked.

Adding the option to these fixtures would change what the fence and runner tests exercise; for
example, the promisified `exec` fixture would take a different argument path through the fence.

### Spawn-hygiene guard (`service/test/spawn-hygiene.test.ts`)

The guard parses every `.js`/`.mjs`/`.cjs`/`.ts` file under `scripts/`, `test/` and
`packages/*/test/` with the TypeScript compiler API. It is AST-based rather than a plain grep, so
that it resolves the following:

- named, aliased, namespace and default imports of `node:child_process` or `child_process`;
- `require(...)` bindings, destructuring, and direct member calls such as
  `require('node:child_process').spawn(...)` or `(await import('node:child_process')).spawn(...)`;
- `promisify(...)` wrappers, including aliases such as `const execFileAsync = promisify(execFile)`;
- options given as literals, as same-file `const` objects, or through spreads of those objects.

For each call to `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec` or `execSync` it requires
the literal `windowsHide: true`. An omitted option, `windowsHide: false`, and options it cannot see
statically, such as a helper call's return value, all fail. String and template literals that
mention `child_process` are parsed as programs and checked the same way. A
`spawn-hygiene-exempt: <reason>` comment on the enclosing statement exempts a call or embedded
program. The failure message lists `path:line spawner: problem` for every offender.

A second test feeds the guard a synthetic source with 10 bad shapes and 6 good ones, plus one
exempted call, and asserts exactly the 10 expected lines. This shows that the guard detects what it
claims to detect.

Known limits:

- `fork` is not checked. Node does not document `windowsHide` for `fork`.
- Dynamic member calls such as `cp[name](...)` are not recognized.
- Product code under `packages/*/src` is outside T03's scope and is not scanned.

### Hermetic git (VER-8)

New module `service/scripts/hermetic-git.mjs`:

- `hermeticGitEnvironment(base)` copies the environment without the variables that git itself
  clears before it operates on another repository (`local_repo_env` in git's `environment.c`, which
  includes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`,
  `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and others). It also removes the injected
  `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pairs, `GIT_TEMPLATE_DIR` and `GIT_ATTR_SOURCE`.
  Names are compared case-insensitively, because Windows environment names are case-insensitive.
  The function then sets these variables:
  - `GIT_CONFIG_GLOBAL` to an empty file in a private per-process temporary directory, removed at
    exit;
  - `GIT_CONFIG_NOSYSTEM=1` and `GIT_ATTR_NOSYSTEM=1`;
  - `XDG_CONFIG_HOME` to the same empty directory. `GIT_CONFIG_GLOBAL` does not cover git's default
    global ignore and attributes files, which live under `XDG_CONFIG_HOME` or `~/.config/git/`;
  - `GIT_TERMINAL_PROMPT=0`.
- `hermeticGit(cwd, args, options)`, with `execFileSync` semantics, and `spawnHermeticGit(cwd, args)`,
  with `spawnSync` semantics, run `git -c commit.gpgsign=false -c core.hooksPath= -C <cwd> ...`. They
  pass `windowsHide: true`, ignore stdin, and rewrite `init` to `init --template=` and `commit` to
  `commit --no-verify`.

Users:

- `scripts/package-artifacts.mjs` runs all of its staging git commands through `hermeticGit`.
- The git fixture helpers in `test/change-manifest.test.ts`, `test/authority-class-transition.test.ts`,
  `test/service-fork-lineage.test.ts` and `test/vendor-upstreams.test.ts` use `spawnHermeticGit`.
  The scripts that those tests spawn, which run git against the fixture repositories, receive
  `hermeticGitEnvironment(...)`.

A local experiment with git 2.55.0.windows.5 confirmed the following about `core.hooksPath`:

- An empty `-c core.hooksPath=` disables hooks. A repository-local `post-commit` hook ran without
  the override and did not run with it.
- `--no-verify` alone is not enough, because it does not skip `post-commit` or
  `reference-transaction`.

### Hostile-configuration test (`service/test/package-artifacts-hermetic.test.ts`)

The test builds a minimal service tree in a temporary directory with fake `dist/` outputs. It copies
the real `package-artifacts.mjs`, `release-common.mjs` and `hermetic-git.mjs` into the tree, links
`node_modules` in, and runs the packaging script twice with `SOURCE_DATE_EPOCH` fixed:

1. Reference run: the environment is `hermeticGitEnvironment()`.
2. Hostile run: the environment names temporary files only:
   - `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` point to a config with `commit.gpgsign=true`, a
     `gpg.program` that records its invocation and fails, and a `core.hooksPath` directory holding
     recording `pre-commit`, `commit-msg`, `post-commit` and `reference-transaction` hooks. The
     config also sets `core.autocrlf=true`, an `init.templateDir` with hooks, and a
     `tar.tar.gz.command` that records its invocation and fails;
   - `XDG_CONFIG_HOME` holds a global ignore file (`*.md`) and an attributes file
     (`* text eol=crlf`, `*.json export-ignore`);
   - `GIT_TEMPLATE_DIR` and `GIT_ATTR_SOURCE=HEAD` are set;
   - `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0` inject `commit.gpgSign=true`;
   - `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` point into a decoy repository.

The test asserts four things:

- Both runs exit 0 with empty stderr.
- No recording program ran; the marks directory is empty.
- The decoy repository's `HEAD`, index bytes and config are unchanged.
- The SHA-256 and size of `mcp.tgz`, `cli.tgz`, `plugin.zip` and `artifact-manifest.v1.json` are
  identical across both runs.

Standard input is ignored, so git cannot read an answer from a terminal. The signing program's mark
file stays absent, which shows that git never attempted to sign, so a GUI pinentry prompt cannot
appear. The real `~/.gitconfig` is never read or written. A third test checks the case-insensitive
removal of the variables directly.

## Verification

All commands ran from `service/` in this worktree with the following environment:

- ASCII `TEMP`, `TMP` and `LOCALAPPDATA` under `.worktrees/_cache`;
- a fixed `PLAYWRIGHT_BROWSERS_PATH`;
- Node v24.21.0 (`.node-version` pins v24.17.0; see open items);
- git 2.55.0.windows.5.

Red before the fix:

- The spawn-hygiene guard failed with 69 findings: the 56 code-level sites above, 11 embedded
  programs, and 2 strings in the guard's own synthetic input. Those 2 strings are now exempt,
  because the guard only parses them and never runs them.
- The hostile-configuration test, run against the original `package-artifacts.mjs` from `HEAD`,
  failed. The inherited `GIT_DIR`/`GIT_WORK_TREE` redirected the staging repository into the decoy:
  `update-index --chmod=+x dist/daemon-entry.mjs` reported `does not exist`.
- Three one-off variants of that test, not committed, isolated each channel against the original
  script:
  - The hostile global config alone aborted packaging: `update aborted by the reference-transaction
    hook`.
  - `commit.gpgsign` with `gpg.program` alone made git invoke the signing program: `gpg failed to
    sign the data`. A real gpg setup would prompt here.
  - The `XDG_CONFIG_HOME` ignore and attributes files alone let packaging succeed, but `mcp.tgz`
    differed from the reference, because files were dropped from the archive.

Green after the fix:

```text
node node_modules/vitest/vitest.mjs run test/authority-class-transition.test.ts test/change-manifest.test.ts test/service-fork-lineage.test.ts test/task-8a-direct-fs-importers.test.ts test/spawn-hygiene.test.ts test/package-artifacts-hermetic.test.ts
```

Result: 6 files and 29 tests passed.

```text
node node_modules/vitest/vitest.mjs run test/vendor-upstreams.test.ts
```

Result: 7 tests passed and 60 failed. This matches the baseline taken before any change: the same 7
tests passed and the same 60 failed, with the same `[PROTECTED_AUTHORITY] protected service file
hash mismatch` messages. The failures come from the stale `upstream-lock.json` (K5). They belong to
T05a, and this task must not edit the lock.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/election/leader-lock.test.ts packages/mcp/test/fs/atomic-file.test.ts
```

Result: 56 tests passed and 8 were skipped. The skipped tests are the POSIX-only "real OS probe"
block in `leader-lock.test.ts`, which includes the one spawn changed there.

Static checks:

- `pnpm exec oxlint --deny-warnings` and `pnpm exec oxfmt --check` pass on every file changed by
  T03.
- `pnpm typecheck` passes.

## Not verified locally, and open items

- `packages/mcp/test/e2e/*` did not run. This checkout has no built `dist`, so both suites skip
  through `describe.skipIf(!existsSync(DIST_ENTRY))`. Only the spawn options changed there. The
  leader-lock probe block runs only on POSIX, so the `ubuntu-latest` CI lane covers it.
- The three native-test files with exemption comments (`native-environment`, `native-module-fence`,
  `native-runner`) changed only in comments and were not re-run.
- No window census was taken. T06b owns the census of visible windows. The guard proves the static
  property only.
- The per-task provenance step (regenerating `serviceFiles` hashes and a change-manifest slice with
  the T05a tooling, then `verify-upstream-lock --offline`) was not run, because the T05a tooling
  does not exist yet. `verify-upstream-lock --offline` already failed at baseline, with 93
  `serviceFiles` hash mismatches starting at `README.md`. This task adds mismatches for the files it
  touches.
- The runs used Node v24.21.0 rather than the pinned v24.17.0 from `.node-version`. T04 makes CI use
  the pinned version.
