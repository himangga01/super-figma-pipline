# Remaining independent native capture fields

Analysis date: October 11, 2026 (Asia/Seoul).

This investigation and subsequent bounded repair supplement [the continuation record](README.md), [the canonical analysis](../../service-analysis.md) and [the project instructions](../../../AGENTS.md). The parent owns canonical report/instruction updates. The investigation began read-only during the source freeze. After the parent reported the passing whole check and authorized the next iteration, only the empty native gradient-binding marker and its tests were changed. Native inputs, references and generated metadata remain unchanged.

**Latest result:** CDD now has **14,402 compared positions and 261 unobserved positions**; eCommerce remains at **204,755 and 59**. Both retain zero unexplained differences in the declared scope and `fullCaptureAccepted:false`. The pre-repair inventory below remains useful historical evidence; the final section records the actual repair and verification.

## Baseline and evidence

Published main remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`. Main and the native validation copy were frozen at `sha256:18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3`. The parent subsequently reported whole attempt `b61a1d7a...` passing with 4,894 tests, zero failures, 20 existing skips and all 39 mandatory Chrome cases, plus the separate artifact-content case. That pass predates this repair and does not cover the modified source.

The independent collector reads a Figma Web local-copy archive, decodes its embedded Kiwi schema as data, expands component instances, normalizes recorded fields and compares them against a separately acquired Chrome/Scripter capture. Matching declared positions does not establish full capture or frontend acceptance.

| Input | Location under `.worktrees/_cache/` | SHA-256 |
| --- | --- | --- |
| Fresh CDD native archive, 53,198,804 bytes | `live-cdd-native-20261011-r1/ly06O8jAcrd7oWmwhz5Vr6-1791695173246-03182c11/document.fig` | `a87c9e4ed62c96b5444839d7809a7df063daaf3981de9294a0a1eef656755a63` |
| Fresh CDD stored comparison | `cdd-parity-20261011-r1/ly06O8jAcrd7oWmwhz5Vr6-1791695287645-97360fb4/capture-comparison.json` | `38b475fb609bfd4350750c1133bc3301e6e7face06b0bc0d44d4f4badf4783ab` |
| Fresh CDD normalized native output | Same comparison folder, `native-design.json` | `8e023e5649c24cff0160908dc8cdfbf553aa0b2e9445066f3282599d8f3cb23d` |
| Separate CDD R4 reference | `cdd-service-context-20261011-prep-r4/reference-tree.json` | `a886ebdf4a60d331d575deeae4ae2c0c299df9f03001dacc4bbec2f03e7603c4` |
| October 4 eCommerce native archive, 99,302,063 bytes | `live-ecommerce-native-refresh-20261004/4IBhv1d8hEclifZQrOYxHS-1791110752199-869e9afe/document.fig` | `09014941aef682697f1e98eb14e0606ce7ff7a27a0afc4ecdca2f73d0909f1c7` |
| Separate historical eCommerce reference | `ecommerce-service-context-20261004-prep-r2/reference-tree.json` | Used only by the comparator; no native value was populated from it. |

The eCommerce path is recorded in [the cross-PC handoff](../../handoff/another-pc-2026-10-05.md). This is the refreshed archive at that exact path, not an assertion that every earlier October 4 export has the same hash.

Read-only stdin scripts imported `decodeFigmaNativeDocument`, `nativeNodeId`, `selectFigmaNativeNodes`, `normalizeFigmaNativeNodes` and `compareFigmaCaptureNodes` through:

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs --input-type=module
```

They ran in `.worktrees/baseline/service`. Output was restricted to field counts, schema field names, bounded examples and small scalar records. No browser was controlled, no connector was used, and no native input data was changed. The later implementation checks are recorded separately below.

## Exact node coverage before the repair

Reexecuting the existing parser, normalizer and comparator reproduced the stored CDD results and the historical eCommerce field result at the current source:

