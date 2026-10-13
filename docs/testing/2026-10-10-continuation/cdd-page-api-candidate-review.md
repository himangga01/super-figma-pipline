# Fresh CDD page-API candidate and native profile review

Review date: October 11, 2026 (Asia/Seoul).

Latest update: the [v2 repair recheck](#v2-repair-recheck-on-october-11) below reviews subsequent candidate changes and the actual failed service receipt. Earlier sections preserve their original source and execution boundaries.

This is the independent, filesystem-only review of the new candidate in `.worktrees/_cache/cdd-page-api-authoring-20261011` and the authoring helpers/configuration in `.worktrees/_cache/cdd-page-api-profile-20261011`. Its source authority is the current public context `.worktrees/_cache/cdd-page-api-context-20261011-prep-r2`, run/plan `sfp_portal1_1459262f8e0752efd5db0519931fe827`. Read this report before subsequent review of this candidate, recheck the file identities, and update affected findings after changes. [AGENTS.md](../../../AGENTS.md) and [service-analysis.md](../../service-analysis.md) remain the project instruction and analysis authorities.

## Baseline and scope

- Git HEAD: `22517932dc9b2cb974c177ec4eacb84d4b16e254`, branch `main`, with the existing extensive October 10–11 source/report modifications and untracked continuation evidence. `git diff --cached --quiet` returned 0. This reviewer changed only this report.
- The coordinator reports service source frozen at `sha256:6faae6271793a8f80728301a66cf627cfc32b3da89678f63093cfcad8b549cff`. This review did not recompute the complete service fingerprint or treat its pending whole check as a pass.
- Reviewed the shared analysis policy, project instructions, current canonical report and continuation record. No historical generated frontend, reference frontend, output or backup was inspected.
- No package manager, candidate script, compiler, test, browser, Figma connection, service mutation or dependency execution occurred. Python and PowerShell only read files, parse JSON, compare records and compute hashes. No Docker or external browser/Figma tool was used.

Initial SHA-256 identities, without the `sha256:` prefix:

| File | Hash |
| --- | --- |
| Current context `plan.json` | `61bccbfb46a419fe818875e4dfbce1646fc312c5f1a38510e85da1c1df0d7974` |
| Current context `initial.json` | `663a45ed9b223f9bbbf857f434755139925f9d4f8897721a99c52a4aa69358b8` |
| Current context `design-page-1.json` | `185d4d833063128b755b3b5fea0ad7aab22d990c5189c0248fa830d0816fb100` |
| Candidate `output-files.json` | `8b17d24c8c4cb9a865088d52bfc04c8916952ac0f4a190f29c04470d53a7b980` |
| Candidate `src/CapturedNode.jsx`, before review repairs | `5c7a1f5b48aa46da84e9e07eca1a80be246304521ce675029fc29dfc6f1e82b3` |
| Candidate `src/captured-style.js` | `9a9d872095d53d800e514d41815b19257427dbafacef34b55c8d20305d303d4b` |
| Candidate `src/main.jsx` | `bb18f4cbe25dfc378bc9f9bc1c1070ba73f9f23d99246dcf188149f6c88e9abb` |
| Candidate `src/design-data.json` | `b57738c36b340dfce920740aca9dd800d127295ceadee53f548f913e6c5042d8` |
| Candidate `src/native-text-layout.json` | `3c90bc4fb711562d81f6181a0e4c16a154ea715d02db3826f0585909f2230ee1` |
| Candidate `binding-manifest.json` | `05ac0485b45e99264adc5c1a635626763e48dee8d94d1ea1a8140e996922ef74` |
| Profile `native-config.json` | `da583c1ada9276250e7391e298b0eab4000c08fb7d7fdf53af24c6c8b1acf6d4` |
| Profile `prepare-native.mjs` | `9488a2065ebb1d9c761a3c185fa0e3b4af223e4cec6b4288dc0975428ba55777` |
| Profile `compose-config.mjs` | `f3f6976f1760fb3158812bceb459467adafd4041b5d3b15a8854980066971c40` |
| Profile `generated/core-declarations.json`, before regeneration | `46f6570a601e7ba8c42c2a275aaa61c2eeeaa5339df378c4b0701a44c72ff912` |
| Service `packages/mcp/src/portal/preview.ts` | `ed2a361fb8f261051f9e2836f264a1f6c56b5bd6ddcfd06f9bd7472160cf47f4` |

## Purpose and implemented structure

The new React/Vite application implements the current C4 frontend-only CDD composition. A shared renderer reads all 192 captured source nodes and original local assets. It exposes GUIDE, Mobile and Desktop routes, selects/scales a captured composition on `/`, and implements local email demonstrations, informational dialogs and persistent language selection. Email values remain in component memory; only `cdd.locale` is written to local storage.

The native profile declares direct Node commands for npm lock generation, npm installation with lifecycle scripts disabled, actual TypeScript checking, static source checks and Vite building. A direct Node HTTP server listens on loopback and serves `dist`. The profile helper binds source recipe pages and candidate file hashes, prepares three full-root visual screens, and proposes retained-row review rationales while leaving compiled property/asset observations to the service. Static declarations and rationales do not establish rendered consumption or acceptance.

## Findings and repair status

### R1: Korean footer buttons lack accessible names in the initial candidate

Priority: P2. Initial `src/CapturedNode.jsx:136` renders each footer information button with only `CapturedText`. Its native-layout branch at line 42 originally marked the SVG `aria-hidden="true"`. There was no button `aria-label`, title or alternative accessible text. All 30 footer text nodes have native layouts, so this affects both Korean interactive roots, including `I1381:290;1379:619;1379:468` and `I1381:542;1381:190;1379:554`. A screen reader therefore encounters unnamed buttons even though the painted labels and DOM `textContent` are present.

The coordinator authorized the author to repair this before submission. A subsequent source read confirms explicit localized labels on footer and trial-submit buttons, named SVG graphics for ordinary captured text, and heading labels retained only on heading wrappers. Existing source text still appears once in `<text>/<tspan>` elements. This closes the reported source defect by inspection; actual Chrome accessibility-tree verification remains pending.

### R2: Explicit SVG shadow suppression discards six captured text effects

Priority: P2. Initial `src/CapturedNode.jsx:43` sets `textShadow: 'none'` on every SVG `<text>`, overriding the shadow that `src/captured-style.js:79–81` derives from captured text effects. The current source includes visible black shadows with offset `(0, 2)`, blur radius `6`, and alpha approximately `0.55` on mobile nodes `I1381:431;1379:244`, `I1381:431;1379:245`, `I1381:431;1379:249`, and desktop nodes `I1604:1325;1379:320`, `I1604:1325;1379:321`, `I1604:1325;1379:325`. Korean rendering selects the SVG branch, so those observed effects are suppressed. Preserve the actual source effect in the SVG text rendering. Exact pixel impact and the visual gate result were not measured.

The author removed only the explicit SVG `textShadow: 'none'` override. An independent final source read confirms that SVG text now inherits the captured effect, while the accessibility repairs remain present. Final `src/CapturedNode.jsx` SHA-256 is `ff088d25499b98b739f0805f8c8912ee07103d0b44935b77e1d978ca771a04ba`. R1 and R2 are repaired by source inspection at this identity; browser accessibility and visual acceptance remain unexecuted.

### R3: The service's basic accessibility audit can miss R1

Priority: P2, separate service capability gap. `service/packages/mcp/src/portal/preview.ts:608` judges button/link names using DOM `textContent`, `aria-label`, title and an image-alt selector. It does not compute the browser's accessible name or exclude `aria-hidden` text. The original R1 button therefore passes this naming condition because its hidden SVG still has text content. Additionally, this audit runs after the workflow journeys; the last language journey leaves the page in English, where `CapturedText` uses an ordinary text span. That state does not validate the original Korean accessibility state.

A bounded next repair should use service-owned installed Chrome's computed accessibility tree/name, for example through its existing Playwright/CDP connection, to verify actual actionable control names. Run relevant assertions in the initial Korean state and exercised language states. Include a regression with an unnamed button whose only text is inside `aria-hidden="true"`, plus a properly labeled counterpart. Do not infer complete accessibility from this narrow naming repair. No service code or tests were edited in this review, and the current source freeze must be respected.

### Submission bookkeeping: regenerate the candidate closure

The inspected `generated/candidate-closure.json` recorded `src/design-data.json` as `e8619bbdd6765d773ee8087e347e2f16e7f0adf3f269ac36bf8387a942de75c2`, while the actual current file hashes to `b57738c3...` above. Later author repairs also change `CapturedNode.jsx`. The coordinator is aware and will regenerate the seven declarations and exact 44-file closure after the final author freeze. This is a pending authoring transaction, not evidence that the service accepted stale input. Never submit these earlier hashes as current.

## Other reviewed evidence

- All 192 candidate node records exactly equal the merged current `initial.json` and `design-page-1.json` records. The candidate asset inventory exactly equals the current service inventory.
- The bytes of all 22 implementation image/SVG assets match their captured SHA-256 values. Root oracle PNGs are outside the submitted 44-file implementation closure. The two included WOFF2 hashes match the recorded local font receipt: regular `4249bafc6673772edd9f3ed64589496ffbbd084a81dd85d6e170058fad86d117`; bold `c85faa3fa812cae9fad6eadc662b0e68c84f010b61c5c0ebc769a7b43e0fcd4d`.
- Reviewed the runtime JavaScript/JSX, styles, HTML, static server and SVG text. No account-data transmission, credential access, dynamic code execution or outbound runtime resource URL was identified. SVGs contain the standard XML namespace but no inspected script, event-handler, external HTTPS, foreign-object or data-URL content. This is bounded source inspection, not exhaustive binary/dependency malware screening or a safety guarantee.
- The package manifest pins dependencies, and `checkJs:true` covers actual `.js` and `.jsx` files with `react-jsx`, DOM libraries and JSON imports. No `@ts-nocheck` or fabricated typecheck command was observed. Whether TypeScript actually passes is unverified.
- The static source check truthfully labels its own boundary as source and asset integrity only. It does not claim that its regular-expression checks prove independence, security or live behavior.
- The server validates a loopback hostname/port, serves a resolved `dist` path under a path boundary, returns SPA HTML for extensionless routes, and supplies the used content types. No concrete current-input command or loopback-serving defect was found. This process runs with the local owner's privileges; it is not an operating-system filesystem/network sandbox.
- The direct npm lock-only then `ci --ignore-scripts` sequence is intentional and declares generated lock/dependency outputs. The initial absence of a lockfile is not reported as a bug. The service must produce and verify the real typed receipts before subsequent commands.
- The profile includes all three source roots, 52 meaningful semantic actions per interactive root and four workflow journeys per interactive root. All eight workflow journeys' exact node selectors and root IDs belong to the current plan's relevant source scopes. Form checks cover empty/invalid/corrected values, dialogs, focus restoration and dismissal; language checks cover both selectors and persistence through real home navigation.
- The helper retains `pixelmatch-7.2-v1` at maximum difference ratio `0.01`, plus the service's separate strict RGBA metrics. Component/material/strategy review proposals remain visibly distinct from actual property/asset observation checks and all-root visual comparison. No threshold increase, missing-screen exemption or manufactured runtime receipt was proposed.

## Verification limits and continuation

No executed acceptance is claimed. Dependency resolution, installation, JSX/typecheck, Vite build, service profile compilation, actual asset/property consumption, GIF timing, font rasterization, root PNG comparison, live accessibility/interaction behavior, candidate application and final source freshness remain the coordinator's service-owned work. Read-only data/hash inspection does not replace those gates.

There are no new product questions from this review. Preserve the confirmed local-demo scope and no-reference-frontend condition. Retain the independently rechecked R1/R2 source repairs, regenerate declarations/closure, inspect the service-prepared profile, and perform the unchanged service validation/repair workflow. Address R3 in a separately authorized, isolated service change after respecting the current whole-check freeze; do not report the existing text-content audit as complete accessibility validation. The requested project-instruction index update is delegated to the coordinator because this reviewer's write ownership is limited to this report.

## V2 repair recheck on October 11

### Current baseline and actual failed execution

The reviewer reread the updated project instructions, shared analysis policy and this existing report. HEAD remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`; read-only `git status --porcelain=v1 -uno` reports 51 modified tracked paths. No candidate, service, test, dependency, daemon, browser, index or historical frontend was changed or executed by this reviewer. This continuation writes only this report.

The current candidate still submits 44 files. It now includes `src/asset-frame.js` and excludes the custom `scripts/server.mjs`. Preview is delegated to the installed Vite toolchain on loopback. The earlier C4 server-import rejection remains a failed attempt, not an exemption from the frontend-only source guard.

The inspected existing service validation receipt is `.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline/portal/validation/629c9f9a6f33c6cfa30ed65a20b4d40bdb95ef40bca069254900e94537ed8cbe.json`. Its complete file SHA-256 is `88e99cffb671ebcbf744f673915b4325a2732ccbb5fa5f0563742f2e63e4a7ba`. This review read its recorded payload; it did not independently authenticate the receipt MAC or rerun validation.

The receipt belongs to candidate `sha256:41be37b62679bd3ecb3d8781efae6519804cc794d23f3705de1a01527c6cd32b`. Lock generation, dependency installation, typecheck, independence and build commands each recorded exit code 0 and `passed`. Preview recorded exit code 1 and `failed`. Of 2,110 consumption observations, 131 failed, all with `PORTAL_CONSUMPTION_ELEMENT_HIDDEN`; no failed observation reports a property mismatch. The receipt has `runtimeVerified:false` and `liveDesignVerified:false`.

| Root | Pixelmatch ratio | Strict RGBA ratio | Recorded screen outcome |
| --- | --- | --- | --- |
| GUIDE | 0.008079696273608983 | 0.043477220520673814 | Passed screen |
| Mobile | 0.014969528742431647 | 0.044599290267992746 | Consumption and visual failures |
| Desktop | 0.01567986490324413 | 0.02931560874223823 | Consumption and visual failures |

The maximum accepted pixelmatch ratio remains `0.01`. These prior results do not cover the repairs below. The coordinator reports the old run expired at 17:38 KST; preserve that deadline and failed evidence, then establish a new public plan rather than extending the old run.

### Independently checked repair identities

All eight actual file hashes match `evidence/validation-v2-repair-hashes.json`:

| Candidate file | SHA-256 |
| --- | --- |
| `src/CapturedNode.jsx` | `e3186d2ffee8a80dbdd88c23b596e69a999712e639570e9f28881d0f9f0c2878` |
| `src/styles.css` | `1715508be63516dfa84bb09eecefdbeb30268212e5a8ce22a9a9d4deb273848a` |
| `src/main.jsx` | `5dbc7d3d135cd8e0eedc6f338f6dc49191bab7695b65ced321f7d752fc05db6d` |
| `src/asset-frame.js` | `1c39b7fc11dc02ed89aa6023cc13b9571e5f3909b6b21efddee01f380004d396` |
| `scripts/check-source.mjs` | `43fe4cecca8bdb025ef079eb00de7ff17e7d3e8c55ec25ed9fdbc482ede293d1` |
| `binding-manifest.json` | `78579dc2cc4503cf77d34880f2a809d06d74d2ee4a55218e5ecbde66490dd53d` |
| `README.md` | `6b5c976aff9081aa2121eb1bfe424ed64fb6197577f6afa6d3bbf78126ed260e` |
| `output-files.json` | `2c3296c627343620e6b3a44bd84406e7b3277b9785b5c92498292012bb400ede` |

The source data, supplemental text layout and style implementation retain the earlier hashes `b57738c3...`, `3c90bc4f...` and `9a9d8720...`. The asset manifest hashes to `520ac71cccc0900e4b58763d5de69329d9d8c95e2684ae0c94aab9f1a9d4b1dd`; all 22 implementation asset files still match its recorded SHA-256 values. The eight repair hashes are not a substitute for regenerating and binding the entire submitted closure.

### Coordinates, labels and pointer semantics

`src/CapturedNode.jsx:154–159` now positions direct GROUP children using child absolute bounds minus parent absolute bounds. The current records contain 34 such children: 30 navigation labels and four caret vectors. All inspected child and parent rotations are zero, so the absolute-bound translation is consistent with this actual input. For example, the first mobile navigation label has captured `y=86`, while subtracting its GROUP absolute bounds yields local `y=0`; the previous DOM placement added the group offset twice. This change derives coordinates from retained captured facts and does not modify source JSON.

`src/styles.css:13–14` removes pointer interception from passive captured nodes while explicitly enabling actual source-root, button, link and input targets; `:24` also enables the language menu. These rules are present for ordinary application use and do not detect or branch on the validator. The painted elements retain their geometry, opacity and source IDs. `CapturedNode.jsx:129–139` replaces the sibling placeholder with a real label containing its actual input. The input's negative local offset cancels the source text offset, preserving its original control placement. Its explicit email name and error association remain; the original placeholder SVG remains in the label and is visually suppressed only after input. R1's explicit button labels and R2's inherited text shadows are retained.

These are plausible product semantics by source inspection, not demonstrated closure of the 131 failures. The current service observer at `preview-consumption.ts:217` accepts a pointer-disabled target when the center hit is an ancestor. That rule can establish neither painted-pixel contribution nor absence of occlusion by another pointer-disabled layer. The reviewer therefore does not equate future hit-test success with proof that every passive source node visibly contributes. The unchanged full-root visual gate and actual workflow checks remain necessary. No new candidate-specific concealment or validator-only branch was found in this recheck.

### Captured GIF first-frame rendering and resource boundary

`src/asset-frame.js:7–25` iterates only manifest image assets ending in `.gif`, validates the fixed portable asset-path shape, constructs a same-origin URL, and uses one explicit GET call with omitted credentials and rejected redirects. It hashes the fetched bytes with SHA-256 before passing them to Chrome's ImageDecoder. It requests frame index 0, converts the decoded frame into an ImageBitmap and closes the temporary decoder/frame. No user-provided path, account input, remote endpoint, request body, evaluator or backend import enters this path.

`src/main.jsx:72–75` prepares the frames before mounting the application and shows an error if acquisition/decoding fails. `CapturedNode.jsx:19–35` draws that stored bitmap in a per-asset canvas and uses the captured fill's fit mode and opacity. The original same-node GIF background URL remains supplied by `captured-style.js`, so the resource hash observer still reads the original asset. The actual overlay bitmap is derived from those independently hash-checked bytes. This is an explicit visual rendering layer, not a root-oracle image or fabricated asset hash. Its decoded pixels still require visual verification; the CSS background-resource check alone does not inspect canvas pixels.

All eight current GIF placements use opacity-1 image fills and have a nearest visible solid ancestor with opacity 1 and RGB channels approximately `1/255`, yielding `#010101`. The canvas background chosen from those actual ancestors prevents later underlying animated pixels from appearing through its transparent first frame for these inputs. No arbitrary screenshot-derived backdrop was introduced. More general compositing with translucent ancestors or rotated/cropped fills is not established by this bounded check and is not needed to describe these eight observed placements.

The revised static source check at `scripts/check-source.mjs:33–40` allows the one inspected asset reader while continuing to reject ordinary account/presentation fetch, XHR, WebSocket and beacon calls. It checks the GET/credential/redirect/hash source pattern and disallows request bodies. Its final output still describes only static source and asset integrity. These regular expressions are supporting checks, not a general network-security proof. The service C4 guard prohibits backend imports; this new browser asset reader has none. Removing the custom server from the submitted closure preserves that boundary without changing the guard.

### Recheck conclusion and remaining verification

No additional concrete defect was identified in the reviewed v2 repair code and current inputs. This conclusion is limited to source reasoning, JSON comparisons and hashes. The reviewer did not execute the new decoder, perform TypeScript checks, inspect a fresh Chrome accessibility tree, or measure new PNG differences. No fresh candidate pass, visibility pass, application, runtime or design-freshness result follows from the earlier failed receipt or this recheck.

Preserve the failed attempt and its expired run. After integration and a fresh public plan, regenerate the exact candidate closure/declarations and prepared native profile, then rerun the service's unchanged source/property/asset/workflow/visual checks. Retain R3 as a separate accessibility-audit limitation until its actual service repair and verification are recorded by the coordinator. No new product decision or permission is required by this review.
