# Task 6C1: Durable recipe evidence holds and real protocol integration

Date: September 15, 2026. Status: bounded implementation complete and frozen for main review/integration. This is the server evidence-retention slice, not core recipe preparation, portal lease adoption, or final workflow completion.

## Implemented behavior

The actual service and default CLI recipe client now support these canonical service operations:

| Service name | Authenticated route |
| --- | --- |
| `recipe.evidence.hold` | `/control/recipes/evidence/hold` |
| `recipe.evidence.verify` | `/control/recipes/evidence/verify` |
| `recipe.evidence.release` | `/control/recipes/evidence/release` |

They use the existing service admission/execution plane, operation IDs, egress, approval, journal, receipt and finalizer machinery. They are not additional public Figma/portal tools or direct unauthenticated mutations. A Figma target is forbidden on these metadata service requests; the binding separately identifies the exact future/existing tool operation and its target hash.

The strict v1 binding contains plan hash, step ID, tool operation ID/name/kind, actor, original authentication session, workspace, target/argument/result-schema hashes and a result byte ceiling of at most 8 MiB. The result is a strict envelope containing the exact binding, hold ID, held/released state and optional verified receipt/finalizer/result/artifact metadata. No caller-supplied `held: true` or generic `passed` flag supplies authority.

`RecipeEvidenceHolds` matches actor/session/workspace to the actual execution scope. Before an operation exists, it verifies the service-issued ID for that actor and the current canonical result schema, and reserves retention capacity before the primitive can be dispatched. Once an operation exists, its real journal/tombstone fields must match. A stable owner/plan/step key cannot silently move to another operation ID or argument binding; an operation cannot be reused for another step. Released holds do not reopen.

Verification uses the actual `OperationEvidenceEndpoint` to validate journal/receipt/finalizer relationships, then reads the exact canonical operation-derived artifact path through a bounded workspace `RepoReader`. It checks bytes, SHA-256, result schema and canonical JSON round trip. Wrong, missing, malformed or changed results do not become successful consumption evidence. It never reconstructs an owner actor from caller fields; the real scope principal is passed to evidence verification.

The default `ControlRecipeClient` now uses this real protocol when no trusted injected test port is supplied. It parses the shared server response contract, compares the entire binding/hold ID and artifact identity, and requires non-null verification before consumption. Only the two fixed hold/verify metadata calls receive client-level approval automatically. The existing primitive `approve` option, source freshness, scope checks, result recovery and mutation/readback guards remain unchanged. There is no automatic runner release. `ControlClient` maps service routes explicitly and rejects unknown services before issuing an operation ID; it no longer treats every non-snapshot service as grounding refresh.

## Atomicity, retention and recovery

The signed owner-state index is stored by `PortalStore` under `portal/recipe-holds/index.json`. All hold, verify, release and dependency-index mutations use one retained-directory/interprocess canonical-path mutex rooted in service state. The **entire** actual generation retention sweep uses that same mutex and one immutable active hold snapshot:

1. Held operation IDs return `linkedAt = null` for receipt/finalizer compaction.
2. Pending artifact cleanup refuses a held operation and leaves its unresolved cleanup intent retained.
3. Result and native artifact orphan scans include held membership.
4. Expired journal tombstones are purged only under the same live snapshot and only when unheld.

This closes both orders of the check-then-hold race. A hold published first protects its evidence; if a complete sweep wins first and evidence expires, the late hold rejects rather than pretending to restore it.

Journal tombstones are essential because evidence verification needs their original session and operation fingerprints. The actual service journal is now configured with `externallyManagedRetention: true`. Every implicit expiry path, including recovery and append-time cleanup, preserves tombstones in this mode. Explicit purge requires an active internal retention snapshot; absent protection is a no-op, while forged or expired snapshot objects reject. Default behavior for journals not using managed retention is unchanged. The snapshot is scoped to the callback and cannot be supplied as transport JSON. It is a trusted internal coordination mechanism, not protection against arbitrary same-process code.

Server-only dependency hooks retain/remove parent reference IDs under the same mutex; no HTTP schema accepts dependency changes. Explicit release rejects live dependencies, absent/unsettled operations and unknown outcomes. Later portal adoption must attach those references before publishing a dependent plan. Cancelled calls waiting on the mutex check cancellation before work/publication and do not create late holds.

