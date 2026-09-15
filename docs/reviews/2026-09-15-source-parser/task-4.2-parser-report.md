# Task 4.2 parser limit correction

Main reproduced a 260,022-byte valid source array causing Maximum call stack size exceeded rather than the existing PORTAL_CANDIDATE_AST_LIMIT error. The regression failed before the fix. The visitor now checks remaining queue/visit capacity before incremental array enqueue, preserving the existing frontend policy. Fourteen source-guard tests pass, exit 0; owned lint/format pass. Only the two files below changed in the separate native working copy. No shared/native/graph/connection code, browser, daemon, build output, index or commit changed. This is not completion of Task 4.2. Independent narrow review and exact-byte integration remain pending.

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/source-guard.ts` | `03c0e8bf040137abbe67e455a807a196935404bb0fa4b12af731fddd44e39192` |
| `packages/mcp/test/portal/source-guard.test.ts` | `cb2528465ea3f92d1fa107ff019833e884919705b3f048e2a6440fe6f9078ce0` |
