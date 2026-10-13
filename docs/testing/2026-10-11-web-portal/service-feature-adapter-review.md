# Public feature adapter and administrative dependency review

Date: October 11, 2026, 21:40 KST. This read-only review covers the coordinator's managed4d3e CLI feature adapter and its existing command/admin helpers. The coordinator retains source ownership. Read the [service-function frontend implementation](usage-guide-implementation.md), [canonical service analysis](../../service-analysis.md), [feature inventory](../../analysis/portal-feature-inventory.json) and [AGENTS.md](../../../AGENTS.md) before reuse.

The source epoch begins with portal baseline `935216d1...` and includes uncommitted, still evolving feature/job changes. This review did not run handlers, start a daemon, control Chrome, execute tests or establish live availability of all 58 feature branches. The adapter's separate author tests are not relabeled as independent execution here.

## Inspected behavior

The fixed definitions cover the 58 enumerated public branches, including the two native-environment inspection/reconciliation additions. Common paths call the existing `runCommand` with an injected client facade; request and invoke operations preserve the supplied identity and abort signal. Tool/service dispatch uses the existing closed registry, actual input schema and input-dependent target requirement. It reserves the invocation through the supplied callback before dispatch and sets automatic service approval false. Portal validation aliases constrain their candidate/applied target. Official MCP configuration/probe/read use fixed official routes and do not accept browser token values. Operations cancellation and explicit unknown-outcome resolution have separate fixed handlers and typed confirmation material. The catalog publishes prerequisites, rather than an invented readiness flag.

The adapter continues to depend on the existing helper semantics; listing all handlers is not proof that every runtime prerequisite has been met. The coordinator identified the existing network-remove header/nonce compatibility issue and owns its repair; this review does not attribute that older issue to the new frontend.

## Follow-ups sent to owners

1. `serviceFeatures()` strips the internal tool alias field without publishing `aliasOf`. The source aliases exist, but the frontend cannot identify their exact equivalent MCP path from the returned descriptor. Publish an explicit `aliasOf:{type:'tool',name}` derived from the same definition for tool-backed aliases. The frontend already keeps transport identities separate and does not claim that 128 plus 58 is a unique-function total.
2. `desktop.prepare` and `desktop.connect` delegate to `ensureLocalServer(client)`. If the supplied, possibly nondefault service is missing or its build identity differs, that helper spawns the default MCP entry using process environment, not explicit bound-client port/state arguments, and waits up to sixty seconds without the supplied abort signal. This is a source-supported integration risk; no foreign process was actually started or reproduction executed during this review. For portal-bound execution, prefer a no-auto-start mode that fails with a typed prerequisite and preserves the selected service identity, or explicitly bind and authorize child startup. Add a missing/mismatched custom-client fixture proving no unrelated daemon starts and cancellation remains bounded.
3. The new backend job runtime initially accepted workspace availability values other than the literal `unavailable`, which admitted missing/identity-mismatch/access-denied registrations. This was sent directly to the backend owner. The owner reports the check now accepts only absent availability or exact `available`, with three negative prepare cases. This review did not independently rerun those tests.

No broad handler removal or availability waiver is proposed. The coordinator should retain each fixed handler and its actual prerequisite, complete the bounded follow-ups, then verify the runtime catalog against the authoritative inventory and execute the requested real UI/service rounds. Current-source whole verification and complete case acceptance remain separate gates.

## Read checkpoint identities

Managed source hashes captured after the inspected checkpoint (the coordinator may subsequently change these files):

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/service-functions.ts` | `9f559702872cf7a40f57c5783662a5e91f5cf2dc034837d6a3be0c064ce3df3d` |
| `packages/cli/src/admin-commands.ts` | `5e0e4053f1bb26a21b1c6f270f898b959258d13ec1736c26324d5539dce810ef` |
| `packages/cli/src/commands.ts` | `74cdeb89eb100eaec58caa8bbd80acbe437bf46e3eb3a16909b78861340eff1a` |
| `packages/cli/src/server-session.ts` | `7dad75c4a581cbf41178716f0ee9356ecc5f0f09d0b0cdf5983a70d80142a5ab` |

The daemon child uses `FIGWRIGHT_PORT` (or its default), while the portal selects a `ControlClient` port using `SFP_CONTROL_PORT`; these are distinct inputs. Matching environment values may make a particular startup work, but the current helper does not establish that equivalence from the bound client. This clarifies the conditional dependency-injection finding without claiming a runtime reproduction.
