# Task 6D: Actual core recipe lifecycle integration

Date: September 15, 2026. Status: bounded implementation complete and frozen for independent review. No main integration or final whole-code review is claimed. Actual native recipe consumption remains Task 6E.

## Implemented service path

The real index constructs CorePreparations and PortalCoreLifecycle using owner state, permissions and PortalStore, then injects the lifecycle into PortalCoordinator. This is executable service wiring, not an optional test-only adapter. The original 6C1 hold/journal/executor behavior was not changed.

Only the seven built-in core recipes now advertise implemented derivation behavior. Their definitions bind the current core-manifest output, exact core implementation contract, versioned behavior and page verifier. Conditional recipes and the upstream feature inventory retain their previous planned status. A core derivation result does not claim candidate/runtime implementation.

Actual portal_plan uses its admitted owner/workspace, current original capture descriptor and asset bytes, complete qualified source graphs/inventories, service selectors, exact semantic reviews and workflow/interaction scope. It recreates source capsules from real bounded readers, verifies source correspondence, runs or resumes the fixed seven-core preparation, reads verified signed results and attaches the plan dependency before publishing the resolved blueprint. It rechecks complete source bytes, captured files and equivalent root authority after preparation. Original captured asset roots/records are not rewritten.

The version-2 blueprint hash includes the immutable core binding hash. Core context includes the complete normalized original request hash and scope/workflow/selection identity; candidate/result hashes are not fed back into preparation input. C2 declaration eligibility uses the complete target baseline inventory overlaid by submitted files. Reference-only source files are not treated as candidate output files.

New and renewed leases require the exact current plan/run binding, current definitions, verified signed result/pages and fresh source/capture evidence. Renewal does not call preparation again. The bounded next view supplies its verified read directly rather than immediately rereading the complete maximum bundle twice. Draft/unavailable capture remains inspectable without a fabricated preparation, required result or coding lease. Legacy plans without core authority remain inspectable, receive an explicit replan issue and do not acquire a current lease.

The previously identified root '.' versus one-character root tie was also corrected in the actual coordinator workflow source-evidence predicate, consistently with the reviewed graph/core ownership rules.

## Stored/public contracts

A new independent portal-core-limits.ts module holds the unchanged core ID/limit constants. This removes a direct-import cycle without changing their values. portal-core-lifecycle.ts defines the new bounded lifecycle contracts.

Plan and run coreRecipes contain:

- recipeAuthorityVersion, status/code and current contract/requirements hashes;
- preparation/context/input identities, absent for an unavailable draft;
- the seven exact required recipe/definition/result hashes;
- work-item hash/count and the complete binding hash.

A work item names one exact typed core page: result ID/hash, page hash/index, row count, recipe family and stable work-item ID. Every row stays in that page for Task 6E verification. Up to all 4,096 supported pages can therefore receive declarations without truncating large catalogs. Page grouping is not a claim that mentioning one item verifies all its rows.

portal_next and portal_status expose bounded recipe result/work-item reads and one selected page. Requests use recipes.workOffset, recipes.resultId and recipes.pageIndex. A view returns at most 50 work items and one 1 MiB page. Per-visible-item declarationStatus reports only the presence of a bound declaration, not verification. The next instruction explains the required declaration protocol.

Public page transport uses a JSON-schema-representable JSON structural codec and then the exact existing core-page runtime validator. The outer byte/value guard runs first. This avoids the unrepresentable custom-codec failure in canonical tool result hashing without a global unrepresentable-schema waiver or weakening the typed page validator. Malformed row kinds still reject.

portal_submit accepts up to 64 coreDeclarations and 1 MiB per call. The stored aggregate is bounded at 4,096 declarations, 8 MiB, 200,000 JSON values and the existing depth limit. Individual file/assertion limits remain in force. Each declaration binds an exact result/hash/page-work-item ID/kind and current candidate file hashes or assertion IDs. Missing/foreign/changed references reject. Replacing a file invalidates prior declarations that named its old hash. Finishing requires declarations for every required work page; declarations alone never produce a verified consumption receipt.

Run state stores coreDeclarations and coreDeclarationsHash. Cancelled plan/run dependencies are removed only after the actual run has reached cancelled; uncertain/conflict states retain their dependencies. Signed evidence and charged capacity remain retained. Historical result inspection remains possible after run cancellation.

## Public recovery and intent identity

portal_plan.resumePlanId resumes an already reserved intent under a new canonical operation admission. It is a control field and is removed from the stored original request and context hashing. The service resolves it through the signed owner/workspace/intent reservation; an arbitrary record ID is not authority. The current operation/session remains current and the original failed operation is not re-executed or impersonated.

An interrupted plan reuses its exact original signed designs record, instead of recapturing and trying to overwrite it. Current equivalent root/source/capture authority is still validated. Repository authority hashes are root/scope/workspace-bound rather than operation-bound. A changed Desktop grant is not silently substituted into the immutable original observation. Changed requests, changed source context, cancelled intents and absent reservations reject. A capture failure before any core reservation still requires a normal new plan.

The coordinator emits a bounded progress event with the owner-derived plan ID so an interrupted caller can retain the resume handle. The real index passes the existing trusted progress reporter. No private source bytes or paths are included.

CorePreparations capacity rows now bind owner/workspace/intent to one context/input at the first durable reservation, before context/page/result publication. This prevents a changed request after an interrupted prefix from creating another preparation under the same intent. Old charged rows are not dropped: their binding can be reconstructed only from matching signed preparation/input records. An unreconstructable prefix or conflicting historical intent fails closed with an explicit recovery code and leaves capacity intact.

