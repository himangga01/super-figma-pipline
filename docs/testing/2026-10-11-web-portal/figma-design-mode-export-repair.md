# Figma Design Mode export preflight candidate

Date: October 12, 2026 (Asia/Seoul).

## Scope and baseline

This candidate handles the specific Figma Web dialog reported by the root agent during the native export attempt at 01:25 UTC: `Upgrade to work in Dev Mode`, with `Upgrade to Professional` and `Back to Design Mode` buttons. The service exports the file produced by Figma's own Save local copy UI; it does not restore a page API, authenticate official MCP, decode a complete document, or establish frontend acceptance.

The root supplied current main/native source baseline `sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`. The two managed files matched the current native files before editing. Their original bytes were preserved privately. No stale refresh was necessary. Only the following source paths changed, in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline`:

| Path | Native before SHA-256 | Candidate SHA-256 |
| --- | --- | --- |
| `service/packages/cli/src/figma-web-export.ts` | `7a26c6a98c3e54deb7fff429d760716330eed6fbfbf4d40b4c37e09a721f227e` | `4b07cd47ae159abf9f3f6bba819865553b248aab61196fb749916e25ecc31998` |
| `service/packages/cli/test/figma-web-export.test.ts` | `a17f2b751a94a47fedff680219c9b3df46ca0babb1baf2b6884d9eac9615aaa1` | `0365ba6a2d67bb25f8bdf0c44f73b72a6307af19e3b0c858eb7ae55c90191dc5` |

This English report is the only portable documentation addition by this author. Main/native source, runtime state, catalog, provenance, canonical analysis and shared instructions were not edited. Direct imports used by the fixture and changed production file (`artifacts.ts`, `figma-url.ts`, `figma-web-copy.ts`, `atomic-file.ts`, `chrome-runtime.ts`, and `required-suite.ts`) were compared with native and matched exactly. That direct comparison is not a complete repository or transitive dependency fingerprint.

## Implemented behavior

[The exporter](../../../service/packages/cli/src/figma-web-export.ts) now runs its Design Mode preflight inside the existing error-evidence and cleanup boundary, before installing either browser export hook. It returns immediately when no visible semantic dialog or alertdialog exists. Otherwise it requires one visible dialog with the exact accessible name `Upgrade to work in Dev Mode`, no visible alertdialog, and one exact scoped instance of each expected button. It rejects an unknown or ambiguous dialog, a missing or hidden expected button, or a disabled Back button with `FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED`. It never activates the Upgrade button or an outside same-name Back button.

Before and after each observation or action it checks the original AbortSignal, original absolute deadline and current Figma file key. Read-only observations, actionability trials and dismissal waits additionally race that original signal and deadline. A trial click performs only actionability checks, with `force: false` and at most 1,000 ms of the original remaining budget. The complete dialog/button guard is then repeated. The actual Back click uses normal Playwright activation with `force: false` and at most 250 ms of the original remaining budget. There is no retry loop or forced activation. The code waits for that known dialog to disappear and checks that no visible dialog or alertdialog remains before installing hooks or using the menu.

Bounded Playwright timeouts during the read-only preflight become `FIGMA_WEB_EXPORT_TIMEOUT`, after checking for cancellation or changed file identity. The original cause is retained. This avoids presenting a Playwright hidden-wait timeout a few milliseconds before the same absolute deadline as a different failure.

The export's existing hook restoration, retained immediately revoked Blob, eight-Blob bound, 128 MiB body limit, chunk validation, file-format check, atomic output creation and `fullCapture: false` result remain in place. The existing Escape/menu/export path remains after successful preflight. No job retry, error classification, native permission handling, or portal connection lifetime changed.

## Executed verification

Commands ran from the managed `service` directory using already installed native dependencies. No package install, package build, alternate engine or live source Chrome session was used. Dependencies are readable through the existing node_modules junction; this is an isolated working copy under the same Windows user, not an OS sandbox. Fixture output and JSON receipts were confined to owned temporary folders and managed `.cache`.

```powershell
node node_modules/vitest/vitest.mjs run packages/cli/test/figma-web-export.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/figma-design-mode-export-tests-r3.json
node node_modules/typescript/bin/tsc -p packages/cli/tsconfig.json --noEmit
node node_modules/.pnpm/oxlint@1.80.0/node_modules/oxlint/bin/oxlint packages/cli/src/figma-web-export.ts packages/cli/test/figma-web-export.test.ts
node node_modules/.pnpm/oxfmt@0.65.0/node_modules/oxfmt/bin/oxfmt --check packages/cli/src/figma-web-export.ts packages/cli/test/figma-web-export.test.ts
```

Final result: **15 passed, zero failed, zero skipped**; CLI typecheck, owned-file lint and formatting checks passed. The existing three tests remained, and twelve distinct preflight fixture registrations were added. Each browser fixture explicitly selected Playwright's `chrome` channel and the installed Google Chrome executable, launched headlessly, intercepted only its owned Figma URL, and closed only its owned browser. Its temporary folder was checked to be under the intended temporary root before recursive cleanup.

The new cases verify exact known-dialog export success; scoped activation with an outside Back decoy; unknown and multiple dialogs; a visible security alertdialog with and without a semantic dialog; disabled Back followed by cancellation then later enablement; a covered Back trial followed by cancellation then later uncovering; the unchanged absolute deadline during a covered trial; changed file identity during a trial and from the Back handler; and cancellation/deadline during dismissal after Back was already issued. Every negative case asserts zero paid/outside/save activation, no output document, no remaining hooks, and no hook installed when Back ran. Before-activation cancellation cases assert zero Back activation after controls later become actionable. After-issued cases deliberately assert one Back activation and zero subsequent export activation. The original revoked-URL, export/copy cleanup and stalled-copy tests also passed.

### Preserved failed rounds

| Receipt | Result | Finding and correction |
| --- | --- | --- |
| `service/.cache/figma-design-mode-export-tests-r1.json` | 10/12 passed | Two identity fixtures used an invalid short Figma file key and therefore raised `FIGMA_URL_INVALID`; the fixture now uses a valid different key. The accompanying typecheck also exposed `it.each`'s callback context signature. Tests now use the supported `it.for` context API and unique case IDs. Conditional assertions were normalized for lint. |
| `service/.cache/figma-design-mode-export-tests-r2.json` | 13/14 passed | The real Chrome hidden wait emitted its bounded Playwright TimeoutError just before the absolute deadline. The read-only preflight timeout normalization described above repaired this boundary. The accompanying typecheck identified the `it.for` options position; it now uses the supported options object. |
| `service/.cache/figma-design-mode-export-tests-r3.json` | 15/15 passed | Final source and fixtures, including standalone alertdialog guard. |

These receipts were retained rather than overwritten. Their full SHA-256 values are in the frozen manifest.

## Frozen handoff

Private artifacts, relative to the managed service directory:

- `.cache/figma-design-mode-export-before/`: exact native-before copies of both files.
- `.cache/figma-design-mode-export-freeze/frozen-files.json`: before/after file hashes, original baseline, receipt hashes and patch hash. SHA-256 `0d5a1c09a50b6656a4ba2810604b04b3fbb23808337c4b0ec69da91c980df6d7`.
- `.cache/figma-design-mode-export-freeze/candidate.patch`: patch against the exact native-before copies, with repository-relative paths. SHA-256 `ff1cb0e66ac6ebba6bce7e54386dea2778529948263468e1cd0b6e10684225bc`.
- `.cache/figma-design-mode-export-tests-r3.json`: final focused test receipt. SHA-256 `068208ccd476dc1359b6d3383fe550c7a0f6d705b602b42ac4b2b1eaff20e829`.

The root and the independent SOL reviewer received the exact frozen hashes. A read-only `git apply --check` against the current main/native tree succeeded, and both source hashes were rechecked unchanged afterward. Author files remain frozen during review. The root owns native integration, broader source-bound verification and any actual Figma acquisition attempt.

## Limits and next acceptance

Public Playwright locator activation has no per-action AbortSignal or public queued-click cancellation method. Closing a borrowed source page or browser to cancel a click would violate ownership. Therefore the final issued Back click is not atomically cancellable. Cancellation or file changes between the final check and browser activation can still permit that already-issued bounded UI action; the code rechecks afterward and prevents subsequent export setup. The fixtures distinguish this limit from cancellation before activation. Trials and observation races do not activate a UI control, even if their read-only work finishes later. The 250 ms click timeout bounds the actionability queue; it is not a hard OS/process deadline or proof that a dispatched input event can be retracted.

Dialog recognition relies on visible semantic dialog/alertdialog roles and the exact English accessible name/button labels supplied by the actual receipt. It deliberately does not infer permission from similar text, translations, or arbitrary overlays. Live markup could differ from the owned fixture. The existing diagnostic snapshot and cleanup can also take time after an operation is rejected; this candidate does not redesign those existing cleanup deadlines.

No live Chrome, account setting, native approval, paid action, saved preference or source file was operated by this author. The whole check for the previous `f0dc` source does not cover this candidate. Independent review, root-owned native verification, an authorized new live attempt on the same source file, and any broader capture/decoding/oracle acceptance remain necessary. Earlier failed or unknown jobs stay failed or fenced; this preflight does not authorize replay.
