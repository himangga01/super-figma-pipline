# Independent review of retained Chrome source-tab replacement

Review date: October 11, 2026, 18:39-18:45 KST (Asia/Seoul).

## Scope and disposition

**No actionable production defect was found in the five frozen replacement paths within this bounded review.** The three changed test files passed 49 cases, including the service-owned installed-Chrome replacement/restart fixtures. The adjacent source-open suite passed 17 further cases with the managed-local package-identity configuration. Its ordinary-config initialization failure is retained below as environment evidence, not counted as a pass. Total executed passing cases across these two scoped invocations: **66**, with no skipped cases.

This review read the [implementation record](chrome-replacement-repair.md), [canonical service analysis](../../service-analysis.md), [repository instructions](../../../AGENTS.md) and shared analysis policy. It supplements those records and the [web portal review](../2026-10-11-web-portal/review.md). The coordinator owns canonical integration, source Chrome, daemon operations and whole-source evidence. This review does not change implementation or shared schemas, and it did not use Superpowers skills under the latest task instruction.

The source under review is `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`, detached at published Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with substantial pre-existing continuation changes. HEAD alone does not identify this working tree. The production differences were compared directly with the current main checkout to isolate this repair from earlier uncommitted node-selection, observation-budget and page-API work. The relevant new changes are the missing-page refresh in `browser-session.ts` and confirmed-detach bookkeeping in `chrome-transport.ts`; earlier neighboring implementation was not misattributed to this repair.

## Purpose and implementation examined

The local service retains the owner's approved Chrome connection between source acquisitions. Its private relay attaches only to the chosen source page. A healthy remote socket can therefore outlive the selected tab while its local Playwright view does not yet include a separately opened replacement.

On a new explicit request, `ExistingChromeConnection.open()` checks its current local pages using the same exact Figma-file matcher as final selection. If no matching page remains on a healthy connection, it closes and refreshes that local Playwright view over the retained approved transport. The relay's normal scoped target scan then finds the replacement. The new branch does not itself launch Chrome, navigate a user tab or create a missing source. An explicit `openIfMissing` request remains necessary for the separately established creation path.

The relay now removes confirmed detached session IDs from its owned attachment set and one-use navigation grants before forwarding the detach event. Closing the old local client consequently does not send another detach for a session already reported dead. Remaining owned attachments are still detached during reset; the connection's automatic discovery is disabled, and user pages are not closed.

The inspected boundaries and executed evidence are:

| Behavior | Review result |
| --- | --- |
| Replacement refresh | The missing-page branch refreshes once per explicit open attempt and reuses the existing relay. The real Chrome fixture closes the original selected page and opens a replacement through a separate service-owned connection before the retained connection finds it. |
| Exact file and ambiguity | The shared matcher uses parsed Figma file identity. The real fixture rejects a wrong-file replacement and two matching replacements. Its unrelated page retains its title and remains open. These assertions concern the requested replacement scan, not a new claim about every possible browser target race. |
| Active acquisition | A disappeared source cannot force replacement while a logical acquisition still owns its session. The fixture receives `CHROME_SOURCE_BUSY` and observes no browser close or second connection. |
| Cancellation | A cancelled waiter returns its original reason; the configured connection timeout is forwarded to replacement initialization. Shared initialization can finish later, but the cancelled caller does not create selected-page CDP activity. A later explicit request may reuse the resulting connection. |
| Resource and authority boundaries | Refresh preserves the existing endpoint/generation unless the prior transport is already terminal. Existing private relay authorization, browser-Origin rejection, scoped attachment, forbidden navigation and unknown-outcome retirement remain in place. |
| Detach cleanup | Confirmed detach removes ownership/navigation bookkeeping. The protocol fixture observes no redundant detach, no second remote connection and a retained connected state after client reset. |
| User-browser isolation | The executed Chrome tests use installed Google Chrome, Playwright's `chrome` channel, owned temporary profiles and locally fulfilled Figma-shaped pages. They do not attach to the user's source browser. |

No new product choice was needed for this repair. Cancellation still abandons one logical wait rather than revoking the owner's retained browser authorization. The connection timeout bounds Playwright initialization; caller signals provide the caller's broader cancellation/deadline boundary. The review does not claim that shared initialization is physically cancelled when one waiter leaves.

## Verification executed

At 18:41:50 KST, from the managed service directory:

```powershell
node node_modules/vitest/vitest.mjs run packages/cli/test/browser-session.test.ts packages/cli/test/browser-session-reconnect.test.ts packages/mcp/test/portal/chrome-transport.test.ts --no-cache
```

Result: **three files, 49 passed, zero failures and zero skips**. The selected suite includes real installed-Chrome restart/replacement behavior and injected protocol/session fixtures. It also exercises relevant existing authorization, creation, ambiguity, cancellation, unknown-outcome and reset paths.

Both package type checks passed:

