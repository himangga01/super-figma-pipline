# eCommerce Figma Service Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `figma-design-to-code`, `chrome:control-chrome`, and `sites-building`. The main agent is the sole Site owner. This plan runs only after Super Figma Pipeline Tasks 1–16 are source-complete and independently reviewed.

**Goal:** Use the completed Super Figma Pipeline service—not direct browser imitation—to understand the supplied Figma Community file, implement a faithful eCommerce/interior landing page under `validation/ecommerce-figma-site/`, and prove the full service→code→browser loop.

**Architecture:** Chrome is used only to access/duplicate the Community file and to QA the finished site. The editable duplicate is opened with the local development plugin, and every semantic design fact, token, component, asset, screenshot, and interaction used by implementation comes from the service's authenticated connector, SnapshotV1, GroundingGraphV1, or exported artifacts. The validation site is a standalone OpenAI Sites project.

**Tech Stack:** completed `service/` daemon/plugin/CLI, Chrome, Figma Desktop development plugin, `@openai/create-sites@0.2.0`, TypeScript, React/Vinext scaffold, CSS, browser visual QA.

**Spec:** Figma Community URL `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/eCommerce-Website-%7C-Web-Page-Design-%7C-UI-KIT-%7C-Interior-Landing-Page--Community-?node-id=0-1`, binding service plan `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md`.

## Global Constraints

- The validation must use the completed service logic as the system under test. Browser-only layer reading, manually copying visible CSS, or screenshot-only imitation cannot substitute for service context extraction.
- Official Figma MCP is not used. The user has a free account.
- Chrome may authenticate, open the Community file, duplicate it to Drafts, and inspect final renders. Figma semantic data enters implementation only through service operations.
- If a development plugin cannot run in Figma Web, open the editable duplicate in Figma Desktop. Chrome remains the account/navigation and final-site QA surface.
- The target folder is exactly `validation/ecommerce-figma-site/`.
- The site must be recognizable from the first viewport, responsive, keyboard accessible, and build successfully.
- Images/icons must use exact service-exported assets or clearly matching project assets; do not draw replacement SVG paths.
- Store no pairing secret, control token, private Draft URL, raw design text dump, or unredacted operation journal in Git.
- Figma Community asset/license terms must be recorded in the validation report; the site is a test artifact, not evidence of ownership.
- Continue iterating until service extraction, site build, browser QA, and evidence checks pass or an external authentication/plugin blocker requires user action.

## Completion Contract

| Gate | Required evidence |
|---|---|
| Service used | `doctor` healthy, paired plugin, stable file identity, operation IDs for context/snapshot/grounding/assets/screenshots |
| No browser bypass | evidence manifest lists Chrome actions separately and all implementation facts cite service artifacts |
| Design captured | complete/partial fidelity SnapshotV1 with section ledger, GroundingGraphV1, token export, asset inventory, Figma reference screenshots |
| Site created | OpenAI Sites project exists only in `validation/ecommerce-figma-site/` and starter placeholder is removed |
| Fidelity | exact visible copy, section order, principal colors/type/spacing, exported imagery/icons, desktop and mobile layout verified |
| Functional | navigation/CTA interactions, responsive menu if present, keyboard focus, no broken asset/request/runtime error |
| Build | project production build exits 0 |
| Browser QA | continuous Chrome tab checks desktop and mobile viewport, screenshots saved outside secrets, no blocking console errors |
| Traceability | `VALIDATION.md` and redacted `service-evidence.json` link each implemented section to service snapshot/operation IDs |

---

### Task V1: Establish an editable Figma target through Chrome

**Files:** create only redacted coordination notes outside the site; no source changes.

**Interfaces:** produces the editable duplicated file opened in Figma Desktop, target node/page identity, and no semantic design extraction.

- [ ] Connect to the user-requested Chrome family and read its complete control documentation.
- [ ] Open the exact Community URL and verify the signed-in free account can view it.
- [ ] Duplicate/copy the Community file into the user's Drafts using the visible Figma UI. If authentication blocks this, ask the user to sign in in Chrome and continue after confirmation.
- [ ] Open the duplicated editable file in Figma Desktop; import/run the built Super Figma Pipeline development plugin.
- [ ] Record only a redacted target label and the public source URL. Do not manually inspect layer values for implementation.

### Task V2: Prove service connectivity and capture the design

**Files:** write service-owned artifacts under an approved validation workspace; later copy only redacted references into the site.

**Interfaces:** consumes the completed service; produces service operation IDs, SnapshotV1, GroundingGraphV1, tokens, assets, screenshots, and fidelity ledger.

