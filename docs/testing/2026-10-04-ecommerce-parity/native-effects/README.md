# Native effects, strokes, sizing, text and container fields

Date: October 4, 2026, approximately 23:35 KST to October 5, 00:00 KST (Asia/Seoul). Published baseline `5b9343efc82ef47ba56f412acbd4eee5a328d335` with continuing uncommitted changes. After the effect change, main and native sources matched at `sha256:1cb9f841...`; after the stroke change, they match at `sha256:26bf29c0...`. The owner index is unchanged.

## Purpose

This continues the independent plugin-free native collector (step 2 of the [evening handoff](../../../handoff/reboot-2026-10-04-evening.md)). The [uncompared-field inventory](../native-behavior/uncompared-node-fields.json) listed `effects` on all 3,198 eCommerce nodes as absent from native output. Each collector reads its own source, and neither collector's facts were copied into the other.

## Observed native encoding

A read-only helper (`.worktrees/baseline/service/.cache/inspect-native-effects-20261004.mjs`) printed the native effect schema and the records for every reference node with effects.

- eCommerce has 10 such nodes. Native `FOREGROUND_BLUR` corresponds to Plugin API `LAYER_BLUR`. Native blur records retain unused shadow fields (offset, color, spread), which the Plugin API omits.
- CDD has 6 text nodes inside instances, whose drop shadow comes from effect style `1:88`.
- The native schema also defines variable bindings (`*Var`), progressive blur geometry and procedural types such as glass, noise, grain and repeat.

## Implementation

`service/packages/cli/src/figma-native-effects.ts` converts:

- layer and background blurs to `{type, visible, radius, boundVariables: {}, blurType: 'NORMAL'}`;
- drop and inner shadows to their exact color, offset, radius, spread and blend mode; only drop shadows keep `showShadowBehindNode`.

A resolvable effect style supersedes the node's cached copy, as for paint styles. Variable-bound, progressive, procedural and malformed effects return no value and record `NATIVE_EFFECTS_UNSUPPORTED`. `effects` is now a declared comparison field.

## Actual comparison

The same separately collected inputs were compared before and after the change with the rebuilt service CLI `chrome-compare`:

| Scope | Before positions | After positions | Unexplained | Effect differences | Nodes with effects | Unsupported |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| eCommerce | 124,734 | 127,932 | 0 | 0 | 10: 6 layer blur, 2 background blur, 2 drop shadow | 0 |
| CDD | 8,778 | 8,970 | 0 | 0 | 6 drop shadows from an effect style | 0 |

Raw representation differences stay at 408 for eCommerce and 73 for CDD, unchanged from the earlier baseline. Checkpoints:

- eCommerce: [baseline](ecommerce-baseline-checkpoint.json), [after](ecommerce-effects-checkpoint.json), [comparison](ecommerce-comparison.json)
- CDD: [baseline](cdd-baseline-checkpoint.json), [after](cdd-effects-checkpoint.json), [comparison](cdd-comparison.json)

`fullCaptureAccepted` remains false. Effect-style identifiers (`effectStyleId`), variables, layout sizing, grids, stroke details, text properties and the other inventory fields are still uncompared.

## Stroke details

The same inspection method showed the stroke encodings:

- **Miter limit and dash pattern.** Every reference node except groups has `strokeMiterLimit: 4` and `dashPattern: []`. Natively, `miterLimit` and `dashPattern` are omitted at those defaults.
- **Side weights.** Uniform side weights appear on frame, instance, component and rectangle nodes, equal to `strokeWeight` unless sides are independent. The previously decoded independent-weight path already covered the 9 eCommerce `[1,0,0,0]` rectangles.

The normalizer now:

- reports these values only for those Plugin API types;
- records malformed values as `NATIVE_STROKE_UNSUPPORTED`;
- declares the six fields for comparison.

eCommerce compares 137,658 positions with no new differences ([checkpoint](ecommerce-strokes-checkpoint.json)).

CDD compares 9,750 positions. It first showed 4 new side-width differences on one rectangle inside a nested scaled instance: native 1, reference 0.704. That is the node whose `strokeWeight` difference was already explained because neither collector records stroke paints. The explanation now applies to side widths under exactly that no-paint condition. A painted-stroke regression confirms that real width differences stay unexplained. CDD then has 77 raw differences, all explained, and zero unexplained ([checkpoint](cdd-strokes-checkpoint.json)). The [comparison files](ecommerce-comparison.json) now hold the latest stroke-phase results, which include effects.

## Layout sizing

`layoutSizingHorizontal` and `layoutSizingVertical` appear on every reference node. The derivation was first checked against the reference's own semantics:

- **FILL**: a grower along an auto-layout parent's primary axis, or a stretch along its counter axis.
- **HUG**: an auto-sized axis of the node's own auto layout, or auto-width/auto-height text, but only inside an auto-layout parent.
- **FIXED**: everything else.

Seventeen eCommerce instance copies of text `117:405` initially contradicted the text rule. Their instance overrides set `visible: false`, so hidden children do not take part in auto layout. With that condition, the rule matched 6,396/6,396 eCommerce and 384/384 CDD reference values.

