# eCommerce Figma Service Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: `figma-design-to-code`, `chrome:control-chrome`, `sites-building`, `sites-hosting`, and conditionally `computer-use` for Figma Desktop. The main agent is the sole Site owner. Run only after Super Figma Pipeline Tasks 1–16 are source-complete and independently reviewed.

**Goal:** Use the completed Super Figma Pipeline service—not direct browser imitation—to understand the supplied Figma Community file, implement a faithful page in `validation/ecommerce-figma-site/`, and prove the service→code→browser loop.

**Architecture:** Chrome handles the public Community listing, duplication, and final QA. Figma Desktop runs the local development plugin. All semantic design facts, tokens, components, assets, screenshots, and interactions used by code come from authenticated service operations, SnapshotV1, GroundingGraphV1, and exported artifacts. The validation site is a standalone OpenAI Sites project and Git repository.

**Tech Stack:** source-complete `service/` artifacts, Chrome, Figma Desktop plugin, `@openai/create-sites@0.2.0`, TypeScript/React/Vinext/CSS, OpenAI Sites hosting.

**Target:** `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/eCommerce-Website-%7C-Web-Page-Design-%7C-UI-KIT-%7C-Interior-Landing-Page--Community-?node-id=0-1`.

## Binding Rulings

- The user's service-only extraction requirement overrides `figma-design-to-code`'s official `get_design_context` step. Load that skill for adaptation, asset, reuse, and fidelity rules, but treat successful local service context/snapshot artifacts as the mandatory design-context prerequisite. Do not call official Figma MCP. If service extraction fails, stop; never fall back to screenshot/manual layer imitation.
- Use the exact Chrome family selector and complete Chrome documentation. Do not substitute the in-app browser, Edge, an unnamed extension, `getDefault`, or `getForUrl`. If Chrome is unavailable, instruct the user to install/enable the ChatGPT Chrome extension under Settings → Computer use.
- Use `computer-use` for Figma Desktop only when available and loaded; otherwise explicitly hand the Desktop import/run/pair step to the user. Chrome is not a substitute for the Desktop development-plugin host.
- The Sites first-preview tab and the Chrome Figma tab are separate persistent tabs. Reuse each tab in its own browser surface; do not claim one shared tab.

## Global Constraints

- The validation site is the service's SUT acceptance artifact. Every Figma-derived implementation decision maps to a service operation/artifact.
- Official Figma MCP, browser-only layer reading, manually copying visible CSS, and screenshot-only imitation are prohibited substitutes.
- The exact target folder is `validation/ecommerce-figma-site/`; initialize no other Site checkout.
- Use exact service-exported assets or a clearly matching existing site asset. Never draw replacement SVG paths.
- `.sfp/`, raw snapshots, journals, private Draft references, raw captures, and temporary evidence are ignored from Git and hosting.
- Store no pairing/control credentials, absolute user paths, user identifiers, private Draft URL, or raw design payload in committed evidence.
- Record Community creator, listing/license/terms URL, checked date, fonts, and third-party image restrictions. Default deployment is private. Public/shared deployment requires license clearance and explicit user approval.
- Continue until service extraction, build, interaction tests, Chrome QA, redacted trace evidence, and private hosting pass, or an external sign-in/plugin/license/permission blocker needs user action.

## Source-complete Service Preconditions

- Tasks 1–16 passed independent reviews and `pnpm -C service verify:release`.
- Launch the packed MCP/CLI/plugin artifacts being tested, not source from a different build.
- Compute SHA-256 for the exact packed MCP tarball, CLI tarball, and plugin ZIP and compare them with Task 15's release checksum manifest before launch. Verify `/ping` product/build identity separately. Use `sfp status --json` only for its supported product/role/version fields; do not expect it to report artifact hashes.
- Final registry is 116 tools/106 handlers/10 server-only and includes service snapshot/grounding/export functions required below.

## Evidence Schema

