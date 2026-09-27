# T08: per-row workspace validation (LC-2)

Date: 2026-09-27. Task: T08 of the [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md). Finding: LC-2 in section 3.1 of the [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md). Reviewer constraint: TD-7 ("T08 v3 schema") in Appendix C of the fix plan.

- Branch: `rem/t08-workspace-rows`, based on `8da28b6`.
- Commits:
  - `31d6c7e` fix(fs): validate workspace rows individually;
  - `041be20` feat(control): add nonce-protected workspace rebind;
  - the commit that adds this note.
- Result: deleting, moving or re-cloning one registered workspace no longer breaks the store. The T06a LC-2 characterization is flipped into a regression test, and all seven required tests pass. `service/upstream-lock.json` is unchanged.

## The defect

- `readConfig()` revalidated every row and threw `WORKSPACE_ROOT_IDENTITY_CHANGED` as soon as one row failed (`workspace-config-store.ts:414-458`, reached from `:488`).
- Every consumer went through it: `list`, `getDefault`, `add`, `remove`, `set-default`, the workspace policy, the MCP workspace binding and the leader's retention sweep (`index.ts:934`). One bad row therefore failed leader startup, tools on healthy workspaces, and the `workspace remove` that could have repaired the state.
- v1 rows, which have no identity key, adopted the identity of whatever directory was at their path on every read (trust on first use), and the next write persisted it.

## Design

### Per-row availability

`list()` observes each row on its own and returns every row with an `availability`:

| `availability` | Meaning | `unavailableReason` |
| --- | --- | --- |
| `available` | The registered path resolves to the recorded real path and root identity. | none |
| `unavailable` | The path no longer resolves to an accessible real directory, or it resolves to a different one. | `WORKSPACE_ROOT_MISSING` or `WORKSPACE_ROOT_IDENTITY_CHANGED` |
| `legacy-unbound` | A v1 row without a recorded identity. It is never probed and never adopted. | none |

- A failed observation never escapes `list()`; other rows are unaffected.
- Availability is observed on every listing and never persisted. If the original directory comes back with the same `dev:ino:birthtimeNs` identity, the row is available again. A different directory at the same path stays unavailable until an explicit rebind.
- `getDefault()` and every mutation read only the persisted rows. They no longer touch any registered workspace.
- Whole-store integrity failures are unchanged and still fail closed: a bad checksum or schema (`WORKSPACE_CONFIG_INVALID`), overlap with owner state (`STATE_WORKSPACE_OVERLAP`), and state-root permission errors.

### Workspace config v3

- Each row persists its binding state, never its availability:
  - a bound row is the v2 row followed by `"state":"bound"`;
  - a legacy-unbound row is the v1 row followed by `"state":"legacy-unbound"`.
- The v1 and v2 readers remain. Reads never write. v1 rows load as legacy-unbound, and v2 rows load as bound with every field unchanged.
- Every explicit mutation (add, remove, set-default, rebind) writes v3. Rows that a mutation does not target are carried through verbatim. The tests check that an unavailable row's serialized JSON is byte-identical after adding, setting the default and removing other rows.
- Only `addResolved` and `rebindResolved` write a `rootIdentityKey`.
- The schema is closed per state. It rejects a bound row without an identity, a legacy row with one, an unknown or missing state, and a persisted availability.
- The file name stays `workspaces.v1.json`. Builds before T08 reject a v3 file as `WORKSPACE_CONFIG_INVALID`, so a downgrade fails closed.

### Tools and the workspace policy

- The policy checks only the targeted row. For a row that is not available it throws `WORKSPACE_ROOT_UNAVAILABLE` with a cause whose code says why: `WORKSPACE_ROOT_MISSING`, `WORKSPACE_ROOT_IDENTITY_CHANGED` or `WORKSPACE_ROOT_UNBOUND`.
- The policy's in-process root pin is keyed by workspace ID and recorded identity. A long-lived leader therefore accepts a rebound root without a restart. For an unchanged registration the pin behaves as before.
- Filesystem effects go through the policy, so they fail precisely for an unavailable workspace. Operations that touch only owner state, such as releasing a recipe evidence hold, are not blocked. For that reason `index.ts` `resolveWorkspaceContext` is unchanged.

