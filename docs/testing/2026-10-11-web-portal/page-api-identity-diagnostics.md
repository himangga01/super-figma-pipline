# Independent page-API identity failure and bounded diagnostics

Date: October 11, 2026, 21:32 KST. This source review followed the owner's first real portal usage round. Read the [canonical analysis](../../service-analysis.md), [usage implementation record](usage-guide-implementation.md), [current page-API review](../2026-10-10-continuation/cdd-page-api-candidate-review.md) and [AGENTS.md](../../../AGENTS.md) before reuse.

## Baseline and executed evidence

The starting service epoch was `935216d1...`, with later separately owned uncommitted portal/admin changes. Before this repair, main and native `packages/cli/src/figma-page-reader.ts` were identical at `f346bb9781c7bd44392821529dee9db9b2a70fb2ae35c1a1600bc07f8981ccd0`, and their browser-session files were identical at `bcb847671d664491d412fd33ce0c36db3fa3a8dbcd37ff448560d9c2e7545896`. The coordinator subsequently added an optional abort argument to managed `openChromeSession`; that change was preserved, not authored or reverted by this diagnostic worker.

The owner-run portal round at 21:18 passed nine actual guide/setup/save/run/activity checks, but independent source capture failed at stage `snapshot` with `FIGMA_PAGE_IDENTITY_CHANGED`. Its retained `round-1-latest.json` SHA-256 is `eb5d45401b5f850033c1a4e24f3123c7ca2b630d7e3cec61006576f344ffddd3`. It did not satisfy capture or generation acceptance. The owner-run service CLI probe at 21:26 reported `available:true`, `identityVerified:false`, `pageId:"1378:120"`, `fullCapture:false` against the requested CDD URL/node. Its private observation hash is `e6770a6cc2f3c790846104a0710844b57f141e0232a042b7f4e456fa7e7cb1dc`.

Earlier complete page-API acquisition at 20:06 and complete Scripter acquisition at 20:31 are separate historical observations. They do not make the failing current capture complete. Source inspection does not establish that the Scripter operation caused the current failure.

## Findings

`FIGMA_PAGE_IDENTITY_CHANGED` is a shared failure code for URL/file mismatch, runtime file mismatch, replaced API/page objects during the bounded read, and changed result envelope identity. The reader creates a fresh retained API/page/scope handle for each read; it does not reuse a page-global API object from the 20:06 read. The owner probe's `identityVerified:false` specifically means its observed API file key did not equal the requested file key. A page switch before a read would normally fail scope ancestry instead, unless runtime/file identity also changed. The older code alone cannot distinguish an absent/undefined key from a different string key.

Figma's primary documentation declares `figma.fileKey` as `string | undefined`, with access restricted to private plugins/Figma resources and the `enablePrivatePluginApi` manifest capability. [Figma API documentation](https://developers.figma.com/docs/plugins/api/figma/), [manifest documentation](https://developers.figma.com/docs/plugins/manifest/). If the new probe observes an undefined key, that is a required identity capability gap, not proof of a different file. This is a conditional interpretation; the fresh diagnostic probe is still needed. Filling the key from the requested URL or weakening object/file guards would fabricate the missing runtime binding.

The read adapter has no confirmed restoration method from the available filesystem evidence. The page-API adapter also lacks the Scripter adapter's retained failure-page helper, and the broad failure code limits attribution. These are diagnostic limitations, not permission to substitute a different collector's successful output or automatically replay an unknown operation.

## Bounded implemented repair

Only the managed `browser-session.ts` runtime-probe section and new `test/browser-runtime-probe.test.ts` were authored. The probe now reports `fileKeyPresent`, `fileKeyType`, `fileKeyMatches`, `stableApiObject`, and `stablePageObject`. It never returns the raw runtime key. Stability checks are synchronous repeated-property observations only, not proof of stability across capture. If a getter fails, diagnostic values are explicitly unknown/null and the original bounded unavailable response remains. Existing `available`, `identityVerified`, URL/deadline/signal checks and `fullCapture:false` semantics are preserved. No page API method is invoked by the probe and no plugin is opened.

Snapshot identity and scope guards were not changed. Regression fixtures confirm that missing, undefined, numeric or mismatched keys still reject capture, that replaced API/page wrappers remain rejected, and that raw mismatched values/getter error text are absent from diagnostic responses.

## Verification and frozen paths

Seven new cases genuinely failed before implementation at 21:29:02 because the diagnostic fields were absent. All seven passed after the repair at 21:29:16. The related four-file run at 21:29:49 passed 61/61 cases with no failures: runtime probe, browser session, page reader and browser source opening. These were isolated owned headless Google Chrome fixtures, not the retained source session or real portal rounds. CLI typecheck and scoped Oxlint/Oxfmt passed. Direct native tool entry points were used; no package installation, dependency rebuild, index edit, native/main source edit or source Chrome interaction occurred.

| Managed path | SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `45e0b75729740c563e98a83a807ea0d687698362e364704dc0caf5245b56e97f` |
| `packages/cli/test/browser-runtime-probe.test.ts` | `7b589effded5fdef41221f3051ccf91e9585cd113ebee26a605552f6aa8e688b` |

The coordinator owns native integration/build and the fresh service-owned runtime probe. No restoration or current source-capture success is claimed here. Under the owner's latest instruction, visible live testing must continue through the one currently opened portal Chrome window/tab; this worker will not launch additional Chrome sessions without coordination.

## Next evidence and action

Inspect the fresh safe key presence/type/match and stability fields. A mismatching string key requires the owner to investigate the actual selected runtime/file. A missing or undefined key requires a verified Figma-supported path that exposes the required runtime identity. Unstable objects require retaining the guards and investigating the actual wrapper lifecycle. A matching/stable synchronous probe still requires fresh complete capture, current-source verification and explicit subsequent workflow actions. Preserve the first failed real round; do not count preparation or a different collector as its success.
