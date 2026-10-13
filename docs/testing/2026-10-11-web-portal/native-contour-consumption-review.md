# Independent native-contour producer and runtime review

Date: 2026-10-13, Asia/Seoul. Reviewer: SOL. Status: exact revision 3 producer source approved for root integration; original and revision 2 failures remain preserved.

The producer's actual native-byte derivation and source binding passed the independent checks. Revision 2 repaired three pixel-erasure false positives but still accepted partially clipped contours. Revision 3 rejects the unchanged five-case independent matrix while the actual supported source72 baseline remains valid. Approval binds the exact twelve-file revision 3 manifest and does not approve earlier source cohorts or establish full portal acceptance.

## Scope and baseline

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [the earlier bounded contour diagnostic review](cdd-residual-renderer-review.md), the managed `native-contour-consumption-implementation.md`, and [supplier implementation](native-capture-supplement-implementation.md). Reuse this review and check newer source/evidence before updating it.

The service converts primary captured source facts into signed planning/candidate material and verifies actual native rendering. This review covers the separately authored producer, explicit recipe representation, Chrome observer and receipt comparison. Supplier/index/NativeWork production wiring, source admission, actual generation/application and complete portal acceptance remain root-owned and separate.

Original exact twelve-file manifest: `538ac2ac4a2d239e38f4f6cca8ae3bf0a52d0720d483babbaa8634738c0fa307`. Revision 2 exact manifest: `1369c296f93b5dccf341013deb94c6e296932d6a4259c61fe55afd8d2967f78c`, at managed `service/.cache/native-contours/frozen-files.json`. Before execution, all twelve managed entries matched. Only `preview-native-contours.ts` and its Chrome test changed in revision 2. Original bytes and failed receipts are retained in the ignored review root `.worktrees/_cache/native-contour-independent-20261013/`.

Final revision 3 manifest: `7e3126bc3a5d6410a9c17fd5a608068366b2634de9de0785dd4889204d3bc634`. The only changes from revision 2 are observer `93eb96c53c7f85f9625912a1c23b5877f6ce21aacb055bdee0b6a7e7456b0f3c` and Chrome test `76f84fc168d443397c44198cc8ac6c2c1bee0b75e514843670dfe1de215f20ba`. All twelve managed hashes were verified before and after execution; all production fixture bytes match. The existing private test dependency-path adapter remains disclosed below.

The fixture is a regular copy using read-only native installed dependencies and a private Vite cache. The candidate runtime is a separate regular 46-file copy of deduplicated diagnostic manifest `5b324bf3c1c9012c2067012c1137ab9c574390404c8f29e8b587cd9aab18b871`, plus 510 regular dependency files. No installs, managed-junction builds, Main/native service edits, Git, live source Chrome, runtime, state, coding lease or grant operations were performed. The root confirmed the original model-data grant expired; this review reads preserved local inputs only and does not renew authority.

## Confirmed runtime findings

### Original P1: fully erased glyphs accepted as painted source

The reviewer used a service-owned installed Chrome session, an actual public `observePortalConsumption` call, native AX verification and a proxy denying foreign HTTP/CONNECT. The fixture contains one source graphic with original `d="M0 0 L1 0 L1 1 Z"`, transform `translate(0 10) scale(14 -14)`, a `title` of A and an actual source `aria-labelledby` relationship. The baseline screenshot has nonwhite glyph pixels.

Three changes leave the path attributes, matrices, nominal CSS and AX relationship intact while producing a screenshot with zero nonwhite pixels:

- A plain ancestor gets `filter: opacity(0)`.
- The same ancestor gets `opacity: 0.0001`.
- The target gets an opaque fixed white `::after` overlay.

The original public check returns `passed:true` in all three cases. Isolated DOM prototypes and AX inclusion alone did not establish painted visibility. Original three-case receipt `compositing-r3.json`, SHA-256 `649e06b2bfd2836e604539f44c8906e97c0c1307209773175aeeb4f0079dc6b4`, is three desired-rejection failures. The original one-case public filter receipt is `ancestor-filter-r2.json`, SHA-256 `64ad14326340f92143512df805bfffa4b653996bb867c3308e737386400f7941`.

Revision 2 adds source-closed ancestor compositing and generated-pseudo checks and traverses above the source root. The exact same three independent cases now reject correctly. Its own-SVG source shadow remains supported. This repair passed the 85-case focused cohort and real-source 72-case audit described below.

### Revision 2 clipping acceptance hole, repaired in revision 3

