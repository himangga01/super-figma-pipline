# Independent review: Chrome accessibility-name audit

Date: October 11, 2026 (Asia/Seoul), from approximately 17:54 KST.

This bounded review covers the three-file audit repair described in [accessibility-audit-repair.md](accessibility-audit-repair.md). It does not establish complete WCAG conformance, live CDD accessibility acceptance or final whole-service acceptance. The canonical authority remains [service-analysis.md](../../service-analysis.md), with [repository instructions](../../../AGENTS.md), [the continuation record](README.md) and the earlier [CDD candidate review](cdd-page-api-candidate-review.md).

## Baseline and ownership

Review used the managed checkout `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`. Its Git baseline remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with the parent's aligned source and other authorized modifications. The separately passing main/native `1a5...` whole checkpoint does not cover this managed increment. Previously reviewed sample/package-configuration files were outside scope and were not changed.

Initial frozen hashes were independently checked:

| Managed service path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview.ts` | `ed7d06836ef43b80651808be49893c1cc3e7cf1ca57e9976f27bbf097f65dbbe` |
| `packages/mcp/src/portal/preview-accessibility.ts` | `5a62b700d00ef632a9fac95b6d4c95440622dc8a19a4a04fd073b01b82b52194` |
| `packages/mcp/test/portal/preview.test.ts` | `def21e8fc7821c4f99d0cf55393937b2478215c4398f334cfbd9e7caeaa8bf0f` |

The implementation agent owns those three files. This reviewer modifies only this main-checkout report. Service-owned fixture scratch directories were created in the managed checkout and removed after resolving and checking containment. Existing dependencies, source Chrome/Figma sessions, main/native service files and the index were not modified.

## Implemented behavior and stage review

The service uses owned Chrome previews to validate candidate visuals, consumption, configured interactions and workflows. This patch replaces DOM-text heuristics for control names with the name computed by Chrome's accessibility tree.

The helper attaches a CDP session only to the provided owned preview page, requests the full root-document AX tree, requires nonempty evidence with an exposed RootWebArea, validates node identity/role shape and bounds the returned node count. Ignored nodes do not count as exposed controls. Missing or unavailable evidence fails instead of falling back to DOM `textContent`.

`preview.ts` retains naming failures after the configured initial-state preparation, after screen actions, after an executed interaction batch and after each workflow. Failures accumulate in the screen result, so a later named state cannot erase an earlier failure. The audit does not check every intermediate action state. Language, title, image-alt, broken-image and horizontal-overflow checks remain at their existing final DOM audit stage; this patch does not claim to expand every basic check to every state.

The helper bounds acquisition/read waiting to the earlier of its ten-second limit and an explicit caller deadline, combines caller cancellation, retains session ownership before its post-acquisition check, and attempts late-session release without issuing a read. Detach has a separate one-second cleanup allowance. Successful evidence is rejected if cleanup cannot be confirmed or cancellation/deadline expiry occurs during cleanup. Failed reads preserve their primary failure while attempting cleanup. The outer preview remains responsible for closing its owned context/browser.

## Finding AX-1: unnamed time inputs evade the new role-based audit

Priority: P1. Status: independently reproduced at the initial hashes; repair assigned to the implementation agent.

The initial `labelledRoles` set contains `time`. Actual Chrome exposes an HTML `input[type=time]` as `InputTime`, normalized by this helper to `inputtime`. The root control is therefore omitted even when its computed name is empty. Its internal button/spinbutton children have nonempty browser-generated names, so checking those children does not detect the missing name of the time control itself.

The reproduction ran the actual `assertNativePortalPreview` service pipeline against a reviewer-owned loopback fixture, using the installed Google Chrome channel/executable. An unnamed time input produced only the deliberately expected `VISUAL_MISMATCH`; it did not produce `CONTROL_LABEL_MISSING`. Date, datetime-local, month, week and text inputs in the same fixture did produce `CONTROL_LABEL_MISSING`. The old DOM input selector included time inputs, so this is a regression in the existing basic control-name scope.

A second service-owned fixture used a read-only spy around the original CDP `session.send` responses. It retained the real browser/session and original protocol call rather than substituting AX data. Actual observed roles and names:

| Control | Chrome role | Computed name | Initial audit result |
| --- | --- | --- | --- |
| Unnamed time input | `InputTime` | Empty | Missing label was incorrectly not reported. |
| Aria-labeled time input | `InputTime` | `Review input` | No naming error, as expected. |
| Unnamed color input | `ColorWell` | Empty | `CONTROL_LABEL_MISSING`, as expected. |
| Aria-labeled color input | `ColorWell` | `Review input` | No naming error. |
| Native file input without an explicit author label | `button` | Nonempty localized native choose-file name | No naming error; the computed name is valid for this basic presence check. |
| Aria-labeled file input | `button` | `Review input` | No naming error. |
| Unnamed password input | `textbox` | Empty | `CONTROL_LABEL_MISSING`. |
| Empty input button | `button` | Empty | `CONTROL_NAME_MISSING`. |
| Native submit/reset inputs | `button` | Nonempty localized native action names | No naming error. |

Fix the checked role to Chrome's actual normalized `inputtime` and preserve the named positive case. Do not require failures for native file/submit/reset controls whose computed names are already nonempty. This finding concerns presence of computed names, not whether every name is sufficiently contextual or every accessibility criterion is satisfied.

No additional concrete role gap was found in this bounded native-input matrix. Other widgets, embedded frame documents, contrast, focus order and full accessibility conformance remain outside this repair's stated coverage.

## Executed checks and limits

Read the shared analysis policy, current repository instructions, canonical report and implementation record before reviewing the sources and their diff. The initial implementation record reports a real hidden-SVG-button RED case followed by 38 affected tests passing; these are implementer-run historical checks, not independently claimed by this reviewer.

The independent real-Chrome probes used only `assertNativePortalPreview`, service-owned loopback fixtures and the service's installed Chrome launcher. The first covered six unnamed native types; the second covered time/color/file negative and named controls plus password/button/submit/reset controls, and observed actual CDP role/name responses. Their white visual oracle intentionally differs from native controls, so visual failures were retained while the naming outcomes were assessed separately. No candidate application or Figma/source tab was opened.

At **17:59:42 KST**, a narrowly filtered run passed **9 cases**, with **5 excluded by the name filter**:

```text
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 test/portal/preview.test.ts -t "refuses|bounds a stalled|releases a late|does not accept complete|rejects cancellation|does not open a Chrome"
```

This covers the controlled unavailable/empty evidence, cancellation/deadline, late acquisition, cleanup and expired-deadline cases, plus the matching PNG-refusal case. The author had begun the AX-1 repair by then, so this is explicitly an intermediate focused run, not unchanged initial-source verification or a final full preview-suite pass. At its end the helper hash was `b765bc3f5f371b68ab2b81d94c9cfb01fb034f5cba4581d79e01759c97510f05`, test hash `2f2325d8a5f253dc9368ef18bc5c4a1cd961f232cd123741ca0fd2d13abdaaf4`, and `preview.ts` remained at its initial hash.

Tests used direct installed binaries, native config loading and disabled caching, with temporary files under the managed checkout. No automatic installation, dependency write, build, whole check, Docker, daemon restart, production fix, integration, commit or index/provenance update was performed. Native execution uses the Windows owner's permissions and is not an OS sandbox. No Codex browser tool or external connector substituted for service testing.

## Continuation

AX-1 must be repaired and verified at final frozen hashes before integration. Preserve the initial failure and passing named/native controls. Then reconcile the three source paths, rebuild the affected profile/preview closure, and run the relevant integrated and live candidate gates. A computed-name fixture pass must not be relabeled as live CDD acceptance or complete accessibility conformance.

## Final frozen repair recheck at 18:02 KST

The author repaired AX-1 by replacing the incorrect normalized `time` role with `inputtime`. The exact Chrome-computed name remains the authority; no DOM fallback or name substitution was introduced. The new real-pipeline regression checks unnamed and correctly aria-labeled time, date, datetime-local, month, week and text controls. Its separate matching visual swatch makes the missing-name result independent of a visual mismatch.

The author reports that this regression first failed with an unnamed time screen having no failures, then passed after repair. The broader affected five-file run passed 39 cases before a final test-only lint correction, followed by the native-input matrix and static checks. Those are author-reported results, separate from this reviewer's final run.

I inspected the final repair and independently ran the complete existing mandatory `preview.test.ts` file from the managed `packages/mcp` directory:

```text
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 test/portal/preview.test.ts
```

The run began at **18:02:20 KST** and passed **14/14 tests**, with no failures or skips, in 37.63 seconds. This includes the real unnamed/named time reproduction and the hidden-SVG/state-change, preserved DOM-rule, controlled deadline/cancellation/cleanup and existing visual cases. Executed owned previews reported installed **Chrome 155.0.8059.39**. Tests used service-owned Chrome launches only; no source Chrome/Figma session was involved.

Final hashes were independently checked before and after the run and remained unchanged:

| Managed service path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/preview.ts` | `ed7d06836ef43b80651808be49893c1cc3e7cf1ca57e9976f27bbf097f65dbbe` |
| `packages/mcp/src/portal/preview-accessibility.ts` | `b765bc3f5f371b68ab2b81d94c9cfb01fb034f5cba4581d79e01759c97510f05` |
| `packages/mcp/test/portal/preview.test.ts` | `1af0f998c308aad6ad5ce87a9bfd327e0eb981ff5c7cf4881317d9a6b8225821` |

The independently recomputed ordered three-file slice hash is `6642601fbc3228e45284833519581160794a1e8ea3f576d7bd5dff52a54432c2`, matching the author's frozen record. It is a scoped slice, not a whole-service source fingerprint.

**Disposition:** AX-1 is addressed for the reproduced control and its named positive at these frozen bytes. No additional actionable role, stage-routing or resource-boundary defect was found in this bounded review. These three files have completed this independent review and are ready for the parent's integration gates. The review does not authorize treating the patch as a fresh whole-source pass, live CDD result or full accessibility conformance.
