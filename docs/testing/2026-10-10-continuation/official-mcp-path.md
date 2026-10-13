# Official MCP source-to-generation path

Analysis and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the continuation record](README.md) and [the canonical service analysis](../../service-analysis.md). Read those records and [the project instructions](../../../AGENTS.md) before continuing. The parent integration task owns the canonical analysis, source reconciliation, generated contracts, whole checks and any daemon restart.

## Baseline and scope

The published main baseline remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`. The inherited dirty service snapshot was `sha256:f975a5773d14a744fe4b2429255b58dad3d5c22c9fbe8145e5d654f250d85d9d`. That snapshot's historical 4,825-pass whole result does not cover this patch. All code and test edits in this task are in `.worktrees/baseline/service`; its Git HEAD is `6459363354f52940b4c67e399b9e735d7332d4dc`, with inherited dirty changes and concurrent authorized work. No commit, index change, Docker use, daemon restart, Chrome control or Codex Figma connector call occurred. Native testing uses the current Windows owner's permissions, not an OS sandbox.

The service converts an admitted Figma source into retained design evidence, a portal plan, generation inputs, a proposed candidate, and separately validated/applied output. This task adds an official-server acquisition path to the existing pipeline. It does not waive coverage, asset, source freshness or final frontend acceptance gates.

## Findings and implemented behavior

The earlier official MCP client could invoke five read tools, but each result explicitly had `fullCapture:false`. Remote identity was request-only; local identity was an unverified active file. Portal source admission and runtime dispatch supported only Chrome and the bundled Desktop plugin. Merely allowing another source string would not supply generation evidence.

Figma's [official tool documentation](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) describes `get_metadata` as a sparse XML outline and `get_design_context` as code-oriented output. It also documents `use_figma` as a Plugin API inspection capability. The documented tool's availability at the authenticated official endpoint must be discovered at runtime. Documentation or a tool exposed by another connector does not prove that an actual service connection supports it.

The implemented path is:

1. A portal request selects `design.source: "official-mcp"` and optionally one of the two exact allowed official endpoints. Admission requires an explicit numeric node scope, rejects a contradictory Desktop target, and retains endpoint, requested file hash and node scope in the signed grant. It does not claim that the file has already been observed.
2. The service opens the existing SDK/Streamable HTTP connection to that endpoint and discovers its actual `tools/list`. A compatible `use_figma` with string `fileKey` and `code` inputs is required. Unknown required inputs fail closed. The public five-tool read API still cannot invoke arbitrary `use_figma` code. The probe now reports discovered capture capability separately from `fullCapture:false` and `liveVerified:false`.
3. Only fixed service-generated programs can run. Inputs are strict identity, bounded read or export queries. Arbitrary JavaScript is not an accepted input. Programs check the actual runtime `figma.fileKey`, editor type and scoped node, select the containing page once, constrain node reads/exports to that subtree, and check file/page identity again before returning. Selecting a page changes server execution context, not document content. The program contains no document creation, edit, deletion, plugin-data write or network fetch.
4. Each returned envelope binds a new request nonce, runtime file key, page and scope. A mismatched or unsupported result fails. Generated code, XML and prose from the ordinary read tools are never promoted into native collector evidence. One client session is retained for the complete capture attempt; its identity and a distinct attempt generation are recorded.
5. The official session independently executes the existing closed property reader and closed asset exporter. It reuses the service's bounded continuation algorithm, full ordered query reobservation, ten capability-family checks, image chunks, root PNG/SVG exports, retained file hashing and capture fingerprints. It never consumes Chrome collector output. Provenance records the official endpoint. Official progress checkpoints use a distinct namespace so they do not replace Chrome progress checkpoints for the same URL.
6. A complete official capture reaches the existing `portal_plan`, `portal_next` and `portal_submit` path. Missing capabilities, truncated values, incomplete assets or mismatched source identity keep the capture incomplete or fail it. Native validation requires the admitted official endpoint and its operation-scoped capture port; it cannot fall back to Chrome. Fresh validation reacquires the official source through the same transport and applies the existing exact fingerprint or bounded PNG reexport policy.

The existing limits remain: 2 capture attempts, a 300-second capture budget, 256 query calls and 12 MB per snapshot pass, depth 40, 2,000 nodes per bounded read, 100,000 retained asset records, 512 export batches and 512 MiB aggregate assets. Original image chunks are 1 MiB with a 16 MiB original-image bound; direct PNG/SVG exports remain bounded at 5 MB. MCP requests retain the 15-second timeout, exact endpoint allowlist and redirect rejection. Caller cancellation is propagated. Repeated ordered observations cannot detect an ABA change between observations or changes after the final observation; the existing non-atomic limitation remains explicit in provenance.

### Independent review repairs at 14:48 KST

The initial review reproduced an actual deadline defect: a 50 ms asset stage could read two 1 MiB image chunks after the first read took 100 ms, then return a captured 2 MiB image. It also found that official admission accepted an instance-path node ID which the program schema subsequently rejected. The report is [official-mcp-review.md](official-mcp-review.md).

Three new regression assertions failed against the initial implementation: late deadline, scoped cancellation and instance-path admission. The first two incorrectly published the 2 MiB image; the third returned a grant. All three passed after repair. Further pending-HTTP coverage exposed that the SDK's legacy wire mode does not propagate an individual RPC signal into `fetch`; its logical timeout could reject while the HTTP request remained pending. That test failed before a second repair.

The fixed implementation preserves a single absolute coherence deadline starting before connection. Every handshake, discovery page, identity query, design query and export chunk intersects that deadline with the stage signal and the 15-second per-request cap. A request context retained with `AsyncLocalStorage` also binds the actual HTTP request in legacy SDK mode. A timeout race explicitly aborts the pending request before rejection. Responses, decoded bytes, asset manifests, stage transitions and capture publication/return boundaries are rechecked. An expired or cancelled chunk cannot start the next chunk or return a captured image. Already-started OS file writes are not an OS-level cancellable transaction; late results cannot become an accepted capture, and historical attempt files remain inspection evidence only. Official numeric node IDs now share one schema across admission, grants and program generation; unsupported instance-path targets fail with `FIGMA_MCP_TARGET_REQUIRED` before capture effects.

At **14:48:28 KST**, the final expanded run passed **185/185 tests in 16 files**, with no failures or skips. MCP typechecking, scoped lint and formatting passed. The command in the verification section was rerun with these four additional files: `packages/mcp/test/portal/capture-coherence.test.ts`, `packages/mcp/test/portal/capture-session.test.ts`, `packages/mcp/test/portal/capture-continuation.test.ts` and `packages/mcp/test/portal/capture-failure.test.ts`. The earlier 151-pass result is retained as historical pre-review evidence.

The reviewer independently repeated the real-delay reproduction after the repair: the 50 ms deadline rejected at 56 ms with `FIGMA_MCP_DEADLINE_EXCEEDED`, exactly one image chunk request, and no second chunk or captured image publication. The instance-path request now rejects during admission. This is a controlled transport verification, not live Figma acceptance.

The independent five-file verification completed at **14:49:24 KST** with **73/73 tests passing**. The reviewer rechecked all 23 manifest hashes, found no further actionable scoped issue, and marked the two reproduced review findings addressed within that scope. See its separate report for verification limits.

The frozen [23-path hash manifest](official-mcp-path-hashes.json) records each owned source/test file. Its aggregate slice hash is `sha256:6c2271d003498a38c1b31516e1a9df2f66d2064d86a233a579bf424004c31e9d`. This is the official-source slice only, not a whole-service fingerprint. No owned production code changed after that manifest was written.

## Configuration and continuation

A new request can use:

```json
{
  "case": "new",
  "targetPath": "new-frontends/ecommerce-official-mcp",
  "design": {
    "source": "official-mcp",
    "officialEndpoint": "https://mcp.figma.com/mcp",
    "url": "https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1",
    "freshness": "require-live"
  }
}
```

Use an actually unused target under the registered workspace. Do not reuse this example path without checking it. Keep the requested execution order: finish the current CDD acceptance first, then run separate new eCommerce outputs with no reference frontend code.

For a daemon using remote OAuth, `SFP_FIGMA_MCP_OAUTH_TOKEN_ENV` names an already externally authorized credential environment variable. The callback resolves the credential only for a remote call and retains it in memory. The local endpoint never receives that OAuth credential. The CLI's existing `figma-mcp probe --oauth-token-env <variable-name>` remains available. Neither configuration path registers a new OAuth client, writes credentials, or performs browser approval. Applying new environment configuration to a running daemon requires the parent task's controlled restart; this task did not restart it.

An endpoint exposing only the ordinary five read tools will return `FIGMA_MCP_CAPTURE_UNSUPPORTED` for portal acquisition. Supplemental reads remain usable as supplemental evidence. Do not invent a complete structured result from sparse metadata, accept an invented envelope from another collector, or introduce a private/unofficial endpoint to evade this failure. If the official endpoint's schema or return wrapper differs, record the actual sanitized response, extend the bounded adapter with tests, and rerun the service workflow.

## Verification and limits

Focused verification is recorded below; no whole-suite or release result is claimed for this patch.

- The first low-level run passed 31 tests and failed one fixture assertion because a `tree` query returns the requested page root, while the assertion expected a `roots` query. The test was corrected to request `roots`; the production collector behavior was unchanged.
- The first broader run passed 75 tests and failed one assertion that expected an error code in a human-readable error message. It now checks the typed `TARGET_FORBIDDEN` field. The fixture fetch result also needed an explicit portable `Promise<Response>` type.
- The subsequent six-file run passed **78/78** tests. MCP TypeScript checking passed. Scoped lint passed after adding required test error messages.
- An expanded run passed 150 cases and failed one assertion because the project's Zod error map uses a different discriminator message. The assertion now checks `ZodError` itself; rejection semantics were unchanged. A conditional test assertion also needed a lint-only rewrite.
- The final expanded run started at **14:32:13 KST** and passed **151/151 tests in 12 files**, with no failures or skips. Final MCP TypeScript checking, scoped lint and formatting checks also passed. No official-source production code changed during that final run. The parent must still freeze and verify the merged source with concurrent work before claiming whole-source success.

Commands used from `.worktrees/baseline/service`, with `.worktrees/_cache/bin` prepended to `PATH`:

```text
pnpm --filter @sfp/mcp typecheck
pnpm exec vitest run packages/mcp/test/official-figma-mcp.test.ts packages/mcp/test/official-figma-mcp-capture.test.ts packages/mcp/test/portal/official-mcp-capture.test.ts packages/mcp/test/portal/capture-plane.test.ts packages/mcp/test/portal/capture-admission.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/portal/capture-native.test.ts packages/mcp/test/portal/capture-flow.test.ts packages/mcp/test/portal/capture-descriptor.test.ts packages/mcp/test/portal/desktop-capture.test.ts packages/mcp/test/portal/design-normalization.test.ts packages/shared/test/portal.test.ts
pnpm exec oxlint --deny-warnings <the 23 owned TypeScript paths listed below>
```

The controlled protocol fixture runs the exact generated read/export program against a minimal Figma API through the actual MCP SDK handshake and tools/list/tools/call exchange. It verifies complete evidence and asset bytes, admission through the real execution plane, source/nonce/page/schema mismatch rejection, no arbitrary caller code, no Chrome fallback, truncation/missing capabilities/missing assets, retained asset tampering and fresh source changes. The generation test executes plan/start/next/submit and stores a hash-bound asset candidate. It does not invoke an external model, create a full frontend, execute a frontend preview, apply an output, or establish live Figma acceptance.

Fresh no-credential probes used the service's source-loaded official SDK client on October 11:

| Endpoint | Observed result |
| --- | --- |
| `http://127.0.0.1:3845/mcp` | Connection failed; no tool inventory obtained. |
| `https://mcp.figma.com/mcp` | `FIGMA_MCP_AUTH_REQUIRED`; no authenticated tool inventory obtained. |