Successful verification can tighten logical reservation to actual verified result bytes. Previously verified evidence cannot change silently. Crash/unknown outcomes retain their holds and cannot be consumed or released as successful terminal results. An actual executor test covers runtime completion followed by artifact publication failure.

## Finite quotas and actual protection limits

| Limit | Bound |
| --- | ---: |
| Result bytes per binding | 8 MiB |
| Active holds per owner / globally | 1,024 / 2,048 |
| Historical rows per owner / globally | 2,048 / 4,096 |
| Logical reserved result bytes per owner / globally | 2 GiB / 4 GiB |
| Internal parent references per hold | 128 |
| Recipe-hold CAS replacement history | 4,096 generations, 1 GiB, 20,000 scan entries |

Logical reservation is not physical filesystem preallocation. Actual record/history caps, filesystem failures and durable publication remain separate limits. Physical history exhaustion has an explicit `RECIPE_HOLD_HISTORY_CAPACITY_EXCEEDED` code. Existing evidence is not evicted to admit new work. A verification/accounting publication failure can stop a recipe after an earlier primitive succeeded; the original hold and its evidence remain protected and the run requires inspection/recovery. No guarantee of unlimited history or guaranteed disk space is made.

The generic `AtomicFileStore` was not modified. Only the `recipe-holds` record kind receives the deliberate larger replacement-history budget; existing environment and other store policies remain unchanged.

Authentication session continuity is strict. `deriveControlAuthSession` changes across daemon generation/credential changes. Fresh store/manager recovery preserves held evidence, but a new control session cannot impersonate the old one or rewrite its binding implicitly. Cross-session re-admission/ownership recovery is separate work. Parent dependency adoption/release policy must be completed in Task 6D.

All validation used native tools in the separate working copy under the same Windows account. The copy shares filesystem, process and network privileges; it is not an OS sandbox. Temporary loopback HTTP servers and simulated Figma handlers were test fixtures. No user Chrome/Figma session, live daemon, Docker, Superpowers, dependency installation, build, Git index, commit or push was used. Original `code-kb` checkouts were untouched.

## Source integration and ownership

Main released Task 5.3 index ownership and the integrated Task 6F fix-2 client files before this work changed them. Their exact fresh preimages were recorded in `task-6c1-wiring-preimages.json`, `task-6c1-journal-preimage.json` and `task-6c1-client-preimages.json`. No native runner/work/visual files were edited. Task 6B files remained frozen while their accepted source-selection/review fixes were delegated separately.

Actual `index.ts` now constructs the manager, registers executable service operations and routes, and wraps receipt/finalizer/pending-artifact/orphan/tombstone retention together. This is implemented source wiring, not just a suggested patch. No live service build or startup was performed in this slice.

`shared/progress.ts` has a fixed allowlist of recipe-hold errors with bounded messages; there is no wildcard extension of server error disclosure. HTTP failures therefore retain actionable hold codes rather than collapsing to `INTERNAL_ERROR`.

## Verification

