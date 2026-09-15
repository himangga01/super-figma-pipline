# Task 4.1 Independent Module Resolution Review

## Scope and verdict

Changes requested before treating this helper's `complete` result as authoritative. This review covers only `service/packages/mcp/src/portal/module-resolution.ts` and its nine owned tests in the isolated working copy. Caller integration remains pending and is deliberately not reported as a defect. No owned source/test files, daemon, browser, build output, index, or commits were changed by this review.

Reviewed SHA-256:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `8cf0ff0643ef4e2e5caad25160edb733b69453fc6bd265ed6b6a05221acc448d` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `4e3fc16c5779dd549354163ac82ee4f90c3f3daa6659fa4291f5e20a1f617719` |

The implementation is read-only and correctly handles the nine covered examples, including basic ESM/CJS, inherited JSONC paths, conditional workspace export branches, SFC scripts, and explicit missing inputs. The principal failures are falsely complete results for unmodeled module forms and configuration, plus an uncaught traversal failure within the advertised input size limit.

## Findings

### F1 — P1: Unrecognized module-loading forms silently disappear from a complete graph

Location: `service/packages/mcp/src/portal/module-resolution.ts:457-481`.

The collector recognizes only the listed declaration/expression forms and direct identifier calls named `require`. The following independent one-file fixtures all return `complete: true` despite unresolved dependencies:

```js
// main.cjs: zero references, zero issues
module.require('./missing.cjs');

// main.mjs: only node:module is recorded, zero issues
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
load('./missing.cjs');

// main.ts: zero references, zero issues
export type Item = import('./missing').Item;
```

A graph consumer cannot distinguish these missing dependencies from absence of imports. Resolve the statically supported forms or emit an explicit incomplete issue for recognizable unsupported loader creation/usage and TypeScript import-type dependencies. Do not silently call them complete merely because the visitor does not collect them.

### F2 — P1: Every named nested manifest is treated as an installed workspace package

Location: `service/packages/mcp/src/portal/module-resolution.ts:373-376`.

This fixture returns `complete: true` with target `fixtures/index.js` and configuration `fixtures/package.json`:

```json
{
  "main.ts": "import 'uninstalled';",
  "fixtures/package.json": "{\"name\":\"uninstalled\",\"main\":\"index.js\"}",
  "fixtures/index.js": "export {};"
}
```

There is no root package, workspace declaration, dependency edge, or installation link. The same problem can make an unrelated fixture or example package shadow a declared external package. A matching manifest name is not sufficient workspace-resolution evidence. Bind the resolution to the importer's self-reference or verified workspace/local dependency membership, and report unproven local membership as unresolved. Include the relevant membership manifests in configuration evidence.

### F3 — P1: Project references are ignored while their aliases can be labeled external

Location: `service/packages/mcp/src/portal/module-resolution.ts:177-235` and `:336`.

Only literal `tsconfig.json`/`jsconfig.json` names are discovered; `references` is never inspected. The following fixture returns `complete: true` and classifies `dep` as external with no source target, without recording the selected application configuration:

```json
{
  "tsconfig.json": "{\"files\":[],\"references\":[{\"path\":\"./tsconfig.app.json\"}]}",
  "tsconfig.app.json": "{\"compilerOptions\":{\"paths\":{\"dep\":[\"./src/local.ts\"]}},\"include\":[\"src\"]}",
  "package.json": "{\"dependencies\":{\"dep\":\"1\"}}",
  "src/main.ts": "import 'dep';",
  "src/local.ts": "export {};"
}
```

The referenced application configuration explicitly maps that import to local source. The current helper does not resolve the project ownership, follow the reference, or indicate uncertainty. Either follow bounded project references and select the applicable configuration with explicit ambiguity handling, or mark this unsupported configuration incomplete. An empty solution configuration must not authorize a complete interpretation of referenced project imports.

### F4 — P2: A valid source below the byte limit throws before the AST limit can apply

Location: `service/packages/mcp/src/portal/module-resolution.ts:438-440`.

Reproduction on the installed Node/Vitest runtime:

```ts
const input = 'export const data = [' + '0,'.repeat(130000) + '];';
// 260,022 bytes, less than the 262,144-byte per-file limit.
resolvePortalModules(new Map([['wide.ts', input]]), ['wide.ts']);
// Throws RangeError: Maximum call stack size exceeded.
```

`pending.push(...node)` expands a wide AST array into function arguments before the 100,000-item traversal guard can reject it. No catch surrounds traversal. This violates graceful bounded analysis for ordinary supplied source bytes. Enqueue incrementally under a queue/visit bound and return a stable incomplete issue when the traversal cannot finish. Cover a wide AST and ensure no uncaught exception.

### F5 — P2: Destructured bindings bypass the require-shadowing fence

Location: `service/packages/mcp/src/portal/module-resolution.ts:443-456`.

With `local.js` present, this source produces a resolved reference to `local.js` and `complete: true`:

```js
const { require } = customLoader;
require('./local');
```

The binding identifier is nested in an `ObjectPattern`, so `node.id.name` does not detect it. Destructured/default/rest parameters and other binding positions have the same structural risk. The called function may apply arbitrary resolution and need not load that file. Recursively collect bound names or use scope information; conservatively fence ambiguous `require` bindings instead of asserting native resolution.

### F6 — P2: Invalid mixed package-export shapes are silently accepted

Location: `service/packages/mcp/src/portal/module-resolution.ts:289-308`.

For a named package with this manifest and both target files present, importing `pkg` returns resolved `pkg/index.ts` with `complete: true`:

```json
{
  "name": "pkg",
  "exports": {
    ".": "./index.ts",
    "browser": "./browser.ts"
  }
}
```

The object mixes subpath keys and condition keys at the same level. The current `some(key => key.startsWith('.'))` selects the subpath branch and ignores the incompatible condition key. The helper must reject unsupported/invalid mixed export structures rather than authorizing one interpretation. Validate the full selected export shape before flattening supported branches.

## Verification and retained diagnostics

Native commands in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

```powershell
& ./node_modules/.bin/vitest.cmd run packages/mcp/test/portal/module-resolution.test.ts test/portal-module-review.diagnostic.test.ts
& ./node_modules/.bin/vitest.cmd run test/portal-module-review.diagnostic.test.ts --reporter=verbose --silent=false
```

The first successful run passed all nine owned tests and five initial diagnostic tests. The later diagnostic run passed seven diagnostic tests, including the added wide-AST throw and project-reference cases. Diagnostic assertions intentionally assert the observed defective behavior; a passing diagnostic proves the reproduction, not correctness.

Retained diagnostic-only file: `service/test/portal-module-review.diagnostic.test.ts` in the isolated copy. Exclude it from production integration and final source checks, or convert accepted cases into proper regression tests with corrected expectations. It was not copied into the main source tree. One exploratory test about a file outside `tsconfig.include` is intentionally not raised as a finding because imported-file/project ownership semantics need a more precise contract.

No claim is made that this is a complete review of every potential runtime resolver. The findings above are concrete reproduced violations of the helper's own conservative completeness contract.