The first probe command failed locally because PowerShell removed inline native-command quotes. The corrected stdin script executed successfully and produced the two results above. No authenticated official read, live program execution, export, parity comparison or official frontend generation occurred.

## Remaining gates and open questions

1. Parent integration must preserve inherited edits, regenerate the changed tool contracts, reconcile source provenance, freeze the merged source, and run current-source whole/package checks before restarting the service.
2. Obtain authorized access to the official endpoint through the service. Verify whether it actually advertises compatible `use_figma`, supplies runtime `figma.fileKey`, supports the closed readers/export APIs, and returns the supported exact envelope. These are unresolved live prerequisites, not established endpoint capabilities.
3. Capture and compare matching facts on the same file/node scope through independent official and Chrome paths. Preserve unsupported fields and differences. Repair real discrepancies without copying one collector's values into another.
4. Execute actual generation, candidate validation, guarded application, applied runtime checks and fresh source validation for the required separate official output. A fixture candidate submission does not satisfy these gates.
5. If the authenticated official server lacks the documented capability, determine whether the owner can enable a supported official deployment or whether a separate explicitly scoped generation contract is needed for sparse context outputs. Do not relax the existing full portal contract implicitly.

Changed code is concentrated in `packages/mcp/src/official-figma-mcp.ts`, the new `official-figma-mcp-program.ts` and `portal/official-mcp-capture.ts`, portal admission/runtime/coordinator/capture/native validation, shared capture/request/observation schemas, operation policy and daemon configuration. The exact owned path list is included in the agent handoff to the parent. Existing canonical instructions and analysis remain under parent ownership.

