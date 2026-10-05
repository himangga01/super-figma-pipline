# T06a critical reproductions

Date: 2026-09-27. Task: T06a of the [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md). Findings: section 3.1 of the [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md).

- Branch: `rem/t06a-repros`, based on `5be8cc7`. Test commit: `82f0c11`.
- Change: seven new `*.characterization.test.ts` files with 14 tests. No production source file and no `service/upstream-lock.json` change.
- Result: all seven critical findings reproduce at `5be8cc7`. Every test passes today by asserting the defective outcome and its exact error code or result.

## How the tests are written

- They are normal Vitest tests, not `it.fails`. Each title starts with the finding ID and ends with the task that must flip it, for example "(flip in T07)".
- Each file starts with a comment that names the finding, the cited source lines, the seam and the fixing task. Each test repeats the finding and task.
- Every limit-driven reproduction has a control at the limit (64 against 65 replacements, 32 against 33 imports, 262,144 against 262,145 bytes, 512 against 513 evidence rows). The control shows that the limit, not the fixture, causes the failure.
- Flip condition: each test asserts an outcome that the planned fix removes, so the fixing task must change or replace it. This was established by reading the code and by the controls. It was not demonstrated against a fixed build, because no fix exists yet and production source was not edited, even temporarily.

## Summary

Paths are relative to `service/packages/`.

| Finding | Test file | Seam | Asserted current outcome | Flipped by |
| --- | --- | --- | --- | --- |
| K1 | `ir/test/portal-completion.characterization.test.ts` | `portalCompletionIssues` with a C4 report that has exactly the keys of the native report builder | Issues equal `['PORTAL_RECIPE_CONSUMPTION_REQUIRED']`; with a receipt they are `[]` | Gate side; see K1 notes |
| K1 | `mcp/test/portal/native-work.characterization.test.ts` | Real `portal_validate` through `PortalCoordinator` into `native-work.ts:671-752`, with a seeded profile record | No `recipeConsumption`, no consumption check, state `blocked`, issue `PORTAL_RECIPE_CONSUMPTION_REQUIRED`; no production caller of `verifyConsumptionObservations` | T14b |
| SVC-1 | `mcp/test/portal/native-work.characterization.test.ts` | Real prepare and register control endpoints in front of `assertPreparedProfile` | `PORTAL_PROFILE_PREPARATION_CHANGED`; with the dropped `recipeUse` re-attached, `PORTAL_CONSUMPTION_PREPARATION_REQUIRED`; the registration schema rejects `observationManifest` | T13 |
| OPS-2 | `mcp/test/portal/store.characterization.test.ts` | Real `PortalStore` (`runs` record) and a default `AtomicFileStore` on a temporary directory | 64 replacements succeed, the 65th throws `REPLACE_RETAINED_CAPACITY_EXCEEDED` with `retainedRows: 64` | T07 |
| LC-1 | `mcp/test/execution/operation-evidence-receipt.characterization.test.ts` | Real snapshot services produce receipts; real `OperationEvidenceReceiptStore` drain with a mirror of the `index.ts` callback; source test pins the mirrored branch | Drain throws `NATIVE_ARTIFACT_IDENTITY_MISMATCH` after one intent, later intents stay pending, a restarted store fails the same way | T09 |
| LC-2 | `mcp/test/fs/workspace-config-store.characterization.test.ts` | Real workspace config store and workspace policy on a temporary state root | After deleting A: `list`, `getDefault`, `add` and `remove A` throw `WORKSPACE_ROOT_IDENTITY_CHANGED`; tools on B throw `WORKSPACE_ROOT_UNAVAILABLE` | T08 |
| SA-1 | `mcp/test/portal/core-source.characterization.test.ts` | `analyzeConventions`, then `prepareCoreRecipeSource` and `deriveCoreRecipeBundle` | 33 imports give `truncated: true` with nothing unread, `mappingIssue: 'CORE_SOURCE_PATTERN_INCOMPLETE'` and blocking issue rows | T26 |
| SA-2 | `mcp/test/portal/service-graph.characterization.test.ts` | `analyzeServiceGraph` on real trees | `SOURCE_LIMIT:package-lock.json` for a 262,145-byte lockfile; `EVIDENCE_LIMIT` for the 513th evidence row; both `incomplete: true`, `lexicalReviewable: false` | T26 |

