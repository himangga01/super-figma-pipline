# Native portal workflow

## Visual scope

Full screens and overlays require actual browser PNG evidence against every captured root oracle. Native preview actions include hover, select, hidden-state waiting, click, fill and keyboard input. `captureSelector` can capture a real component without changing the browser viewport to an unusably small size.

Small non-interactive primitive roots (up to 512 px, excluding frames/text and groups with several children) may be delivered as exact source assets. Declare their copied paths in the preview `assets` list. The independent verifier derives eligibility from the signed captured tree, binds each path and hash to the immutable final source manifest (legacy baseline plus submitted overlays), and rechecks both source and candidate bytes. Runtime scratch copies do not count. A frame cannot be relabeled as an asset by the validation harness. Missing or changed assets still block completion. This keeps decorative primitives in the acceptance scope without treating an isolated logo or background swatch as an entire application screen.

## Plan and code

Exercise this workflow exclusively through the service's own CLI, MCP tools, collectors and validators. Codex browser control and external connectors do not establish service acceptance. Official Figma MCP tests must invoke the service's official-server integration.

The CLI retries a bodyless control GET once after a transport connection reset, preserving the original deadline, credentials and cumulative response-byte budget. Structured HTTP failures and aborted requests are not retried. Tool submissions, approval decisions and other mutations are never replayed. A failed read retry retains the existing explicit cancellation/unknown-outcome path. Control authorization fails closed. If only the Windows state probe lacks capacity in time, the daemon answers `503 CONTROL_AUTH_BUSY`; every other authorization failure returns `500 CONTROL_AUTH_UNAVAILABLE`. While only monitoring a dispatched operation, the CLI tolerates that typed busy state, or the same transient probe outcome while reading local credentials, for up to 60 seconds of consecutive failures, polling every second without cancelling the operation. Approval decisions, untyped failures and an exhausted window keep the cancellation/unknown-outcome path. Each monitoring poll makes two authorized requests, and each request costs the daemon several Windows ACL probes, so monitoring polls every 300 ms for the first 5 seconds of an operation and once a second afterwards. One state-permission authority resolves the process user SID once and reuses it, because a process token user cannot change; a failed lookup is not cached and still fails closed.

After the user enables Chrome remote debugging and permits the service connection, `chrome-open --url <figma-url>` opens a missing source tab through the service's Playwright connection. `chrome-inspect --open --url <figma-url>` combines explicit source opening with collection. Both reuse an existing unique matching tab, preserve unrelated tabs and never launch another source browser or profile. Without the explicit open request, collection remains attach-only. Browser security approvals stay with the user.

Source opening now selects the requested target before Playwright initializes pages. If that target is absent, the explicitly authorized operation creates a blank tab in the unambiguous normal Chrome context, attaches only that tab and permits one navigation to the exact requested Figma URL. Other navigation and target-creation requests remain rejected. Unknown creation outcomes are not replayed, and ambiguous source tabs or browser contexts remain errors. Detaching leaves source tabs open for the owner. If an explicit opening ends before its source is selected, the transport closes only the tab it created for that request, with a bounded wait; accepted and pre-existing tabs are never closed, and clients still cannot close targets. A sign-in redirect is reported as `FIGMA_LOGIN_REQUIRED`, a page that never reaches the requested file as `FIGMA_TAB_NOT_FOUND`, and caller cancellation stops the wait.

The CLI's `--max-nodes` is a per-query batch limit from 1 to 2,000, not the maximum whole-page node count. Snapshot collection continues through bounded roots and subtrees. Invalid batch parameters are rejected before opening a browser connection. Initial collection and its ordered verification pass each have a 12,000,000-byte accepted-response budget, with at most 24,000,000 accepted bytes across both passes. Each pass also has its own 256-call limit, so a complete first pass always leaves its equally bounded verification pass room to run (at most 512 calls overall). The deadline, per-query limits and exact reobservation comparisons remain enforced; exceeding either pass's limit leaves explicit incomplete coverage.

