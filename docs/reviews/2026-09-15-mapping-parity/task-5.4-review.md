# Task 5.4 independent code review

Date: 2026-09-15. Result: CHANGES REQUIRED. Three reproduced P2 findings remain in the frozen implementation. This is a scoped implementation review, not either final whole-code review round.

## Scope and method

Reviewed the 24-file manifest and implementation report, Task 5 investigation, actual Chrome inspector, Desktop mapping handlers and plugin producers, mapping adapters/overrides, persisted graph builder/schema and associated tests. All 24 native source hashes matched task-5.4-owned-files.json before review and after reproduction. Source and test execution used C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service. Native execution has the same Windows user filesystem/process/network permissions; it is not an OS sandbox.

No frozen source, dependencies, Git state, daemon, browser, primary build, upstream checkout or configuration was changed. No Superpowers, Docker or subagents were used. Only a retained reviewer diagnostic and its fixture files were added to the separate native copy. Qualified consumers, recipe/prompt modernization, live Desktop/Chrome acceptance and release-wide verification are not certified by this review.

## Findings

### F1 — P2: Desktop token_map drops referenced remote catalog evidence already returned by its full context read

Location: packages/mcp/src/tools/token-map.ts:121-126 (normalization inputs), with get-design-context.ts referenced-variable/style producer and get-variable-defs.ts local-only enumeration as the concrete upstream contract.

The optional nodeId read returns referenced library variables, their collection/mode values and paint styles in context.variables/context.styles. The handler supplies only get_variable_defs and get_styles output as the normalized catalogs. Those tools enumerate local records; a library dependency may be absent there while present in the selected context. As a result the actual Desktop consumer loses evidence that Chrome capture and the persisted-context adapter retain. It returns no pseudo-token or variable mapping and VARIABLE_MISSING for a binding whose captured selected mode/value are available. This is not an external access prerequisite: the read already succeeded.

Reproduction: diagnostic test `keeps selected remote variable/style dependencies in Desktop token_map` supplies empty local catalogs and a valid full context containing remote-v, remote-c and remote-style, with the node selecting mode light. Actual output is mappings [] and an unresolved remote-v binding with reason VARIABLE_MISSING. Expected both source IDs and the observed red binding. The first assertion fails. Preserve/merge the context dependency closure into the canonical catalogs, deduplicating identical records while retaining conflicting same-ID reads as incomplete evidence. Do not silently let one conflicting read overwrite another.

### F2 — P2: A missing component override path is accepted through a same-name symbol in a different file

Location: packages/mcp/src/join/component-map.ts:203-208 and 234-257.

resolveOverrideComponent falls back to a same-name scanned component when the exact recorded file is absent. joinOne then uses that unrelated component's parsed API but emits the original override.filePath. The override is marked legacy-unverified instead of stale, and downstream graph construction attempts to read the missing path. The new shared override reader correctly reports that the recorded target does not exist, but this name fallback defeats that evidence. The lower confidence does not make a nonexistent import usable.

Reproduction: actual handleComponentMap with a real Button.tsx and `| Button | missing/Button.tsx |` returns candidate.filePath missing/Button.tsx, confidence 0.7, status medium and overrideStatus legacy-unverified. Expected stale override evidence plus the separately scanned Button.tsx candidate. The diagnostic fails on overrideStatus. Resolve a recorded path against that same path; a fallback name candidate must use its actual path and remain a normal scan result. Keep API evidence bound to the actual target file/symbol.

### F3 — P2: Persisted graph loses token override validity and code source binding

Location: packages/mcp/src/snapshot/build-grounding-graph.ts:225-240 and packages/ir/src/grounding-graph-v1.ts:101.

The builder computes canonical token mappings and codeSourceHash but only persists generic candidate edges and mappingObservation, which contains design evidence rather than mapping results. Neither overrideStatus, staleOverride nor the exact code-source binding is retained. Therefore a verified current proof and a stale proof can create identical stored graphs when the fallback name/value join has the same candidate/confidence. Task 5 requires explicit overrides, ambiguity and source hashes to survive the persisted consumer; later consumers cannot recover those facts from this graph.

Reproduction: with actual filesystem token loading, write a valid v2 proof for remote-v and confirm handleTokenMap reports verified. Build the graph. Change only proof.codeSourceHash to an invalid hash and confirm handleTokenMap reports stale, then rebuild. Date is fixed solely to remove unrelated timestamps. Both entire graphs are byte-identical; both hashes are sha256:1a498a67f3c6eb5dc1a4351bbba84b3b88e8aa8a9aff37ba5a550c2bb84e6e44. Persist bounded typed mapping/provenance results under graph content identity (or equivalent edge evidence) without turning catalog verification into runtime/API verification. Historical graphs should remain inspectable.

## Executed verification and retained reproduction

Focused existing suites passed 63 tests in 6 files, exit 0, 4.78 seconds:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/mapping-consumers.test.ts packages/mcp/test/mapping-parity.test.ts packages/plugin/test/handlers/get-design-context.test.ts packages/mcp/test/tools/token-map.test.ts packages/mcp/test/tools/component-map.test.ts packages/ir/test/grounding-graph.test.ts --maxWorkers=1
```

Retained diagnostic: packages/mcp/test/review-task54-parity.test.ts, SHA-256 1b6d9106f264274b026add48ec0012b90a59e8a674141c293f0ded61ec4f790b. Its fixtures remain under service/.cache/review-task54/ in the native copy. They are reviewer evidence, not integration inputs. An initial fixture omitted required paint opacity/visible fields and was corrected before the substantive run; that setup error is not a production finding.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/review-task54-parity.test.ts --maxWorkers=1
```