### Remove and rebind

- `workspace remove` works for unavailable and legacy rows with the existing guards, all checked before the nonce is consumed: the action nonce, the default-in-use check and `hasUnsettled`.
- `rebindResolved(actorId, workspaceId, registration, consumeNonceCas)` replaces one row's path and identity. It keeps the workspace ID, `addedAt` and the default.
  - It refuses an unknown workspace, a real path that another row uses, overlap with owner state, and unsettled operations.
  - It revalidates the registration immediately before the nonce is consumed. If the directory changed after the nonce was issued, the nonce stays issued and nothing is written.
- Control surface:
  - `POST /control/action-nonces` accepts `{action: 'workspace.rebind', requestHash, registrationPath, workspaceId}`. The server resolves the path, checks the hash of `{workspaceId, realPath}` and binds the nonce to the resolved registration, as it does for `workspace.add`. A rebind nonce cannot be issued without a registration.
  - `POST /control/workspaces/:workspaceId/rebind` takes `{path, actionNonce}`. It requires the nonce's registration path to equal `path`, recomputes the hash, and consumes the nonce inside the store mutation.

### Leader retention sweep

- `index.ts` iterates registrations through `sweepAvailableWorkspaces` (`workspace-config-store.ts`). A row that is not available is skipped with the log line `[retention] workspace <id> is <availability> (<cause code>); its evidence scan is skipped until it is rebound or removed`.
- The per-workspace body in `index.ts` is unchanged. Deferred cleanup for unavailable workspaces belongs to T09.

### CLI

- `sfp workspace list` prints every row with `availability` and, for unavailable rows, `unavailableReason`.
- `sfp workspace rebind <id> <path>` resolves the path, requests a registration-bound rebind nonce and posts to the rebind route.
- `sfp workspace add <path>` and `--workspace <path>` refuse a registration at that path that is not available. They fail with `WORKSPACE_ROOT_UNAVAILABLE` and a rebind hint instead of silently reusing its ID.
- The recipe client no longer requires `rootIdentityKey` on every listed row, and it refuses a recipe workspace that is not available (`RECIPE_WORKSPACE_UNAVAILABLE`). Before this change, one legacy row made recipe recovery fail for every workspace, which is the same failure class as LC-2.

## Files

Paths are relative to `service/packages/`.

| File | Change |
| --- | --- |
| `shared/src/config.ts` | `WorkspaceAvailability`, `WorkspaceUnavailableReason`, optional `availability` and `unavailableReason` on `WorkspaceRoot`, `rebindResolved` on `WorkspaceConfigStore` |
| `mcp/src/fs/workspace-config-store.ts` | Per-row listing, v3 schema and readers, verbatim writes, `rebindResolved`, `workspaceUnavailableError`, `sweepAvailableWorkspaces` |
| `mcp/src/fs/workspace-policy.ts` | Targeted-row availability check with a cause, identity-scoped root pin |
| `mcp/src/index.ts` | The retention sweep iterates through `sweepAvailableWorkspaces` (sweep loop only) |
| `mcp/src/control/route-registry.ts` | Availability fields in the workspace output schema, `workspace.rebind` route |
| `shared/src/action-nonce.ts` | `workspace.rebind` action, issue request and semantic schema |
| `mcp/src/control/action-nonce-store.ts` | Registration-bound nonces for add and rebind, `issueWorkspaceRebind` |
| `mcp/src/control/action-nonce-endpoints.ts` | Server-side resolution and hash check for rebind nonces |
| `mcp/src/control/workspace-endpoints.ts` | `rebind` endpoint |
| `cli/src/admin-commands.ts` | `workspace rebind <id> <path>` |
| `cli/src/control-client.ts` | `workspace()` refuses a registration at the path that is not available |
| `cli/src/control-recipe-client.ts` | Tolerates rows without an identity; refuses an unavailable recipe workspace |

Tests:

- `mcp/test/fs/workspace-config-store.characterization.test.ts`: rewritten from the T06a characterization into the LC-2 regression tests. The file name is kept, so the T06a evidence still resolves.
- `mcp/test/fs/workspace-config-store.test.ts`: new block `per-row workspace availability (LC-2, T08)`. Three existing tests were updated:
  - two expected version 2 on disk and now expect version 3;
  - one asserted the defect ("fails later reads when a registered root is replaced at the same spelling") and now asserts that the row is listed as unavailable.
- `mcp/test/execution/workspace-endpoints.test.ts`: new block `unavailable workspace control (LC-2, T08)`. The existing store stub gained `rebindResolved`.
- `cli/test/admin-commands.test.ts`: one new test.
- `cli/test/recipe-runner.test.ts`: a `setWorkspaceRows` fixture hook and two new tests.

## Required tests

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Delete A: tools on B work, `workspace list` shows A unavailable, `workspace remove A` succeeds with a nonce | `workspace-config-store.characterization.test.ts`: "LC-2 regression (T08): deleting registered workspace A keeps workspace B usable, lists A as unavailable and removes A with a nonce". It uses the real store, policy, MCP binding, control endpoints and nonce store, and a restarted store. |
| 2 | With A unavailable, adding C keeps A's row byte-for-byte, including its identity | `workspace-config-store.test.ts`: "keeps an unavailable row byte-for-byte, including its identity, through unrelated mutations" (add C, set-default twice, remove B) |
| 3 | A different directory recreated at A's path stays unavailable until an explicit rebind | `workspace-config-store.test.ts`: "keeps a different directory recreated at a registered path unavailable until an explicit rebind". It also checks that re-adding the path fails, that unrelated mutations keep the old identity, that a restarted store agrees, and that the same policy instance accepts the root after the rebind. |
| 4 | v1 loads as legacy-unbound without adopting identities; v2 loads unchanged | "loads a v1 config as legacy-unbound rows without adopting the current identity" and "loads a v2 config unchanged and migrates it to v3 only through an explicit mutation". Both check that reads leave the file bytes unchanged. |
| 5 | Rebind without a valid nonce is rejected | `workspace-endpoints.test.ts`: "rebinds an unavailable workspace only with a valid registration-bound rebind nonce". It covers a never-issued nonce, an unbound issue, a hash mismatch, a nonce for another workspace, an add nonce, another control session's nonce, a different registered path and replay. Rejected nonces stay issued and the row is unchanged. |
| 6 | Removing an unavailable row with unsettled operations is refused | `workspace-endpoints.test.ts`: "refuses to remove or rebind an unavailable workspace with unsettled operations and keeps the nonce issued". The same nonce succeeds once the operations settle. |
| 7 | The startup sweep does not throw over an unavailable row | `workspace-config-store.characterization.test.ts`: "LC-2 regression (T08): the leader retention sweep skips an unavailable workspace with a log line instead of throwing" |

Seam for test 7: leader initialization cannot run in a unit test, and `test/task-8a-direct-fs-importers.test.ts` (a root test owned by lane D) pins the per-workspace body's text in `index.ts`. The iteration was therefore extracted into `sweepAvailableWorkspaces`, and the body stays in `index.ts`. The test drives the helper over the real store and pins the `index.ts` call with a source match. T09 must keep or update that pin when it restructures the sweep.

Additional tests:

- A moved workspace is rebound to its new path and keeps its ID and default.
- Rebind refusals: another row's path, owner-state overlap, unknown workspace, missing actor, unsettled operations. No nonce is consumed.
- A rebind target replaced after nonce issuance fails with `WORKSPACE_REGISTRATION_CHANGED`, and the nonce is not consumed.
- Five closed-schema v3 rejections. These also pass on the old code, which rejected every v3 file; they guard the new reader.
- Through the real control router: `GET /control/workspaces` returns unavailable, available and legacy-unbound rows, and a nonce-bound rebind succeeds.
- The CLI's list, rebind and add behavior.
- The recipe client with unrelated legacy and unavailable rows, and with an unavailable recipe workspace.

## Commands and results

