# Nonce-only DELETE transport repair

Date: October 12, 2026, Asia/Seoul.

## Baseline and actual failure

The parent reported another actual all-functions QA failure on frozen source `91a4...`, using its separately owned daemon/portal at ports 3057/4313 and the same visible Chrome tab. Direct and aliased local doctor reads succeeded after an explicitly confirmed egress allowance. The subsequent `egress.reset` job `acb94a6b-bca0-4759-8234-a0c48cffe46f` became unknown with `CONTROL_REQUEST_FAILED`; a later cleanup job was fenced by `SERVICE_JOB_OUTCOME_UNKNOWN`.

Evidence is `.worktrees/_cache/portal-functions-repaired-20261012/evidence/all-functions/2026-10-11T15-35-43-925Z-70054ee0-5869-4181-8b11-ebe5d700fdd4/result.json`. The explicitly provided `daemon.err.log` records a `DELETE /control/egress` HTTP 500 with `ECONNRESET`; `portal.err.log` is empty. Only bounded diagnostic fields were inspected/reported. No authentication values are included here. This worker did not query or mutate runtime policy, change the job, replay the reset or infer resolution from current policy.

The native client and existing HTTP test were synchronized into managed `4d3e/service` before editing. Initial SHA-256 values were `c727417ce960c32c426749efc511df70b36411e71240309b94d108dfd3ba00d6` for `control-client.ts` and `839ca69369c2d9f4efda293a403d4881958af2144e9f2fcb8b26d98a56e11c53` for its HTTP test. Published HEAD remains `22517932...` with authorized uncommitted work; the parent owns integration and renewed source gates.

Read [the earlier adapter review](service-feature-backend-review.md), [canonical analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md) before reusing this record.

## Confirmed cause and bounded change

The earlier client fix converted only network-domain removal into a header nonce with an empty DELETE body. The existing egress-reset, workspace-remove and default-workspace-clear CLI handlers also pass nonce-only objects, but those calls still went through the ordinary JSON-body branch. Actual owned Node HTTP fixtures rejected each of those three requests with HTTP 400 before the correction.

The current authenticated router already accepts `x-sfp-action-nonce` on these DELETE paths; no router or administrative handler change is needed. The client now applies the same strict nonce-only encoding to this closed set:

- Existing `/control/network/domains/:fqdn` deletion.
- Exact `/control/egress`.
- Exact `/control/workspaces/default`.
- `/control/workspaces/:workspaceId` with the same canonical lowercase UUID-v4 shape used by the router's workspace schema.

The body must contain exactly its own `actionNonce` field with the existing nonce format. Missing, malformed, extra-field and inherited-property inputs reject before dispatch. Known requests carry that nonce in the header and send zero body bytes. The previous network-specific validation error is preserved; the added cases use `CONTROL_DELETE_NONCE_INVALID`. POST bodies and other request paths are unchanged.

The existing retry condition remains GET-only. A reset during DELETE therefore does not replay the mutation or reuse its nonce. No operation ID, approval, action hash, service nonce consumer or unknown-outcome rule was changed.

## Executed regression evidence

At **00:39:01**, three new real-HTTP cases genuinely failed: egress reset, workspace removal and default clearing each received `CONTROL_REQUEST_FAILED (400)`. The fixtures use the actual `ControlClient.request` networking with synthetic fixture authentication and an owned loopback server; they are not a live daemon acceptance test.

At **00:39:17**, all three cases passed with the exact header and zero received body bytes. Additional regressions reject malformed/extra/inherited nonce payloads without a server call, preserve POST JSON bodies without a DELETE nonce header, and verify that a transport reset results in exactly one DELETE request. The pre-existing network removal regression remains intact.

The final client-HTTP and fixed-feature suites ran at **00:42:56–00:43:08** and passed **30/30, zero failures or skips**. Receipt: managed `.cache/delete-nonce-final.json`. CLI TypeScript, scoped lint and formatting passed on the frozen source. The direct command, from the managed CLI package, was:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache test/control-client-http.test.ts test/service-functions.test.ts
```

## Frozen files and continuation

| Owned path | SHA-256 |
| --- | --- |
| `packages/cli/src/control-client.ts` | `3577ac95a9c0f79f2c20d9c0d690da3b75f59be7c245c874d20d915f797ddd76` |
| `packages/cli/test/control-client-http.test.ts` | `843d160d62044c3e04efc04cb8742857051a89c2c1637743b590e88acaee405e` |

Only those two managed files were authored. Independent review was requested for exact-path matching, nonce validation, empty-body framing, unchanged POST behavior and no mutation retry. The parent must integrate/reconcile/build and perform its next explicitly authorized QA operation. The original unknown reset remains unknown; neither this source repair nor a future successful reset supplies missing disposition evidence for it.

The independent reviewer subsequently passed **43/43, zero failures/skips**: the 23-case actual HTTP suite and 20 additional raw-socket framing cases. Both frozen hashes matched before and after. Near-miss query/suffix paths and noncanonical workspace IDs received no new nonce-header treatment; exact paths retained authentication and sent zero body bytes. Invalid inherited, CR/LF-containing or extra-field nonce inputs stopped before connection, and each reset DELETE was attempted once. No actionable scoped defect remained. This closes the independent source/fixture review gate, while the parent's integration and actual QA rerun remain separate.
