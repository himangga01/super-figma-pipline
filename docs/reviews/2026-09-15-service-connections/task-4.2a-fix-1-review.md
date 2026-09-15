# Task 4.2a fix 1 scoped rereview

## Outcome

Specification: pass for the bounded Task 4.2a helper. Quality: pass. All three findings from the initial review are addressed. No additional actionable finding was identified in the fixes and nearby behavior inspected. This is not whole-Task-4 approval or a replacement for the later integration and whole-code reviews.

## Findings verified

1. **Mount semantics and argument completeness:** Lines 726-735 require an Express parent, `use`, exactly two arguments and an Express router child. The former `app.route('/api', router)` phantom mount and the ignored extra-middleware case now produce `UNRESOLVED_MOUNT`, incomplete analysis and no fabricated producer. The body-parser exception also checks the parent framework. Owned regressions cover Fastify misuse and preserve the existing valid CJS Express mount test.
2. **Chaining from known receivers:** Lines 578-592 perform bounded chain ancestry inspection, and lines 655-665 retain explicit uncertainty for chains originating from an existing receiver or imported factory. The original two-call diagnostic passes, as does the new three-call owned regression. The first directly supported route can remain as evidence while `complete` is false. Ancestry exhaustion has its own explicit issue; no arbitrary recursive traversal was introduced.
3. **Named expression shadowing:** Lines 395-404 include both function and class expression names in the conservative binding scan. The original named-function diagnostic now emits no provider. Independently parameterized owned tests cover function and class expressions, require `UNKNOWN_HTTP_RECEIVER` and incomplete analysis, and reject phantom providers.

## Verification

Executed in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run --config .cache/review-task4-2a-20260918/vitest.config.mjs`: 4 passed, exit 0. These are the retained original adversarial diagnostics, unchanged by this rereview.
- `corepack pnpm exec vitest run packages/mcp/test/portal/service-connections.test.ts`: 17 passed, exit 0.
- Fresh SHA-256 checks matched the refreshed owned-file manifest: source `9cfb4e7ae5ac0af2efdddd72a871fb19ca978af2ceded66d0bf9df8323d5e3c4`; test `55244cea4c3fed5d65093bcadcfb3452cc212a508be99b570ae359817bd67798`.

The worker reports successful typecheck and lint; those were not independently repeated in this scoped rereview. The main session will run its own focused tests before integration.

## Scope and retained limits

Only the two owned helper files and the fix report/refreshed review evidence were inspected. No source, owned tests, diagnostic fixtures, index or runtime artifacts were edited. No browser, daemon, primary dist, dependency installation, commit, push, Docker, Superpowers or subagent operation occurred. The original review and ignored `.cache/review-task4-2a-20260918/` diagnostics remain intact.

The initial review's accepted boundaries continue to apply: Node HTTP control flow, runtime SFC/MDX analysis and other explicitly unsupported forms remain incomplete; service selection, source-review admission, graph version fencing and consumer integration belong to Task 4.2b or later. Qualified static evidence is not runtime success or proof that a complete portal exists. Native validation shares the Windows account, filesystem, process namespace and network and is not an OS sandbox.
