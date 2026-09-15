# Task 5.1 independent review

Date: 2026-09-15. Reviewer: `review_capture_observation`.

## Outcome

Specification: **changes required** for malformed variable resolution, node-capability completeness and exported observation-contract consistency. Quality: **changes required**. Four actionable P2 findings are below; the controller confirmed the intended node-capability scope for R4.

The bounded implementation is otherwise aligned with its stated scope. The actual upstream Desktop `GetVariableDefsResult` uses nested `variables` and `collections`; `GetStylesResult` uses `paints`, `texts`, `effects`, `grids`, and an optional variable-name table. The adapter matches those families, preserves their namespaces and raw data, and does not infer collection modes from display names or default/first values. Source-linked reaction ordering and distinct image usages are retained. Collector assertions are provenance records, not permission grants. Admission, coherent live capture, persistence, mapping consumers and final application acceptance are intentionally later work and are not reported as missing scope here.

## Findings

### R1 — P2: Malformed variable objects become resolved binding values

Location: `service/packages/mcp/src/portal/design-normalization.ts:372`–`377`.

The resolution branch rejects null and arrays but accepts every other JSON object as a resolved variable value. A captured FLOAT variable with `valuesByMode: { m: { bogus: 'value' } }` produces `status: 'resolved'`, returns that object as `value`, and records no malformed-value issue. The same issue permits primitive values inconsistent with a known resolved type. Consumers use the resolved/unresolved distinction to select usable property values; passing malformed catalog content through that distinction defeats the foundation's explicit malformed/unresolved contract.

Reproduction: the first diagnostic test expects `unresolved` and receives `resolved`. Validate recognized value families and known resolved types before declaring resolution, preserve unknown/malformed raw content, and use an explicit unresolved reason. Do not exclude legitimate RGB/RGBA or the upstream motion-easing family while making the validation stricter.

### R2 — P2: The exported observation schema accepts false matched coherence

Location: `service/packages/shared/src/design-observation.ts:322` onward; compare the collector evidence checks at `194`–`211`.

`DesignCollectorEvidenceSchema` rejects unequal before/after identifiers for a matched coherence result and rejects a coherence content hash different from the enclosing content hash. `DesignObservationSchema` does not apply those checks. Starting from a valid normalized observation, setting authority to `collector-observed` and coherence to matched with `before: 'a'`, `after: 'b'`, and an unrelated SHA-256 still passes its exported parser. This is an internally inconsistent observation, independently of whether the caller is an admitted collector. Later durable/consumer parsing through the public schema would accept a state that the normalizer cannot produce.

Reproduction: the third diagnostic test expects schema rejection and receives success. Reuse the coherence consistency invariant at the observation boundary and test both identifier mismatch and enclosing content-hash mismatch independently. This does not require treating provenance as authorization or implementing the later admission layer.

### R3 — P2: The exported observation schema does not enforce a valid forest

Location: `service/packages/shared/src/design-observation.ts:331`–`344`.

The relationship check only verifies child IDs listed by a parent. It does not require every non-null parent ID to exist or require each non-root node to occur in its parent's child list. A valid one-node observation can be changed to `parentId: 'missing'` and `roots: []` and still parse successfully. Mutually linked parent cycles are likewise not excluded by the existing checks. The schema promises flat parent/child identities that subsequent ancestor-based mode resolution and consumers can traverse; accepting orphaned/cyclic relationships makes that promise false even though the current normalizer constructs a valid forest.

Reproduction: the fourth diagnostic test expects schema rejection and receives success. Enforce bidirectional membership, existing parents, and root reachability without cycles using work bounded by the node/edge limits. Add orphan, omitted reverse edge and cycle cases.

### R4 — P2: Known incomplete trees can still yield complete node-capability claims

Location: `service/packages/mcp/src/portal/design-normalization.ts:258` and `579`.

A node's `truncated`/`omittedChildren` condition marks only tree incomplete. An explicit complete bindings assertion with count equal to retained bindings is still accepted, even though some child nodes were omitted. The second diagnostic test sets `truncated: true`, `omittedChildren: 2` on a node retaining one binding, then supplies complete bindings count 1. The normalizer accepts the claim instead of rejecting it.

Controller adjudication confirms that the current contract has no independent applicable-node coverage proof distinct from the raw tree. Complete/empty bindings, component APIs and interactions therefore require a valid complete tree; retained-only observations cannot establish coverage over omitted nodes. Propagate invalid/incomplete tree state into all node-capability success checks. Keep separately enumerated variable/collection/style catalogs independent: their completeness need not require a complete scene tree. A future collector contract may add independent node-scope proof, but that evidence does not exist in the current schema.

## Verification and source identity

Read the implementation report, owned-files manifest and reviewed five-file implementation, plus the actual upstream Desktop variable/style contracts in `code-kb/figwright` without modifying them.

Fresh focused run:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-normalization.test.ts packages/shared/test/design-observation.test.ts packages/mcp/test/portal/design-evidence.test.ts
3 test files passed; 23 tests passed; exit 0.
```

Negative probes:

```text
node node_modules/vitest/vitest.mjs run --config artifacts/review-observation-20260915/vitest.config.ts
1 test file failed; 4 expected-behavior tests failed; exit 1.
```

The intentionally failing probes are retained under the isolated service's ignored `artifacts/review-observation-20260915/`, outside owned source and normal project test selection. They are reviewer diagnostics, not production tests. The isolated copy is `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service` and shares the Windows account and host permissions; it is not an OS sandbox.

All five files exactly match `task-5.1-owned-files.json` SHA-256 values after the review run:

| Path | SHA-256 |
| --- | --- |
| `packages/shared/src/design-observation.ts` | `77a070c92ec79d42afd82d9306458341caefb7405d5b0f9a2a405301449810b2` |
| `packages/shared/src/index.ts` | `d1933cf8dd4a869ec9ca56a6e93e4662b66e48d50211bd709b08bbd5077ddaee` |
| `packages/mcp/src/portal/design-normalization.ts` | `729303dd620f1b981e2b665d6975f6a525f2ba0a22bb6cd8bb8b04933c6d8f9d` |
| `packages/mcp/test/portal/design-normalization.test.ts` | `e02baa9ccea0d934f30399afd22bdde138af5780e36f4da0680be77f1aa33b96` |
| `packages/shared/test/design-observation.test.ts` | `c7ce8542607335843b345dd9b096b15af66fcb0364476470611617b99941fb7c` |

No owned files, other workers' files, build outputs, live daemon, browser, Figma state, index, commits or remote refs were changed. No Superpowers, subagents or Docker were used. No full pipeline, live fidelity, or persistence acceptance is claimed.