The independent `chrome-export`/`chrome-compare` path reads a native document without Scripter. Its normalizer preserves instance override keys, versioned imported style references, float32 transforms, independent corner/border values, automatic line height and crop transforms. Bounded vector-network decoding reconstructs unstyled missing fill paths from recorded vertices, tangents and loops. Character-style tables supply independent font runs, including recorded effective weight evidence. Comparisons retain original values: known six-significant-digit API path serialization is checked without rewriting decoded paths, and a mixed API font marker can be explained only by matching complete font runs. Native library keys disambiguate styles before unique-name pairing. This partial path still reports `fullCaptureAccepted: false`; matching the declared fields does not establish unexamined properties, complete catalogs, independent exported oracles or portal admission.

Native comparison also covers supported automatic-layout fields, asymmetric padding, bounds, masks and placement constraints. Instances retain their own placement constraints. Unsupported legacy/grid layout forms remain unknown. The closed single-action click-navigation form is decoded from recorded prototype interactions, including instance fragments merged by interaction ID and deletion markers. Other triggers/actions, transitions and multi-action forms remain explicitly unsupported. This bounded support does not imply complete prototype semantics. Native effects are converted for layer and background blurs (normal blur type) and for drop and inner shadows. A resolvable effect style supersedes the node's cached effect copy, as for paint styles. Variable-bound, progressive, procedural and malformed effects are reported as `NATIVE_EFFECTS_UNSUPPORTED` and left unknown rather than approximated. Stroke miter limits and dash patterns use Figma's omitted defaults (4 and solid) for stroke-capable nodes, and uniform side weights are reported for frame, instance, component and rectangle types. Malformed values are reported as `NATIVE_STROKE_UNSUPPORTED`. Side-width differences are treated as representation differences only when neither collector records stroke paints. Layout sizing (`FIXED`, `HUG`, `FILL`) is derived after the tree is complete, from the decoded layout fields of each node and its parent. Hidden and absolutely positioned children do not take part in their parent's auto layout. An unknown container layout or text resize mode leaves sizing unknown. Text case, decoration, truncation, maximum lines, wrap style, hyperlink and font weight come from recorded values or Figma's omitted defaults. Character style runs make case, decoration and weight `mixed`. Font weight comes only from Figma's recorded font metadata. Native hyperlinks and malformed values are reported as `NATIVE_TEXT_PROPERTY_UNSUPPORTED`, because no native hyperlink encoding has yet been observed. Corner smoothing, strokes included in layout (`bordersTakeSpace`), fixed child count, overflow direction (`scrollDirection`), layout grids and target aspect ratio use recorded values or Figma's omitted defaults, only for the Plugin API types that expose them. Column, row and square grids are converted. Variable-bound or unobserved grid forms, fixed-child dividers and recorded aspect locks are reported as `NATIVE_CONTAINER_UNSUPPORTED`. Style identifiers come only from imported style references, which carry the library key and version (`S:<key>,<version>`); local styles carry no native key, so their identifiers stay unknown, as do run-level, inherited and text-style-overridden references. Grid auto-layout fields use Figma's defaults outside native grid layouts; grid containers, their children and any native grid field stay unknown because that encoding has not been observed. Variable bindings and explicit modes are empty only when the node has no native variable data, and resolved modes are empty only when the document has none. Annotations are empty only when none are recorded. PNG, JPG and PDF export settings are converted (scale constraints only; `useAbsoluteBounds` is reported for text nodes, as observed); instances never report their main component's settings, and instance sublayers report none unless an override sets them, which stays unknown. Ellipse arcs use the recorded arc or the full-circle default. Every value the normalizer cannot determine is listed in the node's `nativeUnknownFields` and reported as `NATIVE_METADATA_UNSUPPORTED`; comparison counts those positions as unobserved instead of comparing or matching them. A malformed native style row (missing identity or name, or a duplicated identity) is excluded and listed as invalid instead of aborting the style catalog or the node comparison.

