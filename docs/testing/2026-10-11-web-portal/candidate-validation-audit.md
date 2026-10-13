# Candidate validation audit and bounded preview repairs

Date: October 11, 2026, Asia/Seoul. This report follows the [repository instructions](../../../AGENTS.md), [canonical service analysis](../../service-analysis.md), and [actual portal usage record](usage-live-tests.md). The initial audit was read-only. The coordinator later authorized four managed-only service/test edits and isolated headless Chrome fixtures. No production tab, source Figma browser, native daemon or visible browser window was controlled by this reviewer.

## Actual failed candidate and evidence

The UI-triggered candidate validation ended blocked at approximately 22:24:38 KST. Service run `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d` used candidate hash `sha256:ac97faf24d1bbc428e5c1e2d5c61429d81e9f40241546794c8ad53ba9a11fdcf` and retained native attempt `e33fc5daba53432d95322051894e208a051d18fd915db6f35749362b74b4868a`.

The public receipt is `.worktrees/_cache/portal-usage-20261011/evidence/candidate-validation-ui/result.json`. The detailed private validation record is under `.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline/portal/validation/fc88bbe384760629e472516f7339041c44e3e2b78ba0bc555112e078a3807cb4.json`. Relevant evidence is `payload.commandEvidence.commands[preview-cdd].previewReceipt.report`; authentication/MAC fields are not reproduced here. Candidate source and screenshots remain in that attempt's `work/` directory, including `.sfp-native-preview/preview-cdd/`.

Typecheck, independence and build passed. The preview command failed:

| Screen | Perceptual difference ratio | Threshold | Retained failure |
| --- | --- | --- | --- |
| Guide | 0.80797% | 1% | None in the screen report |
| Mobile | 1.09329% | 1% | Consumption failure and visual mismatch |
| Desktop | 0.44947% | 1% | Consumption failure and six `BROKEN_IMAGE` entries |

All four configured desktop workflow reports individually passed: account-session, registration-demo, frontend-presentation and language-selection. Their individual passes do not override the failed preview command. Runtime/live-design verification and complete recipe-consumption evidence remain unaccepted. The mobile visual mismatch is independent remaining candidate work; no threshold was changed by this repair.

## Consumption failures: timing and exact categories

The detailed receipt contains **2,110** consumption observations. **740 failed**, all with `PORTAL_CONSUMPTION_ELEMENT_HIDDEN`, all in phase `source`. There are **zero after-actions consumption checks** in this profile. Therefore a final dialog, locale state or workflow scroll cannot explain these 740 source-phase failures.

| Source root | Failed observations | Distinct failing selectors |
| --- | --- | --- |
| Desktop `1381:541` | 271 | 27 |
| Mobile `1381:530` | 469 | 44 |

The failed expectations comprise component association (83); opacity, width and height (71 each); line-height, letter-spacing, font-weight, textContent, color and font-size (39 each); border-top-left-radius (28); the other three corner radii (24 each); padding on all four sides and gap (19 each); background-color (7); asset use (6); border-top-color (2). These keys were not observed successfully because visibility failed first. The report contains no failed property-value comparison or resource-hash mismatch reason.

Examples include desktop footer `I1381:542;1381:190`, its container and language control, mobile footer `I1381:290;1379:619`, and lower mobile service/media frames such as `I1585:527;1585:458` and `I1585:527;1585:459;1379:240`.

Captured roots have viewport heights 800 and 1117, `clipsContent:false` and `overflowDirection:VERTICAL`; full-page artifacts extend to 497×3051 and 1728×2869. The candidate preserves the short root box while descendants paint outside it and the document scrolls. An early interpretation that this necessarily required an internal scroll-container rewrite was too strong and was corrected after the coordinator challenged it: overflow-visible descendants can legitimately paint beyond their parent's bounds, and the full-page oracle is relevant.

