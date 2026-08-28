# eCommerce Figma Service Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: `figma-design-to-code`, `chrome:control-chrome`, `sites-building`, `sites-hosting`, and conditionally `computer-use`. If social art is missing, dispatch exactly one image-only subagent; main never invokes ImageGen and remains sole editor. Run only after R20 READY.

**Goal:** Use the completed Super Figma Pipeline service, not direct browser imitation, to understand the supplied Figma Community file, implement a faithful page in `validation/ecommerce-figma-site/`, and prove the service-to-code-to-browser loop.

**Architecture:** Chrome handles the public Community listing, duplication, and final QA. Figma Desktop runs the local development plugin. All semantic design facts, tokens, components, assets, screenshots, and interactions used by code come from authenticated service operations, SnapshotV1, GroundingGraphV1, and exported artifacts. The validation site is a standalone OpenAI Sites project and Git repository.

**Tech Stack:** source-complete `service/` artifacts, Chrome, Figma Desktop plugin, `@openai/sites@0.3.0` with the `shadcn` add-on, TypeScript/React/Vinext/CSS, Ajv 8.17.1, OpenAI Sites hosting.

**Target:** `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/eCommerce-Website-%7C-Web-Page-Design-%7C-UI-KIT-%7C-Interior-Landing-Page--Community-?node-id=0-1`.

## Binding Rulings

- The user's service-only extraction requirement overrides `figma-design-to-code`'s official `get_design_context` step. Load that skill for adaptation, asset, reuse, and fidelity rules, but treat successful local service context/snapshot artifacts as the mandatory design-context prerequisite. Do not call official Figma MCP. If service extraction fails, stop; never fall back to screenshot/manual layer imitation.
- Use the exact Chrome family selector and complete Chrome documentation. Do not substitute the in-app browser, Edge, an unnamed extension, `getDefault`, or `getForUrl`. If Chrome is unavailable, instruct the user to install/enable the ChatGPT Chrome extension under Settings → Computer use.
- Use `computer-use` for Figma Desktop only when available and loaded; otherwise explicitly hand the Desktop import/run/pair step to the user. Chrome is not a substitute for the Desktop development-plugin host.
- The Sites first-preview tab and the Chrome Figma tab are separate persistent tabs. Reuse each tab in its own browser surface; do not claim one shared tab.
- Task V1 scaffold creation is the first Sites or validation action. Do not launch, package, pair, inspect Figma, or run source-complete verification before the scaffold is committed and both the Site repository and parent repository are clean.
- If the scaffold has no suitable social-preview bitmap, only after the V4 first meaningful preview dispatch exactly one image-only subagent under the Sites skill. The main agent never invokes ImageGen directly. The worker returns image bytes only and never edits Site files; the main agent adds the asset and records origin/hash.

## Global Constraints

- The validation site is the service's SUT acceptance artifact. Every Figma-derived implementation decision maps to a service operation/artifact.
- Official Figma MCP, browser-only layer reading, manually copying visible CSS, and screenshot-only imitation are prohibited substitutes.
- The exact target folder is `validation/ecommerce-figma-site/`; initialize no other Site checkout.
- Use exact service-exported assets or a clearly matching existing site asset. Never draw replacement SVG paths.
- `.sfp/`, raw snapshots, journals, private Draft references, raw captures, and temporary evidence are ignored from Git and hosting.
- Store no pairing/control credentials, absolute user paths, user identifiers, private Draft URL, or raw design payload in committed evidence.
- Record Community creator, listing/license/terms URL, checked date, fonts, and third-party image restrictions. Default deployment is private. Public/shared deployment requires license clearance and explicit user approval.
- Continue until service extraction, build, interaction tests, Chrome QA, redacted trace evidence, and private hosting pass, or an external sign-in/plugin/license/permission blocker needs user action.

## Source-complete Service Gate - Execute inside V1 after the clean scaffold commit

