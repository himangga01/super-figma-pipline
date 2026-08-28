# eCommerce Figma Service Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: `figma-design-to-code`, `chrome:control-chrome`, `sites-building`, `sites-hosting`, conditionally `computer-use`; exactly one image-only subagent only if needed. Run after R24 READY and Tasks1-16 source-complete; main remains sole Site editor.

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

- Tasks1-16 are implemented/reviewed at the source-complete commit and R24 is READY. Only after V1 clean commit run one source-complete command; never mix runs.
- Immediately strict-validate the same run's exact three documents with `node service/scripts/source-complete-validator.mjs --candidate service/artifacts/preview-candidate.v1.json --evidence service/artifacts/source-complete-evidence.v1.json --marker service/artifacts/source-complete-preview.v1.json`. Require exactly those candidate/evidence/marker files, their three content-hash domains, marker file-byte hashes, and all sourceCommit/harness/artifact cross-field equalities.
- Hash the same run's `service/artifacts/artifact-manifest.v1.json` and `service/artifacts/SHA256SUMS`. Require those byte hashes to equal `PreviewCandidateV1.artifactManifestSha256`/`artifactChecksumsSha256`; require `service/artifacts/mcp.tgz`, `service/artifacts/cli.tgz`, and `service/artifacts/plugin.zip` byte hashes to agree across both metadata files, the candidate artifact tuple, and `SourceCompleteEvidenceV1.artifacts`. Any mismatch invalidates the whole run.
- Install only those same-run final artifacts during this gate: install `service/artifacts/mcp.tgz` and `service/artifacts/cli.tgz` into fresh ignored prefixes/caches under `.sfp/validation-runtime/`, and checksum-verify/extract `service/artifacts/plugin.zip`. Do not start a daemon, invoke CLI control, import the plugin, or bind port3055 until V3.
- Final registry is 116 tools/106 handlers/10 server-only and includes service snapshot/grounding/export functions required below.

## Evidence Schema

Create `validation/ecommerce-figma-site/service-evidence.schema.json`, `service-evidence.json`, `scripts/validate-service-evidence.mjs`, and `scripts/validate-service-evidence.test.mjs`. The draft-2020-12 schema uses `additionalProperties:false` at every object level and distinct reusable definitions:

- `RawDigest64`: exact `^[0-9a-f]{64}$`, used only for hashes of file bytes such as candidate/evidence/marker, artifact manifest, SHA256SUMS, MCP/CLI/plugin, snapshot files, and exported assets.
- `WireSha256`: exact `^sha256:[0-9a-f]{64}$`, used only for service/journal `resultHash`, configHash, and other wire-domain hashes.
- `RelativeArtifactPath`: normalized `/`-separated path beneath an explicit root, with no empty/dot/dot-dot segment, backslash, drive/UNC prefix, leading slash, NUL, or symlink escape.

Top-level phase discriminates pre/final. Both bind strict `daemonRun {pid,startedAt,generationHash,buildId,buildIdentityHash,packedMcpDigest}`. Operations require `completedAt>=startedAt`, the same generation/build/current packed client, exact kind/name/args/workspace/target/capture intent, exact terminal status and reciprocal receipt/finalizer links. Egress records only redacted audit transaction IDs/record hashes/config hashes/classes/expiry; no consent, nonce, credential or raw config.

`generationHash=sha256('sfp-daemon-generation-v1\0'+exact UTF-8 /ping leaderGeneration)`; the fixed `gen-1` vector is `sha256:b99ac52409d1ae7844b75ebd2aaeae3eb81a091857c89dcf832d3cabf03ac7e4`. Every receipt must match it.

Final top-level also strictly requires chromeActions, sections, assets, inferences, license `{creator,listingUrl,termsUrl,checkedAt,notes}`, builds and tests with exact command/status/digest fields; unknown keys reject.

`validatedSiteSourceManifestHash` is authoritative over every tracked Site build input except exactly `VALIDATION.md`, `service-evidence.json`, `service-evidence.schema.json`, `scripts/validate-service-evidence.mjs`, `scripts/validate-service-evidence.test.mjs`, and ignored `.sfp/**`. Enumerate `git ls-files --stage`, accept only modes100644/100755, reject symlink/submodule/duplicate/non-UTF-8 paths, read staged Git blob bytes rather than the working tree, UTF-8-byte sort paths, and emit `<path>\0<RawDigest64(file bytes)>\n`. The wire hash is `sha256('sfp-validated-site-source-manifest-v1\0'+manifestBytes)`. After commit, regenerate from `git ls-tree -r HEAD` and require identical rows/hash. Tests mutate a component, library module and build config independently and require mismatch; evidence-only edits do not alter the product hash.