In the same unmodified baseline, a plain ancestor receives width 10px, height 12px and `overflow:hidden`. The actual glyph has a 14px contour extent. The screenshot retains positive pixels but fewer than baseline. Its logical target center remains exposed, so public hit testing does not reject the changed paint. The public contour check nevertheless returns `passed:true`.

A directly executed `overflowX:hidden; overflowY:visible` variant produces the same loss of pixels and false acceptance. Chrome computes mixed-axis overflow; the current observer only recognizes a small list of whole shorthand strings and checks total exclusion rather than source-closed partial containment.

Revision 2 five-case receipt `compositing-r2-per-axis.json`, SHA-256 `a9d280e278685e4699c5b29f9b9e99be4e8443510a2aa2389936179a3ddb009c`, has three passes and two clipping failures. The initial width-10 receipt is `compositing-r2-partial-clip10.json`, SHA-256 `dffea322f0b41697983fe89ffe786dc37a214af378984dcb28c133c6c0e10978`. A width-1 control already fails public exposure and is preserved separately; this finding concerns partial clipping that retains the logical hit point.

Root and author received the exact HTML/CSS, receipt paths and required criterion. Unknown clipping of expected painted contours must fail closed. No reviewer production edit was made.

Revision 3 checks each clipping axis against full actual path geometry and bounded native raster paint bounds, including independently matched stroke and SVG drop-shadow. It does not substitute an assumed blur tail radius. Native Canvas rasterization uses isolated-world path/styles and expands a bounded surface until nonzero-alpha pixels no longer reach its edge; capacity exhaustion and unsupported clipping transforms fail closed. It does not change page DOM or source geometry, invent clip-chain facts, use a screenshot threshold for acceptance, or modify the source oracle.

The unchanged original filter, opacity, pseudo overlay, shorthand overflow and per-axis overflow cases now all return public `passed:false`. Each baseline remains valid; the clipping witnesses retain fewer positive pixels than baseline. Actual source72 including supported own-SVG shadows still passes. An intermediate author viewport comparison rejected 17 supported records; it is preserved by the author. The final viewport-to-screen check permits only Chrome's 1/64px CSS box quantization while retaining original intrinsic source dimensions and path comparisons. This narrow layout tolerance is distinct from any visual acceptance threshold.

## Independent source and recipe evidence

The real service decoder and producer read the preserved 53,197,880-byte native file, SHA-256 `d2b8c94ced03a2e82bc8e39343f705a4aa8ece48fea882f0ac9ab0bf0abd573b`. The independent primary input is the recorded current page-API source for file `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`. It normalizes to 192 nodes and derives 72 supported text expectations with 1,351 nonempty paths and four native font digests. Every expected character, nominal/native scale, font digest, decoded command/path hash and glyph transform matches the separately verified document material. Child-order, full-range and current-font mutations are rejected.

The two nominal/native discrepancies remain explicit: `9.858333587646484` versus 14, and `8.449999809265137` versus 12. The producer does not replace these nominal API values with guessed font sizes or claim that inherited CSS proves contour painting.

The producer hashes and decodes actual bytes, validates capsule owner/workspace/plan/file/full-scope/time/fingerprint bindings, joins the selected native hierarchy to the primary observation, requires complete unambiguous text ranges/fonts, rejects unsupported transforms/paint, bounds glyph/path/expectation expansion and brands prepared records in a module-private WeakSet. Cloned or candidate-supplied prepared objects fail authority checks. The public recipe representation is an explicit alternative; the compiler requires its source/material proof and rejects unused or unsupported contour declarations. Independent receipt comparison repeats actual-versus-expected checks rather than accepting a worker flag.

These source probes use explicit fixture-only request/capsule identities. They do not create a real signed native supplement for an actual plan, extend a historical lease or reclassify a failed export. Actual signed supplier acceptance is a separate root integration requirement. The native document's broader normalization remains incomplete with known warnings; supported contour derivation is not full native acquisition acceptance.

## Executed revision 2 positives and limits

- Independently rerun focused cohort: 85/85, no skips/failures, exit 0. It includes current native normalization, source authority/binding, receipt, original CSS consumption and owned Chrome tests.
- Three original erasure cases: 3/3 rejection checks pass against revision 2.
- Actual source derivation/mutation test: pass using the preserved native file and actual current primary facts, with no candidate glyph JSON as producer authority.
- Actual native observer/AX audit: 72/72 supported source nodes pass in the rebuilt regular candidate across GUIDE, Mobile and Desktop. The owned proxy records 23 denied CONNECT and one denied foreign HTTP request, zero unexpected transport errors, and no page foreign requests.
- Candidate Vite build succeeds without installation. Bundle size is about 2.15 MB before gzip and 410 KB gzip; performance acceptance was not executed.
- Actual managed MCP package `tsc --noEmit -p packages/mcp/tsconfig.json` exits 0 with the current real dependencies and the root-integrated type bridge. This is a package type check, not a whole-source pass.