Create both `validation/ecommerce-figma-site/service-evidence.schema.json` and `service-evidence.json`. The JSON Schema is draft 2020-12, sets `additionalProperties:false` at every object level, requires every field below, defines status/tool/action enums, requires 64-character lowercase SHA-256 patterns, permits only normalized relative paths without `..`, drive letters, or leading slash, and rejects credential/private-URL field names. `service-evidence.json` contains these top-level arrays:

- `serviceOperations`: operationId, tool, status, resultHash, artifactHash, snapshotId, timestamp.
- `chromeActions`: public URL, action category, timestamp; no private Draft URL or page content.
- `sections`: canonical frame/node ID, plan path, complete-leaf fidelity, operation IDs, implemented files/selectors, inferred fields.
- `assets`: source node, export operation, SHA-256, durable repo-relative site path, license note.
- `inferences`: item, evidence, reason, tested viewports.

Hard gates: every recorded operation is settled, the authenticated `sfp operations unresolved --json` result is empty, every in-scope section is a complete leaf, and no forbidden field appears. Validate with `npm install -D ajv@8.17.1` and `node scripts/validate-service-evidence.mjs service-evidence.schema.json service-evidence.json`; the script uses Ajv strict mode and exits nonzero on any error. For each `serviceOperations` row, run `sfp operations status <operationId> --json` and compare tool/status/resultHash. Scope the negative claim to the recorded operation set plus the current unresolved list; do not claim global absence of attempts from an unspecified journal export.

---

### Task V1: Scaffold the Site before browser work

**Files:** create only `validation/ecommerce-figma-site/`.

**Interfaces:** produces an installed, runnable Sites project, retained dev server, exact Local URL, Site-root Git repository, and ignored raw-evidence paths. No product-specific edit or preview occurs yet.

- [ ] Confirm the target is absent or empty. Run `npm create --yes @openai/sites@0.2.0 . -- --yes` from that exact directory and install with the generated package manager.
- [ ] Inspect only generated instructions, scripts, primary page/layout/style, and `.openai/hosting.json`.
- [ ] Initialize/verify a Git repository rooted at the Site directory for Sites hosting. Do not use the unrelated parent repository as the hosting source.
- [ ] Before capture, add ignore/exclusion rules for `.sfp/`, raw references, journals, screenshots, temporary evidence, private URLs, and service state.
- [ ] Start the retained development server and record its exact Local URL. Keep all browsers closed and do not alter starter product content yet.

### Task V2: Open and duplicate the Figma target

**Files:** no site product source changes.

**Interfaces:** produces an editable Draft opened in Figma Desktop and non-design licensing metadata. It does not produce design values.

- [ ] Initialize the Chrome browser runtime with the explicit `chrome` selector and read its complete documentation once.
- [ ] Open the exact public URL in the persistent Chrome Figma tab and verify the free account can view it.
- [ ] Collect only non-design metadata: creator, public listing/license/terms URL, checked date, known font/image restrictions.
- [ ] Duplicate the Community file to Drafts through visible UI. If sign-in blocks it, ask the user to sign in in Chrome and continue after confirmation.
- [ ] Open the editable duplicate in Figma Desktop. Import/run the exact built plugin via computer-use or explicit user handoff.

### Task V3: Pair and extract exclusively through the service

**Files:** service-owned raw artifacts stay ignored under `.sfp`; committed output is the redacted evidence skeleton only.

**Interfaces:** produces stable file identity, canonical landing-frame ID, complete-leaf SnapshotV1 evidence, GroundingGraphV1, token/assets/screenshots, and service operation trace.