The service observer was independently hit-testing both the root's own clamped center and the target after scrolling the target into view. The root box can be above the viewport even while its descendant is actually exposed. The separate root-center test then rejects valid content. A genuine headless Chrome fixture reproduced this exact false negative. The target's existing exposure check already verifies ancestor display/visibility/opacity and target hit-testing; unique root identity, unique selector and containment are separately required.

## Six image entries: real HTML images, premature audit

The audit iterates `document.images`, so it checks HTML `img` elements, not SVG `image` elements. The candidate's VECTOR branch produces HTML `img` elements referencing SVG files; six belong to the desktop tree. That count is consistent with the six flags, but the original report did not retain per-image URLs or `complete` values, so the exact original element state cannot be reconstructed solely from the failure list.

Read-only checks verified all **12** exported SVG assets are valid XML, have positive intrinsic dimensions, match their captured manifest hashes, and match their built `dist/` copies. They contain zero SVG `image` elements. The coordinator additionally decoded all 12 retained byte sequences in the already-owned visible Chrome tab; every result had `complete:true`, positive natural dimensions and no error. That separate diagnostic receipt is `.worktrees/_cache/portal-usage-20261011/evidence/actual-chrome-svg-decode.json`, dated 22:33:39 KST. This disproves intrinsic corruption of those bytes, but is not a replay of the failed final DOM state.

The final desktop workflow clicks the Home anchor, performs real navigation, then checks two English text labels. The old audit immediately inspected image completion afterward. App text can appear before newly mounted image requests/decode finish. A controlled actual-HTTP Chrome fixture reproduces the same sequence: a valid delayed image inserted after navigation received `BROKEN_IMAGE` before the repair. This establishes a service timing defect independently of the candidate's pixel ratio.

## Authorized managed-only repair

The current native AX accessibility repair was first synchronized into the four owned managed paths. The managed preview source had been older; copying its prior version back would have removed existing AX checks. The exact native `preview-accessibility.ts` dependency was copied for managed validation only, without authored edits or inclusion in the return change set.

`preview-consumption.ts` removes only the redundant source-root-center exposure test. It retains the target's ancestor-style and hit-test guard, current origin/state, unique anchors, root containment, original element identity and scroll restoration. New Chrome negatives retain rejection of hidden ancestors, a covered target, a foreign root and duplicate root/target anchors. The positive overflow case also verifies original scroll and screenshot restoration.

`preview.ts` settles current HTML images after actions/workflows and before its unchanged basic image audit. It waits for decode completion or failure, retries if the current image set changes, and uses one five-second settlement ceiling clamped to the original preview deadline and abort signal. It does not renew the global preview budget. A bounded settlement timeout records `IMAGE_LOAD_TIMEOUT`; failed or incomplete images still fail the original `BROKEN_IMAGE` predicate. There is no skip, artificial image replacement, output patch or threshold relaxation. Existing Chrome AX checks remain present.

The image regression requires no failures for a valid delayed image, retains `BROKEN_IMAGE` for corrupt bytes, and verifies a never-completing image request is interrupted by the original cancellation signal within 1.5 seconds of the controlled request. No image-loaded or source-consumption fact is fabricated.

## Verification and frozen hashes

The two new Chrome regressions genuinely failed first at **22:39:04**: exposed overflow target was rejected and valid delayed image was called broken. `.cache/preview-observer-image-red.json` preserves these failures. A preliminary selected run exposed an implementation timing issue during authoring; the final stricter test requires an empty failure array for the valid image, not merely absence of one error code. The strict selected run passed at 22:42:01.

The final complete two-file run started at **22:43:05 KST** and passed **30/30**, no skips, in 63.65 seconds. The receipt is managed `.cache/preview-observer-image-final.json`. MCP TypeScript, scoped lint and formatting passed. The existing private managed validation configuration aliases shared-module identity consistently; it does not install dependencies or alter shared schemas.

| Owned managed path relative to `service/` | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview-consumption.ts` | `13ca80feb747a2810e297a521dcd921144416646f6406f1c5274ec6159fc8e7b` |
| `packages/mcp/test/portal/preview-consumption.test.ts` | `63ec1dafa1491b0f327c82df24ca2e386aa64a237641cac51c92248a3016533c` |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/test/portal/preview.test.ts` | `dd18d2b406bc2cafd13a39df98a1da5ecd86bdb07a6791b6d3efcbcb4a3c2de3` |

