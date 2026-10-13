# Final public feature coverage and input review

Date: October 12, 2026, 00:22 KST. This continuation reads the [feature inventory](../../analysis/portal-feature-inventory.json), [coverage report](../../analysis/portal-feature-coverage.md), [earlier adapter review](service-feature-adapter-review.md), [retained-tab execution](retained-tab-live-qa.md), [canonical analysis](../../service-analysis.md), shared analysis policy and [repository instructions](../../../AGENTS.md). The coordinator retains integration, provenance, runtime and whole-check ownership. Native ACL and activity repairs are outside this worker's scope.

## Baseline, purpose and coverage result

The published baseline remains main commit `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with uncommitted integration changes. This review inspected the current main/native implementation, not an assumed historical whole pass. The reviewed adapter/runtime/API source files matched between main and native at the recorded checkpoint. The last whole-passed `935216d1...` source does not cover these increments. Per-file hashes below bind the review; this worker did not calculate or certify a new whole-source fingerprint.

The login-free local portal exposes guided workflows and every registered public tool/CLI entry through schema forms, explicit request previews and retained backend jobs. Public metadata comes from the actual registry and fixed feature definitions. Requests pass the same registered schema, target/workspace authority and private ControlClient dispatch; operation identifiers are retained before invocation. This review found **no missing or extra registered names**: 128 MCP tools and 58 CLI feature IDs exactly match the inventory. These include overlapping aliases and are not 186 unique capabilities.

The October 11 actual receipt `2026-10-11T14-23-45-515Z-08f0fd69-e1c0-4a67-a729-3d4236ff71f4/result.json` contains exactly 186 reachable/previewed entries with no missing or extra identity versus the current census. Ten selected reads succeeded in that earlier round; its overall `passed` remains false. That receipt establishes ordinary minimum request-preview reachability, not preservation of multiline content, every permitted large value, every union alternative, plugin writes or full generation acceptance.

The review identified four concrete input/discovery gaps. The coordinator authorized repair in exactly three managed files: `packages/portal/web/schema-form.js`, `packages/portal/web/service-functions.js` and `packages/portal/web/tests/schema-form.test.mjs`. No daemon, source Chrome, dependencies, registry, CLI adapter, backend authority or index was changed by this worker.

## Reproduced findings and bounded repairs

### Multiline text and SVG data loss

At review start, string fields became single-line HTML inputs unless `maxLength` exceeded 256. The actual registered schemas for `set_text.characters`, `create_text.characters` and `import_svg.svg` omit that length bound. A real installed-Chrome regression serialized all three through the production renderer: `First\nSecond` became `FirstSecond`, and an SVG newline separating the tag name from its namespace became `<svgxmlns=...>`. A short bounded string lost its newline too. The initial suite failed one browser case while seven existing cases passed; all four observed values were incorrect.

All ordinary strings now use textareas. Short bounded strings use one row; long or unbounded strings use four. LF multiline text is preserved. An unedited initial value preserves its exact retained CR/CRLF characters, and any ordinary input edit is tracked explicitly. Editing and later reverting the visible normalized text does not silently restore hidden CR characters.

Browsers normalize ordinary textarea edits to LF. The UI states this rather than claiming exact edited CRLF preservation. The optional `고급: 정확한 문자열 원문` mode accepts a JSON string, preserving explicit CR, CRLF, LF, tabs and other escaped characters. Malformed JSON or a non-string value remains an error and cannot silently fall back to ordinary input. Returning a valid exact value to ordinary mode preserves it as an unedited seed until the user edits again. The file-content schema and service hash/byte checks remain authoritative; this does not waive candidate source limits or synthesize code/file hashes.

### Large arrays and composite JSON values

The ordinary renderer has a 1,000-row array cap and a 4,000-control/depth budget. The registered `get_nodes_info.nodeIds` schema has no `maxItems`, so a valid 1,001-ID value could not be represented through that ordinary form. Unstructured advanced JSON additionally imposed a 262,144-character HTML maxlength, which could truncate larger schema-permitted composite values before parsing. These were source-supported value omissions; they were not missing tool names.

An optional full-input JSON mode now avoids the large ordinary DOM. Users can enable it before required ordinary fields validate. A large retained seed automatically opens that mode when ordinary rendering exceeds its budget, preserving the full value. Common form budgets remain bounded; they do not lower the underlying service schema's permitted array count. Full JSON and unstructured field JSON retain local schema validation, while the backend remains the complete validator.

The 262,144-character truncation was removed. Raw JSON is explicitly limited to **12 MiB measured as UTF-8 bytes**, matching the portal server body budget. Oversized JSON produces a clear error without slicing input. The final serialized job request, including its transport/name/workspace/target envelope, is independently checked against the same 12 MiB limit. A JSON argument near the boundary can therefore pass the editor limit and still be rejected if its complete request exceeds the body limit. Individual schemas may impose smaller field/item/decoded-file limits, which remain enforced.

The actual Chrome fixture preserves a schema-valid 1,001-ID array through the real registered schema using one bulk textarea, rejects a wrong-type item, and preserves a 300,000-character nested content value through the formerly truncated unstructured field. The pure limit case uses multibyte input to verify UTF-8 accounting and rejects a complete request that exceeds the envelope budget. These are schema/preview fixtures, not actual Figma reads or writes.

Stable controls for the coordinator's retained-tab run:

| Control | Visible label or selector |
| --- | --- |
| Full-input disclosure | `고급: 전체 입력 JSON` |
| Enable full input | `aria-label="입력 전체 JSON 사용"` |
| Full-input textarea | `aria-label="입력 전체 JSON"` |
| Exact string disclosure | `고급: 정확한 문자열 원문` |
| Enable exact string | `aria-label="<field path> 문자열 원문 JSON 사용"` |
| Exact string textarea | `aria-label="<field path> 문자열 원문 JSON"` |

### Unavailable workspace administration

The common workspace-ID selector disabled unavailable/moved registrations for every function. That prevented users from selecting the registration they needed to remove or rebind. The frontend now allows those registered IDs only for `feature:workspace.remove` and `feature:workspace.rebind`. Other ordinary workspace selectors retain the unavailable-state restriction.

The regression selects an identity-mismatched registered ID for those two administrative previews and keeps `workspace.default.set` disabled for that same row. The outer execution workspace stays null in these previews, as appropriate for registration administration. Backend scope and workspace authority are unchanged; selecting a broken registration for repair does not make it an available execution workspace. The coordinator separately owns actual disposable-folder registration/move/rebind/removal testing. This worker did not move or remove a real registration.

### CLI alias metadata display

The current CLI adapter emits `aliasOf` as the registered tool-name string, while the frontend previously displayed only an object `{type:'tool',name}`. Exact CLI/MCP equivalence was consequently hidden despite the correct catalog counts. The frontend now renders the real string form and retains object compatibility. The visible alias is inserted with `textContent`; no tool identity, count or dispatcher was changed. The actual Chrome fixture exercises the emitted string form.

## Dispatch, errors and success-state review

The current registry-based tool parser and fixed feature dispatcher were inspected for all catalog identities. Tool-backed aliases use the same registered parser and actual `invoke`; CLI/admin branches use fixed argv/control bindings, not arbitrary shell text or control routes. The earlier Desktop auto-start concern is now addressed in source by the bound facade, abort propagation and `allowServerStart:false`. No new foreign daemon-start reproduction was executed here.

Frontend catalog/job/action paths correspond to the backend routes. Backend exceptions retain failed/cancelled/unknown outcomes, operation admission precedes dispatch, and unknown write effects remain fenced rather than retried. The UI distinguishes request processing success from complete capture/generation/application, exposes actual errors/results and warns when result bodies are no longer retained. The earlier official authentication-required probe can legitimately finish processing without establishing authorization or full capture. This review found no additional concrete wrong route, swallowed error or invented generation success in these inspected paths.

That source review is not execution of all effects. Plugin-dependent reads/writes still require an authorized paired target. Official-MCP positive acquisition still requires this service's own authorization. The historical failed mutation and unknown job remain preserved under their existing owner review; neither is resolved by input-form tests.

## Verification, failures and frozen source

The exact current native files were copied into managed worktree `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service` before editing, preserving the newly added mandatory-Chrome guard. All tool schemas used by the multiline/array regressions come from their real source definitions.

Commands from managed `packages/portal`:

```powershell
node C:/2026_project/super-figma-pipline/.worktrees/baseline/service/node_modules/vitest/vitest.mjs run --config vitest.config.ts web/tests/schema-form.test.mjs web/tests/api.test.mjs web/tests/model.test.mjs --no-cache --maxWorkers=1
```

The combined scoped run passed **29/29** at 00:20:33. The final schema suite passed **9/9** at 00:21:06 with no skips. One real owned headless Chrome fixture executes the form/preview interactions; API/job fixture responses are explicitly synthetic. No source Figma or additional visible Chrome window was controlled. Direct native `oxlint --deny-warnings` and `oxfmt --check` passed for the three changed files. No package installation or dependency mutation occurred.

The first multiline RED and its incorrect values remain recorded above. An intermediate extended browser fixture timed out because its test tried to fill a collapsed advanced disclosure; opening the real control fixed that fixture. One shadow-name lint failure and subsequent test-only sequential-loop/map lint findings were repaired before final freeze. These are not omitted passes or relaxed deadlines.

Final managed repair hashes:

| Path | SHA-256 |
| --- | --- |
| `packages/portal/web/schema-form.js` | `9d1b1d073824327e8e6206d76981e23cdbc9e980f2511542c81aed2a3600693d` |
| `packages/portal/web/service-functions.js` | `447529a82601a7526890e2ffb0cca9d659729d42b6fe26598ea5489b5acbad83` |
| `packages/portal/web/tests/schema-form.test.mjs` | `4202139109fcf0620aa3d3357f336db20a07c1194aee0520f546e59605f41253` |

Inspected native/main runtime bindings:

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/service-functions.ts` | `e0c957acaa72319b33ae283074a978825770596f3c875e0cb4b1d2f9107f19bf` |
| `packages/cli/src/service-tool-catalog.ts` | `bd5889dc589313207f10af146010165e88420844b40877c2e616496d97142a77` |
| `packages/mcp/src/tools/registry.ts` | `e0116f7e72ae7e7be05aea2ba5e8a29d7780e729445786c6f7e2053a49a09a37` |
| `packages/portal/src/control.ts` | `1f9198c796c82febccd2934e58b672aefe93068025ae088586f458112bc6d0c1` |
| `packages/portal/src/service-jobs.ts` | `4ffb817ee3739ba6893ce6886a95b6aef3176adf4619e76e713a29340ab254d1` |
| `packages/portal/src/server.ts` | `692263a807d76a258e3393cd0719313e6ef58b989fb84d792599b4e63261d8d6` |
| `packages/portal/web/api.js` | `ca48afaa74f8cd025cadc898ed8a71c73c3b072c5d8c4947843f23d9a2354605` |