- [ ] Run `sfp status --json`, register the now-existing exact Site directory with `sfp workspace add`, issue the pairing challenge, enter it in the plugin, then run `sfp doctor --round-trip --json`.
- [ ] Verify packed artifact hashes against Task 15 checksums, `/ping` product/build identity, supported `sfp status` fields, file identity, editor capability, and empty `sfp operations unresolved --json` result.
- [ ] Use service-only `tree/find/context` operations from public `node-id=0-1` to discover and record the canonical landing-page frame ID. Do not derive it from Chrome layer inspection.
- [ ] Capture full context/SnapshotV1 for that frame. Recursively follow nested section plans. Depth/cycle/count failures require smaller service recaptures.
- [ ] Require complete-leaf evidence for every section to implement. Partial fidelity is allowed only for named out-of-scope UI-kit nodes; omitted in-scope content blocks implementation.
- [ ] Build GroundingGraphV1 and record its exact repo-relative artifact path/hash. If the source-complete service lacks a production graph interface, stop with a capability-negative blocker.
- [ ] Export tokens JSON/CSS, reference screenshots, images, and icons through service tools. Download durable exact asset bytes immediately.
- [ ] Create the draft-2020-12 schema, Ajv validator script, and redacted evidence skeleton. Run the exact schema validation command before product edits.

### Task V4: Build the first service-grounded slice and preview

**Files:** modify the Site's primary page/layout/style and exact exported assets.

**Interfaces:** produces the smallest recognizable first viewport, refreshed graph evidence, and the Sites first meaningful preview.

- [ ] Implement the hero/header slice using only complete-leaf service evidence, exact copy, tokens, and exported assets.
- [ ] Record every section/source mapping and any inference in the evidence schema.
- [ ] Refresh/revalidate GroundingGraphV1 now that code files exist; stale/absent code edges must not be reported as verified.
- [ ] Compile the slice and make one lightweight non-browser request to the exact Local URL. Require non-error response.
- [ ] Make no additional planned product-source edits before the handoff. Use `open_in_codex`, retain its stable Sites preview tab ID, and show the first meaningful preview.

### Task V5: Complete the page from service evidence

**Files:** modify only the focused page/components/styles/public assets/metadata required by the one validation route.

**Interfaces:** produces the complete responsive landing page and final refreshed grounding evidence.

- [ ] Implement all in-scope sections in canonical service-derived order. Reuse tokens/components/assets and record section→operation→file/selectors.
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

**Files:** create `VALIDATION.md`, `service-evidence.schema.json`, `service-evidence.json`, `scripts/validate-service-evidence.mjs`, and final metadata/README changes.

**Interfaces:** produces reproducible service acceptance evidence and private deployment.

- [ ] Write public source/creator/license metadata, service/artifact hashes, stable file identity kind, canonical frame, snapshot/graph fidelity, section trace, asset hashes, tested viewports, build/test results, and unresolved limitations.
- [ ] Run `node scripts/validate-service-evidence.mjs service-evidence.schema.json service-evidence.json`, then scan staged files plus built/hosting archives for credentials, private URLs, absolute paths, raw snapshots/journals, and user identifiers.
- [ ] Run final build while the retained dev server stays alive; fix and rerun failures.
- [ ] Read and use `sites-hosting`; deploy privately from the Site-root Git repository. Public/shared access requires prior license clearance and explicit user approval.
- [ ] Verify the deployment, return the private URL/test evidence, stop the dev server, and state that official Figma MCP was not used.

## Verification Checklist

- [ ] Service Tasks 1–16 and matching packed artifact hashes passed before capture.
- [ ] Every implemented Figma fact is traceable to a service operation/artifact.
- [ ] Chrome was not used as a semantic extraction substitute.
- [ ] All in-scope sections have complete-leaf evidence; partial out-of-scope nodes are named.
- [ ] Snapshot and GroundingGraph were refreshed after first slice and final implementation.
- [ ] Site build/interactions/responsive/keyboard/assets/console checks pass.
- [ ] Exact exported assets are durable local files, not expiring URLs.
- [ ] Staged files and deployment contain no raw service/private data.
- [ ] Community license metadata supports the chosen private deployment.
