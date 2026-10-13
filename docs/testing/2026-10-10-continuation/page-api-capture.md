# Independent Figma page API capture

Implementation and analysis date: October 11, 2026 (Asia/Seoul).

This record supplements [the continuation record](README.md), [the native-field record](native-remaining-fields.md), [the canonical service analysis](../../service-analysis.md) and [the project instructions](../../../AGENTS.md). The parent owns live source Chrome, CLI/browser-session wiring, main-source integration, source reconciliation and whole checks. This implementation agent implemented the reader and portal routing using only the native working copy and owned Chrome fixtures.

## Baseline and triggering evidence

Published main remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with authorized dirty work. The preceding whole check passed at service fingerprint `18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3`; that pass does not cover this new reader or subsequent changes.

The parent's service-owned `chrome-inspect --ui-only --probe-runtime` observed the CDD source page with an available page-global API, matching file identity and page `1378:120`. Receipt: `.worktrees/_cache/cdd-page-runtime-20261011-r1/ly06O8jAcrd7oWmwhz5Vr6-1791699761840-45e90cf3/observation.json`. It explicitly reports `reason:"candidate-api-only"` and `fullCapture:false`. The probe did not invoke the design reader and does not prove complete acquisition.

The new implementation acquires data through the actual page-global `window.figma`, independently of Scripter's frame and message bridge. The `.fig` archive decoder remains a separate supplemental acquisition route; this work does not make the archive's absent metadata or exports complete.

## Implemented interface and behavior

New module: `packages/cli/src/figma-page-reader.ts`.

```ts
readFigmaPageSnapshot(
  page: Page,
  target: Readonly<FigmaTarget>,
  input?: unknown,
  options?: FigmaPageReadOptions,
): Promise<FigmaPageSnapshot>;

readFigmaPageAsset(
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown,
  options?: FigmaPageReadOptions,
): Promise<Buffer>;
```

`FigmaPageReadOptions` contains an optional absolute `deadlineAt` and `AbortSignal`. Snapshot input supports the existing depth, node-budget and continuation-query fields. Its initial node ID defaults to the explicit target and cannot select a different initial scope. Asset input uses the existing strict PNG/SVG/image query schema. The module also exports `FigmaPageSnapshot` and `FigmaPageApiObservation` types.

The reader:

1. Validates an explicit Figma target and the current page URL's file identity. It opens no browser, navigates no source tab, changes no selection and starts no plugin.
2. Acquires a retained JavaScript handle containing the actual page-global API, current page and requested scope. It requires an observable PAGE and proves that the requested node belongs to it. The handle is internal service state, not a mutation of the Figma document.
3. Before and after each read/export, checks the same API object, runtime file key, current page object/ID, target scope object/ID and containing page. Requested descendant-node queries/exports are checked against that scope both before and after execution. Replaced API/page/scope objects or navigation to another file fail closed.
4. Executes only the closed shared service property reader or asset exporter with schema-validated JSON arguments. There is no caller JavaScript argument. A fixed service wrapper is compiled locally so Playwright invokes it with the retained handle. The implementation does not evaluate caller-supplied programs or document-supplied schema code.
5. Uses `readDesignSnapshot` for bounded tree/catalog continuation and ordered query reobservation. That existing module also defines a Scripter wrapper, but the new reader imports and calls only the transport-neutral function. There is no direct Scripter import, frame lookup, UI invocation, message bridge or fallback in the new module.
6. Validates returned source, file, page, scope and result schemas. Raw source is **`figma-web-page-api`**; normalized observation source is **`chrome-page-api`**. These tags remain distinct from Scripter and official MCP.
7. Exports PNG/SVG bytes and original images using the same bounded asset schemas. Image reads verify hash identity, chunk offset, stable total length and canonical base64 encoding before assembling buffers. Root/vector node exports verify query identity and exact byte length. Parent CLI wiring uses `captureDesignAssets` with this independent callback, not `captureBrowserAssets`.

Snapshot receipts include `pageApiObservation`: version, `window.figma` API basis, runtime-file-key-and-URL binding, actual page ID, requested scope ID and a per-operation retained-handle session identifier. The receipt explicitly records `atomic:false` and `fullCapture:false`. It is provenance for this read operation, not a Figma document version or a portal admission grant.

