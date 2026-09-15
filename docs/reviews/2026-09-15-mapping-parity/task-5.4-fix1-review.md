# Task 5.4 fix 1 independent review

Date: 2026-09-15. Result: PASS for the eight-file fix delta and the three original scoped findings. This does not certify final whole-code review, live capture or portal acceptance.

## Reviewed scope

Read task-5.4-fix1-report.md, the exact initial-to-current fix1.diff, the eight-path fix1-delta manifest and the current 24-path ownership manifest. Inspected the actual common mapping adapter, Desktop token handler, Chrome inspector, component override join, graph producer and shared/IR result contracts. All 24 current source hashes matched the ownership manifest after verification. The initial review and initial source evidence remain unchanged.

No production source, dependency, Git state, browser, daemon, build, environment configuration or diagnostic file was edited. No Superpowers, Docker or subagents were used. Tests ran natively in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service, with the same Windows account filesystem/process/network privileges. The separate copy is not an OS sandbox.

## Finding adjudication

- F1 is addressed. Desktop token_map passes its full selected context and local catalogs to the common adapter. Referenced remote variables, collections and paint styles now reach mappings and selected-node bindings. Material equality ignores non-semantic library metadata/convenience fields; conflicting value/type/mode/paint records survive as duplicate-ID evidence. Variable/collection conflicts prevent bindings from claiming a trustworthy first-row resolution. The original remote-only diagnostic now succeeds. Added actual-consumer tests cover remote parity, local/context value conflicts, metadata-only duplicate elimination, default-mode conflicts and paint conflicts. Standalone read authority remains legacy-unverified.
- F2 is addressed. A scanned symbol in a different file cannot validate the recorded override path. The original absent-target diagnostic now returns stale evidence and the real scanned candidate path. A parsed same-file result emits its actual symbol name. Existing but unparsed targets remain explicitly low-confidence legacy hints; this is not runtime API compatibility proof.
- F3 is addressed. The graph now stores bounded, versioned mappingResults with codeSourceHash and canonical token/component/icon outputs. The strict shared item schemas are reused. Redundant component observation copies are omitted because mappingObservation retains the design evidence. The unchanged diagnostic now distinguishes verified and stale proof states through graph content identity. Tests confirm that modifying the stored source hash without recomputing graph identity fails schema validation and that historical graphs without mappingResults remain inspectable without fabricated defaults. Catalog proof status is not promoted to verified runtime edges or portal authority.

No additional actionable finding was identified in this scoped fix review.

## Native verification

Executed:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/review-task54-parity.test.ts packages/mcp/test/mapping-consumers.test.ts packages/mcp/test/mapping-parity.test.ts packages/mcp/test/tools/token-map.test.ts packages/mcp/test/tools/component-map.test.ts packages/ir/test/grounding-graph.test.ts --maxWorkers=1
```

Result: 39 tests passed in 6 files, exit 0, 6.81 seconds. This includes all three unchanged reviewer diagnostics that failed against the initial implementation. Diagnostic SHA-256 remains 1b6d9106f264274b026add48ec0012b90a59e8a674141c293f0ded61ec4f790b at packages/mcp/test/review-task54-parity.test.ts in the native copy.

The parent runs the broader affected-suite verification independently. This reviewer did not claim a source-wide typecheck, build, knip or release suite result. Active Task 6 changes and qualified portal consumers are outside this scope. Prompt/skill modernization, actual recipe consumption, live Desktop/Chrome validation, final whole-code reviews and release checks remain separate obligations.

## Verified changed source hashes

The full 24-path current manifest was checked with zero mismatches. The eight changed paths are below; all other owned paths remain at their previously reviewed hashes.

| Path | SHA-256 |
| --- | --- |
| service/packages/cli/src/project-inspector.ts | f65654d5a78ed79d2a5f07e180bb4347e8920c39555350e0e965f50c9893ca9f |
| service/packages/mcp/src/join/component-map.ts | 139c5eea24d13e55a5dc31909b96312605089367491e682d805e394bfec99cd7 |
| service/packages/mcp/src/mapping/design-mapping.ts | 8325ae9e7f583d700c94fae26138583d2f33c2144b64c8a43a366e9814526684 |
| service/packages/mcp/src/tools/token-map.ts | 23ed5b33a3565b067713c295502f1f8beb30c67bb8e6b9082b2e2ce4305cfe56 |
| service/packages/mcp/src/snapshot/build-grounding-graph.ts | bbacc372f878068b3ac00bec77baaa2cb9d84140e349b3297b7c678ddad5a7dd |
| service/packages/shared/src/result-schemas.ts | 1001ad22316230db2eed7bab52103af4c7db6016e683c90028ad13c6ae9206be |
| service/packages/ir/src/grounding-graph-v1.ts | 3ac1b3e10fab9a0866bd8f10488b371012bf09d9825c51db4590676694f53b4b |
| service/packages/mcp/test/mapping-consumers.test.ts | 6867b1626be02cc978daf9a5663cd3dcd53a207bf4771e7b0175488adb0217f0 |
