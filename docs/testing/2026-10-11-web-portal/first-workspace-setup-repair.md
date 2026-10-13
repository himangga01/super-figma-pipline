# First workspace registration and guided setup repair

Date: 2026-10-13, Asia/Seoul. Author: independent SOL delegate.

## Scope and baseline

The portal is the login-free local frontend for configuring workflows and reviewing actual service execution. This repair addresses its first-run workspace registration and guided draft flow. It does not execute capture, generation, application or permission changes.

The source baseline supplied by the root agent was `sha256:9c2806c53fe97177935a8e5949a4da4714cda5a18dc10b4bdf5d31c3b133bc95`. Main and native `packages/portal/web/app.js` still had the a476 bytes, SHA-256 `61842fbf00d44dca7fa0a0a76c495914dc15ce8b2ba16965d7141781512e350a`. Only the managed app file and a new browser regression file were edited for this repair. Concurrent compiler work was outside this scope. Main, native source, existing Chrome, live portal/state and Git metadata were not modified by this delegate.

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [the retained-tab record](retained-tab-live-qa.md), and [the integration record](README.md). Reuse this report and verify the source and newer execution evidence before updating it.

## Observed failure and implementation

The root's actual first-round evidence is preserved under `.worktrees/_cache/portal-cdd-export-repair-20261012/portal-rounds-20261013/evidence/round-1/2026-10-12T15-26-21-443Z-a6561757-eda3-4daf-9307-528a654f8224`. Workspace registration succeeded, but the recommended new setup action displayed the existing unsaved-change notice and no guided form appeared. This was an actual portal failure, not complete acceptance.

The registration response updates the workspace inventory and automatically selects a workspace when the current builder workflow has none. Previously that selection always called `dirty()`. A clean initial template therefore became indistinguishable from an edited draft, and the existing `setupDialog('new')` guard correctly blocked it.

The repaired response handler computes `!state.workflow.id && !state.dirty && state.jsonDraft === null` immediately before applying the selection. Only this clean, unsaved, draft-free initialization avoids calling `dirty()`. Saved workflows, meaningful edits and edits made while the request is pending retain the dirty state. The new-setup guard and draft content remain unchanged. Initial canvas fitting changes the viewport without an edit, so raw equality against the bootstrap template would incorrectly classify the initial draft.

## Executed verification

All browser fixtures used installed Google Chrome through service-owned Playwright, an owned loopback PortalServer/PortalBridge/PortalStore, and disposable fixture storage. A deny proxy started before Chrome, forwarded only the exact owned HTTP origin and denied all CONNECT requests. A context route additionally rejected other origins. No live daemon, source Chrome, actual workspace registration, Figma request, grant or unknown operation was used. These are process-level fixture protections, not an OS network sandbox.

- Before repair: four Chrome cases produced three passes and one failure, exit 1. The trusted register-then-new-setup case failed because `#guided-setup-form` did not exist. The original dirty notice remained visible. Receipt `before-guided.json`, SHA-256 `8d5786df677a1ca35058f4a1577986b57f525b883cf91d2ca45f9e17b279e171`.
- Final source: four Chrome cases passed. They cover first-run guided draft application without saving/running, preservation of a meaningful unsaved edit, dirty protection and unchanged persisted data for a saved workflow, and a trusted edit during a held registration request.
- Relevant cohort: four new Chrome cases, 17 model cases, three API cases and two bound-session cases passed, 26/26, no skips, exit 0. Receipt `after-final.json`, SHA-256 `c48066cab7bf201ca74763af1382b69bacada6b0ea92a8b2d78f55008520aaa3`.
- Existing `chrome-check.mjs` assertion bodies passed in a private harness using the same owned deny-proxy Chrome and real portal server. There are 14 recorded check messages, including real HTTP save/reload, pending-save edit locks, invalid JSON preservation, keyboard save, graph movement, mobile overflow and activity query races. Browser errors were empty. Only dependency resolution and provision of the already owned browser were adapted in the ignored harness. This was not a live acceptance run. Receipt `browser-audit.json`, SHA-256 `a09fc15a7a0f1d9e0416b3c4455b636021fe38386a76ca160b2bd7d8cf4334ee`; detailed result SHA-256 `9ebad9434b1407f140c9e63890e91e67f78d43dd9aa90b79f42908264d158da8`.
- Scoped lint and format checks passed for the two repair files and the separately repaired bound-session test.

Preserved preliminary fixture failures are not counted as passes: the first before-run hit Vitest's default five-second timeout; a bounded repeat exposed the dirty text, and the final before-run exposed the missing guided form. The first after-run incorrectly expected the closed native dialog's form to be removed from the DOM. The harness assertion was corrected to require it to be hidden, retaining successful local draft assertions. No production behavior was changed for that assertion.

## Frozen files and reproduction

The managed repair is frozen in `.worktrees/_cache/portal-first-workspace-20261013/frozen-app-files.json`, SHA-256 `bd47d32e9cc7e13b52dab219586deb938b247f89c3181b2fe165f2dc36a97cee`.

| File | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `packages/portal/web/app.js` | `61842fbf00d44dca7fa0a0a76c495914dc15ce8b2ba16965d7141781512e350a` | `fe9e1257b0001dc09425637d3849fede9270bbdb85bc895ec068cf6ef06585e3` |
| `packages/portal/web/tests/first-workspace-setup.test.mjs` | New file | `b3588fcbb3cb88bf10e6ac054b78d744e045e9c219aceae2fd9da20ba38dd948` |

All private evidence paths above are relative to `.worktrees/_cache/portal-first-workspace-20261013/`. The fixture is a regular source copy with native installed dependencies resolved for read-only use. No build, install or dependency junction mutation was performed.

From `C:/2026_project/super-figma-pipline/.worktrees/baseline/service`, run the native Vitest binary with the private configuration and absolute fixture file filters. Use a fresh output filename:

```powershell
node node_modules/vitest/vitest.mjs run C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/service/packages/portal/web/tests/first-workspace-setup.test.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/service/packages/portal/web/tests/model.test.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/service/packages/portal/web/tests/api.test.mjs C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/service/packages/cli/test/bound-server-session.test.ts --config C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/review.config.mjs --configLoader native --reporter=json --outputFile=C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-first-workspace-20261013/root-review-new.json
```

The ignored `private-chrome-audit.test.mjs` in the same fixture can be filtered separately to repeat the existing browser audit with another unique output filename.

## Limits and continuation

The two-file source repair is ready for root integration and independent review. The root owns the required Chrome registration census, fresh provenance reconciliation, whole verification and the actual first-round portal retry. No whole check or complete service journey passed in this scope. The actual failed round remains failed until a new source-bound live run verifies it. Official MCP live verification remains owner-deferred.

No additional product decision is required for this bounded repair. It preserves the existing policy that new setup must not discard a meaningful unsaved workflow.