- [ ] Run `sfp workspace add` for `validation/ecommerce-figma-site` parent/root as appropriate, then `sfp doctor --round-trip`.
- [ ] Pair through the plugin panel and verify product identity, file identity, editor capability, and target `node-id=0-1`/page routing.
- [ ] Invoke service selection/page context and full SnapshotV1 capture. Follow every nested section plan until the fidelity ledger is complete or explicitly partial.
- [ ] Build component/token/icon grounding and export tokens in JSON and CSS.
- [ ] Export reference screenshots and every required image/icon through service tools. Use ordered PDF only when it materially aids multi-section review.
- [ ] Save a redacted evidence manifest containing operation ID, tool, artifact hash/path, snapshot ID, fidelity, and timestamp. It must contain no secret or private Draft URL.
- [ ] Hard gate: if implementation facts cannot be traced to service artifacts, do not start the site.

### Task V3: Scaffold the validation Site

**Files:** create `validation/ecommerce-figma-site/` only.

**Interfaces:** consumes no Figma UI directly; produces a runnable OpenAI Sites project with a coherent first viewport.

- [ ] Confirm the target directory is absent or empty; never overwrite an unrelated project.
- [ ] Initialize with pinned `@openai/create-sites@0.2.0` and install dependencies using the generated package manager.
- [ ] Inspect only the generated instructions, scripts, primary page/layout/style, and `.openai/hosting.json`.
- [ ] Replace the starter with the smallest recognizable first viewport using SnapshotV1, GroundingGraphV1, token CSS, exported hero imagery, and exact copy.
- [ ] Start the retained development server and require successful compile/non-error response before the first preview.
- [ ] Open the first meaningful preview once in the continuous Chrome tab. After that handoff, continue implementation in the same tab.

### Task V4: Implement the complete page from service evidence

**Files:** modify the validation site's page, layout, stylesheet, public assets, and focused components only.

**Interfaces:** consumes service artifacts and produces the complete responsive landing page.

- [ ] Implement sections in the exact service-derived order, reusing grounded tokens/components and exported assets.
- [ ] Preserve typography hierarchy, maximum content widths, grids, gaps, radii, colors, overlays, and responsive behavior from observed evidence; mark any inference in `VALIDATION.md`.
- [ ] Implement visible navigation, CTAs, cards, galleries, footer, and responsive menu behavior represented by the design.
- [ ] Add accessible structure, alt text, landmarks, labels, focus visibility, keyboard/touch behavior, and reduced-motion handling.
- [ ] Set site-specific title/description and social metadata. Preserve exact real imagery; do not invent a replacement social image unless the finished site lacks one and the Sites workflow requires it.
- [ ] Remove unused starter content/dependencies and keep the implementation bounded to this one validation route unless the design proves otherwise.

### Task V5: Validate through the service and Chrome until faithful

**Files:** update site source as required and produce redacted comparison evidence.

**Interfaces:** compares service Figma screenshots/context against Chrome site renders and produces a resolved discrepancy ledger.

- [ ] Capture Figma reference screenshots with the service at the target desktop viewport and key sections.
- [ ] Use Chrome to capture the local site at matching desktop and mobile viewports; inspect DOM/accessibility/console only for the site, not as a substitute for Figma extraction.
- [ ] Compare section geometry, copy, imagery, colors, typography, spacing, card counts, borders, and responsive order. Log discrepancies with service artifact IDs.
- [ ] Fix the highest-impact discrepancy, rebuild/hot-reload, and repeat. Do not stop with placeholder assets, missing sections, broken interactions, or obvious layout drift.
- [ ] Run the site's production build and any scaffold-provided tests. Require exit 0 and no blocking browser runtime error.
- [ ] Run service `doctor` again and verify the audit shows the expected read/export/snapshot operations and no unauthorized path/network attempt.

### Task V6: Final evidence and Sites handoff

**Files:** create `validation/ecommerce-figma-site/VALIDATION.md` and `validation/ecommerce-figma-site/service-evidence.json`; update README/metadata as needed.

**Interfaces:** produces a reproducible validation artifact and, unless explicitly kept local by the user, a Sites deployment.

- [ ] Write `VALIDATION.md` with public source URL, service version/hash, snapshot ID/fidelity, section→operation trace, asset hashes, tested viewports, build result, unresolved limitations, and Community-license note.
- [ ] Validate `service-evidence.json` against a redacted schema: operation IDs/hashes/status only; no pairing/control credentials, private Draft URL, raw design payload, or user identifiers.
- [ ] Run final build while the development server stays alive; fix failures and rerun.
- [ ] Use `sites-hosting` for the completed validation site unless the user explicitly requests local-only delivery.
- [ ] Return the site/deployment as test evidence together with service audit summary; do not claim the design was obtained through official MCP.

## Verification Checklist

- [ ] Every Figma-derived implementation decision is traceable to a Super Figma Pipeline operation/artifact.
- [ ] Chrome was not used as a semantic extraction substitute.
- [ ] `validation/ecommerce-figma-site/` builds successfully and contains no starter placeholder.
- [ ] Desktop and mobile browser QA completed in the same continuous Chrome tab.
- [ ] Exact service-exported assets are durable local files, not expiring URLs.
- [ ] No secret/private Draft data is committed.
- [ ] Final report states service limitations honestly and records any external blocker.