## Owned source paths

The first 23 paths below are the scoped lint/format set. This task changed only the relevant official-source portions of existing files and preserved their inherited edits.

```text
packages/mcp/src/official-figma-mcp.ts
packages/mcp/src/official-figma-mcp-program.ts
packages/mcp/src/portal/official-mcp-capture.ts
packages/mcp/src/portal/capture-source-admission.ts
packages/mcp/src/portal/capture-admission-runtime.ts
packages/mcp/src/portal/capture-runtime.ts
packages/mcp/src/portal/coordinator.ts
packages/mcp/src/portal/design-capture.ts
packages/mcp/src/portal/design-normalization.ts
packages/mcp/src/portal/native-work.ts
packages/mcp/src/index.ts
packages/mcp/src/policy/operation-policy.ts
packages/shared/src/portal-capture-source.ts
packages/shared/src/portal.ts
packages/shared/src/operations.ts
packages/shared/src/figma-capture-query.ts
packages/shared/src/figma-capture-read.ts
packages/shared/src/design-observation.ts
packages/mcp/test/official-mcp-fixture.ts
packages/mcp/test/official-figma-mcp-capture.test.ts
packages/mcp/test/portal/official-mcp-capture.test.ts
packages/mcp/test/portal/capture-plane.test.ts
packages/mcp/test/policy/operation-policy.test.ts
```

The documentation and supporting evidence owned by this task are this file and `official-mcp-path-hashes.json` in the main project's `docs/testing/2026-10-10-continuation/` directory. The independent reviewer owns its separate review report. No CLI source was changed by this task.
