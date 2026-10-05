# Native layout, prototype interpretation and candidate capacity

Date: October 4, 2026 (Asia/Seoul). Published baseline: `5b9343efc82ef47ba56f412acbd4eee5a328d335` plus continuing uncommitted changes. Matching main/native source: `sha256:e2755bc7404ed946ada53c70be0777beed46e68ab52cb09786f2a695d2fcc983`.

## Changes and actual comparison

Independent normalization now decodes supported automatic-layout modes, sizing, alignment, asymmetric padding, spacing, bounds, masks and placement constraints. Legacy and unsupported forms remain unknown. Actual comparisons exposed eight eCommerce and two CDD placement differences: instances inherited component constraints instead of retaining their own placement. The repaired expansion preserves the instance's recorded constraints. Failed comparisons remain in [eCommerce evidence](ecommerce-placement-before.json) and [CDD evidence](cdd-placement-before.json).

The collector also decodes the closed single-action click-navigation form of native prototype interactions. The first comparison exposed 31 differences because native instance overrides contained partial action records. Overrides now merge by interaction ID, retaining deletion markers and the independently recorded base action. Duplicate identities, unsupported triggers/transitions, legacy transition records and multiple actions remain unknown. The [initial comparison](ecommerce-reaction-fragments-before.json) is retained.

The service CLI repeated comparisons using separately collected inputs from the [parent report](../README.md). Neither collector was populated from the other's facts.

| Scope | eCommerce | CDD |
| --- | ---: | ---: |
| Nodes | 3,198 | 192 |
| Missing / extra | 0 / 0 | 0 / 0 |
| Compared positions | 124,734 | 8,778 |
| Retained representation differences | 408 | 73 |
| Unexplained differences in compared fields | 0 | 0 |
| Matched native click-navigation actions | 66 | 0 |
| Unsupported reactions/layouts in these inputs | 0 / 0 | 0 / 0 |
| Full native capture accepted | false | false |

The [eCommerce checkpoint](ecommerce-checkpoint.json), [comparison](ecommerce-comparison.json), [CDD checkpoint](cdd-checkpoint.json) and [comparison](cdd-comparison.json) retain actual results. Expanded field comparison does not establish complete native capture or frontend acceptance. Effects, other unobserved fields, general variables/catalogs, independent SVG/root-PNG exports and portal admission still need work.

## Candidate capacity

The 52 original eCommerce images total 89,090,574 bytes. The previous 64 MiB candidate cap rejected this set. The aggregate cap is now **96 MiB**, retaining 300 files, 16 MiB per file, 32 MiB asset reads per submission and 128 MiB native working-copy reads. Separate archive indexes account for metadata; their limits are unchanged.

The [red regression](capacity-red-tests.json) reproduced rejection before repair. The updated test admits the observed total and exact new boundary, rejects excess bytes and verifies that rejection leaves the durable run unchanged. [Expanded tests](capacity-tests.json) passed 65 cases with one existing conditional skip. These fixtures do not establish an actual eCommerce frontend submission. The retained daemon still runs its earlier build; use the new verified runtime before exercising the changed cap in a public generation run.

## Verification and continuation

All [46 native tests](native-tests.json) passed. Typechecks and scoped lint/format/build passed after correcting a test-only optional-chain expression and lint findings. [Prototype red tests](reactions-red-tests.json) and [layout integration red tests](layout-red-tests.json) retain earlier failures. The [provenance checkpoint](provenance-checkpoint.json) records ten reviewed paths, 50 semantic changes, four authority paths, 178 retained forks, three verified upstreams and 238 vendor rows. Intermediate verification correctly rejected unstaged generated authority bytes; staging those exact bytes in the alternate index resolved it. The owner's index remains unchanged.

At 21:22 KST, [whole attempt `1dac9a33...`](full-source-checkpoint.json) passed all 16 gates at the fingerprint above: 4,748 passed, zero failed, 20 existing skips and all 37 mandatory Chrome cases passed. The [separate artifact-content case](artifact-contents-checkpoint.json) also passed. The preceding [full pass](../full-source-checkpoint.json) belongs to source `e7333e49...` with 4,729 passes. [The subsequent control repair](../control-poll/README.md) and unresolved live HTTP 500 have their own evidence. Its newer whole check was interrupted for [reboot preparation](../../../handoff/reboot-2026-10-04-evening.md).

Service status around 21:00 KST confirmed `connected`, build `b667c982...`, and zero paired Desktop plugins. No Chrome approval was automated or healthy daemon restarted. The official MCP prerequisite remains unresolved. Preserve CDD R8's completed output and run budgets. Complete remaining acquisition/case/review work before final eCommerce dual-path new-frontend acceptance. Validation uses the separate native working copy under the same Windows owner privileges, not an OS sandbox.