| Command/check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/recipe-evidence-hold.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/service-operation-name.test.ts --maxWorkers=1` | 4 files, 55 tests passed, 7.59 seconds |
| `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/recipe-retention-client.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1` | 3 files, 48 tests passed, 77.47 seconds |
| Shared, MCP and CLI package `tsc --noEmit` | All three exited 0 |
| Owned 17-path `oxfmt --check` | All formatted, exit 0 |
| Owned 17-path `oxlint --deny-warnings` | One new test mock required a type annotation; corrected, affected test lint exited 0 and its 8 tests were rerun successfully |
| `node node_modules/knip/bin/knip.js` | Exit 0, no findings |

The two complete focused suites total 103 passing tests and include the original 39 CLI regressions. Coverage includes actual canonical executor capture/receipt/finalizer/artifact verification, real authenticated HTTP service execution, the real default client running/resuming a concrete recipe with fresh internal read intents and no repeated writes, same-key changed bindings, forged IDs, wrong actor/session/workspace, cross-manager capacity, both sweep/hold race orders, signed-index tampering, modified artifact bytes, dependency release refusal, unknown outcomes, cancelled mutex waits, and fresh journal/receipt/finalizer/hold-manager recovery at an expired timestamp with held/unheld tombstone behavior.

The default-client protocol test initially hit the inherited 20-second fixture timeout. Bounded progress counters showed ongoing work and a successful complete run in approximately 25 seconds; the test now has a 60-second budget. Temporary progress output was removed. Its final execution is included in the 48-test suite. Earlier HTTP diagnostics exposed missing safe error-code routing, which was corrected instead of accepting generic success/failure responses. Fresh-instance recovery is tested through actual persisted stores; no OS process-kill test is claimed.

## Exact final owned bytes

`task-6c1-owned-files.json` contains all 17 paths/hashes/main preimages. `task-6c1-client-owned-files.json` separately identifies the four CLI paths. Recheck hashes and preimages before integration. Files are frozen for review.

| Service-relative path | SHA-256 |
| --- | --- |
| packages/shared/src/service-operations.ts | bf50f788e380f4c0377a7dc94e13caa155cbea55e16c206cab327054e8656ad6 |
| packages/shared/src/progress.ts | e0875fefd0e618b9d8d13a428d76fc8ed0a97f11329b19c45d55e7d1c664b7d8 |
| packages/mcp/src/index.ts | 61a77cb76b77a0da750912aa3b0fa03769e1a9b46b9adb0630f3af055be130db |
| packages/mcp/src/portal/store.ts | 3ed91968039ad424d5a138dd0133196178d4229dc1376352034bb9045625ba23 |
| packages/mcp/src/execution/service-operation-registry.ts | e23596cf9e438249a1b84ced59b32e84e75558f68d6df487501107711a01a845 |
| packages/mcp/src/execution/operation-journal.ts | 20ff1c3139d8fb48996538e3ce71eb88b32ce4c83b116488763d520750d673aa |
| packages/mcp/src/execution/retention-scope.ts | dd3864b7c391f4940c4ec5b41d3555f83788f4cc8d20dec34eff79f7c654f19e |
| packages/mcp/src/portal/recipes/evidence-contract.ts | 7e59da1a304b3cc53c6f647a2bfe552f2943db081bc0960b6bdfc1451b4cc613 |
| packages/mcp/src/portal/recipes/evidence-hold.ts | 61129690dce56a88d2ea462bc919bd64d9ff94b0775efc1d60bcf6198628347d |
| packages/mcp/src/portal/recipes/evidence-operations.ts | 07d969e89ba7680664f0f530128d2ef70260718524617b82f009021fd19973a3 |
| packages/mcp/src/portal/recipes/evidence-control.ts | fe0d0d4972adb6ddb16798b3b272140c71fff64af0854072c4ab513b32f9fd2a |
| packages/mcp/test/execution/service-operation-registry.test.ts | 92600dfd0784d97d07c0c88a0564f285b7a46d90dcbc2cc4609ca59145c700a3 |
| packages/mcp/test/portal/recipe-evidence-hold.test.ts | 583ad7c4ffef448606b8bde33781c48d705f40668e5d43277fb2d12100d394be |
| packages/cli/src/control-client.ts | a07baff6b42b3a6c7dc409c8b13316e74145a4bdbe8f23cf63daf70f17b33860 |
| packages/cli/src/control-recipe-client.ts | 32daab46bb8a171681231da437fb02133fbdb022968205a0ba6ed435e0a9d5c2 |
| packages/cli/test/recipe-runner.test.ts | 555ab454f798e1c6d9fe1c448a4f3cc08ac6532b04c542d1c12bdf644f22e17b |
| packages/cli/test/recipe-retention-client.test.ts | 81f309d5572559e1ce3d8ceb411c30745c7ace2170960b03a6b60e3b1636daf1 |

## Remaining work

Main must independently review/integrate this exact slice. Core immutable context/page/result preparation and resumable checkpoints remain Task 6C2; resolved blueprint/lease adoption and live parent references remain Task 6D; actual candidate/runtime consumption verification remains Task 6E. Conditional authoring expansion, precise cross-session recovery, final live case validation, both whole-code review rounds and final clean-source commit/main push are not completed by this evidence-hold implementation.