- Tasks1–16 and R19 have READY reviews. Only after V1 clean commit run one complete source-complete command; never mix runs.
- Immediately strict-validate the same run's exact three documents with `node service/scripts/source-complete-validator.mjs --candidate service/artifacts/preview-candidate.v1.json --evidence service/artifacts/source-complete-evidence.v1.json --marker service/artifacts/source-complete-preview.v1.json`. Require exactly those candidate/evidence/marker files, their three content-hash domains, marker file-byte hashes, and all sourceCommit/harness/artifact cross-field equalities.
- Hash the same run's `service/artifacts/artifact-manifest.v1.json` and `service/artifacts/SHA256SUMS`. Require those byte hashes to equal `PreviewCandidateV1.artifactManifestSha256`/`artifactChecksumsSha256`; require `service/artifacts/mcp.tgz`, `service/artifacts/cli.tgz`, and `service/artifacts/plugin.zip` byte hashes to agree across both metadata files, the candidate artifact tuple, and `SourceCompleteEvidenceV1.artifacts`. Any mismatch invalidates the whole run.
- Install only those same-run final artifacts during this gate: install `service/artifacts/mcp.tgz` and `service/artifacts/cli.tgz` into fresh ignored prefixes/caches under `.sfp/validation-runtime/`, and checksum-verify/extract `service/artifacts/plugin.zip`. Do not start a daemon, invoke CLI control, import the plugin, or bind port3055 until V3.
- Final registry is 116 tools/106 handlers/10 server-only and includes service snapshot/grounding/export functions required below.

## Evidence Schema

Create `validation/ecommerce-figma-site/service-evidence.schema.json`, `service-evidence.json`, `scripts/validate-service-evidence.mjs`, and `scripts/validate-service-evidence.test.mjs`. The draft-2020-12 schema uses `additionalProperties:false` at every object level and distinct reusable definitions:

- `RawDigest64`: exact `^[0-9a-f]{64}$`, used only for hashes of file bytes such as candidate/evidence/marker, artifact manifest, SHA256SUMS, MCP/CLI/plugin, snapshot files, and exported assets.
- `WireSha256`: exact `^sha256:[0-9a-f]{64}$`, used only for service/journal `resultHash`, configHash, and other wire-domain hashes.
- `RelativeArtifactPath`: normalized `/`-separated path beneath an explicit root, with no empty/dot/dot-dot segment, backslash, drive/UNC prefix, leading slash, NUL, or symlink escape.

Top-level `validationPhase` discriminates pre-extraction/final. Both phases bind source artifacts and daemonRun. Egress evidence records each configure/reset auditTransactionId plus pending/cas-intent/committed record IDs/hashes and expected/desired config hashes. Pre-extraction requires empty trace arrays; final requires reset and complete trace. No secret is stored.

`serviceOperations` is strict and binds unique operationId, kind/name, argsHash, workspaceId, fileExecutionKeyHash/targetBindingHash, succeeded, result/finalizer/receipt/generation, completedAt and packedClientDigest. Every field must match live status+receipt and current daemonRun; unrelated targets/old operations fail.

- `read`: exact operation names are tool `get_selection|get_design_context|search_nodes|get_local_components|component_map|token_map|icon_map` or service `grounding.refresh`. Any read referenced by a section requires nonnull canonical result artifact path/digest and receipt; unrelated reads may be nullable. Validator parses the named strict result schema, canonicalizes the bytes, recomputes resultHash, and proves referenced frame/node content exists.
- `snapshot`: `operationKind:'service'`, `operationName:'snapshot.capture'`, nonnull `sfp_snap1_` Snapshot ID, snapshot artifact path/digest, and `fidelity:'complete-leaf'` are mandatory.
- `export-asset`: exact export tool and a nonempty sorted unique artifact path/digest array are mandatory, supporting multi-file exports.

Other top-level arrays remain strict: `chromeActions` records only public URL/action/timestamp; `sections` requires complete-leaf canonical node, operation references, implementation files/selectors and explicit inferences; `assets` requires source node, an `export-asset` operation reference, exact path/digest and license note; `inferences` requires item/evidence/reason/tested viewports. Every section/asset operation reference must resolve exactly once and no operationId may duplicate.