| Measure | CDD, page `1378:120` | eCommerce, page `0:1` |
| --- | ---: | ---: |
| Native format | 106 | 106 |
| Stored native node-change records, whole file | 3,798 | 1,298 |
| Expanded scoped nodes | 192 | 3,198 |
| Declared comparison fields | 117 | 117 |
| Compared positions | 14,206 | 204,755 |
| Explicit unobserved positions | 457 | 59 |
| Retained representation differences | 77 | 408 |
| Unexplained differences in declared scope | 0 | 0 |
| Full capture accepted | No | No |

CDD has 12 directly selected raw records; following native component references expands those records into the 192-node scoped scene. This is not a 180-node collection omission.

| Unobserved declared field | CDD | eCommerce | Current cause |
| --- | ---: | ---: | --- |
| `resolvedVariableModes` | 192 | 0 | A whole-document variable detector treats empty native `stopsVar` arrays as evidence of bindings. |
| `fillStyleId` | 116 | 9 | The current identity adapter cannot establish all retained local/unsupported style references as Plugin API IDs. |
| `textStyleId` | 57 | 0 | Local/inherited or run-level style identity remains unresolved. |
| `mainComponent` | 35 | 47 | Full Plugin API identity requires keys not established by native local component records. Partial native identity is retained separately. |
| `componentApi` | 35 | 0 | Nonempty variant definitions do not establish their Plugin API default contract. |
| `strokeStyleId` | 7 | 1 | Style identity remains unresolved. |
| `effectStyleId` | 6 | 0 | Local style identity remains unresolved. |
| `boundVariables` | 4 | 0 | Four expanded nodes inherit the empty-array detection issue. |
| `vectorPaths` | 4 | 2 | Styled native networks, plus one missing native network source in the eCommerce unknown set. |
| `exportSettings` | 1 | 0 | A real nested-instance export override is deliberately marked unknown by the current ownership rule. |
| **Total** | **457** | **59** | These totals exclude fields outside the declared comparison set. |

The CDD `resolvedVariableModes` count covers 40 frames, 72 texts, 35 instances, 27 rectangles, 12 vectors and 6 groups. `fillStyleId` covers 72 texts, 20 instances, 12 vectors, 9 rectangles and 3 frames. The four binding unknowns are two rectangles and two instances. The source component and style identity gaps must remain unknown; an empty-array repair is not permission to fill them with empty/default identities.

## Smallest concrete repair: empty native gradient binding arrays

`figma-native-metadata.ts` currently recognizes any matching variable key as evidence, regardless of its value. The actual embedded schema declares `Paint.stopsVar` as an array of `ColorStopVar`. Each element may contain `color`, `colorVar` and `position`.

An exhaustive recursive scan of the decoded CDD node-change records found:

- **Zero** `VARIABLE` or `VARIABLE_SET` records.
- Exactly **nine** matching variable-marker occurrences, all `.fillPaints[].stopsVar` with the value `[]`.
- No other key matching the current variable-marker detector. The observed maximum nested object depth was 7, within the detector's depth bound.
- These arrays appear on native records `1:38`, `1379:142`, `1379:144`, `1379:457`, `1381:247`, `1381:454`, `1381:529`, `1381:1095` and `1381:1096`.

An empty array of gradient-stop bindings contains no binding entry. A narrow exemption for the schema-known `stopsVar: []` representation is therefore supported by native data. It should leave every nonempty or malformed value and every other unknown marker conservative. The separate reference contains empty resolved-mode objects on all 192 nodes; that observation is comparison evidence only and must not become the implementation's source of values.

The pre-implementation prediction was 196 additional observed CDD positions, bringing compared positions to **14,402** and unobserved positions to **261**, while preserving the 77 explained differences and all other unknowns. eCommerce has no matching variable markers and was expected to remain at 59 unobserved positions. The later service CLI comparisons below confirmed those predicted counts.

The smallest meaningful regression set should cover:

1. A document containing a gradient paint with `stopsVar: []`, no variable records and no other markers. Assert the document is not classified as variable-bearing and the affected node has observed empty bindings/modes through the normalizer.
2. The same document with a nonempty `stopsVar` containing a `colorVar` alias. Preserve unknown bindings and document-wide unknown resolved modes.
3. `stopsVar` values of `null`, `{}` and `[{}]`. None may be treated as verified empty binding arrays.
4. An empty `stopsVar` alongside a real `colorVar`, `opacityVar`, `variableModeBySetMap` or variable record elsewhere in the document. The actual marker must still keep relevant evidence unknown.
5. An unrecognized key such as `futureVar: []`. Do not generalize the exception to every empty array or empty object.
6. An expanded instance inheriting a gradient with the recognized empty representation. Preserve parent/child binding ownership and verify the native-only result, then compare both real saved inputs independently.

Use `packages/cli/test/figma-native-metadata.test.ts` and the existing node expansion tests. Include a small focused red-to-green run before full comparison. Do not modify reference captures, suppress unknown counters or mark full capture accepted.

## Geometry present in bytes, but not fully exposed

### Vector networks and the four CDD path unknowns

All **six** unique native sources for the 12 expanded CDD vector nodes contain a `vectorNetworkBlob`. The current decoder already reads bounded vertex, segment and region records to derive SVG paths. It does not emit the complete Plugin API `vectorNetwork` structure.

The four CDD path unknowns expand two native sources, `1508:436` and `1472:2748`. Each has a 6,540-byte network blob with **144 vertices, 144 segments and 16 regions**. Eight vertices use style 0; 136 vertices and every segment use style 1. The style table explicitly records `cornerRadius:0`, `strokeCap:NONE`, `strokeJoin:MITER`, `handleMirroring:NONE` and `cornerSmoothing:0`. Current `readNativeVectorGeometry` rejects any nonzero style identifier, so it withholds paths even for this explicit style record.

A later bounded iteration can resolve referenced style rows and prove which recorded values leave path geometry unchanged. It must retain rejection for unresolved style IDs, malformed tables, actual rounded corners and unsupported geometry-affecting styles. Do not globally ignore nonzero style IDs. Regressions should include this explicit neutral style, a nonzero corner radius, a missing style row, duplicate IDs, truncated blobs and size scaling. The two source nodes have different actual sizes, so preserving normalized-to-actual scaling matters.

eCommerce has 220 expanded vectors from 95 direct source IDs. **93 of those source rows contain a network blob**. Its two current path unknowns are `I117:485;1:77`, whose direct native source has no `vectorData`, and `117:771`, whose style table contains a real `strokeCap:ROUND`. The CDD neutral-style repair must not automatically declare the latter supported. Missing topology cannot be recreated by relabeling cached fill paths.

Full `vectorNetwork` support is a separate task: emit independently decoded vertices, segment endpoints/tangents and region loops, scale them consistently, map explicitly supported style properties, and account for unsupported region/style attributes. The reference network has vertex styling and region fill/style properties in addition to geometry. A partial topology decoder should expose its coverage and not claim complete network semantics.

### Absolute render bounds are not directly recorded

No `absoluteRenderBounds` or equivalent per-node rendered rectangle was found in the native node schema or decoded records. The schema's `ClientRenderedMetadata` is connection/tracking metadata, not geometry, and is absent from these CDD message records. `useAbsoluteBounds` is an export setting, not a rectangle. Native `meta.json` contains file/export metadata and thumbnail-related client metadata, not per-node render-bound identities.

Independent comparison demonstrates why substituting `absoluteBoundingBox` is invalid:

| Reference render bounds versus its own bounding box, tolerance 0.001 | CDD | eCommerce |
| --- | ---: | ---: |
| Non-null and equal | 112 | 1,307 |
| Non-null and different | 80 | 888 |
| Null render bounds | 0 | 1,003 |

Some render extents may eventually be derived from native paths, strokes, effects, clipping, transforms and visibility. That would require a separately bounded rendering-semantics implementation and evidence for the applicable subset. Do not return boxes for every node or use reference rectangles as computed native values. Keep this field outside complete admission until the required scope is proven.

## Metadata which remains absent or ambiguous