Missing catalogs, incomplete requested depth, unsupported properties or exhausted continuation retain the existing incomplete coverage evidence. An available API or successful tree read never supplies missing exports, fabricated metadata or full frontend acceptance.

## Bounds and cancellation limits

The default absolute operation deadline is 300 seconds; a caller's supplied deadline is retained across every query and image chunk. Each page evaluation also has a maximum logical wait of 60 seconds, bounded by the remaining absolute time. Deadlines and cancellation are checked before work, after results and after handle cleanup. Image chunks retain the 1 MiB chunk size and 16 MiB original-image limit; direct PNG/SVG exports retain the 5 MB limit. Shared snapshot continuation retains its depth, node, call and byte limits.

Playwright cannot forcibly cancel an already-running page API promise without disrupting the user's page. On timeout/cancellation the service abandons the result, releases its handle, starts no later host query or image chunk and publishes no accepted result. A previously started read-only browser evaluation may finish later. Late handle acquisition is disposed when it settles. The service does not close or reset the source page to simulate cancellation. Ordered observations also retain the existing ABA and post-observation-change limitation; no atomic snapshot claim is made.

## Owned Chrome verification

The new required-Chrome fixture uses the installed Google Chrome executable with Playwright's `chrome` channel. It owns a separate headless browser and fulfills its own test URL locally. A controlled page-global API provides native-shaped data and export bytes; no Scripter iframe or external service is present.

The first fixture run exposed implementation mistakes in default query handling and Playwright invocation. A partial Zod schema applied its default null node ID over the explicit target; validated raw input now preserves the target default. A string passed to `JSHandle.evaluate` was treated as an expression rather than a callable; the fixed wrapper is now supplied as a function. A fixture hook and its early rejection handling were also corrected. That failed run is not a successful capture result.

The final new fixture suite passed **12/12** cases, covering:

- Full tree read, 257-style catalog pagination and reobservation, PNG/SVG exports and a 2 MiB original image in two chunks.
- Actual source tagging and distinct normalized provenance.
- Missing APIs and partial depth/catalog coverage.
- Incorrect file/page/scope, page-global API replacement, changed scope during export and out-of-scope exports.
- Rejection of arbitrary caller code/source overrides before any API lookup.
- Expired deadlines and cancellation during an image read, with no later chunk or accepted late bytes.

The initial expanded run began at **15:37:28 KST** and passed **104/104 tests in five files**, with zero failures or skips. CLI typecheck, scoped lint and formatting passed. A prior typecheck found an exported inferred return type referring to private `PendingScope`; the explicit `FigmaPageSnapshot` return annotation repaired declaration portability. The following reader hashes identify that historical checkpoint; the later review repairs below supersede two reader files.

```text
pnpm exec vitest run packages/cli/test/figma-page-reader.test.ts packages/cli/test/capture-assets.test.ts packages/cli/test/scripter-catalogs.test.ts packages/mcp/test/portal/design-normalization.test.ts packages/mcp/test/official-figma-mcp-capture.test.ts
pnpm --filter @sfp/cli typecheck
pnpm exec oxlint --deny-warnings <the six owned TypeScript paths below>
pnpm exec oxfmt --check <the six owned TypeScript paths below>
```

The parent must register the new Chrome test file in the mandatory Chrome suite census during integration. The fixture itself already uses `requireChrome`; it never chooses another browser when Chrome is unavailable.

## Initial reader checkpoint paths