The validator has two strict, mutually exclusive phases. V3 runs exactly `node scripts/validate-service-evidence.mjs --phase pre-extraction --service-root ../../service --packed-runtime .sfp/validation-runtime --asset-root public --evidence service-evidence.json --schema service-evidence.schema.json`. Pre-extraction runs schema/unit-negative fixtures, rehashes the three source-complete documents plus artifact-manifest/SHA256SUMS/final MCP/CLI/plugin, verifies the retained daemonRun binding, and requires current external-model egress config hash/classes/expiry. It explicitly rejects final reset fields and performs no final trace, operation, asset, section, or unresolved-empty requirement.

After V7 reset, final validates each AdminAudit transaction order `pending -> cas-intent -> committed`, exact config hashes, receipts, canonical artifacts, current reset state, and unresolved empty.

`validate-service-evidence.test.mjs` must fail independently for RawDigest64/WireSha256 prefix swaps, one-nibble file tamper, wrong daemon generation/start time/packed digest, forged/duplicate/missing or old unrelated operation, wrong receipt kind/name/status/result/finalizer, canonical read parse/hash/node mismatch, null/incomplete snapshot, missing/traversing/symlinked asset, asset byte/hash mismatch, dangling section/asset reference, broken/reordered/foreign AdminAudit chain, candidate/evidence tuple mismatch, configured/final egress hash or mode mismatch, nonempty unresolved output, and pre/final phase-field crossover. There is no blanket hash rule or mocked-success CLI seam in final validation.

---

### Task V1: Scaffold the Site before browser work

**Files:** create only `validation/ecommerce-figma-site/`.

**Interfaces:** produces an installed, runnable Sites project, retained dev server, exact Local URL, Site-root Git repository, and ignored raw-evidence paths. No product-specific edit or preview occurs yet.

- [ ] Confirm the target is absent or empty. As the first Sites/validation action, run exactly `npm create --yes @openai/sites@0.3.0 . -- --yes --add-ons shadcn --install` from that exact directory; do not use an older version or a second scaffold command.
- [ ] Immediately after scaffold/install, start the retained Site development server, record its exact Local URL and process handle, and keep all browsers closed. Register it in the V3-V7 outer cleanup contract so every success/failure stops and awaits it.
- [ ] Inspect only generated instructions, scripts, primary page/layout/style, and `.openai/hosting.json`.
- [ ] Initialize/verify a Git repository rooted at the Site directory for Sites hosting. Do not use the unrelated parent repository as the hosting source.
- [ ] Before capture, add ignore/exclusion rules for `.sfp/`, raw references, journals, screenshots, temporary evidence, private URLs, and service state.
- [ ] Commit the untouched scaffold plus ignore rules in the Site-root repository with subject `chore: scaffold ecommerce validation site`. Require `git -C validation/ecommerce-figma-site status --porcelain=v1 --untracked-files=all` empty and the parent repository clean; if the nested Site appears only as parent untracked state, add the exact directory to parent `.git/info/exclude` rather than a tracked product file, then recheck clean.
- [ ] Execute the complete Source-complete Service Gate above exactly once, validate its three documents and same-run artifact tuple, and install/extract the final artifacts only. Confirm no process owns port3055 and no plugin/CLI service call has started.

### Task V2: Open and duplicate the Figma target

**Files:** no site product source changes.

**Interfaces:** produces an editable Draft opened in Figma Desktop and non-design licensing metadata. It does not produce design values.

- [ ] Initialize the Chrome browser runtime with the explicit `chrome` selector and read its complete documentation once.
- [ ] Open the exact public URL in the persistent Chrome Figma tab and verify the free account can view it.
- [ ] Collect only non-design metadata: creator, public listing/license/terms URL, checked date, known font/image restrictions.
- [ ] Duplicate the Community file to Drafts through visible UI. If sign-in blocks it, ask the user to sign in in Chrome and continue after confirmation.
- [ ] Open the editable duplicate in Figma Desktop. Import/run the checksum-verified extracted manifest from the same-run final `plugin.zip` via computer-use or explicit user handoff; never import the ZIP itself or a prior build.

