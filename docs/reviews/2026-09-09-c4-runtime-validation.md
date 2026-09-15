# C4 working draft and native runtime validation

Date: 2026-09-09. This record supplements the [earlier Chrome attempt](2026-09-09-chrome-c4-attempt.md).

## Result

An independent React/Vite frontend draft was implemented and submitted through the service's authenticated `portal_start`, `portal_next`, `portal_submit`, profile registration and `portal_validate` paths. The native working copy passed installation, TypeScript checking, four cart model tests, production build and real Firefox interaction tests.

**The overall C4 acceptance remains blocked.** Current live Figma capture, original image/icon assets, fonts and exact layout comparison are not verified. The draft uses previously captured values from the supplied file and explicitly marks unavailable original assets. It was not applied to the final target directory.

| Evidence | Value |
| --- | --- |
| Figma file | `4IBhv1d8hEclifZQrOYxHS`, node `0:1` |
| Case | `new-blank` / `blank-frontend` / frontend-only |
| Service references | None |
| Run | `sfp_portal1_a1e216b11cd747f87b45bb531a7f7488` |
| Candidate | `sha256:2cf190d2ed767c838a33e724556a8bd70cb5b48081104bc32dcfaaf938ee380b` |
| Candidate files | 13 |
| Native profile | `c4-furniro-draft` |
| Runtime verified | Yes |
| Live design / visual verified | No / No |
| Applied to final target | No |
| Docker | Not used |

## Implemented draft behavior

- Home, shop/search, product details, cart drawer, cart, checkout, comparison, blog and contact views, with wishlist and basic secondary navigation.
- Product search, category and price ordering, likes, comparison selection and product options.
- Local cart persistence, quantity changes, removal and totals. Different display currencies are kept separate rather than silently converted or added.
- Required-field and email validation. Checkout and contact actions are explicitly local demonstrations; they do not send an order, charge money, create an account or send a message.
- Responsive layout and a native modal dialog that contains keyboard focus and returns focus when closed.

These behaviors are implemented frontend code, not proof of pixel equivalence to the original design.

## Executed checks

The service created a separate owner-state working copy and ran five reviewed native commands. All five passed after adding the missing Vite CSS type declaration:

1. Install declared dependencies with lifecycle scripts disabled.
2. TypeScript checking.
3. Four cart model tests: persisted-data validation, quantity/removal totals, separate currencies and invalid quantity rejection.
4. Vite production build.
5. Headless Firefox checks: catalog search and wishlist; options, cart quantity, reload persistence and focus containment; local checkout and validation; contact validation; comparison and blog interactions; overflow checks at 390 px across seven routes.

A supplemental run through the native runner captured desktop and mobile screenshots from the same verified working copy. The screenshots visibly contain missing-asset markers. They are review artifacts and were not used as Figma comparison oracles.

## Artifacts

- Source: `validation/c4-20260909/draft/`.
- Runtime result: `validation/c4-20260909/validation-repaired.json`.
- Command evidence: `validation/c4-20260909/native-command-repaired.json`.
- Consolidated evidence: `validation/c4-20260909/c4-evidence.json`.
- Screenshots: `validation/c4-20260909/screenshots/desktop.png` and `mobile.png`.
- Review archive: `validation/c4-20260909/furniro-c4-working-draft.zip`.
- Archive SHA-256: `00a821c973fef0d3dabadd9a48c34c46d699f3387309374036fd376d5259937c`.

The archive contains the draft source, compiled static preview, screenshots and the dependency lock used in validation. The lock is retained under `evidence/dependency-lock-used.json`; copy it to `app/package-lock.json` before `npm ci --ignore-scripts` to reproduce those dependency resolutions. The archive is not a release or a completed design handoff.

## Connection lifecycle corrections

Chrome's existing-session workflow requests permission for each new remote debugging session, as described by [Chrome's documentation](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session). A short-lived diagnostic process therefore cannot carry its permission into an unrelated later connection.

The daemon now retains one Chrome WebSocket transport independently of each Playwright caller. An authenticated loopback adapter requires an unpredictable credential, rejects browser-origin connections, limits messages and queues, correlates request IDs, releases only its own target attachments, and blocks direct tab creation, browser closure and navigation commands. It is an internal transport for trusted service code, not a general browser security sandbox.

If a Playwright caller times out before the owner responds, its queued commands are discarded while the same Chrome permission request stays alive. A subsequent authorized invocation reuses that transport. Service shutdown closes it even if permission has not arrived. The service uses Playwright's `noDefaults` option to avoid changing daily-browser defaults, as described in [Playwright's API reference](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-browsertype.md).

The authenticated status endpoint now exposes `browserConnection` without initiating another connection. After a real plan request timed out, status remained `awaiting-browser` and the same Chrome TCP connection remained established. No new permission request was created by the status check. The actual Chrome WebSocket permission response still had not arrived at the time of this record.

The CLI also uses bounded native HTTP requests for control calls so long operations are governed by their declared budget rather than the built-in fetch client's five-minute response-header limit.

## Remaining acceptance

1. Receive the existing Chrome connection response and find the supplied Figma tab.
2. Capture and bind the current design, original assets and required visual states.
3. Refine layout, icons, typography and all required states against those originals.
4. Pass original-oracle visual checks, then apply and validate the final target.

Native formatter/linter bindings remain blocked by Windows Application Control. Source type checks and focused tests passed, but the new source changes have not received a fresh complete provenance/formatting receipt. The previous full-suite receipt must not be represented as covering these changes.