`serviceOperations` contains only finalized `succeeded|failed` operations. Its strict discriminated rows bind unique operationId, operation kind/name, evidence kind, argsHash, workspaceId, nullable fileExecutionKeyHash/targetBindingHash, captureIntentHash/captureResult, terminalStatus, resultHash/resultBytes/resultArtifact, nativeEvidence, finalEgressManifestHash, operationEvidenceReceiptHash, daemonGenerationHash, completedAt and packedClientDigest. Succeeded requires resultHash/bytes; failed requires resultHash null, bytes0, resultArtifact null and bounded `operation-failed` no-artifact reason. Every field must match live packed-CLI status, receipt and finalizer and the current daemonRun; unrelated targets, generations, clients and old operations fail.

Only `terminalStatus:'succeeded' && captureResult:true` permits nonnull resultArtifact; failed capture is null. Native evidence remains orthogonal and may coexist on succeeded export.

`negativeChecks` is a closed union and the final evidence requires at least one current-run row of every variant: `fresh-pre-admission` (no operation record, dispatch0/runtime0/receipt null), `admitted-rejected` (rejected terminal, NoOutput finalizer, runtime0/receipt null), `approval-expired`, `approval-rejected`, `approval-duplicate`, `nonce-duplicate`, `same-id-conflict`, and `settled-replay`. Every row binds current packedClientDigest, observedAt, operationId where issued, exact status/errorCode, dispatchCalls/runtimeCalls/newReceiptCount, and existingReceiptContentHash before/after when applicable. Conflict/replay require no new runtime/receipt and unchanged existing receipt; approval and nonce duplicates are distinct. Finalized runtime failures live only in serviceOperations with failed receipt/no-artifact.

- `resultArtifact`: nonnull iff terminal succeeded and capture=true; failed/rejected/unknown are null. Section references require strict canonical schema/node/frame proof.
- `snapshot`: snapshot.capture exact locator/id/ref/checksum/fidelity/path/digest.
- `grounding-graph`: grounding.refresh exact graph locator/path/digest/checksum/fidelity.
- Native `export`: exactly save_screenshots/save_image_fills/export_pdf/export_video/export_frames_to_pdf and export_tokens with a nonnull output path. The receipt stores one canonical manifest reference `{manifestRelativePath,manifestDigest64,artifactCount,totalArtifactBytes}`; the manifest contains 1..256 normalized unique sorted member path/digest/byte rows. Other tools use native no-artifact; snapshot/graph use their dedicated discriminator.

The evidence matrix never overloads operation kind. Every canonical tool, including registry `read|write|local` tools, records `operationKind:'tool'`; snapshot/graph record `operationKind:'service'`. `get_design_context|get_screenshot|component_map|token_map|icon_map` use native `no-artifact` and rely on the orthogonal captured result artifact when requested. The six named exporters use native `export`; `snapshot.capture` uses native `snapshot`; `grounding.refresh` uses native `grounding-graph`; all other operations use native `no-artifact`. The validator rejects a specialized evidence discriminator on any other name.

Sections reference a captured `resultArtifact` only from a succeeded capture. Assets reference an exact member loaded from the native export manifest, with source node/path/digest/bytes/license; the manifest reference and every member are rehashed from disk. Every reference resolves exactly once. Each accepted export also uses capture=true, and the captured strict result's source-node/path mapping must equal the native manifest members.

The validator has two strict, mutually exclusive phases. V3 runs exactly `node scripts/validate-service-evidence.mjs --phase pre-extraction --service-root ../../service --packed-runtime .sfp/validation-runtime --asset-root public --evidence service-evidence.json --schema service-evidence.schema.json`. Pre-extraction runs schema/unit-negative fixtures, rehashes the three source-complete documents plus artifact-manifest/SHA256SUMS/final MCP/CLI/plugin, verifies the retained daemonRun binding, and requires current external-model egress config hash/classes/expiry. It explicitly rejects final reset fields and performs no final trace, operation, asset, section, or unresolved-empty requirement.

