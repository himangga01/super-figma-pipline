# Independent CDD source-contour renderer review

Date: 2026-10-13, Asia/Seoul. Reviewer: SOL. Review completed around 01:08 KST.

**The exact frozen diagnostic reproduces the reported residual correction and is approved as bounded diagnostic evidence. It is not a submit-ready or accepted portal candidate.** The glyph JSON exceeds the public submission limit, and the current public semantic verifier does not independently verify source contours. Both must be addressed in a fresh source-bound submission.

## Baseline and scope

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [fresh CDD readiness](cdd-fresh-candidate-readiness.md), [the residual diagnostic](cdd-residual-renderer-diagnostic.md), and [the retained-tab record](retained-tab-live-qa.md). The implementation report was read from the managed worktree; these relative links refer to its root-maintained documentation equivalents. Reuse this review and recheck current source/evidence before updating its conclusions.

The service acquires Figma design facts and assets, binds planning/coding material, validates a candidate through native processes and installed Chrome, and guards application separately. This review covers only the proposed contour representation, recorded source binding and diagnostic preview. It does not establish a new plan, coding lease, public producer result, native profile, guarded application or complete portal journey.

Frozen input: `.worktrees/_cache/cdd-residual-renderer-20261012-1791816229882/frozen-diagnostic-manifest.json`, SHA-256 `c2e43e485f605e67f688c31ac7af6c97702aa7e7dd7684a5776513b6f70061f6`. All 46 runtime entries and 19 evidence entries matched before review and after the independent runs. All 44 original runtime preimages matched; 43 remain byte-identical in the proposal. No original output, main/native service source, compiler candidate, owner index, live daemon, source Chrome, state, grant, unknown operation or old deadline was modified.

| Runtime delta | Frozen SHA-256 |
| --- | --- |
| `src/CapturedNode.jsx` | `1480d86d62a11c24680415b3fba00ec339572bc115f62980d79340fff8e9b423` |
| `src/native-outline.js` | `ededbb42c47535f4f22375e935dbfc3e52e165e9bde1dfd5385c0694cbca738d` |
| `src/native-glyph-outlines.json` | `eae0efd63bd54ae2cd64e5f8a6768b8a0ad9d5a98590d758e8db3222e7a2cccd` |

The private review root is `.worktrees/_cache/cdd-residual-independent-20261013/`. Its `work/` is a regular source copy and contains 500 copied installed dependency files, with links/hardlinks rejected. No installation or build through a managed dependency junction occurred. Native service helpers were imported read-only through the existing source hook. Their exact hashes are retained in `review-r2-metadata.json`; no current whole-source verification claim is made.

## Independently checked source and implementation

The successful recorded native export remains bound to file `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`, captured at `2026-10-12T14:04:28.887Z`. Its 53,197,880 bytes hash to `d2b8c94ced03a2e82bc8e39343f705a4aa8ece48fea882f0ac9ab0bf0abd573b`.

The real service ZIP/Kiwi decoder and native normalizer were rerun against those bytes. A private normalizer copy exposes the existing effective-instance derived text data through one additional result field. The actual service source remained unchanged. The result has 192 nodes, 72 text records and 1,594 glyphs. Character indices, positions, native font sizes, font metadata/digests, command blob bytes, decoded paths and all stored blob/raw/SVG hashes match the frozen outline records. The native result still reports `complete:false` and 163 warnings. Scoped glyph verification does not upgrade the whole native capture to complete.

Both recorded page-API and Scripter source trees independently match the candidate's 15,203 property values and hierarchy for all 192 nodes. All 25 captured assets per collector match their bytes and hashes. The 72 materialization records match current layout, complete single text range, paint/effects/stroke, native fonts, glyph hashes and transforms. This checks actual source records, rather than trusting the renderer's data attributes.

The rendering change uses source-native contours and positions. It flips the Y axis through `scale(fontSize, -fontSize)` and removes only leading close-contour tokens before the first move. It does not infer sizes from screenshots, change path coordinates to improve a score, replace a font or use root PNGs as implementation assets. Internal closes and coordinates remain intact. Invalid/truncated/non-finite/unsupported/injected streams are rejected.

The nominal API values remain **9.858333587646484 and 8.449999809265137** for the two download labels, while the independently decoded native glyph scales remain **14 and 12**. Both source observations are explicit and are not relabeled as agreement. The font digest is source metadata; this does not prove the installed WOFF2 is the exact Figma font binary/version.

