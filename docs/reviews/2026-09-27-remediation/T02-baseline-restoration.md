# T02 and P0 baseline restoration (lane B)

Date: September 27, 2026. Branch `rem/p0-baseline`, based on `5be8cc7`. Scope: T02 of the [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md), repair of the pre-existing static-gate failures, and triage of the pre-existing test failures (findings K3, K4, VER-5 and K20 in the [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md)).

## Environment and protection limits

- Working copy: `C:\2026_project\super-figma-pipline\.worktrees\lane-b`, a git worktree. All commands ran from `service/`.
- Toolchain: Node.js 24.21.0 (the repository pins 24.17.0 in `.node-version`; T04 aligns CI with it), pnpm 11.24.0 through the corepack shim in `.worktrees/_cache/bin`.
- Environment for every command: `C:\Windows\System32` first on `PATH` (Git's MSYS `whoami` otherwise shadows `whoami.exe`), ASCII `TEMP`, `TMP` and `LOCALAPPDATA` under `.worktrees/_cache`, and `PLAYWRIGHT_BROWSERS_PATH` set to the shared cache.
- Protection limits: the worktree is a separate checkout, not a sandbox. It shares the Windows user's filesystem privileges, process namespace and network with every other lane and with the owner's session. Tests start real PowerShell, `whoami.exe`, `icacls.exe`, Firefox and daemon processes. No Docker, VM or WSL was used.

### Cross-lane incident

The session scratchpad is shared by every lane agent. This lane created a scratchpad `env.sh` that changed into lane B; lane D overwrote the same file at 20:15:24 with one that changed into `.worktrees/lane-d`. As a result:

- This lane's commands that sourced the file after 20:15 ran in lane D. `pnpm lint` (including pnpm's pre-run dependency check, which reported "Already up to date" and failed to link one bin because lane D had no `packages/mcp/dist`), `oxfmt --check`, `knip` and a read-only AST comparison were read-only.
- One `oxfmt` write at 20:18:04 reformatted 13 files in lane D's worktree.
- Between about 20:13 and 20:15 the file pointed at lane B, so lane D's commands in that window may have run here. Lane B's `git status` was clean afterwards.

Those 13 lane-D files were byte-identical to the formatting committed here in `7c23bca`. This lane's attempt to restore them in lane D was refused by the permission policy. A later read-only check found lane D's working tree clean and its branch (`1da01f9`) free of those changes, so lane D discarded them itself. From 20:18 on, every command in this lane used explicit absolute paths and a lane-specific environment.

## Commands

```sh
node node_modules/oxlint/bin/oxlint --deny-warnings .      # also: pnpm lint
node node_modules/oxfmt/bin/oxfmt --check .                 # also: pnpm format:check
node node_modules/knip/bin/knip.js                          # also: pnpm knip
pnpm typecheck
pnpm build
pnpm contracts:update [--check]
node node_modules/vitest/vitest.mjs run <paths>             # focused runs
node node_modules/vitest/vitest.mjs run --exclude "test/artifact-contents.test.ts" \
  --reporter=dot --reporter=json --outputFile.json=<report>  # one full run
node scripts/check-test-report.mjs <report> --log <console output>
```

## Baseline before this work

Census of `5be8cc7`, run by the main session:

- `pnpm lint`: failed on 12 warnings (11 `no-shadow`, 1 `no-map-spread`).
- `pnpm format:check`: 13 files unformatted, including the minified `core-consumption.ts`.
- `pnpm knip`: 2 unused exports (`verifyConsumptionObservations`, `consumptionBatchHash`).
- Full suite: 4,146 tests; 3,989 passed, 116 failed, 41 skipped. The failures were in 19 files, plus one failed suite without a failed test (`e2e/mcp-wire`).

| Group | Failures | Disposition |
| --- | --- | --- |
| A. Tool-contract drift | 12 | Fixed by T02 |
| B. Other genuine failures | 4 | Triaged and fixed (below) |
| C. Known defects | 90 | Ledgered (below) |
| Environment | 10 and the `mcp-wire` suite | Pass with `System32` first on `PATH`; lane A fixes the lookup in code |