**Local style identity.** CDD has 83 native style records; none has a native key. The 28 distinct local-style keys used by the scoped Plugin API reference were not found among any decoded native string values. Native GUID references can establish native identity and resolve style values, but do not establish the separate Plugin API key. Unique-name pairing is comparison assistance, not an identity authority. eCommerce has 15 native style records, 14 with keys; its remaining ten style-ID positions still need their actual reference forms resolved. Preserve missing-library-style warnings.

**Components.** CDD has 84 native component/component-set records and no recorded `componentKey` or node `key` on them. Its 35 expanded instances use 13 definition owners with 21 variant definitions. Every examined native definition's initial string is empty, with an empty preferred-values object. The already-supported variant assignment can be read from native specs, but an empty initial string does not establish the Plugin API's default option. Do not choose a first child or parse a display name into a default. Keep full `mainComponent` and `componentApi` unknown while retaining available native ID/name/set and variant facts.

**Export override.** The single CDD export unknown is `I1585:527;1585:457;1379:240;1379:362`. Native instance `1379:240` has an explicit override for path `1379:362`: PNG, scale 1, empty suffix, contents-only, non-absolute bounds and document color profile. The current normalizer deliberately treats descendant export overrides as unknown to avoid inheriting master exports. A later ownership-preserving repair should distinguish an explicit override for that descendant from master export settings and from absence. Its minimum regressions are an explicit nested override, an explicit empty override clearing export settings, and a master export that must not propagate to an instance descendant.

## Coverage outside the 457/59 position totals

Five semantic/collector fields remain outside the declared field comparison. Node `id` is checked independently by hierarchy identity and should not be counted as a missing semantic field.

| Field present in reference but outside declared fields | CDD positions | eCommerce positions | Treatment |
| --- | ---: | ---: | --- |
| `absoluteRenderBounds` | 192 | 3,198 | No direct native rectangle found; separate derivation/acquisition required. |
| `vectorNetwork` | 12 | 220 | Native geometry bytes largely exist; complete API-shaped semantics are not emitted. |
| `geometrySource` | 72 | 868 | Collector provenance differs. Do not copy the reference source label. |
| `textSegments` | 72 | 868 | Native font-range comparisons provide separate bounded evidence, not identical collector representation. |
| `collectorCapabilities` | 192 | 3,198 | Must describe the native collector's own actual coverage. |

CDD's style catalog has another **238 unobserved field positions across 56 paired styles**: description 56, remote 56, bindings 56, text wrapping 16, paragraph indent 16, text case 16, text decoration 16 and paragraph spacing 6. These are separate from node unknowns. The 114 compared style positions retain 17 differences: 16 font-name differences and one effect difference. No missing, extra or ambiguous style pairs were recorded. This task does not repair or reclassify those catalog differences.

The stored comparison also has three pending root PNG and 12 pending SVG entries. Later independently copied web assets are recorded separately by the parent. Their existence does not retroactively complete this comparison's exact node identity, geometry, resolution or full-asset admission.

## Bounded next iteration and verification limits

The first authorized edit after the freeze was lifted is the schema-known empty-gradient-binding exemption described below. Its comparison result follows from the native representation and the negative tests; no warning counter was suppressed. Preserve source freshness and whole-check invalidation rules.

Follow with independent, separately reviewed tasks for explicit neutral vector style handling and descendant export ownership. Full networks and render bounds require broader contracts. Local style/component key absence and variant-default ambiguity remain hard evidence gaps; do not fill them to raise a completeness flag.

This analysis verifies the decoded contents of two stored native archives and reproduces bounded field comparisons. It does not establish a live document epoch, current eCommerce state, authenticated official MCP parity, complete independent asset admission, frontend generation or final acceptance. The archive's schema and record inspection supports the distinctions above; opaque image payloads and Figma's internal runtime rendering state were not treated as discoverable node metadata.

## Implemented empty-marker repair, October 11 after 15:18 KST

Owned code paths, relative to `.worktrees/baseline/service`:

