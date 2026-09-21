# Super Figma Pipeline

[English](README.md) | [한국어](README.ko.md)

A local Figma-to-application pipeline for reading designs without Figma Dev Mode or the official Figma MCP, analyzing service code, and helping a coding agent implement the design in the target application.

**Status: development in progress, updated September 21, 2026.** Capture, source analysis, portal orchestration, and native validation have implementations and targeted tests. Full acceptance across all four cases and final release verification remain unfinished.

## How it works

1. Read the selected Figma file through external Playwright/Scripter in Chrome, or through the paired Figma Desktop development plugin.
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

## Read the supplied Figma design

Open [the sample eCommerce design](https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1) in Chrome and sign in with an account that can access the file. Enable remote debugging at `chrome://inspect/#remote-debugging` and accept Chrome's connection prompt when shown.

The Chrome route uses external Playwright and the Scripter plugin, not the built-in GPT browser. The current CLI attaches to an open tab; Scripter must be available for the account/file. Chrome's native debugging permission prompt requires user interaction and cannot be accepted through the not-yet-authorized Playwright connection.

From `service/`, after building:

```powershell
node packages/cli/dist/index.mjs chrome-inspect --url "https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1" --out "C:\figma-inspections\ecommerce"
```

Figma Desktop is optional for the Chrome route. The Desktop route requires importing and running the generated development plugin once, then pairing it; installing or opening the Figma app alone is insufficient. Neither route requires Dev Mode or the official Figma MCP.

## Current progress and remaining work

The latest fixes prevent variable creation after cancellation during asynchronous preflight, and restore document/nested scroll positions after browser property inspection. Related validation passed **37 tests**, MCP/plugin type checks, and lint. These are targeted results, not full release acceptance. See the [fix report](docs/reviews/2026-09-21-cancellation-and-scroll-fixes.md).

Remaining work:

- Finish verification that generated and applied code actually uses the captured design values, components, and assets.
- Complete retained style, text, override, variant, motion, and export workflows; several pieces are still models or proposals.
- Update interface compatibility requirements, capability metadata, generated artifacts, and the adoption status of the 69 cataloged upstream features.
- Implement portable offline capture packages containing both design structure and assets.
- Complete current-service live Figma acceptance and representative C2/C3/C4 tests, including both React/Vite and Vue/Vite for C4 and the C1 routing cases.
- Complete two final whole-code review rounds, resolve valid findings, and run clean-source, Windows package, and release checks.

The [active scope plan](docs/plans/2026-09-07-portal-four-cases-plan.md), [remaining-work plan](docs/plans/2026-09-14-remaining-work-plan.md), and [development checkpoint](docs/reviews/2026-09-15-development-checkpoint.md) provide details. Older evidence records are dated snapshots; the September 21 report closes the checkpoint's two bug findings.

## Validation boundaries

Native validation runs under the local owner account in a separate working directory. File hashes, reviewed execution profiles, deadlines, and owned process cleanup do **not** provide an OS filesystem or network sandbox.

Application previews use headless Firefox; Chrome is the Figma source. Source checks, live design capture, UI comparison, and real API/data/authentication workflows are separate acceptance evidence. A successful build or mocked API test does not establish complete C2/C3 behavior. Other host platforms have not received final native acceptance.

## Repository and upstreams

| Location                                                         | Purpose                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`service/`](service/)                                           | TypeScript workspace: MCP server, CLI, Figma plugin, shared contracts, and IR.          |
| [`service/docs/portal-native.md`](service/docs/portal-native.md) | Portal planning, coding leases, native profiles, validation, application, and recovery. |
| [`docs/plans/`](docs/plans/)                                     | Scope, implementation plans, and acceptance criteria.                                   |
| [`docs/reviews/`](docs/reviews/)                                 | Dated review findings and validation evidence.                                          |

The pipeline adapts **Figwright**, **figma-mcp-rust**, and **figmosha2**. Feature registration, behavioral equivalence, workflow integration, and verified execution are tracked separately; full upstream adoption is not yet claimed. Original local `code-kb/` checkouts remain read-only reference material and are not runtime dependencies.

See [source provenance](service/PROVENANCE.md), the [service license](service/LICENSE), and [retained upstream licenses](service/licenses/).