Native production remained untouched throughout: preview `ed7d06836ef43b80651808be49893c1cc3e7cf1ca57e9976f27bbf097f65dbbe` and observer `0346a99cff48a02d58a0735824de2694fa35e03691ea736dda427a4b7d556972` were rechecked afterward. The retained candidate renderer hashes are `e3186d2ffee8a80dbdd88c23b596e69a999712e639570e9f28881d0f9f0c2878` (CapturedNode), `9a9d872095d53d800e514d41815b19257427dbafacef34b55c8d20305d303d4b` (captured-style), and `5dbc7d3d135cd8e0eedc6f338f6dc49191bab7695b65ced321f7d752fc05db6d` (main).

The backend reviewer has received this freeze for independent review. The coordinator still owns integration, the new source-bound whole check and actual candidate revalidation. The existing blocked candidate remains blocked until those real checks pass; fixture repairs do not establish generated-output acceptance.

## 23:16 independent rejection and clipping repair

The first observer freeze `13ca80fe...` was **not approved for integration**. Independent review reproduced two false passes: a `pointer-events:none` target below a short source root was accepted despite `overflow:clip` or `clip-path:inset(0)`. The original JavaScript fallback treated an ancestor hit, including `body`, as sufficient proof. Removing the root-center test had exposed this unsound fallback. The independent receipt remains managed `packages/mcp/.cache/preview-clipping-review-red.json`; its two failures are preserved. The earlier 30-case pass did not cover these clipping cases.

The replacement keeps the correct overflow-visible behavior and replaces ancestor-hit acceptance with native Chrome evidence. When a noninteractive target falls through ordinary DOM hit-testing, the isolated observer keeps its scroll transaction open. The service asks Chrome `DOM.getNodeForLocation` with `ignorePointerEventsNone:true`, using document coordinates derived from the CSS visual viewport offset. The returned backend node must belong to the exact, uniquely selected target's native subtree. Chrome therefore applies its actual clipping and hit-test rules, including clip paths and noninteractive covering siblings. No page style, pointer-events value or screenshot is modified to obtain proof.

The native request uses one lazy CDP session per observation batch. Each proof has a two-second bound combined with the original resource signal; the isolated pending proof independently expires closed. Missing/expired proof is never replaced by the old ancestor fallback. Original root/selector uniqueness, containment, element identity, origin/state checks and ancestor display/visibility/opacity checks remain. Scroll restoration runs before the observation settles. Session detachment has a bounded cleanup allowance; failed cleanup is unconfirmed and cannot yield acceptance. Original cancellation reasons remain authoritative.

Added real Chrome cases cover `overflow:clip`, `clip-path`, a nested clipping ancestor, an actually exposed target inside a clip path, and a `pointer-events:none` occluding sibling. The original positive overflow case and hidden/foreign/duplicate-anchor negatives remain. Controlled transport-failure cases hold the native hit response to verify timeout or original cancellation rejects proof, restores scroll and detaches the session. Those two protocol-failure cases are fixtures, not live candidate observations. An initial coordinate attempt used viewport coordinates and failed the positive overflow case; conversion to Chrome's document coordinates repaired it without trying alternate points or relaxing clipping.

The complete two-file suite passed **37/37 with no skips** at 23:12:52 KST, receipt `.cache/preview-clipping-repair-full.json`. Test-only normalization then replaced conditional assertions with unconditional expected outcomes for lint; the exact final eight affected cases passed again at **23:14:59**, receipt `.cache/preview-clipping-repair-final-hash.json`. MCP TypeScript, scoped lint and formatting passed. The fourteen skips in this final selected run are test-name filtering; the preceding full run had zero skips.

The latest four-path freeze supersedes the prior observer/test hashes. The image-settlement implementation and tests are unchanged:

| Path relative to `service/` | Latest SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview-consumption.ts` | `2e344bf1bad8e075ae0114f75caa023b47e275cacf3afb107930ab051975434e` |
| `packages/mcp/test/portal/preview-consumption.test.ts` | `e9ffc42f54b1f365ac411fceca6b96ec5ef89351e1dee1dbcbd4dc00b81d1dac` |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/test/portal/preview.test.ts` | `dd18d2b406bc2cafd13a39df98a1da5ecd86bdb07a6791b6d3efcbcb4a3c2de3` |

The independent reviewer was explicitly reactivated to rerun the original clipping probes and review the new protocol, identity and cleanup boundaries. Main/native source, production processes and the retained visible portal tab were not changed by this author. Integration remains pending that review and the coordinator's checks.

### Separate text-rendering limitation

The candidate author subsequently reported a private experimental copy where visible SVG text uses a different effective font size from its outer element's nominal CSS, with the discrepancy explicitly marked. Current property consumption measures the bound selector's computed style; an outer nominal value alone cannot establish the font size of separately overridden visible SVG glyphs. This is a distinct declared validation limitation, not a reason to accept that experiment or silently adjust this clipping repair. The original candidate remains preserved; effective glyph evidence and any required service change need separate review.

## 23:26 asynchronous identity repair and final author freeze

Independent review confirmed the native hit-test repair rejects the two original clipping cases, but found another acceptance defect before integration: moving the same connected target into a foreign root during the **second** native exposure query could still yield `passed:true`. Containment had been checked before awaiting the final exposure proof. The independent failing receipt is managed `packages/mcp/.cache/preview-identity-review-move.json`. Detached replacement was already rejected by restoration; connected reparenting required an explicit later identity check. The `2e344bf1...` freeze therefore also remained unapproved.

Three author regressions then reproduced false passes for movement during the final native hit query, movement during asynchronous scroll restoration, and replacement of the admitted root binding while retaining the old target. All three failed before the correction in `.cache/preview-identity-boundaries-red.json` and passed afterward in `-green.json`.

The shared final identity predicate now verifies that the **original** root and target objects remain connected, the original root still contains that target, both queried anchors remain unique and select those same objects, the retained element identity is unchanged, and the required after-actions state still matches. It runs after the first native exposure await, before and after the final exposure await, and again after scroll restoration has allowed queued page handlers to run. Thus an observation is not published solely on a pre-await scope check. A fourth regression changes the after-actions state during native verification and is also rejected.

The final author run passed **41/41**, zero failed and zero skipped, beginning **23:24:59 KST** and lasting 76.37 seconds. The exact receipt is managed `.cache/preview-final-identity-full.json`. MCP TypeScript, scoped lint and formatting passed on the final files. There are no author test processes still running. The image-settlement pair is unchanged; the complete four-path freeze is:

| Path relative to `service/` | Final author SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview-consumption.ts` | `225a65c7aa968b276ec3d0ad2c38ef792aa6d78f72ff420edb383feef2bb675f` |
| `packages/mcp/test/portal/preview-consumption.test.ts` | `9e99b36883a5d1cc16ca9f35ae0e9931064735a13df0c09834e2997c5dfed713` |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/test/portal/preview.test.ts` | `dd18d2b406bc2cafd13a39df98a1da5ecd86bdb07a6791b6d3efcbcb4a3c2de3` |

The reviewer was reactivated for the original two clipping probes, connected-reparenting probe and the complete final suites. This is an author verification freeze, **not independent approval or integrated acceptance**. The coordinator retains integration, whole-check and real candidate revalidation ownership. All earlier failed source epochs and the original blocked candidate remain preserved.

### Independent preview recheck closure

The independent reviewer subsequently reported the original three adversarial probes passing and the exact-hash complete **41/41** suite passing, zero failures/skips, from 23:27:36 to 23:28:52 KST. All four final hashes above were verified and no further actionable issue was found within this bounded scope. This closes independent review of the preview repair; it does not establish native integration, the next whole-check result, or actual candidate acceptance.