The independent revision 2 JSON receipts are `focused-r2.json` (`f2f9ebf016f139bb920c8470e6a8356b8f7e4697a6f72c08dcbbf31e100892ad`), `source-r2.json` (`ccb9e3a8aee7938c9a3de02c83c6c5ed9f89a6a98fa981f91262a20623dedbc7`), `runtime-r2.json` (`8feef551bac63c4b57a850b7498fe76780073ecff75063c5d3c93fffd5b797c2`) and the original three-case repaired rejection receipt `compositing-r2-fixed.json` (`d27d614c11fe512d71e8c91811bed0e3ff9eeaa581572ac4c561278ea695e766`). All are in the ignored independent review root and remain preserved.

Chrome runs use the installed Google Chrome channel/executable, exact owned loopback origins, before-launch deny proxies and additional context routing. Focused fixture Node fetch is restricted to currently owned local HTTP server objects. These are process-level protections, not an OS sandbox. No external Figma request or expired grant usage occurs.

The first pixel counter mistakenly treated the decoder's ArrayBuffer as a typed array. That private harness failure was corrected before the actual finding; its receipt remains preserved. The first focused run passed 59 registered tests but exited 1 because a regular copy lacked the native `kiwi-schema` CJS require path. Only that test's private dependency path was adapted to the installed native package; the production code and test assertions remained unchanged. The resulting full cohort collected 85 cases and passed. Neither preliminary run is counted as a complete pass.

## Reproduction and continuation

From native service cwd, use native Vitest with the private `focused.config.mjs`, `--configLoader native`, JSON reporter and a distinct output path. The private `native-contour-independent.test.ts` runs the exact compositing matrix; `native-real-source-independent.test.ts` derives actual cached material; `native-real-runtime-independent.test.ts` joins it to the rebuilt owned runtime and real AX tree. Regular candidate source/build work remains inside the ignored review root.

## Final revision 3 independent verification

All runs use distinct private receipts, exit 0 and have no failed or skipped assertions:

| Receipt | Actual result | SHA-256 |
| --- | --- | --- |
| `compositing-r3-fixed.json` | Unchanged five-case public regression: 5/5 | `ab3f3a96a6f9f31cc05dbf9fdfc515b5de0c2b4267837df389c1044fe6efeee8` |
| `focused-r3.json` | Focused current cohort: 86/86 | `b892f346720ee201e6a7476c5ed2b4850fb2541cdb8d75c58fe8e8547e44d4a2` |
| `source-r3.json` | Actual 53M-byte derivation and source mutation checks: 1/1 | `6023817abd651787ef17b1ea704dd31d8064d3e1091e047dd755ac0f3c988a2f` |
| `runtime-r3.json` | Actual source72 native/AX audit: 1/1 | `e3eee09178158bad4a6de41e0582142f57be79957a274c95d327651a89dec3dc` |

Runtime detail `actual-runtime-independent-r3.json`, SHA-256 `38defce1d97257381c768bb5b300e2f1bae4ccf3284007e7c4ff9c5bf51b3736`, records 72/72, 24 denied CONNECT, one denied foreign HTTP and zero unexpected errors. `r3-independent-review.json` binds the exact post-run twelve hashes and separate receipts. Earlier JSON outputs remain unchanged.

The author's revision 3 type/lint/format checks exit 0. The reviewer reran actual managed MCP noEmit after tests; that run exits 1 with one error at index.ts:713. Root had separately added its frozen optional-policy index field `nativeContourUnavailable` while managed design-capture still had supplier revision 2's constructor type. This is an unintegrated four-path policy dependency, outside the twelve-file producer. It is recorded truthfully and must be checked with the complete policy overlay; the earlier actual revision 2 package noEmit passed. No whole-source/static aggregate pass is inferred.

Root can integrate exactly revision 3 after its before-hash checks, combine the separately reviewed supplier/policy/index wiring, reconcile census/provenance and run whole/artifact verification. Root alone owns any newly authorized actual capture/coding/application journey. No complete frontend, signed actual supplement or portal acceptance is claimed here.
