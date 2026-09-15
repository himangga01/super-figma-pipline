# Task 6F fix 1: Guard current source state and completion

Date: September 15, 2026. Status: implemented in the isolated validation copy and ready for focused independent review. This is not completion of production Task 6F, Task 6G, or Task 6.

The controller independently reproduced R1, R2 and R3 from the initial implementation and chose guarded writes. The original report, six-file manifest and diff remain under `task-6f-initial-*`. The controller's diagnostic fixture remains disabled and unchanged; its expected SHA-256 is `caee75e0368ef098925d74f407205ec453989c641ac4608bf249b57a1d477616`.

## Accepted findings and corrections

### R1: historical source evidence was incorrectly treated as current write authority

Historical operation evidence now rebuilds an expected source tree only. Before each pending mutation, the runner issues a new canonical `get_node` observation of the complete guarded source subtree, persists that read's original operation ID before dispatch, reserves its evidence, verifies the exact receipt and actual result bytes, and compares the current full tree to the expected tree. It never reuses the original source read as the currentness check.

The expected tree advances through a narrow explicit model:

- `rename_node` changes exactly the target's name. Every other captured source field must remain equal.
- `create_frame` appends exactly one new empty frame subtree to its observed parent.
- `clone_node` inserts exactly one new subtree after the original under the same observed parent; the original subtree remains unchanged.
- Both creation tools require a `postimageHash` in the immutable plan before any effect. This hashes the full expected produced subtree with the `sfp-recipe-produced-subtree-v1` domain. Normalization removes only structural node `id` and `parentId` fields. Names, geometry, layout, paint/style/value fields, child order and all other serialized values remain in the hash. Unique node IDs and exact internal parent relationships are checked separately. Every produced node ID must be new within the guarded source; the produced root must match the original creation receipt, expected parent, type and explicit creation arguments.
- The entire observed source after a mutation must equal the previous expected source plus only that modeled change. A newly observed output cannot define its own approved postimage.

Each mutation's post-observation uses an immutable original read intent before later effects can proceed. Restarting the client reconstructs modeled history from the original mutation and post-observation receipts. If a mutation committed before its post-observation was issued, a new canonical read can reconcile the exact planned transition. If the original mutation outcome is unknown, a post-read is itself unresolved, or the state cannot be proved, continuation blocks without replacing a write ID.

Creation or cloning into a known auto-layout parent, or a parent type other than `FRAME`/`PAGE`, is rejected before effects because the simple insertion model cannot predict its layout changes. A parent must have an observed children array. Future recipes can add explicit models; this implementation does not adopt arbitrary layout changes after writing.

### R2: an unrelated preimage did not cover existing literal effect targets

After the initial source read matches its planned subtree hash, the runner validates **all existing literal mutation inputs in the entire recipe before any effect**. Existing target nodes and creation/clone parents must belong to that observed subtree. A later uncovered literal target therefore does not leave an avoidable earlier partial mutation. An existing child inside the subtree receives full source-tree protection, including changes between the source checkpoint and dispatch.

Future generated targets must be expressed through backward references to verified original creation/clone receipts. Guessed literal IDs outside the initial source are rejected. At each step, the resolved target is checked against the modeled tree, which includes only validated prior additions. These checks strengthen the source-guard contract; they are not described as a fix for an owner-permission bypass.

### R3: completed resume incorrectly returned success from an obsolete final read

Every successful return now requires a newly issued canonical full-source read, including a fully completed intent resumed later. The full current tree must match the expected final tree. The declared final target assertions are checked against the actual target subtrees in that newly read tree. Original mutation and read receipts remain history and are not replayed as effects.

A successful result includes `currentReadback` with that fresh read's original operation ID, receipt hash and source hash. The ordinary completed-resume test verifies that a different read operation is issued while mutation counts remain unchanged. Changing the final node after completion now rejects instead of returning success.

## Durable read identities and retention handoff

Local step intents now record canonical `operationName` explicitly. This avoids inferring the tool from `plan.steps` for internal guard observations. The owner/session/target/argument/schema checks still apply to every original tool and every guard read.

- Original recipe steps remain bounded at 128.
- Stable post-read intents use `sfp_internal:post:<step-index>` and are bounded by those 128 steps.
- Fresh currentness/final observations use distinct `sfp_internal:observe:<slot>` IDs with 512 exclusive persistent slots per intent. Slots are never recycled or interpreted as permission to rerun an original write. Capacity exhaustion blocks explicitly.
- User-defined step IDs cannot use the reserved `sfp_internal:` prefix.
- The existing 8 MiB result limit, bounded JSON validation, registered workspace identity and retained file checks remain unchanged. Production owner-wide retention/admission limits can block earlier.

All observation operations use the same real owner client and canonical `get_node` admission, have service-issued operation IDs persisted before dispatch, and receive exact retention bindings including `operationName: get_node`. The missing production `RecipeEvidenceRetentionPort` still fails before dispatch. No fake default retention or owner client was added.

