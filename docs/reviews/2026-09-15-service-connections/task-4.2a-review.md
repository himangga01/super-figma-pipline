# Task 4.2a independent review

## Outcome

Specification: changes required. Quality: changes required. Three actionable P2 findings reproduce false positive providers or false supported-analysis completeness in the bounded helper. These are helper defects, not requests to complete Task 4.2b consumer integration.

Reviewed only `service/packages/mcp/src/portal/service-connections.ts` and its test, with read-only module-resolution context. Source SHA-256 remains `9c6ffe7670ce46667a76d9c838296e9683171b614831e1d2b9232f762a87cd04`; test SHA-256 remains `0068ab0f73d1a94db04c78af7c02ef7a3e72833f673aecef0cc1db1341b46990`. No owned source or test was edited.

## Findings

### P2: Restrict mount recognition to the actual framework API and complete argument shape

Location: `service/packages/mcp/src/portal/service-connections.ts:707-712`.

The mount predicate treats both `use` and `route` as equivalent for every recognized framework and reads only the first two arguments. With `const app = express(); const r = express.Router(); r.get('/docs', handler); app.route('/api', r);`, the helper emits a `GET /api/docs` producer with mount evidence, `complete: true`, and no issues. Express `app.route(path)` returns a route object; it does not mount the second argument as a router. The [official Express routing guide](https://expressjs.com/en/guide/routing/) distinguishes route construction from router mounting through `app.use`.

A second regression, `app.use('/api', r, customMiddleware)`, returns the same complete result despite the documented requirement to retain unknown middleware uncertainty. Limit the recognized mount form by parent/child framework and argument shape; record unsupported forms explicitly instead of manufacturing a mount or dropping arguments. Both assertions fail in the diagnostic test.

### P2: Do not silently omit chaining from a recognized receiver

Location: `service/packages/mcp/src/portal/service-connections.ts:636-647`.

The unsupported-chain branch checks only whether the immediate nested call is a recognized factory. `app.get('/one', handler).get('/two', handler)` therefore emits `/one`, omits `/two`, and returns `complete: true` with no issues. This is a normal Express chaining shape originating from a recognized receiver. The bounded helper need not implement chain traversal now, but it must retain unsupported-chain uncertainty so a later admission gate cannot treat the missing endpoint as absent. Extend bounded receiver provenance detection to call chains rooted in recognized receivers, or resolve the supported chain correctly. The diagnostic assertion requiring incomplete analysis fails.

### P2: Include named expression bindings when rejecting factory shadowing

Location: `service/packages/mcp/src/portal/service-connections.ts:395-400`.

The declaration scan binds function and class declarations but omits the local names of function and class expressions. For `import express from 'express'; const f = function express() { const app = express(); app.get('/docs', handler); };`, the inner call resolves to the named function itself, yet the helper treats it as the imported Express factory. It emits a phantom `/docs` producer and `complete: true`. Account for named expressions in the conservative binding scan, or implement lexical binding resolution; the existing parameter-shadowing handling does not cover this case. The named-function diagnostic assertion requiring no provider fails. Class expressions should be covered by the fix because the same scan omits their local binding as well; only the named-function form was reproduced here.

## Verified strengths and supported limitations

- Qualified source/path keys and hashes are preserved for module edges, preventing colliding reference paths from merging. Hash rejection, duplicate paths, missing module analysis and evidence offsets have explicit failure paths.
- Routing bindings require source-bound evidence; URL credentials and non-root origins are rejected. Deployment or admitted-review claims still require an authoritative caller. This helper does not grant permissions or independently establish review admission.
- Source text, input collections, AST traversal, module references, retained evidence, matching work and mount ancestry have finite limits. Exhaustion marks incomplete analysis. The review did not run an exhaustive resource-stress benchmark or prove a wall-clock bound.
- Persistence and configuration outputs remain candidates rather than asserted execution or database reachability.
- Explicit Node HTTP control-flow and runtime SFC/MDX limitations are accepted as declared helper scope. Dynamic/custom forms may remain unsupported but must produce uncertainty when recognized, as illustrated by the findings above.
- Source-review admission, service selection, graph version fencing, consumers and whole-portal workflow completion remain later tasks; their absence is not a finding against this helper.

## Reproduction and verification

Executed in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

1. `corepack pnpm exec vitest run packages/mcp/test/portal/service-connections.test.ts`: 13 passed, exit 0.
2. `corepack pnpm exec vitest run --config .cache/review-task4-2a-20260918/vitest.config.mjs`: four assertions failed, exit 1, reproducing the three findings and the extra-middleware variant. Each observed result had `complete: true` and no issues.
3. SHA-256 checks of both owned files matched the implementation report after verification.
4. `git check-ignore` confirmed both diagnostic files are excluded by the existing `.cache/` rule.

Diagnostic artifacts retained exclusively under `service/.cache/review-task4-2a-20260918/`: `adversarial.test.ts` and `vitest.config.mjs`. This path is a unique scratch label, not a claim about the review date. They are excluded from source integration and need not be deleted. No daemon, browser, primary dist, dependency installation, index, commit or remote operation was performed. Validation shares the Windows account, filesystem, process namespace and network; the separate copy is not an OS sandbox.
