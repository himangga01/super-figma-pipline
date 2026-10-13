# Super Figma Pipeline

[Current overview](README.md) | [Compatibility overview path](README.ko.md)

A local Figma-to-application pipeline that collects design facts through Chrome and Playwright, supports Figma's official MCP servers, analyzes service code, and helps a coding agent implement the target application.

**Status: development in progress, updated October 14, 2026.** The login-free web portal exposes the public CLI and MCP tool catalog, workflow settings, connections, operations, results, activities and user guidance. Current CDD generation passed six native commands, three visual/accessibility screens, four source workflows and all1,749 design-consumption observations. Its live design refresh failed, so the current candidate remains unapplied. Actual C2/C3 implementation and full-case checks, final integration and main publication remain unfinished. The owner excluded collector comparison and the final eCommerce test from this completion and deferred official-MCP live acceptance. Those exclusions are not passing tests. See [current progress](docs/analysis/progress-2026-10-12.md), [service analysis](docs/service-analysis.md), [the release checklist](docs/testing/2026-10-11-web-portal/final-release-checklist-20261014.md) and [portal guidance](docs/portal-user-guide.md). Earlier successful applications remain dated historical evidence.

## How it works

1. Read the selected Figma file in Chrome through external Playwright and the Scripter plugin, or through the paired Figma Desktop development plugin. A separate native reader collects the Figma Web document without Scripter, and its facts are compared with the Scripter collection.
2. Collect design structure, component properties, variables, styles, interactions, and available assets. Missing or partial evidence stays explicit.
3. Analyze the designated legacy/reference code for components, conventions, dependencies, and relevant API, data, authentication, and configuration patterns.
4. Give a coding agent design and source evidence through the portal tools. The agent submits actual implementation files; starting a plan alone does not generate a finished application.
5. Validate candidates in a separate native working copy, compare rendered UI with Figma exports, and apply accepted changes to the designated target.

Code-pattern learning means analyzing and reusing evidence from the selected repositories. It does not mean training a new model.

## Four implementation cases

| Case                               | Input                                            | Required scope                                                                                                                           |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1: new service                    | Figma, with an optional service reference        | Select C3 when a reference exists, otherwise C4.                                                                                         |
| C2: legacy service                 | Figma and the existing target service            | Preserve relevant patterns and implement the UI plus necessary API, backend, data, authentication, and integrations.                     |
| C3: reference-based new service    | Figma and explicitly selected reference services | Build an independent working portal using relevant reference architecture and libraries, including missing service layers when required. |
| C4: new service without references | Figma, with no service reference                 | Frontend only: routes, responsive components, local state, and clearly identified demo adapters.                                         |

**Only C4 is frontend-only.** A frontend-only reference does not automatically reduce C3's required scope. The three foundation toolkits are not automatically treated as service references.

## Development setup

Use Windows, Node.js 24, and the repository-pinned `pnpm@11.24.0`. Run development validation in a separate working copy. Docker is not used.

From the repository root:

```powershell
cd service
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm build
node packages/cli/dist/index.mjs help
```

Start the local daemon in a dedicated terminal for administrative and portal commands:

```powershell
node packages/mcp/dist/daemon-entry.mjs
```

Stop that foreground daemon with `Ctrl+C`. In another terminal, from `service/`:

```powershell
node packages/cli/dist/index.mjs status
node packages/cli/dist/index.mjs tools list
```

For an MCP client, use `node` with the absolute path to `service/packages/mcp/dist/index.mjs`. See the [service README](service/README.md) for portal planning, Desktop setup, and validation commands.

