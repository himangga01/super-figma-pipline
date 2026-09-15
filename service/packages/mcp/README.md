# @sfp/mcp

Super Figma Pipeline's local MCP server exposes **125 MCP tools**. It supports design reads without Figma Dev Mode or the official Figma MCP, through the paired Desktop plugin or an existing Chrome session using external Playwright/Scripter.

The nine `portal_*` tools provide planning, coding leases, candidate submission, native validation, guarded source application, status, cancellation and reconciliation. Only C4 is frontend-only; legacy/reference strategies retain all relevant service layers. The coding agent produces the actual implementation from the returned design and source evidence.

Docker is not used. Native profiles run in separate working copies under the local owner account, with executable/source checks, filtered environments, bounded execution and owned process cleanup. This is not an OS sandbox. Headless Firefox is used for application previews; the existing Chrome remains the Figma source.

Build from `service/` and configure the MCP client to run `node <absolute-service-path>/packages/mcp/dist/index.mjs`. The package is a private development distribution. The CLI, authentication, pairing and workspace configuration are described in the [service README](../../README.md) and [native portal guide](../../docs/portal-native.md).

The `@sfp/mcp/portal-validation` export supplies the native Firefox/PNG verification helper for reviewed application validation harnesses. Registration and successful local tests do not imply live Figma or real target-service acceptance.