All paths are relative to `.worktrees/baseline/service`. Browser-session, CLI commands and inspection-schema wiring belong to the parent and are excluded from this ownership list.

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/figma-page-reader.ts` | `31b782db811c835c51b012e227bbe022e032c82c98bfda7fe5b4a2c51cb9af3d` |
| `packages/cli/test/figma-page-reader.test.ts` | `edc2acb418abf7c44ce8a41dc9a505334171ed90d1e668f0f9535c27014d3af2` |
| `packages/shared/src/figma-capture-query.ts` | `b7dda43f293e6ffb006bb25a3c78a70164376300eb99067500602c6a46b3fbe5` |
| `packages/shared/src/figma-capture-read.ts` | `a1e78a4d3a2b05f36886f233d79f2af1031df83f1cd2a0228038075268ba4772` |
| `packages/shared/src/design-observation.ts` | `ade7ee53d97f46b11e8e3d73e24b1d6a5eda8284bb0855e9325ef4d8bae62d04` |
| `packages/mcp/src/portal/design-normalization.ts` | `c6d008fe6cd7900ecec8400d037ebb5a58ffd9aa24e73c81e0bf10d81af37a3b` |

The earlier native empty-binding repair is independently frozen and remains separate from this reader. No daemon restart, credential access, source Chrome control, commit or index change was performed by this task.

## Live continuation and remaining gates

The parent reported that the first actual page-API CLI attempt found no CDD tab and performed no design read. The parent then reopened CDD through the service's `chrome-open`, obtaining a fresh page independent of retained Scripter UI state, rebuilt the CLI and confirmed reader hash `31b782db...`. The second attempt subsequently succeeded at `.worktrees/_cache/cdd-page-api-20261011-r2/ly06O8jAcrd7oWmwhz5Vr6-1791700676330-554c8671`: **192 nodes**, `truncated:false`, and all **25 assets** captured: 3 PNGs, 10 original images and 12 SVGs. This is parent-collected service evidence; this implementation agent did not operate the live source Chrome.

The parent's actual `chrome-compare-reads` compared this output against the separately collected R4 Scripter source. Its report at `.worktrees/_cache/cdd-page-api-comparison-20261011-r1/ly06O8jAcrd7oWmwhz5Vr6-1791701599386-bf03e18a/capture-comparison.json` records **192/192 nodes**, **36,200 recursively compared fact positions**, **zero fact differences** and **zero asset differences** after rehashing all 25 actual files under their separate capture roots. This agent inspected that report's summary and byte hash `6e70017d25aa5c5fedfffd407aa9b02b87be2071715e77276d46a75bbfe265dc`. `inputsReportComplete`, `observedFactsEqual` and `verifiedAssetBytesEqual` are true; `fullCaptureAccepted` remains false. The parent is separately binding input/report hashes in the comparator, so this dated report must not be substituted for a later source-bound result.

Keep the `.fig` archive path, page API path, Scripter path and official MCP path distinct. The matching standalone captures do not establish public portal admission, live freshness, generation, guarded application or final frontend acceptance. The implementation below wires those existing gates without waiving them.

## Public portal integration

The owner-authorized portal request can now explicitly select:

```json
{
  "case": "new",
  "targetPath": "new-frontends/cdd-page-api",
  "design": {
    "source": "chrome",
    "collector": "page-api",
    "url": "https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120",
    "freshness": "require-live"
  }
}
```

Use an actually unused registered target; this example does not assert that the path is free. `collector` accepts `page-api` or `scripter` only for Chrome. The field is optional without a schema default: an omitted field retains historical Chrome/Scripter behavior and the old signed grant/descriptor shape. Explicit page API requires a node scope. It cannot select the Desktop or official MCP paths.

Implemented behavior:

- Canonical source admission retains the explicit collector in the signed grant. Descriptor source identity includes it when present. Existing omitted collector records are still interpreted as Scripter; their serialized shape is unchanged.
- `ExistingChromeDesignCapture.pageApiCapture` is a separate `CoherentDesignCapture` port sharing the service's existing retained `ExistingChromeConnection`. It executes the independent page reader and asset callback. Session/attempt IDs, page API provenance, content/contract fingerprints and the `sfp-portal-chrome-page-api-capture-progress-v1` checkpoint namespace distinguish it from Scripter. The existing connection's file serialization and approved-source behavior remain in force.
- Runtime routing uses the admitted grant. Missing page-API ports or unavailable page APIs fail; they do not invoke the default Scripter collector. Coordinator fallback is limited to the historical/default Chrome route. Partial catalogs or exports remain incomplete under the existing ten-family capability and asset gates.
- Full-capture validation cross-checks the raw normalized source against collector provenance. A Scripter payload cannot be relabeled as page API by changing only the descriptor or grant.
- Plan evidence and native validation require the same effective collector. A page-API plan requires an operation-scoped page-API capture port for live validation. The default native-work Chrome capture is never a fallback for it. Freshness reacquires the source, verifies retained files and uses the existing exact fingerprint or bounded PNG reexport rules.
- The execution plane passes the authenticated admitted collector into policy classification. Approval effects remain Chrome browser reads with the correct design URL and a page-API label. They are not classified as official MCP network reads, and caller-provided claims cannot override the retained collector.
- The absolute coherence deadline is passed into page-API connection admission and retained by snapshot/export continuation. Prior run deadlines, unknown-outcome handling, native profile admission and frontend acceptance rules are unchanged. Shutdown aborts both capture ports and closes their shared connection once.

## Portal verification

Before schema implementation, the two explicit collector-admission tests failed because the public design schema rejected `collector`; historical omitted-field tests already passed. The initial page-runtime fake also returned a synchronous value from `handle.evaluate`; correcting the fake to match Playwright's asynchronous interface allowed the actual reader to run. These failed runs are not acceptance evidence.

At **16:04:52 KST**, the final focused portal run passed **101/101 tests across 12 files**, with no failures or skips. It covers source admission, historical shape preservation, incompatible selector rejection, actual execution-plane approval routing, independently executed page-global read/export programs, separate checkpoint namespaces, descriptor mismatch rejection, missing-port/no-fallback behavior, incomplete coverage and public plan/start/next/submit/validation routing.

Two additional tests used the real `PortalNativeWork` source-freshness stage with the controlled page runtime. Both passed: unchanged facts produced `EXACT_CAPTURE_FINGERPRINT`, while changed width produced `PORTAL_LIVE_DESIGN_CHANGED`. Both re-read the API, used no Scripter, and preserved the original stored capture. The first run reached those checks but failed a test preservation assertion that compared against an earlier fixture capture rather than the capture stored by the plan; the corrected assertion hashes the actual stored pre-validation capture. The final focused `-t` run passed **2 selected cases**; 41 other cases were filtered out, not newly skipped by service policy.

The native tests deliberately use the existing controlled profile fixture below public profile registration, and the routing test uses a controlled validation port. They verify source routing/freshness and do not establish an approved production profile or complete frontend acceptance. No full suite was run by this task. MCP typecheck, scoped lint and formatting passed for the final 18-path slice.

```text
pnpm exec vitest run packages/mcp/test/portal/page-api-admission.test.ts packages/mcp/test/portal/page-api-flow.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/portal/capture-admission.test.ts packages/mcp/test/portal/capture-descriptor.test.ts packages/mcp/test/portal/capture-flow.test.ts packages/mcp/test/portal/capture-native.test.ts packages/mcp/test/portal/capture-coherence.test.ts packages/mcp/test/portal/capture-reexport.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/portal/official-mcp-capture.test.ts packages/shared/test/portal.test.ts
pnpm exec vitest run packages/mcp/test/portal/native-work.test.ts -t "reobserves page-api"
pnpm --filter @sfp/mcp typecheck
```

## Portal integration owned paths

The initial 18-path portal slice was `sha256:6183e44bf4f9c5d82e96869b63c56f321e8a56bb853d12f3a73fdf8d8d644ed3`. The refreshed [24-path hash manifest](page-api-portal-hashes.json) includes those paths and all six reader/source-tag paths after the review repairs below, at owned-slice hash `sha256:62036c45ac0b1fad0f066b11c6b866a163d9ae102638f31f613fdf3bb320e6bb`. This is a slice fingerprint, not a whole-service verification result.

```text
packages/shared/src/portal.ts
packages/shared/src/portal-capture-source.ts
packages/shared/src/operations.ts
packages/mcp/src/portal/capture-source-admission.ts
packages/mcp/src/portal/capture-runtime.ts
packages/mcp/src/portal/design-capture.ts
packages/mcp/src/portal/coordinator.ts
packages/mcp/src/portal/native-work.ts
packages/mcp/src/index.ts
packages/mcp/src/execution/execution-plane.ts
packages/mcp/src/policy/operation-policy.ts
packages/mcp/src/policy/approval-prompt.ts
packages/mcp/test/portal/page-api-admission.test.ts
packages/mcp/test/portal/page-api-fixture.ts
packages/mcp/test/portal/page-api-flow.test.ts
packages/mcp/test/portal/capture-plane.test.ts
packages/mcp/test/portal/native-work.test.ts
packages/mcp/test/policy/operation-policy.test.ts
packages/cli/src/figma-page-reader.ts
packages/cli/test/figma-page-reader.test.ts
packages/shared/src/figma-capture-query.ts
packages/shared/src/figma-capture-read.ts
packages/shared/src/design-observation.ts
packages/mcp/src/portal/design-normalization.ts
```

Independent review, parent integration/reconciliation, fresh whole/package checks and actual public portal execution remain separate continuation steps. The parent owns daemon restart and source Chrome control. No source Chrome operation, token read, daemon restart, main sync, commit or index change was performed by this portal implementation task.

## Readiness and handle-lifetime review repairs

On October 11, the independent [page API review](page-api-review.md) reproduced two defects in the initial portal checkpoint. R1 held a readiness locator RPC beyond the admitted deadline, leaving the internal capture tail and shutdown pending. R2 cancelled between logical acquisition completion and the post-await guard; one microtask ordering acquired a Playwright handle without disposing it. These are concrete lifecycle findings, separate from the successful historical live collection.

The repair logically bounds readiness by the original admitted deadline and cancellation signal in both retained Chrome ports. It also passes those same bounds to the parent's updated `observeFigmaPage` options so an abandoned RPC cannot dispatch subsequent observer lookups. Session detach has a maximum five-second cleanup allowance within the remaining original deadline. Unconfirmed detach rejects an otherwise complete capture with `PORTAL_CAPTURE_CLEANUP_UNCONFIRMED` and fences both collectors sharing that connection until cleanup succeeds. A rejected detach remains fenced. Cleanup does not close or reset the user's page and does not grant a new read budget.

The reader now transfers handle disposal to its late-release callback if cancellation occurs after the logical waiter returns but before ownership reaches `openPageRead`. It starts disposal without awaiting a potentially stalled CDP response and preserves the original cancellation result. The regression verifies exactly one disposal across five controlled microtask orderings.

Three readiness/detach regressions and the previously leaking microtask ordering failed before the repairs. They passed after the change. A fourth portal regression additionally confirms that complete read/export evidence is not returned as success when session cleanup is unconfirmed. At **16:27:47 KST**, the frozen source passed **122/122 tests across 13 files**, with zero failures or skips, including all 17 reader cases and eight page-API flow cases. MCP and CLI typechecks passed. The command is the earlier 12-file portal command with `packages/cli/test/figma-page-reader.test.ts` added.

The current reader hash is `f346bb9781c7bd44392821529dee9db9b2a70fb2ae35c1a1600bc07f8981ccd0`; the portal capture hash is `0db6ee493563dff2b0f34de47fcf7d6c3ececc4065c4a4caf60adb89a5f48c26`; the shared portal schema hash is `99e52c0b69d5705c1c95882af6f84d584eb4607545b176ba25f1577e2a4a636a`. The full manifest records all source and test hashes. These repairs still require the parent's integrated whole check and live public portal validation. They do not retroactively change the source identity of the earlier successful live CDD collection.

The two selected real NativeWork freshness cases passed again at **16:29:48 KST**, with 41 unrelated cases filtered by the selection. Scoped lint then found three `promise(always-return)` warnings in test-only callbacks. Three explicit return statements repaired those warnings; no production behavior changed. All 24 owned paths now pass lint and formatting, and the final changed flow file passed **8/8** at **16:30:25 KST**. The production and other test files are unchanged from the 122-case run. The preceding 24-path slice `8cf61870...` is superseded only by this test file; the final manifest records its hash `44bf0b671d5945503bfb4c03b65fe98a2911173bed9fd0bf9652b219ffc48c47`.

The independent reviewer reported that both original source-import probes and the parent's no-later-RPC observer checks pass. A concurrent nine-file review run retained **90 passes and one failure** when the owned Chrome full-read/export case exceeded its five-second test limit. An unchanged isolated reader rerun at **16:29:08 KST** passed **17/17**; neither test nor production timeouts were relaxed. These are separate executed results, and the failed run remains historical evidence in the review record. This task did not run the whole service suite.