The environment group was `runtime-paths` (3), `workspace-config-store` (2), `identity-bootstrap-coordinator` (1), `e2e/process-lifecycle` (3), `native-module-fence` (1) and the `mcp-wire` suite. `native-module-fence` was not in the census summary; it also passes with the corrected `PATH`. A focused run of `runtime-paths`, `workspace-config-store`, `identity-bootstrap-coordinator` and `native-module-fence` had 97 tests: 93 passed, 4 skipped, none failed.

## Commits

| Commit | Content |
| --- | --- |
| `7c23bca` | Static gates: formatting, shadowing renames, knip `@public` tags |
| `37f931a` | T02: contract generator, derived-equality tests, registry fixes |
| `5b3e5fb` | Triage of the three group B findings |
| `0f3fd6e` | Known-failure ledger and report checker |
| `39be314` | Remaining-work plan ledger update |
| `90e140b` | This evidence note |
| `957d3ec` | Generator scripts made clean under lane D's `checkJs` settings (no output change) |

## Static gates

- **Formatting.** `oxfmt` reformatted the 13 files. A structural comparison of the TypeScript ASTs before and after (ignoring trivia, redundant parentheses and trailing commas) shows every file unchanged except four with sorted import declarations, none of them side-effect imports.
- **Lint.** Shadowing callback parameters were renamed (`key`→`field`, `value`→`candidate`/`variable`/`interaction`, `asset`/`screen`→`candidate`, and `run`/`signal`→`appliedRun`/`verifySignal` in `native-work.ts`). The one `no-map-spread` warning keeps its copy on purpose: the parsed request must not be mutated, and the map is bounded at 4,096 reviews. It carries a justified suppression.
- **Knip.** `verifyConsumptionObservations` and the `consumptionBatchHash` re-export are tagged `@public` with a comment naming T14a/T14b, which wire them. They were not deleted.
- **Behavior.** Focused portal, IR and CLI tests over the changed files failed exactly as in the census: the same 31 known failures by name, and nothing else.

## T02: generated tool contracts

### Generator

`pnpm contracts:update` runs `scripts/update-contracts.mjs` over `scripts/contracts-lib.mjs`. With `--check` it writes nothing and exits 1 when any artifact is stale. From `ALL_TOOL_SPECS`, the runtime registry and the plugin contract derivation it regenerates four artifacts:

- **`capabilities/union-manifest.json`.** Recorded upstream rows keep their provenance; their target hash and policy ID are refreshed. Portal rows are rebuilt exactly as `update-portal-contracts.mjs` built them. Target hashes use the same bytes as `update-target-contracts.mjs` and the old tool-contract test: SHA-256 of `schemaContractJson(inputSchema, resultSchema)`. Source hashes for service-defined rows use the portal script's formula.
- **`packages/mcp/test/plugin-contract.json`.** The derivation in `plugin-contract.ts`, stamped with `MIN_PLUGIN_VERSION`. Drift is classified as SILENT, REMOVED or LOUD, as the old gate did. The generator refuses to recreate a missing file, because a regenerated baseline proves nothing.
- **`service/README.md` and `packages/mcp/README.md`.** A generated `**N MCP tools**` block between `tool-count` markers.

Output is formatted with the `oxfmt` API and the project's `.oxfmtrc.json`, so regenerated files are format-clean. Two runs are idempotent.

Classification is explicit. A registry tool must be exactly one of: a tool with a recorded upstream row, a portal-contract tool, or a tool declared in `SERVICE_LOCAL_TOOLS`. Anything else stops generation with a message naming the three options and `pnpm contracts:update`. No upstream contract is invented.

The regeneration refreshed stale target hashes for 16 rows (the nine portal tools, `get_styles`, `get_fonts`, `get_design_context`, `component_map`, `token_map`, `create_variable_collection` and `create_variable`). It also added honest service-native rows for the three service-local tools:

| Tool | Source reference | Implementation | Test |
| --- | --- | --- | --- |
| `portal_capture_read` | `mcp/src/tools/portal-capture.ts` | plugin handler `portal-capture-read.ts` | `mcp/test/portal/desktop-capture.test.ts` |
| `portal_capture_asset` | `mcp/src/tools/portal-capture.ts` | plugin handler `portal-capture-asset.ts` | `mcp/test/portal/desktop-capture.test.ts` |
| `set_annotations` | `mcp/src/tools/set-annotations.ts` | plugin handler `set-annotations.ts` | `plugin/test/handlers/set-annotations.test.ts` |

Each row's only source contract is `super-figma-pipeline` with the hash of the service's own input schema, `disposition: native` and `availability: connected-plugin`.

The generated README line reads: 128 MCP tools, 125 from the canonical capability catalog plus 3 service-local tools, 109 with a Figma plugin handler and 19 server-only. The `service/README.md` sentence next to it now says that `tools list` does not need a running daemon, which is what the CLI implements (part of VER-9).

`update-target-contracts.mjs` and `update-portal-contracts.mjs` are superseded but kept, because `upstream-lock.json` registers them; T05a can retire them with its provenance refresh.

### Tests

The tests assert derived equalities instead of literal counts. Removed literals: 125 (registry and manifest), 106 (handlers), 99/26 (execution split), 127 (CLI), 128 (both policy tests) and 81 (write tools), plus the hand-kept 128-name list in `operation-policy.test.ts`.

- `tool-contract.test.ts`:
  - result schemas, runtimes and handlers equal the registry (handlers are the registry minus the explicit server-only list);
  - execution adapters equal the explicit adapter list;
  - the manifest's canonical rows equal the upstream canonical catalog (every upstream-sourced row plus the portal contract, 125 rows) plus `SERVICE_LOCAL_TOOL_NAMES`;
  - no row mixes upstream and service provenance;
  - service-local rows are honest service-native rows.
- `upstream-parity.test.ts` asserts containment: every Figwright tool and the four safe-union tools stay registered, and the server-only set is unchanged.
- `admin-commands.test.ts` expects the CLI to list exactly the registry names.
- `docs-sync.test.ts` requires exactly one generated claim per README, equal to the committed manifest's row count, and no hand-written claim outside the block.
- `contract-drift.test.ts` is the only test that compares the live registry with the committed artifacts. Its failure names `pnpm contracts:update`. The plugin contract's "matches the recorded contract" and "recorded against the floor in force" checks moved into it.

### Registry findings

- `portal_submit.coreDeclarations` advertised an untyped `{}` input: the declaration schemas piped from `z.unknown()`. The input stage is now `z.array(z.unknown())`, so the MCP schema is `type: array`. The byte and value bound still runs before any row is validated, and the accepted inputs are unchanged, because non-arrays were already rejected by the array stage.
- Node-ID normalization coverage: `resumePlanId` (a signed `sfp_portal1_…` plan identity) and `portal_capture_read`'s `variableIds`, `collectionIds` and `styleIds` (variable, collection and style namespaces) are classified as non-canvas IDs, like the existing `planId`, `variableId`, `collectionId` and `styleId`. Rewriting them as canvas node IDs would be wrong.

### Acceptance: adding a dummy tool

A fully wired read tool `zz_dummy_probe` was added: spec, result schema, operation and egress policies, and a plugin handler. The 53 registry-dependent test files were then run (582 tests; the e2e tests and the long `native-work`/`recipe-runner` files were excluded).

- Exactly one drift check failed: `generated tool contracts match the tool registry; regenerate them with pnpm contracts:update`. Its message: "Registered tools with no recorded provenance: zz_dummy_probe. … Resolve these, then run `pnpm contracts:update` from service/ and commit the result."
- Four other tests timed out at the 5 s default under the 4-worker load of that run: three in `portal/coordinator.test.ts` and one in `tools/local-tools.test.ts`. With the dummy still in place, both files passed alone, 40 of 40. Their census durations were 2.3–4.1 s, so they are near-limit tests, not drift checks. See the open issues.
- The dummy was then removed. The working tree was clean against `37f931a`.

