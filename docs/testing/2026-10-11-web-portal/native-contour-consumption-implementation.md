# Native contour consumption and materialization

Date: 2026-10-13, Asia/Seoul.

## Purpose and baseline

The service must distinguish text painted with independently captured native glyph contours from text painted by a CSS font. The CDD renderer diagnostic showed that original contour geometry fixes the residual mobile visual failure, but a candidate-owned JSON document hash and an unused nominal CSS font do not establish source consumption.

Read-before references are [the fresh candidate analysis](cdd-fresh-candidate-readiness.md), [the renderer diagnostic](cdd-residual-renderer-diagnostic.md), [the independent review](cdd-residual-renderer-review.md), the canonical [service analysis](../../service-analysis.md), project [instructions](../../../AGENTS.md), and the shared analysis policy. Earlier OAuth, packaging and renderer freezes remain historical evidence.

The implementation is managed-only. Its exact before/after manifest is `service/.cache/native-contours/frozen-files.json`. The before hashes identify read-only Main files at private fixture preparation; the fixture overlays only nine owned production files and three new test files. Main, its native dependency tree, existing source Chrome, actual jobs, grants, leases and application outputs were not changed by this implementation.

Current visibility R3 managed manifest SHA-256: `7e3126bc3a5d6410a9c17fd5a608068366b2634de9de0785dd4889204d3bc634`. R2 `1369c296f93b5dccf341013deb94c6e296932d6a4259c61fe55afd8d2967f78c` and the earlier author freeze `538ac2ac4a2d239e38f4f6cca8ae3bf0a52d0720d483babbaa8634738c0fa307` remain preserved with their independently found visibility failures. Earlier internal font-guard failures are separate historical evidence.

The real read-only source evidence remains Figma file `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`, independently captured 192 nodes, and the 53,197,880-byte native document with SHA-256 `d2b8c94ced03a2e82bc8e39343f705a4aa8ece48fea882f0ac9ab0bf0abd573b`. The primary recorded facts hash is `e507e647d9b5f9f4ff4871a15ef9ecec465c5039da39fbfa6c50893a78125ecb`. This is scoped supplemental native evidence, not a claim of full native capture.

## Implemented architecture

| Owned production path under service | Implemented responsibility |
| --- | --- |
| `packages/shared/src/portal-native-contours.ts` | Strict expected and actual painted-contour schemas. API nominal font size remains separate from native painted sizes and native font digests. |
| `packages/shared/src/portal-consumption.ts` | Explicit `native-contour` expectation and optional actual contour observation. Existing consumption kinds keep their contracts. |
| `packages/shared/src/portal-recipe-use.ts` | Optional declaration `nativeContours: [{nodeId, representation: 'native-contour'}]`. It contains no caller source proof. |
| `packages/cli/src/figma-native-nodes.ts` | Optional TEXT observer after existing effective instance and override expansion. The returned public node schema is unchanged; observer snapshots cannot modify it. |
| `packages/mcp/src/portal/native-contours.ts` | Internal lookup contract, source scope validation, independent byte hashing/native decoding, scoped source join, branded expectations, and independent receipt comparison. |
| `packages/mcp/src/portal/recipes/consumption-input.ts` | Owner/current candidate/source checks, optional lookup-only source port, unchanged original run/effect deadline, recheck after lookup, and native source binding in material hash. |
| `packages/mcp/src/portal/recipes/core-consumption.ts` | Explicit representation compilation and source/material proofs. Contour text is checked through its actual painted geometry instead of claiming that nominal CSS font properties paint it. Missing source produces a typed preparation requirement. |
| `packages/mcp/src/portal/preview-native-contours.ts` | Isolated Chrome-world path, transform, paint, visibility and accessibility observation, including native Accessibility tree proof. |
| `packages/mcp/src/portal/preview-consumption.ts` | Integration into the existing source visibility, route/state, repeat observation and authenticated native receipt workflow. |

Root and the acquisition reviewer own actual coherent-capture supplement acquisition, protected storage, index construction, NativeWork dependency wiring, public inventory and Chrome census. Those changes are disjoint and are not claimed as executed by this report.

### Internal source port

`PortalNativeContourAcquisitionPort.read(request, signal)` is lookup-only. It must never start Chrome during read-only profile preparation. The request contains `ownerId`, `workspaceId`, `planId`, the full `PortalCaptureDescriptor`, `primaryCapturedAt`, and the original retained `deadlineAt`.

