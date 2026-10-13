# Actual candidate validation failure review

Date: October 11, 2026 (Asia/Seoul). This read-only review follows the actual UI-driven native validation completed at 22:24:37. Read the [current candidate/driver record](current-ui-candidate-driver.md), [native profile preparation](current-ui-native-profile-preparation.md), [canonical analysis](../../service-analysis.md) and [AGENTS.md](../../../AGENTS.md) before reuse.

## Baseline and actual result

The current submitted candidate remains 44 files at `sha256:ac97faf24d1bbc428e5c1e2d5c61429d81e9f40241546794c8ad53ba9a11fdcf`, core run `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d`, native profile `cdd-ui-scripter-20261011-r2`. Typecheck, independence and build passed. Candidate acceptance remained blocked by consumption, accessibility and mobile visual failures; it was not applied or accepted as a completed frontend.

The actual retained validation payload is private `portal/validation/fc88bbe384760629e472516f7339041c44e3e2b78ba0bc555112e078a3807cb4.json`. Its `commandEvidence.commands[preview-cdd].previewReceipt.report` contains the detailed observations; the work output directory itself contains screenshots/diffs, not a standalone JSON report. The public projection is `.worktrees/_cache/portal-usage-20261011/evidence/candidate-validation-ui/result.json`. No MAC or credential contents are reproduced here.

Reviewed checkpoint hashes:

| Evidence or candidate path | SHA-256 |
| --- | --- |
| Private signed validation record | `0ca30ecfead414573e70aee2623f33fc4592942a65b8b0b9dab3b5270bc6588b` |
| `src/asset-frame.js` | `1c39b7fc11dc02ed89aa6023cc13b9571e5f3909b6b21efddee01f380004d396` |
| `src/CapturedNode.jsx` | `e3186d2ffee8a80dbdd88c23b596e69a999712e639570e9f28881d0f9f0c2878` |
| `src/captured-style.js` | `9a9d872095d53d800e514d41815b19257427dbafacef34b55c8d20305d303d4b` |
| `src/styles.css` | `1715508be63516dfa84bb09eecefdbeb30268212e5a8ce22a9a9d4deb273848a` |

| Captured root | Actual visual difference | 1% visual criterion |
| --- | --- | --- |
| Guide, `1381:285` | 0.8079696274% | Within criterion |
| Mobile, `1381:530` | 1.0932853760% | Failed |
| Desktop, `1381:541` | 0.4494686173% | Within criterion |

A within-criterion image alone does not pass all required checks. Desktop still reported six `BROKEN_IMAGE` failures, and mobile/desktop consumption remained blocked. All four desktop workflow journeys reported success. The threshold was neither increased nor removed.

## Source observation and image-audit findings

There were 2,110 consumption observations, with 740 failures: 469 mobile and 271 desktop. All failures occurred in the source phase and reported `PORTAL_CONSUMPTION_ELEMENT_HIDDEN`. None reported a value/resource mismatch; however, the hidden predicate runs before those checks, so this does not prove that all unmeasured properties are correct.

The captured roots retain declared heights 800/1117, `clipsContent:false` and visible overflow, while their descendants extend across the 3051/2869-pixel full source export. The observer scrolls a child into view, then tests the root using its declared bounding-box center clamped into the viewport. For a visible overflowing child below the declared root box, the root may be above the viewport and the clamped hit test can reject a valid source subtree. The independent reviewer confirmed this service-observer defect and owns its repair. Converting prototype `overflowDirection` directly into CSS scrolling would alter the full source oracle semantics; the candidate root layout was preserved.

The only HTML images in desktop rendering are six source SVG vectors. Their asset files exist and have positive source dimensions. The coordinator additionally decoded all twelve exact captured SVGs successfully in the same retained portal Chrome tab. The last language journey follows the real home link, which reloads the document; the audit immediately checks `document.images` after label assertions without waiting for newly created SVG images to decode. The reviewer owns the bounded post-navigation audit/readiness repair. No candidate asset bytes were changed or replaced to hide that failure.

## Mobile source/rendering inspection

The actual mobile screenshot, service diff and current original oracle were viewed as existing service-produced artifacts. No browser was controlled or launched and no image was edited. The mobile diff spreads across text edges throughout the page and several television/phone/image areas rather than establishing one isolated missing asset.

Source text segments all declare Spoqa Han Sans Neo Regular or Bold, matching the local font-face families and weights. Native-derived glyph positions/font sizes remain explicitly retained. Current GIF fills use FILL, identity image transforms, opacity one and zero filter adjustments. The helper verifies original GIF bytes, decodes frame zero through the installed browser decoder and draws local per-asset canvases; it does not synthesize a source render. These source checks did not establish a specific candidate bug responsible for the remaining 1.093285% mismatch.