## Environment and commands

- Host: Windows 11 Pro 10.0.26200, Node 24.21.0, pnpm 11.24.0, Vitest 4.1.11, TypeScript 6.
- Working copy: the git worktree `.worktrees/lane-c`. It is a separate working copy, not a sandbox: it shares the Windows user's filesystem privileges, process namespace and network with everything else on the machine.
- `TEMP`, `TMP` and `LOCALAPPDATA` pointed to ASCII paths under `.worktrees/_cache`, because the non-ASCII path defect (OPS-1) is being fixed in another lane. `PLAYWRIGHT_BROWSERS_PATH` was set, but no test launched a browser.
- Processes: the test files start no process themselves. The production paths they exercise start `node` children (`NativePortalRunner`) and, on Windows, the PowerShell directory-lease broker and boundary probe. All of those spawn sites pass `windowsHide: true`.
- Only focused test files were run; the full suite was not.

Environment for every command, run from `service/`:

```sh
export PATH="/c/2026_project/super-figma-pipline/.worktrees/_cache/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH='C:\2026_project\super-figma-pipline\.worktrees\_cache\ms-playwright'
export TEMP='C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp'; export TMP="$TEMP"
export LOCALAPPDATA='C:\2026_project\super-figma-pipline\.worktrees\_cache\localappdata-ascii'
```

All seven files together:

```sh
node node_modules/vitest/vitest.mjs run \
  packages/ir/test/portal-completion.characterization.test.ts \
  packages/mcp/test/execution/operation-evidence-receipt.characterization.test.ts \
  packages/mcp/test/fs/workspace-config-store.characterization.test.ts \
  packages/mcp/test/portal/core-source.characterization.test.ts \
  packages/mcp/test/portal/native-work.characterization.test.ts \
  packages/mcp/test/portal/service-graph.characterization.test.ts \
  packages/mcp/test/portal/store.characterization.test.ts
```

Results:

| Check | Result |
| --- | --- |
| The command above, five runs | Each run: 7 files and 14 tests passed, about 13 s |
| `native-work.characterization.test.ts` alone, four runs | Each run: 4 tests passed, about 12 s |
| `pnpm typecheck` | Exit 0 for `shared`, `ir`, `plugin`, `mcp` and `cli` |
| `pnpm exec oxlint --deny-warnings <the seven files>` | Exit 0 |
| `pnpm exec oxfmt --check <the seven files>` | All files formatted |

To run one finding, pass only its file to the same command.

## Findings

### K1: completion is unreachable

Files: `ir/test/portal-completion.characterization.test.ts` (1 test) and `mcp/test/portal/native-work.characterization.test.ts` (2 tests in the `K1 characterization` block).

- **Gate side (ir).** The fixtures of `ir/test/portal-completion.test.ts` are narrowed to C4 (`blank-frontend`, `frontend-only`, one required frontend requirement). The report is parsed with `PortalAcceptanceSchema`, like the one in `native-work.ts`. The test checks that its keys are exactly the thirteen keys that the builder at `native-work.ts:671-752` can emit (with `observations` present). Asserted: `portalCompletionIssues` returns exactly `['PORTAL_RECIPE_CONSUMPTION_REQUIRED']`. Control: the same report with the consumption receipt returns `[]`, so the fixture is otherwise complete. This test does not flip by itself when K1 is fixed, because T14b changes the producer, not the gate. T14b can reuse its control half for its acceptance "a verified receipt passes `portalCompletionIssues`".
- **Producer side (mcp).** The C4 harness of `native-work.test.ts` runs `portal_plan`, `portal_start`, `portal_next` and `portal_submit`, then the real `portal_validate`.
  - Seam: SVC-1 blocks every registration path, so the test writes the signed profile record exactly as `registerProfile` would (`native-work.ts:804-810`): the output of `prepareProfile`, under its registration ID. A registrable C4 profile would also need a live capture and Firefox.
  - Asserted: the approved `node` command passed (`build-fixture` and `native-command-sequence`), yet the report has no `recipeConsumption` and no check whose ID contains `consumption`. The run state is `blocked` with `PORTAL_RECIPE_CONSUMPTION_REQUIRED`, and the persisted validation evidence also lacks the receipt.
  - Flip: T14b must add either a verified receipt or a required failed `core-consumption` check.