The returned internal capsule contains version 1, those identities, `fileKeyHash`, actual `pageId`, full `scopeId`, `captureFingerprint`, `reobservedCaptureFingerprint`, native `capturedAt`, exact `primaryCapturedAt`, `documentHash`, and `documentBytes: Uint8Array`. It is not a public JSON or arbitrary-path API. Acquisition belongs inside the previously admitted coherent source capture, with its original permission, signal, deadline and browser resource. The port receives the signed/protected outcome of that operation.

The producer uses `capture.designFingerprint`, the same canonical identity as the existing consumption batch. It parses the full scope JSON `{requestedNodeId, pageId, scopeNodeId}`. The scope is not a page ID string. It normalizes the actual page, projects an exact requested subset when necessary, and rejects unrelated retained nodes, changed parent/child order, characters, dimensions or unsupported transforms. Capsule identities, full scope, both fingerprints and primary capture timestamp must match. Native time must be finite and no later than the primary capture time; primary capture time must be no later than observation time. It hashes the actual bytes and uses the existing bounded native decoder.

One complete source-observed text range and one matching native font metadata record are required for each supported TEXT node. A top-level API `fontName: 'mixed'` sentinel is accepted only when that one complete range proves an unambiguous family/style/weight. Other unknown values, mixed ranges, unsupported decorations, affine scales, rotations or paint forms fail closed. Each native commands blob is independently decoded and hashed. Only leading empty native `Z` closes are removed before SVG painting. Empty glyph contours produce no path. Malformed streams cannot fall back to inferred fonts.

Expectations retain source character hashes, font digests, native commands hashes, exact serialized path hashes, glyph matrices, dimensions and source paints/effects. Aggregate limits apply before expansion: 65,536 glyphs, 16 MiB path text, and 2 MiB expected records. Neither file nor public submission batch limits were increased.

### Runtime and receipt checks

The observer uses a Chrome isolated world so candidate prototype replacements cannot forge DOM/CSS reads. It verifies one SVG and its actual paths, rejects hidden/empty geometry, extra text/image/use/foreign content, clipping/masking, unsupported fill/stroke rules and changed transforms. It checks computed CSS `d` too, because a stylesheet can alter the painted path while leaving the `d` attribute unchanged. Browser numeric serialization is compared within explicit floating-point tolerances; the original attribute bytes still must hash exactly to the decoded source path.

Computed fill, stroke, outside stroke width and order, opacity and whole-SVG shadow filters must match source-derived expectations. Disabled stroke width is not falsely treated as painted geometry. Chrome's equivalent computed `paint-order: stroke` serialization is recognized for the requested `stroke fill` order. The observation must have a visible native Accessibility tree image node with the source text as its accessible name, connected to the title of the actual painted SVG. Hidden ancestor semantics and inert controls are rejected.

Existing source visibility/hit tests and route/state bindings surround observation, and the contour snapshot is repeated before publication. The authenticated receipt verifier independently compares the actual observations against the server-derived expected batch. A worker success flag, caller document hash, CSS font availability, source data attribute, or unattached title is insufficient.

## Executed verification and preserved failures

The private fixture is `.worktrees/_cache/native-contours-production-20261013/service`. Dependencies are read from the separately installed native dependency tree. No install or build ran through managed junctions. Tests use the installed Google Chrome channel, owned loopback fixtures, and no source Chrome or external acquisition. This is the same Windows user, not an OS security sandbox.

- The old consumption schema and old normalizer hook were restored only in the private fixture. The new 27-case suite then passed 20 and failed 7. `baseline-old-contract-hook.json` retains that failure; revised files were restored afterward.
- A late overstrict object-only top-level font guard failed the actual 53 MB source probe because all 72 recorded API nodes use the mixed sentinel while their complete ranges are unambiguous. The provisional R1 manifest/source and failure are preserved under `service/.cache/native-contours/`. A dedicated failing regression was executed before the guarded mixed-sentinel repair.
- Final focused verification is 84/84, zero skips: 28 new tests plus 56 existing consumption, receipt and native normalization tests. MCP TypeScript, scoped lint and formatting passed. The new browser file contains two required Chrome tests; root must update the required-suite census.
- Independent native decoding joined all 192 actual current records and produced 72 expected contour records with four retained native font digests. The two nominal/native discrepancies remain explicit: `9.858333587646484` versus painted 14, and `8.449999809265137` versus painted 12.
- The real-source runtime probe initially passed 70/72 Accessibility tree checks. Both email placeholder SVGs were under `aria-hidden=true`. The new diagnostic copy removes that ancestor attribute. Preserved before and after receipts now show 70/72 and 72/72 respectively.

