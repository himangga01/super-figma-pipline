# Independent registered-function form review

Date: October 12, 2026, Asia/Seoul.

Final disposition, 00:22 KST: the complete three-file increment passed this bounded independent review and 29 related tests. No actionable scoped defect remained. The parent retains actual same-window service testing, source reconciliation and whole-source gates. This review follows [repository instructions](../../../AGENTS.md), [canonical analysis](../../service-analysis.md), [feature coverage](../../analysis/portal-feature-coverage.md) and [the backend adapter review](service-feature-backend-review.md).

## Initial multiline scope

Reviewed managed files were `packages/portal/web/schema-form.js` at `411500f8db2eb24dd537571c099b15613b6a4b983d21e7d7ddf8b89856b2661a`, `service-functions.js` at `42d3acd29a526eb75e2ca44cbbd69b9250705279f98eaf11e4b609104a8d4b8e`, and `web/tests/schema-form.test.mjs` at `5dbbd59f6d54a771f5f72ecfb484af67e4ec228cf86eae78bc785c313a95824e`. The reviewer edited none of them.

Strings now use textareas, including bounded strings. An unedited seeded value retains its original CR/LF/CRLF characters when the browser's normalized display still matches that seed. Actual input events mark the ordinary field as edited, so editing and reverting visible text cannot resurrect hidden original carriage returns. Ordinary edits follow the browser's documented-in-UI LF normalization.

The per-string exact-JSON mode parses a JSON string and rejects malformed JSON or non-string JSON values. Invalid exact input cannot silently fall back to the prior ordinary field when its toggle is disabled. A valid exact value can return to ordinary display while retaining its exact unedited source. Final form reading still runs the local schema validator and the service remains the authoritative parser.

Alias presentation accepts the actual backend's string `aliasOf` shape as well as the previous object shape, and uses `textContent` rather than interpreting it as HTML.

The independent schema suite passed **8/8 with zero failures/skips**, including owned installed-Chrome controls and actual registered `set_text`, `create_text` and `import_svg` schemas. Its receipt is managed `.cache/schema-multiline-independent.json`. This is an intermediate source-bound result, not the author's broader 28-case total and not final clearance for later edits. No Figma write, visible Chrome action or live acceptance step was executed.

## Required follow-up under review

The parent subsequently identified that disabling unavailable registered workspace IDs also prevented the administrative remove/rebind functions. The author also identified rendering/input caps that were tighter than supported schema/request limits. The authorized follow-up adds full-input JSON within the actual 12 MiB request boundary, preserves local schema validation, supports valid inputs beyond the ordinary DOM rendering budget, and enables unavailable registrations only for the fixed remove/rebind adapters.

Do not reuse the initial three hashes or eight-case result as validation of those later changes. The next review must verify final input serialization and request-byte limits, no truncation or invalid-input fallback, original-seed versus edited-value behavior, and the exact administrative selection scope before integration.

## Final bulk/admin review and executed result

The author subsequently froze the full-input JSON and administrative-selection changes. The reviewer checked the following exact hashes before and after independent execution:

| File | SHA-256 |
| --- | --- |
| `packages/portal/web/schema-form.js` | `9d1b1d073824327e8e6206d76981e23cdbc9e980f2511542c81aed2a3600693d` |
| `packages/portal/web/service-functions.js` | `447529a82601a7526890e2ffb0cca9d659729d42b6fe26598ea5489b5acbad83` |
| `packages/portal/web/tests/schema-form.test.mjs` | `4202139109fcf0620aa3d3357f336db20a07c1194aee0520f546e59605f41253` |

The full-input JSON control exists before ordinary rendering. Ordinary rendering failure clears partial controls and exposes the full JSON input with the original seed retained. Enabling it does not require ordinary required fields to pass validation. Returning to ordinary mode parses and validates the current JSON; an error keeps JSON mode active rather than dropping the entered value. Form reads apply schema validation in either mode.

Large values are not truncated to the ordinary row/control budget. The actual `get_nodes_info` schema has no 1,000-item limit, and its 1,001-item seeded value successfully uses the bulk path. The former 262,144-character composite-textarea cap is removed; a 300,000-character composite value reads back exactly. Raw JSON parsing has an explicit UTF-8 12 MiB bound, and `functionRequest` independently measures the complete serialized request, including its envelope, against the same server body limit.

Unavailable registered workspace IDs are selectable only when the catalog entry is a **feature** named exactly `workspace.remove` or `workspace.rebind`. `workspace.default.set` remains disabled for that unavailable registration. The preview retains the selected registered ID without silently choosing a top-level workspace or dispatching the administrative effect. This is an input affordance; existing backend authority and actual rebind/remove behavior remain enforced by the service.

At **00:22:07 KST on October 12**, the independent schema, model and API suites passed **29/29, zero failures and zero skips**. Receipt: managed `.cache/schema-final-independent.json`. The executed command was:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 web/tests/schema-form.test.mjs web/tests/model.test.mjs web/tests/api.test.mjs --reporter=json --outputFile=../../.cache/schema-final-independent.json
```

The owned installed-Chrome case covers real registered multiline schemas, unedited CR/LF/CRLF seeds versus edited LF input, exact-string JSON validation and toggles, enabling bulk JSON before required-field validity, large-seed fallback, invalid array-item rejection, large composite input, scoped unavailable-workspace selection, actual string aliases and explicit preview/submit separation. Static review confirmed malformed/non-string exact values cannot fall back silently, and complete-request size checks do not trim or reinterpret arguments.

No production source was edited by this reviewer, and no Figma effect, source Chrome action, production registration change or live acceptance was executed. The parent's next live preview checks must include large/multiline payloads because its earlier 186-entry preview census used small strings and did not cover this loss. The parent announced main/native source freeze and r9 reconciliation after receiving clearance; no further service changes or tests were made by this reviewer afterward.