- **Static test.** A scan of `mcp/src/**/*.ts` asserts that `verifyConsumptionObservations` has no call site besides its definition (`core-consumption.ts:290`). T14b adds the caller.
- The profile fixture uses a 60 s command timeout instead of 5 s. Under the module fence, starting `node` took about 3 s on this machine, and it exceeded 5 s once during exploration.

### SVC-1: native profile registration always fails

File: `mcp/test/portal/native-work.characterization.test.ts`, block `SVC-1 characterization` (2 tests).

- Seam: the real `createPortalProfilePreparationEndpoint` and `createPortalProfileEndpoint` with a real action-nonce store, in front of `assertPreparedProfile` (`native-work.ts:976-985`).
- Asserted, in order:
  1. `work.prepareProfile` (the re-preparation that registration performs) returns a compiled `recipeUse` with `prepared.version: 'core-consumption-v1'`. The endpoint's output has no `recipeUse` (`control.ts:89-97`).
  2. Registering exactly the endpoint's output with a valid nonce throws `PORTAL_PROFILE_PREPARATION_CHANGED`.
  3. Re-attaching the dropped `recipeUse` passes the hash comparison, which shows `recipeUse` is the only difference. Registration then throws `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` (`native-work.ts:791-795`), because this C4 profile has no preview command. Its compiled status is `blocked`, with `PORTAL_CONSUMPTION_OBSERVATION_REQUIRED`, `PORTAL_CONSUMPTION_ORACLE_REQUIRED` and `PORTAL_CONSUMPTION_REVIEW_REQUIRED`. The owner cannot see these requirements, because the endpoint drops them.
  4. No profile record was written.
- A second test shows that `PortalNativeProfileSchema` has `observationManifest` but the strict `PortalNativeRegistrationSchema` (`native-work.ts:164-175`) rejects it as an unrecognized key. This is shown with the schemas instead of a preview profile: preparing a preview profile needs the built validator bundle, a Firefox executable and a captured design with an interaction contract.
- Flip: T13 replaces this registration flow (prepared profiles stored server-side, registration by owner-supplied hash).
- Existing evidence: `native-work.test.ts` "prepares exact owner-scoped artifact authority and rejects a stale approved registration" (line 937) already fails at `5be8cc7` with `PORTAL_PROFILE_PREPARATION_CHANGED` from `native-work.ts:984`, reached through `control.ts:63`.

### OPS-2: the 65th replacement of a record fails

File: `mcp/test/portal/store.characterization.test.ts` (2 tests).

- Seam 1: the real signed `PortalStore` from `portalFixture()`, with kind `runs`, which uses the default limits (`store.ts:118-139`). One `create`, then 64 `update` calls succeed and leave 64 `.replace-retained` files. The 65th update throws `REPLACE_RETAINED_CAPACITY_EXCEEDED` with `retainedRows: 64`. The record still reads as generation 64, and a 66th update fails the same way.
- Seam 2: a default `new AtomicFileStore()` replaces one file 64 times; the 65th replacement throws the same code, and the file keeps generation 64. Control: a store that allows 65 retained generations completes the 65th replacement.
- Flip: T07 gives `PortalStore` the `discard` retention mode, so the 65th update must succeed.

