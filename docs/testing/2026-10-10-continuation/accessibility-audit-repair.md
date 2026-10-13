# Chrome accessibility-name audit repair

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the CDD candidate review](cdd-page-api-candidate-review.md), [the continuation record](README.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns canonical documentation, integration, provenance, whole checks and live acceptance. This implementation task owns only the three managed-service paths listed below and this report.

## Baseline and purpose

The service collects Figma facts, generates and validates candidate application work, and runs an owned Chrome preview against captured visual oracles and configured workflows. Its basic accessibility audit is one validation gate; it is not a complete accessibility conformance assessment.

Implementation and validation used `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`. Its Git HEAD is `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with substantial pre-existing authorized changes. The coordinator identifies its starting service source as `6faae6271793a8f80728301a66cf627cfc32b3da89678f63093cfcad8b549cff` plus the separately reviewed package-config patch. The six sample-repair paths belonging to another agent were left unchanged. The coordinator's later main/native whole checkpoint is separate evidence and was not rerun or certified by this task.

Review R3 identified a concrete false negative: the previous `preview.ts` audit accepted `button.textContent` as a name even when all text was inside an `aria-hidden="true"` SVG. The initial CDD candidate had 30 such footer buttons. The candidate's own names were subsequently repaired, but that candidate change did not repair the service audit. The previous audit also ran only after journeys, allowing a later English state to conceal an initial Korean-state naming defect.

## Implemented behavior

`preview-accessibility.ts` opens a CDP session from the already-owned preview page context and calls `Accessibility.getFullAXTree` without a depth limit. It uses Chrome's computed `AXNode.name` for exposed button/link roles and basic form-control roles. A hidden SVG's DOM text is no longer accepted as a substitute. Explicit labels, referenced labels, native labels, image alternatives and titles are interpreted by Chrome's name computation.

The helper requires a nonempty tree containing an exposed `RootWebArea`, validates the node identity/role shape, and refuses trees over 50,000 nodes. Missing, malformed or unavailable AX evidence fails with `PORTAL_PREVIEW_AX_UNAVAILABLE`; it never falls back to DOM `textContent`. Missing button/link names retain `CONTROL_NAME_MISSING`; missing basic form-control names retain `CONTROL_LABEL_MISSING`.

The read has a ten-second maximum absolute budget and receives the preview's existing cancellation signal. Expired calls do not open a session. Cancelled or timed-out reads cannot return accepted evidence, late session acquisition is detached without issuing a read, and successful acquisition retains cleanup ownership before the post-await cancellation check. Session detach has a separate one-second bounded cleanup allowance, which grants no additional capture work. Unconfirmed cleanup rejects successful read evidence with `PORTAL_PREVIEW_AX_CLEANUP_UNCONFIRMED`. A final active-state check also rejects cancellation during cleanup. The outer preview continues to close its own browser/context; the helper never connects to or closes the user's source Chrome.

`preview.ts` now retains control-name failures from the captured initial state, after configured screen actions, after the interaction batch and after each configured workflow. A later named state cannot erase an earlier failure. Existing language, title, image-alt, broken-image and horizontal-overflow checks remain in place, as do existing visual, consumption, interaction and keyboard-workflow checks. The report's coverage label now states that Chrome AX control names are included.

The fixed role scope is buttons, links, text/search boxes, combo/list boxes, checkboxes, radio controls, sliders, spin buttons, switches, color wells and date/time controls exposed in the root document's accessibility tree. Ignored nodes are not treated as exposed controls. The audit does not inspect every intermediate interaction state, every possible ARIA widget, embedded frame document, contrast requirement, focus-order property or complete WCAG criterion. Projects still need their broader accessibility suites and relevant state assertions.

The protocol basis is the primary [Chrome DevTools Accessibility definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Accessibility.pdl): it specifies the computed accessible name and that an omitted depth retrieves the full root-document tree. [Playwright's browser-context API](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session) provides the page-scoped CDP session. The service continues to launch installed Google Chrome with its `chrome` channel; no alternate engine or new dependency was added.

## Executed verification

All commands used direct installed tool binaries from the managed service directory. No `pnpm exec`, automatic install, dependency mutation, Docker, daemon restart, source Chrome control, Codex browser/Figma connector, main/native service edit, index change or commit was performed. Tests ran under the existing Windows user account in a separate checkout; this is not an OS sandbox or a separate filesystem/process security boundary.

The new owned-Chrome regression exercises the actual `assertNativePortalPreview` pipeline on a loopback fixture. It covers hidden Korean SVG text, explicitly named controls, hidden text referenced by `aria-labelledby`, a native wrapping label, an image-alt link, a title-named button, invalid label references, an initially unnamed control that becomes named, and an initially named control that loses its name. It also verifies all five preserved basic DOM checks. The fixture intentionally differs from its blank visual oracle and retains failed reports, allowing the test to assert accessibility outcomes independently of the expected visual mismatch.

| Start time, KST | Verification | Result |
| --- | --- | --- |
| 17:46:54 | New Chrome regression against the existing audit | Failed as required: actual failures were only `VISUAL_MISMATCH`; expected `CONTROL_NAME_MISSING` was absent. |
| 17:48:33 | Same regression after Chrome AX integration | Passed. |
| 17:49:26 | Initial complete `preview.test.ts` run | 11 passed, zero failed. |
| 17:51:29 | Final five-file affected preview suite | 38 passed, zero failed, zero skipped. This includes 13 cases in the modified preview test file. |
| Final source | MCP TypeScript check; scoped lint and formatting | All exited successfully. |

Controlled CDP transport tests additionally cover unavailable and empty evidence, stalled-read deadline/cancellation, late acquisition cleanup, unconfirmed detach, cancellation during successful cleanup, and an already-expired deadline. They verify the service's failure/resource boundaries; the real Chrome fixture verifies name semantics. Chrome reported version `155.0.8059.39` in the executed owned previews.

An intermediate lint check found a `no-unsafe-finally` violation in cleanup error handling. The implementation was changed to retain the primary failure and settle cleanup before returning or throwing. The final typecheck, lint and formatting checks passed after that correction. No test or production deadline was relaxed.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/preview.test.ts -t "audits Chrome control names"
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/preview.test.ts packages/mcp/test/portal/preview-interactions.test.ts packages/mcp/test/portal/preview-consumption.test.ts packages/mcp/test/portal/preview-comparison.test.ts packages/mcp/test/portal/preview-feedback.test.ts
node node_modules/typescript/lib/tsc.js --noEmit -p packages/mcp/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/mcp/src/portal/preview.ts packages/mcp/src/portal/preview-accessibility.ts packages/mcp/test/portal/preview.test.ts
node node_modules/oxfmt/bin/oxfmt --check packages/mcp/src/portal/preview.ts packages/mcp/src/portal/preview-accessibility.ts packages/mcp/test/portal/preview.test.ts
```

The modified `preview.test.ts` was already registered in the mandatory Chrome census. No new test registry entry is required. No whole suite, package build, live CDD candidate audit, final application acceptance or remote CI run was executed by this task. The separate extensionless TypeScript-bin/module-fence issue was not changed.

## Initial verified owned paths

Frozen at 17:52:22 KST after the final tests and static checks. Paths are relative to the managed `service` directory. Slice SHA-256 is `ca05578577ecbc119c2e5863a740a5aac881abfbc0d0fd9810988984577f5a25`, computed over JSON of the ordered `{path,sha256}` records below without a hash prefix.

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview.ts` | `ed7d06836ef43b80651808be49893c1cc3e7cf1ca57e9976f27bbf097f65dbbe` |
| `packages/mcp/src/portal/preview-accessibility.ts` | `5a62b700d00ef632a9fac95b6d4c95440622dc8a19a4a04fd073b01b82b52194` |
| `packages/mcp/test/portal/preview.test.ts` | `def21e8fc7821c4f99d0cf55393937b2478215c4398f334cfbd9e7caeaa8bf0f` |

Independent review was requested before integration. The coordinator must reconcile the three paths, rebuild the affected preview/profile closure, perform the required integrated checks and repeat relevant live candidate states. No new product decision is required for this bounded defect repair. A fixture pass must not be reported as live CDD or complete accessibility acceptance.

## Independent review repair: native time input

The [independent reviewer](accessibility-audit-review.md) reproduced a remaining false negative in the initial slice: an unnamed `<input type="time">` did not produce `CONTROL_LABEL_MISSING`. Its actual service-owned Chrome CDP observation reported the parent role as `InputTime`, while the implementation's role set used `time`. The native hour/minute children had their own localized names and therefore did not expose the missing name on the parent through the other role checks. The role set now uses the observed lowercased `inputtime`.

The added regression runs the actual preview pipeline for six native input types: `time`, `date`, `datetime-local`, `month`, `week` and `text`. Each has an unnamed case and an explicitly named positive control, for 12 screens. It captures a matching plain swatch, so visual mismatches do not mask an incorrectly accepted screen. Before the role repair, the first unnamed time screen had `failures:[]` and the test failed at **17:58:48 KST**. After the repair, all six unnamed controls produced the required label failure and all six named controls completely passed at **17:59:28 KST**.

The reviewer also reported actual Chrome observations for color, file, password and button inputs. `ColorWell` and password text boxes already produced the missing-label issue when unnamed. File, submit and reset controls had nonempty browser-provided accessible names; these were accepted as computed names. This basic audit does not claim that every accepted native default label adequately explains its application-specific purpose. No additional role defect was established by that bounded review matrix, and no DOM-text fallback was introduced.

At **18:00:06 KST**, the same five-file affected suite passed **39/39** with zero failures or skips. A static check found two conditional-assertion lint violations in the new matrix test. The test now asserts unnamed and named groups in separate unconditional loops; production behavior was unchanged. The final matrix rerun passed at **18:01:28 KST**, and final MCP typecheck, scoped lint and formatting all passed. The test-name filter excluded 13 unrelated cases in that last selected run; no service skip policy changed.

The final three-file freeze at **18:01:53 KST** is slice SHA-256 `6642601fbc3228e45284833519581160794a1e8ea3f576d7bd5dff52a54432c2`, using the same ordered-record hashing method as above. It supersedes the initial slice while preserving its recorded findings and hashes.

| Path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview.ts` | `ed7d06836ef43b80651808be49893c1cc3e7cf1ca57e9976f27bbf097f65dbbe` |
| `packages/mcp/src/portal/preview-accessibility.ts` | `b765bc3f5f371b68ab2b81d94c9cfb01fb034f5cba4581d79e01759c97510f05` |
| `packages/mcp/test/portal/preview.test.ts` | `1af0f998c308aad6ad5ce87a9bfd327e0eb981ff5c7cf4881317d9a6b8225821` |

The independent reviewer received these hashes for a final unchanged-source recheck. Whole checks, integration and live candidate acceptance remain separate coordinator work.
