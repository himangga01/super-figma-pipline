# Bounded sample module support

Date: October 11, 2026, updated at 14:34 KST (Asia/Seoul).

This execution record supplements [the continuation record](README.md) and the canonical [service analysis](../../service-analysis.md). The shared analysis policy and [repository instructions](../../../AGENTS.md) were read before work. The owner authorized parallel implementation in this continuation. Only the two module-resolution files in the native validation copy were edited; the coordinator owns integration, provenance, canonical reports and final whole verification.

## Source and scope

- Published main: `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with the previously recorded uncommitted source/report changes.
- Validation copy: `.worktrees/baseline/service`, detached HEAD `6459363354f52940b4c67e399b9e735d7332d4dc`. Its pre-continuation service source matched `sha256:f975a5773d14a744fe4b2429255b58dad3d5c22c9fbe8145e5d654f250d85d9d` according to the coordinator's verified handoff. Parallel edits mean this record does not claim a new aggregate service fingerprint or current whole-source pass.
- Frozen implementation: `packages/mcp/src/portal/module-resolution.ts`, SHA-256 `76d9e47741e7c5cb8c24415543b841b2fcbf45df22db6122601ed605a3e0b023`.
- Frozen tests: `packages/mcp/test/portal/module-resolution.test.ts`, SHA-256 `26ed8b847056b2feb5684d07049c7377553409b631eeae9ed360db0bd31f9a9b`.
- C2 working sample: Epic Stack at pinned upstream `64ca647630e15f71e6782b622ab0112c4b428f1f`, `.worktrees/_cache/portal-case-samples-20261010/epic-legacy`. Retained owner-approved local adaptations are described by the earlier preparation record.
- C3 reference sample: official React Router Node custom-server template at `067adb378a00a4c2ceb71934d5e8901d0e87c256`, `.worktrees/_cache/oss-samples-20261010/react-router-templates/node-custom-server`.

The samples' source/dependency screening remains the bounded evidence in [the malware review](../../analysis/oss-samples-malware-review.md). No installation, lifecycle, setup, deployment, generated-code command, application startup or browser operation was executed here. This work parses already supplied source and configuration bytes to improve the portal service graph's conservative module closure.

## Implemented behavior

The resolver still performs no filesystem read or repository-code execution. `analyzeServiceGraph` supplies inventory-bound source texts through `RepoReader`. The implementation now:

1. Reads local TypeScript project references, including directory references and named configuration files, independently from `extends` inheritance. A child extending its referring solution is valid; a cycle in the project-reference graph remains an issue.
2. Uses referenced projects' inherited/config-relative `files`, `include` and `exclude` selectors to select the source's configuration. It honors ordinary TypeScript `*`, `?` and `**` wildcard shapes, recursive wildcard exclusions, implicit inherited `outDir`/`declarationDir` exclusions, explicit hidden-directory paths, and inherited `allowJs`/`checkJs` precedence. An explicit `exclude` list overrides the implicit output-directory exclusion. Parent projects can own sources too. Unknown memberships, overlapping project scopes and unassigned source files remain unresolved. Effective explicit `files` entries absent from inventory or lacking source text produce issues, even if the remaining files contain no import statements. Validation follows inheritance and overrides at active configuration roots/reference targets, so a child can replace a template's absent file list without a spurious missing-file issue.
3. Binds selected solution, referenced project and inherited configuration paths to alias/root-directory resolution. Existing private-package-import ambiguity checks use the same selected configuration.
4. Supports config-relative inherited `rootDirs` for relative module imports. Direct source resolution retains precedence, and fallback uses the longest directory prefix containing the requested target. Fallbacks preserve configured order and require an inventory member plus source text for code. Absent generated directories, case-mismatched targets and missing source text never become invented successful resolutions. An explicit empty `rootDirs` overrides the inherited overlay.
5. Rejects unsafe/encoded/out-of-root configuration targets and wildcard-parent traversal. References are bounded to 32 per configuration, 32 graph levels and 256 traversed graph visits. Source selectors are bounded to 128 per field, root directories to 32, and source membership comparisons to 100,000. Configuration texts use the existing per-file/aggregate source bounds. Per-source configuration selections are cached.
6. Propagates project configuration identities along verified resolved code-import edges, with 100,000 context-edge steps. Root selectors do not exhaust TypeScript program membership: imports can add a source belonging to another project. It retains each outgoing-reference source's initially used configuration identity, including a standalone nested configuration and default/no-config resolution. When multiple contexts reach a source, it records `CONFIG_PROJECT_CONTEXT_AMBIGUOUS`, marks that source's references unresolved, clears their targets and retains the contributing configuration evidence. It never silently switches that source to the project whose selectors list it. A leaf with neither outgoing references nor declared project ownership has no earlier module-resolution context to switch away from. This is conservative ambiguity detection; it does not implement a full per-project TypeScript compiler closure or turn a previously unassigned source needing context-specific re-resolution into an accepted one.

This is bounded source analysis, not execution of the TypeScript compiler or a runtime trace. External package configuration inheritance, unsupported resolution options, dynamic module inputs and bundler virtual-module semantics remain outside this patch.

## Executed verification

All commands ran in `.worktrees/baseline/service` with `.worktrees/_cache/bin` added to PATH. The test evidence is retained privately under `.worktrees/_cache/portal-case-samples-20261010`.

| Gate | Actual result |
| --- | --- |
| First new regression run, `module-support-red.json` | 27 passed, 17 failed. The new project-reference/root-directory expectations failed on the old implementation. |
| Membership refinements, `module-membership-red.json` | 44 passed, 3 failed before parent ownership, hidden-directory and JavaScript-permission repairs. |
| Selector refinements, `module-selector-red.json` | 47 passed, 2 failed before empty-overlay and wildcard-parent repairs. |
| Wide-selection bound, `module-selection-limit-red.json` | 47 passed, 3 failed, including the newly added comparison-limit expectation and the two pending selector repairs. |
| Independent review regressions, `module-review-red.json` | 50 passed, 3 failed for transitive project-context switching, recursive exclusions and implicit output-directory exclusion. |
| Required explicit source regression, `module-required-files-red.json` | 50 passed, 4 failed, including the additional absent/unreadable required project file expectation. |
| Follow-up review regressions, `module-context-review-red.json` | 54 passed, 3 failed for switching to a nested standalone configuration, default/no-config resolution and rejecting a valid inherited-files override. |
| Final module-resolution tests | 57 passed, 0 failed, 0 skipped. A separate independent reviewer also reproduced 57/57 on the second repaired snapshot. The final five-file run repeats all 57 after the lint-only cleanup. |
| Related five-file run | 122 passed, 0 failed, 1 existing skip across module-resolution, service-graph, service-graph characterization, service-connections and source-inventory tests. |
| Scoped `pnpm exec oxlint --deny-warnings` | Passed for both edited files. |
| Scoped `pnpm exec oxfmt --check` | Passed for both edited files. |
| Latest `pnpm --filter @sfp/mcp typecheck` | Passed after the concurrent official-MCP fixture repair settled. Earlier failed runs exposed concurrent official-MCP/design-capture diagnostics, followed by TS2883 in `test/official-mcp-fixture.ts:8`; these were reported to the coordinator, and no claim was made that those failed runs passed. |

The first local typecheck caught an `exactOptionalPropertyTypes` error from assigning `undefined` to `rootDirs`; the implementation now deletes the optional property, and subsequent typechecks report no error in either owned file. No whole suite, build, release command, provenance transaction, commit, push or owner-index update was performed by this worker.

## Actual sample analysis

At `2026-10-11T05:34:05.126Z`, after the review repairs and lint-only cleanup, the existing service `analyzeServiceGraph` and `RepoReader` analyzed both actual sample roots. The helper used the project's source loader:

```powershell
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs ../../_cache/portal-case-samples-20261010/analyze-module-support.mjs
```

The helper then reread each graph text member through a fresh `RepoReader`, checked its SHA-256 against the graph's recorded hash, and passed the same inventory scope to the source resolver to retain unresolved specifiers. These rereads executed no sample modules. [Durable results](sample-graphs-modules.json) bind the frozen module file hash and record all remaining issues. Full private graphs and the helper are under `.worktrees/_cache/portal-case-samples-20261010/graph-preparation-modules` and its parent directory.

| Sample | Previous issue count | Current issue count | Inventory complete | Module/service analysis accepted |
| --- | --- | --- | --- | --- |
| C2 | 59 | 58 | Yes | No; `incomplete:true`, `lexicalReviewable:false` |
| C3 | 7 | 5 | Yes | No; `incomplete:true`, `lexicalReviewable:false` |

C2 lost its unsupported-`rootDirs` configuration issue. Its 57 remaining unresolved references comprise 52 generated `+types` imports, one generated icon sprite, one CSS `?url` import, two `virtual:react-router/server-build` references and one nonliteral build import. `CONFIG_EXTENDS_UNSUPPORTED:tsconfig.json` remains the additional issue because Epic Stack's array-valued external `@epic-web/config/typescript` inheritance is unsupported. Both `.react-router/types` and `app/components/ui/icons/sprite.svg` were checked absent on disk. These are genuinely missing generated inputs, not resolved targets hidden by the parser.

C3's solution references now expose the application `~/*` alias, removing the two previous undeclared-module failures and the unsupported-reference issue. Five failures remain: missing `./+types/root` and `./+types/home`, a nonliteral production-build import, the virtual server-build module and the newly explicit unassigned `react-router.config.ts` source. The source configuration file exists, but neither referenced project's declared source scope includes it; the parser does not invent its ownership. `.react-router/types` was checked absent on disk.

`@prisma/client/sql` in C2 remains a declared external dependency. That classification never proves a generated SQL client exists or that it works. Reviewing and selectively generating the Prisma client/SQL inputs is a separate native setup and runtime obligation. The generated `build/server/index.js` entry points and framework virtual modules likewise require actual reviewed provisioning and source/runtime binding.

Connection analysis still records unsupported receiver/middleware/provider/runtime semantics. In particular, the retained Dockerfile evidence is not an executed Docker workflow. Both samples remain unaccepted for portal generation, guarded application, data/auth/backend behavior and runtime validation.

## Review history

The first independent review reproduced four defects: a transitive source incorrectly resolved under another referenced project's aliases, terminal recursive exclusions failed to exclude files, implicit output-directory exclusion was missing, and absent explicit project files did not invalidate the analysis. Each reproduced case failed before repair. The first repaired source was `346fbe90...`.

The reviewer then reproduced two additional forms of the context switch, involving a standalone nested configuration and default/no-config resolution, and a false rejection caused by validating an inherited template's file list before its child override. The three new regressions failed on that first repaired source. A first context refinement flagged four legitimate import leaves that had no outgoing module resolution; retaining earlier resolution identities only where an earlier resolution actually occurred restored those positives. Final tests preserve all expectations. The second repaired source `3fa69131...` passed the reviewer's independent 57-case run at 14:33:04 KST. The reviewer reported no additional actionable finding within the scoped recheck.

The final source `76d9e477...` replaces one nested spread/flatMap expression with Set/add loops and the same sorted unique iteration to remove an `oxlint` warning. It changes no resolution semantics. The five-file suite, MCP typecheck and actual sample analyses were rerun after this cleanup; scoped lint explicitly exited 0. The separate [review record](sample-module-review.md) preserves the review scope and evidence.

## Continuation

The patch is frozen for coordinator integration. Priorities are:

1. Integrate the two reviewed files, record the new provenance/source fingerprint and rerun final source gates after all parallel edits settle. The scoped complete MCP typecheck already passes, but no whole-source gate covers the integrated parallel snapshot yet.
2. Review exact native commands/dependency entry points before generating route types, the icon sprite and Prisma SQL/client inputs in owned disposable working copies. Bind any generated inputs to actual inventory/source evidence. Do not execute the Epic initializer or blanket dependency lifecycle hooks.
3. Add source-bound support for external TypeScript configuration inheritance and a configured CSS `?url` loader, and review C3's missing configuration ownership without silently adding files to upstream scopes.
4. Handle generated runtime/virtual-module imports through reviewed build/runtime evidence. Retain nonliteral or unprovisioned inputs as unresolved until such evidence exists.
5. Execute actual applicable portal generation/application and backend/data/auth acceptance once preparation is complete. A reduced issue count or unit-test pass does not satisfy these gates.

Native execution uses the Windows owner's process/filesystem permissions in a separate working copy; it is not an operating-system sandbox. No Docker, Codex browser/Figma connector or user Chrome control was used.
