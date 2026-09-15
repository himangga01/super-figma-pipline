# Task 6F: Owner-client dependent recipe foundation

Date: September 15, 2026. Status: bounded implementation ready for independent review; not complete Task 6F, 6G, or Task 6.

## Implemented boundary

The isolated validation copy now contains a concrete owner-client runner for `create_frame`, `clone_node`, `rename_node`, and `get_node`. Its strict executable plan is deliberately separate from the existing upstream catalog's `execution: planned` skeleton. A plan requires a source subtree preimage, at least one mutation, and final canonical reads for every written target. Arguments use the actual canonical ToolSpec input schemas. References are closed backward `nodeId` fields assigned only to supported `nodeId` or `parentId` arguments. Arbitrary callbacks, JavaScript, shell, JSONPath, forward references, implicit current-page creation, and node IDs parsed from logs are unavailable. Node targets must be concrete node IDs.

The runner uses the existing `ControlClient.invoke` and service-issued operation IDs. An immutable local intent stores the exact normalized plan, and an exclusive per-step record stores the original operation ID, concrete arguments, parsed-argument hash, expected result-schema hash, plan hash and step ID before dispatch. Only the winner of that exclusive claim dispatches. A resumed or competing process inspects the original operation and never sends a replacement write. A crash before dispatch therefore leaves a missing original operation that blocks rather than being guessed safe to retry. Local records use the existing `AtomicFileStore` and retained directory chain; they are not server permissions.

Each admitted primitive still goes through the real owner credential, canonical control tool envelope, target selector, workspace, approval and operation execution. The narrow `ControlClient` addition optionally pins a hash of the actual control credential and leader generation before every HTTP request. This detects a changed token even within the same leader generation. It does not expose the token or derive an owner grant from a hash. The current daemon derives its immutable owner actor from the principal key and its control auth session from that key, credential and generation. The initial read's original operation must match the plan's actor and auth session before any recipe write; subsequent requests require the same credential and generation and the same pinned plugin session, plugin generation and file identity.

Recovery accepts actual strict operation records or terminal tombstones. It verifies original operation ID, owner actor, origin auth session and control entry path, operation kind/name, parsed arguments, workspace, target binding, generation and operation fingerprint. Only canonical `succeeded` outcomes may supply dependent values; operator `resolved-applied` outcomes are insufficient. The authenticated evidence view is checked against the operation and its finalizer, including result byte count, result/schema hashes and receipt links. The receipt content hash is independently recomputed with its owner and prepared-state fields.

The artifact reader obtains the workspace only from authenticated `/control/workspaces`, compares its registered root identity, retains the directory ancestry, and derives the one allowed operation artifact path from the original operation ID. It reads at most 8 MiB and verifies byte count, SHA-256, bounded JSON, the actual strict result schema and canonical round-trip bytes. Missing, redacted, altered or malformed results cannot supply a new node ID. Previously used reference outputs and the source preimage evidence are reverified before dependent arguments are resolved. A final `get_node` checks node identity and the plan's declared name/type/dimensions/parent/subtree invariants, rather than accepting successful mutation receipts alone.

Cancellation persists a local stop marker, stops later dispatch, and retains active-step intent and actual operation outcomes. Cancellation can race a completed primitive: a completed result remains completed, and the recipe still stops before subsequent steps. An active unknown result is preserved through its original operation ID and is not automatically retried.

## Required server handoff: retention

`RecipeEvidenceRetentionPort` is a trusted server-adapter interface, not a caller-supplied `held: true` assertion:

- `ensureHeld(binding)` runs before dispatch.
- `verifyHeld(binding)` runs before reading/using retained output, and again after artifact reading.
- The binding contains version, plan hash, step ID, original operation ID, actor ID, auth-session ID, workspace ID, target-binding hash, parsed-argument hash, expected result-schema hash, `operationKind: tool`, canonical operation name, and `maxResultBytes: 8388608`.
- A release is intentionally absent from the runner. Releasing evidence is a separate explicit server lifecycle action after all dependencies end.

**The default adapter throws `RECIPE_RETENTION_UNAVAILABLE` before dispatch when this port is absent.** The tests inject a bounded fixture hold adapter. Production server hold/verify/release, durable owner-wide capacity reservation, retention-sweep coordination, receipt/artifact/readback reference accounting, and live endpoint wiring remain Task 6C. The controller's agreed direction is canonical `recipe.evidence.hold`, `recipe.evidence.verify`, and `recipe.evidence.release` service operations. `ControlClient.invoke` currently routes non-snapshot service operations to grounding refresh, so those new service names need explicit canonical routing before a real port can use them.

Existing evidence APIs used without changes:

- `POST /control/operations`: issue the original operation ID.
- `POST /control/tools/call`: actual canonical tool envelope with `captureResult: true`.
- `GET /control/operations/:operationId`: original record or tombstone.
- `GET /control/operations/:operationId/evidence`: `OperationEvidenceViewV1`, including receipt `resultArtifact` (`artifactRelativePath`, `artifactDigest64`, `resultSchemaHash`).
- `GET /control/workspaces`: registered workspace identity.
- Existing exact-operation approval and cancellation endpoints remain inside `ControlClient.invoke`.

## Validation

All native validation ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

- `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **24 passed**, 2 files, 19.96 seconds on the final test sweep.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json`: exit 0.
- `node node_modules/oxlint/bin/oxlint --deny-warnings` over the six owned files: exit 0, no findings.
- `node node_modules/oxfmt/bin/oxfmt --check` over the six owned files: exit 0.

The HTTP fixture uses real persisted rotating follower/control credentials, real owner/auth-session derivation, real canonical tool-call and evidence endpoints, real `OperationExecutor`, approval begin/resume/reject handles, file queue, operation journal, egress finalizer store, receipt store, registered workspace policy, result artifact store, atomic checkpoint files and retained artifact reads. Its plugin port is a bounded in-memory document fixture. Its OS ACL verification and server retention port are controlled test seams, not claims that production retention or a live Figma document was exercised.

Covered cases include actual dependent create-ID propagation and final readback; default retention unavailable; denied write; client crash after committed create and before checkpoint; original-ID recovery without duplicate writes; wrong owner/auth session/target binding; changed source preimage and plugin session; missing receipt artifact; altered retained bytes; incorrect receipt argument hash despite a `serverVerified` flag; final readback mismatch; between-step and active cancellation; same-generation credential rotation; malformed/planned/forward-reference recipes; missing original operation after pre-dispatch crash; concurrent same-intent clients; changed concrete arguments; and loss of a held dependency.

Early fixture failures exposed actual terminal tombstone behavior and Windows numeric file-ID precision. Both were corrected against existing production contracts: tombstones retain the necessary bindings, and the reader verifies the full registered bigint identity under the retained directory authority while using the existing numeric authority API. These were implementation-development checks, not unexplained passing claims. The active-cancellation test accepts the two valid service races: a verified completed primitive followed by recipe cancellation, or an unresolved/unfinished original operation that remains available for reconciliation.

## Limits and unfinished work

1. Production retention remains unavailable by default. No unrestricted fallback or fake owner adapter exists. This slice must not be exposed as production-complete dependent authoring before Task 6C integration.
2. A retained original source read proves that original observation. On client restart, recovering that read does **not** prove present document freshness. The current runner verifies identity continuity and declared final state, but does not provide document-wide epoch/ABA protection or an atomic source compare-and-swap across several primitives. Fresh canonical reconciliation/readback/current capture and the supported source-change policy must be completed before claiming safe unattended continuation under arbitrary concurrent document edits. This is an explicit integration gap, not a successful capture claim.
3. Final invariant coverage is exactly the concrete plan's declared properties and written targets. It is not an independent proof of all unmentioned design semantics or unrelated subtrees.
4. The runner does not yet generate concrete plans from upstream strategy catalogs, expose a new public CLI command, implement advanced variable/style/import/text/font/variant/annotation/motion recipes, or perform live authoring. Those are Task 6G/6H and missing canonical primitive work.
5. Per-plan payload/step/result/file limits are enforced; production owner-wide retention and admission capacity belong to Task 6C. Native fixture roots under the OS temporary directory, prefixed `sfp-recipe-`, were retained, not deleted or copied into the repository.
6. This work shares the Windows user's filesystem, network and process permissions. Retained handles and identity/hash checks are file-operation protections, not an OS sandbox. No Docker, Superpowers, browser, daemon, live Figma, primary build, dependency, Git-index or commit operation was used.

## Owned file hashes

Only these six files may be integrated. Original main preimages are recorded in `task-6f-owned-files.json`; all new source files have null preimages.

| File | SHA-256 |
| --- | --- |
| packages/cli/src/control-client.ts | bc8d97aa161fc2d639b573e5381ddc76584d09ced268fa9ad34533cbfc9d0316 |
| packages/cli/src/recipe-plan.ts | e53052081b43b5c76d03fe5f0a720e115d9d00063eaf948094e82df9eff56268 |
| packages/cli/src/recipe-checkpoint.ts | 3b3643132a067e3457fe8287f72d6267b08a4b91e48b424863331c29b0ab4046 |
| packages/cli/src/recipe-runner.ts | 82325c239c4dc8d96361700e2b6a763e4814e17010093f01115ef34bdd763713 |
| packages/cli/src/control-recipe-client.ts | 13091682ebab01bc0caa63b7504385b6956d5324a1f76050c84ac2c9833dd3d6 |
| packages/cli/test/recipe-runner.test.ts | 3c29dac919ce1bb2baeca6d4ab8e9e5cc4e1ad9f8bd43cf00c8c5d346bc190a5 |