The real-source fixture uses actual native bytes and current source facts, with test-only plan/capsule identities and deadline metadata. It is not a signed actual portal supplement or a renewed execution authorization.

## Deduplicated candidate diagnostic

The new copy is `.worktrees/_cache/cdd-residual-renderer-20261012-1791816229882-deduplicated/work`. The original 44-file candidate, old 45-file diagnostic and earlier frozen 46-file proposal are preserved. Its manifest is `frozen-deduplicated-manifest.json` in the new root.

Contour resources now store 438 source-derived IDs once, with 1,594 compact instance references across 72 nodes. Each ID binds font digests and exact commands/path hashes. The JSON shrank from 2,455,656 to 933,070 bytes. Full expanded glyph properties, visible path hashes and transforms remain unchanged. The decoder rejects missing, invalid and out-of-range references. All 29 diagnostic parser, binding and resource tests passed.

The final full service Chrome visual comparison retains the original 1% threshold, pixelmatch mode and fresh page-API PNG oracles. GUIDE is 0.0303088310%, Mobile 0.8018613154%, and Desktop 0.3747555284%. All three actual screenshot and diff hashes are identical to the preceding contour diagnostic. There are no masks, threshold changes, guessed font sizes, pixel nudges or oracle substitutions. Forty-three original runtime files are unchanged; only the renderer and the two contour modules differ. The rebuilt bundle is still approximately 2.15 MB and has not passed a performance acceptance gate.

Four unchanged captured source assets exceed the direct 1 MiB file submission limit: `10-3388ddf75bdd0ed3.png` is 3,883,850 bytes; `11-1974c87502444cbb.gif` is 3,898,709; `3-a8531e6eef7b9f97.png` is 5,411,853; and `4-bedd9dc953baee11.gif` is 2,920,353. Their original hashes and bytes remain intact. Root must use the existing service-owned captured-asset materialization path or repair a missing public path. This report does not claim all 46 runtime files can be submitted directly. Changed code/data files fit the existing limit, and aggregate `args.files` batches must still remain at or below 1 MiB.

## Continuation and verification limits

### Independent P1 and visibility R2

The independent reviewer proved that the visibility R1 observer accepted entirely invisible contours. An ancestor `filter: opacity(0)`, ancestor `opacity: 0.0001`, and an opaque same-target `::after` overlay each produced zero nonwhite screenshot pixels while the public consumption observation still returned `passed: true`. The prior source, manifests and independent receipts are preserved. Reviewer receipt hashes are `64ad14326340f92143512df805bfffa4b653996bb867c3308e737386400f7941` and `649e06b2bfd2836e604539f44c8906e97c0c1307209773175aeeb4f0079dc6b4`.

Root authorized a revision of only `preview-native-contours.ts`, its Chrome test and this report/freeze. The new exact triangular fixture uses an owned proxy that forwards only its loopback origin and denies external HTTP/CONNECT. It passed two old cases and failed the new zero-pixel/public-rejection assertion on R1. The repair now traverses the complete ancestry through HTML, including outside the source root. It rejects filters other than the independently matched SVG filter, unsupported backdrop filters, mix blending, masks, legacy clips, unproven ancestor opacity, and visible generated before/after paint. The declared SVG/target opacity and SVG source shadow remain independently compared against expected paint. No broad ancestor-filter exception was added.

All three unchanged reviewer erasure forms now give `passed: false`; the regression first establishes actual baseline pixels and their disappearance. Screenshot pixel counting is a test witness, not a new production threshold or mask. Other unsupported ancestor paint mutations are rejected too. Final focused verification is 85/85, zero skips, with 29 new tests plus 56 existing tests. MCP noEmit, scoped lint and formatting passed. The final source-derived runtime/AX probe still passes all72 current nodes, including their source shadows. Three tests in the browser file now require Chrome, replacing the earlier count of two. Ten other producer files, the supplier, C3 compiler and index source were preserved.

The R2 freeze has exactly the same12-file scope, with only observer and browser-test hashes changed. Its author pass did not substitute for independent repetition, recorded below. This representation currently does not prove arbitrary ancestor filters or pseudo-element paint from Figma. Such designs must remain blocked until a separately source-derived representation supports them.

### Independent partial clipping and visibility R3