```powershell
node node_modules/typescript/lib/tsc.js --noEmit -p packages/cli/tsconfig.json
node node_modules/typescript/lib/tsc.js --noEmit -p packages/mcp/tsconfig.json
```

Direct installed `oxlint --deny-warnings` and `oxfmt --check` passed for the five reviewed paths. No package installation or linked-package build was run.

At 18:42:45 KST, the reviewer independently reproduced the adjacent source-open initialization failure:

```powershell
node node_modules/vitest/vitest.mjs run packages/cli/test/browser-source-open.test.ts --no-cache --maxWorkers 1
```

Result: **one failed suite, zero executed cases**. Module evaluation throws `TypeError: Cannot read properties of undefined (reading 'default')` at `packages/shared/src/portal.ts:853`, while evaluating `PortalCoreDeclarationBatchSchema.default([])`, through `portal-recipes.ts` and `portal-core-lifecycle.ts`. The coordinator's investigation attributes this managed-checkout failure to package imports resolving through a dependency junction into the native shared package while relative imports load the managed shared package. The `sample_module_support` worker owns the local validation-alias correction. The reviewer requested its exact corrected test configuration and did not change shared schemas or dependency links to hide the failure.

At 18:44:27 KST, after inspecting the private configuration supplied by `sample_module_support`, the reviewer independently ran:

```powershell
node node_modules/vitest/vitest.mjs run --config ../.task-evidence/managed-cli-vitest.mjs --configLoader native --no-cache --maxWorkers 1 packages/cli/test/browser-source-open.test.ts
```

Result: **17 passed, zero failures and zero skips**. The configuration reuses the existing CLI test settings and changes only local validation identity: `@sfp/shared` points to this managed checkout's `packages/shared/src/index.ts`, and test cache location is outside service source. The source-open assertions and shared schemas were not changed or skipped. The private config's SHA-256 was `1368aea161f86f8b934bbb2d0e708c5d04d000ca5aebb339325e365feded0449`. This corrects the mixed-checkout validation environment for this scoped run; it does not claim that the ordinary root command has stopped failing or that production/package startup has been independently revalidated.

The five-path repair can proceed to integration and the coordinator's current-source/package gates. Preserve the distinction between the ordinary-config failure and the managed-local pass.

## Frozen source identity

Hashes were independently read after the executed tests/static checks at 18:43:07 KST and checked unchanged again after the managed-local source-open run at 18:44:49 KST. All five match the implementation record. The independently recomputed slice digest is `sha256:63a2c6975567af3f3a93ee703f709eec2d40ce860c3df374163e5ec3f0d1560f`, computed from JSON of the ordered `{path,sha256}` entries below without hash prefixes. It is a five-file digest, not the whole-service fingerprint.

| Path relative to managed `service` | SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `bcb847671d664491d412fd33ce0c36db3fa3a8dbcd37ff448560d9c2e7545896` |
| `packages/mcp/src/portal/chrome-transport.ts` | `96ee2e62ab36739aff909de959a8b935803465a717348bad36dd05bcbe86cf1d` |
| `packages/cli/test/browser-session.test.ts` | `6e14e79c2a14285a0cf4a30a6342349261a496ad7fd497548eef1d25c5a57772` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `6bd5369f20c9603dab75103ae8e37e9a76dd676a89690bba13a275124e30e3fc` |
| `packages/mcp/test/portal/chrome-transport.test.ts` | `77faa7878e24f45709d0e6838bcf52fa132aef059f8a3a072d96e05c281da407` |

## Limits and continuation

Only this English report was written by the reviewer in the persistent project. No implementation, test, shared schema, dependency, Git index, provenance record or daemon state was changed. No Docker, Codex browser, CUA, Figma connector, real source capture or real daemon command was used. Owned profiles and a separate checkout organize test state under the same Windows owner account; they are not an operating-system security sandbox.

The reported live stale-tab failure is plausible given the reproduced mechanism, but these fixtures do not prove that the retained live daemon now runs the repaired source or that the next CDD capture will succeed. The web portal's local frontend/backend and approval tests remain separate from its blocked real source-acquisition path. The user's portal-completeness question therefore still requires an honest distinction between implemented/fixture-verified portal behavior and remaining live capture, generation and acceptance.

Continuation:

1. Preserve the failing ordinary-config result and the independently passing managed-local source-open run as separate environment evidence. Use a coherent package identity in further managed validation without changing shared schemas to mask the failure.
2. Integrate the exact five reviewed files with the separately owned sample/accessibility and web-portal slices. Refresh provenance and the current-source whole/artifact gates.
3. The coordinator can restart the proper service build and verify a new explicit acquisition through its own Chrome path, preserving the owner's source session, approvals, operation budgets and unknown-outcome fences.
4. Record the actual new result without replacing earlier failed plans. Preserve the CDD-before-eCommerce order, independent collector comparison and official-MCP acceptance obligations.