### LC-1: the startup retention sweep wedges

File: `mcp/test/execution/operation-evidence-receipt.characterization.test.ts` (2 tests).

- Seam: `removeRetainedArtifacts` (`index.ts:847-883`) is a closure inside leader initialization and cannot be imported. The test drives the real `OperationEvidenceReceiptStore.drainPendingArtifactCleanup` (`operation-evidence-receipt-store.ts:531-545`) with a verbatim mirror of the callback's branches for receipts without a result artifact. A second test pins those branches to the `index.ts` source text: the `export` branch, the `NATIVE_ARTIFACT_IDENTITY_MISMATCH` throw for every other kind except `no-artifact`, no mention of `snapshot` or `grounding-graph`, and the sweep's call of the callback from the drain (`index.ts:909-915`). Leader initialization itself (`index.ts:958`) was not run.
- Producers: the canonical execution-plane harness of `snapshot/service-operations.test.ts` runs the real `snapshot.capture` and `grounding.refresh`. Their receipts carry `nativeEvidence.kind` `snapshot` and `grounding-graph` (`snapshot-operation-evidence.ts:61,87`), with a workspace and no result artifact.
- Asserted:
  - A harmless `no-artifact` receipt with an operation ID that sorts last is added. Compaction 31 days later turns all three receipts into cleanup intents.
  - The drain calls the callback once, for the first snapshot intent, and rejects with `NATIVE_ARTIFACT_IDENTITY_MISMATCH`.
  - A restarted store over the same state root fails the same way.
  - Control: a callback that does not throw then drains all three intents in operation-ID order. So nothing had been drained, including the harmless intent after the failure.
- Flip: T09 isolates each intent in the drain, and snapshot and grounding-graph cleanup then only detaches the evidence.

### LC-2: one moved workspace breaks every workspace

File: `mcp/test/fs/workspace-config-store.characterization.test.ts` (1 test).

- Seam: the real `createWorkspaceConfigStore` (with the fixture permissions of the portal tests) and the real `createWorkspacePolicy` over it. Boundary inspection is a no-op because it is not on the failing path and would start a PowerShell probe.
- Before: A and B are listed, B is the default, and `resolveRoot` and `resolveRead` work for B.
- After deleting A's directory:
  - `list`, `getDefault`, `remove A` and `add C` throw `WORKSPACE_ROOT_IDENTITY_CHANGED` (`revalidateRows`, `workspace-config-store.ts:414-458`, via `readConfig` at 488).
  - `resolveRoot(B)` and `resolveRead(B, 'package.json')` throw `WORKSPACE_ROOT_UNAVAILABLE`, whose `cause` has code `WORKSPACE_ROOT_IDENTITY_CHANGED`.
  - A restarted store fails the same way.
- Flip: T08 validates rows individually, so tools on B, `list` and `remove A` must work.

### SA-1: 33 imports block C2/C3 core recipes

File: `mcp/test/portal/core-source.characterization.test.ts` (2 tests).

- Fixture: a small React source with `src/Button.tsx` and N card components, each importing the button once.
- Seam 1, `analyzeConventions` (`conventions.ts:81-91`): with 33 imports, 34 files are inspected and none is unread. The `imports` category keeps 32 rows, the analysis reports `truncated: true`, and unobserved categories such as `routing` become `incomplete`. Control: with 32 imports, the result has `truncated: false` and `routing` is `not-observed`.
- Seam 2, `prepareCoreRecipeSource` (`core-source.ts:309-322`), whose throw is caught into `mappingIssue` (`core-source.ts:393-401`), and `deriveCoreRecipeBundle` with `reference-portal`:
  - The inventory is complete, `mappingIssue` is `CORE_SOURCE_PATTERN_INCOMPLETE` and `mappingResults` is `null`.
  - `plan-design-implementation` and `map-design` contain `CORE_SOURCE_PATTERN_INCOMPLETE` issue rows, and `plan-design-implementation` is `blocked`.
  - Control: with 32 imports, `mappingIssue` is `null`, mappings exist and there are no such issue rows.