Private read-only census/receipt comparison and expanded source hashes are retained under `.worktrees/_cache/portal-final-coverage-review-20261012/`. The first private comparison incorrectly used `name` for CLI inventory rows whose field is `id`; correcting that review helper produced the exact zero-missing/extra census. It was a review-helper error, not a production omission.

The independent reviewer subsequently rechecked the exact three frozen hashes and ran **29/29** schema/model/API cases, including actual owned Chrome, at 00:22:07 with zero failures or skips. The reviewer reported no additional actionable scoped finding and preserved the full-input, scoped unavailable-registration, multiline/exact-string and alias checks. Coordinator integration, retained-tab special-value/admin checks and a fresh whole-source/artifact gate remain separate obligations. No current-source whole pass, successful execution of all 128 tool effects, complete three-round Figma-to-accepted-frontend test or eCommerce acceptance is claimed. The CDD mobile image/nominal-glyph discrepancy remains separately recorded in [the native glyph diagnostic](glyph-native-diagnostic.md).

The coordinator then reported exact integration of all three hashes into main/native and an 11-case native Chrome/schema-wrapper pass, followed by the start of R9 provenance reconciliation. This worker did not execute or independently verify that native run. Service source is now frozen under the coordinator; build, retained-tab special-value/administration execution and whole checks remain pending at this report checkpoint.