Task 6C's agreed service endpoints remain `recipe.evidence.hold`, `recipe.evidence.verify` and `recipe.evidence.release`. Their implementer was informed of internal observation IDs, explicit operation names, canonical schema hashing and the unchanged 8 MiB bound. Real service-port wiring remains coordinated work outside this fix.

## Validation

Final commands ran natively in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `node node_modules/vitest/vitest.mjs run packages/cli/test/recipe-runner.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`: **39 passed**, two files, 51.07 seconds. This includes 36 recipe tests and three existing client HTTP tests.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json`: exit 0.
- `node node_modules/oxlint/bin/oxlint --deny-warnings` over all six owned files: exit 0.
- `node node_modules/oxfmt/bin/oxfmt --check` over all six owned files: exit 0.
- `node node_modules/knip/bin/knip.js --include exports --reporter compact`: exit 0. The unused `RecipeAuthority` type export was removed.

The expanded fixture uses the same real persisted credentials, canonical HTTP tool/approval/evidence endpoints, executor, operation journal, egress/receipt/artifact stores, registered workspace and retained filesystem reads as the initial implementation. Its document model now actually updates parent `children` on creation, keeps descendant object links consistent during rename, and recursively remaps cloned node IDs and parent IDs while preserving sibling order. It no longer omits parent/subtree effects to make source comparison pass. The plugin document and server retention remain controlled fixture seams; no live Figma authoring was performed.

New tests cover the exact accepted failures and legitimate transitions: changed source during the same run; changed source after restart; stale completed final state; unobserved literal target and parent; a later unobserved target rejected before earlier effects; changed covered child; successful covered child rename; same-session crash after create before its post-read; changed source after a committed create; unexpected produced values rejected against the predeclared hash; recursive clone parent/ID/order preservation; known unmodeled layout parents rejected before effects; mandatory predeclared postimages; and normalization retaining value differences while rejecting broken structural parent links. The earlier original-ID recovery, concurrent no-duplicate-write, hold loss, denied approval, artifact/receipt tampering, credential/session/owner/target fences, and cancellation cases remain passing.

The first updated fixture run exposed old test assertions that counted only four operations, and a five-second test timeout that no longer covered additional real HTTP/retained-file guard reads. Tests now assert exact mutation counts, additional current read operations and distinct fresh read IDs. This fixture file uses a bounded 20-second per-test timeout; the complete final sweep result is reported above.

## Precise remaining limits

- These are point-in-time reads around separately admitted primitives, not an atomic multi-step transaction or an ABA detector. A concurrent edit in the finite interval after a pre-read and before a primitive can still race it; an unexpected post-state blocks further effects. No stronger compare-and-swap guarantee is claimed.
- The guarded scope is the full serialized subtree selected by the initial canonical `get_node`, not every unrelated node/catalog in the file. All existing literal effect inputs must be covered by that scope. A source/result exceeding the supported bounded read contract blocks.
- A created/cloned subtree's full expected normalized postimage must be known before effects. Host default differences, unsupported structure changes, auto-layout insertion and other unmodeled behavior are not silently accepted. They require a separately implemented model or explicit reconciliation.
- Client-process restart within the same authenticated owner session is supported. A changed daemon generation or control credential changes the auth session and is fenced. No code rewrites an old auth-session ID, impersonates an old owner client, or uses historical read permission as new-session write authority. Cross-session recovery needs a separately admitted current-owner/source protocol.
- Production retention wiring, advanced Task 6G recipes, public CLI routing and live authoring are still incomplete. This focused fix closes the reproduced currentness/coverage/completion defects within the supported fixture-executable guarded model; it does not mark the entire production task complete.
- Native validation shares the Windows account's filesystem, network and process privileges. File handles and hashes do not create an OS sandbox. No Superpowers, Docker, subagent, browser, daemon, live Figma, primary build, dependency or Git mutation was used.

## Final owned hashes

The full manifest is `task-6f-owned-files.json`. The five changed files and their pre-fix hashes are in `task-6f-fix-1-owned-files.json`; both retain the original main preimages. `control-client.ts` is unchanged from the independently reviewed initial slice.

| File | SHA-256 |
| --- | --- |
| packages/cli/src/control-client.ts | bc8d97aa161fc2d639b573e5381ddc76584d09ced268fa9ad34533cbfc9d0316 |
| packages/cli/src/recipe-plan.ts | b27be2c175fbab1bbbe06711aafd017b79933270ac09c32a2ea62442c39ccfdf |
| packages/cli/src/recipe-checkpoint.ts | d7fc87896edbc3eecb4cfb663156a5e171c1b5ca1c0a74f1356ae5c823fd9a7f |
| packages/cli/src/recipe-runner.ts | af4bdeaf3f91d42a65f0bfb0da3abb878c6944f638274a8d5d1ac976ec0941e6 |
| packages/cli/src/control-recipe-client.ts | b22b30530d97a89b6d0b7037e96029c6ae561ebb2199efe84183db15828c6006 |
| packages/cli/test/recipe-runner.test.ts | a4d362b596e83589e7e6089fc39bcb7b9ad58c71a4d99a4dbee3bec9b4aa72ca |