- Core source preparation catches this code instead of throwing it; the observable outcome is the prepared capsule and the issue rows.
- Flip: T26 records convention evidence as a sample with counts and blocks only on unread inputs.

### SA-2: lockfile and evidence limits are hard incompleteness

File: `mcp/test/portal/service-graph.characterization.test.ts` (2 tests).

- Seam: `analyzeServiceGraph` over real temporary trees with `package.json` (React) and `src/App.tsx`.
- Lockfile (`service-graph.ts:97-112`): a valid 262,145-byte `package-lock.json` gives `incomplete: true`, `lexicalReviewable: false` and issues exactly `['SOURCE_LIMIT:package-lock.json']`, and the file is missing from `graph.files`. Control: a 262,144-byte lockfile gives `incomplete: false` and no issues.
- Evidence (`service-graph.ts:244-249`): one `manifest` row, one `dependency` row and 511 resolved imports make 513 evidence rows for one service. The service keeps 512, and the graph is hard-incomplete with issues exactly `['EVIDENCE_LIMIT']`. Control: 510 imports make 512 rows, which gives a complete graph without issues.
- Flip: T26 treats lockfiles as hashes only and aggregates evidence ("a 900 KB lockfile plus 800 imports raises no limit issue").

## Findings that could not be reproduced

None. All seven findings reproduce at `5be8cc7`. The partial seams are recorded above:
- The K1 producer test seeds the profile record that SVC-1 prevents it from registering.
- The LC-1 callback is mirrored, pinned by a source test, and leader initialization is not run.
- The SVC-1 `observationManifest` part uses the schemas, not a preview profile.

## Baseline observations outside the T06a assertions

`native-work.test.ts` was run as a single focused file at `5be8cc7`: 27 of its 30 tests fail. This is part of the known red baseline.

| Failure | Tests | Cause |
| --- | --- | --- |
| `PORTAL_VALIDATION_REQUIRED` from `applyFiles` | 16 | K1. For the C4 fixture, the suite's synthetic `acceptanceFixture` gives exactly `['PORTAL_RECIPE_CONSUMPTION_REQUIRED']` from `portalCompletionIssues`. This was checked with a throwaway script that was not committed. The legacy-fixture variants were not analyzed one by one. |
| `PORTAL_CONSUMPTION_PREPARATION_REQUIRED` | 7 | The direct in-process `registerProfile(await prepareProfile(profile))` path. The test profile has no preview command, so its consumption preparation is `blocked`. Production registration goes through the endpoints and fails earlier (SVC-1). Whether such a profile should ever register is a T13 and T14 design question. |
| `PORTAL_PROFILE_PREPARATION_CHANGED` | 1 | SVC-1 through the endpoints (line 937). |
| `ENOENT` for `packages/mcp/dist/portal-validation.mjs` | 2 | Needs `pnpm build`; environment, not a defect. |
| 60 s timeout | 1 | "cancels source application between files" waits for a write that never happens. By the code path, its apply call throws `PORTAL_VALIDATION_REQUIRED` first, like the 16 tests above. |
| Passed | 3 | |

Provenance:
- `node scripts/verify-upstream-lock.mjs --offline` already fails at `5be8cc7`, independent of this change, with `[PROTECTED_AUTHORITY] protected service file hash mismatch: README.md` (K5 and VER-C1). It stops at that error.
- The six new files under the managed root `packages/mcp/test` are not in `upstream-lock.json`. T05a must register them; otherwise the verifier will report `UNMANAGED_DESTINATION` once the earlier mismatch is fixed. The `ir` test is outside the managed roots.
- The per-task provenance step needs the T05a tooling, which comes after T06a by design.

Scratch exploration files were created during the work and deleted; none is committed.