Before regeneration, `pnpm contracts:update --check` printed the stale-artifact path of the same report: rows added and changed in the manifest, the classified plugin drift, and both README blocks, ending with the command. Declaring a new tool in `SERVICE_LOCAL_TOOLS` without regenerating also fails the two manifest-consistency tests in `tool-contract.test.ts`, by design; `pnpm contracts:update` clears all three.

### Plugin contract decision (open)

The re-recorded plugin contract adds 11 arguments to existing tools, added in `8a8dd01` without a floor change: `get_fonts.available`, `create_variable_collection.defaultModeName`, and `create_variable.initialValues` with its nested fields. An older plugin would drop them silently. `MIN_PLUGIN_VERSION` stays `0.5.0`. Raising it is a release-versioning decision, and while every package is `0.1.0`, `requiredPluginVersion` caps the threshold at the server version, so a raise would have no runtime effect today. Record the decision when release versions start moving.

## Triage decisions (group B)

1. **`workspace-policy` nested Linux bind mount.** Linux-only by construction, not a Windows defect. The test builds a synthetic `/proc/self/mountinfo` record from the host path. On Windows that path is not POSIX, and mountinfo decoding reads `\2026_project` as the octal escape `\202`, so the record can never match. Production never uses the Linux inspector on `win32`; it uses the Windows reparse-point probe. The Windows analogue is covered by "rejects an existing in-root Windows link as a reparse point". The test is now `it.runIf(process.platform !== 'win32')`, a visible skip on Windows.
2. **`remote-image-fetcher` 6 MiB tests.** The fetcher was not slow. `toMatchObject({ bytes: exact })` walks a 6 MiB Buffer element by element: 21.4 s and 20.9 s alone, 34.1 s and 33.2 s in the census, past the explicit 30 s timeout. The tests now compare with `Buffer.compare` and a length check; each takes about 2 ms, and the whole file (107 tests) runs in 0.7 s. The explicit 30 s timeouts were removed so that a real slowdown fails under the default timeout.
3. **`consumption-input` changed declaration.** `portalCandidateHash` binds the core declarations (candidate v2), so a tampered declaration changes the candidate identity. `PORTAL_CONSUMPTION_CANDIDATE_CHANGED` correctly fires first. Candidate identity is the outer authority that the signed request names, and it is checked before any material is read or any declaration interpreted. The code is unchanged. The test now asserts that order, then rehashes the candidate as well and asserts that the per-page kind check still returns `DECLARATIONS_CHANGED`. Removing the kind check makes the test fail ("promise resolved instead of rejecting"), so the original intent is still covered.

## Known-failure ledger and checker

`service/test/known-failures.json` lists 90 known-defect failures. Each entry records the file, the full test name, the finding, the owning task, a reason and the failure text it must keep showing (`failureIncludes`).

| Finding | Owner | Entries | Cause |
| --- | --- | --- | --- |
| SVC-1 | T13 | 13 (native-work 10, operational-native 2, preview-native 1) | Registration re-prepares without `recipeUse`: `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` or `PORTAL_PROFILE_PREPARATION_CHANGED` |
| K1 | T14b | 17 (native-work) | No `recipeConsumption`, so apply stops at `PORTAL_VALIDATION_REQUIRED`. One test waits on a hook that never fires and hits its 60 s timeout (`STACK_TRACE_ERROR`) |
| K5 | T05a | 60 (vendor-upstreams) | Stale `upstream-lock.json`; `verify-upstream-lock` stops at `[PROTECTED_AUTHORITY]` |

`scripts/check-test-report.mjs` (`pnpm test:check-report <report.json>`) exits 1 on any of the following:

- a failing test or a failed suite not in the ledger;
- a ledgered test that now passes (STALE: the fixing task must delete its entry);
- a ledgered test failing without its recorded text;
- a ledgered test that was skipped, not run, or renamed;
- given `--log`, unhandled errors, which Vitest prints but never puts in the JSON report.

