# Independent DELETE nonce transport review

Date: October 12, 2026, Asia/Seoul. This bounded review follows the [repository instructions](../../../AGENTS.md), [shared service analysis](../../service-analysis.md), [service-function integration review](service-functions-review.md), and [retained-tab execution record](retained-tab-live-qa.md). The implementation and its original red cases are recorded separately in [the author's repair report](delete-nonce-transport-repair.md).

## Disposition and source baseline

No actionable defect was found in the reviewed two-file transport patch. The reviewer independently executed **43 tests, all passing, with zero failures or skips**, and verified the frozen hashes before and after execution. This supports integration of these exact files. It does not settle the original unknown reset job or establish a live policy revocation.

Review took place in the managed `4d3e/service` working copy. Its Git HEAD was `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing authorized uncommitted changes. The runtime baseline reported by the coordinator was source `sha256:91a4ca6521b567081020eb3cb05b4eaecec4aa4999fbc94d1bda83eda8eb4d15`. The reviewer compared the production delta directly with the native baseline file, SHA-256 `c727417ce960c32c426749efc511df70b36411e71240309b94d108dfd3ba00d6`. No production or persisted test file was edited by this reviewer.

| Reviewed file | SHA-256 |
| --- | --- |
| `packages/cli/src/control-client.ts` | `3577ac95a9c0f79f2c20d9c0d690da3b75f59be7c245c874d20d915f797ddd76` |
| `packages/cli/test/control-client-http.test.ts` | `843d160d62044c3e04efc04cb8742857051a89c2c1637743b590e88acaee405e` |

The unchanged server sources inspected for compatibility were `packages/mcp/src/control/router.ts` (`40a9c7e2f9b3386512fdbb5280af767179eb5f884a9aa3c7a3b9e4ecd3e06aa4`) and `packages/mcp/src/control/route-registry.ts` (`724cf1fb3fe36076abf8346ffe157a720978e1a8137b27f642cc807483fde26e`).

## Implemented behavior and review

The CLI client already sent network-domain deletion nonces through `x-sfp-action-nonce` with an empty HTTP body. The patch adds that same transport form only for DELETE `/control/egress`, DELETE `/control/workspaces/default`, and DELETE `/control/workspaces/<lowercase UUID-v4>`. The UUID expression exactly matches the server's `WorkspaceIdSchema`. Queries, additional path segments, other UUID versions and uppercase identifiers do not enter this new branch.

For ordinary JSON input, the nonce-only branch accepts exactly one own input field, `actionNonce`, with the existing `sfp_an1_` plus 43-character base64url format. An explicit own-property check rejects inherited nonce values. The earlier network-specific error code is preserved. Valid requests keep the existing authorization and leader-generation headers; only the nonce transport location and empty body change. POST bodies, unrecognized DELETE bodies, credential continuity checks, response limits, deadlines and error handling retain their prior behavior.

The server already merges a DELETE nonce header into strict route input. Workspace identity comes from the matched path; default clearing has its own exact route. Nonce issuance and authenticated consumption remain in the existing command/endpoint flow. No new route, authority, nonce generator or policy operation was added.

The retry condition is unchanged: only a bodyless GET may retry one transport `ECONNRESET` within the original budget. DELETE and POST requests do not retry. The patch neither examines nor changes retained job state and contains no recovery logic that could clear an unknown outcome.

## Independent executed evidence

At approximately **00:44:53 KST**, the reviewer ran the final ControlClient HTTP suite together with a private raw-TCP fixture:

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/delete-transport-review-vitest.mjs --configLoader native --no-cache --reporter=json --outputFile <absolute-managed-service>/.cache/delete-transport-independent.json
```

The result was **23/23 existing and author-added HTTP cases plus 20/20 independent cases**. The private cases inspected actual bytes emitted by Node's HTTP client to an owned random loopback port:

- All three exact routes sent the original credential/generation headers, the exact nonce header and zero body bytes.
- Eleven near-miss paths, including query strings, trailing segments, invalid UUIDs and uppercase UUIDs, gained no nonce header and retained their original JSON body bytes.
- Inherited nonce values, CRLF injection, extra fields, arrays and missing nonce input were rejected before establishing a connection for each new route.
- A socket reset on each new DELETE route produced exactly one connection attempt.

The complete HTTP suite also checked nonce-bearing POST JSON preservation, typed errors, cancellation budgets, bounded GET retry, response truncation and monitoring behavior. Private test/config paths are `.cache/delete-transport-review.test.ts` and `.cache/delete-transport-review-vitest.mjs`; the retained result is `.cache/delete-transport-independent.json`. The alias in the private configuration keeps `@sfp/shared` on the managed source identity. Neither production dependencies nor the working index were changed.

The author separately reported three genuine real-HTTP red cases before the fix and a final 30/30 HTTP/service-function run with TypeScript, lint and formatting passes. Those remain author evidence; this review's executed count is the independent 43 above.

## Operational limits and continuation

The fixtures use controlled authentication providers and owned loopback sockets. They prove client framing, branch boundaries and retry behavior, not a live daemon's owner authorization, policy revocation or workspace removal. No browser, daemon, running portal, actual workspace, grant, stored nonce or persisted job was controlled or modified by this reviewer.

The coordinator's actual `egress.reset` job `acb94a6b-bca0-4759-8234-a0c48cffe46f` remains unknown. Its stopped QA daemon and persisted grant are recorded in the retained-tab execution record. The transport repair is not proof that the original reset failed before effect, and a subsequent policy snapshot must not be used as terminal proof. Integration, fresh-state live functional checks and any explicitly authorized revocation recovery remain with the coordinator. No open product decision is required for this transport-only change.
