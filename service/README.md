# Super Figma Pipeline

[English overview](../README.md) | [Korean overview](../README.ko.md)

A local Figma-to-portal pipeline that can read design values without Figma Dev Mode or the official Figma MCP. It supports a paired Desktop development plugin and external Playwright/Scripter access to an existing Chrome tab.

**Development status, September 21, 2026:** this is a work-in-progress service, not a completed release. The latest cancellation and observation-scroll fixes passed 37 related tests, MCP/plugin type checks, and lint. See the [fix report](../docs/reviews/2026-09-21-cancellation-and-scroll-fixes.md) and the [remaining work](../README.md#current-progress-and-remaining-work).

Use `node packages/cli/dist/index.mjs tools list` against the running daemon for the current tool schemas. Tool registration is distinct from successful live design or target-portal acceptance; historical fixed tool counts are not the current capability contract.

## Build and start

Use Node.js 24 and `pnpm@11.24.0`, from `service/` in a separate development working copy:

```powershell
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm build
node packages/mcp/dist/daemon-entry.mjs
```

The daemon runs in the foreground; stop it with `Ctrl+C`. Run CLI commands from another terminal in `service/`. For MCP clients, configure `node` with the absolute path to `packages/mcp/dist/index.mjs` instead. See the [repository overview](../README.md#development-setup).

## Four implementation cases

| Request                                  | Resolution                           | Scope                                                                      |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| New service                              | Reference supplied: C3; otherwise C4 | Inherits the resolved strategy                                             |
| Existing legacy service                  | C2                                   | All relevant UI, API, backend, data, auth, job and integration changes     |
| New service based on explicit references | C3                                   | An independent portal using relevant reference patterns and service layers |
| New service without a reference          | C4                                   | Frontend only, with honest local demo adapters                             |

The three upstream toolkits are pipeline foundations. They are never automatically treated as business-service references.

## Start a portal plan

From the `service` directory, after building:

```powershell
node packages/cli/dist/index.mjs portal plan --case new --yes
node packages/cli/dist/index.mjs portal plan --case legacy --target C:\services\legacy --yes
node packages/cli/dist/index.mjs portal plan --case new-reference --reference C:\services\reference --out C:\services\new-portal --yes
node packages/cli/dist/index.mjs portal plan --case new-blank --stack react-vite --yes
```

The supplied Figma file `4IBhv1d8hEclifZQrOYxHS`, initially node `0:1`, is the default design binding. `--url` selects another explicit design. A new service does not require an existing repository: the CLI can register `~/Projects/SuperFigmaPortals` as its output workspace.

Keep the requested file open in the existing Chrome. Enable remote debugging at `chrome://inspect/#remote-debugging` and accept Chrome's connection prompt. The service attaches to that session, finds the exact file, and runs the verified Scripter reader. It does not launch Chrome, create Chrome tabs, navigate the Figma tab elsewhere, or copy login cookies. Scripter must be available to the account/file; unavailable access remains an explicit incomplete plan.

The Chrome path uses external Playwright, not the built-in GPT browser, and does not require the Figma Desktop app. Chrome's native permission prompt cannot be accepted through a Playwright connection that has not yet been authorized.

A coding agent uses `portal_start`, `portal_next`, and `portal_submit` to implement actual files. It receives design values, assets, service evidence, code conventions, and failed validation logs. Starting a run alone does not generate an application. See the [native portal workflow](docs/portal-native.md).

## Native validation: no Docker

Docker is neither required nor used. Validation uses owner-reviewed native commands in a separate, hash-bound working copy. Executable and script/configuration hashes, environment filtering, fresh package-manager homes, deadlines, owned process cancellation, and source compare-and-swap checks are enforced.

These controls run under the local owner account. They are not an OS filesystem or network sandbox. Do not provide production credentials. Dependency lifecycle scripts are disabled by default for declared package-manager installation commands; explicit exceptions belong to the reviewed profile.

Preview validation uses headless **Firefox**, with PNG comparison, configured interactions, and a basic DOM/keyboard audit. Add the project's full accessibility and integration suites to its profile. The existing Figma Chrome session remains the design source.

```powershell
corepack pnpm --filter @sfp/cli exec playwright install firefox
node packages/cli/dist/index.mjs portal profile --args-file native-profile.json
node packages/cli/dist/index.mjs portal profile --args-file native-profile.json --yes
node packages/cli/dist/index.mjs portal validate <run-id> --args '{"profileId":"node-portal"}' --yes
node packages/cli/dist/index.mjs portal apply <run-id> --yes
node packages/cli/dist/index.mjs portal validate <run-id> --args '{"profileId":"node-portal","target":"applied"}' --yes
```

Build success alone is insufficient. Required workflows and layers must pass. Operational cases additionally require an unmocked frontend-to-service journey; persistence, auth, migrations and integrations remain required when relevant. A missing or skipped required check keeps the run incomplete.

## Desktop and inspection tools

`inspect-chrome.cmd` reads an existing Chrome tab and saves an inspection. `connect-desktop.ps1` prepares the local plugin, waits for pairing, and reads the selected file. Desktop requires one-time import and execution of the generated development-plugin manifest. Opening the Figma application alone does not register that plugin.

Desktop observations and Chrome `design.json` files can be supplied as pinned artifacts. A pinned artifact is not automatically live evidence. Raw Desktop trees are preserved; deduplicated or partial trees remain incomplete.

The retained [code generation guide](skills/figma-codegen/SKILL.md) and its references cover component, token, icon, responsive, typography and motion decisions. Use Super Figma Pipeline tools for paired-plugin operations; the official Figma MCP is not a dependency.

## Development and verification

Node.js 24 and `pnpm@11.24.0` are the supported development toolchain. Run validation in a separate working copy under the same local account; this is not an OS sandbox. Windows is the current native acceptance target; final acceptance on other host platforms is not claimed.

```powershell
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm verify:source
```

Source verification, package verification, live Figma capture, and real target-service acceptance are separate evidence categories. The [active implementation plan](../docs/plans/2026-09-07-portal-four-cases-plan.md) defines the scope. Older Korean review documents remain historical evidence and are not the current completion checklist.

## Provenance

The pipeline adapts Figwright, figma-mcp-rust, and figmosha2. Original `code-kb/` checkouts are reference material, not runtime dependencies. See [PROVENANCE](PROVENANCE.md), [LICENSE](LICENSE), and [retained upstream licenses](licenses/).
