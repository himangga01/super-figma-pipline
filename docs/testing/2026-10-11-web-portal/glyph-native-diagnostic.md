# Retained glyph candidate: actual native Chrome diagnostic

Date: October 11, 2026, completed before 23:56 KST. Read the [candidate validation review](current-ui-candidate-validation-review.md), [service audit repair](candidate-validation-audit.md), [canonical analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md) before continuing. This report records a standalone diagnostic authorized by the coordinator, not candidate acceptance or an additional complete portal UI round.

## Result and source boundary

Actual Google Chrome rendering confirms visible SVG fonts of 14 and 12 pixels for the two download labels, while their outer bound elements retain nominal API fonts of 9.85833 and 8.45 pixels. The distinction is measured from the actual SVG `text` elements. Nominal wrapper CSS was not used as proof of painted typography.

The mobile image difference improves from the previous actual 1.0932853760% to **1.0760070089%**, which still fails the unchanged 1% criterion. The two labels therefore account for a bounded part of the mismatch and do not explain the remaining failure. Guide and desktop remain within the visual criterion. There is no new semantic acceptance or candidate application.

The original 44-file candidate `sha256:ac97faf24d1bbc428e5c1e2d5c61429d81e9f40241546794c8ad53ba9a11fdcf`, original run, profile, staged evidence and oracles were preserved. Their expired deadlines were not reset and no lease, submission, validation operation, application or renewal was sent. The 45-file glyph candidate is still offline, unadmitted preparation.

The new owned diagnostic directory is `.worktrees/_cache/cdd-ui-scripter-glyph-native-diagnostic-20261011-r1`, with its application under `work`. Exactly 45 runtime files were copied from the frozen glyph preparation and verified against the complete hash closure before and after execution. The dependency tree was copied from the prior native validation work, producing 500 real dependency files. The original and copied trees contained zero reparse points. No package installation or lifecycle script ran, and no build used a managed dependency junction. The new directory provides path and process separation, not an operating-system sandbox or a read-only dependency guarantee.

The service's native source was imported through its reviewed Node source hook rather than the older built validator. Production source hashes were checked before browser launch:

| Native source | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview.ts` | `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` |
| `packages/mcp/src/portal/preview-consumption.ts` | `225a65c7aa968b276ec3d0ad2c38ef792aa6d78f72ff420edb383feef2bb675f` |
| `scripts/register-source.mjs` | `2c5a19bb767c5a9ee57bdbe363b5182e8255f95855a6e9da541c2c9b124ba668` |

The Chrome comparison used the service's `assertNativePortalPreview` and `withNativeVitePreview`. It retained the original three screen routes, viewports, oracle paths/hashes, pixel comparison mode and 1% criterion. It deliberately omitted later workflow actions and semantic consumption for this image/font diagnostic. A sequential second owned headless Chrome session measured effective SVG typography. The first session closed before the second launched; no additional visible window or source Figma session was opened or controlled. The owned local Vite preview process and diagnostic browsers were closed by their helpers.

## Commands and actual observations

The application was built in the new native copy with existing copied dependencies:

```powershell
# Working directory: the new diagnostic work directory
node node_modules/vite/bin/vite.js build

# Working directory: .worktrees/baseline/service
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-ui-scripter-glyph-native-diagnostic-20261011-r1/run-diagnostic.mjs