After V7 reset, final validates each AdminAudit transaction order `pending -> cas-intent -> committed`, exact config hashes, receipts, canonical artifacts, current reset state, and unresolved empty.

`validate-service-evidence.test.mjs` must fail independently for RawDigest64/WireSha256 prefix swaps, one-nibble file tamper, wrong daemon generation/start time/build identity/packed digest, forged/duplicate/missing or old unrelated operation, wrong target/capture intent, wrong receipt kind/name/status/result/finalizer, canonical read parse/hash/node mismatch, failed-capture nonnull artifact, null/incomplete snapshot, missing/traversing/symlinked native manifest/member, count/order/byte/digest mismatch, dangling section/asset reference, broken/reordered/foreign AdminAudit store response, missing required negative variant, changed replay receipt, candidate/evidence tuple mismatch, configured/final egress hash or mode mismatch, nonempty unresolved output, and pre/final phase-field crossover. There is no blanket hash rule or mocked-success CLI seam in final validation.

---

### Task V1: Scaffold the Site before browser work

**Files:** create only `validation/ecommerce-figma-site/`.

**Interfaces:** produces an installed, runnable Sites project, retained dev server, exact Local URL, Site-root Git repository, and ignored raw-evidence paths. No product-specific edit or preview occurs yet.

- [ ] Confirm the target is absent or empty. As the first Sites/validation action, run exactly `npm create --yes @openai/sites@0.3.0 . -- --yes --add-ons shadcn --install` from that exact directory; do not use an older version or a second scaffold command.
- [ ] Immediately before dev spawn create one top-level V1-V7 `try/finally` guard with nullable `sitesDevChild`, `daemonChild`, `pluginSession`, `controlClient`, `packedCliExecutable`, `daemonRun`, and `egressState:'not-attempted'|'must-reconcile'|'reset-verified'`. Assign each child immediately after spawn. Every normal/error exit idempotently closes/nulls plugin and client, resets and verifies egress only when state is `must-reconcile`, terminates/awaits the exact daemon child and port close, and terminates/awaits the Sites dev child. Cleanup errors remain blockers and are never hidden by the original error.
- [ ] Immediately after scaffold/install, start the retained Site dev server and assign its handle to the already-created V1-V7 guard; browsers remain closed.
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
- [ ] Before V3 probe reuse the existing V1 guard; do not create a nested lifecycle owner. Initialize its V3 nullable fields and preserve the already-retained Sites child. Cleanup resets only `must-reconcile`; after a verified final reset the state is `reset-verified` so neither V7 nor finally performs a second reset.
- [ ] Publicly probe port3055. Any pre-existing listener is an immediate blocker; send no follower/control proof or credential, never adopt/kill it, and require the user to stop it outside this run before restarting V3.
- [ ] Launch one packed-dist child, assign the guard handle immediately, publicly probe, authenticate the retained PID/port/generation with the follower challenge proof, then compare the observed buildId/buildIdentityHash with same-run evidence before transmitting any control bearer. Retain this exact child through the final validator.
- [ ] Use packed CLI fixed discovery for nonsemantic status, workspace registration and pairing only; no doctor/semantic tool yet.
- [ ] After proof and same-run observed-build match, require prior egress exactly unknown. Set `egressState:'must-reconcile'` before configure POST. On ambiguous response reconcile status+audit; query one transaction pending/cas-intent/committed with exact hashes. Record no consent.
- [ ] Audit acceptance requires `chainVerified:true` plus checkpointContentHash/anchorContentHash and exact transaction rows from live packed endpoint; client does not reconstruct private chain links.
- [ ] If TTL renewal is necessary, it is a new full configure transaction: keep must-reconcile, issue a new nonce/consent, verify pending/cas-intent/committed audit and append its redacted transaction evidence. No silent extension or overwritten audit reference.
- [ ] Optionally on current Windows, run the strict current-windows diagnostic. It is supplemental only; authenticated pair/doctor and service operations remain authoritative.
- [ ] Revalidate the exact three source-complete documents, same-run artifact manifest/SHA256SUMS, candidate/evidence artifact tuple, `/ping` product/build identity, egress config hash/classes/expiry, supported `sfp status` fields, file identity, editor capability, and empty `sfp operations unresolved --json` result before semantic extraction.
- [ ] Run `npm install -D ajv@8.17.1`, create schema/validator/negative tests and a `validationPhase:'pre-extraction'` skeleton with empty trace arrays, then run exact `node scripts/validate-service-evidence.mjs --phase pre-extraction --service-root ../../service --packed-runtime .sfp/validation-runtime --asset-root public --evidence service-evidence.json --schema service-evidence.schema.json`. This must pass before the first semantic `sfp tools call`.
- [ ] Run one retained `sfp doctor --round-trip --json` call. For each approval-required matrix cell, query packed `sfp approvals list --json`, bind exact operationId/approvalId/promptHash/channel/target, approve exactly once and prove one runtime. Use separate fresh operations to prove reject and expiry produce runtime0, wrong prompt hash rejects, and duplicate settlement rejects without extending TTL or adding a runtime/receipt. Record all positive/negative IDs in the strict evidence union; never create an untracked call.
- [ ] Invoke semantic tools only through the same-run packed generic CLI using strict nested control envelopes. For captured reads pass boolean `--capture-result`; the server derives `.sfp/operation-evidence/<operationIdDigest64>/result.v1.json`, where the digest is the lowercase SHA-256 under `sfp-operation-evidence-path-v1\0`. Invoke `get_design_context`, `get_screenshot`, `component_map`, `token_map`, and `icon_map` with capture; invoke `save_screenshots`, `save_image_fills`, `export_pdf`, `export_video`, `export_tokens`, and `export_frames_to_pdf` with their normal validated output args plus capture. Record packed CLI digest, operation ID, receipt content hash and finalizer hash for each; no arbitrary result path is accepted.
- [ ] Capture context/SnapshotV1 recursively. Every section-referenced read requires `--capture-result` and nonnull receipt artifact.
- [ ] Require complete-leaf evidence for every section to implement. Partial fidelity is allowed only for named out-of-scope UI-kit nodes; omitted in-scope content blocks implementation.
- [ ] Build GroundingGraphV1 and record its exact repo-relative artifact path/hash. If the source-complete service lacks a production graph interface, stop with a capability-negative blocker.
- [ ] Every accepted export call also sets `--capture-result`; captured strict result source-node/path mapping must equal the fsynced native artifact manifest members. Load and verify its manifest path/digest/count/total bytes, then every 1..256 normalized member path/digest/byte count. Verify target/args/capture/result/finalizer/generation and every digest.

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

