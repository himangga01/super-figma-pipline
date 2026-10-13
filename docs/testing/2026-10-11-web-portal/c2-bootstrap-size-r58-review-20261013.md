# C2 R58 bootstrap argument compaction: independent review

Date: October 13, 2026, Asia/Seoul, 18:28 KST. Verdict: **Approve the exact two-file R58 candidate.** No actionable semantic change was found beyond the intended fixed error-table sharing and local identifier compaction. This review performs no integration, profile retry or genuine public/native proof.

## Baseline and exact source

Read-before: [AGENTS](../../../AGENTS.md), shared analysis policy previously read, [R56 review/R57 argument diagnosis](c2-legacy-builder-r56-review-20261013.md), prior immutable freezes and the author compaction record. Main/runtime 303d remains the live source and Root owns any future source-write boundary.

Freeze `.worktrees/_cache/c2-compiler-support-20261013/freeze-r58/frozen-files.json` SHA-256: `274508d904dd01debe7afae0994376e4fb56f3b99aecd5165dac13b11d49120e`. Independently verified the exact R56 predecessor manifest, both candidate files, declared lineage and all four Main/native preimages:

| File under service | Main/native R52 | Previous R56 | Reviewed R58 |
| --- | --- | --- | --- |
| `packages/mcp/src/portal/react-router-compiler-evidence.ts` | `595f0ec5810511d63948c02265a347a15169ff62b9b00344fd69edb53f3a5bea` | `d174eb4acfd3d3c833cdc35670b534b790c17dd5de1bf9e98aa4e92644d6a467` | `c4425386948662ab2ad725fb85ee104f2af69d7e72537da5bb0d3351078cc13d` |
| `packages/mcp/test/portal/react-router-compiler-evidence.test.ts` | `6d9d2266ad1c33c6f8f5274403d32e606f3ca0c9985d0f8a7f9d196fc3222025` | `5d61c3577f304640704ddf829cf0b38f173330341455b8e8d574e05c6a35f966` | `d785a86aad1e9e8f3a63becf7e383034d91c1b4520c759946e4b229a8fd2a495` |

## Independent semantic verification

R56's complete generated bootstrap was 9,020 ASCII characters/bytes, above the fixed 8,192 per-argument schema limit. R58 is 7,942 characters/bytes, with 250 characters below the actual cap and 58 below the new 8,000 regression ceiling. The schema limit remains unchanged.

Complete source diff shares the same eight fixed error strings once and shortens thirteen local bindings through 63 identifier edits. The public object keys `codeBytes` and `cssUrlModules` remain explicitly preserved when formerly shorthand bindings change. External member/method/property names, literal values, branches and diagnostic field strings remain unchanged. No whitespace regex, truncation, runtime minifier or new dependency is used.

This reviewer independently parsed both complete emitted bootstrap programs with installed TypeScript's JavaScript abstract syntax tree (AST). The review normalization reverses only the declared collision-free local names, expands the fixed indexed error strings and the catch's fixed known-array reference, removes only the new table declaration, and normalizes shorthand into explicit properties while preserving their original keys. Unexpected table references or invalid indices reject. No proposed short name or `E` existed in the original program. The normalized program trees are exactly equal, hash `f780a624bb37ee82a9e642960ddadb1fa289f7d2845a8d34b1ca8aafa936ae32`. This verifies the stated alpha-renaming/literal deduplication rather than assuming it from a textual whitespace reduction.

Semantic receipt SHA-256 `3c751374fc75f50791f74c933ae217de8319b4e90967de4592774da15cfdea64` is retained under `.worktrees/_cache/r58-independent-review-20261013`. Consequently, genuine client/context/manifest/SSR options, callback selection, original CSS size/duplicate guards, closed metrics, catcher behavior and all deadlines/authority/fences remain as previously reviewed. Sharing the fixed internal error table does not change its eight emitted error values; its remaining references are restricted to indexed errors and the catch's read-only known-error membership check.

## Independent four-case execution

Created a regular current-source copy with 1,357 files, replaced only the two copied paths and retained the private read-only dependency adapter/pinned Vite 7.3.1 entry. Ran only `admits the complete generated compiler|uses real installed Vite legacy|retains CSS duplicate|accepts actual installed Vite context`: **four passed, zero failed, thirteen name-filtered**, exit zero and no reported unhandled error.

The new case checks both complete generated string length/UTF-8 size and the actual service `NativeCommandSchema.safeParse` of the emitted Node `-e` command, preserving 8,192. The other cases retain real pinned builder environment/callback control flow with build effects intercepted, CSS same/different repeat/size denials and real Vite merge behavior. None is a sample compiler/native execution. Author fail-before receipt has three passes/one failed size-regression case/thirteen filtered. Its first length assertion stops that case before schema parsing; the earlier R57 pure actual-schema `too_big` observation separately proves the original schema rejection. After compaction, this independently executed case reaches and passes the actual schema.

Independent report SHA-256 `136b636b156fa3d3c4b76d668078bc2333328f9f0c14fc9ad66eb7bcafb7217a` is retained at `.worktrees/_cache/r58-independent-review-20261013/targeted-report.json`. Posthash proves frozen/copied files unchanged and Main/native still at R52. Author no-emit records 456 closure files/zero diagnostics and scoped lint/format pass. No full seventeen-case file, earlier cohort, whole, native/public proof, registration/reprepare, dependency install, product build, live state/Chrome action, source edit, staging or commit occurred here.

## Continuation and actual limits

Preserve R57's failed public preparation with zero compiler calls, all earlier compiler failures/settlement and R25's unknown outcome. Do not replay the old request or infer an actual compiler positive from schema acceptance. Root can authorize a distinct fresh proof and a later explicit integration/release boundary; the existing uninvoked R56 integration helper needs new exact R58 pins and cannot silently apply this candidate. Main/runtime 303d remains separate while fresh source capture continues.

The owner's one portal journey, both Figma scopes, original grants/deadlines, manual native Chrome approval and deferred official-MCP live path remain unchanged. The regular review copy shares the Windows account's privileges and provides no OS/process sandbox or atomic rollback guarantee. Actual public/native and complete frontend outcomes still require their separate execution evidence.
