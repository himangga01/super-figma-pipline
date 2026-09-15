# Live Chrome capture and native validation continuation

This bounded continuation implements the live C4 acceptance work in [the active four-case plan](2026-09-07-portal-four-cases-plan.md). It does not replace the broader remaining scope.

## Global constraints

- Only C4 is frontend-only. Legacy and reference cases retain every required service layer.
- Use external Playwright and the authorized Figma file `4IBhv1d8hEclifZQrOYxHS`, node `0:1`.
- New Chrome windows and tabs are now authorized. Reuse approved connections to avoid repeated permission prompts.
- No Docker. Validate with the native toolchain in a separate working copy. This is not an OS sandbox.
- Keep existing staged changes and historical evidence. Do not commit, reset, stash, or stage unrelated work during this continuation.
- New and edited Markdown is English. The latest repository instructions prohibit Superpowers skills; continue without them. Earlier skill-based task records are historical evidence.
- Never cache a successful filesystem boundary verdict across inspections.

### Task 1: Bound and reuse the Windows boundary probe process

Investigate the repeated PowerShell startup cost in `service/packages/mcp/src/fs/workspace-policy.ts`. Two real native tests time out even when run serially: the legacy journey at 90 seconds and the publication/reconciliation test at 60 seconds. A review identified about 60 extra boundary subprocess launches for the two-file legacy fixture.

Measure the current inspector's repeated-call count/time using real checks before changing behavior. If confirmed, implement a small persistent Windows boundary probe worker with a fixed script and JSON data input, bounded request/response sizes, bounded request deadlines, serialized requests, explicit process ownership, cleanup on parent EOF, and idle shutdown. Every call must freshly inspect every requested path, preserve exact path/order/count validation, and reject reparse points. Do not cache prior successful verdicts. Keep injectable command tests and non-Windows behavior compatible. Do not weaken authorization or use execution-policy bypasses.

Limit production changes to the workspace boundary path and a focused helper module. Add meaningful tests for repeated fresh inspection, malformed/error output, timeout/worker exit, recovery and cleanup. Run tests in a separate native working copy and rerun the two failing native tests unchanged. Report timing and all remaining failures honestly. Do not connect to Chrome, modify the portal draft, or spawn agents.

### Task 2: Complete the current Figma capture

Retain the readiness and text representation fixes already verified on all 3,198 nodes and 11 roots. Address background renderer stalls with target-scoped lifecycle management, preserving unrelated browser tabs. Recover large original images through bounded chunk reads instead of truncating bytes. Keep content identity checks, pagination, missing-asset status and actual completeness gates. Test fixes with the existing browser connection and source tests before binding a fresh service plan.

### Task 3: Revalidate the C4 output and source checks

Use freshly captured assets and screens to correct the draft and run native interaction and original-oracle visual checks. Do not call the portal complete or apply it while required checks are missing or fail. Refresh English evidence and source checks, preserving the distinction between full parsing, asset capture, runtime verification, visual acceptance and final application.

### Task 4: Complete the comparison view as an independent C4 component

Implement `validation/c4-20260910/draft/src/Comparison.tsx` and a stylesheet with a unique `figma-comparison` / `fc-` namespace. The parent owns header, hero, benefits, footer and cart state. Export a `Comparison` component taking `products` (Product[] from `./catalog`), `compared` (string[]), `onCompare(product: Product)`, `onAdd(product: Product)` and `onNavigate(path: string)` callbacks. Do not edit App.tsx or the shared stylesheet in the main working tree.

Use the complete captured tree at `validation/c4-20260910/live/design-complete.json`, root `117:641`, and verified asset manifest `live/assets-verified.json`. Preserve the full comparison fields, warranty paragraphs, selected products, product selector, add-to-cart actions and responsive readability. Compare the real 1440px desktop rendering against the original root PNG; the target root is 1440x3998. The comparison region begins at y416 and the benefits region begins at y3173, leaving 2757px for the desktop comparison region. Support the first source pair Asgaard sofa and Outdoor Sofa Set; other user-selected sample products must show honest missing specifications instead of silently copying an unrelated product's specifications.

Only create the component, its isolated stylesheet, optional data module and assets under `draft/public/comparison/`. Use exact captured bytes for imagery. Do not access Chrome or Figma again, modify design evidence, create commits, stage files or spawn subagents. Work and test natively in a separate copy, preserving the main agent's parallel changes. A temporary copy may integrate the component into a copy of App.tsx for build and Firefox checks. Report the precise integration snippet, source evidence, visual metrics, meaningful interaction checks and any remaining gaps.

### Task 5: Reuse fresh state inspection probes and make process fixtures deterministic

The full source suite exposed reproducible startup and state-inspection overhead. An isolated trace reached READY at 17.775 seconds and initialization at 17.803 seconds after 48 successful commands: 12 boundary PowerShell probes, 12 ACL PowerShell probes, 12 whoami and 12 icacls calls. The expensive state inspection path remains one-shot in `service/packages/mcp/src/security/state-permissions.ts`. The unchanged wire/lifecycle readiness budgets are 15/8 seconds. A DACL prerequisite test exceeds five seconds despite correct results. Immediate stdin EOF also reaches forced shutdown while ACL work continues.

Reuse bounded inspection processes for both state boundary and ACL/SDDL reads. Integrate with the reviewed Windows probe worker where this preserves clean types and lifecycle ownership. Every call must freshly inspect the current paths/ACLs; preserve exact path/count/order, reparse, owner, mode, identity and SDDL checks, and existing injected command/probe compatibility. Keep whoami and icacls behavior intact. Do not cache permission verdicts, relax checks, bypass execution policy, or increase test deadlines. Preserve non-Windows behavior and the worker's limits, timeout, error, backpressure, retirement and unconfirmed-termination guarantees.

Correct the atomic live-owner test's independent 300 ms release timer using explicit parent-controlled release after the unchanged-owner assertion, with exit subscription before release and bounded finally cleanup. Isolate lifecycle owner state per test; that test's leader/follower share the temporary base, and owned children exit before cleanup. Verify that wire tests also use isolated owner state. Never use or stop the actual service daemon or Chrome.

Limit main-tree edits to state-permissions, the shared worker if needed, and their focused tests plus the affected process/wire/atomic fixtures. Validate natively in a fresh separate copy. The existing `full-source-20260910` copy contains diagnostic edits and is not a clean source mirror. Do not delete the diagnostic artifacts whose cleanup was rejected. Run the original failing tests with unchanged deadlines, state/boundary security regressions, and clean shutdown/follower takeover. Report measured startup, exact test evidence and any remaining failure. No commits, staging, Docker, browser access or subagents.
