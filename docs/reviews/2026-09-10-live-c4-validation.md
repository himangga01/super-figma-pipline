# Live C4 validation status

## Current conclusion

The original Figma design and its assets have been captured through external Playwright, and the C4 frontend passes local interaction and visual validation. The latest source, packaged artifacts, provenance, and isolated package runtime pass verification. The service's live `portal_plan` capture path still fails with `DESIGN_CAPTURE_FAILED`. Final candidate submission, validation, application, and applied validation are not complete.

This report covers the C4 continuation of [the active four-case plan](../plans/2026-09-07-portal-four-cases-plan.md). It does not establish production acceptance of C2/C3 or completion of every upstream adoption item. Only C4 is frontend-only.

## Verified design and frontend

- Figma file: `4IBhv1d8hEclifZQrOYxHS`, node `0:1`.
- Complete direct capture: 3,198 nodes, 11 roots, no truncation or pending scopes.
- Captured assets: 283 records. The source tree retains explicit equivalent-export provenance for 90 hidden vectors.
- Scope: nine application screens/states and two decorative primitive assets.
- Candidate: `validation/c4-20260910/draft`, 96 files and 37,467,887 bytes at this checkpoint.
- Native frontend copy: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/c4-live-20260910`.
- Latest typecheck, four cart tests, production build, and seven groups of real browser interaction checks passed. Interaction coverage includes routing, carousel, catalog search, wishlist, product options, cart quantity/persistence/focus, local checkout/contact validation, comparison, blog expansion, and mobile overflow.

The service's `assertNativePortalPreview` helper passed all nine screens and both exact decorative asset copies. All screenshots match their original dimensions; no missing placeholders or broken images were observed. The existing 3% maximum differing-pixel threshold was retained.

| Screen/state | Differing pixels |
| --- | ---: |
| Home | 2.1371% |
| Shop | 1.8309% |
| Contact | 2.0483% |
| Product | 2.1982% |
| Cart | 2.1461% |
| Checkout | 2.3041% |
| Comparison | 1.7444% |
| Blog | 2.2218% |
| Cart drawer | 2.2427% |

Evidence is in `validation/c4-20260910/visual-measurement.json`, `screenshots/`, and `native-visual-harness.log`. This is not pixel identity or a comprehensive accessibility certification. Checkout, contact, newsletter, and order behavior remain explicit local C4 demonstrations; no backend transactions or messages are claimed.

## Source verification

The final native verification copy is `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/full-source-20260910-final`. It was created as a detached worktree, overlaid with the current service source, with the staged deletion mirrored explicitly. Local independent upstream clones were used; the original `code-kb` repositories were not changed.

`corepack pnpm verify:source` completed successfully at `2026-09-10T04:03:00.499Z`:

- 321 test files passed; 3,453 tests passed and 17 platform-specific tests were skipped.
- Typecheck, lint, formatting, unused-code checks, and builds passed.
- Offline provenance, graph memory, SBOM, notices, packaging, checksums, artifact verification, and isolated packaged runtime passed.
- Source fingerprint: `sha256:117a657afaea06dc3d762ec4fc4d44f51fb0bfb39fd8a2f42d848d9b46d213a1`.
- Current staged manifest and offline upstream lock verification passed after integration.

Evidence: `validation/c4-20260910/source-checks-final.json`, `full-source-verify-final.txt`, and `full-source-verification-final.log`.

Earlier failed attempts are retained. One full attempt failed a plugin hello connection test; its isolated rerun and subsequent full runs passed. Do not replace that history with an assertion that the first attempt was clean.

The final source includes fixes for Base64 transport overhead within the unchanged one-MiB decoded inline submission budget and a bounded 64-MiB aggregate candidate budget. Regression tests preserve text/decoded limits and rejection above the aggregate cap. The real candidate exceeds the former 32-MiB aggregate cap because it includes original imagery.

## Remaining live workflow failure

The current daemon runs from the final validation copy and reports a connected Chrome transport. It was started in owned execution session `27794`; the observed process ID was `27940`. Verify current ownership before any future shutdown. The prior owned daemon was stopped; the user's Chrome and Figma tab remain open.

These final service plans did not establish live acceptance:

- `sfp_portal1_7c8542c2b9e82e250b867b50224ca62c`
- `sfp_portal1_e04d0a92ee2cd9b31c527590f637557d`

Both returned `DESIGN_CAPTURE_FAILED`, `DESIGN_CAPTURE_REQUIRED`, and `LIVE_DESIGN_VERIFICATION_REQUIRED`, with `design.complete: false` and `design.liveVerified: false`. Their evidence is preserved in `validation/c4-20260910/live/service-plan-capture-failed.jsonl` and `service-plan-final.jsonl`. A separate startup attempt received connection refused before readiness; it is retained in `service-plan-startup-not-ready.jsonl`.

Using the same retained direct Playwright page and the latest built collector, a diagnostic full tree read succeeded with 3,198 nodes and no truncation. A bounded first-asset diagnostic also succeeded and produced a 283-query queue with its first PNG captured. This narrows the investigation to differences in service orchestration, permissions/storage, or the retained service transport; it does not identify the root cause yet. Do not keep creating new Chrome connections or claim that permission denial is the demonstrated cause.

## Next required work

1. Obtain a bounded, non-secret diagnostic for the service capture exception and reproduce its actual cause. Keep the already connected Chrome transport.
2. Fix that cause and rerun appropriate regressions and source verification if source changes.
3. Create a new complete live service plan. Bind the nine-screen visual harness and both primitive asset references to that plan's captured paths and hashes.
4. Submit all actual candidate files/assets with a fresh lease and an exact native execution profile. Larger originals use captured asset references; the supplemental home banner fits the corrected inline decoded budget.
5. Pass candidate native/visual/live-design validation, apply to `C:/Users/c/Projects/SuperFigmaPortals/figma-ecommerce-c4-20260910`, and pass applied validation.
6. Refresh the candidate README's publication status and deliver final evidence. No final target application is claimed at this checkpoint.

## Constraints and retained artifacts

The latest repository instructions prohibit Superpowers skills; none were used during this status continuation. No Docker, Podman, VM, or WSL was used. New and edited Markdown is English. Native validation copies run under the same Windows account and share filesystem permissions, network access, and the process namespace; they are not operating-system sandboxes.

An earlier automatic approval review rejected deletion of a diagnostic state directory and stale port note with the reason `blocked by policy`. Those diagnostic artifacts remain untouched; no alternate deletion method was used.
