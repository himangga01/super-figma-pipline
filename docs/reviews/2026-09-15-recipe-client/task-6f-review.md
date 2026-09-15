# Task 6F independent client review

Date: September 15, 2026. Verdict: changes required.

The six owned source/test hashes match `task-6f-owned-files.json`. Review inspected the actual client, closed plan, checkpoint store, unchanged canonical control dispatch, evidence/artifact readers, and real HTTP/executor fixture. No owned source was edited.

## Findings

### R1 — P1: retained source reads authorize later writes without checking current source

Locations: `service/packages/cli/src/recipe-runner.ts:34-50` and `:83-93`; `service/packages/cli/src/control-recipe-client.ts:90-104`.

Before a mutation, the runner calls `assertCurrent` and recovers the original first-step result. The first checks credential, session, generation and file identity; the second verifies immutable historical operation evidence. Neither reads the present document. A source change under the same session therefore does not invalidate continuation. This affects both ordinary between-step execution and resumption after a crash, not just an unimplemented advanced recipe.

Two diagnostics reproduced this through the real canonical HTTP/executor/receipt/artifact path. First, a simulated crash after the initial source checkpoint was followed by changing the source node name; restarting the same intent still dispatched create and rename and returned success. Second, changing the source immediately after that checkpoint without a crash also allowed both writes. Both executions made only the original source read: `get_node, create_frame, rename_node, get_node`.

Required correction: distinguish historical recovery from currentness admission, and prove the applicable expected current preimage before the first, resumed and subsequent effect, accounting explicitly for earlier recipe effects. If that cannot be proved under the supported consistency model, block new effects while preserving original operation IDs and partial outcomes. Do not solve this by re-executing an original write or merely renaming the historical evidence. Unavailable production retention is already blocked; it does not resolve the independent currentness defect once a legitimate retention adapter is supplied.

### R2 — P2: source-preimage coverage is ambiguous for literal mutation inputs

Locations: `service/packages/cli/src/recipe-plan.ts` executable-plan refinement; `service/packages/cli/src/recipe-runner.ts:35-50`.

The plan requires one initial `get_node` subtree hash and final reads, but never checks whether concrete mutation targets or parents belong to that observed subtree. A valid plan can hash node `1:1`, rename unrelated existing node `2:9`, and read `2:9` afterward. Changing `2:9` after plan construction is invisible to the sole preimage check, and the runner overwrites that edit. Refreshing only the currently declared initial node would still miss this case.

A fourth diagnostic submitted exactly that strict three-step plan using the real fixture. It passed parsing, overwrote the unobserved target's changed name, and returned success with `get_node, rename_node, get_node`.

This is not an owner-permission bypass: `2:9` is explicitly present in the owner's concrete plan. Its significance is the source-guard contract. If mutations are promised protection against changed inputs, the existing single-preimage requirement does not provide that protection for such targets. Main should adjudicate that contract explicitly rather than infer a global subtree restriction from file-level permission.

Required correction under the source-guarded contract: verify source membership/coverage for existing literal inputs or require separately bound preimages for the relevant targets. Alternatively, explicitly model owner-intended unconditional writes and do not describe those as protected by the unrelated source preimage. Results from prior verified recipe writes need an explicit expected-state transition where current preimages are required. A final post-write read is insufficient to protect an unobserved preimage.

### R3 — P2: completed resume reports ordinary success from obsolete final readback

Locations: `service/packages/cli/src/recipe-runner.ts:54-55`, `:91-104`.

On a completed intent, all steps are recovered from their original operation IDs. The final readback assertion is evaluated against the old artifact and the method returns the same `status: succeeded` as a new verified execution. It performs no current read and supplies no historical/recovered designation. After a successful run, changing the final node's name and invoking the same intent again still returned success even though its declared `name: Finished` invariant was false in the document. The second call dispatched no tools.

Required correction: retain original mutation outcomes without replay, but use new bounded canonical readback/reconciliation evidence before claiming current completion; alternatively return an explicit historical outcome or block current completion when current verification is unavailable. This terminal-only case must remain covered even if continuation is conservatively blocked for unfinished intents.

## Validation and retained diagnostics

- Existing focused client tests plus the first three diagnostic cases: 27 passed across three files, 28.44 seconds.
- Final four diagnostic cases: 4 passed, 10.85 seconds.
- Diagnostic assertions deliberately prove the observed unsafe behavior; their passing status is evidence of the findings, not a safety pass.
- Command: `node node_modules/vitest/vitest.mjs run packages/cli/test/review-task6f-currentness.diagnostic.test.ts packages/cli/test/recipe-runner.test.ts packages/cli/test/control-client-http.test.ts --maxWorkers=1`, followed by a focused rerun of the diagnostic file after adding R2.
- The diagnostic fixture is retained at `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/cli/test/review-task6f-currentness.diagnostic.test.ts.disabled`. It was renamed within the validation workspace to avoid test discovery and unused-import pollution. Main can reproduce by temporarily restoring its test extension. Do not integrate this copied fixture into source.

## Boundaries that passed inspection

The concrete tool allowlist, backward typed references, argument/schema bindings, original-operation recovery, owner/session/target verification, artifact path derivation, bounded canonical byte verification, receipt hash recomputation, per-step exclusive intent and default-failing retention adapter are substantive safeguards. Existing 24 focused tests passed. No additional defect was established in those paths during this bounded review. Unknown operations remain inspectable by original ID and are not automatically resent.

The absent production retention endpoint/owner-wide quota integration is the explicitly assigned Task 6C dependency and was not counted as a separate Task 6F implementation defect. The fixture retention and document ports are test seams, not production proof. Filesystem protections share the current Windows user's permissions and do not constitute an OS sandbox. No Superpowers, Docker, browser, live Figma, daemon, build, dependency, Git mutation or subagent was used.
