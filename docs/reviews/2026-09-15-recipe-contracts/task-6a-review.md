# Task 6A independent main-agent review

Result: changes required for one P2 contract/catalog finding. This is a bounded review of contracts and planned definitions, not either whole-code review round or an executable recipe acceptance.

Main read all stage/output/reference/effect contracts, definition/hash/binding helpers, feature inventory and tests; independently verified all six hashes/main preimages; ran the three-file 21-test suite successfully (1.21 seconds). Existing structures clearly distinguish schema/marker checks from signed ownership and runtime use, and every definition remains planned. The stage shapes avoid a result/candidate hash cycle. Future typed adapters, retention, execution and consumption remain explicitly pending.

## F1: Declared recipe effects understate the canonical primitives

The shared definition validator chooses exactly one needed effect per tool and classifies design_diff as read-only. The actual canonical operation policy declares design_diff filesystem writes, and its actual handler creates/updates a baseline. The frozen diff-design definition declares only read, and the schema accepts that declaration. Because steps have no constrained arguments yet, their planned effect set must conservatively cover possible canonical effects, or explicitly constrain the step branch before allowing a narrower declaration.

A second policy-driven diagnostic identifies two more mismatches in the same contract mechanism: transfer-instance-overrides can call swap_component with a library component but omits library-import, and export-handoff/export_frames_to_pdf omits read. Actual primitive admission would still independently protect effects when a future runner exists; this review does not claim a present runtime bypass. The new supposedly closed definition/effect contract is nonetheless incorrect and must not become the approval/selection input unchanged.

Reproduction at 06:22:27 KST in packages/mcp/test/portal/review-task6a-effects.test.ts: both tests fail. The first enumerates actual OPERATION_POLICIES for every non-derive catalog step and finds exactly those three missing effects; the second confirms PortalRecipeDefinitionSchema accepts diff-design with effects [read]. No frozen production code was changed.

Required correction: require all relevant declared effects for canonical step families (including multi-effect exports/diff and conditional library primitives), update the three catalog definitions, and add an actual canonical-policy parity regression plus negative omitted-effect tests. No arbitrary executor or permission bypass is needed.

## Verification handoff

Task5.4's final knip reports an unused export portalRecipeConsumptionContentHash in definitions.ts. Close that owned quality issue with meaningful receipt identity coverage/consumer use or defer its export until needed; do not add a blanket unused-export exemption. Final ordinary package types should run after the other review diagnostic is disabled. Per-record bounds are honest; future adapters must explicitly extend specialized result shapes/paging where actual captured types/counts require it, without dropping unsupported data. No current portal or owner-wide retention claims are accepted from these schemas alone.

No Docker, Superpowers, browser, daemon, build, dependency or Git mutation was used. Native checks use the same Windows account in the separate copy. Diagnostic is retained there and excluded from integration.
