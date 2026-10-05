# Complete eCommerce collection and independent field comparison

Date: October 4, 2026 (Asia/Seoul). Published baseline: `5b9343efc82ef47ba56f412acbd4eee5a328d335`, branch `remediation/2026-09-27`, with continuing uncommitted changes. The initial field-repair source fingerprint was `sha256:e7333e49f1cd08bfcb6fae1130296226f122b7fe2a82d1af536074a7b5fd9409`.

Latest continuation: [native behavior repairs](native-behavior/README.md) expand comparison to 124,734 eCommerce and 8,778 CDD positions with zero unexplained differences in that scope, including 66 eCommerce click-navigation actions. Those changes passed all source/package gates with 4,748 passing tests. [A later control-read repair](control-poll/README.md) has eleven passing focused cases; its whole check was interrupted for [reboot preparation](../../handoff/reboot-2026-10-04-evening.md). Separate R3/R4 preparation failures remain unresolved, including an HTTP 500. The [later diagnostics and verified review repairs](control-diagnostics/README.md) add bounded server-side failure diagnostics and repair source-tab cleanup, sign-in mapping and PNG proof limits. They also establish and repair the cause of the R3–R5 failures: a monitoring poll's authorization probe timed out, and the CLI then cancelled the dispatched plan. Fresh R6 then produced plan `sfp_portal1_709fa34d66dd3de4b68be30c3f5f5f66`, complete and live-verified, with 92/92 workflow scopes resolved by 89 explicit decisions and no issues. The 89 earlier workflow issues are therefore closed for this preparation. [Native effect, stroke, sizing, text and container conversion](native-effects/README.md) then extends the independent comparison to 156,995 eCommerce and 11,244 CDD positions over 87 fields, with zero unexplained differences. Thirty-six reference fields remain uncompared. Complete independent capture and final frontend acceptance remain open.

## Executed collection

After the owner's manual approval, the retained service daemon initialized its scoped Chrome connection and reported `connected`. Public preparation plan `sfp_portal1_f936c1ff20561880bda56b1de437b073` captured eCommerce file `4IBhv1d8hEclifZQrOYxHS`, page `0:1`, through the service's Chrome/Scripter path. The [capture receipt](complete-chrome-capture.json) records **complete and live-verified capture: 3,198 nodes, 11 roots, 283 of 283 assets, 101,154,854 asset bytes**. Both ordered observation passes completed with the same content hash as the earlier partial read. This is preparation; generation, application and frontend acceptance have not started. There are still 89 unresolved workflow issues.

The service separately acquired a fresh plugin-free Chrome native export at 19:46 KST. Its [receipt](native-web-export.json) records 99,302,063 bytes, SHA-256 `09014941aef682697f1e98eb14e0606ce7ff7a27a0afc4ecdca2f73d0909f1c7`. Both inputs were independently acquired; no reference facts were copied into the native collector. The native export remains a partial acquisition source.

## Repaired native interpretation

Actual comparisons identified and drove these changes:

- Use recorded override keys within instance namespaces and reject duplicate expanded IDs. This removed the 33 missing and 33 extra node identities.
- Resolve imported styles by recorded key and version, requiring a unique result. Missing or ambiguous styles remain explicitly unknown. This corrected 33 stale cached stroke colors.
- Preserve float32 transform arithmetic, bounds, uniform or mixed corners, independent border widths, native automatic line height and recorded image crop transforms.
- Preserve decoded path precision. The comparator recognizes observed six-significant-digit API serialization only when the reference already has that representation; larger changes and higher-precision disguises are rejected.
- Decode bounded character-style runs and effective font weights. Equivalent default weight axes require the same named face; different or extra axes remain differences.
- Decode bounded unstyled native vector networks to recover 52 missing fill paths. Invalid indices, excessive sizes, nonfinite coordinates and unsupported styled networks are rejected or left unknown.
- Pair imported styles by actual key before unique kind/name matching. Preserve extra styles, ambiguities and unobserved metadata.

