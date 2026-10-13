# Native capture availability policy and production wiring

Date: October 13, 2026 (Asia/Seoul). Author: Root. Status: frozen proposal awaiting independent review and integration.

## Baseline and purpose

Read-before authority: [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [service analysis](../../service-analysis.md), [the supplement review](native-capture-supplement-review.md) and the real Chrome exporter. Main/native source at proposal preparation is `sha256:cb669d536ff80519c1c712d25bd498134547b97ee8e26391dac6ab57f5a7c6c6`, on unchanged `main` HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with existing uncommitted work. The owner index remains unchanged. The supplier R2 and producer/compiler candidates are separate from this baseline.

The service's primary Chrome collectors can read a design even when Figma disables Save local copy. Enabling a native supplement globally without an availability policy made that disabled action fail the entire coherent primary capture. The proposed policy preserves primary acquisition while retaining strict proof requirements for native text contours.

## Implemented proposal

The private capture configuration adds `nativeContourUnavailable: 'fail' | 'retain-primary'`. An explicit enabled supplement remains required by default. Production wiring selects `retain-primary` and injects the signed-state-only `StoredNativeContourAcquisition` into native work. Profile preparation cannot start Chrome through that lookup port.

Only a genuine Error with the exact message `FIGMA_WEB_EXPORT_UNAVAILABLE` can use the optional branch. The real exporter raises this after checking that Save local copy is disabled and before activating Save. Original signal/deadline checks run before suppression and afterward. Timeouts, wrong targets, unsupported dialogs, cancellation, malformed/empty results and uncertain cleanup still fail. The capture still requires its matched post-read observations and confirmed session cleanup. A visible File menu can remain during a disabled export; this does not itself establish source coherence or cleanup.

The optional branch creates no document or signed native supplement. Primary completeness retains its original collector meaning. A later explicitly requested contour representation without exact protected native bytes remains unproven; it cannot borrow a prior capture, fabricate a capsule or count nominal CSS as painted geometry. The supplier's tracked cleanup promise prevents swallowed restoration failures from becoming successful primary publication.

## Executed checks

The regular private source copy is `.worktrees/_cache/native-policy-root-20261013/service`. It copies the supplier R2 review fixture, excludes dependency/cache/build directories, rejects symbolic links, and uses native dependencies only for read-only resolution. No installation, managed-junction build, live Figma access or state/grant mutation occurred. These are same-user native tests, not an OS/process sandbox.

- Before the policy: 23 passed and one failed. The failed case is primary retention after a confirmed disabled download.
- After the narrow policy: 24/24 passed.
- Expanded final capture/signed-lookup cohort: 45/45 passed, zero failures/skips. Empty returned exports are rejected under both policies.
- A real installed-Google-Chrome case passed. Save activation count is zero, both overridden browser hooks are restored, no export hook remains and no `document.fig` is created. Its filtered command skips fifteen existing cases; those skips are not counted as passes or a complete required-Chrome suite.
- Scoped lint and format passed. Whole/source/package/runtime acceptance is not claimed.

The real-Chrome case uses the service exporter on an owned routed fixture and `chrome` channel with the installed executable. Every unrelated page request is aborted. It does not automate native browser security approval or operate the owner's source browser.

## Exact frozen closure

Manifest: `.worktrees/_cache/native-policy-root-20261013/frozen-policy-files.json`, SHA-256 `2143aa6eee816ad50a98b365e0d0440c3b154410ea0e3d7d470d6e3d73233c84`. Its supplier R2 dependency is `31720871a4f6547e6b464e744bfc04f2f79162794b3d782e6ae72e9dd8d9ec14`.

| Path relative to service | Expected preimage | Proposed SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/design-capture.ts` | Supplier R2 `42d22b1d...` | `6278899c421059366780405fd801143981e9e377b38b9a86d58c983a0853ce57` |
| `packages/mcp/test/portal/capture-coherence.test.ts` | Supplier R2 `afb9a992...` | `2bdd186338eae1b3f7aa2e8cfa8c81572d5bee90a498fdb1b5da7fbdb02bb2ab` |
| `packages/cli/test/figma-web-export.test.ts` | Main/native `0365ba6a...` | `c40f351b5566386e5fbfbe13e842a35f4d0de12ce239bc186e839247f08039ea` |
| `packages/mcp/src/index.ts` | Main/native `74ac932d...` | `a1ac55dc67da5c9345a7b1dcf66a5d856f625707ebd544b896727006411f324b` |

The index is an explicitly owned managed proposal; the other three files are private regular-copy proposals. Main/native production source has not received this closure. Integration must apply supplier R2 first, then exactly these dependent deltas and the separately reviewed producer/compiler versions.

## Continuation and verification limits

The independent reviewer must rehash the frozen closure and run the exact unavailable, fatal-error, cleanup/cancellation and installed-Chrome cases. Then combine source/provenance/catalog/required-suite changes and run a fresh whole/artifact check before controlled actual deployment and admitted Figma capture. A successful primary capture without native bytes is not contour, generation or application acceptance. Official MCP live verification remains owner-deferred; CDD must finish before the final eCommerce test. No original deadline or unknown outcome is reset.