The Korean outline branch paints actual SVG paths and connects a source-character `title` to each graphic through `aria-labelledby`. All 72 observed source graphics contain zero SVG `text` elements. Visible path hashes, transforms, character/command indices, fill, shadow and outside stroke match their bound records. The font-backed fallback with an opacity-zero positioning branch is not reached by those 72 original Korean records; localized content uses the separate ordinary flow path. No claim that source contours validate localized typography is made.

## Executed diagnostic results

- Parser/binding suite: 23/23, zero failures/skips.
- Real copied TypeScript 5.9.3: `--noEmit --incremental false`, exit 0.
- Copied Vite 7.1.7 build: exit 0; the 3,454.83 KB application bundle remains a performance concern. Gzip is approximately 626.32 KB. No load/performance acceptance was executed.
- Existing static source/asset check: 192 bindings, 22 implementation assets and three roots, exit 0. This check explicitly does not establish runtime acceptance.
- Service-owned `assertNativePortalPreview` against the rebuilt regular copy: all three full-root screens pass the unchanged `pixelmatch-7.2-v1` criterion of 1%.
- Actual installed-Chrome visible-path audit: 72/72 bindings, two GUIDE and 35 each Mobile/Desktop. Foreign page requests are zero. No invisible text duplicate was accepted as geometry proof.

| Root | Difference ratio | Strict RGBA ratio | Fresh page-API oracle SHA-256 |
| --- | --- | --- | --- |
| GUIDE | 0.0303088310% | 3.0364663093% | `3362ed1186379f9d655103c6a11360ff3d2aaebfe3a36bcd2cb093c0e9a31ba2` |
| Mobile | 0.8018613154% | 3.5123886551% | `53748111444ca0a940bfb10396db75354cd78aa80fdd2a356fbcd7b14b56e771` |
| Desktop | 0.3747555284% | 1.4183989453% | `7af46399edbc1528768198686132bfe4272f1126a597a942cce771aeff0fda2c` |

All actual PNG hashes equal the author's frozen diagnostic PNG hashes. Capture selectors remain null; comparison uses the entire root image. The original fresh page-API Mobile oracle is retained. No threshold, mask, exclusion or old/Scripter oracle substitution was made. Strict RGBA differences are retained as distinct metrics and are not reported as exact equality.

An owned proxy was started before each Chrome launch and injected only into the private fixture's Playwright launch options. It forwarded the exact owned Vite HTTP origin, denied every CONNECT and every foreign HTTP request, and tracked unexpected transport errors. The service visual run recorded 34 denied CONNECT and two denied HTTP requests; the visible audit recorded 21 and one. None were forwarded. Page routes additionally allowed only the owned origin and local data/blob resources. Unexpected proxy errors were empty. These controls are process-level test protections, not an OS sandbox. Source Chrome and the live service were not contacted.

The reviewer preserved two private setup failures: comparison of a JSON object with a decoder's null-prototype dictionary, corrected by comparing its serialized values, and the initial Node source import without `--experimental-transform-types`, which rejected an existing TypeScript parameter property. A repeat attempted to reuse a wx source-copy leaf and refused with EEXIST; a distinct private filename preserved the first copy. These are review harness failures, not renderer or service source repairs.

## Findings for fresh portal admission

### Blocking: exact diagnostic glyph file exceeds public submission limits

The frozen glyph JSON is **2,455,656 bytes**, 2,453,712 string characters. Minifying it still yields **2,237,571 bytes**. There are 432 distinct command identities across 1,594 glyph instances.

The actual native `PortalCandidateFileSchema.safeParse` rejects this exact file in both UTF-8 and base64 form. It reports the transport string bound and `File content exceeds one MiB`. The coordinator separately caps each explicit `args.files` batch at 1,048,576 decoded bytes. Base64 does not bypass the limit.

The fresh candidate needs source-preserving deduplication and/or separate bounded source chunks, with all paths, hashes, imports and materialization references regenerated and independently checked. Batch sizes must also remain within the existing public byte budget. Do not increase limits or bypass the public submission path merely to admit this diagnostic closure. This is an admission blocker for the exact current file layout, not a blocker to the bounded rendering conclusion.

### Blocking: public contour producer and semantic consumption are not implemented

Current `shared/src/portal-consumption.ts` expectations are `property`, `asset` or `component`. `recipes/consumption-values.ts` maps typography to computed `font-size`, `font-family`, `font-weight` and `textContent`. `preview-consumption.ts` reads computed style or element text and optional CSS-variable dependence. None derives an expected native command contour and verifies the actual path geometry. A `title` or unused inherited nominal font CSS therefore cannot establish the painted contour representation.

