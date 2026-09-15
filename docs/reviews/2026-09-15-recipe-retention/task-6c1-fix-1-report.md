# Task 6C1 fix 1: Enforced captured-result reservation

Date: September 15, 2026. Status: bounded fix complete and source frozen for independent review.

The main session reproduced and accepted R1 from task-6c1-review.md. The original author was unavailable, so the reviewer implemented this bounded correction. A different reviewer must independently review the final source. Initial reports, manifest and diagnostic evidence remain unchanged.

## Corrected behavior

One shared OPERATION_CAPTURE_MAX_BYTES constant defines the 8 MiB maximum for canonical captured result artifacts.

Every newly held, unverified primitive now reserves the full service maximum before dispatch. Owner and global quota accounting also charge that full maximum for all unverified active rows. A caller's smaller maxResultBytes remains its exact consumption ceiling; it no longer reduces the service's prospective reservation. After successful evidence verification, accounting can still tighten to the actual verified result length. Stable binding hashes and owner/plan/step identities do not change.

Existing signed small unverified rows remain readable with their exact binding and original reservation field. Capacity admission counts them at the full maximum even before any row rewrite, and retention continues to include their operation IDs. This preserves held evidence instead of dropping it during an index migration. Such a row can still fail result verification when its actual result exceeds the declared consumption ceiling; that is not successful consumption. A terminal row with no dependencies can be explicitly released by the original authenticated scope under the existing rules. Absent, running and unknown operations remain unreleasable. No historical binding is silently rewritten, no pre-existing artifact is deleted and no automatic success is inferred.

The actual OperationExecutor checks captured canonical result length before native evidence materialization, output-finalizer publication, success receipts, result caching and successful response publication. An oversized result after runtime completion settles as outcome-unknown, retaining the precise EVIDENCE_CAPTURE_TOO_LARGE error and its unknown-outcome finalizer. The original hold remains retained and cannot be consumed or released. The captured result artifact is not created.

DurableOperationFinalizer.succeed independently checks the same maximum before any publication or terminal claim. OperationEvidenceArtifactStore.createNew also checks before workspace resolution, directory/marker creation or artifact publication. These checks cover direct internal entry points as well as the normal executor. The safe transport error allowlist includes the fixed error code.

Exactly 8 MiB is accepted. Operations with capture disabled preserve their existing result behavior. The limit governs persisted canonical captured result bytes; it does not claim to limit transient JavaScript memory, source Figma document size, separate native export assets or arbitrary filesystem/network/process effects. A working copy under the same Windows account is not an OS sandbox.

This slice was not run in the user's live daemon before the fix. No migration of previously published oversized successful artifacts is claimed. Retained diagnostic artifacts and any manually retained pre-release state are not reclassified as valid successful evidence by this correction.

## Regression coverage

The initial new regression run failed four assertions against the unfixed code: small-ceiling admission, conservative accounting of an old small row, oversized actual executor output and direct oversized artifact publication. The no-capture compatibility case already passed. Those regressions passed after the fix.

Coverage now includes:

- A 1-byte global/owner capacity rejects a 1-byte consumption-ceiling hold before primitive dispatch.
- New small-ceiling rows durably reserve 8 MiB; a deliberately retained signed old 1-byte row keeps its binding, blocks additional admission using conservative accounting, survives a sweep and retains explicit terminal release semantics.
- The actual authenticated HTTP route accepts a small consumption ceiling only with the full reservation and rejects another small request when the full budget is occupied.
- An actual schema-valid executor result exceeding 8 MiB is rejected before the deliberately failing artifact writer can run. The journal is outcome-unknown with the specific error, receipt/artifact are absent, the finalizer and hold survive a sweep, and verification/release refuse the unknown outcome.
- Direct finalizer and artifact-store entry points reject oversized publication before their effect ports are touched.
- An exactly 8 MiB captured result is published and verified successfully; a larger uncaptured result remains supported.

## Validation

Expanded native suite:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/recipe-evidence-hold.test.ts packages/mcp/test/execution/egress-finalizer.test.ts packages/mcp/test/fs/operation-evidence-artifact-store.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/service-operation-name.test.ts --maxWorkers=1

Result: 7 files, 155 passed, 1 existing Windows-specific skip; 15.60 seconds. The skip is the existing non-Windows-only artifact-store case. After two test-only type corrections, recipe-evidence-hold.test.ts and egress-finalizer.test.ts were rerun: 28 passed, 7.10 seconds.

Static checks:

- Shared package tsc --noEmit: exit 0.
- CLI package tsc --noEmit: exit 0.
- MCP package tsc --noEmit: final rerun exited 0. Two own test typing issues were corrected, and a transient concurrent Task 6C2 typing issue was fixed by its owner before this successful rerun.
- Nine changed paths: oxfmt --check passed and oxlint --deny-warnings exited 0.
- Whole-workspace knip: final rerun exited 0 after concurrent Task 6C2 source/test creation settled. Its earlier unused-file result is superseded by this successful rerun.
- CLI recipe/default-retention/control-HTTP suite: 3 files, 48 tests passed; 77.11 seconds. Command: node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/recipe-retention-client.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1. The expanded service and CLI suites total 203 passing tests and one pre-existing Windows-specific skip; the later 28-test rerun is a subset.

No dependencies were installed, no build or live daemon was run, no Chrome/Figma access occurred, and no Git index/commit/push or original code-kb change was made. Only the isolated native working copy was edited. No Docker or Superpowers was used.

## Exact ownership

- task-6c1-owned-files.json remains the original frozen 17-path manifest.
- task-6c1-fix-1-added-preimages.json records five additional paths before editing; each isolated preimage matched main.
- task-6c1-fix-1-owned-files.json records the nine changed paths with final hashes and main preimages.
- task-6c1-final-owned-files.json records all 22 final paths. All 22 main preimages matched when the manifests were generated.

Recheck these exact hashes and preimages before integration. The original 13 unchanged paths, including all four CLI paths, remain byte-identical to the initial frozen implementation. No main copy or integration was performed by this worker.