# Working directory: repository root; read-only pixel inspection
python .worktrees/_cache/cdd-ui-scripter-glyph-native-diagnostic-20261011-r1/inspect-pixels.py
```

Vite 7.1.7 built successfully. It retained its warning about the approximately 1.2 MB application chunk; this was not a performance acceptance test. The diagnostic process exited zero because it records failed comparisons rather than discarding their evidence. Its mobile screen explicitly reports `passed:false` and `VISUAL_MISMATCH`.

Both sessions used installed Google Chrome **155.0.8059.39**, Playwright's `chrome` channel and the service-selected executable. Comparison rendering retained device scale factor one, `en-US`, UTC, grayscale text request and disabled font hinting. Requests were limited to the owned loopback application and local data/blob resources.

| Screen | Previous actual difference | New diagnostic difference | Criterion |
| --- | --- | --- | --- |
| Guide, 653 by 192 | 0.8079696274% | 0.8079696274% | Within 1% |
| Mobile, 497 by 3051 | 1.0932853760% | 1.0760070089% | Failed |
| Desktop, 1728 by 2869 | 0.4494686173% | 0.4495694719% | Within 1% |

The mobile perceptual mismatch falls from 16,578 to 16,316 pixels, a reduction of 262 pixels or 0.0172783671 percentage points. The minor desktop change is not evidence of a new semantic defect. Original and diagnostic source comparisons use the same captured oracle hashes and comparison policy.

| Label suffix | Nominal API metadata | Outer computed CSS | Visible SVG computed CSS | SVG family and weight |
| --- | --- | --- | --- | --- |
| `1381:765` | 9.858333587646484 | 9.85833px | 14px | Spoqa Han Sans Neo, 700 |
| `1381:766` | 8.449999809265137 | 8.45px | 12px | Spoqa Han Sans Neo, 700 |

Both SVGs report `native-derived-text` and explicit source-font discrepancy. Actual `tspan` coordinates retain the source positions unchanged. The first visible glyph bounding box is approximately 81.5244 by 19 pixels; the second is approximately 47.4093 by 17. These are browser text geometry observations, not proof that the nominal API values should be replaced. Current API range evidence is uniform and transforms have identity linear bases, so an ordinary transform conversion remains unproved.

## Remaining mobile regions and correction limit

Read-only pixel inspection uses the service-produced actual/diff images and the unchanged original oracle. No image, mask, threshold or oracle was changed. Analytical rectangles cover the two labels at mobile export coordinates `[185,1547,280,1568]` and `[185,1567,280,1588]`:

| Analytical region | Previous differing pixels | New differing pixels |
| --- | --- | --- |
| First download label | 449 | 268 |
| Second download label | 214 | 130 |
| Outside both label rectangles | 15,915 | 15,918 |

The outside count alone remains above 1% of the full 1,516,347-pixel mobile image. This is an analytical explanation, not permission to exclude either rectangle or alter acceptance. White label ink now spans approximately 78 pixels versus approximately 77 in the oracle; blue label ink spans approximately 44 pixels versus approximately 45. Their lengths improve, but their exact ink shapes/counts still differ.

Remaining difference pixels are distributed across the page: 2,543 in rows 0–299, 2,565 in 300–599, 1,095 in 600–899, 1,436 in 900–1199, 888 in 1200–1499, 820 in 1500–1799, 1,433 in 1800–2099, 727 in 2100–2399, 1,683 in 2400–2699 and 3,126 in 2700–2999. The last export rows 3000–3050 have zero perceptual differences. A visual inspection of the existing diff shows text outlines throughout the page and details inside television/phone imagery.

Source-bound rectangle ranking identifies concrete unresolved areas without assigning a cause:

| Source node | Mobile export rectangle | Overlapping difference pixels |
| --- | --- | --- |
| Footer text `I1381:290;1379:619;1379:490` | `[32,2784,343,2987]` | 2,989 |
| Intro text `I1381:431;1379:244` | `[121,254,376,311]` | 1,924 |
| Intro text `I1381:431;1379:245` | `[109,331,385,378]` | 1,577 |
| Television media `I1585:527;1585:457;1379:240;1379:377` | `[125,883,373,1023]` | 1,457 |
| Television description `I1585:527;1585:457;1379:237` | `[93,753,400,817]` | 971 |
| Phone media `I1585:527;1585:459;1379:240;1379:364` | `[80,1368,418,1622]` | 955 |

Rectangles may contain overlapping source children or media, so these counts cannot be summed into independent causal contributions. Retained media fills report FILL, identity image transforms and zero filter adjustments. Current text weights/sizes and local declared families agree with the existing source records outside the explicit two-node conflict. Neither these facts nor the image difference establishes a further captured-value implementation error. No additional typography, colour, resampling, offset or opacity tuning was made.

The exact old/new RGBA screenshots differ at 95,323 pixels, but 94,127 have maximum RGB deltas no greater than 12. Broad exact-byte differences should not be misreported as a new captured-value defect when the unchanged perceptual policy records only three additional difference pixels outside the labels. This does not establish the origin of each low-amplitude rasterization difference.

The next useful source investigation is to establish the exact Figma font binary/version or authoritative fresh glyph semantics for the ranked text regions, and the exported static media frame/resampling relationship for the retained GIF fills. Those require actual source evidence before another candidate correction. At this checkpoint, the remaining result is unresolved rasterization/media detail rather than a demonstrated property mismatch that justifies arbitrary tuning. Full semantic consumption also needs to measure the visible SVG typography, preserving the nominal/retained conflict instead of accepting nominal outer CSS as proof.

## Retained evidence and execution limits

All evidence below lives in the new private diagnostic directory:

| File | SHA-256 |
| --- | --- |
| `run-diagnostic.mjs` | `da9061bf74e5defc4b9aa31bffb48add1faff5597788bb16ba3d1e37b2b5c401` |
| `preview-spec.json` | `9aa69144b9984e33ed5c1eb2989d926f210f586ed725addcd7cfd991df6cfc0b` |
| `preview-report.json` | `4dd14b5a9c8e5ba7cb222f973ec08ed8359a7000f23f017656a6b881e0815ba4` |
| `effective-font-observations.json` | `f82283aac3093de8e33c009842c5f183579e8ac148578a6234dd58649338b532` |
| `inspect-pixels.py` | `878e4a7fcfa24f608af8e680cef85f887be405752c97c7717eeec415353351fb` |
| `pixel-analysis.json` | `56f918b13266b899cb4eba30ac30a6bde7aac63442cf29fe7cbba7051fb43f23` |

The report stores hashes and exact private artifact paths without credentials or authentication material. The preview report includes all actual/diff hashes; diagnostic metadata records the current source bindings. The three visual checks and two effective-font observations are executed evidence. Configured keyboard journeys, semantic consumption, native signed profile execution, source freshness, guarded application and full portal acceptance were not executed in this diagnostic. The original blocked receipt remains preserved, and the independent service observer/image-audit repairs retain their separate verification record.
