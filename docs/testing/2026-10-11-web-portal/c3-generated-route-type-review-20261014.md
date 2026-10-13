# Generic React Router generated-type producer review

Date: October14,2026,03:09KST. Root read the actual C3 source/remaining-graph receipts, current producer/resolver, complete two-file candidate diff and corrected cleanup guards. Main/native source before this producer integration is2798d1d; the deployed runtime remains6f87/cc91. Read [AGENTS](../../../AGENTS.md) and [C2/C3 continuation](../../analysis/c2-c3-continuation-20261013.md) first.

## Cause and exact correction

The C3 compiler succeeded but its issued capsule omitted generated route-type modules because `captureReactRouterCompilerEvidence` read them only when `isReviewedEpicCompilerSource` was true. Actual C3 root/home imports therefore remained unresolved despite observed generated output. The resolver already accepts those extensionless type imports and the project-reference rootDirs configuration. No resolver change is required.

The correction extracts the existing bounded output reader and calls it for every already-admitted React Router compiler producer. Before that call, the function still verifies the genuine run/profile/source/producer binding, every successful command's module evidence, all output receipts and the current deadline. It requires the `.react-router` generated output receipt. Reading still uses1MiB/file,16MiB/total,5,000 entries, owned RepoReader checks and strict UTF-8. Only actual `types/*.ts` members enter compiler namespaces. The helper itself cannot admit a producer or issue evidence; all issuer and final expiry checks remain unchanged. No historical compiler capsule is edited.

Frozen R2 manifest is `.worktrees/_cache/c2-c3-implementation-20261014/c3-graph-repair/frozen-compiler-route-type-repair-r2.json`, SHA-256a1c708cd3eacee0eac0ad8e9e3aa7c11b972befb5edbfd2f52f0eb478c484790. Production final hash isda6b2efb21772fa7b01bce3a353da61169f147651bff3f64a82e5c45e48290f0; test final hash is62fc8c6891ac08a4a24f3672a6991f45fa5514f039a4d07d882102f8949cc4a9. Actual Main preimages remain44b19526 andfb2ef781; R2's candidate-lineage fields are not those Main preimages.

## Evidence and limits

Two new functional assertions passed in distinct retained reports: the non-Epic type/rootDirs resolution positive passed in r3 while the negative expectation failed; the corrected absent/foreign-link negative passed alone in r4. Preserve both reports and the earlier zero-execution setup failure. The admission spy is explicitly synthetic and cannot issue native authority. The positive was not repeated for a clean aggregate. R2 adds only cleanup guards for the three new temporary roots, with canonical parent/root/prefix/identity checks before recursive removal. Syntax-only checking reports zero errors; final affected MCP type/lint/format checking remains owed.

Root approves this exact bounded two-file producer change. Actual new compiler output/graph and full case acceptance must still run through the service. Eight unresolved middleware mounts remain separate exact semantic-review candidates; no graph completeness flag or middleware behavior is waived. No runtime/Source/browser operation was performed by this review.