## Completion gate and Task 6E handoff

acceptance.recipeConsumption uses the existing PortalRecipeVerifiedConsumptionSchema. This task never fabricates one. portalCompletionIssues now takes the current run and expected candidate/applied target. It requires:

- a ready current plan/run core binding;
- the current bounded declarations, exact count and recomputed declaration hash;
- a consumption receipt bound to owner/workspace/context/blueprint/candidate/declarations;
- the exact seven required result hashes, correct target and core-consumption-v1 verifier version.

The actual coordinator passes the run and target. The one NativeWork.apply signature call was migrated to pass run and candidate. The internal readForConsumption method returns the verified signed result/page read in one pass and requires ready status; it is not a transport or permission grant. Task 6E must produce the receipt from actual source/native evidence. Existing native receipt-dependent positive fixtures were not made to pass with fake receipts.

## Ownership and delegated files

The main session released 5.5 coordinator/shared portal/IR files, 6C1 index, the 6B definition schema and 6C2 preparation files before edits. Fresh preimages are retained in task-6d-preimages.json.

The final guarded full-file allowlist is task-6d-owned-files.json: 20 files. task-6d-review.diff is the complete main-to-isolated diff, 164,725 bytes when generated. All 20 main preimages matched.

Four paths are explicitly excluded from that full-file copy because ownership returned to root Task 6E:

| Delegated path | Exact 6D migration |
| --- | --- |
| packages/mcp/src/portal/native-work.ts | portalCompletionIssues(plan, run.validation, run.candidateHash, run, 'candidate') |
| packages/mcp/test/portal/native-work.test.ts | Actual CorePreparations/lifecycle constructor injection and explicit page declarations bound to submitted file hashes |
| packages/mcp/test/portal/preview-native.test.ts | Same constructor migration; explicit page declarations name the actual index.html hash |
| packages/mcp/test/portal/operational-native.test.ts | Same constructor migration; explicit page declarations name the actual submitted operational files |

Their original preimages and migration descriptions are in task-6d-delegated-files.json. Task 6E owns the eventual combined full-file hashes, review and integration. No final mixed-hash claim is made here. Capture-only fixture migrations remain in the 20-file allowlist.

shared/progress.ts adds a finite set of explicit safe core error codes/messages, listed in task-6d-safe-error-codes.json. There is no wildcard error disclosure.

## Validation

Final exact native command after the shared import-cycle and transport-schema corrections:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-lifecycle.test.ts packages/mcp/test/portal/core-coordinator.test.ts packages/mcp/test/portal/core-preparation.test.ts packages/mcp/test/portal/coordinator.test.ts packages/mcp/test/portal/recipe-definitions.test.ts packages/mcp/test/portal/core-recipes.test.ts packages/mcp/test/portal/service-graph.test.ts packages/mcp/test/portal/capture-flow.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/portal/capture-native.test.ts packages/ir/test/portal-completion.test.ts packages/shared/test/portal.test.ts packages/shared/test/portal-recipes.test.ts packages/shared/test/core-recipe-pages.test.ts --maxWorkers=1

Result: 14 files, 155 tests passed, 75.87 seconds.

Coverage includes actual signed preparation/coordinator calls; required core definition identity; page/declaration bindings and file invalidation; all 4,096 declaration slots and aggregate byte limits; draft/legacy no-lease behavior; renewal without derivation; page MAC changes; one-character workflow ownership; semantic edits and newly added binary inventory members blocking renewal; interrupted plan publication and unchanged original capture adoption; first-reservation intent binding; reconstructable/unreconstructable legacy prefixes; cancelled dependency lifecycle; and exact consumption identity gates.

The actual canonical execution-plane regression proves a failed operation resumes under a new operation and new authentication session without repeating capture or changing the original failed journal record. It also tests changed requests, wrong owner, absent reservation and cancellation rejection. This uses controlled capture handlers and real service admission/executor/store code, not the user's live Figma session.

Static checks:

- Shared, MCP, IR and CLI package tsc --noEmit: all exit 0 in the final parallel read-only check.
- All 20 owned paths: oxfmt --check and oxlint --deny-warnings passed.
- The last full knip run reported one concurrent Task 6F unused file, packages/cli/src/recipe-compositions.ts, outside this ownership. No ignore was introduced. Main must rerun after that consumer wiring settles.

An earlier expanded run passed 90 runtime tests but failed two direct-import shared suites before test execution; that real circular-initialization failure was corrected with the independent constants module and lazy declaration reference. An earlier actual canonical resume test exposed the public page JSON-schema hashing failure, which was corrected with the bounded structural codec. Both regressions are included in the successful final sweep. No failed verification is represented as successful.

All commands used the separate native working copy under the same Windows account. It shares filesystem/process/network privileges and is not an OS sandbox. No Superpowers, Docker, dependency installation, live browser/Figma/daemon, build, original code-kb mutation, main copy, Git index change, commit or push was performed by this task. Root's concurrent 6E dependency work is separate.

## Remaining work

Independently review/integrate these exact bytes. Complete actual Task 6E receipt production and positive native consumption validation, conditional recipe compositions/routing, current live C4/C2/C3 cases, portable capture/provenance, both final whole-code review rounds and exact clean-source verification. The user-authorized final commit/main merge/push remains pending in the main task.
