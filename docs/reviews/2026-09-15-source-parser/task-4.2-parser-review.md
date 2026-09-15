# Task 4.2 Parser Bound Review

## Verdict

Pass for this two-file parser bound correction. No actionable finding in the changed code or immediate regression coverage. This is not a full frontend-policy review or completion of Task 4.2.

## Review

The new capacity check rejects a wide AST array with the existing `PORTAL_CANDIDATE_AST_LIMIT` error before any argument spreading can overflow the JavaScript call stack. Incremental enqueue preserves the previous child order. Counting already visited entries plus queued entries plus the incoming array is a conservative lower bound on the remaining traversal work, so the early rejection is consistent with the existing 100,000-entry limit. The original per-visit guard remains in place for nested expansion.

The regression uses valid 260,022-byte TypeScript input and checks the stable portal error rather than accepting an arbitrary exception. The change does not alter frontend policy branches. The existing accepted Vue case and backend-rejection cases remain passing.

## Verification

Working directory: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

```powershell
& ./node_modules/.bin/vitest.cmd run packages/mcp/test/portal/source-guard.test.ts
```

All 14 focused tests passed, exit 0. Both owned hashes were independently recomputed and matched `task-4.2-parser-owned-files.json`:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/source-guard.ts` | `03c0e8bf040137abbe67e455a807a196935404bb0fa4b12af731fddd44e39192` |
| `packages/mcp/test/portal/source-guard.test.ts` | `cb2528465ea3f92d1fa107ff019833e884919705b3f048e2a6440fe6f9078ce0` |

No owned source edits, new diagnostic fixtures, browser, daemon, build output, index, commit, Docker, Superpowers, or subagent operations were performed. Native tests share the current Windows account, filesystem, process namespace, and network; they are not an OS sandbox.