`--allow-partial` ignores entries whose file is absent, for focused runs. Unusable input exits 2. `test/check-test-report.test.ts` has 10 unit tests covering these cases and the committed ledger's validity. On the census report, the checker matched all 90 entries and correctly reported the 26 other failures and the failed `mcp-wire` suite.

### Wiring (for the main session and lane D)

Lane D owns `scripts/run-source-checks.mjs`, so this branch does not change it. Suggested wiring:

1. Keep the static part of `verify` (typecheck, lint, format:check, knip, build) and add `pnpm contracts:update --check` to it.
2. Run the suite as its own step and ignore Vitest's exit code only when the report file exists:
   `node node_modules/vitest/vitest.mjs run --exclude "test/artifact-contents.test.ts" --reporter=dot --reporter=json --outputFile.json=<artifacts>/vitest.json`, with the console output saved to `<artifacts>/vitest.log`.
3. Gate on `node scripts/check-test-report.mjs <artifacts>/vitest.json --log <artifacts>/vitest.log`. Treat exit 2 as a failure too.
4. In CI (T04), run `pnpm contracts:update` and then `git diff --exit-code`, or use `pnpm contracts:update --check` directly.

## Remaining-work plan

Only the `W01-W10 implementation` row of the completion ledger and the checkpoint paragraph below it changed. Tasks 1–5 are implemented at scoped PASS; Task 6 is partial, with 6E pending (and 6F open); Tasks 7–8 are pending. The row links the prioritized fix plan, which runs first. `docs/plans/README.md` already pointed at the fix plan.

## Final verification