Environment:
- Windows 11 Pro 10.0.26200, Node 24.21.0, pnpm 11.24.0, Vitest 4.1.11.
- Working copy: the git worktree `.worktrees/lane-c`. It is a separate working copy, not a sandbox: it shares the Windows user's filesystem privileges, process namespace and network.
- Only focused test files were run; the full suite was not.
- The new store, policy, endpoint, router and CLI tests start no process: they use a no-op boundary inspector and never reach the PowerShell boundary probe. The two new recipe-runner tests reuse that file's fixture, which starts the directory-lease broker like the other tests there. Existing policy tests start the boundary probe. Both spawn sites pass `windowsHide: true`, and no production spawn site changed.

Environment for every command, run from `service/` (`System32` first because Git's MSYS `whoami` shadows `whoami.exe`):

```sh
export PATH="/c/Windows/System32:/c/2026_project/super-figma-pipline/.worktrees/_cache/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH='C:\2026_project\super-figma-pipline\.worktrees\_cache\ms-playwright'
export TEMP='C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp'; export TMP="$TEMP"
export LOCALAPPDATA='C:\2026_project\super-figma-pipline\.worktrees\_cache\localappdata-ascii'
```

Focused workspace set:

```sh
node node_modules/vitest/vitest.mjs run \
  packages/mcp/test/fs/workspace-config-store.characterization.test.ts \
  packages/mcp/test/fs/workspace-config-store.test.ts \
  packages/mcp/test/fs/workspace-policy.test.ts \
  packages/mcp/test/fs/workspace-registration-resolver.test.ts \
  packages/mcp/test/fs/workspace-registration-atomicity.test.ts \
  packages/mcp/test/fs/workspace-usage-guard.test.ts \
  packages/mcp/test/execution/workspace-endpoints.test.ts \
  packages/mcp/test/execution/mcp-workspace-binding.test.ts \
  packages/mcp/test/execution/action-nonce.test.ts \
  packages/mcp/test/control/control-router.test.ts \
  packages/mcp/test/election/control-route-registry.test.ts \
  packages/cli/test/admin-commands.test.ts
```

| Check | Result |
| --- | --- |
| Baseline at `8da28b6`: characterization file | 1 passed; it asserted `WORKSPACE_ROOT_IDENTITY_CHANGED` |
| Red: the new and updated tests in the four LC-2 files before the fix | 16 failed, each for the intended reason: whole-store `WORKSPACE_ROOT_IDENTITY_CHANGED`, a v1 row with an adopted identity, missing availability, `rebindResolved` not implemented, version 2 written, `workspace.rebind` rejected by the nonce schema, and "Too many positional arguments" in the CLI. The baseline tool-count test also failed. The five v3 schema rejections passed, as expected. |
| Red: the two recipe-client tests against the old client | 2 failed: a `ZodError` for the row without `rootIdentityKey`, and a recipe that succeeded on an unavailable workspace |
| Focused workspace set, final tree | 12 files: 197 passed, 4 skipped, 2 failed (baseline, see below) |
| The same set without `election/control-route-registry.test.ts`, on the tree of `31d6c7e` (before the rebind surface) | 11 files: 189 passed, 4 skipped, the same 2 baseline failures; the two recipe-client tests passed |
| `packages/cli/test/recipe-runner.test.ts` | 47 passed (45 existing, 2 new), 220 s |
| Regression subset: `fs/operation-evidence-artifact-store`, `execution/native-evidence-artifact-port`, `fs/local-tool-boundary`, `portal/recipe-evidence-hold`, `portal/coordinator`, `portal/store`, `portal/source-authority` | 7 files: 155 passed, 1 skipped |
| `pnpm typecheck` | Exit 0 for `shared`, `ir`, `plugin`, `mcp` and `cli`, on the final tree and on the intermediate tree |
| `pnpm exec oxlint --deny-warnings <17 changed files>` | Exit 0 |
| `pnpm exec oxfmt --check <17 changed files>` | All files formatted. Only the changed files were formatted; they were format-clean before the change. |
| `pnpm exec knip` | Only the two baseline K1 findings (`verifyConsumptionObservations`, `consumptionBatchHash`) |
| `node scripts/verify-upstream-lock.mjs --offline` | Stops at the pre-existing `[PROTECTED_AUTHORITY] protected service file hash mismatch: README.md` (K5), as in T06a |

The two failures in the focused set are part of the known red baseline and fail the same way at `8da28b6`:
- `admin-commands.test.ts` "lists the complete contract locally without requiring a daemon" expects 127 tools and the registry has 128 (T02, lane B);
- `workspace-policy.test.ts` "rejects a nested Linux bind mount hidden behind an in-root lexical alias" is a Linux case that fails on Windows (T00 census, "Other").

## Deviations and their reasons

- **Files outside the plan's T08 list.**
  - `shared/src/config.ts` and `shared/src/action-nonce.ts` hold the shared types and the nonce action.
  - `control/action-nonce-store.ts`, `control/action-nonce-endpoints.ts` and `control/route-registry.ts` are needed for a registration-bound rebind nonce and its route. The route registry's strict output schema would also have rejected listed rows with an availability.
  - `cli/src/control-client.ts` stops `workspace add` from silently reusing an unavailable registration.
  - `cli/src/control-recipe-client.ts` required `rootIdentityKey` on every listed row, so one legacy-unbound row would have broken recipe recovery for every workspace.
  - `mcp/src/fs/workspace-registration-resolver.ts`, which the plan lists, did not need a change: listing uses its existing `resolveForNonce` and `sameWorkspaceRegistration`.
- **Rebind requires settled operations.** The brief requires the `hasUnsettled` check for removal. Rebind uses the same check because unsettled operations were authorized against the recorded root, and startup recovery looks for their result and native artifacts under the workspace root. Rebinding under them could make recovery inspect the wrong directory. An `outcome-unknown` operation on an unavailable workspace can still be settled first, because `operations resolve` reads only the journal (`control/operation-endpoints.ts`).
- **The CLI adds a fourth positional argument** only for `workspace rebind <id> <path>`; every other command keeps the three-argument limit.

## Limitations and follow-ups

- Legacy-unbound rows fail closed. After the upgrade, a v1 registration cannot be used by tools until the owner runs `sfp workspace rebind <id> <path>`. The v1 format was current only from 2026-08-28 to 2026-08-31, until `e4395c4` introduced v2.
- There is no downgrade path: builds before T08 reject a v3 file as `WORKSPACE_CONFIG_INVALID`.
- Cost is unchanged: `list()` observes every row, and the policy lists all rows for each path resolution. T11 snapshots the registry per operation.
- The sweep still has two narrow failure paths, both for T09:
  - a workspace that disappears between `list()` and its orphan scan can still make the scan throw, because the evidence artifact store calls `resolveRoot` outside its error handling;
  - `sweepAvailableWorkspaces` does not isolate a failing scan of an available workspace.
- The nonce-free `add`, `remove` and `setDefault` store conveniences remain test and bootstrap helpers with no production caller. Nonces are enforced at the control endpoints.
- `set-default` can still name an unavailable registration. That is an explicit owner action, and MCP tools then fail with `WORKSPACE_ROOT_UNAVAILABLE`.
- The control router returns HTTP 500 with the error code for `WORKSPACE_ROOT_UNAVAILABLE`, `WORKSPACE_NOT_CONFIGURED` and `WORKSPACE_REGISTRATION_CHANGED`, as it does for other unmapped codes. `mcp/src/control/router.ts` was left for T10.
- `PROTOCOL_VERSION` is unchanged. The plugin/daemon wire is untouched; only the local CLI/daemon control routes changed (optional fields, one route and one nonce action). The CLI and the daemon ship together, and an older CLI cannot read legacy-unbound rows in its recipe client.
- `service/docs/operations-ko.md` does not list `workspace rebind`. It is a historical Korean document, and editing it would require translating it under `AGENTS.md`, so it was not edited.
- Provenance: `service/upstream-lock.json` was not edited, as instructed. The per-task provenance step (T05a tooling) is still pending. The offline verifier stops at the pre-existing `README.md` mismatch before it reaches these files.
- Only Windows was exercised. The macOS and Linux branches were not run.