### Task V3: Pair and extract exclusively through the service

**Files:** service-owned raw artifacts stay ignored under `.sfp`; committed output is the redacted evidence skeleton only.

**Interfaces:** launches exactly one retained checksum-verified packed daemon child, temporarily configures product egress, and produces stable file identity, canonical landing-frame ID, complete-leaf SnapshotV1 evidence, GroundingGraphV1, token/assets/screenshots, and service operation trace.

- [ ] Resolve the platform default owner stateRoot without override: `%LOCALAPPDATA%\SuperFigmaPipeline` on Windows, `$HOME/Library/Application Support/SuperFigmaPipeline` on macOS, and `$XDG_STATE_HOME/super-figma-pipeline` with documented home fallback on Linux. The only port is `3055`.
- [ ] Before probe/spawn enter outer guard with `egressState:'not-attempted'` and nullable daemon/client/plugin. Finally resets only `must-reconcile`, never `reset-verified`, then closes clients, daemon/port and Sites; cleanup errors block.
- [ ] Publicly probe port3055. Any pre-existing listener is an immediate blocker; send no follower/control proof or credential, never adopt/kill it, and require the user to stop it outside this run before restarting V3.
- [ ] Launch exactly one checksum-verified packed-dist Node child on default stateRoot/3055, store it in the guard, verify ready/ping then LocalDaemonBindingVerifier proof, and retain through V7. No second start.
- [ ] Point the checksum-verified plugin and packed CLI's fixed discovery at that same default stateRoot/port. Run packed `sfp status --json`, register the exact Site directory, issue the pairing challenge, enter it in the plugin, then run `sfp doctor --round-trip --json`; no custom port/stateRoot body or environment override is allowed.
- [ ] After proof and same-run observed-build match, require prior egress exactly unknown. Set `egressState:'must-reconcile'` before configure POST. On ambiguous response reconcile status+audit; query one transaction pending/cas-intent/committed with exact hashes. Record no consent.
- [ ] Optionally on current Windows, run the strict current-windows diagnostic. It is supplemental only; authenticated pair/doctor and service operations remain authoritative.
- [ ] Revalidate the exact three source-complete documents, same-run artifact manifest/SHA256SUMS, candidate/evidence artifact tuple, `/ping` product/build identity, egress config hash/classes/expiry, supported `sfp status` fields, file identity, editor capability, and empty `sfp operations unresolved --json` result before semantic extraction.
- [ ] Run `npm install -D ajv@8.17.1`, create schema/validator/negative tests and a `validationPhase:'pre-extraction'` skeleton with empty trace arrays, then run exact `node scripts/validate-service-evidence.mjs --phase pre-extraction --service-root ../../service --packed-runtime .sfp/validation-runtime --asset-root public --evidence service-evidence.json --schema service-evidence.schema.json`. This must pass before the first semantic `sfp tools call`.
- [ ] Invoke semantic tools only through packed generic CLI with `--capture-result`; the server derives `.sfp/operation-evidence/<operationId>/result.v1.json`. Discover the frame from canonical artifacts and record packed CLI digest, operation ID and evidence receipt.
- [ ] Capture context/SnapshotV1 recursively. Every section-referenced read requires `--capture-result` and nonnull receipt artifact.
- [ ] Require complete-leaf evidence for every section to implement. Partial fidelity is allowed only for named out-of-scope UI-kit nodes; omitted in-scope content blocks implementation.
- [ ] Build GroundingGraphV1 and record its exact repo-relative artifact path/hash. If the source-complete service lacks a production graph interface, stop with a capability-negative blocker.
- [ ] Use exact generic calls for screenshot/save/map/token/icon/export. Reads use `--capture-result`; exports use validated tool output args and sorted multi-artifact receipts. Verify target/args/result/finalizer/generation and bytes/digests.

