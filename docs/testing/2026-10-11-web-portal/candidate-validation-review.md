# Independent candidate preview repair review

Date: October 11, 2026, Asia/Seoul.

Final independent review, 23:28 KST: both reproduced consumption findings are addressed on the final four hashes below. The original three probes passed and the complete final suites passed 41/41. This closes the bounded review gate; actual candidate revalidation and whole-source acceptance remain the parent's separate work.

## Scope and baseline

This is the independent review of the four managed preview files frozen by the implementer at 22:45. It follows [the implementation audit](candidate-validation-audit.md), [repository instructions](../../../AGENTS.md), [canonical service analysis](../../service-analysis.md) and shared analysis policy. The current whole attempt at source `e2f01...` had failed nine cases; no whole check was active during this review. The parent owns integration, source Chrome and actual candidate revalidation.

| Frozen managed file | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview-consumption.ts` | `13ca80feb747a2810e297a521dcd921144416646f6406f1c5274ec6159fc8e7b` |
| `packages/mcp/test/portal/preview-consumption.test.ts` | `63ec1dafa1491b0f327c82df24ca2e386aa64a237641cac51c92248a3016533c` |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/test/portal/preview.test.ts` | `dd18d2b406bc2cafd13a39df98a1da5ecd86bdb07a6791b6d3efcbcb4a3c2de3` |

The reviewer changed no production or committed-scope test file. Additional probes live only in the managed private cache and use installed Google Chrome with owned headless contexts and local HTTP fixtures. They do not operate the user's source browser or daemon.

## Executed existing regressions

