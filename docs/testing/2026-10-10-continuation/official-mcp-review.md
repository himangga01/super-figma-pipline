# Limited review: official MCP capture and generation routing

Analysis date: October 11, 2026 (Asia/Seoul).

This independent review covers the official MCP patch described in [official-mcp-path.md](official-mcp-path.md). It is not a final whole-service review, authenticated official-server acceptance, or frontend acceptance. The canonical authority remains [the service analysis](../../service-analysis.md), with [the continuation record](README.md) and [repository instructions](../../../AGENTS.md).

## Baseline and review scope

Main remains at published commit `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted implementation and documentation changes. Review reads the native copy `.worktrees/baseline/service`, detached at `6459363354f52940b4c67e399b9e735d7332d4dc`. The earlier whole-source pass at `f975a577...` does not cover this patch. The implementation agent owns the official-source files and tests; this reviewer changes only this report. The parent owns contracts, provenance reconciliation, integration and whole checks.

The service turns admitted design evidence into portal generation inputs and separately validated/applied outputs. This addition discovers the official server's actual capabilities, runs fixed property-read/export programs through compatible `use_figma`, retains one client session, binds identity and assets, and routes the resulting evidence into existing generation and freshness checks.

Initial reviewed bytes, hashed before the authorized review-finding repairs:

| Native service path | SHA-256 |
| --- | --- |
| `packages/mcp/src/official-figma-mcp.ts` | `1ccedf79dbfa9f760f8d08b2a05d2194f7e06bfa5bd76d94016fc8b0dfa3269d` |
| `packages/mcp/src/official-figma-mcp-program.ts` | `59ae47901093b22e51b5f081a600692831faca9a78310033b0358c00e7404628` |
| `packages/mcp/src/portal/official-mcp-capture.ts` | `0dcee6aea3047627b8280bc983e121d890ed0ea4bbda5c6b0d5b38c67406d9ad` |
| `packages/mcp/src/portal/capture-source-admission.ts` | `675b2e949d56b5cd5cc6dd60803136c9a31e783731e2d0826218cbf7901192a6` |
| `packages/mcp/src/portal/capture-admission-runtime.ts` | `978dc7b81dbbfa18d834df7d8447d6c0fde7c64d48d71adcba40b64db06d01c0` |
| `packages/mcp/src/portal/capture-runtime.ts` | `fecb1925ce4bfb303c0886b901ce8d099cc5f4003fbe6c72f6ab26601f00ec33` |
| `packages/mcp/src/portal/coordinator.ts` | `029807ae11b2ab40a584dd3fdfa8a3918b61e587ee94bc531ad9dc48b189dfa6` |
| `packages/mcp/src/portal/design-capture.ts` | `6207a922bb4902ef3ffdb402fd8b36a0bfb969096e5933825a5ddcad629ac477` |
| `packages/mcp/src/portal/design-normalization.ts` | `7dafe55fa67c9453fcd5668aa3d2ccfc65d1c661d1e5bbdb332e268e00fe6b89` |
| `packages/mcp/src/portal/native-work.ts` | `dea4947572ee25079ed2abbba2e7d3ea356072bc212aa430dc28b2a508700862` |
| `packages/mcp/src/index.ts` | `0d3d70edaafb00a8b1616f9668a357b9b5e5d4a7f6c3928c3ced49bd9848e207` |
| `packages/mcp/src/policy/operation-policy.ts` | `1d2f69faef6e09e677d52ad0d4aea991108ece8b36701fbd157c44b5a761d7fc` |
| `packages/shared/src/portal-capture-source.ts` | `7b6dd5e16687dd22c58926634359bdc8c0688832ce6112894904141c5aac59a4` |
| `packages/shared/src/portal.ts` | `7fd4ceaea5f8bafdeb1961147a660e837267f771f346a59ddda87413810d07db` |
| `packages/shared/src/operations.ts` | `7af602a3cd8ffd64649309b193cbe304c58e06be6912d2b7061919e344004f65` |
| `packages/shared/src/figma-capture-query.ts` | `03701c8426676e3aa022eb304c0d4fb6c730ac31250fce9b1215a169b487885c` |
| `packages/shared/src/figma-capture-read.ts` | `5c00133e6c958dc16eb35b3feb4714577239ccb70e0639627f31c480a95b9a2c` |
| `packages/shared/src/design-observation.ts` | `08f7c416745543457dc6f8ce50ec4acfa4427f189080c2b935ba4b460474a8fe` |
| `packages/mcp/test/official-mcp-fixture.ts` | `d63a50ed287d3d24bc425735744dfbc0924e37be7afdedbcd432f0c7014c81fa` |
| `packages/mcp/test/official-figma-mcp-capture.test.ts` | `83212b0ddb52001ae46bbbc9b6753acf64d34fae3a99d1e0d7c751e306c7112a` |
| `packages/mcp/test/portal/official-mcp-capture.test.ts` | `074db3cba80734cf7b7b0bf90f9547acc87273d98dc02760a5e2f460be3a93b2` |
| `packages/mcp/test/portal/capture-plane.test.ts` | `2feded936ce05beb40774e72a90f5fe5dd6a4d82f5f5444285f688a67f9427e8` |
| `packages/mcp/test/policy/operation-policy.test.ts` | `ae2c112c24430fcc982500eee0c3b6858f8c7d6d7427a5f055b9e224d7ccd063` |

## Findings

### OM-1: Original-image chunks continue after the absolute capture deadline

Priority: P1. Status: independently reproduced at the initial hashes; repair authorized to the implementation agent.

`createOfficialMcpDesignCapture` receives the absolute deadline through `session.assets(..., options)` but does not pass it to `session.execute` or check it in the image-chunk loop. The fixed 15-second MCP request timeout bounds each individual request, not the entire sequence. `captureDesignAssets` checks the deadline before starting the image, then waits for the callback to finish. Subsequent chunks can therefore execute after the capture budget expires, and the asset can still be marked captured.

The reproduction used the actual service transport and asset pipeline with its controlled MCP SDK fixture, not an authenticated endpoint. A two-MiB image's first `getBytesAsync` waited 100 ms; the asset call had a 50 ms absolute deadline. Observed output:

```json
{
  "deadlineMs": 50,
  "elapsedMs": 164,
  "imageChunkCalls": 2,
  "assets": [
    {"query": {"kind": "png", "nodeId": "1:1"}, "status": "captured", "bytes": 82},
    {"query": {"kind": "image", "imageHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "status": "captured", "bytes": 2097152}
  ]
}
```

The official fixture's image getter returned the same two-MiB array on each call. The existing source-loaded `createOfficialMcpDesignCapture` transport was opened using the fixture fetch function, and its `assets` method received one frame with that IMAGE fill. The reviewer created a uniquely named temporary directory, verified it remained inside the system temporary root, and removed it after closing the session. No real service state or user browser was involved.

Enforce the original absolute deadline before, during and after each official read/export request, including every image chunk. Stop later requests and do not publish bytes returned after expiry. Combine the operation signal with a remaining-time abort signal without extending/resetting the deadline. Account for in-flight remote work: cancellation of a logical waiter is not proof that a server-side program stopped.

### OM-2: Admission accepts a node scope that the fixed program rejects

Priority: P2. Status: independently reproduced at the initial hashes; repair requested.

`resolvePortalCaptureSource` checks that the official node ID is non-null, while `OfficialCaptureTargetSchema` requires a numeric `number:number` node ID. A valid general Figma instance-path URL is admitted even though the official capture contract cannot execute it.

For a URL ending in `?node-id=I1%3A2%3B3%3A4`, the actual admission function returned a grant with `requestedNodeId: "I1:2;3:4"`. Parsing the resulting target through `OfficialCaptureTargetSchema` returned false. This causes late generic schema failure instead of a typed unsupported-target result at admission.

Apply the same explicit official-target requirement during admission, and keep the grant schema consistent if the official grant is intended always to contain a numeric scope. Return `FIGMA_MCP_TARGET_REQUIRED` before capture effects. No arbitrary execution or write escalation was observed in this reproduction.

## Identity, code and routing review

The following are source observations, not proofs of authenticated endpoint behavior:

- Only the two exact official endpoints are allowed. The guarded fetch rejects another request destination, redirects, a redirected response or a mismatched response URL. OAuth is resolved through an explicitly named environment variable and is not sent to the local endpoint.
- The public ordinary-read API permits five named read tools and refuses arbitrary `use_figma`. The capture interface accepts a strict discriminated query schema. Only service reader/exporter function bodies and JSON-serialized validated data enter the generated program; there is no caller JavaScript field.
- The program checks runtime `figma.fileKey` and editor type, resolves the requested scope, and restricts node read/export requests by ancestor membership. It changes the active page through `setCurrentPageAsync`, but contains no document creation, property mutation, deletion, plugin-data write or arbitrary fetch. This page-context change should remain explicit when describing the program as read-only.
- Every returned envelope is checked for the newly generated nonce, requested file key and scope. The session retains one page ID and rejects a later page change. Read results also retain the inner query scope. Prose, sparse XML and generated design-context code are not admitted as native evidence.
- Image chunk identity, total size, offsets, canonical base64 and decoded length are checked. Original-image limits, direct-export limits, node/query continuation limits, capability checks, aggregate asset limits and retained-file hashes remain in the capture pipeline. These are logical/result bounds; the response-size check occurs after the SDK has received its result and is not an OS memory sandbox.
- An empty design cannot satisfy the complete-capture predicate, which requires nonempty nodes and assets in addition to complete capability evidence. Truncated values, unsupported capabilities, missing assets and changed ordered reobservations prevent complete capture.
- Official provenance includes the endpoint and fixed collector identity. Attempt/session evidence is retained separately from content equality. The source fingerprint and contract/provenance checks keep official and Chrome capture identities distinct. Checkpoints have an official-specific namespace and are not reused as new live captures.
- Runtime source selection uses the admitted official grant. Native freshness validation requires its matching endpoint and scoped capture port. It cannot obtain an official refresh by falling back to Chrome. The existing generation route receives the retained official evidence and assets; source freshness is checked separately during acceptance.
- Operation policy declares official Figma reads and network effects, without a Chrome attachment effect for the official source. Portal execution still passes through admission and the signed authority. The fixed program's internal queries do not create a public arbitrary-network or arbitrary-code API.

The underlying observation remains non-atomic. The explicit provenance limit preserves possible ABA changes between observations and changes after the final observation. A client-session identifier is an observation-session identity, not a document revision or authenticated human identity.

## Official compatibility and actual limits

The current [official Figma tool documentation](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) was read during review. It documents `use_figma` inspection capability and lists that tool as remote-only. Runtime discovery remains necessary: this documentation does not establish that the owner's authenticated service endpoint advertises the supported input schema or response envelope. Enabling the local Desktop MCP alone is not documented to provide the fixed-program capability used by this full-capture path.

The adapter checks for string `fileKey` and `code` properties and refuses unknown required arguments. The supported exact envelope remains a compatibility assumption until observed at the authorized endpoint. Unsupported capability/schema/wrapper results should remain explicit failures; they must not be replaced with invented native evidence from sparse metadata or another collector.

The implementation record reports **151/151 tests in 12 files**, MCP typecheck, scoped lint and formatting passing before this review. These are implementer-reported checks. They predate the deadline/admission repairs. Its no-credential endpoint probes remain connection failure locally and authentication required remotely. This reviewer did not repeat or change those endpoint probes.

## Verification and continuation

Read the shared policy, repository instructions, canonical report and implementation record before reviewing the 23 paths and relevant inherited capture/freshness helpers. Reproductions used the project's native source loader and actual service code:

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs --input-type=module
```

No user Chrome, authenticated endpoint, Codex browser/Figma connector, whole suite, daemon restart, dependency installation, commit or push was used. No production files were modified by this reviewer. Native execution uses the Windows owner's permissions in a separate working copy; it is not an OS sandbox.

Recheck the authorized repairs at frozen hashes, run focused protocol/capture/plane/policy regressions, and preserve failure evidence. Parent integration must still regenerate changed contracts, reconcile provenance, freeze the merged source and run current-source checks. Authenticated capability discovery, live official export and independent comparison, actual frontend generation, guarded application and final fresh-source acceptance remain outstanding.

## Verified repair follow-up at 14:49 KST

The implementation agent froze the repaired 23 paths in [official-mcp-path-hashes.json](official-mcp-path-hashes.json), identified by owned-slice fingerprint `sha256:6c2271d003498a38c1b31516e1a9df2f66d2064d86a233a579bf424004c31e9d`. I independently recomputed each of its 23 file hashes after the focused run; none differed. This is a scoped file manifest, not a whole-service source baseline.

The deadline repair combines the original absolute deadline and scoped cancellation at each SDK request. Request-local bounds also reach HTTP fetch through AsyncLocalStorage because the legacy SDK wire path does not forward per-RPC signals consistently. SDK timeout/error paths explicitly abort the HTTP controller before rejecting. Read results, export results, chunk completion, manifests and coherence/publication boundaries are checked after asynchronous work. The shared capture deadline is established before connection and is not reset between stages. The official admission and fixed program now share a numeric node-ID schema, also applied to official grants.

I reviewed those changes and repeated the original real-delay reproduction. The repaired call rejected at 56 ms with a 50 ms deadline, made exactly one image-chunk request, and did not publish a successful image result:

```json
{
  "accepted": false,
  "error": "FIGMA_MCP_DEADLINE_EXCEEDED: The original official capture deadline has expired.",
  "deadlineMs": 50,
  "elapsedMs": 56,
  "imageChunkCalls": 1
}
```

The instance-path admission reproduction now throws `FIGMA_MCP_TARGET_REQUIRED` immediately. These confirm the two reported defects are repaired for their reproduced cases. Cancellation still does not prove that already-issued remote execution stopped; it prevents subsequent requests and late success publication.

The independent final focused run began at **14:49:24 KST** and passed **73 tests in 5 files**, with no failures or skips:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/official-figma-mcp.test.ts packages/mcp/test/official-figma-mcp-capture.test.ts packages/mcp/test/portal/official-mcp-capture.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/policy/operation-policy.test.ts --maxWorkers=1
```

An earlier invocation of this same focused command was started, but its asynchronous terminal handle was not retained by the reviewer; no completed result is claimed for that invocation. The result above is the separately collected final run. The implementation agent separately owns broader/static verification and recorded failing regressions before repair.

**Disposition:** OM-1 and OM-2 are addressed at the manifest's frozen bytes. No additional actionable identity, arbitrary-code, document-write, endpoint or generation-routing defect was found in this scoped recheck. Authenticated official schema/envelope compatibility, live export, independent parity and actual frontend acceptance remain unverified. The parent still owns whole-source integration and final verification.

After the independent recheck, the implementation agent reported its final broader run passing **185/185 tests in 16 files**, with MCP typecheck and scoped lint/format also passing, at the unchanged 23-file manifest. These are separately reported implementation checks; this reviewer independently executed the 73-case run above.
