# Native portal workflow

## Visual scope

Full screens and overlays require actual browser PNG evidence against every captured root oracle. Native preview actions include hover, select, hidden-state waiting, click, fill and keyboard input. `captureSelector` can capture a real component without changing the browser viewport to an unusably small size.

Small non-interactive primitive roots (up to 512 px, excluding frames/text and groups with several children) may be delivered as exact source assets. Declare their copied paths in the preview `assets` list. The independent verifier derives eligibility from the signed captured tree, binds each path and hash to the immutable final source manifest (legacy baseline plus submitted overlays), and rechecks both source and candidate bytes. Runtime scratch copies do not count. A frame cannot be relabeled as an asset by the validation harness. Missing or changed assets still block completion. This keeps decorative primitives in the acceptance scope without treating an isolated logo or background swatch as an entire application screen.

## Plan and code

Only C4 is frontend-only. C2 and C3 retain every relevant service layer. Do not use the pipeline's three foundation upstreams as implicit service references.

1. Run `portal plan` with the requested case and explicit legacy/reference paths. Use the known Figma binding unless the user selects another design. A missing new-project directory is normal.
2. Start the returned plan with `portal run <plan-id>` or `portal_start`.
3. Claim a coding lease with `portal next <run-id>`. Retain its lease ID and epoch. Paginate `fileOffset`, `designOffset`, `tokenOffset`, and `assetOffset`; request particular source files through `evidence` and raster assets through `assetIds`.
4. Read the actual code, including API, persistence, authorization and configuration behavior. `codePatterns` reuses the existing project-convention analyzer. Static evidence is not model training or proof of complete semantic understanding.
5. Submit actual files with their content hashes. `replace` requires the original file hash; `create` requires an absent target. Text uses UTF-8. Binary assets may use base64, or `assets` may copy a verified captured asset by ID and hash without sending large images through the model.
6. Set `finished: true` when the candidate is ready for native checks. A candidate is not yet an applied portal.

A submission contains `runId`, `leaseId`, `leaseEpoch`, `contextHash`, `blueprintHash`, `files` and/or `assets`, and `finished`. The tool schemas returned by `tools list` are authoritative.

Inline submitted files share a one-MiB decoded byte budget per submission. The schema allows the corresponding Base64 encoding overhead for binary files; this does not increase the decoded budget. Larger captured originals use verified asset references.

A candidate may contain up to 300 files and 64 MiB of decoded source/assets. Each captured-asset submission still has a 32 MiB read budget and a 16 MiB per-file limit. The aggregate candidate cap accommodates multi-screen original imagery while remaining below the native working-copy reader's 128 MiB limit. It is a resource limit, not a security sandbox.

Inferred operational workflows are drafts. `portal_start` returns `needs-input` until each required workflow has a confirmed blueprint. `portal_next` still returns source/design evidence and the draft requirements, but no coding lease. Refine the requirements and call `portal_plan` again with the same case, design, target and references. Each workflow needs `workflow.status: "confirmed"`, roles, states, routes, applicable API/data contracts, and one `present`, `extend` or `implement` decision with evidence for every required layer. Start the new plan; its blueprint hash fences older candidates. Every workflow must pass its own required checks, including a real service journey where applicable.

Service path selection retains all discovered dependency layers conservatively. Ambiguous paths across source roots are rejected. The root service is `"."`. Explicit stack selection applies to new services, including reference builds. Legacy builds preserve their existing stack and reject a stack override.

For source evidence, request paths from the returned inventory. Do not scan unrelated repositories. Preserve reference repositories as read-only. Create the independent service in its own output root.

## Native profiles

Register a profile through `portal profile --args-file <file>` to review it, then repeat with `--yes` to register the exact profile. Registration does not execute commands. The administrative nonce binds the complete profile hash, plan, owner and authenticated session.

The profile contains:

- `schemaVersion: 1`, `planId`, and the plan's `contextHash`.
- `native.id`, `executionMode: "native-working-copy"`, and `environmentKind` set to `disposable-test` or `development-test`.
- `native.sourceHash`, equal to the candidate hash.
- `native.closure`: relative paths and actual SHA-256 hashes for every submitted file and the complete analyzed legacy baseline. Replacements use the final candidate hash. The closure is checked before every command and after execution.
- `native.environment`: explicit test configuration. Parent secrets and loader hooks are not inherited. Package-manager and Git homes/configuration are redirected to fresh private paths.
- `native.commands`: an absolute executable, its SHA-256 hash, argv, relative working directory, timeout and output limit. No shell wrapper, Docker, Podman or automatic container/VM substitute is accepted.
- `assertions`: concrete command IDs mapped to required check kinds and requirement IDs. A successful exit is evidence only for the actual assertions implemented by that reviewed command.
- `sourceReviews`: exact workspace/root/path/hash, reviewed layers and a concrete conclusion for weaker cross-language evidence. These owner-reviewed records resolve only lexical coverage warnings. Truncation, malformed syntax and evidence limits still block execution. Newly discovered layers require a revised plan.

