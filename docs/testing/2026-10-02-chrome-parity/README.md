# Service-owned Chrome acquisition parity

Date: October 2, 2026 (Asia/Seoul). Status: implemented collection and comparison are under acceptance; no generated frontend or final eCommerce acceptance is claimed.

Later evidence: the [October 3 approval follow-up](../2026-10-03-chrome-initialization/README.md) records a failed portal initialization despite the earlier `connected` socket status, the readiness-diagnostic repair and its newer source checkpoint. The connection statements below describe the October 2 observations.

## October 4 continuation

The [CDD generation record](../2026-10-03-cdd-generation/README.md) now contains repeated live Chrome/Scripter capture, native text-layout supplementation, a passing candidate, guarded application and passing applied runtime checks. The final applied source-freshness check failed while the repaired daemon awaited manual Chrome admission, so complete CDD acceptance is still not claimed. The other acquisition methods and final eCommerce obligations remain open.

The standalone attach-only CLI now scopes its Playwright view to the selected Figma file, including nested frames, and releases its private transport without closing source tabs. A real-Chrome regression failed before this repair and all 29 related cases passed afterward. Explicit missing-tab opening still uses the prior direct path. No new live plugin-free export was executed during this continuation; the October 2 recorded `.fig` remains supplemental.

The [native catalog diagnostic](native-catalog-gap-20261004.json) found 39 active paint records, 16 active text records and one active effect record in that independently exported document, excluding 27 soft-deleted styles. Current production normalization does not yet expose those catalogs. Native GUIDs differ from the Plugin API's opaque style keys, so matching catalog counts do not prove value or identity equivalence. Further implementation must preserve native identities, normalize recorded values independently, handle ambiguous matching explicitly, and compare complete catalogs without copying Plugin API data into the native collector. Catalog values, variables, prototype semantics and independent SVG/root-PNG exports remain required before native portal admission can be called complete.

## Required continuation

Finish the CDD file `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`, including generation, visual/interaction repair, guarded application and applied validation. Preserve the other required case, capability and review gates. Then execute the [final eCommerce acceptance](../2026-10-02-final-figma-preparation/README.md) against `4IBhv1d8hEclifZQrOYxHS`, page `0:1`, with new frontend outputs and no reference frontend code. The official-MCP path remains required. The owner explicitly reconfirmed this sequence during this work.

Every executed browser acquisition in this restart uses the service's CLI/Playwright implementation. No Codex browser controller or external connector supplies acceptance data.

## Actual independent inputs

- Plugin-free input: `chrome-export` drove Figma Web's File > Save local copy operation through the authorized existing Chrome. It captured a 53,149,390-byte `.fig` document at `2026-10-02T09:09:38.653Z`, SHA-256 `ca1dca0ab07b4ab659c34fb3b678eec45aee9879e8d8ef7553d051d864f0a8d5`. The artifact is retained at `.worktrees/_cache/live-cdd-2026-10-02/ly06O8jAcrd7oWmwhz5Vr6-1790932041118-d4f16254/document.fig`. The original UI export remains unchanged.
- Scripter input: `chrome-inspect` captured 192 nodes, three roots, no pending scopes and 25 captured assets. The complete artifact folder is `.worktrees/_cache/live-cdd-2026-10-02/ly06O8jAcrd7oWmwhz5Vr6-1790932664262-ff8940ed`.
- The roots are GUIDE `1381:285`, Home / Mobile `1381:530` and Home / Desktop `1381:541`. The native archive includes the whole document; comparison selects the requested page and expands referenced component instances without reading values from the Scripter result.

These are separate, ordered observations. They do not establish an atomic document version or a fresh reread after every later code change.

## Implemented changes and measured repairs

The service's Scripter selector incorrectly assumed an old resource-image query parameter. Actual failure diagnostics showed the installed plugin using Figma's current signed CDN path. The service now recognizes the pinned plugin ID in that observed path and avoids closing an already-open search panel. The live Scripter collection succeeded after this fix; network blockage was not assumed.

The plugin-free exporter retains the actual download Blob because Figma revokes its URL immediately. It restores temporary browser hooks on both success and failure. Transport chunks are bounded and use verified Base64 encoding; the multi-chunk path has an installed-Chrome regression test. The optimized transport has not yet received another live export acceptance.

The native decoder reads bounded ZIP entries, validates paths and CRCs, decompresses native deflate/Zstandard chunks, and interprets the embedded Kiwi schema without compiling document-supplied JavaScript. The tested document is native format 106, with 648 schema definitions, 3,798 records and 45 archive entries. `kiwi-schema` is pinned to version `0.5.0`.