Substantive result: 3 tests failed in 1 file, exit 1, 1.34 seconds, each on the expected defect assertion above. The parent independently reran all three and accepted the findings before requesting implementation fixes. Keep these diagnostics frozen for follow-up verification; they should not be mistaken for source-wide regression failures after integration.

## Other inspected boundaries and limits

The actual index dispatcher retains the pinned plugin scope, cancellation, operation context and derived child action for the extra context read; no new routing or permission bypass was identified in the reviewed change. Optional override reads retain RepoReader authority, and missing-file handling is narrow. The new token source tracker records actual parser reads, reobserves those bytes, includes the profile in codeSourceHash and rejects conflicting repeated reads. This is optimistic read consistency, not an atomic repository snapshot. Mapping observations stay legacy/unverified as standalone reads; that is appropriate and was not treated as live capture proof.

The existing focused tests exercise duplicate IDs, aliases with independent mode selections, stale value/type/mode proofs, component API observations and token-source mutation. Passing those tests does not cover the three failed actual-consumer cases. No live host claims or portal generation/apply acceptance are made here.

## Reviewed source hashes

The following table is copied from the manifest after rechecking the native bytes. Paths include the service prefix.

| Path | SHA-256 |
| --- | --- |
| service/packages/cli/src/project-inspector.ts | 699686375d7840c3719a0012bb0b43d2b56a9e67eda29361b6d71b4d59f113df |
| service/packages/mcp/src/tokens/figma-tokens.ts | 60c3605e5007e2f20af20363a3d3ac23b27d9dfcb8c90c12fbc0d6ad15c18126 |
| service/packages/mcp/src/join/token-map.ts | d83eb6b4beff96b4242aa5ac6f97125110e04fa73465fa6310a99bba50c20eb9 |
| service/packages/mcp/src/join/component-map.ts | 58386a7ee16a2c5ae8eacba7c7cd6a882b6cc8cef02a52d1aa736923de89fdf1 |
| service/packages/mcp/src/mapping/design-mapping.ts | d6d18f608fd68c9902b119319fe8e73e9bb337ec4e602d695cab75c6a1b12273 |
| service/packages/mcp/src/mapping/mapping-overrides.ts | 23827d3a308e8a9ebb8fad3b9663f0d0d95b67a3a5ce8b5c44d1c240a20a1f76 |
| service/packages/mcp/src/tools/token-map.ts | 27e7a2ecaea8f9c8228c699be1ebd5d13ac2770d40281e28c3d9bc6b26d50fe3 |
| service/packages/mcp/src/tools/component-map.ts | 12db3c61baaf9e2231613ee893cd5d7b59a15918371fb466544c451e56accccf |
| service/packages/mcp/src/tools/icon-map.ts | ddbb130ee3e153506a6543b9926c5e5d63a548b5480ab481d0625678eb358287 |
| service/packages/mcp/src/snapshot/build-grounding-graph.ts | 9b446641e1027d030c115ae3952e728a6571853c735f8e83f3eb730ff4ad32d5 |
| service/packages/shared/src/design-context.ts | 02891bfad17a407a44e2fe18c9705bfbe3aa3005a2dca32e186c957bb1afbec5 |
| service/packages/shared/src/result-schemas.ts | cdcccf2adb6e142fcfdf9c04bd310c53a123f1e34ca96c8c5b976a0d8b944b4c |
| service/packages/ir/src/grounding-graph-v1.ts | 6133bb7649e9f71f6df361f317e95f912e14766b9337dfad1ff04201dcc3869b |
| service/packages/plugin/src/handlers/get-design-context.ts | e89c389a82bbf91a6a6e6d7b5c8c93ad3cc65a671dfc0dfc29fc1d40da232409 |
| service/packages/plugin/src/handlers/get-variable-defs.ts | 104f0b767e247352429a055f1963f4b3f5d1938b5ce6fcf94717824f1b61a69a |
| service/packages/plugin/src/handlers/get-component-api.ts | 07ddd28f36a57f78a77b6645342d71a3774be3dc24b73ad21e7eb8426fa3d3f5 |
| service/packages/mcp/test/mapping-parity.test.ts | 20a8595ee45252f1ef5428fcec6a628d16da9aede56b6681acd2a249b772828f |
| service/packages/mcp/test/mapping-consumers.test.ts | b33b2e157f0972dc0ed013043e899f20c1183882c420fd39c242993fad9de957 |
| service/packages/mcp/test/join/token-map.test.ts | f8672f66a8f9037eea97e8f9600aade35478e7664210647689b6a9578d49c8f1 |
| service/packages/mcp/test/join/component-map.test.ts | 49bea760e378f75adaedd277c07d8ed4e4706a40b18ca16ac7dbcef24b91e4b8 |
| service/packages/mcp/test/tools/token-map.test.ts | e1993561f40ca64c503ee14b9846f005ad3a6b6633d9232211d6f506c209a9bf |
| service/packages/mcp/test/tools/component-map.test.ts | c602dd3eaf8c6384e518b15be8c533c36cb255f6bb0084baf1f0044570ccb722 |
| service/packages/mcp/test/tokens/figma-tokens.test.ts | cb31dec31fae31a0f754d15f762f21912096f6e443a538241923549c968aef6e |
| service/packages/plugin/test/handlers/get-design-context.test.ts | 2487458ca8b23268b9d579080ab8bdbf73d07669d0ef7a26ef3af24d3bff1f81 |
