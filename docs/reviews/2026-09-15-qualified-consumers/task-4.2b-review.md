# Task 4.2b independent critical consumer review

Status: changes requested. Three reproducible P2 findings; the main agent reported independent reproduction and acceptance of all three. This is a scoped review, not either required final whole-code review round.

## Reviewed scope and method

Read the final remaining-work plan, Task 4.2 brief, implementation report, qualified graph/selection/coverage contracts and actual coordinator, native profile and IR consumers. Checked directed service closure, ambiguous selectors, exact semantic reviews, hard incompleteness, workflow refinement and source hints. Current capture descriptors, Desktop admission, recipes and interaction receipt work are explicitly later assignments and are not findings here.

All work ran in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. This native working copy shares Windows account, filesystem, process and network privileges; it is not an OS sandbox. No frozen production source, dependency, browser/daemon, build output, Git state, Docker or Superpowers changes were made. No subagents were used.

## Findings

### R1 — P2: truncated diagnostics can be promoted to fully reviewed selection

Locations: packages/mcp/src/portal/service-selection.ts:89 and :161; producer packages/mcp/src/portal/service-connections.ts:145.

The producer retains only 512 diagnostics and records complete=false, without retaining whether additional issues were lost. Selection reviews only retained diagnostic rows and computes complete from its new unmatched-issue array, ignoring the lost-diagnostic condition. A real source file containing 513 distinct fetch('/api', optionsN) calls has 513 separate unproven option sites. Generate exact qualified reviews for the retained 512 rows and invoke the actual coordinator. Observed result: selectedClosure.complete=true and selectedClosure.issues=[], although the 513th site was never reviewed. Complete byte inventory is true and does not prove complete semantic review.

Retain a non-reviewable truncation/limit flag or reserve a non-reviewable limit diagnostic when observations are omitted; enforce it through graph selection. Review may resolve semantic uncertainty only when every required issue is known. Audit graph issue truncation similarly. Add a 513-issue actual coordinator regression that remains unresolved despite reviews of all retained rows. As a boundary observation, requesting an unreviewed draft at this size currently also overflows the plan's max-512 issue array instead of returning a bounded stable incomplete result; aggregate issue publication should preserve the same hard limit state.

### R2 — P2: auxiliary imports become runtime workflow requirements

Location: packages/mcp/src/portal/coordinator.ts:603.

Service graph correctly avoids assigning runtime layers from auxiliary test imports, but still retains their module evidence for inventory/review. The new source-hint consumer loops every service.evidence entry without preserving or checking runtime relevance. A reference with a local read-only Dashboard, React, jsonwebtoken only in devDependencies, and a tests/mail.test.ts import of jsonwebtoken gains required authentication and authorization. Its workflow evidence labels that test file as an observed authentication capability in the selected service closure. No production source imports it. This invents required service behavior and contradicts the read-only dashboard rule.

Derive workflow hints only from qualified runtime-relevant evidence, while retaining auxiliary bytes and historical evidence. Do not apply a blanket filename exclusion to code actually imported by production; preserve explicit evidence roles/reachability. Add actual coordinator tests for a test-only authentication module (no identity layers) and equivalent production capability (identity evidence retained).

### R3 — P2: C4 requirement refinement can erase observed error states

Location: packages/mcp/src/portal/coordinator.ts:650; coverage presence check packages/mcp/src/portal/service-selection.ts:236.

The merge preserves inferred states/routes only if both existing.workflow and inferred.workflow exist. In C4 the caller can supply the inferred requirement ID with frontend layers but omit workflow. The inferred workflow is then discarded, coverage treats the ID's presence as covered, and C4 correctly does not require operational blueprint confirmation. Reproduction: a Contact form has a Submit control and Invalid email error text. Initial figma-form-submit includes validation-error. Replan with the same ID and no workflow. The resulting requirement has no workflow, workflowCoverage.complete=true, and portal_start returns waiting-agent.