The renderer's document identity is read from candidate-owned outline JSON and passed back as its own binding. Its helper's local guards are useful compatibility checks, but they are not independent source authority. The review's raw document derivation supplies diagnostic evidence outside the public plan/coding/result lifecycle.

Before reporting fresh semantic acceptance, a real service-owned producer/verifier must bind the supplemental native source to the fresh context and independently derive bounded expected characters, source node/range/font metadata, command bytes/path hashes, positions/scales and paint/effect/stroke. Runtime verification must inspect the actual visible path geometry, ancestor exposure, source-character/name relationship and transformations. It must reject missing, altered, hidden or substituted contours, stale source/document/context/candidate identity, and nominal font CSS presented as painted-native proof. Retain the two nominal/native discrepancies as separate observed facts. Candidate declarations alone are insufficient.

### Required: regenerate historical bindings and complete acceptance declarations

The unchanged diagnostic `binding-manifest.json` still names historical run `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d` and its earlier context. `design-data.json.captureHash` remains `c69045257d5b541f3af3d941dad61559bc4702c7fb22040ecee641012cdba102`, while the current normalized facts identity is `e507e647d9b5f9f4ff4871a15ef9ecec465c5039da39fbfa6c50893a78125ecb`. Equal observed properties do not transfer the old run's authority.

For a new portal submission, root must obtain the fresh owner/workspace/run/coding-lease/context and capture bindings through the service. The complete candidate file closure must include the adapted contour chunks/helper/renderer, ordinary implementation assets and any changed binding resources. Regenerate the candidate hash and each required core declaration against current result IDs, result hashes, output work-item IDs, file hashes and assertion IDs. `consumption-input.ts` verifies these declarations against the actual prepared recipe results and rejects missing, reused or unused declarations. The current declaration contract cannot be extended by inventing a private contour kind in an old result.

Then register and execute the fresh native profile, full semantic/asset/interaction/source-freshness checks and complete portal journeys, preserve the same recorded full-root source oracles and criteria, and perform guarded application followed by applied verification if authorized. Current diagnostic actions and workflow assertions are empty. The independent screenshots do not establish account/registration/local-session/language journeys or generation/application.

## Evidence and reproducibility

The private review receipt is `review-receipt.json` under the review root. It binds the final original/copy rehash, source derivation, public-schema failure, independent visual and visible-audit evidence. Material evidence hashes:

| Private evidence | SHA-256 |
| --- | --- |
| `rederive-receipt.json` | `81a5ffe0ecaa196cc59d1914f990edcd3b1619e0491cc7040d51747f6009afd7` |
| `material-binding-receipt.json` | `7380001568ef4e31cbcf2b6c234db06d66b4b0454efdec792d3b21304ff0a58e` |
| `submission-boundary-receipt.json` | `6c6e92b74cc26e371effb1c8ff8f78ea36fd4543f45d257d44e43bd11cefffdb` |
| `review-r2-report.json` | `a7c0cab82e108f9104d53646d2baa0d05120f1ffeee1163701c08b047b3a8ba7` |
| `visible-glyph-audit-final.json` | `87338708eb61f09e7f9e373aa5e0ada3ebbdad38c5a1c01928c9711d03bc0993` |
| `unit-review.txt` | `3f66c12adf5bcf3c38b8d1449a2bf1799a395be0bf3ac6eb627c0b3e044d0bcb` |

From the private `work/`, the reviewed commands are `node node_modules/vite/bin/vite.js build`, `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and `node scripts/check-source.mjs`. The parser suite runs with `node --test ../test/native-outline.test.mjs`.

From native service cwd, a new private visual receipt can be produced with:

```powershell
node --experimental-transform-types --import ./scripts/register-source.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-residual-independent-20261013/service-visual.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-residual-independent-20261013 root-review-new
```

The mode creates new wx evidence paths; do not reuse consumed names. Derivation/audit scripts also use exclusive evidence leaves and need distinct private copies or output names for another review. Original inputs and all failed diagnostic experiments remain preserved.

The original data grant's recorded expiry remains `2026-10-12T22:02:20.755Z`; this review did not renew it. Actual official MCP verification remains owner-deferred. No Figma eligibility, complete native capture, current whole-check pass or complete frontend acceptance is inferred from these results.
