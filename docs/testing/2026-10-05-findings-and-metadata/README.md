# Review findings and native metadata fields

Date: October 5, 2026, approximately 20:00–21:30 KST (Asia/Seoul).

- **Baseline:** `main` at `6459363`; source `sha256:62023ddd...` before these changes.
- **Request:** the owner asked to proceed with only items 4 and 5 of the [implementation summary](../../service-analysis.md#implementation-summary-at-1957-kst-on-october-5): the independent native collector, and the open review findings with the Windows authorization load.
- **Result:** after the changes, both service copies match at `sha256:eb9c2c5c5369df4c75ce6050b1484a4ccf4252528e4583741039e154d120d602`. At the owner's later request, the changes were committed and pushed on `main`, with service tree `1cff1731...` matching the verified review index.

## Environment

The validation copy deleted earlier in the day was recreated as a detached worktree at `6459363` (`.worktrees/baseline`).

- Dependencies were installed with `pnpm install --frozen-lockfile --ignore-scripts` and the copy was built.
- Changed files were synchronized from the main checkout before each run.
- Tests ran there with one Vitest worker.
- Free memory was 2.8–3.4 GB, so no whole check was attempted.

This is a same-owner native working copy, not an OS sandbox.

## Review findings (item 5)

Each repair has a regression that was run against the unrepaired code first and failed for the intended reason ([red runs](red-tests.json)). F10 is a refactor; its guard passes before and after.

| Finding | Repair |
| --- | --- |
| F5: a malformed native style row aborts node comparison | `normalizeFigmaNativeStyles` now excludes rows that lack an identity or a name, or that share an identity, and lists them under `invalid`. The rest of the catalog and the node comparison continue, and `chrome-compare` reports `invalidNativeStyles`. |
| F4: re-observation shares the 256-call cap | Each snapshot pass has its own 256-call budget, matching the existing per-pass byte budget, with at most 512 calls overall. A first pass above 128 calls can now be reobserved. A first pass that exhausts its own budget still stays incomplete. |
| F9: the freshness proof re-hashes both full captures | `provePortalPngReexport` no longer re-verifies both whole captures. Its callers already verify them: native work checks the refreshed capture just before the proof, and `assertCapture` checks the original before and after it. The proof still re-reads and re-checks every differing PNG it compares, and a changed byte still throws `PORTAL_CAPTURE_ASSET_CHANGED`. |
| F10: the v2 fingerprint formula is duplicated in `ir` | `portalDesignVersionFingerprint` and `portalCaptureAssetFingerprint` now exist once, in `ir`. The mcp capture descriptor and the proof verifier both use them. A guard covers a non-null export origin and mixed PNG and SVG rows. |

### Windows authorization load

On Windows, every control request verified the credential state twice on each side, and each verification started a new `whoami.exe`. Monitoring polls make two requests every 300 ms. Two reductions were made:

- **Process SID cache.** One state-permission authority resolves the process user SID once and reuses it, because a process token user cannot change. A failed lookup is not cached, so the next check retries and still fails closed. This removes about four process starts per control request.
- **Slower steady polling.** Monitoring polls every 300 ms for the first 5 seconds of an operation, then once a second. This cuts steady-state requests, and the daemon ACL probes behind them, by about two thirds.

Reusing verified credential state across requests was not attempted, because it would widen the time-of-check window.

## Native metadata fields (item 4)

`service/packages/cli/src/figma-native-metadata.ts` adds 23 declared comparison fields. The rules were first checked against both references and the native records:

- **Style identifiers** (fill, stroke, effect, grid, text): an imported style reference carries its library key and version, and maps exactly to `S:<key>,<version>`. All 13 matched eCommerce library styles agree. Local styles carry no native key, so their identifiers stay unknown rather than being taken from the reference. Run-level, inherited and text-style-overridden references also stay unknown.
- **Grid auto-layout** (12 fields): Figma defaults are used outside native grid layouts. Neither design uses grid auto-layout. Grid containers, their children and any native grid field stay unknown.
- **Variables:** bindings and explicit modes are empty only when the node has no native variable data. Resolved modes are empty only when the document has none.
- **Annotations:** empty only when none are recorded.
- **Export settings:** PNG, JPG and PDF settings with scale constraints are converted. `useAbsoluteBounds` appeared in the reference for the one observed text node and for none of the 16 other nodes, so it is reported for text nodes only. Other forms stay unknown.
- **Export settings in instances:** the first real comparison showed 19 differences, all on nodes inside instances, which had inherited their main component's settings. A regression then failed first. Instances now report only their own settings, and instance sublayers report none, unless an override sets them, which stays unknown.
- **Arcs:** recorded ellipse arcs, or the full-circle default.

Values the normalizer cannot determine are listed in the node's `nativeUnknownFields`, with warning `NATIVE_METADATA_UNSUPPORTED`. `compareFigmaCaptureNodes` counts those positions as **unobserved**. They are neither compared nor treated as matches.

### Actual comparison

The comparison used the same separately collected inputs as the October 4 increments ([checkpoint](comparison-checkpoint.json)):

| Scope | Fields | Positions before → after | Raw differences | Unexplained | Unobserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| eCommerce | 87 → 110 | 156,995 → 204,255 | 408 (unchanged) | 0 | 10 |
| CDD | 87 → 110 | 11,244 → 14,128 | 77 (unchanged) | 0 | 383 |

The unobserved positions are:

- **eCommerce:** local style identifiers (9 fill, 1 stroke).
- **CDD:** resolved variable modes (192), because the document contains variable data; local style identifiers (116 fill, 57 text, 7 stroke, 6 effect); four nodes with native variable data; and one export setting from an instance override.

`fullCaptureAccepted` remains false.

### Remaining coverage

The [inventory](uncompared-node-fields.json) lists 12 reference fields outside the 110 compared fields:

- **Component semantics:** component properties, variant properties, main component, component API, property definitions and description.
- **Geometry:** render bounds, vector paths and vector networks.
- **Collector data, not design facts:** `collectorCapabilities` and `geometrySource` describe the Scripter collector, and `textSegments` is already compared through resolved font ranges.

Independent SVG and root-PNG exports and native capture admission also remain. They need a live Chrome session with the owner present.

## Verification

- **Focused tests:** CLI 60/60, MCP 51 with one existing skip, IR 5/5. Wider related runs:

- CLI 185/185 across 23 files.
- MCP portal capture and security: 238 passed, with one existing skip. Two follower-transport structure tests failed only because they were run from the package folder; from the service root that file passed 74/74.
- IR 11/11. See [all runs](tests.json).
- **Static checks:** typecheck passed for `ir`, `cli` and `mcp`; scoped oxlint and oxfmt passed; knip passed.
- **Provenance:** a new slice, `review-2026-10-05`, passed: 23 fork changes, 178 forks, 21 manifest changes, 4 authority paths. The offline upstream lock passed in both copies, and the owner index is unchanged ([checkpoint](provenance-checkpoint.json)).
- **Provenance attempts:** a new slice has no manifest yet. The first attempt stopped on the missing manifest, and the second on a stale review baseline after the manifest registration. Neither changed a reserved authority file.
- **Whole check:** not run, so this source is **not** whole-check verified. That check needs the owner's approval and about 6 GB of free memory.