Static gates at `39be314`, all through `pnpm` in this working copy: `lint`, `format:check`, `knip`, `typecheck` (including the plugin's `vue-tsc`), `build` and `contracts:update --check` all exit 0.

One full run after `pnpm build`, started at 22:40:52 and finished in 467 s:

`node node_modules/vitest/vitest.mjs run --exclude "test/artifact-contents.test.ts" --reporter=dot --reporter=json --outputFile.json=final-full.json`

| | Census (`5be8cc7`) | This branch (`39be314`) |
| --- | --- | --- |
| Test files | 375 | 377 (10 failed) |
| Tests | 4,146 | 4,158 |
| Passed | 3,989 | 4,040 |
| Failed | 116 | 99 |
| Skipped | 41 | 19 |
| Failed suites without a failed test | 1 (`mcp-wire`) | 0 |

The 12 additional tests are the new checker (10) and drift (1) tests, two new manifest tests, and one fewer plugin-contract test. Skips fell by 22 because the 23 `mcp-wire` tests now run against the built daemon instead of being skipped by a failed suite; the Linux-only bind-mount test adds one skip. Every group A, group B and environment failure from the census now passes. `mcp-wire` passed 23 tests and `process-lifecycle` 3.

`node scripts/check-test-report.mjs final-full.json --log final-full.log` exited 1:

- **Known failures:** all 90 of 90 ledger entries matched, each with its recorded failure text: SVC-1→T13 13, K1→T14b 17, K5→T05a 60.
- **Stale, changed-reason, not-run and unhandled-error findings:** none.
- **Unexpected:** 9 failures, all timing-sensitive tests. During the run, lanes A and C were running Vitest suites on the same machine.

| Test | Census | This run |
| --- | --- | --- |
| `consumption-input` › reads unchanged eligible legacy files … | 4,542 ms | timeout at 5,012 ms |
| `coordinator` › requires qualified selectors for identical roots … | 4,149 ms | timeout at 5,010 ms |
| `coordinator` › blocks unproven routing before a lease … | 3,998 ms | timeout at 5,005 ms |
| `coordinator` › requires qualified source evidence for reference pattern reuse … | 4,400 ms | timeout at 5,007 ms |
| `core-coordinator` › retains one-character source ownership … | 4,762 ms | timeout at 5,007 ms |
| `core-recipes` › pages canonical component membership … | 3,939 ms | timeout at 5,563 ms |
| `native-module-fence` › preserves module evidence when fork replaces … | passed | failed |
| `native-module-fence` › preserves module evidence when worker replaces … | passed | failed |
| `windows-boundary-probe-worker` › bounds hang failure, awaits retirement … | passed | startup timed out |

The six portal tests use Vitest's 5 s default and took 3.9–4.8 s in the census full run. They drive the full portal fixture, which starts real Windows ACL, lease and boundary helper processes (OPS-3); the per-test cost was not profiled here. `native-module-fence` is flaky in the other direction too: in the census its spawn variant failed and the fork and worker variants passed; here the reverse.

A focused rerun of those six files (135 tests), with lanes A and C still running, left 2 failures. `core-coordinator` › retains one-character source ownership timed out again at 5,012 ms; it takes 4.7–5.0 s even alone. The other `windows-boundary-probe-worker` failure was a different test in the same file ("observes the response rejection while a real pipe …"). The other eight passed. None of these files changed on this branch except `consumption-input.test.ts`, whose timed-out test is untouched. They were not added to the ledger, because the ledger holds only deterministic known defects, and a flaky entry would turn STALE on its next pass.

## Provenance

The per-task offline provenance step depends on the T05a tooling, which does not exist yet. `verify-upstream-lock --offline` already failed at `[PROTECTED_AUTHORITY]` on the census baseline (K5). This branch changes further protected and managed files, which T05a must register:

- new: `scripts/contracts-lib.mjs`, `scripts/update-contracts.mjs`, `scripts/check-test-report.mjs`, `test/contract-drift.test.ts`, `test/check-test-report.test.ts`, `test/known-failures.json`;
- changed: `package.json` (`contracts:update` and `test:check-report` scripts), `knip.json`, both READMEs, `capabilities/union-manifest.json`, `packages/mcp/test/plugin-contract.json`, and the source and test files listed in the commits.

## Open issues

1. **The full-run gate did not pass.** No ledgered defect was stale or misclassified, but 9 timing-sensitive tests failed while other lanes ran Vitest on the same machine. Before the result is treated as a gate, rerun the full suite and the checker when no other lane is testing (owner consent applies). Two structural fixes should follow:
   - Give the helper-heavy portal fixtures a justified Windows budget until T11 lowers the process cost. Either use explicit per-test timeouts, or add a Windows `testTimeout` in `packages/mcp/vitest.config.ts` next to the existing Windows `maxWorkers` rationale. `core-coordinator` › retains one-character source ownership needs this even alone.
   - Lane A (T01 helper budgets) should take the `windows-boundary-probe-worker` and `native-module-fence` flakes.
2. **Integration with lanes C and D.**
   - Lane D's `vitest.config.ts` writes a JSON report when `SFP_VITEST_JSON_REPORT` is set; the checker can gate that same report.
   - Lane D wraps the ledgered `preview-native` test in a Firefox requirement. Without Firefox, that test fails with a different message, which the checker reports rather than tolerates.
   - Rerun the checker after merging, so the ledger is verified against the combined tree, including lane C's characterization tests.
3. **Plugin floor.** Decide whether the 11 SILENT plugin arguments from `8a8dd01` need a `MIN_PLUGIN_VERSION` raise once release versions move.
4. **Provenance.** T05a must register the new files, refresh `upstream-lock.json`, and may retire the superseded `update-target-contracts.mjs` and `update-portal-contracts.mjs`.
5. **Static typing of tooling.** This branch does not type-check root tests or scripts; lane D's T04 adds `typecheck:tools`. A probe with lane D's exact `tsconfig.tools.json` settings, limited to this branch's new and changed scripts and root tests, reports no errors after `957d3ec`.
6. **Node version.** The toolchain here is Node 24.21.0 while `.node-version` pins 24.17.0 (T00 and T04).
7. **Wiring.** The checker must be wired with `--log`, because unhandled errors never appear in the JSON report.