A profile must provision and clean up its real required test services. Use the existing project's native toolchain and data contracts. Missing databases, runtimes or provider test configuration remain prerequisites; do not replace required integrations with fake success.

Do not run repository installation/build scripts before their profile is reviewed. For npm-family install commands, use `--ignore-scripts` unless the exact profile explicitly enables lifecycle scripts. Native processes execute as the local owner: these controls are not a filesystem/network sandbox.

## Browser and visual checks

Use the exported `@sfp/mcp/portal-validation` helper from a reviewed validation harness. The daemon supplies `SFP_PORTAL_VALIDATOR_URL`, `SFP_PORTAL_FIREFOX_EXECUTABLE`, and, for a captured design, `SFP_FIGMA_ASSET_ROOT`.

```javascript
const { assertNativePortalPreview } = await import(process.env.SFP_PORTAL_VALIDATOR_URL);
await assertNativePortalPreview({
  root: process.cwd(),
  baseUrl: 'http://127.0.0.1:4173',
  screens: [
    {
      id: 'home-desktop',
      path: '/',
      oraclePath: 'assets/<captured-frame-file>.png',
      oracleHash: '<actual captured PNG SHA-256>',
      viewport: { width: 1440, height: 900 },
      fullPage: true,
      maxDifferenceRatio: 0.01,
      beforeActions: [],
      actions: [{ kind: 'visible', selector: 'main' }],
    },
  ],
});
```

Replace the illustrative oracle fields with the actual captured asset path/hash. Start the real application before calling the helper and stop its owned process in `finally`. Do not use an editor screenshot as the oracle, or embed a full-screen screenshot as the implemented UI.

The helper uses fresh headless Firefox contexts, fixed locale/timezone/date, DPR 1, font readiness, PNG comparison, configured interactions and basic DOM/keyboard checks. `beforeActions` can establish the required UI state before capture. Use explicit keyboard/focus, form, error, routing and persistence assertions appropriate to the service. This basic audit does not replace the project's full accessibility suite.

Native visual artifacts are saved under `.sfp-native-preview` in the working copy. Command evidence records their paths and hashes. Failed command logs are returned to the next coding lease for repairs. A live design is recaptured after native validation and compared against its original content/assets before the live gate can pass.

The daemon independently rechecks screenshot bytes against every captured root PNG. Screens may be split across multiple successful visual commands; their combined evidence must cover the captured roots. An arbitrary local baseline or an exit code alone cannot pass this gate. Standalone pinned JSON remains useful design evidence but is incomplete without a bound usable asset manifest. Asset delivery supports the collector's 5 MB file limit; request small groups within the 20 MB read budget.

Captures beyond one 256-asset or 64 MB batch continue pending exports within the same overall capture deadline and retain signed progress. A later capture of the unchanged tree reuses byte-verified images and vectors. Completed prior captures refresh every root PNG to detect rendering changes during live revalidation. Exact existing asset bytes recover safely after an interrupted progress write. Partial or unavailable captures remain incomplete.

## Apply, cancel and recover

`portal apply` requires complete candidate acceptance and writes only to the approved target. Every replacement checks the exact preimage. Signed write intents preserve partial outcomes. References are never written.

Run applied validation after application. C2/C3 require all relevant API, persistence, authorization, migration and integration checks plus an unmocked frontend-to-service journey. C4 uses frontend acceptance and clear demo limitations. Required skipped or blocked checks are not completion.

`portal cancel` fences coding leases and cancels owned native work, including a source application in progress. A partial source effect remains an explicit conflict or unknown outcome.

Windows native commands use a fixed trusted broker and an unnamed Job Object with kill-on-close. The broker watches the owning daemon's input pipe and its own deadline. Linux/macOS use owned process groups. These mechanisms manage child lifetimes; they are not a security sandbox. Unknown cleanup cannot be reported as successful completion. No Docker, Podman or VM substitute is used.

For interrupted application, first inspect:

```powershell
sfp portal resume <run-id> --args '{"reconcile":"inspect"}'
sfp portal resume <run-id> --args '{"reconcile":"continue"}' --yes
```

Inspection compares actual files with signed preimages and candidates. Continuation only writes the remaining matching preimages. It never overwrites a later user edit. Run budgets and coding-attempt limits survive resume. Status and cancellation do not depend on a repository remaining online.

## Evidence and current boundaries

Tool registration, source tests, real native fixtures, live Figma capture and real target-portal acceptance are separate claims. JS/TS and inline Vue/Svelte scripts have parsed source evidence and project conventions. Other known languages currently produce explicitly weaker lexical evidence; unresolved static coverage must not be called complete. Large or partial captures, unavailable assets, source changes and unsupported configurations are reported rather than silently converted to C4.