### Task V4: Build the first service-grounded slice and preview

**Files:** modify the Site's primary page/layout/style and exact exported assets.

**Interfaces:** produces the smallest recognizable first viewport, refreshed graph evidence, and the Sites first meaningful preview.

- [ ] Implement the hero/header slice using only complete-leaf service evidence, exact copy, tokens, and exported assets.
- [ ] Record every section/source mapping and any inference in the evidence schema.
- [ ] Refresh/revalidate GroundingGraphV1 now that code files exist; stale/absent code edges must not be reported as verified.
- [ ] Compile the slice and make one lightweight non-browser request to the exact Local URL. Require non-error response.
- [ ] Make no additional planned product-source edits before the handoff. Use `open_in_codex`, retain its stable Sites preview tab ID, and show the first meaningful preview.
- [ ] After that preview only, inspect social-preview support. If missing, dispatch exactly one image-only subagent with the service-derived brief. The main agent never invokes ImageGen directly; it alone saves/integrates the returned bitmap and records origin/RawDigest64.

### Task V5: Complete the page from service evidence

**Files:** modify only the focused page/components/styles/public assets/metadata required by the one validation route.

**Interfaces:** produces the complete responsive landing page and final refreshed grounding evidence.

- [ ] Implement all in-scope sections in canonical service-derived order. Reuse tokens/components/assets and record section-to-operation-to-file/selectors.
- [ ] Preserve observed desktop typography, widths, grids, gaps, colors, radii, overlays, content, and asset crop. Distinguish observed values from inferred mobile behavior.
- [ ] Implement navigation, CTA targets, cards/galleries/footer, and responsive menu only where required by the design or a documented inference.
- [ ] Add landmarks, alt text, labels, visible focus, keyboard order, menu Escape/close, touch behavior, and reduced motion.
- [ ] Set accurate title/description/Open Graph/X metadata. Do not invent a generic social card or reuse expiring Figma URLs.
- [ ] Remove starter-only content/dependencies. Refresh GroundingGraphV1 and mark stale or manual mappings honestly.

### Task V6: Iterate with service screenshots and Chrome QA

**Files:** update site source; save only redacted comparison/evidence artifacts allowed by the schema.

**Interfaces:** produces a resolved discrepancy ledger, functional/browser checks, and production build.

- [ ] Capture matching Figma references through the service and site renders in the persistent Sites preview/Chrome QA surfaces.
- [ ] Compare copy, section order, geometry, imagery, color, typography, spacing, card count, borders, and responsive order. Every discrepancy cites service artifact IDs.
- [ ] Fix the largest discrepancy and repeat until no placeholder/missing section/broken interaction/obvious drift remains.
- [ ] Test desktop fidelity separately from inferred mobile reflow. Record mobile inference explicitly.
- [ ] Test nav/CTA destinations, menu open/close/Escape, keyboard focus order, viewport reflow, asset/request 404s, network failures, and browser console/runtime errors.
- [ ] Run production build and scaffold-provided tests; if none exist, add focused interaction/responsive tests. Require exit 0.
- [ ] Query `sfp operations status` for every recorded operation and `sfp operations unresolved --json`; require matching settled records and an empty unresolved list. Limit the audit conclusion to this tested trace.

### Task V7: Redacted evidence and private Sites handoff

**Files:** create `VALIDATION.md`, `service-evidence.schema.json`, `service-evidence.json`, `scripts/validate-service-evidence.mjs`, `scripts/validate-service-evidence.test.mjs`, and final metadata/README changes.

**Interfaces:** validates the recorded service trace while the one retained daemon is alive, resets and verifies fail-closed egress state, stops that exact child, and produces reproducible service acceptance evidence plus private deployment.

