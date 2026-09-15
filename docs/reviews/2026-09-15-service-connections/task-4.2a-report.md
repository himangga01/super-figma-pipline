# Task 4.2a: Static service-connection foundation

Status: implementation ready for review. This helper alone does not complete Task 4. Consumer integration, qualified service selection, source-review admission, graph version fencing and workflow coverage remain Task 4.2b and later work.

## Owned changes

Only the two new files listed below were written in the separate native validation working copy. No service graph, module resolver, shared schema, coordinator, native executor, dependency, index, daemon, Chrome session, primary dist, commit or push was changed. No Superpowers, Docker or subagents were used.

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/service-connections.ts` | `9c6ffe7670ce46667a76d9c838296e9683171b614831e1d2b9232f762a87cd04` |
| `packages/mcp/test/portal/service-connections.test.ts` | `0068ab0f73d1a94db04c78af7c02ef7a3e72833f673aecef0cc1db1341b46990` |

## Interface and authority boundaries

`analyzePortalServiceConnections({ sources, modules, routingBindings?, limits? })` accepts verified text with caller-supplied `sourceId`, `serviceId`, source-relative path, SHA-256 and semantic role. It rechecks text hashes, rejects duplicate qualified paths, bounds source/AST/evidence analysis and accepts reviewed `PortalModuleReference` results grouped by source identity. These identifiers never grant filesystem, execution or review permission.

The result has `version: 1`, a supported-analysis `complete` flag, separate producers/clients, persistence and configuration candidates, typed module-dependency/HTTP-contract connections, and explicit issues. Completeness is not runtime success, a resolved database call graph, whole-portal completeness or an absence-of-workflows claim. Every endpoint and relationship retains qualified source path/hash/offset evidence; router mounts retain supporting evidence. Module edges use the same qualified source and retain resolved target evidence, so colliding reference paths do not merge.

HTTP route equality alone cannot prove deployment. Optional `PortalRoutingBinding` entries require source-bound evidence, a declared basis (`supported-configuration` or `admitted-source-review`), deployment identity, optional normalized HTTP(S) origin and separate literal route prefix. The helper validates evidence membership/hash/offset and canonicalizes scheme/host/default port; the main consumer must actually derive supported configuration or admit a qualified review before constructing these bindings. A caller-chosen deployment string or declared basis is not itself proof or permission. Connections retain this basis and supporting evidence. Missing, malformed or ambiguous scope is explicit incomplete analysis. Origins containing credentials or non-root paths are rejected; external mounting uses `routePrefix`. Query values and URL credentials are not retained in endpoint evidence.

## Supported and conservative forms

- Recognized static ESM/default/named and CommonJS bindings distinguish Express apps/routers, direct Fastify factories, Hono constructors and axios clients from ordinary object methods. Global literal `fetch` supports static method options.
- Exact literal producer/client methods and routes can connect when a unique provider has matching routing evidence. Literal local Express router mounts are bounded, cycle checked and source bound. Express settings getters are not API routes; ordinary object `get` calls are not HTTP evidence.
- Shadowed/reassigned/mutated factories, computed receiver calls, unknown factories, dynamic URLs/options, unknown middleware/mounts, route patterns, ambiguous providers and unsupported chained/client forms require review. Standard direct Express body-parser middleware calls do not invent extra routes.
- Reviewed module dependencies form source/service connections independently of routing assumptions. Declared database modules, SQL/Prisma source, resolver configuration and `process.env` access are source-bound candidates; environment values and repository modules are never executed or read from the process/filesystem by this helper.
- Node HTTP control-flow routing is explicitly `UNSUPPORTED_NODE_HTTP`; it is not claimed implemented. Runtime Vue/Svelte/MDX and other unsupported formats are explicit `UNSUPPORTED_RUNTIME_SOURCE`, not assumed behavior-free. A caller can classify demonstrated auxiliary/configuration/asset material separately, but must not use that role as an unsupported relevance exemption. Nonempty server factory options, custom client factories, cross-file router-value linking, parameterized route matching and arbitrary middleware behavior remain conservative unsupported forms.

## Verification

Initial regressions failed because the new implementation was absent. Additional adversarial regressions then reproduced false success for computed/mutated HTTP receivers and missing module analysis, and a false provider for an Express settings read; those failures were fixed before the final run.

Final native validation in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run packages/mcp/test/portal/service-connections.test.ts`: 13 passed, exit 0 (365 ms).
- `corepack pnpm --filter @sfp/mcp typecheck`: exit 0.
- `corepack pnpm exec oxlint --deny-warnings packages/mcp/src/portal/service-connections.ts packages/mcp/test/portal/service-connections.test.ts`: exit 0.
- Both owned files formatted with `corepack pnpm exec oxfmt`.

Tests cover selected web-to-API versus an unrelated sibling, persistence candidates, CJS mounted routers/ESM axios, shadowing and unknown factories, computed/mutated calls, dynamic mount/client options, ambiguous providers, unproven deployment, actual 80,000-element wide AST input, qualified colliding reference paths, canonical origin/port/prefix and evidence hashes, retained query secrecy, source-hash and duplicate-path rejection, Node HTTP uncertainty, auxiliary providers, evidence budgets, opaque runtime input, settings getters, chained forms, router cycles and unsupported provider patterns.

Native checks share the current Windows account, filesystem, process namespace and network. This is a separate working copy, not an OS sandbox or atomic filesystem snapshot. No final portal generation, live Figma capture, apply, whole-code review or publication success is claimed.