Independent R2 repetition confirmed that the original three erasure forms are rejected, and independently repeated85/85 author tests. It then found partial clipping: an ancestor10-by12 box with `overflow:hidden` reduced actual pixels while the public proof still passed. An `overflow-x:hidden; overflow-y:visible` variant computes the mixed shorthand `hidden auto` and also passed incorrectly. The failed receipts are `dffea322f0b41697983fe89ffe786dc37a214af378984dcb28c133c6c0e10978` and `a9d280e278685e4699c5b29f9b9e99be4e8443510a2aa2389936179a3ddb009c`.

Root authorized the same two-file R3 revision. The observer now handles each overflow axis independently and requires full path containment. It additionally measures the aggregate observed path paint, including native stroke and supported own-SVG drop shadows, in isolated native Chrome Canvas. This draws the already observed path geometry/styles into bounded transparent surfaces without modifying page geometry or fonts. Alpha bounds must be finite and clear of the surface edge before they can support containment. Unknown filters, transforms, unsupported stroke rules, unbounded/empty paint and capacity exhaustion fail closed. A path box alone is never reported as the complete stroke/shadow paint extent.

The raster pass is bounded to five attempts,8192 maximum dimension,4,194,304 pixels per surface, and device scale at most4. It supports only the independently matched native path paints and closed drop-shadow subset. It does not infer a Gaussian tail bound, waive parent clipping, change the source geometry, or use an acceptance mask or source-image substitute. CSS border edges are excluded from the clipping padding box. Source-unsupported ancestor transform/zoom/clip margins stay blocked.

SVG screen origin must match its actual viewport, preventing an unproven shifted viewBox from retaining correct local path matrices while moving paint elsewhere. The first strict float-to-CSS viewport size comparison rejected17 otherwise supported source nodes. That55/72 receipt is preserved. The corrected comparison accounts only for Chrome's1/64px CSS layout quantization of the unchanged native SVG attributes. Native coordinates and full visual criteria are unchanged.

The unchanged partial/per-axis pixel witness fails against R2: three browser tests pass and the new fourth fails. R3 passes4/4, including supported shadow paint with sufficient containment and rejection when only its shadow is clipped. Final focused verification is86/86 with zero skips,30 new plus56 existing cases. MCP noEmit, scoped lint and formatting pass. Final actual current-source runtime/AX verification is72/72, including the known source shadows. The required Chrome file now contains four tests. Source/test hashes are `93eb96c53c7f85f9625912a1c23b5877f6ce21aacb055bdee0b6a7e7456b0f3c` and `76f84fc168d443397c44198cc8ac6c2c1bee0b75e514843670dfe1de215f20ba`. Other ten producer files and all supplier/compiler/index files are unchanged. Independent R3 replay is pending.

The subsequent independent reviewer approved exact R3 `7e3126bc3a5d6410a9c17fd5a608068366b2634de9de0785dd4889204d3bc634` after rechecking all12 hashes, unchanged public five-case visibility/clipping probes5/5, the full focused86/86, actual53 MB source derivation1/1, and actual runtime/native Accessibility tree72/72. Independent aggregate receipt SHA-256 is `2cdeef7a58e02a1e42adca880bc7ccb7e8f197c4d8951d557b43e2c12a289309`; review report hash is `a8f27d7786d6a04a0ff8b93f29b4d9192324db3539aa0687b9163a257522a4a8`. R1/R2 failures remain historical. Root then integrated the reviewed producer/supplier source; actual fresh source/application acceptance remains separate.

Root subsequently verified the existing public `capturedAssets` submission path: the coordinator reads the exact protected captured asset with its recorded source hash and byte count. The four unchanged large diagnostic assets can use that path while code/data use bounded `args.files`; no direct oversized file or re-encoding bypass is required.

The producer/compiler/observer implementation is reviewable in the managed freeze. Root must integrate the separately owned acquisition and NativeWork wiring, verify the whole source/artifact gates, and collect a fresh admitted source capture with its protected native supplement. A current run captured by the old runtime has no such registered supplement. It must not borrow this candidate's JSON or the historical `.fig` capsule to manufacture source authority.

Actual fresh candidate submission, profile execution, complete interaction/accessibility acceptance, guarded application and final frontend completion remain unexecuted here. No old deadline was reset and no grant was renewed. Official live MCP is owner-deferred and is not a new gate for this Chrome repair. The recorded browser checks are bounded snapshots with repeated identity checks, not atomic protection against arbitrary same-user filesystem/process changes. Main and actual runtime operations remain root-owned.