No candidate patch was made. The admitted authoring copy, staged candidate, signed validation evidence, source properties, assets and pixel oracles remain unchanged. Arbitrary font/colour/coordinate tuning, opacity changes, threshold changes or a layout workaround for the observer defect would lack current source evidence. A separate new private authoring copy should be used only once a source-grounded candidate change or a controlled, authorized experiment is identified.

## Verification boundary and next work

This worker executed filesystem reads, JSON observation analysis, hash comparisons and existing-artifact viewing only. No test suite, package manager, helper, application, Chrome launch, source Chrome action, lease acquisition, submission, validation or application was executed for this review. The coordinator and independent reviewer retain service source ownership and all live test execution.

The service observer and image audit require their own regressions and fresh service validation. The mobile visual mismatch remains independently unresolved even after those repairs. Further work needs a controlled source/rendering investigation, especially exact glyph rasterization and the affected image regions, with a reviewed candidate change and an actual new receipt. The original run's approximately 22:34 budget must not be reset or treated as an accepted result; any later fresh workflow must follow the coordinator's authorized sequence. This blocked validation remains historical execution evidence.

The independent reviewer subsequently reported reproduced service regressions and a 30/30 focused repair pass, recorded in [candidate-validation-audit.md](candidate-validation-audit.md). This worker did not rerun that source or any browser after the repair. Matching font family/style declarations alone do not verify the exact font binary/version or pixel rasterization; those remain candidates for a controlled comparison rather than evidence for a tuning patch.

## Subsequent geometry and retained glyph investigation

The coordinator authorized a separate controlled authoring copy after the preceding read-only review. The original admitted 44-file authoring copy, staged candidate, source exports and validation evidence remain unchanged. The following findings and offline checks do not supersede the blocked actual validation.

Root geometry does not establish an export-crop or fractional-origin defect. Mobile retains local and absolute dimensions 497 by 800, origin (27, 262), and absolute render bounds 497 by 3051. Desktop retains 1728 by 1117, origin (702, 262), and render bounds 1728 by 2869. Guide is 653 by 192 with an effectively zero horizontal origin. The original PNG dimensions and actual full screenshots match the respective render extents. The candidate's scene extents use those render dimensions, root origin is normalized to zero, and the fixed mobile/desktop routes have scale one. No crop, per-root offset or export scale was changed.

Two mobile text nodes exhibit a specific conflict between retained native glyph layout and current nominal API typography:

| Node suffix | Current uniform API font size | Retained glyph font size | Current layout size | Retained baseline y |
| --- | --- | --- | --- | --- |
| `1381:765` | 9.858333587646484 | 14 | 89.78126525878906 by 14.816667556762695 | 15.315999984741211 |
| `1381:766` | 8.449999809265137 | 12 | 89.78126525878906 by 14.816665649414062 | 13.128000259399414 |

Both full IDs begin `I1585:527;1585:459;1379:240;`. Each node has one complete `textSegments` range from zero through all seven characters. Its range font size agrees with its nominal node font size, and its range font is Spoqa Han Sans Neo Bold. The node-level `fontName` says mixed, but the retained complete range itself is uniform. There is no retained `styledTextSegments` or independent font-size-range field establishing another range size. `textStyleId` is empty on the node and range; the associated paint style is colour evidence, not a typography style reference. No retained override on either node or its ancestor chain establishes a different font size. The earlier normalized native record also retains the nominal sizes while its separate derived glyph layout retains 14 and 12. This does not identify an ordinary API transform conversion or resolve a possible cached-layout discrepancy.

All nine ancestors for each affected node have translation-only relative and absolute transforms, with identity linear bases. Native `layoutSize` equals the current local dimensions; current absolute bounding-box dimensions also equal the local dimensions. The retained glyph positions have no evidenced additional scale. The native extraction code in `service/packages/cli/src/figma-native-text-layout.ts` preserves `glyph.fontSize` and positions under the explicit `native-derived-text` label. It does not establish these as a fresh live Plugin API observation.

Existing source render bounds and pixel observations support testing the retained layout without a font-ratio-derived coordinate scale. For the first label, the source oracle's white ink spans approximately 77 pixels, while the actual label spans approximately 55; source render bounds report 78.2344055 pixels. For the second, oracle blue ink spans approximately 45 pixels versus approximately 32 actual pixels; source render bounds report 44.5933075. The old renderer uses the nominal API font size and multiplies retained glyph coordinates by the nominal-to-retained font ratio of about 0.7041667. These bounded image observations motivate a controlled experiment; they do not prove complete pixel or typography acceptance.

Raw ancestor translation sums are not a general DOM-origin calculation for Figma GROUP children. The existing candidate already normalizes those children from absolute bounding boxes. This investigation preserved that handling and tests only the identity linear basis when deciding whether retained glyph coordinates can be presented unchanged. It does not introduce a new root-coordinate adjustment.

## Controlled private candidate preparation and verification

