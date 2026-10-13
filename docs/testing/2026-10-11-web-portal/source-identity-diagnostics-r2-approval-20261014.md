# Normal-path source identity diagnostic review

Date: October14,2026,02:50KST. Baseline Main/native source is `sha256:6f87f836d872a4ba8ab49533f6447a7c921adb6b8af3dae75ddd6241e8b8a1cb`; Main HEAD22517932 has retained working-tree changes. Read [AGENTS](../../../AGENTS.md), [service analysis](../../service-analysis.md) and [current progress](../../analysis/progress-2026-10-12.md) first.

## Demonstrated gap

Actual R5 passed all six frontend commands, three visual/accessibility screens, four workflows and1,749 consumption observations, but required live refresh failed `PORTAL_LIVE_DESIGN_REFRESH_FAILED`. C2's separate current source reads failed `FIGMA_PAGE_IDENTITY_CHANGED`. Current retained daemon logs do not identify the failed reader predicate. Existing public runtime inspection uses the portal's separate Chrome owner, whose current source authorization is unproved. The daemon exposes capture/status/close, with no public precise source observer. Root did not use an external browser or private live accessor to substitute for that missing capability.

## Frozen R1 review

Manifest `.worktrees/_cache/source-identity-phase-diagnostics-20261014/freeze/frozen-files.json` is `364f052d679101a8cd6ad4f4230930b81eea891aa343207d563e37c466e184e3`. Implementation receipt is `9ca2bc1733679fd71121e15545f08575d06472a8e93ece302c6a563816cfceba`. Two production files and two new test files change. Root read the complete production diff and both test sources without repeating tests.

The reader retains URL/file/API/page/scope/envelope guards, evaluation order, original deadlines, cleanup and the public error code/message. Branch-specific fixed markers distinguish URL phases, runtime file keys, API/page object replacement and envelope mismatches. The locally compiled closed reader expression remains the only executable page program; caller queries remain JSON. The logger accepts only the fixed phase names. Dynamic keys, URLs and private messages do not enter log values.

The native refresh catch logs the actual safe `PortalCaptureError` stage/code/type/duration and sanitized error chain, then preserves the failed required acceptance check. It does not supply capture authority, retry the source or convert a blocked candidate into a pass. The existing logger projects stage/type hashes where labels are not allowlisted. No public schema, Page accessor or remote socket is added.

The author reports three new written-log cases passed, exact lint/format passed, and no old test repeated. Test type annotations were added after those passes, so final affected typechecking remains required. The author's generated catalog is fixture-only; Root must regenerate the final catalog from the integrated source. These synthetic checks do not identify the historical live failure cause or establish complete frontend acceptance.

## Requested correction and continuation

Root requested explicit resolved-path containment before the new tests recursively remove their temporary directories on Windows. R1 cleanup used mkdtemp but lacked the required target check. Preserve its passed assertions and R1 freeze; freeze the corrected test-only delta separately. Production guard behavior is approved pending that correction and exact final hashes. Main/native integration and runtime deployment have not occurred.

At02:51KST Root reviewed corrected R2 manifest `6c9ede4b418d69d19602ae40c8d72afd09e1396f289f8f83d719a9d7778f7cc7` and receipt `c08f81b6613090dceb236604e7e6fbba929f71df40c4a72219357ad324f32467`. Production hashes remain unchanged. The two tests now verify original bigint root/parent identities, canonical root path, exact parent and owned mkdtemp basename before recursive removal. This closes the requested containment check; it is same-owner protection, not an OS sandbox or an atomic defense against another process. The passing log assertions were not repeated. Root approves exact R2 integration, with final affected typechecking still owed and no live acceptance claim.

After the actual C2 source/graph boundary settles, integrate reviewed No-Core files first and then this exact diagnostic delta, regenerate derived diagnostics/provenance, run only affected static/build/package checks, and use the normal deployed service path for new source observation. Preserve the current source client/daemon until a concrete replacement boundary is chosen. The owner is absent and current native/full-screen controls are unavailable; no approval click or persistent reconnect permission is claimed. Final live freshness/application, actual C2/C3 and authorized main publication remain due08:00KST.
