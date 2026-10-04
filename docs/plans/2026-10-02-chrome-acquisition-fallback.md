# Independent Chrome and Desktop acquisition

Date: October 2, 2026. Status: implementation in progress; no complete fallback acceptance claimed.

## Owner requirements

Use only the service's CLI, MCP tools, collectors and validators for acceptance. Keep Google Chrome as the sole browser. The latest owner direction separates these paths:

- Figma Desktop: a locally bundled development plugin, including the UI and resources needed for its supported behavior.
- Figma Web in Chrome: independent Playwright/CDP collection and native web export parsing without Scripter as a prerequisite.
- Figma Web with Scripter: a separate service-owned collector used for live same-file/node comparisons. Repair missing facts and normalization differences, then repeat; never seed the plugin-free collector with the comparison output.
- Official Figma MCP: retain the independent official-server path and comparison/acceptance obligations.

Finish CDD first, then run the additional eCommerce final new-frontend test with the previously required case/review gates intact. Network reachability is an executed observation, not a hypothetical reason to stop implementation.

### Earlier recovery-chain request

Before separating Desktop and Chrome, the owner requested this sequence. Preserve it as request history; local development-plugin installation is now assigned to Desktop rather than represented as direct local-plugin activation in Figma Web:

1. Use an available Scripter plugin.
2. Attempt to install or enable the verified published Scripter plugin through Figma Web.
3. If that fails, attempt local installation of the packaged Scripter runtime on the PC.
4. If no plugin runtime can execute, parse the authorized Figma Web surface through the service's Playwright collector.

Do not skip directly to an external Codex connector, impersonate an official MCP capture, or treat fallback initiation as completion. Official Figma MCP remains an independent official-server integration.

## Constraints and evidence

The live service attached to the existing Chrome on October 2 at approximately 17:42 KST and observed the CDD editor ready. Precision capture then failed `SCRIPTER_INSTALL_REQUIRED`. Service-generated failure diagnostics show an exact `Scripter` button in the Figma plugin panel while the old resource-image selector found no item. This establishes selector drift, not absence of the plugin.

Scripter upstream is pinned for inspection to `rsms/scripter` commit `2e0444a5976c28fee0f112356f144cfe4113bcb6`. Its MIT license requires retaining the copyright and permission notice. Its current UI loads an iframe from `scripter.rsms.me`; copying that loader alone does not provide an offline runtime.

Figma's [plugin quickstart](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/) requires the Desktop application for local development-plugin loading. The service remains Chrome-only. A successful local file installation must therefore report separately whether Figma Web can execute that runtime; it must never report a local manifest as an activated browser plugin. Figma also provides [organization-private plugin distribution](https://help.figma.com/hc/en-us/articles/4404228629655-Create-internal-plugins-for-an-organization) on Organization/Enterprise plans. Publication and organizational policy remain explicit prerequisites, not bypass targets.

## Implementation and acceptance obligations

- Record each attempted stage, its bounded deadline, actual outcome and next stage. Reuse an active verified frame and do not repeat installations for each node or image read.
- Preserve cancellation, target changes, coherence failures and resource limits as terminal errors; recovery must not hide them as plugin absence.
- Verify published identity before plugin execution. Verify bundled file hashes, preserve existing files, retain licenses and prohibit runtime downloads needed by an advertised offline bundle.
- Share one acquisition strategy between CLI inspection, portal planning, assets and live revalidation. Keep source-specific provenance and completeness honest.
- Web parsing must identify every collected fact and unavailable field, retain requested scope and expose missing assets/text ranges/tokens. An editor screenshot or partial layer list cannot become a complete design oracle.
- Test all ordered branches, organization/network denial, corrupt local payloads, unsupported local activation, missing DOM values, cancellation, wrong-target rejection and failure-to-success recovery through service-owned entry points. Then resume actual CDD frontend generation and the remaining case/release/final-eCommerce gates.
