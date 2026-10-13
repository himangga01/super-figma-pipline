# Native TypeScript launcher format failure

Analysis date: October 13, 2026, Asia/Seoul. Closed evidence timestamp: 20:35:17.366 KST. **The exact offending TypeScript launcher reproduces the format rejection locally. Use the same installed package's explicit `lib/tsc.js` profile entry, retaining `--noEmit` and all module-fence checks.** This recommendation has local execution and source equivalence evidence; the actual corrected CDD validation is still controller work.

Read [AGENTS.md](../../AGENTS.md), the shared analysis policy, [service analysis](../service-analysis.md) and the existing [recovery analysis](portal-local-capture-recovery.md) before continuing. Root owns canonical report and instruction updates. The [closed machine-readable evidence](../testing/2026-10-11-web-portal/native-module-format-local-20261013.json) records exact input hashes, local outcomes and limits.

## Baseline and ownership

Main/native source remains `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`, on HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted work. The owner index remains `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675`. A new regular owned copy at `.worktrees/_cache/native-module-format-independent-20261013/service` was populated from the verified 1,357-file baseline manifest. Closing readbacks matched all manifest entries across Main, native and this unmodified review copy.

The sole live controller, `official_oauth_backend_sol`, owns QA, authenticated journal/environment reads, browser control and the corrected public validation. This reviewer did not inspect QA state or perform Chrome/API operations. The controller supplied four exact TypeScript files in a separate closed diagnostic directory, manifest SHA-256 `fe0c9a19846b907d9d70c0847a34707c5e41f0e2f846676e65138eaa8d36b479`; every file's size/hash was independently checked before local use.

## Actual evidence and implementation

The controller reports that the actual failed command was `typecheck`, with arguments `node_modules/typescript/bin/tsc --noEmit`, and that its authenticated execution environment is released/closed and the three owned native processes are absent. Those live facts are controller-supplied evidence, not independently repeated reads. The original trace's last module identifies the extensionless 45-byte `bin/tsc`, SHA-256 `8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`. The original trace does not record `nextLoad().format`.

`native-module-fence-source.ts:88` checks the admitted file's byte/identity authority before invoking Node's default loader. It compares returned source bytes when available, accepts `module`, `commonjs`, `json` and `addon`, and permits undefined format only for `.js`, `.cjs` and `.json`. An extensionless file with undefined format therefore reaches the existing `PORTAL_NATIVE_MODULE_FORMAT_UNSUPPORTED` rejection. The collector in `native-module-fence.ts:402` propagates recorded violations even if workload code catches a child error. No guard was relaxed for this investigation.

The actual command's executable hash, confirmed by the controller, matches the local diagnostic binary: Node v24.21.0, SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. `service/.node-version` records v24.17.0. That version difference is recorded; no evidence attributes the failure to a Node upgrade.

## Exact local reproduction

The local fixture executes the production service-owned preload against copied, hash-bound files using an owned policy with exact file/directory identities and no producer exemptions. One diagnostic variant appends only a bounded format string, sanitized extension, path hash and source hash immediately before the unchanged rejection. It emits no source body, raw path, token or credential and accepts no additional format.

| Local case, actual TypeScript 5.9.2 package | Outcome |
| --- | --- |
| Original preload, exact extensionless `bin/tsc`, `--version` | Exit 1; `PORTAL_NATIVE_MODULE_FORMAT_UNSUPPORTED` |
| Diagnostic-only preload, same input | Exit 1; same rejection; observed format `undefined`, extension empty, exact launcher source hash |
| Original preload, same-package `lib/tsc.js`, `--version` | Exit 0; `Version 5.9.2`; no violation |

The command `node .worktrees/_cache/native-module-format-independent-20261013/probe.mjs --actual` exited zero after all three assertions. The exact 5.9.2 input set includes the 267-byte `lib/tsc.js` shim, SHA-256 `2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983`, and its 6,211,917-byte `_tsc.js`, SHA-256 `a040f97c9d0223f64c8ebc380c5e48eb7945f1142f7c1dc9c3ec4acdb6c1c613`. An earlier three-assertion preparation fixture used existing native TypeScript 6.0.3 with the same launcher/shim hashes; it remains separate supplemental evidence. The exact 5.9.2 reproduction is the basis for the recommendation.

The local observation supplies the missing format under the same Node binary and exact offending launcher bytes. Attribution of the historical failure is an evidence-supported inference from those facts and the controller's original trace, rather than a retrospective claim that the original trace observed the format.

## Narrow repair and continuation

The 45-byte launcher contains only a shebang and `require('../lib/tsc.js')`. The same-package `.js` shim enables Node's compile cache when available and requires `./_tsc.js`. Inspection of the exact 5.9.2 compiler finds CLI arguments taken from `process.argv.slice(2)` and no `require.main`, `process.mainModule` or `process.argv[1]` special handling. Starting the same `lib/tsc.js` directly preserves the compiler implementation, argument sequence and working directory while selecting an already supported entry extension. This is a profile entry correction, not new module-format authority.

The controller should prepare/register a genuinely new normal profile with entry `node_modules/typescript/lib/tsc.js` and unchanged `--noEmit`, then execute the normal service validation under the remaining original run deadline. Preserve the failed attempt and original profile authority. Do not edit an already approved profile in place, renew deadlines or represent local `--version` as a passed project typecheck. Any later failure should be diagnosed from its actual command/evidence before another targeted change.

No open product question is required for this bounded path substitution. Broader acceptance of extensionless or other unknown formats would need separately reviewed byte/source/loader semantics; it is unnecessary for this repair.

## Verification limits

This reviewer changed only ignored helper/fixture files, this analysis and its evidence receipt. No service source, No-Core candidate, Main/native source, index, deployment or live authority was changed. There was no dependency installation, build, full suite or acceptance rerun. The fixture validates loader compatibility and source equivalence, not a complete `--noEmit` project typecheck, build, preview, generated candidate/application or CDD acceptance. Owned local processes run with the same Windows owner's permissions; these copies and hash checks do not create an OS filesystem, process or network sandbox. Official-MCP live verification remains owner-deferred and the final eCommerce item remains owner-skipped, not passed.