The login-free service web portal is available after building. With the daemon running, execute `corepack pnpm portal:start` from `service/`, then open `http://127.0.0.1:4310` in Google Chrome. It provides workflow editing, saved settings, live stages, approvals and service actions. See [web portal setup and current execution limits](service/README.md#service-web-portal). Local source and package checks have passed; live Figma acceptance remains incomplete, and the interface does not include its own background coding model.

To continue the current work on another machine, follow the [another-PC handoff](docs/handoff/another-pc-2026-10-05.md). It covers the separate validation copy, the service state that Git does not carry, the expected source fingerprint, and the first whole check still owed.

## Read the supplied Figma design

For the current CDD workflow, open [the CDD design](https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120) in Chrome with an account that can access it. The examples below retain the earlier eCommerce input as setup documentation; its final test is currently owner-skipped. Enable remote debugging at `chrome://inspect/#remote-debugging` and accept Chrome's connection prompt when shown.

The service attaches to an open Chrome tab through its own Playwright/CDP path. Independent page-api collection does not invoke Scripter; the separate Scripter collector requires that plugin for the account/file. Native document export is another independent acquisition capability. Chrome's debugging permission prompt requires user interaction before that connection can control a page.

From `service/`, after building:

```powershell
node packages/cli/dist/index.mjs chrome-inspect --url "https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1" --out "C:\figma-inspections\ecommerce"
```

Other Chrome commands, all from `service/`:

| Command | Purpose |
| --- | --- |
| `chrome-open --url <figma-url>` | Open a missing Figma tab in the existing authorized Chrome; the owner approves Chrome's prompt |
| `chrome-export --url <figma-url> [--out <folder>]` | Collect the native Figma Web document without Scripter |
| `chrome-compare --input <document.fig> --reference <design.json> --url <figma-url> [--reference-assets <assets.json>] [--out <folder>]` | Compare the native document with a Scripter collection |

Figma Desktop is optional for the Chrome route. The Desktop route requires importing and running the generated development plugin once, then pairing it; installing or opening the Figma app alone is insufficient. A pairing code expires after 5 minutes, so start the plugin promptly or issue a fresh code with `pair`. Neither route requires Dev Mode or the official Figma MCP.

Official Figma MCP integration accepts only `https://mcp.figma.com/mcp` and Figma's local `http://127.0.0.1:3845/mcp`. Use `figma-mcp config`, `figma-mcp probe`, or `figma-mcp read --url <Figma-node-URL>` through the built CLI. Remote reads require externally authorized OAuth credentials; `--oauth-token-env` names their environment variable without persisting or printing its value. The supported read tools are metadata, variable definitions, screenshots and Code Connect maps. These supplemental reads return `fullCapture: false` and do not replace primary Chrome collection or frontend acceptance.

Plan limits apply. Figma's [rate limits and access page](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), read on October 5, 2026, gives the Starter plan 20 tool calls per month. On the owner's Starter account, the local desktop server was not listening on port 3845. That server probably needs a paid Dev or Full seat; this is an inference, not verified.

For the requested atomic-design file, the [October 2 comparison](docs/testing/2026-10-02-figma-comparison/README.md) records 189 nodes and 6,426 matching field positions between Chrome Web and official MCP. Its stated field boundary does not establish full mixed-text, asset or generated-frontend acceptance.

## Current progress and remaining work

Current remaining work is the CDD live freshness/guarded application gate, complete applicable C2/C3 workflows, and final reviewed integration/main commit-push. The owner requires these by October14,08:00KST, with no whole regression repeat or repeated passing checks. See [the current checklist](docs/testing/2026-10-11-web-portal/final-release-checklist-20261014.md). Official-only MCP support is implemented; its live verification is deferred. Independent collector comparison and final eCommerce testing are excluded from this completion.

The following October5 snapshot and its original work list are historical evidence, superseded for current execution by [AGENTS](AGENTS.md). State was at `main`, service fingerprint `sha256:eb9c2c5c...`, after the repairs recorded in [the findings and metadata record](docs/testing/2026-10-05-findings-and-metadata/README.md).

| Area | State | Evidence |
| --- | --- | --- |
| CDD design, C4 frontend | Chrome/Scripter run R8 completed candidate validation, guarded application, applied runtime, visual and interaction checks, and final source freshness | [CDD record](docs/testing/2026-10-03-cdd-generation/README.md) |
| eCommerce design | Complete Chrome/Scripter preparation: 3,198 nodes, 11 roots and 283 assets. Workflow preparation R6 succeeded with 92 of 92 workflow scopes resolved. No eCommerce frontend has been generated yet | [Collection record](docs/testing/2026-10-04-ecommerce-parity/README.md), [control diagnostics](docs/testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md) |
| Independent native reader | 110 compared fields with zero unexplained differences: 204,255 eCommerce and 14,128 CDD positions. Values it cannot determine, such as local style identifiers, are counted as unobserved (10 and 383). Twelve reference fields remain, and it is not accepted as full capture | [Native increments](docs/testing/2026-10-04-ecommerce-parity/native-effects/README.md), [metadata fields](docs/testing/2026-10-05-findings-and-metadata/README.md) |
| Control monitoring | The R3–R5 preparation failures came from Windows authorization probe timeouts during polling. Monitoring now waits out a typed busy state for up to 60 s instead of cancelling | [Control diagnostics](docs/testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md) |
| Local verification | The last complete whole check passed all 16 gates at an earlier source: 4,769 tests passed, 0 failed and 20 skipped. The current source's whole check was interrupted by low memory and is still owed | [Interrupted check](docs/testing/2026-10-04-ecommerce-parity/native-effects/interrupted-source-check.json) |
| Official MCP and Desktop | The October 2 field comparison is recorded below. The official path's account plan is undecided, and Desktop plugin pairing has not completed yet | [Service analysis](docs/service-analysis.md) |

These are local and live evidence records, not release acceptance.

Historical remaining work recorded on October5, preserved without reactivation:

1. Run the whole check for the current source.
2. Decide the official MCP path (plan or seat, remote OAuth within the quota, or record it as blocked). Then allow an official MCP read to produce its own frontend; the portal source schema currently admits only Chrome and Desktop sources.
3. Pair the Desktop plugin and compare its collection with Chrome.
4. Finish the remaining native fields (component semantics and geometry), independent exports and capture admission. The four open review findings and the authorization-load reduction were completed on October 5.
5. Complete the relevant C1–C3 full-portal cases and review gates.
6. Run the final eCommerce acceptance: two separate new frontends, one from official MCP and one from Chrome, without reference frontend code.
7. Run the final release review: `verify:release`, remote CI and two final whole-code review rounds.

The [remaining-work list](docs/handoff/another-pc-2026-10-05.md#10-remaining-work) separates owner decisions from agent work. Details are in the [active scope plan](docs/plans/2026-09-07-portal-four-cases-plan.md) and the [remediation plan](docs/plans/2026-09-30-code-remediation-plan.md). Older evidence records are dated snapshots.

## Validation boundaries

Native validation runs under the local owner account in a separate working directory. File hashes, reviewed execution profiles, deadlines, and owned process cleanup do **not** provide an OS filesystem or network sandbox.

This is a Chrome-only service. Figma capture uses the existing Chrome session; application previews use installed Google Chrome stable in a separate owned headless session with a temporary profile, explicitly selecting Playwright's `chrome` channel. A missing Chrome installation blocks previews. Source checks, live design capture, UI comparison, and real API/data/authentication workflows are separate acceptance evidence. A successful build or mocked API test does not establish complete C2/C3 behavior. Other host platforms have not received final native acceptance.

## Repository and upstreams

| Location                                                         | Purpose                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`service/`](service/)                                           | TypeScript workspace: MCP server, CLI, Figma plugin, shared contracts, and IR.          |
| [`service/docs/portal-native.md`](service/docs/portal-native.md) | Portal planning, coding leases, native profiles, validation, application, and recovery. |
| [`docs/service-analysis.md`](docs/service-analysis.md)           | Canonical service analysis: current state, findings, and verification limits.          |
| [`docs/handoff/`](docs/handoff/)                                 | Handoffs for reboots and for continuing on another PC.                                  |
| [`docs/testing/`](docs/testing/)                                 | Dated live, parity, and whole-check evidence.                                           |
| [`docs/plans/`](docs/plans/)                                     | Scope, implementation plans, and acceptance criteria.                                   |
| [`docs/reviews/`](docs/reviews/)                                 | Dated review findings and validation evidence.                                          |

The pipeline adapts **Figwright**, **figma-mcp-rust**, and **figmosha2**. Feature registration, behavioral equivalence, workflow integration, and verified execution are tracked separately; full upstream adoption is not yet claimed. Original local `code-kb/` checkouts remain read-only reference material and are not runtime dependencies.

See [source provenance](service/PROVENANCE.md), the [service license](service/LICENSE), and [retained upstream licenses](service/licenses/).