The implementation is in `service/packages/cli/src/figma-native-{nodes,geometry,paints,styles,font-ranges,vector-network}.ts`. The [bounded provenance review](../../../service/capabilities/reconciliations/review-2026-10-04-native-field-parity.json) retains upstream lineage and earlier reviews. Alternate-index verification passed without changing the owner's index.

## Actual comparison results

| Recorded scope | eCommerce | CDD regression |
| --- | ---: | ---: |
| Nodes | 3,198 | 192 |
| Missing / extra nodes | 0 / 0 | 0 / 0 |
| Compared positions | 88,993 | 6,006 |
| Retained raw representation differences | 408 | 73 |
| Unexplained differences in compared fields | 0 | 0 |
| Matching effective font ranges | 868 / 868 | 72 / 72 |
| Matching original images | 52 | 10 |
| Paired styles | 14 | 56 |
| Compared style value differences | 0 | 17 |
| Unobserved style properties | 55 | 238 |
| Full native capture accepted | false | false |

The [eCommerce checkpoint](ecommerce-checkpoint.json) and [raw comparison](ecommerce-comparison.json) retain the 408 scalar mixed-font differences. Effective font ranges account for them; the raw differences were not erased. Thirteen styles match by key and one by unique name. One additional unused native paint style, `Main`, remains visible. The [CDD checkpoint](cdd-checkpoint.json) and [comparison](cdd-comparison.json) preserve its previous bounded result, including 16 mixed catalog fonts and effect binding differences.

These counts cover the implemented comparison fields. They do not prove equality of every Figma property, complete variable/catalog semantics, prototype behavior, independent SVG/root-PNG exports or native portal admission.

## Verification and remaining capacity issue

All [26 focused native cases](native-tests.json), CLI typecheck, scoped lint/format and CLI build passed. Earlier intended failures are retained in [identity tests](override-key-red-tests.json) and [field tests](field-parity-red-tests.json). At approximately 20:52 KST, [full attempt `41bdee2b...`](full-source-checkpoint.json) passed all 16 gates: 4,729 passed, zero failed and 20 existing skips; all 37 mandatory Chrome cases passed. The [separate artifact-content case](artifact-contents-checkpoint.json) also passed. These passes predate the later capacity/prototype/layout changes.

Validation runs in `.worktrees/baseline/service` with a separate test state directory and installed Google Chrome. These are same-owner Windows processes and directories, not an OS sandbox. No Docker, Codex browser control or external Figma connector was used for service acceptance.

The complete capture also reveals a candidate-capacity gap: the 52 unique original images total **89,090,574 bytes**, exceeding the current 64 MiB candidate cap before code and fonts. Root PNGs total 11,889,068 bytes and serve as visual oracles; they are not frontend source assets. The candidate cap and downstream resource bounds must be reconciled before generation. Preserve original image bytes and the independent evidence; do not hide the gap by silently dropping assets.

## Continuation

1. Finish and save current source/package and artifact-content verification.
2. Repair and verify the bounded candidate capacity needed by the captured originals. Resolve the 89 workflow scope issues through the public planning path.
3. Finish independent collector semantics, independent exported assets and guarded portal admission. Repeat same-file comparisons without using one collector as the other's source.
4. Obtain an authenticated official Figma MCP read through the service. The local endpoint still returned `fetch failed` at approximately 20:39 KST; the owner was asked to enable the Desktop MCP server. The earlier remote endpoint required authentication. No current quota conclusion follows from these results.
5. Complete Desktop activation, relevant complete-portal cases and review gates. Preserve completed CDD R8 and earlier failed/expired runs.
6. After the preceding requirements, run final eCommerce acceptance through official MCP and Chrome with separate new frontend outputs and no reference frontend code.

The canonical analysis remains [docs/service-analysis.md](../../service-analysis.md). No new commit or push was requested or performed for this continuation.