The new private copy is `.worktrees/_cache/cdd-ui-scripter-glyph-probe-20261011`. Its submission list contains 45 runtime files: all 44 original paths plus `src/glyph-space.js`. Exactly 43 previous runtime files remain byte-identical; only the copied `src/CapturedNode.jsx` changed. The source data, styles, assets, binding manifest and pixel oracles were not edited.

The helper presents retained glyph positions at scale one only when characters, complete current range, retained layout dimensions, absolute dimensions and every ancestor's identity linear basis agree. It rejects mixed or partial ranges, changed geometry, nontranslation transforms, invalid or duplicate glyph positions, and unsupported glyph font sets. All 72 retained layouts satisfy these guards in the supplied records, and only the two identified nodes have a nominal/glyph font discrepancy. There are no per-node exceptions, arbitrary offsets or threshold changes.

The copied renderer applies retained font sizes to its visible SVG `text` element. It preserves nominal source typography on the bound outer element and exposes `data-nominal-api-font-size`, `data-retained-glyph-font-size`, `data-glyph-coordinate-space` and `data-source-font-discrepancy` on the SVG. This is explicitly a retained glyph presentation experiment. It is not a claim that the API's nominal 9.858/8.45 values were secretly 14/12 or that a source-font obligation has passed.

The current service consumption code measures the bound element's computed style. That nominal outer CSS alone cannot prove the actual font painted by an overriding SVG `text` child. The independent reviewer confirmed this measurement limit. Fresh acceptance must inspect the effective visible typography and preserve or resolve the source discrepancy. A visual pass must not hide that unresolved property authority.

Executed offline checks from the private copy:

```powershell
node --test test/glyph-space.test.mjs
node node_modules/typescript/lib/tsc.js --noEmit --incremental false
node scripts/check-source.mjs
```

The original font-ratio behavior produced two failing assertions expecting unchanged retained coordinates. The repaired helper and invalid-input cases pass **5/5**, with zero failures or skips. TypeScript 5.9.3 passes without emitting or incremental writes. The static independence check passes for 192 nodes, three roots and all 22 original implementation asset hashes. These checks do not launch a browser or establish the mobile visual criterion. No build, installation, lease, submission, native validation or application was executed.

The private `node_modules` junction points to the already installed dependency tree in the retained native validation work directory. The junction is writable and provides no filesystem isolation; no dependency installation, lifecycle hook or dependency write was performed. Only the existing compiler and pure source/test scripts were executed.

An offline declarations-only helper verifies the retained historical Scripter/C4 context, seven exact recipe pages and 95 material catalog rows, then generates the full 45-file hash closure and seven declarations. Each declaration references that same complete closure, and interaction declarations retain the actual interaction IDs. `private/profile-closure-proposal.json` records all 45 intended allowed files and unchanged 1% visual criterion. It is a proposal, not an admitted native profile. The helper rejects every mode except declarations. No new candidate hash, native-profile registration or current runtime authority was invented.

Frozen preparation hashes:

| Private path | SHA-256 |
| --- | --- |
| `src/glyph-space.js` | `ef96ea86196541163607d43e95116b5db9511550737ef3f54a606fe9dc48ca7c` |
| `src/CapturedNode.jsx` | `8a3fccc16a899e484907d5a8d339bffa9d1f8fd5162b8fb70f881e7e5c5d70c1` |
| `output-files.json` | `ea2e0a0f446e42b718e0c1e64d04b6264f28b675d7eff959ad599d82a3c89d2d` |
| `test/glyph-space.test.mjs` | `ae1975d5bed3294a15c52a6cea1efa9bca47f48d3c0350eaea72a8848f94643d` |
| `private/prepare-closure.mjs` | `f7467f4593ac13b02382f62aef905167287a42f9f89907cf367a6f44f561b949` |
| `private/preparation/candidate-closure.json` | `7eb23f4a468a009654b9fc5e68e3471253e40c30ca1055e630c43e096537182f` |
| `private/preparation/core-declarations.json` | `dc45246975a1645ca1f5fb134fddff02d8024ba0b2feba915feac618e9fe5592` |

The original run budget expired; neither its deadline nor coding lease was renewed. Further execution requires the coordinator's authorized fresh sequence, fresh exact source/glyph verification, actual admission of the new complete file/declaration closure and service-native profile preparation/review. The original 1.093285% mobile failure remains the only executed visual result for this candidate lineage. The nominal/glyph conflict and effective-font observation remain explicit acceptance limits even if a later controlled image comparison improves.

The coordinator subsequently authorized a standalone owned headless diagnostic, recorded in [glyph-native-diagnostic.md](glyph-native-diagnostic.md). Actual visible SVG fonts were 14/12 pixels, distinct from nominal wrapper CSS. Mobile improved to 1.076007% but still failed the unchanged 1% criterion; differences outside the two label regions independently exceed that criterion. This is new bounded diagnostic evidence, not native candidate admission, semantic acceptance or another complete UI round. No further source-grounded candidate defect was established and no additional tuning was made.