**Files:** finalize/modify the V3-created schema/evidence/validator/tests plus `VALIDATION.md` and final metadata/README.

**Interfaces:** validates the recorded service trace while the one retained daemon is alive, resets and verifies fail-closed egress state, stops that exact child, and produces reproducible service acceptance evidence plus private deployment.

- [ ] If `.openai/hosting.json` has no `project_id`, call `create_site` exactly once and persist the returned ID immediately; on retry reuse that ID. Retry only a temporary transport failure or explicit slug conflict; quota, permission and access errors are terminal. Reuse a still-valid source write credential already held by this run; call `create_source_repository_write_credential` only when it is absent or expired. Keep credentials memory-only and never write them to a remote URL, Git config, evidence or logs.
- [ ] Complete every final product edit, production build, interaction test and exact source+`dist` scan after project persistence. Stage the final product inputs and generate the exact `validatedSiteSourceManifestHash` from staged Git blob bytes using the authority above. No final evidence is part of this product hash.
- [ ] While the retained daemon is alive, reset egress through the packed CLI, require the matching audit transaction terminal and new redacted `unknown-fail-closed` status, then set `egressState:'reset-verified'`. Finalize the serviceOperations/native manifests/negativeChecks/audit evidence, run all Site tests, and run the full `--phase final` validator. It queries packed `sfp operations status` and `operations evidence` for every reference, requires reciprocal receipt/finalizer/terminal links and unresolved-empty, and records no raw result.
- [ ] Stage and commit the final tracked tree. Require clean HEAD; regenerate product-manifest rows/hash from HEAD blobs and require exact equality. Rerun the identical final validator while the daemon remains alive and byte-compare `git ls-tree` plus working/index status before/after. From that successful validator onward no tracked/product byte may change; any change returns to V6/V7 and repeats build, manifest, reset/evidence, test, commit and both final validations.
- [ ] Close/null the packed CLI client and plugin session, terminate/await the exact daemon child, and prove port3055 closed. Leave only the Sites dev child in the top-level guard until deployment finishes.
- [ ] Push the exact validated HEAD/branch using an HTTP Authorization header supplied only to that command; never persist it in the remote URL/config. Verify the hosting branch head commit_sha equals local HEAD.
- [ ] Run the current Sites skill's exact root-level helper `scripts/package-site.sh <project> <archive>` once against that HEAD. Before extraction list every tar member and reject absolute paths, `..`, backslash, symlink, hardlink, device, duplicate or unexpected roots. Extract to a secure ignored temp and byte-compare packaged `dist/`, `.openai/hosting.json`, and `.openai/migrations/` with the current validated tree. Write ignored `.sfp/site-build-provenance.v1.json` outside package input, binding HEAD, product-manifest hash, dist/hosting/migration member hashes, archive RawDigest64 and sorted member hashes; validate it separately.
- [ ] Call `save_site_version(project_id, commit_sha, archive)` exactly once and retain its `version_id`; do not create a second version on poll/deploy failure. Call `get_site(project_id)`. Owner-only is exactly `current_user_role:'owner'`, `access_policy.access_mode:'custom'`, `allowed_account_user_ids` containing exactly the current account user and no other ID, `external_visitor_count:0`, and empty workspace/tenant group ID lists.
- [ ] If owner-only, call `deploy_private_site_version(project_id,version_id)`. If access is shared or ambiguous, use one `request_user_input` question that states the resolved access and offers the explicit deploy action first plus `Not now`; only approval calls `deploy_site_version(project_id,version_id)`. `site_not_owner_only` is terminal for private deployment and is never retried as private. Poll only `get_deployment_status(deployment_id)` to terminal success/failure, then open the exact successful URL in the retained V4 Sites tab.
- [ ] Terminate/await the retained Sites dev child and prove its port closed; set its guard handle null. The outer finally still runs idempotently on normal success and every earlier failure.