Only C4 is frontend-only. C2 and C3 retain every relevant service layer. Do not use the pipeline's three foundation upstreams as implicit service references.

1. Run `portal plan` with the requested case and explicit legacy/reference paths. Use the known Figma binding unless the user selects another design. A missing new-project directory is normal.
2. Start the returned plan with `portal run <plan-id>` or `portal_start`.
3. Claim a coding lease with `portal next <run-id>`. Retain its lease ID and epoch. Paginate `fileOffset`, `designOffset`, `tokenOffset`, and `assetOffset`; request particular source files through `evidence` and raster assets through `assetIds`.
4. Read the actual code, including API, persistence, authorization and configuration behavior. `codePatterns` reuses the existing project-convention analyzer. Static evidence is not model training or proof of complete semantic understanding.
5. Submit actual files with their content hashes. `replace` requires the original file hash; `create` requires an absent target. Text uses UTF-8. Binary assets may use base64, or `assets` may copy a verified captured asset by ID and hash without sending large images through the model.
6. Set `finished: true` when the candidate is ready for native checks. A candidate is not yet an applied portal.

A submission contains `runId`, `leaseId`, `leaseEpoch`, `contextHash`, `blueprintHash`, `files` and/or `assets`, and `finished`. The tool schemas returned by `tools list` are authoritative.

Inline submitted files share a one-MiB decoded byte budget per submission. The schema allows the corresponding Base64 encoding overhead for binary files; this does not increase the decoded budget. Larger captured originals use verified asset references.

A candidate may contain up to 300 files and 96 MiB of decoded source/assets. Each captured-asset submission still has a 32 MiB read budget and a 16 MiB per-file limit. The aggregate cap accommodates the observed 89,090,574-byte eCommerce original image set, leaving room for source files and fonts, while remaining below the native working-copy reader's 128 MiB limit. Native environment and preparation archive indexes have separate metadata-retention budgets; those limits are unchanged. This is a resource limit, not a security sandbox.

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

Use the exported `@sfp/mcp/portal-validation` helper from a reviewed validation harness. The daemon supplies `SFP_PORTAL_VALIDATOR_URL`, `SFP_PORTAL_CHROME_EXECUTABLE`, and, for a captured design, `SFP_FIGMA_ASSET_ROOT`.

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

The default comparison mode is `rgba-v1`: it counts pixels whose white-composited RGB channels differ by more than 12. A profile may explicitly set `comparisonMode: 'pixelmatch-7.2-v1'` for comparisons across renderers. That mode uses the pinned Pixelmatch 7.2.0 algorithm, threshold 0.1, antialias detection, and the same white alpha backdrop. The allowed differing-area ratio is still the profile's `maxDifferenceRatio` (1% in this example). Its report also retains the original RGBA ratio as `strictDifferenceRatio`. A perceptual pass is not a claim that strict RGBA comparison passed.

The chosen mode is part of the reviewed profile and observation identity. The worker rejects a mode that differs from its manifest, and the daemon re-computes comparisons from saved PNG bytes under that bound mode. Changing the comparison mode requires preparing and registering a new reviewed profile. Historical failures are not retroactively converted to passes. Neither mode replaces source-property, asset, interaction, accessibility or live-source checks.

The helper launches installed Google Chrome stable through Playwright's `chrome` channel in an owned headless session with a temporary profile. It uses fresh contexts, fixed locale/timezone/date, DPR 1, font readiness, PNG comparison, configured interactions and basic DOM/keyboard checks. It does not connect previews to the user's existing Figma session. A missing Chrome installation blocks preview validation; no alternate browser is selected. `beforeActions` can establish the required UI state before capture. Use explicit keyboard/focus, form, error, routing and persistence assertions appropriate to the service. This basic audit does not replace the project's full accessibility suite.

Native visual artifacts are saved under `.sfp-native-preview` in the working copy. Command evidence records their paths and hashes. Failed command logs are returned to the next coding lease for repairs. A live design is recaptured after native validation and compared against its original content/assets before the live gate can pass.

