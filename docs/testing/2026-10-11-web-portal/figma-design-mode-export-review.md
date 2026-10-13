# Independent review of the guarded Design Mode export preflight

Review date: October 12, 2026, Asia/Seoul. Decision: **approved for integration at the exact two hashes below; no blocking finding**. This review does not establish actual Figma export, restored page API exposure, complete collection or frontend acceptance.

## Scope and baseline

Read the [repository instructions](../../../AGENTS.md), shared analysis policy, [canonical service analysis](../../service-analysis.md), [retained-tab execution record](retained-tab-live-qa.md) and [page API availability diagnosis](../../analysis/chrome-page-api-availability-20261012.md) before reusing this result. The coordinator owns canonical analysis and live browser/runtime control. This reviewer owns only this report, with temporary private fixture files and receipts outside production source.

The deployed and main source baseline was `sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`, published `main` commit `22517932dc9b2cb974c177ec4eacb84d4b16e254` with existing uncommitted integration work. The author changed only the following managed candidate files. The coordinator overlaid their exact bytes onto the isolated native validation copy, preserving baseline backups. Main source and running compiled builds stayed unchanged during this review. The native candidate fingerprint reported by the coordinator began `b84b965`.

| File | Native baseline SHA-256 | Approved candidate SHA-256 |
| --- | --- | --- |
| `service/packages/cli/src/figma-web-export.ts` | `7a26c6a98c3e54deb7fff429d760716330eed6fbfbf4d40b4c37e09a721f227e` | `4b07cd47ae159abf9f3f6bba819865553b248aab61196fb749916e25ecc31998` |
| `service/packages/cli/test/figma-web-export.test.ts` | `a17f2b751a94a47fedff680219c9b3df46ca0babb1baf2b6884d9eac9615aaa1` | `0365ba6a2d67bb25f8bdf0c44f73b72a6307af19e3b0c858eb7ae55c90191dc5` |

The frozen manifest is `service/.cache/figma-design-mode-export-freeze/frozen-files.json` in the managed copy, SHA-256 `0d5a1c09a50b6656a4ba2810604b04b3fbb23808337c4b0ec69da91c980df6d7`. Its native-before patch SHA-256 is `ff1cb0e66ac6ebba6bce7e54386dea2778529948263468e1cd0b6e10684225bc`. The reviewer verified both managed hashes and both native overlaid hashes, and repeated the native hash checks after independent execution. They remained unchanged.

## Implemented behavior and review findings

The preflight runs inside the existing native-export function before installing Blob/download hooks. It counts visible semantic dialogs and alert dialogs. With no modal it continues the original export path. With a modal it requires exactly one visible dialog with the exact accessible name `Upgrade to work in Dev Mode`, exactly one scoped `Back to Design Mode` button, and the exact visible `Upgrade to Professional` marker. The Back button must be visible and enabled. Unknown, duplicate, alert or partially matching modal states fail with `FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED` without pressing Escape or another action first.

A read-only actionability trial uses ordinary pointer checks with `force:false` and a maximum one-second trial timeout. Observations and the trial race the original deadline and cancellation signal. The function rechecks file-key identity, cancellation and deadline around those observations and immediately before the actual scoped Back click. The actual click also uses `force:false` and at most 250 ms of the original remaining deadline; it is deliberately not raced. Afterward it rechecks the original guards, awaits the exact dialog's disappearance and requires no visible dialog or alert dialog before installing export hooks. A new post-dismissal alert therefore prevents the subsequent native export.

The paid marker is never activated. The implementation does not search or automate native Chrome security dialogs, inject a page API, copy another collector's facts, relax admission, replay jobs or change classification. File identity is the requested Figma file key, consistent with whole-file native export; returning from Dev Mode can legitimately change mode parameters. Existing Blob retention before immediate URL revocation, byte/magic checks, atomic publication, `fullCapture:false`, and owned-hook restoration remain present. The former hook-installation block moved inside the existing try/finally, so preflight failure still uses the original failure-artifact path without leaving an installed export hook.

No blocking issue was found. Relevant limits remain explicit:

- Playwright cannot atomically revoke an already dispatched Back click without closing the borrowed page. Cancellation or deadline during that click/dismissal can leave Back activated, while preventing Save and hook installation. The negative fixtures establish this distinction instead of claiming no UI effect.
- Observations and DOM contents can change between checks and CDP dispatch. The short ordinary click, exact scoped locator and subsequent guards reduce that interval; they do not supply an atomic DOM transaction.
- The exact English dialog contract fails closed if Figma changes labels, localization or markup. It does not broadly dismiss other modals.
- The preflight's original action deadline does not impose a new hard wall-clock bound on the inherited failure `ariaSnapshot` (up to five seconds), artifact filesystem work or final page cleanup. Issued mutating-click timeout errors retain their uncertainty; they are not proof of no effect.

## Executed evidence

The author preserved two failed development rounds before the final candidate: R1 had 10 passes and two failures out of 12, including an invalid fixture file key; R2 had 13 passes and one failure out of 14, including early Playwright timeout classification. Their receipts remain in the freeze manifest. The final R3 receipt has 15 passes, zero failures and zero skips, SHA-256 `068208ccd476dc1359b6d3383fe550c7a0f6d705b602b42ac4b2b1eaff20e829`. The author reported CLI typecheck, owned lint and format passing. These static results are author evidence, not independently rerun here.

The coordinator independently executed the final exact test file against the native validation copy with real native dependencies. The reviewer inspected `service/.cache/native-export-candidate-20261012.json`: **15 passed, zero failed, zero pending**. The suite comprises twelve new modal cases and three retained registrations; fourteen registrations launch installed headless Google Chrome and the retained stalled-renderer test uses a controlled Page stub. It covers successful dismissal/export, outside decoys, unknown/ambiguous dialogs, standalone and concurrent alert dialogs, disabled/covered controls, original deadline, file changes, before/after-activation cancellation, immediate Blob revocation and existing copy/cleanup behavior.

The reviewer additionally executed four independent boundary probes using the exact native production TypeScript source, native Vitest/Playwright dependencies, installed Google Chrome's `chrome` channel and executable, and private headless pages. All four passed:

| Independent case | Back | Paid upgrade | Save | Observed result |
| --- | ---: | ---: | ---: | --- |
| Missing paid marker | 0 | 0 | 0 | Unsupported modal; no document |
| Two scoped Back buttons | 0 | 0 | 0 | Unsupported modal; no document |
| Near-match dialog title | 0 | 0 | 0 | Unsupported modal; no document |
| New alert immediately after Back | 1 | 0 | 0 | Unsupported modal; no document |

Each probe asserted both original browser hooks restored, no export state key retained, no `document.fig`, and absent fixture page API. The independent receipt was written at `2026-10-12T01:48:53.447Z`; managed `service/.cache/design-mode-independent-result.json` SHA-256 is `856a7df3cad1994217fd110d52117b2f5c5e9210896fe1a4506fe745d18669ff`. Its runner registration passed with zero skips; `service/.cache/design-mode-independent-vitest-r2.json` SHA-256 is `fec769ae8ad26d7bc7660ec005bd1d1b355d2e087a5938aa098b34940780a0a7`.

The independent command used the native `node_modules/vitest/vitest.mjs`, with the private `.cache/design-mode-independent.config.ts` and test file in the managed copy, while running from the native validation directory. It imported the exact native candidate and real native dependencies directly. It did not run tests through the managed writable dependency junction, install dependencies or alter native/main source. Private fixture folders were created under the Windows temporary directory, verified as owned, and removed; only the owned headless browser/pages were closed.

Preparation failures are retained separately from product findings: an initial standalone runner could not find an assumed root-level esbuild package; an attempted config import used a nonexistent absolute export path; the first Vitest receipt then failed before fixture execution because it imported the CommonJS Vitest entry. Switching to a plain private config and the actual ESM Vitest entry allowed the four probes to execute successfully. None of these errors executed a live source-browser action or changed the candidate.

## Remaining coordinator verification

Integrate only the approved bytes, reconcile the new error label with the closed diagnostics catalog, build/package and run the required source-bound gates. Then run a newly authorized service job in the retained source Chrome session to test the actual observed dialog and export. Reprobe page API separately: Design Mode dismissal does not prove `globalThis.figma` will become available. Preserve jobs `4f6d727a-8c4a-4183-865e-746c04efd2c1` and `2d367c4a-c986-47da-8d19-8d2f5cdffa93` as unknown, with their existing workspace fences and failed evidence. No classifier exception is warranted by this repair.

The service still needs separate actual native document production/decoding, scope and complete node/asset/oracle admission, collector parity and frontend acceptance. The broader native-export collector adapter remains a product/implementation question documented in the availability analysis. This narrow approval authorizes integration review of modal handling only; it does not settle those outcomes.
