# Task 4.2a: Review fix 1

Status: all three accepted P2 findings addressed; scoped rereview pending. Task 4.2b consumer integration remains pending. The initial implementation report, saved initial files, review and diagnostic artifacts remain unchanged.

## Fixes

1. A proven local router mount now requires an Express parent, the exact `use` method, exactly two arguments, and an Express router child. Express `route` construction, cross-framework calls and extra middleware arguments remain explicitly uncertain rather than becoming fabricated mounts. The direct Express body-parser exception also requires an Express parent.
2. Unsupported chains are checked through a bounded ancestry traversal that recognizes both imported factories and already recognized receivers. A chain such as `app.get(...).post(...).get(...)` retains the first directly supported registration and records unsupported-chain uncertainty for the remainder. Ancestry exhaustion produces a stable explicit limit issue.
3. The conservative binding scan includes local names of function and class expressions, preventing either expression from borrowing an identically named imported HTTP factory's identity.

Only the two previously owned new files changed in the separate validation copy. No shared contracts, coordinator, graph consumers, module resolver, dependency, runtime, browser, daemon, primary dist, index, commit or push changed. No Superpowers, subagents or Docker were used. Node HTTP and SFC support were not expanded.

## Red and green evidence

Before implementation edits, the expanded owned suite ran 17 tests: the original 13 passed and four new tests failed. The failures covered mount recognition, an existing-receiver route chain, a named function expression and an independently executed named class expression. The successful mount regression also exercises extra middleware, a Fastify parent with an Express router, and misuse of the Express body-parser exception on a Fastify parent.

Final checks in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run packages/mcp/test/portal/service-connections.test.ts`: 17 passed, exit 0, 357 ms.
- `corepack pnpm exec vitest run --config .cache/review-task4-2a-20260918/vitest.config.mjs`: all four retained independent review diagnostics now pass, exit 0, 289 ms. No diagnostic files were edited or deleted.
- `corepack pnpm --filter @sfp/mcp typecheck`: exit 0.
- `corepack pnpm exec oxlint --deny-warnings packages/mcp/src/portal/service-connections.ts packages/mcp/test/portal/service-connections.test.ts`: exit 0.
- Both owned files formatted with `corepack pnpm exec oxfmt`.

## Exact final hashes

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/service-connections.ts` | `9cfb4e7ae5ac0af2efdddd72a871fb19ca978af2ceded66d0bf9df8323d5e3c4` |
| `packages/mcp/test/portal/service-connections.test.ts` | `55244cea4c3fed5d65093bcadcfb3452cc212a508be99b570ae359817bd67798` |

Native checks share the Windows account, filesystem, process namespace and network; the separate working copy is not an OS sandbox. No final portal, live capture, whole-code review or publication completion is claimed.