The independent run passed **30/30**, zero failed and zero skipped, for the two complete preview test files. The private JSON receipt is `packages/mcp/.cache/preview-independent-review.json`. The command used the implementer's existing source-alias configuration:

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/figma-settings-mcp-vitest.mjs --configLoader native --no-cache --maxWorkers 1 packages/mcp/test/portal/preview-consumption.test.ts packages/mcp/test/portal/preview.test.ts --reporter=json --outputFile=.cache/preview-independent-review.json
```

Static inspection confirms that the image-settlement helper uses one five-second ceiling clamped to the original preview deadline and caller signal. Decode rejection is consumed only to allow the unchanged image audit to classify the broken image. A never-settling evaluation is abandoned through the logical waiter, and timeout remains an explicit failure. The new supplied fixture covers delayed valid images, corrupt images and cancellation. No visual threshold, mask or existing Chrome accessibility check was removed.

## Initial finding: clipped pointer-events-none descendants could be falsely accepted

Removing the independent root-center hit test fixes the valid overflow-visible case, but it exposes an existing overly broad target fallback: when the target has `pointer-events:none`, the observer accepts any hit element that contains the target. This includes `body`, even if an ancestor clips the target completely out of the painted region.

Two actual Chrome probes independently failed:

- A 200 by 200 source root with `overflow:clip`, containing a 60 by 60 absolutely positioned target at vertical position 1600, with `pointer-events:none`.
- The same geometry with `clip-path:inset(0)` on the source root.

Both fixtures have a 2400-pixel document so scrolling can place the target's theoretical box in the viewport. The root's painted clip remains above the viewport. The target is not exposed, but its hit test sees an ancestor containing it and the current observer returns `passed:true`. The expected result is a hidden/clipped observation failure. The original root-center check blocked this configuration; simply removing that check therefore creates a false acceptance case while repairing another false rejection.

The private fixture is `packages/mcp/.cache/preview-clipping-review.test.ts`, configured by `.cache/preview-clipping-review-vitest.mjs`. The actual two-case red receipt is `packages/mcp/.cache/preview-clipping-review-red.json`: **zero passed, two failed**, both `expected true to be false`. Earlier private configuration attempts failed module resolution before running tests and are not counted as product evidence.

The parent and implementer were notified immediately. Integration of the four files should wait for a bounded repair which preserves the legitimate overflow-visible positive while verifying actual exposure of pointer-events-none elements. Keep unique root/selector identity, containment, ancestor hidden styles, occlusion, scope/state and restoration guards. Restoring the old root-center requirement alone would reintroduce the original 740-observation false rejection.

## Verification limit and next check

The source-phase observation failures, valid SVG diagnostic and remaining mobile visual mismatch remain distinct. Neither the supplied 30-case pass nor a repaired clipping fixture establishes actual candidate acceptance. After the author freezes a repair, rerun both clipping probes and the complete preview suites against the new hashes, then let the parent integrate and repeat actual candidate validation with unchanged thresholds and source-freshness requirements.

## First clipping repair recheck, 23:17 KST

The author froze a native hit-test repair with observer SHA-256 `2e344bf1bad8e075ae0114f75caa023b47e275cacf3afb107930ab051975434e` and observer-test SHA-256 `e9ffc42f54b1f365ac411fceca6b96ec5ef89351e1dee1dbcbd4dc00b81d1dac`. The preview image source/test hashes remained as listed above. The reviewer verified those four hashes before execution.

The repair holds the observer's scroll transaction while Chrome's CDP `DOM.getNodeForLocation`, with `ignorePointerEventsNone:true`, determines the actual painted hit. Its backend-node identity must belong to the selected target subtree. The CDP session is created lazily once per batch, uses the original cancellation signal with a two-second proof ceiling, and requires bounded detach confirmation. This avoids mutating candidate styles to make an otherwise hidden target hittable.

The reviewer's **original two clipping probes passed 2/2** unchanged, closing the reproduced geometric-clipping failure for those cases. The entire revised preview suites independently passed **37/37, zero failures or skips**. Receipts are managed `packages/mcp/.cache/preview-clipping-review-green.json` and `packages/mcp/.cache/preview-independent-repair-review.json`.

An additional controlled replacement probe confirmed that detaching/replacing the target during the final native proof is rejected by the existing scroll-restoration identity guard. However, a connected reparenting variant exposed a second concrete scope race:

1. The target initially belongs to the unique admitted root and requires native painted exposure because its pointer events are disabled.
2. During the second, final native proof, the controlled fixture moves that same target object into a foreign source root at the same document coordinates.
3. Chrome correctly hits that target's backend node, and all original scroll-chain objects remain connected. The old containment condition was evaluated before awaiting the native proof, so the observation returns `passed:true` outside its admitted root.

The private `packages/mcp/.cache/preview-identity-review.test.ts` case `target moved` failed **0/1** with expected false and actual true; its receipt is `packages/mcp/.cache/preview-identity-review-move.json`. The two unrelated clipping cases were filtered in that diagnostic run. This is not a failure of the native painted-hit result; it is a missing post-await root/target binding check. The author and parent were notified, and integration remains pending a repair that revalidates the exact root, target, uniqueness and containment after both the native proof and asynchronous scroll restoration. No source edits were made by this reviewer.

## Final identity repair and independent clearance, 23:28 KST

The final observer centralizes an identity predicate for the originally selected root and target. It checks that both remain connected, that the original root still contains the target, that both selectors remain unique and resolve to the same original objects, that the isolated element identity is unchanged, and that an after-actions root still has its admitted state. It checks this predicate after the first native exposure await, after the final native exposure await, and after the asynchronous scroll-restoration transaction finishes.

The author's new cases also cover a foreign-root move from a queued scroll handler, root-anchor rebinding and an after-actions state change. They preserve zero-scroll restoration and fail with the explicit changed-state reason. The native proof still rejects clipped targets, nested clipping and a noninteractive occluder while accepting valid overflow-visible descendants and visible content within a clip.

Final reviewed hashes, checked before and after the independent execution:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview-consumption.ts` | `225a65c7aa968b276ec3d0ad2c38ef792aa6d78f72ff420edb383feef2bb675f` |
| `packages/mcp/test/portal/preview-consumption.test.ts` | `9e99b36883a5d1cc16ca9f35ae0e9931064735a13df0c09834e2997c5dfed713` |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/test/portal/preview.test.ts` | `dd18d2b406bc2cafd13a39df98a1da5ecd86bdb07a6791b6d3efcbcb4a3c2de3` |

At **23:27:31**, the reviewer's original two clipping cases and connected-target reparenting case passed **3/3**. At **23:27:36–23:28:52**, the entire final preview suites passed **41/41, zero failures and zero skips**. Receipts are managed `packages/mcp/.cache/preview-independent-original-probes-final.json` and `packages/mcp/.cache/preview-independent-final-41.json`. The exact command/configuration remains the same as the earlier independent full run, with the final receipt filename.

Both established findings are closed for the reproduced cases, with no further actionable issue found in this bounded source/fixture review. Original cancellation, proof timeout, detach confirmation, broken-image failure and basic Chrome accessibility checks remain covered. No masks, perceptual thresholds or acceptance criteria were relaxed. No production source was edited by the reviewer, and no live candidate, source Chrome or daemon was operated. The prior mobile visual mismatch and actual frontend acceptance remain unresolved until the parent executes their separate service gates.