Source freshness also records a narrow `same-facts-png-quantization-v1` re-export proof when Figma produces slightly different PNG bytes from unchanged design data. The original and fresh content, contract, source and source-scope identities must match exactly. Every asset remains independently hash-verified; original image and SVG bytes must match. Only PNG exports may differ, with identical dimensions/alpha, at most one RGB level of change and no more than 0.01% changed pixels. The report preserves both distinct capture fingerprints, the complete asset-hash correspondence and measured raster differences. Receipt verification recomputes both asset fingerprints and design fingerprints from that evidence. This fixed source policy is separate from the frontend visual comparison mode and does not change its allowed difference ratio. The proof re-reads and re-checks only the differing PNG bytes it compares: its callers verify both whole captures around it (the refreshed capture immediately before, the original before and after). The design-version and asset-row fingerprint formulas live in one shared `ir` implementation used by both capture descriptors and proof verification. When verified PNG bytes exceed the proof's bounded read or decoder limits, no proof is produced and freshness fails while command and preview evidence is retained; changed asset bytes remain an integrity error.

The daemon independently rechecks screenshot bytes against every captured root PNG. Screens may be split across multiple successful visual commands; their combined evidence must cover the captured roots. An arbitrary local baseline or an exit code alone cannot pass this gate. Standalone pinned JSON remains useful design evidence but is incomplete without a bound usable asset manifest. Original asset reads are capped at 16 MiB; large selections use immutable capture references instead of exceeding the bounded inline response.

Captures beyond one 256-asset or 64 MB batch continue pending exports within the same overall capture deadline and retain signed progress. A later capture of the unchanged tree reuses byte-verified images and vectors. Completed prior captures refresh every root PNG to detect rendering changes during live revalidation. Exact existing asset bytes recover safely after an interrupted progress write. Partial or unavailable captures remain incomplete.

## Apply, cancel and recover

`portal apply` requires complete candidate acceptance and writes only to the approved target. Every replacement checks the exact preimage. Signed write intents preserve partial outcomes. References are never written.

Run applied validation after application. C2/C3 require all relevant API, persistence, authorization, migration and integration checks plus an unmocked frontend-to-service journey. C4 uses frontend acceptance and clear demo limitations. Required skipped or blocked checks are not completion.

`portal cancel` fences coding leases and cancels owned native work, including a source application in progress. A partial source effect remains an explicit conflict or unknown outcome.

Windows native commands use a fixed trusted broker and an unnamed Job Object with kill-on-close. The broker watches the owning daemon's input pipe and its own deadline. Linux/macOS use owned process groups. These mechanisms manage child lifetimes; they are not a security sandbox. Unknown cleanup cannot be reported as successful completion. No Docker, Podman or VM substitute is used.

Windows cleanup rechecks job membership within its existing bounded polling loop when a termination request loses a race with natural exit or an earlier termination request. A failed termination call alone is not cleanup proof. The broker emits its authenticated stop receipt only after observing that its job contains no process other than itself, and still waits for the owner's durable acknowledgment. Persistent members, failed job queries and missing stop receipts remain failures.

For interrupted application, first inspect:

```powershell
sfp portal resume <run-id> --args '{"reconcile":"inspect"}'
sfp portal resume <run-id> --args '{"reconcile":"continue"}' --yes
```

Inspection compares actual files with signed preimages and candidates. Continuation only writes the remaining matching preimages. It never overwrites a later user edit. Run budgets and coding-attempt limits survive resume. Status and cancellation do not depend on a repository remaining online.

## Evidence and current boundaries

Tool registration, source tests, real native fixtures, live Figma capture and real target-portal acceptance are separate claims. JS/TS and inline Vue/Svelte scripts have parsed source evidence and project conventions. Other known languages currently produce explicitly weaker lexical evidence; unresolved static coverage must not be called complete. Large or partial captures, unavailable assets, source changes and unsupported configurations are reported rather than silently converted to C4.