| Path | Frozen SHA-256 |
| --- | --- |
| `packages/cli/src/figma-native-metadata.ts` | `b1f813586ae945ef4af40afefaeb442358cc9760dcf43a189b516ef69ce83c81` |
| `packages/cli/test/figma-native-metadata.test.ts` | `e095dae2a41274d3ca097a6ee9b5e4888fa5478275a375c6291a4a16c02623c9` |

The detector now exempts only the exact key `stopsVar` whose value is an actual zero-length array. It still recurses normally and treats nonempty/malformed stop markers and all other variable-marker names conservatively. The normalizer and comparator consume this result through their existing paths. No component identity, style identity, variable value, capability count or reference file was changed.

The added tests cover empty native arrays, null/object/nonempty/malformed arrays, aliases, other actual/malformed/future markers, a variable or variable-set record elsewhere, instance inheritance and descendant override ownership. The instance regression also asserts that unresolved `mainComponent` remains unknown.

- **Red, 15:18:33 KST:** metadata test file had 4 failures and 14 passes before the production change. Failures showed the false document-level variable classification, withheld empty own bindings despite a separate variable record, and affected instance expansion.
- **Green, 15:18:50 KST:** metadata plus existing native-node tests passed **30/30**, zero skips or failures.
- Scoped lint and formatting passed for both owned paths.
- CLI typecheck encountered the parent's intentional red test: `test/browser-observation.test.ts:6` imported the not-yet-added `probeFigmaWebRuntime` export. The parent confirmed concurrent diagnostic work. This is not a passing CLI typecheck and was not repaired by changing unrelated browser files. Parent integration must rerun the static check after its implementation settles.

Commands for focused checks:

```text
pnpm exec vitest run packages/cli/test/figma-native-metadata.test.ts packages/cli/test/figma-native-nodes.test.ts
pnpm exec oxlint --deny-warnings packages/cli/src/figma-native-metadata.ts packages/cli/test/figma-native-metadata.test.ts
pnpm exec oxfmt --check packages/cli/src/figma-native-metadata.ts packages/cli/test/figma-native-metadata.test.ts
pnpm --filter @sfp/cli typecheck
```

Both actual offline comparisons ran through the **service's source-loaded CLI**, using the input/reference pairs above and each reference folder's `reference-assets.json`:

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs packages/cli/src/index.ts chrome-compare --input <native-document.fig> --reference <reference-tree.json> --reference-assets <reference-assets.json> --url <the same explicit file/page URL> --out <new output root>
```

New evidence folders under `.worktrees/_cache/native-empty-stopsvar-20261011/`:

- CDD: `cdd/ly06O8jAcrd7oWmwhz5Vr6-1791699567499-6f9eec7b`; `capture-comparison.json` SHA-256 `04edfb2c5a0c2b8ae65222ea6f57fd211d45204d68c9dd0a5818a385838a4d8f`.
- eCommerce: `ecommerce/4IBhv1d8hEclifZQrOYxHS-1791699567925-5424574d`; `capture-comparison.json` SHA-256 `92f233ce71902e333748713577c0777b0e1eea0fd61389041d4e2bae87d9ea76`.

| Actual post-repair comparison | CDD | eCommerce |
| --- | ---: | ---: |
| Declared fields | 117 | 117 |
| Matching node IDs, with no missing/extra IDs | 192 | 3,198 |
| Compared positions | 14,402 | 204,755 |
| Unobserved positions | 261 | 59 |
| Retained representation differences | 77 | 408 |
| Unexplained differences | 0 | 0 |
| Matching font ranges | 72 | 868 |
| Differing font ranges | 0 | 0 |
| Matching original images | 10 | 52 |
| Style positions / retained differences | 114 / 17 | 14 / 0 |
| Full capture accepted | No | No |

CDD's remaining 261 positions are fill-style IDs 116, text-style IDs 57, main components 35, component APIs 35, stroke-style IDs 7, effect-style IDs 6, vector paths 4 and export settings 1. eCommerce's remaining distribution is unchanged. This patch removes the proven false-positive variable markers; it does not resolve the geometry, metadata identity, catalog or independent asset-admission work described above. Parent reconciliation and a new whole check remain required for the next merged source.