## Verification Checklist

- [ ] V1 used exactly Sites0.3.0+shadcn, committed and cleaned the scaffold first, then ran one clean `pnpm -C service verify:source-complete`; candidate/evidence/marker and same-run manifest/SHA256SUMS/MCP/CLI/plugin hashes all matched.
- [ ] V3 launched exactly one checksum-verified packed-dist Node daemon at platform-default stateRoot/port3055; fixed plugin/CLI discovery used it, and V7 awaited that exact child and confirmed port close.
- [ ] Egress began exactly unknown-fail-closed, external-model used only the four explicit classes with each TTL<=2h and exposed no consent secret, and V7 reset then verified a fresh unknown-fail-closed status.
- [ ] The exact validator CLI rehashed source-complete/artifact/asset bytes, queried every referenced operation through the same-run packed CLI while the daemon was alive, required succeeded/exact result hashes/complete snapshots/export files, and found unresolved empty.
- [ ] The final evidence contains at least one same-run row for every strict negative variant, and every settled replay/conflict proves unchanged existing receipt plus zero new runtime/receipt.
- [ ] `validatedSiteSourceManifestHash` covers every non-evidence tracked mode100644/100755 input from staged blobs and then identical HEAD blobs; component/lib/config mutation fixtures fail.
- [ ] The final push used exact validated HEAD, package members byte-match current dist/hosting/migrations, one version was saved, access was resolved through `get_site`, the correct private-or-approved deployment route was used, terminal deployment was polled, and the same retained Site tab opened the deployed URL before the Sites child stopped.
- [ ] Every implemented Figma fact is traceable to a service operation/artifact.
- [ ] Chrome was not used as a semantic extraction substitute.
- [ ] All in-scope sections have complete-leaf evidence; partial out-of-scope nodes are named.
- [ ] Snapshot and GroundingGraph were refreshed after first slice and final implementation.
- [ ] Site build/interactions/responsive/keyboard/assets/console checks pass.
- [ ] Exact exported assets are durable local files, not expiring URLs.
- [ ] If a social-preview image was generated after V4, the image-only worker changed no Site file and the main agent recorded/integrated its bitmap and RawDigest64.
- [ ] Staged files and deployment contain no raw service/private data.
- [ ] Community license metadata supports the chosen private deployment.