- [ ] Assemble public source/creator/license metadata, the same-run candidate/evidence/marker and artifact-manifest/SHA256SUMS/final-artifact hashes, `daemonLaunch:'packed-dist-node'`, stable file identity kind, canonical frame, snapshot/graph fidelity, discriminated operation/section/asset trace, egress before/configured hashes/classes/expiry, tested viewports, build/test results, and unresolved limitations. Record no consentId, nonce, credential, raw generation, absolute stateRoot, or private Draft URL.
- [ ] Reset through packed CLI, fsync/query reset audit and verify unknown status, then set `egressState:'reset-verified'` and evidence phase final. Do not stop daemon before final validation.
- [ ] Run `node scripts/validate-service-evidence.test.mjs`, then, while the exact V3 daemon child is alive, run exactly `node scripts/validate-service-evidence.mjs --phase final --service-root ../../service --packed-runtime .sfp/validation-runtime --asset-root public --evidence service-evidence.json --schema service-evidence.schema.json`. Require all Ajv/file/hash/candidate/receipt/audit/operation/snapshot/asset/reference checks, final unknown-fail-closed egress status/hash, and packed-CLI evidence/status plus unresolved queries to pass before continuing.
- [ ] On the normal V7 path after validation/reset, close packed CLI/plugin clients, terminate and await the exact packed-dist Node PID, and require port3055 closed. The outer guard performs the identical actions on every exceptional exit and still retains the Sites dev child through build/package/deploy.
- [ ] Reload current Sites skills before final build. Call `create_site` only if hosting.json lacks project_id; persist it immediately. On retry reuse project_id and call `create_source_repository_write_credential` for a replacement. Keep credential memory-only/owner-private and never log/store it.
- [ ] Run final build and source+dist scan, commit, then push the validated branch using a per-command HTTP Authorization header. Never place credential in remote URL or git config. Resolve branch-head commit_sha and require index/source/package bytes identical.
- [ ] Run current skill `package-site.sh` to an accessible `.tar.gz`. Safely list/extract/scan it. Write provenance only to ignored `.sfp/hosting-provenance.v1.json` outside package input, binding archive/file digests, project_id and commit_sha; validate it separately so committed source/package bytes stay unchanged. Never claim provider-internal archives were scanned.
- [ ] Save exactly one version with project_id, scanned archive and commit_sha; retain version_id. Use `get_site` to require owner-only, call `deploy_private_site_version`, retain deployment_id, poll terminal success, and open the exact URL in the retained V4 tab. Shared/ambiguous access requires explicit approval path.

## Verification Checklist

- [ ] V1 used exactly Sites0.3.0+shadcn, committed and cleaned the scaffold first, then ran one clean `pnpm -C service verify:source-complete`; candidate/evidence/marker and same-run manifest/SHA256SUMS/MCP/CLI/plugin hashes all matched.
- [ ] V3 launched exactly one checksum-verified packed-dist Node daemon at platform-default stateRoot/port3055; fixed plugin/CLI discovery used it, and V7 awaited that exact child and confirmed port close.
- [ ] Egress began exactly unknown-fail-closed, external-model used only the four explicit classes with each TTL<=2h and exposed no consent secret, and V7 reset then verified a fresh unknown-fail-closed status.
- [ ] The exact validator CLI rehashed source-complete/artifact/asset bytes, queried every referenced operation through the same-run packed CLI while the daemon was alive, required succeeded/exact result hashes/complete snapshots/export files, and found unresolved empty.
- [ ] Every implemented Figma fact is traceable to a service operation/artifact.
- [ ] Chrome was not used as a semantic extraction substitute.
- [ ] All in-scope sections have complete-leaf evidence; partial out-of-scope nodes are named.
- [ ] Snapshot and GroundingGraph were refreshed after first slice and final implementation.
- [ ] Site build/interactions/responsive/keyboard/assets/console checks pass.
- [ ] Exact exported assets are durable local files, not expiring URLs.
- [ ] If a social-preview image was generated after V4, the image-only worker changed no Site file and the main agent recorded/integrated its bitmap and RawDigest64.
- [ ] Staged files and deployment contain no raw service/private data.
- [ ] Community license metadata supports the chosen private deployment.
