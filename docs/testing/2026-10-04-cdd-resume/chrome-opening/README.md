# Scoped Chrome source opening

Date: October 4, 2026 (Asia/Seoul). Published baseline: `5b9343efc82ef47ba56f412acbd4eee5a328d335`, with subsequent uncommitted repairs. This is service-owned Chrome evidence, not final eCommerce frontend acceptance.

## Reproduced failure and implemented repair

The first eCommerce `chrome-open` call accepted a Chrome socket but timed out during Playwright initialization. A selected-target read then returned `FIGMA_TAB_NOT_FOUND`. The missing-source branch initialized unrelated pages before opening the requested tab. An installed-Chrome regression confirmed that this branch exposed two pages instead of just the selected source.

The revised path discovers the unique requested target before page initialization. For an explicitly authorized missing source, it checks the normal browser context is unambiguous, creates a blank tab, attaches only that target and grants one navigation to the exact requested Figma URL. The relay still rejects arbitrary target creation, unrelated navigation and navigation replays. Unknown target-creation outcomes retire the connection rather than replaying the effect. Existing source tabs are preserved.

The [original regression](../chrome-open-red-tests.json) failed as expected. A [first repair](../chrome-open-first-repair-tests.json) exposed navigation starting before the fixture route could attach. Blank creation followed by one bound navigation corrected that ordering. All [45 related tests](../chrome-open-tests.json) then passed, including installed Chrome, wrong destination/session, ambiguous contexts and unknown creation outcomes. CLI/MCP typechecks, scoped lint/format and the CLI build passed.

## Executed second-file preparation

The service CLI then [opened eCommerce successfully](ecommerce-open-result.json). Its plugin-free exporter obtained [99,302,063 bytes](ecommerce-native-export.json), SHA-256 `03709732d9d3b7424d47d45f75c974be9f1d0c2df4544f82669f325b97e4ffe1`, at `2026-10-04T09:11:48.686Z`. Service decoding verified native format 106, 1,298 stored records and 110 archive entries. Stored-record counts differ from expanded scene counts.

The service normalizer's [independent inventory](ecommerce-normalized-inventory.json) expands 3,198 nodes in 11 roots: nine frames and two auxiliary roots. It reports no expansion warnings and 15 paint-style records. This remains `fullCaptureAccepted: false`; complete properties, style identities, prototype semantics and independent render assets are not established by an inventory.

## Source verification boundary

The [provenance checkpoint](provenance-checkpoint.json) binds main/native source `sha256:2900ff9be349c3d2841458b9538a630f8711206cd702e0e585d2453dba0126a5`. Alternate-index manifest verification and offline upstream verification passed. The main owner index was unchanged.

Full-source attempt `88201dee-727c-4f7d-b931-a39c33fd477d` passed static checks but failed test adjudication: 4,709 passed, two failed and 20 existing skips across 4,731 cases. The [failed report](failed-source-report.json), [tests](failed-source-tests.json), [scope](failed-source-scope.json) and [census](failed-source-skips.json) are preserved. The failures were the native producer-output fixture and the terminal-during-commit hello-timeout fixture. No failure-ledger waiver or skip override was added. The [later budget and test continuation](../capture-budget/README.md) records investigation and subsequent changes; this failed attempt is not reclassified as passing.