The native normalizer now computes sizing after the tree is complete, using only its own decoded layout, visibility, positioning and text-resize fields. Those fields are themselves compared independently. An unknown container layout or text resize mode leaves sizing unknown.

Real comparisons add 6,396 eCommerce and 384 CDD positions, with zero differences. Totals are 144,054 and 10,134 positions, each with zero unexplained differences ([eCommerce](ecommerce-sizing-checkpoint.json), [CDD](cdd-sizing-checkpoint.json)). Both designs use only FIXED and HUG. FILL is covered by unit cases but not yet by real design data. Because these values derive from already-compared fields, they add API-shaped output for frontend generation rather than new independent evidence.

## Text properties

Reference text nodes record `textCase`, `textDecoration`, `textTruncation`, `maxLines`, `textWrapStyle`, `hyperlink` and `fontWeight`. Native records omit the defaults: `ORIGINAL`, `NONE`, `DISABLED`, `null`, `AUTO` and no hyperlink. Explicit values appear on nodes, text styles or character-override rows.

`service/packages/cli/src/figma-native-text-properties.ts`:

- resolves case and decoration through the character-style table, so uneven runs become `mixed`;
- validates truncation, line count and wrap enums;
- takes font weight only from Figma's recorded font metadata in the already-decoded font ranges (uniform weights give a number, otherwise `mixed`).

No native hyperlink encoding has been observed against a reference, so any present hyperlink stays unknown (`NATIVE_TEXT_PROPERTY_UNSUPPORTED`).

Comparisons add 6,076 eCommerce and 504 CDD positions with zero differences and no warnings. eCommerce values include 32 strikethroughs, one uppercase node and one mixed weight. Totals are 150,130 and 10,638 positions, each with zero unexplained differences ([eCommerce](ecommerce-text-checkpoint.json), [CDD](cdd-text-checkpoint.json)).

The new unit tests were written before the module but were not executed in the failing state before implementation. Their passing results and the real comparisons are the evidence here.

## Container, corner, grid and aspect fields

Native records omit the default values of six fields. The reference shows which Plugin API types expose each one:

| Plugin API field | Native field | Default | Types |
| --- | --- | --- | --- |
| `cornerSmoothing` | `cornerSmoothing` | 0 | frame, instance, component, rectangle, vector and ellipse |
| `strokesIncludedInLayout` | `bordersTakeSpace` | false | frame, instance and component containers |
| `numberOfFixedChildren` | fixed-children divider | 0 | containers |
| `overflowDirection` | `scrollDirection` | `NONE` | containers |
| `layoutGrids` | `layoutGrids` | `[]` | containers |
| `targetAspectRatio` | `targetAspectRatio` | `null` | every type except lines |

Native `proportionsConstrained` (91 eCommerce nodes) is a different flag and is not mapped to `targetAspectRatio`.

Native stripe grids convert to `COLUMNS` (x axis) or `ROWS` (y axis), with count, gutter, alignment and the offset or section size the Plugin API keeps for that alignment. Square grids convert to `GRID`. Variable-bound or unobserved grid forms, fixed-child dividers and recorded aspect locks stay unknown (`NATIVE_CONTAINER_UNSUPPORTED`).

[Two expected failures](container-red-tests.json) preceded the implementation. Comparisons add 6,865 eCommerce and 606 CDD positions with zero differences and no warnings. These include the nine real eCommerce column grids and the two CDD vertically scrolling containers. Totals are 156,995 and 11,244 positions, each with zero unexplained differences ([eCommerce](ecommerce-container-checkpoint.json), [CDD](cdd-container-checkpoint.json)).

## Remaining coverage

The [updated inventory](uncompared-node-fields.json) lists 36 reference fields still outside the 87 compared fields:

- **Grid auto-layout:** row, column, gap, anchor, span and child-alignment fields.
- **Style identifiers:** fill, stroke, effect, grid and text style IDs.
- **Variables:** variable bindings and modes.
- **Metadata:** annotations and export settings.
- **Component semantics:** properties, variants, main component, API, definitions and description.
- **Geometry:** render bounds, vector paths/networks, arc data and geometry source.
- **Collector metadata:** `collectorCapabilities` and `textSegments`; the latter is compared through font-range evidence.

## Verification

[Two expected failures](red-tests.json) preceded the effect implementation. The stroke regression and the unpainted side-width regression also failed before their changes. After the stroke changes, 18/18 effect and node tests passed. [Focused and native-suite runs](tests.json) passed 16/16 and 45/45. After the container fields, all [67 native-module tests](native-suite-tests.json) passed across ten files. CLI typecheck, scoped lint/format, CLI builds and the fourth to eighth bounded provenance rounds passed (71 semantic changes after the container fields, 178 forks, 3 upstreams, 238 vendor rows). Main and native sources now match at `sha256:62023ddd8c029ecd5425a25407551dfc1ea01a649b5c7008ce844d7d9ca357bb`. These checks run as the same Windows owner in a separate working copy; that is not an OS sandbox. The complete whole check `a59a6e15...` predates these changes. Attempt `1c7268c7...` at the new source passed typecheck, lint, format, knip, contracts and build. Claude Code then stopped it for low memory at the test gate ([interrupted, not passed](interrupted-source-check.json)). A complete pass is still required.