Preserve inferred workflow observation data when a declared workflow is absent, and union mechanically required states/routes when it is present. Keep C4's frontend-only behavior and do not add an operational confirmation requirement solely to mask this merge defect. Add the actual coordinator regression plus the existing explicit-workflow refinement case.

## Verification and retained diagnostics

- Independent existing-suite sweep: coordinator, service-graph, workflow-requirements, shared portal, IR portal-completion: 5 files, 59 tests passed, exit 0, 10.16 seconds.
- Final diagnostic run at 06:24:11: 3 negative regressions failed exactly on the three findings, 2.42 seconds. The shell wrapper restored the disabled suffix in finally, so its overall exit code is not a passing Vitest claim.
- The main agent separately reported reproducing all three and a 131-test passing baseline. That baseline does not exercise these counterexamples.
- Retained diagnostic: C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-task42b-consumers.diagnostic.test.ts.disabled.
- Diagnostic SHA-256: abea65727426ee486c347ebe5c734891784371e87faac7c58ab97b636ba891c3. The suffix prevents its fixture-only unused imports and intentionally failing assertions from interfering with parallel typechecks/tests. No file was deleted.
- To reproduce, temporarily enable the .test.ts filename in the separate copy and run the existing Vitest runner for that file, then restore the disabled suffix. Do not integrate the diagnostic as production code; the implementer should add maintained focused regressions.

## Frozen reviewed identities

All eleven owned files were independently hashed and matched the reported manifest. No source fix occurred during this review.

| File | SHA-256 |
| --- | --- |
| `service/packages/shared/src/portal.ts` | `ad5a936b83f74933de93f1503ab90a8cd58d80ca4b88558072c94990d4ad00af` |
| `service/packages/ir/src/portal-run.ts` | `5a41a6e5b9502fbd3a1fbf896cd23e554e7b940c172a8e0b4c15e850c5db4b28` |
| `service/packages/mcp/src/portal/service-graph.ts` | `b93bc7e8db013999b5e3bdd87712aae64fccfcc5ccb8e9ee64cb5dba58fd3870` |
| `service/packages/mcp/src/portal/coordinator.ts` | `ddd3861d2a8ba4d7ebafb8f84e16a3fd228c386f9dbf7eb8eaf432645be8f6a9` |
| `service/packages/mcp/src/portal/native-work.ts` | `cdfcab34731be730e30af7fe1a7970885e8ae18435e907b85a30502a10150adb` |
| `service/packages/mcp/src/portal/profile-closure.ts` | `40b898d2d59493b9eb3e9828b4867e7c0ccffb32edb3e0c73731dbb0d87a2564` |
| `service/packages/mcp/src/portal/service-selection.ts` | `122aceb982e02ce264d6fe00724ff857a6d1d5c6dcb272d34828720ee0db6741` |
| `service/packages/mcp/test/portal/coordinator.test.ts` | `49738c709a9f17a618c18a97daac177a3d6cec733c2057d24c3d27df9ef9ebba` |
| `service/packages/ir/test/portal-completion.test.ts` | `ac67dc0f91d260bda8efb4d22b4ae797b5df24a3c90ec40868df446b154f2d5f` |
| `service/packages/mcp/test/portal/operational-native.test.ts` | `ed6d57c71657091af895e4d612a714f4ee4a1e2287552838a67d3edc14d27850` |
| `service/packages/mcp/test/portal/native-work.test.ts` | `858a38033ada3d529cffa92dc343f8e353e144402d905681f9254697a340a042` |

## Limits

This review proves the listed failures and checks the bounded named test suites. It does not claim full service acceptance, live Figma collection, native process revalidation, cross-platform verification or a clean whole-repository review. Existing native/IR analysis marker and receipt checks were inspected, but only the named IR suite was executed here. Request focused re-review after the main agent verifies and integrates fixes.
