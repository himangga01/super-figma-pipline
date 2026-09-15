# Task 3.3 independent review

## Outcome

**Changes requested.** The frozen implementation contains one blocking P1 artifact-closure finding, independently reproduced through the actual native runner. All 16 owned file hashes match the supplied frozen manifest. The existing affected suite passes, but it does not cover the bypass described below.

This is the Task 3.3 spec and code-quality review, not either of the final whole-code review rounds. Task 4.1 module/service-graph files and Task 3.4 resource admission, locking, lifecycle and quarantine are outside this review.

## R1 - P1: Permitted Node execution paths can load changed, unbound external code

Primary location: `service/packages/mcp/src/portal/native-artifacts.ts:362-377`.

Related locations: `native-artifacts.ts:256-269`, `native-artifacts.ts:456-480`, `native-artifacts.ts:595-600`, and `native-artifacts.ts:624` in the same directory.

The runner treats the entrypoint itself as sufficient evidence for several supported Node forms. Preparation skips eval and non-absolute entrypoints, while execution immediately accepts eval, any entrypoint present in source closure, or a path beneath a producer receipt. Thus a project script or inline command can load an ordinary absolute external dependency whose bytes never enter the approved artifact manifest. A relative external entrypoint also avoids preparation's static graph walk even though execution accepts its declared tree. The static scanner only recognizes a call whose callee is literally named `require`, so `const load = require; load(path)` silently avoids the advertised unsupported-loader fence. Finally, imported package trees are followed through manifest dependency lists without examining their reachable code for escaping imports; a bound package can load an undeclared external module the same way.

I reproduced five variants. Each fixture prepared a version 1 artifact authority with a reviewed Node executable, unchanged command and source bytes, then changed only an external dependency that was not declared or captured. `NativePortalRunner.execute` launched the command, printed `CHANGED_UNBOUND_DEPENDENCY_EXECUTED`, returned `status: passed`, and emitted an artifact authority hash. The full post-command authority and closure checks did not reject any variant.

| Variant | Reproduced input |
| --- | --- |
| Eval | `node -e` requiring an absolute external `.cjs` file |
| Project entrypoint | A closure-bound `check.cjs` requiring that external file |
| Relative external entrypoint | `../external/harness.cjs` inside a declared artifact root, requiring a file outside that root |
| Loader alias | An absolute, declared external harness using `const load = require` |
| Package escape | An absolute, declared harness requiring a bound package whose `index.cjs` requires an undeclared external file |

This is an input-authority correctness failure, not a request for an OS sandbox. A nonce and executable hash cannot bind bytes absent from the prepared manifest. It directly violates the Task 3.3 requirement that supported external harness/module inputs are bound transitively and unsupported dynamic or escaping loaders fail with a stable prerequisite rather than inherit trust. Repeatedly hashing the same incomplete manifest cannot resolve it.

The fix must cover all allowed entry forms consistently before launch. Resolve relative entries against their actual working directory, inspect supported inline and project code module edges, and bind external edges to explicit artifact or verified producer authority. Unsupported alias/dynamic/escaping loaders must be refused explicitly. Package-manifest traversal alone is insufficient evidence for arbitrary reachable package code; either establish the supported transitive runtime closure or expose an honest explicit prerequisite. Preserve the supported real npm/Vite path and the separately approved server validator/browser inputs without introducing a blanket trust exemption for project code, eval or package roots.

## Verified areas without an additional finding

- Preparation is registered as an authenticated administrative route. It checks owner, plan/run/context/source and complete profile closure before returning resolved inputs. Registration retains the existing action nonce and hashes the exact prepared request.
- Server validator, browser and captured-asset declarations and protected effective configuration are re-resolved and compared during registration, execution and acceptance. The existing dependency-replacement regressions pass.
- Installed and generated output receipts are tied to successful producer commands and input authority. Exact inventories are checked before dependent commands and acceptance. The approved direct generated child projection, failed-command sequence gate, and changed/add/remove output regressions pass.
- The applied target is checked again after the freshness capture wait. Its actual suspended-capture race regression passes.
- Missing/future artifact authority is fenced in current execution/completion without synthesizing legacy authority.
- Supported npm provisioning uses an explicit command subset and disabled lifecycle scripts. Native same-account execution and trusted host runtime limits are stated honestly; this review did not expand the pending resource-lifecycle scope.

## Independent verification

Working directory: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-artifacts.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/ir/test/portal-completion.test.ts packages/cli/test/admin-commands.test.ts
```

Result: **6 files passed; 62 tests passed; 1 explicit opt-in Vite test skipped; exit 0; 59.12 seconds**. The expensive opt-in registry/Vite fixture was not redundantly rerun. This independent run includes the two final test-only additions beyond the implementation report's earlier 60-test run.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/task33-review-unbound-20260915.test.ts --reporter=verbose
```

Result: **1 diagnostic file passed; all 5 bypass reproductions passed; exit 0; 16.15 seconds**. These are positive reproductions of the bug, not passing safety regressions. A prior four-variant run passed (13.07 seconds), followed by the isolated fifth-variant run (4.11 seconds), before the complete diagnostic run above.

The diagnostic file is outside the 16-path integration allowlist and must not be integrated as implementation code. It is retained in the isolated copy at the exact path in the command above. The last run retained these task-owned temporary fixture roots under `C:/Users/c/AppData/Local/Temp/`: `sfp-task33-review-unbound-8FT173`, `sfp-task33-review-unbound-abo69V`, `sfp-task33-review-unbound-DU0rOw`, `sfp-task33-review-unbound-nO0stV`, and `sfp-task33-review-unbound-qefAYb`. Earlier diagnostic fixtures also remain under the same unique prefix. No diagnostic cleanup was attempted.

No implementation source, owned frozen test, Git index/history, original reference, primary dist, daemon or Chrome state was changed. No Superpowers, subagents or Docker were used. Validation used the native toolchain in the separate working copy and retained the same Windows account, filesystem, network and process permissions.