Component references and overrides are expanded into the same 192 visible-scope node IDs as the Plugin API capture. Initial direct traversal found only 12 stored records including the page; those were references, not proof of missing source data. Ordered instance overrides, bound styles, group coordinate conventions, animated-image references, implicit primitive outlines and vector path decoding were added or corrected from the native input.

The initial 5,406-position comparison had 2,161 differences. Repairs reduced the retained core differences to 73. The comparison was then expanded to 6,006 positions including paints and geometry; it still reports the same 73 differences, with zero missing or extra node IDs. Geometry comparison accounts for equivalent closed-path start points and redundant collinear vertices, with explicit numeric tolerances. Unsupported path syntax remains a mismatch.

- All 72 independently resolved uniform font ranges match the Scripter text ranges. The API's node-level `fontName` reports `mixed`; the native resolver reports the concrete font. Those 72 raw property differences remain recorded.
- One remaining `strokeWeight` difference belongs to a node whose two recorded paint lists both contain no strokes. The raw discrepancy remains recorded and must not be generalized to future interaction states.
- All ten original image byte hashes match. Native paint conversion preserves the actual animated image reference instead of substituting its poster image.
- The three root PNGs and twelve SVG assets still require independent plugin-free export/render acceptance. Matching original image bytes is not complete asset acceptance.

The [initial retained core comparison](core-comparison.json), [expanded geometry comparison](comparison-6006.json) and [latest checkpoint comparison](comparison-checkpoint.json) preserve the measured differences. The final checkpoint records explanations for all 73 retained discrepancies within the declared fields; this does not establish equivalence of unexamined properties or future states. CLI outputs deliberately retain `fullCaptureAccepted: false`. Layout/catalog/prototype coverage, full text-range semantics, native-pipeline admission and frontend acceptance remain unfinished.

## Desktop and service connection status

`desktop-prepare` prepared the service's compiled local development-plugin bundle. Its [preparation proof](desktop-bundle-proof.json) records the actual manifest/code/UI hashes and loopback-only network allowlist. It contains the service's fixed Plugin API reader/exporter and does not require the remote Scripter editor UI. This is the existing service plugin, not a claim that the complete upstream Scripter editor has been bundled. Desktop import, pairing and live Desktop acquisition have not been executed.

The source CLI repeatedly connected and collected successfully. The separate retained daemon connection still reported `awaiting-browser`. Public portal plans `sfp_portal1_0e990934be9a52484854ca21c9b19e9c` and `sfp_portal1_7afc6d75daf01c266dc96fdc5e879113` returned incomplete plans after 300,012 ms and 300,014 ms respectively. Planning success is not capture success. The relay now preserves the authenticated Playwright client's User-Agent while withholding private authorization and cookies; controlled tests passed, but this did not establish resolution of the live permission wait. Browser security approvals remain manual.

The native test daemon uses the explicit state location `.worktrees/_cache/cdd-native-appdata` and the existing source Chrome profile. It runs as the Windows owner and is not an OS filesystem/process/network sandbox. The earlier default packaged-host state-path mismatch remains a separate unresolved issue.

## Verification boundaries

The [first focused report](focused-tests.json) records 47 passes. The [expanded local run](expanded-tests.json) recorded 58 passes with no failures or skips across the declared test-file arguments, including real installed-Chrome export and Scripter-UI fixtures. CLI/MCP typechecks, scoped lint and builds were executed during the repair loop. These are focused checks, not the M15 full source/package matrix or M17 final review.

The [source checkpoint](source-checkpoint.json) binds matching main/working-copy fingerprints to `sha256:f281c240ca5dc7eb62b2eacaff12c9fe784d83543483ca0fa577661d2844597d`. Dependency notices and SBOM were regenerated for 63 installed production packages. Bounded reconciliation passed with 296 changes and 178 retained forks; offline provenance verification passed for all three pinned upstreams and 238 vendor rows. The main Git index remains unchanged. A rejected overlong review reason and carried-index reconciliation attempts remain in the task cache; no validation rule was weakened.

Final full checks and review remain required. The earlier complete M15 result applies only to its earlier frozen source. No candidate frontend, applied frontend, completed case matrix, final eCommerce acceptance, remote CI result or release has been produced in this restart. The [last daemon status](daemon-status.json) records the distinct retained connection still awaiting browser admission; the owned daemon remains available for that manual step.
